export const FEED_CATALOG_VERSION = 1;

export const FEED_READ_FAILURES = Object.freeze(["unshaped", "type", "empty"]);

export const FEED_REFUSALS = Object.freeze(["unknown-operation", "not-a-request", "write", "params", "unknown", "missing", "type", "format", "enum", "min", "max", "pattern", "body", "unknown-channel", "ticker"]);

export const FEED_JOIN = "join";

export const FEED_WIRE = Object.freeze({
  "short.short-volume-and-ratio": Object.freeze({ envelope: "si" }),
});

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/;
const WHOLE = /^-?[0-9]+$/;
const DAY = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;
const TOKEN = /\{([^{}]+)\}/g;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const put = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });

export class FeedRequestError extends Error {
  constructor(op, param, reason, detail) {
    super(`feed operation ${String(op)}: ${param === null ? "" : `${param} `}${detail}`);
    this.name = "FeedRequestError";
    this.op = op;
    this.param = param;
    this.reason = reason;
  }
}

export function realDay(text) {
  const m = DAY.exec(String(text));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function feedNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value !== "string") return { ok: false };
  if (value === "") return { ok: true, value: null };
  if (!DECIMAL.test(value)) return { ok: false };
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false };
  if (WHOLE.test(value) && !Number.isSafeInteger(n)) return { ok: false };
  return { ok: true, value: n === 0 ? 0 : n };
}

class Mistyped extends Error {
  constructor(at) {
    super(at);
    this.at = at;
  }
}

function shapeOf(fields) {
  const root = { entry: null, children: new Map(), item: null };
  const byPath = new Map([["", root]]);
  for (const entry of fields) {
    const node = { entry, children: new Map(), item: null };
    byPath.set(entry.path, node);
    if (entry.path.endsWith("[]")) {
      const parent = byPath.get(entry.path.slice(0, -2));
      if (parent) parent.item = node;
      continue;
    }
    const cut = entry.path.lastIndexOf(".");
    const parent = byPath.get(cut < 0 ? "" : entry.path.slice(0, cut));
    if (parent) parent.children.set(cut < 0 ? entry.path : entry.path.slice(cut + 1), node);
  }
  return root;
}

function readLeaf(entry, value) {
  if (entry.type === "any") return value;
  if (entry.type === "integer" || entry.type === "number" || (entry.type === "string" && entry.numeric === true)) {
    const got = feedNumber(value);
    if (!got.ok) throw new Mistyped(entry.path);
    return got.value;
  }
  if (entry.type === "string") {
    if (typeof value !== "string") throw new Mistyped(entry.path);
    return value;
  }
  if (entry.type === "boolean") {
    if (typeof value !== "boolean") throw new Mistyped(entry.path);
    return value;
  }
  throw new Mistyped(entry.path);
}

function readNode(node, value, strays) {
  if (value === null) return null;
  const entry = node.entry;
  if (entry.type === "object") {
    if (!isObj(value)) throw new Mistyped(entry.path);
    return readKeys(node, value, strays);
  }
  if (entry.type === "array") {
    if (!Array.isArray(value)) throw new Mistyped(entry.path);
    return node.item === null ? value.slice() : value.map((v) => readNode(node.item, v, strays));
  }
  return readLeaf(entry, value);
}

function readKeys(node, value, strays) {
  const out = {};
  const base = node.entry === null ? "" : `${node.entry.path}.`;
  const free = node.entry !== null && (node.entry.open === true || node.children.size === 0);
  for (const key of Object.keys(value)) {
    const child = node.children.get(key);
    if (child === undefined) {
      if (!free) strays.add(base + key);
      put(out, key, value[key]);
    } else put(out, key, readNode(child, value[key], strays));
  }
  return out;
}

const isEmpty = (v) => v === null || v === undefined || (Array.isArray(v) ? v.length === 0 : isObj(v) && Object.keys(v).length === 0);

const fail = (reason) => ({ ok: false, reason });

