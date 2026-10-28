import assert from "node:assert/strict";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { FLOWS_COOKIE, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import { FIXTURE_OWNER, FIXTURE_MEMBER } from "./lib/fixture-roster.mjs";
import { easternInstant } from "../shared/flows-freshness.js";
import { readList, FLOOR_FUNDS } from "../shared/flows-floor-funds.js";
import { FUNDS_KEY, FUNDS_WRITERS, FUNDS_FILL, fundsNote, marketSectors } from "../shared/flows-floor-funds-live.js";
import { fakeFundsRead, FUNDS_FAKE_SCREENER_GAPS } from "../scripts/flows-legs/funds-fake.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import * as REAL from "../shared/flows-live-worker.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const DAY = "2026-09-23";
const PREV = "2026-09-22";
const at = (hm, day = DAY) => easternInstant(day, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)));
const quiet = { error() {}, warn() {}, log() {} };

function cacheFake() {
  const store = new Map();
  const real = globalThis.caches;
  const cache = {
    async match(request) {
      const key = typeof request === "string" ? request : request.url;
      const hit = store.get(key);
      if (!hit || hit.expires <= Date.now()) return undefined;
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    },
    async put(request, response) {
      const key = typeof request === "string" ? request : request.url;
      const ma = /max-age=(\d+)/.exec(response.headers.get("Cache-Control") || "");
      store.set(key, { body: await response.text(), status: response.status, headers: [...response.headers], expires: Date.now() + (ma ? Number(ma[1]) * 1000 : 0) });
    },
  };
  globalThis.caches = { default: cache };
  return { store, restore: () => { if (real === undefined) delete globalThis.caches; else globalThis.caches = real; } };
}

function feed({ session = DAY, drop = [], fail = false } = {}) {
  const calls = [];
  const fn = async (path, params) => {
    calls.push({ path, params: { ...params } });
    if (fail) throw new Error("feed failed");
    if (path === "/api/market/sector-etfs") return { data: [{ ticker: "XLE", prev_date: PREV, call_premium: "777", put_premium: "333", call_volume: 7, put_volume: 3, bullish_premium: "500", bearish_premium: "200" }] };
    const body = fakeFundsRead(path, params, session);
    return { data: body.data.filter((r) => !drop.includes(r.ticker)) };
  };
  fn.calls = calls;
  return fn;
}

const heldFunds = (f) => {
  const r = f.db.prepare("SELECT payload, session, writer, source FROM flows_live WHERE id = ?").get(FUNDS_KEY);
  return r ? { ...r, payload: JSON.parse(r.payload) } : null;
};

const marketRow = (session) => ({ v: 1, key: "live:market", session, sectors: { status: "ok", reason: null, rows: [
  { etf: "XLE", name: "Energy", callPrem: 9100, putPrem: 4100, bull: 5100, bear: 2100, callVol: 91, putVol: 41 },
  { etf: "SPY", name: "S&P 500", callPrem: 990000, putPrem: 880000, bull: 600000, bear: 500000, callVol: 9900, putVol: 8800 },
] } });

