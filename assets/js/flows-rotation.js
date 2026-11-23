(() => {
  "use strict";
  const QUADS = ["Above norm, gaining", "Above norm, losing", "Below norm, losing", "Below norm, gaining"];
  const SVG = "http://www.w3.org/2000/svg";
  const MINUS = "−", DASH = "—";
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const quadOf = (p) => (p[0] >= 0 ? (p[1] >= 0 ? 0 : 1) : (p[1] >= 0 ? 3 : 2));
  const signed = (v, dp = 2) => (v === null || v === undefined || !Number.isFinite(v) ? DASH : (v < 0 ? MINUS : v > 0 ? "+" : "") + Math.abs(v).toFixed(dp));
  const dayLabel = (d) => {
    const x = new Date(d + "T00:00:00Z");
    return `${DOW[x.getUTCDay()]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
  };
  const niceStep = (raw) => {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  };
  const rangeOf = (funds, axis) => {
    let m = 0;
    for (const f of funds) for (const tail of Object.values(f.tails)) for (const p of tail) if (p) m = Math.max(m, Math.abs(p[axis]));
    if (!(m > 0)) return { max: 1, step: 0.5 };
    const step = niceStep(m / 3);
    return { max: Math.ceil((m * 1.08) / step) * step, step };
  };
  const stateAt = (f, convs, week) => {
    const quads = convs.map((c) => { const p = f.tails[c.norm + "|" + c.vel][week]; return p ? quadOf(p) : null; });
    return { quads, held: quads.filter((q) => q !== null).length, robust: quads[0] !== null && quads.every((q) => q === quads[0]) };
  };
  const agree = (st, q) => st.quads.filter((x) => x === q).length;

  if (typeof document === "undefined") {
    globalThis.__RotationTest = { QUADS, quadOf, signed, dayLabel, niceStep, rangeOf, stateAt, agree };
    return;
  }

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const sv = (tag, attrs, text) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; };

  const S = { data: null, norm: null, vel: null, week: 0, sel: null };
  const status = $("rtStatus"), plot = $("rtPlot"), list = $("rtList"), card = $("rtCard"), stage = $("rtStage");

  const key = () => S.norm + "|" + S.vel;
  const pointOf = (f) => f.tails[key()][S.week];

  function message(host, text, retry) {
    host.replaceChildren();
    const box = el("div", "rt-empty");
    box.append(el("span", "", text));
    if (retry) { const b = el("button", "rt-retry", "Retry"); b.type = "button"; b.addEventListener("click", load); box.append(b); }
    host.append(box);
  }

  function whole(text, retry) {
    status.textContent = text;
    $("rtStamp").textContent = "";
    message(plot, text, retry);
    list.replaceChildren();
    card.replaceChildren();
    $("rtFoot").replaceChildren();
  }

  function seg(host, values, current, label, pick) {
    host.replaceChildren();
    for (const v of values) {
      const b = el("button", "", label(v));
      b.type = "button";
      b.dataset.v = String(v);
      b.setAttribute("aria-pressed", String(v === current));
      b.addEventListener("click", () => pick(v));
      host.append(b);
    }
  }

  function controls() {
    const d = S.data;
    const norms = [...new Set(d.conventions.map((c) => c.norm))], vels = [...new Set(d.conventions.map((c) => c.vel))];
    seg($("rtNorm"), norms, S.norm, (v) => v + " sessions", (v) => { S.norm = v; paint(); });
    seg($("rtVel"), vels, S.vel, (v) => v + " sessions", (v) => { S.vel = v; paint(); });
    const r = $("rtWeek");
    r.max = String(d.weeks.length - 1);
    r.value = String(S.week);
    $("rtPrev").disabled = S.week <= 0;
    $("rtNext").disabled = S.week >= d.weeks.length - 1;
    $("rtWkT").textContent = dayLabel(d.weeks[S.week]);
  }

  function drawPlane() {
    const d = S.data;
    plot.replaceChildren();
    const W = plot.clientWidth - 16, H = plot.clientHeight;
    if (W < 120 || H < 120) return;
    const mL = 46, mR = 14, mT = 14, mB = 34;
    const rx = rangeOf(d.funds, 0), ry = rangeOf(d.funds, 1);
    const X = (v) => mL + ((v + rx.max) / (2 * rx.max)) * (W - mL - mR);
    const Y = (v) => mT + ((ry.max - v) / (2 * ry.max)) * (H - mT - mB);
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": `Rotation plane, week ending ${dayLabel(d.weeks[S.week])}` });
    for (let v = -rx.max; v <= rx.max + 1e-9; v += rx.step) {
      const zero = Math.abs(v) < 1e-9;
      svg.append(sv("line", { class: zero ? "rt-ax" : "rt-grid", x1: X(v), x2: X(v), y1: mT, y2: H - mB }));
      svg.append(sv("text", { class: "rt-tick", x: X(v), y: H - mB + 14, "text-anchor": "middle" }, signed(v, rx.step < 1 ? 1 : 0)));
    }
    for (let v = -ry.max; v <= ry.max + 1e-9; v += ry.step) {
      const zero = Math.abs(v) < 1e-9;
      svg.append(sv("line", { class: zero ? "rt-ax" : "rt-grid", x1: mL, x2: W - mR, y1: Y(v), y2: Y(v) }));
      svg.append(sv("text", { class: "rt-tick", x: mL - 6, y: Y(v) + 4, "text-anchor": "end" }, signed(v, ry.step < 1 ? 1 : 0)));
    }
    svg.append(sv("text", { class: "rt-at", x: W - mR, y: H - 4, "text-anchor": "end" }, "Gap from its own norm, log %"));
    svg.append(sv("text", { class: "rt-at", x: mL, y: 10 }, "Change of the gap per 5 sessions, log %"));
    const corners = [[W - mR - 6, mT + 16, "end"], [W - mR - 6, H - mB - 8, "end"], [mL + 6, H - mB - 8, "start"], [mL + 6, mT + 16, "start"]];
    QUADS.forEach((q, i) => svg.append(sv("text", { class: "rt-qn", x: corners[i][0], y: corners[i][1] + (i === 0 || i === 3 ? 6 : 0), "text-anchor": corners[i][2] }, q)));
    const placed = [];
    const dots = [];
    for (const f of d.funds) {
      const tail = f.tails[key()].slice(0, S.week + 1).filter(Boolean);
      const p = pointOf(f);
      if (!p) continue;
      if (tail.length > 1) {
        svg.append(sv("polyline", { class: "rt-tail" + (S.sel === f.t ? " sel" : ""), points: tail.map((q) => X(q[0]).toFixed(1) + "," + Y(q[1]).toFixed(1)).join(" "), "data-t": f.t }));
        tail.slice(0, -1).forEach((q) => svg.append(sv("circle", { class: "rt-tp", cx: X(q[0]), cy: Y(q[1]), r: 1.8 })));
      }
      dots.push({ f, p, x: X(p[0]), y: Y(p[1]) });
    }
    for (const o of dots) {
      const st = stateAt(o.f, d.conventions, S.week);
      const q = quadOf(o.p);
      const g = sv("g", { class: "rt-dot", role: "button", tabindex: "0", "data-t": o.f.t, "data-q": String(q), "data-robust": st.robust ? "1" : "0", "aria-pressed": String(S.sel === o.f.t),
        "aria-label": `${o.f.t}, ${st.robust ? QUADS[q] : "depends on the window"}, gap ${signed(o.p[0])}, change ${signed(o.p[1])}` });
      g.append(sv("circle", { cx: o.x, cy: o.y, r: 6.5 }));
      g.addEventListener("click", () => select(o.f.t, true));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(o.f.t, true); } });
      svg.append(g);
    }
    for (const o of dots.slice().sort((a, b) => (a.f.t === S.sel ? -1 : b.f.t === S.sel ? 1 : 0))) {
      const w = o.f.t.length * 7.4 + 4, h = 14;
      const tries = [[o.x + 10, o.y + 4], [o.x - 10 - w, o.y + 4], [o.x - w / 2, o.y - 11], [o.x - w / 2, o.y + 21]];
      for (const [lx, ly] of tries) {
        const box = { x0: lx, y0: ly - h + 2, x1: lx + w, y1: ly + 2 };
        if (box.x0 < mL || box.x1 > W - mR || box.y0 < mT || box.y1 > H - mB) continue;
        if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
        if (dots.some((q) => q !== o && q.x + 7 > box.x0 && q.x - 7 < box.x1 && q.y + 7 > box.y0 && q.y - 7 < box.y1)) continue;
        placed.push(box);
        svg.append(sv("text", { class: "rt-lab", x: lx + 2, y: ly, "data-t": o.f.t }, o.f.t));
        break;
      }
    }
    plot.append(svg);
  }

  function drawList() {
    const d = S.data;
    list.replaceChildren();
    const head = el("div", "rt-lh");
    head.append(el("h2", "", "Funds"), el("span", "note", `${d.funds.length} drawn` + (d.absent.length ? `, ${d.absent.length} set aside` : "")));
    const rows = el("div", "rt-rows");
    const h = el("div", "rt-row h");
    h.append(el("span", "", "Fund"), el("span", "", "State"), el("span", "n", "Gap"), el("span", "n", "Change"));
    rows.append(h);
    const order = d.funds.slice().sort((a, b) => { const pa = pointOf(a), pb = pointOf(b); return (pb ? pb[0] : -Infinity) - (pa ? pa[0] : -Infinity); });
    for (const f of order) {
      const p = pointOf(f);
      const st = stateAt(f, d.conventions, S.week);
      const b = el("button", "rt-row");
      b.type = "button";
      b.dataset.t = f.t;
      b.setAttribute("aria-pressed", String(S.sel === f.t));
      const x = el("span", "n " + (p && p[0] > 0 ? "rt-up" : p && p[0] < 0 ? "rt-down" : ""), p ? signed(p[0]) : DASH);
      const y = el("span", "n " + (p && p[1] > 0 ? "rt-up" : p && p[1] < 0 ? "rt-down" : ""), p ? signed(p[1]) : DASH);
      b.append(el("b", "", f.t), el("span", "q", !p ? "Not drawn this week" : st.robust ? QUADS[st.quads[0]] : "Depends on the window"), x, y);
      b.addEventListener("click", () => select(f.t, true));
      rows.append(b);
    }
    for (const a of d.absent) {
      const r = el("div", "rt-row abs");
      r.dataset.t = a.t;
      r.append(el("b", "", a.t), el("span", "q", DASH + " " + a.say));
      r.title = a.say;
      rows.append(r);
    }
    list.append(head, rows);
  }

  function drawCard() {
    const d = S.data;
    card.replaceChildren();
    const f = d.funds.find((x) => x.t === S.sel);
    if (!f) { message(card, "Select a fund on the plane or in the list."); return; }
    const p = pointOf(f);
    const st = stateAt(f, d.conventions, S.week);
    const q = p ? quadOf(p) : null;
    card.append(el("h2", "", f.t), el("div", "sub", `${f.group} · week ending ${dayLabel(d.weeks[S.week])}`));
    const state = el("div", "state");
    state.id = "rtState";
    state.textContent = !p ? "Not drawn this week." : st.robust ? QUADS[q] + "." : `Depends on the window: ${QUADS[q]} here, under ${agree(st, q)} of ${d.conventions.length} windows.`;
    card.append(state);
    const kv = el("dl", "rt-kv");
    const add = (k, v) => { kv.append(el("dt", "", k), el("dd", "", v)); };
    add("Gap from its own norm", p ? signed(p[0]) + " log %" : DASH);
    add("Change of the gap per 5 sessions", p ? signed(p[1]) + " log %" : DASH);
    add("Windows that agree", p ? `${agree(st, q)} of ${d.conventions.length}` : DASH);
    add(`Last stored close, ${dayLabel(d.asOf)}`, typeof f.close === "number" ? f.close.toFixed(2) : DASH);
    card.append(kv);
    const a = el("a", "link", `Open ${f.t}`);
    a.href = "/flows/ticker/?t=" + encodeURIComponent(f.t);
    card.append(a);
  }

  function foot() {
    const host = $("rtFoot");
    host.replaceChildren();
    const k = (cls, text) => { const s = el("span", "k"); s.append(el("i", cls), el("span", "", text)); return s; };
    host.append(k("", "Same state under every window"), k("h", "Depends on the window"), k("t", "Weekly path"), el("span", "", "Flows lens: " + DASH + " flow history not stored yet."));
  }

  function paint() {
    const d = S.data;
    controls();
    drawPlane();
    drawList();
    drawCard();
    foot();
    const b = document.createElement("b");
    b.textContent = dayLabel(d.asOf);
    $("rtStamp").replaceChildren("Closes through ", b, ` · ${d.sessions} sessions · ${d.funds.length} funds`);
    status.textContent = `Rotation plane for the week ending ${dayLabel(d.weeks[S.week])}, ${d.funds.length} funds.`;
  }

  function select(t, show) {
    S.sel = t;
    paint();
    if (show && window.matchMedia("(max-width: 899px)").matches) view("detail");
    const again = plot.querySelector(`.rt-dot[data-t="${t}"]`);
    if (again && document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("rt-dot")) again.focus();
  }

  function view(v) {
    stage.dataset.view = v;
    for (const b of $("rtSeg3").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.v === v));
    if (v === "plane" && S.data) drawPlane();
  }

  async function load() {
    whole("Loading the stored closes…", false);
    let res;
    try { res = await fetch("/api/flows/rotation", { credentials: "same-origin" }); } catch { return whole("The stored closes could not be read. Try again.", true); }
    if (res.status === 404) return whole("Rotation is switched off.", false);
    if (!res.ok) return whole("The stored closes could not be read. Try again.", true);
    let d;
    try { d = await res.json(); } catch { return whole("The stored closes could not be read. Try again.", true); }
    if (!d || d.status !== "ok" || !Array.isArray(d.funds) || !d.funds.length) {
      return whole(d && d.why === "short_history" ? "Too few sessions are stored to draw the plane yet." : "Too few funds have stored closes to draw the plane.", false);
    }
    S.data = d;
    S.norm = d.conventions[0].norm;
    S.vel = d.conventions[0].vel;
    S.week = d.weeks.length - 1;
    const far = d.funds.slice().sort((a, b) => Math.abs((pointOf(b) || [0])[0]) - Math.abs((pointOf(a) || [0])[0]))[0];
    S.sel = far.t;
    paint();
  }

  $("rtWeek").addEventListener("input", (e) => { S.week = Number(e.target.value); paint(); });
  $("rtPrev").addEventListener("click", () => { if (S.week > 0) { S.week--; paint(); } });
  $("rtNext").addEventListener("click", () => { if (S.data && S.week < S.data.weeks.length - 1) { S.week++; paint(); } });
  for (const b of $("rtSeg3").querySelectorAll("button")) b.addEventListener("click", () => view(b.dataset.v));
  const dlg = $("rtInfoDlg");
  $("rtInfoBtn").addEventListener("click", () => {
    const body = $("rtInfoB");
    if (!body.childElementCount) {
      for (const t of [
        "Each dot is a fund. Its price is compared with the other funds drawn, so the plane shows who is ahead of the group and who is behind, never the market's direction.",
        "Across is the gap between that relative price and its own norm, a weighted average of earlier sessions. Up is how much the gap changed over five sessions.",
        "The norm can be a half-life of 126 or 63 sessions and the change can be measured over 10, 5 or 21. A dot is filled only when every one of those six windows gives the same state; a hollow dot depends on the window.",
        "The path behind a dot is its last weeks. Figures come from stored daily closes only. The money-flow lens is not drawn because no flow history is stored yet.",
        "This page shows states, not a forecast.",
      ]) body.append(el("p", "", t));
    }
    dlg.showModal();
  });
  $("rtInfoX").addEventListener("click", () => dlg.close());
  let raf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (S.data) drawPlane(); }); }).observe(plot);
  load();
})();
