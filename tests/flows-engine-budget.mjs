import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { CAPS, COLD_START, ENGINE_CEILINGS, MEASURED_CEILINGS, TIER2, WEEKDAY, cronStrings, dayFirings, firingCounts, ledger, totals } from "./lib/d1-budget.mjs";
import * as W from "../shared/flows-live-worker.js";
import { RT_BOARDS_SQL, loadRosterFromD1 } from "../shared/flows-rt-hub.js";
import { easternInstant } from "../shared/flows-freshness.js";
import * as FAKE from "../scripts/flows-legs/live-fake.mjs";
import { runLive } from "../scripts/flows-legs/live.mjs";
import { shapeNews } from "../scripts/flows-pipeline.mjs";
import { productionScreenerBody, focusGroupsSample } from "./live-stubs.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const BOARD_ROWS = 60;
const OLD_ESTIMATOR = /json_each\(\s*\w+\.payload\s*,\s*'([^']+)'\s*\)\s+(\w+)/gi;

const boardsOf = (n) => FAKE.fakeBoards({ n });

{
  const sql = RT_BOARDS_SQL;
  eq([...sql.matchAll(OLD_ESTIMATOR)].length, 0, "the roster read names its json_each as json_each(payload, ...) AS r, a form the earlier estimator never matched");
  const f = fakeD1({ latencyMs: 0 });
  const boards = boardsOf(BOARD_ROWS);
  for (const side of ["long", "short", "watch"]) f.put("board:" + side, boards[side]);
  f.put("focus", { v: 1, sessionDate: "2026-09-21", groups: focusGroupsSample(), closes: {} });
  const n = f.trips.length;
  const roster = await loadRosterFromD1({ DB: f.D1 });
  const trips = f.since(n);
  eq(trips.length, 1, "the roster is one trip");
  const rows = f.rowsRead(n);
  ok(roster.boards.long.rows.length === BOARD_ROWS, "and it reads the boards it was given");
  ok(rows >= 3 * BOARD_ROWS, `the counting fake prices its three json_each expansions at ${rows} rows, not the 3 or 4 of the statement's own scans`);
  ok(rows <= MEASURED_CEILINGS.rosterRead, `and the ceiling the budget declares for one load holds: ${rows} <= ${MEASURED_CEILINGS.rosterRead}`);
  ok(rows >= MEASURED_CEILINGS.rosterRead * 0.6, `without being so loose it hides a regression: ${rows} against ${MEASURED_CEILINGS.rosterRead}`);

  const f2 = fakeD1({ latencyMs: 0 });
  f2.put("a", { rows: Array.from({ length: 10 }, (_, i) => i) });
  f2.put("b", { rows: Array.from({ length: 10 }, (_, i) => i) });
  f2.put("c", { rows: Array.from({ length: 10 }, (_, i) => i) });
  f2.put("zz", { rows: Array.from({ length: 400 }, (_, i) => i) });
  const m = f2.trips.length;
  await f2.D1.prepare("SELECT id, (SELECT count(*) FROM json_each(payload, '$.rows') AS r) AS n FROM flows_payload WHERE id IN ('a', 'b', 'c')").all();
  eq(f2.rowsRead(m), 30 + 3, "a json_each AS r inside the select list is priced once for each row it is evaluated for, over the rows the statement names and not the table's largest (30 elements and 3 index lookups)");
}

const day = WEEKDAY;
const at = (hm) => easternInstant(day, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)));

