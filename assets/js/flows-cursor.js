/* =============================================================
   flows-cursor.js — the cursor every Flows chart shares.

   WHAT A STATIC CHART WITHHOLDS. Every chart in this section draws a
   series and labels its axis at a handful of ticks, which answers "what
   is the shape" and refuses "what was it on the 14th". The values are
   all there — the renderer had them to place the marks — and a reader
   could only ever recover them by measuring pixels against an axis.
   Some charts carried a native `title` on each mark, which is a
   tooltip a mouse can find, after a delay, one mark at a time, and
   which a keyboard cannot reach at all.

   SO THE CURSOR IS ONE IMPLEMENTATION, NOT ONE PER CHART. A renderer
   hands over the points it already computed — their x in the chart's
   own user units, a label, and the rows to print — and gets a vertical
   rule, a positioned readout, arrow-key navigation and a live region
   for free. Nothing here re-derives a value: if the number in the
   readout disagrees with the mark above it, that is this file's bug,
   because it was handed the same array the marks were drawn from.

   THE COORDINATE MAPPING IS THE BROWSER'S, NOT ARITHMETIC OF OURS.
   These charts are drawn into a viewBox and scaled to the width of
   whatever panel holds them, sometimes with letterboxing. Converting a
   pointer's client x into user units by hand means reproducing that
   scaling — and getting it subtly wrong the first time a panel is
   narrower than its aspect ratio. `getScreenCTM().inverse()` is the
   transform the browser actually used, so it is exact by construction
   at every width and under every preserveAspectRatio.

   THE READOUT IS FIXED-POSITIONED AND THAT IS DELIBERATE. Charts here
   live inside panels that clip and scroll; a readout positioned inside
   the panel is a readout clipped by it. Fixed coordinates come off the
   same rect the cursor was measured in, and the readout is removed on
   leave, blur and Escape, so it cannot outlive the pointer that
   summoned it.

   KEYBOARD IS NOT AN AFTERTHOUGHT HERE. The chart takes focus, arrows
   step point to point, Home and End jump to the ends, Escape dismisses.
   Every move writes the same sentence into a polite live region, so a
   reader who cannot see the rule hears the reading rather than being
   told a chart exists.

   ---- THE THREE RULES EVERY REGISTRATION FOLLOWS -------------------

   Sixteen charts across three files register here, and the first draft
   of that work restated these at each of them. They are properties of
   the contract, so they live here; what stays beside a registration is
   only what is peculiar to that chart.

   1. NOTHING IN A SPEC IS RE-DERIVED. A registration passes the very
      functions that placed the marks and the very values they were
      placed from. Recomputing either is a second opinion about one
      series, and the day the two disagree the page draws a rule on one
      mark and prints the number of another.

   2. AN ABSENT READING IS SAID, NEVER DRAWN AS A ZERO. A chart can
      leave the ink out; a readout has a fixed row count and cannot, so
      every registration prints the payload's own reason where there is
      one and "not reported" where there is not.

   3. THE BAND IS THE PLOT, NOT THE CANVAS, so the rule stops short of
      the axis labels, the legend and any annotation rail — passed as
      the same padding its renderer reserved them with.
   ============================================================= */
