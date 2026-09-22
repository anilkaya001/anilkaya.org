(function () {
  "use strict";

  var MINUS = "−";
  var DASH = "—";

  var FRESH = "•";

  function cardKey(t) {
    return String(t === null || t === undefined ? "" : t).toUpperCase().replace(/[.\-\s]/g, "");
  }

  function isNum(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v !== "string") return null;
    if (v.trim() === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
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
    var n = el(tag, "flows-empty " + cls, text);
    n.setAttribute("data-empty", kind);
    return n;
  }

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

  function ownerNote(rows, unit) {

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

  function freshNote(p, drawn, subject) {
    if (!p.latestFiled) return "";

    var when = "";
    if (p.sessionDate) {
      when = p.sessionDate === p.latestFiled
        ? ", which is the last completed session"
        : (p.latestFiled < p.sessionDate
          ? ", which is before the last completed session on " + p.sessionDate
          : ", which is after the last completed session on " + p.sessionDate);
    }

    var what = subject || "filed on";

    if (!drawn) {
      return "The newest disclosure date in this window is " + p.latestFiled + when +
        ", and no row drawn here carries it, so nothing below is marked new.";
    }
    return FRESH + " marks the " + drawn + " row" + (drawn === 1 ? "" : "s") +
      " " + what + " " + p.latestFiled + ", the newest disclosure date in this window" +
      when + ".";
  }

  function tickerCell(t, carded, cls) {
    var text = t === null || t === undefined ? DASH : String(t);
    if (!carded || !t || !carded.has(cardKey(t))) return el("span", cls, text);
    var a = el("a", cls, text);
    a.href = "/flows/ticker/?t=" + encodeURIComponent(cardKey(t));
    a.title = "Open the detail card the board published for " + text + ".";
    return a;
  }

  function cardedSet(p) {
    if (!Array.isArray(p.carded)) return null;
    var set = new Set();
    for (var i = 0; i < p.carded.length; i++) set.add(cardKey(p.carded[i]));
    return set;
  }

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

  function countedNote(feed, unit, cut) {
    var seen = isNum(feed.seen), shed = isNum(feed.shed);
    if (seen === null) return "";
    if (!shed) return seen + " " + unit + (seen === 1 ? "" : "s") + " in the window.";
    return "Top " + feed.rows.length + " of " + seen + " " + unit + "s in the window; " +
      shed + " " + (cut || "ranked below the cut") + " and are not drawn.";
  }

  function paintAssets(p) {
    var panel = document.getElementById("plAssetsPanel");
    var host = document.getElementById("plAssets");
    if (!panel || !host) return;
    panel.hidden = false;
    host.textContent = "";
    var feed = p.assets;
    var carded = cardedSet(p);

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
      host.append(note);
    }

    paintClusters(p, host, carded);
  }

  function paintClusters(p, host, carded) {
    var feed = p.clusters;
    if (!feed) return;
    var box = el("div", "pl-clusters");

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

    var shownFloor = isNum(feed.minFilers);
    var cleared = isNum(feed.seen), pool = isNum(feed.namesSeen);
    box.append(el("p", "fc-note",
      (isNum(feed.shed) || pool === null || cleared === null
        ? countedNote(feed, "name", "drew fewer filers")
        : cleared + " of the " + pool + " names in the window clear" +
          (cleared === 1 ? "s" : "") + " the floor.") + " " +
      (shownFloor === null
        ? "This payload does not state the floor these rows cleared, so the ordering is " +
          "drawn without it. "
        : "The floor is " + shownFloor + " separate filers, stated rather than tuned" +
          (shownFloor === 2
            ? ": two is the smallest number that could be called convergence at all, and " +
              "on a market-wide window a great many names collect two by coincidence. "
            : ", above the two that coincidence alone supplies on a market-wide window. ")) +
      "Nothing here blends breadth with size into a single figure — each key breaks ties " +
      "in the one before it, so the order can be checked by eye against the columns."));
    host.append(box);
  }

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

      tr.append(td(r.executedBy === null || r.executedBy === undefined
        ? "not stated" : r.executedBy,
        "pl-owner" + (r.executedBy === null || r.executedBy === undefined
          ? " is-unknown" : "")));
      var nameCell = el("td", "pl-who");
      nameCell.append(tickerCell(r.t, carded, "pl-tick"));

      var described = r.asset || r.notes;
      if (described) nameCell.append(el("span", "pl-asset", String(described)));
      tr.append(nameCell);

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

  function bandText(r) {
    var lo = isNum(r.lo), hi = isNum(r.hi);
    if (lo !== null && hi !== null) return usd(lo) + " – " + usd(hi);
    if (lo !== null) return "over " + usd(lo);
    if (isNum(r.mid) !== null) return usd(r.mid);
    return DASH;
  }

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

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 401) { location.replace("/flows/"); return null; }
        if (!r.ok) throw new Error("HTTP " + r.status);

        var at = Number(r.headers.get("X-Payload-Updated"));
        return r.json().then(function (body) {
          if (body && typeof body === "object") body.__updatedAt = at > 0 ? at : null;
          return body;
        });
      });
  }

  var status = document.getElementById("plStatus");

  function renderStale(updatedAt) {
    var band = document.getElementById("plStale");
    if (!band || !updatedAt) return;
    var ageHours = (Date.now() - updatedAt) / 3600000;
    if (ageHours <= 30) return;
    var days = Math.round(ageHours / 24);
    band.hidden = false;
    band.textContent = "This disclosure window was last written " + days + " " +
      (days === 1 ? "day" : "days") + " ago. The pipeline has not published since, so " +
      "the newest filing here is the newest as of that run, not as of today.";
    document.body.classList.add("is-stale");
  }

  get("/api/flows/political").then(function (p) {
    if (!p) return;

    if (p.status === "pending" || (!p.buyers && !p.holders)) {
      if (status) {
        status.textContent = "No disclosure window has been read yet. This page " +
          "appears with the first pipeline run after it shipped.";
        status.dataset.empty = "pending";
      }
      return;
    }

    renderStale(p.__updatedAt);
    paintBuyers(p);
    paintAssets(p);
    paintRecent(p);
    paintHolders(p);

    if (status) {
      var w = p.window || {}, src = p.source || {};

      var pages = isNum(src.pages);

      var how = src.route
        ? "via " + src.route + (pages !== null
            ? ", " + pages + " page" + (pages === 1 ? "" : "s") + " deep" : "")
        : "";

      var freshCount = isNum(p.freshFilings);

      var filings = isNum(p.filings);
      var filedWhen = w.from ? " filed between " + w.from + " and " + (w.to || "today") : "";
      status.textContent = [
        filings === null
          ? (filedWhen ? "Disclosures" + filedWhen : "")
          : filings + " disclosure" + (filings === 1 ? "" : "s") + filedWhen,
        freshCount !== null && p.latestFiled
          ? freshCount + " of them on " + p.latestFiled + ", the newest filing date here"
          : "",
        how,
        isNum(p.unusable) && p.unusable
          ? p.unusable + " carried no filer or name and were dropped" : "",
        p.readAt ? "read " + new Date(p.readAt).toLocaleString() : "",
      ].filter(Boolean).join(" · ");
    }

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