let focusSql = null;
{
  const f = fakeD1({ latencyMs: 0 });
  f.put("focus", { v: 1, sessionDate: "2026-09-21", groups: focusGroupsSample(), closes: {} });
  W.memoClock(null, 0);
  const vendor = async (path, params) => {
    ok(path === "/api/screener/stocks", "the focus tick makes one screener call");
    return productionScreenerBody(String(params.ticker).split(","), { session: day, readAt: at("10:07") });
  };
  const env = { DB: f.D1, UW_API_KEY: "k" };
  await W.focusTick(env, at("10:08"), { fetchVendor: vendor, log: { error() {}, warn() {} } });
  const held = f.db.prepare("SELECT payload FROM flows_live WHERE id = 'live:focus'").get();
  const payload = JSON.parse(held.payload);
  const rows = Object.keys(payload.rows).length;
  const fields = payload.fields.length;
  const pxAt = payload.fields.indexOf("px");
  ok(rows >= 20 && fields >= 20 && pxAt >= 0, `the held focus row has ${rows} names and ${fields} fields, px at ${pxAt}`);
  const n = f.trips.length;
  W.memoClock(null, 0);
  await W.focusTick(env, at("10:13"), { fetchVendor: vendor, log: { error() {}, warn() {} } });
  const priced = f.rowsRead(n);
  ok(priced <= rows + rows * fields + 6 && priced >= rows + rows * fields, `the fake prices the second focus tick's reads at ${priced} rows: the ${rows} names and, for each, the ${fields} fields the nested json_each can scan (the inference was about 530)`);

  let evaluations = 0;
  let visited = 0;
  f.db.function("budget_name", { deterministic: false }, (key) => { visited += key === undefined ? 0 : 1; return 1; });
  f.db.function("budget_field", { deterministic: false }, (value) => { evaluations += value === undefined ? 0 : 1; return 1; });
  focusSql = W.FOCUS_HELD_SQL
    .replace("AS r WHERE ", "AS r WHERE budget_name(r.key) AND ")
    .replace("AS f WHERE f.value", "AS f WHERE budget_field(f.value) AND f.value");
  const answer = f.db.prepare(focusSql).all();
  const exactVisited = visited + evaluations;
  eq(visited, rows, "MEASURED: SQLite visits each held name once");
  eq(evaluations, rows * (pxAt + 1), "MEASURED: and re-runs the inner field scan once per name, stopping at the px field (" + (pxAt + 1) + " fields each)");
  ok(JSON.parse(answer[0].priced).length === rows, "the instrumented statement answers what the real one does");
  ok(exactVisited <= priced, `so the exact scan (${exactVisited} elements) is under the fake's bound (${priced}): the bound is an upper bound`);
  console.log(`  focus held-row query: exact ${exactVisited} elements, fake bound ${priced} rows, ${rows} names, ${fields} fields, px at ${pxAt}`);
  ok(ENGINE_CEILINGS.focus.read >= priced && ENGINE_CEILINGS.focus.read <= priced * 1.1, `the declared focus ceiling (${ENGINE_CEILINGS.focus.read}) is the bound plus the clock and nightly reads`);
}

