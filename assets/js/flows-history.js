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
     the single most common way this kind of plot lies. */

  function renderCurve(horizons) {
    drawnHorizons = horizons;             // kept for the resize repaint
    curveHost.replaceChildren();

    /* Each horizon passes through isNum ONCE, here, and everything below
       plots the result — filtering on the coercion and then drawing the raw
       field is how a string survives to arithmetic. */
    const usable = horizons
      .map((h) => ({ k: h.k, ls: isNum(h.ls), n: isNum(h.n) ?? 0 }))
      .filter((h) => h.ls !== null && h.n >= MIN_SESSIONS);
    if (!usable.length) {
      const p = document.createElement("p");
      p.className = "rec-empty";
      const best = horizons.reduce((m, h) => Math.max(m, isNum(h && h.n) ?? 0), 0);
      p.textContent = best > 0
        ? "No horizon has reached " + MIN_SESSIONS + " scored sessions yet — the " +
          "longest has " + best + ". Nothing is plotted, because a mean of " +
          best + " observations is mostly its own sampling error."
        : "No session has been scored yet. The record begins with the first " +
          "pipeline run after this page shipped, and the shortest horizon " +
          "needs that many sessions to close before it can be measured.";
      curveHost.append(p);
      return;
    }

    /* SIZED FROM THE HOST, the way every card panel is. A fixed 720-unit
       viewBox at width:100% scales — 9px axis type becomes 5px on a phone and
       oversized on a wide desk — which is the exact defect flows-card.js
       documents. One viewBox unit here is one CSS pixel. */
    const W = Math.max(300, Math.min(760, curveHost.clientWidth || 720)), H = 220;
    const padL = 54, padR = 18, padT = 18, padB = 40;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const values = usable.map((h) => h.ls);
    /* The domain always INCLUDES zero, and is padded symmetrically, so the
       zero line sits where the eye expects it and a negative record cannot be
       cropped out of frame. */
    const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
    const span = Math.max(hi - lo, 1e-4);
    const pad = span * 0.15;
    const yLo = lo - pad, yHi = hi + pad;
    const yOf = (v) => padT + plotH - ((v - yLo) / (yHi - yLo)) * plotH;
    const xOf = (i) => padL + (usable.length === 1
      ? plotW / 2
      : (i / (usable.length - 1)) * plotW);

    const svg = svgEl("svg", {
      class: "rc", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
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

    let d = "";
    usable.forEach((h, i) => { d += (i ? " L" : "M") + xOf(i) + " " + yOf(h.ls); });
    svg.append(svgEl("path", { class: "rc-line", d }));

    usable.forEach((h, i) => {
      const cy = yOf(h.ls);
      const dot = svgEl("circle", {
        class: "rc-dot " + (h.ls < 0 ? "is-neg" : "is-pos"),
        cx: xOf(i), cy, r: 4.5,
      });
      const title = svgEl("title");
      title.textContent = h.k + " sessions: " + pct(h.ls) + " long minus short, over " +
        h.n + " scored session" + (h.n === 1 ? "" : "s");
      dot.append(title);
      svg.append(dot);

      const xl = svgEl("text", { class: "rc-ticklabel", x: xOf(i), y: H - padB + 20, "text-anchor": "middle" });
      xl.textContent = h.k + "d";
      svg.append(xl);

      /* n RIDES EVERY POINT. A percentage without its sample size is the
         thing this page exists to stop printing. */
      const nl = svgEl("text", { class: "rc-nlabel", x: xOf(i), y: H - padB + 33, "text-anchor": "middle" });
      nl.textContent = "n=" + h.n;
      svg.append(nl);
    });

    svg.setAttribute("aria-label",
      "Long-minus-short price return by holding horizon. " +
      usable.map((h) => h.k + " sessions, " + pct(h.ls) + " over " + h.n + " sessions").join("; ") + ".");
    curveHost.append(svg);

    const skipped = horizons.length - usable.length;
    if (curveNote) {
      curveNote.textContent =
        "Equal-weighted price return of the published long names minus the short names, " +
        "measured from the close each board was published at. " +
        (skipped > 0
          ? skipped + " longer horizon" + (skipped === 1 ? " has" : "s have") +
            " too few closed sessions to plot yet."
          : "");
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
      const w = Math.max(300, Math.min(760, curveHost.clientWidth || 720));
      if (svg && Math.abs(w - drawnW) < 8) return;
      renderCurve(drawnHorizons);
    }, 160);
  });

  fetch("/api/flows/record", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then((response) => {
    if (response.status === 401) { location.replace("/flows/"); return null; }
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }).then((payload) => {
    if (!payload) return;

    const horizons = Array.isArray(payload.horizons) ? payload.horizons : [];
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const retained = isNum(payload.retained);

    renderCurve(horizons);
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
    if (sessions.length) parts.push(sessions.length + " scored");
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
