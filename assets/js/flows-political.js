/* DISCLOSED POLITICAL FILINGS — who disclosed the largest purchases.
 *
 * Renders /api/flows/political. Four panels: filers ranked by disclosed
 * purchase size, the same by asset, the most recent disclosures, and the
 * per-name holder list.
 *
 * THE ONE DESIGN DECISION THIS FILE EXISTS TO MAKE. A disclosure states a
 * RANGE and never an amount, so every bar on this page is a midpoint standing
 * in for a band that may be twenty times as wide as the gap to the row below
 * it. A ranking drawn as plain bars would say "first, second, third" with a
 * confidence the data cannot support, and the payload's own caveat — two
 * totals closer than the span of their own bands are not ranked apart — would
 * sit in a footnote doing nothing.
 *
 * So the band is DRAWN. Each row carries a whisker from its summed low to its
 * summed high across the bar, on the axis the bar itself uses, and the panel
 * counts how many adjacent pairs overlap. The caveat becomes something the
 * eye resolves before the prose is read, and the prose is still there.
 *
 * THE VOCABULARY RULE GOVERNING EVERY STRING HERE. Nothing on this page is a
 * trade, a position, a conviction or a signal. A row is a statutory
 * disclosure: a filing, made late by law and later in practice, describing
 * something that already happened. Headings say "disclosed" and the prose
 * says when. The strings that carry the reasoning are published in the
 * payload beside the arithmetic and are printed verbatim, so a renderer
 * cannot reword a caveat into a claim.
 */