{
  const nightly = (rows) => ({ v: 1, ticker: "NVDA", sessionDate: "2026-09-21", generatedAt: "2026-09-22T00:10:00.000Z", panels: {}, rows });
  const env = { DB: null, FLOWS_INGEST_TOKEN: "t".repeat(32) };
  const f = fakeD1({ latencyMs: 0 });
  env.DB = f.D1;
  const worker = (await import("../worker.js?budget=ingest")).default;
  const call = async (method, path, body) => {
    const n = f.trips.length;
    const res = await worker.fetch(new Request("https://anilkaya.org" + path, { method,
      headers: { Authorization: "Bearer " + env.FLOWS_INGEST_TOKEN, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    await res.text();
    return { status: res.status, trips: f.trips.length - n, read: f.rowsRead(n), written: f.written(n) };
  };
  await call("POST", "/api/flows/ingest?key=card:NVDA", nightly([]));
  const card = await call("POST", "/api/flows/ingest?key=card:NVDA", nightly([]));
  eq([card.status, card.trips, card.written], [200, 1, MEASURED_CEILINGS.nightlyPostWritten], "a nightly card write is one trip and one row, warm");
  const view = await call("POST", "/api/flows/ingest?key=meta", { v: 1, sessionDate: "2026-09-21", generatedAt: "2026-09-22T00:10:00.000Z" });
  eq([view.status, view.trips, view.written], [200, 1, 2], "the meta write is one trip and two rows: the key and the ledger row");
  const archive = await call("POST", "/api/flows/ingest?key=board:long:2026-09-21", { v: 1, sessionDate: "2026-09-21", rows: [] });
  eq([archive.status, archive.trips, archive.written], [200, 2, 1], "a dated archive key is two trips (the immutability check) and one row");
  const get = await call("GET", "/api/flows/ingest?key=card:NVDA");
  eq([get.status, get.trips, get.read], [200, 1, 1], "a read-back is one trip and one row");
  const del = await call("DELETE", "/api/flows/ingest?key=card:NVDA");
  eq([del.status, del.trips, del.written], [200, 1, 1], "a delete is one trip and one row");
}

const measuredPass = { trips: 0, read: 0, written: 0 };
let coldFirings = 0;
let coldWritten = 0;
let coldTrips = 0;
const stats = {};
const bump = (job, trips, read, written) => {
  const a = (stats[job] ||= { n: 0, trips: 0, read: 0, written: 0, maxTrips: 0, maxRead: 0, maxWritten: 0 });
  a.n++; a.trips += trips; a.read += read; a.written += written;
  a.maxTrips = Math.max(a.maxTrips, trips); a.maxRead = Math.max(a.maxRead, read); a.maxWritten = Math.max(a.maxWritten, written);
};

{
  const f = fakeD1({ latencyMs: 0 });
  const boards = boardsOf(BOARD_ROWS);
  for (const side of ["long", "short", "watch"]) f.put("board:" + side, boards[side]);
  f.put("focus", { v: 1, sessionDate: "2026-09-21", groups: focusGroupsSample(), closes: {} });
  f.put("meta", { v: 1, sessionDate: "2026-09-21" });

  const RealDate = Date;
  let now = 0;
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  };
  const realFetch = globalThis.fetch;
  const realConsole = { error: console.error, warn: console.warn };
  const lines = [];
  let outbound = 0;
  const vendor = () => FAKE.fakeLiveVendor({ session: day, now });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const params = Object.fromEntries(u.searchParams);
    if (u.pathname === "/api/screener/stocks") {
      return new Response(JSON.stringify(productionScreenerBody(String(params.ticker).split(","), { session: day, readAt: now - 20000 })));
    }
    if (u.pathname.startsWith("/api/")) return new Response(JSON.stringify(await vendor()(u.pathname, params, { envelope: true })));
    outbound++;
    return new Response("{}", { status: 503 });
  };
  console.error = (l) => lines.push(String(l));
  console.warn = (l) => lines.push(String(l));
  try {
    const worker = (await import("../worker.js?budget=sim")).default;
    const env = { DB: f.D1, UW_API_KEY: "k" };
    const json = (b, st = 200) => ({ status: st, body: b });
    const readStored = async (key) => {
      if (key.startsWith("board:")) return { payload: boards[key.slice(6)] };
      const row = f.db.prepare("SELECT payload FROM flows_live WHERE id = ?").get(key);
      return { payload: row ? JSON.parse(row.payload) : null };
    };
    let nextPass = at("09:07");
    const firings = dayFirings(cronStrings(), day);
    ok(firings.length === 312, "a weekday is 312 cron firings: " + firings.length);
    for (const firing of firings) {
      while (nextPass <= firing.at && nextPass <= at("16:30")) {
        now = nextPass;
        const n = f.trips.length;
        await runLive({ uw: vendor(), now: () => now, log: () => {}, warn: () => {}, force: true, shapeNews, readStored,
          publish: async (k, p) => { await W.ingestLive(env, k, "POST", JSON.stringify(p), now, { json }); } });
        bump("tier2", f.trips.length - n, f.rowsRead(n), f.written(n));
        nextPass += 15 * 60000;
      }
      now = firing.at;
      W.memoClock(null, 0);
      const n = f.trips.length;
      const background = [];
      await worker.scheduled({ cron: firing.cron, scheduledTime: firing.at }, env, { waitUntil: (p) => background.push(Promise.resolve(p)) });
      await Promise.all(background);
      const cold = f.trips.slice(n).some((t) => t.sqls.some((q) => /^CREATE TABLE IF NOT EXISTS/.test(q)));
      if (cold) { coldFirings++; coldWritten = Math.max(coldWritten, f.written(n)); coldTrips = Math.max(coldTrips, f.trips.length - n); }
      else bump(firing.job, f.trips.length - n, f.rowsRead(n), f.written(n));
    }
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
    console.error = realConsole.error;
    console.warn = realConsole.warn;
  }
  const failedJobs = lines.filter((l) => /flows .* failed/.test(l));
  eq(failedJobs, [], "no cron firing failed");
  ok(outbound >= 1, "the housekeeping firings reached for their market quotes through a refused fetch: " + outbound);

  const counts = firingCounts();
  const coldJob = dayFirings(cronStrings(), day)[0].job;
  eq(coldFirings, 1, "the first firing of a fresh isolate runs the schema bootstrap, once: it is priced apart as a cold start");
  ok(coldWritten <= COLD_START.written && coldTrips <= COLD_START.trips, `a cold start is ${coldTrips} trips and ${coldWritten} rows changed by the fake (DDL statements report the last change count, so this is an upper bound), under its ceiling`);
  for (const job of Object.keys(ENGINE_CEILINGS)) {
    const a = stats[job];
    const c = ENGINE_CEILINGS[job];
    eq(a.n + (job === coldJob ? coldFirings : 0), counts.weekday[job], job + ": every firing of the weekday was driven");
    ok(a.maxTrips <= c.trips && a.maxRead <= c.read && a.maxWritten <= c.written,
      `${job}: no firing exceeds its ceiling (trips ${a.maxTrips}/${c.trips}, rows read ${a.maxRead}/${c.read}, rows written ${a.maxWritten}/${c.written})`);
    const loose = (ceiling, seen) => ceiling <= Math.max(Math.ceil(seen * 1.25), seen + 2);
    ok(loose(c.trips, a.maxTrips) && loose(c.read, a.maxRead) && loose(c.written, a.maxWritten),
      `${job}: and no ceiling is loose enough to hide a regression (${a.maxTrips}, ${a.maxRead}, ${a.maxWritten} seen)`);
    console.log(`  ${job}: ${a.n} firings, ${a.read} rows read, ${a.written} rows written, ${a.trips} trips; worst firing ${a.maxRead} read, ${a.maxWritten} written, ${a.maxTrips} trips`);
  }
  const t2 = stats.tier2;
  eq(t2.n, 30, "tier 2: the simulated session ran 30 fifteen-minute passes, 09:07 to 16:22");
  ok(t2.maxTrips <= TIER2.pass.trips && t2.maxWritten <= TIER2.pass.written && t2.maxRead <= TIER2.pass.read,
    `tier 2: a pass is ${t2.maxTrips} trips and ${t2.maxWritten} rows written, under its ceiling (${TIER2.pass.trips}, ${TIER2.pass.written})`);
  ok(TIER2.pass.written <= Math.max(Math.ceil(t2.maxWritten * 1.25), t2.maxWritten + 2) && TIER2.pass.trips <= Math.max(Math.ceil(t2.maxTrips * 1.25), t2.maxTrips + 2),
    "and the pass ceiling is not loose");
  measuredPass.trips = t2.maxTrips; measuredPass.written = t2.maxWritten; measuredPass.read = t2.maxRead;

  const engineWritten = Object.keys(ENGINE_CEILINGS).reduce((sum, job) => sum + stats[job].written, 0);
  const engineRead = Object.keys(ENGINE_CEILINGS).reduce((sum, job) => sum + stats[job].read + stats[job].written, 0);
  const rows = ledger(counts);
  const declared = rows.filter((r) => /^engines\./.test(r.id)).reduce((t, r) => ({ written: t.written + r.written, read: t.read + r.read }), { written: 0, read: 0 });
  ok(engineWritten <= declared.written && engineRead <= declared.read,
    `the weekday's cron engines, driven for real, wrote ${engineWritten} rows and read ${engineRead} (upserts counted as reads), inside the declared ${declared.written} and ${declared.read}`);
  console.log(`  weekday cron engines, measured: ${engineWritten} rows written, ${engineRead} read; declared ceilings ${declared.written} and ${declared.read}`);
  const all = totals(rows);
  ok(all.written < CAPS.written * 0.2 && all.read < CAPS.read * 0.2,
    `with every other writer and reader declared the weekday is ${all.written} rows written (${(100 * all.written / CAPS.written).toFixed(1)}% of ${CAPS.written}) and ${all.read} read (${(100 * all.read / CAPS.read).toFixed(1)}% of ${CAPS.read})`);
}

ok(!existsSync(new URL("../shared/flows-engine-verdicts.js", import.meta.url)) || Object.hasOwn(ENGINE_CEILINGS, "observer"),
  "the observer is priced the day it exists: shared/flows-engine-verdicts.js and an `observer` ceiling arrive together (P1-25 is not built yet, its allowance is declared in the ledger)");

console.log("flows-engine-budget: " + checks + " checks");
