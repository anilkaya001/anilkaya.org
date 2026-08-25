/* =============================================================
   flows-overview.js — the Session Overview.

   BOTH TAILS AT ONCE. The board used to hide half the session behind a
   LONG/SHORT toggle. This page fetches both sides and shows the strongest
   names on each, because a session leans in two directions and a reader
   comparing them should not have to remember the other one.

   AND IT DRAWS THE DEAD BAND. The ±20 band is why this page is usually
   short — 17 of 24 names landed inside it on the session this was built
   against — and a reader who cannot see the band reads a three-name page
   as a broken one. Drawing it turns "why is this empty" into "most of the
   market is not leaning, and here is how much of it".
   ============================================================= */
(() => {
  "use strict";

  const statusEl = document.getElementById("flowsStatus");
  const staleEl = document.getElementById("flowsStale");
  const spineHost = document.getElementById("spinePlot");
  const bullDeck = document.getElementById("bullDeck");
  const bearDeck = document.getElementById("bearDeck");
  if (!statusEl || !spineHost || !bullDeck || !bearDeck) return;

  const POLE_MAX = 3;              // tiles per pole; the rest live on the side pages
  const DASH = "—";
  const MINUS = "−";

  const isNum = (v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const signed = (n, d) => (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(d);

  /* ---------- the spine ------------------------------------------
     A fixed −100..+100 axis. FIXED, not data-scaled: the score has a real
     unit and a stated dead band, so an axis that rescaled to the day's
     extremes would make a quiet session look like a violent one. */

  function renderSpine(payload) {
    spineHost.replaceChildren();
    const band = isNum(payload.deadBand) ?? 20;
    const scored = isNum(payload.scored);
    const neutral = isNum(payload.neutral);

    const W = Math.max(300, Math.min(900, spineHost.clientWidth || 720));
    const H = 92;
    const padX = 14, axisY = 56;
    const plotW = W - padX * 2;
    const xOf = (s) => padX + ((s + 100) / 200) * plotW;

    const svg = svgEl("svg", {
      class: "sp", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
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
    svg.append(svgEl("rect", {
      class: "sp-band", x: xOf(-band), y: axisY - 13, width: xOf(band) - xOf(-band), height: 26,
      fill: "url(#spBand)",
    }));

    for (const s of [-100, -50, 0, 50, 100]) {
      svg.append(svgEl("line", { class: "sp-tick", x1: xOf(s), x2: xOf(s), y1: axisY + 10, y2: axisY + 15 }));
      const t = svgEl("text", { class: "sp-ticklabel", x: xOf(s), y: axisY + 27, "text-anchor": "middle" });
      t.textContent = s === 0 ? "0" : signed(s, 0);
      svg.append(t);
    }

    const bandLabel = svgEl("text", {
      class: "sp-bandlabel", x: xOf(0), y: axisY - 19, "text-anchor": "middle",
    });
    bandLabel.textContent = scored !== null && neutral !== null
      ? neutral + " of " + scored + " inside ±" + band + " · not named"
      : "±" + band + " dead band · not named";
    svg.append(bandLabel);

    /* One mark per PUBLISHED name, at its true score. The poles below show
       three each; this shows every one that cleared the band, so the reader
       can see how far the tail actually reaches. */
    for (const [rows, cls] of [[payload.__bull, "is-bull"], [payload.__bear, "is-bear"]]) {
      for (const r of rows || []) {
        const s = isNum(r.s);
        if (s === null) continue;
        const t = String(r.t || "");
        /* THE MARK CARRIES ITS NAME. A row of anonymous dots says how far the
           tail reaches and refuses to say who is in it — and the poles below
           name only three a side, so on a wide session most of these marks
           belong to names nowhere else on the page. A <title> is the SVG
           element's accessible name and its native tooltip at once. */
        const dot = svgEl("circle", {
          class: "sp-dot " + cls, cx: xOf(s), cy: axisY, r: 4.5, "data-t": t,
        });
        const label = svgEl("title");
        label.textContent = t + " " + signed(s, 0);
        dot.append(label);
        svg.append(dot);
      }
    }

    svg.setAttribute("aria-label",
      "Score axis from minus 100 to plus 100. " +
      (neutral !== null && scored !== null
        ? neutral + " of " + scored + " names scored inside the plus or minus " + band + " dead band and are not published. "
        : "") +
      ((payload.__bull || []).length) + " bullish and " + ((payload.__bear || []).length) + " bearish names cleared it.");
    spineHost.append(svg);
  }

  /* ---------- pole tiles ------------------------------------------ */

  function leadingFamily(fam) {
    /* WHICH SIGNED AXIS PUT THIS NAME AT THE POLE. F, P and D are signed;
       V and O are unsigned gauges and are deliberately excluded — a gauge
       cannot "lead" a direction. */
    if (!fam) return null;
    const named = { F: "Flow", P: "Positioning", D: "Path" };
    let best = null;
    for (const k of ["F", "P", "D"]) {
      const v = isNum(fam[k]);
      if (v === null) continue;
      if (best === null || Math.abs(v) > Math.abs(best.v)) best = { k, v };
    }
    return best ? { label: named[best.k], value: best.v } : null;
  }

  function tile(row, rank) {
    const a = el("a", "ptile");
    a.href = "?t=" + encodeURIComponent(String(row.t || ""));
    a.setAttribute("role", "listitem");

    const head = el("div", "ptile-head");
    head.append(el("span", "ptile-rank", String(rank)));
    head.append(el("span", "ptile-sym", String(row.t || DASH)));
    const s = isNum(row.s);
    const score = el("span", "ptile-score " + (s !== null && s < 0 ? "is-neg" : "is-pos"),
      s === null ? DASH : signed(s, 0));
    head.append(score);
    a.append(head);

    const px = isNum(row.px), chg = isNum(row.chg);
    const line = el("div", "ptile-px");
    line.append(el("span", null, px === null ? DASH : px.toFixed(2)));
    if (chg !== null) {
      line.append(el("span", "ptile-chg " + (chg < 0 ? "is-neg" : "is-pos"), signed(chg * 100, 2) + "%"));
    }
    a.append(line);

    /* THE LEAN LINE — why this name is at the pole rather than merely near
       it. Without it a score is a number with no account of itself. */
    const lead = leadingFamily(row.fam);
    a.append(el("p", "ptile-lean",
      lead ? lead.label + " leads " + signed(lead.value, 0) : "families " + DASH));

    const conv = isNum(row.cnv);
    a.append(el("p", "ptile-foot", (conv === null ? DASH : conv) + " conv"));
    return a;
  }

  function paintPole(host, rows, kind) {
    host.replaceChildren();
    if (!rows.length) {
      /* AN EMPTY POLE IS THE ORDINARY CASE, not a fault: the dead band can
         legitimately leave a side with nothing. Saying so, and pointing at
         the other side, is the difference between a reading and a breakage. */
      const p = el("p", "pole-empty");
      p.textContent = "No name leaned " + (kind === "bull" ? "bullish" : "bearish") +
        " past the band this session.";
      host.append(p);
      return;
    }
    rows.slice(0, POLE_MAX).forEach((r, i) => host.append(tile(r, i + 1)));
  }

  function setRailCount(side, n) {
    const slot = document.querySelector('[data-rail-count="' + side + '"]');
    if (!slot) return;
    slot.textContent = String(n);
    slot.hidden = false;
  }

  /* ---------- data ------------------------------------------------ */

  function load(side) {
    return fetch("/api/flows/board?side=" + side, {
      credentials: "same-origin", headers: { Accept: "application/json" },
    }).then((r) => {
      if (r.status === 401) { location.replace("/flows/"); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  Promise.all([load("long"), load("short")]).then(([lng, sht]) => {
    if (!lng && !sht) return;
    const bull = (lng && Array.isArray(lng.rows) ? lng.rows : []).slice();
    const bear = (sht && Array.isArray(sht.rows) ? sht.rows : []).slice();
    /* Sorted by DISTANCE FROM ZERO on each side, so "most bearish" means
       furthest from neutral rather than largest signed number — which for a
       negative axis is the opposite name. */
    bull.sort((a, b) => (isNum(b.s) ?? 0) - (isNum(a.s) ?? 0));
    bear.sort((a, b) => (isNum(a.s) ?? 0) - (isNum(b.s) ?? 0));

    const meta = lng || sht || {};
    meta.__bull = bull;
    meta.__bear = bear;
    renderSpine(meta);
    paintPole(bullDeck, bull, "bull");
    paintPole(bearDeck, bear, "bear");

    /* THE TWO HALVES MUST BE THE SAME SESSION. They are two fetches of two
       rows, and a pipeline that failed between them would put yesterday's
       bulls beside today's bears with nothing to show for it. */
    const ld = lng && lng.sessionDate, sd = sht && sht.sessionDate;
    if (ld && sd && ld !== sd) {
      staleEl.hidden = false;
      staleEl.textContent = "These two halves are from different sessions — bullish " +
        ld + ", bearish " + sd + ". Treat the comparison with care.";
    }

    const scored = isNum(meta.scored), neutral = isNum(meta.neutral);
    const parts = [];
    parts.push(bull.length + " bullish · " + bear.length + " bearish");
    if (meta.sessionDate) parts.push("session " + meta.sessionDate);
    if (scored !== null && neutral !== null) parts.push(neutral + " of " + scored + " inside the band");
    statusEl.textContent = parts.join(" · ") + ".";

    document.getElementById("bullAll").textContent = "All " + bull.length + " bullish";
    document.getElementById("bearAll").textContent = "All " + bear.length + " bearish";

    /* THE RAIL BADGES. The nav is server-rendered with the slots empty
       because filling them there would cost two D1 row reads per page view
       for a two-digit number this page has just fetched anyway. Revealed
       only once a real count exists — a badge reading 0 during the fetch
       says "nothing leaned today", which is a claim, not a loading state. */
    setRailCount("long", bull.length);
    setRailCount("short", bear.length);
  }).catch(() => {
    statusEl.textContent = "The session could not be loaded. Refresh to try again.";
  });
})();
