import { FRESH_CLASSES, freshnessState, isWeekdayDay, sessionOpen } from "./flows-freshness.js";
import {
  LIVE_BUDGET, TIER1_CALLS, STRIP_FIELDS, TICKER_RE, timeMs, rowsOf, shapeStrips, shapeGexSeries, shapeMarketLive,
  alertsCursor, lagSeconds, stripNames, gexRotation,
} from "./flows-live.js";
import { alertRow, alertKey } from "./flows-alerts.js";
import { focusStripNames } from "./flows-focus.js";

export { TICKER_RE };

export const RT_VERSION = 1;

export const RT_OBJECT_NAME = "pulse:1";

export const RT_TOPIC_KEYS = Object.freeze(["px", "fl", "gx", "mk", "nw"]);

export const RT_KINDS = Object.freeze([...RT_TOPIC_KEYS, "ctl"]);

export const RT_CTL = Object.freeze(["hello", "hb", "resync", "degraded", "closed", "bye"]);

export const RT_ENVELOPE_KEYS = Object.freeze(["v", "k", "ep", "sq", "at", "snap", "fresh", "meta", "rows"]);

export const RT_CLIENT_TYPES = Object.freeze(["sub", "p", "rs"]);

export const RT_CLIENT_MAX_BYTES = 256;

export const RT_CLOSE = Object.freeze({
  normal: 1000, goingAway: 1001, policy: 1008, tooBig: 1009,
  expired: 4001, audience: 4003, laggard: 4008, cap: 4009, off: 4011, full: 4012,
});

export const RT_LIMITS = Object.freeze({
  userSockets: 3,
  sockets: 200,
  laggardFrames: 10,
  snapLingerMs: 60 * 1000,
  snapWaitMs: 3000,
  hbMs: 5000,
  closedHbMs: 30 * 1000,
  closedTickMs: 30 * 1000,
  tickMs: 1000,
  rsMinGapMs: 2000,
  messageBurst: 20,
  messageWindowMs: 10 * 1000,
  focusMax: 8,
  gexFocusEvery: 4,
  rosterMs: 5 * 60 * 1000,
  callsPerMinute: 240,
  callTimeoutMs: 4000,
  degradeAfterMs: 15 * 1000,
  failCapMs: 15 * 1000,
  pause429MaxMs: 120 * 1000,
  pause429BaseMs: 5 * 1000,
  flowOverlapMs: 30 * 1000,
  flowLimit: 200,
  seenMax: 1000,
  newsLimit: 100,
  lagSamples: 256,
  ringMax: 200,
});

export const RT_TOPICS = Object.freeze({
  px: Object.freeze({ k: "px", klass: "rt", cadenceMs: 5000, merge: "latest", key: "live:strips", stamp: "rows", barS: 0, rowMax: 200 }),
  fl: Object.freeze({ k: "fl", klass: "rt", cadenceMs: 5000, merge: "append", key: "live:alerts", stamp: "event", barS: 0, rowMax: 200 }),
  gx: Object.freeze({ k: "gx", klass: "rtSlow", cadenceMs: 1000, merge: "latest", key: "live:gex", stamp: "rows", barS: 60, rowMax: 64 }),
  mk: Object.freeze({ k: "mk", klass: "rtSlow", cadenceMs: 10000, merge: "latest", key: "live:market", stamp: "rows", barS: 300, rowMax: 16 }),
  nw: Object.freeze({ k: "nw", klass: "rtNews", cadenceMs: 30000, merge: "append", key: "live:news", stamp: "event", barS: 0, rowMax: 60 }),
});

export const RT_ROW_FIELDS = Object.freeze({
  px: Object.freeze(["t", "qt", ...STRIP_FIELDS.map(([name]) => name)]),
  gx: Object.freeze(["t", "at", "px", "gOi", "gVol", "gDir", "flow", "lagS"]),
});

