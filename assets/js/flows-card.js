/* =============================================================
   flows-card.js — the card reader.

   A modal <dialog> over the board, not an inline row expansion and
   not a separate route.

   Inline was rejected on geometry: the table sits inside a
   min-width:46rem horizontal scroll container, so an expanded row's
   content would be off-screen at 320px — satisfying the suite's
   zero-page-overflow assertion on a technicality while being
   unusable in fact. A separate route was rejected on cost: the
   workflow is scan, drill, scan again, and a document navigation
   loses which side was selected and where the reader had scrolled.

   Native showModal() is used rather than a hand-rolled overlay
   because it supplies background inertness, a focus trap, top-layer
   stacking above the fixed topbar, and the cancel event — four
   things that are tedious to get subtly right by hand.

   EVERY PANEL IS A TAGGED UNION. The renderer switches on
   panel.status BEFORE touching a number. A missing source must never
   reach a chart, because on a card there is no cross-section to
   normalise against and a fallback zero renders as the most extreme
   reading the panel can produce.
   ============================================================= */
(function () {
  "use strict";

  const dialog = document.getElementById("flowsCard");
  if (!dialog || typeof dialog.showModal !== "function") return;

  const DASH = "—";
  const cache = new Map();          // ticker -> payload, LRU-bounded
  const CACHE_MAX = 6;
  let pushedByUs = false;
  let current = null;
  let opener = null;
  const inflight = new Map();

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  };

  const isNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  /* ONE MINUS SIGN, U+2212, everywhere on the card. JavaScript's own toFixed
     emits U+002D, which is narrower and sits lower, so a card mixed the two
     within a single numeric column — the money formatter used the typographic
     minus and every other formatter the hyphen. */
  const MINUS = "\u2212";
  const neg = (str) => String(str).replace(/-/g, MINUS);
  const signed = (n, body) => (n >= 0 ? "+" : MINUS) + body(Math.abs(n));
  const pct = (v) => (isNum(v) === null ? DASH : signed(v, (a) => (a * 100).toFixed(2) + "%"));
  const pct1 = (v) => (isNum(v) === null ? DASH : signed(v, (a) => (a * 100).toFixed(1) + "%"));
  const sigma = (v) => (isNum(v) === null ? DASH : signed(v, (a) => a.toFixed(2) + "σ"));
  const px2 = (v) => (isNum(v) === null ? DASH : neg(v.toFixed(2)));
  const vol1 = (v) => (isNum(v) === null ? DASH : neg((v * 100).toFixed(1)) + "%");
  // "$-1.23B" prints the sign inside the currency symbol. The minus belongs in
  // front of the whole quantity, which is where a reader scanning a column
  // expects it.
  const money = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : "") + "$" + compact(Math.abs(n));
  };
  const compact = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const a = Math.abs(n);
    const s = n < 0 ? MINUS : "";
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return s + (a / 1e3).toFixed(0) + "K";
    return s + a.toFixed(0);
  };

  /* ---------- panel scaffolding ----------------------------------- */

  /** A panel that could not be built says so, and shows no numbers. */
  function deadPanel(host, question, reason) {
    host.replaceChildren();
    host.append(el("p", "fc-q", question));
    const note = el("p", "fc-dead");
    note.append(el("strong", null, "Unavailable. "));
    note.append(document.createTextNode(
      reason || "This panel's data source did not return.",
    ));
    host.append(note);
  }

  /**
   * A definition list whose pairs cannot come apart.
   *
   * The stat block was a grid of `repeat(auto-fit, minmax(8rem, 1fr))` with dt
   * and dd as separate children, so six items in five columns wrapped the last
   * dt onto a new row and orphaned its dd under the WRONG label — on every
   * desktop card, silently, because the six-item case only appeared once the
   * panel grew. Wrapping each pair makes the grid item atomic.
   */
  function statList(pairs) {
    const dl = el("dl", "fc-stats");
    for (const [k, v, cls] of pairs) {
      const wrap = el("div", "fc-stat");
      wrap.append(el("dt", null, k));
      wrap.append(el("dd", cls || null, v));
      dl.append(wrap);
    }
    return dl;
  }

  function panelHead(host, question) {
    host.replaceChildren();
    host.append(el("p", "fc-q", question));
    return host;
  }

  /* ---------- the flagship: gamma profile -------------------------- */

  /**
   * Symlog: linear inside a threshold, logarithmic beyond it.
   *
   * Per-strike dealer gamma spans four or five orders of magnitude within one
   * name. Linear collapses every non-ATM strike to a sub-pixel sliver and the
   * wing structure — where the interesting hedging pressure builds — vanishes.
   * Pure log can represent neither a sign nor a zero, and both are load-bearing
   * here. Symlog is sign-preserving, zero-admitting and monotonic, so the
   * cumulative curve's zero crossing is still drawn at exactly the right place;
   * only magnitude COMPARISON is compressed, which is the trade taken
   * knowingly and declared in the axis note.
   */
  function symlog(tau, vmax, lambda) {
    const lam = lambda === undefined ? 0.35 : lambda;
    const span = vmax > tau ? Math.log10(vmax / tau) : 0;
    return (v) => {
      const a = Math.abs(v);
      const s = v < 0 ? -1 : 1;
      if (a <= tau || span <= 0) return s * (tau > 0 ? lam * (a / tau) : 0);
      return s * (lam + (1 - lam) * (Math.log10(a / tau) / span));
    };
  }

  /**
   * THE VIEWBOX UNIT MUST BE ONE CSS PIXEL, on every panel.
   *
   * A viewBox fixed at 560 units, emitted with width="100%", is scaled by the
   * browser to whatever the container is — and it scales the TEXT with it.
   * Measured at a 320px viewport, where the dialog's inner width is 288px: the
   * factor is 288/560 = 0.514, so a 9px axis label renders at 4.6 CSS px and a
   * 10.5px one at 5.4. Unreadable, and silently so, because nothing overflows.
   *
   * The gamma and path panels already sized themselves from the host; the four
   * added later did not. Same bounds as the gamma panel, so a wide desktop gets
   * a wider plot rather than a magnified one.
   */
  function panelWidth(host) {
    return Math.max(300, Math.min(760, (host && host.clientWidth) || 560));
  }

  /** A round tick interval at or just below `raw`: 1, 2, 2.5 or 5 times a power of ten. */
  function niceStep(raw) {
    if (!(raw > 0)) return 0;
    const e = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [5, 2.5, 2, 1]) if (m * e <= raw) return m * e;
    return e;
  }

  function quantileAbs(values, q) {
    const s = values.map(Math.abs).sort((a, b) => a - b);
    if (!s.length) return 0;
    const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
    return s[i];
  }

  function renderGamma(host, panel, card) {
    const question =
      "Where does dealer hedging flip from damping moves to amplifying them, " +
      "and how far is that from spot?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.bars) || !panel.bars.length) {
      return deadPanel(host, question, panel && panel.reason);
    }
    panelHead(host, question);

    const bars = panel.bars.filter((b) => isNum(b.k) !== null && isNum(b.g) !== null);
    if (!bars.length) return deadPanel(host, question, "no usable strikes");
    bars.sort((a, b) => a.k - b.k);

    const spot = isNum(panel.spot);
    const flip = isNum(card.gammaFlip);

    // Cumulative gamma IS the convexity: the running total below a strike is
    // the dealer's net gamma if spot were there, and its zero crossing is the
    // flip. Drawing it beside the bars saves the reader integrating by eye.
    let run = 0;
    const cum = bars.map((b) => (run += b.g));

    const W = Math.max(300, Math.min(760, host.clientWidth || 560));
    const ROW = bars.length > 34 ? 9 : 12;
    const padT = 16, padB = 30, labelW = 46, railW = 132;
    const plotL = labelW, plotR = W - railW;
    const plotW = Math.max(60, plotR - plotL);
    const H = padT + bars.length * ROW + padB;

    const mags = bars.map((b) => b.g);
    const vmax = Math.max(...mags.map(Math.abs), 1);
    const tau = Math.max(quantileAbs(mags, 0.6), vmax / 1000);
    const f = symlog(tau, vmax);
    const fs = bars.map((b) => f(b.g));
    const fMin = Math.min(...fs, 0), fMax = Math.max(...fs, 0);

    // Placing zero by the data rather than at the centre: a symmetric axis
    // wastes half the plot when a book is 95% one-signed. The clamp keeps the
    // minority side visible instead of squeezing it to nothing.
    const share = Math.abs(fMin) / (Math.abs(fMin) + Math.abs(fMax) || 1);
    const x0 = plotL + plotW * Math.min(0.82, Math.max(0.18, share));
    const negW = x0 - plotL, posW = plotR - x0;

    /* ONE SCALE ACROSS THE ZERO RULE.

       Each side used to be normalised against its OWN extreme, so the largest
       bar on each side was drawn at that side's full width no matter what it
       was worth. A book whose short side is 1% of its long side drew that 1%
       at 22% of the ink — the reader's first impression of the balance of the
       book was manufactured by the renderer.

       `rate` is the largest pixels-per-unit that fits BOTH sides inside their
       halves, so the two are directly comparable and neither overflows. */
    const rate = Math.min(
      Math.abs(fMin) > 0 ? negW / Math.abs(fMin) : Infinity,
      fMax > 0 ? posW / fMax : Infinity,
    );
    const barRate = Number.isFinite(rate) ? rate : 0;
    const xOf = (v) => x0 + f(v) * barRate;

    const lo = bars[0].k, hi = bars[bars.length - 1].k;
    const yOfIndex = (i) => padT + (bars.length - 1 - i) * ROW + ROW / 2;
    const yOfPrice = (p) => {
      if (!(hi > lo)) return padT + (bars.length * ROW) / 2;
      const t = (p - lo) / (hi - lo);
      return padT + (1 - Math.min(1, Math.max(0, t))) * (bars.length - 1) * ROW + ROW / 2;
    };

    const svg = svgEl("svg", {
      class: "gp", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    /* Negative bars are hatched, not merely recoloured. Position is the
       primary encoding (left of the zero rule), texture the second, line
       style on the cumulative curve the third; colour is last, so a
       greyscale render or a colour-blind reader loses nothing that matters. */
    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: "gpNeg", width: 4, height: 4, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "gp-negpat",
    });
    /* The hatch line sits at the CENTRE of the tile, not on its edge. At x=0
       a 1.6px stroke puts 0.8px outside the tile, where patternUnits clips it,
       so a short-gamma bar rendered at a fraction of the ink of an identical
       long-gamma bar and the texture that is supposed to carry the sign in a
       greyscale render was almost invisible. */
    pat.append(svgEl("line", { x1: 2, y1: 0, x2: 2, y2: 4, stroke: "currentColor", "stroke-width": 1.8 }));
    defs.append(pat);
    svg.append(defs);

    /* DECADE TICKS. A symlog's log segment is exactly scale-invariant, so a
       book with a 35:1 spread and one with a 4e17:1 spread draw identically:
       bar LENGTH alone encodes rank, not magnitude. Printing a rule and a
       label at each power of ten restores the magnitude to the ink, which is
       what the panel's own note used to apologise for not having. */
    const marks = [];
    for (let e = Math.ceil(Math.log10(tau)); Math.pow(10, e) <= vmax; e++) marks.push(Math.pow(10, e));
    /* A book whose whole range is under one decade would otherwise get NO
       magnitude reference at all, which is the failure this rail exists to
       fix. The knee — where the axis stops being linear — and the widest bar
       are always marked, so the reader always has two labelled quantities to
       read the rest against. */
    marks.push(tau, vmax);

    /* THE GUARANTEED MARKS WERE ALWAYS REJECTED. `rate` is the largest
       pixels-per-unit that fits both sides, so whenever the zero rule is not
       clamped to its 18/82 bounds, negW/|fMin| and posW/fMax are EQUAL and
       xOf(+-vmax) lands exactly on plotR or plotL — inside the two-unit edge
       test. The widest bar, which this rail's own comment promises is always
       marked, was drawn on none of the 109 emitted cards. Clamp the guaranteed
       pair inward instead of discarding it; a decade that falls off the end is
       still dropped, because unlike vmax it is not load-bearing. */
    const guaranteed = new Set([tau, vmax]);
    const decades = [];
    for (const v of marks.sort((a, b) => a - b)) {
      for (const sgn of [1, -1]) {
        let x = xOf(sgn * v);
        if (guaranteed.has(v)) x = Math.min(plotR - 2, Math.max(plotL + 2, x));
        else if (x < plotL + 2 || x > plotR - 2) continue;
        if (Math.abs(x - x0) < 18) continue;             // never crowd the zero rule
        if (decades.some((d) => Math.abs(d.x - x) < 40)) continue;
        decades.push({ x, v, sgn });
      }
    }
    for (const d of decades) {
      svg.append(svgEl("line", { class: "gp-tick", x1: d.x, x2: d.x, y1: padT - 2, y2: H - padB + 2 }));
      const t = svgEl("text", { class: "gp-ticklabel", x: d.x, y: H - padB + 14, "text-anchor": "middle" });
      t.textContent = (d.sgn < 0 ? MINUS : "") + compact(d.v);
      svg.append(t);
    }

    // the zero rule
    svg.append(svgEl("line", { class: "gp-zero", x1: x0, x2: x0, y1: padT - 4, y2: H - padB + 4 }));

    bars.forEach((b, i) => {
      const xg = xOf(b.g);
      const y = yOfIndex(i) - (ROW - 4) / 2;
      const neg = b.g < 0;
      svg.append(svgEl("rect", {
        class: "gp-bar " + (neg ? "is-neg" : "is-pos"),
        x: Math.min(x0, xg), y,
        // A zero-width bar reads as NO DATA; tiny-but-nonzero is a different
        // fact, so there is a minimum width.
        width: Math.max(Math.abs(xg - x0), 1.5),
        height: ROW - 4,
        fill: neg ? "url(#gpNeg)" : null,
      }));
    });

    // The cumulative curve, split at the sign change so the short-gamma
    // stretch is dashed as well as coloured.
    /* The cumulative curve gets its OWN scale, sharing only the zero rule.
       It was being projected through xOf(), which normalises against the
       largest single BAR — but a running total is the sum of the bars, not
       their maximum, so it routinely exceeds that by an order of magnitude.
       Measured on a realistic 40-strike bell-shaped ladder: peak |cum| was
       12.4x the largest bar, the curve ran to x = 820 on a 560px canvas, and
       only 12 of 40 points landed inside the plot. The root SVG's overflow
       clipping hid the rest, so the curve appeared to shoot right and vanish
       — taking the zero crossing, which is the flip and the flagship reading
       of the whole card, off-screen with it. Worst in the common case of a
       mostly one-signed book, where nearly the entire curve was lost.

       Sharing x0 keeps the crossing exactly on the zero rule, which is the
       one place the two series must agree. */
    const cs = cum.map(f);
    const cMin = Math.min(...cs, 0), cMax = Math.max(...cs, 0);
    const cumRate = Math.min(
      Math.abs(cMin) > 0 ? negW / Math.abs(cMin) : Infinity,
      cMax > 0 ? posW / cMax : Infinity,
    );
    const cRate = Number.isFinite(cumRate) ? cumRate : 0;
    const xOfCum = (v) => x0 + f(v) * cRate;
    const pts = cum.map((c, i) => [xOfCum(c), yOfIndex(i)]);
    for (const sign of [1, -1]) {
      let d = "", open = false;
      cum.forEach((c, i) => {
        const on = sign > 0 ? c >= 0 : c < 0;
        if (on) { d += (open ? "L" : "M") + pts[i][0].toFixed(1) + " " + pts[i][1].toFixed(1) + " "; open = true; }
        else open = false;
      });
      if (d) svg.append(svgEl("path", { class: "gp-cum " + (sign > 0 ? "is-pos" : "is-neg"), d }));
    }

    /* Plates are nudged apart rather than allowed to overlap.
       Spot and the flip are frequently within a percent of each other — which
       is exactly the case a reader most wants to see — and drawing both at
       their true y put the second plate on top of the first, so the card
       showed the SPOT label above the FLIP's distance readout. The LINES stay
       at their true y; only the labels move, and a leader line connects a
       plate back to its rule when it has been displaced. */
    const placedPlates = [];
    const plate = (y, label, value, sub, cls) => {
      const h = sub ? 30 : 18;
      let py = y;
      for (let guard = 0; guard < 8; guard++) {
        const hit = placedPlates.find((q) => Math.abs(q.y - py) < (q.h + h) / 2 + 2);
        if (!hit) break;
        py = hit.y + (py >= hit.y ? 1 : -1) * ((hit.h + h) / 2 + 3);
      }
      py = Math.min(H - padB - h / 2, Math.max(padT + h / 2, py));
      placedPlates.push({ y: py, h });

      const g = svgEl("g", { class: "gp-plate " + (cls || "") });
      if (Math.abs(py - y) > 1) {
        g.append(svgEl("line", { class: "gp-leader", x1: plotR, y1: y, x2: plotR + 6, y2: py }));
      }
      g.append(svgEl("rect", { x: plotR + 6, y: py - h / 2, width: railW - 10, height: h, rx: 2 }));
      const t1 = svgEl("text", { x: plotR + 12, y: sub ? py - 3 : py + 4, class: "gp-plate-k" });
      t1.textContent = label + "  " + value;
      g.append(t1);
      if (sub) {
        const t2 = svgEl("text", { x: plotR + 12, y: py + 10, class: "gp-plate-s" });
        t2.textContent = sub;
        g.append(t2);
      }
      return g;
    };

    /* HOW SHORT, NOT MERELY SHORT. regime.spotGammaShare is the cumulative
       dealer gamma interpolated AT SPOT as a share of the ladder's peak |cum|,
       so it lives in [-1, 1], is unit-free, and is comparable across a $35
       name and a $900 one — its own definition site says so. The card has
       published it on every payload since the field existed and nothing drew
       it: only its SIGN reached the reader, laundered through the "short Γ" /
       "long Γ" badge in the header, so dealers at 0.9 of their peak short
       position at spot and dealers at 0.05 of it rendered identically. Those
       are not the same board. The magnitude belongs on the spot rule, which is
       the one place a reader is already looking when they ask the question. */
    const atSpot = isNum((card.regime || {}).spotGammaShare);
    // Spot claims its plate first: it is the reference every other level is
    // measured against, so it is the one that must sit exactly on its rule.
    if (spot !== null && spot >= lo && spot <= hi) {
      const y = yOfPrice(spot);
      svg.append(svgEl("line", { class: "gp-spot", x1: plotL, x2: plotR, y1: y, y2: y }));
      /* The magnitude only. The SIGN is already carried three times over — the
         header badge, the derived sentence below, and the side of the zero rule
         the curve is on there — and the sub-line has room for about twenty
         monospace characters before it runs off the canvas, where SVG clips it
         silently. */
      svg.append(plate(y, "SPOT", px2(spot),
        atSpot === null ? null : "\u0393 " + Math.abs(atSpot).toFixed(2) + " of peak",
        "is-spot"));
    }

    if (flip !== null && flip >= lo && flip <= hi) {
      const y = yOfPrice(flip);
      svg.append(svgEl("line", { class: "gp-flip", x1: plotL, x2: plotR, y1: y, y2: y }));
      const lv = (card.panels.levels && card.panels.levels.status === "ok"
        ? card.panels.levels.levels.find((l) => l.kind === "gamma_flip") : null);
      svg.append(plate(y, "Γ₀", px2(flip),
        lv ? pct(lv.distPct) + " · " + sigma(lv.distAtr) : null, "is-flip"));
    }

    /* PRICE TICKS. The labels below are earned rather than gridded, which
       keeps the rail readable — but with nothing else on the axis a 225px
       column of 25 strikes carried no price reference between one earned
       label and the next. Unlabelled ticks at a round step restore the ruler
       without adding text. */
    const tickStep = niceStep((hi - lo) / 8);
    if (tickStep > 0) {
      for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi + 1e-9; v += tickStep) {
        const y = yOfPrice(v);
        svg.append(svgEl("line", { class: "gp-ptick", x1: labelW - 4, x2: labelW, y1: y, y2: y }));
      }
    }

    // Price labels are earned, not gridded: spot, flip, and the three biggest
    // strikes by |gamma|, with a de-collision pass.
    const wanted = [];
    if (spot !== null) wanted.push({ p: spot, cls: "is-spot" });
    if (flip !== null) wanted.push({ p: flip, cls: "is-flip" });
    bars.slice().sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 3)
      .forEach((b) => wanted.push({ p: b.k, cls: "" }));
    wanted.push({ p: lo, cls: "" }, { p: hi, cls: "" });
    const placed = [];
    for (const c of wanted) {
      if (isNum(c.p) === null || c.p < lo || c.p > hi) continue;
      const y = yOfPrice(c.p);
      if (placed.some((q) => Math.abs(q - y) < 12)) continue;
      placed.push(y);
      const t = svgEl("text", { class: "gp-price " + c.cls, x: labelW - 8, y: y + 3, "text-anchor": "end" });
      t.textContent = px2(c.p);
      svg.append(t);
      if (placed.length >= 8) break;
    }

    /* The caption sits AT the zero rule it labels rather than at the far left
       of the canvas, where it was 303px away from the thing it described —
       but CLAMPED, because the zero rule floats between 18% and 82% of the
       plot and a centred caption hung off the canvas when it sat near an edge.
       Measured on an emitted card at a 320px viewport: a 166px caption centred
       at x=85 overhung the left edge, and SVG clips silently so the leading
       glyph simply vanished. The half-width is estimated from the string
       rather than measured — SVG offers no pre-layout metric — at roughly
       0.5em per character for this face and size, which errs wide. */
    const axisText = "◀ short   net dealer Γ   long ▶";
    const axisHalf = axisText.length * 0.5 * 9 * 0.5;
    const axisX = Math.min(plotR - axisHalf, Math.max(plotL + axisHalf, x0));
    const axis = svgEl("text", { class: "gp-axis", x: axisX, y: H - 3, "text-anchor": "middle" });
    axis.textContent = axisText;
    svg.append(axis);

    svg.setAttribute("aria-label",
      `Net dealer gamma by strike for ${card.ticker}. ` +
      (spot !== null ? `Spot ${px2(spot)}. ` : "") +
      (flip !== null ? `Gamma flip ${px2(flip)}. ` : "No gamma flip inside the drawn band. ") +
      `${panel.strikes} strikes drawn as ${bars.length} bars.`);

    host.append(svg);

    /* THE SENTENCE IS DERIVED, NOT ASSERTED.

       This used to read "dealers are short gamma below X and long above it" as
       a hardcoded string. Whether that holds is determined by the sign of the
       cumulative on the low side of the crossing the pipeline actually chose,
       and on the live board it was frequently the other way round — the note
       contradicted the header badge on the same card. */
    const regime = card.regime || {};
    /* A CARD FROM BEFORE flipSide WAS MEASURED gets no sentence at all.
       Defaulting an absent flipSide to "short" reproduces the hardcoded string
       this panel used to carry — and that string was wrong often enough to be
       the reason flipSide exists: on the live INTC book the truth is
       long_below. Withholding is the same discipline the score panel applies
       to fam.V and fam.O, and for the same reason: a field whose value cannot
       be verified must not be asserted. */
    const knowsSide = regime.flipSide === "long_below" || regime.flipSide === "short_below";
    const below = regime.flipSide === "long_below" ? "long" : "short";
    const above = below === "long" ? "short" : "long";
    const amplifies = (side) => (side === "short"
      ? "hedging amplifies moves there"
      : "hedging damps them there");

    const note = el("p", "fc-note");
    const band = isNum(regime.bandMin) !== null && isNum(regime.bandMax) !== null
      ? `Measured over strikes ${px2(regime.bandMin)}–${px2(regime.bandMax)} only, so this is net dealer gamma inside that band, not the whole book. `
      : "";
    const sep = isNum(regime.flipSeparation);
    note.textContent =
      (flip !== null && !knowsSide
        ? `The book changes sign at ${px2(flip)}. This card was built before the side of ` +
          `that boundary was measured, so which way round it runs is not stated here — it ` +
          `returns on the next published session. `
        : flip !== null
        ? `Dealers are ${below} gamma immediately below ${px2(flip)} — ${amplifies(below)} — ` +
          `and ${above} immediately above it. ` +
          (sep !== null
            ? `The thinner of the two sides carries ${(sep * 100).toFixed(0)}% of the book's peak ` +
              `exposure, so this is a ${sep < 0.15 ? "weak" : sep < 0.4 ? "moderate" : "strong"} boundary. `
            : "") +
          (isNum(regime.crossings) !== null && regime.crossings > 1
            ? `The book crosses zero ${regime.crossings} times; this is the one separating the most exposure. `
            : "")
        : "Net gamma does not change sign materially inside the drawn band, so no flip level is published here. ") +
      /* THE READING IN WORDS, because a share of a peak is not self-evidently
         a position size. 0 is "spot sits where the running total is zero",
         which is the flip itself; 1 is "spot sits at the most exposed rung the
         ladder measured". Withheld rather than defaulted when spot lies
         outside the measured band — the feature returns null there precisely
         because clamping to the edge rung reported a confident +-1 for a stock
         trading nowhere near the strikes on file. */
      (atSpot !== null
        ? `Dealer gamma AT SPOT is ${Math.abs(atSpot).toFixed(2)} of this ladder's peak ` +
          `exposure and ${atSpot < 0 ? "short" : "long"}, so the regime at spot is ` +
          `${Math.abs(atSpot) >= 0.5 ? "close to as strong as this book gets" : "well inside its range"} ` +
          `— a share, not a dollar figure, which is what makes it comparable across names. `
        : `Where spot sits in the cumulative is not published on this card: spot lies outside ` +
          `the measured strike band, and the edge rung would report a confident extreme for a ` +
          `stock trading nowhere near the strikes on file. `) +
      band +
      `The gamma axis is symlog with decade rules: read magnitude off the labelled powers of ten, not off bar length. ` +
      `The widest bar is ${money(bars.reduce((a, b) => (Math.abs(b.g) > Math.abs(a) ? b.g : a), 0)).replace("$", "")} Γ. ` +
      /* THE CURVE AND THE BARS DO NOT SHARE A SCALE, and sharing the zero rule
         makes them look as though they do. A running total is the SUM of the
         bars, so it routinely exceeds the largest of them by an order of
         magnitude and has to be normalised separately or it leaves the plot —
         measured at 12.4x on a realistic 40-strike ladder. The two agree at
         exactly one place, the zero rule, which is the only place they must:
         it is where the crossing is the flip. Saying so is cheaper than a
         second axis nobody would read, but leaving it unsaid invites a reader
         to compare a curve height against a bar length, which means nothing. */
      `The cumulative curve is normalised separately from the bars — only its ZERO CROSSING is ` +
      `comparable to them, which is the flip. Read the curve for shape, not height. ` +
      `σ is ATR(14).` +
      (panel.bucketed ? ` ${panel.strikes} strikes are aggregated into ${bars.length} bars.` : "");
    host.append(note);
  }

  /* ---------- book displacement -------------------------------------- */

  /**
   * Where today's flow is building gamma, against where the book already is.
   *
   * *_oi is the standing book; *_vol is what traded today. Compared as
   * DISTRIBUTIONS rather than totals — the gap between their gamma centroids,
   * in ATR units. Conventional dealer-gamma reporting describes the regime you
   * are in; this says the regime is moving, and which way.
   *
   * Drawn as a dumbbell because the two centroids are the reading and the gap
   * between them is the signal: two dots on one price axis, with spot marked,
   * so the direction is read off position rather than off a sign.
   */
  function renderDisplacement(host, panel) {
    const question = "Is today's flow building dealer gamma where the book already is, or somewhere else?";
    if (!panel || panel.status !== "ok") return deadPanel(host, question, panel && panel.reason);
    panelHead(host, question);

    const oi = isNum(panel.oiCentroid), vol = isNum(panel.volCentroid), spot = isNum(panel.spot);
    if (oi === null || vol === null) return deadPanel(host, question, "no centroid could be measured");

    const points = [oi, vol, spot].filter((v) => v !== null);
    let lo = Math.min(...points), hi = Math.max(...points);
    // A degenerate range would put every dot on top of the others; open it out
    // so the drawing still reads as "these are the same level".
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.18;
    lo -= pad; hi += pad;

    const W = panelWidth(host), H = 96, padX = 28;
    const xOf = (v) => padX + ((v - lo) / (hi - lo)) * (W - padX * 2);
    const svg = svgEl("svg", {
      class: "bd", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    svg.append(svgEl("line", { class: "bd-axis", x1: padX, x2: W - padX, y1: 52, y2: 52 }));

    if (spot !== null) {
      svg.append(svgEl("line", { class: "bd-spot", x1: xOf(spot), x2: xOf(spot), y1: 30, y2: 62 }));
      const t = svgEl("text", { class: "bd-lab is-spot", x: xOf(spot), y: 24, "text-anchor": "middle" });
      t.textContent = "spot " + px2(spot);
      svg.append(t);
    }

    // The bar between the two centroids IS the displacement.
    svg.append(svgEl("line", {
      class: "bd-gap " + (vol >= oi ? "is-up" : "is-down"),
      x1: xOf(oi), x2: xOf(vol), y1: 52, y2: 52,
    }));
    for (const [v, cls, label] of [[oi, "is-oi", "standing book"], [vol, "is-vol", "today's flow"]]) {
      svg.append(svgEl("circle", { class: "bd-dot " + cls, cx: xOf(v), cy: 52, r: 5 }));
      const t = svgEl("text", { class: "bd-lab " + cls, x: xOf(v), y: 74, "text-anchor": "middle" });
      t.textContent = label + " " + px2(v);
      svg.append(t);
    }

    /* THE NUMBER STAYS IN THE SVG; THE SENTENCE DOES NOT.

       This was one centred <text> carrying the whole reading — "gap −0.76σ —
       new gamma is building BELOW the standing book" — and SVG text cannot
       wrap. Measured at a 320px viewport, where the dialog's inner width is
       288: the sentence drew 334px wide and overhung its own canvas by 23px on
       each side. SVG clipping is silent, so both ends were simply missing and
       the panel looked fine. A quantity is an axis label; a sentence is prose,
       and prose belongs in HTML that reflows. */
    const gapAtr = isNum(panel.gapAtr);
    const cap = svgEl("text", { class: "bd-axis-lab", x: W / 2, y: H - 4, "text-anchor": "middle" });
    cap.textContent = gapAtr === null ? "gap " + px2(panel.gapPx) : "gap " + sigma(gapAtr);
    svg.append(cap);
    const reading = gapAtr === null
      ? "The gap is " + px2(panel.gapPx) + ", with no ATR to state it in, so there is no sigma reading."
      : "New gamma is building " + (vol >= oi ? "ABOVE" : "BELOW") + " the standing book, " +
        sigma(gapAtr) + " away from it.";

    svg.setAttribute("aria-label",
      `The standing gamma book is centred at ${px2(oi)} and today's traded gamma at ${px2(vol)}` +
      (spot !== null ? `, with spot at ${px2(spot)}` : "") +
      (gapAtr === null ? "." : `, a gap of ${gapAtr.toFixed(2)} ATR.`));
    host.append(svg);

    host.append(el("p", "fc-reading", reading));

    host.append(el("p", "fc-note",
      "Open interest is the book that already exists; today's volume is what was " +
      "added to it. Comparing them as DISTRIBUTIONS rather than as totals — the gap " +
      "between their gamma-weighted centroids — is what turns a static regime reading " +
      "into a statement that the regime is moving, and which way. The gap is measured " +
      "in ATR so it compares across names: half a point means one thing in a $9 stock " +
      "and another in a $900 one. This is descriptive; it enters the score through the " +
      "positioning axis, which is the only signed thing the gamma block contributes."));
  }

  /* ---------- gamma roll-off ---------------------------------------- */

  /**
   * The expiry term structure of dealer gamma.
   *
   * Gamma exposure is almost always published as a scalar. It has a term
   * structure, and the term structure is the difference between "it's pinned"
   * and "it's pinned until Friday, and then it isn't". These rows were already
   * being fetched for the score and thrown away at the card boundary.
   */
  /* ---------- the gamma surface: strike x expiry ------------------- */

  /**
   * The heatmap.
   *
   * The profile answers "where is the book long or short" and collapses the
   * term structure to do it. The calendar answers "when does it expire" and
   * collapses the strikes. This draws the joint the two are marginals of,
   * which is where the tradeable statement lives: a put wall that evaporates
   * on Friday and one that runs to January are the same bar on the profile
   * and completely different positions.
   *
   * FOUR ENCODINGS, IN THIS ORDER. Sign by hatch, magnitude by opacity, price
   * by row position, time by column. Hue is LAST and carries nothing the other
   * three do not already carry, so a greyscale print and a deuteranope reader
   * both keep every reading. A diverging red/green heatmap where hue is the
   * only channel is the single most common way this chart is drawn and the
   * single most common way it fails.
   */
  function renderSurface(host, panel, card) {
    const question =
      "Where is dealer gamma concentrated, and when does it expire?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.grid) || !panel.grid.length) {
      return deadPanel(host, question, panel && panel.reason);
    }
    panelHead(host, question);

    const { grid, strikes, expiries, scaleCap, spot, atSpot, callWall, putWall } = panel;
    const W = panelWidth(host);
    const labelW = 46, padT = 30, padB = 34, padR = 8;
    const plotL = labelW;
    const plotW = Math.max(60, W - labelW - padR);
    const colW = plotW / expiries.length;
    /* A cell shorter than 7px is a line, not a cell. The grid is capped at 21
       strikes upstream so this stays inside a sensible panel height. */
    const rowH = Math.max(7, Math.min(18, 320 / strikes.length));
    const H = padT + strikes.length * rowH + padB;

    const svg = svgEl("svg", {
      class: "gs", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    /* The hatch that carries SIGN independently of hue, at the centre of its
       tile for the reason the profile's pattern documents: a stroke on the
       tile edge is half clipped by patternUnits and renders at a fraction of
       its intended weight. */
    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: "gsNeg", width: 5, height: 5, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "gs-negpat",
    });
    pat.append(svgEl("line", { x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: "currentColor", "stroke-width": 1.6 }));
    defs.append(pat);
    svg.append(defs);

    // Rows run high price at the top, the way a price ladder is read.
    const yOfRow = (i) => padT + (strikes.length - 1 - i) * rowH;

    strikes.forEach((k, i) => {
      const y = yOfRow(i);
      expiries.forEach((e, j) => {
        const v = grid[i][j];
        const x = plotL + j * colW;
        if (v === null) {
          /* NOT MEASURED is drawn as an explicit void, not as a zero-intensity
             cell. A pair the vendor never returned and a pair carrying no
             gamma are different facts and only one of them is tradeable. */
          svg.append(svgEl("rect", {
            class: "gs-void", x, y, width: Math.max(1, colW - 1), height: Math.max(1, rowH - 1),
          }));
          return;
        }
        const mag = scaleCap > 0 ? Math.min(1, Math.abs(v) / scaleCap) : 0;
        const neg = v < 0;
        const cell = svgEl("rect", {
          class: "gs-cell " + (neg ? "is-neg" : "is-pos"),
          x, y, width: Math.max(1, colW - 1), height: Math.max(1, rowH - 1),
          /* A floor on opacity so a small-but-real cell is still visible as a
             cell; zero opacity and "no data" must not look alike. */
          "fill-opacity": (0.12 + 0.88 * mag).toFixed(3),
        });
        svg.append(cell);
        if (neg && rowH >= 9 && colW >= 9) {
          svg.append(svgEl("rect", {
            class: "gs-hatch", x, y, width: Math.max(1, colW - 1), height: Math.max(1, rowH - 1),
            fill: "url(#gsNeg)",
          }));
        }
        /* Cells beyond the cap are marked rather than silently flattened
           against everything else at full saturation. */
        if (Math.abs(v) > scaleCap) {
          svg.append(svgEl("line", {
            class: "gs-clip", x1: x + 1, y1: y + 1,
            x2: x + Math.max(1, colW - 2), y2: y + Math.max(1, rowH - 2),
          }));
        }
      });
    });

    /* PRICE LABELS ARE EARNED. Every strike labelled at 7px rows is a wall of
       digits; spot, both walls and the two ends always get one, and the rest
       are filled in at whatever stride leaves them legible. */
    const mustLabel = new Set([0, strikes.length - 1]);
    const idxOf = (price) => {
      if (price === null || price === undefined) return -1;
      let best = -1, d = Infinity;
      strikes.forEach((k, i) => { const dd = Math.abs(k - price); if (dd < d) { d = dd; best = i; } });
      return best;
    };
    const spotRow = idxOf(atSpot);
    if (spotRow >= 0) mustLabel.add(spotRow);
    const callRow = callWall ? idxOf(callWall.strike) : -1;
    const putRow = putWall ? idxOf(putWall.strike) : -1;
    if (callRow >= 0) mustLabel.add(callRow);
    if (putRow >= 0) mustLabel.add(putRow);

    const stride = Math.max(1, Math.ceil(13 / rowH));
    strikes.forEach((k, i) => {
      if (!mustLabel.has(i) && i % stride !== 0) return;
      const y = yOfRow(i) + rowH / 2 + 3;
      // Never let an earned label collide with a guaranteed one.
      if (!mustLabel.has(i) && [...mustLabel].some((m) => Math.abs(m - i) * rowH < 12)) return;
      const t = svgEl("text", {
        class: "gs-price" + (i === spotRow ? " is-spot" : ""),
        x: labelW - 6, y, "text-anchor": "end",
      });
      t.textContent = px2(k);
      svg.append(t);
    });

    /* EXPIRY LABELS. Month-day only; the year is the same across an eight-week
       horizon and repeating it four times costs the width the labels need. */
    expiries.forEach((e, j) => {
      const x = plotL + j * colW + colW / 2;
      const t = svgEl("text", { class: "gs-exp", x, y: padT - 10, "text-anchor": "middle" });
      t.textContent = String(e).slice(5);
      svg.append(t);
      if (j > 0) {
        svg.append(svgEl("line", {
          class: "gs-colrule", x1: plotL + j * colW - 0.5, x2: plotL + j * colW - 0.5,
          y1: padT, y2: padT + strikes.length * rowH,
        }));
      }
    });

    /* MARKER RULES. Spot is a line across the grid at its TRUE price rather
       than snapped to a row centre: the nearest strike and spot are different
       numbers and the panel is read for exactly that gap. */
    const lo = strikes[0], hi = strikes[strikes.length - 1];
    const s = isNum(spot);
    if (s !== null && strikes.length > 1 && s >= lo && s <= hi) {
      const t = (s - lo) / (hi - lo);
      const y = padT + (1 - t) * (strikes.length - 1) * rowH + rowH / 2;
      svg.append(svgEl("line", { class: "gs-spot", x1: plotL, x2: plotL + plotW, y1: y, y2: y }));
    }
    const markRow = (rowIndex, cls) => {
      if (rowIndex < 0) return;
      const y = yOfRow(rowIndex);
      svg.append(svgEl("rect", {
        class: cls, x: plotL, y, width: plotW, height: Math.max(1, rowH - 1),
      }));
    };
    markRow(callRow, "gs-callwall");
    markRow(putRow, "gs-putwall");

    host.append(svg);

    /* THE LEGEND SAYS WHAT THE PICTURE CANNOT. Which row is spot, which are
       the walls, that the scale is capped, and how much of the book is on
       screen — a surface showing 8 of 40 expiries is a window, and a window
       that does not say so reads as the whole book. */
    const pairs = [];
    if (s !== null) pairs.push(["Spot", px2(s)]);
    if (callWall) pairs.push(["Call wall", px2(callWall.strike)]);
    if (putWall) pairs.push(["Put wall", px2(putWall.strike)]);
    const regime = card && card.regime && card.regime.label;
    if (regime) pairs.push(["Regime", String(regime).replace(/_/g, " ")]);
    host.append(statList(pairs));

    const notes = [];
    notes.push("Colour is capped at " + compact(scaleCap) +
      (panel.clipped > 0
        ? "; " + (panel.clipped === 1
          ? "one cell runs past it (peak " + compact(panel.peak) + ") and is marked"
          : panel.clipped + " cells run past it (peak " + compact(panel.peak) + ") and are marked") +
          " with a slash"
        : ""));
    /* Only the dimension that is actually windowed is mentioned. "Showing 6 of
       6 expiries" is noise that trains a reader to skip the sentence, and the
       sentence exists so that "8 of 40" is not skipped. */
    const windowed = [];
    if (panel.expiriesShown < panel.expiriesTotal) {
      windowed.push(panel.expiriesShown + " of " + panel.expiriesTotal + " expiries");
    }
    if (panel.strikesShown < panel.strikesTotal) {
      windowed.push(panel.strikesShown + " of " + panel.strikesTotal + " strikes");
    }
    if (windowed.length) notes.push("Showing " + windowed.join(" and "));
    notes.push("Short-gamma cells are hatched as well as coloured; blank cells are strikes " +
      "the vendor returned no gamma for, which is not the same as none");
    host.append(el("p", "fc-note", notes.join(". ") + "."));
  }

  function renderCalendar(host, panel) {
    const question = "When does this dealer positioning expire, and what is left after it does?";
    if (!panel || panel.status !== "ok" || !panel.schedule || !panel.schedule.length) {
      return deadPanel(host, question, panel && panel.reason);
    }
    panelHead(host, question);

    const rows = panel.schedule;
    /* padL fits the widest label the rail can hold: "2026-09-04  11d" is
       fifteen monospace characters at 10.5px, about 95 units, and it is drawn
       text-anchor:end from padL - 8. At padL = 96 that started at x = -7 and
       the SVG clipped it — invisibly, because clipping is silent. */
    const W = panelWidth(host), ROW = 26, padL = 116, padR = 56, padT = 8;
    const H = padT + rows.length * ROW + 26;
    const plotW = W - padL - padR;
    const svg = svgEl("svg", {
      class: "gc", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    // The staircase: cumulative share, so the reader sees the book drain.
    let prevX = padL;
    rows.forEach((r, i) => {
      const y = padT + i * ROW;
      const xEnd = padL + plotW * Math.min(1, r.cumShare);
      svg.append(svgEl("rect", {
        class: "gc-cum", x: padL, y: y + 4, width: Math.max(1, xEnd - padL), height: ROW - 10, rx: 1,
      }));
      svg.append(svgEl("rect", {
        class: "gc-step", x: prevX, y: y + 4, width: Math.max(1.5, xEnd - prevX), height: ROW - 10, rx: 1,
      }));
      prevX = xEnd;

      const lab = svgEl("text", { class: "gc-exp", x: padL - 8, y: y + ROW / 2 + 3, "text-anchor": "end" });
      lab.textContent = r.expiry + (isNum(r.days) !== null ? "  " + r.days + "d" : "");
      svg.append(lab);

      const val = svgEl("text", { class: "gc-share", x: W - padR + 6, y: y + ROW / 2 + 3 });
      val.textContent = (r.share * 100).toFixed(0) + "%";
      svg.append(val);
    });

    // The half-life rule, where cumulative roll-off passes 50%.
    const halfX = padL + plotW * 0.5;
    svg.append(svgEl("line", { class: "gc-half", x1: halfX, x2: halfX, y1: padT, y2: H - 22 }));
    const ht = svgEl("text", { class: "gc-axis", x: halfX, y: H - 8, "text-anchor": "middle" });
    ht.textContent = "half the book";
    svg.append(ht);

    svg.setAttribute("aria-label",
      `Gamma roll-off by expiry. ` + rows.map((r) =>
        `${r.expiry}: ${(r.share * 100).toFixed(0)} percent`).join(", ") + ".");
    host.append(svg);

    host.append(statList([
      ["Front expiry", rows[0].expiry],
      ["Front share", (rows[0].share * 100).toFixed(0) + "%"],
      ["Half-life", panel.halfLifeExpiry || DASH],
      ["Mean life", isNum(panel.meanLifeDays) === null ? DASH : panel.meanLifeDays.toFixed(0) + " days"],
      ["Expiries", String(panel.expiries)],
    ]));

    host.append(el("p", "fc-note",
      "Gross gamma rolling off, so the two legs are summed in magnitude: put gamma " +
      "arrives already dealer-signed, and a front week of one billion call against " +
      "minus 999 million put is two billion of gamma about to expire, not the one " +
      "million their signed sum leaves behind. " +
      "Mean life is the gamma-weighted average days to expiry — unlike the front " +
      "expiry's share it does not change when the chain is cut differently, so it " +
      "is the number that compares across names."));
  }

  /* ---------- the priced move ---------------------------------------- */

  /**
   * WHAT THE OPTION MARKET PRICES OVER A FIXED HORIZON, against what the stock
   * has been delivering over the same one.
   *
   * This is a PRICE, not a prediction, and the panel is built so it cannot be
   * read as one: no point target, no direction, no probability.
   *
   * TWO BANDS, and only the fixed-horizon one is a cross-section. The vendor's
   * own implied_move_perc is quoted to each name's NEXT LISTED EXPIRY, so it is
   * a different horizon for every name — measured on this board, one name quoted
   * 7.1% to an expiry four days out while its ten-session move was 13.0%. Two
   * such numbers side by side on a board are not comparable, so the headline
   * band scales 30-day implied volatility to a stated number of trading
   * sessions, which is the same horizon for everyone. The vendor's quote is
   * still drawn, marked with its own expiry, because it is a real quote.
   *
   * The gap between the implied band and the realized band IS the variance risk
   * premium, in the units a reader sizes in rather than in vol points.
   */
  function renderMove(host, panel) {
    const question =
      "What move is priced over a fixed horizon, and is that band rich against " +
      "what this stock has actually been delivering?";
    if (!panel || panel.status !== "ok") return deadPanel(host, question, panel && panel.reason);
    panelHead(host, question);

    const spot = isNum(panel.spot);
    const imp = isNum(panel.impliedMove);
    const real = isNum(panel.realizedMove);
    const quoted = isNum(panel.movePerc);
    const sessions = isNum(panel.sessions) ?? 10;

    // The widest band sets the scale; everything else is drawn against it, so
    // the implied and realized bands are directly comparable by ink.
    const widest = Math.max(imp ?? 0, real ?? 0, quoted ?? 0);
    if (!(widest > 0) || spot === null) {
      return deadPanel(host, question, "no band could be measured");
    }

    const W = panelWidth(host), H = 118, padX = 16;
    const plotW = W - padX * 2;
    const mid = padX + plotW / 2;
    // 0.44 rather than 0.5 leaves room for the price labels at each extreme.
    const halfOf = (m) => (m / widest) * (plotW * 0.44);

    const svg = svgEl("svg", {
      class: "pm", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    if (imp !== null) {
      const h = halfOf(imp);
      svg.append(svgEl("rect", { class: "pm-band is-implied", x: mid - h, y: 34, width: h * 2, height: 30, rx: 3 }));
      for (const [x, txt] of [[mid - h, px2(panel.impliedLow)], [mid + h, px2(panel.impliedHigh)]]) {
        const t = svgEl("text", { class: "pm-lab", x, y: 26, "text-anchor": "middle" });
        t.textContent = txt;
        svg.append(t);
      }
    }

    /* The realized band is drawn INSIDE the implied one. The visible gap is the
       variance risk premium; when the realized band overflows the implied one,
       the premium is negative and the reader sees that directly. */
    if (real !== null) {
      const h = halfOf(real);
      svg.append(svgEl("rect", { class: "pm-band is-realized", x: mid - h, y: 41, width: h * 2, height: 16, rx: 2 }));
    }

    // The vendor's own quote, as a reference pair rather than a band, because
    // its horizon is not this panel's horizon — and is not datable from
    // anything this pipeline sees, so it is labelled by the rule the vendor
    // states rather than by a date.
    if (quoted !== null && panel.horizonRule) {
      const h = halfOf(quoted);
      for (const x of [mid - h, mid + h]) {
        svg.append(svgEl("line", { class: "pm-quote", x1: x, x2: x, y1: 30, y2: 68 }));
      }
      /* Anchored to the plot's right edge rather than to the tick it labels.
         halfOf() caps a band at 44% of the plot, so a tick can sit at x = 528
         on a 560-unit canvas and a label starting there runs clean off the
         viewBox — silently, because the SVG clips it. */
      const t = svgEl("text", { class: "pm-quotelab", x: W - padX, y: 78, "text-anchor": "end" });
      t.textContent = "vendor quote, to " + panel.horizonRule;
      svg.append(t);
    }

    svg.append(svgEl("line", { class: "pm-spot", x1: mid, x2: mid, y1: 28, y2: 70 }));
    const st = svgEl("text", { class: "pm-lab is-spot", x: mid, y: 26, "text-anchor": "middle" });
    st.textContent = px2(spot);
    svg.append(st);

    const cap = svgEl("text", { class: "pm-axis", x: mid, y: H - 8, "text-anchor": "middle" });
    cap.textContent = imp !== null
      ? `±${(imp * 100).toFixed(1)}% priced over ${sessions} sessions` +
        (real !== null ? `  ·  ±${(real * 100).toFixed(1)}% delivered` : "")
      : `±${(quoted * 100).toFixed(1)}% quoted to ${panel.horizonRule || "the vendor's own expiry"}`;
    svg.append(cap);

    svg.setAttribute("aria-label",
      (imp !== null
        ? `Over ${sessions} trading sessions the option market prices a move of plus or ` +
          `minus ${(imp * 100).toFixed(1)} percent, a band from ${px2(panel.impliedLow)} to ` +
          `${px2(panel.impliedHigh)}. `
        : "") +
      (real !== null
        ? `This stock has delivered plus or minus ${(real * 100).toFixed(1)} percent over the ` +
          `same horizon. `
        : "") +
      (quoted !== null && panel.horizonRule
        ? `The vendor separately quotes plus or minus ${(quoted * 100).toFixed(1)} percent to ` +
          `${panel.horizonRule}, a different horizon.`
        : ""));
    host.append(svg);

    host.append(statList([
      ["Implied 30d vol", vol1(panel.iv30)],
      // 21 sessions, which is the usual count in the 30 CALENDAR days the
      // implied leg is quoted over. Labelled by what was measured.
      ["Realized vol, 21 sessions", vol1(panel.rv30)],
      ["Variance risk premium",
        isNum(panel.vrp) === null ? DASH : signed(panel.vrp, (a) => (a * 100).toFixed(1) + " vol pts")],
      ["Band", panel.richness === null ? DASH : panel.richness],
      ["IV rank", isNum(panel.ivRank) === null ? DASH : Math.round(panel.ivRank * 100) + "% of its year"],
      ["IV, past week", isNum(panel.ivMomentum) === null ? DASH
        : signed(panel.ivMomentum, (a) => (a * 100).toFixed(1) + " vol pts")],
    ]));

    host.append(el("p", "fc-note",
      `THIS IS A PRICE, NOT A FORECAST. The wide band is 30-day implied volatility ` +
      `scaled to ${sessions} trading sessions by the square-root-of-time rule, which ` +
      `is exact whenever successive returns are uncorrelated — no fitted parameter, ` +
      `every input observable, and an assumption the term structure of implied ` +
      `volatility openly disagrees with. The inner band is the ` +
      `volatility this stock has actually delivered over its last 21 sessions — the usual ` +
      `count in the thirty CALENDAR days the implied leg is quoted over — scaled ` +
      `the same way, so the gap between them is the variance risk premium in price ` +
      `units. The vendor's own quote is marked separately because it is priced to the ` +
      `nearest end-of-week expiry — the vendor's documented default when no expiry is ` +
      `supplied, and the screener accepts none — which is a different horizon from this ` +
      `panel's and not comparable across the board. ` +
      `NOT CLAIMED: a direction, a probability, a point target, or that the stock will ` +
      `stay inside any of these bands.`));
  }

  /* ---------- price context ------------------------------------------ */

  function renderContext(host, panel) {
    const question = "Where has this name been, before any of today's flow?";
    if (!panel || panel.status !== "ok") return deadPanel(host, question, panel && panel.reason);
    panelHead(host, question);

    const closes = Array.isArray(panel.closes) ? panel.closes : [];
    if (closes.length >= 2) {
      const W = panelWidth(host), H = 76, pad = 4;
      let lo = Infinity, hi = -Infinity;
      for (const c of closes) { if (c < lo) lo = c; if (c > hi) hi = c; }
      const span = hi - lo || 1;
      const xOf = (i) => pad + (i / (closes.length - 1)) * (W - pad * 2);
      const yOf = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);
      const svg = svgEl("svg", {
        class: "px", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
        role: "img", preserveAspectRatio: "none",
      });
      // A baseline at the window's first close, so the line's position against
      // it IS the window return — no axis labels needed.
      svg.append(svgEl("line", { class: "px-base", x1: pad, x2: W - pad, y1: yOf(closes[0]), y2: yOf(closes[0]) }));
      const d = closes.map((c, i) => (i ? "L" : "M") + xOf(i).toFixed(1) + " " + yOf(c).toFixed(1)).join(" ");
      const up = closes[closes.length - 1] >= closes[0];
      svg.append(svgEl("path", { class: "px-line " + (up ? "is-pos" : "is-neg"), d }));
      svg.append(svgEl("circle", {
        class: "px-dot " + (up ? "is-pos" : "is-neg"),
        cx: xOf(closes.length - 1), cy: yOf(closes[closes.length - 1]), r: 2.5,
      }));
      svg.setAttribute("aria-label",
        `${closes.length} daily closes, from ${px2(closes[0])} to ${px2(closes[closes.length - 1])}.`);
      host.append(svg);
    }

    host.append(statList([
      ["Today", pct(panel.changePct)],
      ["5 sessions", pct1(panel.r5)],
      ["21 sessions", pct1(panel.r21)],
      ["42 sessions", pct1(panel.r42)],
      ["52-week position",
        isNum(panel.week52Pos) === null ? DASH : Math.round(panel.week52Pos * 100) + "% of range"],
    ]));

    host.append(el("p", "fc-note",
      "Simple close-to-close returns over the trailing window, and where the last " +
      "close sits between the 52-week low and high. Descriptive only: none of it " +
      "enters the score, and past returns over these horizons carry no forecast " +
      "this system is willing to make."));
  }

  /* ---------- level rail ------------------------------------------- */

  function renderLevels(host, panel) {
    const question = "Where are the levels that matter, and how far is each in units I can size against?";
    if (!panel || panel.status !== "ok") return deadPanel(host, question, panel && panel.reason);
    panelHead(host, question);

    const table = el("table", "fc-levels");
    const thead = el("thead");
    const hr = el("tr");
    for (const [t, cls] of [["Level", ""], ["Price", "c-num"], ["Distance", "c-num"], ["ATR", "c-num"]]) {
      const th = el("th", cls, t); th.scope = "col"; hr.append(th);
    }
    thead.append(hr); table.append(thead);

    const tb = el("tbody");
    for (const l of panel.levels) {
      const tr = el("tr");
      tr.append(el("td", null, l.label));
      tr.append(el("td", "c-num", px2(l.px)));
      const d = el("td", "c-num", pct(l.distPct));
      // Distance carries a direction: above spot or below it. That is a fact
      // about geometry, not a bullish or bearish opinion, so it is not
      // coloured with the directional palette.
      d.classList.add(l.distPct >= 0 ? "is-above" : "is-below");
      tr.append(d);
      tr.append(el("td", "c-num", sigma(l.distAtr)));
      tb.append(tr);
    }
    table.append(tb);
    // The table gets its own scroll container so the DIALOG never scrolls
    // sideways: at 320px a horizontally scrolling dialog takes the header and
    // the close button off-screen with it.
    const wrap = el("div", "fc-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Key levels");
    wrap.append(table);
    host.append(wrap);

    const note = el("p", "fc-note");
    note.textContent = isNum(panel.atr) === null
      ? "ATR(14) was unavailable, so sigma distances are not shown — a distance in sigma units with no sigma is no number, not a small one."
      : `Distances are from spot ${px2(panel.spot)}. σ is ATR(14) = ${px2(panel.atr)}, which is what makes a move comparable between a quiet name and a volatile one.`;
    host.append(note);
  }

  /* ---------- session path ------------------------------------------ */

  /**
   * THE PANEL DRAWS BOTH SERIES, ON TWO SCALES THAT SHARE ONLY THEIR ZERO.
   *
   * buildPath has always emitted `series` as [cumulative net delta,
   * cumulative net premium] PAIRS, and this renderer read `p[0]` and dropped
   * the second half of every row: ~78 premium points shipped on every card,
   * paid for in ingest bytes, and never once drawn. The same shape as the
   * `vol` block that no renderer read, and as assignedReturn on the desk rows.
   *
   * The premium leg is worth its ink because DELTA AND PREMIUM DIVERGING
   * INTRADAY IS THE SPREAD-VERSUS-DIRECTIONAL TELL: money that moves premium
   * without moving net delta is being spent on structure — verticals, calendars,
   * anything with two legs — rather than on a direction. A reader with only the
   * delta curve cannot see that, and the two end-of-day totals below the chart
   * cannot show WHEN it happened.
   *
   * TWO SCALES, STATED, BECAUSE THE UNITS ARE NOT COMMENSURABLE. One leg is
   * contracts of delta, the other is dollars. Plotting them against one shared
   * axis would let a reader compare their heights, which means nothing at all —
   * the identical mistake the gamma panel's note apologises for between its
   * bars and its cumulative curve. Each leg is normalised by its OWN largest
   * absolute value, and the two share exactly one thing: the zero rule, which
   * is the one place they must agree, because zero means "nothing net" in both
   * units. Both normalisations are printed under the chart.
   *
   * IDENTITY WITHOUT HUE. Delta is a solid stroke ending in a filled disc;
   * premium is dashed and ends in a hollow square; the legend swatches are
   * drawn with the same strokes rather than described in words. The gamma
   * surface hatches its short-gamma cells for this reason and says why —
   * colour is the LAST channel here, not the first — and this panel had been
   * relying on hue alone to distinguish a positive run from a negative one.
   *
   * The stroke styling is set as PRESENTATION ATTRIBUTES rather than left to
   * the stylesheet. A path with no CSS defaults to fill:black, stroke:none —
   * a solid blob, not a line — so a renderer that ships before its rules do
   * would draw something actively wrong rather than something plain. Any CSS
   * rule of the same name still wins over an attribute.
   */
  function renderPath(host, panel) {
    const question = "Did this arrive as one print, or as a bid that persisted all session?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.series) || panel.series.length < 2) {
      return deadPanel(host, question, panel && panel.reason);
    }
    panelHead(host, question);

    /* A row is a PAIR. A card old enough to carry bare numbers instead is read
       as delta-only rather than crashing on `undefined[1]` — published cards
       outlive the code that reads them. */
    const rows = panel.series.map((r) => (Array.isArray(r) ? r : [r, null]));
    const delta = rows.map((r) => isNum(r[0]));
    const prem = rows.map((r) => isNum(r[1]));
    if (delta.filter((v) => v !== null).length < 2) {
      return deadPanel(host, question, "the tape carried no usable cumulative delta");
    }

    /* WHY A ZERO PREMIUM SERIES IS NOT DRAWN. A flat line along the axis is
       indistinguishable from a measured series that happened to end where it
       began, so it reads as a finding. Absence is stated in words instead —
       the same rule that keeps a missing ATR from drawing a zero-width band. */
    const premMeasured = prem.filter((v) => v !== null);
    const premPublished = premMeasured.length >= 2;
    const premMoved = premMeasured.some((v) => v !== 0);
    const drawPrem = premPublished && premMoved;

    const W = Math.max(280, Math.min(760, host.clientWidth || 560));
    const H = 132, pad = 10;
    const x = (i) => pad + (i / (rows.length - 1)) * (W - 2 * pad);

    // Each leg normalised by its own largest |value|, so each lands in [-1, 1]
    // with zero fixed at zero — which is what makes one shared zero rule
    // honest while the magnitudes stay separately scaled.
    const scaleOf = (vals) => Math.max(...vals.filter((v) => v !== null).map(Math.abs), 0);
    const dScale = scaleOf(delta);
    const pScale = drawPrem ? scaleOf(prem) : 0;
    const unit = (v, s) => (v === null || !(s > 0) ? null : v / s);
    const dU = delta.map((v) => unit(v, dScale));
    const pU = drawPrem ? prem.map((v) => unit(v, pScale)) : [];
    const all = dU.concat(pU).filter((v) => v !== null);
    const uLo = Math.min(0, ...all), uHi = Math.max(0, ...all);
    const uSpan = uHi - uLo || 1;
    const y = (u) => pad + (1 - (u - uLo) / uSpan) * (H - 2 * pad);

    const svg = svgEl("svg", {
      class: "fp", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img",
    });
    svg.append(svgEl("line", { class: "fp-zero", x1: pad, x2: W - pad, y1: y(0), y2: y(0),
      stroke: "currentColor", "stroke-opacity": 0.35, "stroke-dasharray": "3 3" }));

    // A break in the series is a break in the line, not a segment drawn
    // through a value nobody measured.
    const dOf = (us) => {
      let d = "", open = false;
      us.forEach((u, i) => {
        if (u === null) { open = false; return; }
        d += (open ? "L" : "M") + x(i).toFixed(1) + " " + y(u).toFixed(1) + " ";
        open = true;
      });
      return d.trim();
    };
    const lastOf = (us) => { for (let i = us.length - 1; i >= 0; i--) if (us[i] !== null) return i; return -1; };

    if (drawPrem) {
      // Drawn UNDER the delta line: delta is the panel's subject, premium its
      // context, and the one that ends up on top is the one that reads as the
      // measurement when they cross.
      svg.append(svgEl("path", {
        class: "fp-prem", d: dOf(pU), fill: "none", stroke: "currentColor",
        "stroke-opacity": 0.75, "stroke-width": 1.4, "stroke-dasharray": "5 3",
        "stroke-linejoin": "round",
      }));
      const li = lastOf(pU);
      if (li >= 0) {
        svg.append(svgEl("rect", {
          class: "fp-prem-end", x: x(li) - 3, y: y(pU[li]) - 3, width: 6, height: 6,
          fill: "none", stroke: "currentColor", "stroke-width": 1.4,
        }));
      }
    }

    const dLast = lastOf(dU);
    svg.append(svgEl("path", {
      class: "fp-line " + (delta[dLast] >= 0 ? "is-pos" : "is-neg"), d: dOf(dU),
      fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linejoin": "round",
    }));
    if (dLast >= 0) {
      svg.append(svgEl("circle", {
        class: "fp-line-end " + (delta[dLast] >= 0 ? "is-pos" : "is-neg"),
        cx: x(dLast), cy: y(dU[dLast]), r: 2.6, fill: "currentColor",
      }));
    }

    /* THE CENTROID IS A TIME, so it is drawn on the time axis rather than
       printed only as a percentage. It is the movement-weighted mean minute of
       the session: a rule near the left edge with a curve that ends high says
       the work was done early and the tape merely held; a rule near the right
       edge under the same curve is a late arrival. */
    const centroid = isNum(panel.centroid);
    if (centroid !== null) {
      const cx = Number((pad + Math.min(1, Math.max(0, centroid)) * (W - 2 * pad)).toFixed(1));
      svg.append(svgEl("line", {
        class: "fp-centroid", x1: cx, x2: cx, y1: pad, y2: H - pad,
        stroke: "currentColor", "stroke-opacity": 0.5, "stroke-width": 1,
        "stroke-dasharray": "1 3",
      }));
    }

    svg.setAttribute("aria-label",
      `Cumulative net delta across the session, ending at ${compact(panel.netDelta)}` +
      (drawPrem ? `, and cumulative net premium ending at ${money(panel.netPremium)}, ` +
        `drawn on its own scale and sharing only the zero rule` : "") +
      (centroid !== null ? `. Movement-weighted mean minute at ${Math.round(centroid * 100)}% of the session` : "") +
      ".");
    host.append(svg);

    /* THE LEGEND CARRIES THE STROKES THEMSELVES, not a colour word. A reader
       who cannot separate the two hues — or who printed the card — matches the
       dash pattern instead, and the scale each leg was normalised by is stated
       beside it rather than left as an axis nobody would read. */
    /* A PARAGRAPH RATHER THAN A LIST, because nothing in this stylesheet
       resets list markers: a <ul> with no rules of its own renders as bulleted,
       indented text, and a legend that has to wait for a stylesheet to stop
       looking broken is a legend that ships broken. A note-classed paragraph
       is already styled and already wraps. */
    const legend = el("p", "fc-note fp-legend");
    const key = (draw, text) => {
      const span = el("span", "fp-key");
      const sw = svgEl("svg", { class: "fp-swatch", width: 26, height: 10,
        viewBox: "0 0 26 10", "aria-hidden": "true" });
      draw(sw);
      span.append(sw);
      span.append(el("span", "fp-key-t", text));
      return span;
    };
    legend.append(key((sw) => {
      sw.append(svgEl("line", { x1: 1, y1: 5, x2: 20, y2: 5, stroke: "currentColor",
        "stroke-width": 1.8 }));
      sw.append(svgEl("circle", { cx: 22, cy: 5, r: 2.6, fill: "currentColor" }));
    }, `Net delta — solid; \u00b1${compact(dScale)} contracts at full deflection. `));
    if (drawPrem) {
      legend.append(key((sw) => {
        sw.append(svgEl("line", { x1: 1, y1: 5, x2: 18, y2: 5, stroke: "currentColor",
          "stroke-width": 1.4, "stroke-dasharray": "5 3", "stroke-opacity": 0.75 }));
        sw.append(svgEl("rect", { x: 20, y: 2, width: 6, height: 6, fill: "none",
          stroke: "currentColor", "stroke-width": 1.4 }));
      }, `Net premium — dashed; \u00b1${money(pScale)} at full deflection. `));
    }
    if (centroid !== null) {
      legend.append(key((sw) => {
        sw.append(svgEl("line", { x1: 10, y1: 0, x2: 10, y2: 10, stroke: "currentColor",
          "stroke-width": 1, "stroke-dasharray": "1 3", "stroke-opacity": 0.5 }));
      }, "Movement-weighted mean minute."));
    }
    host.append(legend);

    /* THE THREE PATH NUMBERS, which are the whole of family D and which this
       panel could not state until they were published. A card built before
       they were is shown an em dash and told so below; it is never shown a
       zero, because 0 persistence and a 0.5 centroid are both real and
       unusual readings. */
    const hasSig = panel && "persistence" in panel;
    const persistence = isNum(panel.persistence);
    const concentration = isNum(panel.concentration);
    const share = (v) => (v === null ? DASH : Math.round(v * 100) + "%");
    host.append(statList([
      ["Net delta", compact(panel.netDelta)],
      ["Net premium", money(panel.netPremium)],
      ["Minutes on tape", String(panel.minutes)],
      ["Minutes with the direction", share(persistence)],
      ["Busiest 5% of minutes", share(concentration)],
      ["Weighted mean minute", share(centroid)],
    ]));

    /* THE READING, not the method: what the three numbers say about this
       session, each against the baseline its own definition supplies. Nothing
       here is thresholded into an adjective — the baselines are 50% for a
       directionless tape and 5% for a uniform one, both of which come from the
       estimators themselves and neither of which is a parameter anybody chose. */
    if (persistence !== null || concentration !== null || centroid !== null) {
      const reading = el("p", "fc-reading");
      reading.textContent =
        (persistence !== null
          ? `${Math.round(persistence * 100)}% of minutes moved with the day's net direction, ` +
            `against 50% for a tape with no direction at all. `
          : "") +
        (concentration !== null
          ? `The busiest 5% of minutes carried ${Math.round(concentration * 100)}% of the movement — ` +
            `${(concentration / 0.05).toFixed(1)}× what a uniform session would put there. `
          : "") +
        (centroid !== null
          ? `The movement-weighted mean minute sits at ${Math.round(centroid * 100)}% of the session.`
          : "");
      host.append(reading);
    }

    const note = el("p", "fc-note");
    note.textContent =
      "The curve is the running total, so its shape is the accumulation: a straight " +
      "climb is a worked order, a single step is one print. Net premium is call buying " +
      "minus put buying — positive put premium is put BUYING, which is bearish. " +
      (drawPrem
        ? "The two legs are in DIFFERENT UNITS — contracts of delta against dollars — so " +
          "each is normalised by its own largest reading and they share only the zero rule. " +
          "Compare their SHAPES, never their heights: premium moving while delta does not is " +
          "money spent on structure rather than on a direction. "
        : premPublished
        ? "The premium leg is not drawn: the tape recorded no net premium in either direction " +
          "this session, and a flat line along the axis would read as a measurement rather " +
          "than as an absence. "
        : "The premium leg is not drawn: this card was built before the premium series was " +
          "published, and it returns on the next published session. ") +
      (hasSig
        ? "Persistence counts minutes, not size, so a steady worked order and one spike can " +
          "share an end-of-day total and separate here."
        : "This card was built before the path signature was published, so persistence, " +
          "concentration and the weighted mean minute are shown as unmeasured rather than " +
          "as zeros — a zero concentration is the flattest session possible and a 0.5 " +
          "centroid is a real reading. They return on the next published session.");
    host.append(note);
  }

  /* ---------- congress ---------------------------------------------- */

  function renderCongress(host, panel) {
    const question = "Who in Congress disclosed a trade in this name, and how old is that information?";
    if (!panel || panel.status !== "ok") return deadPanel(host, question, panel && panel.reason);
    panelHead(host, question);

    const table = el("table", "fc-congress");
    const thead = el("thead");
    const hr = el("tr");
    for (const [t, cls] of [["Member", ""], ["Side", ""], ["Traded", "c-num"],
                            ["Disclosed after", "c-num"], ["Amount", "c-num"]]) {
      const th = el("th", cls, t); th.scope = "col"; hr.append(th);
    }
    thead.append(hr); table.append(thead);

    const tb = el("tbody");
    for (const t of panel.trades) {
      const tr = el("tr");
      const who = el("td");
      who.append(el("span", "fc-member", t.member || DASH));
      // A large share of filings are a spouse's or a dependent's. Attributing
      // those to a member's judgement is the classic error with this data.
      if (t.issuer && t.issuer !== "self") who.append(el("span", "fc-issuer", t.issuer));
      if (t.chamber) who.append(el("span", "fc-chamber", t.chamber));
      tr.append(who);
      const side = el("td", "fc-side " + (t.side === "buy" ? "is-buy" : t.side === "sell" ? "is-sell" : ""),
        t.side || DASH);
      tr.append(side);
      tr.append(el("td", "c-num", t.txnDate || DASH));
      const lag = el("td", "c-num");
      const n = isNum(t.disclosureLagDays);
      lag.textContent = n === null ? DASH : n + "d";
      // Over 45 days the STOCK Act window has lapsed and the move is usually
      // long gone; that is the single most decision-relevant number here.
      if (n !== null && n > 45) lag.classList.add("is-late");
      tr.append(lag);
      tr.append(el("td", "c-num fc-amt", t.amountRange || DASH));
      tb.append(tr);
    }
    table.append(tb);
    const wrap = el("div", "fc-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Disclosed congressional transactions");
    wrap.append(table);
    host.append(wrap);

    const note = el("p", "fc-note");
    note.textContent =
      `${panel.total} disclosed transaction${panel.total === 1 ? "" : "s"}` +
      (isNum(panel.medianLagDays) !== null ? `, median ${panel.medianLagDays} days between trade and filing. ` : ". ") +
      "These are DISCLOSURES, not positions: the STOCK Act allows 45 days and late filers " +
      "routinely exceed 100, so a row can be months old. No return is shown — a filing " +
      "reports an opening with no paired closing print, and the vendor's per-member history " +
      "cannot be paged, so a track record is not computable rather than merely unavailable. " +
      "Amounts are the filed brackets; a midpoint would be invented precision.";
    host.append(note);
  }

  /* ---------- score derivation -------------------------------------- */

  const AXES = [
    { k: "F", signed: true, label: "Flow", blurb: "net directional delta, premium tilt, aggressor volume and open-interest change — every column a ratio, so the column ranks flow rather than market capitalisation" },
    { k: "P", signed: true, label: "Positioning", blurb: "where today's flow is building dealer gamma relative to where the standing book already is, in ATR units" },
    { k: "D", signed: true, label: "Path", blurb: "how the day accumulated — steady work against the tape, or one spike already in the price" },
    { k: "V", signed: false, label: "Vol regime", blurb: "how rich options are against delivered vol, where 30-day IV sits in its own year, and whether it is rising" },
    { k: "O", signed: false, label: "Quality", blurb: "the multiplier this name earned: directional share of the tape, near-money rather than lottery, direction rather than vol, and dealer gamma at spot" },
  ];

  /**
   * The decomposition.
   *
   * THREE SIGNED AXES AND TWO GAUGES, drawn differently on purpose. F, P and D
   * carry a direction and are drawn from a centre origin; V and O carry none
   * and are drawn as left-origin gauges, because putting an unsigned quantity
   * on a signed axis is exactly the confusion that let unsigned magnitudes into
   * the composite in the first place. A gauge at zero is a real reading; a
   * signed axis at null is an absent one, and those must not look alike.
   */
  function renderScore(host, card) {
    const question = "Why is this name on the board, and how much of the score came from where?";
    if (!card.fam) return deadPanel(host, question, "no decomposition was published");
    panelHead(host, question);

    const weights = card.weights || {};
    const wTotal = Object.values(weights).reduce((a, w) => a + (isNum(w) || 0), 0);

    /* A CARD FROM BEFORE THE GAUGES EXISTED must not have its numbers redrawn
       under the new meaning. In v1, fam.V and fam.O were signed votes; drawn as
       gauges, a published 53 becomes a 53%-full bar labelled "no direction" and
       a published -22 becomes a negative width under the number -22. F, P and D
       did not change meaning and still render. */
    const legacy = (isNum(card.v) ?? 1) < 2;

    const list = el("ul", "fc-fam");
    for (const axis of AXES) {
      const v = legacy && !axis.signed ? null : isNum(card.fam[axis.k]);
      const li = el("li", (axis.signed ? "is-signed " : "is-gauge ") +
        (v === null ? "is-null" : !axis.signed ? "is-pos" : v < 0 ? "is-neg" : "is-pos"));
      li.append(el("span", "fc-fam-k", axis.k));

      const track = el("span", "fc-fam-track");
      // A zero mark on every signed track. Family V used to publish 0 on every
      // name, be classed positive, and render as literally nothing — an empty
      // track that looked identical to a track whose bar was too small to see.
      if (axis.signed) track.append(el("b", "fc-fam-zero"));
      const bar = el("i");
      bar.style.setProperty("--w", v === null ? 0 : (axis.signed ? Math.min(Math.abs(v) / 100, 1) : Math.min(v / 100, 1)));
      track.append(bar);
      li.append(track);

      li.append(el("span", "fc-fam-v", v === null ? DASH
        : axis.signed ? (v > 0 ? "+" + v : v < 0 ? MINUS + Math.abs(v) : "0")
        : String(v)));

      const lab = el("span", "fc-fam-l");
      lab.append(document.createTextNode(axis.label));
      if (axis.signed && wTotal > 0 && isNum(weights[axis.k]) !== null) {
        const w = el("span", "fc-fam-w");
        w.textContent = " " + Math.round((weights[axis.k] / wTotal) * 100) + "% of the blend";
        lab.append(w);
      } else if (!axis.signed) {
        lab.append(el("span", "fc-fam-w",
          legacy ? " not published on this card" : " gauge — no direction"));
      }
      lab.title = axis.blurb;
      li.append(lab);
      list.append(li);
    }
    host.append(list);

    const conv = card.conv || {};
    host.append(statList([
      ["Score", isNum(card.score) === null ? DASH
        : (card.score > 0 ? "+" : card.score < 0 ? MINUS : "") + Math.abs(card.score)],
      ["Conviction", isNum(card.conviction) === null ? DASH : String(card.conviction)],
      ["Agreement", isNum(conv.agreement) === null ? DASH : Math.round(conv.agreement * 100) + "%"],
      ["Axes present", isNum(conv.breadth) === null ? DASH : conv.breadth + " of 3"],
      ["Sources", isNum(conv.coverage) === null ? DASH : Math.round(conv.coverage * 5) + " of 5"],
      ["Quality gate", isNum(conv.gate) === null ? DASH : "\u00d7" + conv.gate.toFixed(2)],
    ]));

    /* THE TWO REASONS THE QUALITY GAUGE IS LOW, spelled out.
    
       O is a single digit and it is a PRODUCT of four oriented axes, so a 38
       can mean "this name's flow is lottery tickets", "this participant is
       trading vol, not direction", or neither of those and something else
       entirely. Those readings call for opposite handling — one says the
       direction is real but the sizing is a punt, the other says there is no
       directional view to read at all — and until now the card folded both
       into that digit and the reader could not recover either.
    
       Both are ratios of gross sums with no free parameter. otmShare is in
       [0, 1] by construction (|otm directional delta| <= |directional delta|
       row by row); vegaTilt is gross vega flow per unit of gross delta flow,
       unbounded above, and its floor of zero is "every dollar of this flow was
       spent on direction". Neither is thresholded into an adjective here: the
       scorer ranks them cross-sectionally, so no absolute cut is identified,
       and inventing one would be exactly the free parameter this project has
       refused elsewhere. */
    const quality = card.quality;
    if (!quality) {
      host.append(el("p", "fc-note",
        "The two quality readings behind the O gauge — the out-of-the-money share of " +
        "directional flow and the vega tilt — are not published on this card. It was " +
        "built before they were, so they are shown as unmeasured rather than as zeros: " +
        "zero is the BEST possible reading of both once they are oriented, and imputing " +
        "it would reward a name for having no data. They return on the next published " +
        "session."));
    } else {
      const otm = isNum(quality.otmShare);
      const tilt = isNum(quality.vegaTilt);
      host.append(statList([
        ["OTM share of directional flow", otm === null ? DASH : Math.round(otm * 100) + "%"],
        ["Vega flow per unit delta", tilt === null ? DASH : neg(tilt.toFixed(2))],
      ]));
      host.append(el("p", "fc-note",
        (otm === null && tilt === null
          ? "Neither quality reading is measurable on this name: there was no directional " +
            "delta flow to divide by, which is \"no directional view\", never infinite " +
            "conviction — so both are withheld rather than floored at their best value. "
          : "") +
        (otm !== null
          ? `${Math.round(otm * 100)}% of this name's directional delta flow traded ` +
            `out-of-the-money. A high share is lottery tickets — cheap, convex, and ` +
            `frequently written by someone with no view at all; a low one is near-money ` +
            `conviction that has to be paid for. `
          : "") +
        (tilt !== null
          ? `Each unit of gross delta flow came with ${neg(tilt.toFixed(2))} of gross vega ` +
            `flow. A high tilt says this participant is trading VOLATILITY rather than ` +
            `direction, which is the cleanest reason on the card to suppress a directional ` +
            `read rather than to misinterpret it as a view. `
          : "") +
        "Both enter the score only through the O gauge, ranked against the rest of the " +
        "board rather than against a fixed cut — there is no identified threshold at " +
        "which a share becomes \"too high\"."));
    }

    if (legacy) {
      host.append(el("p", "fc-note",
        "This card was built before the volatility and quality readings became " +
        "gauges, so those two are shown as unavailable rather than redrawn under " +
        "a meaning they did not have. They return on the next published session."));
    }

    host.append(el("p", "fc-note",
      "The three signed axes are blended by EFFECTIVE breadth — a family of five " +
      "columns that all restate the same tape counts as one signal, not five — and " +
      "the blend is then multiplied by the quality gate, which is bounded above by " +
      "two and averages one across the board, so it can amplify or damp a reading " +
      "but never reverse it. The result is neutralised against sector and market cap, " +
      "then mapped through a FIXED scale — score = 100·tanh(composite × 0.5493) — so " +
      "a composite of 2.0 scores 80 on every session and at every board size, and a " +
      "quiet day prints quiet scores. The composite is a weighted mean of columns each " +
      "measured in its own median-absolute-deviation units, so 2.0 is two of those, " +
      "not two standard deviations of anything. This is a ranked attention signal, " +
      "not a return forecast."));
  }

  /* ---------- assembly ---------------------------------------------- */

  function fmtDate(iso) {
    if (!iso) return DASH;
    const d = new Date(iso.length <= 10 ? iso + "T00:00:00Z" : iso);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(iso);
  }

  let painted = null;

  function paint(card, updatedAt) {
    painted = { card, updatedAt };
    $("fcTitle").textContent = card.ticker;
    const score = isNum(card.score);
    const badge = $("fcScore");
    badge.textContent = score === null ? DASH
      : (score > 0 ? "+" : score < 0 ? MINUS : "") + Math.abs(score);
    badge.className = "fc-score " + (score === null ? "" : score < 0 ? "is-neg" : "is-pos");
    const conv = isNum(card.conviction);
    $("fcConv").textContent = conv === null ? DASH : conv + " conviction";
    const regime = card.regime && card.regime.label;
    $("fcRegime").textContent = regime === "short" ? "short Γ" : regime === "long" ? "long Γ" : DASH;

    /* Staleness is a BAND, not a toast: a reader scrolls past a toast.
       Once a card has been written, a later pipeline failure leaves the old
       row in place and the API answers 200 with old numbers beside a board
       showing today's date. The Worker cannot detect that without parsing,
       which is the one thing this architecture refuses to do, so the check
       lives here. */
    const band = $("fcStale");
    const age = updatedAt ? Date.now() - updatedAt : null;
    const stale = age !== null && age > 36 * 3600 * 1000;
    band.hidden = !stale;
    dialog.classList.toggle("is-stale", stale);
    if (stale) {
      band.textContent =
        `This card was last built ${Math.floor(age / 3600000)} hours ago, on the ` +
        `${fmtDate(card.sessionDate)} session. Its numbers are not today's and are shown dimmed.`;
    }

    const panels = card.panels || {};
    renderGamma($("fcGamma"), panels.gamma, card);
    renderLevels($("fcLevels"), panels.levels);
    renderDisplacement($("fcDisp"), panels.displacement);
    renderSurface($("fcSurface"), panels.surface, card);
    renderCalendar($("fcCal"), panels.calendar);
    renderMove($("fcMove"), panels.pricedMove);
    renderContext($("fcCtx"), panels.context);
    renderPath($("fcPath"), panels.path);
    renderCongress($("fcCongress"), panels.congress);
    renderScore($("fcWhy"), card);

    // Two dates, always. The job runs pre-open, so the session the data
    // describes is not the day it was built, and conflating them is how a
    // card silently claims to be about today.
    $("fcProv").textContent =
      `Session ${fmtDate(card.sessionDate)}  ·  built ${fmtDate(card.generatedAt)}`;
  }

  function showLoading(ticker) {
    $("fcTitle").textContent = ticker;
    $("fcScore").textContent = DASH;
    $("fcConv").textContent = "";
    $("fcRegime").textContent = "";
    $("fcStale").hidden = true;
    // Staleness is a property of a PAINTED payload, so it is cleared by the
    // same function that clears the panels. Leaving it to paint() meant the
    // dim survived into the next card whenever that card was pending or
    // failed to load — and then never cleared at all.
    dialog.classList.remove("is-stale");
    $("fcProv").textContent = "Loading…";
    for (const id of ["fcGamma", "fcSurface", "fcLevels", "fcDisp", "fcCal", "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
      $(id).replaceChildren(el("p", "fc-note", "Loading…"));
    }
  }

  function trim() {
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  function load(ticker) {
    if (cache.has(ticker)) return Promise.resolve(cache.get(ticker));

    /* Keyed by ticker, the way the board already does it.
       A single `inflight` slot meant the hover prefetch was aborted by the
       very click it existed to warm: pointerenter started the fetch, the click
       called load() again, and the first line of the old body aborted it — so
       every card open cost two requests and the prefetch delivered nothing.
       Now a request for the same ticker joins the one in flight, and only a
       request for a DIFFERENT ticker cancels its predecessor. */
    const pending = inflight.get(ticker);
    if (pending) return pending.promise;
    for (const [key, entry] of inflight) {
      if (key !== ticker) { entry.controller.abort(); inflight.delete(key); }
    }

    const controller = new AbortController();
    const promise = fetch("/api/flows/card?t=" + encodeURIComponent(ticker), {
      credentials: "same-origin", signal: controller.signal,
    }).then((r) => {
      if (r.status === 401) { location.href = "/flows/"; return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const updatedAt = Number(r.headers.get("X-Payload-Updated")) || null;
      return r.json().then((body) => ({ body, updatedAt }));
    }).then((v) => {
      if (v) { cache.set(ticker, v); trim(); }
      return v;
    }).finally(() => { inflight.delete(ticker); });
    inflight.set(ticker, { controller, promise });
    return promise;
  }

  function openCard(ticker, fromRow) {
    if (!ticker) return;
    current = ticker;
    opener = fromRow || null;
    showLoading(ticker);
    if (!dialog.open) dialog.showModal();
    $("fcTitle").focus();

    load(ticker).then((v) => {
      if (!v || current !== ticker) return;
      if (v.body && v.body.status === "pending") {
        $("fcProv").textContent = "";
        for (const id of ["fcGamma", "fcSurface", "fcLevels", "fcDisp", "fcCal", "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
          deadPanel($(id), "", "No card has been built for this name yet. Cards are " +
            "published after the boards, so one can briefly lag its row.");
        }
        return;
      }
      paint(v.body, v.updatedAt);
    }).catch((e) => {
      if (e && e.name === "AbortError") return;
      // Every panel still said "Loading…", so a failed card was
      // indistinguishable from a slow one and the reader waited forever.
      for (const id of ["fcGamma", "fcSurface", "fcLevels", "fcDisp", "fcCal", "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
        deadPanel($(id), "", "This card could not be loaded. Close and try again.");
      }
      $("fcProv").textContent = "This card could not be loaded.";
    });
  }

  function closeCard() {
    current = null;
    if (pushedByUs) { pushedByUs = false; history.back(); return; }
    try {
      const url = new URL(location.href);
      url.searchParams.delete("t");
      history.replaceState(null, "", url);
    } catch { /* deep-linking is a convenience */ }
    if (dialog.open) dialog.close();
  }

  /* ---------- wiring -------------------------------------------------- */

  document.addEventListener("click", (event) => {
    // The deck card and the table's ticker button are both openers. Delegation
    // rather than per-node listeners, so a re-rendered board needs no rebind.
    const button = event.target.closest && event.target.closest(".fb-open, .fd-card");
    if (!button) return;
    event.preventDefault();
    const ticker = button.dataset.t;
    try {
      const url = new URL(location.href);
      url.searchParams.set("t", ticker);
      history.pushState({ t: ticker }, "", url);
      pushedByUs = true;
    } catch { pushedByUs = false; }
    openCard(ticker, button);
  });

  $("fcClose").addEventListener("click", closeCard);

  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeCard(); });
  /* Backdrop click, by GEOMETRY rather than by event target.
     A <dialog> is its own scroll container, so a click on its scrollbar has
     the dialog itself as event.target — identical to a backdrop click — and
     dragging the scrollbar closed the card. Comparing the pointer against the
     dialog's own box distinguishes the two: the scrollbar is inside it. */
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right
                && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) closeCard();
  });
  dialog.addEventListener("close", () => {
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  });

  window.addEventListener("popstate", () => {
    const t = new URL(location.href).searchParams.get("t");
    pushedByUs = false;
    if (t) openCard(t, null);
    else if (dialog.open) { current = null; dialog.close(); }
  });

  // A deep link straight to ?t=NVDA has no prior history entry, so closing
  // must strip the parameter rather than call history.back() and eject the
  // reader from the site entirely.
  const initial = new URL(location.href).searchParams.get("t");
  if (initial) { pushedByUs = false; openCard(initial, null); }

  /* THE SVGs ARE LAID OUT ONCE, AT OPEN, AND WERE NEVER REDRAWN.

     Every chart on the card sizes itself from host.clientWidth at paint time
     and then relies on the viewBox to scale. That is fine for the geometry and
     wrong for everything measured in absolute units: rotating a phone to
     landscape scaled 10.5px labels to 23.4px and the 132px plate rail to
     294px, so the annotation swallowed the plot it was annotating. Redrawing
     on a settled resize costs one repaint and nothing else — the payload is
     already in hand, so there is no fetch.

     Debounced, because a drag-resize fires continuously, and gated on the
     dialog actually being open. */
  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (!dialog.open || !painted) return;
    // Mobile browsers fire resize when the URL bar hides, changing only the
    // HEIGHT. Redrawing then would flicker the card for no benefit.
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (dialog.open && painted) paint(painted.card, painted.updatedAt);
    }, 160);
  });

  window.flowsCardPrefetch = (ticker) => { if (!cache.has(ticker)) load(ticker).catch(() => {}); };
})();
