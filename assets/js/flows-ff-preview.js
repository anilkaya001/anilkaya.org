(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || (UI.ffFire && UI.ffFire.preview)) return;

  var DASH = "—";

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function isObj(x) { return x && typeof x === "object"; }
  function figure(f, fallback) {
    if (isObj(f) && typeof f.text === "string" && f.text !== DASH) return { text: f.text, absent: false };
    var why = isObj(f) && f.reasonText ? f.reasonText : fallback;
    return { text: DASH + " " + why, absent: true };
  }

  function reasonList(map) {
    var keys = Object.keys(isObj(map) ? map : {});
    return keys.slice(0, 3).map(function (k) { return String(k).replace(/_/g, " ") + " " + map[k]; }).join(", ");
  }

  function subjectRow(s) {
    var verdict = s.verdict === "true" ? "holds" : s.verdict === "false" ? "does not hold" : "unknown";
    var li = el("li", { class: "ffx-sr", "data-verdict": s.verdict, "data-symbol": s.symbol });
    li.appendChild(el("span", { class: "ffx-sym", text: String(s.symbol || DASH) }));
    li.appendChild(el("span", { class: "ffx-vd", text: s.verdict === "unknown" ? (s.reasonText || DASH + " unknown") : verdict, title: s.verdict === "unknown" ? s.reasonText || "" : "" }));
    var sd = function (t) { return String(t).replace(/\u03c3/g, " SD"); };
    var detail = (s.clauses || []).map(function (c) {
      var v = c.valueText === undefined || c.valueText === null ? DASH : sd(c.valueText);
      return c.label + " " + v + " (needs " + (c.op === ">=" ? "≥" : c.op === "<=" ? "≤" : "=") + " " + sd(c.thresholdText) + ")";
    }).join(" · ");
    li.appendChild(el("span", { class: "ffx-sd", text: detail, title: detail }));
    return li;
  }

  function mount(host, o) {
    var client = o.client;
    var ticket = 0;
    var timer = 0;
    var last = null;
    var dlg = el("dialog", { class: "ffx-dlg", "aria-labelledby": o.id + "-pt" });
    var dbody = el("ul", { class: "ffx-slist ffx-slist-all" });
    var dclose = el("button", { type: "button", class: "ffx-link", "data-close": "", text: "Close" });
    dlg.appendChild(el("div", { class: "ffx-dg" }, [el("h2", { id: o.id + "-pt", text: "Names read right now" }), dbody, el("div", { class: "ffx-dx" }, [dclose])]));
    (host.closest(".flows-main") || host.closest(".ffx") || document.body).appendChild(dlg);
    dclose.addEventListener("click", function () { dlg.close(); });

    function frame(state, headline, sub, kids) {
      host.textContent = "";
      host.setAttribute("data-state", state);
      host.appendChild(el("div", { class: "ffx-p" }, [
        el("p", { class: "ffx-big", role: "status", text: headline }),
        sub ? el("p", { class: "ffx-sub1", text: sub }) : null,
      ].concat(kids || [])));
    }

    function idle(text) {
      last = null;
      ticket++;
      clearTimeout(timer);
      host.textContent = "";
      host.setAttribute("data-state", "idle");
      host.appendChild(el("p", { class: "ffx-wait", "data-ff-absent": "pending", text: text }));
    }

    function fitList(list, showAll, total) {
      var rows = [].slice.call(list.children);
      rows.forEach(function (r) { r.classList.remove("cut"); });
      var cut = 0;
      for (var i = rows.length - 1; i >= Math.min(1, rows.length); i--) {
        if (list.scrollHeight <= list.clientHeight + 1) break;
        rows[i].classList.add("cut");
        cut++;
      }
      showAll.hidden = cut === 0;
      showAll.textContent = cut ? "Show all " + total : "";
    }

    function show(view) {
      last = view;
      if (view.status !== "ok") {
        frame("unavailable", DASH + " " + String(view.reasonText || "could not read").replace(/^—\s*/, ""), "Nothing is read as zero. The wire can still be armed.");
        return;
      }
      var c = view.coverage || {};
      var decided = Number(c.evaluated) || 0;
      var hold = Number(c.wouldHit) || 0;
      var head = decided === 0 ? DASH + " no name could be read" : hold + " of " + plural(decided, "name", "names") + " hold this now";
      var unknownLine = c.unknown ? c.unknown + " unknown: " + reasonList(c.reasons) : "";
      var exp = figure(view.expWeek, "not measured");
      var first = view.evaluator && view.evaluator.firstCheck ? view.evaluator.firstCheck.label : DASH + " first check not known";
      var fr = view.freshness || {};
      var asOf = figure(fr.asOf, "no read time");
      var dl = el("dl", { class: "ffx-facts" }, [
        el("dt", { text: "First check" }), el("dd", { text: first }),
        el("dt", { text: "Reads data of" }), el("dd", { text: (fr.session || DASH) + (asOf.absent ? " " + asOf.text : " · " + asOf.text) + (fr.stale ? " · older than the last close" : "") }),
        el("dt", { text: "False alarms a week" }), el("dd", { text: exp.text, "data-ff-absent": exp.absent ? "not_measured" : null }),
      ]);
      var subjects = Array.isArray(view.subjects) ? view.subjects : [];
      var kids = [dl];
      var total = subjects.length;
      if (total) {
        var list = el("ul", { class: "ffx-slist", "aria-label": view.status === "ok" && subjects.some(function (s) { return s.verdict !== "true"; }) ? "Names read" : "Names that hold" });
        subjects.forEach(function (s) { list.appendChild(subjectRow(s)); });
        var all = el("button", { type: "button", class: "ffx-link ffx-all", hidden: true, "aria-haspopup": "dialog" });
        all.addEventListener("click", function () {
          dbody.textContent = "";
          subjects.forEach(function (s) { dbody.appendChild(subjectRow(s)); });
          dlg.showModal();
        });
        kids.push(el("div", { class: "ffx-slwrap" }, [list]), el("div", { class: "ffx-slfoot" }, [
          el("span", { text: view.truncated ? "The first " + total + " of those that hold." : "" }), all]));
        host.__fit = function () { fitList(list, all, total); };
        if (typeof ResizeObserver === "function") new ResizeObserver(function () { if (host.__fit) host.__fit(); }).observe(list);
      } else {
        kids.push(el("p", { class: "ffx-sub1", text: hold === 0 && decided > 0 ? "No name holds this right now." : "" }));
        host.__fit = null;
      }
      frame("ok", head, unknownLine, kids);
      if (host.__fit) host.__fit();
    }

    function failed(err) {
      var code = err && err.code ? err.code : "unreadable";
      frame("error", DASH + " could not read now: " + (err && err.message ? err.message : code), null, [
        el("button", { type: "button", class: "ffx-link ffx-retry", text: "Retry" }),
      ]);
      host.querySelector(".ffx-retry").addEventListener("click", function () { if (again) run(again[0], again[1], 0); });
    }

    var again = null;
    function run(ast, template, delay) {
      again = [ast, template];
      var mine = ++ticket;
      clearTimeout(timer);
      frame("loading", DASH + " reading", "Reading the stored figures for this wire.");
      timer = setTimeout(function () {
        client.post("/api/ff/preview", template ? { ast: ast, template: template } : { ast: ast }).then(function (view) {
          if (mine === ticket) show(view);
        }, function (err) {
          if (mine === ticket) { last = null; failed(err); }
        });
      }, delay !== undefined ? delay : o.delay === undefined ? 450 : o.delay);
    }

    if (typeof ResizeObserver === "function") new ResizeObserver(function () { if (host.__fit) host.__fit(); }).observe(host);
    return { run: run, idle: idle, show: show, last: function () { return last; }, fit: function () { if (host.__fit) host.__fit(); }, destroy: function () { clearTimeout(timer); ticket++; dlg.remove(); } };
  }

  var prev = UI.ffFire || {};
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffFire: Object.freeze(Object.assign({}, prev, { preview: Object.freeze({ mount: mount }) })) }));
})();
