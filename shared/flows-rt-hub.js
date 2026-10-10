import {
  RT_LIMITS, RT_CLOSE, RT_TOPICS, RT_TOPIC_KEYS, RT_UPSTREAM, RT_REST_SHAPE, RT_ROW_FIELDS,
  frame, ctlFrame, pendingStream, streamEntry, worstEntry, entryHeaders, inSession, closedInfo, parseClientMessage,
  createCounter, createBudget, createLagStats, createTopicState, mergeTopic, snapshotRows, setPxNames, flowQuery,
  rosterPlan, pickFocus, rtSwitches,
} from "./flows-rt.js";
import { phaseAt } from "./flows-freshness.js";
import { priorCloseBase, nightlySources, TICKER_RE } from "./flows-live.js";
import { normalizeClock, FOCUS_NIGHTLY_SQL } from "./flows-live-worker.js";
import { MEMBER_NAME } from "./flows-auth.js";

const UW_BASE_DEFAULT = "https://api.unusualwhales.com";

const T0 = Date.now();

const GX_NAMES = 3;

const clampInt = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};

export function hubConfig(env) {
  const e = env || {};
  const redirected = typeof e.UW_BASE === "string" && e.UW_BASE !== "";
  const pinned = redirected && e.UW_NOW ? Date.parse(e.UW_NOW) : NaN;
  const scale = redirected ? Math.min(1, Math.max(0.05, Number(e.FLOWS_RT_SCALE) || 1)) : 1;
  const sw = rtSwitches(e);
  return {
    mode: sw.mode,
    audience: sw.audience,
    base: redirected ? e.UW_BASE : UW_BASE_DEFAULT,
    key: typeof e.UW_API_KEY === "string" ? e.UW_API_KEY : "",
    pinned: Number.isFinite(pinned) ? pinned : NaN,
    scale,
    callsPerMinute: clampInt(e.FLOWS_RT_CALLS_PER_MIN, 10, 1200, RT_LIMITS.callsPerMinute),
    userCap: clampInt(e.FLOWS_RT_USER_CAP, 1, 10, RT_LIMITS.userSockets),
    redirected,
  };
}

export function rtClock(env) {
  const cfg = hubConfig(env);
  return Number.isFinite(cfg.pinned) ? () => cfg.pinned + (Date.now() - T0) : () => Date.now();
}

const closedKeyOf = (info) => info.reason + ":" + info.day;

const jitter = (ms, random) => Math.round(ms * (0.8 + 0.4 * random()));

function retryAfterMs(value, now) {
  if (typeof value !== "string" || !value.trim()) return null;
  const s = Number(value);
  if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000);
  const d = Date.parse(value);
  return Number.isFinite(d) ? Math.max(0, d - now) : null;
}