export const RT_UPSTREAM = Object.freeze({
  px: Object.freeze({
    scope: "ticker", channels: Object.freeze(["price:<T>", "stock_screener"]),
    rest: (a) => [{ feed: "px", path: "/api/screener/stocks", params: { ticker: a.names.join(","), limit: 500 } }],
  }),
  fl: Object.freeze({
    scope: "global", channels: Object.freeze(["flow-alerts"]),
    rest: (a) => [{ feed: "fl", path: "/api/option-trades/flow-alerts", params: { limit: RT_LIMITS.flowLimit, newer_than: a.newerThan } }],
  }),
  gx: Object.freeze({
    scope: "ticker", channels: Object.freeze(["gex:<T>"]),
    rest: (a) => [{ feed: "gx", path: `/api/stock/${encodeURIComponent(a.name)}/spot-exposures`, params: {} }],
  }),
  mk: Object.freeze({
    scope: "global", channels: Object.freeze(["market_tide", "net_flow:<T>"]),
    rest: () => TIER1_CALLS.map((c) => ({ feed: c.feed, path: c.path, params: { ...c.params } })),
  }),
  nw: Object.freeze({
    scope: "global", channels: Object.freeze(["news"]),
    rest: () => [{ feed: "nw", path: "/api/news/headlines", params: { limit: RT_LIMITS.newsLimit } }],
  }),
});

export const RT_UPSTREAM_API = Object.freeze({
  methods: Object.freeze(["start(plan, handlers)", "stop()", "tick(now)", "paused(now)", "state()"]),
  plan: Object.freeze(["topics", "ready()", "session()", "names()", "gex()", "base()", "stage(ticker)"]),
  frame: Object.freeze(["k", "readAt", "items", "vendorAt", "meta", "full", "answered"]),
  error: Object.freeze(["k", "at", "code", "status", "throttled", "retryAt"]),
});

export const RT_OWNER_DEFAULT = "anilkaya";

const RT_HINTS = Object.freeze(["wnam", "enam", "sam", "weur", "eeur", "apac", "oc", "afr", "me"]);

export function rtSwitches(env) {
  const e = env || {};
  const word = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const listed = typeof e.FLOWS_RT_USERS === "string" ? e.FLOWS_RT_USERS : RT_OWNER_DEFAULT;
  const hint = word(e.FLOWS_RT_HINT);
  return {
    mode: word(e.FLOWS_RT_MODE) === "on" ? "on" : "off",
    audience: word(e.FLOWS_RT_AUDIENCE) === "members" ? "members" : "owner",
    users: listed.split(",").map(word).filter((x) => /^[a-z0-9_.-]{3,32}$/.test(x)),
    hint: RT_HINTS.includes(hint) ? hint : null,
  };
}

export const rtIsOwner = (sw, username) => sw.users.includes(username);

export const rtAdmits = (sw, username) => sw.audience === "members" || rtIsOwner(sw, username);

const iso = (v) => (Number.isFinite(v) ? new Date(v).toISOString() : null);

const nearestRank = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null);

export function frame(k, { ep, sq, at, snap = false, fresh = null, meta = null, rows = [] }) {
  const out = { v: RT_VERSION, k, ep, sq, at };
  if (snap) out.snap = true;
  if (fresh) out.fresh = fresh;
  out.meta = meta || {};
  out.rows = rows;
  return out;
}

export function ctlFrame(t, { ep, at, meta = null, rows = [] }) {
  return { v: RT_VERSION, k: "ctl", ep, sq: 0, at, t, meta: meta || {}, rows };
}

export function checkFrame(f) {
  const bad = [];
  if (!f || typeof f !== "object" || Array.isArray(f)) return ["not an object"];
  if (f.v !== RT_VERSION) bad.push("v");
  if (!RT_KINDS.includes(f.k)) bad.push("k");
  if (!Number.isSafeInteger(f.ep) || f.ep <= 0) bad.push("ep");
  if (!Number.isSafeInteger(f.sq) || f.sq < 0) bad.push("sq");
  if (!Number.isSafeInteger(f.at) || f.at <= 0) bad.push("at");
  if (f.snap !== undefined && f.snap !== true) bad.push("snap");
  if (!f.meta || typeof f.meta !== "object" || Array.isArray(f.meta)) bad.push("meta");
  if (!Array.isArray(f.rows)) bad.push("rows");
  if (f.k === "ctl") {
    if (!RT_CTL.includes(f.t)) bad.push("t");
    if (f.sq !== 0) bad.push("ctl sq");
  } else if (f.fresh !== undefined) {
    const e = f.fresh;
    const need = e && e.state === "pending" ? ["state", "reason", "klass"]
      : ["state", "reason", "klass", "cadenceS", "source", "session", "updatedAt", "readAt", "liveUntil", "staleAt"];
    for (const key of need) if (!e || !(key in e)) bad.push("fresh." + key);
  }
  for (const key of Object.keys(f)) if (!RT_ENVELOPE_KEYS.includes(key) && key !== "t") bad.push("extra." + key);
  return bad;
}

