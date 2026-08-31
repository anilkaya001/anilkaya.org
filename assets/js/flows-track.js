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

  const state = { q: "", sort: "abs", shown: PAGE };
  let ctx = null;         // the prepared payload the renderers draw from
  let drawnW = 0;         // strip width at last paint, for the resize repaint

  // Scaffold nodes, built once so typing in the filter never rebuilds the input.
  let built = false;
  let capEl = null, bodyEl = null, axisHost = null, moreBtn = null;

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

  function prepare(payload) {
    const sessions = (Array.isArray(payload.sessions) ? payload.sessions : [])
      .map((s) => ({
        d: s && typeof s.d === "string" ? s.d : "",
        source: s && s.source === "scores" ? "scores" : "boards",
        preEpoch: !!(s && s.preEpoch),
      }));

    const rows = [];
    for (const r of (Array.isArray(payload.names) ? payload.names : [])) {
      if (!r || typeof r.t !== "string" || !r.t) continue;
      rows.push({
        t: r.t,
        s: Array.isArray(r.s) ? r.s : [],
        n: isNum(r.n) ?? 0,
        last: isNum(r.last),
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
      boardsIdx, boundary,
      allPre: sessions.length > 0 && pre.every(Boolean),
      allPost: sessions.length > 0 && pre.every((x) => !x),
      markers: boardsIdx.map((i) => ({ i, cls: "st-wash" })),
      rules: boundary === null ? [] : [{ at: boundary, cls: "st-erule" }],
    };
  }

  /* ---------- ordering and filtering ------------------------------ */

  const SORTS = {
    /* |last| descending: the names the distribution currently cares most
       about, either side, which is the question this page answers first. */
    abs: (a, b) => Math.abs(b.last ?? 0) - Math.abs(a.last ?? 0)
      || b.n - a.n || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0),
    last: (a, b) => (b.last ?? -Infinity) - (a.last ?? -Infinity)
      || b.n - a.n || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0),
    n: (a, b) => b.n - a.n
      || Math.abs(b.last ?? 0) - Math.abs(a.last ?? 0)
      || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0),
  };

  const SORT_WORDS = {
    abs: "strongest last score first",
    last: "last score, high to low",
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

  function buildScaffold() {
    if (built) return;
    built = true;

    const controls = el("div", "st-controls");
    const search = UI.searchBox({
      label: "Filter", placeholder: "Ticker", prefix: "st", id: "stQ",
      onInput: (v) => { state.q = v; state.shown = PAGE; renderBody(); },
    });
    const sort = UI.sortSelect({
      label: "Order", prefix: "st", id: "stSort",
      options: [
        { value: "abs", label: "Strongest last score first", selected: true },
        { value: "last", label: "Last score, high to low" },
        { value: "n", label: "Most sessions measured first" },
      ],
      onChange: (v) => { state.sort = v; state.shown = PAGE; renderBody(); },
    });
    controls.append(search.root, sort.root);
    trackHost.append(controls);

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
    const hLast = el("th", "c-num st-c-last");
    hLast.scope = "col";
    const lastAbbr = el("abbr", null, "Last");
    lastAbbr.title = "The most recent published score in the window — the same " +
      "composite the board printed that morning, signed.";
    hLast.append(lastAbbr);
    hr.append(hLast);
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
  function stripWidth() {
    if (panelEl) panelEl.hidden = false;
    const w = axisHost && axisHost.clientWidth;
    return Math.max(48, Math.min(1600, Math.round(w) || 240));
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
    td.title = r.t + " " + MID + " scored " + r.n + " of " + S + " " +
      plural(S, "session", "sessions") +
      (r.n < S ? " — the empty stretches are sessions it was not scored, never zeros" : "") +
      " " + MID + " last " + fmtSigned(r.last);
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

    /* ZERO IS PRINTED AT FULL INK with no tone class: it is a measurement,
       and dimming it would file it beside the em dash it must never
       resemble. The tint on the signed cases repeats a sign the glyph
       already carries — hue as confirmation, never the carrier. */
    const last = el("td", "c-num st-c-last" +
      (r.last === null ? " is-none" : r.last > 0 ? " fb-pos" : r.last < 0 ? " fb-neg" : ""),
      fmtSigned(r.last));
    if (r.last === null) {
      last.title = "No last score was published for this name. Not measured — not zero.";
    } else if (r.last === 0) {
      last.title = "A measured zero: the pipeline scored this name at exactly 0 — " +
        "the middle of the distribution, not an absence.";
    }
    tr.append(last);

    tr.append(el("td", "c-num st-c-n", fmtInt(r.n)));
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
      td.colSpan = 4;
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
    backfill: "Board-only sessions",
    epoch: "The selection epoch",
    window: "The window",
  };
  const BASIS_ORDER = ["score", "gaps", "backfill", "epoch", "window"];

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
    const namesShed = isNum(payload.namesShed) ?? 0;
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
      (namesShed > 0 && namesSeen !== null
        ? " — the most-observed " + names.length + " of " + namesSeen + " seen; " +
          namesShed + " shed"
        : ""));

    if (sources) {
      const full = isNum(sources.full) ?? 0;
      const boardsOnly = isNum(sources.boardsOnly) ?? 0;
      parts.push(full + " " + plural(full, "session", "sessions") + " scored in full, " +
        boardsOnly + " reconstructed from the archived boards alone");
    }

    if (archive) {
      const probed = isNum(archive.probed);
      const failed = isNum(archive.failed) ?? 0;
      const abandoned = archive.abandoned === true;
      if (failed > 0 || abandoned) {
        /* A FACT ABOUT THE STORE, NOT THE MARKET. A walk that lost keys
           leaves columns missing here that exist in the archive, and a
           page that stayed quiet about it would present the loss as a
           quiet stretch of sessions. */
        parts.push("the archive could not be fully read: " +
          (failed > 0
            ? failed + " of " + (probed === null ? "the" : probed) + " probed " +
              plural(failed, "key", "keys") + " failed"
            : "") +
          (failed > 0 && abandoned ? " and " : "") +
          (abandoned ? "the walk was abandoned partway" : "") +
          " — sessions may be missing from this window that exist in the store");
      } else if (probed !== null) {
        parts.push("all " + probed + " probed archive keys were read");
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

  function renderStale(updatedAt) {
    if (!staleEl || !updatedAt) return;
    const ageHours = (Date.now() - updatedAt) / 3600000;
    if (ageHours <= 30) return;
    /* THE SAME STALENESS RULE THE BOARD AND THE CALENDAR USE. It matters
       here because a stale track does not look stale — it looks like a
       week in which every trace simply stopped moving. */
    staleEl.hidden = false;
    staleEl.textContent = "This track was last written " + Math.round(ageHours / 24) +
      " day(s) ago. The pipeline has not published since, so the right-hand edge " +
      "of every strip is that run's session and not today's.";
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

    renderStale(payload.__updatedAt);

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
