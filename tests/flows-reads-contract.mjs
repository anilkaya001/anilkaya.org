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
  const fake = { latencyMs: 1 };
  const trip = (kind, sqls, fn) => new Promise((resolve, reject) => setTimeout(() => {
    trips.push({ kind, sqls });
    try { resolve(fn()); } catch (error) { reject(error); }
  }, fake.latencyMs));
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
  return { D1, db, trips, put, live, fail: (re) => { failing = re; }, latency: (ms) => { fake.latencyMs = ms; },
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
  f.latency(30);
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

{
  const f = fakeD1();
  seed(f);
  const get = await client(f.D1);
  await get("/api/flows/meta");
  const route = async (path) => { const n = f.trips.length; const r = await get(path); return { ...r, trips: f.since(n) }; };
  const keyed = (t) => t.sqls.map((s) => (/id = 'roster'/.test(s) ? "roster" : /id = 'universe'/.test(s) ? "universe" : /id = 'events'/.test(s) ? "events" : s.slice(0, 20)));

  const absent = await route("/api/flows/card?t=ZZZZ");
  deep(absent.body, { ticker: "ZZZZ", status: "absent", why: "not-covered" }, "a name with no card, no universe row and no vendor key is absent, not covered");
  eq(absent.trips.length, 2, "ONE BATCH DECIDES AN ABSENT CARD: the card row's own read, then a single batch (three sequential trips before)");
  ok(absent.trips[1].kind === "batch" && absent.trips[1].sqls.length === 3, "of three keyed statements");
  deep(keyed(absent.trips[1]), ["roster", "universe", "events"], "the roster's promise, the universe row and the earnings gate, in one trip");

  const lite = await route("/api/flows/card?t=LITE");
  eq(lite.trips.length, 2, "a universe-only name is answered from the same two trips");
  ok(lite.body.status === "ok" && lite.body.lite === true && lite.body.depth === "universe" && lite.body.rank === 2 && lite.body.n === 3 &&
     lite.body.u.px === 72.52 && lite.body.sessionDate === SESSION && lite.body.why === "not-covered",
     `with the lite card decoded by the universe's units (${JSON.stringify(lite.body).slice(0, 140)})`);
  eq(lite.res.headers.get("X-Fresh-Class"), "nightly", "dated like the nightly row it came from");
  const gated = await route("/api/flows/card?t=GATED");
  ok(gated.body.why === "gated" && gated.body.gate.earnings === "2026-09-29" && gated.body.gate.dte === 5, "and the earnings gate still names the report date");

  const hist = await route("/api/flows/hist?t=IDX");
  deep(hist.body, { ticker: "IDX", status: "absent", why: "not-covered" }, "an index has no hist");
  eq(hist.trips.length, 2, "read in two trips");
  deep(keyed(hist.trips[1]), ["roster"], "where the batch carries only the roster: a companion key never runs the universe scan");
  const cardX = await route("/api/flows/card-x?t=PEND");
  ok(cardX.trips.length === 2 && cardX.body.status === "absent", "a stale roster's name reads absent from the same two trips");

  const tape = await route("/api/flows/tape?t=ZZZZ");
  eq(tape.trips.length, 1, "THE TAPE ADMISSION RIDES THE TAPE READ: one batch, where the row and the known-name check were two trips");
  ok(tape.trips[0].kind === "batch" && /FROM flows_tape/.test(tape.trips[0].sqls[0]) && /UNION ALL/.test(tape.trips[0].sqls[1]),
     "the tape row first, the card-or-universe membership second");
  ok(tape.body.status === "pending" && tape.body.why === "unconfigured", "with no vendor key the name is admitted and the tape says unconfigured, as before");
  const held = await route("/api/flows/tape?t=NVDA");
  eq(held.trips.length, 1, "a covered name with no tape row yet costs the same single trip");
}

{
  const f = fakeD1();
  seed(f);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.origin !== "http://vendor.test") return realFetch(input, init);
    calls.push({ path: u.pathname, ticker: u.searchParams.get("ticker"), afterTrips: f.trips.length });
    const data = u.pathname === "/api/screener/stocks" && u.searchParams.get("ticker") === "GLD"
      ? [{ ticker: "GLD", issue_type: "ETF", full_name: "SPDR Gold Shares", sector: null, close: "391.645", prev_close: "392.88",
        iv30d: "0.182", iv_rank: "41.5", implied_move_perc: "0.021", put_call_ratio: "0.8", date: "2026-09-24" }] : [];
    return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const get = await client(f.D1, { UW_API_KEY: "stub-uw-key", UW_BASE: "http://vendor.test" });
    await get("/api/flows/meta");
    const route = async (path) => { const n = f.trips.length; const r = await get(path); return { ...r, trips: f.since(n), at: n }; };
    const lite = await route("/api/flows/card?t=LITE");
    ok(lite.body.lite === true && lite.body.depth === "universe" && calls.length === 0,
       "THE VENDOR IS NEVER ASKED FOR AN ANSWER THE BATCH DECIDED: a universe name costs no screener read");
    const gld = await route("/api/flows/card?t=GLD");
    ok(gld.body.status === "ok" && gld.body.depth === "quote" && gld.body.type === "ETF" && gld.body.u.px === 391.645,
       `a name outside the universe gets its quote card from one screener read (${JSON.stringify(gld.body).slice(0, 120)})`);
    eq(calls.length, 1, "one screener read");
    ok(calls[0].afterTrips === gld.at + 2 && gld.trips.length === 2,
       "made only after the card read and the keyed batch both came back empty, so it never delays an answer the batch already holds");
    const zz = await route("/api/flows/card?t=ZZZZ");
    ok(zz.body.status === "absent" && zz.body.why === "unknown" && calls.length === 2, "a name the vendor does not know is unknown");
    const tape = await route("/api/flows/tape?t=ZZZZ");
    deep(tape.body, { ticker: "ZZZZ", status: "absent", why: "unknown" }, "the tape refuses an unknown name");
    ok(tape.trips.length === 1 && calls.length === 3 && calls[2].afterTrips === tape.at + 1,
       "after its one batch, with the screener asked only because the batch found neither a card nor a universe row");
  } finally {
    globalThis.fetch = realFetch;
  }
}

