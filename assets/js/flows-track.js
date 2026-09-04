/* =============================================================
   flows-track.js — the score, session by session.

   Renders /api/flows/scoretrack: every name's daily composite —
   the SAME number the board printed that morning, no arithmetic
   added — traced across the sessions the archive walk could
   reconstruct. The boards are a ranking's two tails; this page is
   the whole distribution over time.

   ============================================================
   THE ONE READING THIS PAGE MUST NOT PERMIT: A GAP IS NOT A ZERO.

   A null in a series means the name WAS NOT SCORED that session —
   out of the screener, under the liquidity floor, inside the
   earnings gate, or not selected for enrichment. Zero is a score
   this pipeline assigns (three names in the current payload carry
   exactly that), so the two must not share a pixel: a measurement
   draws a mark — a zero draws its mark ON the zero rule — and an
   absence draws nothing at all. The line is broken across a gap,
   never interpolated, because a segment through an unmeasured
   session is a claim nobody made.

   ============================================================
   TWO KINDS OF SESSION, MARKED, NOT AVERAGED.

   Sessions with source "boards" predate the dated scores key and
   were reconstructed from the archived boards, which carry only the
   names that made a board that day — those columns are GENUINELY
   SPARSER, a fact about the archive and not about the market. They
   are hatched in the axis, washed in every trace, and counted in
   words in the note. Likewise the selection epoch: scores on either
   side of it come from different pools under different rules, so
   the boundary is drawn where it falls inside the window and named
   in words when it does not.

   ============================================================
   AND THE QUESTION THIS PAGE COULD NOT BE ASKED: WHICH NAME MOVED.

   For its whole life the page offered three orderings and all
   three ranked the same snapshot column. The default ranked on
   |last| — the newest score ANYWHERE in the window — so a name
   last scored thirty sessions ago at +45 sat above a name scored
   that morning at +30, under a header reading "the most recent
   published score in the window" that every reader took to mean
   yesterday. Nothing on the page stated the age of a reading. And
   the key coerced the absence on the way past: Math.abs(b.last ?? 0)
   does not sort a missing score last, it sorts it into the middle.

   The change layer is now READ, never re-derived. `lastAt` dates
   every row and marks the stale ones by how many sessions they
   are behind; `d1` carries the move WITH THE SPAN IT COVERS, so a
   five-session move cannot masquerade as an overnight one; its
   `cross` names the crossing, which is the early-warning event and
   outranks any magnitude; `run` says whether the opinion is new or
   old; `ext` says where the window's own edges are. The page opens
   on the latest session's score with the names that were not
   scored in it sorted LAST, and the paragraph above the table
   states the population every count came out of.

   ============================================================
   THE DRAWING CONTRACT, same as every chart on this product: one
   viewBox unit is one CSS pixel, measured from a VISIBLE host (the
   panel is unhidden before the measurement — flows-events measured
   a hidden panel, silently took its fallback on every paint, and
   shipped 1.71 px per unit), axis type carries explicit px sizes,
   and the whole thing is redrawn — not scaled — on resize.

   The strip and axis primitives come from window.FlowsUI
   (assets/js/flows-ui.js), loaded before this file.
   ============================================================= */
