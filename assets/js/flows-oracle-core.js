(function () {
  "use strict";

  var MINUS = "−", DASH = "—";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MIN = 60000;
  var CONVICTION_WORDS = Object.freeze(["No view", "Faint", "Leaning", "Clear"]);
  var MODEL_IMPLIED = "Model-implied, not a quote and not advice. Based on the engine's fitted prices and its own model of returns, under the stated assumptions. No track record yet.";
  var CONVENTION = "by the site's convention";
  var CONVENTION_NOTE = "Calls on the ask side and puts on the bid side are read as bullish, the reverse as bearish.";
  var STANCE_LINES = Object.freeze({
    up: Object.freeze(["No view on direction yet.", "A faint lean up. Prices sit a little above the model's middle.", "Leaning up. Options pricing and flow point the same way.", "A clear lean up. Pricing, flow and dealer positioning agree."]),
    down: Object.freeze(["No view on direction yet.", "A faint lean down. Prices sit a little below the model's middle.", "Leaning down. Options pricing and flow point the same way.", "A clear lean down. Pricing, flow and dealer positioning agree."]),
    mixed: Object.freeze(["No view on direction yet.", "The readings disagree. The model holds no view.", "The readings disagree, so the model keeps its view small.", "Two strong readings disagree. The model names both and takes no side."]),
    none: Object.freeze(["No view yet. The model has too little to go on.", "No view yet. The model has too little to go on.", "No view yet. The model has too little to go on.", "No view yet. The model has too little to go on."])
  });
  var LEAN_GLYPH = Object.freeze({ up: "▲", down: "▼", mixed: "◆", none: "–" });
  var LEAN_WORD = Object.freeze({ up: "Up", down: "Down", mixed: "Mixed", none: "No view" });
  var LEAN_SIGN = Object.freeze({ "-1": "bearish", "0": "mixed", "1": "bullish" });
  var CP_WORD = Object.freeze({ C: "call", P: "put", call: "call", put: "put", CALL: "call", PUT: "put" });
  var VERDICT_WORD = Object.freeze({ cheap: "cheap", rich: "rich" });
  var EDGE_WORD = Object.freeze({ cheap: "under", rich: "over" });
  var KIND_ORDER = Object.freeze(["surge", "repeat", "flip", "cluster", "sweeps", "size", "sector"]);

  var T = Object.freeze({
    windowMin: 30, repeatMin: 20, sweepMin: 10, warmMin: 20, minWindows: 5, cooldownMin: 30, cap: 6,
    surgeMult: 3, surgeFloor: 500000, surgeN: 3, repeatN: 3, repeatMult: 2, repeatFloor: 250000,
    flipSided: 400000, flipAbs: 0.4, flipEarlierMin: 45, coverage: 0.5,
    clusterShare: 0.6, clusterFloor: 300000, sweepN: 4, sweepAsk: 65, sweepFloor: 300000,
    sizeMult: 5, sizeFloor: 500, sizePrem: 250000, sectorN: 4, sectorFloor: 5000000, eventMult: 1.5
  });

  var NEG = Object.freeze({ "-1": MINUS, "0": "", "1": "" });
  var SIGNED = Object.freeze({ "-1": MINUS, "0": "", "1": "+" });
  function fin(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function two(n) { return (n < 10 ? "0" : "") + n; }

  function money(v) {
    var x = fin(v);
    if (x === null) return DASH;
    var a = Math.abs(x), s = NEG[Math.sign(x)];
    if (a >= 999.95e6) return s + "$" + (a / 1e9).toFixed(1) + "B";
    if (a >= 999.5e3) return s + "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 999.5) return s + "$" + Math.round(a / 1e3) + "K";
    return s + "$" + Math.round(a);
  }
  function cents(v) {
    var x = fin(v);
    if (x === null) return DASH;
    return NEG[Math.sign(x)] + "$" + Math.abs(x).toFixed(2);
  }
  function whole(v) {
    var x = fin(v);
    if (x === null) return DASH;
    var r = Math.round(x);
    return NEG[Math.sign(r)] + "$" + Math.abs(r).toLocaleString("en-US");
  }
  function signedWhole(v) {
    var x = fin(v);
    if (x === null) return DASH;
    var r = Math.round(x);
    return SIGNED[Math.sign(r)] + "$" + Math.abs(r).toLocaleString("en-US");
  }
  function pct0(v) {
    var x = fin(v);
    return x === null ? DASH : Math.round(x * 100) + "%";
  }
  function vol1(v) {
    var x = fin(v);
    return x === null ? DASH : (x * 100).toFixed(1);
  }
  function expiryText(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return DASH;
    return MON[+iso.slice(5, 7) - 1] + " " + +iso.slice(8, 10);
  }
  function strikeText(k) {
    var x = fin(k);
    if (x === null) return DASH;
    return Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : String(+x.toFixed(2));
  }
  function times(v) {
    var x = fin(v);
    return x === null ? DASH : (x >= 10 ? String(Math.round(x)) : x.toFixed(1)) + "×";
  }
  function trt(ms) {
    var x = fin(ms);
    if (x === null) return DASH;
    var d = new Date(x + 3 * 3600000);
    return two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()) + " TRT";
  }

  function cpWord(v) { return CP_WORD[v] || null; }

  function callSay(call) {
    if (!call || typeof call !== "object") return null;
    var side = cpWord(call.side);
    var verdict = VERDICT_WORD[call.verdict];
    if (!side || !verdict) return null;
    var mi = fin(call.marketIv), fi = fin(call.fairIv);
    var pts = mi !== null && fi !== null ? Math.abs(mi - fi) * 100 : null;
    var edge = fin(call.edgeUsd);
    var head = "The " + strikeText(call.strike) + " " + side + " for " + expiryText(call.expiry) + " looks " + verdict + ".";
    var why = "The market prices it at " + vol1(mi) + " vol; the model's fair level is " + vol1(fi) + ". That is " +
      (pts === null ? DASH : pts.toFixed(1)) + " vol points " + EDGE_WORD[call.verdict] + ", worth about " + (edge === null ? DASH : whole(Math.abs(edge))) + " a contract.";
    var ev = fin(call.ev), pop = fin(call.pop);
    var gain;
    if (call.action === "collect") {
      var loss = fin(call.maxLoss) === null ? "A loss can grow past what the position collects." : "A loss is capped at " + whole(Math.abs(call.maxLoss)) + ".";
      gain = "Selling it collects about " + cents(call.mid) + ". The model puts the average result at " + signedWhole(ev) + " a contract. It puts the chance of keeping the credit at " +
        (pop === null ? DASH : Math.round(pop * 100) + "%") + ". " + loss;
    } else {
      gain = "Held to expiry the model puts the average result at " + signedWhole(ev) + " a contract, with " +
        (pop === null ? DASH : "a " + Math.round(pop * 100) + "%") + " chance of a profit. Break-even is " + cents(call.breakeven) + ".";
    }
    return { head: head, why: why, gain: gain };
  }

  var LIVE = {
    surge: function (m) {
      return m.ticker + " has " + money(m.prem) + " of flagged options flow across " + m.n + " windows in the last " + m.minutes +
        " minutes. The bar for this name is " + money(m.bar) + "." + (m.event ? " A report is " + m.sessions + " sessions away." : "");
    },
    repeat: function (m) {
      return "Flow keeps returning to the " + strikeText(m.strike) + " " + m.side + " for " + expiryText(m.expiry) + ": " + m.n + " flagged windows in " + m.minutes + " minutes, " + money(m.prem) + " in all." +
        (m.event ? " A report is " + m.sessions + " sessions away." : "");
    },
    flip: function (m) {
      return m.ticker + " flow has turned " + m.now + " in the last " + m.minutes + " minutes, " + CONVENTION + ". " + CONVENTION_NOTE + " The lean is " + SIGNED[Math.sign(Math.round(m.l * 100))] + Math.abs(Math.round(m.l * 100)) +
        " of 100, after leaning " + m.before + " earlier (" + SIGNED[Math.sign(Math.round(m.earlier * 100))] + Math.abs(Math.round(m.earlier * 100)) + ").";
    },
    cluster: function (m) {
      return "Most of " + m.ticker + "'s flow is landing in the " + expiryText(m.expiry) + " expiry: " + Math.round(m.share * 100) + "% of " + money(m.prem) + ".";
    },
    sweeps: function (m) {
      return m.ticker + " has " + m.n + " fast, multi-exchange windows in " + m.minutes + " minutes, mostly on the ask side. " + money(m.prem) + ".";
    },
    size: function (m) {
      return m.ticker + " has one window of " + Math.round(m.size).toLocaleString("en-US") + " contracts in the " + strikeText(m.strike) + " " + m.side + " for " + expiryText(m.expiry) + ", " + money(m.prem) +
        ". That is " + times(m.k) + " the name's usual large window." + (m.event ? " A report is " + m.sessions + " sessions away." : "");
    },
    sector: function (m) {
      return m.n + " names in " + m.sector + " are all seeing heavy options flow together: " + m.names.join(", ") + ".";
    }
  };
  function liveSay(m) {
    return m && typeof LIVE[m.kind] === "function" ? LIVE[m.kind](m) : null;
  }

  function easternOffsetH(ms) {
    var d = new Date(ms), y = d.getUTCFullYear();
    function nth(month, wd, n) {
      var first = new Date(Date.UTC(y, month, 1)).getUTCDay();
      return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    }
    var start = Date.UTC(y, 2, nth(2, 0, 2), 7);
    var end = Date.UTC(y, 10, nth(10, 0, 1), 6);
    return ms >= start && ms < end ? -4 : -5;
  }
  function sessionOf(ms) {
    var x = fin(ms);
    if (x === null) return { open: false, minutes: null };
    var off = easternOffsetH(x), d = new Date(x + off * 3600000);
    var wd = d.getUTCDay(), mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    var weekday = wd >= 1 && wd <= 5;
    var open = weekday && mins >= 570 && mins < 960;
    return { open: open, minutes: open ? mins - 570 : null };
  }

  function createLiveState() {
    return { seen: new Set(), byName: new Map(), cool: new Map(), fired: [], quiet: 0, list: [], sectorAt: new Map() };
  }

  function atOf(r) {
    var s = typeof r.spanStart === "string" ? Date.parse(r.spanStart) : NaN;
    if (isFinite(s)) return s;
    var t = fin(r.ts);
    return t;
  }
  function keyOf(r) {
    if (r.id !== undefined && r.id !== null) return "i:" + r.id;
    return "k:" + r.t + "|" + (r.oc || "") + "|" + (r.spanStart || "") + "|" + (r.prem === undefined ? "" : r.prem);
  }

  function ctxFor(context, t) {
    if (!context || typeof context !== "object") return null;
    if ("norm" in context || "leanBase" in context || "sector" in context || "earnings" in context) return context;
    var c = context[t];
    return c && typeof c === "object" ? c : null;
  }

  function sumPrem(rows) {
    var s = 0;
    for (var i = 0; i < rows.length; i++) s += rows[i].prem;
    return s;
  }
  function split(r) {
    var g = typeof window !== "undefined" ? window : globalThis;
    var U = g.FlowsUI;
    return U && U.F && typeof U.F.askSplit === "function" ? U.F.askSplit(r) : null;
  }
  function leanOf(rows) {
    var ca = 0, cb = 0, pa = 0, pb = 0, sided = 0, all = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], a = r.stated ? r.ask : 0, b = r.stated ? r.bid : 0, c = cpWord(r.cp);
      all += r.prem;
      sided += a + b;
      if (c === "call") { ca += a; cb += b; } else if (c === "put") { pa += a; pb += b; }
    }
    if (sided <= 0 || all <= 0) return null;
    return { l: (ca + pb - cb - pa) / sided, sided: sided, coverage: sided / all };
  }

  function detect(state, rows, context, nowMs, opts) {
    var now = fin(nowMs);
    var o = opts || {};
    var refuse = typeof o.refuses === "function" ? o.refuses : function () { return false; };
    var out = [];
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== "object" || typeof r.t !== "string" || !r.t || fin(r.prem) === null || r.prem <= 0) continue;
      if (refuse(r.t)) continue;
      var at = atOf(r);
      if (at === null) continue;
      var key = keyOf(r);
      if (state.seen.has(key)) continue;
      state.seen.add(key);
      var arr = state.byName.get(r.t);
      if (!arr) { arr = []; state.byName.set(r.t, arr); }
      var sp = split(r);
      arr.push({ t: r.t, at: at, prem: r.prem, size: fin(r.size), ask: sp ? sp.ask : 0, bid: sp ? sp.bid : 0, stated: !!(sp && sp.askStated && sp.bidStated), cp: r.cp, k: fin(r.k), exp: typeof r.exp === "string" ? r.exp : null, sweep: r.sweep === true, id: key });
    }
    if (now === null || o.live !== true) return out;
    var sess = sessionOf(now);
    if (!sess.open || sess.minutes < T.warmMin) return out;

    var found = [];
    var surges = [];
    var names = Array.from(state.byName.keys()).sort();
    for (var n = 0; n < names.length; n++) {
      var t = names[n], all = state.byName.get(t), ctx = ctxFor(context, t);
      if (all.length < T.minWindows) continue;
      var norm = ctx && ctx.norm && fin(ctx.norm.winN) !== null && ctx.norm.winN >= 20 ? ctx.norm : null;
      if (!norm) continue;
      var ev = ctx.earnings && ctx.earnings.inWindow === true && fin(ctx.earnings.sessions) !== null;
      var mult = ev ? T.eventMult : 1;
      var sessions = ev ? ctx.earnings.sessions : null;
      var recent = all.filter(function (x) { return x.at > now - T.windowMin * MIN && x.at <= now; });
      var p90 = fin(norm.premiumP90), med = fin(norm.premiumMedian), sp90 = fin(norm.sizeP90);

      if (p90 !== null && p90 > 0 && recent.length >= T.surgeN) {
        var P = sumPrem(recent), usual = p90 * (T.windowMin / 390);
        var bar = Math.max(T.surgeMult * usual, T.surgeFloor) * mult;
        if (P >= bar) {
          var st = P >= 3 * bar ? 3 : P >= 2 * bar ? 2 : 1;
          var m = { kind: "surge", ticker: t, prem: P, n: recent.length, bar: bar, minutes: T.windowMin, event: !!ev, sessions: sessions };
          surges.push({ t: t, P: P, sector: ctx.sector || null, etf: ctx.sectorEtf || null });
          found.push({ kind: "surge", t: t, strength: st, prem: P, m: m, facts: [{ label: "Flagged premium, 30 min", display: money(P) }, { label: "Bar for this name", display: money(bar) }] });
        }
      }

      if (med !== null) {
        var win20 = all.filter(function (x) { return x.at > now - T.repeatMin * MIN && x.at <= now && x.k !== null && x.exp; });
        var groups = new Map();
        for (var a = 0; a < win20.length; a++) {
          var g = win20[a], gk = g.exp + "|" + g.k + "|" + cpWord(g.cp);
          if (!groups.has(gk)) groups.set(gk, []);
          groups.get(gk).push(g);
        }
        groups.forEach(function (gs) {
          var distinct = new Set(gs.map(function (x) { return x.id; })).size;
          var P2 = sumPrem(gs);
          if (distinct >= T.repeatN && P2 >= Math.max(T.repeatMult * med, T.repeatFloor) * mult) {
            var f = gs[0];
            found.push({ kind: "repeat", t: t, strength: P2 >= 3 * Math.max(T.repeatMult * med, T.repeatFloor) * mult ? 3 : P2 >= 2 * Math.max(T.repeatMult * med, T.repeatFloor) * mult ? 2 : 1, prem: P2,
              m: { kind: "repeat", ticker: t, strike: f.k, side: cpWord(f.cp), expiry: f.exp, n: distinct, minutes: T.repeatMin, prem: P2, event: !!ev, sessions: sessions },
              facts: [{ label: "Windows at one strike", display: String(distinct) }, { label: "Combined premium", display: money(P2) }] });
          }
        });
      }

      var recentLean = leanOf(recent);
      var earlier = all.filter(function (x) { return x.at <= now - T.windowMin * MIN; });
      if (recentLean && recentLean.sided >= T.flipSided && recentLean.coverage >= T.coverage && Math.abs(recentLean.l) >= T.flipAbs && earlier.length) {
        var spanMin = (now - T.windowMin * MIN - Math.min.apply(null, earlier.map(function (x) { return x.at; }))) / MIN;
        var el = leanOf(earlier);
        if (spanMin >= T.flipEarlierMin && el && el.sided >= T.flipSided && el.coverage >= T.coverage && Math.sign(el.l) !== 0 && Math.sign(el.l) !== Math.sign(recentLean.l)) {
          found.push({ kind: "flip", t: t, strength: Math.abs(recentLean.l) >= 0.7 ? 3 : Math.abs(recentLean.l) >= 0.55 ? 2 : 1, prem: recentLean.sided,
            m: { kind: "flip", ticker: t, l: recentLean.l, earlier: el.l, now: LEAN_SIGN[Math.sign(recentLean.l)], before: LEAN_SIGN[Math.sign(el.l)], minutes: T.windowMin },
            facts: [{ label: "Lean now", display: Math.round(recentLean.l * 100) + " of 100" }, { label: "Lean earlier", display: Math.round(el.l * 100) + " of 100" }, { label: "Convention", display: "calls on the ask side, puts on the bid side" }] });
        }
      }

      var dated = recent.filter(function (x) { return x.exp; });
      if (dated.length) {
        var todayExp = all.filter(function (x) { return x.exp; }).map(function (x) { return x.exp; }).sort()[0];
        var byExp = new Map();
        dated.forEach(function (x) { byExp.set(x.exp, (byExp.get(x.exp) || 0) + x.prem); });
        var total = sumPrem(dated);
        byExp.forEach(function (p, e) {
          if (e !== todayExp && total > 0 && p / total >= T.clusterShare && p >= T.clusterFloor) {
            found.push({ kind: "cluster", t: t, strength: p / total >= 0.85 ? 3 : p / total >= 0.72 ? 2 : 1, prem: p,
              m: { kind: "cluster", ticker: t, expiry: e, share: p / total, prem: p }, facts: [{ label: "Share in one expiry", display: Math.round(100 * p / total) + "%" }, { label: "Premium", display: money(p) }] });
          }
        });
      }

      var sw = all.filter(function (x) { return x.sweep && x.at > now - T.sweepMin * MIN && x.at <= now; });
      if (sw.length >= T.sweepN) {
        var ask = 0, bid = 0;
        sw.forEach(function (x) { if (x.stated) { ask += x.ask; bid += x.bid; } });
        var P3 = sumPrem(sw);
        if (ask + bid > 0 && Math.round(100 * (ask + bid) / P3) >= 50 && Math.round(100 * ask / (ask + bid)) >= T.sweepAsk && P3 >= T.sweepFloor) {
          found.push({ kind: "sweeps", t: t, strength: sw.length >= 8 ? 3 : sw.length >= 6 ? 2 : 1, prem: P3,
            m: { kind: "sweeps", ticker: t, n: sw.length, minutes: T.sweepMin, prem: P3 }, facts: [{ label: "Fast windows", display: String(sw.length) }, { label: "Ask-side share", display: Math.round(100 * ask / (ask + bid)) + "%" }] });
        }
      }

      if (sp90 !== null && sp90 > 0) {
        var bigBar = Math.max(T.sizeMult * sp90, T.sizeFloor) * mult;
        recent.forEach(function (x) {
          if (x.size !== null && x.size >= bigBar && x.prem >= T.sizePrem * mult) {
            found.push({ kind: "size", t: t, strength: x.size >= 3 * bigBar ? 3 : x.size >= 2 * bigBar ? 2 : 1, prem: x.prem,
              m: { kind: "size", ticker: t, size: x.size, strike: x.k, side: cpWord(x.cp), expiry: x.exp, prem: x.prem, k: x.size / sp90, event: !!ev, sessions: sessions },
              facts: [{ label: "Contracts", display: Math.round(x.size).toLocaleString("en-US") }, { label: "Premium", display: money(x.prem) }] });
          }
        });
      }
    }

    var bySector = new Map();
    surges.forEach(function (s) {
      if (!s.sector) return;
      if (!bySector.has(s.sector)) bySector.set(s.sector, new Map());
      bySector.get(s.sector).set(s.t, s);
    });
    bySector.forEach(function (members, sector) {
      var P = 0;
      members.forEach(function (s) { P += s.P; });
      if (members.size >= T.sectorN && P >= T.sectorFloor) {
        var tickers = Array.from(members.keys()).sort();
        var etf = members.get(tickers[0]).etf;
        found.push({ kind: "sector", t: sector, sector: sector, etf: etf, strength: members.size >= 8 ? 3 : members.size >= 6 ? 2 : 1, prem: P,
          m: { kind: "sector", ticker: tickers[0], sector: sector, n: members.size, names: tickers.slice(0, 3) },
          facts: [{ label: "Names together", display: String(members.size) }, { label: "Sector flagged premium", display: money(P) }] });
      }
    });

    found.sort(function (a, b) { return (b.strength - a.strength) || (b.prem - a.prem) || (a.t < b.t ? -1 : a.t > b.t ? 1 : KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)); });
    state.fired = state.fired.filter(function (x) { return x > now - T.cooldownMin * MIN; });
    for (var f = 0; f < found.length; f++) {
      var c = found[f], ck = c.t + "|" + c.kind + (c.kind === "repeat" || c.kind === "size" ? "|" + c.m.expiry + "|" + c.m.strike + "|" + c.m.side : "");
      var prior = state.cool.get(ck);
      if (prior && now - prior.at < T.cooldownMin * MIN && c.strength <= prior.strength) continue;
      if (state.fired.length >= T.cap) { state.quiet++; continue; }
      state.cool.set(ck, { at: now, strength: c.strength });
      state.fired.push(now);
      var msg = { id: c.t + ":" + c.kind + ":" + Math.floor(now / (T.cooldownMin * MIN)), ticker: c.kind === "sector" ? c.m.ticker : c.t, kind: c.kind, strength: c.strength, facts: c.facts, say: liveSay(c.m), at: now };
      if (c.kind === "sector") { msg.sector = c.sector; msg.etf = c.etf || null; }
      out.push(msg);
      state.list.push(msg);
    }
    if (state.list.length > 40) state.list.splice(0, state.list.length - 40);
    return out;
  }

  var words = Object.freeze({ STANCE_LINES: STANCE_LINES, MODEL_IMPLIED: MODEL_IMPLIED, CONVICTION_WORDS: CONVICTION_WORDS, callSay: callSay, liveSay: liveSay, LEAN_GLYPH: LEAN_GLYPH, LEAN_WORD: LEAN_WORD });
  var live = Object.freeze({ createState: createLiveState, detect: detect, THRESHOLDS: T, sessionOf: sessionOf });

  if (typeof document === "undefined") {
    globalThis.__OracleCoreTest = { words: words, live: live, fmt: { money: money, cents: cents, whole: whole, signedWhole: signedWhole, pct0: pct0, vol1: vol1, expiryText: expiryText, strikeText: strikeText, times: times, trt: trt }, STANCE_LINES: STANCE_LINES, CONVENTION: CONVENTION };
    return;
  }
  var U = window.FlowsUI;
  if (!U) return;
  var add = {};
  if (!U.oracleWords) add.oracleWords = words;
  if (!U.oracleLive) add.oracleLive = live;
  if (!U.oracleKit) add.oracleKit = Object.freeze({ money: money, cents: cents, whole: whole, signedWhole: signedWhole, pct0: pct0, vol1: vol1, expiryText: expiryText, strikeText: strikeText, times: times, trt: trt, LEAN_SIGN: LEAN_SIGN });
  window.FlowsUI = Object.freeze(Object.assign({}, U, add));
}());