async function tickChecks(W, label) {
  const out = [];
  const env = (f, extra = {}) => ({ DB: f.D1, UW_API_KEY: "stub", ...extra });
  {
    const f = fakeD1({ latencyMs: 0 });
    const vendor = feed();
    const r = await W.fundsTick(env(f), at("11:02"), { fetchVendor: vendor, log: quiet });
    const held = heldFunds(f);
    out.push(["THE FUNDS TICK WRITES live:funds in the session", r.written === true && held !== null]);
    out.push(["with one feed call, the screener for every fund by ticker list and no date", vendor.calls.length === 1 && vendor.calls[0].path === "/api/screener/stocks" &&
      vendor.calls[0].params.ticker === readList().join(",") && vendor.calls[0].params.limit === 500 && !("date" in vendor.calls[0].params)]);
    out.push(["under the Worker's funds writer, for today's session", !!held && held.writer === FUNDS_WRITERS.tick && held.source === "worker" && held.session === DAY && held.payload.session === DAY]);
    const rows = held ? held.payload.rows : {};
    out.push(["every index fund and sector ETF carries all six figures", [...FLOOR_FUNDS.funds, ...FLOOR_FUNDS.etf].every((t) => rows[t] && ["cp", "pp", "cv", "pv", "bu", "be"].every((k) => Number.isInteger(rows[t][k])))]);
    out.push(["a fund the screener left out is no_row, never a zero", FUNDS_FAKE_SCREENER_GAPS.every((t) => rows[t] && rows[t].why === "no_row" && !("cp" in rows[t]))]);
  }
  {
    const f = fakeD1({ latencyMs: 0 });
    f.live("live:market", marketRow(DAY), at("11:01"), DAY);
    const vendor = feed({ drop: ["XLE", "SPY"] });
    await W.fundsTick(env(f), at("11:02"), { fetchVendor: vendor, log: quiet });
    const rows = (heldFunds(f) || { payload: { rows: {} } }).payload.rows;
    out.push(["A FUND THE SCREENER MISSED IS FILLED FROM TIER 1'S SECTOR ROW of the same session, with no second call", vendor.calls.length === 1 &&
      rows.XLE && rows.XLE.src === "sector-etfs" && rows.XLE.cp === 9100 && rows.SPY && rows.SPY.src === "sector-etfs" && rows.SPY.pv === 8800]);
  }
  {
    const f = fakeD1({ latencyMs: 0 });
    f.live("live:market", marketRow(PREV), at("15:59", PREV), PREV);
    const vendor = feed({ drop: ["XLE"] });
    await W.fundsTick(env(f), at("11:02"), { fetchVendor: vendor, log: quiet });
    const rows = (heldFunds(f) || { payload: { rows: {} } }).payload.rows;
    out.push(["an earlier session's sector row is never taken for today's", rows.XLE && rows.XLE.why === "no_row"]);
  }
  for (const [what, when] of [["before the open", at("09:20")], ["on a weekend", at("11:02", "2026-09-26")], ["twenty minutes after the close", at("16:20")]]) {
    const f = fakeD1({ latencyMs: 0 });
    const vendor = feed();
    const r = await W.fundsTick(env(f), when, { fetchVendor: vendor, log: quiet });
    out.push([`NOT DUE ${what}: no call and no write`, r.due === false && vendor.calls.length === 0 && heldFunds(f) === null]);
  }
  for (const [what, extra, key] of [["FLOWS_FLOOR_FUNDS=off", { FLOWS_FLOOR_FUNDS: "off" }, "funds-off"], ["FLOWS_LIVE_MODE=off", { FLOWS_LIVE_MODE: "off" }, "off"]]) {
    const f = fakeD1({ latencyMs: 0 });
    const vendor = feed();
    const r = await W.fundsTick(env(f, extra), at("11:02"), { fetchVendor: vendor, log: quiet });
    out.push([`${what} turns the tick off: no call, no write`, r.skipped === key && vendor.calls.length === 0 && heldFunds(f) === null]);
  }
  {
    const f = fakeD1({ latencyMs: 0 });
    const vendor = feed({ fail: true });
    const r = await W.fundsTick(env(f), at("11:02"), { fetchVendor: vendor, log: quiet });
    out.push(["A FAILED READ WRITES NOTHING: the held row keeps its own read time", r.written === false && r.why === "no-fund-read" && heldFunds(f) === null]);
  }
  {
    const f = fakeD1({ latencyMs: 0 });
    const r = await W.fundsTick({ DB: f.D1 }, at("11:02"), { fetchVendor: feed(), log: quiet });
    out.push(["with no feed key the tick says so and calls nothing", r.why === "no-key" && heldFunds(f) === null]);
  }
  return out.map(([m, pass]) => [label + ": " + m, pass]);
}

