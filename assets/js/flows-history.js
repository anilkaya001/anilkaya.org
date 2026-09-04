/* =============================================================
   flows-history.js — the track record.

   For months this product asserted "expect a hit rate near 51–52%" in
   a footer and measured nothing. It could not have: flows_payload was
   keyed by id alone, so every morning `board:long` overwrote
   `board:long`, and by the time any forward return existed there was
   no surviving record of what had been claimed. A signal you cannot
   score is a claim, not a measurement.

   THIS PAGE IS DESIGNED TO BE HONEST WHILE EMPTY, which is the state
   it ships in and will hold for weeks. Retention begins with the first
   pipeline run after deploy; nothing can be scored at the shortest
   horizon until that many sessions have passed. Everything here is
   built so that "not yet measurable" and "measured and poor" render
   differently — a track record that appeared fully formed on the day
   it shipped would be a backtest wearing a live-results label.

   THE SAMPLE SIZE IS THE HEADLINE. Every figure on this page is
   printed with the n it came from, and n is never hidden behind a
   percentage. Eight sessions of a coin flip produce a 62% hit rate
   about a quarter of the time.
   ============================================================= */
(() => {
  "use strict";

  const statusEl = document.getElementById("recStatus");
  const curveHost = document.getElementById("recCurve");
  const curveNote = document.getElementById("recCurveNote");
  const wrap = document.getElementById("recTableWrap");
  const body = document.getElementById("recBody");
  if (!statusEl || !curveHost || !body) return;

  const COLUMNS = 6;                 // keep in sync with the <thead> in flows-pages.js
  const MINUS = "−";            // U+2212, not a hyphen
  const DASH = "—";

  /* BELOW THIS, NOTHING IS DRAWN AS A RESULT. Not a significance test — this
     page runs no test and claims no significance — but a floor under which a
     mean is so dominated by its own sampling error that plotting it invites a
     reading the number cannot support. Stated, not hidden. */
  const MIN_SESSIONS = 5;

  let drawnHorizons = null;          // the last horizons handed to renderCurve
  let drawnMeta = {};                // and the epoch prose that rode with them

  /* ONE PUBLISH CADENCE PLUS SLACK, and one weekend plus one public holiday —
     the same two numbers assets/js/flows-ui.js uses for every other Flows
     surface. They are duplicated here rather than imported because this route
     does not load flows-ui.js and this file cannot change which scripts the
     page pulls; if that changes, delete these and call UI.staleness(). What
     may NOT happen is the two drifting: two routes wording one outage
     differently is how a reader concludes they are looking at two outages. */
  const STALE_WRITE_MS = 30 * 60 * 60 * 1000;
  const STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;
  /* A SESSION DATE IS A CALENDAR DAY AND NOTHING ELSE, and the shape is
     checked BEFORE the parse. This was the one place the duplicate had
     already drifted from the copy in flows-ui.js it promises not to drift
     from: it handed `payload.sessionDate` straight to Date.parse, and
     Date.parse is lenient enough to be dangerous — "2026-09" + "T21:00:00Z"
     comes back FINITE in V8 and dates this record to the first of a month
     nobody published, while a bare "2026" dates it to January and raises a
     four-day-stale banner over a record that may be this morning's. What did
     not parse as a day belongs with the silences, not the measurements. */
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  /* The missing-value test comes BEFORE the coercion — Number(null) is 0 and
     0 is finite, so the naive shape turns an absent hit rate into "0%" and
     plots an absent horizon ON the zero line, both of them confident readings
     of nothing. */
  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const svgEl = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  };

  function pct(v, d) {
    const n = isNum(v);
    if (n === null) return DASH;
    const s = (Math.abs(n) * 100).toFixed(d === undefined ? 2 : d);
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + s + "%";
  }

  /* A HORIZON IS A COUNT OF SESSIONS AND CARRIES THE WORD. "1 sessions" rode
     every aria-label and every point title on this chart. */
  const kSaid = (k) => k + (k === 1 ? " session" : " sessions");

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function signClass(v) {
    const n = isNum(v);
    return n === null ? "" : n < 0 ? " fb-neg" : n > 0 ? " fb-pos" : " fb-flat";
  }

  /* ---------- the horizon curve ------------------------------------

     Long-minus-short by horizon, with a zero line that is always drawn and
     always at zero. A chart of returns whose baseline floats to the data's
     minimum turns a uniformly negative record into a rising line, which is
     the single most common way this kind of plot lies.

     TWO SERIES, BECAUSE THE PAYLOAD CARRIES TWO POPULATIONS.

     The scorer reports the horizon means separately on either side of the
     selection epoch — `ls`/`n` under the current rule, `prior`/`priorN`
     before it — precisely so that two different populations are never
     averaged into one number. This renderer read only the first for the whole
     life of the page. On a run where EVERY retained session predates the
     epoch (the pipeline's log records exactly that shape: 22 of 22) the curve
     plotted nothing, the page said no session had been scored, and a fully
     measured 22-session record sat unread in the same object it was handed.

     The two series are told apart WITHOUT HUE — the prior rule is dashed with
     hollow dots, named in the note and named in the aria-label — so the
     distinction survives greyscale and a monochrome printout. */

  /**
   * The drawing width, MEASURED FROM THE HOST and never floored above it.
   *
   * This emitted `width:"100%"` for its whole life, which is the chart
   * invariant's quieter failure: the viewBox says W units, the box says
   * whatever CSS gives it, and one viewBox unit stops being one CSS pixel the
   * moment those disagree — 9px axis type rendering at 5px on a phone. The
   * width attribute is now explicit. It is also clamped DOWN to the host,
   * because an explicit width larger than the box it sits in is horizontal
   * overflow at 320px, which the old 300-unit floor would have produced the
   * moment the floor stopped being masked by width:100%.
   */
  function curveWidth() {
    /* MEASURED TWO WAYS AND THE SMALLER TAKEN, because `clientWidth` alone
       broke the promise the comment above makes. It ROUNDS: a 284.813px host
       reports 285, so the svg went out with width="285" over a 285-unit
       viewBox into a 284.813px box — wider than the box it is "clamped DOWN
       to", with the `max-width:100%` rule that exists for the 160ms of a
       resize holding it in permanently and one viewBox unit worth 0.99934 CSS
       pixels. getBoundingClientRect() is the border box, so it is the
       truthful reading only while this host carries no padding or border (it
       carries neither); if that changes, the larger reading loses and this
       falls back to exactly what it did before. */
    const rect = Math.floor(curveHost.getBoundingClientRect().width);
    const client = Math.floor(curveHost.clientWidth);
    const host = rect > 0 && client > 0 ? Math.min(rect, client)
      : Math.max(rect > 0 ? rect : 0, client > 0 ? client : 0);
    return host > 0 ? Math.min(760, host) : 300;
  }

  function renderCurve(horizons, meta) {
    drawnHorizons = horizons;             // kept for the resize repaint
    drawnMeta = meta || {};
    curveHost.replaceChildren();

    /* Each horizon passes through isNum ONCE, here, and everything below
       plots the result — filtering on the coercion and then drawing the raw
       field is how a string survives to arithmetic. `n` is no longer floored
       at zero on the way in: an absent count is not a count of zero, and the
       floor test below now has to see the absence to refuse it. */
    const rows = (Array.isArray(horizons) ? horizons : [])
      .map((h) => ({
        k: isNum(h && h.k),
        ls: isNum(h && h.ls),
        n: isNum(h && h.n),
        prior: isNum(h && h.prior),
        priorN: isNum(h && h.priorN),
      }))
      .filter((h) => h.k !== null);

    /* A MEAN NEEDS BOTH ITS VALUE AND ITS SAMPLE SIZE to be drawn. Either
       missing is an absence, and an absence is not plotted at all — never at
       zero, which is a real published return. */
    const plottable = (v, n) => v !== null && n !== null && n >= MIN_SESSIONS;
    const cur = rows.filter((h) => plottable(h.ls, h.n));
    const pri = rows.filter((h) => plottable(h.prior, h.priorN));

    if (!cur.length && !pri.length) {
      const p = document.createElement("p");
      p.className = "rec-empty";
      /* THE DEEPEST SAMPLE EITHER POPULATION HAS, so a record that is entirely
         pre-epoch reports its real size rather than the current rule's zero. */
      let best = null;
      for (const h of rows) {
        for (const n of [h.n, h.priorN]) {
          if (n !== null && (best === null || n > best)) best = n;
        }
      }
      p.textContent = best !== null && best > 0
        ? "No horizon has reached " + MIN_SESSIONS + " scored sessions yet — the " +
          "longest has " + best + ". Nothing is plotted, because a mean of " +
          best + " observations is mostly its own sampling error."
        /* NOT "no session has been scored": the table below can hold rows
           while this is true. A session reaches a horizon mean only once that
           horizon has closed AND both sides of the spread were measured, so
           the sentence is about horizons, which is what this chart draws. */
        : "No horizon carries a scored session yet. The record begins with the " +
          "first pipeline run after this page shipped, and the shortest horizon " +
          "needs that many sessions to close — with both sides of the spread " +
          "measured — before it can be plotted.";
      curveHost.append(p);
      return;
    }

    /* THE HORIZON AXIS IS THE UNION OF WHAT EITHER SERIES CAN PLOT, ordered by
       horizon rather than by position in an array. Indexing x by an array
       position was safe while one series was drawn and silently wrong the
       moment there were two: the prior rule's k=21 would have landed on the
       current rule's k=10 whenever the two subsets differed. */
    const axis = [...new Set([...cur, ...pri].map((h) => h.k))].sort((a, b) => a - b);

    const W = curveWidth();
    /* The prior series adds a second n line under each point, and the frame
       grows to hold it rather than the label hanging outside the viewBox. */
    const H = pri.length ? 234 : 220;
    const padL = 54, padR = 18, padT = 18, padB = pri.length ? 54 : 40;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const values = [...cur.map((h) => h.ls), ...pri.map((h) => h.prior)];
    /* The domain always INCLUDES zero, and is padded symmetrically, so the
       zero line sits where the eye expects it and a negative record cannot be
       cropped out of frame. Both series share it: two lines on two scales
       would be a comparison nobody can make. */
    const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
    const span = Math.max(hi - lo, 1e-4);
    const pad = span * 0.15;
    const yLo = lo - pad, yHi = hi + pad;
    const yOf = (v) => padT + plotH - ((v - yLo) / (yHi - yLo)) * plotH;
    const xOf = (k) => padL + (axis.length === 1
      ? plotW / 2
      : (axis.indexOf(k) / (axis.length - 1)) * plotW);

    const svg = svgEl("svg", {
      class: "rc", viewBox: `0 0 ${W} ${H}`, width: W, height: H,
      /* A TRANSIENT CLAMP, NOT THE SIZING MECHANISM. The width attribute is
         what sizes this drawing, and it equals the host, so this rule is inert
         in the settled state. It exists for the ~160ms between a viewport
         shrinking and the debounced repaint: without it the previous, wider
         svg is briefly wider than the page, and a chart that overflows the
         viewport for a sixth of a second is still a chart that overflows the
         viewport. */
      style: "max-width:100%",
      role: "img", preserveAspectRatio: "xMidYMid meet",
      /* THE PLOT REGION, PUBLISHED. Whether the zero line lands inside the
         band reserved for data or gets crammed into the top margin is the
         whole difference between an honest chart and one scaled to flatter a
         losing record — and from outside, those two are only a few pixels
         apart on a fixture whose padding happens to rescue it. The contract
         reads these to assert the zero line is where data lives, rather than
         merely somewhere on the canvas. */
      "data-plot-top": padT,
      "data-plot-height": plotH,
    });

    svg.append(svgEl("line", {
      class: "rc-zero", x1: padL, x2: W - padR, y1: yOf(0), y2: yOf(0),
    }));
    /* A SINGLE "0" IS NOT A SCALE. With only the zero line labelled a reader
       can see the shape of the record and not its size — a chart on which
       +0.2% and +20% are drawn identically. The extremes of the domain are
       labelled too, so the vertical distance means something. */
    for (const v of [yHi, 0, yLo]) {
      const y = yOf(v);
      const t = svgEl("text", {
        class: v === 0 ? "rc-axislabel is-zero" : "rc-axislabel",
        x: padL - 8, y: y + 4, "text-anchor": "end",
      });
      t.textContent = v === 0 ? "0" : pct(v, 1);
      svg.append(t);
    }

    /* NO SEGMENT ACROSS A HORIZON THE SERIES DOES NOT HAVE. A line drawn from
       k=5 to k=21 through a k=10 this population never measured is a claim
       nobody made — the same refusal to interpolate the score track's strips
       obey, and the reason the path is built by walking the shared axis and
       lifting the pen rather than by joining the points a series happens to
       hold. */
    function pathFor(series, valueOf) {
      const have = new Map(series.map((h) => [h.k, valueOf(h)]));
      let d = "", open = false;
      for (const k of axis) {
        if (!have.has(k)) { open = false; continue; }
        d += (open ? " L" : d ? " M" : "M") +
          xOf(k).toFixed(2) + " " + yOf(have.get(k)).toFixed(2);
        open = true;
      }
      return d;
    }

    /* THE PRIOR RULE IS DRAWN FIRST so the current rule sits over it, and it
       is dashed rather than tinted: series identity has to survive greyscale
       and a monochrome printout, so it is carried by the stroke pattern and by
       the words in the note, never by hue. */
    if (pri.length) {
      svg.append(svgEl("path", {
        class: "rc-line is-prior", d: pathFor(pri, (h) => h.prior),
        "stroke-dasharray": "6 4",
      }));
    }
    if (cur.length) {
      svg.append(svgEl("path", { class: "rc-line", d: pathFor(cur, (h) => h.ls) }));
    }

    const byK = new Map();
    for (const h of cur) byK.set(h.k, { ...(byK.get(h.k) || {}), cur: h });
    for (const h of pri) byK.set(h.k, { ...(byK.get(h.k) || {}), pri: h });

    for (const k of axis) {
      const at = byK.get(k) || {};
      const x = xOf(k);

      if (at.pri) {
        /* HOLLOW, so the two series differ in shape as well as in stroke. The
           fill and stroke are presentation attributes because no stylesheet
           rule exists for this series, and `.rc-dot` alone sets neither. */
        const dot = svgEl("circle", {
          class: "rc-dot is-prior", cx: x, cy: yOf(at.pri.prior), r: 4,
          fill: "none", stroke: "currentColor", "stroke-width": 1.4,
        });
        const title = svgEl("title");
        title.textContent = kSaid(k) + " under the PRIOR selection rule: " +
          pct(at.pri.prior) + " long minus short, over " + at.pri.priorN +
          " scored session" + (at.pri.priorN === 1 ? "" : "s");
        dot.append(title);
        svg.append(dot);
      }

      if (at.cur) {
        const dot = svgEl("circle", {
          class: "rc-dot " + (at.cur.ls < 0 ? "is-neg" : at.cur.ls > 0 ? "is-pos" : "is-flat"),
          cx: x, cy: yOf(at.cur.ls), r: 4.5,
        });
        const title = svgEl("title");
        title.textContent = kSaid(k) + ": " + pct(at.cur.ls) + " long minus short, over " +
          at.cur.n + " scored session" + (at.cur.n === 1 ? "" : "s");
        dot.append(title);
        svg.append(dot);
      }

      const xl = svgEl("text", { class: "rc-ticklabel", x, y: H - padB + 20, "text-anchor": "middle" });
      xl.textContent = k + "d";
      svg.append(xl);

      /* n RIDES EVERY POINT, AND EACH SERIES CARRIES ITS OWN. A percentage
         without its sample size is the thing this page exists to stop
         printing, and two populations sharing one n would be worse than
         either printing none. */
      if (at.cur) {
        const nl = svgEl("text", { class: "rc-nlabel", x, y: H - padB + 33, "text-anchor": "middle" });
        nl.textContent = "n=" + at.cur.n;
        svg.append(nl);
      }
      if (at.pri) {
        const nl = svgEl("text", { class: "rc-nlabel is-prior", x, y: H - padB + (at.cur ? 44 : 33), "text-anchor": "middle" });
        nl.textContent = "prior n=" + at.pri.priorN;
        svg.append(nl);
      }
    }

    const said = [];
    if (cur.length) {
      said.push("Current selection rule: " +
        cur.map((h) => kSaid(h.k) + ", " + pct(h.ls) + " over " + h.n +
          (h.n === 1 ? " session" : " sessions")).join("; "));
    }
    if (pri.length) {
      said.push("Prior selection rule" + (drawnMeta.epoch ? " (before " + drawnMeta.epoch + ")" : "") +
        ", drawn dashed: " +
        pri.map((h) => kSaid(h.k) + ", " + pct(h.prior) + " over " + h.priorN +
          (h.priorN === 1 ? " session" : " sessions")).join("; "));
    }
    svg.setAttribute("aria-label",
      "Long-minus-short price return by holding horizon. " + said.join(". ") + ".");
    curveHost.append(svg);

    /* A HORIZON NEITHER POPULATION COULD PLOT — AND THE TWO REASONS IT COULD
       NOT ARE NOT THE SAME SENTENCE.

       This counted `rows.length - axis.length` and reported the whole
       remainder as "too few closed sessions", which is a measurement. It is
       only a measurement for the horizons whose n WAS published and fell
       under the floor. A horizon that published a mean and no n at all — or
       no mean — was refused for the opposite reason: nothing about its depth
       was stated, and saying it has "too few closed sessions" invents the
       very count whose absence caused the refusal. Two silences, two
       sentences, the same rule the rest of this product prints them under.
       (Counting off the rows rather than off `axis.length` also stops two
       rows sharing one k from being reported as one skipped horizon.) */
    const plotState = (v, n) => (v === null || n === null ? "unstated"
      : n >= MIN_SESSIONS ? "plot" : "thin");
    let thin = 0, unstated = 0;
    for (const h of rows) {
      const a = plotState(h.ls, h.n), b = plotState(h.prior, h.priorN);
      if (a === "plot" || b === "plot") continue;
      if (a === "thin" || b === "thin") thin++;
      else unstated++;
    }
    if (curveNote) {
      const note = ["Equal-weighted price return of the published long names minus the " +
        "short names, measured from the close each board was published at."];
      if (pri.length) {
        note.push("The dashed line with hollow dots is the record under the PRIOR " +
          "selection rule" + (drawnMeta.epoch ? ", before " + drawnMeta.epoch : "") +
          ", drawn beside the current one rather than averaged into it, and carrying " +
          "its own n at every point." +
          (cur.length ? "" : " Every session retained so far predates the epoch, so the " +
            "solid line has nothing to draw — that is the shape of the archive, not a " +
            "record of zero."));
        /* THE EPOCH PROSE IS THE PAYLOAD'S OWN. A renderer paraphrasing why
           two populations are reported separately is a renderer inventing the
           methodology it is supposed to be quoting. */
        if (drawnMeta.epochNote) note.push(drawnMeta.epochNote + ".");
      }
      if (thin > 0) {
        note.push(thin + " horizon" + (thin === 1 ? " has" : "s have") +
          " been measured in at least one population and has fewer than " +
          MIN_SESSIONS + " closed sessions there, which is under the floor this " +
          "page plots at.");
      }
      if (unstated > 0) {
        note.push(unstated + " horizon" + (unstated === 1 ? " carries" : "s carry") +
          " no population with both a mean and the number of sessions it was taken " +
          "over, so " + (unstated === 1 ? "it is" : "they are") + " not plotted — " +
          "that is a gap in what was published, not a count of closed sessions.");
      }
      curveNote.textContent = note.join(" ");
    }
  }

  /* ---------- the per-session table -------------------------------- */

  function renderSessions(sessions) {
    body.textContent = "";
    if (!sessions.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = COLUMNS;
      td.className = "flows-empty";
      td.textContent = "No session has closed a horizon yet.";
      tr.append(td);
      body.append(tr);
      wrap.hidden = false;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const s of sessions) {
      const tr = document.createElement("tr");

      const th = document.createElement("th");
      th.scope = "row";
      th.className = "fb-tk";
      th.textContent = String(s.d || DASH);
      tr.append(th);

      /* THE TWO LEGS ARE NOT COLOURED, AND THAT IS DELIBERATE.

         Green-for-positive is a claim that up is good, and it is false for
         half this table: the Short column is the price return of the names the
         board leaned AGAINST, so a positive number there means they rose and
         the call was wrong. Rendered green beside a green Long column it reads
         as two wins, when it is one win and one loss.

         Only the difference is a result whose sign means anything, so only the
         difference carries the sign colour. The legs are inputs and are shown
         as measurements. */
      tr.append(cell(pct(s.long), "c-num c-leg"));
      tr.append(cell(pct(s.short), "c-num c-leg"));
      tr.append(cell(pct(s.ls), "c-num" + signClass(s.ls)));

      const hit = isNum(s.hit);
      tr.append(cell(hit === null ? DASH : (hit * 100).toFixed(0) + "%", "c-num"));

      /* ATTRITION IS A DATA-QUALITY COLUMN, NOT A RESULT. A name that left
         the screened universe before its horizon closed cannot be scored, and
         the ones that leave are not a random sample — they are disproportionately
         the ones something happened to. A row losing many names is not a noisy
         measurement of that session, it is close to no measurement of it. */
      const lost = isNum(s.lost);
      const total = isNum(s.names);
      const lostCell = cell(
        lost === null ? DASH : total ? lost + " of " + total : String(lost),
        "c-num",
      );
      if (lost !== null && total && lost / total > 0.2) {
        lostCell.className = "c-num is-attrition";
        lostCell.title = "More than a fifth of this session's names could not be " +
          "scored. Names that leave the universe are not a random sample, so treat " +
          "this row's return as unreliable rather than merely noisy.";
      }
      tr.append(lostCell);

      frag.append(tr);
    }
    body.append(frag);
    wrap.hidden = false;
  }


  /* ---------- the per-feature evidence table ----------------------- */

  /* THE ECONOMIC HYPOTHESIS RIDES EACH ROW. An IC without the claim it
     tests is a number shopping for a story; the claim is stated here, in
     the renderer, so a feature added to the payload before its prose lands
     degrades to its bare key rather than to an invented sentence. */
  const HYPOTHESES = {
    "s": "the composite itself \u2014 the product's own claim, measured against what followed",
    "cnv": "conviction: agreement across independent sources should mark flow that persists",
    "chg": "the session's own return: does a move continue or hand it back",
    "purity": "a one-sided tape should carry more information than the same volume churned",
    "gFlipDist": "distance to the gamma flip: dealer hedging pressure is strongest near it",
    "netPrem": "signed premium: money is a costlier vote than contract count",
    "w52": "position in the 52-week range: breakout names and basing names behave differently",
    "vrp": "variance risk premium: implied rich of delivered tends to revert",
    "ivr": "IV rank: the extremes of a name's own volatility year",
    "im": "the priced move: how much movement the vendor's quote already charges for",
    "hm": "the priced move rescaled to the fixed horizon every row shares",
    "hr": "delivered movement at that same fixed horizon",
    "fam.F": "flow family: aggressor-side pressure on the day's tape",
    "fam.P": "positioning family: what actually stuck in open interest",
    "fam.D": "path family: a direction held all day is a different fact from one print",
    "fam.V": "volatility gauge \u2014 unsigned, so any relation is about vol regime, not direction",
    "fam.O": "quality gauge \u2014 unsigned; tests whether cleaner flow predicts better",
    "pr.0": "trailing 5-session return: momentum at the fastest speed the board keeps",
    "pr.1": "trailing 21-session return: one-month momentum",
    "pr.2": "trailing 42-session return: two-month momentum",
  };

  function renderFeatures(features) {
    const wrap = document.getElementById("recFeatWrap");
    const body = document.getElementById("recFeatBody");
    const notes = document.getElementById("recFeatNotes");
    if (!wrap || !body || !notes) return;

    /* TRANSITIONAL BY CONSTRUCTION: a record blob written before this table
       existed simply lacks the key, and the honest rendering of that is
       "not yet measured", never an empty frame or a table of zeros. */
    if (!features || !Array.isArray(features.cols) || !features.cols.length) {
      const p = document.createElement("p");
      p.className = "rec-empty";
      p.textContent = "The evidence table has not been measured yet. It is " +
        "computed from the retained sessions on each pipeline run, so it " +
        "appears with the first run after this page shipped.";
      notes.replaceChildren(p);
      wrap.hidden = true;
      return;
    }

    body.textContent = "";
    const frag = document.createDocumentFragment();
    for (const col of features.cols) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.className = "fb-tk rec-feat-key";
      th.textContent = String(col.key);
      const hyp = HYPOTHESES[col.key];
      if (hyp) th.title = hyp;
      tr.append(th);

      const ic = isNum(col.ic);
      const icCell = cell(
        ic === null ? DASH : (ic < 0 ? MINUS : ic > 0 ? "+" : "") + Math.abs(ic).toFixed(3),
        "c-num");
      /* An unmeasured coefficient SAYS WHY, in place — "constant column" and
         "too few pairs" are different facts and the payload distinguishes
         them; collapsing both to a bare dash would throw that away. */
      if (ic === null && col.reason) icCell.title = String(col.reason);
      tr.append(icCell);

      tr.append(cell(isNum(col.n) === null ? DASH : String(col.n), "c-num"));
      frag.append(tr);
    }
    body.append(frag);
    wrap.hidden = false;

    /* The methodology, verbatim from the payload — the reader holds the
       rules and the numbers together, and a change to the method must
       change this text or lie in public. */
    notes.textContent = "";
    const meta = document.createElement("p");
    meta.className = "rec-note";
    const k = isNum(features.k);
    const minN = isNum(features.minN);
    meta.textContent = "Horizon: " + (k === null ? DASH : k + " sessions") +
      " \u00b7 floor: " + (minN === null ? DASH : minN + " pairs") + ".";
    notes.append(meta);
    for (const key of ["method", "selection", "overlap", "calendar"]) {
      if (typeof features[key] !== "string" || !features[key]) continue;
      const p = document.createElement("p");
      p.className = "rec-note";
      p.textContent = features[key];
      notes.append(p);
    }
  }

  /* ---------- load -------------------------------------------------- */

  /* Redraw at the new width rather than letting the browser scale the old
     drawing — the same discipline as the card panels. */
  let resizeT = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!drawnHorizons) return;
      const svg = curveHost.querySelector("svg");
      const drawnW = svg ? Number(String(svg.getAttribute("viewBox")).split(/\s+/)[2]) : 0;
      /* The SAME width function the paint uses. These were two copies of one
         expression, and a repaint measuring the width differently from the
         paint is how the two quietly stop agreeing. */
      const w = curveWidth();
      if (svg && Math.abs(w - drawnW) < 8) return;
      /* The epoch prose rides along, or the resize would silently drop the
         sentence that explains the second series. */
      renderCurve(drawnHorizons, drawnMeta);
    }, 160);
  });

  /**
   * TWO INDEPENDENT WAYS A PUBLISHED RECORD IS NOT TODAY'S, and they get two
   * sentences because the remedies are two different people:
   *
   *   write   — the blob's own write time is old. The pipeline is not running.
   *   session — the write is fresh and the SESSION it describes is old. The
   *             pipeline is running and its input is frozen.
   *
   * THE RECORD IS THE SURFACE THAT NEEDS THIS MOST AND WAS THE ONLY ONE
   * WITHOUT IT. A stale board looks like a board that stopped moving; a stale
   * record looks exactly like a live record of the same good sessions, and it
   * will keep looking like one for as long as nobody publishes.
   *
   * The missing-value test comes before the coercion, as everywhere:
   * Number(null) is 0, 0 is a finite millisecond stamp — the epoch — and a
   * payload with no write header would otherwise be reported as fifty-six
   * years stale.
   */
  function renderStale(payload) {
    const written = isNum(payload && payload.__updatedAt);
    const now = Date.now();
    let message = null;

    if (written !== null && written > 0 && now - written > STALE_WRITE_MS) {
      const hours = Math.floor((now - written) / 3600000);
      const days = Math.floor(hours / 24);
      /* The hour branch cannot fire while the threshold is 30 hours. It is
         here so that lowering the threshold can never start printing
         "0 days", which is a confident zero wearing a unit. */
      const age = days >= 1
        ? days + (days === 1 ? " day" : " days")
        : hours + (hours === 1 ? " hour" : " hours");
      message = "This record was last written " + age + " ago. The pipeline has " +
        "not published since — check the Actions tab. Every figure below is that " +
        "run's, and no session has been scored into it since.";
    } else if (payload && ISO_DAY.test(String(payload.sessionDate || ""))) {
      /* 21:00Z is after every US close, so a session date is aged from the end
         of its own session rather than from its midnight. */
      const session = Date.parse(String(payload.sessionDate) + "T21:00:00Z");
      if (Number.isFinite(session) && now - session > STALE_SESSION_MS) {
        message = "These numbers describe the " + payload.sessionDate + " session, " +
          "which is more than four days old. The pipeline is running but its data " +
          "is not advancing, so no new session has been scored into the record.";
      }
    }
    if (!message) return;

    /* The page template carries no element for this, and this file cannot
       change the template, so the band is created beside the status line it
       qualifies — same class and same role as the one every other Flows
       surface renders. */
    const band = document.createElement("p");
    band.className = "flows-stale";
    band.setAttribute("role", "status");
    band.textContent = message;
    statusEl.insertAdjacentElement("afterend", band);
  }

  fetch("/api/flows/record", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then((response) => {
    if (response.status === 401) { location.replace("/flows/"); return null; }
    if (!response.ok) throw new Error("HTTP " + response.status);
    /* X-Payload-Updated is stamped by the Worker onto every passthrough, and
       is annotated onto the payload as __updatedAt — a client-side note, not
       a claim the pipeline writes the field. The same read every other Flows
       page performs; this one simply never performed it. */
    const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
    return response.json().then((payload) => {
      if (payload && typeof payload === "object") payload.__updatedAt = updatedAt;
      return payload;
    });
  }).then((payload) => {
    if (!payload) return;

    const horizons = Array.isArray(payload.horizons) ? payload.horizons : [];
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const retained = isNum(payload.retained);

    renderStale(payload);
    renderCurve(horizons, {
      epoch: typeof payload.epoch === "string" ? payload.epoch : null,
      epochNote: typeof payload.epochNote === "string" ? payload.epochNote : null,
    });
    renderSessions(sessions);
    renderFeatures(payload.features);

    if (payload.status === "pending" || (!horizons.length && !sessions.length)) {
      /* THE ORDINARY STATE ON DAY ONE, and it is stated as a fact about the
         store rather than as an error. The alternative — an empty chart with
         no explanation — reads as a broken page, and the alternative to THAT
         is inventing a history, which is worse than both. */
      statusEl.textContent =
        "The record is empty. Each session's board is retained from the first " +
        "pipeline run after this shipped, and the shortest horizon needs that " +
        "many sessions to close before anything here can be measured.";
      return;
    }

    /* THE COLD START, NAMED. Before this branch existed the page answered
       "why is there nothing here?" with the string "0 sessions retained." —
       true, and the single least useful true sentence available, because a
       reader staring at an empty chart already knows the count is zero. What
       they cannot know is whether zero means BROKEN or means NEW.

       It means new, and the payload can prove it: `archiveProbed` is how many
       dated keys the run asked the store for. Zero retained out of a hundred
       and eighty probed is a cold archive; zero out of zero would be a broken
       session date, and reads the same on the page unless the denominator is
       said out loud. The word is "readable", not "exists", on purpose — a
       missing key and a failed read were indistinguishable from the pipeline
       when this was written, and are not any more — see the branch below,
       which is what the archive counters were added to make possible. */
    if (retained === 0) {
      const probed = isNum(payload.archiveProbed);
      const k = isNum(payload.statedHorizon);
      const failed = isNum(payload.archiveFailed);

      /* A REFUSED STORE IS NOT A COLD ARCHIVE, AND MUST NOT READ AS ONE.

         This branch used to say "the ordinary first state of the record
         rather than a failure" whatever had happened, because the pipeline
         could not tell an absent key from a read that never completed. It can
         now — the ingest route answers an absent key with 200 and
         {status:"pending"}, so "absent" is a positive answer and anything else
         is a failure carrying its status. When reads failed, "nothing has been
         scored" is a claim about the SIGNAL resting on evidence that is really
         about the STORE, and this page has no business making it. */
      if (failed !== null && failed > 0) {
        statusEl.textContent =
          "The record could not be measured this session, and that is a fault " +
          "in the archive rather than a verdict on the signal. " + failed +
          " of " + (probed === null ? "the" : probed) + " archive read" +
          (failed === 1 ? "" : "s") + " failed, so this run could not tell " +
          "whether earlier sessions exist. Nothing below is evidence that the " +
          "board has never been right — it is evidence that the store did not " +
          "answer.";
        return;
      }

      statusEl.textContent =
        "Nothing has been scored yet, and this is the ordinary first state of " +
        "the record rather than a failure. A board is scored only against " +
        "closes that come AFTER the session it was published for, so today's " +
        "board" + (payload.sessionDate ? " (" + payload.sessionDate + ")" : "") +
        " cannot score itself" +
        (probed !== null
          ? ", and no earlier dated board was readable — " + probed +
            " dated key" + (probed === 1 ? " was" : "s were") +
            " probed and every one answered that it holds nothing."
          : ".") +
        " The first measured session appears on the next pipeline run" +
        (k !== null
          ? ", and the " + k + "-session horizon " + k + " runs after that."
          : ".");
      return;
    }

    const parts = [];
    if (retained !== null) parts.push(retained + " session" + (retained === 1 ? "" : "s") + " retained");

    /* "N SCORED" WAS A NUMBER ABOUT THE TABLE WEARING THE NAME OF THE RECORD.
       `sessions` is capped by the publisher; the horizon means are not. Once
       the archive passes the cap this line said "88 sessions retained · 30
       scored" directly above a point labelled n=78, and a reader reasonably
       took 30 as the number of sessions that have closed a horizon. What this
       count actually is, is the number of rows in the table below, so that is
       what it now says.

       And when the stated horizon's own means were taken over MORE sessions
       than the table lists, the table is provably a truncated slice and says
       so with both numbers. That comparison is sound in one direction only:
       every session counted in those means also qualified for the table (both
       score the same session at the same horizon, and the mean additionally
       requires a spread), so more counted than listed can only mean the
       listing was cut. The reverse tells us nothing, and nothing is claimed
       from it. */
    let closedAtStated = null;
    const stated = isNum(payload.statedHorizon);
    if (stated !== null) {
      const row = horizons.find((h) => isNum(h && h.k) === stated);
      if (row) {
        const n = isNum(row.n), pn = isNum(row.priorN);
        /* A floor, not a total: an absent half contributes nothing rather than
           inventing a count, and a floor can only ever UNDER-report the
           truncation it is used to detect. */
        /* The absence test comes first and contributes nothing, rather than
           `(n || 0)` coercing it — the same arithmetic, written so the next
           reader cannot mistake the shape for the coalesce that is banned
           three lines from here. */
        if (n !== null || pn !== null) {
          closedAtStated = (n === null ? 0 : n) + (pn === null ? 0 : pn);
        }
      }
    }
    if (sessions.length) {
      parts.push(sessions.length + " listed below" +
        (closedAtStated !== null && closedAtStated > sessions.length
          ? ", the most recent of at least " + closedAtStated + " sessions that have " +
            "closed the " + stated + "-session horizon with both legs measured"
          : ""));
    }
    /* THE SPLIT, SAID OUT LOUD WHENEVER THERE ARE SESSIONS ON BOTH SIDES OF IT.

       The board's selection rule changed, so sessions before that date scored
       a different population of names. The scorer reports the two separately
       instead of averaging them; if this page did not say so, a reader would
       see one curve with a gap in it and reasonably assume the gap was missing
       data rather than a different experiment. */
    const priorN = isNum(payload.priorRetained);
    const epochN = isNum(payload.epochRetained);
    if (payload.epoch && priorN && epochN !== null) {
      parts.push(
        epochN + " under the current selection rule, " + priorN + " before it (" +
        payload.epoch + "), reported separately");
    }
    if (payload.firstSession && payload.lastSession) {
      parts.push("from " + payload.firstSession + " to " + payload.lastSession);
    }
    statusEl.textContent = parts.length
      ? parts.join(" · ") + "."
      : "The record has begun but nothing has closed a horizon yet.";
  }).catch(() => {
    statusEl.textContent = "The record could not be loaded. Refresh to try again.";
  });
})();
