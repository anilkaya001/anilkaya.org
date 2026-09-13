/* =============================================================
   flows-overview.js — the Session Overview, as a command center.

   WHAT THIS PAGE IS FOR, RESTATED. It used to answer "what is the LEVEL":
   both tails ranked, the band drawn, the calendar beside them. That is the
   right page at 16:00 and the wrong one at 09:15, when the reader already
   knows GOOG is +71 because it was +71 yesterday and the day before. The
   question at 09:15 is WHAT IS DIFFERENT, and the four names that crossed
   the dead band overnight are the answer.

   So the page now LEADS ON CHANGE. "What changed" is the first region under
   the verdict bar and spans the whole grid; the two ranked poles follow it.
   Nothing new is fetched to do that — every region is drawn from an endpoint
   that already existed.

   AND TWO TOP-DOWN REGIONS NOW SIT UNDER THE BOTTOM-UP ONES. Everything
   above them is a residual WITHIN the day's cross-section, with sector
   neutralised out of it; `sector:premium` says which of the eleven baskets
   the option premium leaned into, and `news` says what was on the tape while
   it did. Both keys were published and served and drawn nowhere until this
   page asked for them.

   AND THE CHANGE ARITHMETIC IS NOT THIS FILE'S. A null in a name's aligned
   series means it WAS NOT SCORED that session, so subtracting the last two
   measured values here produced the same integer whether they were one
   session apart or twenty — a "+40" three weeks old read as an overnight
   move. shared/flows-scores.js derives the move once, beside the series it
   comes from, and publishes it WITH its denominator: d1.v, d1.gap,
   d1.cross, lastAt, run. This file reads those and subtracts nothing.

   NINE REGIONS, AND EACH ONE IS ALLOWED TO SAY NOTHING. A region with an
   unpublished key, a region whose request never came back, a region whose
   payload predates the field it needs, and a region the pipeline measured
   and found empty are FOUR DIFFERENT FACTS, and this file words them as
   four different sentences. Only the last is a claim about the market; the
   others are claims about this page, and printing the last one for all of
   them is how a surface starts lying quietly.

   THE PRIMITIVES ARE THE LIBRARY'S: isNum, el, svgEl, the em dash and the
   U+2212 minus come from flows-ui.js, loaded before this file. Its own copy
   of isNum once took `Number(null)` for a finite zero and drew a confident
   mark at zero on the spine for an absent score.
   ============================================================= */
