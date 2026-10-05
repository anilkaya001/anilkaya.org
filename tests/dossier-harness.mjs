import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { FLOWS_COOKIE, FLOWS_USERNAMES, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import { VENDOR, NOW_ISO, vendorBody } from "./dossier-fixtures.mjs";
import { guardAi } from "./lib/ai-guard.mjs";

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
export const SESSION_SECRET = "dossier-session-secret-abcdefghijklmnopqrstuvwxyz";

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const trips = [];
  let failing = null;
  let current = null;
  const reads = /^\s*(SELECT|PRAGMA|WITH)/i;
  const cardinality = (name) => {
    try { return db.prepare(`SELECT count(*) AS n FROM ${name}`).get().n; } catch { return 0; }
  };
  const elements = (path) => {
    try {
      return db.prepare("SELECT max(n) AS n FROM (SELECT (SELECT count(*) FROM json_each(p.payload, ?)) AS n FROM flows_payload p WHERE json_valid(p.payload))").get(path).n || 0;
    } catch { return 0; }
  };
  const scanned = (sql, args, returned) => {
    let plan;
    try { plan = db.prepare("EXPLAIN QUERY PLAN " + sql).all(...args); } catch { return returned; }
    const aliases = new Map();
    for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(?!WHERE\b|LIMIT\b|ORDER\b|UNION\b|JOIN\b|ON\b|GROUP\b|LEFT\b)(\w+))?/gi)) {
      if (m[2]) aliases.set(m[2], m[1]);
    }
    const paths = new Map();
    for (const m of sql.matchAll(/json_each\(\s*\w+\.payload\s*,\s*'([^']+)'\s*\)\s+(\w+)/gi)) paths.set(m[2], m[1]);
    let rows = 0, searches = 0;
    for (const { detail } of plan) {
      const m = /^(SCAN|SEARCH)\s+(\w+)/.exec(detail);
      if (!m) continue;
      if (/VIRTUAL TABLE/.test(detail)) {
        if (paths.has(m[2])) rows += elements(paths.get(m[2]));
        continue;
      }
      if (m[1] === "SCAN") rows += cardinality(aliases.get(m[2]) || m[2]);
      else searches++;
    }
    return rows + (searches ? Math.max(searches, returned) : 0);
  };
  const clock = { sqlMs: 0 };
  const exec = (sql, args) => {
    const started = performance.now();
    try { return run(sql, args); } finally { clock.sqlMs += performance.now() - started; }
  };
  const run = (sql, args) => {
    if (failing && failing.test(sql)) throw new Error("fake D1 refused " + sql.slice(0, 40));
    const st = db.prepare(sql);
    if (reads.test(sql)) {
      const results = st.all(...args);
      if (current && /^\s*(SELECT|WITH)/i.test(sql)) current.rows += scanned(sql, args, results.length);
      return { results, meta: {} };
    }
    const info = st.run(...args);
    if (current) current.written += Number(info.changes) || 0;
    return { results: [], meta: { changes: info.changes } };
  };
  const fake = { latencyMs: 1 };
  const trip = (kind, sqls, args, fn) => new Promise((resolve, reject) => setTimeout(() => {
    const entry = { kind, sqls, args, rows: 0, written: 0 };
    trips.push(entry);
    current = entry;
    try { resolve(fn()); } catch (error) { reject(error); } finally { current = null; }
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
      if (failing && sqls.some((sql) => failing.test(sql))) return Promise.reject(new Error("fake D1 refused the batch"));
      return trip("batch", sqls, args, () => list.map((s) => exec(s.sql, s.args)));
    },
  };
  const put = (id, value, at = 1790380000000) => db.prepare(
    "INSERT OR REPLACE INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?)",
  ).run(id, typeof value === "string" ? value : JSON.stringify(value), at);
  const live = (id, value, readAt, session) => db.prepare(
    "INSERT OR REPLACE INTO flows_live (id, payload, read_at, session, cadence_s, source, writer, updated_at) VALUES (?, ?, ?, ?, 300, ?, 'writer', ?)",
  ).run(id, JSON.stringify(value), readAt, session, id === "live:market" ? "worker" : "actions", readAt);
  const tape = (ticker, value, readAt, session) => db.prepare(
    "INSERT OR REPLACE INTO flows_tape (ticker, payload, read_at, session, legs) VALUES (?, ?, ?, ?, 3)",
  ).run(ticker, JSON.stringify(value), readAt, session);
  const rowsRead = (from = 0) => trips.slice(from).reduce((sum, t) => sum + (t.rows || 0), 0);
  const written = (from = 0) => trips.slice(from).reduce((sum, t) => sum + (t.written || 0), 0);
  return {
    D1, db, trips, put, live, tape, rowsRead, written, clock,
    fail: (re) => { failing = re; },
    latency: (ms) => { fake.latencyMs = ms; },
    since: (n) => trips.slice(n),
    count: (re, from = 0) => trips.slice(from).filter((t) => t.sqls.some((s) => re.test(s))).length,
  };
}

