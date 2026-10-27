(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const { h, F } = UI;
  const DASH = UI.DASH || "—";
  const MINUS = UI.MINUS || "−";
  const SVGNS = "http://www.w3.org/2000/svg";
  const MOUNTS = new WeakMap();
  const holder = document.querySelector('i[data-defer="voldesk"][data-css]');
  const href = holder ? holder.getAttribute("data-css") : null;
  const ready = new Promise((ok) => {
    if (!href || document.querySelector('link[href="' + href + '"]')) { ok(); return; }
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href, onload: ok, onerror: ok });
    document.head.append(link);
  });

  const COPY = Object.freeze({
    "title.tab": "Vol desk",
    "title.term": "Index term structure",
    "title.ivrv": "Implied against realised",
    "title.matrix": "Correlation",
    "title.character": "Volatility character",
    "title.xcheck": "Engine cross-check",
    "state.contango": "Contango: 90-day implied above 30-day.",
    "state.backwardation": "Backwardation: 30-day implied above 90-day.",
    "state.flat": "Flat: 30-day and 90-day implied within half a point.",
    "futures.unshaped": "The feed's futures table has not been read by the shape probe yet.",
    "futures.plan": "The futures table needs a feed plan the site does not hold.",
    "futures.roll": "Second month {sign}{x}% against the front, per 30 days.",
    "ivrv.line": "Implied {iv}, realised over 21 sessions {rv}, spread {sign}{s} points.",
    "ivrv.place": "Implied at {p}% of its 1-year range.",
    "ivrv.stale": "Realised as of {date}, the feed's latest.",
    "matrix.cell": "{a} and {b}: {r} over {rows} sessions, {from} to {to}.",
    "matrix.asym": "The feed gave two values for this pair, so it is withheld.",
    "matrix.absent": "The feed returned no value for this pair.",
    "matrix.avg": "Sector ETF average {r} over {n} pairs.",
    "matrix.few": "Too few pairs for a sector average.",
    "matrix.site": "Site's Nasdaq-100 implied correlation {i}, realised {r}; different baskets.",
    "character.first": "Movers start after the second night this table is read.",
    "character.unshaped": "The feed's character table has not been read by the shape probe yet.",
    "character.def": "Half-life: sessions for a volatility shock to halve.",
    "character.hurst": "Hurst above 0.5 persists; below 0.5 reverts.",
    "state.pending": "Tonight's run has not published this yet.",
    "state.failed": "The feed's {what} read failed tonight; this is not an empty table.",
  });
  const say = (key, values) => COPY[key].replace(/\{([a-z]+)\}/g, (whole, name) => (values && Object.hasOwn(values, name) ? String(values[name]) : whole));

  const FUNDS = Object.freeze(["SPY", "QQQ", "IWM", "DIA"]);
  const MARKS = Object.freeze({ SPY: "circle", QQQ: "square", IWM: "triangle", DIA: "diamond" });
  const DASHES = Object.freeze({ SPY: null, QQQ: null, IWM: "4 3", DIA: "1 3" });
  const TICKS_X = Object.freeze([7, 30, 60, 90, 180, 365]);
  const X_MAX = 400;
  const BANDS = 5;
  const CELL_PRINT = 26;
  const isNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const svg = (tag, attrs, ...kids) => {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]); }
    for (const k of kids) if (k !== null && k !== undefined) n.append(k);
    return n;
  };
  const sgn = (x, dp) => (x < 0 ? MINUS : x > 0 ? "+" : "") + F.num(Math.abs(x), false, dp);
  const r2 = (x) => (x < 0 ? MINUS : "") + F.px(Math.abs(x), 2);
  const pct1 = (x) => F.pct(x, 1);

  function stateOf(part, what, unshapedKey) {
    if (!part) return { state: "pending", reason: say("state.pending") };
    if (part.status === "unshaped") return { state: "withheld", reason: say(unshapedKey) };
    if (part.status === "plan") return { state: "plan", reason: say("futures.plan") };
    if (part.status === "ok" || part.status === "partial") return { state: "ok" };
    return { state: "unavailable", reason: say("state.failed", { what }) };
  }

  function shape(payload, ref) {
    if (!payload || payload.__unreadable) {
      const reason = say("state.failed", { what: "Vol desk" });
      return { state: { state: "unavailable", reason } };
    }
    if (payload.status === "pending") return { state: { state: "pending", reason: say("state.pending") } };
    const stale = typeof UI.staleness === "function"
      ? UI.staleness({ sessionDate: payload.session, __updatedAt: ref && ref.updatedAt }, ref && ref.now ? ref.now : Date.now(), { subject: "The Vol desk" })
      : { kind: "unknown", message: null };
    const behind = stale.kind === "session" && /(\d+) sessions? behind/.exec(stale.message || "");
    if (behind && Number(behind[1]) >= 2) {
      return { state: { state: "withheld", reason: stale.message }, expired: true, stale };
    }
    return { state: { state: "ok" }, stale: stale.message ? stale : null, payload };
  }

  function model(payload, ref) {
    const base = shape(payload, ref);
    if (base.state.state !== "ok") return base;
    const p = payload;
    const term = p.term || {};
    const funds = FUNDS.map((t) => ({ t, ...(term.funds && term.funds[t] ? term.funds[t] : { status: "absent", points: [] }) }));
    return {
      state: base.state, stale: base.stale, generatedAt: p.generatedAt, session: p.session,
      term: { funds, st: funds.some((f) => f.status === "ok" || f.status === "partial") ? { state: "ok" } : { state: "unavailable", reason: say("state.failed", { what: "term structure" }) } },
      futures: { part: term.futures || null, st: stateOf(term.futures, "futures", "futures.unshaped") },
      ivrv: FUNDS.map((t) => ({ t, ...(p.ivrv && p.ivrv[t] ? p.ivrv[t] : { status: "absent" }) })),
      matrix: p.matrix || null,
      site: p.site || null,
      character: { part: p.character || null, st: stateOf(p.character, "character table", "character.unshaped") },
    };
  }

  function niceStep(span) {
    for (const s of [0.5, 1, 2, 5, 10, 20]) if (span / s <= 6) return s;
    return 20;
  }

  function relax(items, gap, lo, hi) {
    const out = items.slice().sort((a, b) => a.y - b.y);
    for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < gap) out[i].y = out[i - 1].y + gap;
    const over = out.length ? out[out.length - 1].y - hi : 0;
    if (over > 0) for (const o of out) o.y -= over;
    for (let i = 0; i < out.length; i++) if (out[i].y < lo) out[i].y = lo + i * gap;
    return out;
  }

  function markShape(kind, x, y, cls) {
    const r = 3.4;
    if (kind === "square") return svg("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, class: cls });
    if (kind === "triangle") return svg("path", { d: `M${x} ${y - r - 0.6}L${x + r + 0.6} ${y + r}L${x - r - 0.6} ${y + r}Z`, class: cls });
    if (kind === "diamond") return svg("path", { d: `M${x} ${y - r - 1}L${x + r + 1} ${y}L${x} ${y + r + 1}L${x - r - 1} ${y}Z`, class: cls });
    return svg("circle", { cx: x, cy: y, r: r, class: cls });
  }

  function termChart(funds, W, H, active) {
    const L = 40, R = 46, T = 16, B = 22;
    const pw = Math.max(40, W - L - R), ph = Math.max(40, H - T - B);
    const pts = funds.flatMap((f) => (f.points || []).map(([d, iv]) => iv * 100));
    const lo0 = pts.length ? Math.min(...pts) : 10, hi0 = pts.length ? Math.max(...pts) : 30;
    const step = niceStep(Math.max(1, hi0 - lo0) * 1.2);
    const lo = Math.floor((lo0 - (hi0 - lo0) * 0.08) / step) * step, hi = Math.ceil((hi0 + (hi0 - lo0) * 0.08) / step) * step;
    const x = (d) => L + Math.sqrt(Math.min(d, X_MAX) / X_MAX) * pw;
    const y = (v) => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
    const root = svg("svg", { class: "vd-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-hidden": "true", focusable: "false" });
    for (let v = lo; v <= hi + 1e-9; v += step) {
      root.append(svg("line", { x1: L, x2: L + pw, y1: y(v), y2: y(v), class: "vd-grid" }));
      root.append(svg("text", { x: L - 6, y: y(v) + 3.5, class: "vd-ax", "text-anchor": "end" }, document.createTextNode(F.num(v, false, step < 1 ? 1 : 0) + "%")));
    }
    for (const d of TICKS_X) root.append(svg("text", { x: x(d), y: H - 6, class: "vd-ax", "text-anchor": "middle" }, document.createTextNode(String(d))));
    for (const d of [30, 90]) {
      root.append(svg("line", { x1: x(d), x2: x(d), y1: T, y2: T + ph, class: "vd-guide" }));
      root.append(svg("text", { x: x(d) + 3, y: T + 9, class: "vd-gl" }, document.createTextNode(d + "d")));
    }
    const ends = [];
    const hits = [];
    funds.forEach((f, si) => {
      const list = (f.points || []).filter(([d]) => d <= X_MAX);
      if (!list.length) return;
      const path = list.map(([d, iv], i) => (i ? "L" : "M") + x(d).toFixed(1) + " " + y(iv * 100).toFixed(1)).join("");
      root.append(svg("path", { d: path, class: "vd-line", "data-t": f.t, "stroke-dasharray": DASHES[f.t] }));
      list.forEach(([d, iv], i) => {
        root.append(markShape(MARKS[f.t], x(d), y(iv * 100), "vd-mark"));
        root.lastChild.setAttribute("data-t", f.t);
        hits.push({ s: si, i, t: f.t, d, iv, px: x(d), py: y(iv * 100) });
      });
      const last = list[list.length - 1];
      ends.push({ t: f.t, y: y(last[1] * 100), x: x(last[0]) });
    });
    for (const e of relax(ends, 12, T + 6, T + ph)) {
      root.append(svg("text", { x: e.x + 8, y: e.y + 3.5, class: "vd-end", "data-t": e.t }, document.createTextNode(e.t)));
    }
    if (active) {
      const hit = hits.find((q) => q.s === active.s && q.i === active.i);
      if (hit) root.append(svg("circle", { cx: hit.px, cy: hit.py, r: 8, class: "vd-ring", "data-t": hit.t }));
    }
    return { root, hits };
  }

  function futuresChart(part, W, H) {
    const L = 40, R = 18, T = 14, B = 24;
    const pw = Math.max(40, W - L - R), ph = Math.max(40, H - T - B);
    const pts = part.points || [];
    const prices = pts.map((p) => p[2]).concat(isNum(part.spot) ? [part.spot] : []);
    const lo0 = Math.min(...prices), hi0 = Math.max(...prices);
    const step = niceStep(Math.max(0.5, hi0 - lo0) * 1.3);
    const lo = Math.floor((lo0 - 0.4 * step) / step) * step, hi = Math.ceil((hi0 + 0.4 * step) / step) * step;
    const dmax = Math.max(...pts.map((p) => p[1]), 30);
    const x = (d) => L + (d / dmax) * pw;
    const y = (v) => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
    const root = svg("svg", { class: "vd-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
    for (let v = lo; v <= hi + 1e-9; v += step) {
      root.append(svg("line", { x1: L, x2: L + pw, y1: y(v), y2: y(v), class: "vd-grid" }));
      root.append(svg("text", { x: L - 6, y: y(v) + 3.5, class: "vd-ax", "text-anchor": "end" }, document.createTextNode(F.num(v, false, step < 1 ? 1 : 0))));
    }
    if (isNum(part.spot)) {
      root.append(svg("line", { x1: L, x2: L + pw, y1: y(part.spot), y2: y(part.spot), class: "vd-spot" }));
      root.append(svg("text", { x: L + pw, y: y(part.spot) - 4, class: "vd-gl", "text-anchor": "end" }, document.createTextNode("Index level " + F.num(part.spot, false, 1))));
    }
    root.append(svg("path", { d: pts.map((p, i) => (i ? "L" : "M") + x(p[1]).toFixed(1) + " " + y(p[2]).toFixed(1)).join(""), class: "vd-fut" }));
    for (const p of pts) {
      root.append(svg("circle", { cx: x(p[1]), cy: y(p[2]), r: 3.2, class: "vd-fm" }));
      root.append(svg("text", { x: x(p[1]), y: H - 8, class: "vd-ax", "text-anchor": "middle" }, document.createTextNode(p[1] + "d")));
    }
    return root;
  }

  function matrixLayout(W, H, n) {
    const gutter = 36, foot = 34;
    const cell = Math.max(6, Math.floor(Math.min((W - gutter) / n, (H - foot) / n)));
    return { gutter, foot, cell, W: gutter + cell * n, H: foot + cell * n };
  }

  function bandOf(r) {
    return Math.min(BANDS - 1, Math.max(0, Math.floor(r / 0.2)));
  }

  function mount(hosts, payload, ref) {
    const prior = hosts.term && MOUNTS.get(hosts.term);
    if (prior) prior.destroy();
    const M = model(payload, ref);
    let termView = 0, corrWin = 0, active = null, dead = false;
    const cleanup = [];
    const defs = svg("svg", { class: "vd-defs", width: 0, height: 0, "aria-hidden": "true", focusable: "false" },
      svg("defs", null, svg("pattern", { id: "vdHatch", width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, svg("line", { x1: 0, y1: 0, x2: 0, y2: 5, class: "vd-hatch" }))));
    if (!document.getElementById("vdHatch")) document.body.append(defs);

    const silentFor = (st, label, height) => UI.silent(st, label, height);

    function stampEl() {
      const el = h("span", { class: "vd-stamp" });
      if (M.generatedAt) el.append(h("span", { class: "vd-built" }, "built " + (F.when(M.generatedAt, Date.now()) || DASH)));
      if (M.stale) el.append(h("span", { class: "vd-pill", "data-stale": "session", title: M.stale.message }, "Session " + F.day(M.session)));
      return el;
    }

    function termHead() {
      const spy = M.term.funds.find((f) => f.t === "SPY");
      const wrap = h("div", { class: "vd-thead" });
      const f = spy && spy.state ? spy : M.term.funds.find((q) => q.state);
      if (!f || !f.state) { wrap.append(stampEl()); return wrap; }
      const glyph = f.state === "contango" ? "▲" : f.state === "backwardation" ? "▼" : "■";
      wrap.append(h("span", { class: "vd-chip", "data-state": f.state, title: say("state." + f.state) }, h("i", { "aria-hidden": "true" }, glyph), h("b", null, f.state[0].toUpperCase() + f.state.slice(1)), h("em", null, f.t)),
        h("span", { class: "vd-tfig" }, "30d " + pct1(f.iv30) + " · 90d " + pct1(f.iv90) + " · slope " + sgn(f.slope, 1) + " pts"));
      wrap.append(stampEl());
      return wrap;
    }

    function termTable() {
      const rows = [];
      for (const f of M.term.funds) for (const [d, iv] of f.points || []) rows.push(h("tr", null, h("th", { scope: "row" }, f.t), h("td", null, d + " days"), h("td", null, pct1(iv))));
      return h("table", { class: "visually-hidden" }, h("caption", null, say("title.term")), h("thead", null, h("tr", null, h("th", { scope: "col" }, "Fund"), h("th", { scope: "col" }, "Days to expiry"), h("th", { scope: "col" }, "Implied volatility"))), h("tbody", null, rows));
    }

    function paintTerm() {
      const host = hosts.term;
      if (!host) return;
      if (M.state.state !== "ok") { host.replaceChildren(silentFor(M.state, say("title.term"), 150)); return; }
      if (termView === 1) {
        const st = M.futures.st;
        if (st.state !== "ok") { host.replaceChildren(silentFor(st, "Futures curve", 150)); return; }
        const part = M.futures.part;
        const roll = isNum(part.roll30);
        const line = roll === null ? null : say("futures.roll", { sign: roll < 0 ? MINUS : roll > 0 ? "+" : "", x: F.num(Math.abs(roll) * 100, false, 2) });
        const chartBox = h("div", { class: "vd-chart vd-fchart" });
        const read = h("p", { class: "vd-read", role: "status", "aria-live": "polite" }, line || DASH);
        host.replaceChildren(h("div", { class: "vd-term" }, chartBox, read));
        const draw = () => { const w = chartBox.clientWidth, hh = chartBox.clientHeight; if (w > 80 && hh > 60) chartBox.replaceChildren(futuresChart(part, w, hh)); };
        draw();
        watch(chartBox, draw);
        return;
      }
      const head = termHead();
      const box = h("div", { class: "vd-chart", tabindex: "0", role: "group", "aria-label": say("title.term") + ": use the arrow keys to step through points" });
      const read = h("p", { class: "vd-read", role: "status", "aria-live": "polite" });
      host.replaceChildren(h("div", { class: "vd-term" }, head, box, read, termTable()));
      let hits = [];
      const rest = () => {
        const spy = M.term.funds.find((f) => f.state);
        read.textContent = spy ? say("state." + spy.state) : "";
      };
      const draw = () => {
        const w = box.clientWidth, hh = box.clientHeight;
        if (w < 80 || hh < 60) return;
        const c = termChart(M.term.funds, w, hh, active);
        hits = c.hits;
        box.replaceChildren(c.root);
      };
      const say1 = (hit) => `${hit.t}, ${hit.d} days: ${pct1(hit.iv)} implied.`;
      const pick = (s, i) => {
        active = { s, i };
        draw();
        const hit = hits.find((q) => q.s === s && q.i === i);
        read.textContent = hit ? say1(hit) : "";
      };
      box.addEventListener("pointermove", (ev) => {
        const r = box.getBoundingClientRect();
        const px = ev.clientX - r.left, py = ev.clientY - r.top;
        let best = null, bd = 24 * 24;
        for (const q of hits) { const d = (q.px - px) ** 2 + (q.py - py) ** 2; if (d < bd) { bd = d; best = q; } }
        if (best) pick(best.s, best.i);
      });
      box.addEventListener("pointerleave", () => { if (document.activeElement !== box) { active = null; draw(); rest(); } });
      box.addEventListener("keydown", (ev) => {
        const series = [...new Set(hits.map((q) => q.s))];
        if (!series.length) return;
        let cur = active || { s: series[0], i: 0 };
        const count = (s) => hits.filter((q) => q.s === s).length;
        if (ev.key === "ArrowRight") cur = { s: cur.s, i: Math.min(count(cur.s) - 1, cur.i + 1) };
        else if (ev.key === "ArrowLeft") cur = { s: cur.s, i: Math.max(0, cur.i - 1) };
        else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
          const at = series.indexOf(cur.s);
          const to = series[(at + (ev.key === "ArrowDown" ? 1 : -1) + series.length) % series.length];
          cur = { s: to, i: Math.min(cur.i, count(to) - 1) };
        } else if (ev.key === "Home") cur = { s: cur.s, i: 0 };
        else if (ev.key === "End") cur = { s: cur.s, i: count(cur.s) - 1 };
        else if (ev.key === "Escape") { active = null; draw(); rest(); return; }
        else return;
        ev.preventDefault();
        pick(cur.s, cur.i);
      });
      box.addEventListener("focus", () => { if (!active) { const s0 = hits.length ? hits[0].s : 0; pick(s0, 0); } });
      box.addEventListener("blur", () => { active = null; draw(); rest(); });
      draw();
      rest();
      watch(box, draw);
    }

    function watch(el, fn) {
      if (typeof ResizeObserver !== "function") return;
      const ro = new ResizeObserver(() => { if (!dead) fn(); });
      ro.observe(el);
      cleanup.push(() => ro.disconnect());
    }

    function paintIvrv() {
      const host = hosts.ivrv;
      if (!host) return;
      if (M.state.state !== "ok") { host.replaceChildren(silentFor(M.state, say("title.ivrv"), 120)); return; }
      const list = h("ul", { class: "vd-rows", role: "list" });
      for (const row of M.ivrv) list.append(ivrvRow(row));
      host.replaceChildren(list);
    }

    function why(row, what) {
      return row.status === "plan" ? "not on the feed plan" : row.status === "ok" ? "not returned" : what;
    }

    function ivrvRow(row) {
      const t = row.t;
      const li = h("li", { class: "vd-row", "data-t": t });
      const link = h("a", { class: "vd-t", href: "/flows/ticker/?t=" + encodeURIComponent(t) }, t);
      if (row.status !== "ok") {
        li.append(link, h("span", { class: "vd-fig" }, DASH, " ", h("span", { class: "vd-why" }, say("state.failed", { what: "implied and realised" }))));
        return li;
      }
      const stats = row.stats && row.stats.ivLow !== undefined ? row.stats : null;
      let bar;
      const tip = [];
      if (stats && isNum(stats.ivLow) !== null && isNum(stats.ivHigh) !== null) {
        const lo = Math.min(stats.ivLow, row.rv), hi = Math.max(stats.ivHigh, row.rv);
        const pos = (v) => ((v - lo) / (hi - lo || 1) * 100).toFixed(1) + "%";
        bar = h("span", { class: "vd-bar", role: "img", "aria-label": "Implied " + pct1(row.iv) + ", realised " + pct1(row.rv) + " on a 1-year implied range of " + pct1(stats.ivLow) + " to " + pct1(stats.ivHigh) },
          h("i", { class: "vd-range", style: { left: pos(stats.ivLow), width: ((stats.ivHigh - stats.ivLow) / (hi - lo || 1) * 100).toFixed(1) + "%" } }),
          h("i", { class: "vd-iv", style: { left: pos(row.iv) } }),
          h("i", { class: "vd-rv", style: { left: pos(row.rv) } }));
        if (isNum(stats.ivPlace) !== null) tip.push(say("ivrv.place", { p: F.num(stats.ivPlace * 100, false, 0) }));
      } else {
        bar = h("span", { class: "vd-bar vd-nobar" }, DASH, " ", h("span", { class: "vd-why" }, "no 1-year range"));
      }
      if (row.stale) tip.push(say("ivrv.stale", { date: F.day(row.asOf) }));
      const spread = isNum(row.spread);
      const fig = h("span", { class: "vd-fig", title: tip.join(" ") },
        h("span", null, "IV " + pct1(row.iv)), " · ", h("span", null, "RV " + pct1(row.rv)), " · ",
        h("b", { "data-tone": spread === null ? null : spread > 0 ? "pos" : spread < 0 ? "neg" : null }, spread === null ? DASH : sgn(spread, 1) + " pts"));
      li.append(link, bar, fig);
      if (tip.length) li.append(h("span", { class: "vd-sub" }, tip.join(" ")));
      return li;
    }

    function paintCorr() {
      const host = hosts.corr;
      if (!host) return;
      if (M.state.state !== "ok") { host.replaceChildren(silentFor(M.state, say("title.matrix"), 150)); return; }
      const key = ["3M", "1Y"][corrWin];
      const mx = M.matrix && M.matrix[key];
      if (!mx || (mx.status !== "ok")) {
        host.replaceChildren(silentFor(!mx ? { state: "pending", reason: say("state.pending") } : mx.status === "shed" ? { state: "withheld", reason: "Left out to keep the payload within its size." } : mx.status === "plan" ? { state: "plan", reason: say("futures.plan") } : { state: "unavailable", reason: say("state.failed", { what: "correlation" }) }, say("title.matrix"), 150));
        return;
      }
      const tk = M.matrix.tickers;
      const n = tk.length;
      const cellAt = (i, j) => {
        const a = Math.min(i, j), b = Math.max(i, j);
        return mx.cells[a * n - (a * (a + 1)) / 2 + (b - a - 1)];
      };
      let strongest = null;
      for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) {
        const c = cellAt(j, i);
        if (c && c[0] !== null && (!strongest || Math.abs(c[0]) > Math.abs(strongest.r))) strongest = { i, j, r: c[0] };
      }
      let cur = strongest ? { i: strongest.i, j: strongest.j } : { i: 1, j: 0 };
      const box = h("div", { class: "vd-mx" });
      const read = h("p", { class: "vd-read", role: "status", "aria-live": "polite" });
      const foot = h("p", { class: "vd-foot" });
      const tbtn = h("button", { type: "button", class: "vd-btn vd-tb", "aria-haspopup": "dialog" }, "Table");
      const cmod = host.closest(".mk-mod");
      const chead = cmod ? cmod.querySelector(":scope > .ui-mod-h") : null;
      if (chead) { for (const old of chead.querySelectorAll(".vd-tb")) old.remove(); chead.append(tbtn); }
      const dlg = h("dialog", { class: "nm-dlg vd-dlg", "aria-labelledby": "vdDlgT" });
      const corr = h("div", { class: "vd-corr" }, box, h("div", { class: "vd-side" }, read, foot), dlg);
      host.replaceChildren(corr);
      if (!chead) host.append(tbtn);
      const sentence = (i, j) => {
        const c = cellAt(j, i);
        const a = tk[i], b = tk[j];
        if (!c || c[0] === null) return a + " and " + b + ": " + (c && c[2] === "asym" ? say("matrix.asym") : say("matrix.absent"));
        return say("matrix.cell", { a, b, r: r2(c[0]), rows: F.int(c[1]), from: mx.minDate ? F.day(mx.minDate) : DASH, to: mx.maxDate ? F.day(mx.maxDate) : DASH });
      };
      const restText = () => (strongest ? sentence(strongest.i, strongest.j) : "");
      const footText = () => {
        const parts = [mx.sectorAvg === null ? say("matrix.few") : say("matrix.avg", { r: r2(mx.sectorAvg), n: mx.sectorN })];
        if (M.site && isNum(M.site.implied) !== null) parts.push(say("matrix.site", { i: r2(M.site.implied), r: isNum(M.site.realized21) === null ? DASH : r2(M.site.realized21) }));
        return parts.join(" ");
      };
      foot.textContent = footText();
      const draw = () => {
        const wide = host.clientWidth > 1.5 * host.clientHeight;
        if (corr.dataset.wide !== (wide ? "1" : "0")) corr.dataset.wide = wide ? "1" : "0";
        const W = box.clientWidth, H = box.clientHeight;
        if (W < 120 || H < 100) return;
        const lay = matrixLayout(W, H, n);
        const root = svg("svg", { class: "vd-mxs", width: lay.W, height: lay.H, viewBox: `0 0 ${lay.W} ${lay.H}`, role: "grid", "aria-label": say("title.matrix") + " " + key });
        const g0 = lay.gutter, c = lay.cell;
        for (let i = 0; i < n; i++) {
          root.append(svg("text", { x: g0 - 5, y: i * c + c / 2 + 3, class: "vd-ax" + (c < 14 ? " vd-sm" : ""), "text-anchor": "end" }, document.createTextNode(tk[i])));
          root.append(svg("text", { x: g0 + i * c + c / 2 + 3, y: n * c + 6, class: "vd-ax" + (c < 14 ? " vd-sm" : ""), transform: `rotate(-90 ${g0 + i * c + c / 2 + 3} ${n * c + 6})`, "text-anchor": "end" }, document.createTextNode(tk[i])));
        }
        for (let i = 0; i < n; i++) {
          const row = svg("g", { role: "row" });
          for (let j = 0; j <= i; j++) {
            const x = g0 + j * c, y = i * c;
            if (j === i) { row.append(svg("rect", { x, y, width: c, height: c, class: "vd-self", role: "gridcell", "aria-label": tk[i] + ", self" })); continue; }
            const cell = cellAt(j, i);
            const isActive = cur.i === i && cur.j === j;
            const attrs = { x, y, width: c, height: c, role: "gridcell", tabindex: isActive ? "0" : "-1", "data-i": i, "data-j": j, "aria-label": sentence(i, j) };
            if (!cell || cell[0] === null) row.append(svg("rect", { ...attrs, class: "vd-cell vd-null" }));
            else {
              const r = cell[0];
              row.append(svg("rect", { ...attrs, class: "vd-cell vd-b" + (r < 0 ? 0 : bandOf(r)) + (r < 0 ? " vd-neg" : "") }));
              if (r < 0) row.append(svg("rect", { x, y, width: c, height: c, fill: "url(#vdHatch)", class: "vd-hs", "pointer-events": "none" }));
              if (c >= CELL_PRINT) row.append(svg("text", { x: x + c / 2, y: y + c / 2 + 3.5, class: "vd-val vd-vb" + (r < 0 ? 0 : bandOf(r)), "text-anchor": "middle", "pointer-events": "none" }, document.createTextNode(r2(r))));
            }
          }
          root.append(row);
        }
        root.append(svg("line", { x1: g0, x2: g0 + 4 * c, y1: 4 * c, y2: 4 * c, class: "vd-div" }));
        root.append(svg("line", { x1: g0 + 4 * c, x2: g0 + 4 * c, y1: 4 * c, y2: n * c, class: "vd-div" }));
        box.replaceChildren(root);
        if (box.dataset.focus === "1") { const a = root.querySelector('[tabindex="0"]'); if (a) a.focus({ preventScroll: true }); }
      };
      const say2 = (i, j) => { read.textContent = sentence(i, j); };
      const move = (i, j) => { cur = { i, j }; draw(); say2(i, j); };
      box.addEventListener("pointerover", (ev) => {
        const r = ev.target.closest && ev.target.closest(".vd-cell");
        if (r) say2(Number(r.dataset.i), Number(r.dataset.j));
      });
      box.addEventListener("pointerleave", () => { if (!box.contains(document.activeElement)) read.textContent = restText(); });
      box.addEventListener("focusin", () => { box.dataset.focus = "1"; say2(cur.i, cur.j); });
      box.addEventListener("focusout", (ev) => { if (!box.contains(ev.relatedTarget)) { box.dataset.focus = "0"; read.textContent = restText(); } });
      box.addEventListener("keydown", (ev) => {
        let { i, j } = cur;
        if (ev.key === "ArrowLeft") j = Math.max(0, j - 1);
        else if (ev.key === "ArrowRight") j = Math.min(i - 1, j + 1);
        else if (ev.key === "ArrowUp") { if (i > 1) { i -= 1; j = Math.min(j, i - 1); } }
        else if (ev.key === "ArrowDown") { if (i < n - 1) i += 1; }
        else if (ev.key === "Home") j = 0;
        else if (ev.key === "End") j = i - 1;
        else if (ev.key === "Escape") { read.textContent = restText(); if (strongest) { cur = { i: strongest.i, j: strongest.j }; draw(); } return; }
        else return;
        ev.preventDefault();
        move(i, j);
      });
      tbtn.addEventListener("click", () => {
        const head = h("tr", null, h("th", { scope: "col" }, ""), tk.map((t) => h("th", { scope: "col" }, t)));
        const body = tk.map((a, i) => h("tr", null, h("th", { scope: "row" }, a), tk.map((b, j) => {
          if (i === j) return h("td", null, "self");
          const c = cellAt(i, j);
          return h("td", { class: "c-num" }, c && c[0] !== null ? r2(c[0]) : DASH);
        })));
        dlg.replaceChildren(h("div", { class: "nm-dg" }, h("h3", { id: "vdDlgT" }, say("title.matrix") + " " + key),
          h("p", null, mx.minDate ? "Window " + F.day(mx.minDate) + " to " + F.day(mx.maxDate) + "." : ""),
          h("div", { class: "nm-dtw" }, h("table", { class: "nm-tbl vd-tbl" }, h("thead", null, head), h("tbody", null, body))),
          h("div", { class: "nm-dx" }, h("button", { type: "button", class: "nm-link", onclick: () => { dlg.close(); tbtn.focus(); } }, "Close"))));
        if (typeof dlg.showModal === "function") dlg.showModal();
      });
      read.textContent = restText();
      draw();
      watch(box, draw);
      watch(host, draw);
    }

    function charRow(t, label, detail) {
      return h("div", { class: "vd-li" }, h("dt", null, h("a", { class: "vd-t", href: "/flows/ticker/?t=" + encodeURIComponent(t) }, t)), h("dd", null, h("span", { class: "vd-l" }, label), detail ? h("span", { class: "vd-n" }, detail) : null));
    }

    function charList(title, rows, cls) {
      const dl = h("dl", { class: "vd-dl " + cls, "aria-label": title });
      for (const [t, label, hl, hu] of rows) dl.append(charRow(t, label, "half-life " + F.num(hl, false, 1) + " sessions · Hurst " + F.px(hu, 2)));
      return h("section", { class: "vd-blk", "aria-label": title }, h("h3", { class: "vd-h" }, title), dl);
    }

    function fitChar(host) {
      const mod = host.closest(".mk-mod");
      const head = mod ? mod.querySelector(":scope > .ui-mod-h") : null;
      const all = [...host.querySelectorAll(".vd-li")];
      for (const r of all) r.hidden = false;
      const over = () => host.scrollHeight - host.clientHeight;
      let hid = 0, guard = 90;
      const vis = (sel) => [...host.querySelectorAll(sel + " .vd-li")].filter((r) => !r.hidden);
      const foot = host.querySelector(":scope > .vd-char > .vd-foot");
      const mvBlock = host.querySelector(".vd-movers");
      if (foot) foot.hidden = false;
      if (mvBlock) mvBlock.hidden = false;
      const drop = (list) => { list[list.length - 1].hidden = true; hid++; };
      while (over() > 1 && guard-- > 0) {
        const mv = vis(".vd-mv"), a = vis(".vd-a"), b = vis(".vd-b");
        const big = a.length >= b.length ? a : b;
        if (big.length > 3) drop(big);
        else if (mv.length > 1) drop(mv);
        else if (foot && !foot.hidden) { foot.hidden = true; hid++; }
        else if (big.length > 2) drop(big);
        else if (mv.length) drop(mv);
        else if (mvBlock && !mvBlock.hidden && host.querySelector(".vd-mv .vd-li")) { mvBlock.hidden = true; hid++; }
        else break;
      }
      if (mvBlock && !mvBlock.hidden && host.querySelector(".vd-mv .vd-li") && !vis(".vd-mv").length) mvBlock.hidden = true;
      let btn = head ? head.querySelector(":scope > .vd-all") : null;
      if (hid && head) {
        if (!btn) {
          btn = h("button", { type: "button", class: "vd-btn vd-all", "aria-haspopup": "dialog" }, "Show all");
          btn.addEventListener("click", () => {
            const copy = host.cloneNode(true);
            for (const r of copy.querySelectorAll("[hidden]")) r.hidden = false;
            const dlg = h("dialog", { class: "nm-dlg vd-dlg", "aria-labelledby": "vdAllT" }, h("div", { class: "nm-dg" }, h("h3", { id: "vdAllT" }, say("title.character")), h("div", { class: "nm-dtw" }, copy),
              h("div", { class: "nm-dx" }, h("button", { type: "button", class: "nm-link", onclick: () => { dlg.close(); dlg.remove(); btn.focus(); } }, "Close"))));
            document.body.append(dlg);
            dlg.addEventListener("close", () => dlg.remove());
            if (typeof dlg.showModal === "function") dlg.showModal();
          });
          head.append(btn);
        }
        btn.hidden = false;
      } else if (btn) btn.hidden = true;
    }

    function paintChar() {
      const host = hosts.char;
      if (!host) return;
      if (M.state.state !== "ok") { host.replaceChildren(silentFor(M.state, say("title.character"), 150)); return; }
      const st = M.character.st;
      if (st.state !== "ok") { host.replaceChildren(silentFor(st, say("title.character"), 150)); return; }
      const c = M.character.part;
      const kids = [h("div", { class: "vd-two" }, charList("Reverting fastest", c.meanRev || [], "vd-a"), charList("Most persistent", c.persistent || [], "vd-b"))];
      if (Array.isArray(c.movers)) {
        const dl = h("dl", { class: "vd-dl vd-mv", "aria-label": "Changed since last session" });
        for (const [t, label, prevLabel, hl, phl, kind] of c.movers) {
          dl.append(charRow(t, kind === "label" ? prevLabel + " → " + label : "half-life " + F.num(phl, false, 1) + " → " + F.num(hl, false, 1) + " sessions", null));
        }
        kids.push(h("section", { class: "vd-blk vd-movers", "aria-label": "Changed since last session" }, h("h3", { class: "vd-h" }, "Changed since last session"), c.movers.length ? dl : h("p", { class: "vd-none" }, "No name crossed the line.")));
      } else {
        kids.push(h("section", { class: "vd-blk vd-movers" }, h("h3", { class: "vd-h" }, "Changed since last session"), h("p", { class: "vd-none" }, say("character.first"))));
      }
      kids.push(h("p", { class: "vd-foot" }, say("character.def") + " " + say("character.hurst")));
      host.replaceChildren(h("div", { class: "vd-char" }, kids));
      const run = () => { if (!dead) fitChar(host); };
      run();
      watch(host, run);
    }

    function paintSeg() {
      if (hosts.termSeg && !hosts.termSeg.firstChild && typeof UI.segmented === "function" && M.state.state === "ok") {
        hosts.termSeg.append(UI.segmented("Term structure view", [{ label: "Index funds" }, { label: "Futures" }], (i) => { termView = i; active = null; paintTerm(); }, 0));
      }
      if (hosts.corrSeg && !hosts.corrSeg.firstChild && typeof UI.segmented === "function" && M.state.state === "ok") {
        hosts.corrSeg.append(UI.segmented("Correlation window", [{ label: "3M" }, { label: "1Y" }], (i) => { corrWin = i; paintCorr(); }, 0));
      }
    }

    paintSeg();
    paintTerm();
    paintIvrv();
    paintCorr();
    paintChar();

    const api = {
      model: () => M,
      setTerm(i) { termView = i === 1 ? 1 : 0; active = null; paintTerm(); return termView; },
      setWindow(i) { corrWin = i === 1 ? 1 : 0; paintCorr(); return corrWin; },
      destroy() { dead = true; for (const f of cleanup) f(); MOUNTS.delete(hosts.term); },
    };
    if (hosts.term) MOUNTS.set(hosts.term, api);
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, {
    volDesk: Object.freeze({ mount, model, ready, copy: COPY, termChart, matrixLayout, bandOf, of: (el) => MOUNTS.get(el) || null }),
  }));
})();