function paramText(op, p, value, leafType) {
  const refuse = (reason, detail) => { throw new FeedRequestError(op.id, p.name, reason, detail); };
  if (leafType === "integer" || leafType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (leafType === "integer" && !Number.isSafeInteger(value))) refuse("type", `must be ${leafType === "integer" ? "an integer" : "a number"}`);
    if (p.min !== undefined && value < p.min) refuse("min", `is below the documented minimum ${p.min}`);
    if (p.max !== undefined && value > p.max) refuse("max", `is above the documented maximum ${p.max}`);
  } else if (leafType === "boolean") {
    if (typeof value !== "boolean") refuse("type", "must be true or false");
  } else if (leafType === "string") {
    if (typeof value !== "string") refuse("type", "must be a string");
    if (p.format === "date" && !realDay(value)) refuse("format", "must be a calendar day written YYYY-MM-DD");
  } else if (typeof value !== "string" && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value))) {
    refuse("type", "must be a string, a number or a boolean");
  }
  const text = String(value);
  if (p.enum !== undefined && !p.enum.map(String).includes(text)) refuse("enum", `is not one of the documented values (${p.enum.join(", ")})`);
  if (p.pattern !== undefined && typeof value === "string") {
    let re = null;
    try { re = new RegExp(p.pattern); } catch { re = null; }
    if (re && !re.test(value)) refuse("pattern", `does not match the documented pattern ${p.pattern}`);
  }
  return text;
}

function bodyOf(op, body) {
  const refuse = (param, reason, detail) => { throw new FeedRequestError(op.id, param, reason, detail); };
  if (op.body === undefined) {
    if (body !== undefined && body !== null) refuse(null, "body", "takes no request body");
    return undefined;
  }
  if (body === undefined || body === null) {
    if (op.body.required) refuse(null, "body", "needs a request body");
    return undefined;
  }
  if (!isObj(body)) refuse(null, "body", "the request body must be an object");
  const top = new Map(op.body.fields.filter((f) => !f.path.includes(".") && !f.path.includes("[")).map((f) => [f.path, f]));
  for (const key of Object.keys(body)) {
    const f = top.get(key);
    if (!f) refuse(key, "unknown", "is not a documented body field");
    const v = body[key];
    if (v === null || v === undefined) continue;
    const okType = f.type === "any" || (f.type === "object" ? isObj(v) : f.type === "array" ? Array.isArray(v) : f.type === "integer" ? Number.isSafeInteger(v) : f.type === "number" ? typeof v === "number" && Number.isFinite(v) : typeof v === f.type);
    if (!okType) refuse(key, "type", `must be ${f.type === "object" ? "an object" : f.type === "array" ? "a list" : `a ${f.type}`}`);
    if (f.enum !== undefined && !f.enum.map(String).includes(String(v))) refuse(key, "enum", `is not one of the documented values (${f.enum.join(", ")})`);
  }
  const given = (key) => body[key] !== undefined && body[key] !== null;
  if (op.body.requiredSets.length && !op.body.requiredSets.some((set) => set.every(given))) {
    const first = op.body.requiredSets[0].find((key) => !given(key));
    refuse(first, "missing", `is missing from the request body (it needs ${op.body.requiredSets.map((set) => set.join(" + ")).join(", or ")})`);
  }
  return body;
}

