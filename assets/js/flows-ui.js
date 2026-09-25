(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const MINUS = "−";

  const DASH = "—";

  const MID = "·";

  let uid = 0;

  const isNum = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string") return null;
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    return n;
  };

  const fmtSigned = (v, dp) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(dp === undefined ? 0 : dp);
  };

  const STALE_WRITE_MS = 30 * 60 * 60 * 1000;
  const STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;

  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  function staleness(payload, now, opts) {
    const o = opts || {};
    const at = isNum(now) ?? Date.now();
    if (!payload || typeof payload !== "object") return { kind: "unknown", message: null };

    const stamped = isNum(payload.__updatedAt);
    const written = stamped !== null && stamped > 0 ? stamped : null;
    if (written !== null && at - written > STALE_WRITE_MS) {
      const hours = Math.floor((at - written) / 3600000);
      const days = Math.floor(hours / 24);

      const age = days >= 1
        ? days + (days === 1 ? " day" : " days")
        : hours + (hours === 1 ? " hour" : " hours");
      return {
        kind: "write",
        message: (o.subject || "This page") + " was last written " + age +
          " ago. The pipeline has not published since — check the Actions tab.",
      };
    }

    let session = null;
    if (ISO_DAY.test(String(payload.sessionDate || ""))) {
      const parsed = Date.parse(String(payload.sessionDate) + "T21:00:00Z");
      if (Number.isFinite(parsed)) session = parsed;
    }
    if (session !== null && at - session > STALE_SESSION_MS) {
      return {
        kind: "session",
        message: "These numbers describe the " + payload.sessionDate + " session, " +
          "which is more than four days old. The pipeline is running but its " +
          "data is not advancing.",
      };
    }

    if (written === null && session === null) return { kind: "unknown", message: null };
    return { kind: "fresh", message: null };
  }

  const emptyState = (kind, text) => {
    const p = el("p", "flows-empty", text);
    if (kind) p.dataset.empty = String(kind);
    return p;
  };

  function stripGeometry(count, width) {
    const n = Math.max(1, Math.floor(isNum(count) ?? 1));
    const w = Math.max(1, isNum(width) ?? 1);
    const colW = w / n;
    return {
      count: n,
      width: w,
      colW,
      xEdge: (i) => i * colW,
      xMid: (i) => (i + 0.5) * colW,
    };
  }

  function markerRuns(markers) {
    const byCls = new Map();
    for (const m of (Array.isArray(markers) ? markers : [])) {
      const i = isNum(m && m.i);
      if (i === null) continue;
      const cls = String((m && m.cls) || "");
      if (!byCls.has(cls)) byCls.set(cls, []);
      byCls.get(cls).push(i);
    }
    const runs = [];
    for (const [cls, list] of byCls) {
      list.sort((a, b) => a - b);
      let start = null, prev = null;
      for (const i of list) {
        if (start === null) { start = prev = i; continue; }
        if (i === prev + 1) { prev = i; continue; }
        runs.push({ cls, from: start, to: prev });
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
    const padY = 2.5;
    const plotH = H - padY * 2;

    let lo = 0, hi = 0;
    if (o.domain) {
      lo = isNum(o.domain.lo) ?? 0;
      hi = isNum(o.domain.hi) ?? 0;
    }
    const db = isNum(o.deadBand);
    if (db !== null) { lo = Math.min(lo, -db); hi = Math.max(hi, db); }
    for (const v of pts) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const y = (v) => padY + (1 - (v - lo) / (hi - lo)) * plotH;

    const svg = svgEl("svg", {
      class: prefix + "-strip", viewBox: `0 0 ${W} ${H}`, width: W, height: H,
      preserveAspectRatio: "xMidYMid meet",
    });
    if (o.ariaLabel) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", String(o.ariaLabel));
    } else {

      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
    }

    for (const run of markerRuns(o.markers)) {
      if (run.from >= count) continue;
      svg.append(svgEl("rect", {
        class: run.cls || (prefix + "-wash"),
        x: g.xEdge(run.from).toFixed(2), y: 0,
        width: (g.colW * (Math.min(run.to, count - 1) - run.from + 1)).toFixed(2), height: H,
      }));
    }

    if (db !== null && db > 0) {
      const top = y(db);
      svg.append(svgEl("rect", {
        class: prefix + "-band", x: 0, y: top.toFixed(2),
        width: W, height: Math.max(0.5, y(-db) - top).toFixed(2),
      }));
    }

    const zy = y(0).toFixed(2);
    svg.append(svgEl("line", { class: prefix + "-zero", x1: 0, x2: W, y1: zy, y2: zy }));

    for (const r of (Array.isArray(o.rules) ? o.rules : [])) {
      const at = isNum(r && r.at);
      if (at === null || at < 0 || at > count) continue;
      const x = g.xEdge(at).toFixed(2);
      svg.append(svgEl("line", {
        class: (r && r.cls) || (prefix + "-rule"), x1: x, x2: x, y1: 0, y2: H,
      }));
    }

    for (let i = 0; i + 1 < count; i++) {
      if (pts[i] === null || pts[i + 1] === null) continue;
      svg.append(svgEl("line", {
        class: prefix + "-line",
        x1: g.xMid(i).toFixed(2), y1: y(pts[i]).toFixed(2),
        x2: g.xMid(i + 1).toFixed(2), y2: y(pts[i + 1]).toFixed(2),
      }));
    }

    let lastMeasured = -1;
    for (let i = 0; i < count; i++) if (pts[i] !== null) lastMeasured = i;
    const r0 = Math.max(1.1, Math.min(1.6, g.colW / 2.4));
    for (let i = 0; i < count; i++) {
      if (pts[i] === null) continue;
      const edge = (i === 0 || pts[i - 1] === null) || (i === count - 1 || pts[i + 1] === null);
      if (!edge && i !== lastMeasured) continue;
      const isLast = i === lastMeasured;
      const cls = prefix + "-dot" + (isLast
        ? " is-last" + (pts[i] > 0 ? " is-pos" : pts[i] < 0 ? " is-neg" : " is-zero")
        : "");
      svg.append(svgEl("circle", {
        class: cls,
        cx: g.xMid(i).toFixed(2), cy: y(pts[i]).toFixed(2),
        r: isLast ? Math.max(r0, Math.min(2, g.colW / 2)).toFixed(2) : r0.toFixed(2),
      }));
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
  const PHONE = window.matchMedia("(max-width: 599.98px)");
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nextId = (p) => p + (++uid);
  const moving = () => !REDUCED.matches;

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "style" && typeof v === "object") { for (const p in v) n.style.setProperty(p, v[p]); }
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of kids.flat(4)) {
      if (c === null || c === undefined || c === false) continue;
      n.append(c instanceof Node ? c : String(c));
    }
    return n;
  }

  function s(tag, attrs, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined) continue;
        if (k === "text") n.textContent = v;
        else if (k === "style" && typeof v === "object") { for (const p in v) n.style.setProperty(p, v[p]); }
        else n.setAttribute(k, v);
      }
    }
    if (parent) parent.append(n);
    return n;
  }

  function glyph(name, cls) {
    const n = document.createElementNS(SVG_NS, "svg");
    n.setAttribute("class", "ui-g" + (cls ? " " + cls : ""));
    n.setAttribute("aria-hidden", "true");
    n.setAttribute("focusable", "false");
    const u = document.createElementNS(SVG_NS, "use");
    u.setAttribute("href", "#g-" + name);
    n.append(u);
    return n;
  }

  const varCache = new Map();
  function cssVar(name) {
    if (typeof name !== "string") return name;
    if (!name.startsWith("--")) return name;
    if (varCache.has(name)) return varCache.get(name);
    const v = getComputedStyle(document.body || document.documentElement).getPropertyValue(name).trim() || "#888";
    varCache.set(name, v);
    return v;
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
      "aria-label": "About " + label, "aria-haspopup": "dialog", "aria-expanded": "false",
      "aria-controls": "fxPop", "data-info": info(build),
    }, glyph("info"));
  }
  function stateButton(st, label) {
    if (!st || st.state === "ok") return null;
    const def = STATES[st.state] || STATES.unavailable;
    return h("button", {
      class: "ui-state", type: "button", "data-state": st.state, title: def.word,
      "aria-label": def.word + (label ? ": " + label : ""), "aria-haspopup": "dialog", "aria-controls": "fxPop",
      "data-info": info(() => ({ title: label || def.word, state: st.state, lead: st.reason })),
    }, glyph(def.g));
  }
  function statePill(state) {
    const def = STATES[state];
    return def ? h("span", { class: "ui-pill", "data-state": state }, glyph(def.g), def.word) : null;
  }

  function ensurePop() {
    let pop = document.getElementById("fxPop");
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
  const popOpen = () => { const p = document.getElementById("fxPop"); return !!(p && p.matches(":popover-open")); };
  function fillPop(d) {
    const body = document.getElementById("fxPopB");
    document.getElementById("fxPopT").textContent = d.title || "";
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
    if (!build) return;
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
    const pop = document.getElementById("fxPop");
    if (pop && popOpen()) pop.hidePopover();
  }
  document.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("[data-info]") : null;
    if (!b || !INFO.has(b.dataset.info)) return;
    e.preventDefault();
    if (anchor === b && popOpen()) { closeInfo(); return; }
    openInfo(b);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!popOpen()) return;
    const pop = document.getElementById("fxPop");
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest("[data-info]")) return;
    const r = pop.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeInfo();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && popOpen()) { e.preventDefault(); closeInfo(); } });

  let liveNode = null;
  const spoken = (node) => [...node.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(" ");
  function announce(text) {
    if (!liveNode) {
      liveNode = document.getElementById("fxLive") || h("div", { id: "fxLive", class: "visually-hidden", "aria-live": "polite" });
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
        for (let d = 0; d < 10; d++) strip.append(h("span", null, String(d)));
        const start = go && from && /\d/.test(from[i]) ? from[i] : go && !from ? String((+ch + 7) % 10) : ch;
        strip.style.setProperty("--d", start);
        strip.style.setProperty("--k", String(k++));
        el.append(h("span", { class: "ui-roll-d", "aria-hidden": "true" }, strip));
        if (go && start !== ch) requestAnimationFrame(() => requestAnimationFrame(() => strip.style.setProperty("--d", ch)));
      } else {
        el.append(h("span", { class: "ui-roll-c", "aria-hidden": "true" }, ch));
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

  function ring(v01, o = {}) {
    const size = o.size || 20;
    const stroke = o.stroke || 3;
    const n = s("svg", { width: size, height: size, viewBox: "0 0 26 26", class: "ui-gchip-g", "aria-hidden": "true", style: { "--ring-c": paint(o.color || "--label-1") } });
    s("circle", { cx: 13, cy: 13, r: 10.5, fill: "none", class: "ui-ring-track", "stroke-width": stroke }, n);
    if (num(v01) !== null) {
      s("circle", {
        cx: 13, cy: 13, r: 10.5, fill: "none", class: "ui-ring-v", stroke: paint(o.color || "--label-1"), "stroke-width": stroke,
        "stroke-linecap": "round", pathLength: 100, "stroke-dasharray": `${clamp(v01, 0, 1) * 100} 100`, transform: "rotate(-90 13 13)",
      }, n);
    }
    return n;
  }
  function divRing(v, o = {}) {
    const size = o.size || 20;
    const max = o.max || 100;
    const n = s("svg", { width: size, height: size, viewBox: "0 0 26 26", class: "ui-gchip-g", "aria-hidden": "true" });
    s("circle", { cx: 13, cy: 13, r: 10.5, fill: "none", class: "ui-ring-track", "stroke-width": 3 }, n);
    s("line", { x1: 13, y1: 0.8, x2: 13, y2: 5.2, stroke: paint("--label-3"), "stroke-width": 1.2 }, n);
    if (num(v) !== null && v !== 0) {
      const a = clamp(Math.abs(v) / max, 0, 1) * 100;
      s("circle", {
        cx: 13, cy: 13, r: 10.5, fill: "none", class: "ui-ring-v", stroke: paint(v < 0 ? "--down-mark" : "--up-mark"), "stroke-width": 3,
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
    const attrs = { class: "ui-gchip", type: "button", "aria-haspopup": "dialog", "aria-controls": "fxPop" };
    if (o.info) attrs["data-info"] = info(o.info);
    return h("button", attrs, g, h("span", { class: "ui-chip-v", "data-tone": o.tone || null }, o.value), h("span", { class: "ui-chip-l" }, o.label));
  }
  function chips(list, label) {
    return h("div", { class: "ui-chips-w" }, h("div", { class: "ui-chips", role: "group", "aria-label": label || null, style: { "--n": String(list.length) } }, list));
  }

  function segmented(label, items, onPick, start = 0) {
    const wrap = h("div", { class: "ui-seg is-static", role: "tablist", "aria-label": label });
    const knob = h("span", { class: "ui-seg-knob", "aria-hidden": "true" });
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
      btns.forEach((b, j) => { b.setAttribute("aria-selected", String(i === j)); b.tabIndex = i === j ? 0 : -1; });
      place();
      if (user && typeof onPick === "function") {
        const run = () => onPick(i);
        if (document.startViewTransition && moving()) document.startViewTransition(run).ready.catch(() => {}); else run();
      }
    }
    requestAnimationFrame(() => { place(); requestAnimationFrame(() => wrap.classList.remove("is-static")); });
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        wrap.classList.add("is-static");
        place();
        requestAnimationFrame(() => wrap.classList.remove("is-static"));
      }).observe(wrap);
    }
    wrap.pick = (i) => pick(i, false);
    wrap.index = () => current;
    return wrap;
  }

  function tag(text, o = {}) {
    return h("span", { class: "ui-tag" + (o.accent ? " is-accent" : ""), "data-tone": o.tone || null }, o.glyph ? glyph(o.glyph) : null, text);
  }
  function capsule(text, o = {}) {
    const t = o.tone || "flat";
    return h("span", { class: "ui-capsule", "data-tone": t, "aria-label": o.label || null }, o.glyph === false ? null : glyph(o.glyph || dirGlyph(t)), text);
  }
  function key(color, shape, label) {
    const i = h("i", { class: shape ? "is-" + shape : null, "aria-hidden": "true" });
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
    h("button", { type: "button", "aria-haspopup": "dialog", "aria-controls": "fxPop", "data-info": info(() => ({ title: label, state, lead: st && st.reason })) }, "Why"));
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
      const m = h("i", { style: { "--w": (clamp(o.meter, 0, 1) * 100).toFixed(1) + "%", "--i": String(o.index || 0) } });
      if (o.meterColor) m.style.setProperty("--c", paint(o.meterColor));
      kids.push(h("span", { class: "ui-meter", "aria-hidden": "true" }, m));
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
      b.setAttribute("aria-expanded", String(open));
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
      parts.map((p, i) => h("i", { style: { "--c": paint(p.color), "--f": String(Math.max(0.02, Math.abs(num(p.value) || 0))), "animation-delay": i * 40 + "ms" } })));
  }

  function moduleCard(o) {
    const id = o.id || nextId("mod");
    const title = h("h2", { class: "ui-mod-t", id: id + "-t" }, o.title, o.robustness !== undefined && o.robustness !== null ? robustness(o.robustness) : null, stateButton(o.state, o.title));
    const head = h("header", { class: "ui-mod-h" }, title, h("span", { class: "ui-mod-sp" }), o.seg || null,
      o.info ? infoButton(o.infoLabel || String(o.title).toLowerCase(), o.info) : null);
    const card = h("section", {
      class: "ui-card ui-mod" + (o.enter === false ? "" : " ui-enter") + (o.span ? " ui-span-" + o.span : ""),
      id, "aria-labelledby": id + "-t", style: { "--i": String(o.index || 0) },
    }, head, o.body || null);
    return card;
  }

  const CHARTS = new Set();
  const RO = window.ResizeObserver ? new ResizeObserver((entries) => {
    for (const e of entries) { const rec = e.target._fxChart; if (rec) requestAnimationFrame(() => repaint(rec, false)); }
  }) : null;
  function repaint(rec, animate, force) {
    if (!rec.host.isConnected) { CHARTS.delete(rec); if (RO) RO.unobserve(rec.host); return; }
    const w = Math.round(rec.host.clientWidth);
    if (!w || (w === rec.w && !force)) return;
    rec.w = w;
    rec.host.replaceChildren();
    rec.draw(rec.host, w, animate && moving());
  }
  function mount(host, draw) {
    if (host._fxChart) { CHARTS.delete(host._fxChart); if (RO) RO.unobserve(host); }
    releaseHost(host);
    host.classList.add("ui-chart");
    const rec = { host, draw, w: 0 };
    host._fxChart = rec;
    CHARTS.add(rec);
    if (RO) RO.observe(host);
    repaint(rec, true, true);
    return {
      el: host,
      redraw: (animate) => { rec.draw = rec.draw; repaint(rec, !!animate, true); },
      set: (next, animate) => { rec.draw = next; repaint(rec, animate !== false, true); },
      destroy: () => { CHARTS.delete(rec); if (RO) RO.unobserve(host); host._fxChart = null; releaseHost(host); host.replaceChildren(); },
    };
  }
  function svgRoot(host, w, H, animate, label) {
    const svg = s("svg", { width: w, height: H, viewBox: `0 0 ${w} ${H}`, role: "img", "aria-label": label || "" });
    if (!animate) svg.classList.add("no-anim");
    host.append(svg);
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
  function vGrad(svg, color, a0, a1) {
    const id = nextId("gr");
    const defs = svg.querySelector("defs") || s("defs", null, svg);
    const g = s("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
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
    const readout = h("div", { class: "ui-readout", "aria-hidden": "true" });
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
      if (i < 0 || i >= xs.length) return;
      idx = i;
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
    const hide = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } readout.classList.remove("is-on"); xh.setAttribute("opacity", 0); dots.replaceChildren(); };
    const at = (cx) => { const b = svg.getBoundingClientRect(); return (cx - b.left) * (svg.viewBox.baseVal.width / b.width); };
    host.addEventListener("pointermove", (e) => {
      px = e.clientX;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; show(nearest(at(px))); });
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
    return mount(host, (el, w, animate) => drawLine(el, w, animate, o));
  }
  function area(host, o) {
    return line(host, { ...o, series: (o.series || []).map((sr) => ({ area: true, ...sr })) });
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
    if (!N || !series.length) { host.append(silent({ state: "unavailable", reason: o.empty || "Nothing to draw." }, o.label || "Chart", H)); return; }
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
    const xf = o.xFormat || ((v) => (isDate ? F.day(v) : isNumX ? String(v) : String(v)));
    if (o.zero || o.twoTone || o.baseline !== undefined) {
      const b = o.baseline !== undefined ? o.baseline : 0;
      s("line", { x1: left, x2: w - right, y1: y(b), y2: y(b), class: "base" }, svg);
    } else {
      s("line", { x1: left, x2: w - right, y1: H - bot, y2: H - bot, class: "base" }, svg);
    }
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
          s("path", { d: ar, fill: vGrad(svg, color, sr.fill ?? 0.18, 0), class: "fade", style: { "--delay": "250ms" } }, g);
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
        const dotC = o.twoTone && si === 0 ? paint(sr.values[li] < 0 ? "--down" : "--up") : color;
        if (o.live && si === 0) s("circle", { cx, cy, r: 4, fill: dotC, class: "pulse" }, svg);
        s("circle", { cx, cy, r: 3.5, fill: dotC, class: "ring" }, svg);
        if (o.endLabels !== false) tags.push({ y: cy, y0: cy, text: (sr.format || yf)(sr.values[li]), color: dotC, x0: cx, pri: 1 });
      }
    });
    const yt = niceTicks(y0, y1, 2).filter((v) => y(v) > top + 6 && y(v) < H - bot - 4);
    const tx = w - right + 8;
    spread(tags, 16, top, H - bot);
    const tg = s("g", { class: "fade", style: { "--delay": "650ms" } }, svg);
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
          if (num(v) !== null) dots.push({ x: xAt(i), y: y(v), color: o.twoTone ? (v < 0 ? "--down" : "--up") : sr.color || (si ? "--s-gray" : "--accent") });
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
      if (!N) { el.append(silent({ state: "unavailable", reason: o.empty || "Nothing to draw." }, o.label || "Chart", H)); return; }
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
        s("rect", { x: x(i) - bw / 2, y: y(0) - hh, width: bw, height: hh, rx: Math.min(4, bw / 2), fill: o.colors ? paint(o.colors[i]) : color, "fill-opacity": o.highlight !== undefined && o.highlight !== i ? 0.55 : 1, class: "grow", style: { "--i": String(i * 3) } }, svg);
      });
      const labels = o.labels || [];
      const every = Math.max(1, Math.ceil(N / (phone ? 5 : 9)));
      labels.forEach((l, i) => { if (i % every === 0 && l !== undefined) s("text", { x: x(i), y: H - 7, text: l, "text-anchor": "middle" }, svg); });
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
      if (!N) { el.append(silent({ state: "unavailable", reason: o.empty || "Nothing to draw." }, o.label || "Chart", H)); return; }
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
        const hh = hOf(v);
        const pos = v >= 0;
        s("rect", {
          x: cx - bw / 2, y: pos ? mid - hh : mid, width: bw, height: hh, rx: Math.min(3, bw / 2),
          fill: paint(pos ? pal.pos : pal.neg), "fill-opacity": hl.size && !hl.has(X[i]) ? 0.8 : 1,
          class: "grow", style: { "--i": String(i), "--origin": pos ? "bottom" : "top" },
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
        s("text", { x: clamp(lx, lw / 2, w - lw / 2), y: ly, text: l.text, "text-anchor": "middle", class: "tx-1 tx-b" }, svg);
      }
      if (pill) {
        s("line", { x1: pill.sx, x2: pill.sx, y1: top - 10, y2: H - bot, stroke: paint("--label-1"), "stroke-width": 1.25 }, svg);
        s("rect", { x: pill.x0, y: top - 28, width: pill.pw, height: 18, rx: 9, fill: paint("--label-1") }, svg);
        s("text", { x: pill.x0 + pill.pw / 2, y: top - 15.5, text: pill.text, "text-anchor": "middle", class: "tx-b tx-ink" }, svg);
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
        for (const t of niceTicks(lo, hi, phone ? 4 : 7)) s("text", { x: xs(t), y: H - 4, text: xf(t), "text-anchor": "middle" }, svg);
      } else if (typeof X[0] === "string" && isoDay(X[0])) {
        for (const t of dateTicks(X, xAt, 5, left, w - right, phone)) s("text", { x: xAt(t.i), y: H - 4, text: t.text, "text-anchor": "middle" }, svg);
      } else {
        const every = Math.max(1, Math.ceil(N / (phone ? 5 : 9)));
        X.forEach((v, i) => { if (i % every === 0) s("text", { x: xAt(i), y: H - 4, text: xf(v), "text-anchor": "middle" }, svg); });
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
            dots: v === null ? [] : [{ x: xAt(i), y: v >= 0 ? mid - hOf(v) : mid + hOf(v), color: v >= 0 ? pal.pos : pal.neg }],
          };
        },
      });
    });
  }

  function heatmap(host, o) {
    return mount(host, (el, w, animate) => {
      const rows = o.rows || [], cols = o.cols || [], grid = o.grid || [];
      const R = rows.length, C = cols.length;
      if (!R || !C) { el.append(silent({ state: "unavailable", reason: o.empty || "No grid." }, o.label || "Grid", 200)); return; }
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
          const xx = left + c * cw;
          if (v === null || v === 0) { s("rect", { x: xx + 1, y: yy + 1, width: Math.max(0, cw - 2), height: ch - 2, rx: 2.5, fill: paint("--fill-4") }, svg); continue; }
          const a = clamp(Math.sqrt(Math.abs(v) / cap), 0.08, 1);
          s("rect", { x: xx + 1, y: yy + 1, width: Math.max(0, cw - 2), height: ch - 2, rx: 2.5, fill: paint(v > 0 ? pal.pos : pal.neg), "fill-opacity": a.toFixed(3), class: "fade", style: { "--delay": c * 40 + "ms" } }, svg);
        }
        if (r % every === 0 || r === o.highlightRow) s("text", { x: left - 8, y: yy + ch / 2 + 3.5, text: rf(rows[r]), "text-anchor": "end", class: r === o.highlightRow ? "tx-1 tx-b" : null }, svg);
      }
      if (num(o.highlightRow) !== null) s("circle", { cx: left - 3, cy: top + o.highlightRow * ch + ch / 2, r: 2.5, fill: paint("--label-1") }, svg);
      const everyX = cw < 40 ? 2 : 1;
      const hc = num(o.highlightCol);
      if (hc !== null && hc >= 0 && hc < C) s("rect", { x: left + hc * cw + 0.5, y: top - 0.5, width: Math.max(0, cw - 1), height: R * ch + 1, rx: 3.5, fill: "none", stroke: paint("--accent"), "stroke-width": 1.25 }, svg);
      const phase = hc !== null && hc >= 0 && hc < C ? hc % everyX : 0;
      cols.forEach((c, i) => { if (i % everyX === phase) s("text", { x: left + i * cw + cw / 2, y: H - 6, text: cf(c), "text-anchor": "middle", class: i === hc ? "tx-1 tx-b" : null }, svg); });
      const hl = s("rect", { class: "cell-hl", x: 0, y: 0, width: Math.max(0, cw - 1), height: ch - 1, rx: 3, visibility: "hidden" }, svg);
      const readout = h("div", { class: "ui-readout", "aria-hidden": "true" });
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
        raf = requestAnimationFrame(() => {
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
    s("path", { d: arcPath(0, 1), fill: "none", stroke: paint("--fill-2"), "stroke-width": stroke, "stroke-linecap": "round" }, svg);
    if (v !== null) {
      const f = clamp((v - min) / ((max - min) || 1), 0, 1);
      if (o.diverging) {
        const fz = clamp((0 - min) / ((max - min) || 1), 0, 1);
        if (Math.abs(f - fz) > 0.002) s("path", { d: f < fz ? arcPath(f, fz) : arcPath(fz, f), fill: "none", stroke: paint(o.color || (v < 0 ? "--down-mark" : "--up-mark")), "stroke-width": stroke, "stroke-linecap": "round" }, svg);
        const [tx0, ty0] = pt(fz);
        const dx = tx0 - cx, dy = ty0 - cy, dl = Math.hypot(dx, dy) || 1;
        s("line", { x1: cx + dx / dl * (R - stroke), y1: cy + dy / dl * (R - stroke), x2: cx + dx / dl * (R + stroke), y2: cy + dy / dl * (R + stroke), stroke: paint("--label-3"), "stroke-width": 1.5 }, svg);
      } else if (f > 0.002) {
        s("path", { d: arcPath(0, f), fill: "none", stroke: paint(o.color || "--accent"), "stroke-width": stroke, "stroke-linecap": "round" }, svg);
      }
    }
    if (o.text !== false) {
      const t = s("text", {
        x: cx, y: arc === 180 ? cy - 6 : cy + 11, "text-anchor": "middle", "aria-hidden": "true",
        text: o.text ?? (v === null ? DASH : o.diverging ? F.signed(v) : String(Math.round(v))),
        style: { font: size >= 110 ? "var(--t-large)" : "var(--t-headline)", "letter-spacing": "var(--t-large-track)", fill: paint(o.textColor || (o.diverging && v !== null ? (v < 0 ? "--down" : v > 0 ? "--up" : "--label-1") : "--label-1")) },
      }, svg);
      t.setAttribute("data-gauge", "value");
      if (o.caption) s("text", { x: cx, y: (arc === 180 ? cy - 6 : cy + 11) + 18, "text-anchor": "middle", text: o.caption, class: "tx-3" }, svg);
    }
    return svg;
  }

  const LEVELS = {
    gamma_flip: { color: "--lvl-flip", shape: "dia", label: "Flip" },
    call_wall: { color: "--lvl-call", shape: "dot", label: "Call wall" },
    put_wall: { color: "--lvl-put", shape: "dot", label: "Put wall" },
    max_pain: { color: "--lvl-pain", shape: "dia", label: "Max pain" },
  };

  function cone(host, o) {
    return mount(host, (el, w, animate) => {
      const hist = (o.history || []).filter((r) => r && isoDay(r.d) && num(r.c) !== null);
      const S = num(o.spot) ?? (hist.length ? hist[hist.length - 1].c : null);
      const phone = w < 600;
      const H = heightFor(o.height, w, [260, 300, 330]);
      if (!hist.length || S === null) { el.append(silent({ state: "unavailable", reason: o.empty || "No price history." }, o.label || "Price", H)); return; }
      const N = hist.length;
      const Hs = num(o.horizon) || 10;
      const gutter = phone ? 58 : 66;
      const top = 30, stripH = o.strip ? 30 : 0, axisH = 20;
      const plotB = H - axisH - stripH - (o.strip ? 12 : 4);
      const plotW = w - gutter;
      const fw = Math.max(plotW * Hs / (N + Hs), plotW * (phone ? 0.3 : 0.26));
      const xNow = plotW - fw;
      const xh = (i) => (N === 1 ? xNow : (i / (N - 1)) * (xNow - 4));
      const xf = (t) => xNow + (t / Hs) * (fw - 8);
      const hiEnd = num(o.hi), loEnd = num(o.lo);
      const band = hiEnd !== null && loEnd !== null && S > 0 && hiEnd > 0 && loEnd > 0;
      const hiT = (t) => S * (hiEnd / S) ** Math.sqrt(t / Hs);
      const loT = (t) => S * (loEnd / S) ** Math.sqrt(t / Hs);
      const lv = (o.levels || []).filter((l) => l && num(l.px) !== null && LEVELS[l.kind] && Math.abs(l.px / S - 1) <= (o.levelWindow || 0.12));
      const vals = hist.map((r) => r.c).concat([S]);
      if (band) vals.push(hiEnd, loEnd);
      if (o.realized && num(o.realized.hi) !== null) vals.push(o.realized.hi, o.realized.lo);
      for (const l of lv) vals.push(l.px);
      let y0 = Math.min(...vals), y1 = Math.max(...vals);
      const pad = (y1 - y0) * 0.06 || S * 0.01;
      y0 -= pad; y1 += pad;
      const y = lin(y0, y1, plotB, top);
      const svg = svgRoot(el, w, H, animate, o.label);
      const first = hist[0].c, last = hist[N - 1].c;
      const lineC = paint(last >= first ? "--up" : "--down");
      const pts = hist.map((r, i) => [xh(i), y(r.c)]);
      pts.push([xNow, y(S)]);
      s("path", { d: pathOf(pts) + `L${fx1(xNow)} ${fx1(plotB)}L${fx1(pts[0][0])} ${fx1(plotB)}Z`, fill: vGrad(svg, lineC, 0.13, 0), class: "fade", style: { "--delay": "250ms" } }, svg);
      s("line", { x1: xNow, x2: xNow, y1: top - 6, y2: H - axisH, class: "hair" }, svg);
      const accent = paint("--accent");
      if (band) {
        const up = [], dn = [];
        for (let k = 0; k <= 24; k++) { const t = (k / 24) * Hs; up.push([xf(t), y(hiT(t))]); dn.push([xf(t), y(loT(t))]); }
        const gid = nextId("cone");
        const defs = svg.querySelector("defs") || s("defs", null, svg);
        const lg = s("linearGradient", { id: gid, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
        s("stop", { offset: 0, "stop-color": accent, "stop-opacity": 0.34 }, lg);
        s("stop", { offset: 1, "stop-color": accent, "stop-opacity": 0.12 }, lg);
        s("path", { d: pathOf(up) + dn.slice().reverse().map((p) => "L" + fx1(p[0]) + " " + fx1(p[1])).join("") + "Z", fill: `url(#${gid})`, class: "fade", style: { "--delay": "420ms" } }, svg);
        s("path", { d: pathOf(up), class: "ln draw", stroke: accent, "stroke-opacity": 0.7, "stroke-width": 1, pathLength: 1, style: { "--delay": "520ms" } }, svg);
        s("path", { d: pathOf(dn), class: "ln draw", stroke: accent, "stroke-opacity": 0.7, "stroke-width": 1, pathLength: 1, style: { "--delay": "520ms" } }, svg);
      }
      if (o.realized && num(o.realized.hi) !== null && num(o.realized.lo) !== null) {
        s("rect", { x: xf(Hs) - 1, y: y(o.realized.hi), width: 4, height: Math.max(2, y(o.realized.lo) - y(o.realized.hi)), rx: 2, fill: paint("--s-gray"), class: "fade", style: { "--delay": "650ms" } }, svg);
      }
      const lvG = s("g", { class: "fade", style: { "--delay": "600ms" } }, svg);
      for (const l of lv) s("line", { x1: xNow, x2: xf(Hs), y1: y(l.px), y2: y(l.px), stroke: paint(LEVELS[l.kind].color), "stroke-width": 1, "stroke-opacity": 0.75 }, lvG);
      s("path", { d: pathOf(pts), class: "ln draw", stroke: lineC, pathLength: 1 }, svg);
      if (o.live) s("circle", { cx: xNow, cy: y(S), r: 4, fill: lineC, class: "pulse" }, svg);
      s("circle", { cx: xNow, cy: y(S), r: 4, fill: paint("--label-1"), class: "ring" }, svg);
      const tags = [{ y: y(S), y0: y(S), text: F.px(S), kind: "spot" }];
      if (band) { tags.push({ y: y(hiEnd), y0: y(hiEnd), text: F.px(hiEnd), kind: "band" }); tags.push({ y: y(loEnd), y0: y(loEnd), text: F.px(loEnd), kind: "band" }); }
      for (const l of lv) tags.push({ y: y(l.px), y0: y(l.px), text: F.px(l.px), kind: l.kind });
      spread(tags, 17, top, plotB);
      const tg = s("g", { class: "fade", style: { "--delay": "700ms" } }, svg);
      const tx = plotW + 8;
      for (const t of tags) {
        if (Math.abs(t.y - t.y0) > 2) s("path", { d: `M${fx1(xf(Hs) + 3)} ${fx1(t.y0)}L${fx1(tx - 3)} ${fx1(t.y)}`, stroke: paint("--label-4"), "stroke-width": 1, fill: "none" }, tg);
        if (t.kind === "spot") {
          const pw = tw(t.text);
          s("rect", { x: tx - 2, y: t.y - 9, width: pw, height: 18, rx: 9, fill: paint("--label-1") }, tg);
          s("text", { x: tx + 4, y: t.y + 3.8, text: t.text, class: "tx-b tx-ink" }, tg);
        } else if (t.kind === "band") {
          s("rect", { x: tx, y: t.y - 4, width: 6, height: 8, rx: 2, fill: accent, opacity: 0.6 }, tg);
          s("text", { x: tx + 10, y: t.y + 3.8, text: t.text, style: { fill: paint("--accent-soft") } }, tg);
        } else {
          const d = LEVELS[t.kind];
          marker(tg, d.shape, tx + 3, t.y, paint(d.color), 3.2);
          s("text", { x: tx + 10, y: t.y + 3.8, text: t.text, class: "tx-1" }, tg);
        }
      }
      const sm = new Map();
      if (o.strip) for (const k of Object.keys(o.strip)) if (num(o.strip[k]) !== null) sm.set(k, o.strip[k]);
      if (o.strip) {
        const sy = plotB + 12 + stripH / 2;
        s("line", { x1: 0, x2: xNow, y1: sy, y2: sy, class: "hair" }, svg);
        const stepX = N > 1 ? (xNow - 4) / (N - 1) : 8;
        const bw = clamp(stepX * 0.62, 1.5, 6);
        hist.forEach((r, i) => {
          const v = sm.get(r.d);
          if (v === undefined) { s("circle", { cx: xh(i), cy: sy, r: 1, fill: paint("--label-4") }, svg); return; }
          const hh = Math.max(1.5, (Math.abs(v) / 100) * (stripH / 2));
          s("rect", { x: xh(i) - bw / 2, y: v >= 0 ? sy - hh : sy, width: bw, height: hh, rx: Math.min(1.5, bw / 2), fill: paint(v >= 0 ? "--up-mark" : "--down-mark"), class: "grow", style: { "--i": String(i), "--origin": v >= 0 ? "bottom" : "top" } }, svg);
        });
        s("text", { x: tx, y: sy + 4, text: o.stripLabel || "Score", class: "tx-3" }, svg);
      }
      for (const t of dateTicks(hist.map((r) => r.d), xh, 5, 0, xNow, phone)) s("text", { x: xh(t.i), y: H - 5, text: t.text, "text-anchor": "middle" }, svg);
      s("text", { x: xf(Hs), y: H - 5, text: "+" + Hs + "d", "text-anchor": "middle" }, svg);
      const xs = hist.map((_, i) => xh(i));
      for (let t = 1; t <= Hs; t++) xs.push(xf(t));
      scrub(el, svg, {
        xs, top, bottom: plotB, label: o.label,
        onMove: (i) => {
          if (i < N) {
            const r = hist[i];
            const v = sm.get(r.d);
            const p1 = i > 0 ? r.c / hist[i - 1].c - 1 : null;
            return {
              dots: [{ x: xh(i), y: y(r.c), color: last >= first ? "--up" : "--down" }],
              parts: [part(F.day(r.d), "k"), h("b", null, F.px(r.c)), p1 === null ? null : part(F.pct(p1, 2, true), null, tone(p1)),
                o.strip ? (v === undefined ? part("no score", "k") : part("score " + F.signed(v), null, tone(v))) : null],
            };
          }
          const t = i - N + 1;
          if (!band) return { parts: [part("+" + t + "d", "k")] };
          return { dots: [{ x: xf(t), y: y(hiT(t)), color: "--accent" }, { x: xf(t), y: y(loT(t)), color: "--accent" }], parts: [part("+" + t + " sessions", "k"), h("b", null, F.px(loT(t)) + " " + String.fromCharCode(8211) + " " + F.px(hiT(t)))] };
        },
      });
    });
  }

  function levels(host, o) {
    return mount(host, (el, w, animate) => {
      const S = num(o.spot);
      const lv = (o.levels || []).filter((l) => l && num(l.px) !== null && LEVELS[l.kind]);
      const H = o.height || 74;
      if (S === null) { el.append(silent({ state: "unavailable", reason: o.empty || "No spot price." }, o.label || "Levels", H)); return; }
      const all = lv.map((l) => l.px).concat([S]);
      let lo = o.domain ? o.domain[0] : Math.min(...all), hi = o.domain ? o.domain[1] : Math.max(...all);
      const pad = (hi - lo) * 0.12 || S * 0.02;
      lo -= pad; hi += pad;
      const x = lin(lo, hi, 12, w - 12);
      const ay = 40;
      const svg = svgRoot(el, w, H, animate, o.label);
      const g = s("g", null, svg);
      s("line", { x1: 12, x2: w - 12, y1: ay, y2: ay, stroke: paint("--fill-2"), "stroke-width": 4, "stroke-linecap": "round" }, g);
      const sorted = lv.slice().sort((a, b) => a.px - b.px);
      if (sorted.length) {
        const a = Math.min(S, sorted[0].px), b = Math.max(S, sorted[sorted.length - 1].px);
        s("line", { x1: x(a), x2: x(b), y1: ay, y2: ay, stroke: paint("--fill-1"), "stroke-width": 4, "stroke-linecap": "round", class: "growx" }, g);
      }
      const sx = x(S);
      const st = F.px(S);
      const labs = sorted.map((l) => ({ y: x(l.px), y0: x(l.px), l })).concat([{ y: sx, y0: sx, spot: true }]);
      spread(labs, 52, 30, w - 30);
      labs.sort((a, b) => a.y0 - b.y0);
      const half = (text) => String(text).length * 3.2 + 2;
      const ink = paint("--label-1");
      labs.forEach((t, i) => {
        const above = i % 2 === 0;
        if (t.spot) {
          const pw = tw(st);
          const px0 = clamp(t.y - pw / 2, 0, w - pw);
          const py = above ? ay - 30 : ay + 12;
          s("rect", { x: px0, y: py, width: pw, height: 18, rx: 9, fill: ink }, g);
          s("text", { x: px0 + pw / 2, y: py + 12.5, text: st, "text-anchor": "middle", class: "tx-b tx-ink" }, g);
          return;
        }
        const d = LEVELS[t.l.kind];
        const v = F.px(t.l.px), k = d.label + " " + F.pct(t.l.px / S - 1, 1, true);
        s("text", { x: clamp(t.y, half(v), w - half(v)), y: above ? ay - 14 : ay + 24, text: v, "text-anchor": "middle", class: "tx-1 tx-b" }, g);
        s("text", { x: clamp(t.y, half(k), w - half(k)), y: above ? ay - 26 : ay + 36, text: k, "text-anchor": "middle", class: "tx-3" }, g);
      });
      s("rect", { x: sx - 1.25, y: ay - 8, width: 2.5, height: 16, rx: 1.25, fill: ink }, g);
      const edge = paint("--mat-opaque");
      for (const l of sorted) {
        const d = LEVELS[l.kind];
        const m = marker(g, d.shape, x(l.px), ay, paint(d.color), 5);
        m.setAttribute("stroke", edge);
        m.setAttribute("stroke-width", "2");
        m.setAttribute("paint-order", "stroke");
      }
      const pts = sorted.map((l) => x(l.px)).concat([sx]).sort((a, b) => a - b);
      const items = sorted.map((l) => ({ x: x(l.px), l })).concat([{ x: sx, spot: true }]).sort((a, b) => a.x - b.x);
      scrub(el, svg, {
        xs: pts, top: ay - 12, bottom: ay + 12, label: o.label,
        onMove: (i) => {
          const it = items[i];
          if (it.spot) return { noLine: true, parts: [part("Spot", "k"), h("b", null, F.px(S))], top: H - 24 };
          return { noLine: true, parts: [part(LEVELS[it.l.kind].label, "k"), h("b", null, F.px(it.l.px)), part(F.pct(it.l.px / S - 1, 2, true), "k")], top: H - 24 };
        },
      });
    });
  }

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
      const svg = s("svg", { class: "ui-payoff", width: W, height: Hh, viewBox: `0 0 ${W} ${Hh}`, "aria-hidden": "true" });
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
        s("text", { x: sx, y: top - 8, text: F.px(o.spot), "text-anchor": "middle", class: "tx-1 tx-b" }, svg);
      }
      const fmt = o.format || ((v) => F.money(v, true));
      const mx = Math.max(...vs), mn = Math.min(...vs);
      s("text", { x: w - right + 8, y: y(mx) + 4, text: o.maxLabel || fmt(mx), class: "tx-1 tx-b" }, svg);
      s("text", { x: w - right + 8, y: y(mn) + 4, text: o.minLabel || fmt(mn), class: "tx-1 tx-b" }, svg);
      for (const t of niceTicks(Math.min(...xs), Math.max(...xs), w < 600 ? 4 : 6)) s("text", { x: x(t), y: H - 6, text: String(t), "text-anchor": "middle" }, svg);
      scrub(el, svg, {
        xs: P.map((p) => p[0]), top, bottom: H - bot, label: o.label,
        onMove: (i) => ({ dots: [{ x: P[i][0], y: P[i][1], color: P0[i][1] >= 0 ? "--up" : "--down" }], parts: [part("At " + F.px(P0[i][0]), "k"), h("b", { "data-tone": tone(P0[i][1]) }, fmt(P0[i][1]))] }),
      });
    });
  }

  function nyClock(d) {
    const p = Object.fromEntries(ET_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, mins: (+p.hour % 24) * 60 + +p.minute };
  }
  function prevWeekday(iso) {
    let t = Date.parse(iso + "T12:00:00Z");
    do { t -= 864e5; } while ([0, 6].includes(new Date(t).getUTCDay()));
    return new Date(t).toISOString().slice(0, 10);
  }
  function market(now) {
    const n = nyClock(now || new Date());
    const weekday = !["Sat", "Sun"].includes(n.wd);
    const open = weekday && n.mins >= 570 && n.mins < 960;
    const built = weekday && n.mins >= 17 * 60 + 45;
    return { open, weekday, today: n.date, expected: built ? n.date : prevWeekday(n.date) };
  }

  const FRESH = { sessionDate: null, nightly: null, meta: false, generatedAt: null, updatedAt: null, readAt: null, live: false, sources: new Map(), explicit: false, settled: false };
  function freshState() {
    const m = market(new Date());
    const S = FRESH.sessionDate || FRESH.nightly;
    const liveNow = FRESH.live && FRESH.readAt && Date.now() - Date.parse(FRESH.readAt) < 3 * 60 * 1000 && m.open;
    let state;
    if (!S) state = FRESH.settled ? (m.open ? "fresh" : "closed") : "pending";
    else if (S < m.expected) state = "stale";
    else if (liveNow) state = "live";
    else if (m.open) state = "fresh";
    else state = "closed";
    return { state, market: m, S };
  }
  function freshDetails() {
    const { state, market: m, S } = freshState();
    const which = S === m.today ? "today\u2019s session." : "the last completed session, " + F.day(S) + ".";
    const lead = state === "stale" ? `These readings are the ${F.day(S)} session; the last completed session is ${F.day(m.expected)}.`
      : state === "live" ? "The market is open and the last price was read moments ago. Everything else is the last completed session."
        : !S ? (state === "pending" ? "No payload on this page has reported its session yet." : "No session is published yet.")
          : (m.open ? "The market is open. " : "The market is closed. ") + "These readings are " + which;
    const sources = [...FRESH.sources.entries()];
    const behind = sources.filter(([, v]) => v !== S);
    const facts = [
      ["Expected", S !== m.expected ? F.day(m.expected) : null],
      ["Market", m.open ? "Open" : "Closed"],
      ["Built", FRESH.generatedAt ? F.time(FRESH.generatedAt) : null],
      ["Written", FRESH.updatedAt ? F.time(new Date(FRESH.updatedAt).toISOString()) : null],
      ["Price read", FRESH.readAt ? F.time(FRESH.readAt) : null],
      ["Payloads", sources.length ? (behind.length ? sources.length - behind.length + " of " + sources.length + " current" : sources.length + " current") : null],
      ...behind.map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), F.day(v)]),
    ];
    return {
      title: "Freshness", state, asOf: S ? "Session " + F.day(S) : null, lead, facts,
      notes: ["Readings come from the dated post-close archive. During market hours only price is re-read live."],
    };
  }
  function paintFresh() {
    const b = document.getElementById("fxFresh");
    if (!b) return;
    const { state, market: m, S } = freshState();
    const def = STATES[state] || STATES.pending;
    const label = state === "live" ? "Live" : S ? (S === m.today ? "Today" : F.day(S)) : state === "pending" ? "Session" : state === "closed" ? "Closed" : "Open";
    if (b.dataset.state === state && b.dataset.label === label) return;
    b.dataset.state = state;
    b.dataset.label = label;
    b.replaceChildren(glyph(def.g), h("span", { class: "fx-fresh-l" }, label));
    b.setAttribute("aria-label", "Freshness: " + def.word + (S ? ", session " + S : ""));
  }
  function freshness(o = {}) {
    if (o.explicit !== false) FRESH.explicit = true;
    if (isoDay(o.sessionDate)) {
      const d = o.sessionDate.slice(0, 10);
      if (!FRESH.sessionDate || d > FRESH.sessionDate) FRESH.sessionDate = d;
      FRESH.sources.set(o.source || "page", d);
    }
    if (typeof o.generatedAt === "string" && (!FRESH.generatedAt || o.generatedAt > FRESH.generatedAt)) FRESH.generatedAt = o.generatedAt;
    if (num(o.updatedAt) !== null && o.updatedAt > 0) FRESH.updatedAt = Math.max(FRESH.updatedAt || 0, o.updatedAt);
    if (typeof o.readAt === "string") { FRESH.readAt = o.readAt; FRESH.live = o.live !== false; }
    FRESH.settled = true;
    paintFresh();
    return freshState().state;
  }
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
  if (nativeFetch) {
    window.fetch = function (input, init) {
      const p = nativeFetch(input, init);
      try {
        const url = typeof input === "string" ? input : input && input.url;
        if (url && url.indexOf("/api/flows/meta") >= 0) takeMeta(p);
        if (url && url.indexOf("/api/flows/") >= 0) p.then((r) => observe(url, r), () => {});
      } catch { return p; }
      return p;
    };
  }

  const PAL = { rows: null, loading: null };
  const PAL_G = { focus: "star", fund: "stack", index: "market", board: "boards", cross: "layers" };
  async function paletteRows() {
    if (PAL.rows) return PAL.rows;
    if (PAL.loading) return PAL.loading;
    const get = (u) => (nativeFetch ? nativeFetch(u, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null));
    PAL.loading = Promise.all([get("/api/flows/board?side=long"), get("/api/flows/board?side=short"), get("/api/flows/board?side=watch"), get("/api/flows/scoretrack"), get("/api/flows/roster")])
      .then(([L, S, W, T, R]) => {
        if (!L && !S && !W && !T && !R) { PAL.loading = null; return []; }
        const by = new Map();
        const add = (r, side, session) => {
          if (!r || typeof r.t !== "string") return;
          const t = r.t.toUpperCase();
          if (!by.has(t)) by.set(t, { t, side, sector: r.sector || null, px: num(r.px), s: num(r.s), session });
        };
        for (const [p, side] of [[L, "Bullish"], [S, "Bearish"], [W, "Watch"]]) {
          if (p && Array.isArray(p.rows)) for (const r of p.rows) add(r, side, p.sessionDate || null);
        }
        if (T && Array.isArray(T.names)) for (const n of T.names) add({ t: n.t, s: n.last }, "Scored", T.sessionDate || null);
        const D = (R && R.depth) || {};
        for (const t in D) add({ t }, null, R.sessionDate || null);
        PAL.rows = [...by.values()];
        for (const r of PAL.rows) r.d = PAL_G[D[r.t]] && D[r.t];
        return PAL.rows;
      });
    return PAL.loading;
  }
  let paletteSource = null;
  let drawerClose = null;
  function ensurePalette() {
    let d = document.getElementById("fxPal");
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
    const q = document.getElementById("fxPalQ"), L = document.getElementById("fxPalL");
    let sel = 0, shown = [];
    const go = (t) => { d.close(); location.href = "/flows/ticker/?t=" + encodeURIComponent(t); };
    const render = (rows) => {
      const t = q.value.trim().toUpperCase();
      const rank = (r) => (!t ? 5 : r.t === t ? 0 : r.t.startsWith(t) ? 1 : r.t.includes(t) ? 2 : (r.sector || "").toUpperCase().includes(t) ? 3 : 9);
      shown = rows.map((r) => [rank(r), r]).filter((x) => x[0] < 9).sort((a, b) => a[0] - b[0] || !/^[fi]/.test(a[1].d) - !/^[fi]/.test(b[1].d) || Math.abs(b[1].s || 0) - Math.abs(a[1].s || 0)).map((x) => x[1]).slice(0, 40);
      if (t && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) && !shown.some((r) => r.t === t)) shown.push({ t, side: null, sector: null, px: null, s: null, open: true });
      sel = clamp(sel, 0, Math.max(0, shown.length - 1));
      L.replaceChildren(...shown.map((r, i) => {
        const opt = h("li", { class: "ui-pal-opt", role: "option", id: "fxPo" + i, "aria-selected": String(i === sel) },
          h("b", null, r.t),
          h("span", null, r.d ? glyph(PAL_G[r.d]) : null, r.open ? "Open this name" : [r.sector, r.side || r.d, r.session ? F.day(r.session) : null].filter(Boolean).join(" " + MID + " ")),
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
      const n = document.getElementById("fxPo" + sel);
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
    const bar = document.getElementById("fxBar");
    if (!body || !bar) return;
    const side = document.getElementById("fxSide");
    const btn = document.getElementById("fxSideBtn");
    const scrim = document.getElementById("fxScrim");
    const syncBtn = () => {
      if (!btn) return;
      const shown = WIDE.matches ? !body.classList.contains("is-side-collapsed") : body.classList.contains("has-side-open");
      btn.setAttribute("aria-expanded", String(shown));
    };
    const behind = ["fxBar", "flowsMain", "fxTabs", "askDock"].map((id) => document.getElementById(id)).filter(Boolean);
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
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && body.classList.contains("has-side-open")) closeDrawer(true); });
      WIDE.addEventListener("change", () => setDrawer(false));
      syncBtn();
    }

    const title = document.getElementById("fxBarT");
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
    document.addEventListener("click", (e) => {
      const a = e.target instanceof Element ? e.target.closest("#fxSearch, [data-fx-search]") : null;
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
      e.preventDefault();
      closeDrawer(false);
      openPalette();
    });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "k") { e.preventDefault(); closeDrawer(false); openPalette(); }
    });

    const fresh = document.getElementById("fxFresh");
    if (fresh) {
      fresh.setAttribute("aria-controls", "fxPop");
      fresh.addEventListener("click", (e) => {
        e.preventDefault();
        if (anchor === fresh && popOpen()) { closeInfo(); return; }
        openInfo(fresh, freshDetails());
      });
      setTimeout(() => { if (!FRESH.meta && !FRESH.sessionDate && nativeFetch) takeMeta(nativeFetch("/api/flows/meta", { credentials: "same-origin" })); }, 800);
      setTimeout(() => { FRESH.settled = true; paintFresh(); }, 6000);
      setInterval(paintFresh, 30000);
      paintFresh();
    }
  }

  const shell = Object.freeze({
    init: initShell,
    openPalette,
    paletteSource: (fn) => { paletteSource = typeof fn === "function" ? fn : null; },
    title: (text) => { const t = document.getElementById("fxBarT"); if (t && text) t.textContent = String(text); },
    closeSidebar: () => { if (drawerClose) drawerClose(false); },
  });

  const chart = Object.freeze({
    mount, svgRoot, lin, niceTicks, pathOf, monoPath, vGrad, clipRect, spread, marker, scrub, part,
    line, area, sparkline, bars, diverging, heatmap, gauge, cone, levels, payoff,
    LEVELS, PALETTES, shapeOf,
  });

  window.FlowsUI = Object.freeze({
    MINUS, DASH, MID,
    isNum, el, svgEl,
    fmtSigned, fmtStamp,
    emptyState,
    staleness,
    stripGeometry, scoreStrip,
    h, s, glyph, cssVar, num, clamp, F, tone, cap, reduced: () => REDUCED.matches,
    STATES, stateOf, worst, partial,
    info, infoButton, stateButton, statePill, openInfo, closeInfo, announce,
    roll, metric, updateMetric, metrics,
    ring, divRing, iconChip, gaugeChip, chips,
    segmented, tag, capsule, key, legend, robustness,
    silent, dash, listRow, list, tile, split, moduleCard,
    freshness, shell, chart,
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initShell, { once: true });
  else initShell();
})();
