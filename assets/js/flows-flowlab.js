(() => {
  "use strict";

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
    const w = res.body && res.body.why;
    if (!w) return null;
    if (w === "empty") return "quiet";
    if (w === "plan") return "plan";
    if (w === "limited") return "rate_limited";
    if (w === "timeout") return "timeout";
    if (w === "failed") return "failed";
    return "unshaped";
  }

  async function get(path, refresh) {
    const url = path + (refresh ? (path.includes("?") ? "&" : "?") + "refresh=1" : "");
    let r;
    try {
      r = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    } catch {
      return { error: "failed", body: null };
    }
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    if (r.ok && body) {
      const throttled = r.headers.get("X-Fresh-Throttled") === "1";
      const age = Number(r.headers.get("X-Chain-Age"));
      return { body, throttled, ageS: Number.isFinite(age) ? age : null };
    }
    const code = body && body.error && body.error.code;
    if (r.status === 429 || code === "rate_limited") return { error: "rate_limited", body: null };
    if (r.status === 504 || code === "chain_timeout") return { error: "timeout", body: null };
    return { error: "failed", body: null };
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
    const word = x.lean === 1 ? LAB.up : x.lean === -1 ? LAB.down : STATES["lean-undecided"];
    const dir = x.lean === 1 ? "up" : x.lean === -1 ? "down" : "flat";
    const bar = h("span", { class: "fl-rng", "aria-hidden": "true" }, h("i"));
    bar.style.setProperty("--lo", lo + "%");
    bar.style.setProperty("--hi", hi + "%");
    return h("td", { class: "c-ask", "data-lean": String(x.lean), title: word }, bar, h("span", { class: "fl-rng-t" }, lo === hi ? lo + "%" : lo + "–" + hi + "%"),
      h("span", { class: "ds-sg", "data-dir": dir }, h("i", { "aria-hidden": "true" }), x.lean === 0 ? LAB.flat : word));
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
      put(id, stateBlock(st), "");
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
    if (rec.throttled) m.body.prepend(h("div", { class: "fl-state fl-state-top" }, chipEl("throttled"), h("span", { class: "fl-state-t" }, fill(STATES.throttled, { TRT: rec.body.asOf ? F.time(rec.body.asOf) : DASH }))));
    if (rec.body.closed) m.body.prepend(h("div", { class: "fl-state fl-state-top" }, chipEl("closed"), h("span", { class: "fl-state-t" }, fill(STATES.closed, { date: rec.body.session }))));
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
    if (!rec || why(rec)) { put(id, rec ? stateBlock(why(rec)) : h("p", { class: "fl-wait" }, STATES.loading), ""); return; }
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

  const tickerNeeded = (id) => put(id, emptyBlock("Choose a ticker to read this view."), "");

  function paintStrikes() {
    const rec = DATA["strikes:" + S.t];
    if (!rec) return;
    stamp("flStrikes", rec.body);
    const st = why(rec);
    if (st) { put("flStrikes", stateBlock(st), ""); put("flStrikeRail", stateBlock(st), ""); return; }
    const x = rec.body.x;
    const m = modEl("flStrikes");
    const host = h("div", { class: "fl-plot fl-heat" });
    m.body.replaceChildren(host);
    const cols = x.buckets.map((b) => b);
    const grid = x.cells;
    const cap = Math.max(1, ...grid.flat().filter((v) => v !== null).map((v) => Math.abs(v)));
    const spotRow = x.spot === null ? undefined : x.strikes.reduce((a, k, i) => (Math.abs(k - x.spot) < Math.abs(x.strikes[a] - x.spot) ? i : a), 0);
    const spec = {
      rows: x.strikes, cols, grid, cap, left: 52, label: "Signed contracts by strike and quarter hour for " + S.t,
      rowFormat: (k) => F.strike(k), colFormat: (ms) => F.time(ms, false), format: (v) => F.num(v, true) + " contracts", highlightRow: spotRow, cellH: 14,
    };
    const size = () => Math.max(8, Math.min(44, Math.floor((host.clientHeight - 32) / Math.max(1, x.strikes.length))));
    spec.cellH = size();
    if (UI.chart) {
      DATA._heat = UI.chart.heatmap(host, spec);
      host._draw = () => { const c = size(); if (c !== spec.cellH && DATA._heat) { spec.cellH = c; DATA._heat.update({ cellH: c }, { animate: false }); } };
    }
    const sourceText = x.spotSource === "card" ? "Spot from the card." : x.spotSource === "median" ? "Spot not sent; the busiest strike by volume stands in." : "";
    if (m.note) m.note.replaceChildren(h("span", null, COPY.convention || ""), " ", h("span", null, STATES["no-expiry-in-rows"]), " ", h("span", null, sourceText));
    ALL.flStrikes = () => h("div", { class: "fl-all-heat" }, table([{ label: "Strike" }, { label: "Signed contracts" }], x.strikes.map((k, i) => h("tr", null, h("th", { scope: "row" }, F.strike(k)), h("td", null, F.num(x.cum[i], true)))), "strikes"));
    paintRail(x);
  }

  function paintRail(x) {
    const m = modEl("flStrikeRail");
    const host = h("div", { class: "fl-plot" });
    m.body.replaceChildren(host);
    const draw = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      host.replaceChildren();
      const svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Cumulative signed contracts by strike" }, host);
      const T = 6, B = 6, Lw = 44;
      const n = x.strikes.length;
      const rh = (H - T - B) / n;
      const max = Math.max(1, ...x.cum.map(Math.abs));
      const mid = Lw + (W - Lw - 8) / 2;
      s("line", { x1: mid, x2: mid, y1: T, y2: H - B, class: "axis" }, svg);
      x.strikes.forEach((k, i) => {
        const v = x.cum[i];
        const y = T + i * rh;
        const w = (Math.abs(v) / max) * ((W - Lw - 8) / 2 - 50);
        s("rect", { x: v >= 0 ? mid : mid - w, y: y + 1, width: Math.max(0, w), height: Math.max(1, rh - 2), class: v > 0 ? "bar up" : v < 0 ? "bar dn" : "bar fl" }, svg);
        s("text", { x: Lw - 6, y: y + rh / 2 + 3.5, text: F.strike(k), "text-anchor": "end" }, svg);
        if (rh >= 12) s("text", { x: v >= 0 ? mid + w + 4 : mid - w - 4, y: y + rh / 2 + 3.5, text: (v > 0 ? "▲ " : v < 0 ? "▼ " : "") + F.num(v, true), "text-anchor": v >= 0 ? "start" : "end", class: "val" }, svg);
      });
    };
    host._draw = draw;
    draw();
    stamp("flStrikeRail", { asOf: DATA["strikes:" + S.t].body.asOf });
  }

  async function loadStrikes(refresh) {
    if (!S.t) { tickerNeeded("flStrikes"); tickerNeeded("flStrikeRail"); return; }
    const key = "strikes:" + S.t;
    if (!DATA[key]) { put("flStrikes", h("p", { class: "fl-wait", role: "status" }, STATES.loading), ""); }
    DATA[key] = await get("/api/flows/flowlab/name?t=" + encodeURIComponent(S.t) + "&view=strikes", refresh);
    paintStrikes();
  }

  function expiryRows(x) {
    return x.rows.slice().sort((a, b) => (a.e < b.e ? -1 : 1));
  }

  function chooseExpiry(x) {
    if (S.expiry && x.rows.some((r) => r.e === S.expiry)) return S.expiry;
    let best = null;
    for (const r of x.rows) {
      const size = (r.callC || 0) + (r.putC || 0);
      if (best === null || size > best.size) best = { size, e: r.e };
    }
    return best ? best.e : null;
  }

  function paintRecent() {
    const rec = DATA["recent:" + S.t];
    if (!rec) return;
    stamp("flRecent", rec.body);
    const st = why(rec);
    if (st) { put("flRecent", stateBlock(st), ""); return; }
    const x = rec.body.x;
    S.expiry = chooseExpiry(x);
    const cols = [{ label: LAB.expiry || "Expiry" }, { label: LAB.calls || "Calls", cls: "num" }, { label: LAB.puts || "Puts", cls: "num" }, { label: "Net", cls: "num" }];
    const mk = (r) => {
      const dir = r.netC === null ? "flat" : r.netC > 0 ? "up" : r.netC < 0 ? "down" : "flat";
      const b = h("button", { type: "button", class: "fl-link", "aria-pressed": String(r.e === S.expiry), onclick: () => { S.expiry = r.e; writeHash(); paintRecent(); loadGreek(false); } }, F.day(r.e));
      return h("tr", { "data-e": r.e, class: r.e === S.expiry ? "is-on" : null }, h("th", { scope: "row" }, b), h("td", { class: "num" }, money(r.callC)), h("td", { class: "num" }, money(r.putC)),
        h("td", { class: "num" }, h("span", { class: "ds-sg", "data-dir": dir }, h("i", { "aria-hidden": "true" }), r.netC === null ? DASH : money(r.netC, true))));
    };
    const rows = expiryRows(x);
    ALL.flRecent = () => table(cols, rows.map(mk), "expiries");
    put("flRecent", table(cols, rows.map(mk), "expiries"), h("span", null, COPY.convention || ""));
    fit("flRecent");
  }

  function linePath(values, x0, x1, y0, y1, ts) {
    let d = "";
    let open = false;
    values.forEach((v, i) => {
      if (v === null) { open = false; return; }
      const x = x0 + ((ts[i] - ts[0]) / Math.max(1, ts[ts.length - 1] - ts[0])) * (x1 - x0);
      const y = y1 - ((v + 1) / 2) * (y1 - y0);
      d += (open ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      open = true;
    });
    return d;
  }

  function paintGreek() {
    const rec = DATA["greek:" + S.t + ":" + S.expiry];
    const m = modEl("flGreeks");
    if (!rec) return;
    stamp("flGreeks", rec.body, S.expiry ? F.day(S.expiry) : null);
    const st = why(rec);
    if (st) { put("flGreeks", stateBlock(st), ""); return; }
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
      s("line", { x1: L, x2: W - R, y1: (y0 + y1) / 2, y2: (y0 + y1) / 2, class: "axis" }, svg);
      const lines = [["Delta flow", x.rel[dKey], "ln a"], ["Vega flow", x.rel[vKey], "ln b"]];
      lines.forEach(([label, vals, cls], i) => {
        if (!vals) { s("text", { x: L + 4, y: y0 + 12 + i * 14, text: label + ": no shape, the series is flat or empty", class: "val" }, svg); return; }
        s("path", { d: linePath(vals, L, W - R, y0, y1, x.t), class: cls, fill: "none" }, svg);
      });
      const ticks = x.t.length ? [x.t[0], x.t[Math.floor(x.t.length / 2)], x.t[x.t.length - 1]] : [];
      ticks.forEach((t, i) => s("text", { x: L + (i / 2) * (W - L - R), y: H - 24, text: F.time(t), "text-anchor": i === 0 ? "start" : i === 2 ? "end" : "middle" }, svg));
      const sg = x.signs;
      const step = (W - L - R) / Math.max(1, sg.length);
      sg.forEach((q, i) => {
        const cx = L + step * (i + 0.5);
        const d = q.delta;
        const path = d > 0 ? "M" + cx + " " + (H - 17) + "l4.5 8h-9z" : d < 0 ? "M" + cx + " " + (H - 9) + "l4.5 -8h-9z" : "M" + (cx - 4) + " " + (H - 13) + "h8v2h-8z";
        s("path", { d: path, class: d > 0 ? "pt up" : d < 0 ? "pt dn" : "pt fl" }, svg);
      });
    };
    host._draw = draw;
    draw();
    if (m.note) m.note.replaceChildren(h("span", null, STATES["no-unit"]), " ", h("span", null, "Solid line: delta flow. Dashed line: vega flow. Triangles show the sign of directional delta flow in each half hour."));
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
    if (!DATA[key]) put("flRecent", h("p", { class: "fl-wait", role: "status" }, STATES.loading), "");
    DATA[key] = await get("/api/flows/flowlab/name?t=" + encodeURIComponent(S.t) + "&view=recent", refresh);
    paintRecent();
    if (!why(DATA[key])) await loadGreek(refresh);
    else tickerNeeded("flGreeks");
  }

  function paintLadder() {
    const rec = DATA["levels:" + S.t];
    if (!rec) return;
    stamp("flLadder", rec.body);
    const st = why(rec);
    if (st) { put("flLadder", stateBlock(st), ""); return; }
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
      const rh = Math.max(3, (H - T - B) / bins.length);
      const midL = W * 0.42, midR = W * 0.58;
      const maxO = Math.max(1, ...bins.map((b) => Math.max(b.call || 0, b.put || 0)));
      const maxS = Math.max(1, ...bins.map((b) => (b.lit || 0) + (b.off || 0)));
      s("text", { x: 4, y: 12, text: (LAB.calls || "Calls") + " | " + (LAB.puts || "Puts") }, svg);
      s("text", { x: midR + 8, y: 12, text: (LAB.lit || "Lit") + " + " + (LAB.offExchange || "Off exchange") }, svg);
      bins.forEach((b, i) => {
        const y = T + i * rh;
        const wc = ((b.call || 0) / maxO) * (midL - 8), wp = ((b.put || 0) / maxO) * (midL - 8);
        if (b.call === null && b.put === null) s("rect", { x: 4, y: y + 0.5, width: midL - 8, height: Math.max(1, rh - 1), class: "void" }, svg);
        else {
          s("rect", { x: midL / 2 - wc / 2 + 0, y: y + 0.5, width: Math.max(0, wc) / 2, height: Math.max(1, rh - 1), class: "bar up" }, svg);
          s("rect", { x: midL / 2, y: y + 0.5, width: Math.max(0, wp) / 2, height: Math.max(1, rh - 1), class: "bar dn" }, svg);
        }
        if (b.lit === null && b.off === null) s("rect", { x: midR + 4, y: y + 0.5, width: W - midR - 8, height: Math.max(1, rh - 1), class: "void" }, svg);
        else {
          const wl = ((b.lit || 0) / maxS) * (W - midR - 12), wo = ((b.off || 0) / maxS) * (W - midR - 12);
          s("rect", { x: midR + 4, y: y + 0.5, width: Math.max(0, wl), height: Math.max(1, rh - 1), class: "bar lit" }, svg);
          s("rect", { x: midR + 4 + wl, y: y + 0.5, width: Math.max(0, wo), height: Math.max(1, rh - 1), class: "bar off" }, svg);
        }
        if (i % Math.max(1, Math.ceil(12 / rh)) === 0) s("text", { x: (midL + midR) / 2, y: y + rh / 2 + 3.5, text: F.px(b.lo / 100, 2), "text-anchor": "middle" }, svg);
      });
      if (num(x.spot) !== null) {
        const hit = bins.findIndex((b) => b.lo / 100 <= x.spot);
        if (hit >= 0) s("line", { x1: 0, x2: W, y1: T + hit * rh, y2: T + hit * rh, class: "ref" }, svg);
      }
      s("text", { x: 4, y: H - 6, text: "Off-exchange share " + (x.offShare === null ? DASH : F.pct(x.offShare, 0)) }, svg);
    };
    host._draw = draw;
    draw();
    const notes = [];
    if (x.reads && x.reads.options) notes.push(h("span", null, "Option levels: " + (CHIPS[x.reads.options] || x.reads.options) + ". "));
    if (x.reads && x.reads.stock) notes.push(h("span", null, "Stock levels: " + (CHIPS[x.reads.stock] || x.reads.stock) + ". "));
    notes.push(h("span", null, "Bin width " + F.px(x.w / 100, 2) + ". " + (COPY.glossary ? COPY.glossary.offShare : "")));
    if (m.note) m.note.replaceChildren(...notes);
    ALL.flLadder = () => table([{ label: "Price" }, { label: LAB.calls || "Calls", cls: "num" }, { label: LAB.puts || "Puts", cls: "num" }, { label: LAB.lit || "Lit", cls: "num" }, { label: LAB.offExchange || "Off exchange", cls: "num" }],
      x.bins.slice().reverse().map((b) => h("tr", null, h("th", { scope: "row" }, F.px(b.lo / 100, 2)), ...[b.call, b.put, b.lit, b.off].map((v) => h("td", { class: "num" }, v === null ? DASH : F.num(v))))), "levels");
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
    if (!DATA[key] || refresh) DATA[key] = await get("/api/flows/flowlab/nightly?k=" + k, false);
    return DATA[key];
  }

  const pending = (rec) => rec && rec.body && rec.body.status === "pending";

  function exchangeBars(t) {
    const maxC = Math.max(1, ...t.exchanges.map((e) => e.contracts));
    const list = h("div", { class: "fl-bars" });
    for (const e of t.exchanges) {
      const bar = h("span", { class: "fl-bar" }, h("i"));
      bar.style.setProperty("--w", ((e.contracts / maxC) * 100).toFixed(1) + "%");
      const calls = e.callTrades + e.putTrades > 0 ? e.callTrades / (e.callTrades + e.putTrades) : null;
      list.append(h("div", { class: "fl-brow", "data-x": e.x }, h("span", { class: "fl-bk" }, e.x), bar, h("span", { class: "fl-bv" }, F.num(e.contracts)),
        h("span", { class: "fl-bs" }, money(e.premC) + " · " + (calls === null ? DASH : F.pct(calls, 0) + " calls"))));
    }
    return list;
  }

  async function loadRouting(refresh) {
    if (S.t) {
      const key = "v:" + S.t;
      if (!DATA[key]) put("flRoute", h("p", { class: "fl-wait", role: "status" }, STATES.loading), "");
      DATA[key] = await get("/api/flows/flowlab/venues?t=" + encodeURIComponent(S.t), refresh);
      const rec = DATA[key];
      stamp("flRoute", rec.body);
      const st = why(rec);
      if (st) put("flRoute", stateBlock(st), "");
      else {
        const t = rec.body.x.tickers[0];
        put("flRoute", h("div", { class: "fl-route" }, h("p", { class: "fl-fig" }, h("b", null, F.px(Number(t.hhi), 2)), " ", COPY.glossary ? COPY.glossary.routing : ""), exchangeBars(t)), "");
        ALL.flRoute = () => exchangeBars(t);
      }
    } else {
      const rec = await nightly("venues", refresh);
      stamp("flRoute", rec.body);
      const st = why(rec);
      if (st || pending(rec)) put("flRoute", st ? stateBlock(st) : emptyBlock("The nightly routing read has not landed."), "");
      else {
        const cols = [{ label: "Ticker" }, { label: LAB.contracts || "Contracts", cls: "num" }, { label: "Concentration", cls: "num" }];
        const rows = rec.body.tickers.slice().sort((a, b) => b.total - a.total).map((t) => h("tr", { "data-t": t.t }, h("th", { scope: "row" }, h("button", { type: "button", class: "fl-link", onclick: () => setTicker(t.t, true) }, t.t)), h("td", { class: "num" }, F.num(t.total)), h("td", { class: "num" }, t.hhi === null ? DASH : F.px(t.hhi, 2))));
        ALL.flRoute = () => table(cols, rows.map((r) => r.cloneNode(true)), "tickers");
        put("flRoute", table(cols, rows, "tickers"), "");
        fit("flRoute");
      }
    }
    const codes = await nightly("venues", false);
    stamp("flCodes", codes.body);
    const cst = why(codes);
    if (cst || pending(codes)) { put("flCodes", cst ? stateBlock(cst) : emptyBlock("The nightly trade codes have not landed."), ""); return; }
    const pick = S.t ? codes.body.codes.find((q) => q.t === S.t) : codes.body.codes[0];
    if (!pick) { put("flCodes", emptyBlock("No trade codes for this name in last night's read."), ""); return; }
    const cols = [{ label: "Code" }, { label: LAB.contracts || "Contracts", cls: "num" }, { label: "Share", cls: "num" }];
    const rows = pick.top.map((q) => h("tr", null, h("th", { scope: "row" }, q.code), h("td", { class: "num" }, F.num(q.contracts)), h("td", { class: "num" }, pct0(q.share))));
    ALL.flCodes = () => table(cols, rows.map((r) => r.cloneNode(true)), "codes");
    put("flCodes", table(cols, rows, "codes"), pick.t);
    fit("flCodes");
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
    if (st) put("flLitMarket", stateBlock(st), "");
    else {
      const { cols, rows } = litTable(mk.body.x.list);
      ALL.flLitMarket = () => litTable(mk.body.x.list).rows && table(cols, litTable(mk.body.x.list).rows, "prints");
      put("flLitMarket", table(cols, rows, "prints"), "");
      fit("flLitMarket");
    }
    if (!S.t) { tickerNeeded("flLitTicker"); return; }
    const key = "lit:" + S.t;
    DATA[key] = await get("/api/flows/flowlab/name?t=" + encodeURIComponent(S.t) + "&view=lit", refresh);
    stamp("flLitTicker", DATA[key].body);
    const st2 = why(DATA[key]);
    if (st2) put("flLitTicker", stateBlock(st2), "");
    else {
      const { cols, rows } = litTable(DATA[key].body.x.list);
      ALL.flLitTicker = () => table(cols, litTable(DATA[key].body.x.list).rows, "prints");
      put("flLitTicker", table(cols, rows, "prints"), "");
      fit("flLitTicker");
    }
  }

  function tile(g, entry) {
    const b = h("button", { type: "button", class: "fl-tile", "data-g": g, onclick: () => openGroup(g) });
    b.append(h("span", { class: "fl-tile-n", title: titleCase(g) }, titleCase(g)));
    if (!entry || entry.status !== "ok") {
      b.append(chipEl(entry && MAP[entry.status] ? entry.status : "failed"));
      b.setAttribute("aria-label", titleCase(g) + ", " + (entry ? entry.status : "not read"));
      return b;
    }
    const vals = entry.bars.map((q) => q.d);
    const max = Math.max(0, ...vals.filter((v) => v !== null).map(Math.abs));
    const svg = s("svg", { class: "fl-spark", viewBox: "0 0 130 24", preserveAspectRatio: "none", role: "img", "aria-label": "Directional delta flow, relative" });
    s("line", { x1: 0, x2: 130, y1: 12, y2: 12, class: "axis" }, svg);
    if (max > 0) {
      let d = "";
      vals.forEach((v, i) => { if (v === null) return; d += (d ? "L" : "M") + (i * 130 / 12).toFixed(1) + " " + (12 - (v / max) * 10).toFixed(1); });
      s("path", { d, class: "ln a", fill: "none" }, svg);
    }
    const net = entry.callC - entry.putC;
    b.append(svg, h("span", { class: "ds-sg", "data-dir": net > 0 ? "up" : net < 0 ? "down" : "flat" }, h("i", { "aria-hidden": "true" }), money(net, true)));
    b.setAttribute("aria-label", titleCase(g) + ", net call minus put premium " + money(net, true));
    return b;
  }

  async function loadGroups(refresh) {
    const rec = await nightly("groups", refresh);
    stamp("flGroups", rec.body);
    const st = why(rec);
    if (st || pending(rec)) { put("flGroups", st ? stateBlock(st) : emptyBlock("The nightly group read has not landed."), ""); return; }
    const grid = h("div", { class: "fl-tiles" });
    for (const g of GROUP_NAMES) grid.append(tile(g, rec.body.groups[g]));
    put("flGroups", grid, h("span", null, (LAB.netCallPut || "Net call minus put premium") + ". " + STATES["no-unit"]));
    fit("flGroups");
    ALL.flGroups = () => table([{ label: "Group" }, { label: "Net", cls: "num" }, { label: "Status" }], GROUP_NAMES.map((g) => {
      const e = rec.body.groups[g];
      return h("tr", null, h("th", { scope: "row" }, titleCase(g)), h("td", { class: "num" }, e && e.status === "ok" ? money(e.callC - e.putC, true) : DASH), h("td", null, e ? e.status : DASH));
    }), "groups");
  }

  async function openGroup(g) {
    const rec = await nightly("groups", false);
    const exp = rec.body && rec.body.expiry;
    const dlg = $("flAll");
    $("flAllT").textContent = titleCase(g);
    $("flAllB").replaceChildren(h("p", { class: "fl-wait", role: "status" }, STATES.loading));
    if (dlg.showModal && !dlg.open) dlg.showModal();
    if (!exp) { $("flAllB").replaceChildren(stateBlock("failed")); return; }
    const live = await get("/api/flows/flowlab/group?g=" + encodeURIComponent(g) + "&exp=" + encodeURIComponent(exp), false);
    const st = why(live);
    if (st) { $("flAllB").replaceChildren(stateBlock(st)); return; }
    const x = live.body.x;
    const host = h("div", { class: "fl-plot fl-greek" });
    $("flAllB").replaceChildren(host, h("p", { class: "fl-note" }, STATES["no-unit"], " ", fill(LAB.netCallPut || "", {}), ": ", money(x.net.callC - x.net.putC, true)));
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
    if (st) { put("flRel", stateBlock(st), ""); return; }
    const b = rec.body;
    if (pending(rec)) { put("flRel", emptyBlock("The nightly relations read has not landed."), ""); return; }
    if (b.status === "off") { put("flRel", stateBlock("off"), ""); return; }
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
