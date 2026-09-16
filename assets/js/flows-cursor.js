(function () {
  "use strict";

  var REDUCED = typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  function attach(svg, spec) {
    if (!svg || !spec || !Array.isArray(spec.points) || !spec.points.length) return;

    var coord = spec.axis === "y" ? "y" : "x";
    for (var q = 0; q < spec.points.length; q++) {
      if (typeof spec.points[q][coord] !== "number") return;
    }

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
