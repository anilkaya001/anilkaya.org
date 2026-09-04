/* =============================================================
   flows-ticker.js — /flows/ticker/, one name and its whole book.

   THE PAGE EXISTS BECAUSE HALF THE CARD PAYLOAD HAS NEVER BEEN
   DRAWN. `ivSurface`, `skewTerm`, `topContracts` and `aggressor`
   have been built, published, served and cached in every card since
   the chain leg shipped — 42.8% of the mean card's bytes — and no
   renderer has ever touched them. The four drawers below are the
   first readers those payloads have had.

   IT SPENDS NO VENDOR CALL, and one D1 read in the common case.
   Every field is already in `card:<TICKER>`, already allow-listed,
   already served by /api/flows/card. The two board payloads are
   fetched ONLY to tell "this name is not on today's board" apart
   from "its card has not landed yet" — two facts that read
   identically to a reader and are completely different problems —
   or to build the picker when there is no ?t= at all.

   NOTHING HERE HARD-CODES A PANEL ORDER OR AN ELEMENT ID. The walk
   reads `.ft-panel[data-panel]` out of the DOM and looks the key up
   in DRAW. shared/flows-panels.js is the one list; the markup and
   the pipeline's shed ladder read the same array. A key with no
   drawer renders a VISIBLE "no renderer is registered" panel rather
   than an empty box, because an empty box is indistinguishable from
   a panel that drew nothing on purpose.

   TWO TABLES HERE ARE PROJECTIONS OF THAT ONE LIST, not second
   opinions about it: DRAW maps each key to its renderer, and
   PANEL_CHROME maps each key to the registry's own `group` and
   `tier`. `shared/` is never served, so a browser file cannot import
   the registry — and both tables are compared against it, key for
   key and value for value, by tests/flows-ticker-contract.mjs. A
   duplicate a test compares is a projection; a duplicate a test
   cannot see is a drift.

   THE PAGE OPENS ON WHAT CHANGED. It used to open on twenty-one
   panels of one session with no index, no group boundaries, no way
   to link a colleague to a panel, an identity block that scrolled
   away, and nothing anywhere saying what the score had DONE. See
   THE WORKSPACE, below.

   THE TEN SHIPPED RENDERERS ARE NOT COPIED HERE. They are
   window.FlowsPanels, extracted from flows-card.js so the dialog and
   this page draw the SAME code and can never disagree about a chart.
   ============================================================= */
