import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { FLOWS_COOKIE, FLOWS_USERNAMES, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import * as W from "../shared/flows-live-worker.js";
import { MARKET_INDICES } from "../shared/markets.js";

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
  let thrown = null;
  let hang = null;
  let slow = null;
  const reads = /^\s*(SELECT|PRAGMA|WITH)/i;
  const exec = (sql, args) => {
    if (failing && failing.test(sql)) throw new Error("fake D1 refused " + sql.slice(0, 40));
    const st = db.prepare(sql);
    if (reads.test(sql)) return { results: st.all(...args), meta: {} };
    return { results: [], meta: { changes: st.run(...args).changes } };
  };
  const fake = { latencyMs: 1 };
  const trip = (kind, sqls, args, fn) => new Promise((resolve, reject) => setTimeout(() => {
    trips.push({ kind, sqls, args });
    try { resolve(fn()); } catch (error) { reject(error); }
  }, fake.latencyMs));
  const D1 = {
    prepare(sql) {
      const st = { sql, args: [], bind(...a) { st.args = a; return st; },
        first: () => trip("first", [sql], [st.args], () => exec(sql, st.args).results[0] ?? null),
        all: () => trip("all", [sql], [st.args], () => exec(sql, st.args)),
        run: () => trip("run", [sql], [st.args], () => exec(sql, st.args)) };
      return st;
    },
    batch: (list) => {
      const sqls = list.map((s) => s.sql), args = list.map((s) => s.args);
      if (thrown && sqls.some((sql) => thrown.test(sql))) {
        trips.push({ kind: "batch", sqls, args });
        throw new Error("fake D1 threw before suspending on " + sqls[0].slice(0, 40));
      }
      if (hang && sqls.some((sql) => hang.test(sql))) {
        hang = null;
        trips.push({ kind: "batch", sqls, args });
        return new Promise(() => {});
      }
      if (slow && sqls.some((sql) => slow.re.test(sql))) {
        const ms = slow.ms;
        slow = null;
        return new Promise((resolve, reject) => setTimeout(() => trip("batch", sqls, args, () => list.map((s) => exec(s.sql, s.args))).then(resolve, reject), ms));
      }
      return trip("batch", sqls, args, () => list.map((s) => exec(s.sql, s.args)));
    },
  };
  const put = (id, value, at = 1790380000000) => db.prepare(
    "INSERT OR REPLACE INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?)",
  ).run(id, typeof value === "string" ? value : JSON.stringify(value), at);
  const live = (id, value, readAt, session) => db.prepare(
    "INSERT OR REPLACE INTO flows_live (id, payload, read_at, session, cadence_s, source, writer, updated_at) VALUES (?, ?, ?, ?, 300, 'worker', 'worker@rth', ?)",
  ).run(id, JSON.stringify(value), readAt, session, readAt);
  return { D1, db, trips, put, live, fail: (re) => { failing = re; }, throwSync: (re) => { thrown = re; }, hangOnce: (re) => { hang = re; }, slowOnce: (re, ms) => { slow = { re, ms }; }, latency: (ms) => { fake.latencyMs = ms; },
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

const HOME_LIVE = "/api/flows/lk?k=market,vol,breadth,strips,strips:series,focus";
const HOME = [
  "/api/flows/board?side=long", "/api/flows/board?side=watch", "/api/flows/market", "/api/flows/flowalerts", "/api/flows/events",
  "/api/flows/scoretrack", "/api/flows/sector-premium", "/api/flows/news", "/api/flows/pulse", "/api/flows/regime",
  "/api/flows/focus", HOME_LIVE, "/api/flows/now?n=board:long,board:short,meta,focus",
];
const SCHEMA_RE = /^CREATE TABLE IF NOT EXISTS flows_payload/;
const PRAGMA_RE = /^PRAGMA table_info\(flows_clock\)/;

{
  const f = fakeD1();
  seed(f);
  W.memoClock(null, 0);
  const get = await client(f.D1);
  const answers = await Promise.all(HOME.map(get));
  ok(answers.every((a) => a.res.status === 200), "a cold isolate answers all thirteen home-page reads at once");
  eq(f.count(SCHEMA_RE), 1,
     "SINGLE-FLIGHT SCHEMA: thirteen concurrent requests on a cold isolate run the ten-statement schema batch once, " +
     "not once each (the investigation counted 17 redundant batches per cold home load, when the page made 17 requests)");
  eq(f.count(PRAGMA_RE), 1, "and the clock-column PRAGMA of upgradeClockColumns once");
  ok(!f.trips.some((t) => t.sqls.some((s) => /^ALTER TABLE flows_clock/.test(s))), "with no ALTER on a table that already has every column");
  eq(f.trips.filter((t) => t.kind === "first" && /^SELECT \* FROM flows_clock/.test(t.sqls[0])).length, 1,
     "SINGLE-FLIGHT CLOCK: /api/flows/now, the one route left reading the clock on its own, pays one cold miss " +
     "(eight reads before), while the two overlay routes and the live envelope carry it inside their own batch");
  eq(f.trips.length, 16, "sixteen trips for the thirteen requests: one schema batch, one PRAGMA, one clock read and thirteen reads " +
     "(twenty for seventeen requests before the page's six live keys became one)");
  const home = f.trips.find((t) => t.kind === "batch" && /FROM flows_live WHERE id IN/.test(t.sqls[0]));
  ok(home && home.sqls.length === 2 && /FROM flows_clock/.test(home.sqls[1]),
     "THE HOME PAGE'S LIVE KEYS COST ONE TRIP: one batch of the six-key SELECT and, on a cold isolate, the clock row beside it");
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
  const still = f.trips.length;
  await get("/api/flows/meta");
  eq(f.count(SCHEMA_RE, still), 1, "and retries again while it keeps failing");
  f.fail(null);
  const healed = f.trips.length;
  await get("/api/flows/meta");
  eq(f.count(SCHEMA_RE, healed), 1, "until one batch succeeds");
  const ready = f.trips.length;
  await Promise.all([get("/api/flows/meta"), get("/api/flows/market")]);
  eq(f.count(SCHEMA_RE, ready), 0, "after which the schema is ready for good");
}

{
  const f = fakeD1();
  seed(f);
  f.throwSync(SCHEMA_RE);
  const get = await client(f.D1);
  const first = await get("/api/flows/meta");
  ok(first.res.status === 200 && f.count(SCHEMA_RE) === 1, "A BATCH THAT THROWS BEFORE SUSPENDING is attempted once and its caller still answers");
  const retry = f.trips.length;
  await get("/api/flows/meta");
  eq(f.count(SCHEMA_RE, retry), 1,
     "THE FLIGHT CLEARS ON SETTLEMENT, NOT INSIDE ITS BODY: a throw with nothing yet awaited once nulled the field before the " +
     "flight was assigned, leaving a settled promise that every later call awaited and no request ever retried; the second request retries it");
  f.throwSync(null);
  const healed = f.trips.length;
  await get("/api/flows/meta");
  eq(f.count(SCHEMA_RE, healed), 1, "until the batch runs through");
  const ready = f.trips.length;
  await get("/api/flows/market");
  eq(f.count(SCHEMA_RE, ready), 0, "after which the schema is ready");
}

{
  const f = fakeD1();
  seed(f);
  f.hangOnce(SCHEMA_RE);
  f.slowOnce(SCHEMA_RE, 1500);
  const get = await client(f.D1);
  const t0 = Date.now();
  const [first, second] = await Promise.all([
    get("/api/flows/meta"),
    new Promise((r) => setTimeout(r, 50)).then(() => get("/api/flows/market")),
  ]);
  const waited = Date.now() - t0;
  ok(first.res.status === 200 && second.res.status === 200,
     "A FLIGHT THAT NEVER SETTLES DOES NOT TAKE THE ISOLATE WITH IT: in workerd a D1 batch belongs to the request that started it, " +
     "and when that request answers before the batch lands (the chain route's vendor call rejects at once with no key while its card " +
     "read has just started the bootstrap) the promise never settles; every later request awaited it for the life of the isolate " +
     "(flows-chain-contract's bare worker, 300 s to undici's headers timeout, on CI and in the sandbox). Both waiters answer");
  ok(waited >= 3500 && waited < 6000, `after the 2 s deadline and the 1.5 s retry (${waited} ms), not never`);
  eq(f.count(SCHEMA_RE), 2,
     "with the hung batch and exactly one retry shared by the two waiters: the second waiter's own deadline falls while the first " +
     "waiter's retry is still in the air, and it joins that retry because the field no longer holds the flight it timed out on");
  const ready = f.trips.length;
  await get("/api/flows/meta");
  eq(f.count(SCHEMA_RE, ready), 0, "after which the schema is ready");
}

{
  const f = fakeD1();
  seed(f);
  f.hangOnce(SCHEMA_RE);
  const get = await client(f.D1);
  const t0 = Date.now();
  const [first, second] = await Promise.all([
    get("/api/flows/meta"),
    new Promise((r) => setTimeout(r, 1900)).then(() => get("/api/flows/market")),
  ]);
  const waited = Date.now() - t0;
  ok(first.res.status === 200 && second.res.status === 200 && waited >= 2000 && waited < 2700,
     `A LATE JOINER OF A DEAD FLIGHT LEAVES WHEN A SIBLING'S RETRY LANDS: joining at 1.9 s, it answers with the retry at about 2 s (${waited} ms) ` +
     "instead of sitting out its own deadline at 3.9 s");
  eq(f.count(SCHEMA_RE), 2, "and starts no batch of its own");
}

{
  const f = fakeD1();
  seed(f);
  const realFetch = globalThis.fetch;
  let calls = 0;
  const dead = MARKET_INDICES.length;
  globalThis.fetch = () => (++calls <= dead ? new Promise(() => {}) : new Promise((_, reject) => setTimeout(() => reject(new Error("down")), 300)));
  try {
    const get = await client(f.D1, { MARKET_QUOTE_ORIGIN: "http://127.0.0.1:9" });
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      get("/api/markets"),
      new Promise((r) => setTimeout(r, 50)).then(() => get("/api/markets")),
    ]);
    const waited = Date.now() - t0;
    ok(a.res.status === 200 && b.res.status === 200 && Array.isArray(a.body.quotes) && !a.body.quotes.length && Array.isArray(b.body.quotes) && !b.body.quotes.length,
       "THE MARKET SNAPSHOT'S FLIGHT HAS THE SAME GUARD: with no stored snapshot and a refresh that never settles, both readers answer an empty snapshot");
    ok(waited >= 12000 && waited < 15000, `after the refresh's own budget of two origins at 5 s (${waited} ms), not never`);
    eq(calls, 2 * dead, "with the dead refresh and exactly one retry shared by the two readers: the second reader's poll finds the retry in the field and joins it");
    const again = await get("/api/markets");
    ok(again.res.status === 200 && calls === 2 * dead, "and a later reader finds the empty snapshot stored and asks the vendor nothing");
  } finally {
    globalThis.fetch = realFetch;
  }
}

