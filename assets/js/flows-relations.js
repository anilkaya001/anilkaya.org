(() => {
  "use strict";
  const MAX = 60;
  const FLOOR = 0.5;
  const LAYERS = Object.freeze({ T: "Moved together beyond the market", C: "Residual partial correlation" });
  const DASH = "—";
  const isNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  function ring(u) {
    if (!u || u.status !== "ok" || !Array.isArray(u.t) || !Array.isArray(u.sec) || !Array.isArray(u.sectors)) return null;
    const groups = u.sectors.map((s) => ({ sector: s, names: [] }));
    let taken = 0;
    for (let i = 0; i < u.t.length && taken < MAX; i++) {
      const g = groups[u.sec[i]];
      if (g) { g.names.push(u.t[i]); taken++; }
    }
    const used = groups.filter((g) => g.names.length);
    if (!used.length) return null;
    const gap = 0.12;
    const span = (Math.PI * 2 - gap * used.length) / taken;
    const pos = new Map();
    let a = -Math.PI / 2;
    for (const g of used) {
      g.from = a;
      for (const t of g.names) { pos.set(t, a + span / 2); a += span; }
      g.to = a;
      a += gap;
    }
    return { groups: used, pos, n: taken };
  }

  function step(s) {
    return s >= 0.9 ? 1 : s >= 0.7 ? 0.6 : 0.35;
  }

  function lists(r, graph) {
    const out = {};
    if (!r || !graph || !Array.isArray(graph.layers)) return out;
    for (const L of graph.layers) {
      if (!L || !Object.prototype.hasOwnProperty.call(LAYERS, L.id) || !Array.isArray(L.edges) || out[L.id]) continue;
      out[L.id] = L.edges.filter((e) => e && e.passed === true && isNum(e.stability) !== null && e.stability >= FLOOR && r.pos.has(e.a) && r.pos.has(e.b) && e.a !== e.b)
        .map((e) => ({ a: e.a, b: e.b, stability: e.stability, alpha: step(e.stability), lag: isNum(e.lag) })).sort((x, y) => y.stability - x.stability || (x.a + x.b < y.a + y.b ? -1 : 1));
    }
    return out;
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
    for (const c of kids) if (c !== null && c !== undefined) n.append(c);
    return n;
  }

  function paint(canvas, r, edges, W) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(W * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, W);
    const cs = getComputedStyle(canvas);
    const ink = cs.getPropertyValue("--label-3").trim() || "#8a93a6";
    const acc = cs.getPropertyValue("--accent").trim() || "#4ea2ff";
    const c = W / 2, R = W / 2 - 34;
    const at = (a, k) => [c + Math.cos(a) * (R * k), c + Math.sin(a) * (R * k)];
    g.lineWidth = 1;
    for (const e of edges) {
      const [x1, y1] = at(r.pos.get(e.a), 1), [x2, y2] = at(r.pos.get(e.b), 1);
      g.globalAlpha = e.alpha;
      g.strokeStyle = acc;
      g.beginPath();
      g.moveTo(x1, y1);
      g.quadraticCurveTo(c, c, x2, y2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = ink;
    g.strokeStyle = ink;
    g.font = "11px Inter, system-ui, sans-serif";
    for (const grp of r.groups) {
      g.lineWidth = 3;
      g.beginPath();
      g.arc(c, c, R + 12, grp.from, grp.to);
      g.stroke();
      const mid = (grp.from + grp.to) / 2, [lx, ly] = at(mid, 1 + 26 / R);
      g.textAlign = Math.cos(mid) > 0.3 ? "left" : Math.cos(mid) < -0.3 ? "right" : "center";
      g.fillText(grp.sector, lx, ly);
    }
    for (const [, a] of r.pos) {
      const [x, y] = at(a, 1);
      g.beginPath();
      g.arc(x, y, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  const NOTE = "Names sit on a ring by sector, largest first. A link is drawn only if it passed its test; one layer is shown at a time and layers are never merged. Co-occurrence, not cause.";

  function mount(host, universe, graph) {
    if (!host) return null;
    const r = ring(universe);
    host.replaceChildren();
    if (!r) {
      host.dataset.state = "pending";
      host.append(el("p", { class: "mk-rel-n", "data-empty": "pending" }, "Relations need the nightly universe with sectors; it has not published."));
      return { ring: null };
    }
    const by = lists(r, graph);
    const ids = Object.keys(LAYERS).filter((k) => by[k]);
    host.dataset.state = !ids.length ? "untested" : "ok";
    let cur = ids[0] || null;
    const canvas = el("canvas", { class: "mk-rel-c", role: "img" });
    const list = el("div", { class: "mk-rel-l" });
    const seg = el("div", { class: "mk-segc", role: "group", "aria-label": "Relation layer" });
    const status = el("p", { class: "mk-rel-n", role: "status" });
    const names = el("details", { class: "mk-rel-d" }, el("summary", null, "The " + r.n + " names on the ring"),
      el("ul", null, ...r.groups.map((grp) => el("li", null, el("strong", null, grp.sector + ": "), grp.names.join(", ")))));
    const render = () => {
      const edges = cur ? by[cur] : [];
      const W = Math.max(280, Math.min(620, Math.floor(host.clientWidth)));
      canvas.style.width = W + "px";
      canvas.style.height = W + "px";
      paint(canvas, r, edges, W);
      canvas.setAttribute("aria-label", cur
        ? LAYERS[cur] + ": " + edges.length + " tested links among " + r.n + " names, listed below."
        : "Names on a ring by sector, no links drawn: no relation has been tested yet.");
      host.dataset.layer = cur || "";
      host.dataset.edges = String(edges.length);
      status.textContent = !cur ? "No tested links yet: the relations statistics are not published, so no link is drawn."
        : edges.length ? LAYERS[cur] + ": " + edges.length + " links, each with its bootstrap stability."
        : "No stable links this week.";
      list.replaceChildren();
      if (edges.length) {
        list.append(el("div", { class: "mk-tw" }, el("table", { class: "mk-tbl mk-rel-t" }, el("caption", null, LAYERS[cur]),
          el("thead", null, el("tr", null, ...["From", "To", "Stability", "Lag"].map((x) => el("th", { scope: "col" }, x)))),
          el("tbody", null, ...edges.map((e) => el("tr", { "data-a": e.a, "data-b": e.b },
            el("th", { scope: "row" }, e.a), el("td", null, e.b), el("td", null, e.stability.toFixed(2)), el("td", null, e.lag === null ? DASH : e.lag + " min")))))));
      }
    };
    if (ids.length > 1) {
      for (const k of ids) {
        const b = el("button", { type: "button", "aria-pressed": k === cur ? "true" : "false", "data-layer": k }, LAYERS[k]);
        b.addEventListener("click", () => {
          cur = k;
          for (const x of seg.children) x.setAttribute("aria-pressed", x.dataset.layer === k ? "true" : "false");
          render();
        });
        seg.append(b);
      }
      host.append(seg);
    }
    host.append(canvas, status, list, names, el("p", { class: "mk-rel-n" }, NOTE));
    render();
    if (window.ResizeObserver) new ResizeObserver(render).observe(host);
    return { ring: r, edges: () => (cur ? by[cur] : []) };
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { relations: Object.freeze({ ring, lists, mount }) }));
})();
