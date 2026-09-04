/* THE MARKET LEVEL.
 *
 * Renders /api/flows/market, plus the two payloads this section has been
 * publishing and never drawing: `movers` (free — the screener already returns
 * the whole universe) and `sector:trix` (eleven candle calls a run, dark since
 * the day it shipped).
 *
 * AND THE JOIN THE PRODUCT DID NOT HAVE. The board score is a residual with
 * sector and size divided out; this page is the level that removal threw away.
 * The two never met until "Against the tape" below read the published boards
 * against the session's premium extremes — no vendor call, no new key, and the
 * only place on the site where a ranked name and the tape it trades into can
 * be seen to disagree.
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
  /* ZERO PRINTS UNSIGNED, BECAUSE IT IS A MEASUREMENT AND NOT A LEAN.

     Every signed formatter in this file used to test `n >= 0 ? "+" : MINUS`,
     which stamps a plus on a reading that came back exactly level. "The
     dollars were balanced" and "the dollars leaned a hair positive" then
     rendered identically — the same family of defect as Number(null) === 0,
     one step further down the pipe: a real measured zero dressed as a
     positive. flows-ui.js states the rule and the board, the events page and
     the watch list all obey it; this file now does too, in all three of its
     signed formatters and in the bar classes they sit beside. */
  function signGlyph(n) {
    return n < 0 ? MINUS : (n > 0 ? "+" : "");
  }
  /* The same three-way applied to a tone class: a zero-width bar carrying
     `is-pos` is a lie in the DOM even when nothing paints. */
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
  /* A POPULATION COUNT, or the em dash. A count is the one place a zero and
     an absence look most alike in prose, and this page publishes several. */
  function count(v) {
    var n = isNum(v);
    return n === null ? DASH : String(n);
  }

  /* ---------- the silences, told apart in the DOM as well as in prose ----

     THREE SILENCES, THREE SENTENCES, THREE data-empty TAGS. The tags are what
     make the distinction machine-checkable; the sentences are what make it
     useful to a reader. "unavailable" is a failure of the page or the
     pipeline to produce a reading; "quiet" is a reading that was taken and
     came back empty, which is a fact about the market. */
  function emptyLine(kind, text) {
    var p = el("p", "flows-empty", text);
    p.setAttribute("data-empty", kind);
    return p;
  }

  /* A REQUEST THAT NEVER CAME BACK IS NOT A KEY THAT WAS NEVER PUBLISHED.

     The three optional feeds below were fetched with `.catch(() => null)`,
     and null is exactly what the worker's {status:"pending"} envelope reduces
     to at the first branch of every painter. So an HTTP 500, a dropped
     connection or a JSON parse failure printed "The pipeline has not
     published this key yet" — a confident claim about the pipeline
     manufactured by a request that never arrived. Movers and pulse were
     worse: they set `panel.hidden = true`, so a failed fetch deleted a whole
     section of the page and left no sentence at all behind it. A panel that
     vanishes for a reason the reader cannot see is the one silence this file
     had no vocabulary for.

     The sentinel keeps the fetch outcome distinguishable from the payload
     state all the way to the painter. Its fields are prefixed so the
     payload-shape scan cannot mistake them for publisher fields, and no
     painter reads them off the payload variable directly — `unreadable()`
     and `unreadableLine()` do, one function removed. */
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
    return emptyLine("unavailable",
      "The request for " + what + " did not come back" +
      (feed && feed.__reason ? " (" + feed.__reason + ")" : "") +
      ". That is this page failing to READ the payload, not a statement about " +
      "what the payload holds — reload before drawing any conclusion from the " +
      "panels that did load.");
  }
  function pendingLine(what, cost) {
    return emptyLine("unavailable",
      "The pipeline has not published " + what + " yet. " + cost);
  }

  /* Plain-English age, for a stamp that has to say how far out of date it is
     without making the reader subtract two timestamps. */
  function ageWords(minutes) {
    var m = Math.max(0, Math.round(minutes));
    if (m < 90) return m + (m === 1 ? " minute" : " minutes");
    var h = Math.round(m / 60);
    if (h < 36) return h + (h === 1 ? " hour" : " hours");
    var d = Math.round(h / 24);
    return d + (d === 1 ? " day" : " days");
  }

  /* ---------- freshness, which this page claimed and never tested --------

     shared/flows-pages.js has emitted `<p class="flows-stale" id="mktStale">`
     since the page shipped and NOTHING wrote to it: the element was in the
     markup, the CSS rule was in the stylesheet, and the banner could not fire
     on any input. A page whose whole subject is one session's tape is exactly
     the page where a reader cannot tell yesterday's copy from today's, and it
     was the only Flows surface with the element but not the test.

     THE TEST IS NOT THIS FILE'S TO WRITE. assets/js/flows-ui.js `staleness()`
     owns it. It was lifted out of flows-board.js precisely because six routes
     had grown six copies of the same two constants and SIX DIFFERENT
     SENTENCES for the same two outages, and two routes wording one outage
     differently is how a reader concludes there are two outages. The first
     version of this block was a seventh copy, and it had already drifted in
     the retelling — "These readings describe the … session" against the
     shared "These numbers describe the … session" — which is that whole
     failure in miniature, committed in the same change that fixed the banner.

     shared/flows-pages.js:861 serves this route nav.js and this file and no
     UI module, so `window.FlowsUI` does not exist here and the shared
     function cannot be called. What follows is therefore a MIRROR, not a
     second opinion: the same two constants, the same two branches, the same
     two sentences to the word, and the same four-way {kind, message}
     contract — including the "unknown" that a bare null cannot express,
     because "nothing datable arrived" and "it was checked and it is fresh"
     are not the same answer. The wording lives in flows-ui.js:185 and must be
     changed there first. When marketPage() is served flows-ui.js this whole
     block is deleted and replaced by one call to it.

     TWO FAILURES, TWO REMEDIES, which is why there are two branches rather
     than one age check. A dead pipeline has an old WRITE time — GitHub
     disables scheduled workflows after 60 days of repository inactivity and
     the only symptom is a date that stops advancing. A frozen upstream has a
     recent write time and an old SESSION. */
  var staleEl = document.getElementById("mktStale");

  // Mirrored from assets/js/flows-ui.js:143-145. One publish cadence plus
  // slack; one weekend plus one public holiday. Weekends fall to the session
  // check: the pipeline does not run at all on a Saturday.
  var STALE_WRITE_MS = 30 * 60 * 60 * 1000;
  var STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;

  function assessAge(payload) {
    var now = Date.now();
    if (!payload || typeof payload !== "object") return { kind: "unknown", message: null };

    /* THE MISSING-VALUE TEST BEFORE THE COERCION, and it matters more here
       than almost anywhere: Number(null) is 0, 0 is a finite millisecond
       stamp — the epoch — and a payload with no write header would be
       reported as fifty-six years stale. A non-positive stamp is absent for
       the same reason. */
    var written = isNum(payload.__updatedAt);
    if (written !== null && written > 0 && now - written > STALE_WRITE_MS) {
      var hours = Math.floor((now - written) / 3600000);
      var days = Math.floor(hours / 24);
      /* The hour branch cannot fire while the threshold is 30 hours — every
         age past it is at least one day. It is here so that lowering the
         threshold can never start printing "0 days", which is a confident
         zero wearing a unit. */
      var age = days >= 1
        ? days + (days === 1 ? " day" : " days")
        : hours + (hours === 1 ? " hour" : " hours");
      return {
        kind: "write",
        message: "This market level was last written " + age +
          " ago. The pipeline has not published since — check the Actions tab.",
      };
    }

    if (payload.sessionDate) {
      /* 21:00Z is after every US close, so a session date is aged from the
         end of its own session rather than from its midnight. */
      var session = Date.parse(String(payload.sessionDate) + "T21:00:00Z");
      if (isFinite(session) && now - session > STALE_SESSION_MS) {
        return {
          kind: "session",
          message: "These numbers describe the " + payload.sessionDate + " session, " +
            "which is more than four days old. The pipeline is running but its " +
            "data is not advancing.",
        };
      }
    }
    if (written === null && !payload.sessionDate) return { kind: "unknown", message: null };
    return { kind: "fresh", message: null };
  }

  /* THE KIND IS STAMPED AS WELL AS THE SENTENCE — flows-board.js's shape.
     "The pipeline stopped" and "the data stopped" want different chrome, and
     a test should not have to parse prose to tell which one is on screen. */
  function setStale(verdict) {
    if (!staleEl) return;
    var message = (verdict && verdict.message) || "";
    staleEl.hidden = !message;
    staleEl.textContent = message;
    if (message) staleEl.setAttribute("data-stale", (verdict && verdict.kind) || "stale");
    else staleEl.removeAttribute("data-stale");
    document.body.classList.toggle("is-stale", Boolean(message));
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
      var bar = el("i", "mk-bar " + barClass(n));
      // Half-width axis each side of the centre rule. A measured zero draws a
      // zero-width bar AT the rule and is classed neither way — the centre
      // rule is the mark for "level", and tinting it positive was the same
      // confident-zero defect the sign glyphs above just lost.
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

    /* NEVER A CONFIDENT ZERO IN A POPULATION. This line read
       `isNum(breadth.bull) || 0`, which is Number(null) === 0 wearing newer
       syntax: a count the payload never published printed as "0 bought", and
       a session in which nothing was bought became indistinguishable from a
       field that was never written. The em dash is this file's mark for "not
       measured" and it belongs in a count as much as in a price. */
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
      } else if (b === 0 || p === 0) {
        /* A MEASURED ZERO IS A THIRD ANSWER, not a quiet member of the
           majority. The disagreement test guarded itself with `b !== 0 &&
           p !== 0` — correctly, because a zero has no sign to disagree with —
           and then fell through to "Both weightings agree in sign", which is
           a confident claim about a reading that has no sign at all. A
           session where the dollars came back exactly level while the names
           leaned is neither agreement nor disagreement, and it is the third
           sentence rather than the wrong one of two. */
        note.textContent = (b === 0 && p === 0
          ? "Both weightings came back exactly level: the names split evenly and so did the " +
            "dollars. There is no lean to agree or disagree about."
          : (b === 0 ? "Counting names, the session was exactly level" +
              " while the dollars leaned " + (p > 0 ? "positive" : "negative") + "."
            : "The dollars were exactly level while more names leaned " +
              (b > 0 ? "positive" : "negative") + ".") +
            " One weighting has a sign and the other does not, so they neither agree nor " +
            "disagree — which is itself a reading, and the reason both are drawn.");
      } else if ((b > 0) !== (p > 0)) {
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
    var bull = isNum(b.bull), bear = isNum(b.bear), flat = isNum(b.flat);

    /* A PART-TO-WHOLE BAR NEEDS THE WHOLE, AND THE WHOLE HAS TO HAVE BEEN
       MEASURED. Each of the three counts used to be coerced with
       `isNum(x) || 0`, so a count the payload never wrote became a segment of
       width zero AND a contribution of zero to the denominator — the two
       parts that did arrive were then drawn as 100% of a total this session
       never measured, and the aria-label read "0 names net bought" out loud.
       If any leg is missing there is no whole, and the honest drawing is
       none. The tilt above is unaffected: it is published as a ratio rather
       than rebuilt from these three counts. */
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
      /* MEASURED AND EMPTY IS THE OTHER SILENCE. All three counts arrived and
         all three are zero, so no screened name quoted both legs — a fact
         about the session, and not the same fact as a missing count. */
      host.append(emptyLine("quiet",
        "No screened name quoted both a call and a put leg this session, so there is no " +
        "priced population to split. The three counts were published and all three are zero."));
    } else {
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
      if (isNum(b.unpriced) !== null) {
        parts.push(b.unpriced + " of " + count(m.n) + " screened names quoted no usable " +
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

  /* ---------- sector momentum ---------------------------------------

     THE READING IS `trixBp`. `trix` IS ITS PRESENTATION, AND DRAWING THE
     PRESENTATION AS IF IT WERE SIGNED WAS THIS PANEL'S SECOND FATAL BUG.

     scripts/flows-pipeline.mjs publishes, on every sector row, the raw
     oscillator in basis points (`trixBp`) and a 0..100 clamp score derived
     from it by the relation the payload itself states:

         trix = 50 + 50 * clamp(trixBp / fullScaleBp, -1, +1)

     50 is no momentum. 0 and 100 are the rails. Nothing in that quantity is
     ever negative — and this function branched on `r.trix >= 0` to place the
     bar and to choose the tone. The test was therefore TRUE FOR EVERY SECTOR
     THAT HAS EVER BEEN PUBLISHED: every bar started at the centre rule and
     grew right, XLF at −23.65 bp printed "+26.4" in the positive tone, and a
     perfectly neutral sector drew a half-width positive bar. The caption said
     "TRIX in basis points", which is precisely the one thing the drawn number
     was not. Rank order survived, because the relation is monotone; the SIGN
     did not, and in this codebase the sign lives in position.

     The bar, the label and the sort key are now the raw signed reading. The
     axis is the published full-scale band, so it is the SAME axis every
     session: a bar can be read against another sector and against this sector
     last week. The old axis was rescaled to the session's widest reading,
     which is why the note had to carry a "never with another day" caveat —
     that caveat is retired here rather than reworded. */

  /* The raw reading, or null. Never `r.trix`: a clamp score cannot carry a
     sign and cannot be compared with another day's. */
  function sectorBp(r) {
    return isNum(r && r.trixBp);
  }

  function paintSectors(sectors) {
    var host = document.getElementById("mktSectors");
    var panel = document.getElementById("mktSectorPanel");
    var note = document.getElementById("mktSectorNote");
    if (!host || !panel) return;
    host.textContent = "";
    if (note) note.textContent = "";

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

    /* FOUR DIFFERENT SILENCES, AND THEY MAY NOT SHARE A SENTENCE.

       Before, every one of these printed "No sector carried enough history",
       which is a claim ABOUT THE DATA — a measured emptiness. Three of the
       four are nothing of the kind: one is a request that failed, one is an
       unpublished key and one is a payload this page could not read. Saying
       the strongest of the four in all four cases is exactly the confident
       zero this project refuses everywhere else, and it is what made a
       working measurement look like a dead one. */
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
    /* A ROW WITH A SCORE BUT NO RAW READING is a payload regression, not a
       sector. The publisher writes `trix` and `trixBp` together or writes
       both null, so this count should always be zero — it is reported rather
       than swallowed because a silently shrinking panel is how the last two
       defects on this surface stayed invisible for weeks. */
    var scoreOnly = entries.filter(function (r) {
      return sectorBp(r) === null && isNum(r && r.trix) !== null;
    }).length;

    if (!measured.length) {
      /* NOW the sentence is earned: readings were published and none settled,
         and the payload says per sector why. This is the one branch of the
         four that is a statement about the market. */
      var why = entries.filter(function (r) { return r && r.reason; })
        .map(function (r) { return r.reason; })[0];
      host.append(emptyLine("quiet",
        "No sector carried enough history to settle a TRIX reading this session." +
        (why ? " " + why : "")));
      panel.hidden = false;
      return;
    }

    /* THE AXIS IS PUBLISHED, NOT INVENTED HERE. `scaling.fullScaleBp` is the
       band the publisher declares as its free parameter, and reading it means
       the drawing and the payload cannot disagree about what a full bar is.
       If a payload ever arrives without it the panel falls back to the
       session's own widest reading and SAYS so in the caption, because a
       session-scaled axis genuinely cannot be set beside another day's. */
    var scaling = (sectors && sectors.scaling) || {};
    var published = isNum(scaling.fullScaleBp);
    var fixedAxis = published !== null && published > 0;
    var axis = fixedAxis
      ? published
      : (measured.reduce(function (a, r) { return Math.max(a, Math.abs(sectorBp(r))); }, 0) || 1);

    // Sorted on the raw reading. Sorting on `trix` ties every saturated
    // sector at 100 and then orders them arbitrarily.
    measured.sort(function (a, b) { return sectorBp(b) - sectorBp(a); });

    var railed = 0;
    var list = el("ul", "mk-sectors");
    measured.forEach(function (r) {
      var bp = sectorBp(r);
      var frac = Math.min(Math.abs(bp) / axis, 1);
      if (frac >= 1 && Math.abs(bp) > axis) railed++;
      var name = r.sector || r.etf || DASH;

      var li = el("li", "mk-sector");
      li.append(el("span", "mk-sector-k", name));

      var track = el("span", "mk-track mk-track-sm");
      track.setAttribute("role", "img");
      /* The whole reading in one string for a screen reader, because the bar
         carries the sign in a position a reader who cannot see it loses. */
      track.setAttribute("aria-label",
        name + " " + signed(bp, 2) + " basis points per session, " +
        (bp < 0 ? "left of" : bp > 0 ? "right of" : "at") + " the zero rule.");
      track.append(el("i", "mk-zero"));
      var bar = el("i", "mk-bar " + barClass(bp));
      bar.style.width = (frac * 50) + "%";
      bar.style.left = bp >= 0 ? "50%" : (50 - frac * 50) + "%";
      bar.title = signed(bp, 2) + " bp";
      track.append(bar);
      li.append(track);

      /* UNITS TRAVEL WITH THE NUMBER. "+26.4" was a bare figure on an axis
         the caption misnamed; "−23.65 bp" is a reading. */
      li.append(el("span", "mk-sector-v " + toneClass(bp), signed(bp, 2) + " bp"));
      list.append(li);
    });
    host.append(list);

    var unmeasured = entries.length - measured.length - scoreOnly;
    if (note) {
      var parts = [
        "TRIX in basis points per session: a triple-smoothed momentum reading on each " +
        "sector ETF's own log closes, so it describes the sector's trend rather than its " +
        "level.",
        "Sign is carried by POSITION — left of the centre rule is negative — and by the " +
        "glyph on the number, so the panel survives greyscale and a monochrome printout.",
      ];
      if (fixedAxis) {
        parts.push("The axis is the payload's own published band, " + MINUS + axis + " to +" +
          axis + " bp, which is the same band every session: a bar can be read against " +
          "another sector and against this sector last week.");
        if (railed) {
          parts.push(railed + " sector" + (railed === 1 ? " sits" : "s sit") +
            " beyond that band and " + (railed === 1 ? "is" : "are") +
            " drawn at full width; the number beside " + (railed === 1 ? "it" : "them") +
            " is the true reading, not the rail.");
        }
      } else {
        parts.push("This payload published no full-scale band, so the axis is scaled to the " +
          "widest reading of this session only — it compares sectors with each other and " +
          "never with another day.");
      }
      if (sectors.basis) parts.push("Basis: " + sectors.basis + ".");
      if (unmeasured > 0) {
        parts.push(unmeasured + " sector" + (unmeasured === 1 ? "" : "s") +
          " had too little history to settle and " + (unmeasured === 1 ? "is" : "are") +
          " omitted rather than drawn at zero.");
      }
      if (scoreOnly > 0) {
        parts.push(scoreOnly + " sector" + (scoreOnly === 1 ? "" : "s") +
          " published a clamp score with no raw reading beside it and cannot be drawn " +
          "signed; that is a payload defect rather than a quiet sector.");
      }
      note.textContent = parts.join(" ");
    }
    panel.hidden = false;
  }

  /* THE COLUMN'S OWN TWO SILENCES. "Nothing ranked." was one untagged
     sentence for both of them: a ranking the payload never published and a
     ranking that was taken and came back empty read identically, in the one
     panel where the difference decides whether the session was quiet or the
     feed was. Every other empty on this page carries a data-empty; this one
     did not, so it was also the one silence a test could not see. */
  function moverList(title, rows, key) {
    var box = el("div", "mk-movers-col");
    box.append(el("h3", "mk-movers-h", title));
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
    /* THE PANEL IS NEVER HIDDEN FOR A REASON THE READER CANNOT SEE.

       Both branches below used to be one `panel.hidden = true`, so a failed
       request and an unpublished key both deleted the section outright. A
       reader then saw a page with no extremes on it and no way to learn
       whether that meant the feed was down, the pipeline had not run, or the
       session genuinely had no movers — three different facts collapsed into
       an absence. */
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
    /* MEASURED AND EMPTY IS THE THIRD SILENCE and it gets the third tag. Four
       empty rankings out of a payload that published successfully is a fact
       about the session, not about the plumbing. */
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
     answers its own three silences: an UNAVAILABLE feed names its
     reason, and a QUIET feed says the vendor answered with nothing —
     which for a pre-open read is ordinary, not an outage. The KEY's own
     two silences are answered by the section, immediately below.

     The section used to hide itself for both of them. Seven feeds and a
     chart disappeared without a sentence, and a reader could not tell a
     500 on /api/flows/pulse from a pipeline that had never written the
     key. Neither one is "the market was quiet". */

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
      /* The chart handle is cleared with the panel it lived in, or a resize
         would repaint a tide from a payload this page no longer holds. */
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
    /* THE CADENCE COMES OFF THE PAYLOAD, read here with the rest of the
       root fields so the payload-shape scan can see the claim being made.
       Handed on raw: pulseStamp owns what counts as a usable cadence and
       what it says when there is none. */
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

    /* REVEALED BEFORE THE TIDE IS MEASURED. A hidden element reports
       clientWidth 0 and the chart would silently draw at a fallback
       width — the flows-track precedent, unhide first, then measure. */
    panel.hidden = false;
    drawCharts();
  }

  /* Sub-panel helpers take the FEED objects under their own names, so the
     payload-shape scan sees only real payload reads inside paintPulse. */

  var PULSE_QUIET = "The feed answered this read with nothing — ordinary " +
    "for a pre-open read of a series that fills during market hours.";
  var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /**
   * When the pulse was read, and whether that claim is still worth making.
   *
   * THIS STAMP USED TO LIE TWICE. It printed a bare HH:MM with no date, so a
   * pulse written at 15:45 yesterday read on today's page as "Read 15:45"; and
   * it appended "(refreshes about every 15 minutes during market hours)"
   * unconditionally, so the same yesterday's copy also announced itself as a
   * live feed fifteen minutes old. A freshness stamp that cannot go stale is
   * worse than no stamp: it converts an absence of information into a
   * confident assurance.
   *
   * THE CADENCE IS THE PAYLOAD'S NOW, NOT THIS FILE'S. It used to be a local
   * `var REFRESH_CADENCE_MINUTES = 15` mirroring shared/flows-freshness.js
   * under a comment admitting the mirror was the only link between the two,
   * because shared/ is not served to the browser. shared/flows-pulse.js
   * publishes `cadenceMinutes` on the pulse for exactly this reader, so the
   * copy is gone: raise the Worker's cron to thirty minutes and this stamp
   * follows it instead of going on calling a twenty-five-minute-old read
   * stale, which is how a reader learns to ignore the one line that tells
   * them the data stopped moving.
   *
   * @param {number|null|undefined} cadenceMinutes the published cadence, or
   *   absent on a payload written before the field existed or one that could
   *   not be read. ABSENT IS NOT ZERO. Number(null) would make every read
   *   stale and print "refreshes about every 0 minutes"; a fallback of 15
   *   would print a number nobody published. So a missing cadence withholds
   *   the verdict and says why — the age is still measured, because that
   *   subtraction needs no cadence, and only the judgement of it does.
   */
  function pulseStamp(readAt, refreshed, cadenceMinutes) {
    if (typeof readAt !== "string") return "";
    var t = new Date(readAt);
    if (isNaN(t.getTime())) return "";
    var now = new Date();
    var hm = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    /* Today in the VIEWER's zone, which is the zone the clock beside it is
       already rendered in. */
    var sameDay = t.getFullYear() === now.getFullYear() &&
      t.getMonth() === now.getMonth() && t.getDate() === now.getDate();
    var when = sameDay ? hm : t.toLocaleDateString() + " " + hm;
    var ageMin = (now.getTime() - t.getTime()) / 60000;
    var build = refreshed === "nightly" ? " with the nightly build" : "";

    /* ABSENCE TESTED BEFORE THE ARITHMETIC, and a non-positive cadence is an
       absent one: a refresh every zero minutes is not a schedule, and a
       negative one is a corrupt field, not a fast cron. */
    var minutes = isNum(cadenceMinutes);
    var cadence = (minutes !== null && minutes > 0) ? minutes : null;
    if (cadence === null) {
      /* The AGE is a subtraction of two stamps and needs no cadence, so it is
         still reported; only the JUDGEMENT of it is withheld. Under a minute
         it is left off rather than rounded to "0 minutes ago", which reads as
         a measurement of nothing beside a sentence about a missing field. */
      var since = Math.round(ageMin) >= 1 ? ", " + ageWords(ageMin) + " ago" : "";
      return "Read " + when + build + since + ". This payload did not publish the refresh " +
        "cadence, so this page cannot say whether that read is still current.";
    }

    // One cadence plus one cadence of slack: a cron that fired late is not
    // yet a cron that stopped firing.
    var live = ageMin < cadence * 2;
    var stale = ", read " + ageWords(ageMin) + " ago — the intraday refresh is not " +
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

  /* TWO OF THE THREE SILENCES, told apart in words and in the DOM. The third
     — the whole KEY failing to arrive — belongs to the section rather than to
     any one feed, and paintPulse answers it above. Both tags come from
     emptyLine so the per-feed and per-section silences cannot drift into two
     vocabularies for the same distinction. */
  function feedSilence(feed, quietText) {
    if (!feed || feed.status === "unavailable") {
      return emptyLine("unavailable",
        "This feed could not be read on this run" +
        (feed && feed.reason ? ": " + feed.reason : "") +
        ". Its six neighbours are unaffected.");
    }
    return emptyLine("quiet", quietText || PULSE_QUIET);
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
    /* Rounded FIRST, then signed off the rounded value: a change of -0.4
       contracts rounds to 0 and must not print "−0". */
    var r = Math.round(n);
    return signGlyph(r) + Math.abs(r).toLocaleString("en-US");
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
    return signGlyph(n) + Math.abs(n).toFixed(2) + "%";
  }
  function hhmm(iso) {
    return (typeof iso === "string" && iso.length >= 16) ? iso.slice(11, 16) : DASH;
  }

  /* ---------- 1. the tide, and the 20-session totals line ----------

     TWO CHARTS, ONE DRAWING FUNCTION. They differ only in what an x step is
     (a five-minute bucket, a session) and in how a tick is labelled; every
     rule below — one viewBox unit is one CSS pixel, a null is a gap and never
     a zero, hue is the last channel — has to hold identically on both, and
     the way to guarantee that is to have one implementation of it rather than
     two that agree today. */

  var tideChart = null;     // {points, host} once the card is built
  var totalsChart = null;   // the same, for the sessions line

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

  /**
   * A dual line on a measured axis.
   *
   * THE CHART INVARIANT: one viewBox unit is one CSS pixel. The width comes
   * from the host's CURRENT clientWidth — which is why every caller unhides
   * its panel BEFORE drawing, a hidden element reporting clientWidth 0 —
   * an explicit width attribute is emitted, and the whole thing is repainted
   * rather than scaled on resize.
   *
   * spec: { host, points, series:[{key, cls, label}], xLabel(point), yFormat,
   *         aria, height }
   */
  function drawLines(spec) {
    var host = spec.host;
    if (!host) return;
    var points = spec.points;
    host.textContent = "";

    /* THE MEASUREMENT IS FLOORED, NOT ROUNDED, and the drawing is never
       wider than the box it was measured from. `Math.round(clientWidth)`
       rounds a host of 282.81px UP to 283, and the stylesheet's
       `.mk-tide-svg { width: 100% }` then squeezes 283 viewBox units into
       282.81 CSS pixels — one viewBox unit stops being one CSS pixel by a
       fraction of a percent, silently, which is the same failure the
       .cc-strip comment in flows.css warns about in so many words. Flooring
       the real box width and pinning that width INLINE (an inline width
       beats the class rule, and is by construction never wider than the
       host, so it cannot push a 320px viewport sideways) makes the identity
       exact rather than approximate.

       The old lower clamp of 240 was the other half of the problem: on a
       host narrower than 240 it would have made the drawing wider than its
       container. The gutters shrink with the box instead. */
    var box = host.getBoundingClientRect ? host.getBoundingClientRect().width : 0;
    var measured = Math.floor(isNum(box) === null ? 0 : box);
    if (!measured) measured = Math.floor(host.clientWidth) || 0;
    // A host that measures nothing is a hidden host; 320 is the narrowest
    // viewport this product supports and is the honest fallback.
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
    if (lo === hi) hi = 1;   // a flat all-zero read still gets an axis

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
    /* The attribute states the size; the inline style DEFENDS it. See above:
       the stylesheet's width:100% would otherwise override the attribute and
       rescale every unit in the drawing. */
    svg.style.width = W + "px";
    svg.style.height = H + "px";

    // The zero rule, before the lines so they draw over it.
    svg.append(svgNode("line", {
      class: "mk-tide-zero", x1: padL, x2: W - padR,
      y1: y(0).toFixed(1), y2: y(0).toFixed(1),
    }));

    /* One path per series, pen up over null buckets: an absent reading is a
       GAP in the line, never a point at zero — 0 is a real published sum. */
    var seriesD = function (key) {
      var vals = points.map(function (p) { return isNum(p[key]); });
      var d = "", i = 0;
      while (i < n) {
        if (vals[i] === null) { i++; continue; }
        var j = i;
        while (j + 1 < n && vals[j + 1] !== null) j++;
        if (j === i) {
          /* A ONE-SAMPLE RUN. The old shape emitted a lone "M x y" here — a
             path that moves and never draws, so it RENDERS NOTHING. The gap
             rule exists so that a reading nobody took is never invented; it
             must not also make a reading somebody DID take disappear, and a
             bucket whose two neighbours both came back null is exactly the
             case where a measurement was silently dropped. It is drawn as a
             four-unit tick centred on the sample, in the series' own stroke
             and dash pattern, far too short to be misread as a segment
             spanning two buckets. */
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

    /* End-of-line words, so hue is never the only channel separating two
       overlaid series. The stylesheet dashes one of the two strokes for the
       same reason; between them the pair survives greyscale. */
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

    // The y-axis in the units the numbers are read in: at min, 0, max.
    [hi, 0, lo].filter(function (v, i, arr) { return arr.indexOf(v) === i; })
      .forEach(function (v) {
        var t = svgNode("text", {
          class: "mk-tide-lab", x: padL - 6, y: (y(v) + 3).toFixed(1),
          "text-anchor": "end",
        });
        t.textContent = spec.yFormat(v);
        svg.append(t);
      });

    // Three or four x ticks, labelled from the payload's own stamps.
    var step = Math.max(1, Math.round((n - 1) / 3) || 1);
    var ticks = [];
    for (var i = 0; i < n; i += step) ticks.push(i);
    if (ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);
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

  /** Both charts at their hosts' current widths. */
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
        /* "2026-09-03" → "09-03". A session with no date is the em dash:
           `String(DASH).slice(5)` was the empty string, so an undated point
           got a BLANK tick — an absence rendered as nothing at all rather
           than as this file's mark for one. */
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

  /* ---------- 2..7, the tabular cards ------------------------------ */

  /**
   * WHERE THE NEWEST SESSION SITS IN THE SESSIONS BESIDE IT.
   *
   * THE PROBLEM THIS ANSWERS. Nothing else on this page carries any history
   * at all: seven tape levels, two tilts and eleven sector readings, every one
   * of them a single session with no reference distribution anywhere. A page
   * with no distribution cannot call anything unusual, and "unusual" is the
   * product. This feed is the one distribution the page already holds — the
   * vendor returns up to twenty sessions of market-wide call and put totals
   * and the card spent all of it printing ten rows of a table.
   *
   * A RANK, NOT A Z-SCORE. Twenty points is not enough to claim a standard
   * deviation of a premium series that is neither stationary nor symmetric,
   * and a sigma computed off twenty rows would be a confident number where
   * the honest one is ordinal. "The highest of the 20 sessions this feed
   * returned" is a claim the data supports exactly.
   *
   * Rank is taken over the rows that MEASURED the quantity, so the
   * denominator is the comparable population and never the row count.
   */
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
    /* `of` IS THE COMPARABLE POPULATION AND NOT THE ROW COUNT — a session
       that never quoted both legs cannot be ranked against and must not sit
       in the denominator. The caller has to say so in the sentence too: "of
       the 20 sessions this feed returned" over a denominator of 17 is the
       right number under the wrong noun, which is the same defect as a
       number under the wrong unit.

       `tied` because a superlative is a claim about uniqueness. Two sessions
       at the same share both come back rank 1, and calling each of them "the
       most put-leaning session in the window" is a confident statement the
       arithmetic does not support. */
    return { rank: above + 1, of: measured.length, value: newest, tied: level > 1 };
  }

  /* Put premium as a share of the session's own two-sided total. A SHARE is
     the comparable quantity across twenty sessions; the raw sums are not,
     because a quiet week and a busy one differ in level before they differ in
     lean. Null unless BOTH legs were quoted and the total is positive — a
     denominator of zero is not a balanced session. */
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
    var card = pulseCard("Volume and premium per session", true);
    var rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (feed && feed.status === "ok" && rows.length) {
      /* THE WHOLE RETURNED WINDOW, DRAWN. The table below still shows ten
         rows because a table of twenty is a wall; the line shows every
         session the feed returned, which is what makes the rank sentence
         under it checkable by eye. Oldest at the left, so time runs the way
         it does on every other chart in this product — the payload arrives
         newest-first and is reversed here rather than read backwards. */
      var chart = el("div", "mk-tide");
      card.append(chart);
      totalsChart = { points: rows.slice().reverse(), host: chart };

      /* THE READING, IN WORDS, ABOVE THE TABLE. */
      var share = rankOf(rows, putShare);
      var size = rankOf(rows, twoSidedTotal);
      var newest = rows[0] || {};
      var said = [];
      /* THE DENOMINATOR IS THE COMPARABLE POPULATION AND IS NAMED AS SUCH.
         This sentence used to say "of the N sessions this feed returned"
         while N was the count of sessions that could be RANKED; the two are
         the same number only while every session quotes both legs, and the
         moment one does not the reader is handed a smaller number under the
         larger noun. The rows that could not be ranked are counted out loud
         beside it rather than quietly deducted. */
      var unrankable = function (r) {
        return r.of < rows.length
          ? " (" + rows.length + " sessions were returned; " + (rows.length - r.of) +
            " quoted only one leg and cannot be ranked)"
          : "";
      };
      /* A SUPERLATIVE IS A CLAIM ABOUT UNIQUENESS, so a tie does not get one. */
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
        /* NOT A ZERO AND NOT A MIDDLE. A window in which no session quoted
           both legs supports no rank at all, and saying so is the reading. */
        said.push("No session in this window quoted both a call and a put premium, so the " +
          "newest session cannot be ranked against the others.");
      }
      if (size) {
        /* THE COUNT KEEPS ITS NOUN. "the 3rd largest of 20" is a bare figure:
           twenty what, and measured how? */
        said.push("Total premium of " + usd(size.value) + " was the " + ordinal(size.rank) +
          " largest of the " + size.of + " session" + (size.of === 1 ? "" : "s") +
          " that quoted both legs" + unrankable(size));
      }
      /* THE CAVEAT BELONGS TO A RANK THAT WAS ACTUALLY PUBLISHED. It used to
         print unconditionally, so the window in which nothing could be
         ranked still ended on "a rank over 3 sessions is an ordinal claim" —
         a disclaimer for a number the card had just refused to give. */
      if (share || size) {
        // Not named `window`: shadowing the global inside a renderer is how a
        // later edit in this function loses its addEventListener.
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
      /* The TABLE is short of the window, not the window short of the feed:
         two different truncations and the reader is told both. */
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

  /* ---------- against the tape ------------------------------------------

     THE ONE CROSSING POINT THIS PRODUCT DID NOT HAVE.

     The board score is a RESIDUAL: sector and log-capitalisation are divided
     out before the ranking is taken, which is exactly what makes it a
     comparison between names. This page measures the LEVEL the board threw
     away. Until now the two never met. The page could report that the dollars
     were net sold, the long board could rank twenty-five names, and neither
     one knew about the other — so a name the composite ranked third long
     could sit in the session's largest net PUT premium and nothing on the
     site would say so.

     That overlap is the cheapest early warning available here: it costs no
     vendor call, no pipeline change and no new key. It is a CONTRADICTION,
     not a verdict — the residual and the level are different quantities and
     they are allowed to disagree — but a name where they disagree is a name
     worth reading twice before the close.

     WHAT IS DELIBERATELY MISSING. The other half of this panel is "how many
     board names sit in the bottom TRIX quartile", and it cannot be built
     here: the board row carries no sector string, though the screener row it
     was cut from does. That is a publisher change, not a renderer one, and
     inventing a sector on this side would be a fabricated join. */

  /* One column of the join: a heading, and whatever the side has to say. */
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
      /* The board rank rides with the ticker: a contradiction on the name
         ranked first is not the same news as one on the name ranked
         twenty-fifth. A row whose rank the board did not publish says that
         in words — "#—" is a rank-shaped thing that is not a rank. */
      li.append(el("span", "mk-mv-t",
        r.rank === null ? r.t + " (board rank not published)" : r.t + " #" + r.rank));
      li.append(el("span", "mk-mv-v " + toneClass(r.netPrem), usd(r.netPrem)));
      ul.append(li);
    });
    return ul;
  }

  /* Names on one board that appear in the opposite premium extreme. Rank is
     the board's own `r`; when a row carries none the name still counts, and
     the renderer says so rather than inventing a position. */
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
    /* Ordered by the board's own ranking, because that is the axis the reader
       came from — not by premium, which would put the loudest name first and
       bury a contradiction on the top-ranked one. */
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
    if (!host || !panel) return;
    host.textContent = "";
    if (note) note.textContent = "";

    /* Named `boardLong`/`boardShort` rather than `long`/`short`: both bare
       words are ES3 future reserved words and this file is plain ES5 served
       to whatever the reader is running. */
    var boardLong = boards[0], boardShort = boards[1];

    /* THE JOIN NEEDS BOTH SIDES, so it has to say which side was missing. A
       panel that silently draws nothing when one of two inputs failed is the
       defect the rest of this file just finished removing. */
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
    /* EACH SIDE ANSWERS FOR ITS OWN LIST. The first version of this guard
       required BOTH premium lists to be missing before it said anything, so a
       payload carrying only one of the two rendered the other column as "No
       long-board name appears in the session's largest net put premium" —
       a measured-emptiness sentence manufactured by an input that was never
       published, which is the confident zero one level up from the
       arithmetic and precisely what that guard's own comment claimed to
       prevent. A side whose ranking never arrived is UNAVAILABLE, is not
       given the quiet sentence, and its board names are kept out of the
       denominator: a population that was never joined cannot be part of
       "N of M appear". */
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
        /* AN EMPTY BOARD IS NOT AN EMPTY OVERLAP EITHER. "No long-board name
           appears in the largest net put premium" is true of a board with no
           names on it and says nothing, and its board contributes nothing to
           the denominator — a side with no population cannot be part of one. */
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

    if (note) {
      /* THE DENOMINATOR TRAVELS WITH THE COUNT, and so does the reason a
         zero here is weak evidence: the mover lists are capped extremes, not
         the universe, so a name can disagree with the tape and simply not be
         extreme enough to appear in either of them. */
      var parts = [];
      if (!population) {
        /* NO POPULATION, NO RATIO. "0 of 0 published board names appear" is a
           fraction over an empty set: it looks like a measurement of
           agreement and is a statement that nothing was compared. */
        parts.push("No board name was joined against the tape this session, so there is no " +
          "population to state a count against.");
      } else {
        parts.push(hits + " of " + population + " published board names (" +
          joined.join(", ") + ") appear in the opposite premium extreme this session.");
      }
      if (skipped.length) parts.push(skipped.join("; ") + ".");
      parts.push("The board score is a residual — sector and size are divided out before the " +
        "ranking — while these premium lists are the raw level, so the two are allowed " +
        "to disagree; a name where they do is one to read twice, not a signal to fade.");
      parts.push("Both mover lists are CAPPED extremes rather than the universe, so a name " +
        "absent from them has not been shown to agree with the tape: it has only been " +
        "shown not to be one of the session's loudest disagreements.");
      note.textContent = parts.join(" ");
    }
    panel.hidden = false;
  }

  /* The panel is built here rather than in shared/flows-pages.js because this
     renderer owns it end to end; the markup file carries no element only this
     file writes. Inserted before the footer so the page still ends on the
     payload's own published prose. */
  function mountAgainst() {
    if (document.getElementById("mktAgainstPanel")) return;
    var foot = document.getElementById("mktFoot");
    if (!foot || !foot.parentNode) return;
    var section = el("section", "fc-panel");
    section.id = "mktAgainstPanel";
    section.hidden = true;
    section.append(el("h2", "fc-panel-h", "Against the tape"));
    var body = el("div");
    body.id = "mktAgainst";
    section.append(body);
    var p = el("p", "fc-note");
    p.id = "mktAgainstNote";
    section.append(p);
    foot.parentNode.insertBefore(section, foot);
  }

  /* Repainted whole at the new width, never scaled — the flows-track rule. */
  var chartResizeTimer = 0;
  window.addEventListener("resize", function () {
    if (!tideChart && !totalsChart) return;
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(drawCharts, 150);
  });

  /* The market key's own write time, captured off the response header on the
     way past. It answers a question the payload cannot: whether the PIPELINE
     ran, as distinct from whether the DATA moved. A frozen vendor feed
     republished on schedule has a fresh write time and a stale session; a
     dead pipeline has the reverse, and #mktStale names which one. */
  var marketUpdatedAt = null;

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 401) { location.replace("/flows/"); return null; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (path === "/api/flows/market") {
          /* ABSENCE TESTED BEFORE THE COERCION. `Number(header) || null`
             manufactures 0 out of a missing header and then leans on `||` to
             catch the zero it has just made; flows-ui.js names that exact
             shape as the reason the staleness test was lifted out of the
             renderers. A non-positive stamp is an absent one. */
          var stamp = r.headers.get("X-Payload-Updated");
          var ms = (stamp === null || stamp === "") ? null : Number(stamp);
          marketUpdatedAt = (ms !== null && isFinite(ms) && ms > 0) ? ms : null;
        }
        return r.json();
      });
  }

  var status = document.getElementById("mktStatus");

  /* THE MARKET KEY IS LOAD-BEARING and the other five are not: a failure to
     read it leaves the page with nothing to say, so it keeps the bare get()
     and its rejection reaches the catch below. Everything else goes through
     optional(), which turns a failed request into a sentinel a painter can
     tell apart from an unpublished key. */
  Promise.all([
    get("/api/flows/market"),
    optional("/api/flows/sectors"),
    optional("/api/flows/movers"),
    optional("/api/flows/pulse"),
    optional("/api/flows/board?side=long"),
    optional("/api/flows/board?side=short"),
  ]).then(function (all) {
    var m = all[0], sectors = all[1], movers = all[2];
    if (!m) return;

    /* THE WRITE TIME, stamped from the response header onto the payload —
       a client-side annotation, not a claim the pipeline publishes it. */
    if (typeof m === "object") m.__updatedAt = marketUpdatedAt;

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

    setStale(assessAge(m));

    paintTilt(m);
    paintBreadth(m);
    paintTape(m);
    paintSectors(sectors);
    paintMovers(movers);
    mountAgainst();
    paintAgainst([all[4], all[5]], movers);
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
