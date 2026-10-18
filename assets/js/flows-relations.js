(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const { h, F } = UI;
  const DASH = UI.DASH, MINUS = UI.MINUS || "−";
  const SVGNS = "http://www.w3.org/2000/svg";
  const MOUNTS = new WeakMap();

  const LAYERS = Object.freeze({
    A: { name: "Active together", lead: "Flagged premium per ten minutes, whatever its direction." },
    L: { name: "Lean together", lead: "Net bullish premium per ten minutes: calls on the ask side and puts on the bid side minus the reverse, by convention." },
  });
  const DEF = Object.freeze({ binMin: 10, names: 12, minBins: 20, minActive: 4, minWindows: 40, minCorr: 0.3 });
  const isNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const money = (v) => F.money(v);
  const SIGNS = { "-1": MINUS, "1": "+", "0": "" }, TONES = { "-1": "neg", "1": "pos", "0": "flat" };
  const sgn = (r, dp) => SIGNS[Math.sign(r)] + Math.abs(r).toFixed(dp === undefined ? 2 : dp);

  function pearson(x, y) {
    const n = x.length;
    if (n < 3) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    if (!(sxx > 0) || !(syy > 0)) return null;
    return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  }
  function fisher(r, n) {
    if (r === null || n < 4) return null;
    const rr = Math.max(-0.999999, Math.min(0.999999, r));
    const z = Math.atanh(rr), se = 1 / Math.sqrt(n - 3);
    return [Math.tanh(z - 1.959963984540054 * se), Math.tanh(z + 1.959963984540054 * se)];
  }

  function model(rows, o = {}) {
    const P = Object.assign({}, DEF, o);
    const parts = [];
    let windows = 0, t0 = Infinity, t1 = -Infinity;
    for (const r of Array.isArray(rows) ? rows : []) {
      const t = r && typeof r.t === "string" && r.t.trim() ? r.t.trim().toUpperCase() : null;
      const prem = isNum(r && r.prem);
      const at = Date.parse((r && (r.spanStart || r.firstAt)) || "");
      if (!t || prem === null || prem <= 0 || !Number.isFinite(at)) continue;
      windows++;
      const sp = r.cp === "C" || r.cp === "P" ? F.askSplit(r) : null;
      const lean = sp ? (r.cp === "C" ? sp.ask - sp.bid : sp.bid - sp.ask) : 0;
      parts.push({ t, at, prem, lean });
      if (at < t0) t0 = at;
      if (at > t1) t1 = at;
    }
    const base = { layers: LAYERS, params: P, windows, bins: 0, names: [], pairs: { A: [], L: [] }, status: "ok", reason: null };
    if (!windows) return Object.assign(base, { status: "quiet", reason: "No flagged window carries a premium and a time." });
    const binMs = P.binMin * 60000;
    const b0 = Math.floor(t0 / binMs), B = Math.floor(t1 / binMs) - b0 + 1;
    base.bins = B;
    base.from = t0;
    base.to = t1;
    const ser = new Map();
    for (const p of parts) {
      let s = ser.get(p.t);
      if (!s) ser.set(p.t, s = { t: p.t, A: new Array(B).fill(0), L: new Array(B).fill(0), prem: 0, active: new Set() });
      const b = Math.floor(p.at / binMs) - b0;
      s.A[b] += p.prem;
      s.L[b] += p.lean;
      s.prem += p.prem;
      s.active.add(b);
    }
    const cand = [...ser.values()].filter((s) => s.active.size >= P.minActive).sort((a, b) => b.prem - a.prem || (a.t < b.t ? -1 : 1)).slice(0, P.names);
    base.names = cand.map((s) => ({ t: s.t, prem: s.prem, active: s.active.size }));
    base.series = cand;
    if (windows < P.minWindows || B < P.minBins || cand.length < 3) {
      return Object.assign(base, { status: "thin", reason: windows + " flagged windows over " + B + " ten-minute bins on " + cand.length + " names with at least " + P.minActive + " active bins; relations need " + P.minWindows + " windows, " + P.minBins + " bins and 3 names." });
    }
    const half = Math.floor(B / 2);
    for (const L of ["A", "L"]) {
      for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
        const x = cand[i][L], y = cand[j][L];
        const r = pearson(x, y);
        const ci = fisher(r, B);
        const r1 = pearson(x.slice(0, half), y.slice(0, half)), r2 = pearson(x.slice(half), y.slice(half));
        const sameSign = r1 !== null && r2 !== null && Math.sign(r1) === Math.sign(r) && Math.sign(r2) === Math.sign(r);
        const passed = r !== null && ci !== null && (ci[0] > 0 || ci[1] < 0) && Math.abs(r) >= P.minCorr;
        base.pairs[L].push({ a: cand[i].t, b: cand[j].t, r, lo: ci ? ci[0] : null, hi: ci ? ci[1] : null, n: B, r1, r2, passed, stable: passed && sameSign });
      }
      base.pairs[L].sort((p, q) => (q.stable - p.stable) || (q.passed - p.passed) || (Math.abs(q.r || 0) - Math.abs(p.r || 0)) || (p.a + p.b < q.a + q.b ? -1 : 1));
    }
    return base;
  }

  const svg = (tag, attrs, ...kids) => {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    for (const c of kids.flat(2)) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : String(c));
    return n;
  };

  function sectorOf(u) {
    const map = new Map();
    if (u && u.status === "ok" && Array.isArray(u.t) && Array.isArray(u.sec) && Array.isArray(u.sectors)) {
      u.t.forEach((t, i) => map.set(String(t).toUpperCase(), Number.isInteger(u.sec[i]) ? u.sectors[u.sec[i]] || null : null));
      map.ok = true;
    }
    return map;
  }

  function mount(host, opts = {}) {
    if (!host) return null;
    const prev = MOUNTS.get(host);
    if (prev) prev.destroy();
    const secs = sectorOf(opts.universe);
    let layer = "A", M = null, st = { state: "pending", reason: "Reading the flagged windows." }, read = null, session = null, sel = null, pane = "ring", W = 0, H = 0, dead = false;
    const stats = h("p", { class: "rl-stats" });
    const readEl = h("p", { class: "rl-read", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const layerSeg = h("div", { class: "rl-seg", role: "group", "aria-label": "Which relation" },
      Object.keys(LAYERS).map((k) => h("button", { type: "button", "data-l": k, "aria-pressed": String(k === layer), onclick: () => { layer = k; paint(); } }, LAYERS[k].name)));
    const paneSeg = h("div", { class: "rl-seg rl-panes", role: "group", "aria-label": "Ring or pairs" },
      ["ring", "pairs"].map((k) => h("button", { type: "button", "data-p": k, "aria-pressed": String(k === pane), onclick: () => { pane = k; paint(); } }, k === "ring" ? "Ring" : "Pairs")));
    const ringBox = h("div", { class: "rl-ring" });
    const listBox = h("div", { class: "rl-list" });
    const body = h("div", { class: "rl-body" }, ringBox, listBox);
    const note = h("p", { class: "rl-note" });
    const dlg = h("dialog", { class: "nm-dlg", "aria-labelledby": "rlDlgT" });
    const wrap = h("div", { class: "rl", "data-state": "pending" }, h("div", { class: "rl-bar" }, layerSeg, paneSeg, stats), readEl, body, note, dlg);
    host.replaceChildren(wrap);

    const secName = (t) => (secs.ok ? secs.get(t) || "No sector" : "Sector unread");
    const rLine = (p) => p.a + " and " + p.b + ": r " + sgn(p.r) + ", 95% interval " + sgn(p.lo) + " to " + sgn(p.hi) + " over " + p.n + " bins; first half " + (p.r1 === null ? DASH : sgn(p.r1)) + ", second half " + (p.r2 === null ? DASH : sgn(p.r2));

    function pairsList() {
      const all = M.pairs[layer];
      const shown = all.filter((p) => p.stable);
      return { all, shown };
    }

    function ringDraw() {
      const names = M.names.map((n) => n.t);
      const order = names.slice().sort((a, b) => (secName(a) < secName(b) ? -1 : secName(a) > secName(b) ? 1 : M.names.find((n) => n.t === b).prem - M.names.find((n) => n.t === a).prem));
      const w = Math.max(200, ringBox.clientWidth || W), hh = Math.max(200, ringBox.clientHeight || H);
      const cx = w / 2, cy = hh / 2, rx = Math.max(40, w / 2 - 96), ry = Math.max(40, hh / 2 - 56);
      const pos = new Map();
      order.forEach((t, i) => { const a = -Math.PI / 2 + (i / order.length) * Math.PI * 2; pos.set(t, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), a }); });
      const s = svg("svg", { class: "rl-svg", width: w, height: hh, viewBox: "0 0 " + w + " " + hh, role: "group", "aria-label": "Names that moved together, on a ring grouped by sector. Only pairs whose interval excludes zero and holds in both halves are drawn." });
      const { shown } = pairsList();
      const lit = (p) => !sel || p.a === sel || p.b === sel;
      for (const p of shown) {
        const A = pos.get(p.a), B = pos.get(p.b);
        s.append(svg("path", { d: "M" + A.x + " " + A.y + " Q" + cx + " " + cy + " " + B.x + " " + B.y, fill: "none", class: "rl-edge " + TONES[Math.sign(p.r)] + (lit(p) ? "" : " off"), "stroke-width": (1 + 4 * Math.abs(p.r)).toFixed(2) },
          svg("title", null, rLine(p))));
      }
      for (const t of order) {
        const q = pos.get(t), right = Math.cos(q.a) >= 0;
        const g = svg("g", { class: "rl-node" + (sel === t ? " is-sel" : ""), role: "button", tabindex: "0", "aria-pressed": String(sel === t), "data-t": t, "aria-label": t + ", " + secName(t) + ", " + money(M.names.find((n) => n.t === t).prem) + " flagged" },
          svg("circle", { cx: q.x, cy: q.y, r: 7, class: "rl-dot" }),
          svg("text", { x: q.x + (Math.abs(Math.cos(q.a)) < 0.2 ? 0 : right ? 12 : -12), y: q.y + (Math.sin(q.a) > 0.3 ? 22 : Math.sin(q.a) < -0.3 ? -12 : 4), "text-anchor": Math.abs(Math.cos(q.a)) < 0.2 ? "middle" : right ? "start" : "end", class: "rl-lb" }, t),
          svg("text", { x: q.x + (Math.abs(Math.cos(q.a)) < 0.2 ? 0 : right ? 12 : -12), y: q.y + (Math.sin(q.a) > 0.3 ? 34 : Math.sin(q.a) < -0.3 ? -24 : 16), "text-anchor": Math.abs(Math.cos(q.a)) < 0.2 ? "middle" : right ? "start" : "end", class: "rl-sc" }, secName(t)),
          svg("title", null, t + " (" + secName(t) + "): " + money(M.names.find((n) => n.t === t).prem) + " flagged"));
        s.append(g);
      }
      ringBox.replaceChildren(s);
    }

    function listDraw() {
      const { all, shown } = pairsList();
      const cap = Math.max(3, Math.floor(((listBox.clientHeight || H) - 64) / 36));
      const rows = (sel ? shown.filter((p) => p.a === sel || p.b === sel) : shown);
      const top = rows.slice(0, cap);
      const head = h("div", { class: "rl-lh" }, shown.length ? shown.length + plural(shown.length, " tested pair", " tested pairs") + " of " + all.length : "No pair passed", sel ? h("button", { type: "button", class: "nm-link", onclick: () => { sel = null; paint(); } }, "Clear " + sel) : null);
      const li = top.map((p) => h("button", { type: "button", class: "rl-pair", onclick: () => { sel = sel === p.a ? p.b : p.a; paint(); }, "aria-label": rLine(p) },
        h("span", { class: "rl-pn" }, p.a + " ↔ " + p.b), h("span", { class: "rl-ps", title: secName(p.a) + " / " + secName(p.b) }, secName(p.a) + (secName(p.a) === secName(p.b) ? "" : " / " + secName(p.b))),
        h("span", { class: "rl-pr " + TONES[Math.sign(p.r)] }, sgn(p.r)), h("span", { class: "rl-pi" }, "[" + sgn(p.lo) + ", " + sgn(p.hi) + "]")));
      const more = rows.length > top.length ? h("button", { type: "button", class: "nm-link", "aria-haspopup": "dialog", onclick: () => full(rows) }, "Show all " + rows.length) : null;
      const none = !rows.length ? h("p", { class: "rl-none" }, shown.length ? sel + " has no tested pair in this layer." : "No pair has an interval clear of zero that holds in both halves of the session. That is a statement about this read, not about the market.") : null;
      listBox.replaceChildren(...[head, h("div", { class: "rl-pairs" }, li), none, more].filter(Boolean));
    }
    const plural = (k, one, many) => (k === 1 ? one : many);

    function full(rows) {
      dlg.replaceChildren(h("div", { class: "nm-dg" }, h("h3", { id: "rlDlgT" }, LAYERS[layer].name + ": " + rows.length + " tested pairs"),
        h("p", null, "Pearson r over " + M.bins + " ten-minute bins, its 95% Fisher interval, and r in each half of the window. Only pairs whose interval excludes zero and holds in both halves are listed."),
        h("div", { class: "nm-dtw" }, h("table", { class: "nm-tbl" },
          h("thead", null, h("tr", null, ["Pair", "Sectors", "r", "95% interval", "First half", "Second half"].map((c, i) => h("th", { scope: "col", class: i > 1 ? "c-num" : null }, c)))),
          h("tbody", null, rows.map((p) => h("tr", null, h("th", { scope: "row" }, p.a + " ↔ " + p.b), h("td", null, secName(p.a) + " / " + secName(p.b)), h("td", { class: "c-num" }, sgn(p.r)), h("td", { class: "c-num" }, sgn(p.lo) + " to " + sgn(p.hi)), h("td", { class: "c-num" }, p.r1 === null ? DASH : sgn(p.r1)), h("td", { class: "c-num" }, p.r2 === null ? DASH : sgn(p.r2))))))),
        h("div", { class: "nm-dx" }, h("button", { type: "button", class: "nm-link", onclick: () => dlg.close() }, "Close"))));
      if (typeof dlg.showModal === "function") dlg.showModal();
    }

    function silent(kind, text) {
      wrap.dataset.state = kind;
      ringBox.replaceChildren(h("p", { class: "nm-empty", "data-empty": kind }, text));
      listBox.replaceChildren();
      stats.textContent = DASH;
      readEl.textContent = text;
      note.textContent = "";
    }

    function paint() {
      for (const b of layerSeg.children) b.setAttribute("aria-pressed", String(b.dataset.l === layer));
      for (const b of paneSeg.children) b.setAttribute("aria-pressed", String(b.dataset.p === pane));
      wrap.dataset.pane = pane;
      if (!M) return;
      wrap.dataset.state = "ok";
      ringDraw();
      listDraw();
      const { shown } = pairsList();
      stats.textContent = M.windows + " windows · " + M.bins + " bins · " + M.names.length + " names" + (read ? " · read " + F.time(read) : "") + (session ? " · session " + F.day(session) : "");
      readEl.textContent = (sel ? sel + " (" + secName(sel) + "): " + (shown.filter((p) => p.a === sel || p.b === sel).map((p) => (p.a === sel ? p.b : p.a) + " " + sgn(p.r)).join(", ") || "no tested pair") + ". "
        : LAYERS[layer].lead + " ") + shown.length + " of " + M.pairs[layer].length + " pairs pass.";
      const total = M.pairs[layer].length, chance = Math.max(1, Math.round(total * 0.05));
      note.textContent = "Descriptive, from flagged windows only: a name with no window in a bin counts as zero, and windows arrive in bursts, so the interval is narrower than the truth. Each pair is tested alone at 95%, so about " + chance + " of these " + total + " would pass by chance. Not a forecast.";
    }

    function rebuild() {
      if (dead) return;
      W = host.clientWidth; H = host.clientHeight;
      if (st.state !== "ok") { M = null; silent(st.state === "pending" ? "pending" : "unavailable", (st.state === "pending" ? "Reading: " : "Unavailable: ") + (st.reason || "")); return; }
      M = model(rowsNow);
      if (M.status !== "ok") { const k = M; M = null; silent("quiet", "Not enough to relate: " + k.reason); return; }
      if (sel && !M.names.some((n) => n.t === sel)) sel = null;
      paint();
    }
    let rowsNow = [];

    wrap.addEventListener("click", (ev) => {
      const g = ev.target.closest && ev.target.closest(".rl-node");
      if (!g) return;
      sel = sel === g.dataset.t ? null : g.dataset.t;
      paint();
    });
    wrap.addEventListener("keydown", (ev) => {
      const g = ev.target.closest && ev.target.closest(".rl-node");
      if (!g || (ev.key !== "Enter" && ev.key !== " ")) return;
      ev.preventDefault();
      sel = sel === g.dataset.t ? null : g.dataset.t;
      paint();
      const a = ringBox.querySelector('.rl-node[data-t="' + g.dataset.t + '"]');
      if (a) a.focus();
    });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (M) paint(); }) : null;
    if (ro) ro.observe(host);

    const api = {
      take(alerts, state) {
        const ok = Boolean(alerts && Array.isArray(alerts.rows));
        st = ok ? { state: "ok" } : state || { state: "pending", reason: "Reading the flagged windows." };
        rowsNow = ok ? alerts.rows : [];
        session = ok && typeof alerts.sessionDate === "string" ? alerts.sessionDate : null;
        read = ok && typeof alerts.readAt === "string" ? alerts.readAt : null;
        rebuild();
      },
      layer(k) { if (LAYERS[k]) { layer = k; paint(); } return layer; },
      select(t) { sel = t; paint(); },
      pane(k) { if (k === "ring" || k === "pairs") { pane = k; paint(); } return pane; },
      model: () => M,
      destroy() { dead = true; if (ro) ro.disconnect(); MOUNTS.delete(host); host.replaceChildren(); },
    };
    MOUNTS.set(host, api);
    silent("pending", "Reading: the flagged windows.");
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, {
    relations: Object.freeze({ mount, model, pearson, fisher, LAYERS, of: (el) => MOUNTS.get(el) || null }),
  }));
})();
