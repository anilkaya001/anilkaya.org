(function () {
  "use strict";

  var MINUS = "−";
  var DASH = "—";

  function isNum(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string") return null;
    if (v.trim() === "") return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) {
      if (cls && /\bfc-note\b/.test(cls)) dated(n, String(text));
      else n.textContent = String(text);
    }
    return n;
  }

  function signGlyph(n) {
    return n < 0 ? MINUS : (n > 0 ? "+" : "");
  }

  function barClass(n) {
    return n < 0 ? "is-neg" : (n > 0 ? "is-pos" : "is-flat");
  }
  function signed(v, dp) {
    var n = isNum(v);
    if (n === null) return DASH;
    return signGlyph(n) + Math.abs(n).toFixed(dp === undefined ? 2 : dp);
  }
  function pct(v, dp) {
    var n = isNum(v);
    if (n === null) return DASH;
    return (n * 100).toFixed(dp === undefined ? 1 : dp) + "%";
  }

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

  function count(v) {
    var n = isNum(v);
    return n === null ? DASH : String(n);
  }

  function emptyLine(kind, text) {
    var p = el("p", "flows-empty", text);
    p.setAttribute("data-empty", kind);
    return p;
  }

  function optional(path) {
    return get(path).catch(function (error) {
      return {
        __unreadable: true,
        __path: path,
        __reason: (error && error.message) ? error.message : String(error),
      };
    });
  }
  function unreadable(feed) {
    return !!(feed && feed.__unreadable === true);
  }
  function unreadableLine(feed, what) {
    return emptyLine("unreadable",
      "The request for " + what + " did not come back" +
      (feed && feed.__reason ? " (" + feed.__reason + ")" : "") +
      ". That is this page failing to READ the payload, not a statement about " +
      "what the payload holds — reload before drawing any conclusion from the " +
      "panels that did load.");
  }
  function pendingLine(what, cost) {
    return emptyLine("pending",
      "The pipeline has not published " + what + " yet. " + cost);
  }

  function ageWords(minutes) {
    var m = Math.max(0, Math.round(minutes));
    if (m < 90) return m + (m === 1 ? " minute" : " minutes");
    var h = Math.round(m / 60);
    if (h < 36) return h + (h === 1 ? " hour" : " hours");
    var d = Math.round(h / 24);
    return d + (d === 1 ? " day" : " days");
  }

  var staleEl = document.getElementById("mktStale");

  var STALE_WRITE_MS = 30 * 60 * 60 * 1000;
  var STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;

  var ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  function assessAge(payload) {
    var now = Date.now();
    if (!payload || typeof payload !== "object") return { kind: "unknown", message: null };

    var stamped = isNum(payload.__updatedAt);
    var written = stamped !== null && stamped > 0 ? stamped : null;
    if (written !== null && now - written > STALE_WRITE_MS) {
      var hours = Math.floor((now - written) / 3600000);
      var days = Math.floor(hours / 24);

      var age = days >= 1
        ? days + (days === 1 ? " day" : " days")
        : hours + (hours === 1 ? " hour" : " hours");
      return {
        kind: "write",
        message: "This market level was last written " + age +
          " ago. The pipeline has not published since — check the Actions tab.",
      };
    }

    var session = null;
    if (ISO_DAY.test(String(payload.sessionDate || ""))) {
      var parsed = Date.parse(String(payload.sessionDate) + "T21:00:00Z");
      if (isFinite(parsed)) session = parsed;
    }
    if (session !== null && now - session > STALE_SESSION_MS) {
      return {
        kind: "session",
        message: "These numbers describe the " + payload.sessionDate + " session, " +
          "which is more than four days old. The pipeline is running but its " +
          "data is not advancing.",
      };
    }

    if (written === null && session === null) return { kind: "unknown", message: null };
    return { kind: "fresh", message: null };
  }

  function setStale(verdict) {
    if (!staleEl) return;
    var message = (verdict && verdict.message) || "";
    staleEl.hidden = !message;
    staleEl.textContent = message;
    if (message) staleEl.setAttribute("data-stale", (verdict && verdict.kind) || "stale");
    else staleEl.removeAttribute("data-stale");
    document.body.classList.toggle("is-stale", Boolean(message));
  }

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
      var bar = el("i", "mk-bar " + barClass(n));

      bar.style.width = (Math.min(Math.abs(n), 1) * 50) + "%";
      bar.style.left = n >= 0 ? "50%" : (50 - Math.min(Math.abs(n), 1) * 50) + "%";
      track.append(bar);
    }
    wrap.append(track);
    var scale = el("div", "mk-scale");
    scale.setAttribute("aria-hidden", "true");
    [MINUS + "1", "0", "+1"].forEach(function (s) { scale.append(el("span", null, s)); });
    wrap.append(scale);
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
      count(breadth.bull) + " bought, " + count(breadth.bear) + " sold, " +
      count(breadth.flat) + " level, of " + count(premium.priced) +
      " names that quoted both legs."));

    host.append(tiltRow(
      "Premium tilt — weighting by dollars",
      premium.tilt,
      usd(premium.netPositive) + " of net call premium against " +
      usd(premium.netNegative) + " of net put premium."));

    var lead = document.getElementById("mktTiltLead");
    var note = document.getElementById("mktTiltNote");
    var b = isNum(breadth.tilt), p = isNum(premium.tilt);
    var said = "";
    var how = "";
    if (b === null || p === null) {

      said = "One of the two weightings could not be measured this session, " +
        "so they cannot be compared.";
    } else if (b === 0 || p === 0) {

      if (b === 0 && p === 0) {
        said = "Both weightings came back exactly level: the names split evenly and so did " +
          "the dollars. There is no lean to agree or disagree about.";
      } else {

        said = (b === 0
          ? "Counting names, the session was exactly level while the dollars leaned " +
            (p > 0 ? "positive" : "negative")
          : "The dollars were exactly level while more names leaned " +
            (b > 0 ? "positive" : "negative")) +
          ", so the two weightings neither agree nor disagree.";
        how = "One weighting has a sign and the other does not, which is itself a reading " +
          "and the reason both are drawn.";
      }
    } else if ((b > 0) !== (p > 0)) {
      said = "The two weightings DISAGREE in sign: more names leaned " +
        (b > 0 ? "positive" : "negative") + " while the dollars leaned " +
        (p > 0 ? "positive" : "negative") + " — breadth without size, or size without breadth.";

      how = "";
    } else {
      said = "Both weightings agree in sign: names and dollars both leaned " +
        (b > 0 ? "positive" : "negative") + " this session.";
    }
    if (lead) lead.textContent = said;
    if (note) note.textContent = how;
    panel.hidden = false;
  }

  function paintBreadth(m) {
    var host = document.getElementById("mktBreadth");
    var panel = document.getElementById("mktBreadthPanel");
    if (!host || !panel) return;
    host.textContent = "";

    var b = m.breadth || {}, p = m.premium || {};
    var bull = isNum(b.bull), bear = isNum(b.bear), flat = isNum(b.flat);

    var splitDrew = false;
    if (bull === null || bear === null || flat === null) {
      var absent = [];
      if (bull === null) absent.push("net bought");
      if (bear === null) absent.push("net sold");
      if (flat === null) absent.push("level");
      host.append(emptyLine("unavailable",
        "The breadth split cannot be drawn: this payload published no count of names " +
        absent.join(", ") + ", so its three parts do not add to a whole and drawing the " +
        "rest would publish a total that was never measured."));
    } else if (bull + bear + flat === 0) {

      host.append(emptyLine("quiet",
        "No screened name quoted both a call and a put leg this session, so there is no " +
        "priced population to split. The three counts were published and all three are zero."));
    } else {
      splitDrew = true;
      var total = bull + bear + flat;

      var bar = el("div", "mk-stack");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label",
        bull + " names net bought, " + bear + " net sold, " + flat + " level, of " + total + " priced.");
      [["is-pos", bull, "bought"], ["is-flat", flat, "level"], ["is-neg", bear, "sold"]]
        .forEach(function (seg) {
          if (!seg[1]) return;
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
    }

    var share = isNum(p.topShare);
    var lead = document.getElementById("mktBreadthLead");
    var qual = document.getElementById("mktBreadthQual");
    var note = document.getElementById("mktBreadthNote");

    var caveats = [];
    var concentration = share === null ? null
      : "The five largest names account for " + pct(share) + " of all net premium moved.";
    if (lead) lead.textContent = splitDrew && concentration ? concentration : "";
    if (!splitDrew && concentration) caveats.push(concentration);
    if (share !== null && share > 0.5) {
      caveats.push("More than half the total is five names: read the aggregate as those " +
        "names, not as the universe.");
    }

    var unpriced = isNum(b.unpriced), oneLeg = isNum(p.oneLegged);
    if (unpriced !== null) {
      caveats.push(unpriced + " of " + count(m.n) + " screened names quoted no usable " +
        "net premium and are excluded from every total above rather than counted as level" +
        (oneLeg ? " — " + oneLeg + " of them quoted one leg only." : "."));
    }
    if (qual) qual.textContent = caveats.join(" ");
    if (note) {
      note.textContent = share !== null && share <= 0.5
        ? "The total is spread across the universe rather than owned by a handful of prints."
        : "";
    }
    panel.hidden = false;
  }

  function paintTape(m) {
    var body = document.getElementById("mktTapeBody");
    var panel = document.getElementById("mktTapePanel");
    if (!body || !panel) return;
    body.textContent = "";

    var p = m.premium || {}, pcr = m.pcr || {}, ag = m.aggressor || {}, vol = m.vol || {};

    var pcrVol = isNum(pcr.volume), pcrPrem = isNum(pcr.premium);
    var rows = [
      ["Net premium, signed", usd(p.net), p.priced, toneClass(p.net)],
      ["Put contracts per call", pcrVol === null ? DASH : pcrVol.toFixed(3), pcr.quotedVolume, ""],
      ["Put premium per call", pcrPrem === null ? DASH : pcrPrem.toFixed(3), pcr.quotedPremium, ""],
      ["Calls lifted at the offer", pct(ag.callLift), ag.quoted, ""],
      ["Puts lifted at the offer", pct(ag.putLift), ag.quoted, ""],
      ["Median 30-day implied vol", pct(vol.iv30dMedian), vol.iv30dQuoted, ""],
      ["Median IV rank", pct(vol.ivRankMedian), vol.ivRankQuoted, ""],
    ];
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.append(el("th", null, r[0]));
      var pop = isNum(r[2]);
      var empty = pop === 0;
      tr.append(el("td", "c-num " + (empty ? "" : r[3]), empty ? DASH : r[1]));

      tr.append(el("td", "c-num", pop === null ? DASH : String(r[2])));
      body.append(tr);
    });
    panel.hidden = false;
  }

  function sectorBp(r) {
    return isNum(r && r.trixBp);
  }

  function paintSectors(sectors) {
    var host = document.getElementById("mktSectors");
    var panel = document.getElementById("mktSectorPanel");
    var note = document.getElementById("mktSectorNote");
    var lead = document.getElementById("mktSectorLead");
    var qual = document.getElementById("mktSectorQual");
    if (!host || !panel) return;
    host.textContent = "";

    if (note) note.textContent = "";
    if (lead) lead.textContent = "";
    if (qual) qual.textContent = "";

    var entries = (sectors && Array.isArray(sectors.sectors)) ? sectors.sectors.slice() : [];

    if (unreadable(sectors)) {
      host.append(unreadableLine(sectors, "sector momentum (/api/flows/sectors)"));
      panel.hidden = false;
      return;
    }
    if (!sectors || sectors.status === "pending") {
      host.append(pendingLine("sector momentum",
        "It costs eleven candle calls a run, so it appears with the first pipeline " +
        "run after it shipped."));
      panel.hidden = false;
      return;
    }
    if (!entries.length) {
      host.append(emptyLine("unavailable",
        "This payload carried no sector readings, so the page cannot say whether any " +
        "sector settled. That is a gap in the payload rather than a fact about the market."));
      panel.hidden = false;
      return;
    }

    var measured = entries.filter(function (r) { return sectorBp(r) !== null; });

    var scoreOnly = entries.filter(function (r) {
      return sectorBp(r) === null && isNum(r && r.trix) !== null;
    }).length;

    if (!measured.length) {

      var why = entries.filter(function (r) { return r && r.reason; })
        .map(function (r) { return r.reason; })[0];
      host.append(emptyLine("quiet",
        "No sector carried enough history to settle a TRIX reading this session" +
        (why ? " (" + why + ")." : ".")));
      panel.hidden = false;
      return;
    }

    var scaling = (sectors && sectors.scaling) || {};
    var published = isNum(scaling.fullScaleBp);
    var fixedAxis = published !== null && published > 0;
    var axis = fixedAxis
      ? published
      : (measured.reduce(function (a, r) { return Math.max(a, Math.abs(sectorBp(r))); }, 0) || 1);

    measured.sort(function (a, b) { return sectorBp(b) - sectorBp(a); });

    var railed = 0;
    var list = el("ul", "mk-sectors");

    var sectorKey = function (r) {
      var name = r.sector || r.etf || DASH;
      var k = el("span", "mk-sector-k", name);
      if (r.etf && r.etf !== name) {
        k.append(" ");
        k.append(el("small", "mk-sector-etf", r.etf));
      }
      return k;
    };
    var spoken = function (r) {
      var name = r.sector || r.etf || DASH;
      return name + (r.etf && r.etf !== name ? " (" + r.etf + ")" : "");
    };
    measured.forEach(function (r) {
      var bp = sectorBp(r);
      var frac = Math.min(Math.abs(bp) / axis, 1);
      if (frac >= 1 && Math.abs(bp) > axis) railed++;

      var li = el("li", "mk-sector");
      li.append(sectorKey(r));

      var track = el("span", "mk-track mk-track-sm");
      track.setAttribute("role", "img");

      track.setAttribute("aria-label",
        spoken(r) + " " + signed(bp, 2) + " basis points per session, " +
        (bp < 0 ? "left of" : bp > 0 ? "right of" : "at") + " the zero rule.");
      track.append(el("i", "mk-zero"));
      var bar = el("i", "mk-bar " + barClass(bp));
      bar.style.width = (frac * 50) + "%";
      bar.style.left = bp >= 0 ? "50%" : (50 - frac * 50) + "%";
      bar.title = signed(bp, 2) + " bp";
      track.append(bar);
      li.append(track);

      li.append(el("span", "mk-sector-v " + toneClass(bp), signed(bp, 2) + " bp"));
      list.append(li);
    });

    entries.forEach(function (r) {
      if (!r || sectorBp(r) !== null || isNum(r.trix) !== null) return;
      var li = el("li", "mk-sector is-unsettled");
      li.append(sectorKey(r));
      li.append(emptyLine("unavailable",
        "not settled — " + (r.reason || "the payload gives no reason")));
      list.append(li);
    });
    host.append(list);

    var unmeasured = entries.length - measured.length - scoreOnly;

    if (lead) {
      lead.textContent = measured.length + " of " + entries.length + " sector" +
        (entries.length === 1 ? "" : "s") + " settled a reading.";
    }

    var caveats = [];
    if (fixedAxis) {
      caveats.push("The axis is the payload's own published band, " + MINUS + axis + " to +" +
        axis + " bp, which is the same band every session: a bar can be read against " +
        "another sector and against this sector last week.");
      if (railed) {
        caveats.push(railed + " sector" + (railed === 1 ? " sits" : "s sit") +
          " beyond that band and " + (railed === 1 ? "is" : "are") +
          " drawn at full width; the number beside " + (railed === 1 ? "it" : "them") +
          " is the true reading, not the rail.");
      }
    } else {
      caveats.push("This payload published no full-scale band, so the axis is scaled to the " +
        "widest reading of this session only — it compares sectors with each other and " +
        "never with another day.");
    }
    if (sectors.basis) caveats.push("Basis: " + sectors.basis + ".");
    if (unmeasured > 0) {
      caveats.push(unmeasured + " of " + entries.length + " sector" +
        (entries.length === 1 ? "" : "s") + " had too little history to settle and " +
        (unmeasured === 1 ? "is" : "are") + " listed without a bar, with the payload's " +
        "own reason beside the name, rather than drawn at zero.");
    }
    if (scoreOnly > 0) {
      caveats.push(scoreOnly + " sector" + (scoreOnly === 1 ? "" : "s") +
        " published a clamp score with no raw reading beside it and cannot be drawn " +
        "signed; that is a payload defect rather than a quiet sector.");
    }
    if (qual) qual.textContent = caveats.join(" ");

    if (note) {
      note.textContent =
        "TRIX in basis points per session: a triple-smoothed momentum reading on each " +
        "sector ETF's own log closes, so it describes the sector's trend rather than its " +
        "level. " +
        "Sign is carried by POSITION — left of the centre rule is negative — and by the " +
        "glyph on the number, so the panel survives greyscale and a monochrome printout.";
    }
    panel.hidden = false;
  }

  function moverList(title, rows, key) {
    var box = el("div", "mk-movers-col");
    var head = el("h3", "mk-movers-h", title);
    box.append(head);
    if (!Array.isArray(rows)) {
      box.append(emptyLine("unavailable",
        "This payload published no ranking for " + title.toLowerCase() + ", so this column " +
        "was never measured. It is not a statement that no name qualified."));
      return box;
    }
    if (!rows.length) {
      box.append(emptyLine("quiet",
        "The ranking for " + title.toLowerCase() + " was taken and came back with no name " +
        "in it — a fact about the session."));
      return box;
    }

    var shown = rows.slice(0, 8);
    head.append(el("span", "mk-movers-n", " · " + shown.length + " of " + rows.length));
    var ul = el("ul", "mk-movers");
    shown.forEach(function (r) {
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

    if (unreadable(movers)) {
      host.append(unreadableLine(movers, "the session's extremes (/api/flows/movers)"));
      panel.hidden = false;
      return;
    }
    if (!movers || movers.status === "pending") {
      host.append(pendingLine("the session's extremes",
        "They are cut from screener rows the run already holds and cost no vendor " +
        "call, so they appear with the first pipeline run after this shipped."));
      panel.hidden = false;
      return;
    }

    var prem = movers.premium || {};
    var lists = [
      ["Largest risers", movers.risers, "chg"],
      ["Largest fallers", movers.fallers, "chg"],
      ["Most net call premium", prem.bullish, "netPrem"],
      ["Most net put premium", prem.bearish, "netPrem"],
    ];

    if (!lists.some(function (spec) { return spec[1] && spec[1].length; })) {
      host.append(emptyLine("quiet",
        "This payload ranked no name on any of the four extremes. The screener answered " +
        "and the ranking came back empty, which is a statement about the session rather " +
        "than a failure to read it."));
      panel.hidden = false;
      return;
    }

    var grid = el("div", "mk-movers-grid");
    lists.forEach(function (spec) { grid.append(moverList(spec[0], spec[1], spec[2])); });
    host.append(grid);

    var universe = isNum(movers.universe), ranked = isNum(movers.ranked);
    var priced = isNum(movers.priced);
    var noChange = isNum(movers.unrankedChange), noPrem = isNum(movers.unrankedPremium);
    if (universe === null || ranked === null || priced === null ||
        noChange === null || noPrem === null) {
      host.append(emptyLine("unavailable",
        "This payload published no count of the screened names it ranked, so the four " +
        "columns above carry no denominator. That is a gap in the payload, not a " +
        "statement about the session."));
    } else {
      host.append(el("p", "fc-note mk-movers-pop",
        ranked + " of " + universe + " screened names could be ranked by change and " +
        priced + " by net premium; " + noChange + " quoted no change and " + noPrem +
        " no net premium, and those names are in no column. Each column prints at most " +
        "its first 8 names."));
    }

    if (band && movers.premium && movers.premium.byContract) {
      moverBand(band, movers.premium.byContract);
    }
    panel.hidden = false;
  }

  function moverBand(host, feed) {
    var rows = Array.isArray(feed.rows) ? feed.rows : [];
    if (!rows.length) return;
    host.append(el("h3", "mk-movers-h", "Largest flagged contract windows"));
    var ul = el("ul", "mk-movers mk-band");
    rows.forEach(function (r) {
      var li = el("li");
      li.append(el("span", "mk-mv-t", contractLabel(r)));
      var v = usd(r.prem) + (r.sweep === true ? " · sweep" : "");
      li.append(el("span", "mk-mv-v", v));
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

  function contractLabel(r) {
    if (r.cp && isNum(r.k) !== null && r.exp) {
      return (r.t || DASH) + " " + r.cp + String(r.k) + " " + String(r.exp).slice(5);
    }
    return r.oc || ((r.t || DASH) + " " + DASH);
  }

  function paintPulse(pulse) {
    var panel = document.getElementById("mkPulsePanel");
    var grid = document.getElementById("mkPulseGrid");
    var stampEl = document.getElementById("mkPulseStamp");
    var foot = document.getElementById("mkPulseFoot");
    if (!panel || !grid) return;

    if (unreadable(pulse) || !pulse || pulse.status === "pending") {
      grid.textContent = "";
      if (stampEl) stampEl.textContent = "";
      if (foot) foot.textContent = "";

      tideChart = null;
      totalsChart = null;
      grid.append(unreadable(pulse)
        ? unreadableLine(pulse, "the market pulse (/api/flows/pulse)")
        : pendingLine("the market pulse",
          "Seven market-wide feeds are pooled under one key that refreshes during " +
          "market hours; the section fills on the first run that writes it."));
      panel.hidden = false;
      return;
    }

    var notes = pulse.notes || {};
    grid.textContent = "";

    if (stampEl) {
      stampEl.textContent = pulseStamp(pulse.readAt, pulse.refreshed, pulse.cadenceMinutes);
    }

    grid.append(tideCard(pulse.tide, notes.tide));
    grid.append(totalsCard(pulse.totals, notes.totals));
    grid.append(oiChangeCard(pulse.oiChange, notes.oiChange));
    grid.append(netImpactCard(pulse.netImpact, notes.netImpact));
    grid.append(insidersCard(pulse.insiders, notes.insiders));
    grid.append(darkpoolCard(pulse.darkpool, notes.darkpool));
    grid.append(seasonalityCard(pulse.seasonality, notes.seasonality));

    if (foot) foot.textContent = notes.refusals || "";

    panel.hidden = false;
    drawCharts();
  }

  var PULSE_QUIET = "The feed answered this read with nothing — ordinary " +
    "before the open for a series that fills during market hours, and a vendor " +
    "silence rather than a quiet market when the read is stamped after the close.";
  var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function dated(node, text) {
    node.textContent = /\d{4}-\d{2}-\d{2}/.test(text) ? "" : text;
    if (node.textContent) return node;
    var re = /\d{4}-\d{2}-\d{2}/g, at = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > at) node.append(document.createTextNode(text.slice(at, m.index)));
      var d = document.createElement("span");
      d.className = "flows-date";
      d.textContent = m[0];
      node.append(d);
      at = m.index + m[0].length;
    }
    if (at < text.length) node.append(document.createTextNode(text.slice(at)));
  }

  function utcStamp(t, withDay) {
    var iso = t.toISOString();
    return (withDay ? iso.slice(0, 16).replace("T", " ") : iso.slice(11, 16)) + " UTC";
  }

  function pulseStamp(readAt, refreshed, cadenceMinutes) {
    if (typeof readAt !== "string") return "";
    var t = new Date(readAt);
    if (isNaN(t.getTime())) return "";
    var now = new Date();
    var sameDay = utcStamp(t, true).slice(0, 10) === utcStamp(now, true).slice(0, 10);
    var when = utcStamp(t, !sameDay);
    var ageMin = (now.getTime() - t.getTime()) / 60000;
    var build = refreshed === "nightly" ? " with the nightly build" : "";

    var minutes = isNum(cadenceMinutes);
    var cadence = (minutes !== null && minutes > 0) ? minutes : null;
    if (cadence === null) {

      var since = Math.round(ageMin) >= 1 ? ", " + ageWords(ageMin) + " ago" : "";
      return "Read " + when + build + since + ". This payload did not publish the refresh " +
        "cadence, so this page cannot say whether that read is still current.";
    }

    var live = ageMin < cadence * 2;
    var stale = ", last read " + ageWords(ageMin) + " ago — the intraday refresh is not " +
      "keeping it current, so every number below is as of that stamp.";

    if (refreshed === "intraday") {
      return live
        ? "Read " + when + " (refreshes about every " + cadence +
          (cadence === 1 ? " minute" : " minutes") + " during market hours)."
        : "Read " + when + stale;
    }
    if (refreshed === "nightly") {
      return live
        ? "Read " + when + build + " (refreshes intraday during market hours)."
        : "Read " + when + build + stale;
    }
    return "Read " + when + (live ? "." : ", " + ageWords(ageMin) + " ago.");
  }

  function pulseCard(title, wide) {
    var card = el("div", "mk-pulse-card" + (wide ? " is-wide" : ""));
    card.append(el("h3", "mk-pulse-h", title));
    return card;
  }

  function feedSilence(feed, quietText) {
    if (!feed || feed.status === "unavailable") {
      return emptyLine("unavailable",
        "This feed could not be read on this run" +
        (feed && feed.reason ? ": " + feed.reason : "") +
        ". Its six neighbours are unaffected.");
    }
    return emptyLine("quiet", quietText || PULSE_QUIET);
  }

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

    var r = Math.round(n);
    return signGlyph(r) + Math.abs(r).toLocaleString("en-US");
  }
  function priceUsd(v) {
    var n = isNum(v);
    return n === null ? DASH : "$" + n.toFixed(2);
  }

  function vendorPct(v) {
    var n = isNum(v);
    return n === null ? DASH : n.toFixed(2) + "%";
  }
  function signedVendorPct(v) {
    var n = isNum(v);
    if (n === null) return DASH;
    return signGlyph(n) + Math.abs(n).toFixed(2) + "%";
  }

  function signedGrowthPct(v) {
    var n = isNum(v);
    if (n === null) return DASH;
    var p = n * 100;
    var r = Math.abs(p) >= 100 ? Math.round(p) : Math.round(p * 10) / 10;
    return signGlyph(r) + Math.abs(r).toLocaleString("en-US") + "%";
  }
  function growthCell(r) {
    var n = isNum(r.ratio), prev = isNum(r.prevOi);
    var td = el("td", "c-num", signedGrowthPct(r.ratio));
    if (n === null || n <= 0) return td;
    if (prev !== null && prev < 100) {
      td.textContent = "new";
      td.title = "From " + grouped(prev) + " contracts, a base too small for a percentage to mean anything";
    } else if (n >= 10) {
      var times = Math.round(1 + n).toLocaleString("en-US");
      td.textContent = "\u00d7" + times;
      td.title = times + " times the previous snapshot's open interest (" + signedGrowthPct(n) + ")";
    }
    return td;
  }
  function hhmm(iso) {
    return (typeof iso === "string" && iso.length >= 16) ? iso.slice(11, 16) : DASH;
  }

  var tideChart = null;
  var totalsChart = null;

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

  function drawLines(spec) {
    var host = spec.host;
    if (!host) return;
    var points = spec.points;
    host.textContent = "";

    var box = host.getBoundingClientRect ? host.getBoundingClientRect().width : 0;
    var measured = Math.floor(isNum(box) === null ? 0 : box);
    if (!measured) measured = Math.floor(host.clientWidth) || 0;

    var W = measured > 0 ? Math.min(1600, measured) : 320;
    var H = spec.height || 180;
    var padL = Math.min(54, Math.round(W * 0.19));
    var padR = Math.min(42, Math.round(W * 0.15));
    var padT = 10, padB = 20;
    var n = points.length;

    var lo = 0, hi = 0;
    points.forEach(function (p) {
      spec.series.forEach(function (ser) {
        var v = isNum(p[ser.key]);
        if (v === null) return;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      });
    });
    if (lo === hi) hi = 1;

    var x = function (i) {
      return padL + (n < 2 ? 0 : (i / (n - 1)) * (W - padL - padR));
    };
    var y = function (v) {
      return padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
    };

    var svg = svgNode("svg", {
      class: "mk-tide-svg", viewBox: "0 0 " + W + " " + H,
      width: W, height: H, preserveAspectRatio: "xMidYMid meet",
      role: "img", "aria-label": spec.aria,
    });

    svg.style.width = W + "px";
    svg.style.height = H + "px";

    svg.append(svgNode("line", {
      class: "mk-tide-zero", x1: padL, x2: W - padR,
      y1: y(0).toFixed(1), y2: y(0).toFixed(1),
    }));

    var seriesD = function (key) {
      var vals = points.map(function (p) { return isNum(p[key]); });
      var d = "", i = 0;
      while (i < n) {
        if (vals[i] === null) { i++; continue; }
        var j = i;
        while (j + 1 < n && vals[j + 1] !== null) j++;
        if (j === i) {

          d += "M" + (x(i) - 2).toFixed(1) + " " + y(vals[i]).toFixed(1) +
               "L" + (x(i) + 2).toFixed(1) + " " + y(vals[i]).toFixed(1);
        } else {
          for (var k = i; k <= j; k++) {
            d += (k === i ? "M" : "L") + x(k).toFixed(1) + " " + y(vals[k]).toFixed(1);
          }
        }
        i = j + 1;
      }
      return d;
    };
    var lastIdx = function (key) {
      for (var i = points.length - 1; i >= 0; i--) {
        if (isNum(points[i][key]) !== null) return i;
      }
      return -1;
    };

    spec.series.forEach(function (ser) {
      var d = seriesD(ser.key);
      if (d) svg.append(svgNode("path", { class: ser.cls, d: d }));
    });

    spec.series.forEach(function (ser) {
      var i = lastIdx(ser.key);
      if (i < 0) return;
      var t = svgNode("text", {
        class: "mk-tide-lab", x: (x(i) + 4).toFixed(1),
        y: (y(isNum(points[i][ser.key])) + 3).toFixed(1),
      });
      t.textContent = ser.label;
      svg.append(t);
    });

    [hi, 0, lo].filter(function (v, i, arr) { return arr.indexOf(v) === i; })
      .forEach(function (v) {
        var t = svgNode("text", {
          class: "mk-tide-lab", x: padL - 6, y: (y(v) + 3).toFixed(1),
          "text-anchor": "end",
        });
        t.textContent = spec.yFormat(v);
        svg.append(t);
      });

    var step = Math.max(1, Math.round((n - 1) / 3) || 1);
    var ticks = [];
    for (var i = 0; i < n; i += step) ticks.push(i);
    if (ticks[ticks.length - 1] !== n - 1) {

      if (ticks.length > 1 && x(n - 1) - x(ticks[ticks.length - 1]) < 40) ticks.pop();
      ticks.push(n - 1);
    }
    ticks.forEach(function (idx, j) {
      var t = svgNode("text", {
        class: "mk-tide-lab", x: x(idx).toFixed(1), y: H - 6,
        "text-anchor": j === 0 ? "start" : (j === ticks.length - 1 ? "end" : "middle"),
      });
      t.textContent = spec.xLabel(points[idx]);
      svg.append(t);
    });

    host.append(svg);
  }

  function drawCharts() {
    if (tideChart) {
      drawLines({
        host: tideChart.host, points: tideChart.points,
        series: [
          { key: "callPrem", cls: "mk-tide-call", label: "calls" },
          { key: "putPrem", cls: "mk-tide-put", label: "puts" },
        ],
        xLabel: function (p) { return hhmm(p.t); },
        yFormat: usd,
        aria: "Net call premium and net put premium per bucket across " +
          "the session, two lines either side of a zero rule.",
      });
    }
    if (totalsChart) {
      drawLines({
        host: totalsChart.host, points: totalsChart.points, height: 130,
        series: [
          { key: "callPrem", cls: "mk-tide-call", label: "calls" },
          { key: "putPrem", cls: "mk-tide-put", label: "puts" },
        ],

        xLabel: function (p) {
          var d = (p && typeof p.date === "string") ? p.date : "";
          return d.length >= 8 ? d.slice(5) : DASH;
        },
        yFormat: usd,
        aria: "Total call premium and total put premium per session across the " +
          "sessions this feed returned, oldest at the left.",
      });
    }
  }

  function rankOf(rows, valueOf) {
    var measured = [];
    rows.forEach(function (r) {
      var v = valueOf(r);
      if (v !== null) measured.push(v);
    });
    if (!measured.length) return null;
    var newest = valueOf(rows[0]);
    if (newest === null) return null;
    var above = 0, level = 0;
    measured.forEach(function (v) {
      if (v > newest) above++;
      else if (v === newest) level++;
    });

    return { rank: above + 1, of: measured.length, value: newest, tied: level > 1 };
  }

  function putShare(r) {
    var c = isNum(r && r.callPrem), q = isNum(r && r.putPrem);
    if (c === null || q === null) return null;
    var total = c + q;
    return total > 0 ? q / total : null;
  }
  function twoSidedTotal(r) {
    var c = isNum(r && r.callPrem), q = isNum(r && r.putPrem);
    return (c === null || q === null) ? null : c + q;
  }

  function ordinal(n) {
    var mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return n + "th";
    var last = n % 10;
    return n + (last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th");
  }

  function totalsCard(feed, note) {
    var card = pulseCard("Volume and premium per session");
    var rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (feed && feed.status === "ok" && rows.length) {

      var chart = el("div", "mk-tide");
      card.append(chart);
      totalsChart = { points: rows.slice().reverse(), host: chart };

      var share = rankOf(rows, putShare);
      var size = rankOf(rows, twoSidedTotal);
      var newest = rows[0] || {};
      var said = [];

      var unrankable = function (r) {
        return r.of < rows.length
          ? " (" + rows.length + " sessions were returned; " + (rows.length - r.of) +
            " quoted only one leg and cannot be ranked)"
          : "";
      };

      var extreme = function (r, top, bottom) {
        if (r.rank === 1) return r.tied ? " — tied for the " + top + " in the window." : " — the " + top + " session in the window.";
        if (r.rank === r.of) return r.tied ? " — tied for the " + bottom + " in the window." : " — the " + bottom + " session in the window.";
        return ".";
      };
      if (share) {
        said.push("Put premium was " + pct(share.value, 1) + " of the two-sided total on " +
          (newest.date || "the newest session") + ", the " + ordinal(share.rank) +
          " highest of the " + share.of + " session" + (share.of === 1 ? "" : "s") +
          " in this window that quoted both legs" + unrankable(share) +
          extreme(share, "most put-leaning", "most call-leaning"));
      } else {

        said.push("No session in this window quoted both a call and a put premium, so the " +
          "newest session cannot be ranked against the others.");
      }
      if (size) {

        said.push("Total premium of " + usd(size.value) + " was the " + ordinal(size.rank) +
          " largest of the " + size.of + " session" + (size.of === 1 ? "" : "s") +
          " that quoted both legs" + unrankable(size) + ".");
      }

      if (share || size) {

        var span = (share || size).of;
        said.push("A rank over " + span + " session" + (span === 1 ? "" : "s") +
          " is an ordinal claim and nothing more: this window is far too short to support a " +
          "standard deviation, and a sigma computed from it would be a confident number " +
          "where the honest one is a position in a queue.");
      }
      card.append(el("p", "fc-note mk-pulse-rank", said.join(" ")));

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

      if (rows.length > shown.length) {
        card.append(el("p", "fc-note mk-pulse-kept",
          "The table lists the newest " + shown.length + " of the " + rows.length +
          " sessions above; the line shows all " + rows.length + "."));
      }
      var kept = capLine(feed, rows.length, "sessions");
      if (kept) card.append(kept);
    } else {
      totalsChart = null;
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
        { label: "Change", num: true }, { label: "Growth", num: true },
        { label: "Curr OI", num: true }, { label: "Volume", num: true },
      ], "Contracts the vendor ranked by open-interest change, with the change in " +
         "contracts and as a share of the previous snapshot");
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        var th = el("th", null, contractLabel(r));
        th.scope = "row";
        tr.append(th);
        tr.append(el("td", "c-num", signedGrouped(r.diff)));
        tr.append(growthCell(r));
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

      var pos = [], neg = [];
      rows.forEach(function (r) {
        var v = isNum(r.netPrem);
        if (v === null) return;
        if (v > 0) pos.push(r);
        else if (v < 0) neg.push(r);
      });
      var byNet = function (a, b) { return Math.abs(b.netPrem) - Math.abs(a.netPrem); };
      pos.sort(byNet);
      neg.sort(byNet);
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

  function darkpoolCard(feed, note) {
    var card = pulseCard("Dark pool prints", true);
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

  function againstColumn(title, body) {
    var box = el("div", "mk-movers-col");
    box.append(el("h3", "mk-movers-h", title));
    box.append(body);
    return box;
  }

  function againstRows(rows) {
    var ul = el("ul", "mk-movers");
    rows.forEach(function (r) {
      var li = el("li");

      li.append(el("span", "mk-mv-t",
        r.rank === null ? r.t + " (board rank not published)" : r.t + " #" + r.rank));
      li.append(el("span", "mk-mv-v " + toneClass(r.netPrem), usd(r.netPrem)));
      ul.append(li);
    });
    return ul;
  }

  function crossBoard(boardRows, moverRows) {
    var out = [];
    var byTicker = {};
    (Array.isArray(moverRows) ? moverRows : []).forEach(function (mv) {
      if (mv && mv.t) byTicker[mv.t] = mv;
    });
    boardRows.forEach(function (r) {
      if (!r || !r.t || !Object.prototype.hasOwnProperty.call(byTicker, r.t)) return;
      out.push({
        t: r.t,
        rank: isNum(r.r),
        netPrem: isNum(byTicker[r.t].netPrem),
      });
    });

    out.sort(function (a, b) {
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank;
    });
    return out;
  }

  function paintAgainst(boards, movers) {
    var host = document.getElementById("mktAgainst");
    var panel = document.getElementById("mktAgainstPanel");
    var note = document.getElementById("mktAgainstNote");
    var againstLead = document.getElementById("mktAgainstLead");
    var againstQual = document.getElementById("mktAgainstQual");
    if (!host || !panel) return;
    host.textContent = "";

    if (note) note.textContent = "";
    if (againstLead) againstLead.textContent = "";
    if (againstQual) againstQual.textContent = "";

    var boardLong = boards[0], boardShort = boards[1];

    if (unreadable(boardLong) || unreadable(boardShort)) {
      host.append(unreadableLine(unreadable(boardLong) ? boardLong : boardShort,
        "the boards this panel is joined against (/api/flows/board)"));
      panel.hidden = false;
      return;
    }
    if (unreadable(movers)) {
      host.append(unreadableLine(movers,
        "the session's premium extremes (/api/flows/movers)"));
      panel.hidden = false;
      return;
    }
    var boardsPending = !boardLong || boardLong.status === "pending" ||
      !boardShort || boardShort.status === "pending";
    if (boardsPending || !movers || movers.status === "pending") {
      host.append(pendingLine("both halves of this join",
        "It reads the two published boards against the session's premium extremes and " +
        "needs both; it fills on the first run that writes them."));
      panel.hidden = false;
      return;
    }

    var prem = movers.premium || {};

    var sides = [
      {
        title: "Long board, in the largest net PUT premium",
        board: boardLong, side: "long", list: prem.bearish,
        ranking: "the session's largest net put premium",
        empty: "No long-board name appears in the session's largest net put premium.",
      },
      {
        title: "Short board, in the largest net CALL premium",
        board: boardShort, side: "short", list: prem.bullish,
        ranking: "the session's largest net call premium",
        empty: "No short-board name appears in the session's largest net call premium.",
      },
    ];

    if (!sides.some(function (side) { return Array.isArray(side.list); })) {
      host.append(emptyLine("unavailable",
        "This movers payload published neither premium extreme, so there is nothing for " +
        "the boards to be joined against. The absence is in the payload, not in the overlap."));
      panel.hidden = false;
      return;
    }

    var grid = el("div", "mk-movers-grid");
    var hits = 0, population = 0, joined = [], skipped = [];
    sides.forEach(function (side) {
      var boardRows = (side.board && Array.isArray(side.board.rows)) ? side.board.rows : [];
      if (!Array.isArray(side.list)) {
        skipped.push("the " + side.side + " board (" + boardRows.length + " name" +
          (boardRows.length === 1 ? "" : "s") + ") could not be joined, because this " +
          "payload published no ranking of " + side.ranking);
        grid.append(againstColumn(side.title, emptyLine("unavailable",
          "This movers payload published no ranking of " + side.ranking + ", so the " +
          side.side + " board could not be read against it. Nothing here says the overlap " +
          "is empty — it says the overlap was never taken.")));
        return;
      }
      if (!boardRows.length) {

        grid.append(againstColumn(side.title, emptyLine("quiet",
          "The " + side.side + " board ranked no name this session, so there is nothing on " +
          "this side to read against the tape. That is a fact about the board rather than " +
          "about the overlap.")));
        return;
      }
      var found = crossBoard(boardRows, side.list);
      hits += found.length;
      population += boardRows.length;
      joined.push(boardRows.length + " " + side.side);
      grid.append(againstColumn(side.title,
        found.length ? againstRows(found) : emptyLine("quiet", side.empty)));
    });
    host.append(grid);

    if (againstLead) {
      againstLead.textContent = !population

        ? "No board name was joined against the tape this session, so there is no " +
          "population to state a count against."
        : hits + " of " + population + " published board names (" +
          joined.join(", ") + ") appear in the opposite premium extreme this session.";
    }
    if (againstQual) {
      var caveats = [];
      if (skipped.length) caveats.push(skipped.join("; ") + ".");
      caveats.push("Both mover lists are CAPPED extremes rather than the universe, so a name " +
        "absent from them has not been shown to agree with the tape: it has only been " +
        "shown not to be one of the session's loudest disagreements.");
      againstQual.textContent = caveats.join(" ");
    }
    if (note) {
      note.textContent = "The board score is a residual — sector and size are divided out " +
        "before the ranking — while these premium lists are the raw level, so the two are " +
        "allowed to disagree; a name where they do is one to read twice, not a signal to fade.";
    }
    panel.hidden = false;
  }

  function mountAgainst() {
    if (document.getElementById("mktAgainstPanel")) return;
    var foot = document.getElementById("mktFoot");
    if (!foot || !foot.parentNode) return;
    var section = el("section", "fc-panel");
    section.id = "mktAgainstPanel";
    section.hidden = true;
    section.append(el("h2", "fc-panel-h", "Against the tape"));

    var readingP = el("p", "fc-reading is-lead");
    readingP.id = "mktAgainstLead";
    section.append(readingP);
    var body = el("div");
    body.id = "mktAgainst";
    section.append(body);
    var qualP = el("p", "fc-note is-qualifier");
    qualP.id = "mktAgainstQual";
    section.append(qualP);
    var p = el("p", "fc-note");
    p.id = "mktAgainstNote";
    section.append(p);
    foot.parentNode.insertBefore(section, foot);
  }

  var chartResizeTimer = 0;
  window.addEventListener("resize", function () {
    if (!tideChart && !totalsChart) return;
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(drawCharts, 150);
  });

  var marketUpdatedAt = null;

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 401) { location.replace("/flows/"); return null; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (path === "/api/flows/market") {

          var stamp = r.headers.get("X-Payload-Updated");
          var ms = (stamp === null || stamp === "") ? null : Number(stamp);
          marketUpdatedAt = (ms !== null && isFinite(ms) && ms > 0) ? ms : null;
        }
        return r.json();
      });
  }

  var status = document.getElementById("mktStatus");

  function marketSilence(line) {
    [["mktTiltPanel", "mktTilt"], ["mktBreadthPanel", "mktBreadth"]].forEach(function (ids) {
      var panel = document.getElementById(ids[0]), host = document.getElementById(ids[1]);
      if (!panel || !host) return;
      host.textContent = "";
      host.append(line.cloneNode(true));
      panel.hidden = false;
    });
    var panel = document.getElementById("mktTapePanel");
    var body = document.getElementById("mktTapeBody");
    if (!panel || !body) return;
    body.textContent = "";
    var tr = document.createElement("tr"), td = document.createElement("td");
    td.colSpan = 3;
    td.append(line.cloneNode(true));
    tr.append(td);
    body.append(tr);
    panel.hidden = false;
  }

  Promise.all([
    optional("/api/flows/market"),
    optional("/api/flows/sectors"),
    optional("/api/flows/movers"),
    optional("/api/flows/pulse"),
    optional("/api/flows/board?side=long"),
    optional("/api/flows/board?side=short"),
  ]).then(function (all) {
    var m = all[0], sectors = all[1], movers = all[2];
    if (!m) return;

    if (typeof m === "object") m.__updatedAt = marketUpdatedAt;

    var n = unreadable(m) ? null : isNum(m.n);
    var level = unreadable(m) ? "unreadable"
      : (m.status === "pending" || n === null) ? "pending" : "ok";

    if (level !== "ok") {
      marketSilence(level === "unreadable"
        ? unreadableLine(m, "the market level (/api/flows/market)")
        : pendingLine("the market level",
          "It is built from the same screener response the board is drawn from, so it " +
          "appears with the first pipeline run after it shipped."));
      if (status) {

        status.textContent = level === "unreadable"
          ? "The market level did not come back: " + m.__reason + "."
          : "No session has been measured yet.";
        status.setAttribute("data-empty", level);
      }
    } else {
      if (status) status.removeAttribute("data-empty");
      setStale(assessAge(m));
      paintTilt(m);
      paintBreadth(m);
      paintTape(m);

      if (status) {

        var screened = isNum(m.screened);
        dated(status, n + " screened names" +
          (screened === null ? "" : " of " + screened + " returned by the ladder") +
          " · session " + (m.sessionDate || "unknown") +
          (isFinite(Date.parse(m.generatedAt))
            ? " · built " + utcStamp(new Date(m.generatedAt), true) : ""));
      }

      var foot = document.getElementById("mktFoot");
      var notes = m.notes || {};
      if (foot) {

        foot.textContent = [notes.population, notes.presence, notes.weighting, notes.refused]
          .filter(Boolean).join(" ");
      }
    }

    paintSectors(sectors);
    paintMovers(movers);
    mountAgainst();
    paintAgainst([all[4], all[5]], movers);
    paintPulse(all[3]);
  }).catch(function (error) {

    if (status) {
      status.textContent = "This page failed while drawing: " + error.message;
      status.setAttribute("data-empty", "unreadable");
    }
  });
})();