(function () {
  "use strict";

  const grid = document.getElementById("ftGrid");
  if (!grid) return;

  const P = window.FlowsPanels;
  if (!P) {
    console.error(
      "flows-ticker: assets/js/flows-panels.js must load before this file — " +
      "the panel renderers live there and this page has nothing to draw with.");
    return;
  }

  const {
    el, svgEl, isNum, deadPanel, DASH, MINUS, AXIS_CH,
    neg, pct, px2, vol1, compact,
  } = P;

  const statusEl = document.getElementById("ftStatus");
  const staleEl = document.getElementById("ftStale");
  const headEl = document.getElementById("ftHead");
  const footEl = document.getElementById("ftFoot");
  const picker = document.getElementById("ftPicker");
  const $ = (id) => document.getElementById(id);

  /* THE SAME WIDTH POLICY THE TEN EXTRACTED RENDERERS USE, read from the
     module rather than restated here. Two width functions is two answers to
     "how wide is this chart" on a page that draws panels from both — and the
     four drawers below sit in the same grid as ten renderers that would then
     be sizing themselves by a different rule. [300, 1900]: the floor is the
     chart floor the 30rem panel rule protects (a 320px viewport gives a
     284.8px host, and 300/284.8 = 1.053, inside the render contract's 15%
     tolerance); the ceiling binds in the enlarge dialog, whose host reaches
     1481px. */
  const ftWidth = P.panelWidth;

  /* ---------- the four drawers this page adds ---------------------- */
  /**
   * Emit a panel's explanatory notes without burying the chart in them.
   *
   * THE PROBLEM IS PRESENTATION, NOT LENGTH. Every sentence these drawers
   * write is load-bearing — what the shade means, that it is this chart's own
   * quantile and not comparable between names, that a hollow cell is unknown
   * rather than zero. Deleting any of it would leave a chart a reader can
   * misread confidently, which is the failure this whole product is built
   * against. But joined into one paragraph they arrived as four hundred words
   * of unbroken prose UNDER a chart, and a rule nobody finishes reading is a
   * rule nobody has been told.
   *
   * So: one paragraph each, and once the set is long enough to be a wall, it
   * goes behind a disclosure that names what it is. The readings, the counts
   * and the coverage line stay in the open; the decoder is one click away and
   * still on the page, still selectable, still in the DOM for a find-in-page.
   * Nothing is removed and nothing is summarised.
   */
  const NOTE_WALL_CHARS = 420;

  function appendNotes(host, notes, summary) {
    /* SOME CALLERS END THEIR SENTENCES AND SOME DO NOT, because the drawers
       were written separately against a shared brief. Normalising here rather
       than at eleven call sites is what stops a stray ".." reaching a reader —
       and a doubled full stop in a panel whose whole claim is precision is
       worse than it sounds. */
    const list = (notes || [])
      .filter((n) => n && String(n).trim())
      .map((n) => String(n).trim().replace(/\.+$/, ""));
    if (!list.length) return;
    const total = list.reduce((n, t) => n + String(t).length, 0);
    if (total <= NOTE_WALL_CHARS) {
      for (const note of list) host.append(el("p", "fc-note", note + "."));
      return;
    }
    const box = el("details", "ft-how");
    box.append(el("summary", "ft-how-s", summary || "How to read this panel"));
    for (const note of list) box.append(el("p", "fc-note", note + "."));
    host.append(box);
  }

  /* ---------- the four drawers, in full -----------------------------

     Each is a sibling of the ten in flows-panels.js and follows the same
     contract: switch on panel.status BEFORE touching a number, take the
     question from the caller rather than hardcoding it, and suffix every
     <defs> id with `mount` so a grid copy and an enlarged copy of the same
     panel cannot borrow each other's patterns.

     ftWidth is the module's panelWidth, above — each drawer was written with
     its own copy of the same clamp and they were stripped on integration,
     because three identical width policies is three places to disagree. */

  /* ===== ivsurface ===== */
  /* =============================================================
     drawIvSurface — the implied-volatility surface, panels.ivSurface

     WHAT THE PICTURE IS. One rectangle per (moneyness band × expiry).
     Rows are `surface.rows`, log-moneyness band centres, HIGH STRIKES
     AT THE TOP, because that is the order a price ladder is read in and
     it is the order the emitter already built them in
     (`flows-premium.js`: `for (let k = rowHi; k >= rowLo; k--)`).
     Columns are `surface.expiries` in the order published, nearest
     first.

     WHAT A CELL ENCODES, AND IN WHICH CHANNEL. Four channels, and the
     hue is not one of them:

       1. OPACITY  — |skew| against this chart's own cap.
       2. HATCH    — the SIGN of the skew. Below the column's level is
                     hatched, at or above it is plain. Not a colour, so
                     a reader who cannot separate red from green, or is
                     holding a greyscale print, still gets the sign.
       3. BORDER   — provenance. THREE appearances, one per state of
                     `traded`: solid is a print from today, `3 2` did
                     not trade today, `1 2` carries no volume field at
                     all. The solid state has to be a DRAWN solid edge,
                     not the absence of one: the shipped desk renderer
                     (`flows-desk.js`) writes `stroke:"none"` for
                     `traded === true` and therefore ships two
                     appearances for a tri-state, which reads as "two
                     kinds of odd cell and a normal one" instead of as
                     three measured facts. Every cell here has a border.
       4. NUMBER   — the contract's own quoted implied volatility, as a
                     percent, printed inside the cell when the cell can
                     hold it.

     THERE IS NO SECOND HUE ON THIS GRID. `.fts-cell` carries one fill
     and the sign lives entirely in the hatch, so nothing at all is lost
     in greyscale. That is deliberately stricter than the gamma surface,
     which tints `is-pos` and `is-neg` and uses the hatch as
     reinforcement.

     ---------------------------------------------------------------
     THE LABELLED CHOICES, all of which the panel states in words:

     CHOICE 1 — the opacity ramp is `0.12 + 0.46 · min(1, |skew|/cap)`.
     The 0.12 floor exists so that a small-but-real skew is still
     visibly a cell: zero opacity and "nothing here" must never look
     alike, and this grid has a separate mark for "nothing here". The
     0.58 ceiling exists because the quoted volatility is printed ON TOP
     of the fill and has to stay legible against it.

     CHOICE 2 — `skewCap` is a 0.9 quantile of |skew| ON THIS CHART
     (`SKEW_CAP_QUANTILE`, floored at `SKEW_CAP_FLOOR = 0.01`). It is
     not a constant and it is not shared. THE SHADING IS THEREFORE NOT
     COMPARABLE BETWEEN TWO NAMES and the note says so in those words —
     measured across the emitted corpus the cap ranges 0.0945 to 0.1972,
     a factor of 2.1, so the same shade means twice the skew on one card
     as on another.

     CHOICE 3 — row labels are `ln(K/S)` to two decimals, NOT a
     percentage. A row at 0.50 is a strike 64.9% above spot, and the
     emitter really does build rows out to ±0.5 on a wide chain, so a
     "+50.0%" label would be wrong by 14.9 percentage points at the
     extreme. Two decimals separates every row on the step ladder the
     emitter actually uses (0.05 and 0.10, measured); the two finest
     rungs of `SURFACE_ROW_STEPS` (0.005, 0.01) would collide at two
     decimals, so the decimal count is taken from `step` and is two
     unless `step` itself is finer than a hundredth. See the notes.

     CHOICE 4 — columns are evenly spaced by LISTED EXPIRY, not by
     elapsed time. The tenor is printed under each head so the reader
     can see how uneven the real spacing is.

     CHOICE 5 — the at-the-money level is printed as a third line in the
     column head, inside the `padT = 34` the layout was already
     reserving. Read left to right that line IS the term structure, and
     without it the grid has its level divided out of every cell with no
     way to put it back. It costs the panel no height: three 9px lines
     at baselines 7, 17 and 28 fit in 34px exactly.

     ---------------------------------------------------------------
     THE TWO STATES OUTSIDE THE OPACITY SCALE, and why they are three
     different marks rather than three shades of pale:

     `skew === null` — the cell is drawn HOLLOW: `fill:none`, a 1px
     edge, and a backslash through the centre. It means the cell's
     EXPIRY has no at-the-money quote this surface will vouch for, so
     the contract's position on the smile is UNKNOWN. It does not mean
     flat, and `fill-opacity: 0` would say flat.

     THIS IS THE ONE MARK ON THE PAGE THAT CAN TEACH A READER A FALSE
     FACT ABOUT A DIFFERENT PANEL. The gamma surface, in the same grid
     idiom on the same card, styles `.gs-cell.is-zero { fill: none }` —
     and there hollow means MEASURED EXACTLY ZERO. Two hollow cells, two
     opposite meanings, one screen. The key names this one explicitly
     and the note spells the difference out; do not shorten either.

     No cell at all — `.fts-void`, an EXPLICIT FILLED rectangle, never a
     gap. A band with no listed contract and a band whose contract is
     quoted indistinguishably from its neighbours must not look alike.

     ---------------------------------------------------------------
     WHAT IS NOT ON THE WIRE, so that nobody designs it back in.
     `serialiseSurface()` keeps FOUR fields per cell — `iv`, `skew`,
     `traded`, `strike` — and DROPS `type`, `volume`, `oi`, `crowd` and
     `m`; `atmType` is dropped from the expiry too. Verified against all
     65 emitted cards. The desk's `cellTitle()` reads `cell.type`,
     `cell.m`, `cell.crowd`, `cell.volume` and `cell.oi` and CANNOT be
     reused here — every one of those would render as `undefined` or, if
     coerced, as a confident zero. In particular: do NOT infer "below
     spot, therefore a put". The band centre `rows[i]` is a stated band
     centre, not the contract's own moneyness, and the note says so.
     ============================================================= */


  /** A LEVEL as a percent, one decimal, unsigned. "32.8" — the unit is in the
   *  key and in the note, once, rather than on 52 cells. */
  function ftsVol(v) {
    const F = window.FlowsPanels;
    const n = F.isNum(v);
    return n === null ? F.DASH : (n * 100).toFixed(1);
  }

  /** A SKEW in volatility POINTS, signed, because the sign is the reading.
   *  U+2212 for the minus, never the hyphen toFixed() emits. */
  function ftsPts(v) {
    const F = window.FlowsPanels;
    const n = F.isNum(v);
    if (n === null) return F.DASH;
    return (n < 0 ? F.MINUS : n > 0 ? "+" : "") + Math.abs(n * 100).toFixed(1);
  }

  /** A ROW LABEL: ln(K/S) to `dp` decimals with U+2212. Not a percentage —
   *  see CHOICE 3 in the header. */
  function ftsBand(m, dp) {
    const F = window.FlowsPanels;
    const n = F.isNum(m);
    if (n === null) return F.DASH;
    /* -0.00 is a real output of toFixed() on a tiny negative and it is a sign
       asserted at the one magnitude where sign is meaningless. */
    const s = n.toFixed(dp);
    return F.neg(/^-0\.?0*$/.test(s) ? s.slice(1) : s);
  }

  /** A count with its noun, so a count of one does not read "1 cells". */
  function ftsPlural(n, one, many) {
    return n === 1 ? one : many;
  }

  function drawIvSurface(host, panel, card, question, mount) {
    const F = window.FlowsPanels;
    const { el, svgEl, isNum, deadPanel, panelHead, statList, DASH, AXIS_CH } = F;

    const q = question ||
      "Where on the smile is this book bid, and how much of the chain is that reading taken over?";

    /* THE TAGGED UNION IS TESTED BEFORE ANY NUMBER IS TOUCHED. A card built
       before the option-chain leg shipped carries no `ivSurface` key at all —
       `undefined`, not `{status:"unavailable"}` — and the two must not be
       conflated, because only one of them is a source that failed. */
    if (panel === undefined || panel === null) {
      return deadPanel(host, q, "this card was built before the option chain leg shipped");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    const rows = Array.isArray(panel.rows) ? panel.rows : [];
    const cols = Array.isArray(panel.expiries) ? panel.expiries : [];
    const ivM = Array.isArray(panel.iv) ? panel.iv : [];
    const skM = Array.isArray(panel.skew) ? panel.skew : [];
    const trM = Array.isArray(panel.traded) ? panel.traded : [];
    const kM = Array.isArray(panel.strike) ? panel.strike : [];

    /* SECOND-STAGE GUARD. `status:"ok"` is the builder's verdict on the CHAIN;
       it is not a promise that the grid has rows in it. A zero-row grid would
       divide `300 / rows.length` and produce Infinity for the row height. */
    if (!ivM.length || !cols.length || !rows.length) {
      return deadPanel(host, q, "no usable moneyness bands");
    }

    panelHead(host, q);

    /* Every <defs> id is suffixed with the mount tag. SVG ids are
       document-global and url(#id) takes the FIRST match in document order, so
       a page that draws this panel in the grid and again in the enlarge dialog
       would otherwise give the second drawing the first's pattern. */
    const tag = String(mount || "grid");

    /* ---- geometry --------------------------------------------------- */
    /* labelW carries "−0.30" at 9.5px — 5 characters at 5.7px is 28.5px, plus
       the 6px gutter, inside 46 with room to spare. padT carries three head
       lines. keyH carries the legend, which is the decoder for four separate
       channels and without which the picture is an encoding with no key. */
    const W = ftWidth(host);
    const labelW = 46, padR = 10, padT = 34, keyH = 24;
    const plotL = labelW;
    const plotW = Math.max(60, W - labelW - padR);
    const colW = plotW / cols.length;
    /* A cell shorter than 11px is a line, not a cell; taller than 24 and a
       ten-row surface becomes a poster. */
    const rowH = Math.max(11, Math.min(24, 300 / rows.length));
    const gridH = rows.length * rowH;
    const H = Math.round(padT + gridH + keyH);

    /* THE NUMBER ONLY GOES IN THE CELL WHEN THE CELL CAN HOLD IT. 26 is
       arithmetic, not taste: "30.5" at 9px mono is 4 × 0.6 × 9 = 21.6px, plus
       4px of breathing, rounded up.

       MEASURED: this branch cannot currently be taken. The emitter caps the
       grid at SURFACE_MAX_EXPIRIES = 8 and SURFACE_MAX_ROWS = 17, so at the
       narrowest host this drawer will ever see (W = 300, plotW = 244) the
       tightest possible column is 244/8 = 30.5px and the shortest possible row
       is 300/17 = 17.6px. Both clear the thresholds. The guard is kept because
       it is the layout's own arithmetic rather than a data assumption — raise
       SURFACE_MAX_EXPIRIES to 10 upstream and it goes live the same day — but
       nobody should read the fallback note below and conclude it has ever been
       seen on this payload. */
    const withNumbers = colW >= 26 && rowH >= 12;

    const chW = (fs) => (AXIS_CH * fs) / 10;

    const cap = isNum(panel.skewCap);
    const step = isNum(panel.step);
    /* CHOICE 3's decimal count, taken from the step rather than fixed at two.
       Measured: step is 0.05 on 61 of 65 emitted cards and 0.10 on the other 4,
       so `dp` is 2 on every card that exists today. It is 3 only on the 0.005
       rung of SURFACE_ROW_STEPS, where two decimals would print the same label
       on every adjacent pair of rows. */
    const dp = step !== null && step < 0.01 ? 3 : 2;

    /* THE AT-THE-MONEY ROW IS THE ONE NEAREST ZERO, not the one equal to it.
       `rows` is normally symmetric about 0 and contains it exactly, but the
       emitter's overflow branch clamps the window (`rowLo = max(rowLo, -half)`)
       and can in principle shift zero off the grid. Nearest-to-zero is the same
       answer whenever zero is present and is still an answer when it is not. */
    let atmRow = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = isNum(rows[i]), b = isNum(rows[atmRow]);
      if (a === null) continue;
      if (b === null || Math.abs(a) < Math.abs(b)) atmRow = i;
    }

    const svg = svgEl("svg", {
      class: "fts", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    /* The hatch that carries SIGN independently of hue, drawn at the CENTRE of
       its tile rather than on its edge. A stroke on a tile boundary is half
       clipped by patternUnits and renders at a fraction of its intended weight
       — the defect renderGamma's gpNeg comment records. Same construction, and
       the same reason, as the gamma surface's. */
    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: `ftsNeg-${tag}`, width: 5, height: 5, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "fts-negpat",
    });
    pat.append(svgEl("line", {
      x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: "currentColor", "stroke-width": 1.6,
    }));
    defs.append(pat);
    svg.append(defs);

    /* ---- column heads: the level, the expiry, the tenor -------------- */
    cols.forEach((e, j) => {
      const x = plotL + j * colW + colW / 2;
      const atmIv = isNum(e && e.atmIv);
      const days = isNum(e && e.days);

      /* THE <title> HANGS ON A WRAPPING GROUP, NEVER ON THE <text>. A title
         child of a text element is not painted but IS part of its textContent,
         so the label reads back as the label plus a paragraph of prose —
         invisible on screen and wrong to anything that reads the DOM, which
         includes this page's own contract test. */
      const group = svgEl("g", { class: "fts-colhead" });
      const title = svgEl("title");
      const bits = [String(e && e.expiry) + (days === null ? "" : ", " + days + " days")];
      if (atmIv === null) {
        /* NEVER A CONFIDENT ZERO, and never a bare dash either: the builder
           always writes a reason when it refuses a level. */
        bits.push("No at-the-money level: " +
          ((e && e.atmReason) || "this expiry has no quote inside the band an at-the-money print may sit in") +
          ". Every cell in this column is drawn hollow, because their position on the smile is unknown");
      } else {
        const am = isNum(e.atmM), ak = isNum(e.atmStrike);
        bits.push("At the money " + ftsVol(atmIv) + "% implied" +
          (ak === null ? "" : ", from the " + ak.toFixed(2) + " strike") +
          (am === null ? "" : " at ln(K/S) " + ftsBand(am, dp)) +
          ", and it traded today — a level this surface will vouch for");
        bits.push("Every cell in this column is shaded against this number");
      }
      title.textContent = bits.join(". ") + ".";
      group.append(title);

      /* CHOICE 5: the level line, inside the padT the layout already had. */
      const lvl = svgEl("text", {
        class: "fts-level" + (atmIv === null ? " is-missing" : ""),
        x, y: padT - 27, "text-anchor": "middle",
        "font-family": "var(--font-mono)", "font-size": 9,
        fill: "currentColor", "fill-opacity": atmIv === null ? 0.55 : 1,
        "font-weight": atmIv === null ? 400 : 700,
      });
      lvl.textContent = atmIv === null ? DASH : ftsVol(atmIv);
      group.append(lvl);

      const head = svgEl("text", {
        class: "fts-exp", x, y: padT - 17, "text-anchor": "middle",
        "font-family": "var(--font-mono)", "font-size": 9,
        fill: "currentColor", "fill-opacity": 0.8,
      });
      /* The ISO date keeps its hyphen — the U+2212 rule is about signs, and
         "08−31" is not a date. slice(5) drops the year, which is the same on
         every column of every card this panel draws. */
      head.textContent = String(e && e.expiry).slice(5);
      group.append(head);

      const tenor = svgEl("text", {
        class: "fts-days", x, y: padT - 6, "text-anchor": "middle",
        "font-family": "var(--font-mono)", "font-size": 8.5,
        fill: "currentColor", "fill-opacity": 0.6,
      });
      tenor.textContent = days === null ? DASH : days + "d";
      group.append(tenor);
      svg.append(group);

      if (j > 0) {
        svg.append(svgEl("line", {
          class: "fts-colrule", x1: plotL + j * colW - 0.5, x2: plotL + j * colW - 0.5,
          y1: padT, y2: padT + gridH,
          stroke: "currentColor", "stroke-width": 0.5, "stroke-opacity": 0.18,
        }));
      }
    });

    /* ---- the grid --------------------------------------------------- */
    const cellW = Math.max(1, colW - 1), cellH = Math.max(1, rowH - 1);
    let hollow = 0, voids = 0, hatched = 0, clippedDrawn = 0;

    rows.forEach((mRaw, i) => {
      const y = padT + i * rowH;
      const m = isNum(mRaw);
      const ivRow = Array.isArray(ivM[i]) ? ivM[i] : [];
      const skRow = Array.isArray(skM[i]) ? skM[i] : [];
      const trRow = Array.isArray(trM[i]) ? trM[i] : [];
      const kRow = Array.isArray(kM[i]) ? kM[i] : [];

      cols.forEach((e, j) => {
        const x = plotL + j * colW;
        const iv = isNum(ivRow[j]);
        const skew = isNum(skRow[j]);
        const strike = isNum(kRow[j]);
        const traded = trRow[j] === 1 ? 1 : trRow[j] === 0 ? 0 : null;
        const atmIv = isNum(e && e.atmIv);

        /* NO CONTRACT IN THIS BAND ON THIS EXPIRY is an EXPLICIT FILLED
           rectangle, never a gap in the drawing. A band the chain does not
           list and a band quoted indistinguishably from its neighbours would
           otherwise look identical, and only one of them is a reading.

           The cell's existence is tested on `iv`, because `iv` is what the
           cell paints. `strike` distinguishes the two ways it can be absent
           and that distinction goes in the title, not into a second mark. */
        if (iv === null) {
          voids++;
          const vg = svgEl("g", { class: "fts-cellgroup" });
          const vt = svgEl("title");
          vt.textContent = strike === null
            ? "No listed contract in the " + ftsBand(m, dp) + " band on " + String(e && e.expiry) +
              ". Not a volatility of zero — nothing was quoted here at all."
            : "A contract is listed at " + strike.toFixed(2) + " on " + String(e && e.expiry) +
              " but this surface carries no implied volatility for it, so the cell is left empty " +
              "rather than filled with a number nobody quoted.";
          vg.append(vt);
          vg.append(svgEl("rect", {
            class: "fts-void", x, y, width: cellW, height: cellH,
            fill: "currentColor", "fill-opacity": 0.07,
          }));
          svg.append(vg);
          return;
        }

        const mag = skew !== null && cap !== null && cap > 0
          ? Math.min(1, Math.abs(skew) / cap) : 0;
        const isNeg = skew !== null && skew < 0;
        /* PAST THE CAP IS DECIDED ON THE PUBLISHED NUMBERS, NOT ON
           `panel.clipped`. The payload's count was taken upstream on the full
           precision skews (`flows-premium.js`: `for (const s of skews) if
           (s > skewCap) clipped++`), but `serialiseSurface` rounds BOTH the
           skew and the cap to four decimals before either reaches this
           renderer. A skew of 0.110936 against a cap of 0.110904 is clipped
           upstream and is 0.1109 against 0.1109 here. MEASURED: the two
           disagree on 42 of the 65 emitted cards — SYN002 publishes
           `clipped: 6` and the wire supports 4.

           The picture must mark exactly what its own numbers say, or it marks
           a different set of cells than the sentence beside it counts, which
           the gamma surface's own comment names as worse than marking none.
           So the mark and the count both come from the drawn comparison, and
           the note says when the payload disagrees rather than silently
           picking one. */
        const clipped = skew !== null && cap !== null && Math.abs(skew) > cap;
        if (clipped) clippedDrawn++;
        if (skew === null) hollow++;

        const group = svgEl("g", { class: "fts-cellgroup" });

        /* ONE GROUP, ONE TITLE, so the whole cell answers a hover. The number
           painted on top of the tile would otherwise swallow the pointer and
           leave the tooltip unreachable at exactly the place the reader is
           looking. */
        const title = svgEl("title");
        const parts = [];
        /* The strike is a real observable and it is on the wire. `rows[i]` is
           the band's STATED CENTRE, not this contract's own log-moneyness —
           `m` per cell was dropped by serialiseSurface — and the wording keeps
           the two apart rather than passing a band centre off as a measurement
           of this contract. */
        parts.push((strike === null ? "This contract" : strike.toFixed(2)) +
          " on " + String(e && e.expiry) + ", in the ln(K/S) " + ftsBand(m, dp) +
          " band · " + ftsVol(iv) + "% implied");
        if (skew === null) {
          parts.push("No skew: " +
            ((e && e.atmReason) || "this expiry has no at-the-money level this surface will vouch for") +
            ". Its position on the smile is unknown, which is why the cell is hollow — it is not flat");
        } else {
          parts.push(ftsPts(skew) + " volatility points against this expiry's at-the-money " +
            ftsVol(atmIv) + "%");
        }
        parts.push(traded === 1
          ? "This contract traded today, so its implied volatility is today's print"
          : traded === 0
            ? "This contract did NOT trade today. This vendor's implied volatility is the last transaction's, so this one is of unknown age — it is drawn, and it did not set this expiry's level"
            : "The vendor reported no volume for this contract at all, so whether this volatility is today's is unknown. Not the same fact as a contract that did not trade — it did not set this expiry's level either");
        if (clipped) {
          parts.push("Past the shade cap of " + ftsPts(cap) + " points, so the shade understates it. Marked with a slash");
        }
        title.textContent = parts.join(". ") + ".";
        group.append(title);

        const rect = svgEl("rect", {
          /* is-nolevel is NOT "flat". A cell whose expiry has no at-the-money
             quote has an UNKNOWN position on the smile, which is a different
             thing from sitting on the money — and a zero-magnitude fill would
             say the second. */
          class: "fts-cell" + (skew === null ? " is-nolevel" : "") +
            (traded === 0 ? " is-stale" : traded === null ? " is-unknown-age" : ""),
          x, y, width: cellW, height: cellH,
          fill: skew === null ? "none" : "currentColor",
          "fill-opacity": skew === null ? null : (0.12 + 0.46 * mag).toFixed(3),
          /* PROVENANCE BY BORDER, IN THREE APPEARANCES. The solid state is a
             DRAWN solid edge and not the absence of an edge: with `stroke:none`
             on today's prints a tri-state renders as two marks and a blank, and
             the blank is the modal case (measured: 3,227 of 3,524 cells), so
             the channel would be carrying nothing for 92% of the grid.
             Solid is quiet and dashed is loud, so the lattice reads as
             continuous and a break in it is what catches the eye. */
          stroke: "currentColor",
          "stroke-width": 1,
          "stroke-dasharray": traded === 0 ? "3 2" : traded === null ? "1 2" : null,
          "stroke-opacity": traded === 1 ? 0.5 : 0.9,
        });
        group.append(rect);

        if (skew === null) {
          /* THE HOLLOW CELL'S OWN MARK. A backslash, at 45 degrees and of
             FIXED LENGTH at the centre. Fixed length because a corner-to-corner
             diagonal makes the mark's angle a function of the cell's aspect
             ratio, and a cell here is 30 × 24 at a phone width and 286 × 23 in
             the enlarge dialog — the same mark would be a tidy X on one and a
             long shallow rule across the chart on the other. Backslash because
             the hatch and the clip mark both run the other way, so three marks
             that can share a grid are three distinguishable glyphs. */
          const len = Math.min(9, Math.max(4, Math.min(cellW, cellH) - 4));
          const cx = x + cellW / 2, cy = y + cellH / 2;
          group.append(svgEl("line", {
            class: "fts-nolevel-mark",
            x1: (cx - len / 2).toFixed(2), y1: (cy - len / 2).toFixed(2),
            x2: (cx + len / 2).toFixed(2), y2: (cy + len / 2).toFixed(2),
            stroke: "currentColor", "stroke-width": 1,
          }));
        }

        if (isNeg && rowH >= 9 && colW >= 9) {
          hatched++;
          group.append(svgEl("rect", {
            class: "fts-hatch", x, y, width: cellW, height: cellH,
            fill: `url(#ftsNeg-${tag})`,
            /* Faded so the hatch reads as a texture under the printed number
               rather than as a strikethrough across it. */
            opacity: 0.5,
          }));
        }

        if (clipped) {
          /* PAST THE CAP, MARKED RATHER THAN SILENTLY FLATTENED. A short
             fixed-length slash at the bottom-left edge, the desk's
             construction, because these tiles are as wide as the panel over
             three and a diagonal across one of those reads as a rule through
             the chart rather than a mark on one cell.

             A clipped cell is ALWAYS at the ramp's top opacity by
             construction — |skew| > cap forces mag = 1 — so a slash in the
             panel's own background colour is legible on every cell that can
             ever carry one, hatched or not. That is why the mark can afford to
             be a hole rather than a fourth ink. */
          const slash = Math.min(9, Math.max(4, cellW - 4));
          group.append(svgEl("line", {
            class: "fts-clip",
            x1: (x + 3).toFixed(2), y1: (y + cellH - 3).toFixed(2),
            x2: (x + 3 + slash).toFixed(2), y2: Math.max(y + 2, y + cellH - 3 - slash).toFixed(2),
            stroke: "currentColor", "stroke-width": 1.2, "stroke-opacity": 0.9,
          }));
        }

        if (withNumbers) {
          const t = svgEl("text", {
            /* One modifier, and it means "this printed number is not today's
               print". It covers `traded === 0` and `traded === null` together
               on purpose: the TEXT only needs to say the number may be old,
               and the BORDER is the channel that separates "did not trade"
               from "no volume field at all". */
            class: "fts-iv" + (traded === 1 ? "" : " is-stale"),
            x: x + cellW / 2, y: y + cellH / 2 + 3.2, "text-anchor": "middle",
            "font-family": "var(--font-mono)", "font-size": 9,
            fill: "currentColor",
          });
          t.textContent = ftsVol(iv);
          group.append(t);
        }
        svg.append(group);
      });
    });

    /* ---- row labels: ln(K/S), high strikes at the top ---------------- */
    /* The at-the-money row is the reference every other row is read against so
       it always gets a label, as do both ends; the rest are filled in at
       whatever stride stays legible. MEASURED: rowH is 23.08 on a 13-row card
       and 24 on an 11-row one, so the stride is 1 and every row is labelled on
       every card that exists — the budget only bites past 25 rows, which the
       SURFACE_MAX_ROWS = 17 ceiling forbids. It is kept because a wall of
       digits is the failure mode this rail has, not because it fires. */
    const must = new Set([0, rows.length - 1, atmRow]);
    const stride = Math.max(1, Math.ceil(13 / rowH));
    rows.forEach((mRaw, i) => {
      if (!must.has(i)) {
        if (i % stride !== 0) return;
        let crowds = false;
        must.forEach((k) => { if (Math.abs(k - i) * rowH < 12) crowds = true; });
        if (crowds) return;
      }
      const t = svgEl("text", {
        class: "fts-m" + (i === atmRow ? " is-atm" : ""),
        x: labelW - 6, y: padT + i * rowH + rowH / 2 + 3.2, "text-anchor": "end",
        "font-family": "var(--font-mono)", "font-size": 9.5,
        fill: "currentColor", "fill-opacity": i === atmRow ? 1 : 0.7,
        "font-weight": i === atmRow ? 700 : 400,
      });
      t.textContent = ftsBand(isNum(mRaw), dp);
      svg.append(t);
    });

    /* ---- the key ----------------------------------------------------- */
    /* WITHOUT THIS THE PICTURE IS AN ENCODING WITH NO DECODER. Four channels
       are in play and three of them are marks a reader has never seen before.
       It sits in the keyH band the height arithmetic already reserved, so the
       key costs the panel nothing.

       THE HOLLOW STATE IS NAMED EXPLICITLY AND MUST STAY NAMED. `.gs-cell.is-zero
       { fill: none }` on the gamma surface — the same grid idiom, frequently the
       panel directly above this one — means "measured exactly zero". Hollow here
       means "unknown position on the smile". A reader who learns one mark and
       carries it to the other panel learns a false fact about a real book. */
    const keyTop = padT + gridH;
    const KEY_FS = 9, SW = 12, SWH = 8, PAD_LB = 3, GAP = 10;
    const kchW = chW(KEY_FS);
    const capTxt = cap === null ? null : (cap * 100).toFixed(1);

    const keyItems = [
      { kind: "ramp", n: 3, label: capTxt === null ? "shade carries no size" : "0 to " + capTxt + " pts" },
      { kind: "hatch", n: 1, label: "under ATM" },
      { kind: "hollow", n: 1, label: "no level" },
      { kind: "border", n: 1, dash: null, label: "today" },
      { kind: "border", n: 1, dash: "3 2", label: "not today" },
      { kind: "border", n: 1, dash: "1 2", label: "age unknown" },
    ];
    keyItems.forEach((it) => { it.w = it.n * SW + PAD_LB + it.label.length * kchW; });

    /* Two rows of 8px swatches with 9px labels fit inside keyH = 24 exactly
       (4 + 8, then 15 + 8 = 23). Greedy packing: at W = 300 the six items need
       both rows — measured 251px and 200px against a 296px budget — and at any
       host past ~470px they collapse onto one. */
    const KEY_ROWS = [keyTop + 4, keyTop + 15];
    let kr = 0, kx = 2;
    const drawSwatch = (x, y, cls, opacity, dash) => svgEl("rect", {
      class: cls, x, y, width: SW - 1, height: SWH,
      fill: opacity === null ? "none" : "currentColor",
      "fill-opacity": opacity === null ? null : opacity,
      stroke: "currentColor", "stroke-width": 1,
      "stroke-dasharray": dash || null,
      "stroke-opacity": dash ? 0.9 : 0.5,
    });

    keyItems.forEach((it) => {
      if (kx > 2 && kx + it.w > W - 2 && kr < KEY_ROWS.length - 1) { kr++; kx = 2; }
      const y = KEY_ROWS[kr];
      if (it.kind === "ramp") {
        /* Both ends of the ramp are drawn, so any cell can be read to within a
           step, and the note repeats the numbers in prose so the two cannot
           drift apart. */
        [0, 0.5, 1].forEach((mg, n) => {
          svg.append(drawSwatch(kx + n * SW, y, "fts-cell", (0.12 + 0.46 * mg).toFixed(3), null));
        });
      } else if (it.kind === "hatch") {
        svg.append(drawSwatch(kx, y, "fts-cell", (0.58).toFixed(3), null));
        svg.append(svgEl("rect", {
          class: "fts-hatch", x: kx, y, width: SW - 1, height: SWH,
          fill: `url(#ftsNeg-${tag})`, opacity: 0.5,
        }));
      } else if (it.kind === "hollow") {
        svg.append(drawSwatch(kx, y, "fts-cell is-nolevel", null, null));
        svg.append(svgEl("line", {
          class: "fts-nolevel-mark",
          x1: kx + 2.5, y1: y + 1.5, x2: kx + SW - 3.5, y2: y + SWH - 1.5,
          stroke: "currentColor", "stroke-width": 1,
        }));
      } else {
        svg.append(drawSwatch(kx, y,
          "fts-cell" + (it.dash === "3 2" ? " is-stale" : it.dash === "1 2" ? " is-unknown-age" : ""),
          (0.12).toFixed(3), it.dash));
      }
      const t = svgEl("text", {
        class: "fts-key", x: kx + it.n * SW + PAD_LB, y: y + SWH - 1.2,
        "font-family": "var(--font-mono)", "font-size": KEY_FS,
        fill: "currentColor",
      });
      t.textContent = it.label;
      svg.append(t);
      kx += it.w + GAP;
    });

    /* THE PANEL HAD role="img" AND MUST NOT HAVE AN EMPTY LABEL. The grid
       cannot be read out cell by cell — 52 of them on a typical card — so the
       label carries what the key carries plus the one reading a screen reader
       would otherwise lose entirely: the term structure across the heads. */
    const levelWords = cols.map((e) => String(e && e.expiry).slice(5) + " " +
      (isNum(e && e.atmIv) === null ? "no level" : ftsVol(e.atmIv) + " percent"));
    const hiBand = ftsBand(isNum(rows[0]), dp), loBand = ftsBand(isNum(rows[rows.length - 1]), dp);
    svg.setAttribute("aria-label",
      "Implied volatility by moneyness band and expiry" +
      (card && card.ticker ? " for " + card.ticker : "") + ". " +
      rows.length + " bands of log-moneyness from " + hiBand + " at the top down to " + loBand +
      ", across " + cols.length + " expiries. " +
      "At-the-money implied volatility by expiry: " + levelWords.join(", ") + ". " +
      "Each cell is that contract's own quoted volatility; the shade is how far it sits from its " +
      "own expiry's at-the-money quote, hatched below it and plain at or above it. " +
      "A solid border is a print from today, a dashed one did not trade today, a dotted one " +
      "carries no volume field at all.");

    host.append(svg);

    /* ---- the numbers the picture cannot state exactly ---------------- */
    const placed = isNum(panel.placed), fresh = isNum(panel.fresh);
    const pairs = [];
    pairs.push(["Bands", rows.length + (step === null ? "" : " × " + (step * 100).toFixed(1) + "%")]);
    pairs.push(["Expiries", String(cols.length)]);
    pairs.push(["Shade cap", cap === null ? DASH : "±" + capTxt + " pts"]);
    pairs.push(["Prints today", fresh === null || placed === null ? DASH : fresh + " of " + placed]);
    /* THE STEEPEST CELL, because a shade cannot state a number exactly and this
       is the one reading a desk carries away. Both coordinates: a band without
       its expiry is not a smile and an expiry without its band is not a term. */
    let peak = null;
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < cols.length; j++) {
        const s = isNum(Array.isArray(skM[i]) ? skM[i][j] : null);
        if (s === null) continue;
        if (peak === null || Math.abs(s) > Math.abs(peak.s)) peak = { s, i, j };
      }
    }
    if (peak) {
      pairs.push(["Steepest cell",
        ftsPts(peak.s) + " pts · " + ftsBand(isNum(rows[peak.i]), dp) + " · " +
        String(cols[peak.j] && cols[peak.j].expiry).slice(5)]);
    }
    host.append(statList(pairs));

    /* ---- the note: the decoder, in prose ----------------------------- */
    const notes = [];
    notes.push("Rows are ln(K/S), the natural log of strike over spot" +
      (step === null ? "" : ", in bands " + (step * 100).toFixed(1) + "% wide") +
      ", high strikes at the top. A row at 0.10 is a strike 10.5% above spot; a row at 0.50 " +
      "is 64.9% above — which is why these are printed as logs and not as percentages");
    notes.push("Columns are evenly spaced by listed expiry, not by elapsed time. Each column's " +
      "tenor is printed beneath it, and the volatility above it is that expiry's at-the-money " +
      "quote — read left to right, that top line is the term structure");
    notes.push(withNumbers
      ? "The number in a cell is that contract's own quoted implied volatility, as a percent"
      : "Columns are too narrow at this width to print the quoted volatilities — the shading and " +
        "the hatch carry the reading. Enlarge the panel for the numbers");
    if (cap === null) {
      notes.push("No shade scale could be measured for this grid, so shade carries no magnitude on it");
    } else {
      notes.push("The shade is that volatility against its own expiry's at-the-money quote: palest " +
        "at 0 and darkest at " + capTxt + " volatility points. THAT CAP IS THIS CHART'S OWN — a 0.9 " +
        "quantile of the skews on this grid, not a constant — so a shade here and a shade on another " +
        "name's surface are not the same number and the two panels must not be compared by eye");
    }
    /* THE HATCH COUNT IS THE SHAPE OF THE SMILE IN ONE NUMBER, and it is the
       one thing a shade cannot state: how much of this book is quoted under its
       own level. Counted off the marks actually drawn, so the sentence and the
       picture cannot drift. */
    notes.push("Sign is the hatch, not a colour: a hatched cell is quoted BELOW its column's " +
      "at-the-money level, a plain one at or above it — " + hatched + " of " +
      (placed === null ? rows.length * cols.length - voids : placed) + " here. There is no second " +
      "hue on this grid, so nothing about it is lost in greyscale or to a colour-blind reader");
    /* THE TWO HOLLOWS. Named at length and deliberately not shortened. */
    notes.push("A HOLLOW CELL IS NOT A FLAT ONE. It is a band on an expiry with no at-the-money " +
      "quote this surface will vouch for, so the contract's position on the smile is unknown — " +
      "note that the gamma surface on this same card draws a hollow cell for a dealer position " +
      "MEASURED at exactly zero, which is the opposite kind of fact. An empty tile is different " +
      "again: no contract listed in that band on that expiry at all");
    notes.push("Every cell carries a border, and it says where the number came from: solid is a " +
      "print from today, dashed did not trade today, dotted carries no volume field at all. This " +
      "vendor's implied volatility is the LAST TRANSACTION's, not a quote, and only a contract " +
      "that traded today was allowed to set an expiry's level — a stale cell is one marked number, " +
      "but a stale level would tilt a whole column's smile with no marker on any cell it moved");
    if (placed !== null && fresh !== null) {
      const aged = [];
      const st = isNum(panel.stale), un = isNum(panel.unknownAge);
      if (st !== null && st > 0) aged.push(st + " did not");
      if (un !== null && un > 0) {
        aged.push(un + " carr" + (un === 1 ? "ies" : "y") + " no volume at all");
      }
      notes.push(fresh + " of " + placed + " cells traded today" +
        (aged.length ? "; " + aged.join(" and ") : " — every cell on this surface is a print from today"));
    }
    if (hollow > 0) {
      notes.push(hollow + " " + ftsPlural(hollow, "cell is", "cells are") + " hollow");
    }
    if (voids > 0) {
      notes.push(voids + " " + ftsPlural(voids, "band on an expiry lists", "bands on an expiry list") +
        " no contract at all");
    }
    const clippedN = isNum(panel.clipped);
    if (cap !== null && clippedDrawn > 0) {
      notes.push("The shade is capped, so " + clippedDrawn + " " +
        ftsPlural(clippedDrawn, "cell runs", "cells run") + " past " + capTxt + " points and " +
        ftsPlural(clippedDrawn, "is", "are") + " marked with a slash rather than flattened silently " +
        "against every other saturated cell" +
        (clippedN !== null && clippedN !== clippedDrawn
          ? " (the payload counts " + clippedN + ", at a precision the wire rounds away: both the " +
            "skew and the cap are published to four decimals, and the marks here are the ones " +
            "those published numbers support)"
          : ""));
    } else if (cap !== null && clippedN !== null && clippedN > 0) {
      /* The payload counted cells past its cap and the rounded numbers support
         none of them. Saying nothing would leave the sentence and the picture
         agreeing by accident; saying it is a two-clause admission that the
         cap and the top of the ramp are the same number to four decimals. */
      notes.push("The payload counts " + clippedN + " " +
        ftsPlural(clippedN, "cell", "cells") + " past the " + capTxt + "-point cap, but at the four " +
        "decimals the wire publishes none of them exceeds it, so none is marked");
    }
    const crowded = isNum(panel.crowded);
    if (crowded !== null && crowded > 0) {
      notes.push(crowded + " further " + ftsPlural(crowded, "contract falls", "contracts fall") +
        " into a band already occupied. THE CELL IS NEVER AN AVERAGE: one quoted contract is shown " +
        "— today's print first, then nearest the band's centre — because averaging two quoted " +
        "volatilities produces a number nobody quoted");
    }
    const windowed = [];
    const eS = isNum(panel.expiriesShown), eT = isNum(panel.expiriesTotal);
    const rS = isNum(panel.rowsShown), rT = isNum(panel.rowsTotal);
    if (eS !== null && eT !== null && eS < eT) windowed.push(eS + " of " + eT + " expiries");
    if (rS !== null && rT !== null && rS < rT) windowed.push(rS + " of " + rT + " moneyness bands");
    if (windowed.length) notes.push("Showing " + windowed.join(" and ") + ", nearest the money");
    if (panel.ivBasis) {
      notes.push("Volatility units resolved once for the whole chain: " + panel.ivBasis);
    }
    notes.push("Quoted volatilities, and differences between quoted volatilities on the same " +
      "expiry. Nothing here is fitted, interpolated or repriced — that would need a rate and a " +
      "dividend yield, which this desk does not invent. The band on a cell's tooltip is the band's " +
      "stated centre, not that contract's own moneyness, which the card payload does not carry");
    appendNotes(host, notes, "How to read this surface");

    /* ---- coverage, which is ALWAYS stated ---------------------------- */
    /* Its own paragraph, and the truncated sentence is VERBATIM. This is the
       line that says the whole picture may be an arbitrary slice of the book,
       and a sentence like that must not be sanded into the middle of a
       paragraph of decoder prose. */
    const cov = panel.coverage;
    if (cov && cov.truncated === true) {
      host.append(el("p", "fc-note",
        "The vendor returned a full page of 500 contracts in no documented order. This is an " +
        "arbitrary subset of the book — the skew and term readings are withheld for that reason."));
    } else if (cov) {
      const seen = isNum(cov.rowsSeen), priced = isNum(cov.pricedRows);
      host.append(el("p", "fc-note",
        "The vendor returned the whole chain" +
        (seen === null ? "" : ": " + seen + " " + ftsPlural(seen, "contract", "contracts") +
          (priced === null ? "" : ", " + priced + " of them priceable")) +
        ", so this surface is taken over the entire book rather than a page of it." +
        (cov.filter ? " " + cov.filter.charAt(0).toUpperCase() + cov.filter.slice(1) + "." : "")));
    } else {
      /* A panel built before chainPanel() wrapped coverage on has no coverage
         key. "No coverage was published" is a fact; silence would read as
         "the whole book", which is the claim this page exists to refuse. */
      host.append(el("p", "fc-note",
        "This card publishes no coverage record for the chain, so how much of the book this " +
        "surface was taken over is not known."));
    }
  }

  /* ===== skewterm ===== */
  /* =============================================================
     drawSkewTerm — the at-the-money volatility TERM STRUCTURE, plus
     the chain's two scalars as text.

     WHAT IS IDENTIFIED, AND FROM WHAT. Every number this panel draws
     is already published on `card.panels.skewTerm`; the panel reads no
     vendor field and invents nothing.

       points[j].atmIv   the implied volatility of the contract nearest
                         the money THAT TRADED TODAY, inside the band
                         `panel.atmBand` of log-moneyness, for expiry j.
                         `null` when the surface refused to level that
                         column, and then `points[j].reason` says why.
                         NOTE THE FIELD NAME: the per-point reason is
                         `reason`, not `atmReason`. `panel.atmReason`
                         exists too and is a DIFFERENT thing — the reason
                         the panel-level scalar `atmIv` was withheld.
       skew              put iv(ln K/S = −0.10) − call iv(ln K/S = +0.10)
                         on the nearest expiry at or past 7 days quoting
                         BOTH wings; nearest listed strike within 0.04 of
                         each target; NO interpolation. Never a delta —
                         25-delta skew needs a rate and a dividend yield,
                         neither of which this page has, and that refusal
                         is the reason the fixed-moneyness pair exists.
       term              atm iv(nearest levelled expiry past 45 days)
                         − atm iv(nearest past 7 days).

     The panel's own `relation` string carries all of that verbatim and is
     printed at the foot, so a reader never has to take this comment's
     word for it — and so this file's hardcoded ±0.10 / 0.04 / 7 have
     something to be checked against.

     THE LABELLED CHOICES THIS RENDERER MAKES, all named on the panel:

     1. THE Y AXIS RUNS FROM ZERO TO THE NEXT ROUND VOLATILITY POINT
        STRICTLY ABOVE THE LARGEST LEVEL DRAWN. The spec offered
        `1.08 × max(atmIv)` or "the next round volatility point above the
        maximum, which is the better option if you can do it cleanly".
        This takes the second: 1.08 is a multiplier nobody chose for a
        reason, and it lands the axis top on a number no tick would ever
        print — on the measured fixture, 1.08 × 0.328 = 0.35424. The round
        rule reuses the codebase's own `niceStep` against max/4, which
        gives a top of 35.0% on a 5-point ladder. STRICTLY above, so a
        maximum that is already an exact multiple of the step gets one
        more step and the tallest bar never touches the frame. The top,
        the ladder and the maximum are all printed.

     2. ORIGIN AT ZERO, AND WHY THE BARS LOOK ALIKE. `atmIv` is an
        unsigned LEVEL, so it grows from a baseline that means zero
        implied volatility and gets no zero tick — there is no "no change"
        reading to draw a rule at. The cost is real and is stated: eight
        levels between 21% and 34% render as eight bars of similar height.
        The POLYLINE is what carries the shape. A truncated axis would
        make every term structure look dramatic by construction, which is
        the trade being refused here rather than taken quietly.

     3. COLUMNS ARE EVENLY SPACED BY LISTED EXPIRY, NOT BY ELAPSED TIME.
        Stated verbatim in the note, exactly as the surface above states
        it. The tenor is printed beneath every column that is labelled.

     4. A MISSING LEVEL IS NOT DRAWN ON THE BASELINE. This is the single
        most important rule in this panel. The baseline is y = 0, which is
        the position meaning ZERO IMPLIED VOLATILITY, so a level the
        surface explicitly refused to vouch for would be drawn at the one
        coordinate on the canvas that reads as a confident measurement of
        nothing. Missing points sit on a dedicated `.ftm-missrail` BELOW
        the axis, outside the plot, each wrapped in a `<g>` carrying that
        expiry's own stated reason as a `<title>`, and the polyline BREAKS
        across them rather than drawing a segment through a value nobody
        measured — the break is `renderPath`'s, `flows-panels.js:1707-1715`.

     5. THE TWO SCALARS ARE TEXT, NOT MARKS, AND CARRY NO HUE. `skew` has
        polarity −1 (`shared/flows-card.js`: put iv − call iv, the SAME
        construction as `riskReversal`; puts bid is BEARISH), so a
        POSITIVE skew tinted by its sign rather than by a polarity lookup
        would be tinted UP — the classic error on this field, and the
        reason the spec prescribes words. Direction is given IN WORDS
        beside the signed number, which survives a monochrome print and a
        reader who cannot separate the two hues. `polarityOf()` lives in
        `shared/`, which is in `.assetsignore` and never reaches the
        browser, so a hue here could only come from a SECOND copy of the
        polarity table — a second answer to the same question. There is
        no hue on this panel at all.

     6. THE COLUMN GRID IS BORROWED FROM THE SIBLING SURFACE WHEN THE TWO
        PANELS AGREE ABOUT WHICH EXPIRIES EXIST. `skewTerm` is `span: 2`
        and sits adjacent to `ivSurface`, so both mount at the identical
        host width and share `labelW = 46`, `padR = 10` and
        `colW = plotW / columns.length`; the j-th bar centre and the j-th
        surface column centre then coincide to the pixel. See the block
        comment on `termColumns` for the MEASURED case where the two
        panels do not agree, which is a live pipeline defect this panel
        has to survive rather than a hypothetical.

     WHAT THIS PANEL EMITS NO ID FOR. No `<defs>`, no `<pattern>`, no
     `<clipPath>`, no element id of any kind — there is no sign to hatch
     here, only an unsigned level. `mount` is therefore accepted and
     unused, deliberately: the suffix rule exists to keep two mounts of
     one panel from sharing a `url(#…)` target, and a panel with no ids
     cannot collide with its own second copy.
     ============================================================= */

  function drawSkewTerm(host, panel, card, question, mount) {
    /* THE SCAFFOLDING IS NEVER REIMPLEMENTED. `isNum` in particular: it returns
       null for anything that is not a finite number, and a fourth copy of it is
       a fourth chance to write `Number(v) || 0` and turn a missing reading into
       a confident zero. */
    const { el, svgEl, isNum, deadPanel, panelHead, statList, niceStep,
      DASH, MINUS, vol1 } = window.FlowsPanels;

    const q = question ||
      "Is the front bid over the back, and which wing is bid?";

    /* THE TAGGED UNION, BEFORE ANY ARITHMETIC. A card published before the
       chain leg shipped has no `skewTerm` key at all, and `undefined` is a
       different state from a panel that was built and failed — the reader is
       owed which one it was. */
    if (panel === undefined || panel === null) {
      return deadPanel(host, q,
        "this card was built before the option chain leg shipped");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    const points = Array.isArray(panel.points) ? panel.points : [];
    if (!points.length) {
      return deadPanel(host, q,
        "the chain produced no listed expiries, so there is no term structure to draw");
    }

    panelHead(host, q);

    /* [300, 1900]. The floor is the chart floor the 30rem panel rule protects
       (measured: a 320px viewport gives a 284.8px host). The ceiling binds only
       in the enlarge dialog on a very wide screen: at min(96rem, 96vw) less
       2×1.7rem the host reaches 1481px; the binding case is now a full-row
       .is-wide at the three-column tier (1823px), and 1900 clears it — see
       the policy note on panelWidth in flows-panels.js. The old 1200 is
       stated as a choice rather than described as inert. */
    const W = Math.max(300, Math.min(1900, Math.round(host && host.clientWidth) || 560));

    /* ---------- geometry, shared verbatim with the surface above ------ */

    /* THESE CONSTANTS ARE A CROSS-PANEL CONTRACT, NOT A STYLE.
       `labelW`, `padR`, `plotW` and `colW` are the surface's, character for
       character, because the two panels are adjacent `span: 2` hosts of the
       identical width and the suite asserts |x_surface[j] − x_term[j]| ≤ 1 for
       every j. Changing any of them here without changing it there breaks an
       alignment a reader reads BY EYE, one panel directly above the other, long
       before a test catches it. */
    const labelW = 46, padR = 10;
    const padT = 12, plotH = 132, padB = 30, railH = 14;
    const H = padT + plotH + padB + railH;           // 12 + 132 + 30 + 14 = 188
    const plotL = labelW;
    const plotW = Math.max(60, W - labelW - padR);
    const baseY = padT + plotH;                      // the zero line, y = 144
    const railY = baseY + railH / 2;                 // the miss rail, y = 151

    const grid = termColumns(panel, card, points);
    const cols = grid.cols;
    const colW = plotW / cols.length;
    const cxOf = (j) => plotL + colW * (j + 0.5);
    /* A bar under 2px is a hairline pretending to be a bar; a bar over 34 is a
       slab wide enough to hide the dot marking its own value. */
    const barW = Math.max(2, Math.min(colW - 8, 34));

    const levelOf = (col) => (col.point ? isNum(col.point.atmIv) : null);
    const tenorOf = (col) => (col.days === null ? "an unstated tenor" : col.days + " days");

    /* ---------- the scale ------------------------------------------- */

    const levels = cols.map(levelOf);
    const measured = levels.filter((v) => v !== null);
    const maxIv = measured.length ? Math.max(...measured) : null;

    /* THE NEXT ROUND VOLATILITY POINT STRICTLY ABOVE THE MAXIMUM. `niceStep` is
       the codebase's own round-ladder helper (1, 2, 2.5 or 5 × a power of ten);
       asking it for max/4 targets four or five ticks, which is what fits in
       132px at 9px type. The `if` fires only when the maximum is already an
       exact multiple of the step, and its whole job is to keep the tallest bar
       off the frame. */
    let step = 0, top = 0, nTicks = 0;
    if (maxIv !== null && maxIv > 0) {
      step = niceStep(maxIv / 4) || maxIv / 4;
      top = Math.ceil(maxIv / step) * step;
      if (top <= maxIv) top += step;
      nTicks = Math.round(top / step);
    }
    const yOf = (v) => baseY - (v / top) * plotH;

    /* ---------- the canvas ------------------------------------------- */

    const svg = svgEl("svg", {
      class: "ftm", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      preserveAspectRatio: "xMidYMid meet", role: "img",
    });

    /* PRESENTATION ATTRIBUTES ON EVERY <text>, not stylesheet-only rules. A
       <text> with no CSS renders in the document's body font at whatever size it
       inherits, so a renderer that ships before its rules do would draw
       something actively wrong rather than something plain. Any CSS rule of the
       same name still wins over an attribute — the same trade `renderPath`
       records for its strokes. */
    const text = (cls, attrs, size, content) => {
      const t = svgEl("text", Object.assign({
        class: cls, "font-family": "var(--font-mono)", "font-size": size,
        fill: "currentColor",
      }, attrs));
      t.textContent = content;
      return t;
    };

    /* -- y ticks. Drawn only when there IS a scale: a ladder of ticks over a
          panel with no measured level is a ruler against nothing — and `yOf`
          divides by `top`, so with no scale it would emit y="NaN" on every
          label, which SVG discards silently and a browser reports only to the
          console. Counted in integers rather than accumulated by +=, so the last
          tick is exactly `top` and not `top` minus a float epsilon. */
    if (top > 0) {
      for (let i = 0; i <= nTicks; i++) {
        const v = i * step;
        const yy = Number(yOf(v).toFixed(1));
        /* NO ZERO RULE — the spec's "gets no zero tick", read as what it is
           guarding against. On the signed panels (`renderGamma`'s `.fa-zero`,
           `renderPath`'s `.fp-zero`) the zero tick is a RULE ACROSS THE PLOT
           marking which side of it means bearish, and an unsigned level has no
           such side, so drawing one would invent a boundary. The baseline below
           is already that line, drawn solid, and two rules at one y is one rule
           that looks doubled.

           The 0.0% LABEL is kept, and deliberately. It is the only thing on the
           canvas that lets a reader verify the origin-at-zero choice by eye; an
           axis whose lowest printed number is 5.0% at a gridline just above the
           baseline invites exactly the "this axis is truncated" reading that
           choice exists to prevent. If the integrator reads that sentence as
           forbidding the label too, deleting it is this one `if`. */
        if (i > 0) {
          svg.append(svgEl("line", {
            class: "ftm-axis", x1: plotL, x2: plotL + plotW, y1: yy, y2: yy,
            stroke: "currentColor", "stroke-opacity": 0.16,
          }));
        }
        svg.append(text("ftm-lab", {
          x: labelW - 6, y: yy + 3, "text-anchor": "end",
        }, 9, vol1(v)));
      }
    }

    /* -- the baseline. It is the AXIS, not a zero rule: `atmIv` is unsigned and
          nothing can sit below it, so it is drawn once, solid, and never
          labelled as a reading of "no skew". */
    svg.append(svgEl("line", {
      class: "ftm-base", x1: plotL, x2: plotL + plotW, y1: baseY, y2: baseY,
      stroke: "currentColor", "stroke-opacity": 0.5,
    }));

    /* -- the miss rail, below the axis and outside the plot. Drawn only when
          something is parked on it, so an all-levelled panel does not carry a
          rule explaining an absence it does not have. */
    const missing = cols.filter((c) => levelOf(c) === null);
    if (missing.length) {
      svg.append(svgEl("line", {
        class: "ftm-missrail", x1: plotL, x2: plotL + plotW, y1: railY, y2: railY,
        stroke: "currentColor", "stroke-opacity": 0.28, "stroke-dasharray": "2 3",
      }));
    }

    /* -- bars, and the line that breaks across what was never measured ---- */

    let d = "", open = false;
    cols.forEach((col, j) => {
      const cx = cxOf(j);
      const v = top > 0 ? levelOf(col) : null;

      if (v === null) {
        /* NOT ON THE BASELINE. A hollow marker on the rail, below the axis,
           inside a <g> whose <title> is this expiry's own stated reason. The
           <title> is a child of the GROUP and never of a <text>: a <title>
           inside a <text> is not painted but IS part of its textContent, which
           corrupts every test that reads a label. */
        const why = col.point
          ? (col.point.reason || panel.atmReason ||
             "the surface levelled no at-the-money contract for this expiry")
          : grid.uncoveredReason;
        const g = svgEl("g", {});
        const title = svgEl("title", {});
        title.textContent = col.expiry +
          (col.days === null ? "" : ` (${col.days}d)`) + ": " + why;
        g.append(title);
        g.append(svgEl("circle", {
          class: "ftm-dot is-missing", cx: Number(cx.toFixed(1)), cy: railY, r: 2.6,
          fill: "none", stroke: "currentColor", "stroke-width": 1.2,
        }));
        svg.append(g);
        open = false;                    // THE LINE BREAKS ACROSS IT.
        return;
      }

      const yTop = yOf(v);
      svg.append(svgEl("rect", {
        class: "ftm-bar", x: Number((cx - barW / 2).toFixed(1)), y: Number(yTop.toFixed(1)),
        width: Number(barW.toFixed(1)),
        height: Number(Math.max(0.5, baseY - yTop).toFixed(1)),
        fill: "currentColor", "fill-opacity": 0.28,
      }));
      d += (open ? "L" : "M") + cx.toFixed(1) + " " + yTop.toFixed(1) + " ";
      open = true;
    });

    /* The line goes ON TOP of the bars and UNDER the dots: the bar is the level,
       the line is the shape, the dot is the measurement. A single measured
       column emits one "M" and no "L", which paints nothing — correct, because
       one point is not a term structure and a line through it would be an
       extrapolation the payload does not support. */
    if (d) {
      svg.append(svgEl("path", {
        class: "ftm-line", d: d.trim(), fill: "none", stroke: "currentColor",
        "stroke-width": 1.8, "stroke-linejoin": "round",
      }));
    }
    cols.forEach((col, j) => {
      const v = top > 0 ? levelOf(col) : null;
      if (v === null) return;
      const g = svgEl("g", {});
      const title = svgEl("title", {});
      title.textContent = col.expiry + (col.days === null ? "" : ` (${col.days}d)`) +
        ": at-the-money iv " + vol1(v);
      g.append(title);
      g.append(svgEl("circle", {
        class: "ftm-dot", cx: Number(cxOf(j).toFixed(1)), cy: Number(yOf(v).toFixed(1)),
        r: 2.6, fill: "currentColor",
      }));
      svg.append(g);
    });

    /* -- column labels: the expiry, then its tenor beneath it ------------ */

    /* WIDEST LABEL FIRST, THEN THE STRIDE. "08-31" is five characters; at 9.5px
       mono that is 5 × 6 × 0.95 = 28.5px, plus 4px of breathing. A column
       narrower than that gets every other label rather than a row of
       overlapping dates — the same squeeze the surface's own column heads live
       with at a 320px viewport, where colW is 30.5. The last column is always
       labelled, because the far end of a term structure is the half a reader
       came for. */
    const labelNeed = 5 * 6 * 0.95 + 4;
    const stride = Math.max(1, Math.ceil(labelNeed / Math.max(1, colW)));
    cols.forEach((col, j) => {
      if (j % stride !== 0 && j !== cols.length - 1) return;
      const cx = Number(cxOf(j).toFixed(1));
      /* ISO DATES KEEP THEIR HYPHENS. The U+2212 rule is about a minus sign
         standing for a negative quantity; "08-31" is a date, and swapping its
         separator for a minus would make it a subtraction. */
      svg.append(text("ftm-lab", { x: cx, y: baseY + railH + 11, "text-anchor": "middle" },
        9.5, String(col.expiry || "").slice(5) || DASH));
      svg.append(text("ftm-lab is-tenor", { x: cx, y: baseY + railH + 21, "text-anchor": "middle" },
        9, col.days === null ? DASH : col.days + "d"));
    });

    /* -- the reading a screen reader gets -------------------------------- */

    const firstM = cols.find((c) => levelOf(c) !== null);
    const lastM = cols.slice().reverse().find((c) => levelOf(c) !== null);
    const plural = cols.length === 1 ? "expiry" : "expiries";
    svg.setAttribute("aria-label",
      measured.length === 0
        ? `At-the-money implied volatility across ${cols.length} listed ${plural}: no expiry ` +
          "carried a level this session, so no bar is drawn and every column is marked on " +
          "the rail below the axis."
        : `At-the-money implied volatility across ${cols.length} listed ${plural}, ` +
          (measured.length === 1
            ? `a single level of ${vol1(levelOf(firstM))} at ${tenorOf(firstM)}.`
            : `from ${vol1(levelOf(firstM))} at ${tenorOf(firstM)} to ` +
              `${vol1(levelOf(lastM))} at ${tenorOf(lastM)}.`) +
          (missing.length
            ? ` ${missing.length} of ${cols.length} columns carry no level and are marked ` +
              "on the rail below the axis."
            : ""));
    host.append(svg);

    /* ---------- the two scalars, as TEXT ------------------------------ */

    /* THE SKEW READING IS THE FIRST .fc-reading ON THE PANEL, and when the skew
       is withheld it carries NO DIGIT. That is not a stylistic preference: the
       contract test scopes "draws no skew number" to `.fc-reading`, which
       resolves to the FIRST one, and the modal truncated card withholds the
       skew while publishing perfectly good levels above it. Each scalar gets its
       own reading element, so a withheld skew beside a published term is still a
       digit-free first reading. */
    const skew = isNum(panel.skew);
    const skewB = panel.skewBasis || null;
    const skewRead = el("p", "fc-reading");
    if (skew === null || !skewB) {
      skewRead.textContent =
        "The wing-to-wing skew is not published for this name. The reason it was " +
        "withheld is stated below, verbatim, rather than replaced by a zero — a " +
        "symmetric smile is a real and notable reading, and this is not one.";
    } else {
      /* VOLATILITY POINTS, one decimal, the same precision every level on this
         panel is printed to. The sign glyph comes from `signed`, which is U+2212
         and not the hyphen `toFixed` emits. */
      skewRead.textContent =
        `Skew ${volPts(skew)} volatility points at ` +
        `${skewB.days === null ? "an unstated tenor" : skewB.days + " days"} ` +
        `(${skewB.expiry}): ` +
        (skew > 0
          ? "the put wing is bid over the call wing."
          : skew < 0
            ? "the call wing is bid over the put wing."
            : "both wings are quoted at the same volatility.");
    }
    host.append(skewRead);

    /* THE BASIS IS PART OF THE READING, NOT A FOOTNOTE. "Skew +7.0 points" is
       meaningless without the moneyness each wing actually sat at: the pair is
       the nearest LISTED strike to ±0.10, never an interpolation, so the wings
       of a thin chain can sit near the edge of the tolerance and the number is a
       different number then. Printed with the tolerance and the day floor that
       admitted them.

       THE THREE CONSTANTS BELOW ARE HARDCODED, AND THAT IS A KNOWN HAZARD.
       SKEW_MONEYNESS (0.10), SKEW_TOLERANCE (0.04) and SKEW_MIN_DAYS (7) reach
       the browser only inside `panel.relation`'s prose — there is no numeric
       field for any of them — so a renderer that wants to name them has to
       restate them. The defence is that `relation` is printed verbatim at the
       foot of this panel, where a divergence is visible on the same screen.
       `panel.atmBand` is NOT one of these: it is the surface's at-the-money
       band, a different constant that happens to share the value 0.10. */
    if (skew !== null && skewB) {
      host.append(statList([
        ["Put wing", wingText(skewB.putM, skewB.putStrike, skewB.putIv, skewB.putTraded)],
        ["Call wing", wingText(skewB.callM, skewB.callStrike, skewB.callIv, skewB.callTraded)],
        ["Target", "ln(K/S) = " + MINUS + "0.10 and +0.10, nearest listed strike within 0.04"],
        ["Expiry floor", "7 days — measured on " + skewB.expiry +
          (skewB.days === null ? "" : " (" + skewB.days + "d)")],
      ]));
    }

    const term = isNum(panel.term);
    const termB = panel.termBasis || null;
    const termRead = el("p", "fc-reading");
    if (term === null || !termB) {
      termRead.textContent =
        "The term difference is not published for this name. The reason it was " +
        "withheld is stated below, verbatim.";
    } else {
      /* term = far − near, so a NEGATIVE term is the FRONT bid over the back:
         the near level is the higher one. Getting this backwards inverts the
         whole reading, which is why the direction is spelled out beside the
         signed number instead of being left to the sign. */
      termRead.textContent =
        `Term ${volPts(term)} volatility points from ` +
        `${termB.nearDays} days to ${termB.farDays} days: ` +
        (term < 0
          ? "the front is bid over the back — "
          : term > 0
            ? "the back is bid over the front — "
            : "front and back are quoted at the same level — ") +
        `at-the-money volatility ${vol1(termB.nearAtm)} at ${termB.near} against ` +
        `${vol1(termB.farAtm)} at ${termB.far}.`;
    }
    host.append(termRead);

    if (term !== null && termB) {
      host.append(statList([
        ["Near leg", termB.near + " (" + termB.nearDays + "d) · " + vol1(termB.nearAtm)],
        ["Far leg", termB.far + " (" + termB.farDays + "d) · " + vol1(termB.farAtm)],
        ["Far floor", "45 days — the nearest LEVELLED expiry at or past it"],
      ]));
    }

    /* The panel's headline at-the-money level, and how much of the drawn grid
       the term line could actually level. `measured` counts what is DRAWN, which
       is what a reader is looking at; `panel.levelled` counts the panel's own
       points, and the two differ exactly when the grid was borrowed — see
       `termColumns`. */
    const atm = isNum(panel.atmIv);
    const stats = statList([
      ["At-the-money level", atm === null ? DASH
        : vol1(atm) + (panel.atmExpiry ? " at " + panel.atmExpiry : "")],
      ["Expiries levelled", `${measured.length} of ${cols.length} drawn`],
      ["Moneyness band", isNum(panel.atmBand) === null ? DASH
        : "±" + panel.atmBand.toFixed(2) + " ln(K/S)"],
    ]);
    /* THE DASH CARRIES ITS REASON. `statList` takes strings, so the title goes
       on afterwards rather than through a second copy of the helper — a missing
       level with no reason attached is exactly the state house rule 1 forbids. */
    if (atm === null && panel.atmReason) {
      const dd = stats.querySelector("dd");
      if (dd) dd.title = panel.atmReason;
    }
    host.append(stats);

    /* ---------- the notes: every choice, and every stated absence ------ */

    const scaleNote = el("p", "fc-note");
    scaleNote.textContent =
      "Columns are evenly spaced by listed expiry, not by elapsed time. Each " +
      "column's tenor is printed beneath it. " +
      (top > 0
        ? `The axis runs from zero to ${vol1(top)} — the next round volatility point ` +
          `above the largest level drawn (${vol1(maxIv)}), on a ${vol1(step)} ladder. That is a ` +
          "round number rather than a headroom multiplier, so every tick is a volatility a " +
          "reader recognises. "
        : "There is no vertical scale: nothing on this chain carried a level to scale to. ") +
      "The origin is ZERO because at-the-money volatility is a level, not a change — " +
      "there is no “no move” reading to rule, and a truncated axis would make any " +
      "term structure look dramatic by construction. The cost is that levels a few points " +
      "apart draw as bars of similar height: read the LINE for the shape and the bars for " +
      "the level.";
    host.append(scaleNote);

    if (missing.length) {
      host.append(el("p", "fc-note",
        `${missing.length} of ${cols.length} columns carry no at-the-money level and sit on ` +
        "the rail BELOW the axis, not on it. The baseline is zero implied volatility, so a " +
        "level the surface refused to vouch for would be drawn there as a confident " +
        "measurement of nothing. Each marker carries that expiry's own stated reason, and " +
        "the line breaks across them rather than crossing a value nobody measured."));
    }

    if (grid.borrowedNote) host.append(el("p", "fc-note", grid.borrowedNote));

    /* COVERAGE IS ALWAYS STATED, and the reason is printed VERBATIM. A panel
       that shows a clean eight-point term line off a page the vendor truncated
       looks exactly like a panel built from the whole book. `coverage` rides on
       THIS panel (chainPanel adds it to every ok chain panel); the sibling
       surface is read only as a fallback for a card that predates that. */
    const cov = panel.coverage ||
      (card && card.panels && card.panels.ivSurface && card.panels.ivSurface.coverage) || null;
    if (cov) {
      const parts = [];
      if (cov.truncated) {
        const seen = isNum(cov.rowsSeen), pricedRows = isNum(cov.pricedRows);
        parts.push("THIS CHAIN WAS TRUNCATED." +
          (seen === null ? "" : ` The vendor returned ${seen} rows` +
            (pricedRows === null ? "." : `, ${pricedRows} of them quoted.`)) +
          " The levels drawn above are built from that slice of the book, not from the book.");
      }
      if (cov.filter) parts.push("Selection: " + cov.filter + ".");
      if (parts.length) host.append(el("p", "fc-note", parts.join(" ")));
    }

    /* The withheld-scalar reasons, verbatim and unsummarised. Two identical
       reasons print ONCE: on a truncated card `skewReason` and `termReason` are
       the same sentence, and printing it twice reads as two separate failures. */
    const reasons = [];
    if (skew === null && panel.skewReason) reasons.push(["The skew", panel.skewReason]);
    if (term === null && panel.termReason) reasons.push(["The term difference", panel.termReason]);
    if (reasons.length === 2 && reasons[0][1] === reasons[1][1]) {
      host.append(el("p", "fc-note", "Neither scalar is published: " + reasons[0][1] + "."));
    } else {
      for (const pair of reasons) {
        host.append(el("p", "fc-note", pair[0] + " is not published: " + pair[1] + "."));
      }
    }

    /* THE STATED RELATION, VERBATIM, LAST. Everything above is this renderer's
       paraphrase; this is the payload's own sentence, and it is what a reader
       should believe if the two ever disagree. It also carries the ±0.10, the
       0.04 and the 7 days as the pipeline actually holds them, which is the only
       defence against this file's restated copies of those three drifting. */
    if (panel.relation) host.append(el("p", "fc-note", panel.relation));
  }


  /* ---------- private helpers -------------------------------------- */

  /**
   * A difference of two implied volatilities, in VOLATILITY POINTS.
   *
   * One decimal, the same precision the levels on this panel are printed to,
   * and U+2212 for a negative because `signed` supplies it and `toFixed` does
   * not. An EXACT zero gets no sign glyph: a measured zero has no direction,
   * and "+0.0" over the words "both wings are quoted at the same volatility"
   * reads as a small positive that has been rounded away. A skew that is merely
   * SMALL still gets its sign, because it still has one.
   */
  function volPts(v) {
    const { signed } = window.FlowsPanels;
    return v === 0 ? "0.0" : signed(v * 100, (a) => a.toFixed(1));
  }

  /**
   * One wing of the skew pair, as a phrase.
   *
   * The moneyness is the ACTUAL one the listed strike sat at, never the target:
   * the pair is chosen by "nearest listed strike within the tolerance, freshness
   * before distance, no interpolation", so a thin chain's wings can sit most of
   * a tolerance away from ±0.10 and a reader shown only the target would think
   * they were reading a number nobody quoted. Measured on the fixture: the put
   * wing sat at −0.1051 and the call at +0.1050.
   *
   * `traded` is 1 / 0 / null and the third state is load-bearing: "the vendor
   * sent no volume field" is not "this contract did not trade", and a wing that
   * was quoted but never changed hands is weaker evidence than one that did.
   */
  function wingText(m, strike, iv, traded) {
    const { isNum, DASH, signed, px2, vol1 } = window.FlowsPanels;
    const mm = isNum(m), kk = isNum(strike), vv = isNum(iv);
    if (mm === null && kk === null && vv === null) return DASH;
    return "ln(K/S) " + (mm === null ? DASH : signed(mm, (a) => a.toFixed(4))) +
      " · K " + (kk === null ? DASH : px2(kk)) +
      " · iv " + (vv === null ? DASH : vol1(vv)) +
      " · " + (traded === 1 ? "traded today"
        : traded === 0 ? "quoted, did not trade today"
          : "volume not reported");
  }

  /**
   * The column grid the bars are drawn on — and the one pipeline defect this
   * panel has to survive.
   *
   * THE CLAIM. `buildSkewTerm` maps `surface.expiries` straight through
   * (`shared/flows-chain.js:373`) and `buildChainPanels` hands the SAME
   * serialised object to both panels (`:704-705`), so `points[j].expiry` is
   * `ivSurface.expiries[j].expiry` for every j and the two panels cannot
   * disagree about which columns exist.
   *
   * THE MEASUREMENT. That holds for 48 of 50 emitted cards. On the two TRUNCATED
   * ones it is FALSE, and truncation is the case this page was designed for: the
   * pipeline spends a second, expiry-filtered call when the first page fills,
   * then splices the scalars AND the whole `skewTerm` panel out of the narrow
   * read while `ivSurface` keeps the broad one
   * (`scripts/flows-pipeline.mjs:3941-3949`). Measured on a freshly emitted
   * SYN212 and SYN306: `ivSurface.expiries.length === 8` against
   * `points.length === 1`. The two panels are stacked one above the other and
   * their columns do not line up.
   *
   * WHAT THIS DOES ABOUT IT. When every published point's expiry is found among
   * the surface's, the grid is the SURFACE'S columns and each point is placed in
   * the column it belongs to. The alignment invariant then holds on the
   * truncated card as well as the clean one — the single narrow level lands
   * under the surface column of the same expiry — and the columns the term line
   * does not cover are drawn as what they are: columns with no reading, on the
   * miss rail, with the reason stated. The alternative, one lonely bar centred
   * across a 900px plot beneath an eight-column surface, is a chart that lies
   * about which expiry it is describing.
   *
   * IT DOES NOT BORROW THE SURFACE'S LEVELS, only its column positions. A level
   * this panel never published stays undrawn; reading `atmIv` off the sibling
   * panel would paper over the splice and put numbers on this chart that its own
   * payload does not contain.
   */
  function termColumns(panel, card, points) {
    const { isNum } = window.FlowsPanels;

    const own = {
      cols: points.map((p) => ({ expiry: p.expiry, days: isNum(p.days), point: p })),
      borrowedNote: null,
      uncoveredReason: "this expiry carries no at-the-money reading on this panel",
    };

    const surf = card && card.panels && card.panels.ivSurface;
    const expiries = surf && surf.status === "ok" && Array.isArray(surf.expiries)
      ? surf.expiries : null;
    if (!expiries || !expiries.length) return own;

    const byExpiry = new Map();
    for (const p of points) if (p && p.expiry) byExpiry.set(p.expiry, p);
    /* A duplicate or absent expiry would silently drop a point. Refuse the
       borrow rather than lose a measurement to a layout convenience. */
    if (byExpiry.size !== points.length) return own;
    if (!points.every((p) => expiries.some((e) => e.expiry === p.expiry))) return own;

    const cols = expiries.map((e) => ({
      expiry: e.expiry,
      days: isNum(e.days),
      point: byExpiry.get(e.expiry) || null,
    }));
    /* Identical lists — the overwhelmingly common case — make the borrow a
       no-op, and a note explaining a difference that does not exist is noise. */
    const identical = expiries.length === points.length &&
      expiries.every((e, j) => e.expiry === points[j].expiry);

    return {
      cols,
      borrowedNote: identical ? null
        : `The term line covers ${points.length} of the ${cols.length} expiries drawn on the ` +
          "surface above. The two panels were built from DIFFERENT reads of the same chain: " +
          "the surface from the broad call, the term line from a second, single-expiry call " +
          "the pipeline spends when the first page truncates. Columns are held aligned with " +
          "the surface, so the same x position means the same expiry on both panels, and the " +
          "expiries the term line does not cover carry no mark.",
      uncoveredReason:
        "the term line was rebuilt from a single-expiry read after the broad page truncated, " +
        "so it carries no level for this expiry",
    };
  }

  /* ===== topcontracts ===== */
  /* =============================================================
     drawTopContracts — panels.topContracts, the day's most-traded
     option contracts, as a sortable table.

     NOT A CHART, AND DELIBERATELY NOT ONE. Every other panel on this
     page answers a question about a SHAPE — where gamma sits, what the
     smile does with tenor, which side of the book is being lifted — and
     a shape is what a chart is for. This panel answers "which single
     lines carried the volume", and the answer is ten rows of nine
     quantities that are not commensurable with each other: a strike is
     a price, a volume is a count, an expiry is a date. Any encoding
     that put them on a shared visual scale would be inventing a
     comparison the data does not contain. A table prints each number in
     its own units and lets the reader do the comparing, which is the
     honest form here.

     IDENTIFICATION. Nothing on this panel is estimated. Every column is
     a vendor observable or a difference of two of them, and the two
     differences are named beside the table:

       Strike   option_symbol strike field / 1000
       Expiry   option_symbol expiry field, as an ISO date
       C/P      option_symbol type field
       Vol      volume, verbatim
       OI       open_interest, verbatim
       dOI      open_interest - prev_oi          <- a DIFFERENCE
       Bid      nbbo_bid, verbatim
       Ask      nbbo_ask, verbatim
       Net aggr ask_volume - bid_volume          <- a DIFFERENCE, in contracts

     There is no free parameter here: no rate, no dividend, no
     interpolation, no volatility model. The one derived number that
     does not come off the wire is the day count in the Expiry title,
     which is calendar days between the card's own sessionDate and the
     contract's expiry — stated as a CHOICE below, because "days" could
     equally have meant trading days and the two differ by a third.

     THE CHOICES THIS PANEL MAKES, each labelled where it is made:

     CHOICE 1 - NO MID COLUMN. (bid + ask) / 2 is the single most
     requested column on a table like this one and it is refused.
     A midpoint is a basis choice: it asserts that the true price sits
     exactly halfway across a spread that may be a penny wide or a
     dollar wide, and on the deep out-of-the-money lines that make this
     table interesting it is routinely neither. Bid and Ask are two
     adjacent columns, as quoted, and the reader who wants a midpoint
     can see exactly what they would be averaging. Refused upstream too,
     for the same reason: shared/flows-chain.js publishes bidPx and
     askPx and no mid.

     CHOICE 2 - NET AGGR IS IN CONTRACTS AND THE UNIT IS IN THE HEADER.
     A dollarised flow would need a price basis, which is CHOICE 1 again
     wearing a hat. The header reads "Net aggr (contracts)" so the unit
     cannot come apart from the number when the column is read on its
     own.

     CHOICE 3 - THE SIGN OF NET AGGR IS CARRIED BY A GLYPH FIRST AND BY
     HUE LAST. U+2191 / U+2193 lead the number, U+2212 marks negatives,
     and only then does a class hand CSS the flow palette. A reader who
     cannot separate red from green still gets the sign. The arrows are
     U+2191 and U+2193 and NOT U+25B2 / U+25BC: assets/css/base.css
     lists U+2191, U+2193 and U+2212 in the JetBrains Mono latin subset
     and does not list the triangles, so a triangle would fall through
     to the system stack and change the character advance halfway down a
     tabular-numeric column.

     CHOICE 4 - IMPLIED VOLATILITY IS IN THE STRIKE CELL'S TITLE, NOT IN
     A TENTH COLUMN. The alternative the spec allows is a tenth column
     shown only at >= 76rem, and it is rejected here for a mechanical
     reason: this panel is drawn ONCE per mount and is not redrawn when
     the viewport crosses a breakpoint (assets/js/flows-ticker.js
     redraws on resize, but a drawer that decided its own column count
     from matchMedia at draw time would be one debounce behind the
     layout, and a column that is present-but-wrong is worse than one
     that is absent). The title also keeps ln(K/S) and the volatility
     together, which is where they belong: they are the two facts that
     place a strike on the smile.

     CHOICE 5 - dOI GETS NO DIRECTIONAL HUE. shared/flows-card.js's
     POLARITY table has no `doi` entry, and polarityOf() returns 0 for a
     key it does not know. That is not an omission to be patched here: a
     rising open interest is not bullish and a falling one is not
     bearish, and tinting the column green and red would be inventing a
     direction for a quantity that has none. `aggr` IS in that table at
     +1 (calls lifted at the offer are bullish), so the Net aggr column
     is the ONE column on this panel that earns the flow palette.

     THE FOUR ABSENCES THAT WOULD BECOME LIES IF PRINTED AS ZERO:

     1. aggr === null is U+2014, never 0. "The vendor reported no
        aggressor split" and "the split was reported and it was
        balanced" are different facts and only one of them is a reading.
        A measured zero prints "0" with no arrow, because neither arrow
        is true at zero. The panel foot states how many of the rows
        shown carried a split at all.
     2. doi === null is U+2014, never 0. An open_interest present with
        prev_oi absent is NOT "no change" - it is "the change is not
        computable". An unchanged open interest prints 0.
     3. bidPx / askPx / iv / oi are each independently U+2014.
     4. Sort puts null LAST in both directions. Reversing a sort is
        where this is easiest to lose: negate the comparator wholesale
        and every unmeasured row floats to the top, where position reads
        as ranking. Unmeasured never wins a ranking - the rule
        assets/js/flows-board.js:531-554 and assets/js/flows-watch.js:
        205-211 already state, applied to a third table so there is one
        rule and not three.

     COVERAGE IS ALWAYS STATED, in both directions. The vendor's chain
     page tops out and a wide name has more contracts than fit on it, so
     `coverage.truncated` is a fact about the SAMPLE and it is printed
     whether it is true or false. What truncation means HERE is
     different from what it means on the surface panels, and the panel
     says which: the rows are not damaged - every line below is a
     contract that really traded, at the volume the vendor reported for
     it - but the SUPERLATIVE is. "The day's most-traded" is a claim
     about a ranking over the whole book, and a ranking over an
     arbitrary subset of the book is not that claim. So the rows stand
     and the headline is withdrawn, explicitly, in words.

     THE MOUNT TAG. This drawer emits no <svg>, no <defs> and no `id`
     attribute at all, so the document-global id collision the mount tag
     exists to prevent cannot arise here - and NOTHING BELOW MAY EMIT AN
     id WITHOUT SUFFIXING IT. `mount` is still load-bearing: it keys the
     per-mount sort state, so that the grid copy and the enlarged copy
     sort independently, and so that neither loses the reader's chosen
     order when flows-ticker.js redraws them on a resize.
     ============================================================= */

  /* The verbatim coverage sentence. It is quoted, not composed, because
     the same sentence has to appear on all four chain panels and a
     sentence assembled in four places is four sentences that will drift.
     It names 500 because that is the vendor's page ceiling; the actual
     row count that came back is put in the note's title, since it is
     measured and the sentence is not. */
  const TC_TRUNCATED_NOTE =
    "The vendor returned a full page of 500 contracts in no documented order. " +
    "This is an arbitrary subset of the book — the skew and term readings are " +
    "withheld for that reason.";

  /* Sort state per MOUNT, not per panel and not in the URL.
     Not in the URL because this panel is one of fourteen on the page and
     is mounted twice at once: a single ?sort= parameter cannot describe
     two tables, and stamping one would make the grid copy and the
     enlarged copy fight over it. Per mount rather than per draw because
     flows-ticker.js redraws both copies on a width change, and a redraw
     that silently threw away the order the reader had chosen would read
     as the table resetting itself for no reason. */
  const TC_SORT = new Map();

  /* Integer counts, grouped. Math.round before grouping because a
     contract count is an integer and a vendor that ever sends 2888.0000001
     should not print six decimals of noise into a column of counts. The
     locale is pinned to en-US rather than left to the reader's, so the
     separator cannot change under a column whose alignment depends on
     the character advance being uniform. */
  function tcInt(v) {
    const { isNum, DASH } = window.FlowsPanels;
    const n = isNum(v);
    return n === null ? DASH : Math.round(n).toLocaleString("en-US");
  }

  /* A signed integer with U+2212 for the minus and NO sign at all for
     zero. Zero here means "measured, and it was zero" - the sign glyph
     would claim a direction that a zero does not have. */
  function tcSignedInt(v) {
    const { isNum, DASH, MINUS } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) return DASH;
    const r = Math.round(n);
    const body = Math.abs(r).toLocaleString("en-US");
    return r < 0 ? MINUS + body : r > 0 ? "+" + body : "0";
  }

  /** A FRACTION RENDERED AS A PERCENT, WITH THE SIGN ON THE ROUNDED VALUE.
   *
   *  The vendor's `oi_change` is (curr-last)/last — 0.2153 is a 21.5% rise
   *  and 15.6149 is a 1561% one. It used to be drawn through tcSignedInt, so
   *  a contract that went 2,119 to 35,207 printed "+16" and one that grew
   *  21.5% printed "+0". The percent sign is not decoration here: it is the
   *  thing that stops this column being read as a number of contracts. */
  function tcSignedPct(v) {
    const { isNum, DASH, MINUS } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) return DASH;
    const p = n * 100;
    const r = Math.abs(p) >= 100 ? Math.round(p) : Math.round(p * 10) / 10;
    const body = Math.abs(r).toLocaleString("en-US") + "%";
    return r < 0 ? MINUS + body : r > 0 ? "+" + body : "0%";
  }

  /**
   * Calendar days from the card's session to this contract's expiry.
   *
   * CHOICE: CALENDAR DAYS, NOT TRADING DAYS. The two differ by roughly a
   * third and neither is more correct than the other - what is not
   * allowed is printing "25d" without saying which. This is computed
   * from two published ISO dates rather than read off the wire, because
   * topContracts.rows carries no day count and a third serialised field
   * that must agree with two others is a field that will one day
   * disagree with them.
   *
   * Date.UTC on the parsed parts, never new Date(string): parsing a
   * bare "2026-09-18" is UTC but parsing the session date through a
   * local-time path would shift the difference by a day for every
   * reader west of Greenwich.
   */
  function tcCalendarDays(sessionDate, expiry) {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(sessionDate == null ? "" : sessionDate));
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiry == null ? "" : expiry));
    if (!a || !b) return null;
    const from = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
    const to = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
    return Math.round((to - from) / 86400000);
  }

  /**
   * The Net aggr cell: text, class and title in one place.
   *
   * FOUR STATES, NOT TWO. Lifted, hit, balanced and unreported all look
   * alike to a renderer that only asks `n > 0`, and the last two are the
   * pair this whole page exists to keep apart.
   */
  function tcAggrCell(v) {
    const { isNum, DASH, MINUS } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) {
      return {
        text: DASH,
        cls: "c-num ftt-aggr is-unreported",
        title: "The vendor reported no aggressor split for this contract. That is not " +
          "a balanced tape — it is no report at all, and the two are different facts.",
      };
    }
    const r = Math.round(n);
    const body = Math.abs(r).toLocaleString("en-US");
    if (r === 0) {
      return {
        text: "0",
        cls: "c-num ftt-aggr is-flat",
        title: "Ask volume and bid volume were equal on this contract. The split was " +
          "reported, and it was balanced. Neither arrow is true at zero, so neither is drawn.",
      };
    }
    /* POSITION IN THE GLYPH, THEN THE MINUS, THEN THE CLASS. The arrow is
       the primary channel and is present on both signs; U+2212 is the
       second; the class is what CSS may tint, and it is last on purpose.
       POLARITY.aggr is +1 (shared/flows-card.js) - calls and puts alike,
       more contracts hitting the offer than the bid is the bullish
       reading - so `is-lifted` takes --flow-up and `is-hit` --flow-down. */
    return r > 0
      ? {
        text: "↑" + body,
        cls: "c-num ftt-aggr is-lifted",
        title: body + " more contracts hit the offer than the bid on this contract.",
      }
      : {
        text: "↓" + MINUS + body,
        cls: "c-num ftt-aggr is-hit",
        title: body + " more contracts hit the bid than the offer on this contract.",
      };
  }

  /**
   * The dOI cell.
   *
   * THE SUBTLE ONE. `doi` is open_interest - prev_oi and the builder
   * emits null when EITHER side is missing. A renderer that coerces sees
   * 0 and prints "no change", which is a specific, confident, completely
   * unfounded claim about what stuck. The dash carries a title saying
   * which of the two it is, because the difference between "unchanged"
   * and "not computable" is invisible in a glyph.
   *
   * THE TITLES NAME NO SPAN. They used to say "overnight", which is a
   * claim about WHEN the two open-interest counts were taken, and the
   * basis check below this table has falsified it on live rows: a
   * contract cannot move its open interest further than its own volume
   * across one settlement, and some did. The vendor stamps neither count,
   * so these say what changed between them and stop there.
   */
  function tcDoiCell(v) {
    const { isNum } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) {
      return {
        text: tcSignedInt(null),
        cls: "c-num ftt-doi is-unknown",
        title: "The vendor published no previous open interest for this contract, so the " +
          "change is not computable. This is NOT a change of zero: an open interest that " +
          "did not move prints 0.",
      };
    }
    const r = Math.round(n);
    return {
      text: tcSignedInt(n),
      cls: "c-num ftt-doi " + (r > 0 ? "is-built" : r < 0 ? "is-closed" : "is-flat"),
      title: r === 0
        ? "Open interest was identical in both counts the vendor published: measured, and unchanged."
        : r > 0
          ? Math.abs(r).toLocaleString("en-US") +
            " more contracts were open at this strike in the later of the two counts."
          : Math.abs(r).toLocaleString("en-US") +
            " fewer contracts were open at this strike in the later of the two counts.",
    };
  }

  /**
   * The Strike cell's title: where this contract sits on the smile.
   *
   * ln(K/S) IS PRINTED AS ln(K/S), NOT AS A PERCENTAGE. A row at 0.10 is
   * a strike 10.5% above spot and a row at 0.50 is 64.9% above; the
   * percentage rendering is wrong by fifteen points at the wing and the
   * whole discipline of this page is stated relations. The implied
   * volatility rides in the same title because the two together are what
   * place a strike on the smile, and neither is worth much alone.
   */
  function tcStrikeTitle(row) {
    const { isNum, MINUS, vol1 } = window.FlowsPanels;
    const parts = [];
    const m = isNum(row && row.m);
    /* THREE DECIMALS AND AN EXPLICIT SIGN. The wire carries four, and the
       third place is already a tenth of a percent of spot — the fourth
       would be precision the reading does not have. The sign is written
       out on positives too, because half of these values are negative and
       a bare "0.070" beside a "−0.070" invites reading the first as the
       larger of the two. A log-moneyness of exactly zero is a MEASUREMENT
       — the strike is spot — and takes no sign at all, the same rule the
       signed integer columns follow. */
    parts.push(m === null
      ? "Log-moneyness was not computed for this contract — the card published no " +
        "spot price to measure the strike against."
      : "ln(K/S) = " + (m < 0 ? MINUS : m > 0 ? "+" : "") + Math.abs(m).toFixed(3) +
        ", the natural log of strike over spot.");
    const iv = isNum(row && row.iv);
    parts.push(iv === null
      ? "The vendor quoted no implied volatility for this contract."
      : "Implied volatility " + vol1(iv) + ", the vendor's own quote on this line.");
    return parts.join(" ");
  }

  /* One <td>. Kept as a helper rather than inlined so that every cell on
     this table goes through the same three steps - text, class, title -
     and a cell that forgets its title is a diff, not an oversight. */
  function tcCell(text, cls, title) {
    const { el } = window.FlowsPanels;
    const td = el("td", cls || null, text);
    if (title) td.title = title;
    return td;
  }

  /**
   * The column table. Declarative for the same reason flows-board.js's
   * COLS is: the header, the sort, the accessible name and the cell
   * renderer for one column must all describe the SAME column, and four
   * parallel switch statements is four chances for them to stop doing so.
   *
   * `first` is the direction a column sorts on its FIRST click - the one
   * that is interesting about it. Volume, open interest and the two
   * differences are magnitudes, so they open large-first; a strike, an
   * expiry and a type are ladders, so they open low-first.
   *
   * `cls` on a numeric column is `c-num`, which flows.css raises to a
   * five-selector specificity so it beats the table's own text-align
   * without !important. Expiry and C/P are deliberately NOT `c-num`:
   * neither is a number, an ISO date carries ASCII hyphens that the
   * suite's minus-sign sweep reads over `.c-num` cells, and labelling a
   * date as numeric to borrow an alignment is how that sweep ends up
   * being loosened later to accommodate a lie it was written to catch.
   */
  const TC_COLS = [
    {
      key: "k", label: "Strike", name: "Strike", cls: "c-num", kind: "num", first: "asc",
      relation: "The contract's strike, from the option symbol.",
      get: (r) => window.FlowsPanels.isNum(r.k),
      cell: (r) => ({ text: window.FlowsPanels.px2(r.k), cls: "c-num ftt-k", title: tcStrikeTitle(r) }),
    },
    {
      key: "expiry", label: "Expiry", name: "Expiry", cls: "ftt-exp", kind: "text", first: "asc",
      relation: "The contract's expiry, from the option symbol, as an ISO date.",
      get: (r) => (r.expiry == null || r.expiry === "" ? null : String(r.expiry)),
      cell: (r, ctx) => {
        const { DASH } = window.FlowsPanels;
        if (r.expiry == null || r.expiry === "") {
          return { text: DASH, cls: "ftt-exp is-unknown", title: "This contract's symbol carried no parsable expiry." };
        }
        /* THE FULL ISO DATE, YEAR INCLUDED. The surface panel prints
           expiry.slice(5) because its columns are already ordered and
           labelled by tenor. This table can be SORTED, and a column that
           showed 12-18 above 01-15 after an ascending sort would look
           like a broken sort rather than like a January of the following
           year. ISO dates keep their ASCII hyphens - that is the one
           documented exception to the U+2212 rule on this site. */
        const days = tcCalendarDays(ctx.sessionDate, r.expiry);
        return {
          text: String(r.expiry),
          cls: "ftt-exp",
          title: days === null
            ? "Expiry, as the vendor's option symbol carries it."
            : days + " calendar days from the " + ctx.sessionDate + " session. Calendar days, " +
              "not trading days: the two differ by about a third and the choice is stated " +
              "rather than left for the reader to guess.",
        };
      },
    },
    {
      key: "cp", label: "C/P", name: "Call or put", cls: "ftt-cp", kind: "text", first: "asc",
      relation: "Call or put, from the option symbol.",
      get: (r) => (r.cp == null || r.cp === "" ? null : String(r.cp)),
      cell: (r) => {
        const { DASH } = window.FlowsPanels;
        const cp = r.cp == null ? "" : String(r.cp);
        /* MEASURED: the emitter publishes exactly "C" and "P" across 500
           rows of 50 cards. Anything else is passed through verbatim
           rather than mapped to one of the two - a symbol this renderer
           does not recognise must not be silently filed as a call. */
        const known = cp === "C" || cp === "P";
        return {
          text: cp === "" ? DASH : cp,
          cls: "ftt-cp " + (cp === "C" ? "is-call" : cp === "P" ? "is-put" : "is-unknown"),
          title: known
            ? (cp === "C" ? "Call" : "Put")
            : cp === ""
              ? "This contract's symbol carried no parsable type."
              : "The vendor sent an option type this panel does not recognise: " + cp,
        };
      },
    },
    {
      key: "vol", label: "Vol", name: "Volume", cls: "c-num", kind: "num", first: "desc",
      relation: "Contracts traded today on this line, the vendor's own count. This is the " +
        "column the table is ranked by.",
      get: (r) => window.FlowsPanels.isNum(r.vol),
      cell: (r) => ({
        text: tcInt(r.vol), cls: "c-num ftt-vol",
        title: window.FlowsPanels.isNum(r.vol) === null
          ? "The vendor reported no volume for this contract."
          : "Contracts traded today on this line.",
      }),
    },
    {
      key: "oi", label: "OI", name: "Open interest", cls: "c-num", kind: "num", first: "desc",
      relation: "Open interest: contracts outstanding on this line.",
      get: (r) => window.FlowsPanels.isNum(r.oi),
      cell: (r) => ({
        text: tcInt(r.oi), cls: "c-num ftt-oi",
        title: window.FlowsPanels.isNum(r.oi) === null
          ? "The vendor reported no open interest for this contract."
          : "Contracts outstanding on this line.",
      }),
    },
    {
      key: "doi", label: "OI", name: "Change in open interest", cls: "c-num", kind: "num", first: "desc",
      relation: "open_interest − prev_oi: the move between two vendor open-interest counts, " +
        "whose spacing the vendor does not state.",
      /* The delta is a Greek capital and the table head is not set in the
         mono face, so it is wrapped on its own. assets/css/base.css ships
         a Greek subset of JetBrains Mono for exactly this reason and says
         so: one glyph falling through to the system stack changes width
         mid-line. */
      labelPrefix: { text: "Δ", cls: "ftt-greek" },
      get: (r) => window.FlowsPanels.isNum(r.doi),
      cell: (r) => tcDoiCell(r.doi),
    },
    {
      key: "bidPx", label: "Bid", name: "Bid", cls: "c-num", kind: "num", first: "desc",
      relation: "nbbo_bid, as quoted. Not averaged with the ask — see the note below the table.",
      get: (r) => window.FlowsPanels.isNum(r.bidPx),
      cell: (r) => ({
        text: window.FlowsPanels.px2(r.bidPx), cls: "c-num ftt-bid",
        title: window.FlowsPanels.isNum(r.bidPx) === null
          ? "No national best bid was quoted on this contract."
          : "The national best bid, as quoted.",
      }),
    },
    {
      key: "askPx", label: "Ask", name: "Ask", cls: "c-num", kind: "num", first: "desc",
      relation: "nbbo_ask, as quoted. Not averaged with the bid — see the note below the table.",
      get: (r) => window.FlowsPanels.isNum(r.askPx),
      cell: (r) => ({
        text: window.FlowsPanels.px2(r.askPx), cls: "c-num ftt-ask",
        title: window.FlowsPanels.isNum(r.askPx) === null
          ? "No national best offer was quoted on this contract."
          : "The national best offer, as quoted.",
      }),
    },
    {
      key: "aggr", label: "Net aggr (contracts)", name: "Net aggressor volume, in contracts",
      cls: "c-num", kind: "num", first: "desc",
      relation: "ask_volume − bid_volume, in contracts. The unit is in the header because " +
        "dollarising it would need a price basis, which is a choice this panel refuses to make.",
      get: (r) => window.FlowsPanels.isNum(r.aggr),
      cell: (r) => tcAggrCell(r.aggr),
    },
  ];

  /**
   * Is this column able to order anything on THIS payload?
   *
   * A column whose every value is absent cannot produce an ordering, and
   * a control that reorders nothing is a control that lies about what it
   * does. It is DISABLED rather than removed, for the reason
   * flows.css:1919-1924 already states about the board: a missing
   * control says "this table cannot sort", a dimmed one says "not this
   * column, and here is that it exists".
   */
  function tcSortable(col, rows) {
    for (const r of rows) {
      const v = col.get(r);
      if (v !== null && v !== undefined) return true;
    }
    return false;
  }

  /**
   * NULLS SORT LAST REGARDLESS OF DIRECTION.
   *
   * The direction is applied to the comparison of two PRESENT values
   * only. A missing measurement is not a small value and it is not a
   * large one; it is at the bottom in both directions. This is the same
   * comparator flows-board.js:543 and flows-watch.js:205 carry, and it
   * is written out here rather than imported because window.FlowsPanels
   * does not export one - if it ever does, this should call it instead.
   */
  function tcCompare(col, dir, a, b) {
    const x = col.get(a);
    const y = col.get(b);
    const xn = x === undefined ? null : x;
    const yn = y === undefined ? null : y;
    if (xn === null && yn === null) return 0;
    if (xn === null) return 1;
    if (yn === null) return -1;
    const d = col.kind === "text" ? String(xn).localeCompare(String(yn)) : xn - yn;
    return dir === "asc" ? d : -d;
  }

  /* The rows in the order they should be drawn, each carrying its
     PUBLISHED index. The tie-break on that index is not defensive
     clutter about sort stability: it says what a tie MEANS here, which
     is "the builder already ranked these two by volume and that ranking
     stands". Sorting by C/P is two buckets over ten rows, and without
     this the inside of each bucket would be whatever fell out. */
  function tcOrdered(rows, state) {
    const view = rows.map((row, index) => ({ row, index }));
    if (!state || !state.col) return view;
    view.sort((p, q) => tcCompare(state.col, state.dir, p.row, q.row) || p.index - q.index);
    return view;
  }

  /**
   * The day's most-traded contracts.
   *
   * @param {HTMLElement} host  the empty panel body to draw into
   * @param {object} panel      card.panels.topContracts
   * @param {object} card       the whole card, for sessionDate and the sibling coverage
   * @param {string} question   the panel's question, from data-question
   * @param {string} mount      "grid" or "zoom" - keys the sort state
   */
  function drawTopContracts(host, panel, card, question, mount) {
    const { el, isNum, deadPanel, panelHead, DASH } = window.FlowsPanels;

    /* The registry's own question, as a fallback only. A panel that
       cannot say what it is for does not belong on the card, and an
       empty .fc-q is exactly that panel with the evidence removed. */
    const q = question || "Which single lines carried the volume?";

    /* THE TAGGED UNION IS SWITCHED ON BEFORE ANY NUMBER IS TOUCHED.
       `undefined` is a card built before the chain leg shipped - a
       legacy payload, not a failure - and it is a different sentence
       from a run that declined to publish. */
    if (panel === undefined || panel === null) {
      return deadPanel(host, q, "this card was built before the option chain leg shipped, " +
        "so this panel was never in it.");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    /* SECOND-STAGE GUARD, after status. A chain can come back whole and
       still contain nothing that traded, and an empty table under a
       heading that promises the day's most-traded contracts is the kind
       of blank that reads as a broken renderer. */
    const rows = Array.isArray(panel.rows) ? panel.rows : [];
    if (!rows.length) {
      return deadPanel(host, q, "no contract on this chain reported volume today");
    }

    panelHead(host, q);

    const ctx = { sessionDate: card && card.sessionDate ? String(card.sessionDate) : null };

    /* Which columns can order anything, decided once from the rows in
       hand rather than per click. */
    const live = new Map();
    for (const col of TC_COLS) live.set(col.key, tcSortable(col, rows));

    /* The sort state for THIS mount. Restored across a redraw; dropped
       if it names a column this payload cannot order. */
    const stored = TC_SORT.get(mount) || null;
    let sortKey = stored && live.get(stored.key) ? stored.key : null;
    let sortDir = stored && stored.dir === "asc" ? "asc" : "desc";

    const table = el("table", "fc-levels ftt-table");
    const thead = el("thead");
    const headRow = el("tr", "ftt-headrow");
    const buttons = new Map();
    const headCells = new Map();

    for (const col of TC_COLS) {
      /* Every header carries its column's own hook alongside its alignment
         class, so the stylesheet can reach one column by name. The
         alternative is :nth-child, which silently addresses the wrong
         column the day a tenth is added or the order changes. */
      const th = el("th", col.cls + " ftt-h-" + col.key);
      th.scope = "col";
      th.title = col.relation;

      /* A REAL <button> INSIDE THE <th>, not a click handler on the cell.
         It buys keyboard operability and a focus ring for free and states
         honest semantics: a <th> with a listener is unreachable by
         keyboard and announces nothing, role="button" would lie about
         what a header is, and tabindex="0" alone would make it focusable
         without making it activatable by Enter or Space. */
      const button = el("button", "ftt-sort");
      button.type = "button";
      if (col.labelPrefix) button.append(el("span", col.labelPrefix.cls, col.labelPrefix.text));
      button.append(document.createTextNode(col.label));
      const ind = el("span", "ftt-sort-ind");
      ind.setAttribute("aria-hidden", "true");
      button.append(ind);
      button.addEventListener("click", () => toggleSort(col.key));
      th.append(button);
      headRow.append(th);
      buttons.set(col.key, button);
      headCells.set(col.key, th);
    }
    thead.append(headRow);
    table.append(thead);

    const tbody = el("tbody");
    table.append(tbody);

    /**
     * aria-sort on the <th>, on every header, every time.
     *
     * It is the ONLY thing that tells a screen reader the table
     * reordered; the arrow is a glyph, the state is the attribute. Every
     * non-current header is explicitly reset rather than left as it was,
     * because a stale aria-sort announces two sorted columns and there
     * is only ever one. A column that cannot order anything gets NO
     * aria-sort at all: "none" means "sortable, currently unsorted",
     * which would advertise an order that column can never produce.
     */
    function syncHeaders() {
      for (const col of TC_COLS) {
        const th = headCells.get(col.key);
        const button = buttons.get(col.key);
        const can = live.get(col.key) === true;
        const on = can && sortKey === col.key;
        button.disabled = !can;
        if (!can) th.removeAttribute("aria-sort");
        else th.setAttribute("aria-sort", on ? (sortDir === "asc" ? "ascending" : "descending") : "none");
        const ind = button.querySelector(".ftt-sort-ind");
        if (ind) ind.textContent = on ? (sortDir === "asc" ? "↑" : "↓") : "";
        /* THE ACCESSIBLE NAME IS SPELLED OUT, not scraped from the
           header. "C/P" and the delta announce as punctuation, and a
           reader hearing "activate to sort by slash" has been told
           nothing. The <th title> carries the relation for a sighted
           reader; this is the same courtesy for everyone else. */
        button.setAttribute("aria-label", col.name + ": " + (
          on
            ? "sorted " + (sortDir === "asc" ? "ascending" : "descending") +
              ", activate to " + (sortDir === col.first
                ? "reverse"
                : "return to the published order, by volume")
            : can
              ? "activate to sort"
              : "every value in this column is unreported on this chain, so it cannot be sorted"
        ));
      }
    }

    /* Only the <tbody> is rebuilt on a sort. Replacing the whole table
       would take the focused header button out of the document mid-click
       and drop the reader's focus to <body>, and it would reset the
       scroll position of the wrapper the table lives in. */
    function paintRows() {
      const frag = document.createDocumentFragment();
      for (const { row } of tcOrdered(rows, sortKey ? { col: TC_COLS.find((c) => c.key === sortKey), dir: sortDir } : null)) {
        const tr = el("tr", "ftt-row");
        for (const col of TC_COLS) {
          const spec = col.cell(row, ctx);
          tr.append(tcCell(spec.text, spec.cls, spec.title));
        }
        frag.append(tr);
      }
      tbody.replaceChildren(frag);
    }

    /**
     * Click through: first click sorts the column its natural way,
     * second reverses it, third returns the table to the order the
     * builder published.
     *
     * THE PUBLISHED ORDER MUST BE RECOVERABLE. It is by volume
     * descending, and it is the one ordering this panel exists to show -
     * a table that can be sorted away from its own answer with no way
     * back has thrown that answer away.
     */
    function toggleSort(key) {
      if (live.get(key) !== true) return;
      const col = TC_COLS.find((c) => c.key === key);
      if (!col) return;
      if (sortKey !== key) { sortKey = key; sortDir = col.first; }
      else if (sortDir === col.first) { sortDir = col.first === "desc" ? "asc" : "desc"; }
      else { sortKey = null; sortDir = "desc"; }
      if (sortKey) TC_SORT.set(mount, { key: sortKey, dir: sortDir });
      else TC_SORT.delete(mount);
      syncHeaders();
      paintRows();
    }

    syncHeaders();
    paintRows();

    /* THE WRAPPER SCROLLS, NEVER THE PAGE AND NEVER THE DIALOG. Nine
       columns do not fit a 320px viewport at any type size worth
       reading, so the table is given its own scroll container - at 320px
       a horizontally scrolling page takes the rail with it, and a
       horizontally scrolling dialog takes its header and close button
       off-screen. tabIndex makes the region scrollable by keyboard,
       which an overflow container is not by default. */
    const wrap = el("div", "fc-tablewrap ftt-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "The day’s most-traded contracts");
    wrap.append(table);
    host.append(wrap);

    /* ---------- what the table does and does not claim ---------------- */

    const shownN = rows.length;
    const total = isNum(panel.total);

    /* THE SPLIT COUNT IS COUNTED HERE, off the rows being drawn, and the
       published field is then checked against it. The count in the foot
       has to describe the table the reader is looking at; a serialised
       count that must agree with a rendered one is a count that will
       eventually disagree with it, and when it does the rendered rows
       are the truth. Measured across 50 emitted cards: the two agree on
       every one, and the published values run 7 to 10 of 10. */
    let reported = 0;
    for (const r of rows) if (isNum(r.aggr) !== null) reported += 1;
    const publishedReported = isNum(panel.aggressorReported);

    const count = el("p", "fc-note ftt-count");
    count.append(document.createTextNode(
      (total === null
        ? "The " + shownN + " most-traded contracts on this chain, ranked by volume. "
        : total > shownN
          ? "The " + shownN + " most-traded of the " + tcInt(total) + " contracts that reported " +
            "a volume on this chain today, ranked by volume. "
          : "All " + shownN + " contracts that reported a volume on this chain today, ranked " +
            "by volume. ") +
      reported + " of the " + shownN + " rows shown carried an aggressor split from the vendor; " +
      "the rest print " + DASH + ", because a split that was reported and came out balanced and " +
      "a split that was never reported are different facts and only one of them is a reading."));
    /* A published count that disagrees with the drawn one is a payload
       defect and is surfaced rather than quietly preferred either way. */
    if (publishedReported !== null && publishedReported !== reported) {
      count.append(document.createTextNode(
        " The payload publishes aggressorReported = " + publishedReported + ", which does not " +
        "match the " + reported + " rows above that carry one; the rows are what is drawn."));
    }
    if (isNum(panel.shown) !== null && panel.shown !== shownN) {
      count.append(document.createTextNode(
        " The payload publishes shown = " + panel.shown + " against " + shownN + " rows; the " +
        "rows are what is drawn."));
    }
    host.append(count);

    /* ---------- coverage, stated in both directions ------------------- */

    /* READ OFF THIS PANEL FIRST. shared/flows-card.js's chainPanel()
       attaches the same coverage block to every chain panel it publishes
       with status "ok", so topContracts carries its own and does not
       need to borrow the surface's - verified identical on all 50
       emitted cards. The sibling is kept as a fallback for a payload
       where the attachment is missing, since a panel that says nothing
       about its coverage is the failure this block exists to prevent. */
    const coverage = (panel && panel.coverage) ||
      (card && card.panels && card.panels.ivSurface && card.panels.ivSurface.coverage) || null;

    if (!coverage) {
      host.append(el("p", "fc-note ftt-cover",
        "This payload carries no coverage block, so how much of the chain these rows were " +
        "drawn from is not stated. Treat the ranking as unverified rather than as complete."));
    } else if (coverage.truncated === true) {
      const cover = el("p", "fc-note ftt-cover", TC_TRUNCATED_NOTE);
      const seen = isNum(coverage.rowsSeen);
      const priced = isNum(coverage.pricedRows);
      if (seen !== null) {
        cover.title = "Measured on this card: " + tcInt(seen) + " contract rows came back" +
          (priced === null ? "" : ", " + tcInt(priced) + " of them priced") + ".";
      }
      host.append(cover);

      /* THE JUDGEMENT THIS PANEL HAS TO MAKE, and it is not the same one
         the surface panels make. There, truncation damages the READING:
         a smile built from an arbitrary slice is not the smile. Here it
         damages the CLAIM but not the DATA. Every row below is a real
         contract that really traded at the volume printed beside it -
         truncation cannot make a print that happened un-happen. What it
         makes unsafe is the superlative in the panel's own title. Saying
         only "this is an arbitrary subset" would leave a reader to guess
         which of the two it is, and the likelier guess is the wrong one:
         that the rows themselves are suspect, which would throw away ten
         real observations. So the panel says it in words, both halves. */
      host.append(el("p", "fc-note ftt-scope",
        "For this panel that qualifies the ranking, not the rows. Every line above is a " +
        "contract that really traded, at the volume the vendor reported for it, and a page " +
        "limit cannot make a print that happened un-happen. What it does undo is the word " +
        "“most”: these are the " + shownN + " busiest lines of the subset that came " +
        "back, not of the book, and a busier line may sit in the part of the chain that was " +
        "never paged. Read them as " + shownN + " real prints, not as a top " + shownN + "."));
    } else {
      const seen = isNum(coverage.rowsSeen);
      const priced = isNum(coverage.pricedRows);
      host.append(el("p", "fc-note ftt-cover",
        "The vendor returned the whole chain it holds for this name" +
        (seen === null
          ? ". "
          : ": " + tcInt(seen) + " contract rows" +
            (priced === null ? "" : ", " + tcInt(priced) + " of them priced") + ". ") +
        (coverage.filter
          ? String(coverage.filter).replace(/^./, (c) => c.toUpperCase()) + "."
          : "")));
    }

    /* ---------- the relations, beside the numbers that used them ------ */

    const basis = el("p", "fc-note ftt-basis");
    basis.append(document.createTextNode(
      (panel.relation ? String(panel.relation) + ". " : "") +
      "ΔOI is open_interest − prev_oi: the move between the two open-interest counts the " +
      "vendor published, whatever span separates them. A " + DASH + " there means the vendor " +
      "published no previous open interest, so the change is not computable — it does not mean " +
      "the open interest held still, which prints 0. " +
      "Bid and Ask are the quoted NBBO in two columns and there is no Mid: (bid + ask) ÷ 2 " +
      "is a basis choice, and on the far out-of-the-money lines that make this table interesting " +
      "it is routinely nowhere near where anything traded. Each strike carries its log-moneyness " +
      "ln(K/S) and the vendor's implied volatility in its title, and each expiry its distance in " +
      "calendar days from this session."));
    host.append(basis);

    /* ---------- what the basis check actually found, for this name ----

       THE ONE THING ON THIS PANEL THAT IS A MEASUREMENT ABOUT THE DATA
       RATHER THAN A READING OF IT, and it earns its place because the
       caption above used to make the claim this check can refute.

       Open interest cannot move further across one settlement than the
       volume traded between those settlements. So a contract whose ΔOI
       exceeds its own volume proves the two numbers do not describe the
       same span — and the pipeline found exactly that on live rows. The
       asymmetry is the whole point and the wording has to carry it: a
       positive count FALSIFIES the pairing, while a zero count proves
       nothing at all. It is equally consistent with an intraday-updated
       open interest, with an aligned pair, and with a quiet session.
       Writing the zero branch as reassurance would be the confident
       inference this panel exists to avoid. */
    if (panel.oiBasis) tcOiBasisNote(host, panel.oiBasis);
  }

  /**
   * The basis-check note. Three verdicts, three different sentences.
   */
  function tcOiBasisNote(host, basis) {
    const seen = isNum(basis.seen);
    const exceeded = isNum(basis.exceeded);
    const floor = isNum(basis.minVolume);
    const pop = floor === null
      ? "the contracts that carried all three numbers"
      : "the " + tcInt(seen === null ? 0 : seen) + " contract" + (seen === 1 ? "" : "s") +
        " here that traded at least " + tcInt(floor) + " lots and carried an open interest, " +
        "a previous open interest and a volume together";

    if (basis.verdict === "no-data" || seen === null || seen === 0) {
      const note = el("p", "fc-note ftt-oibasis is-untested",
        "No contract on this chain carried a volume, an open interest and a previous open " +
        "interest together, so whether those two counts describe the same span could not be " +
        "checked here. Read ΔOI as a move between two vendor snapshots of unstated spacing.");
      note.setAttribute("data-empty", "quiet");
      host.append(note);
      return;
    }

    /* THE COUNT AND THE VERDICT MUST BOTH BE READABLE before either branch
       below speaks. Neither sentence is survivable without the other number:
       "4 of 105 exceeded" needs the 4, and "none of 105 exceeded" is a
       confident claim about every contract on the chain built from a count
       nobody read. A publisher that sends a verdict without its count is
       broken, and this says so instead of picking the friendlier sentence. */
    if (exceeded === null) {
      const note = el("p", "fc-note ftt-oibasis is-untested",
        "The basis check ran on this chain but published no count of contracts that " +
        "exceeded their own volume, so its verdict cannot be shown with the number it " +
        "rests on. Read ΔOI as a move between two vendor snapshots of unstated spacing.");
      note.setAttribute("data-empty", "unavailable");
      host.append(note);
      return;
    }

    if (basis.verdict === "falsified" && exceeded > 0) {
      host.append(el("p", "fc-note ftt-oibasis is-falsified",
        "Measured on this chain: " + tcInt(exceeded) + " of " + pop + " moved their open " +
        "interest further than their own volume. That cannot happen across a single " +
        "settlement — no more contracts can be opened than were traded — so on this name the " +
        "two counts are NOT describing the same span. Do not read ΔOI against the volume " +
        "beside it as “what stuck of what churned”; they are two snapshots whose spacing the " +
        "vendor does not state."));
      return;
    }

    /* AND THE ZERO BRANCH REQUIRES BOTH HALVES TO AGREE — the verdict
       "inconclusive" AND a count of exactly zero. Checking only the count
       let "falsified" with exceeded 0 through, which is the publisher
       contradicting itself being reported as the reassuring half of its own
       contradiction. An unrecognised verdict lands here too: a sentence this
       load-bearing is not composed from a string nothing in this file knows. */
    if (basis.verdict !== "inconclusive" || exceeded !== 0) {
      const note = el("p", "fc-note ftt-oibasis is-untested",
        "The basis check published a verdict its own count does not support, so no reading " +
        "of it is shown. Read ΔOI as a move between two vendor snapshots of unstated spacing.");
      note.setAttribute("data-empty", "unavailable");
      host.append(note);
      return;
    }

    host.append(el("p", "fc-note ftt-oibasis is-inconclusive",
      "Measured on this chain: none of " + pop + " moved their open interest further than " +
      "their own volume. This is the weaker of the two outcomes and is INCONCLUSIVE — it is " +
      "what an aligned pair looks like, and equally what an intraday-updated open interest or " +
      "a quiet session looks like. It is not evidence that ΔOI and the volume beside it " +
      "describe the same span."));
  }

  /* ===== aggressor ===== */
  /* =============================================================
     drawAggressor — net aggressor flow by strike, in CONTRACTS.

     A SIBLING OF renderGamma, NOT A NEW THING. It borrows that panel's
     geometry constants verbatim (padT/padB/labelW/railW, the ROW rule,
     yOfIndex, the data-placed zero rule, the one-rate-across-zero scale,
     the minimum bar width, the round-ladder ticks) because the two
     ladders sit side by side in the same grid at span 1, and a reader
     who learns to read one must not have to relearn the other. Where
     this panel diverges from renderGamma it is because the FIELD is
     different, and each divergence is labelled below.

     WHAT IT ANSWERS. `aggressor.bars[].net` is, per the builder's own
     published relation, `Σ (ask_volume − bid_volume)` over the contracts
     at one strike, signed by what the BUYER of that contract is long:
     calls +, puts −. So a bar to the right is "calls were taken at the
     offer here"; a bar to the left is "puts were". It is a count of
     CONTRACTS, never a dollar figure — the builder refuses to dollarise
     it because that needs a price basis (flows-chain.js:403-406) — and
     the unit is stated on the axis, in the rail header sentence and in
     the aria-label.

     THE IDENTIFICATION RULE, in one line: the mark's SIDE of the drawn
     zero rule is the sign of `net`, its LENGTH is |net| on a scale that
     is linear in contracts and shared across both halves, its ROW is one
     listed strike, and the rail beside it is the total volume the vendor
     actually reported at that strike — never a total it did not.

     ---------------------------------------------------------------
     THE LABELLED CHOICES
     ---------------------------------------------------------------

     CHOICE 1 — THE SCALE IS LINEAR IN CONTRACTS, where the gamma ladder
     beside it is symlog. Deliberate, and the reason is the field's own
     dynamic range. Measured over 876 bars on 50 emitted cards: the
     largest |net| is 5,417 and the smallest non-zero |net| is 1, a span
     of 3.73 decades. Per-strike dealer gamma spans four or five decades
     within one name and seventeen across the board, which is what forces
     renderGamma into symlog and costs it magnitude comparability. Three
     and a half decades is a range a linear axis can hold, and holding it
     linearly buys back the property symlog gives up: on THIS panel a bar
     twice as long really is twice the flow, so the ticks are not merely
     a rank ruler and the reader may compare two bars directly. That is
     worth more here than reach, because the interesting reading is a
     BALANCE between two sides, not the magnitude of one wing. It is
     stated on the panel in those words, because a reader arriving from
     the log panel above will otherwise carry the wrong instruction over.

     CHOICE 2 — THE ZERO RULE IS PLACED BY THE DATA, `share =
     |fMin| / (|fMin| + |fMax|)`, clamped to [0.18, 0.82]. Both bounds
     are CHOICES. A symmetric axis wastes half the plot when a book is
     95% one-signed; an unclamped one squeezes the minority side to
     nothing, and the minority side is frequently the whole reading.

     CHOICE 3 — `fMin` AND `fMax` ARE SEEDED WITH 0, and the rate has a
     `Number.isFinite` fallback. Both are load-bearing and neither is
     decoration; see the block comment at the scale itself.

     CHOICE 4 — SIGN IS CARRIED THREE TIMES BEFORE HUE. Position (which
     side of the drawn `.fa-zero`) is primary; a 45° hatch laid over the
     fill is second; an explicit U+2212 / + on the magnitude ticks is
     third; `--flow-up` / `--flow-down` is last and wholly duplicative.
     A greyscale render or a red-green-blind reader loses nothing.

     CHOICE 5 — THE HATCH PATTERN IS THIS PANEL'S OWN, id-suffixed with
     `mount`, and NOT a borrowed `url(#gpNeg)`. Worked out rather than
     assumed; the reasoning is at the <defs> below.

     CHOICE 6 — A PARTIAL VOLUME TOTAL IS MARKED IN THE TEXT ITSELF, with
     a trailing U+2026, as well as by `.is-partial` and a <title>. See the
     rail block: it is the modal case and it must survive a stylesheet
     that never shipped.

     CHOICE 7 — MAGNITUDE TICKS CARRY AN EXPLICIT LEADING SIGN, where
     renderGamma prints its magnitudes unsigned and lets the caption say
     which side is which. Here the sign is the published polarity of the
     field itself (`POLARITY.net === +1`), and both halves are readings a
     user acts on, so each half names itself without reference to a
     caption 200px away.
     ============================================================= */


  /* Mono advance in px for a string at a given font size. AXIS_CH is 6, the
     measured 5.81 at 10px rounded up so every estimate errs WIDE — a label
     estimated too narrow collides or leaves the canvas, one estimated too wide
     costs a few pixels. The .gp-axis rule carries letter-spacing: 0.04em, which
     is exactly the gap between 5.81 and 6. */
  function faTextW(s, fontPx) {
    return String(s).length * window.FlowsPanels.AXIS_CH * (fontPx / 10);
  }

  /* GROUPED INTEGERS, BUILT BY HAND RATHER THAN BY toLocaleString.
     toLocaleString's separator is the HOST's locale: the same bar prints
     "5,310" in the test runner and "5.310" under a de-DE browser, which would
     turn a contract count into a decimal in front of a reader and pass every
     test that ran in en-US. The regex is locale-free.
     The sign is U+2212, never the ASCII hyphen toFixed emits. */
  function faGrouped(n) {
    const F = window.FlowsPanels;
    const v = F.isNum(n);
    if (v === null) return F.DASH;
    const a = String(Math.abs(Math.round(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (v < 0 ? F.MINUS : "") + a;
  }

  /* A ONE-DECIMAL THOUSANDS FORM, for the two places a grouped integer will
     not fit the 112px rail.

     NOT `compact()` FROM THE SCAFFOLDING, and this is a measured defect of
     reusing it rather than a preference: compact() renders thousands as
     `(a/1e3).toFixed(0) + "K"`, so compact(2500) === "3K" and
     compact(7740) === "8K". On a rail those are a 20% overstatement of a
     contract count; on an axis tick at a 2,500 step they are a MISLABELLED
     RULER, which is the defect class this whole page exists to avoid.
     compact() is right for gamma dollars, where a 20% rounding of a
     half-billion is beneath notice. It is wrong for counts. */
  function faK1(n) {
    const F = window.FlowsPanels;
    const v = F.isNum(n);
    if (v === null) return F.DASH;
    const a = Math.abs(v);
    if (a < 1000) return faGrouped(v);
    return (v < 0 ? F.MINUS : "") + (a / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  }

  /* A TICK LABEL MUST BE EXACT, WHICH IS A STRICTER JOB THAN A RAIL LABEL.

     A rail that renders 7,740 as "7.7K" has rounded a reading and says so with
     its suffix. A TICK that renders a graduation at 1,250 as "1.3K" has told
     the reader the ruler is marked somewhere it is not, and every bar measured
     against that mark is misread by the difference. This was a live defect in
     the first draft of this panel: at a 1,113px zoom host the step came out at
     250 and the axis printed "+1.3K" and "+1.8K" against marks at 1,250 and
     1,750 — an axis lying by 4% about itself, on the panel whose premise is
     that position IS magnitude.

     So: grouped integers below ten thousand, where a contract count is short
     enough to print in full, and above that an exact thousands form with only
     the trailing zeros trimmed. Every value on the 1/2/2.5/5 ladder at or above
     10,000 has at most one significant decimal in thousands, so nothing is ever
     rounded away. The sign is added by the caller — it is the sign of the SIDE,
     not of the value, and both halves of this axis carry one. */
  function faTickLabel(v) {
    const a = Math.abs(v);
    if (a < 10000) return faGrouped(a);
    return (a / 1000).toFixed(2).replace(/\.?0+$/, "") + "K";
  }

  /**
   * Net aggressor flow by strike, as a horizontal ladder either side of a
   * drawn zero rule.
   *
   * @param {HTMLElement} host   the empty div to draw into
   * @param {object|undefined} panel  card.panels.aggressor — a tagged union
   * @param {object} card        the whole card, for ticker context
   * @param {string} question    printed in .fc-q
   * @param {string} mount       "grid" | "zoom" — suffixes every <defs> id
   */
  function drawAggressor(host, panel, card, question, mount) {
    const F = window.FlowsPanels;
    const { el, svgEl, isNum, deadPanel, panelHead, statList, niceStep,
            DASH, MINUS, neg } = F;

    /* The registry's own question, as the default. `shared/` is in
       .assetsignore and never served, so a renderer cannot import the
       registry at runtime — the page emits it as data-question and hands it
       in. A caller that passes nothing still gets the right sentence. */
    const q = question || "At which strikes were contracts taken at the offer?";

    /* EVERY PANEL IS A TAGGED UNION, and the switch happens BEFORE any number
       is touched. `undefined` is not the same absence as {status:"unavailable"}:
       it means this card predates the chain leg entirely, and saying so is more
       use to a reader than "unavailable". */
    if (panel === undefined || panel === null) {
      return deadPanel(host, q, "this card was built before the option chain leg shipped");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    /* SECOND-STAGE GUARD. status "ok" with no bars cannot come out of
       buildAggressor today — it returns dead() with its own reason before it
       can happen — but a shed or hand-mutated payload can present it, and a
       chart with no rows must not reach the geometry. The builder's reason is
       preferred; when there is none, the same sentence is RECONSTRUCTED from
       the counts the payload does carry rather than invented, so the reader
       is told the real thing: contracts traded, none of them split. */
    const rawBars = Array.isArray(panel.bars) ? panel.bars : [];
    const unreportedN = isNum(panel.unreported);
    if (!rawBars.length) {
      return deadPanel(host, q, panel.reason || (unreportedN !== null && unreportedN > 0
        ? `the vendor reported no aggressor split on any of the ${unreportedN} contracts that traded`
        : "no strike on this chain carried an aggressor split"));
    }

    panelHead(host, q);

    /* A BAR WITH NO STRIKE OR NO NET IS NOT A ZERO, IT IS NOT A BAR.
       isNum returns null for anything that is not a finite number, and null
       is tested for BEFORE any arithmetic: Number(null) === 0 and 0 is finite,
       which is how this repo has shipped a confident zero five times. */
    const bars = rawBars.filter((b) => b && isNum(b.k) !== null && isNum(b.net) !== null);
    if (!bars.length) return deadPanel(host, q, "no strike on this chain published a usable net");
    bars.sort((a, b) => a.k - b.k);

    /* ---------- geometry: renderGamma's, unchanged --------------------- */

    const W = ftWidth(host);
    /* IDENTICAL TO renderGamma, deliberately. The two ladders share a grid
       column and are read against each other; a different row pitch or a
       different rail width between them would make the same strike sit at two
       different heights on one screen. The builder caps at AGGRESSOR_STRIKES =
       30, so the 9px branch is unreachable from a real payload — it is kept
       because the constant is the gamma panel's and a fork here is a second
       number to keep in step forever. */
    const ROW = bars.length > 34 ? 9 : 12;
    const padT = 16, padB = 30, labelW = 46, railW = 112;
    const plotL = labelW, plotR = W - railW;
    const plotW = Math.max(60, plotR - plotL);
    const H = padT + bars.length * ROW + padB;

    const nets = bars.map((b) => b.net);

    /* ---------- the scale ---------------------------------------------
       LINEAR IN CONTRACTS. See CHOICE 1 in the header: 3.73 measured decades
       of |net| is a range a linear axis holds, and holding it linearly is what
       makes bar length mean magnitude on this panel rather than rank. There is
       no transfer function here at all — `net` goes straight to pixels — which
       is the whole difference from the panel above.

       THE 0 SEED IS LOAD-BEARING. Math.min(...nets, 0) and Math.max(...nets, 0)
       admit zero as a bound even when no bar has that sign. Without it a
       one-signed book — every strike net long calls, say — produces
       fMin = +2 and fMax = +5000, so `share` is 2/5002, the zero rule is
       clamped hard to 18%, and `negW / |fMin|` is a pixels-per-contract rate
       computed against a bound that is on the WRONG SIDE of zero. The scale
       comes out nonsense and every bar on the panel is wrong together, which
       is the failure mode nobody catches by looking.

       ONE RATE ACROSS THE ZERO RULE. Each side normalised against its own
       extreme would draw the largest bar on each side at that side's full
       width no matter what it was worth: a book whose short side is 1% of its
       long side would draw that 1% at 22% of the ink, and the reader's first
       impression of the balance of the book — which is the entire reading of
       this panel — would be manufactured by the renderer. `rate` is the
       largest pixels-per-contract that fits BOTH sides inside their halves,
       so the two are directly comparable and neither overflows.

       THE Number.isFinite FALLBACK IS LOAD-BEARING TOO. When every net is
       exactly zero both branches of the Math.min are Infinity, Infinity is
       what Math.min returns, and `x0 + net * Infinity` is NaN — an attribute
       SVG drops silently, so the panel would render as an empty box with a
       full set of price labels beside it. 0 collapses every bar onto the zero
       rule, which is exactly where an all-zero book belongs, and the
       `.fa-zeromark` path below then draws each row as the measured zero it
       is. */
    const fMin = Math.min(...nets, 0);
    const fMax = Math.max(...nets, 0);

    /* Placing zero by the data rather than at the centre: a symmetric axis
       wastes half the plot when a book is 95% one-signed. The clamp keeps the
       minority side visible instead of squeezing it to nothing. Both bounds
       are CHOICES and are named as such on the panel. */
    const share = Math.abs(fMin) / (Math.abs(fMin) + Math.abs(fMax) || 1);
    const x0 = plotL + plotW * Math.min(0.82, Math.max(0.18, share));
    const negW = x0 - plotL, posW = plotR - x0;

    const rate = Math.min(
      Math.abs(fMin) > 0 ? negW / Math.abs(fMin) : Infinity,
      fMax > 0 ? posW / fMax : Infinity,
    );
    const barRate = Number.isFinite(rate) ? rate : 0;
    const xOf = (v) => x0 + v * barRate;

    /* HIGH STRIKES AT THE TOP. bars are ascending in strike, so index 0 — the
       lowest strike — takes the BOTTOM row. This is the same mapping the gamma
       ladder uses and the same one a price axis has anywhere else on the page;
       inverting it here would put the two ladders in the same grid row running
       in opposite directions. */
    const yOfIndex = (i) => padT + (bars.length - 1 - i) * ROW + ROW / 2;

    const svg = svgEl("svg", {
      class: "fa-svg", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    /* ---------- the hatch ---------------------------------------------

       THIS PANEL EMITS ITS OWN PATTERN, AND THE DECISION WAS WORKED OUT
       RATHER THAN ASSUMED.

       The obvious reading of "do not define a second identical pattern" is to
       write fill="url(#gpNeg)" and lean on the copy renderGamma already put in
       this document. That is wrong here, for two reasons that are both real on
       this page rather than hypothetical:

       1. renderGamma EMITS #gpNeg ONLY WHEN IT DRAWS. It returns through
          deadPanel — before ever reaching its <defs> — whenever the gamma
          panel is unavailable, and the gamma panel is shed independently of
          this one by the pipeline's payload ladder and dies on its own when
          the gamma source did not return. On such a card `url(#gpNeg)`
          resolves to nothing, a browser paints an unresolvable paint server as
          no paint at all, and the hatch — the SECOND sign channel, the one
          that has to survive a greyscale render — vanishes with no error. The
          panel still looks finished.

       2. THE ENLARGE DIALOG DRAWS ONE PANEL. When a reader enlarges the
          aggressor ladder, the drawing in the dialog is the only aggressor
          drawing that matters and the gamma panel behind it may or may not
          have run. Depending on another panel's private, unsuffixed id for a
          mandatory encoding channel makes this panel's correctness a function
          of a sibling's status. It must not be.

       So: an id of this panel's own, suffixed with `mount`, because SVG ids
       are document-global and url(#id) takes the FIRST match in document
       order — a page showing the grid copy and the zoom copy at once would
       otherwise silently give the second drawing the first's tile.

       WHAT IS NOT DUPLICATED IS THE APPEARANCE. The tile is byte-identical to
       renderGamma's (4×4, patternUnits userSpaceOnUse, rotate(45), the line at
       x=2 so a 1.8 stroke sits wholly INSIDE the tile instead of being clipped
       at the edge and rendering at a fraction of its ink) and it carries
       renderGamma's own class as well as this panel's, so the single shipped
       rule `.gp-negpat { color: var(--bg-deep) }` already colours it correctly
       with no integrator work and the two hatches cannot drift apart. The
       `.fa-negpat` hook exists so they CAN be diverged deliberately later.
       One appearance, one rule, two independent ids: that is what §5.5a asks
       for, read as an appearance requirement rather than an id requirement. */
    const tag = String(mount || "grid").replace(/[^A-Za-z0-9_-]/g, "") || "grid";
    const patId = `faNeg-${tag}`;
    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: patId, width: 4, height: 4, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "fa-negpat gp-negpat",
    });
    pat.append(svgEl("line", { x1: 2, y1: 0, x2: 2, y2: 4, stroke: "currentColor", "stroke-width": 1.8 }));
    defs.append(pat);
    svg.append(defs);

    /* ---------- magnitude ticks, on a round ladder ---------------------

       NEVER ON THIS BOOK'S OWN QUANTILES. A graduation and a reading must not
       be able to be confused: an axis labelled with a 60th percentile of this
       particular chain tells the reader that something is special about four
       thousand three hundred contracts, and nothing is. The ladder is
       niceStep's — 1, 2, 2.5 or 5 times a power of ten — and nothing else is
       ever printed.

       WHY 2.5 IS ADMISSIBLE HERE AND IS REFUSED ON THE GAMMA LADDER.
       renderGamma explicitly does NOT reuse niceStep, because its axis is
       symlog and its marks are placed PER DECADE: mixing a 2.5 into a set of
       per-decade marks means two different ladders on one axis and the reader
       cannot tell a graduation from a reading. This axis is LINEAR and its
       marks are consecutive multiples of ONE step, so 0, 2.5K, 5K, 7.5K is a
       ruler in the ordinary sense — every mark is one step from its
       neighbours and the spacing is exactly proportional. The scaffolding's
       niceStep is therefore the right tool here and a private ladder would be
       a second copy of a number to keep in step.

       THE STEP IS WIDENED UNTIL IT CLEARS 34px. niceStep rounds DOWN to the
       ladder, so a raw of 1,990 becomes 1,000 and the ticks come out at half
       the intended pitch; escalating through niceStep(step × 2.5) stays on the
       same ladder (1 → 2.5 → 5 → 10) and is monotone, so the loop terminates.
       The guard counter is belt and braces against a pathological barRate. */
    const valueSpan = fMax - fMin;
    const targetTicks = Math.max(2, plotW / 64);
    let step = niceStep(valueSpan / targetTicks);
    /* Two escalation conditions, not one. The 40px floor is renderGamma's own
       and is about COLLISION: a "\u22122,500" label is 32px wide at 9px mono, so
       anything under 40 puts two labels shoulder to shoulder. The 12-mark cap is
       about DENSITY, and it is the one that bites in the enlarge dialog:
       niceStep rounds DOWN to the ladder, so a raw step of 442 becomes 250 and a
       955px plot picks up twenty graduations — a ruler so finely marked it reads
       as hatching. Measured at a 1,113px zoom host on the ground-truth fixture:
       20 marks before the cap, 9 after. */
    const tickCount = () => (barRate > 0 && step > 0
      ? Math.floor(negW / (step * barRate)) + Math.floor(posW / (step * barRate))
      : 0);
    /* THE ESCALATION IS niceStep(step * 2), WHICH WALKS THE LADDER ONE RUNG.
       niceStep returns the largest ladder value at or below its argument, so
       doubling lands on exactly the next rung every time: 1 -> 2 -> 2.5 -> 5 ->
       10 -> 20, monotone, so the loop terminates. Multiplying by 2.5 instead
       SKIPS the 2 rung, which is not academic — on the truncated 30-bar card at
       a 424px host it jumped straight from 1,000 to 2,500 and left the panel
       with two graduations 168px apart; walking one rung gives three at 67px.
       The `next > step` test is the belt for a barRate so small the ladder
       stops moving. */
    for (let guard = 0; guard < 24 && step > 0 &&
         (step * barRate < 40 || tickCount() > 12); guard++) {
      const next = niceStep(step * 2);
      if (!(next > step)) break;
      step = next;
    }

    /* A SIDE WITH NO BARS GETS NO GRADUATIONS. Position is magnitude on this
       axis, so a "−2K" tick in a half of the plot where the book has nothing
       at all reads as a measurement of an empty region. (A side that has even
       one small bar DOES keep its full ruler: unlike the symlog axis, a linear
       mark past the longest bar on its side still sits at exactly the position
       that magnitude occupies, so it is informative rather than misleading —
       it shows how empty that side is.) */
    const sides = [];
    if (fMax > 0) sides.push(1);
    if (fMin < 0) sides.push(-1);

    const ticks = [];
    if (step > 0 && barRate > 0) {
      for (const sgn of sides) {
        for (let m = 1; m <= 60; m++) {
          const v = m * step;
          let x = x0 + sgn * v * barRate;
          /* Three pixels of tolerance, then clamp. `rate` is the largest
             pixels-per-contract that fits both sides, so whenever the zero
             rule is not clamped to its 18/82 bounds the extreme value lands
             EXACTLY on plotL or plotR and a strict edge test discards it —
             a sub-pixel miss. Three pixels recovers that and nothing else. */
          if (x < plotL - 3 || x > plotR + 3) break;
          x = Math.min(plotR - 2, Math.max(plotL + 2, x));
          if (Math.abs(x - x0) < 18) continue;               // never crowd the zero rule
          if (ticks.some((t) => Math.abs(t.x - x) < 40)) continue;
          ticks.push({ x, v, sgn });
        }
      }
    }
    for (const t of ticks) {
      svg.append(svgEl("line", { class: "fa-tick", x1: t.x, x2: t.x, y1: padT - 2, y2: H - padB + 2 }));
      const lab = svgEl("text", { class: "fa-ticklabel", x: t.x, y: H - padB + 14, "text-anchor": "middle" });
      /* AN EXPLICIT SIGN ON BOTH HALVES (CHOICE 7). renderGamma prints its
         magnitudes unsigned because its two sides are "short" and "long",
         words its caption carries. Here the sign IS the field's published
         polarity and both halves are readings, so each names itself. */
      lab.textContent = (t.sgn < 0 ? MINUS : t.sgn > 0 ? "+" : "") + faTickLabel(t.v);
      svg.append(lab);
    }

    /* THE ZERO RULE IS DRAWN, and it is drawn before the bars so the bars sit
       over it. It is not an implied centre line: position relative to it is
       the primary sign channel on this panel, and a channel the reader has to
       infer is not a channel. */
    svg.append(svgEl("line", { class: "fa-zero", x1: x0, x2: x0, y1: padT - 4, y2: H - padB + 4 }));

    /* ---------- rows: bar, price label, rail ---------------------------- */

    /* The rail is an annotation column, not a tooltip: no plate, no fill, no
       border — nothing is ever drawn under it, so a background would buy
       nothing and cost the bars 20px. Text starts 6px right of the plot. */
    const railX = plotR + 6;
    const railBudget = railW - 6 - 2;
    const priceX = labelW - 6;
    const priceBudget = priceX - 2;

    let partialRows = 0, nullVolRows = 0, zeroNetRows = 0;

    bars.forEach((b, i) => {
      const y = yOfIndex(i);
      const barY = y - (ROW - 4) / 2;
      const barH = ROW - 4;
      const vol = isNum(b.vol);
      const calls = isNum(b.calls);
      const puts = isNum(b.puts);
      const missing = isNum(b.volMissing) === null ? 0 : b.volMissing;
      if (vol === null) nullVolRows++;
      if (missing > 0 && vol !== null) partialRows++;

      /* ---- the mark ------------------------------------------------- */
      if (b.net === 0) {
        /* A ZERO NET IS THE INTERESTING CASE AND IT GETS ITS OWN MARK.
           A strike where a put and a call were each lifted sixty-forty nets
           to zero, and a bar of zero length there is visually identical to a
           strike where nothing happened at all — which is a different fact
           and the one the builder deliberately kept the wings for. It is
           drawn as a short HORIZONTAL tick crossing the rule, not a vertical
           one: the zero rule is itself vertical, so a vertical tick on it
           would be invisible, and a horizontal one reads immediately as "the
           bar for this row has no length".

           DRAWN FOR EVERY MEASURED ZERO, not only when vol > 0. The rule as
           written names the vol > 0 case, which is the one with evidence
           beside it; but a zero-net row with vol === null still has a row, a
           price label and an em-dashed rail, and leaving its plot cell
           completely empty would be indistinguishable from a rendering
           failure. The two cases differ in the <title>, not in whether the
           reader can see that something was measured here. */
        zeroNetRows++;
        const g = svgEl("g");
        const ttl = svgEl("title");
        ttl.textContent = vol === null
          ? `${neg(b.k.toFixed(2))}: the aggressor split at this strike nets to exactly zero. ` +
            "No contract at this strike reported a volume, so there is no split to show beside it."
          : `${neg(b.k.toFixed(2))}: the aggressor split at this strike nets to exactly zero — ` +
            `${faGrouped(vol)} contracts traded, ` +
            (calls === null || puts === null
              ? "the call and put halves of that total were not published."
              : `${faGrouped(calls)} on calls and ${faGrouped(puts)} on puts.`);
        g.append(ttl);
        g.append(svgEl("line", {
          class: "fa-zeromark", x1: x0 - 4, x2: x0 + 4, y1: y, y2: y,
        }));
        svg.append(g);
      } else {
        const xg = xOf(b.net);
        const isNeg = b.net < 0;
        const bx = Math.min(x0, xg);
        /* A ZERO-WIDTH BAR READS AS NO DATA. Tiny-but-non-zero is a different
           fact, so there is a floor. It matters far more here than on the
           symlog ladder: linear in contracts, the smallest non-zero net
           measured across the fixtures (|net| = 1) against the largest
           (5,417) is 0.0002 of the plot width — literally invisible — and
           drawing it as nothing would say "no flow" about a strike that had
           some. The floor is why the zero mark above is a different SHAPE
           rather than a shorter bar. */
        const bw = Math.max(Math.abs(xg - x0), 1.5);

        const g = svgEl("g");
        const ttl = svgEl("title");
        ttl.textContent =
          `${neg(b.k.toFixed(2))}: ${faGrouped(Math.abs(b.net))} contracts net taken at the offer on ` +
          `${isNeg ? "puts" : "calls"} (net ${faGrouped(b.net)}).`;
        g.append(ttl);
        g.append(svgEl("rect", {
          class: "fa-bar " + (isNeg ? "is-neg" : "is-pos"),
          x: bx, y: barY, width: bw, height: barH,
        }));
        /* THE HATCH IS AN OVERLAY, NOT THE WHOLE BAR. Drawn as the fill with
           nothing underneath, a 1.8-on-4 tile covers about 45% of its box, so
           a short bar and a long bar of the same magnitude carried half the
           ink of each other and the texture that exists to carry the SIGN was
           quietly setting the reader's impression of the BALANCE — the one
           thing texture must not do on this panel. Fill underneath, texture
           cut into it from above: both channels intact. */
        if (isNeg) {
          g.append(svgEl("rect", {
            class: "fa-barhatch", x: bx, y: barY, width: bw, height: barH,
            fill: `url(#${patId})`,
          }));
        }
        svg.append(g);
      }

      /* ---- the strike label ------------------------------------------
         LABELLED EVERY ROW, because every row IS one listed strike: this is a
         categorical ladder, not a sampled axis, and an unlabelled row is a
         reading the user cannot use. At ROW = 12 a 10.5px mono label has 12px
         of pitch, which is tight but legible; the 9px branch (unreachable from
         a real payload, since the builder caps at 30) labels alternate rows.

         THE PRECISION ADAPTS TO THE 46px COLUMN. Measured across the emitted
         fixtures the widest strike is 566.42 — six characters, 37.8px, which
         just fits the 38px budget. A four-figure underlying (and there are
         plenty on a real board) would be seven characters, 44.1px, and SVG
         clips silently at the canvas edge, so the leading digit of the price
         would simply vanish with nothing looking wrong. Dropping decimals
         until it fits keeps the label honest at every price. */
      if (ROW >= 11 || i % 2 === 0) {
        let priceText = null;
        for (const dp of [2, 1, 0]) {
          const s = neg(b.k.toFixed(dp));
          if (faTextW(s, 10.5) <= priceBudget) { priceText = s; break; }
        }
        if (priceText === null) priceText = neg(String(Math.round(b.k)));
        const pt = svgEl("text", {
          class: "fa-price", x: priceX, y: y + 3, "text-anchor": "end",
        });
        pt.textContent = priceText;
        svg.append(pt);
      }

      /* ---- the rail --------------------------------------------------
         TOTAL VOLUME AT THE STRIKE, AND WHAT IT IS A TOTAL OF.

         vol === null is U+2014 with a reason, NEVER 0. The builder publishes
         null precisely because summing an absent volume field as zero
         produced "800 contracts lifted here, none traded", which is not a
         reading of anything.

         volMissing > 0 WITH vol NON-NULL IS THE MODAL CASE. Measured: 20 of
         30 bars on the truncated-chain emitter card and 6 of 17 on the
         ground-truth fixture publish a vol total while at least one contract
         at that strike reported no volume at all. `vol` is then a total over
         ONLY the lines that reported, and printing it bare is a completeness
         claim the data does not support.

         IT IS MARKED THREE WAYS (CHOICE 6): a trailing U+2026 in the text
         itself, the `.is-partial` class, and a <title> naming the count that
         did not report. The ellipsis is there because the other two both
         depend on something outside this function — a stylesheet rule that
         may not have been written yet, and a hover a touch reader never
         performs — and the incompleteness has to survive both. U+2026 is the
         ordinary typographic mark for "and more", which is exactly the
         claim: at least this many, possibly more. */
      const railG = svgEl("g");
      const railTtl = svgEl("title");
      const partial = vol !== null && missing > 0;
      let railText;

      if (vol === null) {
        railText = DASH;
        railTtl.textContent = "no contract at this strike reported a volume";
      } else {
        const base = faGrouped(vol);
        /* The calls/puts split rides in the rail on the zero-net rows only —
           the rows where the single number is not enough to tell the reader
           what happened. Three tiers, widest first, exactly as the gamma
           caption picks its long or short form: full precision if the 104px
           column holds it, one-decimal thousands if not, and the bare total
           with the split in the <title> if even that will not fit. */
        let splitText = "";
        if (b.net === 0 && calls !== null && puts !== null) {
          const long = ` ${faGrouped(calls)}c/${faGrouped(puts)}p`;
          const short = ` ${faK1(calls)}c/${faK1(puts)}p`;
          if (faTextW(base + long, 9.5) <= railBudget) splitText = long;
          else if (faTextW(base + short, 9.5) <= railBudget) splitText = short;
        }
        /* The ellipsis goes immediately after the TOTAL, before the split,
           because it is the total that is incomplete. Trailing it after the
           call/put pair read as though the split were the thing that had been
           cut short. */
        railText = base + (partial ? "…" : "") + splitText;
        railTtl.textContent = partial
          ? `${faGrouped(vol)} contracts at this strike, counted over the lines that reported a ` +
            `volume; ${faGrouped(missing)} further ${missing === 1 ? "line" : "lines"} at this ` +
            "strike reported none, so this total is a floor, not the whole strike."
          : `${faGrouped(vol)} contracts traded at this strike` +
            (calls !== null && puts !== null
              ? ` — ${faGrouped(calls)} on calls, ${faGrouped(puts)} on puts.`
              : ".");
      }

      railG.append(railTtl);
      const rt = svgEl("text", {
        class: "fa-rail" + (partial ? " is-partial" : ""),
        x: railX, y: y + 3, "text-anchor": "start",
      });
      rt.textContent = railText;
      railG.append(rt);
      svg.append(railG);
    });

    /* ---------- the axis caption ---------------------------------------
       AT the zero rule it labels, clamped to the CANVAS rather than the plot:
       the rule floats between 18% and 82% and a centred caption hangs off the
       edge when it sits near one, and at a 320px viewport the plot is 142
       units — no caption of this kind fits inside it, so clamping to the plot
       would push a 200-unit string into a 142-unit box and lose whichever end
       came off worst. It is an axis label, not plot furniture; it may use the
       whole canvas, and it drops to a short form when even that will not hold
       it. The long form names what "taken at the offer" means, because that is
       the identification rule of the whole panel in four words. */
/* EVERY GLYPH HERE IS IN THE MONO SUBSET, and the two that were are not.
       assets/css/base.css subsets JetBrains Mono to U+0000-00FF plus a named
       handful — U+2191, U+2193, U+2212, U+2000-206F. U+25C0/U+25B6, the
       pointing triangles this caption first used, are in NONE of them: they
       fell back to the system stack, which changes the advance mid-string, so
       faTextW below was measuring one font and the browser drawing two. The
       same trap the top-contracts table avoids by using U+2191/U+2193 rather
       than U+25B2/U+25BC.

       The separators are U+00B7, in range, and they are separators rather
       than runs of spaces because SVG COLLAPSES WHITESPACE in a <text> unless
       xml:space is set — the three spaces that were here rendered as one and
       the caption's three segments read as one sentence. */
    const axisLong = "< puts taken at the offer \u00b7 net contracts \u00b7 calls taken >";
    const axisShort = "< puts \u00b7 net contracts \u00b7 calls >";
    const axisText = faTextW(axisLong, 10) <= W - 8 ? axisLong : axisShort;
    const axisHalf = faTextW(axisText, 10) / 2;
    const axisX = Math.min(W - 4 - axisHalf, Math.max(4 + axisHalf, x0));
    const axis = svgEl("text", { class: "fa-axis", x: axisX, y: H - 3, "text-anchor": "middle" });
    axis.textContent = axisText;
    svg.append(axis);

    /* THE LABEL NAMES THE ACTUAL READING, not the chart type. */
    const biggestUp = bars.reduce((a, b) => (b.net > a.net ? b : a), bars[0]);
    const biggestDn = bars.reduce((a, b) => (b.net < a.net ? b : a), bars[0]);
    svg.setAttribute("aria-label",
      `Net aggressor flow by strike for ${card && card.ticker ? card.ticker : "this name"}, ` +
      `in contracts. ${bars.length} strikes. ` +
      /* The magnitude only: the SIDE is already named in words, so a repeated
         minus would be a sign on a quantity that is not signed in that
         sentence. */
      (fMax > 0
        ? `Most calls taken at the offer at ${neg(biggestUp.k.toFixed(2))}, ` +
          `${faGrouped(Math.abs(biggestUp.net))} contracts net. `
        : "No strike nets to the call side. ") +
      (fMin < 0
        ? `Most puts taken at the offer at ${neg(biggestDn.k.toFixed(2))}, ` +
          `${faGrouped(Math.abs(biggestDn.net))} contracts net. `
        : "No strike nets to the put side. ") +
      (partialRows
        ? `${partialRows} of ${bars.length} strikes publish an incomplete volume total.`
        : "Every strike drawn publishes a complete volume total."));

    host.append(svg);

    /* ---------- what the panel does NOT show ---------------------------- */

    /* HOW MUCH OF THE CHAIN IS ON THE LADDER. The builder's population is the
       CHAIN'S strikes, not the ones that happened to carry a split, so
       `shown < measuredStrikes` and `strikesUnreported > 0` are two different
       absences and each is named separately.

       MEASURED, and worth stating plainly: across 50 emitted cards
       `strikesUnreported` is 0 on every one of them, and `shown <
       measuredStrikes` fires on exactly the two truncated-chain cards, both
       at 30 of 31. The second half of this guard is the one that fires in
       practice; the first is kept because the field exists and a card that
       sets it would otherwise report a complete ladder. */
    const shown = isNum(panel.shown);
    const measured = isNum(panel.measuredStrikes);
    const total = isNum(panel.total);
    const unread = isNum(panel.strikesUnreported);
    /* EVERY COUNT PRINTED BELOW IS `bars.length`, THE NUMBER OF BARS THIS
       FUNCTION ACTUALLY DREW — never `panel.shown`, which is the builder's
       claim about what it put on the payload. The two are equal on all 50
       emitted cards, and they diverge exactly when a bar was dropped upstairs
       for publishing no usable strike or no usable net. Printing the claim
       would then say "30 strikes shown" under a panel showing 28, which is the
       same confident-completeness defect as printing a partial volume bare,
       one level up. */
    const drawn = bars.length;
    const dropped = rawBars.length - drawn;
    if (dropped > 0) {
      host.append(el("p", "fc-note",
        `${faGrouped(dropped)} of the ${faGrouped(rawBars.length)} strikes on this payload ` +
        "published no usable strike price or no usable net and are not drawn. They are absences, " +
        "not zeroes, so they are left off the ladder rather than laid on the zero rule."));
    }
    /* `dropped` is deliberately NOT a trigger for the note below. That note says
       the ladder was kept "nearest the money", which is the BUILDER's truncation
       rule; a bar dropped here for publishing no usable net was not cut for being
       far from the money and saying so would be a wrong reason attached to a right
       number. The drop has its own note above and its own effect on the foot. */
    const cut = (unread !== null && unread > 0) ||
                (shown !== null && measured !== null && shown < measured);
    if (cut) {
      const denom = total !== null ? total : measured;
      host.append(el("p", "fc-note",
        (denom !== null
          ? `${faGrouped(drawn)} of ${faGrouped(denom)} strikes on this chain shown, nearest the money. `
          : "Not every strike on this chain is shown; the ladder is kept nearest the money. ") +
        "That is where hedging happens and where the gamma ladder beside it is measured, " +
        "but it means the wings of this book are cut off rather than empty." +
        (unread !== null && unread > 0
          ? ` A further ${faGrouped(unread)} ${unread === 1 ? "strike" : "strikes"} on the chain ` +
            "carried no aggressor split at all and could not be laddered."
          : "")));
    }

    /* THE VENDOR'S OWN TRUNCATION. Fired on 2 of 50 emitted cards here and on
       10 of 11 names on the live wire, so it is designed for as the default
       rather than the exception.

       THE SENTENCE IS THIS PANEL'S. §6.3-10 gives a verbatim string ending
       "…the skew and term readings are withheld for that reason", which is
       true of the skew/term panel and NOT of this one — nothing is withheld
       here, the ladder is simply built over an arbitrary subset. Printing a
       withholding claim under a panel that withholds nothing would be its own
       small lie, so the first sentence is carried verbatim and the
       consequence is restated for what it actually is here. */
    const cov = panel.coverage || {};
    if (cov.truncated === true) {
      const seen = isNum(cov.rowsSeen);
      host.append(el("p", "fc-note",
        "The vendor returned a full page of 500 contracts in no documented order" +
        (seen !== null ? ` (${faGrouped(seen)} rows seen)` : "") +
        ". This is an arbitrary subset of the book, so this ladder is a ladder over that " +
        "subset: a strike missing from it may be a strike with no flow, or a strike the page " +
        "cut off. The two cannot be told apart from here."));
    }

    /* THE PARTIAL TOTALS, STATED ONCE FOR THE PANEL. A per-row title is not
       enough on its own — nobody hovers thirty rows — and this is the modal
       case, so it is said in words under the chart. */
    if (partialRows) {
      host.append(el("p", "fc-note",
        `${faGrouped(partialRows)} of the ${faGrouped(bars.length)} strikes drawn publish a volume ` +
        "total that is INCOMPLETE: at least one contract at that strike traded without reporting a " +
        "volume, so the figure in the rail counts only the lines that did and is a floor. Those " +
        "rails end in an ellipsis. The bar itself is unaffected — the aggressor split and the " +
        "volume are separate vendor fields, and a line can report one without the other."));
    }

    if (nullVolRows) {
      host.append(el("p", "fc-note",
        `${faGrouped(nullVolRows)} ${nullVolRows === 1 ? "strike carries" : "strikes carry"} an ` +
        "aggressor split but no reported volume at all. " +
        `${nullVolRows === 1 ? "Its rail reads" : "Their rails read"} ` +
        "—, not zero: the bar beside it is a measurement and the volume is an absence, and " +
        "the two must not be printed in the same ink."));
    }

    /* THE SCALE, IN THE TERMS THAT SAY WHAT TO DO ABOUT IT. The panel above
       this one is logarithmic and says so; a reader who carries that
       instruction across would under-read every long bar here. Saying "linear"
       is not the same as saying what linear buys.

       BEHIND THE DISCLOSURE, with the relation below it — see appendNotes.
       Both are the decoder rather than a reading; the counts and the
       incomplete-total warnings above stay in the open. */
    const method = [];
    method.push(
      "This axis is LINEAR in contracts, unlike the gamma ladder above it: a bar twice as long " +
      "is twice the net flow, and the two halves share one scale, so the left and right sides are " +
      "directly comparable and neither is normalised against its own extreme. " +
      "The zero rule is placed by the data — at " +
      `${(Math.min(0.82, Math.max(0.18, share)) * 100).toFixed(0)}% of the plot, from ` +
      "|min| / (|min| + |max|), clamped to a chosen [18%, 82%] so a one-sided book still shows " +
      "its minority side — and it is DRAWN, because which side of it a bar sits on is how the " +
      "sign is read here. Colour repeats that and carries nothing on its own." +
      (zeroNetRows
        ? ` ${faGrouped(zeroNetRows)} ${zeroNetRows === 1 ? "strike nets" : "strikes net"} to ` +
          "exactly zero and " + (zeroNetRows === 1 ? "is" : "are") + " marked with a tick on the " +
          "rule, with the call and put halves of the volume beside " +
          (zeroNetRows === 1 ? "it" : "them") + ": a strike where a put and a call were each " +
          "lifted sixty-forty is not a strike where nothing happened."
        : ""));

    /* THE RELATION, VERBATIM FROM THE BUILDER. It is published on the payload
       precisely so the renderer does not have to paraphrase it, and a
       paraphrase is a second answer to the same question. */
    if (typeof panel.relation === "string" && panel.relation) method.push(panel.relation);
    appendNotes(host, method, "How to read this ladder");

    /* THE FOOT: WHAT WAS COUNTED AND WHAT WAS NOT.

       Both are CONTRACT counts, not strike counts — the builder increments
       `reported` per contract row that carried both an ask and a bid volume,
       and `unreported` per contract that traded (or whose volume is itself
       unknown) with no split published. Measured on the ground-truth fixture:
       119 reported against 11 unreported; on the truncated card, 404 against
       52. Roughly one contract in nine that traded is invisible to this
       ladder, which is a fact about the ladder and belongs under it. */
    const rep = isNum(panel.reported);
    host.append(statList([
      ["contracts with a split", rep === null ? DASH : faGrouped(rep)],
      ["traded, no split published", unreportedN === null ? DASH : faGrouped(unreportedN)],
      ["strikes drawn", total === null
        ? faGrouped(drawn)
        : `${faGrouped(drawn)} of ${faGrouped(total)}`],
    ]));
  }

  /* ===== the three wave-2 stock panels ===== */
  /* =============================================================
     drawDarkpool, drawOiDeltas, drawVolContext — the per-name deep
     feeds: panels.darkpool, panels.oiDeltas, panels.volContext,
     shaped in shared/flows-stock.js and published on every card
     since the deep-feed leg shipped.

     THESE ARE THE FIRST PANELS ON THIS PAGE WITH A PUBLISHED
     "quiet" STATE. The chain four know only "ok" and "unavailable",
     because an empty chain is a failure of that leg; here a vendor
     that was read and answered with nothing is an ORDINARY state and
     must not wear the Unavailable banner. So the tagged union has
     three live arms plus the transitional one:

       missing key   — a card from before the deep feeds shipped.
                       The walk says so with PREDATES_STOCK, the
                       same story the chain panels tell about their
                       own wave.
       "unavailable" — this run could not read the feed; deadPanel,
                       with the builder's own reason verbatim.
       "quiet"       — the feed answered and held nothing; heading
                       plus one sentence, marked data-empty="quiet"
                       so a test can tell the silences apart without
                       parsing prose (flows-market.js's pulse idiom).

     PROSE IS THE PAYLOAD'S. Each panel ships its own `note`
     (shared/flows-stock.js STOCK_NOTES, written against the
     vendor's refusals) and these drawers render it through
     appendNotes rather than paraphrasing it. The words "print" and
     "trade" are allowed inside the darkpool panel ONLY, where the
     rows are reported equity executions; the other two panels never
     use them, and nothing anywhere claims a side, an identity or an
     intent.
     ============================================================= */

  /* THE TRANSITIONAL SENTENCE IS PER-WAVE, NOT PER-PAGE. A card from before
     the chain leg lacks the four chain keys; a card from before the deep
     feeds lacks the three stock keys. Each absence is dated by its own
     shipping, and telling a reader the wrong wave is a confident wrong fact
     about which card they are looking at. */
  const PREDATES_CHAIN =
    "this card was built before the option chain leg shipped, so this " +
    "panel was never in it.";
  const PREDATES_STOCK =
    "this card was built before the per-name deep feeds shipped, so this " +
    "panel was never in it.";
  /* A THIRD WAVE, AND IT GETS ITS OWN SENTENCE FOR THE SAME REASON THE
     SECOND DID. A card built before the market-wide join shipped carries no
     marketRank key at all, and telling that reader "this card predates the
     per-name deep feeds" would be a confident wrong fact about which card
     they are looking at — the deep feeds have been on every card for weeks. */
  const PREDATES_CROSS =
    "this card was built before the market-wide join shipped, so this panel " +
    "was never in it.";
  const STOCK_KEYS = new Set(["darkpool", "oiDeltas", "volContext"]);
  const CROSS_KEYS = new Set(["marketRank"]);
  const predatesSentence = (key) => (CROSS_KEYS.has(key)
    ? PREDATES_CROSS
    : STOCK_KEYS.has(key) ? PREDATES_STOCK : PREDATES_CHAIN);

  /**
   * The quiet arm: heading, ONE sentence, and the machine-readable kind.
   * Not deadPanel — "the feed answered with nothing" and "the feed could
   * not be read" are different facts, and only the second is a failure.
   */
  function ftQuiet(host, question, sentence) {
    const { el, panelHead } = window.FlowsPanels;
    panelHead(host, question);
    const p = el("p", "ft-quiet", sentence);
    p.setAttribute("data-empty", "quiet");
    host.append(p);
  }

  /** HH:MM read off the ISO timestamp's own digits — never through Date,
   *  which would shift the tape's stated minute into the reader's zone. */
  function fdpTime(at) {
    const m = /T(\d{2}):(\d{2})/.exec(String(at == null ? "" : at));
    return m ? m[1] + ":" + m[2] : window.FlowsPanels.DASH;
  }

  function drawDarkpool(host, panel, card, question, mount) {
    const { el, isNum, deadPanel, panelHead, px2, money, DASH } = window.FlowsPanels;

    const q = question || "Which off-exchange prints carried the size in this name?";

    if (panel === undefined || panel === null) return deadPanel(host, q, PREDATES_STOCK);
    if (panel.status === "quiet") {
      return ftQuiet(host, q,
        "The feed answered with nothing: no off-exchange print in this name " +
        "reached it with a dollar size to rank.");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    /* SECOND-STAGE GUARD. "ok" with zero rows cannot come out of the shaper
       today — it answers quiet — but a hand-mutated payload can present it,
       and an empty table under this heading reads as a broken renderer. */
    const rows = Array.isArray(panel.rows) ? panel.rows : [];
    if (!rows.length) {
      return ftQuiet(host, q,
        "The feed answered with nothing: no off-exchange print in this name " +
        "reached it with a dollar size to rank.");
    }

    panelHead(host, q);

    const table = el("table", "fc-levels fdp-table");
    const thead = el("thead");
    const hr = el("tr");
    const HEADS = [
      ["Time", "fdp-h-time", "The tape's own execution timestamp, UTC, to the minute."],
      ["Price", "c-num", "The reported execution price."],
      ["Size", "c-num", "Shares in the print, the tape's own count."],
      ["Dollars", "c-num",
        "The print's dollar size, the vendor's own premium field — the column these rows are ranked by."],
      ["Bid / Ask", "c-num",
        "The national best bid and offer beside the print, when the tape carried both."],
    ];
    for (const [label, cls, title] of HEADS) {
      const th = el("th", cls, label);
      th.scope = "col";
      th.title = title;
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);

    const tbody = el("tbody");
    for (const r of rows) {
      const tr = el("tr", "fdp-row" + (r.canceled === true ? " is-canceled" : ""));

      /* The cancel flag is a stated fact with exactly one honest rendering: a
         tag when the tape says true, NOTHING when it says false or says
         nothing at all. A "live" tag on the false rows would turn the null
         rows' absence of a tag into a claim. */
      const timeTd = tcCell(fdpTime(r.at), "fdp-time",
        "The tape's own execution timestamp, UTC. The tape reports these prints with delay.");
      if (r.canceled === true) {
        const tag = el("span", "fdp-tag", "cancelled");
        tag.title = "The tape carries a cancel flag on this print.";
        timeTd.append(tag);
      }
      tr.append(timeTd);

      tr.append(tcCell(px2(r.px), "c-num fdp-px",
        isNum(r.px) === null ? "The tape carried no price on this row." : "The reported execution price."));
      tr.append(tcCell(tcInt(r.size), "c-num fdp-size",
        isNum(r.size) === null ? "The tape carried no share count on this row." : "Shares in the print."));
      tr.append(tcCell(money(r.prem), "c-num fdp-prem",
        "The print's dollar size, the vendor's own premium field. Size moved here; " +
        "which way anyone was positioned is not on the tape."));

      const bid = isNum(r.bid), ask = isNum(r.ask);
      tr.append(tcCell(
        bid !== null && ask !== null ? px2(bid) + " / " + px2(ask) : DASH,
        "c-num fdp-quote",
        bid !== null && ask !== null
          ? "The national best bid and offer around the print, as the tape reported them. " +
            "Context only: the tape attributes no side, so where the print sat in this " +
            "quote is not a reading of who initiated."
          : "The tape carried no usable bid and ask beside this print — not a quote of zero."));
      tbody.append(tr);
    }
    table.append(tbody);

    const wrap = el("div", "fc-tablewrap fdp-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Off-exchange prints");
    wrap.append(table);
    host.append(wrap);

    /* THE CAPPED-LIST RULE, in the shaper's own numbers: what was kept, and
       what was counted out because it could not be ranked. Then the payload's
       note, verbatim — the refusals are the builder's to state. */
    const seen = isNum(panel.seen);
    const shed = isNum(panel.shed);
    const unpriced = isNum(panel.unpriced);
    const bits = [];
    if (shed !== null && shed > 0 && seen !== null) bits.push(rows.length + " kept of " + seen);
    if (unpriced !== null && unpriced > 0) {
      bits.push("+" + unpriced + " unpriced print" + (unpriced === 1 ? "" : "s") + " counted out");
    }
    if (bits.length) host.append(el("p", "fc-note fdp-count", bits.join(" · ") + "."));
    appendNotes(host, [panel.note], "About these prints");
  }

  /* ===== oiDeltas ===== */

  /** "C 150 · 09-18" — the contract in the payload's own three parts. The
   *  full expiry and the raw option symbol ride in the cell's title, because
   *  slice(5) drops the year and two Januaries are not the same contract. */
  function foiContract(r) {
    const { isNum, DASH } = window.FlowsPanels;
    const cp = r.cp === "C" || r.cp === "P" ? r.cp : null;
    const k = isNum(r.k);
    const exp = typeof r.exp === "string" && r.exp ? r.exp : null;
    if (cp === null && k === null && exp === null) return DASH;
    return (cp || DASH) + " " + (k === null ? DASH : String(k)) + " · " +
      (exp ? exp.slice(5) : DASH);
  }

  /** One streak counter as a span, or the em dash. The counter is the
   *  VENDOR'S — its rule is not published and is not restated here. */
  function foiStreakSpan(v, label, title) {
    const { el, isNum, DASH } = window.FlowsPanels;
    const n = isNum(v);
    const span = el("span", "foi-streak" + (n === null ? " is-unknown" : ""),
      n === null ? DASH : n + "d " + label);
    span.title = n === null
      ? "The vendor published no counter for this line — not a streak of zero."
      : title;
    return span;
  }

  function drawOiDeltas(host, panel, card, question, mount) {
    const { el, isNum, deadPanel, panelHead, DASH } = window.FlowsPanels;

    const q = question || "Where did open interest move between clearing snapshots?";

    if (panel === undefined || panel === null) return deadPanel(host, q, PREDATES_STOCK);
    if (panel.status === "quiet") {
      return ftQuiet(host, q,
        "The feed answered with nothing: the vendor surfaced no contract-level " +
        "open-interest change in this name.");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    const rows = Array.isArray(panel.rows) ? panel.rows : [];
    if (!rows.length) {
      return ftQuiet(host, q,
        "The feed answered with nothing: the vendor surfaced no contract-level " +
        "open-interest change in this name.");
    }

    panelHead(host, q);

    const table = el("table", "fc-levels foi-table");
    const thead = el("thead");
    const hr = el("tr");
    /* The delta is a Greek capital and the head is not set in the mono face —
       the same one-glyph-fallback trap TC_COLS documents, and the same fix. */
    const thChg = el("th", "c-num");
    thChg.scope = "col";
    thChg.title = "curr_oi minus the previous clearing snapshot's, the vendor's own difference. " +
      "A settled fact a day late by construction — never today's tape.";
    thChg.append(el("span", "ftt-greek", "Δ"));
    thChg.append(document.createTextNode("OI"));
    const heads = [
      [el("th", "foi-h-oc", "Contract"),
        "Call or put, strike and expiry, from the vendor's option symbol."],
      [thChg, null],
      [el("th", "c-num", "Growth"),
        "The same move as a share of the previous snapshot — the vendor's oi_change, " +
        "which is (curr_oi \u2212 last_oi) / last_oi and NOT a number of contracts. " +
        "This column and \u0394OI are two readings of one move, not two moves."],
      [el("th", "c-num", "Curr OI"), "Open interest at the newer of the two clearing snapshots."],
      [el("th", "c-num", "Vol"), "The vendor's contract volume beside the change."],
      [el("th", "foi-h-streaks", "Streaks"),
        "The vendor's own consecutive-session counters. Their rules are the vendor's and are not published."],
    ];
    for (const [th, title] of heads) {
      th.scope = "col";
      if (title) th.title = title;
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);

    const tbody = el("tbody");
    for (const r of rows) {
      const tr = el("tr", "foi-row");

      const exp = typeof r.exp === "string" && r.exp ? r.exp : null;
      tr.append(tcCell(foiContract(r), "foi-oc",
        (exp ? "Expiry " + exp + ". " : "") +
        (typeof r.oc === "string" && r.oc ? "Vendor symbol " + r.oc + "." : "")));

      /* SIGN IS IN THE GLYPH, and the tone class is decoration on top of it.
         tcSignedInt already refuses a sign at zero — a change of exactly zero
         is a measurement without a direction. */
      /* TWO FIELDS, TWO COLUMNS. This read `r.change`, which carried the
         vendor's oi_change — a RATIO — and drew it through tcSignedInt under
         a header whose own tooltip says "curr_oi minus the previous clearing
         snapshot's". The header was right and the data was not: a line that
         went 2,119 to 35,207 printed "+16" beside a tooltip naming both
         snapshots, and a 21.5% rise printed "+0". The count now comes from
         oi_diff_plain and the ratio has a column of its own. */
      const chg = isNum(r.diff);
      const growth = isNum(r.ratio);
      const prevOi = isNum(r.prevOi);
      const currOi = isNum(r.currOi);
      tr.append(tcCell(tcSignedInt(chg),
        "c-num foi-chg " + (chg === null ? "is-unknown" : chg > 0 ? "is-up" : chg < 0 ? "is-down" : "is-flat"),
        chg === null
          ? "The vendor published no contract difference for this line."
          : "Between the vendor's two clearing snapshots" +
            (prevOi !== null && currOi !== null
              ? ": " + tcInt(prevOi) + " to " + tcInt(currOi) : "") +
            ". A day late by construction, so it says what stuck — never today's tape."));
      tr.append(tcCell(tcSignedPct(growth),
        "c-num foi-growth " + (growth === null ? "is-unknown" : growth > 0 ? "is-up" : growth < 0 ? "is-down" : "is-flat"),
        growth === null
          ? "The vendor published no open-interest ratio for this line."
          : "The same move as a share of the previous snapshot. Not a contract count."));

      tr.append(tcCell(tcInt(r.currOi), "c-num foi-oi",
        currOi === null
          ? "The vendor published no current open interest for this line."
          : "Contracts outstanding at the newer clearing snapshot."));

      const vol = isNum(r.vol);
      const avgPx = isNum(r.avgPx);
      tr.append(tcCell(tcInt(r.vol), "c-num foi-vol",
        vol === null
          ? "The vendor published no volume for this line."
          : "The vendor's contract volume on this line" +
            (avgPx === null ? "" : ", at an average price of " + avgPx.toFixed(2)) + "."));

      const streaks = tcCell("", "foi-streaks", null);
      const up = isNum(r.oiUpDays);
      const vg = isNum(r.volGtOiDays);
      if (up === null && vg === null) {
        streaks.textContent = DASH;
        streaks.title = "The vendor published neither counter for this line — not streaks of zero.";
      } else {
        streaks.append(foiStreakSpan(r.oiUpDays, "↑OI",
          "The vendor's own counter: consecutive sessions of open-interest increases on this line."));
        streaks.append(document.createTextNode(" · "));
        streaks.append(foiStreakSpan(r.volGtOiDays, "V>OI",
          "The vendor's own counter: consecutive sessions with volume above open interest on this line."));
      }
      tr.append(streaks);
      tbody.append(tr);
    }
    table.append(tbody);

    const wrap = el("div", "fc-tablewrap foi-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Contract-level open-interest changes");
    wrap.append(table);
    host.append(wrap);

    /* The capped-list rule, then the payload's note verbatim — the note is
       where the vendor-selection caveat lives, and it is the builder's prose,
       not this file's. VENDOR ORDER PRESERVED upstream, so no sort here. */
    const seen = isNum(panel.seen);
    const shed = isNum(panel.shed);
    if (shed !== null && shed > 0 && seen !== null) {
      host.append(el("p", "fc-note foi-count", rows.length + " kept of " + seen + "."));
    }
    appendNotes(host, [panel.note], "About this feed");
  }

  /* ===== volContext ===== */

  /** A LEVEL as a whole percent for the axis rail: 0.31 → "31%". Unsigned —
   *  an implied volatility has no sign to carry. */
  function fvcPct(v) {
    const { isNum, DASH } = window.FlowsPanels;
    const n = isNum(v);
    return n === null ? DASH : (n * 100).toFixed(0) + "%";
  }

  /** One half's silence, under its own heading. Each half carries its own
   *  status and survives the other's absence — a curve with no rank history
   *  is half a panel, not an unavailable one. */
  function fvcHalfSilence(halfHost, half, quietSentence) {
    const { el } = window.FlowsPanels;
    const quiet = half && half.status === "quiet";
    const p = el("p", "ft-quiet", quiet
      ? quietSentence
      : "This half's feed could not be read this run" +
        (half && half.reason ? ": " + String(half.reason).replace(/\.+$/, "") : "") + ".");
    p.setAttribute("data-empty", quiet ? "quiet" : "unavailable");
    halfHost.append(p);
  }

  function drawVolContext(host, panel, card, question, mount) {
    const { el, svgEl, isNum, deadPanel, panelHead, vol1, neg, DASH } = window.FlowsPanels;

    const q = question ||
      "What does the chain charge across tenors, and where does implied volatility sit in its own year?";

    if (panel === undefined || panel === null) return deadPanel(host, q, PREDATES_STOCK);
    if (panel.status === "quiet") {
      return ftQuiet(host, q,
        "Both volatility feeds answered with nothing for this name — no listed " +
        "term structure and no rank history.");
    }
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    panelHead(host, q);

    const term = panel.term || null;
    const ivRank = panel.ivRank || null;
    const W = ftWidth(host);

    /* ---- the term half ---------------------------------------------- */
    const termHost = el("div", "fvc-half fvc-termhalf");
    termHost.append(el("h4", "fvc-h", "Term structure"));

    const termRows = term && term.status === "ok" && Array.isArray(term.rows) ? term.rows : [];
    /* x IS THE STATED TENOR, dte, falling back to the ROW INDEX only where
       dte is null (measured: no emitted row lacks it, but a point must not
       vanish for missing an axis). y is the expiry's own implied volatility.
       Nothing is fitted or interpolated — the polyline connects quotes, and
       its kinks are the reading. Built BEFORE the branch because the guard
       below is on what is drawable, not on what was published: the shaper
       drops rows without a volatility, so "ok" implies points today, but a
       hand-mutated payload can present rows with none and Infinity must not
       reach the scale. */
    const pts = [];
    termRows.forEach((r, i) => {
      const y = isNum(r && r.vol);
      if (y === null) return;
      const dte = isNum(r && r.dte);
      pts.push({ x: dte === null ? i : dte, y, dte, r });
    });
    pts.sort((a, b) => a.x - b.x);

    if (!termRows.length) {
      fvcHalfSilence(termHost, term,
        "The vendor answered the term-structure read with nothing for this name.");
    } else if (!pts.length) {
      fvcHalfSilence(termHost, { status: "quiet" },
        "The vendor answered the term-structure read with nothing this curve can place.");
    } else {
      let rawLo = Infinity, rawHi = -Infinity, xLo = Infinity, xHi = -Infinity;
      for (const p of pts) {
        if (p.y < rawLo) rawLo = p.y;
        if (p.y > rawHi) rawHi = p.y;
        if (p.x < xLo) xLo = p.x;
        if (p.x > xHi) xHi = p.x;
      }
      /* A flat curve and a single expiry still need a finite span to divide
         by; the pad is drawing headroom, not data. */
      const lo = rawHi - rawLo < 1e-9 ? rawLo - 0.01 : rawLo;
      const hi = rawHi - rawLo < 1e-9 ? rawHi + 0.01 : rawHi;
      if (xHi - xLo < 1e-9) xHi = xLo + 1;

      const H = 120, padL = 34, padR = 10, padT = 10, padB = 12;
      const xOf = (x) => padL + ((x - xLo) / (xHi - xLo)) * (W - padL - padR);
      const yOf = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

      const front = pts[0], back = pts[pts.length - 1];
      const svg = svgEl("svg", {
        class: "fvc-svg", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
        role: "img", preserveAspectRatio: "xMidYMid meet",
        "aria-label": "Implied-volatility term structure" +
          (card && card.ticker ? " for " + card.ticker : "") + ": " +
          pts.length + " listed expiries, from " + vol1(front.y) +
          (front.dte === null ? "" : " at " + front.dte + " days") + " out to " + vol1(back.y) +
          (back.dte === null ? "" : " at " + back.dte + " days") +
          ". Lowest " + vol1(rawLo) + ", highest " + vol1(rawHi) +
          ". Derived from quotes; none of it is a forecast.",
      });

      svg.append(svgEl("line", {
        class: "fvc-frame", x1: padL, x2: padL, y1: padT, y2: H - padB,
      }));
      svg.append(svgEl("polyline", {
        class: "fvc-line",
        points: pts.map((p) => xOf(p.x).toFixed(1) + "," + yOf(p.y).toFixed(1)).join(" "),
      }));
      for (const p of pts) {
        const g = svgEl("g", { class: "fvc-dotg" });
        const t = svgEl("title");
        const imp = isNum(p.r.impliedMovePerc);
        t.textContent = String(p.r.expiry) +
          (p.dte === null ? "" : ", " + p.dte + " days") +
          " · " + vol1(p.y) + " implied" +
          (imp === null ? "" : " · implied move " + vol1(imp) + " of spot") + ".";
        g.append(t);
        g.append(svgEl("circle", {
          class: "fvc-dot", cx: xOf(p.x).toFixed(1), cy: yOf(p.y).toFixed(1), r: 2,
        }));
        svg.append(g);
      }
      /* The rail: min and max as percentages, at their own heights. On a flat
         curve they are one number and one label. */
      const rail = [[rawHi, yOf(rawHi)]];
      if (rawHi - rawLo >= 1e-9) rail.push([rawLo, yOf(rawLo)]);
      for (const [v, y] of rail) {
        const t = svgEl("text", {
          class: "fvc-axis", x: padL - 5, y: (y + 3.5).toFixed(1), "text-anchor": "end",
        });
        t.textContent = fvcPct(v);
        svg.append(t);
      }
      termHost.append(svg);

      /* The mini-table: the FIRST rows in calendar order, stated as a slice
         so it can never be read as the population. Null is the em dash, and
         never a zero. */
      const mt = el("table", "fc-levels fvc-mini");
      const mh = el("thead");
      const mhr = el("tr");
      for (const [label, cls, title] of [
        ["Expiry", "fvc-mh-exp", "The listed expiry, as published."],
        ["IV", "c-num", "That expiry's own implied volatility."],
        ["Implied move", "c-num",
          "The vendor's implied move as a share of spot — what the chain charges, not what will happen."],
      ]) {
        const th = el("th", cls, label);
        th.scope = "col";
        th.title = title;
        mhr.append(th);
      }
      mh.append(mhr);
      mt.append(mh);
      const mb = el("tbody");
      for (const r of termRows.slice(0, 4)) {
        const tr = el("tr");
        tr.append(tcCell(typeof r.expiry === "string" && r.expiry ? r.expiry : DASH, "fvc-exp", null));
        tr.append(tcCell(vol1(r.vol), "c-num", null));
        tr.append(tcCell(isNum(r.impliedMovePerc) === null ? DASH : vol1(r.impliedMovePerc),
          "c-num",
          isNum(r.impliedMovePerc) === null
            ? "The vendor published no implied move for this expiry — not a move of zero."
            : null));
        mb.append(tr);
      }
      mt.append(mb);
      const mwrap = el("div", "fc-tablewrap fvc-miniwrap");
      mwrap.append(mt);
      termHost.append(mwrap);

      const termBits = [];
      if (termRows.length > 4) {
        termBits.push("first 4 of " + termRows.length + " listed expiries — the curve draws all " +
          termRows.length);
      }
      const tSeen = isNum(term.seen), tShed = isNum(term.shed);
      if (tShed !== null && tShed > 0 && tSeen !== null) {
        termBits.push(termRows.length + " kept of " + tSeen);
      }
      if (termBits.length) {
        const cap = termBits.join(" · ");
        termHost.append(el("p", "fc-note fvc-count",
          cap.charAt(0).toUpperCase() + cap.slice(1) + "."));
      }
    }
    host.append(termHost);

    /* ---- the rank half ---------------------------------------------- */
    const rankHost = el("div", "fvc-half fvc-rankhalf");
    rankHost.append(el("h4", "fvc-h", "IV rank"));

    const rankRows = ivRank && ivRank.status === "ok" && Array.isArray(ivRank.rows) ? ivRank.rows : [];
    if (!rankRows.length) {
      fvcHalfSilence(rankHost, ivRank,
        "The vendor answered the rank-history read with nothing for this name.");
    } else {
      /* THE HEADLINE IS THE PAYLOAD'S NUMBER IN THE PAYLOAD'S UNIT. rankUnit
         says percent 0-100 as published, and it is NEVER rescaled here — this
         vendor's rank fields have printed "1352% of its year" once already,
         which is why the unit travels with the number. rows arrive newest
         first, so rows[0] is the latest session. */
      const latest = rankRows[0];
      const rank = isNum(latest && latest.rank1y);
      const headline = el("p", "fvc-rank");
      if (rank === null) {
        const n = el("span", "fvc-rank-n is-missing", DASH);
        n.title = "No rank published for the latest session — not a rank of zero.";
        headline.append(n);
        headline.append(el("span", "fvc-rank-u", " no rank published"));
      } else {
        const n = el("span", "fvc-rank-n", neg(rank.toFixed(1)));
        n.title = "Where the latest session's implied volatility ranks against this name's own " +
          "past year, in the payload's unit: " + (ivRank.rankUnit || "as published") + ".";
        headline.append(n);
        headline.append(el("span", "fvc-rank-u", " / 100"));
      }
      if (latest && typeof latest.date === "string" && latest.date) {
        headline.append(el("span", "fvc-rank-d", " · " + latest.date));
      }
      rankHost.append(headline);

      /* The strip: oldest LEFT, newest RIGHT — the orientation every strip on
         this site uses (flows-board's spark, the events IV path, the score
         strips all say "oldest first"). The wire is newest-first, so it is
         reversed here. A NULL POINT IS A GAP, never a zero and never a bridge:
         a segment is drawn only between ADJACENT measured sessions. */
      const series = rankRows.slice().reverse().map((r) => isNum(r && r.rank1y));
      const n = series.length;
      const gaps = series.filter((v) => v === null).length;
      if (n >= 2 && gaps < n) {
        const SW = Math.max(120, Math.min(220, W - 120)), SH = 40, sPadX = 3, sPadY = 4;
        const xO = (i) => sPadX + (i / (n - 1)) * (SW - sPadX * 2);
        /* THE DOMAIN IS THE RANK'S OWN 0 TO 100, fixed — a strip rescaled to
           its own extremes would draw a quiet year and a violent one alike. */
        const yO = (v) => sPadY + (1 - v / 100) * (SH - sPadY * 2);
        const svg = svgEl("svg", {
          class: "fvc-spark", viewBox: `0 0 ${SW} ${SH}`, width: SW, height: SH,
          role: "img", preserveAspectRatio: "xMidYMid meet",
          "aria-label": "One-year implied-volatility rank by session, oldest on the left, on the " +
            "rank's own 0 to 100 scale: " + n + " sessions" +
            (gaps > 0 ? ", " + gaps + " of them with no published rank, drawn as gaps in the line" : "") +
            (rank === null
              ? ". The latest session publishes no rank."
              : ". Latest " + neg(rank.toFixed(1)) + "."),
        });
        svg.append(svgEl("line", { class: "fvc-frame", x1: sPadX, x2: SW - sPadX, y1: yO(0), y2: yO(0) }));
        for (let i = 0; i + 1 < n; i++) {
          if (series[i] === null || series[i + 1] === null) continue;
          svg.append(svgEl("line", {
            class: "fvc-spark-l",
            x1: xO(i).toFixed(1), y1: yO(series[i]).toFixed(1),
            x2: xO(i + 1).toFixed(1), y2: yO(series[i + 1]).toFixed(1),
          }));
        }
        series.forEach((v, i) => {
          if (v === null) return;
          /* A measured session BETWEEN two gaps has no segment on either side
             and would otherwise be invisible — it gets a dot. So does the
             newest session, which is the one the headline states. */
          const lone = (i === 0 || series[i - 1] === null) && (i === n - 1 || series[i + 1] === null);
          if (!lone && i !== n - 1) return;
          svg.append(svgEl("circle", {
            class: "fvc-spark-d" + (i === n - 1 ? " is-now" : ""),
            cx: xO(i).toFixed(1), cy: yO(v).toFixed(1), r: i === n - 1 ? 2 : 1.5,
          }));
        });
        rankHost.append(svg);
      }

      const rBits = [];
      const rSeen = isNum(ivRank.seen), rShed = isNum(ivRank.shed);
      if (rShed !== null && rShed > 0 && rSeen !== null) {
        rBits.push(rankRows.length + " kept of " + rSeen);
      }
      if (gaps > 0) {
        rBits.push(gaps + " session" + (gaps === 1 ? "" : "s") + " with no published rank — gaps " +
          "in the strip, never zeros");
      }
      if (rBits.length) {
        const cap = rBits.join(" · ");
        rankHost.append(el("p", "fc-note fvc-count",
          cap.charAt(0).toUpperCase() + cap.slice(1) + "."));
      }
    }
    host.append(rankHost);

    appendNotes(host, [panel.note], "About this panel");
  }

  /* ---------- the drawer table ------------------------------------- */

  /* Keyed by the SAME strings shared/flows-panels.js publishes. The test
     suite asserts these two key sets are equal in both directions: a drawer
     with no registry entry never mounts, and a registry entry with no drawer
     is a visible dead panel rather than a blank one. */

  /* ===== marketRank: the market-wide standing ===== */
  /* =============================================================
     drawMarketRank — panels.marketRank, built by
     indexMarketCross/buildMarketCross in shared/flows-card.js off
     the two market-wide feeds the pulse leg already fetches once a
     run.

     WHAT IT MUST NOT LET A READER BELIEVE, and each of these has a
     line of code holding it:

     1. THAT ABSENCE IS QUIET. Both feeds are SELECTIONS. A name
        that is not in one did not make a market-wide list; it is
        not a name with no open-interest change and no off-exchange
        prints. So a missing name gets the quiet arm — never the
        Unavailable banner — and the sentence carries the feed's
        own population and, when the feed actually filled the
        request, the value the last place held, so "just missed"
        and "nowhere near" are different readings on the page.

     2. THAT THE RANKING IS TODAY'S. The vendor states its
        market-wide open-interest feed updates about 06:45 Eastern;
        this pipeline runs at 05:15 Eastern. The session line under
        each reading is therefore not decoration — it is the whole
        difference between "ranks 14th across the market today" and
        "ranked 14th across the market yesterday, joined onto
        today's card". A feed that states no date says so; it never
        borrows the card's.

     3. THAT A RANK IS A NUMBER ON ITS OWN. Every rank is printed
        as "14 of 40" and never as "14". The population is the
        payload's, and where the feed returned fewer rows than this
        run asked for, the caption says the list was not cut by the
        request at all.

     4. THAT COVERAGE IS FINE. If three of fifty board names appear
        in a feed, forty-seven cards will each say they are not in
        it. That is one thin join, not forty-seven findings, and
        the coverage line says which it is on every card.

     SIGN NEVER RIDES ON HUE. The open-interest reading is signed
     and the sign is in the glyph (tcSignedInt: + / U+2212, and
     nothing at all at zero). The tone class on top is decoration
     and the panel reads identically in greyscale.
     ============================================================= */

  /** The feeds, in the order the panel reads them, with their headings. */
  const FMR_FEEDS = [
    ["oiChange", "Open-interest change",
      "The vendor's market-wide ranking of option contracts by open-interest change. " +
      "It compares two clearing snapshots, so it is a settled fact a day late by " +
      "construction and never today's tape."],
    ["darkpool", "Off-exchange prints",
      "The market-wide feed of the most recent off-exchange equity prints. These are " +
      "executions, reported with delay, attributing no side and no participant."],
  ];

  /**
   * One feed's silence, with the machine-readable kind on it.
   *
   * TWO LEAD-INS, AND NEITHER IS THE OTHER'S. "Unavailable" is the banner the
   * whole page uses for a source that did not answer. A name that is simply
   * not in a market-wide list needs the opposite of that banner and cannot
   * borrow the card's other stock phrase either — "Nothing to report" is
   * false here, because what is being reported is that the feed WAS read and
   * this name was not in it. So the quiet arm leads on the reading itself.
   *
   * The publisher's sentences are written to follow a lead-in and carry no
   * closing stop, exactly as every other panel's reason does; the stop is
   * added here rather than in fifteen builder strings.
   */
  function fmrSilence(host, kind, sentence) {
    const { el } = window.FlowsPanels;
    const p = el("p", kind === "quiet" ? "ft-quiet fmr-empty" : "fc-dead fmr-empty");
    p.setAttribute("data-empty", kind);
    p.append(el("strong", null, kind === "quiet" ? "Not in this feed. " : "Unavailable. "));
    p.append(document.createTextNode(String(sentence).trim().replace(/\.+$/, "") + "."));
    host.append(p);
  }

  /**
   * The unit that agrees in number with the value it follows.
   *
   * TWO LENGTHS, ONE UNIT. `unitOf` completes the phrase — "% OF THE PREVIOUS
   * SESSION'S OPEN INTEREST" — and belongs in a sentence, not in an 8.5rem
   * statistic cell where it would wrap to four lines under a number. So the
   * short form goes beside the figure and the long form goes in the prose,
   * and neither is the unit being dropped.
   */
  function fmrUnit(n, f, long) {
    if (!f.unit) return "";
    const one = Math.abs(n) === 1;
    return " " + (one ? (f.unitOne || f.unit) : f.unit) +
      (long && f.unitOf ? " " + f.unitOf : "");
  }

  /**
   * A value in the unit its own feed reported it in.
   *
   * THREE KINDS AND NO DEFAULT. A dollar size, a signed contract count and a
   * ratio of the previous snapshot are three different quantities, and the
   * publisher reconciles which one the vendor actually sent rather than
   * assuming. When it could not, `kind` is null and this returns null so the
   * caller prints the refusal in words — a bare figure under a heading a
   * reader will read as contracts is exactly the confident wrong reading the
   * reconciliation exists to prevent.
   */
  function fmrValue(v, f, long) {
    const { isNum, money, MINUS } = window.FlowsPanels;
    const n = isNum(v);
    if (n === null) return null;
    if (f.kind === "money") return money(n);
    if (f.kind === "count") return tcSignedInt(n) + fmrUnit(n, f, long);
    if (f.kind === "ratio") {
      const p = n * 100;
      const body = Math.abs(p).toFixed(1);
      /* THREE ARMS ON THE SIGN, and the middle one is the point: a ratio of
         exactly zero is a measured no-change and must not wear a + . */
      return (p < 0 ? MINUS : p > 0 ? "+" : "") + body + fmrUnit(p, f, long);
    }
    return null;
  }

  /** HH:MM off the stamp's own digits, with its date — never through Date. */
  function fmrStamp(at) {
    const s = String(at == null ? "" : at);
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s);
    return m ? m[1] + " " + m[2] + ":" + m[3] + " UTC" : null;
  }

  /**
   * The session the FEED describes, against the session the CARD describes.
   *
   * NULL IS NOT FALSE. `sameSession` is null when the feed stated no date of
   * its own, and that sentence must not read as "a different session" — it is
   * "nobody said". Three outcomes, three sentences.
   */
  function fmrSessionLine(f, cardDate) {
    const { el } = window.FlowsPanels;
    let text;
    if (!f.asOfStated || !f.asOf) {
      text = "This feed states no session of its own, so which session the ranking is " +
        "from is unknown — it is not assumed to be this card's.";
    } else if (f.sameSession === true) {
      text = "The feed dates itself " + f.asOf + ", the same session this card describes.";
    } else if (f.sameSession === false) {
      text = "The feed dates itself " + f.asOf + ", which is NOT the session this card " +
        "describes" + (cardDate ? " (" + cardDate + ")" : "") + ". This ranking is from " +
        "another session and the per-name readings on this page are not.";
    } else {
      text = "The feed dates itself " + f.asOf + "; this card names no session to compare " +
        "it against.";
    }
    if (f.asOfSessions > 1) {
      text += " Its rows span " + f.asOfSessions + " sessions, so the date above is the " +
        "newest of them rather than the whole feed's.";
    }
    const p = el("p", "fc-note fmr-when", text);
    p.title = "This pipeline runs at 05:15 Eastern and the vendor states its market-wide " +
      "open-interest feed updates at about 06:45 Eastern, so a market-wide ranking read " +
      "here is usually the previous session's.";
    return p;
  }

  /** The cut a name outside the feed did not clear, in words the feed earns. */
  function fmrCutLine(f) {
    const { el } = window.FlowsPanels;
    if (!f.ordered) {
      return el("p", "fc-note fmr-cut",
        "The rows came back in no order this run could measure, so there is no cut-off " +
        "value to compare against: position in this feed is the vendor's arrangement, " +
        "not a threshold.");
    }
    if (f.cutAt) {
      const stamp = fmrStamp(f.cutAt);
      return el("p", "fc-note fmr-cut",
        "Ordered by " + f.orderedBy + ". The window reaches back to " +
        (stamp || "an unreadable stamp") + " — a name whose last off-exchange print is " +
        "older than that cannot be in this list at any size.");
    }
    const cut = fmrValue(f.cut, f, true);
    if (cut === null) {
      return el("p", "fc-note fmr-cut",
        "Ordered by " + f.orderedBy + ", but the value at the last place could not be " +
        "put in a unit this run could name, so it is not printed as a threshold.");
    }
    return el("p", "fc-note fmr-cut",
      "Ordered by " + f.orderedBy + ". The last place in the feed held " + cut +
      (f.capped
        ? ", so that is the cut this name is measured against."
        : ", and the feed returned fewer rows than this run asked for — nothing was cut " +
          "off by our own limit."));
  }

  /**
   * "19 of 50 board names" — the join's own reach, on every card.
   *
   * READ OFF THE PANEL, NOT OFF THE FEED READING. Coverage is a fact about
   * the join and is identical on every card of the run; the panel carries it
   * once and this reads it there, so there is no second copy of a number that
   * would have to keep agreeing with the first.
   */
  function fmrCoverageLine(c) {
    const { el } = window.FlowsPanels;
    if (!c || typeof c.of !== "number" || typeof c.in !== "number" || !c.of) return null;
    const p = el("p", "fc-note fmr-cover",
      c.in + " of " + c.of + " name" + (c.of === 1 ? "" : "s") + " carrying a card today " +
      "appear" + (c.in === 1 ? "s" : "") + " in this feed" +
      (c.in * 5 < c.of
        ? ". At that reach most cards will say they are not in it, which is one thin join " +
          "rather than a finding about any one name."
        : "."));
    p.title = "Measured across the names this run built a card for, not across the whole " +
      "board and not across the market.";
    return p;
  }

  function drawMarketRank(host, panel, card, question, mount) {
    const { el, isNum, deadPanel, panelHead, statList, DASH } = window.FlowsPanels;

    const q = question || "Does this name place in the market’s own two lists, and from which session?";

    if (panel === undefined || panel === null) return deadPanel(host, q, PREDATES_CROSS);
    if (panel.status === "quiet") return ftQuiet(host, q, panel.reason || "");
    if (panel.status !== "ok") return deadPanel(host, q, panel.reason);

    panelHead(host, q);

    const feeds = panel.feeds || {};
    for (const [key, heading, blurb] of FMR_FEEDS) {
      const f = feeds[key];
      const block = el("section", "fmr-block");
      const h = el("h4", "fmr-h", heading);
      h.title = blurb;
      block.append(h);

      if (!f || f.status === "unavailable") {
        fmrSilence(block, "unavailable",
          (f && f.reason) || "this feed was not carried into the card build this run.");
        host.append(block);
        continue;
      }

      if (f.status === "ok") {
        const fmrTitles = [];
        const value = fmrValue(f.value, f);
        const rank = isNum(f.rank);
        const pop = isNum(f.population);
        const count = isNum(f.count);
        /* THE RANK AND ITS POPULATION IN ONE CELL, because they are one
           reading. "14" alone is the number this panel exists to refuse. */
        const pairs = [
          ["Rank",
            rank === null || pop === null ? DASH : tcInt(rank) + " of " + tcInt(pop),
            "fmr-rank"],
          /* THE TONE CLASS ONLY WHERE THERE IS A SIGN TO DECORATE. A dollar
             print size has no direction — the tape attributes no side — so
             tinting it would claim one. Four arms on the signed case, because
             a change of exactly zero is a measurement and not a small rise. */
          ["Value", value === null ? DASH : value,
            f.kind === "count"
              ? "fmr-val " + (isNum(f.value) === null ? "is-unknown"
                : f.value > 0 ? "is-up" : f.value < 0 ? "is-down" : "is-flat")
              : "fmr-val"],
        ];
        if (count !== null && count > 1) {
          /* ONE LINE IN THE TOP HUNDRED AND A WHOLE BOOK IN IT ARE DIFFERENT
             READINGS, so the count is printed rather than folded into the
             rank.

             THE POSITIONS RIDE IN THE CELL'S TITLE, WITH THE CUT STATED. The
             note this replaces said the alternative was "eleven numbers in an
             8.5rem cell", which the payload cannot produce: shared/
             flows-card.js caps the list at CROSS_ROWS and publishes `shown`
             beside `count`, so it is at most three positions. What does not
             fit the cell is the sentence around them — three positions plus
             "the first 3 of 11; the rest are not listed" is prose, and the
             cell holds the count, which is the reading. */
          const rows = Array.isArray(f.rows) ? f.rows : [];
          const shown = isNum(f.shown);
          const cell = ["Rows", tcInt(count) + (key === "oiChange" ? " contracts" : " prints"),
            "fmr-rows"];
          pairs.push(cell);
          fmrTitles.push([cell, rows.length
            ? "At position" + (rows.length === 1 ? " " : "s ") + rows.join(", ") +
              (shown !== null && shown < count
                ? " (the first " + shown + " of " + count + "; the rest are not listed)"
                : "") + " in the feed."
            : "The feed carried no positions for this name."]);
        }
        if (f.at) pairs.push(["Printed", fmrStamp(f.at) || DASH, "fmr-at"]);
        const dl = statList(pairs);
        /* statList takes no titles, so the tooltip is attached afterwards by
           finding the pair's own wrapper — the pairs are index-aligned with
           the wrappers statList builds, and each pair is one wrapper. */
        for (const [pair, title] of fmrTitles) {
          const at = pairs.indexOf(pair);
          const wrap = at >= 0 ? dl.children[at] : null;
          if (wrap) wrap.title = title;
        }
        block.append(dl);

        if (value === null && isNum(f.value) !== null) {
          block.append(el("p", "fc-note fmr-nounit",
            "This run could not reconcile the vendor's own change field against the two " +
            "clearing snapshots it publishes beside it, so the value is not printed: a " +
            "number whose unit is unknown reads as contracts and might be a ratio."));
        }
        block.append(el("p", "fc-note fmr-said",
          "This name places " +
          (rank === null || pop === null ? "in this feed" : tcInt(rank) + " of " + tcInt(pop)) +
          " in a market-wide list this run reads once for the whole board. That is a " +
          "cross-section the per-name feeds on this page cannot report, because a request " +
          "for one name carries no other names in it."));
      } else {
        /* MEASURED, AND NOT IN IT. The publisher's own sentence, verbatim —
           it is the sentence that separates a selection from a silence, and
           paraphrasing it here would put that distinction in two places. */
        fmrSilence(block, "quiet", f.reason || "this name is not in this feed this run.");
      }

      block.append(fmrCutLine(f));
      block.append(fmrSessionLine(f, card && card.sessionDate));
      const cov = fmrCoverageLine((panel.coverage || {})[key]);
      if (cov) block.append(cov);
      host.append(block);
    }

    const notes = panel.notes || {};
    appendNotes(host, [notes.what, notes.absence, notes.rank, notes.timing, notes.units],
                "About this market-wide join");
  }

  const DRAW = {
    gamma: P.gamma,
    aggressor: drawAggressor,
    ivSurface: drawIvSurface,
    skewTerm: drawSkewTerm,
    topContracts: drawTopContracts,
    levels: P.levels,
    surface: P.surface,
    displacement: P.displacement,
    calendar: P.calendar,
    pricedMove: P.pricedMove,
    path: P.path,
    context: P.context,
    congress: P.congress,
    marketRank: drawMarketRank,
    darkpool: drawDarkpool,
    oiDeltas: drawOiDeltas,
    volContext: drawVolContext,
    scoreOverlay: P.overlay,
    deltaExposure: P.deltaExposure,
    charm: P.charm,
    vanna: P.vanna,
    __score: null,          // drawn from the card's TOP LEVEL, not its panels
  };

  /* ---------- the walk --------------------------------------------- */

  /**
   * Draw every registered panel of one card into its host.
   *
   * @param {string} mount — "grid" or "zoom". Suffixes every <defs> id the
   *   drawers emit. SVG ids are DOCUMENT-GLOBAL and url(#id) resolves to the
   *   first match in document order, so a page holding a grid copy and an
   *   enlarged copy of the same panel would silently give the second drawing
   *   the first's pattern. Today the two tiles happen to be identical; the
   *   moment one scales, it is wrong and nothing looks wrong.
   */
  function drawAll(card, mount) {
    const missing = [];
    for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
      const key = section.dataset.panel;
      const question = section.dataset.question || "";
      const host = section.querySelector("div");
      /* NEVER `if (!host) return`. A host that has gone missing is a markup
         defect, and skipping it silently is how a panel disappears from a
         page for a release without anyone noticing. */
      if (!host) { missing.push(key); continue; }

      if (key === "__score") {
        try { P.score(host, card, question); }
        catch (error) { deadPanel(host, question, drawFailed(error)); }
        continue;
      }

      const drawer = DRAW[key];
      if (typeof drawer !== "function") {
        deadPanel(host, question, "no renderer is registered for this panel.");
        continue;
      }

      const panel = card.panels && card.panels[key];
      /* THREE DIFFERENT ABSENCES, and only one of them is an error.
         `undefined` is a card built before the panel existed — a legacy
         payload, not a failure. `{status:"unavailable"}` is this run
         declining to publish, and it carries its own reason. Anything else
         goes to the drawer, which switches on status before touching a
         number. The transitional sentence is per-wave (predatesSentence):
         the chain four and the deep-feed three shipped at different times,
         and each absence is dated by its own wave. */
      if (panel === undefined) {
        deadPanel(host, question, predatesSentence(key));
        continue;
      }

      /* ONE CALL SHAPE FOR EVERY DRAWER. The ten extracted renderers take
         (host, panel) or (host, panel, card); the four new ones take two more.
         JavaScript discards the arguments a function does not declare, so the
         widest signature is safe for all of them and there is no per-panel
         table of shapes to keep in step with the renderers. */
      try {
        drawer(host, panel, card, question, mount);
      } catch (error) {
        deadPanel(host, question, drawFailed(error));
      }
    }
    if (missing.length) {
      console.error("flows-ticker: no drawing host for panel(s): " + missing.join(", "));
    }
  }

  /* A thrown renderer is reported as a dead panel with its message, never as
     a blank box and never as a silently missing section. The message is the
     error's own, because a generic "something went wrong" is exactly the
     string that makes a bug take a week to find. */
  function drawFailed(error) {
    return "this panel's renderer failed: " + String((error && error.message) || error);
  }

  /* ---------- the enlarge dialog ------------------------------------ */

  const zoom = $("ftZoom");
  const zoomHost = $("ftZoomHost");
  const zoomTitle = zoom && zoom.querySelector(".ft-panel-t");
  let zoomKey = null;
  let zoomOpener = null;

  let hashBeforeZoom = "";

  function openZoom(key, section) {
    if (!zoom || !zoomHost || typeof zoom.showModal !== "function") return;
    zoomKey = key;
    zoomOpener = section.querySelector(".ft-zoom-open");
    /* THE OPEN PANEL IS REFLECTED INTO THE URL, so a reader looking at one
       chart can send exactly that chart. Restored on close rather than
       cleared, because a reader who arrived on #ftg-tape and enlarged a panel
       expects to still be on #ftg-tape afterwards. */
    hashBeforeZoom = String(location.hash || "").slice(1);
    writeHash("panel-" + key);
    const titleEl = section.querySelector(".ft-panel-t");
    if (zoomTitle) zoomTitle.textContent = titleEl ? titleEl.textContent : "";
    zoom.showModal();
    /* THE rAF IS REQUIRED, NOT COSMETIC. showModal() on a display:none
       element leaves clientWidth at 0 in the same tick, ftWidth would floor
       to 300, and the ENLARGED panel would be drawn smaller than the grid
       panel it came from. */
    requestAnimationFrame(() => drawZoom());
  }

  function drawZoom() {
    if (!zoomKey || !zoomHost || !painted) return;
    const section = grid.querySelector('.ft-panel[data-panel="' + cssEscape(zoomKey) + '"]');
    const question = (section && section.dataset.question) || "";
    /* REDRAWN AT THE DIALOG'S WIDTH, NEVER CSS-SCALED. transform:scale()
       would multiply every absolute unit — 9px axis type to 24px, the 112px
       rail to 298px — and break the one-viewBox-unit-is-one-CSS-pixel
       invariant in the one place a reader is looking hardest. */
    if (zoomKey === "__score") {
      try { P.score(zoomHost, painted, question); }
      catch (error) { deadPanel(zoomHost, question, drawFailed(error)); }
      return;
    }
    const drawer = DRAW[zoomKey];
    const panel = painted.panels && painted.panels[zoomKey];
    if (typeof drawer !== "function") {
      deadPanel(zoomHost, question, "no renderer is registered for this panel.");
      return;
    }
    if (panel === undefined) {
      deadPanel(zoomHost, question, predatesSentence(zoomKey));
      return;
    }
    try { drawer(zoomHost, panel, painted, question, "zoom"); }
    catch (error) { deadPanel(zoomHost, question, drawFailed(error)); }
  }

  /* CSS.escape is not in every browser this site still answers. The keys are
     the registry's own, so the fallback only has to survive them. */
  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }

  if (zoom) {
    grid.addEventListener("click", (event) => {
      const button = event.target.closest && event.target.closest(".ft-zoom-open");
      if (!button) return;
      const section = button.closest(".ft-panel[data-panel]");
      if (section) openZoom(section.dataset.panel, section);
    });
    const closeButton = $("ftZoomClose");
    if (closeButton) closeButton.addEventListener("click", () => zoom.close());
    /* A GEOMETRIC BACKDROP TEST, not `event.target === dialog`. A <dialog> is
       its own scroll container, so a scrollbar drag has the dialog itself as
       target and the naive test closes the dialog under the reader's cursor. */
    zoom.addEventListener("click", (event) => {
      const box = zoom.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right &&
        event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) zoom.close();
    });
    zoom.addEventListener("close", () => {
      zoomKey = null;
      writeHash(hashBeforeZoom);
      if (zoomHost) zoomHost.replaceChildren();
      if (zoomOpener && document.contains(zoomOpener)) zoomOpener.focus();
      zoomOpener = null;
    });
  }

  /* ---------- resize ------------------------------------------------ */

  /* GATED ON WIDTH ONLY. Mobile browsers fire resize when the URL bar
     retracts, which changes the height and nothing a chart reads; redrawing
     there would rebuild fourteen panels for a scroll. */
  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!painted) return;
      /* THE BAR IS RE-MEASURED WITH THE CHARTS. Its height is what every
         anchor's scroll-margin is calculated from, and the identity row wraps
         at a different count on every width — a stale height puts the panel a
         reader jumped to underneath the bar that took them there. */
      syncBarHeight();
      drawAll(painted, "grid");
      if (zoomKey) drawZoom();
    }, 160);
  });

  /* ---------- the cursor spotlight ----------------------------------

     ONE DELEGATED LISTENER ON THE GRID, ported from flows-board.js without a
     change to its logic. The two attach conditions differ in KIND: `pointer:
     fine` is capability — a touch device has no hover state to decorate —
     and `prefers-reduced-motion` is consent, where the answer is not to
     soften the effect but to not attach at all. The CSS hides the layer too,
     so neither half can leak past the other. Both are re-checked on change,
     because a media query read once at boot is a preference honoured once. */
  const fine = window.matchMedia("(pointer: fine)");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  let spotlightOn = false;
  let frame = 0;
  let pending = null;

  function onPointerMove(event) {
    const panel = event.target.closest && event.target.closest(".ft-panel");
    if (!panel) return;
    pending = { panel, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pending) return;
      const { panel: target, x, y } = pending;
      const box = target.getBoundingClientRect();
      if (!box.width || !box.height) return;
      target.style.setProperty("--mx", (((x - box.left) / box.width) * 100).toFixed(1));
      target.style.setProperty("--my", (((y - box.top) / box.height) * 100).toFixed(1));
    });
  }

  function syncSpotlight() {
    const want = fine.matches && !calm.matches;
    if (want === spotlightOn) return;
    spotlightOn = want;
    if (want) {
      grid.addEventListener("pointermove", onPointerMove, { passive: true });
    } else {
      grid.removeEventListener("pointermove", onPointerMove);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      pending = null;
      for (const panel of grid.querySelectorAll(".ft-panel")) {
        panel.style.removeProperty("--mx");
        panel.style.removeProperty("--my");
      }
    }
  }
  for (const query of [fine, calm]) {
    if (query.addEventListener) query.addEventListener("change", syncSpotlight);
    else if (query.addListener) query.addListener(syncSpotlight);   // older Safari
  }
  syncSpotlight();

  /* ---------- staleness --------------------------------------------- */

  const STALE_WRITE_MS = 30 * 60 * 60 * 1000;
  const STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;

  /* TWO INDEPENDENT TESTS, because a card can be freshly WRITTEN from a stale
     SESSION: the pipeline runs, the vendor is behind, and the payload lands
     with today's timestamp and Friday's numbers. Either fires the band. */
  function assessAge(card) {
    const now = Date.now();
    const parts = [];
    const written = isNum(card.__updatedAt);
    if (written !== null && now - written > STALE_WRITE_MS) {
      parts.push("this card was last written " +
        Math.round((now - written) / 3600000) + " hours ago");
    }
    const session = card.sessionDate ? Date.parse(card.sessionDate + "T00:00:00Z") : NaN;
    if (Number.isFinite(session) && now - session > STALE_SESSION_MS) {
      parts.push("it reports the session of " + card.sessionDate);
    }
    return parts;
  }

  function setStale(parts) {
    if (!staleEl) return;
    if (!parts.length) { staleEl.hidden = true; staleEl.textContent = ""; return; }
    staleEl.textContent = "Stale: " + parts.join(", ") + ".";
    staleEl.hidden = false;
    /* CHROME AS WELL AS WORDS, and never opacity on the glyphs — a dimmed
       number is still read as a number. The class goes on the GRID, matching
       the dialog's `.fc.is-stale .fc-panel`: one write instead of fourteen,
       and one selector for a future reader to find. */
    grid.classList.add("is-stale");
  }

  /* ---------- the request ------------------------------------------- */

  /* Uppercased BEFORE validating, exactly as the Worker does before testing
     its own ticker pattern. Routing ?t=nvda to "choose a name" would break
     every hand-typed URL and contradict the deep link the card dialog has
     shipped for months. */
  function readTicker() {
    try {
      const raw = new URL(location.href).searchParams.get("t");
      if (!raw) return null;
      const t = String(raw).trim().toUpperCase();
      return /^[A-Z][A-Z0-9.-]{0,9}$/.test(t) ? t : null;
    } catch { return null; }
  }

  function getJSON(url) {
    return fetch(url, {
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
    });
  }

  let painted = null;

  function fmtDate(iso) {
    if (!iso) return DASH;
    const d = new Date(String(iso).length <= 10 ? iso + "T00:00:00Z" : iso);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(iso);
  }

  /* =============================================================
     THE WORKSPACE — an index, an identity strip that stays, and a
     lead on WHAT CHANGED.

     THE PAGE WAS TWENTY-ONE PANELS IN A FLAT SCROLL. Measured at
     5,729px pinned and 7,185px gapless (the numbers are recorded in
     assets/css/flows.css beside the tier that produced them), so a
     reader hunting the gamma roll-off scanned five to seven screens
     of near-identical headings with no table of contents, no group
     boundaries and no way to send a colleague one of them —
     `location.hash` was read in no file in this product, so "look at
     panel 14" was a URL plus a sentence telling the reader to
     scroll. The identity block scrolled away after the first panel,
     taking the name, the score and the session date with it. And
     nothing anywhere on the page said what the number had DONE: the
     product is read as an early warning and it opened on a snapshot.

     FOUR THINGS ARE ADDED HERE AND NOT ONE OF THEM HIDES ANYTHING.
     No tabs, no accordion over the panels, no `grid-auto-flow:
     dense`: this page states find-in-page as a design value and the
     stylesheet refuses dense packing on purpose so DOM order stays
     tab order. An index that hid twenty panels to make one findable
     would trade a scroll for a search, and the scroll is the cheaper
     of the two.

       1. a sticky bar carrying the identity and the jump strip,
       2. group headings inside the grid, from the registry,
       3. chrome tiers, so a two-number panel and a fifty-row table
          stop wearing the same box,
       4. a change block above the fold, derived from the score
          overlay the card already carries.

     THE RULE THESE STYLES MAY NOT BREAK, stated here because the
     next person to widen one will read this before the stylesheet:
     nothing below changes a HORIZONTAL box metric of `.ft-panel` or
     of its drawing host. Every chart on this page sizes its viewBox
     from `host.clientWidth` and holds one viewBox unit to one CSS
     pixel, and the term line's j-th bar centre has to land on the
     surface's j-th column centre — which is an equality between two
     panels' host widths. A 2px left border on one tier and 1px on
     another would put a pixel between them and misalign a chart from
     a stylesheet. So the lead tier's rail is an INSET BOX-SHADOW,
     which paints and does not lay out.
     ============================================================= */

  /**
   * The registry's `group` and `tier`, keyed by panel key.
   *
   * A SECOND COPY, AND THE SAME KIND OF SECOND COPY AS `DRAW`. `shared/` is
   * in .assetsignore and is never served, so a browser file cannot import
   * shared/flows-panels.js; the emitter puts each `question` into an
   * attribute, but it cannot put a group heading into a panel — a heading is
   * a BOUNDARY BETWEEN sections and its map has no shape for one. So the
   * chrome table is projected here and pinned the way DRAW is pinned:
   * tests/flows-ticker-contract.mjs reads the registry, reads what this
   * controller wrote onto the mounted DOM, and asserts the two agree key for
   * key AND value for value, in both directions. A duplicate a test compares
   * is a projection; a duplicate a test cannot see is a drift.
   */
  const GROUPS = [
    { key: "signal", label: "Signal", hash: "ftg-signal",
      blurb: "The published score, what it is made of, and what it has done " +
        "since the last session that scored this name." },
    { key: "convexity", label: "Convexity", hash: "ftg-convexity",
      blurb: "The dealer book: where gamma sits along the strike ladder and " +
        "the term, and how it is moving." },
    { key: "volatility", label: "Volatility", hash: "ftg-volatility",
      blurb: "What the option chain charges — the smile, the term " +
        "structure, and the move those two imply." },
    { key: "tape", label: "Tape", hash: "ftg-tape",
      blurb: "What actually traded: the lifted strikes, the largest lines, " +
        "the session path and the off-exchange prints." },
    { key: "context", label: "Context", hash: "ftg-context",
      blurb: "Where this session sits in the name’s own year, who has " +
        "disclosed a trade in it, and whether it places against the rest " +
        "of the market." },
  ];

  const PANEL_CHROME = {
    __score: { group: "signal", tier: "lead" },
    scoreOverlay: { group: "signal", tier: "chart" },
    gamma: { group: "convexity", tier: "lead" },
    levels: { group: "convexity", tier: "reading" },
    surface: { group: "convexity", tier: "chart" },
    displacement: { group: "convexity", tier: "reading" },
    calendar: { group: "convexity", tier: "chart" },
    deltaExposure: { group: "convexity", tier: "chart" },
    charm: { group: "convexity", tier: "chart" },
    vanna: { group: "convexity", tier: "chart" },
    ivSurface: { group: "volatility", tier: "lead" },
    skewTerm: { group: "volatility", tier: "chart" },
    pricedMove: { group: "volatility", tier: "reading" },
    volContext: { group: "volatility", tier: "chart" },
    aggressor: { group: "tape", tier: "lead" },
    topContracts: { group: "tape", tier: "table" },
    path: { group: "tape", tier: "chart" },
    darkpool: { group: "tape", tier: "table" },
    oiDeltas: { group: "tape", tier: "table" },
    context: { group: "context", tier: "lead" },
    congress: { group: "context", tier: "table" },
    marketRank: { group: "context", tier: "reading" },
  };

  /* THE CHROME'S RULES ARE IN assets/css/flows.css, under "the workspace
     chrome" at the foot of the ticker section.

     They lived here until this commit, as a 236-line template literal injected
     into document.head on first paint, on the argument that a rule for an
     element only this file can construct belongs beside this file. What that
     argument cost: an injected sheet is never fetched, so no ?v= can reach it
     and a reader could hold this file's new markup against cached rules; no CSS
     suite could see it, the polarity-class check in tests/flows-sign.mjs
     included, because that suite reads flows.css; and it was JavaScript bytes
     on the route tests/flows-weight.mjs weighs, parsed before a panel drew.

     The dead-rule risk the old note named is covered by
     tests/flows-ticker-contract.mjs, which mounts this controller against both
     stylesheets and asserts the chrome it builds. */

  /* ---------- the sticky bar and the index -------------------------- */

  let barEl = null;
  let jumpEl = null;
  let changeEl = null;

  const countIn = (group) => {
    let n = 0;
    for (const k in PANEL_CHROME) if (PANEL_CHROME[k].group === group) n++;
    return n;
  };

  /**
   * Wrap the identity header and the jump strip into one sticky bar.
   *
   * THE HEADER IS MOVED, NOT REBUILT. `#ftHead` and every id inside it are
   * emitted by the page and written by paint(); re-creating them here would
   * be a second markup for the same block, which is the defect the panel
   * registry exists to prevent one level up. It is re-parented into the bar
   * so the two stick together — an identity that stays while its index
   * scrolls away is half a fix.
   */
  function buildBar() {
    if (!headEl || barEl) return;
    barEl = el("div", "ft-bar");
    barEl.hidden = true;
    headEl.parentNode.insertBefore(barEl, headEl);
    barEl.append(headEl);

    jumpEl = el("nav", "ft-jump");
    jumpEl.setAttribute("aria-label", "Jump to a group of panels");
    for (const g of GROUPS) {
      const a = el("a", "ft-jump-b");
      a.href = "#" + g.hash;
      a.append(document.createTextNode(g.label + " "));
      a.append(el("span", "ft-jump-n", String(countIn(g.key))));
      jumpEl.append(a);
    }
    barEl.append(jumpEl);

    /* THE FULL INDEX, one click away and still in the DOM.
       Five group anchors answer "where is the volatility section"; they do
       not answer "where is the gamma roll-off", which is the question that
       made a reader scan seven screens. Every panel is named here, under its
       group, and collapsed by default so the bar stays one row of chips
       tall. Nothing is hidden from find-in-page: a <details> keeps its
       contents in the document and browsers open it to reveal a match. */
    const all = el("details", "ft-all");
    all.append(el("summary", "ft-all-s",
      "All " + Object.keys(PANEL_CHROME).length + " panels"));
    const list = el("ul", "ft-all-l");
    for (const g of GROUPS) {
      list.append(el("li", "ft-all-g", g.label));
      for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
        const chrome = PANEL_CHROME[section.dataset.panel];
        if (!chrome || chrome.group !== g.key) continue;
        const li = el("li");
        const a = el("a");
        a.href = "#panel-" + section.dataset.panel;
        const title = section.querySelector(".ft-panel-t");
        a.textContent = title ? title.textContent : section.dataset.panel;
        li.append(a);
        list.append(li);
      }
    }
    all.append(list);
    barEl.append(all);

    changeEl = el("section", "ft-change");
    changeEl.id = "ftChange";
    changeEl.hidden = true;
    changeEl.setAttribute("aria-labelledby", "ftChangeH");
    barEl.parentNode.insertBefore(changeEl, barEl.nextSibling);
  }

  /**
   * Give every panel its anchor, its group and its tier, and open each group
   * with a heading inside the grid.
   *
   * A panel whose key is not in the chrome table keeps its anchor and is left
   * where it is rather than dropped: the registry test fails on it, and a
   * page that silently omitted it would make that test the only place a
   * reader could learn the panel existed.
   */
  function mountChrome() {
    let current = null;
    const missing = [];
    for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
      const key = section.dataset.panel;
      section.id = "panel-" + key;
      const chrome = PANEL_CHROME[key];
      const g = chrome ? GROUPS.find((x) => x.key === chrome.group) : null;
      if (!chrome || !g) { missing.push(key); continue; }
      section.dataset.group = chrome.group;
      section.dataset.tier = chrome.tier;
      if (chrome.group === current) continue;
      current = chrome.group;
      const h = el("h2", "ft-group");
      h.id = g.hash;
      h.tabIndex = -1;
      h.dataset.group = g.key;
      h.append(el("span", "ft-group-n", g.label));
      h.append(el("span", "ft-group-b", g.blurb));
      grid.insertBefore(h, section);
    }
    if (missing.length) {
      console.error("flows-ticker: no chrome entry for panel(s): " + missing.join(", "));
    }
  }

  /* The sticky bar's own height, written back so an anchor lands BELOW it
     rather than under it. Measured rather than assumed: the identity row
     wraps at three different widths and the strip scrolls rather than
     wrapping, so no constant is right at more than one viewport. */
  function syncBarHeight() {
    if (!barEl || barEl.hidden) return;
    const h = Math.round(barEl.getBoundingClientRect().height);
    if (h > 0) grid.style.setProperty("--ft-bar-h", h + "px");
  }

  /* ---------- deep links -------------------------------------------

     THERE WAS NO WAY TO SEND ANYONE A PANEL. Two anchor shapes now exist and
     both are plain fragment ids, so the browser does the scrolling:

       #ftg-<group>   a group heading
       #panel-<key>   one panel

     The controller's only job is to re-run the jump AFTER the card paints.
     The grid is `hidden` while the fetch is in flight, so the browser's own
     fragment scroll on load finds an element with no box and does nothing —
     which is why an incoming link used to land at the top of the page.

     OPENING THE ENLARGE DIALOG REFLECTS THE PANEL INTO THE HASH, and an
     incoming hash does NOT open a dialog. A reader who was sent a link wants
     the panel, at page width, in the context of the name; a modal they did
     not ask for over a page they have not seen is a different thing. The
     hash means the same panel either way, so the link says one thing. */
  function hashTarget() {
    let raw = "";
    try { raw = decodeURIComponent(String(location.hash || "").slice(1)); }
    catch { raw = String(location.hash || "").slice(1); }
    if (!raw) return null;
    /* getElementById, never querySelector('#' + raw): a hash is arbitrary
       reader-supplied text and a selector throws on anything that is not a
       valid identifier — which would take the whole paint down. */
    const direct = document.getElementById(raw);
    if (!direct || !grid.contains(direct)) return null;
    return direct.classList.contains("ft-panel")
      ? direct
      : (direct.closest(".ft-panel") || direct);
  }

  function honourHash() {
    const target = hashTarget();
    if (!target) return;
    syncBarHeight();
    target.scrollIntoView({ block: "start" });
    /* FOCUS FOLLOWS THE JUMP, or a keyboard reader lands visually on panel 14
       and carries on tabbing from panel 1. */
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    markCurrentGroup(target.dataset ? target.dataset.group : null);
  }

  function markCurrentGroup(group) {
    if (!jumpEl) return;
    const entry = GROUPS.find((g) => g.key === group);
    for (const a of jumpEl.querySelectorAll(".ft-jump-b")) {
      if (entry && a.getAttribute("href") === "#" + entry.hash) {
        a.setAttribute("aria-current", "true");
      } else {
        a.removeAttribute("aria-current");
      }
    }
  }

  /* WHICH GROUP THE READER IS IN, tracked by observation rather than by a
     scroll handler doing arithmetic on every frame. Without
     IntersectionObserver the strip simply never marks a current group, which
     costs a highlight and nothing else — the anchors still work. */
  function watchGroups() {
    if (typeof IntersectionObserver !== "function") return;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        seen.set(e.target, e.isIntersecting ? e.boundingClientRect.top : null);
      }
      let best = null, bestTop = Infinity;
      for (const [node, top] of seen) {
        if (top === null) continue;
        if (top < bestTop) { bestTop = top; best = node; }
      }
      if (best) markCurrentGroup(best.dataset.group);
    }, { rootMargin: "-25% 0px -60% 0px" });
    for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) io.observe(section);
  }

  /* history.replaceState rather than `location.hash = …`: assigning to the
     hash pushes a history entry AND scrolls, so closing the enlarge dialog
     would have jumped the page and left a trail of twenty back-button steps
     behind a reader who opened twenty panels. */
  function writeHash(value) {
    try {
      history.replaceState(null, "",
        location.pathname + location.search + (value ? "#" + value : ""));
    } catch { /* a browser that refuses is a browser without a deep link. */ }
  }

  /* ---------- the identity strip ------------------------------------ */

  /**
   * The price this whole card was measured against.
   *
   * THREE PANELS PUBLISH IT AND THE CARD'S TOP LEVEL DOES NOT. `levels`,
   * `pricedMove` and `gamma` each carry the spot the pipeline resolved from
   * the screener row, and each can be `unavailable` for its own reason — so
   * the strip reads them in order and stops at the first that answers, and
   * says which one it read. It does NOT fall back to the newest close on the
   * score overlay: that is a different measurement, a settled close rather
   * than the spot the levels were measured against, and quietly swapping one
   * for the other is how a header comes to disagree with the panel under it.
   */
  function spotOf(card) {
    for (const key of ["levels", "pricedMove", "gamma"]) {
      const panel = card.panels && card.panels[key];
      if (!panel || panel.status !== "ok") continue;
      const v = isNum(panel.spot);
      if (v !== null) return { v, from: key };
    }
    return null;
  }

  /** A header chip. `empty` tags WHY it is blank; a bare em dash is not a fact. */
  function idChip(id, label, value, opts) {
    const o = opts || {};
    const node = $(id) || el("span", "fc-meta ft-id");
    node.id = id;
    node.className = "fc-meta ft-id" + (o.cls ? " " + o.cls : "");
    node.replaceChildren();
    if (label) node.append(document.createTextNode(label + " "));
    node.append(el("b", null, value));
    if (o.empty) node.setAttribute("data-empty", o.empty);
    else node.removeAttribute("data-empty");
    if (o.title) node.title = o.title;
    else node.removeAttribute("title");
    return node;
  }

  /**
   * Name, price, side, score — and rank when the page can honestly state it.
   *
   * RANK IS NOT ON THIS PAYLOAD. It is published per side on the board
   * (`rows[].r`); the card carries no copy of it, and this page fetches no
   * board on load — deliberately, because two requests on every ticker view
   * would be paid by every reader to serve the few who switch names. So the
   * rank chip appears only once a board has actually been read (the name
   * switcher reads both), and until then it is ABSENT rather than an em dash:
   * a dash in a rank slot reads as "unranked", which is a claim about the
   * name rather than about the payload.
   */
  function paintIdentity(card, chg) {
    if (!headEl) return;
    const score = isNum(card.score);
    const spot = spotOf(card);
    const ctx = card.panels && card.panels.context;
    const chgPct = ctx && ctx.status === "ok" ? isNum(ctx.changePct) : null;

    const price = idChip("ftPrice", "", spot === null ? DASH : "$" + spot.v.toFixed(2), {
      empty: spot === null ? "unavailable" : null,
      title: spot === null
        ? "No panel on this card published a spot price: levels, priced move and gamma " +
          "are all unavailable for this name today."
        : "Spot as the " + spot.from + " panel resolved it, for the session of " +
          fmtDate(card.sessionDate) + ".",
    });
    const day = idChip("ftChgPct", "", chgPct === null ? DASH : P.pct1(chgPct), {
      cls: P.polarity(chgPct),
      empty: chgPct === null ? "unavailable" : null,
      title: chgPct === null
        ? "The price context panel published no session change for this name, so the " +
          "day's move is not stated rather than stated as flat."
        : "Change against the previous close, from the price context panel.",
    });

    /* THE SIDE, STATED AGAINST THE PUBLISHED DEAD BAND rather than against
       zero. A score of +1 with a band of ±1 is not a bullish name; it is a
       name the board declined to rank, and calling it bullish in the header
       is exactly the confident reading this product exists to refuse. */
    const band = chg && chg.status === "ok" ? chg.band : null;
    let sideText, sideCls, sideEmpty = null, sideTitle;
    if (score === null) {
      sideText = DASH;
      sideCls = "is-null";
      sideEmpty = "unavailable";
      sideTitle = "This card carries no score, so it has no side.";
    } else if (band === null) {
      sideText = score < 0 ? "bearish" : score > 0 ? "bullish" : "neutral";
      sideCls = P.polarity(score);
      sideTitle = "No dead band was published on this card, so the side is stated " +
        "against zero rather than against the board's own membership rule.";
    } else if (Math.abs(score) <= band) {
      sideText = "inside the dead band";
      sideCls = "is-flat";
      sideTitle = "Within ±" + band + POINTS(band) + " of zero, which is the band " +
        "the board declines to rank inside.";
    } else {
      sideText = score < 0 ? "bearish" : score > 0 ? "bullish" : "neutral";
      sideCls = P.polarity(score);
      sideTitle = "Outside the published dead band of ±" + band + POINTS(band) + ".";
    }
    const side = idChip("ftSide", "", sideText,
      { cls: sideCls, empty: sideEmpty, title: sideTitle });

    /* THE MOVE RIDES IN THE HEADER, because it is the reading this page is
       opened for and it must not scroll away with the block below. The gap
       travels with it: a delta printed without its gap is the defect this
       whole layer replaced. */
    let d1Node = null;
    if (chg && chg.status === "ok" && chg.d1) {
      /* THE UNIT IS IN THE CHIP, NOT ONLY IN ITS TOOLTIP. This read
         "+7 / 1 session" beside a chip carrying "$184.20" and one carrying
         "+1.4%", and the only place that said what the 7 was in was a `title`
         no touch reader and no keyboard reader ever opens. The count of
         sessions was already spelled out; the score points now are too.

         AND THE GAP AGREES WITH ITSELF. The tooltip said "1 sessions back"
         because the plural was hardcoded there while the chip beside it used
         the ternary — the same seam POINTS exists to close on the other
         number. Both now go through SESSIONS. */
      d1Node = idChip("ftD1", "", P.signed(chg.d1.v, (a) => String(a)) + POINTS(chg.d1.v) +
        " over " + SESSIONS(chg.d1.gap), {
        cls: P.polarity(chg.d1.v),
        title: "Score points against the " + chg.d1.from + " session, the previous one " +
          "that scored this name, " + SESSIONS(chg.d1.gap) + " back in this card's " +
          "window. Full working in the change block below.",
      });
    } else if ($("ftD1")) {
      $("ftD1").remove();
    }

    /* INSERTED AFTER THE SCORE, NOT AT THE END OF THE HEADER. The emitted
       markup runs name, score, conviction, regime, dates, switch — so
       appending would have put the price, the day's move and the overnight
       delta AFTER three pieces of metadata, and on a phone that is three
       wrapped lines below the reading. Name, score, price, side, move first;
       conviction, regime and the two dates after them. */
    const anchor = $("ftConv") || $("ftSwitch");
    for (const node of [price, day, side, d1Node]) {
      if (!node) continue;
      if (anchor) headEl.insertBefore(node, anchor);
      else headEl.append(node);
    }
    paintRank();
  }

  /** Fill the rank chip once a board has been read. Before that, nothing. */
  function paintRank() {
    if (!headEl || !painted || !switchRows || !switchRows.length) return;
    const me = switchRows.find((r) => r.t === painted.ticker);
    if (!me || isNum(me.r) === null || isNum(me.of) === null) return;
    /* THE POPULATION IS THE SIDE'S OWN ROW COUNT, off the board payload. It
       used to be a count of the rows this page had KEPT, which is a different
       set from the one `r` is a rank inside — and once the carded filter
       actually filtered, a name ranked 30 on a 44-row side would have been
       published as "30 of 23". */
    const chip = idChip("ftRank", "rank", me.r + " of " + me.of, {
      title: "Rank on today's " + (me.side === "short" ? "short" : "long") + " board, read " +
        "from the board payload the name switcher fetched. It is not published on this card.",
    });
    const anchor = $("ftConv") || $("ftSwitch");
    if (anchor) headEl.insertBefore(chip, anchor);
    else headEl.append(chip);
  }

  /* ---------- what changed ------------------------------------------ */

  const SESSIONS = (n) => n + (n === 1 ? " session" : " sessions");
  /* THE UNIT TRAVELS WITH THE NUMBER, and it agrees with it. The score is a
     bounded index — 100·tanh of a composite — so its differences are score
     POINTS and never percent, and "1 score points" is the kind of seam that
     makes a reader wonder who wrote the sentence. */
  const POINTS = (n) => (Math.abs(n) === 1 ? " score point" : " score points");
  /* A POPULATION, WITH ITS NOUN. Used by the picker's notes, where every count
     is a count of board rows and a bare integer in a sentence about names is
     the same defect one screen up. */
  const NAMES = (n) => n + (n === 1 ? " name" : " names");

  const CROSSING = {
    cleared: "Cleared the dead band — this name became actionable this session.",
    faded: "Faded into the dead band — the exit signal.",
    flipped: "Flipped sign — outside the band at both ends, on opposite sides.",
  };

  /**
   * The block this page now opens with.
   *
   * IT IS A READING, SO IT CARRIES THE SAME THREE SILENCES AS A PANEL. "this
   * card predates the overlay", "the pipeline published no track for this
   * name" and "the two windows share no session" are three different facts
   * about three different failures; each gets its own sentence and its own
   * data-empty. One "no change data" would make them one.
   *
   * @returns the derivation, so the identity strip above can state the same
   *   numbers without computing them a second time.
   */
  function paintChange(card) {
    const chg = P.changeFrom(card.panels && card.panels.scoreOverlay);
    if (!changeEl) return chg;
    changeEl.replaceChildren();
    changeEl.hidden = false;
    const h = el("h2", null, "What changed");
    h.id = "ftChangeH";
    changeEl.append(h);

    if (chg.status !== "ok") {
      /* THE SAME TWO HEADINGS THE PANELS USE, and the reason VERBATIM under
         them. deadPanel and quietPanel already teach this page's reader that
         "Unavailable." is a failure and "Nothing to report." is a
         measurement; a third vocabulary for the same distinction on the block
         above them would be a third thing to learn. Capitalising the
         publisher's sentence would also stop it being verbatim, which is the
         property the suites check. */
      const quiet = chg.status === "quiet";
      const p = el("p", quiet ? "fc-quiet" : "fc-dead");
      p.setAttribute("data-empty", quiet ? "quiet" : "unavailable");
      p.append(el("strong", null, quiet ? "Nothing to report. " : "Unavailable. "));
      p.append(document.createTextNode(chg.reason + "."));
      changeEl.append(p);
      return chg;
    }

    /* THE STALENESS LINE COMES FIRST AND NOTHING IS SAID BEFORE IT. A page
       leading on change must not print a move as though it were this
       morning's when the newest session in the window carries no score for
       this name. */
    if (chg.stale > 0) {
      changeEl.append(el("p", "ft-chg-stale",
        "This reading is " + SESSIONS(chg.stale) + " old: the newest session in the joined " +
        "window is " + chg.window.to + " and it carries no score for this name. The newest " +
        "score below is " + chg.at.d + "."));
    }

    /* THE EVENT, IF THERE WAS ONE. Everything else in this block is drift; a
       dead-band crossing is the thing worth being told about, because the
       band is the board's own membership rule. */
    if (chg.cross) {
      changeEl.append(el("p", "ft-chg-e", CROSSING[chg.cross]));
    } else if (chg.crossKnown) {
      const tag = el("p", "ft-chg-e is-quiet", chg.inside
        ? "No crossing — inside the dead band at both ends."
        : "No crossing — outside the dead band at both ends, on the same side.");
      tag.setAttribute("data-empty", "quiet");
      changeEl.append(tag);
    } else {
      const tag = el("p", "ft-chg-e is-quiet", chg.band === null
        ? "No dead band was published on this card, so whether this move crossed one " +
          "cannot be stated — it is unknown, not absent."
        : "Only one session in this window carries a score for this name, so there is no " +
          "crossing to state.");
      tag.setAttribute("data-empty", chg.band === null ? "unavailable" : "quiet");
      changeEl.append(tag);
    }

    /* THE HEADLINE. The sign is in the glyph before it is in the hue, and the
       gap is in the same sentence as the delta. */
    const lead = el("p", "ft-chg-lead");
    if (chg.d1) {
      lead.append(el("span", "ft-chg-v " + P.polarity(chg.d1.v),
        P.signed(chg.d1.v, (a) => String(a))));
      lead.append(document.createTextNode(
        (chg.d1.v === 0
          ? POINTS(chg.d1.v).trim() + " — unchanged since "
          : POINTS(chg.d1.v).trim() + " since ") +
        chg.d1.from + ", " + SESSIONS(chg.d1.gap) + " earlier" +
        (chg.d1.gap === 1
          ? ". "
          : " — this name carries no score for the " + SESSIONS(chg.d1.gap - 1) +
            " in between, so the move is not an overnight one. ") +
        "It stands at " + P.signed(chg.at.score, (a) => String(a)) + " on " + chg.at.d + "."));
    } else {
      lead.append(el("span", "ft-chg-v " + P.polarity(chg.at.score),
        P.signed(chg.at.score, (a) => String(a))));
      lead.append(document.createTextNode(
        POINTS(chg.at.score).trim() + " on " + chg.at.d +
        ". No earlier session in this window carries a score " +
        "for this name, so there is no move to state — which is not a move of zero."));
    }
    changeEl.append(lead);

    changeEl.append(P.statList([
      ["Move", chg.d1 === null ? DASH
        : P.signed(chg.d1.v, (a) => String(a)) + POINTS(chg.d1.v),
      chg.d1 === null ? "is-null" : P.polarity(chg.d1.v)],
      ["Sessions apart", chg.d1 === null ? DASH : String(chg.d1.gap)],
      ["Now", P.signed(chg.at.score, (a) => String(a)) + POINTS(chg.at.score),
        P.polarity(chg.at.score)],
      ["Run", chg.run === 0 ? "0 — at neutral"
        : (chg.runCapped ? "≥ " : "") + SESSIONS(chg.run)],
      /* THE UNIT TRAVELS WITH THESE TWO AS WELL, and it did not. Every other
         row of this list carried "score points" and these two printed a bare
         "+42 on 2026-08-20" — in a block whose neighbouring chips are a dollar
         price and a percentage day move, which is precisely the reading a
         unitless number invites. */
      ["Window high", P.signed(chg.ext.hi, (a) => String(a)) + POINTS(chg.ext.hi) +
        " on " + chg.ext.hiAt, P.polarity(chg.ext.hi)],
      ["Window low", P.signed(chg.ext.lo, (a) => String(a)) + POINTS(chg.ext.lo) +
        " on " + chg.ext.loAt, P.polarity(chg.ext.lo)],
      ["Dead band", chg.band === null ? DASH : "±" + chg.band + POINTS(chg.band)],
    ]));

    /* THE RUN, and the two ways it can be shorter than the truth. */
    let runText;
    if (chg.run === 0) {
      runText = "The newest score is exactly zero — the centre of the dead band, which " +
        "is a reading this pipeline assigns and not an absence.";
    } else {
      const runSide = chg.at.score < 0 ? "bearish" : chg.at.score > 0 ? "bullish" : "neutral";
      runText = (chg.runCapped ? "At least " : "") + chg.run +
        (chg.run === 1 ? " scored session" : " consecutive scored sessions") +
        " on the " + runSide + " side" +
        (chg.runCapped
          ? ", which is as far back as this card's own window reaches — the run may be older."
          : chg.runBroken
            ? ", counted back to a session this name carries no score for. The run is not " +
              "stepped over that gap: continuity nobody measured is not continuity."
            : ".");
    }
    changeEl.append(el("p", "fc-note", runText));

    /* THE WINDOW EVERYTHING ABOVE IS MEASURED IN, named once and in its own
       unit. `gap` counts sessions of the JOINED window — the sessions this
       card's price history and the score archive have in common — not
       sessions of the score track's own calendar. Where the price window is
       the shorter of the two the counts differ, and a reader told "4
       sessions" without being told which calendar has been given a number
       with no unit. */
    changeEl.append(el("p", "fc-note",
      "Derived from the " + SESSIONS(chg.window.sessions) + " between " + chg.window.from +
      " and " + chg.window.to + " that this card's price window shares with the score " +
      "archive, " + chg.window.scored + " of which carry a score for this name. Every " +
      "session count above counts THOSE sessions. The series itself is in the " +
      "score-over-price panel below."));

    return chg;
  }

  /** Build the chrome once, before the first paint. */
  function installWorkspace() {
    buildBar();
    mountChrome();
    watchGroups();
    window.addEventListener("hashchange", honourHash);
  }

  function paint(card) {
    painted = card;
    if (headEl) headEl.hidden = false;
    if (barEl) barEl.hidden = false;
    grid.hidden = false;
    if (picker) picker.hidden = true;

    $("ftTicker").textContent = card.ticker || DASH;
    const score = isNum(card.score);
    const badge = $("ftScore");
    badge.textContent = score === null ? DASH
      : (score > 0 ? "+" : score < 0 ? MINUS : "") + Math.abs(score);
    badge.className = "fc-score " +
      (score === null ? "" : score < 0 ? "is-neg" : score > 0 ? "is-pos" : "is-flat");
    const conv = isNum(card.conviction);
    $("ftConv").textContent = conv === null ? DASH : conv + " conviction";
    const regime = card.regime && card.regime.label;
    $("ftRegime").textContent =
      regime === "short" ? "short \u0393" : regime === "long" ? "long \u0393" : DASH;
    $("ftDates").textContent =
      "session " + fmtDate(card.sessionDate) + " \u00b7 built " + fmtDate(card.generatedAt);

    /* CHANGE BEFORE DETAIL. paintChange returns its own derivation so the
       identity strip states the same numbers rather than deriving them a
       second time — two derivations of one move is two chances for the
       header and the block under it to disagree about the same name. */
    const chg = paintChange(card);
    paintIdentity(card, chg);

    drawAll(card, "grid");
    setStale(assessAge(card));

    /* AFTER THE PANELS EXIST, NOT BEFORE. The grid is `hidden` while the card
       is in flight, so the browser's own fragment scroll on load lands on an
       element with no box and does nothing at all — which is why a deep link
       used to drop the reader at the top of the page. */
    syncBarHeight();
    honourHash();

    statusEl.textContent = (card.ticker || "This name") +
      " \u00b7 every panel the card carries, drawn at page width.";
    if (footEl) {
      footEl.textContent =
        "Every number here is read off the card payload the pipeline published " +
        "for " + fmtDate(card.sessionDate) + ". No vendor call is made by this page.";
    }
  }

  /* ---------- the picker, which is the index and not an error -------- */

  /* ---------- switching names without leaving the section ----------

     THE PAGE WAS A DEAD END. The index below renders only when `?t=` is
     absent, so a reader who had arrived on a name could not reach another one
     without editing the URL — on a section whose whole purpose is comparing
     names against each other.

     THE BOARDS ARE FETCHED ONLY IF THE CONTROL IS USED. Two requests on every
     ticker page view would be paid by every reader to serve the few who
     switch, and the card is what this page is. Fetched once and kept, because
     opening the switcher twice is not two different questions. */
  let switchRows = null;

  function wireSwitch(card) {
    const btn = document.getElementById("ftSwitch");
    if (!btn) return;
    btn.hidden = false;
    btn.onclick = async () => {
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "Loading names…";
      try {
        if (!switchRows) {
          const [long, short] = await Promise.all([
            getJSON("/api/flows/board?side=long").catch(() => null),
            getJSON("/api/flows/board?side=short").catch(() => null),
          ]);
          switchRows = boardRows(long, short);
          /* THE ONLY MOMENT THIS PAGE CAN HONESTLY STATE A RANK. It is a
             board field and the card carries no copy of it; now that a board
             has actually been read, the chip can be filled. */
          paintRank();
        }
        const shown = carded(switchRows);
        if (!shown.length) {
          /* NOT AN ERROR AND NOT A BLANK LIST, and now three reasons rather
             than two: the boards failed, they are not published yet, or every
             row on them is a name this run did not build a card for. The
             button says which rather than opening an empty table the reader
             has to interpret. */
          btn.textContent = switchRows.length
            ? "No other name has a card today"
            : "No board to switch to";
          return;
        }
        showPicker(shown,
          pickerNote(switchRows, shown,
            "You are on " + ((card && card.ticker) || "a name") + "."),
          (card && card.ticker) || null);
      } finally {
        btn.disabled = false;
        if (btn.textContent === "Loading names…") btn.textContent = prev;
      }
    };
  }

  function showPicker(rows, note, backTo) {
    if (!picker) return;
    grid.hidden = true;
    if (headEl) headEl.hidden = true;
    /* THE INDEX GOES WITH THE PANELS IT INDEXES. Leaving the jump strip stuck
       to the top of a picker would offer five anchors to a grid that is
       `hidden` — every one of them a link to nothing. */
    if (barEl) barEl.hidden = true;
    if (changeEl) changeEl.hidden = true;
    picker.hidden = false;

    /* THE WAY BACK, and only when there is one. Opened from a name, the
       picker has somewhere to return to and hiding the grid is reversible;
       reached with no `?t=` at all it is the page itself and a "back" control
       would lead nowhere. */
    const back = document.getElementById("ftBackTo");
    if (back) {
      if (backTo) {
        back.hidden = false;
        back.textContent = "\u2190 Back to " + backTo;
        back.onclick = () => {
          picker.hidden = true;
          grid.hidden = false;
          if (headEl) headEl.hidden = false;
          if (barEl) barEl.hidden = false;
          if (changeEl && painted) changeEl.hidden = false;
          syncBarHeight();
          const h = document.getElementById("ftTicker");
          if (h) h.focus();
        };
      } else {
        back.hidden = true;
        back.onclick = null;
      }
    }
    const body = $("ftPickerBody");
    body.replaceChildren();
    for (const row of rows) {
      const tr = el("tr");
      const tk = el("td");
      const a = el("a", "ft-link");
      a.href = "/flows/ticker/?t=" + encodeURIComponent(String(row.t || ""));
      a.textContent = String(row.t || DASH);
      tk.append(a);
      tr.append(tk);
      tr.append(el("td", null, row.side === "short" ? "Bearish" : "Bullish"));
      const rank = el("td", "c-num");
      rank.textContent = isNum(row.r) === null ? DASH : String(row.r);
      tr.append(rank);
      const sc = el("td", "c-num");
      const s = isNum(row.s);
      sc.textContent = s === null ? DASH : (s > 0 ? "+" : s < 0 ? MINUS : "") + Math.abs(s);
      tr.append(sc);
      body.append(tr);
    }
    const noteEl = $("ftPickerNote");
    if (noteEl) noteEl.textContent = note;
  }

  /**
   * Every row of both boards, each carrying whether the run built a CARD for
   * it and how many names its own side holds.
   *
   * `row.dp === 0` WAS A TEST AGAINST A VALUE THIS PAYLOAD HAS NEVER CARRIED.
   * The pipeline stamps `row.dp = 1` on the names it went deep on and writes
   * nothing at all on the rest, so `if (row.dp === 0) continue` skipped
   * exactly zero rows — while the three notes printed above the three lists
   * built from it each claimed the opposite ("Every name today's board built a
   * card for"). On the run this was found on, 21 of 44 long rows and 23 of 50
   * short ones had no card: nearly half of the index, of the name switcher and
   * of the list handed to a reader who had just been told their name has no
   * card were links to a page that says there is nothing to draw. The note was
   * a claim about the list beneath it, and it was false.
   *
   * ABSENT ON EVERY ROW IS NOT FALSE ON EVERY ROW, which is why the test is on
   * the PAYLOAD and not on the row. This is the rule flows-board.js:498
   * already states and the reason is unchanged: assets deploy the moment main
   * moves and the pipeline runs the next morning, so there is always a day
   * when new JavaScript reads an old board — and an old board carries `dp`
   * nowhere. `deep` is the count the board publishes beside `deepRule`; its
   * absence means the board predates the distinction and every row on it does
   * have a card, so `card` is null (unknown) rather than false.
   *
   * `of` IS THE SIDE'S OWN POPULATION, taken off the payload, because `r` is a
   * rank within the WHOLE side. Counting the filtered list instead would have
   * printed "rank 30 of 23" the first time a name outside the deep set was
   * ranked — a rank and a population that do not belong to each other.
   */
  function boardRows(long, short) {
    const out = [];
    for (const [payload, side] of [[long, "long"], [short, "short"]]) {
      const rows = ((payload && payload.rows) || []).filter((r) => r && r.t);
      const knowsDeep = isNum(payload && payload.deep) !== null;
      for (const row of rows) {
        out.push({
          t: row.t, r: row.r, s: row.s, side,
          card: knowsDeep ? row.dp === 1 : null,
          of: rows.length,
        });
      }
    }
    return out;
  }

  /** The rows a link can honestly be drawn for: carded, or a board too old to say. */
  const carded = (rows) => rows.filter((r) => r.card !== false);

  /**
   * The sentence above the picker, TRUE of the list beneath it.
   *
   * THREE STATES AND THEY ARE NOT ONE CLAIM: the board said which of its rows
   * carry a card and some were dropped; it said and none were; or it does not
   * say at all, and then the list is every row and the note must not promise a
   * card it has not checked. The count is never printed without the population
   * it was taken out of.
   */
  function pickerNote(all, shown, tail) {
    const unknown = all.some((r) => r.card === null);
    if (unknown) {
      return "All " + NAMES(all.length) + " on today’s board. This board does not " +
        "publish which of its rows the run went deep enough on to build a card for, so a " +
        "name here may still open a page with no card. " + tail;
    }
    if (all.length > shown.length) {
      /* THE COUNT AND ITS POPULATION IN THE SAME CLAUSE, and no number left
         holding a verb: "the other 1 are ranked" is the same tell as "1 score
         points", which is why the counts sit where nothing has to agree with
         them. */
      return "Today’s board ranks " + NAMES(all.length) + " and this run built a card " +
        "for " + shown.length + " of them, which are the rows below. A card costs vendor " +
        "calls the run cannot spend on every name, so the rest are ranked without one and " +
        "are not listed: such a page would have nothing on it. " + tail;
    }
    return "All " + NAMES(all.length) + " on today’s board, every one of which " +
      "carries a card. " + tail;
  }

  /**
   * Why this name has no card, IN THE FUNNEL PAYLOAD'S OWN TERMS.
   *
   * `st` is the stage the pipeline stopped this name at, and the two that
   * matter here read completely differently to a reader: "gated" is a rule
   * that fired before any number existed, and every other stage means the
   * name was allowed through and did not get far enough. Collapsing them into
   * one apologetic sentence is what the old copy did.
   *
   * NOTHING IS INFERRED FROM AN ABSENCE, and the reason given for the absence
   * is the one the payload says operated. The calendar holds only names
   * reporting inside its published window and is capped on top of that, so a
   * name with no row in it may be reporting far out, or may have been shed —
   * this states the window always and the cap only when `capBound` says it
   * bound, rather than concluding the name was never gated (the reassuring
   * guess) or blaming a cap that did not bind (a confident wrong cause, which
   * is what this used to do on every run).
   */
  function sayWhyAbsent(ticker, events, boardsRead) {
    /* THE LEAD IS ONLY EARNED IF A BOARD WAS ACTUALLY READ. Both board
       requests are wrapped in `.catch(() => null)`, so two failed reads used
       to arrive here indistinguishable from two successful ones that did not
       carry this name — and the page then stated "is not on today's board" on
       the strength of a fetch that never came back. */
    const lead = boardsRead === false
      ? "Neither board could be read just now, so this page cannot say whether " + ticker +
        " is on today's board. What follows is the funnel's own account of it. "
      : ticker + " is not on today's board, so no card was built for it. ";
    const rows = events && Array.isArray(events.rows) ? events.rows : null;
    const row = rows ? rows.find((r) => r && String(r.t).toUpperCase() === ticker) : null;

    const parts = [lead];
    if (row && String(row.st || "").startsWith("board:")) {
      /* THE TWO PAYLOADS DISAGREE, AND THAT IS THE READING. The funnel says
         this name reached the board and the board this page just read does not
         carry it. Printing "it cleared the gate and did not reach the board"
         here would resolve a contradiction in favour of the half that happens
         to be in this branch. */
      parts.push(
        "The funnel places it on today\u2019s " +
        (row.st === "board:short" ? "bearish" : "bullish") + " board, which the board " +
        "payload this page just read does not agree with \u2014 either that read failed " +
        "or the two payloads are from different runs. Reload before concluding anything " +
        "about this name.");
    } else if (!rows) {
      parts.push(
        "The earnings calendar could not be read just now, so this page cannot say which " +
        "stage of the funnel it stopped at. It is not on the watch list either: that list " +
        "holds only names that were scored and landed inside the dead band.");
    } else if (row && row.st === "gated") {
      const dte = isNum(row.dte);
      parts.push(
        "It reports on " + (row.d ? String(row.d) : "a date the calendar did not publish") +
        (dte === null
          ? ", with no calendar-day count published beside it, "
          : ", " + dte + " calendar " + (dte === 1 ? "day" : "days") + " from " +
            (events.gateOrigin || "the run's own Eastern date") + ", ") +
        "and the earnings gate removed it BEFORE the composite ran" +
        (isNum(events.gateDays) === null
          ? ". " : " \u2014 the gate covers day 0 to day " + events.gateDays + ". ") +
        "So there is no score under this name at all today, not a low one. It is not on " +
        "the watch list either: that list holds only names that were scored and landed " +
        "inside the dead band.");
    } else if (row) {
      parts.push(
        "The funnel stopped it at \u201c" + String(row.st || "an unclassified stage") +
        "\u201d: it cleared the earnings gate and did not reach the board. Cards are built " +
        "only for board names, so there is nothing to draw for it today.");
    } else {
      /* THE CALENDAR'S SILENCE HAS TWO CAUSES AND THE OLD SENTENCE NAMED THE
         RARER ONE AS THOUGH IT ALWAYS APPLIED. It said "that calendar is
         capped" unconditionally; on the run this was checked against, the cap
         did not bind at all (`capBound: false`), and the reason a name is
         missing is simply that the calendar only holds names reporting inside
         its window. Both are on the payload, so both are stated — and the
         cap only when it actually bound. */
      const win = isNum(events.windowDays);
      parts.push(
        "The earnings calendar carries no row for this name, so this page cannot say " +
        "which stage of the funnel it stopped at. That calendar holds only names " +
        "reporting within " +
        (win === null ? "its own window" : win + " calendar " + (win === 1 ? "day" : "days")) +
        " of " + (events.gateOrigin || "the run\u2019s own Eastern date") +
        (events.capBound === true
          ? ", and it was capped before it ran out of window, so it does not reach every " +
            "name even inside it"
          : "") +
        " \u2014 so its silence here is a missing row, not evidence about this name.");
    }

    statusEl.replaceChildren(document.createTextNode(parts.join("")));
    /* THE WAY ON, because the page a reader wants next is the funnel itself
       and the old copy sent them nowhere. */
    const link = el("a", "ft-link");
    link.href = "/flows/events/";
    link.textContent = " The earnings calendar and the whole funnel.";
    statusEl.append(link);
  }

  function start() {
    const ticker = readTicker();

    if (!ticker) {
      /* NO NAME IS NOT AN ERROR — it is the index, and the section has never
         had one. Both boards are fetched here and only here. */
      statusEl.textContent = "Choose a name.";
      Promise.all([
        getJSON("/api/flows/board?side=long").catch(() => null),
        getJSON("/api/flows/board?side=short").catch(() => null),
      ]).then(([long, short]) => {
        const all = boardRows(long, short);
        const rows = carded(all);
        if (!rows.length) {
          /* TWO REASONS FOR AN EMPTY INDEX, AND THEY ARE NOT THE SAME FACT.
             No board at all is a publishing state; a board whose every row is
             a name this run did not build a card for is a budget state, and
             telling a reader "no board has been published" while one is
             published and ranked would be a wrong answer about the product's
             central artifact. */
          statusEl.textContent = all.length
            ? "Today’s board ranks " + NAMES(all.length) + ", and this run built a " +
              "card for none of them, so there is nothing to open here. The board itself " +
              "is published."
            : "No board has been published yet, so there is no name to choose.";
          return;
        }
        showPicker(rows, pickerNote(all, rows,
          "Each one opens its own workspace of panels."));
      });
      return;
    }

    getJSON("/api/flows/card?t=" + encodeURIComponent(ticker)).then((card) => {
      if (!card) return;
      if (card.status === "pending" || !card.panels) {
        /* THREE DIFFERENT FACTS THAT LOOK IDENTICAL FROM HERE, and the two
           boards plus the funnel are fetched ONLY to tell them apart. "The
           card has not landed" is a race that resolves itself in a minute;
           "not on the board" is a permanent property of this name today; and
           "the earnings gate removed it before the composite ran" is a THIRD
           thing, which is the common case rather than the rare one — 57 of
           the 60 rows on a typical funnel payload are gated.

           THE SENTENCE THIS REPLACES WAS WRONG IN BOTH HALVES for exactly
           those 57 names. It said cards are built only for the names the
           board publishes "so there is nothing to show for this name today —
           it may be on the watch list". A gated name is absent because the
           board was FORBIDDEN to score it, not because it scored poorly; and
           it cannot be on the watch list, which by construction holds only
           names that WERE scored and landed inside the dead band. Every
           ticker on /flows/events/ links here, so that sentence was the
           landing page for most of the funnel.

           THE FUNNEL PAYLOAD IS SAME-ORIGIN, ALREADY BUILT AND ALREADY
           CACHED — no vendor call, and the cost is paid only on the path
           where the page has nothing else to say. */
        return Promise.all([
          getJSON("/api/flows/board?side=long").catch(() => null),
          getJSON("/api/flows/board?side=short").catch(() => null),
          getJSON("/api/flows/events").catch(() => null),
        ]).then(([long, short, events]) => {
          /* THE MEMBERSHIP TEST READS THE WHOLE BOARD, NOT THE CARDED HALF.
             A name the board ranked but built no card for IS on the board, and
             answering "not on today's board" for it would be the same class of
             wrong sentence this branch was rewritten to remove. */
          const all = boardRows(long, short);
          const rows = carded(all);
          const me = all.find((r) => r.t === ticker);
          if (me && me.card === false) {
            /* A FOURTH FACT, and it used to be told as the first one. This
               name is ranked and published; the run simply did not spend the
               two vendor calls a card costs on it, because it spends them on
               the names furthest from neutral. "Its card has not landed yet"
               invited a reload that will never produce one. */
            statusEl.textContent =
              "The board ranks " + ticker + " " +
              (isNum(me.r) === null || isNum(me.of) === null
                ? "on its " + (me.side === "short" ? "bearish" : "bullish") + " side"
                : me.r + " of " + me.of + " on the " +
                  (me.side === "short" ? "bearish" : "bullish") + " side") +
              ", and this run built no card for it. A card costs vendor calls the run " +
              "spends only on the names furthest from neutral, so most of the board is " +
              "scored and ranked without one. This is not a lag, and reloading will not " +
              "produce a card.";
          } else if (me) {
            statusEl.textContent =
              "The board published " + ticker + " but its card has not landed yet. " +
              "Cards are published after the boards, so one can briefly lag its row.";
            return;
          } else {
            sayWhyAbsent(ticker, events, long !== null || short !== null);
          }
          if (rows.length) {
            showPicker(rows, pickerNote(all, rows,
              "These are the ones you can open today."));
          }
        });
      }
      paint(card);
      wireSwitch(card);
      return null;
    }).catch(() => {
      statusEl.textContent = "This page could not be loaded. Reload to try again.";
      /* NEVER LEFT ON "Loading…". Every panel says what happened, because a
         permanent spinner is the one state a reader cannot act on. */
      grid.hidden = false;
      for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
        const host = section.querySelector("div");
        if (host) {
          deadPanel(host, section.dataset.question || "",
            "this page could not be loaded. Reload to try again.");
        }
      }
    });
  }

  installWorkspace();
  start();
})();
