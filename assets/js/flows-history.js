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

  const isNum = (v) => {
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
    curveHost.replaceChildren();

    const usable = horizons.filter((h) => isNum(h.ls) !== null && (isNum(h.n) ?? 0) >= MIN_SESSIONS);
    if (!usable.length) {
      const p = document.createElement("p");
      p.className = "rec-empty";
      const best = horizons.reduce((m, h) => Math.max(m, isNum(h.n) ?? 0), 0);
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

    const W = 720, H = 220;
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

  /* ---------- load -------------------------------------------------- */

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

    const parts = [];
    if (retained !== null) parts.push(retained + " session" + (retained === 1 ? "" : "s") + " retained");
    if (sessions.length) parts.push(sessions.length + " scored");
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
