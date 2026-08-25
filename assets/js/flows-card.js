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

    const decades = [];
    for (const v of marks.sort((a, b) => a - b)) {
      for (const sgn of [1, -1]) {
        const x = xOf(sgn * v);
        if (x < plotL + 2 || x > plotR - 2) continue;
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

    // Spot claims its plate first: it is the reference every other level is
    // measured against, so it is the one that must sit exactly on its rule.
    if (spot !== null && spot >= lo && spot <= hi) {
      const y = yOfPrice(spot);
      svg.append(svgEl("line", { class: "gp-spot", x1: plotL, x2: plotR, y1: y, y2: y }));
      svg.append(plate(y, "SPOT", px2(spot), null, "is-spot"));
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
       of the canvas, where it was 303px away from the thing it described. */
    const axis = svgEl("text", { class: "gp-axis", x: x0, y: H - 3, "text-anchor": "middle" });
    axis.textContent = "◀ short   net dealer Γ   long ▶";
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
    const below = regime.flipSide === "long_below" ? "long" : "short";
    const above = below === "long" ? "short" : "long";
    const amplifies = (side) => (side === "short"
      ? "hedging amplifies moves there"
      : "hedging damps them there");

    const note = el("p", "fc-note");
    const band = isNum(regime.bandMin) !== null && isNum(regime.bandMax) !== null
      ? `Measured over strikes ${px2(regime.bandMin)}–${px2(regime.bandMax)} only, so this is net dealer gamma inside that band, not the whole book. `
      : "";
    note.textContent =
      (flip !== null
        ? `Dealers are ${below} gamma below ${px2(flip)} — ${amplifies(below)} — and ${above} above it. ` +
          (isNum(regime.crossings) !== null && regime.crossings > 1
            ? `The book crosses zero ${regime.crossings} times; this is the crossing nearest spot. `
            : "")
        : "Net gamma does not change sign materially inside the drawn band, so no flip level is published here. ") +
      band +
      `The gamma axis is symlog with decade rules: read magnitude off the labelled powers of ten, not off bar length. ` +
      `The widest bar is ${money(bars.reduce((a, b) => (Math.abs(b.g) > Math.abs(a) ? b.g : a), 0)).replace("$", "")} Γ. ` +
      `σ is ATR(14).` +
      (panel.bucketed ? ` ${panel.strikes} strikes are aggregated into ${bars.length} bars.` : "");
    host.append(note);
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
  function renderCalendar(host, panel) {
    const question = "When does this dealer positioning expire, and what is left after it does?";
    if (!panel || panel.status !== "ok" || !panel.schedule || !panel.schedule.length) {
      return deadPanel(host, question, panel && panel.reason);
    }
    panelHead(host, question);

    const rows = panel.schedule;
    const W = 560, ROW = 26, padL = 96, padR = 56, padT = 8;
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
   * The band the option market has already quoted.
   *
   * This is a PRICE, not a prediction, and the panel is built so it cannot be
   * read as one: no point target, no direction, no probability. The horizon is
   * the expiry the vendor quoted rather than a round number of days, because
   * relabelling a quoted-expiry number as a fixed horizon silently rescales it
   * by the ratio of the two maturities, differently for every name.
   */
  function renderMove(host, panel) {
    const question = "What move has the option market already priced, and is that band rich or cheap?";
    if (!panel || panel.status !== "ok") return deadPanel(host, question, panel && panel.reason);
    panelHead(host, question);

    const W = 560, H = 92, padL = 16, padR = 16;
    const plotW = W - padL - padR;
    const svg = svgEl("svg", {
      class: "pm", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    const mid = padL + plotW / 2;
    const half = plotW * 0.42;
    svg.append(svgEl("rect", { class: "pm-band", x: mid - half, y: 26, width: half * 2, height: 22, rx: 3 }));
    svg.append(svgEl("line", { class: "pm-spot", x1: mid, x2: mid, y1: 18, y2: 56 }));
    for (const [x, txt, cls] of [
      [mid - half, px2(panel.low), "is-low"],
      [mid, px2(panel.spot), "is-spot"],
      [mid + half, px2(panel.high), "is-high"],
    ]) {
      const t = svgEl("text", { class: "pm-lab " + cls, x, y: 16, "text-anchor": "middle" });
      t.textContent = txt;
      svg.append(t);
    }
    const cap = svgEl("text", { class: "pm-axis", x: mid, y: 72, "text-anchor": "middle" });
    cap.textContent = "±" + (panel.movePerc * 100).toFixed(1) + "% to " + (panel.horizonExpiry || "the quoted expiry") +
      (isNum(panel.horizonDays) !== null ? "  ·  " + panel.horizonDays + " calendar days" : "");
    svg.append(cap);
    svg.setAttribute("aria-label",
      `The option market prices a move of plus or minus ${(panel.movePerc * 100).toFixed(1)} percent ` +
      `to ${panel.horizonExpiry || "the quoted expiry"}, a band from ${px2(panel.low)} to ${px2(panel.high)}.`);
    host.append(svg);

    host.append(statList([
      ["Implied 30d vol", vol1(panel.iv30)],
      ["Realized 30d vol", vol1(panel.rv30)],
      ["Variance risk premium",
        isNum(panel.vrp) === null ? DASH : signed(panel.vrp, (a) => (a * 100).toFixed(1) + " vol pts")],
      ["Band", panel.richness === null ? DASH : panel.richness],
    ]));

    host.append(el("p", "fc-note",
      "THIS IS A PRICE, NOT A FORECAST. The implied move is what the at-the-money " +
      "contracts cost, so it is what someone would have to pay to be long that move " +
      "— a risk-neutral quantity, not an expectation of where the stock goes. " +
      "The variance risk premium beside it is the one comparative statement the data " +
      "supports: implied 30-day volatility minus the volatility this stock has " +
      "actually delivered over the last 30 sessions. Positive means the band is " +
      "expensive against recent history. " +
      "NOT CLAIMED: a direction, a probability, a point target, or that the stock " +
      "will stay inside the band."));
  }

  /* ---------- price context ------------------------------------------ */

  function renderContext(host, panel) {
    const question = "Where has this name been, before any of today's flow?";
    if (!panel || panel.status !== "ok") return deadPanel(host, question, panel && panel.reason);
    panelHead(host, question);

    const closes = Array.isArray(panel.closes) ? panel.closes : [];
    if (closes.length >= 2) {
      const W = 560, H = 76, pad = 4;
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

  function renderPath(host, panel) {
    const question = "Did this arrive as one print, or as a bid that persisted all session?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.series) || panel.series.length < 2) {
      return deadPanel(host, question, panel && panel.reason);
    }
    panelHead(host, question);

    const series = panel.series.map((p) => p[0]);
    const W = Math.max(280, Math.min(760, host.clientWidth || 560));
    const H = 120, pad = 10;
    const lo = Math.min(...series, 0), hi = Math.max(...series, 0);
    const span = hi - lo || 1;
    const x = (i) => pad + (i / (series.length - 1)) * (W - 2 * pad);
    const y = (v) => pad + (1 - (v - lo) / span) * (H - 2 * pad);

    const svg = svgEl("svg", {
      class: "fp", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img",
    });
    svg.append(svgEl("line", { class: "fp-zero", x1: pad, x2: W - pad, y1: y(0), y2: y(0) }));
    const d = series.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    svg.append(svgEl("path", {
      class: "fp-line " + (series[series.length - 1] >= 0 ? "is-pos" : "is-neg"), d,
    }));
    svg.setAttribute("aria-label",
      `Cumulative net delta across the session, ending at ${compact(panel.netDelta)}.`);
    host.append(svg);

    host.append(statList([
      ["Net delta", compact(panel.netDelta)],
      ["Net premium", money(panel.netPremium)],
      ["Minutes on tape", String(panel.minutes)],
    ]));
    host.append(el("p", "fc-note",
      "The curve is the running total, so its shape is the accumulation: a straight " +
      "climb is a worked order, a single step is one print. Net premium is call buying " +
      "minus put buying — positive put premium is put BUYING, which is bearish."));
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

    const list = el("ul", "fc-fam");
    for (const axis of AXES) {
      const v = isNum(card.fam[axis.k]);
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
        lab.append(el("span", "fc-fam-w", " gauge — no direction"));
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

    host.append(el("p", "fc-note",
      "The three signed axes are blended by EFFECTIVE breadth — a family of five " +
      "columns that all restate the same tape counts as one signal, not five — and " +
      "the blend is then multiplied by the quality gate, which is bounded above by " +
      "two and averages one across the board, so it can amplify or damp a reading " +
      "but never reverse it. The result is neutralised against sector and market cap, " +
      "then scored against a FIXED unit: two robust sigma from the cross-sectional " +
      "median is 80, on every session and at every board size. A quiet day therefore " +
      "prints quiet scores. This is a ranked attention signal, not a return forecast."));
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
    for (const id of ["fcGamma", "fcLevels", "fcCal", "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
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
        for (const id of ["fcGamma", "fcLevels", "fcCal", "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
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
      for (const id of ["fcGamma", "fcLevels", "fcCal", "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
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
