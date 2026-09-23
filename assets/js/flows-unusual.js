(() => {
  "use strict";

  const UI = window.FlowsUI;
  const statusEl = document.getElementById("uaStatus");
  if (!UI || !statusEl) return;
  const { h, s, F, chart: C } = UI;
  const DASH = UI.DASH, MID = UI.MID;

  const host = {
    meta: document.getElementById("uaMeta"),
    about: document.getElementById("uaAboutSlot"),
    chips: document.getElementById("uaChips"),
    filters: document.getElementById("uaFilters"),
    note: document.getElementById("uaFilterNote"),
    timeline: document.getElementById("uaTimeline"),
    names: document.getElementById("uaNames"),
    urgency: document.getElementById("uaUrgency"),
    feed: document.getElementById("uaFeed"),
    surprise: document.getElementById("uaSurprise"),
  };

  const n = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string" && !v.trim()) return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const count = (v) => (n(v) === null ? DASH : Math.round(n(v)).toLocaleString("en-US"));
  const pct0 = (v) => (n(v) === null ? DASH : Math.round(n(v) * 100) + "%");
  const plural = (k, one, many) => (k === 1 ? one : many);
  const instant = (iso) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(iso || ""));
    return m ? m[1] + " " + m[2] + " UTC" : null;
  };
  const ET = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const etOf = (iso) => {
    const t = Date.parse(String(iso || ""));
    if (!Number.isFinite(t)) return null;
    const p = {};
    for (const x of ET.formatToParts(new Date(t))) p[x.type] = x.value;
    return { day: p.year + "-" + p.month + "-" + p.day, m: (+p.hour % 24) * 60 + +p.minute };
  };
  const clock = (m) => {
    const hh = Math.floor(m / 60) % 24, mm = Math.round(m % 60);
    return ((hh + 11) % 12 + 1) + ":" + String(mm).padStart(2, "0") + " " + (hh < 12 ? "AM" : "PM");
  };
  const hourLabel = (m) => { const hh = Math.round(m / 60) % 24; return ((hh + 11) % 12 + 1) + (hh < 12 ? " AM" : " PM"); };
  const cardKey = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  const tickerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(cardKey(t));
  const contractText = (r) => (r.cp === "C" || r.cp === "P" ? r.cp + " " + (n(r.k) === null ? "" : F.compact(n(r.k), n(r.k) % 1 ? 1 : 0)) : "") +
    (r.exp || r.expiry ? " " + MID + " " + F.day(String(r.exp || r.expiry)) : "");
  const joinKey = (t, cp, k, expiry) => {
    const strike = n(k);
    if (!t || !cp || strike === null || !expiry) return null;
    return String(t) + "|" + String(cp) + "|" + strike + "|" + String(expiry);
  };

  const view = { side: "all", both: false };
  const S = {
    alerts: null, alertsState: { state: "pending", reason: "Reading the flagged windows." }, alertsKind: "pending",
    payload: null, feedState: { state: "pending", reason: "Reading the counter feed." }, feedKind: "pending",
    namesState: { state: "pending", reason: "Reading the counter feed." },
    alertKeys: null, feedKeys: null, urgency: new Map(), urgencyAsked: false,
  };
  const charts = { timeline: null };

  const setModuleState = (hostEl, st, label) => {
    const card = hostEl && hostEl.closest(".fd-mod");
    if (!card) return;
    card.dataset.state = st.state;
    const t = card.querySelector(".ui-mod-t");
    const old = t.querySelector(".ui-state");
    if (old) old.remove();
    const b = UI.stateButton(st, label);
    if (b) t.append(b);
  };
  const setModuleInfo = (hostEl, label, build) => {
    const card = hostEl && hostEl.closest(".fd-mod");
    if (!card) return;
    const head = card.querySelector(".ui-mod-h");
    const old = head.querySelector(":scope > .ui-info");
    if (old) old.remove();
    head.append(UI.infoButton(label, build));
  };
  const silence = (hostEl, st, label, height) => {
    hostEl.replaceChildren(UI.silent(st, label, height));
    setModuleState(hostEl, st, label);
  };

  function vendorCeilingSaid() {
    const a = S.alerts;
    if (S.alertsKind !== "ok" || !a) return "";
    const vLimit = n(a.vendorLimit), rLimit = n(a.readLimit);
    const vTrunc = typeof a.vendorTruncated === "boolean" ? a.vendorTruncated : null;
    const rTrunc = typeof a.readTruncated === "boolean" ? a.readTruncated : null;
    if (vTrunc === true) {
      return " The flagged windows hit the vendor's own ceiling" +
        (vLimit === null ? "" : " of " + count(vLimit) + " rows") +
        ", so how many it withheld above that line is unknown — this count is a " +
        "ceiling rather than a market, and comparing it with another session's " +
        "compares two ceilings.";
    }
    if (rTrunc === true) {
      return " An intraday read came back full at this site's own cap" +
        (rLimit === null ? "" : " of " + count(rLimit) + " rows") +
        ", so windows flagged between reads may be missing and this count is " +
        "at least what the record holds rather than a market.";
    }
    if (vTrunc === null && rTrunc === false) {
      return " Every intraday read came in under this site's own per-read cap" +
        (rLimit === null ? "" : " of " + count(rLimit) + " rows") +
        ", so each saw every window the vendor's rolling list still held.";
    }
    if (vTrunc === null) {
      return " Whether the flagged windows hit the vendor's own ceiling was not " +
        "recorded on this payload, so this count may be a ceiling rather than a market.";
    }
    return " The flagged windows came in under the vendor's ceiling, so this count is " +
      "the read rather than a limit.";
  }

  const passes = (r, expiryKey) => {
    if (view.side !== "all" && r.cp !== view.side) return false;
    if (view.both) {
      const key = joinKey(r.t, r.cp, r.k, r[expiryKey]);
      if (!key || S.alertKeys === null || S.feedKeys === null) return false;
      if (!S.alertKeys.has(key) || !S.feedKeys.has(key)) return false;
    }
    return true;
  };

  function syncNote() {
    const tally = (kind, rows, expiryKey, plural2) => {
      if (kind === "pending") return "the " + plural2 + " have not been read yet";
      if (kind === "unpublished") return "the pipeline has not published the " + plural2;
      if (kind === "failed" || kind === "withheld") return "the " + plural2 + " could not be read";
      if (kind === "absent") return "the " + plural2 + " are not on this payload";
      const shown = rows.filter((r) => passes(r, expiryKey)).length;
      return count(shown) + " of " + count(rows.length) + " " + plural2 + " are drawn";
    };
    const aRows = S.alertsKind === "ok" ? S.alerts.rows : [];
    const fRows = S.feedKind === "ok" ? S.payload.contracts.rows : [];
    const aT = tally(S.alertsKind, aRows, "exp", "flagged windows");
    const fT = tally(S.feedKind, fRows, "expiry", "contracts");
    let text;
    if (view.side === "all" && !view.both) {
      text = (S.alertsKind === "ok" && S.feedKind === "ok"
        ? "Both tables show every row published."
        : "No filter is on: " + aT + " and " + fT + ".") +
        " Narrowing either is a filter on what is drawn and never a second read of the market.";
    } else {
      const bits = [];
      if (view.side !== "all") bits.push(view.side === "C" ? "calls only" : "puts only");
      if (view.both) {
        const dead = S.feedKind === "absent" ? "the contract rows are not on this payload"
          : ["failed", "withheld"].includes(S.alertsKind) || ["failed", "withheld"].includes(S.feedKind) ? "one of the two payloads could not be read" : null;
        bits.push(S.alertsKind === "ok" && S.feedKind === "ok" ? "contracts in both feeds"
          : dead ? "contracts in both feeds — which cannot be resolved at all, because " + dead
            : S.alertsKind === "unpublished" || S.feedKind === "unpublished"
              ? "contracts in both feeds — which cannot be resolved, because the pipeline has not published one of the two"
              : "contracts in both feeds, which cannot be resolved until both payloads have loaded");
      }
      text = "Filtered to " + bits.join(" and ") + ": " + aT + " and " + fT + ". " +
        "Anything hidden is published and hidden, not absent from the read.";
    }
    host.note.textContent = text + vendorCeilingSaid();
    host.filters.inert = S.alertsKind !== "ok" && S.feedKind !== "ok";
    const cnt = host.filters.querySelector(".fu-count");
    if (cnt) {
      const shown = aRows.filter((r) => passes(r, "exp")).length;
      cnt.textContent = S.alertsKind !== "ok" ? "" : view.side === "all" && !view.both
        ? count(aRows.length) + " shown" : count(shown) + " of " + count(aRows.length) + " shown";
    }
  }

  function buildFilters() {
    const seg = UI.segmented("Side", [{ label: "All" }, { label: "Calls" }, { label: "Puts" }], (i) => {
      view.side = ["all", "C", "P"][i];
      repaint();
    }, 0);
    const both = h("button", {
      class: "fu-toggle", type: "button", "aria-pressed": "false",
      title: "Contracts the vendor's rules flagged and that also cleared this page's own floors",
    }, UI.glyph("levels"), h("span", null, "Both feeds"));
    both.addEventListener("click", () => {
      view.both = !view.both;
      both.setAttribute("aria-pressed", String(view.both));
      repaint();
    });
    host.filters.replaceChildren(seg, both, h("span", { class: "fu-count", "aria-hidden": "true" }));
  }

  function repaint() {
    paintTimeline(false);
    paintNames();
    paintFeed();
    syncNote();
  }

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
        cx, cy, r, fill: color, "fill-opacity": (0.14 + 0.72 * (pt.ask === null ? 0.2 : pt.ask)).toFixed(3),
        stroke: color, "stroke-width": 1.25,
        class: "fu-b" + (on ? "" : " is-off"), style: { "--i": String(Math.min(k, 60)) },
      }, g);
      return { pt, cx, cy, r };
    });
    const ring = s("circle", { r: 0, class: "fu-ring", fill: "none", opacity: 0 }, svg);
    wireBubbleScrub(el, svg, placed, ring, { top, bottom: H - bot });
  }

  function wireBubbleScrub(el, svg, placed, ring, box) {
    const list = placed.slice().sort((p, q) => p.cx - q.cx || q.pt.p - p.pt.p);
    const readout = h("div", { class: "ui-readout", "aria-hidden": "true" });
    el.append(readout);
    const xh = s("line", { class: "xh", y1: box.top, y2: box.bottom, x1: -10, x2: -10, opacity: 0 }, svg);
    let idx = -1;
    el.tabIndex = 0;
    el.setAttribute("role", "group");
    el.setAttribute("aria-roledescription", "chart");
    el.setAttribute("aria-label", "Flagged windows over the session. Use the arrow keys to read each window.");
    const show = (i, speak) => {
      if (i < 0 || i >= list.length) return;
      idx = i;
      const b = list[i], r = b.pt.r;
      ring.setAttribute("cx", b.cx); ring.setAttribute("cy", b.cy); ring.setAttribute("r", b.r + 3); ring.setAttribute("opacity", 1);
      xh.setAttribute("x1", b.cx); xh.setAttribute("x2", b.cx); xh.setAttribute("opacity", 0.5);
      const flags = [r.sweep === true ? "Sweep" : null, r.opening === true ? "Opening" : null, r.floor === true ? "Floor" : null].filter(Boolean);
      readout.replaceChildren(
        C.part(clock(b.pt.m) + (b.pt.exact ? "" : " first held"), "k"),
        h("b", null, String(r.t || DASH)),
        C.part(contractText(r).trim(), "k"),
        h("b", { "data-tone": b.pt.cp === "P" ? "down" : "up" }, F.money(b.pt.p)),
        C.part(b.pt.ask === null ? "ask —" : "ask " + pct0(b.pt.ask), "k"),
        flags.length ? C.part(flags.join(" " + MID + " "), "k") : null);
      readout.classList.add("is-on");
      const w = el.clientWidth, rw = readout.offsetWidth;
      readout.style.left = UI.clamp(b.cx - rw / 2, 0, Math.max(0, w - rw)) + "px";
      readout.style.top = Math.max(0, b.cy - b.r - 40) + "px";
      if (speak) UI.announce(readout.textContent);
    };
    const hide = () => { readout.classList.remove("is-on"); ring.setAttribute("opacity", 0); xh.setAttribute("opacity", 0); };
    const at = (e) => {
      const bb = svg.getBoundingClientRect();
      const k = svg.viewBox.baseVal.width / bb.width;
      return [(e.clientX - bb.left) * k, (e.clientY - bb.top) * k];
    };
    const nearest = (x, y) => {
      let best = -1, bd = Infinity;
      list.forEach((b, i) => {
        const d = Math.hypot(b.cx - x, (b.cy - y) * 0.6) - b.r * 0.5;
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    let raf = 0, last = null;
    el.addEventListener("pointermove", (e) => {
      last = at(e);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; show(nearest(last[0], last[1])); });
    });
    el.addEventListener("pointerdown", (e) => { const p = at(e); show(nearest(p[0], p[1])); });
    el.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); });
    el.addEventListener("blur", hide);
    el.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowLeft") {
        e.preventDefault();
        show(UI.clamp((idx < 0 ? (k === "ArrowRight" ? -1 : list.length) : idx) + (k === "ArrowRight" ? 1 : -1), 0, list.length - 1), true);
      } else if (k === "Home") { e.preventDefault(); show(0, true); }
      else if (k === "End") { e.preventDefault(); show(list.length - 1, true); }
      else if (k === "Escape") hide();
    });
  }

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
      lead: "Each bubble is one window the vendor's rules flagged, placed at the vendor's stated start or, without one, at the read that first held it. Calls sit above the line and puts below; distance and size both grow with premium, and a solid fill means the vendor put most of the window's dollars at the ask.",
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
      charts.timeline.set(drawTimeline, animate !== false);
      return;
    }
    const chartHost = h("div", { class: "fu-chart" });
    const legend = UI.legend([
      ["--up-mark", "dot", "Call"], ["--down-mark", "dot", "Put"],
      UI.key("--label-1", "dot", "At ask"), UI.key("--label-1", "ring", "At bid"),
      h("span", { class: "ui-key" }, h("i", { class: "fu-key-hatch", "aria-hidden": "true" }), "Not recorded"),
    ]);
    host.timeline.replaceChildren(chartHost, legend);
    charts.timeline = C.mount(chartHost, drawTimeline);
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
      h("span", { class: "fu-tk" }, h("b", null, g.t), sideGlyph(g.st), h("small", null, String(g.n))),
      h("span", { class: "fu-split", "aria-hidden": "true" },
        cw > 0 ? h("i", { class: "is-c", style: { width: cw.toFixed(2) + "%", "--i": String(i) } }) : null,
        pw > 0 ? h("i", { class: "is-p", style: { width: pw.toFixed(2) + "%", "--i": String(i) } }) : null),
      h("span", { class: "fu-v fu-strong" }, F.money(g.prem)),
      shareCell(g.ask, 0.6),
      h("span", { class: "fu-v fu-wide" }, pct0(g.sweep)),
      h("span", { class: "fu-v fu-wide" }, pct0(g.open)));
      return row;
    });
    host.names.replaceChildren(head, listOf(items, 8, "Names ranked by flagged premium"));
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
    if (S.alertsKind !== "ok") return;
    const board = aggregate(S.alerts.rows).filter((g) => g.st === "board:long" || g.st === "board:short").slice(0, 6);
    if (!board.length) {
      silence(host.urgency, { state: "quiet", reason: "No board name is among the flagged windows, and urgency is measured only for the board's deep names." }, "Urgency", 200);
      return;
    }
    const draw = () => {
      const got = board.map((g) => ({ g, u: S.urgency.get(g.t) }));
      const vals = got.map((x) => (x.u && x.u.tape ? n(x.u.tape.urgency) : null)).filter((v) => v !== null);
      const max = vals.length ? Math.max(...vals, 1e-9) : 1;
      const worstState = UI.worst(got.map((x) => (x.u ? x.u.st : { state: "pending", reason: "Reading this name's card." })));
      setModuleState(host.urgency, worstState.state === "ok" ? { state: "ok" } : { state: vals.length ? "quiet" : worstState.state, reason: worstState.reason }, "Urgency");
      const ranked = got.slice().sort((a, b) => (n(b.u && b.u.tape && b.u.tape.urgency) ?? -1) - (n(a.u && a.u.tape && a.u.tape.urgency) ?? -1));
      const items = ranked.map((x, i) => {
        const al = x.u && x.u.tape;
        const u = al ? n(al.urgency) : null;
        const st = x.u ? x.u.st : { state: "pending", reason: "Reading this name's card." };
        return h("a", { class: "fu-urow", href: tickerHref(x.g.t) },
          h("span", { class: "fu-tk is-2" }, h("span", { class: "fu-tk-l" }, h("b", null, x.g.t), sideGlyph(x.g.st)),
            h("small", null, al && n(al.n) !== null ? count(al.n) + " alerts " + MID + " " + pct0(al.sweepShare) + " sweep" : st.state === "pending" ? "Pending" : DASH)),
          h("span", { class: "fu-meter", "aria-hidden": "true" }, u === null ? null : h("i", { style: { width: ((u / max) * 100).toFixed(1) + "%", "--i": String(i) } })),
          u === null ? UI.dash(st.state === "ok" ? { state: "unavailable", reason: "This name's card carries no alert tape." } : st, x.g.t + " urgency")
            : h("span", { class: "fu-v fu-strong" }, F.pct(u, 2)));
      });
      host.urgency.replaceChildren(
        h("div", { class: "fu-urow fu-head", "aria-hidden": "true" }, h("span", null, "Name"), h("span", null, "Sweeps into new OI"), h("span", { class: "fu-v" }, "of ADV")),
        h("div", { class: "ui-list fu-list", role: "group", "aria-label": "Board names ranked by urgency" }, items));
    };
    draw();
    if (S.urgencyAsked) return;
    S.urgencyAsked = true;
    const queue = board.map((g) => g.t);
    const one = async (t) => {
      try {
        const res = await fetch("/api/flows/card-x?t=" + encodeURIComponent(cardKey(t)), { credentials: "same-origin", headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const cx = await res.json();
        const { alerts: tape } = cx || {};
        if (!cx || cx.status === "pending") S.urgency.set(t, { st: { state: "pending", reason: "This name's card extension has not been published yet." } });
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
    host.feed.replaceChildren(
      h("div", { class: "fu-crow fu-head", "aria-hidden": "true" }, h("span"), h("span", null, "Contract"), h("span", null, "Volume ÷ OI"), h("span", { class: "fu-v" }, "Ratio"), h("span", { class: "fu-v fu-wide" }, "ΔOI")),
      listOf(items, 6, "Contracts ranked by volume over open interest"));
  }

  const BASIS_TITLES = {
    unit: "The unit", date: "The date", rank: "The ranking key", floors: "The floors",
    aggr: "The classified legs", lift: "The offer-side share", notional: "The bracket", iv: "Implied volatility",
    oi: "Open interest", zeroOi: "Strikes that never arrive", names: "Two populations", refusals: "Refused",
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
      ],
      sections: basis
        ? Object.keys(basis).map((k) => ({ title: BASIS_TITLES[k] || k, lines: basisLines(basis[k]) }))
        : [{ title: "Method", lines: [S.feedKind === "ok" ? "This payload carried no basis block, so the page cannot say how its own numbers were built."
          : S.feedKind === "failed" || S.feedKind === "withheld" ? "The basis travels inside the same payload as the numbers, so it could not be read either. Nothing in this module has been explained by the pipeline." : null] }],
      notes: [
        "volumeAsOf is null: " + (payload.volumeAsOfReason ? String(payload.volumeAsOfReason) : "the endpoint publishes no as-of stamp") + ", so the span the counter covers is unobserved and this page stamps only when it was read.",
        "The accent mark beside a contract means the vendor's rules also flagged it, matched on name, side, strike and expiry: two independent selections agreeing.",
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
          " " + MID + " puts " + (sp === null ? DASH : sp.toFixed(2) + "×") + " " + MID + " put/call " + (n(r.putCallRatio) === null ? DASH : n(r.putCallRatio).toFixed(2)),
      },
      h("span", { class: "fu-tk is-2" }, h("b", null, String(r.t || DASH)), h("small", { "data-tone": chg === null ? null : chg > 0 ? "up" : chg < 0 ? "down" : null }, chg === null ? DASH : F.pct(chg, 1, true))),
      h("span", { class: "fu-db", "aria-hidden": "true" },
        ticks.map((v) => h("i", { class: "fu-db-t", style: { left: pos(v) } })),
        a !== null && b !== null && pair.length === 2 ? h("i", { class: "fu-db-l", style: { left: pos(a), width: "calc(" + pos(b) + " - " + pos(a) + ")" } }) : null,
        sc !== null && sc > 0 ? h("i", { class: "fu-db-d is-c", style: { left: pos(sc) } }) : null,
        sp !== null && sp > 0 ? h("i", { class: "fu-db-d is-p", style: { left: pos(sp) } }) : null),
      h("span", { class: "fu-v fu-strong" }, st === null ? DASH : (st >= 10 ? st.toFixed(0) : st.toFixed(1)) + "×"));
    });
    host.surprise.replaceChildren(
      h("div", { class: "fu-srow fu-head", "aria-hidden": "true" }, h("span", null, "Name"),
        h("span", { class: "fu-db-axis" }, ticks.map((v) => h("span", { style: { left: pos(v) } }, v + "×"))), h("span", { class: "fu-v" }, "Both")),
      listOf(items, 6, "Names ranked by option volume against their own average"),
      UI.legend([["--up-mark", "dot", "Calls"], ["--down-mark", "dot", "Puts"]]));
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

  function paintChips() {
    const a = S.alerts;
    if (S.alertsKind !== "ok") {
      const st = S.alertsState;
      host.chips.replaceChildren(UI.chips([["unusual", "Premium"], ["list", "Windows"], [null, "Calls"], [null, "At ask"], [null, "Sweeps"]].map(([icon, label]) =>
        UI.gaugeChip({ icon, ring: icon ? undefined : null, color: "--label-3", value: DASH, label, info: { title: label, state: st.state, lead: st.reason } })), "Flagged windows"));
      return;
    }
    const rows = a.rows;
    let prem = 0, call = 0, cpW = 0, ask = 0, askW = 0, sw = 0, swW = 0;
    for (const r of rows) {
      const p = n(r.prem);
      if (p === null || p <= 0) continue;
      prem += p;
      if (r.cp === "C" || r.cp === "P") { cpW += p; if (r.cp === "C") call += p; }
      const aP = n(r.askPrem);
      if (aP !== null) { ask += aP; askW += p; }
      if (typeof r.sweep === "boolean") { swW += p; if (r.sweep) sw += p; }
    }
    const floor = a.vendorTruncated === true || a.readTruncated === true;
    const seen = n(a.seen);
    const share = (x, w) => (w ? x / w : null);
    host.chips.replaceChildren(UI.chips([
      UI.gaugeChip({ icon: "unusual", color: "--accent-ink", value: prem ? F.money(prem) : DASH, label: "Premium",
        info: { title: "Flagged premium", lead: "The vendor's total premium across every flagged window in the record.", facts: [["Windows", count(rows.length)]] } }),
      UI.gaugeChip({ icon: "list", color: "--label-2", value: (floor ? "≥" : "") + count(seen ?? rows.length), label: "Windows",
        info: { title: "Windows", lead: floor ? "The read hit a ceiling, so this count is a floor." : "Flagged windows the record has held.", facts: [["Drawn", count(rows.length)], ["Seen", seen === null ? null : (floor ? "at least " : "") + count(seen)]] } }),
      UI.gaugeChip({ ring: share(call, cpW), color: "--up-mark", value: pct0(share(call, cpW)), label: "Calls",
        info: { title: "Call share", lead: "Call premium as a share of the premium on windows whose contract side could be read." } }),
      UI.gaugeChip({ ring: share(ask, askW), color: "--label-1", value: pct0(share(ask, askW)), label: "At ask",
        info: { title: "Ask-side share", lead: "The vendor's ask-side attribution as a share of premium. It adds no inference about who initiated." } }),
      UI.gaugeChip({ ring: share(sw, swW), color: "--s-orange", value: pct0(share(sw, swW)), label: "Sweeps",
        info: { title: "Sweep share", lead: "Premium on windows the vendor flagged as sweeps, over the windows that carry the flag at all." } }),
    ], "Flagged windows"));
  }

  function paintMeta() {
    const a = S.alerts, payload = S.payload;
    const day = (a && typeof a.sessionDate === "string" && a.sessionDate) || (payload && typeof payload.sessionDate === "string" && payload.sessionDate) || null;
    const bits = [];
    if (day) bits.push(F.day(day));
    if (S.alertsKind === "ok" && a.record && n(a.record.reads) !== null) bits.push(count(a.record.reads) + plural(n(a.record.reads), " read", " reads"));
    if (S.feedKind === "ok" && n(payload.namesSeen) !== null) bits.push(count(payload.namesSeen) + " chains");
    host.meta.textContent = bits.join(" " + MID + " ");
  }

  function paintStatus() {
    const parts = [];
    const kind = { ok: null, failed: "unreadable", withheld: "unreadable", absent: "unavailable", unpublished: "pending" }[S.feedKind] ?? S.feedKind;
    if (S.feedKind === "ok") {
      const c = S.payload.contracts;
      const rows = c.rows;
      const distinct = new Set(rows.map((r) => String(r.t || ""))).size;
      parts.push(count(n(c.shown) ?? rows.length) + " contracts from " + count(distinct) + plural(distinct, " name", " names") +
        (n(c.eligible) === null ? "" : ", of " + count(c.eligible) + " that cleared the floors"));
      if (!rows.length) statusEl.dataset.empty = "quiet"; else delete statusEl.dataset.empty;
    } else {
      parts.push(S.feedState.reason || "");
      if (kind) statusEl.dataset.empty = kind;
    }
    statusEl.textContent = parts.filter(Boolean).join(" " + MID + " ") + ".";
  }

  function wireInfos() {
    if (host.about && !host.about.firstChild) {
      const src = document.getElementById("uaAbout");
      host.about.append(UI.infoButton("this page", () => ({
        title: "Unusual activity",
        node: src ? h("div", { class: "fd-about-pop" }, [...src.children].map((x) => x.cloneNode(true))) : null,
      })));
    }
    setModuleInfo(host.timeline, "the timeline", timelineInfo);
    setModuleInfo(host.names, "names", namesInfo);
    setModuleInfo(host.urgency, "urgency", urgencyInfo);
    setModuleInfo(host.feed, "volume over open interest", feedInfo);
    setModuleInfo(host.surprise, "volume surprise", surpriseInfo);
  }

  function takeAlerts(alerts, kind, reason) {
    S.alerts = alerts;
    S.alertsKind = kind;
    S.alertKeys = null;
    if (kind === "ok") {
      S.alertKeys = new Map();
      for (const r of alerts.rows) { const key = joinKey(r.t, r.cp, r.k, r.exp); if (key) S.alertKeys.set(key, r); }
      S.alertsState = alerts.rows.length ? { state: "ok" }
        : { state: "quiet", reason: "The vendor's rules flagged nothing in this read. A read taken before the open, of a feed that fills intraday, is expected to be thin, and absence from the vendor's selection is not evidence of a quiet market." };
    } else {
      S.alertsState = {
        state: kind === "unpublished" ? "pending" : kind === "failed" ? "unavailable" : "withheld",
        reason,
      };
    }
    if (kind !== "ok" || !alerts.rows.length) {
      for (const el of [host.timeline, host.names, host.urgency]) silence(el, S.alertsState, el === host.timeline ? "Timeline" : el === host.names ? "Names" : "Urgency", el === host.timeline ? 250 : 200);
    } else {
      setModuleState(host.timeline, { state: "ok" }, "Timeline");
      paintTimeline(true);
      paintNames();
      paintUrgency();
    }
    paintChips();
    if (S.feedKind === "ok") paintFeed();
    paintMeta();
    paintStatus();
    syncNote();
  }

  function takeFeed(payload, kind, reason) {
    S.payload = payload;
    S.feedKind = kind;
    S.feedKeys = null;
    if (kind === "ok") {
      S.feedKeys = new Set();
      for (const r of payload.contracts.rows) { const key = joinKey(r.t, r.cp, r.k, r.expiry); if (key) S.feedKeys.add(key); }
      S.feedState = payload.contracts.rows.length ? { state: "ok" }
        : { state: "quiet", reason: payload.status === "quiet"
          ? "No contract cleared both floors on the chains that were read. That is a statement about this run's chains, not about the market."
          : "This payload carries a contracts block with no rows in it, and did not report the read as quiet." };
      paintFeed();
      if (!payload.contracts.rows.length) silence(host.feed, S.feedState, "Volume over OI", 220);
    } else {
      S.feedState = { state: kind === "unpublished" ? "pending" : kind === "absent" ? "unavailable" : kind === "failed" ? "unavailable" : "withheld", reason };
      silence(host.feed, S.feedState, "Volume over OI", 220);
      if (kind === "failed" || kind === "unpublished") {
        S.namesState = S.feedState;
        silence(host.surprise, S.feedState, "Surprise", 220);
      }
    }
    if (kind === "ok" || kind === "absent" || kind === "withheld") paintSurprise();
    if (S.alertsKind === "ok") { paintTimeline(false); paintNames(); }
    paintMeta();
    paintStatus();
    syncNote();
  }

  const get = (url) => fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });

  function freshFrom(res, body, source) {
    const upd = Number(res.headers.get("X-Payload-Updated")) || null;
    const f = typeof UI.freshFrom === "function" ? UI.freshFrom(res) : null;
    if (f && f.session) UI.freshness({ ...f.forFreshness(), updatedAt: upd, generatedAt: body && typeof body.generatedAt === "string" ? body.generatedAt : undefined });
    else if (body && typeof body === "object") UI.freshness({ sessionDate: body.sessionDate, generatedAt: body.generatedAt, updatedAt: upd, source });
  }

  function loadAlerts() {
    return get("/api/flows/flowalerts").then((res) => {
      if (res.status === 401) { location.replace("/flows/"); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json().then((alerts) => {
        if (!alerts || typeof alerts !== "object") throw new Error("not a payload");
        freshFrom(res, alerts, "flowalerts");
        if (alerts.status === "pending") {
          takeAlerts(alerts, "unpublished", "The pipeline has not published this key yet. The alerts feed costs one market-wide call a run and appears with the first pipeline run after it shipped.");
          return;
        }
        if (!Array.isArray(alerts.rows)) {
          takeAlerts(alerts, "withheld", "This payload could not be read as an alerts feed: it carries no rows array. That is a gap in the payload, not a quiet market.");
          return;
        }
        takeAlerts(alerts, "ok", null);
      });
    }).catch((error) => {
      takeAlerts(null, "failed", "The alerts feed could not be loaded (" + (error && error.message ? error.message : "no message") + "). The counter feed is a separate payload and stands on its own.");
    });
  }

  function loadFeed() {
    return get("/api/flows/unusual").then((res) => {
      if (res.status === 401) { location.replace("/flows/"); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json().then((payload) => {
        if (!payload || typeof payload !== "object") throw new Error("not a payload");
        freshFrom(res, payload, "unusual");
        if (payload.status === "pending") {
          takeFeed(payload, "unpublished", "The pipeline has not published this key yet. This feed is built from the option chains the run already reads for each board name, so it appears with the first pipeline run after it shipped.");
          return;
        }
        const contracts = payload.contracts && typeof payload.contracts === "object" ? payload.contracts : null;
        if (!contracts) {
          takeFeed(payload, "absent", "Published, but this payload carries no contracts block, and no count of contracts, of names or of chains is taken from it. This is a gap in the payload and not a chain that cleared no floors.");
          return;
        }
        if (!Array.isArray(contracts.rows)) {
          takeFeed(payload, "withheld", "Published, but the contracts block on this payload carries no rows array, so it could not be read as a feed.");
          return;
        }
        takeFeed(payload, "ok", null);
      });
    }).catch((error) => {
      takeFeed(null, "failed", "The feed could not be loaded (" + (error && error.message ? error.message : "no message") + "). Nothing in it was measured; refresh to try again.");
    });
  }

  buildFilters();
  wireInfos();
  syncNote();
  Promise.all([loadAlerts(), loadFeed()]).then(() => {
    wireInfos();
    if (typeof UI.heartbeat !== "function") return;
    UI.heartbeat({
      keys: ["alerts"], nightly: ["flowalerts", "unusual"], page: "unusual",
      onChange: (changed) => {
        if (changed.some((k) => k === "live:alerts" || k === "flowalerts")) loadAlerts();
        if (changed.indexOf("unusual") >= 0) loadFeed();
      },
    });
  });
})();
