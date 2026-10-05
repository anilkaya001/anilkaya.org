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
  const rgba = (c, a) => "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ")";
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const WHITE = [255, 255, 255], INK = [5, 7, 13];

  function canvas(size) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    return [cv, cv.getContext("2d"), size / 2];
  }
  function sprite(c, size, core) {
    const [cv, g, r] = canvas(size);
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, rgba(core || c, 1));
    gr.addColorStop(0.16, rgba(c, 0.62));
    gr.addColorStop(0.42, rgba(c, 0.18));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return cv;
  }
  function sphere(c) {
    const [cv, g, m] = canvas(96), r = m - 1;
    let gr = g.createRadialGradient(m * 0.7, m * 0.6, 1, m, m, r);
    gr.addColorStop(0, rgba(mix(c, WHITE, 0.5), 1));
    gr.addColorStop(0.32, rgba(mix(c, INK, 0.3), 1));
    gr.addColorStop(0.82, rgba(mix(c, INK, 0.78), 1));
    gr.addColorStop(1, rgba(mix(c, INK, 0.92), 1));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(m, m, r, 0, TAU);
    g.fill();
    g.strokeStyle = rgba(c, 0.95);
    g.lineWidth = 3.4;
    g.beginPath();
    g.arc(m, m, r - 1.8, 0, TAU);
    g.stroke();
    gr = g.createRadialGradient(m * 0.68, m * 0.56, 0, m * 0.68, m * 0.56, m * 0.34);
    gr.addColorStop(0, "rgba(255,255,255,0.85)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 96, 96);
    return cv;
  }

  function mount(host, opts = {}) {
    if (!host) return null;
    if (NETS.has(host)) return NETS.get(host);
    const cfg = { names: num(opts.names), rate: num(opts.rate), cap: num(opts.cap) || 280 };
    const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
    let still = RM.matches;

    const cv = h("canvas", { class: "fn-cv", role: "img", "aria-label": "Flow network: reading the flagged windows." });
    const hits = h("div", { class: "fn-hits", role: "group", "aria-label": "Network nodes; arrow keys move between them, R recentres the view" });
    const tip = h("div", { class: "fn-tip", "aria-hidden": "true", hidden: true });
    const empty = h("div", { class: "fn-empty", hidden: true });
    const home = h("button", { class: "fn-home", type: "button", "aria-label": "Recentre the view", title: "Recentre the view (R)", hidden: true }, UI.glyph("home"));
    const stage = h("div", { class: "fn-stage" }, cv, hits, tip, empty, home);
    const lede = h("p", { class: "fn-lede" });
    const legend = h("div", { class: "ui-legend fn-legend" });
    const table = h("div", { class: "fn-paths" });
    host.replaceChildren(lede, stage, legend, table);
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
    let M = null, W = 0, H = 0, dpr = 1, compact = false;
    const secFn = () => (U.state === "ok" ? (t) => (U.map.has(t) ? U.map.get(t) : null) : () => undefined);
    const N = new Map();
    let E = [], MESH = [], P = [], CUM = [], CAPS = [], NL = [], GH = [], LN = [[], [], [], []], LT = [], ITEMS = [], DUST = [];
    const pulses = [];
    let pn = 0, acc = 0, raf = 0, last = 0, inView = true, focusAmt = 0, focusTarget = 0;
    let hoverId = null, focusId = null, pinId = null, rowLit = null, rove = null, hitAt = 0, tipId = null, TRACE = null;
    const REST = [-15 * DEG, 13 * DEG];
    const cam = { yaw: REST[0], pitch: REST[1], vy: 0, vp: 0, user: false, home: false, hold: false, idle: 0, cy: 1, sy: 0, cp: 1, sp: 0, z: 1, ox: 0, oy: 0, zr: 1, lo: 0, hi: 1, sw: 9 * DEG };
    const G = { HU: 300, HV: 200, ARC: 60, ZC: 0, D: 1600, YF: 260, lw0: 0, lw3: 0, lw: 0, pt: 38, pb: 24, planes: [], tier: [0, 0, 0, 0] };
    const DRAG = { id: null, on: false, x: 0, y: 0, t: 0, vx: 0, vy: 0, eat: 0, tap: 0, tx: 0, ty: 0 };
    const stats = { frames: 0, ms: 0, last: 0, max: 0, ring: [] };
    const NB = 4, BIN = [], BN = new Int32Array(NB), BM = new Int32Array(NB), BZ = new Float64Array(NB);
    let COL = null, SPR = null, PCOL = null, SPH = new Map();

    function colors() {
      const c = (t) => toRgb(UI.cssVar(t));
      COL = { up: c("--up"), down: c("--down"), acc: c("--accent-ink"), soft: c("--accent-soft") };
      SPR = { 0: sprite(COL.up, 64), 1: sprite(COL.down, 64), 2: sprite(COL.acc, 64), hot: sprite(COL.soft, 64, WHITE), core: sprite(COL.acc, 256), shadow: sprite(INK, 64) };
      PCOL = [mix(COL.up, WHITE, 0.25), mix(COL.down, WHITE, 0.2), mix(COL.acc, WHITE, 0.3), [150, 170, 210]].map((x) => rgba(x, 1));
      SPH = new Map();
    }
    const leanCol = (bull, bear, nx) => {
      const t = bull + bear + nx;
      if (!t) return COL.acc;
      const l = (bull - bear) / t;
      return l >= 0 ? mix(COL.acc, COL.up, Math.min(1, l * 1.25)) : mix(COL.acc, COL.down, Math.min(1, -l * 1.25));
    };
    const nodeCol = (d) => (d.layer === 1 ? toRgb(UI.cssVar(d.tok || "--sect-none")) : d.layer === 3 && d.bucket ? COL.soft : leanCol(d.bull, d.bear, d.nx));

    let FF = "system-ui, sans-serif", MEAS = null, VERT = false;
    function label(lines, glyph, col, align, chip) {
      const pl = chip || 3, pr = chip ? 5 : 3, pv = chip ? 4 : 3, g = glyph ? 13 : 0;
      const m = MEAS || (MEAS = document.createElement("canvas").getContext("2d"));
      let w = 0, hh = pv * 2;
      lines.forEach((l, i) => {
        l.w = i === 0 ? g : 0;
        l.r.forEach((r, k) => { m.font = r[1] + " " + FF; m.letterSpacing = r[3] || "0px"; r.w = m.measureText(r[0]).width; l.w += r.w + (k ? 5 : 0); });
        w = Math.max(w, l.w);
        hh += l.lh;
      });
      const cw = Math.ceil(w + pl + pr), ch = Math.ceil(hh);
      const c = document.createElement("canvas");
      c.width = cw * dpr;
      c.height = ch * dpr;
      const x = c.getContext("2d");
      x.scale(dpr, dpr);
      x.lineJoin = "round";
      x.textBaseline = "middle";
      let y = pv;
      lines.forEach((l, i) => {
        let tx = pl + (align === "end" ? w - l.w : align === "center" ? (w - l.w) / 2 : 0);
        const my = y + l.lh / 2;
        if (i === 0 && glyph) {
          const gx = tx + 4.5;
          x.fillStyle = rgba(col, 1);
          x.beginPath();
          if (glyph === "up") { x.moveTo(gx, my - 4); x.lineTo(gx + 4.6, my + 3.6); x.lineTo(gx - 4.6, my + 3.6); }
          else if (glyph === "down") { x.moveTo(gx, my + 4); x.lineTo(gx + 4.6, my - 3.6); x.lineTo(gx - 4.6, my - 3.6); }
          else x.rect(gx - 4.5, my - 1.6, 9, 3.2);
          x.fill();
          tx += g;
        }
        l.r.forEach((r) => {
          x.font = r[1] + " " + FF;
          x.letterSpacing = r[3] || "0px";
          if (!chip) {
            x.strokeStyle = "rgba(6,8,13,0.88)";
            x.lineWidth = 3.6;
            x.strokeText(r[0], tx, my);
          }
          x.fillStyle = r[2];
          x.fillText(r[0], tx, my);
          tx += r.w + 5;
        });
        y += l.lh;
      });
      return { c, w: cw, h: ch, chip: !!chip };
    }

    function nodeLabel(n, form) {
      const d = n.d, big = d.layer === 2 && d.ticker;
      const W1 = "rgba(245,245,247,0.97)", W2 = "rgba(235,235,245,0.62)";
      const sub = d.layer === 3 ? pct(d.share) + (compact ? "" : " " + MID + " " + money(d.v)) : money(d.v);
      const glyph = d.layer === 3 && d.lean ? LEAN_GLYPH[d.lean] : null;
      const rank = d.pos ? [String(d.pos), VERT ? "600 9.5px" : "600 11px", W2] : null;
      if (VERT) {
        const t = d.id === "n:~" ? "+" + d.members.length + " more" : d.label;
        return label([{ r: [rank, [t, big ? "650 10.5px" : "600 10px", W1]].filter(Boolean), lh: 12 }, { r: [[sub, "500 9.5px", W2]], lh: 11 }], glyph, n.col, "center", 4);
      }
      if (d.layer === 1 || d.layer === 2) {
        const head = [rank, [d.label, big ? "650 13px" : "600 12px", W1]].filter(Boolean), val = [sub, "500 11px", W2], lp = rank ? 8 : 5;
        if (form === 1) return label([{ r: head, lh: 15 }, { r: [val], lh: 13 }], null, n.col, "start", lp);
        return label([{ r: form ? head : head.concat([val]), lh: 16 }], null, n.col, "start", lp);
      }
      return label([{ r: [[d.label, "600 12.5px", W1]], lh: 16 }, { r: [[sub, "500 11px", W2]], lh: 14 }], glyph, n.col, d.layer === 0 ? "end" : "start");
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
          "Line width is premium. Light runs along each path in proportion to its premium: a picture of the record, not a feed of executions. A flare marks a window that reached this page while it was open.",
          "Sectors come from the nightly universe; a name it does not carry is drawn under No sector. Expiry is counted in calendar days from the window's own Eastern date.",
          "Contracts are shown for a name, a sector or an expiry only when every window in it states its size; a side or a lean shows none, because the vendor splits premium by side, not contracts.",
          "Only the largest names and sectors get their own node; the rest are folded into Other, so every layer still sums to the same premium. Drag to turn the network; double click or R recentres it.",
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
    if (fx && window.MutationObserver) new MutationObserver(paintPill).observe(fx, { attributes: true, attributeFilter: ["data-state", "data-label"] });
    paintPill();

    function paintLegend() {
      const k = (g, cls, text) => h("span", { class: "ui-key fn-k " + cls }, UI.glyph(g), text);
      legend.replaceChildren(
        k("up", "is-up", "Bullish lean: calls at ask, puts at bid"),
        k("down", "is-down", "Bearish lean: calls at bid, puts at ask"),
        k("flat", "is-nx", "Unattributed"),
        h("span", { class: "ui-key fn-k is-note" }, "Width and light: premium" + (still ? "" : "; a flare: a window that arrived while you watched") + ". Drag to turn; " + (matchMedia("(pointer: coarse)").matches ? "double tap" : "double click") + " to recentre"));
    }
    paintLegend();

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

    let tableSig = "";
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
      const cross = (x) => (VERT ? x.tx : x.ty);
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
        const d = Math.max(compact ? 30 : 26, n.cr * n.ps * 2 + 10);
        el.style.setProperty("--d", d.toFixed(1) + "px");
        el.style.transform = "translate(" + (n.px - d / 2).toFixed(1) + "px," + (n.py - d / 2).toFixed(1) + "px)";
      }
    }

    function relight() {
      const id = focusId || hoverId || pinId;
      let pred = null;
      if (id && N.has(id)) pred = (p) => p.ids.indexOf(id) >= 0;
      else if (rowLit) pred = (p) => p.ids[0] === "i:" + rowLit.k && (p.ids[2] === "n:" + rowLit.t || (p.ids[2] === "n:~" && N.get("n:~") && N.get("n:~").d.members.indexOf(rowLit.t) >= 0));
      for (const n of N.values()) n.tl = pred ? 0 : 1;
      for (const e of E) { e.tl = pred ? 0 : 1; e.fv = 0; e.fb = 0; e.fr = 0; e.fn = 0; }
      for (const p of P) {
        p.lit = !pred || pred(p);
        if (!pred || !p.lit) continue;
        for (const nid of p.ids) N.get(nid).tl = 1;
        for (const e of p.e) { e.tl = 1; e.fv += p.v; e.fb += p.bull; e.fr += p.bear; e.fn += p.nx; }
      }
      for (const e of E) { e.fcol = e.fv ? leanCol(e.fb, e.fr, e.fn) : e.col; e.fcs = rgba(e.fcol, 1); }
      focusTarget = pred ? 1 : 0;
      for (const el of hits.children) if (el.tagName === "BUTTON") el.setAttribute("aria-pressed", String(pinId === el.dataset.id));
      if (table.firstChild) for (const tr of table.querySelectorAll("tbody tr")) tr.classList.toggle("is-lit", !!rowLit && tr.dataset.t === rowLit.t && tr.dataset.k === rowLit.k);
      showTip(id && N.has(id) ? id : null);
      if (still) paint();
      else kick();
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
        const r = m.cr * m.ps;
        TQ[0] = m.px - r; TQ[1] = m.py - r; TQ[2] = TQ[3] = r * 2;
        k += area(TB, m.lb) + area(TB, TQ);
      }
      for (const o of CS) k += area(TB, o.lb);
      return k;
    }
    function placeTip() {
      if (!tipId || tip.hidden) return;
      const n = N.get(tipId);
      if (!n) return;
      const tw = tip.offsetWidth, th = tip.offsetHeight, r = n.cr * n.ps, lb = n.lb;
      const L = LN[n.d.layer + 1] || [], away = !VERT && n.d.layer === 1 && L.length && L[0].px > n.px;
      const rx = Math.max(n.px + r, lb[0] > n.px ? lb[0] + lb[2] : 0) + 8, lx = Math.min(n.px - r, lb[0] < n.px ? lb[0] : 1e9) - 8 - tw;
      const top = Math.min(n.py - r, lb[1]) - 8 - th, bot = Math.max(n.py + r, lb[1] + lb[3]) + 8;
      let bx = 0, by = 0, bk = 1e18;
      for (let i = 0; i < 4 && bk > 0; i++) {
        const c = away ? [1, 0, 2, 3][i] : i;
        TB[0] = clamp(c === 0 ? rx : c === 1 ? lx : n.px - tw / 2, 6, Math.max(6, W - tw - 6));
        TB[1] = clamp(c === 2 ? top : c === 3 ? bot : n.py - th / 2, 6, Math.max(6, H - th - 6));
        TB[2] = tw; TB[3] = th;
        const k = tipCost();
        if (k < bk) { bk = k; bx = TB[0]; by = TB[1]; }
      }
      tip.style.transform = "translate(" + bx.toFixed(0) + "px," + by.toFixed(0) + "px)";
    }

    function rebuild() {
      compact = (stage.clientWidth || host.clientWidth || 640) < 560;
      M = S.rows.length ? model(S.rows, { out: mode, names: cfg.names || (compact ? clamp(Math.floor((stage.clientWidth || 300) / 44), 5, 9) : 10), session: S.session, sectorOf: secFn(), unread: U.state === "fail" }) : null;
      if (M && !M.windows) M = null;
      const was = new Map(N);
      N.clear();
      E = []; MESH = []; P = []; CUM = [];
      if (SPH.size > 96) SPH = new Map();
      if (M) {
        for (const layer of M.layers) {
          for (const d of layer) {
            const n = was.get(d.id) || { id: d.id, x: 0, y: 0, z: 0, cr: 0, lit: 1, tl: 1, energy: 0, ripple: 0, px: 0, py: 0, ps: 1, pz: 0, qx: 0, qy: 0, qs: 1, fog: 1, born: true, lb: [0, 0, 0, 0], item: { k: 0, o: null, z: 0 } };
            n.d = d;
            n.item.o = n;
            n.col = nodeCol(d);
            n.cs = rgba(n.col, 1);
            if (!SPH.has(n.cs)) SPH.set(n.cs, sphere(n.col));
            n.sph = SPH.get(n.cs);
            const lean = d.layer === 1 || !d.v ? 0 : (d.bull - d.bear) / d.v;
            n.spr = d.layer === 1 ? 2 : lean > 0.2 ? 0 : lean < -0.2 ? 1 : 2;
            N.set(d.id, n);
          }
        }
        const byKey = new Map();
        M.edges.forEach((hop) => hop.forEach((e) => {
          const r = { a: N.get(e.a), b: N.get(e.b), v: e.v, share: e.v / M.total, col: leanCol(e.bull, e.bear, e.nx), lit: 1, tl: 1, fv: 0, fb: 0, fr: 0, fn: 0, fcol: null, item: { k: 1, o: null, z: 0 } };
          r.item.o = r;
          r.fcol = r.col;
          r.cs = r.fcs = rgba(r.col, 1);
          byKey.set(e.a + "|" + e.b, r);
          E.push(r);
        }));
        for (let i = 0; i < 3; i++) for (const a of M.layers[i]) for (const b of M.layers[i + 1]) MESH.push([N.get(a.id), N.get(b.id)]);
        const vmax = M.paths.length ? M.paths[0].v : 1;
        P = M.paths.map((p) => ({
          key: p.key, ids: p.ids, v: p.v, bull: p.bull, bear: p.bear, nx: p.nx, lit: true,
          e: [0, 1, 2].map((k) => byKey.get(p.ids[k] + "|" + p.ids[k + 1])),
          c: p.lean === "bull" ? 0 : p.lean === "bear" ? 1 : 2,
          size: 0.55 + 0.45 * Math.sqrt(p.v / vmax),
        }));
        let sum = 0;
        for (const p of P) { sum += Math.pow(p.v, 0.62); CUM.push(sum); }
      }
      const keys = new Map(P.map((p) => [p.key, p]));
      let w = 0;
      for (let i = 0; i < pn; i++) {
        const q = pulses[i], p = keys.get(q.key);
        if (p) { q.p = p; pulses[i] = pulses[w]; pulses[w++] = q; }
      }
      pn = w;
      NL = [...N.values()];
      LN = M ? M.layers.map((l) => l.map((d) => N.get(d.id))) : [[], [], [], []];
      size();
      for (const n of NL) {
        n.r = (compact ? 3.6 : 4.6) + (compact ? 10 : 15) * Math.sqrt(n.d.share);
        n.L = nodeLabel(n, 0);
        n.T = n.S = n.L;
        if (!VERT && (n.d.layer === 1 || n.d.layer === 2)) { n.T = nodeLabel(n, 1); n.S = nodeLabel(n, 2); }
      }
      CAPS = CAPTIONS[mode].map((t) => label([{ r: [[t.toUpperCase(), "650 " + (VERT ? 9 : 10) + "px", "rgba(235,235,245,0.5)", "0.12em"]], lh: 12 }]));
      place();
      for (const n of NL) {
        if (n.born || still) { n.x = n.tx; n.y = n.ty; n.z = n.tz; n.cr = still ? n.r : 0; n.born = false; }
      }
      settle();
      while (BIN.length < NB) BIN.push(null);
      for (let b = 0; b < NB; b++) if (!BIN[b] || BIN[b].length < cfg.cap * 6) BIN[b] = new Float32Array(cfg.cap * 6);
      ITEMS = NL.map((n) => n.item).concat(E.map((e) => e.item), [0, 1, 2, 3].map((b) => ({ k: 2, o: b, z: 0 })));
      cv.setAttribute("aria-label", sentence());
      paintLede();
      paintTable();
      buildHits();
      home.hidden = !M;
      const st = S.st || { state: "pending" };
      if (M) empty.hidden = true;
      else {
        const def = UI.STATES[st.state] || UI.STATES.pending;
        const word = { ok: "Nothing flagged", quiet: "Nothing flagged", pending: "Reading", unavailable: "Unavailable" }[st.state] || def.word;
        empty.replaceChildren(UI.glyph(def.g), h("b", null, word), h("span", null, st.reason || "The vendor's rules flagged nothing in this read."));
        empty.dataset.state = st.state;
        empty.hidden = false;
      }
      relight();
    }

    function size() {
      const w = stage.clientWidth || host.clientWidth || 640;
      compact = w < 560;
      VERT = compact;
      FF = getComputedStyle(host).fontFamily || FF;
      const most = M ? Math.max(...M.layers.map((l) => l.length)) : 6;
      const hgt = Math.round(VERT ? clamp(w * 1.65, 480, 620) : clamp(Math.max(w * 0.46, most * 34 + 130), 460, 680));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      if (w !== W || hgt !== H || cv.width !== Math.round(w * dpr)) {
        W = w; H = hgt;
        stage.style.height = H + "px";
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
    }

    function spot(li, j, n) {
      const u = (li / 3 - 0.5) * 2, z = G.ARC * (1 - u * u) - G.ZC;
      if (VERT) return [(j - (n - 1) / 2) * Math.min(2 * G.HU / Math.max(1, n - 1), 92), u * G.HV, z];
      return [u * G.HU, (j - (n - 1) / 2) * Math.min(2 * G.HV / Math.max(1, n - 1), 84), z];
    }

    function place() {
      const lw = (li) => LN[li].reduce((m, n) => Math.max(m, n.L.w), 0);
      const lh = (li) => LN[li].reduce((m, n) => Math.max(m, n.L.h), 0);
      const tiers = (li) => (LN[li].reduce((s, n) => s + n.L.w + 4, 0) > W * 0.84 ? 2 : 1);
      if (VERT) {
        G.lw = M ? Math.max(lw(0), lw(1), lw(2), lw(3)) : 40;
        G.tier = [0, 1, 2, 3].map((li) => (M ? tiers(li) : 1));
        G.pt = M ? G.tier[0] * (lh(0) + 2) + 10 : 30;
        G.pb = M ? G.tier[3] * (lh(3) + 2) + 8 : 30;
        G.HU = Math.max(60, (W - 26 - G.lw) / 2);
        G.HV = Math.max(80, (H - G.pt - G.pb) / 2 - 10);
      } else {
        G.lw0 = M ? lw(0) : 60;
        G.lw3 = M ? lw(3) : 60;
        G.pt = 40;
        G.HU = Math.max(120, (W - G.lw0 - G.lw3 - 48) / 2);
        G.HV = Math.max(100, (H - G.pt - G.pb) / 2 - 8);
      }
      G.ARC = (VERT ? G.HV : G.HU) * 0.32;
      G.ZC = G.ARC * 4 / 9;
      G.D = Math.max(VERT ? H : W, 600) * 1.6;
      let yMax = -1e9;
      const set = (n, p) => { n.tx = p[0]; n.ty = p[1]; n.tz = p[2]; yMax = Math.max(yMax, p[1]); };
      if (M) LN.forEach((L, li) => L.forEach((n, j) => set(n, spot(li, j, L.length))));
      GH = [];
      if (!M) [4, 6, 6, 3].forEach((k, li) => { for (let j = 0; j < k; j++) { const g = { r: 7, cr: 7, d: { layer: li } }; set(g, spot(li, j, k)); g.x = g.tx; g.y = g.ty; g.z = g.tz; GH.push(g); } });
      G.YF = VERT ? G.HV + 64 : yMax + 40;
      G.planes = [0, 1, 2, 3].map((li) => {
        const L = M ? LN[li] : GH.filter((g) => g.d.layer === li);
        const a = L[0], b = L[L.length - 1];
        if (VERT) return [0, a.ty, a.tz, Math.abs(b.tx - a.tx) / 2 + 30, 0, a.ty - 26, a.ty + 26];
        const u = (li / 3 - 0.5) * 2, k = -2 * G.ARC * u / G.HU, m = Math.hypot(1, k);
        return [a.tx, 0, a.tz, 34 / m, 34 * k / m, a.ty - 30, G.YF];
      });
      LT = [0, 1, 2, 3].map((li) => [LN[li].filter((n, j) => !(G.tier[li] > 1 && j % 2)), LN[li].filter((n, j) => G.tier[li] > 1 && j % 2)]);
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      DUST = Array.from({ length: compact ? 40 : 70 }, () => [(rnd() - 0.5) * G.HU * 2.6, (rnd() - 0.5) * G.HV * 2.6, (rnd() - 0.3) * G.HU * 1.4, 0.4 + rnd() * 0.9]);
      const keep = [cam.yaw, cam.pitch];
      setCam(REST[0], REST[1]);
      cam.zr = 1e9;
      fit(M ? NL : GH, true);
      cam.zr = cam.z;
      setCam(keep[0], keep[1]);
    }

    function setCam(yaw, pitch) {
      cam.yaw = yaw;
      cam.pitch = pitch;
      cam.cy = Math.cos(yaw); cam.sy = Math.sin(yaw); cam.cp = Math.cos(pitch); cam.sp = Math.sin(pitch);
    }
    const PJ = [0, 0, 1, 0];
    function proj(X, Y, Z) {
      const x1 = X * cam.cy - Z * cam.sy, z1 = X * cam.sy + Z * cam.cy;
      const y2 = Y * cam.cp - z1 * cam.sp, z2 = Y * cam.sp + z1 * cam.cp;
      const s = G.D / Math.max(G.D * 0.3, G.D + z2) * cam.z;
      PJ[0] = cam.ox + x1 * s; PJ[1] = cam.oy + y2 * s; PJ[2] = s; PJ[3] = z2;
      return PJ;
    }

    function fit(pts, target) {
      cam.z = 1; cam.ox = 0; cam.oy = 0;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const n of pts) {
        if (target) proj(n.tx, n.ty, n.tz); else proj(n.x, n.y, n.z);
        n.qx = PJ[0]; n.qy = PJ[1]; n.qs = PJ[2]; n.pz = PJ[3];
        const r = n.r * PJ[2];
        if (PJ[0] - r < x0) x0 = PJ[0] - r;
        if (PJ[0] + r > x1) x1 = PJ[0] + r;
        if (PJ[1] - r < y0) y0 = PJ[1] - r;
        if (PJ[1] + r > y1) y1 = PJ[1] + r;
        if (PJ[3] < z0) z0 = PJ[3];
        if (PJ[3] > z1) z1 = PJ[3];
      }
      const pl = VERT ? 22 + G.lw / 2 : G.lw0 + 16, pr = VERT ? 6 + G.lw / 2 : G.lw3 + 14;
      const pb = VERT ? G.pb : 26 + 40 * floorA();
      const z = Math.max(0.05, Math.min(cam.zr, (W - pl - pr) / Math.max(1, x1 - x0), (H - G.pt - pb) / Math.max(1, y1 - y0)));
      cam.z = z;
      cam.ox = pl + (W - pl - pr - z * (x1 - x0)) / 2 - z * x0;
      cam.oy = G.pt + (H - G.pt - pb - z * (y1 - y0)) / 2 - z * y0;
      cam.lo = z0;
      cam.hi = z1 > z0 + 1 ? z1 : z0 + 1;
      if (!target) for (const n of pts) { n.px = cam.ox + z * n.qx; n.py = cam.oy + z * n.qy; n.ps = n.qs * z; n.fog = fog(n.pz); }
    }
    const floorA = () => clamp((cam.pitch / DEG + 6) / 14, 0, 1);
    const fog = (z) => clamp(0.95 - z / (G.HU * 2.4), 0.5, 1);

    function spawn(p, hot, delay) {
      let q = null;
      if (pn >= cfg.cap) {
        if (!hot) return;
        for (let i = 0; i < pn && !q; i++) if (!pulses[i].hot) q = pulses[i];
        if (!q) return;
      } else {
        q = pulses[pn] || (pulses[pn] = {});
        pn++;
      }
      q.p = p; q.key = p.key; q.u = -delay; q.hot = hot;
      q.sp = (hot ? 0.95 : 0.62) + Math.random() * 0.22;
      q.z = p.size * (hot ? 1.6 : 0.8 + Math.random() * 0.4);
    }
    function pick() {
      const s = CUM[CUM.length - 1] * Math.random();
      let lo = 0, hi = CUM.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (CUM[mid] < s) lo = mid + 1; else hi = mid; }
      return P[lo];
    }

    const YAWMAX = () => (VERT ? 30 : 55) * DEG, PMAX = 22 * DEG;
    function turn(yaw, pitch) {
      let y = clamp(yaw, -YAWMAX(), YAWMAX()), p = clamp(pitch, -PMAX, PMAX);
      if (y !== yaw) cam.vy = 0;
      if (p !== pitch) cam.vp = 0;
      const y0 = cam.yaw, p0 = cam.pitch;
      if (M && NL.length && !fits(y, p) && fits(y0, p0)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (fits(y0 + (y - y0) * m, p0 + (p - p0) * m)) lo = m; else hi = m; }
        y = y0 + (y - y0) * lo; p = p0 + (p - p0) * lo;
        cam.vy = cam.vp = 0;
      }
      setCam(y, p);
      if (M) fit(NL, false);
    }
    function stepCam(dt, now) {
      if (DRAG.on) { cam.idle = now; return; }
      if (cam.vy || cam.vp) {
        turn(cam.yaw + cam.vy * dt, cam.pitch + cam.vp * dt);
        const k = Math.exp(-dt * 3.4);
        cam.vy *= k;
        cam.vp *= k;
        if (Math.abs(cam.vy) < 0.5 * DEG && Math.abs(cam.vp) < 0.5 * DEG) cam.vy = cam.vp = 0;
        cam.idle = now;
      } else if (cam.user && now - cam.idle > 4500) cam.user = false;
      if (cam.user || (cam.hold && !cam.home)) return;
      const t = now / 1000, k = Math.min(1, dt * (cam.home ? 4.5 : 0.9));
      const ty = REST[0] + cam.sw * Math.sin(t * TAU / 46), tp = REST[1] + cam.sw * 0.2 * Math.sin(t * TAU / 61);
      setCam(cam.yaw + (ty - cam.yaw) * k, cam.pitch + (tp - cam.pitch) * k);
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
      focusAmt += (focusTarget - focusAmt) * Math.min(1, dt * 7);
      const ease = 1 - Math.exp(-dt * 5.5), grow = Math.min(1, dt * 5);
      for (const n of NL) {
        n.x += (n.tx - n.x) * ease; n.y += (n.ty - n.y) * ease; n.z += (n.tz - n.z) * ease;
        n.cr += (n.r - n.cr) * grow;
        n.lit += (n.tl - n.lit) * Math.min(1, dt * 8);
        n.energy *= Math.exp(-dt * 2.2);
        n.ripple = Math.max(0, n.ripple - dt * 1.1);
      }
      for (const e of E) e.lit += (e.tl - e.lit) * Math.min(1, dt * 8);
      if (P.length) {
        const rate = cfg.rate || (compact ? 16 : 26) + Math.min(24, P.length * 0.12);
        acc += rate * dt;
        while (acc >= 1) { acc -= 1; if (pn < cfg.cap) spawn(pick(), false, Math.random() * 0.1); }
      }
      for (let i = 0; i < pn; i++) {
        const q = pulses[i], u0 = q.u;
        q.u += q.sp * dt;
        if (u0 < 1 && q.u >= 1) hit(q.p.e[0].b, q);
        if (u0 < 2 && q.u >= 2) hit(q.p.e[1].b, q);
        if (q.u >= 3) {
          hit(q.p.e[2].b, q);
          pn--;
          pulses[i] = pulses[pn];
          pulses[pn] = q;
          i--;
        }
      }
    }
    function hit(n, q) {
      n.energy = Math.min(1, n.energy + (q.hot ? 0.9 : 0.06 * q.z));
      if (q.hot) n.ripple = 1;
    }

    function bez(e, t, out) {
      const a = e.a, b = e.b, m = 1 - t;
      const w0 = m * m * m, w1 = 3 * m * m * t, w2 = 3 * m * t * t, w3 = t * t * t;
      if (VERT) {
        const c = (b.py - a.py) * 0.5;
        out[0] = (w0 + w1) * a.px + (w2 + w3) * b.px;
        out[1] = w0 * a.py + w1 * (a.py + c) + w2 * (b.py - c) + w3 * b.py;
      } else {
        const c = (b.px - a.px) * 0.5;
        out[0] = w0 * a.px + w1 * (a.px + c) + w2 * (b.px - c) + w3 * b.px;
        out[1] = (w0 + w1) * a.py + (w2 + w3) * b.py;
      }
      out[2] = a.pz + (b.pz - a.pz) * t;
      return out;
    }
    function curve(c, ax, ay, bx, by) {
      c.moveTo(ax, ay);
      if (VERT) { const k = (by - ay) * 0.5; c.bezierCurveTo(ax, ay + k, bx, by - k, bx, by); }
      else { const k = (bx - ax) * 0.5; c.bezierCurveTo(ax + k, ay, bx - k, by, bx, by); }
    }
    function ribbon(c, ax, ay, bx, by, ha, hb) {
      if (VERT) {
        const k = (by - ay) * 0.5;
        c.moveTo(ax - ha, ay);
        c.bezierCurveTo(ax - ha, ay + k, bx - hb, by - k, bx - hb, by);
        c.lineTo(bx + hb, by);
        c.bezierCurveTo(bx + hb, by - k, ax + ha, ay + k, ax + ha, ay);
      } else {
        const k = (bx - ax) * 0.5;
        c.moveTo(ax, ay - ha);
        c.bezierCurveTo(ax + k, ay - ha, bx - k, by - hb, bx, by - hb);
        c.lineTo(bx, by + hb);
        c.bezierCurveTo(bx - k, by + hb, ax + k, ay + ha, ax, ay + ha);
      }
      c.closePath();
    }
    const B1 = [0, 0, 0], B2 = [0, 0, 0];

    function drawStage(c, pts) {
      const fa = floorA();
      if (fa > 0.02) {
        const st = G.HU / 3.2, yf = G.YF;
        c.strokeStyle = "rgb(150,175,225)";
        c.lineWidth = 1;
        for (let b = 0; b < 4; b++) {
          const za = st * (b * 2 - 2), zb = za + st * 2;
          c.beginPath();
          proj(-4 * st, yf, za); c.moveTo(PJ[0], PJ[1]);
          proj(4 * st, yf, za); c.lineTo(PJ[0], PJ[1]);
          proj(4 * st, yf, zb); c.lineTo(PJ[0], PJ[1]);
          proj(-4 * st, yf, zb); c.lineTo(PJ[0], PJ[1]);
          c.fillStyle = "rgb(70,100,180)";
          c.globalAlpha = fa * [0.075, 0.06, 0.035, 0.015][b];
          c.fill();
          c.beginPath();
          for (let i = -4; i <= 4; i++) { proj(i * st, yf, za); c.moveTo(PJ[0], PJ[1]); proj(i * st, yf, zb); c.lineTo(PJ[0], PJ[1]); }
          for (let k = 0; k < 2; k++) { proj(-4 * st, yf, za + k * st); c.moveTo(PJ[0], PJ[1]); proj(4 * st, yf, za + k * st); c.lineTo(PJ[0], PJ[1]); }
          c.globalAlpha = fa * [0.14, 0.09, 0.05, 0.022][b];
          c.stroke();
        }
        for (const n of pts) {
          const ht = G.YF - n.y;
          proj(n.x + ht * 0.07, G.YF, n.z - ht * 0.16);
          const rx = n.r * PJ[2] * (1.8 + ht / G.HV * 0.6), ry = rx * clamp(cam.sp + 0.12, 0.14, 0.45);
          c.globalAlpha = fa * 0.8 * (1 - 0.5 * ht / (G.YF + G.HV));
          c.drawImage(SPR.shadow, PJ[0] - rx, PJ[1] - ry, rx * 2, ry * 2);
        }
      }
      c.globalAlpha = 1;
      c.fillStyle = "rgba(110,150,255,0.04)";
      c.strokeStyle = "rgba(170,200,255,0.12)";
      for (const q of G.planes) {
        c.beginPath();
        proj(q[0] - q[3], q[5], q[2] - q[4]); c.moveTo(PJ[0], PJ[1]);
        proj(q[0] + q[3], q[5], q[2] + q[4]); c.lineTo(PJ[0], PJ[1]);
        proj(q[0] + q[3], q[6], q[2] + q[4]); c.lineTo(PJ[0], PJ[1]);
        proj(q[0] - q[3], q[6], q[2] - q[4]); c.lineTo(PJ[0], PJ[1]);
        c.closePath();
        c.fill();
        c.stroke();
      }
    }

    function draw() {
      const c = ctx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const pts = M ? NL : GH;
      fit(pts, false);
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.5;
      c.drawImage(SPR.core, cam.ox - W * 0.42, cam.oy - H * 0.5, W * 0.84, H);
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
      drawStage(c, pts);
      if (!M) { drawGhosts(c); return; }
      if (!still && DUST.length) {
        c.fillStyle = "rgba(170,190,235,0.28)";
        c.beginPath();
        for (const d of DUST) {
          proj(d[0], d[1], d[2]);
          const r = d[3] * PJ[2];
          c.rect(PJ[0] - r / 2, PJ[1] - r / 2, r, r);
        }
        c.fill();
      }
      const dim = 1 - 0.82 * focusAmt;
      c.lineWidth = 1;
      c.strokeStyle = "rgba(150,175,225," + (0.075 * (1 - 0.7 * focusAmt)).toFixed(3) + ")";
      c.beginPath();
      for (const [a, b] of MESH) curve(c, a.px, a.py, b.px, b.py);
      c.stroke();
      for (const e of E) e.item.z = Math.max(e.a.pz, e.b.pz) + 1;
      for (const n of NL) n.item.z = n.pz;
      const bw = (cam.hi - cam.lo) / NB;
      for (let b = 0; b < NB; b++) { BN[b] = 0; BM[b] = 0; BZ[b] = cam.lo + bw * (b + 0.5); }
      if (!still && pn) binPulses(bw);
      for (const it of ITEMS) if (it.k === 2) it.z = BZ[it.o];
      for (let i = 1; i < ITEMS.length; i++) {
        const it = ITEMS[i];
        let j = i - 1;
        while (j >= 0 && ITEMS[j].z < it.z) { ITEMS[j + 1] = ITEMS[j]; j--; }
        ITEMS[j + 1] = it;
      }
      const wmax = compact ? 11 : 17;
      for (const it of ITEMS) {
        if (TRACE) TRACE.push(it.k === 0 ? { k: "node", id: it.o.id, z: it.z, x: it.o.px, y: it.o.py, r: it.o.cr * it.o.ps } : it.k === 1 ? { k: "edge", id: it.o.a.id + "|" + it.o.b.id, z: it.z, ax: it.o.a.px, ay: it.o.a.py, bx: it.o.b.px, by: it.o.b.py } : { k: "pulses", z: it.z });
        if (it.k === 0) drawNode(c, it.o, dim);
        else if (it.k === 1) drawEdge(c, it.o, dim, wmax);
        else if (BN[it.o]) drawBin(c, it.o, dim);
      }
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = 1;
      drawLabels(c, dim);
    }

    function drawEdge(c, e, dim, wmax) {
      const a = e.a, b = e.b;
      const sh = e.share + ((e.fv / M.total) - e.share) * focusAmt * (e.tl ? 1 : 0);
      const lit = e.lit + (1 - e.lit) * (1 - focusAmt);
      const al = (dim + (1 - dim) * lit) * (a.fog + b.fog) * 0.5;
      const w = 0.6 + wmax * Math.pow(sh, 0.8);
      c.globalCompositeOperation = "lighter";
      c.strokeStyle = c.fillStyle = e.tl && focusAmt > 0.01 ? e.fcs : e.cs;
      c.globalAlpha = al * 0.09;
      c.lineWidth = w * (a.ps + b.ps) * 1.6 + 3;
      c.beginPath();
      curve(c, a.px, a.py, b.px, b.py);
      c.stroke();
      c.globalAlpha = al * (0.42 + 0.4 * lit * focusAmt);
      c.beginPath();
      ribbon(c, a.px, a.py, b.px, b.py, Math.max(0.35, w * a.ps / 2), Math.max(0.35, w * b.ps / 2));
      c.fill();
    }

    function binPulses(bw) {
      for (let i = 0; i < pn; i++) {
        const q = pulses[i];
        if (q.u < 0) continue;
        const hop = q.u < 1 ? 0 : q.u < 2 ? 1 : 2, t = q.u - hop, e = q.p.e[hop];
        bez(e, t, B1);
        bez(e, t > 0.13 ? t - 0.13 : 0, B2);
        const b = clamp(Math.floor((B1[2] - cam.lo) / bw), 0, NB - 1), A = BIN[b], o = BN[b];
        if (o >= A.length) continue;
        const k = (q.p.lit ? q.p.c : 3) * 3 + (q.z > 0.95 ? 2 : q.z > 0.7 ? 1 : 0);
        const s = G.D / Math.max(G.D * 0.3, G.D + B1[2]) * cam.z;
        A[o] = B2[0]; A[o + 1] = B2[1]; A[o + 2] = B1[0]; A[o + 3] = B1[1]; A[o + 4] = k; A[o + 5] = q.hot ? 13 * q.z * s : 0;
        BN[b] = o + 6;
        BM[b] |= 1 << k;
      }
    }
    const LW = [[3.2, 1], [4.6, 1.5], [6.4, 2.1]];
    function drawBin(c, b, dim) {
      const A = BIN[b], n = BN[b];
      c.globalCompositeOperation = "lighter";
      c.lineCap = "round";
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < 12; k++) {
          if (!(BM[b] & (1 << k))) continue;
          const ci = (k / 3) | 0;
          c.strokeStyle = PCOL[ci];
          c.globalAlpha = (pass ? 0.92 : 0.17) * (ci === 3 ? dim * 0.6 : 1);
          c.lineWidth = LW[k % 3][pass];
          c.beginPath();
          for (let i = 0; i < n; i += 6) if (A[i + 4] === k) { c.moveTo(A[i], A[i + 1]); c.lineTo(A[i + 2], A[i + 3]); }
          c.stroke();
        }
      }
      c.globalAlpha = 1;
      for (let i = 0; i < n; i += 6) {
        const s = A[i + 5];
        if (s > 0) c.drawImage(SPR.hot, A[i + 2] - s, A[i + 3] - s, s * 2, s * 2);
      }
      c.lineCap = "butt";
    }

    function drawNode(c, n, dim) {
      const lit = n.lit + (1 - n.lit) * (1 - focusAmt);
      const al = (dim + (1 - dim) * lit) * n.fog;
      const r = n.cr * n.ps;
      if (r < 0.3) return;
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = al * (0.34 + 0.5 * n.energy);
      const g = r * (2.8 + 1.6 * n.energy);
      c.drawImage(SPR[n.spr], n.px - g, n.py - g, g * 2, g * 2);
      if (n.ripple > 0) {
        c.globalAlpha = n.ripple * 0.7 * al;
        c.strokeStyle = PCOL[2];
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(n.px, n.py, r + (1 - n.ripple) * 30, 0, TAU);
        c.stroke();
      }
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = 1;
      c.fillStyle = "rgb(7,9,15)";
      c.beginPath();
      c.arc(n.px, n.py, r * 0.97, 0, TAU);
      c.fill();
      c.globalAlpha = Math.min(1, al * 1.08);
      c.drawImage(n.sph, n.px - r, n.py - r, r * 2, r * 2);
      if (n.energy > 0.03) {
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = n.energy * 0.6 * al;
        c.drawImage(SPR[n.spr], n.px - r * 1.3, n.py - r * 1.3, r * 2.6, r * 2.6);
        c.globalCompositeOperation = "source-over";
      }
      if (n.id === focusId || n.id === hoverId || n.id === pinId) {
        c.globalAlpha = 1;
        c.strokeStyle = "rgba(245,245,247,0.9)";
        c.lineWidth = n.id === focusId || n.id === pinId ? 2 : 1.5;
        c.beginPath();
        c.arc(n.px, n.py, r + 5, 0, TAU);
        c.stroke();
      }
    }

    function spread(list, a, lo, hi, k = list.length) {
      const s = a + 2;
      let sh = 0;
      for (let i = 0; i < k; i++) sh -= list[i].lb[a];
      for (let i = 1; i < k; i++) { const p = list[i - 1].lb, q = list[i].lb; if (q[a] < p[a] + p[s] + 2) q[a] = p[a] + p[s] + 2; }
      for (let i = 0; i < k; i++) sh += list[i].lb[a];
      if (sh) for (let i = 0; i < k; i++) list[i].lb[a] -= sh / k;
      for (let i = k - 1; i >= 0; i--) { const q = list[i].lb, m = i === k - 1 ? hi - q[s] : list[i + 1].lb[a] - q[s] - 2; if (q[a] > m) q[a] = m; }
      for (let i = 0; i < k; i++) { const q = list[i].lb, m = i ? list[i - 1].lb[a] + list[i - 1].lb[s] + 2 : lo; if (q[a] < m) q[a] = m; }
    }

    const ARR = [[1, 1, 0], [1, 1, 1], [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 1, 2], [0, 0, 2], [0, 1, 2]];
    const FORMS = ["L", "T", "S"], CAPO = [0, 1, 2, 3].map((li) => ({ li, lb: [0, 0, 0, 0] })), CS = [];
    const sideOf = (cf, li) => (li === 0 ? 0 : li === 3 ? 1 : cf[li - 1]);
    let CF = ARR[0];
    function lay(cf) {
      for (let li = 0; li < 4; li++) {
        const L = LN[li];
        if (!L.length) continue;
        const right = sideOf(cf, li), form = li === 1 || li === 2 ? cf[2] : 0;
        let row = VERT ? (li === 0 ? 1e9 : -1e9) : 0;
        if (VERT) for (const n of L) row = li === 0 ? Math.min(row, n.py - n.cr * n.ps) : Math.max(row, n.py + n.cr * n.ps);
        for (let j = 0; j < L.length; j++) {
          const n = L[j], S = n[FORMS[form]], r = n.cr * n.ps, lb = n.lb;
          n.cur = S;
          n.form = S === n.L ? 0 : form;
          lb[2] = S.w; lb[3] = S.h;
          if (VERT) {
            const t = G.tier[li] > 1 && j % 2 ? 1 : 0;
            lb[0] = n.px - S.w / 2;
            lb[1] = li === 0 ? row - 3 - S.h - t * (S.h + 2) : row + 2 + t * (S.h + 2);
          } else {
            lb[0] = clamp(right ? n.px + r + 4 : n.px - r - 6 - S.w, 2, W - S.w - 2);
            lb[1] = n.py - S.h / 2;
          }
        }
        if (VERT) for (const T of LT[li]) spread(T, 0, 20, W - 2);
        else spread(L, 1, 2, H - 2);
      }
      CS.length = 0;
      for (const o of CAPO) {
        const C = CAPS[o.li], ns = LN[o.li], q = o.lb;
        if (!C || !ns.length) continue;
        if (VERT) {
          let y = 0;
          for (const n of ns) y += n.py;
          y /= ns.length;
          q[0] = 8 - C.h / 2; q[1] = y - C.w / 2; q[2] = C.h; q[3] = C.w;
        } else {
          const n = ns[0], r = n.cr * n.ps;
          q[1] = 8; q[2] = C.w; q[3] = C.h;
          let hit = true;
          for (const x of [n.px - C.w / 2, sideOf(cf, o.li) ? n.px + r - C.w : n.px - r]) {
            q[0] = clamp(x, 2, W - C.w - 2);
            hit = false;
            for (const m of NL) if (over(q, m.lb)) { hit = true; break; }
            if (!hit) break;
          }
          if (hit) continue;
        }
        CS.push(o);
      }
      if (!VERT && CS.length > 1) {
        CS.sort((x, y) => x.lb[0] - y.lb[0]);
        spread(CS, 0, 2, W - 2);
      }
    }
    const over = (a, b) => a[0] < b[0] + b[2] - 0.5 && b[0] < a[0] + a[2] - 0.5 && a[1] < b[1] + b[3] - 0.5 && b[1] < a[1] + a[3] - 0.5;
    const SB = [0, 0, 0, 0];
    function clash(stop) {
      let k = 0;
      for (let i = 0; i < NL.length; i++) {
        const a = NL[i].lb;
        if (a[0] < 0 || a[1] < 0 || a[0] + a[2] > W || a[1] + a[3] > H) k++;
        for (let j = i + 1; j < NL.length; j++) if (over(a, NL[j].lb)) k++;
        for (const o of CS) if (over(a, o.lb)) k++;
        for (const b of NL) {
          const r = b.cr * b.ps;
          SB[0] = b.px - r; SB[1] = b.py - r; SB[2] = SB[3] = r * 2;
          if (over(a, SB)) k++;
        }
        if (k >= stop) return k;
      }
      for (let i = 0; i < CS.length; i++) for (let j = i + 1; j < CS.length; j++) if (over(CS[i].lb, CS[j].lb)) k++;
      return k;
    }
    let laid = -1;
    function arrange(test) {
      if (VERT) { lay(CF = ARR[laid = 0]); return test ? !clash(1) : true; }
      let best = 0, bk = 1e9;
      for (let i = 0; i < ARR.length && bk; i++) {
        lay(ARR[laid = i]);
        const k = clash(test ? 1 : bk);
        if (k < bk) { bk = k; best = i; }
      }
      if (test) return !bk;
      if (laid !== best) lay(ARR[laid = best]);
      CF = ARR[best];
      return !bk;
    }

    function drawLabels(c, dim) {
      if (!LN[0].length && !LN[1].length) return;
      arrange();
      c.globalAlpha = 1;
      c.strokeStyle = "rgba(200,210,235,0.5)";
      c.lineWidth = 1;
      c.beginPath();
      for (const n of NL) {
        const lb = n.lb, r = n.cr * n.ps;
        const off = VERT ? Math.abs(lb[0] + lb[2] / 2 - n.px) : Math.abs(lb[1] + lb[3] / 2 - n.py);
        if (off <= 4) continue;
        if (VERT) { c.moveTo(n.px, n.py + (lb[1] > n.py ? r : -r)); c.lineTo(lb[0] + lb[2] / 2, lb[1] > n.py ? lb[1] : lb[1] + lb[3]); }
        else { c.moveTo(n.px + (lb[0] > n.px ? r : -r), n.py); c.lineTo(lb[0] > n.px ? lb[0] : lb[0] + lb[2], lb[1] + lb[3] / 2); }
      }
      c.stroke();
      c.fillStyle = "rgba(6,8,14,0.9)";
      c.beginPath();
      for (const n of NL) {
        const lb = n.lb;
        if (!n.cur.chip) continue;
        if (c.roundRect) c.roundRect(lb[0] + 0.5, lb[1] + 0.5, lb[2] - 1, lb[3] - 1, 6); else c.rect(lb[0] + 0.5, lb[1] + 0.5, lb[2] - 1, lb[3] - 1);
      }
      c.fill();
      for (const n of NL) {
        const lit = n.lit + (1 - n.lit) * (1 - focusAmt), lb = n.lb;
        c.globalAlpha = Math.max(0.3, (dim + (1 - dim) * lit) * (0.82 + 0.18 * n.fog));
        c.drawImage(n.cur.c, lb[0], lb[1], lb[2], lb[3]);
      }
      c.globalAlpha = 1;
      for (const o of CS) {
        const C = CAPS[o.li], q = o.lb;
        if (VERT) {
          c.save();
          c.translate(q[0] + q[2] / 2, q[1] + q[3] / 2);
          c.rotate(-Math.PI / 2);
          c.drawImage(C.c, -C.w / 2, -C.h / 2, C.w, C.h);
          c.restore();
        } else c.drawImage(C.c, q[0], q[1], C.w, C.h);
      }
    }

    function fits(y, p) {
      setCam(y, p);
      fit(NL, false);
      return arrange(true);
    }
    function settle() {
      cam.sw = 0;
      if (!M || !NL.length) return;
      const sv = NL.map((n) => [n.x, n.y, n.z, n.cr]), y0 = cam.yaw, p0 = cam.pitch, [ry, rp] = REST;
      for (const n of NL) { n.x = n.tx; n.y = n.ty; n.z = n.tz; n.cr = n.r; }
      for (const a of [9, 4.5]) if ([-1, 1].every((k) => fits(ry + k * a * DEG, rp + k * 1.8 * DEG) && fits(ry + k * a * DEG, rp - k * 1.8 * DEG))) { cam.sw = a * DEG; break; }
      let t = 1;
      if (!fits(y0, p0) && fits(ry, rp)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (fits(ry + (y0 - ry) * m, rp + (p0 - rp) * m)) lo = m; else hi = m; }
        t = lo;
      }
      NL.forEach((n, i) => { [n.x, n.y, n.z, n.cr] = sv[i]; });
      setCam(ry + (y0 - ry) * t, rp + (p0 - rp) * t);
      fit(NL, false);
    }

    function drawGhosts(c) {
      c.strokeStyle = "rgba(160,180,220,0.09)";
      c.lineWidth = 1;
      c.beginPath();
      for (const a of GH) for (const b of GH) if (b.d.layer === a.d.layer + 1) curve(c, a.px, a.py, b.px, b.py);
      c.stroke();
      for (const g of GH) {
        c.fillStyle = "rgba(9,12,20,0.9)";
        c.beginPath();
        c.arc(g.px, g.py, Math.max(0, 7 * g.ps), 0, TAU);
        c.fill();
        c.strokeStyle = "rgba(160,180,220,0.28)";
        c.stroke();
      }
    }

    function paint() {
      if (!COL) colors();
      if (still || !raf) {
        focusAmt = focusTarget;
        for (const n of NL) { n.lit = n.tl; if (still) { n.x = n.tx; n.y = n.ty; n.z = n.tz; n.cr = n.r; } }
        for (const e of E) e.lit = e.tl;
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
      if (!COL) colors();
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

    function ignite() {
      if (still || !P.length) return;
      const n = Math.min(P.length, Math.round(cfg.cap * 0.4));
      for (let i = 0; i < n; i++) spawn(P[i % P.length], false, (i % 24) * 0.05 + Math.random() * 0.5);
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
      const first = !S.keys && S.rows.length > 0;
      if (ok) S.keys = keys;
      rebuild();
      paintPill();
      if (first) ignite();
      else if (fresh.length && !still) {
        let shot = 0;
        for (const r of fresh) {
          const t = String(r.t || "").toUpperCase(), nid = N.has("n:" + t) ? "n:" + t : "n:~";
          for (const q of model([r], { out: mode, session: S.session }).paths) {
            const p = P.find((x) => x.ids[0] === q.ids[0] && x.ids[2] === nid && x.ids[3] === q.ids[3]);
            if (p && shot < 40) spawn(p, true, 0.12 * shot++);
          }
        }
      }
    }

    function loadUniverse() {
      fetch("/api/flows/universe", { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then((res) => (res.ok ? res.json() : null))
        .then((u) => {
          if (u && u.status === "ok" && Array.isArray(u.t) && Array.isArray(u.sec) && Array.isArray(u.sectors)) {
            U.map = new Map(u.t.map((t, i) => [String(t).toUpperCase(), Number.isInteger(u.sec[i]) ? u.sectors[u.sec[i]] || null : null]));
            U.state = "ok";
          } else {
            U.map = new Map();
            U.state = "fail";
          }
        }, () => { U.map = new Map(); U.state = "fail"; })
        .then(() => { if (S.rows.length) rebuild(); });
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
        if (!still && e.type === "pointerup") { cam.vy = clamp(DRAG.vx * k, -4, 4); cam.vp = clamp(DRAG.vy * k, -2, 2); }
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
    if (window.IntersectionObserver) {
      new IntersectionObserver((list) => {
        inView = list[list.length - 1].isIntersecting;
        if (inView) kick(); else halt();
      }).observe(stage);
    }
    document.addEventListener("visibilitychange", () => { if (document.hidden) halt(); else kick(); });
    const onMotion = () => { still = RM.matches; halt(); paintLegend(); rebuild(); };
    if (RM.addEventListener) RM.addEventListener("change", onMotion);
    let rz = 0;
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        cancelAnimationFrame(rz);
        rz = requestAnimationFrame(() => { if (Math.abs((stage.clientWidth || 0) - W) > 1) rebuild(); });
      }).observe(host);
    }

    colors();
    size();
    rebuild();
    if (opts.universe !== false) loadUniverse(); else { U.map = new Map(); U.state = "fail"; }

    const api = {
      take,
      sectors: (map) => { U.map = map instanceof Map ? map : new Map(Object.entries(map || {})); U.state = "ok"; if (S.rows.length) rebuild(); },
      mode: (m) => { if (m === "dte" || m === "lean") { seg.pick(m === "dte" ? 1 : 0); setMode(m); } return mode; },
      model: () => M,
      stats: () => ({
        frames: stats.frames, ms: stats.ms, last: stats.last, max: stats.max, running: !!raf, still,
        median: stats.ring.length ? stats.ring.slice().sort((a, b) => a - b)[stats.ring.length >> 1] : null,
        pulses: pn, hot: pulses.slice(0, pn).filter((q) => q.hot).length, flowEdges: E.length, meshEdges: MESH.length, edges: E.length + MESH.length,
        layers: M ? M.layers.map((l) => l.length) : [], w: W, h: H,
      }),
      reset: () => { stats.frames = 0; stats.ms = 0; stats.max = 0; stats.ring = []; },
      measure: (n) => {
        const times = [];
        let t = performance.now();
        for (let i = 0; i < (n || 120); i++) {
          const t0 = performance.now();
          t += 1000 / 60;
          step(1 / 60, t);
          draw();
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        return { median: times[times.length >> 1], p90: times[Math.floor(times.length * 0.9)], mean: times.reduce((a, b) => a + b, 0) / times.length, pulses: pn, edges: E.length + MESH.length };
      },
      camera: () => ({ yaw: cam.yaw / DEG, pitch: cam.pitch / DEG, rest: REST.map((x) => x / DEG), limits: [VERT ? 30 : 55, 22], sway: cam.sw / DEG, auto: !cam.user, spin: Math.hypot(cam.vy, cam.vp) / DEG, zoom: cam.z }),
      orbit: (yaw, pitch) => { cam.vy = cam.vp = 0; orbit((yaw * DEG - cam.yaw) / (0.32 * DEG), (pitch * DEG - cam.pitch) / (0.22 * DEG)); paint(); return api.camera(); },
      recentre,
      paints: () => { TRACE = []; if (!COL) colors(); draw(); const o = TRACE; TRACE = null; return o; },
      labels: () => NL.map((n) => ({ id: n.id, x: n.lb[0], y: n.lb[1], w: n.lb[2], h: n.lb[3], form: ["line", "two", "short"][n.form || 0] })).concat(CS.map((o) => ({ id: "cap:" + o.li, x: o.lb[0], y: o.lb[1], w: o.lb[2], h: o.lb[3] }))),
      node: (id) => { const n = N.get(id); return n ? { x: n.px, y: n.py, r: n.cr * n.ps, z: n.pz, lit: n.tl, label: n.d.label, v: n.d.v } : null; },
    };
    NETS.set(host, api);
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, UI, {
    net: Object.freeze({ model, mount, of: (el) => NETS.get(el) || null }),
  }));
})();
