(() => {
  "use strict";
  const UI = window.FlowsUI;
  if (!UI || UI.river) return;
  const { h, F, cssVar, clamp } = UI;
  const DASH = UI.DASH, MINUS = UI.MINUS, MID = " " + UI.MID + " ";
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const FONT = "Inter, system-ui, sans-serif";
  const LANE_W = 0.5, R0 = 0.03, R1 = 0.12, WALL_H = 0.55, WALL_GAP = 0.25;
  const OPEN_MIN = 9 * 60 + 30, CLOSE_MIN = 16 * 60, STEP_MS = 5 * 60000;
  const FUNDS = new Set(["SPY", "QQQ", "IWM", "DIA"]);
  const FUNDS_LANE = "Index funds", NONE_LANE = "No sector", INDEX_LANE = "Index options", INDEX_ROOTS = new Set(["SPX", "SPXW", "NDX", "NDXP", "RUT", "RUTW", "VIX", "VIXW", "XSP", "DJX", "MRUT"]), UNREAD_LANE = "Sector unread";
  const TOP_LABELS = 12, TOP_HITS = 40;
  const SHORT = { "Technology": "Tech", "Consumer Cyclical": "Cyclicals", "Communication Services": "Comms", "Financial Services": "Financials", "Consumer Defensive": "Defensives", "Basic Materials": "Materials", "Real Estate": "Real estate" };
  const SIDE_WORD = { up: "bullish by convention", down: "bearish by convention", nx: "unsided" };
  const RIVERS = new WeakMap();
  const ET_HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgb = (c) => "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")";
  const rgba = (c, a) => "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + a + ")";
  const money = (v) => F.money(v);
  const moneyS = (v) => (isNum(v) ? F.money(v, true) : DASH);
  const pad2 = (n) => String(n).padStart(2, "0");
  const trtOf = (ms) => { const m = Math.floor(((ms / 60000) % 1440 + 1440 + 180) % 1440); return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); };
  const etMinute = (ms) => { const p = ET_HM.formatToParts(new Date(ms)); const g = (k) => Number((p.find((x) => x.type === k) || {}).value); return g("hour") * 60 + g("minute"); };
  const etDay = (ms) => ET_DAY.format(new Date(ms));

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

  const sideOf = (r) => {
    const s = r.cp === "C" || r.cp === "P" ? UI.F.askShare([r]).side : null, c = r.cp === "C";
    return s === "ask" ? (c ? "up" : "down") : s === "bid" ? (c ? "down" : "up") : "nx";
  };
  const splitOf = (r) => {
    const x = UI.F.askSplit(r), c = r.cp === "C", p = r.cp === "P", up = c ? x.ask : p ? x.bid : 0, down = c ? x.bid : p ? x.ask : 0;
    return { up, down, nx: r.prem - up - down };
  };

  function model(alerts, o = {}) {
    const rows = alerts && Array.isArray(alerts.rows) ? alerts.rows : [];
    const u = o.universe;
    const uniOk = Boolean(u && u.status === "ok" && Array.isArray(u.t) && Array.isArray(u.sec) && Array.isArray(u.sectors));
    const secOf = new Map();
    if (uniOk) u.t.forEach((t, i) => secOf.set(String(t).toUpperCase(), Number.isInteger(u.sec[i]) ? u.sectors[u.sec[i]] || null : null));
    const session = alerts && typeof alerts.sessionDate === "string" ? alerts.sessionDate.slice(0, 10) : null;
    const windows = [];
    let dropped = 0;
    rows.forEach((r, i) => {
      if (!r || typeof r.t !== "string" || !isNum(r.prem) || !(r.prem > 0)) { dropped++; return; }
      const ms = Date.parse(r.spanStart || r.firstAt || "");
      if (!Number.isFinite(ms)) { dropped++; return; }
      const t = r.t.toUpperCase();
      const lane = FUNDS.has(t) ? FUNDS_LANE : INDEX_ROOTS.has(t) ? INDEX_LANE : !uniOk ? UNREAD_LANE : secOf.get(t) || NONE_LANE;
      windows.push({ i, t, lane, ms, minute: etMinute(ms), day: etDay(ms), prem: r.prem, side: sideOf(r), split: splitOf(r), cp: r.cp === "P" ? "P" : "C", exp: typeof r.exp === "string" ? r.exp.slice(0, 10) : null, sweep: r.sweep === true, contracts: isNum(r.size) ? r.size : null });
    });
    const byLane = new Map();
    for (const w of windows) {
      const l = byLane.get(w.lane) || { name: w.lane, prem: 0, n: 0, up: 0, down: 0, nx: 0 };
      l.prem += w.prem; l.n++; l.up += w.split.up; l.down += w.split.down; l.nx += w.split.nx;
      byLane.set(w.lane, l);
    }
    const b = o.breadth;
    const bOk = Boolean(b && b.sectors && Array.isArray(b.sectors.t) && b.sectors.rows && typeof b.sectors.rows === "object");
    const bSession = bOk ? (typeof b.session === "string" ? b.session.slice(0, 10) : null) : null;
    const sameDay = bOk && (!session || !bSession || bSession === session);
    const steps = sameDay ? b.sectors.t.map((s) => Date.parse(s)).filter(Number.isFinite) : [];
    const tideWhy = !bOk ? "The live breadth key has not published, so the lane floors carry no tide." : !sameDay ? "The live breadth key is for " + bSession + ", not this session, so the lane floors carry no tide." : null;
    const pathOf = (name) => {
      if (!steps.length) return null;
      if (name === FUNDS_LANE) {
        const e = b.etf && typeof b.etf === "object" ? [...FUNDS].map((T) => b.etf[T]).filter((x) => x && x.status === "ok" && Array.isArray(x.net)) : [];
        if (!e.length) return null;
        return steps.map((_, k) => e.reduce((a, x) => (a === null || !isNum(x.net[k]) ? null : a + x.net[k]), 0));
      }
      const r = b.sectors.rows[name];
      return r && r.status === "ok" && Array.isArray(r.net) ? steps.map((_, k) => (isNum(r.net[k]) ? r.net[k] : null)) : null;
    };
    const lanes = [...byLane.values()].sort((a, c) => c.prem - a.prem || (a.name < c.name ? -1 : 1)).map((l, k) => {
      const path = pathOf(l.name);
      return { ...l, k, path, tide: path && path.length ? path[path.length - 1] : null, tideWhy: path ? null : l.name === NONE_LANE || l.name === UNREAD_LANE ? "No sector, so no sector tide." : steps.length ? "The live breadth key carries no tide for " + l.name + "." : tideWhy };
    });
    lanes.forEach((l) => { l.windows = windows.filter((w) => w.lane === l.name); });
    let readMs = alerts && typeof alerts.readAt === "string" ? Date.parse(alerts.readAt) : NaN;
    for (const w of windows) if (!(readMs >= w.ms)) readMs = w.ms;
    if (steps.length && !(readMs >= steps[steps.length - 1] + STEP_MS)) readMs = steps[steps.length - 1] + STEP_MS;
    const day = session || (windows.length ? windows[0].day : null);
    const tideIn = o.tide && Array.isArray(o.tide.t) && Array.isArray(o.tide.call) && Array.isArray(o.tide.put) && o.tide.t.length >= 2 ? o.tide : null;
    const tideMs = tideIn ? tideIn.t.map((s) => Date.parse(s)) : [];
    const tideDay = tideMs.length && Number.isFinite(tideMs[0]) ? etDay(tideMs[0]) : null;
    const tide = tideIn && tideMs.every(Number.isFinite) && (!day || tideDay === day)
      ? { ms: tideMs, call: tideIn.call.map((v) => (isNum(v) ? v : null)), put: tideIn.put.map((v) => (isNum(v) ? v : null)), src: tideIn.src || null }
      : null;
    const marketTideWhy = tide ? null : !tideIn ? "No market tide series was carried." : "The market tide carried is for " + (tideDay || "another day") + ", not this session.";
    const dayMs = day ? Date.parse(day + "T00:00:00Z") : NaN;
    const openMs = windows.length ? Math.min(...windows.map((w) => w.ms - (w.minute - OPEN_MIN) * 60000)) : NaN;
    const total = windows.reduce((a, w) => a + w.prem, 0);
    const pMax = windows.reduce((a, w) => Math.max(a, w.prem), 0);
    return {
      session: day, dayMs, openMs, readMs: Number.isFinite(readMs) ? readMs : null, windows, lanes, steps, stepMs: STEP_MS, total, pMax, dropped,
      uniOk, tideWhy, tide, marketTideWhy, largest: windows.slice().sort((a, c) => c.prem - a.prem || a.i - c.i),
    };
  }

  function camera({ cx, cy, scale, yaw, pitch, dist }) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = (x, y, z) => {
      const X = x * cyw + z * syw;
      let Z = -x * syw + z * cyw;
      const Y = y * cp + Z * sp;
      Z = Z * cp - y * sp;
      const k = dist / (dist + Z);
      return { x: cx + X * k * scale, y: cy - Y * k * scale, z: Z, k };
    };
    f.params = { cx, cy, scale, yaw, pitch, dist };
    return f;
  }
  function fitCam(view, w, hh, pts, m) {
    const unit = camera({ cx: 0, cy: 0, scale: 1, yaw: view.yaw, pitch: view.pitch, dist: view.dist });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { const q = unit(p[0], p[1], p[2]); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const scale = Math.min((w - m.l - m.r) / Math.max(x1 - x0, 1e-6), (hh - m.t - m.b) / Math.max(y1 - y0, 1e-6));
    return camera({ cx: m.l + (w - m.l - m.r) / 2 - ((x0 + x1) / 2) * scale, cy: m.t + (hh - m.t - m.b) / 2 - ((y0 + y1) / 2) * scale, scale, yaw: view.yaw, pitch: view.pitch, dist: view.dist });
  }
  const fogOf = (z, near, far, floor) => clamp(1 - ((z - near) / Math.max(far - near, 1e-6)) * (1 - floor), floor, 1);

  function layout(M, W, H, o = {}) {
    const phone = Boolean(o.phone);
    const L = M.lanes.length;
    if (!L || !M.openMs) return null;
    const xr = (L * LANE_W) / 2;
    const zr = phone ? 2.3 : 1.6;
    const endMs = Math.max(M.readMs || 0, M.openMs + 30 * 60000, ...M.windows.map((w) => w.ms + 60000));
    const zOf = (ms) => zr - (2 * zr * (ms - M.openMs)) / (endMs - M.openMs);
    const view = phone ? { yaw: 6 * DEG, pitch: 54 * DEG, dist: 10 } : { yaw: 14 * DEG, pitch: 34 * DEG, dist: 7.5 };
    const wallX = -xr - WALL_GAP;
    const box = [[wallX, 0, -zr], [xr + 0.1, 0, -zr], [xr + 0.1, 0, zr], [wallX, 0, zr], [wallX, WALL_H, -zr], [wallX, WALL_H, zr]];
    const cam = fitCam(view, W, H, box, phone ? { l: 6, r: 6, t: 18, b: 62 } : { l: 24, r: 40, t: 14, b: 66 });
    const zs = [cam(-xr, 0, -zr).z, cam(xr, 0, zr).z, cam(-xr, 0, zr).z, cam(xr, 0, -zr).z];
    const near = Math.min(...zs), far = Math.max(...zs);
    const sectorLanes = M.lanes.filter((l) => l.path && l.name !== FUNDS_LANE);
    const secMax = Math.max(1, ...(sectorLanes.length ? sectorLanes : M.lanes).map((l) => (l.path ? Math.max(0, ...l.path.filter(isNum).map(Math.abs)) : 0)));
    const tiles = [];
    const laneX = (k) => -xr + LANE_W * (k + 0.5);
    for (const l of M.lanes) {
      const x0 = -xr + LANE_W * l.k + 0.02, x1 = x0 + LANE_W - 0.04;
      if (!M.steps.length) {
        const z0 = zr, z1 = zOf(endMs);
        tiles.push({ lane: l.name, k: -1, v: null, pts: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], zc: cam((x0 + x1) / 2, 0, (z0 + z1) / 2).z });
        continue;
      }
      M.steps.forEach((ms, k) => {
        const z0 = zOf(Math.max(ms, M.openMs)), z1 = zOf(Math.min(ms + M.stepMs, endMs)) + 0.012;
        if (z1 >= z0) return;
        tiles.push({ lane: l.name, k, v: l.path ? l.path[k] : null, pts: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], zc: cam((x0 + x1) / 2, 0, (z0 + z1) / 2).z });
      });
    }
    tiles.sort((a, b) => b.zc - a.zc);
    const rOf = (p) => R0 + R1 * Math.sqrt(p / (M.pMax || 1));
    const spheres = M.windows.map((w) => {
      const lane = M.lanes.find((l) => l.name === w.lane);
      const jit = ((w.i * 7919) % 97) / 97 - 0.5;
      const r = rOf(w.prem), x = laneX(lane.k) + jit * (LANE_W - 2 * r) * 0.9, z = zOf(w.ms);
      const q = cam(x, r, z), g = cam(x, 0, z);
      return { w, x, z, r, px: q.x, py: q.y, pr: r * q.k * cam.params.scale, pz: g.z, fog: fogOf(g.z, near, far, 0.55) };
    }).sort((a, b) => b.pz - a.pz);
    const ticks = [];
    const firstTick = Math.ceil(M.openMs / 3600000) * 3600000;
    for (let ms = firstTick; ms < endMs; ms += 3600000) { const z = zOf(ms); ticks.push({ ms, z, text: trtOf(ms), a: cam(-xr, 0, z), b: cam(xr, 0, z), lab: cam(xr, 0, z) }); }
    const nowZ = M.readMs ? zOf(Math.min(M.readMs, endMs)) : null;
    const tide = M.tide ? (() => {
      const vals = M.tide.call.concat(M.tide.put).filter(isNum).map(Math.abs);
      const tmax = Math.max(1, ...vals);
      const base = WALL_H * 0.5, amp = WALL_H * 0.44;
      const pt = (i, v) => cam(wallX, base + amp * (v / tmax), zOf(clamp(M.tide.ms[i], M.openMs, endMs)));
      return { tmax, base: cam(wallX, base, zr), baseEnd: cam(wallX, base, -zr), call: M.tide.ms.map((_, i) => (isNum(M.tide.call[i]) ? pt(i, M.tide.call[i]) : null)), put: M.tide.ms.map((_, i) => (isNum(M.tide.put[i]) ? pt(i, M.tide.put[i]) : null)), top: cam(wallX, WALL_H, zr), hi: cam(wallX, base + amp, -zr), lo: cam(wallX, base - amp, -zr) };
    })() : null;
    const heads = M.lanes.map((l) => ({ lane: l.name, p: cam(laneX(l.k), 0, -zr - 0.04), x: laneX(l.k) }));
    return {
      W, H, phone, cam: cam.params, xr, zr, wallX, wallH: WALL_H, near, far, openMs: M.openMs, endMs, zOf, laneX, secMax, tiles, spheres, ticks, nowZ, tide, heads,
      now: nowZ === null ? null : { a: cam(-xr - 0.1, 0, nowZ), b: cam(xr + 0.1, 0, nowZ) },
      wall: [[wallX, 0, -zr], [wallX, 0, zr], [wallX, WALL_H, zr], [wallX, WALL_H, -zr]].map((p) => cam(p[0], p[1], p[2])),
      grid: M.lanes.map((l) => [cam(-xr + LANE_W * l.k, 0, zr), cam(-xr + LANE_W * l.k, 0, -zr)]).concat([[cam(xr, 0, zr), cam(xr, 0, -zr)]]),
    };
  }

  const mk = (w, hh) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = hh; return cv; };
  function sphereSprite(c) {
    const S = 160, m = S / 2, cv = mk(S, S), g = cv.getContext("2d");
    const c1 = mix(c, WHITE, 0.42);
    let gr = g.createRadialGradient(S * 0.34, S * 0.3, 0, m, m, m);
    [[0, mix(c, WHITE, 0.93)], [0.14, c1], [0.48, c], [0.82, mix(c, BLACK, 0.5)], [1, mix(c, BLACK, 0.8)]].forEach(([o, x]) => gr.addColorStop(o, rgb(x)));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(m, m, m, 0, TAU);
    g.fill();
    gr = g.createRadialGradient(S * 0.3, S * 0.27, 0, m, m, m);
    gr.addColorStop(0.8, rgba(c1, 0));
    gr.addColorStop(0.94, rgba(c1, 0.6));
    gr.addColorStop(1, rgba(c1, 0.25));
    g.fillStyle = gr;
    g.fill();
    return cv;
  }
  function glowSprite(c, a0, a1) {
    const S = 64, cv = mk(S, S), g = cv.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(c, a0));
    gr.addColorStop(0.4, rgba(c, a1));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return cv;
  }

  function labeler(ctx, w, hh, out) {
    const q = [];
    const hit = (a, b) => a[0] < b[2] + 3 && b[0] < a[2] + 3 && a[1] < b[3] + 2 && b[1] < a[3] + 2;
    return {
      add(text, x, y, align, prio, color, font) { q.push({ text, x, y, align, prio, color, font }); },
      flush(solid, halo) {
        const kept = (solid || []).map((b) => ({ box: b }));
        q.sort((a, b) => b.prio - a.prio);
        for (const it of q) {
          ctx.font = it.font;
          const tw = ctx.measureText(it.text).width, th = parseFloat((/([\d.]+)px/.exec(it.font) || [0, 11])[1]);
          let x0 = it.align === "center" ? it.x - tw / 2 : it.align === "right" ? it.x - tw : it.x;
          x0 = clamp(x0, 3, Math.max(3, w - tw - 3));
          const y0 = clamp(it.y - th, 2, hh - th - 2);
          const box = [x0, y0, x0 + tw, y0 + th + 2];
          if (kept.some((k) => hit(k.box, box))) { out.dropped.push(it.text); continue; }
          kept.push({ box });
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.lineJoin = "round";
          ctx.lineWidth = 3;
          ctx.strokeStyle = halo;
          ctx.strokeText(it.text, x0, y0 + th);
          ctx.fillStyle = it.color;
          ctx.fillText(it.text, x0, y0 + th);
          out.labels.push({ text: it.text, box });
        }
      },
    };
  }

  function mount(host, opts = {}) {
    if (!host) return null;
    const prev = RIVERS.get(host);
    if (prev) prev.destroy();
    const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
    const S = { alerts: null, st: { state: "pending", reason: "Reading the flagged windows." }, universe: opts.universe, breadth: opts.breadth, tide: opts.tide || null };
    let M = null, SC = null, W = 0, H = 0, dpr = 1, sel = null, hover = null, paints = 0, dead = false, LAB = { labels: [], dropped: [] };
    const sprites = new Map();
    let TOK = null;
    const tokens = () => {
      const cs = getComputedStyle(host);
      const get = (k, d) => cs.getPropertyValue(k).trim() || d;
      const up = parseColor(get("--up-mark", "#24ae56")), down = parseColor(get("--down-mark", "#e54c4a")), blue = parseColor(get("--accent", "#4ea2ff")), slate = parseColor(get("--label-3", "#8a93a6"));
      TOK = { up, down, nx: blue, slate, strong: get("--label-1", "#f5f5f7"), body: get("--label-2", "#b4b9c6"), faint: get("--label-3", "#8a93a6"), surface: parseColor(get("--surface-2", "#131722")), halo: get("--surface-1", "#0d1017") };
      sprites.clear();
    };
    const spriteFor = (side) => {
      if (!sprites.has(side)) { const c = TOK[side]; sprites.set(side, [sphereSprite(c), glowSprite(c, 0.55, 0.18)]); }
      return sprites.get(side);
    };
    let SHADOW = null;

    const canvas = h("canvas", { class: "mk-rv-c", role: "img", "aria-label": "The session" });
    const hits = h("div", { class: "mk-rv-hits" });
    const read = h("p", { class: "mk-rv-read", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const stage = h("div", { class: "mk-rv-stage" }, canvas, hits);
    const note = h("p", { class: "mk-rv-note" });
    const empty = h("p", { class: "mk-rv-empty" });
    const tables = h("div", { class: "mk-rv-tables", hidden: "" });
    const dlg = h("dialog", { class: "nm-dlg mk-rv-dlg", "aria-labelledby": "mkRiverDlgT" });
    const tableBtn = h("button", { type: "button", class: "mk-rv-tb", "aria-haspopup": "dialog" }, "Tables: the lanes and the largest windows");
    const details = h("div", { class: "mk-rv-d" }, tableBtn);
    const wrap = h("div", { class: "mk-rv", "data-state": "pending" }, read, stage, empty, note, details, tables, dlg);
    host.replaceChildren(wrap);
    tableBtn.addEventListener("click", () => {
      const close = h("button", { type: "button", class: "nm-link", onclick: () => dlg.close() }, "Close");
      tables.hidden = false;
      dlg.replaceChildren(h("div", { class: "nm-dg" }, h("h3", { id: "mkRiverDlgT" }, "The session's lanes and largest windows"), h("div", { class: "nm-dtw" }, tables), h("div", { class: "nm-dx" }, close)));
      if (typeof dlg.showModal === "function") dlg.showModal();
    });
    dlg.addEventListener("close", () => { tables.hidden = true; wrap.insertBefore(tables, dlg); });
    const ctx = canvas.getContext("2d");

    const laneLabel = (name) => SHORT[name] || name;
    const windowSentence = (w) => {
      const lane = M.lanes.find((l) => l.name === w.lane);
      return w.t + MID + laneLabel(w.lane) + MID + trtOf(w.ms) + " TRT" + MID + (w.cp === "C" ? "call" : "put") + (w.side === "nx" ? ", no clear ask or bid lean" : w.side === "up" ? (w.cp === "C" ? " on the ask side" : " on the bid side") : (w.cp === "C" ? " on the bid side" : " on the ask side")) + ", " + SIDE_WORD[w.side] + MID + money(w.prem) + (M.total ? " (" + F.pct(w.prem / M.total, 1) + " of the flagged flow)" : "") + (w.exp ? MID + "expiry " + w.exp : "") + (w.sweep ? MID + "sweep" : "") + (lane && isNum(lane.tide) ? MID + laneLabel(w.lane) + " tide " + moneyS(lane.tide) : "");
    };
    const laneSentence = (l) => laneLabel(l.name) + " lane" + MID + l.n + (l.n === 1 ? " window" : " windows") + MID + money(l.prem) + " flagged" + (M.total ? " (" + F.pct(l.prem / M.total, 1) + ")" : "") + MID + "bullish " + money(l.up) + ", bearish " + money(l.down) + ", unsided " + money(l.nx) + MID + (isNum(l.tide) ? "net option tide " + moneyS(l.tide) : "no tide: " + (l.tideWhy || "not carried"));
    const sentence = () => {
      if (!M || !M.windows.length) return "";
      if (sel && sel.kind === "w") return windowSentence(sel.w);
      if (sel && sel.kind === "l") return laneSentence(sel.l);
      return "Largest window: " + windowSentence(M.largest[0]);
    };
    const paintRead = () => { read.textContent = sentence(); };

    function describe() {
      if (!M || !M.windows.length) return "The session has no flagged windows to draw.";
      const l = M.lanes[0], top = M.largest.slice(0, 3).map((w) => w.t + " " + money(w.prem) + " at " + trtOf(w.ms) + " TRT").join("; ");
      return M.windows.length + " flagged windows, " + money(M.total) + ", in " + M.lanes.length + " lanes from the open at the back to the last read at " + (M.readMs ? trtOf(M.readMs) : DASH) + " TRT at the front. The busiest lane is " + laneLabel(l.name) + " with " + money(l.prem) + ". The largest windows: " + top + ". Sphere area is the window's premium, colour its side by convention, the lane floor the sector's net tide. The tables below list every lane and the largest windows.";
    }

    function paintTables() {
      if (!M) { tables.replaceChildren(); return; }
      const th = (t, c) => h("th", { scope: "col", class: c || null }, t);
      const lanesT = h("table", { class: "mk-tbl mk-rv-t" }, h("caption", null, "Lanes by flagged premium, with each sector's net option tide at the last read"),
        h("thead", null, h("tr", null, th("Lane"), th("Windows", "c-num"), th("Flagged", "c-num"), th("Bullish", "c-num"), th("Bearish", "c-num"), th("Unsided", "c-num"), th("Net tide", "c-num"))),
        h("tbody", null, M.lanes.map((l) => h("tr", { "data-lane": l.name }, h("th", { scope: "row" }, l.name), h("td", { class: "c-num" }, String(l.n)), h("td", { class: "c-num" }, money(l.prem)), h("td", { class: "c-num" }, money(l.up)), h("td", { class: "c-num" }, money(l.down)), h("td", { class: "c-num" }, money(l.nx)), h("td", { class: "c-num", title: isNum(l.tide) ? null : l.tideWhy || "" }, isNum(l.tide) ? moneyS(l.tide) : DASH)))));
      const winT = h("table", { class: "mk-tbl mk-rv-t" }, h("caption", null, "The " + Math.min(TOP_HITS, M.largest.length) + " largest flagged windows, each at its minute in TRT"),
        h("thead", null, h("tr", null, th("Name"), th("Lane"), th("Time TRT"), th("Side"), th("Premium", "c-num"), th("Expiry"))),
        h("tbody", null, M.largest.slice(0, TOP_HITS).map((w) => h("tr", { "data-t": w.t }, h("th", { scope: "row" }, h("a", { href: "/flows/ticker/?t=" + encodeURIComponent(w.t) }, w.t)), h("td", null, w.lane), h("td", null, trtOf(w.ms)), h("td", { "data-side": w.side }, (w.side === "up" ? "▲ " : w.side === "down" ? "▼ " : "▬ ") + (w.cp === "C" ? "call" : "put") + ", " + SIDE_WORD[w.side]), h("td", { class: "c-num" }, money(w.prem)), h("td", null, w.exp || DASH)))));
      tables.replaceChildren(lanesT, winT);
    }

    function size() {
      W = Math.max(200, Math.floor(stage.clientWidth));
      H = Math.max(160, Math.floor(stage.clientHeight));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
    }

    function paint() {
      if (dead || !ctx) return;
      paints++;
      if (!TOK) tokens();
      if (!SHADOW) SHADOW = glowSprite(BLACK, 1, 0.5);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!SC) return;
      LAB = { labels: [], dropped: [] };
      const lab = labeler(ctx, W, H, LAB);
      const cam = camera(SC.cam);
      const phone = SC.phone;
      const faint = TOK.faint, body = TOK.body, strong = TOK.strong;
      const px = (p) => p;
      for (const t of SC.tiles) {
        const fog = fogOf(t.zc, SC.near, SC.far, 0.5);
        ctx.beginPath();
        t.pts.forEach((p, i) => { const q = cam(p[0], p[1], p[2]); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
        ctx.closePath();
        if (t.v === null) {
          ctx.globalAlpha = 0.9 * fog;
          ctx.fillStyle = rgb(mix(TOK.surface, TOK.slate, 0.12));
          ctx.fill();
          ctx.globalAlpha = 0.45 * fog;
          ctx.strokeStyle = rgb(TOK.slate);
          ctx.lineWidth = 0.6;
          ctx.setLineDash([2, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          const c = t.v >= 0 ? TOK.up : TOK.down, s = Math.min(1, Math.abs(t.v) / SC.secMax);
          ctx.globalAlpha = 0.95 * fog;
          ctx.fillStyle = rgb(mix(TOK.surface, c, 0.1 + 0.55 * s));
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgb(mix(TOK.nx, WHITE, 0.3));
      ctx.lineWidth = 0.8;
      for (const [a, b] of SC.grid) { ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      SC.wall.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = rgb(TOK.nx);
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = rgb(mix(TOK.nx, WHITE, 0.4));
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (SC.tide) {
        const T = SC.tide;
        for (const [key, c] of [["call", TOK.up], ["put", TOK.down]]) {
          const pts = T[key];
          let open = false;
          ctx.beginPath();
          pts.forEach((q, i) => { if (!q) { open = false; return; } if (open) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); open = true; });
          ctx.strokeStyle = rgb(c);
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.beginPath();
          const first = pts.findIndex(Boolean);
          if (first >= 0) {
            pts.forEach((q, i) => { if (!q) return; if (i === first) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
            for (let i = pts.length - 1; i >= first; i--) { if (!pts[i]) continue; const z = SC.zOf(clamp(M.tide.ms[i], SC.openMs, SC.endMs)); const b = cam(SC.wallX, SC.wallH * 0.5, z); ctx.lineTo(b.x, b.y); }
            ctx.closePath();
            ctx.fillStyle = rgba(c, 0.22);
            ctx.fill();
          }
        }
        ctx.strokeStyle = TOK.faint;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(T.base.x, T.base.y);
        ctx.lineTo(T.baseEnd.x, T.baseEnd.y);
        ctx.stroke();
        lab.add("Market tide" + MID + "calls up, puts down", T.top.x + 6, T.top.y + 14, "left", 9, body, "600 11px " + FONT);
        lab.add(money(T.tmax), T.hi.x + 6, T.hi.y + 4, "left", 3, faint, "10px " + FONT);
        lab.add(MINUS + money(T.tmax), T.lo.x + 6, T.lo.y + 4, "left", 3, faint, "10px " + FONT);
      } else {
        lab.add("Market tide: " + (M.marketTideWhy || "not carried"), SC.wall[3].x + 6, SC.wall[3].y + 14, "left", 9, faint, "600 11px " + FONT);
      }
      for (const t of SC.ticks) {
        ctx.strokeStyle = TOK.faint;
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(t.a.x, t.a.y);
        ctx.lineTo(t.b.x, t.b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        lab.add(t.text, t.lab.x + 8, t.lab.y + 4, "left", 4, faint, "10px " + FONT);
      }
      if (SC.now) {
        ctx.strokeStyle = strong;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(SC.now.a.x, SC.now.a.y);
        ctx.lineTo(SC.now.b.x, SC.now.b.y);
        ctx.stroke();
        lab.add("read " + trtOf(M.readMs) + " TRT", SC.now.b.x + (phone ? -4 : 8), SC.now.b.y + (phone ? -6 : 4), phone ? "right" : "left", 10, strong, "600 10.5px " + FONT);
      }
      const hot = (s) => (sel && sel.kind === "w" && sel.w === s.w) || (hover && hover.kind === "w" && hover.w === s.w) || (sel && sel.kind === "l" && sel.l.name === s.w.lane) || (hover && hover.kind === "l" && hover.l.name === s.w.lane);
      const dim = Boolean(sel || hover);
      for (const s of SC.spheres) {
        const [sph, halo] = spriteFor(s.w.side);
        const al = s.fog * (dim && !hot(s) ? 0.45 : 1);
        const sh = cam(s.x + 0.06 * s.r, 0, s.z + 0.03 * s.r), rx = s.pr * 1.25, ry = rx * 0.45;
        ctx.globalAlpha = 0.32 * al;
        ctx.drawImage(SHADOW, sh.x - rx, sh.y - ry, rx * 2, ry * 2);
        const hr = s.pr * (hot(s) ? 2.1 : 1.6);
        ctx.globalAlpha = al * (hot(s) ? 0.5 : 0.28);
        ctx.drawImage(halo, s.px - hr, s.py - hr, hr * 2, hr * 2);
        ctx.globalAlpha = al;
        ctx.drawImage(sph, s.px - s.pr, s.py - s.pr, s.pr * 2, s.pr * 2);
        if (hot(s) && (sel && sel.kind === "w" && sel.w === s.w || hover && hover.kind === "w" && hover.w === s.w)) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = strong;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(s.px, s.py, s.pr + 3, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      const solids = [];
      const big = SC.spheres.slice().sort((a, b) => b.w.prem - a.w.prem).slice(0, phone ? 7 : TOP_LABELS);
      for (const s of big) {
        solids.push([s.px - s.pr, s.py - s.pr, s.px + s.pr, s.py + s.pr]);
        lab.add(s.w.t + " " + money(s.w.prem), s.px, s.py - s.pr - 4, "center", 5 + s.w.prem / (M.pMax || 1), strong, "600 " + (phone ? 10 : 11) + "px " + FONT);
      }
      const headFont = "600 " + (phone ? 9.5 : 11) + "px " + FONT;
      ctx.font = headFont;
      const headW = SC.heads.map((hd) => ctx.measureText(laneLabel(hd.lane)).width);
      let gapPx = Infinity;
      for (let i = 1; i < SC.heads.length; i++) gapPx = Math.min(gapPx, Math.abs(SC.heads[i].p.x - SC.heads[i - 1].p.x));
      const stagger = gapPx < Math.max(...headW) + 8;
      SC.heads.forEach((hd, i) => {
        const l = M.lanes.find((x) => x.name === hd.lane);
        const dy = stagger && i % 2 ? 27 : 0;
        lab.add(laneLabel(hd.lane), hd.p.x, hd.p.y + 14 + dy, "center", 12, strong, headFont);
        lab.add(money(l.prem), hd.p.x, hd.p.y + 27 + dy, "center", 11, body, (phone ? 9.5 : 10.5) + "px " + FONT);
      });
      lab.flush(solids, TOK.halo);
      void px;
    }

    function placeHits() {
      hits.replaceChildren();
      if (!SC) return;
      const order = SC.spheres.slice().sort((a, b) => b.w.prem - a.w.prem || a.w.i - b.w.i).slice(0, TOP_HITS);
      const first = sel ? null : order[0];
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      order.forEach((s, i) => {
        const d = Math.max(coarse ? 44 : 28, Math.round(s.pr * 2 + 6));
        const a = h("a", { class: "mk-rv-hit", href: "/flows/ticker/?t=" + encodeURIComponent(s.w.t), "data-t": s.w.t, "data-i": String(s.w.i), "data-rank": String(i), "aria-label": windowSentence(s.w), tabindex: (sel && sel.kind === "w" && sel.w === s.w) || s === first ? "0" : "-1",
          style: { left: (s.px - d / 2).toFixed(1) + "px", top: (s.py - d / 2).toFixed(1) + "px", width: d + "px", height: d + "px", zIndex: String(TOP_HITS - i) } });
        a.__w = s.w;
        hits.append(a);
      });
      SC.heads.forEach((hd) => {
        const l = M.lanes.find((x) => x.name === hd.lane);
        const b = h("button", { type: "button", class: "mk-rv-lane", "data-lane": hd.lane, "aria-label": laneSentence(l), "aria-pressed": String(Boolean(sel && sel.kind === "l" && sel.l === l)), tabindex: "-1",
          style: { left: (hd.p.x - 30).toFixed(1) + "px", top: (hd.p.y + 2).toFixed(1) + "px", height: (coarse ? 44 : 30) + "px" } });
        b.__l = l;
        hits.append(b);
      });
    }

    function render() {
      if (!M) return;
      wrap.dataset.state = !S.st || S.st.state !== "ok" ? S.st.state : M.windows.length ? "ok" : "quiet";
      empty.hidden = wrap.dataset.state === "ok";
      stage.hidden = !empty.hidden;
      details.hidden = !empty.hidden;
      if (!empty.hidden) {
        empty.textContent = S.st.state === "pending" ? "Pending: " + (S.st.reason || "the flagged windows have not published.") : S.st.state === "unavailable" ? "Unavailable: " + (S.st.reason || "the flagged windows could not be read.") : "No flagged window this session. A quiet reading, not a forecast.";
        read.textContent = "";
        note.textContent = "";
        canvas.setAttribute("aria-label", empty.textContent);
        return;
      }
      size();
      SC = layout(M, W, H, { phone: W < 640 });
      canvas.setAttribute("aria-label", describe());
      note.textContent = "Open at the back, last read at the front. A sphere is one vendor-flagged window at its minute in its name's sector lane; area is its premium (the largest, " + money(M.pMax) + "). Green: a call on the ask side or a put on the bid side, bullish by convention, when the vendor sided at least half its premium and at least 65% of that sat on one side; red the reverse; blue when the split is missing, mixed or mostly unsided. A blue sphere still adds its sided dollars to the lane figures in the tables, which split every window's dollars. The lane floor is the sector's net option tide at that minute" + (M.tideWhy ? " (" + M.tideWhy + ")" : "") + ". Times are TRT." + (M.dropped ? " " + M.dropped + " rows without a time or a premium are not drawn." : "");
      paint();
      placeHits();
      paintRead();
      paintTables();
    }

    const find = (el) => (el && el.__w ? { kind: "w", w: el.__w } : el && el.__l ? { kind: "l", l: el.__l } : null);
    hits.addEventListener("pointerover", (ev) => { const f = find(ev.target.closest && ev.target.closest(".mk-rv-hit, .mk-rv-lane")); if (!f || (hover && f.kind === hover.kind && (f.w === hover.w && f.l === hover.l))) return; hover = f; paint(); read.textContent = f.kind === "w" ? windowSentence(f.w) : laneSentence(f.l); });
    hits.addEventListener("pointerout", (ev) => { if (ev.relatedTarget && hits.contains(ev.relatedTarget)) return; if (!hover) return; hover = null; paint(); paintRead(); });
    let quietFocus = false;
    hits.addEventListener("focusin", (ev) => { const f = find(ev.target); if (!f || quietFocus) return; sel = f; paint(); placeHits(); paintRead(); const again = f.kind === "w" ? hits.querySelector('.mk-rv-hit[data-i="' + f.w.i + '"]') : hits.querySelector('.mk-rv-lane[data-lane="' + CSS.escape(f.l.name) + '"]'); if (again && document.activeElement !== again) again.focus(); });
    hits.addEventListener("click", (ev) => { const b = ev.target.closest && ev.target.closest(".mk-rv-lane"); if (!b) return; sel = { kind: "l", l: b.__l }; paint(); placeHits(); paintRead(); const again = hits.querySelector('.mk-rv-lane[data-lane="' + CSS.escape(b.__l.name) + '"]'); if (again) again.focus(); });
    hits.addEventListener("keydown", (ev) => {
      const el = ev.target.closest && ev.target.closest(".mk-rv-hit, .mk-rv-lane");
      if (!el || !SC) return;
      const list = [...hits.querySelectorAll(".mk-rv-hit")], lanes = [...hits.querySelectorAll(".mk-rv-lane")];
      let to = null;
      const isHit = el.classList.contains("mk-rv-hit");
      const i = isHit ? list.indexOf(el) : lanes.indexOf(el);
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") to = (isHit ? list : lanes)[i + 1];
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") to = (isHit ? list : lanes)[i - 1];
      else if (ev.key === "Home") to = (isHit ? list : lanes)[0];
      else if (ev.key === "End") to = (isHit ? list : lanes)[(isHit ? list : lanes).length - 1];
      else if (ev.key === "Escape") { sel = null; paint(); placeHits(); paintRead(); const f = hits.querySelector(".mk-rv-hit"); if (f) { quietFocus = true; f.focus(); quietFocus = false; } ev.preventDefault(); return; }
      else return;
      if (!to) return;
      ev.preventDefault();
      to.focus();
    });

    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (M && !dead && stage.clientWidth && (stage.clientWidth !== W || stage.clientHeight !== H)) render(); }) : null;
    if (ro) ro.observe(stage);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (M && !dead) { paint(); } });
    const onTheme = () => { TOK = null; if (M && !dead) paint(); };
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", onTheme);

    const rebuild = () => { M = model(S.alerts, { universe: S.universe, breadth: S.breadth, tide: S.tide }); sel = null; hover = null; render(); };
    const api = {
      take(alerts, st) {
        S.alerts = alerts && Array.isArray(alerts.rows) ? alerts : null;
        S.st = st || (S.alerts ? { state: "ok" } : { state: "pending", reason: "Reading the flagged windows." });
        rebuild();
      },
      update(o) { if (o.breadth !== undefined) S.breadth = o.breadth; if (o.tide !== undefined) S.tide = o.tide; if (o.universe !== undefined) S.universe = o.universe; if (S.alerts || S.st.state !== "pending") rebuild(); },
      model: () => M,
      scene: () => SC,
      labels: () => LAB,
      paints: () => paints,
      reduced: () => RM.matches,
      measure(n) { const t0 = performance.now(); for (let i = 0; i < n; i++) paint(); return (performance.now() - t0) / n; },
      destroy() { dead = true; if (ro) ro.disconnect(); if (mq.removeEventListener) mq.removeEventListener("change", onTheme); RIVERS.delete(host); },
    };
    RIVERS.set(host, api);
    if (opts.alerts) api.take(opts.alerts, opts.st);
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { river: Object.freeze({ model, layout, mount, of: (host) => RIVERS.get(host) || null, sideOf, trtOf }) }));
})();