export function pendingStream(k) {
  return { state: "pending", reason: "unpublished", klass: RT_TOPICS[k].klass };
}

export function streamEntry({ k, readAt, vendorAt = null, session, now, clock = null, updatedAt = null }) {
  const spec = RT_TOPICS[k];
  const cls = FRESH_CLASSES[spec.klass];
  const f = freshnessState({ klass: spec.klass, readAt, session, source: "hub" }, now, clock);
  let { state, reason, liveUntil } = f;
  if (spec.stamp === "rows" && state === "live") {
    const stamped = Number.isFinite(vendorAt);
    const lag = stamped ? lagSeconds(readAt, vendorAt) : null;
    if (!stamped) { state = "fresh"; reason = "vendor-unstamped"; liveUntil = null; }
    else if (lag === null) { state = "fresh"; reason = "vendor-skew"; liveUntil = null; }
    else if (lag > cls.staleS + spec.barS) { state = "stale"; reason = "vendor-lag"; liveUntil = null; }
    else if (lag > cls.liveS + spec.barS) { state = "fresh"; reason = "vendor-lag"; liveUntil = null; }
  }
  return {
    state, reason, klass: spec.klass, cadenceS: cls.cadenceS, source: "hub", session: f.session,
    updatedAt: updatedAt || null, readAt: iso(f.readAt), liveUntil: iso(liveUntil), staleAt: iso(f.staleAt),
  };
}

const BADNESS = Object.freeze({ closed: 0, live: 1, pending: 2, fresh: 3, stale: 4 });

export function worstEntry(entries) {
  let worst = null;
  for (const e of entries) if (e && (worst === null || (BADNESS[e.state] ?? 4) > (BADNESS[worst.state] ?? 4))) worst = e;
  return worst;
}

export function entryHeaders(entry, now, phase = null) {
  const e = entry || { state: "pending", reason: "unpublished", klass: "rt" };
  return {
    "X-Fresh-State": e.state,
    "X-Fresh-Reason": e.reason || "",
    "X-Fresh-Class": e.klass || "",
    "X-Fresh-Read-At": e.readAt || "",
    "X-Fresh-Source": e.source || "hub",
    "X-Fresh-Cadence": String(e.cadenceS ?? 0),
    "X-Fresh-Session": e.session || "",
    "X-Fresh-Live-Until": e.liveUntil || "",
    "X-Fresh-Stale-At": e.staleAt || "",
    "X-Fresh-Phase": phase ? phase.phase : "",
    "X-Fresh-Phase-Ends": phase && Number.isFinite(phase.endsAt) ? iso(phase.endsAt) : "",
    "X-Server-Now": String(now),
  };
}

export function inSession(phase) {
  return !!phase && phase.trading === true && (phase.phase === "pre" || phase.phase === "rth" || phase.phase === "post");
}

export function closedInfo(phase) {
  if (!phase) return { phase: null, reason: "no-clock", day: null, lastClosed: null, nextOpenAt: null, nextRthOpenAt: null };
  return {
    phase: phase.phase,
    reason: !isWeekdayDay(phase.day) ? "weekend" : !phase.trading ? "holiday" : "overnight",
    day: phase.day,
    lastClosed: phase.lastClosed || null,
    nextOpenAt: iso(phase.endsAt),
    nextRthOpenAt: iso(phase.nextOpen),
  };
}

