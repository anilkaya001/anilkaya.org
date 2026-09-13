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

   AND PANEL_CHROME NO LONGER WRITES ANYTHING: the worker emits
   data-group and data-tier, so a stale entry is now reported rather
   than shipped as the layout, which is what it was while it wrote.

   THE PAGE OPENS ON WHAT CHANGED. It used to open on twenty-one
   panels of one session with no index, no group boundaries, no way
   to link a colleague to a panel, an identity block that scrolled
   away, and nothing anywhere saying what the score had DONE. See
   THE WORKSPACE, below.

   THE TEN SHIPPED RENDERERS ARE NOT COPIED HERE. They are
   window.FlowsPanels, extracted from assets/js/flows-card.js so the
   card dialog and this page would draw the SAME code. The dialog is
   retired and this page is the only caller — the extraction paying
   off twice: a modal holding its own copy of these charts could not
   have been deleted without rewriting them.
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
    /* The fold and the lead, read from the module rather than restated here —
       see the removal note below the width policy. */
    appendMethod, leadReading,
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

  /* THE FOLD AND THE LEAD MOVED TO assets/js/flows-panels.js.

     A survey of the fourteen Flows renderers counted 101,768 characters of
     prose in 1,736 strings, 42,151 of them on this route, and one ratio named
     the defect: `.fc-note` — the METHOD paragraph — was emitted 87 times
     against 4 emissions of `.fc-reading`, the FINDING.

     THEY MOVED RATHER THAN BEING COPIED OR THREADED. flows-panels.js was
     drawn on four routes when they moved, and the card dialog called the same
     functions this page's grid calls: a copy is what that file's header
     exists to refuse, and threading would have left the dialog folding while
     the page did not, or the reverse. This file reads them back out of `P`
     with the width policy and the formatters.

     AND THE BYTE TRADE THAT PARAGRAPH RECORDED IS OVER. A <details> is
     cheaper on a READER than an always-drawn paragraph and DEARER on the
     wire, so the three routes that drew no panels paid for a fold they never
     opened. They do not load flows-panels.js at all now — the dialog they
     loaded it for is retired — so the fold is billed to the one route that
     opens it, and tests/flows-weight.mjs records that as three ceilings
     coming down rather than as a trade.

     WHAT STAYED IS NOT A SECOND COPY. `appendNotes` is the string-shaped
     adapter over the moved `appendMethod`: the eight call sites below own
     plain prose, and building their paragraphs at each site would be eight
     places for a stray ".." to reach a reader. It holds no threshold and no
     disclosure of its own; both are one function, over there — where the
     split is stated in one line: a note that could change WHAT THE READING
     MEANS stays open, a note explaining HOW IT WAS MADE folds, and neither is
     ever deleted, because a folded paragraph is still in textContent.
     tests/flows-ticker-contract.mjs asserts both halves panel by panel. */
  function appendNotes(host, notes, summary) {
    appendMethod(host, (notes || [])
      .filter((n) => n && String(n).trim())
      .map((n) => el("p", "fc-note", String(n).trim().replace(/\.+$/, "") + ".")),
      summary || "How to read this panel");
  }

  /**
   * Mark every explained element, and give the explanation a door a keyboard
   * and a thumb can open.
   *
   * THE SURVEY COUNTED ~145 `[title]` TOOLTIPS WITH NO VISIBLE AFFORDANCE. A
   * reader cannot tell an explained cell from an unexplained one, so an
   * explanation is found only by a mouse that happened to rest on the right
   * four characters — and `title` is shown on keyboard focus by no browser
   * and has no gesture at all on a touch screen. An explanation nobody can
   * reach is the appearance of documentation, not documentation.
   *
   * TWO HALVES, AND NEITHER WORKS ALONE. The class puts a dotted rule under
   * the marked text so a reader can SEE that an explanation exists; the
   * disclosure at the foot carries the marked TERMS with their explanations
   * in full, so a reader can READ them with a tab and a return key or with
   * one tap. The title attribute stays where it was.
   *
   * ONE TAB STOP PER PANEL, NOT ONE PER TERM. `tabindex="0"` on all 145 buys
   * the keyboard reader 145 stops between one panel and the next and STILL
   * shows nothing when focus lands; a <summary> is one stop for the set.
   *
   * THE MARKER IS WIDER THAN THE LIST. Every short explained element gets
   * the marker; only the ones naming a TERM — a column head, a stat label, a
   * block heading — are listed, because a list keys on a name and a data
   * cell has none: "+412" is a value, explained by the number beside it.
   * Long paragraphs that footnote themselves are the next wave's work.
   */
  const WHY_TERM_MAX = 48;
  const WHY_TERM_TAGS = ["TH", "H4", "DT"];

  /** The name a marked element goes into the list under, or "" for none. */
  function whyTerm(node) {
    /* statList wraps each pair in a .fc-stat div and the tooltip goes on the
       wrapper — see drawMarketRank, which has no other place to hang it —
       so the term is the wrapper's own <dt> rather than its whole text. */
    if (node.classList.contains("fc-stat")) {
      const dt = node.querySelector("dt");
      return dt ? String(dt.textContent || "").trim() : "";
    }
    return WHY_TERM_TAGS.indexOf(node.tagName) >= 0
      ? String(node.textContent || "").replace(/\s+/g, " ").trim()
      : "";
  }

  function markExplained(host) {
    const rows = [];
    const seen = new Set();
    for (const node of host.querySelectorAll("[title]")) {
      const why = String(node.getAttribute("title") || "").trim();
      if (!why) continue;
      const shown = String(node.textContent || "").replace(/\s+/g, " ").trim();
      if (!shown || shown.length > WHY_TERM_MAX) continue;
      node.classList.add("fc-why");
      const term = whyTerm(node);
      if (!term) continue;
      /* ONE COLUMN HEAD IS ONE TERM. Its forty cells carrying the same
         sentence are that term forty times, and a decoder that repeats it
         forty times is a decoder nobody finishes. */
      const key = term + "\u0000" + why;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([term, why]);
    }
    if (!rows.length) return;
    const box = el("details", "ft-how ft-why");
    box.append(el("summary", "ft-how-s",
      "What the marked terms mean (" + rows.length + ")"));
    /* NOT statList. `.fc-stats` is an 8.5rem auto-fit grid built for a figure
       under a label; a two-sentence explanation in one of those tracks wraps
       to a column of single words. This list is a definition list shaped for
       prose. */
    const dl = el("dl", "ft-why-l");
    for (const [term, why] of rows) {
      dl.append(el("dt", "ft-why-t", term));
      dl.append(el("dd", "ft-why-d", why));
    }
    box.append(dl);
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
     Rows are `surface.rows`, log-moneyness band centres, HIGH STRIKES AT
     THE TOP — the order a price ladder is read in, and the order the
     emitter built them in (`flows-premium.js`: `for (let k = rowHi;
     k >= rowLo; k--)`). Columns are `surface.expiries` as published,
     nearest first.

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
                     all. The solid state has to be a DRAWN edge, not the
                     absence of one: `flows-desk.js` writes
                     `stroke:"none"` for `traded === true` and so ships
                     two appearances for a tri-state, which reads as "two
                     kinds of odd cell and a normal one" rather than as
                     three measured facts. Every cell here has a border.
       4. NUMBER   — the contract's own quoted implied volatility, as a
                     percent, printed inside the cell when the cell can
                     hold it.

     THERE IS NO SECOND HUE ON THIS GRID. `.fts-cell` carries one fill
     and the sign lives entirely in the hatch, so nothing is lost in
     greyscale — stricter than the gamma surface, which tints `is-pos`
     and `is-neg` and uses the hatch as reinforcement.

     ---------------------------------------------------------------
     THE LABELLED CHOICES, all of which the panel states in words:

     CHOICE 1 — the opacity ramp is `0.12 + 0.46 · min(1, |skew|/cap)`.
     The 0.12 floor keeps a small-but-real skew visibly a cell: zero
     opacity and "nothing here" must never look alike, and this grid has
     a separate mark for "nothing here". The 0.58 ceiling exists because
     the quoted volatility is printed ON TOP of the fill.

     CHOICE 2 — `skewCap` is a 0.9 quantile of |skew| ON THIS CHART
     (`SKEW_CAP_QUANTILE`, floored at `SKEW_CAP_FLOOR = 0.01`): not a
     constant and not shared. THE SHADING IS THEREFORE NOT COMPARABLE
     BETWEEN TWO NAMES and the note says so — measured across the emitted
     corpus the cap ranges 0.0945 to 0.1972, a factor of 2.1, so the same
     shade means twice the skew on one card as on another.

     CHOICE 3 — row labels are `ln(K/S)` to two decimals, NOT a
     percentage. A row at 0.50 is a strike 64.9% above spot and the
     emitter does build rows out to ±0.5 on a wide chain, so a "+50.0%"
     label would be wrong by 14.9 percentage points at the extreme. Two
     decimals separates every row on the step ladder the emitter uses
     (0.05 and 0.10, measured); the two finest rungs of
     `SURFACE_ROW_STEPS` (0.005, 0.01) would collide at two decimals, so
     the decimal count is taken from `step`.

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
     FACT ABOUT A DIFFERENT PANEL. The gamma surface, same grid idiom,
     same card, styles `.gs-cell.is-zero { fill: none }` — and there
     hollow means MEASURED EXACTLY ZERO. Two hollow cells, two opposite
     meanings, one screen. The key names this one explicitly and the note
     spells the difference out; do not shorten either.

     No cell at all — `.fts-void`, an EXPLICIT FILLED rectangle, never a
     gap. A band with no listed contract and a band whose contract is
     quoted indistinguishably from its neighbours must not look alike.

     ---------------------------------------------------------------
     WHAT IS NOT ON THE WIRE, so that nobody designs it back in.
     `serialiseSurface()` keeps FOUR fields per cell — `iv`, `skew`,
     `traded`, `strike` — and DROPS `type`, `volume`, `oi`, `crowd` and
     `m`; `atmType` is dropped from the expiry too. Verified against all
     65 emitted cards. The desk's `cellTitle()` reads five of the dropped
     fields and CANNOT be reused here: each would render as `undefined`
     or, coerced, as a confident zero. In particular do NOT infer "below
     spot, therefore a put" — `rows[i]` is a stated band centre, not the
     contract's own moneyness, and the note says so.
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

    /* ---- THE READING, BEFORE THE PICTURE ----------------------------

       THIS PANEL STATED NO FINDING AT ALL: a grid, a four-cell stat list,
       then twelve paragraphs of decoder — 4,100 characters of method under a
       chart whose one carry-away number, the steepest cell, sat in the
       fourth cell of that list, below the fold on a phone.

       WHY THE STEEPEST CELL IS THE FINDING. A shade cannot state a number
       exactly; that is what the ramp pays for showing fifty cells at once.
       The one number it cannot give back is its own extreme, and both
       coordinates travel with it — a band without its expiry is not a smile,
       an expiry without its band is not a term.

       THREE ARMS, AND THE MIDDLE IS THE HOUSE RULE. `peak === null` is an
       absence; a peak of exactly 0 is a MEASURED FLAT SMILE and gets its own
       sentence. `isNum` is asked `=== null` rather than used as a truth
       value: a measured zero is falsy and would be dropped on the way in. */
    const placed = isNum(panel.placed), fresh = isNum(panel.fresh);
    let peak = null;
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < cols.length; j++) {
        const sk = isNum(Array.isArray(skM[i]) ? skM[i][j] : null);
        if (sk === null) continue;
        if (peak === null || Math.abs(sk) > Math.abs(peak.s)) peak = { s: sk, i, j };
      }
    }
    const peakCell = peak === null ? null
      : ftsBand(isNum(rows[peak.i]), dp) + " · " +
        String((cols[peak.j] && cols[peak.j].expiry) || DASH).slice(5);
    leadReading(host, peak === null
      ? "No cell on this surface carries a measured distance from its own expiry's " +
        "at-the-money level, so the grid below shows where this book is listed and " +
        "nothing about how far off the level it is quoted."
      : peak.s === 0
        ? "Every quote on this surface sits exactly on its own expiry's at-the-money " +
          "level: a measured flat smile across " + rows.length + " " +
          ftsPlural(rows.length, "band", "bands") + " and " + cols.length + " " +
          ftsPlural(cols.length, "expiry", "expiries") + ", not an absence of readings."
        : "The steepest quote on this surface is " + ftsPts(peak.s) + " volatility points " +
          (peak.s > 0 ? "above" : "below") + " its own expiry’s at-the-money level, at " +
          peakCell + "." +
          (fresh === null || placed === null
            ? " How many of these cells traded today is not published."
            : " " + fresh + " of " + placed + " placed cells are prints from today."));

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
        "font-family": "var(--font-figure)", "font-size": 9,
        fill: "currentColor", "fill-opacity": atmIv === null ? 0.55 : 1,
        "font-weight": atmIv === null ? 400 : 700,
      });
      lvl.textContent = atmIv === null ? DASH : ftsVol(atmIv);
      group.append(lvl);

      const head = svgEl("text", {
        class: "fts-exp", x, y: padT - 17, "text-anchor": "middle",
        "font-family": "var(--font-figure)", "font-size": 9,
        fill: "currentColor", "fill-opacity": 0.8,
      });
      /* The ISO date keeps its hyphen — the U+2212 rule is about signs, and
         "08−31" is not a date. slice(5) drops the year, which is the same on
         every column of every card this panel draws. */
      head.textContent = String(e && e.expiry).slice(5);
      group.append(head);

      const tenor = svgEl("text", {
        class: "fts-days", x, y: padT - 6, "text-anchor": "middle",
        "font-family": "var(--font-figure)", "font-size": 8.5,
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
            "font-family": "var(--font-figure)", "font-size": 9,
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
        "font-family": "var(--font-figure)", "font-size": 9.5,
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
        "font-family": "var(--font-figure)", "font-size": KEY_FS,
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

    /* A HEATMAP HAS TWO INDICES AND THIS CURSOR SEARCHES ONE, so which one
       is the whole design of this registration.

       Reading a single CELL would need both, and a cell already shows its own
       number wherever the column is wide enough for `withNumbers`; where it
       is not, the honest fix is a wider panel, not a cursor that reads one
       cell of thirteen.

       WHAT THE PICTURE CANNOT STATE IS THE COLUMN. Each expiry carries
       published readings of its own — atmIv, atmStrike, days, how many of its
       cells printed today — and none is drawn anywhere in the grid, because
       the column head has room for the tenor and little else. Every row below
       is a field off `cols[j]`, so this is not a second opinion about the
       surface; it is the column's own header data made reachable. */
    if (window.FlowsCursor && cols.length) {
      window.FlowsCursor.attach(svg, {
        name: "Implied volatility surface, by expiry",
        band: { y0: padT, y1: padT + gridH },
        points: cols.map((e, j) => {
          const atmIv = isNum(e && e.atmIv);
          const days = isNum(e && e.days);
          const k = isNum(e && e.atmStrike);
          const fresh = isNum(e && e.fresh);
          return {
            x: plotL + j * colW + colW / 2,
            label: String((e && e.expiry) || DASH) +
              (days === null ? "" : " \u00b7 " + days + "d out"),
            rows: [
              /* ftsVol RETURNS THE NUMBER AND NOT THE UNIT — every other
                 caller in this drawer appends the sign itself, and a readout
                 that dropped it would print a bare 32.8 beside prices. */
              { k: "At-the-money IV",
                v: atmIv === null
                  ? (e && e.atmReason ? String(e.atmReason) : "not published")
                  : ftsVol(atmIv) + "%" },
              /* No sign handling on a strike: a strike is a price and prices
                 on this chain are positive, so there is no hyphen to promote
                 to a minus and `neg` is not in this drawer's scope anyway. */
              { k: "At the strike", v: k === null ? "not published" : k.toFixed(2) },
              { k: "Traded today",
                v: fresh === null ? "not published" : fresh + " of this column's cells" },
            ],
          };
        }),
      });
    }

    host.append(svg);

    /* ---- the numbers the picture cannot state exactly ---------------- */
    const pairs = [];
    pairs.push(["Bands", rows.length + (step === null ? "" : " × " + (step * 100).toFixed(1) + "%")]);
    pairs.push(["Expiries", String(cols.length)]);
    pairs.push(["Shade cap", cap === null ? DASH : "±" + capTxt + " pts"]);
    pairs.push(["Prints today", fresh === null || placed === null ? DASH : fresh + " of " + placed]);
    /* THE SAME STEEPEST CELL THE PANEL ALREADY LED ON, in figures — measured
       once, at the top of this drawer, so the sentence a reader reads first
       and the cell they check it against cannot disagree. */
    if (peak) pairs.push(["Steepest cell", ftsPts(peak.s) + " pts · " + peakCell]);
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
    /* ---- coverage: ALWAYS STATED, AND ALWAYS ABOVE THE METHOD --------

       Two of these three sentences change WHAT THE READING MEANS — an
       arbitrary 500-row page of the book, or a card that will not say how
       much of the book it saw — so they stay in the open, at full ink, above
       the decoder and never inside it. The truncated one is still VERBATIM
       and still its own paragraph: it says the whole picture may be an
       arbitrary slice, and a sentence like that must not be sanded into the
       middle of decoder prose.

       The third says the vendor returned the whole chain, which qualifies
       nothing and is exactly what a decoder is for, so it joins the notes
       rather than spending a paragraph of attention saying nothing is
       wrong. */
    const cov = panel.coverage;
    if (cov && cov.truncated === true) {
      host.append(el("p", "fc-note is-qualifier",
        "The vendor returned a full page of 500 contracts in no documented order. This is an " +
        "arbitrary subset of the book — the skew and term readings are withheld for that reason."));
    } else if (cov) {
      const seen = isNum(cov.rowsSeen), priced = isNum(cov.pricedRows);
      notes.push("The vendor returned the whole chain" +
        (seen === null ? "" : ": " + seen + " " + ftsPlural(seen, "contract", "contracts") +
          (priced === null ? "" : ", " + priced + " of them priceable")) +
        ", so this surface is taken over the entire book rather than a page of it." +
        (cov.filter ? " " + cov.filter.charAt(0).toUpperCase() + cov.filter.slice(1) + "." : ""));
    } else {
      /* A panel built before chainPanel() wrapped coverage on has no coverage
         key. "No coverage was published" is a fact; silence would read as
         "the whole book", which is the claim this page exists to refuse. */
      host.append(el("p", "fc-note is-qualifier",
        "This card publishes no coverage record for the chain, so how much of the book this " +
        "surface was taken over is not known."));
    }

    appendNotes(host, notes, "How to read this surface");
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
        STRICTLY ABOVE THE LARGEST LEVEL DRAWN. The alternative was
        `1.08 × max(atmIv)`: a multiplier nobody chose for a reason, and
        it lands the axis top on a number no tick would print — on the
        measured fixture, 1.08 × 0.328 = 0.35424. The round rule reuses
        the codebase's own `niceStep` against max/4, giving a top of
        35.0% on a 5-point ladder. STRICTLY above, so a maximum already
        an exact multiple of the step gets one more and the tallest bar
        never touches the frame. Top, ladder and maximum are printed.

     2. ORIGIN AT ZERO, AND WHY THE BARS LOOK ALIKE. `atmIv` is an
        unsigned LEVEL, so it grows from a baseline meaning zero implied
        volatility and gets no zero tick — there is no "no change" reading
        to rule. The cost is stated: eight levels between 21% and 34%
        render as eight bars of similar height, and the POLYLINE carries
        the shape. A truncated axis would make every term structure look
        dramatic by construction, which is the trade refused here rather
        than taken quietly.

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
        measured — the break is `renderPath`'s, in `flows-drawers.js`.

     5. THE TWO SCALARS ARE TEXT, NOT MARKS, AND CARRY NO HUE. `skew` has
        polarity −1 (put iv − call iv, the same construction as
        `riskReversal`; puts bid is BEARISH), so a POSITIVE skew tinted by
        its sign rather than by a polarity lookup would be tinted UP — the
        classic error on this field. Direction is given IN WORDS beside
        the signed number, which survives a monochrome print and a reader
        who cannot separate the hues. `polarityOf()` lives in `shared/`
        and never reaches the browser, so a hue here could only come from
        a SECOND copy of the polarity table. There is no hue at all.

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

    /* ---------- THE TWO READINGS, BEFORE THE CHART -------------------

       THE PANEL'S FINDING IS THE SKEW AND THE TERM, and a reader met them
       fourth: the question, a 188px chart, the skew, the term, then eleven
       hundred characters of method. The chart is the SHAPE of the term
       structure; the two scalars are what a desk carries away. So the
       scalars go first and the chart becomes their evidence.

       THE SKEW READING IS STILL THE FIRST .fc-reading ON THE PANEL, and a
       withheld skew still carries NO DIGIT — the contract test scopes "draws
       no skew number" to `.fc-reading`, resolving to the FIRST one, and the
       modal truncated card withholds the skew while publishing good levels.

       AN ABSENT SCALAR IS STILL THE LEAD, at the size a published one gets:
       demoting it would make a silence cheaper to ship than a number. */
    const skew = isNum(panel.skew);
    const skewB = panel.skewBasis || null;
    let skewSaid;
    if (skew === null || !skewB) {
      skewSaid =
        "The wing-to-wing skew is not published for this name. The reason it was " +
        "withheld is stated below, verbatim, rather than replaced by a zero — a " +
        "symmetric smile is a real and notable reading, and this is not one.";
    } else {
      /* VOLATILITY POINTS, one decimal, the same precision every level on this
         panel is printed to. The sign glyph comes from `signed`, which is U+2212
         and not the hyphen `toFixed` emits. */
      skewSaid =
        `Skew ${volPts(skew)} volatility points at ` +
        `${skewB.days === null ? "an unstated tenor" : skewB.days + " days"} ` +
        `(${skewB.expiry}): ` +
        (skew > 0
          ? "the put wing is bid over the call wing."
          : skew < 0
            ? "the call wing is bid over the put wing."
            : "both wings are quoted at the same volatility.");
    }
    leadReading(host, skewSaid);

    const term = isNum(panel.term);
    const termB = panel.termBasis || null;
    let termSaid;
    if (term === null || !termB) {
      termSaid =
        "The term difference is not published for this name. The reason it was " +
        "withheld is stated below, verbatim.";
    } else {
      /* term = far − near, so a NEGATIVE term is the FRONT bid over the back:
         the near level is the higher one. Getting this backwards inverts the
         whole reading, which is why the direction is spelled out beside the
         signed number instead of being left to the sign. */
      termSaid =
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
    leadReading(host, termSaid);

    /* THROUGH ftWidth, LIKE THE OTHER THREE DRAWERS HERE. This was a fourth
       answer to "how wide is this chart", and it recorded the measurement
       that condemns it — "a 320px viewport gives a 284.8px host" — then
       floored at 300 anyway, shrinking a 300-unit chart into a 282px box on
       every phone at 0.940 px per unit.

       THE ALIGNMENT INVARIANT MAKES IT MANDATORY, NOT TIDY: the rule stated
       with the stylesheet below is that this panel's j-th bar centre lands on
       the surface's j-th column centre, an equality between two host widths
       that two width functions hold only by coincidence. */
    const W = ftWidth(host);

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
        class: cls, "font-family": "var(--font-figure)", "font-size": size,
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

    /* THE AXIS HERE PRINTS TENORS, NOT LEVELS, so "what was the level at 53
       days" had no answer short of measuring a bar against the rail. The
       sentence above states the first and last measured columns, which is a
       summary and not a substitute for reading the middle.

       `tenorOf` is the phrase that closing sentence uses, so one column
       cannot be named two ways on one panel; and a column with no level
       prints its published reason, which is what the miss rail below the
       axis exists to say in ink. */
    if (window.FlowsCursor && cols.length) {
      window.FlowsCursor.attach(svg, {
        name: "At-the-money level along the term",
        band: { y0: padT, y1: baseY },
        points: cols.map((col, j) => {
          const v = levelOf(col);
          const why = col.point && col.point.reason ? String(col.point.reason) : null;
          return {
            x: cxOf(j),
            label: String((col.point && col.point.expiry) || DASH) +
              " \u00b7 " + tenorOf(col),
            rows: [
              { k: "At-the-money IV",
                v: v === null ? (why || "no level on this column") : vol1(v) },
            ],
          };
        }),
      });
    }

    host.append(svg);

    /* ---------- the two bases, under the readings they support -------

       THE READINGS ARE ABOVE THE CHART — see THE TWO READINGS, at the top of
       this drawer. What is left here is the EVIDENCE for each: the wings the
       skew was measured between, the legs the term was measured across.
       Evidence belongs under the picture; the finding does not. */

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
    /* EVERY DASH IN THIS BLOCK SAYS WHICH SILENCE IT IS, through statList's
       fourth and fifth slots: the taxonomy's own word on `data-empty`, which
       flows.css draws as the dagger, the cross or the quiet hairline, and the
       sentence on `title`.

       WHICH WORD IS READ OFF THE SHAPE OF THE FIELD, not guessed. A key this
       card never carried is `unavailable`; a key carrying an explicit null is
       a measurement that came back empty, which is `quiet`; anything else that
       fails isNum is bytes this line could not read as a number, which is
       `unreadable`. Collapsing the three into one em dash tells a reader only
       that the number is absent, which is the one thing the dash already said.

       THE REASON IS THE PAYLOAD'S, VERBATIM. shared/flows-chain.js decided the
       refusal and says why — past the IV ceiling it will vouch for, no listed
       expiry reaching the day floor, or nothing at the money that traded today
       — and restating that here would be a second answer to the same question,
       drifting the day the chain's own wording changes.

       THIS USED TO BE `stats.querySelector("dd").title` AFTER THE FACT, which
       reaches the FIRST pair and no other: the level got a tooltip and no mark
       at all, and the moneyness band two rows down was a bare dash however it
       went missing. The band is also read through isNum before it is
       formatted, because `panel.atmBand.toFixed` on the numeric STRING isNum
       accepts is a TypeError inside a drawer. */
    const silence = (key) =>
      (key in panel ? (panel[key] === null ? "quiet" : "unreadable") : "unavailable");
    const atm = isNum(panel.atmIv);
    const band = isNum(panel.atmBand);
    host.append(statList([
      ["At-the-money level", atm === null ? DASH
        : vol1(atm) + (panel.atmExpiry ? " at " + panel.atmExpiry : ""),
        atm === null ? "is-null" : null,
        atm === null ? silence("atmIv") : null,
        atm === null ? panel.atmReason ||
          "This card's chain panel carries no at-the-money level and no reason for it." : null],
      ["Expiries levelled", `${measured.length} of ${cols.length} drawn`],
      ["Moneyness band", band === null ? DASH : "±" + band.toFixed(2) + " ln(K/S)",
        band === null ? "is-null" : null,
        band === null ? silence("atmBand") : null,
        band === null
          ? "The band a quote must sit inside to be counted at the money is this surface's " +
            "own constant, and this card does not state it, so the level above cannot be " +
            "read against the window it was taken from."
          : null],
    ]));

    /* ---------- the notes, split by whether they change the reading ---

       QUALIFIERS APPENDED HERE AT FULL INK; METHOD INTO `method` for the
       disclosure at the foot. The test asserts both halves.

         the count of unlevelled columns — QUALIFIER: part of the drawn line
         is not a measurement, which changes what the picture means.
         why the rail sits below the axis — METHOD: the count already
         carried the fact; this explains the choice.
         the axis policy — METHOD: a zero origin is how the bars were drawn,
         not what they say.
         the borrowed grid, the truncated chain, a withheld scalar's own
         reason and the payload's stated relation — QUALIFIERS, all four,
         all still in the open below. */
    const method = [];

    method.push(
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
      "the level.");

    if (missing.length) {
      host.append(el("p", "fc-note is-qualifier",
        `${missing.length} of ${cols.length} columns carry no at-the-money level and sit on ` +
        "the rail BELOW the axis, not on it. Each marker carries that expiry's own stated " +
        "reason."));
      method.push(
        "A column with no level sits on the rail below the axis rather than on it because " +
        "the baseline is zero implied volatility, and a level the surface refused to vouch " +
        "for would be drawn there as a confident measurement of nothing. The line breaks " +
        "across those columns rather than crossing a value nobody measured.");
    }

    if (grid.borrowedNote) host.append(el("p", "fc-note is-qualifier", grid.borrowedNote));

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
      if (parts.length) host.append(el("p", "fc-note is-qualifier", parts.join(" ")));
    }

    /* The withheld-scalar reasons, verbatim and unsummarised. Two identical
       reasons print ONCE: on a truncated card `skewReason` and `termReason` are
       the same sentence, and printing it twice reads as two separate failures. */
    const reasons = [];
    if (skew === null && panel.skewReason) reasons.push(["The skew", panel.skewReason]);
    if (term === null && panel.termReason) reasons.push(["The term difference", panel.termReason]);
    if (reasons.length === 2 && reasons[0][1] === reasons[1][1]) {
      host.append(el("p", "fc-note is-qualifier",
        "Neither scalar is published: " + reasons[0][1] + "."));
    } else {
      for (const pair of reasons) {
        host.append(el("p", "fc-note is-qualifier", pair[0] + " is not published: " + pair[1] + "."));
      }
    }

    /* THE STATED RELATION, VERBATIM, LAST. Everything above is this renderer's
       paraphrase; this is the payload's own sentence, and it is what a reader
       should believe if the two ever disagree. It also carries the ±0.10, the
       0.04 and the 7 days as the pipeline actually holds them, which is the only
       defence against this file's restated copies of those three drifting. */
    /* THE STATED RELATION STAYS IN THE OPEN — the one piece of method here
       that does. Its whole defence is that a drift between the pipeline's
       constants and this file's restated copies of them is visible ON THE
       SAME SCREEN as the restatement; inside a closed disclosure it is
       visible on no screen at all. */
    if (panel.relation) host.append(el("p", "fc-note is-qualifier", panel.relation));

    /* AND THE METHOD LAST, behind the disclosure once it is a wall. The
       axis policy alone is 750 characters, so on any card that draws a scale
       this collapses; a chain with no levels leaves one short paragraph,
       which appendNotes leaves open — a one-line decoder behind a click is a
       click for nothing. */
    appendNotes(host, method, "How to read this term structure");
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
   * THE MEASUREMENT. That holds for 48 of 50 emitted cards and is FALSE on the
   * two TRUNCATED ones — the case this page was designed for. The pipeline
   * spends a second, expiry-filtered call when the first page fills, then
   * splices the scalars AND the whole `skewTerm` panel out of the narrow read
   * while `ivSurface` keeps the broad one. Measured on a freshly emitted
   * SYN212 and SYN306: `ivSurface.expiries.length === 8` against
   * `points.length === 1`, two stacked panels whose columns do not line up.
   *
   * WHAT THIS DOES ABOUT IT. When every published point's expiry is found among
   * the surface's, the grid is the SURFACE'S columns and each point sits in the
   * column it belongs to, so the alignment invariant holds on the truncated
   * card too; the columns the term line does not cover are drawn as what they
   * are — columns with no reading, on the miss rail, with the reason stated.
   * The alternative, one lonely bar centred across a 900px plot beneath an
   * eight-column surface, is a chart that lies about which expiry it
   * describes.
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

     NOT A CHART, AND DELIBERATELY NOT ONE. Every other panel here
     answers a question about a SHAPE, which is what a chart is for.
     This one answers "which single lines carried the volume", and the
     answer is ten rows of nine quantities that are not commensurable: a
     strike is a price, a volume is a count, an expiry is a date. Any
     shared visual scale would invent a comparison the data does not
     contain. A table prints each number in its own units.

     IDENTIFICATION. Nothing here is estimated. Every column is a vendor
     observable or a difference of two of them, and the two differences
     are named beside the table:

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
     interpolation, no volatility model. The one derived number not off
     the wire is the day count in the Expiry title — calendar days
     between the card's own sessionDate and the contract's expiry,
     stated as a CHOICE below because "days" could equally have meant
     trading days and the two differ by a third.

     THE CHOICES THIS PANEL MAKES, each labelled where it is made:

     CHOICE 1 - NO MID COLUMN. (bid + ask) / 2 is the most requested
     column on a table like this and it is refused: a midpoint asserts
     that the true price sits exactly halfway across a spread that may
     be a penny or a dollar wide, and on the deep out-of-the-money lines
     that make this table interesting it is routinely neither. Bid and
     Ask are adjacent, as quoted, so a reader who wants a midpoint can
     see what they would be averaging. Refused upstream for the same
     reason: shared/flows-chain.js publishes bidPx and askPx and no mid.

     CHOICE 2 - NET AGGR IS IN CONTRACTS AND THE UNIT IS IN THE HEADER.
     A dollarised flow would need a price basis, which is CHOICE 1 again
     wearing a hat. "Net aggr (contracts)" keeps the unit from coming
     apart from the number when the column is read on its own.

     CHOICE 3 - THE SIGN OF NET AGGR IS CARRIED BY A GLYPH FIRST AND BY
     HUE LAST: U+2191 / U+2193 lead the number, U+2212 marks negatives,
     and only then does a class hand CSS the flow palette. Not U+25B2 /
     U+25BC: assets/css/base.css lists the arrows and U+2212 in the
     JetBrains Mono latin subset and does not list the triangles, so a
     triangle would fall through to the system stack and change the
     character advance halfway down a tabular-numeric column.

     CHOICE 4 - IMPLIED VOLATILITY IS IN THE STRIKE CELL'S TITLE, NOT IN
     A TENTH COLUMN. The alternative — a tenth column shown only at
     >= 76rem — is rejected mechanically: this panel is drawn ONCE per
     mount, so a drawer deciding its column count from matchMedia at
     draw time would be one debounce behind the layout, and a column
     that is present-but-wrong is worse than one that is absent. The
     title also keeps ln(K/S) and the volatility together, which is
     where they belong: they place a strike on the smile.

     CHOICE 5 - dOI GETS NO DIRECTIONAL HUE. shared/flows-card.js's
     POLARITY table has no `doi` entry and polarityOf() returns 0 for a
     key it does not know. That is not an omission to patch here: a
     rising open interest is not bullish and a falling one is not
     bearish, and tinting the column would invent a direction the
     quantity does not have. `aggr` IS in that table at +1, so Net aggr
     is the one column here that earns the flow palette.

     THE FOUR ABSENCES THAT WOULD BECOME LIES IF PRINTED AS ZERO:

     1. aggr === null is U+2014, never 0. "No aggressor split was
        reported" and "the split was reported and balanced" are
        different facts and only one is a reading. A measured zero
        prints "0" with no arrow, neither arrow being true at zero. The
        foot states how many rows shown carried a split at all.
     2. doi === null is U+2014, never 0. An open_interest present with
        prev_oi absent is not "no change", it is "the change is not
        computable". An unchanged open interest prints 0.
     3. bidPx / askPx / iv / oi are each independently U+2014.
     4. Sort puts null LAST in both directions. Reversing is where this
        is easiest to lose: negate the comparator wholesale and every
        unmeasured row floats to the top, where position reads as
        ranking. Unmeasured never wins a ranking — the rule flows-board
        .js and flows-watch.js already state, applied to a third table
        so there is one rule and not three.

     COVERAGE IS ALWAYS STATED, in both directions. The vendor's chain
     page tops out, so `coverage.truncated` is a fact about the SAMPLE
     and is printed whether true or false. What truncation means HERE
     differs from the surface panels and the panel says which: the rows
     are not damaged — every line is a contract that really traded, at
     the volume reported for it — but the SUPERLATIVE is. "The day's
     most-traded" is a claim about a ranking over the whole book, and a
     ranking over an arbitrary subset is not that claim, so the rows
     stand and the headline is withdrawn in words.

     THE MOUNT TAG. This drawer emits no <svg>, no <defs> and no `id` at
     all, so the document-global id collision the tag exists to prevent
     cannot arise — and NOTHING BELOW MAY EMIT AN id WITHOUT SUFFIXING
     IT. `mount` is still load-bearing: it keys the per-mount sort
     state, so the grid copy and the enlarged copy sort independently
     and neither loses the reader's order when the page redraws them on
     a resize.
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


  /* Mono advance in px for a string at a given font size, off the one
     text-metric constant this page has. flows-panels.js measured AXIS_CH in
     Chromium on a real caption in the shipped webfont and rounds it up, so
     every estimate errs WIDE — a label estimated too narrow collides or
     leaves the canvas, one estimated too wide costs a few pixels. The number
     is NOT restated here: it has already moved once, from 6 to 6.5. */
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

       THE 0 SEED IS LOAD-BEARING. Math.min(...nets, 0) admits zero as a bound
       even when no bar has that sign. Without it a one-signed book — every
       strike net long calls — gives fMin = +2 and fMax = +5000, so `share` is
       2/5002, the zero rule clamps hard to 18%, and `negW / |fMin|` is a rate
       computed against a bound on the WRONG SIDE of zero: the scale comes out
       nonsense and every bar is wrong together, which nobody catches by
       looking.

       ONE RATE ACROSS THE ZERO RULE. Each side normalised against its own
       extreme would draw the largest bar on each side at that side's full
       width whatever it was worth — a short side 1% of the long one drawn at
       22% of the ink — so the reader's first impression of the BALANCE of the
       book, which is this panel's entire reading, would be manufactured by
       the renderer. `rate` is the largest pixels-per-contract fitting BOTH
       sides inside their halves.

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

       THIS PANEL EMITS ITS OWN PATTERN RATHER THAN REUSING renderGamma's
       #gpNeg, and the two reasons are both real on this page:

       1. renderGamma EMITS #gpNeg ONLY WHEN IT DRAWS. It returns through
          deadPanel before reaching its <defs> whenever the gamma panel is
          unavailable, and that panel is shed independently of this one by the
          pipeline's payload ladder. On such a card `url(#gpNeg)` resolves to
          nothing, a browser paints an unresolvable paint server as no paint
          at all, and the hatch — the SECOND sign channel, the one that has to
          survive a greyscale render — vanishes with no error while the panel
          still looks finished.

       2. THE ENLARGE DIALOG DRAWS ONE PANEL, so depending on a sibling's
          private unsuffixed id for a mandatory encoding channel would make
          this panel's correctness a function of that sibling's status.

       Hence an id of this panel's own, suffixed with `mount`: SVG ids are
       document-global and url(#id) takes the FIRST match in document order,
       so a page showing the grid copy and the zoom copy at once would
       otherwise give the second drawing the first's tile.

       WHAT IS NOT DUPLICATED IS THE APPEARANCE. The tile is byte-identical to
       renderGamma's (4×4, userSpaceOnUse, rotate(45), the line at x=2 so a
       1.8 stroke sits wholly INSIDE the tile rather than clipped at its edge)
       and carries renderGamma's class as well as this panel's, so the shipped
       `.gp-negpat` rule colours it and the two cannot drift. `.fa-negpat`
       exists so they CAN be diverged later. One appearance, one rule, two
       independent ids. */
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

    /* THE SECOND TRANSPOSED LADDER, AND `axis: "y"` FOR THE SAME REASON.
       This panel's geometry is renderGamma's on purpose — same row pitch,
       same rails, so one strike sits at one height across both — and the
       cursor follows.

       THREE NUMBERS, BECAUSE A NET WITHOUT A DENOMINATOR IS UNREADABLE. A net
       of +400 on 500 contracts and the same net on 40,000 are opposite
       findings, and the bar draws only the first of those.

       AND THE OTHER TWO ARE NOT THE NET'S TERMS. `calls` and `puts` are the
       CALL AND PUT VOLUME at the strike (shared/flows-chain.js sums them by
       `p.type`), so they add to `vol` and do not subtract to `net` — `net` is
       aggressor-signed, positive where a contract was bought. A first draft
       of this readout labelled them "Bought / sold", which is a confident
       statement of the wrong quantity, and the fixture caught it: 1,785 and
       3,864 against a net of 1,247 and a volume of 5,649. They are the
       composition of the volume, and that is what they are called. */
    if (window.FlowsCursor && bars.length) {
      window.FlowsCursor.attach(svg, {
        name: "Net aggressor volume by strike",
        axis: "y",
        band: { x0: plotL, x1: plotR },
        points: bars.map((b, i) => {
          /* faGrouped IS THIS PANEL'S OWN FORMATTER and it carries the sign
             and the absence itself — MINUS for a negative, the em dash for a
             number that is not there. Reaching past it for a second spelling
             is how one panel comes to print two forms of the same figure.
             The strike goes to two decimals because this readout is an HTML
             box with no 46px budget to clip it, unlike the rail label. */
          const side = (v) => (isNum(v) === null ? "not split" : faGrouped(v));
          return {
            y: yOfIndex(i),
            label: neg(b.k.toFixed(2)),
            rows: [
              { k: "Net aggressor", v: faGrouped(b.net),
                cls: b.net > 0 ? "is-pos" : b.net < 0 ? "is-neg" : "" },
              { k: "Call / put volume", v: side(b.calls) + " / " + side(b.puts) },
              { k: "Volume at strike",
                v: isNum(b.vol) === null ? "not reported" : faGrouped(b.vol) },
            ],
          };
        }),
      });
    }

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

      /* THE CURVE ALREADY HELD THIS READING AND ONLY A MOUSE COULD REACH IT.
         Every dot carries a <title> with these same values — a native
         tooltip, which appears after a delay, one dot at a time, and which a
         keyboard never reaches at all. Read off the same `pts` entries, so
         the two cannot disagree; what this adds is arrow keys and no hover.

         The title DROPS the implied-move clause when it is absent, which
         reads as a curve that has no such thing. Rule 2 in flows-cursor.js
         is why the readout says so instead. */
      if (window.FlowsCursor && pts.length) {
        window.FlowsCursor.attach(svg, {
          name: "Implied volatility along the term",
          band: { y0: padT, y1: H - padB },
          points: pts.map((p) => {
            const imp = isNum(p.r.impliedMovePerc);
            return {
              x: xOf(p.x),
              label: String(p.r.expiry) +
                (p.dte === null ? "" : " \u00b7 " + p.dte + "d out"),
              rows: [
                { k: "Implied vol", v: vol1(p.y) },
                { k: "Implied move", v: imp === null ? "not reported" : vol1(imp) + " of spot" },
              ],
            };
          }),
        });
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

        /* THE STRIP DRAWS EVERY SESSION AND LABELS NONE OF THEM. It is
           deliberately spare and the headline states only the latest, so
           "what was it in March" had no answer on the page: dots are drawn
           for two specific reasons and most sessions carry no mark to hover
           even if hovering worked.

           A SESSION WITH NO RANK KEEPS ITS PLACE IN THE LIST. Dropping it
           would slide every later session left on a calendar axis; the line
           already breaks rather than bridges across those sessions, and the
           readout makes the same distinction. */
        const dated = rankRows.slice().reverse();
        window.FlowsCursor && window.FlowsCursor.attach(svg, {
          name: "One-year implied-volatility rank by session",
          band: { y0: sPadY, y1: SH - sPadY },
          points: series.map((v, i) => ({
            x: xO(i),
            label: (dated[i] && dated[i].date) || "an unnamed session",
            rows: [
              { k: "IV rank", v: v === null ? "not published" : neg(v.toFixed(1)) },
            ],
          })),
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

     WHAT IT MUST NOT LET A READER BELIEVE, each held by a line of
     code:

     1. THAT ABSENCE IS QUIET. Both feeds are SELECTIONS: a name not
        in one did not make a market-wide list, it is not a name with
        no open-interest change and no off-exchange prints. A missing
        name gets the quiet arm, never the Unavailable banner, and
        the sentence carries the feed's own population and — when the
        feed filled the request — the value the last place held, so
        "just missed" and "nowhere near" read differently.

     2. THAT THE RANKING IS TODAY'S. The vendor states its
        market-wide open-interest feed updates about 06:45 Eastern;
        this pipeline runs at 05:15. The session line under each
        reading is the whole difference between "ranks 14th across
        the market today" and "ranked 14th yesterday, joined onto
        today's card". A feed that states no date says so; it never
        borrows the card's.

     3. THAT A RANK IS A NUMBER ON ITS OWN. Every rank prints as
        "14 of 40", never "14", with the payload's own population —
        and where the feed returned fewer rows than this run asked
        for, the caption says the list was not cut by the request.

     4. THAT COVERAGE IS FINE. If three of fifty board names appear
        in a feed, forty-seven cards each say they are not in it:
        one thin join, not forty-seven findings, and the coverage
        line says which on every card.

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
    p.append(el("strong", null, kind === "quiet" ? "Not in this feed \u2014 " : "Unavailable \u2014 "));
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

      let said = null;
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
        /* ---- THE READING, BEFORE THE FIGURES AND THE METHOD ----------

           THE BLOCK OPENED ON A STAT LIST AND CLOSED ON FOUR PARAGRAPHS OF
           PROVENANCE. Its one finding — that this name places somewhere in a
           list of every name — was stated in prose UNDER the figures
           (`fmr-said`) and buried by the cut, the session and the coverage.

           SAID IN THE UNIT THE FEED EARNED, long form: `fmrValue`'s `long`
           arm completes the phrase ("% OF THE PREVIOUS SESSION'S OPEN
           INTEREST"), which belongs in a sentence and does not fit an 8.5rem
           cell. Where the run could not name the unit the sentence says so
           rather than printing a bare figure — a number under a heading a
           reader reads as contracts might be a ratio. */
        leadReading(block,
          (rank === null || pop === null
            ? "This name is in this market-wide list"
            : "This name ranks " + tcInt(rank) + " of " + tcInt(pop) +
              " in this market-wide list") +
          (value === null
            ? ", and the value it is ranked on could not be put in a unit this run " +
              "could name."
            : ", at " + fmrValue(f.value, f, true) + ".") +
          (count !== null && count > 1
            ? " " + tcInt(count) + " " + (key === "oiChange" ? "contracts" : "prints") +
              " of this name are in it."
            : ""));

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
        /* WHAT IS LEFT OF `fmr-said` IS ITS METHOD HALF. Its first clause
           stated the rank, which the reading above now states first and
           largest; keeping both would print one number twice and let the two
           copies drift. What only this sentence says — that a cross-section
           is a thing a per-name request cannot produce — is method. */
        said = el("p", "fc-note fmr-said",
          "This ranking comes from a market-wide list this run reads once for the whole " +
          "board. That is a cross-section the per-name feeds on this page cannot report, " +
          "because a request for one name carries no other names in it.");
      } else {
        /* MEASURED, AND NOT IN IT. The publisher's own sentence, verbatim —
           it is the sentence that separates a selection from a silence, and
           paraphrasing it here would put that distinction in two places. */
        fmrSilence(block, "quiet", f.reason || "this name is not in this feed this run.");
      }

      /* ---- the provenance, split by whether it changes the reading ----

         WHICH SIDE EACH LINE LANDS ON IS DECIDED BY THE FEED, not by length:

           THE SESSION. Open whenever the ranking is not this card's session
           or the feed states none — the difference between "ranks 14th
           across the market today" and "ranked 14th yesterday, joined onto
           today's card", which is point 2 of this drawer's header. It folds
           only where the two sessions agree.

           THE CUT. Open on the QUIET arm, where it IS the reading: a name
           that missed the last place by a hair and one nowhere near it are
           different findings and the cut is all that separates them. Folded
           on the ok arm, where the name is in the list.

           THE COVERAGE OF THE JOIN. Open on the thin branch the line already
           computes for itself — at that reach most cards will say they are
           not in the feed, and a reader owes that to any absence here.

         Everything folded is one click away and found by a find-in-page. */
      const quiet = !(f.status === "ok");
      const cut = fmrCutLine(f);
      const when = fmrSessionLine(f, card && card.sessionDate);
      const cov = fmrCoverageLine((panel.coverage || {})[key]);
      const covData = (panel.coverage || {})[key];
      /* THE SAME TEST fmrCoverageLine MAKES, and it must stay the same one:
         that line says "most cards will say they are not in it" on exactly
         this branch, so a reader seeing that sentence must be seeing it
         unopened. Typed the way that function types it rather than through
         isNum — one condition in two places, not two spellings of it. */
      const covThin = !!(covData && typeof covData.of === "number" &&
        typeof covData.in === "number" && covData.of && covData.in * 5 < covData.of);

      const open = [], folded = [];
      (f.sameSession === true ? folded : open).push(when);
      (quiet ? open : folded).push(cut);
      if (cov) (covThin ? open : folded).push(cov);
      if (said) folded.push(said);

      for (const node of open) {
        node.classList.add("is-qualifier");
        block.append(node);
      }
      appendMethod(block, folded, "How this standing was read");
      host.append(block);
    }

    const notes = panel.notes || {};
    appendNotes(host, [notes.what, notes.absence, notes.rank, notes.timing, notes.units],
                "About this market-wide join");
  }

  /**
   * The key-statistics panel, before it gathers anything.
   *
   * PENDING IS ONE OF THE FOUR SILENCES AND IT IS NOT THE OTHER THREE. It is
   * not unavailable (nothing declined to publish), not unreadable (nothing
   * failed to parse) and not quiet (nothing measured empty): it is a box whose
   * figures are gathered from the panels below, and the gathering is the next
   * change. So it says that, in its own sentence and under its own data-empty
   * mark, rather than rendering an empty host — and names where they already
   * are.
   */
  /**
   * The headline figures, gathered from the panels that already publish them.
   *
   * SEVEN ROWS FROM FIVE PANELS, AND THE SILENCES DO NOT MERGE. Every figure
   * here is a reading some other panel on this page makes; this block is a
   * gathering, not a second measurement, and the difference matters twice.
   * It means no row may be computed here — a second derivation of one number
   * is two chances for this panel and the one below it to disagree about the
   * same name. And it means each row inherits the silence of the panel it came
   * from, separately: `levels` can be quiet while `volContext` is unavailable,
   * and a block that answered both with one dash would report a vendor outage
   * as a market with nothing to say.
   *
   * THE FLIP IS ABSENT ON MOST NAMES. card.gammaFlip is published on 19 of the
   * 50 cards a dry run emits — the majority case is no flip, not a rare one —
   * and the reason is the gamma panel's: net gamma does not change sign inside
   * the drawn band. So this row takes that panel's OWN sentence rather than a
   * new one. One fact with two explanations is the same defect as two facts
   * with one, read from the other end.
   *
   * ATR IS READ FROM ONE PLACE. It is published twice, at card.atr and at
   * card.panels.levels.atr, and they agree on all 50 today. Reading one of
   * them is what keeps that true: a block that averaged them, or picked
   * whichever was present, would print a number no single measurement made.
   *
   * THE IV RANK IS PICKED BY DATE, NEVER BY INDEX. ivRank.rows arrives
   * newest-first, and the score-over-price panel's own note says its two series
   * "both run oldest first" — so the ordering a reader of this file would
   * assume is the opposite of the one this payload uses, and `rows[rows.length
   * - 1]` would publish a rank measured 60 sessions ago as today's. Scanning
   * for the latest date costs 60 comparisons and cannot be wrong when a future
   * payload changes its order.
   */
  /* HOW MANY SESSIONS THE LEDGER DRAWS.

     The window is up to forty-two and a table of forty-two rows on a page of
     twenty-four panels is a second page. Twenty is a month of sessions, which
     is the span a reader asks a ledger about — "what has it done lately" —
     and the two charts above still show the whole window, which is what a
     chart is for. The cap is stated in the note under the table rather than
     left for a reader to discover by counting. */
  const LEDGER_MAX = 20;

  /* ---------- the session ledger -----------------------------------

     THE THREE SERIES THIS CARD ALREADY CARRIES, ON ONE ROW PER SESSION.

     A reader wanting "what has this name done" had to read three drawings and
     hold them in their head: the score-over-price chart has close and score,
     the change block has the move, and the premium panel has the flow. Each
     is a chart because a chart is what shows a SHAPE — but the question "what
     happened on the 14th" is a lookup, and a lookup wants a table.

     A SENTINEL, LIKE `__stats`, AND FOR THE SAME REASON. Nothing here is a
     new measurement: every cell is read out of a panel this card already
     publishes, so the payload does not grow by one byte and no figure here
     can disagree with the panel it came from. The precedent is keyStats, one
     station up, which gathers eight headline figures the same way.

     JOINED ON THE DATE, NEVER ON THE INDEX. The overlay's rows are the
     sessions its price window shares with the score archive; the premium
     panel's rows are the sessions the archive holds at all. Those two windows
     are not the same length and need not start on the same day — an index zip
     would draw a plausible table out of two different calendars, which is the
     defect shared/flows-overlay.js exists to name. */
  function sessionLedger(host, _panel, card, question) {
    const { panelHead, quietPanel, emptyPanel, statList, isNum, el, money, px2, signed } = P;
    const panels = (card && card.panels) || {};
    const ovl = panels.scoreOverlay, prem = panels.premiumTrack;

    /* THE TWO SILENCES STAY APART. Neither panel is required — a card can
       carry price history with no archived premium, or the other way round —
       so the table draws on either, and only says nothing when it has
       neither. Which one is missing is stated, because "no sessions" and "no
       premium for these sessions" are different facts about the archive. */
    const ovlRows = ovl && ovl.status === "ok" && Array.isArray(ovl.rows) ? ovl.rows : [];
    const premRows = prem && prem.status === "ok" && Array.isArray(prem.rows) ? prem.rows : [];
    if (!ovlRows.length && !premRows.length) {
      return emptyPanel(host, question,
        ovl && ovl.status !== "ok" ? ovl
          : prem && prem.status !== "ok" ? prem
            : { status: "quiet", reason: "this card carries no dated session history" });
    }
    panelHead(host, question);

    const byDate = new Map();
    const take = (rows, fill) => {
      for (const r of rows) {
        const d = r && r.d;
        if (typeof d !== "string" || !d) continue;
        if (!byDate.has(d)) byDate.set(d, { d, close: null, score: null, p: null, source: null });
        fill(byDate.get(d), r);
      }
    };
    take(ovlRows, (row, r) => {
      row.close = isNum(r.close);
      row.score = isNum(r.score);
    });
    take(premRows, (row, r) => {
      row.p = isNum(r.p);
      row.source = typeof r.source === "string" ? r.source : null;
    });

    /* NEWEST FIRST, WHICH IS THE ONLY ORDER A LEDGER IS READ IN. The two
       charts run oldest-to-newest because a time axis does; a table is
       scanned from the top and the top is today. */
    const all = [...byDate.values()].sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    const rows = all.slice(0, LEDGER_MAX);

    /* THE SCORE MOVE IS DIFFERENCED HERE AND IT CARRIES ITS OWN GAP, because
       consecutive ROWS are not consecutive SCORED sessions: a name unscored
       for three days has three rows between its two readings, and a naive
       row-over-row subtraction would label a three-session move as an
       overnight one. Against the previous SCORED row, with the gap in the
       cell's title — the same rule the change layer states and the ranked
       rows on the landing page follow. */
    const scoredIdx = [];
    all.forEach((r, i) => { if (r.score !== null) scoredIdx.push(i); });
    const priorScored = new Map();
    for (let k = 1; k < scoredIdx.length; k++) {
      /* `all` is newest-first, so the PRIOR session is the NEXT index. */
      priorScored.set(scoredIdx[k - 1], scoredIdx[k]);
    }

    /* `fc-tablewrap` AND `fc-levels`, WHICH ARE THE SECTION'S TABLE, not a
       pair of classes invented here. Every other panel table on this page is
       built from those two — the first scrolls horizontally on a narrow
       viewport, the second carries the header rule, the cell padding and the
       numeric alignment — and the first draft of this one reached for
       `fc-scroll`/`fc-tbl`, neither of which exists in the stylesheet. It
       rendered with the header row set at heading size and the Close and
       Score columns run together with no gap: an unstyled table looks like a
       styling choice, which is why it survived a screenshot. */
    const wrap = el("div", "fc-tablewrap");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "This name session by session, newest first");
    wrap.tabIndex = 0;
    const table = el("table", "fc-levels ft-ledger");
    const thead = el("thead"), htr = el("tr");
    /* EVERY HEADER CARRIES WHAT ITS COLUMN IS, as the other panel tables do:
       a column called "Score" over a signed integer is two conventions a
       reader has to know — which scale, and measured against what. */
    for (const [label, cls, why] of [
      ["Session", null, "The trading session the row describes, newest first."],
      ["Close", "c-num", "The settled close for that session, from this card's own price window."],
      ["Score", "c-num",
        "The board's composite for that session, on a fixed −100 to +100 scale. " +
        "Not a return forecast."],
      ["Δ score", "c-num",
        "The move since this name's PREVIOUS SCORED session, which need not be the row " +
        "below: the span is in each cell's own title."],
      ["Net premium", "c-num",
        "Call premium minus put premium for that session, in dollars, as the board " +
        "published it that morning. The sign is the reading."],
    ]) {
      const th = el("th", cls, label);
      th.scope = "col";
      th.title = why;
      htr.append(th);
    }
    thead.append(htr);
    table.append(thead);

    const body = el("tbody");
    let drawn = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tr = el("tr");
      const d = el("td", "ft-ledger-d", r.d);
      /* A BOARD-ONLY SESSION IS MARKED, because its sparseness is a fact
         about the archive: those days carry only the names that made a board,
         so a gap beside one is more often a name that missed the board than a
         name nobody priced. */
      if (r.source === "boards") {
        const mark = el("span", "ft-ledger-src", "· board");
        mark.title = "Reconstructed from the archived boards for that session, which " +
          "carry only the names that made a board that day.";
        d.append(mark);
      }
      tr.append(d);
      tr.append(el("td", "c-num", r.close === null ? DASH : px2(r.close)));
      tr.append(el("td", "c-num" + P.polarity(r.score),
        r.score === null ? DASH : signed(r.score, (a) => String(a))));

      const iAll = all.indexOf(r);
      const pj = priorScored.has(iAll) ? priorScored.get(iAll) : null;
      const dCell = el("td", "c-num");
      if (r.score !== null && pj !== null && all[pj].score !== null) {
        const mv = r.score - all[pj].score;
        const gap = pj - iAll;
        dCell.className = "c-num" + P.polarity(mv);
        dCell.textContent = signed(mv, (a) => String(a));
        dCell.title = mv + " score points since " + all[pj].d + ", " +
          gap + (gap === 1 ? " session" : " sessions") + " earlier.";
      } else {
        dCell.textContent = DASH;
        dCell.title = r.score === null
          ? "This name was not scored on this session."
          : "No earlier scored session inside this window to measure against.";
      }
      tr.append(dCell);

      const pCell = el("td", "c-num" + P.polarity(r.p));
      pCell.textContent = r.p === null ? DASH : money(r.p);
      if (r.p === null) {
        pCell.title = "No archived net premium for this name on this session — which is " +
          "not the same as a session it was priced flat in.";
      }
      tr.append(pCell);
      body.append(tr);
      drawn++;
    }
    table.append(body);
    wrap.append(table);
    host.append(wrap);

    const priced = all.filter((r) => r.p !== null).length;
    const scored = all.filter((r) => r.score !== null).length;
    host.append(statList([
      ["Sessions held", String(all.length)],
      ["Scored", scored + " of " + all.length],
      ["Priced", priced + " of " + all.length],
    ]));

    /* THE POPULATION AND THE JOIN, OPEN. Both change what a row MEANS: a
       reader who does not know this is capped, or that the two columns come
       from two windows joined on the date, reads a different table. */
    const capped = all.length > drawn;
    host.append(el("p", "fc-note is-qualifier",
      "One row a session, newest first, over the window this card's price history and " +
      "the score archive between them cover" +
      (capped ? " — the newest " + drawn + " of " + all.length + " are drawn" : "") +
      ". Close and score come from the score-over-price panel and net premium from the " +
      "net-premium panel; the two are joined on the DATE, not by position, because the " +
      "two windows need not be the same length or start on the same day. A dash is a " +
      "session that column has no reading for, never a zero."));
  }

  function keyStats(host, _panel, card, question) {
    const { panelHead, statList, isNum } = P;
    panelHead(host, question);
    const panels = (card && card.panels) || {};

    /* A PANEL'S STATUS BECOMES A ROW'S SILENCE, using the same two words the
       rest of this file uses: `quiet` when the panel measured and had nothing
       to report, `unavailable` when it could not measure. The panel carries
       its own reason; this never writes one for it. */
    const silence = (p, what) => {
      if (!p) return ["unavailable", "The " + what + " panel is not on this card."];
      if (p.status === "quiet") return ["quiet", p.reason || "Measured, with nothing to report."];
      if (p.status === "pending") return ["pending", p.reason || "Not gathered yet."];
      return ["unavailable", p.reason || "The " + what + " panel could not be read."];
    };

    const money = (n) => "$" + n.toFixed(2);
    const pct1 = (n) => (n * 100).toFixed(1) + "%";
    /* THREE ARMS, NOT TWO, and tests/flows-sign.mjs caught this one as its own
       fixture — (n >= 0 ? "+" : MINUS) is verbatim the bad form that file
       lists. The reason is a reading, not a style: a wall sitting exactly AT
       spot measures distAtr === 0, and the two-armed form prints it +0.00 —
       a confident positive sign on a measured zero. Unsigned is the truth
       there: the wall is at spot, neither above it nor below. */
    const atrOf = (n) => (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(2) + " ATR";

    const pairs = [];
    const lv = panels.levels;
    const spot = lv ? isNum(lv.spot) : null;
    if (spot === null) {
      const [kind, why] = silence(lv, "levels");
      pairs.push(["Spot", DASH, null, kind, why]);
    } else {
      pairs.push(["Spot", money(spot)]);
    }

    /* THE ATR IS THE UNIT THE DISTANCES BELOW ARE IN, so it is stated before
       them rather than left for a reader to find in another panel's note. */
    const atr = isNum(card && card.atr);
    if (atr === null) {
      pairs.push(["ATR", DASH, null, "unavailable",
        "This card publishes no ATR, so the distances below are in percent only."]);
    } else {
      pairs.push(["ATR", money(atr)]);
    }

    /* THE THREE WALLS, each with its distance in ATR — the unit that compares
       across names, where a percentage does not: 2% is a long way on a quiet
       name and nothing on a volatile one. */
    const rows = (lv && Array.isArray(lv.levels)) ? lv.levels : null;
    for (const [kind, label] of [["max_pain", "Max pain"], ["put_wall", "Put wall"], ["call_wall", "Call wall"]]) {
      const row = rows ? rows.find((r) => r && r.kind === kind) : null;
      const px = row ? isNum(row.px) : null;
      const dist = row ? isNum(row.distAtr) : null;
      if (px === null) {
        const [k, why] = silence(lv, "levels");
        pairs.push([label, DASH, null, k, why]);
      } else {
        pairs.push([label, money(px) + (dist === null ? "" : " · " + atrOf(dist))]);
      }
    }

    /* THE FLIP, AND ITS OWN PANEL'S REASON FOR NOT HAVING ONE. */
    const flip = isNum(card && card.gammaFlip);
    if (flip === null) {
      const gm = panels.gamma;
      if (gm && gm.status && gm.status !== "ok") {
        const [k, why] = silence(gm, "gamma");
        pairs.push(["Gamma flip", DASH, null, k, why]);
      } else {
        pairs.push(["Gamma flip", DASH, null, "quiet",
          "Net gamma does not change sign materially inside the drawn band, so " +
          "no flip level is published for this name."]);
      }
    } else {
      pairs.push(["Gamma flip", money(flip)]);
    }

    const pm = panels.pricedMove;
    const move = pm ? isNum(pm.movePerc) : null;
    if (move === null) {
      const [k, why] = silence(pm, "priced move");
      pairs.push(["Priced move", DASH, null, k, why]);
    } else {
      pairs.push(["Priced move", "±" + pct1(move)]);
    }

    /* THE RANK, ITS UNIT AND ITS DATE. The unit is the payload's own
       rankUnit — this block does not decide that a rank is a percentage. */
    const vc = panels.volContext;
    const ir = vc && vc.ivRank;
    let latest = null;
    if (ir && Array.isArray(ir.rows)) {
      for (const r of ir.rows) {
        if (!r || isNum(r.rank1y) === null || !r.date) continue;
        if (!latest || String(r.date) > String(latest.date)) latest = r;
      }
    }
    if (!latest) {
      const [k, why] = silence(ir || vc, "implied-volatility rank");
      pairs.push(["IV rank", DASH, null, k, why]);
    } else {
      const unit = typeof ir.rankUnit === "string" && /percent/i.test(ir.rankUnit) ? "%" : "";
      pairs.push(["IV rank", isNum(latest.rank1y).toFixed(1) + unit +
        " · " + String(latest.date)]);
    }

    host.append(statList(pairs));
  }

  /* A STRING IS A DEFERRED DRAWER, A FUNCTION IS ONE THAT IS ALREADY HERE.
     The nine library drawers below now arrive from assets/js/flows-drawers.js
     after a fetch, so naming them by registry key rather than capturing
     `P.gamma` at module load is what makes the table survive being built
     before they register. `drawerFor` resolves a string against the registry
     at CALL time, which is the only time the answer is knowable.

     THE TWO THAT STAY FUNCTIONS ARE NOT AN EXCEPTION TO THE RULE, they are
     the two the default station needs: `scoreOverlay` and `__score` draw the
     signal station a reader lands on, and flows-panels.js keeps both so that
     first paint owes nothing to the network. */
  const DRAW = {
    gamma: "gamma",
    aggressor: drawAggressor,
    ivSurface: drawIvSurface,
    skewTerm: drawSkewTerm,
    topContracts: drawTopContracts,
    levels: "levels",
    surface: "surface",
    displacement: "displacement",
    calendar: "calendar",
    pricedMove: "pricedMove",
    path: "path",
    premiumTrack: "premiumTrack",
    context: "context",
    congress: "congress",
    marketRank: drawMarketRank,
    darkpool: drawDarkpool,
    oiDeltas: drawOiDeltas,
    volContext: drawVolContext,
    scoreOverlay: P.overlay,
    deltaExposure: "deltaExposure",
    charm: "charm",
    vanna: "vanna",
    /* THE TWO SENTINELS, IN THE SAME TABLE AND UNDER THE SAME CALL SHAPE.
       `__score` used to sit here as `null` beside an `if (key === "__score")`
       branch in each of the two walks below — a table entry that was not a
       drawer, and a hard-coded key in two places the second sentinel would
       have had to be added to in both, correctly, or draw nothing. Both are
       ordinary drawers now and ignore the `panel` argument, having no
       card.panels entry. WHICH keys are sentinels is not restated here: the
       emitter marks those sections data-sentinel and the walks read it off
       the DOM, as they read the question. */
    __score: (host, panel, card, question) => P.score(host, card, question),
    __stats: keyStats,
    __sessions: sessionLedger,
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
  /* WHICH STATIONS HAVE BEEN DRAWN, so a switch draws once and a re-switch
     draws nothing. Cleared on every new card, because the panels then hold the
     previous name's readings. */
  const drawnStations = new Map();

  /**
   * Draw the panels of one station, or of the whole grid.
   *
   * IT STAYS SYNCHRONOUS, AND THAT IS NOT AN OVERSIGHT. The drawers this walk
   * may need are fetched by `loadDrawersFor` BEFORE it is called, because
   * `withAllStations` re-hides the stations it revealed in a `finally` — so an
   * async walk would return at its first await, the stations would be hidden
   * again, and every chart after that point would measure its width inside a
   * box with no layout. The fetch is the caller's job; the drawing is this
   * function's, and it happens in one synchronous pass with every station in
   * flow.
   *
   * @param {string|null} only — a station's data-group, or null for the grid.
   */
  function panelSections(only) {
    return [...(only
      ? grid.querySelectorAll('.ft-station[data-group="' + only + '"] .ft-panel[data-panel]')
      : grid.querySelectorAll(".ft-panel[data-panel]"))];
  }

  /**
   * Fetch the deferred library if these sections need it, and never otherwise.
   *
   * A FAILED FETCH IS NOT A THROWN PAGE. `need()` rejects if the asset does not
   * load, and the catch is deliberate: the walk already has a branch for a key
   * with no registered drawer, and that branch says so panel by panel — a
   * better answer than an exception that takes the station down with it.
   */
  async function loadDrawersFor(sections) {
    if (!sections.some((s) => typeof DRAW[s.dataset.panel] === "string")) return;
    try { await P.need(); } catch { /* the walk reports it panel by panel */ }
  }

  function drawAll(card, mount, only) {
    const missing = [];
    for (const section of panelSections(only)) {
      const key = section.dataset.panel;
      const question = section.dataset.question || "";
      const host = section.querySelector("div");
      /* NEVER `if (!host) return`. A host that has gone missing is a markup
         defect, and skipping it silently is how a panel disappears from a
         page for a release without anyone noticing. */
      if (!host) { missing.push(key); continue; }

      const entry = DRAW[key];
      const drawer = typeof entry === "string" ? P[entry] : entry;
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
         and each absence is dated by its own wave.

         A FOURTH ABSENCE IS NOT AN ABSENCE AT ALL. A sentinel has no
         card.panels entry on ANY card, however new — `__score` reads the
         card's top level and `__stats` reads the other panels — so this branch
         would tell a reader that a card published this morning "predates" a
         panel no payload carries. data-sentinel comes from the one registry,
         so no list of keys is kept in this file. */
      if (panel === undefined && !section.hasAttribute("data-sentinel")) {
        deadPanel(host, question, predatesSentence(key));
        continue;
      }

      /* ONE CALL SHAPE FOR EVERY DRAWER: unused arguments are discarded, so
         the widest signature is safe for all and no per-panel shape table has
         to be kept in step. SAFE ONLY WHILE EVERY DRAWER DECLARES THAT ORDER,
         and one did not: renderOverlay was `(host, join, questionIn)`, so
         `card` landed in the question slot and "Score over price" headed
         itself "[object Object]" on every ticker page. The fix is its
         signature — a table here would be a second list of what the renderers
         already declare. */
      try {
        drawer(host, panel, card, question, mount);
      } catch (error) {
        deadPanel(host, question, drawFailed(error));
      }
    }
    /* THE AFFORDANCE SWEEP, ONCE, AFTER EVERY PANEL HAS DRAWN. A second walk
       rather than a call inside the first: that loop leaves by four different
       `continue`s, and a marker applied on only some of those paths is a
       marker a reader learns to distrust. Reading the DOM back is what keeps
       it honest — it marks what a renderer ACTUALLY emitted, so a tooltip
       added tomorrow is marked tomorrow. */
    /* THE SWEEPS STAY GRID-WIDE even when the draw was one station. Both read
       the DOM back rather than the payload, so running them over the whole
       grid after a partial draw marks what has actually been drawn and leaves
       the rest exactly as it was — and writeStationLeads counts silences off
       the same DOM, so a station that has not drawn yet keeps the empty lead
       its `:empty` rule already hides. */
    for (const section of grid.querySelectorAll(".ft-panel[data-panel] > div")) {
      markExplained(section);
    }
    writePanelLeads(card);
    writeStationLeads();
    if (missing.length) {
      console.error("flows-ticker: no drawing host for panel(s): " + missing.join(", "));
    }
  }

  /* ---------- the served slots, filled -------------------------------

     `.ft-panel-one` is served on all 23 panels and `.ft-station-lead` on all
     five stations. Both are styled, both guarded with `:empty{display:none}`,
     both asserted by the contract suite — and until now NOTHING WROTE TO
     EITHER. Their own comment in flows.css read "PR 4's one-line answer. Empty
     until then", and PR 4 shipped something else. Twenty-eight slots the
     design reserved and never filled.

     THE STATION LINES LAND FIRST, AND THE PANEL SLOTS DO NOT, BECAUSE THE
     SUITE REFUSED THE OBVIOUS IMPLEMENTATION TWICE AND WAS RIGHT BOTH TIMES.

     The obvious one: a panel already writes its finding as
     `.fc-reading.is-lead` at the top of its drawing, so lift that sentence
     into the slot. It fails, and the failures name the reason. skewTerm leads
     on TWO readings kept deliberately separate (a withheld skew beside a
     published term has to stay digit-free, and the suite scopes that check to
     the FIRST `.fc-reading`); ivSurface is asserted to lead "on exactly one
     reading" IN ITS DRAWING, and lifting takes that count to zero.

     Reading those two failures together says something better than either: the
     slot sits IMMEDIATELY ABOVE the drawing, so moving a sentence from the top
     of the drawing into it changes nothing a reader can see, while breaking
     invariants that encode real rules about where a panel's finding lives. A
     copy would be worse — one claim in two places, free to drift.

     So the rule this change establishes is: EVERY PANEL LEADS EXACTLY ONCE,
     and the slot is for the panels that do not lead in their drawing at all.
     Nineteen of the twenty-three are in that group, and each needs a one-line
     answer authored from its own payload rather than lifted from somewhere it
     already exists. That is the next change, not this one. This one ships the
     five station lines, which carry information no panel holds and therefore
     duplicate nothing. */

  /* The panel's one-line answer, PRINTED and never composed. `panel.lead` is
     `{ say, n }`; shared/flows-card.js builds it where CPU is free and carries
     the whole argument, including why every numeral in `say` is pinned in `n`. */
  function writePanelLeads(card) {
    const panels = (card && card.panels) || {};
    for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
      const slot = section.querySelector(":scope > .ft-panel-one");
      if (!slot) continue;
      /* CLEARED FIRST, on every card. A slot holding the previous name's
         reading under this name's heading is the worst failure this page has. */
      slot.textContent = "";
      const panel = panels[section.dataset.panel];
      const said = panel && panel.lead && typeof panel.lead.say === "string"
        ? panel.lead.say.trim() : "";
      if (said) slot.textContent = said;
    }
  }

  /* The station's own line: what its panels came back with, counted.

     NOT A FIFTH COPY OF A PANEL'S SENTENCE. Repeating the lead panel's reading
     under the heading would put one claim in two places on one screen, and the
     station heading already carries the group's question. This answers the one
     thing no panel can: WHAT IS MISSING HERE, before a reader scrolls through
     six boxes to find out. It is counted off the DOM the renderers actually
     emitted rather than off the payload, so a panel that draws nothing is
     counted as silent however it came to be silent.

     THE FOUR SILENCES ARE NOT COLLAPSED. `data-empty` carries the kind —
     `unavailable` for a source that did not return, `quiet` for one that
     answered and measured nothing — and the two are counted and named
     separately, because a reader deciding whether to trust a thin station
     needs to know which it is. A panel a card predates is neither: it is a
     panel this payload has never carried, and it says so in its own words. */
  function writeStationLeads() {
    for (const station of grid.querySelectorAll(".ft-station[data-group]")) {
      const slot = station.querySelector(":scope > .ft-station-lead");
      if (!slot) continue;
      slot.textContent = "";
      const panels = [...station.querySelectorAll(":scope > .ft-panel[data-panel]")];
      if (!panels.length) continue;
      let unavailable = 0;
      let quiet = 0;
      let read = 0;
      for (const panel of panels) {
        const host = panel.querySelector(":scope > div");
        if (!host) continue;
        const empty = host.querySelector("[data-empty]");
        const kind = empty && empty.getAttribute("data-empty");
        if (kind === "unavailable") unavailable++;
        else if (kind === "quiet") quiet++;
        else read++;
      }
      /* A COUNT WITH NO DENOMINATOR IS NOT A COUNT. "two withheld" says
         nothing about whether the station is thin or ordinary; "two of six"
         does. */
      const parts = [`${read} of ${panels.length} drawn`];
      if (unavailable) {
        parts.push(`${unavailable} withheld — the source did not return`);
      }
      if (quiet) {
        parts.push(`${quiet} quiet — the source answered and measured nothing`);
      }
      slot.textContent = parts.join("; ") + ".";
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
       element leaves clientWidth at 0 in the same tick, so ftWidth returns
       its unmeasurable-host 560 and the ENLARGED panel is drawn at a width
       the dialog does not have, then squeezed to fit it. */
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
    /* THROUGH THE SAME RESOLUTION AS THE GRID WALK, because DRAW now holds a
       STRING for every deferred drawer and calling one would throw. The dialog
       never has to fetch: it opens from a panel that is already drawn, and a
       panel is only drawn once its station's drawers have registered. */
    const zoomEntry = DRAW[zoomKey];
    const drawer = typeof zoomEntry === "string" ? P[zoomEntry] : zoomEntry;
    const panel = painted.panels && painted.panels[zoomKey];
    if (typeof drawer !== "function") {
      deadPanel(zoomHost, question, "no renderer is registered for this panel.");
      return;
    }
    /* THE SAME SENTINEL TEST THE GRID WALK MAKES, off the same attribute on
       the same section. It was an `if (zoomKey === "__score")` branch above,
       which drew the derivation correctly and would have told a reader
       enlarging the key statistics that their card predates it. */
    if (panel === undefined && !(section && section.hasAttribute("data-sentinel"))) {
      deadPanel(zoomHost, question, predatesSentence(zoomKey));
      return;
    }
    try { drawer(zoomHost, panel, painted, question, "zoom"); }
    catch (error) { deadPanel(zoomHost, question, drawFailed(error)); }
    /* THE ENLARGED COPY IS THE COPY A READER IS LOOKING HARDEST AT, so it
       gets the same marks and the same decoder. Skipping it here would make
       the affordance a property of the grid rather than of the panel. */
    markExplained(zoomHost);
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
      /* REDRAWS ONLY WHAT IS DRAWN. A resize must not fetch the library for
         stations the reader has never opened — they will measure the new
         width when they are first drawn, because they have not been drawn at
         all yet. */
      for (const key of [...drawnStations.keys()]) {
        withAllStations(() => { drawAll(painted, "grid", key === ALL_STATIONS ? null : key); });
      }
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
  /* Mirrored from flows-ui.js:155 — the shape the publisher validates on the
     way out, and the gate the parse below sits behind. This page cannot call
     the shared function: shared/flows-pages.js:1308 serves it flows-panels.js
     and flows-ticker.js and no third file, and the route is already 445k
     against the 470k ceiling tests/flows-weight.mjs enforces. So it is aligned
     here the way assets/js/flows-market.js:216 aligned its own copy, and the
     alignment is named so a future reader knows which file is the original. */
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  /* TWO INDEPENDENT TESTS, because a card can be freshly WRITTEN from a stale
     SESSION: the pipeline runs, the vendor is behind, and the payload lands
     with today's timestamp and Friday's numbers. Either fires the band. */
  function assessAge(card) {
    const now = Date.now();
    const parts = [];

    /* A NON-POSITIVE STAMP IS AN ABSENT ONE, normalised once here rather than
       tested at each use. isNum(0) is 0, not null, so the bare `written !==
       null` this carried let a stamp of 0 — the epoch — through the age test
       and dated a card built minutes ago to more than fifty-six years back.
       worker.js:1224 does emit exactly that zero, as
       `String(stored.updatedAt || 0)`, and getJSON at flows-ticker.js:4772
       catches it with `Number(header) || null`. But that guard holds only for
       the values `||` treats as false: any other non-positive stamp — a
       negative one out of a skewed clock or a sentinel column — passes
       straight through it and lands here. A second line of defence that works
       only while the first holds is not one, and this one did not even cover
       the same set. The shape assets/js/flows-ui.js:216 fixed and
       flows-market.js:234 mirrored. */
    const stamped = isNum(card.__updatedAt);
    const written = stamped !== null && stamped > 0 ? stamped : null;
    if (written !== null && now - written > STALE_WRITE_MS) {
      const hours = Math.floor((now - written) / 3600000);
      const days = Math.floor(hours / 24);
      /* DAYS ONCE THERE ARE DAYS, because every other Flows surface says
         "3 days ago" where this said "83 hours ago" — one product, two
         units for one quantity. The hour branch cannot fire while the
         threshold is 30 hours; it is here so that lowering the threshold can
         never start printing "0 days", a confident zero wearing a unit. */
      const age = days >= 1
        ? days + (days === 1 ? " day" : " days")
        : hours + (hours === 1 ? " hour" : " hours");
      parts.push("this card was last written " + age + " ago");
    }

    /* THE SHAPE IS CHECKED BEFORE THE PARSE, because Date.parse is lenient
       enough to be dangerous: a truncated "YYYY-MM" plus the suffix comes back
       FINITE in V8 and dates the card to the first of that month, raising
       "it reports the session of 2026-09" over numbers written minutes ago.
       A string that parses is not a date that was measured.

       AND 21:00Z, NOT MIDNIGHT. 21:00Z is after every US close, so a session
       date is aged from the end of its own session rather than from its
       midnight. Aging from midnight called a session stale up to 21 hours
       before flows-ui.js:255 and flows-history.js:664 did — the deepest
       per-name surface in the product disagreeing with every page a reader
       could have reached it from. */
    let session = null;
    if (ISO_DAY.test(String(card.sessionDate || ""))) {
      const parsed = Date.parse(String(card.sessionDate) + "T21:00:00Z");
      if (Number.isFinite(parsed)) session = parsed;
    }
    if (session !== null && now - session > STALE_SESSION_MS) {
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

     THE PAGE WAS TWENTY-ONE PANELS IN A FLAT SCROLL, measured at
     5,729px pinned and 7,185px gapless (recorded in flows.css beside
     the tier that produced them): five to seven screens of
     near-identical headings, no table of contents, no group
     boundaries, and no way to send a colleague one of them. The
     identity block scrolled away after the first panel, taking the
     name, the score and the session date with it, and nothing said
     what the number had DONE — a product read as an early warning,
     opening on a snapshot.

     FOUR THINGS WERE ADDED HERE AND NOT ONE OF THEM HID ANYTHING:

       1. a sticky bar carrying the identity and the jump strip,
       2. group headings inside the grid, from the registry,
       3. chrome tiers, so a two-number panel and a fifty-row table
          stop wearing the same box,
       4. a change block above the fold, derived from the score
          overlay the card already carries.

     TWO OF THOSE FOUR ARE NOT BUILT HERE ANY MORE. The bar and the
     headings are served — five <section class="ft-station"> wrappers
     carrying their counts and questions, from the registry this file
     used to rebuild them from — so the page is readable before a card.

     AND THE CASE AGAINST HIDING HAS BEEN RE-ARGUED, NOT DELETED. It
     read: "an index that hid twenty panels to make one findable
     would trade a scroll for a search, and the scroll is cheaper."
     Measured, it is not: 23 panels of one session is five to seven
     screens of near-identical headings, and a reader off a board row
     wants one station. The unit hidden is the STATION — a named
     group of stated size, addressable as `?s=` — never a panel, and
     `grid-auto-flow: dense` is still refused, so DOM order stays tab
     order. NOTHING IS HIDDEN HERE: every station is visible.

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
   * A SECOND COPY THAT IS NOW ONLY A CHECK. `shared/` is in .assetsignore and
   * is never served, so a browser cannot import shared/flows-panels.js.
   * This table used to be how the page got its groups: mountChrome read it and
   * WROTE both attributes onto every section on first paint. The worker emits
   * them from the registry now, so what is left is a second opinion, and
   * mountChrome's job is to say when the two disagree. Pinned the way DRAW is:
   * the suite reads the registry, this table out of the source AND the mounted
   * DOM, and asserts all three agree both directions. A duplicate a test
   * compares is a projection; one it cannot see is a drift.
   *
   * THE FIVE GROUP LABELS AND BLURBS ARE NOT HERE ANY MORE — they had to be
   * built in the browser when headings were inserted between panels. The
   * stations are served with their headings inside them, so those five
   * sentences exist once, in shared/flows-panels.js, and all this file needs
   * to know is which group a section belongs to, which the section says.
   */
  const PANEL_CHROME = {
    scoreOverlay: { group: "signal", tier: "lead" },
    __score: { group: "signal", tier: "table" },
    __stats: { group: "signal", tier: "table" },
    __sessions: { group: "tape", tier: "table" },
    gamma: { group: "convexity", tier: "lead" },
    levels: { group: "convexity", tier: "reading" },
    displacement: { group: "convexity", tier: "reading" },
    surface: { group: "convexity", tier: "chart" },
    calendar: { group: "convexity", tier: "chart" },
    deltaExposure: { group: "convexity", tier: "chart" },
    charm: { group: "convexity", tier: "chart" },
    vanna: { group: "convexity", tier: "chart" },
    ivSurface: { group: "volatility", tier: "lead" },
    skewTerm: { group: "volatility", tier: "chart" },
    pricedMove: { group: "volatility", tier: "reading" },
    volContext: { group: "volatility", tier: "chart" },
    aggressor: { group: "tape", tier: "lead" },
    path: { group: "tape", tier: "chart" },
    premiumTrack: { group: "tape", tier: "chart" },
    topContracts: { group: "tape", tier: "table" },
    darkpool: { group: "tape", tier: "table" },
    oiDeltas: { group: "tape", tier: "table" },
    context: { group: "context", tier: "chart" },
    marketRank: { group: "context", tier: "lead" },
    congress: { group: "context", tier: "table" },
  };

  /* THE CHROME'S RULES ARE IN assets/css/flows.css, under "the workspace
     chrome" at the foot of the ticker section — not injected from here as a
     template literal, which is what they were. An injected sheet is never
     fetched, so no ?v= reaches it and a reader can hold new markup against
     cached rules; no CSS suite can see it, tests/flows-sign.mjs's polarity
     check included; and it is JavaScript bytes on the route
     tests/flows-weight.mjs weighs, parsed before a panel draws. The dead-rule
     risk that move creates is covered by tests/flows-ticker-contract.mjs,
     which mounts this controller against both stylesheets. */

  /* ---------- the sticky bar the worker serves ---------------------- */

  let barEl = null;
  let changeEl = null;

  /**
   * Take over the served sticky bar, and move the identity block into it.
   *
   * THE BAR IS NO LONGER BUILT HERE. It was: five jump chips and a <details>
   * of all 22 panel names, rebuilt from a copy of a registry the browser
   * cannot import, and none of it existing until a card had been fetched and
   * painted. The worker serves the bar, the tab row and the counts now.
   *
   * WHAT IS LEFT IS THE HEADER, MOVED AND NOT REBUILT. `#ftHead` and its ids
   * are emitted by the page and written by paintIdentity(); re-creating them
   * here would be a second markup for one block — the defect the registry
   * exists to prevent, one level up. It is
   * re-parented in as the bar's FIRST child so the two stick together — an
   * identity that stays while its index scrolls away is half a fix.
   */
  function buildBar() {
    if (!headEl || barEl) return;
    barEl = $("ftBar");
    /* NO FALLBACK THAT BUILDS ONE. A missing #ftBar means this controller is
       running against markup that did not come from tickerPage(), and the
       honest outcome is a page with no sticky bar rather than a second bar
       shape only this branch can produce and no test ever renders. */
    if (!barEl) return;
    barEl.insertBefore(headEl, barEl.firstChild);

    changeEl = el("section", "ft-change");
    changeEl.id = "ftChange";
    changeEl.hidden = true;
    changeEl.setAttribute("aria-labelledby", "ftChangeH");
    /* AFTER THE CARDS, NOT IMMEDIATELY AFTER THE BAR. The bar moved above the
       six cards to keep the station tabs inside a phone's first screen (see
       the note beside #ftBar in shared/flows-pages.js), and this insertion
       had been written against the old order: anchored to the bar, it landed
       BETWEEN the identity and the session's figures, so on a 320px page the
       cards were 851px of prose below the header they belong to.

       Anchored to the cards instead, the order reads the way the design lays
       it out — identity, navigation, this session's figures, then what
       changed. The bar stays the fallback: a card that publishes no figure at
       all leaves #ftCards hidden, and inserting after a hidden element still
       puts this region exactly where it used to be. */
    /* AFTER THE CHART-AND-CHAIN ROW, NOT BETWEEN THE FIGURES AND IT.

       The design goes figures, then the series beside the book, with
       nothing in between; this block landed in that gap and pushed the row
       it introduces most of a viewport down. It belongs under them — it is
       what changed SINCE the session those two draw, so it reads after
       them. Falls back to the cards and then to the bar, so the insertion
       survives either block being absent. */
    const after = document.querySelector(".ft-top") || $("ftCards") || barEl;
    after.parentNode.insertBefore(changeEl, after.nextSibling);
  }

  /**
   * Check the served chrome against this file's copy of it.
   *
   * IT USED TO WRITE THE ANSWER IT NOW CHECKS, so a stale PANEL_CHROME entry
   * did not fail, it SHIPPED — the panel mounted in the wrong section wearing
   * the wrong chrome. It only reports now: a controller that rewrote the
   * served markup to match itself would restore that failure with an extra
   * step.
   */
  function mountChrome() {
    const wrong = [];
    const seen = new Set();
    for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
      const key = section.dataset.panel;
      seen.add(key);
      const chrome = PANEL_CHROME[key];
      if (!chrome) {
        wrong.push(key + ": served, but this file has no chrome entry for it");
        continue;
      }
      if (section.dataset.group !== chrome.group || section.dataset.tier !== chrome.tier) {
        wrong.push(key + ": served as " + section.dataset.group + "/" +
          section.dataset.tier + ", this file says " + chrome.group + "/" + chrome.tier);
      }
    }
    for (const key in PANEL_CHROME) {
      if (!seen.has(key)) wrong.push(key + ": in this file's chrome table, not on the page");
    }
    if (wrong.length) {
      console.error("flows-ticker: the served panel chrome and this file disagree — " +
        wrong.join("; "));
    }
  }

  /* The sticky bar's own height, written back so an anchor lands BELOW it
     rather than under it. Measured rather than assumed: the identity row
     wraps at three different widths and the strip scrolls rather than
     wrapping, so no constant is right at more than one viewport.

     AND MEASURED AGAIN WHEN THE WEBFONT LANDS, ONCE. The row wraps at a
     different count under the fallback face, so the height taken at first
     paint is 42px SHORT of the bar the reader ends up under — the suite reads
     147 written against a 189px bar — and every panel's scroll-margin-top is
     built from it. The resize handler cannot catch it: it returns early unless
     innerWidth moved, and a font swap moves none. THE VALUE ONLY, never the
     jump: honourHash can fire before the grid is shown, where its target has
     no box, and re-running it there settled the page at 178px. */
  let fontsArmed = !!(document.fonts && document.fonts.ready);
  function syncBarHeight() {
    if (!barEl || barEl.hidden) return;
    const h = Math.round(barEl.getBoundingClientRect().height);
    if (h > 0) grid.style.setProperty("--ft-bar-h", h + "px");
    if (fontsArmed) {
      fontsArmed = false;
      document.fonts.ready.then(() => { syncBarHeight(); });
    }
  }

  /* AND WHENEVER THE BAR CHANGES SIZE, which holds without knowing WHY.

     Seven hand-driven calls are a guess about every way a sticky bar can
     rewrap, and the guess was wrong: clipping the station blurb out of flow
     made the bar shorter and CI landed a deep-linked panel 17px under it
     (201 against 218). This sandbox cannot reproduce that — barH and
     --ft-bar-h agree at 148 here with or without the webfont — so the fix is
     not a better guess at the missing call site. The observer measures
     because it changed. The hand calls stay for the first paint. */
  if (typeof ResizeObserver === "function") {
    const settle = new ResizeObserver(() => {
      syncBarHeight();
      reHonourJump();
    });
    if (barEl) settle.observe(barEl);
    /* AND THE GRID, WHICH IS WHERE THE DEFECT ACTUALLY WAS.

       Observing the bar alone was a fix for a cause I had inferred from one
       number and never measured. Measured, with the failing case reproduced:

         panel top 172.2, bar bottom 217.7, --ft-bar-h 147px,
         scroll-margin-top 227px, scrollY 9481

       The variable was RIGHT and the scroll margin was RIGHT. The panel was
       simply 55px higher than the margin it had been scrolled to — so nothing
       about the bar was ever wrong, and every byte spent on measuring the bar
       harder could not have moved that panel. What happened is that content
       ABOVE the target reflowed after the jump and pulled it up underneath a
       scrollY that stayed put. A bar that does not change size reports
       nothing while that happens.

       The grid's own height changes whenever any panel inside it reflows,
       which is the one signal that covers every cause without enumerating
       them — the same argument the bar observer makes, finally pointed at the
       right element. */
    if (grid) settle.observe(grid);
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

  /* THE JUMP IS REDONE WHEN THE BAR IT CLEARED CHANGES HEIGHT.

     Updating --ft-bar-h is not enough on its own, and CI proved it twice:
     `scroll-margin-top` is read by the browser AT SCROLL TIME and never
     again, so a bar that rewraps AFTER the scroll leaves the reader at an
     offset computed against a height that no longer exists. The measurement
     from the failing run says exactly that and nothing else: the panel sat at
     172 against a bar ending at 218, and 172 is 4.4rem + 5.5rem + 0.6rem to
     the pixel — the STYLESHEET's placeholder height, one unwrapped row of
     tabs in the fallback face. The webfont then swapped, the tab row wrapped,
     the bar went from 92 to 148, and nothing moved the page.

     ONLY FOR A READER WHO HAS NOT MOVED. `jumped.y` is where the jump left
     the page; a scrollY that has since changed by more than a pixel of
     rounding means the reader is somewhere they chose, and yanking them back
     to an anchor they have already scrolled past would be the worse bug. The
     re-jump clears the record either way, so this fires once per jump. */
  let jumped = null;
  function reHonourJump() {
    if (!jumped) return;
    const { target, y } = jumped;
    jumped = null;
    if (!target.isConnected) return;
    if (Math.abs(Math.round(window.scrollY) - y) > 1) return;
    target.scrollIntoView({ block: "start" });
    jumped = { target, y: Math.round(window.scrollY) };
  }

  function honourHash() {
    const target = hashTarget();
    if (!target) return;
    /* THE STATION BEFORE THE PANEL. A link to panel 14 is a link to the station
       that holds it; scrolling to an element inside a hidden station scrolls to
       something with no box, which is how a deep link becomes a no-op. */
    const group = target.dataset ? target.dataset.group : null;
    if (group && station !== ALL_STATIONS && station !== group) {
      showStation(group, { url: true, push: false });
    }
    syncBarHeight();
    target.scrollIntoView({ block: "start" });
    /* WHERE THE JUMP PUT US, so a later re-measure can tell a bar that grew
       under a settled reader from a reader who has scrolled away. */
    jumped = { target, y: Math.round(window.scrollY) };
    /* FOCUS FOLLOWS THE JUMP, or a keyboard reader lands visually on panel 14
       and carries on tabbing from panel 1. */
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    markCurrentGroup(target.dataset ? target.dataset.group : null);
  }

  /* MATCHED ON data-group, NOT ON THE href. The chips were built here from a
     local copy of the group list, so "which chip is this group's" meant
     rebuilding the hash and comparing strings. Each served tab carries the
     group it opens, so the comparison is between two values of one field and
     a change to the hash scheme cannot silently stop marking anything. */
  function markCurrentGroup(group) {
    if (!barEl) return;
    for (const a of barEl.querySelectorAll(".ft-tab[data-group]")) {
      if (group && a.dataset.group === group) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  }

  /* ---------- the station switcher ----------------------------------

     FIVE STATIONS, ONE ON SCREEN. PR 2 served the stations and a tab row, but
     the tabs were anchors into one continuous scroll: the page measured
     11,468px at 1440 and 19,978px at 390, and clicking Convexity moved the
     reader four thousand pixels with the other four stations still stacked
     underneath. Twenty-three panels read top to bottom or not at all is not a
     reader, it is a report. The tabs now SWITCH — the station asked for is the
     only one in the document's flow.

     THE STATION IS NOT WHAT DECIDES A CHART'S WIDTH, which is the whole reason
     this is safe. Stations are full-width block siblings inside .ft-grid, so
     hiding four changes the page's height and nothing about the fifth's width,
     and every chart is still measured with all five in flow — at boot because
     the selection is applied after drawAll, on a resize because withAllStations
     puts them back for the draw. A panel drawn inside a hidden station would
     measure a host width of 0, so that is a guarantee, not a bet.

     ALL IS A STATION TOO. Hiding four fifths of a page takes find-in-page and
     printing away from a reader who had them, so `?s=all` puts every station
     back, the All link addresses it, and print reveals everything whatever is
     selected. */
  const ALL_STATIONS = "all";
  let station = null;

  const stationEls = () => grid.querySelectorAll(".ft-station[data-group]");

  function stationKeys() {
    const keys = [];
    for (const s of stationEls()) if (s.dataset.group) keys.push(s.dataset.group);
    return keys;
  }

  /* Revealing them for a draw costs one layout on a resize. */
  function withAllStations(fn) {
    const put = [];
    for (const s of stationEls()) if (s.hidden) { put.push(s); s.hidden = false; }
    try { return fn(); } finally { for (const s of put) s.hidden = true; }
  }

  /* AN UNKNOWN STATION IS NOT OBEYED. A reader who edits ?s= to something no
     station answers to gets the first station, not a page with all five
     hidden — and the URL is rewritten to say which one they are looking at. */
  function wantedStation() {
    const keys = stationKeys();
    if (!keys.length) return null;
    let asked = "";
    try { asked = new URL(location.href).searchParams.get("s") || ""; } catch { asked = ""; }
    if (asked === ALL_STATIONS || keys.indexOf(asked) !== -1) return asked;
    /* A HASH IS AN ADDRESS TOO, and every link already sent is one: it names a
       panel or a heading, and the station that holds it is the one to open. */
    const target = hashTarget();
    const group = target && target.dataset ? target.dataset.group : null;
    if (group && keys.indexOf(group) !== -1) return group;
    /* THE DEFAULT IS ALL TWENTY-THREE, NOT THE FIRST THREE.

       Opening on one station was the right answer to a real measurement: 23
       panels stacked in a one- and two-column grid measured 11,468px at 1440
       and 19,978px at 390, and clicking a tab moved the reader four thousand
       pixels with the other four stations still underneath. But the fix for a
       column count was made in the station selector, and it has been paying
       for that ever since — the landing view is three panels, two of which
       used to span the whole row, which is a page of bands rather than a
       board of cards.

       The grid is what changed: three columns at 76rem, four at 110, five at
       132, and NO panel spans a full row at any width. Twenty-three cards
       across three-to-five columns is eight rows, not twenty-three, and it is
       the thing the reader of this page has asked for in every message — many
       small cards, seen at once, without scrolling to find them.

       THE TABS DO NOT GO AWAY. They still narrow to one station, they still
       write ?s= , and every link already sent still opens the station it
       names. What changed is only which view a reader who asked for nothing
       gets, and the reason the old default existed no longer holds. */
    return ALL_STATIONS;
  }

  /* A CLICK IS AN ACT AND A SCROLL IS NOT. pushState so Back returns the reader
     to the station they came from; everything else replaces, because a history
     entry per station scrolled past would make Back mean nothing at all. */
  function writeStation(key, push) {
    let url;
    try { url = new URL(location.href); } catch { return; }
    /* THE DEFAULT DROPS OUT OF THE URL, and the default is now ALL_STATIONS
       — the same rule as before, pointed at the new default. Writing
       `?s=all` onto a page that already shows all of them would put a
       parameter in every reader's address bar that says what the page does
       without it. */
    if (key === ALL_STATIONS) url.searchParams.delete("s");
    else url.searchParams.set("s", key);
    const next = url.pathname + url.search + url.hash;
    try {
      if (push) history.pushState({ s: key }, "", next);
      else history.replaceState({ s: key }, "", next);
    } catch { /* a browser that refuses the write still switched the station */ }
  }

  function showStation(key, opts) {
    const keys = stationKeys();
    if (!keys.length) return;
    const next = (key === ALL_STATIONS || keys.indexOf(key) !== -1) ? key : keys[0];
    station = next;
    for (const s of stationEls()) {
      s.hidden = !(next === ALL_STATIONS || s.dataset.group === next);
    }
    if (barEl) {
      for (const a of barEl.querySelectorAll("[data-side]")) {
        const on = a.dataset.side === next;
        a.setAttribute("aria-selected", on ? "true" : "false");
        /* ONE TAB STOP FOR THE WHOLE ROW. A tablist takes a single stop and the
           arrow keys move inside it; five tabbable anchors would make a
           keyboard reader press Tab five times to get past the row. */
        if (a.classList.contains("ft-tab")) a.tabIndex = on ? 0 : -1;
      }
    }
    /* IN ALL, NO ONE STATION IS THE CURRENT ONE — the observer marks whichever
       fills the band, exactly as it did when the page was one scroll. */
    if (next !== ALL_STATIONS) markCurrentGroup(next);
    if (opts && opts.url) writeStation(next, !!opts.push);
    /* AFTER THE REVEAL, NEVER BEFORE IT. The panels of a hidden station have
       no box, so a chart drawn into one measures zero width — which is why
       drawStation goes through withAllStations, and why it is called here
       rather than at the top of this function. */
    drawStation(painted, "grid");
  }

  /**
   * Draw whatever the current station shows, once.
   *
   * THE MEMO IS PER STATION AND PER CARD. `drawnStations` is cleared when a
   * new card paints, because the panels then hold the previous name's
   * readings; within one card, switching away and back draws nothing and
   * fetches nothing.
   *
   * `?s=all` IS ONE ENTRY, NOT FIVE. It draws the whole grid in a single walk
   * and records itself, so a reader who asked for everything pays one fetch
   * and one pass rather than five of each.
   */
  function drawStation(card, mount) {
    if (!card) return Promise.resolve();
    const key = station === ALL_STATIONS ? ALL_STATIONS : station;
    if (key === null) return Promise.resolve();
    /* THE MEMO RETURNS THE IN-FLIGHT PROMISE, NOT A FRESH RESOLVED ONE, and
       that distinction is a bug this cost. paint() calls applyStation — which
       switches station and starts this draw — and then awaits drawStation
       itself. Handing the second caller Promise.resolve() let honourHash run
       while the panels were still empty, so a deep link scrolled to a heading
       with nothing under it and the observer marked the wrong station. One
       station, one promise, however many callers ask for it. */
    const already = drawnStations.get(key);
    if (already) return already;
    /* THE PROMISE IS RETURNED, and paint() awaits it. honourHash scrolls to a
       panel, and a panel that has not drawn is a heading over an empty box —
       so the fragment would land short by exactly the height of the drawing.
       The station switch below does not await: there the reader is already
       looking at the page and the panels filling in is the expected motion. */
    const only = key === ALL_STATIONS ? null : key;
    const drawing = loadDrawersFor(panelSections(only)).then(() => {
      withAllStations(() => { drawAll(card, mount, only); });
    });
    drawnStations.set(key, drawing);
    return drawing;
  }

  function applyStation(opts) {
    const want = wantedStation();
    if (want === null) return;
    showStation(want, opts || { url: true, push: false });
  }

  /* THE ROW IS A TABLIST, SO IT ANSWERS TO THE ARROW KEYS. Left and Right move
     between stations, Home and End to the ends, and the moved-to tab is both
     focused and selected — a tablist that focuses without selecting makes a
     keyboard reader press Enter for something a mouse reader gets on arrival. */
  function stationKeydown(event) {
    const keys = stationKeys();
    if (!keys.length || event.altKey || event.ctrlKey || event.metaKey) return;
    const here = event.target && event.target.closest
      ? event.target.closest(".ft-tab[data-side]") : null;
    if (!here) return;
    const at = keys.indexOf(here.dataset.side);
    if (at === -1) return;
    let to = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") to = (at + 1) % keys.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = (at - 1 + keys.length) % keys.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = keys.length - 1;
    else return;
    event.preventDefault();
    showStation(keys[to], { url: true, push: true });
    const tab = barEl && barEl.querySelector('.ft-tab[data-side="' + keys[to] + '"]');
    if (tab) { try { tab.focus(); } catch { /* focus is a courtesy, not the switch */ } }
  }

  function installStations() {
    if (!barEl) return;
    barEl.addEventListener("click", (event) => {
      const tab = event.target && event.target.closest
        ? event.target.closest("[data-side]") : null;
      if (!tab || !barEl.contains(tab)) return;
      /* A MODIFIED CLICK STAYS A NAVIGATION. Ctrl or Cmd click opens the
         station in a new tab, and swallowing that would take away something
         the anchor gave the reader for free. */
      if (event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      showStation(tab.dataset.side, { url: true, push: true });
      /* THE READER ARRIVES AT THE TOP OF THE STATION THEY ASKED FOR. Switching
         leaves the scroll where it was, which on a long station is the middle
         of a panel that was not there a moment ago. */
      const head = tab.dataset.side === ALL_STATIONS
        ? grid
        : grid.querySelector('.ft-station[data-group="' + tab.dataset.side + '"] .ft-group');
      if (head) {
        syncBarHeight();
        head.scrollIntoView({ block: "start" });
        if (!head.hasAttribute("tabindex")) head.tabIndex = -1;
        try { head.focus({ preventScroll: true }); } catch { head.focus(); }
      }
    });
    barEl.addEventListener("keydown", stationKeydown);
    /* BACK AND FORWARD MOVE BETWEEN STATIONS, and never write a third entry
       for the state the browser just restored. */
    window.addEventListener("popstate", () => applyStation({ url: false }));
  }

  /* WHICH STATION THE READER IS IN, tracked by observation rather than by a
     scroll handler doing arithmetic on every frame. Without
     IntersectionObserver the tab row simply never marks a current station,
     which costs a highlight and nothing else — the anchors still work.

     IT OBSERVES THE FIVE STATIONS, NOT THE 23 PANELS. The question is which
     GROUP is on screen, and asking it of every panel took 23 observations to
     answer, each reporting a group as a property of one panel. The station is
     the element that IS the group, so the `best` tie-break below is between
     at most two stations meeting at a boundary rather than between whichever
     panels of one group were in the band. */
  function watchGroups() {
    if (typeof IntersectionObserver !== "function") return;

    /* WHICHEVER STATION FILLS MOST OF THE BAND, RE-ASKED WHENEVER THE PAGE
       MOVES. Two defects, both pre-dating the move from panels to stations.

       "Smallest boundingClientRect.top among the intersecting" always prefers
       the station ABOVE, however little of it is left: on a 900px viewport the
       band is 225-360, and landing on #ftg-tape left volatility ending at 244
       against tape starting at 270 — 19px of band against 90 — so the bar
       named volatility.

       AND AN OBSERVER SPEAKS WHEN AN INTERSECTION CHANGES, NOT WHEN THE PAGE
       STOPS. Scrolling is smooth, so the last callback of that jump fired at
       y=7429 against a resting 7503: one station behind, with nothing at rest
       to correct it. Measured from the callback log, not reasoned. Hence the
       recompute on scroll, throttled to a frame; the observer now only
       maintains the candidate set. */
    const inBand = new Set();
    let queued = false;

    function choose() {
      queued = false;
      const bandTop = 0.25 * window.innerHeight, bandBottom = 0.4 * window.innerHeight;
      let best = null, bestSeen = 0;
      for (const node of inBand) {
        const r = node.getBoundingClientRect();
        const seen = Math.min(r.bottom, bandBottom) - Math.max(r.top, bandTop);
        if (seen > bestSeen) { bestSeen = seen; best = node; }
      }
      if (best) markCurrentGroup(best.dataset.group);
    }

    /* One frame at a time: a scroll fires far faster than a paint, and every
       call here reads layout. */
    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(choose);
    }

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) inBand.add(e.target); else inBand.delete(e.target);
      }
      choose();
    }, { rootMargin: "-25% 0px -60% 0px" });
    for (const station of grid.querySelectorAll(".ft-station[data-group]")) io.observe(station);
    addEventListener("scroll", schedule, { passive: true });
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
   * THE SIDE, STATED AGAINST THE PUBLISHED DEAD BAND rather than against zero.
   *
   * A score of +1 with a band of ±1 is not a bullish name; it is a name the
   * board declined to rank, and calling it bullish in a header is exactly the
   * confident reading this product exists to refuse.
   *
   * ONE FUNCTION BECAUSE THERE ARE NOW THREE READERS. This lived inline in
   * paintIdentity while the sticky strip was the only place a side was
   * printed. The hero prints it as a pill and the flags row prints it as a
   * mark, and a second copy of this decision is how one of the three comes to
   * call a name bullish while the other two call it unranked — on the same
   * screen, four lines apart.
   *
   * @returns {{text: string, word: string|null, cls: string, empty: string|null, title: string}}
   *   `word` is null for every case that is NOT a directional claim — no score,
   *   and inside the band — so a caller that wants only the direction cannot
   *   accidentally treat "inside the dead band" as one.
   */
  function sideOf(card, chg) {
    const score = isNum(card && card.score);
    const band = chg && chg.status === "ok" ? chg.band : null;
    if (score === null) {
      return { text: DASH, word: null, cls: "is-null", empty: "unavailable",
        title: "This card carries no score, so it has no side." };
    }
    const word = score < 0 ? "bearish" : score > 0 ? "bullish" : "neutral";
    if (band === null) {
      return { text: word, word, cls: P.polarity(score), empty: null,
        title: "No dead band was published on this card, so the side is stated " +
          "against zero rather than against the board's own membership rule." };
    }
    if (Math.abs(score) <= band) {
      return { text: "inside the dead band", word: null, cls: "is-flat", empty: null,
        title: "Within ±" + band + POINTS(band) + " of zero, which is the band " +
          "the board declines to rank inside." };
    }
    return { text: word, word, cls: P.polarity(score), empty: null,
      title: "Outside the published dead band of ±" + band + POINTS(band) + "." };
  }

  /* ---------- the arrival header ------------------------------------

     THE SAME FACTS AS THE STICKY STRIP, LAID OUT RATHER THAN RUN TOGETHER.

     The strip is one line by necessity — it is re-parented into the sticky bar
     and every pixel of its height is spent for the whole scroll — so it reads
     as "SYN002 +16 $34.87 −1.7% bullish +1 score point over 1 session — 81
     conviction short Γ session 2026-08-24": seven readings a reader has to
     parse apart before they can use any one of them. This block is what a
     reader LANDS on, where height is free, and each reading is its own object
     with its own label.

     NOT ONE SECOND MEASUREMENT ANYWHERE IN IT. Score and conviction are read
     off the card's top level, spot through the same spotOf() the strip uses,
     the change off the context panel. A hero that re-derived any of them would
     be a header that can disagree with the panel beneath it, which is the one
     failure this page cannot afford at the top of itself. */
  function paintHero(card, chg) {
    const hero = $("ftHero");
    if (!hero) return;

    const t = $("ftHeroT");
    if (t) t.textContent = card.ticker || "";
    /* THE COMPANY NAME IS ON THE CARD NOW. It used to be a board field this
       page could not reach without a second fetch, so the slot was empty on
       arrival for every reader; shared/flows-card.js carries it across at a
       cost of about thirty bytes. Absent stays hidden rather than falling
       back to the symbol: a name equal to its own ticker is what an absent
       name looks like after a fallback, and no reader could tell. */
    const nm = typeof card.nm === "string" && card.nm.trim() ? card.nm.trim() : null;
    const nmEl = $("ftHeroNm");
    if (nmEl) {
      nmEl.textContent = nm && nm !== card.ticker ? nm : "";
      nmEl.hidden = !(nm && nm !== card.ticker);
    }

    const spot = spotOf(card);
    const px = $("ftHeroPx");
    if (px) {
      px.textContent = spot === null ? DASH : "$" + spot.v.toFixed(2);
      if (spot === null) px.setAttribute("data-empty", "unavailable");
      else px.removeAttribute("data-empty");
      px.title = spot === null
        ? "No panel on this card published a spot price."
        : "Spot as the " + spot.from + " panel resolved it.";
    }

    /* THE PERCENTAGE AND NOT A DOLLAR CHANGE. The mockup this follows prints
       both — "+0.35 (+0.8%)" — and the dollar figure is derivable from spot
       and this ratio. It is not printed, because the two come from DIFFERENT
       PANELS: spot from levels/pricedMove/gamma, the ratio from context. A
       dollar change computed across that seam is a third quantity neither
       panel published, and the first time those two panels disagree about the
       session it would be wrong in a way nothing on the page could catch. */
    const ctx = card.panels && card.panels.context;
    const chgPct = ctx && ctx.status === "ok" ? isNum(ctx.changePct) : null;
    const chgEl = $("ftHeroChg");
    if (chgEl) {
      chgEl.textContent = chgPct === null ? "" : P.pct1(chgPct);
      chgEl.className = "ft-hero-chg" + P.polarity(chgPct);
      chgEl.hidden = chgPct === null;
      chgEl.title = "Change against the previous close, from the price context panel.";
    }

    /* THE SCORE, ITS BAR AND ITS SIDE. The bar is the same ±100 scale the
       board's rows use and the pill is the same word the strip prints — one
       vocabulary for a direction across the section, so a reader who learned
       it on the landing page does not learn it again here. */
    const score = isNum(card.score);
    const sEl = $("ftHeroScore");
    if (sEl) {
      sEl.textContent = score === null ? DASH : P.signed(score, (a) => String(a));
      sEl.className = "ft-hero-v" + P.polarity(score);
      if (score === null) sEl.setAttribute("data-empty", "unavailable");
      else sEl.removeAttribute("data-empty");
    }
    const bar = $("ftHeroScoreBar");
    if (bar) {
      bar.replaceChildren();
      bar.hidden = score === null;
      if (score !== null) {
        const fill = el("i", P.polarity(score).trim() || null);
        /* HALF THE TRACK IS EACH SIDE, so the bar grows from the centre and a
           −49 and a +49 are mirror images. Clamped, because the scale is the
           claim: a score past ±100 would otherwise draw past its own track. */
        const half = Math.min(50, Math.abs(score) / 2);
        fill.style.width = half + "%";
        fill.style.left = (score < 0 ? 50 - half : 50) + "%";
        bar.append(fill);
      }
    }
    /* THE PILL CARRIES THE SIDE ONLY WHERE THERE IS ONE. sideOf returns a
       null `word` for the two cases that are not a direction — no score, and
       inside the dead band — and the pill is absent for both rather than
       printing "NEUTRAL", which would read as a measured middle instead of as
       a name the board declined to rank. The strip below still states those
       two in words; a pill is the wrong object for a refusal. */
    const sd = sideOf(card, chg);
    const pill = $("ftHeroSide");
    if (pill) {
      pill.textContent = sd.word ? sd.word.toUpperCase() : "";
      pill.className = "ft-hero-pill" + (sd.word === "bullish" ? " is-pos"
        : sd.word === "bearish" ? " is-neg" : "");
      pill.title = sd.title;
      pill.hidden = !sd.word;
    }

    /* CONVICTION AS FIVE SEGMENTS, WHICH IS WHAT IT IS. The number is a 0-100
       reading and five lit segments out of five is a coarser statement than
       the digits beside it — deliberately: the digits are the measurement and
       the segments are the glance. A segment lights on its own fifth being
       reached, so the last one needs 80 and not 100, and four lit means "past
       four fifths" rather than "80 exactly". */
    const conv = isNum(card.conviction);
    const cEl = $("ftHeroConv");
    if (cEl) {
      cEl.textContent = conv === null ? DASH : String(Math.round(conv));
      if (conv === null) cEl.setAttribute("data-empty", "unavailable");
      else cEl.removeAttribute("data-empty");
    }
    const seg = $("ftHeroConvSeg");
    if (seg) {
      seg.replaceChildren();
      seg.hidden = conv === null;
      if (conv !== null) {
        for (let i = 0; i < 5; i++) {
          seg.append(el("i", conv >= (i + 1) * 20 ? "is-on" : null));
        }
      }
    }

    /* ---- THE TWO VOLATILITY COLUMNS ----------------------------------

       BOTH ARE READ, NEITHER IS DERIVED. `atmVol` and `ivRank` are published
       side by side on the priced-move panel, which also publishes the rule
       that decides the horizon they are measured over — so the horizon is
       quoted from `horizonRule` rather than described here, and the two
       cannot drift.

       THE RANK IS A FRACTION AND THE PIPELINE SAYS SO IN AS MANY WORDS:
       ivRankFraction divides by 100 when the vendor sends 0..100, and its
       comment records what happens when that is missed — "1352% of its year"
       on a card. It is printed as a percentage of its own year here, with
       the year named, because a bare "84" beside a vol of "44.2%" is two
       units under one heading. */
    const pm = card.panels && card.panels.pricedMove;
    const pmOk = pm && pm.status === "ok";
    const atmVol = pmOk ? isNum(pm.atmVol) : null;
    const ivRank = pmOk ? isNum(pm.ivRank) : null;
    const horizon = pmOk && typeof pm.horizonRule === "string" && pm.horizonRule
      ? pm.horizonRule : null;

    const ivB = $("ftHeroIvB"), ivEl = $("ftHeroIv"), ivSub = $("ftHeroIvSub");
    if (ivB && ivEl) {
      ivEl.textContent = atmVol === null ? DASH : (atmVol * 100).toFixed(1) + "%";
      if (atmVol === null) ivEl.setAttribute("data-empty", "unavailable");
      else ivEl.removeAttribute("data-empty");
      if (ivSub) {
        ivSub.textContent = horizon ? "at " + horizon : "";
        ivSub.hidden = !horizon;
      }
      ivB.title = atmVol === null
        ? "The priced-move panel published no at-the-money volatility for this name."
        : "At-the-money implied volatility, over " + (horizon || "the panel's own horizon") +
          ", as the priced-move panel measured it.";
      /* THE BLOCK SHOWS WHENEVER THE PANEL READ, even where the figure did
         not: a column that vanishes on an absent reading takes the silence
         with it, and the strip's other blocks all print their own em dash. */
      ivB.hidden = !pmOk;
    }

    const ivrB = $("ftHeroIvrB"), ivrEl = $("ftHeroIvr"), ivrSeg = $("ftHeroIvrSeg");
    if (ivrB && ivrEl) {
      ivrEl.textContent = ivRank === null ? DASH : Math.round(ivRank * 100) + "%";
      if (ivRank === null) ivrEl.setAttribute("data-empty", "unavailable");
      else ivrEl.removeAttribute("data-empty");
      if (ivrSeg) {
        ivrSeg.replaceChildren();
        ivrSeg.hidden = ivRank === null;
        if (ivRank !== null) {
          /* FIVE SEGMENTS, THE SAME FIVE THE CONVICTION BLOCK BESIDE IT USES,
             so two bounded 0-100 readings in one strip are read the same way
             rather than each inventing a scale. */
          for (let i = 0; i < 5; i++) {
            ivrSeg.append(el("i", ivRank * 100 >= (i + 1) * 20 ? "is-on" : null));
          }
        }
      }
      ivrB.title = ivRank === null
        ? "The priced-move panel published no IV rank for this name."
        : "Where this name's implied volatility sits inside its own past year: " +
          Math.round(ivRank * 100) + "% of that year was lower. A percentile of its own " +
          "history, not a level comparable across names.";
      ivrB.hidden = !pmOk;
    }

    const sector = typeof card.sector === "string" && card.sector.trim()
      ? card.sector.trim() : null;
    /* THE SECTOR AND THE SESSION SIT UNDER THE SYMBOL NOW, in the identity
       block rather than in a sixth column of their own. Neither is a
       measurement of the session — one is a property of the name and the
       other says which day every figure above is of — so a column beside four
       figures was the wrong shape for both, and it was the block that pushed
       the strip onto two rows. Each still prints or stays empty on its own:
       a card with no sector still has a session. */
    const secEl = $("ftHeroSector"), whenEl = $("ftHeroWhen");
    const when = card.sessionDate ? "session " + fmtDate(card.sessionDate) : null;
    if (whenEl) whenEl.textContent = when || "";
    if (secEl) secEl.textContent = sector || "";

    hero.hidden = false;
  }

  /* ---------- the flags row -----------------------------------------

     FIVE MARKS, EACH ONE A THRESHOLD ALREADY DRAWN SOMEWHERE BELOW.

     THE ROW ADDS NO OPINION AND THAT IS THE POINT: every flag is a restatement
     of a panel's own number past a line this function names in the flag's own
     title, so a reader can always find the reading it came from. What it adds
     is SCAN — five yes/no marks at the top, where the page's answer to "why
     am I looking at this name" used to be spread over four stations.

     ABSENT, NEVER GREYED OUT. A flag that draws itself dim to mean "no" turns
     five silences into five negative claims, and most of these readings are
     missing on some card on some day. A flag appears when its reading is
     present AND past its line; otherwise there is nothing there. */
  /* ---------- the six cards ------------------------------------------

     THE SESSION'S FLOW, AT A GLANCE, AND NOT A SECOND COPY OF THE HEADER.
     The strip above already carries price, score, conviction and the two
     volatility figures. These six answer a different question — what the
     flow DID — and every one of them is a figure some panel further down
     states in full, lifted to the top where a reader looks first.

     EACH CARD IS ONE PANEL'S READING, WITH THAT PANEL'S OWN UNIT. Not one
     composite: a card that averaged premium with contracts would be a number
     with no unit at all. Where a panel publishes a coverage caveat — a count
     the vendor did not report, a clearing day's lag, rows shed to a cap —
     that caveat is the card's sub-line rather than something a reader has to
     scroll to find.

     A PANEL THAT DID NOT READ GETS NO CARD. Six greyed-out boxes would turn
     six silences into six claims that the session was quiet; the strip simply
     carries fewer cards, and the panels below still say which of them are
     absent and why. */
  function paintCards(card) {
    const host = $("ftCards");
    if (!host) return;
    host.replaceChildren();
    const P0 = window.FlowsPanels;
    if (!P0) { host.hidden = true; return; }
    const panels = card.panels || {};
    const ok = (k) => {
      const p = panels[k];
      return p && p.status === "ok" ? p : null;
    };
    const n = (v) => isNum(v);

    const track = ok("premiumTrack"), path = ok("path"), aggr = ok("aggressor");
    const oiD = ok("oiDeltas"), dark = ok("darkpool");

    /* THE SPARKLINE IS THE PANEL'S OWN SERIES, drawn from the same rows the
       premium-track panel draws in full — a shape, with the figure beside it
       carrying the magnitude. A session the track could not price is a GAP in
       the line rather than a zero, which is the same refusal the panel makes
       in its own drawing. */
    const spark = (vals) => {
      const pts = vals.map((v, i) => [i, n(v)]).filter((x) => x[1] !== null);
      if (pts.length < 2) return null;
      const W = 76, H = 20;
      let lo = Infinity, hi = -Infinity;
      for (const [, v] of pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (lo === hi) { lo -= 1; hi += 1; }
      const x = (i) => (i / Math.max(1, vals.length - 1)) * W;
      const y = (v) => H - ((v - lo) / (hi - lo)) * H;
      const svg = svgEl("svg", { class: "ft-card-spark", viewBox: "0 0 " + W + " " + H,
        width: W, height: H, preserveAspectRatio: "none", "aria-hidden": "true" });
      svg.append(svgEl("path", {
        /* THREE ARMS, THROUGH THE SHARED HELPER. A two-arm sign puts a
           measured zero — a session that cleared exactly even, which this
           pipeline does assign — on the positive side, and flows-sign refuses
           that everywhere in this section by structure rather than by
           review. */
        class: "ft-card-line " + P0.polarity(pts[pts.length - 1][1]),
        fill: "none",
        d: pts.map(([i, v], k) => (k ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" "),
      }));
      return svg;
    };

    /* A SIGNED BAR ONLY WHERE THERE IS SOMETHING TO BE A SHARE OF.

       The first draft gave four cards a bar and passed each one its OWN
       magnitude as the peak — so every bar came out exactly half full, in the
       direction of its sign, on every card and every session. Read back off
       the rendered page: width 50% left 0%, width 50% left 0%, width 50% left
       50%. That is not a reading, it is a shape that looks like one, and the
       one card with a real denominator (open interest, where the call side is
       measured against the larger of the two sides) was hidden among three
       that had none.

       So the bar belongs to the card that has a comparison and nowhere else;
       the rest print their figure and their unit, which is the whole of what
       they know. */
    const bar = (v, peak) => {
      const val = n(v);
      if (val === null || !(peak > 0)) return null;
      const b = el("span", "ft-card-bar");
      const fill = el("i", val < 0 ? "is-neg" : val > 0 ? "is-pos" : "");
      const half = Math.min(50, (Math.abs(val) / peak) * 50);
      fill.style.width = Math.max(1.5, half) + "%";
      fill.style.left = (val < 0 ? 50 - half : 50) + "%";
      b.append(fill);
      return b;
    };

    const cards = [];

    if (track) {
      const rows = Array.isArray(track.rows) ? track.rows : [];
      cards.push(["Premium run", P0.money(track.net),
        P0.polarity(n(track.net)),
        track.sessions + " sessions, " + track.priced + " priced" +
          (track.gaps ? ", " + track.gaps + " unpriced" : ""),
        spark(rows.map((r) => r && r.p)),
        "Net premium — calls minus puts — summed over the sessions this card carries. " +
        (track.unit || "")]);
    }
    if (path) {
      cards.push(["Session premium", P0.money(path.netPremium),
        P0.polarity(n(path.netPremium)),
        path.netPremiumUnit || "",
        null,
        "What this one session cleared, side-signed, over " +
          (n(path.minutes) === null ? "the session" : path.minutes + " minutes") + "."]);
      cards.push(["Net delta", P0.fmtOr(path.netDelta, (v) => P0.signed(v, (a) => P0.compact(a))),
        P0.polarity(n(path.netDelta)),
        path.netDeltaUnit || "",
        null,
        "Delta-weighted contracts the tape ended holding, signed by side."]);
    }
    if (aggr && aggr.lead && aggr.lead.n) {
      const net = n(aggr.lead.n.ladderNetExact);
      cards.push(["Aggressor", P0.fmtOr(net, (v) => P0.signed(v, (a) => P0.compact(a))),
        P0.polarity(net),
        aggr.reported + " reported, " + aggr.unreported + " not",
        /* THE TOP STRIKE AGAINST THE WHOLE LADDER, which the panel publishes
           as two figures side by side — so this bar is a share of something
           rather than a restatement of its own value. */
        bar(n(aggr.lead.n.topNetExact), Math.abs(net) || 0),
        aggr.relation || ""]);
    }
    if (oiD && oiD.lead && oiD.lead.n) {
      const cN = n(oiD.lead.n.callNet), pN = n(oiD.lead.n.putNet);
      const both = cN !== null && pN !== null;
      cards.push(["Open interest", both ? P0.signed(cN - pN, (a) => P0.compact(a)) : DASH,
        both ? P0.polarity(cN - pN) : "",
        both ? P0.compact(Math.abs(cN)) + " call / " + P0.compact(Math.abs(pN)) + " put" : "",
        both ? bar(cN - pN, Math.max(Math.abs(cN), Math.abs(pN))) : null,
        "Contract-level open-interest change on the lines the vendor surfaced. An open " +
        "interest change compares two clearing snapshots, so it is a settled fact a day " +
        "late by construction — never today's tape."]);
    }
    if (dark && dark.lead && dark.lead.n) {
      const d = n(dark.lead.n.dollars);
      cards.push(["Off-exchange", P0.money(d), "",
        dark.lead.n.kept + " of " + dark.lead.n.seen + " prints" +
          (n(dark.lead.n.topPct) === null ? "" : ", top " + dark.lead.n.topPct + "%"),
        null,
        "Off-exchange equity executions in this name, by their own dollar size. The tape " +
        "reports them with delay and attributes no side and no participant."]);
    }

    for (const [k, v, cls, sub, viz, why] of cards.slice(0, 6)) {
      const c = el("div", "ft-card");
      c.title = why || "";
      c.append(el("span", "ft-card-k", k));
      const row = el("span", "ft-card-row");
      row.append(el("span", "ft-card-v" + (cls ? " " + cls : ""), v));
      if (viz) row.append(viz);
      c.append(row);
      if (sub) c.append(el("span", "ft-card-s", sub));
      host.append(c);
    }
    host.hidden = !cards.length;
  }

  /* ---------- what this card found ----------------------------------

     THE PANELS' OWN LEADS, GATHERED, WITH A WAY INTO EACH. Not a new
     analysis and not a second sentence about the same numbers: every line is
     `panels[key].lead.say`, the exact string the panel prints, so the index
     and the panel cannot disagree about a figure. What it adds is that the
     findings are visible before a reader scrolls, and that each one is a link
     to the panel that made it.

     THE ORDER IS THE PAGE'S. It walks `.ft-panel[data-panel]` in DOM order —
     the same walk the grid uses — so the index reads down the page rather
     than ranking findings by an importance nothing on this card publishes.

     AND IT SAYS HOW MANY IT IS NOT SHOWING. A list of five under a card with
     nineteen readings is a selection, and a selection that does not state its
     own denominator reads as a census. */
  function paintBrief(card) {
    const host = $("ftBrief"), list = $("ftBriefL"), sub = $("ftBriefS");
    if (!host || !list) return;
    list.replaceChildren();
    const panels = card.panels || {};
    const found = [];
    for (const section of document.querySelectorAll(".ft-panel[data-panel]")) {
      const key = section.getAttribute("data-panel");
      const p = key ? panels[key] : null;
      const say = p && p.status === "ok" && p.lead && typeof p.lead.say === "string"
        ? p.lead.say.trim() : "";
      if (!say) continue;
      const title = section.querySelector(".ft-panel-t");
      found.push({ key, say, title: title ? title.textContent.trim() : key });
    }
    const CAP = 5;
    for (const f of found.slice(0, CAP)) {
      const li = el("li", "ft-brief-i");
      const a = el("a", "ft-brief-a");
      a.href = "#panel-" + f.key;
      /* THE PANEL'S NAME IS THE LINK'S DESTINATION SAID OUT LOUD, because
         "read more" repeated five times is five links a screen reader cannot
         tell apart. */
      a.setAttribute("aria-label", f.say + " \u2014 open " + f.title);
      a.append(el("span", "ft-brief-t", f.say));
      a.append(el("span", "ft-brief-c", "\u203a"));
      li.append(a);
      list.append(li);
    }
    if (sub) {
      sub.textContent = found.length > CAP
        ? "The first " + CAP + " of " + found.length + " findings on this card, in page order."
        : (found.length
          ? found.length + (found.length === 1 ? " finding" : " findings") +
            " on this card, in page order."
          : "");
    }
    host.hidden = !found.length;
  }

  /* ---------- the series block, one tab per published series ---------

     NOTHING HERE DERIVES A NUMBER. Each tab reads the array the panel below
     it reads, out of the same field, and draws it. There is no return, no
     change, no summary computed in this function — those sentences belong to
     the panels that own the series, and a second derivation is how a header
     and the panel under it come to disagree about one name.

     THE TABS DO NOT SHARE AN X-AXIS, WHICH IS WHY EACH CARRIES ITS CLOCK.
     Price and premium are indexed by SESSION, net flow by an intraday
     BUCKET, the volatility curve by TENOR. The overview's period control
     settled this and its rule is reused rather than re-argued: the control
     switches SOURCE, and the note names the clock of what is drawn.

     A TAB WITH NO SERIES KEEPS ITS PLACE AND SAYS SO. There is no per-name
     volume series in this payload. Dropping the tab would silently edit the
     design; drawing contract counts under a "Volume" heading would be a
     different quantity wearing its label. */
  const CHART_TABS = ["price", "iv", "volume", "premium", "netflow"];
  const CHART_LABEL = {
    price: "Price", iv: "IV", volume: "Volume",
    premium: "Premium", netflow: "Net Flow",
  };
  let chartTab = "price";

  /**
   * The series for one tab, or the reason there is none.
   *
   * Returns either { points, kind, unit, clock } or { silence }. `points`
   * are { v, label, rows } — v is the value, rows are what the cursor
   * prints, and both come off the payload row rather than being rebuilt.
   */
  function chartSeries(key, card) {
    const panels = (card && card.panels) || {};
    const ok = (k) => { const p = panels[k]; return p && p.status === "ok" ? p : null; };

    if (key === "price") {
      const c = ok("context");
      if (!c) return { silence: "No price window was published for this name this run." };
      const closes = Array.isArray(c.closes) ? c.closes : [];
      const dates = Array.isArray(c.closeDates) ? c.closeDates : [];
      if (closes.length < 2) return { silence: "Fewer than two closes were published." };
      /* THE PANEL'S OWN WARNING, CARRIED. buildContext publishes `dropped`
         and its comment says a non-zero value means the INDEX IS NOT TIME:
         sessions the window could not price are absent, so evenly spaced
         marks would be evenly spaced days that are not evenly spaced. The
         clock says which it is rather than the chart implying either. */
      const dropped = isNum(c.dropped);
      return {
        kind: "line", unit: "close",
        clock: "one mark a session, " + closes.length + " of them" +
          (dates.length ? ", " + dates[0] + " to " + dates[dates.length - 1] : "") +
          (dropped ? " — " + dropped + " session" + (dropped === 1 ? "" : "s") +
            " the window could not price are absent, so the spacing is by index " +
            "rather than by date" : ""),
        points: closes.map((v, i) => ({
          v: isNum(v),
          label: dates[i] ? String(dates[i]) : "Session " + (i + 1),
          rows: [{ k: "Close", v: px2(v) }],
        })),
      };
    }

    if (key === "iv") {
      const v = ok("volContext");
      const term = v && v.term;
      if (!term || term.status !== "ok" || !Array.isArray(term.rows) || term.rows.length < 2) {
        return { silence: term && term.reason
          ? String(term.reason)
          : "No volatility term curve was published for this name this run." };
      }
      return {
        kind: "line", unit: "implied volatility",
        clock: "one mark an EXPIRY, " + term.rows.length + " of them — this axis is " +
          "tenor, not time, so it is a curve across the term and not a history",
        points: term.rows.map((r) => {
          const dte = isNum(r.dte);
          const mv = isNum(r.impliedMovePerc);
          return {
            v: isNum(r.vol),
            label: String(r.expiry || DASH) + (dte === null ? "" : " · " + dte + "d out"),
            rows: [
              { k: "Implied vol", v: isNum(r.vol) === null ? "not published" : vol1(r.vol) },
              { k: "Implied move",
                v: mv === null ? "not published" : vol1(mv) + " of spot" },
            ],
          };
        }),
      };
    }

    if (key === "volume") {
      /* NOT A FAILURE AND NOT AN EMPTY READ. The key does not exist: no
         surface in this payload carries a per-name volume series. Said in
         those words so it is not mistaken for a run that came back thin. */
      return { silence: "This payload publishes no per-name volume series — not a thin " +
        "run, a field that does not exist. Contract volume is published per STRIKE and " +
        "per contract, which the chain and the aggressor ladder draw; neither is a " +
        "series through time, so neither can be drawn here under this label." };
    }

    if (key === "premium") {
      const t = ok("premiumTrack");
      const rows = t && Array.isArray(t.rows) ? t.rows : [];
      if (!rows.length) return { silence: "No net-premium history was published for this name." };
      return {
        kind: "bars", unit: (t && t.unit) || "net premium",
        clock: "one bar a session, " + rows.length + " of them, against a marked zero",
        points: rows.map((r) => ({
          v: isNum(r.p),
          label: String(r.d || DASH),
          rows: [
            { k: "Net premium", v: isNum(r.p) === null ? "not priced" : "$" + compact(r.p),
              cls: isNum(r.p) === null ? "" : r.p > 0 ? "is-pos" : r.p < 0 ? "is-neg" : "" },
            /* THE ROW'S OWN PROVENANCE, because this series is joined from
               two sources and a reader comparing two bars should be able to
               see when they came from different ones. */
            { k: "Source", v: r.source ? String(r.source) : "not stated" },
          ],
        })),
      };
    }

    const p = ok("path");
    const series = p && Array.isArray(p.series) ? p.series : [];
    if (series.length < 2) {
      return { silence: (p && p.reason) ||
        "No intraday tape was published for this name this session." };
    }
    const mins = isNum(p.minutes);
    return {
      kind: "line", unit: (p && p.netPremiumUnit) || "cumulative net premium",
      clock: "one mark a five-minute bucket, " + series.length + " of them across the " +
        "session" + (mins === null ? "" : " (" + mins + " minutes of tape)") +
        " — this axis is intraday, where every other tab here is by session",
      points: series.map((row, i) => {
        const d = isNum(row && row[0]);
        return {
          v: isNum(row && row[1]),
          label: "Bucket " + (i + 1) + " of " + series.length,
          rows: [
            { k: "Net premium", v: isNum(row && row[1]) === null ? "not reported"
              : "$" + compact(row[1]),
              cls: !isNum(row && row[1]) ? "" : row[1] > 0 ? "is-pos" : row[1] < 0 ? "is-neg" : "" },
            { k: "Net delta", v: d === null ? "not reported" : compact(d) + " contracts" },
          ],
        };
      }),
    };
  }

  function paintChart(card) {
    const host = $("ftChart"), body = $("ftChartBody"), sub = $("ftChartS");
    const tabs = $("ftChartTabs");
    if (!host || !body) return;
    body.replaceChildren();
    if (tabs) tabs.replaceChildren();

    /* THE TAB ROW IS DRAWN WHATEVER THE SELECTED TAB HOLDS, so a reader who
       opens a silent tab can still leave it. A control row that disappears
       with its content strands them. */
    for (const key of CHART_TABS) {
      const b = el("button", "ft-chart-tab" + (chartTab === key ? " is-on" : ""),
        CHART_LABEL[key]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", chartTab === key ? "true" : "false");
      b.addEventListener("click", () => {
        if (chartTab === key) return;
        chartTab = key;
        paintChart(card);
      });
      if (tabs) tabs.append(b);
    }

    const spec = chartSeries(chartTab, card);
    if (spec.silence) {
      const p = el("p", "ft-chart-dead", spec.silence);
      body.append(p);
      if (sub) sub.textContent = "";
      host.hidden = false;
      return;
    }

    const live = spec.points.filter((pt) => pt.v !== null);
    if (live.length < 2) {
      body.append(el("p", "ft-chart-dead",
        "Fewer than two of the " + spec.points.length + " points in this series carry a " +
        "value, so there is no shape to draw."));
      if (sub) sub.textContent = "";
      host.hidden = false;
      return;
    }

    const W = 620, H = 260, padL = 8, padR = 46, padT = 12, padB = 22;
    const plotL = padL, plotW = W - padL - padR;
    const plotT = padT, plotH = H - padT - padB;

    let lo = Infinity, hi = -Infinity;
    for (const pt of live) { if (pt.v < lo) lo = pt.v; if (pt.v > hi) hi = pt.v; }
    /* BARS ARE MEASURED FROM ZERO AND A LINE IS NOT. A signed bar whose axis
       starts at the smallest value encodes its length against an arbitrary
       floor, which is the defect this wave already fixed once on the premium
       panel: bar length has to mean the quantity. A line is a shape and may
       be framed on its own range. */
    if (spec.kind === "bars") { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (lo === hi) { lo -= 1; hi += 1; }

    const n = spec.points.length;
    const x = (i) => plotL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => plotT + plotH - ((v - lo) / (hi - lo)) * plotH;

    const svg = svgEl("svg", {
      class: "ft-chart-svg", viewBox: "0 0 " + W + " " + H,
      role: "img", tabindex: "0",
      "aria-label": CHART_LABEL[chartTab] + ", " + spec.points.length + " points",
    });

    /* THREE AXIS LABELS AND NO GRID: the readout carries every value, so a
       grid here would be ink that repeats what a cursor already says. */
    for (const frac of [0, 0.5, 1]) {
      const v = lo + (hi - lo) * frac;
      const yy = y(v);
      svg.append(svgEl("line", { class: "ft-chart-rule",
        x1: plotL, x2: plotL + plotW, y1: yy, y2: yy }));
      const t = svgEl("text", { class: "ft-chart-ax", x: plotL + plotW + 4, y: yy + 3 });
      t.textContent = spec.kind === "bars" || Math.abs(v) >= 1000 ? compact(v) : px2(v);
      svg.append(t);
    }

    if (spec.kind === "bars") {
      const bw = Math.max(1.5, (plotW / n) * 0.62);
      const zero = y(0);
      for (let i = 0; i < n; i++) {
        const pt = spec.points[i];
        if (pt.v === null) continue;
        const yy = y(pt.v);
        svg.append(svgEl("rect", {
          class: "ft-chart-bar " + (pt.v > 0 ? "is-pos" : pt.v < 0 ? "is-neg" : "is-flat"),
          x: x(i) - bw / 2, width: bw,
          y: Math.min(yy, zero), height: Math.max(1, Math.abs(yy - zero)),
        }));
      }
      svg.append(svgEl("line", { class: "ft-chart-zero",
        x1: plotL, x2: plotL + plotW, y1: zero, y2: zero }));
    } else {
      /* A GAP IS A GAP. A session the payload could not price breaks the
         line rather than being bridged to its neighbour, which would draw a
         value nobody measured. */
      let d = "", pen = false;
      for (let i = 0; i < n; i++) {
        const pt = spec.points[i];
        if (pt.v === null) { pen = false; continue; }
        d += (pen ? "L" : "M") + x(i).toFixed(2) + " " + y(pt.v).toFixed(2) + " ";
        pen = true;
      }
      svg.append(svgEl("path", { class: "ft-chart-line", d: d.trim(), fill: "none" }));
    }

    const ends = svgEl("text", { class: "ft-chart-ax", x: plotL, y: H - 6 });
    ends.textContent = String(spec.points[0].label || "");
    svg.append(ends);
    const end2 = svgEl("text", {
      class: "ft-chart-ax", x: plotL + plotW, y: H - 6, "text-anchor": "end" });
    end2.textContent = String(spec.points[n - 1].label || "");
    svg.append(end2);

    body.append(svg);

    /* THE CURSOR IS HANDED THE SAME ARRAY THE MARKS WERE PLACED FROM, and
       the same x() that placed them — rule 1 of the three in
       flows-cursor.js. Nothing is recomputed, so the rule cannot land on one
       mark while the readout prints another. */
    if (window.FlowsCursor) {
      window.FlowsCursor.attach(svg, {
        name: CHART_LABEL[chartTab] + " series",
        band: { y0: plotT, y1: plotT + plotH },
        points: spec.points.map((pt, i) => ({
          x: x(i),
          label: String(pt.label || ""),
          rows: pt.v === null
            ? [{ k: CHART_LABEL[chartTab], v: "not reported" }]
            : pt.rows,
        })),
      });
    }

    if (sub) sub.textContent = CHART_LABEL[chartTab] + " — " + spec.unit + ". " +
      spec.clock.charAt(0).toUpperCase() + spec.clock.slice(1) + ".";
    host.hidden = false;
  }

  /* ---------- the option chain, ordered by strike around spot --------

     THE SAME ROWS THE TOP-CONTRACTS PANEL RANKS, ASKED A DIFFERENT
     QUESTION — which is what makes this a second DRAWING and not a second
     spelling of one reading. That panel orders by volume and answers
     "which single lines carried the day"; ordering the same array by
     STRIKE and ruling spot through it answers "what does the book look
     like around the money", which a volume ranking cannot show at all.
     Neither writes the other's sentence, and the target design carries
     both blocks for exactly that reason.

     THE SPOT ROW IS A SIDE BOUNDARY, NOT A STRIKE BOUNDARY, and the
     subtitle says so. It separates the calls from the puts and states the
     price both ladders are measured against. Reading it as "everything
     above is above spot" would be wrong on any chain where a call strike
     sits below the money, which is most of them.

     NO DELTA COLUMN, WHICH IS THE DESIGN'S ONE COLUMN THIS PAYLOAD
     CANNOT FILL. Per-contract delta is not published, and
     shared/flows-chain.js states in its own header why it is not derived
     either: a delta needs a risk-free rate and a dividend, neither of
     which the vendor sends. The column is ABSENT rather than filled with
     the aggressor count that happens to share its sign — that
     substitution is the mislabelling this wave already caught once, on
     this same panel's call/put volume.

     ORDER IS A CONTROL, AND IT IS THE ONE INTERACTION A TABLE TAKES.
     Strike ascending is the chain's own reading; volume descending is the
     ranked one. Both are orderings of the rows in hand — nothing is
     re-derived and no row enters or leaves — so the control cannot change
     what the card claims, only what a reader meets first. */
  const CHAIN_ORDER = [
    { key: "k", label: "Strike", how: "by strike, ascending" },
    { key: "vol", label: "Volume", how: "by volume, largest first" },
  ];
  let chainOrder = "k";

  function paintChain(card) {
    const host = $("ftChain"), body = $("ftChainBody"), sub = $("ftChainS");
    const tabs = $("ftChainTabs");
    if (!host || !body) return;
    body.replaceChildren();
    if (tabs) tabs.replaceChildren();

    const panels = card.panels || {};
    const panel = panels.topContracts;
    const rows = panel && panel.status === "ok" && Array.isArray(panel.rows)
      ? panel.rows : [];
    /* HIDDEN RATHER THAN DEAD-PANELLED. The grid's own topContracts panel
       states the silence in full, with the payload's reason; a second
       statement of one absence in the column beside it is the copy this
       page refuses. */
    if (!rows.length) { host.hidden = true; return; }

    const lv = panels.levels;
    const spot = lv && lv.status === "ok" ? isNum(lv.spot) : null;

    for (const o of CHAIN_ORDER) {
      const b = el("button", "ft-chain-tab" + (chainOrder === o.key ? " is-on" : ""), o.label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", chainOrder === o.key ? "true" : "false");
      b.setAttribute("aria-label", "Order the chain " + o.how);
      b.addEventListener("click", () => {
        if (chainOrder === o.key) return;
        chainOrder = o.key;
        paintChain(card);
      });
      if (tabs) tabs.append(b);
    }

    /* THE TWO SIDES ARE PARTITIONED BEFORE ANYTHING IS ORDERED, so a row
       whose symbol carried no parsable type joins NEITHER ladder rather
       than defaulting into the calls. The count of those is said below. */
    const calls = [], puts = [];
    let untyped = 0;
    for (const r of rows) {
      if (r.cp === "C") calls.push(r);
      else if (r.cp === "P") puts.push(r);
      else untyped++;
    }

    const order = (list) => list.slice().sort((a, b) => {
      if (chainOrder === "vol") {
        const av = isNum(a.vol), bv = isNum(b.vol);
        /* A ROW THE VENDOR DID NOT COUNT SORTS LAST IN EITHER DIRECTION,
           rather than ahead of every counted row as a silent zero. */
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      }
      const ak = isNum(a.k), bk = isNum(b.k);
      if (ak === null && bk === null) return 0;
      if (ak === null) return 1;
      if (bk === null) return -1;
      return ak - bk;
    });

    const COLS = [
      { k: "k", label: "Strike", cls: "c-num ftc-k" },
      { k: "bidPx", label: "Bid", cls: "c-num ftc-bid" },
      { k: "askPx", label: "Ask", cls: "c-num ftc-ask" },
      { k: "vol", label: "Vol", cls: "c-num ftc-vol" },
      { k: "oi", label: "OI", cls: "c-num ftc-oi" },
      { k: "iv", label: "IV", cls: "c-num ftc-iv" },
    ];

    const cellText = (r, key) => {
      if (key === "k" || key === "bidPx" || key === "askPx") return px2(r[key]);
      if (key === "vol" || key === "oi") return compact(r[key]);
      /* IV IS A FRACTION IN THE PAYLOAD and vol1 is the one place this
         section turns a fraction into a percentage. A second conversion
         written here would be a second definition of the unit. */
      return isNum(r.iv) === null ? DASH : vol1(r.iv);
    };

    const table = el("table", "ftc-table");
    const thead = el("thead");
    const hr = el("tr", "ftc-headrow");
    const corner = el("th", "ftc-side");
    corner.scope = "col";
    corner.append(el("span", "visually-hidden", "Side"));
    hr.append(corner);
    for (const c of COLS) {
      const th = el("th", c.cls, c.label);
      th.scope = "col";
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);

    /* NEAREST THE MONEY IS MARKED, ON EACH SIDE, AND ONLY WITH A SPOT.
       The target highlights one row; the row it highlights is the one a
       reader's eye goes to, so which row that is has to be a measured
       fact rather than a position in the list. With no spot there is no
       "nearest", and nothing is marked. */
    const nearestOf = (list) => {
      if (spot === null) return null;
      let best = null, bestD = Infinity;
      for (const r of list) {
        const k = isNum(r.k);
        if (k === null) continue;
        const d = Math.abs(k - spot);
        if (d < bestD) { bestD = d; best = r; }
      }
      return best;
    };

    const section = (label, list, cls) => {
      if (!list.length) return;
      const tbody = el("tbody", "ftc-body " + cls);
      const near = nearestOf(list);
      const shown = order(list);
      shown.forEach((r, i) => {
        const tr = el("tr", "ftc-row" + (r === near ? " is-near" : ""));
        if (i === 0) {
          const th = el("th", "ftc-side " + cls, label);
          th.scope = "rowgroup";
          th.rowSpan = shown.length;
          tr.append(th);
        }
        for (const c of COLS) {
          const td = el("td", c.cls, cellText(r, c.k));
          if (c.k === "k" && r.expiry) td.title = "Expires " + r.expiry;
          tr.append(td);
        }
        if (r === near) {
          tr.title = "Nearest the money on the " +
            (cls === "is-call" ? "call" : "put") + " side.";
        }
        tbody.append(tr);
      });
      table.append(tbody);
    };

    section("Calls", calls, "is-call");

    /* THE SPOT RULE, AND IT IS OMITTED RATHER THAN DASHED WHEN THERE IS
       NO SPOT. A rule reading "Spot —" between two ladders says a price
       was measured and lost; the levels panel says why it is absent. */
    if (spot !== null) {
      const tb = el("tbody", "ftc-spotb");
      const tr = el("tr", "ftc-spot");
      const td = el("td", "ftc-spotc");
      td.colSpan = COLS.length + 1;
      td.append(el("span", "ftc-spot-k", "Spot"));
      td.append(el("span", "ftc-spot-v", px2(spot)));
      tr.append(td);
      tb.append(tr);
      table.append(tb);
    }

    section("Puts", puts, "is-put");
    body.append(table);

    if (sub) {
      const bits = [];
      bits.push("The " + rows.length + " contract" + (rows.length === 1 ? "" : "s") +
        " on this chain that traded today, " +
        (chainOrder === "vol" ? "by volume, largest first" : "by strike, ascending") +
        " within each side");
      bits.push(spot === null
        ? "no spot price resolved this run, so the sides are not ruled against one"
        : "the rule between them is the last price, not a strike boundary: a " +
          "call below it and a put above it are both ordinary");
      if (untyped) {
        bits.push(untyped + " row" + (untyped === 1 ? "" : "s") +
          " carried no parsable option type and " +
          (untyped === 1 ? "is" : "are") + " in neither ladder");
      }
      /* THE POPULATION, SAID IN THE SAME BREATH AS THE ORDERING. `total`
         is every contract that traded; `rows` is what the payload kept.
         A table that shows a cut without saying it is the completeness
         claim this section refuses by name. */
      const total = isNum(panel.total);
      if (total !== null && total > rows.length) {
        bits.push("cut from " + total + " that traded, the largest by volume kept");
      }
      bits.push("no per-contract delta: it needs a rate and a dividend the vendor " +
        "does not send, so the column is absent rather than guessed");
      /* EACH CLAUSE IS A SENTENCE, SO EACH STARTS WITH A CAPITAL. The first
         draft joined the clauses with ". " and left them as written, which
         rendered "…within each side. the rule between them…" — four
         lowercase sentence openings in one subtitle. Capitalising at the
         JOIN rather than in each string keeps the clauses composable: a
         clause is added or dropped above without anyone having to remember
         which position it will land in. */
      sub.textContent = bits
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(". ") + ".";
    }
    host.hidden = false;
  }

  /* ---------- key levels, in the column the design puts them in ------

     A MOVE, NOT A SECOND DRAWING. The levels panel keeps its full table
     in the grid; what this adds is POSITION — the prices a move runs into,
     visible without scrolling, beside the findings. Same panel, same
     field, same order: `levels` is sorted nearest-first by the payload at
     shared/flows-card.js:304, so this card does not re-sort and cannot
     disagree with the panel about which level is nearest.

     THE LABELS ARE THE PAYLOAD'S. The design says "Resistance" and
     "Support"; this card publishes a gamma flip, a max pain, a call wall
     and a put wall, each a named construction with a stated derivation.
     Calling a gamma flip "resistance" would assert a behaviour nothing
     here measured.

     THE BAR IS THE DISTANCE, SCALED ACROSS THE LEVELS DRAWN. It is not a
     probability and not a strength: it is |distance| as a share of the
     furthest level on this card, which is the only thing a bar over a set
     of levels can honestly encode. The figure beside it carries the
     signed percentage, so the bar never has to mean direction. */
  function paintLevels(card) {
    const host = $("ftLv"), list = $("ftLvL"), sub = $("ftLvS");
    if (!host || !list) return;
    list.replaceChildren();
    const panels = card.panels || {};
    const p = panels.levels;
    const levels = p && p.status === "ok" && Array.isArray(p.levels) ? p.levels : [];
    if (!levels.length) { host.hidden = true; return; }

    const spot = isNum(p.spot);
    let widest = 0;
    for (const lv of levels) {
      const d = isNum(lv.distPct);
      if (d !== null && Math.abs(d) > widest) widest = Math.abs(d);
    }

    for (const lv of levels) {
      const li = el("li", "ft-lv-i");
      const px = isNum(lv.px);
      const d = isNum(lv.distPct);
      const above = d === null ? null : d > 0 ? true : d < 0 ? false : null;
      li.append(el("span", "ft-lv-px" + (
        above === null ? "" : above ? " is-pos" : " is-neg"), px2(px)));
      li.append(el("span", "ft-lv-k", lv.label || lv.kind || DASH));

      const bar = el("span", "ft-lv-bar");
      bar.setAttribute("aria-hidden", "true");
      if (d !== null && widest > 0) {
        const fill = el("span", "ft-lv-fill" + (
          above === null ? "" : above ? " is-pos" : " is-neg"));
        fill.style.width = Math.max(4, Math.round((Math.abs(d) / widest) * 100)) + "%";
        bar.append(fill);
      }
      li.append(bar);

      const dist = el("span", "ft-lv-d");
      /* THE ATR DISTANCE IS THE ONE A READER SIZES WITH and it is
         omitted, never zeroed, when ATR did not resolve — the same
         sentence buildLevels uses for the same field.

         AND THE UNIT IS SPELLED OUT, NOT SET AS A SIGMA. contracts.mjs
         refuses that glyph in this file and gives the reason: the card's
         distances are in ATR and the desk's are in SD, two different
         denominators that one Greek letter used to hide. */
      const atr = isNum(lv.distAtr);
      dist.textContent = d === null ? DASH
        : neg((d * 100).toFixed(1)) + "%" + (atr === null ? "" : " · " +
          neg(Math.abs(atr).toFixed(2)) + " ATR");
      li.append(dist);

      li.title = (lv.label || lv.kind || "This level") +
        (px === null ? "" : " at " + px.toFixed(2)) +
        (spot === null || d === null ? "" :
          ", " + Math.abs(d * 100).toFixed(1) + "% " +
          (above ? "above" : "below") + " spot " + spot.toFixed(2)) +
        (atr === null ? ". ATR did not resolve this run, so there is no sigma distance."
          : ", " + Math.abs(atr).toFixed(2) + " ATR away.");
      list.append(li);
    }

    if (sub) {
      sub.textContent = levels.length + " level" + (levels.length === 1 ? "" : "s") +
        " resolved this run, nearest first" +
        (spot === null ? "" : ", against spot " + spot.toFixed(2)) +
        ". The bar is each level's distance as a share of the furthest drawn here, " +
        "not a probability.";
    }
    host.hidden = false;
  }

  /* ---------- recent flow: the vendor's alerts for this name ---------

     WHAT A ROW IS, restated from shared/flows-alerts.js because this is the
     surface a reader meets it on: ONE ALERT — a window of activity in one
     contract that one of the vendor's rules flagged — carrying the window's
     span, its execution count, a total size and a total premium. It
     AGGREGATES `trades` executions, so it is never a single trade and
     nothing here calls it one. The column is headed by the window's start.

     THE SELECTION IS THE VENDOR'S, AND THAT IS THE HEADLINE CAVEAT. These
     rows exist because a rule fired; the rules are the vendor's own and are
     not published. So the population is "what the vendor chose to flag",
     ranked by its own premium and capped at the key's `cap` — and a name
     with no rows is a name the RULES did not flag, not a name with no flow.

     WHICH IS WHY THIS BLOCK STATES ITS EMPTY CASE INSTEAD OF HIDING.
     Every other block on this page hides when it has nothing, because a
     hidden block claims nothing. Here the absence is the thing most likely
     to be misread — a reader who sees no rows and concludes "quiet name"
     has drawn a conclusion the data does not support — so the silence is
     written out. That is the one deliberate exception on the page and it is
     the four-silences rule applied, not waived: the sentence says which
     silence it is. */
  function paintFlow(ticker, feed) {
    const host = $("ftFlow"), list = $("ftFlowL"), sub = $("ftFlowS");
    if (!host || !list) return;
    list.replaceChildren();

    /* UNREADABLE IS NOT EMPTY. A failed fetch and a feed that flagged
       nothing are different facts, and the second is the one this card
       exists to state carefully. */
    if (!feed || typeof feed !== "object") {
      if (sub) {
        sub.textContent = "The vendor's flow alerts could not be read just now, so this " +
          "card cannot say whether any were raised on " + ticker + ". That is a failed " +
          "read, not a quiet name.";
      }
      host.hidden = false;
      return;
    }
    if (feed.status === "pending") {
      if (sub) {
        sub.textContent = "No flow-alert feed has been published yet this session, so " +
          "there is nothing to filter for " + ticker + " — nothing here is a reading " +
          "about the name.";
      }
      host.hidden = false;
      return;
    }

    const all = Array.isArray(feed.rows) ? feed.rows : [];
    const mine = all.filter((r) => r && String(r.t || "").toUpperCase() === ticker);

    /* NEWEST FIRST, ON THE WINDOW'S START. The feed's own order is by
       PREMIUM — that is what its header says it ranks by — so a card headed
       "recent" has to re-order or stop using the word. A row whose span the
       vendor did not stamp sorts last rather than being read as oldest. */
    const timed = mine.slice().sort((a, b) => {
      const at = a.spanStart ? Date.parse(a.spanStart) : NaN;
      const bt = b.spanStart ? Date.parse(b.spanStart) : NaN;
      const aok = Number.isFinite(at), bok = Number.isFinite(bt);
      if (!aok && !bok) return 0;
      if (!aok) return 1;
      if (!bok) return -1;
      return bt - at;
    });

    const CAP = 6;
    const shown = timed.slice(0, CAP);

    /* THE WINDOW'S START, IN THE READER'S OWN ZONE. `spanStart` is an
       INSTANT, and the card's session date is an Eastern calendar day, so
       slicing characters out of the ISO string prints a UTC clock beside an
       Eastern session — the same class of defect indexCrossFeed carries a
       paragraph about. toLocaleTimeString renders it where the reader is. */
    const clock = (iso) => {
      if (!iso) return DASH;
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) return DASH;
      try {
        return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } catch (_) { return DASH; }
    };

    for (const r of shown) {
      const li = el("li", "ft-flow-i");
      li.append(el("span", "ft-flow-t", clock(r.spanStart)));

      /* THE CONTRACT, AS THE TARGET WRITES IT: strike then side, "44P".
         A row whose symbol carried no parsable strike or type prints the
         dash rather than half a contract name. */
      const k = isNum(r.k);
      const side = r.cp === "C" ? "C" : r.cp === "P" ? "P" : "";
      const oc = el("span", "ft-flow-c" + (
        side === "C" ? " is-call" : side === "P" ? " is-put" : ""));
      oc.textContent = k === null || !side ? DASH : px2(k) + side;
      if (r.exp) oc.title = "Expires " + r.exp;
      li.append(oc);

      li.append(el("span", "ft-flow-z", compact(r.size)));

      const prem = el("span", "ft-flow-p");
      prem.textContent = isNum(r.prem) === null ? DASH : "$" + compact(r.prem);
      li.append(prem);

      /* THE SWEEP MARK IS THE VENDOR'S FLAG AND ONLY WHEN IT SENT ONE.
         flows-alerts.js keeps `false` and null apart on purpose: the vendor
         looking and finding no sweep is not the vendor saying nothing. Only
         a true prints a mark; neither of the other two prints anything,
         because a mark for "no" would make two different silences look like
         one claim. */
      if (r.sweep === true) {
        const s = el("span", "ft-flow-w", "SWEEP");
        s.title = "The vendor flagged this window as a sweep.";
        li.append(s);
      }

      const trades = isNum(r.trades);
      li.title = (k === null || !side ? "This alert" : px2(k) + side) +
        (r.exp ? " expiring " + r.exp : "") +
        (trades === null
          ? ", a window the vendor did not count executions for"
          : ", " + trades + " execution" + (trades === 1 ? "" : "s") + " aggregated") +
        (r.rule ? ", flagged by the vendor's " + r.rule + " rule." : ".");
      list.append(li);
    }

    if (sub) {
      const cap = isNum(feed.cap);
      const seen = isNum(feed.seen);
      const pool = "the " + all.length + " row" + (all.length === 1 ? "" : "s") +
        " this run kept" +
        (cap === null ? "" : " of a " + cap + "-row cap") +
        (seen === null || seen <= all.length ? "" : ", cut from " + seen + " read");
      if (!mine.length) {
        /* THE SENTENCE THIS CARD EXISTS FOR. Said in full rather than as
           "no recent flow", which is the reading the data does not carry. */
        sub.textContent = "The vendor's rules flagged nothing on " + ticker + " in " +
          pool + ". The rules are the vendor's own and are not published, so this is " +
          "what its screens chose to raise — not a measurement of how much traded in " +
          "this name.";
      } else {
        sub.textContent = "Newest first" +
          (mine.length > CAP ? ", the " + CAP + " newest of " + mine.length : "") +
          ". Each row is one ALERT — a window of activity in one contract that a vendor " +
          "rule flagged, aggregating its executions — never a single trade. Selected " +
          "from " + pool + " by the vendor's own rules, which are not published.";
      }
    }
    host.hidden = false;
  }

  /* ---------- the other names in this sector -------------------------

     THE ONE THING ON THIS PAGE THAT IS NOT ABOUT THIS NAME, and the design
     puts it at the bottom of its right column. Every other reading here was
     measured on this ticker; this says which OTHER names the same session's
     boards ranked in the same sector, so a reader who has just formed a view
     can see whether it is one name or a group.

     IT IS TODAY'S BOARDS AND NOT A CORRELATION. Nothing here models how these
     names move together — the claim is only that the same run ranked them and
     put them in the same sector, which is what the board publishes. The
     subtitle says exactly that, because "Related" on its own invites the
     stronger reading.

     ONLY NAMES WITH A CARD GET A LINK, by the rule this file already keeps
     for the switch list: a link that opens nothing is worse than no link. A
     ranked name with no card is still shown — it is part of the answer — but
     as text rather than as a door. */
  function paintRelated(card) {
    const host = $("ftRel"), list = $("ftRelL"), sub = $("ftRelS");
    if (!host || !list) return;
    list.replaceChildren();
    const mine = typeof card.sector === "string" && card.sector.trim()
      ? card.sector.trim() : null;
    const rows = mine && switchRows
      ? switchRows.filter((r) => r.sector === mine && r.t !== card.ticker)
      : [];
    /* RANKED BY THE SCORE'S MAGNITUDE, which is how this product orders a
       board, with the unscored at the tail rather than seated at zero. */
    const ranked = rows.slice().sort((a, b) => {
      const x = isNum(a.s), y = isNum(b.s);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return Math.abs(y) - Math.abs(x);
    });
    const CAP = 8;
    for (const r of ranked.slice(0, CAP)) {
      const sc = isNum(r.s);
      const chip = el(r.card === false ? "span" : "a",
        "ft-rel-c" + (sc === null ? "" : " " + P.polarity(sc)));
      if (r.card !== false) chip.href = "/flows/ticker/?t=" + encodeURIComponent(r.t);
      chip.append(el("span", "ft-rel-t", r.t));
      chip.append(el("span", "ft-rel-v", sc === null ? DASH : P.signed(sc, (a) => String(a))));
      chip.title = (r.card === false ? r.t + " was ranked but has no card, so there is nothing to open. " : "")
        + (sc === null ? "No score published for this name." : "Options score " + P.signed(sc, (a) => String(a)) + ".")
        + (r.chg === null ? "" : " Session move " + P.pct1(r.chg) + ".");
      list.append(chip);
    }
    if (sub) {
      sub.textContent = !mine
        ? "This card publishes no sector, so no peer set can be drawn."
        : switchRows === null
          /* THE BOARDS HAVE NOT BEEN READ, WHICH IS NOT AN EMPTY SECTOR. This
             said "No other Energy name was ranked on today's boards" before a
             single board had been fetched — a measurement claimed over a key
             nobody had opened, which is the exact collapse this product
             refuses everywhere else. */
          ? "Reading today's boards for the other names in " + mine + "\u2026"
        : boardsWhy === "unreadable"
          ? "Today's boards did not come back, so the other " + mine +
            " names cannot be named. That is this page's failure to read them, " +
            "not a quiet sector."
        : boardsWhy === "pending"
          ? "Today's boards have not been published yet, so there is nothing to " +
            "compare this name against."
        : boardsWhy
          ? "Today's boards were read and carried no rows at all, so no " + mine +
            " peer can be named."
        : ranked.length
          ? (ranked.length > CAP ? CAP + " of " + ranked.length : String(ranked.length)) +
            " other " + mine + " name" + (ranked.length === 1 ? "" : "s") +
            " on today's boards, by score. Ranked together, not modelled together."
          : "No other " + mine + " name was ranked on today's boards.";
    }
    host.hidden = !mine;
  }

  function paintFlags(card, chg) {
    const host = $("ftFlags");
    if (!host) return;
    host.replaceChildren();

    const marks = [];
    const score = isNum(card.score);
    const conv = isNum(card.conviction);

    const sd = sideOf(card, chg);
    if (sd.word && score !== null) {
      marks.push([sd.word === "bullish" ? "Bullish flow" : "Bearish flow",
        sd.word === "bullish" ? "is-pos" : "is-neg", sd.title]);
    }

    /* THE MOVE, WITH ITS SPAN AND ONLY WHERE IT IS ABOUT THIS SESSION.

       Two guards, and each one is a claim this flag would otherwise make
       falsely. `gap` is how many sessions the move spans: +23 over one
       session and +23 over five, with the name off the board in between, are
       different facts, so the span rides in the title. `stale` is how far the
       newest SCORED session is from the newest session in the window: a flag
       reading "Score down" off a reading taken a week ago claims an event
       that did not happen today, which is the trap the ranked rows on the
       landing page already name. Stale readings get no flag; the change
       region below still lists them, dated, which is where a reading that is
       not about today belongs. */
    const d1 = chg && chg.status === "ok" ? chg.d1 : null;
    const move = d1 ? isNum(d1.v) : null;
    if (move !== null && isNum(d1.gap) !== null && chg.stale === 0 && Math.abs(move) >= 10) {
      /* THREE ARMS, though the |move| >= 10 guard above means the third can
         never fire today. It is written because the guard is a THRESHOLD and
         thresholds get tuned: the day someone lowers it to 0 this line would
         start calling a measured-flat session "Score down" in red, and the
         defect would be one edit away with nothing pointing at it. The class
         comes from the shared polarity() rather than a fourth local copy. */
      marks.push([move > 0 ? "Score up" : move < 0 ? "Score down" : "Score flat",
        P.polarity(move),
        P.signed(move, (a) => String(a)) + " score points over " +
        d1.gap + (d1.gap === 1 ? " session" : " sessions") +
        ", against a threshold of 10."]);
    }

    if (conv !== null && conv >= 70) {
      marks.push(["High conviction", "",
        "Conviction " + Math.round(conv) + ", against a threshold of 70. Conviction is " +
        "how strongly the components agree, not how large the move is."]);
    }

    /* UNUSUAL ACTIVITY IS THE TAPE'S OWN COUNT, not a judgement made here.
       The top-contracts panel publishes how many lines it drew and the
       aggressor panel whether any of them were lifted; either being present
       and non-empty is what the vendor's rules already flagged. */
    const top = card.panels && card.panels.topContracts;
    const rows = top && top.status === "ok" && Array.isArray(top.rows) ? top.rows.length : 0;
    if (rows >= 10) {
      marks.push(["Unusual activity", "",
        rows + " contract lines carried enough volume to make this name's tape panel, " +
        "against a threshold of 10."]);
    }

    /* A CROSS-SECTION FLAG WAS DRAFTED HERE AND IS NOT SHIPPED, because the
       field it wanted does not exist. marketRank publishes no single
       percentile for a name: it carries a per-FEED block, each with its own
       population, its own `asOf` and its own rank within that feed — so "top
       decile" would have to pick one feed and present it as the name's place
       in the session, which is a claim the payload deliberately refuses to
       make. The panel states all of them, ranked, with their populations. A
       flag that flattened that would be inventing the number the panel exists
       to avoid inventing. */

    for (const [label, cls, why] of marks) {
      const chip = el("span", "ft-flag" + (cls ? " " + cls : ""), label);
      chip.title = why;
      host.append(chip);
    }
    host.hidden = !marks.length;
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

    /* HOW FAR SPOT IS FROM THE LEVEL WHERE DEALER HEDGING REVERSES SIGN.

       This is the most forward-looking number the card carries — every other
       reading in the header describes where the name IS — and it was sitting
       at panel 4 of 22 in the `reading` tier, which is the de-emphasised
       chrome, while the header above it held a hidden <span id="ftQuote">
       whose own comment promised "spot, today's change, ATR, the gamma flip
       and its distance". That span was emitted, styled by four CSS rules, and
       written to by nothing: `grep ftQuote` found no JavaScript anywhere. It
       is gone now, and the header carries what it promised.

       READ, NOT RE-DERIVED. `card.gammaFlip` and `card.atr` are both on the
       top level and the arithmetic is two lines, which is exactly why it is
       tempting — and it is how one quantity ends up with two conventions.
       buildLevels already measures this as `(px - spot) / spot` and
       `(px - spot) / atr` (shared/flows-card.js:222-226), so the header reads
       that measurement rather than making a second one that could drift from
       it by a sign or a denominator. If the panel could not resolve a flip,
       neither can this chip, and it says so.

       GEOMETRY, NOT OPINION. The levels table states the rule this follows:
       distance carries a direction — above spot or below it — and that is not
       a bullish or bearish claim, so it is NOT tinted with the directional
       palette. `is-above`/`is-below` here mirror .fc-levels exactly.

       AND THE BAND IT WAS MEASURED INSIDE IS NAMED. The ladder is fetched over
       a window around spot, so "no flip" means no sign change WITHIN THAT
       WINDOW rather than nowhere in the book. A reader told only "no flip"
       would take it for a fact about the name. */
    const levelsPanel = card.panels && card.panels.levels;
    const flipLevel = levelsPanel && levelsPanel.status === "ok" &&
      Array.isArray(levelsPanel.levels)
      ? levelsPanel.levels.find((l) => l && l.kind === "gamma_flip") || null
      : null;
    const flipPct = flipLevel ? isNum(flipLevel.distPct) : null;
    const flipAtr = flipLevel ? isNum(flipLevel.distAtr) : null;
    const regime = card.regime || null;
    const bandLo = regime ? isNum(regime.bandMin) : null;
    const bandHi = regime ? isNum(regime.bandMax) : null;
    const bandSaid = bandLo !== null && bandHi !== null
      ? " The ladder was read over $" + bandLo.toFixed(2) + " to $" + bandHi.toFixed(2) +
        ", so this is the nearest sign change inside that window rather than in the whole book."
      : "";

    let flipNode;
    if (flipPct === null) {
      /* ABSENCE BEFORE COERCION, and the sentence matters more here than in
         most slots: 0% would read as "spot is sitting exactly on the flip",
         which is the single most actionable state this page can report. It is
         the opposite of what an unresolved ladder means. */
      flipNode = idChip("ftFlip", "", DASH, {
        empty: "unavailable",
        title: levelsPanel && levelsPanel.status === "ok"
          ? "No gamma flip resolved on this name's ladder, so there is no distance to " +
            "one. That is not a distance of zero — a book with no sign change over the " +
            "strikes read has no flip to be near." + bandSaid
          : "The levels panel is unavailable for this name today, so the distance to the " +
            "gamma flip was not measured." + bandSaid,
      });
    } else {
      /* UNITS TRAVEL WITH THE NUMBER, and there are two of them because they
         answer different questions. The percent says how far in price; the ATR
         multiple says how far in THIS name's own daily range, which is the one
         that compares across names — 3% is a routine day in one book and a
         three-sigma move in another. distAtr is null rather than Infinity when
         ATR is unavailable, so the second reading is simply absent. */
      const atrSaid = flipAtr === null
        ? ""
        : " (" + P.signed(flipAtr, (a) => a.toFixed(2)) + " ATR)";
      /* THE CLASS IS TWO-ARMED AND THE SENTENCE IS THREE-ARMED, deliberately.
         `is-above`/`is-below` is emphasis and mirrors .fc-levels exactly, so a
         zero taking the brighter of two greys costs a reader nothing. The WORD
         cannot do that: at distPct === 0 spot is sitting ON the flip, which is
         the single most actionable state this page can report, and calling it
         "above spot" would be false at the one moment it matters most. */
      const whereSaid = flipPct > 0 ? "above spot"
        : flipPct < 0 ? "below spot"
        : "exactly at spot — the name is sitting on its flip";
      flipNode = idChip("ftFlip", "", P.pct1(flipPct) + " to flip" + atrSaid, {
        cls: flipPct >= 0 ? "is-above" : "is-below",
        title: "Gamma flip at $" + flipLevel.px.toFixed(2) + ", " + whereSaid +
          ". Past it the sign of dealer " +
          "hedging reverses: the flow that has been damping moves starts amplifying " +
          "them." + (flipAtr === null
            ? " No ATR was published for this name, so the distance is stated in percent only."
            : " The second figure is that distance in this name's own average true range.") +
          bandSaid,
      });
    }

    const { text: sideText, cls: sideCls, empty: sideEmpty, title: sideTitle } =
      sideOf(card, chg);
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
    for (const node of [price, day, side, d1Node, flipNode]) {
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
      p.append(el("strong", null, quiet ? "Nothing to report \u2014 " : "Unavailable \u2014 "));
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

    /* ---- THE VERDICT, IN TWO WORDS, BEFORE THE SENTENCE ----

       WHAT THIS BLOCK ANSWERS IS "did anything happen", and a reader had to
       read a sentence to find out. The sentence is good and it stays; what it
       lacked is a headline — the one thing every other panel on this page has
       and the block a reader lands on did not.

       THE WORD IS DERIVED FROM WHAT THE PAYLOAD ALREADY DECIDED, never from a
       fresh threshold invented here: a dead-band CROSSING is an event and
       says which one; everything else is drift, and drift is named by its
       direction and nothing more. So this adds no opinion — it promotes the
       decision the change layer already published into the position a reader
       reads first.

       AND IT IS HONEST ABOUT THE FLAT CASE. A move of exactly zero is a
       measurement, so it gets its own word rather than being rounded into one
       of the two directions. A window with no earlier score gets no verdict
       at all: there is nothing to be a verdict about, and "no change" would
       be a claim.

       THE MARK IS A GLYPH AND NOT A COLOUR. The arrow says the direction to a
       reader who cannot see the hue, which is the rule every signed figure on
       this section already follows. */
    const mv = chg.d1 ? isNum(chg.d1.v) : null;
    const verdict = (() => {
      if (mv === null) return null;
      if (chg.cross === "cleared") return ["Cleared the band", "\u2191", "is-pos"];
      if (chg.cross === "faded") return ["Faded out of the band", "\u2193", "is-neg"];
      if (chg.cross === "flipped") {
        if (mv > 0) return ["Flipped bullish", "\u2191", "is-pos"];
        if (mv < 0) return ["Flipped bearish", "\u2193", "is-neg"];
        /* A FLIP IS A CROSSING, so a move of exactly zero beside one is the
           payload disagreeing with itself. The two-armed version resolved
           that contradiction by calling it BEARISH — picking a side on no
           evidence, which is the one thing this section never does. State the
           crossing, claim no direction, and let the figures below say what is
           actually known. */
        return ["Flipped", "\u2192", "is-flat"];
      }
      if (mv > 0) return ["Bullish drift", "\u2191", "is-pos"];
      if (mv < 0) return ["Bearish drift", "\u2193", "is-neg"];
      return ["Unchanged", "\u2192", "is-flat"];
    })();
    if (verdict) {
      const [word, glyph, cls] = verdict;
      const head = el("div", "ft-chg-verdict " + cls);
      const mark = el("span", "ft-chg-mark", glyph);
      mark.setAttribute("aria-hidden", "true");
      head.append(mark);
      head.append(el("span", "ft-chg-word", word));
      changeEl.append(head);
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
    /* The third sentence was navigation to a panel two screens down that
       carries that title; it is gone. The rest is the UNIT — these counts
       are on the intersection of the price window and the score archive,
       which have different lengths — and a unit is never folded away. */
    changeEl.append(el("p", "fc-note",
      "Derived from the " + SESSIONS(chg.window.sessions) + " between " + chg.window.from +
      " and " + chg.window.to + " that this card's price window shares with the score " +
      "archive, " + chg.window.scored + " of which carry a score for this name. Every " +
      "session count above counts THOSE sessions."));

    return chg;
  }

  /** Build the chrome once, before the first paint. */
  function installWorkspace() {
    buildBar();
    mountChrome();
    installStations();
    watchGroups();
    window.addEventListener("hashchange", honourHash);
  }

  async function paint(card) {
    painted = card;
    /* A NEW NAME INVALIDATES EVERY DRAWN STATION: the panels still hold the
       previous card's readings until they are drawn again. */
    drawnStations.clear();
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
    /* THREE SLOTS LEFT THIS STRIP WHEN THE HERO ARRIVED, and each one for the
       same reason: this strip is what SURVIVES THE SCROLL, and every reading
       in it is paid for in pinned height on every screen of every panel. That
       is the budget a reading has to earn.

       Conviction, the gamma regime and the two dates do not earn it, and each
       one has a home that was CHECKED rather than assumed:

         - conviction and the session date are in the hero, four lines up;
         - the regime is stated by the gamma panel, off `spotGammaShare`,
           beside the ladder it was measured from;
         - the BUILD time is in the stale banner — and only when it is a
           reading. `markStale` prints "this card was last written N days
           ago" once the age passes STALE_WRITE_MS, which is the one state in
           which a build timestamp tells a reader anything. On a fresh card it
           said "built 2026-09-12" on every screen of every panel to report
           that nothing was wrong.

       That last one is the honest exception and it is written down because
       the first draft of this comment claimed all four were "in the hero or
       one scroll away in a panel". Three were. The build time is not in a
       panel at all; it is conditional, and a comment that rounded it up to
       the other three is how a reader later concludes the page states
       something it does not.

       WHAT STAYS IS WHAT A READER DEEP IN A PANEL ACTUALLY NEEDS: which name,
       what it scores, what it costs, which way it moved. The slots are still
       served — flows-pages.js emits them and they are empty, which the page's
       own rule allows — so nothing here has to guess at markup. */

    /* CHANGE BEFORE DETAIL. paintChange returns its own derivation so the
       identity strip states the same numbers rather than deriving them a
       second time — two derivations of one move is two chances for the
       header and the block under it to disagree about the same name. */
    const chg = paintChange(card);
    /* THE HERO AND THE FLAGS TAKE THE SAME CHANGE LAYER THE STRIP DOES, for
       the reason directly above: one derivation of this name's move, read by
       every surface that states it. */
    paintHero(card, chg);
    paintCards(card);
    /* THE CHAIN AND THE LEVELS PAINT FROM THE CARD ALONE, so they are in
       this pass rather than the board handler's: both read panels the card
       payload already carries and neither waits on a second fetch. */
    paintChart(card);
    paintChain(card);
    paintBrief(card);
    paintLevels(card);
    paintFlags(card, chg);
    /* AFTER THE BOARDS ARRIVE, NOT WITH THE CARD. switchRows is filled by a
       separate fetch; when the card paints first this draws nothing and the
       board's own handler calls it again. */
    paintRelated(card);
    paintIdentity(card, chg);

    /* THE STATION IS CHOSEN BEFORE THE DRAW NOW, AND THAT REORDERING IS THE
       DEFERRAL. Panels used to be drawn for all five stations and the
       selection applied afterwards; the walk is scoped to one station, so it
       has to know which one first. applyStation still runs BEFORE honourHash,
       which is the ordering the bug note below records — ?s=all#ftg-convexity
       has to lose the hash to the query, not the other way round.

       WIDTH IS STILL MEASURED WITH EVERY STATION IN FLOW. withAllStations
       reveals the hidden ones for the duration of the draw, so each chart
       measures the width the affordance sweep asserts, exactly as before. */
    applyStation({ url: true, push: false });
    await drawStation(card, "grid");
    setStale(assessAge(card));

    /* AFTER THE PANELS EXIST, NOT BEFORE. The grid is `hidden` while the card
       is in flight, so the browser's own fragment scroll on load lands on an
       element with no box and does nothing at all — which is why a deep link
       used to drop the reader at the top of the page. */
    syncBarHeight();
    /* AFTER drawAll, AND BEFORE honourHash. Every panel is drawn with all five
       stations in flow, so the width each chart measured is the width the sweep
       asserts; only then is the selection applied and four taken out of it.

       THE ORDER OF THESE TWO IS A BUG FIX, NOT A PREFERENCE. honourHash used to
       run first, and it decides a station too — so on `?s=all#ftg-convexity` it
       fired while `station` was still null, its guard passed, and it opened
       convexity. The reader had asked for all five in the query and got one,
       because the hash was read before the query existed to lose to.
       wantedStation() already ranks them correctly (?s= first, hash second);
       running it first is what lets that ranking apply. */
    honourHash();

    /* Blank, not a sentence. It read "<TICKER> · every panel the card
       carries, drawn at page width": the ticker is in the badge above, "every
       panel" is the ABSENCE of a withholding rather than a reading, and the
       rest describes the layout. The five station leads below count what drew
       and what was withheld, per station, which is the fact a reader can act
       on. */
    statusEl.textContent = "";
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
  let boardsAsked = null;
  let boardsWhy = null;

  /* THE BOARDS, FETCHED ONCE, AND NOW FOR TWO READERS RATHER THAN ONE.

     They were fetched only when someone opened the switcher. Two things on
     this page need them and neither is the switcher: the rank chip ("3 of
     40", a board field the card carries no copy of) and the sector peer set.
     Both were therefore blank on every visit where nobody clicked.

     THE PROMISE IS KEPT, NOT THE RESULT, so a click during the idle load
     waits on the same fetch instead of starting a second pair.

     AND WHAT IT COSTS IS TWO CACHED GETS PER VISIT, said plainly: this page
     used to make them only on demand, and now makes them on every view.
     They are the same two payloads four other routes already serve, and the
     alternative was a peer strip that announces an empty sector on a page
     that simply had not looked. */
  function ensureBoards() {
    if (boardsAsked) return boardsAsked;
    boardsAsked = Promise.all([
      getJSON("/api/flows/board?side=long").catch(() => null),
      getJSON("/api/flows/board?side=short").catch(() => null),
    ]).then(([long, short]) => {
      switchRows = boardRows(long, short);
      /* WHICH SILENCE AN EMPTY LIST IS, WHICH boardRows CANNOT SAY. It maps
         `payload.rows || []`, so a board that has not published yet, one that
         failed to read, and one that genuinely ranked nobody all arrive here
         as the same empty array — and a renderer handed that array will say
         "nobody was ranked", which is a measurement over a key it never saw.
         The three are told apart from the envelopes, once, here.

         A FETCH THAT THREW IS null (the callers catch), and that is the
         page's own failure rather than the publisher's — the one silence
         this product calls unreadable. */
      const side = (p) => {
        if (!p || typeof p !== "object") return "unreadable";
        if (p.status && p.status !== "ok") return p.status;
        return Array.isArray(p.rows) ? "ok" : "unavailable";
      };
      const states = [side(long), side(short)];
      boardsWhy = states.includes("ok") ? null
        : states.includes("unreadable") ? "unreadable"
        : states.includes("pending") ? "pending"
        : states[0];
      paintRank();
      if (painted) paintRelated(painted);
      return switchRows;
    });
    return boardsAsked;
  }

  /* AFTER FIRST PAINT, NEVER DURING IT. The card is what this page is; the
     boards qualify it. requestIdleCallback where it exists, a timeout where
     it does not, so the two fetches never compete with the card's own. */
  /* THE TWO RIGHT-COLUMN FETCHES, TAKEN TOGETHER AND LATE.

     Neither the sector peers nor the flow alerts is on the card, and neither
     is above the fold, so both wait for an idle frame rather than competing
     with the payload the whole page is drawn from. They are ONE idle pass
     because they have one trigger and one deadline; splitting them would put
     two timers against the same 3s budget for no gain.

     A FAILED ALERTS READ REACHES paintFlow AS null, NOT AS A SKIPPED CALL.
     That is the difference between the card saying "this could not be read"
     and the card saying nothing at all, and only the first is true. */
  function boardsWhenIdle(ticker) {
    const go = () => {
      ensureBoards();
      if (!ticker) return;
      getJSON("/api/flows/flowalerts")
        .then((feed) => paintFlow(ticker, feed))
        .catch(() => paintFlow(ticker, null));
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1200);
  }

  function wireSwitch(card) {
    const btn = document.getElementById("ftSwitch");
    if (!btn) return;
    btn.hidden = false;
    btn.onclick = async () => {
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "Loading names…";
      try {
        await ensureBoards();
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
    /* THE TABS GO WITH THE PANELS THEY OPEN. Leaving the station row stuck to
       the top of a picker would offer five anchors into a grid that is
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
          /* TWO FIELDS THE BOARD HAS ALWAYS PUBLISHED AND THIS WALK DROPPED.
             `sector` is what makes a peer a peer, and `chg` is the session
             move — both on every board row since the board shipped. Carried
             here rather than fetched again: this list is already in hand. */
          sector: typeof row.sector === "string" && row.sector ? row.sector : null,
          chg: isNum(row.chg),
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
      boardsWhenIdle(ticker);
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
