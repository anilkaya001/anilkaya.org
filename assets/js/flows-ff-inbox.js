(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || (UI.ffInbox && UI.ffInbox.page)) return;
  var root = document.getElementById("ffxInbox");
  if (!root) return;

  var DASH = "—";
  var PAGE_LIMIT = 30;
  var RECEIPTS = 5;
  var GROUP_AFTER = Number(root.getAttribute("data-group-after")) || 3;
  var HIT_RE = /^[a-z2-7]{20}$/;
  var kernel = UI.ffKernel || null;
  var hooks = kernel ? kernel.hooks : null;
  var fit = kernel ? kernel.fit : null;
  var evidence = UI.ffInbox && UI.ffInbox.evidence ? UI.ffInbox.evidence : null;

  var $ = function (id) { return document.getElementById(id); };
  var cap = $("ffxIbCap");
  var readBtn = $("ffxIbRead");
  var banner = $("ffxIbBanner");
  var healthBox = $("ffxIbHealth");
  var healthLine = $("ffxIbHealthLine");
  var healthNightly = $("ffxIbHealthNightly");
  var healthLive = $("ffxIbHealthLive");
  var list = $("ffxIbList");
  var stateLine = $("ffxIbState");
  var count = $("ffxIbCount");
  var moreLine = $("ffxIbMore");
  var allBtn = $("ffxIbAll");
  var retryBtn = $("ffxIbRetry");
  var hitHost = $("ffxIbHit");
  var hitN = $("ffxIbHitN");
  var allDlg = $("ffxIbAllDlg");
  var allList = $("ffxIbAllList");
  var loadBtn = $("ffxIbLoad");
  var live = $("ffxIbLive");

  var S = {
    filter: "all", hits: [], next: null, more: false, heads: null, shadow: root.getAttribute("data-mode") === "shadow",
    phase: "loading", error: null, selected: null, expanded: {}, ticket: 0, detailTicket: 0, unread: null, health: null,
  };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function say(text) { if (live.textContent !== text) live.textContent = text; }

  function missing() {
    var err = new Error("The Fire client did not load");
    err.code = "client_missing";
    return Promise.reject(err);
  }

  var net = {
    get: function (p) { return UI.ffClient && UI.ffClient.get ? UI.ffClient.get(p) : missing(); },
    post: function (p, b) { return UI.ffClient && UI.ffClient.post ? UI.ffClient.post(p, b) : missing(); },
  };

  function errText(err) {
    var c = err && err.code;
    var d = err && err.details ? err.details : {};
    if (c === "ff_off") return DASH + " unavailable: Fire & Forget is off" + (d.reason ? " (" + String(d.reason).replace(/_/g, " ") + ")" : "");
    if (c === "client_missing") return DASH + " unavailable: the Fire client did not load. Reload the page.";
    if (c === "network") return DASH + " unavailable: Flows did not answer.";
    if (c === "timeout") return DASH + " unavailable: Flows did not answer in time.";
    if (c === "rate_limited") return DASH + " unavailable: too many reads just now. Try again in a minute.";
    if (c === "ff_hit_not_found") return DASH + " unavailable: no such hit on your account.";
    return DASH + " unavailable: " + String((err && err.message) || "the request failed");
  }

  function sd(t) { return String(t).replace(/\s*\u03c3/g, " SD"); }

  function txt(v) {
    if (typeof v === "string" && v) return { text: sd(v), absent: null };
    if (v && typeof v === "object" && typeof v.text === "string" && v.text && v.text !== DASH && !v.reason) return { text: sd(v.text), absent: null };
    var why = v && typeof v === "object" ? v.reason || "missing" : "missing";
    var said = v && typeof v === "object" && v.reasonText ? v.reasonText : String(why).replace(/_/g, " ");
    return { text: DASH + " " + said, absent: why };
  }

  function put(n, v) {
    var t = txt(v);
    if (n.textContent !== t.text) n.textContent = t.text;
    n.setAttribute("title", t.text);
    if (t.absent) n.setAttribute("data-ff-absent", t.absent);
    else n.removeAttribute("data-ff-absent");
    return n;
  }

  function who(h) {
    if (typeof h.symbol === "string" && h.symbol) return h.symbol;
    if (typeof h.sector === "string" && h.sector) return h.sector;
    return DASH;
  }

  function capText() {
    if (S.shadow) return { text: "Shadow · hits are held", absent: null };
    if (!S.unread) return { text: DASH + " reading your hits", absent: "reading" };
    var u = S.unread;
    if (!u.total) return { text: "Nothing unread", absent: null };
    return { text: u.label + " unread · " + u.member + " yours · " + u.house + " house", absent: null };
  }

  function paintCap() {
    var c = capText();
    if (cap.textContent !== c.text) cap.textContent = c.text;
    if (c.absent) cap.setAttribute("data-ff-absent", c.absent);
    else cap.removeAttribute("data-ff-absent");
    cap.setAttribute("title", c.text);
    readBtn.disabled = S.shadow || !S.heads || S.heads.m + S.heads.h === 0 || (S.unread !== null && S.unread.total === 0 && !S.hits.some(function (h) { return h.unread; }));
  }

  function chip(kind) {
    return el("span", { class: "ffx-ib-chip", "data-kind": kind, text: kind === "house" ? "House" : "Yours" });
  }

  function rowFor(h) {
    var sent = txt(h.sentence);
    var at = h.at && typeof h.at.text === "string" ? h.at.text : DASH;
    var btn = el("button", {
      type: "button", class: "ffx-ib-row", "data-ff-hit": h.id, "data-unread": h.unread ? "1" : null,
      "data-withdrawn": h.withdrawn ? "1" : null, "aria-current": S.selected === h.id ? "true" : null,
      "aria-label": who(h) + ". " + sent.text + (h.unread ? ". Unread" : ""),
    }, [
      el("span", { class: "ffx-ib-sym", title: who(h), text: who(h) }),
      el("span", { class: "ffx-ib-sent", title: sent.text, text: sent.text, "data-ff-absent": sent.absent }),
      el("span", { class: "ffx-ib-meta" }, [
        chip(h.kind),
        h.withdrawn ? el("span", { class: "ffx-ib-chip", "data-kind": "withdrawn", text: "Withdrawn" }) : null,
        h.mark === "pinned" ? el("span", { class: "ffx-ib-chip", "data-kind": "pinned", text: "Pinned" }) : null,
        el("span", { class: "ffx-ib-wt", title: h.wire && h.wire.title ? h.wire.title : DASH, text: h.wire && h.wire.title ? h.wire.title : DASH }),
        el("span", { class: "ffx-ib-at", text: at }),
      ]),
    ]);
    return el("li", { class: "ffx-ib-li" }, [btn]);
  }

  function groupFor(key, members) {
    var first = members[0];
    var names = members.map(who);
    var shown = names.slice(0, 4).join(", ") + (names.length > 4 ? " +" + (names.length - 4) : "");
    var title = first.wire && first.wire.title ? first.wire.title : DASH;
    var btn = el("button", {
      type: "button", class: "ffx-ib-row ffx-ib-group", "data-group": key, "aria-expanded": "false",
      "data-unread": members.some(function (h) { return h.unread; }) ? "1" : null,
      "aria-label": title + ": " + members.length + " hits in the " + first.session + " session. Show them.",
    }, [
      el("span", { class: "ffx-ib-sym", text: String(members.length) }),
      el("span", { class: "ffx-ib-sent", title: title + " · " + members.length + " hits this session", text: title + " · " + members.length + " hits this session" }),
      el("span", { class: "ffx-ib-meta" }, [
        chip(first.kind),
        el("span", { class: "ffx-ib-wt", title: names.join(", "), text: shown }),
        el("span", { class: "ffx-ib-at", text: first.session }),
      ]),
    ]);
    return el("li", { class: "ffx-ib-li" }, [btn]);
  }

  function items() {
    var groups = {};
    S.hits.forEach(function (h) {
      var k = (h.wire ? h.wire.id : "") + "|" + h.session;
      (groups[k] = groups[k] || []).push(h);
    });
    var out = [];
    var done = {};
    S.hits.forEach(function (h) {
      var k = (h.wire ? h.wire.id : "") + "|" + h.session;
      if (groups[k].length > GROUP_AFTER && !S.expanded[k]) {
        if (!done[k]) { done[k] = true; out.push({ group: k, members: groups[k] }); }
      } else out.push({ hit: h });
    });
    return out;
  }

  function fill(host) {
    clear(host);
    items().forEach(function (it) { host.appendChild(it.group ? groupFor(it.group, it.members) : rowFor(it.hit)); });
  }

  function emptyText() {
    if (S.filter === "unread") return "Nothing unread.";
    if (S.filter === "pinned") return "No pinned hits.";
    if (S.filter === "archived") return "No dismissed hits.";
    return "No hits yet. A hit is written once, when every condition of a wire first holds.";
  }

  function setState(text, kind, why) {
    stateLine.hidden = false;
    stateLine.textContent = text;
    stateLine.setAttribute("data-state", kind);
    if (why) stateLine.setAttribute("data-ff-absent", why);
    else stateLine.removeAttribute("data-ff-absent");
  }

  function layout() {
    if (!fit) return;
    var r = fit.rows(list, { keep: 1 });
    var hidden = r.cut;
    var parts = [];
    if (hidden) parts.push(hidden + " more below");
    if (S.more) parts.push("more on the server");
    moreLine.textContent = parts.length ? "+" + parts.join(", ") : "";
    allBtn.hidden = !(hidden > 0 || S.more);
  }

  function paintList() {
    retryBtn.hidden = S.phase !== "failed";
    if (S.phase === "loading") {
      clear(list);
      setState(DASH + " reading your hits", "loading", "reading");
      count.textContent = "";
      moreLine.textContent = "";
      allBtn.hidden = true;
    } else if (S.phase === "shadow") {
      clear(list);
      setState(DASH + " held: running in shadow. Hits are evaluated and stored as held; none is delivered yet.", "shadow", "held");
      count.textContent = "";
      moreLine.textContent = "";
      allBtn.hidden = true;
    } else if (S.phase === "failed") {
      clear(list);
      setState(errText(S.error), "failed", S.error && S.error.code === "ff_off" ? "off" : "unavailable");
      count.textContent = "";
      moreLine.textContent = "";
      allBtn.hidden = true;
    } else if (!S.hits.length) {
      clear(list);
      setState(emptyText(), "empty", null);
      count.textContent = "0 hits";
      moreLine.textContent = "";
      allBtn.hidden = true;
    } else {
      stateLine.hidden = true;
      stateLine.removeAttribute("data-ff-absent");
      fill(list);
      count.textContent = S.hits.length + (S.more ? "+" : "") + " hits";
      layout();
    }
    paintCap();
    if (allDlg.open) paintAll();
  }

  function paintAll() {
    fill(allList);
    loadBtn.hidden = !S.more;
  }

  function load(append) {
    var mine = ++S.ticket;
    if (!append) {
      S.phase = "loading";
      S.hits = [];
      S.next = null;
      S.more = false;
      paintList();
    }
    var q = "/api/ff/hits?state=" + encodeURIComponent(S.filter) + "&limit=" + PAGE_LIMIT + (append && S.next ? "&cursor=" + encodeURIComponent(S.next) : "");
    return net.get(q).then(function (body) {
      if (mine !== S.ticket) return;
      if (body && body.shadow === true) {
        S.shadow = true;
        S.phase = "shadow";
        banner.hidden = false;
        banner.setAttribute("data-ff-mode", "shadow");
        if (!banner.textContent) banner.textContent = "Running in shadow: hits are evaluated and held, none is delivered yet.";
        paintList();
        say("Running in shadow. Hits are held.");
        return;
      }
      var got = body && Array.isArray(body.hits) ? body.hits : [];
      S.hits = append ? S.hits.concat(got) : got;
      S.next = body && typeof body.next === "string" ? body.next : null;
      S.more = !!(body && body.more && S.next);
      if (body && body.heads && typeof body.heads.m === "number" && typeof body.heads.h === "number") S.heads = { m: body.heads.m, h: body.heads.h };
      S.phase = "ok";
      paintList();
      say(S.hits.length ? S.hits.length + " hits shown." : emptyText());
      if (!append && S.selected === null && S.hits.length && !narrow()) select(S.hits[0].id, false);
    }, function (err) {
      if (mine !== S.ticket) return;
      S.error = err;
      if (append) {
        moreLine.textContent = errText(err);
        loadBtn.hidden = false;
        return;
      }
      S.phase = "failed";
      paintList();
      say(errText(err));
    });
  }

  function narrow() { return window.matchMedia && window.matchMedia("(max-width: 1099.98px)").matches; }

  function fact(dl, label, v) {
    dl.appendChild(el("dt", { text: label }));
    dl.appendChild(put(el("dd"), v));
  }

  function toggle(label, pressed, onClick) {
    var b = el("button", { type: "button", class: "ffx-ib-act", "aria-pressed": pressed ? "true" : "false", text: label });
    b.addEventListener("click", onClick);
    return b;
  }

  function hitById(id) {
    for (var i = 0; i < S.hits.length; i++) if (S.hits[i].id === id) return S.hits[i];
    return null;
  }

  function mark(h, change) {
    var body = { id: h.id };
    Object.keys(change).forEach(function (k) { body[k] = change[k]; });
    return net.post("/api/ff/hits", body).then(function (got) {
      h.mark = got && got.mark !== undefined ? got.mark : h.mark;
      h.feedback = got && got.feedback !== undefined ? got.feedback : h.feedback;
      var row = hitById(h.id);
      if (row && row !== h) { row.mark = h.mark; row.feedback = h.feedback; }
      paintList();
      paintDetail(h);
      say(change.mark === "pinned" ? "Pinned." : change.mark === "dismissed" ? "Dismissed." : change.feedback === "useful" ? "Marked useful." : change.feedback === "noise" ? "Marked as noise." : "Cleared.");
    }, function (err) { say(errText(err)); actionsNote(errText(err)); });
  }

  function actionsNote(text) {
    var n = $("ffxIbActNote");
    if (n) n.textContent = text;
  }

  function receiptsInto(host, h) {
    clear(host);
    if (!h.wire || !h.wire.id) { host.appendChild(el("li", { class: "ffx-ib-rc", "data-ff-absent": "missing", text: DASH + " no wire on this hit" })); return; }
    host.appendChild(el("li", { class: "ffx-ib-rc", "data-ff-absent": "reading", text: DASH + " reading the receipts" }));
    net.get("/api/ff/receipts?wire=" + encodeURIComponent(h.wire.id) + "&limit=" + RECEIPTS).then(function (body) {
      if (S.selected !== h.id) return;
      clear(host);
      var rows = body && Array.isArray(body.receipts) ? body.receipts.slice(0, RECEIPTS) : [];
      if (!rows.length) { host.appendChild(el("li", { class: "ffx-ib-rc", "data-ff-absent": "no_record", text: DASH + " no receipt yet" })); return; }
      rows.forEach(function (r) {
        var counts = r.status === "evaluated" ? (typeof r.hits === "number" ? r.hits + " hit" + (r.hits === 1 ? "" : "s") : "") + (r.hitsCapped ? ", " + r.hitsCapped + " more over the cap" : "") : "";
        host.appendChild(el("li", { class: "ffx-ib-rc", "data-status": r.status, "data-ff-absent": r.status === "evaluated" ? null : r.reason || "missing" }, [
          el("span", { class: "ffx-ib-rs", text: String(r.session || DASH) + (r.version ? " · v" + r.version : "") }),
          el("span", { class: "ffx-ib-rl", title: r.line || DASH, text: (r.line || DASH) + (counts ? " · " + counts : "") + (r.late ? " · late" : "") }),
        ]));
      });
      fitDetail();
    }, function (err) {
      if (S.selected !== h.id) return;
      clear(host);
      host.appendChild(el("li", { class: "ffx-ib-rc", "data-ff-absent": "unavailable", text: errText(err).replace(DASH + " unavailable", DASH + " receipts unavailable") }));
    });
  }

  function paintDetail(h) {
    clear(hitHost);
    hitN.textContent = h.unread ? "Unread" : "";
    var head = el("div", { class: "ffx-ib-hh" }, [
      el("span", { class: "ffx-ib-hsym", text: who(h) }),
      chip(h.kind),
      h.withdrawn ? el("span", { class: "ffx-ib-chip", "data-kind": "withdrawn", text: "Withdrawn" }) : null,
    ]);
    hitHost.appendChild(head);
    hitHost.appendChild(put(el("p", { class: "ffx-ib-big", "data-ff-hit": h.id }), h.sentence));
    var dl = el("dl", { class: "ffx-ib-facts" });
    fact(dl, "When", h.at && h.at.text ? h.at.text : { reason: "no_time", reasonText: "no time stored" });
    fact(dl, "Written", h.firedAt);
    fact(dl, "Latency", h.latency);
    var w = h.wire || {};
    var wireLine = (w.title || DASH) + " · version " + (w.version || DASH);
    if (w.isCurrent === false && w.currentVersion) wireLine += " · the wire is at version " + w.currentVersion + " now";
    fact(dl, "Wire", wireLine);
    if (h.withdrawn) fact(dl, "Withdrawn", (h.withdrawn.at && h.withdrawn.at.text ? h.withdrawn.at.text + " · " : "") + (h.withdrawn.reason || DASH));
    hitHost.appendChild(dl);
    var ev = el("div", { class: "ffx-ib-evh", "data-ff-wire": w.id || null });
    hitHost.appendChild(ev);
    if (h.evidence === undefined) ev.appendChild(el("p", { class: "ffx-ib-wait", "data-ff-absent": "reading", text: DASH + " reading the evidence" }));
    else if (evidence) evidence.render(ev, h.evidence);
    else ev.appendChild(el("p", { class: "ffx-ib-wait", "data-ff-absent": "not_measured", text: DASH + " the evidence reader did not load" }));
    var acts = el("div", { class: "ffx-ib-acts", role: "group", "aria-label": "Mark this hit" }, [
      toggle("Pin", h.mark === "pinned", function () { mark(h, { mark: h.mark === "pinned" ? null : "pinned" }); }),
      toggle("Dismiss", h.mark === "dismissed", function () { mark(h, { mark: h.mark === "dismissed" ? null : "dismissed" }); }),
      toggle("Useful", h.feedback === "useful", function () { mark(h, { feedback: h.feedback === "useful" ? null : "useful" }); }),
      toggle("Noise", h.feedback === "noise", function () { mark(h, { feedback: h.feedback === "noise" ? null : "noise" }); }),
      el("span", { class: "ffx-ib-actn", id: "ffxIbActNote", role: "status" }),
    ]);
    hitHost.appendChild(acts);
    var rc = el("section", { class: "ffx-ib-rcs", "aria-labelledby": "ffxIbRcT" }, [el("h3", { id: "ffxIbRcT", text: "Receipts of this wire" })]);
    var rl = el("ul", { class: "ffx-ib-rcl" });
    rc.appendChild(rl);
    hitHost.appendChild(rc);
    receiptsInto(rl, h);
    fitDetail();
  }

  function fitDetail() {
    if (!fit) return;
    var rl = hitHost.querySelector(".ffx-ib-rcl");
    if (rl) fit.rows(rl, { keep: 1 });
    var tb = hitHost.querySelector(".ffx-ib-ev tbody");
    if (tb) {
      var host = hitHost;
      var rows = [].slice.call(tb.children);
      rows.forEach(function (r) { r.classList.remove("ffx-cut"); });
      for (var i = rows.length - 1; i >= 1 && host.scrollHeight > host.clientHeight + 1; i--) rows[i].classList.add("ffx-cut");
      var cut = rows.filter(function (r) { return r.classList.contains("ffx-cut"); }).length;
      var note = hitHost.querySelector(".ffx-ib-evcut");
      if (cut && !note) hitHost.querySelector(".ffx-ib-evh").appendChild(el("p", { class: "ffx-ib-evcut", title: "Conditions cut to fit", text: "+" + cut + " more conditions; open on a larger screen" }));
      else if (note && !cut) note.parentNode.removeChild(note);
      else if (note) note.textContent = "+" + cut + " more conditions; open on a larger screen";
    }
  }

  function writeUrl(id) {
    try {
      var u = new URL(location.href);
      if (id) u.searchParams.set("hit", id);
      else u.searchParams.delete("hit");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    } catch (e) { void e; }
  }

  function select(id, focusPanel) {
    if (!HIT_RE.test(id)) return;
    S.selected = id;
    writeUrl(id);
    [].forEach.call(list.querySelectorAll(".ffx-ib-row[data-ff-hit]"), function (b) {
      if (b.getAttribute("data-ff-hit") === id) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    if (focusPanel) view("hit");
    if (S.shadow) {
      clear(hitHost);
      hitHost.appendChild(el("p", { class: "ffx-ib-wait", "data-ff-absent": "held", text: DASH + " held: in shadow a hit is not opened here." }));
      return;
    }
    var row = hitById(id);
    var base = row ? Object.assign({}, row) : { id: id, kind: "yours", sentence: { v: null, text: DASH, reason: "reading", reasonText: "reading the hit" } };
    paintDetail(base);
    var mine = ++S.detailTicket;
    net.get("/api/ff/hits?id=" + encodeURIComponent(id)).then(function (body) {
      if (mine !== S.detailTicket) return;
      var h = body && body.hit ? body.hit : null;
      if (!h) throw Object.assign(new Error("Flows sent no hit"), { code: "unreadable" });
      paintDetail(h);
    }).catch(function (err) {
      if (mine !== S.detailTicket) return;
      clear(hitHost);
      hitHost.appendChild(el("p", { class: "ffx-ib-wait", "data-ff-absent": err && err.code === "ff_hit_not_found" ? "not_found" : "unavailable", text: errText(err) }));
      var again = el("button", { type: "button", class: "ffx-ib-link", text: "Retry" });
      again.addEventListener("click", function () { select(id, false); });
      hitHost.appendChild(again);
    });
  }

  function view(v) {
    root.setAttribute("data-view", v);
    [].forEach.call(document.querySelectorAll("#ffxIbTabs [role=tab]"), function (t) {
      var on = t.getAttribute("data-v") === v;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    requestAnimationFrame(function () { layout(); fitDetail(); });
  }

  function readAll() {
    if (!S.heads || S.shadow) return;
    var asked = { readSeq: S.heads.m, houseReadSeq: S.heads.h };
    readBtn.disabled = true;
    net.post("/api/ff/read", asked).then(function (body) {
      var c = body && body.cursors ? body.cursors : { readSeq: asked.readSeq, houseReadSeq: asked.houseReadSeq };
      S.hits.forEach(function (h) { h.unread = false; });
      if (body && body.unread) S.unread = body.unread;
      paintList();
      if (hooks) {
        hooks.emit("ff:read", { stream: "member", seq: c.readSeq });
        hooks.emit("ff:read", { stream: "house", seq: c.houseReadSeq });
      }
      say("Marked read up to the newest hit this page read.");
    }, function (err) {
      paintCap();
      say(errText(err));
      moreLine.textContent = errText(err);
    });
  }

  function paintHealth(view) {
    S.health = view;
    if (hooks) hooks.state(healthBox, view.state);
    else healthBox.setAttribute("data-ff-state", view.state || "unknown");
    put(healthLine, typeof view.line === "string" && view.line ? view.line : { reason: view.reason || "unavailable", reasonText: view.reasonText || "health unavailable" });
    healthLine.setAttribute("title", healthLine.textContent);
    var ev = view.evaluator || {};
    var n = ev.nightly && ev.nightly.finishedAt ? ev.nightly.finishedAt : null;
    var l = ev.live && ev.live.lastOkAt ? ev.live.lastOkAt : null;
    var nt = txt(n);
    healthNightly.textContent = "Nightly " + nt.text;
    if (nt.absent) healthNightly.setAttribute("data-ff-absent", nt.absent); else healthNightly.removeAttribute("data-ff-absent");
    var lt = txt(l);
    healthLive.textContent = "Live " + lt.text;
    if (lt.absent) healthLive.setAttribute("data-ff-absent", lt.absent); else healthLive.removeAttribute("data-ff-absent");
    healthNightly.setAttribute("title", healthNightly.textContent);
    healthLive.setAttribute("title", healthLive.textContent);
    if (view.mode === "shadow" && !S.shadow) {
      S.shadow = true;
      banner.hidden = false;
      banner.setAttribute("data-ff-mode", "shadow");
      if (!banner.textContent) banner.textContent = "Running in shadow: hits are evaluated and held, none is delivered yet.";
    }
    if (view.unread) S.unread = view.unread;
    paintCap();
  }

  function readHealth() {
    return net.get("/api/ff/health").then(function (view) {
      if (!view || typeof view !== "object") throw Object.assign(new Error("Flows sent no health"), { code: "unreadable" });
      paintHealth(view);
    }, function (err) {
      if (hooks) hooks.state(healthBox, "down");
      else healthBox.setAttribute("data-ff-state", "down");
      var t = errText(err).replace(DASH + " unavailable", DASH + " health unavailable");
      healthLine.textContent = t;
      healthLine.setAttribute("data-ff-absent", "unavailable");
      healthLine.setAttribute("title", t);
      healthNightly.textContent = "";
      healthLive.textContent = "";
    });
  }

  function filterTo(state) {
    if (state === S.filter) return;
    S.filter = state;
    S.expanded = {};
    [].forEach.call(document.querySelectorAll("#ffxIbFilters [role=tab]"), function (t) {
      var on = t.getAttribute("data-state") === state;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    if (S.shadow) { S.phase = "shadow"; paintList(); return; }
    load(false);
  }

  function arrows(box, onPick) {
    box.addEventListener("keydown", function (e) {
      var tabs = [].slice.call(box.querySelectorAll("[role=tab]"));
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
      if (j === null) return;
      e.preventDefault();
      j = (j + tabs.length) % tabs.length;
      tabs[j].focus();
      onPick(tabs[j]);
    });
    box.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[role=tab]") : null;
      if (t) onPick(t);
    });
  }

  function onRow(e) {
    var b = e.target.closest ? e.target.closest(".ffx-ib-row") : null;
    if (!b) return;
    var g = b.getAttribute("data-group");
    if (g) {
      S.expanded[g] = true;
      paintList();
      var first = (allDlg.open ? allList : list).querySelector(".ffx-ib-row[data-ff-hit]");
      if (first) first.focus();
      return;
    }
    var id = b.getAttribute("data-ff-hit");
    if (allDlg.open) allDlg.close();
    select(id, narrow());
  }

  function rowKeys(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    var rows = [].slice.call(e.currentTarget.querySelectorAll(".ffx-ib-li:not(.ffx-cut) .ffx-ib-row"));
    var i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    var j = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    rows[j].focus();
  }

  arrows($("ffxIbFilters"), function (t) { filterTo(t.getAttribute("data-state")); });
  arrows($("ffxIbTabs"), function (t) { view(t.getAttribute("data-v")); });
  list.addEventListener("click", onRow);
  allList.addEventListener("click", onRow);
  list.addEventListener("keydown", rowKeys);
  allList.addEventListener("keydown", rowKeys);
  readBtn.addEventListener("click", readAll);
  retryBtn.addEventListener("click", function () { load(false); });
  allBtn.addEventListener("click", function () { paintAll(); allDlg.showModal(); });
  loadBtn.addEventListener("click", function () { load(true); });
  $("ffxIbInfoBtn").addEventListener("click", function () { $("ffxIbInfo").showModal(); });
  [].forEach.call(document.querySelectorAll(".ffx-ib-dlg [data-close]"), function (b) {
    b.addEventListener("click", function () { b.closest("dialog").close(); });
  });
  if (hooks) {
    hooks.on("ff:unread", function (d) {
      if (S.shadow) return;
      S.unread = { house: d.house, member: d.member, total: d.total, label: d.total > 99 ? "99+" : String(d.total) };
      paintCap();
    });
    hooks.on("ff:health", function (d) { hooks.state(healthBox, d.state); });
  }
  if (fit) fit.watch($("ffxIbStage"), function () { layout(); fitDetail(); });

  var deep = null;
  try { deep = new URL(location.href).searchParams.get("hit"); } catch (e) { void e; }
  paintCap();
  readHealth();
  if (S.shadow) {
    S.phase = "shadow";
    paintList();
    if (deep && HIT_RE.test(deep)) select(deep, false);
  } else {
    if (deep && HIT_RE.test(deep)) { select(deep, narrow()); }
    load(false);
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, {
    ffInbox: Object.freeze(Object.assign({}, window.FlowsUI.ffInbox || {}, { page: Object.freeze({ state: function () { return { filter: S.filter, phase: S.phase, hits: S.hits.length, selected: S.selected, shadow: S.shadow, heads: S.heads }; } }) })),
  }));
})();
