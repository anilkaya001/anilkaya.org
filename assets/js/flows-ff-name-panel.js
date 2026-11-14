(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || UI.ffNamePanel) return;

  var DASH = "—";
  var SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
  var STATE_WORD = { hit: "hit today", quiet: "quiet", armed: "armed", paused: "paused" };

  function symbolOf(search) {
    var t = String(new URLSearchParams(search || "").get("t") || "").trim().toUpperCase();
    return SYMBOL_RE.test(t) ? t : null;
  }

  function model(panel, symbol) {
    var wires = panel && Array.isArray(panel.wires) ? panel.wires : [];
    var armed = panel && typeof panel.armed === "number" ? panel.armed : wires.filter(function (w) { return w.status === "armed"; }).length;
    if (!wires.length) {
      return { kind: "none", text: "Arm a wire", href: "/flows/fire/?symbol=" + encodeURIComponent(symbol), wire: null, title: "No wire of yours names " + symbol + ". Arm one on Fire." };
    }
    var hit = wires.some(function (w) { return w.state === "hit"; });
    var lead = wires.filter(function (w) { return w.state === "hit"; })[0] || wires.filter(function (w) { return w.status === "armed"; })[0] || wires[0];
    var head = armed > 0 ? armed + (armed === 1 ? " wire" : " wires") + " armed" : wires.length + (wires.length === 1 ? " wire" : " wires") + " paused";
    var lines = wires.map(function (w) {
      return (w.title || w.id) + ": " + (STATE_WORD[w.state] || w.status) + (w.state === "quiet" && w.quietUntil ? " until the " + w.quietUntil + " session" : "");
    });
    return {
      kind: hit ? "hit" : armed > 0 ? "armed" : "paused",
      text: head + (hit ? " · hit today" : ""),
      href: "/flows/wires/?wire=" + encodeURIComponent(lead.id),
      wire: lead.id,
      title: "Your wires on " + symbol + ". " + lines.join(". ") + ".",
    };
  }

  function errLine(err) {
    var c = err && err.code ? err.code : "error";
    if (c === "rate_limited") return "too many reads just now";
    if (c === "network" || c === "timeout") return "Flows did not answer";
    return String(err && err.message ? err.message : c);
  }

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

  function paint(slot, m) {
    var a = document.createElement("a");
    a.className = "ffx-np";
    a.href = m.href;
    a.setAttribute("data-kind", m.kind);
    if (m.wire) a.setAttribute("data-ff-wire", m.wire);
    a.title = m.title;
    a.setAttribute("aria-label", m.title);
    var t = document.createElement("span");
    t.className = "ffx-np-t";
    t.textContent = m.text;
    a.appendChild(t);
    slot.textContent = "";
    slot.appendChild(a);
  }

  function absent(slot, reason, why) {
    var s = document.createElement("span");
    s.className = "ffx-np ffx-np-x";
    s.setAttribute("data-ff-absent", reason);
    s.textContent = DASH + " wires not read";
    s.title = DASH + " your wires on this name were not read: " + why;
    slot.textContent = "";
    slot.appendChild(s);
  }

  function boot() {
    var slot = document.querySelector('[data-ff-slot="name-panel"]');
    if (!slot) return;
    var symbol = symbolOf(location.search);
    if (!symbol) { slot.hidden = true; return; }
    sheet();
    kit().then(function (G) {
      return G.ffClient.get("/api/ff/symbol?t=" + encodeURIComponent(symbol)).then(function (r) {
        if (!r || !r.panel) return absent(slot, "missing", "the answer carried no panel");
        paint(slot, model(r.panel, symbol));
      }, function (err) {
        if (err && (err.code === "ff_off" || err.code === "unauthorized")) { slot.hidden = true; return; }
        absent(slot, err && err.code ? err.code : "error", errLine(err));
      });
    }, function () { absent(slot, "client_missing", "the client did not load"); });
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffNamePanel: Object.freeze({ model: model, symbolOf: symbolOf }) }));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
