(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const { h, F, cssVar } = UI;
  const DEG = Math.PI / 180;
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

  function surfaceModel(input, FQ) {
    const eng = input && input.engine;
    const fitted = [];
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
    const days = Array.from(new Set(fitted.map((f) => f.dte).concat(measured.map((p) => p.days)))).sort((a, b) => a - b);
    const rows = days.map((d) => {
      const f = fitted.find((x) => x.dte === d) || null;
      const ms = measured.filter((p) => p.days === d);
      return { days: d, expiry: f ? f.expiry : ms.length ? ms[0].expiry : null, atm: f ? f.atm : null, half: f ? f.half : null, n: ms.length,
        lo: ms.length ? Math.min(...ms.map((p) => p.iv)) : null, hi: ms.length ? Math.max(...ms.map((p) => p.iv)) : null };
    });
    return { fitted, measured, gaps, rows, days };
  }

  function terrainModel(input) {
    const sf = input && input.gamma;
    const oi = sf && sf.oi && Array.isArray(sf.oi.gamma) ? sf.oi.gamma : null;
    if (!oi || !Array.isArray(sf.strikes) || !Array.isArray(sf.expiries)) return null;
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
    return { strikes: sf.strikes, expiries: sf.expiries, g, verts, cap, scale, clip: CLIP, clipped, gaps, zeros, net, spot, spotAt: spot === null ? null : clamp(spot, lo, hi), outside,
      asOf: sf.asOf || (input && input.asOf) || null };
  }

  function camera({ cx, cy, scale, yaw, pitch, dist }) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return (x, y, z) => {
      const X = x * cyw + z * syw;
      let Z = -x * syw + z * cyw;
      const Y = y * cp - Z * sp;
      Z = y * sp + Z * cp;
      const k = dist / (dist + Z);
      return { x: cx + X * k * scale, y: cy - Y * k * scale, z: Z };
    };
  }

  function stage(host, label, draw) {
    const cv = h("canvas", { role: "img", tabindex: "0", "aria-label": label });
    const state = { yaw: -14 * DEG, pitch: 28 * DEG };
    const paint = () => {
      const w = Math.max(280, Math.floor(host.clientWidth || cv.parentNode.clientWidth || 600));
      const hh = w < 560 ? 300 : 440;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
      cv.style.height = hh + "px";
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hh);
      draw(ctx, w, hh, state);
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
    const reset = h("button", { type: "button", class: "ft-scene-btn", onclick: () => { state.yaw = -14 * DEG; state.pitch = 28 * DEG; paint(); } }, "Recentre");
    if (typeof ResizeObserver === "function") new ResizeObserver(() => paint()).observe(host);
    return { cv, reset, paint, state };
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
    const kmax = clamp(Math.max(0.05, ...m.fitted.map((f) => f.half), ...m.measured.map((p) => Math.abs(p.m))), 0.05, 0.6);
    const ivs = m.fitted.flatMap((f) => f.pts.map((p) => p.iv)).concat(m.measured.map((p) => p.iv)).filter((v) => v !== null);
    const ivLo = Math.min(...ivs), ivHi = Math.max(...ivs);
    const span = Math.max(ivHi - ivLo, 0.02);
    const dmax = Math.sqrt(Math.max(...m.days, 1));
    const summary = input.ticker + " implied volatility: " + m.fitted.length + " fitted expiry slices from " + F.pct(ivLo) + " to " + F.pct(ivHi) + " and " + m.measured.length + " measured points; the table below lists them.";
    const st = stage(host, summary, (ctx, w, hh, s) => {
      const cam = camera({ cx: w * 0.46, cy: hh * 0.7, scale: Math.min(w, 760) * 0.085, yaw: s.yaw, pitch: s.pitch, dist: 13 });
      const X = (k) => (k / kmax) * 3.4;
      const Z = (d) => (Math.sqrt(d) / dmax - 0.5) * 4.4;
      const Y = (iv) => ((iv - ivLo) / span) * 2.6;
      const line = (pts, color, width, dash) => {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.setLineDash(dash || []);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.setLineDash([]);
      };
      const ink = cssVar("--label-1"), faint = cssVar("--label-4"), mute = cssVar("--label-3");
      for (let q = -2; q <= 2; q++) line([cam(X(q * kmax / 2), 0, Z(m.days[0] || 1) - 0.3), cam(X(q * kmax / 2), 0, Z(dmax * dmax) + 0.3)], faint, 1);
      for (const d of m.days) line([cam(X(-kmax), 0, Z(d)), cam(X(kmax), 0, Z(d))], faint, 1);
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillStyle = mute;
      ctx.textAlign = "center";
      for (const q of [-1, 0, 1]) { const p = cam(X(q * kmax), 0, Z(m.days[0] || 1) - 0.5); ctx.fillText(q === 0 ? "0" : (q < 0 ? "−" : "+") + (kmax).toFixed(2), p.x, p.y + 14); }
      ctx.textAlign = "left";
      m.rows.forEach((r, i) => { if (m.rows.length > 8 && i % 2) return; const p = cam(X(kmax) + 0.15, 0, Z(r.days)); ctx.fillText(r.days + "d", p.x + 6, p.y + 4); });
      const hot = cssVar("--accent");
      for (const f of m.fitted) {
        const pts = f.pts.filter((p) => p.iv !== null);
        line(pts.map((p) => cam(X(p.k), Y(p.iv), Z(f.dte))), hot, 2);
        const at = cam(X(0), Y(f.atm), Z(f.dte));
        ctx.fillStyle = hot;
        ctx.beginPath();
        ctx.arc(at.x, at.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = ink;
      for (const p of m.measured) {
        const q = cam(X(clamp(p.m, -kmax, kmax)), Y(p.iv), Z(p.days));
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const rows = m.rows.map((r) => [r.days + "d" + (r.expiry ? " · " + day(r.expiry) : ""), r.atm === null ? UI.DASH : pct(r.atm), r.half === null ? UI.DASH : "±" + r.half.toFixed(3), String(r.n), r.n ? pct(r.lo) + " – " + pct(r.hi) : UI.DASH]);
    host.append(
      chips(["Fitted: engine smile, ±2√w of the money only", "Dots: measured, " + m.measured.length + " points", m.gaps ? m.gaps + " grid cells not quoted" : null, input.asOf ? "Card " + day(input.asOf) : null]),
      st.cv,
      h("div", { class: "ft-scene-bar" }, st.reset, h("span", { class: "ft-scene-hint" }, "Drag or use the arrow keys to turn it.")),
      h("p", { class: "ft-scene-cap" }, "Fitted; quoted range not published. Implied volatility is annualised, the expiry axis is the square root of days, and the money axis is log-moneyness. No surface is drawn between expiries or beyond the fitted range, and no bid and ask is published, so no whiskers are drawn."),
      table(input.ticker + " fitted and measured implied volatility by expiry", ["Expiry", "Fitted at the money", "Fitted range, log-moneyness", "Measured points", "Measured range"], rows));
    st.paint();
  }

  function terrain(host, input) {
    host.replaceChildren();
    const m = terrainModel(input);
    if (!m) {
      withheld(host, "Gamma terrain", "This card carries no open-interest book on its strike-by-expiry grid, so the dealer terrain is withheld. The traded grid is under Gamma.");
      return;
    }
    const ns = m.strikes.length, ne = m.expiries.length;
    const lo = m.strikes[0], hi = m.strikes[ns - 1];
    const gx = (s) => ((s - lo) / Math.max(hi - lo, 1e-9) - 0.5) * 6.4;
    const gz = (j) => (ne > 1 ? (j / (ne - 1) - 0.5) * 4.2 : 0);
    const gy = (hv) => hv * 1.3;
    const summary = input.ticker + " dealer gamma of the open-interest book, " + ns + " strikes by " + ne + " expiries, dollars per 1% move " + DEALER_CLAUSE + "; the table below lists every cell.";
    const st = stage(host, summary, (ctx, w, hh, s) => {
      const cam = camera({ cx: w * 0.46, cy: hh * 0.62, scale: Math.min(w, 760) * 0.085, yaw: s.yaw, pitch: s.pitch, dist: 13 });
      const long = cssVar("--g-long"), short = cssVar("--g-short"), faint = cssVar("--label-4"), mute = cssVar("--label-3"), ink = cssVar("--label-1");
      const V = (i, j) => m.verts[i * ne + j];
      const quads = [];
      for (let i = 0; i < ns - 1; i++) for (let j = 0; j < ne - 1; j++) {
        const c = [V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)];
        if (c.some((q) => q.h === null)) continue;
        const p = c.map((q) => cam(gx(q.strike), gy(q.h), gz(q.j)));
        quads.push({ p, h: c.reduce((a, q) => a + q.h, 0) / 4, z: p.reduce((a, q) => a + q.z, 0) / 4 });
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
          const x0 = Math.min(...q.p.map((p) => p.x)), x1 = Math.max(...q.p.map((p) => p.x)), y0 = Math.min(...q.p.map((p) => p.y)), y1 = Math.max(...q.p.map((p) => p.y));
          ctx.beginPath();
          for (let t = x0 - (y1 - y0); t < x1; t += 5) { ctx.moveTo(t, y1); ctx.lineTo(t + (y1 - y0), y0); }
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = faint;
      ctx.setLineDash([2, 3]);
      for (const v of m.verts) if (v.h === null) {
        const p = cam(gx(v.strike), 0, gz(v.j));
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      m.zeros.forEach((at, j) => at.forEach((k) => {
        const a = cam(gx(k), 0, gz(j) - 0.13), b = cam(gx(k), 0, gz(j) + 0.13);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }));
      if (m.spotAt !== null) {
        const sx = gx(m.spotAt);
        const pl = [cam(sx, -0.2, gz(0) - 0.3), cam(sx, -0.2, gz(ne - 1) + 0.3), cam(sx, 1.7, gz(ne - 1) + 0.3), cam(sx, 1.7, gz(0) - 0.3)];
        ctx.beginPath();
        pl.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fill();
        ctx.setLineDash(m.outside ? [4, 3] : []);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = ink;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillStyle = mute;
      ctx.textAlign = "center";
      const every = ns > 12 ? 4 : 2;
      m.strikes.forEach((k, i) => { if (i % every) return; const p = cam(gx(k), -0.2, gz(ne - 1) + 0.55); ctx.fillText(F.px ? F.px(k) : String(k), p.x, p.y + 14); });
      ctx.textAlign = "left";
      m.expiries.forEach((e, j) => { const p = cam(gx(hi) + 0.25, 0, gz(j)); ctx.fillText(day(e).slice(5), p.x + 6, p.y + 4); });
    });
    const head = ["Strike"].concat(m.expiries.map((e) => day(e)));
    const rows = m.strikes.map((k, i) => [F.px ? F.px(k) : String(k)].concat(m.g[i].map((v) => (v === null ? UI.DASH : F.money(v, true)))));
    rows.push(["Net, measured cells"].concat(m.net.map((v) => (v === null ? UI.DASH : F.money(v, true)))));
    const spotChip = m.spot === null ? "Spot not stamped" : "Spot " + (F.px ? F.px(m.spot) : m.spot) + (m.asOf ? ", as of " + day(m.asOf) : "") + (m.outside ? ", outside the grid (" + m.outside + ")" : "");
    host.append(
      chips(["Book gamma, dollars per 1% move, " + DEALER_CLAUSE, spotChip, m.gaps ? m.gaps + " strike and expiry pairs not returned" : null]),
      st.cv,
      h("div", { class: "ft-scene-bar" }, st.reset, h("span", { class: "ft-scene-hint" }, "Drag or use the arrow keys to turn it.")),
      h("p", { class: "ft-scene-cap" }, "Height is the open-interest book's gamma at each strike and expiry, scaled to its 98th percentile magnitude" + (m.clipped ? "; " + m.clipped + " cells beyond " + m.clip + " times that are drawn at the limit" : "") +
        ". Blue is long gamma, hatched orange is short gamma, white ticks mark where the sign changes along an expiry, and dashed rings are pairs the vendor did not return, never zero. " +
        (m.outside ? "The spot plane is held at the edge of the grid because spot is " + m.outside + " every strike drawn." : "The spot plane stands at spot, between the strikes either side.") + " The traded gamma is the Grid view under Gamma and is not added to this book."),
      table(input.ticker + " open-interest book gamma, dollars per 1% move " + DEALER_CLAUSE, head, rows));
    st.paint();
  }

  window.FlowsUI = Object.freeze(Object.assign({}, UI, { scenes: Object.freeze({ surface, terrain, model: Object.freeze({ surface: surfaceModel, terrain: terrainModel }) }) }));
})();