(() => {
  "use strict";

  const statusEl = document.getElementById("flowsStatus");
  const staleEl = document.getElementById("flowsStale");
  const spineHost = document.getElementById("spinePlot");

  /* THE LIBRARY IS A HARD DEPENDENCY, AND ITS ABSENCE IS VISIBLE. A missing
     flows-ui.js used to be a TypeError in the console and a page that simply
     never filled in — which reads exactly like a quiet session. The status
     line is already the place this page reports on itself, so it says so
     there rather than throwing into a console nobody has open. */
  const UI = window.FlowsUI;
  if (!UI) {
    if (statusEl) {
      statusEl.textContent = "The shared UI library did not load, so this page " +
        "cannot draw. Nothing here is a reading about the session — refresh to try again.";
    }
    return;
  }
  const { isNum, el, svgEl, DASH, MINUS, fmtSigned, scoreStrip, emptyState } = UI;

  const host = (id) => document.getElementById(id);
  const verdictHost = host("ccVerdict");
  if (!statusEl || !spineHost || !verdictHost) return;

  const ROW_MAX = 10;    // rows per ranked region; the side pages hold the rest
  const LIST_MAX = 8;    // rows in the narrow regions, which are indexes
  const CHANGE_MAX = 12; // rows in the lead region, which is the page's answer

  /* A row the pipeline built no detail card for. Same sentence the board
     uses, because it is the same fact and a reader who notices that some
     names open and others do not is owed the reason wherever they noticed. */
  const NO_CARD_SAID =
    "No detail card: the chain and the card cost vendor calls the run spends " +
    "only on the names furthest from neutral. This row is scored and ranked " +
    "from the same five sources as every other.";

  /* ---------- formatting ------------------------------------------
     fmtSigned is the library's, so the minus is U+2212 and a ZERO prints
     unsigned — it is a measurement, not a blank, and dressing it as "+0"
     would claim a direction the number does not have. */

  const pct = (v, dp) => {
    const n = isNum(v);
    return n === null ? DASH : fmtSigned(n * 100, dp === undefined ? 2 : dp) + "%";
  };

  /** Premium, abbreviated. Positive prints unsigned: the column header says
      what the sign means, and a leading + on every other row is noise. */
  const usd = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const sign = n < 0 ? MINUS : "";
    const a = Math.abs(n);
    if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(0) + "K";
    return sign + "$" + a.toFixed(0);
  };

  /* THE UNIT TRAVELS WITH THE COUNT. "+37 over 6" is not a reading; "+37
     over 6 sessions" is. A delta printed without its span is the exact
     defect the shared change layer replaced, and it is not allowed back in
     through a terse cell. */
  /* AN INSTANT ON THE EASTERN CLOCK, "HH:MM", or null.

     THE SHAPE IS CHECKED BEFORE THE PARSE, for the reason shared/flows-
     freshness.js states about the same conversion: Date.parse is lenient
     enough to be dangerous, and a bare "2026-01-05" is not merely lenient
     but wrong — midnight UTC is the previous evening in New York. A
     timestamp with no time is refused rather than guessed at.

     NOT THE VIEWER'S ZONE, deliberately. Everything measured here is a
     window inside one Eastern session, and the region's subtitle already
     carries the READ instant on the viewer's own wall clock; a table of
     session windows in Istanbul time would be two clocks on one region
     with nothing saying which is which. */
  const etTime = (at) => {
    if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(at.trim())) {
      return null;
    }
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(d);
    } catch { return null; }
  };

  const sessionsSaid = (n) => n + (n === 1 ? " session" : " sessions");
  const daysSaid = (n) => n + (n === 1 ? " calendar day" : " calendar days");

  /* A LIST THAT TRUNCATES WITHOUT SAYING SO READS AS A POPULATION. Six
     regions on this page cap their rows and only the two poles said so. On
     the watch region that was not an omission but a false statement: the
     anchor read "all 12" over eight listed names, and it is a link to
     /flows/watch/, the one route where a reader would have gone to check.
     The poles' own sentence, in one place, so the six cannot drift apart in
     how they say it. `of` is the published population wherever the payload
     carries one — the row array is already capped on the wire, so counting
     the rows in hand would state a ceiling as a census. */
  const capSaid = (shown, of) => (of > shown ? shown + " of " + of : "all " + of);

  /* HUE IS CONFIRMATION, NEVER THE CARRIER. Every cell this tints already
     prints its own sign, so the colour repeats what the glyph says. */
  const tone = (v) => {
    const n = isNum(v);
    return n === null ? "" : n > 0 ? " is-pos" : n < 0 ? " is-neg" : "";
  };

  /* ---------- the silences ----------------------------------------

     "Nothing here" is four different facts and they may not share a
     sentence:

       unreadable  — the request did not come back. Nothing is known, and
                     the fault is this page's, not the market's.
       pending     — the key has never been published for this session. The
                     pipeline has not spoken yet; nothing was measured.
       unavailable — the key IS published and the FIELD this region is made
                     of is not on it. The payload predates the layer. Also
                     not a fact about the market.
       empty       — the pipeline measured, and measured nothing. THIS one
                     is a reading, and it is the only one of the four that
                     says anything about the market.

     `kind` lands on data-empty so a test can tell them apart without
     parsing prose, which is what stops them collapsing back into one. */

  function quiet(into, kind, text) {
    const p = emptyState(kind, text);
    p.classList.add("cc-quiet");
    into.append(p);
    return true;
  }

  /**
   * The region's FINDING, first and at the size a finding gets.
   *
   * COUNTED OVER WHAT DREW, ALWAYS. Every caller below builds its sentence
   * from the rows it is about to render — `rows.slice(0, LIST_MAX)` — and
   * never from `rows`, because a lead that counts over forty rows above a
   * table showing eight is describing a list the reader cannot see. Where a
   * published denominator is the honest one it is already in the subtitle,
   * which says "8 of ≥200" and is a different claim.
   */
  function lead(into, text) {
    if (!text) return;
    into.append(el("p", "fc-reading is-lead", text));
  }

  /**
   * Word the two silences that are about the fetch rather than the session.
   * Returns true when it wrote one, so a caller only has to word the rest.
   */
  function silent(into, payload, what) {
    if (!payload) {
      return quiet(into, "unreadable",
        "The " + what + " could not be read, so this region is blank. That is a " +
        "fault on this page and not a fact about the session — refresh to try again.");
    }
    if (payload.status === "pending") {
      return quiet(into, "pending",
        "The " + what + " has not been published for this session yet. Nothing has " +
        "been measured here, so nothing is being claimed.");
    }
    return false;
  }

  /* A ROW COUNT, OR NULL WHEN THERE IS NO PUBLISHED BOARD TO COUNT.
     The worker answers an unpublished key with {status:"pending", rows: []},
     so every naive `payload.rows.length` on this page turns "the pipeline
     has not spoken" into "nothing leaned today" — a claim about the market,
     printed in a badge and a tile, where nobody would think to doubt it. */
  const rowCount = (payload) =>
    payload && payload.status !== "pending" && Array.isArray(payload.rows)
      ? payload.rows.length : null;

  /* THE SIDE'S WHOLE POOL, OR NULL WHEN THERE IS NO PUBLISHED BOARD TO COUNT.
     The publisher caps each side and publishes `cleared` — every name that
     left the band on that side — beside the rows it kept (flows-pipeline.mjs:
     5687). The rail badge printed that pool while the verdict tile, the
     status line and the pole subtitle printed the row count, so one screen
     of the 2026-08-24 payload (cleared 53, rows 50) read "Bearish 53",
     "44 / 50" and "50 bearish": three numbers for one population. One rule,
     read from all four places: prefer `cleared`, fall back to the rows only
     for a board published before that field existed, and let rowCount's null
     carry the two silences through. Where the pool exceeds the rows the
     callers print the difference as "counted, not carried", the words the
     alerts and news regions use for a row ceiling. */
  const poolCount = (payload) => {
    const rows = rowCount(payload);
    return rows === null ? null : (isNum(payload.cleared) ?? rows);
  };

  /* ---------- the ranking is the payload's -------------------------

     The pipeline stamps `r` on every row: 1 is the name furthest from
     neutral ON ITS OWN SIDE, so the short board's rank 1 is its most
     bearish name. Re-deriving that here would be a second opinion about a
     ranking already published — and the obvious re-derivation is WRONG on
     the bear side, where a descending sort on the signed score puts −28
     above −91 and heads a list labelled "most bearish" with the least
     bearish name on it.

     Sorted rather than taken as it arrives, because array order is not a
     contract and this file cannot see how the rows reached it. When no row
     carries a rank there is nothing published to trust, and the fallback is
     distance from neutral — the same rule, computed here, sign-agnostic so
     it cannot reintroduce the asymmetry above. */
  function ranked(rows) {
    const list = (Array.isArray(rows) ? rows : []).slice();
    const published = list.length > 0 && list.every((r) => isNum(r && r.r) !== null);
    if (published) { list.sort((a, b) => isNum(a.r) - isNum(b.r)); return list; }
    /* `?? 0` IS THE CONFIDENT ZERO WEARING NEWER SYNTAX, and it used to be
       right here: a row whose score never arrived sorted as though it had
       been measured at exactly neutral, which on a fallback ordering BY
       DISTANCE FROM NEUTRAL is the strongest possible claim about a number
       nobody published. An unscored row cannot be placed on this ordering at
       all, so it goes last rather than being placed by a fabricated value. */
    list.sort((a, b) => {
      const av = isNum(a && a.s), bv = isNum(b && b.s);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return Math.abs(bv) - Math.abs(av);
    });
    return list;
  }

  /* ---------- a name that goes to the reader -----------------------

     THE TILE IS A LINK AGAIN, and each stop of the round trip was right about
     a different thing. It began as <a href="?t=SYM">, a real address that
     reloaded this page — nine regions and both board payloads — to draw a card
     over what the reader was looking at; it became a <button data-t> that
     flows-card.js turned into a modal in place, giving up the address. The
     modal is retired, so the destination is a different document either way.

     A ROW WITHOUT A CARD IS NOT A LINK. The card costs vendor calls the run
     spends only on the names furthest from neutral: `deep` at the payload
     root means this board knows the distinction and `dp` means this row got
     one, so the test is on the PAYLOAD first. The flat span is unchanged,
     down to its title. */
  function nameNode(t, hasCard) {
    if (!t) return el("span", "cc-flat", DASH);
    if (!hasCard) {
      const flat = el("span", "cc-flat", t);
      flat.title = NO_CARD_SAID;
      return flat;
    }
    const link = el("a", "cc-open", t);
    /* `from=overview` is the surface this name was read off, so the reader can
       offer a way back to it rather than to a default. */
    link.href = "/flows/ticker/?t=" + encodeURIComponent(t) + "&s=signal&from=overview";
    link.title = "Open the full reader for " + t;
    return link;
  }

  /* ---------- the earnings marker ----------------------------------

     THE MOST EXPENSIVE MISTAKE THIS SURFACE CAN LET A READER MAKE is
     carrying a long signal into a print. Both boards and the events calendar
     were fetched in the same Promise.all and never joined: ORCL ranked #1
     bullish in one region while another, three hundred pixels below, said
     ORCL reports in three sessions.

     TWO SOURCES, TWO UNITS, AND THE UNIT IS PRINTED. The board row carries
     `edte` in CALENDAR DAYS and the events payload `sdte` in TRADING
     SESSIONS; "3" means different things in each, so the glyph is followed
     by the number AND its unit letter, and the title spells both out with
     the date. The events count is preferred where both exist because it is
     the one the earnings gate itself measured. */
  function earningsMark(row, ev) {
    const s = isNum(ev && ev.sdte);
    const d = isNum(row && row.edte);
    const date = (ev && ev.d) || (row && row.ed) || null;
    let text = null, said = null;
    if (s !== null) { text = "⚠" + s + "s"; said = sessionsSaid(s) + " away"; }
    else if (d !== null) { text = "⚠" + d + "d"; said = daysSaid(d) + " away"; }
    else if (date) { text = "⚠"; said = null; }
    if (!text) return null;
    const mark = el("span", "cc-dim cc-ern", text);
    mark.title = "Reports " + (date || "inside the events window") +
      (said ? " · " + said : "") +
      ". A signal carried into a print stops being the signal that was ranked.";
    return mark;
  }

  /* ---------- the method wall, on this route's terms ----------------

     THE THRESHOLD IS assets/js/flows-panels.js's AND IS COPIED RATHER THAN
     IMPORTED: that file is on the ticker route alone and is 54k, so reaching
     it for one number would put 54k on this route to save forty bytes.
     tests/flows-overview-contract.mjs asserts the two constants are the same
     number, so the copy cannot drift in silence.

     WHY A WALL AT ALL. Every sentence behind a disclosure is load-bearing —
     that is the rule for what may go there — but a wall of prose under a
     chart is a rule nobody finishes, and a rule nobody finishes is a rule
     nobody was told. A SHORT SET STAYS OPEN: a one-line decoder behind a
     click is a click for nothing. */
  const NOTE_WALL_CHARS = 420;

  /**
   * Method paragraphs, behind a disclosure once they are a wall.
   *
   * ONLY METHOD REACHES HERE. What a reading MEANS — a population, a
   * horizon, a unit, a truncation, a NOT-CLAIMED — never does, and the
   * asymmetry is the whole point: folding a reassurance costs a reader
   * nothing and folding a withholding is how a caveat unread becomes a
   * caveat deleted.
   */
  function appendMethod(host, lines, summary) {
    const list = (lines || []).filter((one) => typeof one === "string" && one.trim());
    if (!list.length) return;
    const chars = list.reduce((n, one) => n + one.length, 0);
    if (chars <= NOTE_WALL_CHARS) {
      host.append(el("p", "cc-quiet cc-ln-note", list.join(" ")));
      return;
    }
    const box = el("details", "ft-how");
    box.append(el("summary", "ft-how-s", summary || "How this reading was made"));
    box.append(el("p", "cc-quiet cc-ln-note", list.join(" ")));
    host.append(box);
  }

  /** A table that scrolls inside its own box rather than widening the page. */
  function tableWrap(label) {
    const wrap = el("div", "cc-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", label);
    return wrap;
  }

  /* Column headers carry the UNIT of a numeric column, which is how a
     tabular column keeps its numbers bare without becoming bare numbers.
     The optional third entry is a title: the change layer publishes its own
     prose for exactly these columns, and a header that carries the
     publisher's sentence cannot drift from the arithmetic the way a caption
     re-written here would. */
  function headRow(cols) {
    const thead = el("thead");
    const tr = el("tr");
    for (const [label, cls, said] of cols) {
      const th = el("th", cls || null, label);
      th.setAttribute("scope", "col");
      if (said) th.title = said;
      tr.append(th);
    }
    thead.append(tr);
    return thead;
  }

  function nameCell(row, knowsDeep, mark, cross) {
    const td = el("td", "cc-t");
    const t = String((row && row.t) || "");
    const deep = !knowsDeep || (row && row.dp === 1);
    td.append(nameNode(t, Boolean(t) && deep));
    /* THE COMPANY BESIDE THE SYMBOL, WHEN THE BOARD CARRIES ONE. `nm` is a
       vendor carry (scripts/flows-pipeline.mjs) and null wherever the vendor
       sent no name, so a nameless row draws exactly the cell it always drew.
       A SECOND LINE, not a parenthesis: the ticker is what the rank, the link
       and every column are keyed on, and a forty-character name beside it
       would push the symbol off the edge a reader scans down. */
    const nm = row && typeof row.nm === "string" && row.nm.trim() ? row.nm.trim() : null;
    if (nm && nm !== t) td.append(el("span", "cc-nm", nm));
    /* THE CROSSING, ON THE RANKED ROW ITSELF. A name that cleared the band
       this session is a new arrival on this board and a name that faded is
       on its way off it; both were visible only in the change region, which
       meant a reader working down the ranked list could not see which of
       these ten opinions is one session old. */
    if (cross) {
      const tag = el("span", "cc-dim cc-cross", cross);
      tag.title = CROSS_SAID[cross] || "";
      td.append(tag);
    }
    if (mark) td.append(mark);
    return td;
  }

  /* ---------- a ranked side, ten deep ------------------------------

     Each row carries its own score strip, which is the primitive the score
     track page already draws and the one thing the six tiles could never
     show: whether a name arrived at this score this morning or has been
     sitting on it for a month. */
  function sideTable(into, rows, knowsDeep, track, label, evBy) {
    /* A COLUMN EVERY ROW ANSWERS WITH A DASH IS NOT A COLUMN.

       The score strip is the most useful cell on this table when the archive
       has a trace for the name — and on a session where the track published
       nothing for any name on this side, it was ten rows of em dash under a
       header promising a series. That is a full column of the reader's
       attention spent on the absence of one, and it crowds the columns that
       do carry numbers.

       Decided per SIDE rather than per row, because a table whose column set
       changed between its two halves would be worse than either. The absence
       itself still reaches the reader: the score-track region below states
       what the track carried, which is where a fact about the archive
       belongs. */
    const drawsTrack = rows.slice(0, ROW_MAX).some((row) => {
      const series = track.byName[row && row.t];
      return Array.isArray(series) && series.some((v) => isNum(v) !== null);
    });
    const wrap = tableWrap(label);
    const table = el("table", "cc-tbl");
    table.append(headRow([
      ["", "cc-rank"], ["Name", null],
      ["Score", "c-num", "Signed attention score on a fixed −100 to +100 scale; not a return forecast."],
      ["Conv", "c-num", "Conviction measures agreement in the published inputs, not a probability of profit."],
      /* TWO DIFFERENT CHANGES, TWELVE PIXELS APART. This cell is a session
         PRICE return — close over the prior close — and the region seated
         directly above this table is headed "What changed" and carries a
         column of score moves. Both were spelled "Chg"/"change" and neither
         header said which quantity it was, on a page whose whole argument is
         that a delta means nothing without its unit. */
      ["Px chg", "c-num",
        "The session's price return: close over the prior close. Not the " +
        "score move — that is the \u0394 score column in the region above, " +
        "and it is in score points."],
      ["Net prem", "c-num"],
    ].concat(drawsTrack ? [[track.label, "cc-trk"]] : [])));

    const body = el("tbody");
    for (const row of rows.slice(0, ROW_MAX)) {
      const tr = el("tr");
      /* THE CROSSING IS TAGGED ONLY WHERE IT IS THIS SESSION'S EVENT. The
         tag says "this name became actionable this morning", and the track's
         newest reading for a name is not always about the newest session —
         a name out of the screener for a day carries a real crossing
         measured last week, and stamping that onto today's ranked row
         claims an event that did not happen today. The change region below
         still lists it, dated, which is where a reading that is not about
         today belongs. */
      const mv = track.moveBy[row.t] || null;
      tr.append(el("td", "cc-rank", isNum(row.r) === null ? DASH : String(row.r)));
      tr.append(nameCell(row, knowsDeep, earningsMark(row, evBy.get(String(row.t || ""))),
        mv && mv.current && typeof mv.d1.cross === "string" ? mv.d1.cross : null));
      const score = el("td", "c-num cc-score" + tone(row.s), fmtSigned(row.s));
      const value = isNum(row.s);
      if (value !== null) {
        const scale = el("span", "cc-score-scale");
        scale.setAttribute("aria-hidden", "true");
        const mark = el("i");
        mark.style.width = Math.min(50, Math.abs(value) / 2) + "%";
        mark.style.left = (value < 0 ? 50 - Math.min(50, Math.abs(value) / 2) : 50) + "%";
        scale.append(mark);
        score.append(scale);
      }
      tr.append(score);
      tr.append(el("td", "c-num", isNum(row.cnv) === null ? DASH : String(Math.round(row.cnv))));
      tr.append(el("td", "c-num" + tone(row.chg), pct(row.chg)));
      tr.append(el("td", "c-num" + tone(row.netPrem), usd(row.netPrem)));

      if (!drawsTrack) { body.append(tr); continue; }
      const cell = el("td", "cc-trk");
      const series = track.byName[row.t];
      const measured = (series || []).filter((v) => isNum(v) !== null).length;
      if (series && measured) {
        /* ONE SHARED DOMAIN ACROSS BOTH SIDES. Left to itself every strip
           rescales to its own extremes, and a name drifting ±2 draws the
           same picture as one swinging ±40 — so a bull strip and a bear
           strip could not be read against each other at all. */
        const strip = scoreStrip(cell, {
          values: series, width: 150, height: 22,
          domain: track.domain, deadBand: track.deadBand, prefix: "cc",
          ariaLabel: "Score for " + row.t + " across " + measured + " archived sessions",
        });
        /* REGISTERED HERE AND NOT INSIDE scoreStrip, which is the whole
           reason this is four lines at a call site rather than one option on
           the builder. flows-ui.js is served on four routes and only THIS one
           links flows-cursor.js — /flows/long/, /flows/track/ and the strategy
           tester do not — so a registration inside the builder would ship the
           bytes to three routes where `window.FlowsCursor` is undefined and
           the feature cannot exist. A deferred cost is still a cost, and so
           is a cost that can never be spent.

           WHAT THE STRIP WITHHOLDS. It is the name's whole archived score
           run, and the row beside it prints ONLY the newest of those scores;
           the aria-label names the population and no value in it. So the one
           question the drawing invites — what was this on the 14th — had no
           answer anywhere on the page, and the marks are 150px wide, which is
           about seven pixels a session.

           A SESSION THIS NAME WAS NOT SCORED IN IS NOT A ZERO. The strip
           already refuses to bridge those — a run is drawn between adjacent
           MEASURED points only — and the readout says so rather than
           printing a number for a session that has none. */
        if (window.FlowsCursor && strip) {
          /* THE COLUMN CENTRES COME FROM THE FUNCTION THAT PLACED THEM.
             flows-ui.js exports stripGeometry beside scoreStrip precisely so
             a caller can ask where a column is instead of reproducing the
             arithmetic — and the first draft of this block did reproduce it,
             which is the one thing flows-cursor.js's contract forbids. Same
             count, same width as the call above, so the same centres.

             THE BAND IS THE WHOLE CANVAS HERE, and that is not an oversight:
             this drawing is a bare 150x22 sparkline in a table cell with no
             axis, no labels and no rail, so its plot rectangle and its canvas
             are the same rectangle. */
          const geo = UI.stripGeometry(series.length, 150);
          window.FlowsCursor.attach(strip, {
            name: "Score for " + row.t + " by session",
            band: { y0: 0, y1: 22 },
            points: series.map((raw, i) => {
              const v = isNum(raw);
              return {
                x: geo.xMid(i),
                label: track.dates[i] || "session " + (i + 1),
                rows: [{ k: "Score", v: v === null ? "not scored" : fmtSigned(v, 0),
                         cls: v === null ? "" : v > 0 ? "is-pos" : v < 0 ? "is-neg" : "" }],
              };
            }),
          });
        }
      } else {
        /* No trace for this name is an ABSENCE, not a flat line at zero. */
        cell.textContent = DASH;
      }
      tr.append(cell);
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  /* ---------- the score track, pooled once for both sides ---------- */

  /* THE MOVE TRAVELS WITH THE SESSION IT WAS MEASURED ON, everywhere on this
     page. `d1` alone is a delta with no date on it, and the crossing tag on a
     ranked row and the trail on the spine read exactly that: a name last
     scored a week ago had its crossing tagged onto today's row and its move
     drawn on today's axis. So the index carries `at` (the session the
     reading ends on), `last` (the score it ended at) and `current` (whether
     that is the track's newest session), and the callers decide with those. */
  function readTrack(payload) {
    const byName = Object.create(null);
    const moveBy = Object.create(null);
    const sessionRows = payload && Array.isArray(payload.sessions) ? payload.sessions : [];
    const lastIndex = sessionRows.length - 1;
    let lo = 0, hi = 0, sessions = 0;
    if (payload && Array.isArray(payload.names)) {
      for (const name of payload.names) {
        if (!name || !name.t) continue;
        const series = Array.isArray(name.s) ? name.s : [];
        byName[name.t] = series;
        if (name.d1) {
          const at = isNum(name.lastAt);
          moveBy[name.t] = {
            d1: name.d1,
            at,
            last: isNum(name.last),
            current: lastIndex >= 0 && at !== null && at === lastIndex,
            on: at !== null && sessionRows[at] ? sessionRows[at].d || null : null,
          };
        }
        if (series.length > sessions) sessions = series.length;
        for (const value of series) {
          const v = isNum(value);
          if (v === null) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    return {
      byName, moveBy, domain: { lo, hi },
      /* THE SESSION EACH COLUMN IS, in the series' own order. Every strip is
         drawn against these indices and none of them names a date anywhere,
         so a reader can see a name fall and not say when. `d` is what the
         track publishes; a row that carries none stays null rather than
         becoming an index worn as a date. */
      dates: sessionRows.map((r) => (r && r.d) || null),
      deadBand: payload ? isNum(payload.deadBand) : null,
      /* The column header states the window it drew rather than a constant:
         a track that published nothing gets a header that promises nothing. */
      label: sessions ? sessions + " sessions" : "Score track",
    };
  }

  /* The region shell's own subtitle, verbatim: flows-pages.js ships it as
     the span's default text and this file re-states it whenever it prefixes
     a count onto it. A "prior scored session" is the previous session the
     name was SCORED, which is the distinction the whole region turns on. */
  const CHANGE_SAID = "since each name's prior scored session";

  /* ---------- what changed: the page's lead region -----------------

     THE FOUR EVENTS, IN THE PAYLOAD'S OWN WORDS. Everything the change layer
     reports other than a crossing is drift, however large — so a crossing
     outranks a magnitude here regardless of size, which is the whole
     inversion this region exists for. A +56 flip and a +8 drift are not two
     sizes of the same thing. */
  const CROSS_WORDS = { cleared: "cleared", faded: "faded", flipped: "flipped" };
  const CROSS_SAID = {
    cleared: "Was inside the dead band at the previous scored session and is " +
      "outside it now. The name became actionable this session.",
    faded: "Was outside the dead band and is inside it now. The exit signal, " +
      "and exactly as load-bearing as the entry.",
    flipped: "Outside the band at both ends with opposite signs. The name did " +
      "not weaken and re-strengthen; it changed sides without resting in the middle.",
  };

  /**
   * The denominator, in one paragraph, in four different sentences.
   *
   * "Eight names moved" is not a reading. Eight out of twelve is a session
   * that turned; eight out of four hundred is a Tuesday. The change layer
   * counts the whole pool BEFORE the payload's size cap sheds rows, so this
   * paragraph can state a denominator no renderer counting its own visible
   * rows could reach.
   */
  function changeLede(change, band, sessionRows, shedBy, shed) {
    const said = [];
    const dateAt = (i) => (sessionRows[i] && sessionRows[i].d) || null;
    const bandSaid = band === null
      ? "No dead band was published with this track, so no crossing can be claimed " +
        "and none is."
      : "The dead band is ±" + band + " score points wide.";

    if (!change) {
      /* The payload carries per-name d1 but no pooled change block. The rows
         below are still true; the population behind them is not published. */
      said.push("This track published no pooled change summary, so the rows below " +
        "are the moves this payload carries rather than a share of a stated " +
        "population. " + bandSaid);
      return said.join(" ");
    }

    const n = (v) => isNum(v);
    const comparable = n(change.comparable), moved = n(change.moved), held = n(change.held);
    const consecutive = n(change.consecutive);
    const entered = n(change.entered), left = n(change.left);
    const cr = change.crossings || {};
    const cleared = n(cr.cleared), faded = n(cr.faded), flipped = n(cr.flipped);
    const from = change.prior || dateAt(sessionRows.length - 2);
    const to = change.session || dateAt(sessionRows.length - 1);

    /* FOUR STATUSES, FOUR SENTENCES. "flat" is a reading about the market
       and "cold" is a statement about the archive; collapsing them into one
       "no data" is how a page reports a session in which nothing happened
       as a session it could not see. */
    if (change.status === "single-session") {
      said.push("The archive holds a single session" + (to ? " (" + to + ")" : "") +
        ", so there is nothing to compare it against. The first change lands once " +
        "a second session is archived.");
      said.push(bandSaid);
      return said.join(" ");
    }
    if (change.status === "cold") {
      said.push("No name in the pool was scored on two sessions inside this window, " +
        "so no change exists to report. That is the shape of the archive, not a " +
        "market that stood still.");
      said.push(bandSaid);
      return said.join(" ");
    }
    if (change.status === "flat") {
      said.push("Every one of the " + (comparable === null ? "compared" : comparable) +
        " names with two scored sessions held its score" +
        (from && to ? " between " + from + " and " + to : "") +
        ". Nothing moved, which is a reading about the session rather than a gap " +
        "in the archive.");
      said.push(bandSaid + " No name crossed it.");
      return said.join(" ");
    }

    said.push((moved === null ? "Some" : moved) + " of " +
      (comparable === null ? "the" : comparable) + " names with two scored sessions " +
      "moved" + (from && to ? " between " + from + " and " + to : "") +
      (held === null ? "" : "; " + held + " held their score") + ".");
    if (consecutive !== null && moved !== null) {
      /* "N of the comparisons comparisons" is what the missing-denominator
         fallback used to read. A population that was not published is worth
         naming once, not twice. */
      said.push(consecutive + (comparable === null
        ? " of the comparisons below span"
        : " of the " + comparable + " comparisons span") +
        " a single session; the rest reach back further, and each row below " +
        "prints how far.");
    }
    if (cleared !== null && faded !== null && flipped !== null) {
      const total = cleared + faded + flipped;
      said.push(bandSaid + " " + (total === 0
        ? "No name crossed it this session, so everything below is drift."
        : total + (total === 1 ? " name" : " names") + " crossed it: " +
          cleared + " cleared, " + faded + " faded back inside, " + flipped +
          " flipped sides."));
    } else {
      said.push(bandSaid);
    }
    if (entered) {
      said.push(entered + (entered === 1 ? " name was" : " names were") +
        " scored for the first time in this window and " + (entered === 1 ? "has" : "have") +
        " no prior reading to compare against.");
    }
    if (left) {
      said.push(left + (left === 1 ? " name was" : " names were") +
        " scored on the prior session and not on this one.");
    }
    if (shedBy && shed) {
      said.push(shed + (shed === 1 ? " name is" : " names are") +
        " counted above but not carried on this payload — the " +
        (shedBy === "names" ? "row ceiling" : "byte ceiling") +
        " shed them, so the list below is shorter than the count.");
    }
    return said.join(" ");
  }

  /**
   * The lead region: what is different this morning, crossings first.
   *
   * EVERY NUMBER HERE ARRIVES DERIVED. `payload.names[].d1` is the move with
   * its span and its category; `lastAt` says whether the reading is about
   * today at all; `run` says whether the opinion is new or old. The local
   * filter-and-subtract this replaced could produce none of them, and its
   * output could not be told apart from an overnight move.
   */
  function paintChanged(into, payload, cards, evBy, boardBy) {
    /* THE HEADER SAYS HOW MANY OF THE MOVERS THE TABLE IS SHOWING. This
       region caps at twelve and its subtitle was a static span with no slot
       in it, so a session in which thirty-four names moved presented twelve
       rows under a sentence that named no count at all — an index read as a
       population. The prose stays the document's; only the count is written
       here, and only on the branch that actually drew rows. */
    const sub = host("ccChgSub");
    const saySub = (said) => {
      if (sub) sub.textContent = said ? said + " · " + CHANGE_SAID : CHANGE_SAID;
    };
    saySub(null);
    if (silent(into, payload, "score track")) return;

    const names = Array.isArray(payload.names) ? payload.names : [];
    const sessionRows = Array.isArray(payload.sessions) ? payload.sessions : [];
    const change = payload.change && typeof payload.change === "object" ? payload.change : null;
    const notes = payload.notes && typeof payload.notes === "object" ? payload.notes : {};
    const band = isNum(payload.deadBand);
    const shedBy = typeof payload.shedBy === "string" ? payload.shedBy : null;
    const shed = isNum(payload.namesShed);

    /* THE PAYLOAD IS READABLE AND PREDATES THE LAYER. That is neither a
       failed fetch nor a quiet market, and it must not borrow either
       sentence — the honest thing is to name the missing field. It is also
       the branch that refuses to fall back to the browser-side subtraction
       this region was built to delete. */
    const anyMove = names.some((nm) => nm && nm.d1);
    if (!change && !anyMove) {
      quiet(into, "unavailable",
        "This score track was published without a change layer: no name carries a " +
        "d1 move and the payload states no session-level change. Nothing about " +
        "what moved can be read from it, and this page will not subtract two " +
        "scores itself — a difference with no session span attached is not a reading.");
      return;
    }

    const lastIndex = sessionRows.length - 1;
    const dated = lastIndex >= 0;

    const moves = [];
    for (const nm of names) {
      const d1 = nm && nm.d1;
      if (!d1) continue;
      const v = isNum(d1.v), gap = isNum(d1.gap);
      if (v === null || gap === null) continue;
      const cross = typeof d1.cross === "string" ? d1.cross : null;
      /* A NAME THAT HELD ITS SCORE IS NOT A CHANGE, and the change layer
         counts it in `held` so the paragraph above still has it. A crossing
         with a zero move cannot exist by construction, so the guard cannot
         drop an event. */
      if (v === 0 && !cross) continue;
      const at = isNum(nm.lastAt);
      moves.push({
        t: String(nm.t || ""), v, gap, cross,
        qv: isNum(d1.qv), at, now: isNum(nm.last), run: isNum(nm.run),
        ext: nm.ext && typeof nm.ext === "object" ? nm.ext : null,
        /* STALE MEANS "REAL, BUT NOT ABOUT TODAY". The name's newest score
           is not in the newest session, so its move happened before this
           morning. A page that leads on change owes that distinction before
           it owes the magnitude. */
        stale: dated && at !== null && at !== lastIndex,
      });
    }

    /* CROSSINGS OUTRANK MAGNITUDE, THEN FRESHNESS OUTRANKS MAGNITUDE, and
       only then does size decide. The old ordering was |delta| alone, which
       systematically promoted the names returning from the earnings gate —
       roughly a seventh of the pool on any session — to the top of a list a
       reader reads as "what happened overnight". */
    moves.sort((a, b) =>
      (a.cross ? 0 : 1) - (b.cross ? 0 : 1)
      || (a.stale ? 1 : 0) - (b.stale ? 1 : 0)
      || Math.abs(b.v) - Math.abs(a.v)
      || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

    const lede = changeLede(change, band, sessionRows, shedBy, shed);

    if (!moves.length) {
      /* THE STATUS DECIDES WHICH SILENCE THIS IS. "flat" is a measurement of
         the session — every name compared, none moved. "cold" and
         "single-session" are statements about how much archive exists, which
         is a fact about this pipeline and not about the market. */
      const measured = change && change.status === "flat";
      /* AND THE FOURTH CASE: the pool moved, and none of the names that
         moved survived the payload's size cap. The count above is still
         true; the rows behind it are simply not on the wire, and saying
         "nothing moved" here would contradict the sentence beside it. */
      const shedOut = change && change.status === "ok"
        ? " No name that moved is carried on this payload, so the count above " +
          "has no rows behind it — the row ceiling shed them."
        : "";
      quiet(into, measured ? "empty" : "unavailable", lede + shedOut);
      return;
    }

    // Summarise the measured population visually; retain the full audit text.
    if (change) {
      const summary = el("div", "cc-change-summary");
      const crossings = change.crossings || {};
      for (const [label, value] of [["Moved", change.moved], ["Cleared", crossings.cleared],
        ["Faded", crossings.faded], ["Flipped", crossings.flipped]]) {
        const metric = el("div", "cc-change-metric");
        metric.append(el("strong", null, isNum(value) === null ? DASH : value));
        metric.append(el("span", null, label));
        summary.append(metric);
      }
      into.append(summary);
    }
    /* THE METHODOLOGY GOES BEHIND THE DISCLOSURE BUILT FOR IT. This paragraph
       — the comparable population, the count of single-session comparisons,
       the span, the band, the shed — used to sit in the open directly above a
       <details> headed "Comparison scope and methodology", which is the exact
       thing it is. So the region printed four counters, then a dense sentence
       of scope, then an invitation to read about scope.

       NOTHING IS DROPPED AND NOTHING IS HIDDEN THAT A READING DEPENDS ON. The
       four counters above are the measurement; this is how they were arrived
       at, and a reader who wants it is one click from all of it in the place
       the page already told them to look. */
    const detail = el("details", "ft-how cc-change-detail");
    detail.append(el("summary", "ft-how-s", "Comparison scope and methodology"));
    if (change) {
      detail.append(el("p", "cc-quiet", "Compared: " + (isNum(change.comparable) ?? DASH) +
        " names · " + (isNum(change.consecutive) ?? DASH) + " single-session comparisons. " +
        "Each row states its comparison span. " +
        (change.prior && change.session ? change.prior + " → " + change.session + ". " : "") +
        (band === null ? "Band unavailable." : "Band: ±" + band + " score points.") +
        (shed ? " " + shed + " counted names omitted from this payload." : "")));
    }
    detail.append(el("p", "cc-quiet cc-lede", lede));
    into.append(detail);

    /* THE MOVERS ON THIS PAYLOAD, not the pooled population the lede states.
       The two are different numbers whenever the row ceiling shed rows, and
       the lede above already carries the pooled one with its denominator. */
    saySub(capSaid(Math.min(moves.length, CHANGE_MAX), moves.length));

    const wrap = tableWrap("What changed " + CHANGE_SAID);
    const table = el("table", "cc-tbl");
    table.append(headRow([
      ["Event", null, notes.crossing || null],
      ["Name", null],
      ["Δ score", "c-num", notes.change || null],
      ["Over", null, notes.gaps || null],
      /* NOT "NOW". This column is the score at the END of the comparison —
         the name's newest MEASURED score — and on the rows this region
         deliberately keeps, that session is not today's: a row headed "Now"
         printing −62 beside an "As of" cell reading "2026-08-21 · 1 session
         back" is a header contradicting the cell two columns along. */
      ["Ended at", "c-num",
        "The score the name held at the end of this comparison — its newest " +
        "measured score, which on a row that is not about today is not today's. " +
        (notes.score || "")],
      ["Δ resid ×10⁴", "c-num", notes.saturation || null],
      ["Run · sessions", "c-num", notes.run || null],
      ["As of", null,
        "Which session this name was last scored on. A move on an older " +
        "session is real and is not about today."],
    ]));

    const body = el("tbody");
    for (const mv of moves.slice(0, CHANGE_MAX)) {
      const tr = el("tr", mv.stale ? "cc-old" : null);

      /* THE EVENT, AS A WORD. Sign and category survive greyscale and a
         monochrome printout because they are spelled out; the class is a
         hook for a tint that repeats what the word already says. */
      const ev = el("td", mv.cross ? "cc-cross is-" + mv.cross : "cc-dim");
      ev.append(el("span", null, mv.cross ? CROSS_WORDS[mv.cross] : "drift"));
      if (mv.cross) ev.title = CROSS_SAID[mv.cross];
      /* A WINDOW EXTREME IS FREE IN THE SAME PAYLOAD. "at its 42-session
         high" is the strongest sentence this archive can produce and it was
         sitting in `ext` with nobody reading it. */
      if (mv.ext && mv.at !== null) {
        const hiAt = isNum(mv.ext.hiAt), loAt = isNum(mv.ext.loAt);
        const extreme = hiAt === mv.at ? "window high" : loAt === mv.at ? "window low" : null;
        if (extreme) {
          const tag = el("span", "cc-dim", " · " + extreme);
          tag.title = "The highest and lowest score this name recorded inside the " +
            "published window, with the session it happened on.";
          ev.append(tag);
        }
      }
      tr.append(ev);

      tr.append(nameCell(
        { t: mv.t, dp: cards.has(mv.t) ? 1 : 0 }, true,
        earningsMark(boardBy.get(mv.t) || null, evBy.get(mv.t)), null));

      tr.append(el("td", "c-num" + tone(mv.v), fmtSigned(mv.v)));

      /* THE GAP, ALWAYS, WITH ITS UNIT. This cell is the whole reason the
         change layer exists: "+37" is the headline of the session when it
         happened overnight and is noise when it happened across three weeks
         the name spent off the board, and the integer is identical. */
      /* THE DIM ONE IS THE ORDINARY ONE. This cell used to mute the multi-
         session spans and leave "1 session" at full contrast, which put the
         page's emphasis on the case that needs no caveat and took it off the
         one that does — a +37 that took three weeks is the reading a reader
         most needs to catch. */
      const over = el("td", mv.gap === 1 ? "cc-dim" : null);
      over.append(el("span", null, sessionsSaid(mv.gap)));
      if (mv.at !== null && mv.gap > 0) {
        const from = mv.at - mv.gap;
        let boardOnly = false, crossedEpoch = false;
        if (from >= 0 && mv.at < sessionRows.length) {
          for (let i = from; i <= mv.at; i++) {
            if (sessionRows[i] && sessionRows[i].source === "boards") boardOnly = true;
          }
          const a = sessionRows[from], b = sessionRows[mv.at];
          if (a && b && Boolean(a.preEpoch) !== Boolean(b.preEpoch)) crossedEpoch = true;
        }
        /* A BOARD-ONLY SESSION IS SPARSER, NOT QUIETER. Those columns were
           reconstructed from archived boards, which carry only the names
           that made a board that day, so a comparison spanning one is not a
           comparison across a full pool. */
        if (boardOnly) {
          const tag = el("span", "cc-dim", " · board-only");
          tag.title = notes.backfill ||
            "One of the sessions this comparison spans was reconstructed from " +
            "archived boards and is genuinely sparser.";
          over.append(tag);
        }
        if (crossedEpoch) {
          const tag = el("span", "cc-dim", " · across the epoch");
          tag.title = notes.epoch ||
            "The two observations come from different selection pools.";
          over.append(tag);
        }
      }
      tr.append(over);

      tr.append(el("td", "c-num" + tone(mv.now), fmtSigned(mv.now)));

      /* THE SAME MOVE IN UNSATURATED UNITS. The score is 100·tanh of the
         residual, so +94 to +97 and +4 to +7 both print +3 and are not the
         same event. Absent when either end carried no residual, which is
         most of the archive's older half — and absent is an em dash, not a
         zero. */
      tr.append(el("td", "c-num" + tone(mv.qv), mv.qv === null ? DASH : fmtSigned(mv.qv)));

      const runCell = el("td", "c-num", mv.run === null ? DASH : String(mv.run));
      runCell.title = mv.run === null
        ? "This payload published no run length for the name."
        : mv.run === 0
          ? "The newest score is exactly zero, which belongs to neither side and " +
            "ends the run."
          : sessionsSaid(mv.run) + " in a row on this sign. A run of one is a new " +
            "opinion; a run of thirty is an old one.";
      tr.append(runCell);

      const asOf = el("td", "cc-dim");
      if (!dated || mv.at === null) {
        asOf.textContent = DASH;
        asOf.title = "This payload published no session index for the name, so " +
          "which session it was last scored on cannot be stated.";
      } else if (!mv.stale) {
        asOf.textContent = "this session";
      } else {
        const behind = lastIndex - mv.at;
        const on = (sessionRows[mv.at] && sessionRows[mv.at].d) || null;
        asOf.textContent = (on ? on : "an earlier session") +
          " · " + sessionsSaid(behind) + " back";
        asOf.title = "This name was not scored in the newest session, so its move " +
          "is real and is not about today.";
      }
      tr.append(asOf);

      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  /* ---------- one key's silence, for every surface that reads it ----

     FOUR KINDS, ONE FUNCTION. `unreadable` is the request not coming back and
     is this page's fault; `pending` is a key never published for this session;
     `unavailable` is the key published WITHOUT the field, which is the payload
     predating the layer; `empty` is the pipeline measuring and finding nothing
     — and that last one is the only one of the four that says anything about
     the market. Returns [kind, sentence] for a silence and null for a reading.

     LIFTED OUT OF paintVerdict FOR THE SAME REASON boardsRead WAS. The
     screened population was a tile in the verdict strip and is the strip's
     caption now, so two surfaces ask this of the same payload. The first
     draft of the caption asked nothing and simply hid the slot when the
     figure was missing — which turns four facts into one absence, on a page
     whose whole argument is that they are four.

     `quietSaid` is passed only where the caller's own denominator is a
     published zero: a null ratio with no such denominator is the payload's
     gap, not the market's. Same kinds, precedence and data-empty names as
     quiet()/silent() give a region, so a tile, a caption and the region
     beneath them never word one fact three ways. */
  const keySilence = (payload, read, quietSaid) => {
    if (!payload) return ["unreadable", "could not be read — refresh to try again"];
    if (payload.status === "pending") return ["pending", "not published yet"];
    if (read) return null;
    if (quietSaid) return ["empty", quietSaid];
    return ["unavailable", "not on this payload"];
  };

  /* ---------- the verdict bar --------------------------------------

     Seven readings the rest of the page then explains. Every one of them is
     allowed to be an em dash: a tile whose endpoint did not answer says so
     by not saying a number, which is the only honest thing a tile can do —
     and then says WHICH of the four silences the dash stands for, because
     the dash alone is one glyph for four facts. */
  function paintVerdict(into, long, short, market, alerts, pulse) {
    const breadth = (market && market.breadth) || {};
    const premium = (market && market.premium) || {};

    /* THE TWO LEAN TILES GET THEIR OWN RECENT HISTORY, out of the same daily
       totals the flow chart draws — so the sparkline on a tile and the bars
       in the region below it are the same numbers, and a reader who compares
       them finds them agreeing.

       DERIVED HERE AND NOT PUBLISHED ANYWHERE: a daily lean is
       (call − put) / (call + put) per session, which is the same construction
       `premium.tilt` uses for today. That is why the line can sit under
       today's figure at all — it is the same quantity, one point a session,
       rather than a second measurement with a similar name.

       NEWEST LAST, because a line runs left to right and the payload orders
       these newest first. Reversed on a copy: the array is the payload's. */
    const daily = (() => {
      const tot = pulse && pulse.totals;
      if (!tot || tot.status !== "ok" || !Array.isArray(tot.rows)) return null;
      const rows = tot.rows.slice().reverse().slice(-21);
      const lean = [], gross = [];
      for (const r of rows) {
        const c = isNum(r && r.callPrem), pu = isNum(r && r.putPrem);
        if (c === null || pu === null) { lean.push(null); gross.push(null); continue; }
        const g = Math.abs(c) + Math.abs(pu);
        lean.push(g > 0 ? (c - pu) / g : null);
        gross.push(g);
      }
      return { lean, gross };
    })();

    /* THE SPLIT AS TWO SHARES, which is what the target prints under each of
       these bars ("85% call / 15% put"). The counts are already the tile's
       value; this says what fraction of the WHOLE each side is, which a
       reader otherwise does in their head off two three-digit numbers.

       BOTH SIDES OR NEITHER. A share needs a denominator, so one half missing
       leaves no sentence rather than a percentage of a number nobody has —
       the em dash in the value above is already saying which half is absent.
       A denominator of zero is a measured session in which nothing cleared;
       that gets no percentage either, because 0/0 is undefined and "0%" would
       be a claim. */
    const shareOf = (a, b) => {
      if (a === null || b === null) return null;
      const whole = a + b;
      if (!(whole > 0)) return null;
      return [Math.round((a / whole) * 100) + "% bull / " +
        Math.round((b / whole) * 100) + "% bear", null, null];
    };

    /* THE NEWEST SESSION'S TOTAL, for the Premium tile. Taken off the end of
       the series the sparkline draws, so the figure is the last point of its
       own line rather than a second read that could differ from it. */
    const grossNow = (() => {
      if (!daily || !Array.isArray(daily.gross)) return null;
      for (let i = daily.gross.length - 1; i >= 0; i--) {
        if (daily.gross[i] !== null) return daily.gross[i];
      }
      return null;
    })();

    /* FOUR SILENCES, FOUR SENTENCES, ON A TILE. Both tilt tiles printed "not
       measured this session" whenever the ratio was null — whether
       /api/flows/market failed to read, is unpublished, is published without
       the field, or was measured over nothing. Only the last is a reading;
       the words were shaped as one for all four, and the Session tile did the
       same with a bare em dash and no sub. Same kinds, precedence and
       data-empty names as quiet()/silent() give a region, so a tile and the
       region beneath it never word one fact two ways. `quietSaid` is passed
       only when the caller's own denominator is a published zero — a null
       ratio with no such denominator is the payload's gap, not the market's.
       Returns [kind, sentence] for a silence and null for a reading. */
    const tileSilence = keySilence;

    const { silence: boardsSilence, date: sessionDate } = boardsRead(long, short);

    /* THE POOL, NOT THE ROWS — poolCount, the number the rail badges, so the
       rail, this tile and each board's own status line agree. The counted-
       versus-carried gap is stated by the region that lists the rows, which
       is where a reader is when the difference can affect a reading. */
    const bulls = poolCount(long);
    const bears = poolCount(short);
    /* THE VENDOR'S CEILING IS NOT A CENSUS. shared/flows-alerts.js publishes
       `vendorTruncated` beside `seen` when the read came back at the vendor's
       documented maximum — 2026-08-24: seen 200, vendorLimit 200, truncated.
       This tile printed "200" and the region subtitle "8 of 200", a ceiling
       as a population. The true count is unknown and at least 200, and the
       ≥ carries that: a withholding never folds, but it does not need a
       sentence to say so when the glyph is the statement. */
    const seen = isNum(alerts && alerts.seen);
    const atLimit = Boolean(alerts) && alerts.vendorTruncated === true;

    /* TWO TILTS, BECAUSE THE PAYLOAD PUBLISHES TWO AND REFUSES TO CHOOSE.
       breadth.tilt counts names, premium.tilt weights dollars; they are the
       same ratio under two weightings, and shared/flows-market.js says in
       so many words that publishing both is what removes the weighting
       choice instead of burying it. This bar used to print ONE of them
       under the bare label "Tilt", so on a day the two part company the
       landing page showed the opposite sign to /flows/market/ over the same
       payload — and it printed a bounded ratio to four decimals with no
       unit at all. Both are now shares, in per cent, of the thing being
       weighted. */
    const bt = isNum(breadth.tilt);
    const pt = isNum(premium.tilt);
    /* THE QUIET CASE IS THE SHAPER'S OWN 0/0, read off its published
       denominator: breadth.tilt is null when bull + bear is 0, premium.tilt
       when netPositive + netNegative is 0 (shared/flows-market.js:157, :168).
       Both published as zero is a measurement; either absent is not. */
    const bull = isNum(breadth.bull), bear = isNum(breadth.bear);
    const leaned = bull !== null && bear !== null ? bull + bear : null;
    const up = isNum(premium.netPositive), down = isNum(premium.netNegative);
    const gross = up !== null && down !== null ? up + down : null;
    const btSilence = tileSilence(market, bt !== null, leaned === 0 ? "no name leaned" : null);
    const ptSilence = tileSilence(market, pt !== null,
      gross === 0 ? "no net premium was priced" : null);

    /* NO TILE CARRIES A SUBTITLE WHILE ITS NUMBER IS REAL.

       Seven tiles each explaining themselves underneath is a paragraph
       wearing a strip's clothes — and the strip is the one element on this
       page a reader is meant to take in at a glance, not read. Every
       definition that stood here has a home: the tilts' denominators are
       stated where /flows/market/ draws them, the cleared board's
       counted-vs-carried caveat is stated by the region that lists it, and
       the flagged ceiling is carried by the ≥ on the number itself.

       The values were rewritten to need no gloss rather than merely losing
       one: "41 bull / 48 bear" reads in one direction and cannot be divided
       the wrong way round, where "41 / 48" needed a line underneath.

       THE SUBTITLE SLOT REMAINS, AND ONLY A SILENCE MAY USE IT. A dash is
       the one value on this strip that cannot explain itself, and the four
       silences are what separate "not published yet" from "the fetch broke"
       from "measured, and empty". Dropping those sentences would not make
       the page denser; it would make four different facts look like one. */
    /* FIVE TILES, NOT SEVEN, AND THE TWO THAT LEFT WERE NOT MEASUREMENTS.

       `Session` is a date and `Screened` is a population — the row's caption,
       not two of its readings. They sat in a strip a reader is meant to take
       in at a glance, where the only useful move is comparing one tile to the
       next, and neither could be compared to anything. Both are drawn above
       the strip now, by paintMeta, in the place a reader looks to answer "is
       this today" before reading any figure at all.

       WHAT REMAINS IS FIVE THINGS THAT MOVED TODAY, each with the shape of
       its own number beside it: two counts that split, two ratios that lean,
       and one census with a ceiling on it. */
    const flagSpread = (() => {
      /* THE FLAGGED TILE'S OWN DISTRIBUTION, out of the rows the page already
         holds. A count with a ceiling on it says how many windows there were
         and nothing about whether they were alike — eight windows of $1M and
         one of $8M beside seven of $30k are the same integer. The bars are
         the premium of the largest windows in hand, largest first, which is
         the shape that integer is hiding. */
      const rows = Array.isArray(alerts && alerts.rows) ? alerts.rows : [];
      const prems = rows.map((r) => isNum(r && r.prem))
        .filter((v) => v !== null && v > 0).sort((a2, b2) => b2 - a2).slice(0, 14);
      return prems.length >= 3 ? ["hist", prems] : null;
    })();

    const tiles = [
      ["Breadth",
        (bull === null ? DASH : String(bull)) + " bull / " + (bear === null ? DASH : String(bear)) + " bear",
        null, tileSilence(market, bull !== null && bear !== null, null), ["split", bull, bear],
        shareOf(bull, bear)],
      ["Cleared",
        (bulls === null ? DASH : bulls) + " bull / " + (bears === null ? DASH : bears) + " bear",
        null, boardsSilence(bulls !== null || bears !== null), ["split", bulls, bears],
        shareOf(bulls, bears)],
      /* FIVE TILES, AND THE DEMOTED READING KEEPS EVERYTHING IT HAD.

         The target strip reads BREADTH / CLEARED / FLOW BIAS / PREMIUM /
         FLAGGED. This page publishes two tilts — names-weighted and
         dollars-weighted — and shared/flows-market.js says publishing both is
         what removes the choice between them, so neither is deleted.

         THE FIRST ATTEMPT AT THIS FOLD WAS A SILENCE COLLAPSE. The name lean
         went into the dollar tile's sub-line as a bare `pct(bt, 1)` rendered
         only when the value was non-null — so unreadable, pending,
         unavailable and empty all became "no sub-line", four facts flattened
         into one absence. CI caught the missing VALUE; it would not have
         caught the missing silences for much longer, which is the worse half,
         and it is the same defect this branch opened with.

         So the sub-line carries what the tile carried: the figure when there
         is one, that reading's OWN silence sentence when there is not, its
         own kind on data-empty for the mark, and its own sign-tone. A
         qualifier slot that cannot do those three things is not somewhere a
         reading can be moved to. */
      ["Flow bias", pct(pt, 1), tone(pt), ptSilence,
        daily && daily.lean ? ["spark", daily.lean] : ["signed", pt],
        bt !== null
          ? [pct(bt, 1) + " weighting names equally", null, tone(bt)]
          : (btSilence ? ["Names equally weighted: " + btSilence[1], btSilence[0], null] : null)],
      /* THE DOLLAR TOTAL, FROM THE SERIES THE RING AND THE CHART ALREADY
         READ. `daily.gross` is |callPrem| + |putPrem| a session, built two
         hundred lines up from the same pulse rows paintSplit takes its ring
         from — so the tile, the ring and the daily chart cannot disagree
         about what a session's premium was. It was computed and then used for
         nothing until now.

         NO SESSION-OVER-SESSION DELTA, which the target prints beside this
         figure as "+4.1%". Nothing publishes one for this population, and the
         two newest rows of a 20-row window are not it: that would be a
         reading invented at the render, which is the one thing this strip
         does not do. The sparkline carries the direction instead. */
      ["Premium", grossNow === null ? DASH : usd(grossNow), null,
        tileSilence(pulse, grossNow !== null, null),
        daily && daily.gross ? ["spark", daily.gross] : null],
      ["Flagged windows", seen === null ? DASH : (atLimit ? "\u2265" : "") + seen, null,
        tileSilence(alerts, seen !== null, null), flagSpread],
    ];

    /* A silent tile keeps its dash, prints the silence's sentence as its sub
       and carries the kind on data-empty — the mark flows.css draws for a
       region's silence — so the four are told apart without prose. */
    /* AND FOUR OF THE SEVEN CARRY THE SHAPE OF THEIR OWN NUMBER.

       "−7.9%" and "41 bull / 48 bear" are the same two facts a reader has to
       decode from digits every time: which side, and by how much. A bar off a
       centre line answers the first before the number is read at all, and the
       second at a glance; the digits stay for the reader who wants a value
       rather than an impression.

       BUILT FROM THE SAME VALUE THE TILE PRINTS, never from a second read of
       the payload — a diagram that can disagree with the number beside it is
       worse than no diagram. A SILENT tile gets no bar at all: there is
       nothing to draw, and a zero-width one would read as a measured zero,
       which is the distinction this page exists to keep.

       SVG and no library: two rects and a rule. `aria-hidden`, because every
       figure in them is already in the text beside them. */
    const viz = (spec) => {
      if (!Array.isArray(spec)) return null;
      const svg = svgEl("svg", { class: "cc-viz", viewBox: "0 0 100 8",
        preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
      if (spec[0] === "signed") {
        const v = isNum(spec[1]);
        if (v === null) return null;
        /* THE SCALE IS ±0.25 OF THE RATIO, NOT ±1. Both leans are bounded to
           ±1 by construction and in practice sit inside a tenth of that, so a
           full-scale bar would be invisible on every ordinary session — the
           same defect the score bars had before they were floored. Past the
           floor the bar pins at the edge and the number carries the excess. */
        const frac = Math.max(-1, Math.min(1, v / 0.25));
        const half = Math.abs(frac) * 50;
        svg.append(svgEl("rect", { class: "cc-viz-t", x: frac < 0 ? 50 - half : 50,
          y: 1, width: Math.max(0.8, half), height: 6 }));
        svg.append(svgEl("line", { class: "cc-viz-z", x1: 50, x2: 50, y1: 0, y2: 8 }));
        svg.setAttribute("class", "cc-viz " + (v < 0 ? "is-neg" : v > 0 ? "is-pos" : "is-zero"));
        return svg;
      }
      if (spec[0] === "split") {
        const a = isNum(spec[1]), b = isNum(spec[2]);
        if (a === null || b === null || !(a + b > 0)) return null;
        const w = (a / (a + b)) * 100;
        svg.append(svgEl("rect", { class: "cc-viz-a", x: 0, y: 1, width: w, height: 6 }));
        svg.append(svgEl("rect", { class: "cc-viz-b", x: w, y: 1, width: 100 - w, height: 6 }));
        return svg;
      }
      /* A SERIES, AS A LINE, WHICH IS WHAT A TILE CANNOT SAY IN ONE FIGURE.

         "−2.5%" is today. Whether today is the third session leaning the same
         way or a reversal of a fortnight is a different fact, and the tile
         had no room for it in words. Scaled to the SERIES' own range and
         anchored at zero where the series crosses it, so the line's shape is
         the reading and its height is not comparable to any other tile's —
         which is why no value is drawn beside it. The figure above is the
         number; this is its recent history and nothing more.

         A POLYLINE AND NOT AN AREA: an area fill under a signed series reads
         as a quantity accumulated, and this is a level at each point. */
      if (spec[0] === "spark") {
        const vals = Array.isArray(spec[1]) ? spec[1].map((v) => isNum(v)) : [];
        const seen = vals.filter((v) => v !== null);
        if (seen.length < 3) return null;
        const lo = Math.min(0, ...seen), hi = Math.max(0, ...seen);
        const range = (hi - lo) || 1;
        const step = vals.length > 1 ? 100 / (vals.length - 1) : 100;
        const pts = [];
        vals.forEach((v, i) => {
          if (v === null) return;
          pts.push((step * i).toFixed(2) + "," + (8 - ((v - lo) / range) * 8).toFixed(2));
        });
        if (pts.length < 3) return null;
        /* THE ZERO RULE ONLY WHERE ZERO IS INSIDE THE RANGE. Drawn at the
           edge of a one-sided series it is not a reference, it is a border. */
        if (lo < 0 && hi > 0) {
          const zy = (8 - ((0 - lo) / range) * 8).toFixed(2);
          svg.append(svgEl("line", { class: "cc-viz-z", x1: 0, x2: 100, y1: zy, y2: zy }));
        }
        const last = seen[seen.length - 1];
        svg.append(svgEl("polyline", {
          class: "cc-viz-s" + (last < 0 ? " is-neg" : last > 0 ? " is-pos" : ""),
          points: pts.join(" "), fill: "none",
        }));
        return svg;
      }
      /* A DISTRIBUTION, WHICH THE COUNT BESIDE IT CANNOT CARRY. Scaled to the
         largest bar in the set and never to a constant: this is a shape, and
         the only claim it makes is the relative one — the tile's digits are
         what carry magnitude. Anchored at the BOTTOM rather than centred,
         because every value in it is a magnitude with no sign to place. */
      if (spec[0] === "hist") {
        const vals = Array.isArray(spec[1]) ? spec[1].map((v) => isNum(v)).filter((v) => v !== null) : [];
        if (vals.length < 3) return null;
        const top = Math.max(...vals.map(Math.abs));
        if (!(top > 0)) return null;
        const step = 100 / vals.length;
        vals.forEach((v, i) => {
          const h = Math.max(0.8, (Math.abs(v) / top) * 8);
          svg.append(svgEl("rect", { class: "cc-viz-h",
            x: (step * i + step * 0.16).toFixed(2), width: (step * 0.68).toFixed(2),
            y: (8 - h).toFixed(2), height: h.toFixed(2) }));
        });
        return svg;
      }
      return null;
    };

    /* THE SUB-LINE IS EITHER THE SILENCE OR THE QUALIFIER, NEVER BOTH.
       A silent tile has no reading for a qualifier to be about, so the two
       cannot collide — and the silence always wins, because "not measured" is
       the more important of the two things a reader could be told. */
    for (const [key, value, cls, silence, spec, sub] of tiles) {
      const tile = el("div", "cc-tile");
      if (silence) tile.dataset.empty = silence[0];
      tile.append(el("span", "cc-tile-k", key));
      tile.append(el("span", "cc-tile-v" + (cls || ""), String(value)));
      const bar = silence ? null : viz(spec);
      if (bar) tile.append(bar);
      /* TWO SLOTS, NOT ONE, AND THEY ARE NOT ALTERNATIVES.

         `.cc-tile-s` is the TILE's own silence. `.cc-tile-q` is a READING
         that was demoted into this tile and carries its own figure, its own
         sign and its own silence. An `else if` between them was the second
         version of the same collapse: on a market key that failed to read,
         BOTH tilts are silent, the tile's sentence won, and the equal-weight
         tilt's silence was never rendered at all — two facts shown as one,
         which is the thing this strip exists to refuse. */
      if (silence && silence[1]) tile.append(el("span", "cc-tile-s", silence[1]));
      if (sub) {
        const se = el("span", "cc-tile-q" + (sub[2] || ""), sub[0]);
        if (sub[1]) se.dataset.empty = sub[1];
        tile.append(se);
      }
      into.append(tile);
    }
  }

  /* ---------- what the two boards say about the session -------------

     THE TWO BOARDS ARE TWO WRITES OF ONE SESSION, so "which session is this"
     and "is that a silence" are one question asked of both halves: a half
     that answered names it, and only when neither did is there a silence —
     unreadable if either fetch failed, pending if both are unpublished,
     unavailable if a half answered without the field.

     LIFTED OUT OF paintVerdict BECAUSE THERE ARE TWO CALLERS NOW. The session
     used to be a tile in the verdict strip and is the strip's caption; the
     `Cleared` tile is still in the strip. A second copy of this decision is
     how the caption comes to say "not published yet" over a strip that says
     "could not be read", about the same two payloads, four lines apart —
     and it is how the four silences quietly become one, which is the
     distinction this page exists to keep. */
  function boardsRead(long, short) {
    const answered = [long, short].filter((p) => p && p.status !== "pending");
    const longDate = answered.includes(long) ? long.sessionDate : null;
    const shortDate = answered.includes(short) ? short.sessionDate : null;
    const date = (typeof longDate === "string" && longDate) ||
      (typeof shortDate === "string" && shortDate) || null;
    const silence = (read) => read ? null
      : answered.length ? ["unavailable", "not on this payload"]
        : (!long || !short) ? ["unreadable", "could not be read — refresh to try again"]
          : ["pending", "not published yet"];
    return { silence, date };
  }

  /* ---------- the session's caption --------------------------------

     WHICH SESSION, OVER HOW MANY NAMES, AND WHETHER IT IS STILL MOVING. The
     first two were tiles in the verdict strip until this change; they are
     stated here because they qualify every figure on the page rather than
     being one of them.

     THE THIRD IS NEW AND IT IS A HONESTY FIX, not a decoration. Some keys on
     this page refresh intraday and some are written once at the open, so
     "16:28 UTC" on the alerts region and a morning board sat on one screen
     with nothing saying they were read hours apart. The stamp here is the
     NEWEST read across the payloads the page actually holds, and it is
     labelled as a read time rather than as a session time. */
  function paintMeta(box, dateEl, screenedEl, liveEl, boards, market, reads) {
    if (!box) return;
    let said = false;
    /* THE FOUR SILENCES SURVIVED THE MOVE, and keeping them was the whole
       care in it. This line replaced a TILE that carried them — "could not be
       read", "not published yet", "not on this payload" are three different
       facts about the pipeline and only one of them is about the market — and
       the first draft of this caption printed one sentence for all three.
       That is the collapse this page is built to refuse, reintroduced by a
       layout change. Same function the strip's Cleared tile reads, so the two
       cannot word one fact two ways. */
    const { silence: boardsSilence, date } = boardsRead(boards[0], boards[1]);
    const quiet = boardsSilence(date !== null);
    if (dateEl) {
      dateEl.textContent = date || (quiet ? "session " + quiet[1] : "");
      if (quiet) dateEl.dataset.empty = quiet[0];
      else delete dateEl.dataset.empty;
      said = said || Boolean(date) || Boolean(quiet);
    }
    /* AND THE SCREENED POPULATION KEEPS ITS FOUR SILENCES TOO. It was a tile
       that carried them and the first draft of this caption hid the slot
       whenever the figure was absent — so a market key that failed to read
       and one that has never been published looked identical, which is
       exactly the collapse the session line above was fixed for. Hiding is
       reserved for the one case that is not a silence at all: a page with no
       market payload in play. */
    const n = isNum(market && market.n);
    const nQuiet = keySilence(market, n !== null, null);
    if (screenedEl) {
      screenedEl.textContent = n === null
        ? (nQuiet ? "screened " + nQuiet[1] : "")
        : n + " names screened";
      if (nQuiet) screenedEl.dataset.empty = nQuiet[0];
      else delete screenedEl.dataset.empty;
      screenedEl.hidden = n === null && !nQuiet;
      said = said || n !== null || Boolean(nQuiet);
    }
    /* THE NEWEST STAMP WINS AND A MISSING ONE IS NOT A ZERO. Payloads that
       carry no readAt simply do not vote; if none does, the line is absent
       rather than showing the page-load time, which would be this browser's
       clock dressed as the pipeline's. */
    const stamps = reads.map((r) => (typeof r === "string" && /T\d{2}:\d{2}/.test(r) ? r : null))
      .filter(Boolean).sort();
    if (liveEl && stamps.length) {
      const newest = stamps[stamps.length - 1];
      const m = /T(\d{2}:\d{2})/.exec(newest);
      liveEl.textContent = m ? "read " + m[1] + " UTC" : "";
      liveEl.hidden = !m;
      said = said || Boolean(m);
    }
    box.hidden = !said;
  }

  /* ---------- the market's flow, session by session -----------------

     THE ONE REGION ON THIS PAGE WITH TIME ON AN AXIS. Everything else states
     a level at today's close; this states how the market got here, out of a
     `pulse` key that has been published and served and drawn nowhere.

     DAILY, NOT INTRADAY, AND THAT IS A DECISION RATHER THAN WHAT WAS EASIEST.
     The same key carries BOTH: `tide` is the vendor's intraday series at its
     own cadence, and `totals` is one row a session. The first draft of this
     region led on the intraday one and offered the daily periods beside it,
     which meant one control sliding between two quantities on two different
     clocks — the unit conflation this codebase keeps finding in its own
     columns, rebuilt on purpose and then explained in a paragraph. The owner
     asked for the daily reading and that resolves it: every period here is
     the same series at a different length, so the control is a WINDOW and not
     a source, and the note under the chart is one sentence instead of two.

     `tide` is still on the payload and still unread. It is a different
     question — "how did TODAY accumulate" — and it belongs to a panel that
     asks it, not to this one.

     TWO BARS PER SESSION, BY SIDE — AND THE SIDE IS NOT A SIGN.

     THIS PARAGRAPH USED TO SAY THE OPPOSITE AND IT WAS WRONG. It read: "call
     premium and put premium are NET figures: the vendor publishes them
     signed... and the sign is the reading." That is true of `pulse.points`,
     which shapeTide builds from `net_call_premium` / `net_put_premium`
     (shared/flows-pulse.js:132-133) — and this chart does not draw that
     series. Every period below reads `totals`, which shapeTotals builds from
     the vendor's `call_premium` / `put_premium` columns
     (shared/flows-pulse.js:154-155): GROSS sums, non-negative by
     construction. The two arrays carry the same FIELD NAMES for two different
     quantities, which is how the claim survived the switch to a daily source.

     So there is no sign to read here, and pretending otherwise would be the
     confident reading this whole section exists to refuse. What the two sides
     mean is drawn instead: call premium upward, put premium downward, both as
     MAGNITUDES from a common zero. The picture is the one a reader expects —
     green above, red below — and the axis names the side rather than printing
     a minus sign in front of a number that was never negative. */
  const TIDE_PERIODS = [
    ["1W", "totals", 5],
    ["1M", "totals", 21],
    ["3M", "totals", 63],
    ["All", "totals", null],
  ];

  /* ONE SOURCE, AND THE PARAMETER IS GONE WITH IT. While this read two keys
     the shape had to carry which one; every period is `totals` now, so a
     branch on a source would be a branch that cannot be taken — and a dead
     branch is how the next reader concludes the other source is still live
     here. `span` is a count of SESSIONS, null for the whole window. */
  function tideSeries(pulse, span) {
    const tot = pulse && pulse.totals;
    if (!tot || tot.status !== "ok" || !Array.isArray(tot.rows)) return null;
    /* THE PAYLOAD ORDERS THESE NEWEST FIRST and a time axis runs the other
       way. Reversed on a COPY: the array is the payload's and two regions
       read it. */
    const rows = tot.rows.slice().reverse()
      .map((r) => ({ at: r && r.date, call: isNum(r && r.callPrem), put: isNum(r && r.putPrem) }))
      .filter((r) => r.call !== null || r.put !== null);
    const kept = span && span < rows.length ? rows.slice(-span) : rows;
    return kept.length >= 2 ? kept : null;
  }

  function paintTide(into, seg, pulse) {
    if (silent(into, pulse, "market pulse feed")) return;

    /* WHICH PERIODS ARE OFFERED IS DECIDED BY WHAT READS, not by the list.
       A button that selects an empty chart is worse than an absent one: it
       tells a reader the data exists and that they mis-clicked. */
    const live = TIDE_PERIODS
      .map(([label, , span]) => [label, span, tideSeries(pulse, span)])
      .filter(([, , rows]) => rows);
    if (!live.length) {
      quiet(into, "empty",
        "The pulse key carried no timestamped premium series for this session.");
      return;
    }
    /* A WIDER PERIOD THAT DRAWS THE SAME ROWS AS A NARROWER ONE IS NOT A
       CHOICE. Twenty sessions of history offered as both "1M" and "All" is
       one chart behind two labels, and a reader who clicks between them and
       sees nothing move learns the control is decorative. */
    const seen = new Set();
    const periods = live.filter(([, , rows]) => {
      if (seen.has(rows.length)) return false;
      seen.add(rows.length);
      return true;
    });

    let active = 0;
    const draw = () => {
      into.replaceChildren();
      seg.replaceChildren();
      periods.forEach(([label], i) => {
        const b = el("button", "cc-seg-b", label);
        b.type = "button";
        if (i === active) b.setAttribute("aria-current", "true");
        b.addEventListener("click", () => { active = i; draw(); });
        seg.append(b);
      });

      const [label, , rows] = periods[active];
      /* ROOM ON THE RIGHT FOR THE VALUE MARKS, and a little more at the top so
         the highest label is not clipped by the viewBox. A label drawn
         outside the box is a label nobody sees. */
      const W = 1000, H = 230, padT = 20, padB = 26, padL = 0, padR = 96;
      const plotH = H - padT - padB, plotW = W - padL - padR;
      /* THE DOMAIN IS THE RANGE THE DATA ACTUALLY OCCUPIES, ANCHORED AT ZERO.

         A symmetric ±peak axis is the reflex for a signed series and it is
         wrong whenever the series does not straddle zero: on a week where
         every session cleared positive premium, half the plot was empty and
         every bar was drawn at half the height it had room for. Anchored
         instead — lo = min(0, smallest), hi = max(0, largest) — the axis
         covers exactly what was measured and still contains its own origin,
         so a positive bar and a negative bar are drawn against ONE linear
         scale and remain comparable by height. That is the property a
         symmetric axis was protecting, and it survives.

         The three value marks below are drawn from lo, 0 and hi for the same
         reason: they are the ends of the scale and its origin, which is what
         fixes a linear axis. */
      /* THE PUT SIDE IS PLOTTED AT ITS NEGATIVE and is not a negative number.
         `lo` is the downward reach of the put bars and `hi` the upward reach
         of the call bars; both are magnitudes, and the marks below say which
         side each end belongs to rather than signing it. A gross figure that
         arrives negative is a payload this drawing cannot represent, so it is
         clamped to zero rather than drawn on the wrong side of the rule. */
      let lo = 0, hi = 0;
      for (const r of rows) {
        const c = r.call === null ? null : Math.max(0, r.call);
        const p = r.put === null ? null : Math.max(0, r.put);
        if (c !== null && c > hi) hi = c;
        if (p !== null && -p < lo) lo = -p;
      }
      if (!(hi > lo)) { hi = 1; lo = 0; }
      const span = hi - lo;
      const yOf = (v) => padT + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / span) * plotH;
      const zeroY = yOf(0);
      const step = plotW / rows.length;
      /* TWO BARS IN THE SLOT, SIDE BY SIDE, AND THE WIDTH IS CAPPED.

         The gap is a FRACTION of the slot rather than a constant, because a
         constant wins at twenty sessions and erases the bars at sixty. The
         cap is what the first draft was missing: at five sessions the slot is
         200 units of a 1000-unit box and a proportional bar is 78 of them —
         drawn, that is a block, not a bar, and a week of flow read as five
         coloured panels. Capped, a short window is sparse bars on a wide
         axis, which is what five sessions actually are. */
      const barW = Math.max(0.6, Math.min(22, (step * 0.78) / 2));

      /* NOT "none": that scales x and y apart, so bar HEIGHTS — the whole
         reading — get multiplied by whatever the host/viewBox ratio happens
         to be. The same defect was found and fixed on the premium-track panel
         this session; this is its twin on the landing page. */
      const svg = svgEl("svg", { class: "cc-tide-c", viewBox: "0 0 " + W + " " + H,
        width: "100%", height: H, preserveAspectRatio: "xMidYMid meet", role: "img" });
      const g = svgEl("g", { class: "cc-tide-bars" });
      rows.forEach((r, i) => {
        const x0 = padL + step * i + step * 0.11;
        for (const [v, cls, off] of [
          [r.call === null ? null : Math.max(0, r.call), "is-call", 0],
          [r.put === null ? null : -Math.max(0, r.put), "is-put", barW],
        ]) {
          if (v === null) continue;
          const y = yOf(v);
          g.append(svgEl("rect", {
            class: "cc-tide-b " + cls,
            x: (x0 + off).toFixed(2), width: barW.toFixed(2),
            y: Math.min(y, zeroY).toFixed(2),
            height: Math.max(0.7, Math.abs(zeroY - y)).toFixed(2),
          }));
        }
      });
      svg.append(g);

      /* THE ENDS OF THE AXIS AND THE SCALE, AND NOTHING ELSE. A tick per
         bucket is 78 labels; a tick every nth is a ruler whose spacing means
         nothing. The two ends say which window this is and the scale says
         what a full-height bar is worth, which together are what a bar can
         be measured against. */
      const stamp = (v) => {
        if (typeof v !== "string") return null;
        const m = /T(\d{2}:\d{2})/.exec(v);
        return m ? m[1] : (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
      };
      const ends = [[stamp(rows[0].at), 2, "start"], [stamp(rows[rows.length - 1].at), W - 2, "end"]];
      for (const [text, x, anchor] of ends) {
        if (!text) continue;
        const t = svgEl("text", { class: "cc-tide-x", x, y: H - 8, "text-anchor": anchor });
        t.textContent = text;
        svg.append(t);
      }

      /* THREE VALUE MARKS ON THE RIGHT: the two extremes of the scale and its
         zero. A bar is only measurable against a number, and "full height
         $25.30B" in the corner told a reader what the TALLEST bar is worth
         without telling them what a half-height one is. Three marks is the
         fewest that fix a linear scale — the ends and the origin — and on a
         symmetric axis they are the only three whose positions are known
         without a tick ladder a reader has to count along.

         RIGHT-HAND SIDE, WHICH IS WHERE THE SERIES ENDS. A left axis is read
         before the data on a chart that runs left to right; this one is read
         after, when the question is "how big was that". */
      for (const v of [hi, 0, lo]) {
        const y = yOf(v);
        svg.append(svgEl("line", { class: "cc-tide-g", x1: padL, x2: W - padR, y1: y, y2: y }));
        const lab = svgEl("text", { class: "cc-tide-y", x: W - padR - 4, y: y - 4, "text-anchor": "end" });
        /* THE MARK CARRIES THE SIDE, NOT A SIGN. usd(lo) would print
           "-$60M" for a put total that is not negative and never was. */
        lab.textContent = v === 0 ? "$0"
          : v > 0 ? usd(v) + " call" : usd(-v) + " put";
        svg.append(lab);
      }
      svg.setAttribute("aria-label",
        rows.length + " sessions" +
        " from " + (stamp(rows[0].at) || "the start of the window") +
        " to " + (stamp(rows[rows.length - 1].at) || "its end") +
        ", the vendor's gross call and put premium drawn as two bars a session " +
        "against one common scale — calls upward to " + usd(hi) + ", puts downward " +
        "to " + usd(-lo) + ". Both are magnitudes; neither side is a negative number.");

      const key = el("div", "cc-tide-k");
      key.append(el("span", "cc-tide-key is-call", "Call premium"));
      key.append(el("span", "cc-tide-key is-put", "Put premium"));
      /* THE LEGEND NO LONGER CARRIES THE SCALE. It said "full height $25.30B",
         which is the same fact the top axis mark now states — in the place a
         reader measures a bar against rather than in a corner. */
      into.append(key);
      into.append(svg);

      /* THE CURSOR OVER THE SAME ROWS THE BARS WERE DRAWN FROM. A session's
         two bars are a pair, so the readout is the pair — call above put,
         each a magnitude, which is what the axis marks above already say and
         what stops a reader reading the downward bar as a negative number.

         AN ABSENT SIDE PRINTS THE EM DASH RATHER THAN $0, for the same reason
         the bar for it is not drawn at all: a session the feed did not carry
         and a session that cleared nothing are two different facts, and this
         chart has always refused to merge them.

         x IS THE MIDDLE OF THE PAIR, not of the call bar: the rule should
         land between the two bars a reader is being told about, and the pair
         occupies step*0.11 to step*0.11 + 2*barW inside its slot. */
      if (window.FlowsCursor && rows.length) {
        window.FlowsCursor.attach(svg, {
          name: "Daily call and put premium, " + label,
          band: { y0: padT, y1: padT + plotH },
          points: rows.map((r, i) => ({
            x: padL + step * i + step * 0.11 + barW,
            /* `at`, NOT `d`. tideSeries names the session `at` — the row it
               maps from carries `date` and it renames it — and the first
               registration here read `.d`, the board row's key, which is the
               same confusion that once printed "undefined leans most bullish"
               in the sector region. Driven rather than read: every readout
               came back with an em dash for its heading, which is what sent
               me to the shaper. */
            label: r.at || DASH,
            rows: [
              { k: "Call", v: r.call === null ? DASH : usd(Math.max(0, r.call)), cls: "is-pos" },
              { k: "Put", v: r.put === null ? DASH : usd(Math.max(0, r.put)), cls: "is-neg" },
            ],
          })),
        });
      }

      /* THE POPULATION AND THE UNIT, IN WORDS. Every period draws the same
         series at a different length, so this says what a bar IS once and
         then says how many of them are on screen. It never folds: a reader
         who does not know these are whole-session totals carried without
         cumulation reads a different chart. */
      into.append(el("p", "cc-note",
        label + " is " + rows.length + " session" + (rows.length === 1 ? "" : "s") +
        " of the vendor's own daily call and put premium, one bar a session, carried " +
        "without cumulation or smoothing. Each pair is what crossed that session — " +
        "not a running total, and not a forecast of anything."));
    };
    draw();
  }

  /* ---------- the session's call/put split -------------------------

     ONE FIGURE FOR A NUMBER THAT WAS ONLY EVER REACHABLE AS ITS OWN INVERSE.
     `market.premium` publishes netPositive and netNegative — dollars of
     bullish and bearish option premium — and the page's only reading of them
     was `tilt`, a signed ratio in a tile. A reader who wanted "how much of
     this session was calls" had to take a percentage, invert it and halve it.

     THE RING IS THE SHARE AND THE TWO TOTALS ARE WHAT IT IS A SHARE OF, side
     by side, because a percentage with no denominator is the reading this
     codebase refuses everywhere else. A session of $400M against one of $4M
     can print the identical ring.

     DRAWN AS AN ARC RATHER THAN A BAR because the two parts are shares of one
     whole and always sum to it — the one case where a ring says something a
     split bar does not: that there IS a whole, and that it closes. */
  /* THIS RING READ THE WRONG FIELD AND SAID SO IN THE LEGEND.

     It was built on `market.premium.netPositive` / `netNegative`, assigned
     them to variables named `call` and `put`, and labelled them "Calls" and
     "Puts". Those two fields are the sums of POSITIVE and NEGATIVE net
     premium across names — and shared/flows-market.js:147-150 says, verbatim,
     that they are "not call premium and not put premium, both of which are
     separate screener columns a reader could hold beside these and have no
     way to know are unrelated". A name whose flow was heavily put-buying but
     whose net came out positive counted toward "Calls". The comment warning
     against exactly this was written before the ring existed and the ring did
     it anyway.

     THE CALL/PUT SPLIT IS A REAL READING AND IT HAS A REAL FIELD: the pulse
     key's daily totals carry the vendor's own `callPrem` / `putPrem` for each
     session (shared/flows-pulse.js:154-155). Those ARE call premium and put
     premium. The newest row is this session's, and the sub-line below names
     its date rather than assuming it is the session the rest of the page is
     describing — the two feeds have disagreed before. */
  function paintSplit(into, sub, pulse) {
    if (silent(into, pulse, "market pulse feed")) return;
    const tot = (pulse && pulse.totals) || null;
    if (!tot || tot.status !== "ok" || !Array.isArray(tot.rows)) {
      quiet(into, "unavailable",
        "The pulse key is published without the daily totals this split is built from.");
      return;
    }
    if (!tot.rows.length) {
      quiet(into, "empty", "The daily totals were read and carried no session.");
      return;
    }
    /* NEWEST FIRST, as the payload orders them — see tideSeries, which reverses
       a COPY for its own axis and leaves this order alone. */
    const row = tot.rows[0] || {};
    const call = isNum(row.callPrem), put = isNum(row.putPrem);
    if (call === null || put === null) {
      quiet(into, "unavailable",
        "The newest session carries no call/put premium pair, so there is no split to take.");
      return;
    }
    /* GROSS AND NON-NEGATIVE BY CONSTRUCTION. A ring of a negative share is
       not a smaller ring, it is a meaningless one, so a figure that arrives
       negative is taken as its magnitude and the note says the session. */
    const a = Math.abs(call), b = Math.abs(put), whole = a + b;
    if (!(whole > 0)) {
      quiet(into, "empty",
        "Neither side of the session carried any premium, so there is no split to take.");
      return;
    }
    const callShare = a / whole;

    const R = 54, C = 64, SW = 15, circ = 2 * Math.PI * R;
    const svg = svgEl("svg", { class: "cc-ring", viewBox: "0 0 128 128", role: "img",
      "aria-label": "Calls are " + (callShare * 100).toFixed(0) + "% of " + usd(whole) +
        " in premium and puts are " + ((1 - callShare) * 100).toFixed(0) + "%." });
    /* THE PUT ARC IS THE FULL RING AND THE CALL ARC IS DRAWN OVER IT, so the
       two always close: a rounding that left a hairline of background between
       them would read as a third category. */
    svg.append(svgEl("circle", { class: "cc-ring-put", cx: C, cy: C, r: R, "stroke-width": SW }));
    svg.append(svgEl("circle", { class: "cc-ring-call", cx: C, cy: C, r: R, "stroke-width": SW,
      "stroke-dasharray": (circ * callShare).toFixed(2) + " " + circ.toFixed(2),
      transform: "rotate(-90 " + C + " " + C + ")" }));
    /* BOTH LINES INSIDE THE HOLE, AND THE HOLE IS 93px ACROSS, not 128. The
       ring is stroked 15 units wide on r=54, so the clear circle is r=46.5 —
       and a caption on the baseline 20 below centre has only 2*sqrt(46.5² −
       20²) = 84 units of room, which "total premium" overran. Raised to 14
       below centre (88 units) and shortened to the one word that is not
       already implied by the figure above it. */
    const mid = svgEl("text", { class: "cc-ring-v", x: C, y: C - 2, "text-anchor": "middle" });
    mid.textContent = usd(whole);
    svg.append(mid);
    const cap = svgEl("text", { class: "cc-ring-c", x: C, y: C + 14, "text-anchor": "middle" });
    cap.textContent = "premium";
    svg.append(cap);
    /* NO CURSOR: EVERY NUMBER THIS RING ENCODES IS ALREADY ON SCREEN. The
       total sits in the hole and the legend below prints both shares and both
       dollar figures, so there is nothing a cursor could reveal — it holds two
       observations and would offer two stops that read back two labels the
       reader is looking at. Declared rather than remembered, so the preview
       harness's chart census can prove "every drawing reads out" instead of
       carrying this as a standing exception. */
    svg.dataset.fxRead = "face";

    const wrap = el("div", "cc-split-w");
    wrap.append(svg);
    const legend = el("div", "cc-split-l");
    for (const [cls, label, share, dollars] of [
      ["is-call", "Calls", callShare, a],
      ["is-put", "Puts", 1 - callShare, b],
    ]) {
      const row = el("div", "cc-split-r " + cls);
      row.append(el("span", "cc-split-dot"));
      row.append(el("span", "cc-split-n", label));
      row.append(el("span", "cc-split-p", (share * 100).toFixed(0) + "%"));
      row.append(el("span", "cc-split-d", usd(dollars)));
      legend.append(row);
    }
    wrap.append(legend);
    into.append(wrap);

    /* WHICH SESSION, BECAUSE IT IS NOT NECESSARILY THIS PAGE'S. The old
       sub-line printed the market key's `priced` / `oneLegged` population,
       which described a different field entirely and has no meaning for this
       one. The pulse feed dates itself and has disagreed with the run's
       session before, so the honest qualifier here is the date of the row
       actually drawn. */
    if (sub) {
      const when = typeof row.date === "string" && row.date ? row.date : null;
      sub.textContent = when
        ? "the vendor's gross call and put premium for " + when
        : "the vendor's gross call and put premium, for a session the feed did not date";
      sub.hidden = false;
    }
  }

  /* ---------- the largest flagged windows --------------------------

     The vendor's own rules, not this pipeline's. Tickers here are PLAIN
     TEXT: a detail card exists only for the names the board went deep on,
     and an opener that usually opens nothing is worse than no opener. */
  function paintAlerts(into, payload) {
    if (silent(into, payload, "flow alerts feed")) return;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      quiet(into, "empty", "The vendor's rules flagged nothing in this read.");
      return;
    }

    const drawn = rows.slice(0, LIST_MAX);
    /* WHAT THIS LIST IS SORTED BY IS THE FINDING, because the sort decides
       what the biggest number on screen means.

       AND THE ANSWER IS NOT WHAT THIS REGION SAID FOR AS LONG AS IT EXISTED.
       The heading read "Freshest flagged windows", the table's aria-label read
       "freshest first", and the first version of this lead said "These 8 are
       the FRESHEST flags rather than the largest". The rows are ordered by
       PREMIUM, descending: shared/flows-alerts.js sorts `byPremium` when it
       shapes the read and again when the intraday merge unions the reads, and
       there is no time-ordered sort anywhere in that file. So every one of
       those three sentences asserted the opposite of the payload's own
       ordering — and the lead's second clause, "the biggest premium among
       them", was necessarily row one of the table directly beneath it.

       WHAT LEADS INSTEAD is the concentration, which the table cannot show
       because it prints each premium and not the share: eight windows of
       $1M each and one of $8M beside seven of $30k are the same eight rows
       and a different session. Unsigned and formatted here rather than
       through pct(), which signs — a share of a total has no direction, and
       "+61.2% of the premium" reads as a change in it. A row with no premium
       is not a premium of zero, so it is out of both the numerator and the
       denominator, and the sentence says so when every row was. */
    const priced = drawn.map((row) => isNum(row && row.prem)).filter((one) => one !== null);
    const pool = priced.reduce((sum, one) => sum + Math.abs(one), 0);
    const top = priced.length ? Math.max(...priced.map(Math.abs)) : null;
    const share = pool > 0 && top !== null ? top / pool : null;
    lead(into, (drawn.length === 1
      ? "This is the largest flagged window by premium, not the newest"
      : "These " + drawn.length + " are the largest flagged windows by PREMIUM, not the newest") +
      (share === null
        ? " — and no row here quoted a premium, so nothing ranks them and the order is the " +
          "feed's own tie-break."
        : ", and the biggest is " + (share * 100).toFixed(1) + "% of the premium across them."));

    const wrap = tableWrap("Flagged option windows, largest premium first");
    const table = el("table", "cc-tbl");
    /* TWO COLUMNS THE PAYLOAD HAS ALWAYS CARRIED AND THIS TABLE NEVER DREW.

       WHEN. `spanStart` is the vendor's own start of the window — a window is
       a span rather than a print, so the cell states the start and the title
       carries both ends. In EASTERN time, named in the header: these are
       session windows, and a clock with no zone on a table of session windows
       is a number a reader cannot place. The viewer's own zone is deliberately
       not used here — the alerts subtitle above already carries the READ
       instant in the viewer's wall clock, and those two are different facts.

       WHICH SIDE. `askPrem` and `bidPrem` are the vendor's attribution of the
       window's premium to the ask and the bid, and the share of the two is
       the only reading either supports on its own. It is ATTRIBUTION and the
       header's title says so: a trade printing at the ask is not proof it was
       bought, and this column would be a claim about intent if it were named
       "bought" or "sold". */
    table.append(headRow([
      ["Time \u00b7 ET", null, "The start of the vendor's flagged window, in Eastern time. " +
        "A window is a span rather than a print; hover a cell for both ends."],
      ["Name", null], ["Contract", null], ["Premium", "c-num"],
      ["Side", "c-num", "The vendor's ATTRIBUTION of this window's premium to the ask or the " +
        "bid, as a share of the two. A print at the ask is not proof of a buyer, so this " +
        "column names the side of the quote and never an intent."],
      ["Rule", null],
    ]));
    const body = el("tbody");
    for (const row of drawn) {
      const tr = el("tr");

      const at = etTime(row.spanStart);
      const when = el("td", "c-num cc-dim", at === null ? DASH : at);
      if (at !== null) {
        const to = etTime(row.spanEnd);
        when.title = to === null
          ? "Window opened " + at + " ET; the vendor stated no end for it."
          : "Window ran " + at + " to " + to + " ET.";
      }
      tr.append(when);

      tr.append(el("td", "cc-t", row.t || DASH));
      tr.append(el("td", null,
        (row.cp || DASH) + " " + (isNum(row.k) === null ? DASH : row.k) +
        (row.exp ? " " + String(row.exp).slice(5) : "")));
      tr.append(el("td", "c-num", usd(row.prem)));

      /* BOTH TERMS REQUIRED, and a measured zero on one side is a reading
         rather than an absence: a window whose whole premium printed at the
         bid is bid 100%, and a window the vendor split for neither side is
         the em dash. */
      const ask = isNum(row.askPrem), bid = isNum(row.bidPrem);
      const two = ask === null || bid === null ? null : Math.abs(ask) + Math.abs(bid);
      const askShare = two === null || two === 0 ? null : Math.abs(ask) / two;
      /* NO HUE ON THIS COLUMN, AND THAT IS THE POINT OF IT. Green and red
         mean bullish and bearish everywhere else on this page, and tinting
         an ask-side share green would assert by colour the exact claim the
         header's title refuses in words: a print at the ask is not proof of
         a buyer. The words "ask" and "bid" carry the whole reading. */
      tr.append(el("td", "c-num",
        askShare === null ? DASH
          : askShare === 0.5 ? "even"
          : (askShare > 0.5 ? "ask " : "bid ") +
            ((askShare > 0.5 ? askShare : 1 - askShare) * 100).toFixed(0) + "%"));

      tr.append(el("td", "cc-dim", row.rule || DASH));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  /* ---------- what reports next ------------------------------------

     THE RECIPROCAL OF THE EARNINGS MARKER. The event row already carries
     the funnel stage the name reached and the score it was given, and this
     region printed neither — so "Reporting soon" was a calendar sitting on
     the same page as a ranking, with no thread between them. Printing the
     score here turns it into a cross-reference: the reader sees that the
     name reporting in three sessions is the one ranked second above. */
  function paintEvents(into, payload) {
    if (silent(into, payload, "events calendar")) return;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      quiet(into, "empty", "No name in the screened universe reports inside the window.");
      return;
    }

    const drawn = rows.slice(0, LIST_MAX);
    /* HOW MANY OF THESE THE BOARD HAS AN OPINION ON, which is the one thing
       this calendar cannot show by drawing: a gated name arrives with NO
       score, and the Score column prints the em dash for it — a mark a
       reader has to scan the whole column to count. A score of exactly 0 is
       a measurement and counts as scored, which is the same rule the cell
       below applies through isNum. */
    const scored = drawn.filter((row) => isNum(row && row.s) !== null).length;
    const opinionless = drawn.length - scored;
    lead(into, scored + " of the " + drawn.length + " name" +
      (drawn.length === 1 ? "" : "s") + " drawn carr" +
      (scored === 1 ? "ies" : "y") + " a score" +
      (opinionless
        ? " and " + opinionless + " reached this calendar with none, so the boards hold no " +
          "opinion on " + (opinionless === 1 ? "it" : "them") + " going into the print."
        : ", so every name here can be read against the ranking above."));

    const wrap = tableWrap("Names reporting inside the window");
    const table = el("table", "cc-tbl");
    table.append(headRow([
      ["Name", null], ["Date", null], ["In · sessions", "c-num"],
      ["Priced move", "c-num"], ["Score", "c-num"],
      ["Stage", null, "Where this name stopped in the run's funnel. \"gated\" means " +
        "the board was forbidden from holding an opinion on it, not that it had none."],
    ]));
    const body = el("tbody");
    for (const row of drawn) {
      const tr = el("tr");
      tr.append(el("td", "cc-t", row.t || DASH));
      tr.append(el("td", null, row.d || DASH));
      /* Sessions, not days: the count the earnings gate itself measured. */
      tr.append(el("td", "c-num", isNum(row.sdte) === null ? DASH : row.sdte + "s"));
      const im = isNum(row.im);
      tr.append(el("td", "c-num", im === null ? DASH : "±" + (Math.abs(im) * 100).toFixed(1) + "%"));
      /* A SCORE OF ZERO IS A MEASUREMENT AND AN ABSENT ONE IS NOT. A gated
         name reaches this calendar with no score at all, and printing 0 for
         it would claim the run looked and found neutrality. */
      tr.append(el("td", "c-num" + tone(row.s), fmtSigned(row.s)));
      tr.append(el("td", "cc-dim", row.st || DASH));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  /* ---------- nearly in --------------------------------------------

     The names inside the dead band: fully scored, published on neither
     side. Plain text for the same reason as the alerts — these are the
     names CLOSEST to neutral, so by the deep rule none of them has a card. */
  function paintWatch(into, payload) {
    if (silent(into, payload, "watch board")) return;
    const rows = ranked(payload.rows);
    if (!rows.length) {
      /* WHICH SILENCE THIS IS, AND THE TWO ROUTES USED TO DISAGREE. This
         region asserted a reading about the market ("no name sits inside the
         band") while /flows/watch/ asserted a fault in the publish, over the
         same payload — so on an empty session a reader got both sentences on
         two routes of one product. The Watch route's reading is the correct
         one: with a ±1 band, a session where NO name lands inside it is
         near-impossible, so an empty watch list is far more likely to be a
         key that did not publish than a market that had no middle. */
      quiet(into, "unavailable",
        "The watch board published no rows. With a dead band this narrow a " +
        "session where no name sits inside it would be extraordinary, so this " +
        "is more likely a key that did not publish than a market with no middle.");
      return;
    }
    const drawn = rows.slice(0, LIST_MAX);
    /* WHICH SIDE THE BAND IS HOLDING, which is what a reader wants from a
       list of names that are nearly out of it and which the rows cannot
       show: they are ordered on the SIZE of the residual, so the signs are
       scattered down a column and have to be counted by eye.

       READ THROUGH THE SAME FALLBACK THE CELL USES — residual first, score
       only where the payload predates it — so the lead and the column can
       never disagree about a row. THREE OUTCOMES, NOT TWO: a residual of
       exactly 0 is ON the rule rather than above it, and a row that
       published neither number is not placed at all. Number(null) === 0
       would have put both of those on the bullish side. */
    const sideOf = (row) => {
      const value = isNum(row && row.resid) !== null ? isNum(row.resid) : isNum(row && row.s);
      return value === null ? null : (value > 0 ? 1 : value < 0 ? -1 : 0);
    };
    const sides = drawn.map(sideOf);
    const above = sides.filter((one) => one === 1).length;
    const below = sides.filter((one) => one === -1).length;
    const onRule = sides.filter((one) => one === 0).length;
    const unplaced = sides.filter((one) => one === null).length;
    const nearest = drawn.length + " name" + (drawn.length === 1 ? "" : "s") +
      " nearest the edge";
    lead(into, above + below + onRule === 0
      ? "None of the " + nearest + " published a number to place against the zero rule, so " +
        "this list is ordered and unsided."
      : above + " of the " + nearest + " sit above the zero rule and " + below + " below it" +
        (onRule ? ", " + onRule + " exactly on it" : "") +
        (unplaced ? "; " + unplaced + " published no number to place" : "") + ".");

    const list = el("ul", "cc-moves");
    for (const row of drawn) {
      const li = el("li");
      li.append(el("span", "cc-t", row.t || DASH));
      /* THE RESIDUAL, NOT THE SCORE, BECAUSE THE SCORE HAS NO BITS HERE.
         `s` is a rounded integer on a ±100 scale and the dead band is ±1, so
         every row in this region prints 0 — seven identical zeros under a
         heading that promises "how close they are to leaving the band". The
         rows really ARE ordered, on |residual|, and that is the number the
         ordering is made of. Falls back to the score for a payload published
         before this field existed, which is the only reading available there. */
      const resid = isNum(row.resid);
      /* AND THE NUMBER SAYS WHICH OF THE TWO IT IS, IN A WORD ON THE ROW.
         This list has no column header to hang a unit on, and the two
         branches print DIFFERENT quantities into one slot: 0.0182 is a
         residual, +18 a score on a ±100 scale. The unit lived only in a
         title a mouse can reach, so it is named beside the number the way
         "conv 60" names its own. AND THE SIGN IS THE PAGE'S GLYPH: toFixed
         wrote a hyphen-minus here while every other signed number carries
         U+2212 through fmtSigned — which also leaves a measured zero
         unsigned. */
      const [unit, said, cls] = resid !== null
        ? ["resid", fmtSigned(resid, 4), tone(resid)]
        : ["score", fmtSigned(row.s), tone(row.s)];
      const cell = el("span", "c-num" + cls);
      cell.append(el("span", "cc-dim", unit + " "));
      cell.append(document.createTextNode(said));
      cell.title = resid !== null
        ? "The cross-sectional residual this name was ranked on, in the units " +
          "the score is a bounded transform of. The rows are ordered on its " +
          "size, which is how close the name is to leaving the band."
        : "The score, on the ±100 scale, because this payload was published " +
          "before the residual rode on the watch rows. On a narrow band every " +
          "row rounds to the same integer at this scale, so this column can " +
          "order them no better than the payload already has.";
      li.append(cell);
      li.append(el("span", "cc-dim",
        "conv " + (isNum(row.cnv) === null ? DASH : Math.round(row.cnv))));
      list.append(li);
    }
    into.append(list);
  }

  /* ---------- the eleven sectors, by OPTION PREMIUM -----------------

     NOT THE SECTOR PANEL ON /flows/market/. That one is `sector:trix` — TRIX on
     daily log closes, in basis points, with not one option in it; this is
     `sector:premium`, today's bullish minus bearish OPTION premium over the
     same eleven SPDR baskets. worker.js:2721 split the routes for that reason.
     The four ways a reader is kept from confusing the two are argued over the
     region shell in shared/flows-pages.js, which is Worker-side and therefore
     free of this route's JavaScript budget.

     NOTHING IS LIFTED FROM flows-market.js: its numeric helpers live in a file
     this change does not own, and a lift-and-adapt would put a second copy of
     four of them in a second file — which is how this repo came to hold six
     copies of isNum. `pct`, `usd` and `tone` above are what this panel needs. */

  /* THE ORDER IS THE PUBLISHER'S CHOICE, RESTATED RATHER THAN INVENTED.
     `lean.rank` says "leanRatio" and flows-pipeline.mjs:3722 argues why: XLK
     clears hundreds of millions of premium on an ordinary day and XLB tens
     of thousands, so ranking by DOLLAR difference ranks by BASKET SIZE. The
     ratio is the share of each basket's OWN two-sided premium that leaned
     one way, comparable three orders of magnitude apart.

     A BASKET WITH NO RATIO CANNOT BE PLACED ON THAT ORDERING AT ALL: gross
     is a measured 0, the ratio is 0/0 — undefined, not neutral — and sorting
     it as 0.0 is the confident zero wearing a comparator. It goes to the
     tail with its measured zeros still printed, AHEAD of the baskets that
     could not be read: "measured and empty" is a reading, "unreadable" is
     not. */
  const LEAN_TAIL = { quiet: 1, unreadable: 2 };
  function leanOrder(rows) {
    return rows.slice().sort((a, b) => {
      const av = isNum(a && a.leanRatio), bv = isNum(b && b.leanRatio);
      if (av !== null && bv !== null) return bv - av;
      if (av !== null) return -1;
      if (bv !== null) return 1;
      return (LEAN_TAIL[a && a.read] || 3) - (LEAN_TAIL[b && b.read] || 3);
    });
  }

  /**
   * The lean cell: a fixed ±100% axis, sign carried by POSITION.
   *
   * TWO ABSENCES, TWO MARKS, AND THEY MAY NOT LOOK ALIKE. A quiet basket was
   * READ and both premium sums came back zero, so there is no two-sided premium
   * for a lean to be a share of — a finding, not a gap — and it gets a word
   * while the dollar columns print its measured $0. An unreadable basket gets
   * the em dash this page gives every absent reading. A mark at the CENTRE
   * would be wrong for both: it says "measured, and neutral", the one thing
   * neither of them is.
   */
  function leanCell(row, read) {
    const td = el("td", "cc-ln-c");
    const r = isNum(row && row.leanRatio);
    if (r === null) {
      if (read === "quiet") {
        const flat = el("span", "cc-ln-flat", "no premium");
        flat.title = "Both premium sums were measured at zero: 0/0 is undefined, not " +
          "neutral, so this basket is not placed on the axis. Its measured $0 is beside it.";
        td.append(flat);
        return td;
      }
      const none = el("span", "cc-ln-none", DASH);
      none.title = typeof row.reason === "string" && row.reason ? row.reason
        : "This basket's lean could not be read, so nothing is drawn for it.";
      td.append(none);
      return td;
    }

    const bar = el("span", "cc-ln-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label",
      (row.sector || row.etf || "This basket") + " leaned " + pct(r, 1) +
      " of its two-sided option premium, " +
      (r < 0 ? "left of" : r > 0 ? "right of" : "exactly on") + " the zero rule.");
    bar.append(el("i", "cc-ln-mid"));
    /* THE CLAMP CANNOT BIND: leanRatio is bounded to [−1, +1] by construction,
       so it guards a malformed payload rather than making a scaling choice. */
    const frac = Math.min(Math.abs(r), 1);
    const fill = el("i", "cc-ln-fill" + tone(r));
    fill.style.width = (frac * 50) + "%";
    fill.style.left = r < 0 ? (50 - frac * 50) + "%" : "50%";
    bar.append(fill);
    td.append(bar);
    return td;
  }

  /**
   * Eleven sectors on one axis: where the option premium leaned today.
   */
  function paintLean(into, payload, seg) {
    /* THE BUTTONS BELONG TO THE STRIP, so they are cleared before any of the
       silences below can return: a toggle standing over a region that could
       not be drawn offers a reader three ways to select nothing. */
    if (seg) seg.replaceChildren();
    const sub = host("ccLeanSub");
    const saySub = (said) => { if (sub) sub.textContent = said; };
    saySub("options premium, not price momentum");
    if (silent(into, payload, "sector premium lean")) return;

    /* THE LEG'S OWN SILENCES, BEFORE ANY ROW IS DRAWN. The publisher returns
       all eleven baskets whatever happens — a panel that quietly shrinks from
       eleven bars to nine is how a vendor outage goes unnoticed for a week —
       so on a leg-level failure the array is ELEVEN rows all reading
       "unreadable", and drawing them would present one outage as eleven
       separate sector findings. */
    if (payload.status === "quiet") {
      quiet(into, "empty",
        "The sector feed was read and the vendor returned no rows at all, so not one of the " +
        "eleven baskets could be placed. That is a measurement of the feed, not of the market.");
      return;
    }
    if (payload.status === "unreadable") {
      quiet(into, "unreadable",
        "The sector feed returned rows and not one of the eleven baskets carried a readable " +
        "pair of premium sums. Nothing here is a reading about the session: the field names " +
        "on the wire and the ones this pipeline expects have parted company.");
      return;
    }

    const sectors = Array.isArray(payload.sectors) ? payload.sectors : [];
    if (!sectors.length) {
      quiet(into, "unavailable",
        "This payload carried no sector rows, so the page cannot say where any basket " +
        "leaned. A gap in the payload rather than a fact about the market.");
      return;
    }

    /* COUNTED FROM THE ROWS, AND THIS IS THE ONE LIST ON THIS PAGE WHERE THAT
       IS THE POPULATION RATHER THAN A CEILING. Every other region states a
       published denominator because its rows were capped on the wire; this
       payload publishes every basket every run and this panel draws all of
       them, so the rows in hand ARE the eleven. */
    const ordered = leanOrder(sectors);
    const leaned = ordered.filter((s) => isNum(s && s.leanRatio) !== null).length;
    const quietN = ordered.filter((s) => s && s.read === "quiet").length;
    const badN = ordered.length - leaned - quietN;
    saySub(leaned + " of " + ordered.length + " leaned");

    const lean = payload.lean && typeof payload.lean === "object" ? payload.lean : null;

    /* NINE SENTENCES WERE BEHIND THE DISCLOSURE AND ONLY TWO WERE METHOD.
       An adversarial pass over what this panel folds found seven of the nine
       failing the meaning test outright — four of them WITHHOLDINGS, which
       is the one direction the fold rule forbids in as many words: fold the
       reassurance, never the withholding. Sorted here rather than argued at
       each push, and the two lists are what the panel prints:

         QUALIFIERS, open, under the table. The quantity and its horizon
         ("today only"); what the table is ORDERED on, which otherwise
         appears only in tableWrap's aria-label and so was invisible to a
         sighted reader; that a ratio carries no size, which is a
         NOT-COMPARABLE about the ranking itself; the quiet baskets and why
         0/0 is not a neutral lean; the baskets that could not be read; the
         basis; and which of the site's TWO sector panels this is.

         METHOD, folded past the wall. The publisher's own relation, and how
         the sign is drawn. */
    const caveats = [];
    const method = [];

    caveats.push("Bullish minus bearish OPTION premium on the eleven SPDR sector baskets, " +
      "today only.");
    /* THE PUBLISHER'S OWN ARGUMENT FOR THE RANKING, CARRIED RATHER THAN
       PARAPHRASED: a paraphrase is a second copy of a claim that lives on the
       payload, and the two drift the first time the publisher revises it. */
    if (lean && typeof lean.relation === "string" && lean.relation) {
      method.push("Derived: " + lean.relation + ".");
    }
    caveats.push("Ordered on the RATIO — the share of each basket's own two-sided premium " +
      "that leaned one way — because that is what the publisher ranks on" +
      (lean && typeof lean.rejected === "string" && lean.rejected
        ? ", having rejected " + lean.rejected : "") +
      " — the table below keeps that rank in every mode; the strip above it is ordered " +
      "on whichever quantity its toggle is showing.");
    caveats.push("The dollars ride beside it because a ratio carries no size: +90% on $30k of " +
      "premium and +90% on $300M are not the same fact.");
    method.push("Sign is carried by POSITION — left of the centre rule is bearish premium — " +
      "and by the glyph on every number, so the panel survives greyscale.");
    if (quietN) {
      caveats.push(quietN + (quietN === 1 ? " basket was" : " baskets were") +
        " read with both premium sums at zero: measured and empty, printed as the $0 they " +
        "are rather than dropped, and left off the axis because 0/0 is undefined and not a " +
        "neutral lean.");
    }
    if (badN) {
      caveats.push(badN + (badN === 1 ? " basket" : " baskets") + " could not be read at all " +
        "and print the em dash instead; the publisher's reason is on the row.");
    }
    if (typeof payload.basis === "string" && payload.basis) {
      caveats.push("Basis: " + payload.basis + ".");
    }
    if (typeof payload.notSameAs === "string" && payload.notSameAs) {
      caveats.push("This is not " + payload.notSameAs + " — that is the key the sector panel " +
        "on /flows/market/ draws, in basis points per session.");
    }

    /* ---- THREE QUANTITIES, ONE STRIP, AND THE TABLE UNDER IT UNCHANGED ----

       A BASKET CAN BE RANKED THREE WAYS AND NONE OF THEM IS THE REAL ONE.
       The dollars it cleared, the contracts it traded, and the share of its
       own premium that leaned are three different questions, and a page that
       picks one for the reader has answered the other two by hiding them.
       So the strip takes a toggle and the buttons name the quantity.

       THE SILENCES ARE PER MODE, AND THAT IS THE PROPERTY WORTH HAVING.
       `read` on a row is about the PREMIUM pair — bullish and bearish — and
       the volumes are read independently of it, so a basket can carry a
       readable call and put volume while its premium is unreadable, and the
       other way round. Each mode therefore counts its OWN reporting baskets
       and names its own missing ones; switching modes honestly changes which
       sectors report, and a shared count would have been a lie in two of the
       three.

       THE TABLE DOES NOT MOVE. It is the record, it is ordered on the
       publisher's own rank, and it prints all three quantities at once —
       which is what a reader asking about one basket needs. The toggle is
       the glance, not the record. */

    /* CONTRACTS AT THE SCALE THEY LIVE ON, SIGNED, and abbreviated the same
       way usd() abbreviates: sector volumes run to the low millions, and
       "1961758" in a chip is a number nobody reads. */
    const cts = (v) => {
      const n = isNum(v);
      if (n === null) return DASH;
      const sign = n < 0 ? MINUS : n > 0 ? "+" : "";
      const a = Math.abs(n);
      if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + "M";
      if (a >= 1e3) return sign + (a / 1e3).toFixed(0) + "K";
      return sign + String(Math.round(a));
    };
    /* ARITHMETIC ON TWO PUBLISHED COUNTS IN ONE UNIT, not a derived signal:
       both terms are required, because a net needs both sides and a missing
       put volume is not zero puts. */
    const netCts = (r) => {
      const c = isNum(r && r.callVolume), p = isNum(r && r.putVolume);
      return c === null || p === null ? null : c - p;
    };
    const basket = (r) => r.sector || r.fullName || r.etf || DASH;

    const MODES = [
      { label: "$ Premium", noun: "net option premium",
        val: (r) => isNum(r && r.netPremiumUsd), fmt: usd, axis: null,
        said: (n, d) => n + " of " + d + " cleared readable premium",
        one: (b, v) => b + " is the only basket with a readable premium sum, at " +
          usd(v) + " net.",
        two: (bh, vh, bl, vl) => bh + " cleared the most bullish net premium at " + usd(vh) +
          "; " + bl + " the most bearish at " + usd(vl) + ".",
        none: "No basket carried a readable premium sum this session, so none is named.",
        why: "Showing NET PREMIUM in dollars — bullish minus bearish — so basket size is in " +
          "the bar. The bars are scaled to the largest figure on this strip rather than to a " +
          "fixed axis, so heights compare baskets within this session and not one session " +
          "with another." },
      { label: "# Contracts", noun: "net contracts",
        val: netCts, fmt: cts, axis: null,
        said: (n, d) => n + " of " + d + " reported both volumes",
        one: (b, v) => b + " is the only basket that reported both volumes, at " + cts(v) +
          " contracts net.",
        two: (bh, vh, bl, vl) => bh + " traded the most calls over puts at " + cts(vh) +
          " contracts; " + bl + " the most puts over calls at " + cts(vl) + ".",
        none: "No basket reported both a call and a put volume this session, so none is named.",
        why: "Showing NET CONTRACTS — call volume minus put volume, arithmetic on two counts " +
          "the publisher carries per basket, in one unit. A count says nothing about what the " +
          "contracts cost: a million five-cent contracts and a thousand fifty-dollar ones are " +
          "the same figure here. Volumes are read independently of the premium sums, so this " +
          "mode can report a basket the other two cannot, and the other way round." },
      { label: "Flow Ratio", noun: "share of its own premium",
        val: (r) => isNum(r && r.leanRatio), fmt: (v) => pct(v, 1), axis: 1,
        said: (n, d) => n + " of " + d + " leaned",
        one: (b, v) => b + " is the only basket with a readable lean, at " + pct(v, 1) +
          " of its own premium.",
        two: (bh, vh, bl, vl) => bh + " leans most bullish at " + pct(vh, 1) +
          " of its own premium; " + bl + " most bearish at " + pct(vl, 1) + ".",
        none: "No basket carried a readable lean this session, so none is named.",
        why: "Showing the FLOW RATIO — the share of each basket's own two-sided premium that " +
          "leaned one way — on a fixed ±1 axis, which is the one mode whose bar heights " +
          "mean the same thing on every session. It carries no size: +90% on $30K of premium " +
          "and +90% on $300M are not the same fact, and the dollars are in the table below." },
    ];
    /* THE DEFAULT IS THE RATIO, AND THE MOCKUP LEADS WITH THE DOLLARS. The
       ratio is what the publisher ranks on and what the table under the strip
       is ordered by, so opening on it is the one choice where the glance and
       the record agree before a reader touches anything. */
    let mode = 2;

    const glance = el("div", "cc-lean-glance");
    into.append(glance);

    const drawGlance = () => {
      const M = MODES[mode];
      glance.replaceChildren();
      if (seg) {
        seg.replaceChildren();
        MODES.forEach((m, i) => {
          const b = el("button", "cc-seg-b", m.label);
          b.type = "button";
          if (i === mode) b.setAttribute("aria-current", "true");
          b.addEventListener("click", () => { mode = i; drawGlance(); });
          seg.append(b);
        });
      }

      /* READ THROUGH THE MODE ONCE, so the count, the lead, the ordering and
         every chip are the same set of numbers by construction. */
      const vals = new Map();
      for (const r of ordered) vals.set(r, M.val(r));
      const reporting = ordered.filter((r) => vals.get(r) !== null);
      saySub(M.said(reporting.length, ordered.length));

      /* ORDERED ON THE QUANTITY BEING DRAWN, nulls at the tail rather than
         seated at zero — an absent reading is not a middling one. In ratio
         mode this reproduces the publisher's own rank, which is what the
         table draws, so the default strip and the record cannot disagree. */
      const strung = reporting.slice().sort((a, b) => vals.get(b) - vals.get(a));
      const rank = strung.concat(ordered.filter((r) => vals.get(r) === null));

      if (reporting.length) {
        const hi = strung[0], lo = strung[strung.length - 1];
        lead(glance, reporting.length === 1
          ? M.one(basket(hi), vals.get(hi))
          : M.two(basket(hi), vals.get(hi), basket(lo), vals.get(lo)));
      } else {
        glance.append(el("p", "cc-quiet", M.none));
      }

      /* THE AXIS IS THE MODE'S. A ratio is bounded to ±1 by construction
         and gets that fixed axis; a dollar sum and a contract count are not
         bounded by anything, so their bars are scaled to the largest MAGNITUDE
         on the strip — and the mode's own sentence says so, because a bar whose
         scale changes between sessions is a bar a reader must be told about. */
      const peak = M.axis !== null ? M.axis
        : reporting.reduce((m, r) => Math.max(m, Math.abs(vals.get(r))), 0);

      const strip = el("div", "cc-chips");
      strip.setAttribute("role", "list");
      for (const r of rank) {
        const v = vals.get(r);
        const chip = el("div", "cc-chip" +
          (v === null ? " is-null" : v > 0 ? " is-pos" : v < 0 ? " is-neg" : ""));
        chip.setAttribute("role", "listitem");
        chip.append(el("span", "cc-chip-n", basket(r)));
        chip.append(el("span", "cc-chip-v", v === null ? DASH : M.fmt(v)));

        /* A basket with no readable figure in THIS mode gets no bar: a
           zero-width mark at the centre is what a measured zero draws, and an
           absence is not a measured zero. A peak of 0 — every reporting basket
           measured exactly even — leaves every bar at the rule, which is the
           reading. */
        if (v !== null) {
          const bar = el("span", "cc-chip-bar");
          const fill = el("i");
          const half = peak > 0 ? Math.min(50, Math.abs(v) / peak * 50) : 0;
          fill.style.width = Math.max(1.5, half) + "%";
          fill.style.left = (v < 0 ? 50 - half : 50) + "%";
          bar.append(fill);
          chip.append(bar);
        }

        /* THE OTHER TWO QUANTITIES RIDE IN THE TITLE, so a reader hovering a
           chip in one mode is not cut off from the other two — and the row's
           own published reason is what an unreadable chip says, never a
           sentence this file invented about it. */
        const net = isNum(r && r.netPremiumUsd), ratio = isNum(r && r.leanRatio);
        const nc = netCts(r);
        chip.title = v === null
          ? (typeof r.reason === "string" && r.reason ? r.reason
            : "This basket carried no readable " + M.noun + ", so it is not placed.")
          : (r.etf ? r.etf + ": " : "") + M.fmt(v) + " " + M.noun + " · " +
            "net " + usd(net) + " · " + cts(nc) + " contracts" +
            " · " + pct(ratio, 1) + " of its own premium.";
        strip.append(chip);
      }
      glance.append(strip);

      /* WHAT THIS MODE IS MADE OF, IN THE OPEN, UNDER ITS OWN STRIP. It
         changes what a drawn bar means — the axis, the unit, and which
         baskets could report at all — so it cannot live in the region's
         static prose, which is written once and would then describe whichever
         mode happened to be selected when it was written. */
      glance.append(el("p", "cc-ln-note is-mode", M.why));
    };
    drawGlance();

    /* THE TABLE STAYS OPEN UNDER THE STRIP, and the first draft folded it.

       The argument for folding was that the strip already carries every
       basket, its lean and its rank, so what the fold hid was only the exact
       dollars — method rather than meaning. That argument is wrong here, and
       this region's own qualifier is what makes it wrong: "the dollars ride
       beside it because a ratio carries no size: +90% on $30k of premium and
       +90% on $300M are not the same fact." A page cannot make that claim and
       then put the dollars behind a click. The claim is the reason the column
       exists.

       So the two layers stack: the strip is the glance — where did the money
       go — and the table is the record, which is what a reader asking about
       one basket needs. That is a real cost in height and it is the honest
       one. */
    const wrap = tableWrap("Sector option-premium lean, most bullish first");
    const table = el("table", "cc-tbl");
    /* UNITS TRAVEL WITH NUMBERS, AND A RATIO AND A DOLLAR SUM NEVER SHARE A
       NAME — so the unit is in the header rather than in a title only a mouse
       can reach. The three quantities' exact derivation rides in the note
       above, out of the payload's own `lean.relation`, which is a more precise
       statement than a hand-written tooltip and cannot drift from it. */
    table.append(headRow([
      ["Sector", null], ["Lean", "cc-ln-c"], ["Lean · % of premium", "c-num"],
      ["Net · $", "c-num"], ["Gross · $", "c-num"],
    ]));

    const body = el("tbody");
    for (const row of ordered) {
      const tr = el("tr");
      /* THE READ STATE ON THE ROW, so the three cases are told apart without
         parsing prose — the same reason `kind` lands on data-empty above. */
      const read = typeof row.read === "string" ? row.read : "unreadable";
      tr.dataset.read = read;

      /* THE FUND AND THE LABEL IN ONE CELL, AND THE LABEL LEADS. The vendor
         names XLC "Communication Services" and SECTOR_ETFS does too, so the
         publisher carries both — our label beside theirs — plus the vendor's
         own `fullName` for the fund.

         THE TICKER LED HERE UNTIL NOW, on the grounds that it is the thing a
         reader can look up. That is true and it is not the first thing a
         reader needs: eleven four-letter codes make a column nobody can scan
         without translating every row, and the translation is already in the
         payload. The name leads; the ticker stays in the same cell one step
         quieter, so nothing that could be looked up before is lost. */
      const name = el("td", "cc-ln-name");
      name.append(el("span", "cc-t", row.sector || row.fullName || DASH));
      /* UNCONDITIONAL, and that is not laziness. flows-overview-contract reads
         `.cc-etf`'s textContent on every row to assert the ranking order, so a
         row that omitted the span — however sensible the condition — would
         throw rather than fail, and a TypeError is a worse failure than a
         wrong order because it says nothing about what is wrong. */
      name.append(el("small", "cc-etf", row.etf || DASH));
      if (read !== "ok") {
        const tag = el("span", "cc-dim cc-ln-tag", read);
        tag.title = typeof row.reason === "string" && row.reason ? row.reason
          : (read === "quiet"
            ? "Read, and both premium sums were zero: measured and empty."
            : "This basket's premium could not be read from the response.");
        name.append(tag);
      }
      tr.append(name);

      tr.append(leanCell(row, read));

      /* EVERY CELL FORMATS THE VALUE THE READER HANDED BACK, never the raw
         field: pct() and usd() ask isNum first and print the em dash for null,
         so a quiet basket's measured 0 prints "$0" — visible, because it was
         measured — while an unreadable one prints the dash. */
      tr.append(el("td", "c-num" + tone(row.leanRatio), pct(row.leanRatio, 1)));
      tr.append(el("td", "c-num" + tone(row.netPremiumUsd), usd(row.netPremiumUsd)));
      tr.append(el("td", "c-num", usd(row.grossPremiumUsd)));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);

    /* THE CAVEATS IN THE OPEN, THE DERIVATION BELOW THEM, AND EVERY WORD
       KEPT EITHER WAY: moved, not trimmed. `.ft-how` and `.ft-how-s` are
       already in flows.css and are not route-scoped, so this reuses the
       disclosure vocabulary rather than inventing one, and adds no CSS.
       <summary> is natively focusable, so the method is reachable by
       keyboard and touch.

       NAMED, NOT CITED BY LINE. Two line numbers stood here and both had
       drifted — onto `.ft-link` and onto `.ft-tab::after` — so the comment
       pointed confidently at the wrong rules. tests/contracts.mjs argues the
       convention in full and fails a citation that outlives its file. */
    /* ONE QUALIFIER A LINE, NOT SEVEN JOINED INTO A PARAGRAPH.

       Every sentence here has to stay — each one is a population, a unit, an
       ordering or a NOT-CLAIMED, and this section may not fold any of those.
       What it may do is stop running them together: joined with a space they
       rendered as an eleven-line block of prose under a chart, which is the
       shape a reader skips, and skipping it is how a qualifier fails to
       qualify. As a list each claim is found in one glance and read on its
       own — the same words, the same count, none of them folded.

       This is a DIFFERENT operation from the fold above, and the difference
       is the rule: the fold hides method and this only re-sets qualifiers. */
    if (caveats.length) {
      const box = el("ul", "fc-note is-qualifier cc-ln-note");
      for (const c of caveats) box.append(el("li", null, c));
      into.append(box);
    }
    appendMethod(into, method, "How this lean was derived");
  }

  /* ---------- the headline tape, with its age on it -----------------

     FRESHNESS IS THE HONEST PROBLEM AND THIS REGION CANNOT FIX IT, SO IT STATES
     IT — argued in full over the region shell in shared/flows-pages.js, which is
     Worker-side and costs this route no bytes. What matters while editing the
     code below:

       - THE AGE LEADS. The note is appended BEFORE the list, because a reader
         who reaches a headline without having read the age reads it as news.
       - TWO POPULATION FACTS, TWO SENTENCES. `atVendorLimit` means the VENDOR'S
         ceiling was hit and the true population is unknown and at least that
         large; `capped`/`shed` means OUR cap dropped rows we did see and their
         number is known exactly. One word for both destroys that difference.
       - flows-pipeline.mjs:3878 publishes the two stamps this needs: the
         vendor's `created_at` per row, and `readAt` for when WE looked. */

  /* AN AGE, NOT A TIMESTAMP — and the clock beside it, because they answer
     two questions. The clock says WHEN, the age says HOW LONG AGO, and only
     the second is a number a reader can act on without doing zone arithmetic. */
  function agoSaid(fromMs, now) {
    const d = now - fromMs;
    /* A STAMP AHEAD OF THIS CLOCK IS NOT AN AGE. The vendor's stamp and the
       reader's clock are set by different parties, so this is reachable
       without anything being wrong — and "−3 min ago" is not a sentence.
       Null, and the caller words it. */
    if (d < 0) return null;
    const mins = Math.floor(d / 60000);
    if (mins < 1) return "under a minute ago";
    if (mins < 60) return mins + " min ago";
    const hours = Math.floor(mins / 60);
    /* "7h 0m ago" is arithmetic showing through. A whole hour is a whole
       hour, and the minutes appear only when there are some. */
    if (hours < 24) return hours + "h" + (mins % 60 ? " " + (mins % 60) + "m" : "") + " ago";
    const days = Math.floor(hours / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  /* THE INSTANT, WITH A ZONE ON IT AND NO SECONDS, in one place. A bare
     toLocaleTimeString follows the viewer's 12/24-hour locale, prints a seconds
     field neither feed can support, and names no zone. The flagged-windows
     subtitle had exactly this inline; a second copy for the headline tape is
     how two lines about two read times start disagreeing about the form. */
  const clockSaid = (ms) => new Date(ms).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short",
  });

  const NEWS_TICKERS = 4;   // tickers listed per headline before the row says how many more

  function paintNews(into, payload, cards, now) {
    const sub = host("ccNewsSub");
    if (sub) sub.textContent = "";
    if (silent(into, payload, "headlines feed")) return;

    if (payload.status === "quiet") {
      quiet(into, "empty",
        "The headlines feed was read and the vendor returned no rows: a measurement — the " +
        "tape was checked and was empty — and not a request that failed.");
      return;
    }
    if (payload.status === "unreadable") {
      quiet(into, "unreadable",
        "The headlines feed returned rows and not one carried a headline, so nothing here " +
        "is publishable. A fault on the wire between the vendor and this pipeline, not a " +
        "quiet news day.");
      return;
    }

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      quiet(into, "unavailable",
        "This payload carried no headline rows: the key published, and the list this region " +
        "is made of is not on it.");
      return;
    }

    const stamp = typeof payload.readAt === "string" ? Date.parse(payload.readAt) : NaN;
    const readMs = Number.isFinite(stamp) ? stamp : null;
    const readAge = readMs === null ? null : agoSaid(readMs, now);

    const said = [];
    if (readMs === null) {
      /* THE ONE BRANCH THAT MUST NOT GUESS: with no read stamp the age of every
         row below is unknown, and rows printed under nothing read as news. */
      said.push("This payload states no read time, so how long ago these headlines were " +
        "fetched cannot be said. Treat every row below as being of unknown age rather " +
        "than as something that just happened.");
    } else {
      said.push("Fetched at " + clockSaid(readMs) +
        (readAge === null
          ? ", which is ahead of this browser's clock, so no age can be stated"
          : ", " + readAge) + ".");
    }
    if (typeof payload.cadence === "string" && payload.cadence) {
      said.push("This feed is fetched " + payload.cadence +
        (typeof payload.staleBy === "string" && payload.staleBy
          ? " and is stale by " + payload.staleBy : "") +
        ", so it is a morning read and never a live tape.");
    }

    const kept = isNum(payload.kept);
    const oldestAt = typeof payload.oldest === "string" ? Date.parse(payload.oldest) : NaN;
    if (Number.isFinite(oldestAt)) {
      const oldAge = agoSaid(oldestAt, now);
      /* THE BOUND ON THE ROWS THE READER CANNOT SEE: eight of sixty are drawn
         and the publisher's window is the only way to say how old the rest are. */
      if (oldAge) {
        said.push("The oldest of the " + (kept === null ? "stored" : kept + " stored") +
          " rows is " + oldAge.replace(/ ago$/, " old") + ".");
      }
    }

    const requested = isNum(payload.requested), returned = isNum(payload.returned);
    const cap = isNum(payload.cap), shed = isNum(payload.shed);
    if (payload.atVendorLimit === true) {
      said.push("The vendor returned " +
        (returned === null ? "its own maximum number of rows" : returned + " rows") +
        (requested === null ? "" : " against the " + requested + " asked for") +
        ", which is its documented ceiling — so the true population is UNKNOWN and at " +
        "least that large.");
    }
    if (payload.capped === true && shed !== null && shed > 0) {
      said.push("Our own " + (cap === null ? "row cap" : cap + "-row cap") + " then shed " +
        shed + " row" + (shed === 1 ? "" : "s") + ", newest kept. That is a different fact " +
        "from the ceiling: these rows arrived and were dropped here, so their number is known.");
    }
    const unusable = isNum(payload.unusable);
    if (unusable !== null && unusable > 0) {
      said.push(unusable + (unusable === 1 ? " row" : " rows") +
        " arrived with no headline at all and went unpublished: counted, not rendered blank.");
    }
    const undatedKept = isNum(payload.undatedKept);
    const undatedSeen = isNum(payload.undatedSeen);
    if (undatedKept !== null && undatedKept > 0) {
      said.push(undatedKept +
        (undatedKept === 1 ? " stored row carries" : " of the stored rows carry") +
        " no timestamp and cannot be aged; " +
        (undatedKept === 1 ? "it sorts" : "they sort") + " last rather than being dated to now.");
    } else if (undatedSeen !== null && undatedSeen > 0) {
      said.push(undatedSeen + " undated " + (undatedSeen === 1 ? "row" : "rows") +
        " arrived on the wire and the cap shed " + (undatedSeen === 1 ? "it" : "them") +
        " before this list, so every row below can be aged.");
    }
    /* A FLAG THE VENDOR DID NOT SEND IS NOT FALSE, so a row carrying no
       `is_major` gets no mark — and their count is stated here rather than
       drawn as an absence on each row, which would read as "not major". */
    const unflagged = rows.filter((r) => r && (r.major === null || r.major === undefined)).length;
    if (unflagged) {
      said.push(unflagged +
        (unflagged === 1 ? " stored row carried" : " of the stored rows carried") +
        " no major/minor flag at all, which is not the same as having been flagged not-major.");
    }
    const cadence = typeof payload.cadence === "string" && /morning/i.test(payload.cadence)
      ? "Morning snapshot" : "Snapshot; cadence not specified";
    const coverage = [readAge ? "Fetched " + readAge : "Fetch age unknown", cadence];
    if (payload.atVendorLimit === true) coverage.push("Vendor ceiling reached; total unknown");
    if (payload.capped === true && shed > 0) coverage.push(shed + " received rows omitted");
    if (undatedKept > 0) coverage.push(undatedKept + " undated rows");
    into.append(el("p", "cc-quiet cc-news-status", coverage.join(" · ")));
    const newsDetail = el("details", "ft-how");
    newsDetail.append(el("summary", "ft-how-s", "News freshness and coverage"));
    newsDetail.append(el("p", "cc-quiet cc-nw-note", said.join(" ")));
    into.append(newsDetail);

    const list = el("ul", "cc-nw");
    for (const row of rows.slice(0, LIST_MAX)) {
      const li = el("li", "cc-nw-row");

      /* A HEADLINE IS FREE TEXT FROM AN EXTERNAL SOURCE AND IT REACHES THIS
         DOM AS TEXT. el() sets textContent (flows-ui.js:73-79), which is how
         everything vendor-authored enters a page here: there is no innerHTML on
         vendor data anywhere in Flows, and a headline is not going to be the
         string that introduces it. */
      li.append(el("p", "cc-nw-h",
        typeof row.headline === "string" && row.headline ? row.headline : DASH));

      const meta = el("p", "cc-nw-m");

      /* THE AGE, PER ROW, FROM THE VENDOR'S OWN STAMP. An undated row says so
         and is not dated to now — the confident zero in the time dimension,
         which is the dimension where it is invisible. */
      const at = isNum(row && row.createdAtMs);
      const age = at === null ? null : agoSaid(at, now);
      const ageNode = el("span", "cc-nw-age",
        at === null ? "undated" : (age === null ? "stamped ahead of this clock" : age));
      ageNode.title = at === null
        ? "This row carried no timestamp, so its age is not known and none is claimed."
        : "The vendor's own stamp, verbatim: " +
          (typeof row.createdAt === "string" ? row.createdAt : String(at));
      meta.append(ageNode);

      if (typeof row.source === "string" && row.source) {
        meta.append(el("span", "cc-nw-src", row.source));
      }

      /* THE VENDOR'S OWN WORD, CARRIED, AND DELIBERATELY NOT TINTED. This page
         spends green and red on ONE quantity — the direction of our own score
         and premium readings — and a vendor's sentiment label is not it.
         Tinting "negative" the same red as a −62 score invites a reader to add
         the two together, a claim neither payload makes. The word carries it. */
      if (typeof row.sentiment === "string" && row.sentiment) {
        const sent = el("span", "cc-nw-sent", row.sentiment);
        sent.title = "The vendor's own sentiment label, verbatim and never mapped onto a " +
          "number. It is not this product's score and does not enter it.";
        meta.append(sent);
      }

      if (row && row.major === true) {
        const mark = el("span", "cc-nw-major", "major");
        mark.title = "The vendor flagged this headline as major.";
        meta.append(mark);
      }

      const tickers = Array.isArray(row && row.tickers) ? row.tickers : [];
      const named = [];
      for (const raw of tickers) {
        const t = typeof raw === "string" ? raw.trim().toUpperCase() : "";
        if (t) named.push(t);
      }
      if (named.length) {
        const box = el("span", "cc-nw-tks");
        for (const t of named.slice(0, NEWS_TICKERS)) {
          /* A LINK ONLY WHERE THERE IS SOMETHING BEHIND IT. `cards` is the
             set of names this session built a detail card for, so a link
             minted for anything else lands on a reader that has to apologise.
             The rest print plain: the MENTION is still information — the join
             between a headline and a name this product ranks — a link to an
             empty page is not. */
          if (cards.has(t)) { box.append(nameNode(t, true)); continue; }
          const flat = el("span", "cc-nw-tk", t);
          flat.title = "Named by the vendor on this headline. This session built no card for " +
            "it, so there is nothing here to open.";
          box.append(flat);
        }
        /* A LIST THAT TRUNCATES WITHOUT SAYING SO READS AS A POPULATION, and
           a headline naming twelve tickers is where that bites: four shown
           would read as "this is about four names". */
        if (named.length > NEWS_TICKERS) {
          box.append(el("span", "cc-nw-more", "+" + (named.length - NEWS_TICKERS) + " more"));
        }
        meta.append(box);
      }

      li.append(meta);
      list.append(li);
    }
    into.append(list);

    if (sub) {
      /* THE PUBLISHED POPULATION, NOT THE ROWS IN HAND, so this subtitle says
         the same thing as the paragraph above it. And the read AGE rides here
         because the heading is where a reader looks first when the question is
         "is this current". */
      const shown = Math.min(rows.length, LIST_MAX);
      sub.textContent = capSaid(shown, kept === null ? rows.length : kept) +
        (readAge === null ? "" : " · fetched " + readAge);
    }
  }

  /* ---------- the spine --------------------------------------------

     A fixed −100..+100 axis with the dead band hatched onto it. FIXED, not
     data-scaled — the score has a real unit and a stated dead band, so an
     axis that rescaled to the day's extremes would make a quiet session
     look like a violent one. It keeps its place at the foot of the page
     because it is the only view of the WHOLE distribution, and the regions
     above it are an index, not a replacement.

     IT NOW DRAWS THE CHANGE AS WELL AS THE LEVEL. A mark trails a line back
     to the score the name held at its previous scored session, so the
     distribution of MOVEMENT is visible on the same axis as the
     distribution of level — where each name is, and where it came from,
     without a second unit and without giving up the fixed scale that makes
     two sessions comparable at a glance. A trail spanning more than one
     session is dashed, because a move across six sessions drawn identically
     to an overnight one is the same lie the delta arithmetic used to tell.

     NOT EVERY MARK GETS ONE, and that is the point rather than a gap. The
     level comes off the BOARD and the move off the SCORE TRACK; where those
     two payloads do not agree that this is the same observation — the
     track's newest column is an older session, or its newest score for the
     name is not the one the board is publishing — the origin of a trail
     would be a number neither payload contains. Those marks stand alone and
     say when the track last saw them. A mark with no trail means "this
     level is today's and its move is not", which is a reading; a trail
     drawn anyway would have been a fabrication.

     THE CHART INVARIANT, WHICH THIS FUNCTION USED TO BREAK. One viewBox unit
     is one CSS pixel (assets/js/flows-ui.js:20-27). The old code clamped W
     to 900 and emitted width:"100%", so on the 132rem canvas tier a
     900-unit viewBox was stretched to ~2.2 CSS px per unit — dots at radius
     ~10 instead of 4.5, 9px tick labels near 20px. The width is now the
     measured host width, emitted as an attribute, the shape scoreStrip has
     always used. */

  let spineDrawn = null;   // the last payload drawn, kept for the resize repaint
  let spineW = 0;          // and the width it was drawn at

  /* MEASURED FROM A VISIBLE HOST, AND NEVER FLOORED ABOVE IT. A hidden
     element reports clientWidth 0, the only reason a fallback exists; the
     ceiling is a sanity bound above the widest canvas tier, never binding.
     THE OLD FLOOR OF 300 CANNOT COME BACK: with an explicit width attribute
     a floor wider than the host is horizontal overflow on the document, and
     zero overflow at 320px is a tested invariant of this site. */
  function spineWidth() {
    const measured = Math.round(spineHost.clientWidth);
    return measured > 0 ? Math.min(2400, measured) : 720;
  }

  function renderSpine(payload) {
    spineDrawn = payload;
    spineHost.replaceChildren();
    /* NO BAND PUBLISHED MEANS NO HATCH, NOT A ±20 ONE.
       The `?? 20` here painted 174px of hatch on an 872px axis whenever the
       board was unreadable or predated the field — a confident visual claim
       that a ±20 bar had been applied when none was published at all, in the
       one channel this chart exists to communicate. The real band is 1, whose
       hatch is ~9px, so the fabricated state was not even comparable to the
       true one: it was the most emphatic mark on the chart standing in for a
       missing number. */
    const band = isNum(payload.deadBand);
    const scored = isNum(payload.scored);
    const neutral = isNum(payload.neutral);
    const moves = payload.__moves instanceof Map ? payload.__moves : new Map();

    const W = spineWidth();
    spineW = W;
    const H = 92;
    const padX = 14, axisY = 56;
    const plotW = W - padX * 2;
    const xOf = (s) => padX + ((s + 100) / 200) * plotW;

    const svg = svgEl("svg", {
      class: "sp", viewBox: `0 0 ${W} ${H}`, width: W, height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    /* The band is HATCHED, not tinted: it must read as excluded territory in
       a greyscale render, and a flat fill would look like just another band
       of the axis. */
    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: "spBand", width: 6, height: 6, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "sp-bandpat",
    });
    pat.append(svgEl("line", { x1: 3, y1: 0, x2: 3, y2: 6, stroke: "currentColor", "stroke-width": 1.4 }));
    defs.append(pat);
    svg.append(defs);

    svg.append(svgEl("line", { class: "sp-axis", x1: padX, x2: W - padX, y1: axisY, y2: axisY }));
    /* Drawn only when a band was actually published. An axis with no hatch is
       an axis that says nothing about exclusion, which is the truth when the
       field is missing; a hatch drawn from a default says something false. */
    if (band !== null) {
      svg.append(svgEl("rect", {
        class: "sp-band", x: xOf(-band), y: axisY - 13, width: xOf(band) - xOf(-band), height: 26,
        fill: "url(#spBand)",
      }));
    }

    for (const s of [-100, -50, 0, 50, 100]) {
      svg.append(svgEl("line", { class: "sp-tick", x1: xOf(s), x2: xOf(s), y1: axisY + 10, y2: axisY + 15 }));
      const t = svgEl("text", { class: "sp-ticklabel", x: xOf(s), y: axisY + 27, "text-anchor": "middle" });
      t.textContent = s === 0 ? "0" : fmtSigned(s, 0);
      svg.append(t);
    }

    const bandLabel = svgEl("text", {
      class: "sp-bandlabel", x: xOf(0), y: axisY - 19, "text-anchor": "middle",
    });
    bandLabel.textContent = band === null
      /* Says what is missing rather than naming a width nobody published. */
      ? "no dead band published for this session · the axis is drawn without one"
      : scored !== null && neutral !== null
        ? neutral + " of " + scored + " inside ±" + band + " · not named"
        : "±" + band + " dead band · not named";
    svg.append(bandLabel);

    /* One mark per PUBLISHED name, at its true score, trailing the move that
       put it there. The regions above show ten a side; this shows every one
       that cleared the band, so the reader can see how far the tail actually
       reaches and how much of it arrived this morning. */
    let trails = 0;
    const marks = [];
    for (const [rows, cls] of [[payload.__bull, "is-bull"], [payload.__bear, "is-bear"]]) {
      for (const r of rows || []) {
        const s = isNum(r.s);
        if (s === null) continue;
        const t = String(r.t || "");
        const mv = moves.get(t) || null;
        /* TWO PAYLOADS, AND THE TRAIL IS DRAWABLE ONLY WHERE THEY AGREE.
           The dot sits at the BOARD's score; the move comes off the SCORE
           TRACK, whose newest column is not always this session and whose
           newest score for a name is not always the one the board prints.
           Where they differ, `s - v` is neither observation — a third number
           drawn as a measured origin, which the first version of this trail
           did. So the move is drawn only when the track's newest reading IS
           this board row: then `s - v` is the previous scored observation,
           exactly, and the dashes below describe a real span. Everywhere
           else the mark stands alone and its title says when the name was
           last scored. */
        const usable = Boolean(mv && mv.current && mv.last !== null && mv.last === s);
        const v = usable ? isNum(mv.d1.v) : null;
        const gap = usable ? isNum(mv.d1.gap) : null;
        if (v !== null && v !== 0 && gap !== null) {
          const from = Math.max(-100, Math.min(100, s - v));
          const trail = svgEl("line", {
            class: "sp-move " + cls + (gap > 1 ? " is-gapped" : ""),
            x1: xOf(from), x2: xOf(s), y1: axisY, y2: axisY,
            stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round",
            opacity: 0.42,
            /* A DASH IS THE GAP, VISIBLY. Not a hue: the difference between
               an overnight move and a three-week one has to survive a
               monochrome printout. */
            "stroke-dasharray": gap > 1 ? "3 2.5" : null,
          });
          const trailSaid = svgEl("title");
          trailSaid.textContent = t + " " + fmtSigned(v, 0) + " over " + sessionsSaid(gap) +
            ", from " + fmtSigned(s - v, 0);
          trail.append(trailSaid);
          svg.append(trail);
          trails++;
        }
        /* A CROSSING IS RINGED, not tinted. It is the one event on this axis
           that is a change of category rather than of degree — and, like the
           trail, it is only ringed where the track's newest reading is this
           board row. A ring on a mark whose crossing happened last week
           dates an event to a session it did not happen on. */
        if (usable && typeof mv.d1.cross === "string") {
          svg.append(svgEl("circle", {
            class: "sp-cross is-" + mv.d1.cross, cx: xOf(s), cy: axisY, r: 8,
            fill: "none", stroke: "currentColor", "stroke-width": 1.2, opacity: 0.85,
          }));
        }
        /* THE MARK CARRIES ITS NAME. A row of anonymous dots says how far the
           tail reaches and refuses to say who is in it — and on a wide
           session the regions above name only the first ten a side, so many
           of these marks belong to names nowhere else on the page. A <title>
           is the SVG element's accessible name and its native tooltip at once. */
        const dot = svgEl("circle", {
          class: "sp-dot " + cls, cx: xOf(s), cy: axisY, r: 4.5, "data-t": t,
        });
        const label = svgEl("title");
        /* THE SPAN OR THE DATE, NEVER A BARE DELTA AND NEVER A NULL WORN AS
           A UNIT. `sessionsSaid(gap)` on an absent gap printed "null
           sessions"; a move with no span attached is the defect this whole
           layer replaced, so the title carries the move only when it carries
           the span too, and otherwise says when the name was last scored. */
        label.textContent = t + " " + fmtSigned(s, 0) +
          (v !== null && gap !== null
            ? ", " + fmtSigned(v, 0) + " over " + sessionsSaid(gap)
            : mv && mv.on ? ", last scored " + mv.on : "") +
          /* AND THE CATEGORY IN A WORD. The ring is a shape, so a crossing
             survives greyscale — but WHICH crossing was carried by the class
             alone, which is a hue at best and nothing at all to a screen
             reader. The title is the mark's accessible name; the word goes
             there. */
          (usable && typeof mv.d1.cross === "string" ? " · " + mv.d1.cross : "");
        dot.append(label);
        svg.append(dot);
        /* KEPT AS THE LOOP PLACES IT, so the cursor below reads the marks
           this pass actually drew — including the `usable` decision, which
           is what separates a real span from two payloads disagreeing. */
        marks.push({ s, t, v, gap, cross: usable && typeof mv.d1.cross === "string"
          ? mv.d1.cross : null, on: mv && mv.on ? mv.on : null });
      }
    }

    /* THE SAME SENTENCE THE PICTURE MAKES, and it may not name a width the
       payload did not publish: `band` is null on a board that predates the
       field, and the string it was concatenated into read "inside the plus
       or minus null dead band" — a null wearing a unit, in the one channel
       a reader who cannot see the hatch has. */
    svg.setAttribute("aria-label",
      "Score axis from minus 100 to plus 100. " +
      (neutral !== null && scored !== null
        ? neutral + " of " + scored + " names scored inside the " +
          (band === null ? "dead band, whose width this payload does not state,"
            : "plus or minus " + band + " dead band") +
          " and are not published. "
        : "") +
      ((payload.__bull || []).length) + " bullish and " + ((payload.__bear || []).length) +
      " bearish names cleared it." +
      (trails ? " " + trails + " of them trail the move since their previous scored session." : ""));

    /* THE ONE AXIS ON THIS PAGE WHERE A MARK IS A NAME, AND THE ONLY PLACE
       MOST OF THOSE NAMES APPEAR AT ALL. The regions above list the first ten
       a side; a wide session puts dozens of dots here that are named nowhere
       else, and each carries a <title> a mouse can find one at a time.

       GROUPED BY SCORE, BECAUSE THE MARKS ARE. Two names on +62 are two
       circles at one x — the axis cannot separate them and neither can a
       pointer. A cursor that searched the flat list would report whichever
       of them happened to be first and silently drop the rest, which is a
       reading that is wrong rather than absent. One point per score, naming
       everyone on it, is what the drawing actually shows.

       THE ROWS ARE CAPPED AND THE CAP IS SAID. A crowded score can hold more
       names than a readout can print; the count of what is not shown goes in
       a row of its own rather than the list simply ending. */
    if (window.FlowsCursor && marks.length) {
      const byScore = new Map();
      for (const m of marks) {
        if (!byScore.has(m.s)) byScore.set(m.s, []);
        byScore.get(m.s).push(m);
      }
      const SHOW = 6;
      window.FlowsCursor.attach(svg, {
        name: "Every cleared name on the score axis",
        band: { y0: axisY - 16, y1: axisY + 16 },
        points: [...byScore.keys()].sort((a, b) => a - b).map((score) => {
          const at = byScore.get(score);
          const rows = at.slice(0, SHOW).map((m) => ({
            k: m.t,
            /* THE MOVE ONLY WHERE THE SPAN CAME WITH IT — the same rule the
               <title> follows, and the reason `usable` exists: a delta with
               no span attached is the defect this layer replaced. */
            v: m.v !== null && m.gap !== null
              ? fmtSigned(m.v, 0) + " over " + sessionsSaid(m.gap)
              : m.on ? "last scored " + m.on : "no earlier scored session",
            cls: m.v === null ? "" : m.v > 0 ? "is-pos" : m.v < 0 ? "is-neg" : "",
          }));
          if (at.length > SHOW) {
            rows.push({ k: "and " + (at.length - SHOW) + " more",
                        v: "at this same score", cls: "" });
          }
          return { x: xOf(score), label: fmtSigned(score, 0), rows };
        }),
      });
    }

    spineHost.append(svg);
  }

  /* REDRAWN AT THE NEW WIDTH, NEVER SCALED TO IT. One viewBox unit is one
     CSS pixel, and a resize that left the old svg in place would break that
     on the first rotation of a phone or drag of a window edge. Debounced
     because a drag fires this continuously; the 2px threshold stops a
     scrollbar appearing from triggering a repaint loop. */
  let spineTimer = 0;
  window.addEventListener("resize", () => {
    if (!spineDrawn) return;
    clearTimeout(spineTimer);
    spineTimer = setTimeout(() => {
      if (spineDrawn && Math.abs(spineWidth() - spineW) > 2) renderSpine(spineDrawn);
    }, 150);
  });

  /* ---------- the staleness guard ----------------------------------

     THE ONLY FLOWS ROUTE WITHOUT ONE, AND IT IS THE ROUTE THE SECTION OPENS
     ON. loadBoard and loadRegion dropped the X-Payload-Updated header the
     Worker stamps on every payload, so during a pipeline outage /flows/long/
     warned and /flows/ rendered Tuesday's board on Friday under a "Session"
     tile naming a date and no warning anywhere.

     THE TEST ITSELF IS flows-ui.js's, AND THIS FILE MAY NOT KEEP A SECOND
     COPY OF IT: `staleness(payload, now, {subject})` was lifted out of
     flows-board.js for exactly this reason, and a private copy beside it —
     its own constants, its own sentences — is how one outage ends up worded
     two ways on two routes of one product, which reads as two outages.

     ITS ABSENCE IS REPORTED RATHER THAN SWALLOWED, as flows-board.js reports
     it: a freshness check that quietly stops running looks exactly like a
     pipeline that is fine, the one failure this banner exists to make
     impossible. */
  function assessAge(payload) {
    if (typeof UI.staleness !== "function") {
      return {
        kind: "unavailable",
        message: "The freshness check could not run: this page's shared UI module " +
          "(flows-ui.js) is too old to carry it, so nothing here is confirmed to be " +
          "today's. The session named above is the payload's own claim about itself.",
      };
    }
    /* `subject` is singular by the library's contract, so the sentence reads
       "This session was last written …" here and "This board …" on the side
       pages — one test, one threshold, the noun each page actually shows. */
    return UI.staleness(payload, Date.now(), { subject: "This session" });
  }

  function setStale(messages) {
    const text = messages.filter(Boolean).join(" ");
    if (staleEl) {
      staleEl.hidden = !text;
      staleEl.textContent = text;
    }
    document.body.classList.toggle("is-stale", Boolean(text));
  }

  /* ---------- the rail badges --------------------------------------

     The nav is server-rendered with the slots empty because filling them
     there would cost D1 row reads per page view for two-digit numbers this
     page has just fetched anyway. Revealed only once a real count exists —
     a badge reading 0 during the fetch says "nothing leaned today", which
     is a claim, not a loading state. */
  function setRailCount(side, n) {
    const slot = document.querySelector('[data-rail-count="' + side + '"]');
    if (!slot || n === null) return;
    slot.textContent = String(n);
    slot.hidden = false;
  }

  /* ---------- the page leads on change -----------------------------

     "What changed" was two of twelve columns beside the poles — ~194px at
     the 78rem clamp, a three-item list — and fell BELOW both ranked tables
     in reading order. The region that answers the only question this page
     is opened to ask cannot be its narrowest. Re-seated here because this
     file owns the renderer and not the grid: an inline `1 / -1`, which the
     phone breakpoint's `!important` one-column rule still wins over. The
     stylesheet should grow a `.cc-chg { grid-column: 1 / -1 }` rule and a
     source-order move, and this can then go. */
  function promoteChange() {
    const body = host("ccChg");
    const region = body && body.closest ? body.closest(".cc-region") : null;
    if (!region || !region.parentNode || region.parentNode !== verdictHost.parentNode) return;
    region.style.gridColumn = "1 / -1";
    verdictHost.insertAdjacentElement("afterend", region);
  }
  promoteChange();

  /* ---------- data --------------------------------------------------

     Seven reads, every one of an endpoint that already existed. The two
     boards are the page: a failure there is reported on the status line.
     The other five are regions, and each one's failure is CONTAINED — an
     events calendar that does not answer must not blank the five regions
     that did.

     THE WRITE TIME RIDES ON THE PAYLOAD. It answers a question no field in
     the body can: whether the PIPELINE ran, as distinct from whether the
     DATA moved. `0` is not a write time — the Worker sends "0" for a key it
     has never written — so it is rejected rather than coerced into an epoch
     date in 1970. */
  function stampUpdated(response, body) {
    const at = isNum(response.headers.get("X-Payload-Updated"));
    if (body && typeof body === "object") body.__updatedAt = at !== null && at > 0 ? at : null;
    return body;
  }

  /* THE ONE ANSWER THAT IS NOT A REGION'S TO CONTAIN. A 401 says the
     session is gone and the page is already navigating to the gate, so
     nothing below may paint over it. It is a FLAG rather than a null return
     because null is now also what an unreadable board answers, and the two
     must not be told apart by the same value. */
  let gated = false;

  /* A BOARD THAT DID NOT ANSWER BLANKS ONE REGION, NOT SEVEN. This threw on
     every non-OK status and had no catch for a network failure, so a 500 on
     either pole rejected the Promise.all and skipped the whole render: seven
     empty labelled shells with none of the four silences in any of them,
     while five region payloads that HAD come back were parsed and thrown
     away. Null is the answer loadRegion already gives and `silent()` already
     knows the sentence for it; the containment doctrine above was never a
     rule the two boards were exempt from. */
  function loadBoard(side) {
    return fetch("/api/flows/board?side=" + side, {
      credentials: "same-origin", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" },
    }).then((r) => {
      if (r.status === 401) { gated = true; location.replace("/flows/"); return null; }
      if (!r.ok) return null;
      return r.json().then((body) => stampUpdated(r, body));
    }).catch(() => null);
  }

  function loadRegion(path) {
    return fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json().then((body) => stampUpdated(r, body)) : null))
      .catch(() => null);
  }

  Promise.all([
    loadBoard("long"),
    loadBoard("short"),
    loadRegion("/api/flows/board?side=watch"),
    loadRegion("/api/flows/market"),
    loadRegion("/api/flows/flowalerts"),
    loadRegion("/api/flows/events"),
    loadRegion("/api/flows/scoretrack"),
    /* TWO KEYS THAT WERE PUBLISHED AND SERVED AND DRAWN NOWHERE. worker.js:2721
       and :2738 have answered these routes since the wave that added them, and
       this list — the only place the landing page asks for anything — did not
       ask. Live data, invisible. */
    loadRegion("/api/flows/sector-premium"),
    loadRegion("/api/flows/news"),
    /* THE THIRD KEY THAT WAS PUBLISHED, SERVED AND DRAWN NOWHERE. worker.js
       has answered /api/flows/pulse since the intraday wave; this list — the
       only place the landing page asks for anything — did not ask, so the
       one timestamped series in the whole product reached no reader. */
    loadRegion("/api/flows/pulse"),
  ]).then(([lng, sht, watch, market, alerts, events, track, lean, news, pulse]) => {
    /* ONLY the redirect stops the render. Two boards that both failed to
       read still leave five regions with something true to say, and the
       version of this guard that tested `!lng && !sht` could not tell a
       navigation in progress from two contained failures. */
    if (gated) return;

    const bull = ranked(lng && lng.rows);
    const bear = ranked(sht && sht.rows);

    /* ---- the joins the page used to refuse to make ----

       Both payloads were already in this closure and neither region could
       see the other. One Map each, built once. */
    const evBy = new Map();
    if (events && events.status !== "pending" && Array.isArray(events.rows)) {
      for (const row of events.rows) if (row && row.t) evBy.set(String(row.t), row);
    }
    const boardBy = new Map();
    const cards = new Set();
    for (const [payload, rows] of [[lng, bull], [sht, bear]]) {
      /* `deep` at the root says this board knows which rows carry a card.
         Its absence means the board predates the distinction, and every row
         on such a board does have one. */
      const knows = isNum(payload && payload.deep) !== null;
      for (const row of rows) {
        if (!row || !row.t) continue;
        const t = String(row.t);
        boardBy.set(t, row);
        if (!knows || row.dp === 1) cards.add(t);
      }
    }

    /* ---- the caption, the verdict bar and the two ranked sides ---- */
    paintMeta(host("ccMeta"), host("ccMetaDate"), host("ccMetaScreened"), host("ccMetaLive"),
      [lng, sht], market,
      [alerts && alerts.readAt, pulse && pulse.readAt, lean && lean.readAt,
        news && news.readAt, market && market.generatedAt]);
    paintVerdict(verdictHost, lng, sht, market, alerts, pulse);
    /* THE SESSION AS IT HAPPENED, AND THE SPLIT IT ENDED ON. Both read keys
       already in this closure and both were unreachable before this change. */
    const tideHost = host("ccTide"), tideSeg = host("ccTideSeg");
    if (tideHost && tideSeg) paintTide(tideHost, tideSeg, pulse);
    const splitHost = host("ccSplit");
    if (splitHost) paintSplit(splitHost, host("ccSplitSub"), pulse);

    const trk = readTrack(track && track.status !== "pending" ? track : null);

    for (const [id, subId, payload, rows, label, all] of [
      ["ccBull", "ccBullSub", lng, bull, "Bullish candidates, ranked", "bullish"],
      ["ccBear", "ccBearSub", sht, bear, "Bearish candidates, ranked", "bearish"],
    ]) {
      const into = host(id);
      const sub = host(subId);
      if (!into) continue;
      into.replaceChildren();
      if (silent(into, payload, all + " board")) {
        if (sub) { sub.textContent = ""; sub.hidden = true; }
        continue;
      }
      if (!rows.length) {
        /* AN EMPTY SIDE IS THE ORDINARY CASE, not a fault: the dead band can
           legitimately leave a side with nothing to publish. Saying so is
           the difference between a reading and a breakage. */
        quiet(into, "empty",
          "No name leaned " + all + " past the band this session.");
        if (sub) { sub.textContent = "0 ranked"; sub.hidden = false; }
        continue;
      }
      sideTable(into, rows, isNum(payload && payload.deep) !== null, trk, label, evBy);
      if (sub) {
        /* THE DENOMINATOR IS THE POOL, which is what the link opens (see
           poolCount). The publisher keeps the top-ranked rows, so "top N of
           pool" holds even when the page carries fewer than the pool. */
        const pool = poolCount(payload) ?? rows.length;
        const shown = Math.min(rows.length, ROW_MAX);
        sub.textContent = shown < pool ? "top " + shown + " of " + pool : "all " + pool;
        sub.hidden = false;
      }
    }

    /* ---- the lead region ---- */
    const chg = host("ccChg");
    if (chg) { chg.replaceChildren(); paintChanged(chg, track, cards, evBy, boardBy); }

    /* ---- the three narrow regions ---- */
    const alr = host("ccAlerts");
    if (alr) { alr.replaceChildren(); paintAlerts(alr, alerts); }
    const alrSub = host("ccAlertsSub");
    if (alrSub) {
      const said = [];
      /* THE CAP AND THE POPULATION, WHICH THE PAYLOAD PUBLISHES. `seen` is
         the whole read — shared/flows-alerts.js says in so many words that
         it exists so a page can write "N of SEEN" — and this region shows
         eight. "Flagged windows 44" sat in the verdict tile beside a list of
         eight with nothing anywhere saying eight. */
      const alrRows = alerts && alerts.status !== "pending" && Array.isArray(alerts.rows)
        ? alerts.rows : null;
      if (alrRows) {
        const seen = isNum(alerts.seen);
        const shown = Math.min(alrRows.length, LIST_MAX);
        const of = seen === null ? alrRows.length : seen;
        /* THE CEILING IS NOT A CENSUS (see the Flagged tile): at the vendor's
           maximum `seen` is a floor, printed with ≥ — and a truncated read
           is never "all", so capSaid's whole-population word is not offered. */
        said.push(alerts.vendorTruncated === true ? shown + " of ≥" + of : capSaid(shown, of));
      }
      /* THE INSTANT, WITH A ZONE ON IT AND NO SECONDS. A bare
         toLocaleTimeString follows the viewer's 12/24-hour locale, prints a
         seconds field this feed cannot support, and names no zone at all —
         on a subtitle whose entire subject is WHEN the read was taken. The
         wall clock is the viewer's, so /flows/unusual/ and this page still
         show the same number for the same instant; the zone is stated so the
         number means something. */
      /* THE CADENCE RIDES THIS LINE, AND IT DID NOT UNTIL CI SAID SO.

         The Flagged tile used to carry "nightly read" as a subtitle. That
         subtitle was removed with the rest of the strip's prose, on the
         stated grounds that this subtitle already carried the cadence. It
         did not — it carried an INSTANT ("read 10:28 UTC"), which is a
         different fact — so for one commit the cadence was published
         nowhere, and a reader could not tell a feed refreshed every few
         minutes from one taken once overnight. flows-overview-contract:1227
         caught it, which is exactly the failure the .ft-how rule names: a
         caveat believed to be carried elsewhere, and not.

         It goes here rather than back on the tile because it belongs beside
         the rows it describes, and because a modifier on a word this line
         already prints costs no new text: "nightly read 10:28 UTC". The
         strip stays clean and nothing is lost.

         AND THE UNPUBLISHED CASE IS STATED, NOT DEFAULTED. A payload that
         predates `refreshed` says so; it does not get "nightly" as a
         confident default wearing a ternary. When no readAt parsed there is
         no instant to modify, so the cadence is pushed as its own clause
         rather than silently dropping with the clock. */
      const cadence = alerts && alerts.status !== "pending"
        ? (alerts.refreshed === "intraday" ? "intraday"
          : alerts.refreshed === "nightly" ? "nightly" : null)
        : null;
      const read = alerts && typeof alerts.readAt === "string" ? Date.parse(alerts.readAt) : NaN;
      if (Number.isFinite(read)) {
        said.push((cadence ? cadence + " read " : "read ") + clockSaid(read)
          + (alrRows && !cadence ? ", cadence not published" : ""));
      } else if (alrRows) {
        said.push(cadence ? cadence + " read" : "cadence not published");
      }
      alrSub.textContent = said.join(" · ");
    }

    const evr = host("ccEvents");
    if (evr) { evr.replaceChildren(); paintEvents(evr, events); }
    const evSub = host("ccEventsSub");
    if (evSub) {
      /* THE DENOMINATOR WAS NAMED AND THE NUMERATOR NEVER WAS. "24 in the
         window" over eight rows is the same omission as the watch anchor,
         one clause shorter. `inWindow` counts the names the calendar found;
         `rows` is already capped at 200 on the wire and again at eight
         here. */
      const evRows = events && events.status !== "pending" && Array.isArray(events.rows)
        ? events.rows : null;
      const inWindow = isNum(events && events.inWindow);
      evSub.textContent = evRows === null ? ""
        : capSaid(Math.min(evRows.length, LIST_MAX),
            inWindow === null ? evRows.length : inWindow) + " in the window";
    }

    /* ---- the two regions this wave exists for ----

       ONE INSTANT FOR THE WHOLE PAGE. The headline ages are measured against a
       clock read once here rather than once per row: two rows stamped
       identically must not print different ages. */
    const drawnAt = Date.now();
    const lea = host("ccLean");
    if (lea) { lea.replaceChildren(); paintLean(lea, lean, host("ccLeanSeg")); }
    const nws = host("ccNews");
    if (nws) { nws.replaceChildren(); paintNews(nws, news, cards, drawnAt); }

    const wtc = host("ccWatch");
    if (wtc) { wtc.replaceChildren(); paintWatch(wtc, watch); }
    const wtcSub = host("ccWatchSub");
    if (wtcSub) {
      /* THE ONE THAT WAS NOT AN OMISSION BUT A CONTRADICTION. `rowCount` is
         the whole published board — capped at 80 by the publisher — and this
         region lists eight of it, so with twelve on the wire the anchor read
         "all 12" over eight names. The word was "all" and the link goes to
         the one page where the reader could have counted. */
      const n = rowCount(watch);
      wtcSub.textContent = n === null
        ? "inside the dead band" : capSaid(Math.min(n, LIST_MAX), n);
    }

    /* ---- the spine, over the whole published distribution ---- */
    /* A PENDING ENVELOPE IS TRUTHY AND CARRIES NOTHING. The worker answers
       an unpublished key with {status:"pending", rows: []}, so `lng || sht`
       chose the empty envelope over a published short board and the spine
       then drew an axis labelled "no dead band published for this session"
       while the payload three lines away carried one — and the status line
       lost its session date and its band counts the same way. Same guard
       `rowCount` has carried since the pending envelope existed. */
    const answered = (p) => (p && p.status !== "pending" ? p : null);
    const meta = answered(lng) || answered(sht) || lng || sht || {};
    meta.__bull = bull;
    meta.__bear = bear;
    meta.__moves = new Map(Object.entries(trk.moveBy));
    renderSpine(meta);

    /* ---- what is wrong with this page, in one line ----

       THREE WAYS THE SESSION ON SCREEN IS NOT TODAY'S, and they are three
       different failures. The two halves are two fetches of two rows, and a
       pipeline that failed between them would put yesterday's bulls beside
       today's bears with nothing in either payload to disagree about it;
       nothing forces them to agree, so the page has to check. The other two
       come off the write time and the session date, which every deeper
       route has warned on since the board shipped and this one never did. */
    const notes = [];
    const ld = lng && lng.sessionDate, sd = sht && sht.sessionDate;
    if (ld && sd && ld !== sd) {
      notes.push("These two halves are from different sessions — bullish " +
        ld + ", bearish " + sd + ". Treat the comparison with care.");
    }
    /* BOTH HALVES ARE CHECKED AND THE SENTENCE IS PRINTED ONCE. They are two
       writes of one session, so in the ordinary outage both carry the same
       age and the same words; printing the identical sentence twice would
       read as two separate faults. */
    const seen = new Set();
    for (const payload of [lng, sht]) {
      const verdict = payload ? assessAge(payload) : null;
      const message = (verdict && verdict.message) || null;
      if (message && !seen.has(message)) { seen.add(message); notes.push(message); }
    }
    setStale(notes);

    const scored = isNum(meta.scored), neutral = isNum(meta.neutral);
    /* THE ROWS AGAINST THE POOL, in the line that already reconciles the
       counts: "50 of 53 bearish carried" where the cap took names — the
       reconciliation /flows/long/ prints at flows-board.js:1960 — and the
       bare count where rows and pool agree (see poolCount). An unread or
       unpublished side stays the em dash, named below. */
    const sideSaid = (rows, pool, word) => rows === null ? DASH + " " + word
      : pool !== null && pool > rows ? rows + " of " + pool + " " + word + " carried"
        : rows + " " + word;
    /* THE STRIP SAYS IT, SO THIS LINE DOES NOT. The Session tile carries
       meta.sessionDate and the Cleared tile both POOLS, so reprinting them
       restated the readings sitting an inch above.

       WHAT THE STRIP CANNOT SAY STAYS. "50 of 53 bearish carried" is a
       TRUNCATION — the cap took names — and the tile prints the pool alone,
       so this is the only place rows and pool are reconciled; it prints when
       they part company and not otherwise. The band count is measured here
       and nowhere else, and the unread-board sentence is a refusal: the em
       dash five other absences print cannot say a fetch failed. */
    const lngRows = rowCount(lng), shtRows = rowCount(sht);
    const lngPool = poolCount(lng), shtPool = poolCount(sht);
    const cut = (rows, pool) => rows !== null && pool !== null && pool > rows;
    /* AND AN UNKNOWN SIDE PUTS THE COUNTS BACK, which the first draft of this
       got wrong and CI caught. The Cleared tile prints the pools, so on an
       ordinary session the counts here were a restatement — but a side that
       has not published has NO pool either, and the line this replaced was
       the only place "— bullish · 4 bearish" appeared. An em dash where a
       count belongs is the difference between "not known" and "zero", which
       is the distinction this whole page is built to keep, and dropping it to
       save a line would be exactly the fold the DEFINITION-vs-REFUSAL rule
       forbids. So: print when a side is TRUNCATED, print when a side is
       UNKNOWN, and stay quiet only when both sides are whole and counted. */
    const unknown = (rows) => rows === null;
    const parts = [];
    if (cut(lngRows, lngPool) || cut(shtRows, shtPool) ||
        unknown(lngRows) || unknown(shtRows)) {
      parts.push(sideSaid(lngRows, lngPool, "bullish") + " · " +
        sideSaid(shtRows, shtPool, "bearish"));
    }
    if (scored !== null && neutral !== null) parts.push(neutral + " of " + scored + " inside the band");
    /* AND A BOARD THAT DID NOT ANSWER IS NAMED HERE. The em dash the count
       falls back to is the right glyph for "not known" and it is the same
       glyph five other absences print, so on its own it cannot tell a reader
       that a fetch failed. The line that reports on this page is where that
       belongs. */
    const unread = [lng ? null : "bullish", sht ? null : "bearish"].filter(Boolean);
    const said = parts.length ? parts.join(" · ") + "." : "";
    statusEl.textContent = said + (unread.length
      ? (said ? " " : "") + "The " + unread.join(" and ") + " board" + (unread.length > 1 ? "s" : "") +
        " could not be read, so " + (unread.length > 1 ? "neither side is" : "that side is not") +
        " on this page. Refresh to try again."
      : "");

    /* THE TWO BOARD BADGES ARE THE POPULATION, WHICH IS WHAT /flows/long/
       BADGES: the size of the SECTION the link opens, not this page's excerpt
       of it — the rule flows-events.js:1126 settled for the fourth slot
       below, read here through poolCount so the tile, the status line and
       the pole subtitles cannot part from it; setRailCount withholds on null.

       THE WATCH BADGE STAYS ON `rowCount`, checked rather than assumed:
       `board:watch` publishes `neutral` and NO `cleared` at all
       (flows-pipeline.mjs:5824), and flows-watch.js:434 fills this same slot
       from its own rows.length — so the two routes already agree. `neutral`
       would be the field to move to, but it would have to move on both
       routes at once, which is a separate decision from this one. */
    setRailCount("long", poolCount(lng));
    setRailCount("short", poolCount(sht));
    setRailCount("watch", rowCount(watch));
    /* THE FOURTH SLOT IS THE CALENDAR'S POPULATION, the same quantity
       flows-events.js:1142 writes: `inWindow`, not the published rows, which
       are capped at 200 on the wire and at eight in the region above — so the
       two routes fill one badge with one number. The nav emits the slot
       (shared/flows-pages.js:84) and this page held the payload and never
       filled it, which read as "nothing reports this week". `inWindow` is
       null on a pending envelope and setRailCount withholds on null. */
    setRailCount("events", events && events.status !== "pending"
      ? isNum(events.inWindow) : null);
  }).catch(() => {
    statusEl.textContent = "The session could not be loaded. Refresh to try again.";
  });
})();