export function parseClientMessage(data) {
  if (typeof data !== "string") return { ok: false, why: "binary" };
  if (data.length > RT_CLIENT_MAX_BYTES || new TextEncoder().encode(data).length > RT_CLIENT_MAX_BYTES) return { ok: false, why: "too-big" };
  let m = null;
  try { m = JSON.parse(data); } catch { return { ok: false, why: "json" }; }
  if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, why: "shape" };
  const only = (allowed) => Object.keys(m).every((key) => allowed.includes(key));
  if (m.t === "sub") {
    if (!only(["t", "k", "f"]) || !Array.isArray(m.k) || m.k.length > RT_TOPIC_KEYS.length) return { ok: false, why: "sub" };
    const topics = [];
    for (const k of m.k) {
      if (typeof k !== "string" || !RT_TOPIC_KEYS.includes(k)) return { ok: false, why: "sub.k" };
      if (!topics.includes(k)) topics.push(k);
    }
    let f;
    if (Object.hasOwn(m, "f")) {
      if (m.f === null || m.f === "") f = null;
      else if (typeof m.f === "string" && TICKER_RE.test(m.f.trim().toUpperCase())) f = m.f.trim().toUpperCase();
      else return { ok: false, why: "sub.f" };
    }
    return { ok: true, msg: { t: "sub", k: topics, f } };
  }
  if (m.t === "p") {
    if (!only(["t", "sq"]) || !m.sq || typeof m.sq !== "object" || Array.isArray(m.sq)) return { ok: false, why: "p" };
    const sq = {};
    for (const [k, v] of Object.entries(m.sq)) {
      if (!RT_TOPIC_KEYS.includes(k) || !Number.isSafeInteger(v) || v < 0) return { ok: false, why: "p.sq" };
      sq[k] = v;
    }
    return { ok: true, msg: { t: "p", sq } };
  }
  if (m.t === "rs") {
    if (!only(["t", "k"]) || typeof m.k !== "string" || !RT_TOPIC_KEYS.includes(m.k)) return { ok: false, why: "rs" };
    return { ok: true, msg: { t: "rs", k: m.k } };
  }
  return { ok: false, why: "type" };
}

export function createSeq() {
  let ep = null;
  const held = Object.create(null);
  return {
    accept(f) {
      if (!f || f.k === "ctl") return { verdict: "ctl", missed: 0 };
      if (f.ep !== ep) {
        ep = f.ep;
        for (const k of Object.keys(held)) delete held[k];
        held[f.k] = f.sq;
        return { verdict: f.snap ? "epoch" : "orphan", missed: 0 };
      }
      if (f.snap) { held[f.k] = f.sq; return { verdict: "snap", missed: 0 }; }
      if (!(f.k in held)) { held[f.k] = f.sq; return { verdict: "orphan", missed: 0 }; }
      const expected = held[f.k] + 1;
      if (f.sq === expected) { held[f.k] = f.sq; return { verdict: "ok", missed: 0 }; }
      if (f.sq < expected) return { verdict: "dup", missed: 0 };
      const missed = f.sq - expected;
      held[f.k] = f.sq;
      return { verdict: "gap", missed };
    },
    held: () => ({ ep, ...held }),
  };
}

export function createCounter() {
  const sq = Object.create(null);
  for (const k of RT_TOPIC_KEYS) sq[k] = 0;
  return {
    next: (k) => ++sq[k],
    peek: (k) => sq[k],
    reset: () => { for (const k of RT_TOPIC_KEYS) sq[k] = 0; },
    all: () => ({ ...sq }),
  };
}

function makeRing(slots, unitMs) {
  const n = new Float64Array(slots);
  const at = new Float64Array(slots).fill(-1);
  return {
    add(now, c = 1) {
      const u = Math.floor(now / unitMs);
      const i = u % slots;
      if (at[i] !== u) { at[i] = u; n[i] = 0; }
      n[i] += c;
    },
    sum(now, span = slots) {
      const u = Math.floor(now / unitMs);
      let s = 0;
      for (let i = 0; i < slots; i++) if (at[i] >= 0 && u - at[i] >= 0 && u - at[i] < span) s += n[i];
      return s;
    },
  };
}