{
  const f = fakeD1();
  seed(f);
  const get = await client(f.D1);
  await get("/api/flows/meta");
  W.memoClock({ day: SESSION, closedDays: [] }, Date.now());
  const route = async (path) => { const n = f.trips.length; const r = await get(path); return { ...r, trips: f.since(n) }; };

  const plainAlerts = await route("/api/flows/flowalerts");
  ok(plainAlerts.trips.length === 1 && plainAlerts.trips[0].kind === "batch" && plainAlerts.trips[0].sqls.length === 2,
     "AN OVERLAY ROUTE IS ONE TRIP: with the clock memo warm, flowalerts reads its nightly row and its live row in one batch of two");
  ok(plainAlerts.body.status === "quiet" && !plainAlerts.res.headers.get("X-Live-Overlay") && plainAlerts.res.headers.get("X-Payload-Updated") === "1790380000000",
     "and with no live row serves the nightly through, byte for byte, as before");
  const plainPulse = await route("/api/flows/pulse");
  ok(plainPulse.trips.length === 1 && plainPulse.body.totals.calls === 1 && !plainPulse.res.headers.get("X-Live-Overlay"),
     "the pulse likewise");

  const liveAt = Date.parse("2026-09-25T14:10:00.000Z");
  f.live("live:alerts", { v: 1, key: "live:alerts", rows: [{ id: 1 }], fresh: { readAt: "2026-09-25T14:10:00.000Z" } }, liveAt, "2026-09-25");
  f.live("live:market", { v: 1, key: "live:market", session: "2026-09-25", fresh: { readAt: "2026-09-25T14:10:00.000Z" },
    tide: { status: "ok", date: "2026-09-25", t: [liveAt - 60000, liveAt], ncp: [1, 2], npp: [3, 4] } }, liveAt, "2026-09-25");
  const alerts = await route("/api/flows/flowalerts");
  eq(alerts.trips.length, 1, "a live union for a later session is served from the same single trip");
  ok(alerts.res.headers.get("X-Live-Overlay") === "live:alerts" && alerts.body.key === "live:alerts",
     "as the read-time overlay it was before (two trips: the nightly row, then the live row)");
  const pulse = await route("/api/flows/pulse");
  eq(pulse.trips.length, 1, "and the pulse merges today's tide from one trip");
  ok(pulse.res.headers.get("X-Live-Overlay") === "live:market" && pulse.body.refreshed === "intraday" &&
     pulse.body.tide.points.length === 2 && pulse.body.totals.calls === 1,
     "with the live points over the nightly's own feeds");

  W.memoClock(null, 0);
  const cold = await route("/api/flows/pulse");
  ok(cold.trips.length === 1 && cold.trips[0].sqls.length === 3 && /FROM flows_clock/.test(cold.trips[0].sqls[2]),
     "WITH THE CLOCK MEMO STALE the clock row rides the same batch as a third statement, not a trip of its own");
  ok(!W.clockDue(Date.now()), "and the memo is warm afterwards");
  const after = await route("/api/flows/lk?k=market");
  ok(after.trips.length === 1 && !/FROM flows_clock/.test(after.trips[0].sqls[0]), "so the next live read runs no clock read");

  f.fail(/FROM flows_live WHERE/);
  const liveGone = await route("/api/flows/flowalerts");
  ok(liveGone.res.status === 200 && liveGone.body.status === "quiet" && !liveGone.res.headers.get("X-Live-Overlay"),
     "A FAILED BATCH DEGRADES AS THE TWO READS DID: the live side unreadable, the nightly is still served through");
  ok(liveGone.trips.length === 2 && liveGone.trips[1].kind === "first" && /FROM flows_payload/.test(liveGone.trips[1].sqls[0]),
     "by a fallback read of the nightly row alone, the one extra trip paid only on that failure");
  f.fail(/FROM flows_payload WHERE id = \?$/);
  const nightlyGone = await route("/api/flows/pulse");
  ok(nightlyGone.res.status === 503 && nightlyGone.body.status === "unavailable" && nightlyGone.body.error.code === "store_unreadable",
     "while a nightly row that cannot be read is the 503 it always was");
  f.fail(null);
}