export function createFeedClient(catalog, options) {
  if (!isObj(catalog) || catalog.version !== FEED_CATALOG_VERSION || !Array.isArray(catalog.ops) || !Array.isArray(catalog.channels)) {
    throw new Error(`the feed catalog is not version ${FEED_CATALOG_VERSION}`);
  }
  const wire = options && isObj(options.wire) ? options.wire : FEED_WIRE;
  const byId = new Map(catalog.ops.map((o) => [o.id, o]));
  const byRoute = new Map(catalog.ops.map((o) => [`${o.method} ${o.path}`, o]));
  const channels = new Map(catalog.channels.map((c) => [c.id, c]));
  const shapes = new Map();
  const shape = (key, fields) => {
    if (!shapes.has(key)) shapes.set(key, shapeOf(fields));
    return shapes.get(key);
  };
  const seen = (o) => (Object.hasOwn(wire, o.id) && isObj(wire[o.id]) ? wire[o.id] : null);
  const envelopeOf = (o) => {
    const note = seen(o);
    return note && typeof note.envelope === "string" ? note.envelope : o.envelope;
  };
  const fieldsOf = (o) => {
    const note = seen(o);
    if (!note || !Array.isArray(note.untyped) || !note.untyped.length) return o.fields;
    return o.fields.map((f) => (note.untyped.includes(f.path) ? { path: f.path, type: "any" } : f));
  };

  const op = (id) => {
    const found = byId.get(id);
    if (!found) throw new FeedRequestError(id, null, "unknown-operation", "is not in the catalog");
    return found;
  };

  const find = (method, pathTemplate) => byRoute.get(`${String(method).toUpperCase()} ${pathTemplate}`) || null;

  const request = (id, params, options) => {
    const o = op(id);
    const opts = options || {};
    if (o.kind === "socket" || o.kind === "none") throw new FeedRequestError(o.id, null, "not-a-request", "is a socket channel page, not a request");
    if (o.method !== "GET" && opts.write !== true) throw new FeedRequestError(o.id, null, "write", `is a ${o.method}; it is built only when the caller passes write: true`);
    if (params !== undefined && params !== null && !isObj(params)) throw new FeedRequestError(o.id, null, "params", "the parameters must be an object");
    const given = params || {};
    const known = new Set(o.params.map((p) => p.name));
    for (const key of Object.keys(given)) {
      if (!known.has(key)) throw new FeedRequestError(o.id, key, "unknown", "is not a documented parameter");
    }
    const segments = new Map();
    const query = [];
    for (const p of o.params) {
      const raw = given[p.name];
      const absent = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);
      if (absent) {
        if (p.required) throw new FeedRequestError(o.id, p.name, "missing", "is missing");
        continue;
      }
      if (p.type === "array") {
        if (!Array.isArray(raw)) throw new FeedRequestError(o.id, p.name, "type", "must be a list");
        for (const item of raw) {
          if (item === undefined || item === null || item === "") throw new FeedRequestError(o.id, p.name, "type", "holds an empty item");
          query.push([p.name, paramText(o, p, item, p.items)]);
        }
        continue;
      }
      const text = paramText(o, p, raw, p.type);
      if (p.in === "path") segments.set(p.name, text);
      else query.push([p.name, text]);
    }
    const path = o.path.replace(TOKEN, (_, name) => {
      if (!segments.has(name)) throw new FeedRequestError(o.id, name, "missing", "is missing");
      return encodeURIComponent(segments.get(name));
    });
    const search = query.length ? `?${new URLSearchParams(query).toString()}` : "";
    const out = { id: o.id, method: o.method, path, query, search };
    const body = bodyOf(o, opts.body);
    if (body !== undefined) out.body = body;
    return out;
  };

  const read = (id, body) => {
    const o = op(id);
    if (o.kind !== "json") throw new FeedRequestError(o.id, null, "not-a-request", "does not answer JSON, so it has no body to read");
    const key = envelopeOf(o);
    const bare = Array.isArray(body) && o.documents !== "envelope";
    if (!bare && (!isObj(body) || !Object.hasOwn(body, key))) return fail("unshaped");
    const strays = new Set();
    const root = shape(o.id, fieldsOf(o));
    let data;
    const meta = {};
    try {
      if (o.documents === "envelope") {
        const whole = readKeys(root, body, strays);
        for (const name of Object.keys(whole)) if (name !== key) put(meta, name, whole[name]);
        data = whole[key];
      } else {
        if (!bare) for (const name of Object.keys(body)) if (name !== key) put(meta, name, body[name]);
        const inner = bare ? body : body[key];
        if (inner === null) data = null;
        else if (o.documents === "open") {
          if (!isObj(inner) && !Array.isArray(inner)) return fail("unshaped");
          data = inner;
        } else if (o.documents === "list") {
          if (!Array.isArray(inner)) return fail("unshaped");
          data = root.item === null ? inner.slice() : inner.map((v) => readNode(root.item, v, strays));
        } else if (Array.isArray(inner)) {
          if (!inner.every(isObj)) return fail("unshaped");
          data = inner.map((row) => readKeys(root, row, strays));
        } else if (isObj(inner)) data = readKeys(root, inner, strays);
        else return fail("unshaped");
      }
    } catch (error) {
      if (error instanceof Mistyped) return fail(`type:${error.at}`);
      throw error;
    }
    if (isEmpty(data)) return fail("empty");
    return { ok: true, data, rows: Array.isArray(data) ? data : [data], meta, undocumented: [...strays].sort() };
  };

  const channel = (id) => {
    const found = channels.get(id);
    if (!found) throw new FeedRequestError(id, null, "unknown-channel", "is not a documented channel");
    return found;
  };

  const channelOf = (name) => {
    if (typeof name !== "string") return null;
    const at = name.indexOf(":");
    if (at < 0) return channels.has(name) ? { entry: channels.get(name), ticker: null } : null;
    const entry = channels.get(`${name.slice(0, at)}:<T>`);
    const ticker = name.slice(at + 1);
    return entry && SYMBOL.test(ticker) ? { entry, ticker } : null;
  };

  const join = (id, ticker) => {
    const c = channel(id);
    if (c.scope === "ticker") {
      if (typeof ticker !== "string" || !SYMBOL.test(ticker)) throw new FeedRequestError(c.id, "ticker", "ticker", "must be a symbol in capitals");
    } else if (ticker !== undefined && ticker !== null) throw new FeedRequestError(c.id, "ticker", "ticker", "is not taken by a channel that covers every name");
    const name = c.scope === "ticker" ? `${c.family}:${ticker}` : c.id;
    return { channel: name, message: JSON.stringify({ channel: name, msg_type: FEED_JOIN }) };
  };

  const frame = (input) => {
    let msg = input;
    if (typeof input === "string") {
      try { msg = JSON.parse(input); } catch { return fail("unshaped"); }
    }
    if (!Array.isArray(msg) || msg.length < 2 || typeof msg[0] !== "string" || !isObj(msg[1])) return fail("unshaped");
    const [name, payload] = msg;
    if (typeof payload.status === "string" && Object.hasOwn(payload, "response")) return { ok: true, kind: "ack", channel: name, status: payload.status };
    const found = channelOf(name);
    if (!found) return fail("unshaped");
    if (!Object.keys(payload).length) return fail("empty");
    const strays = new Set();
    let read;
    try {
      read = readKeys(shape(`channel ${found.entry.id}`, found.entry.fields), payload, strays);
    } catch (error) {
      if (error instanceof Mistyped) return fail(`type:${error.at}`);
      throw error;
    }
    return { ok: true, kind: "data", channel: found.entry.id, family: found.entry.family, ticker: found.ticker, payload: read, undocumented: [...strays].sort() };
  };

  return Object.freeze({ catalog, op, find, request, read, envelope: (id) => envelopeOf(op(id)), channel, join, frame });
}