async function routeChecks(W, label) {
  const out = [];
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  class HttpError extends Error { constructor(s, c, m) { super(m); this.status = s; this.code = c; } }
  const url = new URL("https://anilkaya.org/api/flows/lk?k=funds");
  const env = (f) => ({ DB: f.D1, UW_API_KEY: "stub" });
  const counter = (impl) => { const fn = async (...a) => { fn.n++; return impl(...a); }; fn.n = 0; return fn; };
  {
    const f = fakeD1({ latencyMs: 0 });
    const vendor = feed();
    const fill = counter((clock, market) => W.fillFunds(env(f), at("11:30"), { fetchVendor: vendor, clock, marketRow: market, log: quiet }));
    const res = await W.serveLiveKey(env(f), url, at("11:30"), { json, HttpError, fill });
    const body = await res.json();
    out.push(["A COLD READ (no live row, no nightly block) RUNS ONE FILL", fill.n === 1]);
    out.push(["and answers the filled row, not a pending body", res.status === 200 && body.key === FUNDS_KEY && body.rows && body.rows.SPY && Number.isInteger(body.rows.SPY.cp) && res.headers.get("X-Funds-Fill") === "written"]);
    out.push(["which is stored, so the next reader is served from the store", heldFunds(f) !== null && heldFunds(f).writer === FUNDS_WRITERS.fill]);
    const again = await W.serveLiveKey(env(f), url, at("11:31"), { json, HttpError, fill });
    out.push(["and the next read runs no fill", fill.n === 1 && again.status === 200 && (await again.json()).key === FUNDS_KEY]);
    out.push(["the fill made one feed call: the screener answered every index and sector fund", vendor.calls.length === 1]);
  }
  {
    const f = fakeD1({ latencyMs: 0 });
    f.put("market", { v: 1, sessionDate: PREV, funds: { v: 1, status: "ok", session: PREV, rows: { SPY: { src: "screener", cp: 1, pp: 1, cv: 1, pv: 1, bu: 1, be: 1 } } } });
    const fill = counter(async () => ({ written: false, why: "never" }));
    const res = await W.serveLiveKey(env(f), url, at("11:30"), { json, HttpError, fill });
    out.push(["A USABLE NIGHTLY BLOCK MEANS NO FILL: the page draws it labelled", fill.n === 0 && (await res.json()).status === "pending"]);
  }
  {
    const f = fakeD1({ latencyMs: 0 });
    f.live(FUNDS_KEY, { v: 1, key: FUNDS_KEY, session: PREV, rows: {} }, at("15:55", PREV), PREV);
    const fill = counter(async () => ({ written: false, why: "never" }));
    await W.serveLiveKey(env(f), url, at("11:30"), { json, HttpError, fill });
    out.push(["A HELD ROW MEANS NO FILL, even an earlier session's", fill.n === 0]);
  }
  {
    const f = fakeD1({ latencyMs: 0 });
    const fill = counter(async () => ({ written: false, why: "throttled", calls: 0 }));
    const res = await W.serveLiveKey(env(f), url, at("11:30"), { json, HttpError, fill });
    const body = await res.json();
    out.push(["a fill that could not read is a pending body that names why", fill.n === 1 && body.status === "pending" && body.why === "throttled" && res.headers.get("X-Funds-Fill") === "throttled"]);
  }
  {
    const f = fakeD1({ latencyMs: 0 });
    const fill = counter(async () => ({ written: false, why: "never" }));
    await W.serveLiveKey(env(f), new URL("https://anilkaya.org/api/flows/lk?k=market"), at("11:30"), { json, HttpError, fill });
    out.push(["another key never fills", fill.n === 0]);
  }
  for (const [what, when, date, session] of [
    ["IN THE SESSION the fill reads today's figures with no date", at("11:30"), null, DAY],
    ["BEFORE THE OPEN it reads the last closed session by date", at("08:10"), PREV, PREV],
    ["ON A WEEKEND it reads Friday's session by date", at("12:00", "2026-09-26"), "2026-09-25", "2026-09-25"],
    ["AFTER 20:00 ET it reads the day's own session by date", at("20:30"), DAY, DAY],
  ]) {
    const f = fakeD1({ latencyMs: 0 });
    const vendor = feed({ session });
    await W.fillFunds(env(f), when, { fetchVendor: vendor, log: quiet });
    const held = heldFunds(f);
    out.push([what, vendor.calls.length === 1 && (date === null ? !("date" in vendor.calls[0].params) : vendor.calls[0].params.date === date) && !!held && held.session === session]);
  }
  {
    const f = fakeD1({ latencyMs: 0 });
    const vendor = feed({ drop: ["XLE"] });
    const r = await W.fillFunds(env(f), at("11:30"), { fetchVendor: vendor, log: quiet });
    out.push(["A FILL WHOSE SCREENER MISSED A SECTOR FUND ASKS THE SECTOR FEED, its second and last call", vendor.calls.length === FUNDS_FILL.maxCalls && vendor.calls[1].path === "/api/market/sector-etfs" && r.calls === 2]);
  }
  return out.map(([m, pass]) => [label + ": " + m, pass]);
}

