/* =============================================================
   flows-watch.js — the dead band, which used to be an integer.

   Most scored names land inside the dead band each session — the band's
   width is published per session and has been as wide as ±20 and as narrow
   as ±1, so no number is quoted here that the payload can contradict. The pipeline scores them completely — every
   family, every gate, every quality multiplier — and then reports them
   to the reader as a single count in a status line.

   That count is the least useful form of the information. A name a hair
   inside the edge is one session from publishing and nothing on the site let you
   see it coming. A name barely off zero carrying the largest options-volume
   surprise in the universe is the most interesting row of the day and
   had nowhere to appear.

   NOTHING HERE CLEARED THE BAR, and every affordance on this page is
   built to keep that in view. There is no rank column, because a rank
   implies an ordering someone should act on; the sort is by distance
   to the band, which is a statement about measurement rather than
   about conviction. The score column carries its sign but no bar —
   the board's centre-origin bar is a visual claim of strength and
   these rows have none.

   AND THE PART THAT WAS MISSING: THE DIRECTION OF TRAVEL.

   This page could say how far a name was from the edge and could not
   say whether it was walking toward it. Two names sitting at the same
   distance are not the same row — one closed half the gap last night
   and the other opened it — and on a page whose whole subject is what
   is ABOUT to happen, that is the difference between the two most
   useful rows and two rows that look identical.

   It was not an oversight. Distance is measured on the RESIDUAL,
   because at a band of ±1 every row inside it scores 0 and the score
   cannot separate them; and the residual was computed every morning,
   used to rank, and never archived. There was no yesterday to
   subtract. The dated score archive now carries it, and the pooled
   trace publishes each name's residual CHANGE since the session it
   was last scored — so the second half of this page's question is
   answerable for the first time from bytes the run already held.

   WHAT IS PUBLISHED HERE IS A RATE, NOT A FORECAST. The approach
   column is an observed change between two archived sessions. The
   projection beside it divides one distance by one rate and says so
   on the row: it is arithmetic a reader could do, offered so they do
   not have to, and it is withheld wherever the arithmetic would be
   dressing a single observation as a trend.
   ============================================================= */
