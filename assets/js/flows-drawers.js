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
          atrDist,
          signed,
          statList,
          svgEl,
          symlog,
          vol1 } = P;

  function renderGamma(host, panel, card, questionIn, mount) {

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

    let run = 0;
    const cum = bars.map((b) => (run += b.g));

    const W = panelWidth(host);
    const ROW = bars.length > 34 ? 9 : 12;

    const atSpotW = isNum((card.regime || {}).spotGammaShare);
    const lvW = (card.panels && card.panels.levels && card.panels.levels.status === "ok"
      ? card.panels.levels.levels.find((l) => l.kind === "gamma_flip") : null);
    const subLines = [
      atSpotW === null ? "" : "\u0393 " + Math.abs(atSpotW).toFixed(2) + " of peak",
      lvW ? pct(lvW.distPct) + " \u00b7 " + atrDist(lvW.distAtr) : "",
    ];
    const needRail = Math.max(...subLines.map((t) => t.length)) * AXIS_CH + 16;
    const padT = 16, padB = 30, labelW = 46;
    const railW = Math.max(112, Math.min(148, Math.ceil(needRail)));
    const plotL = labelW, plotR = W - railW;
    const plotW = Math.max(60, plotR - plotL);
    const H = padT + bars.length * ROW + padB;

    const mags = bars.map((b) => b.g);
    const vmax = Math.max(...mags.map(Math.abs), 1);
    const tau = Math.max(quantileAbs(mags, 0.6), vmax / 1000);
    const f = symlog(tau, vmax);
    const fs = bars.map((b) => f(b.g));
    const fMin = Math.min(...fs, 0), fMax = Math.max(...fs, 0);

    const share = Math.abs(fMin) / (Math.abs(fMin) + Math.abs(fMax) || 1);
    const x0 = plotL + plotW * Math.min(0.82, Math.max(0.18, share));
    const negW = x0 - plotL, posW = plotR - x0;

    const rate = Math.min(
      Math.abs(fMin) > 0 ? negW / Math.abs(fMin) : Infinity,
      fMax > 0 ? posW / fMax : Infinity,
    );
    const barRate = Number.isFinite(rate) ? rate : 0;
    const xOf = (v) => x0 + f(v) * barRate;

    const lo = bars[0].k, hi = bars[bars.length - 1].k;
    const yOfIndex = (i) => padT + (bars.length - 1 - i) * ROW + ROW / 2;

    const yOfPrice = (p) => {
      if (!bars.length) return padT;
      if (!(hi > lo)) return padT + (bars.length * ROW) / 2;
      if (p <= lo) return yOfIndex(0);
      if (p >= hi) return yOfIndex(bars.length - 1);

      let i = 1;
      while (i < bars.length - 1 && bars[i].k < p) i++;
      const kLo = bars[i - 1].k, kHi = bars[i].k;
      const span = kHi - kLo;

      const t = span > 0 ? (p - kLo) / span : 0;
      return yOfIndex(i - 1) + t * (yOfIndex(i) - yOfIndex(i - 1));
    };

    const svg = svgEl("svg", {
      class: "gp", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: mountId("gpNeg", mount), width: 4, height: 4, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "gp-negpat",
    });

    pat.append(svgEl("line", { x1: 2, y1: 0, x2: 2, y2: 4, stroke: "currentColor", "stroke-width": 1.8 }));
    defs.append(pat);
    svg.append(defs);

    const marks = new Set();

    const lowest = Math.max(tau / 5, vmax / 1e4);
    for (let e = Math.floor(Math.log10(lowest)); Math.pow(10, e) <= vmax; e++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, e);
        if (v > 0 && v <= vmax && v >= lowest) marks.add(v);
      }
    }

    const sides = [];
    if (fMax > 0) sides.push(1);
    if (fMin < 0) sides.push(-1);

    const decades = [];
    for (const v of Array.from(marks).sort((a, b) => b - a)) {
      for (const sgn of sides) {
        let x = xOf(sgn * v);
        if (x < plotL - 3 || x > plotR + 3) continue;
        x = Math.min(plotR - 2, Math.max(plotL + 2, x));
        if (Math.abs(x - x0) < 18) continue;
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

    svg.append(svgEl("line", { class: "gp-zero", x1: x0, x2: x0, y1: padT - 4, y2: H - padB + 4 }));

    bars.forEach((b, i) => {
      const xg = xOf(b.g);
      const y = yOfIndex(i) - (ROW - 4) / 2;
      const neg = b.g < 0;
      const bx = Math.min(x0, xg);

      const bw = Math.max(Math.abs(xg - x0), 1.5);
      svg.append(svgEl("rect", {
        class: "gp-bar " + (neg ? "is-neg" : "is-pos"),
        x: bx, y, width: bw, height: ROW - 4,
      }));

      if (neg) {
        svg.append(svgEl("rect", {
          class: "gp-barhatch", x: bx, y, width: bw, height: ROW - 4,
          fill: `url(#${mountId("gpNeg", mount)})`,
        }));
      }
    });

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

    const atSpot = isNum((card.regime || {}).spotGammaShare);

    if (spot !== null && spot >= lo && spot <= hi) {
      const y = yOfPrice(spot);
      svg.append(svgEl("line", { class: "gp-spot", x1: plotL, x2: plotR, y1: y, y2: y }));

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
        lv ? pct(lv.distPct) + " · " + atrDist(lv.distAtr) : null, "is-flip"));
    }

    const tickStep = niceStep((hi - lo) / 8);
    if (tickStep > 0) {
      for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi + 1e-9; v += tickStep) {
        const y = yOfPrice(v);
        svg.append(svgEl("line", { class: "gp-ptick", x1: labelW - 4, x2: labelW, y1: y, y2: y }));
      }
    }

    const wanted = [];
    bars.slice().sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 3)
      .forEach((b) => wanted.push({ p: b.k, cls: "" }));
    wanted.push({ p: lo, cls: "" }, { p: hi, cls: "" });

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

    const axisLong = "← short · net dealer Γ (log scale) · long →";
    const axisShort = "← short · Γ, log scale · long →";
    const axisText = axisLong.length * AXIS_CH <= W - 8 ? axisLong : axisShort;
    const axisHalf = (axisText.length * AXIS_CH) / 2;
    const axisX = Math.min(W - 4 - axisHalf, Math.max(4 + axisHalf, x0));
    const axis = svgEl("text", { class: "gp-axis", x: axisX, y: H - 3, "text-anchor": "middle" });
    axis.textContent = axisText;
    svg.append(axis);

    svg.setAttribute("aria-label",
      `Gamma dealers added today, by strike, for ${card.ticker}. ` +
      (spot !== null ? `Spot ${px2(spot)}. ` : "") +
      (flip !== null ? `Gamma flip ${px2(flip)}. ` : "No gamma flip inside the drawn band. ") +
      `${panel.strikes} strikes drawn as ${bars.length} bars.`);

    const regime = card.regime || {};
    const knowsSide = regime.flipSide === "long_below" || regime.flipSide === "short_below";
    const below = regime.flipSide === "long_below" ? "long" : "short";
    const above = below === "long" ? "short" : "long";
    const amplifies = (side) => (side === "short"
      ? "hedging amplifies moves there"
      : "hedging damps them there");
    const sep = isNum(regime.flipSeparation);

    leadReading(host,
      (flip !== null && !knowsSide
        ? `Today's flow ladder changes sign at ${px2(flip)}.`
        : flip !== null
        ? `Today's trading left dealers ${below} gamma immediately below ${px2(flip)} — ${amplifies(below)} — ` +
          `and ${above} immediately above it.`
        : "The gamma added today does not change sign materially inside the drawn band, so no " +
          "crossing is published here.") +
      (flip !== null && knowsSide && sep !== null
        ? ` The thinner of the two sides carries ${(sep * 100).toFixed(0)}% of the ladder's peak ` +
          `exposure, so this is a ${sep < 0.15 ? "weak" : sep < 0.4 ? "moderate" : "strong"} boundary.`
        : ""));

    leadReading(host, atSpot !== null
      ? `Today's added gamma, summed up to spot, is ${Math.abs(atSpot).toFixed(2)} of this ladder's peak ` +
        `and ${atSpot < 0 ? "short" : "long"}, ` +
        `${Math.abs(atSpot) >= 0.5 ? "close to as strong as this ladder gets" : "well inside its range"}; ` +
        "the standing book's net is on the hedging panel."
      : "Where spot sits in the cumulative is not published on this card.");

    if (window.FlowsCursor && bars.length) {
      window.FlowsCursor.attach(svg, {
        name: "Gamma dealers added today, by strike",
        axis: "y",
        band: { x0: plotL, x1: plotR },
        points: bars.map((b, i) => ({
          y: yOfIndex(i),
          label: px2(b.k),
          rows: [
            { k: "Gamma at strike",
              v: (b.g < 0 ? MINUS : "") + compact(Math.abs(b.g)),
              cls: b.g > 0 ? "is-pos" : b.g < 0 ? "is-neg" : "" },
            { k: "Cumulative through",
              v: (cum[i] < 0 ? MINUS : "") + compact(Math.abs(cum[i])),
              cls: cum[i] > 0 ? "is-pos" : cum[i] < 0 ? "is-neg" : "" },
          ],
        })),
      });
    }

    host.append(svg);

    if (typeof panel.reads === "string" && panel.reads) host.append(qualifier(panel.reads));
    if (isNum(regime.crossings) !== null && regime.crossings > 1) {
      host.append(qualifier(`The ladder crosses zero ${regime.crossings} times; this is the ` +
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
        `only, so this is the gamma added today inside that band, not the whole ladder.`));
    }

    appendMethod(host, [

      el("p", "fc-note",
        "The gamma axis is LOGARITHMIC outside a narrow band around zero, so a bar twice as " +
        "long is nowhere near twice the gamma: read magnitude off the labelled ticks, which " +
        "are round numbers on a 1-2-5 ladder, and treat bar length as rank. The widest bar is " +
        money(bars.reduce((a, b) => (Math.abs(b.g) > Math.abs(a) ? b.g : a), 0)).replace("$", "") +
        " Γ."),

      el("p", "fc-note",
        "The cumulative curve is normalised separately from the bars — only its ZERO CROSSING " +
        "is comparable to them, which is the flip. Read the curve for shape, not height. The " +
        "at-spot reading is a share of this ladder's peak rather than a dollar figure, which " +
        "is what makes it comparable across names. Distances are in ATR(14)." +
        (panel.bucketed ? ` ${panel.strikes} strikes are aggregated into ${bars.length} bars.` : "")),
    ], "How this profile was drawn");
  }

  function renderDisplacement(host, panel, card, questionIn) {
    const question = questionIn || "Is today's flow building dealer gamma where the book already is, or somewhere else?";
    if (!panel || panel.status !== "ok") return emptyPanel(host, question, panel);
    panelHead(host, question);

    const oi = isNum(panel.oiCentroid), vol = isNum(panel.volCentroid), spot = isNum(panel.spot);
    if (oi === null || vol === null) return quietPanel(host, question, "no centroid could be measured");

    const points = [oi, vol, spot].filter((v) => v !== null);
    let lo = Math.min(...points), hi = Math.max(...points);

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

    const gapAtr = isNum(panel.gapAtr);
    const cap = svgEl("text", { class: "bd-axis-lab", x: W / 2, y: H - 4, "text-anchor": "middle" });
    cap.textContent = gapAtr === null ? "gap " + px2(panel.gapPx) : "gap " + atrDist(gapAtr);
    svg.append(cap);
    const reading = gapAtr === null
      ? "The gap is " + px2(panel.gapPx) + ", with no ATR to state it in, so there is no normalised reading."
      : "New gamma is building " + (vol >= oi ? "ABOVE" : "BELOW") + " the standing book, " +
        atrDist(gapAtr) + " away from it.";

    svg.setAttribute("aria-label",
      `The standing gamma book is centred at ${px2(oi)} and today's traded gamma at ${px2(vol)}` +
      (spot !== null ? `, with spot at ${px2(spot)}` : "") +
      (gapAtr === null ? "." : `, a gap of ${gapAtr.toFixed(2)} ATR.`));
    host.append(svg);

    const gapRow = { k: "Gap", v: gapAtr === null ? px2(panel.gapPx) : atrDist(gapAtr), cls: "" };
    const sideRow = { k: "New gamma", v: vol >= oi ? "above the book" : "below the book", cls: "" };
    const marks = [
      { at: oi, label: "standing book", rows: [{ k: "Centroid", v: px2(oi), cls: "" }, gapRow, sideRow] },
      { at: vol, label: "today's flow", rows: [{ k: "Centroid", v: px2(vol), cls: "" }, gapRow, sideRow] },
    ];
    if (spot !== null) marks.push({ at: spot, label: "spot", rows: [{ k: "Last", v: px2(spot), cls: "" }] });

    marks.sort((a, b) => a.at - b.at);

    if (window.FlowsCursor && marks.length) {
      window.FlowsCursor.attach(svg, {
        name: "Gamma centroid displacement: the standing book against today's flow",
        band: { y0: 30, y1: 62 },
        points: marks.map((m) => ({ x: xOf(m.at), label: m.label, rows: m.rows })),
      });
    }

    host.append(el("p", "fc-reading", reading));

    appendMethod(host, [el("p", "fc-note",
      "Open interest is the book that already exists; today's volume is what was " +
      "added to it. Comparing them as DISTRIBUTIONS rather than as totals — the gap " +
      "between their gamma-weighted centroids — is what turns a static regime reading " +
      "into a statement that the regime is moving, and which way. The gap is measured " +
      "in ATR so it compares across names: half a point means one thing in a $9 stock " +
      "and another in a $900 one. This is descriptive and does not enter the score: " +
      "both centroids weigh calls and puts by magnitude, so buying and selling at the " +
      "same strikes move the gap alike, and a reading that cannot tell who initiated " +
      "cannot vote on a direction until it is signed and its per-session IC is measured.")],
      "How this gap is measured");
  }

  const RAMP_STEPS = 5;
  const RAMP_OPACITY = [0.24, 0.43, 0.62, 0.81, 1];

  const RAMP_FACTORS = [1.5, 2, 3, 5, 10];

  function surfaceRamp(mags, cap) {
    if (!mags.length || !(cap > 0)) return null;
    const at = (p) => mags[Math.min(mags.length - 1, Math.max(0, Math.round(p * (mags.length - 1))))];
    const top = Math.min(cap, at(0.98));
    if (!(top > 0)) return null;

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

    const labelW = 54, padT = 30, padB = 42, padR = 10;
    const plotL = labelW;
    const plotW = Math.max(60, W - labelW - padR);
    const colW = plotW / expiries.length;

    const rowH = Math.max(7, Math.min(18, 320 / strikes.length));
    const H = padT + strikes.length * rowH + padB;

    const svg = svgEl("svg", {
      class: "gs", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: mountId("gsNeg", mount), width: 5, height: 5, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "gs-negpat",
    });
    pat.append(svgEl("line", { x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: "currentColor", "stroke-width": 1.6 }));
    defs.append(pat);
    svg.append(defs);

    const yOfRow = (i) => padT + (strikes.length - 1 - i) * rowH;

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

          svg.append(svgEl("rect", {
            class: "gs-void", x, y, width: cellW, height: cellH,
          }));
          return;
        }
        if (v === 0) {

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

          "fill-opacity": RAMP_OPACITY[band].toFixed(3),
        });
        svg.append(cell);
        if (neg && rowH >= 9 && colW >= 9) {
          svg.append(svgEl("rect", {
            class: "gs-hatch", x, y, width: cellW, height: cellH,
            fill: `url(#${mountId("gsNeg", mount)})`,
          }));
        }

        if (Math.abs(v) > scaleCap) {

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

    const lo = strikes[0], hi = strikes[strikes.length - 1];
    const s = isNum(spot);
    if (s !== null && strikes.length > 1 && s >= lo && s <= hi) {
      const t = (s - lo) / (hi - lo);
      const y = padT + (1 - t) * (strikes.length - 1) * rowH + rowH / 2;
      svg.append(svgEl("line", { class: "gs-spot", x1: plotL, x2: plotL + plotW, y1: y, y2: y }));
    }

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

    svg.setAttribute("aria-label",
      `Dealer gamma by strike and expiry` + (card && card.ticker ? ` for ${card.ticker}` : "") + `. ` +
      `${strikes.length} strikes from ${px2(lo)} to ${px2(hi)} across ${expiries.length} expiries ` +
      `from ${expiries[0]} to ${expiries[expiries.length - 1]}. ` +
      (s !== null ? `Spot ${px2(s)}. ` : "") +
      (callWall ? `Call wall ${px2(callWall.strike)}. ` : "") +
      (putWall ? `Put wall ${px2(putWall.strike)}. ` : "") +
      `Darker cells carry more gamma; hatched cells are short gamma.`);

    host.append(svg);

    if (window.FlowsCursor && expiries.length) {
      const cellRead = (v) => (v === null ? DASH
        : v === 0 ? compact(v)
        : compact(Math.abs(v)) + (v < 0 ? " short" : " long"));

      const cellCls = (v) => (v === null ? "" : v < 0 ? "is-neg" : v > 0 ? "is-pos" : "");
      const levels = [];
      const claim = (i, name) => {
        if (i < 0 || i >= strikes.length) return;
        const had = levels.find((lv) => lv.i === i);
        if (had) had.names.push(name); else levels.push({ i, names: [name] });
      };
      claim(spotRow, "Spot row");
      claim(callRow, "Call wall");
      claim(putRow, "Put wall");
      window.FlowsCursor.attach(svg, {
        name: "Dealer gamma by strike and expiry" +
          (card && card.ticker ? " for " + card.ticker : ""),
        band: { y0: padT, y1: padT + strikes.length * rowH },
        points: expiries.map((e, j) => {

          let top = null, measured = 0;
          for (let i = 0; i < strikes.length; i++) {
            const v = grid[i][j];
            if (v === null) continue;
            measured++;
            if (v === 0) continue;
            if (top === null || Math.abs(v) > Math.abs(top.v)) top = { v, i };
          }
          const rows = levels.map((lv) => {
            const v = grid[lv.i][j];
            const names = top !== null && top.i === lv.i
              ? lv.names.concat(["Densest"]) : lv.names;
            return { k: names.join(" · ") + " " + px2(strikes[lv.i]), v: cellRead(v), cls: cellCls(v) };
          });
          if (top === null || !levels.some((lv) => lv.i === top.i)) {
            rows.push({
              k: top === null ? "Densest" : "Densest " + px2(strikes[top.i]),
              v: top === null ? (measured ? compact(0) : DASH) : cellRead(top.v),
              cls: top === null ? "" : cellCls(top.v),
            });
          }
          return {
            x: plotL + j * colW + cellW / 2,

            label: String(e),
            rows,
          };
        }),
      });
    }

    const pairs = [];
    if (s !== null) pairs.push(["Spot", px2(s)]);
    if (callWall) pairs.push(["Call wall", px2(callWall.strike)]);
    if (putWall) pairs.push(["Put wall", px2(putWall.strike)]);

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

    if (ramp) {
      notes.push("Shading steps by a factor of " + (ramp.factor % 1 === 0 ? ramp.factor : ramp.factor.toFixed(1)) +
        " from " + compact(ramp.floor) + " up to " + compact(ramp.top) + ", darker for more gamma");
    } else {

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

    const windowed = [];
    if (panel.expiriesShown < panel.expiriesTotal) {
      windowed.push(panel.expiriesShown + " of " + panel.expiriesTotal + " expiries");
    }
    if (panel.strikesShown < panel.strikesTotal) {
      windowed.push(panel.strikesShown + " of " + panel.strikesTotal + " strikes");
    }
    if (windowed.length) notes.push("Showing " + windowed.join(" and "));

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

    const W = panelWidth(host), ROW = 26, padL = 116, padR = 56, padT = 8;
    const H = padT + rows.length * ROW + 26;
    const plotW = W - padL - padR;
    const svg = svgEl("svg", {
      class: "gc", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

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

    const halfX = padL + plotW * 0.5;
    svg.append(svgEl("line", { class: "gc-half", x1: halfX, x2: halfX, y1: padT, y2: H - 22 }));
    const ht = svgEl("text", { class: "gc-axis", x: halfX, y: H - 8, "text-anchor": "middle" });
    ht.textContent = "half the book";
    svg.append(ht);

    svg.setAttribute("aria-label",
      `Gamma roll-off by expiry. ` + rows.map((r) =>
        `${r.expiry}: ${(r.share * 100).toFixed(0)} percent`).join(", ") + ".");
    host.append(svg);

    if (window.FlowsCursor && rows.length) {
      window.FlowsCursor.attach(svg, {
        name: "Gamma roll-off by expiry",
        axis: "y",
        band: { x0: padL, x1: padL + plotW },
        points: rows.map((r, i) => ({
          y: padT + i * ROW + 4 + (ROW - 10) / 2,

          label: r.expiry + (r.expiry === panel.halfLifeExpiry ? " — half the book" : ""),
          rows: [
            { k: "Expiring here",
              v: isNum(r.share) === null ? DASH : (r.share * 100).toFixed(0) + "%" },
            { k: "Cumulative by then",
              v: isNum(r.cumShare) === null ? DASH : (r.cumShare * 100).toFixed(0) + "%" },
            { k: "Days out", v: isNum(r.days) === null ? DASH : r.days + "d" },
          ],
        })),
      });
    }

    host.append(statList([
      ["Front expiry", rows[0].expiry],
      ["Front share", (rows[0].share * 100).toFixed(0) + "%"],
      ["Half-life", panel.halfLifeExpiry || DASH],
      ["Mean life", fmtOr(panel.meanLifeDays, (n) => n.toFixed(0) + " days")],
      ["Expiries", String(panel.expiries)],
    ]));

    appendMethod(host, [el("p", "fc-note",
      "Gross gamma rolling off, so the two legs are summed in magnitude: put gamma " +
      "arrives already dealer-signed, and a front week of one billion call against " +
      "minus 999 million put is two billion of gamma about to expire, not the one " +
      "million their signed sum leaves behind. " +
      "Mean life is the gamma-weighted average days to expiry — unlike the front " +
      "expiry's share it does not change when the chain is cut differently, so it " +
      "is the number that compares across names.")],
      "How this roll-off was summed");
  }

  const IV_RANK_TERM = "IV rank, percentile of its own year";

  const RICHNESS_LINE = 0.1;

  function richnessBand(panel) {
    const stored = typeof panel.richness === "string" && panel.richness ? panel.richness : null;
    if (stored !== null && stored !== "rich" && stored !== "cheap" && stored !== "fair") return stored;
    const vrp = isNum(panel.vrp);
    const rv = isNum(panel.rv30);
    if (vrp === null || rv === null || !(rv > 0)) return stored;
    const rel = vrp / rv;
    return rel >= RICHNESS_LINE ? "rich" : rel <= -RICHNESS_LINE ? "cheap" : "fair";
  }

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

    const lowPx = isNum(panel.impliedLow), highPx = isNum(panel.impliedHigh);
    const downLog = imp !== null && lowPx !== null && lowPx > 0 && spot > 0 ? Math.log(spot / lowPx) : imp;
    const upLog = imp !== null && highPx !== null && spot > 0 ? Math.log(highPx / spot) : imp;
    const widest = Math.max(imp ?? 0, downLog ?? 0, upLog ?? 0, real ?? 0, quoted ?? 0);
    if (!(widest > 0) || spot === null) {
      return quietPanel(host, question, "no band could be measured");
    }

    const W = panelWidth(host), H = 118, padX = 16;
    const plotW = W - padX * 2;
    const mid = padX + plotW / 2;

    const halfOf = (m) => (m / widest) * (plotW * 0.44);

    const svg = svgEl("svg", {
      class: "pm", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    if (imp !== null) {
      const hL = halfOf(downLog), hH = halfOf(upLog);
      svg.append(svgEl("rect", { class: "pm-band is-implied", x: mid - hL, y: 34, width: hL + hH, height: 30, rx: 3 }));
      for (const [x, txt] of [[mid - hL, px2(panel.impliedLow)], [mid + hH, px2(panel.impliedHigh)]]) {
        const t = svgEl("text", { class: "pm-lab", x, y: 26, "text-anchor": "middle" });
        t.textContent = txt;
        svg.append(t);
      }
    }

    if (real !== null) {
      const h = halfOf(real);
      svg.append(svgEl("rect", { class: "pm-band is-realized", x: mid - h, y: 41, width: h * 2, height: 16, rx: 2 }));
    }

    if (quoted !== null && panel.horizonRule) {
      const h = halfOf(quoted);
      for (const x of [mid - h, mid + h]) {
        svg.append(svgEl("line", { class: "pm-quote", x1: x, x2: x, y1: 30, y2: 68 }));
      }

      const t = svgEl("text", { class: "pm-quotelab", x: W - padX, y: 78, "text-anchor": "end" });
      t.textContent = "vendor quote, to " + panel.horizonRule;
      svg.append(t);
    }

    svg.append(svgEl("line", { class: "pm-spot", x1: mid, x2: mid, y1: 28, y2: 70 }));
    const st = svgEl("text", { class: "pm-lab is-spot", x: mid, y: 26, "text-anchor": "middle" });
    st.textContent = px2(spot);
    svg.append(st);

    const capClauses = imp !== null
      ? [`±${(imp * 100).toFixed(1)}% priced over ${sessions} sessions`]
        .concat(real !== null ? [`±${(real * 100).toFixed(1)}% delivered`] : [])
      : [`±${(quoted * 100).toFixed(1)}% quoted to ${panel.horizonRule || "the vendor's own expiry"}`];
    const cap = svgEl("text", { class: "pm-axis", x: mid, y: H - 8, "text-anchor": "middle" });
    cap.textContent = capClauses.join("  ·  ");

    svg.dataset.fxRead = "face";
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

      ["Realized vol, 21 sessions", vol1(panel.rv30)],
      ["Variance risk premium",
        fmtOr(panel.vrp, (n) => signed(n, (a) => (a * 100).toFixed(1) + " vol pts"))],
      ["Band", richnessBand(panel) || DASH],
      ivRankStat(panel),
      ["IV, past week",
        fmtOr(panel.ivMomentum, (n) => signed(n, (a) => (a * 100).toFixed(1) + " vol pts"))],
    ]));

    host.append(qualifier("THIS IS A PRICE, NOT A FORECAST."));
    appendMethod(host, [
      ...(typeof panel.bandNote === "string" && panel.bandNote ? [el("p", "fc-note", panel.bandNote)] : []),
      el("p", "fc-note",
      `The wide band is 30-day implied volatility ` +
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
      `panel's and not comparable across the board.`)],
      "How these bands were built");
    host.append(qualifier(
      "NOT CLAIMED: a direction, a probability, a point target, or that the stock will " +
      "stay inside any of these bands."));
  }

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

        role: "img", preserveAspectRatio: "xMidYMid meet",
      });

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

      if (window.FlowsCursor && closes.length) {
        const dayOf = Array.isArray(panel.closeDates) ? panel.closeDates : [];
        const base = isNum(closes[0]);
        window.FlowsCursor.attach(svg, {
          name: (card && card.ticker ? card.ticker + " " : "") + "daily closes",
          band: { y0: pad, y1: H - pad },
          points: closes.map((c, i) => {
            const v = isNum(c);

            const rel = v === null || base === null || !(base > 0) ? null : v / base - 1;
            return {
              x: xOf(i),
              label: dayOf[i] || `Session ${i + 1} of ${closes.length}`,
              rows: [
                { k: "Close", v: px2(c) },
                {
                  k: "From first close", v: pct1(rel),
                  cls: rel === null ? "" : rel > 0 ? "is-pos" : rel < 0 ? "is-neg" : "",
                },
              ],
            };
          }),
        });
      }
    }

    host.append(statList([
      ["Today", pct(panel.changePct)],
      ["5 sessions", pct1(panel.r5)],
      ["21 sessions", pct1(panel.r21)],
      ["42 sessions", pct1(panel.r42)],
      ["52-week position",
        fmtOr(panel.week52Pos, (n) => Math.round(n * 100) + "% of range")],
    ]));

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

      d.classList.add(l.distPct >= 0 ? "is-above" : "is-below");
      tr.append(d);
      tr.append(el("td", "c-num", atrDist(l.distAtr)));
      tb.append(tr);
    }
    table.append(tb);

    const wrap = el("div", "fc-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Key levels");
    wrap.append(table);
    host.append(wrap);

    const note = el("p", "fc-note");
    note.textContent = isNum(panel.atr) === null
      ? "ATR(14) was unavailable, so normalised distances are not shown — a distance in ATR units with no ATR is no number, not a small one."
      : `Distances are from spot ${px2(panel.spot)}. One ATR is ATR(14) = ${px2(panel.atr)}, which is what makes a move comparable between a quiet name and a volatile one.`;
    host.append(note);
  }

  function renderPath(host, panel, card, questionIn) {
    const question = questionIn || "Did this arrive as one print, or as a bid that persisted all session?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.series) || panel.series.length < 2) {
      return emptyPanel(host, question, panel);
    }
    panelHead(host, question);

    const whole = Array.isArray(panel.__whole) ? panel.__whole : panel.series;
    const perMin = isNum(panel.minutes) && whole.length > 1
      ? panel.minutes / whole.length : null;
    if (perMin > 0) {
      const wins = [["Session", whole.length]]
        .concat([["2h", 120], ["1h", 60], ["30m", 30]]
          .map(([lab, mins]) => [lab, Math.round(mins / perMin)]))
        .filter(([, n], i) => i === 0 || (n >= 2 && n < whole.length));
      if (wins.length > 1) {
        const bar = el("div", "fp-win");
        bar.setAttribute("role", "group");
        bar.setAttribute("aria-label", "Window this path is drawn over");
        const active = isNum(panel.__win) || whole.length;
        for (const [lab, n] of wins) {
          const b = el("button", "fp-win-b", lab);
          b.type = "button";
          if (n === active) b.setAttribute("aria-current", "true");
          b.addEventListener("click", () => {
            host.replaceChildren();
            renderPath(host, { ...panel, series: whole.slice(-n), __win: n, __whole: whole },
              card, questionIn);
          });
          bar.append(b);
        }
        host.append(bar);
      }
    }

    const rows = panel.series.map((r) => (Array.isArray(r) ? r : [r, null]));
    const delta = rows.map((r) => isNum(r[0]));
    const prem = rows.map((r) => isNum(r[1]));
    if (delta.filter((v) => v !== null).length < 2) {
      return quietPanel(host, question, "the tape carried no usable cumulative delta");
    }

    const premMeasured = prem.filter((v) => v !== null);
    const premPublished = premMeasured.length >= 2;
    const premMoved = premMeasured.some((v) => v !== 0);
    const drawPrem = premPublished && premMoved;

    const dUnit = typeof panel.netDeltaUnit === "string" ? panel.netDeltaUnit : "";
    const pUnit = typeof panel.netPremiumUnit === "string" ? panel.netPremiumUnit : "";

    const W = panelWidth(host);
    const H = 132, pad = 10;
    const x = (i) => pad + (i / (rows.length - 1)) * (W - 2 * pad);

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

    if (window.FlowsCursor && rows.length) {
      const off = whole.length - rows.length;
      const sessionMin = perMin > 0 ? Math.round(whole.length * perMin) : null;
      const when = (i) => (sessionMin === null
        ? `Point ${i + 1} of ${rows.length}`
        : `Minute ${Math.round((off + i + 1) * perMin)} of ${sessionMin}`);

      const side = (v) => (v === null ? "" : v > 0 ? "is-pos" : v < 0 ? "is-neg" : "");
      window.FlowsCursor.attach(svg, {
        name: "Session path, cumulative net delta" +
          (drawPrem ? " and cumulative net premium" : ""),
        band: { y0: pad, y1: H - pad },
        points: delta.map((d, i) => {
          const p = prem[i];
          const out = [{ k: "Net delta", cls: side(d),
            v: d === null ? DASH : compact(d) + " contracts" }];
          if (drawPrem) {
            out.push({ k: "Net premium", cls: side(p),
              v: p === null ? DASH : money(p) });
          }
          return { x: x(i), label: when(i), rows: out };
        }),
      });
    }

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

    if (dUnit || pUnit) {
      host.append(el("p", "fc-note fp-unit",
        "Net delta is in " + (dUnit || "a unit this card does not publish") +
        "; net premium is in " + (pUnit || "a unit this card does not publish") + "."));
    } else {

      const noUnit = el("p", "flows-empty fp-unit",
        "This card was built before the path panel published the units of its two " +
        "totals, so neither figure above states one. The curve's own legend still " +
        "names the scale each leg was normalised by. They return on the next " +
        "published session.");
      noUnit.setAttribute("data-empty", "unavailable");
      host.append(noUnit);
    }

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
        if (v === null) continue;
        const x = leg === "call" ? cx - barW - 1 : cx + 1;
        const y = v >= 0 ? yOf(v) : mid;

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

    if (window.FlowsCursor && rows.length) {
      window.FlowsCursor.attach(svg, {
        name: "Open-interest exposure along the term, legs as the vendor signs them",
        band: { y0: padT, y1: padT + plotH },
        points: rows.map((r, i) => {
          const leg = (v) => (v === null
            ? { v: "not reported", cls: "" }
            : { v: compact(v), cls: v > 0 ? "is-pos" : v < 0 ? "is-neg" : "" });
          const c = leg(isNum(r.call)), p2 = leg(isNum(r.put));
          return {
            x: padX + slot * (i + 0.5),
            label: (r.expiry || "an unnamed expiry") +
              (isNum(r.dte) === null ? "" : " \u00b7 " + r.dte + "d out"),
            rows: [
              { k: "Call leg", v: c.v, cls: c.cls },
              { k: "Put leg", v: p2.v, cls: p2.cls },
              { k: "Dealer net" + (panel.dealerRule ? " (" + panel.dealerRule + ")" : ""),
                v: isNum(r.dealer) === null ? "not netted" : compact(r.dealer), cls: polarity(r.dealer) },
            ],
          };
        }),
      });
    }

    host.append(svg);

    const netted = rows.filter((r) => isNum(r.dealer) !== null);
    const dealerSum = netted.reduce((a, r) => a + r.dealer, 0);
    host.append(statList([
      ["Expiries", String(rows.length) +
        (isNum(panel.seen) !== null && panel.seen !== rows.length
          ? " of " + panel.seen + " read" : "")],
      ["Largest leg", compact(peak)],
      ["Gross size", compact(panel.grossAbs)],
      ["Dealer net, drawn" + (panel.dealerRule ? " (" + panel.dealerRule + ")" : ""),
        netted.length ? compact(dealerSum) : DASH, netted.length ? polarity(dealerSum) : "is-null",
        netted.length ? null : "unavailable", netted.length ? null : "no expiry carries both legs"],
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

  const SILENCE_WORD = {
    pending: "Pending", unreadable: "Unreadable", quiet: "Quiet", unavailable: "Unavailable",
  };

  function hedgeWord(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    return n === 0 ? "no trade" : (n > 0 ? "dealers buy " : "dealers sell ") + money(Math.abs(n));
  }

  function shareOfDay(v) {
    const n = isNum(v);
    return n === null ? "" : " · " + (Math.abs(n) * 100).toFixed(2) + "% of a day";
  }

  function renderVariation(host, panel, card, questionIn) {
    const question = questionIn ||
      "Over the next session, how much stock would dealers trade to stay hedged, and how much comes from spot, volatility and time?";
    if (!panel || panel.status !== "ok") return emptyPanel(host, question, panel);
    panelHead(host, question);

    const ch = panel.channels || {};
    const inputs = panel.inputs || {};
    const silences = Array.isArray(panel.silences) ? panel.silences : [];
    const silenceOf = (channel) => silences.find((s) => s && s.channel === channel) || null;

    const bars = [];
    if (ch.gamma && isNum(ch.gamma.perSigma) !== null) {
      bars.push({ key: "gamma", label: ch.gamma.source === "book" ? "Spot, +1 SD" : "Spot, +1 SD (added today only)",
        flow: -ch.gamma.perSigma, pctAdv: isNum(ch.gamma.pctAdv) === null ? null : -ch.gamma.pctAdv, hatched: false });
    }
    if (ch.vanna && isNum(ch.vanna.perSigma) !== null) {
      bars.push({ key: "vanna", label: "Volatility, +1 SD", flow: -ch.vanna.perSigma,
        pctAdv: isNum(ch.vanna.pctAdvPerSigma) === null ? null : -ch.vanna.pctAdvPerSigma, hatched: false });
    } else if (ch.vanna && isNum(ch.vanna.perPoint) !== null) {
      bars.push({ key: "vanna", label: "Volatility, +1 point", flow: -ch.vanna.perPoint,
        pctAdv: isNum(ch.vanna.pctAdvPerPoint) === null ? null : -ch.vanna.pctAdvPerPoint, hatched: true });
    }
    if (ch.charm && isNum(ch.charm.hedge) !== null) {
      bars.push({ key: "charm", label: "Time, one session", flow: ch.charm.hedge,
        pctAdv: isNum(ch.charm.pctAdv) === null ? null : -ch.charm.pctAdv, hatched: false });
    }

    if (bars.length) {
      const W = panelWidth(host), ROW = 30, padL = 150, padR = 12, padT = 6;
      const H = padT + bars.length * ROW + 8;
      const mid = padL + (W - padL - padR) / 2;
      const half = (W - padL - padR) / 2;
      const peak = bars.reduce((m, b) => Math.max(m, Math.abs(b.flow)), 0) || 1;
      const svg = svgEl("svg", {
        class: "fv-bars", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
        role: "img", preserveAspectRatio: "xMidYMid meet",
      });
      svg.append(svgEl("line", { class: "gts-zero", x1: mid, x2: mid, y1: padT, y2: H - 4 }));
      bars.forEach((b, i) => {
        const y = padT + i * ROW;
        const w = Math.max(1, Math.abs(b.flow) / peak * half);
        const x = b.flow < 0 ? mid - w : mid;
        const rect = svgEl("rect", {
          class: "fv-bar gp-bar " + polarity(b.flow) + (b.hatched ? " is-hatched" : ""),
          x, y: y + 6, width: w, height: ROW - 14,
        });
        rect.append(svgEl("title", {}));
        rect.firstChild.textContent = b.label + ": " + hedgeWord(b.flow) + shareOfDay(b.pctAdv) +
          (b.hatched ? ". Per vol point: the size of a typical vol move is silent on this card." : ".");
        svg.append(rect);
        const lab = svgEl("text", { class: "gc-exp", x: padL - 8, y: y + ROW / 2 + 3, "text-anchor": "end" });
        lab.textContent = b.label;
        svg.append(lab);
      });
      svg.setAttribute("aria-label", "Hedge flow by source, dealers buying to the right and selling to the left. " +
        bars.map((b) => b.label + ": " + hedgeWord(b.flow) + shareOfDay(b.pctAdv)).join("; ") + ".");
      host.append(svg);
      host.append(statList(bars.map((b) => [b.label, hedgeWord(b.flow) + shareOfDay(b.pctAdv),
        polarity(b.flow)])));
    }

    const v = panel.variance;
    if (v && v.shares) {
      const sh = v.shares;
      const parts = [["gamma", "Spot", sh.gamma], ["vanna", "Volatility", sh.vanna], ["cross", "Co-movement", sh.cross]];
      const strip = el("div", "fv-strip");
      strip.setAttribute("role", "img");
      const positive = parts.reduce((a, p) => a + (isNum(p[2]) !== null && p[2] > 0 ? p[2] : 0), 0) || 1;
      for (const [key, label, value] of parts) {
        const n = isNum(value);
        if (n === null || !(n > 0)) continue;
        const seg = el("span", "fv-seg is-" + key);
        seg.style.flexGrow = String(n / positive);
        seg.title = label + " " + Math.round(n * 100) + "% of the variance";
        strip.append(seg);
      }
      strip.setAttribute("aria-label", parts.map(([, label, value]) =>
        label + " " + (isNum(value) === null ? "silent" : Math.round(value * 100) + "%")).join(", ") + " of the variance.");
      host.append(strip);
      host.append(statList(parts.map(([key, label, value]) => {
        const n = isNum(value);
        const s = n === null ? silenceOf(key === "gamma" ? "variance" : "vannaSize") : null;
        return [label + " share", n === null ? DASH : signed(n, (a) => Math.round(a * 100) + "%"),
          n === null ? "is-null" : null, n === null ? (s ? s.kind : "unavailable") : null,
          n === null && s ? s.reason : null];
      })));
      if (isNum(v.driftInSd) !== null) {
        host.append(el("p", "fc-note fv-drift", "The time drift is " + Math.abs(v.driftInSd).toFixed(1) +
          " standard deviations of the random part (" + (v.driftInSd < 0 ? "dealers buy" : v.driftInSd > 0 ? "dealers sell" : "no trade") +
          " as time passes)."));
      }
    }

    const g = panel.grid;
    if (g && Array.isArray(g.rows) && Array.isArray(g.cols) && Array.isArray(g.cells)) {
      const wrap = el("div", "fc-tablewrap");
      const table = el("table", "fc-levels fv-grid");
      table.append(el("caption", null,
        "Dealer hedge flow over the next session, by spot move (rows) and implied-volatility move (columns)"));
      const thead = el("thead");
      const hr = el("tr");
      const corner = el("th", null, "Price / vol");
      corner.scope = "col";
      hr.append(corner);
      for (const col of g.cols) {
        const th = el("th", "c-num", (isNum(col.vol) === null ? DASH : vol1(col.vol)) +
          (col.kV === 0 ? " (now)" : col.kV > 0 ? " (+1 SD)" : " (−1 SD)"));
        th.scope = "col";
        hr.append(th);
      }
      thead.append(hr);
      table.append(thead);
      const tbody = el("tbody");
      g.rows.forEach((r, i) => {
        const tr = el("tr");
        const th = el("th", "c-num", (isNum(r.price) === null ? DASH : px2(r.price)) +
          (r.kS === 0 ? " (spot)" : " (" + (r.kS > 0 ? "+" : "−") + Math.abs(r.kS) + " SD)") +
          (r.linear ? " · linear approximation" : ""));
        th.scope = "row";
        tr.append(th);
        (g.cells[i] || []).forEach((cell) => {
          const td = el("td", "c-num");
          if (!cell || isNum(cell.flow) === null) {
            td.textContent = DASH;
            td.setAttribute("data-empty", "unavailable");
            td.title = g.volSilent || "silent on this card";
          } else {
            td.textContent = signed(cell.flow, (a) => "$" + compact(a)) +
              (isNum(cell.pctAdv) === null ? "" : " · " + signed(cell.pctAdv, (a) => (a * 100).toFixed(2) + "%"));
            td.className = "c-num " + polarity(cell.flow);
          }
          tr.append(td);
        });
        tbody.append(tr);
      });
      table.append(tbody);
      wrap.append(table);
      host.append(wrap);
    }

    if (inputs.rollOff && isNum(inputs.rollOff.dollars) !== null) {
      host.append(el("p", "fc-note fv-rolloff", "Delta held in options that expire before the next session: " +
        money(inputs.rollOff.dollars) + " across " + inputs.rollOff.expiries + " expir" +
        (inputs.rollOff.expiries === 1 ? "y" : "ies") + ". Context, not a flow: options in the money are exercised " +
        "into stock rather than unwound through the market."));
    }

    if (silences.length) {
      const list = el("ul", "fv-silences");
      for (const s of silences) {
        const li = el("li");
        li.setAttribute("data-empty", s.kind || "unavailable");
        li.append(el("strong", null, (SILENCE_WORD[s.kind] || "Unavailable") + " — "));
        li.append(document.createTextNode(String(s.reason || "no reading").replace(/\.+$/, "") + "."));
        list.append(li);
      }
      host.append(list);
    }

    host.append(statList([
      ["Spot sigma, one session", isNum(inputs.sigmaDaily) === null ? DASH
        : (inputs.sigmaDaily * 100).toFixed(2) + "% · $" + fmtOr(inputs.sigmaDollars, (n) => n.toFixed(2)) +
          (inputs.sigmaSource === "garch" ? " (GARCH)" : " (realized)")],
      ["Implied, one session", isNum(inputs.impliedDaily) === null ? DASH : (inputs.impliedDaily * 100).toFixed(2) + "%"],
      ["Vol of vol", isNum(inputs.sigmaV) === null ? DASH : inputs.sigmaV.toFixed(2) + " pts/day, correlation with spot " + fmtOr(inputs.rho, (n) => neg(n.toFixed(2)))],
      ["Typical day", money(inputs.adv)],
      ["Book gamma, per 1%", money(inputs.gammaBook)],
      ["Added today, per 1%", money(inputs.gammaFlow)],
      ["Dealer delta", money(inputs.deltaDollars)],
    ]));

    const c = panel.conventions || {};
    const notes = [];
    notes.push(el("p", "fc-note", "Every figure is " + (c.dealer || "dealer-signed under the vendor's convention") +
      ". Hedge flow is minus the change in dealer option delta: a positive figure means dealers buy stock."));
    if (c.putToDealer) {
      notes.push(el("p", "fc-note", "Put legs enter the dealer net as call + put for gamma and call − put for delta" +
        (c.putToDealer.vanna === null ? "; vanna is not netted this run" : ", vanna") +
        (c.putToDealer.charm === null ? "; charm is not netted this run" : c.putToDealer.charm > 0 ? "; charm as call + put, as the run's probe found it" : " and charm") + "."));
    }
    if (c.kc) {
      notes.push(el("p", "fc-note", "Charm per calendar day is the vendor's field over " + fmtOr(c.kc.value, (n) => n.toFixed(1)) +
        ", a scale measured across " + fmtOr(c.kc.n, (n) => String(n)) + " expiry readings this run (" + (c.kc.status || "unmeasured") + ")."));
    }
    if (c.unit) {
      notes.push(el("p", "fc-note", "Unit family: " + (c.unit.used === "pct$" ? "dollars per 1% move" : "share-delta") +
        (c.unit.source ? " — " + c.unit.source : "") + "."));
    }
    if (c.vannaScale) {
      notes.push(el("p", "fc-note", "Vanna scale against the option chain: " + (c.vannaScale.status || "unmeasured") +
        (isNum(c.vannaScale.ratio) === null ? "" : ", vendor over Black-Scholes " + c.vannaScale.ratio.toFixed(2)) +
        (isNum(c.vannaScale.n) === null ? "" : " across " + c.vannaScale.n + " names") + "."));
    }
    if (c.nets) notes.push(el("p", "fc-note", "Nets summed over " + c.nets + "."));
    for (const text of Object.values(c.statements || {})) {
      if (typeof text === "string" && text) notes.push(el("p", "fc-note", text));
    }
    appendMethod(host, notes, "Conventions and assumptions", true);
  }

  function renderPremiumTrack(host, panel, card, questionIn) {
    const question = questionIn ||
      "How has this name’s net premium moved across sessions?";
    if (!panel || panel.status !== "ok" || !Array.isArray(panel.rows) || panel.rows.length < 2) {
      return emptyPanel(host, question, panel);
    }
    panelHead(host, question);

    const whole = Array.isArray(panel.__whole) ? panel.__whole : panel.rows;
    const wins = [["All", whole.length]]
      .concat([20, 10, 5].map((n) => [n + " sessions", n]))
      .filter(([, n], i) => i === 0 || (n >= 2 && n < whole.length));
    if (wins.length > 1) {
      const bar = el("div", "fp-win");
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Sessions this premium history is drawn over");
      const active = isNum(panel.__win) || whole.length;
      for (const [lab, n] of wins) {
        const b = el("button", "fp-win-b", lab);
        b.type = "button";
        if (n === active) b.setAttribute("aria-current", "true");
        b.addEventListener("click", () => {
          host.replaceChildren();
          renderPremiumTrack(host, { ...panel, rows: whole.slice(-n), __win: n, __whole: whole },
            card, questionIn);
        });
        bar.append(b);
      }
      host.append(bar);
    }

    const rows = panel.rows;
    const vals = rows.map((r) => isNum(r && r.p)).filter((v) => v !== null);
    if (vals.length < 2) {
      return quietPanel(host, question,
        "this window holds fewer than two priced sessions — one reading is a level, " +
        "not a path, and the window picker above can widen it");
    }

    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const span = (hi - lo) || 1;

    const peak = Math.abs(lo) > Math.abs(hi) ? lo : hi;
    const W = panelWidth(host), H = 128;
    const padT = 10, padB = 26, padL = 4, padR = 4;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const yOf = (v) => padT + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / span) * plotH;
    const step = rows.length > 1 ? plotW / rows.length : plotW;
    const barW = Math.max(1.2, Math.min(22, step * 0.7));
    const xOf = (i) => padL + step * (i + 0.5);

    const svg = svgEl("svg", {
      class: "pt-chart", viewBox: "0 0 " + W + " " + H, width: "100%", height: H,
      preserveAspectRatio: "xMidYMid meet", role: "img",
    });
    const zeroY = yOf(0);
    const g = svgEl("g", { class: "pt-bars" });
    for (let i = 0; i < rows.length; i++) {
      const v = isNum(rows[i] && rows[i].p);
      if (v === null) continue;
      const y = yOf(v);
      g.append(svgEl("rect", {
        class: "pt-bar" + (v < 0 ? " is-neg" : v > 0 ? " is-pos" : " is-zero"),
        x: (xOf(i) - barW / 2).toFixed(1), width: barW.toFixed(1),
        y: Math.min(y, zeroY).toFixed(1),

        height: Math.max(0.8, Math.abs(zeroY - y)).toFixed(1),
      }));
    }
    svg.append(g);
    svg.append(svgEl("line", { class: "pt-zero", x1: padL, x2: W - padR, y1: zeroY, y2: zeroY }));

    const ends = [[rows[0], padL + 2, "start"], [rows[rows.length - 1], W - padR - 2, "end"]];
    for (const [r, x, anchor] of ends) {
      if (!r || !r.d) continue;
      const t = svgEl("text", { class: "pt-date", x, y: H - 8, "text-anchor": anchor });
      t.textContent = r.d;
      svg.append(t);
    }

    const gaps = rows.length - vals.length;
    const net = vals.reduce((a, b) => a + b, 0);
    const up = vals.filter((v) => v > 0).length;
    const down = vals.filter((v) => v < 0).length;
    svg.setAttribute("aria-label",
      vals.length + " priced session" + (vals.length === 1 ? "" : "s") +
      " from " + (rows[0] && rows[0].d) + " to " + (rows[rows.length - 1] && rows[rows.length - 1].d) +
      ", net " + money(net) + " across the window, " + up + " session" + (up === 1 ? "" : "s") +
      " call-side and " + down + " put-side." +
      (gaps ? " " + gaps + " session" + (gaps === 1 ? "" : "s") +
        " in that window carry no archived premium and are drawn as no bar at all." : ""));
    host.append(svg);

    if (window.FlowsCursor && rows.length) {
      window.FlowsCursor.attach(svg, {
        name: "Net premium by session" + (card && card.ticker ? " for " + card.ticker : ""),
        band: { y0: padT, y1: padT + plotH },
        points: rows.map((r, i) => {
          const v = isNum(r && r.p);
          return {
            x: xOf(i),
            label: (r && r.d) || DASH,
            rows: [
              { k: "Net premium", v: v === null ? DASH : signed(v, (a) => "$" + compact(a)),
                cls: v === null ? "" : v > 0 ? "is-pos" : v < 0 ? "is-neg" : "" },
              { k: "Side", v: v === null ? "no archived premium"
                : v > 0 ? "call-side" : v < 0 ? "put-side" : "priced flat" },
            ],
          };
        }),
      });
    }

    leadReading(host,
      "Across " + vals.length + " priced session" + (vals.length === 1 ? "" : "s") +
      " this name's net premium sums to " + signed(net, (a) => "$" + compact(a)) +
      ", " + up + " session" + (up === 1 ? "" : "s") + " call-side against " +
      down + " put-side.");

    host.append(statList([
      ["Net, window", signed(net, (a) => "$" + compact(a))],
      ["Largest session", signed(peak, (a) => "$" + compact(a))],
      ["Call-side / put-side", up + " / " + down],
      ["Priced sessions", vals.length + " of " + rows.length],
    ]));

    host.append(el("p", "fc-note is-qualifier",
      "Each bar is one session's net premium — call premium minus put premium, in " +
      "dollars, as the board published it for that session. The sign is the reading; " +
      "the bars are drawn against a common scale so the two sides are comparable " +
      "by height." +
      (gaps
        ? " " + gaps + " session" + (gaps === 1 ? " in" : "s in") + " this window carr" +
          (gaps === 1 ? "ies" : "y") + " no archived premium and are drawn as no bar at " +
          "all — that is a session this name was not priced in, which is not a session " +
          "it was priced flat in."
        : "")));

    appendMethod(host, [
      "The history is read out of the dated archive: the session's own score key where " +
      "one was written, and the archived boards for every session before that. Both " +
      "carry the same figure the board published for that session, so this window is as " +
      "long as the archive is, not as long as the field is old.",
      "A session reconstructed from the boards alone covers only the names that MADE a " +
      "board that day, so a gap in the older half of a window is more often a name " +
      "that missed the board than a name nobody priced. That sparseness is a fact " +
      "about the archive and not about this name's flow.",
    ], "Where this history comes from", true);
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
    premiumTrack: renderPremiumTrack,
    congress: renderCongress,
    variation: renderVariation,

    vanna: (host, panel, card, q) => greekTermPanel(host, panel, q,
      "How does open-interest delta move with implied volatility, by expiry?"),
    charm: (host, panel, card, q) => greekTermPanel(host, panel, q,
      "How fast does open-interest delta decay with time alone, by expiry?"),
    deltaExposure: (host, panel, card, q) => greekTermPanel(host, panel, q,
      "How much delta does open interest carry along the term, each leg as the vendor signs it?"),
  });
})();