const SECRET = "funds-live-session-secret-abcdefghijklmnopqrstuvwxyz";
const tokens = {
  owner: await signFlowsSession(FIXTURE_OWNER, SECRET, 3600, sessionEpoch({ SESSION_SECRET: SECRET })),
  member: await signFlowsSession(FIXTURE_MEMBER, SECRET, 3600, sessionEpoch({ SESSION_SECRET: SECRET })),
};
const envOf = (D1, extra = {}) => ({
  DB: D1, SESSION_SECRET: SECRET, FLOWS_PEPPER: "funds-live-pepper", FLOWS_READ_MODE: "off", FLOWS_FLOOR_FUNDS: "on",
  UW_API_KEY: "stub-uw-key", UW_BASE: "https://uw.test", FLOWS_RT_USERS: FIXTURE_OWNER,
  ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
  FLOWS_CREDENTIALS: JSON.stringify({ [FIXTURE_OWNER]: "x".repeat(43), [FIXTURE_MEMBER]: "y".repeat(43) }),
  ...extra,
});

let instance = 0;
async function workerChecks(load, label) {
  const out = [];
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const calls = [];
  let mode = "ok";
  globalThis.fetch = async (input) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.origin !== "https://uw.test") return realFetch(input);
    calls.push(u.pathname);
    await new Promise((r) => setTimeout(r, 20));
    if (mode === "fail") return new Response("{}", { status: 503 });
    return new Response(JSON.stringify(fakeFundsRead(u.pathname, Object.fromEntries(u.searchParams), DAY)), { headers: { "Content-Type": "application/json" } });
  };
  Date.now = () => at("11:30");
  const cache = cacheFake();
  const read = async (worker, env, who = "member") => {
    const bg = [];
    const res = await worker.fetch(new Request("https://anilkaya.org/api/flows/lk?k=funds", { headers: { cookie: FLOWS_COOKIE + "=" + tokens[who] } }), env,
      { waitUntil: (p) => bg.push(Promise.resolve(p).catch(() => {})) });
    const body = await res.json();
    await Promise.all(bg);
    return { res, body };
  };
  const quietConsole = { error: console.error, warn: console.warn };
  console.error = console.warn = () => {};
  try {
    {
      cache.store.clear();
      const worker = await load();
      const f = fakeD1({ latencyMs: 0 });
      const env = envOf(f.D1);
      calls.length = 0;
      const [a, b] = await Promise.all([read(worker, env), read(worker, env)]);
      out.push(["TWO READERS AT ONCE ON A COLD DAY SHARE ONE FILL: one screener call", calls.filter((p) => p === "/api/screener/stocks").length === 1]);
      out.push(["and both are answered with the filled row", a.body.key === FUNDS_KEY && b.body.key === FUNDS_KEY && a.body.rows && b.body.rows]);
      calls.length = 0;
      const c = await read(worker, env);
      out.push(["and the next reader is served from the store with no call", calls.length === 0 && c.body.key === FUNDS_KEY]);
    }
    {
      cache.store.clear();
      const worker = await load();
      const f = fakeD1({ latencyMs: 0 });
      calls.length = 0;
      const r = await read(worker, envOf(f.D1, { MEMBER_VENDOR: { limit: async () => ({ success: false }) } }));
      out.push(["A MEMBER OVER THE FEED RATE LIMIT FILLS NOTHING: no call, a pending body that says throttled", calls.length === 0 && r.body.status === "pending" && r.body.why === "throttled"]);
    }
    {
      cache.store.clear();
      const worker = await load();
      const f = fakeD1({ latencyMs: 0 });
      calls.length = 0;
      const r = await read(worker, envOf(f.D1, { UW_ONDEMAND: { limit: async () => ({ success: false }) } }));
      out.push(["THE SHARED ON-DEMAND BUDGET SPENT: no call, throttled", calls.length === 0 && r.body.why === "throttled"]);
    }
    {
      cache.store.clear();
      const worker = await load();
      const f = fakeD1({ latencyMs: 0 });
      calls.length = 0;
      const r = await read(worker, envOf(f.D1, { FLOWS_FLOOR_FUNDS: "owner" }), "member");
      out.push(["OWNER MODE: a member who is not an owner triggers no fill", calls.length === 0 && r.body.status === "pending" && !r.body.why]);
      const o = await read(worker, envOf(f.D1, { FLOWS_FLOOR_FUNDS: "owner" }), "owner");
      out.push(["while an owner does", calls.length === 1 && o.body.key === FUNDS_KEY]);
    }
    {
      cache.store.clear();
      const worker = await load();
      const f = fakeD1({ latencyMs: 0 });
      calls.length = 0;
      mode = "fail";
      const r = await read(worker, envOf(f.D1));
      const r2 = await read(worker, envOf(f.D1));
      mode = "ok";
      out.push(["A FAILED FILL IS NOT RETRIED BY THE NEXT READER WITHIN A MINUTE: its outcome is held", r.body.why === "no-fund-read" && r2.body.why === "recent:no-fund-read" &&
        calls.filter((p) => p === "/api/screener/stocks").length === 1]);
      cache.store.clear();
    }
    {
      cache.store.clear();
      const worker = await load();
      const f = fakeD1({ latencyMs: 0 });
      calls.length = 0;
      const r = await read(worker, envOf(f.D1, { FLOWS_FLOOR_FUNDS: "off" }));
      out.push(["SWITCH OFF: no fill", calls.length === 0 && r.body.status === "pending"]);
    }
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    console.error = quietConsole.error;
    console.warn = quietConsole.warn;
    cache.restore();
  }
  return out.map(([m, pass]) => [label + ": " + m, pass]);
}

