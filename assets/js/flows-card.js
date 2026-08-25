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
  let inflight = null;

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
  const pct = (v) => (isNum(v) === null ? DASH : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%");
  const sigma = (v) => (isNum(v) === null ? DASH : (v >= 0 ? "+" : "") + v.toFixed(2) + "σ");
  const px2 = (v) => (isNum(v) === null ? DASH : v.toFixed(2));
  const compact = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const a = Math.abs(n);
    const s = n < 0 ? "-" : "";
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
    const xOf = (v) => {
      const t = f(v);
      return t < 0 ? x0 - (Math.abs(t) / (Math.abs(fMin) || 1)) * negW
                   : x0 + (t / (fMax || 1)) * posW;
    };

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
    pat.append(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 4, stroke: "currentColor", "stroke-width": 1.6 }));
    defs.append(pat);
    svg.append(defs);

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
    const xOfCum = (v) => {
      const t = f(v);
      return t < 0 ? x0 - (Math.abs(t) / (Math.abs(cMin) || 1)) * negW
                   : x0 + (t / (cMax || 1)) * posW;
    };
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

    const axis = svgEl("text", { class: "gp-axis", x: plotL, y: H - 10 });
    axis.textContent = "net dealer Γ — short ◀ 0 ▶ long";
    svg.append(axis);

    svg.setAttribute("aria-label",
      `Net dealer gamma by strike for ${card.ticker}. ` +
      (spot !== null ? `Spot ${px2(spot)}. ` : "") +
      (flip !== null ? `Gamma flip ${px2(flip)}. ` : "No gamma flip inside the drawn band. ") +
      `${panel.strikes} strikes drawn as ${bars.length} bars.`);

    host.append(svg);

    const note = el("p", "fc-note");
    note.textContent =
      (flip !== null
        ? `Dealers are short gamma below ${px2(flip)} — hedging amplifies moves there — and long above it, where hedging damps them. `
        : "Net gamma does not change sign inside the drawn band, so no flip level exists here. ") +
      `σ is ATR(14). The gamma axis is symlog: twice the bar is not twice the gamma, so read magnitudes from the numbers rather than the ink. ` +
      `The running-total curve is drawn on its own scale — it shares only the zero line with the bars, where its crossing marks the flip.` +
      (panel.bucketed ? ` ${panel.strikes} strikes are aggregated into ${bars.length} bars.` : "");
    host.append(note);
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
    host.append(table);

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

    const dl = el("dl", "fc-stats");
    for (const [k, v] of [
      ["Net delta", compact(panel.netDelta)],
      ["Net premium", "$" + compact(panel.netPremium)],
      ["Minutes on tape", String(panel.minutes)],
    ]) {
      dl.append(el("dt", null, k));
      dl.append(el("dd", null, v));
    }
    host.append(dl);
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
    host.append(table);

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

  const FAMILY_LABEL = {
    F: "Flow — directional delta, weighted by purity",
    P: "Positioning — dealer gamma regime and displacement",
    D: "Path — how the day accumulated",
    V: "Vol — how durable the current regime is",
    O: "Quality — considered positioning versus lottery tickets",
  };

  function renderScore(host, card) {
    const question = "Why is this name on the board?";
    if (!card.fam) return deadPanel(host, question, "no decomposition was published");
    panelHead(host, question);

    const list = el("ul", "fc-fam");
    for (const k of ["F", "P", "D", "V", "O"]) {
      const v = isNum(card.fam[k]);
      const li = el("li", v === null ? "is-null" : v < 0 ? "is-neg" : "is-pos");
      li.append(el("span", "fc-fam-k", k));
      const track = el("span", "fc-fam-track");
      const bar = el("i");
      bar.style.setProperty("--w", v === null ? 0 : Math.min(Math.abs(v) / 100, 1));
      track.append(bar);
      li.append(track);
      li.append(el("span", "fc-fam-v", v === null ? DASH : (v > 0 ? "+" : "") + v));
      li.append(el("span", "fc-fam-l", FAMILY_LABEL[k]));
      list.append(li);
    }
    host.append(list);
    host.append(el("p", "fc-note",
      "Each family is scored across the whole cross-section, then the blend is " +
      "neutralised against sector and market cap — so this ranks the name against " +
      "its peers rather than rediscovering that one sector was strong today. The score " +
      "is a ranked attention signal, not a return forecast."));
  }

  /* ---------- assembly ---------------------------------------------- */

  function fmtDate(iso) {
    if (!iso) return DASH;
    const d = new Date(iso.length <= 10 ? iso + "T00:00:00Z" : iso);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(iso);
  }

  function paint(card, updatedAt) {
    $("fcTitle").textContent = card.ticker;
    const score = isNum(card.score);
    const badge = $("fcScore");
    badge.textContent = score === null ? DASH : (score > 0 ? "+" : "") + score;
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

    renderGamma($("fcGamma"), card.panels && card.panels.gamma, card);
    renderLevels($("fcLevels"), card.panels && card.panels.levels);
    renderPath($("fcPath"), card.panels && card.panels.path);
    renderCongress($("fcCongress"), card.panels && card.panels.congress);
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
    $("fcProv").textContent = "Loading…";
    for (const id of ["fcGamma", "fcLevels", "fcPath", "fcCongress", "fcWhy"]) {
      $(id).replaceChildren(el("p", "fc-note", "Loading…"));
    }
  }

  function trim() {
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  function load(ticker) {
    if (cache.has(ticker)) return Promise.resolve(cache.get(ticker));
    if (inflight) inflight.controller.abort();
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
    }).finally(() => { inflight = null; });
    inflight = { controller, promise };
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
        for (const id of ["fcGamma", "fcLevels", "fcPath", "fcCongress", "fcWhy"]) {
          deadPanel($(id), "", "No card has been built for this name yet. Cards are " +
            "published after the boards, so one can briefly lag its row.");
        }
        return;
      }
      paint(v.body, v.updatedAt);
    }).catch((e) => {
      if (e && e.name === "AbortError") return;
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
    const button = event.target.closest && event.target.closest(".fb-open");
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
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeCard(); });
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

  window.flowsCardPrefetch = (ticker) => { if (!cache.has(ticker)) load(ticker).catch(() => {}); };
})();
