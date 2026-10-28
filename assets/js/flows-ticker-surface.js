(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI || !UI.tickerGlance) return;
  const { h, F, cssVar } = UI;
  const GM = UI.tickerGlance.model;
  const DEG = Math.PI / 180;
  const REST_YAW = -34 * DEG, REST_PITCH = 36 * DEG;
  const YAW_MAX = 55 * DEG, PITCH_MIN = 8 * DEG, PITCH_MAX = 60 * DEG, ZOOM_MIN = 0.7, ZOOM_MAX = 2.4;
  const GROW_MS = 640, TWEEN_MS = 520, CAM_MS = 520, COUNT_MS = 360, RISE_MS = 460, AUTO_DEG_S = 7, AUTO_IDLE_MS = 1800;
  const PRESETS = { front: { yaw: 0, pitch: 14 * DEG, zoom: 1 }, side: { yaw: 52 * DEG, pitch: 14 * DEG, zoom: 1 }, top: { yaw: 0, pitch: PITCH_MAX, zoom: 1 }, reset: { yaw: REST_YAW, pitch: REST_PITCH, zoom: 1 } };
  const EASE = {
    out: (t) => 1 - Math.pow(1 - t, 3),
    io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    back: (t) => 1 + 2.35 * Math.pow(t - 1, 3) + 1.35 * Math.pow(t - 1, 2),
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const DEALER_CLAUSE = "on the vendor's convention (dealers long calls, short puts)";
  const VOL = ["--vol-1", "--vol-2", "--vol-3", "--vol-4", "--vol-5", "--vol-6"];
  const CLIP = 1.25;
  const SUB = 3;
  const DOTS = [2, 3], NODASH = [];
  const NK = 34;
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
    f.put = (x, y, z, b, o) => {
      const X = x * cyw + z * syw;
      let Z = -x * syw + z * cyw;
      const Y = y * cp + Z * sp;
      Z = Z * cp - y * sp;
      const k = dist / (dist + Z);
      b[o] = cx + X * k * scale;
      b[o + 1] = cy - Y * k * scale;
      b[o + 2] = Z;
    };
    f.vis = (nx, ny, nz, qx, qy, qz) => {
      const nX = nx * cyw + nz * syw, nZr = -nx * syw + nz * cyw, nY = ny * cp + nZr * sp, nZ = nZr * cp - ny * sp;
      const cX = qx * cyw + qz * syw, cZr = -qx * syw + qz * cyw, cY = qy * cp + cZr * sp, cZ = cZr * cp - qy * sp;
      return nX * cX + nY * cY + nZ * (cZ + dist) < 0;
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
    const scale = view.zoom * Math.min((w - 2 * mx) / Math.max(x1 - x0, 1e-6), (hh - 2 * my) / Math.max(y1 - y0, 1e-6));
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

  function stage(host, label, draw, hooks, id) {
    const wrap = h("div", { class: "ftsf-cv" });
    const cv = h("canvas", { role: "img", tabindex: "0", "aria-label": label });
    const tip = h("div", { class: "ftsf-tip", "aria-hidden": "true", hidden: true }, h("span", { class: "ftsf-tip-l" }), h("b", { class: "ftsf-tip-v" }));
    wrap.append(cv, tip);
    host.append(wrap);
    const s = { id, rest: null, last: null, paints: 0, pool: [], np: 0, tip, tipL: tip.firstChild, tipV: tip.lastChild };
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
      s.np = 0;
      const out = { labels: [], boxes: [], dropped: [], rows: [], tip: null };
      draw(ctx, w, hh, s, out);
      s.last = out;
      s.paints++;
      cv.dataset.labels = out.labels.join("|");
      cv.dataset.boxes = JSON.stringify(out.boxes);
      cv.dataset.dropped = out.dropped.join("|");
    };
    s.addPt = (x, y, j, i, K, v, d, k) => {
      let p = s.pool[s.np];
      if (!p) { p = {}; s.pool[s.np] = p; }
      p.x = x; p.y = y; p.j = j; p.i = i; p.K = K; p.v = v; p.d = d; p.k = k;
      s.np++;
    };
    const pick = (ev) => {
      const r = cv.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      let best = null, bd = 1e9;
      for (let n = 0; n < s.np; n++) { const p = s.pool[n]; const d = Math.hypot(p.x - mx, p.y - my); if (d < bd) { bd = d; best = p; } }
      return best && bd < 30 ? best : null;
    };
    const ptrs = new Map();
    let drag = null, pinch = null;
    const span = () => { const q = [...ptrs.values()]; return Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y) || 1; };
    cv.addEventListener("pointerdown", (ev) => {
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      try { cv.setPointerCapture(ev.pointerId); } catch (e) { void e; }
      if (ptrs.size === 2) { pinch = { d: span(), z: hooks.zoomGoal() }; if (drag) { hooks.down(false); drag = null; } return; }
      drag = { x: ev.clientX, y: ev.clientY, moved: false, trail: [] };
      hooks.down(true);
    });
    cv.addEventListener("pointermove", (ev) => {
      if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && ptrs.size >= 2) { hooks.zoomTo(pinch.z * (span() / pinch.d)); return; }
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          hooks.orbit(dx * 0.4, dy * 0.3);
          drag.trail.push({ t: ev.timeStamp, a: dx * 0.4, b: dy * 0.3 });
          if (drag.trail.length > 6) drag.trail.shift();
          drag.x = ev.clientX;
          drag.y = ev.clientY;
        }
      } else if (ev.pointerType === "mouse" || ev.pointerType === "pen") hooks.hover(id, pick(ev));
    });
    const end = (ev) => {
      ptrs.delete(ev.pointerId);
      if (pinch) { if (ptrs.size < 2) pinch = null; return; }
      if (!drag) return;
      const d = drag;
      drag = null;
      hooks.down(false);
      if (!d.moved && ev.type === "pointerup") { const p = pick(ev); if (p) { hooks.hover(id, p); hooks.pick(p.j); } return; }
      if (d.moved) {
        const tr = d.trail.filter((q) => ev.timeStamp - q.t < 120);
        if (tr.length > 1) {
          const dt = Math.max(16, ev.timeStamp - tr[0].t);
          hooks.release(tr.reduce((a, q) => a + q.a, 0) / dt * 1000, tr.reduce((a, q) => a + q.b, 0) / dt * 1000);
        }
      }
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { if (!drag) hooks.hover(id, null); });
    cv.addEventListener("dblclick", (ev) => { ev.preventDefault(); hooks.go("reset"); });
    cv.addEventListener("wheel", (ev) => { ev.preventDefault(); hooks.zoomBy(Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0016))); }, { passive: false });
    cv.addEventListener("keydown", (ev) => {
      const d = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 3], ArrowDown: [0, -3] }[ev.key];
      if (d) { ev.preventDefault(); hooks.orbit(d[0], d[1]); return; }
      if (ev.key === "Home") { ev.preventDefault(); hooks.go("reset"); }
      else if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); hooks.zoomBy(1.2); }
      else if (ev.key === "-" || ev.key === "_") { ev.preventDefault(); hooks.zoomBy(1 / 1.2); }
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

  const FACES = [[1, 0, 0, 1, 2, 6, 5, 0.62], [-1, 0, 0, 3, 0, 4, 7, 0.5], [0, 0, 1, 2, 3, 7, 6, 0.72], [0, 0, -1, 0, 1, 5, 4, 0.56], [0, 1, 0, 4, 5, 6, 7, 0.96], [0, -1, 0, 0, 1, 2, 3, 0.4]];

  function facePath(ctx, P, f) {
    ctx.beginPath();
    ctx.moveTo(P[f[3] * 3], P[f[3] * 3 + 1]);
    ctx.lineTo(P[f[4] * 3], P[f[4] * 3 + 1]);
    ctx.lineTo(P[f[5] * 3], P[f[5] * 3 + 1]);
    ctx.lineTo(P[f[6] * 3], P[f[6] * 3 + 1]);
    ctx.closePath();
  }

  function hatch(ctx, P, f, color) {
    let x0 = Infinity, x1 = -Infinity, ya = Infinity, yb = -Infinity;
    for (let n = 3; n < 7; n++) {
      const x = P[f[n] * 3], y = P[f[n] * 3 + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < ya) ya = y;
      if (y > yb) yb = y;
    }
    ctx.save();
    facePath(ctx, P, f);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.3;
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
    let sm = surfaceModel(card, FQ);
    let tm = terrainModel(sm);
    const ticker = card.ticker;
    if (!sm.rows.length) {
      host.append(UI.silent({ state: "unavailable", reason: (sm.why.smile && sm.why.gamma ? sm.why.gamma + " " + sm.why.smile : sm.why.gamma || sm.why.smile || "The card carries no expiries.") }, "Surface and terrain", 140),
        h("p", { class: "ftsf-cap" }, "This card holds neither a fitted smile nor gamma by strike and expiry, so there is no surface or terrain to draw."));
      return { destroy() {}, reset() {}, setExpiry() {}, expiry: () => null, model: { surface: sm, terrain: tm }, repaint() {}, update: () => false, motion: () => ({ moving: false, paints: 0 }) };
    }
    const view = { yaw: REST_YAW, pitch: REST_PITCH, zoom: 1 };
    const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const M = {
      reduced: !!(mq && mq.matches), grow: 1, growT0: 0, cam: null, vy: 0, vp: 0, zt: 1, auto: false, dir: 1, userAt: -1e9, down: false, visible: document.visibilityState !== "hidden", inView: true,
      tw: 1, twT0: 0, prev: null, rise: null, riseP: 1, riseT0: 0, emph: [], spot: 0, spotT: 0, hs: -1, hj: -1, hi: -1, hK: 0, hd: 0, hy: 0, hk: 0, hdd: 0, hyy: 0, hv: null, hl: "",
      cu: null, shown: null, last: 0, raf: 0, dirty: false, frames: 0,
    };
    let sel = input.expiry && sm.rows.some((r) => r.expiry === input.expiry) ? input.expiry : GM.defaultExpiry(sm.rows);
    let dead = false;
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
    const rowEl = h("div", { class: "ftsf-row" }, keyEl);
    const xcFlag = document.getElementById("ftSurface");
    const xcHost = xcFlag && xcFlag.dataset.xcheck ? h("div", { class: "ftxc", id: "ftXcheck", hidden: true }) : null;
    let xc = null;
    let xcApi = null;
    root.append(chipsEl, rowEl, colsEl, ...(xcHost ? [xcHost] : []), dockEl);
    host.append(root);
    if (xcHost && UI.defer) {
      UI.defer("xcheck", { when: "idle", el: root, label: "The engine cross-check" }).then(() => {
        const api = window.FlowsUI && window.FlowsUI.xcheck;
        if (dead || !api) return;
        xcApi = api;
        return api.ready.then(() => { if (!dead) xc = api.mount(xcHost, input.cardX || null, { buttonHost: document.getElementById("ftGReset") }); });
      });
    }

    const emit = (iso) => document.dispatchEvent(new CustomEvent("ft:expiry", { bubbles: true, detail: { expiry: iso, source: "surface" } }));
    const select = (iso, refocus) => {
      if (!sm.rows.some((r) => r.expiry === iso) || (iso === sel && !refocus)) return;
      const changed = iso !== sel;
      sel = iso;
      if (changed) startRise();
      paintChips();
      paintSmile();
      paintCanvases();
      if (changed) emit(iso);
      if (refocus) { const b = chipsEl.querySelector('[aria-pressed="true"]'); if (b) b.focus({ preventScroll: true }); }
    };
    const onExpiry = (e) => { const d = e.detail || {}; if (d.source !== "surface" && typeof d.expiry === "string" && d.expiry !== sel && sm.rows.some((r) => r.expiry === d.expiry)) { sel = d.expiry; startRise(); paintChips(); paintSmile(); paintCanvases(); } };
    document.addEventListener("ft:expiry", onExpiry);

    const nowMs = () => performance.now();
    const rowAt = (iso) => sm.rows.findIndex((r) => r.expiry === iso);
    const startRise = () => { if (M.reduced) { M.rise = null; return; } M.rise = rowAt(sel); M.riseT0 = nowMs(); M.riseP = 0; };
    const touched = () => { M.userAt = nowMs(); };
    const cutTo = (to) => { view.yaw = to.yaw; view.pitch = to.pitch; view.zoom = to.zoom; M.zt = to.zoom; M.cam = null; };
    const hooks = {
      down(on) { M.down = on; touched(); if (on) { M.cam = null; M.vy = M.vp = 0; M.zt = view.zoom; } wake(); },
      orbit(dy, dp) {
        M.cam = null;
        M.vy = M.vp = 0;
        view.yaw = clamp(view.yaw + dy * DEG, -YAW_MAX, YAW_MAX);
        view.pitch = clamp(view.pitch + dp * DEG, PITCH_MIN, PITCH_MAX);
        touched();
        wake();
      },
      release(vy, vp) {
        if (M.reduced) return;
        M.vy = clamp(vy, -260, 260);
        M.vp = clamp(vp, -200, 200);
        wake();
      },
      go(name) {
        const to = typeof name === "string" ? PRESETS[name] : name;
        M.vy = M.vp = 0;
        touched();
        if (M.reduced) cutTo(to);
        else { M.cam = { from: { yaw: view.yaw, pitch: view.pitch, zoom: view.zoom }, to: { yaw: clamp(to.yaw, -YAW_MAX, YAW_MAX), pitch: clamp(to.pitch, PITCH_MIN, PITCH_MAX), zoom: clamp(to.zoom, ZOOM_MIN, ZOOM_MAX) }, t0: nowMs(), dur: CAM_MS }; M.zt = M.cam.to.zoom; }
        wake();
      },
      zoomGoal: () => M.zt,
      zoomTo(z) { M.cam = null; M.zt = clamp(z, ZOOM_MIN, ZOOM_MAX); touched(); if (M.reduced) view.zoom = M.zt; wake(); },
      zoomBy(f) { hooks.zoomTo(M.zt * f); },
      hover(id, p) {
        if (!p) { if (M.spotT !== 0) { M.spotT = 0; wake(); } return; }
        const same = M.hs === id && M.hj === p.j && M.hi === p.i && M.hK === p.K;
        if (same && M.spotT === 1) return;
        if (M.spot < 0.02 || M.hs !== id) { M.hk = p.K; M.hdd = p.d; M.hyy = p.k; }
        M.hs = id; M.hj = p.j; M.hi = p.i; M.hK = p.K; M.hd = p.d; M.hy = p.k; M.spotT = 1;
        const row = sm.rows.find((r) => r.j === p.j);
        M.hl = "$" + F.px(p.K, p.K % 1 ? 1 : 0) + MID + (row ? F.day(row.expiry) : "");
        M.cu = M.reduced || M.shown === null ? null : { from: M.shown, to: p.v, t0: nowMs() };
        M.hv = p.v;
        if (!M.cu) M.shown = p.v;
        wake();
      },
      pick(j) { const r = sm.rows.find((x) => x.j === j); if (r) select(r.expiry, false); },
      step(d) { const i = rowAt(sel); const n = sm.rows[clamp(i + d, 0, sm.rows.length - 1)]; select(n.expiry, false); },
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
      if (tm.hMax === undefined) { let mx1 = 0, mn1 = 0; for (const c of tm.cells) if (c.h !== null) { if (c.h > mx1) mx1 = c.h; if (c.h < mn1) mn1 = c.h; } tm.hMax = mx1; tm.hMin = mn1; }
      const hMax = tm.hMax, hMin = tm.hMin;
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
      const items = s.items || (s.items = []);
      const P = s.P || (s.P = new Float64Array(24)), Q = s.Q || (s.Q = new Float64Array(3));
      const strikes = sm.xp.strikes;
      if (tm.geo !== sm) {
        const jPos = new Map(sm.rows.map((r, a) => [r.j, a]));
        const near = (a) => {
          const mine = sm.depth(sm.rows[a]);
          let g = Infinity;
          if (sm.rows[a - 1]) g = Math.min(g, mine - sm.depth(sm.rows[a - 1]));
          if (sm.rows[a + 1]) g = Math.min(g, sm.depth(sm.rows[a + 1]) - mine);
          return g === Infinity ? 0.2 : g;
        };
        for (const c of tm.cells) {
          const a = jPos.get(c.j);
          const lo = strikes[c.i - 1], hi = strikes[c.i + 1], K = strikes[c.i];
          const left = lo === undefined || lo === null ? K : lo, right = hi === undefined || hi === null ? K : hi;
          c.a = a;
          c.fw = (Math.max((right - left) / 2, 0.5) * 0.46 / (sm.K1 - sm.K0)) * 2;
          c.fd = Math.max(0.04, near(a) * 0.32);
          c.fx = ((K - sm.K0) / (sm.K1 - sm.K0) - 0.5) * 2;
          c.fz = sm.depth(sm.rows[a]) * 2 - 1;
        }
        tm.geo = sm;
      }
      let n = 0;
      for (const c of tm.cells) {
        const it = items[n] || (items[n] = {});
        n++;
        it.c = c;
        it.cx = c.fx * xr;
        it.cz = c.fz * zr;
        it.hw = c.fw * xr;
        it.hd = c.fd * zr;
        cam.put(it.cx, 0, it.cz, Q, 0);
        it.z = Q[2];
      }
      const list = items.length === n ? items : items.slice(0, n);
      list.sort((a, b) => b.z - a.z);
      const zMax = n ? list[0].z : 1, zMin = n ? list[n - 1].z : 0, zSpan = Math.max(zMax - zMin, 1e-6);
      const spot = M.hs === s.id ? M.spot : 0;
      const hovJ = spot > 0 ? M.hj : -1, hovI = spot > 0 ? M.hi : -1;
      const eT = EASE.out(M.tw);
      const nRows = sm.rows.length;
      const gfa = (a) => (M.grow >= 1 ? 1 : EASE.back(clamp(M.grow * 1.6 - (nRows > 1 ? a / (nRows - 1) : 0) * 0.6, 0, 1)));
      const bg = cssVar("--surface-1"), accent = cssVar("--accent-ink");
      const seen = s.seen || (s.seen = new Int8Array(6));
      for (let li = 0; li < n; li++) {
        const it = list[li];
        const { c, cx, cz, hw, hd } = it;
        const a = c.a, row = sm.rows[a];
        const em = M.emph[a] === undefined ? (row.expiry === sel ? 1 : 0) : M.emph[a];
        const onRow = row.j === hovJ, onCol = c.i === hovI, lit = onRow && onCol;
        const fog = 1 - 0.34 * (it.z - zMin) / zSpan;
        const dim = 1 - 0.32 * spot * (onRow || onCol ? 0 : 1);
        const warm = Math.max(em, (onRow || onCol) ? spot : 0);
        if (c.h === null) {
          cam.put(cx - hw, 0, cz - hd, P, 0);
          cam.put(cx + hw, 0, cz - hd, P, 3);
          cam.put(cx + hw, 0, cz + hd, P, 6);
          cam.put(cx - hw, 0, cz + hd, P, 9);
          ctx.beginPath();
          ctx.moveTo(P[0], P[1]);
          ctx.lineTo(P[3], P[4]);
          ctx.lineTo(P[6], P[7]);
          ctx.lineTo(P[9], P[10]);
          ctx.closePath();
          ctx.setLineDash(DOTS);
          ctx.strokeStyle = faint;
          ctx.globalAlpha = (0.5 + 0.4 * warm) * fog;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash(NODASH);
          ctx.globalAlpha = 1;
          continue;
        }
        const rf = M.rise === a && M.riseP < 1 ? lerp(0.45, 1, EASE.out(M.riseP)) : 1;
        const shown = c.s === undefined || M.tw >= 1 ? c.h : c.s + (c.h - c.s) * eT;
        const yh = shown * gk * gfa(a) * rf;
        const ya = Math.min(0, yh), yb = Math.max(0, yh);
        for (let q = 0; q < 2; q++) {
          const y = q ? yb : ya, o = q * 12;
          cam.put(cx - hw, y, cz - hd, P, o);
          cam.put(cx + hw, y, cz - hd, P, o + 3);
          cam.put(cx + hw, y, cz + hd, P, o + 6);
          cam.put(cx - hw, y, cz + hd, P, o + 9);
        }
        s.addPt((P[12] + P[18]) / 2, (P[13] + P[19]) / 2, row.j, c.i, c.K, c.g, sm.depth(row), c.h);
        const col = c.g >= 0 ? long : short;
        let ns = 0;
        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          if (!cam.vis(f[0], f[1], f[2], cx + f[0] * hw, (ya + yb) / 2 + f[1] * (yb - ya) / 2, cz + f[2] * hd)) continue;
          seen[ns++] = fi;
          facePath(ctx, P, f);
          ctx.globalAlpha = Math.min(1, (0.86 + 0.14 * warm) * f[7] * fog * dim);
          ctx.fillStyle = col;
          ctx.fill();
          if (f[1] === 1) { ctx.globalAlpha = (0.1 + 0.16 * warm) * fog; ctx.fillStyle = bg; ctx.fill(); }
          ctx.globalAlpha = 1;
          if (c.g < 0 && f[1] === 1) hatch(ctx, P, f, ink);
          ctx.strokeStyle = ink;
          ctx.globalAlpha = (0.22 + 0.58 * warm) * fog;
          ctx.lineWidth = 0.6 + 0.6 * warm;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (lit) {
          ctx.lineJoin = "round";
          for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = accent;
            ctx.lineWidth = pass ? 2.2 : 6;
            ctx.globalAlpha = pass ? spot : 0.22 * spot;
            for (let k = 0; k < ns; k++) { facePath(ctx, P, FACES[seen[k]]); ctx.stroke(); }
          }
          ctx.globalAlpha = 1;
        }
        if (c.clip) {
          cam.put(cx, yh, cz, Q, 0);
          ctx.fillStyle = ink;
          ctx.font = "700 9px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(c.g > 0 ? "▲" : "▼", Q[0], Q[1] + 3);
        }
      }
      fr.axes();
      if (spot > 0) {
        const kx = X(M.hk), zz = (M.hdd * 2 - 1) * zr;
        fr.seg([kx, 0, -zr], [kx, 0, zr], accent, 1.1, 0.7 * spot, [3, 3]);
        fr.seg([-xr, 0, zz], [xr, 0, zz], accent, 1.1, 0.7 * spot, [3, 3]);
        const q = cam(kx, M.hyy * gk, zz);
        fr.seg([kx, 0, zz], [kx, M.hyy * gk, zz], accent, 1.4, 0.9 * spot);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4.2, 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.fillStyle = bg;
        ctx.lineWidth = 2;
        ctx.globalAlpha = spot;
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        out.tip = { x: q.x, y: q.y };
      }
      for (const r of sm.rows) { const p = cam(X(clamp(sm.S !== null ? sm.S : (sm.K0 + sm.K1) / 2, sm.K0, sm.K1)), 0, Z(r)); out.rows.push({ j: r.j, x: p.x, y: p.y }); }
      fr.labels(lab);
      lab.flush();
      ctx.lineWidth = 1;
    }

    function surfaceDraw(ctx, w, hh, s, out) {
      const phone = w < 380;
      const mx = phone ? 26 : 34, my = phone ? 30 : 34;
      const lab = labeler(ctx, w, hh, (phone ? 10 : 11) + "px Inter, system-ui, sans-serif", out);
      const eT = EASE.out(M.tw);
      const pv = M.prev && M.tw < 1 ? M.prev : null;
      const lo = pv && pv.ivLo !== null ? lerp(pv.ivLo, sm.ivLo, eT) : sm.ivLo, hi = pv && pv.ivHi !== null ? lerp(pv.ivHi, sm.ivHi, eT) : sm.ivHi;
      const deep = (r) => clamp(r * 0.62, 2.4, 4.6);
      const tall = (r) => clamp(r * 0.5, 1.1, 2.2);
      const box = (r) => [-r, r].flatMap((x) => [-deep(r), deep(r)].flatMap((z) => [[x, 0, z], [x, tall(r), z]]));
      const xr = restWidth(s, w, hh, box, mx, my, 24);
      const zr = deep(xr), yr = tall(xr);
      const cam = fitCam(view, w, hh, box(xr), mx, my, 24);
      const X = (K) => ((K - sm.K0) / (sm.K1 - sm.K0) - 0.5) * 2 * xr;
      const Z = (d) => (d * 2 - 1) * zr;
      const gfd = (d) => (M.grow >= 1 ? 1 : EASE.back(clamp(M.grow * 1.6 - d * 0.6, 0, 1)));
      const Y = (v, d) => ((clamp(v, lo, hi) - lo) / (hi - lo)) * yr * (d === undefined ? 1 : gfd(d));
      const oldRow = (r) => (pv ? pv.fit.find((x) => x.expiry === r.expiry) : undefined);
      const ivNow = (r, K) => {
        const v = sm.ivAt(r, K);
        const o = pv && v !== null ? oldRow(r) : undefined;
        const ov = o ? pv.ivAt(o, K) : null;
        return ov === null || ov === undefined ? v : lerp(ov, v, eT);
      };
      const bNow = (r0, r1, u, K) => {
        const b = sm.between(r0, r1, u, K);
        if (!b || !pv) return b;
        const o0 = oldRow(r0), o1 = oldRow(r1);
        const ob = o0 && o1 ? pv.between(o0, o1, u, K) : null;
        return ob ? { w: b.w, T: b.T, d: b.d, iv: lerp(ob.iv, b.iv, eT) } : b;
      };
      const step = niceStep(sm.K1 - sm.K0, phone ? 3 : 5);
      const xTicks = [];
      for (let K = Math.ceil(sm.K0 / step) * step; K <= sm.K1 + 1e-9; K += step) xTicks.push({ p: X(K), t: "$" + F.px(K, 0) });
      const zTicks = sm.rows.map((r) => ({ p: Z(sm.depth(r)), t: F.day(r.expiry), on: r.expiry === sel }));
      const ys = niceStep((hi - lo) * 100, 3) / 100;
      const yTicks = [];
      for (let v = Math.ceil(lo / ys - 1e-9) * ys; v <= hi + 1e-9; v += ys) yTicks.push({ p: Y(v), t: volPt(v) + "%" });
      const spot = M.hs === s.id ? M.spot : 0;
      const hovJ = spot > 0 ? M.hj : -1;
      const g = { w, h: hh, phone, xr, zr, y0: 0, y1: yr, xTicks, zTicks, yTicks, titles: { x: "Strike", z: "Expiry", y: "Implied vol" } };
      const fr = frame(ctx, cam, g);
      levelLines(ctx, fr, cam, g, sm, X, lab);
      const bg = cssVar("--surface-1"), ink = cssVar("--label-1"), accent = cssVar("--accent-ink"), faint = cssVar("--label-3");
      const Ks = Array.from({ length: NK }, (_, i) => sm.K0 + ((sm.K1 - sm.K0) * i) / (NK - 1));
      const R = sm.mesh.length, VN = R * 2 * NK;
      if (!s.mb || s.mb.n !== VN) s.mb = { n: VN, vx: new Float64Array(VN), vy: new Float64Array(VN), vz: new Float64Array(VN), iv: new Float64Array(VN), dd: new Float64Array(VN), ok: new Uint8Array(VN), cache: null, ids: [], qz: new Float64Array(R * NK), qsh: new Float64Array(R * NK), qiv: new Float64Array(R * NK) };
      const mb = s.mb;
      if (pv || !mb.cache || mb.cache !== sm) {
        for (let r = 0; r < R; r++) {
          const q = sm.mesh[r];
          for (let side = 0; side < 2; side++) {
            for (let k = 0; k < NK; k++) {
              const o = (r * 2 + side) * NK + k;
              const b = bNow(q.r0, q.r1, side ? q.u1 : q.u0, Ks[k]);
              mb.ok[o] = b === null ? 0 : 1;
              mb.iv[o] = b === null ? 0 : b.iv;
              mb.dd[o] = b === null ? 0 : b.d;
            }
          }
        }
        mb.cache = pv ? null : sm;
      }
      const V = s.V || (s.V = new Float64Array(3));
      for (let o = 0; o < VN; o++) {
        if (!mb.ok[o]) continue;
        const k = o % NK;
        cam.put(X(Ks[k]), Y(mb.iv[o], mb.dd[o]), Z(mb.dd[o]), V, 0);
        mb.vx[o] = V[0]; mb.vy[o] = V[1]; mb.vz[o] = V[2];
      }
      const ids = mb.ids;
      ids.length = 0;
      const span = Math.max(hi - lo, 1e-9);
      for (let r = 0; r < R; r++) {
        for (let k = 0; k + 1 < NK; k++) {
          const a0 = (r * 2) * NK + k, a1 = a0 + 1, b0 = (r * 2 + 1) * NK + k, b1 = b0 + 1;
          if (!(mb.ok[a0] && mb.ok[a1] && mb.ok[b0] && mb.ok[b1])) continue;
          const id = r * NK + k;
          const dK = (mb.iv[a1] - mb.iv[a0] + mb.iv[b1] - mb.iv[b0]) / 2, dU = (mb.iv[b0] - mb.iv[a0] + mb.iv[b1] - mb.iv[a1]) / 2;
          mb.qz[id] = (mb.vz[a0] + mb.vz[a1] + mb.vz[b0] + mb.vz[b1]) / 4;
          mb.qiv[id] = (mb.iv[a0] + mb.iv[a1] + mb.iv[b0] + mb.iv[b1]) / 4;
          mb.qsh[id] = 0.5 + clamp(((-dK * 1.2 + dU * 0.9) / span) * 5, -0.5, 0.5);
          ids.push(id);
        }
      }
      ids.sort((p1, p2) => mb.qz[p2] - mb.qz[p1]);
      const zMax = ids.length ? mb.qz[ids[0]] : 1, zMin = ids.length ? mb.qz[ids[ids.length - 1]] : 0, zSpan = Math.max(zMax - zMin, 1e-6);
      ctx.lineJoin = "round";
      const lut = s.lut && s.lut.key === lo + ":" + hi + ":" + cssVar("--vol-1") ? s.lut : (s.lut = { key: lo + ":" + hi + ":" + cssVar("--vol-1"), c: ((shade) => Array.from({ length: 64 }, (_, i) => shade(i / 63)))(ramp()) });
      for (const id of ids) {
        const r = (id / NK) | 0, k = id % NK;
        const a0 = (r * 2) * NK + k, a1 = a0 + 1, b0 = (r * 2 + 1) * NK + k, b1 = b0 + 1;
        ctx.beginPath();
        ctx.moveTo(mb.vx[a0], mb.vy[a0]);
        ctx.lineTo(mb.vx[a1], mb.vy[a1]);
        ctx.lineTo(mb.vx[b1], mb.vy[b1]);
        ctx.lineTo(mb.vx[b0], mb.vy[b0]);
        ctx.closePath();
        const fog = 1 - 0.3 * (mb.qz[id] - zMin) / zSpan;
        const sh = mb.qsh[id];
        ctx.globalAlpha = (sm.mesh[r].interp ? 0.55 : 0.94) * fog;
        ctx.fillStyle = lut.c[Math.round(clamp((mb.qiv[id] - lo) / span, 0, 1) * 63)];
        ctx.fill();
        if (sh > 0.58) { ctx.globalAlpha = (sh - 0.58) * 0.55 * fog; ctx.fillStyle = bg; ctx.fill(); } else if (sh < 0.42) { ctx.globalAlpha = (0.42 - sh) * 0.4 * fog; ctx.fillStyle = ink; ctx.fill(); }
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = bg;
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const r of sm.fit) {
        const d = sm.depth(r), a = sm.rows.indexOf(r);
        const em = M.emph[a] === undefined ? (r.expiry === sel ? 1 : 0) : M.emph[a];
        const hot = r.j === hovJ ? spot : 0, warm = Math.max(em, hot);
        ctx.beginPath();
        let started = false;
        for (let k = 0; k < NK; k++) {
          const v = ivNow(r, Ks[k]);
          if (v === null) continue;
          const q = cam(X(Ks[k]), Y(v, d), Z(d));
          if (started) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); started = true; }
          s.addPt(q.x, q.y, r.j, k, Ks[k], v, d, v);
        }
        if (em > 0.5 && M.riseP < 1) { ctx.strokeStyle = accent; ctx.globalAlpha = 0.3 * (1 - M.riseP); ctx.lineWidth = 7; ctx.stroke(); }
        ctx.strokeStyle = em > 0.5 ? accent : ink;
        ctx.globalAlpha = 0.7 + 0.3 * warm;
        ctx.lineWidth = 1.1 + 1.3 * warm;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const r of sm.rows) for (const [K, v] of r.quotes) {
        if (K < sm.K0 || K > sm.K1 || v < lo || v > hi) continue;
        const q = cam(X(K), Y(v, sm.depth(r)), Z(sm.depth(r)));
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = ink;
        ctx.fill();
        ctx.strokeStyle = bg;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      for (const ring of sm.rings) {
        const q = cam(X(ring.K), Y(ring.iv, sm.depth(ring.r)), Z(sm.depth(ring.r)));
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = ring.r.expiry === sel ? accent : faint;
        ctx.lineWidth = 2;
        ctx.stroke();
        lab.add("no fit " + F.pct(ring.iv, 1), q.x + 8, q.y + 4, "left", ring.r.expiry === sel ? 7 : 1, cssVar("--label-2"));
      }
      fr.axes();
      if (spot > 0) {
        const kx = X(M.hk), zz = Z(M.hdd), yy = Y(M.hyy);
        fr.seg([kx, 0, -zr], [kx, 0, zr], accent, 1.1, 0.7 * spot, [3, 3]);
        fr.seg([-xr, 0, zz], [xr, 0, zz], accent, 1.1, 0.7 * spot, [3, 3]);
        fr.seg([kx, 0, zz], [kx, yy, zz], accent, 1.4, 0.9 * spot);
        const q = cam(kx, yy, zz);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4.4, 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.fillStyle = bg;
        ctx.lineWidth = 2;
        ctx.globalAlpha = spot;
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        out.tip = { x: q.x, y: q.y };
      }
      for (const r of sm.rows) { const p = cam(X(clamp(sm.S !== null ? sm.S : (sm.K0 + sm.K1) / 2, sm.K0, sm.K1)), 0, Z(sm.depth(r))); out.rows.push({ j: r.j, x: p.x, y: p.y }); }
      fr.labels(lab);
      lab.flush();
    }

    const summaryT = ticker + " dealer gamma terrain by strike and expiry, " + gName(sm.xp) + ", " + DEALER_CLAUSE + "; the table below lists every cell.";
    const summaryV = ticker + " implied volatility surface from the engine's fitted smiles over strike and expiry, " + fitN + " fitted expiries; the table below lists them.";
    gCol.append(h("h3", { id: "ftsfTg" }, "Gamma terrain ", h("span", { class: "ftsf-sub" }, sm.xp.basis === "traded" ? "traded, no dollar unit" : "$ per 1% move")));
    vCol.append(h("h3", { id: "ftsfTv" }, "Volatility surface ", h("span", { class: "ftsf-sub" }, "SVI per expiry")));
    const stT = tm ? stage(gCol, summaryT, terrainDraw, hooks, "t") : null;
    const stV = fitN ? stage(vCol, summaryV, surfaceDraw, hooks, "v") : null;
    if (!tm) gCol.append(UI.silent({ state: "unavailable", reason: sm.xp.why.gamma || "No strike and expiry pair carried gamma." }, "Gamma terrain", 120), h("p", { class: "ftsf-cap" }, "No gamma by strike and expiry on this card, so the terrain is withheld. " + (sm.xp.why.gamma || "")));
    if (!fitN) vCol.append(UI.silent({ state: "unavailable", reason: sm.xp.why.smile || "No expiry on this card carries a fitted smile, only at-the-money levels." }, "Volatility surface", 120), h("p", { class: "ftsf-cap" }, "No fitted smile on this card" + (sm.rings.length ? ", only at-the-money levels: " + sm.rings.map((x) => F.day(x.r.expiry) + " " + F.pct(x.iv, 1)).join(", ") : "") + ", so no surface is drawn."));
    for (const st of [stT, stV]) if (st) stages.push(st);

    const shownText = (v) => {
      if (v === null) return DASH;
      return tm && stT && M.hs === stT.s.id ? (v < 0 ? MINUS : v > 0 ? "+" : "") + gWord(sm.xp, Math.abs(v)) : pctOf(v);
    };
    const settleTip = () => {
      for (const st of stages) st.s.tip.hidden = true;
      M.shown = null; M.hv = null; M.cu = null; M.hs = -1; M.hj = -1; M.hi = -1;
    };
    const placeTip = () => {
      for (const st of stages) {
        const t = st.s.tip;
        const on = M.spot > 0 && M.hs === st.s.id && st.s.last && st.s.last.tip;
        if (!on) { if (!t.hidden) t.hidden = true; continue; }
        if (t.hidden) t.hidden = false;
        if (st.s.tipL.textContent !== M.hl) st.s.tipL.textContent = M.hl;
        const txt = shownText(M.shown);
        if (st.s.tipV.textContent !== txt) st.s.tipV.textContent = txt;
        const w = st.wrap.clientWidth, tw = t.offsetWidth, th = t.offsetHeight;
        const x = clamp(st.s.last.tip.x + 14, 4, Math.max(4, w - tw - 4)), y = clamp(st.s.last.tip.y - th - 12, 4, Math.max(4, st.wrap.clientHeight - th - 4));
        t.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
        t.style.opacity = String(Math.min(1, M.spot * 1.4).toFixed(2));
      }
    };
    const chase = (cur, target, dt, tau, eps) => (Math.abs(target - cur) <= eps ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau)));

    function step(now) {
      M.raf = 0;
      if (dead) return;
      const dt = M.last ? clamp((now - M.last) / 1000, 0, 0.05) : 1 / 60;
      M.last = now;
      M.frames++;
      let again = false, changed = M.dirty;
      M.dirty = false;
      if (M.grow < 1) {
        const p = (now - M.growT0) / GROW_MS;
        M.grow = p >= 1 || M.reduced ? 1 : Math.max(0, p);
        changed = true;
        if (M.grow < 1) again = true;
      }
      if (M.riseP < 1) {
        const p = (now - M.riseT0) / RISE_MS;
        M.riseP = p >= 1 || M.reduced ? 1 : Math.max(0, p);
        changed = true;
        if (M.riseP < 1) again = true; else M.rise = null;
      }
      if (M.tw < 1) {
        const p = (now - M.twT0) / TWEEN_MS;
        M.tw = p >= 1 || M.reduced ? 1 : Math.max(0, p);
        changed = true;
        if (M.tw < 1) again = true; else M.prev = null;
      }
      if (M.cam) {
        const c = M.cam, t = (now - c.t0) / c.dur;
        changed = true;
        if (t >= 1) { cutTo(c.to); } else {
          const e = EASE.io(Math.max(0, t));
          view.yaw = lerp(c.from.yaw, c.to.yaw, e);
          view.pitch = lerp(c.from.pitch, c.to.pitch, e);
          view.zoom = lerp(c.from.zoom, c.to.zoom, e);
          again = true;
        }
      } else {
        if (M.vy || M.vp) {
          view.yaw = clamp(view.yaw + M.vy * dt * DEG, -YAW_MAX, YAW_MAX);
          view.pitch = clamp(view.pitch + M.vp * dt * DEG, PITCH_MIN, PITCH_MAX);
          if ((view.yaw === YAW_MAX && M.vy > 0) || (view.yaw === -YAW_MAX && M.vy < 0)) M.vy = 0;
          if ((view.pitch === PITCH_MAX && M.vp > 0) || (view.pitch === PITCH_MIN && M.vp < 0)) M.vp = 0;
          const k = Math.exp(-dt / 0.32);
          M.vy *= k; M.vp *= k;
          if (Math.abs(M.vy) < 2 && Math.abs(M.vp) < 2) M.vy = M.vp = 0; else again = true;
          changed = true;
        }
        if (view.zoom !== M.zt) {
          view.zoom = M.reduced ? M.zt : chase(view.zoom, M.zt, dt, 0.07, 5e-4);
          changed = true;
          if (view.zoom !== M.zt) again = true;
        }
        if (M.auto && !M.reduced && M.visible && M.inView) {
          again = true;
          if (!M.down && now - M.userAt > AUTO_IDLE_MS && !M.vy && !M.vp) {
            view.yaw += M.dir * AUTO_DEG_S * dt * DEG;
            if (view.yaw > 46 * DEG) { view.yaw = 46 * DEG; M.dir = -1; } else if (view.yaw < -46 * DEG) { view.yaw = -46 * DEG; M.dir = 1; }
            changed = true;
          }
        }
      }
      sm.rows.forEach((r, a) => {
        const t = r.expiry === sel ? 1 : 0;
        const v = M.emph[a] === undefined ? t : M.emph[a];
        if (v !== t) { M.emph[a] = M.reduced ? t : chase(v, t, dt, 0.09, 4e-3); changed = true; if (M.emph[a] !== t) again = true; } else M.emph[a] = t;
      });
      if (M.spot !== M.spotT) { M.spot = M.reduced ? M.spotT : chase(M.spot, M.spotT, dt, 0.08, 5e-3); changed = true; if (M.spot !== M.spotT) again = true; else if (M.spot === 0) { settleTip(); } }
      if (M.spot > 0) {
        for (const f of [["hk", "hK"], ["hdd", "hd"], ["hyy", "hy"]]) {
          if (M[f[0]] !== M[f[1]]) { M[f[0]] = M.reduced ? M[f[1]] : chase(M[f[0]], M[f[1]], dt, 0.07, 1e-4); changed = true; if (M[f[0]] !== M[f[1]]) again = true; }
        }
        if (M.cu) {
          const p = (now - M.cu.t0) / COUNT_MS;
          if (p >= 1) { M.shown = M.cu.to; M.cu = null; } else { M.shown = lerp(M.cu.from, M.cu.to, EASE.out(Math.max(0, p))); again = true; }
          changed = true;
        }
      }
      if (changed) { for (const st of stages) st.paint(); placeTip(); syncBar(); }
      if (again && M.visible) M.raf = requestAnimationFrame(step); else { M.last = 0; root.dataset.motion = again ? "paused" : "rest"; }
    }
    function wake() {
      M.dirty = true;
      if (dead || M.raf) return;
      root.dataset.motion = "moving";
      M.raf = requestAnimationFrame(step);
    }
    function paintCanvases() { wake(); }
    const paintNow = () => { for (const st of stages) st.paint(); placeTip(); };

    const bar = h("div", { class: "ftsf-bar", role: "group", "aria-label": "View" });
    const barBtns = {};
    for (const [k, label] of [["front", "Front"], ["side", "Side"], ["top", "Top"], ["reset", "Reset"]]) {
      barBtns[k] = h("button", { class: "ftsf-vb", type: "button", "data-view": k, "aria-pressed": "false", onclick: () => hooks.go(k) }, label);
      bar.append(barBtns[k]);
    }
    const zoomOut = h("button", { class: "ftsf-vb ftsf-vz", type: "button", "aria-label": "Zoom out", onclick: () => hooks.zoomBy(1 / 1.25) }, MINUS);
    const zoomIn = h("button", { class: "ftsf-vb ftsf-vz", type: "button", "aria-label": "Zoom in", onclick: () => hooks.zoomBy(1.25) }, "+");
    const autoBtn = h("button", { class: "ftsf-vb ftsf-auto", type: "button", "aria-pressed": "false", "aria-label": "Auto-rotate", title: "Slowly turn the scene while you are not touching it" }, "Auto");
    autoBtn.addEventListener("click", () => { M.auto = !M.auto && !M.reduced; M.dir = view.yaw > 0 ? -1 : 1; touched(); syncBar(); wake(); });
    bar.append(zoomOut, zoomIn, autoBtn);
    function syncBar() {
      for (const [k, b] of Object.entries(barBtns)) {
        const p = PRESETS[k];
        const on = !M.cam && Math.abs(view.yaw - p.yaw) < 0.2 * DEG && Math.abs(view.pitch - p.pitch) < 0.2 * DEG && Math.abs(view.zoom - p.zoom) < 0.01;
        if (b.getAttribute("aria-pressed") !== String(on)) b.setAttribute("aria-pressed", String(on));
      }
      const a = String(M.auto && !M.reduced);
      if (autoBtn.getAttribute("aria-pressed") !== a) autoBtn.setAttribute("aria-pressed", a);
      autoBtn.disabled = M.reduced;
      autoBtn.title = M.reduced ? "Off while your system asks for reduced motion" : "Slowly turn the scene while you are not touching it";
    }
    const onMq = () => { M.reduced = !!(mq && mq.matches); if (M.reduced) { M.auto = false; M.vy = M.vp = 0; if (M.cam) cutTo(M.cam.to); view.zoom = M.zt; M.grow = 1; M.tw = 1; M.riseP = 1; } syncBar(); wake(); };
    if (mq && mq.addEventListener) mq.addEventListener("change", onMq);
    const onVis = () => { M.visible = document.visibilityState !== "hidden"; if (M.visible) wake(); };
    document.addEventListener("visibilitychange", onVis);
    let io = null;
    if (typeof IntersectionObserver === "function") { io = new IntersectionObserver((es) => { for (const e of es) M.inView = e.isIntersecting; if (M.inView) wake(); }); io.observe(root); }
    rowEl.append(bar);

    const rowsT = sm.rows.map((r) => {
      const k = GM.skew(r, FQ);
      return [F.day(r.expiry) + " " + MID.trim() + " " + r.dte + "d", r.label, r.atm === null ? DASH : pctOf(r.atm),
        k ? F.px(k.Kp) + " at " + pctOf(k.ivp) : DASH, k ? F.px(k.Kc) + " at " + pctOf(k.ivc) : DASH,
        k ? F.signed(k.rr * 100, 1) : DASH, r.eng && r.eng.rr25 !== null && r.state !== "none" ? F.signed(r.eng.rr25 * 100, 1) : DASH,
        k ? F.signed(k.bf * 100, 1) : DASH, r.eng && r.eng.bf25 !== null && r.state !== "none" ? F.signed(r.eng.bf25 * 100, 1) : DASH];
    });
    const tabV = tableOf(ticker + " fitted smile by expiry: 25-delta strikes and implied volatilities, risk reversal (25-delta put volatility minus call volatility) and butterfly in vol points, this page against the engine's stored figures", ["Expiry", "Fit", "At the money", "25Δ put", "25Δ call", "RR put − call", "RR engine", "BF", "BF engine"], rowsT);
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
    syncBar();
    root.dataset.motion = "rest";
    if (!M.reduced) { M.grow = 0; M.growT0 = nowMs(); }
    paintNow();
    if (M.grow < 1) wake();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!dead) { for (const st of stages) st.s.rest = null; paintNow(); } });
    let ro = null;
    if (typeof ResizeObserver === "function") { let last = host.clientWidth + "x" + host.clientHeight; ro = new ResizeObserver(() => { const k = host.clientWidth + "x" + host.clientHeight; if (k === last) return; last = k; for (const st of stages) st.s.rest = null; paintSmile(); paintCanvases(); }); ro.observe(host); }
    const sameShape = (next) => {
      const nt = terrainModel(next);
      return !!nt === !!tm && next.fit.length > 0 === fitN > 0 && next.rows.length === sm.rows.length && next.rows.every((r, i) => r.expiry === sm.rows[i].expiry) && (!nt || nt.strikes.length === tm.strikes.length);
    };
    return {
      destroy() {
        dead = true;
        if (xc) xc.destroy();
        cancelAnimationFrame(M.raf);
        document.removeEventListener("ft:expiry", onExpiry);
        document.removeEventListener("visibilitychange", onVis);
        if (mq && mq.removeEventListener) mq.removeEventListener("change", onMq);
        if (ro) ro.disconnect();
        if (io) io.disconnect();
        host.replaceChildren();
      },
      reset: () => hooks.go("reset"),
      setCardX(next) {
        input.cardX = next || null;
        if (xc && xcApi && !dead) xc = xcApi.mount(xcHost, input.cardX, { buttonHost: document.getElementById("ftGReset") });
      },
      go: hooks.go,
      update(nextCard) {
        const next = surfaceModel(nextCard, FQ);
        if (!sameShape(next)) return false;
        const nt = terrainModel(next);
        if (nt && tm) {
          const eT = EASE.out(M.tw);
          const was = new Map(tm.cells.map((c) => [c.i + "|" + c.j, c.h === null ? null : (c.s === undefined ? c.h : c.s + (c.h - c.s) * eT)]));
          for (const c of nt.cells) { const v = was.get(c.i + "|" + c.j); c.s = v === undefined || v === null ? 0 : v; }
        }
        M.prev = sm;
        sm = next;
        tm = nt;
        M.tw = M.reduced ? 1 : 0;
        M.twT0 = nowMs();
        if (M.reduced) M.prev = null;
        paintKey();
        paintSmile();
        wake();
        return true;
      },
      setExpiry(iso) { select(iso, false); },
      expiry: () => sel,
      view: () => ({ yaw: view.yaw / DEG, pitch: view.pitch / DEG, zoom: view.zoom }),
      orbit: hooks.orbit,
      zoomBy: hooks.zoomBy,
      motion: () => ({ moving: root.dataset.motion !== "rest", state: root.dataset.motion, paints: stages.reduce((a, st) => a + st.s.paints, 0), frames: M.frames, auto: M.auto, reduced: M.reduced, grow: M.grow, tween: M.tw, vy: M.vy, vp: M.vp, hover: M.spot > 0 ? { j: M.hj, i: M.hi, K: M.hK, value: M.hv, shown: M.shown } : null }),
      get model() { return { surface: sm, terrain: tm }; },
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