const loadReal = async () => (await import("../worker.js?funds=" + (++instance))).default;

for (const [m, pass] of await tickChecks(REAL, "tick")) ok(pass, m);
for (const [m, pass] of await routeChecks(REAL, "route")) ok(pass, m);
for (const [m, pass] of await workerChecks(loadReal, "worker")) ok(pass, m);

{
  eq(fundsNote(null), "live:funds: no row is held yet; the Worker's funds tick or a reader's fill writes it", "THE WITNESS NOTE says when nothing is held");
  const note = fundsNote({ payload: { key: FUNDS_KEY, session: DAY, fresh: { writer: FUNDS_WRITERS.tick, readAt: "2026-09-23T15:02:00.000Z" }, counts: { read: 68, listed: 72 }, rows: {} } });
  eq(note, "live:funds: held row by worker@funds, session 2026-09-23, read 2026-09-23T15:02:00.000Z, 68 of 72 funds read", "and names the writer, the session, the read time and the count when a row is held");
  eq(marketSectors({ session: PREV, sectors: JSON.stringify(marketRow(PREV).sectors) }, DAY), null, "a sector row of another session is not offered");
  eq(marketSectors({ session: DAY, sectors: "{" }, DAY), null, "nor an unreadable one");
}

const SHARED = "shared/flows-live-worker.js";
const PLANTS = [
  { name: "fill-twice: one cold read runs the fill twice", target: "shared", transforms: [["const got = await Promise.resolve().then(() => fill(clock, firstOf(results[2]))).catch(() => null);",
    "await Promise.resolve().then(() => fill(clock, firstOf(results[2]))).catch(() => null); const got = await Promise.resolve().then(() => fill(clock, firstOf(results[2]))).catch(() => null);"]] },
  { name: "fill-over-nightly: a usable nightly block still fills", target: "shared", transforms: [["if (fillable && results && !nightlyFundsUsable(firstOf(results[1]))) {", "if (fillable && results) {"]] },
  { name: "fill-over-held: a held row still fills", target: "shared", transforms: [["    if (!row) {\n      if (fillable && results", "    if (true) {\n      if (fillable && results"]] },
  { name: "tick-off-hours: the tick reads outside the session", target: "shared", transforms: [["  if (!focusDue(at, clock)) return { due: false, why: \"not-due\" };\n  if (!env.UW_API_KEY || typeof fetchVendor !== \"function\") return { due: true, written: false, why: \"no-key\" };\n  const out = await fundsRead(",
    "  if (!env.UW_API_KEY || typeof fetchVendor !== \"function\") return { due: true, written: false, why: \"no-key\" };\n  const out = await fundsRead("]] },
  { name: "empty-block-written: a failed read writes a block of dashes over the held row", target: "shared", transforms: [["  if (payload.status === \"unavailable\") {\n    return { statement: null,", "  if (false) {\n    return { statement: null,"]] },
  { name: "stale-sector-row: an earlier session's sector row is taken for today's", target: "shared-leaf", transforms: [["if (!row || row.session !== session || typeof row.sectors !== \"string\") return null;", "if (!row || typeof row.sectors !== \"string\") return null;"]] },
  { name: "no-single-flight: two readers at once run two fills", target: "worker", transforms: [["  if (!state.fundsFill) {\n    const gate = vendorGate(env, session);", "  if (true) {\n    const gate = vendorGate(env, session);"]] },
  { name: "no-member-gate: a member over the rate limit still fills", target: "worker", transforms: [["      if (!(await gate.member())) return { written: false, why: \"throttled\", calls: 0 };\n", ""]] },
  { name: "no-marker: a failed fill is retried by every reader", target: "worker", transforms: [["  const held = await edgeCache.get(FUNDS_FILL_MARK);", "  const held = null;"]] },
];
for (const plant of PLANTS) {
  let caught = null;
  try {
    let results;
    if (plant.target === "worker") {
      let n = 0;
      results = await workerChecks(async () => (await loadMutated("worker.js", plant.transforms, { salt: ++n + instance++ })).default, "planted");
    } else if (plant.target === "shared-leaf") {
      const leaf = await loadMutated("shared/flows-floor-funds-live.js", plant.transforms);
      results = [["leaf: an earlier session's sector row is not offered", leaf.marketSectors({ session: PREV, sectors: JSON.stringify(marketRow(PREV).sectors) }, DAY) === null]];
    } else {
      const W = await loadMutated(SHARED, plant.transforms);
      results = [...await tickChecks(W, "planted"), ...await routeChecks(W, "planted")];
    }
    caught = results.find(([, pass]) => !pass);
  } catch (e) {
    caught = ["threw: " + String(e && e.message).split("\n")[0], false];
  }
  console.log("  planted " + plant.name + ": " + (caught ? "caught by " + caught[0].slice(0, 110) : "NOT CAUGHT"));
  ok(caught !== null && caught !== undefined, `THE PLANTED WRONG BUILD "${plant.name}" FAILS A CHECK`);
}

console.log(`flows-floor-funds-live: ${checks} checks passed`);
