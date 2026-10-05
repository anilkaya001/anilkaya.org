import assert from "node:assert/strict";
import { FLOWS_COOKIE, FLOWS_USERNAMES, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import * as W from "../shared/flows-live-worker.js";
import { MARKET_INDICES } from "../shared/markets.js";
import { easternInstant } from "../shared/flows-freshness.js";
import * as NEURON from "../shared/flows-neuron.js";
import { workerSource, expect } from "./lib/source-scan.mjs";
import { guardAi, assertAiGuarded, aiGuardStats } from "./lib/ai-guard.mjs";
import { fakeD1 } from "./lib/d1-fake.mjs";

let checks = 0;
const TIMER_SLACK_MS = 50;
const captureWarn = () => {
  const lines = [];
  const real = console.warn;
  console.warn = (text) => { try { lines.push(JSON.parse(text)); } catch { lines.push(String(text)); } };
  return { lines, stop: () => { console.warn = real; } };
};
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const SESSION_SECRET = "reads-session-secret-abcdefghijklmnopqrstuvwxyz";
globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const FIXTURE_NOW = "2026-09-25T13:00:00.000Z";
function shiftClock(baseIso) {
  const Real = Date;
  const offset = Real.parse(baseIso) - Real.now();
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  };
  return () => { globalThis.Date = Real; };
}

