(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const { h, F } = UI;
  const DASH = UI.DASH, MID = UI.MID;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const NETS = new WeakMap();

  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const money = (v) => F.money(v);
  const pct = (v) => (num(v) === null ? DASH : Math.round(v * 100) + "%");
  const count = (v) => Math.round(v).toLocaleString("en-US");
  const plural = (k, one, many) => (k === 1 ? one : many);

  const SECT = [
    [/tech/, "tech", "Tech"], [/health/, "health", "Health"], [/financ/, "fin", "Financial"],
    [/cyclical|discretionary/, "disc", "Cyclical"], [/defensive|staples/, "staples", "Defensive"],
    [/industr/, "ind", "Industrial"], [/energy/, "energy", "Energy"], [/material/, "mat", "Materials"],
    [/real estate/, "re", "Real estate"], [/utilit/, "util", "Utilities"], [/communic/, "comm", "Comms"],
  ];
  function sectorGroup(name, unread) {
    if (name === undefined) return unread ? { k: "unread", label: "Sector unread", full: "The universe could not be read", tok: "--sect-none" } : { k: "wait", label: "Sector pending", full: "Sector not read yet", tok: "--sect-none" };
    if (!name) return { k: "none", label: "No sector", full: "No sector in the universe", tok: "--sect-none" };
    const low = String(name).toLowerCase();
    for (const [re, k, label] of SECT) if (re.test(low)) return { k, label, full: String(name), tok: "--sect-" + k };
    return { k: "x:" + low, label: String(name).slice(0, 14), full: String(name), tok: "--sect-none" };
  }

  const KINDS = {
    ca: { label: "Calls at ask", lean: "bull" },
    pb: { label: "Puts at bid", lean: "bull" },
    nx: { label: "Unattributed", lean: "nx" },
    pa: { label: "Puts at ask", lean: "bear" },
    cb: { label: "Calls at bid", lean: "bear" },
  };
  const LEANS = { bull: "Bullish", nx: "Unattributed", bear: "Bearish" };
  const LEAN_GLYPH = { bull: "up", bear: "down", nx: "flat" };
  const DTE = { d0: "0DTE", w1: "1–7 days", m1: "8–31 days", far: "32+ days", nx: "No expiry" };
  const CAPTIONS = { lean: ["Side", "Sector", "Name", "Lean"], dte: ["Side", "Sector", "Name", "Expiry"] };
  const RESID = { "s:~": 1, "s:none": 2, "s:unread": 3, "s:wait": 4, "n:~": 1 };

  const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const isDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
  const dayOf = (iso) => {
    const t = Date.parse(String(iso || ""));
    return Number.isFinite(t) ? ET_DAY.format(new Date(t)) : null;
  };
  function dteBucket(r, session) {
    const ref = dayOf(r.spanStart) || dayOf(r.firstAt) || (isDay(session) ? session.slice(0, 10) : null);
    if (!isDay(r.exp) || !ref) return "nx";
    const d = Math.round((Date.parse(r.exp.slice(0, 10)) - Date.parse(ref)) / 864e5);
    return d <= 0 ? "d0" : d <= 7 ? "w1" : d <= 31 ? "m1" : "far";
  }

  function model(rows, o = {}) {
    const mode = o.out === "dte" ? "dte" : "lean";
    const cap = clamp(Math.round(num(o.names) || 10), 3, 24);
    const secOf = typeof o.sectorOf === "function" ? o.sectorOf : () => undefined;
    const parts = [];
    let total = 0, windows = 0;
    (Array.isArray(rows) ? rows : []).forEach((r, ri) => {
      const prem = num(r && r.prem);
      const t = r && typeof r.t === "string" && r.t.trim() ? r.t.trim().toUpperCase() : null;
      if (!t || prem === null || prem <= 0) return;
      windows++;
      total += prem;
      const cp = r.cp === "C" || r.cp === "P" ? r.cp : null;
      let a = cp ? Math.max(0, num(r.askPrem) || 0) : 0, b = cp ? Math.max(0, num(r.bidPrem) || 0) : 0;
      if (a + b > prem) { const k = prem / (a + b); a *= k; b *= k; }
      const g = sectorGroup(secOf(t), o.unread), x = dteBucket(r, o.session), sz = num(r.size);
      const push = (k, v) => { if (v > prem * 1e-9) parts.push({ r: ri, t, g, k, v, lean: KINDS[k].lean, x, sz: sz !== null && sz >= 0 ? sz : null }); };
      push(cp === "C" ? "ca" : "pa", a);
      push(cp === "C" ? "cb" : "pb", b);
      push("nx", Math.max(0, prem - a - b));
    });

    const byName = new Map(), bySec = new Map();
    for (const p of parts) {
      byName.set(p.t, (byName.get(p.t) || 0) + p.v);
      const s = bySec.get(p.g.k) || { g: p.g, v: 0 };
      s.v += p.v;
      bySec.set(p.g.k, s);
    }
    const ranked = [...byName.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    const keepN = new Set((ranked.length <= cap + 1 ? ranked : ranked.slice(0, cap)).map((e) => e[0]));
    const secs = [...bySec.values()].sort((x, y) => y.v - x.v || (x.g.k < y.g.k ? -1 : 1));
    const keepS = new Set((secs.length > 6 ? secs.slice(0, 5) : secs).map((s) => s.g.k));

    const nodes = new Map(), hops = [new Map(), new Map(), new Map()], paths = new Map();
    const node = (id, layer, o2) => {
      let n = nodes.get(id);
      if (!n) nodes.set(id, n = Object.assign({ id, layer, v: 0, bull: 0, bear: 0, nx: 0, rows: new Set(), members: new Set(), ct: 0, cx: 0 }, o2));
      return n;
    };
    for (const p of parts) {
      const sid = keepS.has(p.g.k) ? "s:" + p.g.k : "s:~";
      const nid = keepN.has(p.t) ? "n:" + p.t : "n:~";
      const oid = "o:" + (mode === "lean" ? p.lean : p.x);
      const ids = ["i:" + p.k, sid, nid, oid];
      const ns = [
        node(ids[0], 0, { label: KINDS[p.k].label, lean: KINDS[p.k].lean, kind: p.k }),
        node(sid, 1, sid === "s:~" ? { label: "Other", tok: "--sect-none" } : { label: p.g.label, full: p.g.full, tok: p.g.tok }),
        node(nid, 2, nid === "n:~" ? { label: "Other names" } : { label: p.t, ticker: p.t, sec: p.g.label }),
        node(oid, 3, mode === "lean" ? { label: LEANS[p.lean], lean: p.lean } : { label: DTE[p.x], bucket: p.x }),
      ];
      for (const n of ns) {
        n.v += p.v;
        n[p.lean] += p.v;
        if (!n.rows.has(p.r)) { n.rows.add(p.r); if (p.sz === null) n.cx = 1; else n.ct += p.sz; }
      }
      if (sid === "s:~") ns[1].members.add(p.g.label);
      if (nid === "n:~") ns[2].members.add(p.t);
      for (let i = 0; i < 3; i++) {
        const key = ids[i] + "|" + ids[i + 1];
        let e = hops[i].get(key);
        if (!e) hops[i].set(key, e = { a: ids[i], b: ids[i + 1], hop: i, v: 0, bull: 0, bear: 0, nx: 0 });
        e.v += p.v;
        e[p.lean] += p.v;
      }
      const key = ids.join("|");
      let q = paths.get(key);
      if (!q) paths.set(key, q = { key, ids, v: 0, bull: 0, bear: 0, nx: 0, lean: p.lean });
      q.v += p.v;
      q[p.lean] += p.v;
    }

    const layers = [[], [], [], []];
    for (const n of nodes.values()) {
      n.share = total ? n.v / total : 0;
      n.windows = n.rows.size;
      n.contracts = (n.layer === 1 || n.layer === 2 || (n.layer === 3 && mode === "dte")) && !n.cx && n.ct > 0 ? n.ct : null;
      n.resid = n.layer === 3 ? (mode === "dte" && n.bucket === "nx" ? 1 : 0) : RESID[n.id] || 0;
      delete n.rows;
      delete n.ct;
      delete n.cx;
      n.members = [...n.members];
      layers[n.layer].push(n);
    }
    for (const l of layers) l.sort((a, b) => a.resid - b.resid || b.v - a.v || (a.id < b.id ? -1 : 1));
    layers[2].forEach((d, i) => { if (d.ticker) d.pos = i + 1; });

    const table = new Map();
    for (const p of parts) {
      const key = p.t + "|" + p.k;
      const row = table.get(key) || { t: p.t, sector: p.g.label, sectorFull: p.g.full, kind: KINDS[p.k].label, k: p.k, lean: p.lean, v: 0 };
      row.v += p.v;
      table.set(key, row);
    }
    const lean = { bull: 0, bear: 0, nx: 0 };
    for (const p of parts) lean[p.lean] += p.v;
    return {
      mode, total, windows, names: byName.size, layers, lean,
      edges: hops.map((m) => [...m.values()]),
      paths: [...paths.values()].sort((a, b) => b.v - a.v),
      top: [...table.values()].sort((a, b) => b.v - a.v || (a.t < b.t ? -1 : 1)),
    };
  }


  const toRgb = (c) => {
    const s = String(c || "").trim();
    let m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return m[1].split("").map((x) => parseInt(x + x, 16));
    m = /rgba?\(([^)]+)\)/.exec(s);
    return m ? m[1].split(/[\s,/]+/).slice(0, 3).map(Number) : [150, 160, 180];
  };
  const rgb = (c) => "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")";
  const rgba = (c, a) => "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ")";
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const UP = [46, 227, 122], DOWN = [255, 90, 78], BLUE = [78, 162, 255], SLATE = [111, 125, 153];
  const leanRgb = (bull, bear) => {
    const att = bull + bear;
    if (att <= 0) return BLUE;
    const s = bull / att;
    return s >= 0.5 ? mix(BLUE, UP, clamp((s - 0.5) * 5, 0, 1)) : mix(BLUE, DOWN, clamp((0.5 - s) * 5, 0, 1));
  };

  const PER_M = 0.75, BAND_MAX = 42, BAND_MIN = 1.25, R0 = 6, R1 = 28;
  const nodeR = (v, vMax, k) => Math.max(9 * k, (R0 + R1 * Math.sqrt(Math.max(0, v) / (vMax || 1))) * k);
  const NICE = [1, 1.5, 2, 3, 4, 5, 6, 8];
  const niceBelow = (x) => {
    if (!(x > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(x)));
    let best = e;
    for (const m of NICE) if (m * e <= x * 1.0001) best = m * e;
    return best;
  };
  const fmtM = (v) => (v >= 1000 ? "$" + +(v / 1000).toFixed(1) + "B" : v >= 1 ? "$" + +v.toFixed(v < 10 ? 1 : 0) + "M" : "$" + Math.round(v * 1000) + "K");

  const mk = (w, hh) => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = hh;
    return cv;
  };
  function sphereSprite(c) {
    const S = 160, m = S / 2, cv = mk(S, S), g = cv.getContext("2d");
    const c1 = mix(c, WHITE, 0.42);
    let gr = g.createRadialGradient(S * 0.34, S * 0.3, 0, m, m, m);
    [[0, mix(c, WHITE, 0.93)], [0.14, c1], [0.48, c], [0.82, mix(c, BLACK, 0.5)], [1, mix(c, BLACK, 0.8)]].forEach(([o, x]) => gr.addColorStop(o, rgb(x)));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(m, m, m, 0, TAU);
    g.fill();
    gr = g.createRadialGradient(S * 0.3, S * 0.27, 0, m, m, m);
    gr.addColorStop(0.8, rgba(c1, 0));
    gr.addColorStop(0.94, rgba(c1, 0.6));
    gr.addColorStop(1, rgba(c1, 0.25));
    g.fillStyle = gr;
    g.fill();
    return cv;
  }
  function glowSprite(c, a0, a1) {
    const S = 64, cv = mk(S, S), g = cv.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(c, a0));
    gr.addColorStop(0.4, rgba(c, a1));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return cv;
  }
  const SHADOW = glowSprite(BLACK, 1, 0.5);
  const sphereOf = new Map(), haloOf = new Map();
  const spriteFor = (c) => {
    const k = rgb(c);
    if (sphereOf.size > 64) { sphereOf.clear(); haloOf.clear(); }
    if (!sphereOf.has(k)) { sphereOf.set(k, sphereSprite(c)); haloOf.set(k, glowSprite(c, 0.55, 0.18)); }
    return [sphereOf.get(k), haloOf.get(k)];
  };

  let MEAS = null;
  function chip(rows, o) {
    const m = MEAS || (MEAS = document.createElement("canvas").getContext("2d"));
    const dpr = o.dpr, padX = o.padX, padY = o.padY == null ? 3 : o.padY;
    let w = 0, hh = padY * 2;
    for (const row of rows) {
      row.w = 0;
      row.runs.forEach((r, i) => {
        if (r.g) r.w = 13;
        else { m.font = r.f + " " + o.ff; m.letterSpacing = r.ls || "0px"; r.w = m.measureText(r.t).width; }
        row.w += r.w + (i && !r.g && !row.runs[i - 1].g ? 5 : 0);
      });
      w = Math.max(w, row.w);
      hh += row.lh;
    }
    const cw = Math.ceil(w + 2 * padX), ch = o.h || Math.ceil(hh);
    const c = mk(Math.max(1, Math.round(cw * dpr)), Math.max(1, Math.round(ch * dpr)));
    const x = c.getContext("2d");
    x.scale(dpr, dpr);
    x.textBaseline = "middle";
    if (o.bg) {
      x.fillStyle = "rgba(10,13,20,0.9)";
      x.strokeStyle = "rgba(255,255,255,0.1)";
      x.lineWidth = 1;
      x.beginPath();
      if (x.roundRect) x.roundRect(0.5, 0.5, cw - 1, ch - 1, 6); else x.rect(0.5, 0.5, cw - 1, ch - 1);
      x.fill();
      x.stroke();
    }
    let y = rows.length === 1 ? (ch - rows[0].lh) / 2 : padY;
    for (const row of rows) {
      let tx = o.align === "center" ? (cw - row.w) / 2 : padX;
      const my = y + row.lh / 2;
      row.runs.forEach((r, i) => {
        if (i && !r.g && !row.runs[i - 1].g) tx += 5;
        if (r.g) {
          const gx = tx + 4.5;
          x.fillStyle = rgb(r.c);
          x.beginPath();
          if (r.g === "up") { x.moveTo(gx, my - 4); x.lineTo(gx + 4.6, my + 3.6); x.lineTo(gx - 4.6, my + 3.6); }
          else if (r.g === "down") { x.moveTo(gx, my + 4); x.lineTo(gx + 4.6, my - 3.6); x.lineTo(gx - 4.6, my - 3.6); }
          else x.rect(gx - 4.5, my - 1.6, 9, 3.2);
          x.fill();
        } else {
          x.font = r.f + " " + o.ff;
          x.letterSpacing = r.ls || "0px";
          x.fillStyle = r.c;
          x.fillText(r.t, tx, my);
        }
        tx += r.w;
      });
      y += row.lh;
    }
    return { c, w: cw, h: ch };
  }

  function mount(host, opts = {}) {
    if (!host) return null;
    if (NETS.has(host)) return NETS.get(host);
    const cfg = { names: num(opts.names) };
    const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frozen = false, still = RM.matches, dead = false;
    const undo = [];
    const on = (t, e, f, o) => { t.addEventListener(e, f, o); undo.push(() => t.removeEventListener(e, f, o)); };
    const abort = window.AbortController ? new AbortController() : null;

    const cv = h("canvas", { class: "fn-cv", role: "img", "aria-label": "Flow network: reading the flagged windows." });
    const hits = h("div", { class: "fn-hits", role: "group", "aria-label": "Network nodes; arrow keys move between them, R recentres the view" });
    const tip = h("div", { class: "fn-tip", "aria-hidden": "true", hidden: true });
    const empty = h("div", { class: "fn-empty", hidden: true });
    const home = h("button", { class: "fn-btn fn-home", type: "button", "aria-label": "Recentre the view", title: "Recentre the view", hidden: true }, UI.glyph("home"), h("span", { class: "fn-bl" }, "Recentre"));
    const freeze = h("button", { class: "fn-btn fn-freeze", type: "button", "aria-pressed": "false", hidden: true }, h("span", { class: "fn-bl" }, "Freeze"));
    const bar = h("div", { class: "fn-bar" }, h("span", { class: "fn-bar-sp" }), freeze, home);
    const stage = h("div", { class: "fn-stage" }, cv, hits, tip, empty);
    const lede = h("p", { class: "fn-lede" });
    const scale = h("div", { class: "fn-scale", hidden: true });
    const legend = h("div", { class: "ui-legend fn-legend" });
    const table = h("div", { class: "fn-paths" });
    host.replaceChildren(lede, bar, stage, scale, legend, table);
    const ctx = cv.getContext("2d");

    const card = host.closest(".ui-mod");
    const head = card && card.querySelector(".ui-mod-h");
    const pill = h("button", {
      class: "ui-fresh fn-fresh", type: "button", "data-state": "pending", "aria-haspopup": "dialog", "aria-controls": "fxPop",
      "aria-expanded": "false", "data-info": UI.info(() => (UI.freshness && UI.freshness.details ? UI.freshness.details() : { title: "Freshness" })),
    });
    let mode = "lean";
    const seg = UI.segmented("Network output", [{ label: "Lean" }, { label: "Expiry" }], (i) => setMode(i ? "dte" : "lean"), 0);
    const about = UI.infoButton("the flow network", aboutNet);
    if (head) {
      const t = head.querySelector(".ui-mod-t");
      if (t) t.after(pill); else head.prepend(pill);
      head.append(seg, about);
    }

    const S = { st: { state: "pending", reason: "Reading the flagged windows." }, rows: [], keys: null, readAt: null, session: null };
    const U = { map: null, state: "wait" };
    let M = null, W = 0, H = 0, dpr = 1, VERT = false, FF = "system-ui, sans-serif";
    const secFn = () => (U.state === "ok" ? (t) => (U.map.has(t) ? U.map.get(t) : null) : () => undefined);
    const N = new Map();
    let E = [], P = [], NL = [], LN = [[], [], [], []], HD = [], ORD = [], PN = 0, PB = null, READ = null;
    const FLR = [], PBN = new Int32Array(10);
    let raf = 0, last = 0, T = 0, inView = true, FOC = false, brMax = false, rz = 0;
    let hoverId = null, focusId = null, pinId = null, rowLit = null, rove = null, hitAt = 0, tipId = null, TRACE = null, tableSig = "";
    const REST = [0, 11 * DEG];
    const cam = { yaw: 0, pitch: REST[1], vy: 0, vp: 0, user: false, home: false, hold: false, idle: 0, cy: 1, sy: 0, cp: 1, sp: 0, sw: 8 * DEG };
    const RC = { cp: Math.cos(REST[1]), sp: Math.sin(REST[1]) };
    const G = { k: 1, vMax: 1, bpd: PER_M / 1e6, F: 1000, D: 10, ox: 0, oy: 0, s0: 100, top: 0, bottom: 0, midY: 0, floorW: 0, form: "line", cols: [], planes: [], edgeMax: 0 };
    const DRAG = { id: null, on: false, x: 0, y: 0, t: 0, vx: 0, vy: 0, eat: 0, tap: 0, tx: 0, ty: 0 };
    const stats = { frames: 0, ms: 0, last: 0, max: 0, ring: [] };
    const PJ = [0, 0, 1, 0], UW = [0, 0, 1];

    const nodeRgb = (d) => (d.resid ? SLATE : d.layer === 1 ? toRgb(UI.cssVar(d.tok || "--sect-none")) : leanRgb(d.bull, d.bear));

    function nodeChip(n, form) {
      const d = n.d, W1 = "rgba(245,245,247,0.97)", W2 = "rgba(235,235,245,0.68)", W3 = "rgba(235,235,245,0.5)", vt = form === "vert";
      const sub = d.layer === 3 ? pct(d.share) + (vt ? "" : " " + MID + " " + money(d.v)) : money(d.v);
      const gl = d.layer === 3 && d.lean ? { g: LEAN_GLYPH[d.lean], c: d.lean === "bull" ? UP : d.lean === "bear" ? DOWN : BLUE } : null;
      const rank = d.pos ? { t: String(d.pos), f: "500 " + (vt ? 9.5 : 11.5) + "px", c: W3 } : null;
      const nm = { t: vt && d.id === "n:~" ? "+" + d.members.length + " more" : d.label, f: "600 " + (vt ? 10.5 : 12.5) + "px", c: W1 };
      const top = [rank, gl, nm].filter(Boolean), o = { dpr, ff: FF, bg: true, padX: vt ? 4 : 7 };
      if (form === "line") return chip([{ lh: 16, runs: top.concat({ t: sub, f: "400 12px", c: W2 }) }], Object.assign(o, { h: 22 }));
      if (form === "stack") return chip([{ lh: 15, runs: top }, { lh: 13, runs: [{ t: sub, f: "400 11px", c: W2 }] }], Object.assign(o, { h: 32 }));
      return chip([{ lh: 12, runs: top }, { lh: 11, runs: [{ t: sub, f: "500 9.5px", c: W2 }] }], Object.assign(o, { h: 28, align: "center" }));
    }
    function aboutNet() {
      const m = M;
      return {
        title: "Flow network",
        lead: "Each flagged window's premium, split by the vendor's own attribution against the quote, routed through its sector and its name to its lean or its expiry.",
        facts: m ? [["Windows", count(m.windows)], ["Premium", money(m.total)], ["Names", count(m.names)], ["Sectors", U.state === "ok" ? "Nightly universe" : U.state === "fail" ? "Not readable" : "Pending"], ["Read", S.readAt ? F.time(S.readAt) : null]] : [],
        notes: [
          "These are the vendor's flagged alerts, not every execution: the selection is the vendor's rules, so a name missing here is not a quiet name.",
          "Calls at ask and puts at bid are drawn bullish, calls at bid and puts at ask bearish. That is the usual convention on the side of the quote, never proof of who initiated.",
          "Unattributed is premium the vendor left between the quotes, or a window it never split by side.",
          "Every layer is ranked by premium, largest at the top; Other, No sector and the unread or pending sector buckets sit at the bottom whatever their size.",
          "Sphere area and band width are premium in dollars, on one scale for every node and band, and every layer carries the same total. Light runs along each band from the side of the quote to its lean, faster the larger the band: a picture of the record, not a feed of executions. A flare marks a window that reached this page while it was open.",
          "Sectors come from the nightly universe; a name it does not carry is drawn under No sector. Expiry is counted in calendar days from the window's own Eastern date.",
          "Contracts are shown for a name, a sector or an expiry only when every window in it states its size; a side or a lean shows none, because the vendor splits premium by side, not contracts.",
          "Only the largest names and sectors get their own node; the rest are folded into Other, so every layer still sums to the same premium. Drag to turn the network; double click or R recentres it; Freeze holds it still.",
        ],
      };
    }

    function paintPill() {
      const st = UI.freshness && UI.freshness.state ? UI.freshness.state() : "pending";
      const def = UI.STATES[st] || UI.STATES.pending;
      const word = { live: "Live", fresh: "Current", closed: "Closed", stale: "Stale", pending: "Pending" }[st] || def.word;
      const at = S.readAt ? F.time(S.readAt) : null;
      pill.dataset.state = st;
      pill.replaceChildren(UI.glyph(def.g), h("span", { class: "fx-fresh-l" }, at ? h("span", { class: "fn-fw" }, word + " " + MID + " ") : word, at));
      pill.setAttribute("aria-label", "Freshness of the flagged windows: " + def.word + (at ? ", read " + at : ""));
    }
    const fx = document.getElementById("fxFresh");
    if (fx && window.MutationObserver) {
      const mo = new MutationObserver(paintPill);
      mo.observe(fx, { attributes: true, attributeFilter: ["data-state", "data-label"] });
      undo.push(() => mo.disconnect());
    }
    paintPill();

    function sentence() {
      if (!M || !M.windows) return "Flow network: " + (S.st && S.st.reason ? S.st.reason : "no flagged windows to draw.");
      const top = M.top.slice(0, 3).map((r) => r.t + ", " + r.kind.toLowerCase() + ", " + money(r.v) + (r.sector ? ", " + r.sector : "")).join("; ");
      const t = M.total;
      return "Flow network of " + count(M.windows) + " flagged " + plural(M.windows, "window", "windows") + " carrying " + money(t) +
        " of premium. Largest paths: " + top + ". By the usual convention " + pct(M.lean.bull / t) + " of it leans bullish, " +
        pct(M.lean.bear / t) + " bearish, and " + pct(M.lean.nx / t) + " is unattributed.";
    }

    function paintLede() {
      const bits = ["Where flagged option premium is flowing: from the side of the quote it met, through sector and name, to its " + (mode === "lean" ? "lean" : "expiry") +
        ", each layer ranked by premium, largest " + (VERT ? "first" : "at the top") + ", leftover buckets last. "];
      if (M && M.windows) {
        bits.push(h("b", null, money(M.total)), " across " + count(M.windows) + " " + plural(M.windows, "window", "windows") + ", ",
          h("b", null, pct(M.lean.bull / M.total)), " leaning bullish and ", h("b", null, pct(M.lean.bear / M.total)), " bearish by convention. ");
      }
      bits.push(h("span", { class: "fn-lede-x" }, "The vendor's flagged alerts, not every execution."));
      lede.replaceChildren(...bits);
    }

    function paintTable() {
      const top = M ? M.top.slice(0, 24) : [];
      const sig = top.map((r) => r.t + r.k + Math.round(r.v) + r.sector).join("|");
      if (sig === tableSig) return;
      tableSig = sig;
      if (!top.length) { table.replaceChildren(); return; }
      const was = table.querySelector(".ui-disclose");
      const opened = !!was && was.getAttribute("aria-expanded") === "true";
      const af = document.activeElement, fr = af && table.contains(af) ? af.closest("tr") : null;
      const focusKey = fr ? fr.dataset.t + "|" + fr.dataset.k : af && af.classList.contains("ui-disclose") && table.contains(af) ? "more" : null;
      const rows = top.map((r) => {
        const tr = h("tr", { "data-t": r.t, "data-k": r.k },
          h("th", { scope: "row" }, h("a", { href: "/flows/ticker/?t=" + encodeURIComponent(r.t) }, r.t), h("span", { class: "fn-tsec" }, r.sector)),
          h("td", { class: "fn-csec", title: r.sectorFull || null }, r.sector),
          h("td", null, r.kind),
          h("td", { class: "c-num" }, money(r.v)),
          h("td", null, h("span", { class: "fn-lean", "data-lean": r.lean }, UI.glyph(LEAN_GLYPH[r.lean]), h("span", { class: "fn-lw" }, LEANS[r.lean]))));
        const on = () => { rowLit = { t: r.t, k: r.k }; relight(); };
        const off = () => { if (rowLit && rowLit.t === r.t && rowLit.k === r.k) { rowLit = null; relight(); } };
        tr.addEventListener("pointerenter", on);
        tr.addEventListener("pointerleave", off);
        tr.addEventListener("focusin", on);
        tr.addEventListener("focusout", off);
        return tr;
      });
      const SHOW = 5;
      rows.forEach((r, i) => { r.hidden = i >= SHOW; });
      const tab = h("table", { class: "fn-tab" },
        h("caption", null, "Largest paths by premium"),
        h("thead", null, h("tr", null, ["Name", "Sector", "Side", "Premium", "Lean"].map((c, i) => h("th", { scope: "col", class: i === 3 ? "c-num" : i === 1 ? "fn-csec" : null }, c)))),
        h("tbody", null, rows));
      const kids = [tab];
      if (rows.length > SHOW) {
        const b = h("button", { class: "ui-disclose", type: "button", "aria-expanded": "false" }, h("span", null, "All " + rows.length), UI.glyph("chev"));
        b.addEventListener("click", () => {
          const open = b.getAttribute("aria-expanded") !== "true";
          b.setAttribute("aria-expanded", String(open));
          rows.forEach((r, i) => { if (i >= SHOW) r.hidden = !open; });
          b.firstChild.textContent = open ? "Fewer" : "All " + rows.length;
        });
        kids.push(b);
      }
      table.replaceChildren(...kids);
      if (opened && kids[1]) kids[1].click();
      if (focusKey) {
        const el = focusKey === "more" ? kids[1] : rows.find((r) => r.dataset.t + "|" + r.dataset.k === focusKey);
        const a = el && (el.tagName === "TR" ? el.querySelector("a") : el);
        if (a && !a.closest("[hidden]")) a.focus({ preventScroll: true });
      }
    }


    function paintLegend() {
      const k = (g, cls, text) => h("span", { class: "ui-key fn-k " + cls }, UI.glyph(g), text);
      legend.replaceChildren(
        k("up", "is-up", "Bullish lean: calls at ask, puts at bid"),
        k("down", "is-down", "Bearish lean: calls at bid, puts at ask"),
        k("flat", "is-nx", "Unattributed"),
        h("span", { class: "ui-key fn-k is-slate" }, h("i", { class: "fn-dot" }), "Other, No sector"),
        h("span", { class: "ui-key fn-k is-note" }, "Sphere area and band width are premium in USD, one scale throughout; every layer carries the same total" + (still ? "" : "; light runs from side to lean and a flare marks a window that arrived while you watched") + ". Drag to turn; " + (matchMedia("(pointer: coarse)").matches ? "double tap" : "double click") + " to recentre"));
    }

    function paintScale() {
      if (!M) { scale.hidden = true; return; }
      scale.hidden = false;
      const vm = G.vMax / 1e6, top = niceBelow(vm), em = G.edgeMax / 1e6, etop = niceBelow(em);
      const circ = [top / 12, top / 3, top].map((v) => {
        const r = nodeR(v * 1e6, G.vMax, G.k), s = Math.ceil(r * 2 + 2), c = mk(Math.round(s * dpr), Math.round(s * dpr));
        const g = c.getContext("2d");
        g.scale(dpr, dpr);
        g.drawImage(spriteFor(SLATE)[0], 1, 1, r * 2, r * 2);
        c.style.width = s + "px";
        c.style.height = s + "px";
        return h("span", { class: "fn-lg-i", "data-v": v, "data-r": r.toFixed(2) }, c, h("span", null, fmtM(v)));
      });
      const bands = [etop / 15, etop / 3, etop].map((v) => {
        const w = Math.max(BAND_MIN, Math.min(BAND_MAX * G.k, v * 1e6 * G.bpd)), s = Math.ceil(w + 2), c = mk(Math.round(40 * dpr), Math.round(s * dpr));
        const g = c.getContext("2d");
        g.scale(dpr, dpr);
        g.fillStyle = rgba(BLUE, 0.45);
        g.strokeStyle = rgba(mix(BLUE, WHITE, 0.35), 0.85);
        g.fillRect(0, (s - w) / 2, 40, w);
        g.strokeRect(0.5, (s - w) / 2 + 0.5, 39, Math.max(0, w - 1));
        c.style.width = "40px";
        c.style.height = s + "px";
        return h("span", { class: "fn-lg-i", "data-v": v, "data-w": w.toFixed(2) }, c, h("span", null, fmtM(v)));
      });
      scale.replaceChildren(h("span", { class: "fn-lg-g" }, h("span", { class: "fn-lg-t" }, "Sphere area " + MID + " premium"), ...circ), h("span", { class: "fn-lg-g" }, h("span", { class: "fn-lg-t" }, "Band width " + MID + " premium"), ...bands));
    }

    function size() {
      const w = stage.clientWidth || host.clientWidth || 640;
      VERT = w < 640;
      FF = getComputedStyle(host).fontFamily || FF;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = w;
    }

    const unp = (sx, sy, z) => {
      const u = (G.oy - sy) / G.F;
      const y = (u * (z * RC.cp + G.D) - z * RC.sp) / (RC.cp + u * RC.sp);
      UW[0] = (sx - G.ox) * (z * RC.cp - y * RC.sp + G.D) / G.F;
      UW[1] = y;
      UW[2] = z * RC.cp - y * RC.sp + G.D;
    };
    function proj(X, Y, Z) {
      const x1 = X * cam.cy - Z * cam.sy, z1 = X * cam.sy + Z * cam.cy;
      const y2 = Y * cam.cp + z1 * cam.sp, z2 = z1 * cam.cp - Y * cam.sp;
      const d = Math.max(0.1, z2 + G.D), s = G.F / d;
      PJ[0] = G.ox + x1 * s; PJ[1] = G.oy - y2 * s; PJ[2] = s; PJ[3] = d;
    }
    function setCam(yaw, pitch) {
      cam.yaw = yaw;
      cam.pitch = pitch;
      cam.cy = Math.cos(yaw); cam.sy = Math.sin(yaw); cam.cp = Math.cos(pitch); cam.sp = Math.sin(pitch);
    }

    function stack(radii, resid, height, minGap, maxGap) {
      const unit = (i) => (i > 0 && resid[i] && !resid[i - 1] ? 1.6 : 1);
      let sum = 0, units = 0;
      radii.forEach((r, i) => { sum += 2 * r; if (i > 0) units += unit(i); });
      const gap = radii.length > 1 ? clamp((height - sum) / units, minGap, maxGap) : 0;
      let y = -(sum + gap * units) / 2;
      return radii.map((r, i) => { if (i > 0) y += gap * unit(i); const c = y + r; y += 2 * r; return c; });
    }
    const gapUnits = (L) => L.length - 1 + (L.some((n, i) => i && n.d.resid && !L[i - 1].d.resid) ? 0.6 : 0);

    function layout() {
      const vm = G.vMax, ghost = !M;
      const sizes = (k) => { G.k = k; for (const n of NL) n.r = ghost ? 7 * k : nodeR(n.d.v, vm, k); };
      const rMax = (L) => L.reduce((m, n) => Math.max(m, n.r), 0), cMax = (L) => L.reduce((m, n) => Math.max(m, n.chip ? n.chip.w : 0), 0);
      const tops = 70, tail = 48, margin = W > 900 ? 36 : 22;
      let base = W >= 1100 ? 1 : W >= 760 ? 0.85 : 0.72;
      const cols = [];
      if (!VERT) {
        const tries = [["line", base], ["stack", base], ["stack", base * 0.9], ["stack", base * 0.8], ["stack", base * 0.7]];
        let pick = tries[tries.length - 1];
        for (const t of tries) {
          sizes(t[1]);
          if (!ghost) for (const n of NL) n.chip = nodeChip(n, t[0]);
          const rm = LN.map(rMax), cw = LN.map(cMax), s0 = (W - 2 * margin - (rm[0] + 8 + cw[0]) - (rm[3] + 8 + cw[3])) / 6;
          pick = t;
          if (ghost || [1, 2].every((c) => cw[c] + rm[c] + 8 + rm[c + 1] + 8 <= 2 * s0)) break;
        }
        G.form = pick[0];
        const ch = G.form === "line" ? 22 : 32, rm = LN.map(rMax), cw = LN.map(cMax);
        const gaps = LN.map((L) => Math.max(6, ...L.slice(1).map((n, i) => ch + 3 - n.r - L[i].r)));
        const spans = LN.map((L, li) => L.reduce((s, n) => s + 2 * n.r, 0) + gapUnits(L) * gaps[li]);
        H = Math.round(clamp(Math.max(W * 0.42, 520, tops + Math.max(...spans) + tail), 440, 960));
        G.top = tops; G.bottom = H - tail; G.midY = (G.top + G.bottom) / 2;
        const left = rm[0] + 8 + cw[0], right = rm[3] + 8 + cw[3], s0 = (W - 2 * margin - left - right) / 6;
        G.ox = W / 2 + (left - right) / 2; G.s0 = Math.max(s0, 1); G.oy = G.midY;
        [-3, -1, 1, 3].forEach((wx, i) => {
          const x = G.ox + wx * s0, side = i ? "start" : "end";
          cols.push({ x, wx, side, rMax: rm[i], chipX: side === "end" ? x - rm[i] - 8 : x + rm[i] + 8 });
        });
        LN.forEach((L, li) => {
          const ys = stack(L.map((n) => n.r), L.map((n) => !!n.d.resid), G.bottom - G.top, gaps[li], 88);
          L.forEach((n, j) => { n.sx = cols[li].x; n.sy = G.midY + ys[j]; n.tier = 0; });
        });
        G.hd = cols.map((c) => [c.x, 34]);
      } else {
        sizes(0.62);
        G.form = "vert";
        const ch = 28, side = 12, use = Math.max(20, W - 2 * side), rows = [];
        LN.forEach((L, li) => {
          if (!ghost) for (const n of L) n.chip = nodeChip(n, "vert");
          const xs = stack(L.map((n) => n.r), L.map((n) => !!n.d.resid), use, 4, 64).map((x) => W / 2 + x);
          const w = L.map((n) => (n.chip ? n.chip.w : 0));
          let tiers = 3;
          for (const t of [1, 2]) if (L.every((n, j) => j + t >= L.length || (w[j] + w[j + t]) / 2 + 3 <= xs[j + t] - xs[j])) { tiers = t; break; }
          L.forEach((n, j) => { n.sx = xs[j]; n.tier = j % tiers; });
          const rm = rMax(L);
          rows.push({ rm, up: rm + 16, down: rm + 4 + (ghost ? 0 : tiers * (ch + 2) - 2), tiers });
        });
        const pitch = Math.max(...rows.slice(0, 3).map((r, i) => r.down + rows[i + 1].up + 4), 60), y0 = 8 + rows[0].up;
        LN.forEach((L, li) => L.forEach((n) => { n.sy = y0 + li * pitch; }));
        H = Math.ceil(y0 + 3 * pitch + rows[3].down + 34);
        G.top = y0; G.bottom = y0 + 3 * pitch; G.midY = (G.top + G.bottom) / 2; G.ox = W / 2; G.oy = G.midY; G.s0 = pitch / 2;
        rows.forEach((r, i) => cols.push({ x: y0 + i * pitch, wx: (i - 1.5) * 2, side: "start", rMax: r.rm, up: r.up, down: r.down }));
        G.hd = cols.map((c) => [side, c.x - c.rMax - 10]);
      }
      G.F = 1.9 * Math.max(W, 120);
      G.D = G.F / G.s0;
      G.cols = cols;
      G.ch = G.form === "line" ? 22 : G.form === "stack" ? 32 : 28;
      stage.style.height = H + "px";
      const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      const keep = [cam.yaw, cam.pitch];
      setCam(0, REST[1]);
      const rp = cols.map((c, i) => {
        if (!VERT) {
          unp(c.x, G.top - 14, 0); const yT = UW[1];
          unp(c.x, G.bottom + 14, 0); const yB = UW[1], z = 0.42 + 0.075 * c.wx * c.wx, th = c.wx * 5 * DEG, hw = 0.68, dx = hw * Math.cos(th), dz = hw * Math.sin(th);
          return [c.wx - dx, yT, z - dz, c.wx + dx, yT, z + dz, c.wx + dx, yB, z + dz, c.wx - dx, yB, z - dz];
        }
        unp(2, c.x, 0); const xl = UW[0]; unp(W - 2, c.x, 0); const xr = UW[0];
        unp(2, c.x - c.up, 0); const yT = UW[1]; unp(2, c.x + c.down, 0); const yB = UW[1], z = 0.42 + 0.075 * c.wx * c.wx;
        return [xl, yT, z, xr, yT, z, xr, yB, z, xl, yB, z];
      });
      G.planes = rp;
      unp(G.ox, VERT ? H - 12 : G.bottom + 30, 0);
      G.floorW = UW[1];
      setCam(keep[0], keep[1]);
      HD = [];
      if (!ghost) {
        const total = money(M.total);
        CAPTIONS[mode].forEach((t, i) => {
          const c = chip([{ lh: 12, runs: [{ t: t.toUpperCase() + " " + MID + " " + total, f: "650 " + (VERT ? 10 : 11) + "px", c: "rgba(235,235,245,0.66)", ls: "0.14em" }] }], { dpr, ff: FF, padX: 0, padY: 0, h: 12 });
          HD.push({ c, w: c.w, h: 12, ax: G.hd[i][0], ay: G.hd[i][1], text: t.toUpperCase() + " " + MID + " " + total, x: 0, y: 0 });
        });
      }
    }

    function rebuild() {
      size();
      M = S.rows.length ? model(S.rows, { out: mode, names: cfg.names || (VERT ? clamp(Math.floor(W / 46), 5, 9) : 10), session: S.session, sectorOf: secFn(), unread: U.state === "fail" }) : null;
      if (M && !M.windows) M = null;
      const was = new Map(N);
      N.clear();
      E = []; P = []; FLR.length = 0;
      let vMax = 0;
      if (M) {
        for (const layer of M.layers) for (const d of layer) vMax = Math.max(vMax, d.v);
        M.layers.forEach((layer) => layer.forEach((d, i) => {
          const n = was.get(d.id) || { id: d.id, gx: NaN, gy: NaN, cr: 0, hl: 0, dm: 0, tl: 1, born: true };
          n.d = d; n.layer = d.layer; n.rk = i; n.col = nodeRgb(d);
          [n.sph, n.halo] = spriteFor(n.col);
          n.out = []; n.inn = [];
          N.set(d.id, n);
        }));
        LN = M.layers.map((l) => l.map((d) => N.get(d.id)));
        NL = [...N.values()];
      } else {
        LN = [4, 6, 6, 3].map((k, li) => Array.from({ length: k }, (_, i) => ({ id: "g" + li + i, d: { layer: li, v: 1, resid: 0 }, layer: li, rk: i, gx: NaN, gy: NaN, cr: 0, hl: 0, dm: 0, tl: 1, born: true, out: [], inn: [], col: SLATE, chip: null })));
        NL = LN.flat();
      }
      G.vMax = vMax || 1;
      layout();
      G.bpd = Math.min(PER_M, 56 / Math.max(vMax / 1e6, 1e-9)) * G.k / 1e6;
      if (M) {
        const byKey = new Map();
        let id = 0, em = 0;
        M.edges.forEach((hop) => hop.forEach((e) => {
          const c = leanRgb(e.bull, e.bear), r = { id: id++, a: N.get(e.a), b: N.get(e.b), v: e.v, bull: e.bull, bear: e.bear, nx: e.nx, hl: 0, dm: 0, tl: 1, fl: 0, cs: rgb(c), ecs: rgb(mix(c, WHITE, 0.35)) };
          r.ws = e.v * G.bpd;
          r.w0 = clamp(r.ws, BAND_MIN, BAND_MAX * G.k);
          r.a.out.push(r); r.b.inn.push(r);
          em = Math.max(em, e.v);
          byKey.set(e.a + "|" + e.b, r);
          E.push(r);
        }));
        G.edgeMax = em;
        const cross = VERT ? (n) => n.sx : (n) => n.sy;
        for (const n of NL) {
          n.out.sort((p, q) => cross(p.b) - cross(q.b) || q.v - p.v);
          n.inn.sort((p, q) => cross(p.a) - cross(q.a) || q.v - p.v);
        }
        PN = 0;
        for (const e of E) {
          const sh = Math.sqrt(e.v / em), len = Math.hypot(e.b.sx - e.a.sx, e.b.sy - e.a.sy) * 1.04;
          e.pn = Math.max(1, Math.min(1 + Math.round(3 * sh), Math.floor(len / 70)));
          e.per = 7 - 4.6 * sh;
          e.ph = clamp(e.w0 * 0.55, 2, 8);
          e.pc = Math.min(4, Math.round((e.ph - 2) / 1.5));
          e.pp = (e.id * 0.37) % 1;
          PN += e.pn;
        }
        P = M.paths.map((p) => ({ key: p.key, ids: p.ids, v: p.v, e: [0, 1, 2].map((k) => byKey.get(p.ids[k] + "|" + p.ids[k + 1])) }));
        PB = Array.from({ length: 10 }, () => new Float32Array(Math.max(4, PN * 4)));
      }
      for (const n of NL) if (n.born || isNaN(n.gx) || still) { n.gx = n.sx; n.gy = n.sy; n.cr = still ? n.r : 0; n.born = false; }
      ORD = NL.slice();
      NL.forEach((n) => { n.lb = n.lb || [0, 0, 0, 0]; });
      cv.setAttribute("aria-label", sentence());
      paintLede();
      paintTable();
      paintScale();
      buildHits();
      home.hidden = !M;
      freeze.hidden = !M || RM.matches;
      const st = S.st || { state: "pending" };
      if (M) empty.hidden = true;
      else {
        const def = UI.STATES[st.state] || UI.STATES.pending;
        const word = { ok: "Nothing flagged", quiet: "Nothing flagged", pending: "Reading", unavailable: "Unavailable" }[st.state] || def.word;
        empty.replaceChildren(UI.glyph(def.g), h("b", null, word), h("span", null, st.reason || "The vendor's rules flagged nothing in this read."));
        empty.dataset.state = st.state;
        empty.hidden = false;
      }
      settle();
      relight();
    }

    const fogAt = (z, lo) => clamp(1 - (z - (G.D - 1.2)) / 3.8, lo, 1);

    function pose(light) {
      const tw = TAU / 6;
      for (const n of NL) {
        unp(n.gx, n.gy, 0);
        const s0 = G.F / UW[2];
        proj(UW[0], UW[1], 0);
        n.px = PJ[0]; n.py = PJ[1]; n.f = PJ[2] / s0; n.pz = PJ[3];
        n.R = n.cr * n.f * (brMax ? 1.03 : still ? 1 : 1 + 0.015 * (1 - Math.cos(T * tw + n.rk * 0.125 * TAU)));
        n.fog = fogAt(n.pz, 0.6);
        n.A = VERT ? n.py : n.px; n.C = VERT ? n.px : n.py;
        const c = n.chip, lb = n.lb;
        if (c) {
          const cl = G.cols[n.layer];
          lb[2] = c.w; lb[3] = c.h;
          if (VERT) { lb[0] = clamp(n.px - c.w / 2, 2, Math.max(2, W - 2 - c.w)); lb[1] = n.py + cl.rMax * n.f + 4 + n.tier * (c.h + 2); }
          else { lb[0] = cl.side === "end" ? n.px - (cl.rMax * n.f + 8) - c.w : n.px + cl.rMax * n.f + 8; lb[1] = n.py - c.h / 2; }
        }
      }
      for (const hd of HD) {
        unp(hd.ax, hd.ay, 0);
        proj(UW[0], UW[1], 0);
        hd.x = VERT ? PJ[0] : PJ[0] - hd.w / 2;
        hd.y = PJ[1] - hd.h / 2;
      }
      if (light) return;
      for (const n of NL) {
        let tot = 0;
        for (const e of n.out) tot += e.ws;
        let y = n.C - tot * n.f / 2;
        for (const e of n.out) { e.a0 = y; y += e.ws * n.f; e.a1 = y; }
        tot = 0;
        for (const e of n.inn) tot += e.ws;
        y = n.C - tot * n.f / 2;
        for (const e of n.inn) { e.b0 = y; y += e.ws * n.f; e.b1 = y; }
      }
      for (const e of E) {
        const a = e.a, b = e.b;
        e.ha = Math.max(e.w0 * a.f, e.a1 - e.a0) / 2;
        e.hb = Math.max(e.w0 * b.f, e.b1 - e.b0) / 2;
        e.ma = (e.a0 + e.a1) / 2; e.mb = (e.b0 + e.b1) / 2;
        e.x0 = a.A + a.R * 0.6; e.x1 = b.A - b.R * 0.6;
        e.dx = (e.x1 - e.x0) * 0.46;
        e.len = Math.hypot(e.x1 - e.x0, e.mb - e.ma) * 1.02 + 1;
      }
    }

    const tr = (k, id) => { if (TRACE) TRACE.push({ k, id }); };
    function stageLayer(c) {
      const near = G.D - 1, far = G.D + 7, fy = G.floorW;
      c.strokeStyle = "rgb(120,160,255)";
      c.lineWidth = 0.8;
      for (let i = 0; i < 23; i++) {
        const x = i < 13, v = x ? i - 6 : i - 13 - 1.2;
        if (x) proj(v, fy, -1.2); else proj(-6, fy, v);
        const ax = PJ[0], ay = PJ[1], az = PJ[3];
        if (x) proj(v, fy, 7.8); else proj(6, fy, v);
        c.globalAlpha = 0.55 * clamp(1 - ((az + PJ[3]) / 2 - near) / (far - near), 0.15, 1);
        c.beginPath();
        c.moveTo(ax, ay);
        c.lineTo(PJ[0], PJ[1]);
        c.stroke();
      }
      tr("floor");
      if (M) {
        for (const n of NL) {
          unp(n.gx, n.gy, 0);
          const wx = UW[0], wy = UW[1], s0 = G.F / UW[2], ht = wy - fy;
          proj(wx + ht * 0.16, fy, ht * 0.2);
          const rx = n.cr * 1.25 * PJ[2] / s0, ry = rx * Math.max(0.16, cam.sp * 1.15);
          c.globalAlpha = 0.35 * fogAt(PJ[3], 0.7) * (1 - 0.65 * n.dm);
          c.drawImage(SHADOW, PJ[0] - rx, PJ[1] - ry, rx * 2, ry * 2);
        }
      }
      tr("shadows");
      c.fillStyle = "rgb(96,140,255)";
      c.strokeStyle = "rgb(140,180,255)";
      c.lineJoin = "round";
      c.lineWidth = 1;
      const pl = G.planes;
      for (let i = 0; i < pl.length; i++) {
        const q = pl[i];
        c.beginPath();
        let z = 0;
        for (let k = 0; k < 4; k++) {
          proj(q[k * 3], q[k * 3 + 1], q[k * 3 + 2]);
          z += PJ[3];
          if (k) c.lineTo(PJ[0], PJ[1]); else c.moveTo(PJ[0], PJ[1]);
        }
        c.closePath();
        const fg = clamp(1 - (z / 4 - (G.D - 1.2)) / 4.8, 0.4, 1);
        c.globalAlpha = 0.06 * fg;
        c.fill();
        c.globalAlpha = 0.22 * fg;
        c.stroke();
      }
      tr("planes");
    }

    function ghosts(c) {
      c.fillStyle = "rgba(9,12,20,0.9)";
      c.strokeStyle = "rgba(160,180,220,0.28)";
      c.lineWidth = 1;
      c.globalAlpha = 1;
      for (const n of NL) {
        c.beginPath();
        c.arc(n.px, n.py, Math.max(0, n.r * n.f), 0, TAU);
        c.fill();
        c.stroke();
      }
    }

    function headers(c) {
      c.globalAlpha = 0.95;
      for (const hd of HD) c.drawImage(hd.c.c, hd.x, hd.y, hd.w, hd.h);
      tr("heads");
    }

    const WCLS = [1.6, 2.6, 3.6, 4.6, 5.6];
    function bands(c) {
      if (VERT) c.setTransform(0, dpr, dpr, 0, 0, 0);
      c.globalCompositeOperation = "screen";
      c.lineJoin = "round";
      c.lineWidth = 1;
      for (const e of E) {
        const x0 = e.x0, x1 = e.x1, dx = e.dx, ma = e.ma, mb = e.mb, ha = e.ha, hb = e.hb;
        const fog = clamp((e.a.fog + e.b.fog) / 2, 0.55, 1), lit = Math.max(e.hl, e.fl), dm = e.dm;
        c.beginPath();
        c.moveTo(x0, ma - ha);
        c.bezierCurveTo(x0 + dx, ma - ha, x1 - dx, mb - hb, x1, mb - hb);
        c.lineTo(x1, mb + hb);
        c.bezierCurveTo(x1 - dx, mb + hb, x0 + dx, ma + ha, x0, ma + ha);
        c.closePath();
        c.fillStyle = e.cs;
        c.globalAlpha = (((0.28 + 0.42 * lit) * (1 - dm)) + 0.08 * dm) * fog;
        c.fill();
        if (ha + hb > 3.2) {
          c.strokeStyle = e.ecs;
          c.globalAlpha = (((0.5 + 0.5 * lit) * (1 - dm)) + 0.1 * dm) * fog;
          c.stroke();
        }
      }
      tr("bands");
      if (!still) pulses(c);
      c.globalCompositeOperation = "source-over";
      if (VERT) c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function pulses(c) {
      PBN.fill(0);
      const t = T;
      for (const e of E) {
        const bright = e.dm < 0.5 ? 0 : 5, ml = e.ma, mb = e.mb, x0 = e.x0, x1 = e.x1, dx = e.dx;
        const du = 16 / e.len, b = PB[e.pc + bright], o0 = PBN[e.pc + bright];
        let o = o0;
        for (let i = 0; i < e.pn; i++) {
          let u = t / e.per + i / e.pn + e.pp;
          u -= Math.floor(u);
          const u0 = u > du ? u - du : 0;
          for (let k = 0; k < 2; k++) {
            const q = k ? u0 : u, m = 1 - q, w0 = m * m * m, w1 = 3 * m * m * q, w2 = 3 * m * q * q, w3 = q * q * q;
            b[o++] = w0 * x0 + w1 * (x0 + dx) + w2 * (x1 - dx) + w3 * x1;
            b[o++] = (w0 + w1) * ml + (w2 + w3) * mb;
          }
        }
        PBN[e.pc + bright] = o;
      }
      c.lineCap = "round";
      c.strokeStyle = "rgb(255,255,255)";
      for (let k = 0; k < 10; k++) {
        const n = PBN[k];
        if (!n) continue;
        const b = PB[k], dim = k >= 5, w = WCLS[k % 5];
        for (let pass = 0; pass < 2; pass++) {
          c.globalAlpha = (pass ? 0.8 : 0.1) * (dim ? 0.07 : 1);
          c.lineWidth = pass ? w : w * 2.4;
          c.beginPath();
          for (let i = 0; i < n; i += 4) { c.moveTo(b[i], b[i + 1]); c.lineTo(b[i + 2], b[i + 3]); }
          c.stroke();
        }
      }
      c.lineCap = "butt";
      tr("pulses");
    }

    function spheres(c) {
      for (let i = 1; i < ORD.length; i++) {
        const it = ORD[i];
        let j = i - 1;
        while (j >= 0 && ORD[j].pz < it.pz) { ORD[j + 1] = ORD[j]; j--; }
        ORD[j + 1] = it;
      }
      const vm = G.vMax;
      for (const n of ORD) {
        const R = n.R;
        if (R < 0.3) continue;
        if (TRACE) TRACE.push({ k: "node", id: n.id, z: n.pz, x: n.px, y: n.py, r: R });
        const al = n.fog * (1 - 0.65 * n.dm), sq = Math.sqrt(n.d.v / vm), hot = n.id === hoverId || n.id === focusId || n.id === pinId;
        let fl = 0;
        for (const f of FLR) if (f.n === n) fl = Math.max(fl, f.lit);
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = al * Math.min(1, 0.1 + 0.3 * sq + (hot ? 0.25 : 0) + 0.4 * fl);
        const hr = R * (1.45 + 0.5 * sq);
        c.drawImage(n.halo, n.px - hr, n.py - hr, hr * 2, hr * 2);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = al;
        c.drawImage(n.sph, n.px - R, n.py - R, R * 2, R * 2);
        for (const f of FLR) {
          const a = T - f.t0;
          if (f.n !== n || a < 0 || a > 1.2) continue;
          c.strokeStyle = rgb(mix(n.col, WHITE, 0.35));
          c.lineWidth = 2.2;
          c.globalAlpha = 0.95 * (1 - a / 1.2) * n.fog;
          c.beginPath();
          c.arc(n.px, n.py, R * (1 + 1.4 * a / 1.2), 0, TAU);
          c.stroke();
        }
        if (n.id === focusId || n.id === hoverId || n.id === pinId) {
          c.globalAlpha = 1;
          c.strokeStyle = "rgba(245,245,247,0.9)";
          c.lineWidth = n.id === hoverId && n.id !== focusId ? 1.5 : 2;
          c.beginPath();
          c.arc(n.px, n.py, R + 4, 0, TAU);
          c.stroke();
        }
      }
      tr("spheres");
    }

    function labels(c) {
      c.globalCompositeOperation = "source-over";
      if (VERT) {
        c.lineWidth = 1;
        for (const n of NL) {
          if (!n.tier) continue;
          c.strokeStyle = rgba(n.col, 0.55 * n.fog);
          c.globalAlpha = 1;
          c.beginPath();
          c.moveTo(n.px, n.py + n.R);
          c.lineTo(n.px, n.lb[1]);
          c.stroke();
        }
      }
      for (const n of NL) {
        const lb = n.lb, a = Math.max(0.3, 1 - 0.7 * n.dm) * (0.82 + 0.18 * n.fog);
        c.globalAlpha = a;
        c.drawImage(n.chip.c, lb[0], lb[1], lb[2], lb[3]);
        if (n.id === hoverId || n.id === focusId || n.id === pinId) {
          c.globalAlpha = 0.45;
          c.strokeStyle = "rgb(255,255,255)";
          c.lineWidth = 1;
          c.beginPath();
          if (c.roundRect) c.roundRect(lb[0] + 0.5, lb[1] + 0.5, lb[2] - 1, lb[3] - 1, 6); else c.rect(lb[0] + 0.5, lb[1] + 0.5, lb[2] - 1, lb[3] - 1);
          c.stroke();
        }
      }
      if (READ) { c.globalAlpha = 1; c.drawImage(READ.c, W - 14 - READ.w, 4, READ.w, READ.h); }
      c.globalAlpha = 1;
      tr("labels");
    }

    function draw() {
      const c = ctx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      pose(!M);
      stageLayer(c);
      if (!M) { ghosts(c); return; }
      bands(c);
      headers(c);
      spheres(c);
      labels(c);
    }
    const contracts = (d) => (d.contracts ? count(d.contracts) + " " + plural(d.contracts, "contract", "contracts") : null);
    function hitLabel(d) {
      const lean = d.v ? " Lean by convention: " + pct(d.bull / d.v) + " bullish, " + pct(d.bear / d.v) + " bearish, " + pct(d.nx / d.v) + " unattributed." : "";
      const what = d.layer === 2 && d.ticker ? "Rank " + d.pos + ", " + d.ticker + (d.sec ? ", " + d.sec : "") : d.label + (d.members && d.members.length ? " (" + d.members.slice(0, 8).join(", ") + (d.members.length > 8 ? ", and more" : "") + ")" : "");
      const ct = contracts(d);
      return what + ": " + money(d.v) + ", " + pct(d.share) + " of flagged premium, " + count(d.windows) + " " + plural(d.windows, "window", "windows") + (ct ? ", " + ct : "") + "." + lean + (d.ticker ? " Opens the " + d.ticker + " page." : "");
    }

    function buildHits() {
      const keep = new Map();
      for (const el of hits.children) keep.set(el.dataset.id, el);
      const next = [];
      for (const n of N.values()) {
        const d = n.d;
        let el = keep.get(n.id);
        const tag = d.ticker ? "A" : "BUTTON";
        if (!el || el.tagName !== tag) {
          el = d.ticker
            ? h("a", { class: "fn-hit", href: "/flows/ticker/?t=" + encodeURIComponent(d.ticker), "data-id": n.id, draggable: "false" })
            : h("button", { class: "fn-hit", type: "button", "aria-pressed": "false", "data-id": n.id });
          const id = n.id;
          el.addEventListener("pointerenter", () => { if (!DRAG.on) { hoverId = id; relight(); } });
          el.addEventListener("pointerleave", () => { if (hoverId === id) { hoverId = null; relight(); } });
          el.addEventListener("focus", () => { focusId = id; rove = id; relight(); });
          el.addEventListener("blur", () => { if (focusId === id) { focusId = null; relight(); } });
          el.addEventListener("keydown", (e) => keyNav(e, id));
          if (!d.ticker) el.addEventListener("click", () => { pinId = pinId === id ? null : id; relight(); });
        }
        el.setAttribute("aria-label", hitLabel(d));
        next.push(el);
      }
      if (!rove || !N.has(rove)) {
        const firstName = [...N.values()].find((n) => n.d.layer === 2);
        rove = firstName ? firstName.id : null;
      }
      for (const el of next) el.tabIndex = el.dataset.id === rove ? 0 : -1;
      const same = next.length === hits.children.length && next.every((el, i) => hits.children[i] === el);
      if (!same) {
        const af = document.activeElement;
        hits.replaceChildren(...next);
        if (af && next.indexOf(af) >= 0) af.focus({ preventScroll: true });
      }
      placeHits(true);
    }

    function keyNav(e, id) {
      const n = N.get(id);
      if (!n) return;
      const layer = M.layers[n.d.layer];
      const at = layer.findIndex((d) => d.id === id);
      let to = null;
      const [prev, next, back, fwd] = VERT ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] : ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      const cross = (x) => (VERT ? x.sx : x.sy);
      if (e.key === next) to = layer[Math.min(layer.length - 1, at + 1)];
      else if (e.key === prev) to = layer[Math.max(0, at - 1)];
      else if (e.key === "Home") to = layer[0];
      else if (e.key === "End") to = layer[layer.length - 1];
      else if (e.key === fwd || e.key === back) {
        const L = M.layers[n.d.layer + (e.key === fwd ? 1 : -1)];
        if (L && L.length) to = L.reduce((best, d) => (Math.abs(cross(N.get(d.id)) - cross(n)) < Math.abs(cross(N.get(best.id)) - cross(n)) ? d : best), L[0]);
      } else if (e.key === "Escape") { if (pinId) { pinId = null; relight(); e.preventDefault(); } return; }
      else if (e.key === "r" || e.key === "R" || e.key === "0") { if (!e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); recentre(); } return; }
      else return;
      e.preventDefault();
      if (!to || to.id === id) return;
      rove = to.id;
      for (const el of hits.children) el.tabIndex = el.dataset.id === rove ? 0 : -1;
      const el = [...hits.children].find((x) => x.dataset.id === rove);
      if (el) el.focus();
    }


    function placeHits(force) {
      const now = performance.now();
      if (!force && now - hitAt < 180) return;
      hitAt = now;
      for (const el of hits.children) {
        const n = N.get(el.dataset.id);
        if (!n) continue;
        const d = Math.max(VERT ? 30 : 26, n.R * 2 + 10);
        el.style.setProperty("--d", d.toFixed(1) + "px");
        el.style.transform = "translate(" + (n.px - d / 2).toFixed(1) + "px," + (n.py - d / 2).toFixed(1) + "px)";
      }
    }

    function relight() {
      const id = focusId || hoverId || pinId;
      let pred = null;
      if (id && N.has(id)) pred = (p) => p.ids.indexOf(id) >= 0;
      else if (rowLit) pred = (p) => p.ids[0] === "i:" + rowLit.k && (p.ids[2] === "n:" + rowLit.t || (p.ids[2] === "n:~" && N.get("n:~") && N.get("n:~").d.members.indexOf(rowLit.t) >= 0));
      FOC = !!pred;
      for (const n of NL) n.tl = pred ? 0 : 1;
      for (const e of E) e.tl = pred ? 0 : 1;
      if (pred) for (const p of P) {
        if (!pred(p)) continue;
        for (const nid of p.ids) N.get(nid).tl = 1;
        for (const e of p.e) e.tl = 1;
      }
      for (const el of hits.children) if (el.tagName === "BUTTON") el.setAttribute("aria-pressed", String(pinId === el.dataset.id));
      if (table.firstChild) for (const tr of table.querySelectorAll("tbody tr")) tr.classList.toggle("is-lit", !!rowLit && tr.dataset.t === rowLit.t && tr.dataset.k === rowLit.k);
      readout(id && N.has(id) ? id : null);
      showTip(id && N.has(id) ? id : null);
      if (still) paint();
      else kick();
    }

    function readout(id) {
      READ = null;
      if (!id || VERT) return;
      const n = N.get(id), d = n.d;
      let inV = 0, outV = 0;
      for (const e of n.inn) inV += e.v;
      for (const e of n.out) outV += e.v;
      const lt = d.bull + d.bear + d.nx;
      const lean = lt > 0 ? " " + MID + " ▲ " + pct(d.bull / lt) + " ▼ " + pct(d.bear / lt) + " – " + pct(d.nx / lt) : "";
      const rest = MID + " " + money(d.v) + " " + MID + " " + pct(d.share) + " of " + money(M.total) + (inV ? " " + MID + " in " + money(inV) : "") + (outV ? " " + MID + " out " + money(outV) : "") + lean;
      const c = chip([{ lh: 16, runs: [d.pos ? { t: String(d.pos), f: "500 11.5px", c: "rgba(235,235,245,0.5)" } : null, { t: d.label, f: "600 12.5px", c: "rgba(245,245,247,0.97)" }, { t: rest, f: "400 12.5px", c: "rgba(235,235,245,0.7)" }].filter(Boolean) }], { dpr, ff: FF, bg: true, padX: 10, h: 24 });
      if (c.w <= W - 28) READ = c;
    }
    function showTip(id) {
      tipId = id;
      if (!id) { tip.hidden = true; return; }
      const d = N.get(id).d;
      const lean = d.v ? [["up", pct(d.bull / d.v)], ["down", pct(d.bear / d.v)], ["flat", pct(d.nx / d.v)]] : [];
      const ct = contracts(d);
      tip.replaceChildren(...[
        h("b", null, (d.pos ? d.pos + " " + MID + " " : "") + (d.ticker || d.label)),
        h("span", null, (d.ticker ? (d.sec || "No sector") + " " + MID + " " : d.full && d.full !== d.label ? d.full + " " + MID + " " : "") + count(d.windows) + " " + plural(d.windows, "window", "windows")),
        h("span", { class: "fn-tip-v" }, h("strong", null, money(d.v)), " " + pct(d.share) + " of flagged premium"),
        ct ? h("span", { class: "fn-tip-c" }, ct) : null,
        d.members && d.members.length ? h("span", null, d.members.slice(0, 6).join(", ") + (d.members.length > 6 ? " and " + (d.members.length - 6) + " more" : "")) : null,
        lean.length ? h("span", { class: "fn-tip-l" }, lean.map(([g, v]) => h("i", { "data-g": g }, UI.glyph(g), v))) : null,
        d.ticker ? h("span", { class: "fn-tip-go" }, "Open " + d.ticker + " →") : null].filter(Boolean));
      tip.hidden = false;
      placeTip();
    }

    const TB = [0, 0, 0, 0], TQ = [0, 0, 0, 0];
    const area = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    function tipCost() {
      let k = 0;
      for (const m of NL) {
        if (!m.tl && m.id !== tipId) continue;
        TQ[0] = m.px - m.R; TQ[1] = m.py - m.R; TQ[2] = TQ[3] = m.R * 2;
        k += area(TB, m.lb) + area(TB, TQ);
      }
      for (const hd of HD) { TQ[0] = hd.x; TQ[1] = hd.y; TQ[2] = hd.w; TQ[3] = hd.h; k += area(TB, TQ); }
      return k;
    }
    function placeTip() {
      if (!tipId || tip.hidden) return;
      const n = N.get(tipId);
      if (!n) return;
      const tw = tip.offsetWidth, th = tip.offsetHeight, r = n.R, lb = n.lb;
      const rx = Math.max(n.px + r, lb[0] > n.px ? lb[0] + lb[2] : 0) + 8, lx = Math.min(n.px - r, lb[0] < n.px ? lb[0] : 1e9) - 8 - tw;
      const top = Math.min(n.py - r, lb[1]) - 8 - th, bot = Math.max(n.py + r, lb[1] + lb[3]) + 8;
      let bx = 0, by = 0, bk = 1e18;
      for (let c = 0; c < 4 && bk > 0; c++) {
        TB[0] = clamp(c === 0 ? rx : c === 1 ? lx : n.px - tw / 2, 6, Math.max(6, W - tw - 6));
        TB[1] = clamp(c === 2 ? top : c === 3 ? bot : n.py - th / 2, 6, Math.max(6, H - th - 6));
        TB[2] = tw; TB[3] = th;
        const k = tipCost();
        if (k < bk) { bk = k; bx = TB[0]; by = TB[1]; }
      }
      tip.style.transform = "translate(" + bx.toFixed(0) + "px," + by.toFixed(0) + "px)";
    }

    const over = (a, b) => a[0] < b[0] + b[2] - 0.5 && b[0] < a[0] + a[2] - 0.5 && a[1] < b[1] + b[3] - 0.5 && b[1] < a[1] + a[3] - 0.5;
    const SB = [0, 0, 0, 0], HB = [0, 0, 0, 0];
    function clash() {
      for (let i = 0; i < NL.length; i++) {
        const a = NL[i], lb = a.lb;
        if (a.px - a.R < 0 || a.px + a.R > W || a.py - a.R < 0 || a.py + a.R > H) return true;
        if (lb[0] < 0 || lb[1] < 0 || lb[0] + lb[2] > W || lb[1] + lb[3] > H) return true;
        for (let j = i + 1; j < NL.length; j++) {
          const b = NL[j];
          if (over(lb, b.lb) || Math.hypot(a.px - b.px, a.py - b.py) < a.R + b.R) return true;
        }
        for (const b of NL) {
          SB[0] = b.px - b.R; SB[1] = b.py - b.R; SB[2] = SB[3] = b.R * 2;
          if (over(lb, SB)) return true;
        }
        for (const hd of HD) {
          HB[0] = hd.x; HB[1] = hd.y; HB[2] = hd.w; HB[3] = hd.h;
          if (over(lb, HB)) return true;
        }
      }
      for (const hd of HD) if (hd.x < 0 || hd.x + hd.w > W || hd.y < 0 || hd.y + hd.h > H) return true;
      for (let i = 1; i < HD.length; i++) if (HD[i].x < HD[i - 1].x + HD[i - 1].w + 4 && !VERT) return true;
      return false;
    }
    function fits(y, p) {
      brMax = true;
      setCam(y, p);
      pose(true);
      brMax = false;
      return !clash();
    }
    function settle() {
      cam.sw = 0;
      if (!M || !NL.length) return;
      const sv = NL.map((n) => [n.gx, n.gy, n.cr]), y0 = cam.yaw, p0 = cam.pitch, [ry, rp] = REST;
      for (const n of NL) { n.gx = n.sx; n.gy = n.sy; n.cr = n.r; }
      const sway = (a) => { for (let i = 0; i < 16; i++) if (!fits(ry + a * DEG * Math.sin(i * TAU / 16), rp)) return false; return true; };
      for (const a of [8, 4]) if (sway(a)) { cam.sw = a * DEG; break; }
      let t = 1;
      if (!fits(y0, p0) && fits(ry, rp)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (fits(ry + (y0 - ry) * m, rp + (p0 - rp) * m)) lo = m; else hi = m; }
        t = lo;
      }
      NL.forEach((n, i) => { [n.gx, n.gy, n.cr] = sv[i]; });
      setCam(ry + (y0 - ry) * t, rp + (p0 - rp) * t);
      pose(false);
    }

    const YAWMAX = () => (VERT ? 30 : 55) * DEG, PMAX = 22 * DEG;
    function turn(yaw, pitch) {
      let y = clamp(yaw, -YAWMAX(), YAWMAX()), p = clamp(pitch, -PMAX, PMAX);
      if (y !== yaw) cam.vy = 0;
      if (p !== pitch) cam.vp = 0;
      if (M && NL.length && !fits(y, p)) {
        const own = fits(cam.yaw, cam.pitch), y0 = own ? cam.yaw : REST[0], p0 = own ? cam.pitch : REST[1];
        let lo = 0, hi = 1;
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (fits(y0 + (y - y0) * m, p0 + (p - p0) * m)) lo = m; else hi = m; }
        y = y0 + (y - y0) * lo; p = p0 + (p - p0) * lo;
        cam.vy = cam.vp = 0;
      }
      setCam(y, p);
      pose(false);
    }
    function stepCam(dt, now) {
      if (DRAG.on) { cam.idle = now; return; }
      if (cam.vy || cam.vp) {
        const ey = clamp((YAWMAX() - Math.sign(cam.vy) * cam.yaw - 6 * DEG) / (12 * DEG), 0, 1), ep = clamp((PMAX - Math.sign(cam.vp) * cam.pitch - 2 * DEG) / (6 * DEG), 0, 1);
        turn(cam.yaw + cam.vy * ey * dt, cam.pitch + cam.vp * ep * dt);
        const k = Math.exp(-dt * 6);
        cam.vy *= k;
        cam.vp *= k;
        if (Math.abs(cam.vy) < 0.5 * DEG && Math.abs(cam.vp) < 0.5 * DEG) cam.vy = cam.vp = 0;
        cam.idle = now;
      } else if (cam.user && now - cam.idle > 4500) cam.user = false;
      if (cam.user || (cam.hold && !cam.home)) return;
      const k = Math.min(1, dt * (cam.home ? 4.5 : 0.9)), ty = REST[0] + cam.sw * Math.sin(now / 1000 * TAU / 40);
      setCam(cam.yaw + (ty - cam.yaw) * k, cam.pitch + (REST[1] - cam.pitch) * k);
      if (Math.abs(ty - cam.yaw) < 0.2 * DEG) cam.home = false;
    }
    function recentre() {
      cam.user = false;
      cam.vy = cam.vp = 0;
      cam.home = true;
      if (still) { setCam(REST[0], REST[1]); paint(); } else kick();
    }

    function step(dt, now) {
      stepCam(dt, now);
      T += dt;
      const ease = 1 - Math.exp(-dt * 5.5), grow = Math.min(1, dt * 5), k8 = Math.min(1, dt * 8);
      for (const n of NL) {
        n.gx += (n.sx - n.gx) * ease; n.gy += (n.sy - n.gy) * ease; n.cr += (n.r - n.cr) * grow;
        n.hl += ((FOC && n.tl ? 1 : 0) - n.hl) * k8;
        n.dm += ((FOC && !n.tl ? 1 : 0) - n.dm) * k8;
      }
      for (const e of E) {
        e.hl += ((FOC && e.tl ? 1 : 0) - e.hl) * k8;
        e.dm += ((FOC && !e.tl ? 1 : 0) - e.dm) * k8;
        e.fl = 0;
      }
      for (let i = FLR.length - 1; i >= 0; i--) {
        const f = FLR[i], a = T - f.t0;
        if (a > 1.5) { FLR.splice(i, 1); continue; }
        f.lit = a < 0 ? 0 : a < 0.2 ? a / 0.2 : a > 1 ? (1.5 - a) / 0.5 : 1;
        for (const e of f.edges) if (e && f.lit > e.fl) e.fl = f.lit;
      }
    }

    function paint() {
      if (still || !raf) {
        for (const n of NL) { n.hl = FOC && n.tl ? 1 : 0; n.dm = FOC && !n.tl ? 1 : 0; if (still) { n.gx = n.sx; n.gy = n.sy; n.cr = n.r; } }
        for (const e of E) { e.hl = FOC && e.tl ? 1 : 0; e.dm = FOC && !e.tl ? 1 : 0; e.fl = 0; }
      }
      draw();
      placeHits(true);
      placeTip();
    }

    const running = () => !still && inView && !document.hidden && (M || false);
    function frame(now) {
      raf = 0;
      if (!running()) return;
      const t0 = performance.now();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
      last = now;
      const y0 = cam.yaw, p0 = cam.pitch;
      step(dt, now);
      draw();
      placeHits(cam.user || cam.home || Math.abs(cam.yaw - y0) + Math.abs(cam.pitch - p0) > 0.004);
      placeTip();
      const ms = performance.now() - t0;
      stats.frames++;
      stats.ms += ms;
      stats.last = ms;
      stats.max = Math.max(stats.max, ms);
      stats.ring.push(ms);
      if (stats.ring.length > 240) stats.ring.shift();
      raf = requestAnimationFrame(frame);
    }
    function kick() {
      if (dead) return;
      if (raf || !running()) { if (!running()) paint(); return; }
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    function halt() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    function setMode(m) {
      if (m === mode) return;
      mode = m;
      rebuild();
    }

    const keyOf = (r) => [r.t, r.oc || "", r.spanStart || "", r.rule || ""].join("\u0000");

    function take(alerts, st) {
      const ok = !!(alerts && Array.isArray(alerts.rows));
      S.st = st || (ok ? { state: "ok" } : { state: "pending", reason: "Reading the flagged windows." });
      S.rows = ok ? alerts.rows : [];
      S.session = ok && isDay(alerts.sessionDate) ? alerts.sessionDate : null;
      let read = ok && typeof alerts.readAt === "string" ? alerts.readAt : null;
      for (const r of S.rows) if (r && typeof r.lastAt === "string" && (!read || r.lastAt > read)) read = r.lastAt;
      S.readAt = read;
      const keys = new Set(S.rows.map(keyOf));
      const fresh = S.keys ? S.rows.filter((r) => !S.keys.has(keyOf(r))) : [];
      if (ok) S.keys = keys;
      rebuild();
      paintPill();
      if (fresh.length && !still) {
        const seen = new Map();
        let shot = 0;
        for (const r of fresh) {
          const t = String(r.t || "").toUpperCase(), nid = N.has("n:" + t) ? "n:" + t : "n:~";
          for (const q of model([r], { out: mode, session: S.session }).paths) {
            const p = P.find((x) => x.ids[0] === q.ids[0] && x.ids[2] === nid && x.ids[3] === q.ids[3]), n = N.get(nid);
            if (!p || !n) continue;
            let f = seen.get(nid);
            if (!f) {
              if (FLR.length >= 8) continue;
              f = { n, edges: [], t0: T + 0.12 * shot++, lit: 0 };
              seen.set(nid, f);
              FLR.push(f);
            }
            f.edges.push(...p.e);
          }
        }
        kick();
      }
    }

    function loadUniverse() {
      fetch("/api/flows/universe", { credentials: "same-origin", headers: { Accept: "application/json" }, signal: abort ? abort.signal : undefined })
        .then((res) => (res.ok ? res.json() : null))
        .then((u) => {
          if (dead) return;
          if (u && u.status === "ok" && Array.isArray(u.t) && Array.isArray(u.sec) && Array.isArray(u.sectors)) {
            U.map = new Map(u.t.map((t, i) => [String(t).toUpperCase(), Number.isInteger(u.sec[i]) ? u.sectors[u.sec[i]] || null : null]));
            U.state = "ok";
          } else {
            U.map = new Map();
            U.state = "fail";
          }
        }, () => { if (!dead) { U.map = new Map(); U.state = "fail"; } })
        .then(() => { if (!dead && S.rows.length) rebuild(); });
    }

    function orbit(dx, dy) {
      cam.user = true;
      cam.home = false;
      cam.idle = performance.now();
      turn(cam.yaw + dx * 0.32 * DEG, cam.pitch + dy * 0.22 * DEG);
      if (still || !running()) paint(); else kick();
    }
    const done = (e) => {
      if (DRAG.id !== e.pointerId) return;
      DRAG.id = null;
      if (DRAG.on) {
        DRAG.on = false;
        DRAG.eat = e.timeStamp;
        stage.classList.remove("is-drag");
        const k = Math.exp(-Math.max(0, e.timeStamp - DRAG.t) / 150);
        if (!still && e.type === "pointerup") { cam.vy = clamp(DRAG.vx * k, -1.4, 1.4); cam.vp = clamp(DRAG.vy * k, -0.6, 0.6); }
        cam.idle = performance.now();
        kick();
      } else if (e.type === "pointerup" && e.pointerType === "touch") {
        if (e.timeStamp - DRAG.tap < 320 && Math.hypot(e.clientX - DRAG.tx, e.clientY - DRAG.ty) < 30) { DRAG.tap = 0; recentre(); }
        else { DRAG.tap = e.timeStamp; DRAG.tx = e.clientX; DRAG.ty = e.clientY; }
      }
    };
    stage.addEventListener("pointerdown", (e) => {
      DRAG.eat = 0;
      if (!M || e.button || e.target === home) return;
      DRAG.id = e.pointerId; DRAG.on = false;
      DRAG.x = e.clientX; DRAG.y = e.clientY; DRAG.t = e.timeStamp; DRAG.vx = DRAG.vy = 0;
      cam.vy = cam.vp = 0;
    });
    stage.addEventListener("pointermove", (e) => {
      if (DRAG.id !== e.pointerId) return;
      const dx = e.clientX - DRAG.x, dy = e.clientY - DRAG.y;
      if (!DRAG.on) {
        if (Math.abs(dx) + Math.abs(dy) < 6) return;
        if (e.pointerType === "touch" && Math.abs(dy) > Math.abs(dx)) { DRAG.id = null; return; }
        DRAG.on = true;
        try { stage.setPointerCapture(e.pointerId); } catch (_) { }
        stage.classList.add("is-drag");
        if (hoverId) { hoverId = null; relight(); }
      }
      const dt = Math.max(1, e.timeStamp - DRAG.t) / 1000, ky = dx * 0.32 * DEG / dt, kp = dy * 0.22 * DEG / dt;
      DRAG.vx = DRAG.vx * 0.4 + ky * 0.6;
      DRAG.vy = DRAG.vy * 0.4 + kp * 0.6;
      DRAG.x = e.clientX; DRAG.y = e.clientY; DRAG.t = e.timeStamp;
      orbit(dx, dy);
    });
    stage.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") cam.hold = true; });
    stage.addEventListener("pointerleave", () => { cam.hold = false; });
    stage.addEventListener("pointerup", done);
    stage.addEventListener("pointercancel", done);
    stage.addEventListener("lostpointercapture", done);
    stage.addEventListener("click", (e) => { const t = DRAG.eat; DRAG.eat = 0; if (t && e.timeStamp - t < 300) { e.preventDefault(); e.stopPropagation(); } }, true);
    stage.addEventListener("dragstart", (e) => e.preventDefault());
    stage.addEventListener("dblclick", (e) => { if (e.target !== home) recentre(); });
    home.addEventListener("click", recentre);
    home.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") recentre(); });
    freeze.addEventListener("click", () => {
      frozen = !frozen;
      still = RM.matches || frozen;
      freeze.setAttribute("aria-pressed", String(frozen));
      freeze.firstChild.textContent = frozen ? "Resume" : "Freeze";
      FLR.length = 0;
      halt();
      paintLegend();
      if (still) paint(); else kick();
    });
    if (window.IntersectionObserver) {
      const io = new IntersectionObserver((list) => {
        inView = list[list.length - 1].isIntersecting;
        if (inView) kick(); else halt();
      });
      io.observe(stage);
      undo.push(() => io.disconnect());
    }
    on(document, "visibilitychange", () => { if (document.hidden) halt(); else kick(); });
    const onMotion = () => { still = RM.matches || frozen; halt(); paintLegend(); rebuild(); };
    if (RM.addEventListener) on(RM, "change", onMotion);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(rz);
        rz = requestAnimationFrame(() => { if (!dead && Math.abs((stage.clientWidth || 0) - W) > 1) rebuild(); });
      });
      ro.observe(host);
      undo.push(() => ro.disconnect());
    }

    function destroy() {
      if (dead) return;
      dead = true;
      halt();
      cancelAnimationFrame(rz);
      if (abort) abort.abort();
      for (const f of undo.splice(0)) f();
      pill.remove(); seg.remove(); about.remove();
      host.replaceChildren();
      NETS.delete(host);
    }

    paintLegend();
    size();
    rebuild();
    if (opts.universe !== false) loadUniverse(); else { U.map = new Map(); U.state = "fail"; }

    const snapshot = (o) => {
      const keep = [cam.yaw, cam.pitch, T];
      if (o) { setCam((o.yaw === undefined ? cam.yaw / DEG : o.yaw) * DEG, (o.pitch === undefined ? cam.pitch / DEG : o.pitch) * DEG); if (o.t !== undefined) T = o.t; }
      pose(false);
      const out = {
        w: W, h: H, vert: VERT, midY: G.midY, midC: VERT ? G.ox : G.midY, rest: Math.abs(cam.yaw) < 1e-9 && Math.abs(cam.pitch - REST[1]) < 1e-9, scale: scaleOf(),
        cols: G.cols.map((c, i) => { const L = LN[i]; return { key: i, x: VERT ? L.reduce((a, n) => a + n.py, 0) / L.length : c.x, side: c.side }; }),
        nodes: NL.map((n) => ({ key: n.id, col: n.layer, v: n.d.v, out: n.layer < 3, residual: !!n.d.resid })),
        spheres: NL.map((n) => ({ key: n.id, col: n.layer, cx: n.px, cy: n.py, r: n.R, residual: !!n.d.resid })),
        labels: NL.map((n) => ({ key: n.id, col: n.layer, x: n.lb[0], y: n.lb[1], w: n.lb[2], h: n.lb[3] })),
        heads: HD.map((hd) => ({ text: hd.text, x: hd.x, y: hd.y, w: hd.w, h: hd.h })),
        bands: E.map((e) => ({ from: e.a.id, to: e.b.id, v: e.v, w0: e.w0, ws: e.ws, slice: e.a1 - e.a0, drawn: 2 * e.ha, into: e.b1 - e.b0, f: e.a.f })),
      };
      setCam(keep[0], keep[1]);
      T = keep[2];
      pose(false);
      return out;
    };
    const scaleOf = () => ({ k: G.k, vMax: G.vMax, bandPerM: G.bpd * 1e6, bandMax: BAND_MAX * G.k, bandMin: BAND_MIN, minR: 9 * G.k, form: G.form, vert: VERT });

    const api = {
      take,
      sectors: (map) => { U.map = map instanceof Map ? map : new Map(Object.entries(map || {})); U.state = "ok"; if (S.rows.length) rebuild(); },
      mode: (m) => { if (m === "dte" || m === "lean") { seg.pick(m === "dte" ? 1 : 0); setMode(m); } return mode; },
      model: () => M,
      stats: () => ({
        frames: stats.frames, ms: stats.ms, last: stats.last, max: stats.max, running: !!raf, still, frozen,
        median: stats.ring.length ? stats.ring.slice().sort((a, b) => a - b)[stats.ring.length >> 1] : null,
        pulses: still || !M ? 0 : PN, hot: FLR.length, flowEdges: E.length, meshEdges: 0, edges: E.length,
        layers: M ? M.layers.map((l) => l.length) : [], w: W, h: H, vert: VERT,
      }),
      reset: () => { stats.frames = 0; stats.ms = 0; stats.max = 0; stats.ring = []; },
      measure: (n, flush) => {
        const times = [];
        let t = performance.now();
        for (let i = 0; i < (n || 120); i++) {
          const t0 = performance.now();
          t += 1000 / 60;
          step(1 / 60, t);
          draw();
          if (flush) ctx.getImageData(0, 0, 1, 1);
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        return { median: times[times.length >> 1], p90: times[Math.floor(times.length * 0.9)], mean: times.reduce((a, b) => a + b, 0) / times.length, pulses: still ? 0 : PN, edges: E.length };
      },
      camera: () => ({ yaw: cam.yaw / DEG, pitch: cam.pitch / DEG, rest: REST.map((x) => x / DEG), limits: [VERT ? 30 : 55, 22], sway: cam.sw / DEG, period: 40, auto: !cam.user, spin: Math.hypot(cam.vy, cam.vp) / DEG, zoom: 1 }),
      orbit: (yaw, pitch) => { cam.vy = cam.vp = 0; orbit((yaw * DEG - cam.yaw) / (0.32 * DEG), (pitch * DEG - cam.pitch) / (0.22 * DEG)); paint(); return api.camera(); },
      recentre,
      freeze: (on) => { if (frozen !== !!on) freeze.click(); return frozen; },
      paints: () => { TRACE = []; draw(); const o = TRACE; TRACE = null; return o; },
      labels: () => NL.map((n) => ({ id: n.id, x: n.lb[0], y: n.lb[1], w: n.lb[2], h: n.lb[3], form: G.form })).concat(HD.map((hd, i) => ({ id: "cap:" + i, x: hd.x, y: hd.y, w: hd.w, h: hd.h }))),
      fits: (yaw, pitch) => { const y = cam.yaw, p = cam.pitch, f = fits(yaw * DEG, pitch * DEG); setCam(y, p); pose(false); return f; },
      node: (id) => { const n = N.get(id); return n ? { x: n.px, y: n.py, r: n.R, z: n.pz, lit: n.tl, label: n.d.label, v: n.d.v, sx: n.sx, sy: n.sy, layer: n.layer } : null; },
      scene: snapshot,
      scale: scaleOf,
      legend: () => [...scale.querySelectorAll(".fn-lg-i")].map((el) => ({ v: +el.dataset.v, r: el.dataset.r ? +el.dataset.r : null, w: el.dataset.w ? +el.dataset.w : null })),
      destroy,
    };
    NETS.set(host, api);
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, UI, {
    net: Object.freeze({ model, mount, of: (el) => NETS.get(el) || null }),
  }));
})();