export function createBudget({ perMinute = RT_LIMITS.callsPerMinute } = {}) {
  const total = makeRing(60, 1000);
  const secs = new Map();
  const mins = new Map();
  const ring = (map, k, slots, unit) => {
    let r = map.get(k);
    if (!r) { r = makeRing(slots, unit); map.set(k, r); }
    return r;
  };
  return {
    perMinute,
    used: (now) => total.sum(now),
    take(topic, now, cost = 1) {
      if (total.sum(now) + cost > perMinute) return false;
      total.add(now, cost);
      ring(secs, topic, 60, 1000).add(now, cost);
      ring(mins, topic, 60, 60000).add(now, cost);
      return true;
    },
    minute(now) {
      const out = {};
      for (const k of RT_TOPIC_KEYS) out[k] = secs.has(k) ? secs.get(k).sum(now) : 0;
      return out;
    },
    hour(now) {
      const out = {};
      for (const k of RT_TOPIC_KEYS) out[k] = mins.has(k) ? mins.get(k).sum(now) : 0;
      return out;
    },
  };
}

export function createLagStats(cap = RT_LIMITS.lagSamples) {
  const buf = new Float64Array(cap);
  let n = 0;
  let head = 0;
  return {
    add(v) {
      if (!Number.isFinite(v)) return;
      buf[head] = v;
      head = (head + 1) % cap;
      if (n < cap) n++;
    },
    summary() {
      if (!n) return { n: 0, p50: null, p95: null, max: null };
      const xs = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
      return { n, p50: nearestRank(xs, 0.5), p95: nearestRank(xs, 0.95), max: xs[xs.length - 1] };
    },
  };
}

export function mergeLatest(held, items, { cap }) {
  const changed = [];
  for (const it of items) {
    const prev = held.get(it.key);
    if (prev) {
      if (it.stamp !== null && prev.stamp !== null && it.stamp < prev.stamp) continue;
      if (it.same(prev.value)) {
        if (it.stamp !== null && (prev.stamp === null || it.stamp > prev.stamp)) prev.stamp = it.stamp;
        continue;
      }
    } else if (held.size >= cap) continue;
    held.set(it.key, { stamp: it.stamp, value: it.value });
    changed.push(it);
  }
  return changed;
}

export function mergeAppend(ring, seen, items, { ringMax, seenMax, frameMax }) {
  const fresh = [];
  const ordered = items.slice().sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const it of ordered) {
    if (seen.has(it.id)) continue;
    seen.set(it.id, it.ts);
    if (seen.size > seenMax) seen.delete(seen.keys().next().value);
    fresh.push(it.row);
  }
  let dropped = 0;
  let out = fresh;
  if (out.length > frameMax) { dropped = out.length - frameMax; out = out.slice(-frameMax); }
  for (const row of out) ring.push(row);
  if (ring.length > ringMax) ring.splice(0, ring.length - ringMax);
  return { rows: out, dropped };
}

const QA = STRIP_FIELDS.length - 1;

const rowSame = (a, b) => {
  for (let i = 2; i < 2 + QA; i++) if (a[i] !== b[i]) return false;
  return true;
};

const sameJson = (value) => (prev) => JSON.stringify(prev) === JSON.stringify(value);

const alertTs = (r) => {
  for (const f of ["created_at", "end_time", "start_time"]) {
    const t = timeMs(r && r[f]);
    if (Number.isFinite(t)) return t;
  }
  return null;
};

export function shapePx(raw, { at, session, names, base = null }) {
  const shaped = shapeStrips(raw, { at, session, names, writer: "hub", key: "live:strips", base });
  const qtOf = new Map();
  for (const r of rowsOf(raw)) {
    if (!r || typeof r.ticker !== "string") continue;
    const t = r.ticker.trim().toUpperCase();
    if (qtOf.has(t)) continue;
    const q = timeMs(r.quote_time);
    qtOf.set(t, Number.isFinite(q) ? q : null);
  }
  const items = [];
  for (const [t, values] of Object.entries(shaped.rows)) {
    const bare = values.every((v) => v === null);
    items.push([t, bare ? null : (qtOf.get(t) ?? null), ...values]);
  }
  const vendorAt = shaped.fresh && shaped.fresh.vendorAt ? timeMs(shaped.fresh.vendorAt) : NaN;
  return {
    items, vendorAt: Number.isFinite(vendorAt) ? vendorAt : null,
    meta: {
      status: shaped.status, reason: shaped.reason || null, rowDate: shaped.rowDate || null,
      asked: shaped.asked, returned: shaped.returned ?? 0, ahead: shaped.ahead, off: shaped.off ? shaped.off.n : 0,
    },
    full: {
      missing: shaped.missing || [],
      prevFill: shaped.prevFill
        ? { date: shaped.prevFill.date, n: shaped.prevFill.n ?? 0, from: shaped.prevFill.from || null,
          agree: shaped.prevFill.agree, declined: shaped.prevFill.declined || null }
        : null,
    },
    answered: shaped.status !== "unavailable",
  };
}

