(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const MINUS = "−";

  const DASH = "—";

  const MID = "·";

  let uid = 0;

  const isNum = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string") return null;
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    return n;
  };

  const fmtSigned = (v, dp) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(dp === undefined ? 0 : dp);
  };

  const fmtInt = (v) => {
    const n = isNum(v);
    return n === null ? DASH : String(Math.round(n));
  };

  const fmtMoney = (v, opts) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const asked = isNum(opts && opts.dp);
    const dp = asked === null ? 2 : Math.max(0, Math.min(4, Math.round(asked)));
    const abs = Math.abs(n);
    const sign = n < 0 ? MINUS : "";
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(dp) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(dp) + "M";
    if (abs >= 1e3) return sign + "$" + Math.round(abs / 1e3) + "K";
    return sign + "$" + Math.round(abs);
  };

  const STALE_WRITE_MS = 30 * 60 * 60 * 1000;
  const STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;

  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  function staleness(payload, now, opts) {
    const o = opts || {};
    const at = isNum(now) ?? Date.now();
    if (!payload || typeof payload !== "object") return { kind: "unknown", message: null };

    const stamped = isNum(payload.__updatedAt);
    const written = stamped !== null && stamped > 0 ? stamped : null;
    if (written !== null && at - written > STALE_WRITE_MS) {
      const hours = Math.floor((at - written) / 3600000);
      const days = Math.floor(hours / 24);

      const age = days >= 1
        ? days + (days === 1 ? " day" : " days")
        : hours + (hours === 1 ? " hour" : " hours");
      return {
        kind: "write",
        message: (o.subject || "This page") + " was last written " + age +
          " ago. The pipeline has not published since — check the Actions tab.",
      };
    }

    let session = null;
    if (ISO_DAY.test(String(payload.sessionDate || ""))) {
      const parsed = Date.parse(String(payload.sessionDate) + "T21:00:00Z");
      if (Number.isFinite(parsed)) session = parsed;
    }
    if (session !== null && at - session > STALE_SESSION_MS) {
      return {
        kind: "session",
        message: "These numbers describe the " + payload.sessionDate + " session, " +
          "which is more than four days old. The pipeline is running but its " +
          "data is not advancing.",
      };
    }

    if (written === null && session === null) return { kind: "unknown", message: null };
    return { kind: "fresh", message: null };
  }

  const emptyState = (kind, text) => {
    const p = el("p", "flows-empty", text);
    if (kind) p.dataset.empty = String(kind);
    return p;
  };

  function searchBox(opts) {
    const o = opts || {};
    const prefix = o.prefix || "fui";
    const id = o.id || prefix + "-q-" + (++uid);
    const root = el("div", prefix + "-field" + (o.cls ? " " + o.cls : ""));
    const label = el("label", prefix + "-label", o.label || "Search");
    label.htmlFor = id;
    const input = el("input", prefix + "-input");
    input.type = "search";
    input.id = id;
    if (o.placeholder) input.placeholder = o.placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "characters");
    if (typeof o.onInput === "function") {
      input.addEventListener("input", () => o.onInput(input.value));
    }
    root.append(label, input);
    return { root, input };
  }

  function sortSelect(opts) {
    const o = opts || {};
    const prefix = o.prefix || "fui";
    const id = o.id || prefix + "-sort-" + (++uid);
    const root = el("div", prefix + "-field" + (o.cls ? " " + o.cls : ""));
    const label = el("label", prefix + "-label", o.label || "Order");
    label.htmlFor = id;
    const select = el("select", prefix + "-select");
    select.id = id;
    for (const opt of (Array.isArray(o.options) ? o.options : [])) {
      if (!opt) continue;
      const node = el("option", null, opt.label === undefined ? String(opt.value) : opt.label);
      node.value = String(opt.value);
      if (opt.selected) node.selected = true;
      select.append(node);
    }
    if (typeof o.onChange === "function") {
      select.addEventListener("change", () => o.onChange(select.value));
    }
    root.append(label, select);
    return { root, select };
  }

  function stripGeometry(count, width) {
    const n = Math.max(1, Math.floor(isNum(count) ?? 1));
    const w = Math.max(1, isNum(width) ?? 1);
    const colW = w / n;
    return {
      count: n,
      width: w,
      colW,
      xEdge: (i) => i * colW,
      xMid: (i) => (i + 0.5) * colW,
    };
  }

  function markerRuns(markers) {
    const byCls = new Map();
    for (const m of (Array.isArray(markers) ? markers : [])) {
      const i = isNum(m && m.i);
      if (i === null) continue;
      const cls = String((m && m.cls) || "");
      if (!byCls.has(cls)) byCls.set(cls, []);
      byCls.get(cls).push(i);
    }
    const runs = [];
    for (const [cls, list] of byCls) {
      list.sort((a, b) => a - b);
      let start = null, prev = null;
      for (const i of list) {
        if (start === null) { start = prev = i; continue; }
        if (i === prev + 1) { prev = i; continue; }
        runs.push({ cls, from: start, to: prev });
        start = prev = i;
      }
      if (start !== null) runs.push({ cls, from: start, to: prev });
    }
    return runs;
  }

  function scoreStrip(host, opts) {
    const o = opts || {};
    if (!host || !Array.isArray(o.values)) return null;
    const prefix = o.prefix || "fui";
    const pts = o.values.map((v) => isNum(v));
    const count = pts.length;

    const W = Math.max(24, Math.min(1600, Math.round(isNum(o.width) ?? host.clientWidth) || 240));
    const H = Math.max(12, Math.round(isNum(o.height) ?? 24));
    const g = stripGeometry(count || 1, W);
    const padY = 2.5;
    const plotH = H - padY * 2;

    let lo = 0, hi = 0;
    if (o.domain) {
      lo = isNum(o.domain.lo) ?? 0;
      hi = isNum(o.domain.hi) ?? 0;
    }
    const db = isNum(o.deadBand);
    if (db !== null) { lo = Math.min(lo, -db); hi = Math.max(hi, db); }
    for (const v of pts) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const y = (v) => padY + (1 - (v - lo) / (hi - lo)) * plotH;

    const svg = svgEl("svg", {
      class: prefix + "-strip", viewBox: `0 0 ${W} ${H}`, width: W, height: H,
      preserveAspectRatio: "xMidYMid meet",
    });
    if (o.ariaLabel) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", String(o.ariaLabel));
    } else {

      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
    }

    for (const run of markerRuns(o.markers)) {
      if (run.from >= count) continue;
      svg.append(svgEl("rect", {
        class: run.cls || (prefix + "-wash"),
        x: g.xEdge(run.from).toFixed(2), y: 0,
        width: (g.colW * (Math.min(run.to, count - 1) - run.from + 1)).toFixed(2), height: H,
      }));
    }

    if (db !== null && db > 0) {
      const top = y(db);
      svg.append(svgEl("rect", {
        class: prefix + "-band", x: 0, y: top.toFixed(2),
        width: W, height: Math.max(0.5, y(-db) - top).toFixed(2),
      }));
    }

    const zy = y(0).toFixed(2);
    svg.append(svgEl("line", { class: prefix + "-zero", x1: 0, x2: W, y1: zy, y2: zy }));

    for (const r of (Array.isArray(o.rules) ? o.rules : [])) {
      const at = isNum(r && r.at);
      if (at === null || at < 0 || at > count) continue;
      const x = g.xEdge(at).toFixed(2);
      svg.append(svgEl("line", {
        class: (r && r.cls) || (prefix + "-rule"), x1: x, x2: x, y1: 0, y2: H,
      }));
    }

    for (let i = 0; i + 1 < count; i++) {
      if (pts[i] === null || pts[i + 1] === null) continue;
      svg.append(svgEl("line", {
        class: prefix + "-line",
        x1: g.xMid(i).toFixed(2), y1: y(pts[i]).toFixed(2),
        x2: g.xMid(i + 1).toFixed(2), y2: y(pts[i + 1]).toFixed(2),
      }));
    }

    let lastMeasured = -1;
    for (let i = 0; i < count; i++) if (pts[i] !== null) lastMeasured = i;
    const r0 = Math.max(1.1, Math.min(1.6, g.colW / 2.4));
    for (let i = 0; i < count; i++) {
      if (pts[i] === null) continue;
      const edge = (i === 0 || pts[i - 1] === null) || (i === count - 1 || pts[i + 1] === null);
      if (!edge && i !== lastMeasured) continue;
      const isLast = i === lastMeasured;
      const cls = prefix + "-dot" + (isLast
        ? " is-last" + (pts[i] > 0 ? " is-pos" : pts[i] < 0 ? " is-neg" : " is-zero")
        : "");
      svg.append(svgEl("circle", {
        class: cls,
        cx: g.xMid(i).toFixed(2), cy: y(pts[i]).toFixed(2),
        r: isLast ? Math.max(r0, Math.min(2, g.colW / 2)).toFixed(2) : r0.toFixed(2),
      }));
    }

    host.append(svg);
    return svg;
  }

  window.FlowsUI = Object.freeze({
    MINUS, DASH, MID,
    isNum, el, svgEl,
    fmtSigned, fmtInt, fmtMoney,
    emptyState, searchBox, sortSelect,
    staleness,
    stripGeometry, scoreStrip,
  });
})();
