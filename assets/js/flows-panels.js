/* =============================================================
   flows-panels.js — the ten panel renderers, and the scaffolding
   they are built on.

   EXTRACTED FROM flows-card.js RATHER THAN COPIED INTO A SECOND
   PAGE. The card dialog was the only surface that drew these, so
   they lived inside its IIFE — behind, critically, a guard that
   returns when `#flowsCard` is absent. A second page that wanted the
   same charts therefore had exactly two options: duplicate ~2,040 of
   the file's 2,282 lines, or move them here. Duplication would mean
   every future fix to a chart had to be made twice, in two files,
   forever — the hazard shared/flows-chain.js names in its own header:
   "A second implementation of any of those is a second answer to the
   same question."

   THE CONTRACT WITH ITS CALLERS. One deliberate global,
   `window.FlowsPanels`, following the pattern window.flowsCardPrefetch
   already sets. Every renderer keeps the signature it had inside the
   dialog, so the dialog's behaviour is unchanged by the move, and each
   takes an OPTIONAL trailing `question` (and, where it emits <defs>, a
   `mount` tag) — defaulting to the string it hardcoded before, so a
   caller that passes nothing gets byte-identical output.

   WHY `mount` EXISTS. SVG `<defs>` ids are document-global and
   `url(#id)` resolves to the first match in document order. A page that
   mounts the same panel twice — a grid copy and an enlarged copy — emits
   the same id twice, and the second drawing silently borrows the first's
   pattern. Suffixing every id with the mount tag is what keeps two
   drawings of one panel independent.

   EVERY PANEL IS A TAGGED UNION. The renderer switches on panel.status
   BEFORE touching a number. A missing source must never reach a chart,
   because on a card there is no cross-section to normalise against and a
   fallback zero renders as the most extreme reading the panel can
   produce.
   ============================================================= */
