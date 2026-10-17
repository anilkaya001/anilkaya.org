(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI || !UI.tickerGlance) return;
  const { h, F, cssVar } = UI;
  const GM = UI.tickerGlance.model;
  const DEG = Math.PI / 180;
  const REST_YAW = -34 * DEG, REST_PITCH = 36 * DEG;
  const DEALER_CLAUSE = "on the vendor's convention (dealers long calls, short puts)";
  const VOL = ["--vol-1", "--vol-2", "--vol-3", "--vol-4", "--vol-5", "--vol-6"];
  const CLIP = 1.25;
  const SUB = 4;
  const NK = 44;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const GSIGN = { "-1": UI.MINUS, "1": "+", "0": "" };
  const MINUS = UI.MINUS, DASH = UI.DASH, MID = " " + UI.MID + " ";

  function parseColor(c) {
    const t = String(c || "").trim();
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
    if (m) {
      const x = m[1].length === 3 ? m[1].split("").map((d) => d + d).join("") : m[1];
      return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
    }
    m = /^rgba?\(([^)]+)\)/i.exec(t);
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) return p.slice(0, 3);
    }
    return [136, 136, 136];
  }

  function ramp() {
    const stops = VOL.map((n) => parseColor(cssVar(n)));
    return (t) => {
      const x = clamp(t, 0, 1) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(x));
      const f = x - i;
      return "rgb(" + [0, 1, 2].map((c) => Math.round(stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f)).join(",") + ")";
    };
  }

  function niceStep(span, n) {
    const raw = Math.max(span, 1e-9) / n;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  const volPt = (v) => String(Math.round(v * 100));
  const pctOf = (v) => (num(v) === null ? DASH : (v * 100).toFixed(1) + "%");
  const gWord = (xp, v) => (xp.basis === "traded" ? F.num(v) : F.money(v));

  function surfaceModel(card, FQ) {
    const xp = GM.expiries(card, FQ);
    const rows = xp.rows.map((r) => Object.assign({}, r, { Tx: r.T !== null ? r.T : r.dte / 365 }));
    const known = xp.strikes.filter((k) => k !== null);
    const S = xp.spot;
    const K0 = known.length ? Math.min(...known) : S !== null ? S * 0.88 : null;
    const K1 = known.length ? Math.max(...known) : S !== null ? S * 1.12 : null;
    const out = { xp, rows, S, K0, K1, fit: [], ivLo: null, ivHi: null, mesh: [], rings: [], calendar: { checked: 0, breaks: [] }, sqMin: null, sqMax: null, depth: () => 0, wAt: () => null, ivAt: () => null, why: xp.why };
    if (!rows.length || K0 === null || !(K1 > K0)) return out;
    const sq = rows.map((r) => Math.sqrt(r.Tx));
    out.sqMin = Math.min(...sq);
    out.sqMax = Math.max(...sq);
    out.depth = (r) => (out.sqMax > out.sqMin ? (Math.sqrt(r.Tx) - out.sqMin) / (out.sqMax - out.sqMin) : 0.5);
    const fitted = (r) => r.state !== "none" && r.slice && FQ && r.F > 0 && r.Tx > 0;
    out.wAt = (r, K) => {
      if (!fitted(r) || !(K > 0)) return null;
      try { return num(FQ.sliceTotalVariance(r.slice, Math.log(K / r.F))); } catch (e) { return null; }
    };
    out.ivAt = (r, K) => {
      const w = out.wAt(r, K);
      return w === null || !(w > 0) ? null : Math.sqrt(w / r.Tx);
    };
    out.fit = rows.filter(fitted);
    out.between = (r0, r1, u, K) => {
      const w0 = out.wAt(r0, K), w1 = out.wAt(r1, K);
      if (w0 === null || w1 === null) return null;
      const w = w0 + (w1 - w0) * u, T = r0.Tx + (r1.Tx - r0.Tx) * u;
      if (!(w > 0) || !(T > 0)) return null;
      return { w, T, iv: Math.sqrt(w / T), d: out.sqMax > out.sqMin ? (Math.sqrt(T) - out.sqMin) / (out.sqMax - out.sqMin) : 0.5 };
    };
    const ks = (n) => Array.from({ length: n }, (_, i) => K0 + ((K1 - K0) * i) / (n - 1));
    const body = [];
    for (const r of out.fit) for (const K of ks(23)) { const v = out.ivAt(r, K); if (v !== null) body.push(v); }
    if (body.length) { out.ivLo = Math.floor(Math.min(...body) * 100) / 100; out.ivHi = Math.ceil(Math.max(...body) * 100) / 100; if (out.ivHi <= out.ivLo) out.ivHi = out.ivLo + 0.01; }
    for (let a = 0; a + 1 < out.fit.length; a++) {
      const r0 = out.fit[a], r1 = out.fit[a + 1];
      const interp = r1.j - r0.j > 1;
      for (let s = 0; s < SUB; s++) out.mesh.push({ r0, r1, u0: s / SUB, u1: (s + 1) / SUB, interp });
    }
    for (let a = 0; a + 1 < out.fit.length; a++) {
      const r0 = out.fit[a], r1 = out.fit[a + 1];
      for (let K = K0; K <= K1 + 1e-9; K += 0.5) {
        const w0 = out.wAt(r0, K), w1 = out.wAt(r1, K);
        if (w0 === null || w1 === null) continue;
        out.calendar.checked++;
        if (w1 < w0 - 1e-9) out.calendar.breaks.push({ K, from: r0.expiry, to: r1.expiry, gap: w1 - w0 });
      }
    }
    out.rings = rows.filter((r) => !fitted(r) && r.atm !== null).map((r) => ({ r, K: clamp(r.F > 0 ? r.F : S !== null ? S : (K0 + K1) / 2, K0, K1), iv: r.atm }));
    return out;
  }

  function terrainModel(sm) {
    const xp = sm.xp;
    if (!xp.basis || !xp.strikes.length) return null;
    const rows = sm.rows.filter((r) => r.gamma);
    if (!rows.length || !(xp.cap > 0)) return null;
    let clipped = 0, gaps = 0;
    const cells = [];
    xp.strikes.forEach((K, i) => rows.forEach((r) => {
      const g = r.gamma[i];
      if (K === null) return;
      if (g === null) { gaps++; cells.push({ i, j: r.j, K, g: null, h: null, clip: false }); return; }
      const raw = g / xp.cap;
      const clip = Math.abs(raw) > CLIP;
      if (clip) clipped++;
      cells.push({ i, j: r.j, K, g, h: clip ? Math.sign(raw) * CLIP : raw, clip });
    }));
    const net = rows.map((r) => { let t = null; for (const g of r.gamma) if (g !== null) t = (t === null ? 0 : t) + g; return t; });
    return { basis: xp.basis, cap: xp.cap, clip: CLIP, clipped, gaps, cells, rows, net, strikes: xp.strikes.filter((k) => k !== null) };
  }

  function camera({ cx, cy, scale, yaw, pitch, dist }) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = (x, y, z) => {
      const X = x * cyw + z * syw;
      let Z = -x * syw + z * cyw;
      const Y = y * cp + Z * sp;
      Z = Z * cp - y * sp;
      const k = dist / (dist + Z);
      return { x: cx + X * k * scale, y: cy - Y * k * scale, z: Z, X, Y };
    };
    f.rot = (x, y, z) => {
      const X = x * cyw + z * syw;
      let Z = -x * syw + z * cyw;
      const Y = y * cp + Z * sp;
      Z = Z * cp - y * sp;
      return [X, Y, Z];
    };
    f.dist = dist;
    return f;
  }

  function bounds(yaw, pitch, pts, dist) {
    const unit = camera({ cx: 0, cy: 0, scale: 1, yaw, pitch, dist });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      const q = unit(p[0], p[1], p[2]);
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
    return { x0, x1, y0, y1 };
  }

  function restWidth(s, w, hh, box, mx, my, dist) {
    const key = w + "x" + hh;
    if (s.rest && s.rest.key === key) return s.rest.xr;
    const want = (w - 2 * mx) / (hh - 2 * my);
    let a = 1.4, b = 12;
    for (let i = 0; i < 14; i++) {
      const mid = (a + b) / 2;
      const q = bounds(REST_YAW, REST_PITCH, box(mid), dist);
      if ((q.x1 - q.x0) / (q.y1 - q.y0) < want) a = mid; else b = mid;
    }
    s.rest = { key, xr: (a + b) / 2 };
    return s.rest.xr;
  }

  function fitCam(view, w, hh, pts, mx, my, dist) {
    const { x0, x1, y0, y1 } = bounds(view.yaw, view.pitch, pts, dist);
    const scale = Math.min((w - 2 * mx) / Math.max(x1 - x0, 1e-6), (hh - 2 * my) / Math.max(y1 - y0, 1e-6));
    return camera({ cx: w / 2 - ((x0 + x1) / 2) * scale, cy: hh / 2 - ((y0 + y1) / 2) * scale, scale, yaw: view.yaw, pitch: view.pitch, dist });
  }

  function labeler(ctx, w, hh, font, out) {
    const queue = [];
    const hit = (a, b) => a[0] < b[2] + 2 && b[0] < a[2] + 2 && a[1] < b[3] + 1 && b[1] < a[3] + 1;
    return {
      add(text, x, y, align, prio, color, bold) { queue.push({ text, x, y, align, prio, color, bold, n: queue.length }); },
      flush() {
        const kept = [];
        queue.sort((a, b) => b.prio - a.prio || a.n - b.n);
        for (const q of queue) {
          ctx.font = (q.bold ? "600 " : "") + font;
          const tw = ctx.measureText(q.text).width;
          let x0 = q.align === "center" ? q.x - tw / 2 : q.align === "right" ? q.x - tw : q.x;
          x0 = clamp(x0, 2, Math.max(2, w - tw - 2));
          const y0 = clamp(q.y - 10, 2, hh - 14);
          const box = [x0, y0, x0 + tw, y0 + 12];
          if (kept.some((k) => hit(k.box, box))) { out.dropped.push(q.text); continue; }
          kept.push({ box, q });
          ctx.textAlign = "left";
          ctx.lineJoin = "round";
          ctx.lineWidth = 3;
          ctx.strokeStyle = cssVar("--surface-1");
          ctx.strokeText(q.text, x0, y0 + 10);
          ctx.fillStyle = q.color;
          ctx.fillText(q.text, x0, y0 + 10);
          out.labels.push(q.text);
          out.boxes.push(box.map((v) => Math.round(v * 10) / 10));
        }
      },
    };
  }

  function stage(host, label, draw, view, hooks) {
    const wrap = h("div", { class: "ftsf-cv" });
    const cv = h("canvas", { role: "img", tabindex: "0", "aria-label": label });
    wrap.append(cv);
    host.append(wrap);
    const s = { rest: null, last: null };
    const paint = () => {
      const w = Math.max(200, Math.floor(wrap.clientWidth || 300));
      const hh = Math.max(180, Math.floor(wrap.clientHeight || 300));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, w, hh);
      const out = { labels: [], boxes: [], dropped: [], rows: [] };
      draw(ctx, w, hh, s, out);
      s.last = out;
      cv.dataset.labels = out.labels.join("|");
      cv.dataset.boxes = JSON.stringify(out.boxes);
      cv.dataset.dropped = out.dropped.join("|");
    };
    const pick = (ev) => {
      const r = cv.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      let best = -1, bd = 1e9;
      for (const p of (s.last && s.last.rows) || []) { const d = Math.hypot(p.x - mx, p.y - my); if (d < bd) { bd = d; best = p.j; } }
      return bd < 46 ? best : -1;
    };
    let drag = null;
    cv.addEventListener("pointerdown", (ev) => { drag = { x: ev.clientX, y: ev.clientY, moved: false }; try { cv.setPointerCapture(ev.pointerId); } catch (e) { drag.cap = false; } });
    cv.addEventListener("pointermove", (ev) => {
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) { hooks.orbit(dx * 0.4, dy * 0.3); drag.x = ev.clientX; drag.y = ev.clientY; }
      } else if (ev.pointerType === "mouse") hooks.hover(pick(ev));
    });
    const end = (ev) => { if (drag && !drag.moved && ev.type === "pointerup") { const j = pick(ev); if (j >= 0) hooks.pick(j); } drag = null; };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => hooks.hover(-1));
    cv.addEventListener("keydown", (ev) => {
      const d = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 3], ArrowDown: [0, -3] }[ev.key];
      if (d) { ev.preventDefault(); hooks.orbit(d[0], d[1]); return; }
      if (ev.key === "Home") { ev.preventDefault(); hooks.reset(); }
      else if (ev.key === "[" || ev.key === "]") { ev.preventDefault(); hooks.step(ev.key === "]" ? 1 : -1); }
    });
    return { cv, wrap, paint, s };
  }

  function frame(ctx, cam, g) {
    const grid = cssVar("--label-4"), axis = cssVar("--label-3"), text = cssVar("--label-2"), accent = cssVar("--accent-ink");
    const corners = [[-g.xr, -g.zr], [g.xr, -g.zr], [g.xr, g.zr], [-g.xr, g.zr]].map(([x, z]) => ({ x, z, p: cam(x, 0, z) }));
    const front = corners.reduce((a, b) => (b.p.z < a.p.z ? b : a));
    const back = corners.reduce((a, b) => (b.p.z > a.p.z ? b : a));
    const left = corners.filter((c) => c !== front).reduce((a, b) => (b.p.x < a.p.x ? b : a));
    const cen = { x: corners.reduce((a, c) => a + c.p.x, 0) / 4, y: corners.reduce((a, c) => a + c.p.y, 0) / 4 };
    const seg = (a, b, color, width, alpha, dash) => {
      const p = cam(a[0], a[1], a[2]), q = cam(b[0], b[1], b[2]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.globalAlpha = alpha || 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.p.x, c.p.y) : ctx.moveTo(c.p.x, c.p.y)));
    ctx.closePath();
    ctx.fillStyle = cssVar("--surface-2");
    ctx.fill();
    for (const t of g.xTicks) seg([t.p, 0, -g.zr], [t.p, 0, g.zr], grid, 1, 0.8);
    for (const t of g.zTicks) seg([-g.xr, 0, t.p], [g.xr, 0, t.p], t.on ? accent : grid, t.on ? 1.8 : 1, t.on ? 1 : 0.8);
    const ez = left.z === front.z ? back.z : front.z;
    const ex = left.x === front.x ? back.x : front.x;
    const away = (p, d) => {
      const dx = p.x - cen.x, dy = p.y - cen.y;
      const n = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / n) * d, y: p.y + (dy / n) * d };
    };
    return {
      front, back, left, seg, ez, ex, away, far: back.z,
      axes() {
        seg([-g.xr, 0, ez], [g.xr, 0, ez], axis, 1.4);
        seg([ex, 0, -g.zr], [ex, 0, g.zr], axis, 1.4);
        seg([left.x, g.y0, left.z], [left.x, g.y1, left.z], axis, 1.4);
      },
      labels(lab) {
        const kx = g.phone ? 4 : 7;
        const xs = g.xTicks.length > kx ? g.xTicks.filter((_, i) => i % Math.ceil(g.xTicks.length / kx) === 0) : g.xTicks;
        for (const t of xs) { const a = away(cam(t.p, 0, ez), 15); lab.add(t.t, a.x, a.y + 3, "center", 3, text); }
        for (const t of g.zTicks) { const a = away(cam(ex, 0, t.p), 17); lab.add(t.t, a.x, a.y + 3, "center", t.on ? 6 : 3, t.on ? accent : text, t.on); }
        for (const t of g.yTicks) { const q = cam(left.x, t.p, left.z); lab.add(t.t, q.x - 7, q.y + 3, "right", 3, text); }
        if (!g.phone) {
          const xm = away(cam(0, 0, ez), 34);
          lab.add(g.titles.x, xm.x, xm.y + 3, "center", 2, text);
          const zm = away(cam(ex, 0, 0), 64);
          lab.add(g.titles.z, zm.x, zm.y + 3, "center", 2, text);
        }
        const top = cam(left.x, g.y1, left.z);
        lab.add(g.titles.y, top.x, top.y - 12, "center", 2, text);
      },
    };
  }

  function faceVisible(cam, nx, ny, nz, cx, cy, cz) {
    const n = cam.rot(nx, ny, nz), c = cam.rot(cx, cy, cz);
    return n[0] * c[0] + n[1] * c[1] + n[2] * (c[2] + cam.dist) < 0;
  }

  function hatch(ctx, pts, color) {
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.3;
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), ya = Math.min(...pts.map((p) => p.y)), yb = Math.max(...pts.map((p) => p.y));
    ctx.beginPath();
    for (let t = x0 - (yb - ya); t < x1; t += 5) { ctx.moveTo(t, yb); ctx.lineTo(t + (yb - ya), ya); }
    ctx.stroke();
    ctx.restore();
  }

  function levelLines(ctx, fr, cam, g, sm, X, lab) {
    const lv = sm.xp.levels || {};
    const marks = [];
    for (const [kind, name, token] of [["call_wall", "Call", "--lvl-call"], ["max_pain", "Pain", "--lvl-pain"], ["put_wall", "Put", "--lvl-put"], ["gamma_flip", "Flip", "--lvl-flip"]]) {
      const l = lv[kind];
      if (l && l.px >= sm.K0 && l.px <= sm.K1) marks.push({ text: name + " " + F.px(l.px, l.px % 1 ? 2 : 0), K: l.px, token });
    }
    marks.sort((a, b) => a.K - b.K);
    const far = fr.far;
    marks.forEach((m, i) => {
      const col = cssVar(m.token);
      fr.seg([X(m.K), 0, -g.zr], [X(m.K), 0, g.zr], col, 1.2, 0.85, [4, 3]);
      const p = cam(X(m.K), 0, far);
      const a = fr.away(p, 14 + (i % 2) * 13);
      lab.add(m.text, a.x, a.y + 3, "center", 4, col, true);
    });
    if (sm.S !== null) {
      const K = clamp(sm.S, sm.K0, sm.K1);
      fr.seg([X(K), 0, -g.zr], [X(K), 0, g.zr], cssVar("--lvl-flip"), 1.6, 1, [5, 4]);
      const p = cam(X(K), 0, fr.ez);
      const a = fr.away(p, 30);
      lab.add("spot " + F.px(sm.S), a.x, a.y + 3, "center", 9, cssVar("--lvl-flip"), true);
    }
  }

  function mount(host, input) {
    host.replaceChildren();
    const card = input.card;
    const FQ = window.FlowsQuant || null;
    const sm = surfaceModel(card, FQ);
    const tm = terrainModel(sm);
    const ticker = card.ticker;
    if (!sm.rows.length) {
      host.append(UI.silent({ state: "unavailable", reason: (sm.why.smile && sm.why.gamma ? sm.why.gamma + " " + sm.why.smile : sm.why.gamma || sm.why.smile || "The card carries no expiries.") }, "Surface and terrain", 140),
        h("p", { class: "ftsf-cap" }, "This card holds neither a fitted smile nor gamma by strike and expiry, so there is no surface or terrain to draw."));
      return { destroy() {}, reset() {}, setExpiry() {}, expiry: () => null, model: { surface: sm, terrain: tm }, repaint() {} };
    }
    const view = { yaw: REST_YAW, pitch: REST_PITCH };
    let sel = input.expiry && sm.rows.some((r) => r.expiry === input.expiry) ? input.expiry : GM.defaultExpiry(sm.rows);
    let hov = -1, dead = false, raf = 0;
    const selRow = () => sm.rows.find((r) => r.expiry === sel) || sm.rows[0];
    const fitN = sm.fit.length;
    const root = h("div", { class: "ftsf" });
    const chipsEl = h("div", { class: "ftsf-chips", role: "group", "aria-label": "Expiry" });
    const keyEl = h("div", { class: "ftsf-key" });
    const colsEl = h("div", { class: "ftsf-cols" });
    const gCol = h("section", { class: "ftsf-col", "aria-labelledby": "ftsfTg" });
    const vCol = h("section", { class: "ftsf-col", "aria-labelledby": "ftsfTv" });
    const sCol = h("section", { class: "ftsf-col ftsf-col-s", "aria-labelledby": "ftsfTs" });
    colsEl.append(gCol, vCol, sCol);
    const dockEl = h("div", { class: "ftsf-tabs" });
    root.append(chipsEl, keyEl, colsEl, dockEl);
    host.append(root);

    const emit = (iso) => document.dispatchEvent(new CustomEvent("ft:expiry", { bubbles: true, detail: { expiry: iso, source: "surface" } }));
    const select = (iso, refocus) => {
      if (!sm.rows.some((r) => r.expiry === iso) || (iso === sel && !refocus)) return;
      const changed = iso !== sel;
      sel = iso;
      paintChips();
      paintSmile();
      paintCanvases();
      if (changed) emit(iso);
      if (refocus) { const b = chipsEl.querySelector('[aria-pressed="true"]'); if (b) b.focus({ preventScroll: true }); }
    };
    const onExpiry = (e) => { const d = e.detail || {}; if (d.source !== "surface" && typeof d.expiry === "string" && d.expiry !== sel && sm.rows.some((r) => r.expiry === d.expiry)) { sel = d.expiry; paintChips(); paintSmile(); paintCanvases(); } };
    document.addEventListener("ft:expiry", onExpiry);

    const hooks = {
      orbit(dy, dp) {
        view.yaw = clamp(view.yaw + dy * DEG, -55 * DEG, 55 * DEG);
        view.pitch = clamp(view.pitch + dp * DEG, 8 * DEG, 52 * DEG);
        paintCanvases();
      },
      reset() { view.yaw = REST_YAW; view.pitch = REST_PITCH; paintCanvases(); },
      hover(j) { const was = hov; hov = j; if (was !== j) paintCanvases(); },
      pick(j) { select(sm.rows[j].expiry, false); },
      step(d) { const i = sm.rows.findIndex((r) => r.expiry === sel); const n = sm.rows[clamp(i + d, 0, sm.rows.length - 1)]; select(n.expiry, false); },
    };

    function paintChips() {
      chipsEl.replaceChildren(...sm.rows.map((r) => {
        const b = h("button", { class: "ftsf-chip", type: "button", "aria-pressed": String(r.expiry === sel), "data-expiry": r.expiry, "data-state": r.state, title: r.dte + " days" + (r.atm !== null ? ", at the money " + F.pct(r.atm, 1) : "") },
          h("b", null, F.day(r.expiry)), h("span", { class: "ftsf-fit" }, r.label));
        b.addEventListener("click", () => select(r.expiry, false));
        b.addEventListener("keydown", (e) => {
          const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const i = sm.rows.findIndex((x) => x.expiry === r.expiry);
          const n = sm.rows[clamp(i + d, 0, sm.rows.length - 1)];
          select(n.expiry, true);
        });
        return b;
      }));
    }

    const gName = (xp) => (xp.basis === "traded" ? "traded gamma, no dollar unit" : "$ per 1% move");
    function paintKey() {
      const lo = sm.ivLo, hi = sm.ivHi;
      const grad = "linear-gradient(90deg," + VOL.map((n) => "var(" + n + ")").join(",") + ")";
      const bits = [h("span", { class: "ftsf-k" }, "implied vol"), h("i", { class: "ftsf-ramp", "aria-hidden": "true", style: { background: grad } })];
      bits.push(h("span", null, lo === null ? "no fitted expiry, so no volatility scale" : volPt(lo) + "% to " + volPt(hi) + "% across the fitted body"));
      bits.push(h("span", { class: "ftsf-sep" }, MID.trim()));
      bits.push(h("span", null, tm ? "gamma height scale ±" + gWord(sm.xp, tm.cap) + " (98th percentile of cells)" : "no gamma height scale: " + (sm.xp.why.gamma || "no gamma")));
      keyEl.replaceChildren(...bits);
    }

    function paintSmile() {
      const row = selRow();
      sCol.replaceChildren();
      const meta = [F.day(row.expiry), row.dte + " days"];
      if (row.F !== null) meta.push("F " + F.px(row.F));
      if (row.T !== null) meta.push("T " + row.T.toFixed(4) + " y");
      const body = h("div", { class: "ftsf-smile" });
      sCol.append(h("h3", { id: "ftsfTs" }, "Smile ", h("span", { class: "ftsf-sub" }, meta.join(MID))), body);
      const W = Math.max(200, Math.floor(sCol.clientWidth || 320));
      const room = Math.max(160, (sCol.clientHeight || 300) - 56);
      const m = { xp: sm.xp, S: sm.S, y0: sm.K0, y1: sm.K1 };
      body.append(GM.miniRail(m, row, W, { gh: clamp(Math.round(room * 0.36), 70, 150), sh: clamp(Math.round(room * 0.6), 110, 300), titles: false }));
    }

    const stages = [];

    function terrainDraw(ctx, w, hh, s, out) {
      const phone = w < 380;
      const mx = phone ? 26 : 34, my = phone ? 30 : 34;
      const lab = labeler(ctx, w, hh, (phone ? 10 : 11) + "px Inter, system-ui, sans-serif", out);
      const heights = tm.cells.map((c) => c.h).filter((v) => v !== null);
      const hMax = Math.max(0, ...heights), hMin = Math.min(0, ...heights);
      const deep = (r) => clamp(r * 0.62, 2.4, 4.6);
      const sy = (r) => clamp(r * 0.36, 0.9, 1.6);
      const y0 = (r) => hMin * sy(r) - (hMin < 0 ? 0.1 : 0), y1 = (r) => hMax * sy(r) + 0.15;
      const box = (r) => [-r, r].flatMap((x) => [-deep(r), deep(r)].flatMap((z) => [[x, y0(r), z], [x, y1(r), z]]));
      const xr = restWidth(s, w, hh, box, mx, my, 24);
      const zr = deep(xr), gk = sy(xr), Y0 = y0(xr), Y1 = y1(xr);
      const cam = fitCam(view, w, hh, box(xr), mx, my, 24);
      const X = (K) => ((K - sm.K0) / (sm.K1 - sm.K0) - 0.5) * 2 * xr;
      const Z = (r) => (sm.depth(r) * 2 - 1) * zr;
      const step = niceStep(sm.K1 - sm.K0, phone ? 3 : 5);
      const xTicks = [];
      for (let K = Math.ceil(sm.K0 / step) * step; K <= sm.K1 + 1e-9; K += step) xTicks.push({ p: X(K), t: "$" + F.px(K, 0) });
      const zTicks = sm.rows.map((r) => ({ p: Z(r), t: F.day(r.expiry), on: r.expiry === sel }));
      const yTicks = [{ p: 0, t: "0" }];
      if (hMax > 0) yTicks.push({ p: gk, t: gWord(sm.xp, tm.cap) });
      if (hMin < 0) yTicks.push({ p: -gk, t: MINUS + gWord(sm.xp, tm.cap) });
      const g = { w, h: hh, phone, xr, zr, y0: Y0, y1: Y1, xTicks, zTicks, yTicks, titles: { x: "Strike", z: "Expiry", y: sm.xp.basis === "traded" ? "Gamma traded" : "Gamma, $ per 1%" } };
      const fr = frame(ctx, cam, g);
      levelLines(ctx, fr, cam, g, sm, X, lab);
      const long = cssVar("--g-long"), short = cssVar("--g-short"), faint = cssVar("--label-3"), ink = cssVar("--label-1");
      const list = [];
      const jPos = new Map(sm.rows.map((r, a) => [r.j, a]));
      const near = (a) => {
        const mine = sm.depth(sm.rows[a]);
        const gaps = [];
        if (sm.rows[a - 1]) gaps.push(mine - sm.depth(sm.rows[a - 1]));
        if (sm.rows[a + 1]) gaps.push(sm.depth(sm.rows[a + 1]) - mine);
        return gaps.length ? Math.min(...gaps) : 0.2;
      };
      const strikes = sm.xp.strikes;
      for (const c of tm.cells) {
        const a = jPos.get(c.j);
        const row = sm.rows[a];
        const lo = strikes[c.i - 1], hi = strikes[c.i + 1], K = strikes[c.i];
        const left = lo === undefined || lo === null ? K : lo, right = hi === undefined || hi === null ? K : hi;
        const span = Math.max((right - left) / 2, 0.5);
        const hw = (span * 0.46 / (sm.K1 - sm.K0)) * 2 * xr;
        const hd = Math.max(0.04, near(a) * 0.32) * zr;
        const cx = X(K), cz = Z(row);
        const pa = cam(cx, 0, cz);
        list.push({ c, cx, cz, hw, hd, z: pa.z, row });
      }
      list.sort((a, b) => b.z - a.z);
      for (const it of list) {
        const { c, cx, cz, hw, hd, row } = it;
        const hot = row.expiry === sel || row.j === hov;
        const rect = (y) => [[cx - hw, y, cz - hd], [cx + hw, y, cz - hd], [cx + hw, y, cz + hd], [cx - hw, y, cz + hd]];
        if (c.h === null) {
          const q = rect(0).map(([a, b, d]) => cam(a, b, d));
          ctx.beginPath();
          q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = faint;
          ctx.globalAlpha = hot ? 0.9 : 0.55;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          continue;
        }
        const yh = c.h * gk;
        const ya = Math.min(0, yh), yb = Math.max(0, yh);
        const lowP = rect(ya).map(([a, b, d]) => cam(a, b, d)), highP = rect(yb).map(([a, b, d]) => cam(a, b, d));
        const col = c.g >= 0 ? long : short;
        const faces = [
          [[1, 0, 0], [lowP[1], lowP[2], highP[2], highP[1]], 0.62],
          [[-1, 0, 0], [lowP[3], lowP[0], highP[0], highP[3]], 0.5],
          [[0, 0, 1], [lowP[2], lowP[3], highP[3], highP[2]], 0.72],
          [[0, 0, -1], [lowP[0], lowP[1], highP[1], highP[0]], 0.56],
          [[0, 1, 0], [highP[0], highP[1], highP[2], highP[3]], 0.96],
          [[0, -1, 0], [lowP[0], lowP[1], lowP[2], lowP[3]], 0.4],
        ];
        for (const [n, pts, alpha] of faces) {
          if (!faceVisible(cam, n[0], n[1], n[2], cx + n[0] * hw, (ya + yb) / 2 + n[1] * (yb - ya) / 2, cz + n[2] * hd)) continue;
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.globalAlpha = (hot ? 1 : 0.86) * alpha;
          ctx.fillStyle = col;
          ctx.fill();
          ctx.globalAlpha = 1;
          if (c.g < 0 && n[1] === 1) hatch(ctx, pts, ink);
          ctx.strokeStyle = ink;
          ctx.globalAlpha = hot ? 0.8 : 0.22;
          ctx.lineWidth = hot ? 1.2 : 0.6;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (c.clip) {
          const q = cam(cx, yh, cz);
          ctx.fillStyle = ink;
          ctx.font = "700 9px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(c.g > 0 ? "▲" : "▼", q.x, q.y + 3);
        }
      }
      fr.axes();
      for (const r of sm.rows) { const p = cam(X(clamp(sm.S !== null ? sm.S : (sm.K0 + sm.K1) / 2, sm.K0, sm.K1)), 0, Z(r)); out.rows.push({ j: r.j, x: p.x, y: p.y }); }
      fr.labels(lab);
      lab.flush();
      ctx.lineWidth = 1;
    }

    function surfaceDraw(ctx, w, hh, s, out) {
      const phone = w < 380;
      const mx = phone ? 26 : 34, my = phone ? 30 : 34;
      const lab = labeler(ctx, w, hh, (phone ? 10 : 11) + "px Inter, system-ui, sans-serif", out);
      const lo = sm.ivLo, hi = sm.ivHi;
      const deep = (r) => clamp(r * 0.62, 2.4, 4.6);
      const tall = (r) => clamp(r * 0.5, 1.1, 2.2);
      const box = (r) => [-r, r].flatMap((x) => [-deep(r), deep(r)].flatMap((z) => [[x, 0, z], [x, tall(r), z]]));
      const xr = restWidth(s, w, hh, box, mx, my, 24);
      const zr = deep(xr), yr = tall(xr);
      const cam = fitCam(view, w, hh, box(xr), mx, my, 24);
      const X = (K) => ((K - sm.K0) / (sm.K1 - sm.K0) - 0.5) * 2 * xr;
      const Z = (d) => (d * 2 - 1) * zr;
      const Y = (v) => ((clamp(v, lo, hi) - lo) / (hi - lo)) * yr;
      const step = niceStep(sm.K1 - sm.K0, phone ? 3 : 5);
      const xTicks = [];
      for (let K = Math.ceil(sm.K0 / step) * step; K <= sm.K1 + 1e-9; K += step) xTicks.push({ p: X(K), t: "$" + F.px(K, 0) });
      const zTicks = sm.rows.map((r) => ({ p: Z(sm.depth(r)), t: F.day(r.expiry), on: r.expiry === sel }));
      const ys = niceStep((hi - lo) * 100, 3) / 100;
      const yTicks = [];
      for (let v = Math.ceil(lo / ys - 1e-9) * ys; v <= hi + 1e-9; v += ys) yTicks.push({ p: Y(v), t: volPt(v) + "%" });
      const g = { w, h: hh, phone, xr, zr, y0: 0, y1: yr, xTicks, zTicks, yTicks, titles: { x: "Strike", z: "Expiry", y: "Implied vol" } };
      const fr = frame(ctx, cam, g);
      levelLines(ctx, fr, cam, g, sm, X, lab);
      const shade = ramp();
      const bg = cssVar("--surface-1"), ink = cssVar("--label-1"), accent = cssVar("--accent-ink"), faint = cssVar("--label-3");
      const Ks = Array.from({ length: NK }, (_, i) => sm.K0 + ((sm.K1 - sm.K0) * i) / (NK - 1));
      const quads = [];
      for (const q of sm.mesh) {
        for (let i = 0; i + 1 < NK; i++) {
          const corner = [[i, q.u0], [i + 1, q.u0], [i + 1, q.u1], [i, q.u1]].map(([k, u]) => { const b = sm.between(q.r0, q.r1, u, Ks[k]); return b === null ? null : { K: Ks[k], d: b.d, iv: b.iv }; });
          if (corner.some((c) => c === null)) continue;
          const p = corner.map((c) => cam(X(c.K), Y(c.iv), Z(c.d)));
          quads.push({ p, iv: corner.reduce((a, c) => a + c.iv, 0) / 4, z: p.reduce((a, c) => a + c.z, 0) / 4, interp: q.interp });
        }
      }
      quads.sort((a, b) => b.z - a.z);
      ctx.lineJoin = "round";
      for (const q of quads) {
        ctx.beginPath();
        q.p.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.globalAlpha = q.interp ? 0.55 : 0.94;
        ctx.fillStyle = shade((q.iv - lo) / (hi - lo));
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = bg;
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const r of sm.fit) {
        const line = Ks.map((K) => { const v = sm.ivAt(r, K); return v === null ? null : cam(X(K), Y(v), Z(sm.depth(r))); }).filter(Boolean);
        ctx.beginPath();
        line.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        const on = r.expiry === sel, hot = r.j === hov;
        ctx.strokeStyle = on ? accent : ink;
        ctx.globalAlpha = on || hot ? 1 : 0.7;
        ctx.lineWidth = on || hot ? 2.4 : 1.1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const r of sm.rows) for (const [K, v] of r.quotes) {
        if (K < sm.K0 || K > sm.K1 || v < lo || v > hi) continue;
        const q = cam(X(K), Y(v), Z(sm.depth(r)));
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = ink;
        ctx.fill();
        ctx.strokeStyle = bg;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      for (const ring of sm.rings) {
        const q = cam(X(ring.K), Y(ring.iv), Z(sm.depth(ring.r)));
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = ring.r.expiry === sel ? accent : faint;
        ctx.lineWidth = 2;
        ctx.stroke();
        lab.add("no fit " + F.pct(ring.iv, 1), q.x + 8, q.y + 4, "left", ring.r.expiry === sel ? 7 : 1, cssVar("--label-2"));
      }
      fr.axes();
      for (const r of sm.rows) { const p = cam(X(clamp(sm.S !== null ? sm.S : (sm.K0 + sm.K1) / 2, sm.K0, sm.K1)), 0, Z(sm.depth(r))); out.rows.push({ j: r.j, x: p.x, y: p.y }); }
      fr.labels(lab);
      lab.flush();
    }

    const summaryT = ticker + " dealer gamma terrain by strike and expiry, " + gName(sm.xp) + ", " + DEALER_CLAUSE + "; the table below lists every cell.";
    const summaryV = ticker + " implied volatility surface from the engine's fitted smiles over strike and expiry, " + fitN + " fitted expiries; the table below lists them.";
    gCol.append(h("h3", { id: "ftsfTg" }, "Gamma terrain ", h("span", { class: "ftsf-sub" }, sm.xp.basis === "traded" ? "traded, no dollar unit" : "$ per 1% move")));
    vCol.append(h("h3", { id: "ftsfTv" }, "Volatility surface ", h("span", { class: "ftsf-sub" }, "SVI per expiry")));
    const stT = tm ? stage(gCol, summaryT, terrainDraw, view, hooks) : null;
    const stV = fitN ? stage(vCol, summaryV, surfaceDraw, view, hooks) : null;
    if (!tm) gCol.append(UI.silent({ state: "unavailable", reason: sm.xp.why.gamma || "No strike and expiry pair carried gamma." }, "Gamma terrain", 120), h("p", { class: "ftsf-cap" }, "No gamma by strike and expiry on this card, so the terrain is withheld. " + (sm.xp.why.gamma || "")));
    if (!fitN) vCol.append(UI.silent({ state: "unavailable", reason: sm.xp.why.smile || "No expiry on this card carries a fitted smile, only at-the-money levels." }, "Volatility surface", 120), h("p", { class: "ftsf-cap" }, "No fitted smile on this card" + (sm.rings.length ? ", only at-the-money levels: " + sm.rings.map((x) => F.day(x.r.expiry) + " " + F.pct(x.iv, 1)).join(", ") : "") + ", so no surface is drawn."));
    for (const st of [stT, stV]) if (st) stages.push(st);

    function paintCanvases() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (!dead) for (const st of stages) st.paint(); });
    }
    const paintNow = () => { for (const st of stages) st.paint(); };

    const rowsT = sm.rows.map((r) => {
      const k = GM.skew(r, FQ);
      return [F.day(r.expiry) + " " + MID.trim() + " " + r.dte + "d", r.label, r.atm === null ? DASH : pctOf(r.atm),
        k ? F.px(k.Kp) + " at " + pctOf(k.ivp) : DASH, k ? F.px(k.Kc) + " at " + pctOf(k.ivc) : DASH,
        k ? F.signed(k.rr * 100, 1) : DASH, r.eng && r.eng.rr25 !== null && r.state !== "none" ? F.signed(r.eng.rr25 * 100, 1) : DASH,
        k ? F.signed(k.bf * 100, 1) : DASH, r.eng && r.eng.bf25 !== null && r.state !== "none" ? F.signed(r.eng.bf25 * 100, 1) : DASH];
    });
    const tabV = tableOf(ticker + " fitted smile by expiry: 25-delta strikes and implied volatilities, risk reversal and butterfly in vol points, this page against the engine's stored figures", ["Expiry", "Fit", "At the money", "25Δ put", "25Δ call", "RR", "RR engine", "BF", "BF engine"], rowsT);
    const calNote = h("p", { class: "ftsf-cap" }, sm.calendar.breaks.length
      ? "Calendar check: " + sm.calendar.breaks.length + " strikes where total variance falls with expiry across fitted expiries, first at " + F.px(sm.calendar.breaks[0].K) + "."
      : fitN > 1 ? "Calendar check: no break in total variance across " + fitN + " fitted expiries, " + sm.calendar.checked + " strike and expiry pairs." : "Calendar check: fewer than two fitted expiries, nothing to compare.");
    const tabG = tm ? tableOf(ticker + (sm.xp.basis === "traded" ? " traded gamma" : " open-interest book gamma, dollars per 1% move ") + " by strike and expiry " + DEALER_CLAUSE, ["Strike"].concat(tm.rows.map((r) => F.day(r.expiry))),
      tm.strikes.map((K) => [F.px(K, K % 1 ? 1 : 0)].concat(tm.rows.map((r) => { const g = r.gamma[sm.xp.strikes.indexOf(K)]; return g === null ? DASH : GSIGN[Math.sign(g)] + gWord(sm.xp, Math.abs(g)); })))
        .concat([["Net, measured cells"].concat(tm.net.map((v) => (v === null ? DASH : GSIGN[Math.sign(v)] + gWord(sm.xp, Math.abs(v)))))])) : null;
    dockEl.append(h("details", { class: "ftsf-tab" }, h("summary", null, "Read it as a table, and how it is drawn"), tabV, calNote, tabG || h("p", { class: "ftsf-cap" }, "No gamma cells to list."),
      h("p", { class: "ftsf-cap" }, "Fitted body: the engine's stored SVI parameters, read at strikes on the forward of each expiry; between two fitted expiries the surface interpolates total variance linearly in time at a fixed strike, and an expiry with no fit is a ring at its at-the-money level, never a curve. Faded rows interpolate across an expiry with no fit. Gamma is exposure at listed strikes, so it is columns, and a pair the vendor did not return is a dashed outline, never zero. Nothing here is a forecast.")));

    paintChips();
    paintKey();
    paintSmile();
    paintNow();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!dead) { for (const st of stages) st.s.rest = null; paintNow(); } });
    let ro = null;
    if (typeof ResizeObserver === "function") { let last = host.clientWidth + "x" + host.clientHeight; ro = new ResizeObserver(() => { const k = host.clientWidth + "x" + host.clientHeight; if (k === last) return; last = k; for (const st of stages) st.s.rest = null; paintSmile(); paintCanvases(); }); ro.observe(host); }
    return {
      destroy() { dead = true; cancelAnimationFrame(raf); document.removeEventListener("ft:expiry", onExpiry); if (ro) ro.disconnect(); host.replaceChildren(); },
      reset: hooks.reset,
      setExpiry(iso) { select(iso, false); },
      expiry: () => sel,
      view: () => ({ yaw: view.yaw / DEG, pitch: view.pitch / DEG }),
      model: { surface: sm, terrain: tm },
      repaint: paintNow,
      stages,
    };
  }

  function tableOf(caption, head, rows) {
    return h("div", { class: "ftsf-scroll" }, h("table", null, h("caption", null, caption),
      h("thead", null, h("tr", null, head.map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", null, rows.map((r) => h("tr", null, r.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", null, c))))))));
  }

  const tickerSurface = Object.freeze({ mount, model: Object.freeze({ surface: surfaceModel, terrain: terrainModel }) });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { tickerSurface }));
})();
