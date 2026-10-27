(() => {
  "use strict";

  const UI = typeof window === "undefined" ? null : window.FlowsUI;
  const DASH = "—";
  const MINUS = "−";
  const SECTORS = ["Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities"];
  const HEAVY_SHARE = 0.005;
  const CELL_MIN = 9;
  const LABEL_W = 148;
  const WHY = {
    failed: "The feed did not answer tonight.",
    plan: "The site's data plan does not include this.",
    budget: "Tonight's read budget ran out before this.",
    unit: "The feed states no unit for this figure.",
    unread: "Not read yet; names are read in rotation.",
    stale: "From an older session.",
    absent: "No filing names this stock.",
    calendar: "Outside the session calendar.",
  };
  const STATE = {
    loading: "Loading the positioning read.",
    pending: "The first positioning read lands after tonight's run.",
    quietRotation: "No filer had both quarters on file to compare.",
    quietFilings: "No filing is on record in the window.",
    quietInsiders: "No insider rows came back for any sector.",
    quietShort: "No failure to deliver or short volume row came back.",
  };
  const FOOT = {
    rotation: "Weights move with prices as well as trades; this is the book, not the buying.",
    shortVolume: "Short-sale volume is not short interest; a market maker's hedge is a short sale.",
    ftd: "Failures to deliver are published with a lag of about two weeks.",
  };

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  function fmtPts(v, plus) {
    const n = num(v);
    if (n === null) return DASH;
    const c = Math.round(Math.abs(n) * 100);
    const body = Math.floor(c / 100) + "." + String(c % 100).padStart(2, "0");
    if (c === 0) return body;
    return (n < 0 ? MINUS : plus ? "+" : "") + body;
  }
  function fmtRatio(v, dp, plus) {
    const n = num(v);
    if (n === null) return DASH;
    const scale = Math.pow(10, dp);
    const c = Math.round(Math.abs(n) * 100 * scale);
    const body = (c / scale).toFixed(dp) + "%";
    if (c === 0) return body;
    return (n < 0 ? MINUS : plus ? "+" : "") + body;
  }
  function fmtNet(v) {
    const n = num(v);
    if (n === null) return DASH;
    const c = Math.round(Math.abs(n) * 100);
    const body = Math.floor(c / 100) + "." + String(c % 100).padStart(2, "0");
    if (c === 0) return body;
    return (n < 0 ? MINUS : "+") + body;
  }
  const money = (v) => (num(v) === null ? DASH : UI.F.money(v));
  const whole = (v) => (num(v) === null ? DASH : Math.round(v).toLocaleString("en-US"));
  const shares = (v) => (num(v) === null ? DASH : UI.F.compact ? UI.F.compact(v) : whole(v));
  const dayText = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : DASH);
  const shape = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "◆");
  const tone = (v) => (v > 0 ? "pos-up" : v < 0 ? "pos-down" : "pos-mut");

  function quarterLabel(day) {
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    return "Q" + (Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1) + " " + day.slice(0, 4);
  }
  function quarterPair(q) {
    if (!q || !q.now || !q.prior) return null;
    const a = quarterLabel(q.now), b = quarterLabel(q.prior);
    if (!a || !b) return null;
    return a.slice(0, 2) + " vs " + b.slice(0, 2) + " " + a.slice(3);
  }
  function weekdaysBehind(session, expected) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session || "") || !/^\d{4}-\d{2}-\d{2}$/.test(expected || "") || session >= expected) return 0;
    let n = 0;
    for (let t = Date.parse(session + "T00:00:00Z") + 864e5; t <= Date.parse(expected + "T00:00:00Z"); t += 864e5) {
      const d = new Date(t).getUTCDay();
      if (d !== 0 && d !== 6) n++;
    }
    return n;
  }

  function heatTone(b, s) {
    if (b === null || s === null) return "x";
    if (b + s === 0) return "z";
    const net = (b - s) / (b + s);
    if (net === 0) return "z";
    const a = Math.abs(net);
    return (net > 0 ? "u" : "d") + (a < 0.15 ? 1 : a < 0.4 ? 2 : 3);
  }

  function axisOf(sectors) {
    let max = 0;
    for (const s of sectors) if (num(s.dW) !== null && Math.abs(s.dW) > max) max = Math.abs(s.dW);
    return Math.max(0.5, Math.ceil(max * 2 - 1e-9) / 2);
  }

  function heroModel(p, expected) {
    const cell = (v, sub, reason, toneName) => ({ v, sub, reason, tone: toneName || null });
    const out = {};
    const rot = p && p.rotation;
    if (!rot || rot.status === "pending" || rot.status === "unavailable") {
      const r = rot && rot.why ? WHY[rot.why] : STATE.pending;
      out.filers = cell(DASH, null, r);
      out.rotation = cell(DASH, null, r);
    } else {
      out.filers = rot.filers ? cell(rot.filers.compared + " of " + rot.filers.tracked, quarterPair(rot.quarter), rot.filers.compared ? null : STATE.quietRotation) : cell(DASH, null, STATE.quietRotation);
      const live = (rot.sectors || []).filter((s) => s.n > 0 && num(s.dW) !== null);
      if (!live.length) out.rotation = cell(DASH, null, STATE.quietRotation);
      else {
        const big = live.slice().sort((a, b) => (Math.abs(b.dW) - Math.abs(a.dW)) || cmp(a.s, b.s))[0];
        out.rotation = cell(big.s + " " + fmtPts(big.dW, true), "Mean book weight, points", null, big.dW > 0 ? "up" : big.dW < 0 ? "down" : null);
      }
    }
    const ins = p && p.insiders;
    if (!ins || ins.status === "pending" || ins.status === "unavailable" || !ins.sectors || !ins.sectors.length) {
      out.insiders = cell(DASH, null, ins && ins.why ? WHY[ins.why] : STATE.pending);
    } else {
      let b = 0, s = 0;
      for (const x of ins.sectors) { b += x.buyers; s += x.sellers; }
      out.insiders = b + s === 0 ? cell(DASH, null, STATE.quietInsiders) : cell(fmtNet((b - s) / (b + s)), "Buyers against sellers, insider-days", null, b > s ? "up" : b < s ? "down" : null);
    }
    const sh = p && p.shorts;
    if (!sh || sh.status === "pending" || sh.status === "unavailable" || !sh.ftd || !sh.ftd.names) {
      out.fails = cell(DASH, null, sh && sh.why ? WHY[sh.why] : STATE.pending);
    } else {
      const n = (sh.ftd.sectors || []).reduce((a, x) => a + (num(x.heavy) || 0), 0);
      out.fails = cell(n + (n === 1 ? " name" : " names"), "Failures at least 0.5% of 30-day volume", null);
    }
    void expected;
    return out;
  }

  function el(tag, cls, text, attrs) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (attrs) for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    return n;
  }
  const NS = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const $ = (id) => document.getElementById(id);

  const S = { payload: null, expected: null, drill: new Map(), heatCur: null, shPane: "ftd" };

  function stateBox(section, quiet) {
    const box = el("div", "pos-state");
    const st = section ? section.status : "pending";
    if (st === "pending") box.append(el("b", null, STATE.pending), el("span", null, WHY.unread));
    else if (st === "unavailable") box.append(el("b", null, WHY[section.why] || WHY.failed));
    else box.append(el("b", null, quiet));
    return box;
  }
  const usable = (section) => section && (section.status === "ok" || section.status === "partial");

  function paintHero(m) {
    const labels = { filers: "Filers compared", rotation: "Largest rotation", insiders: "Insider net, 60 days", fails: "Heavy fails" };
    for (const id of Object.keys(labels)) {
      const cellEl = document.querySelector('.pos-kpi[data-id="' + id + '"]');
      const c = m[id];
      if (!cellEl || !c) continue;
      const v = cellEl.querySelector(".v");
      v.replaceChildren(document.createTextNode(c.v));
      if (c.reason) {
        cellEl.title = c.reason;
        v.append(el("span", "visually-hidden", ". " + c.reason));
      } else if (c.sub) cellEl.title = c.sub;
      if (c.sub) cellEl.querySelector(".s").textContent = c.sub;
      if (c.tone) cellEl.dataset.tone = c.tone; else delete cellEl.dataset.tone;
    }
  }

  function paintStamp(p) {
    const stamp = $("posStamp");
    if (!p || !p.generatedAt) { stamp.textContent = DASH; return; }
    const built = UI.F.stamp ? UI.F.stamp(Date.parse(p.generatedAt)) : null;
    const behind = weekdaysBehind(p.sessionDate, S.expected);
    if (behind >= 2) {
      stamp.dataset.stale = "1";
      stamp.textContent = "From the " + p.sessionDate + " session";
    } else {
      delete stamp.dataset.stale;
      stamp.textContent = (built ? "Built " + built : "Built") + " · session " + dayText(p.sessionDate);
    }
  }

  function barRow(rowEl, s, axis) {
    const bar = rowEl.querySelector(".bar");
    const has = s && s.n > 0 && num(s.dW) !== null;
    rowEl.querySelector(".now").textContent = has ? fmtPts(s.wNow).replace(/^/, "") + "%" : DASH;
    rowEl.querySelector(".was").textContent = has ? fmtPts(s.wPrior) + "%" : DASH;
    const chg = rowEl.querySelector(".chg");
    chg.textContent = has ? shape(s.dW) + " " + fmtPts(s.dW, true) : DASH;
    chg.className = "n chg " + (has ? tone(s.dW) : "pos-mut");
    rowEl.querySelector(".brd").textContent = has && num(s.breadth) !== null ? fmtRatio(s.breadth, 1, true) : DASH;
    rowEl.querySelector(".fil").textContent = s && s.n ? String(s.n) : DASH;
    const reason = !has ? "No compared filer held it." : null;
    rowEl.title = reason || "";
    rowEl.setAttribute("aria-label", has
      ? s.s + ": weight " + fmtPts(s.wNow) + " percent, was " + fmtPts(s.wPrior) + ", change " + fmtPts(s.dW, true) + " points, breadth " + fmtRatio(s.breadth, 1, true) + ", " + s.n + " filers"
      : s.s + ": " + DASH + ", no compared filer held it");
    bar.replaceChildren();
    if (!has) return;
    const svg = sv("svg", { "aria-hidden": "true", focusable: "false", preserveAspectRatio: "none" });
    const w = (Math.abs(s.dW) / axis) * 50;
    svg.append(sv("rect", { class: "b", x: "0", y: "74%", width: "100%", height: "16%" }));
    svg.append(sv("rect", { class: s.dW >= 0 ? "p" : "m", x: (s.dW >= 0 ? 50 : 50 - w) + "%", y: "8%", width: w + "%", height: "52%" }));
    svg.append(sv("line", { class: "z", x1: "50%", x2: "50%", y1: "0", y2: "100%" }));
    if (num(s.breadth) !== null) {
      const x = 50 + Math.max(-1, Math.min(1, s.breadth)) * 50;
      svg.append(sv("line", { class: "bk", x1: x + "%", x2: x + "%", y1: "68%", y2: "96%" }));
    }
    bar.append(svg);
  }

  function paintRotation(p) {
    const body = $("posRotCardB");
    const rot = p && p.rotation;
    const rows = $("posRot");
    const head = body.querySelector(".pos-rot-head");
    const old = body.querySelector(".pos-state");
    if (old) old.remove();
    if (!usable(rot) || !rot.sectors || !rot.sectors.length) {
      rows.hidden = true;
      if (head) head.hidden = true;
      body.append(stateBox(rot, STATE.quietRotation));
      foot(body, null);
      return;
    }
    rows.hidden = false;
    if (head) head.hidden = false;
    const axis = axisOf(rot.sectors);
    const by = new Map(rot.sectors.map((s) => [s.s, s]));
    for (const r of rows.querySelectorAll(".pos-row")) barRow(r, by.get(r.dataset.s) || null, axis);
    const f = rot.filers;
    foot(body, f ? f.compared + " filers compared · " + f.notFiled + " not yet filed for " + (quarterLabel(rot.quarter && rot.quarter.now) || "the quarter") + " · " + f.unread + " not read. " + FOOT.rotation : FOOT.rotation);
    $("posRotCardS").textContent = "Mean book weight of the same filers, " + (quarterLabel(rot.quarter && rot.quarter.now) || "last quarter") + " against " + (quarterLabel(rot.quarter && rot.quarter.prior) || "the one before") + ".";
  }

  function foot(body, text) {
    let f = body.querySelector(":scope > .pos-foot");
    if (!text) { if (f) f.remove(); return; }
    if (!f) { f = el("p", "pos-foot"); body.append(f); }
    f.textContent = text;
  }

  function chipsOf(top) {
    const wrap = el("div", "pos-chg");
    for (const c of top || []) {
      const dir = c.du > 0 ? "up" : "dn";
      const label = c.dv !== null && c.dv !== undefined ? money(Math.abs(c.dv)) : shares(Math.abs(c.du)) + " sh";
      const b = el("button", "pos-cp " + dir, null, { type: "button", "data-t": c.t, title: c.dv === null || c.dv === undefined ? "No price on the report date, so the change is in shares." : (c.du > 0 ? "Raised " : "Cut ") + shares(Math.abs(c.du)) + " shares" });
      b.append(el("span", "a", c.du > 0 ? "▲" : "▼"), document.createTextNode(c.t + " " + label));
      wrap.append(b);
    }
    return wrap;
  }

  function filerSheet(r) {
    const body = $("posDrillB");
    $("posDrillT").textContent = r.filer;
    body.replaceChildren();
    const sec = el("div", "pos-dsec");
    sec.append(el("h3", null, "Largest changes in its latest report"));
    if (!r.top || !r.top.length) sec.append(el("p", "pos-dline", r.top === null ? WHY.unread : "No change on record."));
    else for (const c of r.top) sec.append(el("p", "pos-dline", c.t + " " + (c.du > 0 ? "▲ " : "▼ ") + shares(Math.abs(c.du)) + " shares" + (c.dv !== null && c.dv !== undefined ? ", " + money(Math.abs(c.dv)) : ", no price on the report date") + (c.sec ? " · " + c.sec : "")));
    body.append(sec);
    openDialog($("posDrill"));
  }

  function paintFilings(p) {
    const body = $("posFilCardB");
    const f = p && p.filings;
    body.replaceChildren();
    if (!usable(f) || !f.rows || !f.rows.length) {
      body.append(stateBox(f, STATE.quietFilings));
      return;
    }
    const list = el("div", "pos-fil");
    const head = el("div", "pos-frow pos-fhead");
    for (const t of ["Filer", "Filed", "Report", "Lag", "Largest changes"]) head.append(el("span", null, t));
    list.append(head);
    for (const r of f.rows) {
      const row = el("div", "pos-frow");
      const who = el("span", "who");
      const open = el("button", "pos-open", null, { type: "button", "aria-haspopup": "dialog" });
      open.append(el("b", null, r.filer));
      who.append(open);
      if (r.hf) who.append(el("span", "pos-hf", "HF", { title: "Hedge fund, as the feed tags it" }));
      open.addEventListener("click", () => filerSheet(r));
      const lag = el("span", null, null);
      if (r.lagD === null || r.lagD === undefined) lag.textContent = DASH;
      else {
        lag.append(document.createTextNode(r.lagD + " d"));
        if (r.lagD > 45) lag.append(document.createTextNode(" "), el("span", "pos-late", "past 45"));
      }
      row.append(who, el("span", null, dayText(r.filed)), el("span", null, dayText(r.report)), lag);
      if (r.top === null) row.append(el("span", "pos-mut", WHY.unread));
      else if (!r.top.length) row.append(el("span", "pos-mut", "No change on record."));
      else {
        const chips = chipsOf(r.top);
        chips.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-t]"); if (b) drill(b.dataset.t, b); });
        row.append(chips);
      }
      const chev = el("button", "pos-open pos-chev", "›", { type: "button", "aria-label": "Changes by " + r.filer, "aria-haspopup": "dialog" });
      chev.addEventListener("click", () => filerSheet(r));
      row.append(chev);
      list.append(row);
    }
    body.append(list);
  }

  function heatGrid(sectors, days, hostW) {
    const grid = el("div", "pos-heatg", null, { role: "grid", "aria-label": "Insider buyers against sellers by sector and day" });
    const total = sectors[0] ? sectors[0].days.length : 0;
    const show = Math.max(1, Math.min(total, days));
    const from = total - show;
    S.heatCells = [];
    sectors.forEach((s, ri) => {
      const row = el("div", "pos-hrow", null, { role: "row" });
      row.append(el("span", "nm", s.s));
      const cells = el("div", "pos-cells", null);
      cells.style.gridTemplateColumns = "repeat(" + show + ", minmax(0, 1fr))";
      const line = [];
      for (let i = from; i < total; i++) {
        const d = s.days[i];
        const t = heatTone(d[1], d[2]);
        const c = el("span", "pos-hc", null, { "data-t": t, role: "gridcell" });
        c.dataset.say = s.s + ", " + d[0] + ": " + (d[1] === null ? "no row" : d[1] + " buyers, " + d[2] + " sellers");
        cells.append(c);
        line.push(c);
      }
      S.heatCells.push(line);
      row.append(cells);
      grid.append(row);
      void ri;
    });
    void hostW;
    return grid;
  }

  function heatPlace(heat, live) {
    const rows = S.heatCells;
    if (!rows || !rows.length) return;
    if (!S.heatCur) S.heatCur = [0, rows[0].length - 1];
    S.heatCur[0] = Math.max(0, Math.min(rows.length - 1, S.heatCur[0]));
    S.heatCur[1] = Math.max(0, Math.min(rows[0].length - 1, S.heatCur[1]));
    for (const r of rows) for (const c of r) c.removeAttribute("data-cur");
    const c = rows[S.heatCur[0]][S.heatCur[1]];
    c.setAttribute("data-cur", "");
    live.textContent = c.dataset.say;
    void heat;
  }

  function netList(sectors) {
    const list = el("div", "pos-net");
    const head = el("div", "pos-nrow pos-nhead");
    for (const t of ["Sector", "Buyers", "Sellers", "Net", "Trades"]) head.append(el("span", t === "Sector" ? null : "n", t));
    list.append(head);
    for (const s of sectors) {
      const row = el("div", "pos-nrow");
      const net = num(s.net);
      row.append(el("span", "nm", s.s), el("span", "n", whole(s.buyers)), el("span", "n", whole(s.sellers)),
        el("span", "net " + (net === null ? "pos-mut" : tone(net)), net === null ? DASH : shape(net) + " " + fmtNet(net)),
        el("span", "n", whole(s.buyTx + s.sellTx)));
      list.append(row);
    }
    return list;
  }

  function paintInsiders() {
    const p = S.payload;
    const body = $("posInsCardB");
    const ins = p && p.insiders;
    body.replaceChildren();
    if (!usable(ins) || !ins.sectors || !ins.sectors.length) {
      body.append(stateBox(ins, STATE.quietInsiders));
      return;
    }
    const wrap = el("div", "pos-ins");
    const heat = el("div", "pos-heat", null, { tabindex: "0", "aria-label": "Insider heat strip. Arrow keys move between cells." });
    const live = el("p", "visually-hidden", "", { "aria-live": "polite" });
    const host = el("div", null);
    host.style.display = "contents";
    heat.append(host);
    wrap.append(heat, netList(ins.sectors));
    body.append(wrap, live);
    const draw = () => {
      const w = heat.clientWidth;
      const days = Math.max(10, Math.min(60, Math.floor((w - LABEL_W - 8) / CELL_MIN)));
      const grid = heatGrid(ins.sectors, days, w);
      host.replaceChildren(grid);
      const axis = el("div", "pos-axis");
      const total = ins.sectors[0].days.length;
      const shown = Math.min(total, days);
      axis.append(el("span", null, ins.sectors[0].days[total - shown][0]), el("span", null, ins.sectors[0].days[total - 1][0]));
      host.append(axis);
      S.heatCur = null;
      heatPlace(heat, live);
    };
    draw();
    heat.addEventListener("keydown", (ev) => {
      const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[ev.key];
      if (!d || !S.heatCur) return;
      ev.preventDefault();
      S.heatCur = [S.heatCur[0] + d[0], S.heatCur[1] + d[1]];
      heatPlace(heat, live);
    });
    if (typeof ResizeObserver === "function") {
      let last = heat.clientWidth;
      new ResizeObserver(() => { if (Math.abs(heat.clientWidth - last) > 24) { last = heat.clientWidth; draw(); } }).observe(heat);
    }
    foot(body, ins.window ? "Window " + ins.window.from + " to " + ins.window.to + " · " + ins.window.sessions + " days · insider-days, so one insider can count twice." : null);
  }

  function sectorBars(rows, valueOf, textOf, maxOf) {
    const box = el("div", "pos-sec");
    for (const s of rows) {
      const row = el("div", "pos-srow");
      const v = valueOf(s);
      const tr = el("span", "tr", null);
      if (v !== null && maxOf > 0) { const i = document.createElement("i"); i.style.width = Math.max(1, (v / maxOf) * 100) + "%"; tr.append(i); }
      row.append(el("span", "nm", s.s), tr, el("span", "n", textOf(s)[0]), el("span", "n pos-mut", textOf(s)[1]));
      box.append(row);
    }
    return box;
  }

  function topRows(list, cols, head, cls) {
    const box = el("div", "pos-tops");
    const h = el("div", "pos-trow pos-thead" + (cls ? " " + cls : ""));
    for (const t of head) h.append(el("span", t === "Name" || t === "Sector" ? null : "n", t));
    box.append(h);
    for (const r of list) {
      const row = el("div", "pos-trow" + (cls ? " " + cls : ""));
      const nm = el("button", "t", r.t, { type: "button", "aria-haspopup": "dialog" });
      nm.addEventListener("click", () => drill(r.t, nm));
      row.append(nm, el("span", "sc", r.sec || DASH));
      for (const c of cols(r)) row.append(el("span", "n", c));
      box.append(row);
    }
    return box;
  }

  function ftdPane(sh) {
    const pane = el("div", "pos-pane", null, { id: "posFtdPane" });
    pane.append(el("h3", null, "Failures to deliver"));
    const f = sh.ftd;
    if (!f || !f.names) { pane.append(el("div", "pos-state", WHY.unread)); return pane; }
    const max = Math.max(0, ...f.sectors.map((s) => (num(s.notional) === null ? 0 : s.notional)));
    pane.append(sectorBars(f.sectors, (s) => (num(s.notional) === null ? null : s.notional),
      (s) => [num(s.notional) === null ? DASH : money(s.notional), s.heavy ? s.heavy + " heavy" : ""], max));
    pane.append(topRows(f.top, (r) => [dayText(r.date).slice(5), whole(r.q), fmtRatio(r.share, 2), r.notional === null ? DASH : money(r.notional)].slice(0, 4),
      ["Name", "Sector", "Settled", "Shares", "Of volume", "Notional"], "ftd"));
    const unread = f.sectors.reduce((a, s) => a + (s.unread || 0), 0);
    pane.append(el("p", "pos-foot", unread + " names with no failure row in 21 days. " + FOOT.ftd));
    return pane;
  }

  function volPane(sh) {
    const pane = el("div", "pos-pane", null, { id: "posVolPane" });
    pane.append(el("h3", null, "Short-sale volume"));
    const v = sh.venues;
    if (!v || !v.names) { pane.append(el("div", "pos-state", WHY.unread)); return pane; }
    const six = v.mix.slice(0, 6);
    const other = v.mix.slice(6).reduce((a, m) => a + m.short, 0);
    const total = six.reduce((a, m) => a + m.short, 0) + other;
    const mix = el("div", "pos-mix", null, { role: "img", "aria-label": "Short volume by venue" });
    const leg = el("div", "pos-leg");
    const parts = [...six.map((m) => [m.x, m.short]), ...(other > 0 ? [["Other venues", other]] : [])];
    parts.forEach(([name, val], i) => {
      const seg = document.createElement("i");
      seg.style.width = (total > 0 ? (val / total) * 100 : 0) + "%";
      seg.title = name;
      mix.append(seg);
      leg.append(el("span", null, (i + 1) + " " + name + " " + fmtRatio(total > 0 ? val / total : null, 0)));
    });
    pane.append(mix, leg);
    pane.append(sectorBars(v.sectors, (s) => (num(s.ratio) === null ? null : s.ratio), (s) => [fmtRatio(s.ratio, 1), ""], Math.max(0, ...v.sectors.map((s) => (num(s.ratio) === null ? 0 : s.ratio)))));
    pane.append(topRows(v.top, (r) => [fmtRatio(r.ratio, 1), fmtRatio(r.ratio10, 1), String(r.venues)], ["Name", "Sector", "Today", "10 days", "Venues"], "vol"));
    pane.append(el("p", "pos-foot", FOOT.shortVolume));
    return pane;
  }

  function paintShort() {
    const p = S.payload;
    const body = $("posShCardB");
    const sh = p && p.shorts;
    body.replaceChildren();
    if (!usable(sh)) { body.append(stateBox(sh, STATE.quietShort)); return; }
    const wrap = el("div", "pos-sh", null, { id: "posSh" });
    const seg = el("div", "pos-segw ui-seg", null, { role: "group", "aria-label": "Show" });
    const a = el("button", "ui-seg-i", "Failures", { type: "button", "aria-pressed": "true", "data-pane": "ftd" });
    const b = el("button", "ui-seg-i", "Volume", { type: "button", "aria-pressed": "false", "data-pane": "vol" });
    seg.append(a, b);
    const f = ftdPane(sh), v = volPane(sh);
    wrap.append(f, v);
    body.append(seg, wrap);
    const pick = (which) => {
      S.shPane = which;
      a.setAttribute("aria-pressed", String(which === "ftd"));
      b.setAttribute("aria-pressed", String(which === "vol"));
      f.hidden = which !== "ftd" && narrow();
      v.hidden = which !== "vol" && narrow();
    };
    const narrow = () => matchMedia("(max-width: 1023.98px)").matches;
    a.addEventListener("click", () => pick("ftd"));
    b.addEventListener("click", () => pick("vol"));
    pick(S.shPane);
    matchMedia("(max-width: 1023.98px)").addEventListener("change", () => pick(S.shPane));
  }

  function fitChips() {
    for (const wrap of document.querySelectorAll(".pos-chg")) {
      if (!wrap.clientWidth) continue;
      const chips = [...wrap.querySelectorAll(".pos-cp")];
      const old = wrap.querySelector(".more");
      if (old) old.remove();
      for (const c of chips) c.hidden = false;
      let hidden = 0;
      while (hidden < chips.length - 1 && wrap.scrollWidth > wrap.clientWidth + 1) {
        chips[chips.length - 1 - hidden].hidden = true;
        hidden++;
      }
      if (hidden) {
        const more = el("span", "more", "+" + hidden);
        more.title = chips.slice(chips.length - hidden).map((c) => c.textContent).join(", ");
        wrap.append(more);
        while (hidden < chips.length - 1 && wrap.scrollWidth > wrap.clientWidth + 1) {
          chips[chips.length - 1 - hidden].hidden = true;
          hidden++;
          more.textContent = "+" + hidden;
        }
      }
    }
  }

  function fitRows() {
    for (const box of document.querySelectorAll(".pos-tops")) {
      if (!box.clientHeight) continue;
      const rows = [...box.querySelectorAll(".pos-trow:not(.pos-thead)")];
      for (const r of rows) r.hidden = false;
      let n = rows.length;
      while (n > 1 && box.scrollHeight > box.clientHeight + 1) { rows[--n].hidden = true; }
    }
  }

  function fitAll() { fitChips(); fitRows(); }

  function openDialog(d) {
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  }

  function drillBody(t, got) {
    const body = $("posDrillB");
    body.replaceChildren();
    const ps = got && got.ps;
    const sec = (title) => { const s = el("div", "pos-dsec"); s.append(el("h3", null, title)); body.append(s); return s; };
    const missing = (s, why) => s.append(el("p", "pos-dline", DASH + " " + (WHY[why] || why)));
    const ftd = sec("Failures to deliver");
    const fp = ps && ps.parts && ps.parts.ftd && ps.parts.ftd.x && ps.parts.ftd.x.rows ? ps.parts.ftd.x.rows : null;
    if (!fp) missing(ftd, "unread");
    else {
      const rows = fp.slice().reverse();
      const max = Math.max(1, ...rows.map((r) => r[1]));
      const bars = el("div", "pos-dbars", null, { role: "img", "aria-label": "Shares failed by settlement date, " + rows.length + " dates" });
      for (const r of rows) { const i = document.createElement("i"); i.style.height = Math.max(2, (r[1] / max) * 100) + "%"; i.title = r[0] + ": " + whole(r[1]) + " shares"; bars.append(i); }
      ftd.append(bars, el("p", "pos-dline", "Newest " + dayText(fp[0][0]) + ": " + whole(fp[0][1]) + " shares" + (fp[0][2] ? " at $" + (fp[0][2] / 100).toFixed(2) : ", no price in the row")));
    }
    const vol = sec("Short-sale volume");
    const vp = ps && ps.parts && ps.parts.svx && ps.parts.svx.x ? ps.parts.svx.x : null;
    if (!vp || !vp.days) missing(vol, "unread");
    else {
      const d0 = vp.days[0];
      vol.append(el("p", "pos-dline", dayText(d0[0]) + ": " + fmtRatio(d0[2] > 0 ? d0[1] / d0[2] : null, 1) + " of volume was sold short, across " + vp.last.venues.length + " venues."));
      const s10 = vp.days.reduce((a, d) => a + d[1], 0), t10 = vp.days.reduce((a, d) => a + d[2], 0);
      vol.append(el("p", "pos-dline", vp.days.length + " days: " + fmtRatio(t10 > 0 ? s10 / t10 : null, 1) + "."));
    }
    const ib = sec("Insider filings");
    const ip = ps && ps.parts && ps.parts.ibs && ps.parts.ibs.x && ps.parts.ibs.x.rows ? ps.parts.ibs.x.rows : null;
    if (!ip) missing(ib, "unread");
    else {
      const pur = ip.reduce((a, r) => a + r[1], 0), sel = ip.reduce((a, r) => a + r[2], 0);
      ib.append(el("p", "pos-dline", pur + " purchases and " + sel + " sales over " + ip.length + " filing dates. " + WHY.unit));
    }
    const pe = sec("Insiders on file");
    const pp = ps && ps.parts && ps.parts.ins && ps.parts.ins.x && ps.parts.ins.x.total !== undefined ? ps.parts.ins.x : null;
    if (!pp) missing(pe, "unread");
    else pe.append(el("p", "pos-dline", pp.persons + " persons and " + pp.entities + " entities."));
    const link = el("a", "link", "Open " + t, { href: "/flows/ticker/?t=" + encodeURIComponent(t) });
    body.append(link);
  }

  function drill(t, from) {
    $("posDrillT").textContent = t;
    $("posDrill")._from = from || null;
    const known = S.drill.get(t);
    const open = () => openDialog($("posDrill"));
    if (known && known.ok) { drillBody(t, known.body); open(); return; }
    $("posDrillB").replaceChildren(el("p", "pos-dline", STATE.loading));
    open();
    fetch("/api/flows/positioning?t=" + encodeURIComponent(t), { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((r) => { if (r.status === 401) { location.replace("/flows/"); return null; } if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((body) => { if (!body) return; S.drill.set(t, { ok: true, body }); drillBody(t, body); })
      .catch(() => {
        const b = $("posDrillB");
        b.replaceChildren(el("p", "pos-dline", WHY.failed));
        const retry = el("button", "link", "Retry", { type: "button" });
        retry.addEventListener("click", () => drill(t, from));
        b.append(retry);
      });
  }

  function wire() {
    for (const [dlg, closeId] of [["posDrill", "posDrillX"], ["posInfoDlg", "posInfoX"]]) {
      const d = $(dlg);
      $(closeId).addEventListener("click", () => d.close());
      d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); });
      d.addEventListener("close", () => { const f = d._from; if (f && f.isConnected) f.focus(); });
    }
    $("posInfo").addEventListener("click", () => { $("posInfoDlg")._from = $("posInfo"); openDialog($("posInfoDlg")); });
  }

  function paint(p) {
    S.payload = p;
    const m = UI.market ? UI.market() : null;
    S.expected = m ? m.expected : null;
    paintStamp(p);
    paintHero(heroModel(p, S.expected));
    paintRotation(p);
    paintFilings(p);
    paintInsiders();
    paintShort();
    fitAll();
    $("pos").dataset.ready = "1";
    $("posStatus").textContent = "Positioning read: " + (p && p.sessionDate ? "session " + p.sessionDate : "not built yet");
  }

  function fail(text) {
    const m = {};
    for (const id of ["filers", "rotation", "insiders", "fails"]) m[id] = { v: DASH, sub: null, reason: text, tone: null };
    paintHero(m);
    for (const id of ["posRotCardB", "posFilCardB", "posInsCardB", "posShCardB"]) {
      const b = $(id);
      const keep = id === "posRotCardB" ? [b.querySelector(".pos-rot-head"), $("posRot")] : [];
      for (const k of keep) if (k) k.hidden = true;
      for (const k of [...b.children]) if (!keep.includes(k)) k.remove();
      b.append(el("div", "pos-state", text));
    }
    $("posStatus").textContent = text;
  }

  function mount() {
    if (!$("pos")) return;
    wire();
    if (typeof ResizeObserver === "function") new ResizeObserver(() => fitAll()).observe($("fdStage"));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
    document.addEventListener("click", (ev) => { if (ev.target.closest && ev.target.closest("#fdTabs")) requestAnimationFrame(fitAll); });
    addEventListener("hashchange", () => requestAnimationFrame(fitAll));
    fetch("/api/flows/positioning", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((r) => { if (r.status === 401) { location.replace("/flows/"); return null; } if (!r.ok) throw new Error("HTTP " + r.status); return r.json().then((body) => ({ body, at: Number(r.headers.get("X-Payload-Updated")) })); })
      .then((res) => {
        if (!res) return;
        const p = res.body;
        if (!p || p.status === "pending" || !p.sessionDate) { paint(null); return; }
        if (UI.freshness) UI.freshness({ sessionDate: p.sessionDate, generatedAt: p.generatedAt, updatedAt: res.at > 0 ? res.at : null, source: "positioning" });
        paint(p);
      })
      .catch(() => fail(WHY.failed));
  }

  const model = Object.freeze({ heroModel, heatTone, axisOf, weekdaysBehind, quarterLabel, quarterPair });
  const fmt = Object.freeze({ pts: fmtPts, ratio: fmtRatio, net: fmtNet });

  if (typeof document === "undefined") {
    globalThis.__PosTest = Object.freeze({ model, fmt, WHY, STATE, FOOT, HEAVY_SHARE });
    return;
  }
  if (!UI) return;
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { pos: Object.freeze({ mount, model, fmt }) }));
  mount();
})();
