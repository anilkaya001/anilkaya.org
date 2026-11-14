(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || UI.ffMark) return;

  var DASH = "—";
  var MIN_S = 30;
  var MAX_S = 900;
  var STATES = ["live", "resting", "degraded", "down", "unknown"];
  var WORD = { live: "Live", resting: "Resting", degraded: "Degraded", down: "Down", unknown: DASH };

  function sheet() {
    var holder = document.querySelector('i[data-defer="ff-mark"][data-css]');
    var href = holder ? holder.getAttribute("data-css") : null;
    if (!href || document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function kit() {
    var G = window.FlowsUI;
    if (G.ffKernel && G.ffClient) return Promise.resolve(G);
    if (typeof G.defer !== "function") return Promise.reject(new Error("no loader"));
    return G.defer("ff-kit").then(function () { return window.FlowsUI; });
  }

  function clampS(s, fallback) {
    var n = Number(s);
    if (!isFinite(n) || n <= 0) n = fallback;
    return Math.min(MAX_S, Math.max(MIN_S, n));
  }

  function build(slot) {
    var a = document.createElement("a");
    a.className = "ffx-mark";
    a.href = "/flows/wires/";
    a.setAttribute("data-ff-state", "unknown");
    a.setAttribute("aria-label", "Wires. Health not read yet.");
    if (document.body && document.body.getAttribute("data-flows-page") === "wires") a.setAttribute("aria-current", "page");
    var ring = document.createElement("span");
    ring.className = "ffx-mark-ring";
    ring.setAttribute("aria-hidden", "true");
    var label = document.createElement("span");
    label.className = "ffx-mark-l";
    label.textContent = "Wires";
    var line = document.createElement("span");
    line.className = "ffx-mark-s";
    line.setAttribute("data-ff-absent", "reading");
    line.textContent = DASH + " reading";
    var n = document.createElement("span");
    n.className = "ffx-mark-n";
    n.hidden = true;
    a.appendChild(ring);
    a.appendChild(label);
    a.appendChild(line);
    a.appendChild(n);
    slot.textContent = "";
    slot.appendChild(a);
    return { a: a, line: line, n: n };
  }

  function start(slot) {
    sheet();
    var m = build(slot);
    var timer = 0;
    var stopped = false;
    var owed = false;
    var last = null;
    var api = null;

    function label(state, said, unread) {
      var text = "Wires. " + said + (unread && unread.total ? ". " + unread.label + " unread" : "") + ".";
      if (m.a.getAttribute("aria-label") !== text) m.a.setAttribute("aria-label", text);
      if (m.a.title !== said) m.a.title = said;
    }

    function paint(state, short, said, absentReason, unread) {
      var K = window.FlowsUI.ffKernel;
      var s = STATES.indexOf(state) >= 0 ? state : "unknown";
      if (K) K.hooks.state(m.a, s); else m.a.setAttribute("data-ff-state", s);
      if (absentReason) {
        if (K) K.hooks.absent(m.line, absentReason, short); else { m.line.textContent = DASH + " " + short; m.line.setAttribute("data-ff-absent", absentReason); }
      } else if (K) K.hooks.present(m.line, short); else { m.line.textContent = short; m.line.removeAttribute("data-ff-absent"); }
      if (unread && unread.total > 0) {
        if (m.n.textContent !== unread.label) m.n.textContent = unread.label;
        m.n.hidden = false;
      } else {
        m.n.hidden = true;
        m.n.textContent = "";
      }
      label(s, said, unread);
      if (K) K.fit.clip(m.line);
    }

    function schedule(seconds) {
      clearTimeout(timer);
      if (stopped) return;
      timer = setTimeout(poll, clampS(seconds, 60) * 1000);
    }

    function apply(v) {
      if (!v || typeof v !== "object") return fail({ code: "unreadable", message: "the health answer could not be read" });
      last = v;
      var state = STATES.indexOf(v.state) >= 0 ? v.state : "unknown";
      var said = typeof v.line === "string" && v.line ? v.line : DASH + " health line not returned";
      var short = state === "unknown" ? (v.reasonText || "health unavailable") : WORD[state];
      paint(state, short, said, state === "unknown" ? v.reason || "unavailable" : null, v.unread || null);
      var K = window.FlowsUI.ffKernel;
      if (K) {
        K.hooks.emit("ff:health", { state: state, evaluator: v.evaluator || null });
        if (v.unread) K.hooks.emit("ff:unread", { house: v.unread.house, member: v.unread.member, total: v.unread.total });
      }
      schedule(v.pollAfterS);
    }

    function fail(err) {
      var code = err && err.code ? err.code : "error";
      if (code === "unauthorized" || code === "forbidden") {
        stopped = true;
        paint("unknown", "signed out", DASH + " health not read: signed out", "unauthorized", null);
        return;
      }
      if (code === "ff_off") {
        stopped = true;
        paint("unknown", "Fire & Forget is off", DASH + " Fire & Forget is off", "ff_off", null);
        return;
      }
      if (code === "rate_limited") {
        if (!last) paint("unknown", "not read yet", DASH + " health not read yet: too many reads just now", "rate_limited", null);
        schedule(err.retryAfterS || 60);
        return;
      }
      paint("down", "health not read", DASH + " health not read: " + String(err && err.message ? err.message : code), null, last ? last.unread : null);
      var K = window.FlowsUI.ffKernel;
      if (K) K.hooks.emit("ff:health", { state: "down", evaluator: null });
      schedule(60);
    }

    function poll() {
      clearTimeout(timer);
      if (stopped) return;
      if (document.hidden) { owed = true; return; }
      owed = false;
      api.get("/api/ff/health").then(apply, fail);
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (timer) { clearTimeout(timer); timer = 0; owed = true; }
      } else if (owed) poll();
    });

    return kit().then(function (G) {
      api = G.ffClient;
      poll();
    }, function () {
      paint("unknown", "not loaded", DASH + " the Wires mark did not load its client", "client_missing", null);
    });
  }

  function boot() {
    var slot = document.querySelector('[data-ff-slot="mark"]');
    if (slot) start(slot);
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffMark: Object.freeze({ clampS: clampS, MIN_S: MIN_S, MAX_S: MAX_S }) }));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