export function shapeFl(raw, { stageOf = null, cursor = null }) {
  const list = rowsOf(raw);
  const items = [];
  let unusable = 0;
  let newest = NaN;
  for (const r of list) {
    const ts = alertTs(r);
    if (Number.isFinite(ts) && !(ts <= newest)) newest = ts;
    const row = alertRow(r, { stageOf, stageComplete: false });
    const rawId = r && r.id !== undefined && r.id !== null && r.id !== "" ? String(r.id) : null;
    const id = rawId !== null ? rawId : (row ? alertKey(row) : null);
    if (id === null || !row) { unusable++; continue; }
    items.push({ ...row, id, ts });
  }
  return {
    items, vendorAt: Number.isFinite(newest) ? newest : null,
    meta: { cursor: alertsCursor(list, cursor), read: list.length, unusable, page: list.length >= RT_LIMITS.flowLimit },
    full: {}, answered: true,
  };
}

export function shapeGx(raw, { name, at, session }) {
  const s = shapeGexSeries(raw, { session, now: at });
  if (s.status !== "ok") {
    return { items: [], vendorAt: null, meta: { polled: name, status: s.status, reason: s.reason || null }, full: {}, answered: true };
  }
  const last = s.last;
  const atMs = timeMs(last.at);
  const stamp = Number.isFinite(atMs) ? atMs : null;
  return {
    items: [[name, stamp, last.px, last.gOi, last.gVol, last.gDir, s.flowFilled ? 1 : 0, lagSeconds(at, last.at)]],
    vendorAt: stamp, meta: { polled: name, status: "ok", reason: null }, full: {}, answered: true,
  };
}

export function shapeMk(raws, { at, session }) {
  const payload = shapeMarketLive(raws, { at, session, writer: "hub" });
  const tide = payload.tide;
  const items = [];
  if (tide && tide.n > 0 && Array.isArray(tide.t)) {
    const i = tide.n - 1;
    items.push({ id: "tide", status: tide.status, date: tide.date, t: tide.t[i], ncp: tide.ncp[i], npp: tide.npp[i], net: tide.net[i], nv: tide.nv[i] });
  }
  for (const r of payload.sectors.rows || []) items.push({ id: r.etf, ...r });
  const lastAt = tide && tide.lastAt ? timeMs(tide.lastAt) : NaN;
  return {
    items, vendorAt: Number.isFinite(lastAt) ? lastAt : null,
    meta: {
      tide: { status: tide.status, reason: tide.reason || null, date: tide.date || null, n: tide.n || 0, lastAt: tide.lastAt || null },
      sectors: { status: payload.sectors.status, reason: payload.sectors.reason || null, n: (payload.sectors.rows || []).length },
    },
    full: {}, answered: tide.status !== "unavailable" || payload.sectors.status !== "unavailable",
  };
}

export function newsRow(row, at) {
  if (!row || typeof row !== "object") return null;
  const headline = typeof row.headline === "string" && row.headline.trim() ? row.headline.trim() : null;
  if (headline === null) return null;
  const createdAt = typeof row.created_at === "string" && row.created_at.trim() ? row.created_at.trim() : null;
  const parsed = createdAt === null ? NaN : Date.parse(createdAt);
  const createdAtMs = Number.isFinite(parsed) ? parsed : null;
  const uniq = (list, f) => (Array.isArray(list) ? [...new Set(list.filter((t) => typeof t === "string" && t.trim()).map(f))] : []);
  const ts = createdAtMs === null ? at : createdAtMs;
  return {
    id: `${createdAtMs === null ? "u" : createdAtMs}|${headline.slice(0, 80)}`,
    ts,
    headline,
    source: typeof row.source === "string" && row.source.trim() ? row.source.trim() : null,
    createdAt, createdAtMs,
    major: row.is_major === null || row.is_major === undefined ? null : Boolean(row.is_major),
    sentiment: typeof row.sentiment === "string" && row.sentiment.trim() ? row.sentiment.trim() : null,
    tickers: uniq(row.tickers, (t) => t.trim().toUpperCase()),
    tags: uniq(row.tags, (t) => t.trim()),
  };
}

