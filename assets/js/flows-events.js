/* =============================================================
   flows-events.js — the calendar the board was gated out of.

   Renders /api/flows/events: which names in the screened universe
   report next, what the option market is charging for the sessions
   between the run and the report, and where each name stopped in the
   board's own funnel — including the forty the composite was
   FORBIDDEN to hold an opinion on.

   ============================================================
   THE TWO CLOCKS, WHICH IS THE CORRECTION THAT GOVERNS THIS FILE.

   `sessionDate` and `gateOrigin` are DIFFERENT DATES and the payload
   publishes both. In the fixture they are two days apart.

     - Every PRICE on this page — `px` — describes `sessionDate`, the
       last COMPLETED session.
     - Every DAY COUNT — `dte`, `sdte`, the chart's day 0, the gate
       band — is measured from `gateOrigin`, the run's own Eastern
       date, because that is the origin the earnings gate itself used.

   A page that counted days from `sessionDate` would draw the window
   one to three days early and classify every name against a gate that
   never ran — invisibly, because a fixture built from `sessionDate`
   agrees with such code perfectly. So both dates are named in the
   status strip WITH WHAT EACH GOVERNS, and the window note says it
   again beside the drawing.

   ============================================================
   THE SECOND UNIT, WHICH IS THE ONE THAT NEARLY SHIPPED WRONG.

   There are TWO day counts on every row and they are NOT the same
   number:

     - `dte`  — CALENDAR days. The gate's own quantity, passed through
                from daysToEarnings() rather than recomputed.
     - `sdte` — TRADING SESSIONS, counted as weekdays. What the priced
                move `ev` was actually scaled by.

   `gateDays` and `windowDays` are CALENDAR days, so THE AXIS, THE
   MARKS, THE BAND AND THE WINDOW END ALL USE `dte`. Placing marks at
   `sdte` against a band measured in `gateDays` puts them on the wrong
   side of it: measured on the emitted payload, TWENTY-ONE OF SIXTY
   rows change sides — and all twenty-one are names the board WAS
   allowed to score, which an `sdte` axis would have drawn inside the
   gate band. A name eighteen calendar days out, comfortably clear of
   a twelve-day gate, draws at twelve sessions and reads as gated.
   That inverts the single claim this page exists to make.

   `sdte` therefore appears in the table beside the priced move it
   scaled, and in the row titles, and NEVER on that axis.

   ============================================================
   THE ROW'S OWN `dte` IS DRAWN, NOT A RECOMPUTED ONE — AND THAT IS
   A RULE ABOUT WHO PUBLISHES, NOT ABOUT ARITHMETIC.

   As this page was being built the payload twice published a `dte`
   measured from the run's wall-clock INSTANT while `sdte` was
   measured from gateOrigin's midnight — two origins about twenty-one
   hours apart. In that state a local recomputation of `dte` from the
   two published dates disagreed with the published one on EVERY row,
   and the weekday count overtook the calendar count containing it on
   eight of sixty, which no single span can do. Both were fixed
   upstream: daysToEarnings now measures from the ISO date, so on the
   current payload a recomputation agrees exactly and every `dte` is
   reproducible from the gateOrigin the payload names.

   The rule stands anyway. What is drawn is what was published, so
   the drawing follows the gate through a change like that one
   instead of needing an edit to keep up with it, and a row without a
   `dte` is left off the chart with the reason said out loud rather
   than seated by arithmetic this page is not entitled to do.

   WHAT SURVIVES FROM THE EPISODE IS THE CHECK, NOT THE WORKAROUND.
   originClash() below still asks of every row whether it publishes
   more weekdays than calendar days. It finds none today. If one ever
   comes back, the Sessions cell is marked, the table note counts
   them, and neither column claims an origin it does not have —
   because that gap is visible to any reader who subtracts two
   adjacent columns, and a page that renders it silently is lying by
   arrangement.
   ============================================================= */