(() => {
  "use strict";

  const UI = window.FlowsUI;

  const statusEl = document.getElementById("stStatus");
  const staleEl = document.getElementById("stStale");
  const panelEl = document.getElementById("stTrackPanel");
  const trackHost = document.getElementById("stTrack");
  const trackNote = document.getElementById("stTrackNote");
  const basisPanel = document.getElementById("stBasisPanel");
  const basisHost = document.getElementById("stBasis");
  const footEl = document.getElementById("stFoot");
  if (!statusEl || !trackHost) return;

  if (!UI) {
    /* The UI module rides in a separate file; if it failed to arrive this
       page can draw nothing, and saying so beats a silent blank. */
    statusEl.textContent = "This page's UI module (flows-ui.js) did not load, so " +
      "nothing can be drawn. Refresh to try again.";
    return;
  }

  const MINUS = UI.MINUS;      // U+2212, never a hyphen. Never inside an ISO date.
  const DASH = UI.DASH;
  const MID = UI.MID;
  const isNum = UI.isNum;
  const el = UI.el;
  const svgEl = UI.svgEl;
  const fmtSigned = UI.fmtSigned;
  const fmtInt = UI.fmtInt;

  const plural = (n, one, many) => (n === 1 ? one : many);

  /* Rows drawn before the reader has to ask for more. Hundreds of names
     each carrying a strip is a page a phone can build but should not have
     to build unasked; sixty covers every board name with headroom, and the
     button below the table appends the rest in the same order. */
  const PAGE = 60;

  /* The ordering the page opens on is CHOSEN FROM THE PAYLOAD, in prepare():
     "now" whenever the names carry `lastAt`, because that is the only field
     that can tell the latest session's score from the newest score anywhere
     in the window. "abs" is the fallback for a payload published before the
     change layer, and is what the page used to open on unconditionally. */
  const state = { q: "", sort: "abs", shown: PAGE };
  let ctx = null;         // the prepared payload the renderers draw from
  let drawnW = 0;         // strip width at last paint, for the resize repaint

  // Scaffold nodes, built once so typing in the filter never rebuilds the input.
  let built = false;
  let capEl = null, bodyEl = null, axisHost = null, moreBtn = null;
  let changeEl = null;    // the "what moved, out of how many" paragraph
  let stripHead = null;   // the strip column's <th>, measured for the drawing
  /* WHICH OPTIONAL COLUMNS THIS PAYLOAD CAN FILL. A column of em dashes is
     not honesty, it is furniture: a payload published before the change layer
     draws the four columns it can answer and no more, and the paragraph above
     the table says which fields were missing. */
  let colSet = { move: false, run: false, asOf: false };

  /* ---------- the fetch helper -------------------------------------

     THE SAME get() EVERY FLOWS PAGE USES, verbatim in behavior: 401 walks
     back to the door; X-Payload-Updated is stamped onto the payload as
     __updatedAt — a client-side annotation, not a claim the pipeline
     writes it — so the staleness note can date the blob without the
     Worker having to parse it. */
  function get(path) {
    return fetch(path, {
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

  /* ---------- preparing the payload ------------------------------- */

  /**
   * One shared scale for every strip on the page. A per-row domain would
   * redraw each name against its own extremes, so a name drifting ±2 and
   * a name swinging ±40 would wear the same picture — the exact rescaling
   * lie the track exists to avoid. Zero and the dead band are always
   * inside it, because the zero rule is what position is measured from.
   */
  function scoreDomain(rows, deadBand) {
    let lo = 0, hi = 0;
    for (const r of rows) {
      for (const v of r.s) {
        const n = isNum(v);
        if (n === null) continue;
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }
    if (deadBand !== null) { lo = Math.min(lo, -deadBand); hi = Math.max(hi, deadBand); }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    return { lo, hi };
  }

  /* THE THREE CROSSING WORDS THE PAYLOAD PUBLISHES, and the only three this
     page prints. An unrecognised value is dropped rather than shown raw: a
     word in the Event column reads as a category this product defines, and it
     defines exactly these three. The rank is the reading order — a name that
     became actionable outranks one that changed sides, which outranks one
     that stopped being actionable. */
  const CROSS_RANK = { cleared: 0, flipped: 1, faded: 2 };
  const CROSS_SAID = {
    cleared: "Inside the dead band at the previous scored session and outside it " +
      "now: the name became actionable this session. This is the early warning; " +
      "everything the change layer reports other than a crossing is drift.",
    faded: "Outside the dead band and inside it now — the exit signal, and exactly " +
      "as load-bearing as the entry.",
    flipped: "Outside the band at both ends with opposite signs: the name did not " +
      "weaken and re-strengthen, it changed sides without resting in the middle.",
  };

  const sessionsSaid = (n) => n + plural(n, " session", " sessions");

  /**
   * The published move, or null. BOTH HALVES ARE REQUIRED.
   *
   * `v` without `gap` is the exact reading this layer was built to replace: a
   * number that is the headline of the session when it happened overnight and
   * is noise when it happened across three weeks the name spent off the board,
   * with the identical integer printed either way. A move whose span this
   * payload does not state is therefore not drawn as a move at all.
   */
  function readMove(raw) {
    if (!raw || typeof raw !== "object") return null;
    const v = isNum(raw.v), gap = isNum(raw.gap);
    if (v === null || gap === null || gap < 1) return null;
    return {
      v, gap,
      /* The same move in residual units, which do not saturate. Absent
         wherever either end carried no residual — an absence, never a zero. */
      qv: isNum(raw.qv),
      cross: Object.prototype.hasOwnProperty.call(CROSS_RANK, raw.cross) ? raw.cross : null,
    };
  }

  /** The window extremes with the session INDICES they happened on. */
  function readExt(raw) {
    if (!raw || typeof raw !== "object") return null;
    const hi = isNum(raw.hi), lo = isNum(raw.lo);
    if (hi === null && lo === null) return null;
    return { hi, lo, hiAt: isNum(raw.hiAt), loAt: isNum(raw.loAt) };
  }

  /**
   * How far a name's newest score sits from the nearer end of its own window,
   * in score points: a subtraction of two published numbers already in one
   * unit, not a new measurement. Zero means the newest score IS the extreme,
   * which is the strongest sentence this archive can produce about a name.
   */
  function nearestExtreme(last, ext) {
    if (last === null || !ext) return { gap: null, end: null };
    const toHi = ext.hi === null ? null : ext.hi - last;
    const toLo = ext.lo === null ? null : last - ext.lo;
    if (toHi === null && toLo === null) return { gap: null, end: null };
    if (toHi === null) return { gap: toLo, end: "low" };
    if (toLo === null) return { gap: toHi, end: "high" };
    return toHi <= toLo ? { gap: toHi, end: "high" } : { gap: toLo, end: "low" };
  }

  function prepare(payload) {
    const sessions = (Array.isArray(payload.sessions) ? payload.sessions : [])
      .map((s) => ({
        d: s && typeof s.d === "string" ? s.d : "",
        source: s && s.source === "scores" ? "scores" : "boards",
        preEpoch: !!(s && s.preEpoch),
      }));

    /* THE CHANGE LAYER IS READ, NEVER RE-DERIVED. Every field below is
       published: `lastAt` is the index of the name's newest measured score,
       `d1` is the move with the span it covers, `run` is how long the current
       sign has held, `ext` is the window's extremes with their session
       indices. Subtracting two cells of `s` in the browser would produce a
       number that looks identical and cannot say whether it covers one
       session or twenty — which is the whole reason the layer exists. */
    const lastIndex = sessions.length - 1;
    const rows = [];
    for (const r of (Array.isArray(payload.names) ? payload.names : [])) {
      if (!r || typeof r.t !== "string" || !r.t) continue;
      const last = isNum(r.last);
      const lastAt = isNum(r.lastAt);
      const ext = readExt(r.ext);
      const near = nearestExtreme(last, ext);
      rows.push({
        t: r.t,
        s: Array.isArray(r.s) ? r.s : [],
        /* `n` IS NO LONGER COERCED TO ZERO. It arrived here as
           `isNum(r.n) ?? 0`, which prints "0" in the sample-size column
           beside a full strip of marks the moment the publisher stops
           sending the field — a confident zero in the one number on this
           page that may never be guessed, and a sort key that ranked an
           unstated count below a measured one of the same value. */
        n: isNum(r.n),
        last,
        lastAt,
        /* HOW OLD THIS ROW'S READING IS, in sessions, taken from the
           published index rather than from a scan of the series. null is a
           third answer — this payload stated no index — and it is drawn as
           neither fresh nor stale. */
        staleBy: lastAt === null || lastIndex < 0 ? null : lastIndex - lastAt,
        /* THE SCORE AT THE LATEST SESSION, or null because the name was not
           scored in it. This is what the default ordering ranks on, and the
           reason it had to exist: `last` is the newest score ANYWHERE in the
           window, so ranking on `last` put a name last scored thirty sessions
           ago at +45 above a name scored this morning at +30, under a column
           header every reader took to mean "yesterday". */
        now: lastAt !== null && lastAt === lastIndex ? last : null,
        d1: readMove(r.d1),
        run: isNum(r.run),
        ext,
        extGap: near.gap,
        extEnd: near.end,
      });
    }

    const deadBand = isNum(payload.deadBand);
    const boardsIdx = [];
    sessions.forEach((s, i) => { if (s.source === "boards") boardsIdx.push(i); });

    /* THE EPOCH BOUNDARY IS READ OFF THE PUBLISHED preEpoch FLAGS, never
       recomputed from the epoch date — what is drawn is what was
       published. It exists only when the window actually straddles it. */
    const pre = sessions.map((s) => s.preEpoch);
    let boundary = null;
    if (pre.some(Boolean) && pre.some((x) => !x)) {
      const i = pre.findIndex((x) => !x);
      if (i > 0) boundary = i;
    }

    return {
      sessions, rows, deadBand,
      domain: scoreDomain(rows, deadBand),
      epoch: typeof payload.epoch === "string" ? payload.epoch : null,
      /* THE DENOMINATOR, which no renderer could count for itself: the change
         block is computed over the whole pool BEFORE the payload's size cap
         sheds rows, so "84 names moved" can be printed with the population it
         came out of rather than with the number of rows that fit on the wire. */
      change: (payload.change && typeof payload.change === "object") ? payload.change : null,
      shedBy: typeof payload.shedBy === "string" ? payload.shedBy : null,
      shed: isNum(payload.namesShed),
      notes: (payload.notes && typeof payload.notes === "object") ? payload.notes : {},
      /* WHICH ORDERINGS THIS PAYLOAD CAN ACTUALLY ANSWER. An ordering offered
         over a field nobody published sorts every row into one bucket and
         tells the reader nothing, which is worse than not offering it: the
         reader concludes the pool is flat. */
      has: {
        /* `now` — some row states WHICH session it was scored on, so the
           As-of column has something to date. */
        now: rows.some((r) => r.lastAt !== null),
        /* `nowScore` — some row was scored in the LATEST session, so the
           default ordering has something to rank. These came apart on a
           payload where every carried name was stale: `lastAt` was published
           on all of them, so the page opened on an ordering in which every
           row's key was null, and the whole list fell through to the
           tie-break under a caption promising "strongest score in the latest
           session first". That is precisely the failure the comment above
           this block describes — an ordering offered over a field nobody can
           answer sorts every row into one bucket — and the page was
           committing it against its own rule. The As-of column still draws
           in that state, and is at its most useful there. */
        nowScore: rows.some((r) => r.now !== null),
        move: rows.some((r) => r.d1 !== null),
        run: rows.some((r) => r.run !== null),
        ext: rows.some((r) => r.extGap !== null),
      },
      boardsIdx, boundary,
      allPre: sessions.length > 0 && pre.every(Boolean),
      allPost: sessions.length > 0 && pre.every((x) => !x),
      markers: boardsIdx.map((i) => ({ i, cls: "st-wash" })),
      rules: boundary === null ? [] : [{ at: boundary, cls: "st-erule" }],
    };
  }

  /* ---------- ordering and filtering ------------------------------ */

  /* EVERY ORDERING SENDS ITS OWN ABSENCES TO THE BOTTOM, and none of them
     coerces a missing value to reach them. Three of these read
     `Math.abs(b.last ?? 0)`, and a `?? 0` inside a comparator is the
     confident zero in the one place nobody looks: it does not sort an
     absence last, it sorts it into the MIDDLE of a signed column and to the
     TOP of a magnitude one, so a name carrying no published score outranked
     a name measured at ±3. The absence test comes first, before any
     arithmetic touches the value. */
  function descNum(x, y) {
    if (x === null) return y === null ? 0 : 1;
    if (y === null) return -1;
    return y - x;
  }
  function ascNum(x, y) {
    if (x === null) return y === null ? 0 : 1;
    if (y === null) return -1;
    return x - y;
  }
  const mag = (v) => (v === null ? null : Math.abs(v));
  const moveMag = (r) => (r.d1 === null ? null : Math.abs(r.d1.v));
  const crossRank = (r) => (r.d1 && r.d1.cross !== null ? CROSS_RANK[r.d1.cross] : null);
  const byTicker = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);

  /* Ties break on the measured count and then the ticker, so every ordering
     is total: a repaint at a new width cannot reshuffle rows the reader was
     part-way through. */
  const tie = (a, b) => descNum(a.n, b.n) || byTicker(a, b);

  const SORTS = {
    /* THE DEFAULT, AND THE ONE THIS PAGE OWED ITS READER FROM THE START.
       |score at the LATEST session| descending — the question a page headed
       with today's date is asked. A name not scored in the latest session
       has no value here at all, so it sorts last instead of being promoted
       by a reading that is weeks old. */
    now: (a, b) => descNum(mag(a.now), mag(b.now)) || tie(a, b),
    /* The old default, kept and renamed to what it actually is: the newest
       score ANYWHERE in the window, however long ago it was measured. */
    abs: (a, b) => descNum(mag(a.last), mag(b.last)) || tie(a, b),
    last: (a, b) => descNum(a.last, b.last) || tie(a, b),
    /* WHAT MOVED. Magnitude of the published move, with its span printed in
       the row beside it, because a five-session move must not be able to
       masquerade as an overnight one by sorting next to it. */
    move: (a, b) => descNum(moveMag(a), moveMag(b)) || tie(a, b),
    /* A CROSSING OUTRANKS A MAGNITUDE, whatever the sizes. A +56 drift and a
       +8 crossing are not two sizes of one thing: the second is a change of
       category — the name became actionable, or stopped being — and the
       first is the distribution breathing. */
    cross: (a, b) => ascNum(crossRank(a), crossRank(b))
      || descNum(moveMag(a), moveMag(b)) || tie(a, b),
    /* How old the opinion is: one session is a new one, thirty is an old one. */
    run: (a, b) => descNum(a.run, b.run) || tie(a, b),
    /* Closest to its own window high or low first, so a name sitting AT its
       42-session extreme is the first row rather than one a reader has to
       find by eye across five hundred strips. */
    ext: (a, b) => ascNum(a.extGap, b.extGap) || descNum(mag(a.last), mag(b.last)) || tie(a, b),
    n: (a, b) => descNum(a.n, b.n) || descNum(mag(a.last), mag(b.last)) || byTicker(a, b),
  };

  /* The caption says the ordering in words, so a reader who never opens the
     select still knows what the top of the list means. */
  const SORT_WORDS = {
    now: "strongest score in the latest session first, names not scored in it last",
    abs: "strongest last measured score first, however long ago it was measured",
    last: "last measured score, high to low",
    move: "biggest move since each name's previous scored session, either direction",
    cross: "names that crossed the dead band first — cleared, then flipped, then faded",
    run: "longest unbroken run on one sign first",
    ext: "nearest its own window high or low first",
    n: "most sessions measured first",
  };

  function filterSort() {
    const q = state.q.trim().toUpperCase();
    const list = q
      ? ctx.rows.filter((r) => r.t.toUpperCase().indexOf(q) !== -1)
      : ctx.rows.slice();
    list.sort(SORTS[state.sort] || SORTS.abs);
    return list;
  }

  /* ---------- the scaffold: controls, table, axis header ----------

     BUILT ONCE. Re-rendering rebuilds only tbody rows and the axis svg;
     rebuilding the search input on every keystroke would throw away the
     reader's focus mid-word.

     THE TABLE LAYOUT IS FIXED, and that is a drawing decision, not a
     styling one: with table-layout:fixed the strip column's width is
     settled by the header row alone, so it can be measured BEFORE any row
     exists and cannot be re-negotiated by content afterwards. Every strip
     svg is emitted at that exact measured width — one viewBox unit, one
     CSS pixel — and the axis in the header shares the same geometry
     function, so a mark sits under its date by construction. */

  /* The visible column count, which the empty row must span exactly. It was
     a literal 4 in one place and the header list in another; the two are now
     one function so a column added to one cannot be missing from the other. */
  function columnCount() {
    return 4 + (colSet.move ? 2 : 0) + (colSet.asOf ? 1 : 0) + (colSet.run ? 1 : 0);
  }

  function buildScaffold() {
    if (built) return;
    built = true;
    colSet = { move: ctx.has.move, run: ctx.has.run, asOf: ctx.has.now };

    const controls = el("div", "st-controls");
    const search = UI.searchBox({
      label: "Filter", placeholder: "Ticker", prefix: "st", id: "stQ",
      onInput: (v) => { state.q = v; state.shown = PAGE; renderBody(); },
    });
    /* THE ORDERINGS ARE OFFERED ONLY WHERE THE PAYLOAD CAN ANSWER THEM.
       Before this the select held three orderings and all three ranked the
       same snapshot column, so the page could be asked "which name is
       biggest" three ways and "which name moved" no way at all — on a page
       whose own lede promises a name drifting toward a board is visible
       before the morning it arrives. */
    const options = [];
    if (ctx.has.nowScore) {
      options.push({ value: "now", label: "Latest session, strongest first", selected: true });
    }
    options.push({ value: "abs", label: "Last measured score, strongest", selected: !ctx.has.nowScore });
    options.push({ value: "last", label: "Last measured score, high to low" });
    if (ctx.has.move) {
      options.push({ value: "move", label: "Biggest move, with its span" });
      options.push({ value: "cross", label: "Crossed the dead band first" });
    }
    if (ctx.has.run) options.push({ value: "run", label: "Longest run on one sign" });
    if (ctx.has.ext) options.push({ value: "ext", label: "Nearest its own window extreme" });
    options.push({ value: "n", label: "Most sessions measured" });

    const sort = UI.sortSelect({
      label: "Order", prefix: "st", id: "stSort",
      options,
      onChange: (v) => { state.sort = v; state.shown = PAGE; renderBody(); },
    });
    controls.append(search.root, sort.root);

    /* The population paragraph sits ABOVE the controls: what moved and out of
       how many is the reading, and the ordering is how the reader searches it. */
    changeEl = el("p", "fc-note st-change");
    trackHost.append(changeEl, controls);

    const wrap = el("div", "st-scroll");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Each name's score across sessions");

    const table = el("table", "st-table");
    capEl = el("caption", "flows-caption");
    table.append(capEl);

    const thead = el("thead");
    const hr = el("tr");
    const hName = el("th", "st-c-name", "Name");
    hName.scope = "col";
    hr.append(hName);
    const hStrip = el("th", "st-c-strip");
    hStrip.scope = "col";
    hStrip.append(el("span", "st-sr", "Score by session, oldest first"));
    axisHost = el("div", "st-axis");
    hStrip.append(axisHost);
    hr.append(hStrip);
    stripHead = hStrip;

    /* THE COLUMN WIDTHS FOR THE CHANGE COLUMNS ARE SET HERE, not in the
       stylesheet, for the same reason the strip's width is: with
       table-layout:fixed the header row alone settles every column, this file
       is what decides which of those columns exist for a given payload, and
       the strip svg is emitted at whatever pixel width is left over. Splitting
       that decision across two files is how a column set and a measurement
       drift apart. The table no longer fits 320px without the wrapper's own
       horizontal scroll — .st-scroll has always had it, and every other table
       on this product relies on it — because a delta with no span beside it
       and a score with no date beside it are the two readings this layer was
       built to stop publishing. */
    const headCell = (cls, label, title, width) => {
      const th = el("th", cls);
      th.scope = "col";
      if (width) th.style.width = width;
      if (title) {
        const abbr = el("abbr", null, label);
        abbr.title = title;
        th.append(abbr);
      } else {
        th.textContent = label;
      }
      return th;
    };

    if (colSet.move) {
      hr.append(headCell("st-c-event", "Event", ctx.notes.crossing ||
        "Whether this name crossed the dead band since its previous scored " +
        "session — cleared it, faded back inside it, or flipped sides. " +
        "Everything else the change layer reports is drift, however large.",
        "7rem"));
      hr.append(headCell("st-c-move", "\u0394 \u00b7 over", ctx.notes.change ||
        "The change in score since this name's PREVIOUS SCORED session, and how " +
        "many sessions that change spans. The two observations need not be " +
        "adjacent: a gap of one is an overnight move, and anything larger " +
        "covers sessions the name was not scored in.",
        "8.6rem"));
    }

    const hLast = el("th", "c-num st-c-last");
    hLast.scope = "col";
    const lastAbbr = el("abbr", null, "Last");
    /* THE HEADER USED TO READ "the most recent published score in the window",
       which every reader took to mean yesterday. It is the most recent score
       ANYWHERE IN THE WINDOW — for a name last scored thirty sessions ago it
       is thirty sessions old — and nothing on the page said so. The As-of
       column beside it now dates every one of them. */
    lastAbbr.title = "The most recent score published for this name anywhere in " +
      "the window, signed — the same composite the board printed on the session " +
      "the As-of column names, which is not necessarily the latest one.";
    hLast.append(lastAbbr);
    hr.append(hLast);

    if (colSet.asOf) {
      hr.append(headCell("st-c-asof", "As of",
        "The session this name was last scored on, taken from the index the " +
        "payload publishes. A row not scored in the latest session says how " +
        "many sessions back its reading is: it is real, and it is not about today.",
        "7.6rem"));
    }
    if (colSet.run) {
      hr.append(headCell("c-num st-c-run", "Run", ctx.notes.run ||
        "Consecutive scored sessions on the current sign. One is a new opinion, " +
        "thirty is an old one, and zero means the newest score is exactly zero, " +
        "which belongs to neither side.",
        "2.8rem"));
    }

    const hN = el("th", "c-num st-c-n");
    hN.scope = "col";
    const nAbbr = el("abbr", null, "n");
    nAbbr.title = "Sessions in which this name was scored, of the sessions in the " +
      "window. The gaps in the strip are the difference.";
    hN.append(nAbbr);
    hr.append(hN);
    thead.append(hr);
    table.append(thead);

    bodyEl = el("tbody");
    table.append(bodyEl);
    wrap.append(table);
    trackHost.append(wrap);

    moreBtn = el("button", "st-more");
    moreBtn.type = "button";
    moreBtn.hidden = true;
    moreBtn.addEventListener("click", () => {
      state.shown += PAGE;
      renderBody(true);
    });
    trackHost.append(moreBtn);
  }

  /**
   * The strip column's usable width, measured while VISIBLE. The panel is
   * unhidden first — a hidden element reports clientWidth 0, and the
   * fallback it silently buys breaks the one-unit-one-pixel rule in the
   * direction nobody notices. flows-events shipped exactly that.
   */
  /* The narrowest strip worth drawing. Below this the columns beside it have
     eaten the drawing entirely, and the honest move is to force the column and
     let the wrapper scroll rather than emit a 240-unit svg into a cell that is
     forty pixels wide — which is what the old `Math.round(w) || 240` did the
     moment a fixed layout squeezed the column to zero: a falsy 0 fell through
     to the fallback and every mark landed under the wrong date. */
  const MIN_STRIP = 100;

  /**
   * THE LARGEST WHOLE PIXEL THAT FITS INSIDE A HOST'S CONTENT BOX.
   *
   * `clientWidth` is the obvious measurement and it is the wrong one, by up to
   * a pixel, in the only direction that matters: it ROUNDS, and it rounds UP.
   * The strip column's content box measures 336.828px at 1280 and reports
   * clientWidth 337, so every strip and the axis above them went out with
   * width="337" over a 337-unit viewBox into a 336.828px box — a drawing
   * wider than the cell holding it, held in only by the stylesheet's
   * max-width, with one viewBox unit worth 0.99949 CSS pixels. Nothing on the
   * page could ever have shown that, which is exactly why the invariant is
   * stated as an equality rather than left to the eye. Measured across
   * 320/390/768/1024/1280/1440 the width attribute now equals the rendered
   * box at every one of them.
   *
   * Measured two ways and the smaller taken. getBoundingClientRect() is the
   * BORDER box, so it is the truthful reading only while the host carries no
   * padding and no border — `.st-axis` carries neither today. Should a
   * stylesheet give it either, that reading grows past the content box and
   * the clientWidth reading wins instead, which is what this did before. The
   * floor costs at most one pixel of drawing and buys an attribute that is a
   * true bound rather than an approximate one.
   */
  function contentPx(host) {
    if (!host) return 0;
    const rect = Math.floor(host.getBoundingClientRect().width);
    const client = Math.floor(host.clientWidth);
    if (!(rect > 0) && !(client > 0)) return 0;
    if (!(rect > 0)) return client;
    if (!(client > 0)) return rect;
    return Math.min(rect, client);
  }

  function stripWidth() {
    if (panelEl) panelEl.hidden = false;
    /* The inline width is cleared BEFORE measuring, every time: a floor
       applied on a phone must not survive the rotation that made it
       unnecessary, and a floor left in place is what turns a laptop's
       comfortable table into one that scrolls sideways by twenty pixels. */
    if (stripHead) stripHead.style.width = "";
    let w = contentPx(axisHost);
    if (stripHead && w < MIN_STRIP) {
      /* THE FLOOR IS A CONTENT WIDTH AND `width` IS A BORDER-BOX ONE —
         base.css sets box-sizing:border-box globally — so setting it to the
         floor delivers the floor MINUS the cell's padding. The shortfall is
         measured and added back rather than the stylesheet's padding being
         guessed at from here: a hard-coded 16 would be a second copy of a
         number that lives in flows.css. */
      stripHead.style.width = MIN_STRIP + "px";
      let got = contentPx(axisHost);
      if (got < MIN_STRIP) {
        stripHead.style.width = (2 * MIN_STRIP - got) + "px";
        got = contentPx(axisHost) || MIN_STRIP;
      }
      w = got;
    }
    return Math.max(48, Math.min(1600, w || 240));
  }

  /* ---------- the axis header -------------------------------------

     Above the rows, sharing their exact geometry: sparse date ticks,
     board-only columns hatched over a wash, the pre-epoch stretch marked
     with its own dotted lane, and the epoch boundary ruled where the
     window straddles it. Decorative to assistive tech — everything it
     says is also said in words in the caption and note. */

  function renderAxis(W) {
    axisHost.replaceChildren();
    const S = ctx.sessions.length;
    if (!S) return;
    const g = UI.stripGeometry(S, W);
    const H = 34;
    const svg = svgEl("svg", {
      class: "st-ax", viewBox: `0 0 ${W} ${H}`, width: W, height: H,
      "aria-hidden": "true", focusable: "false",
      preserveAspectRatio: "xMidYMid meet",
    });

    /* The hatch that marks board-only columns independently of hue, the
       line at the tile centre so patternUnits cannot half-clip it — same
       construction, same reason, as the events chart's gate band. */
    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: "stHatch", width: 5, height: 5, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "st-ax-hatch",
    });
    pat.append(svgEl("line", {
      x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: "currentColor", "stroke-width": 1.1,
    }));
    defs.append(pat);
    svg.append(defs);

    // Board-only columns: a wash AND the hatch over it, merged into runs.
    const srcTop = 10, srcH = 12;
    let run = null;
    const runs = [];
    for (const i of ctx.boardsIdx) {
      if (run && i === run.to + 1) { run.to = i; continue; }
      run = { from: i, to: i };
      runs.push(run);
    }
    for (const r of runs) {
      const geom = {
        x: g.xEdge(r.from).toFixed(2), y: srcTop,
        width: (g.colW * (r.to - r.from + 1)).toFixed(2), height: srcH,
      };
      svg.append(svgEl("rect", { class: "st-ax-src", ...geom }));
      // Fill is the pattern, set as a presentation attribute; no CSS fill may win.
      svg.append(svgEl("rect", { class: "st-ax-srchatch", ...geom, fill: "url(#stHatch)" }));
    }

    /* The pre-epoch stretch: its own dotted lane above the source band,
       labelled when there is room. When the whole window is pre-epoch the
       lane spans it all — and the note says so in words either way. */
    if (ctx.boundary !== null || ctx.allPre) {
      const from = 0;
      const to = ctx.boundary === null ? S : ctx.boundary;
      const x1 = g.xEdge(from), x2 = g.xEdge(to);
      svg.append(svgEl("line", {
        class: "st-ax-pre", x1: x1.toFixed(2), x2: x2.toFixed(2), y1: 4, y2: 4,
      }));
      if (x2 - x1 > 84) {
        const lab = svgEl("text", {
          class: "st-ax-prelab", x: (x1 + 2).toFixed(2), y: 8,
          "font-size": "7.5px", "text-anchor": "start",
        });
        lab.textContent = "PRE-EPOCH";
        svg.append(lab);
      }
    }
    if (ctx.boundary !== null) {
      const x = g.xEdge(ctx.boundary).toFixed(2);
      svg.append(svgEl("line", { class: "st-erule", x1: x, x2: x, y1: 0, y2: H }));
    }

    /* Sparse date ticks: about one per 58px, always the first and the
       last session, labels clamped inside the drawing and sized in px —
       an unsized SVG <text> inherits the document's 16px and clips. */
    const step = Math.max(1, Math.ceil(S / Math.max(1, Math.floor(W / 58))));
    const labelled = [];
    for (let i = 0; i < S; i += step) labelled.push(i);
    if (labelled[labelled.length - 1] !== S - 1) {
      if (S - 1 - labelled[labelled.length - 1] < Math.max(2, step / 2)) labelled.pop();
      labelled.push(S - 1);
    }
    for (const i of labelled) {
      const x = g.xMid(i);
      svg.append(svgEl("line", {
        class: "st-ax-tick", x1: x.toFixed(2), x2: x.toFixed(2),
        y1: srcTop + srcH, y2: srcTop + srcH + 3,
      }));
      const t = svgEl("text", {
        class: "st-ax-lab",
        x: Math.min(Math.max(x, 15), W - 15).toFixed(2), y: H - 2,
        "font-size": "9px", "text-anchor": "middle",
      });
      // MM-DD: the hyphen belongs to the ISO date and stays a hyphen.
      t.textContent = ctx.sessions[i].d ? ctx.sessions[i].d.slice(5) : "?";
      svg.append(t);
    }

    axisHost.append(svg);
  }

  /* ---------- the rows -------------------------------------------- */

  /** The ISO date at a session index, or null. */
  function dateAt(i) {
    const s = i === null || i === undefined ? null : ctx.sessions[i];
    return s && s.d ? s.d : null;
  }

  /* THE SIGN IS CARRIED BY THE GLYPH, which fmtSigned always prints; the tone
     class repeats it in hue for the readers who have it. A measured zero gets
     no tone at all — it is a measurement, and dimming it would file it beside
     the em dash it must never resemble. */
  const tone = (v) => (v === null ? "" : v > 0 ? " fb-pos" : v < 0 ? " fb-neg" : "");

  /** Where a row's reading sits in time, in one clause, or null if unstated. */
  function asOfSaid(r) {
    if (r.lastAt === null) return null;
    const on = dateAt(r.lastAt);
    const where = on ? "on " + on : "at session " + (r.lastAt + 1);
    if (r.staleBy === null) return "last scored " + where;
    return r.staleBy === 0
      ? "last scored " + where + ", the latest session in this window"
      : "last scored " + where + ", " + sessionsSaid(r.staleBy) +
        " before the latest session in this window";
  }

  function stripSaid(r, S) {
    const said = [];
    said.push(r.t + " " + MID + " scored " +
      (r.n === null
        ? "an unstated number of the " + S + " " + plural(S, "session", "sessions") +
          " in this window — this payload published no count for it"
        : r.n + " of " + S + " " + plural(S, "session", "sessions") +
          (r.n < S
            ? ", and the empty stretches are sessions it was not scored, never zeros"
            : "")));
    const when = asOfSaid(r);
    said.push("last " + fmtSigned(r.last) + (when ? ", " + when : ""));
    if (r.run !== null) {
      said.push(r.run === 0
        ? "the newest score is exactly zero, which belongs to neither side"
        : sessionsSaid(r.run) + " in a row on that sign");
    }
    if (r.ext) {
      const hiOn = dateAt(r.ext.hiAt), loOn = dateAt(r.ext.loAt);
      said.push("window high " + fmtSigned(r.ext.hi) + (hiOn ? " on " + hiOn : "") +
        ", low " + fmtSigned(r.ext.lo) + (loOn ? " on " + loOn : ""));
    }
    return said.join(" " + MID + " ");
  }

  function rowFor(r, W) {
    const tr = el("tr");

    const th = el("th", "fb-tk st-c-name");
    th.scope = "row";
    const link = el("a", null, r.t);
    link.href = "/flows/ticker/?t=" + encodeURIComponent(r.t);
    th.append(link);
    tr.append(th);

    const td = el("td", "st-c-strip");
    const S = ctx.sessions.length;
    td.title = stripSaid(r, S);
    UI.scoreStrip(td, {
      values: r.s,
      deadBand: ctx.deadBand,
      domain: ctx.domain,
      width: W,
      height: 24,
      prefix: "st",
      markers: ctx.markers,
      rules: ctx.rules,
    });
    tr.append(td);

    if (colSet.move) {
      /* THE EVENT, AS A WORD. Category and sign survive greyscale and a
         monochrome printout because they are spelled out; the class beside
         them is a hook for a tint that repeats what the word already says. */
      const ev = el("td", "st-c-event" + (r.d1 && r.d1.cross ? " is-" + r.d1.cross : ""));
      if (!r.d1) {
        ev.textContent = DASH;
        ev.title = r.n !== null && r.n < 2
          ? "This name was scored on fewer than two sessions in this window, so " +
            "there is no previous score for it to have changed from. Absent, not zero."
          : "This payload published no move for this name, so no change can be " +
            "stated for it. Absent, not zero.";
      } else {
        ev.append(el("span", null, r.d1.cross
          ? r.d1.cross
          : r.d1.v === 0 ? "held" : "drift"));
        ev.title = r.d1.cross
          ? CROSS_SAID[r.d1.cross]
          : r.d1.v === 0
            ? "This name was scored on both sessions and its score did not change. " +
              "A held score is a measurement of the session, not a missing one."
            : "The name did not change category: it sat on the same side of the " +
              "dead band at both ends of the comparison. Drift, however large.";
        /* THE WINDOW EXTREME, FREE IN THE SAME PAYLOAD: the newest score IS
           the highest or the lowest this name reached inside the window. It
           is the strongest sentence this archive can produce about a name,
           and it sat in `ext` with nothing reading it. */
        if (r.lastAt !== null && r.ext) {
          const end = r.ext.hiAt === r.lastAt ? "high" : r.ext.loAt === r.lastAt ? "low" : null;
          if (end) {
            const tag = el("span", null, " " + MID + " " + end);
            tag.title = "This name's newest score is its window " + end + ": " +
              fmtSigned(end === "high" ? r.ext.hi : r.ext.lo) + " across the " +
              sessionsSaid(ctx.sessions.length) + " drawn here.";
            ev.append(tag);
          }
        }
      }
      tr.append(ev);

      /* THE MOVE AND ITS SPAN IN ONE CELL, because they are one reading. A
         delta printed without the number of sessions it covers is the exact
         defect this layer replaced: +38 is the headline of the session when
         it happened overnight and is noise when it happened across three
         weeks the name spent off the board, and the integer is identical. */
      const mv = el("td", "st-c-move" + (r.d1 ? tone(r.d1.v) : ""));
      if (!r.d1) {
        mv.textContent = DASH;
        mv.title = ev.title;
      } else {
        mv.append(el("span", null, fmtSigned(r.d1.v)));
        mv.append(el("span", null, " " + MID + " " +
          (r.d1.gap === 1 ? "overnight" : sessionsSaid(r.d1.gap))));
        mv.title = fmtSigned(r.d1.v) + plural(Math.abs(r.d1.v), " score point", " score points") +
          " against this name's previous scored session, which was " +
          (r.d1.gap === 1
            ? "the session immediately before"
            : sessionsSaid(r.d1.gap) + " earlier") + "." +
          (r.d1.qv === null
            ? " The same move in residual units is absent, because one end of the " +
              "comparison carried no residual."
            : " The score saturates and the residual does not, so the same move in " +
              "residual units is " + fmtSigned(r.d1.qv) + " × 10⁻⁴.");
      }
      tr.append(mv);
    }

    /* ZERO IS PRINTED AT FULL INK with no tone class: it is a measurement,
       and dimming it would file it beside the em dash it must never
       resemble. The tint on the signed cases repeats a sign the glyph
       already carries — hue as confirmation, never the carrier. */
    const last = el("td", "c-num st-c-last" +
      (r.last === null ? " is-none" : tone(r.last)),
      fmtSigned(r.last));
    if (r.last === null) {
      last.title = "No last score was published for this name. Not measured — not zero.";
    } else if (r.last === 0) {
      last.title = "A measured zero: the pipeline scored this name at exactly 0 — " +
        "the middle of the distribution, not an absence.";
    }
    tr.append(last);

    if (colSet.asOf) {
      /* THE AGE OF THE READING, ON EVERY ROW. Nothing on this page stated it
         before, so a score measured thirty sessions ago and one measured this
         morning were the same cell under the same header. */
      const asOf = el("td", "st-c-asof" + (r.staleBy ? " is-old" : ""));
      const on = dateAt(r.lastAt);
      if (r.lastAt === null) {
        asOf.textContent = DASH;
        asOf.title = "This payload published no session index for this name, so " +
          "which session its score was measured on cannot be stated. That is a " +
          "gap in the payload, not a claim that the reading is old.";
      } else if (r.staleBy === 0) {
        /* MM-DD, matching the axis labels above; the hyphen belongs to the
           ISO date and stays a hyphen. */
        asOf.textContent = on ? on.slice(5) : "latest";
        asOf.title = "Scored in the latest session in this window" +
          (on ? " (" + on + ")" : "") + ".";
      } else {
        asOf.append(el("span", null, on ? on.slice(5) : "earlier"));
        asOf.append(el("span", null, " " + MID + " " + r.staleBy + " back"));
        asOf.title = "Not scored in the latest session. This name's newest score was " +
          "measured " + (on ? "on " + on + ", " : "") + sessionsSaid(r.staleBy) +
          " before the latest session drawn here, so its Last and its move are " +
          "real and are not about today.";
      }
      tr.append(asOf);
    }

    if (colSet.run) {
      const run = el("td", "c-num st-c-run", fmtInt(r.run));
      run.title = r.run === null
        ? "This payload published no run length for this name."
        : r.run === 0
          ? "The newest score is exactly zero, which belongs to neither side and " +
            "ends the run."
          : sessionsSaid(r.run) + " in a row on the sign of the last score. A run " +
            "of one is a new opinion; a run of thirty is an old one.";
      tr.append(run);
    }

    /* fmtInt DRAWS AN ABSENT COUNT AS AN EM DASH, which is why `n` is no
       longer floored at zero in prepare(): a "0" beside a strip full of marks
       is a sample size nobody measured. */
    const nCell = el("td", "c-num st-c-n", fmtInt(r.n));
    if (r.n === null) {
      nCell.title = "This payload published no measured-session count for this name.";
    }
    tr.append(nCell);
    return tr;
  }

  function renderBody(append) {
    const list = filterSort();
    const already = append ? bodyEl.children.length : 0;
    if (!append) bodyEl.replaceChildren();

    if (!list.length) {
      const tr = el("tr");
      const td = el("td", "flows-empty st-empty",
        state.q.trim()
          ? "No name in this payload matches “" + state.q.trim() + "”. The " +
            "filter reads tickers only — it says nothing about what was scored."
          : "No name to draw.");
      td.colSpan = columnCount();
      tr.append(td);
      bodyEl.append(tr);
    } else {
      const upto = Math.min(state.shown, list.length);
      const frag = document.createDocumentFragment();
      for (let i = already; i < upto; i++) frag.append(rowFor(list[i], drawnW));
      bodyEl.append(frag);
    }

    const showing = Math.min(state.shown, list.length);
    const q = state.q.trim();
    capEl.textContent = (q
      ? showing + " of " + list.length + " " + plural(list.length, "name", "names") +
        " matching “" + q + "”, of " + ctx.rows.length + " in the window"
      : showing + " of " + ctx.rows.length + " " + plural(ctx.rows.length, "name", "names")) +
      ", " + (SORT_WORDS[state.sort] || SORT_WORDS.abs) + " " + MID +
      " one row per name, one column per session, oldest on the left.";

    if (list.length > showing) {
      moreBtn.hidden = false;
      moreBtn.textContent = "Show " + Math.min(PAGE, list.length - showing) +
        " more " + MID + " " + showing + " of " + list.length + " drawn";
    } else {
      moreBtn.hidden = true;
    }
  }

  /* ---------- what moved, and out of how many ----------------------

     A COUNT WITHOUT ITS POPULATION IS NOT A READING. "Eight names moved" is a
     session that turned when eight is out of twelve and a Tuesday when it is
     out of four hundred. The change block is computed over the whole pool
     BEFORE the payload's size cap sheds rows, so this paragraph can state a
     denominator no renderer counting its own visible rows could reach — and
     it must, because the rows below are at most the sixty this page drew.

     FOUR STATUSES, FOUR SENTENCES, and they may not be collapsed. "flat" is a
     measurement of the session: every comparable name was compared and none
     moved. "cold" and "single-session" are statements about how much archive
     exists, which is a fact about this pipeline and not about the market.
     Printing one sentence for all four is how a page reports a session in
     which nothing happened as a session it could not see. */

  function bandSaid() {
    return ctx.deadBand === null
      ? "No dead band was published with this track, so no crossing can be claimed " +
        "and none is."
      : "The dead band is ±" + ctx.deadBand + plural(ctx.deadBand, " score point", " score points") +
        " wide, and it is drawn to scale in every strip.";
  }

  /** How many of the rows on this payload are not about the latest session. */
  function staleSaid() {
    if (!ctx.has.now || !ctx.sessions.length) return null;
    /* NOT SCORED IN THE LATEST SESSION, over the rows this payload carries.
       The whole-pool figure is the change block's; this one is about what is
       drawn below, which is the number a reader can check by eye. */
    let old = 0, unknown = 0;
    for (const r of ctx.rows) {
      if (r.staleBy === null) unknown++;
      else if (r.staleBy > 0) old++;
    }
    const said = [];
    if (old) {
      said.push(old + " of the " + ctx.rows.length + " " +
        plural(ctx.rows.length, "name", "names") + " carried here " +
        plural(old, "was", "were") + " not scored in the latest session. " +
        "Their Last and their move are real readings of an older session, the " +
        "As-of column dates each one, and the default ordering sorts them last " +
        "rather than promoting a stale reading over a measured one." +
        /* THE STATE WHERE THE DEFAULT ORDERING HAS NOTHING TO RANK, named
           rather than left for the reader to infer from a caption that
           changed wording. */
        (ctx.has.nowScore ? "" : " No carried name was scored in the latest " +
          "session at all, so that ordering is not offered here and the page " +
          "opens on the last measured score instead."));
    }
    if (unknown) {
      said.push(unknown + " " + plural(unknown, "name carries", "names carry") +
        " no session index, so how old " + plural(unknown, "its reading is", "their readings are") +
        " cannot be stated.");
    }
    return said.length ? said.join(" ") : null;
  }

  function changeSaid() {
    const ch = ctx.change;
    const said = [];

    if (!ch) {
      /* THE PAYLOAD IS READABLE AND PREDATES THE CHANGE LAYER. That is
         neither a failed fetch nor a quiet market and must not borrow either
         sentence. It is also the branch that refuses to subtract two cells of
         `s` in the browser: a difference with no session span attached is not
         a reading, and this page has spent a version proving it. */
      said.push("This track published no session-level change summary, so the " +
        "moves below are the ones this payload happens to carry rather than a " +
        "share of a stated population. This page will not subtract two scores " +
        "itself: a difference with no session span attached cannot say whether " +
        "it covers one session or twenty.");
      said.push(bandSaid());
      return said.join(" ");
    }

    const comparable = isNum(ch.comparable);
    const consecutive = isNum(ch.consecutive);
    const moved = isNum(ch.moved);
    const held = isNum(ch.held);
    const current = isNum(ch.current);
    const entered = isNum(ch.entered);
    const left = isNum(ch.left);
    const from = typeof ch.prior === "string" ? ch.prior : null;
    const to = typeof ch.session === "string" ? ch.session : null;
    const span = from && to ? " between " + from + " and " + to : "";

    if (ch.status === "single-session") {
      said.push("This window holds a single scored session" + (to ? " (" + to + ")" : "") +
        ", so there is nothing to compare it against and no move exists to report. " +
        "The first change lands once a second session is archived.");
      said.push(bandSaid());
      return said.join(" ");
    }
    if (ch.status === "cold") {
      said.push("No name in this pool was scored on two sessions inside the window, " +
        "so no change exists to report. That is the shape of the archive, not a " +
        "market that stood still.");
      said.push(bandSaid());
      return said.join(" ");
    }
    if (ch.status === "flat") {
      said.push("Every one of the " + (comparable === null ? "compared" : comparable) +
        " names with two scored sessions held its score" + span + ". Nothing moved, " +
        "and that is a reading about the session rather than a gap in the archive.");
      said.push(bandSaid() + " No name crossed it.");
      return said.join(" ");
    }
    if (ch.status !== "ok") {
      /* A STATUS THIS PAGE DOES NOT RECOGNISE IS NAMED, not quietly folded
         into "ok". A fifth value added upstream would otherwise be reported
         with the sentence written for the fourth. */
      said.push("This track states a change status this page does not recognise" +
        (typeof ch.status === "string" && ch.status ? " (\u201c" + ch.status + "\u201d)" : "") +
        ", so the counts below are printed without the sentence that belongs to it.");
    }

    /* A COUNT AND ITS POPULATION ARE ONE READING, AND EITHER ONE MISSING
       CHANGES THE SENTENCE — it does not get filled in with a word.

       The first version printed `(moved ?? "Some") + " of the " + (comparable
       ?? "") + "names with two scored sessions moved"`, which produced two
       defective sentences from two different absences. Without `comparable`
       it read "4 of the names with two scored sessions moved" — a numerator
       with its denominator quietly deleted, which is the exact shape this
       product bans, and worse than printing nothing because the "of the"
       still promises a share. Without `moved` it read "Some of the names …
       moved", a claim about the session assembled out of a field the payload
       did not publish. */
    if (moved === null && comparable === null) {
      said.push("This track's change block published neither how many names moved" +
        span + " nor how many had two scored sessions to move out of, so nothing " +
        "here can be stated as a share of a population.");
    } else if (moved === null) {
      said.push(comparable + plural(comparable, " name has", " names have") +
        " two scored sessions to compare" + span + ", and this track did not " +
        "publish how many of them moved.");
    } else if (comparable === null) {
      said.push(moved + plural(moved, " name moved", " names moved") + span +
        ", and this track did not publish how many names had two scored sessions " +
        "to move out of — so that count has no population and is not a share.");
    } else {
      said.push(moved + " of the " + comparable + " names with two scored sessions " +
        "moved" + span +
        /* "1 held their score" shipped. A count of one takes its own verb. */
        (held === null ? "" : "; " + held + plural(held, " held its score", " held theirs")) +
        ".");
    }
    if (current !== null) {
      said.push("The session itself scored " + current +
        plural(current, " name", " names") + ".");
    }

    if (consecutive !== null && comparable !== null) {
      said.push(consecutive + " of those " + comparable + " comparisons span a single " +
        "session; the rest reach back further, and every row prints how far.");
    }

    const cr = ch.crossings && typeof ch.crossings === "object" ? ch.crossings : null;
    const cleared = cr ? isNum(cr.cleared) : null;
    const faded = cr ? isNum(cr.faded) : null;
    const flipped = cr ? isNum(cr.flipped) : null;
    if (cleared !== null && faded !== null && flipped !== null) {
      const total = cleared + faded + flipped;
      said.push(bandSaid() + " " + (total === 0
        ? "No name crossed it this session, so everything below is drift."
        : total + plural(total, " name", " names") + " crossed it: " + cleared +
          " cleared, " + faded + " faded back inside, " + flipped + " flipped sides. " +
          "Those are the early warnings; everything else below is drift, however large."));
    } else {
      said.push(bandSaid());
    }

    if (entered) {
      said.push(entered + plural(entered, " name was", " names were") +
        " scored for the first time in this window and " +
        plural(entered, "has", "have") + " no prior reading to compare against.");
    }
    if (left) {
      said.push(left + plural(left, " name was", " names were") +
        " scored on the prior session and not on this one.");
    }
    /* THE COUNTS ABOVE ARE THE POOL'S; THE COLUMNS BELOW ARE THIS PAYLOAD'S,
       and when they disagree the page has to say so. A change block can count
       moves in names the size cap then sheds, leaving a paragraph that reports
       moves above a table with no Δ column at all — and the code comment on
       `colSet` claims this paragraph "says which fields were missing", which
       it did not. */
    if (!ctx.has.move) {
      said.push("No name carried on this payload states a move of its own, so the " +
        "Event and \u0394 columns are not drawn below. The counts above are the " +
        "session's; the rows below are the ones that fit on the wire.");
    }

    if (ctx.shedBy && ctx.shed) {
      said.push(ctx.shed + plural(ctx.shed, " name is", " names are") +
        " counted in those totals but not carried on this payload — the " +
        (ctx.shedBy === "names" ? "row ceiling" : "byte ceiling") +
        " shed them — so the table below is shorter than the count above it.");
    }
    return said.join(" ");
  }

  /**
   * WHICH SILENCE THIS IS, AS A TAG AND NOT ONLY AS PROSE — the same
   * three-way distinction every other Flows surface carries, so a reader and
   * a test can both tell them apart without parsing a sentence:
   *
   *   unavailable — the change layer was never published, or the archive
   *                 holds nothing to compare. A fact about the pipeline.
   *   quiet       — every comparable name was compared and none moved. A
   *                 measurement of the session, and the only one of the three
   *                 that makes a claim about the market.
   *   (no tag)    — the layer is present and something moved.
   */
  function changeSilence() {
    const ch = ctx.change;
    if (!ch) return "unavailable";
    if (ch.status === "cold" || ch.status === "single-session") return "unavailable";
    if (ch.status === "flat") return "quiet";
    return null;
  }

  function renderChange() {
    if (!changeEl) return;
    const stale = staleSaid();
    changeEl.textContent = changeSaid() + (stale ? " " + stale : "");
    const kind = changeSilence();
    if (kind) changeEl.dataset.empty = kind;
    else delete changeEl.dataset.empty;
  }

  /* ---------- the note under the track ----------------------------- */

  function renderNote() {
    if (!trackNote) return;
    const S = ctx.sessions.length;
    const parts = [];

    parts.push("Every strip is drawn on one scale shared by the whole page, " +
      fmtSigned(ctx.domain.lo) + " to " + fmtSigned(ctx.domain.hi) +
      ", so two names can be compared by eye; the horizontal rule in each is zero, " +
      "and which side of it the trace sits on is the sign.");

    if (ctx.deadBand !== null && ctx.deadBand > 0) {
      /* The band is drawn TO SCALE; when the shared domain makes it
         sub-pixel the note says so rather than the drawing inflating it. */
      const bandPx = (2 * ctx.deadBand / (ctx.domain.hi - ctx.domain.lo)) * 19;
      parts.push("The shading around that rule is the published dead band, " +
        MINUS + ctx.deadBand + " to +" + ctx.deadBand + ", drawn to scale" +
        (bandPx < 3 ? " — at this window's range it is barely wider than the rule itself" : "") +
        ".");
    }

    parts.push("A break in a trace is a session the name was NOT scored. The line is " +
      "broken rather than drawn across, and nothing is plotted there — an absence " +
      "must not borrow a pixel a measurement could own. A score of zero IS a " +
      "measurement and draws its mark on the rule.");

    const b = ctx.boardsIdx.length;
    if (b > 0) {
      parts.push(b + " of these " + S + " " + plural(S, "session is", "sessions are") +
        " board-only " + plural(b, "reconstruction", "reconstructions") +
        " — hatched in the axis above and washed in every strip. Only the names " +
        "that made a board that day were archived, so those columns are genuinely " +
        "sparser, not quieter.");
    }

    if (ctx.boundary !== null) {
      parts.push("The broken gold rule is the selection epoch" +
        (ctx.epoch ? " (" + ctx.epoch + ")" : "") + ": scores on either side of it " +
        "come from different pools under different selection rules — a trace that " +
        "crosses it is two experiments wearing one line, and the rule is drawn " +
        "rather than smoothed over.");
    } else if (ctx.allPre && ctx.epoch) {
      parts.push("Every session in this window predates the selection epoch the " +
        "payload names (" + ctx.epoch + "), so no trace here crosses it; the dotted " +
        "lane over the axis marks the whole window as pre-epoch.");
    } else if (ctx.allPost && ctx.epoch) {
      parts.push("Every session in this window sits after the selection epoch the " +
        "payload names (" + ctx.epoch + "), so no trace here crosses it.");
    }

    trackNote.textContent = parts.join(" ");
  }

  /* ---------- the basis panel, which is the page's honesty ---------

     THE PAYLOAD'S OWN SENTENCES, VERBATIM. The five notes travel beside
     the numbers they explain, so this renderer cannot reword a caption
     into a claim the arithmetic does not support. Nothing is paraphrased,
     and a note the payload adds later still reaches the reader. */

  const BASIS_LABELS = {
    score: "What the score is",
    gaps: "What a gap means",
    change: "What a change is",
    crossing: "What a crossing is",
    run: "What a run is",
    saturation: "Why the score compresses",
    backfill: "Board-only sessions",
    epoch: "The selection epoch",
    window: "The window",
  };
  /* The four change-layer notes are ordered next to the gap note deliberately:
     a reader meeting the Event and Δ columns for the first time needs "what a
     change is" and "what a crossing is" before the archive's own caveats. They
     reached the page only through the unknown-key loop below, labelled with
     their bare keys, until they were named here. */
  const BASIS_ORDER = ["score", "gaps", "change", "crossing", "run", "saturation",
    "backfill", "epoch", "window"];

  function basisItem(key, value) {
    const text = String(value === null || value === undefined ? "" : value).trim();
    if (!text) return null;
    const box = el("div", "st-b-item");
    box.append(el("p", "st-b-k", BASIS_LABELS[key] || key));
    box.append(el("p", "st-b-p", text));
    return box;
  }

  function renderBasis(payload) {
    if (!basisHost) return;
    basisHost.replaceChildren();
    const notes = (payload && payload.notes && typeof payload.notes === "object")
      ? payload.notes : null;

    if (!notes) {
      basisHost.append(el("p", "fc-note",
        "This payload carried no notes block, so the page cannot say in the " +
        "pipeline's own words how the score was built or what a gap means. Treat " +
        "everything above as unexplained."));
      if (basisPanel) basisPanel.hidden = false;
      return;
    }

    const drawnKeys = new Set();
    for (const key of BASIS_ORDER) {
      if (!Object.prototype.hasOwnProperty.call(notes, key)) continue;
      const node = basisItem(key, notes[key]);
      drawnKeys.add(key);
      if (node) basisHost.append(node);
    }
    /* ANY NOTE THE PAYLOAD ADDS LATER STILL REACHES THE READER — a notes
       block that grows a sixth entry must not lose it to this list. */
    for (const key of Object.keys(notes)) {
      if (drawnKeys.has(key)) continue;
      const node = basisItem(key, notes[key]);
      if (node) basisHost.append(node);
    }
    if (basisPanel) basisPanel.hidden = false;
  }

  /* ---------- the status strip and the footer ---------------------- */

  function renderStatus(payload) {
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const names = Array.isArray(payload.names) ? payload.names : [];
    const windowSessions = isNum(payload.windowSessions);
    const namesSeen = isNum(payload.namesSeen);
    /* NOT `isNum(...) ?? 0`. The coalesce was harmless HERE — it only fed a
       `> 0` guard — but it is the idiom that produced every confident zero
       this file has had to unpick, and leaving one specimen alive beside the
       ones that were killed is how the next reader concludes it is allowed. */
    const namesShed = isNum(payload.namesShed);
    const sources = (payload.sources && typeof payload.sources === "object")
      ? payload.sources : null;
    const archive = (payload.archive && typeof payload.archive === "object")
      ? payload.archive : null;

    const parts = [];
    parts.push(sessions.length + " " + plural(sessions.length, "session", "sessions") +
      " traced" +
      (windowSessions !== null && windowSessions !== sessions.length
        ? ", of a " + windowSessions + "-session window" : ""));

    /* The shed, beside the count it qualifies: a capped list that does not
       say so invites reading the cap as the population. */
    parts.push(names.length + " " + plural(names.length, "name", "names") +
      (namesShed !== null && namesShed > 0 && namesSeen !== null
        ? " — the most-observed " + names.length + " of " + namesSeen + " seen; " +
          namesShed + " shed"
        : ""));

    if (sources) {
      /* A CONFIDENT ZERO IN A PRINTED COUNT, and it was in the sentence that
         tells the reader how much of this window is a reconstruction rather
         than a full scoring. These read `isNum(x) ?? 0`, so a payload that
         stopped publishing either key would have printed "0 sessions
         reconstructed from the archived boards alone" — a reassurance nobody
         measured. Each half is now printed only if it was published. */
      const full = isNum(sources.full);
      const boardsOnly = isNum(sources.boardsOnly);
      const fullSaid = full === null ? null
        : full + " " + plural(full, "session", "sessions") + " scored in full";
      const backSaid = boardsOnly === null ? null
        : boardsOnly + " " + plural(boardsOnly, "session", "sessions") +
          " reconstructed from the archived boards alone";
      if (fullSaid && backSaid) parts.push(fullSaid + ", " + backSaid);
      else if (fullSaid || backSaid) {
        parts.push((fullSaid || backSaid) + ", and the other half of that split " +
          "was not published");
      } else {
        parts.push("this payload carried a source split with neither count in it, so " +
          "how much of the window is a board-only reconstruction is not stated");
      }
    }

    if (archive) {
      const probed = isNum(archive.probed);
      /* THE CONFIDENT ZERO WITH THE MOST TO LOSE ON THIS PAGE, and it sat
         three lines below one that was fixed. It read `isNum(archive.failed)
         ?? 0`, so a payload that published `probed` and no `failed` — any
         blob written before the archive counters existed — fell through to
         the else branch and printed "all 180 probed archive keys were read":
         a clean bill of health for a walk nobody measured, in the one
         sentence that tells a reader whether a thin trace is a quiet market
         or a store that refused. An absent count is now its own third
         answer, and it makes no claim in either direction. */
      const failed = isNum(archive.failed);
      const abandoned = archive.abandoned === true;
      if (failed === null && !abandoned) {
        parts.push(probed === null
          ? "this payload carried an archive block with no counts in it, so " +
            "whether the walk read everything it probed is not stated"
          : "this payload probed " + probed + " archive " + plural(probed, "key", "keys") +
            " and did not state how many were read, so whether any session is " +
            "missing from this window is not stated");
      } else if ((failed !== null && failed > 0) || abandoned) {
        /* A FACT ABOUT THE STORE, NOT THE MARKET. A walk that lost keys
           leaves columns missing here that exist in the archive, and a
           page that stayed quiet about it would present the loss as a
           quiet stretch of sessions. */
        parts.push("the archive could not be fully read: " +
          (failed !== null && failed > 0
            ? failed + " of " + (probed === null ? "the" : probed) + " probed " +
              plural(failed, "key", "keys") + " failed"
            : "") +
          (failed !== null && failed > 0 && abandoned ? " and " : "") +
          (abandoned ? "the walk was abandoned partway" : "") +
          " — sessions may be missing from this window that exist in the store");
      } else if (probed !== null) {
        /* Reached only when `failed` was PUBLISHED and is zero — a measured
           zero, which is the one thing that earns this sentence. */
        parts.push(probed === 1
          ? "the one probed archive key was read"
          : "all " + probed + " probed archive keys were read");
      }
    }

    if (payload.sessionDate) {
      parts.push("the last column is the " + payload.sessionDate + " session");
    }
    statusEl.textContent = parts.join(" " + MID + " ") + ".";

    if (footEl) {
      const foot = [];
      if (payload.sessionDate) foot.push("Session " + payload.sessionDate);
      if (payload.generatedAt) {
        const t = Date.parse(payload.generatedAt);
        foot.push("Built " + (Number.isFinite(t)
          ? new Date(t).toLocaleString() : String(payload.generatedAt)));
      }
      const v = isNum(payload.v);
      if (v !== null) foot.push("payload v" + v);
      foot.push("Zero vendor calls: the track is a view of the score archive the " +
        "pipeline already holds, rebuilt from it on every run.");
      footEl.textContent = foot.join(" " + MID + " ");
    }
  }

  /**
   * THE STALENESS TEST IS UI.staleness()'s, NOT THIS FILE'S — and that is the
   * fix, not a refactor. This page had grown its own copy, and every way in
   * which the copy differed was a way it was worse:
   *
   *   - It tested the WRITE age and nothing else, so the second outage — a
   *     pipeline that runs on schedule against an input that stopped
   *     advancing — reported this track as current. Those are two different
   *     faults with two different remedies (the Actions tab; upstream), which
   *     is why flows-ui.js returns them as two kinds with two sentences.
   *   - It printed `Math.round(ageHours / 24)`, so a payload 36 hours old was
   *     announced as "2 day(s)" — a staleness overstated by most of a day, in
   *     the one banner a reader is meant to act on. The shared copy floors,
   *     and carries the hour branch for a threshold below a day.
   *   - It printed the literal string "day(s)", which is a placeholder, not
   *     prose.
   *   - It was a second copy of the 30-hour constant. Two routes wording one
   *     outage differently is how a reader concludes there are two outages.
   *
   * The shared sentence names the fault; the clause appended here names what
   * it costs THIS drawing, which the shared copy cannot know. `unknown` — a
   * payload carrying no readable date at all — makes no claim in either
   * direction rather than reading as fresh.
   */
  function renderStale(payload) {
    if (!staleEl) return;
    if (typeof UI.staleness !== "function") {
      /* A FRESHNESS CHECK THAT QUIETLY STOPS RUNNING is indistinguishable
         from a pipeline that is fine, which is the one failure this banner
         must never present as health. */
      staleEl.hidden = false;
      staleEl.dataset.stale = "unavailable";
      staleEl.textContent = "The freshness check could not run: this page's shared " +
        "UI module does not carry it, so nothing below is confirmed to be today's.";
      return;
    }
    const verdict = UI.staleness(payload, Date.now(), { subject: "This track" });
    if (!verdict || !verdict.message) {
      staleEl.hidden = true;
      staleEl.textContent = "";
      delete staleEl.dataset.stale;
      return;
    }
    staleEl.hidden = false;
    staleEl.dataset.stale = verdict.kind;
    staleEl.textContent = verdict.message + " The right-hand edge of every strip " +
      "is that run's session and not today's, so a trace that stops moving here " +
      "is this page not being refreshed rather than a name going quiet.";
  }

  /* ---------- states -----------------------------------------------

     THREE DIFFERENT SILENCES, AND THEY MAY NOT SHARE A SENTENCE — the
     rule flows-market.js paintSectors wrote down after a live run's
     measurement was reported as a dead one:

       (a) the key was never published        → a fact about the pipeline;
       (b) the payload could not be read      → a fact about the payload;
       (c) the data is genuinely empty        → only THEN a claim about
                                                what was measured.       */

  function showOnly(kind, msg) {
    trackHost.replaceChildren(UI.emptyState(kind, msg));
    if (panelEl) panelEl.hidden = false;
    if (trackNote) trackNote.textContent = "";
  }

  function failEverywhere(what) {
    statusEl.textContent = what;
    showOnly("failed", what);
    if (basisHost) {
      basisHost.replaceChildren(el("p", "fc-note",
        "The basis travels inside the same payload as the numbers, so it could not " +
        "be loaded either. Nothing on this page has been explained by the pipeline."));
      if (basisPanel) basisPanel.hidden = false;
    }
    if (footEl) footEl.textContent = "";
  }

  /* ---------- the paint --------------------------------------------- */

  function renderTrack() {
    if (panelEl) panelEl.hidden = false;   // UNHIDDEN BEFORE ANY MEASUREMENT
    buildScaffold();
    drawnW = stripWidth();
    renderAxis(drawnW);
    renderChange();
    renderNote();
    renderBody();
  }

  get("/api/flows/scoretrack").then((payload) => {
    if (!payload) return;                  // the 401 branch has already navigated
    if (typeof payload !== "object") throw new Error("the endpoint answered with no payload");

    if (payload.status === "pending") {
      /* (a) THE ORDINARY STATE BEFORE THE FIRST RUN, stated as a fact
         about the store rather than as an error or an empty market. */
      const msg = "The pipeline has not published this key yet. The track is " +
        "rebuilt by each morning run from the dated score archive the pipeline " +
        "already holds — it costs no vendor call — and it appears with the first " +
        "run after this page shipped.";
      statusEl.textContent = msg;
      showOnly("pending", msg);
      return;
    }

    renderStale(payload);

    const sessionsOk = Array.isArray(payload.sessions) && payload.sessions.length > 0;
    const namesOk = Array.isArray(payload.names);

    if (!sessionsOk || !namesOk) {
      /* (b) A SENTENCE ABOUT THE PAYLOAD, NEVER ABOUT THE SCORES. This
         page cannot see the pool; it can only see that the blob it was
         handed has no axis or no series to draw. */
      const msg = "This payload could not be read as a track: it carries " +
        (!sessionsOk ? "no session axis to trace a score against"
          : "a session axis but no name series") + ". That is a gap in the " +
        "payload rather than a fact about the scores — nothing here says the " +
        "pool was empty.";
      statusEl.textContent = msg;
      showOnly("unreadable", msg);
      renderBasis(payload);
      return;
    }

    if (!payload.names.length) {
      /* (c) NOW the claim is earned: sessions were reconstructed and no
         name carried a score in any of them. Said as a measured emptiness
         with its denominator, not as a failure. */
      renderStatus(payload);
      const count = payload.sessions.length;
      const msg = "No name carried a score in any of the " + count + " " +
        plural(count, "session", "sessions") + " the archive walk reconstructed. " +
        "That is a measured emptiness — the walk read every archived session in " +
        "the window and found no scored name — and not a missing publish.";
      showOnly("empty", msg);
      renderBasis(payload);
      return;
    }

    renderStatus(payload);
    ctx = prepare(payload);
    /* THE PAGE OPENS ON THE QUESTION THE MORNING ASKS. It opened on |last|
       — the newest score anywhere in the window — so a name last scored
       thirty sessions ago at +45 sat above a name scored this morning at
       +30, under a header the reader read as "yesterday". */
    state.sort = ctx.has.nowScore ? "now" : "abs";
    renderTrack();
    renderBasis(payload);
  }).catch((error) => {
    failEverywhere("The track could not be loaded: " + (error && error.message
      ? error.message : "the request failed") + ". Refresh to try again.");
  });

  /* REDRAWN AT THE NEW WIDTH, never scaled to it. One viewBox unit is one
     CSS pixel, and a resize that left the old svgs in place would quietly
     break that on the first rotation of a phone. The filter, order and
     how many rows are shown all survive the repaint. */
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    if (!ctx) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (ctx && Math.abs(stripWidth() - drawnW) > 2) renderTrack();
    }, 150);
  });
})();