export function shapeNw(raw, { at }) {
  const list = rowsOf(raw);
  const items = [];
  let unusable = 0;
  let newest = NaN;
  for (const r of list) {
    const row = newsRow(r, at);
    if (!row) { unusable++; continue; }
    if (row.createdAtMs !== null && !(row.createdAtMs <= newest)) newest = row.createdAtMs;
    items.push(row);
  }
  return {
    items, vendorAt: Number.isFinite(newest) ? newest : null,
    meta: { read: list.length, unusable, newestAt: Number.isFinite(newest) ? iso(newest) : null }, full: {}, answered: true,
  };
}

export const RT_REST_SHAPE = Object.freeze({ px: shapePx, fl: shapeFl, gx: shapeGx, mk: shapeMk, nw: shapeNw });

export function createPxState() {
  return { rows: new Map(), allow: new Set() };
}

export function setPxNames(state, names) {
  state.allow = new Set(names);
  for (const t of state.rows.keys()) if (!state.allow.has(t)) state.rows.delete(t);
}

export function createFlowState() {
  return { ring: [], seen: new Map(), cursor: null, dropped: 0, truncations: 0, primed: false };
}

export function flowQuery(state, session) {
  const c = state.cursor ? timeMs(state.cursor) : NaN;
  return Number.isFinite(c) ? new Date(c - RT_LIMITS.flowOverlapMs).toISOString() : session;
}

export function createGexState() {
  return { rows: new Map() };
}

export function createMarketState() {
  return { rows: new Map() };
}

export function createNewsState() {
  return { ring: [], seen: new Map() };
}

export function createTopicState(k) {
  if (k === "px") return createPxState();
  if (k === "fl") return createFlowState();
  if (k === "gx") return createGexState();
  if (k === "mk") return createMarketState();
  return createNewsState();
}

export function mergeTopic(k, state, frame) {
  const items = Array.isArray(frame.items) ? frame.items : [];
  const meta = { ...frame.meta };
  let rows = [];
  if (k === "px") {
    rows = mergeLatest(state.rows, items.filter((it) => state.allow.has(it[0])).map((it) => ({
      key: it[0], stamp: it[1], value: it, same: (prev) => rowSame(prev, it),
    })), { cap: RT_TOPICS.px.rowMax }).map((it) => it.value);
  } else if (k === "gx") {
    rows = mergeLatest(state.rows, items.map((it) => ({
      key: it[0], stamp: it[1], value: it,
      same: (prev) => prev[1] === it[1] && prev[2] === it[2] && prev[3] === it[3] && prev[4] === it[4] && prev[5] === it[5],
    })), { cap: RT_TOPICS.gx.rowMax }).map((it) => it.value);
  } else if (k === "mk") {
    rows = mergeLatest(state.rows, items.map((it) => ({
      key: it.id, stamp: it.id === "tide" ? timeMs(it.t) : null, value: it, same: sameJson(it),
    })), { cap: RT_TOPICS.mk.rowMax }).map((it) => it.value);
  } else if (k === "fl") {
    const overlap = items.filter((it) => state.seen.has(it.id)).length;
    const truncated = meta.page === true && state.primed && overlap === 0;
    if (truncated) state.truncations++;
    const merged = mergeAppend(state.ring, state.seen, items.map((it) => ({ id: it.id, ts: it.ts, row: it })), {
      ringMax: RT_TOPICS.fl.rowMax, seenMax: RT_LIMITS.seenMax, frameMax: RT_TOPICS.fl.rowMax,
    });
    state.dropped += merged.dropped;
    state.primed = true;
    if (typeof meta.cursor === "string") state.cursor = meta.cursor;
    rows = merged.rows;
    delete meta.page;
    meta.dropped = state.dropped;
    meta.truncated = truncated;
  } else {
    rows = mergeAppend(state.ring, state.seen, items.map((it) => ({ id: it.id, ts: it.ts, row: it })), {
      ringMax: RT_TOPICS.nw.rowMax, seenMax: RT_LIMITS.seenMax, frameMax: RT_TOPICS.nw.rowMax,
    }).rows;
  }
  return { rows, vendorAt: frame.vendorAt ?? null, meta, full: frame.full || {} };
}

