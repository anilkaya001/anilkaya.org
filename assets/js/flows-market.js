/* THE MARKET LEVEL.
 *
 * Renders /api/flows/market, plus the two payloads this section has been
 * publishing and never drawing: `movers` (free — the screener already returns
 * the whole universe) and `sector:trix` (eleven candle calls a run, dark since
 * the day it shipped).
 *
 * THE VOCABULARY RULE THAT GOVERNS EVERY STRING IN THIS FILE: the population
 * is the SCREENED UNIVERSE, never "the market". The vendor's screener caps
 * each band at about fifty rows, so what is measured here is whatever this
 * run's ladder returned and the gate admitted. Every heading says so and the
 * count is on the page.
 */
(function () {
  "use strict";

  var MINUS = "−";           // U+2212, not a hyphen
  var DASH = "—";

  function isNum(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function signed(v, dp) {
    var n = isNum(v);
    if (n === null) return DASH;
    return (n >= 0 ? "+" : MINUS) + Math.abs(n).toFixed(dp === undefined ? 2 : dp);
  }
  function pct(v, dp) {
    var n = isNum(v);
    if (n === null) return DASH;
    return (n * 100).toFixed(dp === undefined ? 1 : dp) + "%";
  }
  /* Money, in the units a nine-figure sum is actually read in. */
  function usd(v) {
    var n = isNum(v);
    if (n === null) return DASH;
    var sign = n < 0 ? MINUS : "";
    var a = Math.abs(n);
    if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(0) + "K";
    return sign + "$" + a.toFixed(0);
  }
  function toneClass(v) {
    var n = isNum(v);
    if (n === null) return "";
    return n > 0 ? "fb-pos" : (n < 0 ? "fb-neg" : "");
  }

  /**
   * A signed bar on a fixed [-1, +1] axis.
   *
   * POSITION CARRIES THE SIGN, hue is decoration. The bar grows from a centre
   * rule: left of it is negative and right of it is positive, and that remains
   * legible with the colours removed, printed in greyscale, or read by someone
   * who cannot distinguish the two.
   *
   * The axis is FIXED rather than scaled to the data. A tilt of +0.03 drawn to
   * fill the panel would read as a decisive session; on a fixed axis it reads
   * as what it is, which is nearly nothing.
   */
  function tiltRow(label, value, note) {
    var wrap = el("div", "mk-tilt");
    var head = el("div", "mk-tilt-h");
    head.append(el("span", "mk-tilt-k", label));
    var v = el("span", "mk-tilt-v " + toneClass(value), signed(value, 3));
    head.append(v);
    wrap.append(head);

    var track = el("div", "mk-track");
    track.append(el("i", "mk-zero"));
    var n = isNum(value);
    if (n !== null) {
      var bar = el("i", "mk-bar " + (n >= 0 ? "is-pos" : "is-neg"));
      // Half-width axis each side of the centre rule.
      bar.style.width = (Math.min(Math.abs(n), 1) * 50) + "%";
      bar.style.left = n >= 0 ? "50%" : (50 - Math.min(Math.abs(n), 1) * 50) + "%";
      track.append(bar);
    }
    wrap.append(track);
    if (note) wrap.append(el("p", "mk-tilt-n", note));
    return wrap;
  }

  function paintTilt(m) {
    var host = document.getElementById("mktTilt");
    var panel = document.getElementById("mktTiltPanel");
    if (!host || !panel) return;
    host.textContent = "";

    var breadth = m.breadth || {};
    var premium = m.premium || {};

    host.append(tiltRow(
      "Breadth tilt — counting names",
      breadth.tilt,
      (isNum(breadth.bull) || 0) + " bought, " + (isNum(breadth.bear) || 0) +
      " sold, " + (isNum(breadth.flat) || 0) + " level, of " +
      (isNum(premium.priced) || 0) + " names that quoted both legs."));

    host.append(tiltRow(
      "Premium tilt — weighting by dollars",
      premium.tilt,
      usd(premium.netPositive) + " of net call premium against " +
      usd(premium.netNegative) + " of net put premium."));

    /* THE DISAGREEMENT IS THE READING, and it is the reason both are drawn.
       They are the same ratio under two weightings; when they part company the
       session was a lot of small buying against a little large selling, or the
       reverse, and no single number can say that. */
    var note = document.getElementById("mktTiltNote");
    var b = isNum(breadth.tilt), p = isNum(premium.tilt);
    if (note) {
      if (b === null || p === null) {
        note.textContent = "One of the two weightings could not be measured this session, " +
          "so they cannot be compared.";
      } else if ((b > 0) !== (p > 0) && b !== 0 && p !== 0) {
        note.textContent = "The two weightings DISAGREE in sign. More names leaned one way " +
          "while the dollars leaned the other — breadth without size, or size without " +
          "breadth. That disagreement is the session's most informative reading, and it is " +
          "why both are drawn rather than one being chosen.";
      } else {
        note.textContent = "Both weightings agree in sign. Counting names and weighting them " +
          "by dollars tell the same story this session.";
      }
    }
    panel.hidden = false;
  }

  function paintBreadth(m) {
    var host = document.getElementById("mktBreadth");
    var panel = document.getElementById("mktBreadthPanel");
    if (!host || !panel) return;
    host.textContent = "";

    var b = m.breadth || {}, p = m.premium || {};
    var bull = isNum(b.bull) || 0, bear = isNum(b.bear) || 0, flat = isNum(b.flat) || 0;
    var total = bull + bear + flat;

    var bar = el("div", "mk-stack");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label",
      bull + " names net bought, " + bear + " net sold, " + flat + " level, of " + total + " priced.");
    [["is-pos", bull, "bought"], ["is-flat", flat, "level"], ["is-neg", bear, "sold"]]
      .forEach(function (seg) {
        if (!seg[1] || !total) return;
        var i = el("i", "mk-seg " + seg[0]);
        i.style.width = (seg[1] / total * 100) + "%";
        i.title = seg[1] + " " + seg[2];
        bar.append(i);
      });
    host.append(bar);

    var legend = el("ul", "mk-legend");
    [["is-pos", bull + " bought"], ["is-flat", flat + " level"], ["is-neg", bear + " sold"]]
      .forEach(function (seg) {
        var li = el("li");
        li.append(el("i", "mk-key " + seg[0]));
        li.append(el("span", null, seg[1]));
        legend.append(li);
      });
    host.append(legend);

    /* CONCENTRATION, BESIDE THE TOTAL IT QUALIFIES. A market-wide sum is a
       number one takeover print can own; without this, "the universe bought
       calls" and "one name bought calls" are the same sentence. */
    var share = isNum(p.topShare);
    var note = document.getElementById("mktBreadthNote");
    if (note) {
      var parts = [];
      if (share !== null) {
        parts.push("The five largest names account for " + pct(share) +
          " of all net premium moved. " +
          (share > 0.5
            ? "More than half the total is five names: read the aggregate as those names, not as the universe."
            : "The total is spread across the universe rather than owned by a handful of prints."));
      }
      if (isNum(b.unpriced)) {
        parts.push(b.unpriced + " of " + (isNum(m.n) || 0) + " screened names quoted no usable " +
          "net premium and are excluded from every total above rather than counted as level" +
          (isNum(p.oneLegged) && p.oneLegged ? " — " + p.oneLegged + " of them quoted one leg only." : "."));
      }
      note.textContent = parts.join(" ");
    }
    panel.hidden = false;
  }

  function paintTape(m) {
    var body = document.getElementById("mktTapeBody");
    var panel = document.getElementById("mktTapePanel");
    if (!body || !panel) return;
    body.textContent = "";

    var p = m.premium || {}, pcr = m.pcr || {}, ag = m.aggressor || {}, vol = m.vol || {};
    var rows = [
      ["Net premium, signed", usd(p.net), p.priced, toneClass(p.net)],
      ["Put contracts per call", isNum(pcr.volume) === null ? DASH : pcr.volume.toFixed(3), pcr.quotedVolume, ""],
      ["Put premium per call", isNum(pcr.premium) === null ? DASH : pcr.premium.toFixed(3), pcr.quotedPremium, ""],
      ["Calls lifted at the offer", pct(ag.callLift), ag.quoted, ""],
      ["Puts lifted at the offer", pct(ag.putLift), ag.quoted, ""],
      ["Median 30-day implied vol", pct(vol.iv30dMedian), vol.iv30dQuoted, ""],
      ["Median IV rank", pct(vol.ivRankMedian), vol.ivRankQuoted, ""],
    ];
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.append(el("th", null, r[0]));
      var td = el("td", "c-num " + r[3], r[1]);
      tr.append(td);
      /* NEVER A CONFIDENT ZERO IN THE POPULATION COLUMN EITHER: a reading no
         name quoted shows an em dash, not "0 names", which would read as a
         measured emptiness rather than an absent field. */
      tr.append(el("td", "c-num", isNum(r[2]) === null ? DASH : String(r[2])));
      body.append(tr);
    });
    panel.hidden = false;
  }

  function paintSectors(sectors) {
    var host = document.getElementById("mktSectors");
    var panel = document.getElementById("mktSectorPanel");
    var note = document.getElementById("mktSectorNote");
    if (!host || !panel) return;
    host.textContent = "";

    var rows = (sectors && Array.isArray(sectors.rows)) ? sectors.rows.slice() : [];
    var measured = rows.filter(function (r) { return isNum(r && r.trix) !== null; });
    if (!measured.length) {
      host.append(el("p", "flows-empty",
        "No sector carried enough history to settle a TRIX reading this session."));
      panel.hidden = false;
      return;
    }
    measured.sort(function (a, b) { return b.trix - a.trix; });

    var max = measured.reduce(function (m, r) { return Math.max(m, Math.abs(r.trix)); }, 0) || 1;
    var list = el("ul", "mk-sectors");
    measured.forEach(function (r) {
      var li = el("li", "mk-sector");
      li.append(el("span", "mk-sector-k", r.sector || r.etf || DASH));
      var track = el("span", "mk-track mk-track-sm");
      track.append(el("i", "mk-zero"));
      var bar = el("i", "mk-bar " + (r.trix >= 0 ? "is-pos" : "is-neg"));
      bar.style.width = (Math.abs(r.trix) / max * 50) + "%";
      bar.style.left = r.trix >= 0 ? "50%" : (50 - Math.abs(r.trix) / max * 50) + "%";
      track.append(bar);
      li.append(track);
      li.append(el("span", "mk-sector-v " + toneClass(r.trix), signed(r.trix, 1)));
      list.append(li);
    });
    host.append(list);

    var unmeasured = rows.length - measured.length;
    if (note) {
      note.textContent =
        "TRIX in basis points: a triple-smoothed momentum reading on each sector ETF's own " +
        "closes, so it describes the sector's trend rather than its level. The bar is scaled " +
        "to the widest reading this session, so it compares sectors with each other and never " +
        "with another day." +
        (unmeasured ? " " + unmeasured + " sector" + (unmeasured === 1 ? "" : "s") +
          " had too little history to settle and are omitted rather than drawn at zero." : "");
    }
    panel.hidden = false;
  }

  function moverList(title, rows, key) {
    var box = el("div", "mk-movers-col");
    box.append(el("h3", "mk-movers-h", title));
    if (!rows || !rows.length) {
      box.append(el("p", "flows-empty", "Nothing ranked."));
      return box;
    }
    var ul = el("ul", "mk-movers");
    rows.slice(0, 8).forEach(function (r) {
      var li = el("li");
      li.append(el("span", "mk-mv-t", r.t || DASH));
      var v = key === "chg"
        ? (isNum(r.chg) === null ? DASH : signed(r.chg * 100, 2) + "%")
        : usd(r.netPrem);
      li.append(el("span", "mk-mv-v " + toneClass(key === "chg" ? r.chg : r.netPrem), v));
      ul.append(li);
    });
    box.append(ul);
    return box;
  }

  function paintMovers(movers) {
    var host = document.getElementById("mktMovers");
    var panel = document.getElementById("mktMoversPanel");
    if (!host || !panel) return;
    host.textContent = "";
    if (!movers || movers.status === "pending") { panel.hidden = true; return; }

    var grid = el("div", "mk-movers-grid");
    grid.append(moverList("Largest risers", movers.risers, "chg"));
    grid.append(moverList("Largest fallers", movers.fallers, "chg"));
    var prem = movers.premium || {};
    grid.append(moverList("Most net call premium", prem.bullish, "netPrem"));
    grid.append(moverList("Most net put premium", prem.bearish, "netPrem"));
    host.append(grid);
    panel.hidden = false;
  }

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 401) { location.replace("/flows/"); return null; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  var status = document.getElementById("mktStatus");

  Promise.all([
    get("/api/flows/market"),
    get("/api/flows/sectors").catch(function () { return null; }),
    get("/api/flows/movers").catch(function () { return null; }),
  ]).then(function (all) {
    var m = all[0], sectors = all[1], movers = all[2];
    if (!m) return;

    if (m.status === "pending" || !isNum(m.n)) {
      /* THE ORDINARY STATE BEFORE THE FIRST RUN, stated as a fact about the
         store rather than as an error. */
      if (status) {
        status.textContent = "No session has been measured yet. This page is built from the " +
          "same screener response the board is drawn from, so it appears with the first " +
          "pipeline run after it shipped.";
      }
      return;
    }

    paintTilt(m);
    paintBreadth(m);
    paintTape(m);
    paintSectors(sectors);
    paintMovers(movers);

    if (status) {
      status.textContent = m.n + " screened names" +
        (isNum(m.screened) ? " of " + m.screened + " returned by the ladder" : "") +
        " · session " + (m.sessionDate || "unknown") +
        (m.generatedAt ? " · built " + new Date(m.generatedAt).toLocaleString() : "");
    }

    var foot = document.getElementById("mktFoot");
    var notes = m.notes || {};
    if (foot) {
      /* THE PROSE TRAVELS WITH THE NUMBERS. These strings are published in the
         payload beside the arithmetic that produced them, so a renderer cannot
         reword a caption into a claim the numbers do not support. */
      foot.textContent = [notes.population, notes.presence, notes.weighting, notes.refused]
        .filter(Boolean).join(" ");
    }
  }).catch(function (error) {
    if (status) status.textContent = "The market level could not be loaded: " + error.message;
  });
})();