(function () {
  "use strict";

  const DASH = "—";

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
  /**
   * A magnitude, shortened — WITHOUT throwing away a fifth of it.
   *
   * The thousands branch rounded to whole K: compact(2500) returned "3K",
   * which is 20% high, and compact(1500) returned "2K", 33% high. Every other
   * branch keeps a decimal (2 for billions, 1 for millions) and the smallest
   * one, where the relative cost of rounding is LARGEST, kept none. On a tick
   * label that is a ruler mark that lies about where it is — a gridline drawn
   * at 2,500 with "3K" printed beside it — and the label is the only thing a
   * reader can measure a bar against.
   *
   * One decimal below 10K, none above it, so "9.8K" is precise where it must
   * be and "47K" does not carry a digit nobody reads.
   */
  const compact = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const a = Math.abs(n);
    const s = n < 0 ? MINUS : "";
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e4) return s + (a / 1e3).toFixed(0) + "K";
    if (a >= 1e3) return s + (a / 1e3).toFixed(1) + "K";
    return s + a.toFixed(0);
  };

  /* Mono character advance, in px per px of font-size divided by 10.

     6.5, AND THE OLD 6 WAS TOO NARROW IN THE ONE DIRECTION THAT MATTERS. The
     comment this replaces said "5.81 measured, rounded up so every estimate
     errs wide" and reasoned that the .gp-axis letter-spacing of 0.04em was
     "exactly the gap between 5.81 and 6". It is not: 5.81 + 0.4 is 6.21, so
     the rounding was already short before the spacing was counted.

     MEASURED, in Chromium, on a real .fa-axis caption in the shipped webfont:
     getComputedTextLength() / length = 6.421 at font-size 10px with
     letter-spacing 0.4px. A 57-character axis caption is therefore 366 units
     where the old constant predicted 342 — and a caption centred on a
     24-unit-too-small half-width had its first glyph clipped off the canvas.
     The same latent error sits under every renderGamma caption; it has simply
     never had a string long enough to expose it.

     ERRS WIDE ON PURPOSE. A label estimated too narrow collides or leaves the
     canvas silently; one estimated too wide falls back to a shorter form a
     little sooner. Only one of those is a defect a reader can see.

     Hoisted to module scope from inside renderGamma when the renderers were
     extracted: it is the only text-metric constant on the page, and a second
     copy of it in a new drawer is a second number to keep in step. Scale it by
     the actual font size rather than using it raw at 9px. */
  const AXIS_CH = 6.5;

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
   * added later did not. A wide desktop gets a wider plot rather than a
   * magnified one.
   *
   * THE CEILING WAS THE DIALOG'S, AND IT STOPPED BEING RIGHT THE MOMENT A
   * SECOND SURFACE DREW THESE PANELS. It was 760, chosen when the modal was
   * the only host. Two measurements say that number is now wrong in two
   * different places:
   *
   *   - /flows/ticker/, is-wide panel, 1280px viewport: host 958px, viewBox
   *     760, so width:100% stretches the drawing by 1.261. Every 9px label
   *     renders at 11.3 and the one-unit-one-pixel invariant is broken in the
   *     direction nobody looks for — the original bug shrank type, this one
   *     magnifies it, and neither overflows.
   *   - The card dialog itself: .fc is min(52rem, 94vw) = 832px less 2x1.7rem
   *     of padding = a 777.6px host. The old ceiling bound there too, by
   *     17.6px — a 1.023 stretch that has always been live and sat just
   *     inside the suite's 15% tolerance, which is why nothing caught it.
   *
   * 1900 is set by the WIDEST HOST THE GRID CAN PRODUCE, and the number
   * moved when the canvas did. Under the tiered .flows-main the largest a
   * panel gets is a full-row .is-wide at the three-column tier, just below
   * the four-column breakpoint: viewport 2111 - 13rem rail - 2x2.5rem pad
   * = 1823px. The enlarge dialog is smaller than that (min(96rem, 96vw)
   * less 2x1.7rem tops out at 1482), so it is no longer the binding case.
   *
   * THE CAP IS NOT COSMETIC. Above it the SVG keeps its viewBox and gets
   * stretched by width:100%, so one viewBox unit stops being one CSS pixel
   * and the axis type shrinks with the drawing — silently, because nothing
   * overflows when everything scales together. The ticker suite asserts the
   * ratio at 320, 1280 and 1840px and caught exactly that when the canvas
   * widened and this number did not. Below the cap every host draws at
   * exactly its own width, which is the whole invariant.
   *
   * ONE FUNCTION, NOT TWO. flows-ticker.js reads this rather than defining its
   * own: two width policies is two answers to "how wide is this chart", and
   * the panels are now drawn by two different controllers.
   */
  function panelWidth(host) {
    return Math.max(300, Math.min(1900, Math.round((host && host.clientWidth) || 560)));
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

  /**
   * Suffix an SVG <defs> id with the mount it belongs to.
   *
   * SVG IDS ARE DOCUMENT-GLOBAL AND url(#id) TAKES THE FIRST MATCH IN
   * DOCUMENT ORDER. The card dialog was the only surface that drew these
   * panels, so one copy of each pattern was the only copy and a bare id was
   * safe. /flows/ticker/ holds a grid copy and an enlarged copy of the same
   * panel at once — two <pattern id="gpNeg"> in one document, and the second
   * drawing silently borrows the first's tile. Today the two tiles are
   * identical so it happens to look right; the moment one scales with its
   * drawing it is wrong and NOTHING LOOKS WRONG.
   *
   * The default keeps every existing caller byte-identical: a renderer called
   * without a mount emits exactly the id it always did.
   */
  const mountId = (base, mount) => (mount ? base + "-" + mount : base);

  function renderGamma(host, panel, card, questionIn, mount) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn ||
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
    /* THE RAIL IS AN ANNOTATION COLUMN, NOT A TOOLTIP.

       The two level readouts were drawn as filled, outlined plates in a 132px
       rail — 44% of the canvas at a 320px viewport, sitting flush against the
       right end of the bars with a card background behind them. Nothing was
       ever drawn under them, so the fill bought nothing and cost the panel
       its whole right-hand third: what it looked like was a tooltip that had
       got stuck over the chart. Without the plate the same text needs no
       padding, no border and no background, and the twenty pixels it gives
       back go to the bars. */
    const padT = 16, padB = 30, labelW = 46, railW = 112;
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

    /* THE TWO MAPPINGS HAVE TO AGREE ON THE LADDER, AND FOR A LONG TIME THEY
       DID NOT.

       The bars are a CATEGORICAL ladder: one row per strike, evenly spaced
       down the panel, placed by yOfIndex. The price rules — spot, the gamma
       flip, the call and put walls, the earned labels — are placed by price.
       This function used to interpolate LINEARLY across the whole price span,
       which agrees with the bar rows only when the strikes are uniformly
       spaced.

       Real chains are not uniformly spaced. Listed ladders tighten near the
       money ($2.50 steps) and widen in the wings ($5, then $10), and on top of
       that this panel DROPS any strike whose gamma the vendor did not report
       — deliberately, so an absent reading is never drawn as a measured zero
       — which punches gaps into whatever regularity was left.

       Measured on a realistic 24-strike ladder from $100 to $270: the worst
       divergence was 67.5px, or 4.8 bar rows, and the spot rule for $170
       landed 35px away from the $170 bar. The panel drew a flip line pointing
       at the wrong strike, on every non-uniform chain, and nothing about it
       looked wrong.

       PIECEWISE ON THE LADDER, therefore: find the two strikes bracketing the
       price and interpolate between THEIR row positions. A price that is
       exactly a listed strike lands exactly on that strike's bar, which is the
       property the whole panel is read for. */
    const yOfPrice = (p) => {
      if (!bars.length) return padT;
      if (!(hi > lo)) return padT + (bars.length * ROW) / 2;
      if (p <= lo) return yOfIndex(0);
      if (p >= hi) return yOfIndex(bars.length - 1);
      /* bars are ascending in strike, so the first bar at or above p closes
         the bracket and its predecessor opens it. */
      let i = 1;
      while (i < bars.length - 1 && bars[i].k < p) i++;
      const kLo = bars[i - 1].k, kHi = bars[i].k;
      const span = kHi - kLo;
      /* Two strikes at the same price cannot define a fraction between them;
         take the lower row rather than dividing by zero. */
      const t = span > 0 ? (p - kLo) / span : 0;
      return yOfIndex(i - 1) + t * (yOfIndex(i) - yOfIndex(i - 1));
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
      id: mountId("gpNeg", mount), width: 4, height: 4, patternUnits: "userSpaceOnUse",
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

    /* MAGNITUDE TICKS ON A ROUND LADDER, NOT ON THIS TICKER'S OWN NUMBERS.

       A symlog's log segment is exactly scale-invariant, so a book with a
       35:1 spread and one with a 4e17:1 spread draw identically: bar LENGTH
       alone encodes rank, not magnitude, and the rail is what puts the
       magnitude back. But the rail was built from the decades PLUS tau and
       vmax — a quantile of this book and its single widest bar — and those
       two are not graduations, they are readings. The axis came out labelled

           −505K  −100K  −4K   4K   100K  505K

       on a live card: six numbers, three of them artefacts of the data, and
       the reader is left to wonder what is special about four thousand. An
       axis is a ruler and a ruler has round marks on it. The candidates are
       now the standard log ladder — 1, 2 and 5 times a power of ten — over
       the range the axis spans, and nothing else is ever printed.

       The old `guaranteed` set existed to promise that the widest bar always
       had a mark near it, and this ladder keeps that promise without a
       special case. `lowest` is at most tau/5, tau is at most vmax, and the
       largest ladder value at or below vmax is at least vmax/2 — so that
       value always clears the floor and the loop below cannot fail to emit
       it, on any book. An explicit re-add would be a line no input can reach.

       niceStep() is deliberately NOT reused: its ladder carries 2.5 for the
       price rail, and every graduation on this axis has to come off ONE
       ladder or the reader cannot tell a graduation from a reading. */
    const marks = new Set();
    /* The ladder runs a good way BELOW the knee. tau is the book's 60th
       percentile, so a floor at tau left half the bars on the panel with no
       graduation anywhere near them — on a real card that meant three marks
       for forty bars. Inside the knee the axis is linear, where a graduation
       is not merely placeable but exactly proportional, which is the one
       stretch of this axis where ticks cost nothing to interpret. */
    const lowest = Math.max(tau / 5, vmax / 1e4);
    for (let e = Math.floor(Math.log10(lowest)); Math.pow(10, e) <= vmax; e++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, e);
        if (v > 0 && v <= vmax && v >= lowest) marks.add(v);
      }
    }

    /* A SIDE WITH NO BARS GETS NO GRADUATIONS. Position is magnitude on this
       axis, so a "−20K" tick in a region where the book has nothing to draw
       reads as a measurement of an empty half of the plot. */
    const sides = [];
    if (fMax > 0) sides.push(1);
    if (fMin < 0) sides.push(-1);

    /* ACCEPTED FROM THE LARGEST DOWN.

       The old pass went up from the smallest, so a mark near the knee claimed
       its space first and blocked the decade above it under the 40px rule —
       which is exactly how 10K vanished from the rail quoted above while 4K
       survived. Taking the biggest first means the graduation nearest the
       widest bar is never the one that loses.

       And a mark is clamped inward ONLY if it landed on the edge. `rate` is
       the largest pixels-per-unit that fits both sides, so whenever the zero
       rule is not clamped to its 18/82 bounds, xOf(+-vmax) lands exactly on
       plotR or plotL — inside a two-unit edge test that then discarded it, on
       all 109 emitted cards. That is a sub-pixel miss and clamping it back is
       right. But on a book whose short side is a hundredth of its long side —
       the case the zero rule's own 18/82 clamp exists for — xOf(−vmax) lands
       well outside plotL, and the old unconditional clamp printed "−505K"
       hard against the left edge: a magnitude named at a position where that
       magnitude is not, on an axis whose entire premise is that position IS
       magnitude. Three pixels of tolerance recovers the sub-pixel miss and
       nothing else. */
    const decades = [];
    for (const v of Array.from(marks).sort((a, b) => b - a)) {
      for (const sgn of sides) {
        let x = xOf(sgn * v);
        if (x < plotL - 3 || x > plotR + 3) continue;
        x = Math.min(plotR - 2, Math.max(plotL + 2, x));
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
      const bx = Math.min(x0, xg);
      // A zero-width bar reads as NO DATA; tiny-but-nonzero is a different
      // fact, so there is a minimum width.
      const bw = Math.max(Math.abs(xg - x0), 1.5);
      svg.append(svgEl("rect", {
        class: "gp-bar " + (neg ? "is-neg" : "is-pos"),
        x: bx, y, width: bw, height: ROW - 4,
      }));
      /* THE HATCH IS AN OVERLAY NOW, NOT THE WHOLE BAR.

         A short bar was drawn with `fill: url(#gpNeg)` and no fill under it,
         so it was a set of 1.8-on-4 diagonal lines — about 45% coverage —
         while a long bar of identical magnitude was 100% solid. Two bars
         meaning the same number, one of them half the ink. The reader's first
         impression of which side of the book is heavier was being set by the
         texture that exists to carry the SIGN, which is the one thing texture
         must not be allowed to do here. Fill underneath, texture cut into it
         from above: both channels intact, comparable weight, and the sign
         still survives a greyscale render because the texture is still there.

         This is the same construction the gamma surface uses for its own
         short cells, which is the other reason to prefer it: one panel should
         not encode short gamma differently from the panel beside it. */
      if (neg) {
        svg.append(svgEl("rect", {
          class: "gp-barhatch", x: bx, y, width: bw, height: ROW - 4,
          fill: `url(#${mountId("gpNeg", mount)})`,
        }));
      }
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
      /* The leader is drawn to the label's y whether or not the plate moved:
         it is what ties an annotation in the rail to the rule it names, and
         with the plate's background gone there is nothing else doing that. */
      g.append(svgEl("line", { class: "gp-leader", x1: plotR, y1: y, x2: plotR + 8, y2: py }));
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

    /* Price labels are earned, not gridded: the three biggest strikes by
       |gamma| and the two ends, with a de-collision pass.

       SPOT AND THE FLIP ARE NOT IN THIS LIST ANY MORE. Both already have a
       rule across the plot and a labelled annotation in the rail carrying the
       same px2() string, so putting them here printed each of those two
       prices TWICE on one row — and the left copy was distinguished from its
       neighbours by colour alone, which is the one channel this card does not
       let anything depend on. Dropping them also hands their rows back to the
       strikes that actually carry the gamma, which is what the rail is for. */
    const wanted = [];
    bars.slice().sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 3)
      .forEach((b) => wanted.push({ p: b.k, cls: "" }));
    wanted.push({ p: lo, cls: "" }, { p: hi, cls: "" });
    /* THEN THE RULER FILLS IN. Once spot and the flip stopped being labelled
       here, an emitted card was down to four prices on a 490px column — the
       three biggest strikes clustered together near the top, and the low end.
       The unlabelled ticks below already mark a round step; labelling a
       coarser multiple of the SAME step turns the rail back into a price axis
       without inventing a second set of numbers for the reader to reconcile.
       Earned labels are pushed first and win every collision, so the ruler
       only ever fills gaps. */
    const labelStep = niceStep((hi - lo) / 6);
    if (labelStep > 0) {
      for (let v = Math.ceil(lo / labelStep) * labelStep; v <= hi + 1e-9; v += labelStep) {
        wanted.push({ p: Number(v.toFixed(4)), cls: "" });
      }
    }
    const placed = [];
    for (const c of wanted) {
      if (isNum(c.p) === null || c.p < lo || c.p > hi) continue;
      const y = yOfPrice(c.p);
      if (placed.some((q) => Math.abs(q - y) < 14)) continue;
      placed.push(y);
      const t = svgEl("text", { class: "gp-price " + c.cls, x: labelW - 8, y: y + 3, "text-anchor": "end" });
      t.textContent = px2(c.p);
      svg.append(t);
    }

    /* The caption sits AT the zero rule it labels rather than at the far left
       of the canvas, where it was 303px away from the thing it described —
       but CLAMPED, because the zero rule floats between 18% and 82% of the
       plot and a centred caption hung off the canvas when it sat near an edge.
       Measured on an emitted card at a 320px viewport: a 166px caption centred
       at x=85 overhung the left edge, and SVG clips silently so the leading
       glyph simply vanished.

       AND THE CAPTION SAYS THE SCALE IS LOGARITHMIC, on the axis, where a
       reader meets it. It was stated only in the note under the chart, four
       sentences in — and a reader who assumes a linear axis misjudges every
       bar on the panel, in a direction that always flatters the wings. The
       ticks now being round makes the compression visible (100K and 500K are
       not five times as far apart as 20K and 100K), but visible is not the
       same as stated.

       TWO THINGS THE OLD CLAMP GOT WRONG, both of which the longer caption
       would have made worse. The per-character estimate was 4.5 units, and
       .gp-axis measures 5.81 at 10px with its letter-spacing — so the comment
       claiming the estimate "errs wide" had it backwards by 22%, and a
       caption believed to fit could overhang by a fifth of its length. And
       the clamp was to the PLOT, not the canvas: at a 320px viewport the plot
       is 142 units and no caption of this kind fits inside it, so the clamp
       was pushing a 250-unit string into a 142-unit box and the excess left
       the canvas at whichever end lost. The caption is an axis label, not
       plot furniture; it may use the whole canvas, and it drops to a short
       form if even that will not hold it. */
    const axisLong = "◀ short   net dealer Γ (log scale)   long ▶";
    const axisShort = "◀ short   Γ, log scale   long ▶";
    const axisText = axisLong.length * AXIS_CH <= W - 8 ? axisLong : axisShort;
    const axisHalf = (axisText.length * AXIS_CH) / 2;
    const axisX = Math.min(W - 4 - axisHalf, Math.max(4 + axisHalf, x0));
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
      /* THE READER WHO ASSUMES A LINEAR AXIS MISREADS EVERY BAR, so the axis
         names itself twice: once on the caption and once here, in the terms
         that say what to do about it. "Symlog" was a word; this is an
         instruction. */
      `The gamma axis is LOGARITHMIC outside a narrow band around zero, so a bar twice as long ` +
      `is nowhere near twice the gamma: read magnitude off the labelled ticks, which are round ` +
      `numbers on a 1-2-5 ladder, and treat bar length as rank. ` +
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
  function renderDisplacement(host, panel, card, questionIn) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn || "Is today's flow building dealer gamma where the book already is, or somewhere else?";
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

  /* THE SHADING RAMP: STEPPED, LOGARITHMIC, AND SCALED TO THE CELLS THAT ARE
     ACTUALLY ON THE GRID.

     What shipped was linear in |v| / scaleCap, and scaleCap is
     max(q95, peak/100) — so on any book with one dominant ATM cell the
     divisor is a hundredth of a peak that is itself two or three decades
     above the median cell. Measured on the suite's own surface fixture, whose
     grid holds one 9e9 outlier and 98 cells between 1e6 and 4e6: every
     ordinary cell mapped to a fill-opacity between 0.130 and 0.159. Five
     "distinct" values, none of them separable by eye, against a void drawn at
     0.35 — which is how a panel whose whole job is "find the concentration"
     came to read as an empty grid with a few marks in it. The panel's own
     test asserted that magnitude was "encoded in opacity, not flattened" and
     passed on that, because it counted distinct values instead of measuring
     their spread.

     Three decisions, and each of them is a decision about a failure mode:

     LOGARITHMIC, because per-cell gamma is log-distributed across a strike
     ladder — the wings are orders of magnitude under the ATM rung, not a
     fraction of it — and a linear map spends the entire scale on the top
     decade.

     TOPPED AT min(cap, the 98th percentile of the drawn magnitudes), so one
     outlier cannot push the ramp above every other cell on the grid. In the
     ordinary case, where scaleCap is the q95 of a well-behaved grid, the two
     are the same number and nothing changes. The outlier itself is still
     marked with a slash, which is the channel that says "off scale" without
     taking the ramp with it.

     STEPPED rather than continuous, because steps can be DRAWN. A continuous
     opacity ramp is undecodable: nothing anywhere on the panel tells a reader
     what 0.4 is worth. Five steps, a factor the note can name, and a key with
     both ends labelled turn the shading back into a quantity. */
  const RAMP_STEPS = 5;
  const RAMP_OPACITY = [0.24, 0.43, 0.62, 0.81, 1];
  /* The step factor is snapped to one of these so the note can NAME it.
     "each step is a factor of 2.46" is a number a reader has to take on
     trust; "a factor of 2" is one they can multiply in their head. */
  const RAMP_FACTORS = [1.5, 2, 3, 5, 10];

  function surfaceRamp(mags, cap) {
    if (!mags.length || !(cap > 0)) return null;
    const at = (p) => mags[Math.min(mags.length - 1, Math.max(0, Math.round(p * (mags.length - 1))))];
    const top = Math.min(cap, at(0.98));
    if (!(top > 0)) return null;
    /* Four decades is already more dynamic range than a strike ladder has;
       below that the floor is the grid's own tenth percentile, so the palest
       step is a step a real cell occupies rather than an empty one. */
    const bottom = Math.max(at(0.1), top / 1e4);
    let factor = RAMP_FACTORS[RAMP_FACTORS.length - 1];
    if (top > bottom * 1.05) {
      const want = Math.pow(top / bottom, 1 / RAMP_STEPS);
      factor = RAMP_FACTORS.reduce((a, b) =>
        (Math.abs(Math.log(b) - Math.log(want)) < Math.abs(Math.log(a) - Math.log(want)) ? b : a));
    }
    const lg = Math.log(factor);
    return {
      top, factor,
      floor: top / Math.pow(factor, RAMP_STEPS - 1),
      /* A measured zero never reaches this: it has no magnitude to encode and
         the renderer draws it as its own mark before asking for a band. A
         guard here would be a branch no input can take, and this file has
         already shipped one of those. */
      band: (v) => {
        const k = RAMP_STEPS - 1 - Math.floor(Math.log(top / Math.abs(v)) / lg + 1e-9);
        return Math.min(RAMP_STEPS - 1, Math.max(0, k));
      },
    };
  }

  function renderSurface(host, panel, card, questionIn, mount) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn ||
      "Where is dealer gamma concentrated, and when does it expire?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.grid) || !panel.grid.length) {
      return deadPanel(host, question, panel && panel.reason);
    }
    panelHead(host, question);

    const { grid, strikes, expiries, scaleCap, spot, atSpot, callWall, putWall } = panel;
    const W = panelWidth(host);
    /* labelW carries the price rail AND a gutter for the wall markers, which
       used to be full-width rules across the grid. padB carries the shading
       key, which sits in space the panel was already reserving and never
       drawing into: the key costs the card no height at all. */
    const labelW = 54, padT = 30, padB = 42, padR = 10;
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
      id: mountId("gsNeg", mount), width: 5, height: 5, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "gs-negpat",
    });
    pat.append(svgEl("line", { x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: "currentColor", "stroke-width": 1.6 }));
    defs.append(pat);
    svg.append(defs);

    // Rows run high price at the top, the way a price ladder is read.
    const yOfRow = (i) => padT + (strikes.length - 1 - i) * rowH;

    /* The ramp is measured off the grid rather than off the payload, because
       the payload publishes a cap and a peak and no distribution. Zeros are
       excluded for the same reason buildSurface excludes them from its own
       quantile: a mostly-empty grid would otherwise put the floor at zero. */
    const mags = [];
    for (const row of grid) for (const v of row) if (v !== null && v !== 0) mags.push(Math.abs(v));
    mags.sort((a, b) => a - b);
    const ramp = surfaceRamp(mags, isNum(scaleCap) === null ? 0 : scaleCap);

    const cellW = Math.max(1, colW - 1), cellH = Math.max(1, rowH - 1);
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
            class: "gs-void", x, y, width: cellW, height: cellH,
          }));
          return;
        }
        if (v === 0) {
          /* AND A MEASURED ZERO IS NOT A SMALL LONG POSITION. The sign class
             was chosen by `v < 0`, so a pair the vendor measured at exactly
             zero was drawn as the palest LONG cell on the grid — a sign the
             book does not have, asserted at the one magnitude where sign is
             meaningless, and at an opacity that made it look like the
             smallest real reading rather than none. It gets a mark of its
             own: no fill, a centre tick. Three states, three appearances —
             not measured, measured at nothing, measured at something. */
          svg.append(svgEl("rect", { class: "gs-cell is-zero", x, y, width: cellW, height: cellH }));
          const cx = x + cellW / 2, cy = y + cellH / 2;
          svg.append(svgEl("line", {
            class: "gs-zeromark", x1: cx - Math.min(4, cellW / 3), y1: cy,
            x2: cx + Math.min(4, cellW / 3), y2: cy,
          }));
          return;
        }
        const neg = v < 0;
        const band = ramp ? ramp.band(v) : 0;
        const cell = svgEl("rect", {
          class: "gs-cell " + (neg ? "is-neg" : "is-pos"),
          x, y, width: cellW, height: cellH,
          /* The palest step is still clearly a cell: zero opacity and "no
             data" must not look alike, and now neither may look like the
             centre-ticked zero either. */
          "fill-opacity": RAMP_OPACITY[band].toFixed(3),
        });
        svg.append(cell);
        if (neg && rowH >= 9 && colW >= 9) {
          svg.append(svgEl("rect", {
            class: "gs-hatch", x, y, width: cellW, height: cellH,
            fill: `url(#${mountId("gsNeg", mount)})`,
          }));
        }
        /* Cells beyond the PUBLISHED cap are marked rather than silently
           flattened against everything else at full saturation. The slash is
           tied to scaleCap and not to the ramp's own top, because scaleCap is
           what the payload counted in `clipped` and a picture that marks a
           different set of cells than its own payload counted is worse than
           one that marks none. */
        if (Math.abs(v) > scaleCap) {
          /* A SLASH, NOT A DIAGONAL OF THE CELL. Corner to corner made the
             mark's angle a function of the cell's aspect ratio, and a cell is
             44 x 15 at a phone width and 240 x 15 on a desktop — so on a wide
             card the mark flattened into a long shallow line running most of
             the way across the grid, which reads as a stray rule rather than
             as a mark on one cell. A fixed-length 45-degree slash at the
             centre is the same glyph at every width, and 45 degrees is also
             what keeps it distinct from the hatch's own direction. */
          const len = Math.min(cellW, cellH) * 0.8;
          const cx = x + cellW / 2, cy = y + cellH / 2;
          svg.append(svgEl("line", {
            class: "gs-clip",
            x1: (cx - len / 2).toFixed(2), y1: (cy + len / 2).toFixed(2),
            x2: (cx + len / 2).toFixed(2), y2: (cy - len / 2).toFixed(2),
          }));
        }
      });
    });

    const idxOf = (price) => {
      if (price === null || price === undefined) return -1;
      let best = -1, d = Infinity;
      strikes.forEach((k, i) => { const dd = Math.abs(k - price); if (dd < d) { d = dd; best = i; } });
      return best;
    };
    const spotRow = idxOf(atSpot);
    const callRow = callWall ? idxOf(callWall.strike) : -1;
    const putRow = putWall ? idxOf(putWall.strike) : -1;

    /* PRICE LABELS ARE EARNED, AND THERE ARE FEW OF THEM.

       The stride was `ceil(13 / rowH)` — as many labels as would fit without
       overlapping. But a 21-rung ladder at 15px a rung fits twenty-one of
       them, so the stride evaluated to 1 and every single strike was
       labelled: twenty near-identical numbers, 62.00 63.00 64.00 and on down
       the side, all of them at the same weight, competing with the cells for
       the reader's eye. Legibility was never the binding constraint here.
       COMPETITION WITH THE DATA is, and the fix is a budget rather than a
       fit: the levels that mean something are guaranteed, the rest are a
       coarse ruler, and a minimum separation stops the two from crowding.

       Priority order matters — the first entry to claim a y wins it — so
       spot and the two walls are pushed before the ends and the ruler. */
    /* TWO SEPARATIONS, and the difference between them is the difference
       between a guarantee and a budget. A level that means something —
       spot, either wall — needs only the separation that keeps 9px type
       legible, because it is going to be drawn whatever else is on the rail.
       A ruler label is discretionary and gets the wider one, so the ruler
       thins itself around the levels rather than the other way round. Sharing
       one threshold at the wide value silently dropped the put wall whenever
       it sat within a row of spot, which is precisely when a reader most
       wants to see both. */
    const LEVEL_SEP = 12, RULER_SEP = 24;
    const LABEL_BUDGET = 5;
    const wantRows = [];
    if (spotRow >= 0) wantRows.push({ i: spotRow, cls: " is-spot", must: true });
    if (callRow >= 0) wantRows.push({ i: callRow, cls: " is-call", must: true });
    if (putRow >= 0) wantRows.push({ i: putRow, cls: " is-put", must: true });
    wantRows.push({ i: strikes.length - 1, cls: "" }, { i: 0, cls: "" });
    const stride = Math.max(1, Math.round(strikes.length / LABEL_BUDGET));
    for (let i = 0; i < strikes.length; i += stride) wantRows.push({ i, cls: "" });

    const placedRows = [];
    for (const c of wantRows) {
      if (c.i < 0 || c.i >= strikes.length) continue;
      const y = yOfRow(c.i) + rowH / 2 + 3;
      const sep = c.must ? LEVEL_SEP : RULER_SEP;
      if (placedRows.some((q) => Math.abs(q - y) < sep)) continue;
      placedRows.push(y);
      const t = svgEl("text", {
        class: "gs-price" + c.cls,
        x: labelW - 13, y, "text-anchor": "end",
      });
      t.textContent = px2(strikes[c.i]);
      svg.append(t);
    }

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
    /* THE WALLS POINT AT THEIR ROW; THEY NO LONGER RULE ACROSS IT.

       Each wall was a full-width outlined rect at stroke-width 1.4, so the
       two of them drew more ink than the cells they were annotating and the
       grid read as three horizontal rules with a heat map behind them. A
       marker in the gutter and a tick at the far edge bracket the same row
       for a fraction of the ink, and the row's price label is guaranteed
       above, so the reader has three things on one line to follow.

       Filled for the call wall, hollow for the put wall. That is the same
       non-hue channel the session path uses for its two legs — filled disc,
       hollow square — and it is why the marker is a shape at all rather than
       two coloured rules: on a greyscale print or to a deuteranope reader,
       the celadon rule and the red one were the same rule. */
    const markWall = (rowIndex, cls) => {
      if (rowIndex < 0) return;
      const yc = yOfRow(rowIndex) + Math.max(1, rowH - 1) / 2;
      const g = svgEl("g", { class: cls });
      const t = Math.min(5.5, rowH / 2.2);
      g.append(svgEl("polygon", {
        class: "gs-wallmark",
        points: `${plotL - 11},${yc - t} ${plotL - 11},${yc + t} ${plotL - 2},${yc}`,
      }));
      g.append(svgEl("line", {
        class: "gs-walltick", x1: plotL + plotW, y1: yc, x2: plotL + plotW + 6, y2: yc,
      }));
      svg.append(g);
    };
    markWall(callRow, "gs-callwall");
    markWall(putRow, "gs-putwall");

    /* THE KEY, in the padding the panel was already reserving and never drew
       into. Without it "magnitude by opacity" is an encoding with no decoder:
       the note could say the scale was capped at 670K and a reader still had
       no way to turn a shade into a number. Both ends of the ramp are
       labelled and the note names the step, so any cell can be read to within
       one step. The hatched swatch keys the SIGN channel in the same breath,
       because that is the other thing the picture cannot say about itself. */
    if (ramp) {
      const keyY = padT + strikes.length * rowH + 12;
      const sw = 15, swH = 9;
      const rampX = plotL + 30;
      for (let b = 0; b < RAMP_STEPS; b++) {
        svg.append(svgEl("rect", {
          class: "gs-key-sw is-pos", x: rampX + b * sw, y: keyY, width: sw - 1, height: swH,
          "fill-opacity": RAMP_OPACITY[b].toFixed(3),
        }));
      }
      const lowT = svgEl("text", { class: "gs-key", x: rampX - 4, y: keyY + swH, "text-anchor": "end" });
      lowT.textContent = compact(ramp.floor);
      svg.append(lowT);
      const hiT = svgEl("text", { class: "gs-key", x: rampX + RAMP_STEPS * sw + 3, y: keyY + swH });
      hiT.textContent = compact(ramp.top);
      svg.append(hiT);

      const hatchX = rampX + RAMP_STEPS * sw + 3 + compact(ramp.top).length * 6.2 + 10;
      svg.append(svgEl("rect", {
        class: "gs-key-sw is-neg", x: hatchX, y: keyY, width: sw - 1, height: swH, "fill-opacity": "0.81",
      }));
      svg.append(svgEl("rect", {
        class: "gs-hatch", x: hatchX, y: keyY, width: sw - 1, height: swH,
        fill: `url(#${mountId("gsNeg", mount)})`,
      }));
      const negT = svgEl("text", { class: "gs-key", x: hatchX + sw + 2, y: keyY + swH });
      negT.textContent = "short";
      svg.append(negT);
    }

    /* THE PANEL HAD role="img" AND NO LABEL AT ALL, which is a picture a
       screen reader announces as "image" and nothing else. The grid itself
       cannot be read out cell by cell — 126 of them — so the label carries
       what the legend carries: the band, the levels, and the window. */
    svg.setAttribute("aria-label",
      `Dealer gamma by strike and expiry` + (card && card.ticker ? ` for ${card.ticker}` : "") + `. ` +
      `${strikes.length} strikes from ${px2(lo)} to ${px2(hi)} across ${expiries.length} expiries ` +
      `from ${expiries[0]} to ${expiries[expiries.length - 1]}. ` +
      (s !== null ? `Spot ${px2(s)}. ` : "") +
      (callWall ? `Call wall ${px2(callWall.strike)}. ` : "") +
      (putWall ? `Put wall ${px2(putWall.strike)}. ` : "") +
      `Darker cells carry more gamma; hatched cells are short gamma.`);

    host.append(svg);

    /* THE LEGEND SAYS WHAT THE PICTURE CANNOT. Which row is spot, which are
       the walls, that the scale is capped, and how much of the book is on
       screen — a surface showing 8 of 40 expiries is a window, and a window
       that does not say so reads as the whole book. */
    const pairs = [];
    if (s !== null) pairs.push(["Spot", px2(s)]);
    if (callWall) pairs.push(["Call wall", px2(callWall.strike)]);
    if (putWall) pairs.push(["Put wall", px2(putWall.strike)]);
    /* WHERE THE CONCENTRATION IS, IN WORDS. The picture can now be segmented
       by eye, but the single densest cell is the one reading a trader wants
       to carry away and it is the one a shade cannot state exactly. Both
       coordinates, because a strike without its expiry is the profile panel
       and an expiry without its strike is the roll-off panel — the joint is
       the only thing this panel knows that neither of those does. */
    let peakAt = null;
    for (let i = 0; i < strikes.length; i++) {
      for (let j = 0; j < expiries.length; j++) {
        const v = grid[i][j];
        if (v === null || v === 0) continue;
        if (peakAt === null || Math.abs(v) > Math.abs(peakAt.v)) peakAt = { v, i, j };
      }
    }
    if (peakAt) {
      pairs.push(["Densest cell",
        px2(strikes[peakAt.i]) + " · " + String(expiries[peakAt.j]).slice(5) +
        (peakAt.v < 0 ? " short" : " long")]);
    }
    const regime = card && card.regime && card.regime.label;
    if (regime) pairs.push(["Regime", String(regime).replace(/_/g, " ")]);
    host.append(statList(pairs));

    const notes = [];
    /* THE KEY'S NUMBERS, IN PROSE, so the two cannot drift apart and so a
       reader who is reading rather than looking still gets the decoder. */
    if (ramp) {
      notes.push("Shading steps by a factor of " + (ramp.factor % 1 === 0 ? ramp.factor : ramp.factor.toFixed(1)) +
        " from " + compact(ramp.floor) + " up to " + compact(ramp.top) + ", darker for more gamma");
    } else {
      /* A CARD WHOSE SURFACE PUBLISHES NO SCALE still draws its cells, and
         every one of them at the same weight — which is a picture that looks
         like a measurement of uniformity. Say that shade carries nothing here
         rather than let a reader decode a ramp that was never built. */
      notes.push("No colour scale could be measured for this grid, so shade carries no magnitude on it");
    }
    if (isNum(scaleCap) !== null && scaleCap > 0) {
      notes.push("Colour is capped at " + compact(scaleCap) +
        (panel.clipped > 0
          ? "; " + (panel.clipped === 1
            ? "one cell runs past it (peak " + compact(panel.peak) + ") and is marked"
            : panel.clipped + " cells run past it (peak " + compact(panel.peak) + ") and are marked") +
            " with a slash"
          : ""));
    }
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
    /* THREE STATES, NAMED, because two of them used to look alike and the
       third was drawn with a sign it does not have. */
    notes.push("Short-gamma cells are hatched as well as coloured; a cell the vendor measured " +
      "at exactly zero carries a centre tick, and a blank cell is a strike and expiry it " +
      "returned nothing for at all — not measured and measured at nothing are different facts");
    host.append(el("p", "fc-note", notes.join(". ") + "."));
  }

  function renderCalendar(host, panel, card, questionIn) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn || "When does this dealer positioning expire, and what is left after it does?";
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
  function renderMove(host, panel, card, questionIn) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn ||
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

  function renderContext(host, panel, card, questionIn) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn || "Where has this name been, before any of today's flow?";
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

  function renderLevels(host, panel, card, questionIn) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn || "Where are the levels that matter, and how far is each in units I can size against?";
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
  function renderPath(host, panel, card, questionIn) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn || "Did this arrive as one print, or as a bid that persisted all session?";
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

  function renderCongress(host, panel, card, questionIn) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn || "Who in Congress disclosed a trade in this name, and how old is that information?";
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
  function renderScore(host, card, questionIn) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       The dialog passes nothing and gets exactly the string it always did;
       /flows/ticker/ passes the registry's question, read out of the panel's
       data-question attribute. Written this way rather than as a default
       parameter because the string below is the documentation of what this
       chart is FOR, and moving it out of the function would separate the two. */
    const question = questionIn || "Why is this name on the board, and how much of the score came from where?";
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
      if (!legacy) host.append(el("p", "fc-note",
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

  /* ---------- the one deliberate global ----------------------------- */
  /* Named in AGENTS.md's production-globals allowlist. The scaffolding is
     exported alongside the renderers because a second page draws panels of
     its own with the same vocabulary — deadPanel, the formatters and isNum
     are exactly the pieces that must not be reimplemented, since a fourth
     copy of `isNum` is a fourth chance to write `Number(v)` and turn a
     missing reading into a confident zero. */
  window.FlowsPanels = Object.freeze({
    /* renderers, by the payload key they draw */
    gamma: renderGamma,
    displacement: renderDisplacement,
    surface: renderSurface,
    calendar: renderCalendar,
    pricedMove: renderMove,
    context: renderContext,
    levels: renderLevels,
    path: renderPath,
    congress: renderCongress,
    score: renderScore,

    /* scaffolding */
    el, svgEl, isNum, deadPanel, statList, panelHead, panelWidth,
    niceStep, quantileAbs, symlog, surfaceRamp,
    DASH, MINUS, neg, signed, pct, pct1, sigma, px2, vol1, money, compact,
    AXIS_CH,
  });
})();
