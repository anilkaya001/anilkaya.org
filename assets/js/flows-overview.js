/* =============================================================
   flows-overview.js — the Session Overview, as a command center.

   WHAT THIS PAGE IS FOR: answering "what should I look at today" without
   leaving it. The previous version fetched both full board payloads — every
   ranked name on each side — and drew SIX TILES from them, three a side,
   throwing the rest away. Everything else the session knows (the level, the
   flagged windows, what reports next, what is a hair outside the band, and
   which scores actually moved) lived on four other routes, so the first
   question anyone asks cost five page loads to answer.

   Nothing new is fetched to fix that. Every region below is drawn from an
   endpoint that already existed; the change is that the page no longer
   discards what it already had in hand.

   SEVEN REGIONS, AND EACH ONE IS ALLOWED TO SAY NOTHING. A region with an
   unpublished key, a region whose request never came back, and a region the
   pipeline measured and found empty are THREE DIFFERENT FACTS, and this file
   words them as three different sentences. Only the third is a claim about
   the market; the other two are claims about this page, and printing the
   third one for all three is how a surface starts lying quietly.

   THE PRIMITIVES ARE THE LIBRARY'S. This file used to re-derive isNum, el,
   svgEl, the em dash and the U+2212 minus — the sixth such copy in the repo,
   and its isNum was one of the wrong ones (`Number(null)` is 0 and 0 is
   finite, so an absent score drew a confident mark at zero on the spine).
   They come from flows-ui.js now, which is loaded before this file.
   ============================================================= */
