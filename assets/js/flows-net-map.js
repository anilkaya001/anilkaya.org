(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI || !UI.net || typeof UI.net.model !== "function") return;
  const { h, F } = UI;
  const DASH = UI.DASH;
  const SVG = "http://www.w3.org/2000/svg";
  const MAPS = new WeakMap();

  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const money = (v) => F.money(v);
  const pct = (v) => (v > 0 && v < 0.005 ? "<1%" : Math.round(v * 100) + "%");
  const count = (v) => Math.round(v).toLocaleString("en-US");
  const plural = (k, one, many) => (k === 1 ? one : many);

  const LAYER = { lean: ["Sector", "Side", "Name", "Lean"], dte: ["Sector", "Side", "Name", "Expiry"] };
  const LEAN_WORD = { bull: "bullish", bear: "bearish", nx: "unsided" };
  const NS = (tag, attrs, ...kids) => {
    const n = document.createElementNS(SVG, tag);
    if (attrs) for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    for (const c of kids.flat(3)) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  };

  const dom = (n) => (n.bull >= n.bear && n.bull >= n.nx ? "bull" : n.bear >= n.nx ? "bear" : "nx");
  const layerName = (mode, i) => LAYER[mode][i];

  function describe(M, n) {
    const other = n.id === "s:~" || n.id === "n:~";
    const edgesIn = M.edges[n.layer - 1] || [];
    const edgesOut = M.edges[n.layer] || [];
    const label = (id) => {
      for (const l of M.layers) for (const x of l) if (x.id === id) return x.full || x.label;
      return id;
    };
    const ins = edgesIn.filter((e) => e.b === n.id).sort((a, b) => b.v - a.v);
    const outs = edgesOut.filter((e) => e.a === n.id).sort((a, b) => b.v - a.v);
    const list = (es, key) => es.slice(0, 3).map((e) => label(e[key]) + " " + money(e.v)).join(", ") + (es.length > 3 ? ", and " + (es.length - 3) + " more" : "");
    return {
      title: (n.full || n.label) + (n.sec ? " (" + n.sec + ")" : ""),
      layer: layerName(M.mode, n.layer),
      share: n.share,
      total: n.v,
      from: n.layer === 0 ? "the flagged windows" : list(ins, "a"),
      to: n.layer === 3 ? "the end of the path" : list(outs, "b"),
      windows: n.windows,
      contracts: n.contracts,
      other,
      members: n.members,
    };
  }

  function readout(M, n) {
    const d = describe(M, n);
    const parts = [d.title + " · " + d.layer + ": " + money(d.total) + " of " + money(M.total) + " flagged premium, " + pct(d.share)];
    parts.push("from " + d.from);
    parts.push("to " + d.to);
    const bits = [count(d.windows) + plural(d.windows, " window", " windows")];
    if (d.contracts !== null && d.contracts !== undefined) bits.push(count(d.contracts) + plural(d.contracts, " contract", " contracts"));
    else if (n.layer === 0 || n.layer === 2) bits.push("contracts not reported for every window");
    bits.push("lean " + LEAN_WORD[dom(n)] + " by convention");
    return { text: parts.join(" — ") + ". " + bits.join(", ") + ".", d };
  }

  function mount(host, opts = {}) {
    if (!host) return null;
    const prev = MAPS.get(host);
    if (prev) prev.destroy();
    const S = { rows: [], st: { state: "pending", reason: "Reading the flagged windows." }, session: null, readAt: null };
    const U = { map: null, state: opts.sectors ? "ok" : "wait" };
    let mode = "lean", view = "map", layerPick = 2, sel = null, M = null, G = null, dead = false, W = 0, H = 0;
    const ids = { sel: null };
    const secFn = () => (U.state === "ok" ? (t) => (U.map.has(t) ? U.map.get(t) : null) : () => undefined);

    const stats = h("p", { class: "nm-stats" });
    const readEl = h("p", { class: "nm-read", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const modeSeg = h("div", { class: "nm-seg", role: "group", "aria-label": "Where the flow ends" },
      ["lean", "dte"].map((m) => h("button", { type: "button", "data-mode": m, "aria-pressed": String(m === mode), onclick: () => { mode = m; sel = null; rebuild(); } }, m === "lean" ? "By lean" : "By expiry")));
    const viewSeg = h("div", { class: "nm-seg", role: "group", "aria-label": "Map or table" },
      ["map", "table"].map((v) => h("button", { type: "button", "data-view": v, "aria-pressed": String(v === view), onclick: () => { view = v; paint(); } }, v === "map" ? "Map" : "Table")));
    const layerSeg = h("div", { class: "nm-seg nm-layers", role: "group", "aria-label": "Layer shown" });
    const stage = h("div", { class: "nm-stage" });
    const legend = h("div", { class: "nm-legend" });
    const bar = h("div", { class: "nm-bar" }, h("div", { class: "nm-ctl" }, modeSeg, layerSeg, viewSeg), stats);
    const dlg = h("dialog", { class: "nm-dlg", "aria-labelledby": "nmDlgT" });
    const wrap = h("div", { class: "nm", "data-state": "pending" }, bar, readEl, stage, legend, dlg);
    host.replaceChildren(wrap);

    function openList(title, lead, rows) {
      dlg.replaceChildren(
        h("div", { class: "nm-dg" },
          h("h3", { id: "nmDlgT" }, title),
          lead ? h("p", null, lead) : null,
          h("div", { class: "nm-dtw" }, h("table", { class: "nm-tbl" },
            h("thead", null, h("tr", null, rows.heads.map((c, i) => h("th", { scope: "col", class: i ? "c-num" : null }, c)))),
            h("tbody", null, rows.body.map((r) => h("tr", null, r.map((c, i) => h(i ? "td" : "th", { scope: i ? null : "row", class: i && /^[−$\d<]/.test(c) ? "c-num" : null }, c))))))),
          h("div", { class: "nm-dx" }, h("button", { type: "button", class: "nm-link", onclick: () => dlg.close() }, "Close"))));
      if (typeof dlg.showModal === "function") dlg.showModal();
    }

    function membersOf(n) {
      const byT = new Map();
      for (const r of M.top) {
        const key = n.id === "s:~" ? r.sector : r.t;
        byT.set(key, (byT.get(key) || 0) + r.v);
      }
      const rows = n.members.map((m) => [m, byT.get(m) || 0]).sort((a, b) => b[1] - a[1]);
      return rows;
    }
    function drill(n) {
      const rows = membersOf(n);
      const kind = n.id === "s:~" ? "sectors" : "names";
      openList(n.label + ": " + rows.length + " " + kind, "Every " + kind.slice(0, -1) + " folded into this chip, largest first, with its flagged premium and its share of the total.",
        { heads: [kind === "sectors" ? "Sector" : "Name", "Premium", "Share"], body: rows.map(([m, v]) => [m, money(v), pct(M.total ? v / M.total : 0)]) });
    }

    function pathRows() {
      const by = (id) => {
        for (const l of M.layers) for (const x of l) if (x.id === id) return x;
        return null;
      };
      return M.paths.map((p) => {
        const ns = p.ids.map(by);
        return [ns[0].full || ns[0].label, ns[1].label, ns[2].ticker ? ns[2].label : ns[2].label + " (" + ns[2].members.length + ")", ns[3].label, money(p.v), pct(M.total ? p.v / M.total : 0)];
      });
    }

    function fitLayout() {
      const cap0 = 10;
      let cap = cap0, out = null;
      const phone = W < 640;
      const availH = Math.max(120, H - (phone ? 0 : 24));
      for (; cap >= 3; cap--) {
        const m = UI.net.model(S.rows, { out: mode, names: cap, session: S.session, sectorOf: secFn(), unread: U.state === "fail" });
        const maxN = phone ? m.layers[layerPick].length : Math.max(...m.layers.map((l) => l.length));
        const minCh = phone ? 44 : 38;
        if (maxN * minCh + (maxN - 1) * 5 <= availH || cap === 3) { out = m; break; }
      }
      return out;
    }

    function layout() {
      const phone = W < 640;
      const cw = phone ? W : clamp(Math.round(W * 0.2), 150, 230);
      const capY = phone ? 0 : 24;
      const availH = Math.max(120, H - capY);
      const maxN = phone ? M.layers[layerPick].length : Math.max(...M.layers.map((l) => l.length));
      const gap = 5;
      const ch = clamp(Math.floor((availH - (maxN - 1) * gap) / maxN), phone ? 44 : 36, phone ? 48 : 44);
      const two = ch >= 38 || cw < 180;
      const nodes = new Map();
      const colX = (i) => (phone ? 0 : (i * (W - cw)) / 3);
      const vMax = Math.max(...M.layers.flat().map((n) => n.v), 1);
      M.layers.forEach((l, i) => {
        if (phone && i !== layerPick) return;
        const total = l.length * ch + (l.length - 1) * gap;
        const y0 = capY + (availH - total) / 2;
        l.forEach((d, j) => nodes.set(d.id, { d, i, x: colX(i), y: y0 + j * (ch + gap), w: cw, h: ch }));
      });
      const k = (ch * 0.86) / vMax;
      const edges = [];
      if (!phone) {
        M.edges.forEach((es, hop) => {
          const oy = (id) => nodes.get(id).y;
          const sw = (e) => Math.max(1.4, e.v * k);
          const outTot = new Map(), inTot = new Map();
          for (const e of es) { outTot.set(e.a, (outTot.get(e.a) || 0) + sw(e)); inTot.set(e.b, (inTot.get(e.b) || 0) + sw(e)); }
          const pos = new Map();
          const outAt = new Map(), inAt = new Map();
          for (const e of es.slice().sort((p, q) => oy(p.a) - oy(q.a) || oy(p.b) - oy(q.b))) {
            const na = nodes.get(e.a), at = outAt.get(e.a) || 0, w = sw(e);
            outAt.set(e.a, at + w);
            pos.set(e, { ya: na.y + na.h / 2 - outTot.get(e.a) / 2 + at + w / 2, w });
          }
          for (const e of es.slice().sort((p, q) => oy(p.b) - oy(q.b) || oy(p.a) - oy(q.a))) {
            const nb = nodes.get(e.b), at = inAt.get(e.b) || 0, w = sw(e);
            inAt.set(e.b, at + w);
            pos.get(e).yb = nb.y + nb.h / 2 - inTot.get(e.b) / 2 + at + w / 2;
          }
          for (const e of es) {
            const q = pos.get(e);
            edges.push({ hop, a: e.a, b: e.b, v: e.v, w: q.w, ya: q.ya, yb: q.yb, x1: nodes.get(e.a).x + cw, x2: nodes.get(e.b).x, lean: dom(e) });
          }
        });
      }
      return { nodes, edges, cw, ch, two, phone, capY, vMax, k };
    }

    const pathSet = (id) => {
      const nodes = new Set(), edges = new Set();
      for (const p of M.paths) if (p.ids.includes(id)) {
        p.ids.forEach((x) => nodes.add(x));
        for (let i = 0; i < 3; i++) edges.add(p.ids[i] + "|" + p.ids[i + 1]);
      }
      return { nodes, edges };
    };

    function chipText(d, g, wMax) {
      const full = d.full && d.full !== d.label ? d.full : null;
      const fig = money(d.v) + " \u00b7 " + pct(d.share);
      const avail = g.two ? wMax : wMax - ctxW(fig, "400 11px") - 8;
      const folded = d.members && d.members.length ? " (" + d.members.length + ")" : "";
      let label = d.label + folded;
      if (full && ctxW(full, "600 12px") <= avail) label = full;
      return { label, fig, full: full || (folded ? d.members.length + " " + (d.id === "s:~" ? "sectors" : "names") + " folded in" : null) };
    }
    let MC = null;
    const ctxW = (t, font) => {
      if (!MC) MC = document.createElement("canvas").getContext("2d");
      MC.font = font + " " + (getComputedStyle(host).fontFamily || "sans-serif");
      return MC.measureText(t).width;
    };

    function drawMap() {
      G = layout();
      const svg = NS("svg", { class: "nm-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "group", "aria-label": "Flow network: " + LAYER[mode].join(" to ") + ". Select a chip to read where its premium comes from and goes." });
      const lit = sel ? pathSet(sel) : null;
      if (!G.phone) {
        M.layers.forEach((l, i) => {
          const x = (i * (W - G.cw)) / 3;
          svg.append(NS("text", { class: "nm-cap", x: x + 2, y: 14 }, layerName(mode, i) + " · " + money(M.total)));
        });
        const gb = NS("g", { class: "nm-bands" });
        for (const e of G.edges) {
          const xm = (e.x1 + e.x2) / 2;
          const on = lit ? lit.edges.has(e.a + "|" + e.b) : false;
          gb.append(NS("path", { d: "M" + e.x1 + " " + e.ya + " C" + xm + " " + e.ya + " " + xm + " " + e.yb + " " + e.x2 + " " + e.yb, "stroke-width": e.w.toFixed(2), class: "nm-band b-" + e.lean + (lit ? (on ? " is-on" : " is-off") : ""), "data-from": e.a, "data-to": e.b, "data-v": String(Math.round(e.v)), fill: "none" },
            NS("title", null, labelOf(e.a) + " → " + labelOf(e.b) + ": " + money(e.v) + ", " + pct(M.total ? e.v / M.total : 0) + " of the total")));
        }
        svg.append(gb);
      }
      const gc = NS("g", { class: "nm-chips" });
      for (const [id, nd] of G.nodes) {
        const d = nd.d;
        const t = chipText(d, G, nd.w - 18);
        const isOther = id === "s:~" || id === "n:~";
        const on = lit ? lit.nodes.has(id) : true;
        const g = NS("g", {
          class: "nm-chip l" + nd.i + " lean-" + dom(d) + (isOther ? " is-other" : "") + (sel === id ? " is-sel" : "") + (lit && !on ? " is-off" : ""),
          transform: "translate(" + nd.x.toFixed(1) + " " + nd.y.toFixed(1) + ")", role: "button", tabindex: sel === id || (!sel && id === defaultSel()) ? "0" : "-1",
          "aria-pressed": String(sel === id), "data-id": id,
          "aria-label": (d.full || d.label) + ", " + layerName(mode, nd.i) + " layer, " + money(d.v) + ", " + pct(d.share) + " of " + money(M.total) + (isOther ? ", folds in " + d.members.length + " " + (id === "s:~" ? "sectors" : "names") + "; press for the path, then Show members" : ""),
        },
          NS("title", null, (d.full || d.label) + (d.sec ? " (" + d.sec + ")" : "") + ": " + money(d.v) + ", " + pct(d.share) + (isOther ? ". Members: " + d.members.join(", ") : "")),
          NS("rect", { class: "nm-box", width: nd.w, height: nd.h, rx: 7 }));
        const mix = [["bull", d.bull], ["nx", d.nx], ["bear", d.bear]];
        let mx = 0;
        for (const [k, v] of mix) {
          const w = d.v ? (v / d.v) * (nd.w - 12) : 0;
          if (w > 0.2) g.append(NS("rect", { class: "nm-mix m-" + k, x: 6 + mx, y: nd.h - 5, width: w.toFixed(1), height: 3, rx: 1 }));
          mx += w;
        }
        if (G.two) {
          g.append(NS("text", { class: "nm-lb", x: 9, y: nd.h / 2 - 3 }, t.label), NS("text", { class: "nm-fg", x: 9, y: nd.h / 2 + 11 }, t.fig));
        } else {
          g.append(NS("text", { class: "nm-lb", x: 9, y: nd.h / 2 + 3 }, t.label), NS("text", { class: "nm-fg", x: nd.w - 9, y: nd.h / 2 + 3, "text-anchor": "end" }, t.fig));
        }
        gc.append(g);
      }
      svg.append(gc);
      stage.replaceChildren(svg);
    }

    const labelOf = (id) => {
      for (const l of M.layers) for (const x of l) if (x.id === id) return x.full || x.label;
      return id;
    };
    const defaultSel = () => (M.layers[2][0] ? M.layers[2][0].id : M.layers[0][0] ? M.layers[0][0].id : null);

    function drawTable() {
      const rows = pathRows();
      const cap = Math.max(4, Math.floor((H - 40) / 30));
      const shown = rows.slice(0, cap);
      const tb = h("div", { class: "nm-tw" }, h("table", { class: "nm-tbl" },
        h("thead", null, h("tr", null, ["Sector", "Side", "Name", LAYER[mode][3], "Premium", "Share"].map((c, i) => h("th", { scope: "col", class: i > 3 ? "c-num" : null }, c)))),
        h("tbody", null, shown.map((r) => h("tr", null, r.map((c, i) => h(i === 0 ? "th" : "td", { scope: i === 0 ? "row" : null, class: i > 3 ? "c-num" : null }, c)))))));
      const more = rows.length > shown.length
        ? h("button", { type: "button", class: "nm-link", "aria-haspopup": "dialog", onclick: () => openList("All " + rows.length + " paths", "Each path runs from a sector through a side and a name to " + LAYER[mode][3].toLowerCase() + ".", { heads: ["Sector", "Side", "Name", LAYER[mode][3], "Premium", "Share"], body: rows }) }, "Show all " + rows.length)
        : null;
      stage.replaceChildren(...[tb, more].filter(Boolean));
    }

    function legendFill() {
      const k = G ? G.k : 0;
      const ref = G && G.vMax ? niceRef(G.vMax) : null;
      const items = [
        h("span", { class: "nm-lg" }, h("i", { class: "nm-sw s-bull" }), h("i", { class: "nm-sw s-nx" }), h("i", { class: "nm-sw s-bear" }), "Chip base and band colour: bullish, unsided, bearish premium"),
        h("span", { class: "nm-lg" }, h("i", { class: "nm-sw s-band", style: ref && !(G && G.phone) ? { height: Math.max(2, Math.round(ref * k)) + "px" } : null }), ref ? "Band width: premium, this thick is " + money(ref) : "Band width: premium"),
        h("span", { class: "nm-lg" }, h("i", { class: "nm-sw s-other" }), "Dashed chip: Other, opens its members"),
        h("span", { class: "nm-lg" }, h("b", null, "$ \u00b7 %"), "Figure: flagged premium and its share of the total"),
        h("span", { class: "nm-lg nm-conv" }, "Lean is a convention: calls on the ask side and puts on the bid side read bullish, calls on the bid side and puts on the ask side bearish."),
      ];
      if (W < 640) {
        legend.replaceChildren(h("button", { type: "button", class: "nm-link", "aria-haspopup": "dialog", onclick: () => {
          dlg.replaceChildren(h("div", { class: "nm-dg" }, h("h3", { id: "nmDlgT" }, "Legend"), h("div", { class: "nm-lgl" }, items), h("div", { class: "nm-dx" }, h("button", { type: "button", class: "nm-link", onclick: () => dlg.close() }, "Close"))));
          if (typeof dlg.showModal === "function") dlg.showModal();
        } }, "Legend: colours, band width, figures"));
        return;
      }
      legend.replaceChildren(...items);
    }
    const niceRef = (vMax) => {
      const t = vMax / 2;
      const p = Math.pow(10, Math.floor(Math.log10(t)));
      const m = t / p;
      return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
    };

    function layerSegFill() {
      layerSeg.replaceChildren();
      if (W >= 640 || !M || view !== "map") { layerSeg.hidden = true; return; }
      layerSeg.hidden = false;
      LAYER[mode].forEach((name, i) => layerSeg.append(h("button", { type: "button", "aria-pressed": String(i === layerPick), onclick: () => { layerPick = i; paint(); } }, name)));
    }

    function paint() {
      for (const b of modeSeg.children) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
      for (const b of viewSeg.children) b.setAttribute("aria-pressed", String(b.dataset.view === view));
      if (!M) { layerSeg.hidden = true; return; }
      if (!sel) sel = defaultSel();
      layerSegFill();
      if (view === "map") drawMap(); else drawTable();
      const n = (() => { for (const l of M.layers) for (const x of l) if (x.id === sel) return x; return null; })();
      if (n) {
        const r = readout(M, n);
        readEl.replaceChildren(r.text);
        readEl.title = typeof r.text === "string" ? r.text : "";
        if (r.d.other) readEl.append(" ", h("button", { type: "button", class: "nm-link", "aria-haspopup": "dialog", onclick: () => drill(n) }, "Show members"));
      }
      legendFill();
      wrap.dataset.view = view;
    }

    function silent(st) {
      const word = { pending: "Reading", unavailable: "Unavailable", quiet: "Nothing flagged", ok: "Nothing flagged" }[st.state] || "Unavailable";
      wrap.dataset.state = st.state;
      readEl.replaceChildren(word + " — " + (st.reason || "No flagged windows in this read."));
      stats.textContent = DASH;
      stage.replaceChildren(h("p", { class: "nm-empty", "data-empty": st.state }, word + ": " + (st.reason || "no flagged windows in this read, which is a quiet market and not a failure.")));
      legend.replaceChildren();
    }

    function rebuild() {
      if (dead) return;
      if (!S.rows.length) { M = null; G = null; for (const b of modeSeg.children) b.setAttribute("aria-pressed", String(b.dataset.mode === mode)); layerSeg.hidden = true; silent(S.st.state === "ok" ? { state: "quiet" } : S.st); return; }
      wrap.dataset.state = "ok";
      W = Math.round(stage.clientWidth || host.clientWidth || 0);
      H = Math.round(stage.clientHeight || 0);
      if (W < 40 || H < 40) return;
      M = fitLayout();
      if (!M || !M.total) { M = null; silent({ state: "quiet", reason: "The flagged windows carry no premium to route." }); return; }
      const ok = (id) => M.layers.some((l) => l.some((n) => n.id === id));
      if (!sel || !ok(sel)) sel = defaultSel();
      stats.textContent = count(M.windows) + plural(M.windows, " window", " windows") + " · " + money(M.total) + " flagged · " + count(M.names) + plural(M.names, " name", " names") + (S.readAt ? " · read " + F.time(S.readAt) : "") +
        (U.state === "fail" ? " · sectors unread" : "");
      paint();
    }

    stage.addEventListener("click", (ev) => {
      const g = ev.target.closest && ev.target.closest(".nm-chip");
      if (!g) return;
      sel = g.dataset.id;
      paint();
      const again = stage.querySelector('.nm-chip[data-id="' + CSS.escape(sel) + '"]');
      if (again) again.focus();
    });
    stage.addEventListener("keydown", (ev) => {
      const g = ev.target.closest && ev.target.closest(".nm-chip");
      if (!g || !G) return;
      const id = g.dataset.id, nd = G.nodes.get(id);
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); sel = id; paint(); const a = stage.querySelector('.nm-chip[data-id="' + CSS.escape(id) + '"]'); if (a) a.focus(); return; }
      const col = M.layers[nd.i];
      let to = null;
      if (ev.key === "ArrowDown") to = col[col.indexOf(nd.d) + 1];
      else if (ev.key === "ArrowUp") to = col[col.indexOf(nd.d) - 1];
      else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        const nl = M.layers[nd.i + (ev.key === "ArrowRight" ? 1 : -1)];
        if (nl) { const y = nd.y; to = nl.reduce((b, c) => { const nc = G.nodes.get(c.id); return !b || Math.abs(nc.y - y) < Math.abs(G.nodes.get(b.id).y - y) ? c : b; }, null); }
      } else return;
      if (!to) return;
      ev.preventDefault();
      sel = to.id;
      paint();
      const a = stage.querySelector('.nm-chip[data-id="' + CSS.escape(to.id) + '"]');
      if (a) a.focus();
    });

    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (S.rows.length) rebuild(); }) : null;
    if (ro) ro.observe(stage);

    function setSectors(u) {
      if (u && u.status === "ok" && Array.isArray(u.t) && Array.isArray(u.sec) && Array.isArray(u.sectors)) {
        U.map = new Map(u.t.map((t, i) => [String(t).toUpperCase(), Number.isInteger(u.sec[i]) ? u.sectors[u.sec[i]] || null : null]));
        U.state = "ok";
      } else { U.map = new Map(); U.state = "fail"; }
    }
    if (opts.sectors !== undefined) setSectors(opts.sectors);

    const api = {
      take(alerts, st) {
        const ok = Boolean(alerts && Array.isArray(alerts.rows));
        S.rows = ok ? alerts.rows : [];
        S.st = st || (ok ? { state: "ok" } : { state: "pending", reason: "Reading the flagged windows." });
        S.session = ok && typeof alerts.sessionDate === "string" ? alerts.sessionDate : null;
        let read = ok && typeof alerts.readAt === "string" ? alerts.readAt : null;
        for (const r of S.rows) if (r && typeof r.lastAt === "string" && (!read || r.lastAt > read)) read = r.lastAt;
        S.readAt = read;
        rebuild();
      },
      sectors(u) { setSectors(u); if (S.rows.length) rebuild(); },
      select(id) { sel = id; paint(); },
      mode(m) { if (m === "lean" || m === "dte") { mode = m; sel = null; rebuild(); } return mode; },
      view(v) { if (v === "map" || v === "table") { view = v; paint(); } return view; },
      layer(i) { layerPick = clamp(i | 0, 0, 3); paint(); },
      model: () => M,
      scene: () => (G ? {
        w: W, h: H, phone: G.phone, two: G.two, ch: G.ch, cw: G.cw, k: G.k, vMax: G.vMax, selected: sel,
        chips: [...G.nodes.values()].map((n) => ({ id: n.d.id, layer: n.i, x: n.x, y: n.y, w: n.w, h: n.h, v: n.d.v })),
        bands: G.edges.map((e) => ({ a: e.a, b: e.b, v: e.v, w: e.w, ya: e.ya, yb: e.yb })),
      } : null),
      readout: () => readEl.textContent,
      destroy() { dead = true; if (ro) ro.disconnect(); MAPS.delete(host); host.replaceChildren(); },
    };
    MAPS.set(host, api);
    silent(S.st);
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, {
    netMap: Object.freeze({ mount, of: (el) => MAPS.get(el) || null, readout }),
  }));
})();
