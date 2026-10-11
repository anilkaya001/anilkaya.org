(() => {
  "use strict";
  const SQ = Math.sqrt(252);
  const MIN = 2;
  const CAP = 40;
  const EVENT = 21;
  const NARROW = 640;
  const MINUS = "−";
  const DASH = "—";
  const isNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  function col(u, k) {
    const c = u.cols && u.cols[k];
    const unit = u.units && u.units[k];
    const sc = unit ? isNum(unit[1]) : null;
    return Array.isArray(c) && sc ? c.map((x) => (isNum(x) === null ? null : x / sc)) : null;
  }

  function model(u) {
    if (!u || u.status !== "ok" || !Array.isArray(u.t)) return null;
    const chg = col(u, "chg"), iv = col(u, "iv30p"), ed = col(u, "ed");
    if (!chg || !iv) return null;
    const names = Array.isArray(u.sectors) ? u.sectors : [];
    const all = [];
    u.t.forEach((t, i) => {
      const c = chg[i], v = iv[i];
      if (c === null || v === null || !(v > 0)) return;
      const m = c / (v / SQ);
      const e = ed ? ed[i] : null;
      const s = Array.isArray(u.sec) && u.sec[i] !== null && u.sec[i] !== undefined ? names[u.sec[i]] || null : null;
      all.push({ t, sector: s, secIx: s === null ? names.length : u.sec[i], chg: c, iv: v, m, h: Math.abs(m), dir: m > 0 ? 1 : -1, event: e !== null && e !== undefined && e <= EVENT });
    });
    const beyond = all.filter((r) => r.h >= MIN);
    const prisms = beyond.slice().sort((a, b) => b.h - a.h || (a.t < b.t ? -1 : 1)).slice(0, CAP);
    prisms.sort((a, b) => a.secIx - b.secIx || b.h - a.h || (a.t < b.t ? -1 : 1));
    prisms.forEach((p, i) => { p.gi = i; });
    return { n: all.length, beyond: beyond.length, prisms, max: prisms.reduce((x, p) => Math.max(x, p.h), 0), apart: prisms.some((p) => p.event), day: u.sessionDate || null };
  }

  function layout(md, W, H) {
    const n = md.prisms.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    const cw = Math.min(46, (W - 40) / (cols + rows));
    const unit = md.max > 0 ? Math.min(H * 0.5, 180) / Math.max(md.max, 4) : 0;
    const ox = W / 2;
    const oy = H - 24 - (cols + rows) * cw * 0.25;
    const items = md.prisms.map((p, i) => {
      const gx = i % cols, gy = Math.floor(i / cols);
      const x = ox + (gx - gy) * cw * 0.5;
      const yb = oy + (gx + gy) * cw * 0.25;
      return { t: p.t, gx, gy, x, yb, yt: yb - p.h * unit, w: cw * 0.34, h: p.h, dir: p.dir, event: p.event, order: gx + gy };
    });
    return { W, H, cols, rows, cw, unit, items: items.sort((a, b) => a.order - b.order || a.gx - b.gx) };
  }

  const sign = (v) => (v < 0 ? MINUS : "+");
  const f1 = (v) => (v === null ? DASH : sign(v) + Math.abs(v).toFixed(1));
  const pc = (v) => (v === null ? DASH : sign(v) + Math.abs(v * 100).toFixed(1) + "%");

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
    for (const c of kids) if (c !== null && c !== undefined) n.append(c);
    return n;
  }

  function paint(canvas, sc, md) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(sc.W * dpr);
    canvas.height = Math.round(sc.H * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, sc.W, sc.H);
    const cs = getComputedStyle(canvas);
    const up = cs.getPropertyValue("--up-mark").trim() || "#24ae56";
    const down = cs.getPropertyValue("--down-mark").trim() || "#e54c4a";
    const ink = cs.getPropertyValue("--label-3").trim() || "#8a93a6";
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(16, sc.H - 20);
    g.lineTo(16, sc.H - 20 - 2 * sc.unit);
    g.stroke();
    g.font = "11px Inter, system-ui, sans-serif";
    g.fillText("2 IV-days", 24, sc.H - 20 - sc.unit);
    for (const it of sc.items) {
      const c = it.dir > 0 ? up : down;
      const hw = it.w, d = hw * 0.5;
      g.fillStyle = c;
      g.globalAlpha = it.event ? 0.45 : 0.9;
      g.beginPath();
      g.moveTo(it.x - hw, it.yb);
      g.lineTo(it.x - hw, it.yt);
      g.lineTo(it.x, it.yt + d);
      g.lineTo(it.x, it.yb + d);
      g.closePath();
      g.fill();
      g.globalAlpha = it.event ? 0.35 : 0.65;
      g.beginPath();
      g.moveTo(it.x + hw, it.yb);
      g.lineTo(it.x + hw, it.yt);
      g.lineTo(it.x, it.yt + d);
      g.lineTo(it.x, it.yb + d);
      g.closePath();
      g.fill();
      g.globalAlpha = it.event ? 0.6 : 1;
      g.beginPath();
      g.moveTo(it.x, it.yt - d);
      g.lineTo(it.x + hw, it.yt);
      g.lineTo(it.x, it.yt + d);
      g.lineTo(it.x - hw, it.yt);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = c;
      g.lineWidth = 1;
      if (it.event) {
        g.setLineDash([3, 3]);
        g.stroke();
        g.setLineDash([]);
      }
    }
    g.globalAlpha = 1;
  }

  function table(md) {
    const body = md.prisms.slice().sort((a, b) => b.h - a.h || (a.t < b.t ? -1 : 1)).map((p) => el("tr", { "data-t": p.t, "data-dir": p.dir > 0 ? "up" : "down" },
      el("th", { scope: "row" }, p.t), el("td", null, p.sector || DASH), el("td", null, pc(p.chg)),
      el("td", null, f1(p.m)), el("td", null, p.dir > 0 ? "▲ up" : "▼ down"), el("td", null, p.event ? "Event not separated" : "")));
    return el("div", { class: "mk-tw" }, el("table", { class: "mk-tbl mk-sky-t" },
      el("caption", null, "Names that moved " + MIN + " IV-days or more, largest first"),
      el("thead", null, el("tr", null, ...["Name", "Sector", "Change", "IV-days", "Direction", "Note"].map((x) => el("th", { scope: "col" }, x)))),
      el("tbody", null, ...body)));
  }

  const NOTE = "Height is the move in IV-days, not a probability. Colour and the triangle give the direction. No selection line is drawn: no error rate has been measured.";
  const LINE = "A ranking, not a test: no error rate measured.";
  const CAPTION = "IV as of the previous close.";
  const APART = "Earnings within 30 days: event not separated.";

  function mount(host, universe) {
    if (!host) return null;
    const md = model(universe);
    host.replaceChildren();
    host.dataset.state = !md ? "pending" : md.prisms.length ? "ok" : "quiet";
    if (!md) {
      host.append(el("p", { class: "mk-sky-n", "data-empty": "pending" }, "The skyline needs the nightly universe with each name's previous-close implied volatility; it has not published."));
      return { model: null };
    }
    if (!md.prisms.length) {
      host.append(el("p", { class: "mk-sky-n", "data-empty": "quiet" }, "No name moved " + MIN + " IV-days or more. That is a reading, not a forecast."), el("p", { class: "mk-sky-n" }, CAPTION));
      return { model: md };
    }
    const top = md.prisms.slice().sort((a, b) => b.h - a.h)[0];
    const aria = md.prisms.length + " names moved " + MIN + " IV-days or more among " + md.n + " priced names. The largest is " + top.t + ", " + (top.dir > 0 ? "up " : "down ") + top.h.toFixed(1) + " IV-days. The table below lists them all.";
    const canvas = el("canvas", { class: "mk-sky-c", role: "img", "aria-label": aria });
    const wide = host.clientWidth >= NARROW;
    const details = el("details", { class: "mk-sky-d" }, el("summary", null, "Table of the " + md.prisms.length + " names"), table(md));
    let sc = null;
    const draw = () => {
      const W = Math.max(280, Math.floor(host.clientWidth));
      const on = W >= NARROW;
      canvas.hidden = !on;
      if (!on) { details.open = true; return; }
      const H = 360;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      sc = layout(md, W, H);
      paint(canvas, sc, md);
    };
    host.append(canvas, details,
      el("p", { class: "mk-sky-n" }, NOTE), el("p", { class: "mk-sky-n" }, LINE + " " + CAPTION + (md.apart ? " Hatched prisms: " + APART : "")));
    if (!wide) details.open = true;
    draw();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(host);
    return { model: md, scene: () => sc };
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { skyline: Object.freeze({ model, layout, mount }) }));
})();
