(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || UI.rt) return;

  var TOPICS = ["px", "fl", "gx", "mk", "nw"];
  var FIELDS = ["px", "prev", "chg", "ncp", "npp", "net", "bull", "bear", "lean", "cv", "pv", "cvAsk", "pvAsk", "iv30", "ivRank", "im",
    "gOi", "gVol", "gDir", "pcr", "rvol", "vol", "qa"];
  var TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
  var MAX_OUT = 256;
  var PULSE_MS = 30000;
  var HIDE_MS = 30000;
  var POLL_MS = 5000;
  var PROBE_MS = 60000;
  var HELLO_MS = 10000;
  var DEADLINE_MS = 8000;
  var SILENT_MS = 16000;
  var SILENT_CLOSED_MS = 100000;
  var FAST_TRIES = 4;
  var RS_GAP_MS = 2600;
  var RS_TRIES = 5;
  var REG_MS = 1000;
  var ROWS_MAX = 2000;
  var RING = { fl: 200, nw: 60 };
  var SEEN_MAX = 1000;
  var GRACE = { px: 20000, fl: 20000, gx: 30000, mk: 40000, nw: 120000 };
  var FINAL = { 400: 1, 401: 1, 403: 1, 404: 1 };
  var KEEP_OFF = { 4001: 1, 4003: 1, 4009: 1, 4011: 1, 4012: 1 };
  var LABEL = { socket: "Socket", poll: "Polling 5 s", heartbeat: "Heartbeat" };
  var MEMO_KEY = "flows:rt:off";
  var MEMO_MS = 10 * 60 * 1000;
  var MEMO_FOR = { 403: 1, 404: 1 };

  var timers = {};
  var listening = 0;
  var stats = { msgs: 0, bytes: 0, frames: 0, snaps: 0, gaps: 0, dups: 0, orphans: 0, bad: 0, sent: 0, sentBytes: 0, refused: 0, flushes: 0, polls: 0, pollBytes: 0, opens: 0, applied: 0, reg: 0, ms: 0, maxMs: 0, kinds: {} };

  function arm(name, ms, fn) {
    disarm(name);
    timers[name] = setTimeout(function () { delete timers[name]; fn(); }, ms);
  }
  function disarm(name) {
    if (timers[name] !== undefined) { clearTimeout(timers[name]); delete timers[name]; }
  }
  function disarmAll() {
    Object.keys(timers).forEach(disarm);
  }
  function listen(target, type, fn) {
    target.addEventListener(type, fn);
    listening++;
    return function () { target.removeEventListener(type, fn); listening--; };
  }
  function jitter(ms) { return Math.round(ms * (0.5 + Math.random())); }
  function iso(ms) { return typeof ms === "number" && isFinite(ms) ? new Date(ms).toISOString() : null; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }

  function newTopic() {
    return {
      ep: null, sq: -1, synced: false, resync: false, cold: true, rows: new Map(), ring: [], seen: new Set(), cols: null,
      meta: {}, full: {}, fresh: null, at: 0, frameAt: 0, regAt: 0, rsAt: 0, rsTries: 0, ver: 0, cache: null, cacheVer: -1,
      dropped: 0, truncated: false, tide: null, gaps: 0,
    };
  }

  var S = {
    refs: {}, topics: {}, handles: [], listeners: {}, focus: null, mode: "off", ws: null, helloed: false, started: false,
    fails: 0, pollFails: 0, polling: false, abort: null, ep: null, hello: null, closed: null, degraded: null, final: 0,
    subbed: null, offs: [], hidden: false,
  };
  TOPICS.forEach(function (k) { S.refs[k] = 0; S.topics[k] = newTopic(); S.listeners[k] = []; });
  S.listeners.transport = [];

  var pending = {};
  var raf = 0;

  function wanted() { return TOPICS.filter(function (k) { return S.refs[k] > 0; }); }

  function wsUrl() {
    var q = "k=" + encodeURIComponent(wanted().join(","));
    if (S.focus) q += "&f=" + encodeURIComponent(S.focus);
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/rt/ws?" + q;
  }

  function send(obj) {
    var ws = S.ws;
    if (!ws || ws.readyState !== 1 || !S.helloed) return false;
    var text = JSON.stringify(obj);
    var n = typeof TextEncoder === "function" ? new TextEncoder().encode(text).length : text.length;
    if (n > MAX_OUT) { stats.refused++; return false; }
    try { ws.send(text); } catch (e) { return false; }
    stats.sent++;
    stats.sentBytes += n;
    return true;
  }

  function dropFresh() {
    if (!UI.freshness || typeof UI.freshness.drop !== "function") return;
    TOPICS.forEach(function (k) { UI.freshness.drop("rt:" + k); S.topics[k].regAt = 0; });
  }

  function paintFeed() {
    if (UI.freshness && typeof UI.freshness.transport === "function") UI.freshness.transport(LABEL[S.mode] || null);
  }

  function setMode(m) {
    if (S.mode === m) return;
    var was = S.mode;
    S.mode = m;
    if (was === "socket" || m === "heartbeat" || m === "off") dropFresh();
    paintFeed();
    S.listeners.transport.slice().forEach(function (fn) { try { fn({ k: "transport", mode: m, was: was }); } catch (e) { return; } });
  }

  function stamp(v) {
    var n = typeof v === "number" ? v : Date.parse(v);
    return isFinite(n) ? n : null;
  }

  function stateOf(entry, serverNow) {
    var skew = (stamp(serverNow) || Date.now()) - Date.now();
    var liveUntil = stamp(entry.liveUntil);
    var staleAt = stamp(entry.staleAt);
    return {
      stateAt: function (now) {
        var t = (typeof now === "number" ? now : Date.now()) + skew;
        if (entry.state === "pending" || entry.state === "stale") return entry.state;
        if (entry.state === "closed") return staleAt !== null && t >= staleAt ? "stale" : "closed";
        if (liveUntil !== null && t < liveUntil) return "live";
        if (staleAt !== null && t < staleAt) return "fresh";
        return staleAt === null ? entry.state : "stale";
      },
    };
  }

  function register(k, f) {
    if (S.mode !== "socket" && S.mode !== "poll") return;
    var fr = f.fresh;
    if (!fr || fr.state === "pending" || !UI.freshness) return;
    var T = S.topics[k];
    var now = Date.now();
    if (now - T.regAt < REG_MS) return;
    T.regAt = now;
    var ff = typeof UI.freshFrom === "function" ? UI.freshFrom(fr, { serverNow: f.at }) : stateOf(fr, f.at);
    if (!ff) return;
    var o = { ff: ff, source: "rt:" + k };
    if (k === "px" && fr.state === "live" && typeof fr.readAt === "string" && ff.stateAt() === "live") { o.readAt = fr.readAt; o.live = true; }
    stats.reg++;
    UI.freshness(o);
  }

  function queue(k, ids, rows, snap, reset) {
    if (!S.listeners[k].length) return;
    var p = pending[k] || (pending[k] = { ids: new Set(), rows: [], snap: false, reset: false });
    for (var i = 0; i < ids.length; i++) p.ids.add(ids[i]);
    for (var j = 0; j < rows.length; j++) p.rows.push(rows[j]);
    if (snap) p.snap = true;
    if (reset) p.reset = true;
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function flush() {
    raf = 0;
    var batch = pending;
    pending = {};
    stats.flushes++;
    Object.keys(batch).forEach(function (k) {
      var p = batch[k];
      var T = S.topics[k];
      var change = { k: k, snap: p.snap, reset: p.reset, ids: Array.from(p.ids), rows: p.rows, meta: T.meta, fresh: T.fresh, at: T.at };
      S.listeners[k].slice().forEach(function (fn) { try { fn(change); } catch (e) { return; } });
    });
  }

  function sameRow(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 1; i < a.length - 1; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function sameGx(a, b) {
    for (var i = 1; i <= 5; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function validRow(row, k) {
    if (k === "mk") return row && typeof row === "object" && !Array.isArray(row) && typeof row.id === "string";
    if (k === "px") return Array.isArray(row) && typeof row[0] === "string" && row.length > 2;
    if (k === "gx") return Array.isArray(row) && typeof row[0] === "string" && row.length >= 6;
    return row && typeof row === "object" && !Array.isArray(row) && row.id !== undefined && row.id !== null;
  }

  function reset(k) {
    var T = S.topics[k];
    var had = T.rows.size || T.ring.length;
    var t = newTopic();
    t.cols = T.cols;
    t.regAt = T.regAt;
    t.ver = T.ver + 1;
    S.topics[k] = t;
    if (had) queue(k, [], [], false, true);
    if (UI.freshness && typeof UI.freshness.drop === "function") UI.freshness.drop("rt:" + k);
  }

  function ask(k) {
    var T = S.topics[k];
    if (S.mode !== "socket" || !T.resync) return;
    var now = Date.now();
    if (now - T.rsAt >= RS_GAP_MS - 400) {
      T.rsAt = now;
      T.rsTries++;
      send({ t: "rs", k: k });
    }
    if (T.rsTries >= RS_TRIES) { T.rsTries = 0; dead("resync"); return; }
    arm("rs:" + k, RS_GAP_MS, function () { ask(k); });
  }

  function tideOf(T, row) {
    var t = typeof row.t === "string" ? Date.parse(row.t) : NaN;
    if (!isFinite(t)) return;
    if (!T.tide || T.tide.date !== row.date) T.tide = { date: row.date, t: [], ncp: [], npp: [], net: [], nv: [] };
    var d = T.tide;
    var last = d.t.length ? Date.parse(d.t[d.t.length - 1]) : -Infinity;
    if (t < last) return;
    var at = t === last ? d.t.length - 1 : d.t.length;
    d.t[at] = row.t;
    d.ncp[at] = num(row.ncp);
    d.npp[at] = num(row.npp);
    d.net[at] = num(row.net);
    d.nv[at] = num(row.nv);
  }

  function fullOf(k, meta) {
    var full = {};
    if (k === "px") {
      full.missing = Array.isArray(meta.missing) ? meta.missing : [];
      full.prevFill = meta.prevFill && typeof meta.prevFill === "object" ? meta.prevFill : null;
    }
    return full;
  }

  function applySnap(k, T, f) {
    var meta = f.meta || {};
    var first = !T.synced;
    var ids = [];
    var fresh = [];
    var i;
    if (k === "px" || k === "gx" || k === "mk") {
      var next = new Map();
      for (i = 0; i < f.rows.length; i++) {
        var r = f.rows[i];
        if (validRow(r, k)) next.set(k === "mk" ? r.id : r[0], r);
      }
      next.forEach(function (row, id) {
        var old = T.rows.get(id);
        var same = old && (k === "px" ? sameRow(old, row) : k === "gx" ? sameGx(old, row) : sameJson(old, row));
        if (!same) ids.push(id);
      });
      T.rows.forEach(function (row, id) { if (!next.has(id)) ids.push(id); });
      T.rows = next;
      if (k === "mk" && next.has("tide")) tideOf(T, next.get("tide"));
    } else {
      var seen = new Set(T.ring.map(function (row) { return String(row.id); }));
      var ring = [];
      var nextSeen = new Set();
      for (i = 0; i < f.rows.length; i++) {
        var q = f.rows[i];
        if (!validRow(q, k)) continue;
        var id = String(q.id);
        if (nextSeen.has(id)) continue;
        nextSeen.add(id);
        ring.push(q);
        if (!seen.has(id)) fresh.push(q);
      }
      T.ring = ring.slice(-RING[k]);
      T.seen = nextSeen;
      if (k === "fl") { T.dropped = num(meta.dropped) || 0; T.truncated = meta.truncated === true; }
    }
    if (Array.isArray(meta.cols)) T.cols = meta.cols;
    T.meta = meta;
    T.full = fullOf(k, meta);
    T.fresh = f.fresh || null;
    T.sq = f.sq;
    T.at = f.at;
    T.frameAt = Date.now();
    T.synced = true;
    T.resync = false;
    T.cold = meta.cold === true;
    T.rsTries = 0;
    disarm("rs:" + k);
    T.ver++;
    stats.snaps++;
    if (first || ids.length || fresh.length) queue(k, ids, fresh, true, false);
    register(k, f);
  }

  function applyDelta(k, T, f) {
    var meta = f.meta || {};
    var ids = [];
    var fresh = [];
    var i;
    for (i = 0; i < f.rows.length; i++) {
      var r = f.rows[i];
      if (!validRow(r, k)) continue;
      if (k === "px" || k === "gx") {
        var old = T.rows.get(r[0]);
        if (old && old[1] !== null && r[1] !== null && r[1] < old[1]) continue;
        var same = old && (k === "px" ? sameRow(old, r) : sameGx(old, r));
        T.rows.set(r[0], r);
        if (!same) ids.push(r[0]);
      } else if (k === "mk") {
        var was = T.rows.get(r.id);
        T.rows.set(r.id, r);
        if (r.id === "tide") tideOf(T, r);
        if (!was || !sameJson(was, r)) ids.push(r.id);
      } else {
        var id = String(r.id);
        if (T.seen.has(id)) continue;
        T.seen.add(id);
        if (T.seen.size > SEEN_MAX) T.seen.delete(T.seen.values().next().value);
        T.ring.push(r);
        fresh.push(r);
      }
    }
    if (T.ring.length > RING[k]) T.ring.splice(0, T.ring.length - RING[k]);
    if (k === "fl") { T.dropped = num(meta.dropped) || T.dropped; T.truncated = meta.truncated === true; }
    T.meta = meta;
    T.fresh = f.fresh || T.fresh;
    T.sq = f.sq;
    T.at = f.at;
    T.frameAt = Date.now();
    T.cold = false;
    if (ids.length || fresh.length) T.ver++;
    stats.applied += ids.length + fresh.length;
    if (ids.length || fresh.length) queue(k, ids, fresh, false, false);
    register(k, f);
  }

  function topicFrame(f) {
    var k = f.k;
    if (S.refs[k] <= 0 || !Array.isArray(f.rows) || f.rows.length > ROWS_MAX || typeof f.sq !== "number") return;
    var T = S.topics[k];
    stats.frames++;
    if (f.ep !== T.ep) {
      if (!f.snap) {
        stats.orphans++;
        T.resync = true;
        ask(k);
        return;
      }
      if (T.ep !== null) reset(k);
      T = S.topics[k];
      T.ep = f.ep;
    }
    if (S.closed && !(f.snap && f.meta && f.meta.cold)) S.closed = null;
    if (f.snap) { applySnap(k, T, f); return; }
    if (T.resync) return;
    if (f.sq === T.sq + 1) { applyDelta(k, T, f); return; }
    if (f.sq <= T.sq) { stats.dups++; return; }
    stats.gaps++;
    T.gaps++;
    T.resync = true;
    ask(k);
  }

  function noteEpoch(ep) {
    if (typeof ep !== "number") return;
    if (S.ep !== null && S.ep !== ep) {
      TOPICS.forEach(function (k) {
        var T = S.topics[k];
        if (T.ep !== null && T.ep !== ep) { reset(k); S.topics[k].resync = true; }
      });
    }
    S.ep = ep;
  }

  function heartbeat(f) {
    var m = f.meta || {};
    if (m.upstream === "closed") { if (!S.closed) S.closed = { reason: "overnight", phase: m.phase || null, nextOpenAt: null }; }
    else S.closed = null;
    S.degraded = m.degraded && typeof m.degraded === "object" ? m.degraded : null;
    var ts = m.topics && typeof m.topics === "object" ? m.topics : {};
    TOPICS.forEach(function (k) {
      var h = ts[k];
      var T = S.topics[k];
      if (!h || !T.synced || T.resync || S.refs[k] <= 0) return;
      if (typeof h.sq === "number" && h.sq > T.sq) { T.resync = true; stats.gaps++; ask(k); return; }
      if (h.fresh && h.fresh.state !== "pending") { T.fresh = h.fresh; T.at = f.at; register(k, { fresh: h.fresh, at: f.at }); }
    });
  }

  function closedWake() {
    var c = S.closed;
    var at = c && c.nextOpenAt ? Date.parse(c.nextOpenAt) : NaN;
    var wait = isFinite(at) ? at - Date.now() + jitter(4000) : 600000;
    arm("closed", Math.min(3600000, Math.max(30000, wait)), function () { if (!S.final && !S.hidden) startPoll(0); });
  }

  function ctl(f) {
    var m = f.meta || {};
    noteEpoch(f.ep);
    if (f.t === "hb") { heartbeat(f); return; }
    if (f.t === "degraded") {
      S.degraded = { reason: m.reason || null, k: Array.isArray(m.k) ? m.k : [], since: m.since || null, retryAt: m.retryAt || null };
      return;
    }
    if (f.t === "resync") {
      var ks = Array.isArray(m.k) ? m.k : TOPICS;
      ks.forEach(function (k) {
        if (TOPICS.indexOf(k) < 0 || S.refs[k] <= 0) return;
        S.topics[k].resync = true;
        arm("rs:" + k, 6000, function () { ask(k); });
      });
      if (m.reason === "recovered") S.degraded = null;
      return;
    }
    if (f.t === "closed") {
      S.closed = { reason: m.reason || "overnight", phase: m.phase || null, nextOpenAt: m.nextOpenAt || null, nextRthOpenAt: m.nextRthOpenAt || null, day: m.day || null };
      if (S.mode === "poll") { stopPoll(); closedWake(); }
      paintFeed();
    }
  }

  function frame(f) {
    if (!f || typeof f !== "object" || Array.isArray(f) || f.v !== 1) { stats.bad++; return; }
    if (f.k === "ctl") { ctl(f); return; }
    if (TOPICS.indexOf(f.k) < 0) { stats.bad++; return; }
    noteEpoch(f.ep);
    topicFrame(f);
  }

  function watch() {
    var ms = S.closed ? SILENT_CLOSED_MS : Math.max(SILENT_MS, ((S.hello && num(S.hello.hbS)) || 5) * 3200);
    arm("watch", ms, function () { dead("silent"); });
  }

  function pulse() {
    arm("pulse", PULSE_MS, pulse);
    var sq = {};
    var any = false;
    TOPICS.forEach(function (k) {
      var T = S.topics[k];
      if (S.refs[k] > 0 && T.synced && !T.resync && T.sq >= 0) { sq[k] = T.sq; any = true; }
    });
    if (any) send({ t: "p", sq: sq });
  }

  function syncSub() {
    if (!S.helloed) return;
    var k = wanted().join(",");
    var cur = S.subbed;
    if (cur && cur.k === k && cur.f === S.focus) return;
    S.subbed = { k: k, f: S.focus };
    send({ t: "sub", k: wanted(), f: S.focus });
  }

  function closeSocket(ws, code, why) {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try { ws.close(code, why); } catch (e) { return; }
  }

  function stopSocket(code, why) {
    var ws = S.ws;
    S.ws = null;
    S.helloed = false;
    S.subbed = null;
    ["hello", "watch", "pulse"].forEach(disarm);
    TOPICS.forEach(function (k) { disarm("rs:" + k); });
    closeSocket(ws, code, why);
  }

  function fallback() {
    if (S.mode === "socket") setMode("heartbeat");
    if (S.closed) closedWake();
    else startPoll(0);
  }

  function lost() {
    S.fails++;
    var wait = S.fails <= FAST_TRIES ? jitter(Math.min(30000, 1000 * Math.pow(2, S.fails - 1))) : jitter(PROBE_MS);
    if (!S.final && wanted().length) {
      fallback();
      arm("retry", wait, openSocket);
    }
  }

  function dead() {
    stopSocket(1000, "silent");
    lost();
  }

  function ended(code) {
    stopSocket(1000, "bye");
    if (KEEP_OFF[code]) {
      fallback();
      arm("retry", jitter(PROBE_MS), openSocket);
      return;
    }
    lost();
  }

  function onBye(f) {
    ended(f.meta && typeof f.meta.code === "number" ? f.meta.code : 0);
  }

  function onMessage(data) {
    var t0 = performance.now();
    var kind = receive(data);
    var ms = performance.now() - t0;
    stats.ms += ms;
    if (ms > stats.maxMs) stats.maxMs = ms;
    var a = stats.kinds[kind] || (stats.kinds[kind] = [0, 0, 0]);
    a[0]++;
    a[1] += typeof data === "string" ? data.length : 0;
    a[2] += ms;
  }

  function receive(data) {
    stats.msgs++;
    stats.bytes += data && data.length ? data.length : 0;
    if (typeof data !== "string") return "binary";
    var f;
    try { f = JSON.parse(data); } catch (e) { stats.bad++; return "bad"; }
    if (!f || typeof f !== "object") { stats.bad++; return "bad"; }
    var kind = f.k === "ctl" ? "ctl:" + f.t : String(f.k);
    if (f.k === "ctl" && f.t === "bye") { onBye(f); return kind; }
    if (f.k === "ctl" && f.t === "hello") {
      S.helloed = true;
      S.fails = 0;
      disarm("hello");
      disarm("retry");
      stopPoll();
      S.pollFails = 0;
      setMode("socket");
      noteEpoch(f.ep);
      S.hello = f.meta || {};
      S.closed = null;
      (Array.isArray(f.rows) ? f.rows : []).forEach(frame);
      arm("pulse", PULSE_MS, pulse);
      syncSub();
    } else if (S.helloed) frame(f);
    if (S.helloed) watch();
    return kind;
  }

  function openSocket() {
    if (S.ws || S.final || S.hidden || !wanted().length || typeof WebSocket !== "function") {
      if (typeof WebSocket !== "function" && !S.final && wanted().length) startPoll(0);
      return;
    }
    var ws;
    try { ws = new WebSocket(wsUrl()); } catch (e) { lost(); return; }
    stats.opens++;
    S.ws = ws;
    S.helloed = false;
    S.subbed = { k: wanted().join(","), f: S.focus };
    arm("hello", HELLO_MS, function () { if (S.ws === ws && !S.helloed) { stopSocket(1000, "hello"); lost(); } });
    ws.onmessage = function (ev) { if (S.ws === ws) onMessage(ev.data); };
    ws.onerror = function () {};
    ws.onclose = function (ev) {
      if (S.ws === ws) ended(ev && typeof ev.code === "number" ? ev.code : 0);
    };
  }

  function remember(status) {
    try { sessionStorage.setItem(MEMO_KEY, status + ":" + Date.now()); } catch (e) { return; }
  }

  function recall() {
    try {
      var v = String(sessionStorage.getItem(MEMO_KEY) || "").split(":");
      return Date.now() - Number(v[1]) < MEMO_MS && MEMO_FOR[Number(v[0])] ? Number(v[0]) : 0;
    } catch (e) {
      return 0;
    }
  }

  function goFinal(status) {
    if (MEMO_FOR[status]) remember(status);
    S.final = status;
    stopSocket(1000, "off");
    stopPoll();
    disarm("retry");
    disarm("closed");
    setMode("off");
  }

  function stopPoll() {
    S.polling = false;
    disarm("poll");
    disarm("deadline");
    if (S.abort) { try { S.abort.abort(); } catch (e) { S.abort = null; } S.abort = null; }
  }

  function startPoll(ms) {
    if (S.final || S.polling || S.hidden || !wanted().length) return;
    if (S.mode === "socket" && S.helloed) return;
    S.polling = true;
    if (S.mode === "off") setMode("heartbeat");
    arm("poll", ms, pollOnce);
  }

  function pollFailed(wait) {
    S.pollFails++;
    if (S.pollFails >= 3 && S.mode !== "socket") setMode("heartbeat");
    if (S.polling) arm("poll", wait || Math.min(60000, POLL_MS * Math.pow(2, S.pollFails)), pollOnce);
  }

  function pollOnce() {
    if (!S.polling || S.hidden || S.final) return;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    S.abort = ctrl;
    var live = function () { return S.polling && S.abort === ctrl; };
    var done = function () { disarm("deadline"); };
    arm("deadline", DEADLINE_MS, function () { if (ctrl) ctrl.abort(); });
    stats.polls++;
    fetch("/api/rt/snap?k=" + encodeURIComponent(wanted().join(",")), {
      credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store", signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      if (!live()) return null;
      if (FINAL[r.status]) { done(); goFinal(r.status); return null; }
      if (!r.ok) {
        done();
        var ra = Number(r.headers.get("Retry-After"));
        pollFailed(isFinite(ra) && ra > 0 ? Math.min(120000, Math.max(POLL_MS, ra * 1000)) : 0);
        return null;
      }
      return r.text().then(function (text) {
        done();
        if (!live()) return;
        var frames;
        try { frames = JSON.parse(text); } catch (e) { frames = null; }
        if (!Array.isArray(frames)) { pollFailed(0); return; }
        stats.pollBytes += text.length;
        S.pollFails = 0;
        setMode("poll");
        var closed = false;
        frames.forEach(function (x) {
          if (x && x.k === "ctl" && x.t === "closed") closed = true;
          frame(x);
        });
        if (!closed) S.closed = null;
        paintFeed();
        if (!S.polling) return;
        if (closed) { S.polling = false; closedWake(); } else arm("poll", POLL_MS, pollOnce);
      });
    }).catch(function () {
      done();
      if (live()) pollFailed(0);
    });
  }

  function hibernate() {
    stopSocket(1000, "hidden");
    stopPoll();
    ["retry", "closed"].forEach(disarm);
    if (S.mode !== "off") setMode("heartbeat");
  }

  function resume() {
    if (S.final || !wanted().length) return;
    if (S.ws && S.helloed) { watch(); if (!timers.pulse) arm("pulse", PULSE_MS, pulse); return; }
    S.fails = 0;
    S.pollFails = 0;
    disarm("retry");
    if (S.mode === "off") setMode("heartbeat");
    openSocket();
    if (!S.ws || S.mode === "poll") startPoll(0);
  }

  function onVisibility() {
    S.hidden = !!document.hidden;
    if (S.hidden) {
      stopPoll();
      disarm("closed");
      arm("hide", HIDE_MS, hibernate);
    } else {
      disarm("hide");
      resume();
    }
  }

  function begin() {
    if (S.started) return;
    S.started = true;
    var known = recall();
    if (known) { S.final = known; return; }
    S.hidden = !!document.hidden;
    S.offs.push(listen(document, "visibilitychange", onVisibility));
    S.offs.push(listen(window, "pagehide", function () { stopSocket(1001, "pagehide"); stopPoll(); disarm("retry"); }));
    S.offs.push(listen(window, "pageshow", function (e) { if (e && e.persisted && !S.hidden) resume(); }));
    if (S.mode === "off") setMode("heartbeat");
    if (!S.hidden) { openSocket(); if (!S.ws) startPoll(0); }
  }

  function teardown() {
    stopSocket(1000, "done");
    stopPoll();
    disarmAll();
    S.offs.splice(0).forEach(function (off) { off(); });
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    pending = {};
    S.started = false;
    S.closed = null;
    S.degraded = null;
    S.fails = 0;
    S.pollFails = 0;
    S.ep = null;
    TOPICS.forEach(function (k) { S.topics[k] = newTopic(); });
    setMode("off");
  }

  function focusOf() {
    for (var i = S.handles.length - 1; i >= 0; i--) if (S.handles[i].focus) return S.handles[i].focus;
    return null;
  }

  function reconcile() {
    var was = S.focus;
    S.focus = focusOf();
    TOPICS.forEach(function (k) {
      if (S.refs[k] <= 0 && (S.topics[k].synced || S.topics[k].rows.size)) { S.topics[k] = newTopic(); if (UI.freshness && UI.freshness.drop) UI.freshness.drop("rt:" + k); }
    });
    if (!wanted().length) { if (S.started) teardown(); return; }
    if (!S.started) { begin(); return; }
    if (was !== S.focus || S.helloed) syncSub();
  }

  function offOf(list, fn) {
    return function () {
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  function on(topic, fn) {
    if (typeof fn !== "function" || !S.listeners[topic]) return function () {};
    S.listeners[topic].push(fn);
    var T = S.topics[topic];
    if (T && T.synced) queue(topic, Array.from(T.rows.keys()), T.ring.slice(), true, false);
    return offOf(S.listeners[topic], fn);
  }

  function connect(opts) {
    var o = opts || {};
    var asked = Array.isArray(o.topics) && o.topics.length ? o.topics : TOPICS;
    var topics = TOPICS.filter(function (k) { return asked.indexOf(k) >= 0; });
    if (!topics.length) return null;
    var focus = typeof o.focus === "string" && TICKER.test(o.focus.trim().toUpperCase()) ? o.focus.trim().toUpperCase() : null;
    var key = topics.join(",") + "|" + (focus || "");
    for (var i = 0; i < S.handles.length; i++) if (S.handles[i].key === key) return S.handles[i].api;
    var hd = { key: key, topics: topics, focus: focus, offs: [], api: null };
    hd.api = {
      close: function () {
        var at = S.handles.indexOf(hd);
        if (at < 0) return;
        S.handles.splice(at, 1);
        hd.offs.splice(0).forEach(function (off) { off(); });
        topics.forEach(function (k) { S.refs[k]--; });
        reconcile();
      },
      on: function (topic, fn) {
        var off = on(topic, fn);
        hd.offs.push(off);
        return off;
      },
      transport: transport,
      topics: topics.slice(),
    };
    S.handles.push(hd);
    topics.forEach(function (k) { S.refs[k]++; });
    reconcile();
    return hd.api;
  }

  function transport() { return S.mode; }

  function feeds(k) {
    var T = S.topics[k];
    if (!T || S.refs[k] <= 0 || (S.mode !== "socket" && S.mode !== "poll")) return false;
    if (!T.synced || T.resync || T.cold || !(T.rows.size || T.ring.length)) return false;
    return Date.now() - T.frameAt <= GRACE[k];
  }

  function ixOf(T) {
    var cols = T.cols ? T.cols.slice(2) : FIELDS;
    return { fields: cols, at: function (name) { return cols.indexOf(name); } };
  }

  function strips() {
    var T = S.topics.px;
    if (!T.synced || T.cold || !T.rows.size) return null;
    if (T.cacheVer !== T.ver) {
      var rows = {};
      T.rows.forEach(function (row, t) { rows[t] = row.slice(2); });
      T.cache = rows;
      T.cacheVer = T.ver;
    }
    var m = T.meta || {};
    var fr = T.fresh || {};
    var fields = ixOf(T).fields;
    var staleAt = Date.parse(fr.staleAt);
    return {
      v: 1, key: "live:strips", status: m.status || "ok", reason: m.reason || null,
      session: fr.session || (S.hello && S.hello.session) || null,
      fields: fields, rows: T.cache,
      fresh: { v: 1, readAt: fr.readAt || null, vendorAt: null, source: "hub", cadenceS: fr.cadenceS || 5, session: fr.session || null, writer: "rt" },
      asked: m.asked, returned: m.returned, rowDate: m.rowDate || null, ahead: m.ahead || null, off: { n: m.off || 0 },
      missing: T.full.missing || [], prevFill: T.full.prevFill || null,
      __rt: true, __updatedAt: null,
      __verdict: [fr.state, staleAt, (T.at || Date.now()) - Date.now()],
      __ff: typeof UI.freshFrom === "function" ? UI.freshFrom(fr, { serverNow: T.at }) : null,
    };
  }

  function quote(ticker) {
    var T = S.topics.px;
    var t = String(ticker || "").trim().toUpperCase();
    var row = T.synced && !T.cold ? T.rows.get(t) : null;
    var fr = T.fresh;
    if (!row || !fr || fr.state === "stale" || fr.state === "pending") return null;
    var ix = ixOf(T);
    var get = function (name) { var i = ix.at(name); return i < 0 ? null : num(row[2 + i]); };
    var px = get("px");
    if (px === null) return null;
    var qt = num(row[1]);
    var at = qt !== null ? qt : Date.parse(fr.readAt);
    return {
      ticker: t, status: "ok", readAt: iso(at), price: px, prevClose: get("prev"), changePct: get("chg"),
      volume: get("vol"), tapeTime: iso(qt), source: "rt",
    };
  }

  function gex(ticker) {
    var row = S.topics.gx.rows.get(String(ticker || "").trim().toUpperCase());
    return row ? { t: row[0], at: row[1], px: row[2], gOi: row[3], gVol: row[4], gDir: row[5], flow: row[6], lagS: row[7] } : null;
  }

  function mergeTide(base, rt) {
    var out = { t: [], ncp: [], npp: [], net: [], nv: [] };
    var cols = Object.keys(out);
    var seen = rt && rt.t.length ? rt : null;
    var first = seen ? Date.parse(seen.t[0]) : Infinity;
    if (base && Array.isArray(base.t) && (!seen || base.date === seen.date)) {
      for (var i = 0; i < base.t.length; i++) {
        if (Date.parse(base.t[i]) >= first) break;
        for (var c = 0; c < cols.length; c++) out[cols[c]].push(Array.isArray(base[cols[c]]) ? base[cols[c]][i] : null);
      }
    }
    if (seen) for (var j = 0; j < seen.t.length; j++) for (var d = 0; d < cols.length; d++) out[cols[d]].push(seen[cols[d]][j]);
    return out;
  }

  function market(base) {
    var T = S.topics.mk;
    if (!T.synced || T.cold || !T.rows.size) return base || null;
    var fr = T.fresh || {};
    var meta = T.meta || {};
    var tideMeta = meta.tide || {};
    var sectors = [];
    T.rows.forEach(function (row, id) {
      if (id === "tide") return;
      var copy = {};
      Object.keys(row).forEach(function (c) { if (c !== "id") copy[c] = row[c]; });
      sectors.push(copy);
    });
    sectors.sort(function (a, b) { return a.etf < b.etf ? -1 : a.etf > b.etf ? 1 : 0; });
    var seed = base && typeof base === "object" && base.tide && typeof base.tide === "object" ? base : null;
    var series = mergeTide(seed && seed.tide, T.tide);
    var body = Object.assign({}, seed || { v: 1, key: "live:market", units: {} });
    body.session = fr.session || (seed && seed.session) || null;
    body.tide = Object.assign({}, seed && seed.tide, {
      status: tideMeta.status || (seed && seed.tide.status) || "ok", reason: tideMeta.reason || null,
      date: (T.tide && T.tide.date) || tideMeta.date || (seed && seed.tide.date) || null,
      n: series.t.length, lastAt: tideMeta.lastAt || (seed && seed.tide.lastAt) || null,
      t: series.t, ncp: series.ncp, npp: series.npp, net: series.net, nv: series.nv,
    });
    if (sectors.length) body.sectors = { status: "ok", reason: null, rows: sectors };
    body.fresh = Object.assign({}, seed && seed.fresh, { readAt: fr.readAt || null, session: fr.session || null, cadenceS: fr.cadenceS || 10, source: "hub", writer: "rt" });
    body.__rt = true;
    body.__ff = typeof UI.freshFrom === "function" && fr.state ? UI.freshFrom(fr, { serverNow: T.at }) : null;
    return body;
  }

  function alerts() {
    var T = S.topics.fl;
    return { rows: T.ring.slice(), dropped: T.dropped, truncated: T.truncated, cursor: T.meta && T.meta.cursor ? T.meta.cursor : null, synced: T.synced };
  }

  function news() { return S.topics.nw.ring.slice(); }

  function fresh(k) { return S.topics[k] ? S.topics[k].fresh : null; }

  function status() {
    var out = { transport: S.mode, label: LABEL[S.mode] || null, closed: S.closed, degraded: S.degraded, final: S.final, hidden: S.hidden, topics: {} };
    TOPICS.forEach(function (k) {
      var T = S.topics[k];
      out.topics[k] = { sq: T.sq, ep: T.ep, synced: T.synced, resync: T.resync, cold: T.cold, rows: T.rows.size || T.ring.length, state: T.fresh ? T.fresh.state : null };
    });
    return out;
  }

  function measure() {
    return Object.assign({ timers: Object.keys(timers).length, listeners: listening, socket: S.ws ? 1 : 0, handles: S.handles.length, polling: S.polling ? 1 : 0, raf: raf ? 1 : 0 }, stats);
  }

  var api = {
    connect: connect, on: on, transport: transport, feeds: feeds, strips: strips, quote: quote, gex: gex, market: market,
    alerts: alerts, news: news, fresh: fresh, status: status, measure: measure,
  };
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { rt: Object.freeze(api) }));
})();
