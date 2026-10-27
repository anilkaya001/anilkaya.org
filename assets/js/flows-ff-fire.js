(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || (UI.ffFire && UI.ffFire.page)) return;
  var parts = UI.ffFire || {};
  if (!parts.composer || !parts.preview) return;

  var DASH = "—";
  var composer = parts.composer;
  var el = composer.el;

  function readRegistry() {
    var n = document.getElementById("ffxData");
    if (!n) return null;
    try { return JSON.parse(n.textContent); } catch (e) { void e; return null; }
  }

  function failure(res, body) {
    var e = body && body.error ? body.error : {};
    var err = new Error(e.message || "The request failed");
    err.code = e.code || "http_" + res.status;
    err.status = res.status;
    err.details = e.details || null;
    return err;
  }

  function fetchJson(method, path, body, headers) {
    var h = { Accept: "application/json" };
    if (body !== undefined) h["Content-Type"] = "application/json";
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
    return fetch(path, { method: method, credentials: "same-origin", headers: h, body: body === undefined ? undefined : JSON.stringify(body) }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw failure(res, data);
        return data;
      });
    }, function () {
      var err = new Error("Flows did not answer");
      err.code = "network";
      throw err;
    });
  }

  function client() {
    var k = UI.ffClient;
    return {
      get: function (path) { return k && typeof k.get === "function" ? k.get(path) : fetchJson("GET", path); },
      post: function (path, body, headers) { return k && typeof k.post === "function" ? k.post(path, body, { headers: headers || {} }) : fetchJson("POST", path, body, headers); },
      patch: function (path, body) { return fetchJson("PATCH", path, body); },
      plain: function (path) { return fetchJson("GET", path); },
    };
  }

  function uuid() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  }

  function errText(err) {
    var d = err && err.details ? err.details : {};
    var c = err && err.code;
    if (c === "ff_wire_limit") {
      var which = { armed: "the most armed wires allowed", universe: "the most universe-wide wires allowed", live: "the most live wires allowed", capacity: "no room for another wire" }[d.limit];
      return DASH + " you have " + (which || "reached a wire limit") + ". Retire a wire first.";
    }
    if (c === "ff_budget_exceeded") return DASH + " the weekly false-alarm budget is spent" + (typeof d.used === "number" && typeof d.max === "number" ? " (" + d.used + " of " + d.max + ")" : "") + ". Loosen or retire a wire.";
    if (c === "ff_off") return DASH + " Fire is unavailable" + (d.reason ? ": " + String(d.reason).replace(/_/g, " ") : "");
    if (c === "ff_version_immutable") return DASH + " this wire changed since you opened it. Reload it and adjust again.";
    if (c === "network") return DASH + " Flows did not answer. Nothing was armed. Try again.";
    if (c === "rate_limited") return DASH + " too many changes just now. Try again in a minute.";
    return DASH + " " + String((err && err.message) || "the request failed");
  }

  function workbench(o) {
    var reg = o.registry;
    var net = client();
    var model = composer.createModel(reg, UI.F);
    var pv = parts.preview.mount(o.previewHost, { client: net, id: o.id });
    var keyed = null;
    var busy = false;
    var disabled = o.disabled || null;
    var templateKey = o.templateKey || null;
    var adjust = o.wire || null;

    var arm = el("button", { type: "button", class: "ffx-btn ffx-primary", "data-k": "arm", text: adjust ? "Save new version" : "Arm wire" });
    var reset = el("button", { type: "button", class: "ffx-btn", "data-k": "reset", text: adjust ? "Discard changes" : "Start over" });
    var out = el("div", { class: "ffx-out", role: "status" });
    var comp = composer.mount(o.composerHost, {
      id: o.id, model: model, state: o.state, lockCadence: !!adjust, ctx: {},
      onChange: function (state, reasons) {
        keyed = null;
        if (templateKey && templateKey !== "custom" && !model.sameAst(model.toAst(state), model.toAst(model.fromAst(findTemplate(templateKey).ast)))) templateKey = "custom";
        out.textContent = "";
        sync(state, reasons);
        if (o.onChange) o.onChange(state, reasons);
      },
    });
    comp.acts.appendChild(arm);
    comp.acts.appendChild(reset);
    comp.acts.appendChild(out);

    function findTemplate(key) {
      for (var i = 0; i < reg.templates.length; i++) if (reg.templates[i].key === key) return reg.templates[i];
      return reg.templates[0];
    }

    function sync(state, reasons) {
      var blocked = reasons.length > 0 || busy || !!disabled;
      arm.setAttribute("aria-disabled", blocked ? "true" : "false");
      arm.title = disabled ? disabled : reasons.length ? reasons[0].text : "";
      if (reasons.length) pv.idle(reasons[0].text);
      else pv.run(model.toAst(state), templateKey && templateKey !== "custom" && templateKey !== "blank" ? findTemplate(templateKey).id : undefined);
    }

    function done(result) {
      var w = result.wire;
      out.textContent = "";
      out.setAttribute("data-state", "ok");
      out.appendChild(el("span", { class: "ffx-okline", text: (adjust ? "Saved. " : "Armed. ") + (w && w.effectiveText ? w.effectiveText + "." : "") }));
      if (w) {
        out.appendChild(el("a", { class: "ffx-link", href: "/flows/wires/?wire=" + encodeURIComponent(w.id), text: "Open the wire" }));
        out.appendChild(el("a", { class: "ffx-link", href: "/flows/inbox/", text: "Inbox" }));
      }
      if (o.onDone) o.onDone(result);
    }

    function fail(err) {
      out.textContent = "";
      out.setAttribute("data-state", "error");
      out.appendChild(el("span", { class: "ffx-errline", "data-ff-absent": err.code || "error", text: errText(err) }));
      if (err.code === "ff_off" || err.code === "unauthorized") disabled = errText(err);
    }

    arm.addEventListener("click", function () {
      var reasons = comp.reasons();
      if (arm.getAttribute("aria-disabled") === "true") {
        if (reasons.length) { out.setAttribute("data-state", "error"); out.textContent = reasons[0].text; }
        else if (disabled) { out.setAttribute("data-state", "error"); out.textContent = disabled; }
        return;
      }
      var state = comp.state();
      var ast = model.toAst(state);
      busy = true;
      arm.setAttribute("aria-disabled", "true");
      out.setAttribute("data-state", "busy");
      out.textContent = DASH + " working";
      var p;
      if (adjust) p = net.patch("/api/ff/wires", { id: adjust.id, version: adjust.version, ast: ast });
      else {
        if (!keyed) keyed = uuid();
        var body = { ast: ast, title: model.title(state) };
        if (templateKey && templateKey !== "custom" && templateKey !== "blank") body.template = findTemplate(templateKey).id;
        p = net.post("/api/ff/wires", body, { "Idempotency-Key": keyed });
      }
      p.then(function (r) { busy = false; sync(comp.state(), comp.reasons()); done(r); }, function (err) { busy = false; sync(comp.state(), comp.reasons()); fail(err); });
    });

    reset.addEventListener("click", function () {
      keyed = null;
      if (adjust) comp.set(model.fromAst(adjust.ast, adjust.template || "custom"));
      else { templateKey = "blank"; comp.set(model.blank()); }
      out.textContent = "";
      if (o.onReset) o.onReset();
    });

    net.plain("/api/flows/universe?cols=t,sec").then(function (u) {
      if (!u || u.status !== "ok" || !Array.isArray(u.t)) return;
      comp.setCtx({ symbols: new Set(u.t), sectors: new Set(Array.isArray(u.sectors) ? u.sectors : []) });
    }, function () {});

    sync(comp.state(), comp.reasons());

    return {
      model: model, comp: comp, preview: pv, client: net, arm: arm,
      load: function (key) {
        var t = findTemplate(key);
        templateKey = t.key;
        keyed = null;
        out.textContent = "";
        comp.set(model.fromAst(t.ast, t.key));
      },
      setSymbol: function (symbol) {
        var st = comp.state();
        if (st.scope.kind !== "names" || (st.scope.symbols.length && st.scope.symbols.indexOf(symbol) >= 0)) return;
        comp.set(model.setScope(st, { kind: "names", symbols: st.scope.symbols.concat([symbol]).sort() }));
      },
      disable: function (why) { disabled = why; sync(comp.state(), comp.reasons()); },
      destroy: function () { pv.destroy(); comp.destroy(); },
    };
  }

  function openFireSheet(opts) {
    opts = opts || {};
    var reg = opts.registry || readRegistry();
    if (!reg) return null;
    var id = "ffxs" + Math.floor(Math.random() * 1e6);
    var dlg = el("dialog", { class: "ffx-dlg ffx-sheet", "aria-labelledby": id + "-t", "data-ff-page": "fire" });
    var compHost = el("div", { class: "ffx-comp-host" });
    var prevHost = el("div", { class: "ffx-prev-host" });
    var close = el("button", { type: "button", class: "ffx-link", "data-close": "", text: "Close" });
    dlg.appendChild(el("div", { class: "ffx-dg ffx-sheet-g" }, [
      el("h2", { id: id + "-t", text: opts.wire ? "Adjust wire" : "Arm a wire" }),
      el("div", { class: "ffx-sheet-b" }, [el("section", { class: "ffx-sheet-c" }, [compHost]), el("section", { class: "ffx-sheet-p", "aria-label": "Right now" }, [prevHost])]),
      el("div", { class: "ffx-dx" }, [close]),
    ]));
    (document.querySelector(".flows-main") || document.body).appendChild(dlg);
    var model = composer.createModel(reg, UI.F);
    var start = opts.wire ? model.fromAst(opts.wire.ast, opts.wire.template || "custom") : opts.ast ? model.fromAst(opts.ast, opts.template || "custom") : null;
    var tpl = opts.template && reg.templates.some(function (t) { return t.key === opts.template; }) ? opts.template : null;
    if (!start && tpl) start = model.fromAst(reg.templates.filter(function (t) { return t.key === tpl; })[0].ast, tpl);
    if (!start) start = model.blank();
    if (opts.symbol && !opts.wire) start = model.setScope(start, { kind: "names", symbols: [String(opts.symbol).toUpperCase()] });
    var wb = workbench({
      id: id, registry: reg, composerHost: compHost, previewHost: prevHost, state: start, templateKey: tpl || (opts.wire ? "custom" : "blank"),
      wire: opts.wire || null, onDone: opts.onDone,
    });
    function shut() { wb.destroy(); dlg.remove(); }
    close.addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("close", shut);
    dlg.showModal();
    return { close: function () { if (dlg.open) dlg.close(); }, workbench: wb };
  }

  function initPage() {
    var root = document.getElementById("ffxFire");
    var reg = readRegistry();
    if (!root || !reg) return;
    var cap = document.getElementById("ffxCap");
    var banner = document.getElementById("ffxBanner");
    var live = document.getElementById("ffxLive");
    var tabs = [].slice.call(document.querySelectorAll("#ffxTabs [role=tab]"));
    var params = new URLSearchParams(location.search);
    var symbol = (params.get("symbol") || "").toUpperCase();
    var blank = reg.templates[0];

    var wb = workbench({
      id: "ffx", registry: reg, composerHost: document.getElementById("ffxComposer"), previewHost: document.getElementById("ffxPreview"),
      templateKey: "blank",
      onChange: function () { markTemplate(); },
      onDone: function () { loadCap(); },
      onReset: function () { markTemplate(); },
    });
    var rows = [].slice.call(document.querySelectorAll(".ffx-trow"));

    function say(text) { live.textContent = ""; setTimeout(function () { live.textContent = text; }, 30); }

    function view(v) {
      root.setAttribute("data-view", v);
      tabs.forEach(function (t) {
        var on = t.getAttribute("data-v") === v;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      requestAnimationFrame(function () { wb.comp.fit(); wb.preview.fit(); });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { view(t.getAttribute("data-v")); });
      t.addEventListener("keydown", function (e) {
        var j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
        if (j === null) return;
        e.preventDefault();
        var n = tabs[(j + tabs.length) % tabs.length];
        n.focus();
        view(n.getAttribute("data-v"));
      });
    });
    view("start");

    var picked = "blank";
    function markTemplate() {
      var st = wb.comp.state();
      var cur = null;
      reg.templates.forEach(function (t) { if (!cur && wb.model.sameAst(wb.model.toAst(st), wb.model.toAst(wb.model.fromAst(t.ast)))) cur = t.key; });
      picked = cur || "custom";
      rows.forEach(function (r) { r.setAttribute("aria-pressed", r.getAttribute("data-template") === picked ? "true" : "false"); });
    }
    rows.forEach(function (r) {
      r.addEventListener("click", function () {
        var key = r.getAttribute("data-template");
        wb.load(key);
        markTemplate();
        say("Template loaded. Edit the conditions, then arm the wire.");
        if (getComputedStyle(document.getElementById("ffxTabs")).display !== "none") { view("wire"); }
      });
    });
    markTemplate();
    if (symbol && /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) wb.setSymbol(symbol);

    function loadCap() {
      var c = wb.client;
      c.get("/api/ff/wires?status=live").then(function (r) {
        var l = r && r.limits;
        if (!l) { cap.textContent = DASH + " limits not returned"; cap.setAttribute("data-ff-absent", "missing"); return; }
        cap.removeAttribute("data-ff-absent");
        cap.textContent = l.armed.used + " of " + l.armed.max + " wires armed · " + l.live.used + " of " + l.live.max + " live · false alarms " + l.budget.used + " of " + l.budget.max + " a week";
      }, function (err) {
        cap.setAttribute("data-ff-absent", err.code || "error");
        cap.textContent = errText(err);
        if (err.code === "ff_off") {
          banner.hidden = false;
          banner.textContent = errText(err);
          wb.disable(errText(err));
        }
      });
    }
    loadCap();

    wb.client.get("/api/ff/house").then(function (r) {
      var byId = {};
      (r && r.wires || []).forEach(function (w) { byId[w.id] = w; });
      reg.templates.forEach(function (t) {
        var n = document.querySelector('[data-rate="' + t.key + '"]');
        if (!n) return;
        var w = t.house && t.house.length ? byId[t.house[0]] : null;
        if (!t.house || !t.house.length) { n.textContent = ""; n.removeAttribute("data-ff-absent"); return; }
        var ra = w && w.rarity;
        if (ra && ra.text && ra.text !== DASH) { n.textContent = "House: " + ra.text; n.removeAttribute("data-ff-absent"); }
        else { n.textContent = DASH + " " + (ra && ra.reasonText ? ra.reasonText : "no record"); n.setAttribute("data-ff-absent", ra && ra.reason ? ra.reason : "no_record"); n.title = n.textContent; }
      });
    }, function (err) {
      rows.forEach(function (r) {
        var n = r.querySelector(".ffx-trow-r");
        if (!n || !n.textContent) return;
        n.textContent = DASH + " " + (err.code === "ff_off" ? "unavailable" : "not read");
        n.setAttribute("data-ff-absent", err.code || "error");
      });
    });

    var info = document.getElementById("ffxInfo");
    document.getElementById("ffxInfoBtn").addEventListener("click", function () { info.showModal(); });
    info.addEventListener("click", function (e) { if (e.target === info || (e.target.closest && e.target.closest("[data-close]"))) info.close(); });
    void blank;
  }

  var api = { page: true, openFireSheet: openFireSheet, workbench: workbench, errText: errText };
  var prev = UI.ffFire || {};
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffFire: Object.freeze(Object.assign({}, prev, api)) }));

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initPage, { once: true });
  else initPage();
})();
