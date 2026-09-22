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

    statusEl.textContent = "This page's UI module (flows-ui.js) did not load, so " +
      "nothing can be drawn. Refresh to try again.";
    return;
  }

  const MINUS = UI.MINUS;
  const DASH = UI.DASH;
  const MID = UI.MID;
  const isNum = UI.isNum;
  const el = UI.el;
  const svgEl = UI.svgEl;
  const fmtSigned = UI.fmtSigned;
  const fmtInt = UI.fmtInt;

  const plural = (n, one, many) => (n === 1 ? one : many);

  const PAGE = 60;

  const state = { q: "", sort: "abs", shown: PAGE };
  let ctx = null;
  let drawnW = 0;

  let built = false;
  let capEl = null, bodyEl = null, axisHost = null, moreBtn = null;
  let changeEl = null;
  let stripHead = null;

  let colSet = { move: false, run: false, asOf: false };

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

  function readMove(raw) {
    if (!raw || typeof raw !== "object") return null;
    const v = isNum(raw.v), gap = isNum(raw.gap);
    if (v === null || gap === null || gap < 1) return null;
    return {
      v, gap,

      qv: isNum(raw.qv),
      cross: Object.prototype.hasOwnProperty.call(CROSS_RANK, raw.cross) ? raw.cross : null,
    };
  }

  function readExt(raw) {
    if (!raw || typeof raw !== "object") return null;
    const hi = isNum(raw.hi), lo = isNum(raw.lo);
    if (hi === null && lo === null) return null;
    return { hi, lo, hiAt: isNum(raw.hiAt), loAt: isNum(raw.loAt) };
  }

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

        n: isNum(r.n),
        last,
        lastAt,

        staleBy: lastAt === null || lastIndex < 0 ? null : lastIndex - lastAt,

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

      change: (payload.change && typeof payload.change === "object") ? payload.change : null,
      shedBy: typeof payload.shedBy === "string" ? payload.shedBy : null,
      shed: isNum(payload.namesShed),
      notes: (payload.notes && typeof payload.notes === "object") ? payload.notes : {},

      has: {

        now: rows.some((r) => r.lastAt !== null),

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

  const tie = (a, b) => descNum(a.n, b.n) || byTicker(a, b);

  const SORTS = {

    now: (a, b) => descNum(mag(a.now), mag(b.now)) || tie(a, b),

    abs: (a, b) => descNum(mag(a.last), mag(b.last)) || tie(a, b),
    last: (a, b) => descNum(a.last, b.last) || tie(a, b),

    move: (a, b) => descNum(moveMag(a), moveMag(b)) || tie(a, b),

    cross: (a, b) => ascNum(crossRank(a), crossRank(b))
      || descNum(moveMag(a), moveMag(b)) || tie(a, b),

    run: (a, b) => descNum(a.run, b.run) || tie(a, b),

    ext: (a, b) => ascNum(a.extGap, b.extGap) || descNum(mag(a.last), mag(b.last)) || tie(a, b),
    n: (a, b) => descNum(a.n, b.n) || descNum(mag(a.last), mag(b.last)) || byTicker(a, b),
  };

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

  function columnCount() {
    return 4 + (colSet.move ? 2 : 0) + (colSet.asOf ? 1 : 0) + (colSet.run ? 1 : 0);
  }

  function buildScaffold() {
    if (built) return;
    built = true;
    colSet = { move: ctx.has.move, run: ctx.has.run,
      asOf: ctx.has.now && ctx.rows.some((r) => r.staleBy !== 0) };

    const controls = el("div", "st-controls");
    const search = UI.searchBox({
      label: "Filter", placeholder: "Ticker", prefix: "st", id: "stQ",
      onInput: (v) => { state.q = v; state.shown = PAGE; renderBody(); },
    });

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

    lastAbbr.title = "The most recent score published for this name anywhere in " +
      "the window, signed — the same composite the board printed on the session " +
      "it was last scored in, which the As-of column names whenever any name " +
      "lags the latest session.";
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

  const MIN_STRIP = 100;

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

    if (stripHead) stripHead.style.width = "";
    let w = contentPx(axisHost);
    if (stripHead && w < MIN_STRIP) {

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

      svg.append(svgEl("rect", { class: "st-ax-srchatch", ...geom, fill: "url(#stHatch)" }));
    }

    if (ctx.boundary !== null || ctx.allPre) {
      const from = 0;
      const to = ctx.boundary === null ? S : ctx.boundary;
      const x1 = g.xEdge(from), x2 = g.xEdge(to);
      svg.append(svgEl("line", {
        class: "st-ax-pre", x1: x1.toFixed(2), x2: x2.toFixed(2), y1: 4, y2: 4,
      }));
    }
    if (ctx.boundary !== null) {
      const x = g.xEdge(ctx.boundary).toFixed(2);
      svg.append(svgEl("line", { class: "st-erule", x1: x, x2: x, y1: 0, y2: H }));
    }

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
        "font-size": "10px", "text-anchor": "middle",
      });

      t.textContent = ctx.sessions[i].d ? ctx.sessions[i].d.slice(5) : "?";
      svg.append(t);
    }

    axisHost.append(svg);
  }

  function dateAt(i) {
    const s = i === null || i === undefined ? null : ctx.sessions[i];
    return s && s.d ? s.d : null;
  }

  const tone = (v) => (v === null ? "" : v > 0 ? " fb-pos" : v < 0 ? " fb-neg" : "");

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

      const asOf = el("td", "st-c-asof" + (r.staleBy ? " is-old" : ""));
      const on = dateAt(r.lastAt);
      if (r.lastAt === null) {
        asOf.textContent = DASH;
        asOf.title = "This payload published no session index for this name, so " +
          "which session its score was measured on cannot be stated. That is a " +
          "gap in the payload, not a claim that the reading is old.";
      } else if (r.staleBy === 0) {

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

  function bandSaid() {
    return ctx.deadBand === null
      ? "No dead band was published with this track, so no crossing can be claimed " +
        "and none is."
      : "The dead band is ±" + ctx.deadBand + plural(ctx.deadBand, " score point", " score points") +
        " wide, and it is drawn to scale in every strip.";
  }

  function staleSaid() {
    if (!ctx.has.now || !ctx.sessions.length) return null;

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

        (ctx.has.nowScore ? "" : " No carried name was scored in the latest " +
          "session at all, so that ordering is not offered here and the page " +
          "opens on the last measured score instead."));
    }
    if (unknown) {
      said.push(unknown + " " + plural(unknown, "name carries", "names carry") +
        " no session index, so how old " + plural(unknown, "its reading is", "their readings are") +
        " cannot be stated.");
    }
    if (!old && !unknown) {
      said.push("Every carried name was scored in the latest session, so no As-of " +
        "column is drawn: each Last is that session's reading.");
    }
    return said.length ? said.join(" ") : null;
  }

  function changeSaid() {
    const ch = ctx.change;
    const said = [];

    if (!ch) {

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

      said.push("This track states a change status this page does not recognise" +
        (typeof ch.status === "string" && ch.status ? " (\u201c" + ch.status + "\u201d)" : "") +
        ", so the counts below are printed without the sentence that belongs to it.");
    }

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

  function renderNote() {
    if (!trackNote) return;
    const S = ctx.sessions.length;
    const parts = [];

    parts.push("Every strip is drawn on one scale shared by the whole page, " +
      fmtSigned(ctx.domain.lo) + " to " + fmtSigned(ctx.domain.hi) +
      ", so two names can be compared by eye; the horizontal rule in each is zero, " +
      "and which side of it the trace sits on is the sign.");

    if (ctx.deadBand !== null && ctx.deadBand > 0) {

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
        "rather than smoothed over. The dotted lane over the axis marks the " +
        "sessions before it.");
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

    for (const key of Object.keys(notes)) {
      if (drawnKeys.has(key)) continue;
      const node = basisItem(key, notes[key]);
      if (node) basisHost.append(node);
    }
    if (basisPanel) basisPanel.hidden = false;
  }

  function renderStatus(payload) {
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const names = Array.isArray(payload.names) ? payload.names : [];
    const windowSessions = isNum(payload.windowSessions);
    const namesSeen = isNum(payload.namesSeen);

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

    parts.push(names.length + " " + plural(names.length, "name", "names") +
      (namesShed !== null && namesShed > 0 && namesSeen !== null
        ? " — the most-observed " + names.length + " of " + namesSeen + " seen; " +
          namesShed + " shed"
        : ""));

    if (sources) {

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

        parts.push("the archive could not be fully read: " +
          (failed !== null && failed > 0
            ? failed + " of " + (probed === null ? "the" : probed) + " probed " +
              plural(failed, "key", "keys") + " failed"
            : "") +
          (failed !== null && failed > 0 && abandoned ? " and " : "") +
          (abandoned ? "the walk was abandoned partway" : "") +
          " — sessions may be missing from this window that exist in the store");
      } else if (probed !== null) {

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
        const iso = Number.isFinite(t) ? new Date(t).toISOString() : null;
        foot.push("Built " + (iso
          ? iso.slice(0, 10) + " " + iso.slice(11, 16) + " UTC" : String(payload.generatedAt)));
      }
      const v = isNum(payload.v);
      if (v !== null) foot.push("payload v" + v);
      foot.push("Zero vendor calls: the track is a view of the score archive the " +
        "pipeline already holds, rebuilt from it on every run.");
      footEl.textContent = foot.join(" " + MID + " ");
    }
  }

  function renderStale(payload) {
    if (!staleEl) return;
    if (typeof UI.staleness !== "function") {

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

  function showOnly(kind, msg) {
    trackHost.replaceChildren(UI.emptyState(kind, msg));
    if (panelEl) panelEl.hidden = false;
    if (trackNote) trackNote.textContent = "";
  }

  function failEverywhere(what) {
    statusEl.textContent = what;
    showOnly("unreadable", what);
    if (basisHost) {
      basisHost.replaceChildren(el("p", "fc-note",
        "The basis travels inside the same payload as the numbers, so it could not " +
        "be loaded either. Nothing on this page has been explained by the pipeline."));
      if (basisPanel) basisPanel.hidden = false;
    }
    if (footEl) footEl.textContent = "";
  }

  function renderTrack() {
    if (panelEl) panelEl.hidden = false;
    buildScaffold();
    drawnW = stripWidth();
    renderAxis(drawnW);
    renderChange();
    renderNote();
    renderBody();
  }

  get("/api/flows/scoretrack").then((payload) => {
    if (!payload) return;
    if (typeof payload !== "object") throw new Error("the endpoint answered with no payload");

    if (payload.status === "pending") {

      const msg = "The pipeline has not published this key yet. The track is " +
        "rebuilt by each after-close run from the dated score archive the pipeline " +
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

      renderStatus(payload);
      const count = payload.sessions.length;
      const msg = "No name carried a score in any of the " + count + " " +
        plural(count, "session", "sessions") + " the archive walk reconstructed. " +
        "That is a measured emptiness — the walk read every archived session in " +
        "the window and found no scored name — and not a missing publish.";
      showOnly("quiet", msg);
      renderBasis(payload);
      return;
    }

    renderStatus(payload);
    ctx = prepare(payload);

    state.sort = ctx.has.nowScore ? "now" : "abs";
    renderTrack();
    renderBasis(payload);
  }).catch((error) => {
    failEverywhere("The track could not be loaded: " + (error && error.message
      ? error.message : "the request failed") + ". Refresh to try again.");
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    if (!ctx) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (ctx && Math.abs(stripWidth() - drawnW) > 2) renderTrack();
    }, 150);
  });
})();