export function createRestUpstream({
  cfg, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), random = Math.random,
  budget, timeoutMs = RT_LIMITS.callTimeoutMs,
}) {
  const ORDER = ["px", "mk", "gx", "fl", "nw"];
  const gxNames = () => (plan ? plan.gex().names.slice(0, GX_NAMES) : []);
  const cadence = (k) => (k === "gx" ? RT_TOPICS.gx.cadenceMs / Math.max(1, gxNames().length) : RT_TOPICS[k].cadenceMs) * cfg.scale;
  const topics = {};
  for (const k of ORDER) topics[k] = { due: 0, inflight: false, fails: 0 };
  const aborters = new Set();
  let running = false;
  let gen = 0;
  let plan = null;
  let handlers = null;
  let pausedUntil = 0;
  let n429 = 0;
  let own = { fl: { cursor: null }, gx: { i: 0 } };

  async function call(c) {
    const url = new URL(cfg.base + c.path);
    for (const [name, value] of Object.entries(c.params || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
    }
    const ac = new AbortController();
    aborters.add(ac);
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { Authorization: "Bearer " + cfg.key, Accept: "application/json" }, signal: ac.signal,
      });
      if (res.status === 429) {
        return { ok: false, error: { code: "http_429", status: 429, retryAfterMs: retryAfterMs(res.headers.get("Retry-After"), now()) } };
      }
      if (!res.ok) return { ok: false, error: { code: res.status >= 500 ? "http_5xx" : "http_4xx", status: res.status } };
      try {
        return { ok: true, body: await res.json() };
      } catch {
        return { ok: false, error: { code: "parse", status: res.status } };
      }
    } catch (e) {
      return { ok: false, error: { code: ac.signal.aborted ? "timeout" : "network", name: e && e.name ? String(e.name).slice(0, 40) : "Error" } };
    } finally {
      clearTimeout(timer);
      aborters.delete(ac);
    }
  }

  function failed(k, t, at, error) {
    t.fails++;
    const c = cadence(k);
    if (error.code === "http_429") {
      if (at >= pausedUntil) n429++;
      const wait = Math.min(RT_LIMITS.pause429MaxMs, Math.max(error.retryAfterMs ?? 0, RT_LIMITS.pause429BaseMs * 2 ** Math.min(n429 - 1, 5)));
      pausedUntil = Math.max(pausedUntil, at + jitter(wait * cfg.scale, random));
      t.due = pausedUntil;
    } else {
      const cap = RT_LIMITS.failCapMs * cfg.scale;
      t.due = at + jitter(Math.min(cap, c * 2 ** Math.min(t.fails, 5)), random);
    }
    handlers.onError({ k, at, ...error, throttled: error.code === "http_429", retryAt: t.due });
  }

  function prepare(k) {
    const session = plan.session();
    if (k === "px") {
      const names = plan.names();
      return { args: { names }, shape: { session, names, base: plan.base() } };
    }
    if (k === "fl") return { args: { newerThan: flowQuery(own.fl, session) }, shape: { session, stageOf: plan.stage, cursor: own.fl.cursor } };
    if (k === "gx") {
      const names = gxNames();
      if (!names.length) return null;
      const name = names[own.gx.i++ % names.length];
      return { args: { name }, shape: { session, name } };
    }
    return { args: {}, shape: { session } };
  }

  async function poll(k, at) {
    const t = topics[k];
    const mine = gen;
    const c = cadence(k);
    const ready = plan.ready() ? prepare(k) : null;
    if (ready === null) { t.due = at + c; return; }
    if (!cfg.key) { failed(k, t, at, { code: "no-key", status: null }); return; }
    const calls = RT_UPSTREAM[k].rest(ready.args);
    if (!budget.take(k, at, calls.length)) {
      t.due = at + Math.max(1000 * cfg.scale, c);
      t.fails++;
      handlers.onError({ k, at, code: "budget", status: null, retryAt: t.due });
      return;
    }
    t.inflight = true;
    t.due = (t.due || at) + c;
    if (t.due <= at) t.due = at + c;
    const started = at;
    try {
      const results = await Promise.all(calls.map(call));
      if (!running || mine !== gen) return;
      const readAt = now();
      if (!results.some((r) => r.ok)) {
        const bad = results.find((r) => r.error.code === "http_429") || results[0];
        failed(k, t, readAt, bad.error);
        return;
      }
      let body = results[0].body;
      if (calls.length > 1) {
        body = {};
        calls.forEach((cl, i) => { body[cl.feed] = results[i].ok ? results[i].body : { __failed: results[i].error.code }; });
      }
      const out = RT_REST_SHAPE[k](body, { ...ready.shape, at: readAt });
      if (!out.answered) { failed(k, t, readAt, { code: "unanswered", status: null }); return; }
      if (k === "fl") own.fl.cursor = out.meta.cursor;
      t.fails = 0;
      n429 = 0;
      handlers.onFrame({ k, readAt, ms: readAt - started, ...out });
    } finally {
      if (mine === gen) t.inflight = false;
    }
  }

  return {
    kind: "rest",
    start(p, h) {
      gen++;
      plan = p;
      handlers = h;
      running = true;
      pausedUntil = 0;
      n429 = 0;
      own = { fl: { cursor: null }, gx: { i: 0 } };
      const at = now();
      const offsets = { px: 0, gx: 250, mk: 500, fl: 750, nw: 1000 };
      for (const k of ORDER) Object.assign(topics[k], { due: at + offsets[k] * cfg.scale, inflight: false, fails: 0 });
    },
    stop() {
      gen++;
      running = false;
      for (const ac of aborters) ac.abort();
      aborters.clear();
    },
    async tick(at) {
      if (!running || at < pausedUntil) return;
      const jobs = [];
      for (const k of ORDER) {
        const t = topics[k];
        if (!plan.topics.has(k)) { t.fails = 0; continue; }
        if (t.inflight || at < t.due) continue;
        jobs.push(poll(k, at).catch((error) => {
          t.inflight = false;
          handlers.onError({ k, at, code: "internal", status: null, message: String(error && error.message ? error.message : error).slice(0, 120) });
          t.due = at + Math.max(1000, cadence(k));
        }));
      }
      await Promise.all(jobs);
    },
    paused: (at) => at < pausedUntil,
    state: () => ({
      running, pausedUntil: pausedUntil || null, n429, key: !!cfg.key, base: cfg.redirected ? "redirected" : "production",
      topics: Object.fromEntries(ORDER.map((k) => [k, { due: topics[k].due, inflight: topics[k].inflight, fails: topics[k].fails }])),
    }),
  };
}

const CLOCK_SQL = "SELECT * FROM flows_clock WHERE id = 1";

export const RT_BOARDS_SQL =
  "SELECT id, json_extract(payload, '$.sessionDate') AS session, " +
  "(SELECT json_group_array(json_array(json_extract(r.value, '$.t'), json_extract(r.value, '$.s'), json_extract(r.value, '$.px'))) " +
  "FROM json_each(payload, '$.rows') AS r) AS rows " +
  "FROM flows_payload WHERE id IN ('board:long', 'board:short', 'board:watch') AND json_valid(payload)";

const parseJson = (text, fallback) => {
  if (typeof text !== "string") return fallback;
  try { const v = JSON.parse(text); return v === null || v === undefined ? fallback : v; } catch { return fallback; }
};

