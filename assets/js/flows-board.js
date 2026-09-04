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

  /* ---------- the shared UI module ----------------------------------

     THE STALENESS TEST AND THE TWO LABELLED CONTROLS LIVE IN
     assets/js/flows-ui.js. The staleness test was assessAge() in THIS file
     and was lifted there because six routes had grown six copies of the same
     two tests with the same two constants and six different sentences.

     THIS PAGE IS NOT YET SERVED THAT FILE — shared/flows-pages.js sidePage()
     emits nav.js, this controller, flows-panels.js and flows-card.js and no
     UI module — so every use is guarded and the absence is ANNOUNCED rather
     than swallowed. A freshness banner that quietly stops appearing is
     indistinguishable from a pipeline that is fine, and that is the one
     failure this page must never present as health. */
  const UI = window.FlowsUI || null;

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

  /* THE CANONICAL MONEY LADDER NOW LIVES IN assets/js/flows-ui.js as
     fmtMoney(v, {dp}) — one premium was rendering three ways on three routes
     a reader is invited to move between ($2.2M here, $2.18M on the unusual
     feed, "2.2M" with no currency mark inside the ticker card).

     THIS COPY DELIBERATELY STAYS FOR NOW, and switching it alone would make
     things worse rather than better: flows-ui.js is not served to this page,
     and the other eight renderers cannot call it either, so a unilateral move
     to two decimals here would replace one disagreement with a different one.
     The ladder is retired in one commit across the nine renderers, the day
     the module is loaded everywhere — not one file at a time. */
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

  /* ---------- the board's memory ------------------------------------

     WHAT THE PREVIOUSLY PUBLISHED BOARD SAYS ABOUT TODAY'S ROW. The pipeline
     reads it on every run — it always did, for hysteresis — and now keeps what
     it read: `nw` (new to this side today), `hy` (here on incumbency: it did
     not clear the entry rank this session and sits inside the exit band, so it
     is on its way off), `r0` (the rank it held on THAT board) and `dr` (places
     IMPROVED, signed at the source so up is good and no renderer has to
     remember to negate a rank subtraction). `ed`/`edte` are the next earnings
     date and the days to it.

     "YESTERDAY" IS A CLAIM THIS PAGE CANNOT MAKE, and the first version of
     these marks made it in every sentence: "climbed 7 places since yesterday".
     The board today's ranking was held against is the previously PUBLISHED
     one, which on the Tuesday after a holiday is Friday's — and in the corpus
     this pipeline emits right now it is the 2026-08-21 board under a 2026-08-24
     session, three calendar days apart. The payload names it, in
     `memory.sessionDate`, so the marks name it too and fall back to "the
     previously published board" rather than to a weekday nobody measured.
     A delta whose span is asserted rather than measured is the same defect the
     score track's `gap` exists to prevent, one page over.

     Until this layer the board answered none of the questions an early-warning
     product exists for: which name is new, which is climbing, which is about
     to fall off. A name that arrived overnight looked exactly like one that
     had sat at the same rank for three weeks.

     NULL IS NOT FALSE, AND NOWHERE ON THIS PAGE DOES IT MATTER MORE. All four
     memory fields are null TOGETHER whenever the comparison did not happen.
     A renderer that drew null as false would announce all 44 names as new on a
     morning when the store was merely unreachable — a page-wide claim about
     the market manufactured out of a failed lookup. So a null memory draws
     NOTHING AT ALL and the page says once, in prose and in the publisher's own
     words, that there was no prior board to compare against and why.

     THE EARNINGS COUNTDOWN IS NOT PART OF THE MEMORY. `ed`/`edte` come off
     this morning's screener row, not off the previously published board, so a
     cold read must not silence them: on a board that cannot say what changed,
     "this name reports in 13 days" is still measured and still true. */

  /* Inside this many days a board name is about to be taken off the board by
     the earnings gate rather than by its signal decaying. Every name here
     cleared that gate this morning by definition, so a small count is not a
     warning about the reading — it is a warning about the row's remaining
     life. The gate's own threshold is the pipeline's constant and is
     deliberately not restated here; this is a "soon" window, not the gate. */
  const EARNINGS_SOON_DAYS = 20;

  /**
   * CAN THIS PAGE DRAW A MARK AT ALL — asked of the ROWS, which is the only
   * evidence the marks are actually drawn from:
   *
   *   "absent" — no row carries `nw` at all. This board was published before
   *              the memory layer existed: new assets, old payload, the
   *              deploy window this file already designs for around `deep`.
   *   "cold"   — the rows carry `nw: null`. The comparison did not happen, so
   *              no name has an answer. WHY it did not happen is not visible
   *              here and is not guessed at: see readMemoryBlock().
   *   "warm"   — the comparison happened and the marks mean something.
   *
   * Both silences draw the same thing (nothing). The sentence that explains
   * them comes off the payload, not out of this function — this one only
   * decides whether a mark has anything to say.
   */
  function memoryState(rows) {
    if (!Array.isArray(rows) || !rows.length) return "absent";
    let sawKey = false;
    for (const row of rows) {
      if (!row || typeof row !== "object" || !("nw" in row)) continue;
      sawKey = true;
      if (row.nw !== null) return "warm";
    }
    return sawKey ? "cold" : "absent";
  }

  // All four set from the payload on every render, like legacyFamilies and
  // knowsDeep. `rowMemory` is what the rows can support; the other three are
  // what the publisher said about the same comparison.
  let rowMemory = "absent";
  let memoryStatus = null;    // "ok"|"undated"|"same-session"|"ahead"|"quiet"|"unavailable"|null
  let memoryNote = null;      // the publisher's sentence, or null
  let priorSession = null;    // the session the memory was measured against

  /**
   * WHAT THE MEMORY WAS MEASURED AGAINST, IN WORDS.
   *
   * Never "yesterday". The comparand is the previously PUBLISHED board, and
   * the two coincide only on a week with no holiday in it and no re-run. When
   * the publisher dated it, the date is said; when it could not (status
   * "undated", where the memory was used anyway rather than thrown away over a
   * missing stamp), the board is named without a date. Both are true; the
   * weekday was neither.
   */
  function comparand() {
    return priorSession ? "the " + priorSession + " board" : "the previously published board";
  }

  /**
   * WHY THERE IS NO COMPARISON — TAKEN FROM THE PUBLISHER, NOT INVENTED HERE.
   *
   * THIS FILE USED TO WRITE ITS OWN COLD SENTENCE: "Yesterday's board could
   * not be read on this run." That is one cause out of six, and it is FALSE on
   * four of them. Upstream can tell an absent key from a read that failed from
   * a board that was read and named no rows from one stamped with THIS run's
   * own session (a re-run, refused on purpose so a second pass at one session
   * cannot hold the whole board in place and report that as stability) from
   * one stamped LATER than this run. A renderer sees `nw: null` on fifty rows
   * and can tell none of them apart: the evidence is upstream and reaches the
   * browser only as `memory.note`.
   *
   * IT IS NOT HYPOTHETICAL. The corpus this pipeline emits right now publishes
   * a long board with status "ok" and a short board with status "same-session",
   * and this page announced "could not be read" over the second one — about a
   * board it had read successfully and discarded on purpose.
   *
   * `undated` is the one status that KEEPS the memory: the marks are drawn and
   * the note is a caveat rather than an explanation of a blank. It is the
   * reason this returns a status alongside the sentence.
   */
  function readMemoryBlock(payload) {
    const block = payload && typeof payload.memory === "object" && payload.memory
      ? payload.memory : null;
    memoryStatus = block && typeof block.status === "string" ? block.status : null;
    memoryNote = block && typeof block.note === "string" && block.note ? block.note : null;
    /* A DATE OR NOTHING. String(x || "") would turn an absent stamp into "",
       and "the  board" is a sentence with a hole in it. The shape is checked
       rather than trusted for the same reason flows-ui.js checks it before
       Date.parse: a malformed stamp that still reads like one would date the
       comparison to a session nobody published. The literal is repeated rather
       than imported because this controller must work with no shared module
       loaded — it is a shape, not an arithmetic, and the two cannot drift into
       different ANSWERS the way two copies of a computation can. */
    priorSession = block && typeof block.sessionDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(block.sessionDate) ? block.sessionDate : null;
  }

  /**
   * WHERE THIS NAME WAS YESTERDAY, in a glyph and a number.
   *
   * SIGN IN POSITION AND GLYPH, NEVER IN HUE: ▲/▼ carry the direction and the
   * digits carry the size, so the mark survives greyscale, a monochrome
   * printout and every form of colour blindness. The class is confirmation
   * for everyone else, never the carrier.
   *
   * A name that is NEW has no previous rank to have moved from — `dr` is null
   * there by construction — so it gets the word, which answers the same
   * question. A `dr` of exactly 0 is a MEASUREMENT ("it held its rank") and
   * gets its own mark; printing nothing there would make a held rank
   * indistinguishable from an unreadable one.
   */
  function memoryMark(row) {
    if (!row) return null;
    if (row.nw === true) {
      return {
        cls: "fb-mem is-new", glyph: "NEW",
        say: "new to this side: it was not on " + comparand(),
      };
    }
    const dr = isNum(row.dr);
    if (dr === null) return null;
    const places = (n) => n + (n === 1 ? " place" : " places");
    /* BOTH ENDS OF THE MOVE WHERE BOTH ARE PUBLISHED. `r0` is the rank the
       name held on that board and it sat unread in every row: a delta whose
       endpoints are in the payload and withheld from the page is a number the
       reader has to take on trust. Withheld together, never half — `r0` is
       null on a name the prior board ranked but did not stamp a rank for, and
       "from rank null" is worse than no clause at all. */
    const from = isNum(row.r0);
    const now = isNum(row.r);
    const ends = from !== null && now !== null ? ", from rank " + from + " to rank " + now : "";
    if (dr > 0) {
      return { cls: "fb-mem is-up", glyph: "▲" + dr,
               say: "climbed " + places(dr) + " since " + comparand() + ends };
    }
    if (dr < 0) {
      return { cls: "fb-mem is-down", glyph: "▼" + Math.abs(dr),
               say: "fell " + places(Math.abs(dr)) + " since " + comparand() + ends };
    }
    return { cls: "fb-mem is-same", glyph: "=",
             say: "the same rank as on " + comparand() +
               (now === null ? "" : ", still rank " + now) };
  }

  /**
   * THE TWO REASONS THIS ROW MAY NOT BE HERE TOMORROW, and neither of them is
   * about the signal weakening.
   *
   * `hy` — the name did not clear the entry rank this session; it is on the
   *        board because it was on the board, and it sits inside the exit
   *        band. That is a genuinely different kind of row.
   * `edte` — the earnings gate takes a name off the board when its report is
   *        close. A row reporting in 13 days is a row that leaves in about a
   *        week for a calendar reason.
   *
   * UNITS TRAVEL WITH THE NUMBER: "earnings in 13d", never a bare 13. A
   * NEGATIVE count is a vendor date that has gone stale, not a report due
   * today, so it is withheld rather than printed as an imminent event.
   */
  function tenureMarks(row) {
    const out = [];
    if (row && row.hy === true) {
      out.push({
        cls: "fb-hold", glyph: "incumbent",
        say: "on the board on incumbency: it did not clear the entry rank this session " +
          "and sits inside the exit band, so it is on its way off",
      });
    }
    const dte = isNum(row && row.edte);
    if (dte !== null && dte >= 0 && dte <= EARNINGS_SOON_DAYS) {
      out.push({
        cls: "fb-earn", glyph: "earnings in " + dte + "d",
        say: "reports in " + dte + (dte === 1 ? " day" : " days") +
          (row.ed ? ", on " + row.ed : "") + ". Every name here cleared the earnings gate " +
          "this morning; this one clears it by days, so it is about to leave the board for " +
          "a calendar reason rather than a signal one",
      });
    }
    return out;
  }

  /* A mark as a DOM node. role="img" plus aria-label, the same pattern the
     family glyph already uses: the glyph is a picture to a screen reader and
     the words are the accessible name, so "▲7" is never announced as "black
     up-pointing triangle seven" and never announced as nothing. */
  function markNode(mark) {
    const span = document.createElement("span");
    span.className = mark.cls;
    span.textContent = mark.glyph;
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", mark.say);
    span.title = mark.say.charAt(0).toUpperCase() + mark.say.slice(1) + ".";
    return span;
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

  /* THE FIVE-BAR FAMILY GLYPH, BUILT ONCE.

     It used to exist only inside familyCell, which meant it existed only in
     the table — and the table is not the default view and is not the phone
     view. So the deck, which is what a reader actually looks at, showed price,
     a price sparkline and three price returns, and withheld the option-flow
     decomposition that is the entire product. The <td> is now a wrapper around
     this builder and the card calls the same builder, so the two drawings of
     F·P·D·V·O cannot drift. */
  function familyGlyph(fam) {
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
    return wrap;
  }

  function familyCell(fam) {
    const td = document.createElement("td");
    td.className = "c-num";
    td.append(familyGlyph(fam));
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
    v.textContent = n === null ? DASH : (n < 0 ? MINUS : n > 0 ? "+" : "") + (Math.abs(n) / 100).toFixed(1) + "%";
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

    /* WHERE THIS NAME WAS YESTERDAY, on the card that is the default and the
       phone view. Its own line rather than three more items inside .fd-head:
       the head is a non-wrapping flex row of rank, ticker and score, and a
       320px card has no spare width in it. A block line wraps by construction,
       which is the difference between a mark that folds and one that hands the
       page a horizontal scrollbar.

       DRAWN ONLY WHEN THERE IS SOMETHING MEASURED TO SAY. On a cold memory
       every mark is null and the line is not emitted at all — the page says
       once, above the deck, which comparison did not happen and why. Fifty
       cards each shrugging in the same place is not an explanation. */
    const memMarks = [memoryMark(row), ...tenureMarks(row)].filter(Boolean);
    if (memMarks.length) {
      const mem = document.createElement("div");
      mem.className = "fd-mem";
      for (const mark of memMarks) mem.append(markNode(mark));
      card.append(mem);
    }

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
    bar.className = score === null ? "is-flat"
      : score < 0 ? "is-neg" : score > 0 ? "is-pos" : "is-flat";
    bar.style.setProperty("--w", score === null ? 0 : Math.min(Math.abs(score) / 100, 1));
    track.append(zero, bar);
    card.append(track);

    /* THE REASON THE NAME IS ON THE BOARD, on the card.

       The deck gave its largest element to a price sparkline any free site
       draws and withheld every field that is FLOW evidence: the five families,
       the net premium. Both were built for the table only, so the view nobody
       uses had the product and the default view had a stock chart. The glyph
       is the same builder the <td> calls, and net premium is the one scalar
       that says how much money was behind the reading. */
    const ev = document.createElement("div");
    ev.className = "fd-ev";
    ev.append(familyGlyph(row.fam));
    const prem = document.createElement("span");
    prem.className = "fd-prem " + toneClass(row.netPrem);
    prem.textContent = fmtMoney(row.netPrem);
    prem.title = "Net premium: call premium bought minus put premium bought, " +
      "summed across the session. The sign is the direction of the money.";
    ev.append(prem);
    card.append(ev);

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
      /* THE MEMORY IS READ OUT TOO. The marks above are role="img" inside the
         card, and a card is one tab stop whose accessible name is this string
         — so a mark that is not in it is a mark a screen reader never reaches. */
      (memMarks.length ? memMarks.map((m) => m.say).join("; ") + ". " : "") +
      (isNum(row.netPrem) === null
        ? `Net premium unavailable. `
        : `Net premium ${fmtMoney(row.netPrem)}. `) +
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
    { key: "s",     kind: "num",  first: "desc", name: "Score", get: (row) => isNum(row.s) },
    { key: "cnv",   kind: "num",  first: "desc", name: "Conviction", get: (row) => isNum(row.cnv) },
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
  /* The find-a-name filter. Empty is "everything", which is the default and is
     therefore spelled by absence, exactly as ?view=deck and the published sort
     order are. */
  let filterText = "";

  /* ---------- sorts that are not columns ----------------------------

     THE MEMORY FIELDS HAVE NO <th> AND MUST NOT GET ONE FROM HERE. COLS binds
     POSITIONALLY to the header in shared/flows-pages.js — COLS[i] describes
     the i-th <th> — so appending a fourteenth entry to COLS on a thirteen-
     column header would make every subsequent header sort by the wrong data,
     and inserting one would do it visibly on the first click. This file does
     not own that markup and will not pretend to.

     So the three memory sorts live in their own registry, reachable from the
     order control and never from a header. They are otherwise ordinary column
     descriptors — same `get`, same `kind`, same nulls-last comparator — which
     is the point: one comparator, one null rule, two ways in.

     `available` is asked of the ROWS rather than of the header, because these
     sorts are withheld by the PAYLOAD: on a cold memory every `dr` is null and
     an order over 44 nulls is an order the reader can see and cannot account
     for. It answers true on an empty row set because at that moment the
     question is undecidable — readSort() runs before the payload lands, and
     dropping a deep-linked ?sort=dr there would break a shared link that is
     about to become perfectly valid. render() re-checks once the rows exist. */
  const EXTRA_SORTS = [
    {
      key: "dr", virtual: true, kind: "num", first: "desc",
      name: "Places climbed since the previous board",
      get: (row) => isNum(row.dr),
      available: (rows) => !rows.length || rows.some((r) => r && isNum(r.dr) !== null),
    },
    {
      key: "nw", virtual: true, kind: "num", first: "desc",
      name: "New to this side today",
      /* true → 1, false → 0, and a NULL MEMORY STAYS NULL so it sorts last in
         both directions rather than sorting as "not new" — which is an answer,
         and null is the absence of one. */
      get: (row) => (row.nw === true ? 1 : row.nw === false ? 0 : null),
      available: (rows) => !rows.length || rows.some((r) => r && (r.nw === true || r.nw === false)),
    },
    {
      key: "edte", virtual: true, kind: "num", first: "asc",
      name: "Days to earnings",
      /* A NEGATIVE count is a vendor date that has gone stale, not a report
         due in the past, so it is not a small number here: it is no number. */
      get: (row) => { const n = isNum(row.edte); return n === null || n < 0 ? null : n; },
      available: (rows) => !rows.length ||
        rows.some((r) => { const n = isNum(r && r.edte); return n !== null && n >= 0; }),
    },
  ];

  const colByKey = (key) =>
    COLS.find((c) => c && c.key === key) || EXTRA_SORTS.find((c) => c.key === key) || null;
  // -1 for a sort that is not a column. Every caller already treats -1 as
  // "not in the header", which is exactly true of these.
  const colIndex = (key) => COLS.findIndex((c) => c && c.key === key);

  /** Is this column drawn on the page as it stands, and sortable right now? */
  function sortable(col) {
    if (!col) return false;
    // A virtual sort is gated by the payload, not by the header: see EXTRA_SORTS.
    if (col.virtual) return typeof col.available === "function" ? col.available(currentRows) : true;
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
    /* THE FILTER RUNS FIRST AND THE PUBLISHED INDEX SURVIVES IT. That index is
       the row's position in the payload, which is what the rank badge falls
       back to on a board with no `r`; renumbering the survivors of a filter
       would have a filtered deck counting 1, 2, 3 while the pipeline ranked
       those names 7, 19 and 34. */
    const view = [];
    currentRows.forEach((row, index) => {
      if (filterText && !String((row && row.t) || "").toUpperCase().includes(filterText)) return;
      view.push({ row, index });
    });
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
    /* THE ORDER CONTROL IS THE ONLY STATEMENT OF THE ORDER VISIBLE IN THE DECK,
       so a header click has to move it. Before this, a sort applied in the
       table and then read in the deck had no on-screen author at all. */
    syncSortSelect();
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

  /* ---------- find a name, and one statement of the order ------------

     A FIFTY-ROW BOARD WITH NO WAY TO TYPE A SYMBOL. Until now the only sort
     affordance on this page was a <th> button — inside .flows-tablewrap, which
     the default view sets `hidden`. So in the view a reader actually lands on,
     every control was display:none: to sort the deck you switched to the
     table, clicked a header and switched back, and the deck you came back to
     showed rank badges reading 7, 3, 22 with nothing on screen saying what it
     was ordered by, because the ↓ indicator was hidden along with the header.

     These two controls go in .flows-controls, which sits OUTSIDE the table
     wrapper and is therefore visible in both views. The select is the page's
     single statement of the order, and syncSortSelect keeps it true even when
     the order was set by a header click or by a deep link.

     THE PRIMITIVES COME FROM window.FlowsUI, and so does their styling: they
     are emitted under the score track's `st` prefix deliberately. The
     alternative — a private `fb` namespace — would ship a native <select>
     with no rules at all, and a flex item's min-width is auto, which for a
     select is its widest OPTION at 16px mono: wider than a 320px phone's whole
     content column. The .st-field rules already carry the min-width:0 that
     fixes exactly that, with the measurement in their comment (it overflowed
     at 333px). One control, one styling, one place it was got right. */

  let controlsBuilt = false;
  let sortSelectEl = null;
  let countEl = null;
  let memNoteEl = null;

  /* The offered orders, each one a whole decision: a key AND a direction. A
     column plus a direction toggle would offer "closest to earnings" and
     "furthest from earnings" as equals, and nobody has ever wanted the second.
     The published rank is first because it is the default and the page's own
     answer; it is spelled by the empty value for the same reason ?view=deck is
     spelled by absence. */
  const SORT_CHOICES = [
    { key: null,      dir: "desc", label: "Published rank" },
    { key: "s",       dir: "desc", label: "Score, strongest first" },
    { key: "cnv",     dir: "desc", label: "Conviction, highest first" },
    { key: "dr",      dir: "desc", label: "Biggest climb since the previous board" },
    { key: "nw",      dir: "desc", label: "New to this side first" },
    { key: "edte",    dir: "asc",  label: "Closest to earnings first" },
    { key: "netPrem", dir: "desc", label: "Net premium, largest first" },
    { key: "t",       dir: "asc",  label: "Ticker, A to Z" },
  ];

  const choiceValue = (key, dir) => (key ? key + ":" + dir : "");

  function applySortValue(value) {
    const parts = String(value || "").split(":");
    const col = parts[0] ? colByKey(parts[0]) : null;
    if (!col || !sortable(col)) { sortKey = null; sortDir = "desc"; }
    else { sortKey = col.key; sortDir = parts[1] === "asc" ? "asc" : "desc"; }
    writeSort();
    syncHeaders();
    syncSortSelect();
    paintRows();
  }

  /**
   * THE CONTROL MUST NEVER MISSTATE THE ORDER.
   *
   * A header click can produce a state the curated list does not contain —
   * any of thirteen columns, either direction — and a select reading
   * "Published rank" above a table sorted by last price is worse than no
   * select at all: it is a wrong answer where the reader expects the only
   * answer. A state with no curated option therefore gets one, written from
   * the column's own name, replaced rather than accumulated.
   */
  function syncSortSelect() {
    if (!sortSelectEl) return;
    const want = choiceValue(sortKey, sortDir);
    const curated = Array.prototype.some.call(sortSelectEl.options,
      (o) => o.value === want && o.dataset.adhoc !== "1");
    let adhoc = sortSelectEl.querySelector('option[data-adhoc="1"]');
    if (curated) {
      if (adhoc) adhoc.remove();
    } else {
      if (!adhoc) {
        adhoc = document.createElement("option");
        adhoc.dataset.adhoc = "1";
        sortSelectEl.append(adhoc);
      }
      const col = colByKey(sortKey);
      adhoc.value = want;
      adhoc.textContent = (col && col.name ? col.name : "This board") +
        (sortDir === "asc" ? ", low to high" : ", high to low");
    }
    sortSelectEl.value = want;
  }

  /* ONE CAPPED ECHO OF WHAT WAS TYPED, USED BY BOTH LINES THAT QUOTE IT.

     What the reader typed is already in the field; these lines repeat it only
     to name what was matched. An uncapped echo of 40 typed characters is ONE
     UNBREAKABLE WORD, and one unbreakable word wider than the content column
     is a horizontal scrollbar at 320px — the invariant this repo tests.

     It is a function rather than two literals because it was two literals: the
     count line capped it and the no-match sentence did not, so the same
     keystroke was quoted two different ways in two places on one screen, and
     only one of them was safe at 320px. */
  const typedEcho = () =>
    "\u201c" + (filterText.length > 12 ? filterText.slice(0, 12) + "\u2026" : filterText) + "\u201d";

  /* HOW MANY OF HOW MANY. A filtered board that says "8 names" and nothing
     else has thrown away the denominator, which on a page whose whole subject
     is a ranked population is the more important half. Silent when no filter
     is set: a count of everything against everything teaches the eye to skip
     the line on the session it matters. */
  function updateCount(shown) {
    if (!countEl) return;
    if (!filterText) { countEl.hidden = true; countEl.textContent = ""; return; }
    countEl.hidden = false;
    countEl.textContent = shown + " of " + currentRows.length + " names match " + typedEcho();
  }

  function buildControls() {
    if (controlsBuilt) return;
    const host = document.querySelector(".flows-controls");
    if (!host || !UI || typeof UI.searchBox !== "function" || typeof UI.sortSelect !== "function") return;
    controlsBuilt = true;

    const wrap = UI.el("div", "st-controls fb-controls");
    const search = UI.searchBox({
      label: "Find", placeholder: "Ticker", prefix: "st", id: "fbQ",
      /* Upper-cased once here rather than per row per keystroke, and trimmed
         because a trailing space typed on a phone keyboard is not a filter. */
      onInput: (v) => { filterText = String(v || "").trim().toUpperCase(); paintRows(); },
    });
    /* AN ORDER THIS PAYLOAD CANNOT PRODUCE IS NOT OFFERED. On a cold memory
       `dr` and `nw` are null on every row, and an option that silently leaves
       the board in the published order is a control that lies about having
       done something. */
    const sort = UI.sortSelect({
      label: "Order", prefix: "st", id: "fbSort",
      options: SORT_CHOICES
        .filter((c) => !c.key || sortable(colByKey(c.key)))
        .map((c) => ({ value: choiceValue(c.key, c.dir), label: c.label })),
      onChange: applySortValue,
    });
    sortSelectEl = sort.select;

    countEl = UI.el("span", "fb-count");
    countEl.setAttribute("role", "status");
    countEl.hidden = true;

    wrap.append(search.root, sort.root, countEl);
    /* A SIBLING OF .flows-controls, NOT A CHILD OF IT. As a child it is a flex
       item, and a flex item's min-width is auto — which for a box containing a
       native <select> is that select's WIDEST OPTION at 16px mono. At 320px
       the longest order label is wider than the whole content column,
       and the page grew a horizontal scrollbar: measured at 352px against a
       320px viewport, which is the zero-overflow invariant this repo tests.
       In normal flow the row is constrained by the content column instead, and
       the .st-field rules (min-width:0, full-width fields under 40rem) do the
       rest — the same arrangement they were written for on the score track. */
    host.parentNode.insertBefore(wrap, host.nextSibling);
    syncSortSelect();
  }

  /* WHICH SILENCE A COLD MEMORY IS, per the three this product names.

     "quiet" is the one that is a MEASUREMENT: the previously published board
     was read and named no rows, which is a fact about that session rather than
     about the store. The other refusals — never published, unreadable, this
     run's own output, a board stamped LATER than this run — are comparisons
     that are not AVAILABLE, and they share the tag because they do not share a
     sentence: `memory.note` is what keeps them four answers instead of one.

     "undated" is not in the taxonomy at all, because it is not a silence. The
     memory was used and the marks are drawn; the note beside them says only
     that the comparison could not be dated. It gets no data-empty, because a
     board with fifty marks on it is not empty. */
  const MEMORY_EMPTY = { quiet: "quiet", undated: null };

  const PRE_MEMORY_SAID =
    "This board was published before the board kept a memory, so it carries no answer to " +
    "what changed since the previous session: its rows have no new-today, rank-move or " +
    "earnings-countdown fields at all. The next pipeline run stamps them.";

  /* THE FALLBACK NAMES NO CAUSE, WHICH IS THE WHOLE OF ITS CONTENT.

     The sentence it replaces asserted "Yesterday's board could not be read on
     this run". That is one cause out of six and it is false on most of them —
     including a re-run the pipeline refuses ON PURPOSE, which this page then
     reported to its reader as an outage to go and investigate.

     Nor does this enumerate the causes instead, which was the next thing tried
     and is only a quieter version of the same error: a list of four things
     that might have happened, printed under a heading a reader takes as a
     finding, is still the renderer talking about evidence it never saw. The
     run that wrote the payload is the only place that saw the earlier board.
     When it says nothing, the honest sentence is that nothing was said. */
  const COLD_UNSTATED_SAID =
    "No comparison with a previously published board is reflected here: no name claims to be " +
    "new and no rank move is drawn, because every row's memory is null together and false " +
    "would be an answer where there is none. This payload does not say why the comparison did " +
    "not happen, and only the run that wrote it saw the earlier board — so nothing on this " +
    "page will guess at a cause.";

  /* A STATUS THAT ARRIVED WITHOUT ITS SENTENCE. Still not a second opinion:
     the only thing this says beyond the fallback above is the publisher's own
     status token, quoted, which is data the payload sent rather than prose
     this file invented. One template rather than six hand-written sentences,
     for the same reason the six are not here at all — two files wording one
     outage is how it ends up worded two ways.

     The token is clamped because it is payload, and a sentence is not the
     place to discover that a field arrived as a paragraph. */
  const statusOnlySaid = (status) =>
    "The run that published this board reported the comparison as \u201c" +
    String(status).slice(0, 32) + "\u201d and sent no sentence with it, so that one word is " +
    "all this page has: no name here claims to be new and no rank move is drawn. It does not " +
    "say why beyond that, and only the run that wrote it saw the earlier board.";

  /* The one status that KEEPS the memory, arriving without its sentence. The
     marks below it are real and the caveat on them is not optional, so this is
     the one place a missing note still has to be answered in words. */
  const UNDATED_UNSAID =
    "This run could not date the board it compared against, and said no more than that. The " +
    "marks here are a comparison against a board this page cannot name, rather than against a " +
    "named session: read them as unverified.";

  /**
   * THE ONE SENTENCE ABOUT THE COMPARISON, said once for the page rather than
   * fifty times in the rows.
   *
   * A COLD BOARD HAS FIVE CAUSES AND THIS FILE CANNOT TELL THEM APART. The
   * rows say only that `nw` is null everywhere. WHY it is null — no board was
   * ever published, or the read failed, or the board read named no rows, or it
   * was stamped for THIS session and refused as a re-run, or it was stamped for
   * a LATER session — is decided in the pipeline, which is the only place that
   * saw the prior payload. So the publisher writes the sentence and this draws
   * it VERBATIM. There is deliberately no second set of five sentences here:
   * two files wording one outage is how a reader concludes there are two
   * outages, and it is the drift `memory.note` exists to prevent.
   *
   * THE STATUS DECIDES THE TAG, NOT THE PROSE. Every cold note used to be
   * `data-empty="unavailable"`, which is wrong for "quiet" — a prior board that
   * was read and held nothing is a measured emptiness, and this product spends
   * a suite on keeping that distinct.
   *
   * AND "undated" DRAWS A NOTE OVER A BOARD THAT HAS MARKS. It is the one
   * status that KEEPS the memory: the publisher used a prior board it could not
   * date rather than discarding a real membership over a missing stamp, and
   * said so. The earlier version removed the note for any warm memory, so the
   * marks appeared with the caveat stripped off them — a comparison presented
   * as verified because the only thing that knew otherwise had been thrown away
   * one branch earlier.
   */
  function memoryNoteFor() {
    if (memoryStatus === "ok") return null;
    /* PRESENT AND NON-EMPTY, TESTED BEFORE USE. An empty string is not a
       sentence, and a blank paragraph where an explanation belongs is the one
       outcome worse than a shorter sentence. */
    const published = typeof memoryNote === "string" && memoryNote.trim() !== "" ? memoryNote : null;
    if (memoryStatus !== null) {
      const tag = MEMORY_EMPTY[memoryStatus];
      const caveat = memoryStatus === "undated";
      if (published) {
        return {
          status: memoryStatus, text: published, caveat,
          tag: tag === undefined ? "unavailable" : tag,
        };
      }
      /* NO SENTENCE ARRIVED WITH THE STATUS, so the fallback is chosen by
         whether the MARKS are on the page rather than by the status word. A
         status this file has never heard of — one added upstream after this
         was written — must never put "no comparison is reflected here" over
         fifty drawn marks. Silence is the safe answer for an unknown warm
         status; the marks themselves still say what they measured. */
      if (rowMemory === "warm") {
        return caveat
          ? { status: memoryStatus, text: UNDATED_UNSAID, tag: null, caveat: true }
          : null;
      }
      return {
        status: memoryStatus, text: statusOnlySaid(memoryStatus), caveat: false,
        tag: tag === undefined ? "unavailable" : tag,
      };
    }
    if (rowMemory === "warm") return null;
    return rowMemory === "absent"
      ? { status: "pre-memory", text: PRE_MEMORY_SAID, tag: "unavailable", caveat: false }
      : { status: "unstated", text: COLD_UNSTATED_SAID, tag: "unavailable", caveat: false };
  }

  function setMemoryNote() {
    const anchor = deck || tableWrap;
    const say = memoryNoteFor();
    if (!say || !anchor || !anchor.parentNode) {
      if (memNoteEl) { memNoteEl.remove(); memNoteEl = null; }
      return;
    }
    if (!memNoteEl) {
      memNoteEl = document.createElement("p");
      anchor.parentNode.insertBefore(memNoteEl, anchor);
    }
    memNoteEl.className = "flows-empty fb-memnote" + (say.caveat ? " is-caveat" : "");
    /* WHICH ANSWER THIS IS, as an attribute as well as prose, for the same
       reason `data-stale` carries its kind: a stylesheet and a test should not
       have to parse a sentence to tell a refused re-run from a store that
       could not be reached. */
    memNoteEl.dataset.memory = say.status;
    if (say.tag) memNoteEl.dataset.empty = say.tag;
    else delete memNoteEl.dataset.empty;
    memNoteEl.textContent = say.text;
  }

  function rowFor(row, index) {
    const tr = document.createElement("tr");
    tr.className = "fb-row";
    /* A ROW HELD ON INCUMBENCY IS A DIFFERENT ROW and is marked as one on the
       <tr>, not only in a chip: it did not earn its place this session. The
       class is for the stylesheet; the chip in the name cell is what carries
       the fact in text, because a row a reader cannot see the colour of must
       still say what it is. */
    if (row.hy === true) tr.classList.add("is-holdover");

    /* THE RANK CELL ANSWERS "WHERE DOES THIS NAME STAND", so the rank move
       belongs in it and nowhere else. Appended INSIDE the existing cell
       rather than added as a fourteenth column: the column model binds
       positionally against a <thead> this file does not own and cannot
       extend, and a tbody one cell wider than its header is a column with no
       accessible name at all. */
    const rankCell = cell(fmtInt(row.r != null ? row.r : index + 1), "c-rank");
    const move = memoryMark(row);
    if (move) rankCell.append(markNode(move));
    tr.append(rankCell);
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
    /* THE TWO REASONS THIS ROW MAY BE GONE TOMORROW, folded into the name cell
       instead of becoming two more columns. Thirteen columns already overflow
       every phone; two more would be two more the reader has to scroll to, for
       facts that only a handful of rows carry.

       A NOTE FOR WHOEVER READS THIS CELL FROM A TEST: .fb-tk's textContent is
       now the ticker PLUS any marks. The ticker alone is .fb-open — which is
       also what tests/flows-legacy-payload.mjs should read, and does not:
       it passes today only because a v1 board carries no memory at all. The
       same hazard is why the full-page arrow is drawn by CSS rather than
       written into this cell. */
    for (const mark of tenureMarks(row)) tk.append(markNode(mark));
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
   *
   * THE TEST ITSELF NOW LIVES IN assets/js/flows-ui.js. It was written here
   * first and copied outward: six routes ended up with the same two constants
   * and six different sentences for the same two failures, and two routes
   * wording one outage differently is how a reader concludes there are two.
   * `subject` keeps this page's sentence exactly the one it has always shown.
   *
   * THE MODULE IS NOT YET SERVED TO THIS PAGE, and its absence is reported
   * rather than swallowed. A freshness check that quietly stops running looks
   * exactly like a pipeline that is fine — the single failure mode this
   * banner exists to make impossible.
   */
  function assessAge(payload) {
    if (!UI || typeof UI.staleness !== "function") {
      return {
        kind: "unavailable",
        message: "The freshness check could not run: this page's shared UI module " +
          "(flows-ui.js) is not loaded, so nothing here is confirmed to be today's. " +
          "The session date in the line above is the payload's own claim about itself.",
      };
    }
    return UI.staleness(payload, Date.now(), { subject: "This board" });
  }

  /* `verdict` is {kind, message} or null. The KIND is stamped on the element
     as well as the sentence, because "the pipeline stopped" and "the data
     stopped" want different chrome and a test should not have to parse prose
     to tell which one is on screen. */
  function setStale(verdict) {
    if (!staleEl) return;
    const message = verdict && verdict.message ? verdict.message : "";
    staleEl.hidden = !message;
    staleEl.textContent = message;
    if (message) staleEl.dataset.stale = (verdict && verdict.kind) || "stale";
    else delete staleEl.dataset.stale;
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
  function showMessage(text, kind) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "fb-empty";
    td.colSpan = COLUMNS;
    td.textContent = text;
    /* WHICH SILENCE THIS IS, as an attribute and not only as prose. The three
       are "the key was never published", "the payload could not be read" and
       "it was measured and is empty", and only the last is a statement about
       the market. A fourth, `filtered`, is not a silence at all: the rows are
       here and the reader hid them. */
    if (kind) td.dataset.empty = kind;
    tr.append(td);
    body.replaceChildren(tr);

    if (deck) {
      const note = document.createElement("p");
      note.className = "fb-empty";
      note.textContent = text;
      if (kind) note.dataset.empty = kind;
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
    updateCount(view.length);
    /* A FILTER THAT MATCHES NOTHING IS NOT AN EMPTY BOARD, and the sentence
       has to say so or the reader reads a typed filter as an outage. The rows
       are still in `currentRows`, so clearing the field brings them straight
       back with no fetch. */
    if (!view.length) {
      showMessage("No name on this board matches " + typedEcho() + ". All " +
        currentRows.length + " rows are still loaded — clear the field to see them.", "filtered");
      return;
    }
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
      /* AND IT FILLS ONLY WHAT IT MEASURED. This wrote String(rows.length)
         unconditionally, so a pending payload — rows.length 0 by construction —
         put a "0" in the rail beside a page that was about to say "No board is
         available for this side. Either the pipeline has not published its
         first session yet, or the store could not be read." The rail states the
         rule itself, in shared/flows-pages.js: "A badge that says nothing until
         the data lands is honest; a badge that says 0 while the fetch is in
         flight is not."

         NOT THE GUARD THE SIBLINGS USE. flows-watch.js and flows-events.js
         write `if (slot && rows.length)`, which is right for them and wrong
         here: on a board a zero can be a MEASUREMENT — a side where names were
         scored and none cleared the dead band — and suppressing that would
         collapse a working quiet day into an outage, which is the other half of
         the same rule. `scored` is what separates them, exactly as the block
         directly below already uses it for the sentence it prints. */
      if (slot && (rows.length || isNum(payload.scored) > 0)) {
        slot.textContent = String(rows.length);
        slot.hidden = false;
      }

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
          /* MEASURED AND EMPTY, which is the one silence of the three that is a
             reading about the market rather than about the plumbing. */
          "quiet",
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
          /* Never published or unreadable: the Worker answers both with the
             same pending envelope, which is why this one sentence covers two
             causes and says so. */
          "unavailable",
        );
        statusEl.textContent = "No published session available.";
        setStale(null);
        return;
      }

      legacyFamilies = (isNum(payload.v) ?? 1) < 2;
      horizonSessions = isNum(payload.horizonSessions);
      knowsDeep = isNum(payload.deep) !== null;

      currentRows = rows;
      /* WARM, COLD OR ABSENT, decided once per payload rather than per row, so
         every mark and every sentence on the page is answering the same
         question with the same evidence. */
      rowMemory = memoryState(rows);
      /* THE PUBLISHER'S OWN ACCOUNT OF THE COMPARISON: its status, the session
         it was measured against, and the sentence naming which of six outcomes
         this run had. Read BEFORE anything draws a mark — comparand() is used
         by every one of them, and a mark that names the wrong board is worse
         than a mark that names none. */
      readMemoryBlock(payload);
      setMemoryNote();
      /* The controls are built HERE and not at boot: which orders this payload
         can produce depends on the payload, and a select offering "biggest
         climb" over a board with no memory is a control that does nothing and
         explains nothing. */
      buildControls();
      /* A deep-linked sort keyed to a column THIS payload withholds is
         dropped, not half-honoured: nulls-last already leaves the table in
         the published order, so keeping the key would only make every header
         disagree with the rows. The same test now covers ?sort=dr on a cold
         board, where the memory sorts are withheld by the rows rather than by
         the header. */
      if (sortKey && !sortable(colByKey(sortKey))) { sortKey = null; sortDir = "desc"; writeSort(); }
      syncHeaders();      // Π's sortability depends on the payload version
      syncSortSelect();
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
      /* WHAT CHANGED, IN THE LINE THAT ALREADY RECONCILES THE COUNTS — and
         never without its denominator, which is the row count this same line
         opens with. "3 names are new" over an unstated population is the
         defect this product replaced everywhere else.

         AND NEVER WITHOUT ITS SPAN EITHER, which is the other half of the same
         rule and the half this line used to miss: it said "since yesterday"
         about a comparison against the previously PUBLISHED board. Those are
         the same board only on a week with no holiday in it. comparand() names
         the session when the publisher dated it and names the board without a
         date when it could not.

         A WARM MEMORY WITH NOTHING NEW IS A READING, not a silence, and it
         gets its own sentence: on a board that turns over daily, a session
         where nobody arrived is the interesting one. A cold memory says
         instead that the comparison did not happen; the note above the deck
         carries the why, in the publisher's words. */
      if (rowMemory === "warm") {
        const fresh = rows.filter((r) => r && r.nw === true).length;
        const incumbent = rows.filter((r) => r && r.hy === true).length;
        parts.push((fresh === 0 ? "no new names on this side" : fresh + " new to this side") +
          " since " + comparand());
        if (incumbent > 0) parts.push(incumbent + " held on incumbency");
      } else {
        parts.push("no comparison with a previously published board");
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
      showMessage("The board could not be loaded. Refresh to try again.", "unavailable");
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