export function snapshotRows(k, state, readAt = null) {
  if (k === "px") {
    const out = [];
    for (const [t, h] of state.rows) {
      const row = [t, h.stamp, ...h.value.slice(2)];
      if (readAt !== null && h.stamp !== null) row[2 + QA] = lagSeconds(readAt, h.stamp);
      out.push(row);
    }
    return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  if (k === "gx") return Array.from(state.rows.values(), (h) => h.value).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (k === "mk") return Array.from(state.rows.values(), (h) => h.value);
  return state.ring.slice();
}

export const applyPx = (state, raw, ctx) => mergeTopic("px", state, shapePx(raw, ctx));

export const applyFlow = (state, raw, ctx) => mergeTopic("fl", state, shapeFl(raw, { ...ctx, cursor: state.cursor }));

export const applyGex = (state, name, raw, ctx) => mergeTopic("gx", state, shapeGx(raw, { ...ctx, name }));

export const applyNews = (state, raw, ctx) => mergeTopic("nw", state, shapeNw(raw, ctx));

export function applyMarket(state, raws, ctx) {
  const frame = shapeMk(raws, ctx);
  return { ...mergeTopic("mk", state, frame), answered: frame.answered, meta: frame.meta };
}

export const snapshotPx = (state, readAt = null) => snapshotRows("px", state, readAt);

export const snapshotFlow = (state) => snapshotRows("fl", state);

export const snapshotGex = (state) => snapshotRows("gx", state);

export const snapshotMarket = (state) => snapshotRows("mk", state);

export const snapshotNews = (state) => snapshotRows("nw", state);

const tickerOf = (r) => (r && typeof r.t === "string" ? r.t.trim().toUpperCase() : null);

export function rosterPlan({ long = [], short = [], watch = [], focusPayload = null } = {}) {
  const focus = focusStripNames(focusPayload && typeof focusPayload === "object" ? focusPayload : null, LIVE_BUDGET.stripFocusMax);
  const names = stripNames({
    long: long.map(tickerOf), short: short.map(tickerOf), watch: watch.map(tickerOf), focus: focus.names,
  });
  const ranked = [...long, ...short]
    .map((r) => ({ t: tickerOf(r), mag: Math.abs(Number(r && r.s)) }))
    .filter((r) => r.t && Number.isFinite(r.mag))
    .sort((a, b) => b.mag - a.mag || (a.t < b.t ? -1 : 1))
    .map((r) => r.t);
  const stage = new Map();
  for (const r of long) if (tickerOf(r)) stage.set(tickerOf(r), "board:long");
  for (const r of short) if (tickerOf(r)) stage.set(tickerOf(r), "board:short");
  return {
    names, ranked, deep: ranked.slice(0, 50), stage, focus,
    counts: { long: long.length, short: short.length, watch: watch.length, focus: focus.names.length },
  };
}

export function gexBase(plan, session, now) {
  const open = sessionOpen(session);
  const tick = Number.isFinite(open) ? Math.max(0, Math.floor((now - open) / (15 * 60000))) : 0;
  const rotation = gexRotation({ ranked: plan.ranked, deep: plan.deep, tick });
  return { rotation, tick, names: rotation.all };
}

export function gexPick(i, base, focus) {
  if (!base.length && !focus.length) return null;
  if (focus.length && (i % RT_LIMITS.gexFocusEvery === RT_LIMITS.gexFocusEvery - 1 || !base.length)) {
    return focus[Math.floor(i / RT_LIMITS.gexFocusEvery) % focus.length];
  }
  const baseIdx = i - (focus.length ? Math.floor((i + 1) / RT_LIMITS.gexFocusEvery) : 0);
  return base[baseIdx % base.length];
}

export function pickFocus(states, max = RT_LIMITS.focusMax) {
  const counts = new Map();
  for (const f of states) if (typeof f === "string" && TICKER_RE.test(f)) counts.set(f, (counts.get(f) || 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([t]) => t);
}
