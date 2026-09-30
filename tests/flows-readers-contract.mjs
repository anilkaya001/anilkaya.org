import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { FLOWS_COOKIE, FLOWS_USERNAMES, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import { easternInstant, sessionClose, phaseAt, FRESH_CLASSES } from "../shared/flows-freshness.js";
import * as L from "../shared/flows-live.js";
import * as W from "../shared/flows-live-worker.js";
import * as FAKE from "../scripts/flows-legs/live-fake.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const SESSION_SECRET = "readers-session-secret-abcdefghijklmnopqrstuvwxyz";
globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const trips = [];
  const reads = /^\s*(SELECT|PRAGMA|WITH)/i;
  const exec = (sql, args) => {
    const st = db.prepare(sql);
    if (reads.test(sql)) return { results: st.all(...args), meta: {} };
    return { results: [], meta: { changes: st.run(...args).changes } };
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
  const put = (id, value, at = 1790380000000) => db.prepare(
    "INSERT OR REPLACE INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?)",
  ).run(id, typeof value === "string" ? value : JSON.stringify(value), at);
  const live = (id, value, readAt, session, cadenceS = 900) => db.prepare(
    "INSERT OR REPLACE INTO flows_live (id, payload, read_at, session, cadence_s, source, writer, updated_at) VALUES (?, ?, ?, ?, ?, 'actions', 'flows-live', ?)",
  ).run(id, JSON.stringify(value), readAt, session, cadenceS, readAt);
  return { D1, db, trips, put, live };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const ET = (day, h, m = 0) => easternInstant(day, h * 60 + m);
const MON = "2026-09-28", TUE = "2026-09-29", WED = "2026-09-30", FRI = "2026-09-25", SAT = "2026-09-26", SUN = "2026-09-27";

function tapeText(ticker, session, premAt, gexAt) {
  const ticks = FAKE.fakeNetPremTicks(ticker, { session, now: Math.min(premAt, sessionClose(session, null)) });
  const prem = L.shapeTapePrem({ ticks, alerts: { data: [] } }, { at: premAt, session, now: premAt });
  if (gexAt === null) return JSON.stringify(L.assembleTape(null, prem, { ticker, session }));
  const spot = FAKE.fakeSpotExposures(ticker, { session, now: Math.min(gexAt, sessionClose(session, null)) });
  const gex = L.shapeTapeGex({ spot }, { at: gexAt, session, now: gexAt });
  return JSON.stringify(L.assembleTape(null, { ...prem, ...gex }, { ticker, session }));
}

function seedTape(f, ticker, { session, premAt, gexAt, legs = 3 }) {
  const payload = tapeText(ticker, session, premAt, legs === 3 ? gexAt : null);
  const read = legs === 3 ? Math.min(premAt, gexAt) : premAt;
  f.db.prepare("INSERT OR REPLACE INTO flows_tape (ticker, payload, read_at, session, legs, refreshing_until, last_served) VALUES (?, ?, ?, ?, ?, NULL, ?)")
    .run(ticker, payload, read, session, legs, read);
}

function sessionAt(now) {
  const p = phaseAt(now, null);
  return p.phase === "closed" && p.session === null ? p.lastClosed : p.session;
}

async function viewTape(f, ticker, now, calls) {
  W.memoClock(null, now);
  const background = [];
  const ctx = { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) };
  const fetchVendor = async (path, params) => {
    calls.push({ path, params });
    const session = sessionAt(now);
    const at = Math.min(now, sessionClose(session, null));
    if (/net-prem-ticks$/.test(path)) return FAKE.fakeNetPremTicks(ticker, { session, now: at });
    if (/flow-alerts$/.test(path)) return { data: [] };
    if (/spot-exposures$/.test(path)) return FAKE.fakeSpotExposures(ticker, { session: params.date, now: Math.min(now, sessionClose(params.date, null)) });
    throw new Error("unexpected " + path);
  };
  const res = await W.serveTape({ DB: f.D1, UW_API_KEY: "k" }, ctx, ticker, now, { fetchVendor, json });
  await Promise.all(background);
  return { how: res.headers.get("X-Tape"), state: res.headers.get("X-Fresh-State"), reason: res.headers.get("X-Fresh-Reason"), body: await res.json() };
}

{
  const f = fakeD1();
  seedTape(f, "GLD", { session: MON, premAt: ET(MON, 10, 58), gexAt: ET(MON, 10, 59) });
  const calls = [];
  const evening = ET(MON, 21, 0);
  const first = await viewTape(f, "GLD", evening, calls);
  eq(first.how, "stale-refreshing",
    "A COMPLETE TAPE READ AT 10:58 ET IS NOT FINAL AT 21:00 ET: the closed phase refreshes a row that stops before its own close " +
    "(it answered 'fresh' with no refresh, all evening and all weekend, while its own header said stale / missed-close)");
  eq(first.state, "stale", "and that first view is still labelled stale, because it is");
  eq(first.reason, "missed-close", "with the reason the classifier gives");
  deep(calls.map((c) => c.path.replace(/^\/api\//, "")), ["stock/GLD/net-prem-ticks", "option-trades/flow-alerts"],
    "the first view refreshes the OLDER leg, the premium one: two vendor calls, as one leg per refresh has always cost");
  const second = await viewTape(f, "GLD", evening + 30000, calls);
  eq(second.how, "stale-refreshing", "the second view still finds the row short of the close, because the other leg is the older now");
  deep(calls.slice(2).map((c) => c.path.replace(/^\/api\//, "")), ["stock/GLD/spot-exposures"], "and refreshes that one: one call");
  const again = await viewTape(f, "GLD", evening + 60000, calls);
  eq(again.how, "fresh", "the third view is served without a vendor call");
  eq(again.state, "closed", "as a closed row");
  eq(again.reason, "session-final", "that covers the session's close");
  eq(calls.length, 3, "THREE VENDOR CALLS IN ALL, ONE LEG PER VIEW: the tape is final and no further call is spent on it");
  const row = f.db.prepare("SELECT legs, read_at, session FROM flows_tape WHERE ticker = 'GLD'").get();
  ok(row.legs === 3 && row.read_at >= sessionClose(MON, null) - FRESH_CLASSES.tape.cadenceS * 1000 && row.session === MON,
    "the stored row is complete, of the closed session, and read after its close");
  const overnight = await viewTape(f, "GLD", ET(TUE, 3, 30), calls);
  eq(overnight.how, "fresh", "and it stays final through the night");
  eq(calls.length, 3, "at no vendor cost");
}

{
  const f = fakeD1();
  seedTape(f, "SLV", { session: FRI, premAt: ET(FRI, 13, 42), gexAt: ET(SAT, 2, 10) });
  const calls = [];
  const sat = await viewTape(f, "SLV", ET(SAT, 12, 0), calls);
  eq(sat.how, "stale-refreshing", "a Saturday view of a tape whose premium leg stops at 13:42 ET on Friday refreshes it");
  const alerts = calls.find((c) => /flow-alerts$/.test(c.path));
  eq(alerts && alerts.params.newer_than, FRI,
    "and asks the alerts feed from FRIDAY, the last session, not from Saturday: a weekend refresh that asked from the weekend " +
    "date would replace Friday's real alerts with an empty leg");
  const after = await viewTape(f, "SLV", ET(SAT, 12, 5), calls);
  eq(after.how, "fresh", "healed in one pass");
  eq(after.state, "closed", "and closed");
  const sun = await viewTape(f, "SLV", ET(SUN, 15, 0), calls);
  const mon = await viewTape(f, "SLV", ET(WED, 3, 0), calls);
  ok(sun.how === "fresh" && calls.length >= 3, "a healed weekend tape is not refreshed again on Sunday");
  ok(mon.how !== undefined, "and the pre-market view of the next weeks is decided by the same rule");
}

{
  const f = fakeD1();
  const THU = "2026-09-24";
  seedTape(f, "ORLY", { session: THU, premAt: ET(THU, 13, 34), legs: 1 });
  const calls = [];
  const evening = ET(TUE, 21, 0);
  const view = await viewTape(f, "ORLY", evening, calls);
  eq(view.how, "stale-refreshing", "a premium-only tape of a session FIVE DAYS back is refreshed on an evening view");
  deep(calls.map((c) => c.path.replace(/^\/api\//, "")), ["stock/ORLY/net-prem-ticks", "option-trades/flow-alerts"],
    "WITH THE PREMIUM LEG FIRST: it dates the new session, where the gamma leg (read for the OLD session, as the row held it) " +
    "spent a vendor call on a session nobody will look at and left the drawn premium path untouched");
  const row = f.db.prepare("SELECT legs, read_at, session FROM flows_tape WHERE ticker = 'ORLY'").get();
  eq(row.session, TUE, "the row now holds the closed session");
  ok(row.read_at >= sessionClose(TUE, null), "read after its close");
  const next = await viewTape(f, "ORLY", evening + 60000, calls);
  eq(next.how, "stale-refreshing", "and its missing gamma leg is read on the next view, as it always was");
  deep(calls.slice(2).map((c) => c.path.replace(/^\/api\//, "")), ["stock/ORLY/spot-exposures"], "one call");
  const done = await viewTape(f, "ORLY", evening + 120000, calls);
  eq(done.how, "fresh", "after which the tape is final");
  eq(calls.length, 3, "for three vendor calls in all, over two views");
}

{
  const f = fakeD1();
  seedTape(f, "AAPL", { session: TUE, premAt: ET(TUE, 10, 0), gexAt: ET(TUE, 10, 0) + 30000 });
  const calls = [];
  const rth = await viewTape(f, "AAPL", ET(TUE, 10, 0) + 60000, calls);
  eq(rth.how, "fresh", "IN SESSION nothing changes: a complete tape read a minute ago is served as it was");
  const later = await viewTape(f, "AAPL", ET(TUE, 10, 5), calls);
  eq(later.how, "stale-refreshing", "and one older than the 60 s tape cadence is refreshed");
  eq(calls.length, 2, "with the one leg it always refreshed in session (2 calls), not the two-leg heal that is reserved for the hours after the close");
}

{
  const f = fakeD1();
  seedTape(f, "MSFT", { session: TUE, premAt: ET(TUE, 15, 58), gexAt: ET(TUE, 15, 58) });
  const calls = [];
  const post = await viewTape(f, "MSFT", ET(TUE, 16, 5), calls);
  eq(post.how, "stale-refreshing",
    "IN THE POST WINDOW a tape read at 15:58 ET is refreshed at 16:05 ET, though it is only seven minutes old: the 15-minute post " +
    "TTL applies to a row that covers the close, not to one that ends before it");
  const other = await viewTape(f, "MSFT", ET(TUE, 16, 6), calls);
  eq(other.how, "stale-refreshing", "the leg it did not read is still short of the close and is refreshed on the next view");
  const covered = await viewTape(f, "MSFT", ET(TUE, 16, 9), calls);
  eq(covered.how, "fresh", "and once both legs are read after the close it keeps the 15-minute TTL");
}

{
  const noPhase = W.tapeTtlMs(null, { legs: 3, read_at: 1, session: TUE }, null);
  eq(noPhase, 0, "no phase means no TTL");
  const phase = phaseAt(ET(TUE, 21, 0), null);
  eq(W.tapeTtlMs(phase, { legs: 1, read_at: ET(TUE, 16, 30), session: TUE }, null), 0, "a one-leg row is never final");
  eq(W.tapeTtlMs(phase, { legs: 3, read_at: ET(TUE, 16, 30), session: TUE }, null), Infinity, "a complete row read after the close is final");
  eq(W.tapeTtlMs(phase, { legs: 3, read_at: ET(TUE, 15, 59, 5), session: TUE }, null), Infinity,
    "and one read inside the 60 s cadence before the close counts as covering it, the classifier's own edge");
  eq(W.tapeTtlMs(phase, { legs: 3, read_at: ET(TUE, 15, 58), session: TUE }, null), 0, "but 15:58 does not");
  eq(W.tapeTtlMs(phase, { legs: 3, read_at: ET(TUE, 16, 30), session: MON }, null), 0, "and a row of an older session is not the closed session's");
  const early = { day: "2026-11-27", trading: 1, earlyClose: 1 };
  const post = phaseAt(ET("2026-11-27", 14, 0), early);
  eq(W.tapeTtlMs(post, { legs: 3, read_at: ET("2026-11-27", 12, 59) + 30000, session: "2026-11-27" }, early), 15 * 60 * 1000,
    "a clock-known early close moves the close to 13:00 ET: a row read at 12:59:30 covers it and takes the post TTL");
  eq(W.tapeTtlMs(post, { legs: 3, read_at: ET("2026-11-27", 12, 30), session: "2026-11-27" }, early), 0,
    "and one read at 12:30 ET does not");
}


const clockNow = { value: ET(TUE, 9, 35) };
const realNow = Date.now;
Date.now = () => clockNow.value;
const at = (ms) => { clockNow.value = ms; W.memoClock(null, ms); };

const caches_ = new Map();
globalThis.caches = { default: {
  async match(req) {
    const e = caches_.get(req.url);
    if (!e) return undefined;
    if (clockNow.value > e.exp) { caches_.delete(req.url); return undefined; }
    return new Response(e.text, { headers: e.headers });
  },
  async put(req, res) {
    const m = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "");
    caches_.set(req.url, { text: await res.text(), headers: [...res.headers], exp: clockNow.value + (m ? Number(m[1]) * 1000 : 0) });
  },
} };

let instance = 0;
async function client(D1, extra = {}) {
  const env = { DB: D1, SESSION_SECRET, UW_API_KEY: "k", UW_BASE: "http://uw.test",
    FLOWS_CREDENTIALS: JSON.stringify({ [FLOWS_USERNAMES[0]]: "x".repeat(43) }), ...extra };
  const worker = (await import("../worker.js?readers=" + (++instance))).default;
  return async (route) => {
    const token = await signFlowsSession(FLOWS_USERNAMES[0], env.SESSION_SECRET, 3600, sessionEpoch(env));
    const background = [];
    const ctx = { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) };
    const req = new Request("https://anilkaya.org" + route,
      { headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin" } });
    const res = await worker.fetch(req, env, ctx);
    const text = await res.text();
    await Promise.all(background);
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { res, body, text };
  };
}

const realFetch = globalThis.fetch;
function vendor(rowFor) {
  const seen = { screener: 0, other: 0 };
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === "/api/screener/stocks") {
      seen.screener++;
      const t = u.searchParams.get("ticker");
      const row = rowFor(t);
      return new Response(JSON.stringify({ data: row ? [row] : [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    seen.other++;
    return new Response("{}", { status: 404 });
  };
  return seen;
}
const screenerRow = (ticker, seed, dated = false) => {
  const row = FAKE.fakeScreenerRows([ticker], { session: TUE + seed }).data[0];
  if (!dated) delete row.date;
  return { ...row, full_name: ticker + " test fund", issue_type: "ETF", sector: null };
};

{
  const f = fakeD1();
  W.memoClock(null, clockNow.value);
  const get = await client(f.D1);
  const seen = vendor((t) => screenerRow(t, "a"));
  at(ET(TUE, 9, 35));
  const first = await get("/api/flows/card?t=TLT");
  eq(first.res.status, 200, "an out-of-universe name opens as a quote card");
  eq(first.body.depth, "quote", "of depth quote");
  eq(seen.screener, 1, "read once from the vendor's screener");
  eq(first.body.generatedAt, new Date(ET(TUE, 9, 35)).toISOString(), "stamped with the moment the row was read");
  eq(first.body.sessionDate, TUE, "and dated by that moment, not by a later one");
  eq(first.res.headers.get("X-Fresh-Class"), "breadth", "IT NOW CARRIES ITS OWN FRESHNESS: the row is a screener read, the breadth class's age rules");
  eq(first.res.headers.get("X-Fresh-State"), "live", "live while it is minutes old");
  eq(first.res.headers.get("X-Fresh-Read-At"), first.body.generatedAt, "and the header names the read instant, not the request's");
  eq(first.res.headers.get("X-Fresh-Source"), "ondemand", "of an on-demand read");

  at(ET(TUE, 9, 45));
  const second = await get("/api/flows/card?t=TLT");
  eq(seen.screener, 1, "ten minutes later the cached row is served without a vendor call");
  eq(second.body.generatedAt, first.body.generatedAt,
    "AND KEEPS ITS OWN READ TIME: the card was rebuilt with 'generated now' on every view before, so a 09:35 row read as built at 09:45");
  eq(second.res.headers.get("X-Fresh-State"), "live", "still live at ten minutes");

  at(ET(TUE, 10, 0));
  const third = await get("/api/flows/card?t=TLT");
  eq(seen.screener, 2, "IN SESSION A ROW OLDER THAN 15 MINUTES IS READ AGAIN (it was kept twelve hours, all session)");
  eq(third.body.generatedAt, new Date(ET(TUE, 10, 0)).toISOString(), "and the new card carries the new read time");

  at(ET(TUE, 10, 5));
  const cached = await get("/api/flows/card?t=TLT");
  eq(seen.screener, 2, "five minutes after a re-read it is a cache hit again");
  ok(cached.body.generatedAt === third.body.generatedAt, "with the read time unchanged");
}

{
  const f = fakeD1();
  const limited = { limit: async () => ({ success: false }) };
  const get = await client(f.D1, { UW_ONDEMAND: limited });
  const seen = vendor((t) => screenerRow(t, "b"));
  caches_.clear();
  at(ET(TUE, 10, 0));
  caches_.set("https://flows-class.internal/HYG", { text: JSON.stringify({ known: true, row: screenerRow("HYG", "b"), readAt: ET(TUE, 10, 0) }),
    headers: [["content-type", "application/json"]], exp: ET(TUE, 22, 0) });
  at(ET(TUE, 11, 0));
  const held = await get("/api/flows/card?t=HYG");
  eq(seen.screener, 0, "with the on-demand limiter refusing, no vendor call is made");
  eq(held.body.depth, "quote", "and the held row is still served rather than an empty page");
  eq(held.body.generatedAt, new Date(ET(TUE, 10, 0)).toISOString(), "under its TRUE read time, an hour old");
  eq(held.res.headers.get("X-Fresh-State"), "stale", "which the header calls stale, not live");
}

{
  const f = fakeD1();
  const get = await client(f.D1);
  const json = { "Content-Type": "application/json" };
  const failures = [
    ["IEF", "a 500", () => new Response("boom", { status: 500 })],
    ["AGG", "a body with no rows", () => new Response(JSON.stringify({ data: "nope" }), { status: 200, headers: json })],
    ["LQD", "a rate limit", () => new Response("{}", { status: 429, headers: json })],
    ["EMB", "a dropped connection", () => { throw new TypeError("network"); }],
  ];
  for (const [t, what, answer] of failures) {
    caches_.clear();
    let asked = 0;
    globalThis.fetch = async (url) => {
      if (new URL(String(url)).pathname === "/api/screener/stocks") { asked++; return answer(); }
      return new Response("{}", { status: 404, headers: json });
    };
    at(ET(TUE, 10, 0));
    caches_.set("https://flows-class.internal/" + t, { text: JSON.stringify({ known: true, row: screenerRow(t, "e"), readAt: ET(TUE, 10, 0) }),
      headers: [["content-type", "application/json"]], exp: ET(TUE, 22, 0) });
    at(ET(TUE, 11, 0));
    const held = await get("/api/flows/card?t=" + t);
    eq(asked, 1, `THE VENDOR FAILS (${what}): the row older than 15 minutes is asked for once`);
    eq(held.res.status, 200, "and the reader still gets the card rather than an error");
    eq(held.body.depth, "quote", "the held row, not an empty page");
    eq(held.body.generatedAt, new Date(ET(TUE, 10, 0)).toISOString(), "under its TRUE read time, an hour old, not the failed attempt's");
    eq(held.res.headers.get("X-Fresh-State"), "stale", "which the header calls stale rather than live");
  }
}

{
  const f = fakeD1();
  const get = await client(f.D1);
  const seen = vendor((t) => screenerRow(t, "c"));
  caches_.clear();
  at(ET(TUE, 21, 0));
  caches_.set("https://flows-class.internal/SMH", { text: JSON.stringify({ known: true, row: screenerRow("SMH", "c"), readAt: ET(TUE, 15, 50) }),
    headers: [["content-type", "application/json"]], exp: ET(WED, 3, 0) });
  const covered = await get("/api/flows/card?t=SMH");
  eq(seen.screener, 0, "AFTER THE CLOSE a row read at 15:50 ET covers the close and is served from the cache");
  eq(covered.res.headers.get("X-Fresh-State"), "closed", "as a closed row");
  eq(covered.res.headers.get("X-Fresh-Reason"), "session-final", "that is final for the session");

  caches_.set("https://flows-class.internal/SOXX", { text: JSON.stringify({ known: true, row: screenerRow("SOXX", "c"), readAt: ET(TUE, 14, 0) }),
    headers: [["content-type", "application/json"]], exp: ET(WED, 3, 0) });
  const behind = await get("/api/flows/card?t=SOXX");
  eq(seen.screener, 1, "but a row read at 14:00 ET stops two hours short of it: it is read once more, at 21:00");
  eq(behind.body.generatedAt, new Date(ET(TUE, 21, 0)).toISOString(), "and is dated by that read");
  eq(behind.res.headers.get("X-Fresh-State"), "closed", "final from then on");
  const again = await get("/api/flows/card?t=SOXX");
  eq(seen.screener, 1, "with no further vendor call");
  ok(again.body.generatedAt === behind.body.generatedAt, "and the same stamp");

  caches_.set("https://flows-class.internal/EWZ", { text: JSON.stringify({ known: true, row: screenerRow("EWZ", "c") }),
    headers: [["content-type", "application/json"]], exp: ET(WED, 3, 0) });
  const legacy = await get("/api/flows/card?t=EWZ");
  eq(seen.screener, 2, "A CACHED VERDICT WITH NO READ TIME IS A MISS: the entries written before this change carry a row of unknown age and would keep the old label for twelve hours");
  ok(legacy.body.generatedAt === new Date(ET(TUE, 21, 0)).toISOString(), "and are replaced by a dated one");
}

{
  const f = fakeD1();
  const get = await client(f.D1);
  const seen = vendor(() => null);
  caches_.clear();
  at(ET(TUE, 9, 40));
  const unknown = await get("/api/flows/card?t=ZZZQ");
  eq(unknown.body.status, "absent", "a name the vendor does not know stays absent");
  at(ET(TUE, 15, 40));
  await get("/api/flows/card?t=ZZZQ");
  eq(seen.screener, 1, "and that verdict keeps its twelve hours: only a row's numbers age, not the fact that a name is unknown");
}


const newsRows = (n, from, stepMin) => Array.from({ length: n }, (_, i) => {
  const ms = from - i * stepMin * 60000;
  return { headline: "headline " + i + " at " + new Date(ms).toISOString(), source: "wire", createdAt: new Date(ms).toISOString(), createdAtMs: ms,
    major: false, sentiment: "neutral", tickers: ["SPY"], tags: [] };
});
const liveNews = (session, readAt, extra = {}) => ({
  v: 1, key: "live:news", session,
  fresh: { v: 1, readAt: new Date(readAt).toISOString(), session, cadenceS: 900, source: "actions", writer: "flows-live" },
  rows: newsRows(5, readAt - 120000, 3), requested: 100, returned: 100, kept: 5, cap: 60, capped: false, shed: 0, atVendorLimit: true,
  unusable: 0, undatedKept: 0, undatedSeen: 0, newest: new Date(readAt - 120000).toISOString(), oldest: new Date(readAt - 132000).toISOString(),
  ordered: true, orderedBy: "createdAt", orderedDesc: true, status: "ok", reason: null, ...extra,
});
const nightlyNews = (session, readAt) => ({
  v: 1, generatedAt: new Date(readAt).toISOString(), sessionDate: session, readAt: new Date(readAt).toISOString(), readDay: session,
  refreshed: "nightly", cadence: "once each weekday after the close", staleBy: "the next weekday's close",
  rows: newsRows(3, readAt - 60000, 7), requested: 100, returned: 100, kept: 3, cap: 60, capped: false, shed: 0, atVendorLimit: true,
  unusable: 0, undatedKept: 0, undatedSeen: 0, status: "ok", reason: null,
});

{
  const f = fakeD1();
  const get = await client(f.D1);
  at(ET(TUE, 11, 5));
  f.put("news", nightlyNews(MON, ET(TUE, 6, 10)), ET(TUE, 6, 10));
  f.live("live:news", liveNews(TUE, ET(TUE, 11, 0)), ET(TUE, 11, 0), TUE);
  const cold = await get("/api/flows/news");
  const trips = f.trips.length;
  const r = await get("/api/flows/news");
  eq(f.trips.length - trips, 1, "THE OVERLAY COSTS NO EXTRA ROUND TRIP: the nightly row and its live twin ride one batch, as the plain read was one trip");
  eq(r.res.headers.get("X-Live-Overlay"), "live:news", "IN SESSION the five-minute-old live headlines replace the nightly's from 06:10 ET");
  eq(r.body.readAt, new Date(ET(TUE, 11, 0)).toISOString(), "with the LIVE read time as readAt, where the live envelope keeps it under fresh.readAt");
  eq(r.body.sessionDate, TUE, "and the live session as sessionDate");
  eq(r.body.refreshed, "intraday", "named intraday, as the pulse overlay names itself");
  eq(r.body.cadenceMinutes, 15, "with its cadence stated in minutes");
  ok(r.body.cadence === undefined && r.body.staleBy === undefined, "and none of the nightly's 'once a day' cadence or stale-by text");
  ok(r.body.rows.length === 5 && r.body.rows.every((x) => /^headline/.test(x.headline)) && r.body.kept === 5, "the live rows and their counts, shaped as the nightly's");
  eq(r.res.headers.get("X-Fresh-Class"), "breadth", "the freshness headers are the LIVE key's, the breadth class");
  eq(r.res.headers.get("X-Fresh-State"), "live", "live at five minutes");
  eq(r.res.headers.get("X-Fresh-Read-At"), r.body.readAt, "from the read instant");
  eq(r.res.headers.get("X-Payload-Updated"), String(ET(TUE, 11, 0)), "and the update stamp is the live row's, so a change is noticed");
  eq(cold.body.readAt, r.body.readAt, "a cold isolate answers the same");

  at(ET(TUE, 15, 0));
  const dead = await get("/api/flows/news");
  eq(dead.res.headers.get("X-Live-Overlay"), "live:news", "IF THE LOOP DIES the newer live headlines still beat the older nightly");
  eq(dead.res.headers.get("X-Fresh-State"), "stale", "but wear their own verdict, stale after 45 minutes, where the nightly's row would have said fresh");
  eq(dead.body.readAt, r.body.readAt, "and their true read time");

  at(ET(TUE, 21, 40));
  f.put("news", nightlyNews(TUE, ET(TUE, 21, 30)), ET(TUE, 21, 30));
  const landed = await get("/api/flows/news");
  ok(!landed.res.headers.get("X-Live-Overlay"), "once the nightly of the same session lands after the last live read, the nightly is served");
  eq(landed.body.cadence, "once each weekday after the close", "with its own cadence text");
  eq(landed.res.headers.get("X-Fresh-Class"), "nightly", "and its own class");

  at(ET(WED, 6, 10));
  f.put("news", nightlyNews(TUE, ET(WED, 6, 10)), ET(WED, 6, 10));
  const morning = await get("/api/flows/news");
  ok(!morning.res.headers.get("X-Live-Overlay"), "and the 06:10 ET refresh of the next morning beats yesterday's last live read");

  at(ET(WED, 20, 30));
  f.live("live:news", liveNews(WED, ET(WED, 16, 20)), ET(WED, 16, 20), WED);
  const evening = await get("/api/flows/news");
  eq(evening.res.headers.get("X-Live-Overlay"), "live:news", "before the night's nightly lands, the session's own 16:20 ET headlines beat the morning's");
  eq(evening.res.headers.get("X-Fresh-State"), "closed", "as a closed row that covers the close");

  f.live("live:news", liveNews(WED, ET(WED, 16, 20), { status: "unavailable", reason: "vendor-failed", rows: [] }), ET(WED, 16, 25), WED);
  const failed = await get("/api/flows/news");
  ok(!failed.res.headers.get("X-Live-Overlay") && failed.body.rows.length === 3,
    "A LIVE READ THAT FAILED (status unavailable, no rows) never replaces headlines that exist");
  f.live("live:news", liveNews(TUE, ET(TUE, 11, 0)), ET(TUE, 11, 0), TUE);
  const old = await get("/api/flows/news");
  ok(!old.res.headers.get("X-Live-Overlay"), "and a live row of an EARLIER session than the nightly's never does either");
}

{
  const f = fakeD1();
  const get = await client(f.D1);
  at(ET(TUE, 11, 5));
  const none = await get("/api/flows/news");
  deep(none.body, { status: "pending", rows: [] }, "with neither row published the route still answers pending with an empty list, its old shape");
  f.live("live:news", liveNews(TUE, ET(TUE, 11, 0)), ET(TUE, 11, 0), TUE);
  const liveOnly = await get("/api/flows/news");
  eq(liveOnly.res.headers.get("X-Live-Overlay"), "live:news", "and with only the live row published the live headlines are served");
}

{
  const nightly = { session: MON, readAt: new Date(ET(TUE, 6, 10)).toISOString() };
  ok(L.liveNewsWins(nightly, TUE, ET(TUE, 11, 0)), "a later session wins");
  ok(!L.liveNewsWins(nightly, SUN, ET(TUE, 11, 0)), "an earlier one does not");
  ok(L.liveNewsWins({ session: TUE, readAt: nightly.readAt }, TUE, ET(TUE, 11, 0)), "the same session, read later, wins");
  ok(!L.liveNewsWins({ session: TUE, readAt: nightly.readAt }, TUE, ET(TUE, 6, 10)), "read at the same instant, the nightly keeps it");
  ok(!L.liveNewsWins({ session: TUE, readAt: nightly.readAt }, TUE, ET(TUE, 5, 0)), "and read earlier, it does too");
  ok(L.liveNewsWins(null, TUE, ET(TUE, 11, 0)), "with no nightly the live row is all there is");
  ok(L.liveNewsWins({ session: TUE, readAt: null }, TUE, ET(TUE, 11, 0)), "a nightly with no stated read time cannot beat a dated one");
  ok(!L.liveNewsWins(nightly, "yesterday", ET(TUE, 11, 0)) && !L.liveNewsWins(nightly, TUE, NaN), "an undated or malformed live row wins nothing");
  eq(L.newsWithLive({ status: "unavailable", rows: [] }, { session: TUE, readAt: 1, cadenceS: 900 }), null, "an unavailable live read merges into nothing");
  eq(L.newsWithLive({ status: "ok", rows: [] }, { session: TUE, readAt: 1, cadenceS: 900 }), null, "and an empty one merges into nothing");
}

Date.now = realNow;
globalThis.fetch = realFetch;

console.log(`flows-readers-contract: ${checks} checks passed`);