export async function loadRosterFromD1(env) {
  if (!env || !env.DB) return null;
  const res = await env.DB.batch([env.DB.prepare(CLOCK_SQL), env.DB.prepare(RT_BOARDS_SQL), env.DB.prepare(FOCUS_NIGHTLY_SQL)]);
  const first = (r) => (r && Array.isArray(r.results) && r.results[0] ? r.results[0] : null);
  const boards = { long: null, short: null, watch: null };
  for (const row of res[1] && Array.isArray(res[1].results) ? res[1].results : []) {
    const side = typeof row.id === "string" ? row.id.slice("board:".length) : "";
    if (!Object.hasOwn(boards, side)) continue;
    const list = parseJson(row.rows, []);
    boards[side] = {
      sessionDate: typeof row.session === "string" ? row.session : null,
      rows: Array.isArray(list) ? list.map((x) => (Array.isArray(x) ? { t: x[0], s: x[1], px: x[2] } : null)).filter(Boolean) : [],
    };
  }
  const f = first(res[2]);
  const focus = f ? { groups: parseJson(f.groups, null), sessionDate: typeof f.session === "string" ? f.session : null, closes: parseJson(f.closes, {}) } : null;
  return { clock: normalizeClock(first(res[0])), boards, focus };
}

function newTopic(k) {
  return {
    k, state: createTopicState(k), hasData: false, readAt: null, vendorAt: null, meta: {}, full: {},
    frames: 0, bytes: 0, lastFrameAt: null, lastOkAt: null, lastError: null, fails: 0, polls: 0, demandAt: null,
    lag: createLagStats(), rowLag: createLagStats(), rowsHeld: 0,
  };
}

const heldCount = (k, s) => (k === "fl" || k === "nw" ? s.ring.length : s.rows.size);

export class RtHub {
  constructor({ env, now, host, loadRoster = loadRosterFromD1, random = Math.random, log = null, upstreamFactory } = {}) {
    if (typeof upstreamFactory !== "function") throw new Error("an upstream factory is required");
    this.env = env || {};
    this.cfg = hubConfig(this.env);
    this.now = typeof now === "function" ? now : rtClock(this.env);
    this.host = host;
    this.loadRoster = loadRoster;
    this.log = typeof log === "function" ? log : (entry) => console.error(JSON.stringify(entry));
    this.budget = createBudget({ perMinute: Math.max(1, Math.round(this.cfg.callsPerMinute / this.cfg.scale)) });
    this.upstream = upstreamFactory({ cfg: this.cfg, now: this.now, random, budget: this.budget });
    const hub = this;
    this.plan = {
      get topics() { return hub.demanded; },
      ready: () => !!this.roster && !!this.session,
      session: () => this.session,
      names: () => this.pxNames(),
      gex: () => ({ names: this.gxNames.slice() }),
      base: () => this.base,
      stage: (t) => (this.roster ? this.roster.stage.get(t) || null : null),
    };
    this.socks = new WeakMap();
    this.closing = new WeakSet();
    this.counter = createCounter();
    this.logged = new Map();
    this.running = false;
    this.ep = 0;
    this.lastSnapAt = -Infinity;
    this.snapAt = Object.create(null);
    this.roster = null;
    this.rosterAt = 0;
    this.rosterDueAt = 0;
    this.rosterError = null;
    this.clock = null;
    this.waiters = [];
    this.resetRun();
  }

  resetRun() {
    this.topics = Object.fromEntries(RT_TOPIC_KEYS.map((k) => [k, newTopic(k)]));
    this.counter.reset();
    this.session = null;
    this.base = null;
    this.gxNames = [];
    this.demanded = new Set();
    this.namesKey = null;
    this.degraded = null;
    this.forceThrottle = false;
    this.closedKey = null;
    this.lastBroadcastAt = 0;
    this.startedAt = 0;
    this.focus = [];
    this.socketCount = 0;
    this.phase = null;
  }

  logOnce(key, entry) {
    const t = Date.now();
    if (t - (this.logged.get(key) || 0) < 60000) return;
    this.logged.set(key, t);
    if (this.logged.size > 32) this.logged.delete(this.logged.keys().next().value);
    this.log(entry);
  }

  attachment(ws) {
    try {
      const a = ws.deserializeAttachment();
      return a && typeof a === "object" ? a : {};
    } catch {
      return {};
    }
  }

  sockState(ws) {
    let st = this.socks.get(ws);
    if (!st) {
      const a = this.attachment(ws);
      st = {
        u: typeof a.u === "string" ? a.u : "", exp: Number(a.exp) || 0,
        topics: new Set(Array.isArray(a.k) ? a.k.filter((k) => RT_TOPIC_KEYS.includes(k)) : RT_TOPIC_KEYS),
        f: typeof a.f === "string" ? a.f : null, have: new Set(), lastRs: Object.create(null), burst: [],
      };
      this.socks.set(ws, st);
    }
    return st;
  }

  liveSockets() {
    let list = [];
    try { list = this.host.sockets(); } catch { list = []; }
    return list.filter((ws) => !this.closing.has(ws) && (ws.readyState === undefined || ws.readyState === 1));
  }

