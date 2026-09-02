/* =============================================================
   flows-board.js — the Flows board controller.

   Fetches a precomputed payload and renders it. All the arithmetic
   happened in the pipeline; this file does presentation only, which
   is the whole point of the architecture: the Worker streams stored
   bytes and the browser draws them.

   Framework-free IIFE, in the house idiom. No global is exported —
   nothing else on the page needs to talk to it.
   ============================================================= */
(() => {
  "use strict";

  const body = document.getElementById("flowsBody");
  const statusEl = document.getElementById("flowsStatus");
  const staleEl = document.getElementById("flowsStale");
  const viewButtons = Array.from(document.querySelectorAll(".flows-view"));
  const deck = document.getElementById("flowsDeck");
  const tableWrap = document.getElementById("flowsTableWrap");
  if (!body || !statusEl) return;

  const table = document.getElementById("flowsTable");
  const headCells = table
    ? Array.from(table.querySelectorAll("thead th"))
    : [];

  /* THE COLUMN COUNT IS READ, NOT DECLARED.
     It used to be the constant 10 with a comment asking the next person to
     keep it in sync with the <thead> in flows-pages.js. Two files holding one
     number is how the empty-state row ends up spanning nine of eleven columns
     and the "no name cleared the band" explanation sits under a ragged edge —
     a silent, cosmetic-looking break that nothing tests. The header is the
     authority on how many columns there are, so it is asked. The literal
     survives only as the fallback for a page that somehow has no table. */
  const COLUMNS = headCells.length || 10;
  const cache = new Map();           // side -> payload
  const inflight = new Map();        // side -> { promise, controller }
  const side = initialSide();        // fixed by the route, not by a control
  // Which side's rows are actually on screen right now, as opposed to which
  // side was requested. They diverge for the duration of every fetch.
  let painted = null;

  /* ---------- formatting -----------------------------------------
     One place for every number. The rule throughout: never print a
     precision the data does not have. A missing value renders as an
     em dash, never as 0.00, because a confident zero is a lie. */

  const MINUS = "−";            // U+2212, not a hyphen
  const DASH = "—";
  /* ONE SENTENCE FOR THE ABSENCE, said the same way on the deck, in the
     table and to a screen reader. A reader who notices that some rows open
     and others do not is owed the reason in the place they noticed it. */
  const NO_CARD_SAID =
    "No detail card: the chain and the card cost vendor calls the run spends " +
    "only on the names furthest from neutral. This row is scored and ranked " +
    "from the same five sources as every other.";

  /* NULL IS NOT ZERO, AND Number() DISAGREES.
     `Number(null)` is 0 and `Number("")` is 0, both finite, so the original
     coercion answered "0" for a value the payload had explicitly declared
     missing — and every formatter below trusts this function to tell it the
     difference. That is precisely the confident zero the rule above forbids,
     manufactured by the one helper meant to prevent it: a name with no
     variance premium printed "0.0", a name with no conviction printed
     "0 conv", and a board with a null dispersion took `payload.dispersion !==
     null` as true and then threw on `.toFixed`. The one place it was noticed,
     `gFlipDist`, works around it with an inline `== null` guard rather than
     fixing it here; the guard is now redundant and harmless.
     Missing is tested BEFORE coercion, so only a real number gets through. */
  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const signed = (n, digits) => {
    const s = Math.abs(n).toFixed(digits);
    return n < 0 ? MINUS + s : n > 0 ? "+" + s : s;
  };

  function fmtPrice(v) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(2);
  }

  function fmtPct(v, digits) {
    const n = isNum(v);
    return n === null ? DASH : signed(n * 100, digits) + "%";
  }

  function fmtInt(v) {
    const n = isNum(v);
    return n === null ? DASH : String(Math.round(n));
  }

  function fmtSignedInt(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    const r = Math.round(n);
    return r < 0 ? MINUS + Math.abs(r) : r > 0 ? "+" + r : "0";
  }

  function fmtRatio(v) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(2);
  }

  function fmtMoney(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    const abs = Math.abs(n);
    const sign = n < 0 ? MINUS : "";
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return sign + "$" + Math.round(abs / 1e3) + "K";
    return sign + "$" + Math.round(abs);
  }

  /* A POSITION IN A RANGE, printed as a whole percent.

     Used for `w52` (where the last close sits between the 52-week low and
     high) and `ivr` (where 30-day implied vol sits in its own past year).
     Both arrive as FRACTIONS on 0..1 and both are positions rather than
     changes, so they get no sign: "+72%" of a range would read as a move.

     `w52` is published to three decimals and `ivr` to three, so a tenth of a
     percent is available and deliberately not printed. Whole percents are
     less precision than the data has, which is the safe direction; the
     unsafe direction is the one this file's formatting rule forbids. */
  function fmtPosition(v) {
    const n = isNum(v);
    return n === null ? DASH : Math.round(n * 100) + "%";
  }

  /* THE VARIANCE RISK PREMIUM, in annualised volatility points.

     `vrp` is iv30 − rv30: the screener's 30-day implied volatility minus
     close-to-close realised volatility over the 21 sessions that span the
     same thirty calendar days. Both legs are annualised fractions of the same
     underlying over the same horizon, so their difference is annualised
     volatility points and nothing else — no rate, no dividend, no free
     parameter anywhere in it.

     It is a DIFFERENCE BETWEEN TWO MEASUREMENTS and it is printed as one. It
     is not an edge, not an expected return, and not a variance premium in the
     swap sense (that is a variance, quoted in variance units, and this is a
     difference of vols). Signed, because the sign is the whole content of the
     number, and with U+2212 for the negative like every other signed column.

     Published to four decimals, so a hundredth of a point is available; one
     decimal is printed because a column of 25 names is read by comparison and
     0.01 vol points is below the noise of either leg. */
  function fmtVolPoints(v) {
    const n = isNum(v);
    return n === null ? DASH : signed(n * 100, 1);
  }

  /* ---------- DOM helpers ---------------------------------------- */

  function cell(text, className, title) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;          // textContent everywhere: no escaping to forget
    if (title) td.title = title;
    return td;
  }

  /**
   * What a published conviction is mostly made of.
   *
   * THE BOARD SORTS ON A COMPOSITE AND SHOWED ONLY THE COMPOSITE. Conviction
   * is a weighted sum of three terms, and the heaviest of them — agreement,
   * how many of the signed axes point the same way — can take only three
   * values because there are only three axes. So the number's largest single
   * input is a CATEGORY, and a column of them orders names partly by category
   * and partly by degree with no way to tell the two apart: on the emitted
   * corpus the values cluster at 60-66, 75-82 and 90-96, one cluster per
   * agreement level, and a reader comparing 66 against 75 is comparing across
   * a category boundary while one comparing 75 against 82 is not.
   *
   * NO WEIGHTS ARE NAMED HERE. The full arithmetic, with the weights the
   * pipeline actually used, is on the card — restating them in a second file
   * is how a page ends up describing a blend that has since moved.
   */
  function convictionTitle(row) {
    const agree = isNum(row && row.agr);
    const breadth = isNum(row && row.bth);
    if (agree === null || breadth === null || breadth <= 0) return "";
    return agree + " of " + breadth + " signed axes agree, which is the heaviest of the " +
      "three terms behind this number. It is a COUNT out of " + breadth + ", so it moves in " +
      "steps and never smoothly, and two names a few points apart may differ by a whole axis " +
      "or by nothing but coverage. The full arithmetic is on the name's own card.";
  }

  function toneClass(v) {
    const n = isNum(v);
    if (n === null || n === 0) return "fb-flat";
    return n > 0 ? "fb-pos" : "fb-neg";
  }

  function scoreCell(score) {
    const n = isNum(score);
    const td = document.createElement("td");
    td.className = "fb-score c-num " + toneClass(n);
    if (n !== null && n < 0) td.classList.add("is-neg");
    const bar = document.createElement("span");
    bar.className = "fb-bar";
    bar.style.setProperty("--w", n === null ? 0 : Math.min(Math.abs(n) / 100, 1));
    const label = document.createElement("span");
    label.textContent = fmtSignedInt(n);
    td.append(bar, label);
    return td;
  }

  /* Set from the payload on every render. Before version 2, fam.V and fam.O
     were SIGNED votes rather than unsigned gauges, so a v1 board's V and O must
     not be drawn on the signed glyph as though nothing had changed. */
  let legacyFamilies = false;
  // The horizon every `hm` on the board is stated in, read from the payload
  // rather than assumed, so the tooltip cannot outlive a change to it.
  let horizonSessions = null;
  /* DOES THIS PAYLOAD KNOW ABOUT DEEP ROWS AT ALL?

     THE BUG THIS EXISTS TO PREVENT WOULD HAVE BEEN LIVE FOR A DAY. Assets
     deploy the moment `main` moves; the pipeline runs once, the next morning.
     So between the two there is always a window where NEW JavaScript is
     reading an OLD board — and an old board has no `dp` on any row, because
     the field did not exist when it was written. A renderer that treats
     "no dp" as "no card" would have made every single name on the board
     unclickable until the next pipeline run, silently, on a page whose whole
     purpose is opening those cards.

     The test is on the PAYLOAD, not the row: `deep` is a count the board
     publishes alongside `deepRule`, so its absence means "this board predates
     the distinction", and every row on such a board does have a card. A row's
     own missing `dp` on a board that DOES publish `deep` is a real answer. */
  let knowsDeep = false;

  function familyCell(fam) {
    const td = document.createElement("td");
    td.className = "c-num";
    const keys = ["F", "P", "D", "V", "O"];
    const wrap = document.createElement("span");
    wrap.className = "fb-fam";
    const parts = [];
    for (const k of keys) {
      /* V AND O CARRY NO DIRECTION. The card's own family track was rebuilt to
         draw them from the baseline for exactly that reason; this glyph went on
         drawing them on the signed centre line, so the live board announced
         "V +55, O +62" with gold bars growing UP from the zero rule — the same
         drawing a +55 bullish vote gets. An unsigned gauge on a signed axis is
         the confusion the whole three-axes-plus-two-gauges split exists to end.

         On a v1 board they WERE signed votes, but of different families, so the
         meaning moved and they stay withheld there. */
      const gauge = k === "V" || k === "O";
      const n = legacyFamilies && gauge ? null : isNum(fam && fam[k]);
      const i = document.createElement("i");
      i.style.setProperty("--h", n === null ? 0 : Math.min(Math.abs(n) / 100, 1));
      // Sign is drawn as direction from a centre line, not as a colour swap.
      // A MISSING family gets its own mark: it used to render as a short
      // positive stub, which read as a small bullish contribution.
      if (n === null) i.className = "is-null";
      else if (gauge) i.className = "is-gauge";
      else if (n < 0) i.className = "is-neg";
      wrap.append(i);
      // A gauge gets no sign in the readout either: "V 55", not "V +55".
      parts.push(k + " " + (n === null ? DASH : gauge ? String(n) : fmtSignedInt(n)));
    }
    // The glyph is decorative; the numbers must still be readable to
    // a screen reader and on hover.
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "Family scores: " + parts.join(", "));
    wrap.title = parts.join("  ");
    td.append(wrap);
    return td;
  }

  /* ---------- the deck ---------------------------------------------
     One payload, two renderers, exactly one mounted at a time.

     The deck is the default because the table's ten columns are wider than
     any phone viewport — the table lives inside a horizontally scrolling
     region for precisely that reason, and seven of its columns are off-screen
     on a phone before a finger touches it.

     A card is ONE tab stop and the whole card is the target. Splitting it into
     a ticker button plus decorative regions would put five stops on every card
     and make a 25-name board a 125-stop obstacle. */

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  /** Unpack the 84-character sparkline: two base-64 characters a session. */
  function unpackSpark(str) {
    if (typeof str !== "string" || str.length < 4 || str.length % 2) return null;
    const out = [];
    for (let i = 0; i < str.length; i += 2) {
      const hi = B64.indexOf(str[i]), lo = B64.indexOf(str[i + 1]);
      if (hi < 0 || lo < 0) return null;
      out.push((hi << 6) | lo);
    }
    return out;
  }

  function sparkSvg(values, up) {
    const W = 120, H = 30, pad = 2;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "fd-spark " + (up ? "is-pos" : "is-neg"));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const xOf = (i) => pad + (i / (values.length - 1)) * (W - pad * 2);
    // The samples are already normalised to the window's own extremes, so
    // 0 is the window low and 4095 the high — no rescaling here.
    const yOf = (v) => pad + (1 - v / 4095) * (H - pad * 2);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "fd-sparkline");
    path.setAttribute("d", values.map((v, i) =>
      (i ? "L" : "M") + xOf(i).toFixed(1) + " " + yOf(v).toFixed(1)).join(" "));
    svg.append(path);
    return svg;
  }

  /** One period-return chip. Basis points in, a signed percent out. */
  function retChip(label, bp) {
    const n = isNum(bp);
    const chip = document.createElement("div");
    chip.className = "fd-ret " + (n === null ? "is-flat" : n > 0 ? "is-pos" : n < 0 ? "is-neg" : "is-flat");
    const k = document.createElement("span");
    k.className = "fd-ret-k";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "fd-ret-v";
    v.textContent = n === null ? DASH : (n >= 0 ? "+" : MINUS) + (Math.abs(n) / 100).toFixed(1) + "%";
    chip.append(k, v);
    return chip;
  }

  function deckCard(row, index) {
    /* NOT EVERY ROW HAS A CARD, and the deck has to say so BEFORE the click.

       The board is built from data already fetched, so it costs nothing to
       publish a hundred names. A detail card is not free — it is two more
       vendor calls a name — so the pipeline builds them only for the names
       furthest from neutral and stamps `dp` on the rows that got one.

       A row without `dp` therefore renders as a plain element, not a button:
       no pointer cursor, no tab stop, no aria-haspopup, no prefetch, and no
       `data-t` — which is what actually keeps it out of the click delegation
       in flows-card.js, since a missing attribute cannot be styled around.
       The alternative is 43 cards that look identical to the other 50 and
       open a fetch for a key the pipeline never wrote. */
    const deep = !knowsDeep || row.dp === 1;
    const card = document.createElement(deep ? "button" : "div");
    if (deep) card.type = "button";
    card.className = deep ? "fd-card" : "fd-card fd-flat";
    card.setAttribute("role", "listitem");
    if (deep) {
      card.dataset.t = String(row.t || "");
      card.setAttribute("aria-haspopup", "dialog");
      card.addEventListener("pointerenter", () => {
        if (window.flowsCardPrefetch && row.t) window.flowsCardPrefetch(String(row.t));
      });
    }

    const score = isNum(row.s);

    const head = document.createElement("div");
    head.className = "fd-head";
    const rank = document.createElement("span");
    rank.className = "fd-rank";
    rank.textContent = fmtInt(row.r != null ? row.r : index + 1);
    const tk = document.createElement("span");
    tk.className = "fd-tk";
    tk.textContent = String(row.t || DASH);
    const sc = document.createElement("span");
    sc.className = "fd-score " + toneClass(score);
    sc.textContent = score === null ? DASH : (score > 0 ? "+" : score < 0 ? MINUS : "") + Math.abs(score);
    head.append(rank, tk, sc);
    card.append(head);

    const price = document.createElement("div");
    price.className = "fd-price";
    const px = document.createElement("span");
    px.className = "fd-px";
    px.textContent = fmtPrice(row.px);
    const chg = document.createElement("span");
    chg.className = "fd-chg " + toneClass(row.chg);
    chg.textContent = fmtPct(row.chg, 2);
    price.append(px, chg);
    card.append(price);

    const spark = unpackSpark(row.spark);
    if (spark && spark.length >= 2) {
      card.append(sparkSvg(spark, spark[spark.length - 1] >= spark[0]));
    } else {
      const gap = document.createElement("div");
      gap.className = "fd-spark is-empty";
      card.append(gap);
    }

    const rets = document.createElement("div");
    rets.className = "fd-rets";
    const pr = Array.isArray(row.pr) ? row.pr : [];
    rets.append(retChip("5D", pr[0]), retChip("21D", pr[1]), retChip("42D", pr[2]));
    card.append(rets);

    /* The score bar grows from the CENTRE, so the sign is geometric and a
       colour-blind reader gets it from position rather than hue — the same
       rule the card's own family track follows. */
    const track = document.createElement("div");
    track.className = "fd-track";
    const zero = document.createElement("b");
    zero.className = "fd-zero";
    const bar = document.createElement("i");
    bar.className = score !== null && score < 0 ? "is-neg" : "is-pos";
    bar.style.setProperty("--w", score === null ? 0 : Math.min(Math.abs(score) / 100, 1));
    track.append(zero, bar);
    card.append(track);

    const foot = document.createElement("div");
    foot.className = "fd-foot";
    const conv = document.createElement("span");
    conv.textContent = isNum(row.cnv) === null ? DASH : row.cnv + " conv";
    /* WHAT THE COMPOSITE IS MOSTLY MADE OF, on the number the board sorts by.
       See convictionTitle: agreement is three-valued and carries the heaviest
       weight, so two nearby convictions can differ by a whole axis. */
    const convWhy = convictionTitle(row);
    if (convWhy) conv.title = convWhy;
    /* The move priced over a FIXED horizon — the same number of sessions for
       every card on the board. The vendor's own implied_move_perc is quoted to
       each name's next listed expiry, so a column of those is a column of
       different horizons: on this board one name quoted 7.1% to an expiry four
       days out while its ten-session move was 13.0%. Setting two such numbers
       side by side is a category error, so `im` stays on the card, where its
       expiry is named, and the deck shows `hm`.

       It is a price, not a prediction, and it is labelled "priced" for exactly
       that reason. */
    const move = document.createElement("span");
    move.className = "fd-move";
    move.textContent = isNum(row.hm) === null ? "" : "\u00b1" + (row.hm * 100).toFixed(1) + "% priced";
    if (isNum(row.hm) !== null) {
      move.title = horizonSessions
        ? `The option market prices ±${(row.hm * 100).toFixed(1)}% over ${horizonSessions} trading sessions` +
          (isNum(row.hr) !== null ? `; this name has delivered ±${(row.hr * 100).toFixed(1)}% over the same horizon.` : ".")
        : "";
    }
    const reg = document.createElement("span");
    reg.className = row.gRegime === "short" ? "fb-neg" : "";
    reg.textContent = regimeText(row.gRegime);
    foot.append(conv, move, reg);
    card.append(foot);

    card.setAttribute("aria-label",
      `${row.t}, rank ${row.r != null ? row.r : index + 1}, score ${score === null ? "unavailable" : score}, ` +
      `last ${fmtPrice(row.px)}, ${fmtPct(row.chg, 2)} today, conviction ${row.cnv}` +
      /* A SCREEN READER GETS THE CATEGORY TOO, because the title attribute
         above is a hover affordance and this is the same fact. */
      (isNum(row.agr) === null || isNum(row.bth) === null
        ? ". "
        : `, with ${row.agr} of ${row.bth} signed axes agreeing. `) +
      (isNum(row.hm) === null ? ""
        : `The option market prices plus or minus ${(row.hm * 100).toFixed(1)} percent over ` +
          `${horizonSessions || 10} trading sessions. `) +
      (deep ? `Open the detail card.` : NO_CARD_SAID));
    return card;
  }

  function regimeText(v) {
    if (v === "long") return "long Γ";
    if (v === "short") return "short Γ";
    return DASH;
  }

  /* ---------- the column model -------------------------------------

     ONE ARRAY, IN THEAD ORDER. Sorting needs a value getter per column and
     the header needs to know which getter belongs to which <th>; the markup
     lives in shared/flows-pages.js, which this file does not own and cannot
     stamp with data attributes. So the binding is POSITIONAL: COLS[i]
     describes the i-th <th>. That makes the array's order load-bearing in
     exactly the way the old COLUMNS constant was, with one difference that
     matters — get it wrong and every header sorts by the wrong column
     visibly, on the first click, rather than failing silently.

     `get` returns a comparable value or null. Null is not a value here: see
     the comparator. `first` is the direction the FIRST click applies, which
     is descending for every measurement — nobody opens a ranked board to find
     the least convicted name — and ascending for the two columns where small
     is the natural start of the list, rank and ticker.

     The families column has no entry. F·P·D·V·O is five numbers on three
     signed axes plus two unsigned gauges, and there is no single order over
     it that is not an invented weighting; a header that sorted by, say, F
     alone while showing all five would be a lie about what was ranked. It
     stays unsortable and says nothing rather than guessing. */
  const RANK = (row, index) => (row.r != null ? isNum(row.r) : index + 1);

  const COLS = [
    { key: "r",     kind: "num",  first: "asc",  name: "Rank", get: RANK },
    { key: "t",     kind: "text", first: "asc",  name: "Ticker", get: (row) => (row.t ? String(row.t) : null) },
    // "Last" holds a price and a day change in one cell. It sorts by the
    // price, because that is the number in the larger type; sorting by the
    // change would reorder against the digits the eye is tracking.
    { key: "px",    kind: "num",  first: "desc", name: "Last price", get: (row) => isNum(row.px) },
    { key: "s",     kind: "num",  first: "desc", get: (row) => isNum(row.s) },
    { key: "cnv",   kind: "num",  first: "desc", get: (row) => isNum(row.cnv) },
    null,                                        // F·P·D·V·O — see above
    /* Π IS WITHHELD ON A v1 BOARD and so is the sort. The value is still in
       the payload, so a naive comparator would happily rank 25 rows by a
       number every one of which renders as an em dash: an order the reader
       can see but cannot account for, produced by the exact quantity this
       renderer just refused to show them. When it is not drawn it is not
       sortable, and the header says so. */
    { key: "purity", kind: "num", first: "desc", name: "Purity", withheld: () => legacyFamilies,
      get: (row) => (legacyFamilies ? null : isNum(row.purity)) },
    { key: "gRegime", kind: "text", first: "asc", name: "Gamma regime",
      get: (row) => (row.gRegime === "long" || row.gRegime === "short" ? row.gRegime : null) },
    { key: "gFlipDist", kind: "num", first: "desc", name: "Distance to the gamma flip", get: (row) => isNum(row.gFlipDist) },
    { key: "netPrem", kind: "num", first: "desc", name: "Net premium", get: (row) => isNum(row.netPrem) },
    { key: "w52",   kind: "num",  first: "desc", name: "52-week range position", get: (row) => isNum(row.w52) },
    { key: "vrp",   kind: "num",  first: "desc", name: "Implied minus realised volatility", get: (row) => isNum(row.vrp) },
    { key: "ivr",   kind: "num",  first: "desc", name: "Implied volatility rank", get: (row) => isNum(row.ivr) },
  ];

  /* THE THREE COLUMNS THAT ARRIVE LAST need markup this file cannot write,
     so every one of them is FEATURE-DETECTED against the header rather than
     assumed. Until the <th> exists the cell is not built, and the row stays
     exactly as wide as the header it sits under. A tbody one cell wider than
     its thead is not a layout bug that shows up in review; it is a table
     whose last column has no accessible name at all. */
  const EXTRA_CELLS = [
    { at: 10, build: (row) => cell(fmtPosition(row.w52), "c-num") },
    { at: 11, build: (row) => cell(fmtVolPoints(row.vrp), "c-num") },
    { at: 12, build: (row) => cell(fmtPosition(row.ivr), "c-num") },
  ];

  /* ---------- sorting ----------------------------------------------

     SORTING IS A PROPERTY OF ROWS ALREADY IN THE BROWSER. The whole payload
     is here — 25 rows, every column of them — so a sort never touches the
     network, never invalidates the cache and never repaints the status line.
     It reorders an array and redraws.

     BOTH RENDERERS REORDER. The deck and the table are two drawings of one
     row set, and letting them disagree about the order would mean the answer
     to "which name is at the top" depended on which button was pressed last.
     The rank badge on each card keeps saying what the pipeline ranked it, so
     a reordered deck is still legible as a departure from the published
     order rather than a replacement for it. */
  let sortKey = null;       // null is the published order, which is a state
  let sortDir = "desc";
  let currentRows = [];

  const colByKey = (key) => COLS.find((c) => c && c.key === key) || null;
  const colIndex = (key) => COLS.findIndex((c) => c && c.key === key);

  /** Is this column drawn on the page as it stands, and sortable right now? */
  function sortable(col) {
    if (!col) return false;
    const i = colIndex(col.key);
    if (i < 0 || i >= headCells.length) return false;   // header not shipped yet
    return !(col.withheld && col.withheld());
  }

  /**
   * NULLS SORT LAST REGARDLESS OF DIRECTION.
   *
   * This is the rule the desk table already states as "unmeasured never wins
   * a ranking", and reversing a sort is where it is easiest to lose: negate
   * the comparator wholesale and every name the pipeline could not measure
   * floats to the top of the board, where the reader reads position as
   * ranking and concludes that the absence of a number was the strongest
   * reading of it. A missing measurement is not a small value and it is not a
   * large one. It is at the bottom in both directions, and the direction is
   * applied to the comparison of two PRESENT values only.
   */
  function compareBy(col, dir, a, b, ai, bi) {
    const x = col.get(a, ai);
    const y = col.get(b, bi);
    const xn = x === undefined ? null : x;
    const yn = y === undefined ? null : y;
    if (xn === null && yn === null) return 0;
    if (xn === null) return 1;
    if (yn === null) return -1;
    const d = col.kind === "text"
      ? String(xn).localeCompare(String(yn))
      : xn - yn;
    return dir === "asc" ? d : -d;
  }

  /** The rows in the order they should be drawn, each with its PUBLISHED index. */
  function orderedRows() {
    const view = currentRows.map((row, index) => ({ row, index }));
    const col = sortKey ? colByKey(sortKey) : null;
    if (!col || !sortable(col)) return view;
    /* The tie-break on the published index is written out rather than left to
       the engine's stable sort. It is not defensive clutter about stability:
       it says what a tie MEANS on this board, which is "the pipeline already
       ranked these two and that ranking stands". Sorting by Γ regime is two
       buckets over 25 names; without this the inside of each bucket would be
       whatever order fell out. */
    view.sort((p, q) => compareBy(col, sortDir, p.row, q.row, p.index, q.index) || p.index - q.index);
    return view;
  }

  /**
   * The sort state in the URL, for the same three reasons the view toggle is
   * there — read the comment on selectView(). This page is credential-gated
   * and per-user, so nothing it writes should outlive a sign-out on a shared
   * browser; storage.js owns browser-local persistence on this site and this
   * page does not load it; and a URL is shareable where a per-browser flag is
   * not. A sorted board is exactly the kind of thing one reader sends another
   * — "look at this by conviction" is a link, not an instruction — which is
   * the argument the view toggle makes and it is stronger here.
   *
   * The published order is the default, so it is spelled by the parameters'
   * ABSENCE, the same rule ?view=deck follows: stamping ?sort=r&dir=asc on
   * every visit would turn a default into a decision the reader has to have
   * made.
   */
  function readSort() {
    try {
      const q = new URL(location.href).searchParams;
      const col = colByKey(q.get("sort"));
      if (!col) return;
      // A key whose header has not shipped is ignored rather than honoured:
      // an invisible column silently reordering the board is worse than a
      // link that lands on the published order.
      if (colIndex(col.key) >= headCells.length) return;
      /* The same refusal for a column already known to be withheld. Most
         withholding is decided by the payload, which has not arrived when
         this runs — render() re-checks sortKey against sortable() once it
         has — but a key unsortable before any payload should not become the
         sort either. */
      if (!sortable(col)) return;
      sortKey = col.key;
      sortDir = q.get("dir") === "asc" ? "asc" : q.get("dir") === "desc" ? "desc" : col.first;
    } catch { /* deep-linking is a convenience, never a requirement */ }
  }

  function writeSort() {
    try {
      const url = new URL(location.href);
      if (sortKey) {
        url.searchParams.set("sort", sortKey);
        url.searchParams.set("dir", sortDir);
      } else {
        url.searchParams.delete("sort");
        url.searchParams.delete("dir");
      }
      history.replaceState(null, "", url);
    } catch { /* as above */ }
  }

  /**
   * Click through: first click sorts the column its natural way, second
   * reverses it, third returns the board to the order the pipeline published.
   *
   * THE PUBLISHED RANK MUST BE RECOVERABLE. It is the one ordering this page
   * exists to show, and a table that can be sorted away from it with no way
   * back has thrown away its own answer. Two routes back, deliberately: the
   * third click on any column, and the "#" column, which sorts by rank and
   * ascending rank IS the published order.
   */
  function toggleSort(key) {
    const col = colByKey(key);
    if (!col || !sortable(col)) return;
    if (sortKey !== key) { sortKey = key; sortDir = col.first; }
    else if (sortDir === col.first) { sortDir = col.first === "desc" ? "asc" : "desc"; }
    else { sortKey = null; sortDir = "desc"; }
    writeSort();
    syncHeaders();
    paintRows();
  }

  /**
   * aria-sort on the <th>, on every header, every time.
   *
   * It is the ONLY thing that tells a screen reader the table reordered. The
   * arrow is a glyph; the state is the attribute. Every non-current header is
   * explicitly reset to "none" rather than left as it was, because a stale
   * aria-sort on the column you just sorted away from announces two sorted
   * columns and there is only ever one.
   */
  function syncHeaders() {
    headCells.forEach((th, i) => {
      const col = COLS[i];
      const button = th.querySelector(".fb-sort");
      /* A column with no sort gets NO aria-sort at all. "none" does not mean
         "not sortable" — it means "sortable, currently unsorted" — so putting
         it on the families header would advertise an order that header can
         never produce. */
      if (!col || !button) { th.removeAttribute("aria-sort"); return; }
      /* THE ANNOUNCED STATE MUST AGREE WITH THE TABLE. A column withheld on
         this payload (sortable() false — e.g. a v1 board's purity) cannot
         have ordered anything, so it gets no aria-sort even when sortKey
         still names it; announcing "sorted descending" over rows in the
         published order is a lie only a screen reader hears. */
      const live = sortable(col);
      const on = live && sortKey === col.key;
      button.disabled = !live;
      if (!live) th.removeAttribute("aria-sort");
      else th.setAttribute("aria-sort", on ? (sortDir === "asc" ? "ascending" : "descending") : "none");
      const ind = button.querySelector(".fb-sort-ind");
      if (ind) ind.textContent = on ? (sortDir === "asc" ? "↑" : "↓") : "";
      /* THE ACCESSIBLE NAME IS SPELLED OUT, not scraped from the header.
         Half these headings are symbols — "#", "Π", "Γ₀ dist" — and a screen
         reader announcing "number sign, activate to sort" or "activate to
         sort by pi" names nothing a reader can act on. The <abbr title> in
         the markup carries the full explanation for a sighted reader; this
         is the same courtesy for everyone else. */
      button.setAttribute("aria-label",
        (col.name || (th.textContent || col.key).replace(/[↑↓]/g, "").trim()) + ": " +
        (on
          ? "sorted " + (sortDir === "asc" ? "ascending" : "descending") +
            ", activate to " + (sortDir === col.first ? "reverse" : "return to the published rank")
          : sortable(col)
            ? "activate to sort"
            : "not sortable on this board"));
    });
  }

  /* A REAL <button> INSIDE THE <th>, not a click handler on the cell.
     The same argument the ticker cell already makes: it buys keyboard
     operability and a focus ring for free, and it states honest semantics.
     A <th> with a click listener is unreachable by keyboard and announces
     nothing; giving it role="button" would lie about what a header is, and
     tabindex="0" alone would make it focusable without making it activatable
     by Enter or Space. The header text moves INTO the button so the <abbr>
     and its title survive — the explanation of what a column means must not
     be the price of being able to sort by it. */
  function wireHeaders() {
    headCells.forEach((th, i) => {
      const col = COLS[i];
      if (!col) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fb-sort";
      while (th.firstChild) button.append(th.firstChild);
      const ind = document.createElement("span");
      ind.className = "fb-sort-ind";
      ind.setAttribute("aria-hidden", "true");
      button.append(ind);
      button.addEventListener("click", () => toggleSort(col.key));
      th.append(button);
    });
    syncHeaders();
  }

  function rowFor(row, index) {
    const tr = document.createElement("tr");
    tr.className = "fb-row";
    tr.append(cell(fmtInt(row.r != null ? row.r : index + 1), "c-rank"));
    /* The ticker is a real button, not a click handler on the row. That buys
       keyboard operability and a focus ring for free and states honest
       semantics; giving the <tr> role="button" would lie to a screen reader
       about what a table row is. */
    const tk = document.createElement("td");
    tk.className = "fb-tk";
    /* Same rule as the deck: a row with no card is not a button. See
       deckCard. A <span> rather than a disabled <button>, because a disabled
       button reads as "temporarily broken" and this is a permanent, stated
       property of the row. */
    const deep = !knowsDeep || row.dp === 1;
    const open = document.createElement(deep ? "button" : "span");
    open.className = deep ? "fb-open" : "fb-open fb-flat";
    open.textContent = String(row.t || DASH);
    if (deep) {
      open.type = "button";
      open.dataset.t = String(row.t || "");
      open.setAttribute("aria-haspopup", "dialog");
      // Warm the card on hover so the overlay opens instantly. At most six
      // entries are cached, against a 5M row/day read budget.
      open.addEventListener("pointerenter", () => {
        if (window.flowsCardPrefetch && row.t) window.flowsCardPrefetch(String(row.t));
      });
    } else {
      open.title = NO_CARD_SAID;
    }
    tk.append(open);
    /* THE DIALOG IS THE QUICK LOOK; THE PAGE IS THE DRILL. A real anchor, not
       a second button: /flows/ticker/?t= is a place, so it must be linkable,
       middle-clickable and sendable to someone. Only a deep row gets one —
       the page would render honestly for a name with no card, but a link that
       usually leads to "no card for this name" is worse than no link. */
    if (deep) {
      const full = document.createElement("a");
      full.className = "ft-link ft-link-glyph";
      full.href = "/flows/ticker/?t=" + encodeURIComponent(String(row.t || ""));
      /* THE ARROW IS DRAWN BY CSS, NOT WRITTEN INTO THE CELL. An anchor with
         textContent "↗" makes the cell's own text "INTC↗" — which a screen
         reader announces, and which a test reading the first row's ticker to
         check the published ORDER reads as a different ticker. The accessible
         name comes from aria-label; the glyph is decoration and lives in the
         stylesheet where decoration belongs. */
      full.setAttribute("aria-label", "Full page for " + String(row.t || ""));
      full.title = "Open the full page for " + String(row.t || "");
      tk.append(full);
    }
    tr.append(tk);

    const px = document.createElement("td");
    px.className = "c-num";
    px.textContent = fmtPrice(row.px);
    const chg = document.createElement("span");
    chg.className = " " + toneClass(row.chg);
    chg.textContent = "  " + fmtPct(row.chg, 2);
    px.append(chg);
    tr.append(px);

    tr.append(scoreCell(row.s));
    tr.append(cell(fmtInt(row.cnv), "c-num", convictionTitle(row) || undefined));
    tr.append(familyCell(row.fam));
    /* PURITY CHANGED MEANING AT VERSION 2, from |SUM dir| / SUM|total| — a net
       over a gross, where two different cancellations fought each other — to
       SUM|dir| / SUM|total|. The live v1 board printed 0.003 to 0.008 on names
       whose flow was overwhelmingly directional; v2 prints about 0.6 for the
       same tape. Both render in this column as "Π", so a v1 board drawn by a v2
       renderer shows a number whose definition silently moved. Withheld for the
       same reason fam.V and fam.O are. */
    tr.append(cell(legacyFamilies ? DASH : fmtRatio(row.purity), "c-num"));
    tr.append(cell(regimeText(row.gRegime), "c-num " + (row.gRegime === "short" ? "fb-neg" : "fb-flat")));
    tr.append(cell(row.gFlipDist == null ? DASH : fmtPct(row.gFlipDist, 1), "c-num"));
    tr.append(cell(fmtMoney(row.netPrem), "c-num " + toneClass(row.netPrem)));

    /* 52w, VRP AND IVR. All three have been in every board row since the
       pipeline started emitting them and none of them was ever drawn, so the
       table could not tell a name at its 52-week high from one at its low and
       the V gauge stayed a single opaque digit whose components were sitting
       in the same object.

       NO TONE CLASS ON ANY OF THEM, which is the whole reason they are built
       here rather than passed through toneClass like netPrem. Green and red
       on this board mean bullish and bearish. A high 52-week position is not
       bullish — on the short side it is the setup — implied volatility above
       realised is not good news, and a percentile has no direction at all.
       Colouring them would import a claim none of the three makes. */
    for (const extra of EXTRA_CELLS) {
      if (extra.at < headCells.length) tr.append(extra.build(row));
    }
    return tr;
  }

  /**
   * Two independent ways a board goes stale, reported separately because the
   * remedies differ.
   *
   * A dead pipeline has an old WRITE time: GitHub disables scheduled workflows
   * after 60 days of repository inactivity, and that failure's only symptom is
   * a date that stops advancing. A frozen upstream has a recent write time and
   * an old SESSION. The board previously showed neither — it rendered the
   * build time in a status line and applied no test at all, so a reader
   * looking at the board alone could not tell it was three days old.
   */
  function assessAge(payload) {
    const now = Date.now();
    const written = Number(payload.__updatedAt) || null;
    // One publish cadence plus slack. Weekends are handled by the session
    // check below, not here: the pipeline does not run at all on a Saturday.
    const STALE_WRITE_MS = 30 * 60 * 60 * 1000;
    // Four days covers a normal weekend plus one public holiday.
    const STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;

    if (written && now - written > STALE_WRITE_MS) {
      const days = Math.floor((now - written) / 86400000);
      return "This board was last written " +
        (days >= 1 ? days + (days === 1 ? " day" : " days") : Math.floor((now - written) / 3600000) + " hours") +
        " ago. The pipeline has not published since — check the Actions tab.";
    }
    if (payload.sessionDate) {
      const session = Date.parse(payload.sessionDate + "T21:00:00Z");
      if (Number.isFinite(session) && now - session > STALE_SESSION_MS) {
        return "These numbers describe the " + payload.sessionDate + " session, " +
          "which is more than four days old. The pipeline is running but its " +
          "data is not advancing.";
      }
    }
    return null;
  }

  function setStale(message) {
    if (!staleEl) return;
    staleEl.hidden = !message;
    staleEl.textContent = message || "";
    document.body.classList.toggle("is-stale", Boolean(message));
  }

  /**
   * An empty-state message, in BOTH renderers.
   *
   * This used to write only a <tr> into the table body — and the table is
   * `hidden` in the deck view, which is the default. Every explanation this
   * function produces ("no board is available", "the board could not be
   * loaded", "no name cleared the band") was therefore invisible to a reader
   * in the default view: they saw an empty grid and no reason for it.
   */
  function showMessage(text) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "fb-empty";
    td.colSpan = COLUMNS;
    td.textContent = text;
    tr.append(td);
    body.replaceChildren(tr);

    if (deck) {
      const note = document.createElement("p");
      note.className = "fb-empty";
      note.textContent = text;
      deck.replaceChildren(note);
    }
  }

  /**
   * Draw both renderers from `currentRows` in the current sort order.
   *
   * Split out of render() because a sort is not a load. render() fetches,
   * assesses staleness, fills the rail badge and writes the status line; none
   * of that changes when a column header is clicked, and calling it would
   * flash "Loading the long board…" over a status line describing data that
   * never left the page.
   *
   * Each card and row is handed its PUBLISHED index, not its position in the
   * sorted array. The rank shown is `row.r` when the payload carries it and
   * the position otherwise, and on a payload with no `r` the position-as-rank
   * fallback would renumber the board on every sort — the reader would sort
   * by conviction and watch a column headed "#" report 1, 2, 3 down a
   * conviction ranking. The published rank is a fact about the pipeline, not
   * about where a row happens to be sitting.
   */
  function paintRows() {
    /* NOTHING TO PAINT MEANS NOTHING TO ERASE. On an empty or errored board
       the tbody holds the explanation row render() wrote — a header click
       must not replace it with a silent zero-row table. */
    if (!currentRows.length) return;
    const view = orderedRows();
    const tableFrag = document.createDocumentFragment();
    for (const { row, index } of view) tableFrag.append(rowFor(row, index));
    body.replaceChildren(tableFrag);              // one insertion, 50 rows
    if (deck) {
      const deckFrag = document.createDocumentFragment();
      for (const { row, index } of view) deckFrag.append(deckCard(row, index));
      deck.replaceChildren(deckFrag);
    }
  }

  /* ---------- data ------------------------------------------------ */

  /* THE SIDE COMES FROM THE ROUTE, not from a control.
  
     It used to be a toggle on one page, which is two problems in one widget:
     half the session sat behind a click, and a toggle has no address — a
     reader could not link to the bearish side, bookmark it, or send it to
     anyone. /flows/long/ and /flows/short/ are pages, so the rail can mark
     which one you are on and a link can name one.
  
     The ?side= parameter is still honoured, because links to it exist in the
     wild and breaking them costs more than reading one extra parameter. */
  function initialSide() {
    try {
      if (/\/flows\/short\/?$/.test(location.pathname)) return "short";
      if (/\/flows\/long\/?$/.test(location.pathname)) return "long";
      const q = new URLSearchParams(location.search).get("side");
      return q === "short" ? "short" : "long";
    } catch { return "long"; }
  }

  function load(which) {
    if (cache.has(which)) return Promise.resolve(cache.get(which));

    const pending = inflight.get(which);
    if (pending) return pending.promise;          // deduplicate concurrent asks

    const controller = new AbortController();
    const promise = fetch("/api/flows/board?side=" + encodeURIComponent(which), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then((response) => {
      if (response.status === 401) {
        // The session expired underneath us; the login page is the
        // honest destination, not an error message.
        location.replace("/flows/");
        return null;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      // The write timestamp answers a question the payload cannot: whether the
      // PIPELINE ran, as distinct from whether the DATA moved. A frozen vendor
      // feed republished on schedule has a fresh write time and a stale
      // session; a dead pipeline has the reverse. They are different failures
      // and the reader is told which one.
      const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
      return response.json().then((body) => {
        if (body && typeof body === "object") body.__updatedAt = updatedAt;
        return body;
      });
    }).then((payload) => {
      if (payload) cache.set(which, payload);
      return payload;
    }).finally(() => {
      inflight.delete(which);
    });

    inflight.set(which, { promise, controller });
    return promise;
  }

  function render(which) {
    statusEl.textContent = "Loading the " + which + " board…";

    /* Clear the table whenever the side being requested is not the one on
       screen. The side is now fixed by the route, so within one page load this
       can only fire if render() is ever called twice — but the guard stays,
       because the failure it prevents is the expensive kind: the tbody is only
       replaced inside the success handler, so a stale body would sit under the
       new heading for the whole fetch, styled and announced as the new side.
       Rows from the wrong cross-section under the wrong heading are worse than
       no rows. */
    if (painted !== null && painted !== which) {
      body.replaceChildren();
      if (deck) deck.replaceChildren();
      painted = null;
    }
    body.setAttribute("aria-busy", "true");

    // Cancel a superseded request so a slow response cannot land after
    // the user has already switched sides.
    for (const [key, entry] of inflight) {
      if (key !== which) { entry.controller.abort(); inflight.delete(key); }
    }

    load(which).then((payload) => {
      if (which !== side || !payload) return;     // user moved on, or redirected

      const rows = Array.isArray(payload.rows) ? payload.rows : [];

      /* THE RAIL BADGE FOR THIS SIDE. The nav is server-rendered with the
         slots empty, because filling them there would cost a D1 row read per
         page view for a number the page is about to fetch anyway. This page
         only ever holds its own side, so it fills its own badge and leaves
         the other one hidden rather than guessing at it. */
      const slot = document.querySelector('[data-rail-count="' + which + '"]');
      if (slot) { slot.textContent = String(rows.length); slot.hidden = false; }

      /* AN EMPTY SIDE IS NOT AN EMPTY STORE. Under the dead band a side can
         legitimately hold nothing — no name cleared the bar on this side of
         the market — and telling that reader "the pipeline has not published
         its first session yet" reports a working quiet day as an outage. The
         published `scored` count separates the two: a board that scored names
         and placed none here is a reading, not a failure. */
      if (!rows.length && isNum(payload.scored) > 0) {
        showMessage(
          "No name on this side cleared the ±" + (payload.deadBand ?? "") + " band this session. " +
          (isNum(payload.scored) + " names were scored; " +
           (isNum(payload.neutral) ?? "all") + " of them landed inside the band, which is what a " +
           "quiet session looks like. The other side may still have candidates."),
        );
        statusEl.textContent =
          "No " + which + " candidates this session · session " +
          (payload.sessionDate || "unknown") + ".";
        setStale(assessAge(payload));
        painted = which;
        return;
      }

      if (payload.status === "pending" || !rows.length) {
        /* "pending" from the API means the row is genuinely absent. It is also
           what the Worker returns when the D1 read THREW — the catch there
           falls back to the same shape — so this message has to cover a
           database fault too rather than confidently asserting that nothing
           has ever been published. */
        showMessage(
          "No board is available for this side. Either the pipeline has not "
          + "published its first session yet, or the store could not be read. "
          + "If this persists past the next trading morning, check the Actions tab.",
        );
        statusEl.textContent = "No published session available.";
        setStale(null);
        return;
      }

      legacyFamilies = (isNum(payload.v) ?? 1) < 2;
      horizonSessions = isNum(payload.horizonSessions);
      knowsDeep = isNum(payload.deep) !== null;

      currentRows = rows;
      /* A deep-linked sort keyed to a column THIS payload withholds is
         dropped, not half-honoured: nulls-last already leaves the table in
         the published order, so keeping the key would only make every header
         disagree with the rows. */
      if (sortKey && !sortable(colByKey(sortKey))) { sortKey = null; sortDir = "desc"; writeSort(); }
      syncHeaders();      // Π's sortability depends on the payload version
      paintRows();
      painted = which;

      const when = payload.generatedAt
        ? new Date(payload.generatedAt).toLocaleString()
        : "an unknown time";
      // Two dates, because the job runs pre-open and the vendor returns the
      // previous COMPLETED session. Showing only the build time would let a
      // board built this morning from four-day-old data look current.
      /* WHAT THE SCORE MEANS, beside the board.

         The score is now a FIXED unit — two robust sigma from the
         cross-sectional median is 80, at any board size — so a short board and
         a low dispersion are the readings that say "quiet session" rather than
         "something broke". Under the old rank ladder both printed +84 and
         there was nothing to report. */
      const parts = [
        rows.length + " " + which + " candidate" + (rows.length === 1 ? "" : "s"),
        "session " + (payload.sessionDate || "unknown"),
      ];
      if (isNum(payload.neutral) !== null && isNum(payload.deadBand) !== null) {
        parts.push(payload.neutral + " of " + (payload.scored || "?") +
          " inside the ±" + payload.deadBand + " band");
      }
      /* THE NAMES THAT CLEARED THE BAND AND ARE NOT ON THIS PAGE.

         This product's rule is that the dead band decides: outside it is a
         signal, inside it goes on the watch list. Then the board's own length
         cap truncates each side and the overflow reaches NEITHER surface —
         the watch list holds only the names INSIDE the band. On a measured
         session that was four names, fully scored, past the threshold, and
         visible nowhere.

         So it is said HERE, in the line that already reconciles the counts,
         rather than left as a subtraction a reader has no reason to attempt.
         Silent when nothing was shed, because a "0 more" on every quiet
         session trains the eye to skip the clause on the session it matters. */
      const shed = isNum(payload.shed);
      if (shed !== null && shed > 0) {
        const cleared = isNum(payload.cleared);
        parts.push(shed + " more cleared the band and did not fit" +
          (cleared === null ? "" : " (" + rows.length + " of " + cleared + " shown)"));
      }
      if (isNum(payload.dispersion) !== null) {
        /* This is the 95th percentile of |composite| across the scored pool, not
           a standard deviation, so it does not get a sigma suffix — a quantile
           wearing a σ invites a reader to reach for a normal table that does not
           apply to it. */
        parts.push("spread " + payload.dispersion.toFixed(2) + " (95th pct)");
      }
      parts.push("built " + when);
      statusEl.textContent = parts.join(" · ") + ".";
      setStale(assessAge(payload));
    }).catch((error) => {
      if (error && error.name === "AbortError") return;
      showMessage("The board could not be loaded. Refresh to try again.");
      statusEl.textContent = "Could not reach the board service.";
    }).finally(() => {
      body.removeAttribute("aria-busy");
    });
  }

  /* ---------- view toggle ----------------------------------------- */

  /* THE VIEW TOGGLE. Both renderers are fed from the same payload on every
     render, so switching is a visibility change and never a refetch — and the
     hidden one carries no rows a screen reader could announce twice, because
     `hidden` removes it from the accessibility tree.

     The choice lives in the URL, exactly as `side` already does, rather than
     in browser storage. Three reasons, in order: this page is credential-gated
     and per-user, so nothing it writes should outlive a sign-out on a shared
     browser; storage.js is this site's sanctioned owner of browser-local
     persistence and the Flows page does not load it, so writing there directly
     would be the one place on the site that bypasses it; and a URL is
     shareable and bookmarkable where a per-browser flag is neither. */
  function readView() {
    try {
      const v = new URL(location.href).searchParams.get("view");
      return v === "table" ? "table" : "deck";
    } catch { return "deck"; }
  }

  function selectView(which) {
    const view = which === "table" ? "table" : "deck";
    if (deck) deck.hidden = view !== "deck";
    if (tableWrap) tableWrap.hidden = view !== "table";
    for (const button of viewButtons) {
      const on = button.dataset.view === view;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
    try {
      const url = new URL(location.href);
      // The deck is the default, so it is spelled by the parameter's ABSENCE.
      // Stamping ?view=deck on every visit would make the common URL longer
      // and turn a default into a decision the reader has to have made.
      if (view === "table") url.searchParams.set("view", "table");
      else url.searchParams.delete("view");
      history.replaceState(null, "", url);
    } catch { /* deep-linking is a convenience, never a requirement */ }
  }

  for (const button of viewButtons) {
    button.addEventListener("click", () => selectView(button.dataset.view));
  }
  selectView(readView());

  /* THE SORT SURVIVES THE VIEW TOGGLE for free, and that is by construction
     rather than by a handler: selectView() only flips `hidden`, and the
     order lives in `sortKey`/`sortDir` and in the DOM both renderers already
     hold. Nothing here re-reads the payload and nothing re-fetches it. */
  wireHeaders();
  readSort();
  syncHeaders();

  /* ---------- the cursor spotlight ----------------------------------

     ONE DELEGATED LISTENER ON THE DECK, not one per card: fifty cards is
     fifty listeners for an effect that only ever applies to whichever one the
     pointer is inside, and the deck is re-rendered on every sort.

     ATTACHED ONLY WHERE IT MEANS ANYTHING, and the two conditions are
     different in kind. `pointer: fine` is about capability — a touch device
     has no hover state to decorate, and firing pointermove there costs work
     for a highlight nobody sees. `prefers-reduced-motion` is about consent,
     and the answer is not to soften the effect but to not attach at all: the
     CSS hides the layer too, so neither half can leak past the other.

     BOTH ARE RE-CHECKED ON CHANGE. A reader who turns motion down while the
     page is open, or plugs in a mouse, gets the setting they asked for
     without reloading — a media query read once at boot is a preference
     honoured once. */
  const fine = window.matchMedia("(pointer: fine)");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  let spotlightOn = false;
  let frame = 0;
  let pending = null;

  function onPointerMove(event) {
    const card = event.target.closest && event.target.closest(".fd-card");
    if (!card) return;
    pending = { card, x: event.clientX, y: event.clientY };
    /* rAF-THROTTLED. pointermove fires far faster than the screen refreshes,
       and writing a custom property per event is a style recalculation per
       event; one write per frame is the most a paint can use. */
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pending) return;
      const { card: target, x, y } = pending;
      const box = target.getBoundingClientRect();
      if (!box.width || !box.height) return;
      target.style.setProperty("--mx", (((x - box.left) / box.width) * 100).toFixed(1));
      target.style.setProperty("--my", (((y - box.top) / box.height) * 100).toFixed(1));
    });
  }

  function syncSpotlight() {
    const want = fine.matches && !calm.matches;
    if (want === spotlightOn || !deck) return;
    spotlightOn = want;
    if (want) {
      deck.addEventListener("pointermove", onPointerMove, { passive: true });
    } else {
      deck.removeEventListener("pointermove", onPointerMove);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      pending = null;
      /* Leave nothing behind: a card that kept an --mx from before the
         preference changed would hold a stale highlight position. */
      for (const card of deck.querySelectorAll(".fd-card")) {
        card.style.removeProperty("--mx");
        card.style.removeProperty("--my");
      }
    }
  }
  for (const query of [fine, calm]) {
    if (query.addEventListener) query.addEventListener("change", syncSpotlight);
    else if (query.addListener) query.addListener(syncSpotlight);   // older Safari
  }
  syncSpotlight();

  render(side);
})();
