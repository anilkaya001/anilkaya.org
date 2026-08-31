/* =============================================================
   flows-ui.js — the shared UI primitives for the Flows pages.

   THE SEED OF A COMPONENT LAYER, NOT A FRAMEWORK. Every Flows page
   so far has re-derived the same five helpers — el(), isNum(), the
   U+2212 formatter, the em dash for an absence, an SVG builder —
   and three of the six times one of them was re-derived it came back
   subtly wrong (Number(null) is 0, and 0 is finite: the confident
   zero this repo has shipped five times is exactly a re-derived
   isNum). This module is those helpers written once, plus the two
   labeled controls and the one chart primitive the score-track page
   needed and the next page will want.

   RULES EVERY PRIMITIVE HERE ENFORCES, so a caller cannot un-enforce
   them by accident:

     - The minus sign is U+2212, never a hyphen. A hyphen belongs in
       an ISO date and nowhere near arithmetic.
     - An absent value is an EM DASH (or, in a drawing, nothing at
       all) — never a zero-valued mark. Zero is a measurement.
     - In scoreStrip, ONE VIEWBOX UNIT IS ONE CSS PIXEL. The caller
       passes a width measured from a VISIBLE host (a hidden element
       reports clientWidth 0 — unhide the panel before measuring;
       flows-events shipped that bug and its render harness caught a
       560-unit viewBox stretched to 1.71 px per unit). The svg is
       emitted with an explicit width attribute, never width:100%.
     - A null in a series is a GAP: the line is broken, never
       interpolated across, and no mark of any kind is drawn where a
       measurement is missing.
     - Hue is the last channel. scoreStrip carries sign by position
       against a zero rule it always draws; the only tint hook it
       offers is a class on the final dot, which repeats a sign the
       geometry already states.

   CLASS NAMES ARE THE CALLER'S. Every generated class is built from
   opts.prefix (default "fui"), so a page styles its own namespace
   (the score track passes "st" and styles .st-line, .st-dot, …) and
   two pages cannot fight over one selector. The structural suffixes
   are part of this module's contract and documented per primitive.
   ============================================================= */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /** U+2212, the real minus. Never a hyphen, which belongs in ISO dates. */
  const MINUS = "−";
  /** U+2014 — the one and only "not measured". Never styled like a number. */
  const DASH = "—";
  /** U+00B7, the separator every Flows status line joins with. */
  const MID = "·";

  let uid = 0;

  /* THE MISSING-VALUE TEST COMES BEFORE THE COERCION. Number(null) is 0
     and 0 is finite, so the naive shape turns an absent reading into a
     confident zero — the mistake this repo has shipped five times, which
     is why the idiom lives here now instead of being re-derived. */
  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  /** DOM helper: el("td", "c-num", "42"). cls and text both optional. */
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  /** SVG helper: svgEl("line", {x1: 0, …}). Null/undefined attrs skipped. */
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    return n;
  };

  /**
   * A signed integer-ish number: "+43", "−38" (U+2212), "0".
   *
   * ZERO PRINTS UNSIGNED AND UNDIMINISHED — it is a measurement, not a
   * blank — and an absent value prints the em dash, which is not one.
   * dp defaults to 0 because the Flows composite is quoted in whole units.
   */
  const fmtSigned = (v, dp) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(dp === undefined ? 0 : dp);
  };

  /** An unsigned integer, or the em dash for an absence. */
  const fmtInt = (v) => {
    const n = isNum(v);
    return n === null ? DASH : String(Math.round(n));
  };

  /**
   * The standard empty-state paragraph: <p class="flows-empty" data-empty=kind>.
   *
   * `kind` names WHICH silence this is — "pending", "unreadable", "empty",
   * "failed" — because the three silences may not share a sentence (see
   * flows-market.js paintSectors) and a test must be able to tell them
   * apart without parsing prose. The text is the caller's, and the caller
   * owes it the same distinction in words.
   */
  const emptyState = (kind, text) => {
    const p = el("p", "flows-empty", text);
    if (kind) p.dataset.empty = String(kind);
    return p;
  };

  /**
   * A labeled search field. Returns {root, input} so the caller can read
   * or clear the value without querying its own DOM.
   *
   * opts: {label, placeholder, onInput(value), prefix = "fui", cls, id}
   * Classes: root gets `${prefix}-field` (+ cls), the label
   * `${prefix}-label`, the input `${prefix}-input`. The label is a real
   * <label for=…>, so twenty of these are not twenty anonymous inputs to
   * a screen reader. Tap size and the 16px iOS focus-zoom floor are the
   * stylesheet's half of the contract.
   */
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

  /**
   * A labeled <select>. Returns {root, select}.
   *
   * opts: {label, options: [{value, label, selected}], onChange(value),
   *        prefix = "fui", cls, id}
   * Classes: root `${prefix}-field` (+ cls), label `${prefix}-label`,
   * select `${prefix}-select`. A native select, deliberately: it is
   * keyboard-usable, screen-reader-announced and 44px-tappable for free,
   * which no restyled listbox ever quite is.
   */
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

  /**
   * The shared column geometry for a per-session strip: `count` equal
   * columns across `width` CSS pixels.
   *
   * IN THIS MODULE SO A PAGE'S AXIS HEADER AND ITS ROW STRIPS CANNOT
   * DISAGREE. Both call this with the same (count, width) and get the
   * same xEdge/xMid, so a mark in a row is under its date in the header
   * by construction rather than by two functions staying in sync.
   */
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

  /* Consecutive column indices with the same class, merged into runs, so a
     22-column wash is one rect rather than twenty-two. */
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

  /**
   * A per-name score strip: one value per session, oldest first, drawn as
   * a broken line against an always-drawn zero rule.
   *
   * scoreStrip(host, {
   *   values,     // array of number|null — null is A GAP, not a zero
   *   deadBand,   // number|null: ±band shaded around zero, TO SCALE
   *   domain,     // {lo, hi} shared scale; defaults to this series' own —
   *               // pass one, or every row rescales to its own extremes
   *               // and a ±2 drift draws like a ±40 swing
   *   width,      // CSS px. Default host.clientWidth — measured by the
   *               // CALLER's layout, so the host must be VISIBLE
   *   height,     // CSS px, default 24
   *   markers,    // [{i, cls}] column washes (e.g. board-only sessions);
   *               // consecutive same-class columns merge into one rect
   *   rules,      // [{at, cls}] vertical rules at column EDGE `at`
   *               // (e.g. an epoch boundary between session at−1 and at)
   *   prefix,     // class prefix, default "fui"
   *   ariaLabel,  // if given: role="img" + label. If absent the svg is
   *               // aria-hidden — the caller owes the data as text
   * }) → the <svg> appended to host, or null if values is not an array.
   *
   * WHAT IS DRAWN, in paint order: column washes, the dead band, the
   * zero rule, the rules, then segments between ADJACENT measured points
   * only — a gap breaks the line, nothing bridges it — and dots at the
   * ends of every measured run, so an isolated measurement (including an
   * isolated ZERO, which sits exactly on the rule) is still visible.
   * The final measured dot carries `is-last` plus is-pos / is-neg /
   * is-zero, which is the one hue hook: confirmation, never the carrier.
   *
   * ONE VIEWBOX UNIT IS ONE CSS PIXEL: viewBox 0 0 W H with width=W and
   * height=H as attributes. The stylesheet must never size this svg.
   */
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

    /* The domain: the caller's shared one, widened if this series somehow
       exceeds it (clipping a mark is worse than a slightly loose scale),
       and always containing zero — the rule the whole drawing hangs on. */
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
      /* Decorative to assistive tech; the caller carries the data as text. */
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

    /* The dead band, TO SCALE. On a wide shared domain a ±1 band is
       sub-pixel and reads as a slightly thick rule — which is the truth
       of it, and the caller's note can say so; drawing it wider than the
       data warrants would claim a band the pipeline never published. */
    if (db !== null && db > 0) {
      const top = y(db);
      svg.append(svgEl("rect", {
        class: prefix + "-band", x: 0, y: top.toFixed(2),
        width: W, height: Math.max(0.5, y(-db) - top).toFixed(2),
      }));
    }

    // The zero rule: always drawn, always at zero. Position carries sign.
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

    // Segments between ADJACENT measured points only. A gap is never bridged.
    for (let i = 0; i + 1 < count; i++) {
      if (pts[i] === null || pts[i + 1] === null) continue;
      svg.append(svgEl("line", {
        class: prefix + "-line",
        x1: g.xMid(i).toFixed(2), y1: y(pts[i]).toFixed(2),
        x2: g.xMid(i + 1).toFixed(2), y2: y(pts[i + 1]).toFixed(2),
      }));
    }

    /* Dots at the ends of every measured run — so a run reads as a run and
       an ISOLATED measurement is a visible mark rather than nothing. A dot
       is drawn only where a value WAS measured; absence gets no mark. */
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
    fmtSigned, fmtInt,
    emptyState, searchBox, sortSelect,
    stripGeometry, scoreStrip,
  });
})();
