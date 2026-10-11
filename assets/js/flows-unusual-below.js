(() => {
  "use strict";

  const UI = window.FlowsUI;
  const kit = UI && UI.flowKit;
  if (!kit) return;
  const { h, s, F, chart: C } = UI;
  const DASH = UI.DASH, MID = UI.MID;
  const {
    S, host, charts, n, count, pct0, plural, instant, etOf, clock, hourLabel, cardKey, tickerHref, contractText, joinKey, passes,
    setModuleState, silence, def, vendorCeilingSaid,
  } = kit;

  const mark = (st) => h("span", { class: "ui-dash" }, DASH, h("span", { class: "ui-state", "data-state": st.state, title: def(st).word }, UI.glyph(def(st).g)));
  const keep = (hostEl, paint) => {
    const open = !!hostEl.querySelector('.ui-disclose[aria-expanded="true"]');
    paint();
    const b = open && hostEl.querySelector(".ui-disclose");
    if (b) b.click();
  };

  function timeOf(r, session) {
    const span = etOf(r.spanStart);
    if (span && (!session || span.day === session)) return { m: span.m, exact: true };
    const first = etOf(r.firstAt);
    if (first && (!session || first.day === session) && first.m >= 240 && first.m <= 1200) return { m: first.m, exact: false };
    return null;
  }

  function points() {
    const a = S.alerts;
    const session = typeof a.sessionDate === "string" ? a.sessionDate : a.record && a.record.date;
    const out = [];
    let undated = 0;
    a.rows.forEach((r, i) => {
      const p = n(r.prem);
      const at = timeOf(r, session);
      if (p === null || p <= 0 || !at) { undated++; return; }
      const ask = n(r.askPrem);
      out.push({ r, i, p, m: at.m, exact: at.exact, cp: r.cp === "P" ? "P" : r.cp === "C" ? "C" : null, ask: ask === null ? null : Math.max(0, Math.min(1, ask / p)) });
    });
    return { pts: out, undated, session };
  }

  function drawTimeline(el, w, animate) {
    const a = S.alerts;
    const { pts } = points();
    const phone = w < 600;
    const H = phone ? 250 : w < 900 ? 290 : 330;
    const left = 4, right = phone ? 46 : 54, top = 18, bot = 24;
    if (!pts.length) {
      el.append(UI.silent({ state: "quiet", reason: "No flagged window in this record carries a time inside the session." }, "Timeline", H));
      return;
    }
    const rec = a.record && typeof a.record === "object" ? a.record : null;
    const recStart = rec ? etOf(rec.firstReadAt) : null;
    const lo = Math.min(...pts.map((p) => p.m), recStart ? recStart.m : Infinity);
    const hi = Math.max(...pts.map((p) => p.m));
    const x0 = Math.max(540, Math.floor(lo / 30) * 30 - 30);
    const x1 = Math.max(x0 + 180, Math.ceil((hi + 10) / 30) * 30);
    const xs = C.lin(x0, x1, left + 14, w - right - 14);
    const mid = top + (H - top - bot) / 2;
    const half = (H - top - bot) / 2;
    const pMax = Math.max(...pts.map((p) => p.p));
    const pMin = Math.min(...pts.map((p) => p.p));
    const rMax = phone ? 9 : 13;
    const rOf = (p) => Math.max(2.5, rMax * Math.sqrt(p / pMax));
    const l0 = Math.log10(Math.min(pMin, 1e5)), l1 = Math.log10(Math.max(pMax, 1e6));
    const dist = (p) => 5 + ((Math.log10(p) - l0) / ((l1 - l0) || 1)) * (half - 8 - rMax);
    const yOf = (pt) => (pt.cp === "P" ? mid + dist(pt.p) : mid - dist(pt.p));
    const svg = C.svgRoot(el, w, H, animate, "Flagged windows over the session: calls above the line, puts below, farther and larger is more premium");
    const defs = s("defs", null, svg);
    const pat = s("pattern", { id: "fuHatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    s("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "fu-hatch" }, pat);
    if (recStart && recStart.m > x0 + 10 && (!pts.length || recStart.m <= x1)) {
      const rx = Math.min(xs(recStart.m), w - right);
      s("rect", { x: left, y: top, width: Math.max(0, rx - left), height: H - top - bot, fill: "url(#fuHatch)", class: "fu-unrec" }, svg);
    }
    const step = xs(x0 + 60) - xs(x0) >= 44 ? 60 : 120;
    for (let m = Math.ceil(x0 / 60) * 60; m <= x1; m += step) {
      const x = xs(m);
      if (x < left + 16 || x > w - right - 8) continue;
      s("text", { x, y: H - 6, text: hourLabel(m), "text-anchor": "middle" }, svg);
    }
    s("line", { x1: left, x2: w - right, y1: mid, y2: mid, class: "base" }, svg);
    const tx = w - right + 8;
    for (const v of [1e5, 1e6, 1e7]) {
      const lv = Math.log10(v);
      if (lv < l0 || lv > l1) continue;
      const d = dist(v);
      if (d > half - 4) continue;
      s("line", { x1: left, x2: w - right, y1: mid - d, y2: mid - d, class: "hair" }, svg);
      s("line", { x1: left, x2: w - right, y1: mid + d, y2: mid + d, class: "hair" }, svg);
      s("text", { x: tx, y: mid - d + 3.8, text: F.money(v, false, 0), class: "tx-3" }, svg);
      s("text", { x: tx, y: mid + d + 3.8, text: F.money(v, false, 0), class: "tx-3" }, svg);
    }
    s("text", { x: tx, y: top + 4, text: "Calls", class: "tx-1 tx-b" }, svg);
    s("text", { x: tx, y: H - bot - 2, text: "Puts", class: "tx-1 tx-b" }, svg);
    const order = pts.slice().sort((p, q) => q.p - p.p);
    const g = s("g", { class: "fu-bubbles" }, svg);
    const placed = order.map((pt, k) => {
      const cx = xs(pt.m), cy = yOf(pt), r = rOf(pt.p);
      const on = passes(pt.r, "exp");
      const color = UI.cssVar(pt.cp === "P" ? "--down-mark" : pt.cp === "C" ? "--up-mark" : "--s-gray");
      s("circle", {
        cx, cy, r, fill: color, "fill-opacity": pt.ask === null ? 0 : (0.14 + 0.72 * pt.ask).toFixed(3),
        stroke: color, "stroke-width": 1.25, "stroke-dasharray": pt.ask === null ? "2 2" : null,
        class: "fu-b" + (on ? "" : " is-off"), style: { "--i": String(Math.min(k, 60)) },
      }, g);
      return { pt, cx, cy, r };
    });
    const list = placed.slice().sort((p, q) => p.cx - q.cx || q.pt.p - p.pt.p);
    C.scrub(el, svg, {
      xs: list.map((b) => b.cx), ys: list.map((b) => b.cy), rs: list.map((b) => b.r), yw: 0.6, first: true, xh: 0.5,
      top, bottom: H - bot, label: "Flagged windows over the session", ariaHint: "Use the arrow keys to read each window.",
      onMove: (i) => {
        const b = list[i], r = b.pt.r;
        const flags = [r.sweep === true ? "Sweep" : null, r.opening === true ? "Opening" : null, r.floor === true ? "Floor" : null].filter(Boolean);
        return {
          x: b.cx, top: Math.max(0, b.cy - b.r - 40), dots: [{ x: b.cx, y: b.cy, r: b.r + 3, cls: "fu-ring", fill: "none" }],
          parts: [
            C.part(clock(b.pt.m) + (b.pt.exact ? "" : " first held"), "k"),
            h("b", null, String(r.t || DASH)),
            C.part(contractText(r).trim(), "k"),
            h("b", { "data-tone": b.pt.cp === "P" ? "down" : "up" }, F.money(b.pt.p)),
            C.part(b.pt.ask === null ? "ask —" : "ask " + pct0(b.pt.ask), "k"),
            flags.length ? C.part(flags.join(" " + MID + " "), "k") : null,
          ],
        };
      },
    });
  }

  C.kind("flagged", {
    draw: drawTimeline,
    data: () => {
      const by = points().pts.sort((p, q) => p.m - q.m);
      return { title: "Flagged windows", x: by.map((p) => clock(p.m)), cols: [{ label: "Premium", values: by.map((p) => p.p), fmt: (v) => F.money(v) }] };
    },
  });

  function timelineInfo() {
    const a = S.alerts || {};
    const notes = a.notes && typeof a.notes === "object" ? a.notes : {};
    const rows = Array.isArray(a.rows) ? a.rows : [];
    const seen = n(a.seen), shed = n(a.shed);
    const { undated } = S.alertsKind === "ok" ? points() : { undated: 0 };
    const floor = a.vendorTruncated === true || a.readTruncated === true;
    const cov = a.coverage && typeof a.coverage === "object" ? a.coverage : {};
    const rec = a.record && typeof a.record === "object" ? a.record : {};
    return {
      title: "Flagged windows",
      state: S.alertsState.state === "ok" ? null : S.alertsState.state,
      asOf: typeof a.sessionDate === "string" ? a.sessionDate : null,
      lead: "Each bubble is one window the vendor's rules flagged, placed at the vendor's stated start or, without one, at the read that first held it. Calls sit above the line and puts below; distance and size both grow with premium, and a solid fill means the vendor put most of the window's dollars on the ask side.",
      facts: [
        ["Read", instant(a.readAt)],
        ["Windows", rows.length ? count(rows.length) + (seen === null ? " windows" : " of " + (floor ? "at least " : "") + count(seen) + " flagged windows") : null],
        ["Shed by the row cap", shed === null ? (seen !== null && seen > rows.length ? "not recorded on this payload" : null) : count(shed)],
        ["Not placed", undated ? count(undated) + " without a time in the session" : null],
        ["Reads", n(rec.reads) === null ? null : count(rec.reads)],
        ["Entered the record", n(rec.everEntered) === null ? null : count(rec.everEntered)],
        ["Calls / puts", n(cov.calls) === null ? null : count(cov.calls) + " / " + count(cov.puts)],
      ],
      sections: [
        { title: "What a window is", lines: [notes.unit, notes.selection] },
        { title: "Sides and flags", lines: [notes.sides, notes.flags, "Each row carries the vendor's own stated span, in UTC."] },
        { title: "The record", lines: [notes.record] },
        { title: "The ceiling", lines: [vendorCeilingSaid().trim()] },
        { title: "Refused", lines: [notes.refusals] },
      ],
    };
  }

  function paintTimeline(animate) {
    if (S.alertsKind !== "ok") return;
    const rows = S.alerts.rows;
    if (!rows.length) {
      silence(host.timeline, S.alertsState, "Timeline", 250);
      return;
    }
    if (charts.timeline && charts.timeline.el === host.timeline.querySelector(".fu-chart")) {
      charts.timeline.el._scrubAt = -1;
      charts.timeline.redraw(animate);
      return;
    }
    const chartHost = h("div", { class: "fu-chart" });
    const legend = UI.legend([
      ["--up-mark", "dot", "Call"], ["--down-mark", "dot", "Put"],
      UI.key("--label-1", "dot", "Ask side"), UI.key("--label-1", "ring", "Not ask side"),
      rows.some((r) => n(r.askPrem) === null) ? h("span", { class: "ui-key" }, h("i", { class: "fu-key-open", "aria-hidden": "true" }), "Ask side not stated") : null,
      h("span", { class: "ui-key" }, h("i", { class: "fu-key-hatch", "aria-hidden": "true" }), "Not recorded"),
    ].filter(Boolean));
    host.timeline.replaceChildren(chartHost, legend);
    charts.timeline = C.plot(chartHost, { kind: "flagged" });
  }

  function aggregate(rows) {
    const by = new Map();
    for (const r of rows) {
      const t = String(r.t || "");
      const p = n(r.prem);
      if (!t || p === null || p <= 0) continue;
      if (!by.has(t)) by.set(t, { t, n: 0, prem: 0, call: 0, put: 0, askP: 0, askW: 0, swP: 0, swW: 0, opP: 0, opW: 0, st: r.st || null });
      const g = by.get(t);
      g.n++; g.prem += p;
      if (r.cp === "C") g.call += p; else if (r.cp === "P") g.put += p;
      const ask = n(r.askPrem);
      if (ask !== null) { g.askP += ask; g.askW += p; }
      if (typeof r.sweep === "boolean") { g.swW += p; if (r.sweep) g.swP += p; }
      if (typeof r.opening === "boolean") { g.opW += p; if (r.opening) g.opP += p; }
      if (!g.st && r.st) g.st = r.st;
    }
    return [...by.values()].map((g) => ({
      ...g,
      ask: g.askW ? g.askP / g.askW : null,
      sweep: g.swW ? g.swP / g.swW : null,
      open: g.opW ? g.opP / g.opW : null,
    })).sort((a, b) => b.prem - a.prem);
  }

  const shareCell = (v, hot) => h("span", { class: "fu-v fu-share", "data-tone": v !== null && v >= hot ? "flat" : null, "data-hot": v !== null && v >= hot ? "1" : null }, pct0(v));
  const sideGlyph = (st) => (st === "board:long" || st === "long" ? UI.glyph("up", "fu-side is-up") : st === "board:short" || st === "short" ? UI.glyph("down", "fu-side is-down") : null);
  const linkable = (st) => !!st && st !== "foreign";

  function paintNames() {
    if (S.alertsKind !== "ok") return;
    const rows = S.alerts.rows.filter((r) => passes(r, "exp"));
    if (!S.alerts.rows.length) { silence(host.names, S.alertsState, "Names", 200); return; }
    const groups = aggregate(rows);
    setModuleState(host.names, { state: "ok" }, "Names");
    if (!groups.length) {
      host.names.replaceChildren(UI.silent({ state: "quiet", reason: "No flagged window matches the filter. Every window is still published; the filter hides them." }, "Names", 180));
      return;
    }
    const max = groups[0].prem;
    const head = h("div", { class: "fu-nrow fu-head", "aria-hidden": "true" },
      h("span", null, "Name"), h("span", null, "Calls · puts"), h("span", { class: "fu-v" }, "Premium"),
      h("span", { class: "fu-v" }, "Ask"), h("span", { class: "fu-v fu-wide" }, "Sweep"), h("span", { class: "fu-v fu-wide" }, "Open"));
    const items = groups.map((g, i) => {
      const tag = linkable(g.st) ? "a" : "div";
      const scale = g.prem / max;
      const cw = g.call + g.put ? (g.call / (g.call + g.put)) * scale * 100 : 0;
      const pw = g.call + g.put ? (g.put / (g.call + g.put)) * scale * 100 : 0;
      const row = h(tag, {
        class: "fu-nrow", href: tag === "a" ? tickerHref(g.t) : null, role: tag === "a" ? null : "listitem",
        title: g.t + " " + MID + " " + g.n + plural(g.n, " window", " windows") + " " + MID + " " + F.money(g.prem) +
          " " + MID + " calls " + F.money(g.call) + ", puts " + F.money(g.put),
      },
      h("span", { class: "fu-tk is-2" }, h("span", { class: "fu-tk-l" }, h("b", null, g.t), sideGlyph(g.st)), h("small", null, g.n + plural(g.n, " window", " windows"))),
      h("span", { class: "fu-split", "aria-hidden": "true" },
        cw > 0 ? h("i", { class: "is-c", style: { width: cw.toFixed(2) + "%", "--i": String(i) } }) : null,
        pw > 0 ? h("i", { class: "is-p", style: { width: pw.toFixed(2) + "%", "--i": String(i) } }) : null),
      h("span", { class: "fu-v fu-strong" }, F.money(g.prem)),
      shareCell(g.ask, 0.6),
      h("span", { class: "fu-v fu-wide" }, pct0(g.sweep)),
      h("span", { class: "fu-v fu-wide" }, pct0(g.open)));
      return row;
    });
    keep(host.names, () => host.names.replaceChildren(head, listOf(items, 8, "Names ranked by flagged premium")));
  }

  function listOf(items, visible, label) {
    const box = UI.list(items, { visible, label });
    box.classList.add("fu-list");
    return box;
  }

  function namesInfo() {
    return {
      title: "Names",
      lead: "The flagged windows, summed by name and ranked by premium. The bar is the name's premium against the largest, split into calls and puts; Ask, Sweep and Open are premium-weighted shares of the windows that carry each vendor field.",
      notes: [
        "A share is taken only over windows where the vendor carried that field. A dash is a name with no window carrying it, not a zero.",
        "These are shares of what the vendor's rules flagged, not of the name's whole session.",
      ],
    };
  }

  async function paintUrgency() {
    if (S.alertsKind !== "ok" || S.feedKind === "pending") return;
    const cov = S.feedKind === "ok" && Array.isArray(S.payload.coverage) ? new Set(S.payload.coverage.map((c) => c && c.t)) : null;
    const board = aggregate(S.alerts.rows).filter((g) => (g.st === "board:long" || g.st === "board:short") && (!cov || cov.has(g.t))).slice(0, 6);
    const none = { state: "quiet", reason: "No deep board name is among the flagged windows. Urgency is read from each name's own alert tape, which the run keeps only for the names the board went deep on." };
    if (!board.length) { silence(host.urgency, none, "Urgency", 200); return; }
    const m = UI.freshness && UI.freshness.market ? UI.freshness.market() : null;
    const session = (S.payload && typeof S.payload.sessionDate === "string" && S.payload.sessionDate) || (m && m.expected) || null;
    const old = (al) => !!al && !!session && typeof al.asOf === "string" && al.asOf < session;
    const draw = () => {
      const got = board.map((g) => ({ g, u: S.urgency.get(g.t) })).filter((x) => !(x.u && x.u.shallow));
      if (!got.length) { silence(host.urgency, none, "Urgency", 200); return; }
      const vals = got.map((x) => (x.u && x.u.tape ? n(x.u.tape.urgency) : null)).filter((v) => v !== null);
      const max = vals.length ? Math.max(...vals, 1e-9) : 1;
      const w = UI.worst(got.map((x) => (!x.u ? { state: "pending", reason: "Reading this name's card." } : old(x.u.tape)
        ? { state: "stale", reason: x.g.t + "'s alert tape is from " + x.u.tape.asOf + ", before the last completed session, " + session + "." } : x.u.st)));
      setModuleState(host.urgency, w.state === "ok" ? { state: "ok" } : w.state === "stale" || !vals.length ? w : { state: "quiet", reason: w.reason }, "Urgency");
      const ranked = got.slice().sort((a, b) => (n(b.u && b.u.tape && b.u.tape.urgency) ?? -1) - (n(a.u && a.u.tape && a.u.tape.urgency) ?? -1));
      const items = ranked.map((x, i) => {
        const al = x.u && x.u.tape;
        const u = al ? n(al.urgency) : null;
        const st = x.u ? x.u.st : { state: "pending", reason: "Reading this name's card." };
        const floor = !!al && al.complete === false;
        const late = old(al);
        return h("a", { class: "fu-urow", href: tickerHref(x.g.t),
          title: al ? x.g.t + " " + MID + " tape of " + (al.asOf || "an unstated session") + (floor ? ", cut short before the open, so a floor" : "") + (late ? ", older than the last completed session, " + session : "") : null },
          h("span", { class: "fu-tk is-2" }, h("span", { class: "fu-tk-l" }, h("b", null, x.g.t), sideGlyph(x.g.st)),
            h("small", null, al && n(al.n) !== null ? count(al.n) + " alerts " + MID + " " + pct0(al.sweepShare) + " sweep" : st.state === "pending" ? "Pending" : DASH)),
          h("span", { class: "fu-meter", "aria-hidden": "true" }, u === null ? null : h("i", { style: { width: ((u / max) * 100).toFixed(1) + "%", "--i": String(i) } })),
          u === null ? mark(st.state === "ok" ? { state: "unavailable" } : st)
            : h("span", { class: "fu-v fu-strong", "data-tone": late ? "silent" : null }, (floor ? "≥" : "") + F.pct(u, 2), late ? mark({ state: "stale" }).lastChild : null));
      });
      host.urgency.replaceChildren(
        h("div", { class: "fu-urow fu-head", "aria-hidden": "true" }, h("span", null, "Name"), h("span", null, "Sweeps into new OI"), h("span", { class: "fu-v" }, "of ADV")),
        h("div", { class: "ui-list fu-list", role: "group", "aria-label": "Board names ranked by urgency" }, items));
    };
    draw();
    const queue = board.map((g) => g.t).filter((t) => !S.urgencyAsked.has(t));
    queue.forEach((t) => S.urgencyAsked.add(t));
    const one = async (t) => {
      try {
        const res = await fetch("/api/flows/card-x?t=" + encodeURIComponent(cardKey(t)), { credentials: "same-origin", headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const cx = await res.json();
        const { alerts: tape } = cx || {};
        if (cx && cx.status !== "pending" && !tape && cx.scope !== "deep") S.urgency.set(t, { shallow: true });
        else if (!cx || cx.status === "pending") S.urgency.set(t, { st: { state: "pending", reason: "This name's card extension has not been published yet." } });
        else if (!tape) S.urgency.set(t, { st: { state: "unavailable", reason: "This name's card carries no alert tape." } });
        else if (tape.status !== "ok") S.urgency.set(t, { st: UI.stateOf({ status: tape.status === "unreadable" ? "withheld" : tape.status, reason: tape.why ? "Vendor code: " + tape.why + "." : null }, "alert tape"), tape: null });
        else S.urgency.set(t, { st: { state: "ok" }, tape });
      } catch (e) {
        S.urgency.set(t, { st: { state: "unavailable", reason: "This name's card could not be loaded (" + (e && e.message ? e.message : "no message") + ")." } });
      }
      draw();
    };
    const lanes = [];
    for (let k = 0; k < 3; k++) lanes.push((async () => { while (queue.length) await one(queue.shift()); })());
    await Promise.all(lanes);
  }

  function urgencyInfo() {
    return {
      title: "Urgency",
      lead: "For the board names among the flagged windows, the premium of sweeps into contracts whose volume exceeded their open interest, as a share of the name's average daily dollar volume, read from each name's own full-session alert tape.",
      facts: [["Formula", "Σ premium · sweep · (volume > OI) ÷ ADV$"], ["Names", "up to six, by flagged premium"]],
      notes: ["A name without a published card extension shows the pending ring; a card without an alert tape shows the unavailable mark."],
    };
  }

  function feedRows() {
    return S.feedKind === "ok" ? S.payload.contracts.rows : [];
  }

  const CODES = ["sweep-coded", "floor-coded", "multi-leg", "stock multi-leg", "cross"];
  const activityOf = () => {
    const a = S.payload && S.payload.activity;
    return a && typeof a === "object" ? a : null;
  };
  const codeBase = (r) => {
    const own = n(r.av);
    return own !== null && own > 0 ? own : n(r.vol);
  };
  const codeKnown = (r) => (Array.isArray(r.cls) ? r.cls.filter((c) => n(c) !== null).length : 0);
  const codeShares = (r) => {
    const v = codeBase(r);
    if (!Array.isArray(r.cls) || v === null || !(v > 0)) return [];
    return r.cls.map((c, i) => (n(c) === null || n(c) <= 0 ? null : [CODES[i], Math.min(1, n(c) / v)])).filter(Boolean);
  };
  const codeText = (r) => {
    const parts = codeShares(r);
    if (parts.length) return parts.map(([w, f]) => pct0(f) + " " + w).join(", ") + (n(r.av) !== null && n(r.av) !== n(r.vol) ? " of the screen's " + count(n(r.av)) + " contracts" : "");
    const known = codeKnown(r);
    if (known === 0) return "exchange-code shares not reported";
    if (known < CODES.length) return "none of the " + known + " reported code classes carried volume; " + (CODES.length - known) + " not reported";
    return "none of the volume carried a sweep, floor, multi-leg, stock multi-leg or cross code";
  };

  function activityRows() {
    const a = activityOf();
    if (!a || a.status !== "ok" || !Array.isArray(a.rows) || !a.rows.length) return [];
    return [
      h("div", { class: "fu-arow fu-head", "aria-hidden": "true" }, h("span"), h("span", null, "Largest by premium, " + F.day(String(a.asOf || ""))),
        h("span", { class: "fu-v" }, "Premium"), h("span", { class: "fu-v fu-wide" }, "Main code")),
      listOf(a.rows.slice(0, 8).map((r) => {
        const top = codeShares(r).sort((x, y) => y[1] - x[1])[0];
        return h("div", { class: "fu-arow", role: "listitem", title: String(r.t) + " " + contractText(r).trim() + " " + MID + " volume " + count(r.vol) + " " + MID + " " + codeText(r) },
          h("span", { class: "ui-badge", "data-tone": r.cp === "P" ? "down" : "up", "aria-label": r.cp === "P" ? "Put" : "Call" }, r.cp === "P" ? "P" : "C"),
          h("span", { class: "fu-tk" }, h("b", null, n(r.k) === null ? DASH : String(n(r.k))), h("small", null, String(r.t || DASH) + " " + MID + " " + F.day(String(r.expiry || "")))),
          h("span", { class: "fu-v fu-strong" }, n(r.pm) === null ? DASH : F.money(n(r.pm))),
          h("span", { class: "fu-v fu-wide" }, top ? pct0(top[1]) + " " + top[0] : (codeKnown(r) ? "no code" : "not reported")));
      }), 8, "Largest dated contracts by premium"),
    ];
  }

  function paintFeed() {
    if (S.feedKind !== "ok") return;
    const all = feedRows();
    const shown = all.filter((r) => passes(r, "expiry"));
    if (!all.length) { silence(host.feed, S.feedState, "Volume over OI", 220); return; }
    setModuleState(host.feed, { state: "ok" }, "Volume over OI");
    if (!shown.length) {
      host.feed.replaceChildren(UI.silent({ state: "quiet", reason: "No contract in this feed matches the filter. " + count(all.length) + " rows are published; the filter is hiding all of them." }, "Volume over OI", 180));
      return;
    }
    const vors = all.map((r) => n(r.vor)).filter((v) => v !== null && v > 0);
    const lmax = Math.log10(Math.max(10, ...vors));
    const items = shown.map((r, i) => {
      const vor = n(r.vor);
      const doi = n(r.doi);
      const key = joinKey(r.t, r.cp, r.k, r.expiry);
      const flagged = key && S.alertKeys && S.alertKeys.has(key) ? S.alertKeys.get(key) : null;
      const lift = n(r.lift), lo = n(r.nlo), hi = n(r.nhi);
      const title = [
        String(r.t || DASH) + " " + contractText(r).trim(),
        "volume " + count(r.vol) + ", open interest " + count(r.oi),
        vor === null ? "ratio not formed" : vor.toFixed(1) + " times open interest",
        doi === null ? "open-interest change not reported" : "open-interest change " + F.int(doi, true),
        lift === null ? "offer share not reported" : pct0(lift) + " of classified volume met the offer",
        lo === null || hi === null ? "no notional bracket" : "notional " + F.money(lo) + " to " + F.money(hi),
      ];
      if (Array.isArray(r.cls)) title.push("by exchange code, as of " + F.day(String((activityOf() || {}).asOf || "")) + ": " + codeText(r) + (n(r.pm) === null ? "" : "; premium " + F.money(n(r.pm))));
      if (flagged) title.push("also flagged by the vendor's rule " + (flagged.rule || "") + (n(flagged.prem) === null ? "" : ", carrying " + F.money(n(flagged.prem)) + " of premium"));
      const covered = S.payload && Array.isArray(S.payload.coverage) && S.payload.coverage.some((c) => c && c.t === r.t);
      return h(covered ? "a" : "div", {
        class: "fu-crow", href: covered ? tickerHref(r.t) : null, role: covered ? null : "listitem", title: title.join(" " + MID + " "),
        "data-t": String(r.t || ""), "data-both": flagged ? "1" : null, "data-stage": r.st || null,
      },
      h("span", { class: "ui-badge", "data-tone": r.cp === "P" ? "down" : "up", "aria-label": r.cp === "P" ? "Put" : "Call" }, r.cp === "P" ? "P" : "C"),
      h("span", { class: "fu-tk" }, h("b", null, n(r.k) === null ? DASH : F.px(n(r.k), n(r.k) % 1 ? 1 : 0).replace(/\.0$/, "")),
        h("small", null, String(r.t || DASH) + " " + MID + " " + F.day(String(r.expiry || ""))),
        sideGlyph(r.st), flagged ? h("span", { class: "fu-both", title: "Also flagged by the vendor" }, UI.glyph("levels")) : null),
      h("span", { class: "fu-meter", "aria-hidden": "true" }, vor === null ? null : h("i", { style: { width: ((Math.log10(Math.max(1, vor)) / lmax) * 100).toFixed(1) + "%", "--i": String(i) } })),
      h("span", { class: "fu-v fu-strong" }, vor === null ? DASH : (vor >= 100 ? vor.toFixed(0) : vor.toFixed(1)) + "×"),
      h("span", { class: "fu-v fu-wide", "data-tone": doi === null ? null : doi > 0 ? "up" : doi < 0 ? "down" : "flat" }, doi === null ? DASH : F.num(doi, true)));
    });
    keep(host.feed, () => host.feed.replaceChildren(
      h("div", { class: "fu-crow fu-head", "aria-hidden": "true" }, h("span"), h("span", null, "Contract"), h("span", null, "Volume ÷ OI"), h("span", { class: "fu-v" }, "Ratio"), h("span", { class: "fu-v fu-wide" }, "ΔOI")),
      listOf(items, 6, "Contracts ranked by volume over open interest"), ...activityRows()));
  }

  const BASIS_TITLES = {
    unit: "The unit", date: "The date", rank: "The ranking key", floors: "The floors",
    aggr: "The classified legs", lift: "The offer-side share", notional: "The bracket", iv: "Implied volatility",
    oi: "Open interest", zeroOi: "Strikes that never arrive", names: "Two populations", refusals: "Refused", activity: "The dated exchange-code unit",
  };
  const basisLines = (v) => {
    if (v === null || v === undefined) return [];
    if (typeof v !== "object") return [String(v)];
    const out = [];
    for (const [k, x] of Object.entries(v)) {
      if (k === "choice") continue;
      if (x === null || x === undefined || typeof x === "object") continue;
      out.push(k === "reason" || k === "line" ? String(x) : k + ": " + (typeof x === "number" ? count(x) : String(x)));
    }
    return out;
  };

  function feedInfo() {
    const payload = S.payload || {};
    const c = payload.contracts && typeof payload.contracts === "object" ? payload.contracts : {};
    const basis = payload.basis && typeof payload.basis === "object" ? payload.basis : null;
    const rows = Array.isArray(c.rows) ? c.rows : [];
    const bound = c.capBound === "rows" ? "the row cap bound this list"
      : c.capBound === "perName" ? "the per-name allowance bound this list"
        : c.capBound === "eligible" ? "neither cap bound this list: it is every contract that cleared the floors"
          : "the payload did not say which cap bound this list";
    return {
      title: "Volume over open interest",
      state: S.feedState.state === "ok" ? null : S.feedState.state,
      lead: "Contracts whose volume counter stands far above the open interest beside it, ranked by that ratio. The bar is the ratio on a log scale; ΔOI is the change in open interest across the last settlement, which does not say on which side anyone was.",
      facts: [
        ["Read", instant(payload.readAt)],
        ["Contracts", S.feedKind === "ok" ? count(n(c.shown) ?? rows.length) + (n(c.eligible) === null ? "" : " of " + count(c.eligible) + " that cleared the floors") : null],
        ["Chains read", n(payload.namesSeen) === null ? null : count(payload.namesSeen) + (n(payload.namesTruncated) ? ", " + count(payload.namesTruncated) + " cut short by the vendor" : "")],
        ["Cap", S.feedKind === "ok" ? bound : null],
        ["Days to expiry from", payload.dteAnchor === "sessionDate" ? String(payload.sessionDate || "") : null],
        ["Exchange-code unit", activityOf() ? (activityOf().status === "ok"
          ? "as of " + String(activityOf().asOf || "") + "; " + count(activityOf().matched) + " of " + count(activityOf().of) + " ranked contracts matched, " + count(activityOf().kept) + " of " + count(activityOf().returned) + " screen rows kept" + (n(activityOf().offDate) ? ", " + count(activityOf().offDate) + " from another day dropped" : "")
          : String(activityOf().status) + (activityOf().code ? " (" + activityOf().code + ")" : "")) : null],
      ],
      sections: basis
        ? Object.keys(basis).map((k) => ({ title: BASIS_TITLES[k] || k, lines: basisLines(basis[k]) }))
        : [{ title: "Method", lines: [S.feedKind === "ok" ? "This payload carried no basis block, so the page cannot say how its own numbers were built."
          : S.feedKind === "failed" || S.feedKind === "withheld" ? "The basis travels inside the same payload as the numbers, so it could not be read either. Nothing in this module has been explained by the pipeline." : null] }],
      notes: [
        "volumeAsOf is null: " + (payload.volumeAsOfReason ? String(payload.volumeAsOfReason) : "the endpoint publishes no as-of stamp") + ", so the span the counter covers is unobserved and this page stamps only when it was read.",
        "The accent mark beside a contract means the vendor's rules also flagged it, matched on name, side, strike and expiry: two independent selections agreeing.",
        ...(activityOf() && activityOf().status === "ok" ? ["The exchange-code shares come from a second, dated screen with its own floors. A contract in both lists carries them on its row; the list under the ranking is that screen's own largest by premium. The classes overlap and are not summed."] : []),
      ],
    };
  }

  function paintSurprise() {
    const payload = S.payload;
    if (!payload || S.feedKind === "pending" || S.feedKind === "unpublished" || S.feedKind === "failed") return;
    const names = payload.names && typeof payload.names === "object" ? payload.names : null;
    if (!names) {
      S.namesState = { state: "unavailable", reason: "Published, but the name panel is not on this payload. No count of ranked or unranked names is taken from it." };
      silence(host.surprise, S.namesState, "Surprise", 220);
      return;
    }
    if (!Array.isArray(names.rows)) {
      S.namesState = { state: "withheld", reason: "Published, but the name panel on this payload carries no rows array, so it could not be read as a ranking." };
      silence(host.surprise, S.namesState, "Surprise", 220);
      return;
    }
    if (!names.rows.length) {
      S.namesState = { state: "quiet", reason: "No name carried both a call and a put thirty-day average, so none could be ranked." };
      silence(host.surprise, S.namesState, "Surprise", 220);
      return;
    }
    S.namesState = { state: "ok" };
    setModuleState(host.surprise, S.namesState, "Surprise");
    const vals = names.rows.flatMap((r) => [n(r.sc), n(r.sp), n(r.st)]).filter((v) => v !== null && v > 0);
    const hiL = Math.log10(Math.max(10, ...vals)) + 0.05;
    const loL = Math.log10(Math.min(0.5, ...vals));
    const pos = (v) => (((Math.log10(Math.max(v, 1e-3)) - loL) / (hiL - loL)) * 100).toFixed(2) + "%";
    const covered = new Set((Array.isArray(payload.coverage) ? payload.coverage : []).map((c) => c && c.t));
    const ticks = [1, 10, 100].filter((v) => Math.log10(v) >= loL && Math.log10(v) <= hiL);
    const items = names.rows.map((r) => {
      const sc = n(r.sc), sp = n(r.sp), st = n(r.st), chg = n(r.chg);
      const pair = [sc, sp].filter((v) => v !== null && v > 0);
      const a = pair.length ? Math.min(...pair) : null, b = pair.length ? Math.max(...pair) : null;
      const tag = covered.has(r.t) ? "a" : "div";
      return h(tag, {
        class: "fu-srow", href: tag === "a" ? tickerHref(r.t) : null, role: tag === "a" ? null : "listitem",
        title: String(r.t) + " " + MID + " both " + (st === null ? "withheld" : st.toFixed(2) + "×") + " " + MID + " calls " + (sc === null ? DASH : sc.toFixed(2) + "×") +
          " " + MID + " puts " + (sp === null ? DASH : sp.toFixed(2) + "×") + " " + MID + " put/call " + (n(r.putCallRatio) === null ? DASH : n(r.putCallRatio).toFixed(2)) +
          " " + MID + " day change " + (chg === null ? DASH : F.pct(chg, 1, true)),
      },
      h("span", { class: "fu-tk is-2" }, h("b", null, String(r.t || DASH)), h("small", { "data-tone": chg === null ? null : chg > 0 ? "up" : chg < 0 ? "down" : null }, chg === null ? DASH : F.pct(chg, 1, true))),
      h("span", { class: "fu-db", "aria-hidden": "true" },
        ticks.map((v) => h("i", { class: "fu-db-t", style: { left: pos(v) } })),
        a !== null && b !== null && pair.length === 2 ? h("i", { class: "fu-db-l", style: { left: pos(a), width: "calc(" + pos(b) + " - " + pos(a) + ")" } }) : null,
        sc !== null && sc > 0 ? h("i", { class: "fu-db-d is-c", style: { left: pos(sc) } }) : null,
        sp !== null && sp > 0 ? h("i", { class: "fu-db-d is-p", style: { left: pos(sp) } }) : null),
      h("span", { class: "fu-v fu-strong" }, st === null ? DASH : (st >= 10 ? st.toFixed(0) : st.toFixed(1)) + "×"));
    });
    keep(host.surprise, () => host.surprise.replaceChildren(
      h("div", { class: "fu-srow fu-head", "aria-hidden": "true" }, h("span", null, "Name"),
        h("span", { class: "fu-db-axis" }, ticks.map((v) => h("span", { style: { left: pos(v) } }, v + "×"))), h("span", { class: "fu-v" }, "Both")),
      listOf(items, 6, "Names ranked by option volume against their own average"),
      UI.legend([["--up-mark", "dot", "Calls"], ["--down-mark", "", "Puts"]])));
  }

  function surpriseInfo() {
    const payload = S.payload || {};
    const names = payload.names && typeof payload.names === "object" ? payload.names : {};
    const gated = n(names.earningsGated);
    return {
      title: "Volume surprise",
      state: S.namesState.state === "ok" ? null : S.namesState.state,
      lead: "Each name's call and put volume against its own thirty-day averages, on a log scale: 1× is the average and 10× is ten times it. The number is both sides together against the sum of both averages.",
      facts: [
        ["Ranked", n(names.ranked) === null ? null : count(names.shown ?? (names.rows || []).length) + " of " + count(names.ranked)],
        ["Universe", n(names.universe) === null ? null : count(names.universe)],
        ["Unranked", n(names.unranked) === null ? null : count(names.unranked)],
        ["Report inside the gate", gated ? count(gated) : null],
      ],
      notes: [
        "Both is withheld when either average is missing, because a zero on one side would inflate the ratio without saying so.",
        "These ratios compare a name with itself and with no other name, so the same 2× on a thin name and on the largest name is the same number and not the same event.",
        gated ? "Names reporting inside the board's earnings gate are kept, since this panel describes what was counted rather than predicting anything, but a ratio on one of them is the least surprising number here." : null,
      ],
    };
  }

  kit.attach({
    paintTimeline, paintNames, paintUrgency, paintFeed, paintSurprise,
    timelineInfo, namesInfo, urgencyInfo, feedInfo, surpriseInfo,
  });
})();
