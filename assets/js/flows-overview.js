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

   AND THE CHANGE ARITHMETIC IS NO LONGER THIS FILE'S. The version this
   replaces did, in the browser:

       const measured = name.s.map(isNum).filter(v => v !== null);
       const delta = measured[len - 1] - measured[len - 2];

   The .filter() is the defect. A null in the aligned series means the name
   WAS NOT SCORED that session, so the two survivors can be one session apart
   or twenty and the subtraction produces the same integer either way — a
   name last scored three weeks ago came back with a "+40" that read as an
   overnight move, printed under a region subtitled "since each name's prior
   scored session" on today's page. shared/flows-scores.js derives the move
   once, beside the series it comes from, and publishes it WITH its
   denominator: d1.v, d1.gap, d1.cross, lastAt, run. This file reads those
   and does no delta arithmetic of its own.

   SEVEN REGIONS, AND EACH ONE IS ALLOWED TO SAY NOTHING. A region with an
   unpublished key, a region whose request never came back, a region whose
   payload predates the field it needs, and a region the pipeline measured
   and found empty are FOUR DIFFERENT FACTS, and this file words them as
   four different sentences. Only the last is a claim about the market; the
   others are claims about this page, and printing the last one for all of
   them is how a surface starts lying quietly.

   THE PRIMITIVES ARE THE LIBRARY'S. This file used to re-derive isNum, el,
   svgEl, the em dash and the U+2212 minus — the sixth such copy in the repo,
   and its isNum was one of the wrong ones (`Number(null)` is 0 and 0 is
   finite, so an absent score drew a confident mark at zero on the spine).
   They come from flows-ui.js now, which is loaded before this file.
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
  const sessionsSaid = (n) => n + (n === 1 ? " session" : " sessions");
  const daysSaid = (n) => n + (n === 1 ? " calendar day" : " calendar days");

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

  /* ---------- a name that opens its card in place ------------------

     The tiles this replaces were anchors to ?t=SYM, so opening a card was a
     full page navigation that re-fetched both board payloads to redraw a
     page the reader was already looking at. A button carrying data-t is
     picked up by the delegated handler in flows-card.js, which opens the
     dialog and pushes the same ?t= state — same address, same Back button,
     no reload.

     A ROW WITHOUT A CARD IS NOT A BUTTON. The card costs vendor calls the
     run spends only on the names furthest from neutral, and the board says
     which those are: `deep` at the payload root means this board knows the
     distinction at all, `dp` on a row means this row got one. A board
     predating the distinction publishes neither, and every row on it does
     have a card — so the test is on the PAYLOAD first. Withholding data-t
     is what actually keeps a cardless row out of the click delegation; a
     class name would only keep it out of the stylesheet. */
  function nameNode(t, hasCard) {
    if (!t) return el("span", "cc-flat", DASH);
    if (!hasCard) {
      const flat = el("span", "cc-flat", t);
      flat.title = NO_CARD_SAID;
      return flat;
    }
    const button = el("button", "cc-open", t);
    button.type = "button";
    button.dataset.t = t;
    button.setAttribute("aria-haspopup", "dialog");
    // Warm the card on hover so the dialog opens instantly; at most six are cached.
    button.addEventListener("pointerenter", () => {
      if (window.flowsCardPrefetch) window.flowsCardPrefetch(t);
    });
    return button;
  }

  /* ---------- the earnings marker ----------------------------------

     THE MOST EXPENSIVE MISTAKE THIS SURFACE CAN LET A READER MAKE is
     carrying a long signal into a print. Both boards and the events
     calendar were already fetched in the same Promise.all and were never
     joined: the page ranked ORCL #1 bullish in one region while another
     region, three hundred pixels below, said ORCL reports in three
     sessions. Neither region knew about the other and the reader had to.

     TWO SOURCES, TWO UNITS, AND THE UNIT IS PRINTED. The board row now
     carries `edte` in CALENDAR DAYS (the gate's own arithmetic, on the row
     the gate spared) and the events payload carries `sdte` in TRADING
     SESSIONS. They are different quantities and "3" means different things
     in each, so the glyph is followed by the number AND its unit letter,
     and the title spells both out with the date. The events count is
     preferred where both exist because it is the count the earnings gate
     itself measured. */
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
    const wrap = tableWrap(label);
    const table = el("table", "cc-tbl");
    table.append(headRow([
      ["", "cc-rank"], ["Name", null], ["Score", "c-num"], ["Conv", "c-num"],
      ["Chg", "c-num"], ["Net prem", "c-num"], [track.label, "cc-trk"],
    ]));

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
      tr.append(el("td", "c-num cc-score" + tone(row.s), fmtSigned(row.s)));
      tr.append(el("td", "c-num", isNum(row.cnv) === null ? DASH : String(Math.round(row.cnv))));
      tr.append(el("td", "c-num" + tone(row.chg), pct(row.chg)));
      tr.append(el("td", "c-num" + tone(row.netPrem), usd(row.netPrem)));

      const cell = el("td", "cc-trk");
      const series = track.byName[row.t];
      const measured = (series || []).filter((v) => isNum(v) !== null).length;
      if (series && measured) {
        /* ONE SHARED DOMAIN ACROSS BOTH SIDES. Left to itself every strip
           rescales to its own extremes, and a name drifting ±2 draws the
           same picture as one swinging ±40 — so a bull strip and a bear
           strip could not be read against each other at all. */
        scoreStrip(cell, {
          values: series, width: 150, height: 22,
          domain: track.domain, deadBand: track.deadBand, prefix: "cc",
          ariaLabel: "Score for " + row.t + " across " + measured + " archived sessions",
        });
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
     page and not only in the change table. `d1` alone is a delta with no date
     on it, and the two other places that draw it — the crossing tag on a
     ranked row and the trail on the spine — were reading exactly that: a
     name last scored a week ago had its crossing tagged onto today's ranked
     row and its move drawn on today's axis, in a region of a page whose whole
     argument is that a reading which is not about today has to say so. So the
     index carries `at` (the session the reading ends on), `last` (the score
     it ended at) and `current` (whether that session is the newest one the
     track holds), and the callers decide with those rather than with a bare
     delta. */
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
      deadBand: payload ? isNum(payload.deadBand) : null,
      /* The column header states the window it drew rather than a constant:
         a track that published nothing gets a header that promises nothing. */
      label: sessions ? sessions + " sessions" : "Score track",
    };
  }

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
        " scored for the first time in this window and has no prior reading to " +
        "compare against.");
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

    const p = el("p", "cc-quiet cc-lede", lede);
    into.append(p);

    const wrap = tableWrap("What changed since each name's prior scored session");
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

  /* ---------- the verdict bar --------------------------------------

     Seven readings the rest of the page then explains. Every one of them is
     allowed to be an em dash: a tile whose endpoint did not answer says so
     by not saying a number, which is the only honest thing a tile can do. */
  function paintVerdict(into, long, short, market, alerts) {
    const breadth = (market && market.breadth) || {};
    const premium = (market && market.premium) || {};
    const bulls = rowCount(long);
    const bears = rowCount(short);

    /* WHY THE ALERT SUB-LABEL IS NOT A CONSTANT. "nightly read" is a claim
       about when the feed was taken, and printing it beside an em dash —
       for a payload that never arrived — would attach a provenance to a
       number that does not exist. */
    let alertNote = "not read";
    if (alerts && alerts.status === "pending") alertNote = "not published yet";
    else if (alerts) alertNote = alerts.refreshed === "intraday" ? "refreshed intraday" : "nightly read";

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
    const disagree = bt !== null && pt !== null && bt !== 0 && pt !== 0 && (bt > 0) !== (pt > 0);
    const DISAGREE_SAID = "the two weightings disagree in sign";

    const tiles = [
      ["Session", (long && long.sessionDate) || DASH, "", null],
      ["Screened", isNum(market && market.n) === null ? DASH : String(market.n), "names", null],
      /* EACH SHARE NAMES THE POPULATION IT IS A SHARE OF, and neither
         population is "names" or "premium" in the loose sense the first
         version used. breadth.tilt is (bull − bear) / (bull + bear), so its
         denominator is the names that LEANED — not the 264 in the Screened
         tile beside it, which is what "of names" invited a reader to divide
         by. premium.tilt is net / gross over per-name NET premium, and
         shared/flows-market.js says in so many words that those sums are
         "not call premium and not put premium": the subtitle that read
         "calls − puts" named two vendor columns this number is not made of. */
      ["Tilt · names", pct(bt, 1),
        bt === null ? "not measured this session"
          : disagree ? DISAGREE_SAID : "of the names that leaned, bull − bear", tone(bt)],
      ["Tilt · dollars", pct(pt, 1),
        pt === null ? "not measured this session"
          : disagree ? DISAGREE_SAID : "of gross net premium, bought − sold", tone(pt)],
      ["Breadth",
        (isNum(breadth.bull) === null ? DASH : String(breadth.bull)) + " / " +
        (isNum(breadth.bear) === null ? DASH : String(breadth.bear)), "bull / bear", null],
      ["Both sides",
        (bulls === null ? DASH : bulls) + " / " + (bears === null ? DASH : bears), "ranked", null],
      ["Flagged windows",
        isNum(alerts && alerts.seen) === null ? DASH : String(alerts.seen), alertNote, null],
    ];

    for (const [key, value, sub, cls] of tiles) {
      const tile = el("div", "cc-tile");
      tile.append(el("span", "cc-tile-k", key));
      tile.append(el("span", "cc-tile-v" + (cls || ""), String(value)));
      if (sub) tile.append(el("span", "cc-tile-s", sub));
      into.append(tile);
    }
  }

  /* ---------- the freshest flagged windows -------------------------

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

    const wrap = tableWrap("Flagged option windows, freshest first");
    const table = el("table", "cc-tbl");
    table.append(headRow([["Name", null], ["Contract", null], ["Premium", "c-num"], ["Rule", null]]));
    const body = el("tbody");
    for (const row of rows.slice(0, LIST_MAX)) {
      const tr = el("tr");
      tr.append(el("td", "cc-t", row.t || DASH));
      tr.append(el("td", null,
        (row.cp || DASH) + " " + (isNum(row.k) === null ? DASH : row.k) +
        (row.exp ? " " + String(row.exp).slice(5) : "")));
      tr.append(el("td", "c-num", usd(row.prem)));
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

    const wrap = tableWrap("Names reporting inside the window");
    const table = el("table", "cc-tbl");
    table.append(headRow([
      ["Name", null], ["Date", null], ["In · sessions", "c-num"],
      ["Priced move", "c-num"], ["Score", "c-num"],
      ["Stage", null, "Where this name stopped in the run's funnel. \"gated\" means " +
        "the board was forbidden from holding an opinion on it, not that it had none."],
    ]));
    const body = el("tbody");
    for (const row of rows.slice(0, LIST_MAX)) {
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
    const list = el("ul", "cc-moves");
    for (const row of rows.slice(0, LIST_MAX)) {
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
      /* AND THE NUMBER SAYS WHICH OF THE TWO IT IS. This list has no column
         header to hang a unit on, and the two branches print DIFFERENT
         quantities into the same slot: 0.0182 is a residual and +18 is a
         score on a ±100 scale. Unlabelled they are one column of bare
         numbers a reader cannot compare across rows, let alone against the
         ranked regions above. */
      const cell = resid !== null
        ? el("span", "c-num" + tone(resid), resid.toFixed(4))
        : el("span", "c-num" + tone(row.s), fmtSigned(row.s));
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

     THE CHART INVARIANT, WHICH THIS FUNCTION USED TO BREAK. One viewBox
     unit is one CSS pixel (assets/js/flows-ui.js:20-27). The old code
     measured the host, then clamped W to 900 and emitted width:"100%" — so
     on the 132rem canvas tier, where this region spans all twelve columns
     and the host is around 2000px, a 900-unit viewBox was stretched to
     ~2.2 CSS px per unit: every dot rendered at radius ~10 instead of 4.5,
     the 6-unit hatch became ~13px, and the 9px tick labels rendered near
     20px. The width is now the measured host width and it is emitted as an
     attribute, which is the shape scoreStrip has always used. */

  let spineDrawn = null;   // the last payload drawn, kept for the resize repaint
  let spineW = 0;          // and the width it was drawn at

  /* MEASURED FROM A VISIBLE HOST, AND NEVER FLOORED ABOVE IT. A hidden
     element reports clientWidth 0, which is the only reason a fallback
     exists; the ceiling is a sanity bound on a runaway layout rather than a
     design width, and it sits above the widest canvas tier so it never binds
     in practice.

     THE OLD FLOOR OF 300 CANNOT COME BACK. With width:"100%" a floor was
     harmless — the svg scaled down to fit. With an explicit width attribute
     a floor wider than the host is horizontal overflow on the document, and
     zero horizontal overflow at 320px is a tested invariant of this site. */
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
    for (const [rows, cls] of [[payload.__bull, "is-bull"], [payload.__bear, "is-bear"]]) {
      for (const r of rows || []) {
        const s = isNum(r.s);
        if (s === null) continue;
        const t = String(r.t || "");
        const mv = moves.get(t) || null;
        /* TWO PAYLOADS, AND THE TRAIL IS DRAWABLE ONLY WHERE THEY AGREE.
           The dot sits at the BOARD's score for this session; the move comes
           off the SCORE TRACK, whose newest column is not always this
           session and whose newest score for a name is not always the one
           the board is publishing. Where they differ, `s - v` is neither
           observation — it is a third number this renderer would be making
           up, drawn as a measured origin. The first version of this trail
           did exactly that and its comment claimed the origin was "the
           previous scored observation exactly", which was true only for the
           names where the two payloads happened to coincide.

           So the move is drawn only when the track's newest reading IS this
           board row: measured on the track's newest session, and at the same
           score the board is printing. Then `s - v` is the previous scored
           observation, exactly, and the dashes below describe a real span.
           Everywhere else the mark stands alone and its title says when the
           name was last scored, which is the honest reading. */
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
     ON. loadBoard and loadRegion read r.json() and dropped the
     X-Payload-Updated response header the Worker stamps on every payload —
     so during a pipeline outage /flows/long/ warned and /flows/ rendered
     Tuesday's board on Friday with a "Session" tile that named a date and no
     warning anywhere.

     THE TEST ITSELF IS flows-ui.js's, AND THIS FILE MAY NOT KEEP A SECOND
     COPY OF IT. The version this replaces carried its own `localStaleness`
     with its own two constants and its own two sentences, behind a comment
     saying the shared one did not exist yet. It does — flows-ui.js exports
     `staleness(payload, now, {subject})`, lifted out of flows-board.js for
     exactly this reason — and a private copy beside it is how the same
     outage ends up worded two ways on two routes of one product, which
     reads to a reader as two outages. The thresholds live there too: they
     were duplicated across six renderers before, with the same numbers and
     six different comments, and the first one somebody tuned would have
     silently disagreed with the other five.

     ITS ABSENCE IS REPORTED RATHER THAN SWALLOWED, the same way
     flows-board.js reports it: a freshness check that quietly stops running
     looks exactly like a pipeline that is fine, which is the one failure
     mode this banner exists to make impossible. */
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

     "What changed" was two of twelve columns beside the poles — about 194px
     of content at the 78rem clamp — holding a three-item list, and it fell
     BELOW both ranked tables in the reading order. The region that answers
     the only question this page is opened to ask cannot be its narrowest.

     Re-seated here rather than in the stylesheet because this file owns the
     renderer and not the grid; the span is an inline declaration of the same
     `1 / -1` the spine region already carries, and the phone breakpoint's
     `!important` one-column rule still wins over it, which is the behaviour
     we want. The stylesheet should grow a `.cc-chg { grid-column: 1 / -1 }`
     rule and a source-order move, and this can then go. */
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

  function loadBoard(side) {
    return fetch("/api/flows/board?side=" + side, {
      credentials: "same-origin", headers: { Accept: "application/json" },
    }).then((r) => {
      if (r.status === 401) { location.replace("/flows/"); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json().then((body) => stampUpdated(r, body));
    });
  }

  function loadRegion(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } })
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
  ]).then(([lng, sht, watch, market, alerts, events, track]) => {
    if (!lng && !sht) return;

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

    /* ---- the verdict bar and the two ranked sides ---- */
    paintVerdict(verdictHost, lng, sht, market, alerts);

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
        sub.textContent = rows.length > ROW_MAX
          ? "top " + ROW_MAX + " of " + rows.length : "all " + rows.length;
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
      const read = alerts && alerts.readAt ? Date.parse(alerts.readAt) : NaN;
      alrSub.textContent = Number.isFinite(read) ? "read " + new Date(read).toLocaleTimeString() : "";
    }

    const evr = host("ccEvents");
    if (evr) { evr.replaceChildren(); paintEvents(evr, events); }
    const evSub = host("ccEventsSub");
    if (evSub) {
      const inWindow = isNum(events && events.inWindow);
      evSub.textContent = inWindow === null ? "" : inWindow + " in the window";
    }

    const wtc = host("ccWatch");
    if (wtc) { wtc.replaceChildren(); paintWatch(wtc, watch); }
    const wtcSub = host("ccWatchSub");
    if (wtcSub) {
      const n = rowCount(watch);
      wtcSub.textContent = n === null ? "inside the dead band" : "all " + n;
    }

    /* ---- the spine, over the whole published distribution ---- */
    const meta = lng || sht || {};
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
    const bullN = rowCount(lng), bearN = rowCount(sht);
    const parts = [];
    parts.push((bullN === null ? DASH : bullN) + " bullish · " +
      (bearN === null ? DASH : bearN) + " bearish");
    if (meta.sessionDate) parts.push("session " + meta.sessionDate);
    if (scored !== null && neutral !== null) parts.push(neutral + " of " + scored + " inside the band");
    statusEl.textContent = parts.join(" · ") + ".";

    setRailCount("long", bullN);
    setRailCount("short", bearN);
    setRailCount("watch", rowCount(watch));
  }).catch(() => {
    statusEl.textContent = "The session could not be loaded. Refresh to try again.";
  });
})();
