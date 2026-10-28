(() => {
  "use strict";
  const geo = (v) => Math.trunc(v * 10) / 10;

  const UI = window.FlowsUI;
  if (!UI || (UI.drill && UI.drill.open)) return;
  const { h, s, DASH, F } = UI;
  const OSI_RE = /^([A-Z][A-Z0-9]{0,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let COPY = null;
  const copy = () => {
    if (COPY) return COPY;
    try { COPY = JSON.parse(document.getElementById("flCopy").textContent); } catch { COPY = {}; }
    return COPY;
  };
  const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const money = (c, signed) => (num(c) === null ? DASH : F.money(c / 100, signed === true));
  const price = (c) => (num(c) === null ? DASH : "$" + F.px(c / 100, 2));

  const parse = (c) => {
    const m = OSI_RE.exec(String(c || ""));
    if (!m) return null;
    const e = "20" + m[2] + "-" + m[3] + "-" + m[4];
    return { root: m[1], e, cp: m[5] === "C" ? "Call" : "Put", k: Number(m[6]) / 1000 };
  };
  const labelOf = (c) => {
    const p = parse(c);
    return p ? p.root + " " + F.day(p.e) + " " + F.strike(p.k) + " " + p.cp : String(c);
  };

  const holder = document.querySelector('i[data-defer="drill"][data-css]');
  const href = holder ? holder.getAttribute("data-css") : null;
  const ready = new Promise((ok) => {
    if (!href || document.querySelector('link[href="' + href + '"]')) { ok(); return; }
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href, onload: ok, onerror: ok });
    document.head.append(link);
  });
  let dlg = null;
  let ret = null;
  let state = null;

  async function get(path) {
    let r;
    try { r = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } }); } catch { return { error: "failed" }; }
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    if (r.ok && body) return { body };
    const code = body && body.error && body.error.code;
    if (r.status === 429 || code === "rate_limited") return { error: "rate_limited" };
    if (r.status === 504) return { error: "timeout" };
    return { error: "failed" };
  }

  const stateOf = (res) => {
    if (!res || res.error) return (res && res.error) || "failed";
    const w = res.body && res.body.why;
    if (!w) return null;
    return w === "empty" ? "quiet" : w === "plan" ? "plan" : w === "limited" ? "rate_limited" : w === "timeout" ? "timeout" : w === "failed" ? "failed" : "unshaped";
  };
  const stateBlock = (code) => {
    const c = copy();
    const st = (c.stateMap || {})[code] || "quiet";
    return h("div", { class: "fl-state", "data-code": code, role: "status" },
      h("span", { class: "ds-st", "data-s": st }, h("i", { "aria-hidden": "true" }), (c.chips || {})[code] || code),
      h("span", { class: "fl-state-t" }, fill((c.states || {})[code] || "", { TRT: DASH, date: DASH })));
  };
  const wait = () => h("p", { class: "fl-wait", role: "status" }, (copy().states || {}).loading || "");

  function table(cols, rows) {
    const t = h("table", { class: "fl-t" });
    t.append(h("thead", null, h("tr", null, ...cols.map((c) => h("th", { scope: "col", class: c.cls || null }, c.label)))));
    const b = h("tbody");
    rows.forEach((r) => b.append(r));
    t.append(b);
    return t;
  }

  const body = () => dlg.querySelector(".dr-b");
  const note = (text) => { dlg.querySelector(".dr-n").textContent = text || ""; };

  const dirOf = (side) => (side > 0 ? "up" : side < 0 ? "down" : "flat");
  const sgn = (side) => h("span", { class: "ds-sg", "data-dir": dirOf(side) }, h("i", { "aria-hidden": "true" }), side > 0 ? "Ask" : side < 0 ? "Bid" : "Mid");

  async function core() {
    if (state.core) return state.core;
    const day = state.d ? "&d=" + encodeURIComponent(state.d) : "";
    state.core = await get("/api/flows/flowlab/contract?c=" + encodeURIComponent(state.c) + day);
    return state.core;
  }

  const part = (res, key) => {
    const st = stateOf(res);
    if (st) return { st };
    const p = res.body.x && res.body.x[key];
    if (!p) return { st: "quiet" };
    if (p.ok === false) return { st: p.why === "empty" ? "quiet" : p.why === "plan" ? "plan" : p.why === "unreachable" ? "failed" : "unshaped" };
    return { x: p.x || p, asOf: res.body.asOf };
  };

  async function paintPrints() {
    const res = await core();
    const { st, x } = part(res, "prints");
    if (st) { body().replaceChildren(stateBlock(st)); return; }
    const c = copy();
    const d = c.drill || {};
    const cols = [{ label: "Time" }, { label: "Price", cls: "num" }, { label: "Size", cls: "num" }, { label: (c.labels || {}).premium || "Premium", cls: "num" }, { label: "Side" }, { label: "Venue" }];
    const out = new Set((x.outliers && x.outliers.ok ? x.outliers.items : []) || []);
    const rows = x.list.map((p) => h("tr", { class: p.canceled ? "is-canceled" : null },
      h("th", { scope: "row" }, F.time(p.at)), h("td", { class: "num" }, price(p.px)), h("td", { class: "num" }, F.num(p.size)), h("td", { class: "num" }, money(p.premC)),
      h("td", null, p.canceled ? d.cancelled : sgn(p.side), out.has(p.id || String(p.at)) ? " · " + d.sizeOutlier : ""), h("td", null, p.venue || DASH)));
    const wrap = h("div", { class: "dr-scroll" }, table(cols, rows));
    wrap.style.cssText = "overflow:auto;min-height:0;flex:1";
    body().replaceChildren(wrap);
    note(x.n > x.list.length ? d.more : "");
  }

  async function paintMinutes() {
    const res = await core();
    const { st, x } = part(res, "minutes");
    if (st) { body().replaceChildren(stateBlock(st)); return; }
    const host = h("div", { class: "fl-plot" });
    body().replaceChildren(host);
    const draw = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      host.replaceChildren();
      const svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Cumulative ask side minus bid side volume through the session" }, host);
      const L = 52, R = 10, T = 8, B = 22;
      const t0 = x.list[0].m, t1 = x.list[x.list.length - 1].m;
      const max = Math.max(1, ...x.cum.map(Math.abs));
      const px = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
      const py = (v) => (H - B + T) / 2 - (v / max) * ((H - B - T) / 2);
      s("line", { x1: L, x2: W - R, y1: py(0), y2: py(0), class: "axis" }, svg);
      s("text", { x: 4, y: T + 8, text: F.num(max, true) }, svg);
      s("text", { x: 4, y: H - B, text: F.num(-max, true) }, svg);
      let d = "";
      x.list.forEach((q, i) => { d += (i ? "L" : "M") + geo(px(q.m)) + " " + geo(py(x.cum[i])); });
      s("path", { d, class: "ln a", fill: "none" }, svg);
      [t0, t1].forEach((t, i) => s("text", { x: i ? W - R : L, y: H - 6, text: F.time(t), "text-anchor": i ? "end" : "start" }, svg));
      if (x.firstAggressive !== null) {
        s("line", { x1: px(x.firstAggressive), x2: px(x.firstAggressive), y1: T, y2: H - B, class: "ref" }, svg);
        s("text", { x: px(x.firstAggressive) + 4, y: T + 20, text: (copy().drill || {}).firstAggressive + " " + F.time(x.firstAggressive) }, svg);
      }
    };
    host._draw = draw;
    draw();
    note("Cumulative ask side minus bid side contracts. " + ((copy().states || {})["no-unit"] || ""));
  }

  async function paintProfile() {
    const res = await core();
    const { st, x } = part(res, "profile");
    if (st) { body().replaceChildren(stateBlock(st)); return; }
    const host = h("div", { class: "fl-plot" });
    body().replaceChildren(host);
    const draw = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      host.replaceChildren();
      const svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Contracts traded by price" }, host);
      const lv = x.levels.slice().reverse();
      const T = 6, L = 56;
      const rh = Math.max(3, (H - T - 4) / lv.length);
      const max = Math.max(1, ...lv.map((q) => q.v));
      lv.forEach((q, i) => {
        const y = T + i * rh;
        const inVa = x.valueArea && q.px >= x.valueArea.lo && q.px <= x.valueArea.hi;
        const w = (q.v / max) * (W - L - 8);
        s("rect", { x: L, y: y + 0.5, width: Math.max(1, w), height: Math.max(1, rh - 1), class: inVa ? "bar lit" : "bar off", "data-poc": q.px === x.poc ? "1" : null }, svg);
        if (i % Math.max(1, Math.ceil(12 / rh)) === 0) s("text", { x: L - 6, y: y + rh / 2 + 3.5, text: money(q.px), "text-anchor": "end" }, svg);
      });
    };
    host._draw = draw;
    draw();
    note("Point of control " + money(x.poc) + ". Volume-weighted price " + money(x.vwapC) + ". Value area " + (x.valueArea ? money(x.valueArea.lo) + " to " + money(x.valueArea.hi) : DASH) + ".");
  }

  async function paintAlerts() {
    const res = await core();
    const { st, x } = part(res, "prints");
    if (st) { body().replaceChildren(stateBlock(st)); return; }
    const d = copy().drill || {};
    const ids = (x.alertIds || []).filter((i) => UUID_RE.test(i));
    if (!ids.length) { body().replaceChildren(h("div", { class: "fl-state", role: "status" }, h("span", { class: "fl-state-t" }, d.noAlerts))); return; }
    const list = h("div", { class: "dr-scroll" });
    list.style.cssText = "overflow:auto;min-height:0;flex:1";
    body().replaceChildren(list);
    for (const id of ids.slice(0, 6)) {
      const slot = h("section", { class: "dr-alert" }, wait());
      list.append(slot);
      get("/api/flows/flowlab/contract?c=" + encodeURIComponent(state.c) + "&part=alert&id=" + encodeURIComponent(id)).then((r) => {
        const e = stateOf(r);
        if (e) { slot.replaceChildren(stateBlock(e)); return; }
        const a = r.body.x.alert;
        const cols = [{ label: "Time" }, { label: "Price", cls: "num" }, { label: "Size", cls: "num" }, { label: "Premium", cls: "num" }, { label: "Venue" }];
        const rows = r.body.x.trades.map((t) => h("tr", null, h("th", { scope: "row" }, F.time(t.at)), h("td", { class: "num" }, price(t.pxC)), h("td", { class: "num" }, F.num(t.size)), h("td", { class: "num" }, money(t.premC)), h("td", null, t.venue || DASH)));
        slot.replaceChildren(h("h3", null, (a.rule || "Alert") + " · " + money(a.premC) + " · " + (a.at === null ? DASH : F.time(a.at))), table(cols, rows));
      });
    }
    note("");
  }

  async function paintStructure() {
    const d = copy().drill || {};
    const day = state.d ? "&d=" + encodeURIComponent(state.d) : "";
    const res = await get("/api/flows/flowlab/contract?c=" + encodeURIComponent(state.c) + "&part=structure" + day);
    const e = stateOf(res);
    if (e) { body().replaceChildren(stateBlock(e)); return; }
    const list = res.body.x.list;
    if (!list.length) { body().replaceChildren(h("div", { class: "fl-state", role: "status" }, h("span", { class: "fl-state-t" }, d.noStructure))); return; }
    const cols = [{ label: "Time" }, { label: "Package" }, { label: "Legs", cls: "num" }, { label: "Premium", cls: "num" }, { label: "" }];
    const rows = list.map((q) => h("tr", null, h("th", { scope: "row" }, F.time(q.at)), h("td", null, q.strategy || q.code || DASH), h("td", { class: "num" }, q.legs === null ? DASH : String(q.legs)), h("td", { class: "num" }, money(q.premC)),
      h("td", null, UUID_RE.test(q.id) ? h("button", { type: "button", class: "fl-link", onclick: () => legs(q.id) }, "Legs") : "")));
    const wrap = h("div", { class: "dr-scroll" }, table(cols, rows));
    wrap.style.cssText = "overflow:auto;min-height:0;flex:1";
    body().replaceChildren(wrap);
    note("A candidate package lists this strike; it is not proof the print belonged to it.");
  }

  async function legs(id) {
    const d = copy().drill || {};
    body().replaceChildren(wait());
    const day = state.d ? "&d=" + encodeURIComponent(state.d) : "";
    const res = await get("/api/flows/flowlab/contract?c=" + encodeURIComponent(state.c) + "&part=legs&id=" + encodeURIComponent(id) + day);
    const e = stateOf(res);
    if (e) { body().replaceChildren(stateBlock(e)); return; }
    const x = res.body.x;
    const cols = [{ label: "Leg" }, { label: "Side" }, { label: "Size", cls: "num" }, { label: "Price", cls: "num" }, { label: "Delta", cls: "num" }];
    const rows = x.legs.map((l) => h("tr", { class: l.c === state.c ? "is-on" : null }, h("th", { scope: "row" }, labelOf(l.c) + (l.c === state.c ? " · " + d.confirmed : "")), h("td", null, l.side || DASH), h("td", { class: "num" }, F.num(l.size)), h("td", { class: "num" }, price(l.pxC)), h("td", { class: "num" }, l.delta === null ? DASH : F.px(l.delta, 2))));
    body().replaceChildren(h("button", { type: "button", class: "fl-link", onclick: () => select("structure") }, d.back), table(cols, rows));
    note(d.deltaConvention);
  }

  async function paintRouting() {
    const p = parse(state.c);
    const d = copy().drill || {};
    const res = await core();
    const pr = part(res, "prints");
    const wrap = h("div", { class: "dr-scroll" });
    wrap.style.cssText = "overflow:auto;min-height:0;flex:1";
    if (pr.x) {
      const by = new Map();
      for (const q of pr.x.list) if (!q.canceled) by.set(q.venue || DASH, (by.get(q.venue || DASH) || 0) + q.size);
      const rows = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => h("tr", null, h("th", { scope: "row" }, k), h("td", { class: "num" }, F.num(v))));
      wrap.append(h("h3", null, "This contract"), table([{ label: "Venue" }, { label: "Contracts", cls: "num" }], rows));
    } else wrap.append(stateBlock(pr.st || "quiet"));
    body().replaceChildren(wrap);
    note(d.venueNote);
    const v = await get("/api/flows/flowlab/venues?t=" + encodeURIComponent(p.root));
    const e = stateOf(v);
    if (e || !v.body.x || !v.body.x.tickers[0]) { wrap.append(h("h3", null, p.root), stateBlock(e || "quiet")); return; }
    const t = v.body.x.tickers[0];
    const rows = t.exchanges.map((q) => h("tr", null, h("th", { scope: "row" }, q.x), h("td", { class: "num" }, F.num(q.contracts))));
    wrap.append(h("h3", null, p.root), table([{ label: "Exchange" }, { label: "Contracts", cls: "num" }], rows));
  }

  const PAINT = { prints: paintPrints, minutes: paintMinutes, profile: paintProfile, alerts: paintAlerts, structure: paintStructure, routing: paintRouting };

  function select(id) {
    if (!state) return;
    state.tab = id;
    for (const b of dlg.querySelectorAll(".fl-tab")) {
      const on = b.getAttribute("data-view") === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    body().replaceChildren(wait());
    note("");
    const seq = ++state.seq;
    Promise.resolve(PAINT[id]()).then(() => {
      if (seq !== state.seq) return;
      requestAnimationFrame(() => { for (const el of dlg.querySelectorAll(".fl-plot")) if (typeof el._draw === "function") el._draw(); });
    });
  }

  function build() {
    const c = copy();
    const d = c.drill || {};
    dlg = h("dialog", { class: "dr-sheet", "aria-labelledby": "drT" });
    const tabs = h("div", { class: "fl-tabs", role: "tablist", "aria-label": "Contract views" },
      ...(c.drillTabs || []).map((t, i) => h("button", { type: "button", role: "tab", class: "fl-tab", "data-view": t.id, "aria-selected": String(i === 0), tabindex: i === 0 ? "0" : "-1", onclick: () => select(t.id) }, t.label)));
    tabs.addEventListener("keydown", (e) => {
      const list = [...tabs.querySelectorAll('[role="tab"]')];
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      const to = e.key === "ArrowRight" ? (i + 1) % list.length : e.key === "ArrowLeft" ? (i - 1 + list.length) % list.length : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      list[to].focus();
      select(list[to].getAttribute("data-view"));
    });
    dlg.append(h("div", { class: "dr" },
      h("header", { class: "dr-h" }, h("h2", { id: "drT" }), h("a", { class: "dr-open", id: "drOpen", href: "/flows/flowlab/" }, d.open), h("button", { type: "button", class: "fl-x", autofocus: "", onclick: () => close() }, d.close)),
      tabs, h("div", { class: "dr-b" }), h("p", { class: "dr-n", role: "status" })));
    dlg.addEventListener("close", () => { state = null; if (ret && ret.isConnected && typeof ret.focus === "function") ret.focus(); ret = null; });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    document.body.append(dlg);
  }

  function open(opts) {
    const c = opts && opts.c;
    if (!parse(c)) return false;
    ret = document.activeElement;
    ready.then(() => {
      if (!dlg) build();
      state = { c, d: opts.d || null, tab: "prints", core: null, seq: 0 };
      dlg.querySelector("#drT").textContent = labelOf(c);
      dlg.querySelector("#drOpen").setAttribute("href", "/flows/flowlab/#view=screen&t=" + parse(c).root + "&c=" + encodeURIComponent(c));
      if (dlg.showModal && !dlg.open) dlg.showModal();
      select("prints");
    });
    return true;
  }

  function close() {
    if (dlg && dlg.open) dlg.close();
  }

  const model = Object.freeze({ parse, labelOf });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { drill: Object.freeze({ open, close, model }) }));
})();