(() => {
  "use strict";

  const MINUS = "−";           // U+2212, not a hyphen. Never inside an ISO date.
  const DASH = "—";            // U+2014, the one and only "not measured"
  const MID = "·";
  const UP = "↑";              // verified present in the mono subset
  const DOWN = "↓";            // ditto; U+25B2/U+25BC are NOT and are never used
  const SVG_NS = "http://www.w3.org/2000/svg";
  const COLUMNS = 10;               // keep in sync with the <thead> in flows-pages.js
  const ISO = /^\d{4}-\d{2}-\d{2}$/;

  const statusEl = document.getElementById("evStatus");
  const staleEl = document.getElementById("evStale");
  const windowPanel = document.getElementById("evWindowPanel");
  const windowHost = document.getElementById("evWindow");
  const windowNote = document.getElementById("evWindowNote");
  const tablePanel = document.getElementById("evTablePanel");
  const capEl = document.getElementById("evCap");
  const bodyEl = document.getElementById("evBody");
  const tableNote = document.getElementById("evTableNote");
  const basisPanel = document.getElementById("evBasisPanel");
  const basisHost = document.getElementById("evBasis");
  const footEl = document.getElementById("evFoot");
  if (!statusEl || !bodyEl) return;

  /* ---------- numbers, and the absence of them --------------------

     THE MISSING-VALUE TEST COMES BEFORE THE COERCION. Number(null) is 0
     and 0 is finite, so the naive shape turns an absent reading into a
     confident zero. On this page that would print "0.00%" in the Priced
     column of every name whose implied volatility never arrived — a real
     reading of that field ("the market is charging nothing for the
     report") and the exact opposite of what a missing one means. It would
     also plant every undated name on day zero of the chart, which reads
     as "reports today". This repo has shipped that mistake five times;
     the idiom below is flows-watch.js's, copied rather than re-derived. */
  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
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

  /** A fraction as a percentage. The sign glyph is U+2212, never a hyphen. */
  function pct(v, d) {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : "") + (Math.abs(n) * 100).toFixed(d === undefined ? 2 : d) + "%";
  }

  function fixed(v, d) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(d === undefined ? 2 : d);
  }

  function signedInt(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(0);
  }

  const plural = (n, one, many) => (n === 1 ? one : many);
  const days = (n) => n + " calendar " + plural(n, "day", "days");
  const sessions = (n) => n + " " + plural(n, "session", "sessions");

  /**
   * Does this row publish more weekdays than calendar days?
   *
   * No span can contain more weekdays than days, so a row that says so is a
   * row where the two published counts were measured from different origins
   * — `dte` from the gate's instant, `sdte` from gateOrigin's midnight. It is
   * detected here rather than assumed, so the marking vanishes on a payload
   * where the two agree instead of having to be taken back out by hand.
   */
  function originClash(row) {
    const d = isNum(row && row.dte), sd = isNum(row && row.sdte);
    return d !== null && sd !== null && sd > d;
  }

  /* ---------- the funnel stage, which is the column this page is for ----

     "gated" MEANS THE BOARD WAS FORBIDDEN TO SCORE THIS NAME. It does not
     mean the board scored it badly, and it does not mean the board scored
     it at all — there is no number under it, which is why `s` is null on
     every gated row in the fixture. Every affordance below is built to
     keep that reading and to refuse the other one: gated sits in its own
     lane on the chart, carries its own chip shape in the table, and says
     so in words in both titles. */

  const STAGE = {
    "gated": {
      lane: "gated", label: "GATED",
      what: "The board was FORBIDDEN from scoring this name. The pipeline removes " +
        "every name reporting inside the gate window before the composite is " +
        "computed, so there is no score under this row — not a low one, none at all.",
    },
    "board:long": {
      lane: "board", label: "BOARD " + UP,
      what: "Passed the gate, was scored, and published on the long side of the board.",
    },
    "board:short": {
      lane: "board", label: "BOARD " + DOWN,
      what: "Passed the gate, was scored, and published on the short side of the board.",
    },
    "liquid": {
      lane: "open", label: "LIQUID",
      what: "Passed the gate and cleared the liquidity screen, but did not reach the board.",
    },
    "enriched": {
      lane: "open", label: "ENRICHED",
      what: "Passed the gate and was enriched with per-name data, but did not reach the board.",
    },
    "eligible": {
      lane: "open", label: "ELIGIBLE",
      what: "Passed the earnings gate and was eligible for scoring, but did not reach the board.",
    },
    "screened": {
      lane: "open", label: "SCREENED",
      what: "Returned by the screener and no further. It was not gated out; it simply " +
        "did not get further down the funnel.",
    },
  };

  const stageOf = (st) => STAGE[String(st || "")] || {
    lane: "open",
    label: st ? String(st).toUpperCase() : "UNCLASSIFIED",
    what: st
      ? "A funnel stage this page has no description for. It is shown as the payload " +
        "sent it rather than folded into one it is not."
      : "The payload carried no funnel stage for this name. Not measured — this is not " +
        "a claim that the name reached no stage.",
  };

  /* Lanes, in funnel order. POSITION CARRIES THE STAGE, hue is decoration:
     the three bands remain legible with every colour removed, printed in
     greyscale, or read by someone who cannot separate the two. Shape is a
     second redundant channel and hue is the third and last. */
  const LANES = [
    { key: "gated", short: "GATED",
      aria: "gated, which is to say the board was forbidden to score them" },
    { key: "board", short: "ON THE BOARD", aria: "on the board" },
    { key: "open", short: "PASSED, NOT ON THE BOARD",
      aria: "past the gate but not on the board" },
  ];

  /* ---------- the IV path ----------------------------------------- */

  /**
   * The four-point implied-volatility path as a sparkline, on a domain
   * FIXED ACROSS THE WHOLE TABLE.
   *
   * A per-row domain would rescale every sparkline to its own extremes, so
   * a name whose implied vol moved a point and a name whose implied vol
   * halved would draw the same picture. One domain for the table means the
   * height of a dot means something between rows, and a genuinely flat path
   * draws flat.
   *
   * A NULL POINT IS NOT INTERPOLATED ACROSS. Two of the sixty rows in the
   * fixture carry nulls at positions 1 and 3 — the "−1w" point is
   * reconstructed as iv30 − ivMomentum and both of those are absent when
   * iv30 is — which leaves two measured points that are NOT adjacent. A
   * polyline through them would draw a straight run across two readings
   * nobody took. So: a dot at every measured point, a segment only between
   * ADJACENT measured points, and nothing at all where a point is missing.
   */
  function sparkline(path, labels, domain) {
    if (!Array.isArray(path) || !domain) return null;
    const pts = path.map((v) => isNum(v));
    if (!pts.some((v) => v !== null)) return null;

    const W = 46, H = 14, padX = 3.5, padY = 2.5;
    const n = pts.length;
    const xOf = (i) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - padX * 2));
    const yOf = (v) => padY + (1 - (v - domain.lo) / domain.span) * (H - padY * 2);

    const svg = svgEl("svg", {
      class: "ev-spark", viewBox: `0 0 ${W} ${H}`, width: W, height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
      "aria-label": "Implied volatility path, oldest first: " + pts.map((v, i) =>
        (labels[i] || "point " + (i + 1)) + " " + (v === null ? "not measured" : pct(v, 1)),
      ).join(", ") + ".",
    });

    for (let i = 0; i + 1 < n; i++) {
      if (pts[i] === null || pts[i + 1] === null) continue;   // never bridge a gap
      svg.append(svgEl("line", {
        class: "ev-spark-l",
        x1: xOf(i).toFixed(2), y1: yOf(pts[i]).toFixed(2),
        x2: xOf(i + 1).toFixed(2), y2: yOf(pts[i + 1]).toFixed(2),
      }));
    }
    pts.forEach((v, i) => {
      if (v === null) return;
      svg.append(svgEl("circle", {
        class: "ev-spark-d" + (i === n - 1 ? " is-now" : ""),
        cx: xOf(i).toFixed(2), cy: yOf(v).toFixed(2), r: i === n - 1 ? 2 : 1.5,
      }));
    });
    return svg;
  }

  function pathDomain(rows) {
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) {
      if (!r || !Array.isArray(r.ivPath)) continue;
      for (const raw of r.ivPath) {
        const v = isNum(raw);
        if (v === null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const span = Math.max(hi - lo, 0.02);
    const pad = span * 0.08;
    return { lo: lo - pad, hi: hi + pad, span: span + pad * 2, rawLo: lo, rawHi: hi };
  }

  /* ---------- the window chart ------------------------------------ */

  let drawn = null;                 // the payload last handed to renderWindow
  let drawnW = 0;                   // the width it was drawn at, for the resize repaint

  /**
   * ONE VIEWBOX UNIT IS ONE CSS PIXEL.
   *
   * A fixed viewBox emitted at width:100% is scaled by the browser, and
   * everything scales with it — a 9px axis label becomes 5px on a phone and
   * oversized on a wide desk. So the width is measured from the host at
   * paint time, clamped to [300, 1200], and used as the viewBox width. No
   * transform: scale() anywhere.
   *
   * AND EVERY <text> CARRIES AN EXPLICIT px font-size. An unsized SVG
   * <text> inherits the document's 16px and silently outgrows the gutter it
   * was measured for; that exact bug shipped last week.
   */
  /**
   * THE PANEL IS UNHIDDEN BEFORE IT IS MEASURED, and that ordering is the
   * whole of this function.
   *
   * `#evWindowPanel` ships `hidden`, and a hidden element reports a
   * clientWidth of 0. Measuring first and unhiding afterwards — the natural
   * order to write — silently takes the 560 fallback on EVERY paint, and a
   * 560-unit viewBox stretched into a 958px host is 1.71 CSS pixels per unit:
   * every 9px axis label renders at 15px and the one-unit-is-one-pixel rule
   * is broken in the direction nobody notices, because the chart still looks
   * like a chart. The render harness caught it at exactly that ratio.
   */
  function revealPanel() {
    if (windowPanel) windowPanel.hidden = false;
  }

  function chartWidth() {
    revealPanel();
    const w = windowHost && windowHost.clientWidth;
    return Math.max(300, Math.min(1200, Math.round(w) || 560));
  }

  function windowMessage(text) {
    if (!windowHost) return;
    windowHost.replaceChildren(el("p", "flows-empty ew-empty", text));
    revealPanel();
  }

  function renderWindow(payload) {
    if (!windowHost) return;
    drawn = payload;
    drawnW = chartWidth();
    windowHost.replaceChildren();

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const origin = ISO.test(String(payload.gateOrigin || "")) ? payload.gateOrigin : null;
    const gateDays = isNum(payload.gateDays);
    const windowDays = isNum(payload.windowDays);

    if (!origin) {
      /* WITHOUT gateOrigin THERE IS NO DAY ZERO TO NAME. The counts are
         still in `dte`, but a chart that cannot say what its own origin was
         invites the reader to supply one — and the one they will supply is
         today's date, which is not the run's. */
      windowMessage(
        "This payload carried no gate origin, so the chart cannot say what its day zero " +
        "is. It is not drawn: an axis whose origin is unstated will be read as today, " +
        "and today is not the date the earnings gate ran against.");
      if (windowNote) {
        windowNote.textContent = "The table below is unaffected — every count in it is " +
          "the pipeline's own, not this page's arithmetic.";
      }
      return;
    }

    /* THE ROW'S OWN `dte`, NEVER A RECOMPUTED ONE. See the header block: the
       midnight substitute disagrees with the gate on every row of this
       fixture. A row without a `dte` is counted and left off rather than
       placed by arithmetic this page is not entitled to do. */
    const marks = [];
    let undrawn = 0;
    for (const r of rows) {
      const dte = isNum(r && r.dte);
      if (dte === null || dte < 0) { undrawn++; continue; }
      marks.push({ r, dte, lane: stageOf(r.st).lane });
    }

    if (!marks.length) {
      windowMessage("No row in this payload carries the calendar day count the gate " +
        "measured, so there is nothing that can honestly be placed on this axis.");
      return;
    }

    const maxDte = marks.reduce((m, x) => Math.max(m, x.dte), 0);
    /* THE AXIS ENDS AT `windowDays`, the published window — in CALENDAR days,
       the same unit as `dte` and `gateDays`. It is widened only if a row
       somehow reports beyond it, because clipping a mark is worse than a
       long axis, and floored at a week so an empty near-term calendar still
       draws a readable scale. */
    const axisMax = Math.max(7, windowDays === null ? 0 : windowDays, maxDte,
      gateDays === null ? 0 : gateDays + 1);
    const cols = axisMax + 1;

    const W = drawnW;
    const padL = 16, padR = 16, padT = 23, axisH = 26, laneGap = 8, labelH = 15, gap = 2;
    const plotW = W - padL - padR;
    const colW = plotW / cols;
    const ms = Math.max(4, Math.min(9, Math.floor(colW - 3)));
    const rowH = ms + gap;
    const xMid = (d) => padL + (d + 0.5) * colW;
    const xEdge = (d) => padL + d * colW;

    /* Stacked, never overplotted: many names share a report date — six of the
       sixty share one in the fixture — and a single mark per date would hide
       five of them behind the sixth. */
    const stacks = new Map();
    for (const m of marks) {
      const k = m.lane + "@" + m.dte;
      if (!stacks.has(k)) stacks.set(k, []);
      stacks.get(k).push(m);
    }
    for (const list of stacks.values()) {
      list.sort((a, b) => String(a.r.t).localeCompare(String(b.r.t)));
    }

    const lanes = LANES.map((L) => {
      let tallest = 0;
      for (const [k, list] of stacks) {
        if (k.slice(0, L.key.length + 1) === L.key + "@") tallest = Math.max(tallest, list.length);
      }
      return {
        key: L.key, short: L.short, aria: L.aria,
        n: marks.filter((m) => m.lane === L.key).length,
        tallest: Math.max(1, tallest),
      };
    });

    let y = padT;
    for (const L of lanes) {
      L.labelY = y + 11;
      L.top = y + labelH;
      L.height = L.tallest * rowH;
      L.base = L.top + L.height;                 // stacks grow upward from here
      y = L.base + laneGap;
    }
    const plotTop = padT;
    const plotBottom = y - laneGap;
    const H = Math.round(plotBottom + axisH);

    const inBand = (m) => gateDays !== null && m.dte <= gateDays;
    const gatedAll = marks.filter((m) => m.lane === "gated");
    const gatedIn = gatedAll.filter(inBand).length;
    const gatedOut = gatedAll.length - gatedIn;
    const otherAll = marks.filter((m) => m.lane !== "gated");
    const otherIn = otherAll.filter(inBand).length;

    const svg = svgEl("svg", {
      class: "ew", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
      "aria-label":
        "Report dates for " + marks.length + " " + plural(marks.length, "name", "names") +
        ", plotted as calendar days after " + origin + ", the run's own Eastern date. " +
        lanes.map((L) => (L.n || "none") + " " + L.aria).join("; ") + ". " +
        (gateDays === null
          ? "The gate window was not published, so no band is drawn."
          : "The earnings gate covered day 0 to day " + gateDays + ", and " + gatedIn +
            " of the " + gatedAll.length + " gated names fall inside it."),
    });

    /* The hatch that carries the band independently of hue, drawn at the
       CENTRE of its tile rather than on its edge: a stroke on a tile
       boundary is half clipped by patternUnits and renders at a fraction of
       its intended weight. Same construction, same reason, as the gamma
       surface's. */
    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: "ewHatch", width: 6, height: 6, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "ew-hatch",
    });
    pat.append(svgEl("line", {
      x1: 3, y1: 0, x2: 3, y2: 6, stroke: "currentColor", "stroke-width": 1.3,
    }));
    defs.append(pat);
    svg.append(defs);

    if (gateDays !== null) {
      /* The band covers WHOLE COLUMNS 0 through gateDays, so a mark at
         exactly gateDays sits inside it and a mark at gateDays + 1 sits
         outside — which is what `dte <= gateDays` means. Drawing to the
         column CENTRE instead would put the boundary case half in. */
      const right = Math.min(xEdge(gateDays + 1), W - padR);
      const bandX = xEdge(0).toFixed(2);
      const bandW = Math.max(0, right - xEdge(0)).toFixed(2);
      const bandNote = "The earnings gate: day 0 through day " + gateDays + " after " +
        origin + ", in calendar days. Every name reporting inside it was removed before " +
        "the board was scored, so the board holds no opinion on any of them.";
      /* THE BAND IS PAINTED OVER THE MARK ROWS ONLY, not over the lane label
         strips. Hatching behind 9px type is the cheapest way to make a label
         unreadable, and the label is what tells the reader which lane the
         marks inside the band belong to — the one sentence the band exists to
         support. The full-height edge rule below ties the segments back into
         one region.

         TWO RECTS PER SEGMENT, because a fill can only be one paint: a flat
         wash so the band reads as a region at a glance, and the hatch over it
         so it survives greyscale, a colour-blind reader and a black-and-white
         printer. The wash takes its fill from the stylesheet; the hatch's is a
         presentation attribute the stylesheet must never override. */
      for (const L of lanes) {
        const geom = { x: bandX, y: L.top.toFixed(2), width: bandW,
                       height: (L.base - L.top).toFixed(2) };
        svg.append(svgEl("rect", { class: "ew-bandbg", ...geom }));
        const seg = svgEl("rect", { class: "ew-band", ...geom, fill: "url(#ewHatch)" });
        const bt = svgEl("title");
        bt.textContent = bandNote;
        seg.append(bt);
        svg.append(seg);
      }
      svg.append(svgEl("line", {
        class: "ew-edge", x1: right.toFixed(2), x2: right.toFixed(2),
        y1: plotTop, y2: plotBottom.toFixed(2),
      }));
      const lab = svgEl("text", {
        class: "ew-bandlab", x: (xEdge(0) + 3).toFixed(2), y: padT - 5,
        "font-size": "9px", "text-anchor": "start",
      });
      lab.textContent = "GATE " + MID + " 0" + MINUS + gateDays + "d";
      svg.append(lab);
    }

    // Weekly gridlines and their labels: four or five at any width, so they fit.
    for (let d = 0; d <= axisMax; d += 7) {
      const x = xEdge(d);
      svg.append(svgEl("line", {
        class: "ew-grid", x1: x.toFixed(2), x2: x.toFixed(2),
        y1: plotTop, y2: plotBottom.toFixed(2),
      }));
      const t = svgEl("text", {
        class: "ew-tick", x: Math.min(Math.max(x, padL + 7), W - padR - 7).toFixed(2),
        y: plotBottom + 15, "font-size": "9.5px", "text-anchor": "middle",
      });
      t.textContent = d === 0 ? "0" : "+" + d + "d";
      svg.append(t);
    }
    svg.append(svgEl("line", {
      class: "ew-axis", x1: padL, x2: (W - padR).toFixed(2),
      y1: plotBottom.toFixed(2), y2: plotBottom.toFixed(2),
    }));
    const axisLab = svgEl("text", {
      class: "ew-axislab", x: (W - padR).toFixed(2), y: plotBottom + 24,
      "font-size": "9px", "text-anchor": "end",
    });
    axisLab.textContent = "calendar days after " + origin + " (not sessions)";
    svg.append(axisLab);

    for (const L of lanes) {
      const lt = svgEl("text", {
        class: "ew-lane is-" + L.key, x: padL, y: L.labelY,
        "font-size": "9.5px", "text-anchor": "start",
      });
      lt.textContent = L.short + " " + MID + " " + (L.n || "none");
      svg.append(lt);
      svg.append(svgEl("line", {
        class: "ew-lanerule", x1: padL, x2: (W - padR).toFixed(2),
        y1: L.base.toFixed(2), y2: L.base.toFixed(2),
      }));
    }

    const laneOf = new Map(lanes.map((L) => [L.key, L]));
    for (const [k, list] of stacks) {
      const L = laneOf.get(k.slice(0, k.indexOf("@")));
      if (!L) continue;
      list.forEach((m, i) => {
        const cx = xMid(m.dte);
        const cy = L.base - (i + 0.5) * rowH;
        const st = stageOf(m.r.st);
        const cls = "ew-m is-" + L.key +
          (m.r.st === "board:long" ? " is-long" : m.r.st === "board:short" ? " is-short" : "");
        let node;
        if (L.key === "gated") {
          node = svgEl("rect", {
            class: cls, x: (cx - ms / 2).toFixed(2), y: (cy - ms / 2).toFixed(2),
            width: ms, height: ms, rx: 1,
          });
        } else if (L.key === "board") {
          const h = ms / 2 + 0.6;
          node = svgEl("path", {
            class: cls,
            d: `M${cx.toFixed(2)} ${(cy - h).toFixed(2)}L${(cx + h).toFixed(2)} ${cy.toFixed(2)}` +
               `L${cx.toFixed(2)} ${(cy + h).toFixed(2)}L${(cx - h).toFixed(2)} ${cy.toFixed(2)}Z`,
          });
        } else {
          node = svgEl("circle", { class: cls, cx: cx.toFixed(2), cy: cy.toFixed(2), r: ms / 2 });
        }
        /* BOTH DAY COUNTS IN THE TITLE, each named. The mark's position is
           the calendar one; the priced move beside it was scaled by the
           session one, and a reader who conflates them will misread the
           chart and the Priced column together. */
        const sd = isNum(m.r.sdte);
        const tip = svgEl("title");
        tip.textContent = String(m.r.t || DASH) + " " + MID + " reports " + m.r.d + " " +
          MID + " " + days(m.dte) + " out from " + origin + ", which is the position drawn " +
          MID + " " +
          (sd === null ? "sessions not measured"
            : sessions(sd) + " over the same span, which is what the priced move was " +
              "scaled by" + (originClash(m.r)
                ? " — and on this row the two counts disagree about their origin" : "")) +
          " " + MID + " " + st.label + " " + MID + " priced move " + pricedShort(m.r);
        node.append(tip);
        svg.append(node);
      });
    }

    windowHost.append(svg);
    if (windowPanel) windowPanel.hidden = false;

    /* ---- the note: which clock, which unit, and then what the drawing
       actually shows rather than what it was hoped to show. Every number in
       it is counted from these rows at paint time. */
    if (windowNote) {
      const parts = [];
      parts.push("Day 0 is " + origin + " " + MID + " the run's own Eastern date, and the " +
        "origin the earnings gate itself used. It is NOT the session date: the prices in " +
        "the table describe " + (payload.sessionDate || "the last completed session") +
        ", the last completed session, while every day count on this page describes " +
        origin + ".");
      parts.push("The axis is CALENDAR days — the payload's own dte, which is the number " +
        "the gate compared, taken as published rather than recomputed here. The table's " +
        "Sessions column is a different unit: weekdays, which is what the priced move was " +
        "scaled by. Drawing this axis in sessions instead would move " +
        marks.filter((m) => {
          const sd = isNum(m.r.sdte);
          return gateDays !== null && sd !== null && (sd <= gateDays) !== (m.dte <= gateDays);
        }).length + " of these " + marks.length + " marks to the wrong side of the band.");
      if (gateDays !== null) {
        if (!gatedOut && !otherIn) {
          parts.push("The hatched band is the published gate: day 0 through day " +
            gateDays + ". Every one of the " + gatedAll.length + " gated names falls " +
            "inside it and every one of the " + otherAll.length + " the board was allowed " +
            "to score falls outside it. That separation is the whole picture: the names " +
            "the board has no opinion on are exactly the ones reporting soonest.");
        } else {
          /* If the band and the stage ever disagree, the reader is told the
             count rather than shown a tidy drawing that hides it. */
          parts.push("The hatched band is the published gate: day 0 through day " +
            gateDays + ". " + gatedIn + " of " + gatedAll.length + " gated names fall " +
            "inside it" + (gatedOut ? ", " + gatedOut + " outside" : "") +
            (otherIn ? ", and " + otherIn + " " + plural(otherIn, "name", "names") +
              " the board was allowed to score " + plural(otherIn, "sits", "sit") +
              " inside it" : "") + ". The band and the stage should agree exactly, " +
            "since both come from the same `dte`; where they do not, read the stage.");
        }
      } else {
        parts.push("This payload published no gate window, so no band is drawn. An " +
          "assumed one would be this page's arithmetic rather than the pipeline's.");
      }
      if (windowDays !== null) {
        parts.push("The axis ends at the published window, " + days(windowDays) +
          "; a name reporting beyond it is not in this payload at all.");
      }
      if (undrawn) {
        parts.push(undrawn + " " + plural(undrawn, "row carries", "rows carry") +
          " no calendar day count and " + plural(undrawn, "is", "are") +
          " left off the chart rather than drawn at day 0.");
      }
      windowNote.textContent = parts.join(" ");
    }
  }

  /* ---------- the table ------------------------------------------- */

  function cell(text, cls, title) {
    const td = el("td", cls, text);
    if (title) td.title = title;
    return td;
  }

  /**
   * THREE DIFFERENT ABSENCES WEAR THE SAME EM DASH AND MUST NOT CARRY THE
   * SAME EXPLANATION.
   *
   *   - `ev === null` with `sdte === 0`: the name reports before another
   *     session opens. There are NO SESSIONS LEFT TO PRICE. That is not a
   *     zero move and it is not a missing measurement — it is a horizon of
   *     length nothing, and nothing can be scaled to it. (No row in the
   *     current fixture is in this state; the combination is what it means
   *     when one is, which is exactly why it is written down.)
   *   - `ev === null` with `iv === null`: no 30-day implied volatility
   *     arrived for this name, so there is nothing to scale. Not measured.
   *     Two rows of the fixture are here.
   *   - anything else: the field simply is not on the row.
   *
   * All three print U+2014. The title says which.
   */
  /**
   * The priced move, or the absence of it, short enough for a chart tooltip.
   * A bare em dash inside a tooltip is worse than one in a cell: there is no
   * hover-within-a-hover to carry the reason, so the reason comes inline.
   */
  function pricedShort(row) {
    if (isNum(row.ev) !== null) return pct(row.ev, 2);
    if (isNum(row.sdte) === 0) return DASH + " (no sessions left to price)";
    if (isNum(row.iv) === null) return DASH + " (implied volatility not measured)";
    return DASH + " (not published)";
  }

  function pricedCell(row) {
    const ev = isNum(row.ev);
    if (ev !== null) {
      const sd = isNum(row.sdte);
      return cell(pct(ev, 2), "c-num ev-priced",
        "What the option market is charging for the " +
        (sd === null ? "sessions" : sessions(sd)) + " between the run and the report: " +
        "this name's 30-day implied volatility scaled by the square root of time. " +
        "Scaled by SESSIONS, not by the calendar days the chart above plots. Not a forecast.");
    }
    if (isNum(row.sdte) === 0) {
      return cell(DASH, "c-num ev-priced is-none",
        "There are no sessions left to price: this name reports before another session " +
        "opens. Not a zero move — a horizon of zero sessions, which nothing can be " +
        "scaled to. A different fact from a missing measurement.");
    }
    if (isNum(row.iv) === null) {
      return cell(DASH, "c-num ev-priced is-none",
        "No 30-day implied volatility arrived for this name, so there is nothing to " +
        "scale to the report. NOT MEASURED FOR THIS NAME — not zero.");
    }
    return cell(DASH, "c-num ev-priced is-none",
      "No priced move was published for this row. Not measured — not zero.");
  }

  function stageCell(row) {
    const st = stageOf(row.st);
    const td = el("td", "ev-stagecell");
    const chip = el("span",
      "ev-st is-" + String(row.st || "unclassified").replace(":", "-"), st.label);
    const score = isNum(row.s);
    chip.title = st.what + (score === null
      ? (row.st === "gated"
        ? " There is no score under this row at all — the composite never ran on it."
        : " No score was published for this row.")
      : " Its published score is " + signedInt(score) + ".");
    td.append(chip);
    return td;
  }

  function rowFor(row, ctx) {
    const tr = document.createElement("tr");
    const st = stageOf(row.st);
    if (st.lane === "gated") tr.className = "is-gated";

    const th = el("th", "fb-tk");
    th.scope = "row";
    const link = el("a", null, String(row.t || DASH));
    link.href = "/flows/ticker/?t=" + encodeURIComponent(String(row.t || ""));
    th.append(link);
    /* NO PUBLISHED FIELD IS SILENTLY DROPPED. `sector` and `rvol` have no
       column in this markup, so they ride here rather than going unread. */
    const rvol = isNum(row.rvol);
    th.title = (row.sector ? String(row.sector) : "Sector not published") +
      (rvol === null
        ? " " + MID + " relative volume not measured"
        : " " + MID + " relative volume " + rvol.toFixed(2) + "× its own recent norm");
    tr.append(th);

    /* THE REPORT DATE, AND THE CALENDAR COUNT THE GATE USED. The ISO date
       keeps its hyphens — U+2212 belongs to arithmetic, not to a date. */
    const dte = isNum(row.dte);
    tr.append(cell(row.d ? String(row.d) : DASH, "ev-date",
      row.d
        ? (dte === null
          ? "The report date, as published. No calendar day count came with it."
          : days(dte) + " out from " + (ctx.origin || "the run's own Eastern date") +
            ", as the earnings gate itself measured it. This is the number the chart above " +
            "plots and the one the gate window is quoted in — and it is a different UNIT " +
            "from the Sessions column beside it, which counts weekdays." +
            (originClash(row)
              ? " On this row it is also a different ORIGIN: see the Sessions cell."
              : ""))
        : "No report date on the wire for this name."));

    /* SESSIONS IS THE OTHER UNIT, and the title says what it is FOR rather
       than merely what it counts. */
    const sd = isNum(row.sdte);
    const clash = originClash(row);
    tr.append(cell(sd === null ? DASH : String(sd), "c-num" + (clash ? " ev-clash" : ""),
      sd === null
        ? "Sessions to the report were not measured for this name."
        : (clash
          ? "This row publishes " + sessions(sd) + " beside " + days(dte) + " — more " +
            "weekdays than calendar days, which no single span can contain. Neither number " +
            "is wrong on its own terms: the two were measured from different origins, and " +
            "this row is where that gap shows. Read the stage and the chart, which use the " +
            "calendar count, and treat the difference between these two columns as unsafe."
          : sd === 0
            ? "Zero sessions: this name reports before another session opens. A measured " +
              "zero, not a missing one — and the reason the Priced column beside it is empty."
            : sessions(sd) + " — weekdays from " + (ctx.origin || "the run's own date") +
              ", and the horizon the priced move was scaled by. Market holidays are not " +
              "removed. This is NOT the number the chart plots: that one counts calendar " +
              "days over the same span, in the Reports column's own title.")));

    tr.append(cell(fixed(row.px, 2), "c-num",
      isNum(row.px) === null
        ? "No close was published for this name."
        : "The close of the " + (ctx.sessionDate || "last completed") + " session — the " +
          "PRICE clock, which is not the clock any day count on this page uses."));

    tr.append(pricedCell(row));

    tr.append(cell(pct(row.im, 2), "c-num",
      isNum(row.im) === null
        ? "The vendor published no implied move for this name."
        : "The vendor's own implied move, quoted to the vendor's own next expiry — a " +
          "different horizon from the Priced column, and deliberately not reconciled with it."));

    const ivCell = el("td", "c-num ev-iv");
    const spark = sparkline(row.ivPath, ctx.labels, ctx.domain);
    if (spark) ivCell.append(spark);
    ivCell.append(el("span", "ev-ivv", pct(row.iv, 1)));
    ivCell.title = (isNum(row.iv) === null
      ? "No 30-day implied volatility arrived for this name."
      : "30-day implied volatility.") +
      (spark ? " The strip is this name's own path: " + ctx.labels.join(" " + MID + " ") +
        ", oldest first, on one scale shared by every row. A gap is a point nobody " +
        "measured and is not drawn across." : "");
    tr.append(ivCell);

    tr.append(cell(pct(row.rv, 1), "c-num ev-rv" + (isNum(row.rv) === null ? " is-none" : ""),
      isNum(row.rv) === null
        ? "Realized volatility is measured only for the enriched names, so this row " +
          "withholds it. NOT MEASURED FOR THIS NAME — not zero, and not a reading of a " +
          "quiet tape."
        : "Realized 30-day volatility, measured because this name was enriched."));

    tr.append(cell(pct(row.ivr, 0), "c-num",
      isNum(row.ivr) === null
        ? "IV rank was not measured for this name."
        : "Where this name's 30-day implied volatility sits inside its own year."));

    tr.append(stageCell(row));
    return tr;
  }

  function emptyRow(text) {
    bodyEl.replaceChildren();
    const tr = document.createElement("tr");
    const td = el("td", "flows-empty ev-empty", text);
    td.colSpan = COLUMNS;
    tr.append(td);
    bodyEl.append(tr);
    if (tablePanel) tablePanel.hidden = false;
  }

  function renderTable(payload) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const ctx = {
      origin: ISO.test(String(payload.gateOrigin || "")) ? payload.gateOrigin : null,
      sessionDate: payload.sessionDate || null,
      labels: (payload.ivPath && Array.isArray(payload.ivPath.labels))
        ? payload.ivPath.labels.map(String)
        : ["−1m", "−1w", "−1d", "now"],
      domain: pathDomain(rows),
    };

    bodyEl.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const r of rows) if (r) frag.append(rowFor(r, ctx));
    bodyEl.append(frag);
    if (tablePanel) tablePanel.hidden = false;

    const shown = isNum(payload.shown) ?? rows.length;
    const inWindow = isNum(payload.inWindow);
    const evM = isNum(payload.evMeasured);
    const rvM = isNum(payload.rvMeasured);

    if (capEl) {
      const bits = [shown + " " + plural(shown, "name", "names") + ", nearest report first"];
      if (inWindow !== null && inWindow > shown) {
        bits.push("the " + shown + " nearest of " + inWindow + " inside the window");
      }
      if (evM !== null) bits.push(evM + " of " + shown + " with a priced move");
      if (rvM !== null) bits.push(rvM + " of " + shown + " with realized volatility");
      capEl.textContent = bits.join(" " + MID + " ") + ".";
    }

    if (tableNote) {
      const parts = [];
      /* THE RV COLUMN IS MOSTLY EM DASHES BY DESIGN, and the count is stated
         beside it rather than left to be inferred from the blanks. A reader
         who counts dashes and concludes the page is broken has been misled by
         a page that could have said so in one sentence. */
      if (rvM !== null) {
        parts.push("RV is measured only for the enriched names, so " + (shown - rvM) +
          " of " + shown + " rows carry an em dash there. That is coverage, not a reading: " +
          "an empty RV cell means NOT MEASURED FOR THIS NAME, never zero volatility. " +
          (rvM
            ? "The " + rvM + " that " + plural(rvM, "does", "do") + " carry one " +
              plural(rvM, "says", "say") + " so in its own title."
            : "No row in this payload carries one."));
      }
      /* THE TWO UNITS, SIDE BY SIDE, once in prose. Two adjacent columns of
         day counts in different units is exactly the thing a reader will
         average in their head unless told not to. */
      /* THE TWO DAY COUNTS ARE TWO UNITS AND, ON THIS PAYLOAD, TWO ORIGINS.
         The clash count is taken from the rows at paint time, so the sentence
         removes itself when the module stops publishing the gap rather than
         having to be remembered and deleted. */
      const clashes = rows.filter((r) => r && originClash(r)).length;
      parts.push("Reports and Sessions are two different clocks in two different units. " +
        "Reports is a date, and its title gives the CALENDAR days the earnings gate " +
        "measured — that is what the chart above plots and what the gate window is quoted " +
        "in. Sessions counts WEEKDAYS, and that is the horizon the priced move was scaled " +
        "by. Last is the close of the " + (ctx.sessionDate || "last completed") +
        " session, a third date again." +
        (clashes
          ? " On this payload they are also counted from two different ORIGINS, which is " +
            "why " + clashes + " of these " + shown + " rows publish MORE sessions than " +
            "calendar days — something no single span can do, since every weekday in a " +
            "span is also a day in it. Those rows are marked in the Sessions column. " +
            "Neither number is wrong on its own terms, but the difference between the two " +
            "columns is not safe to read on them. The chart above is unaffected: it and " +
            "the gate band both use the calendar count."
          : ""));
      if (ctx.domain) {
        parts.push("The strip in the IV column is each name's implied-volatility path, " +
          ctx.labels.join(" " + MID + " ") + ", oldest first, drawn on one scale shared by " +
          "every row (" + pct(ctx.domain.rawLo, 1) + " to " + pct(ctx.domain.rawHi, 1) +
          ") so two rows can be compared. A missing point is left blank and never drawn " +
          "across. The payload states it is \"" +
          String((payload.ivPath && payload.ivPath.sameAs) || "the same quantity the card draws") +
          "\".");
      }
      parts.push("Whether a name reports before the open or after the close is withheld " +
        "rather than half-filled — the reason is published in full below.");
      tableNote.textContent = parts.join(" ");
    }
  }

  /* ---------- the basis panel, which is the page's honesty ---------

     THE PAYLOAD'S OWN SENTENCES, VERBATIM. Every methodological decision
     this page makes is published beside the arithmetic that produced it,
     which is what stops a renderer rewording a caption into a claim the
     numbers do not support. Nothing here is paraphrased.

     THE TWO CLOCKS AND THE PURPOSE STAY IN THE OPEN and the rest sits
     behind a disclosure. Not to hide it — it is in the DOM, selectable and
     found by a find-in-page — but because two thousand words of unbroken
     prose under a table is a rule nobody finishes reading, and a rule
     nobody finishes is a rule nobody was told. */

  const BASIS_LABELS = {
    purpose: "What this page is",
    clocks: "Two clocks, and which quantity uses which",
    gate: "The gate, and what \"gated\" means",
    sessions: "How a session is counted",
    priced: "The priced move",
    vendorMove: "The vendor's own implied move",
    announce: "The announce time, and why there is not one",
    order: "The order",
    coverage: "Realized volatility, and why that column is mostly empty",
  };

  const BASIS_GROUPS = [
    { keys: ["purpose", "clocks"], open: true },
    { keys: ["gate"], summary: "The gate, which is the reason this page exists" },
    { keys: ["priced", "vendorMove", "sessions"], summary: "How each number is built" },
    { keys: ["coverage", "announce", "order"],
      summary: "What is counted, what is withheld, and in what order" },
  ];

  /** A plain statement: a label, and the payload's own sentence as sent. */
  function basisItem(key, value) {
    const text = String(value === null || value === undefined ? "" : value).trim();
    if (!text) return null;
    const box = el("div", "ev-b-item");
    box.append(el("p", "ev-b-k", BASIS_LABELS[key] || key));
    box.append(el("p", "ev-b-p", text));
    return box;
  }

  /**
   * A WITHHELD FIELD, DRAWN TO LOOK UNLIKE A MEASUREMENT.
   *
   * `announce: {status: "unavailable", reason}` is the payload saying a
   * column was chosen against, with the cost of having it. Rendering that
   * as one more paragraph of method would file a deliberate refusal under
   * the same heading as a description of something that was measured.
   */
  function withheldBlock(announce) {
    if (!announce || typeof announce !== "object") return null;
    const box = el("div", "ev-withheld");
    box.append(el("p", "ev-withheld-tag",
      "Withheld " + MID + " announce time " + MID + " " + String(announce.status || "unavailable")));
    const reason = String(announce.reason === null || announce.reason === undefined
      ? "" : announce.reason).trim();
    if (reason) box.append(el("p", "ev-b-p", reason));
    return box;
  }

  function renderBasis(payload) {
    if (!basisHost) return;
    basisHost.replaceChildren();
    const notes = (payload && payload.notes && typeof payload.notes === "object")
      ? payload.notes : null;
    const announce = payload && payload.announce;

    if (!notes) {
      basisHost.append(el("p", "fc-note",
        "This payload carried no notes block, so the page cannot say in the pipeline's " +
        "own words how its numbers were built. Treat everything above as unexplained."));
    }

    /* The announce reason and notes.announce are the SAME sentence in every
       payload the emitter produces. Printing it twice would read as two
       separate refusals; it is one. */
    const announceReason = announce && typeof announce === "object"
      ? String(announce.reason || "").trim() : "";
    const drawn = new Set();
    if (notes && announceReason && String(notes.announce || "").trim() === announceReason) {
      drawn.add("announce");
    }

    for (const group of BASIS_GROUPS) {
      const items = [];
      for (const key of group.keys) {
        if (drawn.has(key)) continue;
        if (!notes || !Object.prototype.hasOwnProperty.call(notes, key)) continue;
        const node = basisItem(key, notes[key]);
        drawn.add(key);
        if (node) items.push(node);
      }
      if (group.keys.indexOf("announce") !== -1) {
        const w = withheldBlock(announce);
        if (w) items.push(w);
      }
      if (!items.length) continue;
      if (group.open) {
        const open = el("div", "ev-spine");
        for (const node of items) open.append(node);
        basisHost.append(open);
      } else {
        const box = el("details", "ev-how");
        box.append(el("summary", "ev-how-s", group.summary));
        for (const node of items) box.append(node);
        basisHost.append(box);
      }
    }

    /* ANY NOTE THE PAYLOAD ADDS LATER STILL REACHES THE READER. A notes
       block that grows a tenth entry must not lose it to a hardcoded group
       list — that is precisely how four published panels went undrawn for a
       month elsewhere in this product. */
    const extra = notes ? Object.keys(notes).filter((k) => !drawn.has(k)) : [];
    if (extra.length) {
      const box = el("details", "ev-how");
      box.append(el("summary", "ev-how-s", "Also published in the notes"));
      for (const key of extra) {
        const node = basisItem(key, notes[key]);
        if (node) box.append(node);
      }
      basisHost.append(box);
    }
    if (basisPanel) basisPanel.hidden = false;
  }

  /* ---------- the status strip ------------------------------------ */

  function renderStatus(payload) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const shown = isNum(payload.shown) ?? rows.length;
    const inWindow = isNum(payload.inWindow);
    const universe = isNum(payload.universe);
    const undated = isNum(payload.undated);
    const windowDays = isNum(payload.windowDays);
    /* A MISSING byStage IS NOT A GATE THAT CAUGHT NOBODY. If the block is
       absent the count is unknown and the clause is dropped; if it is present
       without a `gated` key the pipeline counted none, which is a measured
       zero and is said as "none". */
    const hasStages = !!(payload.byStage && typeof payload.byStage === "object");
    const gated = hasStages ? (isNum(payload.byStage.gated) ?? 0) : null;
    const cap = isNum(payload.cap);

    const parts = [];
    /* THE COUNT AND ITS DENOMINATORS STAY TOGETHER. Split across separators
       they read as separate facts and the reader has to reassemble them. */
    parts.push(shown + (inWindow === null || inWindow === shown ? "" : " of " + inWindow) +
      " " + plural(shown, "name", "names") + " reporting inside the " +
      (windowDays === null ? "" : windowDays + "-day ") + "window" +
      (universe === null ? "" : ", of " + universe + " screened"));
    /* THE GATE COUNT IS THE HEADLINE, and it goes second, next to the count
       it qualifies. It is stated as a PROHIBITION rather than as an outcome:
       these are names the board was not allowed to have an opinion on. */
    if (gated !== null) {
      parts.push("the board was gated out of scoring " + (gated || "none") + " of them");
    }
    if (undated !== null && undated > 0) {
      parts.push(undated + (universe === null ? "" : " of the " + universe) +
        " carry no earnings date at all");
    }
    if (cap !== null && inWindow !== null && inWindow > shown) {
      parts.push("the cap holds the list to " + cap);
    }
    /* BOTH DATES, EACH WITH WHAT IT GOVERNS. Naming one alone is how a page
       ends up drawing its window from the wrong clock in silence. */
    const sd = payload.sessionDate, go = payload.gateOrigin;
    parts.push("prices are the " + (sd ? sd : "last completed") + " session's closes" +
      "; every day count is measured from " + (go ? go : "the run's own Eastern date") +
      (go ? ", the run's own Eastern date and the origin the earnings gate used" : ""));
    statusEl.textContent = parts.join(" " + MID + " ") + ".";

    const slot = document.querySelector('[data-rail-count="events"]');
    if (slot && shown) { slot.textContent = String(shown); slot.hidden = false; }

    if (footEl) {
      const foot = [];
      if (payload.generatedAt) {
        const t = Date.parse(payload.generatedAt);
        foot.push("Built " + (Number.isFinite(t)
          ? new Date(t).toLocaleString() : String(payload.generatedAt)));
      }
      const v = isNum(payload.v);
      if (v !== null) foot.push("payload v" + v);
      foot.push("Zero vendor calls: every field here was already on the wire.");
      footEl.textContent = foot.join(" " + MID + " ");
    }
  }

  /* ---------- states ----------------------------------------------

     A FAILED FETCH MUST NOT LEAVE A PANEL ON "Loading…". A spinner that
     never resolves is indistinguishable from a slow one, and a reader
     waits for a page that has already given up. Every panel is unhidden
     precisely so that each can carry the failure. */

  function failEverywhere(what) {
    statusEl.textContent = what;
    windowMessage(what);
    if (windowNote) windowNote.textContent = "";
    emptyRow(what);
    if (capEl) capEl.textContent = "No name could be listed.";
    if (tableNote) tableNote.textContent = "";
    if (basisHost) {
      basisHost.replaceChildren(el("p", "fc-note",
        "The basis travels inside the same payload as the numbers, so it could not be " +
        "loaded either. Nothing on this page has been explained by the pipeline."));
      if (basisPanel) basisPanel.hidden = false;
    }
    if (footEl) footEl.textContent = "";
  }

  function renderStale(updatedAt) {
    if (!staleEl || !updatedAt) return;
    const ageHours = (Date.now() - updatedAt) / 3600000;
    if (ageHours <= 30) return;
    staleEl.hidden = false;
    /* THE SAME STALENESS RULE THE BOARD AND THE WATCH LIST USE. It matters
       more here than anywhere: a stale calendar does not LOOK stale — it
       looks like a week in which nothing reports soon. */
    staleEl.textContent = "This calendar was last written " + Math.round(ageHours / 24) +
      " day(s) ago. The pipeline has not published since, so every day count below is " +
      "measured from that run's date and not from today — each name is nearer to its " +
      "report than this page says.";
  }

  /* ---------- the fetch ------------------------------------------- */

  fetch("/api/flows/events", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then((response) => {
    if (response.status === 401) { location.replace("/flows/"); return null; }
    if (!response.ok) throw new Error("HTTP " + response.status);
    const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
    return response.json().then((payload) => {
      if (payload && typeof payload === "object") payload.__updatedAt = updatedAt;
      return payload;
    });
  }).then((payload) => {
    if (!payload) return;                       // the 401 branch has already navigated
    if (typeof payload !== "object") throw new Error("the endpoint answered with no payload");

    if (payload.status === "pending") {
      /* THE ORDINARY STATE BEFORE THE FIRST RUN, stated as a fact about the
         store rather than as an error. There is no blob under this key yet. */
      const msg = "The pipeline has not published this key yet. This calendar is built by " +
        "the weekday-morning run out of screener rows it already holds — it costs no " +
        "vendor call — and it appears with the first run after this page shipped.";
      statusEl.textContent = msg;
      windowMessage(msg);
      if (windowNote) windowNote.textContent = "";
      emptyRow(msg);
      if (capEl) capEl.textContent = "Nothing has been published under this key.";
      if (tableNote) tableNote.textContent = "";
      renderBasis(payload);
      return;
    }

    renderStale(payload.__updatedAt);

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      /* AN EMPTY CALENDAR IS A REAL READING, not a fault: the emitter stamps
         status "quiet" when nothing in the universe reports inside the
         window. Said as a measured emptiness, with its denominators, and NOT
         as a failure. */
      renderStatus(payload);
      const universe = isNum(payload.universe);
      const windowDays = isNum(payload.windowDays);
      const msg = "No name in the screened universe" +
        (universe === null ? "" : " of " + universe) + " reports inside the next " +
        (windowDays === null ? "window" : days(windowDays)) + ". That is a measured " +
        "emptiness — the run read every screener row and found no dated report inside " +
        "it — and not a missing publish.";
      windowMessage(msg);
      if (windowNote) windowNote.textContent = "";
      emptyRow(msg);
      if (capEl) capEl.textContent = "No name reports inside the window.";
      if (tableNote) tableNote.textContent = "";
      renderBasis(payload);
      return;
    }

    renderStatus(payload);
    renderWindow(payload);
    renderTable(payload);
    renderBasis(payload);
  }).catch((error) => {
    failEverywhere("The calendar could not be loaded: " + (error && error.message
      ? error.message : "the request failed") + ". Refresh to try again.");
  });

  /* THE CHART IS REDRAWN AT THE NEW WIDTH, never scaled to it. One viewBox
     unit is one CSS pixel, and a resize that left the old viewBox in place
     would quietly break that on the first rotation of a phone. */
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    if (!drawn) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (drawn && Math.abs(chartWidth() - drawnW) > 2) renderWindow(drawn);
    }, 150);
  });
})();