(function () {
  "use strict";

  var REDUCED = typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ONE READOUT AND ONE LIVE REGION FOR THE WHOLE PAGE. A chart per panel
     would otherwise mean a dozen absolutely-positioned boxes and a dozen
     live regions, of which eleven are always empty — and two live regions
     announcing at once is worse than none. */
  var box = null, live = null;

  function readout() {
    if (box) return box;
    box = document.createElement("div");
    box.className = "fx-read";
    box.setAttribute("role", "presentation");
    box.hidden = true;
    document.body.appendChild(box);
    return box;
  }

  function announcer() {
    if (live) return live;
    live = document.createElement("p");
    live.className = "visually-hidden";
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    document.body.appendChild(live);
    return live;
  }

  function hide() {
    if (box) { box.hidden = true; box.replaceChildren(); }
  }

  /* The rule that marks WHICH point is being read. It is drawn inside the
     chart's own coordinate system — so it lands exactly on the mark rather
     than near it — and its stroke does not scale with the viewBox, which is
     what keeps a hairline a hairline in a panel scaled to 1.4x. */
  function rule(svg) {
    var g = svg.querySelector(".fx-cursor");
    if (g) return g;
    g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "fx-cursor");
    g.setAttribute("aria-hidden", "true");
    var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    g.appendChild(line);
    svg.appendChild(g);
    return g;
  }

  function place(svg, spec, i) {
    var pt = spec.points[i];
    if (!pt) return;
    var g = rule(svg), line = g.firstChild;
    var band = spec.band || {};
    /* TWO ORIENTATIONS, BECAUSE NOT EVERY CHART HERE PUTS ITS INDEX ON X.
       The gamma profile is transposed — its shared index is the STRIKE, and
       strikes run down the side — so a cursor that only ever measured x would
       have had nothing to say on it, or worse, would have been forced onto
       the wrong axis to look like it worked. `axis: "y"` swaps which
       coordinate is searched and which way the rule is drawn; everything
       else, including the readout, is identical. */
    if (spec.axis === "y") {
      var x0 = typeof band.x0 === "number" ? band.x0 : 0;
      var x1 = typeof band.x1 === "number" ? band.x1 : viewW(svg);
      line.setAttribute("x1", x0); line.setAttribute("x2", x1);
      line.setAttribute("y1", pt.y); line.setAttribute("y2", pt.y);
    } else {
      var y0b = typeof band.y0 === "number" ? band.y0 : 0;
      var y1b = typeof band.y1 === "number" ? band.y1 : viewH(svg);
      line.setAttribute("x1", pt.x); line.setAttribute("x2", pt.x);
      line.setAttribute("y1", y0b); line.setAttribute("y2", y1b);
    }
    g.removeAttribute("hidden");

    var el = readout();
    el.replaceChildren();
    if (pt.label) {
      var h = document.createElement("p");
      h.className = "fx-read-k";
      h.textContent = pt.label;
      el.appendChild(h);
    }
    var rows = Array.isArray(pt.rows) ? pt.rows : [];
    for (var r = 0; r < rows.length; r++) {
      var row = document.createElement("p");
      row.className = "fx-read-r";
      var k = document.createElement("span");
      k.className = "fx-read-rk";
      k.textContent = rows[r].k;
      var v = document.createElement("span");
      v.className = "fx-read-rv" + (rows[r].cls ? " " + rows[r].cls : "");
      v.textContent = rows[r].v;
      row.appendChild(k); row.appendChild(v);
      el.appendChild(row);
    }
    el.hidden = false;

    /* POSITIONED OFF THE MARK, NOT OFF THE POINTER, so the readout does not
       jitter under a moving hand and so the keyboard gets the same placement
       as the mouse. It flips to the left of the rule when it would otherwise
       run past the viewport's right edge, and is clamped at the top. */
    var rect = svg.getBoundingClientRect();
    var ctm = svg.getScreenCTM();
    var atX = rect.left + rect.width / 2, atY = rect.top;
    if (ctm) {
      var p = svg.createSVGPoint();
      p.x = spec.axis === "y" ? (typeof band.x0 === "number" ? band.x0 : 0) : pt.x;
      p.y = spec.axis === "y" ? pt.y : (typeof band.y0 === "number" ? band.y0 : 0);
      var screen = p.matrixTransform(ctm);
      atX = screen.x; atY = screen.y;
    }
    var w = el.offsetWidth, h2 = el.offsetHeight;
    var left = atX + 12;
    if (left + w > window.innerWidth - 8) left = atX - w - 12;
    if (left < 8) left = 8;
    /* ON A TRANSPOSED CHART THE READOUT FOLLOWS THE ROW, because the whole
       point of the rule there is which STRIKE is being read; pinned to the
       top it would name a row the eye is nowhere near. */
    var top = spec.axis === "y" ? atY - h2 / 2 : rect.top + 8;
    if (top + h2 > window.innerHeight - 8) top = window.innerHeight - h2 - 8;
    if (top < 8) top = 8;
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
    if (REDUCED) el.style.transition = "none";
  }

  function viewH(svg) {
    var vb = svg.viewBox && svg.viewBox.baseVal;
    return vb && vb.height ? vb.height : (svg.getBoundingClientRect().height || 100);
  }

  function viewW(svg) {
    var vb = svg.viewBox && svg.viewBox.baseVal;
    return vb && vb.width ? vb.width : (svg.getBoundingClientRect().width || 100);
  }

  /* THE NEAREST POINT BY X, AND A LINEAR SCAN IS THE RIGHT TOOL. These
     series are tens of points, rarely a few hundred; a binary search over
     an array that may not be sorted would be faster and wrong. */
  function nearest(spec, at) {
    var onY = spec.axis === "y";
    var best = -1, bestD = Infinity;
    for (var i = 0; i < spec.points.length; i++) {
      var v = onY ? spec.points[i].y : spec.points[i].x;
      var d = Math.abs(v - at);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function say(spec, i) {
    var pt = spec.points[i];
    if (!pt) return "";
    var rows = Array.isArray(pt.rows) ? pt.rows : [];
    var parts = [];
    for (var r = 0; r < rows.length; r++) parts.push(rows[r].k + " " + rows[r].v);
    return (pt.label ? pt.label + ": " : "") + parts.join(", ");
  }

  /**
   * Attach a cursor to one chart.
   *
   * @param {SVGElement} svg   the chart, drawn in its own viewBox
   * @param {{points: Array, band?: {y0:number,y1:number}, name?: string}} spec
   *        points: [{x, label, rows:[{k, v, cls}]}] in the chart's user units,
   *        in drawing order. band: the plot's vertical extent, so the rule
   *        does not run through the axis labels. name: what this chart is, for
   *        the keyboard hint and the live region.
   */
  function attach(svg, spec) {
    if (!svg || !spec || !Array.isArray(spec.points) || !spec.points.length) return;
    /* A point must carry the coordinate the cursor is going to search on.
       A transposed spec whose points only have x would place every rule at
       the same place and report the first point for every position — a
       cursor that looks like it works and reads one row forever. */
    var coord = spec.axis === "y" ? "y" : "x";
    for (var q = 0; q < spec.points.length; q++) {
      if (typeof spec.points[q][coord] !== "number") return;
    }
    /* IDEMPOTENT, because every renderer here redraws on a toggle and a
       second attach would double every listener on the same element. */
    if (svg.dataset.fxCursor === "on") return;
    svg.dataset.fxCursor = "on";

    var at = -1;

    function show(i) {
      if (i < 0 || i >= spec.points.length || i === at) return;
      at = i;
      place(svg, spec, i);
    }
    function clear() {
      at = -1;
      var g = svg.querySelector(".fx-cursor");
      if (g) g.setAttribute("hidden", "hidden");
      hide();
    }

    svg.addEventListener("pointermove", function (e) {
      var ctm = svg.getScreenCTM();
      if (!ctm) return;
      var p = svg.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      var u = p.matrixTransform(ctm.inverse());
      show(nearest(spec, spec.axis === "y" ? u.y : u.x));
    });
    svg.addEventListener("pointerleave", clear);

    /* THE CHART IS FOCUSABLE AND SAYS WHAT IT IS. Without a role and a label
       a focus stop on an <svg> is an announced nothing; with them it is "IREN
       price, image" and then the reading the arrows produce. */
    if (!svg.hasAttribute("tabindex")) svg.setAttribute("tabindex", "0");
    if (!svg.hasAttribute("role")) svg.setAttribute("role", "img");
    if (spec.name && !svg.hasAttribute("aria-label")) {
      svg.setAttribute("aria-label", spec.name +
        ". Use the arrow keys to read each point.");
    }

    svg.addEventListener("keydown", function (e) {
      var k = e.key, n = spec.points.length;
      if (k === "ArrowRight" || k === "ArrowUp") {
        show(at < 0 ? 0 : Math.min(n - 1, at + 1));
      } else if (k === "ArrowLeft" || k === "ArrowDown") {
        show(at < 0 ? n - 1 : Math.max(0, at - 1));
      } else if (k === "Home") { show(0); }
      else if (k === "End") { show(n - 1); }
      else if (k === "Escape") { clear(); svg.blur(); return; }
      else { return; }
      e.preventDefault();
      announcer().textContent = say(spec, at);
    });
    svg.addEventListener("blur", clear);
  }

  window.FlowsCursor = { attach: attach };
})();
