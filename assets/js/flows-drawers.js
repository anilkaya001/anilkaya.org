/* =============================================================
   flows-drawers.js — the nine panel renderers that are NOT on the
   station a reader lands on, fetched when they are first needed.

   WHAT THIS FILE DEFERS, AND WHAT THAT WEIGHS: this file is 111k as
   measured on 2026-09-09, and deferring it takes the ticker route
   from 499.88 KiB to 402.01 KiB — 97.88 KiB off first paint. The two
   figures differ because the walk that defers it GREW: making the
   grid draw one station rather than twenty-three panels, and
   resolving each deferred drawer by name at call time, added 6,877
   bytes to flows-ticker.js. The honest number is the route's, not
   this file's — the file's would credit the split with bytes it did
   not take off the page.

   IT IS NOT COUNTED BY tests/flows-weight.mjs's tickerPage TOTAL,
   because the page does not link it — and that is exactly the trap
   the ceiling comment in that suite names: "a deferred cost is still
   a cost", and a deferral that says nothing has moved bytes out of a
   measurement rather than off a reader's CPU. So the sentence above
   is machine-checked: assets/js/flows-dock.js states its own the same
   way and the suite reads both back out of the source, so a figure
   left at the size this file used to be FAILS rather than quietly
   becoming folklore.

   WHO PAYS IT, AND WHEN. The ticker's default address shows ONE
   station — signal — whose two drawers (renderOverlay and renderScore)
   stay in flows-panels.js and are parsed on first paint. A reader who
   switches station, opens the enlarge dialog on a deferred panel, or
   arrives at a #panel- hash outside signal pays one fetch of this
   file, once per page, and the walk awaits it. A reader who lands and
   reads the score never pays it at all. `?s=all` asks for every
   station and therefore pays it immediately, which is correct: it is
   the address that says "draw me everything".

   IT REGISTERS, IT DOES NOT DEFINE THE CONTRACT. window.FlowsPanels is
   built by flows-panels.js and is the one deliberate global; this file
   destructures the scaffolding out of it and hands the drawers back
   through __register under the SAME argument order every drawer in the
   project declares — (host, panel, card, question[, mount]).
   ============================================================= */
