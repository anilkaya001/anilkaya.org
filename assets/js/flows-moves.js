(() => {
  "use strict";

  const UI = window.FlowsUI;
  const statusEl = document.getElementById("mvStatus");
  if (!UI || !statusEl) return;
  const { h, F } = UI;
  const UNIT = "IV-days";
  const LINE = "A ranking, not a test: no error rate measured.";
  const CAPTION = "IV as of the previous close.";
  const APART = "Earnings within 30 days: event not separated.";
  const GRADE = "From 30-day IV; no surface.";
  const MAP_CAP = "Tile area is market cap; colour is the move in IV-days.";
  const MAP_EQUAL = "Every tile has the same area; colour is the move in IV-days.";
  const SECTORS_LINE = "Each sector's median move, and its names beyond 2 IV-days.";
  const KEY_EVENT = "Dashed outline: earnings within 30 days, event not separated.";
  const NOTES = ["Median is signed, in IV-days.", "Beyond 2 counts names more than 2 IV-days from flat, up or down.", "Share is that count over the sector's names.", "Names reporting within 30 days are left out of every row."];
  const EVENT_SESSIONS = 21;
  const BEYOND = 3;
  const SECTOR_BEYOND = 2;
  const TOP = 15;
  const NARROW = 640;
  const EDGES = [0.5, 1, 2, 3];
  const NO_SECTOR = "No sector";
  const VIEWS = [["field", "Field"], ["map", "Map"], ["sectors", "Sectors"]];
  const SHAPE = { up: "▲", down: "▼", flat: "◆" };
  const SQRT_YEAR = Math.sqrt(252);
  const $ = (id) => document.getElementById(id);
  const host = { up: $("mvUp"), down: $("mvDown"), apart: $("mvApart"), line: $("mvLine"), ctx: $("mvCtx") };
  const els = { tabs: $("mvTabs"), map: $("mvPaneMap"), sectors: $("mvPaneSectors"), mapBody: $("mvMap"), secBody: $("mvSectors") };
  const panes = { field: $("mvPaneField"), map: els.map, sectors: els.sectors };

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ivDays = (chg, iv) => (num(chg) === null || num(iv) === null || !(iv > 0) ? null : chg / (iv / SQRT_YEAR));
  const signed = (m) => { const s = Math.abs(m).toFixed(1); return (m < 0 ? "−" : m > 0 ? "+" : "") + s; };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const byT = (a, b) => cmp(a.t, b.t);
  const tickerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(String(t).toUpperCase().replace(/[^A-Z0-9.\-]/g, ""));
  const dirOf = (m) => (m > 0 ? "up" : m < 0 ? "down" : "flat");
  const stepOf = (m) => { const a = Math.abs(m); let n = 0; while (n < EDGES.length && a >= EDGES[n]) n++; return n; };
  const state = (body, kind, text) => body.replaceChildren(h("p", { class: "ui-silent", "data-empty": kind, text }));
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const sayNames = (n, one, many) => (n === 1 ? "1 name " + one : n + " names " + many);

  const SESSIONS = 252;
  const FLOOR_N = 250;
  const oneIn = (p) => Math.max(1, Math.round(1 / p));
  const pctText = (x) => (x * 100).toFixed(x * 100 >= 10 ? 0 : 1) + "%";
  function wilson(hits, n) {
    const z = 1.96, p = hits / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
    const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return { lo: Math.max(0, (c - w) / d), hi: Math.min(1, (c + w) / d) };
  }
  function rarity(x) {
    if (x.sig === null || !(x.sig > 0)) return null;
    const k = Math.abs(x.chg) / x.sig;
    const level = k >= 3 ? 3 : k >= 2 ? 2 : 0;
    const hits = level === 3 ? x.f3 : level === 2 ? x.f2 : null;
    if (!level || hits === null || !Number.isInteger(hits) || hits < 0 || hits > SESSIONS) return null;
    let how;
    if (hits === 0 || SESSIONS / hits > FLOOR_N) {
      how = "rarer than 1 in " + FLOOR_N + " sessions for this name over the last year";
      if (hits === 0) how += ", and fewer than 1 in " + Math.floor(1 / (1 - Math.pow(0.05, 1 / SESSIONS)) / 10) * 10 + " at 95%";
    } else {
      how = "about 1 in " + oneIn(hits / SESSIONS) + " sessions for this name over the last year";
      if (hits >= 5) { const w = wilson(hits, SESSIONS); how += " (95% interval 1 in " + oneIn(w.hi) + " to 1 in " + oneIn(w.lo) + ")"; }
    }
    return "a " + level + "x typical-day move: typical day " + pctText(x.sig) + "; " + how;
  }

  const S = { rows: null, known: new Map(), hasCap: false, day: null, live: null, hold: false, dirty: false, waiting: 0, view: "field", model: null, fresh: new Set(), mapState: null, sort: { key: "median", dir: -1 }, secRows: null, phase: "loading" };

  function uniRows(u) {
    if (!u || u.status !== "ok" || !Array.isArray(u.t) || !u.cols || !u.units) return null;
    const col = (k) => {
      const c = u.cols[k], sc = u.units[k] && num(u.units[k][1]);
      return Array.isArray(c) && sc ? c.map((x) => (num(x) === null ? null : x / sc)) : null;
    };
    const chg = col("chg"), iv = col("iv30p"), ed = col("ed"), cap = col("mcap"), sig = col("sig"), f2 = col("f2"), f3 = col("f3");
    if (!chg) return null;
    const names = Array.isArray(u.sectors) ? u.sectors : [];
    const sec = Array.isArray(u.sec) ? u.sec : [];
    const sector = (i) => (typeof names[sec[i]] === "string" && names[sec[i]] ? names[sec[i]] : null);
    return { cap: Boolean(cap), rows: u.t.map((t, i) => ({ t, chg: chg[i], iv: iv ? iv[i] : null, ed: ed ? ed[i] : null, sector: sector(i), cap: cap && cap[i] > 0 ? cap[i] : null, sig: sig ? sig[i] : null, f2: f2 ? f2[i] : null, f3: f3 ? f3[i] : null })) };
  }

  function liveRows() {
    const s = UI.rt && UI.rt.feeds && UI.rt.feeds("px") && UI.rt.strips ? UI.rt.strips() : null;
    if (!s || s.status !== "ok" || !Array.isArray(s.fields) || !s.rows || !S.day || !(s.session > S.day)) return null;
    const ci = s.fields.indexOf("chg"), ii = s.fields.indexOf("iv30p");
    if (ci < 0 || ii < 0) return null;
    const pick = (t, k) => (S.known.has(t) ? S.known.get(t)[k] : null);
    return { session: s.session, rows: Object.keys(s.rows).map((t) => ({ t, chg: num(s.rows[t][ci]), iv: num(s.rows[t][ii]), ed: pick(t, "ed"), sector: pick(t, "sector"), cap: pick(t, "cap"), sig: pick(t, "sig"), f2: pick(t, "f2"), f3: pick(t, "f3") })) };
  }

  function moves(rows) {
    const out = [];
    for (const r of rows) {
      const m = ivDays(r.chg, r.iv);
      if (m !== null) out.push({ t: r.t, chg: r.chg, m, sector: r.sector || null, cap: r.cap || null, sig: num(r.sig), f2: num(r.f2), f3: num(r.f3), event: num(r.ed) !== null && r.ed <= EVENT_SESSIONS });
    }
    return out;
  }

  function atLeast(abs, x) {
    let lo = 0, hi = abs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (abs[mid] >= x) hi = mid; else lo = mid + 1; }
    return abs.length - lo;
  }

  function median(sorted) {
    if (!sorted.length) return null;
    const k = sorted.length >> 1;
    return sorted.length % 2 ? sorted[k] : (sorted[k - 1] + sorted[k]) / 2;
  }

  function list(items, abs, total, empty) {
    if (!items.length) return h("p", { class: "ui-silent", text: empty });
    return h("ol", { class: "ui-list mv-list" }, items.map((x, i) => h("li", { class: "ui-row mv-row" },
      h("span", { class: "mv-rank", text: String(i + 1) }),
      h("a", { class: "mv-t", href: tickerHref(x.t), text: x.t }),
      h("span", { class: "fu-v mv-m", text: signed(x.m) + " " + UNIT }),
      h("span", { class: "mv-c", text: F.pct(x.chg * 100, 1, true) + " on the day" }),
      x.event ? null : h("span", { class: "mv-n", text: atLeast(abs, Math.abs(x.m)) + " of " + total + " names this far out today" }),
      x.event || rarity(x) === null ? null : h("span", { class: "mv-r", text: rarity(x) }))));
  }

  function model() {
    const live = S.live;
    const rows = live ? live.rows : S.rows;
    const all = moves(rows || []);
    const clean = all.filter((x) => !x.event);
    const abs = clean.map((x) => Math.abs(x.m)).sort((a, b) => a - b);
    return { live, rows: rows || [], all, clean, apart: all.filter((x) => x.event), abs, total: clean.length };
  }

  function paintHead(M) {
    host.line.textContent = LINE + " " + CAPTION;
    const med = median(M.abs);
    const beyond = M.abs.filter((x) => x > BEYOND).length;
    const src = M.live ? "Live roster, session " + M.live.session : "Nightly, session " + S.day;
    host.ctx.textContent = med === null ? "" : src + ": " + M.total + " names ranked. Median |m| " + med.toFixed(1) + " " + UNIT + "; " + beyond + " of " + M.total + " beyond " + BEYOND + ". " + M.apart.length + " ranked apart.";
    statusEl.textContent = M.total ? "Ranked " + M.total + " names." : "No name could be measured.";
  }

  function paintField(M) {
    const up = M.clean.filter((x) => x.m > 0).sort((a, b) => b.m - a.m || byT(a, b)).slice(0, TOP);
    const down = M.clean.filter((x) => x.m < 0).sort((a, b) => a.m - b.m || byT(a, b)).slice(0, TOP);
    const ap = M.apart.slice().sort((a, b) => Math.abs(b.m) - Math.abs(a.m) || byT(a, b)).slice(0, TOP);
    host.up.replaceChildren(list(up, M.abs, M.total, "No riser has a prior-close implied volatility to measure against."));
    host.down.replaceChildren(list(down, M.abs, M.total, "No faller has a prior-close implied volatility to measure against."));
    host.apart.replaceChildren(
      h("p", { class: "fd-meta", text: APART + " " + GRADE }),
      list(ap, M.abs, M.total, "No name with a move reports within 30 days."));
  }

  function squarify(items, X, Y, W, H) {
    const out = [];
    const total = items.reduce((s, i) => s + i.w, 0);
    if (!(total > 0) || !(W > 0) || !(H > 0)) return out;
    const k = (W * H) / total;
    const worst = (sum, mx, mn, side) => Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
    let x = X, y = Y, w = W, hh = H, i = 0;
    while (i < items.length) {
      const side = Math.min(w, hh);
      let sum = 0, mx = 0, mn = Infinity, j = i, best = Infinity;
      while (j < items.length) {
        const a = items[j].w * k;
        const r = worst(sum + a, Math.max(mx, a), Math.min(mn, a), side);
        if (j > i && r > best) break;
        sum += a; mx = Math.max(mx, a); mn = Math.min(mn, a); best = r; j++;
      }
      const thick = sum / side;
      let o = 0;
      for (let n = i; n < j; n++) {
        const len = (items[n].w * k) / thick;
        out.push(w >= hh ? { item: items[n], x, y: y + o, w: thick, h: len } : { item: items[n], x: x + o, y, w: len, h: thick });
        o += len;
      }
      if (w >= hh) { x += thick; w -= thick; } else { y += thick; hh -= thick; }
      i = j;
    }
    return out;
  }

  function mapModel(M) {
    const capMode = S.hasCap;
    const groups = new Map();
    const off = [];
    let total = 0, n = 0;
    for (const x of M.all) {
      const w = capMode ? x.cap : 1;
      if (!(w > 0)) { off.push(x); continue; }
      const key = x.sector || NO_SECTOR;
      if (!groups.has(key)) groups.set(key, { name: key, total: 0, items: [] });
      const g = groups.get(key);
      g.items.push({ ...x, w });
      g.total += w;
      total += w;
      n++;
    }
    const list = [...groups.values()];
    for (const g of list) g.items.sort((a, b) => b.w - a.w || byT(a, b));
    list.sort((a, b) => (a.name === NO_SECTOR) - (b.name === NO_SECTOR) || b.total - a.total || cmp(a.name, b.name));
    off.sort(byT);
    return { cap: capMode, groups: list, total, n, off, measured: M.all.length, unmeasured: M.rows.length - M.all.length };
  }

  const legendItems = () => {
    const out = [];
    for (const [dir, step, label] of [["down", 4, "−3 or more"], ["down", 3, "−2 to −3"], ["down", 2, "−1 to −2"], ["down", 1, "−0.5 to −1"], ["up", 0, "within 0.5"], ["up", 1, "+0.5 to +1"], ["up", 2, "+1 to +2"], ["up", 3, "+2 to +3"], ["up", 4, "+3 or more"]]) {
      out.push(h("li", { class: "mv-leg-i" },
        h("span", { class: "mv-sw", "data-dir": dir, "data-step": String(step), "aria-hidden": "true", text: step === 0 ? "±" : SHAPE[dir] }),
        h("span", { text: label })));
    }
    out.push(h("li", { class: "mv-leg-i" }, h("span", { class: "mv-sw", "data-event": "", "aria-hidden": "true" }), h("span", { text: KEY_EVENT })));
    return h("ul", { class: "mv-leg", "aria-label": "Colour key, in " + UNIT }, out);
  };

  const share = (w, total) => { const p = (100 * w) / total; return p < 0.1 ? "<0.1%" : p.toFixed(1) + "%"; };

  function tableRows(mm) {
    const rows = [];
    for (const g of mm.groups) for (const x of g.items) rows.push({ x, area: share(x.w, mm.total) });
    for (const x of mm.off) rows.push({ x, area: "—" });
    return rows;
  }

  function fillTable() {
    const m = S.mapState;
    if (!m || !m.details.open || m.tableStamp === m.stamp) return;
    m.tableStamp = m.stamp;
    const body = tableRows(m.mm).map(({ x, area }) => h("tr", { "data-t": x.t, "data-dir": dirOf(x.m) },
      h("th", { scope: "row" }, h("a", { class: "mv-t", href: tickerHref(x.t), text: x.t }), x.event ? h("span", { class: "mv-ev", text: "earnings" }) : null),
      h("td", { class: "mv-c-sec", text: x.sector || NO_SECTOR }),
      h("td", { class: "mv-c-m" }, h("i", { class: "mv-g", "aria-hidden": "true", text: SHAPE[dirOf(x.m)] }), " " + signed(x.m)),
      h("td", { class: "mv-c-a", text: area })));
    m.tableWrap.replaceChildren(h("table", { class: "mv-tbl mv-map-t" },
      h("caption", { class: "visually-hidden", text: "Names on the map, by sector, in " + UNIT }),
      h("thead", null, h("tr", null, h("th", { scope: "col", text: "Name" }), h("th", { scope: "col", text: "Sector" }), h("th", { scope: "col", text: UNIT }), h("th", { scope: "col", text: "Area share" }))),
      h("tbody", null, body)));
  }

  function tileEl(r, low) {
    const x = r.item.x;
    const dir = dirOf(x.m), step = stepOf(x.m);
    const labelled = r.w >= 56 && r.h >= 34;
    const title = x.t + " " + SHAPE[dir] + " " + signed(x.m) + " " + UNIT + " · " + (x.sector || NO_SECTOR) + (x.event ? " · earnings within 30 days" : "");
    const a = h("a", {
      class: "mv-tile", href: tickerHref(x.t), title, "data-t": x.t, "data-dir": dir, "data-step": String(step), "data-l": labelled ? "2" : "0",
      "data-event": x.event ? "" : null, "data-low": labelled && low ? "" : null,
      "aria-label": labelled ? x.t + ", " + (x.sector || NO_SECTOR) + ", " + (dir === "flat" ? "flat" : dir) + " " + Math.abs(x.m).toFixed(1) + " " + UNIT + (x.event ? ", earnings within 30 days" : "") : null,
      "aria-hidden": labelled ? null : "true", tabindex: labelled ? null : "-1",
      style: { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" },
    });
    if (labelled) a.append(h("span", { class: "mv-tl-t", text: x.t }), h("span", { class: "mv-tl-v" }, h("i", { "aria-hidden": "true", text: SHAPE[dir] }), " " + signed(x.m)));
    return a;
  }

  function placeMap() {
    const m = S.mapState;
    if (!m) return;
    const W = els.mapBody.offsetWidth;
    if (!(W > 0)) return;
    const narrow = W < NARROW;
    if (narrow !== m.narrow) { m.narrow = narrow; m.details.open = narrow; }
    if (narrow) { m.canvas.replaceChildren(); m.canvas.style.height = ""; m.canvas.style.width = ""; m.w = 0; fillTable(); return; }
    if (m.w === W) return;
    m.w = W;
    const H = Math.round(Math.min(640, Math.max(360, W * 0.56)));
    m.canvas.style.height = H + "px";
    m.canvas.style.width = W + "px";
    const frag = document.createDocumentFragment();
    const outlines = [];
    const groupRects = squarify(m.mm.groups.map((g) => ({ g, w: g.total })), 0, 0, W, H);
    for (const gr of groupRects) {
      const g = gr.item.g;
      const tiles = squarify(g.items.map((x) => ({ x, w: x.w })), gr.x, gr.y, gr.w, gr.h);
      const first = tiles[0];
      const pill = Boolean(first) && first.w >= 64 && first.h >= 60;
      tiles.forEach((r, i) => frag.append(tileEl(r, pill && i === 0)));
      outlines.push(h("div", { class: "mv-grp", "data-sector": g.name, style: { left: gr.x + "px", top: gr.y + "px", width: gr.w + "px", height: gr.h + "px" } },
        pill ? h("span", { class: "mv-grp-l", style: { "max-width": first.w - 8 + "px" }, text: g.name }) : null));
    }
    frag.append(...outlines);
    m.canvas.replaceChildren(frag);
  }

  function paintMap(M) {
    const body = els.mapBody;
    if (!M.all.length) { S.mapState = null; return state(body, "quiet", "No name could be measured, so there is nothing to draw."); }
    const mm = mapModel(M);
    const notes = [];
    if (mm.off.length) notes.push(sayNames(mm.off.length, "has no market cap and appears in the table only.", "have no market cap and appear in the table only."));
    if (mm.unmeasured > 0) notes.push(sayNames(mm.unmeasured, "has no usable prior-close IV and is not drawn.", "have no usable prior-close IV and are not drawn."));
    const canvas = h("div", { class: "mv-map", role: "group", "aria-label": "Map of " + mm.n + " names grouped by sector. Each tile links to the name; the table below lists them all." });
    const tableWrap = h("div", { class: "mv-tw" });
    const details = h("details", { class: "mv-alt" }, h("summary", { text: "Table of the " + (mm.n + mm.off.length) + " names" }), tableWrap);
    const prev = S.mapState;
    details.open = prev ? prev.details.open : false;
    S.mapState = { mm, canvas, tableWrap, details, narrow: prev ? prev.narrow : undefined, w: 0, stamp: (prev ? prev.stamp : 0) + 1, tableStamp: 0 };
    details.addEventListener("toggle", fillTable);
    body.replaceChildren(
      h("p", { class: "mv-sentence", text: mm.cap ? MAP_CAP : MAP_EQUAL }),
      legendItems(), canvas,
      ...notes.map((t) => h("p", { class: "mv-note", text: t })),
      details);
    placeMap();
    fillTable();
  }

  function sectorStats(clean) {
    const by = new Map();
    for (const x of clean) {
      const key = x.sector || NO_SECTOR;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(x.m);
    }
    return [...by].map(([name, ms]) => {
      const beyond = ms.filter((m) => Math.abs(m) > SECTOR_BEYOND).length;
      return { name, n: ms.length, median: median(ms.slice().sort((a, b) => a - b)), beyond, share: beyond / ms.length };
    });
  }

  const COLS = [
    { k: "name", label: "Sector" },
    { k: "n", label: "Names", cls: "mv-c-names" },
    { k: "median", label: "Median" },
    { k: "beyond", label: "Beyond 2" },
    { k: "share", label: "Share" },
  ];

  function renderSectorRows() {
    const m = S.secRows;
    if (!m) return;
    const { key, dir } = S.sort;
    const rows = m.rows.slice().sort((a, b) => (key === "name" ? cmp(a.name, b.name) : cmp(a[key], b[key])) * dir || cmp(a.name, b.name));
    m.tbody.replaceChildren(...rows.map((r) => h("tr", { "data-sector": r.name },
      h("th", { scope: "row", class: "mv-c-name" }, h("span", { class: "mv-sn", text: r.name }), h("span", { class: "mv-sub", text: plural(r.n, "name", "names") })),
      h("td", { class: "mv-c-names", "data-k": "n", text: String(r.n) }),
      h("td", { class: "mv-c-med", "data-k": "median" },
        h("span", { class: "mv-mv" }, h("i", { class: "mv-g", "aria-hidden": "true", text: SHAPE[dirOf(r.median)] }), " " + signed(r.median)),
        h("span", { class: "mv-track", "aria-hidden": "true" }, h("i", { class: "mv-bar", "data-dir": dirOf(r.median), style: { "--w": (Math.abs(r.median) / m.scale) * 50 + "%" } }))),
      h("td", { "data-k": "beyond", text: String(r.beyond) }),
      h("td", { "data-k": "share", text: Math.round(100 * r.share) + "%" }))));
    m.heads.forEach(([c, th]) => th.setAttribute("aria-sort", c.k === key ? (dir > 0 ? "ascending" : "descending") : "none"));
  }

  function sortBy(c) {
    S.sort = S.sort.key === c.k ? { key: c.k, dir: -S.sort.dir } : { key: c.k, dir: c.k === "name" ? 1 : -1 };
    renderSectorRows();
    statusEl.textContent = "Sectors sorted by " + c.label.toLowerCase() + ", " + (S.sort.dir > 0 ? "ascending" : "descending") + ".";
  }

  function paintSectors(M) {
    const body = els.secBody;
    const rows = sectorStats(M.clean);
    if (!rows.length) { S.secRows = null; return state(body, "quiet", "No name could be measured, so there is nothing to compare."); }
    const top = Math.max(...rows.map((r) => Math.abs(r.median)));
    const scale = Math.max(0.5, Math.ceil(top * 2) / 2);
    const heads = COLS.map((c) => [c, h("th", { scope: "col", class: c.cls || null, "aria-sort": "none" },
      h("button", { type: "button", class: "mv-sort", text: c.label, onclick: () => sortBy(c) }))]);
    const tbody = h("tbody");
    S.secRows = { rows, scale, tbody, heads };
    body.replaceChildren(
      h("p", { class: "mv-sentence", text: SECTORS_LINE }),
      h("div", { class: "mv-tw" }, h("table", { class: "mv-tbl mv-st" },
        h("caption", { class: "visually-hidden", text: "Sectors by median move in " + UNIT }),
        h("thead", null, h("tr", null, heads.map(([, th]) => th))), tbody)),
      h("p", { class: "mv-note mv-scale", text: "Bars share one scale: " + signed(-scale) + " to " + signed(scale) + " " + UNIT + "." }),
      ...NOTES.map((t) => h("p", { class: "mv-note", text: t })),
      M.apart.length ? h("p", { class: "mv-note", text: "Left out: " + plural(M.apart.length, "name", "names") + "." }) : null);
    renderSectorRows();
  }

  const PAINT = { field: paintField, map: paintMap, sectors: paintSectors };

  function fit() {
    for (const [body, pane] of [[els.mapBody, els.map], [els.secBody, els.sectors]]) {
      const W = body.offsetWidth;
      if (W > 0) pane.dataset.narrow = W < NARROW ? "1" : "0";
    }
    if (S.view === "map") placeMap();
  }

  function paintView(v) {
    PAINT[v](S.model);
    S.fresh.add(v);
    if (v !== "field") fit();
  }

  function paint() {
    S.model = model();
    S.fresh = new Set();
    paintHead(S.model);
    paintView(S.view);
    S.dirty = false;
    document.querySelectorAll(".mv-held").forEach((n) => n.remove());
  }

  function request() {
    if (S.hold) {
      S.dirty = true;
      S.waiting++;
      if (!host.ctx.querySelector(".mv-held")) host.ctx.append(h("span", { class: "mv-held", text: " Order held while you read." }));
      return;
    }
    paint();
  }

  const readHash = () => { const m = /(?:^#|[&;])view=(field|map|sectors)(?=$|[&;])/.exec(location.hash); return m ? m[1] : "field"; };
  const writeHash = (v) => { try { history.replaceState(null, "", location.pathname + location.search + "#view=" + v); } catch (e) { return; } };
  let tabs = null;

  function select(view, user) {
    const i = VIEWS.findIndex((x) => x[0] === view);
    if (i < 0) return select("field", user);
    S.view = view;
    if (tabs) tabs.pick(i);
    for (const [id] of VIEWS) panes[id].hidden = id !== view;
    if (user) writeHash(view);
    if (S.model && !S.fresh.has(view)) paintView(view);
    else if (view !== "field") fit();
  }

  function buildTabs() {
    const start = Math.max(0, VIEWS.findIndex((x) => x[0] === readHash()));
    tabs = UI.segmented("View", VIEWS.map((x) => ({ label: x[1] })), (i) => select(VIEWS[i][0], true), start);
    els.tabs.append(tabs);
    els.tabs.hidden = false;
    const btns = Array.from(tabs.querySelectorAll('[role="tab"]'));
    btns.forEach((b, i) => { b.id = "mvTab" + VIEWS[i][1]; b.setAttribute("aria-controls", "mvPane" + VIEWS[i][1]); });
    tabs.addEventListener("keydown", (e) => {
      if (e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      const i = e.key === "Home" ? 0 : VIEWS.length - 1;
      btns[i].focus();
      select(VIEWS[i][0], true);
    });
    select(VIEWS[start][0], false);
    window.addEventListener("hashchange", () => select(readHash(), false));
  }

  const lists = [host.up, host.down, host.apart, els.mapBody, els.secBody];
  const setHold = (on) => { S.hold = on; if (!on && S.dirty) { S.waiting = 0; paint(); } };
  for (const el of lists) {
    el.addEventListener("pointerenter", () => setHold(true));
    el.addEventListener("pointerleave", () => setHold(lists.some((n) => n.matches(":focus-within"))));
    el.addEventListener("focusin", () => setHold(true));
    el.addEventListener("focusout", () => setTimeout(() => setHold(lists.some((n) => n.matches(":hover, :focus-within"))), 0));
  }

  buildTabs();
  if (window.ResizeObserver) {
    const watcher = new ResizeObserver(fit);
    watcher.observe(els.mapBody);
    watcher.observe(els.secBody);
  }

  fetch("/api/flows/universe?cols=t,sec,chg,iv30p,ed,mcap,sig,f2,f3", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((u) => {
      const got = uniRows(u);
      if (!got) {
        S.phase = "pending";
        statusEl.textContent = "The universe is not published yet, so there is nothing to rank.";
        statusEl.setAttribute("data-empty", "pending");
        host.line.textContent = LINE;
        for (const b of [els.mapBody, els.secBody]) state(b, "pending", "The universe is not published yet, so there is nothing to draw.");
        return;
      }
      S.rows = got.rows;
      S.hasCap = got.cap;
      S.known = new Map(got.rows.map((r) => [r.t, r]));
      S.day = u.sessionDate || null;
      S.phase = "ready";
      paint();
      const rt = UI.rt && UI.rt.connect({ topics: ["px"] });
      if (rt) {
        rt.on("px", () => {
          const l = liveRows();
          if (!l && !S.live) return;
          S.live = l;
          request();
        });
      }
    })
    .catch((error) => {
      S.phase = "unreadable";
      statusEl.textContent = "The universe could not be loaded. Refresh to try again. (" + error.message + ")";
      statusEl.setAttribute("data-empty", "unreadable");
      for (const b of [els.mapBody, els.secBody]) state(b, "unreadable", "The universe could not be loaded. Refresh to try again.");
    });
})();
