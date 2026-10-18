(function () {
  "use strict";

  var U = window.FlowsUI;
  if (!U || typeof U.h !== "function" || U.oracle) return;
  var h = U.h, s = U.s;
  var W = U.oracleWords, L = U.oracleLive, K = U.oracleKit;
  var host = document.getElementById("fxOracle");
  if (!host || !W || !L || !K) return;

  var MIN = 60000;
  var DASH = "—";
  var STATE_NAME = Object.freeze({ calm: "quiet", watching: "watching live", signal: "has a signal", conflict: "sees two readings that disagree", stale: "resting" });
  var PREF = Object.freeze({ on: 2, quiet: 1, off: 0 });
  var PREF_BY = Object.freeze(["off", "quiet", "on"]);
  var KIND_LABEL = Object.freeze({ surge: "Heavy flow", repeat: "Same strike again", flip: "Flow turned", cluster: "One expiry", sweeps: "Fast prints", size: "Big print", sector: "Sector together" });
  var KIND_SHORT = Object.freeze({ surge: "heavy flow", repeat: "same strike again", flip: "flow turned", cluster: "flow in one expiry", sweeps: "fast prints", size: "one big print", sector: "sector together" });
  var VERDICT_GLYPH = Object.freeze({ cheap: "▼", rich: "▲" });
  var WHY_TEXT = Object.freeze({
    ok: "Priced from last night's chain.",
    "no-card": "There is no card for this name yet, so the model has no chain to price.",
    screen: "Only the universe row is read for this name. No options chain was priced.",
    grade: "The inputs are not complete enough to stand behind a call.",
    "no-engine": "The options engine did not run for this name.",
    "event.window": "A report falls inside the window, so the model holds no call.",
    "premium.conflict": "The premium readings conflict, so the model holds no call.",
    expired: "The record is two or more sessions old. Only facts are shown.",
    behind1: "The record is one session old, so grades are held at 1.",
    disagree: "Dealer, flow and implied-state readings disagree.",
    "thin-norm": "Too few flagged windows in this name's history to say what is usual for it."
  });
  var SILENCE = Object.freeze({
    cap: "Break-even needs a priced quote.", quote: "No two-sided quote.", ev: "The engine could not price this position.", "thin-norm": "Too little history for this name.",
    unit: "The vendor states no unit.", failed: "The read failed.", pending: "Still being read.", expired: "Too old to show.", off: "Switched off."
  });
  var CLEAR_TEXT = "Nothing stands out. Options are priced about where the model would price them.";
  var INFO_TEXT = "Cheap means the market charges less than the model's fair price; rich, more. The model's price comes from the engine's fitted smile and its own model of returns, not from a quote.";
  var SHEET_ID = "orcSheet";

  var S = {
    pref: "on", mode: host.getAttribute("data-oracle") === "quiet" ? "quiet" : "on", route: "idle",
    top: null, rec: new Map(), recFail: new Map(), msgs: [], open: false, opener: null, behind: [], expanded: new Set(),
    lastFlowAt: null, announceAt: 0, announceQ: null, announceTimer: null, gesture: false, toastTimer: null,
    liveState: L.createState(), unsub: null, hidden: false, asked: new Set(), batchAt: 0
  };

  function cookie(name) {
    try {
      var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function setCookie(name, value) {
    try { document.cookie = name + "=" + encodeURIComponent(value) + "; Path=/flows; Max-Age=31536000; SameSite=Lax"; } catch (e) {   }
  }
  function readPref() {
    var c = cookie("fn_oracle");
    var cap = PREF[S.mode];
    if (c === null || PREF[c] === undefined) return PREF_BY[cap];
    return PREF_BY[Math.min(PREF[c], cap)];
  }
  function ticker() {
    if (host.getAttribute("data-page") !== "ticker") return null;
    try {
      var t = new URLSearchParams(location.search).get("t");
      return t && /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(t.trim()) ? t.trim().toUpperCase() : null;
    } catch (e) { return null; }
  }
  function refuses(t) { return U.fixture && typeof U.fixture.refuses === "function" ? U.fixture.refuses(t) : false; }

  function get(url) {
    return fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(function (r) {
      if (r.status === 404) return { kind: "absent" };
      if (!r.ok) return { kind: "failed", status: r.status };
      return r.json().then(function (b) { return { kind: "ok", body: b }; });
    }).catch(function () { return { kind: "failed", status: 0 }; });
  }

  function loadTop() {
    return get("/api/flows/oracle?top=1").then(function (r) {
      if (r.kind === "ok" && r.body && Array.isArray(r.body.items)) { S.top = r.body; S.route = "ok"; } else { S.top = null; S.route = r.kind === "ok" ? "failed" : r.kind; }
      paint();
    });
  }
  function loadRec(t) {
    if (!t || refuses(t)) return Promise.resolve();
    return get("/api/flows/oracle?t=" + encodeURIComponent(t)).then(function (r) {
      if (r.kind === "ok" && r.body && typeof r.body === "object" && r.body.state) { S.rec.set(t, r.body); S.recFail.delete(t); } else S.recFail.set(t, r.kind === "ok" ? "failed" : r.kind);
      paint();
    });
  }

  function loadBatch(list) {
    if (!list.length) return Promise.resolve();
    list.forEach(function (t) { S.asked.add(t); });
    return get("/api/flows/oracle?ts=" + list.map(encodeURIComponent).join(",")).then(function (r) {
      var recs = r.kind === "ok" && r.body && r.body.records && typeof r.body.records === "object" ? r.body.records : null;
      list.forEach(function (t) {
        if (recs && recs[t] && recs[t].state) { S.rec.set(t, recs[t]); S.recFail.delete(t); } else S.recFail.set(t, recs ? "absent" : r.kind);
      });
      paint();
    });
  }
  function wantContext(rows) {
    var now = Date.now();
    if (now - S.batchAt < 30000) return;
    var sums = new Map();
    rows.forEach(function (r) {
      if (!r || typeof r.t !== "string" || S.rec.has(r.t) || S.asked.has(r.t) || refuses(r.t) || !/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(r.t)) return;
      sums.set(r.t, (sums.get(r.t) || 0) + (Number.isFinite(r.prem) ? r.prem : 0));
    });
    var list = Array.from(sums.keys()).sort(function (a, b) { return sums.get(b) - sums.get(a); }).slice(0, 12);
    if (!list.length) return;
    S.batchAt = now;
    loadBatch(list);
  }

  function bestMsg() {
    var now = Date.now(), best = null;
    for (var i = 0; i < S.msgs.length; i++) {
      var m = S.msgs[i];
      if (now - m.at > 30 * MIN) continue;
      if (!best || m.strength > best.strength || (m.strength === best.strength && m.at > best.at)) best = m;
    }
    return best;
  }
  function liveCount() {
    var now = Date.now(), n = 0;
    for (var i = 0; i < S.msgs.length; i++) if (now - S.msgs[i].at <= 30 * MIN) n++;
    return n;
  }
  function focusRec() {
    var t = ticker();
    return t ? S.rec.get(t) || null : null;
  }
  function feedLive() {
    var rt = U.rt;
    var f = rt && typeof rt.fresh === "function" ? rt.fresh("fl") : null;
    return !!f && f.state === "live";
  }
  function stateNow() {
    if (bestMsg()) return "signal";
    var rec = focusRec();
    if (rec && rec.state === "signal") return "signal";
    if (rec && rec.state === "conflict") return "conflict";
    if (feedLive()) return "watching";
    if (S.route === "absent" || S.route === "failed") return "stale";
    if (rec && rec.state === "stale") return "stale";
    return "calm";
  }
  function recHead(rec) {
    var c = rec && Array.isArray(rec.calls) ? rec.calls[0] : null;
    if (!c) return null;
    return rec.ticker + " " + "·" + " " + K.strikeText(c.strike) + " " + (c.side === "P" || c.side === "put" ? "put" : "call") + " looks " + c.verdict;
  }
  function headline() {
    var m = bestMsg();
    if (m) return { glyph: "●", text: m.ticker + " · " + KIND_SHORT[m.kind] };
    var rec = focusRec();
    if (rec && rec.state === "signal") {
      var t = recHead(rec);
      if (t) return { glyph: VERDICT_GLYPH[rec.calls[0].verdict] || "●", text: t };
    }
    if (rec && rec.state === "conflict") return { glyph: W.LEAN_GLYPH.mixed, text: rec.ticker + " · readings disagree" };
    return null;
  }

  var orb, pill, pillGlyph, pillText, badge, liveEl, toast, sheet, scrim, list, titleEl, subEl, closeBtn, infoBtn, infoNote, prefSeg, prefBtns = {};

  function spark() {
    var svg = s("svg", { class: "orc-spark", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
    s("path", { d: "M12 3.2c.5 4.6 2.6 7.2 8.8 8.8-6.2 1.6-8.3 4.2-8.8 8.8-.5-4.6-2.6-7.2-8.8-8.8 6.2-1.6 8.3-4.2 8.8-8.8z" }, svg);
    return svg;
  }

  function build() {
    host.replaceChildren();
    pillGlyph = h("span", { class: "orc-pill-g", "aria-hidden": "true" });
    pillText = h("span", { class: "orc-pill-t" });
    pill = h("span", { class: "orc-pill", "aria-hidden": "true" }, pillGlyph, pillText);
    badge = h("span", { class: "orc-badge", "aria-hidden": "true", hidden: "" });
    orb = h("button", { type: "button", class: "orc-orb", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-controls": SHEET_ID },
      pill, h("span", { class: "orc-disc" }, h("span", { class: "orc-glow", "aria-hidden": "true" }), h("span", { class: "orc-rim", "aria-hidden": "true" }), spark()), badge);
    liveEl = h("p", { class: "visually-hidden", role: "status", "aria-live": "polite" });
    toast = h("p", { class: "orc-toast", "aria-hidden": "true", hidden: "" });
    scrim = h("div", { class: "orc-scrim", hidden: "" });
    titleEl = h("h2", { class: "orc-title", id: "orcTitle" }, "Neuron’s view");
    subEl = h("p", { class: "orc-sub" });
    closeBtn = h("button", { type: "button", class: "orc-close", "aria-label": "Close the Neuron’s view" }, U.glyph("x"));
    infoBtn = h("button", { type: "button", class: "orc-info", "aria-expanded": "false", "aria-label": "What cheap and rich mean" }, "Cheap and rich?");
    infoNote = h("p", { class: "orc-note", hidden: "" }, INFO_TEXT);
    list = h("div", { class: "orc-list", tabindex: "-1" });
    prefSeg = h("div", { class: "orc-pref", role: "group", "aria-label": "How the Neuron shows itself" });
    [["on", "Pill"], ["quiet", "Count"], ["off", "Hide"]].forEach(function (p) {
      var b = h("button", { type: "button", class: "orc-pref-b", "data-pref": p[0], "aria-pressed": "false" }, p[1]);
      b.addEventListener("click", function () { setPref(p[0]); });
      prefBtns[p[0]] = b;
      prefSeg.append(b);
    });
    sheet = h("div", { class: "orc-sheet", id: SHEET_ID, role: "dialog", "aria-modal": "true", "aria-labelledby": "orcTitle", hidden: "", tabindex: "-1" },
      h("span", { class: "orc-grab", "aria-hidden": "true" }),
      h("div", { class: "orc-head" }, h("div", { class: "orc-head-t" }, titleEl, subEl), closeBtn),
      list,
      h("div", { class: "orc-foot" }, h("p", { class: "orc-model" }, W.MODEL_IMPLIED), h("div", { class: "orc-foot-r" }, infoBtn, prefSeg), infoNote));
    host.append(orb, toast, liveEl, scrim, sheet);
    orb.addEventListener("click", function () { setOpen(!S.open); });
    closeBtn.addEventListener("click", function () { setOpen(false); });
    scrim.addEventListener("click", function () { setOpen(false); });
    infoBtn.addEventListener("click", function () {
      var on = infoNote.hidden;
      infoNote.hidden = !on;
      infoBtn.setAttribute("aria-expanded", on ? "true" : "false");
    });
    sheet.addEventListener("keydown", onSheetKey);
    toast.addEventListener("click", function () { setOpen(true); });
  }

  function trapKeys(e) {
    var nodes = Array.prototype.filter.call(sheet.querySelectorAll("button, a[href], [tabindex='0']"), function (n) { return !n.disabled && n.getClientRects().length; });
    if (!nodes.length) return;
    var first = nodes[0], last = nodes[nodes.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || a === sheet)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }
  function onSheetKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key === "Tab") { trapKeys(e); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      var cards = Array.prototype.slice.call(sheet.querySelectorAll(".orc-card"));
      var i = cards.indexOf(document.activeElement);
      if (i < 0 && !cards.length) return;
      e.preventDefault();
      var next = cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) next.focus();
    }
  }

  function setInert(on) {
    if (!on) { while (S.behind.length) S.behind.pop().inert = false; return; }
    document.querySelectorAll("body > .flows-skip, #fxSide, #fxScrim, #fxBar, #flowsMain, #fxTabs, #askDock").forEach(function (n) {
      if (!n.inert) { n.inert = true; S.behind.push(n); }
    });
  }

  function setOpen(open) {
    if (open === S.open) return;
    S.open = open;
    if (open) {
      var a = document.activeElement;
      S.opener = a && a !== document.body ? a : orb;
      sheet.hidden = false;
      scrim.hidden = false;
      void sheet.offsetWidth;
      host.classList.add("is-open");
      orb.setAttribute("aria-expanded", "true");
      setInert(true);
      paintOrb();
      paintSheet();
      var t = ticker();
      if (S.route !== "ok") loadTop();
      if (t && !S.rec.has(t)) loadRec(t);
      try { sheet.focus(); } catch (e) {   }
    } else {
      host.classList.remove("is-open");
      orb.setAttribute("aria-expanded", "false");
      setInert(false);
      var done = function () { if (!S.open) { sheet.hidden = true; scrim.hidden = true; } };
      if (U.reduced()) done(); else setTimeout(done, 260);
      paintOrb();
      var back = S.opener && S.opener.isConnected && S.opener.getClientRects().length ? S.opener : orb;
      S.opener = null;
      try { back.focus(); } catch (e) {   }
    }
  }

  function setPref(p) {
    setCookie("fn_oracle", p);
    S.pref = readPref();
    if (S.pref === "off") setOpen(false);
    else if (S.route === "idle") { loadTop(); loadRec(ticker()); }
    paint();
  }

  function say(text) {
    var now = Date.now();
    if (now - S.announceAt >= 5000) { S.announceAt = now; liveEl.textContent = text; return; }
    S.announceQ = text;
    if (S.announceTimer) return;
    S.announceTimer = setTimeout(function () {
      S.announceTimer = null;
      if (S.announceQ) { S.announceAt = Date.now(); liveEl.textContent = S.announceQ; S.announceQ = null; }
    }, 5000 - (now - S.announceAt));
  }

  function nameOf(state, n) {
    var base = "Neuron, ";
    if (n > 0) return base + n + " new, press to open";
    if (state === "stale") return base + "resting, press to open";
    return base + STATE_NAME[state] + ", press to open";
  }

  function paintOrb() {
    var state = stateNow();
    var n = liveCount() + (focusRec() && focusRec().state === "signal" ? 1 : 0);
    var hl = headline();
    var showPill = S.pref === "on" && hl && !S.open;
    host.hidden = S.pref === "off";
    host.setAttribute("data-state", state);
    host.setAttribute("data-pref", S.pref);
    host.classList.toggle("has-pill", !!showPill);
    if (hl) { pillGlyph.textContent = hl.glyph; pillText.textContent = hl.text; }
    pill.style.setProperty("--pw", Math.min(300, 100 + (hl ? hl.text.length * 7.4 : 0)) + "px");
    badge.hidden = n < 1;
    badge.textContent = String(n);
    var name = nameOf(state, n);
    if (state === "stale" && S.top && S.top.generatedAt) name = "Neuron, last read " + U.F.time(S.top.generatedAt) + ", press to open";
    orb.setAttribute("aria-label", name);
    orb.setAttribute("aria-expanded", S.open ? "true" : "false");
  }

  function pctText(v) { return K.pct0(v); }

  function chipFor(rec) {
    var lean = rec.stance && rec.stance.lean ? rec.stance.lean : "none";
    var conv = rec.stance && Number.isInteger(rec.stance.conviction) ? rec.stance.conviction : 0;
    return h("span", { class: "orc-chip", "data-lean": lean }, h("span", { "aria-hidden": "true" }, W.LEAN_GLYPH[lean] || W.LEAN_GLYPH.none), W.LEAN_WORD[lean] || W.LEAN_WORD.none, h("i", null, W.CONVICTION_WORDS[conv] || W.CONVICTION_WORDS[0]));
  }

  function figure(label, value, reason, tone) {
    var f = h("div", { class: "orc-fig" }, h("dt", null, label), h("dd", { "data-tone": tone || "" }, value));
    if (value === DASH && reason) f.append(h("small", null, reason));
    return f;
  }
  function toneOf(v) {
    var t = Math.sign(Number.isFinite(v) ? v : 0);
    return { "-1": "down", "0": "", "1": "up" }[t];
  }

  function detailRow(label, value) { return h("div", { class: "orc-row" }, h("dt", null, label), h("dd", null, value)); }

  function callCard(rec, c, i) {
    var id = c.id || rec.ticker + ":" + i;
    var open = S.expanded.has(id);
    var words = c.say && c.say.head ? c.say : W.callSay(c) || { head: DASH, why: "", gain: "" };
    var side = c.side === "P" || c.side === "put" ? "put" : "call";
    var verdict = c.verdict === "rich" ? "rich" : "cheap";
    var mi = Number.isFinite(c.marketIv) ? c.marketIv : null, fi = Number.isFinite(c.fairIv) ? c.fairIv : null;
    var pts = mi !== null && fi !== null ? Math.abs(mi - fi) * 100 : null;
    var det = h("div", { class: "orc-more" }, h("div", { class: "orc-more-in" }, h("dl", { class: "orc-dl" },
      detailRow("Market vol", K.vol1(mi)),
      detailRow("Fair vol", K.vol1(fi)),
      detailRow("Edge", (pts === null ? DASH : pts.toFixed(1) + " vol points") + " · " + (Number.isFinite(c.edgeUsd) ? K.whole(Math.abs(c.edgeUsd)) + " a contract" : DASH)),
      detailRow("Quote", K.cents(c.bid) + " / " + K.cents(c.ask) + " · mid " + K.cents(c.mid)),
      detailRow("Spread", Number.isFinite(c.spreadPct) ? Math.round(c.spreadPct * 100) + "% of mid" : DASH),
      detailRow("Largest loss", Number.isFinite(c.maxLoss) ? K.whole(Math.abs(c.maxLoss)) : "Not capped"),
      detailRow("Largest gain", Number.isFinite(c.maxGain) ? K.whole(c.maxGain) : "Not capped"),
      detailRow("Grade", Number.isInteger(c.grade) ? c.grade + " of 3" : DASH)),
    Array.isArray(c.assumptions) && c.assumptions.length ? h("ul", { class: "orc-as" }, c.assumptions.slice(0, 3).map(function (a) { return h("li", null, String(a)); })) : null,
    h("p", { class: "orc-expl" }, words.why || "")));
    var toggle = h("button", { type: "button", class: "orc-tog", "aria-expanded": open ? "true" : "false" }, h("span", { class: "orc-chev", "aria-hidden": "true" }, "›"), open ? "Hide details" : "Show why");
    var card = h("article", { class: "orc-card", tabindex: "0", "data-verdict": verdict, "data-open": open ? "1" : "0", "aria-label": words.head },
      h("div", { class: "orc-card-h" },
        h("span", { class: "orc-badge-v", "data-verdict": verdict }, h("span", { "aria-hidden": "true" }, VERDICT_GLYPH[verdict]), verdict === "cheap" ? "Cheap" : "Rich"),
        h("span", { class: "orc-act" }, c.action === "collect" ? "Collect" : "Pay"),
        c.moved ? h("span", { class: "orc-moved" }, "Moved since priced") : null),
      h("p", { class: "orc-hl" }, words.head),
      h("dl", { class: "orc-figs" },
        figure("Average result", Number.isFinite(c.ev) ? K.signedWhole(c.ev) : DASH, SILENCE.ev, toneOf(c.ev)),
        figure("Chance of profit", pctText(c.pop), SILENCE.ev),
        figure("Break-even", K.cents(c.breakeven), SILENCE.cap)),
      h("p", { class: "orc-gain" }, words.gain || ""),
      h("div", { class: "orc-tw" }, toggle, det),
      h("p", { class: "orc-fine" }, W.MODEL_IMPLIED));
    toggle.addEventListener("click", function () {
      if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id);
      var o = S.expanded.has(id);
      card.setAttribute("data-open", o ? "1" : "0");
      toggle.setAttribute("aria-expanded", o ? "true" : "false");
      toggle.lastChild.textContent = o ? "Hide details" : "Show why";
    });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target === card) { e.preventDefault(); toggle.click(); }
    });
    return card;
  }

  function movedFlag(rec) {
    var ctx = rec.context || {};
    var px = U.rt && typeof U.rt.quote === "function" ? U.rt.quote(rec.ticker) : null;
    var calls = Array.isArray(rec.calls) ? rec.calls : [];
    if (!px || !Number.isFinite(px.price) || !Number.isFinite(ctx.spot) || !calls.length || !Number.isFinite(calls[0].marketIv)) return false;
    var oneDay = ctx.spot * calls[0].marketIv / Math.sqrt(252);
    return Math.abs(px.price - ctx.spot) > 0.5 * oneDay;
  }

  function asOfText(rec) {
    var bits = [];
    if (rec.session) bits.push("Priced on the " + U.F.day(rec.session) + " session");
    if (rec.generatedAt) bits.push(U.F.time(rec.generatedAt));
    return bits.join(" · ");
  }

  function recBlock(t, rec, fail) {
    var box = h("section", { class: "orc-sec", "aria-label": t });
    box.append(h("h3", { class: "orc-sec-t" }, t, rec ? chipFor(rec) : null));
    if (!rec) {
      box.append(h("p", { class: "orc-empty", "data-empty": "unavailable" }, fail === "absent" ? "The Neuron has not published a view for this name yet." : "The Neuron could not be read just now.", " ",
        h("button", { type: "button", class: "orc-retry", onclick: function () { loadRec(t); } }, "Retry")));
      return box;
    }
    var lean = rec.stance && rec.stance.lean ? rec.stance.lean : "none";
    var conv = rec.stance && Number.isInteger(rec.stance.conviction) ? rec.stance.conviction : 0;
    var line = rec.stance && rec.stance.line ? rec.stance.line : (W.STANCE_LINES[lean] || W.STANCE_LINES.none)[conv] || W.STANCE_LINES.none[0];
    box.append(h("p", { class: "orc-line" }, line));
    var why = WHY_TEXT[rec.stateWhy];
    if (rec.state === "calm") box.append(h("p", { class: "orc-quiet" }, CLEAR_TEXT));
    else if (why && rec.state !== "signal") box.append(h("p", { class: "orc-quiet" }, why));
    var flag = movedFlag(rec);
    (Array.isArray(rec.calls) ? rec.calls : []).slice(0, 3).forEach(function (c, i) { box.append(callCard(rec, Object.assign({}, c, { moved: flag }), i)); });
    var wh = Array.isArray(rec.withheld) ? rec.withheld : [];
    if (wh.length) box.append(h("ul", { class: "orc-wh", "aria-label": "Not read" }, wh.slice(0, 6).map(function (w) { return h("li", null, h("b", null, DASH), " ", String(w.k), ": ", SILENCE[w.reason] || String(w.reason)); })));
    var meta = [];
    if (Number.isInteger(rec.grade)) meta.push("Grade " + rec.grade + " of 3");
    var a = asOfText(rec);
    if (a) meta.push(a);
    if (rec.provenance && rec.provenance.ideas) meta.push("Ideas: " + rec.provenance.ideas);
    if (meta.length) box.append(h("p", { class: "orc-prov" }, meta.join(" · ")));
    return box;
  }

  function msgCard(m) {
    var link = h("a", { class: "orc-open", href: "/flows/ticker/?t=" + encodeURIComponent(m.ticker) }, "Open " + m.ticker);
    var pips = h("span", { class: "orc-pips", role: "img", "aria-label": "Strength " + m.strength + " of 3" }, [1, 2, 3].map(function (n) { return h("i", { class: n <= m.strength ? "on" : "" }); }));
    var card = h("article", { class: "orc-card orc-msg", tabindex: "0", "data-kind": m.kind },
      h("div", { class: "orc-card-h" }, h("span", { class: "orc-kind" }, KIND_LABEL[m.kind] || "Flow"), pips, h("time", { class: "orc-time" }, K.trt(m.at))),
      h("p", { class: "orc-hl" }, m.say || DASH),
      h("ul", { class: "orc-facts" }, (m.facts || []).map(function (f) { return h("li", null, h("span", null, f.label), h("b", null, f.display)); })),
      link);
    card.addEventListener("click", function (e) {
      if (e.target.closest("a")) return;
      if (m.kind === "sector" && m.sector && U.link && typeof U.link.emit === "function") U.link.emit("oracle", { kind: "sector", value: m.sector, source: "oracle" });
      else if (U.link && typeof U.link.emit === "function") U.link.emit("oracle", { kind: "ticker", value: m.ticker, source: "oracle" });
    });
    return card;
  }

  function liveBlock() {
    var box = h("section", { class: "orc-sec", "aria-label": "Right now" });
    box.append(h("h3", { class: "orc-sec-t" }, "Right now"));
    var now = Date.now();
    var msgs = S.msgs.filter(function (m) { return now - m.at <= 60 * MIN; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 6);
    if (msgs.length) { msgs.forEach(function (m) { box.append(msgCard(m)); }); if (S.liveState.quiet > 0) box.append(h("p", { class: "orc-prov" }, "+" + S.liveState.quiet + " more quiet ones")); return box; }
    var why = feedLive() ? "Watching live. Nothing is running far from its usual pace." : S.lastFlowAt ? "Quiet. The last flow was at " + K.trt(S.lastFlowAt) + "." : "Not watching live on this page, or the session is closed.";
    box.append(h("p", { class: "orc-quiet" }, why));
    return box;
  }

  function topBlock() {
    var box = h("section", { class: "orc-sec", "aria-label": "Strongest today" });
    box.append(h("h3", { class: "orc-sec-t" }, "Strongest today"));
    if (S.route === "absent" || S.route === "failed" || !S.top) {
      box.append(h("p", { class: "orc-empty", "data-empty": "unavailable" }, S.route === "idle" ? "Reading…" : "Neuron is resting. " + (S.route === "absent" ? "No view is published yet." : "The read failed."), " ", h("button", { type: "button", class: "orc-retry", onclick: loadTop }, "Retry")));
      return box;
    }
    if (!S.top.items.length) { box.append(h("p", { class: "orc-quiet" }, "No call clears the bar tonight.")); return box; }
    var ul = h("ul", { class: "orc-top" });
    S.top.items.slice(0, 6).forEach(function (it) {
      if (refuses(it.t)) return;
      var tc = it.topCall;
      var lean = it.stance && it.stance.lean ? it.stance.lean : "none";
      ul.append(h("li", null, h("a", { class: "orc-toprow", href: "/flows/ticker/?t=" + encodeURIComponent(it.t) },
        h("b", null, it.t), h("span", { class: "orc-chip", "data-lean": lean }, h("span", { "aria-hidden": "true" }, W.LEAN_GLYPH[lean] || W.LEAN_GLYPH.none), W.LEAN_WORD[lean] || W.LEAN_WORD.none),
        h("span", { class: "orc-toph" }, tc && tc.head ? tc.head : it.state))));
    });
    box.append(ul);
    return box;
  }

  function paintSheet() {
    if (!S.open) return;
    var t = ticker();
    var parts = [liveBlock()];
    if (t) parts.push(recBlock(t, S.rec.get(t) || null, S.recFail.get(t)));
    parts.push(topBlock());
    var keep = list.scrollTop;
    var focused = document.activeElement;
    var kind = focused && list.contains(focused) && focused.classList.contains("orc-card") ? Array.prototype.indexOf.call(list.querySelectorAll(".orc-card"), focused) : -1;
    list.replaceChildren.apply(list, parts);
    list.scrollTop = keep;
    if (kind >= 0) { var again = list.querySelectorAll(".orc-card")[kind]; if (again) again.focus(); }
    var rec = t ? S.rec.get(t) : null;
    subEl.textContent = rec ? asOfText(rec) : S.top && S.top.generatedAt ? "Read " + U.F.time(S.top.generatedAt) : "";
    Object.keys(prefBtns).forEach(function (k) { prefBtns[k].setAttribute("aria-pressed", S.pref === k ? "true" : "false"); });
  }

  function paintHome() {
    var el = document.getElementById("orcHome");
    if (!el) return;
    el.replaceChildren();
    var items = S.top && Array.isArray(S.top.items) ? S.top.items.filter(function (i) { return !refuses(i.t); }).slice(0, 3) : [];
    el.setAttribute("data-state", items.length ? "ok" : S.route);
    el.append(h("span", { class: "orc-home-k" }, h("span", { class: "orc-home-s", "aria-hidden": "true" }, spark()), "Neuron’s view"));
    if (!items.length) {
      var txt = { idle: "Reading…", ok: "No call clears the bar tonight.", absent: "Resting. No view is published yet.", failed: "Resting. The read failed." }[S.route] || "Resting.";
      el.append(h("span", { class: "orc-home-t" }, txt));
      return;
    }
    items.forEach(function (it) {
      var lean = it.stance && it.stance.lean ? it.stance.lean : "none";
      el.append(h("a", { class: "orc-home-i", href: "/flows/ticker/?t=" + encodeURIComponent(it.t) }, h("b", null, it.t), h("span", { "data-lean": lean }, h("i", { "aria-hidden": "true" }, W.LEAN_GLYPH[lean] || W.LEAN_GLYPH.none), it.topCall && it.topCall.head ? it.topCall.head : W.LEAN_WORD[lean])));
    });
  }

  function paintBand() {
    var el = document.getElementById("orcBand");
    if (!el) return;
    var now = Date.now();
    var msgs = S.msgs.filter(function (m) { return now - m.at <= 30 * MIN; }).sort(function (a, b) { return b.strength - a.strength || b.at - a.at; }).slice(0, 3);
    el.replaceChildren(h("span", { class: "orc-band-k" }, "Right now"));
    if (!msgs.length) {
      el.append(h("span", { class: "orc-band-q" }, feedLive() ? "Watching. Nothing is running far from its usual pace." : S.lastFlowAt ? "Quiet. Last flow " + K.trt(S.lastFlowAt) + "." : "Quiet."));
      return;
    }
    msgs.forEach(function (m) {
      var b = h("button", { type: "button", class: "orc-band-c", "data-kind": m.kind, title: m.say || "" }, h("b", null, m.ticker), KIND_SHORT[m.kind]);
      b.addEventListener("click", function () {
        if (m.kind === "sector" && m.sector && U.link && typeof U.link.emit === "function") U.link.emit("oracle", { kind: "sector", value: m.sector, source: "oracle" });
        else if (U.link && typeof U.link.emit === "function") U.link.emit("oracle", { kind: "ticker", value: m.ticker, source: "oracle" });
        setOpen(true);
      });
      el.append(b);
    });
  }

  function paint() {
    paintOrb();
    paintSheet();
    paintHome();
    paintBand();
    paintGlances();
  }

  var glances = new Set();
  function glanceBody(box, t) {
    var rec = S.rec.get(t);
    box.replaceChildren();
    var btn = h("button", { type: "button", class: "orc-gl-b" });
    if (!rec) {
      var fail = S.recFail.get(t);
      btn.append(h("span", { class: "orc-gl-k" }, h("span", { class: "orc-gl-s", "aria-hidden": "true" }, spark()), "Neuron"), h("span", { class: "orc-gl-t" }, fail ? "Resting. No view for this name." : "Reading…"));
    } else {
      var c = Array.isArray(rec.calls) ? rec.calls[0] : null;
      var words = c ? (c.say && c.say.head ? c.say : W.callSay(c)) : null;
      btn.append(h("span", { class: "orc-gl-k" }, h("span", { class: "orc-gl-s", "aria-hidden": "true" }, spark()), "Neuron"), chipFor(rec),
        h("span", { class: "orc-gl-t" }, words && words.head ? words.head : (rec.stance && rec.stance.line) || (WHY_TEXT[rec.stateWhy] || CLEAR_TEXT)));
    }
    btn.setAttribute("aria-haspopup", "dialog");
    btn.addEventListener("click", function () { setOpen(true); });
    box.append(btn);
  }
  function paintGlances() {
    glances.forEach(function (g) {
      if (!g.box.isConnected) { glances.delete(g); return; }
      glanceBody(g.box, g.t);
    });
  }
  function glance(rail, t) {
    if (!rail || typeof t !== "string") return null;
    var T = t.trim().toUpperCase();
    if (refuses(T)) return null;
    var old = rail.querySelector(".orc-glance");
    if (old) old.remove();
    var box = h("div", { class: "orc-glance", "data-ticker": T });
    glanceBody(box, T);
    var foot = rail.querySelector(".ft-foot");
    if (foot) rail.insertBefore(box, foot); else rail.append(box);
    glances.add({ box: box, t: T });
    if (!S.rec.has(T) && !S.recFail.has(T)) loadRec(T);
    return box;
  }

  function onFlow(c) {
    var rows = c && Array.isArray(c.rows) ? c.rows : [];
    var ctx = {};
    S.rec.forEach(function (rec, t) { if (rec && rec.context) ctx[t] = rec.context; });
    rows.forEach(function (r) {
      var at = typeof r.spanStart === "string" ? Date.parse(r.spanStart) : NaN;
      if (isFinite(at) && (S.lastFlowAt === null || at > S.lastFlowAt)) S.lastFlowAt = at;
    });
    var fresh = feedLive();
    var now = Date.now();
    if (fresh && S.pref !== "off") wantContext(rows);
    var out = L.detect(S.liveState, rows, ctx, now, { live: fresh && S.pref !== "off", refuses: refuses });
    if (!out.length) { paint(); return; }
    out.forEach(function (m) {
      S.msgs.push(m);
      host.dispatchEvent(new CustomEvent("oracle:signal", { bubbles: true, detail: { id: m.id, ticker: m.ticker } }));
    });
    S.msgs = S.msgs.filter(function (m) { return now - m.at <= 120 * MIN; });
    var top = out.slice().sort(function (a, b) { return b.strength - a.strength; })[0];
    if (S.pref !== "off") say("Neuron: " + top.say);
    if (S.pref === "on" && !S.open && window.matchMedia("(max-width: 767.98px)").matches) showToast(top.ticker + " · " + KIND_SHORT[top.kind]);
    buzz();
    host.classList.remove("is-flash");
    void host.offsetWidth;
    host.classList.add("is-flash");
    setTimeout(function () { host.classList.remove("is-flash"); }, 700);
    paint();
  }

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove("is-on");
    void toast.offsetWidth;
    toast.classList.add("is-on");
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(function () { toast.hidden = true; toast.classList.remove("is-on"); }, 6000);
  }
  function buzz() {
    if (!S.gesture || U.reduced() || cookie("fn_oracle_haptic") !== "on" || typeof navigator.vibrate !== "function") return;
    try { navigator.vibrate(8); } catch (e) {   }
  }

  function loadCss() {
    var i = document.querySelector('i[data-defer="oracle"][data-css]');
    var href = i ? i.getAttribute("data-css") : null;
    if (!href || document.querySelector('link[href="' + href + '"]')) return Promise.resolve();
    return new Promise(function (ok) {
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      l.onload = ok;
      l.onerror = ok;
      document.head.append(l);
    });
  }

  function onKey(e) {
    if (!S.gesture) S.gesture = true;
    if (e.key === "Escape" && S.open && !e.defaultPrevented) { e.preventDefault(); setOpen(false); return; }
    if (e.key === "N" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var a = document.activeElement, tag = a && a.tagName ? a.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (a && a.isContentEditable)) return;
      if (S.pref === "off" && PREF[S.mode] > 0) { e.preventDefault(); setPref("quiet"); }
    }
  }

  function mount() {
    S.pref = readPref();
    build();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", function () { S.gesture = true; }, { once: true });
    if (U.rt && typeof U.rt.on === "function") S.unsub = U.rt.on("fl", onFlow);
    var tick = setInterval(function () { if (!document.hidden) paintOrb(); }, 60000);
    S.timer = tick;
    paint();
    host.hidden = S.pref === "off";
    return S.pref === "off" ? Promise.resolve() : Promise.all([loadTop(), loadRec(ticker())]).then(paint);
  }

  function destroy() {
    if (S.unsub) S.unsub();
    clearInterval(S.timer);
    clearTimeout(S.toastTimer);
    clearTimeout(S.announceTimer);
    document.removeEventListener("keydown", onKey);
    setInert(false);
    host.replaceChildren();
    host.hidden = true;
  }

  var api = Object.freeze({
    mount: function (o) { return { update: paint, destroy: destroy }; },
    glance: glance,
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    state: function () { return { state: stateNow(), pref: S.pref, count: liveCount(), route: S.route, open: S.open, messages: S.msgs.slice() }; },
    ingest: onFlow
  });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { oracle: api }));

  loadCss().then(mount).then(function () {
    var t = ticker();
    var rail = document.getElementById("ftReadRail");
    if (t && rail && !rail.querySelector(".orc-glance")) {
      glance(rail, t);
      document.dispatchEvent(new CustomEvent("oracle:glance"));
    }
  });
}());
