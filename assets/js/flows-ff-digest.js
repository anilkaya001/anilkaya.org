(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || UI.ffDigest) return;

  var DASH = "—";
  var QUADRANTS = ["house-nightly", "house-live", "yours-nightly", "yours-live"];
  var VIEWS = ["house", "yours", "record"];
  var INCOMPLETE = DASH + " not measured: the stored hits do not reach back past this session, so this list can be short";

  function isAbsent(f) {
    if (!f || typeof f !== "object" || f.reason) return true;
    if (Object.prototype.hasOwnProperty.call(f, "v") && (f.v === null || f.v === undefined)) return true;
    return typeof f.text !== "string" || !f.text.trim() || f.text.trim() === DASH;
  }

  function said(f, fallback) {
    if (typeof f === "string" && f.trim() && f.trim() !== DASH) return { text: f, reason: null };
    if (f && typeof f === "object" && !isAbsent(f) && typeof f.text === "string" && f.text.trim() && f.text.trim() !== DASH) return { text: f.text, reason: null };
    var reason = f && typeof f === "object" && typeof f.reason === "string" ? f.reason : "missing";
    var why = f && typeof f === "object" && typeof f.reasonText === "string" && f.reasonText ? f.reasonText : fallback || reason.replace(/_/g, " ");
    return { text: DASH + " " + why, reason: reason };
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function hitLine(h) {
    var sentence = said(h.sentence, "the stored hit carries no sentence");
    if (!sentence.reason && typeof h.symbol === "string" && h.symbol && sentence.text.indexOf(h.symbol + " ") === 0) sentence.text = sentence.text.slice(h.symbol.length + 1);
    var at = said(h.at, "no time stored");
    return {
      id: String(h.id || ""),
      symbol: typeof h.symbol === "string" && h.symbol ? h.symbol : DASH,
      sentence: sentence.text,
      sentenceAbsent: sentence.reason,
      at: at.text,
      withdrawn: h.withdrawn ? "withdrawn" + (h.withdrawn.reason ? ": " + String(h.withdrawn.reason).replace(/_/g, " ") : "") : null,
    };
  }

  function quadrantModel(q, shadow) {
    var groups = Array.isArray(q.hits) ? q.hits : [];
    var total = typeof q.total === "number" && q.total >= 0 ? q.total : 0;
    var receipts = q.receipts && typeof q.receipts.line === "string" ? q.receipts.line : DASH + " no receipts were read";
    var runText;
    if (q.run && typeof q.run === "object" && typeof q.run.status === "string") {
      var fin = said(q.run.finishedAt, "the run has not finished");
      runText = "run " + q.run.status + ", finished " + fin.text;
    } else {
      runText = said(q.run, "no run recorded for this session").text;
    }
    return {
      id: q.id,
      title: q.title,
      total: total,
      count: shadow && total === 0 ? "0 delivered" : plural(total, "hit", "hits"),
      empty: total === 0 ? (shadow ? "No hit delivered: in shadow every hit is held." : "No hit in this session.") : null,
      incomplete: q.complete === false ? INCOMPLETE : null,
      receipts: receipts,
      receiptsAbsent: receipts.indexOf(DASH) === 0,
      run: runText,
      groups: groups.map(function (g) {
        var rarity = said(g.rarity, "under 20 sessions of history");
        return {
          wire: g.wire && typeof g.wire.title === "string" && g.wire.title ? g.wire.title : DASH + " untitled wire",
          wireId: g.wire ? String(g.wire.id || "") : "",
          count: typeof g.count === "number" ? g.count : (g.hits || []).length,
          rarity: rarity.text,
          rarityAbsent: rarity.reason,
          more: typeof g.more === "number" && g.more > 0 ? g.more : 0,
          hits: (Array.isArray(g.hits) ? g.hits : []).map(hitLine),
        };
      }),
    };
  }

  function recordLine(w) {
    var rec = w.record;
    var firings = rec && typeof rec === "object" && !rec.reason && rec.firings && rec.sessions && !isAbsent(rec.firings) && !isAbsent(rec.sessions) ? rec : null;
    var figure;
    if (firings && typeof firings.firings.text === "string" && typeof firings.sessions.text === "string") {
      figure = { text: firings.firings.text + " " + (firings.firings.v === 1 ? "firing" : "firings") + " in " + firings.sessions.text + " " + (firings.sessions.v === 1 ? "session" : "sessions"), reason: null };
    } else {
      figure = said(rec, "no record yet");
    }
    var rarity = said(w.rarity, "under 20 sessions of history");
    return {
      id: String(w.id || ""),
      title: typeof w.title === "string" && w.title ? w.title : DASH + " untitled wire",
      following: w.following !== false,
      figure: figure.text,
      figureAbsent: figure.reason,
      rarity: rarity.text,
      rarityAbsent: rarity.reason,
      cadence: w.cadence === "live" ? "Live" : "Nightly",
    };
  }

  function model(body, opts) {
    var shadow = !!(opts && opts.shadow);
    var d = body && body.digest ? body.digest : null;
    if (!d || !Array.isArray(d.quadrants)) return null;
    var byId = {};
    d.quadrants.forEach(function (q) { byId[q.id] = q; });
    return {
      session: typeof d.session === "string" ? d.session : null,
      latest: typeof body.latest === "string" ? body.latest : null,
      complete: d.complete !== false,
      quadrants: QUADRANTS.map(function (id) {
        return quadrantModel(byId[id] || { id: id, title: id, hits: [], total: 0, receipts: { line: DASH + " no receipts were read" }, run: null }, shadow);
      }),
      silent: (d.hygiene && Array.isArray(d.hygiene.silent) ? d.hygiene.silent : []).map(function (s) {
        var last = said(s.lastHit, "no hits yet");
        return { title: s.wire && s.wire.title ? s.wire.title : DASH + " untitled wire", text: String(s.text || ""), last: last.text };
      }),
    };
  }

  function recordModel(body) {
    var wires = body && Array.isArray(body.wires) ? body.wires : null;
    if (!wires) return null;
    var lines = wires.map(recordLine);
    return { lines: lines, following: lines.filter(function (l) { return l.following; }).length };
  }

  var root = typeof document === "undefined" ? null : document.getElementById("ffxDigest");
  var api = { model: model, recordModel: recordModel };
  if (!root) {
    window.FlowsUI = Object.freeze(Object.assign({}, UI, { ffDigest: Object.freeze(api) }));
    return;
  }

  var K = UI.ffKernel;
  var shadow = root.getAttribute("data-shadow") === "1";
  var cap = document.getElementById("ffxDigCap");
  var latestLink = document.getElementById("ffxDigLatest");
  var retry = document.getElementById("ffxDigRetry");
  var live = document.getElementById("ffxDigLive");
  var allDlg = document.getElementById("ffxDigAll");
  var allList = document.getElementById("ffxDigAllList");
  var allTitle = document.getElementById("ffxDigAllT");
  var recList = document.getElementById("ffxDigRecs");
  var recN = document.getElementById("ffxDigRecN");
  var hy = document.getElementById("ffxDigHy");
  var hyList = document.getElementById("ffxDigHyList");
  var state = { digest: null, record: null, error: null, loads: 0 };

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]); });
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function put(node, text, reason) {
    if (!node) return;
    if (reason) {
      if (K && K.hooks) K.hooks.absent(node, reason, text);
      else { node.textContent = text; node.setAttribute("data-ff-absent", reason); }
    } else if (K && K.hooks) {
      K.hooks.present(node, text);
    } else {
      node.textContent = text;
      node.removeAttribute("data-ff-absent");
    }
    if (node.getAttribute("title") !== node.textContent) node.setAttribute("title", node.textContent);
  }

  function span(cls, text, reason) {
    var n = el("span", { class: cls });
    put(n, text, reason);
    return n;
  }

  function groupItem(g) {
    var li = el("li", { class: "ffx-dig-g", "data-ff-wire": g.wireId || null });
    var head = el("div", { class: "ffx-dig-gh" });
    head.appendChild(span("ffx-dig-w ffx-clip", g.wire));
    head.appendChild(el("span", { class: "ffx-dig-gc" }, plural(g.count, "hit", "hits")));
    head.appendChild(span("ffx-dig-r ffx-clip", g.rarity, g.rarityAbsent));
    li.appendChild(head);
    g.hits.forEach(function (h) {
      var row = el("div", { class: "ffx-dig-h", "data-ff-hit": h.id || null });
      row.appendChild(el("span", { class: "ffx-dig-sym" }, h.symbol));
      row.appendChild(span("ffx-dig-s ffx-clip", h.sentence, h.sentenceAbsent));
      if (h.withdrawn) row.appendChild(el("span", { class: "ffx-dig-wd" }, h.withdrawn));
      li.appendChild(row);
    });
    if (g.more > 0) li.appendChild(el("div", { class: "ffx-dig-more" }, "and " + plural(g.more, "more hit", "more hits") + " of this wire"));
    return li;
  }

  function quadrantNode(id) { return document.getElementById("ffxDig-" + id); }
  function part(q, k) { return q.querySelector('[data-k="' + k + '"]'); }

  function fitAll() {
    if (!state.digest) return;
    state.digest.quadrants.forEach(function (m) {
      var q = quadrantNode(m.id);
      if (!q) return;
      var list = part(q, "list");
      var all = part(q, "all");
      var got = K && K.fit ? K.fit.rows(list, { keep: 1 }) : { cut: 0 };
      var cut = got.cut;
      all.hidden = cut === 0;
      var label = cut === 0 ? "Show all" : "Show all " + m.groups.length;
      if (all.textContent !== label) all.textContent = label;
      [].forEach.call(q.querySelectorAll(".ffx-clip"), function (c) { if (K && K.fit) K.fit.clip(c); });
    });
    [].forEach.call(document.querySelectorAll("#ffxDigRecord .ffx-clip"), function (c) { if (K && K.fit) K.fit.clip(c); });
    if (K && K.fit) K.fit.rows(recList, { keep: 1 });
    if (K && K.fit) K.fit.rows(hyList, { keep: 1 });
  }

  function paintQuadrant(m) {
    var q = quadrantNode(m.id);
    if (!q) return;
    q.removeAttribute("aria-busy");
    put(part(q, "n"), m.count);
    var list = part(q, "list");
    list.textContent = "";
    m.groups.forEach(function (g) { list.appendChild(groupItem(g)); });
    var empty = part(q, "empty");
    empty.hidden = m.empty === null;
    if (m.empty !== null) put(empty, m.empty);
    var inc = part(q, "inc");
    inc.hidden = m.incomplete === null;
    if (m.incomplete !== null) put(inc, m.incomplete, "not_measured");
    put(part(q, "rc"), m.receipts + " · " + m.run, m.receiptsAbsent ? "no_receipts" : null);
  }

  function paintDigest(m) {
    state.digest = m;
    retry.hidden = true;
    put(cap, "Session " + m.session + (m.latest && m.latest !== m.session ? " · the latest is " + m.latest : "") + " · computed when read");
    latestLink.hidden = !(m.latest && m.latest !== m.session);
    m.quadrants.forEach(paintQuadrant);
    hy.hidden = m.silent.length === 0;
    hyList.textContent = "";
    m.silent.forEach(function (s) {
      var li = el("li", { class: "ffx-dig-g" });
      var head = el("div", { class: "ffx-dig-gh" });
      head.appendChild(span("ffx-dig-w ffx-clip", s.title));
      li.appendChild(head);
      li.appendChild(span("ffx-dig-s ffx-clip", s.text + " · last hit " + s.last));
      hyList.appendChild(li);
    });
    fitAll();
    live.textContent = "Digest for session " + m.session + " loaded.";
  }

  function errorText(err, what) {
    var c = err && err.code;
    var d = err && err.details ? err.details : {};
    if (c === "ff_off") return what + " is unavailable: " + String(d.reason || "switched off").replace(/_/g, " ");
    if (c === "ff_export_range") return "that session is outside the digest window";
    if (c === "ff_cursor_invalid") return "the session in the address is not a date";
    if (c === "network" || c === "timeout") return "Flows did not answer";
    if (c === "rate_limited") return "too many reads just now";
    return String((err && err.message) || "the read failed");
  }

  function paintDigestError(err) {
    state.error = err;
    var text = errorText(err, "the Digest");
    put(cap, text, (err && err.code) || "failed");
    retry.hidden = err && (err.code === "ff_export_range" || err.code === "ff_cursor_invalid");
    latestLink.hidden = !(err && (err.code === "ff_export_range" || err.code === "ff_cursor_invalid"));
    QUADRANTS.forEach(function (id) {
      var q = quadrantNode(id);
      q.removeAttribute("aria-busy");
      put(part(q, "n"), "unavailable: " + text, "unavailable");
      part(q, "list").textContent = "";
      part(q, "empty").hidden = true;
      part(q, "inc").hidden = true;
      put(part(q, "rc"), "no receipts read: " + text, "unavailable");
      part(q, "all").hidden = true;
    });
    live.textContent = "The Digest could not be read.";
  }

  function paintRecord(m) {
    state.record = m;
    recList.removeAttribute("aria-busy");
    recList.textContent = "";
    put(recN, m.following + " followed");
    if (m.lines.length === 0) {
      var none = el("li", { class: "ffx-dig-wait" });
      put(none, "no house wire is armed", "no_record");
      recList.appendChild(none);
    }
    m.lines.forEach(function (l) {
      var li = el("li", { class: "ffx-dig-g", "data-ff-wire": l.id || null });
      var head = el("div", { class: "ffx-dig-gh" });
      head.appendChild(span("ffx-dig-w ffx-clip", l.title));
      head.appendChild(el("span", { class: "ffx-dig-gc" }, l.cadence + (l.following ? "" : " · not followed")));
      li.appendChild(head);
      var row = el("div", { class: "ffx-dig-h" });
      row.appendChild(span("ffx-dig-s ffx-clip", l.figure, l.figureAbsent));
      row.appendChild(span("ffx-dig-r ffx-clip", l.rarity, l.rarityAbsent));
      li.appendChild(row);
      recList.appendChild(li);
    });
    fitAll();
  }

  function paintRecordError(err) {
    recList.removeAttribute("aria-busy");
    recList.textContent = "";
    var li = el("li", { class: "ffx-dig-wait" });
    put(li, "the record is unavailable: " + errorText(err, "the record"), (err && err.code) || "failed");
    recList.appendChild(li);
    put(recN, "unavailable", "unavailable");
  }

  function client() {
    var k = window.FlowsUI && window.FlowsUI.ffClient;
    if (!k || typeof k.get !== "function") {
      var err = new Error("the Fire & Forget client did not load");
      err.code = "client_missing";
      return { get: function () { return Promise.reject(err); } };
    }
    return k;
  }

  function digestPath() {
    var d = new URLSearchParams(location.search).get("d");
    return "/api/ff/digest" + (d ? "?d=" + encodeURIComponent(d) : "");
  }

  function load() {
    state.loads++;
    var net = client();
    var a = net.get(digestPath()).then(function (body) {
      var m = model(body, { shadow: shadow });
      if (!m) {
        var e = new Error("the digest answer could not be read");
        e.code = "unreadable";
        throw e;
      }
      paintDigest(m);
    }).catch(paintDigestError);
    var b = net.get("/api/ff/house").then(function (body) {
      var m = recordModel(body);
      if (!m) {
        var e = new Error("the house wires could not be read");
        e.code = "unreadable";
        throw e;
      }
      paintRecord(m);
    }).catch(paintRecordError);
    return Promise.all([a, b]);
  }

  function setView(v) {
    if (VIEWS.indexOf(v) < 0) return;
    root.setAttribute("data-view", v);
    [].forEach.call(document.querySelectorAll("#ffxDigTabs [role=tab]"), function (t) {
      var on = t.getAttribute("data-v") === v;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.setAttribute("tabindex", on ? "0" : "-1");
    });
    fitAll();
  }

  var tabs = document.getElementById("ffxDigTabs");
  tabs.addEventListener("click", function (e) {
    var t = e.target.closest("[role=tab]");
    if (t) setView(t.getAttribute("data-v"));
  });
  tabs.addEventListener("keydown", function (e) {
    var cur = VIEWS.indexOf(root.getAttribute("data-view"));
    var next = null;
    if (e.key === "ArrowRight") next = (cur + 1) % VIEWS.length;
    else if (e.key === "ArrowLeft") next = (cur + VIEWS.length - 1) % VIEWS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = VIEWS.length - 1;
    if (next === null) return;
    e.preventDefault();
    setView(VIEWS[next]);
    var t = tabs.querySelector('[data-v="' + VIEWS[next] + '"]');
    if (t) t.focus();
  });

  root.addEventListener("click", function (e) {
    var b = e.target.closest('[data-k="all"]');
    if (!b || !state.digest) return;
    var id = b.closest("[data-q]").getAttribute("data-q");
    var m = state.digest.quadrants.filter(function (q) { return q.id === id; })[0];
    if (!m) return;
    allTitle.textContent = m.title + ": all hits";
    allList.textContent = "";
    m.groups.forEach(function (g) { allList.appendChild(groupItem(g)); });
    allDlg.showModal();
  });
  [allDlg, document.getElementById("ffxDigInfo")].forEach(function (dlg) {
    dlg.addEventListener("click", function (e) { if (e.target.closest("[data-close]") || e.target === dlg) dlg.close(); });
  });
  document.getElementById("ffxDigInfoBtn").addEventListener("click", function () { document.getElementById("ffxDigInfo").showModal(); });
  retry.addEventListener("click", function () {
    retry.hidden = true;
    put(cap, "reading the digest", "reading");
    load();
  });

  if (K && K.fit) K.fit.watch(document.getElementById("ffxDigStage"), fitAll);

  api.state = function () { return { digest: state.digest, record: state.record, loads: state.loads }; };
  api.load = load;
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffDigest: Object.freeze(api) }));
  load();
})();