  demand(now) {
    return this.liveSockets().length > 0 || now - this.lastSnapAt < RT_LIMITS.snapLingerMs * this.cfg.scale;
  }

  send(ws, text) {
    try {
      ws.send(text);
      return true;
    } catch {
      this.closing.add(ws);
      return false;
    }
  }

  closeSocket(ws, code, reason) {
    this.closing.add(ws);
    try { ws.close(code, reason); } catch { return; }
  }

  bye(ws, code, reason) {
    const now = this.now();
    this.send(ws, JSON.stringify(ctlFrame("bye", { ep: this.ep || now, at: now, meta: { reason, code } })));
    this.closeSocket(ws, code, reason);
  }

  start(now, { notify = null } = {}) {
    this.upstream.stop();
    this.resetRun();
    this.ep = Math.max(now, this.ep + 1);
    this.running = true;
    this.startedAt = now;
    this.lastBroadcastAt = now;
    for (const ws of this.liveSockets()) this.sockState(ws).have.clear();
    this.upstream.start(this.plan, { onFrame: (up) => this.onUpstream(up), onError: (err) => this.onError(err) });
    if (notify) this.broadcastCtl("resync", { reason: notify, k: RT_TOPIC_KEYS.slice() });
  }

  stop() {
    this.upstream.stop();
    this.running = false;
    this.resetRun();
    const waiting = this.waiters.splice(0);
    for (const w of waiting) w.done();
  }

  shutdown(code, reason) {
    for (const ws of this.liveSockets()) this.bye(ws, code, reason);
    this.stop();
  }

  pxNames() {
    const names = this.roster ? this.roster.names.slice() : [];
    for (const f of this.focus) if (!names.includes(f)) names.push(f);
    return names;
  }

  onError(err) {
    const t = this.topics[err.k];
    if (!t) return;
    t.fails++;
    t.lastError = { at: err.at, code: err.code, status: err.status ?? null, throttled: err.throttled === true };
    if (err.throttled === true) this.forceThrottle = true;
    if (err.code === "internal") this.logOnce("poll:" + err.k, { message: "rt poll failed", k: err.k, error: err.message || null });
  }

  onUpstream(up) {
    const t = this.topics[up.k];
    if (!t || !this.running) return;
    const at = up.readAt;
    if (up.answered === false) {
      this.onError({ k: up.k, at, code: "unanswered", status: null });
      return;
    }
    const out = mergeTopic(up.k, t.state, up);
    t.polls++;
    t.hasData = true;
    t.readAt = at;
    t.vendorAt = out.vendorAt;
    t.meta = out.meta;
    t.full = out.full;
    t.lastOkAt = at;
    t.fails = 0;
    t.rowsHeld = heldCount(up.k, t.state);
    if (out.vendorAt !== null && RT_TOPICS[up.k].stamp === "rows") t.lag.add(at - out.vendorAt);
    if (up.k === "px") for (const r of out.rows) if (r[1] !== null) t.rowLag.add(at - r[1]);
    this.emit(up.k, out.rows);
    if (this.waiters.length) for (const w of this.waiters.slice()) w.check();
  }

  freshOf(k, now) {
    const t = this.topics[k];
    if (!t.hasData) return pendingStream(k);
    return streamEntry({ k, readAt: t.readAt, vendorAt: t.vendorAt, session: this.session, now, clock: this.clock, updatedAt: t.readAt });
  }

  snapshotFrame(k, now) {
    const t = this.topics[k];
    const sq = this.counter.peek(k);
    if (!t.hasData) return frame(k, { ep: this.ep, sq, at: now, snap: true, fresh: pendingStream(k), meta: { cold: true }, rows: [] });
    const meta = { ...t.meta, ...t.full };
    if (RT_ROW_FIELDS[k]) meta.cols = RT_ROW_FIELDS[k];
    return frame(k, { ep: this.ep, sq, at: now, snap: true, fresh: this.freshOf(k, now), meta, rows: snapshotRows(k, t.state, t.readAt) });
  }

  emit(k, rows) {
    const t = this.topics[k];
    const now = this.now();
    const sq = this.counter.next(k);
    const delta = JSON.stringify(frame(k, { ep: this.ep, sq, at: now, fresh: this.freshOf(k, now), meta: t.meta, rows }));
    let snap = null;
    let sent = 0;
    for (const ws of this.liveSockets()) {
      const st = this.sockState(ws);
      if (!st.topics.has(k)) continue;
      if (st.have.has(k)) this.send(ws, delta);
      else {
        if (snap === null) snap = JSON.stringify(this.snapshotFrame(k, now));
        this.send(ws, snap);
        st.have.add(k);
      }
      sent++;
    }
    t.frames++;
    t.bytes += delta.length;
    t.lastFrameAt = now;
    if (sent) this.lastBroadcastAt = now;
  }

  broadcastCtl(t, meta, only = null) {
    const now = this.now();
    const text = JSON.stringify(ctlFrame(t, { ep: this.ep || now, at: now, meta }));
    let sent = 0;
    for (const ws of this.liveSockets()) {
      if (only && !only(this.sockState(ws))) continue;
      if (this.send(ws, text)) sent++;
    }
    if (sent) this.lastBroadcastAt = now;
    return sent;
  }

