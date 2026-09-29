(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || UI.freshFrom) return;
  var api = {};

  var STATES = ["live", "fresh", "closed", "stale", "pending"];
  var HEARTBEAT_MS = { ticker: 20000, other: 30000, extended: 60000 };
  var BEAT_DEADLINE_MS = 8000;
  var BACKOFF_MAX_MS = 5 * 60 * 1000;

  function ms(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var n = Date.parse(String(v));
    return isFinite(n) ? n : null;
  }

  function header(src, name) {
    if (!src) return null;
    var h = src.headers && typeof src.headers.get === "function" ? src.headers : src;
    if (typeof h.get !== "function") return null;
    var v = h.get(name);
    return v === null || v === "" ? null : v;
  }

  function fromHeaders(src) {
    var fx = function (n) { return header(src, "X-Fresh-" + n); };
    var state = fx("State");
    if (!state) return null;
    var serverNow = header(src, "X-Server-Now");
    return {
      state: STATES.indexOf(state) >= 0 ? state : "stale",
      reason: fx("Reason"),
      klass: fx("Class"),
      readAt: ms(fx("Read-At")),
      source: fx("Source"),
      cadenceS: Number(fx("Cadence")) || 0,
      session: fx("Session"),
      liveUntil: ms(fx("Live-Until")),
      staleAt: ms(fx("Stale-At")),
      phase: fx("Phase"),
      phaseEndsAt: ms(fx("Phase-Ends")),
      serverNow: serverNow === null ? null : ms(Number(serverNow)),
      throttled: fx("Throttled") === "1",
      overlay: header(src, "X-Live-Overlay"),
    };
  }

  function fromEntry(entry, serverNow, phase) {
    if (!entry || typeof entry !== "object") return null;
    return {
      state: STATES.indexOf(entry.state) >= 0 ? entry.state : "stale",
      reason: entry.reason || null, klass: entry.klass || null, readAt: ms(entry.readAt),
      source: entry.source || null, cadenceS: Number(entry.cadenceS) || 0, session: entry.session || null,
      liveUntil: ms(entry.liveUntil), staleAt: ms(entry.staleAt),
      phase: phase && phase.phase ? phase.phase : null, phaseEndsAt: phase ? ms(phase.endsAt) : null,
      serverNow: ms(serverNow), throttled: false, overlay: null, updatedAt: entry.updatedAt || null,
    };
  }

  function wrap(f) {
    if (!f) return null;
    f.skewMs = f.serverNow === null ? 0 : f.serverNow - Date.now();
    f.stateAt = function (now) {
      var t = (typeof now === "number" ? now : Date.now()) + f.skewMs;
      if (f.state === "pending" || f.state === "stale") return f.state;
      if (f.state === "closed") return f.staleAt !== null && t >= f.staleAt ? "stale" : "closed";
      if (f.liveUntil !== null && t < f.liveUntil) return "live";
      if (f.staleAt !== null && t < f.staleAt) return "fresh";
      return f.staleAt === null ? f.state : "stale";
    };
    f.nextAt = function (now) {
      var t = (typeof now === "number" ? now : Date.now()) + f.skewMs;
      var next = [f.liveUntil, f.staleAt, f.phaseEndsAt].filter(function (x) { return x !== null && x > t; });
      return next.length ? Math.min.apply(null, next) - f.skewMs : null;
    };
    f.forFreshness = function (now) {
      var s = f.stateAt(now);
      return { readAt: f.readAt === null ? null : new Date(f.readAt).toISOString(), live: s === "live",
        sessionDate: f.session, source: f.source, state: s };
    };
    return f;
  }

  api.freshFrom = function (src, extra) {
    if (src && typeof src === "object" && typeof src.state === "string" && !src.headers && typeof src.get !== "function") {
      return wrap(fromEntry(src, extra && extra.serverNow, extra && extra.phase));
    }
    return wrap(fromHeaders(src));
  };

  api.liveBody = function (env, k) {
    var e = env && env.keys ? env.keys[k] : null;
    if (!e) return null;
    var body = e.status === "ok" && e.payload && typeof e.payload === "object" ? e.payload : { status: "pending" };
    body.__updatedAt = e.updatedAt > 0 ? e.updatedAt : null;
    body.__ff = wrap(fromEntry(e.fresh, env.serverNow, env.phase));
    return body;
  };

  api.freshAggregate = function (list, phase) {
    var states = (list || []).filter(Boolean).map(function (f) { return typeof f === "string" ? f : f.stateAt(); });
    if (!states.length) return "pending";
    if (states.indexOf("stale") >= 0) return "stale";
    var live = states.indexOf("live") >= 0;
    if (phase && phase !== "rth" && !live) return "closed";
    if (live) return "live";
    if (states.every(function (s) { return s === "closed"; })) return "closed";
    return states.indexOf("fresh") >= 0 ? "fresh" : states[0];
  };

  api.heartbeatInterval = function (phase, page, hidden) {
    if (hidden) return null;
    if (phase === "rth") return page === "ticker" ? HEARTBEAT_MS.ticker : HEARTBEAT_MS.other;
    if (phase === "pre" || phase === "post") return HEARTBEAT_MS.extended;
    return null;
  };

  api.heartbeat = function (opts) {
    var o = opts || {};
    var seen = null;
    var timer = null;
    var backoff = 0;
    var stopped = false;
    var phase = null;
    var phaseEndsAt = null;
    var query = [];
    var part = function (name, v) { if (v && v.length) query.push(name + "=" + encodeURIComponent(v.join ? v.join(",") : v)); };
    var at = function () { return "/api/flows/now" + (query.length ? "?" + query.join("&") : ""); };
    part("k", o.keys);
    part("n", o.nightly);
    part("t", o.ticker);
    var url = at();

    function schedule() {
      if (stopped) return;
      clearTimeout(timer);
      timer = null;
      var wait = api.heartbeatInterval(phase, o.page, document.hidden);
      if (backoff) wait = Math.min(BACKOFF_MAX_MS, Math.max(wait || HEARTBEAT_MS.other, backoff));
      if (wait === null && phaseEndsAt !== null && !document.hidden) wait = Math.max(1000, phaseEndsAt - Date.now());
      if (wait !== null) timer = setTimeout(beat, wait);
    }

    function beat() {
      if (stopped) return;
      var deadline = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(BEAT_DEADLINE_MS) : undefined;
      fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: deadline })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (body) {
          backoff = 0;
          phase = body.phase ? body.phase.phase : null;
          phaseEndsAt = body.phase ? ms(body.phase.endsAt) : null;
          var changed = [];
          var fresh = {};
          var first = seen === null;
          if (first) seen = {};
          Object.keys(body.keys || {}).forEach(function (k) {
            var e = body.keys[k];
            fresh[k] = api.freshFrom(e, { serverNow: body.serverNow, phase: body.phase });
            if (!first && seen[k] !== e.updatedAt) changed.push(k);
            seen[k] = e.updatedAt;
          });
          if (typeof o.onBeat === "function") o.onBeat({ body: body, fresh: fresh, changed: changed });
          if (changed.length && typeof o.onChange === "function") o.onChange(changed, fresh, body);
          if (body.quote && typeof o.onQuote === "function") o.onQuote(body.quote);
        })
        .catch(function () { backoff = backoff ? backoff * 2 : 2 * (api.heartbeatInterval(phase, o.page, false) || HEARTBEAT_MS.other); })
        .then(schedule);
    }

    function onVisibility() {
      if (stopped) return;
      if (document.hidden) { clearTimeout(timer); timer = null; } else beat();
    }
    document.addEventListener("visibilitychange", onVisibility);
    beat();
    return {
      stop: function () { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); },
      now: beat,
    };
  };
  window.FlowsUI = Object.freeze(Object.assign({}, UI, api));
})();
