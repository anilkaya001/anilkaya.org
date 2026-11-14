(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || (UI.ffInbox && UI.ffInbox.evidence)) return;

  var DASH = "—";
  var OP_TEXT = Object.freeze({ ">=": "≥", "<=": "≤", "==": "=" });
  var F = UI.F || {};

  function finite(v) { return typeof v === "number" && isFinite(v); }

  function ordinal(text) {
    var n = Number(text);
    var t = n % 100;
    if (t >= 11 && t <= 13) return text + "th";
    return text + (["th", "st", "nd", "rd"][n % 10] || "th");
  }

  function plural(text, one, many) { return text + " " + (text === "1" ? one : many); }

  function value(v, unit) {
    if (!finite(v)) return DASH;
    switch (unit) {
      case "usd": return F.money(v);
      case "contracts": return F.int(v);
      case "sigma": return F.px(v, 2) + " SD";
      case "vol_pt": return F.px(v, 1) + " pts";
      case "pct": return F.px(v, 1) + "%";
      case "pctile": return ordinal(F.px(v, 0));
      case "ratio": return F.px(v, 2);
      case "sessions": return plural(F.px(v, 0), "session", "sessions");
      case "days": return plural(F.px(v, 0), "day", "days");
      case "bool": return v ? "yes" : "no";
      default: return DASH;
    }
  }

  function rows(e) {
    var list = e && Array.isArray(e.clauses) ? e.clauses : [];
    return list.map(function (c) {
      var n = c && typeof c.n === "number" && Math.floor(c.n) === c.n ? c.n : null;
      return {
        m: String(c.m || ""),
        label: typeof c.label === "string" && c.label ? c.label : String(c.m || DASH),
        value: value(c.value, c.unit),
        op: OP_TEXT[c.op] || String(c.op || DASH),
        threshold: value(c.x, c.unit),
        ok: c.ok !== false,
        floored: c.floored === true,
        baseline: n === null ? null : n + "/" + (typeof c.window === "number" ? c.window : 20) + " sessions",
      };
    });
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function cell(tag, text, absentWhy) {
    var c = el(tag, { text: text, title: text });
    if (absentWhy && text === DASH) c.setAttribute("data-ff-absent", absentWhy);
    return c;
  }

  function render(host, e) {
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!e || typeof e !== "object" || e.v === null) {
      var why = e && typeof e.reasonText === "string" ? e.reasonText : "the stored evidence is unreadable";
      host.appendChild(el("p", { class: "ffx-ib-wait", "data-ff-absent": (e && e.reason) || "not_measured", text: DASH + " " + why }));
      return { rows: 0 };
    }
    var list = rows(e);
    var table = el("table", { class: "ffx-ib-ev" });
    table.appendChild(el("caption", { class: "visually-hidden", text: "Evidence frozen when the hit was written" }));
    table.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { scope: "col", text: "Condition" }), el("th", { scope: "col", text: "Value" }), el("th", { scope: "col", text: "Rule" }), el("th", { scope: "col", text: "Baseline" }),
    ])]));
    var body = el("tbody");
    list.forEach(function (r) {
      var base = r.baseline === null ? DASH : r.baseline + (r.floored ? " · denominator floored" : "");
      var tr = el("tr", { "data-m": r.m }, [
        el("th", { scope: "row", class: "ffx-ib-ev-l", title: r.label, text: r.label }),
        cell("td", r.value, "missing"),
        el("td", { text: r.op + " " + r.threshold, title: r.op + " " + r.threshold }),
        cell("td", base, "not_measured"),
      ]);
      body.appendChild(tr);
    });
    table.appendChild(body);
    host.appendChild(table);
    var notes = [];
    if (e.bh && typeof e.bh === "object") notes.push("Tested against the false-alarm control of its scope (q " + F.px(Number(e.bh.q), 2) + ").");
    if (Array.isArray(e.sources) && e.sources.length) {
      notes.push("Read from " + e.sources.map(function (s) { return String(s.key) + (s.session ? " (" + s.session + " session)" : ""); }).join(", ") + ".");
    }
    if (notes.length) host.appendChild(el("p", { class: "ffx-ib-evn", title: notes.join(" "), text: notes.join(" ") }));
    return { rows: list.length };
  }

  var evidence = Object.freeze({ value: value, rows: rows, render: render });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffInbox: Object.freeze(Object.assign({}, UI.ffInbox || {}, { evidence: evidence })) }));
})();