(function () {
  "use strict";

  const P = window.FlowsPanels;
  const { AXIS_CH,
          DASH,
          MINUS,
          appendMethod,
          compact,
          el,
          emptyPanel,
          fmtOr,
          isNum,
          leadReading,
          money,
          mountId,
          neg,
          niceStep,
          panelHead,
          panelWidth,
          pct,
          pct1,
          polarity,
          px2,
          qualifier,
          quantileAbs,
          quietPanel,
          sigma,
          signed,
          statList,
          svgEl,
          symlog,
          vol1 } = P;

  function renderGamma(host, panel, card, questionIn, mount) {
    /* THE CALLER'S QUESTION WINS, and the hardcoded one is the fallback.
       THERE IS ONE SURFACE NOW. /flows/ticker/ reads the registry's question
       off the panel's data-question attribute and hands it in, so the sentence
       over this drawing is the registry's wherever the panel is drawn. The
       second surface this paragraph used to name — the card dialog, reading
       the same attribute off its own <section class="fc-panel"> — is retired,
       and the drift the threading was built to close went with it.

       THE FALLBACK IS NOT DEAD CODE. `shared/` is in .assetsignore and never
       served, so a renderer cannot import the registry at runtime; a drawer
       that headed itself with an empty .fc-q whenever a caller forgot the
       fourth argument would be a chart that depends on its caller for its own
       meaning. It is exercised too: the geometry probes in
       tests/flows-card-render.mjs call this function with three arguments, so
       the drawing a forgetful caller gets is the drawing that is measured.
       Written inline rather than as a default parameter because the string
       below is the documentation of what this chart is FOR, and moving it out
       would separate the two.

       STATED HERE ONCE FOR ALL TEN RENDERERS. It stood verbatim above every
       one of them, restating the header's "THE CONTRACT WITH ITS CALLERS";
       the other nine are gone. Deleting the ninth restatement of one rule
       loses no reasoning, which is not the act flows-weight.mjs warns against
       — shortening the reasoning itself to fit a ceiling. Measured: 1,350
       bytes, billed on four routes. */
    const question = questionIn ||
      "Where does dealer hedging flip from damping moves to amplifying them, " +
      "and how far is that from spot?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.bars) || !panel.bars.length) {
      return emptyPanel(host, question, panel);
    }
    panelHead(host, question);

    const bars = panel.bars.filter((b) => isNum(b.k) !== null && isNum(b.g) !== null);
    if (!bars.length) return quietPanel(host, question, "no usable strikes");
    bars.sort((a, b) => a.k - b.k);

    const spot = isNum(panel.spot);
    const flip = isNum(card.gammaFlip);

    // Cumulative gamma IS the convexity: the running total below a strike is
    // the dealer's net gamma if spot were there, and its zero crossing is the
    // flip. Drawing it beside the bars saves the reader integrating by eye.
    let run = 0;
    const cum = bars.map((b) => (run += b.g));

    /* THROUGH panelWidth, LIKE EVERY OTHER CHART. This read `Math.min(760,
       …)`, the dialog's old ceiling, left behind when panelWidth replaced
       exactly this expression: the enlarge dialog's host is four figures
       wide, so this drawer capped at 760 units and width:100% stretched the
       drawing — one viewBox unit stopped being one CSS pixel. */
    const W = panelWidth(host);
    const ROW = bars.length > 34 ? 9 : 12;
    /* THE RAIL IS AN ANNOTATION COLUMN, NOT A TOOLTIP. The two level readouts
       were filled, outlined plates in a 132px rail — 44% of the canvas at a
       320px viewport — with nothing ever drawn under them, so the fill bought
       nothing and looked like a tooltip stuck over the chart. Without the
       plate the text needs no padding, border or background, and the twenty
       pixels go back to the bars. */
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

       Real chains are not uniformly spaced: listed ladders tighten near the
       money and widen in the wings, and this panel DROPS any strike whose
       gamma the vendor did not report — deliberately, so an absent reading is
       never drawn as a measured zero — which punches gaps into whatever
       regularity was left. Measured on a 24-strike ladder from $100 to $270,
       the worst divergence was 67.5px, or 4.8 bar rows, and the spot rule for
       $170 landed 35px from the $170 bar: a flip line pointing at the wrong
       strike, on every non-uniform chain, with nothing about it looking
       wrong.

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

       The widest bar always has a mark near it without a special case:
       `lowest` is at most tau/5, tau is at most vmax, and the largest ladder
       value at or below vmax is at least vmax/2, so that value always clears
       the floor on any book. An explicit re-add would be unreachable.

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

         A short bar was `fill: url(#gpNeg)` with no fill under it — 1.8-on-4
         diagonals, about 45% coverage — against 100% solid for a long bar of
         identical magnitude: two bars meaning the same number, one of them
         half the ink, so which side of the book looked heavier was being set
         by the texture that exists to carry the SIGN. Fill underneath,
         texture cut into it from above: both channels intact, comparable
         weight, and the sign still survives a greyscale render. It is the
         construction the gamma surface uses for its own short cells, so one
         panel does not encode short gamma differently from the next. */
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
      if (d) svg.append(svgEl("path", { class: "gp-cum " + (sign > 0 ? "is-pos" : sign < 0 ? "is-neg" : "is-flat"), d }));
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

       AND THE CLAMP IS TO THE CANVAS, NOT THE PLOT. At a 320px viewport the
       plot is 142 units and no caption of this kind fits inside it, so the
       old clamp pushed a 250-unit string into a 142-unit box and the excess
       left the canvas at whichever end lost. The caption is an axis label,
       not plot furniture; it may use the whole canvas, and it drops to a
       short form if even that will not hold it. */
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

    /* THE SENTENCE IS DERIVED, NOT ASSERTED — AND WITHHELD WHEN IT CANNOT BE.

       This used to read "dealers are short gamma below X and long above it" as
       a hardcoded string. Whether that holds is determined by the sign of the
       cumulative on the low side of the crossing the pipeline actually chose,
       and on the live board it was frequently the other way round — the note
       contradicted the header badge on the same card. So a card from before
       flipSide was measured gets no sentence at all: defaulting an absent
       flipSide to "short" rebuilds exactly that string, and on the live INTC
       book the truth is long_below. Withholding is the same discipline the
       score panel applies to fam.V and fam.O, and for the same reason: a
       field whose value cannot be verified must not be asserted. */
    const regime = card.regime || {};
    const knowsSide = regime.flipSide === "long_below" || regime.flipSide === "short_below";
    const below = regime.flipSide === "long_below" ? "long" : "short";
    const above = below === "long" ? "short" : "long";
    const amplifies = (side) => (side === "short"
      ? "hedging amplifies moves there"
      : "hedging damps them there");
    const sep = isNum(regime.flipSeparation);

    /* THE TWO READINGS FIRST, THE CHART AS THEIR EVIDENCE, THE METHOD FOLDED.
       Where the flip is and how hard dealers are positioned at spot were
       sentences one and two of a 1,400-character paragraph BELOW the drawing.
       Nothing is deleted: the reasons a reading is WITHHELD travel with it as
       open qualifiers, and only the decoder folds. */
    leadReading(host,
      (flip !== null && !knowsSide
        ? `The book changes sign at ${px2(flip)}.`
        : flip !== null
        ? `Dealers are ${below} gamma immediately below ${px2(flip)} — ${amplifies(below)} — ` +
          `and ${above} immediately above it.`
        : "Net gamma does not change sign materially inside the drawn band, so no flip " +
          "level is published here.") +
      (flip !== null && knowsSide && sep !== null
        ? ` The thinner of the two sides carries ${(sep * 100).toFixed(0)}% of the book's peak ` +
          `exposure, so this is a ${sep < 0.15 ? "weak" : sep < 0.4 ? "moderate" : "strong"} boundary.`
        : ""));
    /* THE READING IN WORDS, because a share of a peak is not self-evidently a
       position size: 0 is spot sitting where the running total is zero, which
       is the flip itself, and 1 is the most exposed rung the ladder measured.
       Withheld rather than defaulted when spot lies outside the band — the
       feature returns null there because clamping to the edge rung reported a
       confident +-1 for a stock trading nowhere near the strikes on file —
       and the absence LEADS exactly as a number would, so that a silence is
       never the cheaper thing to ship. */
    leadReading(host, atSpot !== null
      ? `Dealer gamma AT SPOT is ${Math.abs(atSpot).toFixed(2)} of this ladder's peak ` +
        `exposure and ${atSpot < 0 ? "short" : "long"}, so the regime at spot is ` +
        `${Math.abs(atSpot) >= 0.5 ? "close to as strong as this book gets" : "well inside its range"}.`
      : "Where spot sits in the cumulative is not published on this card.");

    host.append(svg);

    /* THESE STAY IN THE OPEN, WITH NOTHING TO CLICK, because each changes
       what the reading above it MEANS: which flip of several this is, that
       the side was never measured, why the at-spot share is absent, and that
       the picture is a band rather than the book. */
    if (isNum(regime.crossings) !== null && regime.crossings > 1) {
      host.append(qualifier(`The book crosses zero ${regime.crossings} times; this is the ` +
        `one separating the most exposure.`));
    }
    if (flip !== null && !knowsSide) {
      host.append(qualifier("This card was built before the side of that boundary was " +
        "measured, so which way round it runs is not stated here — it returns on the next " +
        "published session."));
    }
    if (atSpot === null) {
      host.append(qualifier("Spot lies outside the measured strike band, and the edge rung " +
        "would report a confident extreme for a stock trading nowhere near the strikes on " +
        "file."));
    }
    if (isNum(regime.bandMin) !== null && isNum(regime.bandMax) !== null) {
      host.append(qualifier(`Measured over strikes ${px2(regime.bandMin)}–${px2(regime.bandMax)} ` +
        `only, so this is net dealer gamma inside that band, not the whole book.`));
    }

    appendMethod(host, [
      /* THE READER WHO ASSUMES A LINEAR AXIS MISREADS EVERY BAR, so the axis
         names itself twice: once on the caption, in the open, and once here
         in the terms that say what to do about it. "Symlog" was a word; this
         is an instruction. */
      el("p", "fc-note",
        "The gamma axis is LOGARITHMIC outside a narrow band around zero, so a bar twice as " +
        "long is nowhere near twice the gamma: read magnitude off the labelled ticks, which " +
        "are round numbers on a 1-2-5 ladder, and treat bar length as rank. The widest bar is " +
        money(bars.reduce((a, b) => (Math.abs(b.g) > Math.abs(a) ? b.g : a), 0)).replace("$", "") +
        " Γ."),
      /* THE SEPARATE SCALE IS SAID OUT LOUD, because sharing the zero rule
         makes the two series look as though they share everything. The
         measurement and the defect are at the cumulative scale above; what
         is here is that leaving it unsaid invites a reader to compare a
         curve height against a bar length, which means nothing. */
      el("p", "fc-note",
        "The cumulative curve is normalised separately from the bars — only its ZERO CROSSING " +
        "is comparable to them, which is the flip. Read the curve for shape, not height. The " +
        "at-spot reading is a share of this ladder's peak rather than a dollar figure, which " +
        "is what makes it comparable across names. σ is ATR(14)." +
        (panel.bucketed ? ` ${panel.strikes} strikes are aggregated into ${bars.length} bars.` : "")),
    ], "How this profile was drawn");
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
    const question = questionIn || "Is today's flow building dealer gamma where the book already is, or somewhere else?";
    if (!panel || panel.status !== "ok") return emptyPanel(host, question, panel);
    panelHead(host, question);

    const oi = isNum(panel.oiCentroid), vol = isNum(panel.volCentroid), spot = isNum(panel.spot);
    if (oi === null || vol === null) return quietPanel(host, question, "no centroid could be measured");

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
       wrap. Measured at a 320px viewport, where the card dialog's inner width
       was 288: the sentence drew 334px wide and overhung its own canvas by 23px on
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

     What shipped was linear in |v| / scaleCap = max(q95, peak/100), so on any
     book with one dominant ATM cell the divisor is a hundredth of a peak two
     or three decades above the median cell. Measured on the suite's own
     surface fixture — one 9e9 outlier and 98 cells between 1e6 and 4e6 —
     every ordinary cell mapped to a fill-opacity between 0.130 and 0.159:
     five "distinct" values, none separable by eye, against a void drawn at
     0.35. The panel's own test asserted magnitude was "encoded in opacity,
     not flattened" and passed, because it counted distinct values instead of
     measuring their spread.

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
    const question = questionIn ||
      "Where is dealer gamma concentrated, and when does it expire?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.grid) || !panel.grid.length) {
      return emptyPanel(host, question, panel);
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
       overlapping — and a 21-rung ladder at 15px a rung fits twenty-one, so
       the stride evaluated to 1 and every strike was labelled: 62.00 63.00
       64.00 on down the side, all at one weight, competing with the cells.
       Legibility was never the binding constraint here. COMPETITION WITH THE
       DATA is, and the fix is a budget rather than a fit: the levels that
       mean something are guaranteed, the rest are a coarse ruler, and a
       minimum separation stops the two from crowding.

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

       Filled for the call wall, hollow for the put wall — the same non-hue
       channel the session path uses for its two legs, and the reason the
       marker is a shape at all: on a greyscale print or to a deuteranope
       reader, the celadon rule and the red one were one rule. */
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
    const question = questionIn || "When does this dealer positioning expire, and what is left after it does?";
    if (!panel || panel.status !== "ok" || !panel.schedule || !panel.schedule.length) {
      return emptyPanel(host, question, panel);
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
      ["Mean life", fmtOr(panel.meanLifeDays, (n) => n.toFixed(0) + " days")],
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
  /* ---------- IV rank, where the unit IS the reading -----------------

     THE SENTENCE MULTIPLIED BY 100 AND NAMED NO UNIT: it read
     `Math.round(n * 100) + "% of its year"` off panels.pricedMove.ivRank, and
     was right only because that field's fraction convention is implicit at
     every hop from the vendor to this line. THE CARD CARRIES TWO IV RANKS IN
     TWO UNITS — this one a 0-1 fraction, volContext.ivRank's rows[].rank1y on
     0-100 with a `rankUnit` field saying so, because (its own comment) "this
     vendor's rank fields have burned a '1352% of its year' once already" —
     and the divide-by-100 lives in the pipeline, so a rank reaching this
     formatter by any other path prints 52.15 as "5215%".

     So the unit and the population are in the LABEL, the figure is stated out
     of the 100 it is a percentile of, and a value above 1 is WITHHELD as
     `unreadable`: above 1 is not a fraction, it is published bytes in a unit
     this line cannot read. An ABSENT rank is `unavailable`, which is the
     different fact that there is no rank at all. */
  const IV_RANK_TERM = "IV rank, percentile of its own year";

  function ivRankStat(panel) {
    const n = isNum(panel.ivRank);
    if (n === null) {
      return [IV_RANK_TERM, DASH, "is-null", "unavailable",
        "The priced-move panel published no IV rank for this name, so its place in " +
        "its own year is not stated rather than stated as the bottom of it."];
    }
    if (n > 1) {
      return [IV_RANK_TERM, DASH, "is-null", "unreadable",
        "This card publishes pricedMove.ivRank as " + n + ", and this line reads that " +
        "field as a fraction of one. A value above one is in some other unit, so the " +
        "rank is withheld rather than multiplied by a hundred and printed."];
    }
    return [IV_RANK_TERM, Math.round(n * 100) + " of 100", null, null,
      "Read from pricedMove.ivRank, a 0-1 fraction, and shown as the percentile it is: " +
      "where 30-day implied volatility sits against this name's own trailing year. It is " +
      "NOT panels.volContext.ivRank, which the stock feed publishes on 0-100."];
  }

  function renderMove(host, panel, card, questionIn) {
    const question = questionIn ||
      "What move is priced over a fixed horizon, and is that band rich against " +
      "what this stock has actually been delivering?";
    if (!panel || panel.status !== "ok") return emptyPanel(host, question, panel);
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
      return quietPanel(host, question, "no band could be measured");
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

    /* THE CAPTION IS TWO CLAUSES, HELD AS TWO, so it can be folded onto two
       lines when one will not hold it. Joined for the common case and split
       below only if the measurement says it must be. */
    const capClauses = imp !== null
      ? [`±${(imp * 100).toFixed(1)}% priced over ${sessions} sessions`]
        .concat(real !== null ? [`±${(real * 100).toFixed(1)}% delivered`] : [])
      : [`±${(quoted * 100).toFixed(1)}% quoted to ${panel.horizonRule || "the vendor's own expiry"}`];
    const cap = svgEl("text", { class: "pm-axis", x: mid, y: H - 8, "text-anchor": "middle" });
    cap.textContent = capClauses.join("  ·  ");
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

    /* ---- THE CAPTION IS MEASURED, AND FOLDS RATHER THAN BEING CLIPPED ----

       ON A 320px PHONE IT RAN OFF BOTH ENDS OF ITS OWN CANVAS: centred in a
       282-unit viewBox, "±11.3% priced over 10 sessions · ±3.3% delivered"
       advances 288.6 units and paints a box 289.4 wide — 3.3 units off the
       left edge and 4.1 off the right, the two differing because a glyph's
       ink box is not its advance box — so a reader saw a caption beginning
       and ending mid-glyph. Nothing failed: SVG clips silently and no number
       was wrong. It is the failure the `.pm-quotelab` note above describes
       for the vendor label, and it survived here because the caption only
       overflows when the payload publishes BOTH a priced and a delivered move
       at a host this narrow — 48 of the 50 cards a dry run emits, the other
       two carrying the single "quoted to …" clause, which has no seam.

       MEASURED IN THE DOCUMENT, NOT ESTIMATED FROM A CHARACTER COUNT: the face
       is mono at 10px, so an advance-width estimate looks safe and is not —
       the webfont may not have arrived and its fallback's advance is a
       different number. getComputedTextLength() is what will be painted, which
       is why this sits below host.append().

       THE FOLD IS AT THE SEAM THE SENTENCE ALREADY HAS, so two lines lose
       nothing but the middle dot, and the canvas grows by one 12-unit line
       rather than the type shrinking — shrinking is how 9px axis type became
       4.6 CSS px on these panels before. A single clause has no seam and is
       left alone; tests/flows-card-render.mjs sweeps five emitted cards at
       320px, so one that outgrew its host fails there.

       AND THE 0 IS THE ONE ANSWER THAT CANNOT BE WRONG, which is why it is a
       zero here and would be a null anywhere a reading is involved. This is
       not a measurement of the caption; it is the width the caption occupies
       in a document that is not painting it. getComputedTextLength is absent
       only where there is no SVG text layout at all — a non-rendering host —
       and there 0 is exact: nothing is drawn, so nothing can be clipped, and
       skipping the fold is right rather than merely harmless. Every other
       zero in this file carries its reason; so does this one. */
    const capWidth = typeof cap.getComputedTextLength === "function"
      ? cap.getComputedTextLength() : 0;
    if (capWidth > W - 2 && capClauses.length > 1) {
      const H2 = H + 12;
      svg.setAttribute("viewBox", `0 0 ${W} ${H2}`);
      svg.setAttribute("height", H2);
      cap.textContent = capClauses[0];
      cap.setAttribute("y", H2 - 20);
      const cap2 = svgEl("text", { class: "pm-axis", x: mid, y: H2 - 8, "text-anchor": "middle" });
      cap2.textContent = capClauses[1];
      svg.append(cap2);
    }

    host.append(statList([
      ["Implied 30d vol", vol1(panel.iv30)],
      // 21 sessions, which is the usual count in the 30 CALENDAR days the
      // implied leg is quoted over. Labelled by what was measured.
      ["Realized vol, 21 sessions", vol1(panel.rv30)],
      ["Variance risk premium",
        fmtOr(panel.vrp, (n) => signed(n, (a) => (a * 100).toFixed(1) + " vol pts"))],
      ["Band", panel.richness === null ? DASH : panel.richness],
      ivRankStat(panel),
      ["IV, past week",
        fmtOr(panel.ivMomentum, (n) => signed(n, (a) => (a * 100).toFixed(1) + " vol pts"))],
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
    const question = questionIn || "Where has this name been, before any of today's flow?";
    if (!panel || panel.status !== "ok") return emptyPanel(host, question, panel);
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
        /* THE ONLY CHART IN THIS FILE THAT STRETCHED, and the one about to
           carry a second series on a shared axis.

           `none` scales x and y independently. With width:100% over a fixed
           height, any divergence between the host's real width and
           panelWidth()'s clamped answer scaled x while leaving y alone: the
           2.5px marker became an ellipse and the line's SLOPE — the only
           thing a price sparkline communicates — was distorted by whatever
           the ratio happened to be. The five other SVGs here have always used
           `meet`; this one was the outlier.

           No test caught it because the repository's ratio assertion measures
           WIDTH, and width is exactly what this defect gets right. `meet`
           takes the smaller of the two scales, which with a matching height
           is 1 — so one viewBox unit is one CSS pixel, the invariant this
           codebase already holds everywhere else. */
        role: "img", preserveAspectRatio: "xMidYMid meet",
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
        fmtOr(panel.week52Pos, (n) => Math.round(n * 100) + "% of range")],
    ]));

    /* ---- THE WINDOW THE LINE ABOVE IS ACTUALLY DRAWN OVER ------------
       THE PUBLISHER COMPUTED THIS WARNING AND THIS RENDERER THREW IT AWAY.
       buildContext (shared/flows-card.js) publishes `sessions`,
       `datedSessions`, `dropped` and `closeDates`, and its comment on the
       third reads: "Sessions the filter removed. Non-zero means index is NOT
       time in the arrays above, which is precisely when a reader needs the
       dates." The sparkline above places every close by INDEX —
       `xOf = (i) => pad + (i / (closes.length - 1)) * …` — so when the filter
       dropped a session the line is drawn straight across the gap, at the
       same slope as a real move, with nothing on the page saying so.

       IT IS ONE SENTENCE AND IT IS A QUALIFIER, not a method note: it changes
       what the drawing MEANS rather than explaining how it was made, so it
       stays open under the fold rule this file states above.

       EVERY BRANCH IS A DIFFERENT FACT, and none of them is silence. A window
       with no gaps says its span; a window with gaps says how many and that
       the axis is order rather than time; a card built before the fields
       existed says nothing at all rather than printing a confident zero,
       because `dropped` absent and `dropped === 0` are not the same claim. */
    const dropped = isNum(panel.dropped);
    const sessions = isNum(panel.sessions);
    const dates = Array.isArray(panel.closeDates) ? panel.closeDates.filter(Boolean) : [];
    if (dropped !== null || sessions !== null) {
      const span = dates.length >= 2
        ? ` from ${dates[0]} to ${dates[dates.length - 1]}`
        : "";
      host.append(qualifier(dropped === null || sessions === null
        ? `Drawn over ${sessions === null ? dates.length : sessions} close(s)${span}.`
        : dropped > 0
          ? `Drawn over ${sessions} close(s)${span}, with ${dropped} session(s) ` +
            `dropped from the window. The line joins them in ORDER, not on a time ` +
            `axis — a segment spanning a gap is drawn at the same slope as one ` +
            `spanning a single session, so read its shape and not its steepness.`
          : `Drawn over ${sessions} consecutive close(s)${span}, none dropped, so ` +
            `each step of the line is one session.`));
    }

    host.append(el("p", "fc-note",
      "Simple close-to-close returns over the trailing window, and where the last " +
      "close sits between the 52-week low and high. Descriptive only: none of it " +
      "enters the score, and past returns over these horizons carry no forecast " +
      "this system is willing to make."));
  }

  /* ---------- level rail ------------------------------------------- */

  function renderLevels(host, panel, card, questionIn) {
    const question = questionIn || "Where are the levels that matter, and how far is each in units I can size against?";
    if (!panel || panel.status !== "ok") return emptyPanel(host, question, panel);
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
    // The table gets its own scroll container so nothing AROUND it scrolls
    // sideways, and there are two things that must not. /flows/ticker/ puts
    // this 22rem table on a 320px phone: a horizontal scrollbar on the
    // DOCUMENT drags the rail and every other panel across with it, and the
    // enlarge dialog this same panel is redrawn into carries its close button
    // in the header that would ride off with the scroll. The sentence here
    // named only the card dialog's .fc-head and .fc-close, both deleted with
    // it; the geometry outlived them on both of the surfaces that are left.
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
   * The premium leg is worth its ink because DELTA AND PREMIUM DIVERGING
   * INTRADAY IS THE SPREAD-VERSUS-DIRECTIONAL TELL: money that moves premium
   * without moving net delta is being spent on structure — verticals, calendars,
   * anything with two legs — rather than on a direction. A reader with only the
   * delta curve cannot see that, and the two end-of-day totals below the chart
   * cannot show WHEN it happened.
   *
   * TWO SCALES, STATED, BECAUSE THE UNITS ARE NOT COMMENSURABLE — the payload
   * names both under the stat block, and one leg is a delta-weighted contract
   * count while the other is dollars. Plotting them against one shared
   * axis would let a reader compare their heights, which means nothing at all —
   * the identical mistake the gamma panel's note apologises for between its
   * bars and its cumulative curve. Each leg is normalised by its OWN largest
   * absolute value, and the two share exactly one thing: the zero rule, which
   * is the one place they must agree, because zero means "nothing net" in both
   * units. Both normalisations are printed under the chart.
   *
   * IDENTITY WITHOUT HUE. Delta is a solid stroke ending in a filled disc;
   * premium is dashed and ends in a hollow square; the legend swatches are
   * drawn with those strokes rather than described in words. Colour is the
   * LAST channel here, and this panel had been relying on hue alone.
   *
   * The strokes are PRESENTATION ATTRIBUTES rather than stylesheet rules: a
   * path with no CSS defaults to fill:black, stroke:none — a solid blob, not
   * a line — so a renderer that ships before its rules do draws something
   * plain rather than something actively wrong. CSS still wins over an
   * attribute.
   */
  function renderPath(host, panel, card, questionIn) {
    const question = questionIn || "Did this arrive as one print, or as a bid that persisted all session?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.series) || panel.series.length < 2) {
      return emptyPanel(host, question, panel);
    }
    panelHead(host, question);

    /* A row is a PAIR. A card old enough to carry bare numbers instead is read
       as delta-only rather than crashing on `undefined[1]` — published cards
       outlive the code that reads them. */
    const rows = panel.series.map((r) => (Array.isArray(r) ? r : [r, null]));
    const delta = rows.map((r) => isNum(r[0]));
    const prem = rows.map((r) => isNum(r[1]));
    if (delta.filter((v) => v !== null).length < 2) {
      return quietPanel(host, question, "the tape carried no usable cumulative delta");
    }

    /* WHY A ZERO PREMIUM SERIES IS NOT DRAWN. A flat line along the axis is
       indistinguishable from a measured series that happened to end where it
       began, so it reads as a finding. Absence is stated in words instead —
       the same rule that keeps a missing ATR from drawing a zero-width band. */
    const premMeasured = prem.filter((v) => v !== null);
    const premPublished = premMeasured.length >= 2;
    const premMoved = premMeasured.some((v) => v !== 0);
    const drawPrem = premPublished && premMoved;

    /* THE UNITS OF THE TWO TOTALS, AS THE PAYLOAD PUBLISHES THEM — read once,
       because the chart's aria-label (this whole panel, to a screen reader)
       and the sentence under the stat block both need them. */
    const dUnit = typeof panel.netDeltaUnit === "string" ? panel.netDeltaUnit : "";
    const pUnit = typeof panel.netPremiumUnit === "string" ? panel.netPremiumUnit : "";

    /* THROUGH panelWidth, and the floor moves 280 -> 300 with it: two floors
       20px apart are two answers to one question, and 300 is the one the
       render contract's tolerance was computed against (a 320px viewport
       gives a 284.8px host; 300/284.8 = 1.053, inside 15%). */
    const W = panelWidth(host);
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
      class: "fp-line " + polarity(delta[dLast]), d: dOf(dU),
      fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linejoin": "round",
    }));
    if (dLast >= 0) {
      svg.append(svgEl("circle", {
        class: "fp-line-end " + polarity(delta[dLast]),
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
      (dUnit ? ` ${dUnit}` : "") +
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

    /* THE UNITS OF THE TWO FIGURES AT THE HEAD OF THAT BLOCK, printed from
       the payload rather than restated — greekTermPanel states the rule
       below. They belong here because "Net delta 39.0K" beside "Net premium
       $2.3M" is a contract count and a dollar sum sharing one block, and a
       reader who takes the first for dollars has misread the panel by three
       orders of magnitude. A card built before the fields existed says so
       rather than borrowing a unit this renderer would have to assume. */
    if (dUnit || pUnit) {
      host.append(el("p", "fc-note fp-unit",
        "Net delta is in " + (dUnit || "a unit this card does not publish") +
        "; net premium is in " + (pUnit || "a unit this card does not publish") + "."));
    } else {
      /* .flows-empty IS THE CLASS THE SILENCE TAXONOMY KEYS OFF — dashed rule
         and a dagger for "published, and this field is not on it" — so this
         withholding wears the same mark as on every other route. */
      const noUnit = el("p", "flows-empty fp-unit",
        "This card was built before the path panel published the units of its two " +
        "totals, so neither figure above states one. The curve's own legend still " +
        "names the scale each leg was normalised by. They return on the next " +
        "published session.");
      noUnit.setAttribute("data-empty", "unavailable");
      host.append(noUnit);
    }

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
    const question = questionIn || "Who in Congress disclosed a trade in this name, and how old is that information?";
    if (!panel || panel.status !== "ok") return emptyPanel(host, question, panel);
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

  /**
   * One second-order Greek term structure: two legs, never netted.
   *
   * THE SIGN CONVENTION IS THE WHOLE DESIGN. The payload says it outright:
   * the vendor's put leg is dealer-signed against its call leg for gamma and
   * charm, and is NOT for vanna — on the same endpoint, in the same response.
   * So a renderer that draws one bar per expiry has to decide what that bar
   * means, and there is no answer that is right for all three panels. This
   * draws the two legs as two bars and lets them stay two numbers.
   *
   * The consequence is deliberate: nothing on this panel is a direction. The
   * total underneath is `grossAbs`, a SIZE, and it is labelled as one.
   *
   * SIGN LIVES IN POSITION, not in hue. A leg below the zero line is negative,
   * which survives greyscale, a colour-blind reader and a printout — the
   * repository's rule, and the reason the two legs are also told apart by
   * their fill pattern rather than by colour alone.
   */
  function greekTermPanel(host, panel, questionIn, fallbackQuestion) {
    const question = questionIn || fallbackQuestion;
    if (!panel || panel.status !== "ok") return emptyPanel(host, question, panel);
    panelHead(host, question);

    const rows = (Array.isArray(panel.rows) ? panel.rows : [])
      .filter((r) => r && (isNum(r.call) !== null || isNum(r.put) !== null));
    if (!rows.length) {
      return quietPanel(host, question,
        "the expiry ladder came back with no leg on any expiry, so there is nothing " +
        "to lay out along the term.");
    }

    /* ONE SCALE FOR BOTH LEGS AND BOTH SIGNS, taken from the largest
       magnitude present. Scaling each leg to its own maximum would make a
       put leg a thousandth the size of its call leg look identical to one
       matching it, which is the comparison this panel exists for. */
    let peak = 0;
    for (const r of rows) {
      for (const v of [isNum(r.call), isNum(r.put)]) {
        if (v !== null && Math.abs(v) > peak) peak = Math.abs(v);
      }
    }
    if (!(peak > 0)) {
      return quietPanel(host, question,
        "every leg on every expiry measured exactly zero. That is a reading, not an " +
        "absence: the vendor reported the exposure and it was flat.");
    }

    const W = panelWidth(host), H = 150, padT = 8, padB = 26, padX = 4;
    const plotH = H - padT - padB;
    const mid = padT + plotH / 2;
    const slot = (W - padX * 2) / rows.length;
    const barW = Math.max(3, Math.min(18, slot / 3));
    const yOf = (v) => mid - (v / peak) * (plotH / 2);

    const svg = svgEl("svg", {
      class: "gts", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });
    svg.append(svgEl("line", {
      class: "gts-zero", x1: padX, x2: W - padX, y1: mid, y2: mid,
    }));

    rows.forEach((r, i) => {
      const cx = padX + slot * (i + 0.5);
      for (const [leg, v] of [["call", isNum(r.call)], ["put", isNum(r.put)]]) {
        if (v === null) continue;               // absent, and absent draws nothing
        const x = leg === "call" ? cx - barW - 1 : cx + 1;
        const y = v >= 0 ? yOf(v) : mid;
        /* A MEASURED ZERO IS A HAIRLINE, NOT NOTHING. Zero height would be
           indistinguishable from the leg the vendor never sent, and those are
           different facts — the one this file exists to keep apart. */
        const h = Math.max(1, Math.abs(yOf(v) - mid));
        const rect = svgEl("rect", {
          class: "gts-bar is-" + leg + " " + (v > 0 ? "is-pos" : v < 0 ? "is-neg" : "is-flat"),
          x, y, width: barW, height: h,
        });
        rect.append(svgEl("title", {}, [
          leg === "call" ? "Call leg" : "Put leg",
          " on ", r.expiry || "an unnamed expiry",
          isNum(r.dte) === null ? "" : " (" + r.dte + " days out)",
          ": ", compact(v), ". ",
          "This is one leg as the vendor signed it, and it is not added to the other.",
        ].join("")));
        svg.append(rect);
      }
      /* THE EXPIRY LABEL, thinned rather than crowded: a label per bar at
         twelve expiries overlaps into an unreadable smear, and an unreadable
         axis is worse than a sparse one. */
      const every = Math.max(1, Math.ceil(rows.length / 6));
      if (i % every === 0) {
        const lab = svgEl("text", {
          class: "gts-x", x: cx, y: H - padB + 14, "text-anchor": "middle",
        });
        lab.textContent = isNum(r.dte) === null
          ? String(r.expiry || "").slice(5)
          : r.dte + "d";
        svg.append(lab);
      }
    });

    svg.setAttribute("aria-label",
      rows.length + " expiries, call and put legs drawn separately and never added. " +
      "Largest single leg " + compact(peak) + ". " +
      (isNum(panel.grossAbs) === null ? ""
        : "Gross size across the ladder " + compact(panel.grossAbs) + "."));
    host.append(svg);

    /* THE UNIT TRAVELS WITH THE NUMBERS. It is published on the panel — this
       renderer does not restate it, because a second copy of a unit is how a
       page comes to label a per-day figure as a per-vol-point one. */
    host.append(statList([
      ["Expiries", String(rows.length) +
        (isNum(panel.seen) !== null && panel.seen !== rows.length
          ? " of " + panel.seen + " read" : "")],
      ["Largest leg", compact(peak)],
      ["Gross size", compact(panel.grossAbs)],
    ]));

    if (panel.unit) host.append(el("p", "fc-note gts-unit", String(panel.unit)));
    if (panel.signConvention) {
      host.append(el("p", "fc-note gts-sign", String(panel.signConvention)));
    }
    if (isNum(panel.shed) !== null && panel.shed > 0) {
      host.append(el("p", "fc-note gts-shed",
        panel.shed + " further " + (panel.shed === 1 ? "expiry was" : "expiries were") +
        " read and not drawn: the ladder is capped at " + panel.cap + " so the far " +
        "months cannot squeeze the front weeks into a single pixel."));
    }
  }

  P.__register({
    gamma: renderGamma,
    displacement: renderDisplacement,
    surface: renderSurface,
    calendar: renderCalendar,
    pricedMove: renderMove,
    context: renderContext,
    levels: renderLevels,
    path: renderPath,
    congress: renderCongress,
    /* THREE PANELS, ONE DRAWER. They differ only in what the number means,
       and the payload carries that as `unit` — so three copies of this
       function would be three places for the same chart to drift. */
    vanna: (host, panel, card, q) => greekTermPanel(host, panel, q,
      "How much dealer delta moves on a one-point change in implied volatility, by expiry?"),
    charm: (host, panel, card, q) => greekTermPanel(host, panel, q,
      "How fast is dealer delta decaying with time alone, by expiry?"),
    deltaExposure: (host, panel, card, q) => greekTermPanel(host, panel, q,
      "How much directional exposure are dealers carrying, by expiry?"),
  });
})();
