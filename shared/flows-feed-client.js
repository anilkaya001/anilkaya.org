export const FEED_CATALOG_VERSION = 1;

export const FEED_READ_FAILURES = Object.freeze(["unshaped", "type", "empty"]);

export const FEED_REFUSALS = Object.freeze(["unknown-operation", "not-a-request", "held", "write", "params", "unknown", "missing", "place", "type", "format", "enum", "min", "max", "pattern", "segment", "unknown-channel", "ticker"]);

export const FEED_READ_FORMS = Object.freeze(["wrapped", "bare", "unwrapped"]);

export const FEED_JOIN = "join";

export const FEED_WIRE = Object.freeze({
  "short.short-volume-and-ratio": Object.freeze({ envelope: "si" }),
});

const MACRO_RULES = "docs/packages/WP5-cross-asset-macro.md 2.3";
const EVENT_RULES = "docs/packages/WP6-event-risk.md 3";

export const FEED_HELD = Object.freeze({
  "alerts.create-config": Object.freeze({ reason: "The site reads the feed and writes nothing to it.", cite: EVENT_RULES }),
  "prediction.search-users": Object.freeze({ reason: "The site does not look people up.", cite: MACRO_RULES }),
});

export const FEED_HELD_FIELDS = Object.freeze([
  Object.freeze({
    rule: "wallet", ops: Object.freeze(["crypto.", "prediction."]), cite: MACRO_RULES, reason: "Wallet addresses are not shown.",
    names: Object.freeze(["address", "counterparty_address", "from_address", "maker_address", "taker_address", "to_address", "transaction_hash", "user_address", "user_name"]),
  }),
  Object.freeze({
    rule: "leaders", ops: Object.freeze(["private-markets."]), cite: MACRO_RULES, reason: "Leaders are counted by title; names are not shown.",
    names: Object.freeze(["first_name", "last_name"]),
  }),
  Object.freeze({
    rule: "seasonal-averages", ops: Object.freeze(["seasonality."]), cite: MACRO_RULES, reason: "The feed describes the average as per day for the month; the site computes its own from each year's open and close.",
    names: Object.freeze(["avg_change", "max_change", "median_change", "min_change", "positive_months_perc"]),
  }),
  Object.freeze({
    rule: "scores", ops: Object.freeze(["crypto.", "prediction."]), cite: MACRO_RULES, reason: "The feed's scores are not explained, so they are not shown.",
    names: Object.freeze(["invested_zscore", "pnl_percent", "smart_gap", "smart_score", "tags_score", "unusual_score", "whale_score"]),
  }),
  Object.freeze({
    rule: "spot-volume", ops: Object.freeze(["digital-currencies.", "forex."]), cite: MACRO_RULES, reason: "Spot FX has no consolidated volume.",
    names: Object.freeze(["volume"]),
  }),
]);

const holdCovers = (hold, id) => hold.ops.some((scope) => (scope.endsWith(".") ? id.startsWith(scope) : id === scope));

export function heldFieldsOf(id, holds = FEED_HELD_FIELDS) {
  const out = new Map();
  for (const hold of holds) {
    if (!holdCovers(hold, String(id))) continue;
    for (const name of hold.names) if (!out.has(name)) out.set(name, hold.rule);
  }
  return out;
}

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
  if (n === 0 && /[1-9]/.test(value.split(/[eE]/)[0])) return { ok: false };
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

const joined = (base, key) => (base === "" ? key : `${base}.${key}`);

function passed(ctx, value, at) {
  if (ctx.held.size === 0 || value === null || typeof value !== "object") return value;
  const top = Array.isArray(value) ? [] : {};
  const todo = [[value, top, at]];
  while (todo.length) {
    const [from, to, where] = todo.pop();
    const list = Array.isArray(from);
    for (const key of list ? from.keys() : Object.keys(from)) {
      const here = list ? `${where}[]` : joined(where, key);
      if (!list && ctx.held.has(key)) { ctx.withheld.add(here); continue; }
      const v = from[key];
      if (v === null || typeof v !== "object") { put(to, key, v); continue; }
      const next = Array.isArray(v) ? [] : {};
      put(to, key, next);
      todo.push([v, next, here]);
    }
  }
  return top;
}