  resync(ks, reason) {
    const now = this.now();
    this.broadcastCtl("resync", { reason, k: ks });
    const texts = {};
    for (const k of ks) {
      if (!this.topics[k].hasData) continue;
      this.counter.next(k);
      texts[k] = JSON.stringify(this.snapshotFrame(k, now));
    }
    for (const ws of this.liveSockets()) {
      const st = this.sockState(ws);
      for (const k of Object.keys(texts)) {
        if (!st.topics.has(k)) continue;
        this.send(ws, texts[k]);
        st.have.add(k);
      }
    }
  }

  helloFor(ws, st, now) {
    const frames = [];
    for (const k of st.topics) {
      frames.push(this.snapshotFrame(k, now));
      if (this.topics[k].hasData) st.have.add(k);
    }
    const phase = this.phase || phaseAt(now, this.clock);
    return ctlFrame("hello", {
      ep: this.ep, at: now,
      meta: {
        transport: "ws", upstream: this.upstream.kind, mode: this.cfg.mode, audience: this.cfg.audience,
        topics: Array.from(st.topics), hbS: RT_LIMITS.hbMs / 1000, cold: Array.from(st.topics).some((k) => !this.topics[k].hasData),
        phase: phase ? phase.phase : null, session: this.session || (phase && phase.session) || null, f: st.f,
      },
      rows: frames,
    });
  }

  admit(ws, { u, exp, topics = RT_TOPIC_KEYS, f = null }) {
    const now = this.now();
    if (this.cfg.mode !== "on") { this.bye(ws, RT_CLOSE.off, "rt-off"); return false; }
    const others = this.liveSockets().filter((x) => x !== ws);
    const mine = others.filter((x) => this.sockState(x).u === u).length;
    if (mine >= this.cfg.userCap) { this.bye(ws, RT_CLOSE.cap, "connection-cap"); return false; }
    if (others.length >= RT_LIMITS.sockets) { this.bye(ws, RT_CLOSE.full, "hub-full"); return false; }
    const st = {
      u, exp, topics: new Set(topics.filter((k) => RT_TOPIC_KEYS.includes(k))), f: f && TICKER_RE.test(f) ? f : null,
      have: new Set(), lastRs: Object.create(null), burst: [],
    };
    this.socks.set(ws, st);
    this.persist(ws, st);
    if (!this.running) this.start(now);
    this.send(ws, JSON.stringify(this.helloFor(ws, st, now)));
    const phase = phaseAt(now, this.clock);
    if (!inSession(phase)) {
      this.closedKey = closedKeyOf(closedInfo(phase));
      this.send(ws, JSON.stringify(this.closedFrame(phase, now)));
    }
    return true;
  }

  closedFrame(phase, now) {
    return ctlFrame("closed", { ep: this.ep || now, at: now, meta: closedInfo(phase) });
  }

  persist(ws, st) {
    try { ws.serializeAttachment({ u: st.u, exp: st.exp, k: Array.from(st.topics), f: st.f }); } catch { return; }
  }

  onMessage(ws, data) {
    const st = this.sockState(ws);
    const now = this.now();
    st.burst = st.burst.filter((x) => now - x < RT_LIMITS.messageWindowMs * this.cfg.scale);
    st.burst.push(now);
    if (st.burst.length > RT_LIMITS.messageBurst) { this.closeSocket(ws, RT_CLOSE.policy, "rate"); return; }
    const p = parseClientMessage(data);
    if (!p.ok) { this.closeSocket(ws, RT_CLOSE.tooBig, p.why); return; }
    const m = p.msg;
    if (m.t === "sub") {
      const before = st.topics;
      st.topics = new Set(m.k);
      if (m.f !== undefined) st.f = m.f;
      for (const k of Array.from(st.have)) if (!st.topics.has(k)) st.have.delete(k);
      this.persist(ws, st);
      for (const k of st.topics) {
        if (before.has(k) && st.have.has(k)) continue;
        this.send(ws, JSON.stringify(this.snapshotFrame(k, now)));
        if (this.topics[k].hasData) st.have.add(k);
      }
      return;
    }
    if (m.t === "p") {
      for (const [k, n] of Object.entries(m.sq)) {
        if (st.topics.has(k) && this.topics[k].hasData && this.counter.peek(k) - n > RT_LIMITS.laggardFrames) {
          this.bye(ws, RT_CLOSE.laggard, "laggard");
          return;
        }
      }
      return;
    }
    if (!st.topics.has(m.k)) return;
    if (now - (st.lastRs[m.k] || 0) < RT_LIMITS.rsMinGapMs * this.cfg.scale) return;
    st.lastRs[m.k] = now;
    this.send(ws, JSON.stringify(this.snapshotFrame(m.k, now)));
    if (this.topics[m.k].hasData) st.have.add(m.k);
  }

  onClose(ws) {
    this.closing.add(ws);
    this.socks.delete(ws);
  }