export function shiftClock(baseIso = NOW_ISO) {
  const Real = Date;
  const offset = Real.parse(baseIso) - Real.now();
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  };
  return () => { globalThis.Date = Real; };
}

export function cacheFake() {
  const store = new Map();
  const real = globalThis.caches;
  const cache = {
    async match(request) {
      const key = typeof request === "string" ? request : request.url;
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires <= Date.now()) { store.delete(key); return undefined; }
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    },
    async put(request, response) {
      const key = typeof request === "string" ? request : request.url;
      const ma = /max-age=(\d+)/.exec(response.headers.get("Cache-Control") || "");
      store.set(key, { body: await response.text(), status: response.status, headers: [...response.headers], expires: Date.now() + (ma ? Number(ma[1]) * 1000 : 0) });
    },
  };
  globalThis.caches = { default: cache };
  return { store, restore: () => { if (real === undefined) delete globalThis.caches; else globalThis.caches = real; }, clear: () => store.clear() };
}

export function vendorStub(o = {}) {
  const real = globalThis.fetch;
  const calls = [];
  const spent = { ms: 0 };
  const state = { refuse: new Map(), delay: new Map(), bodies: new Map(), status: new Map(), tooLarge: new Set(), hold: new Map() };
  const routes = [
    [/^\/api\/stock\/[^/]+\/info$/, "info"], [/^\/api\/companies\/[^/]+\/profile$/, "profile"], [/^\/api\/stock\/[^/]+\/financials$/, "financials"],
    [/^\/api\/stock\/[^/]+\/fundamental-breakdown$/, "breakdown"], [/^\/api\/companies\/[^/]+\/earnings-estimates$/, "estimates"],
    [/^\/api\/screener\/analysts$/, "analysts"], [/^\/api\/earnings\/[^/]+$/, "earnings"], [/^\/api\/institution\/[^/]+\/ownership$/, "ownership"],
    [/^\/api\/shorts\/[^/]+\/interest-float\/v2$/, "short"], [/^\/api\/insider\/[^/]+\/ticker-flow$/, "insiders"], [/^\/api\/news\/headlines$/, "news"],
    [/^\/api\/darkpool\/[^/]+\/price-levels$/, "levels"], [/^\/api\/stock\/[^/]+\/stock-state$/, "quote"],
    [/^\/api\/screener\/stocks$/, "screener"],
  ];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    if (url.hostname !== "uw.test") return real(input, init);
    const hit = routes.find(([re]) => re.test(url.pathname));
    const key = hit ? hit[1] : "unknown";
    const symbol = key === "analysts" || key === "news" || key === "screener" ? url.searchParams.get("ticker") : decodeURIComponent(url.pathname.split("/")[3] || "");
    calls.push({ key, path: url.pathname, ticker: symbol, query: Object.fromEntries(url.searchParams), at: Date.now() });
    if (state.delay.has(key)) await new Promise((resolve) => setTimeout(resolve, state.delay.get(key)));
    if (state.hold.has(key)) await state.hold.get(key);
    if (state.status.has(key)) return new Response(JSON.stringify({ message: "refused" }), { status: state.status.get(key), headers: { "Content-Type": "application/json" } });
    if (state.tooLarge.has(key)) return new Response("{}", { status: 200, headers: { "Content-Type": "application/json", "Content-Length": "9999999" } });
    const built = performance.now();
    const body = state.bodies.has(key) ? state.bodies.get(key)
      : key === "screener" ? { data: [{ ticker: symbol, close: "10", prev_close: "9.9", full_name: "Screener Row" }] }
        : hit && key in VENDOR.bodies ? vendorBody(key) : { data: [] };
    const text = JSON.stringify(body);
    spent.ms += performance.now() - built;
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, state, spent, restore: () => { globalThis.fetch = real; }, count: (key) => calls.filter((c) => c.key === key).length, reset: () => { calls.length = 0; } };
}

let instance = 0;
export async function client(D1, extra = {}) {
  const env = { DB: D1, SESSION_SECRET, UW_API_KEY: "test-key", UW_BASE: "https://uw.test", FLOWS_CREDENTIALS: JSON.stringify({ [FLOWS_USERNAMES[0]]: "x".repeat(43) }), ...extra };
  if (env.AI) env.AI = guardAi(env.AI);
  const token = await signFlowsSession(FLOWS_USERNAMES[0], env.SESSION_SECRET, 3600, sessionEpoch(env));
  const worker = (await import("../worker.js?dossier=" + (++instance))).default;
  return async (route, init = {}) => {
    const background = [];
    const ctx = { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) };
    const req = new Request("https://anilkaya.org" + route,
      { ...init, headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin", ...(init.headers || {}) } });
    const res = await worker.fetch(req, env, ctx);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { res, body, text, settle: async () => { await Promise.all(background); } };
  };
}
