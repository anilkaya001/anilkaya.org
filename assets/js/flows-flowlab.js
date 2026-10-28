(() => {
  "use strict";
  const geo = (v) => Math.trunc(v * 10) / 10;

  const UI = window.FlowsUI;
  const root = document.getElementById("flMain");
  if (!UI || !root) return;
  const { h, s, DASH, F } = UI;
  const $ = (id) => document.getElementById(id);
  const copyNode = $("flCopy");
  let COPY = {};
  try { COPY = JSON.parse(copyNode ? copyNode.textContent : "{}"); } catch { COPY = {}; }
  const STATES = COPY.states || {};
  const CHIPS = COPY.chips || {};
  const MAP = COPY.stateMap || {};
  const WHY = COPY.why || {};
  const LAB = COPY.labels || {};
  const NOTES = COPY.notes || {};
  const CLASSES = COPY.classes || {};
  const WHYS = COPY.whys || {};
  const ERRS = COPY.errors || {};
  const NOT_SIDED = NOTES.groupSided || "";
  const DEF_TABS = ["screen", "strikes", "greeks", "ladders", "routing", "lit", "groups", "relations"];
  const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
  const OSI_RE = /^[A-Z][A-Z0-9]{0,5}\d{6}[CP]\d{8}$/;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const RANK_KEYS = ["premium", "voi", "nameShare", "askLo", "sweepShare"];
  const GROUP_NAMES = ["airline", "bank", "basic materials", "china", "communication services", "consumer cyclical", "consumer defensive", "crypto", "cyber", "energy",
    "financial services", "gas", "gold", "healthcare", "industrials", "mag7", "oil", "real estate", "refiners", "reit", "semi", "silver", "technology", "uranium", "utilities"];
  const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const money = (cents, signed) => (num(cents) === null ? DASH : F.money(cents / 100, signed === true));
  const pct0 = (v) => (num(v) === null ? DASH : F.pct(v, 0));
  const nowMs = () => Date.now();
  const titleCase = (g) => g.replace(/\b\w/g, (c) => c.toUpperCase());

  const S = { tab: "screen", t: "", c: "", preset: "premium", rank: "premium", expiry: null, group: null, basis: "dir", otm: false, mod: {}, loaded: {}, seq: 0, hashBlocked: false };
  const DATA = {};
  const ALL = {};

  function rankValue(row, key) {
    return key === "premium" ? row.premC : row.ratios[key];
  }

  function rank(rows, key) {
    const k = RANK_KEYS.indexOf(key) >= 0 ? key : "premium";
    const have = [];
    const lack = [];
    for (const r of rows) {
      const v = rankValue(r, k);
      (typeof v === "number" && Number.isFinite(v) ? have : lack).push(r);
    }
    const byPrem = (a, b) => (b.premC - a.premC) || (a.c < b.c ? -1 : a.c > b.c ? 1 : 0);
    have.sort((a, b) => (rankValue(b, k) - rankValue(a, k)) || byPrem(a, b));
    lack.sort(byPrem);
    return { rows: have.concat(lack), unranked: lack.length };
  }

  const chipEl = (code) => {
    const st = MAP[code] || "quiet";
    return h("span", { class: "ds-st", "data-s": st, "data-code": code }, h("i", { "aria-hidden": "true" }), CHIPS[code] || code);
  };
  const stateBlock = (code, vars) => h("div", { class: "fl-state", "data-code": code, role: "status" }, chipEl(code), h("span", { class: "fl-state-t" }, fill(STATES[code] || "", vars)));
  const emptyBlock = (text) => h("div", { class: "fl-state", "data-code": "ask", role: "status" }, h("span", { class: "fl-state-t" }, text));
  const stateOfPart = (p) => {
    if (!p) return null;
    if (p.read && CLASSES[p.read.class]) return CLASSES[p.read.class];
    if (!p.why) return null;
    return WHYS[p.why] || "unshaped";
  };
  const varsOf = (p) => ({ status: p && p.read && num(p.read.status) !== null ? p.read.status : DASH, date: p && typeof p.date === "string" ? p.date : DASH });
  const partBlock = (p) => stateBlock(stateOfPart(p) || "failed", varsOf(p));
  const stateText = (p) => fill(STATES[stateOfPart(p) || "failed"] || "", varsOf(p));
  const topBlock = (code, text) => h("div", { class: "fl-state fl-state-top", "data-code": code }, chipEl(code), h("span", { class: "fl-state-t" }, text));
  const sessionOf = (b) => (b && typeof b.sessionDate === "string" ? b.sessionDate : b && typeof b.session === "string" ? b.session : DASH);
  const reasonText = (code) => {
    const st = CLASSES[code] || ERRS[code] || WHYS[code];
    return st && STATES[st] ? " " + STATES[st] : "";
  };

  function banners(m, rec) {
    if (!m || !m.body || !rec || !rec.body) return;
    const at = rec.body.asOf ? F.time(rec.body.asOf) : rec.body.generatedAt ? F.time(rec.body.generatedAt) : DASH;
    const top = [];
    if (rec.throttled) top.push(topBlock("throttled", fill(STATES.throttled, { TRT: at })));
    else if (rec.stale) top.push(topBlock("kept", fill(STATES.kept, { TRT: at }) + reasonText(rec.stale)));
    if (rec.held) top.push(topBlock("earlier", fill(STATES.earlier, { date: sessionOf(rec.body) }) + reasonText(rec.held)));
    if (rec.body.closed && !rec.held) top.push(topBlock("closed", fill(STATES.closed, { date: sessionOf(rec.body) })));
    if (top.length) m.body.prepend(...top);
  }

  const modEl = (id) => ({ box: $(id), body: $(id + "B"), note: $(id + "N"), stamp: $(id + "S"), more: $(id + "M") });

  function put(id, node, note) {
    const m = modEl(id);
    if (!m.body) return m;
    m.body.replaceChildren(node);
    if (m.note && note !== undefined) m.note.replaceChildren(...(Array.isArray(note) ? note : [note]).filter((x) => x !== null && x !== ""));
    if (m.more) m.more.hidden = true;
    return m;
  }

  function stamp(id, body, extra) {
    const m = modEl(id);
    if (!m.stamp) return;
    const parts = [];
    if (body && body.asOf) parts.push((LAB.readAt || "Read") + " " + F.when(body.asOf, nowMs()));
    if (body && body.session) parts.push(body.session);
    if (extra) parts.push(extra);
    m.stamp.textContent = parts.join(" · ");
  }

  function why(res) {
    if (!res) return "failed";
    if (res.error) return res.error;
    const b = res.body;
    if (!b || !b.why) return null;
    return stateOfPart(b);
  }

  const blockOf = (rec) => stateBlock(why(rec) || "failed", varsOf(rec && (rec.error ? rec : rec.body)));

  async function get(path, refresh) {
    const url = path + (refresh ? (path.includes("?") ? "&" : "?") + "refresh=1" : "");
    let r;
    try {
      r = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    } catch {
      return { error: "network", body: null };
    }
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    if (r.ok && body) {
      const throttled = r.headers.get("X-Fresh-Throttled") === "1";
      const age = Number(r.headers.get("X-Chain-Age"));
      const stale = r.headers.get("X-Fresh-State") === "stale" ? r.headers.get("X-Fresh-Reason") : null;
      return { body, throttled, stale, held: r.headers.get("X-Flowlab-Held"), ageS: Number.isFinite(age) ? age : null };
    }
    const code = body && body.error && body.error.code;
    const read = body && body.read && typeof body.read === "object" ? body.read : null;
    if (read && CLASSES[read.class]) return { error: CLASSES[read.class], read, body: null };
    if (code && ERRS[code]) return { error: ERRS[code], read, body: null };
    if (r.status === 429) return { error: "rate_limited", body: null };
    if (r.status === 504) return { error: "timeout", body: null };
    return { error: "failed", read, body: null };
  }

  const dash = (reason) => h("span", { class: "fl-dash", title: reason || null }, DASH);

  function table(cols, rows, what) {
    const t = h("table", { class: "fl-t", "data-what": what || null });
    t.append(h("thead", null, h("tr", null, ...cols.map((c) => h("th", { scope: "col", class: c.cls || null }, c.label)))));
    const body = h("tbody");
    for (const r of rows) body.append(r);
    t.append(body);
    return t;
  }

  function fit(id) {
    const m = modEl(id);
    if (!m.body) return;
    const t = m.body.querySelector("table.fl-t[data-what]");
    const tiles = m.body.querySelector(".fl-tiles");
    if ((!t || !t.tBodies[0]) && !tiles) return;
    const rows = t ? [...t.tBodies[0].rows] : [...tiles.children];
    const what = t ? t.getAttribute("data-what") : "groups";
    let n = rows.length;
    let rest = m.body.querySelector(".fl-rest");
    if (!rest) { rest = h("p", { class: "fl-rest" }); m.body.append(rest); }
    const place = () => {
      rows.forEach((r, i) => { r.hidden = i >= n; });
      const hid = rows.length - n;
      rest.textContent = hid ? fill(LAB.moreIn || "+{n} more {what} in Details", { n: hid, what }) : "";
      rest.hidden = !hid;
      if (m.more) m.more.hidden = !hid;
    };
    place();
    let guard = rows.length;
    const over = () => m.body.scrollHeight > m.body.clientHeight + 1 || (!!tiles && tiles.scrollHeight > tiles.clientHeight + 1);
    while (over() && n > 1 && guard-- > 0) { n--; place(); }
  }

  function fitAll() {
    for (const id of Object.keys(ALL)) {
      const m = modEl(id);
      if (m.box && m.box.offsetParent !== null) fit(id);
    }
  }

  const labelOf = (r) => r.t + " " + F.day(r.e) + " " + F.strike(r.k) + " " + (r.cp === "c" ? "Call" : "Put");

  function openContract(c) {
    if (!OSI_RE.test(c)) return;
    S.c = c;
    writeHash();
    const D = window.FlowsUI && window.FlowsUI.drill;
    if (D && typeof D.open === "function") D.open({ c });
  }

  function askCell(r) {
    const x = r.ratios;
    if (x.askLo === null || x.askHi === null) {
      const text = WHY[x.askWhy] || STATES["no-oi"];
      return h("td", { class: "c-ask", "data-why": x.askWhy || null, title: text }, dash(text));
    }
    const lo = Math.floor(x.askLo * 100 + 1e-9);
    const hi = Math.ceil(x.askHi * 100 - 1e-9);
    const word = x.lean === 1 ? LAB.up : x.lean === -1 ? LAB.down : CHIPS["lean-undecided"];
    const dir = x.lean === 1 ? "up" : x.lean === -1 ? "down" : "und";
    const bar = h("span", { class: "fl-rng", "aria-hidden": "true" }, h("i"));
    bar.style.setProperty("--lo", lo + "%");
    bar.style.setProperty("--hi", hi + "%");
    const said = x.stated === null || x.stated === undefined ? "" : " " + fill(NOTES.sided || "", { pct: pct0(x.stated) });
    return h("td", { class: "c-ask", "data-lean": String(x.lean), title: (x.lean === 0 ? STATES["lean-undecided"] : word) + said }, bar, h("span", { class: "fl-rng-t" }, lo === hi ? lo + "%" : lo + "–" + hi + "%"),
      h("span", { class: "ds-sg", "data-dir": dir }, h("i", { "aria-hidden": "true" }), word));
  }

  function screenRow(r) {
    const x = r.ratios;
    const btn = h("button", { type: "button", class: "fl-link", "data-c": r.c, onclick: () => openContract(r.c) }, labelOf(r));
    const fl = r.flags || {};
    const flags = h("td", { class: "c-flags" }, ...[["sweep", "S", "Sweep"], ["floor", "F", "Floor"], ["multi", "M", "Multi-leg"], ["cross", "X", "Cross"]].filter((q) => fl[q[0]])
      .map((q) => h("abbr", { class: "fl-fl", title: q[2] }, q[1])));
    if (!flags.childNodes.length) flags.append(dash(null));
    return h("tr", { "data-c": r.c },
      h("th", { scope: "row", class: "c-contract" }, btn),
      h("td", { class: "c-fill" }, num(r.lastFill) === null ? DASH : F.time(r.lastFill)),
      h("td", { class: "c-premium" }, money(r.premC)),
      h("td", { class: "c-voi", title: x.voi === null ? STATES["no-oi"] : null }, x.voi === null ? DASH : F.px(x.voi, 2) + "x"),
      askCell(r),
      h("td", { class: "c-sweep" }, pct0(x.sweepShare)),
      h("td", { class: "c-name" }, pct0(x.nameShare)),
      flags);
  }

  const SCREEN_COLS = () => (COPY.columns || []).map((c) => ({ label: c.label, cls: "c-" + c.id }));

  function paintScreen() {
    const rec = DATA["screen:" + S.preset + ":" + (S.t || "*")];
    const id = "flScreen";
    if (!rec) return;
    stamp(id, rec.body);
    const st = why(rec);
    if (st) {
      put(id, blockOf(rec), "");
      paintPresetCounts();
      paintScatter();
      return;
    }
    const x = rec.body.x;
    const ranked = rank(x.rows, S.rank);
    const rows = ranked.rows.map(screenRow);
    const t = table(SCREEN_COLS(), rows, "contracts");
    ALL[id] = () => table(SCREEN_COLS(), ranked.rows.map(screenRow), "contracts");
    const notes = [h("span", null, fill(COPY.labels && LAB.unranked ? LAB.unranked : "{n} without this key sit last.", { n: ranked.unranked })), " "];
    const foot = [ranked.unranked ? notes[0] : null, ranked.unranked ? " " : null, h("span", null, STATES["min-volume"]), " ", h("span", null, COPY.convention || "")];
    const m = put(id, t, foot);
    banners(m, rec);
    fit(id);
    paintPresetCounts();
    paintScatter();
  }

  function paintPresetCounts() {
    for (const el of document.querySelectorAll("[data-n]")) {
      const key = "screen:" + el.getAttribute("data-n") + ":" + (S.t || "*");
      const rec = DATA[key];
      el.textContent = rec && rec.body && rec.body.x ? String(rec.body.x.n) : DASH;
    }
  }

  function paintScatter() {
    const id = "flScatter";
    const rec = DATA["screen:" + S.preset + ":" + (S.t || "*")];
    const m = modEl(id);
    if (!m.body) return;
    if (!rec || why(rec)) { put(id, rec ? blockOf(rec) : h("p", { class: "fl-wait" }, STATES.loading), ""); return; }
    const rows = rec.body.x.rows.filter((r) => r.ratios.voi !== null && r.ratios.voi > 0 && r.premC > 0);
    const left = rec.body.x.rows.length - rows.length;
    const host = h("div", { class: "fl-plot" });
    m.body.replaceChildren(host);
    const draw = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      host.replaceChildren();
      const svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "group", "aria-label": "Volume to open interest against premium, " + rows.length + " contracts" }, host);
      const L = 40, B = 22, T = 6, R = 8;
      const xs = rows.map((r) => Math.log10(r.ratios.voi));
      const x0 = Math.floor(Math.min(0, ...xs)), x1 = Math.max(x0 + 1, Math.ceil(Math.max(...xs, 0)));
      const maxP = Math.max(1, ...rows.map((r) => Math.sqrt(r.premC / 100)));
      const px = (v) => L + ((Math.log10(v) - x0) / (x1 - x0)) * (W - L - R);
      const py = (c) => H - B - (Math.sqrt(c / 100) / maxP) * (H - B - T);
      for (let e = x0; e <= x1; e++) {
        const x = L + ((e - x0) / (x1 - x0)) * (W - L - R);
        s("line", { x1: x, x2: x, y1: T, y2: H - B, class: "grid" }, svg);
        s("text", { x, y: H - 6, text: F.px(10 ** e, e < 0 ? 2 : 0) + "x", "text-anchor": "middle" }, svg);
      }
      s("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, class: "axis" }, svg);
      s("text", { x: 4, y: T + 10, text: money(maxP * maxP * 100) }, svg);
      s("text", { x: 4, y: H - B, text: "$0" }, svg);
      rows.slice(0, 60).forEach((r, i) => {
        const cx = px(r.ratios.voi), cy = py(r.premC);
        const g = s("g", { class: "fl-dot", role: "button", tabindex: i === 0 ? "0" : "-1", "aria-label": labelOf(r) + ", " + money(r.premC) + ", " + F.px(r.ratios.voi, 2) + "x", "data-c": r.c }, svg);
        const lean = r.ratios.lean;
        if (lean === 1) s("path", { d: "M" + cx + " " + (cy - 5) + "L" + (cx + 4.5) + " " + (cy + 3.5) + "L" + (cx - 4.5) + " " + (cy + 3.5) + "Z", class: "pt up" }, g);
        else if (lean === -1) s("path", { d: "M" + cx + " " + (cy + 5) + "L" + (cx + 4.5) + " " + (cy - 3.5) + "L" + (cx - 4.5) + " " + (cy - 3.5) + "Z", class: "pt dn" }, g);
        else s("circle", { cx, cy, r: lean === 0 ? 4 : 2.5, class: lean === 0 ? "pt hol" : "pt fl" }, g);
        g.addEventListener("click", () => openContract(r.c));
        g.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openContract(r.c); }
          const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const all = [...svg.querySelectorAll(".fl-dot")];
          const j = Math.max(0, Math.min(all.length - 1, all.indexOf(g) + d));
          all.forEach((q, k) => q.setAttribute("tabindex", k === j ? "0" : "-1"));
          all[j].focus();
        });
      });
    };
    host._draw = draw;
    draw();
    if (m.note) m.note.textContent = left ? left + (left === 1 ? " contract has" : " contracts have") + " no ratio and is not drawn." : "";
  }

  async function loadScreen(refresh) {
    const key = "screen:" + S.preset + ":" + (S.t || "*");
    const seq = ++S.seq;
    if (!DATA[key]) put("flScreen", h("p", { class: "fl-wait", role: "status" }, STATES.loading), "");
    const path = "/api/flows/flowlab/screen?preset=" + encodeURIComponent(S.preset) + (S.t ? "&t=" + encodeURIComponent(S.t) : "");
    const res = await get(path, refresh);
    DATA[key] = res;
    if (seq === S.seq || S.tab === "screen") paintScreen();
  }

  const tickerNeeded = (id) => put(id, emptyBlock(STATES["choose-ticker"]), "");

  const signOf = (net, ok) => (net === null ? null : !ok ? "und" : net > 0 ? "up" : net < 0 ? "down" : "flat");
  const sidedLine = (share, key) => (num(share) === null ? null : h("span", null, fill(NOTES[key || "sided"] || "", { pct: pct0(share) })));
  const spaced = (...parts) => parts.filter((q) => q !== null && q !== undefined && q !== "").flatMap((q, i) => (i ? [" ", q] : [q]));

  function mark(svg, x, y, dir) {
    if (dir === "up") return s("path", { d: "M" + geo(x) + " " + geo(y - 4) + "l4 7h-8z", class: "pt up" }, svg);
    if (dir === "down") return s("path", { d: "M" + geo(x) + " " + geo(y + 4) + "l4 -7h-8z", class: "pt dn" }, svg);
    if (dir === "und") return s("path", { d: "M" + geo(x) + " " + geo(y - 4) + "l4 4l-4 4l-4 -4z", class: "pt hol" }, svg);
    return s("path", { d: "M" + geo(x - 4) + " " + geo(y - 1) + "h8v2h-8z", class: "pt fl" }, svg);
  }

  function strikeCellText(map, r, c) {
    const v = map.cells[r] && map.cells[r][c];
    if (num(v) === null) return DASH;
    const u = num(map.unknown[r][c]) === null ? 0 : map.unknown[r][c];
    const range = u ? ", " + F.num(v - u, true) + " to " + F.num(v + u, true) : "";
    return F.num(v, true) + " contracts" + range + (map.decided[r][c] === true ? "" : ", " + STATES["net-undecided"]);
  }

  function paintStrikeMap(rec) {
    const id = "flStrikes";
    const m = modEl(id);
    stamp(id, rec.body);
    const half = rec.body.x.map;
    if (!half || half.ok !== true) { put(id, partBlock(half), ""); return; }
    const map = half.x;
    const host = h("div", { class: "fl-plot fl-heat" });
    m.body.replaceChildren(host);
    const ends = [];
    map.cells.forEach((line, i) => line.forEach((v, j) => { if (num(v) !== null) ends.push(Math.abs(v)); }));
    const cap = Math.max(1, ...ends);
    const centreRow = num(map.center) === null ? -1 : map.strikes.indexOf(map.center);
    const spec = {
      rows: map.strikes, cols: map.buckets, grid: map.cells, undecided: map.decided.map((line) => line.map((d) => d === false)), cap, left: 52, palette: "direction",
      label: "Signed contracts by strike and quarter hour for " + S.t,
      rowFormat: (k) => F.strike(k), colFormat: (ms) => F.time(ms, false),
      format: (v, r, c) => (r === undefined ? F.num(v, true) + " contracts" : strikeCellText(map, r, c)),
      highlightRow: centreRow >= 0 ? centreRow : undefined, cellH: 14,
    };
    const size = () => Math.max(8, Math.min(44, Math.floor((host.clientHeight - 32) / Math.max(1, map.strikes.length))));
    const every = () => Math.max(1, Math.ceil(44 / Math.max(1, (host.clientWidth - 52) / Math.max(1, map.buckets.length))));
    spec.cellH = size();
    spec.colEvery = every();
    if (UI.chart) {
      DATA._heat = UI.chart.heatmap(host, spec);
      host._draw = () => {
        const c = size();
        const e = every();
        if ((c !== spec.cellH || e !== spec.colEvery) && DATA._heat) { spec.cellH = c; spec.colEvery = e; DATA._heat.update({ cellH: c, colEvery: e }, { animate: false }); }
      };
    }
    banners(m, rec);
    if (m.note) {
      m.note.replaceChildren(...spaced(h("span", null, NOTES.strikeMap), h("span", null, NOTES.strikeCell), sidedLine(map.sidedShare)));
    }
    ALL.flStrikes = () => table([{ label: "Strike" }, { label: "Net contracts", cls: "num" }, { label: "Low", cls: "num" }, { label: "High", cls: "num" }],
      map.strikes.map((k, i) => h("tr", null, h("th", { scope: "row" }, F.strike(k)), h("td", { class: "num" }, F.num(map.cum[i], true)),
        h("td", { class: "num" }, F.num(map.cum[i] - map.cumUnknown[i], true)), h("td", { class: "num" }, F.num(map.cum[i] + map.cumUnknown[i], true)))), "strikes");
    if (m.more) m.more.hidden = false;
  }

  function paintRail(rec) {
    const id = "flStrikeRail";
    const m = modEl(id);
    stamp(id, rec.body);
    const half = rec.body.x.rail;
    if (!half || half.ok !== true) { put(id, partBlock(half), ""); return; }
    const x = half.x;
    const host = h("div", { class: "fl-plot" });
    m.body.replaceChildren(host);
    const draw = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      host.replaceChildren();
      const svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Signed contracts by strike for the session, each with its range" }, host);
      const T = 6, B = 6, Lw = 44, room = 58;
      const n = x.strikes.length;
      const rh = (H - T - B) / Math.max(1, n);
      const ends = [];
      for (const q of x.strikes) if (q.net !== null) ends.push(Math.abs(q.lo), Math.abs(q.hi));
      const max = Math.max(1, ...ends);
      const mid = Lw + (W - Lw) / 2;
      const span = Math.max(8, (W - Lw) / 2 - room);
      const at = (v) => mid + (v / max) * span;
      s("line", { x1: geo(mid), x2: geo(mid), y1: T, y2: H - B, class: "axis" }, svg);
      x.strikes.forEach((q, i) => {
        const y = T + i * rh;
        const cy = y + rh / 2;
        s("text", { x: Lw - 6, y: geo(cy + 3.5), text: F.strike(q.k), "text-anchor": "end", class: q.k === x.center ? "val" : null }, svg);
        const g = s("g", { class: "fl-rail", "data-k": String(q.k), "data-dir": q.net === null ? "none" : signOf(q.net, q.decided) }, svg);
        if (q.net === null) {
          s("text", { x: geo(mid + 4), y: geo(cy + 3.5), text: DASH, class: "val" }, g);
          s("title", { text: WHY[q.why] || WHY.noSides }, g);
          return;
        }
        const w = Math.abs(at(q.net) - mid);
        s("line", { x1: geo(at(q.lo)), x2: geo(at(q.hi)), y1: geo(cy), y2: geo(cy), class: "rng" }, g);
        s("rect", { x: geo(q.net >= 0 ? mid : mid - w), y: geo(y + 1), width: geo(w), height: geo(Math.max(1, rh - 2)), class: q.decided ? (q.net > 0 ? "bar up" : "bar dn") : "bar und" }, g);
        if (rh >= 11) {
          const right = q.net >= 0;
          const edge = right ? at(q.hi) + 9 : at(q.lo) - 9;
          mark(g, edge, cy, signOf(q.net, q.decided));
          s("text", { x: geo(right ? edge + 7 : edge - 7), y: geo(cy + 3.5), text: F.num(q.net, true), "text-anchor": right ? "start" : "end", class: "val" }, g);
        }
        s("title", { text: F.strike(q.k) + ": " + F.num(q.net, true) + " contracts, " + F.num(q.lo, true) + " to " + F.num(q.hi, true) + (q.decided ? "" : ". " + STATES["net-undecided"]) }, g);
      });
    };
    host._draw = draw;
    draw();
    banners(m, rec);
    if (m.note) m.note.replaceChildren(...spaced(h("span", null, NOTES.strikeRail), sidedLine(x.sidedShare), h("span", null, NOTES.railMark)));
    ALL.flStrikeRail = () => table([{ label: "Strike" }, { label: "Net contracts", cls: "num" }, { label: "Low", cls: "num" }, { label: "High", cls: "num" }, { label: "Sided", cls: "num" }],
      x.strikes.map((q) => h("tr", { "data-k": String(q.k) }, h("th", { scope: "row" }, F.strike(q.k)),
        ...(q.net === null ? [h("td", { class: "num", title: WHY[q.why] || null }, DASH), h("td", { class: "num" }, DASH), h("td", { class: "num" }, DASH), h("td", { class: "num" }, DASH)]
          : [h("td", { class: "num" }, F.num(q.net, true)), h("td", { class: "num" }, F.num(q.lo, true)), h("td", { class: "num" }, F.num(q.hi, true)), h("td", { class: "num" }, pct0(q.vol > 0 ? q.sided / q.vol : null))]))), "strikes");
    if (m.more) m.more.hidden = false;
  }

  function paintStrikes() {
    const rec = DATA["strikes:" + S.t];
    if (!rec) return;
    const st = why(rec);
    if (st) {
      stamp("flStrikes", rec.body);
      stamp("flStrikeRail", rec.body);
      put("flStrikes", blockOf(rec), "");
      put("flStrikeRail", blockOf(rec), "");
      return;
    }
    paintStrikeMap(rec);
    paintRail(rec);
  }

  async function loadStrikes(refresh) {
    if (!S.t) { tickerNeeded("flStrikes"); tickerNeeded("flStrikeRail"); return; }
    const key = "strikes:" + S.t;
    if (!DATA[key]) { put("flStrikes", h("p", { class: "fl-wait", role: "status" }, STATES.loading), ""); put("flStrikeRail", h("p", { class: "fl-wait", role: "status" }, STATES.loading), ""); }
    DATA[key] = await get("/api/flows/flowlab/name?t=" + encodeURIComponent(S.t) + "&view=strikes", refresh);
    paintStrikes();
  }

  function expiryRows(x) {
    return x.rows.slice().sort((a, b) => (a.e < b.e ? -1 : 1));
  }

  function chooseExpiry(x, day) {
    if (S.expiry && x.rows.some((r) => r.e === S.expiry && (!day || r.e >= day))) return S.expiry;
    const open = day ? x.rows.filter((r) => r.e >= day) : x.rows;
    let best = null;
    for (const r of open.length ? open : x.rows) {
      const size = (num(r.callC) || 0) + (num(r.putC) || 0);
      if (best === null || size > best.size || (size === best.size && r.e < best.e)) best = { size, e: r.e };
    }
    return best ? best.e : null;
  }

  function netCell(r) {
    if (num(r.netC) === null) {
      const text = WHY[r.why] || WHY.noSides;
      return h("td", { class: "num c-net", "data-why": r.why || "noSides", title: text }, dash(text));
    }
    const exact = r.loC === r.hiC;
    const dir = exact && r.netC === 0 ? "flat" : signOf(r.netC, r.decided === true);
    const word = dir === "up" ? LAB.up : dir === "down" ? LAB.down : dir === "flat" ? LAB.flat : CHIPS["net-undecided"];
    const text = exact ? money(r.netC, true) : money(r.netC, true) + " ± " + money(r.unknownC);
    const said = word + ". " + (exact ? "" : money(r.loC, true) + " to " + money(r.hiC, true) + ". ") + (num(r.sidedShare) === null ? "" : fill(NOTES.sidedPremium || "", { pct: pct0(r.sidedShare) }));
    return h("td", { class: "num c-net", "data-dir": dir, title: said.trim() }, h("span", { class: "ds-sg", "data-dir": dir }, h("i", { "aria-hidden": "true" }), text));
  }

  function pooledShare(rows) {
    let sided = 0;
    let total = 0;
    for (const r of rows) {
      if (num(r.sidedC) === null || num(r.callC) === null || num(r.putC) === null) continue;
      sided += r.sidedC;
      total += r.callC + r.putC;
    }
    return total > 0 ? sided / total : null;
  }

  function paintRecent() {
    const rec = DATA["recent:" + S.t];
    if (!rec) return;
    stamp("flRecent", rec.body);
    const st = why(rec);
    if (st) { put("flRecent", blockOf(rec), ""); return; }
    const x = rec.body.x;
    S.expiry = chooseExpiry(x, rec.body.session);
    const cols = [{ label: LAB.expiry || "Expiry" }, { label: LAB.calls || "Calls", cls: "num" }, { label: LAB.puts || "Puts", cls: "num" }, { label: LAB.net || "Net", cls: "num" }];
    const mk = (r) => {
      const b = h("button", { type: "button", class: "fl-link", "aria-pressed": String(r.e === S.expiry), onclick: () => { S.expiry = r.e; writeHash(); paintRecent(); loadGreek(false); } }, F.day(r.e));
      return h("tr", { "data-e": r.e, class: r.e === S.expiry ? "is-on" : null }, h("th", { scope: "row" }, b), h("td", { class: "num" }, money(r.callC)), h("td", { class: "num" }, money(r.putC)), netCell(r));
    };
    const rows = expiryRows(x);
    const wide = [...cols, { label: "Low", cls: "num" }, { label: "High", cls: "num" }, { label: "Sided", cls: "num" }];
    ALL.flRecent = () => table(wide, rows.map((r) => {
      const tr = mk(r);
      tr.append(h("td", { class: "num" }, money(r.loC, true)), h("td", { class: "num" }, money(r.hiC, true)), h("td", { class: "num" }, pct0(r.sidedShare)));
      return tr;
    }), "expiries");
    const m = put("flRecent", table(cols, rows.map(mk), "expiries"),
      spaced(x.prior ? h("span", null, fill(NOTES.priorSession, { date: x.date })) : null, h("span", null, NOTES.premiumNet), sidedLine(pooledShare(rows), "sidedPremium")));
    banners(m, rec);
    fit("flRecent");
  }

  function linePath(values, x0, x1, y0, y1, ts) {
    let d = "";
    let open = false;
    const span = Math.max(1, ts[ts.length - 1] - ts[0]);
    values.forEach((v, i) => {
      if (v === null) { open = false; return; }
      const x = x0 + ((ts[i] - ts[0]) / span) * (x1 - x0);
      const y = y1 - ((v + 1) / 2) * (y1 - y0);
      d += (open ? "L" : "M") + geo(x) + " " + geo(y);
      open = true;
    });
    return d;
  }

  const MINUTE = 60000;

  function timeTicks(t0, t1) {
    const mid = Math.round((t0 + t1) / 2 / MINUTE) * MINUTE;
    return t1 - t0 >= 2 * 30 * MINUTE ? [t0, mid, t1] : [t0, t1];
  }

  function paintGreek() {
    const rec = DATA["greek:" + S.t + ":" + S.expiry];
    const m = modEl("flGreeks");
    if (!rec) return;
    stamp("flGreeks", rec.body, S.expiry ? F.day(S.expiry) : null);
    const st = why(rec);
    if (st) { put("flGreeks", blockOf(rec), ""); return; }
    const x = rec.body.x;
    const dKey = S.basis === "tot" ? "totDelta" : S.otm ? "otmDirDelta" : "dirDelta";
    const vKey = S.basis === "tot" ? "totVega" : S.otm ? "otmDirVega" : "dirVega";
    const host = h("div", { class: "fl-plot fl-greek" });
    m.body.replaceChildren(host);
    const draw = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      host.replaceChildren();
      const svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Delta flow and vega flow through the session, relative shape only" }, host);
      const L = 8, R = 8, T = 10, B = 40;
      const y0 = T, y1 = H - B;
      const t0 = x.t.length ? x.t[0] : 0;
      const t1 = x.t.length ? x.t[x.t.length - 1] : 1;
      const at = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
      s("line", { x1: L, x2: W - R, y1: (y0 + y1) / 2, y2: (y0 + y1) / 2, class: "axis" }, svg);
      const lines = [["Delta flow", x.rel[dKey], "ln a"], ["Vega flow", x.rel[vKey], "ln b"]];
      lines.forEach(([label, vals, cls], i) => {
        if (!vals) { s("text", { x: L + 4, y: y0 + 12 + i * 14, text: label + ": no shape, the series is flat or empty", class: "val" }, svg); return; }
        s("path", { d: linePath(vals, L, W - R, y0, y1, x.t), class: cls, fill: "none" }, svg);
      });
      if (x.t.length) {
        const ticks = timeTicks(t0, t1);
        ticks.forEach((t, i) => s("text", { x: geo(at(t)), y: H - 24, text: F.time(t), "data-t": String(t), class: "tick", "text-anchor": i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle" }, svg));
      }
      for (const q of x.signs) {
        const c = Math.min(t1, Math.max(t0, q.t + 15 * MINUTE));
        const cx = at(c);
        const d = q.delta;
        const path = d > 0 ? "M" + geo(cx) + " " + (H - 17) + "l4.5 8h-9z" : d < 0 ? "M" + geo(cx) + " " + (H - 9) + "l4.5 -8h-9z" : "M" + geo(cx - 4) + " " + (H - 13) + "h8v2h-8z";
        s("path", { d: path, class: d > 0 ? "pt up" : d < 0 ? "pt dn" : "pt fl", "data-t": String(q.t) }, svg);
      }
    };
    host._draw = draw;
    draw();
    banners(m, rec);
    if (m.note) m.note.replaceChildren(...spaced(h("span", null, STATES["no-unit"]), h("span", null, "Solid line: delta flow. Dashed line: vega flow. Triangles show the sign of directional delta flow in each half hour."),
      x.early > 0 ? h("span", null, NOTES.greekOpen) : null));
  }

  async function loadGreek(refresh) {
    if (!S.t || !S.expiry) return;
    const key = "greek:" + S.t + ":" + S.expiry;
    if (!DATA[key]) put("flGreeks", h("p", { class: "fl-wait", role: "status" }, STATES.loading), "");
    DATA[key] = await get("/api/flows/flowlab/name?t=" + encodeURIComponent(S.t) + "&view=greek&exp=" + encodeURIComponent(S.expiry), refresh);
    paintGreek();
  }

  async function loadGreeks(refresh) {
    if (!S.t) { tickerNeeded("flGreeks"); tickerNeeded("flRecent"); return; }
    const key = "recent:" + S.t;
    if (!DATA[key]) { put("flRecent", h("p", { class: "fl-wait", role: "status" }, STATES.loading), ""); put("flGreeks", h("p", { class: "fl-wait", role: "status" }, STATES.loading), ""); }
    DATA[key] = await get("/api/flows/flowlab/name?t=" + encodeURIComponent(S.t) + "&view=recent", refresh);
    paintRecent();
    if (!why(DATA[key]) && S.expiry) await loadGreek(refresh);
    else {
      stamp("flGreeks", DATA[key].body);
      put("flGreeks", blockOf(DATA[key]), h("span", null, NOTES.greekNeeds));
    }
  }

  function halfLine(label, read) {
    if (!read) return null;
    return h("span", { "data-half": label }, label + ": " + stateText(read));
  }

  function paintLadder() {
    const rec = DATA["levels:" + S.t];
    if (!rec) return;
    stamp("flLadder", rec.body);
    const st = why(rec);
    if (st) { put("flLadder", blockOf(rec), ""); return; }
    const x = rec.body.x;
    const m = modEl("flLadder");
    const host = h("div", { class: "fl-plot fl-ladder" });
    m.body.replaceChildren(host);
    const draw = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      host.replaceChildren();
      const svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Option volume and stock volume by price, side by side" }, host);
      const bins = x.bins.slice().reverse();
      const T = 18, B = 22;
      const rh = Math.max(3, (H - T - B) / Math.max(1, bins.length));
      const midL = W * 0.42, midR = W * 0.58;
      const maxO = Math.max(1, ...bins.map((b) => Math.max(b.call || 0, b.put || 0)));
      const maxS = Math.max(1, ...bins.map((b) => (b.lit || 0) + (b.off || 0)));
      s("text", { x: 4, y: 12, text: (LAB.calls || "Calls") + " | " + (LAB.puts || "Puts") }, svg);
      s("text", { x: midR + 8, y: 12, text: (LAB.lit || "Lit") + " + " + (LAB.offExchange || "Off exchange") }, svg);
      bins.forEach((b, i) => {
        const y = T + i * rh;
        const wc = ((b.call || 0) / maxO) * (midL - 8), wp = ((b.put || 0) / maxO) * (midL - 8);
        if (b.call === null && b.put === null) s("rect", { x: 4, y: geo(y + 0.5), width: geo(midL - 8), height: geo(Math.max(1, rh - 1)), class: "void" }, svg);
        else {
          s("rect", { x: geo(midL / 2 - wc / 2), y: geo(y + 0.5), width: geo(Math.max(0, wc) / 2), height: geo(Math.max(1, rh - 1)), class: "bar up" }, svg);
          s("rect", { x: geo(midL / 2), y: geo(y + 0.5), width: geo(Math.max(0, wp) / 2), height: geo(Math.max(1, rh - 1)), class: "bar dn" }, svg);
        }
        if (b.lit === null && b.off === null) s("rect", { x: geo(midR + 4), y: geo(y + 0.5), width: geo(W - midR - 8), height: geo(Math.max(1, rh - 1)), class: "void" }, svg);
        else {
          const wl = ((b.lit || 0) / maxS) * (W - midR - 12), wo = ((b.off || 0) / maxS) * (W - midR - 12);
          s("rect", { x: geo(midR + 4), y: geo(y + 0.5), width: geo(Math.max(0, wl)), height: geo(Math.max(1, rh - 1)), class: "bar lit" }, svg);
          s("rect", { x: geo(midR + 4 + wl), y: geo(y + 0.5), width: geo(Math.max(0, wo)), height: geo(Math.max(1, rh - 1)), class: "bar off" }, svg);
        }
        if (i % Math.max(1, Math.ceil(12 / rh)) === 0) s("text", { x: geo((midL + midR) / 2), y: geo(y + rh / 2 + 3.5), text: F.px(b.lo / 100, 2), "text-anchor": "middle" }, svg);
      });
      if (num(x.spot) !== null) {
        const hit = bins.findIndex((b) => b.lo / 100 <= x.spot);
        if (hit >= 0) s("line", { x1: 0, x2: W, y1: geo(T + hit * rh), y2: geo(T + hit * rh), class: "ref" }, svg);
      }
      s("text", { x: 4, y: H - 6, text: "Off-exchange share " + (x.offShare === null ? DASH : F.pct(x.offShare, 0)) }, svg);
    };
    host._draw = draw;
    draw();
    banners(m, rec);
    const reads = x.reads || {};
    const notes = [halfLine("Option levels", reads.options), halfLine("Stock levels", reads.stock),
      h("span", null, "Bin width " + F.px(x.w / 100, 2) + "."),
      num(x.stockStep) !== null ? h("span", null, fill(NOTES.stockStep, { step: F.px(x.stockStep / 100, 2) })) : null,
      x.widened ? h("span", null, fill(NOTES.widened, { w: F.px(x.w / 100, 2) })) : null,
      h("span", null, COPY.glossary ? COPY.glossary.offShare : "")];
    if (m.note) m.note.replaceChildren(...spaced(...notes));
    ALL.flLadder = () => table([{ label: "Price" }, { label: LAB.calls || "Calls", cls: "num" }, { label: LAB.puts || "Puts", cls: "num" }, { label: LAB.lit || "Lit", cls: "num" }, { label: LAB.offExchange || "Off exchange", cls: "num" }],
      x.bins.slice().reverse().map((b) => h("tr", null, h("th", { scope: "row" }, F.px(b.lo / 100, 2)), ...[b.call, b.put, b.lit, b.off].map((v) => h("td", { class: "num" }, v === null ? DASH : F.num(v))))), "levels");
    if (m.more) m.more.hidden = false;
  }

  async function loadLadders(refresh) {
    if (!S.t) { tickerNeeded("flLadder"); return; }
    const key = "levels:" + S.t;
    if (!DATA[key]) put("flLadder", h("p", { class: "fl-wait", role: "status" }, STATES.loading), "");
    DATA[key] = await get("/api/flows/flowlab/name?t=" + encodeURIComponent(S.t) + "&view=levels", refresh);
    paintLadder();
  }

  const nightlyKey = (k) => "nightly:" + k;

  async function nightly(k, refresh) {
    const key = nightlyKey(k);
    if (!DATA[key] || refresh) DATA[key] = await get("/api/flows/flowlab/nightly?k=" + k, refresh === true);
    return DATA[key];
  }

  const pending = (rec) => rec && rec.body && rec.body.status === "pending";

  function exchangeBars(t) {
    const maxC = Math.max(1, ...t.exchanges.map((e) => e.contracts));
    const list = h("div", { class: "fl-bars" });
    for (const e of t.exchanges) {
      const bar = h("span", { class: "fl-bar" }, h("i"));
      bar.style.setProperty("--w", geo((e.contracts / maxC) * 100) + "%");
      const calls = e.callTrades + e.putTrades > 0 ? e.callTrades / (e.callTrades + e.putTrades) : null;
      list.append(h("div", { class: "fl-brow", "data-x": e.x }, h("span", { class: "fl-bk" }, e.x), bar, h("span", { class: "fl-bv" }, F.num(e.contracts)),
        h("span", { class: "fl-bs" }, money(e.premC) + " · " + (calls === null ? DASH : F.pct(calls, 0) + " calls"))));
    }
    return list;
  }

  function codeTable(pick) {
    const cols = [{ label: "Code" }, { label: LAB.contracts || "Contracts", cls: "num" }, { label: "Share", cls: "num" }];
    const rows = pick.top.map((q) => h("tr", { "data-code": q.code }, h("th", { scope: "row" }, q.code), h("td", { class: "num" }, F.num(q.contracts)), h("td", { class: "num" }, pct0(q.share))));
    return { cols, rows };
  }

  async function loadRouting(refresh) {
    if (S.t) {
      const key = "v:" + S.t;
      if (!DATA[key]) { put("flRoute", h("p", { class: "fl-wait", role: "status" }, STATES.loading), ""); put("flCodes", h("p", { class: "fl-wait", role: "status" }, STATES.loading), ""); }
      DATA[key] = await get("/api/flows/flowlab/venues?t=" + encodeURIComponent(S.t), refresh);
      const rec = DATA[key];
      stamp("flRoute", rec.body);
      stamp("flCodes", rec.body);
      const st = why(rec);
      const t = st ? null : rec.body.x.tickers[0];
      if (!t) {
        put("flRoute", blockOf(rec), "");
        put("flCodes", blockOf(rec), "");
        return;
      }
      const m = put("flRoute", h("div", { class: "fl-route" }, h("p", { class: "fl-fig" }, h("b", null, F.px(Number(t.hhi), 2)), " ", COPY.glossary ? COPY.glossary.routing : ""), exchangeBars(t)), "");
      banners(m, rec);
      ALL.flRoute = () => exchangeBars(t);
      if (!Array.isArray(t.top) || !t.top.length) { put("flCodes", stateBlock("quiet"), fill(NOTES.codes, { T: t.t })); return; }
      const { cols, rows } = codeTable(t);
      ALL.flCodes = () => table(cols, codeTable(t).rows, "codes");
      put("flCodes", table(cols, rows, "codes"), fill(NOTES.codes, { T: t.t }));
      fit("flCodes");
      return;
    }
    put("flCodes", emptyBlock(STATES["choose-ticker-codes"]), "");
    const rec = await nightly("venues", refresh);
    stamp("flRoute", rec.body);
    const st = why(rec);
    const list = rec.body && Array.isArray(rec.body.tickers) ? rec.body.tickers : null;
    if (st || !list) { put("flRoute", st ? blockOf(rec) : stateBlock(pending(rec) ? "loading" : "unshaped"), ""); return; }
    const cols = [{ label: "Ticker" }, { label: LAB.contracts || "Contracts", cls: "num" }, { label: "Concentration", cls: "num" }];
    const rows = list.slice().sort((a, b) => b.total - a.total).map((t) => h("tr", { "data-t": t.t }, h("th", { scope: "row" }, h("button", { type: "button", class: "fl-link", onclick: () => setTicker(t.t, true) }, t.t)), h("td", { class: "num" }, F.num(t.total)), h("td", { class: "num" }, t.hhi === null ? DASH : F.px(t.hhi, 2))));
    ALL.flRoute = () => table(cols, rows.map((r) => r.cloneNode(true)), "tickers");
    const m = put("flRoute", table(cols, rows, "tickers"), "");
    banners(m, rec);
    fit("flRoute");
  }

  function litTable(list) {
    const cols = [{ label: "Time" }, { label: "Ticker" }, { label: "Price", cls: "num" }, { label: "Size", cls: "num" }, { label: LAB.premium || "Premium", cls: "num" }, { label: "Venue" }];
    const rows = list.map((r) => h("tr", { class: r.canceled ? "is-canceled" : null }, h("th", { scope: "row" }, F.time(r.at)), h("td", null, r.t), h("td", { class: "num" }, F.px(r.px / 100, 2)),
      h("td", { class: "num" }, F.num(r.size)), h("td", { class: "num" }, money(r.premC)), h("td", null, (r.venue || DASH) + (r.canceled ? " · " + (COPY.drill ? COPY.drill.cancelled : "Canceled") : ""))));
    return { cols, rows };
  }

  async function loadLit(refresh) {
    const mk = DATA.litMarket = await get("/api/flows/flowlab/lit", refresh);
    stamp("flLitMarket", mk.body);
    const st = why(mk);
    if (st) put("flLitMarket", blockOf(mk), "");
    else {
      const { cols, rows } = litTable(mk.body.x.list);
      ALL.flLitMarket = () => table(cols, litTable(mk.body.x.list).rows, "prints");
      const below = num(mk.body.x.below) || 0;
      const m = put("flLitMarket", table(cols, rows, "prints"), spaced(h("span", null, fill(NOTES.litMarket, { n: F.num(mk.body.x.n) })), below ? h("span", null, fill(NOTES.litBelow, { n: F.num(below) })) : null));
      banners(m, mk);
      fit("flLitMarket");
    }
    if (!S.t) { tickerNeeded("flLitTicker"); return; }
    const key = "lit:" + S.t;
    DATA[key] = await get("/api/flows/flowlab/name?t=" + encodeURIComponent(S.t) + "&view=lit", refresh);
    stamp("flLitTicker", DATA[key].body);
    const st2 = why(DATA[key]);
    if (st2) put("flLitTicker", blockOf(DATA[key]), "");
    else {
      const { cols, rows } = litTable(DATA[key].body.x.list);
      ALL.flLitTicker = () => table(cols, litTable(DATA[key].body.x.list).rows, "prints");
      const m = put("flLitTicker", table(cols, rows, "prints"), "");
      banners(m, DATA[key]);
      fit("flLitTicker");
    }
  }

  const groupState = (status) => (status === "ok" ? null : WHYS[status] || (STATES[status] ? status : "unshaped"));

  function tile(g, entry) {
    const b = h("button", { type: "button", class: "fl-tile", "data-g": g, onclick: () => openGroup(g) });
    b.append(h("span", { class: "fl-tile-n", title: titleCase(g) }, titleCase(g)));
    const st = entry ? groupState(entry.status) : "failed";
    if (st) {
      b.append(chipEl(st));
      b.setAttribute("aria-label", titleCase(g) + ", " + (CHIPS[st] || st));
      return b;
    }
    const vals = entry.bars.map((q) => q.d);
    const max = Math.max(0, ...vals.filter((v) => v !== null).map(Math.abs));
    const svg = s("svg", { class: "fl-spark", viewBox: "0 0 130 24", preserveAspectRatio: "none", role: "img", "aria-label": "Directional delta flow, relative" });
    s("line", { x1: 0, x2: 130, y1: 12, y2: 12, class: "axis" }, svg);
    if (max > 0) {
      let d = "";
      vals.forEach((v, i) => { if (v === null) return; d += (d ? "L" : "M") + geo(i * 130 / 12) + " " + geo(12 - (v / max) * 10); });
      s("path", { d, class: "ln a", fill: "none" }, svg);
    }
    const net = entry.callC - entry.putC;
    b.append(svg, h("span", { class: "fl-tile-v" }, money(net, true)));
    b.setAttribute("aria-label", titleCase(g) + ", " + (LAB.netCallPut || "Net call minus put premium") + " " + money(net, true));
    return b;
  }

  function groupLine(rec) {
    const b = rec.body;
    const text = b.source === "read" ? fill(NOTES.groupRead, { TRT: b.asOf ? F.time(b.asOf) : DASH }) : fill(NOTES.groupSession, { date: sessionOf(b) });
    return h("p", { class: "fl-read" }, text + (b.expiry ? " " + (LAB.expiry || "Expiry") + " " + F.day(b.expiry) + "." : ""));
  }

  async function loadGroups(refresh) {
    if (!DATA[nightlyKey("groups")]) put("flGroups", h("p", { class: "fl-wait", role: "status" }, STATES["reading-groups"]), "");
    const rec = await nightly("groups", refresh);
    stamp("flGroups", rec.body);
    const st = why(rec);
    const groups = rec.body && rec.body.groups && typeof rec.body.groups === "object" ? rec.body.groups : null;
    if (st || !groups) { put("flGroups", st ? blockOf(rec) : stateBlock(pending(rec) ? "loading" : "unshaped"), ""); return; }
    const grid = h("div", { class: "fl-tiles" });
    for (const g of GROUP_NAMES) grid.append(tile(g, groups[g]));
    const wrap = h("div", { class: "fl-groups" }, groupLine(rec), grid);
    const m = put("flGroups", wrap, spaced(h("span", null, NOTES.groupNet), h("span", null, NOT_SIDED), h("span", null, STATES["no-unit"])));
    banners(m, rec);
    fit("flGroups");
    ALL.flGroups = () => table([{ label: "Group" }, { label: "Net", cls: "num" }, { label: "Status" }], GROUP_NAMES.map((g) => {
      const e = groups[g];
      const gst = e ? groupState(e.status) : "failed";
      return h("tr", null, h("th", { scope: "row" }, titleCase(g)), h("td", { class: "num" }, !gst ? money(e.callC - e.putC, true) : DASH), h("td", null, gst ? CHIPS[gst] || gst : LAB.readOk || DASH));
    }), "groups");
  }

  async function openGroup(g) {
    const rec = await nightly("groups", false);
    const exp = rec.body && rec.body.expiry;
    const dlg = $("flAll");
    $("flAllT").textContent = titleCase(g);
    $("flAllB").replaceChildren(h("p", { class: "fl-wait", role: "status" }, STATES.loading));
    if (dlg.showModal && !dlg.open) dlg.showModal();
    if (!exp) { $("flAllB").replaceChildren(why(rec) ? blockOf(rec) : stateBlock("unshaped")); return; }
    const live = await get("/api/flows/flowlab/group?g=" + encodeURIComponent(g) + "&exp=" + encodeURIComponent(exp), false);
    const st = why(live);
    if (st) { $("flAllB").replaceChildren(blockOf(live)); return; }
    const x = live.body.x;
    const host = h("div", { class: "fl-plot fl-greek" });
    $("flAllB").replaceChildren(host, h("p", { class: "fl-note" }, NOTES.groupNet + ": " + money(x.net.callC - x.net.putC, true) + ". " + NOT_SIDED + " " + STATES["no-unit"]));
    const draw = () => {
      const W = host.clientWidth || 520, H = 200;
      host.replaceChildren();
      const svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": titleCase(g) + " delta flow, relative shape only" }, host);
      s("line", { x1: 8, x2: W - 8, y1: H / 2, y2: H / 2, class: "axis" }, svg);
      if (x.rel.dirDelta) s("path", { d: linePath(x.rel.dirDelta, 8, W - 8, 8, H - 8, x.t), class: "ln a", fill: "none" }, svg);
      if (x.rel.dirVega) s("path", { d: linePath(x.rel.dirVega, 8, W - 8, 8, H - 8, x.t), class: "ln b", fill: "none" }, svg);
    };
    draw();
  }

  function corrGrid(win) {
    const names = win.symbols;
    const grid = names.map((a) => names.map((b) => (win.payload[a] && typeof win.payload[a][b] === "number" ? win.payload[a][b] : null)));
    return { names, grid };
  }

  async function loadRelations(refresh) {
    const rec = await nightly("corr", refresh);
    stamp("flRel", rec.body);
    const st = why(rec);
    if (st) { put("flRel", blockOf(rec), ""); return; }
    const b = rec.body;
    if (b.status === "off") { put("flRel", stateBlock("off"), ""); return; }
    if (pending(rec)) { put("flRel", emptyBlock("The nightly relations read has not landed."), ""); return; }
    if (b.status !== "ok") { put("flRel", stateBlock(b.status === "empty" ? "quiet" : b.status === "plan" ? "plan" : "unshaped"), ""); return; }
    const m = modEl("flRel");
    const host = h("div", { class: "fl-plot fl-heat" });
    m.body.replaceChildren(host);
    const { names, grid } = corrGrid(b.window);
    const size = () => Math.max(10, Math.min(24, Math.floor((host.clientHeight - 32) / Math.max(1, names.length))));
    const spec = { rows: names, cols: names, grid, cap: 1, left: 64, label: "Correlation of the session's flow-heavy names", cellH: size(), format: (v) => F.px(v, 2) };
    if (UI.chart) {
      DATA._rel = UI.chart.heatmap(host, spec);
      host._draw = () => { const c = size(); if (c !== spec.cellH && DATA._rel) { spec.cellH = c; DATA._rel.update({ cellH: c }, { animate: false }); } };
    }
    ALL.flRel = () => table([{ label: "Name" }, ...names.map((n) => ({ label: n, cls: "num" }))], names.map((n, i) => h("tr", null, h("th", { scope: "row" }, n), ...grid[i].map((v) => h("td", { class: "num" }, v === null ? DASH : F.px(v, 2))))), "names");
    if (m.note) m.note.textContent = "A correlation of daily closes over three months. It is not a forecast.";
  }

  const LOADERS = { screen: loadScreen, strikes: loadStrikes, greeks: loadGreeks, ladders: loadLadders, routing: loadRouting, lit: loadLit, groups: loadGroups, relations: loadRelations };

  function writeHash() {
    const q = new URLSearchParams();
    q.set("view", S.tab);
    if (S.t) q.set("t", S.t);
    if (S.c) q.set("c", S.c);
    if (S.preset !== "premium") q.set("p", S.preset);
    if (S.expiry && S.tab === "greeks") q.set("e", S.expiry);
    try { window.history.replaceState(null, "", window.location.pathname + window.location.search + "#" + q.toString()); } catch { S.hashBlocked = true; }
  }

  function readHash() {
    const q = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const v = q.get("view");
    if (DEF_TABS.indexOf(v) >= 0) S.tab = v;
    const t = (q.get("t") || "").toUpperCase();
    if (TICKER_RE.test(t)) S.t = t;
    const c = q.get("c") || "";
    S.c = OSI_RE.test(c) ? c : "";
    const p = q.get("p");
    if (p && COPY.presets && Object.prototype.hasOwnProperty.call(COPY.presets, p)) S.preset = p;
    const e = q.get("e");
    if (e && DAY_RE.test(e)) S.expiry = e;
  }

  function setTab(view, user) {
    S.tab = view;
    for (const p of document.querySelectorAll(".fl-panel")) {
      const on = p.getAttribute("data-view") === view;
      if (on) { p.setAttribute("data-on", ""); p.removeAttribute("inert"); } else { p.removeAttribute("data-on"); p.setAttribute("inert", ""); }
    }
    $("flStage").setAttribute("data-view", view);
    for (const b of document.querySelectorAll(".fl-tab")) {
      const on = b.getAttribute("data-view") === view;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (user) writeHash();
    mountMods();
    if (!S.loaded[view + ":" + S.t]) {
      S.loaded[view + ":" + S.t] = true;
      LOADERS[view](false).then(afterLoad);
    } else afterLoad();
  }

  function afterLoad() {
    requestAnimationFrame(() => {
      for (const el of document.querySelectorAll(".fl-panel[data-on] .fl-plot")) if (typeof el._draw === "function") el._draw();
      fitAll();
    });
    $("flStatus").textContent = "";
    const live = $("flStamp");
    if (live) live.textContent = "";
  }

  function mountMods() {
    const host = $("flMods");
    const panel = document.querySelector(".fl-panel[data-on]");
    const mods = panel ? [...panel.querySelectorAll(".fl-mod")] : [];
    if (mods.length < 2) { host.hidden = true; host.replaceChildren(); mods.forEach((m) => m.classList.add("is-on")); return; }
    const idx = Math.min(S.mod[S.tab] || 0, mods.length - 1);
    host.hidden = false;
    host.replaceChildren(...mods.map((m, i) => h("button", { type: "button", role: "tab", class: "fl-tab", "aria-selected": String(i === idx), "aria-controls": m.id, tabindex: i === idx ? "0" : "-1", onclick: () => { S.mod[S.tab] = i; mountMods(); afterLoad(); } }, m.getAttribute("data-short"))));
    mods.forEach((m, i) => m.classList.toggle("is-on", i === idx));
  }

  function setTicker(t, user) {
    const v = String(t || "").trim().toUpperCase();
    if (v && !TICKER_RE.test(v)) { $("flStatus").textContent = "Unknown ticker"; return false; }
    S.t = v;
    $("flT").value = v;
    S.expiry = null;
    S.loaded = {};
    for (const k of Object.keys(DATA)) if (/^(strikes|recent|greek|levels|lit|v):/.test(k)) delete DATA[k];
    if (user) writeHash();
    setTab(S.tab, false);
    return true;
  }

  function showAll(id) {
    const make = ALL[id];
    if (!make) return;
    const dlg = $("flAll");
    $("flAllT").textContent = (modEl(id).box.querySelector("h2") || {}).textContent || "";
    $("flAllB").replaceChildren(make());
    if (dlg.showModal && !dlg.open) dlg.showModal();
  }

  function keyTabs(list, onPick) {
    list.addEventListener("keydown", (e) => {
      const tabs = [...list.querySelectorAll('[role="tab"], [role="radio"]')];
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % tabs.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      tabs[to].focus();
      onPick(tabs[to]);
    });
  }

  function wire() {
    for (const b of document.querySelectorAll(".fl-tab[data-view]")) b.addEventListener("click", () => setTab(b.getAttribute("data-view"), true));
    keyTabs($("flTabs"), (b) => setTab(b.getAttribute("data-view"), true));
    $("flMods").addEventListener("keydown", (e) => {
      const tabs = [...$("flMods").querySelectorAll('[role="tab"]')];
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const to = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : -1;
      if (to < 0) return;
      e.preventDefault();
      tabs[to].focus();
      tabs[to].click();
      $("flMods").querySelectorAll('[role="tab"]')[to].focus();
    });
    $("flTk").addEventListener("submit", (e) => { e.preventDefault(); setTicker($("flT").value, true); });
    $("flRefresh").addEventListener("click", () => {
      S.loaded[S.tab + ":" + S.t] = true;
      for (const k of Object.keys(DATA)) delete DATA[k];
      LOADERS[S.tab](true).then(afterLoad);
    });
    $("flInfo").addEventListener("click", () => { const d = $("flInfoDlg"); if (d.showModal && !d.open) d.showModal(); });
    document.addEventListener("click", (e) => {
      const more = e.target.closest ? e.target.closest("[data-all]") : null;
      if (more) { showAll(more.getAttribute("data-all")); return; }
      const close = e.target.closest ? e.target.closest("[data-close]") : null;
      if (close) { const d = close.closest("dialog"); if (d) d.close(); return; }
      if (e.target && e.target.tagName === "DIALOG" && e.target.open) e.target.close();
    });
    const rankBox = $("flRank");
    const pickRank = (b) => {
      S.rank = b.getAttribute("data-rank");
      for (const q of rankBox.querySelectorAll("[data-rank]")) { const on = q === b; q.setAttribute("aria-checked", String(on)); q.tabIndex = on ? 0 : -1; }
      paintScreen();
    };
    for (const b of rankBox.querySelectorAll("[data-rank]")) b.addEventListener("click", () => pickRank(b));
    keyTabs(rankBox, pickRank);
    const presetBox = $("flPresetB");
    presetBox.setAttribute("role", "radiogroup");
    presetBox.setAttribute("aria-label", "Screener preset");
    presetBox.replaceChildren(...Object.keys(COPY.presets || {}).map((id) => h("button", { type: "button", role: "radio", class: "fl-pre", "data-p": id, "aria-checked": String(id === S.preset), tabindex: id === S.preset ? "0" : "-1" },
      h("span", { class: "fl-pre-l" }, COPY.presets[id]), h("span", { class: "fl-pre-n", "data-n": id }, DASH))));
    const pickPreset = (b) => {
      S.preset = b.getAttribute("data-p");
      for (const q of presetBox.querySelectorAll("[data-p]")) { const on = q === b; q.setAttribute("aria-checked", String(on)); q.tabIndex = on ? 0 : -1; }
      writeHash();
      loadScreen(false).then(afterLoad);
    };
    presetBox.addEventListener("click", (e) => { const b = e.target.closest ? e.target.closest("[data-p]") : null; if (b) pickPreset(b); });
    keyTabs(presetBox, pickPreset);
    const basis = $("flBasis");
    const pickBasis = (b) => {
      S.basis = b.getAttribute("data-basis");
      for (const q of basis.querySelectorAll("[data-basis]")) { const on = q === b; q.setAttribute("aria-checked", String(on)); q.tabIndex = on ? 0 : -1; }
      $("flOtm").disabled = S.basis === "tot";
      paintGreek();
    };
    for (const b of basis.querySelectorAll("[data-basis]")) b.addEventListener("click", () => pickBasis(b));
    keyTabs(basis, pickBasis);
    $("flOtm").addEventListener("click", () => { S.otm = !S.otm; $("flOtm").setAttribute("aria-pressed", String(S.otm)); paintGreek(); });
    let timer = null;
    window.addEventListener("resize", () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; afterLoad(); }, 100);
    });
    window.addEventListener("hashchange", () => {
      const before = S.tab;
      readHash();
      if (S.tab !== before) setTab(S.tab, false);
    });
  }

  async function names() {
    const rec = await get("/api/flows/universe?cols=t", false);
    const list = rec.body && Array.isArray(rec.body.t) ? rec.body.t : [];
    const dl = $("flTL");
    dl.replaceChildren(...list.slice(0, 1200).map((t) => h("option", { value: t })));
  }

  readHash();
  $("flT").value = S.t;
  wire();
  names();
  setTab(S.tab, false);
  if (S.c && window.FlowsUI.drill) window.FlowsUI.drill.open({ c: S.c });

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { flowlab: Object.freeze({ rank, labelOf, state: S, setTicker, setTab }) }));
})();
