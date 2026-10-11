(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI || UI.chart) return;
  const { h, s, num, clamp, glyph, F, tone, announce, silent, cssVar, DASH } = UI;

  let uid = 0;
  const nextId = (p) => p + (++uid);
  const moving = () => !UI.reduced();
  const AH = { "aria-hidden": "true" };
  const RAF = (f) => requestAnimationFrame(f);
  const paint = (c) => cssVar(c || "--label-2");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const isoDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
  const spoken = (node) => [...node.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(" ");

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
  const SESSION_W = 0.35;
  const SCALES = {
    linear: [(v) => v, (v) => v],
    log: [(v) => Math.log10(Math.max(1e-12, v)), (v) => 10 ** v],
    sqrt: [(v) => Math.sqrt(Math.max(0, v)), (v) => v * v],
    session: [
      (m) => { const c = clamp(m, 240, 1200); return SESSION_W * (Math.min(c, 570) - 240) + clamp(c - 570, 0, 390) + SESSION_W * Math.max(0, c - 960); },
      (p) => (p <= SESSION_W * 330 ? 240 + p / SESSION_W : p <= SESSION_W * 330 + 390 ? 570 + p - SESSION_W * 330 : 960 + (p - SESSION_W * 330 - 390) / SESSION_W),
    ],
  };
  function scale(type, d0, d1, r0, r1) {
    if (type === "band") {
      const st = (r1 - r0) / (d1 || 1);
      const b = (i) => r0 + st * (i + 0.5);
      b.step = st; b.type = type; b.domain = [0, d1];
      b.inv = (p) => clamp(Math.floor((p - r0) / st), 0, d1 - 1);
      return b;
    }
    const [t, u] = SCALES[type] || SCALES.linear;
    const a = t(d0);
    const k = (r1 - r0) / ((t(d1) - a) || 1);
    const f = (v) => r0 + (t(v) - a) * k;
    f.inv = (p) => u(a + (p - r0) / k);
    f.type = type || "linear"; f.domain = [d0, d1];
    return f;
  }
  const lin = (d0, d1, r0, r1) => scale("linear", d0, d1, r0, r1);
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
    const nearest = (x, y) => {
      if (o.ys) {
        let best = -1, bd = o.reach ?? Infinity;
        xs.forEach((px, i) => {
          const d = Math.hypot(px - x, (o.ys[i] - y) * (o.yw || 1)) - (o.rs ? o.rs[i] * 0.5 : 0);
          if (d < bd) { bd = d; best = i; }
        });
        return best;
      }
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
      for (const d of r.dots || []) s("circle", { cx: d.x, cy: d.y, r: d.r || 4, fill: d.fill || paint(d.color), class: d.cls || "ring" }, dots);
      readout.replaceChildren(...(r.parts || []).filter(Boolean));
      readout.classList.add("is-on");
      const w = host.clientWidth, rw = readout.offsetWidth;
      readout.style.left = clamp(x - rw / 2, 0, Math.max(0, w - rw)) + "px";
      readout.style.top = (r.top ?? 0) + "px";
      if (speak) announce(spoken(readout));
    };
    let raf = 0, pt = [0, 0];
    const hide = () => { host._scrubAt = -1; if (raf) { cancelAnimationFrame(raf); raf = 0; } readout.classList.remove("is-on"); xh.setAttribute("opacity", 0); dots.replaceChildren(); };
    const go = (e) => {
      const b = svg.getBoundingClientRect(), k = svg.viewBox.baseVal.width / b.width;
      const i = nearest((e[0] - b.left) * k, (e[1] - b.top) * k);
      if (i >= 0) show(i); else if (o.ys) hide();
    };
    host.addEventListener("pointermove", (e) => {
      pt = [e.clientX, e.clientY];
      if (!raf) raf = RAF(() => { raf = 0; go(pt); });
    }, on);
    host.addEventListener("pointerdown", (e) => go([e.clientX, e.clientY]), on);
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

  function drawSpark(el, w, animate, o) {
    const values = o.values;
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
  }

  function drawBars(el, w, animate, o) {
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
  }

  const PALETTES = {
    direction: { pos: "--up-mark", neg: "--down-mark", posT: "up", negT: "down" },
    gamma: { pos: "--g-long", neg: "--g-short", posT: "long", negT: "short" },
  };

  function drawDiverging(el, w, animate, o) {
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
  }

  function drawHeatmap(el, w, animate, o) {
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
    return make(host, o, "payoff", false);
  }

  function drawPayoff(el, w, animate, o) {
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
  }

  const KINDS = new Map();
  function kind(name, impl) {
    if (typeof name !== "string" || !name || KINDS.has(name) || !impl || typeof impl.draw !== "function") throw new Error("chart kind: " + name);
    KINDS.set(name, impl);
  }

  const dataOf = (k, o) => (k.data ? k.data(o) : null);
  function describeOf(k, o) {
    const d = dataOf(k, o);
    if (!d) return "";
    const out = [d.title + (d.x.length ? ", " + d.x[0] + " to " + d.x[d.x.length - 1] : "") + "."];
    for (const c of d.cols) {
      const f = c.fmt || ((v) => F.num(v, true));
      const at = c.values.map((v, i) => (num(v) === null ? null : i)).filter((i) => i !== null);
      if (!at.length) { out.push(c.label + ": no readings."); continue; }
      const by = (g) => at.reduce((a, i) => (g(c.values[i], c.values[a]) ? i : a));
      const say = (w, i) => `${w} ${f(c.values[i])} at ${d.x[i]}`;
      out.push(`${c.label}: ${say("last", at[at.length - 1])}; ${say("low", by((v, b) => v < b))}; ${say("high", by((v, b) => v > b))}.`);
    }
    return out.join(" ");
  }
  function tableOf(k, o) {
    const d = dataOf(k, o);
    const t = h("table", { class: "ui-tbl-t", "aria-label": d ? d.title : "Data" });
    if (d) {
      const cell = (c, v) => (typeof v === "string" ? v : num(v) === null ? DASH : (c.fmt || ((x) => F.num(x, true)))(v));
      t.append(h("thead", null, h("tr", null, h("th", { scope: "col" }, d.xLabel || "Point"), d.cols.map((c) => h("th", { scope: "col" }, c.label)))),
        h("tbody", null, d.x.map((x, i) => h("tr", null, h("th", { scope: "row" }, x), d.cols.map((c) => h("td", null, cell(c, c.values[i])))))));
    }
    return t;
  }

  function make(host, spec, name, deco) {
    const k = KINDS.get(name);
    if (!k) throw new Error("chart kind: " + name);
    let cur = spec;
    let box = null, wrap = null;
    const fill = () => { if (!wrap.hidden) wrap.replaceChildren(tableOf(k, cur)); };
    const run = (el, w, animate) => {
      k.draw(el, w, animate, cur);
      if (!deco) return;
      const text = describeOf(k, cur);
      el._cdId = el._cdId || nextId("cd");
      if (text) el.append(h("p", { class: "visually-hidden", id: el._cdId }, text));
      if (text) el.setAttribute("aria-describedby", el._cdId); else el.removeAttribute("aria-describedby");
      const p = cur.provenance;
      if (p) el.append(h("div", { class: "ui-prov" }, Number.isInteger(p.grade) ? h("span", { class: "ui-prov-g", title: p.why || null }, "Grade " + p.grade) : null, p.asOf ? h("span", null, p.asOf) : null, p.convention ? h("span", { class: "ui-prov-c" }, p.convention) : null));
      if (wrap) fill();
    };
    const m = mount(host, run);
    const set = m.set, destroy = m.destroy;
    if (deco && spec.table && k.data) {
      const btn = h("button", { type: "button", class: "ds-btn ui-tbl-b", "aria-expanded": "false", onclick: () => {
        wrap.hidden = !wrap.hidden;
        btn.setAttribute("aria-expanded", String(!wrap.hidden));
        btn.textContent = wrap.hidden ? "Table" : "Hide table";
        fill();
      } }, "Table");
      wrap = h("div", { class: "ui-tbl-w", hidden: true });
      box = h("div", { class: "ui-tbl" }, btn, wrap);
      host.after(box);
    }
    return Object.assign(m, {
      set: (next, animate) => {
        if (typeof next === "function") set((el, w, a) => next(el, w, a), animate);
        else { cur = next; set(run, animate); }
      },
      update: (patch, o) => { cur = { ...cur, ...patch }; set(run, !!(o && o.animate)); },
      describe: () => describeOf(k, cur),
      table: () => tableOf(k, cur),
      destroy: () => { if (box) box.remove(); destroy(); },
    });
  }
  const plot = (host, spec) => make(host, spec, spec && spec.kind, !spec || spec.describe !== false);

  const xText = (o, X) => X.map(o.xFormat || ((v) => (xDate(v) ? F.day(v) : String(v))));
  const solo = (o, x) => ({ title: o.label || "Chart", x, cols: [{ label: o.label || "Value", values: o.values || [], fmt: o.format }] });
  kind("line", {
    draw: drawLine,
    data: (o) => {
      const sr = (o.series || []).filter((x) => Array.isArray(x.values));
      return { title: o.label || "Chart", x: xText(o, Array.isArray(o.x) ? o.x : sr.length ? sr[0].values.map((_, i) => i + 1) : []),
        cols: sr.map((x) => ({ label: x.label || o.label || "Value", values: x.values, fmt: x.format || o.yFormat })) };
    },
  });
  kind("bars", { draw: drawBars, data: (o) => solo(o, (o.values || []).map((_, i) => (o.labels || [])[i] ?? String(i + 1))) });
  kind("diverging", { draw: drawDiverging, data: (o) => solo(o, xText(o, Array.isArray(o.x) ? o.x : (o.values || []).map((_, i) => i + 1))) });
  kind("heatmap", {
    draw: drawHeatmap,
    data: (o) => {
      const rf = o.rowFormat || String, cf = o.colFormat || String, x = [], values = [];
      (o.rows || []).forEach((r, i) => (o.cols || []).forEach((c, j) => { x.push(rf(r) + ", " + cf(c)); values.push(((o.grid || [])[i] || [])[j]); }));
      return { title: o.label || "Grid", xLabel: "Cell", x, cols: [{ label: o.label || "Value", values, fmt: o.format }] };
    },
  });
  kind("sparkline", { draw: drawSpark });
  kind("payoff", { draw: drawPayoff });

  const line = (host, o) => make(host, o, "line", false);
  const bars = (host, o) => make(host, o, "bars", false);
  const diverging = (host, o) => make(host, o, "diverging", false);
  const heatmap = (host, o) => make(host, o, "heatmap", false);
  const sparkline = (host, values, o = {}) => make(host, { ...o, values }, "sparkline", false);

  function ticks(sc, n, fmt) {
    const [a, b] = sc.domain;
    const vs = [];
    if (sc.type === "log") for (let e = Math.ceil(Math.log10(a)); e <= Math.floor(Math.log10(b)); e++) vs.push(10 ** e);
    else if (sc.type === "session") for (let m = Math.ceil(a / 60) * 60; m <= b; m += 60 * Math.max(1, Math.ceil((b - a) / 60 / n))) vs.push(m);
    else vs.push(...niceTicks(a, b, n));
    const f = typeof fmt === "string" ? (v) => F.unit(fmt, v) : fmt || ((v) => F.num(v));
    return vs.map((v) => ({ v, x: sc(v), y: sc(v), text: f(v) }));
  }

  function layout(w, o = {}) {
    const label = Math.max(0, ...(o.labels || []).map(tw));
    return { phone: w < 600, H: heightFor(o.height, w, o.fallback || [200, 220, 240]), top: o.top ?? 14, bot: o.bot ?? 24, left: o.left ?? 2, right: o.right ?? (label ? Math.ceil(label) : w < 600 ? 54 : 62) };
  }
  function axes(svg, L, w, o = {}) {
    const by = o.base ?? L.H - L.bot, left = o.side === "left";
    s("line", { x1: L.left, x2: w - L.right, y1: by, y2: by, class: "base" }, svg);
    for (const t of o.y || []) {
      if (o.grid) s("line", { x1: L.left, x2: w - L.right, y1: t.y, y2: t.y, class: "hair" }, svg);
      s("text", { x: left ? L.left - 8 : w - L.right + 8, y: t.y + 3.8, text: t.text, class: "tx-3", "text-anchor": left ? "end" : null }, svg);
    }
    for (const t of o.x || []) s("text", { x: t.x, y: L.H - 6, text: t.text, "text-anchor": t.end ? "end" : "middle" }, svg);
  }

  const chart = Object.freeze({
    mount, svgRoot, lin, niceTicks, pathOf, monoPath, vGrad, clipRect, spread, marker, scrub, part,
    line, sparkline, bars, diverging, heatmap, gauge, payoff,
    LEVELS, shapeOf, kind, plot, scale, ticks, layout, axes,
  });

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { chart }));
})();