(function () {
  "use strict";

  var MINUS = "−";      // U+2212, not a hyphen
  var DASH = "—";
  /* THE NEW-TODAY MARK, AND IT IS A GLYPH IN A FIXED POSITION.

     Every mark on this page has to survive greyscale and a monochrome
     printout, so freshness cannot be a tint. The glyph sits at the front of
     the filing-date cell — the same place on every row it appears on, absent
     everywhere else — and carries a title naming the date it means. */
  var FRESH = "◆";

  /* Normalise a symbol the way the card store keys it.

     THE LIVE DATA FALSIFIES THE NAIVE LOOKUP. The disclosure feed emits
     "BRK.B" while the card is stored under "BRKB", so a link built from the
     symbol as filed would 404 on exactly the largest names. Dots out, upper
     case, and the same function is used for the membership test AND for the
     href so the two can never disagree. */
  function cardKey(t) {
    return String(t === null || t === undefined ? "" : t).toUpperCase().replace(/[.\-\s]/g, "");
  }

  /* THE CANONICAL FORM, WHICH ADMITS A NUMERIC STRING. This read
     `typeof v === "number" && isFinite(v)`, which is safe against the
     confident zero — Number(null) never runs — but is STRICTER than the
     contract every other surface in this product holds, and the harm runs the
     other way: the vendor quotes several fields, so a present reading rendered
     as an em dash. flows-panels.js already diagnosed this exact divergence
     after it shipped: "one payload field rendered as a value on the board and
     as an em dash in the card panel, for the same card, in the same session."
     The payload side agrees — shared/flows-market.js numOrNull coerces the
     same way.

     ALIGNED RATHER THAN DELETED, and that is a measurement rather than a
     shortcut. The obvious move is to drop the local copy for flows-ui.js's
     `UI.isNum`, but the library is 24k of parse and tests/flows-weight ceilings
     both routes that carry this copy: market goes 91k to 115k against a 95k
     ceiling, political 49k to 73k against 55k. Both trip. So the body matches
     the canonical one and the duplication stays until those routes can afford
     the module. */
  function isNum(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = typeof v === "number" ? v : Number(v);
    return isFinite(n) ? n : null;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  /* Money, in the units an eight-figure sum is actually read in. */
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
  /* A COUNT, NOT A SUM OF DOLLARS. The holder feed's numbers are share
     quantities by the vendor's own description, so they are formatted without
     a currency mark — the unit rides on the panel instead. */
  function qty(v) {
    var n = isNum(v);
    if (n === null) return DASH;
    return n.toLocaleString();
  }
  function days(v) {
    var n = isNum(v);
    return n === null ? DASH : n + "d";
  }
  function td(text, cls) {
    var n = el("td", cls || null);
    n.textContent = text === null || text === undefined ? DASH : String(text);
    return n;
  }

  /**
   * The three silences, told apart.
   *
   * A key that was never published, a request that did not come back, and a
   * pipeline that measured and found nothing are three different facts, and
   * only the last of them is about politicians. Each gets its own sentence
   * and its own `data-empty` tag.
   */
  function silence(panel, host, feed, measured) {
    if (!feed) {
      host.append(tagged("p", "fc-q", "absent",
        "This section has not been published yet. It appears with the first " +
        "pipeline run after it shipped."));
      return true;
    }
    if (feed.status === "unavailable") {
      host.append(tagged("p", "fc-q", "unavailable",
        "The vendor did not answer for this feed" +
        (feed.reason ? " (" + feed.reason + ")" : "") +
        ", so nothing is drawn. This is a fact about the request, not about " +
        "what anyone disclosed."));
      return true;
    }
    if (feed.status !== "ok" || !feed.rows || !feed.rows.length) {
      host.append(tagged("p", "fc-q", "quiet",
        measured || "The window was read and held no filing this panel could rank."));
      return true;
    }
    return false;
  }
  function tagged(tag, cls, kind, text) {
    var n = el(tag, cls, text);
    n.setAttribute("data-empty", kind);
    return n;
  }

  /**
   * One ranked row: a bar for the midpoint total, a whisker for the band.
   *
   * The axis is SHARED across every row in the panel and anchored at zero, so
   * bar length is comparable down the column. The whisker is drawn on that
   * same axis — it is the low and high of the same filings, not a separate
   * scale — and it is what makes an unrankable pair look unrankable.
   */
  function rankBar(scale, mid, lo, hi) {
    var wrap = el("div", "pl-bar");
    var m = isNum(mid), l = isNum(lo), h = isNum(hi);
    if (m !== null && scale > 0) {
      var bar = el("i", "pl-bar-fill");
      bar.style.width = Math.max(0.4, Math.min(100, (m / scale) * 100)) + "%";
      wrap.append(bar);
    }
    if (l !== null && h !== null && h > l && scale > 0) {
      var band = el("i", "pl-bar-band");
      band.style.left = Math.min(100, (l / scale) * 100) + "%";
      band.style.width = Math.max(0.4, Math.min(100, ((h - l) / scale) * 100)) + "%";
      wrap.append(band);
    }
    return wrap;
  }

  /* How many ADJACENT pairs in the ranking have overlapping bands. Adjacent
     rather than all pairs: the claim the ranking makes is about neighbours,
     so the count that qualifies it is the count of neighbours it cannot
     actually separate.

     THE FULL INTERSECTION TEST, AND NOT BECAUSE THE HALF ONE WAS WRONG. The
     first draft tested only `b.hi >= a.lo`, and that really is sufficient
     here: rows arrive sorted by midpoint descending, and lo <= mid <= hi
     holds on every row, so b.lo <= b.mid <= a.mid <= a.hi is guaranteed and
     the second half can never fail. A review bot read it as a defect, which
     is the point — the shorter test is correct only by way of two invariants
     established in two other files, and a reader who does not hold both in
     mind sees a bug. The complete test costs nothing, returns the same
     answer, and needs no argument.

     ALL FOUR BOUNDS OR NEITHER. The old skip checked two of them, so a pair
     missing the other two was silently counted as separated. A pair that
     cannot be compared is now not counted in EITHER total, and the note's
     denominator is the comparable pairs rather than every pair — a
     proportion whose denominator includes what it could not measure is not
     a proportion of anything. */
  function overlaps(rows) {
    var n = 0, comparable = 0;
    for (var i = 1; i < rows.length; i++) {
      var a = rows[i - 1], b = rows[i];
      var aLo = isNum(a.boughtLo), aHi = isNum(a.boughtHi);
      var bLo = isNum(b.boughtLo), bHi = isNum(b.boughtHi);
      if (aLo === null || aHi === null || bLo === null || bHi === null) continue;
      comparable++;
      if (aLo <= bHi && bLo <= aHi) n++;
    }
    return { n: n, comparable: comparable };
  }
  function overlapNote(rows) {
    if (rows.length < 2) return "";
    var o = overlaps(rows);
    if (!o.comparable) {
      return "No two neighbours here state both a low and a high, so whether " +
        "this ordering is one the disclosed ranges can carry was not measured.";
    }
    if (!o.n) {
      return "No two of the " + o.comparable + " comparable neighbouring pairs " +
        "have overlapping bands, so the order of this column is one the " +
        "disclosed ranges can carry.";
    }
    return o.n + " of the " + o.comparable + " comparable neighbouring pairs " +
      "have overlapping bands — their whiskers cross, and those pairs are not " +
      "separated by anything the filings state. The bar is a midpoint; the " +
      "whisker is what was actually disclosed.";
  }

  /* The held-back size, said once and plainly. An open-ended band states a
     floor and no ceiling, so it is out of every total on the row — publishing
     the sum of those floors is the difference between a caveat and a number. */
  function openNote(rows, subject) {
    var bands = 0, floor = 0;
    for (var i = 0; i < rows.length; i++) {
      bands += isNum(rows[i].openBands) || 0;
      floor += isNum(rows[i].openFloor) || 0;
    }
    if (!bands) return "";
    return bands + " disclosure" + (bands === 1 ? "" : "s") + " here state" +
      (bands === 1 ? "s" : "") + " a floor and no ceiling (“Over $50,000,000” " +
      "and its kind). Those have no midpoint to sum, so they are excluded from " +
      "every total in this panel; the floors they do state add to " + usd(floor) +
      " of disclosed " + subject + " that no bar above includes.";
  }

  /* The self-filed share, over the rows drawn, said once and the same way in
     both ranked panels.

     POLITICAL_NOTES.attribution has promised this sentence since the module
     shipped — "the totals report the self-filed share" — and until the shaper
     started counting it, the only panel that delivered it was the holders
     block, which 422s. Unknown is not "all their own": a window where the
     vendor stated no account at all says so, in the same words the holders
     note uses. */
  function ownerNote(rows, unit) {
    /* THREE STATES, AND THE FIRST DRAFT COLLAPSED TWO OF THEM. `known === 0`
       was read as "the vendor stated an account on none of these filings" —
       but it is equally what a payload published BEFORE this counter shipped
       produces, since a missing key and a counted zero both leave the running
       total at 0. On the morning after a deploy, when the last run's payload
       is still the one being served, that sentence would have been a claim
       about the vendor made from a field the vendor was never asked for. So
       whether ANY row carried the counter is tracked separately from what the
       counters said. */
    var known = 0, self = 0, carried = false;
    for (var i = 0; i < rows.length; i++) {
      var k = isNum(rows[i].ownerKnown);
      if (k === null) continue;
      carried = true;
      known += k;
      var sf = isNum(rows[i].selfFiled);
      if (sf !== null) self += sf;
    }
    if (!carried) {
      return "This payload does not carry the executing account behind these " + unit +
        ", so the share disclosed in a filer’s own name cannot be stated here. That is a " +
        "gap in what was published, not a reading about the filings.";
    }
    if (!known) {
      return "The vendor stated an executing account on none of the filings behind these " +
        unit + ", so the share disclosed in a filer’s own name is UNKNOWN here — which " +
        "is not the same fact as all of them being their own.";
    }
    return self + " of the " + known + " filings that state an executing account are the " +
      "filer’s own; the rest are a spouse’s, a dependant’s or joint.";
  }

  /* The count of rows drawn that carry the window's newest filing date, and
     the sentence naming it. `latestFiled` is a measured date from the tape,
     never "today": on the ordinary morning nothing is filed at all, and
     marking every row stale against a day with no filings would describe the
     calendar rather than the disclosures. */
  function freshNote(p, drawn, subject) {
    if (!p.latestFiled) return "";
    /* WHERE THE NEWEST FILING SITS AGAINST THE SESSION, in the three ways it
       can sit. The first draft said "before the last completed session"
       whenever the two dates differed, which is false for a window whose `to`
       runs to today: a filing dated after the last completed session is the
       ordinary case on any morning something is actually filed, and it is
       exactly the case a reader is looking for. */
    var when = "";
    if (p.sessionDate) {
      when = p.sessionDate === p.latestFiled
        ? ", which is the last completed session"
        : (p.latestFiled < p.sessionDate
          ? ", which is before the last completed session on " + p.sessionDate
          : ", which is after the last completed session on " + p.sessionDate);
    }
    /* THE SUBJECT DIFFERS BY PANEL AND SO DOES THE SENTENCE. On the tape a
       marked row IS the filing; on a ranked panel a marked row is an aggregate
       that CONTAINS one, and saying "filed on" there would date the total
       rather than the disclosure inside it. */
    var what = subject || "filed on";
    /* A LEGEND FOR A MARK THAT IS NOT ON THE PAGE IS WORSE THAN NO LEGEND.
       Nothing drawn carries the date — the cap kept older rows, or the day's
       filings were all sales — so the sentence reports that, rather than
       introducing a glyph the reader will hunt for and never find. */
    if (!drawn) {
      return "The newest disclosure date in this window is " + p.latestFiled + when +
        ", and no row drawn here carries it, so nothing below is marked new.";
    }
    return FRESH + " marks the " + drawn + " row" + (drawn === 1 ? "" : "s") +
      " " + what + " " + p.latestFiled + ", the newest disclosure date in this window" +
      when + ".";
  }

  /**
   * A ticker cell: a link to the detail card when one exists, plain text when
   * it does not.
   *
   * THE OLD CAPTION SAID "A LINK THAT USUALLY LEADS NOWHERE IS WORSE THAN NO
   * LINK", and it was right about links and wrong about "usually": cards exist
   * for a large share of the top of this ranking, including its first rows.
   * The fix is not to link optimistically — it is to link from a published
   * list, exactly as /flows/unusual/ links only names its payload's coverage
   * array contains. When the payload carries no such list, nothing is linked
   * and the caption says so, because a renderer guessing which cards exist is
   * the failure the old caption was avoiding.
   */
  function tickerCell(t, carded, cls) {
    var text = t === null || t === undefined ? DASH : String(t);
    if (!carded || !t || !carded.has(cardKey(t))) return el("span", cls, text);
    var a = el("a", cls, text);
    a.href = "/flows/ticker/?t=" + encodeURIComponent(cardKey(t));
    a.title = "Open the detail card the board published for " + text + ".";
    return a;
  }

  /* The set of names a detail card exists for, or null when the payload did
     not say. NULL AND EMPTY ARE DIFFERENT: an empty set is "the board went
     deep on nothing", a null is "this payload does not carry the list", and
     only the second one is a reason for the caption to apologise. */
  function cardedSet(p) {
    if (!Array.isArray(p.carded)) return null;
    var set = new Set();
    for (var i = 0; i < p.carded.length; i++) set.add(cardKey(p.carded[i]));
    return set;
  }

  /* ---------- panel 1: the filers ---------------------------------- */

  function paintBuyers(p) {
    var panel = document.getElementById("plBuyersPanel");
    var host = document.getElementById("plBuyers");
    if (!panel || !host) return;
    panel.hidden = false;
    host.textContent = "";
    var feed = p.buyers;
    if (silence(panel, host, feed,
      "The window was read and no filer in it disclosed a purchase this panel " +
      "could rank. Sales and transfers do not enter a purchase ranking.")) return;

    var rows = feed.rows;
    var scale = 0;
    for (var i = 0; i < rows.length; i++) {
      scale = Math.max(scale, isNum(rows[i].boughtHi) || 0, isNum(rows[i].bought) || 0);
    }

    var wrap = el("div", "flows-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Filers ranked by disclosed purchase size");
    var table = el("table", "flows-table pl-table");
    var cap = el("caption", "flows-caption");
    cap.textContent = "Ranked by the summed midpoint of each filer’s disclosed " +
      "purchases. The bar is that midpoint; the pale whisker across it is the " +
      "summed low to the summed high of the same filings. Sales are shown " +
      "beside, never folded in.";
    table.append(cap);
    var head = el("tr");
    [["#", "c-num"], ["Filer", ""], ["Disclosed purchases", "pl-c-bar"],
     ["Midpoint", "c-num"], ["Low", "c-num"], ["High", "c-num"],
     /* NOT LISTED sits beside the midpoint it is part of, because the reader's
        question on seeing a large total is "how much of that is equity". */
     ["Not listed", "c-num"],
     ["Filings", "c-num"], ["Names", "c-num"], ["Median lag", "c-num"],
     ["Disclosed sales", "c-num"]].forEach(function (h) {
      var th = el("th", h[1] || null, h[0]);
      th.setAttribute("scope", "col");
      head.append(th);
    });
    var thead = el("thead");
    thead.append(head);
    table.append(thead);

    var body = el("tbody");
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var tr = el("tr");
      tr.append(td(j + 1, "c-num pl-rank"));
      var who = el("td", "pl-who");
      who.append(el("span", "pl-name", r.who || DASH));
      if (r.memberType) who.append(el("span", "pl-chamber", String(r.memberType)));
      tr.append(who);
      var bar = el("td", "pl-c-bar");
      bar.append(rankBar(scale, r.bought, r.boughtLo, r.boughtHi));
      tr.append(bar);
      tr.append(td(usd(r.bought), "c-num pl-mid"));
      tr.append(td(usd(r.boughtLo), "c-num pl-bound"));
      tr.append(td(usd(r.boughtHi), "c-num pl-bound"));
      /* THE PART OF THE TOTAL THIS PAGE'S OTHER PANELS CANNOT SEE. Treasury
         bills, funds and partnership interests name no ticker, so they were
         summed into the total here and excluded from the assets ranking, and
         nothing said the two disagreed. An em dash means there were no such
         filings — a fact the title states, so the dash is never read as a
         withheld number. */
      var other = el("td", "c-num pl-other");
      var otherBuys = isNum(r.buysOther);
      if (otherBuys) {
        other.textContent = usd(r.boughtOther);
        other.title = otherBuys + " of this filer’s " + isNum(r.buys) +
          " disclosed purchases named no listed security — Treasury bills, funds and " +
          "partnership interests carry no ticker — so that size is in the total beside " +
          "it and in no row of the ranking by name.";
      } else {
        other.textContent = DASH;
        other.title = otherBuys === null
          ? "This payload does not split the total by whether a listed security was named."
          : "Every disclosed purchase behind this total named a listed security.";
      }
      tr.append(other);
      tr.append(td(isNum(r.buys), "c-num"));
      /* NULL IS AN EM DASH AND NOT A ZERO. "$2.05M across 0 names" read as a
         measurement — a filer who bought nothing identifiable — when the truth
         is that this column has nothing to say about that money. */
      var names = el("td", "c-num");
      var nCount = isNum(r.names);
      names.textContent = nCount === null ? DASH : String(nCount);
      if (nCount === null) {
        names.title = "None of this filer’s disclosed purchases named a listed security, " +
          "so there is no name count here. That is not a count of zero.";
      }
      tr.append(names);
      tr.append(td(days(r.medianLagDays), "c-num"));
      tr.append(td(r.sells ? usd(r.sold) : DASH, "c-num pl-sold"));
      /* The newest-filing mark, in the same fixed position on the row it is
         in as on every other panel: leading the filer's name cell. */
      if (isNum(r.freshBuys)) {
        var mark = el("sup", "pl-fresh", FRESH);
        mark.title = isNum(r.freshBuys) + " of these purchases were disclosed on the " +
          "window’s newest filing date.";
        who.insertBefore(mark, who.firstChild);
      }
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    host.append(wrap);

    var note = document.getElementById("plBuyersNote");
    if (note) {
      note.textContent = [
        countedNote(feed, "filer"),
        overlapNote(rows),
        openNote(rows, "purchases"),
        listedNote(rows),
        ownerNote(rows, "totals"),
        freshNote(p, rows.filter(function (r) { return isNum(r.freshBuys); }).length,
          "carrying a purchase disclosed on"),
      ].filter(Boolean).join(" ");
    }
  }

  /* How much of the ranked size named no listed security, as one number.

     The per-row column says it row by row; this says whether the panel as a
     whole is an equity ranking or something wider. Silent when every filing
     named a ticker, because a sentence that always appears and usually reads
     "none" trains a reader to skip the line that matters. */
  function listedNote(rows) {
    var other = 0, filings = 0;
    for (var i = 0; i < rows.length; i++) {
      var o = isNum(rows[i].boughtOther), c = isNum(rows[i].buysOther);
      if (o !== null) other += o;
      if (c !== null) filings += c;
    }
    if (!filings) return "";
    return filings + " of the disclosures behind these totals named no listed security " +
      "(Treasury bills, funds and partnership interests carry no ticker), adding " +
      usd(other) + " that the ranking by name below cannot show.";
  }

  /* What the cap kept and what it dropped, in one sentence.

     `cut` NAMES THE ORDERING THE CAP APPLIED. The ranked panels drop the
     smallest; the recent panel is ordered by date and drops the OLDEST, and
     saying those rows "ranked below the cut" would describe a ranking that
     panel never took. The count is of rows actually drawn rather than of the
     cap, because a note reading "top 25" above three rows describes a page
     nobody is looking at. */
  function countedNote(feed, unit, cut) {
    var seen = isNum(feed.seen), shed = isNum(feed.shed);
    if (seen === null) return "";
    if (!shed) return seen + " " + unit + (seen === 1 ? "" : "s") + " in the window.";
    return "Top " + feed.rows.length + " of " + seen + " " + unit + "s in the window; " +
      shed + " " + (cut || "ranked below the cut") + " and are not drawn.";
  }

  /* ---------- panel 2: the assets ---------------------------------- */

  function paintAssets(p) {
    var panel = document.getElementById("plAssetsPanel");
    var host = document.getElementById("plAssets");
    if (!panel || !host) return;
    panel.hidden = false;
    host.textContent = "";
    var feed = p.assets;
    var carded = cardedSet(p);
    /* THE BREADTH BLOCK IS DRAWN EVEN WHEN THE SIZE RANKING IS NOT.

       It used to be painted at the bottom of this function, after an early
       return that fires whenever `p.assets` is absent, unavailable or empty.
       Both blocks come from one feed and buildPolitical marks them silent
       together, so the branch inside paintClusters that reports an
       unavailable breadth feed could never be reached by any payload the
       pipeline can publish — a state handled in code and unreachable in
       fact, which is this repository's most repeated mistake wearing a
       renderer's clothes. Drawn first now, so each block states its own
       silence in its own words. */
    if (silence(panel, host, feed,
      "The window was read and no name in it drew a disclosed purchase.")) {
      paintClusters(p, host, carded);
      return;
    }

    var rows = feed.rows;
    var scale = 0;
    for (var i = 0; i < rows.length; i++) {
      scale = Math.max(scale, isNum(rows[i].boughtHi) || 0, isNum(rows[i].bought) || 0);
    }

    var wrap = el("div", "flows-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Assets ranked by disclosed purchase size");
    var table = el("table", "flows-table pl-table");
    var cap = el("caption", "flows-caption");
    /* THE CAPTION FOLLOWS THE PAYLOAD RATHER THAN A BELIEF ABOUT IT.

       It used to read "a link that usually leads nowhere is worse than no
       link" — sound reasoning about links, resting on a premise about cards
       that the live store falsifies at the top of this very ranking. The
       renderer now links from a PUBLISHED list of names a card exists for,
       the way /flows/unusual/ does, and says which of the two states it is
       in rather than asserting the pessimistic one either way. */
    cap.textContent = "The same discipline by name: summed midpoints of disclosed " +
      "purchases across every filer. " + (carded
        ? "A name is a link where the board published a detail card for it and plain " +
          "text where it did not — the list of carded names comes from the payload, " +
          "never from a guess."
        : "Names are plain text: this payload carries no list of the names a detail " +
          "card exists for, and a link built on a guess is worse than no link.");
    table.append(cap);
    var thead = el("thead");
    var head = el("tr");
    [["#", "c-num"], ["Name", ""], ["Disclosed purchases", "pl-c-bar"],
     ["Midpoint", "c-num"], ["Low", "c-num"], ["High", "c-num"],
     ["Filers", "c-num"], ["Filings", "c-num"], ["Median lag", "c-num"],
     ["Disclosed sales", "c-num"]].forEach(function (h) {
      var th = el("th", h[1] || null, h[0]);
      th.setAttribute("scope", "col");
      head.append(th);
    });
    thead.append(head);
    table.append(thead);

    var body = el("tbody");
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var tr = el("tr");
      tr.append(td(j + 1, "c-num pl-rank"));
      var name = el("td", "pl-who");
      if (isNum(r.freshBuys)) {
        var amark = el("sup", "pl-fresh", FRESH);
        amark.title = isNum(r.freshBuys) + " of the purchases behind this total were " +
          "disclosed on the window’s newest filing date.";
        name.append(amark);
      }
      name.append(tickerCell(r.t, carded, "pl-tick"));
      /* THE SECURITY'S NAME, from the field that names the security. This read
         `r.issuer` until 2026-09-03 and printed "joint" or "not-disclosed"
         where a company belongs — the vendor's spec types `issuer` as "The
         person who executed the transaction", and it is not on the
         recent-trades schema at all. shared/flows-political.js states the
         correction at length. */
      if (r.asset) name.append(el("span", "pl-asset", String(r.asset)));
      tr.append(name);
      var bar = el("td", "pl-c-bar");
      bar.append(rankBar(scale, r.bought, r.boughtLo, r.boughtHi));
      tr.append(bar);
      tr.append(td(usd(r.bought), "c-num pl-mid"));
      tr.append(td(usd(r.boughtLo), "c-num pl-bound"));
      tr.append(td(usd(r.boughtHi), "c-num pl-bound"));
      tr.append(td(isNum(r.filers), "c-num"));
      tr.append(td(isNum(r.buys), "c-num"));
      tr.append(td(days(r.medianLagDays), "c-num"));
      tr.append(td(r.sells ? usd(r.sold) : DASH, "c-num pl-sold"));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    host.append(wrap);

    var note = document.getElementById("plAssetsNote");
    if (note) {
      note.textContent = [
        countedNote(feed, "name"),
        overlapNote(rows),
        openNote(rows, "purchases"),
        ownerNote(rows, "names"),
        freshNote(p, rows.filter(function (r) { return isNum(r.freshBuys); }).length,
          "carrying a purchase disclosed on"),
      ].filter(Boolean).join(" ");
    }

    paintClusters(p, host, carded);
  }

  /* ---------- panel 2b: the names more than one filer bought -------

     RANKED BY BREADTH, BESIDE THE ONE RANKED BY SIZE, and drawn here rather
     than in a panel of its own so the two orderings of the SAME aggregates sit
     under one heading and can be read against each other. A name that is
     third by dollars and first by filers is the reading this block exists to
     make visible, and it is only visible if both orders are on the screen at
     once. */
  function paintClusters(p, host, carded) {
    var feed = p.clusters;
    if (!feed) return;                     // an older payload: draw nothing, claim nothing
    var box = el("div", "pl-clusters");
    /* NO CLASS: `.fc-panel h3` already styles a sub-heading inside a panel by
       element, and a class the stylesheet does not define is a hook that reads
       like styling and is not. */
    box.append(el("h3", null, "The same window, ordered by how many filers"));

    if (feed.status === "unavailable") {
      box.append(tagged("p", "fc-q", "unavailable",
        "The vendor did not answer for this feed" +
        (feed.reason ? " (" + feed.reason + ")" : "") + ", so nothing is ordered here."));
      host.append(box);
      return;
    }
    var rows = Array.isArray(feed.rows) ? feed.rows : [];
    if (!rows.length) {
      /* MEASURED AND EMPTY, and the floor that measured it is named. "No
         clusters" without the floor beside it reads as a claim about the
         window rather than about the threshold applied to it. */
      /* THE FLOOR IS READ, NEVER RESTATED. This said `isNum(feed.minFilers)
         || 3`, which prints the sentence "from 3 or more separate filers" on
         a payload that stated no floor at all — a renderer asserting a
         constant the shaper owns, and the way two spellings of one number
         drift apart. A payload without the field gets a sentence that does
         not name one. */
      var floor = isNum(feed.minFilers);
      box.append(tagged("p", "fc-q", "quiet",
        floor === null
          ? "No name in this window drew disclosed purchases from enough separate filers " +
            "to clear the floor. This payload does not state what that floor was, so the " +
            "emptiness cannot be read against it here."
          : "No name in this window drew disclosed purchases from " + floor +
            " or more separate filers" +
            (isNum(feed.namesSeen) ? ", across the " + feed.namesSeen + " names that drew any"
              : "") + ". The floor is not relaxed to fill the panel."));
      host.append(box);
      return;
    }

    var wrap = el("div", "flows-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Names ordered by the number of separate filers");
    var table = el("table", "flows-table pl-table");
    var cap = el("caption", "flows-caption");
    cap.textContent = "Ordered by the number of DISTINCT filers who disclosed a purchase, " +
      "then by median disclosure lag, then by size. " + (feed.basis || "") +
      " Size is the weakest thing this data knows: one account’s large purchase of a " +
      "single name outranks several separate filers converging on another wherever " +
      "dollars decide the order.";
    table.append(cap);
    var thead = el("thead");
    var head = el("tr");
    [["#", "c-num"], ["Name", ""], ["Filers", "c-num"], ["Filings", "c-num"],
     ["Midpoint", "c-num"], ["Median lag", "c-num"]].forEach(function (h) {
      var th = el("th", h[1] || null, h[0]);
      th.setAttribute("scope", "col");
      head.append(th);
    });
    thead.append(head);
    table.append(thead);

    var body = el("tbody");
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var tr = el("tr");
      tr.append(td(i + 1, "c-num pl-rank"));
      var name = el("td", "pl-who");
      if (isNum(r.freshBuys)) {
        var mark = el("sup", "pl-fresh", FRESH);
        mark.title = isNum(r.freshBuys) + " of the purchases behind this total were " +
          "disclosed on the window’s newest filing date.";
        name.append(mark);
      }
      name.append(tickerCell(r.t, carded, "pl-tick"));
      if (r.asset) name.append(el("span", "pl-asset", String(r.asset)));
      tr.append(name);
      tr.append(td(isNum(r.filers), "c-num pl-filers"));
      tr.append(td(isNum(r.buys), "c-num"));
      tr.append(td(usd(r.bought), "c-num pl-mid"));
      tr.append(td(days(r.medianLagDays), "c-num"));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    box.append(wrap);
    /* Same rule as the quiet sentence above: the floor printed here is the
       one the payload states, and a payload that states none says so instead
       of having a number invented for it. */
    var shownFloor = isNum(feed.minFilers);
    box.append(el("p", "fc-note",
      countedNote(feed, "name", "drew fewer filers") + " " +
      (shownFloor === null
        ? "This payload does not state the floor these rows cleared, so the ordering is " +
          "drawn without it. "
        : "The floor is " + shownFloor + " separate filers, stated rather than tuned: " +
          "two is the smallest number that could be called convergence at all, and on a " +
          "market-wide window a great many names collect two by coincidence. ") +
      "Nothing here blends breadth with size into a single figure — each key breaks ties " +
      "in the one before it, so the order can be checked by eye against the columns."));
    host.append(box);
  }

  /* ---------- panel 3: the recent disclosures ---------------------- */

  function paintRecent(p) {
    var panel = document.getElementById("plRecentPanel");
    var host = document.getElementById("plRecent");
    if (!panel || !host) return;
    panel.hidden = false;
    host.textContent = "";
    var feed = p.recent;
    if (silence(panel, host, feed,
      "The window was read and held no disclosure with a filing date.")) return;

    var wrap = el("div", "flows-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Most recent disclosures");
    var table = el("table", "flows-table pl-table");
    var cap = el("caption", "flows-caption");
    cap.textContent = "Newest DISCLOSURE first, not newest transaction. The filing " +
      "is what changed; an older trade disclosed today is the newer news, and " +
      "the lag column is the distance between the two.";
    table.append(cap);
    var thead = el("thead");
    var head = el("tr");
    /* THE ACCOUNT THE FILING NAMES, as its own column.

       The vendor's `issuer` field is "the person who executed the
       transaction" — self, spouse, joint, not-disclosed — and this page used
       to print it under the ticker where a company name belongs. The shaper
       reads it for what it is now; this is where it goes. Treating a spouse's
       account as the member's own judgement is the classic error this
       repository already names in the card's congress panel, and it cannot be
       avoided on a page that never shows the account. */
    [["Filed", ""], ["Transacted", ""], ["Lag", "c-num"], ["Filer", ""],
     ["Account", ""], ["Name", ""], ["Side", ""],
     ["Disclosed range", "c-num"]].forEach(function (h) {
      var th = el("th", h[1] || null, h[0]);
      th.setAttribute("scope", "col");
      head.append(th);
    });
    thead.append(head);
    table.append(thead);

    var carded = cardedSet(p);
    var body = el("tbody");
    for (var i = 0; i < feed.rows.length; i++) {
      var r = feed.rows[i];
      var tr = el("tr");
      /* The newest-filing mark leads the date it is about. Glyph and position,
         never hue: this page is read in print and in greyscale. */
      var filed = el("td", "pl-filed");
      if (p.latestFiled && r.filedDate === p.latestFiled) {
        var mark = el("sup", "pl-fresh", FRESH);
        mark.title = "Filed on " + p.latestFiled + ", the newest disclosure date in " +
          "this window.";
        filed.append(mark);
      }
      filed.append(document.createTextNode(r.filedDate || DASH));
      tr.append(filed);
      tr.append(td(r.txnDate));
      var lag = el("td", "c-num" + (isNum(r.lagDays) !== null && r.lagDays > 45 ? " pl-late" : ""));
      lag.textContent = days(r.lagDays);
      if (isNum(r.lagDays) !== null && r.lagDays > 45) {
        lag.title = "Past the 45 days the STOCK Act allows.";
      }
      tr.append(lag);
      tr.append(td(r.who));
      /* Absent is absent. A filing the vendor sent no executing account for is
         not a filing the member made for themselves — the same treatment the
         holders table gives the same missing fact. */
      tr.append(td(r.executedBy === null || r.executedBy === undefined
        ? "not stated" : r.executedBy,
        "pl-owner" + (r.executedBy === null || r.executedBy === undefined
          ? " is-unknown" : "")));
      var nameCell = el("td", "pl-who");
      nameCell.append(tickerCell(r.t, carded, "pl-tick"));
      /* THE SECURITY'S OWN DESCRIPTION, where the feed carries one. On the
         congress spelling it arrives in `notes` ("Apple Inc. - Common Stock
         (AAPL) [ST]") and was shaped and thrown away; on the unusual-trades
         spelling it is `asset`. Either way it is the company, which is what a
         reader looking at a ticker wants beside it. */
      var described = r.asset || r.notes;
      if (described) nameCell.append(el("span", "pl-asset", String(described)));
      tr.append(nameCell);
      /* THE VENDOR'S OWN WORD, not our classification. "Receive" is a gift or
         a transfer and is neither a purchase nor a sale; printing our reading
         instead of the filing's would hide that. */
      var side = el("td", "pl-side" +
        (r.side === "buy" ? " is-buy" : r.side === "sell" ? " is-sell" : " is-neither"));
      side.textContent = r.txnType || DASH;
      tr.append(side);
      tr.append(td(bandText(r), "c-num pl-band"));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    host.append(wrap);

    var note = document.getElementById("plRecentNote");
    if (note) {
      /* HOW MANY, NOT JUST WHICH. When most rows carry the late mark the mark
         stops distinguishing anything, and the useful fact becomes the
         proportion. Counted over the rows actually shown, because that is the
         population the reader can see. */
      var late = 0, dated = 0;
      for (var k = 0; k < feed.rows.length; k++) {
        if (isNum(feed.rows[k].lagDays) === null) continue;
        dated++;
        if (feed.rows[k].lagDays > 45) late++;
      }
      var fresh = 0;
      for (var f = 0; f < feed.rows.length; f++) {
        if (p.latestFiled && feed.rows[f].filedDate === p.latestFiled) fresh++;
      }
      note.textContent = [
        countedNote(feed, "disclosure", "were filed earlier"),
        dated
          ? late + " of the " + dated + " shown were filed past the 45 days " +
            "the STOCK Act allows, which is the ordinary case rather than the " +
            "exception."
          : "",
        freshNote(p, fresh),
      ].filter(Boolean).join(" ");
    }
  }

  /* The range as disclosed, never collapsed to its midpoint here: this panel
     is the one place the reader sees what the filing actually said. */
  function bandText(r) {
    var lo = isNum(r.lo), hi = isNum(r.hi);
    if (lo !== null && hi !== null) return usd(lo) + " – " + usd(hi);
    if (lo !== null) return "over " + usd(lo);
    if (isNum(r.mid) !== null) return usd(r.mid);
    return DASH;
  }

  /* ---------- panel 4: the holders --------------------------------- */

  function paintHolders(p) {
    var panel = document.getElementById("plHoldersPanel");
    var host = document.getElementById("plHolders");
    if (!panel || !host) return;
    panel.hidden = false;
    host.textContent = "";
    var feed = p.holders;
    if (silence(panel, host, feed,
      "The feed answered and named no holder in the board’s names.")) return;

    var wrap = el("div", "flows-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Politician portfolio holders");
    var table = el("table", "flows-table pl-table");
    var cap = el("caption", "flows-caption");
    /* THE UNIT, PRINTED FROM THE PAYLOAD. The vendor describes these three
       numbers as share quantities; every other number on this page is
       dollars. The caption carries the payload's own sentence rather than a
       reworded one, and no figure in this table wears a currency mark. */
    cap.textContent = "Holdings by politician in the names the board went deep on. " +
      "The three figures are a " + (feed.qtyUnit || "quantity the vendor does not define") +
      " They are not summed with, or ranked against, the dollar bands above.";
    table.append(cap);
    var thead = el("thead");
    var head = el("tr");
    [["Holder", ""], ["Name", ""], ["Account", ""],
     ["Low", "c-num"], ["Mid", "c-num"], ["High", "c-num"]].forEach(function (h) {
      var th = el("th", h[1] || null, h[0]);
      th.setAttribute("scope", "col");
      head.append(th);
    });
    thead.append(head);
    table.append(thead);

    var body = el("tbody");
    for (var i = 0; i < feed.rows.length; i++) {
      var r = feed.rows[i];
      var tr = el("tr");
      tr.append(td(r.who));
      tr.append(td(r.t));
      /* Absent is absent. A row the vendor sent no owner for is not a row
         owned by the filer. */
      tr.append(td(r.owner === null ? "not stated" : r.owner,
        "pl-owner" + (r.owner === null ? " is-unknown" : "")));
      tr.append(td(qty(r.minQty), "c-num"));
      tr.append(td(qty(r.midQty), "c-num"));
      tr.append(td(qty(r.maxQty), "c-num"));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    host.append(wrap);

    var note = document.getElementById("plHoldersNote");
    if (note) {
      var known = isNum(feed.ownerKnown), self = isNum(feed.selfFiled);
      note.textContent = countedNote(feed, "holding", "hold less by the vendor's own midpoint") + " " +
        (known
          ? self + " of the " + known + " holdings with a stated account are the " +
            "filer’s own; the rest are a spouse’s, a dependant’s or joint."
          : "The vendor stated an account owner on none of these rows, so the " +
            "share held in a filer’s own name is UNKNOWN here — which is not " +
            "the same fact as all of them being their own.");
    }
  }

  /* ---------- the page --------------------------------------------- */

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 401) { location.replace("/flows/"); return null; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  var status = document.getElementById("plStatus");

  get("/api/flows/political").then(function (p) {
    if (!p) return;

    if (p.status === "pending" || (!p.buyers && !p.holders)) {
      if (status) {
        status.textContent = "No disclosure window has been read yet. This page " +
          "appears with the first pipeline run after it shipped.";
      }
      return;
    }

    paintBuyers(p);
    paintAssets(p);
    paintRecent(p);
    paintHolders(p);

    if (status) {
      var w = p.window || {}, src = p.source || {};
      /* HOW WIDE THE READ WAS, IN THE STATUS LINE. A ranking is only as wide
         as the population behind it, and a reader who cannot tell one page
         from eight cannot tell a thin window from a broken one. */
      var pages = isNum(src.pages);
      /* THE ROUTE IS ITS OWN CLAUSE. Appended to the window with "of", it read
         as though the dates belonged to the route — "filed between May and
         August of congress-trader". Each fact gets its own segment. */
      var how = src.route
        ? "via " + src.route + (pages !== null
            ? ", " + pages + " page" + (pages === 1 ? "" : "s") + " deep" : "")
        : "";
      /* WHAT ARRIVED MOST RECENTLY, IN THE STATUS LINE. A subscriber opening
         this page daily could not tell what was new since yesterday: the tape
         is ordered by filing date and nothing named the newest one. The date
         is stated rather than the word "today", because on most mornings the
         newest filing in the window is several days old and saying "today"
         would be false on exactly the days it matters. */
      var freshCount = isNum(p.freshFilings);
      status.textContent = [
        (isNum(p.filings) || 0) + " disclosure" + (p.filings === 1 ? "" : "s") +
          (w.from ? " filed between " + w.from + " and " + (w.to || "today") : ""),
        freshCount !== null && p.latestFiled
          ? freshCount + " of them on " + p.latestFiled + ", the newest filing date here"
          : "",
        how,
        isNum(p.unusable) && p.unusable
          ? p.unusable + " carried no filer or name and were dropped" : "",
        p.readAt ? "read " + new Date(p.readAt).toLocaleString() : "",
      ].filter(Boolean).join(" · ");
    }

    /* THE PAGINATION VERDICT, SURFACED. `paginated: false` is the vendor
       ignoring the page parameter, which caps this window at one page — a
       fact about the ranking's width that belongs on the page, not in a
       build log. */
    var warn = document.getElementById("plSource");
    if (warn && p.source && p.source.paginated === false) {
      warn.hidden = false;
      warn.textContent = "The vendor returned the same page twice, so only the " +
        "first was kept: this window is one page deep rather than the " +
        (p.source.pages || 1) + " it asked for. The ranking below is over that " +
        "narrower population.";
    }
    if (warn && p.source && p.source.windowed === false) {
      warn.hidden = false;
      warn.textContent = "The windowed route refused, so this page is the most " +
        "recent disclosures the vendor will return in one call, with no date " +
        "range. The ranking is over that selection rather than over the window " +
        "named above.";
    }

    var foot = document.getElementById("plFoot");
    var notes = p.notes || {};
    if (foot) {
      /* THE PROSE TRAVELS WITH THE NUMBERS — published in the payload beside
         the arithmetic that produced them, printed verbatim. */
      [notes.unit, notes.lag, notes.size, notes.listed, notes.breadth,
       notes.fresh, notes.attribution, notes.refusals]
        .filter(Boolean).forEach(function (text) {
          foot.append(el("p", "flows-foot-p", text));
        });
    }
  }).catch(function (error) {
    if (status) status.textContent = "The disclosure window could not be loaded: " + error.message;
  });
})();