function readLeaf(ctx, entry, value) {
  if (entry.type === "any") return passed(ctx, value, entry.path);
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

function readNode(ctx, node, value) {
  if (value === null) return null;
  const entry = node.entry;
  if (entry.type === "object") {
    if (!isObj(value)) throw new Mistyped(entry.path);
    return readKeys(ctx, node, value);
  }
  if (entry.type === "array") {
    if (!Array.isArray(value)) throw new Mistyped(entry.path);
    return node.item === null ? passed(ctx, value.slice(), entry.path) : value.map((v) => readNode(ctx, node.item, v));
  }
  return readLeaf(ctx, entry, value);
}

function readKeys(ctx, node, value) {
  const out = {};
  const base = node.entry === null ? "" : node.entry.path;
  const free = node.entry !== null && (node.entry.open === true || node.children.size === 0);
  for (const key of Object.keys(value)) {
    const here = joined(base, key);
    if (ctx.held.has(key)) { ctx.withheld.add(here); continue; }
    const child = node.children.get(key);
    if (child === undefined) {
      if (!free) ctx.strays.add(here);
      put(out, key, passed(ctx, value[key], here));
    } else put(out, key, readNode(ctx, child, value[key]));
  }
  return out;
}

const NO_HOLDS = new Map();
const reading = (held) => ({ held, strays: new Set(), withheld: new Set() });

const wellFormed = (text) => {
  try { encodeURIComponent(text); } catch { return false; }
  return true;
};

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
  if (typeof value === "string" && !wellFormed(value)) refuse("type", "must be well-formed text; it holds half of a surrogate pair");
  if (p.enum !== undefined && !p.enum.map(String).includes(text)) refuse("enum", `is not one of the documented values (${p.enum.join(", ")})`);
  if (p.pattern !== undefined && typeof value === "string") {
    let re = null;
    try { re = new RegExp(p.pattern); } catch { re = null; }
    if (re && !re.test(value)) refuse("pattern", `does not match the documented pattern ${p.pattern}`);
  }
  return text;
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
  const holds = new Map();
  const heldIn = (o) => {
    if (!holds.has(o.id)) holds.set(o.id, heldFieldsOf(o.id));
    return holds.get(o.id);
  };
  const seen = (o) => (Object.hasOwn(wire, o.id) && isObj(wire[o.id]) ? wire[o.id] : null);
  const observed = (o) => {
    const note = seen(o);
    return note && typeof note.envelope === "string" ? note.envelope : null;
  };
  const envelopeOf = (o) => observed(o) || o.envelope;
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

  const held = (id) => (Object.hasOwn(FEED_HELD, id) ? FEED_HELD[id] : null);

  const allowed = (id) => {
    const o = op(id);
    const hold = held(o.id);
    if (hold) throw new FeedRequestError(o.id, null, "held", `is held and never asked for: ${hold.reason} (${hold.cite})`);
    return o;
  };

  const request = (id, params) => {
    const o = allowed(id);
    if (o.method !== "GET") throw new FeedRequestError(o.id, null, "write", `is a ${o.method}; this client builds reads only`);
    if (o.kind === "socket") throw new FeedRequestError(o.id, null, "not-a-request", "is a socket channel page, not a request");
    if (o.kind === "none") throw new FeedRequestError(o.id, null, "not-a-request", "documents no answer, so there is nothing to ask it for");
    if (params !== undefined && params !== null && !isObj(params)) throw new FeedRequestError(o.id, null, "params", "the parameters must be an object");
    const given = params || {};
    const known = new Set(o.params.map((p) => p.name));
    for (const key of Object.keys(given)) {
      if (!known.has(key)) throw new FeedRequestError(o.id, key, "unknown", "is not a documented parameter");
    }
    const segments = new Map();
    const query = [];
    for (const p of o.params) {
      if (p.in !== "path" && p.in !== "query") throw new FeedRequestError(o.id, p.name, "place", `is documented in the ${String(p.in)}, where this client sends nothing`);
      const raw = given[p.name];
      const absent = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);
      if (absent) {
        if (p.required) throw new FeedRequestError(o.id, p.name, "missing", "is missing");
        continue;
      }
      if (p.type === "array") {
        if (!Array.isArray(raw)) throw new FeedRequestError(o.id, p.name, "type", "must be a list");
        if (p.in === "path") throw new FeedRequestError(o.id, p.name, "place", "is a list, which a path segment cannot carry");
        for (const item of raw) {
          if (item === undefined || item === null || item === "") throw new FeedRequestError(o.id, p.name, "type", "holds an empty item");
          query.push([p.name, paramText(o, p, item, p.items)]);
        }
        continue;
      }
      const text = paramText(o, p, raw, p.type);
      if (p.in === "query") { query.push([p.name, text]); continue; }
      if (text === "." || text === "..") throw new FeedRequestError(o.id, p.name, "segment", "is a dot segment, which an address reads as another path");
      segments.set(p.name, text);
    }
    const path = o.path.replace(TOKEN, (_, name) => {
      if (!segments.has(name)) throw new FeedRequestError(o.id, name, "missing", "is missing");
      return encodeURIComponent(segments.get(name));
    });
    const search = query.length ? `?${new URLSearchParams(query).toString()}` : "";
    return { id: o.id, method: o.method, path, query, search };
  };

  const read = (id, body) => {
    const o = allowed(id);
    if (o.kind !== "json") throw new FeedRequestError(o.id, null, "not-a-request", "does not answer JSON, so it has no body to read");
    const key = envelopeOf(o);
    const root = shape(o.id, fieldsOf(o));
    const bare = Array.isArray(body) && o.documents !== "envelope";
    const wrapped = !bare && isObj(body) && Object.hasOwn(body, key);
    const loose = !bare && !wrapped && isObj(body) && o.envelopeFrom === "assumed" && observed(o) === null &&
      (o.documents === "open" || (o.documents === "row" && Object.keys(body).some((name) => root.children.has(name))));
    if (!bare && !wrapped && !loose) return fail("unshaped");
    const ctx = reading(heldIn(o));
    let data;
    const meta = {};
    try {
      if (o.documents === "envelope") {
        const whole = readKeys(ctx, root, body);
        for (const name of Object.keys(whole)) if (name !== key) put(meta, name, whole[name]);
        data = whole[key];
      } else {
        if (wrapped) {
          for (const name of Object.keys(body)) {
            if (name === key) continue;
            if (ctx.held.has(name)) ctx.withheld.add(name);
            else put(meta, name, passed(ctx, body[name], name));
          }
        }
        const inner = wrapped ? body[key] : body;
        if (inner === null) data = null;
        else if (o.documents === "open") {
          if (!isObj(inner) && !Array.isArray(inner)) return fail("unshaped");
          data = passed(ctx, inner, "");
        } else if (o.documents === "list") {
          if (!Array.isArray(inner)) return fail("unshaped");
          data = root.item === null ? passed(ctx, inner.slice(), "") : inner.map((v) => readNode(ctx, root.item, v));
        } else if (Array.isArray(inner)) {
          if (!inner.every(isObj)) return fail("unshaped");
          data = inner.map((row) => readKeys(ctx, root, row));
        } else if (isObj(inner)) data = readKeys(ctx, root, inner);
        else return fail("unshaped");
      }
    } catch (error) {
      if (error instanceof Mistyped) return fail(`type:${error.at}`);
      throw error;
    }
    if (isEmpty(data)) return fail("empty");
    return {
      ok: true, data, rows: Array.isArray(data) ? data : [data], meta, form: bare ? "bare" : wrapped ? "wrapped" : "unwrapped",
      undocumented: [...ctx.strays].sort(), withheld: [...ctx.withheld].sort(),
    };
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
    const ctx = reading(NO_HOLDS);
    let got;
    try {
      got = readKeys(ctx, shape(`channel ${found.entry.id}`, found.entry.fields), payload);
    } catch (error) {
      if (error instanceof Mistyped) return fail(`type:${error.at}`);
      throw error;
    }
    return { ok: true, kind: "data", channel: found.entry.id, family: found.entry.family, ticker: found.ticker, payload: got, undocumented: [...ctx.strays].sort() };
  };

  return Object.freeze({ catalog, op, find, held, request, read, envelope: (id) => envelopeOf(op(id)), channel, join, frame });
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
  const isHeld = (o) => Object.hasOwn(FEED_HELD, o.id);
  const read = requests.filter((o) => readers.get(o.id).length > 0);
  const held = requests.filter((o) => isHeld(o) && readers.get(o.id).length === 0);
  const unread = requests.filter((o) => !isHeld(o) && readers.get(o.id).length === 0);
  const byTag = {};
  for (const o of requests) {
    const tag = o.tags[0] || "untagged";
    const row = byTag[tag] || (byTag[tag] = { documented: 0, read: 0, unread: [], held: [] });
    row.documented += 1;
    if (readers.get(o.id).length) row.read += 1;
    else if (isHeld(o)) row.held.push(o.id);
    else row.unread.push(o.id);
  }
  const fieldHolds = FEED_HELD_FIELDS.map((hold) => {
    const fields = [];
    for (const o of catalog.ops) {
      if (!holdCovers(hold, o.id) || isHeld(o)) continue;
      for (const f of o.fields) if (hold.names.includes(f.path.replace(/\[\]/g, "").split(".").pop())) fields.push(`${o.id} ${f.path}`);
    }
    return { rule: hold.rule, reason: hold.reason, cite: hold.cite, fields };
  });
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
      held: held.map((o) => ({ id: o.id, reason: FEED_HELD[o.id].reason, cite: FEED_HELD[o.id].cite })),
      heldAndRead: read.filter(isHeld).map((o) => o.id),
      fieldHolds,
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