let instance = 0;
async function client(D1, extra = {}) {
  const env = { DB: D1, SESSION_SECRET, FLOWS_READ_MODE: "off", FLOWS_CREDENTIALS: JSON.stringify({ [FLOWS_USERNAMES[0]]: "x".repeat(43) }), ...extra };
  if (env.AI) env.AI = guardAi(env.AI);
  const token = await signFlowsSession(FLOWS_USERNAMES[0], env.SESSION_SECRET, 3600, sessionEpoch(env));
  const worker = (await import("../worker.js?reads=" + (++instance))).default;
  return async (route, init = {}) => {
    const background = [];
    const ctx = { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) };
    const req = new Request("https://anilkaya.org" + route,
      { ...init, headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin", ...(init.headers || {}) } });
    const res = await worker.fetch(req, env, ctx);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { res, body, text, settle: () => Promise.all(background) };
  };
}

const INGEST_TOKEN = "reads-ingest-token-abcdefghijklmnopqrstuvwxyz";
async function ingestClient(D1) {
  const env = { DB: D1, SESSION_SECRET, FLOWS_INGEST_TOKEN: INGEST_TOKEN,
    FLOWS_CREDENTIALS: JSON.stringify({ [FLOWS_USERNAMES[0]]: "x".repeat(43) }) };
  const worker = (await import("../worker.js?reads=" + (++instance))).default;
  return async (route) => {
    const req = new Request("https://anilkaya.org" + route, { headers: { Authorization: "Bearer " + INGEST_TOKEN } });
    const res = await worker.fetch(req, env, { waitUntil() {} });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { res, body, text };
  };
}

const isReadingTrip = (t) => t.sqls.some((s) => /FROM flows_dossier_cache/.test(s));
const neuronTrips = (list) => list.filter((t) => !isReadingTrip(t));
const rowsOf = (list) => list.reduce((sum, t) => sum + (t.rows || 0), 0);

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
     "SINGLE-FLIGHT SCHEMA: thirteen concurrent requests on a cold isolate run the twelve-statement schema batch once, " +
     "not once each (the investigation counted 17 redundant batches per cold home load, when the page made 17 requests)");
  eq(f.count(PRAGMA_RE), 1, "and the clock-column PRAGMA of upgradeClockColumns once");
  const schema = f.trips.find((t) => t.sqls.some((s) => SCHEMA_RE.test(s)));
  ok(schema.kind === "batch" && PRAGMA_RE.test(schema.sqls[schema.sqls.length - 1]) && schema.sqls.length === 13 &&
     !f.trips.some((t) => t.kind === "all" && PRAGMA_RE.test(t.sqls[0])),
     "THE PRAGMA RIDES THE SCHEMA BATCH as its last statement, after the CREATE of flows_clock, not a trip of its own after it " +
     "(two sequential trips before any read on a cold isolate before, one now)");
  ok(!f.trips.some((t) => t.sqls.some((s) => /^ALTER TABLE flows_clock/.test(s))), "with no ALTER on a table that already has every column");
  eq(f.trips.filter((t) => t.kind === "first" && /^SELECT \* FROM flows_clock/.test(t.sqls[0])).length, 0,
     "NO ROUTE READS THE CLOCK ON ITS OWN: /api/flows/now carries it inside its batch as the two overlay routes and the live envelope do " +
     "(one sequential clock read before its batch until now)");
  const nowTrip = f.trips.find((t) => t.kind === "batch" && t.sqls.some((s) => /FROM flows_payload WHERE id IN/.test(s)));
  ok(nowTrip && /FROM flows_clock/.test(nowTrip.sqls[nowTrip.sqls.length - 1]), "the clock row is the last statement of the heartbeat's batch");
  eq(f.trips.length, 14, "fourteen trips for the thirteen requests: one schema batch and thirteen reads " +
     "(sixteen before: the PRAGMA and the heartbeat's clock read were trips of their own; twenty for seventeen requests before the page's six live keys became one)");
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
  const failWarn = captureWarn();
  const answers = await Promise.all(["/api/flows/board?side=long", "/api/flows/board?side=watch", "/api/flows/market",
    "/api/flows/events", "/api/flows/scoretrack", "/api/flows/news"].map(get)).finally(failWarn.stop);
  eq(f.count(SCHEMA_RE), 1, "A FAILING SCHEMA BATCH is attempted once for six concurrent callers");
  eq(failWarn.lines.length, 1, `and leaves one log line, not one per caller and not none (${JSON.stringify(failWarn.lines)})`);
  ok(failWarn.lines[0].message === "flows schema bootstrap failed" && /fake D1 refused/.test(failWarn.lines[0].error),
     "naming the bootstrap and the store's own error");
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
  const hangWarn = captureWarn();
  const [first, second] = await Promise.all([
    get("/api/flows/meta"),
    new Promise((r) => setTimeout(r, 50)).then(() => get("/api/flows/market")),
  ]).finally(hangWarn.stop);
  const waited = Date.now() - t0;
  eq(hangWarn.lines.length, 1,
     `A DEAD FLIGHT LEAVES ONE LOG LINE, from the waiter that dropped it; the waiter that joined the retry adds none (${JSON.stringify(hangWarn.lines)})`);
  ok(hangWarn.lines[0].message === "flight abandoned" && hangWarn.lines[0].flight === "schema" && hangWarn.lines[0].abandoned === 1 &&
     hangWarn.lines[0].recovered === true && hangWarn.lines[0].waitMs >= 3500 - TIMER_SLACK_MS,
     `naming the flight, the whole wait and that the retry recovered (${JSON.stringify(hangWarn.lines[0])})`);
  ok(first.res.status === 200 && second.res.status === 200,
     "A FLIGHT THAT NEVER SETTLES DOES NOT TAKE THE ISOLATE WITH IT: in workerd a D1 batch belongs to the request that started it, " +
     "and when that request answers before the batch lands (the chain route's vendor call rejects at once with no key while its card " +
     "read has just started the bootstrap) the promise never settles; every later request awaited it for the life of the isolate " +
     "(flows-chain-contract's bare worker, 300 s to undici's headers timeout, on CI and in the sandbox). Both waiters answer");
  ok(waited >= 3500 - TIMER_SLACK_MS && waited < 6000, `after the 2 s deadline and the 1.5 s retry (${waited} ms), not never`);
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
  const lateWarn = captureWarn();
  const [first, second] = await Promise.all([
    get("/api/flows/meta"),
    new Promise((r) => setTimeout(r, 1900)).then(() => get("/api/flows/market")),
  ]).finally(lateWarn.stop);
  const waited = Date.now() - t0;
  ok(lateWarn.lines.length === 1 && lateWarn.lines[0].flight === "schema" && lateWarn.lines[0].recovered === true,
     `one line again when a late joiner leaves on the sibling's retry (${JSON.stringify(lateWarn.lines)})`);
  ok(first.res.status === 200 && second.res.status === 200 && waited >= 2000 - TIMER_SLACK_MS && waited < 2700,
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
    const marketWarn = captureWarn();
    const [a, b] = await Promise.all([
      get("/api/markets"),
      new Promise((r) => setTimeout(r, 50)).then(() => get("/api/markets")),
    ]).finally(marketWarn.stop);
    const waited = Date.now() - t0;
    ok(marketWarn.lines.length === 1 && marketWarn.lines[0].message === "flight abandoned" && marketWarn.lines[0].flight === "market" &&
       marketWarn.lines[0].abandoned === 1 && marketWarn.lines[0].recovered === false && marketWarn.lines[0].waitMs >= 12000 - TIMER_SLACK_MS,
       `THE DEAD SNAPSHOT REFRESH LEAVES ONE LOG LINE, from the reader that dropped it, and says the retry did not recover: it settled on the empty fallback (${JSON.stringify(marketWarn.lines)})`);
    ok(a.res.status === 200 && b.res.status === 200 && Array.isArray(a.body.quotes) && !a.body.quotes.length && Array.isArray(b.body.quotes) && !b.body.quotes.length,
       "THE MARKET SNAPSHOT'S FLIGHT HAS THE SAME GUARD: with no stored snapshot and a refresh that never settles, both readers answer an empty snapshot");
    ok(waited >= 12000 - TIMER_SLACK_MS && waited < 15000, `after the refresh's own budget of two origins at 5 s (${waited} ms), not never`);
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
  const realFetch = globalThis.fetch;
  let calls = 0;
  const dead = MARKET_INDICES.length;
  const bar = (day) => Date.UTC(2026, 8, day, 13, 30) / 1000;
  const chart = (symbol) => ({ chart: { result: [{
    meta: { currency: "USD", symbol, gmtoffset: -14400, regularMarketPrice: 105, chartPreviousClose: 90, regularMarketTime: Date.UTC(2026, 8, 25, 20, 0) / 1000 },
    timestamp: [21, 22, 23, 24, 25].map(bar),
    indicators: { quote: [{ close: [100, 101, 102, 103, 105] }] },
  }], error: null } });
  globalThis.fetch = (input) => {
    if (++calls <= dead) return new Promise(() => {});
    const symbol = decodeURIComponent(/\/v8\/finance\/chart\/([^?]+)/.exec(String(input))[1]);
    return Promise.resolve(new Response(JSON.stringify(chart(symbol)), { headers: { "Content-Type": "application/json" } }));
  };
  try {
    const get = await client(f.D1, { MARKET_QUOTE_ORIGIN: "http://127.0.0.1:9" });
    const marketWarn = captureWarn();
    const got = await get("/api/markets").finally(marketWarn.stop);
    ok(got.res.status === 200 && got.body.quotes.length === dead && calls === 2 * dead,
       `a dead refresh whose retry reaches the vendor answers the retry's quotes (${got.body.quotes.length} of ${dead})`);
    ok(marketWarn.lines.length === 1 && marketWarn.lines[0].flight === "market" && marketWarn.lines[0].abandoned === 1 &&
       marketWarn.lines[0].recovered === true,
       `and its one log line says the retry recovered, because the refresh itself succeeded (${JSON.stringify(marketWarn.lines)})`);
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
  W.memoClock(null, Date.now());
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
  const get = await client(f.D1);
  await get("/api/flows/meta");
  const route = async (path) => { const n = f.trips.length; const r = await get(path); return { ...r, trips: f.since(n) }; };
  const clockLast = (t) => t.kind === "batch" && /^SELECT \* FROM flows_clock/.test(t.sqls[t.sqls.length - 1]);
  const stale = [
    ["/api/flows/now?n=board:long,board:short,meta,focus", 1, 2, 1],
    ["/api/flows/now?n=card:NVDA&t=NVDA", 1, 2, 1],
    ["/api/flows/now", 1, 1, 0],
    ["/api/flows/tape?t=NVDA", 1, 2, 1],
    ["/api/flows/lk?k=strips", 1, 2, 1],
    ["/api/flows/card?t=PEND", 2, 3, 2],
  ];
  for (const [path, after, before, warmTrips] of stale) {
    W.memoClock(null, 0);
    const cold = await route(path);
    eq(cold.res.status, 200, `${path} answers with the clock memo stale`);
    eq(cold.trips.length, after,
       `WITH THE CLOCK MEMO STALE ${path} costs ${after} trip${after > 1 ? "s" : ""}${before > after ? ", not " + before : ""}: the clock row rides the route's own batch ` +
       `(${cold.trips.map((t) => t.kind + "(" + t.sqls.length + ")").join(", ")})`);
    ok(clockLast(cold.trips[cold.trips.length - 1]) && !cold.trips.some((t) => t.kind === "first" && /FROM flows_clock/.test(t.sqls[0])),
       "as the batch's last statement, never a read of its own");
    ok(!W.clockDue(Date.now()), "and the memo is warm afterwards");
    const warm = await route(path);
    ok(warm.trips.length === warmTrips && !warm.trips.some((t) => t.sqls.some((q) => /FROM flows_clock/.test(q))),
       `so the next ${path} carries no clock statement at all`);
  }
  const phased = await route("/api/flows/now?n=meta");
  ok(phased.body.phase && typeof phased.body.phase.phase === "string" && "clock" in phased.body && "expected" in phased.body,
     "and the heartbeat still answers its phase, clock and expected session from the clock its batch read");
  W.memoClock(null, 0);
  f.fail(/FROM flows_payload WHERE id IN/);
  const gone = await route("/api/flows/now?n=meta");
  ok(gone.res.status === 503 && gone.trips.length === 1 && W.clockDue(Date.now()),
     "A FAILED HEARTBEAT BATCH is the 503 it was, and memoizes no clock it never read");
  f.fail(null);
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
  const unshift = shiftClock(FIXTURE_NOW);
  const f = fakeD1();
  seed(f);
  const get = await client(f.D1);
  await get("/api/flows/meta");
  const route = async (path) => { const n = f.trips.length; const r = await get(path); return { ...r, trips: neuronTrips(f.since(n)) }; };

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
  deep(Object.keys(again.body).sort(), ["claims", "code", "context", "engine", "generatedAt", "guard", "ideas", "llm", "model", "provenance", "read", "refused", "scope", "status", "summary", "tier", "verdict", "verdictWord", "why"],
     "and the summary's shape is the old one plus the three fields of the tier contract (tier, code and why) and the one additive field, read");
  deep([again.body.tier, again.body.code], ["family", null], "a card with no engine block and no board depth is the family tier: state and structure family only");
  ok(/no option chain was priced/.test(again.body.why), "and says why in words");

  const none = await route("/api/flows/summary?t=ZZZZ");
  ok(none.body.status === "absent" && none.body.tier === "none" && none.body.code === "not-covered" && none.trips.length === 2,
     "a name with no card and no universe row is tier none, not pending: the card-and-prior batch, then one batch for the roster's promise and the universe row");
  ok(/not in the nightly universe/.test(none.body.why) && none.body.summary === null && none.body.ideas.length === 0, "with the honest reason and no idea");
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
  unshift();
}

{
  const f = fakeD1();
  seed(f);
  f.put("card:PEND", { ...NIGHTLY, status: "pending" });
  const get = await ingestClient(f.D1);
  await get("/api/flows/ingest?keys=meta");
  const n = f.trips.length;
  const asked = ["card:NVDA", "card-x:NVDA", "hist:NVDA", "card:PEND", "card:ZZZZ", "roster"];
  const r = await get("/api/flows/ingest?keys=" + asked.join(","));
  eq(r.res.status, 200, "the ingest metadata form answers the nightly bearer");
  eq(f.trips.length - n, 1, "THE METADATA PROBE IS ONE TRIP however many keys it names, where the per-key read the nightly " +
     "ran before was one passthrough trip per key, each carrying the whole card");
  ok(f.trips[n].kind === "all" && /^SELECT id, updated_at, length\(payload\) AS bytes, json_extract\(payload, '\$\.sessionDate'\)/.test(f.trips[n].sqls[0]) &&
     f.trips[n].args[0].length === asked.length,
     "one prepared statement, binding every key asked and selecting the payload's length and dates, never the payload");
  const card = r.body.keys["card:NVDA"];
  const cardBytes = JSON.stringify({ ...NIGHTLY, ticker: "NVDA", panels: PANELS, score: 61, conviction: 70 }).length;
  ok(card.present === true && card.sessionDate === SESSION && card.generatedAt === NIGHTLY.generatedAt && card.bytes === cardBytes &&
     card.updatedAt === 1790380000000, `a present card answers its dates, its stored size and its write time (${JSON.stringify(card)})`);
  deep(r.body.keys["card-x:NVDA"], { present: false }, "a key never written is absent");
  deep(r.body.keys["card:PEND"], { present: false }, "and a stored row that says pending is absent, as the single-key read reports it");
  ok(r.body.keys.roster.present === true && r.body.keys.roster.sessionDate === "2020-01-02", "a view key is answered by the same statement");
  eq(Object.keys(r.body.keys).length, asked.length, "every key asked is answered");
}

{
  const f = fakeD1();
  const groups = [{ id: "x", label: "X", kind: "equity", tickers: ["AAA", "BBB", "CCC", "DDD"] }];
  f.put("focus", { sessionDate: "2026-09-22", groups, closes: { AAA: [98, 100], BBB: [1, 2, 200], CCC: [5, null], DDD: [1] } });
  const at = easternInstant("2026-09-23", 10 * 60 + 8);
  const row = (ticker, close, prev) => ({ ticker, date: "2026-09-23", close, prev_close: prev, quote_time: at - 40000 });
  const fetchVendor = async () => ({ data: [row("AAA", "110", null), row("BBB", "220", "199.5"), row("CCC", "50", null), row("DDD", "3", null)] });
  const n = f.trips.length;
  const done = await W.focusTick({ DB: f.D1, UW_API_KEY: "k" }, at, { fetchVendor, log: { error() {} } });
  ok(done.written === true, "the focus tick writes against a real SQLite payload table");
  const trips = f.since(n);
  eq(trips.length, 2, "THE DAY-CHANGE BASE COSTS NO ROUND TRIP: the tick is one batch (the clock, the nightly focus row with its groups, session and last closes, and the held live row) and one write batch");
  ok(trips[0].kind === "batch" && trips[0].sqls.length === 3 && trips[0].sqls[1] === W.FOCUS_NIGHTLY_SQL && trips[1].kind === "batch" &&
     trips[1].sqls.length === 2 && /INSERT INTO flows_live/.test(trips[1].sqls[0]) && /INSERT INTO flows_ledger/.test(trips[1].sqls[1]),
     "in the order the tick has always made them, its one write carrying the day's ledger row beside the live row");
  const nightly = f.db.prepare(W.FOCUS_NIGHTLY_SQL).get();
  deep([nightly.session, JSON.parse(nightly.closes)], ["2026-09-22", { AAA: 100, BBB: 200, CCC: null, DDD: 1 }],
    "the statement returns the payload's session and the LAST element of each name's closes, as SQLite computes them (a null last close is null, a single close is itself)");
  ok(Buffer.byteLength(nightly.closes) < 400 * 4 && !/\[/.test(nightly.closes), "and only those, never the arrays");
  const live = JSON.parse(f.db.prepare("SELECT payload FROM flows_live WHERE id = 'live:focus'").get().payload);
  const ix = (name) => live.fields.indexOf(name);
  deep(["AAA", "BBB", "CCC", "DDD"].map((t) => [live.rows[t][ix("prev")], live.rows[t][ix("chg")]]),
    [[100, 0.1], [199.5, 0.102757], [null, null], [1, 2]],
    "and the written live:focus has AAA and DDD filled from the closes, BBB on the vendor's own prev_close, and CCC (no last close) with a dash");
  deep([live.prevFill.n, live.prevFill.tickers, live.prevFill.date], [2, ["AAA", "DDD"], "2026-09-22"], "with the fill labelled");
  eq(live.fresh.vendorAt, new Date(at - 40000).toISOString().slice(0, 19) + "Z", "and the vendor's newest quote time as the key's vendorAt");
}

{
  const f = fakeD1();
  seed(f);
  const names = Array.from({ length: 670 }, (_, i) => "T" + String(i).padStart(3, "0"));
  names[0] = "NVDA";
  names[1] = "LITE";
  f.put("universe", { ...NIGHTLY, n: names.length, t: names, sectors: ["Technology"], sec: names.map(() => 0),
    units: { px: ["usd", 100] }, cols: { px: names.map(() => 10000) }, pct: { px: names.map(() => 50) } });
  f.put("events", { ...NIGHTLY, rows: Array.from({ length: 120 }, (_, i) => ({ t: "E" + i, d: "2026-09-29", dte: 5, st: i ? "quiet" : "gated" })) });
  for (let i = 0; i < 1200; i++) f.put("card:PAD" + i, { ...NIGHTLY, ticker: "PAD" + i });
  for (const k of ["market", "vol", "breadth", "strips", "strips:series", "focus"]) {
    f.live("live:" + k, { v: 1, key: "live:" + k, fresh: { readAt: "2026-09-25T14:10:00.000Z" } }, Date.parse("2026-09-25T14:10:00.000Z"), "2026-09-25");
  }
  const table = f.db.prepare("SELECT count(*) AS n FROM flows_payload").get().n;
  ok(table > 1000, `the table under test holds ${table} rows, so a route that scanned it would show`);
  const get = await client(f.D1);
  await get("/api/flows/meta");
  W.memoClock({ day: SESSION, closedDays: [] }, Date.now());
  for (const key of ["ideas", "movers", "political", "unusual", "record", "sector:trix"]) f.put(key, { ...NIGHTLY, rows: [] });
  f.put("card-x:NVDA", { ...NIGHTLY, ticker: "NVDA", engine: { v: 1 } });
  f.put("brief", { v: 1, ...NIGHTLY, facts: [], silences: { pending: [], unreadable: [], quiet: [], unavailable: [] } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.origin !== "http://vendor.test") return realFetch(input, init);
    return new Response(JSON.stringify({ data: [] }), { headers: { "Content-Type": "application/json" } });
  };
  const getVendor = await client(f.D1, { UW_API_KEY: "stub-uw-key", UW_BASE: "http://vendor.test" });
  const ASK = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const cost = async (path, { init, vendor = false } = {}) => {
    const n = f.trips.length;
    const r = await (vendor ? getVendor : get)(path, init);
    return { rows: f.rowsRead(n), trips: f.trips.length - n, status: r.res.status };
  };
  const CEILING = [
    ["/api/flows/board?side=long", 1], ["/api/flows/board?side=watch", 1], ["/api/flows/market", 1], ["/api/flows/flowalerts", 3],
    ["/api/flows/events", 1], ["/api/flows/scoretrack", 1], ["/api/flows/sector-premium", 1], ["/api/flows/news", 2],
    ["/api/flows/pulse", 3], ["/api/flows/regime", 1], ["/api/flows/focus", 1], [HOME_LIVE, 6],
    ["/api/flows/now?n=board:long,board:short,meta,focus", 4], ["/api/flows/lk?k=market", 1],
    ["/api/flows/card?t=NVDA", 2], ["/api/flows/hist?t=IDX", 3], ["/api/flows/summary?t=NVDA", 20], ["/api/flows/summary?t=LITE", names.length + 70], ["/api/flows/summary?t=ZZZZ", names.length + 70],
    ["/api/flows/meta", 1], ["/api/flows/universe", 1], ["/api/flows/roster", 1], ["/api/flows/ideas", 3], ["/api/flows/movers", 1],
    ["/api/flows/sectors", 1], ["/api/flows/political", 1], ["/api/flows/unusual", 1], ["/api/flows/record", 1],
    ["/api/flows/card-x?t=NVDA", 2], ["/api/flows/card-x?t=ZZZZ", 3], ["/api/flows/brief", 7], ["/api/flows/ai-usage", 3],
    ["/api/flows/ask", 9, { init: ASK({ question: "what is the market doing" }) }],
    ["/api/flows/ask", 28, { init: ASK({ question: "what about NVDA", subject: "NVDA" }) }],
    ["/api/flows/live?t=NVDA", 2, { vendor: true }],
    ["/api/flows/chain?t=NVDA", 3, { vendor: true, status: 404 }],
    ["/api/flows/strategy?t=NVDA", 3, { vendor: true, status: 502 }],
    ["/api/flows/strategy?t=NVDA&expiry=2026-10-16", 3, { vendor: true }],
    ["/api/flows/dossier?t=NVDA", 20, { vendor: true }], ["/api/flows/dossier?t=LITE", 20, { vendor: true }], ["/api/flows/dossier?t=ZZZZ", 20, { vendor: true }],
  ];
  let home = 0;
  for (const [path, ceiling, opts = {}] of CEILING) {
    const got = await cost(path, opts);
    ok(got.status === (opts.status || 200), `${path} answers ${opts.status || 200} (${got.status})`);
    if (process.env.PRINT_ROWS) console.log(path, got.rows, got.trips);
    ok(got.rows <= ceiling,
      `ROWS READ, ${path}: ${got.rows} in ${got.trips} trip${got.trips > 1 ? "s" : ""}, ceiling ${ceiling} (the fake counts an index search as the rows it returns and a scan ` +
      "as the whole table, so a route that stopped using its primary key shows at once)");
    if (HOME.includes(path)) home += got.rows;
  }
  ok(home <= 30, `THE THIRTEEN HOME READS TOGETHER cost ${home} rows, so the 5,000,000-row daily cap holds ${Math.floor(5e6 / home)} cold home loads`);
  const universeScan = names.length + 130;
  const lite = await cost("/api/flows/card?t=LITE");
  const absent = await cost("/api/flows/card?t=ZZZZ");
  const tape = await cost("/api/flows/tape?t=NVDA");
  ok(lite.rows <= universeScan + 120 && absent.rows <= universeScan + 120,
    `the two routes that read the universe name list are the costly ones: a lite card ${lite.rows} rows and an absent one ${absent.rows} ` +
    `(json_each over the ${names.length} names, the sector read by index from the row it found, and the ${120} event rows; an upper bound, since SQLite stops at the first match)`);
  ok(tape.rows <= names.length + 10,
    `and the tape's admission check ${tape.rows}, an upper bound: its UNION ALL stops at the card row, so a covered name reads one row`);
  const worstPage = lite.rows + tape.rows + 20;
  ok(5e6 / worstPage > 1500, `a cold ticker page of the costliest kind (${worstPage} rows) can be opened ${Math.floor(5e6 / worstPage)} times a day before the read cap`);

  globalThis.fetch = realFetch;
  const routed = new Set(CEILING.map(([path]) => path.split("?")[0]));
  const source = workerSource();
  expect(source, /path === "(\/api\/flows\/[a-z-]+)"/, { min: 20, why: "the Flows read routes are declared somewhere in the Worker's closure" });
  const declared = [...new Set([...source.matchAll(/path === "(\/api\/flows\/[a-z-]+)"/g)].map((m) => m[1]))]
    .filter((path) => !["/api/flows/ingest", "/api/flows/tape"].includes(path));
  const unpriced = declared.filter((path) => !routed.has(path) && !HOME.some((h) => h.startsWith(path)));
  deep(unpriced, [], "EVERY FLOWS READ ROUTE THE WORKER DECLARES HAS A ROWS-READ CEILING: a new route that is not priced here fails, so the read cap can never be spent by a route nobody counted");

  f.db.prepare("DELETE FROM flows_live").run();
  const bare = await cost(HOME_LIVE);
  ok(bare.rows <= 6 && bare.trips === 1, "with the live rows gone the six-key read is still one search, not a scan");
}

class FakeCache {
  constructor() { this.entries = new Map(); this.puts = []; }
  async match(req) {
    const e = this.entries.get(req.url);
    return e ? new Response(e.body, { status: e.status, headers: e.headers }) : undefined;
  }
  async put(req, res) {
    this.puts.push(req.url);
    this.entries.set(req.url, { body: await res.text(), status: res.status, headers: [...res.headers] });
  }
}

{
  const f = fakeD1();
  seed(f);
  f.put("board:long", { ...NIGHTLY, side: "long", rows: [{ t: "NVDA", px: 1 }] });
  const cache = new FakeCache();
  globalThis.caches = { default: cache };
  try {
    const get = await client(f.D1);
    const board = await get("/api/flows/board?side=long");
    await board.settle();
    const key = "https://flows-lastgood.internal/api/flows/board?side=long";
    ok(board.res.status === 200 && cache.puts.length === 1 && cache.puts[0] === key,
      "A SERVED NIGHTLY ROW IS KEPT as the last good copy under a key of its own, off the request's cookie and query");
    const kept = cache.entries.get(key);
    const headerOf = (name) => (kept.headers.find(([k]) => k.toLowerCase() === name) || [])[1];
    ok(headerOf("cache-control") === "public, max-age=86400" && /^\d{13}$/.test(headerOf("x-last-good-at")) && kept.body === board.text,
      "for twenty-four hours, stamped with the instant it was kept, byte for byte");
    await (await get("/api/flows/board?side=long")).settle();
    eq(cache.puts.length, 1, "and once per ten minutes per isolate and key, not on every read: the cache is written by an isolate once, not by a poll");

    f.db.prepare("DELETE FROM flows_payload WHERE id = 'events'").run();
    const pending = await get("/api/flows/events");
    await pending.settle();
    ok(pending.body.status === "pending" && cache.puts.length === 1,
      "a pending answer is never kept: only a response served from a stored row (X-Payload-Updated) is a copy worth serving later");
    const market = await get("/api/flows/market");
    await market.settle();
    eq(cache.puts.length, 2, "while another nightly key is kept the same way");
    f.put("brief", { v: 1, ...NIGHTLY, facts: [], silences: { pending: [], unreadable: [], quiet: [], unavailable: [] } });
    const servedBrief = await get("/api/flows/brief");
    await servedBrief.settle();
    ok(servedBrief.res.status === 200 && Number(servedBrief.res.headers.get("X-Payload-Updated")) > 0 && cache.puts.length === 2,
      "the brief is served from a stored row and still not kept: its age label is computed at serve time, and a copy would call itself fresh");

    f.fail(/FROM flows_payload/);
    const down = await get("/api/flows/board?side=long");
    ok(down.res.status === 200 && down.text === board.text && down.res.headers.get("X-Fresh-State") === "stale" &&
       down.res.headers.get("X-Fresh-Reason") === "store" && down.res.headers.get("Cache-Control") === "no-store" &&
       /^\d{4}-\d\d-\d\dT/.test(down.res.headers.get("X-Fresh-Last-Good")) && !down.res.headers.has("X-Last-Good-At"),
      "AN UNREADABLE STORE serves the last good copy, whole, stamped stale with reason store and the instant it was kept, and never cached downstream");
    const marketDown = await get("/api/flows/market");
    ok(marketDown.res.status === 200 && marketDown.res.headers.get("X-Fresh-Reason") === "store" && marketDown.text === market.text,
      "and the market row the same");
    const cold = await get("/api/flows/regime");
    ok(cold.res.status === 503 && cold.body.error.code === "store_unreadable" && cold.res.headers.get("Retry-After") === "30",
      "a key never kept is the 503 it always was");
    const shortSide = await get("/api/flows/board?side=short");
    ok(shortSide.res.status === 200 && shortSide.body.status === "pending" && shortSide.body.reason === "read-failed" &&
       !shortSide.res.headers.has("X-Fresh-Last-Good"),
      "and a board side never kept says read-failed as before, never another side's copy");
    const brief = await get("/api/flows/brief");
    ok(brief.res.status === 503 && !brief.res.headers.has("X-Fresh-Last-Good"), "so with the store gone it is the 503 it was, not a copy");

    const env = { DB: f.D1, SESSION_SECRET, FLOWS_CREDENTIALS: JSON.stringify({ [FLOWS_USERNAMES[0]]: "x".repeat(43) }) };
    const worker = (await import("../worker.js?reads=" + (++instance))).default;
    const anon = await worker.fetch(new Request("https://anilkaya.org/api/flows/board?side=long"), env, { waitUntil() {} });
    eq(anon.status, 401, "THE COPY NEVER BYPASSES THE SESSION: a request without one is refused before the store is read");

    const entry = cache.entries.get(key);
    const at = entry.headers.findIndex(([k]) => k.toLowerCase() === "x-last-good-at");
    entry.headers[at] = ["x-last-good-at", String(Date.now() - 25 * 3600 * 1000)];
    const old = await get("/api/flows/board?side=long");
    ok(old.res.status === 200 && old.body.status === "pending" && old.body.reason === "read-failed",
      "a copy older than twenty-four hours is not served");
    f.fail(null);
    const back = await get("/api/flows/board?side=long");
    ok(back.res.status === 200 && !back.res.headers.has("X-Fresh-Last-Good") && back.text === board.text,
      "and a readable store answers itself again");
  } finally {
    delete globalThis.caches;
  }
  const bare = await client(f.D1);
  const plain = await bare("/api/flows/board?side=long");
  await plain.settle();
  ok(plain.res.status === 200, "with no Cache API at all (a test bench, a local runtime) nothing is kept and nothing fails");
}

{
  const f = fakeD1();
  seed(f);
  const names = Array.from({ length: 670 }, (_, i) => "T" + String(i).padStart(3, "0"));
  names[0] = "NVDA";
  names[1] = "LITE";
  f.put("universe", { ...NIGHTLY, n: names.length, t: names, sectors: ["Technology"], sec: names.map(() => 0),
    units: { px: ["usd", 100] }, cols: { px: names.map(() => 10000) }, pct: { px: names.map(() => 50) } });
  const cache = new FakeCache();
  globalThis.caches = { default: cache };
  try {
    const get = await client(f.D1);
    await get("/api/flows/meta");
    W.memoClock({ day: SESSION, closedDays: [] }, Date.now());
    const view = async (path) => {
      const n = f.trips.length;
      const r = await get(path);
      await r.settle();
      return { ...r, trips: f.since(n), rows: f.rowsRead(n) };
    };
    const admitKey = (t) => "https://flows-tape-admit.internal/" + t;
    const scans = (v) => v.trips.some((t) => t.sqls.some((q) => /json_each/.test(q)));
    const cold = await view("/api/flows/tape?t=LITE");
    ok(cold.res.status === 200 && cold.trips.length === 1 && scans(cold) && cold.rows > names.length,
      `AN UNCARDED NAME'S FIRST TAPE VIEW runs the admission check once, in the tape's own batch (${cold.rows} rows: the ${names.length}-name universe list)`);
    ok(cache.entries.has(admitKey("LITE")) && cache.entries.get(admitKey("LITE")).body === "1" &&
       /max-age=43200/.test((cache.entries.get(admitKey("LITE")).headers.find(([k]) => k.toLowerCase() === "cache-control") || [])[1] || ""),
      "and keeps the admission for twelve hours, as the classify verdict is kept");
    const now = Date.now();
    f.db.prepare("INSERT OR REPLACE INTO flows_tape (ticker, payload, read_at, session, legs, refreshing_until, last_served) VALUES (?, ?, ?, ?, ?, NULL, ?)")
      .run("LITE", JSON.stringify({ ticker: "LITE", session: SESSION }), now, SESSION, 3, now);
    for (let i = 0; i < 3; i++) {
      const again = await view("/api/flows/tape?t=LITE");
      if (process.env.PRINT_ROWS) console.log("/api/flows/tape?t=LITE refetch", again.rows, again.trips.length);
      ok(again.res.status === 200 && again.body.ticker === "LITE" && again.trips.length === 1 && !scans(again) && again.rows <= 10,
        `ROWS READ PER TAPE REFETCH of an uncarded name: ${again.rows} in ${again.trips.length} trip, ceiling 10, where it was the ${names.length}-name ` +
        "universe list every 60 s: the admission is decided once, not on every poll");
    }
    const unknown = await view("/api/flows/tape?t=ZZZZ");
    ok(unknown.body.status === "pending" && !cache.entries.has(admitKey("ZZZZ")),
      "a name admitted only because nothing could refuse it (no vendor key, no verdict) is never remembered");
    const unknownAgain = await view("/api/flows/tape?t=ZZZZ");
    ok(scans(unknownAgain), "so its next view checks again");
    const elsewhere = new FakeCache();
    globalThis.caches = { default: elsewhere };
    const colo = await view("/api/flows/tape?t=LITE");
    ok(colo.res.status === 200 && colo.body.ticker === "LITE" && scans(colo) && elsewhere.entries.has(admitKey("LITE")),
      "a data centre that never kept the admission checks once, finds the held tape, and keeps it from then on");
    const coloAgain = await view("/api/flows/tape?t=LITE");
    ok(!scans(coloAgain) && coloAgain.rows <= 10, "after which its refetches read the tape row alone");
  } finally {
    delete globalThis.caches;
  }
}

{
  const unshift = shiftClock(FIXTURE_NOW);
  const f = fakeD1();
  seed(f);
  const names = ["NVDA", "LITE", "GATED", "SCRN", "EVNT", "CNFL"];
  const col = (scale, ...v) => v.map((x) => (x === null ? null : Math.round(x * scale)));
  f.put("universe", { ...NIGHTLY, n: names.length, t: names, sectors: ["Technology", "Energy"], sec: [0, 0, 0, 1, 1, 1],
    units: { px: ["usd", 100], iv30: ["vol", 1000], rv20: ["vol", 1000], vrp: ["vol", 1000], ivp: ["pct100", 1], gexAdv: ["fraction", 1e4],
      dex: ["fraction", 100], vanna: ["fraction", 1e4], charm: ["fraction", 10], im5: ["fraction", 1e3], im30: ["fraction", 1e3],
      ed: ["sessions", 1], tilt: ["fraction", 100], dDelta: ["fraction", 1e4] },
    cols: {
      px: col(100, 170, 72.52, 9, 55, 55, 55),
      iv30: col(1000, null, null, null, 0.3, 0.3, 0.3), rv20: col(1000, null, null, null, 0.25, 0.25, 0.25), vrp: col(1000, null, null, null, 0.05, 0.05, 0.05),
      ivp: col(1, null, null, null, 50, 50, 20), gexAdv: col(1e4, null, null, null, 0.03, 0.03, 0.03),
      dex: col(100, null, null, null, 2, 2, 2), vanna: col(1e4, null, null, null, 0.004, 0.004, 0.004), charm: col(10, null, null, null, -3, -3, -3),
      im5: col(1e3, null, null, null, 0.03, 0.03, 0.03), im30: col(1e3, null, null, null, 0.08, 0.08, 0.08),
      ed: col(1, null, null, null, null, 5, null), tilt: col(100, null, null, null, 0.05, 0.05, 0.05), dDelta: col(1e4, null, null, null, 0, 0, 0),
    },
    pct: { gexAdv: [null, null, null, 70, 70, 70] } });
  const cache = new FakeCache();
  globalThis.caches = { default: cache };
  const calls = [];
  const ai = { run: async () => { calls.push(1); return { response: "{}", usage: { prompt_tokens: 1, completion_tokens: 1 } }; } };
  try {
    const get = await client(f.D1, { AI: ai, FLOWS_ASK_MODEL: "@cf/zai-org/glm-4.7-flash", FLOWS_ASK_FALLBACK_MODEL: "", FLOWS_ASK_NEURONS: "5500,36400" });
    await get("/api/flows/meta");
    const route = async (path) => { const n = f.trips.length; const r = await get(path); await r.settle(); const trips = neuronTrips(f.since(n)); return { ...r, trips, rows: rowsOf(trips) }; };

    const scr = await route("/api/flows/summary?t=SCRN");
    ok(scr.body.status === "ok" && scr.body.tier === "screen" && scr.body.code === null && scr.body.engine === false && scr.body.llm === false,
       "A UNIVERSE-ONLY NAME IS NOT PENDING: it gets a reading of the screen tier, status ok, from the universe row");
    ok(scr.body.screen && scr.body.screen.state === "pinned" && scr.body.screen.gamma === "long" && scr.body.screen.premium === "rich" &&
       scr.body.screen.confidence === 1 && scr.body.screen.priced === false && scr.body.why === "no chain read for this name",
       "long gamma, options 20% rich to realised volatility: pinned and rich, confidence one, unpriced, and it says why");
    deep(scr.body.screen.families, NEURON.STATE_STRUCTURES.pinned.rich.preferred, "the families are the consolidated table's row for it");
    ok(scr.body.ideas.length === 0 && scr.body.summary === scr.body.screen.summary && /^Screener read:/.test(scr.body.summary) && /Read from the screener row alone/.test(scr.body.provenance),
       "with the summary and provenance a reader needs");
    eq(scr.trips.length, 2, "two trips: the card row with the prior reading, then one batch for the roster's promise and the universe row");
    ok(scr.trips[1].kind === "batch" && /id = 'roster'/.test(scr.trips[1].sqls[0]) && /id = 'universe'/.test(scr.trips[1].sqls[1]), "in that order, the universe row read once");
    eq(calls.length, 0, "NO MODEL IS CALLED for the screen tier");
    eq(f.db.prepare("SELECT count(*) AS n FROM flows_neuron").get().n, 0, "and nothing is written: no generating marker, no row");
    eq(f.db.prepare("SELECT count(*) AS n FROM flows_ai_usage").get().n, 0, "and no spend is recorded");
    ok(cache.puts.filter((u) => u.includes("flows-screen")).join() === "https://flows-screen.internal/SCRN", "the reading is kept under a key of its own for five minutes");
    const again = await route("/api/flows/summary?t=SCRN");
    const lessRead = (b) => { const { read, ...rest } = b; return JSON.stringify(rest); };
    ok(again.trips.length === 1 && again.rows <= 3 && lessRead(again.body) === lessRead(scr.body),
       `and a second read is the same reading from one trip and ${again.rows} rows: the universe is not scanned again`);
    const kept = cache.entries.get("https://flows-screen.internal/SCRN");
    ok(kept.headers.some(([k, v]) => k.toLowerCase() === "cache-control" && v === "max-age=300"), "with a five-minute life");

    const ev = await route("/api/flows/summary?t=EVNT");
    ok(ev.body.tier === "screen" && ev.body.code === "event.window" && ev.body.screen.idea.kind === "none" && ev.body.screen.families.length === 0,
       "a report five sessions away turns the idea into No position, with a code for it");
    const cf = await route("/api/flows/summary?t=CNFL");
    ok(cf.body.code === "premium.conflict" && cf.body.screen.idea.kind === "none" && /disagree/.test(cf.body.screen.noIdeaReason),
       "and a rich premium at the 20th percentile of its own year is a conflict, No position with the reason");

    const lite = await route("/api/flows/summary?t=LITE");
    ok(lite.body.status === "unavailable" && lite.body.tier === "unpriceable" && lite.body.code === "screen.no-inputs" && lite.body.screen.facts.length === 0,
       "a universe row with a price and no option data is unpriceable, with the reason, and not pending");
    const none = await route("/api/flows/summary?t=ZZZZ");
    ok(none.body.tier === "none" && none.body.status === "absent" && none.body.summary === null, "a name outside the universe is tier none");
    ok(cache.puts.includes("https://flows-screen.internal/ZZZZ"), "and even that answer is kept for the five minutes, so a poll of an unknown name costs one trip");
    eq(calls.length, 0, "still no model call anywhere");

    f.put("card:OLD", { ...NIGHTLY, sessionDate: "2026-09-16", ticker: "OLD", panels: PANELS, score: 61, conviction: 70 });
    const old = await route("/api/flows/summary?t=OLD");
    ok(old.body.status === "ok" && old.body.tier === "expired" && old.body.code === "expired.sessions" && old.body.ideas.length === 0 && old.body.llm === false,
       "A CARD MORE THAN ONE SESSION OLD IS EXPIRED: the facts, no idea");
    ok(/6 sessions before the last close \(2026-09-24\)/.test(old.body.why) && /What it recorded then/.test(old.body.summary) && old.body.context.ticker === "OLD",
       "and it says how old it is, and keeps the card's own facts");
    ok(old.trips.length === 1 && calls.length === 0 && f.db.prepare("SELECT count(*) AS n FROM flows_neuron").get().n === 0,
       "one trip, no model, no generating marker: an expired card costs nothing to answer");
    f.put("card:PREV", { ...NIGHTLY, sessionDate: "2026-09-23", ticker: "PREV", panels: PANELS, score: 61, conviction: 70 });
    const prev = await route("/api/flows/summary?t=PREV");
    ok(prev.body.tier === "family" && prev.body.context.stale === true, "while a card one session behind keeps its tier and its stale cap");

    f.put("card:BRD", { ...NIGHTLY, ticker: "BRD", depth: "board", panels: { ...PANELS, ivSurface: { status: "unavailable", reason: "no chain" } }, score: 61, conviction: 70 });
    const brd = await route("/api/flows/summary?t=BRD");
    ok(brd.body.tier === "unpriceable" && brd.body.code === "chain.absent" && /No option chain was read/.test(brd.body.why),
       "a board card with no engine block and no chain is unpriceable, chain.absent");
    f.put("card:XSC", { ...NIGHTLY, ticker: "XSC", depth: "cross-section", panels: PANELS, score: 61, conviction: 70 });
    const xsc = await route("/api/flows/summary?t=XSC");
    ok(xsc.body.tier === "family" && xsc.body.code === null, "a cross-section card is the family tier");

    f.put("card:ABS", { ...NIGHTLY, ticker: "ABS", panels: PANELS, score: 61, conviction: 70, regime: { labelFrom: "book", labelValue: 1, bookGammaRaw: 1, bookGamma: 1e6, bookShare: 0.5 } });
    await route("/api/flows/summary?t=ABS");
    const abs = await route("/api/flows/summary?t=ABS");
    ok(abs.body.status === "ok" && abs.body.ideas.length === 1 && abs.body.ideas[0].title === "No position" && abs.body.ideas[0].structure === "no position" &&
       /no level that ends it/.test(abs.body.ideas[0].thesis),
       "A FAMILY-TIER CARD WITH A READ BUT UNFINISHED STATE ABSTAINS IN WORDS: long gamma with no level to end it wrote no idea at all before, and now says No position and why");
  } finally {
    delete globalThis.caches;
    unshift();
  }
}


{
  const f = fakeD1();
  seed(f);
  f.put("card:PEND", { ...NIGHTLY, status: "pending" });
  f.put("card:PRU", { ...NIGHTLY, ticker: "PRU", sessionDate: "2026-08-25", generatedAt: "2026-08-25T21:00:00.000Z" });
  f.put("card-x:LEVI", { generatedAt: "2026-09-10T21:00:00.000Z", ticker: "LEVI" });
  f.put("hist:CB", { ...NIGHTLY, ticker: "CB" });
  for (let i = 0; i < 1500; i++) f.put("scores:2020-01-" + String(i).padStart(4, "0"), { rows: [] });
  const get = await ingestClient(f.D1);
  await get("/api/flows/ingest?keys=meta");
  const table = f.db.prepare("SELECT count(*) AS n FROM flows_payload").get().n;
  const n = f.trips.length;
  const listed = await get("/api/flows/ingest?list=card,card-x,hist");
  eq(listed.res.status, 200, "THE STORE'S KEY LISTING answers the nightly bearer");
  eq(f.trips.length - n, 1, "in one trip");
  ok(/MULTI-INDEX OR|SEARCH/.test(f.db.prepare("EXPLAIN QUERY PLAN " + f.trips[n].sqls[0]).all().map((r) => r.detail).join(" ")) &&
     !f.db.prepare("EXPLAIN QUERY PLAN " + f.trips[n].sqls[0]).all().some((r) => /^SCAN flows_payload/.test(r.detail)),
     "that walks the primary key's three prefix ranges and never scans the table");
  ok(f.rowsRead(n) < 30 && table > 1500, `so it reads ${f.rowsRead(n)} rows of a ${table}-row table: the keys it lists, not the archive around them`);
  deep(Object.keys(listed.body.keys).sort(), ["card-x:LEVI", "card:NVDA", "card:PRU", "hist:CB"],
    "every card, card-x and hist row that is not a pending stub, and no other kind");
  deep(listed.body.keys["card:PRU"], { present: true, sessionDate: "2026-08-25", generatedAt: "2026-08-25T21:00:00.000Z", updatedAt: 1790380000000 },
    "each with its session, its generation instant and its write time, and never its payload");
  ok(listed.body.keys["card-x:LEVI"].sessionDate === null && listed.body.keys["card-x:LEVI"].generatedAt === "2026-09-10T21:00:00.000Z" &&
     listed.body.listed === 4 && listed.body.truncated === false, "a row with no session says so and keeps its generation date");
  const one = await get("/api/flows/ingest?list=hist");
  deep(Object.keys(one.body.keys), ["hist:CB"], "one kind may be asked alone");
  eq((await get("/api/flows/ingest?list=board")).res.status, 400, "a kind that is not a ticker key is refused");
  eq((await get("/api/flows/ingest?list=")).res.status, 400, "and an empty list");
  const live = await (async () => {
    const env = { DB: f.D1, SESSION_SECRET, FLOWS_LIVE_TOKEN: "reads-live-token-abcdefghijklmnopqrstuvwxyz",
      FLOWS_CREDENTIALS: JSON.stringify({ [FLOWS_USERNAMES[0]]: "x".repeat(43) }) };
    const worker = (await import("../worker.js?reads=" + (++instance))).default;
    return worker.fetch(new Request("https://anilkaya.org/api/flows/ingest?list=card", { headers: { Authorization: "Bearer " + env.FLOWS_LIVE_TOKEN } }), env, { waitUntil() {} });
  })();
  eq(live.status, 403, "the live credential may not list the nightly's keys");
  f.fail(/FROM flows_payload WHERE \(id >=/);
  const gone = await get("/api/flows/ingest?list=card");
  ok(gone.res.status === 503 && gone.body.error.code === "store_unreadable", "an unreadable store is the 503 the metadata form gives");
  f.fail(null);
}

{
  const f = fakeD1();
  seed(f);
  f.put("card:PEND", { ...NIGHTLY, status: "pending" });
  const many = 2100;
  f.db.exec("BEGIN");
  for (let i = 0; i < many; i++) f.put("card:PAD" + String(i).padStart(4, "0"), { ...NIGHTLY, ticker: "PAD" + i });
  f.db.exec("COMMIT");
  const get = await ingestClient(f.D1);
  await get("/api/flows/ingest?keys=meta");
  const n = f.trips.length;
  const cut = await get("/api/flows/ingest?list=card");
  eq(cut.res.status, 200, "A STORE THAT HOLDS MORE THAN THE LISTING'S CEILING still answers");
  eq(f.trips.length - n, 1, "in one trip");
  eq(Object.keys(cut.body.keys).length, 2000, "with the first 2,000 keys of the 2,100 it holds, never more than the ceiling");
  eq(cut.body.truncated, true, "and says it was cut, so the nightly never mistakes a partial listing for the whole store");
  eq(cut.body.listed, 2000, "counting what it lists");
  ok(f.rowsRead(n) <= 2001 && f.rowsRead(n) >= 2000, `at a cost of ${f.rowsRead(n)} rows read: the ceiling plus the one row that proves the cut, once a night`);
  ok(!("card:PEND" in cut.body.keys), "and a pending stub inside the cut is still not a key");
  const whole = await get("/api/flows/ingest?list=hist");
  ok(whole.body.truncated === false && whole.body.listed === 0, "while a listing under the ceiling says it is whole");
}

{
  const unshift = shiftClock(FIXTURE_NOW);
  const AI_ENV = { FLOWS_ASK_MODEL: "@cf/zai-org/glm-4.7-flash", FLOWS_ASK_FALLBACK_MODEL: "", FLOWS_ASK_NEURONS: "5500,36400" };
  const answer = JSON.stringify({ summary: "NVDA scored 61 this session with conviction 70 of 100.", ideas: [] });
  const rig = (script) => {
    const calls = [];
    return { calls, run: async () => { calls.push(1); return script ? script() : { response: answer, usage: { prompt_tokens: 100, completion_tokens: 40 } }; } };
  };
  const neuronRow = (f) => f.db.prepare("SELECT scope, fingerprint, guard, generated_at, summary FROM flows_neuron WHERE scope = 'ticker:NVDA'").get();
  const plant = (f, fingerprint, guard, generatedAt, summary = "") => f.db.prepare(
    "INSERT OR REPLACE INTO flows_neuron (scope, version, fingerprint, summary, ideas, llm, model, guard, generated_at) VALUES ('ticker:NVDA', 4, ?, ?, '[]', 0, NULL, ?, ?)",
  ).run(fingerprint, summary, guard, generatedAt);

  {
    const f = fakeD1();
    seed(f);
    const ai = rig();
    const get = await client(f.D1, { ...AI_ENV, AI: ai });
    await get("/api/flows/meta");
    f.fail(/INSERT INTO flows_neuron/);
    const gone = await get("/api/flows/summary?t=NVDA");
    await gone.settle();
    ok(gone.body.status === "unavailable" && gone.body.reason === "store" && /none was started/.test(gone.body.note),
       "N-F7: a generating marker that cannot be written answers unavailable, and says none was started");
    eq(ai.calls.length, 0, "and the model is never called: the marker used to fail OPEN, so every request during a store fault paid for a generation nothing could cache");
    f.fail(null);
  }

  {
    const f = fakeD1();
    seed(f);
    const ai = rig();
    const get = await client(f.D1, { ...AI_ENV, AI: ai });
    await get("/api/flows/meta");
    plant(f, "n4.other|ai", "generating", new Date(Date.now() - 20 * 1000).toISOString());
    const live = await get("/api/flows/summary?t=NVDA");
    await live.settle();
    ok(live.body.status === "pending" && ai.calls.length === 0 && neuronRow(f).fingerprint === "n4.other|ai" && neuronRow(f).guard === "generating",
       "N-F9: a live generating marker of ANOTHER fingerprint is not taken over: the reader waits, the model is not called, the row is untouched");
    plant(f, "n4.other|ai", "generating", new Date(Date.now() - 200 * 1000).toISOString());
    const dead = await get("/api/flows/summary?t=NVDA");
    await dead.settle();
    ok(ai.calls.length === 1 && neuronRow(f).guard !== "generating" && neuronRow(f).fingerprint !== "n4.other|ai",
       "while a marker past its 90 seconds is a dead generator's and is taken over");
  }

  {
    const f = fakeD1();
    seed(f);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const ai = rig(async () => { await gate; return { response: answer, usage: { prompt_tokens: 100, completion_tokens: 40 } }; });
    const get = await client(f.D1, { ...AI_ENV, AI: ai });
    await get("/api/flows/meta");
    const first = await get("/api/flows/summary?t=NVDA");
    ok(first.body.status === "pending" && neuronRow(f).guard === "generating", "N-F9: a generation is in flight, its marker on the row");
    const mine = neuronRow(f).fingerprint;
    const later = new Date(Date.now() + 5000).toISOString();
    plant(f, "n4.fresher|ai", "generating", later);
    release();
    await first.settle();
    const row = neuronRow(f);
    ok(row.fingerprint === "n4.fresher|ai" && row.guard === "generating" && row.generated_at === later && row.fingerprint !== mine,
       "and when it finishes after a FRESHER generation has claimed the row its result is dropped, the fresher marker left standing: compare-and-set, not last writer wins");
    plant(f, "n4.older|ai", "unreachable:capacity", new Date(Date.now() - 3600 * 1000).toISOString(), "old");
    const ai2 = rig();
    const get2 = await client(f.D1, { ...AI_ENV, AI: ai2 });
    const third = await get2("/api/flows/summary?t=NVDA");
    await third.settle();
    ok(neuronRow(f).summary.startsWith("NVDA scored 61") && neuronRow(f).fingerprint !== "n4.older|ai",
       "while a finished row older than the generation is replaced by it");
  }

  {
    const f = fakeD1();
    seed(f);
    const ai = rig();
    const get = await client(f.D1, { ...AI_ENV, AI: ai });
    await get("/api/flows/meta");
    const first = await get("/api/flows/summary?t=NVDA");
    await first.settle();
    const read = await get("/api/flows/summary?t=NVDA");
    ok(read.body.status === "ok" && read.body.llm === true && ai.calls.length === 1, "a reading written once is served with no second model call");
    f.put("card:NVDA", { ...NIGHTLY, generatedAt: "2026-09-25T00:40:00.000Z", ticker: "NVDA", panels: PANELS, score: 61, conviction: 70 });
    const again = await get("/api/flows/summary?t=NVDA");
    await again.settle();
    ok(ai.calls.length === 2, "and a card published again (a new generatedAt) is read again");
  }
  unshift();
}

{
  const unshift = shiftClock(FIXTURE_NOW);
  const AI_ENV = { FLOWS_ASK_MODEL: "@cf/zai-org/glm-4.7-flash", FLOWS_ASK_FALLBACK_MODEL: "", FLOWS_ASK_NEURONS: "5500,36400" };
  const block = (ideas, noTrade) => ({
    v: 1, engine: "q1", asOf: "2026-09-24T20:00:00.000Z", spot: 100, atr: 2.5,
    facts: [{ id: "vrp.rel.21", v: 0.18, u: "frac", g: 3 }, { id: "iv.pct.30", v: 0.82, u: "frac", g: 2 }, { id: "level.magnet", v: 100.5, u: "px", g: 2 },
      { id: "gex.book", v: 1.2e6, u: "usdPer1pct", g: 2 }],
    state: { state: "pinned", direction: null, confidence: 2, preferred: ["iron condor"], avoid: ["long straddle"] }, levels: {},
    structures: [{ id: "S1", family: "put-credit-spread", risk: "defined", dir: "bull", expiry: "2026-10-16", dte: 30, sessions: 22,
      legs: [{ type: "P", k: 95, side: -1, qty: 1 }, { type: "P", k: 90, side: 1, qty: 1 }], grade: 3, gradeWhy: [], rules: ["state.pinned", "vrp.rich", "iv.high"],
      prob: { popQ: 0.7, popP: 0.78 }, ev: { q: -3, p: 21, edge: 24 }, maxProfit: 140, maxLoss: -360 }],
    ideas, noTrade,
  });
  const reading = async (engine, reply) => {
    const f = fakeD1();
    seed(f);
    f.put("card:NVDA", { ...NIGHTLY, ticker: "NVDA", panels: PANELS, score: 61, conviction: 70, engine });
    const ai = reply === null ? {} : { AI: { run: async () => ({ response: JSON.stringify(reply), usage: { prompt_tokens: 100, completion_tokens: 20 } }) } };
    const get = await client(f.D1, { ...AI_ENV, ...ai });
    await get("/api/flows/meta");
    const first = await get("/api/flows/summary?t=NVDA");
    await first.settle();
    return (await get("/api/flows/summary?t=NVDA")).body;
  };

  const ranked = await reading(block(["S1"], null), { verdict: "stand-aside", ideas: [] });
  ok(ranked.status === "ok" && ranked.engine === true && ranked.ideas.length === 1 && ranked.ideas[0].structure === "S1" && ranked.ideas[0].from === "engine" &&
     ranked.verdict !== "stand-aside" && ranked.guard === "engine:refused" && ranked.llm === false,
     `N-F2, end to end: a model that answers stand-aside while the engine ranks S1 is refused, and the reader gets the engine's idea and no Stand aside tag (${ranked.verdict}, ${ranked.guard})`);
  ok(/every answer the model gave was refused \(verdict-false\)/.test(ranked.provenance), `and is told so (${ranked.provenance})`);
  deep([ranked.tier, ranked.code, ranked.why], ["priced", null, "Priced by the options engine on this name's own option chain."], "an engine card with ranked ideas is the priced tier");

  const aside = await reading(block([], { code: "candidates.none", closest: null }), { verdict: "stand-aside", ideas: [] });
  ok(aside.status === "ok" && aside.ideas.length === 0 && aside.verdict === "stand-aside" && aside.llm === true && aside.verdictWord === "Stand aside",
     "while the same words are accepted when the engine itself stood aside");
  deep([aside.tier, aside.code, aside.why], ["stand-aside", "candidates.none", "No structure family fits this name's expiries and state."],
    "and an engine that stood aside is the stand-aside tier, carrying the engine's own noTrade code and its plain words");
  ok(/was asked and agreed: the engine’s own verdict is that no structure it priced clears its bar/.test(aside.provenance) && !/no model was asked/.test(aside.provenance),
     `and the provenance says a model was asked, where an empty idea list read as 'no model was asked' (${aside.provenance})`);

  const bare = await reading(block([], { code: "candidates.none", closest: null }), null);
  ok(bare.verdict === "stand-aside" && bare.llm === false && /The engine stands aside: no structure it priced clears its bar/.test(bare.provenance) && !/engine’s own ranking/.test(bare.provenance),
     `and with no model the provenance says the engine stands aside instead of calling an empty list its own ranking (${bare.provenance})`);

  const promoted = await reading(block(["S1"], null), { verdict: "harvest-rich-premium", ideas: [{ structure: "S1", verdict: "harvest-rich-premium", because: ["vrp.rel.21", "iv.pct.30"] }] });
  ok(promoted.llm === true && promoted.ideas.length === 1 && promoted.ideas[0].from === "model" && promoted.ideas[0].structure === "S1" && promoted.verdict === "harvest-rich-premium",
     "and a model that agrees with the engine's ranking, naming facts the structure's rules rest on, is kept");
  const offRules = await reading(block(["S1"], null), { verdict: "harvest-rich-premium", ideas: [{ structure: "S1", verdict: "harvest-rich-premium", because: ["level.magnet", "gex.book"] }] });
  ok(offRules.llm === true && offRules.ideas.length === 1,
     "level.magnet and gex.book are named by the state rule, so that pair is kept too");
  unshift();
}

{
  const unshift = shiftClock(FIXTURE_NOW);
  const RW = await import("../shared/flows-reading-worker.js");
  const AI_ENV = { FLOWS_ASK_MODEL: "@cf/zai-org/glm-4.7-flash", FLOWS_ASK_FALLBACK_MODEL: "", FLOWS_ASK_NEURONS: "5500,36400", FLOWS_READ_MODE: "on" };
  const calls = [];
  const ai = { run: async (model, input) => { calls.push(input.messages[0].content.slice(0, 30)); return { response: "{}", usage: { prompt_tokens: 100, completion_tokens: 10 } }; } };
  const f = fakeD1();
  seed(f);
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await get("/api/flows/meta");
  const cost = async (path) => {
    const n = f.trips.length;
    const r = await get(path);
    const trips = f.since(n);
    const foreground = rowsOf(trips);
    await r.settle();
    return { ...r, trips, rows: foreground, total: rowsOf(f.since(n)), reading: trips.filter((t) => t.args.some((a) => (Array.isArray(a) ? a : [a]).some((x) => typeof x === "string" && x.startsWith("read:")))), dossier: trips.filter(isReadingTrip) };
  };
  const miss = await cost("/api/flows/summary?t=NVDA");
  ok(miss.body.read.status === "generating" && miss.body.read.generated === false, "READING, MISS: the deterministic reading at once, generating");
  ok(miss.dossier.length === 1 && miss.dossier[0].kind === "batch", "the dossier is ONE batch");
  ok(miss.rows <= 22, `rows read before the response by a summary call that finds no reading and starts one: ${miss.rows} (ceiling 22: the card and prior reading, the reading row, the dossier's primary-key batch)`);
  ok(miss.total <= 34, `and ${miss.total} with the background generation's own reads of the day's spend (ceiling 34)`);
  ok(calls.filter((c) => /stock reader/.test(c)).length === 1, "and one model call for the reading, in the background");
  const row = f.db.prepare("SELECT fingerprint FROM flows_neuron WHERE scope = 'read:NVDA'").get();
  ok(row && row.fingerprint.endsWith("|" + RW.readSignature({ ...AI_ENV })), "its row is keyed by the model signature");
  const hit = (guard, llm, shape, at) => f.db.prepare(
    "INSERT OR REPLACE INTO flows_neuron (scope, version, fingerprint, summary, ideas, llm, model, guard, generated_at) VALUES ('read:NVDA', 6, ?, 'x', ?, ?, ?, ?, ?)",
  ).run("d1.any|" + RW.readSignature({ ...AI_ENV }), JSON.stringify({ v: 1, kind: "reading", shape, refused: [] }), llm, AI_ENV.FLOWS_ASK_MODEL, guard, at);
  hit(null, 1, { status: "ready", sections: { identity: null, now: null, drivers: [], tensions: [], unknown: [], watch: [] }, tags: [] }, new Date().toISOString());
  const stored = await cost("/api/flows/summary?t=NVDA");
  ok(stored.body.read.status === "ready" && stored.body.read.held === "floor", "READING, HIT: a stored reading inside the floor is served as ready");
  eq(stored.dossier.length, 0, "with no dossier assembled");
  eq(stored.reading.length, 1, "and ONE read of the reading row");
  ok(stored.rows <= 4, `rows read: ${stored.rows} (ceiling 4: the card, the Neuron's prior row and the reading row)`);
  ok(stored.rows <= 3 + 1, "which is one row more than the summary route's own ceiling of 3 before the reading existed");
  eq(stored.trips.length, 2, "in two trips, concurrent: the Neuron's batch and the reading's lookup");
  console.log(`  reading rows read: miss ${miss.rows} before the response and ${miss.total} with the background generation, hit ${stored.rows}`);
  unshift();
}

ok(assertAiGuarded({ minAllowed: 1 }) >= 1, `EVERY SCRIPTED MODEL CALL CAME THROUGH shared/flows-ai.js (${aiGuardStats().allowed} calls)`);
console.log(`flows-reads-contract: ${checks} checks passed`);
