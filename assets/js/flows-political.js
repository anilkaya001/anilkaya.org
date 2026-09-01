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

  function isNum(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
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
     actually separate. */
  function overlaps(rows) {
    var n = 0;
    for (var i = 1; i < rows.length; i++) {
      var a = rows[i - 1], b = rows[i];
      if (isNum(a.boughtLo) === null || isNum(b.boughtHi) === null) continue;
      if (b.boughtHi >= a.boughtLo) n++;
    }
    return n;
  }
  function overlapNote(rows) {
    if (rows.length < 2) return "";
    var n = overlaps(rows);
    if (!n) {
      return "No two neighbours here have overlapping bands, so the order of " +
        "this column is one the disclosed ranges can carry.";
    }
    return n + " of the " + (rows.length - 1) + " neighbouring pairs have " +
      "overlapping bands — their whiskers cross, and those pairs are not " +
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
      tr.append(td(isNum(r.buys), "c-num"));
      tr.append(td(isNum(r.names), "c-num"));
      tr.append(td(days(r.medianLagDays), "c-num"));
      tr.append(td(r.sells ? usd(r.sold) : DASH, "c-num pl-sold"));
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
      ].filter(Boolean).join(" ");
    }
  }

  /* What the cap kept and what it dropped, in one sentence. */
  function countedNote(feed, unit) {
    var seen = isNum(feed.seen), shed = isNum(feed.shed);
    if (seen === null) return "";
    if (!shed) return seen + " " + unit + (seen === 1 ? "" : "s") + " in the window.";
    return "Top " + feed.rows.length + " of " + seen + " " + unit + "s in the window; " +
      shed + " ranked below the cut and are not drawn.";
  }

  /* ---------- panel 2: the assets ---------------------------------- */

  function paintAssets(p) {
    var panel = document.getElementById("plAssetsPanel");
    var host = document.getElementById("plAssets");
    if (!panel || !host) return;
    panel.hidden = false;
    host.textContent = "";
    var feed = p.assets;
    if (silence(panel, host, feed,
      "The window was read and no name in it drew a disclosed purchase.")) return;

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
    cap.textContent = "The same discipline by name: summed midpoints of disclosed " +
      "purchases across every filer. Tickers are plain text — a detail card " +
      "exists only for names the board went deep on, and a link that usually " +
      "leads nowhere is worse than no link.";
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
      name.append(el("span", "pl-tick", r.t || DASH));
      if (r.issuer) name.append(el("span", "pl-issuer", String(r.issuer)));
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
      ].filter(Boolean).join(" ");
    }
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
    [["Filed", ""], ["Transacted", ""], ["Lag", "c-num"], ["Filer", ""],
     ["Name", ""], ["Side", ""], ["Disclosed range", "c-num"]].forEach(function (h) {
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
      tr.append(td(r.filedDate));
      tr.append(td(r.txnDate));
      var lag = el("td", "c-num" + (isNum(r.lagDays) !== null && r.lagDays > 45 ? " pl-late" : ""));
      lag.textContent = days(r.lagDays);
      if (isNum(r.lagDays) !== null && r.lagDays > 45) {
        lag.title = "Past the 45 days the STOCK Act allows.";
      }
      tr.append(lag);
      tr.append(td(r.who));
      tr.append(td(r.t));
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
      note.textContent = countedNote(feed, "disclosure") +
        (dated
          ? " " + late + " of the " + dated + " shown were filed past the 45 days " +
            "the STOCK Act allows, which is the ordinary case rather than the " +
            "exception."
          : "");
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
      note.textContent = countedNote(feed, "holding") + " " +
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
      status.textContent = [
        (isNum(p.filings) || 0) + " disclosure" + (p.filings === 1 ? "" : "s") +
          (w.from ? " filed between " + w.from + " and " + (w.to || "today") : ""),
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
      [notes.unit, notes.lag, notes.size, notes.attribution, notes.refusals]
        .filter(Boolean).forEach(function (text) {
          foot.append(el("p", "flows-foot-p", text));
        });
    }
  }).catch(function (error) {
    if (status) status.textContent = "The disclosure window could not be loaded: " + error.message;
  });
})();