  sweep(now) {
    const real = Date.now();
    const list = this.liveSockets();
    const focus = [];
    const gx = [];
    const want = new Set();
    let n = 0;
    for (const ws of list) {
      const st = this.sockState(ws);
      if (st.exp && st.exp <= real) { this.bye(ws, RT_CLOSE.expired, "session-expired"); continue; }
      n++;
      for (const k of st.topics) want.add(k);
      if (st.f) {
        focus.push(st.f);
        if (st.topics.has("gx")) gx.push(st.f);
      }
    }
    const linger = RT_LIMITS.snapLingerMs * this.cfg.scale;
    for (const k of RT_TOPIC_KEYS) if (now - (this.snapAt[k] ?? -Infinity) < linger) want.add(k);
    this.socketCount = n;
    this.focus = pickFocus(focus);
    this.gxNames = pickFocus(gx).slice(0, GX_NAMES);
    if (!this.gxNames.length) want.delete("gx");
    this.setDemand(want, now);
    return n;
  }

  setDemand(want, now) {
    const prev = this.demanded;
    this.demanded = new Set(RT_TOPIC_KEYS.filter((k) => want.has(k)));
    for (const k of RT_TOPIC_KEYS) {
      const t = this.topics[k];
      if (this.demanded.has(k) === prev.has(k)) continue;
      t.fails = 0;
      t.lastError = null;
      if (this.demanded.has(k)) { t.demandAt = now; continue; }
      if (this.degraded) {
        this.degraded.k = this.degraded.k.filter((x) => x !== k);
        this.degraded.all = this.degraded.all.filter((x) => x !== k);
      }
    }
  }

