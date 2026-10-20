(() => {
  "use strict";
  const UI = window.FlowsUI;
  if (!UI || UI.floor) return;
  const { h, F, clamp } = UI;
  const DASH = UI.DASH, MID = " " + UI.MID + " ";
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const FONT = "Inter, system-ui, sans-serif";
  const PITCH_X = 1, PITCH_Z = 1.9, PITCH_Z_PHONE = 1.45, PHONE_COLS = 6, PED = 0.88, PIL = 0.58, STRIPE = 0.06;
  const HMAX = 2.1, HMAX_PHONE = 1.5;
  const LEAN_EDGE = 0.1, LEAN_FULL = 0.6;
  const SIDE_HITS = 12;
  const MEASURES = [
    { id: "premium", label: "Premium", noun: "flagged premium" },
    { id: "volume", label: "Volume", noun: "flagged contracts" },
    { id: "lean", label: "Net lean", noun: "net lean in premium" },
  ];
  const GROUPS = [
    { id: "funds", label: "Index funds" },
    { id: "etf", label: "Sector ETFs" },
    { id: "other", label: "Other funds" },
    { id: "stocks", label: "Stocks by sector" },
  ];
  const FUNDS = ["SPY", "QQQ", "IWM", "DIA"];
  const SECTOR_ETFS = [["XLK", "Tech"], ["XLC", "Comms"], ["XLY", "Cyclicals"], ["XLF", "Financials"], ["XLV", "Health care"], ["XLI", "Industrials"], ["XLP", "Staples"], ["XLE", "Energy"], ["XLB", "Materials"], ["XLU", "Utilities"], ["XLRE", "Real estate"]];
  const OTHER = {
    Bonds: ["TLT", "IEF", "SHY", "TLH", "HYG", "LQD", "AGG", "BND", "JNK", "TBT", "TMF"],
    Commodities: ["GLD", "SLV", "USO", "UNG", "GDX", "GDXJ", "COPX", "DBC", "PDBC", "IAU", "PPLT", "CPER", "URA", "SIL"],
    "Index options": ["SPX", "SPXW", "NDX", "NDXP", "RUT", "RUTW", "VIX", "VIXW", "XSP", "DJX", "MRUT"],
    Volatility: ["VXX", "UVXY", "SVXY", "VIXY", "SVIX", "UVIX"],
    Crypto: ["IBIT", "BITO", "ETHA", "FBTC", "GBTC", "ETHE", "ARKB", "BITX"],
    International: ["EEM", "EFA", "FXI", "EWZ", "KWEB", "EWJ", "INDA", "EWY", "EWT", "VWO", "MCHI", "EWG"],
  };
  const FUND_OF = new Map(FUNDS.map((t) => [t, t]));
  const ETF_OF = new Map(SECTOR_ETFS.map(([t, s]) => [t, s]));
  const OTHER_OF = new Map();
  for (const [cls, list] of Object.entries(OTHER)) for (const t of list) OTHER_OF.set(t, cls);
  const SHORT = { "Technology": "Tech", "Consumer Cyclical": "Cyclicals", "Communication Services": "Comms", "Financial Services": "Financials", "Consumer Defensive": "Defensives", "Basic Materials": "Materials", "Real Estate": "Real estate", "Healthcare": "Health care" };
  const STOCK_NONE = "No sector", STOCK_UNREAD = "Sector unread";
  const LEAN_CAT = { "-1": "down", "0": "mixed", "1": "up" };
  const LEAN_WORD = { up: "bullish by convention", down: "bearish by convention", mixed: "mixed" };
  const FLOORS = new WeakMap();

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgb = (c) => "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")";
  const rgba = (c, a) => "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + a + ")";
  const money = (v) => F.money(v);
  const moneyS = (v) => (isNum(v) ? F.money(v, true) : DASH);

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

  function sideOf(r) {
    const x = UI.F.askSplit(r);
    if (!x || !x.askStated || !x.bidStated || x.ask === x.bid) return "nx";
    const askSide = x.ask > x.bid;
    return r.cp === "C" ? (askSide ? "up" : "down") : (askSide ? "down" : "up");
  }

  const leanOf = (net, prem) => {
    if (!isNum(net) || !isNum(prem) || !(prem > 0)) return null;
    const r = net / prem;
    return { ratio: r, cat: Math.abs(r) < LEAN_EDGE ? "mixed" : LEAN_CAT[String(Math.sign(r))] };
  };

  function valueOf(t, measure) {
    if (measure === "volume") return t.volN ? t.vol : null;
    return t.n ? (measure === "lean" ? t.net : t.prem) : null;
  }
  function whyNull(t, measure) {
    if (!t.n) return "No window of this class was flagged this session.";
    return measure === "volume" ? "The flagged windows of this class carried no contract count." : "No value.";
  }

  function model(alerts, o = {}) {
    const rows = alerts && Array.isArray(alerts.rows) ? alerts.rows : [];
    const u = o.universe;
    const uniOk = Boolean(u && u.status === "ok" && Array.isArray(u.t) && Array.isArray(u.sec) && Array.isArray(u.sectors));
    const secOf = new Map();
    if (uniOk) u.t.forEach((t, i) => secOf.set(String(t).toUpperCase(), Number.isInteger(u.sec[i]) ? u.sectors[u.sec[i]] || null : null));
    const tiles = new Map();
    const ensure = (id, group, label, sub, order) => {
      let t = tiles.get(id);
      if (!t) { t = { id, group, label, sub, order, n: 0, prem: 0, up: 0, down: 0, nx: 0, vol: 0, volN: 0, names: new Map() }; tiles.set(id, t); }
      return t;
    };
    FUNDS.forEach((f, i) => ensure("funds:" + f, "funds", f, "Index fund", i));
    SECTOR_ETFS.forEach(([f, s], i) => ensure("etf:" + f, "etf", f, s, i));
    let dropped = 0;
    const windows = [];
    rows.forEach((r, i) => {
      if (!r || typeof r.t !== "string" || !isNum(r.prem) || !(r.prem > 0)) { dropped++; return; }
      const T = r.t.toUpperCase();
      let tile;
      if (FUND_OF.has(T)) tile = tiles.get("funds:" + T);
      else if (ETF_OF.has(T)) tile = tiles.get("etf:" + T);
      else if (OTHER_OF.has(T)) tile = ensure("other:" + OTHER_OF.get(T), "other", OTHER_OF.get(T), OTHER_OF.get(T) === "Index options" ? "Cash-settled index roots" : "Other fund class", 0);
      else {
        const sec = !uniOk ? STOCK_UNREAD : secOf.get(T) || STOCK_NONE;
        tile = ensure("stocks:" + sec, "stocks", SHORT[sec] || sec, sec, 0);
      }
      const side = sideOf(r), size = isNum(r.size) && r.size >= 0 ? r.size : null;
      windows.push({ i, t: T, tile: tile.id, prem: r.prem, side, size });
      tile.n++; tile.prem += r.prem; tile[side] += r.prem;
      if (size !== null) { tile.vol += size; tile.volN++; }
      const nm = tile.names.get(T) || { t: T, n: 0, prem: 0, up: 0, down: 0, nx: 0, vol: 0, volN: 0 };
      nm.n++; nm.prem += r.prem; nm[side] += r.prem;
      if (size !== null) { nm.vol += size; nm.volN++; }
      tile.names.set(T, nm);
    });
    const total = windows.reduce((a, w) => a + w.prem, 0);
    const list = [...tiles.values()];
    for (const t of list) {
      t.net = t.up - t.down;
      t.lean = leanOf(t.net, t.prem);
      t.share = total > 0 && t.n ? t.prem / total : null;
      t.nameList = [...t.names.values()].map((x) => ({ ...x, net: x.up - x.down, lean: leanOf(x.up - x.down, x.prem) })).sort((a, b) => b.prem - a.prem || (a.t < b.t ? -1 : 1));
      t.top = t.nameList.slice(0, 3);
    }
    const groups = GROUPS.map((g) => {
      const ts = list.filter((t) => t.group === g.id);
      if (g.id === "other" || g.id === "stocks") ts.sort((a, b) => b.prem - a.prem || (a.label < b.label ? -1 : 1));
      else ts.sort((a, b) => a.order - b.order);
      const prem = ts.reduce((a, t) => a + t.prem, 0), n = ts.reduce((a, t) => a + t.n, 0);
      const volN = ts.reduce((a, t) => a + t.volN, 0);
      return { ...g, tiles: ts, n, prem, vol: volN ? ts.reduce((a, t) => a + t.vol, 0) : null, share: total > 0 && n ? prem / total : null };
    }).filter((g) => g.tiles.length);
    const ordered = groups.flatMap((g) => g.tiles);
    const session = alerts && typeof alerts.sessionDate === "string" ? alerts.sessionDate.slice(0, 10) : null;
    return { session, windows, tiles: ordered, groups, total, dropped, uniOk, count: windows.length };
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
  const DEFAULT_VIEW = { desk: { yaw: 6 * DEG, pitch: 43 * DEG, dist: 7.5 }, phone: { yaw: 5 * DEG, pitch: 50 * DEG, dist: 11 } };

  function layout(M, measure, W, H, o = {}) {
    const phone = Boolean(o.phone);
    const rows = M.groups;
    if (!rows.length) return null;
    const cap = phone ? PHONE_COLS : 99, pz = phone ? PITCH_Z_PHONE : PITCH_Z;
    const lines = [];
    rows.forEach((g) => { for (let i = 0; i < g.tiles.length; i += cap) lines.push({ g, tiles: g.tiles.slice(i, i + cap), first: i === 0, ri: lines.length }); });
    const cols = Math.max(...lines.map((l) => l.tiles.length));
    const xr = (cols * PITCH_X) / 2, zr = (lines.length * pz) / 2;
    const base = phone ? DEFAULT_VIEW.phone : DEFAULT_VIEW.desk;
    const view = { yaw: isNum(o.yaw) ? o.yaw : base.yaw, pitch: isNum(o.pitch) ? o.pitch : base.pitch, dist: base.dist };
    const hmax = phone ? HMAX_PHONE : HMAX;
    const vals = M.tiles.map((t) => valueOf(t, measure)).filter(isNum).map(Math.abs);
    const vMax = vals.length ? Math.max(...vals) : 0;
    const shares = M.tiles.map((t) => t.share).filter(isNum);
    const sMax = shares.length ? Math.max(...shares) : 0;
    const lineZ = (ri) => zr - pz * (ri + 0.5);
    const floorPts = [[-xr - 0.3, 0, -zr], [xr + 0.3, 0, -zr], [xr + 0.3, 0, zr], [-xr - 0.3, 0, zr]];
    const tops = [[-xr, hmax, zr], [xr, hmax, zr]];
    const cam = fitCam(view, W, H, floorPts.concat(tops), phone ? { l: 6, r: 6, t: 10, b: 30 } : { l: 128, r: 12, t: 30, b: 40 });
    const zs = floorPts.map((p) => cam(p[0], p[1], p[2]).z);
    const near = Math.min(...zs), far = Math.max(...zs);
    const tiles = [];
    for (const ln of lines) {
      ln.tiles.forEach((t, c) => {
        const x = (c - (ln.tiles.length - 1) / 2) * PITCH_X, z = lineZ(ln.ri);
        const v = valueOf(t, measure);
        const hgt = isNum(v) && vMax > 0 ? (Math.abs(v) / vMax) * hmax : 0;
        const lean = t.lean ? t.lean.cat : null;
        const s = { id: t.id, group: ln.g.id, row: ln.ri, col: c, label: t.label, x, z, v, h: hgt, lean, share: t.share, stripe: isNum(t.share) && sMax > 0 ? t.share / sMax : null };
        const ped = [[x - PED / 2, 0, z - PED / 2], [x + PED / 2, 0, z - PED / 2], [x + PED / 2, 0, z + PED / 2], [x - PED / 2, 0, z + PED / 2]];
        const c0 = cam(x, 0, z), top = cam(x, hgt, z);
        const proj = ped.map((p) => cam(p[0], p[1], p[2]));
        const half = (PIL / 2) * top.k * cam.params.scale;
        const xs = proj.map((q) => q.x).concat([top.x - half, top.x + half]);
        const ys = proj.map((q) => q.y).concat([top.y - half * 0.6]);
        Object.assign(s, { ped, px: top.x, py: top.y, bx: c0.x, by: c0.y, pz: c0.z, pw: PIL * c0.k * cam.params.scale, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
        tiles.push(s);
      });
    }
    const order = tiles.slice().sort((a, b) => b.pz - a.pz);
    const heads = lines.filter((l) => l.first).map((l) => ({ id: l.g.id, ri: l.ri, p: cam(-xr, 0, lineZ(l.ri) + (phone ? PED / 2 + 0.12 : 0)) }));
    return { W, H, phone, cam: cam.params, view, xr, zr, hmax, vMax, sMax, near, far, tiles, order, heads, lines: lines.length, measure, floor: floorPts.map((p) => cam(p[0], p[1], p[2])), rowQuads: lines.map((l) => [[-xr - 0.2, 0, lineZ(l.ri) + pz / 2 - 0.06], [xr + 0.2, 0, lineZ(l.ri) + pz / 2 - 0.06], [xr + 0.2, 0, lineZ(l.ri) - pz / 2 + 0.06], [-xr - 0.2, 0, lineZ(l.ri) - pz / 2 + 0.06]]) };
  }

  const mk = (w, hh) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = hh; return cv; };
  function glowSprite(c, a0, a1) {
    const S = 64, cv = mk(S, S), g = cv.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(c, a0));
    gr.addColorStop(0.45, rgba(c, a1));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return cv;
  }

  const behind = (cols, own, z, box) => cols.some((c) => c.id !== own && c.z < z && c.box[0] < box[2] && box[0] < c.box[2] && c.box[1] < box[3] && box[1] < c.box[3]);
  function labeler(ctx, w, hh, out, cols) {
    const q = [];
    const hit = (a, b) => a[0] < b[2] + 3 && b[0] < a[2] + 3 && a[1] < b[3] + 2 && b[1] < a[3] + 2;
    return {
      add(text, x, y, align, prio, color, font, own) { q.push({ text, x, y, align, prio, color, font, own }); },
      flush(halo) {
        const kept = [];
        q.sort((a, b) => b.prio - a.prio);
        for (const it of q) {
          ctx.font = it.font;
          const tw = ctx.measureText(it.text).width, th = parseFloat((/([\d.]+)px/.exec(it.font) || [0, 11])[1]);
          let x0 = it.align === "center" ? it.x - tw / 2 : it.align === "right" ? it.x - tw : it.x;
          x0 = clamp(x0, 3, Math.max(3, w - tw - 3));
          const y0 = clamp(it.y - th, 2, hh - th - 2);
          const box = [x0, y0, x0 + tw, y0 + th + 2];
          if (kept.some((k) => hit(k, box))) { out.dropped.push(it.text); continue; }
          if (it.own && behind(cols, it.own.id, it.own.z, box)) { out.dropped.push(it.text); continue; }
          kept.push(box);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.lineJoin = "round";
          ctx.lineWidth = 3;
          ctx.strokeStyle = halo;
          ctx.strokeText(it.text, x0, y0 + th);
          ctx.fillStyle = it.color;
          ctx.fillText(it.text, x0, y0 + th);
          out.labels.push({ text: it.text, box, prio: it.prio, own: it.own && it.own.id });
        }
      },
    };
  }

  function mount(host, opts = {}) {
    if (!host) return null;
    const prev = FLOORS.get(host);
    if (prev) prev.destroy();
    const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
    const S = { alerts: null, st: { state: "pending", reason: "Reading the flagged windows." }, universe: opts.universe };
    let M = null, SC = null, W = 0, H = 0, dpr = 1, sel = null, hover = null, paints = 0, dead = false, measure = "premium", yaw = null, pitch = null, wide = false, LAB = { labels: [], dropped: [] };
    let TOK = null, SHADOW = null;
    const glows = new Map();
    const tokens = () => {
      const cs = getComputedStyle(host);
      const get = (k, d) => cs.getPropertyValue(k).trim() || d;
      TOK = {
        up: parseColor(get("--up-mark", "#24ae56")), down: parseColor(get("--down-mark", "#e54c4a")), blue: parseColor(get("--accent", "#4ea2ff")), slate: parseColor(get("--label-3", "#8a93a6")),
        strong: get("--label-1", "#f5f5f7"), body: get("--label-2", "#b4b9c6"), faint: get("--label-3", "#8a93a6"), surface: parseColor(get("--surface-2", "#131722")), halo: get("--surface-1", "#0d1017"),
      };
      glows.clear();
    };
    const colorOf = (s) => {
      if (!s.lean) return TOK.slate;
      const t = M.tiles.find((x) => x.id === s.id), r = t && t.lean ? t.lean.ratio : 0;
      if (s.lean === "mixed") return TOK.slate;
      const base = s.lean === "up" ? TOK.up : TOK.down;
      return mix(TOK.slate, base, 0.4 + 0.6 * clamp((Math.abs(r) - LEAN_EDGE) / (LEAN_FULL - LEAN_EDGE), 0, 1));
    };
    const glowFor = (c) => { const k = rgb(c); if (!glows.has(k)) glows.set(k, glowSprite(c, 0.7, 0.22)); return glows.get(k); };

    const canvas = h("canvas", { class: "mk-fl-c", role: "img", "aria-label": "The trading floor" });
    const hits = h("div", { class: "mk-fl-hits" });
    const stage = h("div", { class: "mk-fl-stage" }, canvas, hits);
    const side = h("div", { class: "mk-fl-side", hidden: "" });
    const read = h("p", { class: "mk-fl-read", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const legend = h("p", { class: "mk-fl-leg" },
      h("span", { class: "mk-fl-k", "data-k": "up" }, "Bullish"), h("span", { class: "mk-fl-k", "data-k": "mixed" }, "Mixed"), h("span", { class: "mk-fl-k", "data-k": "down" }, "Bearish"), h("span", { class: "mk-fl-conv" }, "lean by convention"), h("span", { class: "mk-fl-heights" }));
    const note = h("p", { class: "mk-fl-note" });
    const fullNote = h("p", { class: "mk-fl-fn" });
    const empty = h("p", { class: "mk-fl-empty" });
    const tables = h("div", { class: "mk-fl-tables", hidden: "" });
    const dlg = h("dialog", { class: "nm-dlg mk-fl-dlg", "aria-labelledby": "mkFloorDlgT" });
    const tableBtn = h("button", { type: "button", class: "mk-fl-tb", "aria-haspopup": "dialog" }, "Tables: the classes and their names");
    const recentre = h("button", { type: "button", class: "mk-fl-tb mk-fl-rc" }, "Recentre");
    const details = h("div", { class: "mk-fl-d" }, tableBtn, recentre);
    const main = h("div", { class: "mk-fl-main" }, stage, side);
    const wrap = h("div", { class: "mk-fl", "data-state": "pending" }, read, main, empty, legend, note, details, tables, dlg);
    host.replaceChildren(wrap);
    const segHost = (host.closest(".mk-mod") && host.closest(".mk-mod").querySelector(".mk-segc")) || null;
    const seg = UI.segmented("Height", MEASURES.map((m) => ({ label: m.label })), (i) => { measure = MEASURES[i].id; relayout(); }, 0);
    if (segHost) segHost.replaceChildren(seg); else wrap.insertBefore(seg, wrap.firstChild);
    tableBtn.addEventListener("click", () => {
      const close = h("button", { type: "button", class: "nm-link", onclick: () => dlg.close() }, "Close");
      tables.hidden = false;
      dlg.replaceChildren(h("div", { class: "nm-dg" }, h("h3", { id: "mkFloorDlgT" }, "The floor's classes and names"), h("p", { class: "mk-fl-fn" }, fullNote.textContent), h("div", { class: "nm-dtw" }, tables), h("div", { class: "nm-dx" }, close)));
      if (typeof dlg.showModal === "function") dlg.showModal();
    });
    dlg.addEventListener("close", () => { tables.hidden = true; wrap.insertBefore(tables, dlg); });
    const ctx = canvas.getContext("2d");
    const meas = () => MEASURES.find((m) => m.id === measure);
    const tileOf = (id) => M && M.tiles.find((t) => t.id === id);
    const groupOf = (t) => M.groups.find((g) => g.id === t.group);

    const volText = (t) => (t.volN ? "volume " + F.num(t.vol) + " contracts" + (t.volN < t.n ? " from " + t.volN + " of " + t.n + " windows" : "") : "volume " + DASH + " (no contract count carried)");
    const leanText = (t) => (t.n ? "net lean " + moneyS(t.net) + ", " + (t.lean ? LEAN_WORD[t.lean.cat] : DASH) : "");
    const topText = (t) => (t.top.length ? "top names " + t.top.map((x) => x.t + " " + money(x.prem)).join(", ") : "no names");
    const tileSentence = (t) => {
      const g = groupOf(t);
      if (!t.n) return t.label + MID + g.label + MID + DASH + " no flagged window this session";
      return t.label + (t.sub && t.sub !== t.label ? " (" + t.sub + ")" : "") + MID + g.label + MID + money(t.prem) + " flagged" + (isNum(t.share) ? " (" + F.pct(t.share, 1) + " of all)" : "") + MID + volText(t) + MID + leanText(t) + MID + topText(t);
    };
    const shortSentence = (t) => (t.n ? t.label + MID + money(t.prem) + (isNum(t.share) ? " (" + F.pct(t.share, 0) + ")" : "") + MID + (t.volN ? F.num(t.vol) + " contracts" : "volume " + DASH) + MID + (t.lean ? LEAN_WORD[t.lean.cat] : DASH) : t.label + MID + DASH + " no flagged window");
    const groupSentence = (g) => g.label + MID + (g.n ? money(g.prem) + " flagged" + (isNum(g.share) ? " (" + F.pct(g.share, 1) + " of all)" : "") + MID + (g.vol === null ? "volume " + DASH : "volume " + F.num(g.vol) + " contracts") : DASH + " no flagged window");
    const leader = () => M.tiles.filter((t) => isNum(valueOf(t, measure))).sort((a, b) => Math.abs(valueOf(b, measure)) - Math.abs(valueOf(a, measure)) || (a.id < b.id ? -1 : 1))[0] || null;
    const sentence = () => {
      if (!M || !M.count) return "";
      const t = hover || sel;
      if (t) return W < 640 ? shortSentence(t) : tileSentence(t);
      const best = M.groups.filter((g) => g.n).sort((a, b) => b.prem - a.prem)[0];
      const l = leader();
      return (best ? "Most premium: " + groupSentence(best) + ". " : "") + (W < 640 ? "" : l ? "Tallest pillar: " + l.label + MID + (measure === "volume" ? F.num(valueOf(l, measure)) + " contracts" : measure === "lean" ? "net lean " + moneyS(valueOf(l, measure)) : money(valueOf(l, measure))) + "." : "");
    };
    const paintRead = () => { read.textContent = sentence(); };

    function describe() {
      if (!M || !M.count) return "The floor has no flagged windows to draw.";
      const best = M.groups.filter((g) => g.n).sort((a, b) => b.prem - a.prem)[0];
      const l = leader();
      return M.tiles.length + " classes on " + M.groups.length + " rows, " + M.count + " flagged windows, " + money(M.total) + ". " + (best ? best.label + " draws the most premium, " + money(best.prem) + ". " : "") + "Pillar height is " + meas().noun + ", one scale" + (l ? ", the tallest " + l.label : "") + ". The tables list every class and its names.";
    }

    function paintTables() {
      if (!M) { tables.replaceChildren(); return; }
      const th = (t, c) => h("th", { scope: "col", class: c || null }, t);
      const cell = (txt, why) => h("td", { class: "c-num", title: why || null }, txt);
      const ranked = M.tiles.slice().sort((a, b) => b.prem - a.prem || (a.id < b.id ? -1 : 1));
      const classes = h("table", { class: "mk-tbl mk-fl-t" }, h("caption", null, "Classes ranked by flagged premium, with volume in contracts and lean by convention"),
        h("thead", null, h("tr", null, th("Class"), th("Group"), th("Premium", "c-num"), th("Share", "c-num"), th("Volume", "c-num"), th("Net lean", "c-num"), th("Windows", "c-num"))),
        h("tbody", null, ranked.map((t) => h("tr", { "data-id": t.id }, h("th", { scope: "row" }, t.label), h("td", null, groupOf(t).label),
          cell(t.n ? money(t.prem) : DASH, t.n ? null : whyNull(t, "premium")), cell(isNum(t.share) ? F.pct(t.share, 1) : DASH), cell(t.volN ? F.num(t.vol) : DASH, t.volN ? null : whyNull(t, "volume")),
          cell(t.n ? moneyS(t.net) : DASH, t.n ? null : whyNull(t, "lean")), cell(String(t.n))))));
      const names = M.tiles.flatMap((t) => t.nameList.map((x) => ({ ...x, cls: t }))).sort((a, b) => b.prem - a.prem || (a.t < b.t ? -1 : 1)).slice(0, 40);
      const nameT = h("table", { class: "mk-tbl mk-fl-t" }, h("caption", null, "The " + names.length + " names with the most flagged premium"),
        h("thead", null, h("tr", null, th("Name"), th("Class"), th("Premium", "c-num"), th("Volume", "c-num"), th("Lean"))),
        h("tbody", null, names.map((x) => h("tr", { "data-t": x.t }, h("th", { scope: "row" }, h("a", { href: "/flows/ticker/?t=" + encodeURIComponent(x.t) }, x.t)), h("td", null, x.cls.label), cell(money(x.prem)), cell(x.volN ? F.num(x.vol) : DASH),
          h("td", { "data-lean": x.lean ? x.lean.cat : "none" }, x.lean ? LEAN_WORD[x.lean.cat] : DASH)))));
      tables.replaceChildren(classes, nameT);
    }

    function paintSide(rowsFit) {
      side.replaceChildren();
      if (!M || !wide) { side.hidden = true; return; }
      side.hidden = false;
      const rowsN = Math.max(3, rowsFit);
      if (sel) {
        const g = groupOf(sel);
        side.append(h("div", { class: "mk-fl-sh" }, h("h3", null, sel.label), h("button", { type: "button", class: "mk-fl-x", onclick: () => select(null) }, "Back to classes")), h("p", { class: "mk-fl-ss" }, g.label + MID + (sel.n ? money(sel.prem) : DASH)));
        if (!sel.n) { side.append(h("p", { class: "mk-fl-sn" }, "No window of this class was flagged this session.")); return; }
        const list = h("ol", { class: "mk-fl-list" });
        sel.nameList.slice(0, rowsN).forEach((x) => list.append(h("li", { "data-lean": x.lean ? x.lean.cat : "none" }, h("a", { href: "/flows/ticker/?t=" + encodeURIComponent(x.t) }, x.t), h("span", { class: "mk-fl-v" }, money(x.prem)), h("span", { class: "mk-fl-p" }, F.pct(x.prem / sel.prem, 0)))));
        side.append(list);
        if (sel.nameList.length > rowsN) side.append(h("p", { class: "mk-fl-sn" }, "+" + (sel.nameList.length - rowsN) + " more in the tables"));
        return;
      }
      side.append(h("div", { class: "mk-fl-sh" }, h("h3", null, "Classes by " + (measure === "volume" ? "volume" : measure === "lean" ? "net lean" : "premium"))));
      const rank = M.tiles.filter((t) => isNum(valueOf(t, measure))).sort((a, b) => Math.abs(valueOf(b, measure)) - Math.abs(valueOf(a, measure)) || (a.id < b.id ? -1 : 1));
      const list = h("ol", { class: "mk-fl-list" });
      rank.slice(0, rowsN).forEach((t) => {
        const v = valueOf(t, measure);
        list.append(h("li", { "data-lean": t.lean ? t.lean.cat : "none" }, h("button", { type: "button", class: "mk-fl-pick", "data-id": t.id, onclick: () => select(t) }, t.label), h("span", { class: "mk-fl-v" }, measure === "volume" ? F.num(v) : measure === "lean" ? moneyS(v) : money(v)), h("span", { class: "mk-fl-p" }, isNum(t.share) ? F.pct(t.share, 0) : DASH)));
      });
      side.append(list);
      const left = M.tiles.length - Math.min(rowsN, rank.length);
      if (left > 0) side.append(h("p", { class: "mk-fl-sn" }, "+" + left + " more in the tables"));
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

    const poly = (cam, pts) => { ctx.beginPath(); pts.forEach((p, i) => { const q = cam(p[0], p[1], p[2]); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); };
    const polyQ = (qs) => { ctx.beginPath(); qs.forEach((q, i) => { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); };
    const LDIR = [-0.55, 0.62, -0.56];

    function pillar(cam, s, c, al, hot) {
      const x0 = s.x - PIL / 2, x1 = s.x + PIL / 2, z0 = s.z - PIL / 2, z1 = s.z + PIL / 2, hh = s.h;
      const faces = [
        { n: [0, 0, -1], v: [[x0, 0, z0], [x1, 0, z0], [x1, hh, z0], [x0, hh, z0]] },
        { n: [0, 0, 1], v: [[x1, 0, z1], [x0, 0, z1], [x0, hh, z1], [x1, hh, z1]] },
        { n: [-1, 0, 0], v: [[x0, 0, z1], [x0, 0, z0], [x0, hh, z0], [x0, hh, z1]] },
        { n: [1, 0, 0], v: [[x1, 0, z0], [x1, 0, z1], [x1, hh, z1], [x1, hh, z0]] },
      ];
      for (const f of faces) { const q = f.v.map((p) => cam(p[0], p[1], p[2])); f.q = q; f.zc = (q[0].z + q[1].z + q[2].z + q[3].z) / 4; f.d = f.n[0] * LDIR[0] + f.n[2] * LDIR[2]; }
      faces.sort((a, b) => b.zc - a.zc);
      const rim = mix(c, WHITE, 0.6);
      for (const f of faces) {
        const shade = clamp(0.64 + 0.5 * f.d, 0.3, 1);
        const fc = mix(c, BLACK, 1 - shade);
        const gr = ctx.createLinearGradient(0, f.q[3].y, 0, f.q[0].y);
        gr.addColorStop(0, rgba(mix(fc, WHITE, 0.16), 0.9 * al));
        gr.addColorStop(1, rgba(mix(fc, BLACK, 0.35), 0.62 * al));
        polyQ(f.q);
        ctx.fillStyle = gr;
        ctx.fill();
        if (f.d > 0.2 && hh > 0.12) {
          const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
          const bl = lerp(f.q[0], f.q[1], 0.14), br = lerp(f.q[0], f.q[1], 0.3), tl = lerp(f.q[3], f.q[2], 0.14), tr = lerp(f.q[3], f.q[2], 0.3);
          const sp = ctx.createLinearGradient(0, bl.y, 0, tl.y);
          sp.addColorStop(0, rgba(WHITE, 0));
          sp.addColorStop(0.35, rgba(WHITE, 0.34 * al));
          sp.addColorStop(1, rgba(WHITE, 0.08 * al));
          polyQ([bl, br, tr, tl]);
          ctx.fillStyle = sp;
          ctx.fill();
        }
        polyQ(f.q);
        ctx.strokeStyle = rgba(rim, 0.5 * al);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      const top = [[x0, hh, z0], [x1, hh, z0], [x1, hh, z1], [x0, hh, z1]].map((p) => cam(p[0], p[1], p[2]));
      polyQ(top);
      const tg = ctx.createLinearGradient(top[0].x, top[0].y, top[2].x, top[2].y);
      tg.addColorStop(0, rgba(mix(c, WHITE, 0.62), al));
      tg.addColorStop(1, rgba(mix(c, WHITE, 0.22), al));
      ctx.fillStyle = tg;
      ctx.fill();
      ctx.strokeStyle = rgba(rim, (hot ? 1 : 0.85) * al);
      ctx.lineWidth = hot ? 1.6 : 1;
      ctx.stroke();
    }

    function paint() {
      if (dead || !ctx) return;
      paints++;
      if (!TOK) tokens();
      if (!SHADOW) SHADOW = glowSprite(BLACK, 1, 0.5);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!SC) return;
      const cols = [];
      LAB = { labels: [], dropped: [], cols };
      const lab = labeler(ctx, W, H, LAB, cols);
      const cam = camera(SC.cam);
      for (const s of SC.tiles) if (s.v !== null && s.h > 0) {
        const box = [1e9, 1e9, -1e9, -1e9];
        for (let k = 0; k < 8; k++) {
          const p = cam(s.x + (k & 1 ? PIL : -PIL) / 2, k & 2 ? s.h : 0, s.z + (k & 4 ? PIL : -PIL) / 2);
          box[0] = Math.min(box[0], p.x); box[1] = Math.min(box[1], p.y); box[2] = Math.max(box[2], p.x); box[3] = Math.max(box[3], p.y);
        }
        cols.push({ id: s.id, z: s.pz, box });
      }
      const phone = SC.phone;
      const fl = SC.floor;
      const ctr = cam(0, 0, 0);
      const R = Math.max(W, H) * 0.62;
      polyQ(fl);
      const pool = ctx.createRadialGradient(ctr.x, ctr.y, 0, ctr.x, ctr.y, R);
      pool.addColorStop(0, rgba(mix(TOK.surface, TOK.blue, 0.22), 1));
      pool.addColorStop(0.55, rgba(mix(TOK.surface, TOK.blue, 0.07), 1));
      pool.addColorStop(1, rgba(TOK.surface, 1));
      ctx.fillStyle = pool;
      ctx.fill();
      ctx.strokeStyle = rgba(mix(TOK.blue, WHITE, 0.3), 0.3);
      ctx.lineWidth = 1;
      ctx.stroke();
      for (const rq of SC.rowQuads) {
        poly(cam, rq);
        ctx.fillStyle = rgba(TOK.blue, 0.05);
        ctx.fill();
        ctx.strokeStyle = rgba(TOK.blue, 0.16);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      const gx0 = -SC.xr - 0.3, gx1 = SC.xr + 0.3, gz0 = -SC.zr, gz1 = SC.zr;
      ctx.lineWidth = 0.7;
      for (let x = Math.ceil(gx0 * 2) / 2; x <= gx1 + 1e-9; x += 0.5) {
        const a = cam(x, 0, gz0), b = cam(x, 0, gz1);
        ctx.strokeStyle = rgba(mix(TOK.blue, WHITE, 0.35), 0.2 * fogOf((a.z + b.z) / 2, SC.near, SC.far, 0.35) * (Math.abs(x % 1) < 1e-6 ? 1 : 0.55));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let z = gz0; z <= gz1 + 1e-9; z += 0.5) {
        const a = cam(gx0, 0, z), b = cam(gx1, 0, z);
        ctx.strokeStyle = rgba(mix(TOK.blue, WHITE, 0.35), 0.22 * fogOf((a.z + b.z) / 2, SC.near, SC.far, 0.35) * (Math.abs(z % 1.5) < 1e-6 ? 1 : 0.55));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      const dim = Boolean(sel || hover);
      const hotOf = (s) => (sel && sel.id === s.id) || (hover && hover.id === s.id);
      for (const s of SC.order) {
        const t = tileOf(s.id), c = colorOf(s), hot = hotOf(s), fog = fogOf(s.pz, SC.near, SC.far, 0.55), al = fog * (dim && !hot ? 0.45 : 1);
        const sh = s.stripe === null ? 0 : s.stripe;
        poly(cam, s.ped);
        ctx.globalAlpha = al;
        ctx.fillStyle = rgb(mix(TOK.surface, c, s.v === null ? 0.06 : 0.14 + 0.22 * sh));
        ctx.fill();
        if (s.v === null) {
          ctx.strokeStyle = rgb(TOK.slate);
          ctx.globalAlpha = 0.55 * al;
          ctx.lineWidth = 0.9;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = rgb(mix(c, WHITE, 0.3));
          ctx.globalAlpha = (hot ? 0.95 : 0.5) * al;
          ctx.lineWidth = hot ? 1.6 : 1;
          ctx.stroke();
        }
        if (s.v !== null) {
          const gr = s.pw * (1.9 + 1.6 * sh);
          ctx.globalAlpha = al * (0.28 + 0.4 * sh);
          ctx.drawImage(glowFor(c), s.bx - gr, s.by - gr * 0.55, gr * 2, gr * 1.1);
          if (s.h > 0) {
            const q = cam(s.x + 0.1 + s.h * 0.35, 0, s.z + 0.12 + s.h * 0.3), rx = s.pw * (1.1 + s.h * 0.5), ry = rx * 0.42;
            ctx.globalAlpha = 0.42 * al;
            ctx.drawImage(SHADOW, q.x - rx, q.y - ry, rx * 2, ry * 2);
          }
          ctx.globalAlpha = 1;
          pillar(cam, s, c, al, hot);
          if (s.stripe !== null) {
            const zf = s.z - PED / 2 + 0.05, x0 = s.x - PED / 2 + 0.06, len = (PED - 0.12) * s.stripe;
            poly(cam, [[x0, 0, zf], [x0 + len, 0, zf], [x0 + len, 0, zf + STRIPE], [x0, 0, zf + STRIPE]]);
            ctx.globalAlpha = 0.95 * al;
            ctx.fillStyle = TOK.strong;
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        void t;
      }
      ctx.globalAlpha = 1;
      const tf = "600 " + (phone ? 9 : 11) + "px " + FONT, vf = "600 " + (phone ? 9.5 : 11) + "px " + FONT;
      const ranked = SC.tiles.filter((s) => s.v !== null).sort((a, b) => b.h - a.h);
      const topSet = new Set(ranked.slice(0, phone ? 3 : 7).map((s) => s.id));
      ctx.font = tf;
      const lineOf = new Map();
      for (const s of SC.tiles) { if (!lineOf.has(s.row)) lineOf.set(s.row, []); lineOf.get(s.row).push(s); }
      const level = new Map();
      const step = phone ? 11 : 14, lh = phone ? 11 : 13;
      const labelY = (s) => cam(s.x, 0, s.z - PED / 2 - 0.06).y + (phone ? 10 : 14);
      const placed = [];
      for (const list of [...lineOf.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])) {
        list.sort((a, b) => a.col - b.col);
        for (const s of list) {
          const w = ctx.measureText(s.label).width + 6, y = labelY(s), fx = cam(s.x, 0, s.z - PED / 2 - 0.06).x;
          let at = [0, 0];
          out: for (const lv of [0, 1, 2, 3, -1, -2, -3, -4, -5]) for (let i = 0; i < 25; i++) {
            const dx = (i & 1 ? -(i + 1) : i) * w / 4, dy = lv * step, x = fx + dx;
            if (x < w / 2 + 3 || x > W - w / 2 - 3 || y + dy < 14 || placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - (y + dy)) < lh + 3) || behind(cols, s.id, s.pz, [x - w / 2, y + dy - 10, x + w / 2, y + dy + 3])) continue;
            at = [dx, dy];
            break out;
          }
          placed.push({ x: fx + at[0], w, y: y + at[1] });
          level.set(s.id, at);
        }
      }
      for (const s of SC.tiles) {
        const front = cam(s.x, 0, s.z - PED / 2 - 0.06);
        const hot = hotOf(s);
        lab.add(s.label, front.x + level.get(s.id)[0], front.y + (phone ? 10 : 14) + level.get(s.id)[1], "center", hot ? 30 : 25, s.v === null ? TOK.faint : TOK.body, tf, { id: s.id, z: s.pz });
        if (s.v !== null && (topSet.has(s.id) || hot)) {
          const t = tileOf(s.id), val = measure === "volume" ? F.num(s.v) : measure === "lean" ? moneyS(s.v) : money(s.v);
          lab.add(val, s.px, s.py - 6, "center", hot ? 29 : 8 + s.h / (SC.hmax || 1), TOK.strong, vf, { id: s.id, z: s.pz });
          void t;
        }
      }
      const hf = "600 " + (phone ? 9.5 : 12) + "px " + FONT, hs = (phone ? 9.5 : 11) + "px " + FONT;
      SC.heads.forEach((hd) => {
        const g = M.groups.find((x) => x.id === hd.id);
        const head = phone ? g.label + MID + (g.n ? money(g.prem) + MID + F.pct(g.share, 0) : "none flagged") : g.label;
        if (phone) lab.add(head, 8, hd.p.y, "left", 20, TOK.strong, hf);
        else {
          lab.add(head, 14, hd.p.y - 2, "left", 20, TOK.strong, hf);
          lab.add(g.n ? money(g.prem) + MID + F.pct(g.share, 0) : DASH + " none flagged", 14, hd.p.y + 13, "left", 19, TOK.body, hs);
        }
      });
      lab.flush(TOK.halo);
    }

    function placeHits() {
      hits.replaceChildren();
      if (!SC) return;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const lead = leader();
      const focusId = sel ? sel.id : lead ? lead.id : SC.tiles[0].id;
      SC.tiles.slice().sort((a, b) => b.pz - a.pz).forEach((s, k) => {
        const t = tileOf(s.id), minD = coarse ? 44 : 24;
        const w = Math.max(minD, s.box[2] - s.box[0]), hh = Math.max(minD, s.box[3] - s.box[1]);
        const cx = (s.box[0] + s.box[2]) / 2, cy = (s.box[1] + s.box[3]) / 2;
        const b = h("button", { type: "button", class: "mk-fl-hit", "data-id": s.id, "data-label": s.label, "aria-label": tileSentence(t), "aria-pressed": String(Boolean(sel && sel.id === s.id)), tabindex: s.id === focusId ? "0" : "-1",
          style: { left: (cx - w / 2).toFixed(1) + "px", top: (cy - hh / 2).toFixed(1) + "px", width: w.toFixed(1) + "px", height: hh.toFixed(1) + "px", zIndex: String(k + 1) } });
        b.__t = t;
        hits.append(b);
      });
    }

    function relayout() {
      if (!M) return;
      size();
      wide = wrap.clientWidth >= 860;
      SC = layout(M, measure, W, H, { phone: W < 640, yaw, pitch });
      canvas.setAttribute("aria-label", describe());
      legend.querySelector(".mk-fl-heights").textContent = "Height: " + meas().noun + ", one scale" + (SC && SC.vMax ? ", the tallest " + (measure === "volume" ? F.num(SC.vMax) + " contracts" : money(SC.vMax)) : "") + ". White base stripe: share of all flagged premium.";
      paint();
      placeHits();
      paintRead();
      paintSide(Math.floor((stage.clientHeight - 74) / 31));
    }

    function render() {
      if (!M) return;
      wrap.dataset.state = !S.st || S.st.state !== "ok" ? S.st.state : M.count ? "ok" : "quiet";
      const live = wrap.dataset.state === "ok";
      empty.hidden = live;
      main.hidden = !live;
      details.hidden = !live;
      legend.hidden = !live;
      seg.hidden = !live;
      if (!live) {
        empty.textContent = S.st.state === "pending" ? "Pending: flagged windows not published." : S.st.state === "unavailable" ? "Unavailable: " + (S.st.reason || "the flagged windows could not be read.") : "No flagged window this session. A quiet reading, not a forecast.";
        read.textContent = "";
        note.textContent = "";
        canvas.setAttribute("aria-label", empty.textContent);
        SC = null;
        return;
      }
      note.textContent = M.uniOk ? "" : "The universe has not published, so stocks are not split by sector.";
      fullNote.textContent = "One pillar for each class: the four index funds, the eleven sector ETFs, any other fund class that was flagged, and single stocks grouped by sector. Height is the measure chosen above on one scale across every class. Colour is lean by convention: calls on the ask side and puts on the bid side read bullish, the reverse bearish, slate when the two are within " + Math.round(LEAN_EDGE * 100) + "% of premium. The white stripe at each base is the class's share of all flagged premium, the longest being the largest. A dashed tile had no flagged window." + (M.dropped ? " " + M.dropped + " rows without a premium are not drawn." : "");
      relayout();
      paintTables();
    }

    function select(t) {
      sel = t;
      hover = null;
      paint();
      placeHits();
      paintRead();
      paintSide(Math.floor((stage.clientHeight - 74) / 31));
      if (t) { const b = hits.querySelector('.mk-fl-hit[data-id="' + CSS.escape(t.id) + '"]'); if (b && document.activeElement && hits.contains(document.activeElement)) b.focus(); }
    }

    let drag = null, moved = false;
    stage.addEventListener("pointerdown", (ev) => {
      if (ev.button > 0 || !SC) return;
      drag = { x: ev.clientX, y: ev.clientY, yaw: SC.view.yaw, pitch: SC.view.pitch, id: ev.pointerId };
      moved = false;
    });
    stage.addEventListener("pointermove", (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved) { moved = true; try { stage.setPointerCapture(ev.pointerId); } catch (error) { void error; } }
      yaw = clamp(drag.yaw + dx * 0.25 * DEG, -40 * DEG, 40 * DEG);
      pitch = clamp(drag.pitch + dy * 0.2 * DEG, 18 * DEG, 62 * DEG);
      relayoutLight();
    });
    const endDrag = (ev) => { if (drag && ev.pointerId === drag.id) { drag = null; setTimeout(() => { moved = false; }, 0); } };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    function relayoutLight() {
      SC = layout(M, measure, W, H, { phone: W < 640, yaw, pitch });
      paint();
      placeHits();
    }
    const orbit = (dy, dp) => {
      if (!SC) return;
      yaw = clamp((yaw === null ? SC.view.yaw : yaw) + dy * DEG, -40 * DEG, 40 * DEG);
      pitch = clamp((pitch === null ? SC.view.pitch : pitch) + dp * DEG, 18 * DEG, 62 * DEG);
      relayoutLight();
    };
    const reset = () => { yaw = null; pitch = null; if (M && SC) { relayoutLight(); } };
    recentre.addEventListener("click", reset);

    hits.addEventListener("pointerover", (ev) => { const b = ev.target.closest && ev.target.closest(".mk-fl-hit"); if (!b || drag) return; if (hover && hover.id === b.__t.id) return; hover = b.__t; paint(); paintRead(); });
    hits.addEventListener("pointerout", (ev) => { if (ev.relatedTarget && hits.contains(ev.relatedTarget)) return; if (!hover) return; hover = null; paint(); paintRead(); });
    hits.addEventListener("click", (ev) => { if (moved) return; const b = ev.target.closest && ev.target.closest(".mk-fl-hit"); if (!b) return; select(sel && sel.id === b.__t.id ? null : b.__t); const again = hits.querySelector('.mk-fl-hit[data-id="' + CSS.escape(b.__t.id) + '"]'); if (again) again.focus(); });
    let quiet = false;
    hits.addEventListener("focusin", (ev) => { if (quiet) return; const b = ev.target.closest && ev.target.closest(".mk-fl-hit"); if (!b || sel === b.__t) return; hover = b.__t; paint(); paintRead(); });
    hits.addEventListener("focusout", (ev) => { if (ev.relatedTarget && hits.contains(ev.relatedTarget)) return; if (hover) { hover = null; paint(); paintRead(); } });
    hits.addEventListener("keydown", (ev) => {
      const el = ev.target.closest && ev.target.closest(".mk-fl-hit");
      if (!el || !SC) return;
      if (ev.shiftKey && /^Arrow/.test(ev.key)) { ev.preventDefault(); orbit(ev.key === "ArrowLeft" ? -4 : ev.key === "ArrowRight" ? 4 : 0, ev.key === "ArrowUp" ? -3 : ev.key === "ArrowDown" ? 3 : 0); return; }
      if (ev.key === "r" || ev.key === "R" || ev.key === "0") { ev.preventDefault(); reset(); return; }
      const list = M.tiles.map((t) => hits.querySelector('.mk-fl-hit[data-id="' + CSS.escape(t.id) + '"]'));
      const i = list.indexOf(el);
      let to = null;
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") to = list[i + 1];
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") to = list[i - 1];
      else if (ev.key === "Home") to = list[0];
      else if (ev.key === "End") to = list[list.length - 1];
      else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(sel && sel.id === el.__t.id ? null : el.__t); const again = hits.querySelector('.mk-fl-hit[data-id="' + CSS.escape(el.__t.id) + '"]'); if (again) again.focus(); return; }
      else if (ev.key === "Escape") { select(null); const f = hits.querySelector(".mk-fl-hit"); void f; ev.preventDefault(); return; }
      else return;
      if (!to) return;
      ev.preventDefault();
      hits.querySelectorAll(".mk-fl-hit").forEach((b) => { b.tabIndex = -1; });
      to.tabIndex = 0;
      quiet = false;
      to.focus();
    });

    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (M && !dead && SC && stage.clientWidth && (stage.clientWidth !== W || stage.clientHeight !== H)) relayout(); }) : null;
    if (ro) ro.observe(stage);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (M && !dead && SC) paint(); });
    const onTheme = () => { TOK = null; if (M && !dead && SC) paint(); };
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", onTheme);

    const rebuild = () => { M = model(S.alerts, { universe: S.universe }); sel = null; hover = null; render(); };
    const api = {
      take(alerts, st) {
        S.alerts = alerts && Array.isArray(alerts.rows) ? alerts : null;
        S.st = st || (S.alerts ? { state: "ok" } : { state: "pending", reason: "Reading the flagged windows." });
        rebuild();
      },
      update(o) { if (o.universe !== undefined) S.universe = o.universe; if (S.alerts || S.st.state !== "pending") rebuild(); },
      model: () => M,
      scene: () => SC,
      labels: () => LAB,
      paints: () => paints,
      measure_: () => measure,
      reduced: () => RM.matches,
      orbit,
      measure(n) { const t0 = performance.now(); for (let i = 0; i < n; i++) paint(); return (performance.now() - t0) / n; },
      destroy() { dead = true; if (ro) ro.disconnect(); if (mq.removeEventListener) mq.removeEventListener("change", onTheme); FLOORS.delete(host); },
    };
    FLOORS.set(host, api);
    if (opts.alerts) api.take(opts.alerts, opts.st);
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { floor: Object.freeze({ model, layout, mount, of: (host) => FLOORS.get(host) || null, sideOf, valueOf, classify: (t) => (FUND_OF.has(t) ? "funds" : ETF_OF.has(t) ? "etf" : OTHER_OF.has(t) ? "other" : "stocks") }) }));
})();