const templateOf = (path) => String(path).split("/");

export function registryJoin(catalog, registry) {
  const byRoute = new Map(catalog.ops.map((o) => [`${o.method} ${o.path}`, o]));
  const readers = new Map(catalog.ops.map((o) => [o.id, []]));
  const absent = [];
  const pages = [];
  for (const e of registry) {
    const o = byRoute.get(`${e.method} ${e.op}`);
    if (!o) { absent.push(e.id); continue; }
    if (o.kind === "socket") pages.push(e.id);
    readers.get(o.id).push(e.id);
  }
  return { readers, absent, pages };
}

export function registryParams(entry) {
  const call = templateOf(entry.path);
  const template = templateOf(entry.op);
  const fixed = {};
  if (call.length !== template.length) return null;
  for (let i = 0; i < template.length; i++) {
    const m = /^\{([^{}]+)\}$/.exec(template[i]);
    if (!m) { if (template[i] !== call[i]) return null; continue; }
    if (call[i] !== template[i]) fixed[m[1]] = decodeURIComponent(call[i]);
  }
  return fixed;
}

export function feedCoverage(catalog, { registry = [], rail = {}, joined = {} } = {}) {
  const { readers, absent, pages } = registryJoin(catalog, registry);
  const requests = catalog.ops.filter((o) => o.kind === "json" || o.kind === "file");
  const read = requests.filter((o) => readers.get(o.id).length > 0);
  const unread = requests.filter((o) => readers.get(o.id).length === 0);
  const byTag = {};
  for (const o of requests) {
    const tag = o.tags[0] || "untagged";
    const row = byTag[tag] || (byTag[tag] = { documented: 0, read: 0, unread: [] });
    row.documented += 1;
    if (readers.get(o.id).length) row.read += 1;
    else row.unread.push(o.id);
  }
  const railChannels = new Map();
  for (const [topic, row] of Object.entries(rail)) for (const c of row.channels || []) railChannels.set(c, topic);
  const joinedChannels = new Set(Object.values(joined).map((row) => row.template));
  const documented = new Set(catalog.channels.map((c) => c.id));
  return {
    operations: {
      documented: catalog.ops.length,
      requests: requests.length,
      pages: catalog.ops.length - requests.length,
      read: read.length,
      unread: unread.map((o) => o.id),
      byTag,
      readers: Object.fromEntries([...readers].filter(([, ids]) => ids.length)),
    },
    registry: { entries: registry.length, absent, pages },
    channels: {
      documented: catalog.channels.length,
      listed: catalog.channels.filter((c) => railChannels.has(c.id)).map((c) => c.id),
      joined: catalog.channels.filter((c) => joinedChannels.has(c.id)).map((c) => c.id),
      unread: catalog.channels.filter((c) => !joinedChannels.has(c.id)).map((c) => c.id),
      undocumented: [...new Set([...railChannels.keys(), ...joinedChannels])].filter((c) => !documented.has(c)).sort(),
    },
  };
}

export async function loadFeedClient() {
  const { FEED_CATALOG } = await import("./flows-feed-catalog.js");
  return createFeedClient(FEED_CATALOG);
}