{
  const f = fakeD1();
  seed(f);
  const get = await client(f.D1);
  await get("/api/flows/meta");
  const route = async (path) => { const n = f.trips.length; const r = await get(path); return { ...r, trips: f.since(n) }; };

  const card = await route("/api/flows/card?t=NVDA");
  ok(card.trips.length === 1 && card.body.ticker === "NVDA" && card.body.score === 61, "a published card is one read");
  const first = await route("/api/flows/summary?t=NVDA");
  eq(first.body.status, "pending", "THE TICKER READING: its first call finds no prior and starts Neuron");
  ok(first.trips[0].kind === "batch" && first.trips[0].sqls.length === 2 && /id = \?$/.test(first.trips[0].sqls[0]) && /FROM flows_neuron/.test(first.trips[0].sqls[1]),
     "reading the card row and the prior reading in one batch (two sequential trips before)");
  ok(first.trips.length === 2 && first.trips[1].kind === "run" && /INSERT INTO flows_neuron/.test(first.trips[1].sqls[0]),
     "with the generating claim the only other foreground trip, so the route costs 2 trips where it cost 3");
  await first.settle();
  const again = await route("/api/flows/summary?t=NVDA");
  eq(again.body.status, "ok", "once written, the reading is served");
  eq(again.trips.length, 1, "from one trip: the card and the prior come back together and the fingerprint matches");
  ok(typeof again.body.summary === "string" && again.body.summary.includes("NVDA") && again.body.llm === false && again.body.context.ticker === "NVDA",
     `with the deterministic summary of the card's context (${JSON.stringify(again.body).slice(0, 120)})`);
  deep(Object.keys(again.body).sort(), ["claims", "context", "engine", "generatedAt", "guard", "ideas", "llm", "model", "provenance", "refused", "scope", "status", "summary", "verdict", "verdictWord"],
     "and the summary's shape is unchanged");

  const none = await route("/api/flows/summary?t=ZZZZ");
  ok(none.body.status === "pending" && none.trips.length === 1, "a name with no card is pending after the same single batch");
  f.fail(/FROM flows_payload WHERE id = \?$/);
  const gone = await route("/api/flows/summary?t=NVDA");
  ok(gone.body.status === "unavailable" && gone.body.reason === "store", "and a store that cannot be read says unavailable, never that no card was published");
  f.fail(null);

  f.put("card-x:SPLIT", { ...NIGHTLY, ticker: "SPLIT", engine: { v: 1, engine: "q1", structures: [] } });
  f.put("card:SPLIT", { ...NIGHTLY, ticker: "SPLIT", panels: PANELS, engine: { status: "split", key: "card-x:SPLIT", bytes: 1 } });
  const split = await route("/api/flows/card?t=SPLIT");
  ok(split.body.engine && split.body.engine.engine === "q1", "A SPLIT ENGINE POINTER is resolved onto the card");
  eq(split.trips.length, 2, "from the card row already in hand plus the overflow row: the card is no longer read twice");
  const splitReading = await route("/api/flows/summary?t=SPLIT");
  ok(splitReading.body.status === "pending" && splitReading.trips.length === 3 && /card-x:SPLIT/.test(JSON.stringify(splitReading.trips[1])) === false,
     "and the reading of a split card is its batch, the overflow row and the claim");
}

console.log(`flows-reads-contract: ${checks} checks passed`);