  async ensureRoster(now) {
    if (this.roster && now < this.rosterDueAt) return;
    this.rosterAt = now;
    let timer = null;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("roster timeout")), 3000); });
      const r = await Promise.race([this.loadRoster(this.env, now), timeout]);
      this.applyRoster(r || { clock: null, boards: {}, focus: null });
      this.rosterError = null;
      this.rosterDueAt = now + RT_LIMITS.rosterMs;
    } catch (error) {
      this.rosterError = { at: now, message: String(error && error.message ? error.message : error).slice(0, 120) };
      if (!this.roster) this.applyRoster({ clock: null, boards: {}, focus: null });
      this.rosterDueAt = this.now() + RT_LIMITS.rosterRetryMs * this.cfg.scale;
      this.logOnce("roster", { message: "rt roster read failed", error: this.rosterError.message });
    } finally {
      clearTimeout(timer);
    }
  }

  applyRoster(r) {
    const rows = (b) => (b && Array.isArray(b.rows) ? b.rows : []);
    const b = r.boards || {};
    this.roster = rosterPlan({
      long: rows(b.long), short: rows(b.short), watch: rows(b.watch),
      focusPayload: r.focus && Array.isArray(r.focus.groups) ? { groups: r.focus.groups } : null,
    });
    this.sources = nightlySources({ boards: b, focus: r.focus || null });
    this.clock = r.clock || null;
    this.base = null;
  }

  refreshNames() {
    const names = this.pxNames();
    const key = names.join(",");
    if (key === this.namesKey) return;
    this.namesKey = key;
    setPxNames(this.topics.px.state, names);
  }

  refreshSession(session) {
    if (!this.roster) return;
    if (!this.base) this.base = priorCloseBase(this.sources || [], session, this.clock);
  }

  reasonFor(t, now) {
    if (this.forceThrottle || this.upstream.paused(now) || (t.fails > 0 && t.lastError && t.lastError.throttled)) return "vendor-throttled";
    return t.fails > 0 && t.lastError ? t.lastError.code : "vendor-error";
  }

  evaluate(now) {
    const down = [];
    let reason = null;
    for (const k of this.demanded) {
      const t = this.topics[k];
      const limit = Math.max(3 * RT_TOPICS[k].cadenceMs, RT_LIMITS.degradeAfterMs) * this.cfg.scale;
      const since = Math.max(t.lastOkAt ?? this.startedAt, t.demandAt ?? -Infinity);
      const held = now - since > limit || this.degraded !== null;
      const bad = this.forceThrottle || (t.fails > 0 && held) || (this.upstream.paused(now) && held);
      if (bad) {
        down.push(k);
        reason = reason || this.reasonFor(t, now);
      }
    }
    this.forceThrottle = false;
    const cur = this.degraded;
    if (down.length) {
      this.degraded = {
        since: cur ? cur.since : now, reason: cur ? cur.reason : reason, k: down,
        all: Array.from(new Set([...(cur ? cur.all : []), ...down])),
      };
      if (!cur || cur.reason !== reason) {
        this.degraded.reason = reason;
        const retry = this.upstream.state().pausedUntil;
        this.broadcastCtl("degraded", {
          reason, k: RT_TOPIC_KEYS.filter((k) => this.demanded.has(k) && (down.includes(k) || this.topics[k].fails > 0)), since: new Date(this.degraded.since).toISOString(),
          retryAt: retry && retry > now ? new Date(retry).toISOString() : null,
        });
      }
    } else if (cur) {
      this.degraded = null;
      this.resync(RT_TOPIC_KEYS.filter((k) => cur.all.includes(k)), "recovered");
    }
  }

  beat(now, closed) {
    const gap = (closed ? RT_LIMITS.closedHbMs : RT_LIMITS.hbMs) * this.cfg.scale;
    if (now - this.lastBroadcastAt < gap) return;
    const topics = {};
    for (const k of this.demanded) {
      const t = this.topics[k];
      topics[k] = {
        sq: this.counter.peek(k), readAt: t.readAt, lagMs: t.vendorAt !== null && t.readAt !== null ? t.readAt - t.vendorAt : null,
        fresh: t.hasData ? this.freshOf(k, now) : pendingStream(k),
      };
    }
    const sent = this.broadcastCtl("hb", {
      upstream: closed ? "closed" : this.degraded ? "down" : "up", phase: this.phase ? this.phase.phase : null,
      sockets: this.socketCount, degraded: this.degraded ? { reason: this.degraded.reason, k: this.degraded.k } : null, topics,
    });
    if (!sent) this.lastBroadcastAt = now;
  }

  async tick() {
    const cfg = this.cfg;
    const scale = cfg.scale;
    const t0 = this.now();
    if (cfg.mode !== "on") { this.shutdown(RT_CLOSE.off, "rt-off"); return null; }
    this.sweep(t0);
    if (!this.demand(t0)) { this.stop(); return null; }
    if (!this.running) {
      this.start(t0, { notify: this.socketCount > 0 ? "restart" : null });
      this.sweep(t0);
    }
    await this.ensureRoster(t0);
    const now = this.now();
    const phase = phaseAt(now, this.clock);
    this.phase = phase;
    if (!inSession(phase)) {
      const info = closedInfo(phase);
      const key = closedKeyOf(info);
      if (this.closedKey !== key) {
        this.closedKey = key;
        this.broadcastCtl("closed", info);
      }
      this.beat(now, true);
      const toOpen = phase && Number.isFinite(phase.endsAt) ? Math.max(1000, phase.endsAt - now) : RT_LIMITS.closedTickMs;
      return Math.min(RT_LIMITS.closedTickMs * scale, toOpen);
    }
    this.closedKey = null;
    const session = phase.session;
    if (this.session && this.session !== session) this.start(now, { notify: this.socketCount > 0 ? "session" : null });
    this.session = session;
    this.refreshSession(session);
    this.refreshNames();
    await this.upstream.tick(now);
    const end = this.now();
    if (!this.demand(end)) { this.stop(); return null; }
    this.evaluate(end);
    this.beat(end, false);
    return Math.max(50, RT_LIMITS.tickMs * scale - (end - t0));
  }

  waitData(ks, ms) {
    const need = () => ks.every((k) => this.topics[k].hasData);
    if (need()) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(), ms);
      const w = { check: () => { if (need()) finish(); }, done: () => finish() };
      const finish = () => {
        clearTimeout(timer);
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve();
      };
      this.waiters.push(w);
    });
  }

  async snap(ks) {
    const now = this.now();
    this.lastSnapAt = now;
    for (const k of ks) this.snapAt[k] = now;
    if (!this.running) this.start(now);
    const phase = phaseAt(now, this.clock);
    const polled = ks.filter((k) => k !== "gx" || this.gxNames.length > 0);
    if (inSession(phase) && polled.some((k) => !this.topics[k].hasData)) {
      this.host.wake(10);
      await this.waitData(polled, RT_LIMITS.snapWaitMs);
    } else this.host.wake(this.cfg.scale * RT_LIMITS.tickMs);
    const at = this.now();
    const frames = ks.map((k) => this.snapshotFrame(k, at));
    const current = phaseAt(at, this.clock);
    if (!inSession(current)) frames.push(this.closedFrame(current, at));
    if (this.degraded) {
      frames.push(ctlFrame("degraded", { ep: this.ep, at, meta: { reason: this.degraded.reason, k: this.degraded.k, since: new Date(this.degraded.since).toISOString() } }));
    }
    const worst = worstEntry(frames.filter((f) => f.fresh).map((f) => f.fresh));
    return { frames, headers: entryHeaders(worst, at, current), at };
  }

  userCounts() {
    const counts = {};
    for (const ws of this.liveSockets()) {
      const u = this.sockState(ws).u || "unknown";
      counts[u] = (counts[u] || 0) + 1;
    }
    return counts;
  }

  status() {
    const now = this.now();
    const up = this.upstream.state();
    const topics = {};
    const minute = this.budget.minute(now);
    const hour = this.budget.hour(now);
    for (const k of RT_TOPIC_KEYS) {
      const t = this.topics[k];
      topics[k] = {
        sq: this.counter.peek(k), demanded: this.demanded.has(k), hasData: t.hasData, held: t.rowsHeld, frames: t.frames, bytes: t.bytes,
        polls: t.polls, lastFrameAt: t.lastFrameAt, lastFrameAgeMs: t.lastFrameAt === null ? null : now - t.lastFrameAt,
        lastOkAt: t.lastOkAt, fails: t.fails, lastError: t.lastError,
        lagMs: t.lag.summary(), rowLagMs: k === "px" ? t.rowLag.summary() : null,
        calls: { minute: minute[k], hour: hour[k] },
        fresh: t.hasData ? this.freshOf(k, now) : pendingStream(k),
      };
    }
    const phase = phaseAt(now, this.clock);
    return {
      running: this.running, ep: this.ep || null, session: this.session, now,
      phase: phase ? { phase: phase.phase, trading: phase.trading, day: phase.day } : null,
      upstream: { kind: this.upstream.kind, ...up },
      sockets: { n: this.liveSockets().length, byUser: this.userCounts(), userCap: this.cfg.userCap, max: RT_LIMITS.sockets },
      lastSnapAt: Number.isFinite(this.lastSnapAt) ? this.lastSnapAt : null,
      roster: {
        n: this.roster ? this.roster.names.length : 0, focus: this.focus, source: this.roster ? this.roster.focus.source : null,
        at: this.rosterAt || null, error: this.rosterError, gex: this.gxNames,
      },
      calls: { minuteTotal: this.budget.used(now), perMinute: this.budget.perMinute },
      degraded: this.degraded,
      killSwitches: { FLOWS_RT_MODE: this.cfg.mode, FLOWS_RT_AUDIENCE: this.cfg.audience },
      topics,
    };
  }
}

