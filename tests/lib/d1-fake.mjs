import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const SCHEMA = readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");

export function fakeD1({ schema = SCHEMA, latencyMs = 1 } = {}) {
  const db = new DatabaseSync(":memory:");
  if (schema) db.exec(schema);
  const trips = [];
  let failing = null;
  let thrown = null;
  let hang = null;
  let slow = null;
  const reads = /^\s*(SELECT|PRAGMA|WITH)/i;
  let current = null;
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
  const exec = (sql, args) => {
    const started = performance.now();
    try { return run(sql, args); } finally { clock.sqlMs += performance.now() - started; }
  };
  const fake = { latencyMs };
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
  const live = (id, value, readAt, session, { cadenceS = 300, source = "worker", writer = "worker@rth" } = {}) => db.prepare(
    "INSERT OR REPLACE INTO flows_live (id, payload, read_at, session, cadence_s, source, writer, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, JSON.stringify(value), readAt, session, cadenceS, source, writer, readAt);
  const tape = (ticker, value, readAt, session, legs = 3) => db.prepare(
    "INSERT OR REPLACE INTO flows_tape (ticker, payload, read_at, session, legs) VALUES (?, ?, ?, ?, ?)",
  ).run(ticker, JSON.stringify(value), readAt, session, legs);
  const rowsRead = (from = 0) => trips.slice(from).reduce((sum, t) => sum + (t.rows || 0), 0);
  const written = (from = 0) => trips.slice(from).reduce((sum, t) => sum + (t.written || 0), 0);
  return {
    D1, db, trips, clock, put, live, tape, rowsRead, written,
    fail: (re) => { failing = re; },
    throwSync: (re) => { thrown = re; },
    hangOnce: (re) => { hang = re; },
    slowOnce: (re, ms) => { slow = { re, ms }; },
    latency: (ms) => { fake.latencyMs = ms; },
    since: (n) => trips.slice(n),
    count: (re, from = 0) => trips.slice(from).filter((t) => t.sqls.some((s) => re.test(s))).length,
  };
}
