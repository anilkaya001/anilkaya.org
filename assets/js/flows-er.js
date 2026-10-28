(() => {
  "use strict";

  const COPY = {
    titles: { risk: "Report risk", issues: "New issues", policy: "Policy calendar", halts: "Halts" },
    tabs: { risk: "Risk", issues: "New issues", policy: "Policy", halts: "Halts" },
    loading: "Loading the event-risk read.",
    chip: "Event risk",
    chipTitle: "The Risk, New issues, Policy and Halts views",
    verdict: {
      rich: { word: "Priced above past moves", glyph: "down", short: "Above" },
      cheap: { word: "Priced below past moves", glyph: "up", short: "Below" },
      inline: { word: "Within past range", glyph: "flat", short: "Within" },
      few: { word: "Too few reports", glyph: "pending", short: "Few" },
    },
    verdictNote: "Past report moves against the implied move at each report.",
    info: {
      risk: [
        "Each past report's implied move is set against the move that followed.",
        "The verdict needs six reports and an interval that excludes the implied move.",
        "It describes this name's past reports. It is not a forecast.",
        "Report dates are US dates. Times are in TRT.",
        "Rows follow report date, then name. This is not a ranking.",
      ],
      issues: [
        "Upcoming listings, recent listings and names the feed dropped.",
        "Dates are US dates. Prices are the filed range, not a quote.",
      ],
      policy: [
        "The public schedule and recent posts, placed against the US session in TRT.",
        "Posts are quoted as published, cut at 280 characters.",
        "Tags mark words, not meaning.",
      ],
      halts: [
        "Trading halts and resumptions as the feed streams them.",
        "Silence is not a verdict: halts are rare, and the channel can be down.",
        "The last 14 days come from the alerts recorded on the feed account.",
      ],
    },
    pool: {
      few: "Fewer than five names to pool.",
      names: (n) => n + " names with six or more reports.",
      mean: (r, lo, hi) => "Past moves averaged " + r + " times the implied move (" + lo + " to " + hi + ").",
      describe: "A description of this window's names, not a test.",
    },
    cols: {
      name: "Name", reports: "Reports", now: "Implied now", past: "Past median move", ratio: "Today vs past", verdict: "Verdict",
      straddle: "Straddle paid", surprise: "Moved with surprise", natr: "Implied in NATR", pulse: "Opening puts per call",
    },
    dash: {
      noCalendar: "no calendar move",
      noStraddle: "no straddle figure",
      noSurprise: "no surprise on record",
      notRead: "not read for this name",
      noNatr: "NATR not read",
      noRatio: "needs both moves",
      rangeNotStated: "range not stated",
      rangeNotReadable: "range not readable",
      timeNotStated: "Time not stated",
    },
    reports: { pre: "Before the open", post: "After the close" },
    phase: { pre: "Pre-market", rth: "In session", post: "After hours", closed: "Market closed" },
    halt: {
      states: { halted: "Halted", paused: "Paused", resumed: "Resumed" },
      unknownReason: "code not in this page's table",
      socketOnly: "The feed's halt channel is not connected, so no halt is shown. That is not the same as none.",
      notConfigured: "No trading-state alert is set on the feed account, so there is no 14-day record.",
      closed: "The halt channel is watched only while the extended session is open, and it is closed now.",
      off: "The halt channel is switched off.",
      noneYet: "No halt has been streamed since this connection began.",
      noneIn14: "The feed account recorded no halt in 14 days.",
    },
    honesty: {
      plan: "The feed's plan does not include this.",
      few: "Fewer than six past reports with both moves.",
      shed: "Cut to stay under the size limit.",
      unit: "The feed's NATR was outside 0 to 100, so it is not shown.",
      pulse: "Sentiment scores are not shown: the feed states no scale for them.",
      pending: "The first event-risk read lands after tonight's run.",
      failed: "The feed could not be read for this part.",
      off: "This part is switched off.",
    },
    policy: {
      notice: "Quoted as published, cut at 280 characters. Tags mark words, not meaning.",
      tags: { trade: "Trade", rates: "Rates", energy: "Energy", defense: "Defense", crypto: "Crypto", china: "China", tax: "Tax" },
    },
    drill: { close: "Close", open: "Open", quoteLimit: "The quote limit is reached; try again in a minute.", crossed: "Crossed quote", retry: "Retry" },
  };

  const HALT_REASONS = {
    LUDP: "Volatility pause (limit up, limit down)",
    LUDS: "Volatility pause, straddle state",
    M: "Volatility trading pause",
    T1: "News pending",
    T2: "News released",
    T3: "News and resumption times",
    T5: "Single-stock trading pause",
    T6: "Extraordinary market activity",
    T8: "Exchange-traded fund issue",
    T12: "Additional information requested",
    H4: "Not in compliance",
    H9: "Not current in filings",
    H10: "Regulatory suspension",
    H11: "Regulatory concern",
    "": "No reason given",
  };

  const AXIS_FROM = 540;
  const AXIS_SPAN = 960;
  const axisPct = (minutes) => (typeof minutes !== "number" || !Number.isFinite(minutes) ? null : Math.max(0, Math.min(100, ((minutes - AXIS_FROM) / AXIS_SPAN) * 100)));
  const haltReason = (code) => (typeof code === "string" && Object.prototype.hasOwnProperty.call(HALT_REASONS, code) ? HALT_REASONS[code] : null);
  const isoDayOk = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

  if (typeof document === "undefined") {
    globalThis.__ErTest = { COPY, HALT_REASONS, axisPct, haltReason, AXIS_FROM, AXIS_SPAN };
    return;
  }

  const UI = window.FlowsUI;
  const holder = document.getElementById("erDefer");
  const riskHost = document.getElementById("erRisk");
  if (!UI || !holder || !riskHost) return;
  const { h, s, F } = UI;
  const DASH = UI.DASH, MID = UI.MID;
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hosts = {
    risk: riskHost,
    issues: document.getElementById("erIssues"),
    policy: document.getElementById("erPolicy"),
    halts: document.getElementById("erHalts"),
  };
  const haltsOn = holder.getAttribute("data-halts") === "on";
  const href = holder.getAttribute("data-css");
  const cssReady = new Promise((ok) => {
    if (!href || document.querySelector('link[href="' + href + '"]')) { ok(); return; }
    document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href, onload: ok, onerror: ok }));
  });

  const S = { data: null, cards: new Map(), quotes: new Map(), mounted: null, said: 0, sayQueue: [], haltsSeen: new Set(), timer: null, rt: null };
  if (haltsOn && UI.rt && typeof UI.rt.connect === "function") { try { S.rt = UI.rt.connect({ topics: ["ht"], primary: [] }); } catch { S.rt = null; } }

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const dayMs = (d) => Date.parse(d + "T00:00:00Z");
  const weekday = (d) => WD[new Date(dayMs(d)).getUTCDay()];
  const plural = (k, one, many) => (k === 1 ? one : many);
  const sessionsText = (k) => (k === 0 ? "this session" : "in " + k + " " + plural(k, "session", "sessions"));
  const timeOf = (iso) => { const t = F.time(iso); return t === DASH ? null : t; };
  const tickerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(String(t || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, ""));
  const tickerLink = (t) => h("a", { class: "er-tk", href: tickerHref(t) }, String(t));
  const multiple = (v, dp) => (isNum(v) ? F.px(v, dp) + "×" : DASH);
  const moveText = (v) => (isNum(v) ? "±" + F.pct(Math.abs(v), 1) : DASH);
  const logRatio = (v) => (isNum(v) ? Math.exp(v) : null);

  const dashCell = (reason) => h("span", { class: "er-dash", title: reason }, DASH, h("span", { class: "visually-hidden" }, " " + reason));

  const verdictChip = (code, title) => {
    const v = COPY.verdict[code] || COPY.verdict.few;
    return h("span", { class: "er-v er-v-" + (COPY.verdict[code] ? code : "few"), title: title || COPY.verdictNote }, UI.glyph(v.glyph, "er-vg"), h("span", null, v.word));
  };

  function verdictTitle(hist) {
    const lo = logRatio(hist.lo), hi = logRatio(hist.hi);
    const parts = [COPY.verdictNote];
    if (isNum(hist.medR)) parts.push("Median realised over implied " + F.px(hist.medR, 2) + ".");
    if (isNum(lo) && isNum(hi)) parts.push("Mean ratio " + F.px(logRatio(hist.meanLog), 2) + ", interval " + F.px(lo, 2) + " to " + F.px(hi, 2) + ".");
    parts.push(hist.n + " " + plural(hist.n, "report", "reports") + " with both moves, " + hist.zeros + " with no move, " + hist.missing + " missing.");
    return parts.join(" ");
  }

  function moduleOf(host) { return host && host.closest(".fd-mod"); }

  function setState(host, st, label) {
    const card = moduleOf(host);
    if (!card) return;
    card.dataset.state = st.state;
    const t = card.querySelector(".ui-mod-t");
    const old = t.querySelector(".ui-state");
    if (old) old.remove();
    const b = UI.stateButton(st, label);
    if (b) t.append(b);
  }

  function setInfo(host, label, lines) {
    const card = moduleOf(host);
    if (!card) return;
    const head = card.querySelector(".ui-mod-h");
    const old = head.querySelector(":scope > .ui-info");
    if (old) old.remove();
    head.append(UI.infoButton(label, () => ({ title: label, lead: lines[0], sections: [{ title: "How to read it", lines: lines.slice(1) }] })));
  }

  function setStamp(host, data, warn) {
    const card = moduleOf(host);
    if (!card) return;
    const head = card.querySelector(".ui-mod-h");
    let st = head.querySelector(":scope > .er-stamp");
    if (!st) { st = h("span", { class: "er-stamp" }); head.querySelector(".ui-mod-sp").after(st); }
    const read = timeOf(data && data.generatedAt);
    st.className = "er-stamp" + (warn ? " is-warn" : "");
    st.textContent = warn ? "From the " + data.sessionDate + " session" : read ? "Read " + read : "";
  }

  function silence(host, st, label) {
    host.replaceChildren(h("div", { class: "er-quiet" }, UI.silent(st, label, 160)));
    setState(host, st, label);
  }

  function sectionState(sec, what) {
    if (!sec || typeof sec !== "object") return { state: "pending", reason: COPY.honesty.pending };
    if (sec.status === "ok" || sec.status === "partial") return { state: "ok" };
    if (sec.status === "quiet") return { state: "quiet", reason: "Read; nothing applies to " + what + "." };
    if (sec.status === "pending") return { state: "pending", reason: COPY.honesty.pending };
    const why = sec.why;
    const reason = why === "plan" ? COPY.honesty.plan : why === "shed" ? COPY.honesty.shed : why === "off" ? COPY.honesty.off : COPY.honesty.failed;
    return { state: "unavailable", reason };
  }

  function fetchJson(url) {
    return fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } }).then((r) => {
      if (r.status === 401) { location.replace("/flows/"); return null; }
      if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; e.retryAfter = Number(r.headers.get("Retry-After")) || null; throw e; }
      return r.json().then((body) => ({ body, stale: r.headers.get("X-Fresh-State") === "stale" }));
    });
  }

  const staleData = (d) => {
    if (!d || !isoDayOk(d.sessionDate)) return false;
    return (Date.now() - dayMs(d.sessionDate)) / 864e5 > 4.5;
  };

  function chipRow(counts, total) {
    return h("div", { class: "er-chips", role: "group", "aria-label": "Verdicts" },
      ["rich", "cheap", "inline", "few"].map((code) => h("span", { class: "er-vc er-v-" + code, title: COPY.verdict[code].word },
        UI.glyph(COPY.verdict[code].glyph, "er-vg"), h("b", null, String(counts[code] || 0)), h("span", { class: "er-vl" }, COPY.verdict[code].word), h("span", { class: "er-vs", "aria-hidden": "true" }, COPY.verdict[code].short))), total);
  }

  function poolLines(p) {
    if (!p || !(p.n >= 5) || !isNum(p.meanLog)) return [h("span", { class: "er-pool-a" }, DASH + " " + COPY.pool.few)];
    return [
      h("span", { class: "er-pool-a" }, COPY.pool.names(p.n)),
      isNum(p.lo) && isNum(p.hi)
        ? h("span", { class: "er-pool-b" }, COPY.pool.mean(F.px(logRatio(p.meanLog), 2), F.px(logRatio(p.lo), 2), F.px(logRatio(p.hi), 2)))
        : null,
    ];
  }

  function surpriseCell(r) {
    const sur = r.sur || {};
    const dec = (sur.with || 0) + (sur.against || 0);
    if (!dec && !(sur.last && sur.last.length)) return dashCell(COPY.dash.noSurprise);
    const tris = (sur.last || []).map((x) => h("i", { class: "er-tri " + (x > 0 ? "is-up" : x < 0 ? "is-down" : "is-flat"), title: F.pct(x, 1, true) }, UI.glyph(x > 0 ? "up" : x < 0 ? "down" : "flat")));
    return h("span", { class: "er-sur" }, h("b", null, dec ? sur.with + " of " + dec : DASH), h("span", { class: "er-tris" }, tris));
  }

  function riskRow(r, i) {
    const hist = r.hist || {};
    const at = r.when ? timeOf(r.at) : null;
    const reportLine = r.when ? COPY.reports[r.when] + (at ? " " + MID + " " + at : "") : COPY.dash.timeNotStated;
    const cells = [
      ["name", h("span", { class: "er-name" }, tickerLink(r.t), r.sec ? h("span", { class: "er-sec" }, r.sec) : null)],
      ["reports", h("span", { class: "er-rep" }, h("span", { class: "er-rl" }, h("b", null, F.day(r.d)), isNum(r.ed) ? h("span", { class: "er-ed" }, sessionsText(r.ed)) : null), h("span", { class: "er-rt" }, reportLine))],
      ["now", isNum(r.emNow) ? h("b", { class: "er-n" }, moveText(r.emNow)) : dashCell(COPY.dash.noCalendar)],
      ["past", isNum(hist.mv) ? h("span", { class: "er-n" }, h("b", null, moveText(hist.mv)), h("span", { class: "er-mut" }, " (" + hist.n + " of 12)")) : dashCell(COPY.honesty.few)],
      ["ratio", isNum(r.todayR) ? h("b", { class: "er-n", title: isNum(r.todayZ) ? "Position among this name's past moves: " + F.signed(r.todayZ, 1) : "Implied now over the median past move." }, multiple(r.todayR, 2)) : dashCell(COPY.dash.noRatio)],
      ["verdict", verdictChip(hist.verdict, verdictTitle(hist))],
      ["straddle", hist.hitN ? h("span", { class: "er-n", title: F.pct(hist.hit, 0) + " of reports" }, Math.round(hist.hit * hist.hitN) + " of " + hist.hitN) : dashCell(COPY.dash.noStraddle)],
      ["surprise", surpriseCell(r)],
      ["natr", isNum(r.ratioNatr) ? h("span", { class: "er-n", title: "Implied move over NATR(14) on " + (r.natrAt ? F.day(r.natrAt) : DASH) }, multiple(r.ratioNatr, 1)) : dashCell(COPY.dash.noNatr)],
      ["pulse", r.pulse && isNum(r.pulse.ratio)
        ? h("span", { class: "er-n", title: "Opening put buys per opening call buy, the feed's counts at " + (timeOf(r.pulse.at) || DASH) }, F.px(r.pulse.ratio, 2))
        : dashCell(r.pulse && r.pulse.calls === 0 ? "no opening call buys" : COPY.dash.notRead)],
    ];
    const row = h("div", {
      class: "er-row", role: "row", tabindex: i === 0 ? "0" : "-1", "data-t": r.t,
      "aria-label": r.t + ", reports " + F.day(r.d) + ", implied " + moveText(r.emNow) + ", today against past " + multiple(r.todayR, 2) + ", " + COPY.verdict[hist.verdict ? hist.verdict : "few"].word,
    }, cells.map(([k, node]) => h("div", { class: "er-c c-" + k, role: "cell", "data-col": k }, node)));
    row.addEventListener("click", (ev) => { if (!ev.target.closest("a")) openRiskDrill(r); });
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target === row) { ev.preventDefault(); openRiskDrill(r); return; }
      const dir = ev.key === "ArrowDown" ? 1 : ev.key === "ArrowUp" ? -1 : 0;
      if (!dir) return;
      const rows = [...row.parentElement.querySelectorAll(".er-row:not(.fd-cut)")];
      const next = rows[rows.indexOf(row) + dir];
      if (!next) return;
      ev.preventDefault();
      for (const x of rows) x.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });
    return row;
  }

  function paintRisk(d) {
    const host = hosts.risk;
    const risk = d && d.risk;
    const st = sectionState(risk, "the report window");
    if (st.state !== "ok" || !risk.rows.length) {
      silence(host, risk && risk.status === "quiet" ? { state: "quiet", reason: "No name in the report window carries a record to set against." } : st, COPY.titles.risk);
      setStamp(host, d, false);
      return;
    }
    const counts = risk.pooled || {};
    const strip = h("div", { class: "er-strip" }, chipRow(counts), h("p", { class: "er-pool", title: isNum(risk.pooled && risk.pooled.n) ? COPY.pool.names(risk.pooled.n) + " " + COPY.pool.describe : COPY.pool.few }, poolLines(risk.pooled)));
    const head = h("div", { class: "er-th", role: "row" }, Object.entries(COPY.cols).map(([k, t]) => h("div", { class: "er-c c-" + k, role: "columnheader", "data-col": k }, t)));
    const rows = h("div", { class: "er-rows" }, risk.rows.map(riskRow));
    const noPulse = risk.rows.filter((r) => !r.pulse).length;
    const noNatr = risk.rows.filter((r) => r.natr === null).length;
    const foot = h("p", { class: "er-foot" },
      "Ordered by report date, then name. " + risk.rows.length + " " + plural(risk.rows.length, "name", "names") + " in the window; " + (counts.few || 0) + " with too few reports. " +
      (noNatr ? noNatr + " without NATR. " : "") + (noPulse ? noPulse + " without opening counts. " : "") + COPY.honesty.pulse);
    host.replaceChildren(strip, h("div", { class: "er-table", role: "table", "aria-label": "Report risk by name" }, head, rows), foot);
    setState(host, { state: d.basis && d.basis.shed && d.basis.shed.length ? "quiet" : "ok", reason: COPY.honesty.shed }, COPY.titles.risk);
    if (!(d.basis && d.basis.shed && d.basis.shed.length)) setState(host, { state: "ok" }, COPY.titles.risk);
    setStamp(host, d, staleData(d));
  }

  function openSheet(title, build) {
    const dlg = document.getElementById("erDrill");
    if (!dlg) return;
    dlg.querySelector("#erDrillT").textContent = title;
    const body = dlg.querySelector("#erDrillB");
    body.replaceChildren(build());
    if (!dlg.open) dlg.showModal();
    dlg.dataset.opener = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.t || "" : "";
  }

  const sheet = document.getElementById("erDrill");
  let returnTo = null;
  if (sheet) {
    sheet.addEventListener("click", (ev) => { if (ev.target === sheet || ev.target.closest("[data-er-close]")) sheet.close(); });
    sheet.addEventListener("close", () => { if (returnTo && returnTo.isConnected) returnTo.focus(); returnTo = null; });
  }
  const remember = () => { returnTo = document.activeElement && document.activeElement !== document.body ? document.activeElement : null; };

  function stripChart(r) {
    const evs = (r.ev || []).slice().reverse();
    const W = 360, H = 140, padL = 8, padB = 20, padT = 22;
    const svg = s("svg", { class: "er-chart", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Past reports: realised move bars against the implied move tick" });
    const vals = evs.flatMap((e) => [isNum(e[1]) ? Math.abs(e[1]) : 0, isNum(e[2]) ? Math.abs(e[2]) : 0]);
    const top = Math.max(0.02, ...vals) * 1.15;
    const slot = (W - padL * 2) / Math.max(1, evs.length);
    const y = (v) => H - padB - (v / top) * (H - padB - padT);
    s("line", { x1: padL, x2: W - padL, y1: H - padB, y2: H - padB, class: "er-axis-l" }, svg);
    evs.forEach((e, i) => {
      const cx = padL + slot * (i + 0.5);
      const bw = Math.max(6, slot * 0.5);
      if (isNum(e[2])) {
        const up = e[2] > 0;
        s("rect", { x: cx - bw / 2, y: y(Math.abs(e[2])), width: bw, height: Math.max(1, H - padB - y(Math.abs(e[2]))), class: "er-bar " + (up ? "is-up" : e[2] < 0 ? "is-down" : "is-flat") }, svg);
      }
      if (isNum(e[1])) s("line", { x1: cx - bw / 2 - 3, x2: cx + bw / 2 + 3, y1: y(Math.abs(e[1])), y2: y(Math.abs(e[1])), class: "er-tick" }, svg);
      if (isNum(e[3])) s("path", { d: e[3] > 0 ? "M" + cx + " 6 l4.5 8 h-9z" : e[3] < 0 ? "M" + cx + " 14 l4.5 -8 h-9z" : "M" + (cx - 4.5) + " 9 h9 v3 h-9z", class: "er-sx " + (e[3] > 0 ? "is-up" : e[3] < 0 ? "is-down" : "is-flat") }, svg);
      s("text", { x: cx, y: H - 6, class: "er-xl", "text-anchor": "middle", text: e[0].slice(2, 7) }, svg);
    });
    return svg;
  }

  function twinTable(r) {
    const rows = (r.ev || []).map((e) => h("tr", null,
      h("td", null, F.day(e[0]) + " " + e[0].slice(0, 4)),
      h("td", null, isNum(e[1]) ? moveText(e[1]) : DASH),
      h("td", null, isNum(e[2]) ? F.pct(e[2], 1, true) : DASH),
      h("td", null, isNum(e[3]) ? F.pct(e[3], 1, true) : DASH)));
    return h("details", { class: "er-twin" }, h("summary", null, "Table of the same reports"),
      h("table", { class: "er-tt" }, h("thead", null, h("tr", null, ["Report", "Implied", "Moved", "Surprise"].map((t) => h("th", { scope: "col" }, t)))), h("tbody", null, rows)));
  }

  function finFigures(card) {
    const out = { rev: null, margin: null, fcf: null, cur: null, why: {} };
    const er = card && card.er && card.er.parts && card.er.parts.fin && card.er.parts.fin.x && card.er.parts.fin.x.ok ? card.er.parts.fin.x : null;
    let rows = null;
    if (er) { rows = er.q.map((q) => ({ d: q[0], rev: q[1], oi: q[3], ocf: q[5], capex: q[6] })); out.cur = er.cur; }
    else if (card && card.fin && card.fin.x && card.fin.x.ok && card.fin.x.q) {
      const x = card.fin.x;
      const by = new Map();
      for (const r of x.q.inc || []) by.set(r.d, { d: r.d, rev: r.rev, oi: r.oi });
      for (const r of x.q.cf || []) by.set(r.d, { ...(by.get(r.d) || { d: r.d }), ocf: r.ocf, capex: r.capex });
      rows = [...by.values()].sort((a, b) => (a.d < b.d ? 1 : -1));
      out.cur = x.currency || null;
    }
    if (!rows || !rows.length) { const why = "No statement rows are held for this name."; out.why = { rev: why, margin: why, fcf: why }; return out; }
    const last = rows[0];
    const prior = rows.find((q) => { const gap = (dayMs(last.d) - dayMs(q.d)) / 864e5; return gap > 335 && gap < 395; });
    if (isNum(last.rev) && last.rev > 0 && prior && isNum(prior.rev) && prior.rev > 0) out.rev = last.rev / prior.rev - 1;
    else out.why.rev = prior ? "Revenue is not stated for one of the two quarters." : "No quarter a year earlier is held.";
    if (isNum(last.oi) && isNum(last.rev) && last.rev > 0) out.margin = last.oi / last.rev;
    else out.why.margin = "Operating income or revenue is not stated.";
    if (isNum(last.ocf) && isNum(last.capex) && last.capex >= 0) out.fcf = last.ocf - last.capex;
    else out.why.fcf = isNum(last.capex) && last.capex < 0 ? "The capital spending sign is not stated." : "Cash flow figures are not stated.";
    out.asOf = last.d;
    return out;
  }

  function finBlock(card, state) {
    const box = h("dl", { class: "er-fin" });
    if (state === "loading") { box.append(h("dt", null, "Last report"), h("dd", null, "Loading the statements.")); return box; }
    if (state === "failed") { box.append(h("dt", null, "Last report"), h("dd", null, DASH + " The statements could not be read.")); return box; }
    const f = finFigures(card);
    const dollar = (v) => (isNum(v) ? F.money(v, true) : DASH);
    const rows = [
      ["Revenue, year on year", isNum(f.rev) ? F.pct(f.rev, 1, true) : DASH, f.why.rev],
      ["Operating margin", isNum(f.margin) ? F.pct(f.margin, 1) : DASH, f.why.margin],
      ["Free cash flow", dollar(f.fcf), f.why.fcf],
    ];
    for (const [k, v, why] of rows) box.append(h("dt", null, k), h("dd", null, v, v === DASH && why ? h("span", { class: "er-why" }, " " + why) : null));
    if (f.cur && f.cur !== "USD") box.append(h("dt", null, "Currency"), h("dd", null, f.cur));
    return box;
  }

  function openRiskDrill(r) {
    remember();
    const fin = h("div", { class: "er-fin-host" }, finBlock(null, "loading"));
    openSheet(r.t + (r.sec ? " " + MID + " " + r.sec : ""), () => h("div", { class: "er-drill" },
      h("p", { class: "er-d-lead" }, "Reports " + F.day(r.d) + (r.when && r.at ? ", " + COPY.reports[r.when].toLowerCase() + " at " + timeOf(r.at) : ", " + COPY.dash.timeNotStated.toLowerCase()) + "."),
      verdictChip(r.hist.verdict, verdictTitle(r.hist)),
      r.ev && r.ev.length ? stripChart(r) : h("p", { class: "er-mut" }, DASH + " " + COPY.honesty.few),
      h("p", { class: "er-legend" }, h("i", { class: "er-lg-bar" }), "Moved after the report ", h("i", { class: "er-lg-tick" }), "Implied move ", UI.glyph("up", "er-lg-tri"), UI.glyph("down", "er-lg-tri"), "Earnings surprise"),
      r.ev && r.ev.length ? twinTable(r) : null,
      fin,
      h("a", { class: "er-open", href: tickerHref(r.t) }, COPY.drill.open + " " + r.t)));
    cardOf(r.t).then((card) => fin.replaceChildren(finBlock(card, "ok")), () => fin.replaceChildren(finBlock(null, "failed")));
  }

  function cardOf(t) {
    if (S.cards.has(t)) return S.cards.get(t);
    const p = fetchJson("/api/flows/eventrisk?t=" + encodeURIComponent(t)).then((res) => (res ? res.body : null));
    S.cards.set(t, p);
    p.catch(() => S.cards.delete(t));
    return p;
  }

  function quoteBlock(t, res) {
    const box = h("div", { class: "er-quote" });
    if (!res) return box;
    if (res.status === "unavailable") { box.append(h("p", { class: "er-mut" }, DASH + " The quote could not be read.")); return box; }
    if (res.status === "quiet") { box.append(h("p", { class: "er-mut" }, DASH + " The feed returned no quote for this name.")); return box; }
    const px = (c) => (isNum(c) ? F.px(c / 100, 2) : DASH);
    if (res.last) box.append(h("p", { class: "er-q-last" }, h("b", null, "Last $" + px(res.last.pxC)), res.last.at ? " at " + (F.time(res.last.at).replace(" TRT", "")) + " TRT" : ""));
    const side = (name, l) => h("p", { class: "er-q-side" }, name + " ", l ? h("b", null, "$" + px(l.pxC)) : DASH, l && isNum(l.size) ? " " + MID + " " + F.int(l.size) : "");
    box.append(side("Bid", res.bid), side("Ask", res.ask));
    if (res.crossed) box.append(h("span", { class: "er-v er-v-few" }, UI.glyph("pending", "er-vg"), h("span", null, COPY.drill.crossed)));
    if (res.session) box.append(h("p", { class: "er-mut" }, { regular: "Regular session", premarket: "Pre-market", postmarket: "After hours" }[res.session]));
    return box;
  }

  function openQuoteDrill(t, name) {
    remember();
    const host = h("div", { class: "er-quote-host" }, h("p", { class: "er-mut" }, "Loading the quote."));
    openSheet(t + (name ? " " + MID + " " + name : ""), () => h("div", { class: "er-drill" }, host, h("a", { class: "er-open", href: tickerHref(t) }, COPY.drill.open + " " + t)));
    const load = () => {
      host.replaceChildren(h("p", { class: "er-mut" }, "Loading the quote."));
      const cached = S.quotes.get(t);
      const done = (res) => host.replaceChildren(quoteBlock(t, res));
      if (cached) { done(cached); return; }
      fetchJson("/api/flows/eventrisk?part=quote&t=" + encodeURIComponent(t)).then((res) => {
        if (!res) return;
        S.quotes.set(t, res.body);
        done(res.body);
        if (res.stale) host.append(h("p", { class: "er-mut" }, "Held from an earlier read: the quote limit was reached."));
      }, (e) => {
        const limited = e && e.status === 429;
        host.replaceChildren(h("p", { class: "er-mut" }, DASH + " " + (limited ? COPY.drill.quoteLimit : "The quote could not be read.")),
          h("button", { type: "button", class: "er-retry", onclick: load }, COPY.drill.retry));
      });
    };
    load();
  }

  const tickerButton = (t, name) => h("button", { type: "button", class: "er-tk er-tkb", onclick: () => openQuoteDrill(t, name), "aria-haspopup": "dialog" }, String(t));

  function priceRange(r) {
    if (r.badRange) return dashCell(COPY.dash.rangeNotReadable);
    if (r.lo === null && r.hi === null) return dashCell(COPY.dash.rangeNotStated);
    const money = (c) => F.px(c / 100, 2);
    const cur = r.cur && r.cur !== "USD" ? r.cur + " " : "$";
    if (r.lo === null || r.hi === null) return h("span", { class: "er-n" }, cur + money(r.lo === null ? r.hi : r.lo), h("span", { class: "er-mut" }, " " + COPY.dash.rangeNotStated));
    return h("span", { class: "er-n" }, cur + money(r.lo) + " to " + (r.cur && r.cur !== "USD" ? "" : "$") + money(r.hi));
  }

  function pane(title, sub, list, key) {
    return h("section", { class: "er-pane", "data-pane": key, "aria-label": title }, h("header", { class: "er-ph" }, h("h3", null, title), sub ? h("span", { class: "er-mut" }, sub) : null), list);
  }

  function paintIssues(d) {
    const host = hosts.issues;
    const iss = d && d.issues;
    const st = sectionState(iss, "new issues");
    if (st.state === "unavailable" || st.state === "pending") { silence(host, st, COPY.titles.issues); setStamp(host, d, false); return; }
    const emptyLi = (text) => h("li", { class: "er-li is-empty" }, DASH + " " + text);
    const ipoList = (iss.ipos.rows || []).map((r) => h("li", { class: "er-li er-ipo" },
      h("span", { class: "er-when" }, h("b", null, F.day(r.d)), h("span", { class: "er-ed" }, sessionsText(r.s))),
      tickerButton(r.t, r.name), h("span", { class: "er-nm" }, r.name || DASH), h("span", { class: "er-ex" }, r.ex || DASH), priceRange(r)));
    const listedList = (iss.listed.rows || []).map((r) => h("li", { class: "er-li er-lst" },
      h("span", { class: "er-when" }, h("b", null, F.day(r.d))), tickerButton(r.t, r.name), h("span", { class: "er-nm" }, r.name || DASH), h("span", { class: "er-ex" }, r.ex || DASH)));
    const delList = (iss.delisted.rows || []).map((r) => h("li", { class: "er-li er-del" },
      h("span", { class: "er-when" }, h("b", null, F.day(r.d))), tickerButton(r.t, r.name), h("span", { class: "er-nm" }, r.name || DASH), h("span", { class: "er-ex" }, r.ex || DASH),
      r.u ? h("span", { class: "er-uni", title: "In the universe" }, "In the universe") : null));
    const why = (sub, none) => (sub.why ? (sub.why === "plan" ? COPY.honesty.plan : sub.why === "unread" ? COPY.honesty.pending : COPY.honesty.failed) : none);
    const panes = h("div", { class: "er-panes er-p3" },
      pane("IPOs", "next 3 months", h("ul", { class: "er-list" }, ipoList.length ? ipoList : [emptyLi(why(iss.ipos, "No issue is filed for the coming months."))]), "ipos"),
      pane("Listed", "last 30 days", h("ul", { class: "er-list" }, listedList.length ? listedList : [emptyLi(why(iss.listed, "No name listed in the last 30 days."))]), "listed"),
      pane("Delisted", "last 10 sessions", h("ul", { class: "er-list" }, delList.length ? delList : [emptyLi(why(iss.delisted, "No name was dropped in the last 10 sessions."))]), "delisted"));
    const seg = paneSwitch("Issues", [["ipos", "IPOs"], ["listed", "Listed"], ["delisted", "Delisted"]], panes);
    const read = iss.activeReadAt ? "Listings read " + (F.when(iss.activeReadAt) || DASH) + "." : "Listings not read yet.";
    const days = iss.delisted && iss.delisted.days && iss.delisted.days.length ? " Delisted dates read: " + iss.delisted.days.map(F.day).join(", ") + "." : "";
    host.replaceChildren(seg, panes, h("p", { class: "er-foot" }, read + days));
    setState(host, st.state === "ok" && iss.status === "partial" ? { state: "quiet", reason: "Some parts could not be read." } : { state: "ok" }, COPY.titles.issues);
    setStamp(host, d, staleData(d));
  }

  function paneSwitch(label, items, panes) {
    const seg = UI.segmented(label, items.map(([, t]) => ({ label: t })), (i) => { panes.dataset.show = items[i][0]; }, 0);
    panes.dataset.show = items[0][0];
    return h("div", { class: "er-switch" }, seg);
  }

  function dayAxis(date, bands, entries) {
    const axis = h("div", { class: "er-axis", role: "img", "aria-label": "TRT axis from 09:00 to 01:00 with the US session bands" });
    const min = (iso) => F.axis(iso, date);
    if (bands) {
      const seg = (a, b, cls) => {
        const x0 = axisPct(min(a)), x1 = axisPct(min(b));
        if (x0 === null || x1 === null || x1 <= x0) return;
        axis.append(h("i", { class: "er-band " + cls, style: { left: x0 + "%", width: x1 - x0 + "%" } }));
      };
      seg(bands.pre, bands.open, "is-ext");
      seg(bands.open, bands.close, "is-rth");
      seg(bands.close, bands.post, "is-ext");
    }
    for (const e of entries) {
      if (!e.at) continue;
      const x = axisPct(min(e.at));
      if (x === null) continue;
      axis.append(h("i", { class: "er-dot" + (e.phase === "rth" ? " in-rth" : ""), style: { left: x + "%" }, title: (timeOf(e.at) || "") + " " + (e.text || "") }));
    }
    for (const mark of [["09:00", 0], ["16:30", ((990 - AXIS_FROM) / AXIS_SPAN) * 100], ["01:00", 100]]) axis.append(h("span", { class: "er-tickl", style: { left: mark[1] + "%" } }, mark[0]));
    return axis;
  }

  function paintPolicy(d) {
    const host = hosts.policy;
    const pol = d && d.policy;
    const st = sectionState(pol, "the schedule");
    if (st.state === "unavailable" || st.state === "pending") { silence(host, st, COPY.titles.policy); setStamp(host, d, false); return; }
    const sched = pol.schedule || { rows: [], dates: [] };
    const bands = sched.bands || {};
    const groups = (sched.dates || []).slice(0, 4).map((date) => {
      const rows = sched.rows.filter((r) => r.d === date);
      return h("section", { class: "er-day", "aria-label": weekday(date) + " " + F.day(date) },
        h("header", { class: "er-dh" }, h("b", null, weekday(date)), h("span", null, F.day(date))),
        dayAxis(date, bands[date] || null, rows),
        h("ul", { class: "er-list" }, rows.map((r) => h("li", { class: "er-li er-ev" },
          h("span", { class: "er-time" }, r.at ? timeOf(r.at) : COPY.dash.timeNotStated),
          h("span", { class: "er-type" }, r.type || DASH),
          h("span", { class: "er-tx" }, r.text || DASH, r.where ? h("span", { class: "er-mut" }, " " + MID + " " + r.where) : null)))));
    });
    const posts = (pol.posts.rows || []).map((p) => h("li", { class: "er-li er-post" },
      h("div", { class: "er-pm" }, h("span", { class: "er-time" }, F.when(p.at) || DASH), p.phase ? h("span", { class: "er-ph-c is-" + p.phase }, COPY.phase[p.phase]) : null),
      h("p", { class: "er-ptx" }, p.text),
      p.tags && p.tags.length || p.tickers && p.tickers.length
        ? h("div", { class: "er-tags" }, (p.tags || []).map((t) => h("span", { class: "er-tag" }, COPY.policy.tags[t] || t)), (p.tickers || []).map((t) => tickerLink(t))) : null));
    const schedWhy = sched.why ? (sched.why === "plan" ? COPY.honesty.plan : COPY.honesty.failed) : null;
    const postsWhy = pol.posts.why ? (pol.posts.why === "plan" ? COPY.honesty.plan : COPY.honesty.failed) : null;
    const panes = h("div", { class: "er-panes er-p2" },
      pane("Schedule", "next sessions, TRT", groups.length ? h("div", { class: "er-days" }, groups) : h("ul", { class: "er-list" }, h("li", { class: "er-li is-empty" }, DASH + " " + (schedWhy || "No public schedule entry for the coming days."))), "schedule"),
      pane("Posts", "last 5 sessions", h("ul", { class: "er-list" }, posts.length ? posts : [h("li", { class: "er-li is-empty" }, DASH + " " + (postsWhy || "No post in the last five sessions."))]), "posts"));
    const seg = paneSwitch("Policy", [["schedule", "Schedule"], ["posts", "Posts"]], panes);
    host.replaceChildren(seg, panes, h("p", { class: "er-foot" }, COPY.policy.notice + (pol.posts.dropped ? " " + pol.posts.dropped + " not shown." : "")));
    setState(host, st.state === "ok" && pol.status === "partial" ? { state: "quiet", reason: "Some parts could not be read." } : { state: "ok" }, COPY.titles.policy);
    setStamp(host, d, staleData(d));
  }

  function haltRow(r, opts) {
    const reasonText = haltReason(r.reason);
    const state = COPY.halt.states[r.state] || (r.state ? r.state.charAt(0).toUpperCase() + r.state.slice(1).replace(/_/g, " ") : DASH);
    return h("li", { class: "er-li er-halt" + (opts.date ? " is-dated" : ""), "data-t": r.t },
      h("span", { class: "er-time" }, (opts.date ? (F.when(r.at) || DASH) : (F.time(r.at).replace(" TRT", "") + " TRT"))),
      tickerButton(r.t),
      h("span", { class: "er-hs is-" + (r.state || "none") }, state),
      h("span", { class: "er-hr" }, r.reason === null || r.reason === undefined ? DASH : reasonText !== null ? reasonText : (r.reason + " " + MID + " " + COPY.halt.unknownReason)),
      opts.open ? h("span", { class: "er-open-n", "data-since": String(r.ts) }, "open " + openMinutes(r.ts) + " min") : null);
  }

  const openMinutes = (ts) => Math.max(0, Math.floor((Date.now() - ts) / 60000));

  function liveHalts() {
    if (!UI.rt || typeof UI.rt.halts !== "function") return null;
    try { return UI.rt.halts(); } catch { return null; }
  }

  function marketWatched() {
    const m = UI.freshness && UI.freshness.market ? UI.freshness.market() : null;
    return !m || m.watched !== false;
  }

  function paintHalts(d) {
    const host = hosts.halts;
    if (!host) return;
    const liveStateNow = () => (!haltsOn ? "off" : liveHalts() === null ? "socket-only" : "ok");
    let liveState = liveStateNow();
    const h14 = d && d.halts14;
    const livePane = h("div", { class: "er-livebox" });
    const liveHead = h("p", { class: "er-livehead", role: "status" });
    const ul = h("ul", { class: "er-list", role: "log", "aria-live": "off", "aria-label": "Halts streamed now" });
    const paintLive = () => {
      liveState = liveStateNow();
      stateNow();
      if (liveState === "off") { liveHead.textContent = ""; ul.replaceChildren(h("li", { class: "er-li is-empty" }, DASH + " " + COPY.halt.off)); return; }
      if (liveState === "socket-only") { liveHead.textContent = ""; ul.replaceChildren(h("li", { class: "er-li is-empty is-warn" }, DASH + " " + COPY.halt.socketOnly)); return; }
      const rows = liveHalts() || [];
      const since = rows.since || null;
      const lastBy = new Map();
      for (const r of rows.slice().sort((a, b) => a.ts - b.ts)) lastBy.set(r.t, r);
      const opens = [...lastBy.values()].filter((r) => r.state === "halted" || r.state === "paused");
      liveHead.textContent = (since ? "Since " + (timeOf(since) || DASH) + " " + MID + " " : "") + opens.length + " open";
      if (!rows.length) { ul.replaceChildren(h("li", { class: "er-li is-empty" }, DASH + " " + (marketWatched() ? COPY.halt.noneYet : COPY.halt.closed))); return; }
      ul.replaceChildren(...rows.slice().sort((a, b) => b.ts - a.ts).map((r) => haltRow(r, { open: lastBy.get(r.t) === r && (r.state === "halted" || r.state === "paused") })));
      announceNew(rows);
    };
    const h14st = !h14 || h14.status === "pending" ? { state: "pending" } : h14.status === "unavailable" ? { state: "unavailable" } : { state: "ok" };
    const stateNow = () => {
      const hasState = liveState !== "ok" || h14st.state !== "ok" || (h14 && h14.configured === false);
      setState(host, hasState ? { state: "quiet", reason: liveState === "socket-only" ? COPY.halt.socketOnly : liveState === "off" ? COPY.honesty.pending : h14 && h14.configured === false ? COPY.halt.notConfigured : COPY.honesty.pending } : { state: "ok" }, COPY.titles.halts);
    };
    const archive = h("ul", { class: "er-list", "aria-label": "Halts in the last 14 days" });
    if (h14st.state !== "ok") archive.append(h("li", { class: "er-li is-empty" }, DASH + " " + (h14st.state === "pending" ? COPY.honesty.pending : COPY.honesty.failed)));
    else if (h14.configured === false) archive.append(h("li", { class: "er-li is-empty is-warn" }, DASH + " " + COPY.halt.notConfigured));
    else if (!h14.rows.length) archive.append(h("li", { class: "er-li is-empty" }, DASH + " " + COPY.halt.noneIn14));
    else for (const r of h14.rows) archive.append(haltRow(r, { date: true, open: false }));
    const archivePane = pane("Last 14 days", "recorded on the feed account", archive, "days");
    const panes = liveState === "off" ? h("div", { class: "er-panes er-p1" }, archivePane) : h("div", { class: "er-panes er-p2" }, pane("Live", "streamed now", livePane, "live"), archivePane);
    const seg = liveState === "off" ? null : paneSwitch("Halts", [["live", "Live"], ["days", "14 days"]], panes);
    host.replaceChildren(...(seg ? [seg] : []), panes, h("p", { class: "er-foot" }, "Times in TRT. A halt shows as open until a later row for the same name resumes it."));
    paintLive();
    livePane.append(liveHead, ul);
    S.paintLive = paintLive;
    setStamp(host, d, staleData(d));
    if (S.timer === null) S.timer = setInterval(() => { if (!document.hidden) refreshOpenCounts(); }, 60000);
    if (UI.rt && typeof UI.rt.on === "function" && !S.rtBound) { S.rtBound = true; try { UI.rt.on("ht", () => S.paintLive && S.paintLive()); } catch { S.rtBound = false; } }
  }

  function refreshOpenCounts() {
    for (const el of document.querySelectorAll(".er-open-n[data-since]")) el.textContent = "open " + openMinutes(Number(el.dataset.since)) + " min";
  }

  function announceNew(rows) {
    const live = document.getElementById("erSay") || (() => { const n = h("p", { class: "visually-hidden", id: "erSay", role: "status", "aria-live": "polite" }); document.body.append(n); return n; })();
    for (const r of rows) {
      const key = r.id || r.t + "|" + r.ts;
      if (S.haltsSeen.has(key)) continue;
      S.haltsSeen.add(key);
      if (!S.firstSeen) continue;
      S.sayQueue.push(r);
    }
    S.firstSeen = true;
    const flush = () => {
      if (!S.sayQueue.length || Date.now() - S.said < 5000) return;
      const r = S.sayQueue.shift();
      S.said = Date.now();
      const rs = haltReason(r.reason);
      live.textContent = r.t + " " + (COPY.halt.states[r.state] || r.state || "") .toLowerCase() + (rs ? ", " + rs.toLowerCase() : "") + ", " + (timeOf(new Date(r.ts).toISOString()) || "");
    };
    flush();
    if (S.sayQueue.length && !S.sayTimer) S.sayTimer = setInterval(() => { flush(); if (!S.sayQueue.length) { clearInterval(S.sayTimer); S.sayTimer = null; } }, 1000);
  }

  function weekMarks(weekHost) {
    const d = S.data;
    if (!weekHost || !d) return;
    const grid = weekHost.querySelector(".fe-week");
    if (!grid || grid.dataset.erMarks) return;
    const cols = [...grid.querySelectorAll(":scope > .fe-col:not(.fe-labels)")];
    const dayOf = (col) => col.dataset.day || null;
    const ipos = d.issues && d.issues.ipos && d.issues.ipos.rows ? d.issues.ipos.rows : [];
    const sched = d.policy && d.policy.schedule && d.policy.schedule.rows ? d.policy.schedule.rows : [];
    const have = cols.map((c) => ({ c, day: dayOf(c) })).filter((x) => x.day);
    if (!have.length) return;
    const mark = have.map((x) => ({ ...x, ipos: ipos.filter((r) => r.d === x.day), pol: sched.filter((r) => r.d === x.day) }));
    if (!mark.some((m) => m.ipos.length || m.pol.length)) return;
    grid.dataset.erMarks = "1";
    const rows = Number(grid.style.getPropertyValue("--rows")) || 4;
    grid.style.setProperty("--rows", String(rows + 1));
    const labels = grid.querySelector(":scope > .fe-labels");
    if (labels) labels.append(h("div", { class: "fe-lane" }, h("span", null, "Issues and policy")));
    for (const m of mark) {
      const cell = h("div", { class: "fe-cell fe-c-er", "data-lane": "Issues and policy" },
        m.ipos.slice(0, 3).map((r) => h("a", { class: "fe-pill er-ipo", href: tickerHref(r.t), title: "IPO: " + (r.name || r.t) }, h("b", null, r.t), h("span", null, "IPO"))),
        m.ipos.length > 3 ? h("span", { class: "fe-none" }, "+" + (m.ipos.length - 3)) : null,
        m.pol.length ? h("span", { class: "fe-pill er-pol", title: m.pol.map((r) => (r.at ? timeOf(r.at) : COPY.dash.timeNotStated)).join(", ") }, h("b", null, String(m.pol.length)), h("span", null, "Policy")) : null);
      m.c.append(cell);
    }
  }

  function chip() {
    const meta = document.getElementById("evMeta");
    if (!meta || meta.querySelector(".er-chip")) return;
    meta.append(h("span", { class: "er-chip", title: COPY.chipTitle }, UI.glyph("live", "er-vg"), COPY.chip));
  }

  function wireInfos() {
    setInfo(hosts.risk, "report risk", COPY.info.risk);
    setInfo(hosts.issues, "new issues", COPY.info.issues);
    setInfo(hosts.policy, "the policy calendar", COPY.info.policy);
    setInfo(hosts.halts, "halts", COPY.info.halts);
  }

  function failAll(kind, text) {
    const st = { state: kind === "pending" ? "pending" : "unavailable", reason: text };
    for (const [k, host] of Object.entries(hosts)) if (host) silence(host, st, COPY.titles[k]);
  }

  function mount() {
    if (S.mounted) return S.mounted;
    S.mounted = cssReady.then(() => fetchJson("/api/flows/eventrisk")).then((res) => {
      if (!res) return null;
      const d = res.body;
      wireInfos();
      chip();
      if (!d || d.status === "pending") { failAll("pending", COPY.honesty.pending); return d; }
      S.data = d;
      paintRisk(d);
      paintIssues(d);
      paintPolicy(d);
      paintHalts(d);
      return d;
    }, (e) => {
      wireInfos();
      failAll("failed", COPY.honesty.failed + " (" + (e && e.message ? e.message : "request failed") + ")");
      return null;
    });
    return S.mounted;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, {
    er: Object.freeze({ mount, weekMarks, model: Object.freeze({ finFigures, axisPct, haltReason, COPY, HALT_REASONS }), fmt: Object.freeze({ moveText, multiple, sessionsText }) }),
  }));
})();
