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
  const KIND_ORDER = ["ca", "pb", "nx", "pa", "cb"];
  const LEANS = { bull: "Bullish", nx: "Unattributed", bear: "Bearish" };
  const LEAN_ORDER = ["bull", "nx", "bear"];
  const LEAN_GLYPH = { bull: "up", bear: "down", nx: "flat" };
  const DTE = { d0: "0DTE", w1: "1–7 days", m1: "8–31 days", far: "32+ days", nx: "No expiry" };
  const DTE_ORDER = ["d0", "w1", "m1", "far", "nx"];
  const CAPTIONS = { lean: ["Side", "Sector", "Name", "Lean"], dte: ["Side", "Sector", "Name", "Expiry"] };

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
      const g = sectorGroup(secOf(t), o.unread), x = dteBucket(r, o.session);
      const push = (k, v) => { if (v > prem * 1e-9) parts.push({ r: ri, t, g, k, v, lean: KINDS[k].lean, x }); };
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
    const secRank = new Map(secs.map((s, i) => [s.g.k, i]));

    const nodes = new Map(), hops = [new Map(), new Map(), new Map()], paths = new Map();
    const node = (id, layer, o2) => {
      let n = nodes.get(id);
      if (!n) nodes.set(id, n = Object.assign({ id, layer, v: 0, bull: 0, bear: 0, nx: 0, rows: new Set(), members: new Set() }, o2));
      return n;
    };
    for (const p of parts) {
      const sid = keepS.has(p.g.k) ? "s:" + p.g.k : "s:~";
      const nid = keepN.has(p.t) ? "n:" + p.t : "n:~";
      const oid = "o:" + (mode === "lean" ? p.lean : p.x);
      const ids = ["i:" + p.k, sid, nid, oid];
      const ns = [
        node(ids[0], 0, { label: KINDS[p.k].label, lean: KINDS[p.k].lean, kind: p.k }),
        node(sid, 1, sid === "s:~" ? { label: "Other", tok: "--sect-none", rank: 98 } : { label: p.g.label, full: p.g.full, tok: p.g.tok, rank: secRank.get(p.g.k) }),
        node(nid, 2, nid === "n:~" ? { label: "Other names", rank: 99 } : { label: p.t, ticker: p.t, sec: p.g.label, rank: sid === "s:~" ? 98 : secRank.get(p.g.k) }),
        node(oid, 3, mode === "lean" ? { label: LEANS[p.lean], lean: p.lean } : { label: DTE[p.x], bucket: p.x }),
      ];
      for (const n of ns) { n.v += p.v; n[p.lean] += p.v; n.rows.add(p.r); }
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

    const order0 = (n) => KIND_ORDER.indexOf(n.kind);
    const order3 = (n) => (mode === "lean" ? LEAN_ORDER.indexOf(n.lean) : DTE_ORDER.indexOf(n.bucket));
    const layers = [[], [], [], []];
    for (const n of nodes.values()) {
      n.share = total ? n.v / total : 0;
      n.windows = n.rows.size;
      delete n.rows;
      n.members = [...n.members];
      layers[n.layer].push(n);
    }
    layers[0].sort((a, b) => order0(a) - order0(b));
    layers[1].sort((a, b) => a.rank - b.rank);
    layers[2].sort((a, b) => a.rank - b.rank || b.v - a.v || (a.id < b.id ? -1 : 1));
    layers[3].sort((a, b) => order3(a) - order3(b));

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

  function sprite(c, size, core) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const g = cv.getContext("2d"), r = size / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, rgba(core || c, 1));
    gr.addColorStop(0.16, rgba(c, 0.62));
    gr.addColorStop(0.42, rgba(c, 0.18));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return cv;
  }

  function mount(host, opts = {}) {
    if (!host) return null;
    if (NETS.has(host)) return NETS.get(host);
    const cfg = { names: num(opts.names), rate: num(opts.rate), cap: num(opts.cap) || 280 };
    const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
    let still = RM.matches;

    const cv = h("canvas", { class: "fn-cv", role: "img", "aria-label": "Flow network: reading the flagged windows." });
    const hits = h("div", { class: "fn-hits", role: "group", "aria-label": "Network nodes; arrow keys move between them" });
    const tip = h("div", { class: "fn-tip", "aria-hidden": "true", hidden: true });
    const empty = h("div", { class: "fn-empty", hidden: true });
    const stage = h("div", { class: "fn-stage" }, cv, hits, tip, empty);
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
    let E = [], MESH = [], P = [], CUM = [], CAPS = [], ghosts = null;
    const pulses = [];
    let pn = 0, acc = 0, raf = 0, last = 0, inView = true, focusAmt = 0, focusTarget = 0;
    let hoverId = null, focusId = null, pinId = null, rowLit = null, rove = null, hitAt = 0, tipId = null;
    const par = { x: 0, y: 0, tx: 0, ty: 0 };
    const cam = { f: 900, cx: 0, cy: 0, cyw: 1, syw: 0, cp: 1, sp: 0, zMin: 0, zMax: 1 };
    const stats = { frames: 0, ms: 0, last: 0, max: 0, ring: [] };
    let COL = null, SPR = null, PCOL = null, DUST = [], NL = [];

    function colors() {
      const c = (t) => toRgb(UI.cssVar(t));
      COL = { up: c("--up"), down: c("--down"), acc: c("--accent-ink"), soft: c("--accent-soft"), white: [255, 255, 255] };
      SPR = { 0: sprite(COL.up, 64), 1: sprite(COL.down, 64), 2: sprite(COL.acc, 64), hot: sprite(COL.soft, 64, COL.white), core: sprite(COL.acc, 256) };
      PCOL = [mix(COL.up, COL.white, 0.25), mix(COL.down, COL.white, 0.2), mix(COL.acc, COL.white, 0.3), [150, 170, 210]].map((x) => rgba(x, 1));
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
      const pad = chip ? 5 : 4, g = glyph ? 13 : 0;
      const m = MEAS || (MEAS = document.createElement("canvas").getContext("2d"));
      let w = 0, hh = pad * 2;
      const runs = (l) => [[l.t, l.f, l.c, l.ls], l.t2 ? [l.t2, l.f2, l.c2, null] : null].filter(Boolean);
      lines.forEach((l, i) => {
        l.w = i === 0 ? g : 0;
        l.rs = runs(l);
        l.rs.forEach((r, k) => { m.font = r[1] + " " + FF; m.letterSpacing = r[3] || "0px"; r.w = m.measureText(r[0]).width; l.w += r.w + (k ? 5 : 0); });
        w = Math.max(w, l.w);
        hh += l.lh;
      });
      const cw = Math.ceil(w + pad * 2 + 2), ch = Math.ceil(hh);
      const c = document.createElement("canvas");
      c.width = cw * dpr;
      c.height = ch * dpr;
      const x = c.getContext("2d");
      x.scale(dpr, dpr);
      if (chip) {
        x.fillStyle = "rgba(6,8,14,0.58)";
        x.beginPath();
        if (x.roundRect) x.roundRect(0.5, 0.5, cw - 1, ch - 1, 6); else x.rect(0.5, 0.5, cw - 1, ch - 1);
        x.fill();
      }
      x.lineJoin = "round";
      x.textBaseline = "middle";
      let y = pad;
      lines.forEach((l, i) => {
        let tx = pad + (align === "end" ? w - l.w : align === "center" ? (w - l.w) / 2 : 0);
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
        l.rs.forEach((r) => {
          x.font = r[1] + " " + FF;
          x.letterSpacing = r[3] || "0px";
          x.strokeStyle = "rgba(6,8,13,0.88)";
          x.lineWidth = 3.6;
          x.strokeText(r[0], tx, my);
          x.fillStyle = r[2];
          x.fillText(r[0], tx, my);
          tx += r.w + 5;
        });
        y += l.lh;
      });
      return { c, w: cw, h: ch };
    }

    function nodeLabel(n) {
      const d = n.d, big = d.layer === 2 && d.ticker;
      const W1 = "rgba(245,245,247,0.97)", W2 = "rgba(235,235,245,0.6)";
      const sub = d.layer === 3 ? pct(d.share) + (compact ? "" : " " + MID + " " + money(d.v)) : money(d.v);
      const glyph = d.layer === 3 && d.lean ? LEAN_GLYPH[d.lean] : null;
      if (VERT) {
        const fa = big ? "650 10.5px" : "600 10px";
        const t = d.id === "n:~" ? "+" + d.members.length + " more" : d.label;
        return label([{ t, f: fa, lh: 12, c: W1 }, { t: sub, f: "500 9.5px", lh: 11, c: W2 }], glyph, n.col, "center", true);
      }
      if (d.layer === 1 || d.layer === 2) return label([{ t: d.label, f: big ? "650 13px" : "600 12px", lh: 16, c: W1, t2: sub, f2: "500 11px", c2: W2 }], null, n.col, "start", true);
      return label([{ t: d.label, f: "600 12.5px", lh: 16, c: W1 }, { t: sub, f: "500 11px", lh: 14, c: W2 }], glyph, n.col, d.layer === 0 ? "end" : "start");
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
          "Line width is premium. Light runs along each path in proportion to its premium: a picture of the record, not a feed of executions. A flare marks a window that reached this page while it was open.",
          "Sectors come from the nightly universe; a name it does not carry is drawn under No sector. Expiry is counted in calendar days from the window's own Eastern date.",
          "Only the largest names and sectors get their own node; the rest are folded into Other, so every layer still sums to the same premium.",
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
        h("span", { class: "ui-key fn-k is-note" }, "Width and light: premium" + (still ? "" : "; a flare: a window that arrived while you watched")));
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
      const bits = ["Where flagged option premium is flowing: from the side of the quote it met, through sector and name, to its " + (mode === "lean" ? "lean" : "expiry") + ". "];
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

    function hitLabel(d) {
      const lean = d.v ? " Lean by convention: " + pct(d.bull / d.v) + " bullish, " + pct(d.bear / d.v) + " bearish, " + pct(d.nx / d.v) + " unattributed." : "";
      const what = d.layer === 2 && d.ticker ? d.ticker + (d.sec ? ", " + d.sec : "") : d.label + (d.members && d.members.length ? " (" + d.members.slice(0, 8).join(", ") + (d.members.length > 8 ? ", and more" : "") + ")" : "");
      return what + ": " + money(d.v) + ", " + pct(d.share) + " of flagged premium, " + count(d.windows) + " " + plural(d.windows, "window", "windows") + "." + lean + (d.ticker ? " Opens the " + d.ticker + " page." : "");
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
            ? h("a", { class: "fn-hit", href: "/flows/ticker/?t=" + encodeURIComponent(d.ticker), "data-id": n.id })
            : h("button", { class: "fn-hit", type: "button", "aria-pressed": "false", "data-id": n.id });
          const id = n.id;
          el.addEventListener("pointerenter", () => { hoverId = id; relight(); });
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
      tip.replaceChildren(...[
        h("b", null, d.ticker || d.label),
        h("span", null, (d.ticker ? (d.sec || "No sector") + " " + MID + " " : d.full && d.full !== d.label ? d.full + " " + MID + " " : "") + count(d.windows) + " " + plural(d.windows, "window", "windows")),
        h("span", { class: "fn-tip-v" }, h("strong", null, money(d.v)), " " + pct(d.share) + " of flagged premium"),
        d.members && d.members.length ? h("span", null, d.members.slice(0, 6).join(", ") + (d.members.length > 6 ? " and " + (d.members.length - 6) + " more" : "")) : null,
        lean.length ? h("span", { class: "fn-tip-l" }, lean.map(([g, v]) => h("i", { "data-g": g }, UI.glyph(g), v))) : null,
        d.ticker ? h("span", { class: "fn-tip-go" }, "Open " + d.ticker + " →") : null].filter(Boolean));
      tip.hidden = false;
      placeTip();
    }
    function placeTip() {
      if (!tipId || tip.hidden) return;
      const n = N.get(tipId);
      if (!n) return;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      const r = n.cr * n.ps;
      const lb = n.lb && !VERT && n.lb[0] > n.px ? n.lb[0] + n.lb[2] + 8 : n.px + r + 14;
      let x = lb, y = n.py - th / 2;
      if (x + tw > W - 6) x = (n.lb && !VERT && n.lb[0] < n.px ? n.lb[0] : n.px - r) - 10 - tw;
      x = clamp(x, 6, Math.max(6, W - tw - 6));
      y = clamp(y, 6, Math.max(6, H - th - 6));
      tip.style.transform = "translate(" + x.toFixed(0) + "px," + y.toFixed(0) + "px)";
    }

    function rebuild() {
      compact = (stage.clientWidth || host.clientWidth || 640) < 560;
      M = S.rows.length ? model(S.rows, { out: mode, names: cfg.names || (compact ? clamp(Math.floor((stage.clientWidth || 300) / 44), 5, 9) : 10), session: S.session, sectorOf: secFn(), unread: U.state === "fail" }) : null;
      if (M && !M.windows) M = null;
      const was = new Map(N);
      N.clear();
      E = []; MESH = []; P = []; CUM = [];
      if (M) {
        for (const layer of M.layers) {
          for (const d of layer) {
            const n = was.get(d.id) || { id: d.id, x: 0, y: 0, z: 0, cr: 0, lit: 1, tl: 1, energy: 0, ripple: 0, px: 0, py: 0, ps: 1, pz: 0, fog: 1, born: true };
            n.d = d;
            n.col = nodeCol(d);
            n.cs = rgba(n.col, 1);
            const lean = d.layer === 1 || !d.v ? 0 : (d.bull - d.bear) / d.v;
            n.spr = d.layer === 1 ? 2 : lean > 0.2 ? 0 : lean < -0.2 ? 1 : 2;
            N.set(d.id, n);
          }
        }
        const byKey = new Map();
        M.edges.forEach((hop) => hop.forEach((e) => {
          const r = { a: N.get(e.a), b: N.get(e.b), v: e.v, share: e.v / M.total, col: leanCol(e.bull, e.bear, e.nx), lit: 1, tl: 1, fv: 0, fb: 0, fr: 0, fn: 0, fcol: null };
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
      size();
      for (const n of N.values()) {
        n.r = (compact ? 3.6 : 4.6) + (compact ? 10 : 15) * Math.sqrt(n.d.share);
        n.d.labelSprite = nodeLabel(n);
      }
      CAPS = CAPTIONS[mode].map((t) => label([{ t: t.toUpperCase(), f: "650 " + (VERT ? 9 : 10) + "px", lh: 12, c: "rgba(235,235,245,0.5)", ls: "0.12em" }]));
      place();
      for (const n of N.values()) {
        if (n.born || still) { n.x = n.tx; n.y = n.ty; n.z = n.tz; n.cr = still ? n.r : 0; n.born = false; }
      }
      cv.setAttribute("aria-label", sentence());
      paintLede();
      paintTable();
      buildHits();
      const st = S.st || { state: "pending" };
      if (M) { empty.hidden = true; ghosts = null; }
      else {
        const def = UI.STATES[st.state] || UI.STATES.pending;
        const word = { ok: "Nothing flagged", quiet: "Nothing flagged", pending: "Reading", unavailable: "Unavailable" }[st.state] || def.word;
        empty.replaceChildren(UI.glyph(def.g), h("b", null, word), h("span", null, st.reason || "The vendor's rules flagged nothing in this read."));
        empty.dataset.state = st.state;
        empty.hidden = false;
        ghostLayout();
      }
      relight();
    }

    function ghostLayout() {
      const counts = [4, 6, 6, 3];
      const vert = (stage.clientWidth || W) < 560;
      cam.cx = W / 2;
      cam.cy = H / 2 + 8;
      cam.kx = cam.ky = 1;
      ghosts = counts.map((n, li) => Array.from({ length: n }, (_, j) => {
        const u = (li / 3 - 0.5) * (vert ? H * 0.62 : W * 0.6), v = (j - (n - 1) / 2) * (vert ? Math.min(W / 7, 56) : Math.min((H - 70) / 6, 56));
        return vert ? { x: v, y: u, z: 0 } : { x: u, y: v, z: 0 };
      }));
    }

    function size() {
      const w = stage.clientWidth || host.clientWidth || 640;
      compact = w < 560;
      VERT = compact;
      FF = getComputedStyle(host).fontFamily || FF;
      const most = M ? Math.max(...M.layers.map((l) => l.length)) : 6;
      const hgt = Math.round(VERT ? clamp(w * 1.45, 440, 560) : clamp(Math.max(w * 0.42, most * 30 + 110), 440, 640));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      if (w !== W || hgt !== H || cv.width !== Math.round(w * dpr)) {
        W = w; H = hgt;
        stage.style.height = H + "px";
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
        seedDust();
      }
      cam.f = Math.max(VERT ? H : W, 520) * 1.4;
    }

    function place() {
      if (!M) return;
      const most = Math.max(...M.layers.map((l) => l.length));
      const lw = (layer) => layer.reduce((m, d) => Math.max(m, d.labelSprite ? d.labelSprite.w : 0), 0);
      const lh = (layer) => layer.reduce((m, d) => Math.max(m, d.labelSprite ? d.labelSprite.h : 0), 0);
      let u0, u1, v0, v1;
      if (VERT) {
        u0 = lh(M.layers[0]) * 2 + 30; u1 = H - lh(M.layers[3]) * (M.layers[3].length > 3 ? 2 : 1) - 18; v0 = 22; v1 = W - 6;
      } else {
        u0 = lw(M.layers[0]) + 26; u1 = W - lw(M.layers[3]) - 26; v0 = 34; v1 = H - 20;
      }
      const hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
      cam.hu = hu;
      cam.hv = hv;
      cam.dish = (VERT ? H : W) * 0.13;
      cam.bowl = (VERT ? W : H) * 0.12;
      cam.cx = VERT ? (v0 + v1) / 2 : (u0 + u1) / 2;
      cam.cy = VERT ? (u0 + u1) / 2 : (v0 + v1) / 2;
      const span = v1 - v0;
      M.layers.forEach((layer, li) => {
        const u = (li / 3 - 0.5) * 2 * hu;
        const g = Math.min(span / Math.max(1, layer.length), VERT ? 92 : most > 6 ? span / most * 1.3 : 78);
        layer.forEach((d, j) => {
          const n = N.get(d.id), v = (j - (layer.length - 1) / 2) * g;
          n.tx = VERT ? v : u;
          n.ty = VERT ? u : v;
          n.tz = zOf(u, v);
        });
      });
      cam.kx = cam.ky = 1;
      let mx = 1, my = 1;
      for (const yaw of [-17, 17]) for (const pitch of [-13, -1]) {
        setCam(yaw * DEG, pitch * DEG);
        for (const n of N.values()) {
          const p = proj(n.tx, n.ty, n.tz);
          mx = Math.max(mx, Math.abs(p[0] - cam.cx) / (VERT ? hv + 4 : hu));
          my = Math.max(my, Math.abs(p[1] - cam.cy) / (VERT ? hu : hv + 4));
        }
      }
      cam.kx = 1 / mx;
      cam.ky = 1 / my;
      M.layers.forEach((layer) => {
        const ws = layer.map((d) => (d.labelSprite ? (VERT ? d.labelSprite.w : d.labelSprite.h) : 0));
        let tight = false;
        for (let j = 1; j < layer.length; j++) {
          const a = N.get(layer[j - 1].id), b = N.get(layer[j].id);
          const room = VERT ? (b.tx - a.tx) * cam.kx : (b.ty - a.ty) * cam.ky;
          if ((ws[j - 1] + ws[j]) / (VERT ? 2 : 2) > room - 3) tight = true;
        }
        layer.forEach((d, j) => { N.get(d.id).tier = tight && j % 2 ? 1 : 0; });
      });
      cam.zMin = -cam.dish * 0.4;
      cam.zMax = cam.dish + cam.bowl;
    }
    const zOf = (u, v) => cam.dish * (1 - (u / cam.hu) * (u / cam.hu)) + cam.bowl * (v / cam.hv) * (v / cam.hv);

    function setCam(yaw, pitch) {
      cam.cyw = Math.cos(yaw); cam.syw = Math.sin(yaw); cam.cp = Math.cos(pitch); cam.sp = Math.sin(pitch);
    }
    const PJ = [0, 0, 1, 0];
    function proj(X, Y, Z) {
      X *= cam.kx; Y *= cam.ky;
      const x1 = X * cam.cyw - Z * cam.syw, z1 = X * cam.syw + Z * cam.cyw;
      const y2 = Y * cam.cp - z1 * cam.sp, z2 = Y * cam.sp + z1 * cam.cp;
      const s = cam.f / (cam.f + z2);
      PJ[0] = cam.cx + x1 * s; PJ[1] = cam.cy + y2 * s; PJ[2] = s; PJ[3] = z2;
      return PJ;
    }

    function seedDust() {
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      DUST = Array.from({ length: compact ? 40 : 70 }, () => [(rnd() - 0.5) * W * 1.1, (rnd() - 0.5) * H * 1.1, (rnd() - 0.2) * W * 0.6, 0.4 + rnd() * 0.9]);
    }

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

    function step(dt, now) {
      const t = now / 1000;
      par.x += (par.tx - par.x) * Math.min(1, dt * 3);
      par.y += (par.ty - par.y) * Math.min(1, dt * 3);
      setCam((10 * Math.sin(t * TAU / 46) + par.x * 6) * DEG, (-7 + 1.6 * Math.sin(t * TAU / 61) + par.y * 4) * DEG);
      focusAmt += (focusTarget - focusAmt) * Math.min(1, dt * 7);
      const ease = Math.min(1, dt * 6), grow = Math.min(1, dt * 5);
      for (const n of N.values()) {
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
      out[2] = a.ps + (b.ps - a.ps) * t;
      return out;
    }
    function curve(c, ax, ay, bx, by) {
      c.moveTo(ax, ay);
      if (VERT) { const k = (by - ay) * 0.5; c.bezierCurveTo(ax, ay + k, bx, by - k, bx, by); }
      else { const k = (bx - ax) * 0.5; c.bezierCurveTo(ax + k, ay, bx - k, by, bx, by); }
    }
    const fog = (z) => clamp(1.12 - (z - cam.zMin) / (cam.zMax - cam.zMin || 1) * 0.5, 0.5, 1);
    const B1 = [0, 0, 1], B2 = [0, 0, 1];

    function draw() {
      const c = ctx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.5;
      c.drawImage(SPR.core, cam.cx - W * 0.42, cam.cy - H * 0.5, W * 0.84, H);
      c.globalAlpha = 1;
      if (ghosts) { drawGhosts(c); c.globalCompositeOperation = "source-over"; return; }
      for (const n of N.values()) {
        const p = proj(n.x, n.y, n.z);
        n.px = p[0]; n.py = p[1]; n.ps = p[2]; n.pz = p[3]; n.fog = fog(p[3]);
      }
      if (!still && DUST.length) {
        c.fillStyle = "rgba(170,190,235,0.28)";
        c.beginPath();
        for (const d of DUST) {
          const p = proj(d[0] / cam.kx, d[1] / cam.ky, d[2]);
          const r = d[3] * p[2];
          c.rect(p[0] - r / 2, p[1] - r / 2, r, r);
        }
        c.fill();
      }
      const dim = 1 - 0.82 * focusAmt;
      if (M) {
        c.lineWidth = 1;
        const T = (VERT ? H : W) * 0.05, pad = 34 / (VERT ? cam.kx : cam.ky);
        for (let li = 0; li < 4; li++) {
          const L = M.layers[li], a = N.get(L[0].id), b = N.get(L[L.length - 1].id), u = VERT ? a.y : a.x;
          const va = (VERT ? a.x : a.y) - pad, vb = (VERT ? b.x : b.y) + pad, zc = zOf(u, 0) + cam.bowl * 0.3;
          c.beginPath();
          for (const [v, dz] of [[va, -T], [va, T], [vb, T], [vb, -T]]) {
            const p = VERT ? proj(v, u, zc + dz) : proj(u, v, zc + dz);
            c.lineTo(p[0], p[1]);
          }
          c.closePath();
          c.fillStyle = "rgba(110,150,255,0.035)";
          c.fill();
          c.strokeStyle = "rgba(170,200,255,0.11)";
          c.stroke();
        }
        c.strokeStyle = "rgba(150,175,225," + (0.075 * (1 - 0.7 * focusAmt)).toFixed(3) + ")";
        c.beginPath();
        for (const [a, b] of MESH) curve(c, a.px, a.py, b.px, b.py);
        c.stroke();
        const wmax = compact ? 11 : 17;
        for (let pass = 0; pass < 2; pass++) {
          for (const e of E) {
            const a = e.a, b = e.b;
            const sh = e.share + ((e.fv / M.total) - e.share) * focusAmt * (e.tl ? 1 : 0);
            const lit = e.lit + (1 - e.lit) * (1 - focusAmt);
            const al = (dim + (1 - dim) * lit) * (a.fog + b.fog) * 0.5;
            const w = (0.6 + wmax * Math.pow(sh, 0.8)) * (a.ps + b.ps) * 0.5;
            c.strokeStyle = e.tl && focusAmt > 0.01 ? e.fcs : e.cs;
            c.globalAlpha = al * (pass ? 0.42 + 0.4 * lit * focusAmt : 0.09);
            c.lineWidth = pass ? w : w * 3.2 + 3;
            c.beginPath();
            curve(c, a.px, a.py, b.px, b.py);
            c.stroke();
          }
        }
        c.globalAlpha = 1;
        if (!still && pn) drawPulses(c, dim);
        drawNodes(c, dim);
      }
      c.globalCompositeOperation = "source-over";
    }

    const BK = Array.from({ length: 12 }, () => ({ n: 0, a: new Float32Array(1600) }));
    const LW = [[3.2, 1], [4.6, 1.5], [6.4, 2.1]];
    function drawPulses(c, dim) {
      for (const b of BK) b.n = 0;
      c.lineCap = "round";
      for (let i = 0; i < pn; i++) {
        const q = pulses[i];
        if (q.u < 0) continue;
        const hop = q.u < 1 ? 0 : q.u < 2 ? 1 : 2, t = q.u - hop, e = q.p.e[hop];
        bez(e, t, B1);
        bez(e, t > 0.13 ? t - 0.13 : 0, B2);
        if (q.hot) {
          const s = 13 * q.z * B1[2];
          c.globalAlpha = 1;
          c.drawImage(SPR.hot, B1[0] - s, B1[1] - s, s * 2, s * 2);
        }
        const b = BK[(q.p.lit ? q.p.c : 3) * 3 + (q.z > 0.95 ? 2 : q.z > 0.7 ? 1 : 0)];
        if (b.n >= 1596) continue;
        b.a[b.n++] = B2[0]; b.a[b.n++] = B2[1]; b.a[b.n++] = B1[0]; b.a[b.n++] = B1[1];
      }
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < 12; k++) {
          const b = BK[k];
          if (!b.n) continue;
          const ci = (k / 3) | 0;
          c.strokeStyle = PCOL[ci];
          c.globalAlpha = (pass ? 0.92 : 0.17) * (ci === 3 ? dim * 0.6 : 1);
          c.lineWidth = LW[k % 3][pass];
          c.beginPath();
          for (let i = 0; i < b.n; i += 4) { c.moveTo(b.a[i], b.a[i + 1]); c.lineTo(b.a[i + 2], b.a[i + 3]); }
          c.stroke();
        }
      }
      c.lineCap = "butt";
      c.globalAlpha = 1;
    }

    function drawNodes(c, dim) {
      NL.sort((a, b) => b.pz - a.pz);
      const RW = [0, 1, 2, 3].map(() => ({ y: 0, n: 0, r: 0, h: 0 }));
      for (const n of NL) {
        const w = RW[n.d.layer];
        w.y += n.py; w.n++; w.r = Math.max(w.r, n.cr * n.ps); w.h = Math.max(w.h, n.d.labelSprite ? n.d.labelSprite.h : 0);
      }
      for (const n of NL) {
        const lit = n.lit + (1 - n.lit) * (1 - focusAmt);
        const al = (dim + (1 - dim) * lit) * n.fog;
        const r = n.cr * n.ps;
        if (r < 0.3) continue;
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = al * (0.38 + 0.5 * n.energy);
        const g = r * (3 + 1.6 * n.energy);
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
        c.globalAlpha = al;
        c.fillStyle = "rgba(9,12,20,0.94)";
        c.beginPath();
        c.arc(n.px, n.py, r, 0, TAU);
        c.fill();
        c.globalAlpha = al * (0.28 + 0.55 * n.energy);
        c.fillStyle = n.cs;
        c.beginPath();
        c.arc(n.px, n.py, r * 0.62, 0, TAU);
        c.fill();
        c.globalAlpha = al * 0.95;
        c.strokeStyle = n.cs;
        c.lineWidth = n.id === focusId || n.id === pinId ? 2.4 : 1.5;
        c.beginPath();
        c.arc(n.px, n.py, r, 0, TAU);
        c.stroke();
        if (n.id === focusId || n.id === hoverId || n.id === pinId) {
          c.strokeStyle = "rgba(245,245,247,0.9)";
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(n.px, n.py, r + 5, 0, TAU);
          c.stroke();
        }
        const L = n.d.labelSprite;
        if (L) {
          const lx = VERT ? clamp(n.px - L.w / 2, 2, W - L.w - 2) : n.d.layer === 0 || (n.tier && n.d.layer < 3) ? n.px - r - 6 - L.w : n.px + r + 4;
          const rw = RW[n.d.layer], ry = rw.y / rw.n;
          const ly = !VERT ? clamp(n.py - L.h / 2, 2, H - L.h - 2) : n.d.layer === 0 ? ry - rw.r - 2 - L.h - (n.tier ? rw.h + 2 : 0) : ry + rw.r + 1 + (n.tier ? rw.h + 2 : 0);
          c.globalAlpha = Math.max(0.3, (dim + (1 - dim) * lit) * (0.82 + 0.18 * n.fog));
          c.drawImage(L.c, lx, ly, L.w, L.h);
          n.lb = [lx, ly, L.w, L.h];
        }
      }
      c.globalAlpha = 1;
      M.layers.forEach((layer, li) => {
        const L = CAPS[li];
        let x = 0, y = 0;
        for (const d of layer) { const n = N.get(d.id); x += n.px; y += n.py; }
        x /= layer.length;
        y /= layer.length;
        if (!L) return;
        if (VERT) {
          c.save();
          c.translate(8, y);
          c.rotate(-Math.PI / 2);
          c.drawImage(L.c, -L.w / 2, -L.h / 2, L.w, L.h);
          c.restore();
        } else c.drawImage(L.c, x - L.w / 2, 6, L.w, L.h);
      });
    }

    function drawGhosts(c) {
      setCam(-6 * DEG, -7 * DEG);
      const pts = ghosts.map((layer) => layer.map((g) => { const p = proj(g.x, g.y, g.z); return [p[0], p[1]]; }));
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = "rgba(160,180,220,0.09)";
      c.lineWidth = 1;
      c.beginPath();
      const was = VERT;
      VERT = W < 560;
      for (let i = 0; i < 3; i++) for (const a of pts[i]) for (const b of pts[i + 1]) curve(c, a[0], a[1], b[0], b[1]);
      VERT = was;
      c.stroke();
      for (const layer of pts) for (const p of layer) {
        c.fillStyle = "rgba(9,12,20,0.9)";
        c.beginPath();
        c.arc(p[0], p[1], 7, 0, TAU);
        c.fill();
        c.strokeStyle = "rgba(160,180,220,0.28)";
        c.stroke();
      }
    }

    function paint() {
      if (!COL) colors();
      if (still || !raf) {
        setCam(-6 * DEG, -7 * DEG);
        focusAmt = focusTarget;
        for (const n of N.values()) { n.lit = n.tl; if (still) { n.x = n.tx; n.y = n.ty; n.z = n.tz; n.cr = n.r; } }
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
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      step(dt, now);
      draw();
      placeHits(false);
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

    stage.addEventListener("pointermove", (e) => {
      const r = stage.getBoundingClientRect();
      par.tx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1);
      par.ty = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1);
    });
    stage.addEventListener("pointerleave", () => { par.tx = 0; par.ty = 0; });
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
    ghostLayout();
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
      labels: () => [...N.values()].filter((n) => n.lb).map((n) => ({ id: n.id, x: n.lb[0], y: n.lb[1], w: n.lb[2], h: n.lb[3] })),
      node: (id) => { const n = N.get(id); return n ? { x: n.px, y: n.py, r: n.cr * n.ps, lit: n.tl, label: n.d.label } : null; },
    };
    NETS.set(host, api);
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, UI, {
    net: Object.freeze({ model, mount, of: (el) => NETS.get(el) || null }),
  }));
})();
