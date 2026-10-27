(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || (UI.ffFire && UI.ffFire.composer)) return;

  var DASH = "—";
  var MINUS = "−";
  var OP_TEXT = { ">=": "≥", "<=": "≤", "==": "=" };

  function compactDp(n, i) { return i === 0 ? 0 : n >= 100 ? 0 : n >= 10 ? 1 : i === 1 ? 1 : 2; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function ordinal(n) {
    var t = n % 100;
    if (t >= 11 && t <= 13) return n + "th";
    return n + (["th", "st", "nd", "rd"][n % 10] || "th");
  }
  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function round(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }

  function createModel(reg, F) {
    var units = reg.units;
    var lim = reg.limits;
    var byId = {};
    reg.metrics.forEach(function (m) { byId[m.id] = m; });
    var symbolRe = new RegExp(reg.symbolRe);

    function stepExp(unit) { return Math.round(Math.log10(units[unit].step)); }
    function gridUnits(unit) { return Math.round(units[unit].xStep / units[unit].step); }

    function scaled(x, unit) {
      if (!isNum(x) || !units[unit]) return null;
      var e = stepExp(unit);
      if (e <= 0) {
        var s = x * Math.pow(10, -e);
        var r = round(s);
        if (Math.abs(s) < 1e9 && Math.abs(s - r) < 1e-6) return r === 0 ? 0 : r;
      }
      var n = round(x / units[unit].step);
      return n === 0 ? 0 : n;
    }
    function unscaled(n, unit) { return Number.isInteger(n) ? Number(n + "e" + stepExp(unit)) : null; }

    function gridIndex(x, unit) {
      if (!isNum(x) || !units[unit]) return null;
      var g = round(Number((x / units[unit].xStep).toPrecision(12)));
      return g === 0 ? 0 : g;
    }
    function fromGrid(g, unit) { return unscaled(g * gridUnits(unit), unit); }

    function gridBounds(m) {
      var lo = Math.ceil(gridIndex(m.range[0], m.unit) - 1e-9);
      var hi = Math.floor(gridIndex(m.range[1], m.unit) + 1e-9);
      return [lo, hi];
    }
    function clampGrid(g, m) {
      var b = gridBounds(m);
      return Math.min(b[1], Math.max(b[0], g));
    }
    function snap(x, m) {
      var g = gridIndex(x, m.unit);
      return g === null ? null : fromGrid(clampGrid(g, m), m.unit);
    }
    function onGrid(x, unit) {
      var n = scaled(x, unit);
      return n !== null && unscaled(n, unit) === x && n % gridUnits(unit) === 0;
    }

    function fmt(unit, v) {
      if (!isNum(v)) return DASH;
      switch (unit) {
        case "usd": return F.scaled(v, compactDp, "$", false);
        case "contracts": return F.int(v, false);
        case "sigma": return F.px(v, 2) + "σ";
        case "vol_pt": return F.px(v, 1) + " pts";
        case "pct": return F.px(v, 1) + "%";
        case "pctile": return ordinal(Math.round(v));
        case "ratio": return F.px(v, 2);
        case "sessions": return plural(Math.round(v), "session", "sessions");
        case "days": return plural(Math.round(v), "day", "days");
        case "bool": return v ? "yes" : "no";
        default: return DASH;
      }
    }

    function plain(unit, v) {
      if (!isNum(v)) return "";
      switch (unit) {
        case "usd": case "contracts": return F.int(v, false);
        case "sigma": case "ratio": return F.px(v, 2);
        case "vol_pt": case "pct": return F.px(v, 1);
        default: return String(Math.round(v));
      }
    }

    function parse(text, unit) {
      var s = String(text === null || text === undefined ? "" : text).replace(/[\s,$%σ]/g, "").replace(/pts$/i, "").replace(/−/g, "-");
      if (!s) return null;
      var m = /^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)([kmbt]?)$/i.exec(s);
      if (!m) return null;
      var mult = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2].toLowerCase()];
      if (m[2] && unit !== "usd" && unit !== "contracts") return null;
      var v = Number(m[1]) * mult;
      return isFinite(v) ? v : null;
    }

    function clauseText(m, op, x) {
      var metric = typeof m === "string" ? byId[m] : m;
      if (!metric) return null;
      if (metric.unit === "bool" && op === "==") return (x ? "" : "not ") + metric.label;
      return metric.label + " " + (OP_TEXT[op] || op) + " " + fmt(metric.unit, x);
    }

    function subjectKind(state) {
      var subs = state.clauses.map(function (c) { return byId[c.m] && byId[c.m].subject; });
      if (subs.indexOf("window") >= 0) return "c";
      if (subs.indexOf("sector") >= 0) return "s";
      return "n";
    }

    function scopeText(scope, kind) {
      var noun = kind === "s" ? "sector" : kind === "c" ? "flagged option window" : "name";
      if (scope.kind === "universe") return kind === "c" ? "on any flagged option window in the universe" : "on any " + noun + " in the universe";
      if (scope.kind === "sector") return kind === "s" ? "in the " + scope.sector + " sector" : "on any " + noun + " in the " + scope.sector + " sector";
      var s = scope.symbols;
      return "on " + (s.length <= 4 ? s.join(", ") : s.slice(0, 3).join(", ") + " and " + (s.length - 3) + " more names");
    }

    function shortScope(scope, kind) {
      if (scope.kind === "universe") return kind === "s" ? "all sectors" : "universe";
      if (scope.kind === "sector") return scope.sector;
      var s = scope.symbols;
      return s.length <= 3 ? s.join(", ") : s.slice(0, 2).join(", ") + " +" + (s.length - 2);
    }

    function scopeOf(state) {
      var sc = state.scope;
      if (sc.kind === "names") return { kind: "names", symbols: sc.symbols.slice().sort() };
      if (sc.kind === "sector") return { kind: "sector", sector: sc.sector };
      return { kind: "universe" };
    }

    function toAst(state) {
      return {
        v: reg.astVersion,
        cadence: state.cadence,
        scope: scopeOf(state),
        all: state.clauses.map(function (c) { return { m: c.m, op: c.op, x: c.x }; }),
        persist: state.persist,
        cooldown: { unit: lim.cooldownUnit, n: state.cooldown },
      };
    }

    function sentence(state) {
      var ast = toAst(state);
      var kind = subjectKind(state);
      if (!ast.all.length || ast.all.some(function (c) { return !byId[c.m]; })) return "";
      var parts = ast.all.map(function (c) { return clauseText(c.m, c.op, c.x); });
      var hold = ast.persist > 1 ? ", held for " + ast.persist + (ast.cadence === "live" ? " looks" : " nights") : "";
      var quiet = ast.cooldown.n === 1 && ast.cadence === "live" ? "quiet for the rest of the session" : "quiet for " + plural(ast.cooldown.n, "session", "sessions");
      var tail = ", checked " + (ast.cadence === "live" ? "on every live tick" : "nightly") + hold + ", then " + quiet;
      var head = "When " + parts.join(" and ") + ", " + scopeText(ast.scope, kind);
      return (head + tail + ".").slice(0, lim.sentenceChars);
    }

    function title(state) {
      var ast = toAst(state);
      if (!ast.all.length || !byId[ast.all[0].m]) return "";
      var kind = subjectKind(state);
      var first = clauseText(ast.all[0].m, ast.all[0].op, ast.all[0].x);
      var more = ast.all.length > 1 ? " +" + (ast.all.length - 1) : "";
      return (first + more + " · " + shortScope(ast.scope, kind)).slice(0, lim.titleChars);
    }

    function cadenceLabel(c) { return c === "live" ? "every live tick" : "nightly"; }
    function cooldownLabel(state) {
      return state.cadence === "live" && state.cooldown === 1 ? "rest of session" : plural(state.cooldown, "session", "sessions");
    }
    function persistLabel(state) {
      return state.persist + (state.persist === 1 ? (state.cadence === "live" ? " look" : " night") : (state.cadence === "live" ? " looks" : " nights"));
    }
    function scopeLabel(state) {
      var sc = state.scope;
      if (sc.kind === "universe") return "the universe";
      if (sc.kind === "sector") return sc.sector ? sc.sector + " sector" : "a sector";
      return sc.symbols.length ? shortScope({ kind: "names", symbols: sc.symbols.slice().sort() }, "n") : "choose names";
    }

    function persistRange(cadence) { return cadence === "live" ? lim.persistLive : lim.persistNightly; }
    function cooldownChoices(cadence) { return lim.cooldownChoices[cadence]; }

    function blankState() {
      return fromAst({
        v: reg.astVersion, cadence: "live", scope: { kind: "names", symbols: [] }, all: [{ m: "contract.premium", op: ">=", x: 0 }],
        persist: 1, cooldown: { unit: lim.cooldownUnit, n: lim.cooldownDefault.live },
      }, "blank");
    }

    function fromAst(ast, template) {
      var sc = ast.scope || { kind: "universe" };
      return {
        template: template || "custom",
        cadence: ast.cadence,
        scope: { kind: sc.kind, symbols: sc.kind === "names" ? sc.symbols.slice() : [], sector: sc.kind === "sector" ? sc.sector : "" },
        clauses: ast.all.map(function (c) { return { m: c.m, op: c.op, x: c.x }; }),
        persist: ast.persist,
        cooldown: ast.cooldown ? ast.cooldown.n : lim.cooldownDefault[ast.cadence],
      };
    }

    function clone(state) { return JSON.parse(JSON.stringify(state)); }

    function opsFor(c) {
      var m = byId[c.m];
      if (!m) return [];
      if (m.unit === "bool") return ["=="];
      var base = [">=", "<="];
      if (c.op === "==" && m.kind !== "anomaly") base.push("==");
      return base;
    }

    function ctxOf(ctx) { return ctx || {}; }

    function reasonsFor(state, ctx) {
      ctx = ctxOf(ctx);
      var out = [];
      var add = function (code, field, detail, text) { out.push({ code: code, field: field, detail: detail || "", text: text }); };
      var sc = state.scope;
      if (sc.kind === "names") {
        var s = sc.symbols;
        if (s.length < 1) add("scope_empty", "scope", "", DASH + " choose at least one name");
        else if (s.length > lim.symbolsMax) add("grammar_invalid", "scope", "symbols", DASH + " at most " + lim.symbolsMax + " names");
        else if (s.some(function (x) { return !symbolRe.test(x); })) add("grammar_invalid", "scope", "symbols", DASH + " a name is not a valid symbol");
        else if (new Set(s).size !== s.length) add("grammar_invalid", "scope", "symbols", DASH + " a name is listed twice");
        else if (ctx.symbols) {
          var lost = s.filter(function (x) { return !ctx.symbols.has(x); });
          if (lost.length) add("symbol_outside_universe", "scope", lost.join(","), DASH + " not in the universe: " + lost.join(", ") + ". This wire cannot watch " + (lost.length === 1 ? "it" : "them") + ".");
        }
      } else if (sc.kind === "sector") {
        if (typeof sc.sector !== "string" || !sc.sector.length || sc.sector.length > 40) add("scope_empty", "scope", "", DASH + " choose a sector");
        else if (ctx.sectors && !ctx.sectors.has(sc.sector)) add("grammar_invalid", "scope", "unknown sector", DASH + " not a sector in the universe: " + sc.sector);
      } else if (sc.kind !== "universe") add("grammar_invalid", "scope", "scope kind", DASH + " unknown scope");
      var n = state.clauses.length;
      if (n < lim.clausesMin || n > lim.clausesMax) add("grammar_invalid", "clauses", "clause count", DASH + " a wire has 1 to " + lim.clausesMax + " conditions");
      var per = {};
      var subs = {};
      var anomaly = false;
      var keys = {};
      state.clauses.forEach(function (c, i) {
        var m = byId[c.m];
        if (!m) { add("grammar_invalid", "clause:" + i, "metric " + c.m, DASH + " unknown quantity"); return; }
        if (m.cadence.indexOf(state.cadence) < 0) add("metric_unavailable", "clause:" + i, c.m, DASH + " " + m.label + " is not available on a " + (state.cadence === "live" ? "live" : "nightly") + " wire");
        if (opsFor(c).indexOf(c.op) < 0) add("grammar_invalid", "clause:" + i, "operator", DASH + " operator not allowed here");
        if (!isNum(c.x) || c.x < m.range[0] || c.x > m.range[1]) add("grammar_invalid", "clause:" + i, "threshold " + c.m, DASH + " outside the range of " + m.label);
        else if (!onGrid(c.x, m.unit)) add("grammar_precision", "clause:" + i, c.m, DASH + " finer than " + m.label + " allows");
        per[c.m] = (per[c.m] || 0) + 1;
        subs[m.subject] = true;
        if (m.kind === "anomaly") anomaly = true;
        if (state.cadence === "live" && m.liveKey) keys[m.liveKey] = true;
      });
      Object.keys(per).forEach(function (k) {
        if (per[k] > lim.clausesPerMetric) add("grammar_invalid", "clauses", "clauses per metric", DASH + " at most " + lim.clausesPerMetric + " conditions on " + byId[k].label);
      });
      if (subs.sector && Object.keys(subs).length > 1) add("grammar_invalid", "clauses", "sector mixed", DASH + " a sector quantity cannot sit beside a name or window quantity");
      if (subs.sector && sc.kind === "names") add("grammar_invalid", "scope", "sector metric on names", DASH + " a sector quantity cannot watch named stocks");
      if (state.cadence === "live" && (anomaly || Object.keys(keys).length > 1)) add("grammar_invalid", "clauses", "live source", DASH + " a live wire reads one source, so it cannot mix these quantities");
      var pr = persistRange(state.cadence);
      if (!Number.isInteger(state.persist) || state.persist < pr[0] || state.persist > pr[1]) add("grammar_invalid", "persist", "persist", DASH + " hold must be " + pr[0] + " to " + pr[1]);
      if (cooldownChoices(state.cadence).indexOf(state.cooldown) < 0) add("grammar_invalid", "cooldown", "cooldown", DASH + " quiet period not allowed here");
      return out;
    }

    function usable(state, metricId, replacing) {
      var m = byId[metricId];
      if (!m) return { ok: false, reason: DASH + " unknown quantity" };
      if (m.cadence.indexOf(state.cadence) < 0) return { ok: false, reason: DASH + " " + (m.cadence[0] === "nightly" ? "nightly only" : "live only") };
      var others = state.clauses.filter(function (c, i) { return i !== replacing; });
      if (replacing === undefined && others.length >= lim.clausesMax) return { ok: false, reason: DASH + " at most " + lim.clausesMax + " conditions" };
      if (others.filter(function (c) { return c.m === metricId; }).length >= lim.clausesPerMetric) return { ok: false, reason: DASH + " already used twice" };
      var subs = others.map(function (c) { return byId[c.m] && byId[c.m].subject; });
      if (m.subject === "sector" && subs.some(function (s) { return s !== "sector"; })) return { ok: false, reason: DASH + " a sector quantity stands alone" };
      if (m.subject !== "sector" && subs.indexOf("sector") >= 0) return { ok: false, reason: DASH + " the other conditions are about sectors" };
      if (m.subject === "sector" && state.scope.kind === "names") return { ok: false, reason: DASH + " a sector quantity cannot watch named stocks" };
      if (state.cadence === "live") {
        var keys = others.map(function (c) { return byId[c.m] && byId[c.m].liveKey; }).filter(Boolean);
        if (keys.length && m.liveKey && keys.some(function (k) { return k !== m.liveKey; })) return { ok: false, reason: DASH + " a live wire reads one source" };
      }
      return { ok: true, reason: null };
    }

    function cadenceAllowed(state, cadence) {
      if (cadence === state.cadence) return { ok: true, reason: null };
      for (var i = 0; i < state.clauses.length; i++) {
        var m = byId[state.clauses[i].m];
        if (m && m.cadence.indexOf(cadence) < 0) return { ok: false, reason: DASH + " " + m.label + " is " + (cadence === "live" ? "nightly only" : "live only") };
      }
      if (cadence === "live") {
        var keys = {};
        state.clauses.forEach(function (c) { var m = byId[c.m]; if (m && m.liveKey) keys[m.liveKey] = true; });
        if (Object.keys(keys).length > 1) return { ok: false, reason: DASH + " a live wire reads one source" };
      }
      return { ok: true, reason: null };
    }

    function scopeAllowed(state, kind) {
      if (kind === "names" && state.clauses.some(function (c) { return byId[c.m] && byId[c.m].subject === "sector"; })) return { ok: false, reason: DASH + " a sector quantity cannot watch named stocks" };
      return { ok: true, reason: null };
    }

    function nudge(state, i, dir, mult) {
      var c = state.clauses[i];
      var m = c && byId[c.m];
      if (!m || m.unit === "bool") return state;
      var g = gridIndex(c.x, m.unit);
      if (g === null) return state;
      var next = clampGrid(g + dir * (mult || 1), m);
      var out = clone(state);
      out.clauses[i].x = fromGrid(next, m.unit);
      return out;
    }

    function jump(state, i, which) {
      var c = state.clauses[i];
      var m = c && byId[c.m];
      if (!m || m.unit === "bool") return state;
      var b = gridBounds(m);
      var out = clone(state);
      out.clauses[i].x = fromGrid(which === "min" ? b[0] : b[1], m.unit);
      return out;
    }

    function setValue(state, i, x) {
      var c = state.clauses[i];
      var m = c && byId[c.m];
      if (!m || !isNum(x)) return state;
      var s = snap(x, m);
      if (s === null) return state;
      var out = clone(state);
      out.clauses[i].x = s;
      return out;
    }

    function setBool(state, i, on) {
      var out = clone(state);
      out.clauses[i].x = on ? 1 : 0;
      out.clauses[i].op = "==";
      return out;
    }

    function setOp(state, i, op) {
      if (opsFor(state.clauses[i]).indexOf(op) < 0) return state;
      var out = clone(state);
      out.clauses[i].op = op;
      return out;
    }

    function defaultClause(metricId) {
      var m = byId[metricId];
      if (m.unit === "bool") return { m: m.id, op: "==", x: 1 };
      var x = snap(Math.min(Math.max(0, m.range[0]), m.range[1]), m);
      return { m: m.id, op: ">=", x: x };
    }

    function swapMetric(state, i, metricId) {
      if (!usable(state, metricId, i).ok) return state;
      var out = clone(state);
      out.clauses[i] = defaultClause(metricId);
      return out;
    }

    function addClause(state, metricId) {
      if (!usable(state, metricId).ok) return state;
      var out = clone(state);
      out.clauses.push(defaultClause(metricId));
      return out;
    }

    function removeClause(state, i) {
      if (state.clauses.length <= lim.clausesMin) return state;
      var out = clone(state);
      out.clauses.splice(i, 1);
      return out;
    }

    function setCadence(state, cadence) {
      if (!cadenceAllowed(state, cadence).ok || cadence === state.cadence) return state;
      var out = clone(state);
      out.cadence = cadence;
      var pr = persistRange(cadence);
      out.persist = Math.min(pr[1], Math.max(pr[0], out.persist));
      if (cooldownChoices(cadence).indexOf(out.cooldown) < 0) out.cooldown = lim.cooldownDefault[cadence];
      return out;
    }

    function setScope(state, scope) {
      if (!scopeAllowed(state, scope.kind).ok) return state;
      var out = clone(state);
      out.scope = {
        kind: scope.kind,
        symbols: scope.kind === "names" ? (scope.symbols || []).slice() : [],
        sector: scope.kind === "sector" ? scope.sector || "" : "",
      };
      return out;
    }

    function setPersist(state, n) {
      var pr = persistRange(state.cadence);
      var out = clone(state);
      out.persist = Math.min(pr[1], Math.max(pr[0], n));
      return out;
    }

    function stepPersist(state, dir) { return setPersist(state, state.persist + dir); }

    function setCooldown(state, n) {
      if (cooldownChoices(state.cadence).indexOf(n) < 0) return state;
      var out = clone(state);
      out.cooldown = n;
      return out;
    }

    function stepCooldown(state, dir) {
      var ch = cooldownChoices(state.cadence);
      var i = ch.indexOf(state.cooldown);
      var j = Math.min(ch.length - 1, Math.max(0, i + dir));
      return setCooldown(state, ch[j]);
    }

    function parseNames(text) {
      var seen = {};
      var out = [];
      String(text || "").toUpperCase().split(/[\s,;]+/).forEach(function (t) {
        if (!t || seen[t]) return;
        seen[t] = true;
        out.push(t);
      });
      return out.sort();
    }

    function sameAst(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

    return Object.freeze({
      reg: reg, byId: byId, fmt: fmt, plain: plain, parse: parse, scaled: scaled, unscaled: unscaled, gridIndex: gridIndex, fromGrid: fromGrid,
      gridBounds: gridBounds, snap: snap, onGrid: onGrid, clauseText: clauseText, subjectKind: subjectKind, toAst: toAst, fromAst: fromAst,
      blank: blankState, sentence: sentence, title: title, reasons: reasonsFor, usable: usable, cadenceAllowed: cadenceAllowed, scopeAllowed: scopeAllowed,
      nudge: nudge, jump: jump, setValue: setValue, setBool: setBool, setOp: setOp, swapMetric: swapMetric, addClause: addClause, removeClause: removeClause,
      setCadence: setCadence, setScope: setScope, setPersist: setPersist, stepPersist: stepPersist, setCooldown: setCooldown, stepCooldown: stepCooldown,
      opsFor: opsFor, parseNames: parseNames, cadenceLabel: cadenceLabel, cooldownLabel: cooldownLabel, persistLabel: persistLabel, scopeLabel: scopeLabel,
      persistRange: persistRange, cooldownChoices: cooldownChoices, defaultClause: defaultClause, sameAst: sameAst, clone: clone, opText: OP_TEXT,
    });
  }

  var UNIT_TAG = { usd: "$", contracts: "contracts", sigma: "σ", vol_pt: "pts", pct: "%", pctile: "pctile", ratio: "ratio", sessions: "sessions", days: "days", bool: "" };

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

  function mount(host, o) {
    var model = o.model;
    var reg = model.reg;
    var state = o.state ? model.clone(o.state) : model.blank();
    var ctx = o.ctx || {};
    var onChange = o.onChange || function () {};
    var lockCadence = !!o.lockCadence;
    var byDomain = reg.domains;

    var cadSeg = el("div", { class: "ffx-seg", role: "group", "aria-label": "How often it is checked" });
    var cadBtns = {};
    ["live", "nightly"].forEach(function (c) {
      var b = el("button", { type: "button", "data-k": "cad-" + c, "data-cad": c, text: c === "live" ? "Live" : "Nightly" });
      cadBtns[c] = b;
      cadSeg.appendChild(b);
    });
    var cadNote = el("span", { class: "ffx-note", id: o.id + "-cadnote" });
    var list = el("ol", { class: "ffx-list", "aria-label": "Conditions" });
    var more = el("button", { type: "button", class: "ffx-link ffx-more", "data-k": "more", hidden: true, "aria-haspopup": "dialog" });
    var addSel = el("select", { class: "ffx-sel ffx-add", "data-k": "add", "aria-label": "Add a condition" });
    var condN = el("span", { class: "ffx-ph-n" });
    var scopeSeg = el("div", { class: "ffx-seg", role: "group", "aria-label": "What it watches" });
    var scopeBtns = {};
    [["names", "Names"], ["sector", "Sector"], ["universe", "Universe"]].forEach(function (p) {
      var b = el("button", { type: "button", "data-k": "scope-" + p[0], "data-scope": p[0], text: p[1] });
      scopeBtns[p[0]] = b;
      scopeSeg.appendChild(b);
    });
    var namesIn = el("input", { type: "text", class: "ffx-in ffx-names", "data-k": "names", "aria-label": "Names to watch, separated by commas", placeholder: "AAPL, MSFT", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" });
    var sectorIn = el("select", { class: "ffx-sel ffx-sector", "data-k": "sector", "aria-label": "Sector" });
    var sectorText = el("input", { type: "text", class: "ffx-in ffx-sector-t", "data-k": "sectort", "aria-label": "Sector name", placeholder: "Sector name", autocomplete: "off" });
    var scopeWrap = el("div", { class: "ffx-scopein" }, [namesIn, sectorIn, sectorText]);
    var pDec = el("button", { type: "button", class: "ffx-st", "data-k": "p-dec", "aria-label": "Hold for fewer checks", text: MINUS });
    var pInc = el("button", { type: "button", class: "ffx-st", "data-k": "p-inc", "aria-label": "Hold for more checks", text: "+" });
    var pVal = el("output", { class: "ffx-pv", "aria-live": "polite" });
    var coolSel = el("select", { class: "ffx-sel ffx-cool", "data-k": "cool", "aria-label": "Quiet period after a hit" });
    var sentence = el("p", { class: "ffx-sentence", id: o.id + "-sentence" });
    var why = el("p", { class: "ffx-why", id: o.id + "-why" });
    var acts = el("div", { class: "ffx-acts" });

    var root = el("div", { class: "ffx-c" }, [
      el("div", { class: "ffx-row ffx-cadrow" }, [el("span", { class: "ffx-lbl", text: "Checked" }), cadSeg, cadNote]),
      el("div", { class: "ffx-conds" }, [
        el("div", { class: "ffx-sub" }, [el("span", { text: "Conditions" }), condN]),
        list,
        el("div", { class: "ffx-addrow" }, [addSel, more]),
      ]),
      el("div", { class: "ffx-row ffx-scoperow" }, [el("span", { class: "ffx-lbl", text: "Watches" }), scopeSeg, scopeWrap]),
      el("div", { class: "ffx-row ffx-optrow" }, [
        el("span", { class: "ffx-lbl", text: "Hold" }), el("div", { class: "ffx-stp" }, [pDec, pVal, pInc]),
        el("span", { class: "ffx-lbl", text: "Then quiet for" }), coolSel,
      ]),
      sentence, why, acts,
    ]);
    host.textContent = "";
    host.appendChild(root);

    var dlg = el("dialog", { class: "ffx-dlg ffx-dlg-cond", "aria-labelledby": o.id + "-dt" });
    var dlist = el("ol", { class: "ffx-list ffx-list-all", "aria-label": "All conditions" });
    var dadd = el("select", { class: "ffx-sel ffx-add", "data-k": "dadd", "aria-label": "Add a condition" });
    var dclose = el("button", { type: "button", class: "ffx-link", "data-close": "", text: "Done" });
    dlg.appendChild(el("div", { class: "ffx-dg" }, [el("h2", { id: o.id + "-dt", text: "All conditions" }), dlist, el("div", { class: "ffx-addrow" }, [dadd]), el("div", { class: "ffx-dx" }, [dclose])]));
    (host.closest(".flows-main") || host.closest(".ffx") || document.body).appendChild(dlg);
    dclose.addEventListener("click", function () { dlg.close(); });

    function metricOption(m, i, replacing) {
      var u = model.usable(state, m.id, replacing);
      var cur = i !== undefined && state.clauses[i] && state.clauses[i].m === m.id;
      var label = m.label + (m.status === "limited" ? " (limited)" : "") + (!u.ok && !cur ? " " + u.reason : "");
      return el("option", { value: m.id, disabled: !u.ok && !cur, text: label, selected: cur });
    }

    function metricGroups(sel, i, replacing, placeholder) {
      sel.textContent = "";
      if (placeholder) sel.appendChild(el("option", { value: "", text: placeholder, selected: true }));
      byDomain.forEach(function (d) {
        var ms = reg.metrics.filter(function (m) { return m.domain === d.id; });
        if (!ms.length) return;
        var g = el("optgroup", { label: d.label });
        ms.forEach(function (m) { g.appendChild(metricOption(m, i, replacing)); });
        sel.appendChild(g);
      });
    }

    function clauseRow(c, i, cut) {
      var m = model.byId[c.m];
      var li = el("li", { class: "ffx-cl", "data-i": String(i) });
      var msel = el("select", { class: "ffx-sel ffx-m", "data-k": "m" + i, "data-i": String(i), "aria-label": "Quantity, condition " + (i + 1) });
      metricGroups(msel, i, i);
      msel.value = c.m;
      li.appendChild(msel);
      if (m.unit === "bool") {
        li.appendChild(el("button", { type: "button", class: "ffx-bool", "data-k": "bool" + i, "data-i": String(i), "aria-pressed": c.x ? "true" : "false", text: c.x ? "yes" : "no" }));
      } else {
        var ops = model.opsFor(c);
        var osel = el("select", { class: "ffx-sel ffx-op", "data-k": "op" + i, "data-i": String(i), "aria-label": "Relation, condition " + (i + 1) });
        ops.forEach(function (op) { osel.appendChild(el("option", { value: op, text: OP_TEXT[op], selected: op === c.op })); });
        osel.value = c.op;
        var xin = el("input", { type: "text", class: "ffx-in ffx-x", inputmode: "decimal", "data-k": "x" + i, "data-i": String(i), "aria-label": "Threshold, condition " + (i + 1), value: model.plain(m.unit, c.x), title: model.fmt(m.unit, c.x), autocomplete: "off" });
        var tag = UNIT_TAG[m.unit];
        li.appendChild(osel);
        li.appendChild(el("div", { class: "ffx-val" }, [
          el("button", { type: "button", class: "ffx-st", "data-k": "dec" + i, "data-i": String(i), "data-a": "dec", "aria-label": "Lower threshold, condition " + (i + 1), text: MINUS }),
          xin,
          el("button", { type: "button", class: "ffx-st", "data-k": "inc" + i, "data-i": String(i), "data-a": "inc", "aria-label": "Raise threshold, condition " + (i + 1), text: "+" }),
          tag ? el("span", { class: "ffx-unit", text: tag }) : null,
        ]));
      }
      li.appendChild(el("button", { type: "button", class: "ffx-rm", "data-k": "rm" + i, "data-i": String(i), "data-a": "rm", "aria-label": "Remove condition " + (i + 1), disabled: state.clauses.length <= reg.limits.clausesMin, text: "×" }));
      return li;
    }

    function fit() {
      var rows = [].slice.call(list.children);
      rows.forEach(function (r) { r.classList.remove("cut"); });
      if (!list.offsetParent && !list.getClientRects().length) return;
      var cut = 0;
      for (var i = rows.length - 1; i >= Math.min(1, rows.length); i--) {
        if (list.scrollHeight <= list.clientHeight + 1) break;
        rows[i].classList.add("cut");
        cut++;
      }
      more.hidden = cut === 0 && !dlg.open;
      more.textContent = cut === 0 ? "" : "+" + cut + " more · edit all";
      root.setAttribute("data-cut", String(cut));
    }

    var focusKey = null;
    function remember() {
      var a = document.activeElement;
      focusKey = a && (root.contains(a) || dlg.contains(a)) && a.getAttribute("data-k") ? { k: a.getAttribute("data-k"), inDlg: dlg.contains(a), s: a.selectionStart, e: a.selectionEnd } : null;
    }
    function restore() {
      if (!focusKey) return;
      var scope = focusKey.inDlg ? dlg : root;
      var n = scope.querySelector('[data-k="' + focusKey.k + '"]');
      if (n && !n.disabled) { n.focus(); if (focusKey.s !== undefined && focusKey.s !== null && n.setSelectionRange && n.type === "text") { try { n.setSelectionRange(focusKey.s, focusKey.e); } catch (e) { void e; } } }
      focusKey = null;
    }

    function cooldownText(n) { return state.cadence === "live" && n === 1 ? "the rest of the session" : plural(n, "session", "sessions"); }

    function render() {
      remember();
      var reasons = model.reasons(state, ctx);
      Object.keys(cadBtns).forEach(function (c) {
        var ok = model.cadenceAllowed(state, c);
        var b = cadBtns[c];
        b.setAttribute("aria-pressed", state.cadence === c ? "true" : "false");
        var blocked = (!ok.ok || lockCadence) && state.cadence !== c;
        b.setAttribute("aria-disabled", blocked ? "true" : "false");
        b.title = blocked ? (lockCadence ? DASH + " a wire cannot change how often it is checked" : ok.reason) : "";
      });
      cadNote.textContent = state.cadence === "live" ? "On every live tick, 5 or 15 minutes apart" : "Once, after the close";
      list.textContent = "";
      dlist.textContent = "";
      state.clauses.forEach(function (c, i) { list.appendChild(clauseRow(c, i)); dlist.appendChild(clauseRow(c, i)); });
      var full = state.clauses.length >= reg.limits.clausesMax;
      [addSel, dadd].forEach(function (s) {
        metricGroups(s, undefined, undefined, full ? DASH + " at most " + reg.limits.clausesMax + " conditions" : "Add a condition");
        s.disabled = full;
      });
      condN.textContent = state.clauses.length + " of " + reg.limits.clausesMax;
      Object.keys(scopeBtns).forEach(function (k) {
        var b = scopeBtns[k];
        var ok = model.scopeAllowed(state, k);
        b.setAttribute("aria-pressed", state.scope.kind === k ? "true" : "false");
        b.setAttribute("aria-disabled", !ok.ok && state.scope.kind !== k ? "true" : "false");
        b.title = !ok.ok ? ok.reason : "";
      });
      namesIn.hidden = state.scope.kind !== "names";
      var haveSectors = ctx.sectors && ctx.sectors.size;
      sectorIn.hidden = state.scope.kind !== "sector" || !haveSectors;
      sectorText.hidden = state.scope.kind !== "sector" || !!haveSectors;
      if (document.activeElement !== namesIn) namesIn.value = state.scope.symbols.join(", ");
      if (haveSectors) {
        sectorIn.textContent = "";
        sectorIn.appendChild(el("option", { value: "", text: "Choose a sector" }));
        Array.from(ctx.sectors).sort().forEach(function (s) { sectorIn.appendChild(el("option", { value: s, text: s })); });
        sectorIn.value = state.scope.sector || "";
      } else if (document.activeElement !== sectorText) sectorText.value = state.scope.sector || "";
      var pr = model.persistRange(state.cadence);
      pVal.textContent = model.persistLabel(state);
      pDec.setAttribute("aria-disabled", state.persist <= pr[0] ? "true" : "false");
      pInc.setAttribute("aria-disabled", state.persist >= pr[1] ? "true" : "false");
      coolSel.textContent = "";
      model.cooldownChoices(state.cadence).forEach(function (n) { coolSel.appendChild(el("option", { value: String(n), text: cooldownText(n), selected: n === state.cooldown })); });
      coolSel.value = String(state.cooldown);
      var text = model.sentence(state);
      sentence.textContent = reasons.length ? "" : text;
      if (reasons.length) sentence.removeAttribute("title"); else sentence.title = text;
      sentence.setAttribute("data-empty", reasons.length ? "true" : "false");
      if (reasons.length) {
        why.textContent = reasons[0].text + (reasons.length > 1 ? " (+" + (reasons.length - 1) + " more)" : "");
        why.title = reasons.map(function (r) { return r.text; }).join("\n");
        why.setAttribute("data-ff-absent", reasons[0].code);
      } else {
        why.textContent = "";
        why.removeAttribute("title");
        why.removeAttribute("data-ff-absent");
      }
      restore();
      fit();
      root.__reasons = reasons;
    }

    function commit(next, silent) {
      if (!next || next === state) { render(); return; }
      state = next;
      render();
      if (!silent) onChange(state, root.__reasons);
    }

    function handle(e) {
      var t = e.target;
      var i = t.getAttribute && t.getAttribute("data-i") !== null ? Number(t.getAttribute("data-i")) : null;
      var k = t.getAttribute ? t.getAttribute("data-k") : null;
      var a = t.closest ? t.closest("[data-a]") : null;
      if (e.type === "click") {
        var btn = t.closest("button");
        if (!btn) return;
        if (btn === more) { dlg.showModal(); fit(); return; }
        var ak = btn.getAttribute("data-a");
        var bi = Number(btn.getAttribute("data-i"));
        if (ak === "dec") commit(model.nudge(state, bi, -1, e.shiftKey ? 10 : 1));
        else if (ak === "inc") commit(model.nudge(state, bi, 1, e.shiftKey ? 10 : 1));
        else if (ak === "rm") commit(model.removeClause(state, bi));
        else if (btn.classList.contains("ffx-bool")) commit(model.setBool(state, bi, !state.clauses[bi].x));
        else if (btn.getAttribute("data-cad")) {
          if (btn.getAttribute("aria-disabled") === "true" || lockCadence) return;
          commit(model.setCadence(state, btn.getAttribute("data-cad")));
        } else if (btn.getAttribute("data-scope")) {
          if (btn.getAttribute("aria-disabled") === "true") return;
          commit(model.setScope(state, { kind: btn.getAttribute("data-scope"), symbols: state.scope.symbols, sector: state.scope.sector }));
        } else if (btn === pDec) commit(model.stepPersist(state, -1));
        else if (btn === pInc) commit(model.stepPersist(state, 1));
        return;
      }
      if (e.type === "change") {
        if (k === "add" || k === "dadd") { if (t.value) commit(model.addClause(state, t.value)); return; }
        if (i === null && k === "cool") { commit(model.setCooldown(state, Number(t.value))); return; }
        if (k === "names") { commit(model.setScope(state, { kind: "names", symbols: model.parseNames(t.value) })); return; }
        if (k === "sector" || k === "sectort") { commit(model.setScope(state, { kind: "sector", sector: t.value.trim() })); return; }
        if (i === null) return;
        if (k === "m" + i) commit(model.swapMetric(state, i, t.value));
        else if (k === "op" + i) commit(model.setOp(state, i, t.value));
        else if (k === "x" + i) {
          var c = state.clauses[i];
          var v = model.parse(t.value, model.byId[c.m].unit);
          if (v === null) { t.setAttribute("aria-invalid", "true"); t.value = model.plain(model.byId[c.m].unit, c.x); render(); return; }
          commit(model.setValue(state, i, v));
        }
        return;
      }
      if (e.type === "keydown" && k && /^x\d+$/.test(k) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        commit(model.nudge(state, i, e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : 1));
      }
      void a;
    }
    [root, dlg].forEach(function (n) { ["click", "change", "keydown"].forEach(function (ev) { n.addEventListener(ev, handle); }); });
    [namesIn].forEach(function (n) { n.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); n.blur(); } }); });

    if (typeof ResizeObserver === "function") new ResizeObserver(function () { fit(); }).observe(list);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

    render();
    return {
      root: root, acts: acts, state: function () { return model.clone(state); }, reasons: function () { return root.__reasons; },
      set: function (next, silent) { state = model.clone(next); render(); if (!silent) onChange(state, root.__reasons); },
      setCtx: function (c) { ctx = c || {}; render(); onChange(state, root.__reasons); },
      fit: fit, destroy: function () { dlg.remove(); host.textContent = ""; },
    };
  }

  var composer = { createModel: createModel, mount: mount, el: el, DASH: DASH, MINUS: MINUS };
  var prev = UI.ffFire || {};
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffFire: Object.freeze(Object.assign({}, prev, { composer: Object.freeze(composer) })) }));
})();