(() => {
  "use strict";

  const statusEl = document.getElementById("watchStatus");
  const staleEl = document.getElementById("watchStale");
  const wrap = document.getElementById("watchTableWrap");
  const body = document.getElementById("watchBody");
  if (!statusEl || !wrap || !body) return;

  const COLUMNS = 9;                 // keep in sync with the <thead> in flows-pages.js
  const MINUS = "−";            // U+2212, not a hyphen
  const DASH = "—";

  /* The missing-value test comes BEFORE the coercion. Number(null) is 0 and
     0 is finite, so the naive shape turns an absent reading into a confident
     zero — on this page that rendered "0.00×" in the Surprise column of every
     row, which is a real reading of that field ("balanced") and not what a
     missing one means. */
  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const signed = (v, d) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(d);
  };

  const fixed = (v, d) => {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(d);
  };

  /* A MULTIPLE, NOT A PERCENTAGE. relVolume is today's share volume over the
     vendor's own recent norm, so 2.4x is the honest rendering and "+140%"
     would invite reading it as a return. */
  const multiple = (v) => {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(2) + "×";
  };

  const pct = (v, d) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : "") + (Math.abs(n) * 100).toFixed(d === undefined ? 0 : d) + "%";
  };

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  /* Distance is computed HERE rather than trusted from the payload, because
     it is a function of quantities already on the wire — a third serialised
     field that must agree with two others is a field that will eventually
     disagree with them.

     SCORE_SCALE, the one constant that converts a residual into a score.
     boundedScore is 100*tanh(residual / SCORE_SCALE), so the inverse maps the
     band's edge — quoted in score units — back into residual units, which is
     where this page's proximity question can actually be answered. Kept as
     the same closed form the scorer uses rather than a fitted number, so the
     two cannot drift apart silently. */
  var SCORE_SCALE = Math.atanh(0.80) / 2.0;

  /**
   * How far this name is from leaving the dead band.
   *
   * MEASURED ON THE RESIDUAL, because the score cannot answer it any more.
   * The page was calibrated against a ±20 band, where `band − |score|` ranged
   * over 0..20 and the "within three" highlight picked out a real minority.
   * The band is 1 now, so every row inside it scores 0 — and this column
   * became identically 1, the highlight fired on every row, the sort had
   * nothing to sort by, and the status line reported a tautology as a finding.
   *
   * The residual is the quantity the rows are actually ordered by, and it is
   * published. Distance is computed in residual units and returned with the
   * unit named, so the number cannot be read as score points.
   */
  function distanceToBand(row, band) {
    const b = isNum(band);
    if (b === null) return null;
    const resid = isNum(row && row.resid);
    if (resid !== null) {
      /* THE UNROUNDED SCORE, NOT A SECOND UNIT.

         The first attempt at this reported the distance in RESIDUAL units,
         which fixed the ±1 band and broke the ±20 one: at that width the two
         closest rows both printed 0.0000 and the column lost the very
         distinction it exists for. It also put a second unit next to the
         score column, inviting a reader to compare two numbers that are not
         in the same measure.

         boundedScore is 100*tanh(residual / SCORE_SCALE) — the score, before
         it was rounded to an integer for display. Recovering it here keeps
         the column in SCORE POINTS, comparable to the column beside it, and
         restores the precision that rounding destroyed. It behaves at every
         band width, which the previous two versions each failed to do at one
         end. */
      const exact = 100 * Math.tanh(resid / SCORE_SCALE);
      return { value: Math.max(0, b - Math.abs(exact)), exact, unit: "score", edge: b };
    }
    /* A payload published before `resid` existed carries only the rounded
       integer, so this reads what it has. */
    const s = isNum(row && row.s);
    if (s === null) return null;
    return { value: Math.max(0, b - Math.abs(s)), exact: null, unit: "score", edge: b };
  }

  /**
   * WHICH WAY THIS NAME IS WALKING, and how fast.
   *
   * The two archived residuals are the whole input. `d1.qv` is the change in
   * residual since the session this name was LAST SCORED, in units of 1e-4,
   * so the previous residual is `resid - qv/1e4` — and running both through
   * the same 100*tanh transform distanceToBand uses gives two distances in
   * the same unit, whose difference is the approach.
   *
   * THE SAME TRANSFORM, NOT A LINEARISATION OF IT. tanh is curved, so the
   * residual change does not map to a fixed number of score points: the same
   * step covers more score near zero than near the edge, which is precisely
   * where the rows on this page live. Differencing the two transformed values
   * rather than scaling the residual delta keeps that curvature, and the
   * difference is exact rather than a first-order approximation of itself.
   *
   * SIGN CONVENTION: POSITIVE MEANS CLOSER TO THE EDGE. The underlying
   * distance shrinks as a name approaches, so the naive subtraction is
   * negative for the interesting case — and a column where the good news is
   * the negative number is a column every reader misreads once. It is
   * negated here, once, rather than in the renderer.
   *
   * @returns null when there is nothing to compare, else
   *   { now, before, per, gap, sessions } — `per` is the approach PER SESSION
   *   (the raw move divided by the sessions it spanned) and `sessions` is the
   *   projection, null wherever projecting would be dishonest.
   */
  function approachOf(row, band, entry) {
    const here = distanceToBand(row, band);
    /* NO APPROACH WITHOUT AN EXACT DISTANCE. A row carrying only the rounded
       integer score has a distance quantised to whole points; differencing two
       of those would report a name as motionless whenever its move was smaller
       than a point, which on this page is almost every move. */
    if (here === null || here.exact === null) return null;
    if (!entry || !entry.d1) return null;

    const qv = isNum(entry.d1.qv);
    const gap = isNum(entry.d1.gap);
    const resid = isNum(row && row.resid);
    /* BOTH ENDS OR NEITHER, the same rule the archive itself applies: qv is
       absent when either observation lacked a residual, and a difference
       taken against an absent one is a different quantity rather than a
       smaller number. */
    if (qv === null || resid === null || gap === null || gap < 1) return null;

    const b = isNum(band);
    if (b === null) return null;

    const before = 100 * Math.tanh((resid - qv / 1e4) / SCORE_SCALE);
    const beforeDist = Math.max(0, b - Math.abs(before));
    /* Negated so positive reads as "closer". */
    const moved = beforeDist - here.value;
    const per = moved / gap;

    /* THE PROJECTION, AND THE FOUR CASES WHERE IT IS WITHHELD.
       It is one distance over one rate, which is arithmetic a reader could do
       and is offered so they do not have to. It is withheld when doing it
       would dress a single observation as a trend:

         - the name is not approaching (per <= 0): there is nothing to project
           toward, and an "away from the edge" projection is a number with no
           question behind it;
         - the rate was measured across more than three sessions: a move
           averaged over four or more sessions says nothing about tonight, and
           dividing it by the gap does not make it a nightly rate;
         - the answer exceeds the archive's own window: past about a month the
           projection is longer than the evidence supporting it, and "44
           sessions" reads as a measurement when it is an extrapolation of one
           night;
         - the arithmetic is not finite.

       Every one of those renders as no projection rather than as a large one,
       because a large number in this column would be read as a reading. */
    let sessions = null;
    if (per > 0 && gap <= 3) {
      const n = here.value / per;
      if (Number.isFinite(n) && n <= 21) sessions = n;
    }

    return { now: here.value, before: beforeDist, per, gap, sessions, moved };
  }

  function rowFor(row, band, entry) {
    const tr = document.createElement("tr");

    const th = document.createElement("th");
    th.scope = "row";
    th.className = "fb-tk";
    /* THE SAME DESTINATION THE BOARD ROWS USE, so a watched name opens exactly
       the reader a published name would. It used to be `?t=SYM` — this page's
       own address, which the retired card dialog read to open a modal over
       this table. Nothing reads that parameter here now, so the href names the
       reader outright; worker.js 302s the old shape to this exact URL.

       AND EVERY ROW HERE IS LINKED, WHICH LOOKS LIKE THE RULE THE BOARDS KEEP
       AND IS NOT. On the boards a row is linked only when the run built a card
       for it, because there a flat row is the honest form: cardedness varies
       between rows and `dp` says which is which. On this page it does not vary
       — it is false for every row, BY CONSTRUCTION, and the construction is
       nameable rather than observed. The dead band decides publication: a name
       outside it goes on a board, a name inside it goes on this list. Cards go
       to `deepNames(published)`, which reads `published.long` and
       `published.short` and nothing else. A watch name is by definition not in
       `published`, so it cannot be in the deep set, so it cannot have a card —
       whatever the run's budget or the state of the market. Measured for
       agreement rather than for proof: p-board-watch.json holds SYN243, SYN250
       and SYN200, and none of the 50 emitted p-card-*.json files carries any
       of them.

       SO THE LINK IS NOT AN OFFER OF A CARD. It is the offer of the funnel
       answer, which is the one thing a reader of this table wants and this
       table cannot say: the reader names the ticker, states that no card was
       built, says which stage the name stopped at, and carries the switcher to
       every name that does have one. Withholding the link the way a board
       withholds it would leave a watched name with nowhere at all to go, which
       is worse than a page that explains itself. tests/flows-watch-render.mjs
       pins that destination, so the day it becomes an error page rather than
       an explanation this reasoning fails with it. */
    const link = document.createElement("a");
    link.href = "/flows/ticker/?t=" + encodeURIComponent(String(row.t || "")) +
      "&s=signal&from=watch";
    link.textContent = String(row.t || DASH);
    th.append(link);
    tr.append(th);

    tr.append(cell(fixed(row.px, 2), "c-num"));

    const s = isNum(row.s);
    tr.append(cell(signed(s, 0), "c-num " + (s === null ? "" : s < 0 ? "fb-neg" : "fb-pos")));

    /* THE COLUMN THIS PAGE EXISTS FOR. Zero means the next tick of the score
       publishes this name; a large number means the cross-section could not
       separate it from noise and is not close to doing so. */
    const d = distanceToBand(row, band);
    /* Two decimals where the exact score is available, none where only the
       rounded integer is: printing "16.00" from an integer would claim a
       precision the payload does not carry. */
    const dCell = cell(
      d === null ? DASH
        : d.exact !== null ? d.value.toFixed(2) : d.value.toFixed(0),
      "c-num c-toband");

    /* THE DIRECTION OF TRAVEL, IN THE SAME CELL AS THE DISTANCE.

       It belongs here rather than in columns of its own, and not only for
       want of room. "Four tenths from the edge, closing eight hundredths a
       session, about five sessions at that rate" is ONE sentence about one
       thing; split across three headed columns it becomes three numbers a
       reader has to reassemble, and the reassembly is the whole reading.

       The table's column count is also fixed by the head, which is emitted
       from the page template — a renderer that appends a tenth cell to a
       nine-column head produces a table whose every heading is off by one
       from the row beneath it, silently, with no overflow to give it away. */
    const ap = approachOf(row, band, entry);
    if (ap !== null) {
      const line = document.createElement("span");
      line.className = ap.per > 0 ? "c-approach is-closing"
        : ap.per < 0 ? "c-approach is-widening" : "c-approach";
      /* THE ARROW IS THE SIGN, and the signed number repeats it. Two channels,
         neither of them hue, so the direction survives greyscale and a
         monochrome printout. */
      const arrow = ap.per > 0 ? "\u25B8" : ap.per < 0 ? "\u25C2" : "\u00B7";
      line.textContent = arrow + " " + signed(ap.per, 2) +
        (ap.sessions === null ? ""
          : "  \u2248" + (ap.sessions < 1 ? "<1" : Math.round(ap.sessions)) + "s");
      /* THE GAP TRAVELS WITH THE RATE. Half a point over one session and the
         same half point over three are the same number here only because the
         second was divided by three, and a reader who is not told cannot
         check it. */
      line.title =
        (ap.moved >= 0 ? "Closer to the edge by " : "Further from the edge by ") +
        Math.abs(ap.moved).toFixed(2) + " score points across " + ap.gap +
        (ap.gap === 1 ? " session" : " sessions, shown here divided by " + ap.gap) +
        ", measured between the two sessions this name was actually scored." +
        (ap.sessions === null ? ""
          : " At that rate it reaches the edge in about " +
            (ap.sessions < 1 ? "less than one session" : Math.round(ap.sessions) + " sessions") +
            " — " + ap.now.toFixed(2) + " points divided by " + ap.per.toFixed(2) +
            " a session. That is an extrapolation of one observation and not a " +
            "forecast; it is withheld entirely where the rate was measured across " +
            "more than three sessions, or where the answer runs past the archive's " +
            "own window.");
      dCell.append(document.createElement("br"), line);
    }
    /* THE THRESHOLD IS DERIVED FROM THE EDGE, NOT A CONSTANT. "Within three"
       was three SCORE units against a ±20 band — a seventh of the way in.
       Hard-coded against a band of 1 it selected every row. A fifth of the
       distance from the centre to the edge keeps the same meaning at any
       band width, and keeps the mark rare enough to mean something. */
    if (d !== null && d.edge > 0 && d.value <= d.edge * 0.2) {
      dCell.className = "c-num c-toband is-near";
      dCell.title = "Within a fifth of the band's half-width of the edge.";
    }
    if (d !== null && d.exact !== null) {
      /* Where the column's precision comes from, on the row itself: the score
         beside it is rounded and would place this name at the edge exactly. */
      dCell.title = (dCell.title ? dCell.title + " " : "") +
        "Score points, computed from the unrounded score (" + d.exact.toFixed(2) +
        ") rather than the integer shown beside it.";
    }
    tr.append(dCell);

    tr.append(cell(isNum(row.cnv) === null ? DASH : String(Math.round(row.cnv)), "c-num"));

    /* SURPRISE IS A SIGNED TILT, NOT A VOLUME MULTIPLE. The pipeline
       publishes log((callSurprise + 0.1) / (putSurprise + 0.1)) — each side's
       surprise being its volume over the name's OWN thirty-day norm — so zero
       means a balanced day for this name and the sign says which side is
       doing the surprising. Relative to the name, not the market: a big tilt
       on a name that trades two hundred contracts reads identically to one on
       SPY, so it is marked when large but never dressed as significance. */
    const sur = isNum(row.surpriseTilt);
    const surCell = cell(signed(sur, 2), "c-num");
    if (sur !== null && Math.abs(sur) >= Math.log(3)) {
      surCell.className = "c-num is-surprise";
      surCell.title = "One side's volume surprise is at least three times the " +
        "other's, against this name's own thirty-day norms. A tilt of its own " +
        "tape, which says nothing about the size of that tape.";
    }
    tr.append(surCell);

    tr.append(cell(multiple(row.relVolume), "c-num"));
    tr.append(cell(fixed(row.putCallRatio, 2), "c-num"));
    tr.append(cell(pct(row.w52, 0), "c-num"));

    /* THE NAME THAT WAS ACTIONABLE YESTERDAY AND IS NOT NOW. On this page a
       faded crossing is not a small event: the row is here BECAUSE it fell
       in, and a reader scanning for what is about to leave the band should
       not have to work out that one of these rows just arrived from outside
       it. The mark is a glyph and a title, so it survives greyscale. */
    if (entry && entry.d1 && entry.d1.cross === "faded") {
      const mark = document.createElement("span");
      mark.className = "c-faded";
      mark.textContent = " \u25BE";
      mark.title = "This name was outside the band when it was last scored and " +
        "is inside it now. It did not approach the edge; it came back through it.";
      th.append(mark);
    }

    return tr;
  }

  function showMessage(text) {
    body.textContent = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = COLUMNS;
    td.className = "flows-empty";
    td.textContent = text;
    tr.append(td);
    body.append(tr);
    wrap.hidden = false;
  }

  function get(url, { stamp = false } = {}) {
    return fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then((response) => {
      if (response.status === 401) { location.replace("/flows/"); return null; }
      if (!response.ok) throw new Error("HTTP " + response.status);
      const updatedAt = stamp ? Number(response.headers.get("X-Payload-Updated")) || null : null;
      return response.json().then((payload) => {
        if (stamp && payload && typeof payload === "object") payload.__updatedAt = updatedAt;
        return payload;
      });
    });
  }

  Promise.all([
    get("/api/flows/board?side=watch", { stamp: true }),
    /* THE SECOND READ, AND WHY IT IS WORTH ONE.
       The watch board carries each name's residual for THIS session and
       nothing about any other. The pooled trace carries the residual CHANGE
       since the session each name was last scored — which is the only place
       the second half of this page's question is answerable. It is a cached
       key the reader has almost certainly already fetched on another route,
       and its failure is caught separately below so a slow or missing trace
       costs this page its approach column and nothing else. */
    get("/api/flows/scoretrack").catch(() => null),
  ]).then(([payload, track]) => {
    if (!payload) return;

    /* THE TRACE, KEYED BY NAME. Built once rather than searched per row: the
       trace runs to several hundred names and the board to eighty, and a
       linear scan per row is the shape that turns a rendering into a
       measurable pause on the widest boards. */
    const trackBy = new Map();
    if (track && Array.isArray(track.names)) {
      for (const n of track.names) if (n && n.t) trackBy.set(String(n.t).toUpperCase(), n);
    }
    const entryFor = (r) => trackBy.get(String((r && r.t) || "").toUpperCase()) || null;

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const band = payload.deadBand;

    /* The badge stays hidden until there is something measured to count. A
       pending payload has rows.length 0 by construction, and "0" in the rail
       is a confident reading of a store that has simply never been written. */
    const slot = document.querySelector('[data-rail-count="watch"]');
    if (slot && rows.length) { slot.textContent = String(rows.length); slot.hidden = false; }

    if (payload.status === "pending" || !rows.length) {
      /* AN EMPTY WATCH LIST IS ALMOST ALWAYS A MISSING PUBLISH, not a quiet
         session — the band is where most of the universe lives, so a session
         with nothing inside it would be extraordinary. Saying "no data yet"
         where the truth is "the pipeline has not run since this shipped" is
         the distinction the reader needs. */
      showMessage(
        payload.status === "pending"
          ? "No watch list has been published yet. This list is built by the " +
            "pipeline, which runs on weekday mornings — it will appear after " +
            "the first run following this deploy."
          : "No name was scored inside the band this session, which is unusual " +
            "enough to be worth treating as a publishing fault rather than a reading.",
      );
      statusEl.textContent = "Nothing to watch.";
      return;
    }

    /* Sorted by proximity to the edge. NOT by score: the two sides of the band
       are equidistant just inside either edge and a score sort would put every mildly bullish
       name above every strongly bearish one, which is an ordering about sign
       rather than about how close anything came. */
    rows.sort((a, b) => {
      /* CLOSING FIRST, THEN CLOSEST. A name three tenths from the edge and
         walking toward it is a more urgent row than one two tenths away and
         drifting off, and a pure distance sort cannot say so — which was the
         whole of this page's blind spot. The projection is the key rather
         than the raw rate, because it already divides the distance by the
         rate and is therefore the answer to the question being ranked.

         The distance sort survives underneath as the tiebreak and as the
         ordering for every row with no trace, so a page whose trace failed to
         load is exactly the page that shipped before this — never a page
         ordered by nothing, which is what Array.prototype.sort's stability
         quietly produced the last time this comparator ran out of key. */
      const pa = approachOf(a, band, entryFor(a));
      const pb = approachOf(b, band, entryFor(b));
      const ea = pa && pa.sessions !== null ? pa.sessions : Infinity;
      const eb = pb && pb.sessions !== null ? pb.sessions : Infinity;
      if (ea !== eb) return ea - eb;

      const x = distanceToBand(a, band), y = distanceToBand(b, band);
      if (x === null && y === null) return 0;
      if (x === null) return 1;                 // unmeasured never wins a ranking
      if (y === null) return -1;
      /* Measured on the residual now, so this sort has something to sort by:
         on the score every row in the band is 0 and the ordering fell through
         to Array.prototype.sort's stability — the input order, wearing the
         authority of a ranking. */
      return x.value - y.value;
    });

    const frag = document.createDocumentFragment();
    for (const r of rows) frag.append(rowFor(r, band, entryFor(r)));
    body.append(frag);
    wrap.hidden = false;

    const near = rows.filter((r) => {
      const d = distanceToBand(r, band);
      /* The same edge-relative threshold the row highlight uses, from one
         place, so the sentence and the marks cannot disagree. Against a band
         of 1 the old absolute "<= 3" was true of every row, and the status
         line reported that tautology as a finding. */
      return d !== null && d.edge > 0 && d.value <= d.edge * 0.2;
    }).length;

    /* THE COUNT AND ITS DENOMINATOR STAY TOGETHER. Split across a separator
       they read as two facts — "10 inside the band … of 60 scored" trails off
       and the reader has to reassemble it. */
    const scored = isNum(payload.scored);
    const parts = [
      rows.length + (scored === null ? "" : " of " + scored + " scored") +
      " inside the ±" + (band ?? "") + " band",
    ];
    if (payload.sessionDate) parts.push("session " + payload.sessionDate);
    /* THE SENTENCE MATCHED A THRESHOLD THAT NO LONGER EXISTS. "Within three of
       the edge" was three SCORE units against a ±20 band; the mark it
       describes has been edge-relative for some time — a fifth of the band's
       half-width — and the prose was never moved with it. Against a band of 1
       it claimed a distance of three on rows that are at most one from the
       centre, which is not merely stale, it is arithmetically impossible on
       the numbers printed beside it. The threshold is stated as what it is. */
    if (near) parts.push(near + " within a fifth of the band's half-width of the edge");

    /* WHAT IS WALKING TOWARD THE EDGE, counted against what could be asked.
       A page that shows a projection on six rows owes the reader the other
       denominator too: how many names had a comparable prior session at all.
       Without it, "six approaching" is indistinguishable from "six approaching
       and seventy-four we could not measure". */
    let comparable = 0, closing = 0, projected = 0, faded = 0;
    for (const r of rows) {
      const e = entryFor(r);
      if (e && e.d1 && e.d1.cross === "faded") faded++;
      const ap = approachOf(r, band, e);
      if (ap === null) continue;
      comparable++;
      if (ap.per > 0) closing++;
      if (ap.sessions !== null) projected++;
    }
    if (comparable) {
      parts.push(
        closing + " of " + comparable + " measurable moved toward the edge" +
        (projected ? ", " + projected + " within a projectable distance" : ""));
    } else if (track) {
      /* MEASURED EMPTINESS, NOT AN ABSENCE. The trace loaded and no row in it
         had a second scored session to difference against — which on a young
         archive is the ordinary state and is a different sentence from the
         trace having failed to load. */
      parts.push("no name here has a prior scored session to measure against yet");
    } else {
      parts.push("the score trace did not load, so no direction of travel is shown");
    }
    if (faded) {
      parts.push(faded + (faded === 1 ? " name" : " names") + " came back through the edge");
    }
    /* THE LIST CAN BE CAPPED BELOW THE BAND COUNT, and a page that showed 40
       rows while claiming 48 would be lying by omission about the other eight. */
    const inBand = isNum(payload.neutral);
    if (inBand !== null && inBand > rows.length) {
      parts.push("showing the " + rows.length + " closest of " + inBand);
    }
    statusEl.textContent = parts.join(" · ") + ".";

    /* THE SAME STALENESS RULE THE BOARD USES. A watch list from a previous
       session beside a rail that says "today" is the quiet failure this
       whole section is built to refuse. */
    if (staleEl && payload.__updatedAt) {
      const ageHours = (Date.now() - payload.__updatedAt) / 3600000;
      if (ageHours > 30) {
        staleEl.hidden = false;
        staleEl.textContent = "This list was last written " +
          Math.round(ageHours / 24) + " day(s) ago. The pipeline has not " +
          "published since, so these are not this session's names.";
      }
    }
  }).catch(() => {
    statusEl.textContent = "The watch list could not be loaded. Refresh to try again.";
  });
})();
