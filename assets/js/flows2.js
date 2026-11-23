(() => {
  "use strict";
  const DASH = "—";
  const SVG = "http://www.w3.org/2000/svg";
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const sumOr = (a, b) => (num(a) === null || num(b) === null ? null : a + b);
  const tidePath = (points) => {
    const out = [];
    for (const p of Array.isArray(points) ? points : []) {
      const c = num(p && p.callPrem), q = num(p && p.putPrem), at = p && typeof p.t === "string" ? Date.parse(p.t) : NaN;
      if (c === null || q === null || !Number.isFinite(at)) continue;
      out.push({ at, v: c - q });
    }
    return out.sort((a, b) => a.at - b.at);
  };
  const topAlerts = (rows, n) => (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.t === "string" && num(r.prem) !== null && r.prem > 0).slice().sort((a, b) => b.prem - a.prem).slice(0, n);
  const sideOf = (r) => {
    const a = num(r.askPrem), b = num(r.bidPrem);
    if (a === null || b === null || a === b) return "Unsided";
    return a > b ? "Ask side" : "Bid side";
  };
  const sectorRows = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.sector === "string" && r.status === "ok" && num(r.net) !== null).slice().sort((a, b) => b.net - a.net);
  const nextEvents = (rows, n) => (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(r.d))).slice().sort((a, b) => (a.d === b.d ? (a.t < b.t ? -1 : 1) : a.d < b.d ? -1 : 1)).slice(0, n);

  if (typeof document === "undefined") {
    globalThis.__Flows2Test = { tidePath, topAlerts, sideOf, sectorRows, nextEvents, sumOr };
    return;
  }

  const F = window.FlowsUI.F;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const sv = (tag, attrs, text) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; };
  const money = (v, signed) => (num(v) === null ? DASH : F.money(v, Boolean(signed)));
  const pct = (v, dp, signed) => (num(v) === null ? DASH : F.pct(v, dp, Boolean(signed)));
  const tone = (v) => (num(v) === null || v === 0 ? "" : v > 0 ? " f2-up" : " f2-down");
  const tickerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(t);

  const state = { done: 0, failed: 0 };
  const PANES = {};

  function say(host, text, retry) {
    host.replaceChildren();
    const box = el("div", "f2-empty");
    box.append(el("span", "", text));
    if (retry) { const b = el("button", "f2-retry", "Retry"); b.type = "button"; b.addEventListener("click", retry); box.append(b); }
    host.append(box);
  }

  async function read(path) {
    const res = await fetch(path, { credentials: "same-origin" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  function pane(ids, path, draw) {
    const hosts = ids.map((id) => $("f2" + id));
    const run = async () => {
      hosts.forEach((h) => say(h, "Loading…"));
      let body;
      try { body = await read(path); } catch { state.failed++; hosts.forEach((h) => say(h, "This could not be read. Try again.", run)); settle(); return; }
      if (!body || body.status === "pending") hosts.forEach((h) => say(h, "Not published yet for this session."));
      else draw(body, hosts);
      fit();
      settle();
    };
    PANES[path] = run;
    return run();
  }

  function settle() {
    state.done++;
    if (state.done >= Object.keys(PANES).length) {
      $("f2").dataset.ready = "1";
      $("f2Status").textContent = state.failed ? "The session is shown; some panels could not be read." : "The session is shown.";
    }
  }

  function fit() {
    for (const box of document.querySelectorAll("#f2Grid .f2-rows")) {
      const rows = [...box.children];
      rows.forEach((r) => { r.hidden = false; });
      const more = box.parentElement.querySelector(":scope > .f2-more");
      if (more) more.remove();
      if (box.offsetParent === null) continue;
      let shown = rows.length;
      while (shown > 1 && box.scrollHeight > box.clientHeight + 1) rows[--shown].hidden = true;
      if (shown < rows.length) {
        const note = el("div", "f2-note f2-more", `Showing ${shown} of ${rows.length}`);
        box.after(note);
        while (shown > 1 && box.scrollHeight > box.clientHeight + 1) { rows[--shown].hidden = true; note.textContent = `Showing ${shown} of ${rows.length}`; }
      }
    }
  }
  let fitRaf = 0;
  const refit = () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fit); };

  const stat = (k, v, cls) => { const d = el("div"); d.append(el("dt", "", k), el("dd", cls || "", v)); return d; };

  function drawMarket(m, [hero, vol]) {
    const s = m.session || {};
    const st = s.stocks || {}, fu = s.funds || null;
    const calls = fu ? sumOr(st.calls, fu.calls) : num(st.calls), puts = fu ? sumOr(st.puts, fu.puts) : num(st.puts);
    hero.replaceChildren();
    hero.append(el("div", "f2-hero", money(s.total)));
    const dl = el("dl", "f2-stats");
    dl.append(stat("Calls", money(calls)), stat("Puts", money(puts)),
      stat("Net premium, screened", money(m.premium && m.premium.net, true), tone(m.premium && m.premium.net).trim()),
      stat("Leaning up / down", m.breadth && num(m.breadth.bull) !== null && num(m.breadth.bear) !== null ? m.breadth.bull + " / " + m.breadth.bear : DASH),
      stat("Put to call, premium", m.pcr && num(m.pcr.premium) !== null ? F.px(m.pcr.premium, 2) : DASH));
    hero.append(dl);
    hero.append(el("div", "f2-note", fu ? `${st.n} screened names and ${fu.n} of ${fu.of} funds and index options` : `${num(st.n) === null ? DASH : st.n} screened names; funds not read`));
    if (typeof m.sessionDate === "string") { const b = document.createElement("b"); b.textContent = F.day(m.sessionDate); $("f2Stamp").replaceChildren("Session ", b, m.generatedAt ? " · written " + F.time(m.generatedAt) : ""); }
    vol.replaceChildren();
    const v = m.vol || {};
    const a = el("div", "f2-big", pct(v.iv30dMedian, 1)); a.append(el("small", "", "median 30-day implied"));
    const b = el("div", "f2-big", pct(v.ivRankMedian, 0)); b.append(el("small", "", "median IV rank"));
    vol.append(a, b, el("div", "f2-note", num(v.iv30dQuoted) === null ? DASH + " names quoted" : `${v.iv30dQuoted} names quoted`));
  }

  function drawTide(p, [host]) {
    const t = p.tide;
    if (!t || t.status !== "ok") return say(host, "The tide was not published for this session.");
    const pts = tidePath(t.points);
    if (pts.length < 2) return say(host, "Too few readings to draw the tide.");
    host.replaceChildren();
    const last = pts[pts.length - 1];
    const head = el("div", "f2-big" + tone(last.v), money(last.v, true)); head.append(el("small", "", "net, through " + F.time(last.at)));
    const plot = el("div", "f2-plot");
    host.append(head, plot);
    const draw = () => {
      plot.replaceChildren();
      const W = plot.clientWidth, H = plot.clientHeight;
      if (W < 60 || H < 40) return;
      const lo = Math.min(0, ...pts.map((q) => q.v)), hi = Math.max(0, ...pts.map((q) => q.v));
      const span = hi - lo || 1, t0 = pts[0].at, t1 = last.at;
      const X = (at) => 2 + ((at - t0) / (t1 - t0)) * (W - 4), Y = (v) => 6 + ((hi - v) / span) * (H - 24);
      const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Net premium through the session, ending at ${money(last.v, true)}` });
      svg.append(sv("line", { class: "f2-zero", x1: 0, x2: W, y1: Y(0), y2: Y(0) }));
      svg.append(sv("polyline", { class: "f2-line", points: pts.map((q) => Math.round(X(q.at) * 10) / 10 + "," + Math.round(Y(q.v) * 10) / 10).join(" ") }));
      svg.append(sv("text", { class: "f2-tick", x: 2, y: H - 2 }, F.time(t0)), sv("text", { class: "f2-tick", x: W - 2, y: H - 2, "text-anchor": "end" }, F.time(t1)));
      plot.append(svg);
    };
    draw();
    new ResizeObserver(draw).observe(plot);
  }

  function drawSectors(r, [host]) {
    const rows = r.sectors && r.sectors.status === "ok" ? sectorRows(r.sectors.rows) : [];
    if (!rows.length) return say(host, "Sector premium was not published for this session.");
    const max = Math.max(...rows.map((x) => Math.abs(x.net))) || 1;
    const box = el("div", "f2-rows");
    for (const x of rows) {
      const row = el("div", "f2-row c3");
      const bar = el("div", "f2-bar"), fill = el("i", x.net >= 0 ? "u" : "d");
      fill.style.width = Math.round((Math.abs(x.net) / max) * 500) / 10 + "%";
      bar.append(fill);
      row.append(el("span", "", x.sector), bar, el("span", "n" + tone(x.net), money(x.net, true)));
      box.append(row);
    }
    host.replaceChildren(box);
  }

  function drawAlerts(a, [host]) {
    const rows = topAlerts(a.rows, 7);
    if (!rows.length) return say(host, "No alert has been published for this session.");
    const box = el("div", "f2-rows");
    for (const r of rows) {
      const row = el("a", "f2-row c4");
      row.href = tickerHref(r.t);
      const what = (r.cp === "C" ? "Call" : r.cp === "P" ? "Put" : "Option") + (num(r.k) !== null ? " " + F.strike(r.k) : "") + (typeof r.exp === "string" ? " · " + F.day(r.exp) : "");
      row.append(el("b", "", r.t), el("span", "m", what), el("span", "m", sideOf(r)), el("span", "n", money(r.prem)));
      box.append(row);
    }
    host.replaceChildren(box);
  }

  function drawMovers(m, [host]) {
    const side = (title, rows) => {
      const d = el("div"); d.append(el("h3", "", title));
      const box = el("div", "f2-rows");
      for (const r of (Array.isArray(rows) ? rows : []).filter((x) => x && typeof x.t === "string" && num(x.chg) !== null).slice(0, 5)) {
        const row = el("a", "f2-row c2"); row.href = tickerHref(r.t);
        row.append(el("b", "", r.t), el("span", "n" + tone(r.chg), pct(r.chg, 1, true)));
        box.append(row);
      }
      if (!box.childElementCount) box.append(el("div", "f2-row c2 m", DASH + " none ranked"));
      d.append(box);
      return d;
    };
    const two = el("div", "f2-two");
    two.append(side("Risers", m.risers), side("Fallers", m.fallers));
    host.replaceChildren(two);
  }

  function drawText(rows, host, empty) {
    if (!rows.length) return say(host, empty);
    const box = el("div", "f2-rows");
    for (const r of rows) { const row = el("div", "f2-row txt"); row.append(el("span", "", r)); box.append(row); }
    host.replaceChildren(box);
  }

  function drawNews(n, [host]) {
    const rows = (Array.isArray(n.rows) ? n.rows : []).filter((r) => r && typeof r.headline === "string" && r.headline).slice(0, 5);
    if (!rows.length) return say(host, "No headline has been published.");
    const box = el("div", "f2-rows");
    for (const r of rows) {
      const row = el("div", "f2-row txt");
      const s = el("span", "", r.headline);
      row.append(s);
      row.title = (r.source ? r.source + " · " : "") + (r.createdAt ? F.when(r.createdAt, Date.now()) : "");
      box.append(row);
    }
    host.replaceChildren(box);
  }

  function drawNext(e, [host]) {
    const rows = nextEvents(e.rows, 7);
    if (!rows.length) return say(host, "No report is dated in the window ahead.");
    const box = el("div", "f2-rows");
    for (const r of rows) {
      const row = el("a", "f2-row c3"); row.href = tickerHref(r.t);
      row.append(el("b", "", r.t), el("span", "m", F.day(r.d)), el("span", "n", num(r.im) === null ? DASH : "±" + pct(r.im, 1)));
      box.append(row);
    }
    host.replaceChildren(box);
    $("f2nextS").textContent = "Earnings ahead, with the move the options imply";
  }

  for (const b of $("f2Seg").querySelectorAll("button")) b.addEventListener("click", () => {
    $("f2Grid").dataset.view = b.dataset.v;
    for (const x of $("f2Seg").querySelectorAll("button")) x.setAttribute("aria-selected", String(x === b));
    fit();
  });
  window.addEventListener("resize", refit);

  pane(["hero", "vol"], "/api/flows/market", drawMarket);
  pane(["tide"], "/api/flows/pulse", drawTide);
  pane(["map"], "/api/flows/regime", drawSectors);
  pane(["sig"], "/api/flows/flowalerts", drawAlerts);
  pane(["mov"], "/api/flows/movers", drawMovers);
  pane(["brief"], "/api/flows/brief", (b, [host]) => drawText(((b.today && b.today.facts) || []).map((f) => f && f.say).filter((x) => typeof x === "string" && x).slice(0, 5), host, "The brief holds no fact for this session."));
  pane(["news"], "/api/flows/news", drawNews);
  pane(["next"], "/api/flows/events", drawNext);
})();
