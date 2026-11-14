(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || UI.ffWires) return;

  var DASH = "—";
  var WIRE_RE = /^w-[a-z2-7]{16}$/;
  var HOUSE_RE = /^h-t\d\d[a-z]?$/;
  var STATUS_WORD = Object.freeze({ armed: "Armed", paused: "Paused", retired: "Retired" });
  var CADENCE_WORD = Object.freeze({ live: "Live", nightly: "Nightly" });

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") n.textContent = String(v);
      else if (k === "hidden") n.hidden = true;
      else n.setAttribute(k, v === true ? "" : String(v));
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }

  function figureText(f, fallback) {
    if (isObj(f) && typeof f.text === "string" && f.text && f.text !== DASH && !f.reason) return { text: f.text, absent: null };
    var why = isObj(f) && f.reasonText ? String(f.reasonText).replace(/^\s*—?\s*/, "") : fallback;
    return { text: DASH + " " + why, absent: isObj(f) && f.reason ? f.reason : "missing" };
  }

  function errText(err) {
    var d = err && isObj(err.details) ? err.details : {};
    var c = err && err.code;
    if (c === "ff_wire_limit") {
      var which = { armed: "the most armed wires allowed", universe: "the most universe-wide wires allowed", live: "the most live wires allowed", capacity: "no room for another wire" }[d.limit];
      return DASH + " you have " + (which || "reached a wire limit") + ". Pause or retire a wire first.";
    }
    if (c === "ff_budget_exceeded") return DASH + " the weekly false-alarm budget is spent" + (typeof d.used === "number" && typeof d.max === "number" ? " (" + d.used + " of " + d.max + ")" : "") + ". Loosen or retire a wire.";
    if (c === "ff_off") return DASH + " Wires are unavailable" + (d.reason ? ": " + String(d.reason).replace(/_/g, " ") : "");
    if (c === "ff_wire_not_found") return DASH + " that wire is not yours or no longer exists.";
    if (c === "ff_house_readonly") return DASH + " a house wire cannot be edited.";
    if (c === "ff_version_immutable") return DASH + " this wire changed since you opened it. Reload it and adjust again.";
    if (c === "network") return DASH + " Flows did not answer. Nothing changed. Try again.";
    if (c === "timeout") return DASH + " Flows took too long to answer. Nothing is known to have changed. Try again.";
    if (c === "rate_limited") return DASH + " too many changes just now. Try again in " + (err.retryAfterS ? err.retryAfterS + " s" : "a minute") + ".";
    if (c === "client_missing") return DASH + " the Wires client did not load. Reload the page.";
    return DASH + " " + String((err && err.message) || "the request failed");
  }

  function limitBlock(limits, wire) {
    if (!isObj(limits) || !wire) return null;
    if (wire.status === "armed") return null;
    var a = limits.armed, l = limits.live, u = limits.universe;
    if (isObj(a) && a.used >= a.max) return DASH + " " + a.used + " of " + a.max + " wires are armed. Pause or retire one before arming this.";
    if (wire.cadence === "live" && isObj(l) && l.used >= l.max) return DASH + " " + l.used + " of " + l.max + " live wires are armed. Pause or retire a live wire before arming this.";
    if (wire.scope && wire.scope.kind === "universe" && isObj(u) && u.used >= u.max) return DASH + " " + u.used + " of " + u.max + " universe-wide wires are armed. Pause or retire one before arming this.";
    return null;
  }

  function capText(limits) {
    if (!isObj(limits) || !isObj(limits.armed) || !isObj(limits.live)) return null;
    var b = limits.budget;
    return limits.armed.used + " of " + limits.armed.max + " wires armed · " + limits.live.used + " of " + limits.live.max + " live" +
      (isObj(limits.universe) ? " · " + limits.universe.used + " of " + limits.universe.max + " universe-wide" : "") +
      (isObj(b) ? " · false alarms " + b.used + " of " + b.max + " a week" : "");
  }

  function init() {
    var root = document.getElementById("ffxWires");
    if (!root) return;
    var K = UI.ffKernel;
    var net = UI.ffClient;
    var $ = function (id) { return document.getElementById(id); };
    var cap = $("ffxWrCap"), list = $("ffxWrList"), state = $("ffxWrState"), count = $("ffxWrCount"), more = $("ffxWrMore");
    var allBtn = $("ffxWrAll"), retry = $("ffxWrRetry"), detail = $("ffxWrDetail"), ver = $("ffxWrVer"), live = $("ffxWrLive"), banner = $("ffxWrBanner");
    var allDlg = $("ffxWrAllDlg"), allList = $("ffxWrAllList"), histDlg = $("ffxWrHistDlg"), histList = $("ffxWrHistList"), info = $("ffxWrInfo");
    var tabs = [].slice.call(document.querySelectorAll("#ffxWrTabs [role=tab]"));
    var filters = [].slice.call(document.querySelectorAll("#ffxWrFilters [role=tab]"));
    var filter = "live";
    var rows = [];
    var limits = null;
    var selected = null;
    var current = null;
    var ticket = 0;
    var dticket = 0;
    var busy = false;

    function say(text) { live.textContent = ""; setTimeout(function () { live.textContent = text; }, 30); }
    function absent(n, reason, text) { if (K) K.hooks.absent(n, reason, text); else { n.textContent = DASH + " " + text; n.setAttribute("data-ff-absent", reason); } }
    function present(n, text) { if (K) K.hooks.present(n, text); else { n.textContent = text; n.removeAttribute("data-ff-absent"); } }

    if (!net) {
      absent(cap, "client_missing", "the Wires client did not load. Reload the page.");
      absent(state, "client_missing", "the Wires client did not load. Reload the page.");
      return;
    }

    function view(v) {
      root.setAttribute("data-view", v);
      tabs.forEach(function (t) {
        var on = t.getAttribute("data-v") === v;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      fitAll();
    }

    function keyNav(items, pick) {
      items.forEach(function (t, i) {
        t.addEventListener("keydown", function (e) {
          var j = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
          if (j < 0) return;
          e.preventDefault();
          pick(items[j]);
          items[j].focus();
        });
      });
    }

    tabs.forEach(function (t) { t.addEventListener("click", function () { view(t.getAttribute("data-v")); }); });
    keyNav(tabs, function (t) { view(t.getAttribute("data-v")); });
    filters.forEach(function (t) { t.addEventListener("click", function () { setFilter(t.getAttribute("data-f")); }); });
    keyNav(filters, function (t) { setFilter(t.getAttribute("data-f")); });

    [allDlg, histDlg, info].forEach(function (d) {
      d.addEventListener("click", function (e) {
        if (e.target === d || (e.target.closest && e.target.closest("[data-close]"))) d.close();
      });
    });
    $("ffxWrInfoBtn").addEventListener("click", function () { info.showModal(); });
    allBtn.addEventListener("click", function () {
      allList.textContent = "";
      rows.forEach(function (w) { allList.appendChild(rowFor(w, true)); });
      allDlg.showModal();
    });
    retry.addEventListener("click", function () { load(filter); });

    function rowFor(w, inDialog) {
      var house = w.layer === "house";
      var status = house ? (w.following ? "following" : "off") : w.status;
      var word = house ? (w.following ? "Following" : "Off") : STATUS_WORD[w.status] || w.status;
      var b = el("button", { type: "button", class: "ffx-wr-row", "data-ff-wire": w.id, "data-status": status, "aria-current": selected === w.id ? "true" : null }, [
        el("span", { class: "ffx-wr-rt", text: w.title || w.sentence || w.id }),
        el("span", { class: "ffx-wr-rm" }, [
          el("span", { class: "ffx-chip ffx-wr-st", "data-status": status, text: word }),
          el("span", { class: "ffx-chip", "data-cadence": w.cadence, text: CADENCE_WORD[w.cadence] || w.cadence }),
          el("span", { class: "ffx-wr-rs", text: w.scopeText || "" }),
        ]),
      ]);
      b.addEventListener("click", function () {
        if (inDialog) allDlg.close();
        select(w.id);
        if (root.getAttribute("data-view") === "list" && window.matchMedia("(max-width: 1099.98px)").matches) view("wire");
      });
      return el("li", { class: "ffx-wr-li" }, [b]);
    }

    function fitList() {
      var lis = [].slice.call(list.children);
      if (!lis.length) { more.textContent = ""; allBtn.hidden = true; return; }
      var r = K ? K.fit.rows(list, { keep: 1 }) : { cut: 0, total: lis.length };
      more.textContent = r.cut ? "+" + r.cut + " more" : "";
      allBtn.hidden = r.cut === 0;
      allBtn.textContent = r.cut ? "Show all " + r.total : "Show all";
      lis.forEach(function (li) { var t = li.querySelector(".ffx-wr-rt"); if (t && K) K.fit.clip(t); var s = li.querySelector(".ffx-wr-rs"); if (s && K) K.fit.clip(s); });
    }

    function fitVers() {
      var vl = detail.querySelector(".ffx-wr-vers");
      var vb = detail.querySelector(".ffx-wr-vall");
      if (!vl || !vb) return;
      var r = K ? K.fit.rows(vl, { keep: 1 }) : { cut: 0, total: vl.children.length };
      vb.hidden = r.cut === 0;
      vb.textContent = r.cut ? "Show all " + r.total + " versions" : "";
      [].slice.call(vl.querySelectorAll(".ffx-wr-vs")).forEach(function (n) { if (K) K.fit.clip(n); });
    }

    function fitAll() {
      fitList();
      fitVers();
      [].slice.call(detail.querySelectorAll(".ffx-wr-clip, .ffx-wr-facts dd, .ffx-wr-vh, .ffx-wr-vs")).forEach(function (n) { if (K) K.fit.clip(n); });
      if (K) K.fit.clip(cap);
    }

    function paintList() {
      list.textContent = "";
      rows.forEach(function (w) { list.appendChild(rowFor(w, false)); });
      count.textContent = rows.length ? String(rows.length) : "";
      if (!rows.length) {
        state.hidden = false;
        absent(state, "none", filter === "retired" ? "no retired wire" : filter === "house" ? "no house wire is published" : "no wire yet. Arm one on Fire.");
      } else state.hidden = true;
      fitList();
    }

    function setLimits(l) {
      if (!isObj(l)) return;
      limits = l;
      var line = capText(l);
      if (line) present(cap, line); else absent(cap, "missing", "limits not returned");
      if (K) K.fit.clip(cap);
    }

    function setFilter(f) {
      if (f === filter && rows.length) return;
      filter = f;
      root.setAttribute("data-filter", f);
      filters.forEach(function (t) {
        var on = t.getAttribute("data-f") === f;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      load(f);
    }

    function load(f) {
      var mine = ++ticket;
      retry.hidden = true;
      rows = [];
      list.textContent = "";
      state.hidden = false;
      absent(state, "reading", f === "house" ? "reading the house wires" : "reading your wires");
      more.textContent = "";
      allBtn.hidden = true;
      var path = f === "house" ? "/api/ff/house" : "/api/ff/wires?status=" + (f === "retired" ? "retired" : "live");
      return net.get(path).then(function (r) {
        if (mine !== ticket) return;
        rows = r && Array.isArray(r.wires) ? r.wires.slice() : [];
        if (f !== "house" && r && r.limits) setLimits(r.limits);
        paintList();
        var wanted = selected || (new URLSearchParams(location.search).get("wire") || "");
        if (wanted && rows.some(function (w) { return w.id === wanted; })) select(wanted, true);
        else if (!selected && rows.length && !window.matchMedia("(max-width: 1099.98px)").matches) select(rows[0].id, true);
      }, function (err) {
        if (mine !== ticket) return;
        absent(state, err.code || "error", errText(err).replace(/^—\s*/, ""));
        retry.hidden = false;
        if (err.code === "ff_off") {
          banner.hidden = false;
          banner.textContent = errText(err);
          absent(cap, "ff_off", errText(err).replace(/^—\s*/, ""));
        }
      });
    }

    function fact(dt, text, absentReason, clip) {
      var dd = el("dd", { class: clip ? "ffx-wr-clip" : null, text: text, "data-ff-absent": absentReason || null });
      return [el("dt", { text: dt }), dd];
    }

    function versionRow(v, isCurrent) {
      var made = figureText(v.createdAt, "no time stored");
      return el("li", { class: "ffx-wr-v", "data-version": String(v.version), "aria-current": isCurrent ? "true" : null }, [
        el("span", { class: "ffx-wr-vh", text: "v" + v.version + (isCurrent ? " · current" : "") + " · from the " + v.effectiveSession + " session · saved " + made.text }),
        el("span", { class: "ffx-wr-vs", text: v.sentence || DASH + " no sentence stored" }),
      ]);
    }

    function action(label, k, primary) {
      return el("button", { type: "button", class: "ffx-btn" + (primary ? " ffx-primary" : ""), "data-k": k, text: label });
    }

    function paintDetail(found) {
      var w = found.wire;
      var house = w.layer === "house";
      current = found;
      detail.textContent = "";
      ver.textContent = house ? "" : "v" + w.version;
      var exp = figureText(w.expWeek, "not measured");
      var dl = el("dl", { class: "ffx-facts ffx-wr-facts" });
      var facts = [
        fact("Checked", w.cadenceText || DASH),
        fact("Scope", w.scopeText || DASH, null, true),
        fact("False alarms a week", exp.text, exp.absent),
      ];
      if (!house) facts.push(fact("Version", "v" + w.version + " · " + (w.effectiveText || "")));
      if (house) {
        var ra = figureText(w.rarity, "no record");
        facts.push(fact("Fires", ra.absent ? ra.text : ra.text, ra.absent));
      }
      if (w.origin) facts.push(fact("Copied from", w.origin));
      facts.forEach(function (p) { dl.appendChild(p[0]); dl.appendChild(p[1]); });
      var status = house ? (w.following ? "following" : "off") : w.status;
      var head = el("div", { class: "ffx-wr-dh" }, [
        el("h3", { class: "ffx-wr-dt ffx-wr-clip", text: w.title || w.id }),
        el("span", { class: "ffx-chip ffx-wr-st", "data-status": status, text: house ? (w.following ? "Following" : "Off") : STATUS_WORD[w.status] || w.status }),
        el("span", { class: "ffx-chip", "data-cadence": w.cadence, text: CADENCE_WORD[w.cadence] || w.cadence }),
      ]);
      var sentence = el("p", { class: "ffx-sentence ffx-wr-sentence", text: w.sentence || DASH + " no sentence stored" });
      var acts = el("div", { class: "ffx-acts ffx-wr-acts" });
      var out = el("p", { class: "ffx-why ffx-wr-out", role: "status" });
      if (house) {
        acts.appendChild(action(w.following ? "Turn off" : "Turn on", "follow", !w.following));
      } else if (w.status === "retired") {
        acts.appendChild(action("Restore and arm", "restore", true));
      } else {
        acts.appendChild(action(w.status === "armed" ? "Pause" : "Arm", w.status === "armed" ? "pause" : "arm", w.status !== "armed"));
        acts.appendChild(action("Adjust", "adjust", false));
        acts.appendChild(action("Retire", "retire", false));
      }
      var blocked = house ? null : limitBlock(limits, w);
      if (blocked) {
        [].slice.call(acts.querySelectorAll('[data-k="arm"], [data-k="restore"]')).forEach(function (b) { b.setAttribute("aria-disabled", "true"); });
        out.textContent = blocked;
        out.setAttribute("data-ff-absent", "limit");
      }
      acts.appendChild(out);
      acts.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("button[data-k]") : null;
        if (!b || busy) return;
        if (b.getAttribute("aria-disabled") === "true") { say(out.textContent); return; }
        act(b.getAttribute("data-k"), w, out);
      });
      var kids = [head, sentence, dl, acts];
      if (!house) {
        var versions = Array.isArray(found.versions) ? found.versions.slice().sort(function (a, b) { return b.version - a.version; }) : [];
        var vl = el("ol", { class: "ffx-wr-vers", "aria-label": "Versions, newest first" });
        versions.forEach(function (v) { vl.appendChild(versionRow(v, v.version === w.version)); });
        var vall = el("button", { type: "button", class: "ffx-link ffx-wr-vall", "aria-haspopup": "dialog", hidden: true });
        vall.addEventListener("click", function () {
          histList.textContent = "";
          versions.forEach(function (v) { histList.appendChild(versionRow(v, v.version === w.version)); });
          histDlg.showModal();
        });
        kids.push(el("div", { class: "ffx-wr-vbox" }, [
          el("div", { class: "ffx-sub" }, [el("span", { text: "Versions" }), el("span", { class: "ffx-ph-n", text: versions.length ? String(versions.length) : "" })]),
          versions.length ? vl : el("p", { class: "ffx-wait", "data-ff-absent": "missing", text: DASH + " no version returned" }),
          vall,
        ]));
      }
      kids.forEach(function (k) { detail.appendChild(k); });
      fitAll();
    }

    function select(id, quiet) {
      if (!WIRE_RE.test(id) && !HOUSE_RE.test(id)) return;
      selected = id;
      [].slice.call(list.querySelectorAll(".ffx-wr-row")).forEach(function (b) {
        if (b.getAttribute("data-ff-wire") === id) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      });
      try {
        var u = new URL(location.href);
        if (u.searchParams.get("wire") !== id) { u.searchParams.set("wire", id); history.replaceState(history.state, "", u.pathname + u.search + u.hash); }
      } catch (e) { void e; }
      var mine = ++dticket;
      detail.setAttribute("aria-busy", "true");
      var path = HOUSE_RE.test(id) ? "/api/ff/house?id=" + encodeURIComponent(id) : "/api/ff/wires?id=" + encodeURIComponent(id);
      return net.get(path).then(function (r) {
        detail.removeAttribute("aria-busy");
        if (mine !== dticket) return;
        if (!r || !r.wire) { detail.textContent = ""; detail.appendChild(el("p", { class: "ffx-wait", "data-ff-absent": "missing", text: DASH + " the wire was not returned" })); return; }
        paintDetail({ wire: r.wire, versions: r.versions || null, note: r.note || null });
        if (!quiet) say((r.wire.title || id) + " selected");
      }, function (err) {
        detail.removeAttribute("aria-busy");
        if (mine !== dticket) return;
        detail.textContent = "";
        var p = el("p", { class: "ffx-wait", "data-ff-absent": err.code || "error", text: errText(err) });
        var again = el("button", { type: "button", class: "ffx-link", text: "Retry" });
        again.addEventListener("click", function () { select(id); });
        detail.appendChild(p);
        detail.appendChild(again);
      });
    }

    function afterChange(r, out, said) {
      if (r && r.limits) setLimits(r.limits);
      out.removeAttribute("data-ff-absent");
      say(said);
      var id = r && r.wire ? r.wire.id : selected;
      var stay = filter;
      return load(stay).then(function () {
        if (id && !rows.some(function (w) { return w.id === id; })) {
          selected = id;
          return select(id, true);
        }
        return select(id, true);
      });
    }

    function act(k, w, out) {
      if (k === "adjust") return adjust(w, out);
      busy = true;
      out.removeAttribute("data-ff-absent");
      out.textContent = "Saving.";
      var req;
      if (k === "follow") req = net.post("/api/ff/house", { id: w.id, follow: !w.following });
      else req = net.patch("/api/ff/wires", { id: w.id, status: k === "pause" ? "paused" : k === "retire" ? "retired" : "armed" });
      var word = { follow: w.following ? "Turned off" : "Turned on", pause: "Paused", retire: "Retired", arm: "Armed", restore: "Restored and armed" }[k];
      return req.then(function (r) {
        busy = false;
        out.textContent = word + ".";
        return afterChange(r, out, word + ": " + (w.title || w.id));
      }, function (err) {
        busy = false;
        out.textContent = errText(err);
        out.setAttribute("data-ff-absent", err.code || "error");
        say(out.textContent);
      });
    }

    function adjust(w, out) {
      var found = current && current.wire && current.wire.id === w.id ? current : null;
      if (!found || !isObj(found.wire.ast)) { out.textContent = DASH + " the wire's definition was not returned. Reload it."; out.setAttribute("data-ff-absent", "missing"); return null; }
      out.removeAttribute("data-ff-absent");
      out.textContent = "Opening the editor.";
      var ready = UI.ffFire && UI.ffFire.openFireSheet ? Promise.resolve() : typeof UI.defer === "function" ? UI.defer("ff-sheet") : Promise.reject(new Error("no loader"));
      var gone = setTimeout(function () { if (!(window.FlowsUI.ffFire && window.FlowsUI.ffFire.openFireSheet)) { out.textContent = DASH + " the editor did not load. Reload the page and try again."; out.setAttribute("data-ff-absent", "sheet_missing"); } }, 15000);
      return ready.then(function () {
        clearTimeout(gone);
        var F = window.FlowsUI.ffFire;
        if (!F || typeof F.openFireSheet !== "function") throw new Error("no sheet");
        var sheet = F.openFireSheet({
          wire: { id: w.id, version: w.version, title: w.title, ast: found.wire.ast, template: w.template || "custom" },
          onDone: function (r) { afterChange(r && r.wire ? r : { wire: { id: w.id } }, out, "Saved a new version of " + (w.title || w.id)); },
        });
        if (!sheet) throw new Error("no registry");
        out.textContent = "";
      }).catch(function () {
        clearTimeout(gone);
        out.textContent = DASH + " the editor did not load. Reload the page and try again.";
        out.setAttribute("data-ff-absent", "sheet_missing");
      });
    }

    if (K) K.fit.watch(root, fitAll);
    else window.addEventListener("resize", fitAll);
    if (typeof UI.defer === "function" && !(UI.ffFire && UI.ffFire.openFireSheet)) UI.defer("ff-sheet");
    var asked = new URLSearchParams(location.search).get("wire") || "";
    if (HOUSE_RE.test(asked)) setFilter("house");
    else load("live").then(function () {
      if (WIRE_RE.test(asked) && !rows.some(function (w) { return w.id === asked; })) {
        selected = null;
        filter = "retired";
        root.setAttribute("data-filter", "retired");
        filters.forEach(function (t) { var on = t.getAttribute("data-f") === "retired"; t.setAttribute("aria-selected", on ? "true" : "false"); t.tabIndex = on ? 0 : -1; });
        return load("retired").then(function () { if (!rows.some(function (w) { return w.id === asked; })) select(asked); });
      }
      return null;
    });
    if (WIRE_RE.test(asked) && window.matchMedia("(max-width: 1099.98px)").matches) view("wire");
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffWires: Object.freeze({ errText: errText, limitBlock: limitBlock, capText: capText }) }));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
