/* =============================================================
   flows-watch.js — the dead band, which used to be an integer.

   Roughly forty-eight of every sixty scored names land inside the ±20
   band each session. The pipeline scores them completely — every
   family, every gate, every quality multiplier — and then reports them
   to the reader as a single count in a status line.

   That count is the least useful form of the information. A name at
   +19 is one session from publishing and nothing on the site let you
   see it coming. A name at +2 carrying the largest options-volume
   surprise in the universe is the most interesting row of the day and
   had nowhere to appear.

   NOTHING HERE CLEARED THE BAR, and every affordance on this page is
   built to keep that in view. There is no rank column, because a rank
   implies an ordering someone should act on; the sort is by distance
   to the band, which is a statement about measurement rather than
   about conviction. The score column carries its sign but no bar —
   the board's centre-origin bar is a visual claim of strength and
   these rows have none.
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

  /**
   * How far this score sits from the nearest edge of the band.
   *
   * Computed HERE rather than trusted from the payload, because it is a
   * function of the score and the band and both are already on the wire — a
   * third serialised field that must agree with two others is a field that
   * will eventually disagree with them.
   */
  function distanceToBand(score, band) {
    const s = isNum(score), b = isNum(band);
    if (s === null || b === null) return null;
    return Math.max(0, b - Math.abs(s));
  }

  function rowFor(row, band) {
    const tr = document.createElement("tr");

    const th = document.createElement("th");
    th.scope = "row";
    th.className = "fb-tk";
    /* The card deep-link is the same one the board uses, so a name being
       watched opens exactly the reader a published name would. */
    const link = document.createElement("a");
    link.href = "?t=" + encodeURIComponent(String(row.t || ""));
    link.textContent = String(row.t || DASH);
    th.append(link);
    tr.append(th);

    tr.append(cell(fixed(row.px, 2), "c-num"));

    const s = isNum(row.s);
    tr.append(cell(signed(s, 0), "c-num " + (s === null ? "" : s < 0 ? "fb-neg" : "fb-pos")));

    /* THE COLUMN THIS PAGE EXISTS FOR. Zero means the next tick of the score
       publishes this name; a large number means the cross-section could not
       separate it from noise and is not close to doing so. */
    const d = distanceToBand(row.s, band);
    const dCell = cell(d === null ? DASH : d.toFixed(0), "c-num c-toband");
    if (d !== null && d <= 3) {
      dCell.className = "c-num c-toband is-near";
      dCell.title = "Within three score units of the band edge.";
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

  fetch("/api/flows/board?side=watch", {
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
  }).then((payload) => {
    if (!payload) return;

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
       are equidistant at ±19 and a score sort would put every mildly bullish
       name above every strongly bearish one, which is an ordering about sign
       rather than about how close anything came. */
    rows.sort((a, b) => {
      const x = distanceToBand(a.s, band), y = distanceToBand(b.s, band);
      if (x === null && y === null) return 0;
      if (x === null) return 1;                 // unmeasured never wins a ranking
      if (y === null) return -1;
      return x - y;
    });

    const frag = document.createDocumentFragment();
    for (const r of rows) frag.append(rowFor(r, band));
    body.append(frag);
    wrap.hidden = false;

    const near = rows.filter((r) => {
      const d = distanceToBand(r.s, band);
      return d !== null && d <= 3;
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
    if (near) parts.push(near + " within three of the edge");
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
