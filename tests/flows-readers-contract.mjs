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


console.log(`flows-readers-contract: ${checks} checks passed`);
