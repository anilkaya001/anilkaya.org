(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const { h, F, cssVar } = UI;
  const DEG = Math.PI / 180;
  const REST_YAW = -14 * DEG, REST_PITCH = 32 * DEG;
  const DEALER_CLAUSE = "on the vendor's convention (dealers long calls, short puts)";
  const MAX_SLICES = 12;
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pct = (v) => (num(v) === null ? UI.DASH : (v * 100).toFixed(1) + "%");
  const day = (iso) => String(iso || "").slice(0, 10);
  const SEQ = ["--seq-2", "--seq-3", "--seq-4", "--seq-5"];

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
    const stops = SEQ.map((n) => parseColor(cssVar(n)));
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

  function evenly(list, n) {
    if (list.length <= n) return list.slice();
    const out = [];
    for (let i = 0; i < n; i++) { const v = list[Math.round((i * (list.length - 1)) / (n - 1))]; if (!out.includes(v)) out.push(v); }
    return out;
  }

  function surfaceModel(input, FQ) {
    const eng = input && input.engine;
    const fitted = [];
    const slices = [];
    const mesh = [];
    let kmax = null;
    if (eng && Array.isArray(eng.expiries) && FQ && typeof FQ.sliceFromSummary === "function" && typeof FQ.sliceVolK === "function") {
      const list = eng.expiries.filter((e) => e && e.smile && e.forward && num(e.dte) !== null && e.dte > 0).sort((a, b) => a.dte - b.dte);
      const step = list.length > MAX_SLICES ? (list.length - 1) / (MAX_SLICES - 1) : 1;
      const picked = list.length > MAX_SLICES ? Array.from({ length: MAX_SLICES }, (_, i) => list[Math.round(i * step)]) : list;
      for (const e of picked) {
        const slice = FQ.sliceFromSummary(e);
        const atm = slice ? num(FQ.sliceVolK(slice, 0)) : null;
        const T = slice && num(slice.T) > 0 ? slice.T : num(e.T);
        if (!(atm > 0) || !(T > 0)) continue;
        const half = 2 * Math.sqrt(atm * atm * T);
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const k = -half + (2 * half * i) / 24;
          pts.push({ k, iv: num(FQ.sliceVolK(slice, k)) });
        }
        fitted.push({ expiry: e.expiry, dte: e.dte, T, atm, half, pts });
        slices.push(slice);
      }
      const halves = fitted.map((f) => f.half).sort((a, b) => a - b);
      if (halves.length) kmax = clamp((halves[Math.floor((halves.length - 1) / 2)] + halves[Math.floor(halves.length / 2)]) / 2, 0.05, 0.6);
      for (let i = 0; i + 1 < fitted.length; i++) {
        const a = fitted[i], b = fitted[i + 1];
        const c = Math.min(a.half, b.half, kmax);
        const k = [], iv0 = [], iv1 = [];
        for (let q = 0; q <= 24; q++) {
          const kk = -c + (2 * c * q) / 24;
          k.push(kk);
          iv0.push(num(FQ.sliceVolK(slices[i], kk)));
          iv1.push(num(FQ.sliceVolK(slices[i + 1], kk)));
        }
        mesh.push({ d0: a.dte, d1: b.dte, k, iv0, iv1 });
      }
    }
    const sf = input && input.ivSurface;
    const measured = [];
    let gaps = 0;
    if (sf && Array.isArray(sf.rows) && Array.isArray(sf.expiries) && Array.isArray(sf.iv)) {
      sf.expiries.forEach((e, j) => sf.rows.forEach((m, r) => {
        const v = num(sf.iv[r] && sf.iv[r][j]);
        if (v !== null && v > 0 && num(m) !== null && num(e.days) !== null) measured.push({ m, days: e.days, expiry: e.expiry, iv: v });
        else gaps++;
      }));
    }
    if (kmax === null) kmax = clamp(Math.max(0.05, ...measured.map((p) => Math.abs(p.m))), 0.05, 0.6);
    const days = Array.from(new Set(fitted.map((f) => f.dte).concat(measured.map((p) => p.days)))).sort((a, b) => a - b);
    const rows = days.map((d) => {
      const f = fitted.find((x) => x.dte === d) || null;
      const ms = measured.filter((p) => p.days === d);
      return { days: d, expiry: f ? f.expiry : ms.length ? ms[0].expiry : null, atm: f ? f.atm : null, half: f ? f.half : null, n: ms.length,
        lo: ms.length ? Math.min(...ms.map((p) => p.iv)) : null, hi: ms.length ? Math.max(...ms.map((p) => p.iv)) : null };
    });
    return { kmax, fitted, mesh, measured, gaps, rows, days };
  }

  function terrainModel(input) {
    const sf = input && input.gamma;
    if (!sf || (sf.status && sf.status !== "ok") || !Array.isArray(sf.strikes) || !Array.isArray(sf.expiries)) return null;
    const book = sf.oi && Array.isArray(sf.oi.gamma) ? sf.oi.gamma : null;
    const traded = Array.isArray(sf.grid) ? sf.grid : null;
    const measured = (a) => !!a && a.some((row) => Array.isArray(row) && row.some((v) => num(v) !== null));
    const basis = measured(book) ? "book" : measured(traded) ? "traded" : null;
    if (!basis) return null;
    const oi = basis === "book" ? book : traded;
    const ns = sf.strikes.length, ne = sf.expiries.length;
    const g = sf.strikes.map((_, i) => sf.expiries.map((__, j) => num(oi[i] && oi[i][j])));
    const mags = [];
    for (const row of g) for (const v of row) if (v !== null && v !== 0) mags.push(Math.abs(v));
    mags.sort((a, b) => a - b);
    if (!mags.length) return null;
    const cap = mags[Math.min(mags.length - 1, Math.round(0.98 * (mags.length - 1)))];
    const scale = 1 / cap;
    const CLIP = 1.25;
    let clipped = 0, gaps = 0;
    const verts = [];
    for (let i = 0; i < ns; i++) for (let j = 0; j < ne; j++) {
      const v = g[i][j];
      if (v === null) { gaps++; verts.push({ i, j, strike: sf.strikes[i], expiry: sf.expiries[j], g: null, h: null, clip: false }); continue; }
      const raw = v * scale;
      const clip = Math.abs(raw) > CLIP;
      if (clip) clipped++;
      verts.push({ i, j, strike: sf.strikes[i], expiry: sf.expiries[j], g: v, h: clip ? Math.sign(raw) * CLIP : raw, clip });
    }
    const zeros = [];
    for (let j = 0; j < ne; j++) {
      const at = [];
      for (let i = 0; i < ns - 1; i++) {
        const a = g[i][j], b = g[i + 1][j];
        if (a !== null && b !== null && a * b < 0) at.push(sf.strikes[i] + ((sf.strikes[i + 1] - sf.strikes[i]) * a) / (a - b));
      }
      zeros.push(at);
    }
    const net = sf.expiries.map((_, j) => {
      let s = null;
      for (let i = 0; i < ns; i++) if (g[i][j] !== null) s = (s === null ? 0 : s) + g[i][j];
      return s;
    });
    const spot = num(sf.spot);
    const lo = sf.strikes[0], hi = sf.strikes[ns - 1];
    const outside = spot === null ? null : spot < lo ? "below" : spot > hi ? "above" : null;
    return { basis, ridge: ne === 1, strikes: sf.strikes, expiries: sf.expiries, g, verts, cap, scale, clip: CLIP, clipped, gaps, zeros, net, spot, spotAt: spot === null ? null : clamp(spot, lo, hi), outside,
      asOf: sf.asOf || (input && input.asOf) || null };
  }

  function camera({ cx, cy, scale, yaw, pitch, dist }) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return (x, y, z) => {
      const X = x * cyw + z * syw;
      let Z = -x * syw + z * cyw;
      const Y = y * cp + Z * sp;
      Z = Z * cp - y * sp;
      const k = dist / (dist + Z);
      return { x: cx + X * k * scale, y: cy - Y * k * scale, z: Z };
    };
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

  function fitCam(s, w, hh, pts, mx, my, dist) {
    const { x0, x1, y0, y1 } = bounds(s.yaw, s.pitch, pts, dist);
    const scale = Math.min((w - 2 * mx) / Math.max(x1 - x0, 1e-6), (hh - 2 * my) / Math.max(y1 - y0, 1e-6));
    return camera({ cx: w / 2 - ((x0 + x1) / 2) * scale, cy: hh / 2 - ((y0 + y1) / 2) * scale, scale, yaw: s.yaw, pitch: s.pitch, dist });
  }

  function stage(host, label, draw) {
    const cv = h("canvas", { role: "img", tabindex: "0", "aria-label": label });
    const state = { yaw: REST_YAW, pitch: REST_PITCH, rest: null };
    const paint = () => {
      const w = Math.max(280, Math.floor(host.clientWidth || cv.parentNode.clientWidth || 600));
      const hh = w < 560 ? 320 : 420;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
      cv.style.height = hh + "px";
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = cssVar("--surface-1");
      ctx.fillRect(0, 0, w, hh);
      const out = { labels: [] };
      draw(ctx, w, hh, state, out);
      cv.dataset.labels = out.labels.join("|");
    };
    const orbit = (dy, dp) => {
      state.yaw = clamp(state.yaw + dy * DEG, -55 * DEG, 55 * DEG);
      state.pitch = clamp(state.pitch + dp * DEG, 8 * DEG, 52 * DEG);
      paint();
    };
    let drag = null;
    cv.addEventListener("pointerdown", (ev) => { drag = { x: ev.clientX, y: ev.clientY }; try { cv.setPointerCapture(ev.pointerId); } catch (e) { drag = drag; } });
    cv.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      orbit((ev.clientX - drag.x) * 0.4, (ev.clientY - drag.y) * 0.3);
      drag = { x: ev.clientX, y: ev.clientY };
    });
    const end = () => { drag = null; };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("keydown", (ev) => {
      const d = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 3], ArrowDown: [0, -3] }[ev.key];
      if (!d) return;
      ev.preventDefault();
      orbit(d[0], d[1]);
    });
    const reset = h("button", { type: "button", class: "ft-scene-btn", onclick: () => { state.yaw = REST_YAW; state.pitch = REST_PITCH; paint(); } }, "Recentre");
    if (typeof ResizeObserver === "function") new ResizeObserver(() => paint()).observe(host);
    return { cv, reset, paint, state };
  }

  function floorFrame(ctx, cam, g) {
    const font = (g.phone ? 10 : 11) + "px Inter, system-ui, sans-serif";
    const grid = cssVar("--label-4"), axis = cssVar("--label-3"), text = cssVar("--label-2");
    const corners = [[-g.xr, -g.zr], [g.xr, -g.zr], [g.xr, g.zr], [-g.xr, g.zr]].map(([x, z]) => ({ x, z, p: cam(x, 0, z) }));
    const front = corners.reduce((a, b) => (b.p.z < a.p.z ? b : a));
    const back = corners.reduce((a, b) => (b.p.z > a.p.z ? b : a));
    const left = corners.filter((c) => c !== front).reduce((a, b) => (b.p.x < a.p.x ? b : a));
    const cen = { x: corners.reduce((a, c) => a + c.p.x, 0) / 4, y: corners.reduce((a, c) => a + c.p.y, 0) / 4 };
    const seg = (a, b, color, width, alpha) => {
      const p = cam(a[0], a[1], a[2]), q = cam(b[0], b[1], b[2]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.globalAlpha = alpha || 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.p.x, c.p.y) : ctx.moveTo(c.p.x, c.p.y)));
    ctx.closePath();
    ctx.fillStyle = cssVar("--surface-2");
    ctx.fill();
    for (const t of g.xTicks) seg([t.p, 0, -g.zr], [t.p, 0, g.zr], grid, 1, 0.8);
    for (const t of g.zTicks) seg([-g.xr, 0, t.p], [g.xr, 0, t.p], grid, 1, 0.8);
    for (const t of g.yTicks) {
      seg([back.x, t.p, -g.zr], [back.x, t.p, g.zr], grid, 1, 0.55);
      seg([-g.xr, t.p, back.z], [g.xr, t.p, back.z], grid, 1, 0.55);
    }
    const ez = left.z === front.z ? back.z : front.z;
    const ex = left.x === front.x ? back.x : front.x;
    const draw = () => {
      seg([-g.xr, 0, ez], [g.xr, 0, ez], axis, 1.4);
      seg([ex, 0, -g.zr], [ex, 0, g.zr], axis, 1.4);
      seg([left.x, g.y0, left.z], [left.x, g.y1, left.z], axis, 1.4);
      ctx.font = font;
      ctx.fillStyle = text;
      const put = (str, x, y, align) => {
        ctx.textAlign = align;
        const tw = ctx.measureText(str).width;
        const half = align === "center" ? tw / 2 : 0;
        const px = align === "right" ? clamp(x, tw + 2, g.w - 2) : clamp(x, half + 2, g.w - half - 2);
        ctx.fillText(str, px, clamp(y, 10, g.h - 4));
        g.out.labels.push(str);
      };
      const away = (p, d) => {
        const dx = p.x - cen.x, dy = p.y - cen.y;
        const n = Math.hypot(dx, dy) || 1;
        return { x: p.x + (dx / n) * d, y: p.y + (dy / n) * d };
      };
      const thin = (list, at, gap) => {
        const kept = [];
        for (const t of list) {
          const a = at(t);
          const last = kept[kept.length - 1];
          if (!last || Math.hypot(a.x - last.a.x, a.y - last.a.y) >= gap) kept.push({ t, a });
        }
        return kept;
      };
      const zs = thin(g.zTicks, (t) => away(cam(ex, 0, t.p), 17), 13);
      const xs = thin(g.xTicks, (t) => away(cam(t.p, 0, ez), 15), g.phone ? 34 : 44).filter((k) => zs.every((z) => Math.hypot(z.a.x - k.a.x, z.a.y - k.a.y) >= 26));
      for (const k of xs) put(k.t.t, k.a.x, k.a.y + 3, "center");
      for (const k of zs) put(k.t.t, k.a.x, k.a.y + 3, "center");
      for (const t of g.yTicks) { const q = cam(left.x, t.p, left.z); put(t.t, q.x - 7, q.y + 3, "right"); }
      if (!g.phone) {
        const xm = away(cam(0, 0, ez), 34);
        put(g.titles.x, xm.x, xm.y + 3, "center");
        const zw = zs.reduce((a, k) => Math.max(a, ctx.measureText(k.t.t).width), 0);
        const zm = away(cam(ex, 0, 0), 17 + zw / 2 + 12 + ctx.measureText(g.titles.z).width / 2);
        put(g.titles.z, zm.x, zm.y + 3, "center");
      }
      const top = cam(left.x, g.y1, left.z);
      put(g.titles.y, top.x, top.y - 12, "center");
    };
    return { front, back, left, draw };
  }

  function table(caption, head, rows) {
    return h("details", { class: "ft-scene-tab" },
      h("summary", null, "Read it as a table"),
      h("div", { class: "ft-scene-scroll" }, h("table", null, h("caption", null, caption),
        h("thead", null, h("tr", null, head.map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, rows.map((r) => h("tr", null, r.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", null, c)))))))));
  }

  function chips(list) {
    return h("p", { class: "ft-scene-chips" }, list.filter(Boolean).map((t) => h("span", { class: "ft-scene-chip" }, t)));
  }

  function withheld(host, label, reason) {
    host.append(UI.silent({ state: "unavailable", reason }, label, 140), h("p", { class: "ft-scene-cap" }, reason));
  }

  function surface(host, input) {
    host.replaceChildren();
    const m = surfaceModel(input, window.FlowsQuant);
    if (!m.fitted.length && !m.measured.length) {
      withheld(host, "Volatility surface", "This card carries neither a fitted smile nor a measured volatility grid, so there is no surface to draw.");
      return;
    }
    const kmax = m.kmax;
    const inside = (p) => Math.abs(p.k) <= kmax + 1e-12;
    const shown = m.measured.filter((p) => Math.abs(p.m) <= kmax);
    const ivs = m.fitted.flatMap((f) => f.pts.filter(inside).map((p) => p.iv)).concat(shown.map((p) => p.iv)).filter((v) => v !== null);
    const ivLo = Math.min(...ivs), ivHi = Math.max(...ivs);
    const step = niceStep(Math.max(ivHi - ivLo, 0.02) * 100, 4) / 100;
    const yLo = Math.floor(ivLo / step + 1e-9) * step;
    let yHi = Math.ceil(ivHi / step - 1e-9) * step;
    if (yHi - yLo < step) yHi = yLo + step;
    const dmax = Math.sqrt(Math.max(...m.days, 1));
    const vp = (v) => String(Math.round(v * 1000) / 10);
    const summary = input.ticker + " implied volatility surface: " + m.fitted.length + " fitted expiry slices from " + vp(ivLo) + " to " + vp(ivHi) + " vol points and " + m.measured.length + " measured points, over strike as a share of the forward and days to expiry; the table below lists them.";
    const st = stage(host, summary, (ctx, w, hh, s, out) => {
      const phone = w < 560;
      const mx = phone ? 36 : 40, my = phone ? 44 : 50;
      const tall = (r) => clamp(r * 0.6, 1.8, 4.2);
      const deep = (r) => clamp(r * 0.45, 2, 3.4);
      const box = (r) => [-r, r].flatMap((x) => [-deep(r), deep(r)].flatMap((z) => [[x, 0, z], [x, tall(r), z]]));
      const xr = restWidth(s, w, hh, box, mx, my, 24);
      const yr = tall(xr), zr = deep(xr);
      const X = (k) => (k / kmax) * xr;
      const Z = (d) => ((Math.sqrt(d) / dmax) * 2 - 1) * zr;
      const Y = (iv) => ((clamp(iv, yLo, yHi) - yLo) / (yHi - yLo)) * yr;
      const cam = fitCam(s, w, hh, box(xr), mx, my, 24);
      const ks = phone ? [-1, 0, 1] : [-1, -0.5, 0, 0.5, 1];
      const xTicks = ks.map((q) => { const k = q * kmax; return { p: X(k), t: q === 0 ? "ATM" : Math.round(Math.exp(k) * 100) + "%" }; });
      const zTicks = evenly(m.days, phone ? 4 : 6).map((d) => ({ p: Z(d), t: d + "d" }));
      const yTicks = [];
      for (let v = yLo; v <= yHi + step / 2; v += step) yTicks.push({ p: Y(v), t: vp(v) });
      const fr = floorFrame(ctx, cam, { w, h: hh, out, phone, xr, zr, y0: 0, y1: yr, xTicks, zTicks, yTicks, titles: { x: "Strike ÷ forward", z: "Days to expiry", y: "Implied vol, vol points" } });
      const shade = ramp();
      const bg = cssVar("--surface-1"), ink = cssVar("--label-1");
      const quads = [];
      for (const q of m.mesh) for (let i = 0; i < q.k.length - 1; i++) {
        const v = [q.iv0[i], q.iv0[i + 1], q.iv1[i + 1], q.iv1[i]];
        if (v.some((x) => x === null)) continue;
        const p = [cam(X(q.k[i]), Y(v[0]), Z(q.d0)), cam(X(q.k[i + 1]), Y(v[1]), Z(q.d0)), cam(X(q.k[i + 1]), Y(v[2]), Z(q.d1)), cam(X(q.k[i]), Y(v[3]), Z(q.d1))];
        quads.push({ p, iv: (v[0] + v[1] + v[2] + v[3]) / 4, z: (p[0].z + p[1].z + p[2].z + p[3].z) / 4 });
      }
      quads.sort((a, b) => b.z - a.z);
      ctx.lineJoin = "round";
      for (const q of quads) {
        ctx.beginPath();
        q.p.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = shade((q.iv - yLo) / (yHi - yLo));
        ctx.fill();
        ctx.strokeStyle = bg;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const f of m.fitted) {
        const line = f.pts.filter((p) => p.iv !== null && inside(p)).map((p) => cam(X(p.k), Y(p.iv), Z(f.dte)));
        ctx.beginPath();
        line.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.strokeStyle = shade(0.98);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      for (const p of shown) {
        const q = cam(X(p.m), Y(p.iv), Z(p.days));
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = ink;
        ctx.fill();
        ctx.strokeStyle = bg;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      fr.draw();
    });
    const rows = m.rows.map((r) => [r.days + "d" + (r.expiry ? " · " + day(r.expiry) : ""), r.atm === null ? UI.DASH : pct(r.atm), r.half === null ? UI.DASH : "±" + r.half.toFixed(3), String(r.n), r.n ? pct(r.lo) + " – " + pct(r.hi) : UI.DASH]);
    const legend = h("span", { class: "ft-scene-ramp" }, "Shade is implied vol", h("i", { class: "ft-scene-grad", "aria-hidden": "true" }), vp(yLo) + " – " + vp(yHi) + " vol points, one scale");
    host.append(
      chips(["Fitted: engine smile, ±2√w of the money only", "Dots: measured, " + shown.length + " points" + (shown.length < m.measured.length ? ", " + (m.measured.length - shown.length) + " more lie beyond the drawn money range" : ""), m.gaps ? m.gaps + " grid cells not quoted" : null, input.asOf ? "Card " + day(input.asOf) : null]),
      st.cv,
      h("div", { class: "ft-scene-bar" }, st.reset, legend, h("span", { class: "ft-scene-hint" }, "Drag or use the arrow keys to turn it.")),
      h("p", { class: "ft-scene-hint" }, "Axes: strike as a share of the forward along the front, days to expiry on a square-root scale along the side, implied volatility in vol points upward."),
      h("p", { class: "ft-scene-cap" }, "Fitted; quoted range not published. Implied volatility is annualised and printed in vol points, strike is a share of the forward (ATM is 100%), and the expiry axis is the square root of days. The mesh joins each pair of neighbouring fitted slices over the money range both cover, in a straight line between them; it is not a model of the days between expiries, and nothing is drawn beyond a slice's fitted range. No bid and ask is published, so no whiskers are drawn."),
      table(input.ticker + " fitted and measured implied volatility by expiry", ["Expiry", "Fitted at the money", "Fitted range, log-moneyness", "Measured points", "Measured range"], rows));
    st.paint();
  }

  function terrain(host, input) {
    host.replaceChildren();
    const m = terrainModel(input);
    if (!m) {
      withheld(host, "Gamma terrain", "This card holds no strike-by-expiry gamma to draw" + (input && input.gamma && input.gamma.reason ? " (" + input.gamma.reason + ")" : "") + ", neither the open-interest book nor the traded grid, so the terrain is withheld. The Gamma module's other views still read.");
      return;
    }
    const ns = m.strikes.length, ne = m.expiries.length;
    const lo = m.strikes[0], hi = m.strikes[ns - 1];
    const book = m.basis === "book";
    const fmt = (v) => (v === null ? UI.DASH : book ? F.money(v, true) : F.num(v, true) + " Γ");
    const cols = ne > 1 ? m.expiries.map((_, j) => j) : [0, 0];
    const gz = (c) => (ne > 1 ? (c / (ne - 1) - 0.5) * 4.2 : c === 0 ? -0.4 : 0.4);
    const heights = m.verts.map((v) => v.h).filter((v) => v !== null);
    const hMax = Math.max(0, ...heights), hMin = Math.min(0, ...heights);
    const basisWord = book ? "dealer gamma of the open-interest book, dollars per 1% move" : "gamma traded today, in the units the Gamma Grid prints";
    const summary = input.ticker + " " + basisWord + " " + DEALER_CLAUSE + ", " + ns + " strikes by " + ne + (ne === 1 ? " expiry" : " expiries") + "; the table below lists every cell.";
    const st = stage(host, summary, (ctx, w, hh, s, out) => {
      const phone = w < 560;
      const mx = phone ? 36 : 40, my = phone ? 44 : 50;
      const deep = (r) => clamp(r * 0.45, 2.1, 3.4);
      const sy = (r) => clamp(r * 0.4, 1, 1.9);
      const y0 = (r) => hMin * sy(r) - (hMin < 0 ? 0.1 : 0), y1 = (r) => hMax * sy(r) + 0.15;
      const box = (r) => [-r, r].flatMap((x) => [-deep(r), deep(r)].flatMap((z) => [[x, y0(r), z], [x, y1(r), z]]));
      const xr = restWidth(s, w, hh, box, mx, my, 24);
      const zr = deep(xr), Y0 = y0(xr), Y1 = y1(xr), gk = sy(xr);
      const gx = (k) => ((k - lo) / Math.max(hi - lo, 1e-9) - 0.5) * 2 * xr;
      const gy = (hv) => hv * gk;
      const cam = fitCam(s, w, hh, box(xr), mx, my, 24);
      const long = cssVar("--g-long"), short = cssVar("--g-short"), faint = cssVar("--label-4"), ink = cssVar("--label-1");
      const xTicks = evenly(m.strikes, phone ? 4 : 7).map((k) => ({ p: gx(k), t: F.px ? F.px(k) : String(k) }));
      const zTicks = ne > 1 ? m.expiries.map((e, j) => ({ p: gz(j), t: day(e).slice(5) })) : [{ p: 0, t: day(m.expiries[0]).slice(5) }];
      const yTicks = [{ p: 0, t: "0" }];
      if (hMax > 0) yTicks.push({ p: gy(1), t: fmt(m.cap) });
      if (hMin < 0) yTicks.push({ p: gy(-1), t: fmt(-m.cap) });
      const fr = floorFrame(ctx, cam, { w, h: hh, out, phone, xr, zr, y0: Y0, y1: Y1, xTicks, zTicks, yTicks, titles: { x: "Strike", z: ne > 1 ? "Expiry (MM-DD)" : "Expiry", y: book ? "Gamma, $ per 1%" : "Gamma traded" } });
      const V = (i, j) => m.verts[i * ne + j];
      const quads = [];
      for (let i = 0; i < ns - 1; i++) for (let c = 0; c < cols.length - 1; c++) {
        const a = cols[c], b = cols[c + 1];
        const q4 = [V(i, a), V(i + 1, a), V(i + 1, b), V(i, b)];
        if (q4.some((q) => q.h === null)) continue;
        const zc = [c, c, c + 1, c + 1];
        const p = q4.map((q, n) => cam(gx(q.strike), gy(q.h), gz(zc[n])));
        quads.push({ p, h: q4.reduce((acc, q) => acc + q.h, 0) / 4, z: p.reduce((acc, q) => acc + q.z, 0) / 4 });
      }
      quads.sort((a, b) => b.z - a.z);
      for (const q of quads) {
        const a = clamp(Math.abs(q.h) / 1.1, 0.12, 1);
        ctx.beginPath();
        q.p.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.globalAlpha = 0.25 + 0.7 * a;
        ctx.fillStyle = q.h >= 0 ? long : short;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (q.h < 0) {
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = ink;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          const x0 = Math.min(...q.p.map((p) => p.x)), x1 = Math.max(...q.p.map((p) => p.x)), ya = Math.min(...q.p.map((p) => p.y)), yb = Math.max(...q.p.map((p) => p.y));
          ctx.beginPath();
          for (let t = x0 - (yb - ya); t < x1; t += 5) { ctx.moveTo(t, yb); ctx.lineTo(t + (yb - ya), ya); }
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = faint;
      ctx.setLineDash([2, 3]);
      for (const v of m.verts) if (v.h === null) {
        const p = cam(gx(v.strike), 0, gz(ne > 1 ? v.j : 0));
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      m.zeros.forEach((at, j) => at.forEach((k) => {
        const z = ne > 1 ? gz(j) : 0, d = ne > 1 ? 0.13 : 0.4;
        const a = cam(gx(k), 0, z - d), b = cam(gx(k), 0, z + d);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }));
      if (m.spotAt !== null) {
        const sx = gx(m.spotAt);
        const pl = [cam(sx, Y0, -zr), cam(sx, Y0, zr), cam(sx, Y1, zr), cam(sx, Y1, -zr)];
        ctx.beginPath();
        pl.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = ink;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.setLineDash(m.outside ? [4, 3] : []);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }
      fr.draw();
    });
    const head = ["Strike"].concat(m.expiries.map((e) => day(e)));
    const rows = m.strikes.map((k, i) => [F.px ? F.px(k) : String(k)].concat(m.g[i].map((v) => fmt(v))));
    rows.push(["Net, measured cells"].concat(m.net.map((v) => fmt(v))));
    const spotChip = m.spot === null ? "Spot not stamped" : "Spot " + (F.px ? F.px(m.spot) : m.spot) + (m.asOf ? ", as of " + day(m.asOf) : "") + (m.outside ? ", outside the grid (" + m.outside + ")" : "");
    host.append(
      chips([book ? "Book gamma, dollars per 1% move, " + DEALER_CLAUSE : "Gamma traded today, in the Grid view's units, " + DEALER_CLAUSE, spotChip, m.ridge ? "One expiry on the card: drawn as a ridge" : null, m.gaps ? m.gaps + " strike and expiry pairs not returned" : null]),
      st.cv,
      h("div", { class: "ft-scene-bar" }, st.reset, h("span", { class: "ft-scene-hint" }, "Drag or use the arrow keys to turn it.")),
      h("p", { class: "ft-scene-hint" }, "Axes: strike along the front, expiry date (month-day) along the side, gamma upward with zero at the floor."),
      h("p", { class: "ft-scene-cap" }, (book ? "Height is the open-interest book's gamma at each strike and expiry" : "This card carries no open-interest book, so height is the traded gamma at each strike and expiry, the cells of the Gamma Grid view, for which the vendor states no dollar unit") +
        ", scaled to its 98th percentile magnitude" + (m.clipped ? "; " + m.clipped + " cells beyond " + m.clip + " times that are drawn at the limit" : "") +
        ". Blue is long gamma, hatched orange is short gamma, white ticks mark where the sign changes along an expiry, and dashed rings are pairs the vendor did not return, never zero. " +
        (m.ridge ? "The card holds one expiry, " + day(m.expiries[0]) + ", so the terrain is a single ridge across the strikes. " : "") +
        (m.outside ? "The spot plane is held at the edge of the grid because spot is " + m.outside + " every strike drawn." : "The spot plane stands at spot, between the strikes either side.") +
        (book ? " The traded gamma is the Grid view under Gamma and is not added to this book." : "")),
      table(input.ticker + (book ? " open-interest book gamma, dollars per 1% move " : " traded gamma by strike and expiry ") + DEALER_CLAUSE, head, rows));
    st.paint();
  }

  window.FlowsUI = Object.freeze(Object.assign({}, UI, { scenes: Object.freeze({ surface, terrain, model: Object.freeze({ surface: surfaceModel, terrain: terrainModel }) }) }));
})();
