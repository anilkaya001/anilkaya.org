(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const MINUS = "−";

  const DASH = "—";

  const MID = "·";

  let uid = 0;
  const $ = (id) => document.getElementById(id);

  const isNum = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string") return null;
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const fmtSigned = (v, dp) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(dp === undefined ? 0 : dp);
  };

  const DAY = 864e5, off = (d) => new Date(d).getUTCDay() % 6 === 0;
  const due = (d) => { do d += DAY; while (off(d)); return d + DAY + 72e5; };

  function staleness(payload, now, opts) {
    const at = isNum(now) ?? Date.now();
    if (!payload || typeof payload !== "object") return { kind: "unknown", message: null };
    const ff = payload.__ff, server = ff && ff.stateAt ? ff.stateAt(at) : null;
    if (server && server !== "stale") return { kind: "fresh", message: null };
    const w = isNum(payload.__updatedAt), written = w > 0 ? w : null;
    let s = written && Math.floor((written - 72e6) / DAY) * DAY;
    while (s && off(s)) s -= DAY;
    if (written && at >= due(s)) {
      const h = Math.floor((at - written) / 36e5), d = Math.floor(h / 24);
      return { kind: "write", message: ((opts || {}).subject || "This page") + " was last written " + (d ? d + (d === 1 ? " day" : " days") : h + (h === 1 ? " hour" : " hours")) +
        " ago. The pipeline has not published since — check the Actions tab." };
    }
    const day = isoDay(payload.sessionDate) ? Date.parse(payload.sessionDate.slice(0, 10) + "T00:00:00Z") : NaN;
    let n = 0;
    for (let d = day; due(d) <= at && n < 60; d = due(d) - DAY - 72e5) n++;
    if (n || (day === day && server)) {
      return { kind: "session", message: "These numbers describe the " + payload.sessionDate + " session, " + (n ? n + " session" + (n === 1 ? "" : "s") + " behind" : "no longer current") +
        ". The pipeline is running but its data is not advancing." };
    }
    if (server) return { kind: "write", message: "The server marks this stale — check the Actions tab." };
    return written === null && day !== day ? { kind: "unknown", message: null } : { kind: "fresh", message: null };
  }

  const emptyState = (kind, text) => {
    const p = h("p", { class: "flows-empty" }, text);
    if (kind) p.dataset.empty = kind;
    return p;
  };

  function stripGeometry(count, width) {
    const n = Math.max(1, Math.floor(isNum(count) ?? 1)), w = Math.max(1, isNum(width) ?? 1), colW = w / n;
    return { count: n, width: w, colW, xEdge: (i) => i * colW, xMid: (i) => (i + 0.5) * colW };
  }

  function markerRuns(markers) {
    const byCls = new Map(), runs = [];
    for (const m of (Array.isArray(markers) ? markers : [])) {
      const i = isNum(m && m.i);
      if (i === null) continue;
      const cls = String((m && m.cls) || "");
      if (!byCls.has(cls)) byCls.set(cls, []);
      byCls.get(cls).push(i);
    }
    for (const [cls, list] of byCls) {
      list.sort((a, b) => a - b);
      let start = null, prev = null;
      for (const i of list) {
        if (start !== null && i === prev + 1) { prev = i; continue; }
        if (start !== null) runs.push({ cls, from: start, to: prev });
        start = prev = i;
      }
      if (start !== null) runs.push({ cls, from: start, to: prev });
    }
    return runs;
  }

  function scoreStrip(host, opts) {
    const o = opts || {};
    if (!host || !Array.isArray(o.values)) return null;
    const prefix = o.prefix || "fui";
    const pts = o.values.map((v) => isNum(v));
    const count = pts.length;
    const W = Math.max(24, Math.min(1600, Math.round(isNum(o.width) ?? host.clientWidth) || 240));
    const H = Math.max(12, Math.round(isNum(o.height) ?? 24));
    const g = stripGeometry(count || 1, W);
    const padY = 2.5, plotH = H - padY * 2;
    let lo = o.domain ? isNum(o.domain.lo) ?? 0 : 0, hi = o.domain ? isNum(o.domain.hi) ?? 0 : 0;
    const db = isNum(o.deadBand);
    if (db !== null) { lo = Math.min(lo, -db); hi = Math.max(hi, db); }
    for (const v of pts) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const y = (v) => padY + (1 - (v - lo) / (hi - lo)) * plotH;
    const svg = s("svg", { class: prefix + "-strip", viewBox: `0 0 ${W} ${H}`, width: W, height: H, preserveAspectRatio: "xMidYMid meet" });
    if (o.ariaLabel) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", o.ariaLabel); }
    else { svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); }
    for (const run of markerRuns(o.markers)) {
      if (run.from >= count) continue;
      s("rect", { class: run.cls || (prefix + "-wash"), x: g.xEdge(run.from).toFixed(2), y: 0,
        width: (g.colW * (Math.min(run.to, count - 1) - run.from + 1)).toFixed(2), height: H }, svg);
    }
    if (db !== null && db > 0) {
      const top = y(db);
      s("rect", { class: prefix + "-band", x: 0, y: top.toFixed(2), width: W, height: Math.max(0.5, y(-db) - top).toFixed(2) }, svg);
    }
    const zy = y(0).toFixed(2);
    s("line", { class: prefix + "-zero", x1: 0, x2: W, y1: zy, y2: zy }, svg);
    for (const r of (Array.isArray(o.rules) ? o.rules : [])) {
      const at = isNum(r && r.at);
      if (at === null || at < 0 || at > count) continue;
      const x = g.xEdge(at).toFixed(2);
      s("line", { class: (r && r.cls) || (prefix + "-rule"), x1: x, x2: x, y1: 0, y2: H }, svg);
    }
    for (let i = 0; i + 1 < count; i++) {
      if (pts[i] === null || pts[i + 1] === null) continue;
      s("line", { class: prefix + "-line", x1: g.xMid(i).toFixed(2), y1: y(pts[i]).toFixed(2),
        x2: g.xMid(i + 1).toFixed(2), y2: y(pts[i + 1]).toFixed(2) }, svg);
    }
    let lastMeasured = -1;
    for (let i = 0; i < count; i++) if (pts[i] !== null) lastMeasured = i;
    const r0 = Math.max(1.1, Math.min(1.6, g.colW / 2.4));
    for (let i = 0; i < count; i++) {
      if (pts[i] === null) continue;
      const edge = (i === 0 || pts[i - 1] === null) || (i === count - 1 || pts[i + 1] === null);
      if (!edge && i !== lastMeasured) continue;
      const isLast = i === lastMeasured;
      s("circle", { class: prefix + "-dot" + (isLast ? " is-last" + (pts[i] > 0 ? " is-pos" : pts[i] < 0 ? " is-neg" : " is-zero") : ""),
        cx: g.xMid(i).toFixed(2), cy: y(pts[i]).toFixed(2),
        r: isLast ? Math.max(r0, Math.min(2, g.colW / 2)).toFixed(2) : r0.toFixed(2) }, svg);
    }
    host.append(svg);
    return svg;
  }

  const fmtStamp = (iso) => {
    const ms = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(iso.trim())
      ? Date.parse(iso.trim()) : NaN;
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  };

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
  const WIDE = window.matchMedia("(min-width: 1025px)");
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nextId = (p) => p + (++uid);
  const moving = () => !REDUCED.matches;

  const AH = { "aria-hidden": "true" };
  const onDoc = (t, f, o) => document.addEventListener(t, f, o);
  const RAF = (f) => requestAnimationFrame(f);
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "style" && typeof v === "object") { for (const p in v) n.style.setProperty(p, v[p]); }
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of kids.flat(4)) {
      if (c == null || c === false) continue;
      n.append(c instanceof Node ? c : String(c));
    }
    return n;
  }

  function s(tag, attrs, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null) continue;
        if (k === "text") n.textContent = v;
        else if (k === "style" && typeof v === "object") { for (const p in v) n.style.setProperty(p, v[p]); }
        else n.setAttribute(k, v);
      }
    }
    if (parent) parent.append(n);
    return n;
  }

  function glyph(name, cls) {
    const n = s("svg", { class: "ui-g" + (cls ? " " + cls : ""), ...AH, focusable: "false" });
    s("use", { href: "#g-" + name }, n);
    return n;
  }

  const varCache = new Map();
  const rootStyle = () => getComputedStyle(document.body || document.documentElement);
  const varOf = (cs, name) => cs.getPropertyValue(name).trim() || "#888";
  let varsWarm = false;
  function rootVars(rules, out) {
    for (const r of rules) {
      if (r.cssRules) rootVars(r.cssRules, out);
      if (r.selectorText === ":root" || r.selectorText === "html") for (const p of r.style) if (p.startsWith("--")) out.add(p);
    }
  }
  function warmVars() {
    varsWarm = true;
    const names = new Set();
    for (const sheet of document.styleSheets) { try { rootVars(sheet.cssRules, names); } catch {} }
    const cs = names.size ? rootStyle() : null;
    for (const n of names) varCache.set(n, varOf(cs, n));
  }
  function cssVar(name) {
    if (typeof name !== "string" || !name.startsWith("--")) return name;
    if (!varsWarm) warmVars();
    if (!varCache.has(name)) varCache.set(name, varOf(rootStyle(), name));
    return varCache.get(name);
  }
  const paint = (c) => cssVar(c || "--label-2");

  const sgn = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
  function compact(v, dp) {
    const a = Math.abs(v);
    const fmt = (x, suf) => {
      const d = dp !== undefined ? dp : x >= 100 ? 0 : x >= 10 ? 1 : 2;
      return x.toFixed(suf === "K" && d === 2 ? 1 : d) + suf;
    };
    let out = a >= 1e9 ? fmt(a / 1e9, "B") : a >= 1e6 ? fmt(a / 1e6, "M") : a >= 1e3 ? fmt(a / 1e3, "K") : String(Math.round(a));
    if (/^1000(\.0+)?K$/.test(out)) out = fmt(a / 1e6, "M");
    else if (/^1000(\.0+)?M$/.test(out)) out = fmt(a / 1e9, "B");
    else if (out === "1000") out = fmt(a / 1e3, "K");
    return out;
  }
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const isoDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
  const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const ET_PARTS = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });

  const F = {
    px: (v, dp = 2) => (num(v) === null ? DASH : (v < 0 ? MINUS : "") + Math.abs(v).toFixed(dp)),
    pct: (v, dp = 1, signed = false) => {
      if (num(v) === null) return DASH;
      const r = +(v * 100).toFixed(dp);
      return (signed ? sgn(r) : r < 0 ? MINUS : "") + Math.abs(r).toFixed(dp) + "%";
    },
    pts: (v, dp = 1) => (num(v) === null ? DASH : sgn(v) + Math.abs(v * 100).toFixed(dp)),
    num: (v, signed = false, dp) => (num(v) === null ? DASH : (signed ? sgn(v) : v < 0 ? MINUS : "") + compact(v, dp)),
    money: (v, signed = false, dp) => (num(v) === null ? DASH : (signed ? sgn(v) : v < 0 ? MINUS : "") + "$" + compact(v, dp)),
    int: (v, signed = false) => (num(v) === null ? DASH : (signed ? sgn(Math.round(v)) : v < 0 ? MINUS : "") + Math.round(Math.abs(v)).toLocaleString("en-US")),
    signed: (v, dp = 0) => (num(v) === null ? DASH : sgn(+v.toFixed(dp)) + Math.abs(v).toFixed(dp)),
    day: (d) => (isoDay(d) ? MON[+d.slice(5, 7) - 1] + " " + +d.slice(8, 10) : DASH),
    time: (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? ET_TIME.format(new Date(t)) + " ET" : DASH; },
    compact,
  };
  const tone = (v, dead = 0) => (num(v) === null ? "flat" : v > dead ? "up" : v < -dead ? "down" : "flat");
  const dirGlyph = (t) => (t === "down" ? "down" : t === "up" ? "up" : "flat");
  const cap = (t) => (typeof t === "string" && t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : t);

  const POP = { "aria-haspopup": "dialog", "aria-controls": "fxPop" };
  const STATES = Object.freeze({
    live: { g: "live", word: "Live" },
    fresh: { g: "clock", word: "Current session" },
    closed: { g: "closed", word: "Market closed" },
    stale: { g: "clock", word: "Stale" },
    pending: { g: "pending", word: "Pending" },
    quiet: { g: "quiet", word: "Quiet" },
    withheld: { g: "withheld", word: "Withheld" },
    unavailable: { g: "unavailable", word: "Not on card" },
  });
  const ORDER = ["unavailable", "withheld", "pending", "stale", "quiet", "ok"];

  function stateOf(p, what) {
    if (!p || typeof p !== "object") return { state: "unavailable", reason: "The card carries no " + (what || "panel") + " for this name." };
    if (p.status === "ok") return { state: "ok", reason: null };
    const r = typeof p.reason === "string" && p.reason ? cap(p.reason) : null;
    if (p.status === "quiet") return { state: "quiet", reason: r || "Read, with nothing to report." };
    if (p.status === "withheld" || p.status === "unreadable") return { state: "withheld", reason: r || "Measured, but held back as unreliable." };
    if (p.status === "pending") return { state: "pending", reason: r || "Not computed yet." };
    if (p.status === "stale") return { state: "stale", reason: r || "Older than the last completed session." };
    return { state: "unavailable", reason: r || "The source did not deliver this panel." };
  }
  function worst(list) {
    let w = "ok", r = null;
    for (const st of list || []) {
      if (st && ORDER.indexOf(st.state) >= 0 && ORDER.indexOf(st.state) < ORDER.indexOf(w)) { w = st.state; r = st.reason; }
    }
    return { state: w, reason: r };
  }
  function partial(list) {
    const bad = (list || []).filter((x) => x.st && x.st.state !== "ok");
    if (!bad.length) return { state: "ok", reason: null };
    if (bad.length === list.length) return worst(list.map((x) => x.st));
    return {
      state: "quiet",
      reason: bad.map((x) => x.name + ": " + (STATES[x.st.state] || STATES.unavailable).word.toLowerCase() + ". " + (x.st.reason || "")).join(" "),
    };
  }

  const INFO = new Map();
  let anchor = null;
  function info(build) {
    const id = "i" + (++uid);
    INFO.set(id, typeof build === "function" ? build : () => build);
    if (INFO.size > 600) {
      const live = new Set([...document.querySelectorAll("[data-info]")].map((n) => n.dataset.info));
      for (const k of INFO.keys()) if (k !== id && !live.has(k)) INFO.delete(k);
    }
    return id;
  }
  function infoButton(label, build, o = {}) {
    return h("button", {
      class: "ui-info" + (o.small ? " ui-info--sm" : ""), type: "button",
      "aria-label": "About " + label, ...POP, "aria-expanded": "false", "data-info": info(build),
    }, glyph("info"));
  }
  function stateButton(st, label) {
    if (!st || st.state === "ok") return null;
    const def = STATES[st.state] || STATES.unavailable;
    return h("button", {
      class: "ui-state", type: "button", "data-state": st.state, title: def.word,
      "aria-label": def.word + (label ? ": " + label : ""), ...POP,
      "data-info": info(() => ({ title: label || def.word, state: st.state, lead: st.reason })),
    }, glyph(def.g));
  }
  function statePill(state) {
    const def = STATES[state];
    return def ? h("span", { class: "ui-pill", "data-state": state }, glyph(def.g), def.word) : null;
  }

  function ensurePop() {
    let pop = $("fxPop");
    if (pop) return pop;
    pop = h("div", { class: "ui-pop", id: "fxPop", popover: "manual", role: "dialog", "aria-modal": "false", "aria-labelledby": "fxPopT", tabindex: "-1" },
      h("div", { class: "ui-pop-h" },
        h("h3", { id: "fxPopT" }),
        h("button", { class: "ui-pop-x", type: "button", "aria-label": "Close", onclick: () => closeInfo() }, glyph("x"))),
      h("div", { id: "fxPopB" }));
    document.body.append(pop);
    pop.addEventListener("toggle", (e) => {
      if (e.newState !== "closed" || pop.matches(":popover-open")) return;
      const a = anchor;
      anchor = null;
      if (!a) return;
      a.setAttribute("aria-expanded", "false");
      setTimeout(() => { if (anchor !== a) a.style.removeProperty("anchor-name"); }, 400);
      const f = document.activeElement;
      const lost = !f || f === document.body || pop.contains(f);
      if (lost && a.isConnected) { try { a.focus({ preventScroll: true }); } catch { a.focus(); } }
    });
    return pop;
  }
  const POPS = !window.HTMLElement || "popover" in HTMLElement.prototype;
  const popOpen = () => { const p = POPS && $("fxPop"); return !!(p && p.matches(":popover-open")); };
  function fillPop(d) {
    const body = $("fxPopB");
    $("fxPopT").textContent = d.title || "";
    body.replaceChildren();
    const sub = h("div", { class: "ui-pop-sub" }, d.state ? statePill(d.state) : null, d.asOf ? h("span", { class: "ui-pill" }, glyph("cal"), d.asOf) : null);
    if (sub.childNodes.length) body.append(sub);
    if (d.lead) body.append(h("p", { class: "ui-lead" }, d.lead));
    const facts = (d.facts || []).filter((f) => f && f[1] !== null && f[1] !== undefined && f[1] !== "");
    if (facts.length) body.append(h("dl", null, facts.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])));
    for (const sec of d.sections || []) {
      const lines = sec && Array.isArray(sec.lines) ? sec.lines.filter(Boolean) : [];
      if (!lines.length) continue;
      body.append(h("h4", null, sec.title));
      for (const l of lines) body.append(h("p", null, cap(l)));
    }
    for (const l of d.notes || []) if (l) body.append(h("p", null, cap(l)));
    if (d.node instanceof Node) body.append(d.node);
  }
  function openInfo(trigger, content) {
    const build = content !== undefined ? () => content : trigger && INFO.get(trigger.dataset.info);
    if (!build || !POPS) return;
    const d = build() || {};
    const pop = ensurePop();
    if (anchor && anchor !== trigger) { anchor.style.removeProperty("anchor-name"); anchor.setAttribute("aria-expanded", "false"); }
    anchor = trigger || null;
    if (trigger) {
      trigger.style.setProperty("anchor-name", "--ui-anchor");
      trigger.setAttribute("aria-expanded", "true");
    }
    fillPop(d);
    const at = trigger ? trigger.getBoundingClientRect() : null;
    pop.dataset.span = at && at.left + at.width / 2 < window.innerWidth / 2 ? "right" : "left";
    if (!popOpen()) { try { pop.showPopover(trigger ? { source: trigger } : undefined); } catch { return; } }
    pop.scrollTop = 0;
    try { pop.focus({ preventScroll: true }); } catch { pop.focus(); }
  }
  function closeInfo() {
    const pop = $("fxPop");
    if (pop && popOpen()) pop.hidePopover();
  }
  onDoc("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("[data-info]") : null;
    if (!b || !INFO.has(b.dataset.info)) return;
    e.preventDefault();
    if (anchor === b && popOpen()) { closeInfo(); return; }
    openInfo(b);
  });
  onDoc("pointerdown", (e) => {
    if (!popOpen()) return;
    const pop = $("fxPop");
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest("[data-info]")) return;
    const r = pop.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeInfo();
  }, true);
  onDoc("keydown", (e) => { if (e.key === "Escape" && popOpen()) { e.preventDefault(); closeInfo(); } });

  let liveNode = null;
  const spoken = (node) => [...node.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(" ");
  function announce(text) {
    if (!liveNode) {
      liveNode = $("fxLive") || h("div", { id: "fxLive", class: "visually-hidden", "aria-live": "polite" });
      if (!liveNode.isConnected) document.body.append(liveNode);
    }
    liveNode.textContent = text;
  }

  function roll(el, text, fromText, animate) {
    const t = String(text);
    el.classList.add("ui-roll");
    el.replaceChildren(h("span", { class: "visually-hidden" }, t));
    const chars = [...t];
    const from = fromText ? [...String(fromText).padStart(chars.length, " ")].slice(-chars.length) : null;
    const go = animate === undefined ? moving() : animate && moving();
    let k = 0;
    chars.forEach((ch, i) => {
      if (/\d/.test(ch)) {
        const strip = h("span", { class: "ui-roll-s" });
        for (let d = 0; d < 10; d++) strip.append(h("span", null, d));
        const start = go && from && /\d/.test(from[i]) ? from[i] : go && !from ? String((+ch + 7) % 10) : ch;
        strip.style.setProperty("--d", start);
        strip.style.setProperty("--k", k++);
        el.append(h("span", { class: "ui-roll-d", ...AH }, strip));
        if (go && start !== ch) RAF(() => RAF(() => strip.style.setProperty("--d", ch)));
      } else {
        el.append(h("span", { class: "ui-roll-c", ...AH }, ch));
      }
    });
    el.dataset.value = t;
    return el;
  }

  function metric(label, value, o = {}) {
    const v = h("span", { class: "ui-metric-v", "data-tone": o.tone || null });
    const silentState = o.state && o.state.state !== "ok" ? o.state : null;
    if (silentState) {
      v.dataset.tone = "silent";
      v.append(DASH, stateButton(silentState, label));
    } else {
      const val = h("span", { class: "ui-metric-n" });
      if (o.roll) roll(val, value, o.from, true); else val.textContent = value;
      v.append(val);
      if (o.unit) v.append(h("small", null, o.unit));
      if (o.delta !== undefined && o.delta !== null) v.append(h("span", { class: "ui-metric-d", "data-tone": o.deltaTone || tone(o.deltaValue) }, o.delta));
    }
    return h("div", { class: "ui-metric" + (o.hero ? " ui-metric--hero" : "") + (o.display ? " ui-metric--display" : ""), "data-metric": o.id || null },
      h("span", { class: "ui-metric-l" }, o.key || null, label, o.info || null),
      v,
      o.sub ? h("span", { class: "ui-metric-s" }, o.sub) : null);
  }
  function updateMetric(node, value, o = {}) {
    const val = node && node.querySelector(".ui-metric-n");
    if (!val) return;
    const before = val.dataset.value || val.textContent;
    if (String(value) !== before) roll(val, value, before, o.animate !== false);
    const v = node.querySelector(".ui-metric-v");
    if (o.tone) v.dataset.tone = o.tone;
    if (o.sub !== undefined) {
      let sub = node.querySelector(".ui-metric-s");
      if (!sub && o.sub) { sub = h("span", { class: "ui-metric-s" }); node.append(sub); }
      if (sub) sub.textContent = o.sub || "";
    }
  }
  function metrics(list, o = {}) {
    return h("div", { class: "ui-metrics", style: o.min ? { "--metric-min": o.min + "px" } : null }, list);
  }

  const RING = { cx: 13, cy: 13, r: 10.5, fill: "none" };
  function ringBase(size, stroke, style) {
    const n = s("svg", { width: size, height: size, viewBox: "0 0 26 26", class: "ui-gchip-g", ...AH, style });
    s("circle", { ...RING, class: "ui-ring-track", "stroke-width": stroke }, n);
    return n;
  }
  function ring(v01, o = {}) {
    const stroke = o.stroke || 3;
    const n = ringBase(o.size || 20, stroke, { "--ring-c": paint(o.color || "--label-1") });
    if (num(v01) !== null) {
      s("circle", {
        ...RING, class: "ui-ring-v", stroke: paint(o.color || "--label-1"), "stroke-width": stroke,
        "stroke-linecap": "round", pathLength: 100, "stroke-dasharray": `${clamp(v01, 0, 1) * 100} 100`, transform: "rotate(-90 13 13)",
      }, n);
    }
    return n;
  }
  function divRing(v, o = {}) {
    const max = o.max || 100;
    const n = ringBase(o.size || 20, 3);
    s("line", { x1: 13, y1: 0.8, x2: 13, y2: 5.2, stroke: paint("--label-3"), "stroke-width": 1.2 }, n);
    if (num(v) !== null && v !== 0) {
      const a = clamp(Math.abs(v) / max, 0, 1) * 100;
      s("circle", {
        ...RING, class: "ui-ring-v", stroke: paint(v > 0 ? "--up-mark" : v < 0 ? "--down-mark" : "--label-3"), "stroke-width": 3,
        "stroke-linecap": "round", pathLength: 100, "stroke-dasharray": `${a} 100`,
        transform: v < 0 ? "rotate(-90 13 13) scale(1 -1) translate(0 -26)" : "rotate(-90 13 13)",
      }, n);
    }
    return n;
  }
  function iconChip(name, color) {
    return h("span", { class: "ui-gchip-g ui-iconchip", style: { "--c": paint(color || "--accent-ink") } }, glyph(name));
  }
  function gaugeChip(o) {
    const g = o.g || (o.ring !== undefined ? ring(o.ring, { color: o.color }) : o.diverging !== undefined ? divRing(o.diverging, { max: o.max }) : iconChip(o.icon || "info", o.color));
    const attrs = { class: "ui-gchip", type: "button", ...POP };
    if (o.info) attrs["data-info"] = info(o.info);
    return h("button", attrs, g, h("span", { class: "ui-chip-v", "data-tone": o.tone || null }, o.value), h("span", { class: "ui-chip-l" }, o.label));
  }
  function chips(list, label) {
    return h("div", { class: "ui-chips-w" }, h("div", { class: "ui-chips", role: "group", "aria-label": label || null, style: { "--n": list.length } }, list));
  }

  function segmented(label, items, onPick, start = 0) {
    const wrap = h("div", { class: "ui-seg is-static", role: "tablist", "aria-label": label });
    const knob = h("span", { class: "ui-seg-knob", ...AH });
    wrap.append(knob);
    let current = start;
    const btns = items.map((it, i) => {
      const b = h("button", {
        class: "ui-seg-i", type: "button", role: "tab", "aria-selected": String(i === start),
        disabled: it.disabled || null, title: it.title || null,
      }, it.label);
      b.tabIndex = i === start ? 0 : -1;
      b.addEventListener("click", () => pick(i, true));
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        let j = i;
        do { j = (j + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length; } while (items[j].disabled && j !== i);
        btns[j].focus();
        pick(j, true);
      });
      wrap.append(b);
      return b;
    });
    const place = () => {
      const b = btns[current], W = wrap.clientWidth;
      if (!b || !b.offsetWidth || !W) return;
      knob.style.width = (b.offsetWidth / W) * 100 + "%";
      knob.style.transform = `translateX(${(b.offsetLeft / b.offsetWidth) * 100}%)`;
    };
    function pick(i, user) {
      if (items[i] && items[i].disabled) return;
      current = i;
      btns.forEach((b, j) => { b.setAttribute("aria-selected", i === j); b.tabIndex = i === j ? 0 : -1; });
      place();
      if (user && typeof onPick === "function") {
        const run = () => onPick(i);
        if (document.startViewTransition && moving()) document.startViewTransition(run).ready.catch(() => {}); else run();
      }
    }
    const thaw = () => RAF(() => wrap.classList.remove("is-static"));
    RAF(() => { place(); thaw(); });
    if (window.ResizeObserver) new ResizeObserver(() => { wrap.classList.add("is-static"); place(); thaw(); }).observe(wrap);
    wrap.pick = (i) => pick(i, false);
    wrap.index = () => current;
    return wrap;
  }

  function tag(text, o = {}) {
    return h("span", { class: "ui-tag" + (o.accent ? " is-accent" : ""), "data-tone": o.tone || null }, o.glyph ? glyph(o.glyph) : null, text);
  }
  function calibTag(c) {
    const t = "Not yet calibrated";
    return c && num(c.nEff) >= 100 ? null : h("button", { class: "ui-tag ui-calib", type: "button", ...POP, "aria-expanded": "false",
      "data-info": info({ title: t, lead: "Model probability, not yet checked against outcomes.", notes: ["It stays until 100 effectively independent outcomes are scored."] }) }, t);
  }
  function capsule(text, o = {}) {
    const t = o.tone || "flat";
    return h("span", { class: "ui-capsule", "data-tone": t, "aria-label": o.label || null }, o.glyph === false ? null : glyph(o.glyph || dirGlyph(t)), text);
  }
  function key(color, shape, label) {
    const i = h("i", { class: shape ? "is-" + shape : null, ...AH });
    i.style.setProperty("--c", paint(color));
    return h("span", { class: "ui-key" }, i, label);
  }
  function legend(keys) {
    return h("div", { class: "ui-legend" }, (keys || []).map((k) => (k instanceof Node ? k : key(k[0], k[1], k[2]))));
  }
  function robustness(n, label) {
    const r = clamp(Math.round(num(n) || 0), 0, 3);
    const d = h("span", { class: "ui-bars", role: "img", "aria-label": "Robustness " + r + " of 3" + (label ? ", " + label : ""), title: "Robustness " + r + " of 3" + (label ? " " + MID + " " + label : "") });
    for (let i = 0; i < 3; i++) d.append(h("i", { class: i < r ? "is-on" : null }));
    return d;
  }

  function silent(st, label, height) {
    const state = st && st.state ? st.state : "unavailable";
    const def = STATES[state] || STATES.unavailable;
    const word = (st && st.word) || def.word;
    return h("div", {
      class: "ui-silent", "data-state": state, role: "note", "aria-label": word + ": " + label,
      style: { "--silent-h": (height || 180) + "px" },
    },
    glyph(def.g),
    h("div", { class: "ui-silent-t" }, word),
    h("button", { type: "button", ...POP, "data-info": info(() => ({ title: label, state, lead: st && st.reason })) }, "Why"));
  }
  function dash(st, label) {
    return h("span", { class: "ui-dash" }, DASH, st ? stateButton(st, label) : null);
  }

  function listRow(o) {
    const attrs = { class: "ui-row", role: o.href ? null : "listitem", style: o.cols ? { "--cols": o.cols } : null };
    const tagName = o.href ? "a" : "div";
    if (o.href) attrs.href = o.href;
    const kids = [];
    if (o.badge !== undefined) kids.push(h("span", { class: "ui-badge", "data-tone": o.badgeTone || null, "aria-label": o.badgeLabel || null }, o.badge));
    kids.push(h("span", { class: "ui-row-m" }, h("b", null, o.primary), o.secondary ? h("span", null, o.secondary) : null));
    if (o.meter !== undefined && o.meter !== null) {
      const m = h("i", { style: { "--w": (clamp(o.meter, 0, 1) * 100).toFixed(1) + "%", "--i": o.index || 0 } });
      if (o.meterColor) m.style.setProperty("--c", paint(o.meterColor));
      kids.push(h("span", { class: "ui-meter", ...AH }, m));
    }
    if (o.value !== undefined) kids.push(h("span", { class: "ui-row-v", "data-tone": o.valueTone || null }, o.value));
    if (o.signed !== undefined) kids.push(h("span", { class: "ui-row-v", "data-tone": o.signedTone || tone(o.signedValue) }, o.signed));
    return h(tagName, attrs, kids);
  }
  function list(rows, o = {}) {
    const shown = o.visible || 5;
    const links = rows.some((r) => r.tagName === "A");
    const box = h("div", { class: "ui-list", role: links ? "group" : "list", "aria-label": o.label || null });
    rows.forEach((r, i) => { if (i >= shown) r.hidden = true; box.append(r); });
    if (rows.length <= shown) return box;
    const b = h("button", { class: "ui-disclose", type: "button", "aria-expanded": "false" }, h("span", null, "All " + rows.length), glyph("chev"));
    b.addEventListener("click", () => {
      const open = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", open);
      rows.forEach((r, i) => { if (i >= shown) r.hidden = !open; });
      b.firstChild.textContent = open ? "Fewer" : "All " + rows.length;
    });
    return h("div", null, box, b);
  }

  function tile(o) {
    return h("div", { class: "ui-tile" },
      h("div", { class: "ui-tile-h" }, h("span", null, o.title), o.state && o.state.state !== "ok" ? stateButton(o.state, o.title) : o.info ? infoButton(o.title, o.info, { small: true }) : null),
      o.state && o.state.state !== "ok"
        ? h("div", { class: "ui-tile-v", "data-tone": "silent" }, DASH)
        : h("div", { class: "ui-tile-v", "data-tone": o.tone || null }, o.value, o.unit ? h("small", null, o.unit) : null),
      o.body || null);
  }
  function split(parts, label) {
    return h("div", { class: "ui-split", role: "img", "aria-label": label || null },
      parts.map((p, i) => h("i", { style: { "--c": paint(p.color), "--f": Math.max(0.02, Math.abs(num(p.value) || 0)), "animation-delay": i * 40 + "ms" } })));
  }

  function moduleCard(o) {
    const id = o.id || nextId("mod");
    const title = h("h2", { class: "ui-mod-t", id: id + "-t" }, o.title, o.robustness !== undefined && o.robustness !== null ? robustness(o.robustness) : null, stateButton(o.state, o.title));
    const head = h("header", { class: "ui-mod-h" }, title, h("span", { class: "ui-mod-sp" }), o.seg || null,
      o.info ? infoButton(o.infoLabel || String(o.title).toLowerCase(), o.info) : null);
    const card = h("section", {
      class: "ui-card ui-mod" + (o.enter === false ? "" : " ui-enter") + (o.span ? " ui-span-" + o.span : ""),
      id, "aria-labelledby": id + "-t", style: { "--i": o.index || 0 },
    }, head, o.body || null);
    return card;
  }

  const CHARTS = new Set();
  const drop = (rec) => { CHARTS.delete(rec); if (rec.probe) RO.unobserve(rec.probe); };
  const RO = window.ResizeObserver ? new ResizeObserver((entries) => {
    for (const e of entries) {
      const rec = e.target._fxChart;
      if (!rec.host.isConnected) { if (rec.drawn) drop(rec); continue; }
      rec.w = Math.round(e.contentRect.width);
      if (rec.w && rec.w !== rec.drawn) try { repaint(rec, undefined, false); } catch (err) { setTimeout(() => { throw err; }); }
    }
  }) : null;
  function repaint(rec, animate, force) {
    const host = rec.host;
    if (!host.isConnected) { if (rec.drawn) drop(rec); return; }
    const w = (RO && rec.w) || Math.round(host.clientWidth);
    if (!w) { if (force) rec.drawn = 0; return; }
    if (w === rec.drawn && !force) return;
    rec.w = rec.drawn = w;
    rec.keep = rec.svg && rec.svg.parentNode === host ? rec.svg : null;
    rec.svg = null;
    releaseHost(host);
    if (rec.probe) host.replaceChildren(rec.probe); else host.replaceChildren();
    const go = animate === undefined ? !host._fxPainted : animate;
    host._fxPainted = true;
    try { rec.draw(host, w, go && moving()); } finally { rec.keep = null; }
  }
  const fade = (d) => ({ class: "fade", style: { "--delay": d } });
  const TA = { "text-anchor": "middle" };
  const gone = (el, o, why, label, H) => { el.append(silent({ state: "unavailable", reason: o.empty || why }, o.label || label, H)); };
  function mount(host, draw) {
    if (host._fxChart) drop(host._fxChart);
    releaseHost(host);
    host._scrubAt = -1;
    host.classList.add("ui-chart");
    const rec = { host, draw, w: 0, drawn: 0, probe: null, svg: null, keep: null };
    host._fxChart = rec;
    CHARTS.add(rec);
    if (RO) {
      const probe = rec.probe = h("i", { class: "ui-chart-w" });
      probe._fxChart = rec;
      host.append(probe);
      RO.observe(probe);
    } else repaint(rec, undefined, true);
    return {
      el: host,
      redraw: (animate) => repaint(rec, !!animate, true),
      set: (next, animate) => { rec.draw = next; repaint(rec, animate === undefined ? undefined : !!animate, true); },
      destroy: () => { drop(rec); host._fxChart = null; host._scrubAt = -1; releaseHost(host); host.replaceChildren(); },
    };
  }
  function svgRoot(host, w, H, animate, label) {
    const rec = host._fxChart;
    const at = { width: w, height: H, viewBox: `0 0 ${w} ${H}`, role: "img", "aria-label": label || "" };
    let svg = rec && rec.keep;
    if (svg) {
      rec.keep = null;
      for (const a of [...svg.attributes]) svg.removeAttribute(a.name);
      svg.replaceChildren();
      for (const k in at) svg.setAttribute(k, at[k]);
    } else svg = s("svg", at);
    if (!animate) svg.classList.add("no-anim");
    host.append(svg);
    if (rec) rec.svg = svg;
    return svg;
  }
  const lin = (d0, d1, r0, r1) => {
    const k = (r1 - r0) / ((d1 - d0) || 1);
    const f = (v) => r0 + (v - d0) * k;
    f.inv = (p) => d0 + (p - r0) / k;
    return f;
  };
  function niceTicks(a, b, n) {
    const span = b - a;
    if (!(span > 0)) return [a];
    const step0 = span / Math.max(1, n);
    const mag = 10 ** Math.floor(Math.log10(step0));
    const err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  const fx1 = (v) => (Math.round(v * 10) / 10).toString();
  const pathOf = (pts) => pts.map((p, i) => (i ? "L" : "M") + fx1(p[0]) + " " + fx1(p[1])).join("");
  function monoPath(pts) {
    const n = pts.length;
    if (n < 3) return pathOf(pts);
    const dx = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    const t = [m[0]];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) t[i] = 0;
      else { const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1]; t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]); }
    }
    t[n - 1] = m[n - 2];
    let d = "M" + fx1(pts[0][0]) + " " + fx1(pts[0][1]);
    for (let i = 0; i < n - 1; i++) {
      const k = dx[i] / 3;
      d += "C" + fx1(pts[i][0] + k) + " " + fx1(pts[i][1] + t[i] * k) + " " + fx1(pts[i + 1][0] - k) + " " +
        fx1(pts[i + 1][1] - t[i + 1] * k) + " " + fx1(pts[i + 1][0]) + " " + fx1(pts[i + 1][1]);
    }
    return d;
  }
  function vGrad(svg, color, a0, a1, across) {
    const id = nextId("gr");
    const defs = svg.querySelector("defs") || s("defs", null, svg);
    const g = s("linearGradient", { id, x1: 0, y1: 0, x2: across ? 1 : 0, y2: across ? 0 : 1 }, defs);
    s("stop", { offset: 0, "stop-color": color, "stop-opacity": a0 }, g);
    s("stop", { offset: 1, "stop-color": color, "stop-opacity": a1 }, g);
    return `url(#${id})`;
  }
  function clipRect(svg, x, y, w, hgt) {
    const id = nextId("cp");
    const defs = svg.querySelector("defs") || s("defs", null, svg);
    s("rect", { x, y, width: Math.max(0, w), height: Math.max(0, hgt) }, s("clipPath", { id }, defs));
    return `url(#${id})`;
  }
  function spread(items, gap, lo, hi) {
    items.sort((a, b) => a.y - b.y);
    for (let it = 0; it < 80; it++) {
      let moved = false;
      for (let i = 1; i < items.length; i++) {
        const d = items[i].y - items[i - 1].y;
        if (d < gap) { const p = (gap - d) / 2; items[i - 1].y -= p; items[i].y += p; moved = true; }
      }
      for (const t of items) t.y = clamp(t.y, lo, hi);
      if (!moved) break;
    }
    return items;
  }
  function marker(g, shape, x, y, color, r = 4) {
    if (shape === "dia") return s("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 1.2, fill: color, transform: `rotate(45 ${x} ${y})` }, g);
    if (shape === "tri") return s("path", { d: `M${x} ${y - r - 0.5}L${x + r + 0.5} ${y + r - 0.5}L${x - r - 0.5} ${y + r - 0.5}Z`, fill: color }, g);
    if (shape === "ring") return s("circle", { cx: x, cy: y, r: r - 0.5, fill: "none", stroke: color, "stroke-width": 1.5 }, g);
    return s("circle", { cx: x, cy: y, r, fill: color }, g);
  }
  const part = (t, cls, toneV) => h("span", { class: cls || null, "data-tone": toneV || null }, t);
  const tw = (text) => String(text).length * 6.4 + 12;
  const heightFor = (hgt, w, fallback) => {
    const v = hgt === undefined ? fallback : hgt;
    if (Array.isArray(v)) return w < 600 ? v[0] : w < 900 ? (v[1] ?? v[0]) : (v[2] ?? v[1] ?? v[0]);
    return v;
  };

  function hostSignal(host, key) {
    if (host[key]) host[key].abort();
    const off = new AbortController();
    host[key] = off;
    return { signal: off.signal };
  }
  function releaseHost(host) {
    for (const key of ["_scrubOff", "_heatOff"]) if (host[key]) { host[key].abort(); host[key] = null; }
  }

  function scrub(host, svg, o) {
    const xs = o.xs;
    const on = hostSignal(host, "_scrubOff");
    const keep = host._scrubAt >= 0 && xs.length ? Math.min(host._scrubAt, xs.length - 1) : -1;
    const readout = h("div", { class: "ui-readout" + (keep >= 0 ? " is-on" : ""), ...AH });
    host.append(readout);
    const xh = s("line", { class: "xh", y1: o.top, y2: o.bottom, x1: -10, x2: -10, opacity: 0 }, svg);
    const dots = s("g", null, svg);
    let idx = -1;
    host.tabIndex = 0;
    host.setAttribute("role", "group");
    host.setAttribute("aria-roledescription", "chart");
    if (o.label) host.setAttribute("aria-label", o.label + ". Use the arrow keys to read values.");
    const nearest = (x) => {
      let lo = 0, hi = xs.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m; else hi = m; }
      return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
    };
    const show = (i, speak) => {
      if (i < 0 || i >= xs.length || on.signal.aborted) return;
      idx = host._scrubAt = i;
      const r = o.onMove(i) || {};
      const x = r.x ?? xs[i];
      xh.setAttribute("x1", x); xh.setAttribute("x2", x); xh.setAttribute("opacity", r.noLine ? 0 : 0.7);
      dots.replaceChildren();
      for (const d of r.dots || []) s("circle", { cx: d.x, cy: d.y, r: 4, fill: paint(d.color), class: "ring" }, dots);
      readout.replaceChildren(...(r.parts || []).filter(Boolean));
      readout.classList.add("is-on");
      const w = host.clientWidth, rw = readout.offsetWidth;
      readout.style.left = clamp(x - rw / 2, 0, Math.max(0, w - rw)) + "px";
      readout.style.top = (r.top ?? 0) + "px";
      if (speak) announce(spoken(readout));
    };
    let raf = 0, px = 0;
    const hide = () => { host._scrubAt = -1; if (raf) { cancelAnimationFrame(raf); raf = 0; } readout.classList.remove("is-on"); xh.setAttribute("opacity", 0); dots.replaceChildren(); };
    const at = (cx) => { const b = svg.getBoundingClientRect(); return (cx - b.left) * (svg.viewBox.baseVal.width / b.width); };
    host.addEventListener("pointermove", (e) => {
      px = e.clientX;
      if (!raf) raf = RAF(() => { raf = 0; show(nearest(at(px))); });
    }, on);
    host.addEventListener("pointerdown", (e) => show(nearest(at(e.clientX))), on);
    host.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); }, on);
    host.addEventListener("pointercancel", hide, on);
    host.addEventListener("blur", hide, on);
    host.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); show(clamp((idx < 0 ? xs.length - 1 : idx) + (k === "ArrowRight" ? 1 : -1), 0, xs.length - 1), true); }
      else if (k === "Home") { e.preventDefault(); show(0, true); }
      else if (k === "End") { e.preventDefault(); show(xs.length - 1, true); }
      else if (k === "Escape") hide();
    }, on);
    if (keep >= 0) show(keep);
    return { show, hide };
  }

  const xDate = (v) => typeof v === "string" && isoDay(v);
  function dateTicks(xs, xAt, n, left, right, phone) {
    const out = [];
    const N = xs.length;
    if (N <= 32) {
      const every = Math.max(3, Math.round(N / (phone ? 3 : 5)));
      for (let i = N - 1 - every; i > 0; i -= every) out.push({ i, text: F.day(xs[i]) });
    } else {
      let last = null;
      xs.forEach((d, i) => {
        const m = d.slice(0, 7);
        if (last !== null && m !== last) out.push({ i, text: N > 400 ? d.slice(0, 4) === last.slice(0, 4) ? MON[+d.slice(5, 7) - 1] : d.slice(0, 4) : MON[+d.slice(5, 7) - 1] });
        last = m;
      });
    }
    return out.filter((t) => xAt(t.i) > left + 14 && xAt(t.i) < right - 14);
  }

  function line(host, o) {
    const m = mount(host, (el, w, animate) => drawLine(el, w, animate, o));
    const set = m.set;
    m.set = (next, animate) => set(typeof next === "function" ? next : (el, w, a) => drawLine(el, w, a, next), animate);
    return m;
  }
  function drawLine(host, w, animate, o) {
    const series = (o.series || []).filter((sr) => Array.isArray(sr.values));
    const X = Array.isArray(o.x) ? o.x : series.length ? series[0].values.map((_, i) => i) : [];
    const N = X.length;
    const phone = w < 600;
    const H = heightFor(o.height, w, [200, 220, 240]);
    const top = 14, bot = o.xAxis === false ? 8 : 24, left = 2;
    const right = o.gutter ?? (phone ? 54 : 62);
    const isDate = o.xType ? o.xType === "date" : X.length > 0 && xDate(X[0]);
    const isNumX = o.xType === "number";
    if (!N || !series.length) return gone(host, o, "Nothing to draw.", "Chart", H);
    const xMin = isNumX ? Math.min(...X) : 0, xMax = isNumX ? Math.max(...X) : N - 1;
    const tf = isNumX && o.xScale === "sqrt" ? (v) => Math.sqrt(Math.max(0, v)) : isNumX && o.xScale === "log" ? (v) => Math.log(Math.max(1e-9, v)) : (v) => v;
    const xs0 = lin(tf(xMin), xMax === xMin ? tf(xMin) + 1 : tf(xMax), left, w - right);
    const xs = (v) => xs0(tf(v));
    const xAt = (i) => (isNumX ? xs(X[i]) : N === 1 ? (w - right) / 2 : xs0(i));
    const vals = [];
    for (const sr of series) for (const v of sr.values) if (num(v) !== null) vals.push(v);
    for (const r of o.refs || []) if (num(r.y) !== null) vals.push(r.y);
    if (o.zero || o.twoTone) vals.push(0);
    if (!vals.length) { host.append(silent({ state: "quiet", reason: o.empty || "No readings in this window." }, o.label || "Chart", H)); return; }
    let y0 = o.yDomain ? o.yDomain[0] : Math.min(...vals), y1 = o.yDomain ? o.yDomain[1] : Math.max(...vals);
    if (!o.yDomain) { const pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.05 || 1; y0 -= pad; y1 += pad; }
    const y = lin(y0, y1, H - bot, top);
    const svg = svgRoot(host, w, H, animate, o.label);
    const yf = o.yFormat || ((v) => F.num(v));
    const xf = o.xFormat || ((v) => (isDate ? F.day(v) : String(v)));
    const by = o.zero || o.twoTone || o.baseline !== undefined ? y(o.baseline !== undefined ? o.baseline : 0) : H - bot;
    s("line", { x1: left, x2: w - right, y1: by, y2: by, class: "base" }, svg);
    for (const r of o.refs || []) {
      if (num(r.y) === null) continue;
      s("line", { x1: left, x2: w - right, y1: y(r.y), y2: y(r.y), class: "hair", "stroke-dasharray": r.dash ? "2 3" : null, stroke: r.color ? paint(r.color) : null }, svg);
    }
    const tags = [];
    series.forEach((sr, si) => {
      const color = paint(sr.color || (si ? "--s-gray" : "--accent"));
      const segs = [];
      let cur = [];
      sr.values.forEach((v, i) => {
        if (num(v) === null) { if (cur.length) segs.push(cur); cur = []; return; }
        cur.push([xAt(i), y(v)]);
      });
      if (cur.length) segs.push(cur);
      const g = s("g", null, svg);
      for (const seg of segs) {
        const d = sr.smooth === false || o.smooth === false ? pathOf(seg) : monoPath(seg);
        if (seg.length === 1) { s("circle", { cx: seg[0][0], cy: seg[0][1], r: 1.6, fill: color }, g); continue; }
        if (o.twoTone && si === 0) {
          const zy = y(0);
          const ar = d + `L${fx1(seg[seg.length - 1][0])} ${fx1(zy)}L${fx1(seg[0][0])} ${fx1(zy)}Z`;
          const cu = clipRect(svg, 0, 0, w, zy), cd = clipRect(svg, 0, zy, w, H);
          s("path", { d: ar, fill: paint("--up-mark"), "fill-opacity": 0.2, "clip-path": cu, class: "fade" }, g);
          s("path", { d: ar, fill: paint("--down-mark"), "fill-opacity": 0.2, "clip-path": cd, class: "fade" }, g);
          s("path", { d, class: "ln draw", stroke: paint("--up"), pathLength: 1, "clip-path": cu }, g);
          s("path", { d, class: "ln draw", stroke: paint("--down"), pathLength: 1, "clip-path": cd }, g);
          continue;
        }
        if (sr.area) {
          const base = o.baseline !== undefined ? y(o.baseline) : y0 < 0 && y1 > 0 ? y(0) : H - bot;
          const ar = d + `L${fx1(seg[seg.length - 1][0])} ${fx1(base)}L${fx1(seg[0][0])} ${fx1(base)}Z`;
          s("path", { d: ar, fill: vGrad(svg, color, sr.fill ?? 0.18, 0), ...fade("250ms") }, g);
        }
        s("path", {
          d, class: "ln draw", stroke: color, pathLength: 1, "stroke-width": sr.width || null,
          "stroke-dasharray": sr.dash ? "3 3" : null, style: { "--delay": si * 120 + "ms" },
        }, g);
      }
      let li = -1;
      for (let i = N - 1; i >= 0; i--) if (num(sr.values[i]) !== null) { li = i; break; }
      if (li >= 0 && o.endDots !== false) {
        const cx = xAt(li), cy = y(sr.values[li]);
        const dotC = o.twoTone && si === 0 ? paint(sr.values[li] > 0 ? "--up" : sr.values[li] < 0 ? "--down" : "--label-3") : color;
        if (o.live && si === 0) s("circle", { cx, cy, r: 4, fill: dotC, class: "pulse", style: { "animation-delay": -Math.round(((document.timeline && document.timeline.currentTime) || performance.now()) % 2400) + "ms" } }, svg);
        s("circle", { cx, cy, r: 3.5, fill: dotC, class: "ring" }, svg);
        if (o.endLabels !== false) tags.push({ y: cy, y0: cy, text: (sr.format || yf)(sr.values[li]), color: dotC, x0: cx, pri: 1 });
      }
    });
    const yt = niceTicks(y0, y1, 2).filter((v) => y(v) > top + 6 && y(v) < H - bot - 4);
    const tx = w - right + 8;
    spread(tags, 16, top, H - bot);
    const tg = s("g", fade("650ms"), svg);
    for (const t of tags) {
      if (Math.abs(t.y - t.y0) > 2) s("path", { d: `M${fx1(t.x0 + 5)} ${fx1(t.y0)}L${fx1(tx - 3)} ${fx1(t.y)}`, stroke: paint("--label-4"), "stroke-width": 1, fill: "none" }, tg);
      s("text", { x: tx, y: t.y + 3.8, text: t.text, class: "tx-1 tx-b" }, tg);
    }
    if (o.yTicks !== false) {
      for (const v of yt) {
        const yy = y(v);
        if (tags.some((t) => Math.abs(t.y - yy) < 17)) continue;
        s("text", { x: tx, y: yy + 3.8, text: yf(v), class: "tx-3" }, svg);
      }
    }
    if (o.xAxis !== false) {
      const ticks = Array.isArray(o.xTicks) ? o.xTicks.filter((t) => isNumX && num(t.v) !== null && t.v >= xMin && t.v <= xMax).map((t) => ({ x: xs(t.v), text: t.label ?? xf(t.v) }))
        : isDate ? dateTicks(X, xAt, 5, left, w - right, phone)
        : isNumX ? niceTicks(xMin, xMax, phone ? 4 : 6).map((v) => ({ x: xs(v), text: xf(v) }))
          : X.map((v, i) => ({ i, text: xf(v) })).filter((_, i) => i % Math.max(1, Math.ceil(N / (phone ? 4 : 7))) === 0);
      let lastX = -Infinity;
      for (const t of ticks) {
        const x = t.x ?? xAt(t.i);
        if (x < left + 10 || x > w - right + 0.5) continue;
        const edge = x > w - right - 6;
        if (edge && x - lastX < 36) continue;
        s("text", { x: edge ? w - right : x, y: H - 6, text: t.text, "text-anchor": edge ? "end" : "middle" }, svg);
        lastX = x;
      }
    }
    for (const m of o.markers || []) {
      const i = isNumX ? null : X.indexOf(m.x);
      const mx = isNumX ? xs(m.x) : i >= 0 ? xAt(i) : null;
      if (mx === null || num(m.y) === null) continue;
      marker(svg, m.shape || "dot", mx, y(m.y), paint(m.color || "--label-1"), m.r || 3.5);
    }
    if (o.scrub === false) return;
    scrub(host, svg, {
      xs: X.map((_, i) => xAt(i)), top, bottom: H - bot, label: o.label,
      onMove: (i) => {
        if (o.readout) {
          const r = o.readout(i, X[i]);
          if (r && !Array.isArray(r)) return r;
          return { parts: r, dots: series.filter((sr) => num(sr.values[i]) !== null).map((sr, si) => ({ x: xAt(i), y: y(sr.values[i]), color: sr.color || (si ? "--s-gray" : "--accent") })) };
        }
        const parts = [part(xf(X[i]), "k")];
        const dots = [];
        series.forEach((sr, si) => {
          const v = sr.values[i];
          if (series.length > 1 && sr.label) parts.push(part(sr.label, "k"));
          parts.push(num(v) === null ? part("no reading", "k") : h("b", { "data-tone": o.twoTone ? tone(v) : null }, (sr.format || yf)(v)));
          if (num(v) !== null) dots.push({ x: xAt(i), y: y(v), color: o.twoTone ? (v > 0 ? "--up" : v < 0 ? "--down" : "--label-3") : sr.color || (si ? "--s-gray" : "--accent") });
        });
        return { parts, dots };
      },
    });
  }

  function sparkline(host, values, o = {}) {
    return mount(host, (el, w) => {
      const H = o.height || 34;
      const pts = (values || []).map((v, i) => [i, num(v)]).filter((p) => p[1] !== null);
      const svg = s("svg", { class: "ui-spark", width: w, height: H, viewBox: `0 0 ${w} ${H}`, role: "img", "aria-label": o.label || "" }, el);
      if (pts.length < 2) return;
      const vs = pts.map((p) => p[1]).concat(num(o.ref) !== null ? [o.ref] : []);
      let lo = Math.min(...vs), hi = Math.max(...vs);
      if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
      const x = lin(0, (values.length - 1) || 1, 2, w - 5);
      const y = lin(lo, hi, H - 3, 3);
      if (num(o.ref) !== null) s("line", { x1: 0, x2: w, y1: y(o.ref), y2: y(o.ref), class: "hair", stroke: paint("--sep-strong"), "stroke-dasharray": "2 3" }, svg);
      const color = paint(o.color || "--accent");
      const P = pts.map((p) => [x(p[0]), y(p[1])]);
      if (o.area) s("path", { d: monoPath(P) + `L${fx1(P[P.length - 1][0])} ${H}L${fx1(P[0][0])} ${H}Z`, fill: vGrad(svg, color, 0.2, 0) }, svg);
      s("path", { d: monoPath(P), class: "ln", stroke: color }, svg);
      const e = P[P.length - 1];
      s("circle", { cx: e[0], cy: e[1], r: 2.5, fill: color }, svg);
    });
  }

  function bars(host, o) {
    return mount(host, (el, w, animate) => {
      const vals = (o.values || []).map(num);
      const N = vals.length;
      const phone = w < 600;
      const H = heightFor(o.height, w, [200, 220, 240]);
      const top = 22, bot = 24, left = 4, right = o.cumulative ? 44 : 8;
      if (!N) return gone(el, o, "Nothing to draw.", "Chart", H);
      const band = (w - left - right) / N;
      const x = (i) => left + band * (i + 0.5);
      const max = o.max ?? Math.max(...vals.filter((v) => v !== null).map(Math.abs), 1e-9);
      const y = lin(0, max, H - bot, top);
      const svg = svgRoot(el, w, H, animate, o.label);
      s("line", { x1: 0, x2: w - right, y1: H - bot, y2: H - bot, class: "base" }, svg);
      const bw = clamp(band * 0.58, 3, o.maxWidth || 24);
      const color = paint(o.color || "--s-blue");
      vals.forEach((v, i) => {
        if (v === null) { s("circle", { cx: x(i), cy: H - bot, r: 1.6, fill: paint("--label-4") }, svg); return; }
        const hh = Math.max(1.5, y(0) - y(Math.abs(v)));
        s("rect", { x: x(i) - bw / 2, y: y(0) - hh, width: bw, height: hh, rx: Math.min(4, bw / 2), fill: o.colors ? paint(o.colors[i]) : color, "fill-opacity": o.highlight !== undefined && o.highlight !== i ? 0.55 : 1, class: "grow", style: { "--i": i * 3 } }, svg);
      });
      const labels = o.labels || [];
      const every = Math.max(1, Math.ceil(N / (phone ? 5 : 9)));
      labels.forEach((l, i) => { if (i % every === 0 && l !== undefined) s("text", { x: x(i), y: H - 7, text: l, ...TA }, svg); });
      let cumY = null;
      if (Array.isArray(o.cumulative)) {
        const cy = lin(0, 1, H - bot, top);
        const pts = [];
        o.cumulative.forEach((c, i) => {
          if (num(c) === null) return;
          if (pts.length) pts.push([x(i) - band / 2, pts[pts.length - 1][1]]);
          pts.push([x(i) - band / 2, cy(c)], [x(i) + band / 2, cy(c)]);
        });
        if (pts.length) {
          s("line", { x1: 0, x2: w - right, y1: cy(0.5), y2: cy(0.5), class: "hair" }, svg);
          s("text", { x: w - right + 6, y: cy(0.5) + 4, text: "50%", class: "tx-3" }, svg);
          s("path", { d: pathOf(pts), class: "ln draw", stroke: paint("--label-1"), "stroke-opacity": 0.8, pathLength: 1, style: { "--delay": "300ms" } }, svg);
          const last = o.cumulative[o.cumulative.length - 1];
          if (num(last) !== null) s("text", { x: w - right + 6, y: cy(last) + 4, text: F.pct(last, 0), class: "tx-1 tx-b" }, svg);
          cumY = cy;
        }
      }
      const fmt = o.format || ((v) => F.num(v));
      scrub(el, svg, {
        xs: vals.map((_, i) => x(i)), top, bottom: H - bot, label: o.label,
        onMove: (i) => {
          if (o.readout) return { parts: o.readout(i) };
          const v = vals[i];
          return {
            parts: [part(labels[i] ?? String(i + 1), "k"), v === null ? part("no reading", "k") : h("b", null, fmt(v)), cumY && num(o.cumulative[i]) !== null ? part("cum " + F.pct(o.cumulative[i], 0), "k") : null],
            dots: v === null ? [] : [{ x: x(i), y: y(0) - Math.max(1.5, y(0) - y(Math.abs(v))), color: o.color || "--s-blue" }],
          };
        },
      });
    });
  }

  const PALETTES = {
    direction: { pos: "--up-mark", neg: "--down-mark", posT: "up", negT: "down" },
    gamma: { pos: "--g-long", neg: "--g-short", posT: "long", negT: "short" },
  };

  function diverging(host, o) {
    return mount(host, (el, w, animate) => {
      const vals = (o.values || []).map(num);
      const N = vals.length;
      const phone = w < 600;
      const H = heightFor(o.height, w, [200, 230, 260]);
      const isNumX = o.xType === "number" || (Array.isArray(o.x) && o.x.length && typeof o.x[0] === "number" && o.xType !== "index");
      const X = Array.isArray(o.x) ? o.x : vals.map((_, i) => i);
      const top = num(o.spot) !== null ? 34 : 18, bot = 24 + (o.baseMarkers ? 10 : 0), left = 8, right = o.endLabel ? 60 : 8;
      if (!N) return gone(el, o, "Nothing to draw.", "Chart", H);
      const pal = PALETTES[o.palette || "direction"] || PALETTES.direction;
      let lo = isNumX ? Math.min(...X) : 0, hi = isNumX ? Math.max(...X) : N - 1;
      if (isNumX && o.domain) { lo = o.domain[0]; hi = o.domain[1]; }
      const band = isNumX ? null : (w - left - right) / N;
      const xs = isNumX ? lin(lo, hi, left + 6, w - right - 6) : null;
      const xAt = (i) => (isNumX ? xs(X[i]) : left + band * (i + 0.5));
      const max = o.max ?? Math.max(...vals.filter((v) => v !== null).map(Math.abs), 1e-9);
      const mid = top + (H - top - bot) / 2;
      const half = (H - top - bot) / 2 - 6;
      const svg = svgRoot(el, w, H, animate, o.label);
      s("line", { x1: 0, x2: w - right, y1: mid, y2: mid, class: "base" }, svg);
      let step = band;
      if (isNumX) {
        const sorted = X.slice().sort((a, b) => a - b);
        const diffs = sorted.slice(1).map((v, i) => v - sorted[i]).filter((d) => d > 0);
        step = diffs.length ? xs(lo + Math.min(...diffs)) - xs(lo) : 12;
      }
      const bw = clamp(step * 0.64, 2, o.maxWidth || 14);
      const hl = new Set(o.highlight || []);
      const hOf = (v) => Math.max(1, (Math.abs(v) / max) * half);
      vals.forEach((v, i) => {
        const cx = xAt(i);
        if (cx < -2 || cx > w + 2) return;
        if (v === null) { s("circle", { cx, cy: mid, r: 1.6, fill: paint("--label-4") }, svg); return; }
        if (v === 0) { s("rect", { x: cx - bw / 2, y: mid - 0.5, width: bw, height: 1, fill: paint("--label-3"), class: "zero" }, svg); return; }
        const hh = hOf(v);
        const pos = v > 0;
        s("rect", {
          x: cx - bw / 2, y: pos ? mid - hh : mid, width: bw, height: hh, rx: Math.min(3, bw / 2),
          fill: paint(pos ? pal.pos : pal.neg), "fill-opacity": hl.size && !hl.has(X[i]) ? 0.8 : 1,
          class: "grow", style: { "--i": i, "--origin": pos ? "bottom" : "top" },
        }, svg);
      });
      for (const m of o.markers || []) {
        if (!isNumX || m.x < lo || m.x > hi) continue;
        const mx = xs(m.x);
        if (m.rule) s("line", { x1: mx, x2: mx, y1: top, y2: H - bot, stroke: paint(m.color), "stroke-width": 1, "stroke-opacity": 0.6, "stroke-dasharray": "2 3" }, svg);
        marker(svg, m.shape || "dot", mx, m.row === "base" ? H - bot + 6 : top - 2, paint(m.color || "--label-1"), m.r || 4);
      }
      let pill = null;
      if (isNumX && num(o.spot) !== null && o.spot >= lo && o.spot <= hi) {
        const sx = xs(o.spot);
        const text = F.px(o.spot);
        const pw = tw(text);
        pill = { sx, x0: clamp(sx - pw / 2, 0, w - pw), pw, text };
      }
      for (const l of o.labels || []) {
        const i = X.indexOf(l.x);
        if (i < 0 || vals[i] === null) continue;
        const hh = hOf(vals[i]);
        const ly = vals[i] >= 0 ? mid - hh - 7 : mid + hh + 14;
        let lx = xAt(i);
        const lw = tw(l.text);
        if (pill && ly - 10 < top - 8 && lx + lw / 2 + 3 > pill.x0 && lx - lw / 2 - 3 < pill.x0 + pill.pw) {
          lx = lx >= pill.sx ? pill.x0 + pill.pw + lw / 2 + 3 : pill.x0 - lw / 2 - 3;
        }
        s("text", { x: clamp(lx, lw / 2, w - lw / 2), y: ly, text: l.text, ...TA, class: "tx-1 tx-b" }, svg);
      }
      if (pill) {
        s("line", { x1: pill.sx, x2: pill.sx, y1: top - 10, y2: H - bot, stroke: paint("--label-1"), "stroke-width": 1.25 }, svg);
        s("rect", { x: pill.x0, y: top - 28, width: pill.pw, height: 18, rx: 9, fill: paint("--label-1") }, svg);
        s("text", { x: pill.x0 + pill.pw / 2, y: top - 15.5, text: pill.text, ...TA, class: "tx-b tx-ink" }, svg);
      }
      if (o.endLabel) {
        let li = -1;
        for (let i = N - 1; i >= 0; i--) if (vals[i] !== null) { li = i; break; }
        if (li >= 0) {
          const hh = hOf(vals[li]);
          s("text", { x: w - right + 8, y: vals[li] >= 0 ? mid - hh + 4 : mid + hh + 4, text: (o.format || F.num)(vals[li], true), class: "tx-1 tx-b" }, svg);
        }
      }
      const xf = o.xFormat || ((v) => (typeof v === "string" && isoDay(v) ? F.day(v) : String(v)));
      if (isNumX) {
        for (const t of niceTicks(lo, hi, phone ? 4 : 7)) s("text", { x: xs(t), y: H - 4, text: xf(t), ...TA }, svg);
      } else if (typeof X[0] === "string" && isoDay(X[0])) {
        for (const t of dateTicks(X, xAt, 5, left, w - right, phone)) s("text", { x: xAt(t.i), y: H - 4, text: t.text, ...TA }, svg);
      } else {
        const every = Math.max(1, Math.ceil(N / (phone ? 5 : 9)));
        X.forEach((v, i) => { if (i % every === 0) s("text", { x: xAt(i), y: H - 4, text: xf(v), ...TA }, svg); });
      }
      const fmt = o.format || ((v) => F.num(v, true));
      const order = X.map((_, i) => i).sort((a, b) => xAt(a) - xAt(b));
      scrub(el, svg, {
        xs: order.map(xAt), top, bottom: H - bot, label: o.label,
        onMove: (j) => {
          const i = order[j];
          const v = vals[i];
          if (o.readout) return { parts: o.readout(i) };
          return {
            parts: [part(xf(X[i]), "k"), v === null ? part("no reading", "k") : h("b", { "data-tone": v < 0 ? pal.negT : v > 0 ? pal.posT : null }, fmt(v))],
            dots: v === null ? [] : [{ x: xAt(i), y: v > 0 ? mid - hOf(v) : v < 0 ? mid + hOf(v) : mid, color: v > 0 ? pal.pos : v < 0 ? pal.neg : "--label-3" }],
          };
        },
      });
    });
  }

  function heatmap(host, o) {
    return mount(host, (el, w, animate) => {
      const rows = o.rows || [], cols = o.cols || [], grid = o.grid || [];
      const R = rows.length, C = cols.length;
      if (!R || !C) return gone(el, o, "No grid.", "Grid", 200);
      const phone = w < 600;
      const left = o.left ?? 48, top = 6, bottom = 22;
      const cw = (w - left) / C;
      const ch = o.cellH || (phone ? 14 : 16);
      const H = top + R * ch + bottom;
      const flat = grid.flat().map(num).filter((v) => v !== null);
      const cap = o.cap || Math.max(...flat.map(Math.abs), 1e-9);
      const pal = PALETTES[o.palette || "gamma"] || PALETTES.gamma;
      const svg = svgRoot(el, w, H, animate, o.label);
      const rf = o.rowFormat || String, cf = o.colFormat || String;
      const every = R > 18 ? 2 : 1;
      for (let r = 0; r < R; r++) {
        const yy = top + r * ch;
        for (let c = 0; c < C; c++) {
          const v = num(grid[r] && grid[r][c]);
          const cell = { x: left + c * cw + 1, y: yy + 1, width: Math.max(0, cw - 2), height: ch - 2, rx: 2.5 };
          if (v === null) { s("rect", { ...cell, fill: "none", stroke: paint("--label-4"), "stroke-width": 1, "stroke-dasharray": "2 2", class: "void" }, svg); continue; }
          if (v === 0) { s("rect", { ...cell, fill: paint("--fill-4"), class: "zero" }, svg); continue; }
          const a = clamp(Math.sqrt(Math.abs(v) / cap), 0.08, 1);
          s("rect", { ...cell, fill: paint(v > 0 ? pal.pos : v < 0 ? pal.neg : "--fill-4"), "fill-opacity": a.toFixed(3), ...fade(c * 40 + "ms") }, svg);
        }
        if (r % every === 0 || r === o.highlightRow) s("text", { x: left - 8, y: yy + ch / 2 + 3.5, text: rf(rows[r]), "text-anchor": "end", class: r === o.highlightRow ? "tx-1 tx-b" : null }, svg);
      }
      if (num(o.highlightRow) !== null) s("circle", { cx: left - 3, cy: top + o.highlightRow * ch + ch / 2, r: 2.5, fill: paint("--label-1") }, svg);
      const everyX = cw < 40 ? 2 : 1;
      const hc = num(o.highlightCol);
      const hcIn = hc !== null && hc >= 0 && hc < C;
      if (hcIn) s("rect", { x: left + hc * cw + 0.5, y: top - 0.5, width: Math.max(0, cw - 1), height: R * ch + 1, rx: 3.5, fill: "none", stroke: paint("--accent"), "stroke-width": 1.25 }, svg);
      const phase = hcIn ? hc % everyX : 0;
      cols.forEach((c, i) => { if (i % everyX === phase) s("text", { x: left + i * cw + cw / 2, y: H - 6, text: cf(c), ...TA, class: i === hc ? "tx-1 tx-b" : null }, svg); });
      const hl = s("rect", { class: "cell-hl", x: 0, y: 0, width: Math.max(0, cw - 1), height: ch - 1, rx: 3, visibility: "hidden" }, svg);
      const readout = h("div", { class: "ui-readout", ...AH });
      el.append(readout);
      el.tabIndex = 0;
      el.setAttribute("role", "group");
      el.setAttribute("aria-roledescription", "chart");
      el.setAttribute("aria-label", (o.label || "Grid") + ". Use the arrow keys to move between cells.");
      let cur = [Math.floor(R / 2), C - 1];
      const fmt = o.format || ((v) => F.num(v, true));
      const show = (r, c, speak) => {
        cur = [r, c];
        const v = num(grid[r] && grid[r][c]);
        const xx = left + c * cw, yy = top + r * ch;
        hl.setAttribute("x", xx + 0.5);
        hl.setAttribute("y", yy + 0.5);
        hl.setAttribute("visibility", "visible");
        readout.replaceChildren(part(cf(cols[c]), "k"), h("b", null, rf(rows[r])), v === null ? part("no reading", "k") : part(fmt(v), null, v > 0 ? pal.posT : v < 0 ? pal.negT : null));
        readout.classList.add("is-on");
        const rw = readout.offsetWidth;
        readout.style.left = clamp(xx + cw / 2 - rw / 2, 0, Math.max(0, w - rw)) + "px";
        readout.style.top = Math.max(0, yy - 32) + "px";
        if (speak) announce(spoken(readout));
      };
      let raf = 0, pt = null;
      const hide = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } readout.classList.remove("is-on"); hl.setAttribute("visibility", "hidden"); };
      const on = hostSignal(el, "_heatOff");
      on.signal.addEventListener("abort", () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } });
      el.addEventListener("pointermove", (e) => {
        pt = [e.clientX, e.clientY];
        if (raf) return;
        raf = RAF(() => {
          raf = 0;
          const b = svg.getBoundingClientRect();
          const c = Math.floor((pt[0] - b.left - left) / cw), r = Math.floor((pt[1] - b.top - top) / ch);
          if (c < 0 || c >= C || r < 0 || r >= R) return;
          show(r, c);
        });
      }, on);
      el.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); }, on);
      el.addEventListener("blur", hide, on);
      el.addEventListener("keydown", (e) => {
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        if (d) { e.preventDefault(); show(clamp(cur[0] + d[0], 0, R - 1), clamp(cur[1] + d[1], 0, C - 1), true); }
        else if (e.key === "Escape") hide();
      }, on);
    });
  }

  function gauge(o = {}) {
    const size = o.size || 132;
    const stroke = o.stroke || 8;
    const arc = o.arc === 180 ? 180 : 270;
    const min = o.min ?? 0, max = o.max ?? 100;
    const v = num(o.value);
    const H = arc === 180 ? Math.round(size * 0.58) : size;
    const R = size / 2 - stroke / 2 - 2;
    const cx = size / 2, cy = arc === 180 ? H - stroke / 2 - 2 : size / 2;
    const a0 = arc === 180 ? Math.PI : Math.PI * 0.75;
    const sweep = arc === 180 ? Math.PI : Math.PI * 1.5;
    const pt = (f) => [cx + R * Math.cos(a0 + sweep * f), cy + R * Math.sin(a0 + sweep * f)];
    const arcPath = (f0, f1) => {
      const [x0, y0] = pt(f0), [x1, y1] = pt(f1);
      return `M${fx1(x0)} ${fx1(y0)}A${fx1(R)} ${fx1(R)} 0 ${Math.abs(f1 - f0) * sweep > Math.PI ? 1 : 0} 1 ${fx1(x1)} ${fx1(y1)}`;
    };
    const svg = s("svg", { class: "ui-gauge ui-svg", width: size, height: H, viewBox: `0 0 ${size} ${H}`, role: "img", "aria-label": o.label || "" });
    const ARC = { fill: "none", "stroke-width": stroke, "stroke-linecap": "round" };
    s("path", { d: arcPath(0, 1), ...ARC, stroke: paint("--fill-2") }, svg);
    if (v !== null) {
      const f = clamp((v - min) / ((max - min) || 1), 0, 1);
      if (o.diverging) {
        const fz = clamp((0 - min) / ((max - min) || 1), 0, 1);
        if (Math.abs(f - fz) > 0.002) s("path", { d: f < fz ? arcPath(f, fz) : arcPath(fz, f), ...ARC, stroke: paint(o.color || (v > 0 ? "--up-mark" : v < 0 ? "--down-mark" : "--label-3")) }, svg);
        const [tx0, ty0] = pt(fz);
        const dx = tx0 - cx, dy = ty0 - cy, dl = Math.hypot(dx, dy) || 1;
        s("line", { x1: cx + dx / dl * (R - stroke), y1: cy + dy / dl * (R - stroke), x2: cx + dx / dl * (R + stroke), y2: cy + dy / dl * (R + stroke), stroke: paint("--label-3"), "stroke-width": 1.5 }, svg);
      } else if (f > 0.002) {
        s("path", { d: arcPath(0, f), ...ARC, stroke: paint(o.color || "--accent") }, svg);
      }
    }
    if (o.text !== false) {
      const ty = arc === 180 ? cy - 6 : cy + 11;
      const t = s("text", {
        x: cx, y: ty, ...TA, ...AH,
        text: o.text ?? (v === null ? DASH : o.diverging ? F.signed(v) : String(Math.round(v))),
        style: { font: size >= 110 ? "var(--t-large)" : "var(--t-headline)", "letter-spacing": "var(--t-large-track)", fill: paint(o.textColor || (o.diverging && v !== null ? (v < 0 ? "--down" : v > 0 ? "--up" : "--label-1") : "--label-1")) },
      }, svg);
      t.setAttribute("data-gauge", "value");
      if (o.caption) s("text", { x: cx, y: ty + 18, ...TA, text: o.caption, class: "tx-3" }, svg);
    }
    return svg;
  }

  const LEVELS = {
    gamma_flip: { color: "--lvl-flip", shape: "dia", label: "Flip" },
    call_wall: { color: "--lvl-call", shape: "dot", label: "Call wall" },
    put_wall: { color: "--lvl-put", shape: "dot", label: "Put wall" },
    max_pain: { color: "--lvl-pain", shape: "dia", label: "Max pain" },
  };

  function tent(c, wd, base, peak) { const out = []; for (let i = 0; i <= 40; i++) { const x = i / 40; out.push([x, base + (peak - base) * Math.exp(-(((x - c) / wd) ** 2))]); } return out; }
  const SHAPES = {
    "long call": [[0, -0.45], [0.5, -0.45], [1, 0.95]],
    "long put": [[0, 0.95], [0.5, -0.45], [1, -0.45]],
    "call debit spread": [[0, -0.5], [0.38, -0.5], [0.62, 0.7], [1, 0.7]],
    "bull call spread": [[0, -0.5], [0.38, -0.5], [0.62, 0.7], [1, 0.7]],
    "put debit spread": [[0, 0.7], [0.38, 0.7], [0.62, -0.5], [1, -0.5]],
    "bear put spread": [[0, 0.7], [0.38, 0.7], [0.62, -0.5], [1, -0.5]],
    "put credit spread": [[0, -0.85], [0.38, -0.85], [0.62, 0.38], [1, 0.38]],
    "bull put spread": [[0, -0.85], [0.38, -0.85], [0.62, 0.38], [1, 0.38]],
    "call credit spread": [[0, 0.38], [0.38, 0.38], [0.62, -0.85], [1, -0.85]],
    "bear call spread": [[0, 0.38], [0.38, 0.38], [0.62, -0.85], [1, -0.85]],
    "long straddle": [[0, 0.9], [0.5, -0.55], [1, 0.9]],
    "short straddle": [[0, -0.9], [0.5, 0.55], [1, -0.9]],
    "long strangle": [[0, 0.85], [0.33, -0.45], [0.67, -0.45], [1, 0.85]],
    "short strangle": [[0, -0.85], [0.33, 0.45], [0.67, 0.45], [1, -0.85]],
    "iron condor": [[0, -0.7], [0.2, -0.7], [0.36, 0.4], [0.64, 0.4], [0.8, -0.7], [1, -0.7]],
    "iron butterfly": [[0, -0.6], [0.25, -0.6], [0.5, 0.75], [0.75, -0.6], [1, -0.6]],
    "butterfly": [[0, -0.35], [0.3, -0.35], [0.5, 0.85], [0.7, -0.35], [1, -0.35]],
    "long butterfly": [[0, -0.35], [0.3, -0.35], [0.5, 0.85], [0.7, -0.35], [1, -0.35]],
    "calendar spread": tent(0.5, 0.17, -0.5, 0.8),
    "diagonal spread": tent(0.55, 0.2, -0.5, 0.75),
    "risk reversal": [[0, -0.9], [0.4, 0], [0.6, 0], [1, 0.9]],
    "collar": [[0, -0.5], [0.35, -0.5], [0.65, 0.5], [1, 0.5]],
    "covered call": [[0, -0.9], [0.6, 0.45], [1, 0.45]],
  };
  const shapeOf = (structure) => SHAPES[String(structure || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim()] || null;

  function payoff(host, o = {}) {
    if (!host) {
      const pts = Array.isArray(o.shape) ? o.shape : shapeOf(o.structure);
      const W = 92, Hh = 48;
      const svg = s("svg", { class: "ui-payoff", width: W, height: Hh, viewBox: `0 0 ${W} ${Hh}`, ...AH });
      if (!pts) {
        const g = glyph("pending");
        g.setAttribute("x", 34); g.setAttribute("y", 12); g.setAttribute("width", 24); g.setAttribute("height", 24);
        g.style.color = paint("--label-3");
        svg.append(g);
        return svg;
      }
      const P = pts.map(([x, v]) => [4 + x * (W - 8), Hh / 2 - v * (Hh / 2 - 5)]);
      const d = pathOf(P);
      const fill = d + `L${fx1(P[P.length - 1][0])} ${Hh / 2}L${fx1(P[0][0])} ${Hh / 2}Z`;
      s("path", { d: fill, fill: paint("--up"), "fill-opacity": 0.28, "clip-path": clipRect(svg, 0, 0, W, Hh / 2) }, svg);
      s("path", { d: fill, fill: paint("--down"), "fill-opacity": 0.24, "clip-path": clipRect(svg, 0, Hh / 2, W, Hh / 2) }, svg);
      s("line", { x1: 2, x2: W - 2, y1: Hh / 2, y2: Hh / 2, class: "zero" }, svg);
      s("path", { d, class: "pl" }, svg);
      return svg;
    }
    return mount(host, (el, w, animate) => {
      const P0 = (o.points || []).filter((p) => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null).sort((a, b) => a[0] - b[0]);
      const H = heightFor(o.height, w, [220, 240, 260]);
      if (P0.length < 2) { el.append(silent({ state: "pending", reason: o.empty || "The structure is not priced yet." }, o.label || "Payoff", H)); return; }
      const top = 20, bot = 24, left = 8, right = 64;
      const xs = P0.map((p) => p[0]), vs = P0.map((p) => p[1]);
      const x = lin(Math.min(...xs), Math.max(...xs), left, w - right);
      let v0 = Math.min(0, ...vs), v1 = Math.max(0, ...vs);
      const pad = (v1 - v0) * 0.1 || 1;
      v0 -= pad; v1 += pad;
      const y = lin(v0, v1, H - bot, top);
      const svg = svgRoot(el, w, H, animate, o.label);
      const P = P0.map((p) => [x(p[0]), y(p[1])]);
      const d = pathOf(P);
      const zy = y(0);
      const fill = d + `L${fx1(P[P.length - 1][0])} ${fx1(zy)}L${fx1(P[0][0])} ${fx1(zy)}Z`;
      s("path", { d: fill, fill: paint("--up-mark"), "fill-opacity": 0.22, "clip-path": clipRect(svg, 0, 0, w, zy), class: "fade" }, svg);
      s("path", { d: fill, fill: paint("--down-mark"), "fill-opacity": 0.2, "clip-path": clipRect(svg, 0, zy, w, H), class: "fade" }, svg);
      s("line", { x1: left, x2: w - right, y1: zy, y2: zy, class: "base" }, svg);
      if (Array.isArray(o.projected)) {
        const Q = o.projected.filter((p) => num(p[0]) !== null && num(p[1]) !== null).map((p) => [x(p[0]), y(p[1])]);
        if (Q.length > 1) s("path", { d: monoPath(Q), class: "ln fade", stroke: paint("--accent"), "stroke-dasharray": "3 3" }, svg);
      }
      s("path", { d, class: "ln draw", stroke: paint("--label-1"), pathLength: 1 }, svg);
      for (const b of o.breakevens || []) if (num(b) !== null) marker(svg, "ring", x(b), zy, paint("--label-1"), 4.5);
      if (num(o.spot) !== null) {
        const sx = x(o.spot);
        s("line", { x1: sx, x2: sx, y1: top - 6, y2: H - bot, stroke: paint("--label-2"), "stroke-width": 1, "stroke-dasharray": "2 3" }, svg);
        s("text", { x: sx, y: top - 8, text: F.px(o.spot), ...TA, class: "tx-1 tx-b" }, svg);
      }
      const fmt = o.format || ((v) => F.money(v, true));
      const mx = Math.max(...vs), mn = Math.min(...vs);
      s("text", { x: w - right + 8, y: y(mx) + 4, text: o.maxLabel || fmt(mx), class: "tx-1 tx-b" }, svg);
      s("text", { x: w - right + 8, y: y(mn) + 4, text: o.minLabel || fmt(mn), class: "tx-1 tx-b" }, svg);
      for (const t of niceTicks(Math.min(...xs), Math.max(...xs), w < 600 ? 4 : 6)) s("text", { x: x(t), y: H - 6, text: String(t), ...TA }, svg);
      scrub(el, svg, {
        xs: P.map((p) => p[0]), top, bottom: H - bot, label: o.label,
        onMove: (i) => ({ dots: [{ x: P[i][0], y: P[i][1], color: P0[i][1] > 0 ? "--up" : P0[i][1] < 0 ? "--down" : "--label-3" }], parts: [part("At " + F.px(P0[i][0]), "k"), h("b", { "data-tone": tone(P0[i][1]) }, fmt(P0[i][1]))] }),
      });
    });
  }

  function nyClock(d) {
    const p = Object.fromEntries(ET_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, mins: (+p.hour % 24) * 60 + +p.minute };
  }
  function localExpected(n) {
    if (n.wd !== "Sat" && n.wd !== "Sun" && n.mins >= 1260) return n.date;
    let t = Date.parse(n.date + "T12:00:00Z");
    do { t -= 864e5; } while ([0, 6].includes(new Date(t).getUTCDay()));
    return new Date(t).toISOString().slice(0, 10);
  }
  const T0 = Date.now();
  const SRV = { day: null, at: 0, ph: null, until: 0, busy: 0, asked: 0, local: null, hbAt: 0 };
  function takeNow(b, hb) {
    if (!b) return;
    SRV.at = Date.now();
    if (hb) SRV.hbAt = SRV.at;
    if (isoDay(b.expected)) { SRV.day = b.expected.slice(0, 10); SRV.local = localExpected(nyClock(new Date())); }
    const t = b.phase ? Date.parse(b.phase.endsAt) : NaN;
    if (t > 0) { SRV.ph = b.phase.phase; SRV.until = t; }
  }
  const pendingNow = () => Date.now() - SRV.hbAt < 39e4 || SRV.busy > 0 || (!SRV.at && Date.now() - T0 < 2e4 && !!window.FlowsUI.heartbeat);
  function watchNow(p, hb) {
    SRV.busy++;
    p.then((r) => r.ok && r.clone().json()).then((b) => takeNow(b, hb), () => {}).then(() => { SRV.busy--; paintFresh(); });
  }
  function confirmExpected() {
    const t = Date.now();
    if (!nativeFetch || GATE.on || pendingNow() || t - SRV.asked < 6e4 || t - SRV.at < 6e4) return;
    SRV.asked = t;
    watchNow(nativeFetch("/api/flows/now", { credentials: "same-origin" }));
  }
  function market(now) {
    const at = now || new Date(), n = nyClock(at);
    const weekday = !["Sat", "Sun"].includes(n.wd);
    const open = SRV.until > at ? SRV.ph === "rth" : weekday && n.mins >= 570 && n.mins < 960;
    const local = localExpected(n);
    if (SRV.day && local > SRV.day && local !== SRV.local) confirmExpected();
    return { open, weekday, today: n.date, expected: SRV.day || local, source: SRV.day ? "server" : "local" };
  }

  const FRESH = { sessionDate: null, primary: null, nightly: null, meta: false, generatedAt: null, updatedAt: null, readAt: null, readSource: null, live: false, transport: null, sources: new Map(), ffs: new Map(), explicit: false, settled: false };
  const NAMES = { strips: "Live prices", news: "Headlines", flowalerts: "Flow alerts", "rt:px": "Streamed prices", "rt:fl": "Streamed flow alerts", "rt:gx": "Streamed gamma", "rt:mk": "Streamed market tide", "rt:nw": "Streamed headlines" };
  const named = (k) => { k = k.replace(/^(?:lk\?k=|live:)|\?.*/g, ""); return NAMES[k] || k[0].toUpperCase() + k.slice(1); };
  function freshAggregate(list, phase) {
    const s = (list || []).filter(Boolean).map((f) => (f.stateAt ? f.stateAt() : f)), has = (x) => s.includes(x);
    return !s.length ? "pending" : has("stale") ? "stale" : has("live") ? "live"
      : (phase && phase !== "rth") || s.every((x) => x === "closed") ? "closed" : has("fresh") ? "fresh" : s[0];
  }
  function freshState() {
    const m = market(new Date());
    const S = FRESH.primary || FRESH.sessionDate || FRESH.nightly;
    const liveNow = FRESH.live && FRESH.readAt && Date.now() - Date.parse(FRESH.readAt) < 3 * 60 * 1000 && m.open;
    let behind = !!S && S < m.expected;
    if (behind && m.source === "local") { confirmExpected(); behind = !pendingNow(); }
    let state;
    if (behind || freshAggregate([...FRESH.ffs.values()]) === "stale") state = "stale";
    else if (!S) state = FRESH.settled ? (m.open ? "fresh" : "closed") : "pending";
    else if (liveNow) state = "live";
    else if (m.open) state = "fresh";
    else state = "closed";
    return { state, market: m, S, behind };
  }
  function freshDetails() {
    const { state, market: m, S, behind: late } = freshState();
    const which = S === m.today ? "today\u2019s session." : "the last completed session, " + F.day(S) + ".";
    const out = [...FRESH.ffs].filter(([, f]) => f.stateAt() === "stale"), lapsed = [...new Set(out.map(([k]) => named(k)))];
    const sources = [...FRESH.sources.entries()];
    const behind = sources.filter(([, v]) => v !== S);
    const total = sources.length + FRESH.ffs.size, bad = behind.length + out.length;
    const lag = behind.length ? " " + bad + " of " + total + " payloads are older: " + behind.map(([k, v]) => named(k) + " " + F.day(v)).join(", ") + "." : "";
    const lead = state === "stale" ? (late ? `These readings are the ${F.day(S)} session; the last completed session is ${F.day(m.expected)}.`
      : "Past the server\u2019s stale line: " + lapsed.join(", ") + ".")
      : state === "live" ? "The market is open and the last price was read moments ago." + (lag || " Everything else is the last completed session.")
        : !S ? (state === "pending" ? "No payload on this page has reported its session yet." : "No session is published yet.")
          : (m.open ? "The market is open. " : "The market is closed. ") + "These readings are " + which + lag;
    const facts = [
      ["Expected", S !== m.expected ? F.day(m.expected) : null],
      ["Market", m.open ? "Open" : "Closed"],
      ["Built", FRESH.generatedAt ? F.time(FRESH.generatedAt) : null],
      ["Written", FRESH.updatedAt ? F.time(new Date(FRESH.updatedAt).toISOString()) : null],
      ["Price read", FRESH.readAt ? F.time(FRESH.readAt) : null],
      ["Feed", FRESH.transport],
      ["Payloads", total ? (bad ? total - bad + " of " + total + " current" : total + " current") : null],
      ...behind.map(([k, v]) => [named(k), F.day(v)]),
    ];
    return {
      title: "Freshness", state, asOf: S ? "Session " + F.day(S) : null, lead, facts,
      notes: ["Readings come from the dated post-close archive. During market hours only price is re-read live."],
    };
  }
  function paintFresh() {
    const b = $("fxFresh");
    if (!b) return;
    const { state, market: m, S, behind } = freshState();
    const def = STATES[state] || STATES.pending;
    const label = state === "live" ? "Live" : state === "stale" && !behind ? "Stale" : S ? (S === m.today ? "Today" : F.day(S)) : state === "pending" ? "Session" : state === "closed" ? "Closed" : "Open";
    const feed = FRESH.transport || "";
    if (b.dataset.state === state && b.dataset.label === label && (b.dataset.feed || "") === feed) return;
    b.dataset.state = state;
    b.dataset.label = label;
    b.dataset.feed = feed;
    b.replaceChildren(glyph(def.g), h("span", { class: "fx-fresh-l" }, label));
    b.setAttribute("aria-label", "Freshness: " + def.word + (S ? ", session " + S : "") + (feed ? ", feed " + feed : ""));
    if (feed) b.title = def.word + " · " + feed;
    else if (b.title) b.title = "";
  }
  function freshness(o = {}) {
    if (o.explicit !== false && !o.ff) FRESH.explicit = true;
    if (o.ff) FRESH.ffs.set(o.source || "page", o.ff);
    if (isoDay(o.sessionDate)) {
      const d = o.sessionDate.slice(0, 10);
      if (o.primary === true) FRESH.primary = d;
      if (!FRESH.sessionDate || d > FRESH.sessionDate) FRESH.sessionDate = d;
      FRESH.sources.set(o.source || "page", d);
    }
    if (typeof o.generatedAt === "string" && (!FRESH.generatedAt || o.generatedAt > FRESH.generatedAt)) FRESH.generatedAt = o.generatedAt;
    if (num(o.updatedAt) !== null && o.updatedAt > 0) FRESH.updatedAt = Math.max(FRESH.updatedAt || 0, o.updatedAt);
    if (typeof o.readAt === "string") { FRESH.readAt = o.readAt; FRESH.live = o.live !== false; FRESH.readSource = o.source || null; }
    FRESH.settled = true;
    paintFresh();
    return freshState().state;
  }
  freshness.drop = (source) => {
    const had = FRESH.ffs.delete(source);
    FRESH.sources.delete(source);
    const claimed = Boolean(source) && FRESH.readSource === source;
    if (claimed) { FRESH.readAt = null; FRESH.live = false; FRESH.readSource = null; }
    if (had || claimed) paintFresh();
    return had;
  };
  freshness.transport = (label) => {
    const next = typeof label === "string" && label ? label : null;
    if (FRESH.transport === next) return;
    FRESH.transport = next;
    paintFresh();
  };
  freshness.state = () => freshState().state;
  freshness.details = freshDetails;
  freshness.market = market;

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  function observe(url, res) {
    if (!res || !res.ok || FRESH.explicit) return;
    let path = "";
    try { path = new URL(url, location.href).pathname.replace(/^\/api\/flows\//, ""); } catch { return; }
    const upd = Number(res.headers.get("X-Payload-Updated")) || null;
    res.clone().text().then((t) => {
      if (FRESH.explicit) return;
      const sd = /"sessionDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(t);
      const ga = /"generatedAt"\s*:\s*"([^"]+)"/.exec(t);
      const o = { explicit: false, source: path, updatedAt: upd };
      if (sd) o.sessionDate = sd[1];
      if (ga) o.generatedAt = ga[1];
      if (path === "live") {
        try { const j = JSON.parse(t); if (j && j.status === "ok" && typeof j.readAt === "string") o.readAt = j.readAt; } catch { return; }
      }
      freshness(o);
    }).catch(() => {});
  }
  function takeMeta(p) {
    FRESH.meta = true;
    p.then((r) => (r && r.ok ? r.clone().json() : null)).then((j) => {
      if (j && isoDay(j.sessionDate)) { FRESH.nightly = j.sessionDate.slice(0, 10); FRESH.settled = true; paintFresh(); }
    }).catch(() => {});
  }
  const GATE = { on: null };
  const gateAt = (v) => {
    let t = 0;
    try { if (v) sessionStorage.setItem("flows:gate", v); else t = +sessionStorage.getItem("flows:gate") || 0; } catch {}
    try {
      if (v) document.cookie = "flows_gate=" + v + "; Max-Age=600; Path=/flows; SameSite=Lax";
      else if (!t) t = +(/(?:^|; )flows_gate=(\d+)/.exec(document.cookie) || [0, 0])[1];
    } catch {}
    return t;
  };
  function showGate(kind, why) {
    GATE.on = kind;
    const bar = $("fxBar"), fresh = $("fxFresh"), old = $("fxGate");
    if (old) old.remove();
    if (fresh) fresh.hidden = !!kind;
    if (bar) bar.classList.toggle("is-gated", !!kind);
    if (!bar || !kind) return;
    const out = kind === "out", name = out ? "Signed out, sign in" : "Unavailable";
    const A = { class: "ui-fresh", id: "fxGate", "data-state": kind, "aria-label": name, title: name };
    const label = h("span", { class: "fx-fresh-l" }, out ? "Signed out " + MID + " sign in" : name);
    bar.append(out
      ? h("a", { ...A, href: "/flows/login/" }, glyph("stop"), label)
      : h("button", { ...A, type: "button", ...POP, "data-info": info({ title: name, state: "unavailable", lead: why }) }, glyph("unavailable"), label));
  }
  function gate(r) {
    if (r.status === 401) {
      if (GATE.on === "out") return;
      const t = Date.now();
      if (t - gateAt() < 6e5) { showGate("out"); return; }
      gateAt(t);
      location.replace("/flows/");
    } else if (r.status === 403 && !GATE.on) {
      const m = r.headers.get("cf-mitigated");
      if (m || !/json/.test(r.headers.get("content-type") || "")) showGate("off", "The network edge refused this page’s requests" + (m ? " (" + m + ")" : "") + ". The readings are unchanged; try again in a minute.");
    } else if (r.ok && GATE.on === "off") showGate(null);
  }
  const HANG = new Promise(() => {});
  const DEADLINE_MS = 20000;
  const BODY = ["json", "text", "blob", "arrayBuffer"];
  function bounded(input, init) {
    const o = init || {};
    const own = typeof input === "string" || (typeof URL === "function" && input instanceof URL);
    const method = String(o.method || (input && input.method) || "GET").toUpperCase();
    if (!own || method !== "GET" || o.signal || typeof AbortController !== "function") return { p: nativeFetch(input, o), stop() {} };
    const ms = Number(o.deadlineMs) > 0 ? Number(o.deadlineMs) : DEADLINE_MS;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    const stop = () => clearTimeout(timer);
    const rest = { ...o, signal: ctl.signal };
    delete rest.deadlineMs;
    const p = nativeFetch(input, rest).then((r) => {
      for (const k of BODY) {
        const f = r[k];
        if (typeof f === "function") r[k] = function () { return f.apply(r, arguments).finally(stop); };
      }
      return r;
    }, (e) => { stop(); throw e; });
    return { p, stop };
  }
  if (nativeFetch) {
    window.fetch = function (input, init) {
      const url = String((input && input.url) || input || "");
      if (url.indexOf("/api/flows/") < 0) return nativeFetch(input, init);
      if (GATE.on === "out") return HANG;
      const { p, stop } = bounded(input, init);
      if (url.indexOf("/api/flows/meta") >= 0) takeMeta(p);
      if (url.indexOf("/api/flows/now") >= 0) watchNow(p, url.indexOf("?") > 0);
      p.then((r) => observe(url, r), () => {});
      return p.then((r) => { try { gate(r); } catch {} if (r.status === 401) { stop(); return HANG; } return r; });
    };
  }

  const PAL = {};
  const PAL_G = { focus: ["star", "Focus"], fund: ["stack", "ETF"], index: ["market", "Index"], board: ["boards", "Board"], cross: ["layers", "Card"] };
  async function paletteRows() {
    if (PAL.loading) return PAL.loading;
    if (GATE.on === "out") return [];
    const get = (u) => (nativeFetch ? nativeFetch(u, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null));
    PAL.loading = Promise.all(["board?side=long", "board?side=short", "board?side=watch", "scoretrack", "roster"].map((k) => get("/api/flows/" + k)))
      .then((all) => {
        const [L, S, W, T, R] = all;
        if (!all.some(Boolean)) { PAL.loading = null; return []; }
        const by = new Map();
        const add = (r, side, session) => {
          if (!r || typeof r.t !== "string") return;
          const t = r.t.toUpperCase();
          if (!by.has(t)) by.set(t, { t, side, sector: r.sector || null, px: num(r.px), s: num(r.s), session });
        };
        for (const [p, side] of [[L, "Bullish"], [S, "Bearish"], [W, "Watch"]]) if (p && Array.isArray(p.rows)) for (const r of p.rows) add(r, side, p.sessionDate);
        if (T && Array.isArray(T.names)) for (const n of T.names) add({ t: n.t, s: n.last }, "Scored", T.sessionDate);
        const D = (R && R.depth) || {};
        for (const t in D) add({ t }, null, R.sessionDate);
        const rows = [...by.values()];
        for (const r of rows) r.d = PAL_G[D[r.t]];
        return rows;
      });
    return PAL.loading;
  }
  let paletteSource = null;
  let drawerClose = null;
  function ensurePalette() {
    let d = $("fxPal");
    if (d) return d;
    d = h("dialog", { class: "ui-pal", id: "fxPal", "aria-label": "Find a name" },
      h("div", { class: "ui-pal-in" }, glyph("search"),
        h("input", { id: "fxPalQ", type: "search", placeholder: "Ticker or sector", autocomplete: "off", spellcheck: "false", autocapitalize: "characters", role: "combobox", "aria-expanded": "true", "aria-controls": "fxPalL", "aria-autocomplete": "list" }),
        h("button", { class: "fx-iconbtn", type: "button", "aria-label": "Close", style: { "margin-left": "0" }, onclick: () => d.close() }, glyph("x"))),
      h("ul", { class: "ui-pal-list", id: "fxPalL", role: "listbox", "aria-label": "Names" }));
    document.body.append(d);
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    return d;
  }
  function openPalette() {
    const d = ensurePalette();
    const q = $("fxPalQ"), L = $("fxPalL");
    let sel = 0, shown = [];
    const go = (t) => { d.close(); location.href = "/flows/ticker/?t=" + encodeURIComponent(t); };
    const render = (rows) => {
      const t = q.value.trim().toUpperCase();
      const rank = (r) => (!t ? 5 : r.t === t ? 0 : r.t.startsWith(t) ? 1 : r.t.includes(t) ? 2 : (r.sector || "").toUpperCase().includes(t) ? 3 : 9);
      shown = rows.map((r) => [rank(r), r]).filter((x) => x[0] < 9).sort((a, b) => a[0] - b[0] || !/,[FEI]/.test(a[1].d) - !/,[FEI]/.test(b[1].d) || Math.abs(b[1].s || 0) - Math.abs(a[1].s || 0)).map((x) => x[1]).slice(0, 40);
      if (t && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) && !shown.some((r) => r.t === t)) shown.push({ t, px: null, s: null, open: true });
      sel = clamp(sel, 0, Math.max(0, shown.length - 1));
      L.replaceChildren(...shown.map((r, i) => {
        const opt = h("li", { class: "ui-pal-opt", role: "option", id: "fxPo" + i, "aria-selected": String(i === sel) },
          h("b", null, r.t),
          h("span", null, r.d ? glyph(r.d[0]) : null, r.open ? "Open this name" : [r.sector, r.side || (r.d && r.d[1]), r.session ? F.day(r.session) : null].filter(Boolean).join(" " + MID + " ")),
          h("span", { class: "ui-pal-px" }, r.px === null ? "" : F.px(r.px)),
          h("span", { class: "ui-num", "data-tone": r.s === null ? null : tone(r.s) }, r.s === null ? "" : F.signed(r.s)));
        opt.addEventListener("click", () => go(r.t));
        opt.addEventListener("pointermove", () => { if (sel !== i) { sel = i; paintSel(); } });
        return opt;
      }));
      if (!shown.length) L.append(h("li", { class: "ui-pal-empty", role: "presentation" }, rows.length ? "No match" : loaded ? "No names" : "Loading names"));
      paintSel();
    };
    const paintSel = () => {
      [...L.children].forEach((n, i) => n.setAttribute && n.classList.contains("ui-pal-opt") && n.setAttribute("aria-selected", String(i === sel)));
      q.setAttribute("aria-activedescendant", shown.length ? "fxPo" + sel : "");
      const n = $("fxPo" + sel);
      if (n) n.scrollIntoView({ block: "nearest" });
    };
    let rows = [], loaded = false;
    q.oninput = () => { sel = 0; render(rows); };
    q.onkeydown = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); paintSel(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); paintSel(); }
      else if (e.key === "Enter" && shown[sel]) { e.preventDefault(); go(shown[sel].t); }
      else if (e.key === "Escape") { e.preventDefault(); d.close(); }
    };
    q.value = "";
    render(rows);
    if (!d.open) d.showModal();
    q.focus();
    Promise.resolve(paletteSource ? paletteSource() : paletteRows()).catch(() => []).then((r) => { rows = Array.isArray(r) ? r : []; loaded = true; if (d.open) render(rows); });
  }
  function initShell() {
    const body = document.body;
    const bar = $("fxBar");
    if (!body || !bar) return;
    const side = $("fxSide");
    const btn = $("fxSideBtn");
    const scrim = $("fxScrim");
    const syncBtn = () => {
      if (!btn) return;
      const shown = WIDE.matches ? !body.classList.contains("is-side-collapsed") : body.classList.contains("has-side-open");
      btn.setAttribute("aria-expanded", String(shown));
    };
    const behind = ["fxBar", "flowsMain", "fxTabs", "askDock"].map($).filter(Boolean);
    const setDrawer = (open) => {
      body.classList.toggle("has-side-open", open);
      for (const n of behind) n.inert = open;
      syncBtn();
    };
    const closeDrawer = (focus) => {
      if (!body.classList.contains("has-side-open")) return;
      setDrawer(false);
      if (focus && btn) btn.focus();
    };
    drawerClose = closeDrawer;
    if (btn && side) {
      btn.addEventListener("click", () => {
        if (WIDE.matches) { body.classList.toggle("is-side-collapsed"); syncBtn(); return; }
        const open = !body.classList.contains("has-side-open");
        setDrawer(open);
        if (open) {
          const first = side.querySelector(".flows-rail a.is-on") || side.querySelector("a");
          if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
        }
      });
      if (scrim) scrim.addEventListener("click", () => closeDrawer(true));
      onDoc("keydown", (e) => { if (e.key === "Escape" && body.classList.contains("has-side-open")) closeDrawer(true); });
      WIDE.addEventListener("change", () => { closeDrawer(false); syncBtn(); });
      syncBtn();
    }

    const title = $("fxBarT");
    const heroes = [...document.querySelectorAll("[data-fx-hero]")];
    if (heroes.length && window.IntersectionObserver) {
      bar.classList.add("has-hero");
      const seen = new Map(), laid = new Map();
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          laid.set(e.target, e.boundingClientRect.height > 2);
          seen.set(e.target, e.isIntersecting && e.boundingClientRect.height > 2);
        }
        const visible = heroes.some((n) => seen.get(n));
        bar.classList.toggle("is-scrolled", !visible && heroes.some((n) => laid.get(n)));
      }, { rootMargin: `-${Math.round(bar.getBoundingClientRect().height || 56)}px 0px 0px 0px`, threshold: [0, 0.01] });
      heroes.forEach((n) => io.observe(n));
    } else bar.classList.remove("has-hero");
    const titleSrc = document.querySelector("[data-fx-title]");
    if (titleSrc && title && window.MutationObserver) {
      const sync = () => { const t = titleSrc.textContent.trim(); if (t) title.textContent = t; };
      new MutationObserver(sync).observe(titleSrc, { childList: true, characterData: true, subtree: true });
      sync();
    }

    const kbd = bar.querySelector(".fx-search kbd");
    if (kbd && !/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "")) kbd.textContent = "Ctrl K";
    onDoc("click", (e) => {
      const a = e.target instanceof Element ? e.target.closest("#fxSearch, [data-fx-search]") : null;
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
      e.preventDefault();
      closeDrawer(false);
      openPalette();
    });
    onDoc("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "k") { e.preventDefault(); closeDrawer(false); openPalette(); }
    });

    if (!POPS) {
      const why = "This browser is older than Flows supports, so explanations cannot open in it. A newer browser or device shows them.";
      bar.append(h("span", { class: "ui-fresh", id: "fxOld", "data-state": "old", title: why }, glyph("unavailable"), h("span", { class: "fx-fresh-l" }, "Old browser"), h("span", { class: "visually-hidden" }, why)));
    }
    const fresh = $("fxFresh");
    if (fresh) {
      fresh.setAttribute("aria-controls", "fxPop");
      fresh.addEventListener("click", (e) => {
        e.preventDefault();
        if (anchor === fresh && popOpen()) { closeInfo(); return; }
        openInfo(fresh, freshDetails());
      });
      setTimeout(() => { if (!FRESH.meta && !FRESH.sessionDate && nativeFetch && !GATE.on) takeMeta(nativeFetch("/api/flows/meta", { credentials: "same-origin" })); }, 800);
      setTimeout(() => { FRESH.settled = true; paintFresh(); }, 6000);
      setInterval(paintFresh, 30000);
      paintFresh();
    }
  }

  const shell = Object.freeze({
    init: initShell,
    openPalette,
    paletteSource: (fn) => { paletteSource = typeof fn === "function" ? fn : null; },
    title: (text) => { const t = $("fxBarT"); if (t && text) t.textContent = String(text); },
    closeSidebar: () => { if (drawerClose) drawerClose(false); },
  });

  const chart = Object.freeze({
    mount, svgRoot, lin, niceTicks, pathOf, monoPath, vGrad, clipRect, spread, marker, scrub, part,
    line, sparkline, bars, diverging, heatmap, gauge, payoff,
    LEVELS, shapeOf,
  });

  window.FlowsUI = Object.freeze({
    MINUS, DASH, MID,
    isNum,
    fmtSigned, fmtStamp,
    emptyState,
    staleness,
    scoreStrip,
    h, s, glyph, cssVar, num, clamp, F, tone, cap, reduced: () => REDUCED.matches,
    STATES, stateOf, worst, partial,
    info, infoButton, stateButton, openInfo, closeInfo, announce,
    roll, metric, updateMetric, metrics,
    ring, divRing, iconChip, gaugeChip, chips,
    segmented, tag, calibTag, capsule, key, legend, robustness,
    silent, dash, listRow, list, tile, split, moduleCard,
    freshness, freshAggregate, shell, chart, depths: PAL_G,
  });

  if (document.readyState === "loading") onDoc("DOMContentLoaded", initShell, { once: true });
  else initShell();
})();