{
  const f = fakeD1();
  seed(f);
  f.latency(400);
  const get = await client(f.D1);
  const t0 = Date.now();
  const chain = await get("/api/flows/chain?t=AAPL");
  const answered = Date.now() - t0;
  ok(chain.res.status === 503 && chain.body.error.code === "chain_unconfigured" && answered < 300,
     `THE CHAIN ROUTE STILL FAILS FAST: with no vendor key it answers before the schema batch it started has landed (${answered} ms of a 400 ms batch)`);
  await chain.settle();
  eq(f.count(SCHEMA_RE), 1, "the batch the card read started beside the vendor call is kept alive through ctx.waitUntil until it lands, so the answer never abandons it");
  f.latency(1);
  const later = f.trips.length;
  const meta = await get("/api/flows/meta");
  ok(meta.res.status === 200 && f.count(SCHEMA_RE, later) === 0, "so the next request finds the schema ready and runs no batch of its own");
}

{
  const f = fakeD1();
  seed(f);
  f.latency(400);
  const get = await client(f.D1);
  const t0 = Date.now();
  const strategy = await get("/api/flows/strategy?t=AAPL&expiry=2026-10-16&engine=1");
  const answered = Date.now() - t0;
  ok(strategy.res.status === 503 && strategy.body.error.code === "chain_unconfigured" && answered < 300,
     `and so does the strategy route with its engine (${answered} ms of a 400 ms batch)`);
  await strategy.settle();
  eq(f.count(SCHEMA_RE), 1, "whose card read is kept alive the same way");
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

  const six = ["market", "vol", "breadth", "strips", "strips:series", "focus"];
  let singles = 0;
  for (const k of six) singles += (await route("/api/flows/lk?k=" + k)).trips.length;
  eq(singles, 6, "SIX LIVE KEYS READ ONE BY ONE ARE SIX TRIPS, each a Worker invocation of its own");
  const many = await route(HOME_LIVE);
  eq(many.trips.length, 1, "asked together they are ONE TRIP");
  ok(many.trips[0].kind === "batch" && many.trips[0].sqls.length === 1 &&
     /^SELECT id, payload, read_at, session, cadence_s, source, writer, updated_at FROM flows_live WHERE id IN \(\?, \?, \?, \?, \?, \?\)$/.test(many.trips[0].sqls[0]),
     "a batch of one SELECT over flows_live with the six ids bound");
  deep(many.trips[0].args[0], six.map((k) => "live:" + k), "in the order asked");
  ok(many.res.status === 200 && many.res.headers.get("Cache-Control") === "no-store" && /^\d{13}$/.test(many.res.headers.get("X-Server-Now")),
     "no-store like the single-key route, with X-Server-Now");
  deep(Object.keys(many.body), ["serverNow", "phase", "keys"], "an envelope of serverNow, phase and keys");
  deep(Object.keys(many.body.keys), six, "keyed by the params as asked");
  ok(many.body.keys.market.status === "ok" && many.body.keys.market.payload.key === "live:market" && many.body.keys.market.updatedAt === liveAt &&
     many.body.keys.market.fresh.state && many.body.keys.market.fresh.updatedAt === liveAt,
     "the held key carries its payload whole, its updatedAt and the heartbeat's fresh entry");
  deep(many.body.keys.vol, { status: "pending", fresh: { state: "pending", reason: "unpublished", klass: "breadth" } },
     "an unwritten key is pending in its class");
  eq(many.res.headers.get("X-Fresh-State"), "pending", "and the aggregate X-Fresh-State is the weakest key's");

  W.memoClock(null, 0);
  const coldMany = await route(HOME_LIVE);
  ok(coldMany.trips.length === 1 && coldMany.trips[0].sqls.length === 2 && /FROM flows_clock/.test(coldMany.trips[0].sqls[1]),
     "WITH THE CLOCK MEMO STALE the clock row rides the envelope's batch as a second statement, still one trip");
  ok(!W.clockDue(Date.now()), "and the memo is warm afterwards");

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
  ok(splitReading.body.status === "pending" && splitReading.trips.length === 3 && splitReading.trips[0].kind === "batch" &&
     splitReading.trips[1].kind === "first" && /FROM flows_payload WHERE id = \?$/.test(splitReading.trips[1].sqls[0]) &&
     splitReading.trips[1].args[0][0] === "card-x:SPLIT" && splitReading.trips[2].kind === "run",
     "and the reading of a split card is its batch, the overflow row read by its card-x key, and the claim");
}

console.log(`flows-reads-contract: ${checks} checks passed`);
