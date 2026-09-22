(() => {
  "use strict";

  const statusEl = document.getElementById("watchStatus");
  const staleEl = document.getElementById("watchStale");
  const wrap = document.getElementById("watchTableWrap");
  const body = document.getElementById("watchBody");
  if (!statusEl || !wrap || !body) return;

  const COLUMNS = 9;
  const MINUS = "−";
  const DASH = "—";

  for (const node of [wrap, document.querySelector(".flows-rail")]) {
    if (!node) continue;
    const edge = () => {
      node.classList.toggle("has-more", node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    };
    node.addEventListener("scroll", edge, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(edge).observe(node);
    edge();
  }

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

  var SCORE_SCALE = Math.atanh(0.80) / 2.0;

  function distanceToBand(row, band) {
    const b = isNum(band);
    if (b === null) return null;
    const resid = isNum(row && row.resid);
    if (resid !== null) {

      const exact = 100 * Math.tanh(resid / SCORE_SCALE);
      return { value: Math.max(0, b - Math.abs(exact)), exact, unit: "score", edge: b };
    }

    const s = isNum(row && row.s);
    if (s === null) return null;
    return { value: Math.max(0, b - Math.abs(s)), exact: null, unit: "score", edge: b };
  }

  function approachOf(row, band, entry) {
    const here = distanceToBand(row, band);

    if (here === null || here.exact === null) return null;
    if (!entry || !entry.d1) return null;

    const qv = isNum(entry.d1.qv);
    const gap = isNum(entry.d1.gap);
    const resid = isNum(row && row.resid);

    if (qv === null || resid === null || gap === null || gap < 1) return null;

    const b = isNum(band);
    if (b === null) return null;

    const before = 100 * Math.tanh((resid - qv / 1e4) / SCORE_SCALE);
    const beforeDist = Math.max(0, b - Math.abs(before));

    const moved = beforeDist - here.value;
    const per = moved / gap;

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

    const link = document.createElement("a");
    link.href = "/flows/ticker/?t=" + encodeURIComponent(String(row.t || "")) +
      "&s=signal&from=watch";
    link.textContent = String(row.t || DASH);
    th.append(link);
    tr.append(th);

    tr.append(cell(fixed(row.px, 2), "c-num"));

    const s = isNum(row.s);
    tr.append(cell(signed(s, 0), "c-num " + (s === null || s === 0 ? "" : s < 0 ? "fb-neg" : "fb-pos")));

    const d = distanceToBand(row, band);

    const dCell = cell(
      d === null ? DASH
        : d.exact !== null ? d.value.toFixed(2) : d.value.toFixed(0),
      "c-num c-toband");

    const ap = approachOf(row, band, entry);
    if (ap !== null) {
      const line = document.createElement("span");
      line.className = ap.per > 0 ? "c-approach is-closing"
        : ap.per < 0 ? "c-approach is-widening" : "c-approach";

      const arrow = ap.per > 0 ? "\u25B8" : ap.per < 0 ? "\u25C2" : "\u00B7";
      line.textContent = arrow + " " + signed(ap.per, 2) +
        (ap.sessions === null ? ""
          : "  \u2248" + (ap.sessions < 1 ? "<1" : Math.round(ap.sessions)) + "s");

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

    if (d !== null && d.edge > 0 && d.value <= d.edge * 0.2) {
      dCell.className = "c-num c-toband is-near";
      dCell.title = "Within a fifth of the band's half-width of the edge.";
    }
    if (d !== null && d.exact !== null) {

      dCell.title = (dCell.title ? dCell.title + " " : "") +
        "Score points, computed from the unrounded score (" + d.exact.toFixed(2) +
        ") rather than the integer shown beside it.";
    }
    tr.append(dCell);

    tr.append(cell(isNum(row.cnv) === null ? DASH : String(Math.round(row.cnv)), "c-num"));

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

    get("/api/flows/scoretrack").catch(() => null),
  ]).then(([payload, track]) => {
    if (!payload) return;

    const trackBy = new Map();
    if (track && Array.isArray(track.names)) {
      for (const n of track.names) if (n && n.t) trackBy.set(String(n.t).toUpperCase(), n);
    }
    const entryFor = (r) => trackBy.get(String((r && r.t) || "").toUpperCase()) || null;

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const band = payload.deadBand;

    const slot = document.querySelector('[data-rail-count="watch"]');
    if (slot && rows.length) { slot.textContent = String(rows.length); slot.hidden = false; }

    if (payload.status === "pending" || !rows.length) {

      showMessage(
        payload.status === "pending"
          ? "No watch list has been published yet. This list is built by the " +
            "pipeline, which runs after the close on weekdays — it will appear after " +
            "the first run following this deploy."
          : "No name was scored inside the band this session, which is unusual " +
            "enough to be worth treating as a publishing fault rather than a reading.",
      );
      statusEl.textContent = "Nothing to watch.";
      return;
    }

    rows.sort((a, b) => {

      const pa = approachOf(a, band, entryFor(a));
      const pb = approachOf(b, band, entryFor(b));
      const ea = pa && pa.sessions !== null ? pa.sessions : Infinity;
      const eb = pb && pb.sessions !== null ? pb.sessions : Infinity;
      if (ea !== eb) return ea - eb;

      const x = distanceToBand(a, band), y = distanceToBand(b, band);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;

      return x.value - y.value;
    });

    const frag = document.createDocumentFragment();
    for (const r of rows) frag.append(rowFor(r, band, entryFor(r)));
    body.append(frag);
    wrap.hidden = false;

    const near = rows.filter((r) => {
      const d = distanceToBand(r, band);

      return d !== null && d.edge > 0 && d.value <= d.edge * 0.2;
    }).length;

    const scored = isNum(payload.scored);
    const parts = [
      rows.length + (scored === null ? "" : " of " + scored + " scored") +
      " inside the ±" + (band ?? "") + " band",
    ];
    if (payload.sessionDate) parts.push("session " + payload.sessionDate);

    if (near) parts.push(near + " within a fifth of the band's half-width of the edge");

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

      parts.push("no name here has a prior scored session to measure against yet");
    } else {
      parts.push("the score trace did not load, so no direction of travel is shown");
    }
    if (faded) {
      parts.push(faded + (faded === 1 ? " name" : " names") + " came back through the edge");
    }

    const inBand = isNum(payload.neutral);
    if (inBand !== null && inBand > rows.length) {
      parts.push("showing the " + rows.length + " closest of " + inBand);
    }
    statusEl.textContent = parts.join(" · ") + ".";

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
