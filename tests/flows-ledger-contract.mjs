import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as L from "../shared/flows-ledger.js";
import * as W from "../shared/flows-live-worker.js";
import { LIVE_KEYS, freshEnvelope } from "../shared/flows-live.js";
import { FRESH_CLASSES, easternInstant } from "../shared/flows-freshness.js";
import { fakeLiveVendor } from "../scripts/flows-legs/live-fake.mjs";
import { productionScreenerBody } from "./live-stubs.mjs";
import { healthChecks, ledgerChecks, runChecks, runHealthGate, tallyAnswer, refusalTally, HEALTH, D1_QUOTA, QUOTA_WAIT, storeQuotaWait } from "../scripts/flows-legs/health.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const SCHEMA = read("schema.sql");
const DAY = "2026-09-29";
const MIN = 60000;
const at = (h, m, day = DAY) => easternInstant(day, h * 60 + m);
const quiet = { error() {}, warn() {} };
const apply = (store, st) => store.db.prepare(st.sql).run(...st.args);

function sqliteD1({ schema = SCHEMA } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  const trips = [];
  const reads = /^\s*(SELECT|PRAGMA|WITH)/i;
  const exec = (sql, args) => {
    const st = db.prepare(sql);
    if (reads.test(sql)) return { results: st.all(...args), meta: {} };
    return { results: [], meta: { changes: st.run(...args).changes } };
  };
  const D1 = {
    prepare(sql) {
      const st = { sql, args: [], bind(...a) { st.args = a; return st; },
        first: async () => { trips.push({ kind: "first", sqls: [sql] }); return exec(sql, st.args).results[0] ?? null; },
        all: async () => { trips.push({ kind: "all", sqls: [sql] }); return exec(sql, st.args); },
        run: async () => { trips.push({ kind: "run", sqls: [sql] }); return exec(sql, st.args); } };
      return st;
    },
    batch: async (list) => {
      trips.push({ kind: "batch", sqls: list.map((s) => s.sql) });
      db.exec("BEGIN");
      try {
        const out = list.map((s) => exec(s.sql, s.args));
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { D1, db, trips, row: (day) => db.prepare("SELECT * FROM flows_ledger WHERE day = ?").get(day) };
}

const sqlColumns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}`);

{
  const shipped = sqliteD1();
  const bootstrapped = sqliteD1({ schema: "" });
  bootstrapped.db.exec(L.LEDGER_SCHEMA_SQL);
  deep(sqlColumns(bootstrapped.db, "flows_ledger"), sqlColumns(shipped.db, "flows_ledger"),
    "THE WORKER'S FIRST-USE DDL AND schema.sql DECLARE THE SAME TABLE: a database provisioned from either has the same columns, types, NOT NULLs and defaults");
  ok(W.LIVE_SCHEMA_SQL.includes(L.LEDGER_SCHEMA_SQL), "and the Worker's idempotent bootstrap batch carries it, so a database that predates the table gets it on the first Flows request");
  const migration = read("migrations/0015_flows_ledger.sql");
  const fromMigration = sqliteD1({ schema: "" });
  fromMigration.db.exec(migration);
  deep(sqlColumns(fromMigration.db, "flows_ledger"), sqlColumns(shipped.db, "flows_ledger"), "and so does migrations/0015_flows_ledger.sql");
  ok(/CREATE TABLE IF NOT EXISTS flows_ledger/.test(SCHEMA) && migration.trim().endsWith(");"), "a migration that can be applied twice");
  eq(L.LEDGER_RETAIN_DAYS, 30, "the ledger keeps thirty days");
  eq(L.LEDGER_LIMITS.tier1Ms, FRESH_CLASSES.market.staleS * 1000, "the Tier 1 and focus gap limit IS the Worker class's stale line, read from the table that draws the reader's stale mark");
  eq(L.LEDGER_LIMITS.tier2Ms, FRESH_CLASSES.breadth.staleS * 1000, "and the Tier 2 limit is the Actions class's");
}

{
  const s = sqliteD1();
  const win = L.tickWindow(DAY, null);
  deep([win.start, win.end], [at(9, 30), at(16, 10)], "the tick window is the open to the close plus the ten minutes Tier 1 keeps reading");
  eq(L.tickWindow("2026-11-27", null).end, easternInstant("2026-11-27", 13 * 60 + 10), "and on a calendar early close it ends ten minutes after 13:00");
  const tick = (h, m) => apply(s, L.ledgerTickStatement(s.D1, { day: DAY, at: at(h, m), ...win }));
  for (const [h, m] of [[9, 1], [9, 31], [9, 36], [9, 41], [10, 11], [10, 16]]) tick(h, m);
  let r = s.row(DAY);
  eq(r.ticks, 6, "every tick is counted");
  eq(r.t1_gap_ms, 30 * MIN, "THE LONGEST GAP BETWEEN TICKS INSIDE THE SESSION: 09:41 to 10:11 is thirty minutes");
  eq(r.t1_gap_end, at(10, 11), "with the instant it ended, so the gate can print from and to");
  eq(r.t1_last_at, at(10, 16), "and the last tick's instant");
  const first = sqliteD1();
  apply(first, L.ledgerTickStatement(first.D1, { day: DAY, at: at(9, 1), ...win }));
  eq(first.row(DAY).t1_gap_ms, 0, "a tick before the open opens no gap: the window starts at 09:30");
  const late = sqliteD1();
  apply(late, L.ledgerTickStatement(late.D1, { day: DAY, at: at(10, 20), ...win }));
  eq(late.row(DAY).t1_gap_ms, 50 * MIN, "and a session whose first tick arrives at 10:20 opens with a fifty-minute gap from the open");
  const after = sqliteD1();
  for (let t = at(9, 31); t <= at(15, 56); t += 5 * MIN) apply(after, L.ledgerTickStatement(after.D1, { day: DAY, at: t, ...win }));
  for (const [h, m] of [[16, 6], [18, 1], [19, 56]]) {
    apply(after, L.ledgerTickStatement(after.D1, { day: DAY, at: at(h, m), ...win }));
  }
  eq(after.row(DAY).t1_gap_ms, 10 * MIN, "ticks after the window's end are clamped to it, so the hours after the close are not a gap");
}

{
  const s = sqliteD1();
  const win = L.tickWindow(DAY, null);
  const go = (st) => apply(s, st);
  const out = (h, m, extra) => go(L.ledgerOutcomeStatement(s.D1, { day: DAY, at: at(h, m), ...win, ok: false, failed: false, stale: null, ...extra }));
  out(9, 31, { ok: true });
  out(9, 36, { failed: true });
  out(9, 41, { failed: true });
  out(10, 11, { ok: true, stale: { over: 120, key: "live:gex" } });
  out(10, 16, { ok: true, stale: { over: 60, key: "live:tape" } });
  out(10, 21, { ok: true, stale: { over: 300, key: "live:alerts" } });
  const r = s.row(DAY);
  deep([r.t1_ok, r.t1_fail], [4, 2], "TICKS OK AND FAILED are counted apart");
  eq(r.t1_ok_gap_ms, 40 * MIN, "the longest gap between two SUCCESSFUL writes is what the reader saw: 09:31 to 10:11 is forty minutes although five ticks arrived inside it");
  eq(r.t1_ok_gap_end, at(10, 11), "with its end");
  eq(r.t1_ok_at, at(10, 21), "and the last write");
  deep([r.stale_ticks, r.stale_over_s, r.stale_key], [3, 300, "live:alerts"], "the worst lapse seen keeps the largest overrun and the key that had it, and counts the ticks that saw any");
  const ordered = sqliteD1();
  const goOrdered = (st) => apply(ordered, st);
  goOrdered(L.ledgerOutcomeStatement(ordered.D1, { day: DAY, at: at(11, 0), ...win, ok: true, failed: false, stale: { over: 900, key: "live:gex" } }));
  goOrdered(L.ledgerOutcomeStatement(ordered.D1, { day: DAY, at: at(11, 5), ...win, ok: true, failed: false, stale: { over: 30, key: "live:vol" } }));
  deep([ordered.row(DAY).stale_over_s, ordered.row(DAY).stale_key], [900, "live:gex"], "a smaller later lapse never replaces the worst one");
}

{
  const s = sqliteD1();
  const go = (st) => apply(s, st);
  const pass = (h, m, extra = {}) => go(L.ledgerPassStatement(s.D1, { day: DAY, at: at(h, m), calls: 40, failedCalls: 0, ...extra }));
  pass(9, 35, { failedCalls: 1 });
  pass(9, 40);
  pass(10, 30);
  pass(10, 0);
  const r = s.row(DAY);
  deep([r.t2_passes, r.t2_first_at, r.t2_last_at], [3, at(9, 35), at(10, 30)], "TIER 2 PASSES are counted from the heartbeat each pass writes, and an older heartbeat that arrives late is not counted");
  deep([r.t2_gap_ms, r.t2_gap_end], [50 * MIN, at(10, 30)], "the longest gap between passes, from 09:40 to 10:30");
  deep([r.t2_calls, r.t2_failed], [120, 1], "with the vendor calls asked and failed");
  eq(r.t2_first_at - at(9, 30), 5 * MIN, "the first pass's lateness against the open is its own gap: a loop that starts at 14:01 opens with a 271-minute gap");
  const friday = sqliteD1();
  apply(friday, L.ledgerPassStatement(friday.D1, { day: "2026-09-25", at: at(14, 1, "2026-09-25"), calls: 40, failedCalls: 0 }));
  eq(friday.row("2026-09-25").t2_gap_ms, 271 * MIN, "the 25 September session, whose first pass came at 14:01 ET");
}

{
  const s = sqliteD1();
  const go = (st) => apply(s, st);
  const win = L.tickWindow(DAY, null);
  const f = (h, m, extra) => go(L.ledgerFocusStatement(s.D1, { day: DAY, at: at(h, m), ...win, ok: false, partial: false, failed: false, ...extra }));
  f(9, 33, { ok: true });
  f(9, 38, { partial: true });
  f(9, 43, { failed: true });
  f(10, 3, { ok: true });
  const r = s.row(DAY);
  deep([r.focus_ok, r.focus_partial, r.focus_fail], [2, 1, 1], "FOCUS PARTIALS AND FAILURES are counted apart from writes");
  deep([r.focus_gap_ms, r.focus_gap_end, r.focus_ok_at], [30 * MIN, at(10, 3), at(10, 3)], "and the gap that matters is between writes");
  go(L.ledgerNightlyStatement(s.D1, { day: DAY, at: at(21, 18) }));
  go(L.ledgerNightlyStatement(s.D1, { day: DAY, at: at(23, 18) }));
  deep([s.row(DAY).nightly_at, s.row(DAY).nightly_runs], [at(21, 18), 2], "THE NIGHTLY'S LANDING keeps its first instant and counts the runs");
  const view = L.ledgerView(s.db.prepare(L.LEDGER_ROWS_SQL).all());
  eq(view.retainDays, 30, "the view names the retention");
  deep(view.days.map((d) => d.day), [DAY], "one entry a day");
  deep(Object.keys(view.days[0]).sort(), ["day", "focus", "nightly", "stale", "tier1", "tier2", "ticks", "updatedAt"].sort(), "in one documented shape");
  deep(Object.keys(view.days[0].tier1).sort(), ["fail", "gapEndAt", "gapMs", "lastAt", "ok", "okAt", "okGapEndAt", "okGapMs"], "Tier 1's members");
  eq(view.days[0].focus.gapEndAt, new Date(at(10, 3)).toISOString(), "instants are ISO strings");
  deep(L.ledgerView(null), { retainDays: 30, days: [] }, "and a missing table reads as no days");
}

{
  const s = sqliteD1();
  const insert = (day) => s.db.prepare("INSERT INTO flows_ledger (day, updated_at) VALUES (?, 1)").run(day);
  for (const day of ["2026-08-01", "2026-08-30", "2026-08-31", "2026-09-28", "2026-09-29"]) insert(day);
  const env = { DB: s.D1 };
  const n = await W.pruneLedger(env, at(3, 5, "2026-09-29"));
  eq(n, 2, "THE PRUNE DROPS WHAT IS OLDER THAN THIRTY DAYS");
  deep(s.db.prepare("SELECT day FROM flows_ledger ORDER BY day").all().map((r) => r.day), ["2026-08-31", "2026-09-28", "2026-09-29"],
    "and keeps thirty calendar days, today included");
  eq(await W.pruneLedger({}, 0), 0, "with no database it does nothing");
}

const rthEnv = (s, extra = {}) => ({ DB: s.D1, UW_API_KEY: "k", ...extra });
const tier1Vendor = (t) => {
  const fake = fakeLiveVendor({ now: () => t, session: DAY });
  return (p, params) => fake(p, params, { envelope: true });
};
const dead = async () => { throw new Error("HTTP 502"); };
const focusVendor = (t, drop = 0) => async (_p, params) => {
  const names = String(params.ticker).split(",");
  const body = productionScreenerBody(names, { session: DAY, readAt: t - 20000 });
  if (drop) body.data = body.data.slice(0, body.data.length - drop);
  return body;
};

{
  const s = sqliteD1();
  const env = rthEnv(s);
  const slots = [];
  for (let t = at(9, 1); t <= at(17, 56); t += 5 * MIN) slots.push(t);
  const dropped = (t) => t > at(11, 0) && t < at(11, 31);
  const vendorDown = (t) => t >= at(13, 0) && t < at(13, 21);
  let ticks = 0;
  for (const t of slots) {
    if (dropped(t)) continue;
    ticks++;
    await W.rthTick(env, t, { fetchVendor: vendorDown(t) ? dead : tier1Vendor(t), log: quiet });
  }
  const r = s.row(DAY);
  eq(r.ticks, ticks, "THE LEDGER COUNTS EVERY TICK THE WORKER RAN");
  eq(r.t1_gap_ms, 35 * MIN, "and its longest tick gap is the dropped half hour: 10:56 to 11:31 is thirty-five minutes");
  eq(r.t1_gap_end, at(11, 31), "ending where the cron came back");
  ok(r.t1_ok > 60 && r.t1_fail === 4, `${r.t1_ok} successful writes and the four ticks the vendor refused (13:01, 13:06, 13:11 and 13:16 ET), counted apart (${r.t1_fail})`);
  ok(r.t1_ok_gap_ms >= 35 * MIN, "the successful-write gap is at least the tick gap");
  const clock = s.db.prepare("SELECT tier1_at, tier1_ok_at FROM flows_clock WHERE id = 1").get();
  ok(clock.tier1_at === at(17, 56) && clock.tier1_ok_at > 0, "the clock row is still written exactly as before");
  const view = L.ledgerView(s.db.prepare(L.LEDGER_ROWS_SQL).all());
  eq(view.days[0].tier1.gapMs, 35 * MIN, "and the view reports it");
}

{
  const T = at(10, 30);
  const liveRow = (id, ageMin, over = {}) => ({ id, read_at: T - ageMin * MIN, session: DAY, cadence_s: 900, source: "actions", ...over });
  const workerRow = (id, ageMin, over = {}) => liveRow(id, ageMin, { cadence_s: 300, source: "worker", ...over });
  eq(L.worstStale([liveRow("live:gex", 3), workerRow("live:market", 2)], T), null, "WORST KEY LAPSE: rows read inside their stale lines are no lapse");
  eq(L.worstStale([liveRow("live:gex", 44), workerRow("live:market", 24)], T), null, "and a row a minute inside the line (44 of 45 min for an Actions key, 24 of 25 for a Worker key) is still no lapse");
  deep(L.worstStale([liveRow("live:alerts", 50)], T), { key: "live:alerts", over: 300 }, "an Actions key read 50 min ago is five minutes (300 s) past its 45 min line");
  deep(L.worstStale([workerRow("live:market", 30)], T), { key: "live:market", over: 300 }, "a Worker key read 30 min ago is five minutes past its 25 min line: the class decides the line");
  deep(L.worstStale([liveRow("live:gex", 60), liveRow("live:alerts", 50), liveRow("live:tape", 46)], T), { key: "live:gex", over: 900 }, "THE LARGEST OVERRUN WINS, whichever row comes first");
  deep(L.worstStale([liveRow("live:tape", 46), liveRow("live:alerts", 50), liveRow("live:gex", 60)], T), { key: "live:gex", over: 900 }, "in either order");
  const yesterday = (id) => liveRow(id, 0, { read_at: at(15, 55, "2026-09-28"), session: "2026-09-28" });
  eq(L.worstStale([yesterday("live:gex")], at(9, 40)), null, "a row from before the open is awaiting its first read until the open plus its live window (09:50 ET for an Actions key): no lapse at 09:40");
  deep(L.worstStale([yesterday("live:gex")], at(10, 30)), { key: "live:gex", over: 40 * 60 }, "and a row still from yesterday at 10:30 ET missed the open: forty minutes past 09:50");
  eq(L.worstStale([liveRow("live:gex", 90)], at(17, 0)), null, "outside the session (post-market) nothing is judged");
  eq(L.worstStale([liveRow("live:gex", 90)], at(8, 0)), null, "nor before it");
  eq(L.worstStale([liveRow("live:gex", 90)], easternInstant("2026-09-26", 11 * 60)), null, "nor on a Saturday");
  deep(L.worstStale([null, { id: 7 }, {}, liveRow("live:alerts", 50)], T), { key: "live:alerts", over: 300 }, "rows that are not rows are skipped");
  eq(L.worstStale(null, T), null, "and no rows are no lapse");
  eq(L.worstStale([liveRow("live:alerts", 50)], NaN), null, "an unusable instant is no lapse");
}

{
  const T = at(10, 30);
  const seed = (s, rows) => {
    for (const r of rows) {
      s.db.prepare("INSERT INTO flows_live (id, payload, read_at, session, cadence_s, source, writer, updated_at) VALUES (?, '{}', ?, ?, ?, ?, 'test', ?)")
        .run(r.id, r.readAt, DAY, r.cadenceS, r.source, r.readAt);
    }
  };
  const lapse = sqliteD1();
  seed(lapse, [{ id: "live:alerts", readAt: T - 50 * MIN, cadenceS: 900, source: "actions" }, { id: "live:gex", readAt: T - 20 * MIN, cadenceS: 900, source: "actions" }]);
  const env = rthEnv(lapse);
  const first = await W.rthTick(env, T, { fetchVendor: tier1Vendor(T), log: quiet });
  ok(first.tier1.written, "the tick under test writes");
  let r = lapse.row(DAY);
  deep([r.stale_ticks, r.stale_over_s, r.stale_key], [1, 300, "live:alerts"],
    "THE TICK READS THE LIVE ROWS AND LEDGERS THE WORST LAPSE IT SAW: live:alerts, read 50 min before the tick, is five minutes past its line");
  const t2 = T + 5 * MIN;
  await W.rthTick(env, t2, { fetchVendor: tier1Vendor(t2), log: quiet });
  r = lapse.row(DAY);
  deep([r.stale_ticks, r.stale_over_s, r.stale_key], [2, 600, "live:alerts"], "and the next tick, five minutes later with the row still unwritten, counts a second lapse and the larger overrun");
  const clean = sqliteD1();
  seed(clean, [{ id: "live:alerts", readAt: T - 20 * MIN, cadenceS: 900, source: "actions" }]);
  await W.rthTick(rthEnv(clean), T, { fetchVendor: tier1Vendor(T), log: quiet });
  r = clean.row(DAY);
  deep([r.stale_ticks, r.stale_over_s, r.stale_key], [0, null, null], "a tick that finds every row inside its line records none");
  const failing = sqliteD1();
  seed(failing, [{ id: "live:alerts", readAt: T - 50 * MIN, cadenceS: 900, source: "actions" }]);
  await W.rthTick(rthEnv(failing), T, { fetchVendor: dead, log: quiet });
  r = failing.row(DAY);
  deep([r.t1_fail, r.stale_ticks, r.stale_key], [1, 1, "live:alerts"], "and a tick whose vendor read failed still records what the Worker saw");
}

{
  const s = sqliteD1();
  const env = rthEnv(s);
  const seen = [];
  const counted = (t, fetchVendor) => {
    const from = s.trips.length;
    return W.rthTick(env, t, { fetchVendor, log: quiet }).then((out) => {
      seen.push({ t, trips: s.trips.slice(from), out });
      return out;
    });
  };
  await counted(at(10, 1), tier1Vendor(at(10, 1)));
  const due = await counted(at(10, 6), tier1Vendor(at(10, 6)));
  const notDue = await counted(at(18, 1), tier1Vendor(at(18, 1)));
  const dueTrips = seen[1].trips;
  eq(dueTrips.length, 3, "NO EXTRA ROUND TRIP: a due tick costs three trips, as it did before the ledger: the tick stamp, the clock and live-row read, and the write batch");
  ok(dueTrips[0].kind === "batch" && /INSERT INTO flows_clock/.test(dueTrips[0].sqls[0]) && /INSERT INTO flows_ledger/.test(dueTrips[0].sqls[1]),
    "the stamp is a batch of the clock upsert and the ledger's tick row");
  ok(dueTrips[1].kind === "batch" && dueTrips[1].sqls.length === 2 && /FROM flows_live$/.test(dueTrips[1].sqls[1]),
    "the read batch carries every live row's age in the statement that read only live:breadth");
  ok(dueTrips[2].kind === "batch" && dueTrips[2].sqls.some((q) => /INSERT INTO flows_live/.test(q)) &&
     dueTrips[2].sqls.some((q) => /INSERT INTO flows_ledger/.test(q)) && dueTrips[2].sqls.some((q) => /INSERT INTO flows_clock/.test(q)),
    "and the write batch carries the ledger's outcome beside the live row and the clock patch");
  eq(seen[2].trips.length, 2, "a tick that is not due costs two trips");
  ok(due.tier1.written && !notDue.tier1, "and only the due one read the vendor");
}

{
  const s = sqliteD1();
  const env = rthEnv(s);
  for (const t of [at(10, 1), at(10, 6)]) await W.rthTick(env, t, { fetchVendor: tier1Vendor(t), log: quiet });
  s.db.exec("DROP TABLE flows_ledger");
  const warns = [];
  const real = console.warn;
  console.warn = (line) => warns.push(String(line));
  let out, f;
  const responses = [];
  try {
    out = await W.rthTick(env, at(10, 11), { fetchVendor: tier1Vendor(at(10, 11)), log: quiet });
    f = await W.focusTick(env, at(10, 13), { fetchVendor: focusVendor(at(10, 13)), log: quiet });
    const pass = { v: 1, key: "live:heartbeat", session: DAY, fresh: freshEnvelope({ readAt: at(10, 15), source: "actions", cadenceS: LIVE_KEYS["live:heartbeat"].cadenceS, session: DAY, writer: "flows-live" }), run: { calls: 3, failedCalls: 0 } };
    await W.ingestLive(env, "live:heartbeat", "POST", JSON.stringify(pass), at(10, 15), { json: (b, st = 200) => { responses.push([st, b]); return b; } });
  } finally { console.warn = real; }
  ok(out.telemetry === true && out.tier1.written === true, "A LEDGER THAT CANNOT BE WRITTEN NEVER COSTS THE TICK: with the table gone the tick still stamps the clock and writes live:market");
  const clock = s.db.prepare("SELECT tier1_at, tier1_ok_at, tier1_why FROM flows_clock WHERE id = 1").get();
  deep([clock.tier1_at, clock.tier1_ok_at, clock.tier1_why], [at(10, 11), at(10, 11), "written"], "with the clock row exactly as if there were no ledger");
  ok(warns.length >= 3 && warns.every((w) => /ledger statement refused/.test(w)), "and one warning per refused batch names it");
  ok(f.written === true, "THE FOCUS WRITE LIKEWISE: live:focus is written without the ledger");
  ok(responses[0][1].ok === true && s.db.prepare("SELECT id FROM flows_live WHERE id = 'live:heartbeat'").get(), "and the heartbeat is stored and acknowledged");
  ok(s.db.prepare("SELECT live_done_at FROM flows_clock WHERE id = 1").get().live_done_at === at(10, 15), "with the clock's live_done_at stamped");
}

{
  const s = sqliteD1();
  const env = rthEnv(s);
  const names = W.focusNames(null).names;
  const asked = [];
  const vendor = (t, drop) => async (p, params) => { asked.push(params.ticker); return focusVendor(t, drop)(p, params); };
  await W.focusTick(env, at(9, 33), { fetchVendor: vendor(at(9, 33), 0), log: quiet });
  const partial = await W.focusTick(env, at(9, 38), { fetchVendor: vendor(at(9, 38), 2), log: quiet });
  await W.focusTick(env, at(9, 43), { fetchVendor: vendor(at(9, 43), 0), log: quiet });
  eq(partial.why, "partial", "the tick that lost two of the names says so");
  const r = s.row(DAY);
  deep([r.focus_ok, r.focus_partial, r.focus_fail], [2, 1, 0], "AND THE LEDGER COUNTS THE PARTIAL, which no health gate could see before: the held row was kept and nothing else recorded it");
  deep([r.focus_gap_ms, r.focus_ok_at], [10 * MIN, at(9, 43)], "with the gap between the writes on either side of it");
  ok(names.length > 0 && asked.length === 3, "one vendor call a tick, as before");
  const failing = await W.focusTick(env, at(9, 48), { fetchVendor: async () => { throw new Error("HTTP 500"); }, log: quiet });
  eq(failing.written, false, "a vendor error writes nothing");
  eq(s.row(DAY).focus_fail, 1, "and is a failure");
  const before = s.trips.length;
  await W.focusTick(env, at(9, 53), { fetchVendor: focusVendor(at(9, 53)), log: quiet });
  const trips = s.trips.slice(before);
  eq(trips.length, 2, "A GOOD FOCUS TICK COSTS THE TWO TRIPS IT DID: the read batch and one write batch, the ledger inside it");
  ok(trips[1].kind === "batch" && trips[1].sqls.length === 2 && /INSERT INTO flows_live/.test(trips[1].sqls[0]) && /INSERT INTO flows_ledger/.test(trips[1].sqls[1]),
    "the live row first, the ledger beside it");
}

{
  const s = sqliteD1();
  const env = rthEnv(s);
  const beat = (t, calls = 40, failedCalls = 0) => JSON.stringify({ v: 1, key: "live:heartbeat", session: DAY,
    fresh: freshEnvelope({ readAt: t, source: "actions", cadenceS: LIVE_KEYS["live:heartbeat"].cadenceS, session: DAY, writer: "flows-live" }),
    run: { calls, failedCalls } });
  const json = (b) => b;
  for (const [h, m] of [[9, 35], [9, 40], [10, 35]]) {
    const from = s.trips.length;
    const res = await W.ingestLive(env, "live:heartbeat", "POST", beat(at(h, m), 40, h === 9 && m === 35 ? 2 : 0), at(h, m) + 4000, { json });
    eq(res.stored, "written", "the heartbeat is stored");
    eq(s.trips.length - from, 1, "in one trip, the ledger inside its batch (a pass adds no round trip)");
  }
  const r = s.row(DAY);
  deep([r.t2_passes, r.t2_gap_ms, r.t2_calls, r.t2_failed], [3, 55 * MIN, 120, 2], "EVERY TIER 2 PASS lands in the ledger through the heartbeat write: passes, the longest gap and the vendor calls");
  const replay = await W.ingestLive(env, "live:heartbeat", "POST", beat(at(9, 40)), at(10, 36), { json });
  eq(replay.stored, "older-than-held", "an older heartbeat is refused by the live row");
  eq(s.row(DAY).t2_passes, 3, "and is not a pass");
  const again = await W.ingestLive(env, "live:heartbeat", "POST", beat(at(10, 35), 40, 0), at(10, 35) + 9000, { json });
  eq(again.stored, "written", "a heartbeat sent twice with the same read time (a retried POST) is accepted by the live row");
  deep([s.row(DAY).t2_passes, s.row(DAY).t2_calls, s.row(DAY).t2_failed], [3, 120, 2], "A RETRIED HEARTBEAT IS NOT A SECOND PASS: the count, the calls and the failures stay as they were");
  const next = await W.ingestLive(env, "live:heartbeat", "POST", beat(at(10, 40), 40, 1), at(10, 40) + 4000, { json });
  eq(next.stored, "written", "and the next pass after it");
  deep([s.row(DAY).t2_passes, s.row(DAY).t2_calls, s.row(DAY).t2_failed], [4, 160, 3], "counts once");
}

{
  const s = sqliteD1();
  const env = { DB: s.D1 };
  const json = (body) => body;
  const out = await W.serveIngestClock(env, { json, lab: true });
  ok(!Object.hasOwn(out, "ledger") || out.ledger.days.length === 0, "a database with no ledger rows answers an empty ledger");
  const go = (st) => apply(s, st);
  go(L.ledgerTickStatement(s.D1, { day: DAY, at: at(9, 31), ...L.tickWindow(DAY, null) }));
  const nightly = await W.serveIngestClock(env, { json, lab: true });
  const live = await W.serveIngestClock(env, { json, lab: false });
  eq(nightly.ledger.days[0].day, DAY, "THE INGEST CLOCK KEY CARRIES THE LEDGER for the nightly credential");
  ok(!Object.hasOwn(live, "ledger"), "and not for the live credential, whose every-pass read of this key must stay small");
  eq(nightly.ledger.retainDays, 30, "under the documented shape");
  s.db.exec("DROP TABLE flows_ledger");
  const gone = await W.serveIngestClock(env, { json, lab: true });
  ok(!Object.hasOwn(gone, "ledger"), "and an unreadable table omits the field rather than failing the clock read");
}

{
  globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };
  const s = sqliteD1();
  const token = "ledger-ingest-token-abcdefghijklmnopqrstuvwxyz";
  const env = { DB: s.D1, FLOWS_INGEST_TOKEN: token, SESSION_SECRET: "ledger-session-secret-abcdefghijklmnopqrstuvwxyz" };
  const worker = (await import("../worker.js?ledger=1")).default;
  const post = async (key, body) => worker.fetch(new Request("https://anilkaya.org/api/flows/ingest?key=" + key,
    { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, { waitUntil() {} });
  await post("market", { sessionDate: DAY });
  const before = s.trips.length;
  const landed = await post("meta", { sessionDate: DAY, generatedAt: "2026-09-30T01:18:00.000Z" });
  eq(landed.status, 200, "the nightly's meta write is accepted");
  const trips = s.trips.slice(before);
  eq(trips.length, 1, "AS ONE TRIP, THE LEDGER INSIDE IT: the landing costs no round trip the plain upsert did not");
  ok(trips[0].kind === "batch" && /INSERT INTO flows_payload/.test(trips[0].sqls[0]) && /INSERT INTO flows_ledger/.test(trips[0].sqls[1]),
    "a batch of the payload upsert and the ledger's landing row");
  const r = s.row(DAY);
  ok(r.nightly_at > 0 && r.nightly_runs === 1 && Math.abs(r.nightly_at - Date.now()) < 60000, "THE NIGHTLY'S LANDING IS DATED BY ITS SESSION: the row of the session the meta names records when it arrived");
  await post("meta", { sessionDate: DAY, generatedAt: "2026-09-30T03:47:00.000Z" });
  eq(s.row(DAY).nightly_runs, 2, "a later run of the same session counts, keeping the first landing");
  eq(s.row(DAY).nightly_at, r.nightly_at, "as the first instant");
  const other = await post("market", { sessionDate: "2026-09-30" });
  eq(other.status, 200, "another key");
  ok(!s.row("2026-09-30"), "writes no ledger row");
  const junk = await post("meta", { sessionDate: "not-a-day" });
  ok(junk.status === 200 && !s.db.prepare("SELECT 1 FROM flows_ledger WHERE day = 'not-a-day'").get(), "and a meta with no usable session date is stored without a ledger row");
}

{
  const S = "2026-09-24";
  const T = (h, m) => easternInstant(S, h * 60 + m);
  const iso = (ms) => new Date(ms).toISOString();
  const row = (over = {}) => ({
    day: S, ticks: 108,
    tier1: { lastAt: iso(T(17, 56)), gapMs: 5 * MIN, gapEndAt: iso(T(12, 31)), ok: 80, fail: 0, okAt: iso(T(16, 6)), okGapMs: 5 * MIN, okGapEndAt: iso(T(12, 31)) },
    focus: { ok: 80, partial: 1, fail: 0, okAt: iso(T(16, 8)), gapMs: 5 * MIN, gapEndAt: iso(T(12, 33)) },
    tier2: { passes: 83, firstAt: iso(T(9, 31)), lastAt: iso(T(16, 21)), gapMs: 6 * MIN, gapEndAt: iso(T(12, 36)), calls: 3300, failedCalls: 3 },
    stale: { ticks: 0, overS: null, key: null }, nightly: { at: null, runs: 0 }, updatedAt: iso(T(17, 56)),
    ...over,
  });
  const prior = (day, over = {}) => row({ day, nightly: { at: `${day}T21:30:00.000Z`, runs: 1 }, ...over });
  const ledgerOf = (...days) => ({ retainDays: 30, days });
  const good = (ledger) => ({
    sessionDate: S, now: T(20, 5),
    clockRead: { payload: { key: "clock", clock: { day: S, trading: 1, earlyClose: null, closedDays: [],
      tier1: { at: iso(T(17, 56)), okAt: iso(T(16, 6)), why: "written" }, dispatchWhy: null, summaryAt: iso(T(19, 45)) }, ...(ledger ? { ledger } : {}) }, status: 200 },
    marketRead: { payload: { fresh: { readAt: iso(T(16, 6)) } }, status: 200 },
    focusRead: { payload: { key: "live:focus", fresh: { readAt: iso(T(16, 8)) } }, status: 200 },
    heartbeatRead: { payload: { v: 1, key: "live:heartbeat", session: S, run: { calls: 39, failedCalls: 0, finishedAt: iso(T(16, 21)) } }, status: 200 },
  });
  const check = (over, days = [prior("2026-09-22"), prior("2026-09-23")]) => {
    const own = row(over);
    return healthChecks(good(ledgerOf(own, ...days)));
  };
  const H = check({});
  deep(H.failures, [], "A HEALTHY LEDGER PASSES: five-minute gaps everywhere, 83 passes, a nightly that landed the evening before");
  ok(H.notes.some((n) => /^ledger 2026-09-24: 108 tick\(s\); Tier 1 80 ok \/ 0 failed, longest silence 5 min; focus 80 ok \/ 1 partial \/ 0 failed, longest silence 5 min; Tier 2 83 pass\(es\) from 09:31 ET, longest gap 6 min, 3 of 3300 vendor call\(s\) failed; worst lapse none$/.test(n)),
    "and the gate prints the whole day in one line, so the owner sees the baseline every night");
  const bare = healthChecks(good(null));
  ok(bare.failures.length === 0 && bare.notes.includes("the Worker's clock carries no session ledger (a Worker older than this check)"),
    "a Worker with no ledger is a note, not a failure, so the gate can ship before the Worker does");
  const empty = healthChecks(good(ledgerOf()));
  ok(empty.failures.length === 0 && empty.notes.some((n) => /ledger is empty/.test(n)), "and an empty ledger is a note");
  const missing = healthChecks(good(ledgerOf(prior("2026-09-22"), prior("2026-09-23"))));
  ok(missing.failures.length === 1 && /none for 2026-09-24: not one Worker tick was recorded that day/.test(missing.failures[0]),
    "a ledger that holds other days but not the session's says the Worker recorded no tick that day");

  const gapFor = (min) => min * MIN;
  const tickGap = (min) => check({ tier1: { ...row().tier1, gapMs: gapFor(min), gapEndAt: iso(T(11, 31)), okGapMs: gapFor(min) } }).failures;
  deep(tickGap(25), [], "A TIER 1 GAP OF EXACTLY THE STALE LINE (25 min) is not a lapse: the pill goes stale after it, not at it");
  const t26 = tickGap(26);
  eq(t26.length, 1, "AND ONE MINUTE MORE IS: the cron's silence");
  ok(/^HEALTH: the Worker's rth cron did not tick for 26 min inside 2026-09-24's session \(11:05 ET to 11:31 ET\), so live:market and every pill on it crossed the 25 min stale line/.test(t26[0]),
    `naming the interval and the line it crossed (${t26[0].slice(0, 160)})`);
  const okGap = check({ tier1: { ...row().tier1, gapMs: 5 * MIN, okGapMs: gapFor(40), okGapEndAt: iso(T(11, 31)), fail: 7 } }).failures;
  ok(okGap.length === 1 && /^HEALTH: Tier 1 went 40 min without writing live:market \(10:51 ET to 11:31 ET\) although the cron kept ticking \(7 tick\(s\) failed\)/.test(okGap[0]),
    "a cron that kept ticking while the vendor read failed is told apart, with the failed count");
  const focusGap = check({ focus: { ...row().focus, gapMs: gapFor(26), gapEndAt: iso(T(12, 3)) } }).failures;
  ok(focusGap.length === 1 && /^HEALTH: the focus cron went 26 min without writing live:focus \(11:37 ET to 12:03 ET\), past its 25 min stale line \(1 tick\(s\) were partial, 0 failed;/.test(focusGap[0]),
    "THE FOCUS CRON'S GAP is judged on the same line");
  deep(check({ tier2: { ...row().tier2, gapMs: gapFor(45) } }).failures, [], "A TIER 2 GAP OF 45 min is on the Actions class's stale line and passes");
  const t2 = check({ tier2: { ...row().tier2, gapMs: gapFor(46), gapEndAt: iso(T(13, 1)) } }).failures;
  ok(t2.length === 1 && /^HEALTH: Tier 2 went 46 min without a pass \(12:15 ET to 13:01 ET\), past the 45 min stale line: every Actions-written key read stale for 1\+ min of it/.test(t2[0]),
    `and 46 is not (${t2[0] && t2[0].slice(0, 120)})`);
  const friday = check({ tier2: { ...row().tier2, passes: 31, firstAt: iso(easternInstant("2026-09-25", 14 * 60 + 1)), gapMs: gapFor(271), gapEndAt: iso(T(14, 1)) } }).failures;
  ok(friday.length === 1 && /^HEALTH: Tier 2 went 271 min without a pass from the open \(09:30 ET to 14:01 ET\)/.test(friday[0]),
    "THE 25 SEPTEMBER SESSION, which began at 14:01 ET and which the gate passed, is red with its interval named");
  const none = check({ tier2: { ...row().tier2, passes: 0, firstAt: null, lastAt: null, gapMs: 0, gapEndAt: null } }).failures;
  ok(none.length === 1 && /^HEALTH: no Tier 2 pass was recorded for 2026-09-24/.test(none[0]), "a session with no Tier 2 pass at all says so");
  const sparse = check({ tier2: { ...row().tier2, passes: 40 } });
  ok(sparse.failures.length === 0 && sparse.warnings.length === 1 && /^WARNING: Tier 2 made 40 pass\(es\) in 2026-09-24's session against about 83 at one every 5 min; the first came at 09:31 ET$/.test(sparse.warnings[0]),
    "COVERAGE BELOW 70% OF THE EXPECTED PASSES is a warning while the gaps are within the line");
  deep(check({ tier2: { ...row().tier2, passes: 59 } }).warnings, [], "and 59 of 83, above 70%, is not");
  const lapse = check({ stale: { ticks: 3, overS: 900, key: "live:alerts" } });
  ok(lapse.failures.length === 0 && lapse.warnings.length === 1 && /^WARNING: live:alerts was 15 min past its stale line at the Worker's worst check \(3 check\(s\) saw a lapse\)/.test(lapse.warnings[0]),
    "THE WORST KEY LAPSE THE WORKER SAW is a warning that names the key, the minutes and how often");
  ok(lapse.notes.some((n) => /worst lapse live:alerts 15 min$/.test(n)), "and the summary line");

  const first = healthChecks(good(ledgerOf(row({ tier2: { ...row().tier2, gapMs: gapFor(120) } }))));
  ok(first.failures.length === 0 && first.warnings.some((w) => /^WARNING: Tier 2 went 120 min without a pass .*the ledger began this session/.test(w)),
    "ON THE LEDGER'S FIRST DAY a gap is a warning: the session may have begun before the Worker that keeps the ledger was deployed");

  const landed = check({}, [prior("2026-09-22"), prior("2026-09-23")]);
  deep(landed.failures, [], "a previous session whose nightly landed is silent");
  const lost = check({}, [prior("2026-09-22"), { ...prior("2026-09-23"), nightly: { at: null, runs: 0 } }]);
  ok(lost.failures.length === 1 && /^HEALTH: no nightly landed for 2026-09-23: the ledger saw the Worker tick 108 time\(s\) that day and no meta write followed/.test(lost.failures[0]) &&
     /cannot be republished now that a later session has opened/.test(lost.failures[0]),
  "A NIGHTLY THAT NEVER LANDED turns the next session's gate red, naming the session whose archive is lost: no run means no gate on that night, and the ledger is what remembers it");
  const oldest = check({}, [{ ...prior("2026-09-23"), nightly: { at: null, runs: 0 } }]);
  deep(oldest.failures, [], "but not when that session is the ledger's oldest day: the nightly may have landed before the ledger began");
  const holiday = healthChecks({ ...good(ledgerOf(row({ day: "2026-09-08" }), { ...prior("2026-09-04"), nightly: { at: null, runs: 0 } }, prior("2026-09-03"))), sessionDate: "2026-09-08", now: easternInstant("2026-09-08", 20 * 60 + 5) });
  ok(holiday.failures.some((f) => /no nightly landed for 2026-09-04/.test(f)), "the previous TRADING session is the one asked for: 7 September is a holiday, so Tuesday looks back to Friday");

  const late = healthChecks({ ...good(ledgerOf(row({ tier2: { ...row().tier2, gapMs: gapFor(120) } }), prior("2026-09-22"), prior("2026-09-23"))), now: easternInstant("2026-09-25", 3 * 60) });
  ok(!late.applies && late.failures.length === 1 && /^HEALTH: Tier 2 went 120 min/.test(late.failures[0]),
    "A NIGHTLY THAT STARTS AFTER MIDNIGHT ET is still judged: the live rows describe the next day, and the ledger describes the session, so the gap is found where the gate used to skip every live check");
  const off = healthChecks({ ...good(ledgerOf(row({ tier2: { ...row().tier2, gapMs: gapFor(120) } }), prior("2026-09-22"))),
    clockRead: { payload: { key: "clock", clock: { day: S, trading: 1, tier1: { at: iso(T(17, 56)), okAt: null, why: "off" }, summaryAt: iso(T(19, 45)) },
      ledger: ledgerOf(row({ tier2: { ...row().tier2, gapMs: gapFor(120) } })) }, status: 200 } });
  ok(off.why === "live-off" && off.failures.length === 0, "FLOWS_LIVE_MODE off skips the ledger's gaps: the cron ticks and nothing is written on purpose");

  deep(runChecks(null), [], "no run facts, no lines");
  deep(runChecks({ cardsFailed: 0, deadlineSkipped: 0, planned: 200, rostered: 200, rosterWritten: true, enriched: 240 }), [], "a clean night is silent");
  const cards = runChecks({ cardsFailed: 2, deadlineSkipped: 0, planned: 200, rostered: 198, rosterWritten: true, enriched: 240 });
  ok(cards.length === 2 && /^HEALTH: 2 card\(s\) failed to build or publish tonight/.test(cards[0]) && /^HEALTH: the roster lists 198 of the 200 names planned a card tonight \(240 enriched\): 2 card\(s\) never landed/.test(cards[1]),
    "CARDS FAILED and the roster's shortfall against the plan are each a line");
  const deadline = runChecks({ cardsFailed: 0, deadlineSkipped: 12, planned: 200, rostered: 188, rosterWritten: true, enriched: 240 });
  ok(deadline.length === 2 && /^HEALTH: 12 card\(s\) were skipped past the run's deadline/.test(deadline[0]),
    "CARDS SKIPPED PAST THE DEADLINE are one, with the roster shortfall behind it");
  ok(/^HEALTH: the roster was not written/.test(runChecks({ rosterWritten: false, planned: 5, rostered: null })[0]) && runChecks({ rosterWritten: false }).length === 1,
    "and a roster that was not written is one line, not two");
  const hc = healthChecks({ ...good(null), night: { cardsFailed: 1 }, now: easternInstant("2026-09-25", 3 * 60) });
  eq(hc.failures.length, 1, "THE RUN'S OWN FACTS APPLY WHENEVER THE GATE RUNS, on the evening or after midnight, since they describe this run and not today's live rows");
  const gateLines = [];
  const gate = await runHealthGate({ sessionDate: S, now: () => T(20, 5), read: async (key) => ({ clock: good(null).clockRead })[key] || { payload: null, absent: true },
    night: { cardsFailed: 3, deadlineSkipped: 0 }, log: (l) => gateLines.push(l), warn: (l) => gateLines.push(l) });
  ok(gate.failures.some((f) => /3 card\(s\) failed/.test(f)), "runHealthGate hands the run's facts to the checks");
  const dryLines = [];
  const dryHealthy = await runHealthGate({ dry: true, night: { cardsFailed: 0, deadlineSkipped: 0, planned: 136, rostered: 136, rosterWritten: true, enriched: 124 },
    log: (l) => dryLines.push(l), warn: (l) => dryLines.push(l) });
  ok(!dryHealthy.applies && dryHealthy.failures.length === 0 && dryLines.includes("  run facts: 136 planned, 136 rostered, 0 failed, 0 skipped; 0 failure(s)"),
    "A DRY RUN reads no store but still judges the run's own facts, and prints them");
  const dryShort = await runHealthGate({ dry: true, night: { cardsFailed: 0, deadlineSkipped: 0, planned: 136, rostered: 135, rosterWritten: true },
    log: () => {}, warn: (l) => dryLines.push(l) });
  ok(dryShort.failures.length === 1 && /the roster lists 135 of the 136 names planned a card tonight/.test(dryShort.failures[0]) && dryLines.some((l) => /^HEALTH: the roster lists 135 of the 136/.test(l)),
    "and a dry run whose roster is a name short is red, so a wiring fault in the plan is found before a night pays for it");
  const dryBare = await runHealthGate({ dry: true, log: (l) => dryLines.push("bare " + l), warn: () => {} });
  ok(dryBare.failures.length === 0 && !dryLines.some((l) => /^bare .*run facts/.test(l)), "with no run facts a dry run says only that it skipped");
  const pipeline = read("scripts/flows-pipeline.mjs");
  ok(/night: \{\s*cardsFailed: cardsFailed \+ extraFailed, deadlineSkipped: deadlineSkipped \+ extraSkipped,\s*planned: byCard\.size \+ dossierBuilt\.size, rostered: rosterSummary \? rosterSummary\.rostered : null,/.test(pipeline) &&
     /rosterThrew = true;/.test(pipeline) && /rostered: Object\.keys\(built\.payload\.depth\)\.length/.test(pipeline),
    "and the nightly hands it the card counts, the plan and the roster it published");
}

{
  const S = "2026-09-24";
  const T = (h, m) => easternInstant(S, h * 60 + m);
  const iso = (ms) => new Date(ms).toISOString();
  const answer = (status, text = "", headers = {}) => new Response(text, { status, headers: { server: "cloudflare", "cf-ray": "9a0b1c2d3e4f5a60-IAD", ...headers } });
  const base = {
    sessionDate: S, now: T(20, 5),
    clockRead: { payload: { key: "clock", clock: { day: S, trading: 1, earlyClose: null, closedDays: [],
      tier1: { at: iso(T(17, 56)), okAt: iso(T(16, 6)), why: "written" }, dispatchWhy: null, summaryAt: iso(T(19, 45)) } }, status: 200 },
    marketRead: { payload: { fresh: { readAt: iso(T(16, 6)) } }, status: 200 },
    focusRead: { payload: { key: "live:focus", fresh: { readAt: iso(T(16, 8)) } }, status: 200 },
    heartbeatRead: { payload: { v: 1, key: "live:heartbeat", session: S, run: { calls: 39, failedCalls: 0, finishedAt: iso(T(16, 21)) } }, status: 200 },
  };
  const tallied = (n, status = 503, text = "") => {
    const t = refusalTally();
    for (let i = 0; i < n; i++) tallyAnswer(t, answer(status, text, { "cf-ray": `9a0b1c2d3e4f5a6${i}-IAD` }), text);
    return t;
  };
  const with5xx = (n, over = {}, text = "") => {
    const t = tallied(n, 503, text);
    return healthChecks({ ...base, edge403: t.count, edgeKinds: t.kinds, edgeStatuses: t.statuses, retrySpentMs: 6000, ...over });
  };
  deep(with5xx(4).failures, [], "FOUR 5xx ANSWERS ABSORBED BY RETRIES are a note");
  const burst = with5xx(5);
  ok(burst.failures.length === 2 && /^HEALTH: 5 ingest answers were HTTP 5xx \(a burst of 5 or more; retries spent 6 s of the 90 s budget\)$/.test(burst.failures[0]) &&
     /^HEALTH: 5 were HTTP 5xx answers \(503 5;/.test(burst.failures[1]),
  "A FIFTH IS A BURST WITH ITS OWN RED LINE, well under the 60 s of retry budget the gate waited on before: the nightly of an unhealthy Worker or D1 no longer scrolls past green");
  const quota = with5xx(6, {}, JSON.stringify({ error: { code: "store_quota", message: "The store's daily limit is spent" } }));
  ok(quota.failures.length === 3 && quota.failures.some((f) => f.includes("carried the Worker's own store_quota: " + D1_QUOTA)),
    "and a run of the Worker's own store_quota answers names the Free plan's daily cap, its 00:00 UTC reset and the row-read ceilings that guard it");
  ok(/5,000,000 rows read a day/.test(D1_QUOTA) && /100,000 rows written/.test(D1_QUOTA), "beside the write cap");
  const t = tallied(2, 503, JSON.stringify({ error: { code: "store_quota", message: "x" } }));
  deep(t.statuses[503].worker, { store_quota: 2 }, "the tally keeps the Worker's own code for a 5xx");
  ok(!Object.hasOwn(tallied(2, 503, "").statuses[503], "worker"), "and adds nothing to an answer that has none");
  ok(HEALTH.burst5xx === 5, "the burst is five answers");
}

{
  globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };
  const token = "quota-ingest-token-abcdefghijklmnopqrstuvwxyz";
  const worker = (await import("../worker.js?ledger=quota")).default;
  const quotaError = new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Please upgrade to Workers Paid or wait until midnight UTC. (7500)");
  const broken = (error) => ({ prepare: () => ({ bind() { return this; }, first: async () => { throw error; }, all: async () => { throw error; }, run: async () => { throw error; } }),
    batch: async () => { throw error; } });
  const post = (error) => worker.fetch(new Request("https://anilkaya.org/api/flows/ingest?key=market",
    { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ sessionDate: DAY }) }),
  { DB: broken(error), FLOWS_INGEST_TOKEN: token, SESSION_SECRET: "quota-session-secret-abcdefghijklmnopqrstuvwxyz" }, { waitUntil() {} });
  const realError = console.error;
  const realWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  let quota, other;
  try {
    quota = await post(quotaError);
    other = await post(new Error("D1_ERROR: SQLITE_BUSY"));
  } finally { console.error = realError; console.warn = realWarn; }
  const body = await quota.json();
  ok(quota.status === 503 && body.error.code === "store_quota" && quota.headers.get("Cache-Control") === "no-store",
    "A D1 QUOTA ERROR IS THE WORKER'S OWN store_quota, not an anonymous 500: the answer the gate counts and the pipeline waits on");
  const retry = Number(quota.headers.get("Retry-After"));
  const now = Date.now();
  const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  ok(retry >= 60 && Math.abs(retry - (midnight - now) / 1000) < 5, `with Retry-After the seconds to 00:00 UTC, when D1's day rolls over (${retry})`);
  ok(other.status === 500 && (await other.json()).error.code === "internal_error", "while any other store error stays the 500 it was");
}

{
  const quotaBody = JSON.stringify({ error: { code: "store_quota", message: "spent" } });
  const res = (status, retryAfter) => new Response(quotaBody, { status, headers: retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) } });
  const margin = QUOTA_WAIT.marginMs;
  eq(storeQuotaWait(res(503, 300), quotaBody), 300000 + margin, "A QUOTA ANSWER WITH A RESET WITHIN THE WAIT'S CAP is waited out, to the reset plus a margin");
  eq(storeQuotaWait(res(503, 600), quotaBody, { now: Date.UTC(2026, 8, 30, 12), firstAt: Date.UTC(2026, 8, 30, 12) - 600000 }), null,
    "but not when the wait would run past twenty minutes from the run's first quota answer: the cap is on the run, not on each key");
  eq(storeQuotaWait(res(503, 1200 - margin / 1000), quotaBody), 1200000, "and the cap is inclusive");
  eq(storeQuotaWait(res(503, 5 * 3600), quotaBody), null, "a reset hours away is a failure at once, not a night spent asleep");
  eq(storeQuotaWait(res(503), quotaBody), null, "an answer with no Retry-After is not waited on");
  eq(storeQuotaWait(res(500, 60), quotaBody), null, "nor is a 500");
  eq(storeQuotaWait(res(503, 60), JSON.stringify({ error: { code: "unavailable", message: "x" } })), null, "nor is any other code from the Worker");
  eq(storeQuotaWait(res(503, 60), "<html>Service Unavailable</html>"), null, "nor an edge's own page");
  eq(storeQuotaWait(null, quotaBody), null, "nor no answer");
  const M = Date.UTC(2026, 9, 1);
  const lag = { lagStep: QUOTA_WAIT.lagStepMs, window: QUOTA_WAIT.lagWindowMs };
  eq(storeQuotaWait(res(503, 50), quotaBody, { now: M - 50000, firstAt: M - 50000 }), 50000 + margin, "the first answer at 23:59:10 UTC waits to 00:00:00 plus the margin");
  eq(storeQuotaWait(res(503, 86355), quotaBody, { now: M + 45000, firstAt: M - 50000 }), lag.lagStep,
    "A RESET THAT HAS NOT LANDED BY 00:00:45 IS WAITED FOR ON A SHORT STEP: the same run's second answer carries a Retry-After of a day, and the wait no longer gives up");
  eq(storeQuotaWait(res(503, 86355), quotaBody, { now: M + 45000, firstAt: 0 }), null, "but only for a run that has already waited for a reset: a first answer a day from its reset is a failure");
  eq(storeQuotaWait(res(503, 86355), quotaBody, { now: M + lag.window - 1, firstAt: M - 50000 }), lag.lagStep, "up to the last millisecond of the window after midnight");
  eq(storeQuotaWait(res(503, 86355), quotaBody, { now: M + lag.window, firstAt: M - 50000 }), null, "and not after it: a cap spent ten minutes into the day is spent");
  eq(storeQuotaWait(res(503, 86355), quotaBody, { now: M + 12 * 3600000, firstAt: M - 50000 }), null, "nor at noon");
  const capped = (firstAt) => storeQuotaWait(res(503, 86355), quotaBody, { now: M + 45000, firstAt });
  eq(capped(M + 45000 - 10 * 60000), lag.lagStep, "the steps stay inside the twenty minutes the run may wait: ten minutes into the wait a step is taken");
  eq(capped(M + 45000 + lag.lagStep - QUOTA_WAIT.maxMs), lag.lagStep, "one that ends exactly on the cap is taken");
  eq(capped(M + 45000 + lag.lagStep - QUOTA_WAIT.maxMs - 1), null, "and one a millisecond past it is not");
  eq(storeQuotaWait(res(503, 86355), "<html>x</html>", { now: M + 45000, firstAt: M - 50000 }), null, "a day-away answer that is not the Worker's store_quota is never a lag");
  eq(storeQuotaWait(res(503), quotaBody, { now: M + 45000, firstAt: M - 50000 }), null, "nor one with no Retry-After");
  const pipeline = read("scripts/flows-pipeline.mjs");
  ok(/const quotaWait = !response\.ok && heard \? storeQuotaWait\(response, heard\.text, \{ firstAt: quotaFirstAt \}\) : null;\s*if \(quotaWait !== null\) \{[\s\S]*?ingestWrites\.defer\(quotaWait\);\s*await sleep\(quotaWait\);\s*attempt--;\s*continue;/.test(pipeline),
    "and the write loop takes that wait before the generic retry, defers every other writer with it, and does not spend a retry on it");
}

console.log(`flows-ledger-contract: ${checks} checks passed`);