(() => {
  "use strict";

  const statusEl = document.getElementById("flowsStatus");
  const staleEl = document.getElementById("flowsStale");
  const spineHost = document.getElementById("spinePlot");

  /* THE LIBRARY IS A HARD DEPENDENCY, AND ITS ABSENCE IS VISIBLE. A missing
     flows-ui.js used to be a TypeError in the console and a page that simply
     never filled in — which reads exactly like a quiet session. The status
     line is already the place this page reports on itself, so it says so
     there rather than throwing into a console nobody has open. */
  const UI = window.FlowsUI;
  if (!UI) {
    if (statusEl) {
      statusEl.textContent = "The shared UI library did not load, so this page " +
        "cannot draw. Nothing here is a reading about the session — refresh to try again.";
    }
    return;
  }
  const { isNum, el, svgEl, DASH, MINUS, fmtSigned, scoreStrip, emptyState } = UI;

  const host = (id) => document.getElementById(id);
  const verdictHost = host("ccVerdict");
  if (!statusEl || !spineHost || !verdictHost) return;

  const ROW_MAX = 10;   // rows per ranked region; the side pages hold the rest
  const LIST_MAX = 8;   // rows in the narrow regions, which are indexes

  /* A row the pipeline built no detail card for. Same sentence the board
     uses, because it is the same fact and a reader who notices that some
     names open and others do not is owed the reason wherever they noticed. */
  const NO_CARD_SAID =
    "No detail card: the chain and the card cost vendor calls the run spends " +
    "only on the names furthest from neutral. This row is scored and ranked " +
    "from the same five sources as every other.";

  /* ---------- formatting ------------------------------------------
     fmtSigned is the library's, so the minus is U+2212 and a ZERO prints
     unsigned — it is a measurement, not a blank, and dressing it as "+0"
     would claim a direction the number does not have. */

  const pct = (v, dp) => {
    const n = isNum(v);
    return n === null ? DASH : fmtSigned(n * 100, dp === undefined ? 2 : dp) + "%";
  };

  /** Premium, abbreviated. Positive prints unsigned: the column header says
      what the sign means, and a leading + on every other row is noise. */
  const usd = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const sign = n < 0 ? MINUS : "";
    const a = Math.abs(n);
    if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(0) + "K";
    return sign + "$" + a.toFixed(0);
  };

  /* HUE IS CONFIRMATION, NEVER THE CARRIER. Every cell this tints already
     prints its own sign, so the colour repeats what the glyph says. */
  const tone = (v) => {
    const n = isNum(v);
    return n === null ? "" : n > 0 ? " is-pos" : n < 0 ? " is-neg" : "";
  };

  /* ---------- the three silences ----------------------------------

     "Nothing here" is three different facts and they may not share a
     sentence:

       unreadable — the request did not come back. Nothing is known, and
                    the fault is this page's, not the market's.
       pending    — the key has never been published for this session. The
                    pipeline has not spoken yet; nothing was measured.
       empty      — the pipeline measured, and measured nothing. THIS one
                    is a reading, and it is the only one of the three that
                    says anything about the market.

     `kind` lands on data-empty so a test can tell them apart without
     parsing prose, which is what stops the three collapsing back into one. */

  function quiet(into, kind, text) {
    const p = emptyState(kind, text);
    p.classList.add("cc-quiet");
    into.append(p);
    return true;
  }

  /**
   * Word the two silences that are about the fetch rather than the session.
   * Returns true when it wrote one, so a caller only has to word the third.
   */
  function silent(into, payload, what) {
    if (!payload) {
      return quiet(into, "unreadable",
        "The " + what + " could not be read, so this region is blank. That is a " +
        "fault on this page and not a fact about the session — refresh to try again.");
    }
    if (payload.status === "pending") {
      return quiet(into, "pending",
        "The " + what + " has not been published for this session yet. Nothing has " +
        "been measured here, so nothing is being claimed.");
    }
    return false;
  }

  /* A ROW COUNT, OR NULL WHEN THERE IS NO PUBLISHED BOARD TO COUNT.
     The worker answers an unpublished key with {status:"pending", rows: []},
     so every naive `payload.rows.length` on this page turns "the pipeline
     has not spoken" into "nothing leaned today" — a claim about the market,
     printed in a badge and a tile, where nobody would think to doubt it. */
  const rowCount = (payload) =>
    payload && payload.status !== "pending" && Array.isArray(payload.rows)
      ? payload.rows.length : null;

  /* ---------- the ranking is the payload's -------------------------

     The pipeline stamps `r` on every row: 1 is the name furthest from
     neutral ON ITS OWN SIDE, so the short board's rank 1 is its most
     bearish name. Re-deriving that here would be a second opinion about a
     ranking already published — and the obvious re-derivation is WRONG on
     the bear side, where a descending sort on the signed score puts −28
     above −91 and heads a list labelled "most bearish" with the least
     bearish name on it.

     Sorted rather than taken as it arrives, because array order is not a
     contract and this file cannot see how the rows reached it. When no row
     carries a rank there is nothing published to trust, and the fallback is
     distance from neutral — the same rule, computed here, sign-agnostic so
     it cannot reintroduce the asymmetry above. */
  function ranked(rows) {
    const list = (Array.isArray(rows) ? rows : []).slice();
    const published = list.length > 0 && list.every((r) => isNum(r && r.r) !== null);
    if (published) list.sort((a, b) => isNum(a.r) - isNum(b.r));
    else list.sort((a, b) => Math.abs(isNum(b && b.s) ?? 0) - Math.abs(isNum(a && a.s) ?? 0));
    return list;
  }

  /* ---------- a name that opens its card in place ------------------

     The tiles this replaces were anchors to ?t=SYM, so opening a card was a
     full page navigation that re-fetched both board payloads to redraw a
     page the reader was already looking at. A button carrying data-t is
     picked up by the delegated handler in flows-card.js, which opens the
     dialog and pushes the same ?t= state — same address, same Back button,
     no reload.

     A ROW WITHOUT A CARD IS NOT A BUTTON. The card costs vendor calls the
     run spends only on the names furthest from neutral, and the board says
     which those are: `deep` at the payload root means this board knows the
     distinction at all, `dp` on a row means this row got one. A board
     predating the distinction publishes neither, and every row on it does
     have a card — so the test is on the PAYLOAD first. Withholding data-t
     is what actually keeps a cardless row out of the click delegation; a
     class name would only keep it out of the stylesheet. */
  function nameCell(row, knowsDeep) {
    const td = el("td", "cc-t");
    const t = String((row && row.t) || "");
    const deep = !knowsDeep || (row && row.dp === 1);
    if (!deep || !t) {
      const flat = el("span", "cc-flat", t || DASH);
      if (t) flat.title = NO_CARD_SAID;
      td.append(flat);
      return td;
    }
    const button = el("button", "cc-open", t);
    button.type = "button";
    button.dataset.t = t;
    button.setAttribute("aria-haspopup", "dialog");
    // Warm the card on hover so the dialog opens instantly; at most six are cached.
    button.addEventListener("pointerenter", () => {
      if (window.flowsCardPrefetch) window.flowsCardPrefetch(t);
    });
    td.append(button);
    return td;
  }

  /** A table that scrolls inside its own box rather than widening the page. */
  function tableWrap(label) {
    const wrap = el("div", "cc-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", label);
    return wrap;
  }

  function headRow(cols) {
    const thead = el("thead");
    const tr = el("tr");
    for (const [label, cls] of cols) {
      const th = el("th", cls || null, label);
      th.setAttribute("scope", "col");
      tr.append(th);
    }
    thead.append(tr);
    return thead;
  }

  /* ---------- a ranked side, ten deep ------------------------------

     Each row carries its own score strip, which is the primitive the score
     track page already draws and the one thing the six tiles could never
     show: whether a name arrived at this score this morning or has been
     sitting on it for a month. */
  function sideTable(into, rows, knowsDeep, track, label) {
    const wrap = tableWrap(label);
    const table = el("table", "cc-tbl");
    table.append(headRow([
      ["", "cc-rank"], ["Name", null], ["Score", "c-num"], ["Conv", "c-num"],
      ["Chg", "c-num"], ["Net prem", "c-num"], [track.label, "cc-trk"],
    ]));

    const body = el("tbody");
    for (const row of rows.slice(0, ROW_MAX)) {
      const tr = el("tr");
      tr.append(el("td", "cc-rank", isNum(row.r) === null ? DASH : String(row.r)));
      tr.append(nameCell(row, knowsDeep));
      tr.append(el("td", "c-num cc-score" + tone(row.s), fmtSigned(row.s)));
      tr.append(el("td", "c-num", isNum(row.cnv) === null ? DASH : String(Math.round(row.cnv))));
      tr.append(el("td", "c-num" + tone(row.chg), pct(row.chg)));
      tr.append(el("td", "c-num" + tone(row.netPrem), usd(row.netPrem)));

      const cell = el("td", "cc-trk");
      const series = track.byName[row.t];
      const measured = (series || []).filter((v) => isNum(v) !== null).length;
      if (series && measured) {
        /* ONE SHARED DOMAIN ACROSS BOTH SIDES. Left to itself every strip
           rescales to its own extremes, and a name drifting ±2 draws the
           same picture as one swinging ±40 — so a bull strip and a bear
           strip could not be read against each other at all. */
        scoreStrip(cell, {
          values: series, width: 150, height: 22,
          domain: track.domain, deadBand: track.deadBand, prefix: "cc",
          ariaLabel: "Score for " + row.t + " across " + measured + " archived sessions",
        });
      } else {
        /* No trace for this name is an ABSENCE, not a flat line at zero. */
        cell.textContent = DASH;
      }
      tr.append(cell);
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  /* ---------- the score track, pooled once for both sides ---------- */

  function readTrack(payload) {
    const byName = Object.create(null);
    let lo = 0, hi = 0, sessions = 0;
    if (payload && Array.isArray(payload.names)) {
      for (const name of payload.names) {
        if (!name || !name.t) continue;
        const series = Array.isArray(name.s) ? name.s : [];
        byName[name.t] = series;
        if (series.length > sessions) sessions = series.length;
        for (const value of series) {
          const v = isNum(value);
          if (v === null) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    return {
      byName, domain: { lo, hi },
      deadBand: payload ? isNum(payload.deadBand) : null,
      /* The column header states the window it drew rather than a constant:
         a track that published nothing gets a header that promises nothing. */
      label: sessions ? sessions + " sessions" : "Score track",
    };
  }

  /* ---------- what changed ----------------------------------------

     The one question no existing route answers. Each name's move is its last
     archived score minus the one before it — where "before" means the
     previous session THE NAME WAS SCORED, because a gap in the trace means
     the name was not scored that day and never means it scored zero. */
  function paintChanged(into, payload) {
    if (silent(into, payload, "score track")) return;

    const moves = [];
    let comparable = 0;
    for (const name of (Array.isArray(payload.names) ? payload.names : [])) {
      const measured = (Array.isArray(name && name.s) ? name.s : [])
        .map((v) => isNum(v)).filter((v) => v !== null);
      if (measured.length < 2) continue;
      comparable++;
      const delta = measured[measured.length - 1] - measured[measured.length - 2];
      if (delta !== 0) moves.push({ t: name.t, d: delta, last: measured[measured.length - 1] });
    }
    moves.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

    /* TWO DIFFERENT EMPTINESSES, TWO SENTENCES. An archive one session deep
       has nothing to subtract from; an archive that measured every name
       twice and found them all unchanged is a reading about the session. */
    if (!comparable) {
      quiet(into, "empty",
        "No name has two archived sessions to compare yet, so there is no move " +
        "to report. The first comparison lands once a second session is archived.");
      return;
    }
    if (!moves.length) {
      quiet(into, "empty",
        "No name's score moved between the last two archived sessions. " +
        comparable + " names were compared and every one of them held its score.");
      return;
    }

    const list = el("ul", "cc-moves");
    for (const move of moves.slice(0, ROW_MAX)) {
      const li = el("li");
      li.append(el("span", "cc-t", move.t || DASH));
      li.append(el("span", "c-num" + tone(move.d), fmtSigned(move.d)));
      li.append(el("span", "cc-dim", "now " + fmtSigned(move.last)));
      list.append(li);
    }
    into.append(list);
  }

  /* ---------- the verdict bar --------------------------------------

     Six readings the rest of the page then explains. Every one of them is
     allowed to be an em dash: a tile whose endpoint did not answer says so
     by not saying a number, which is the only honest thing a tile can do. */
  function paintVerdict(into, long, short, market, alerts) {
    const breadth = (market && market.breadth) || {};
    const bulls = rowCount(long);
    const bears = rowCount(short);

    /* WHY THE ALERT SUB-LABEL IS NOT A CONSTANT. "nightly read" is a claim
       about when the feed was taken, and printing it beside an em dash —
       for a payload that never arrived — would attach a provenance to a
       number that does not exist. */
    let alertNote = "not read";
    if (alerts && alerts.status === "pending") alertNote = "not published yet";
    else if (alerts) alertNote = alerts.refreshed === "intraday" ? "refreshed intraday" : "nightly read";

    const tiles = [
      ["Session", (long && long.sessionDate) || DASH, "", null],
      ["Screened", isNum(market && market.n) === null ? DASH : String(market.n), "names", null],
      ["Tilt", fmtSigned(breadth.tilt, 4), "bought / sold", tone(breadth.tilt)],
      ["Breadth",
        (isNum(breadth.bull) === null ? DASH : String(breadth.bull)) + " / " +
        (isNum(breadth.bear) === null ? DASH : String(breadth.bear)), "bull / bear", null],
      ["Both sides",
        (bulls === null ? DASH : bulls) + " / " + (bears === null ? DASH : bears), "ranked", null],
      ["Flagged windows",
        isNum(alerts && alerts.seen) === null ? DASH : String(alerts.seen), alertNote, null],
    ];

    for (const [key, value, sub, cls] of tiles) {
      const tile = el("div", "cc-tile");
      tile.append(el("span", "cc-tile-k", key));
      tile.append(el("span", "cc-tile-v" + (cls || ""), String(value)));
      if (sub) tile.append(el("span", "cc-tile-s", sub));
      into.append(tile);
    }
  }

  /* ---------- the freshest flagged windows -------------------------

     The vendor's own rules, not this pipeline's. Tickers here are PLAIN
     TEXT: a detail card exists only for the names the board went deep on,
     and an opener that usually opens nothing is worse than no opener. */
  function paintAlerts(into, payload) {
    if (silent(into, payload, "flow alerts feed")) return;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      quiet(into, "empty", "The vendor's rules flagged nothing in this read.");
      return;
    }

    const wrap = tableWrap("Flagged option windows, freshest first");
    const table = el("table", "cc-tbl");
    table.append(headRow([["Name", null], ["Contract", null], ["Premium", "c-num"], ["Rule", null]]));
    const body = el("tbody");
    for (const row of rows.slice(0, LIST_MAX)) {
      const tr = el("tr");
      tr.append(el("td", "cc-t", row.t || DASH));
      tr.append(el("td", null,
        (row.cp || DASH) + " " + (isNum(row.k) === null ? DASH : row.k) +
        (row.exp ? " " + String(row.exp).slice(5) : "")));
      tr.append(el("td", "c-num", usd(row.prem)));
      tr.append(el("td", "cc-dim", row.rule || DASH));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  /* ---------- what reports next ------------------------------------ */
  function paintEvents(into, payload) {
    if (silent(into, payload, "events calendar")) return;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      quiet(into, "empty", "No name in the screened universe reports inside the window.");
      return;
    }

    const wrap = tableWrap("Names reporting inside the window");
    const table = el("table", "cc-tbl");
    table.append(headRow([["Name", null], ["Date", null], ["In", "c-num"], ["Priced move", "c-num"]]));
    const body = el("tbody");
    for (const row of rows.slice(0, LIST_MAX)) {
      const tr = el("tr");
      tr.append(el("td", "cc-t", row.t || DASH));
      tr.append(el("td", null, row.d || DASH));
      /* Sessions, not days: the count the earnings gate itself measured. */
      tr.append(el("td", "c-num", isNum(row.sdte) === null ? DASH : row.sdte + "s"));
      const im = isNum(row.im);
      tr.append(el("td", "c-num", im === null ? DASH : "±" + (Math.abs(im) * 100).toFixed(1) + "%"));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  /* ---------- nearly in --------------------------------------------

     The names inside the dead band: fully scored, published on neither
     side. Plain text for the same reason as the alerts — these are the
     names CLOSEST to neutral, so by the deep rule none of them has a card. */
  function paintWatch(into, payload) {
    if (silent(into, payload, "watch board")) return;
    const rows = ranked(payload.rows);
    if (!rows.length) {
      /* WHICH SILENCE THIS IS, AND THE TWO ROUTES USED TO DISAGREE. This
         region asserted a reading about the market ("no name sits inside the
         band") while /flows/watch/ asserted a fault in the publish, over the
         same payload — so on an empty session a reader got both sentences on
         two routes of one product. The Watch route's reading is the correct
         one: with a ±1 band, a session where NO name lands inside it is
         near-impossible, so an empty watch list is far more likely to be a
         key that did not publish than a market that had no middle. */
      quiet(into, "unavailable",
        "The watch board published no rows. With a dead band this narrow a " +
        "session where no name sits inside it would be extraordinary, so this " +
        "is more likely a key that did not publish than a market with no middle.");
      return;
    }
    const list = el("ul", "cc-moves");
    for (const row of rows.slice(0, LIST_MAX)) {
      const li = el("li");
      li.append(el("span", "cc-t", row.t || DASH));
      /* THE RESIDUAL, NOT THE SCORE, BECAUSE THE SCORE HAS NO BITS HERE.
         `s` is a rounded integer on a ±100 scale and the dead band is ±1, so
         every row in this region prints 0 — seven identical zeros under a
         heading that promises "how close they are to leaving the band". The
         rows really ARE ordered, on |residual|, and that is the number the
         ordering is made of. Falls back to the score for a payload published
         before this field existed, which is the only reading available there. */
      const resid = isNum(row.resid);
      li.append(resid !== null
        ? el("span", "c-num" + tone(resid), resid.toFixed(4))
        : el("span", "c-num" + tone(row.s), fmtSigned(row.s)));
      li.append(el("span", "cc-dim",
        "conv " + (isNum(row.cnv) === null ? DASH : Math.round(row.cnv))));
      list.append(li);
    }
    into.append(list);
  }

  /* ---------- the spine --------------------------------------------
     UNCHANGED, and deliberately so: a fixed −100..+100 axis with the dead
     band hatched onto it. FIXED, not data-scaled — the score has a real
     unit and a stated dead band, so an axis that rescaled to the day's
     extremes would make a quiet session look like a violent one. It keeps
     its place at the foot of the page because it is the only view of the
     WHOLE distribution, and the regions above it are an index, not a
     replacement. */

  function renderSpine(payload) {
    spineHost.replaceChildren();
    /* NO BAND PUBLISHED MEANS NO HATCH, NOT A ±20 ONE.
       The `?? 20` here painted 174px of hatch on an 872px axis whenever the
       board was unreadable or predated the field — a confident visual claim
       that a ±20 bar had been applied when none was published at all, in the
       one channel this chart exists to communicate. The real band is 1, whose
       hatch is ~9px, so the fabricated state was not even comparable to the
       true one: it was the most emphatic mark on the chart standing in for a
       missing number. */
    const band = isNum(payload.deadBand);
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
    /* Drawn only when a band was actually published. An axis with no hatch is
       an axis that says nothing about exclusion, which is the truth when the
       field is missing; a hatch drawn from a default says something false. */
    if (band !== null) {
      svg.append(svgEl("rect", {
        class: "sp-band", x: xOf(-band), y: axisY - 13, width: xOf(band) - xOf(-band), height: 26,
        fill: "url(#spBand)",
      }));
    }

    for (const s of [-100, -50, 0, 50, 100]) {
      svg.append(svgEl("line", { class: "sp-tick", x1: xOf(s), x2: xOf(s), y1: axisY + 10, y2: axisY + 15 }));
      const t = svgEl("text", { class: "sp-ticklabel", x: xOf(s), y: axisY + 27, "text-anchor": "middle" });
      t.textContent = s === 0 ? "0" : fmtSigned(s, 0);
      svg.append(t);
    }

    const bandLabel = svgEl("text", {
      class: "sp-bandlabel", x: xOf(0), y: axisY - 19, "text-anchor": "middle",
    });
    bandLabel.textContent = band === null
      /* Says what is missing rather than naming a width nobody published. */
      ? "no dead band published for this session · the axis is drawn without one"
      : scored !== null && neutral !== null
        ? neutral + " of " + scored + " inside ±" + band + " · not named"
        : "±" + band + " dead band · not named";
    svg.append(bandLabel);

    /* One mark per PUBLISHED name, at its true score. The regions above show
       ten a side; this shows every one that cleared the band, so the reader
       can see how far the tail actually reaches. */
    for (const [rows, cls] of [[payload.__bull, "is-bull"], [payload.__bear, "is-bear"]]) {
      for (const r of rows || []) {
        const s = isNum(r.s);
        if (s === null) continue;
        const t = String(r.t || "");
        /* THE MARK CARRIES ITS NAME. A row of anonymous dots says how far the
           tail reaches and refuses to say who is in it — and on a wide
           session the regions above name only the first ten a side, so many
           of these marks belong to names nowhere else on the page. A <title>
           is the SVG element's accessible name and its native tooltip at once. */
        const dot = svgEl("circle", {
          class: "sp-dot " + cls, cx: xOf(s), cy: axisY, r: 4.5, "data-t": t,
        });
        const label = svgEl("title");
        label.textContent = t + " " + fmtSigned(s, 0);
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

  /* ---------- the rail badges --------------------------------------

     The nav is server-rendered with the slots empty because filling them
     there would cost D1 row reads per page view for two-digit numbers this
     page has just fetched anyway. Revealed only once a real count exists —
     a badge reading 0 during the fetch says "nothing leaned today", which
     is a claim, not a loading state. */
  function setRailCount(side, n) {
    const slot = document.querySelector('[data-rail-count="' + side + '"]');
    if (!slot || n === null) return;
    slot.textContent = String(n);
    slot.hidden = false;
  }

  /* ---------- data --------------------------------------------------

     Seven reads, every one of an endpoint that already existed. The two
     boards are the page: a failure there is reported on the status line.
     The other five are regions, and each one's failure is CONTAINED — an
     events calendar that does not answer must not blank the five regions
     that did. */

  function loadBoard(side) {
    return fetch("/api/flows/board?side=" + side, {
      credentials: "same-origin", headers: { Accept: "application/json" },
    }).then((r) => {
      if (r.status === 401) { location.replace("/flows/"); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function loadRegion(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  Promise.all([
    loadBoard("long"),
    loadBoard("short"),
    loadRegion("/api/flows/board?side=watch"),
    loadRegion("/api/flows/market"),
    loadRegion("/api/flows/flowalerts"),
    loadRegion("/api/flows/events"),
    loadRegion("/api/flows/scoretrack"),
  ]).then(([lng, sht, watch, market, alerts, events, track]) => {
    if (!lng && !sht) return;

    const bull = ranked(lng && lng.rows);
    const bear = ranked(sht && sht.rows);

    /* ---- the verdict bar and the two ranked sides ---- */
    paintVerdict(verdictHost, lng, sht, market, alerts);

    const trk = readTrack(track && track.status !== "pending" ? track : null);

    for (const [id, subId, payload, rows, label, all] of [
      ["ccBull", "ccBullSub", lng, bull, "Bullish candidates, ranked", "bullish"],
      ["ccBear", "ccBearSub", sht, bear, "Bearish candidates, ranked", "bearish"],
    ]) {
      const into = host(id);
      const sub = host(subId);
      if (!into) continue;
      into.replaceChildren();
      if (silent(into, payload, all + " board")) {
        if (sub) { sub.textContent = ""; sub.hidden = true; }
        continue;
      }
      if (!rows.length) {
        /* AN EMPTY SIDE IS THE ORDINARY CASE, not a fault: the dead band can
           legitimately leave a side with nothing to publish. Saying so is
           the difference between a reading and a breakage. */
        quiet(into, "empty",
          "No name leaned " + all + " past the band this session.");
        if (sub) { sub.textContent = "0 ranked"; sub.hidden = false; }
        continue;
      }
      /* `deep` at the root says this board knows which rows carry a card.
         Its absence means the board predates the distinction, and every row
         on such a board does have one. */
      sideTable(into, rows, isNum(payload && payload.deep) !== null, trk, label);
      if (sub) {
        sub.textContent = rows.length > ROW_MAX
          ? "top " + ROW_MAX + " of " + rows.length : "all " + rows.length;
        sub.hidden = false;
      }
    }

    /* ---- the four narrow regions ---- */
    const chg = host("ccChg");
    if (chg) { chg.replaceChildren(); paintChanged(chg, track); }

    const alr = host("ccAlerts");
    if (alr) { alr.replaceChildren(); paintAlerts(alr, alerts); }
    const alrSub = host("ccAlertsSub");
    if (alrSub) {
      const read = alerts && alerts.readAt ? Date.parse(alerts.readAt) : NaN;
      alrSub.textContent = Number.isFinite(read) ? "read " + new Date(read).toLocaleTimeString() : "";
    }

    const evr = host("ccEvents");
    if (evr) { evr.replaceChildren(); paintEvents(evr, events); }
    const evSub = host("ccEventsSub");
    if (evSub) {
      const inWindow = isNum(events && events.inWindow);
      evSub.textContent = inWindow === null ? "" : inWindow + " in the window";
    }

    const wtc = host("ccWatch");
    if (wtc) { wtc.replaceChildren(); paintWatch(wtc, watch); }
    const wtcSub = host("ccWatchSub");
    if (wtcSub) {
      const n = rowCount(watch);
      wtcSub.textContent = n === null ? "inside the dead band" : "all " + n;
    }

    /* ---- the spine, over the whole published distribution ---- */
    const meta = lng || sht || {};
    meta.__bull = bull;
    meta.__bear = bear;
    renderSpine(meta);

    /* THE TWO HALVES MUST BE THE SAME SESSION. They are two fetches of two
       rows, and a pipeline that failed between them would put yesterday's
       bulls beside today's bears with nothing in either payload to disagree
       about it. Nothing forces them to agree, so the page has to check. */
    const ld = lng && lng.sessionDate, sd = sht && sht.sessionDate;
    if (ld && sd && ld !== sd) {
      staleEl.hidden = false;
      staleEl.textContent = "These two halves are from different sessions — bullish " +
        ld + ", bearish " + sd + ". Treat the comparison with care.";
    }

    const scored = isNum(meta.scored), neutral = isNum(meta.neutral);
    const bullN = rowCount(lng), bearN = rowCount(sht);
    const parts = [];
    parts.push((bullN === null ? DASH : bullN) + " bullish · " +
      (bearN === null ? DASH : bearN) + " bearish");
    if (meta.sessionDate) parts.push("session " + meta.sessionDate);
    if (scored !== null && neutral !== null) parts.push(neutral + " of " + scored + " inside the band");
    statusEl.textContent = parts.join(" · ") + ".";

    setRailCount("long", bullN);
    setRailCount("short", bearN);
    setRailCount("watch", rowCount(watch));
  }).catch(() => {
    statusEl.textContent = "The session could not be loaded. Refresh to try again.";
  });
})();