export function createHub({ fetchImpl, ...rest }) {
  return new RtHub({ ...rest, upstreamFactory: (o) => createRestUpstream({ ...o, fetchImpl }) });
}

const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
});

export class Pulse {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    if (typeof WebSocketRequestResponsePair === "function") ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.hub = createHub({
      env,
      host: { sockets: () => ctx.getWebSockets(), wake: (ms) => this.arm(ms) },
    });
    if (this.hub.liveSockets().length) this.arm(50);
  }

  async arm(ms) {
    const at = Date.now() + Math.max(1, Math.round(ms));
    try {
      const cur = await this.ctx.storage.getAlarm();
      if (cur === null || cur > at) await this.ctx.storage.setAlarm(at);
    } catch (error) {
      this.hub.logOnce("alarm", { message: "rt alarm failed", error: String(error && error.message ? error.message : error).slice(0, 120) });
    }
  }

  async alarm() {
    let delay = null;
    try {
      delay = await this.hub.tick();
    } catch (error) {
      this.hub.logOnce("tick", { message: "rt tick failed", error: String(error && error.message ? error.message : error).slice(0, 160) });
      delay = this.hub.demand(this.hub.now()) ? 2000 : null;
    }
    if (delay !== null) await this.ctx.storage.setAlarm(Date.now() + Math.max(25, Math.round(delay)));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (this.hub.cfg.mode !== "on") return jsonResponse({ error: { code: "rt_off", message: "Real-time rail is off" } }, 404);
    if (url.pathname === "/ws") return this.upgrade(request, url);
    if (url.pathname === "/snap") {
      const ks = (url.searchParams.get("k") || "").split(",").filter((k) => RT_TOPIC_KEYS.includes(k));
      const out = await this.hub.snap(ks.length ? Array.from(new Set(ks)) : RT_TOPIC_KEYS.slice());
      return jsonResponse(out.frames, 200, out.headers);
    }
    if (url.pathname === "/status") return jsonResponse(this.hub.status());
    return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
  }

  upgrade(request, url) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return jsonResponse({ error: { code: "upgrade_required", message: "Expected a WebSocket upgrade" } }, 426);
    }
    const u = request.headers.get("X-RT-User") || "";
    const exp = Number(request.headers.get("X-RT-Exp"));
    if (!MEMBER_NAME.test(u) || !Number.isFinite(exp)) {
      return jsonResponse({ error: { code: "unauthorized", message: "Authentication required" } }, 401);
    }
    const asked = (url.searchParams.get("k") || "").split(",").filter((k) => RT_TOPIC_KEYS.includes(k));
    const f = (url.searchParams.get("f") || "").trim().toUpperCase();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["u:" + u]);
    const ok = this.hub.admit(server, {
      u, exp, topics: asked.length ? Array.from(new Set(asked)) : RT_TOPIC_KEYS.slice(), f: TICKER_RE.test(f) ? f : null,
    });
    if (ok) this.arm(10);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    try {
      this.hub.onMessage(ws, message);
    } catch (error) {
      this.hub.logOnce("message", { message: "rt message failed", error: String(error && error.message ? error.message : error).slice(0, 120) });
      try { ws.close(RT_CLOSE.policy, "error"); } catch { return; }
    }
  }

  webSocketClose(ws, code) {
    this.hub.onClose(ws);
    try { ws.close(code && code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000); } catch { this.hub.closing.add(ws); }
    this.release();
  }

  webSocketError(ws) {
    this.hub.onClose(ws);
    this.release();
  }

  release() {
    if (this.hub.demand(this.hub.now())) return;
    this.hub.stop();
    this.ctx.storage.deleteAlarm().catch(() => {});
  }
}
