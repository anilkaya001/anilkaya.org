import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { createRouter } from "../../server/router.js";
import * as originalStore from "../../server/ff-store.js";
import { createFfStore } from "../../server/ff-store.js";
import { flowsFfRows } from "../../server/routes/flows-ff.js";
import { HttpError, apiError } from "../../server/http.js";
import { makeWorld, HOST, NOW, alice } from "./ff-b-world.mjs";

export function collector() {
  const failed = [];
  let count = 0;
  const clip = (v) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s === undefined ? "undefined" : s.length > 160 ? s.slice(0, 160) + "..." : s;
  };
  const ok = (cond, id, got) => {
    count += 1;
    if (!cond) failed.push({ id, detail: got === undefined ? "" : clip(got) });
  };
  const eq = (a, b, id) => {
    count += 1;
    if (!isDeepStrictEqual(a, b)) failed.push({ id, detail: clip(a) + " != " + clip(b) });
  };
  return { ok, eq, failed, count: () => count, ids: () => failed.map((f) => f.id) };
}

export const sha = (text) => createHash("sha256").update(text, "utf8").digest();

export const refBase32 = (bytes) => {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const pad = (5 - ((bytes.length * 8) % 5)) % 5;
  n <<= BigInt(pad);
  const groups = (bytes.length * 8 + pad) / 5;
  let out = "";
  for (let i = groups - 1; i >= 0; i--) out += "abcdefghijklmnopqrstuvwxyz234567"[Number((n >> BigInt(5 * i)) & 31n)];
  return out;
};

export const refDerivedId = (member, key) => "w-" + refBase32(sha(JSON.stringify([member, key]))).slice(0, 16);

export function limiter(allowed, seen = []) {
  let used = 0;
  return { seen, limit: async ({ key }) => { seen.push(key); used += 1; return { success: used <= allowed }; } };
}

export function makeApi({ world = makeWorld(), modules = {}, deps = {}, now = NOW, host = HOST, core = null, storeModule = null } = {}) {
  const create = modules.createFfStore || createFfStore;
  const family = modules.flowsFfRows || flowsFfRows;
  const store = create({ ensureFf: async () => {} });
  const flowsStore = {
    readMany: async (env, keys) => {
      const rows = await env.DB.prepare("SELECT id, payload, updated_at FROM flows_payload WHERE id IN (" + keys.map(() => "?").join(", ") + ")").bind(...keys).all();
      return new Map(rows.results.map((r) => [r.id, { payload: r.payload, updatedAt: r.updated_at }]));
    },
  };
  let clockNow = now;
  const options = {
    store, flowsStore, core: core || world.core, readClock: async () => null, now: () => clockNow, cache: new Map(), ...deps,
  };
  const rows = family(options);
  const router = createRouter(rows);
  const gates = { flows: async (request, env) => env.__user || null };
  const call = async (method, path, { body, user = alice, headers = {}, env = {}, raw = null, origin = host } = {}) => {
    const url = new URL(host + path);
    const init = { method, headers: { ...(origin ? { Origin: origin } : {}), ...(body !== undefined || raw !== null ? { "Content-Type": "application/json" } : {}), ...headers } };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (raw !== null) init.body = raw;
    const request = new Request(url, init);
    const t0 = world.f.trips.length;
    const waits = [];
    try {
      const res = await router.handle({ request, env: { ...world.env, ...env, __user: user }, url, ctx: { waitUntil: (p) => waits.push(p) } }, gates);
      if (res === null) return { status: 404, unrouted: true, body: null, text: "", bytes: Buffer.alloc(0), headers: {}, trips: 0, read: 0, written: 0, from: t0 };
      const bytes = Buffer.from(await res.arrayBuffer());
      const text = bytes.toString("utf8");
      await Promise.allSettled(waits);
      let parsed = null;
      if (text && (text[0] === "{" || text[0] === "[")) parsed = JSON.parse(text);
      return { status: res.status, body: parsed, text, bytes, headers: Object.fromEntries(res.headers), trips: world.f.trips.length - t0, read: world.f.rowsRead(t0), written: world.f.written(t0), from: t0 };
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      const res = apiError(error.status, error.code, error.message, error.headers, error.details);
      const parsed = JSON.parse(await res.text());
      return { status: error.status, body: parsed, text: JSON.stringify(parsed), headers: Object.fromEntries(res.headers), error: parsed.error, trips: world.f.trips.length - t0, read: world.f.rowsRead(t0), written: world.f.written(t0), from: t0 };
    }
  };
  return { world, store, storeModule: storeModule || originalStore, rows, router, call, setNow: (n) => { clockNow = n; }, flowsStore, options };
}

export const buildApi = (opt = {}) => {
  const { world: worldOptions, ...rest } = opt;
  return makeApi({ world: makeWorld(worldOptions), ...rest });
};

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && src[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export const walkStrings = (value, out = [], path = "") => {
  if (typeof value === "string") out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, out, path + "[" + i + "]"));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walkStrings(v, out, path + "." + k);
  return out;
};

export const walkNulls = (value, path = "", out = []) => {
  if (value === null) out.push(path);
  else if (Array.isArray(value)) value.forEach((v, i) => walkNulls(v, path + "[" + i + "]", out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (v === null && !("reason" in value) && !("v" in value && "text" in value)) out.push(path + "." + k);
      else if (v !== null) walkNulls(v, path + "." + k, out);
    }
  }
  return out;
};
