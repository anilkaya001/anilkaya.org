(function () {
  "use strict";
  var U = window.FlowsUI;
  var L = U && U.link;
  if (!L || typeof L.attach !== "function") return;

  var KEY = { ticker: "t", sector: "s", strike: "k", expiry: "e", side: "d", time: "m" };
  var KIND = {};
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  Object.keys(KEY).forEach(function (k) { KIND[KEY[k]] = k; });
  var CHANNELS = ["A", "B", "C"];
  var CLOCKS = ["known", "event"];
  var SAY_MS = 5000;
  var MAX_MSG = 600;

  function iso(v) {
    var t = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
    return isFinite(t) && t >= 0 && t < 4102444800000 ? new Date(t).toISOString() : null;
  }
  var CHECK = {
    ticker: function (v) { v = typeof v === "string" ? v.trim().toUpperCase() : ""; return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(v) ? v : null; },
    sector: function (v) { return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._&\-]{0,23}$/.test(v) ? v : null; },
    strike: function (v) {
      var n = typeof v === "string" && /^\d{1,6}(\.\d{1,4})?$/.test(v) ? Number(v) : v;
      return typeof n === "number" && isFinite(n) && n >= 0.01 && n < 1e6 ? n : null;
    },
    expiry: function (v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isFinite(Date.parse(v)) ? v : null; },
    side: function (v) { return typeof v === "string" && /^[a-z]{2,8}$/.test(v) ? v : null; },
    time: iso,
  };
  function pick(kind, value, source) {
    var v = own(KEY, kind) ? CHECK[kind](value) : null;
    if (v === null) return null;
    return { kind: kind, value: v, source: typeof source === "string" ? source.replace(/[^\w .\-]/g, "").slice(0, 24) : null };
  }

  var members = [];
  var sel = { A: null, B: null, C: null };
  var cur = null;
  var curBy = null;
  var ctx = { scene: null, mode: null };
  var group = null;
  var bc = null;
  var outbox = {};
  var dirty = false;
  var raf = 0;
  var HASH = {};
  var REMOTE = {};
  var WIN = Math.random().toString(36).slice(2, 10);
  var said = { at: 0, text: null, note: null, timer: 0 };

  function listens(m, c) { return m.channel === null || m.channel === c; }

  function chanOf(owner) {
    for (var i = 0; i < members.length; i++) if (members[i].owner === owner) return members[i].channel || "A";
    return "A";
  }

  function schedule() {
    if (raf || (!members.length && !dirty && !bc)) return;
    raf = requestAnimationFrame(flush);
  }

  function mark(c) {
    var by = sel[c] ? sel[c].owner : null;
    members.forEach(function (m) { if (listens(m, c) && m.owner !== by) m.todo[c] = 1; });
  }

  function markCursor() {
    members.forEach(function (m) { if (m.owner !== curBy) m.todo.tc = 1; });
  }

  function say(text, note) {
    if (note) said.note = text;
    else said.text = text;
    if (said.timer) return;
    var wait = SAY_MS - (Date.now() - said.at);
    if (wait <= 0) { speak(); return; }
    said.timer = setTimeout(function () { said.timer = 0; speak(); }, wait);
  }

  function speak() {
    said.at = Date.now();
    var t = [said.note, said.text].filter(Boolean).join(" ");
    said.note = said.text = null;
    if (t && typeof U.announce === "function") U.announce(t);
  }

  function call(m, s) {
    try { m.on(s); } catch (e) { return; }
  }

  function flush() {
    raf = 0;
    var lit = null;
    members.slice().forEach(function (m) {
      CHANNELS.forEach(function (c) {
        if (!m.todo[c]) return;
        delete m.todo[c];
        var s = sel[c];
        if (!s || s.owner === m.owner || (m.kinds && m.kinds.indexOf(s.kind) < 0)) return;
        call(m, { channel: c, kind: s.kind, value: s.value, source: s.source });
        lit = s.kind + " " + s.value;
      });
      if (!m.todo.tc) return;
      delete m.todo.tc;
      if (m.kinds && m.kinds.indexOf("time") < 0) return;
      if (cur && m.clocks.indexOf(cur.clock) < 0) {
        say((typeof m.owner === "string" ? m.owner : "A panel") + " has only " + m.clocks.join(" and ") + " time and cannot follow the " + cur.clock + " clock.", true);
        return;
      }
      call(m, { channel: null, kind: "time", value: cur ? cur.tau : null, clock: cur ? cur.clock : null, source: null });
      lit = lit || (cur ? "time " + cur.tau : "live time");
    });
    if (lit) say("Linked views follow " + lit + ".");
    if (dirty) { dirty = false; writeHash(); }
    var sent = Object.keys(outbox);
    if (sent.length && bc) post(outbox);
    outbox = {};
  }

  function hashOf() {
    var out = [];
    CHANNELS.forEach(function (c) {
      var s = sel[c];
      if (s) out.push(c + ":" + KEY[s.kind] + "=" + encodeURIComponent(String(s.value)));
    });
    if (cur) out.push("tc=" + cur.clock + "@" + cur.tau.replace(/\.000Z$/, "Z"));
    if (group) out.push("w=" + group);
    return out.length ? "l=" + out.join(";") : "";
  }

  function writeHash() {
    var next = hashOf();
    var now = location.hash.replace(/^#/, "");
    if (next === (/^l=/.test(now) ? now : "")) return;
    try { history.replaceState(history.state, "", location.pathname + location.search + (next ? "#" + next : "")); } catch (e) { return; }
  }

  function parse(h) {
    var out = { sel: {}, cur: null, w: null };
    var m = /^#l=(.*)$/.exec(h || "");
    if (!m) return out;
    m[1].split(";").forEach(function (p) {
      var a = /^([ABC]):([a-z])=(.+)$/.exec(p);
      var b = /^tc=(known|event)@(.+)$/.exec(p);
      var w = /^w=([0-9a-f]{8,32})$/.exec(p);
      if (a && own(KIND, a[2])) {
        var v = null;
        try { v = pick(KIND[a[2]], decodeURIComponent(a[3]), "hash"); } catch (e) { v = null; }
        if (v) out.sel[a[1]] = v;
      } else if (b) {
        var t = iso(b[2]);
        if (t) out.cur = { tau: t, clock: b[1] };
      } else if (w) out.w = w[1];
    });
    return out;
  }

  function take(p) {
    CHANNELS.forEach(function (c) {
      var s = p.sel[c] || null;
      var was = sel[c];
      if (!s && !was) return;
      if (s && was && s.kind === was.kind && s.value === was.value) return;
      sel[c] = s ? { kind: s.kind, value: s.value, source: s.source, owner: HASH } : null;
      mark(c);
    });
    if ((p.cur && p.cur.tau) !== (cur && cur.tau) || (p.cur && p.cur.clock) !== (cur && cur.clock)) {
      cur = p.cur;
      curBy = HASH;
      markCursor();
    }
    if (p.w && p.w !== group) { group = p.w; open(); }
    schedule();
  }

  function open() {
    if (bc || !group || typeof BroadcastChannel !== "function") return;
    try { bc = new BroadcastChannel("flows-link:" + group); } catch (e) { bc = null; return; }
    bc.onmessage = function (ev) { heard(ev && ev.data); };
  }

  function post(box) {
    var msg = { v: 1, id: WIN, s: {}, c: undefined };
    CHANNELS.forEach(function (c) {
      if (c in box) msg.s[c] = box[c] ? { kind: box[c].kind, value: box[c].value, source: box[c].source } : null;
    });
    if ("tc" in box) msg.c = box.tc ? { tau: box.tc.tau, clock: box.tc.clock } : null;
    try { bc.postMessage(msg); } catch (e) { return; }
  }

  function heard(msg) {
    if (!msg || typeof msg !== "object" || msg.v !== 1 || msg.id === WIN || !msg.s || typeof msg.s !== "object") return;
    var size = 0;
    try { size = JSON.stringify(msg).length; } catch (e) { return; }
    if (size > MAX_MSG) return;
    CHANNELS.forEach(function (c) {
      if (!(c in msg.s)) return;
      var s = msg.s[c];
      var v = s && typeof s === "object" ? pick(s.kind, s.value, s.source) : null;
      if (s !== null && !v) return;
      sel[c] = v ? { kind: v.kind, value: v.value, source: v.source, owner: REMOTE } : null;
      mark(c);
    });
    if (msg.c !== undefined) {
      var t = msg.c && typeof msg.c === "object" && CLOCKS.indexOf(msg.c.clock) >= 0 ? iso(msg.c.tau) : null;
      if (msg.c === null || t) {
        cur = t ? { tau: t, clock: msg.c.clock } : null;
        curBy = REMOTE;
        markCursor();
      }
    }
    dirty = true;
    schedule();
  }

  function join(owner, cfg) {
    cfg = cfg || {};
    if (owner === undefined || owner === null || typeof cfg.on !== "function") return { leave: function () {} };
    var m = {
      owner: owner,
      channel: CHANNELS.indexOf(cfg.channel) >= 0 ? cfg.channel : null,
      kinds: Array.isArray(cfg.kinds) ? cfg.kinds.filter(function (k) { return own(KEY, k); }) : null,
      clocks: Array.isArray(cfg.clocks) ? cfg.clocks.filter(function (c) { return CLOCKS.indexOf(c) >= 0; }) : CLOCKS,
      on: cfg.on,
      todo: {},
    };
    members.push(m);
    if (cfg.scene || cfg.mode) context({ scene: cfg.scene, mode: cfg.mode });
    CHANNELS.forEach(function (c) { if (sel[c] && listens(m, c)) m.todo[c] = 1; });
    if (cur) m.todo.tc = 1;
    schedule();
    return {
      leave: function () {
        var i = members.indexOf(m);
        if (i >= 0) members.splice(i, 1);
      },
    };
  }

  function emit(owner, e) {
    var v = e && typeof e === "object" ? pick(e.kind, e.value, e.source) : null;
    if (!v) return false;
    var c = chanOf(owner);
    sel[c] = { kind: v.kind, value: v.value, source: v.source, owner: owner };
    outbox[c] = sel[c];
    dirty = true;
    mark(c);
    schedule();
    return true;
  }

  function cursor(next, by) {
    if (next === undefined) return cur ? { tau: cur.tau, clock: cur.clock } : null;
    var t = next && typeof next === "object" && CLOCKS.indexOf(next.clock) >= 0 ? iso(next.tau) : null;
    if (next !== null && !t) return cur ? { tau: cur.tau, clock: cur.clock } : null;
    cur = t ? { tau: t, clock: next.clock } : null;
    curBy = by === undefined ? null : by;
    outbox.tc = cur;
    dirty = true;
    markCursor();
    schedule();
    return cursor();
  }

  function context(patch) {
    if (!patch || typeof patch !== "object") return;
    if (typeof patch.scene === "string") ctx.scene = patch.scene.replace(/[^\w.\-]/g, "").slice(0, 24) || null;
    if (typeof patch.mode === "string") ctx.mode = patch.mode.replace(/[^\w.\-]/g, "").slice(0, 16) || null;
  }

  function describe() {
    var s = {};
    CHANNELS.forEach(function (c) { if (sel[c]) s[c] = KEY[sel[c].kind] + "=" + String(sel[c].value).slice(0, 24); });
    var o = {
      scene: ctx.scene || location.pathname.replace(/^\/|\/$/g, "").split("/").pop().replace(/[^\w.\-]/g, "").slice(0, 24) || null,
      mode: ctx.mode, tau: cur ? cur.tau : null, clock: cur ? cur.clock : null, selection: s,
    };
    while (JSON.stringify(o).length > 256 && Object.keys(s).length) delete s[Object.keys(s).pop()];
    return o;
  }

  function popout(path) {
    if (typeof path !== "string" || path.charAt(0) !== "/" || path.charAt(1) === "/" || path.length > 200) return null;
    if (!group) {
      var b = new Uint8Array(8);
      crypto.getRandomValues(b);
      group = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    }
    open();
    writeHash();
    window.open(path + "#" + hashOf(), "_blank", "noopener");
    return group;
  }

  window.addEventListener("hashchange", function () { take(parse(location.hash)); });
  take(parse(location.hash));

  var api = { join: join, emit: emit, cursor: cursor, context: context, describe: describe, popout: popout };
  L.attach(api);
})();
