import { readFileSync } from "node:fs";
import { fakeD1 } from "./d1-fake.mjs";
import { HttpError, apiError } from "../../server/http.js";

const ROOT = new URL("../../", import.meta.url);

export const read = (file) => readFileSync(new URL(file, ROOT), "utf8");

export function memberSchemaSql() {
  const match = /const MEMBER_STATE_SCHEMA_SQL = (Object\.freeze\(\[[\s\S]*?\]\));/.exec(read("worker.js"));
  if (!match) throw new Error("worker.js declares no MEMBER_STATE_SCHEMA_SQL");
  return new Function("return " + match[1])();
}

export const HOST = "https://flows.test";
export const OWNER = "anilkaya";
export const ALICE = "member.alpha";
export const BOB = "member.bravo";
export const KEY = "member-state-test-secret-0123456789-abcdef";
export const KEY_PREV = "member-state-previous-secret-9876543210-fedcba";

export const names = (prefix, n, from = 0) => Array.from({ length: n }, (_, i) => prefix + String(from + i).padStart(3, "0"));

export const UNIVERSE_NAMES = names("SYA", 400);

export const limiter = (limit) => {
  const counts = new Map();
  const calls = [];
  return {
    calls, counts, limit,
    async limit({ key }) {
      calls.push(key);
      counts.set(key, (counts.get(key) || 0) + 1);
      return { success: counts.get(key) <= limit };
    },
  };
};

export function clock(start = 1790000000000) {
  let t = start;
  const fn = () => t;
  fn.set = (v) => { t = v; };
  fn.tick = (ms) => { t += ms; return t; };
  return fn;
}

export function stores(payloads) {
  const reads = [];
  return {
    reads,
    flowsStore: {
      async read(env, key) {
        reads.push(key);
        return Object.hasOwn(payloads, key) && payloads[key] !== null ? { payload: JSON.stringify(payloads[key]), updatedAt: 1 } : null;
      },
      async readMany(env, keys) {
        reads.push(...keys);
        return new Map(keys.filter((k) => Object.hasOwn(payloads, k) && payloads[k] !== null).map((k) => [k, { payload: JSON.stringify(payloads[k]), updatedAt: 1 }]));
      },
    },
  };
}

export function universePayload(tickers = UNIVERSE_NAMES, extra = {}) {
  return { v: 1, sessionDate: "2026-10-23", generatedAt: "2026-10-24T00:10:00.000Z", status: "ok", n: tickers.length, t: tickers, units: {}, cols: {}, ...extra };
}

export async function build({ modules, payloads = {}, env: envExtra = {}, now = clock(), live = null, owners = [OWNER] } = {}) {
  const f = fakeD1({ latencyMs: 0 });
  const store = modules.store.createMemberStore({ schemaSql: memberSchemaSql() });
  const { flowsStore, reads } = stores({ universe: universePayload(), ...payloads });
  const limits = { read: limiter(120), write: limiter(30), export: limiter(10) };
  const rows = modules.route.flowsMeRows({
    store, flowsStore, readLiveRows: typeof live === "function" ? live : async () => live || { rows: [] }, isOwner: (env, u) => owners.includes(u), now,
  });
  const env = {
    DB: f.D1, MEMBER_STATE_KEY: KEY, FLOWS_MEMBER_STATE: "on", FLOWS_EXPORTS: "on",
    MEMBER_STATE_READ: limits.read, MEMBER_STATE_WRITE: limits.write, MEMBER_EXPORT: limits.export, ...envExtra,
  };
  const world = { f, store, rows, env, limits, now, reads, flowsStore };
  world.call = (id, opts) => call(world, id, opts);
  return world;
}

const SAME = { Origin: HOST, "Sec-Fetch-Site": "same-origin" };

export async function call(world, id, { method, body, headers = {}, session = { username: ALICE }, raw, contentType = "application/json", env = world.env, host = HOST, same = true } = {}) {
  const row = world.rows.find((r) => r.id === id);
  if (!row) throw new Error("no row " + id);
  const m = method || row.methods[0];
  const url = host + row.path;
  const init = { method: m, headers: { ...(same ? { ...SAME, Origin: host } : {}), ...(contentType ? { "Content-Type": contentType } : {}), ...headers } };
  if (m !== "GET" && m !== "HEAD" && (body !== undefined || raw !== undefined)) init.body = raw !== undefined ? raw : JSON.stringify(body);
  const request = new Request(url, init);
  let res;
  try {
    res = await row.handler({ request, env, url: new URL(url), ctx: { waitUntil() { throw new Error("waitUntil used"); } }, session });
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    res = apiError(error.status, error.code, error.message, error.headers, error.details);
  }
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json, bytes };
}

export function allRows(f) {
  const out = {};
  const tables = f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) out[name] = f.db.prepare(`SELECT * FROM ${name}`).all();
  return out;
}

export function everything(f) {
  const parts = [];
  for (const [table, rows] of Object.entries(allRows(f))) {
    for (const row of rows) {
      for (const [col, value] of Object.entries(row)) {
        parts.push(table + "." + col + "=" + (value instanceof Uint8Array ? Buffer.from(value).toString("latin1") + "|" + Buffer.from(value).toString("hex") : String(value)));
      }
    }
  }
  return parts.join("\n");
}
