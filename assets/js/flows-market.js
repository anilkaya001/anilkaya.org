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

    /* THE FIELD THE PIPELINE ACTUALLY WRITES.

       This read `sectors.rows` for as long as the panel has existed, and the
       payload has never carried a `rows` key — the eleven readings go out
       under `sectors`. The publisher's own log line said so on every run
       ("published sector:trix: no rows, 3563 bytes") and nothing was looking.
       The suite did not catch it because its fixture was written from the
       same assumption as this function rather than from the pipeline, so the
       two agreed with each other and neither agreed with the publisher.

       There is deliberately NO `rows` fallback. A fallback would let the
       payload and this renderer drift apart again silently, which is the only
       reason the bug survived a live run that measured all eleven sectors. */
    var entries = (sectors && Array.isArray(sectors.sectors)) ? sectors.sectors.slice() : [];

    /* THREE DIFFERENT SILENCES, AND THEY MAY NOT SHARE A SENTENCE.

       Before, every one of these printed "No sector carried enough history",
       which is a claim ABOUT THE DATA — a measured emptiness. Two of the three
       are nothing of the kind: one is an unpublished key and one is a payload
       this page could not read. Saying the strongest of the three in all three
       cases is exactly the confident zero this project refuses everywhere
       else, and it is what made a working measurement look like a dead one. */
    if (!sectors || sectors.status === "pending") {
      host.append(el("p", "flows-empty",
        "The pipeline has not published this key yet. Sector momentum costs eleven " +
        "candle calls a run, so it appears with the first pipeline run after it shipped."));
      panel.hidden = false;
      return;
    }
    if (!entries.length) {
      host.append(el("p", "flows-empty",
        "This payload carried no sector readings, so the page cannot say whether any " +
        "sector settled. That is a gap in the payload rather than a fact about the market."));
      panel.hidden = false;
      return;
    }

    var measured = entries.filter(function (r) { return isNum(r && r.trix) !== null; });
    if (!measured.length) {
      /* NOW the sentence is earned: readings were published and none settled,
         and the payload says per sector why. */
      var why = entries.filter(function (r) { return r && r.reason; })
        .map(function (r) { return r.reason; })[0];
      host.append(el("p", "flows-empty",
        "No sector carried enough history to settle a TRIX reading this session." +
        (why ? " " + why : "")));
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

    var unmeasured = entries.length - measured.length;
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
    var band = document.getElementById("mktMoversBand");
    var panel = document.getElementById("mktMoversPanel");
    if (!host || !panel) return;
    host.textContent = "";
    if (band) band.textContent = "";
    if (!movers || movers.status === "pending") { panel.hidden = true; return; }

    var grid = el("div", "mk-movers-grid");
    grid.append(moverList("Largest risers", movers.risers, "chg"));
    grid.append(moverList("Largest fallers", movers.fallers, "chg"));
    var prem = movers.premium || {};
    grid.append(moverList("Most net call premium", prem.bullish, "netPrem"));
    grid.append(moverList("Most net put premium", prem.bearish, "netPrem"));
    host.append(grid);

    /* THE PER-CONTRACT BAND, cut by the pipeline from the vendor's own flow
       alerts. ABSENT WHOLE when the alerts leg failed on a run — a plain
       truthiness check, and absence renders as nothing rather than as an
       error, because the movers above published first and stand alone. */
    if (band && movers.premium && movers.premium.byContract) {
      moverBand(band, movers.premium.byContract);
    }
    panel.hidden = false;
  }

  /* The band's FEED object arrives under its own name so the payload-shape
     scan sees only real `movers.` reads inside paintMovers above. */
  function moverBand(host, feed) {
    var rows = Array.isArray(feed.rows) ? feed.rows : [];
    if (!rows.length) return;
    host.append(el("h3", "mk-movers-h", "Largest flagged contract windows"));
    var ul = el("ul", "mk-movers mk-band");
    rows.forEach(function (r) {
      var li = el("li");
      li.append(el("span", "mk-mv-t", contractLabel(r)));
      var v = usd(r.prem) + (r.sweep === true ? " · sweep" : "");
      li.append(el("span", "mk-mv-v " + toneClass(r.prem), v));
      ul.append(li);
    });
    host.append(ul);
    var seen = isNum(feed.seen);
    var shed = isNum(feed.shed);
    host.append(el("p", "fc-note",
      (feed.basis ? "Basis: " + feed.basis + ". " : "") +
      (shed !== null && shed > 0 && seen !== null
        ? rows.length + " kept of " + seen + " — a capped list, never the population. "
        : "") +
      "Windows the vendor's own alert rules flagged, ranked by their stated " +
      "premium within that selection — not the whole tape."));
  }

  /* One spelling of a contract for the band and the pulse's OI-change table:
     "TICKER C150 09-18". When the parsed legs are absent the vendor's own
     option symbol is shown as sent, or the ticker with an em dash. */
  function contractLabel(r) {
    if (r.cp && isNum(r.k) !== null && r.exp) {
      return (r.t || DASH) + " " + r.cp + String(r.k) + " " + String(r.exp).slice(5);
    }
    return r.oc || ((r.t || DASH) + " " + DASH);
  }

  /* ---------- the market pulse ------------------------------------
     Seven market-wide vendor feeds pooled under one payload key. Each
     feed carries its own status and fails alone, so each card below
     answers its own three silences: an UNPUBLISHED key hides the whole
     section (the file's convention for pending), an UNAVAILABLE feed
     names its reason, and a QUIET feed says the vendor answered with
     nothing — which for a pre-open read is ordinary, not an outage. */

  function paintPulse(pulse) {
    var panel = document.getElementById("mkPulsePanel");
    var grid = document.getElementById("mkPulseGrid");
    var stampEl = document.getElementById("mkPulseStamp");
    var foot = document.getElementById("mkPulseFoot");
    if (!panel || !grid) return;
    if (!pulse || pulse.status === "pending") { panel.hidden = true; return; }

    var notes = pulse.notes || {};
    grid.textContent = "";
    if (stampEl) stampEl.textContent = pulseStamp(pulse.readAt, pulse.refreshed);

    grid.append(tideCard(pulse.tide, notes.tide));
    grid.append(totalsCard(pulse.totals, notes.totals));
    grid.append(oiChangeCard(pulse.oiChange, notes.oiChange));
    grid.append(netImpactCard(pulse.netImpact, notes.netImpact));
    grid.append(insidersCard(pulse.insiders, notes.insiders));
    grid.append(darkpoolCard(pulse.darkpool, notes.darkpool));
    grid.append(seasonalityCard(pulse.seasonality, notes.seasonality));

    if (foot) foot.textContent = notes.refusals || "";

    /* REVEALED BEFORE THE TIDE IS MEASURED. A hidden element reports
       clientWidth 0 and the chart would silently draw at a fallback
       width — the flows-track precedent, unhide first, then measure. */
    panel.hidden = false;
    drawTide();
  }

  /* Sub-panel helpers take the FEED objects under their own names, so the
     payload-shape scan sees only real payload reads inside paintPulse. */

  var PULSE_QUIET = "The feed answered this read with nothing — ordinary " +
    "for a pre-open read of a series that fills during market hours.";
  var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function pulseStamp(readAt, refreshed) {
    if (typeof readAt !== "string") return "";
    var t = new Date(readAt);
    if (isNaN(t.getTime())) return "";
    var hm = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    if (refreshed === "intraday") {
      return "Read " + hm + " (refreshes about every 15 minutes during market hours).";
    }
    if (refreshed === "nightly") {
      return "Read " + hm + " with the nightly build (refreshes intraday during market hours).";
    }
    return "Read " + hm + ".";
  }

  function pulseCard(title, wide) {
    var card = el("div", "mk-pulse-card" + (wide ? " is-wide" : ""));
    card.append(el("h3", "mk-pulse-h", title));
    return card;
  }

  /* TWO OF THE THREE SILENCES, told apart in words and in the DOM. */
  function feedSilence(feed, quietText) {
    if (!feed || feed.status === "unavailable") {
      var p = el("p", "flows-empty",
        "This feed could not be read on this run" +
        (feed && feed.reason ? ": " + feed.reason : "") +
        ". Its six neighbours are unaffected.");
      p.setAttribute("data-empty", "unavailable");
      return p;
    }
    var q = el("p", "flows-empty", quietText || PULSE_QUIET);
    q.setAttribute("data-empty", "quiet");
    return q;
  }

  /* THE CAPPED-LIST RULE: a shortened list must say what it is short of,
     so it can never be read as the population. */
  function capLine(feed, shown, noun) {
    var seen = isNum(feed.seen);
    var shed = isNum(feed.shed);
    var capped = (shed !== null && shed > 0) || (seen !== null && shown < seen);
    if (!capped || seen === null) return null;
    return el("p", "fc-note mk-pulse-kept",
      shown + " " + noun + " kept of " + seen +
      " the feed returned — a capped list, never the population.");
  }

  function pulseTable(headers, aria) {
    var wrap = el("div", "flows-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", aria);
    var table = el("table", "flows-table mk-pulse-table");
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    headers.forEach(function (h) {
      var th = el("th", h.num ? "c-num" : null, h.label);
      th.scope = "col";
      hr.append(th);
    });
    thead.append(hr);
    table.append(thead);
    var tbody = document.createElement("tbody");
    table.append(tbody);
    wrap.append(table);
    return { wrap: wrap, body: tbody };
  }

  function grouped(v) {
    var n = isNum(v);
    return n === null ? DASH : Math.round(n).toLocaleString("en-US");
  }
  function signedGrouped(v) {
    var n = isNum(v);
    if (n === null) return DASH;
    return (n >= 0 ? "+" : MINUS) + Math.abs(Math.round(n)).toLocaleString("en-US");
  }
  function priceUsd(v) {
    var n = isNum(v);
    return n === null ? DASH : "$" + n.toFixed(2);
  }
  /* The vendor's percent-ish columns, rendered in the vendor's own units —
     the seasonality caption says so beside them. */
  function vendorPct(v) {
    var n = isNum(v);
    return n === null ? DASH : n.toFixed(2) + "%";
  }
  function signedVendorPct(v) {
    var n = isNum(v);
    if (n === null) return DASH;
    return (n >= 0 ? "+" : MINUS) + Math.abs(n).toFixed(2) + "%";
  }
  function hhmm(iso) {
    return (typeof iso === "string" && iso.length >= 16) ? iso.slice(11, 16) : DASH;
  }

  /* ---------- 1. the tide, as an SVG dual line --------------------- */

  var tideChart = null;   // {points, host} once the card is built

  function tideCard(feed, note) {
    var card = pulseCard("Market tide", true);
    var points = feed && Array.isArray(feed.points) ? feed.points : [];
    if (feed && feed.status === "ok" && points.length) {
      var chart = el("div", "mk-tide");
      card.append(chart);
      tideChart = { points: points, host: chart };
      var kept = capLine(feed, points.length, "buckets");
      if (kept) card.append(kept);
    } else {
      tideChart = null;
      card.append(feedSilence(feed));
    }
    if (note) card.append(el("p", "fc-note", note));
    return card;
  }

  function svgNode(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
      }
    }
    return n;
  }

  /** Full repaint at the host's CURRENT width — called at build and again on
      resize, never scaled: one viewBox unit is one CSS pixel. */
  function drawTide() {
    if (!tideChart || !tideChart.host) return;
    var host = tideChart.host;
    var points = tideChart.points;
    host.textContent = "";

    var W = Math.max(240, Math.min(1600, Math.round(host.clientWidth) || 320));
    var H = 180;
    var padL = 54, padR = 42, padT = 10, padB = 20;
    var n = points.length;

    var lo = 0, hi = 0;
    points.forEach(function (p) {
      var c = isNum(p.callPrem), q = isNum(p.putPrem);
      if (c !== null) { if (c < lo) lo = c; if (c > hi) hi = c; }
      if (q !== null) { if (q < lo) lo = q; if (q > hi) hi = q; }
    });
    if (lo === hi) hi = 1;   // a flat all-zero read still gets an axis

    var x = function (i) {
      return padL + (n < 2 ? 0 : (i / (n - 1)) * (W - padL - padR));
    };
    var y = function (v) {
      return padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
    };

    var svg = svgNode("svg", {
      class: "mk-tide-svg", viewBox: "0 0 " + W + " " + H,
      width: W, height: H, role: "img",
      "aria-label": "Net call premium and net put premium per bucket across " +
        "the session, two lines either side of a zero rule.",
    });

    // The zero rule, before the lines so they draw over it.
    svg.append(svgNode("line", {
      class: "mk-tide-zero", x1: padL, x2: W - padR,
      y1: y(0).toFixed(1), y2: y(0).toFixed(1),
    }));

    /* One path per series, pen up over null buckets: an absent reading is a
       GAP in the line, never a point at zero. */
    var seriesD = function (key) {
      var d = "", pen = false;
      points.forEach(function (p, i) {
        var v = isNum(p[key]);
        if (v === null) { pen = false; return; }
        d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
        pen = true;
      });
      return d;
    };
    var lastIdx = function (key) {
      for (var i = points.length - 1; i >= 0; i--) {
        if (isNum(points[i][key]) !== null) return i;
      }
      return -1;
    };

    var callD = seriesD("callPrem");
    var putD = seriesD("putPrem");
    if (callD) svg.append(svgNode("path", { class: "mk-tide-call", d: callD }));
    if (putD) svg.append(svgNode("path", { class: "mk-tide-put", d: putD }));

    /* End-of-line words, so hue is never the only channel. */
    var endLabel = function (key, word) {
      var i = lastIdx(key);
      if (i < 0) return;
      var t = svgNode("text", {
        class: "mk-tide-lab", x: (x(i) + 4).toFixed(1),
        y: (y(isNum(points[i][key])) + 3).toFixed(1),
      });
      t.textContent = word;
      svg.append(t);
    };
    endLabel("callPrem", "calls");
    endLabel("putPrem", "puts");

    // The y-axis in the units the sums are read in: usd() at min, 0, max.
    [hi, 0, lo].filter(function (v, i, arr) { return arr.indexOf(v) === i; })
      .forEach(function (v) {
        var t = svgNode("text", {
          class: "mk-tide-lab", x: padL - 6, y: (y(v) + 3).toFixed(1),
          "text-anchor": "end",
        });
        t.textContent = usd(v);
        svg.append(t);
      });

    // Three or four time ticks, HH:MM from the vendor's own bucket stamps.
    var step = Math.max(1, Math.round((n - 1) / 3) || 1);
    var ticks = [];
    for (var i = 0; i < n; i += step) ticks.push(i);
    if (ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);
    ticks.forEach(function (idx, j) {
      var t = svgNode("text", {
        class: "mk-tide-lab", x: x(idx).toFixed(1), y: H - 6,
        "text-anchor": j === 0 ? "start" : (j === ticks.length - 1 ? "end" : "middle"),
      });
      t.textContent = hhmm(points[idx].t);
      svg.append(t);
    });

    host.append(svg);
  }

  /* ---------- 2..7, the tabular cards ------------------------------ */

  function totalsCard(feed, note) {
    var card = pulseCard("Volume and premium per session");
    var rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (feed && feed.status === "ok" && rows.length) {
      var shown = rows.slice(0, 10);
      var t = pulseTable([
        { label: "Session" },
        { label: "Call vol", num: true }, { label: "Put vol", num: true },
        { label: "Call prem", num: true }, { label: "Put prem", num: true },
      ], "Total options volume and premium per session, split call and put");
      shown.forEach(function (r) {
        var tr = document.createElement("tr");
        var th = el("th", null, r.date || DASH);
        th.scope = "row";
        tr.append(th);
        tr.append(el("td", "c-num", grouped(r.callVol)));
        tr.append(el("td", "c-num", grouped(r.putVol)));
        tr.append(el("td", "c-num", usd(r.callPrem)));
        tr.append(el("td", "c-num", usd(r.putPrem)));
        t.body.append(tr);
      });
      card.append(t.wrap);
      var kept = capLine(feed, shown.length, "sessions");
      if (kept) card.append(kept);
    } else {
      card.append(feedSilence(feed));
    }
    if (note) card.append(el("p", "fc-note", note));
    return card;
  }

  function oiChangeCard(feed, note) {
    var card = pulseCard("Open-interest change");
    var rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (feed && feed.status === "ok" && rows.length) {
      var t = pulseTable([
        { label: "Contract" },
        { label: "Change", num: true }, { label: "Curr OI", num: true },
        { label: "Volume", num: true },
      ], "Contracts the vendor ranked by open-interest change");
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        var th = el("th", null, contractLabel(r));
        th.scope = "row";
        tr.append(th);
        tr.append(el("td", "c-num " + toneClass(r.change), signedGrouped(r.change)));
        tr.append(el("td", "c-num", grouped(r.currOi)));
        tr.append(el("td", "c-num", grouped(r.vol)));
        t.body.append(tr);
      });
      card.append(t.wrap);
      var kept = capLine(feed, rows.length, "contracts");
      if (kept) card.append(kept);
    } else {
      card.append(feedSilence(feed));
    }
    if (note) card.append(el("p", "fc-note", note));
    return card;
  }

  function netImpactCard(feed, note) {
    var card = pulseCard("Net premium impact");
    var rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (feed && feed.status === "ok" && rows.length) {
      /* VENDOR ORDER PRESERVED: the rows arrive under the vendor's own
         unpublished ranking, so the split slices positives and negatives in
         the order given rather than re-sorting inside a rule this payload
         cannot state. */
      var pos = [], neg = [];
      rows.forEach(function (r) {
        var v = isNum(r.netPrem);
        if (v === null) return;
        if (v > 0) pos.push(r);
        else if (v < 0) neg.push(r);
      });
      var cols = el("div", "mk-movers-grid mk-pulse-cols");
      cols.append(moverList("Positive net premium", pos, "netPrem"));
      cols.append(moverList("Negative net premium", neg, "netPrem"));
      card.append(cols);
      var shown = Math.min(pos.length, 8) + Math.min(neg.length, 8);
      var kept = capLine(feed, shown, "names");
      if (kept) card.append(kept);
    } else {
      card.append(feedSilence(feed));
    }
    if (note) card.append(el("p", "fc-note", note));
    return card;
  }

  function insidersCard(feed, note) {
    var card = pulseCard("Insider filings");
    var rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (feed && feed.status === "ok" && rows.length) {
      var t = pulseTable([
        { label: "Filing day" },
        { label: "Buys", num: true }, { label: "Sells", num: true },
        { label: "Buy notional", num: true }, { label: "Sell notional", num: true },
      ], "Aggregate insider filings per filing day");
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        var th = el("th", null, r.date || DASH);
        th.scope = "row";
        tr.append(th);
        tr.append(el("td", "c-num", grouped(r.buys)));
        tr.append(el("td", "c-num", grouped(r.sells)));
        tr.append(el("td", "c-num", usd(r.buysNotional)));
        tr.append(el("td", "c-num", usd(r.sellsNotional)));
        t.body.append(tr);
      });
      card.append(t.wrap);
      var kept = capLine(feed, rows.length, "filing days");
      if (kept) card.append(kept);
    } else {
      card.append(feedSilence(feed));
    }
    if (note) card.append(el("p", "fc-note", note));
    return card;
  }

  /* The ONE panel whose rows are reported equity executions, so "prints"
     is accurate here — and only here. */
  function darkpoolCard(feed, note) {
    var card = pulseCard("Dark pool prints");
    var rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (feed && feed.status === "ok" && rows.length) {
      var t = pulseTable([
        { label: "Name" }, { label: "Time", num: true },
        { label: "Price", num: true }, { label: "Size", num: true },
        { label: "Premium", num: true },
      ], "Off-exchange equity trades reported to the tape, as the vendor surfaces them");
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        var th = el("th", "fb-tk", r.t || DASH);
        th.scope = "row";
        tr.append(th);
        tr.append(el("td", "c-num", hhmm(r.at)));
        tr.append(el("td", "c-num", priceUsd(r.px)));
        tr.append(el("td", "c-num", grouped(r.size)));
        tr.append(el("td", "c-num", usd(r.prem)));
        t.body.append(tr);
      });
      card.append(t.wrap);
      var kept = capLine(feed, rows.length, "prints");
      if (kept) card.append(kept);
    } else {
      card.append(feedSilence(feed));
    }
    if (note) card.append(el("p", "fc-note", note));
    return card;
  }

  function seasonalityCard(feed, note) {
    var card = pulseCard("Seasonality by month");
    var rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (feed && feed.status === "ok" && rows.length) {
      var strip = el("div", "mk-sea");
      var nowMonth = new Date().getMonth() + 1;
      rows.forEach(function (r) {
        var m = isNum(r.month);
        var cell = el("div", "mk-sea-cell" + (m === nowMonth ? " is-now" : ""));
        cell.append(el("span", "mk-sea-m",
          m !== null && m >= 1 && m <= 12 ? MONTH_ABBR[m - 1] : DASH));
        cell.append(el("span", "mk-sea-v " + toneClass(r.avg), signedVendorPct(r.avg)));
        cell.append(el("span", "mk-sea-p", vendorPct(r.positivePct)));
        var tip = [];
        if (isNum(r.median) !== null) tip.push("median " + signedVendorPct(r.median));
        if (isNum(r.min) !== null && isNum(r.max) !== null) {
          tip.push("range " + signedVendorPct(r.min) + " to " + signedVendorPct(r.max));
        }
        if (isNum(r.years) !== null) tip.push("over " + r.years + " years");
        if (tip.length) cell.title = tip.join(" · ");
        strip.append(cell);
      });
      card.append(strip);
      card.append(el("p", "fc-note mk-pulse-kept",
        "Average monthly change, with the share of positive closes beneath it; " +
        "units are as published by the vendor."));
      var kept = capLine(feed, rows.length, "months");
      if (kept) card.append(kept);
    } else {
      card.append(feedSilence(feed));
    }
    if (note) card.append(el("p", "fc-note", note));
    return card;
  }

  /* Repainted whole at the new width, never scaled — the flows-track rule. */
  var tideResizeTimer = 0;
  window.addEventListener("resize", function () {
    if (!tideChart) return;
    clearTimeout(tideResizeTimer);
    tideResizeTimer = setTimeout(drawTide, 150);
  });

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
    get("/api/flows/pulse").catch(function () { return null; }),
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
    paintPulse(all[3]);

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
