(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || UI.ffKernel) return;

  var DASH = "—";
  var PAGES = Object.freeze(["fire", "inbox", "digest", "wires"]);
  var STATES = Object.freeze(["live", "resting", "degraded", "down", "unknown"]);
  var SLOTS = Object.freeze(["mark", "name-panel", "history", "record"]);
  var EVENTS = Object.freeze({
    "ff:unread": Object.freeze(["house", "member", "total"]),
    "ff:health": Object.freeze(["state", "evaluator"]),
    "ff:read": Object.freeze(["stream", "seq"]),
  });
  var REASON_RE = /^[a-z][a-z0-9_]{0,63}$/;
  var TITLED = new WeakMap();

  function isEl(n) { return !!n && n.nodeType === 1; }
  function has(list, v) { return list.indexOf(v) >= 0; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function page() {
    var n = document.querySelector("[data-ff-page]");
    var v = n ? n.getAttribute("data-ff-page") : null;
    return has(PAGES, v) ? v : null;
  }

  function slot(name) {
    return has(SLOTS, name) ? document.querySelector('[data-ff-slot="' + name + '"]') : null;
  }

  function state(el, value) {
    if (!isEl(el)) return null;
    var v = has(STATES, value) ? value : "unknown";
    if (el.getAttribute("data-ff-state") !== v) el.setAttribute("data-ff-state", v);
    return v;
  }

  function write(el, line) {
    if (el.textContent !== line) el.textContent = line;
    return line;
  }

  function absent(el, reason, text) {
    if (!isEl(el)) return null;
    var why = typeof reason === "string" && REASON_RE.test(reason) ? reason : "missing";
    var said = typeof text === "string" ? text.replace(/^\s*—?\s*/, "").trim() : "";
    if (el.getAttribute("data-ff-absent") !== why) el.setAttribute("data-ff-absent", why);
    return write(el, DASH + " " + (said || why.replace(/_/g, " ")));
  }

  function present(el, text) {
    if (!isEl(el)) return null;
    if (typeof text !== "string" || !text.trim() || text.trim() === DASH) return absent(el, "missing");
    if (el.hasAttribute("data-ff-absent")) el.removeAttribute("data-ff-absent");
    return write(el, text);
  }

  function figure(el, f, fallback) {
    var o = f && typeof f === "object" ? f : {};
    if (typeof o.text === "string" && o.text.trim() && o.text.trim() !== DASH && !o.reason) return present(el, o.text);
    return absent(el, o.reason, typeof o.reasonText === "string" && o.reasonText ? o.reasonText : fallback);
  }

  function detailOf(name, detail) {
    var keys = own(EVENTS, name) ? EVENTS[name] : null;
    if (!keys || !detail || typeof detail !== "object") return null;
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      if (!own(detail, keys[i]) || detail[keys[i]] === undefined) return null;
      out[keys[i]] = detail[keys[i]];
    }
    if (name === "ff:health" && !has(STATES, out.state)) out.state = "unknown";
    return Object.freeze(out);
  }

  function emit(name, detail) {
    var d = detailOf(name, detail);
    if (!d) return false;
    document.dispatchEvent(new CustomEvent(name, { detail: d }));
    return true;
  }

  function on(name, fn) {
    if (!own(EVENTS, name) || typeof fn !== "function") return function () {};
    var heard = function (e) {
      var d = detailOf(name, e.detail);
      if (d) fn(d);
    };
    document.addEventListener(name, heard);
    return function () { document.removeEventListener(name, heard); };
  }

  function rows(list, o) {
    if (!isEl(list)) return { total: 0, shown: 0, cut: 0 };
    var keep = o && typeof o.keep === "number" && o.keep >= 0 ? Math.floor(o.keep) : 1;
    var kids = [].slice.call(list.children);
    kids.forEach(function (k) { k.classList.remove("ffx-cut"); });
    var cut = 0;
    for (var i = kids.length - 1; i >= keep; i--) {
      if (list.scrollHeight <= list.clientHeight + 1) break;
      kids[i].classList.add("ffx-cut");
      cut++;
    }
    return { total: kids.length, shown: kids.length - cut, cut: cut };
  }

  function clip(el) {
    if (!isEl(el)) return false;
    var over = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    var text = el.textContent.replace(/\s+/g, " ").trim();
    if (over && text) {
      if (!el.hasAttribute("title") || TITLED.get(el) === true) {
        if (el.getAttribute("title") !== text) el.setAttribute("title", text);
        TITLED.set(el, true);
      }
    } else if (TITLED.get(el) === true) {
      el.removeAttribute("title");
      TITLED.delete(el);
    }
    return over;
  }

  function watch(el, fn) {
    if (!isEl(el) || typeof fn !== "function") return function () {};
    var watching = true;
    var run = function () { if (watching) fn(); };
    var ro = typeof ResizeObserver === "function" ? new ResizeObserver(run) : null;
    if (ro) ro.observe(el);
    else window.addEventListener("resize", run);
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") document.fonts.ready.then(run, function () {});
    run();
    return function () {
      watching = false;
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", run);
    };
  }

  var kernel = Object.freeze({
    DASH: DASH,
    hooks: Object.freeze({
      PAGES: PAGES, STATES: STATES, SLOTS: SLOTS, EVENTS: EVENTS,
      page: page, slot: slot, state: state, absent: absent, present: present, figure: figure, emit: emit, on: on,
    }),
    fit: Object.freeze({ rows: rows, clip: clip, watch: watch }),
  });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffKernel: kernel }));
})();
