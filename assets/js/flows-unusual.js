/* =============================================================
   flows-unusual.js — the contract-aggregate feed.

   WHAT THE SOURCE IS, BECAUSE IT DECIDES EVERY STRING BELOW.

   Each row on the wire is one listed strike, carrying a volume
   counter, an open interest, a previous open interest and a
   two-sided quote. There is no size, no timestamp, no execution
   price and no counterparty anywhere in it. shared/flows-unusual.js
   states the two refusals that follow from that, and this file is
   the surface that has to keep them in front of a reader.

   REFUSAL 1 — THE UNIT. The counter is every contract that changed
   hands at that strike, summed. It is not one event. So the words a
   per-execution feed uses are not available to this page, and the
   REFUSED list below is applied to the PAYLOAD'S OWN PROSE as well
   as to the prose written here — see the quarantine.

   REFUSAL 2 — THE DATE, and it is the load-bearing one. The
   endpoint accepts no date and returns none, and the pipeline reads
   it four and a quarter hours before the opening bell, so at read
   time the current date has not happened yet. What the counter
   spans is unobserved. Everything this page stamps is `readAt` —
   when the chain was read — beside `volumeAsOfReason`, which says
   why there is nothing else to stamp. The one date that IS legal is
   the expiry horizon, and it is anchored to `dteAnchor` in writing.

   THE MISSING-VALUE TEST COMES BEFORE THE COERCION, everywhere.
   Number(null) is 0 and 0 is finite, so the naive shape turns an
   absent reading into a confident zero. On this page that would
   print a balanced split where the vendor classified nothing, an
   unchanged open interest where no previous open interest was
   reported, and a notional of zero where no quote existed. Five
   shipped defects in this repo have had exactly that shape.

   HUE IS THE LAST CHANNEL, NEVER THE ONLY ONE. Every signed number
   here carries its sign in a glyph — U+2191/U+2193 for a price move,
   U+002B/U+2212 for a count — before any class is added that CSS may
   tint. U+25B2/U+25BC are NOT in the mono webfont subset and would
   drop to the system stack mid-column, so they are not used.

   NO BAR BEHIND vol/oi. It is the ranking key and the temptation is
   obvious, but on a live chain it spans several powers of ten: a
   fixed axis flattens most of the column to nothing and an axis
   scaled to the visible rows redraws itself every time the list is
   re-ranked. The number is the reading.
   ============================================================= */
(() => {
  "use strict";

  const statusEl = document.getElementById("uaStatus");
  const staleEl = document.getElementById("uaStale");
  const feedPanel = document.getElementById("uaFeedPanel");
  const feedTable = document.getElementById("uaFeed");
  const feedCap = document.getElementById("uaFeedCap");
  const feedBody = document.getElementById("uaFeedBody");
  const feedNote = document.getElementById("uaFeedNote");
  const namePanel = document.getElementById("uaNamePanel");
  const nameCap = document.getElementById("uaNameCap");
  const nameBody = document.getElementById("uaNameBody");
  const nameNote = document.getElementById("uaNameNote");
  const basisPanel = document.getElementById("uaBasisPanel");
  const basisHost = document.getElementById("uaBasis");
  const footEl = document.getElementById("uaFoot");
  if (!statusEl || !feedBody || !nameBody || !basisHost) return;

  const FEED_COLUMNS = 10;           // keep in sync with the <thead> in flows-pages.js
  const NAME_COLUMNS = 7;            // ditto
  const MINUS = "−";            // U+2212, not a hyphen
  const DASH = "—";             // U+2014, the withheld value
  const RANGE = "–";            // U+2013, a range separator and NOT a minus
  const UP = "↑";               // U+2191, in the mono subset
  const DOWN = "↓";             // U+2193, ditto
  const MARK = "*";                  // the truncated-chain marker, ASCII on purpose
  const PAYLOAD_URL = "/api/flows/unusual";

  /* The missing-value test comes BEFORE the coercion. Copied from
     flows-watch.js rather than re-derived: two spellings of this idiom is how
     one of them eventually becomes `Number(v) || 0`. */
  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function cell(text, cls, title) {
    const td = el("td", cls, text);
    if (title) td.title = title;
    return td;
  }

  /* ---------- formatters ------------------------------------------
     Every one of them answers DASH on a missing value and every caller
     attaches a title saying which value was missing and why. A dash with no
     explanation is only marginally better than a zero. */

  /* Counts, with the separator pinned to en-US: the column's alignment
     depends on a uniform character advance, so the reader's locale must not
     be allowed to change it underneath a table of tabular numerals. */
  function count(v) {
    const n = isNum(v);
    return n === null ? DASH : Math.round(n).toLocaleString("en-US");
  }

  function fixed(v, d) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(d);
  }

  /* A ratio against a thirty-day average. 1.00× IS that average, which is
     why the multiplication sign is on the page: "+97%" would invite reading
     a volume ratio as a return. */
  function multiple(v) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(2) + "×";
  }

  /**
   * volume / open interest, across a range no fixed precision fits.
   *
   * The published field is rounded to three decimals, and on a quiet chain
   * the whole column sits between 0.4 and 0.5 — two decimals would collapse
   * the ranking into three distinct values. On a live one the same column
   * reaches into the hundreds, where three decimals is six characters of
   * noise. So the precision follows the magnitude, and the column is the one
   * place on the page where decimals are allowed to vary between rows.
   */
  function ratio(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    const a = Math.abs(n);
    if (a >= 100) return n.toFixed(0);
    if (a >= 10) return n.toFixed(1);
    return n.toFixed(3);
  }

  /* Money at the scale a seven-figure sum is read in. TWO decimals at the
     millions step, not one: the notional column is a BRACKET, and rounding
     2.18M and 2.24M both to "$2.2M" would draw a point number where the whole
     column exists to say there is a range. */
  function money(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    const sign = n < 0 ? MINUS : "";
    const a = Math.abs(n);
    if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(0) + "K";
    return sign + "$" + a.toFixed(0);
  }

  const ROW_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

  /**
   * An instant, rendered from the ISO string rather than through a locale.
   *
   * The ISO date keeps its hyphens: they are part of the date's spelling and
   * are not minus signs. The zone is stated because a bare wall-clock time on
   * a page whose entire subject is "when was this read" would be the same
   * omission the page is built to refuse.
   */
  function instant(iso) {
    const m = ROW_TIME.exec(String(iso === null || iso === undefined ? "" : iso));
    if (!m) return null;
    return m[1] + " " + m[2] + " UTC";
  }

  /* ---------- the vocabulary quarantine ---------------------------

     THE BAN APPLIES TO THE PAYLOAD'S PROSE, NOT ONLY TO THIS FILE'S.

     The basis panel exists to publish the pipeline's own wording beside the
     numbers, and most of it arrives verbatim. But several of those sentences
     are REFUSALS — they name the per-execution vocabulary in order to say
     the source cannot support it — and one of them uses that vocabulary
     outright, having been harvested verbatim from a chain builder. Rendering
     any of them puts the words on the page, where nothing downstream can tell
     a refusal from a claim: not a reader skimming, not a find-in-page, and
     not the test that greps this page's text.

     So the guard sits at the render boundary and is applied to every string
     that reaches the DOM from the payload. A clean string is rendered
     verbatim, which is the common case. A string that trips the guard is
     replaced by this page's own wording for the same content, VISIBLY marked
     as restated, with the count and the affected keys stated in the open and
     the pipeline's unedited sentence one link away in the payload itself.
     Nothing is hidden and nothing is summarised.

     IT FAILS SAFE. A key that trips the guard with no restatement written for
     it renders as a withheld notice rather than as its own text, so a future
     rewording upstream cannot quietly ship the words. That is the whole
     reason the guard is a substring match over a list rather than a fixed
     rewrite of the five sentences that trip it today.

     THE REAL FIX IS UPSTREAM, and this is not it: the strings in
     shared/flows-unusual.js should be reworded so this page can quote them.
     Two of the five trip on ordinary English — a vendor call that was
     "bought", coverage "an order of magnitude" wider — which a word list
     cannot tell from the vocabulary it is aimed at. */

  const REFUSED = [
    "print", "trade", "block", "sweep", "order", "bought", "sold", "paid",
    "whale", "smart money", "institutional", "bullish bet", "bearish bet",
    "aggressive",
    /* The date words belong to the same guard. No payload string carries one
       today; the point is that none ever silently starts to. */
    "today", "this session", "the day's",
  ];

  function refusedIn(text) {
    const hay = String(text === null || text === undefined ? "" : text)
      .toLowerCase().replace(/’/g, "'");
    for (const word of REFUSED) if (hay.includes(word)) return word;
    return null;
  }

  /**
   * This page's wording for the entries whose published wording it cannot
   * quote. Same content, same order of argument, none of the vocabulary.
   */
  const RESTATED = {
    unit: "A contract counter. The vendor reports one row per listed strike " +
      "with a volume total, an open interest and a quote — no size, no " +
      "timestamp, no execution price, no venue marker. It is a sum of the " +
      "contracts that changed hands at that strike, not a record of any one " +
      "of them, and nothing here says who was on either side, or why.",
    aggr: "aggr = ask_volume − bid_volume, in contracts. The vendor classifies " +
      "each contract by the side of the book it met and reports the two counts; " +
      "this is their difference, and it counts contracts rather than dollars.",
    lift: "lift = ask_volume / (ask_volume + bid_volume). The two reported legs " +
      "need not sum to the volume total — this is a share of what the vendor " +
      "classified, not of the whole counter. Absent on either leg it is " +
      "withheld, and never shown as balanced.",
    names: "The contract feed can only cover names whose option chain was read — " +
      "a few dozen. The name panel is built from the screener rows held for " +
      "every eligible name, which is why it exists: ten times that coverage or " +
      "more, for the same zero vendor calls.",
    refusals: "No delta, no probability, no expected value, no fair premium: " +
      "each needs a risk-free rate and a dividend yield, which this desk does " +
      "not invent. No directional-wager language either — a call met at the " +
      "offer is equally a collar leg, a short-stock hedge, a closing purchase " +
      "or a dealer hedge, and this source cannot tell them apart. And no claim " +
      "about who was involved or how well informed they were: the tape carries " +
      "no counterparty identity at any tier.",
  };

  const WITHHELD =
    "This entry is withheld. The pipeline's wording for it uses vocabulary " +
    "this page does not apply to a contract counter, and no restatement has " +
    "been written for it. The sentence itself is in the payload.";

  /** { text, restated } — the string to render, and whether it is ours. */
  function quarantine(key, text) {
    const raw = String(text === null || text === undefined ? "" : text).trim();
    if (!raw) return null;
    if (!refusedIn(raw)) return { text: raw, restated: false };
    const own = RESTATED[key];
    /* The restatement is checked against the same guard it exists to satisfy.
       A restatement that trips is a mistake in this file, and shipping it
       would be worse than shipping nothing. */
    if (own && !refusedIn(own)) return { text: own, restated: true };
    return { text: WITHHELD, restated: true };
  }

  /* ---------- the contract feed -----------------------------------

     THE COLUMN TABLE IS THE ONE PLACE the feed's columns are described, and
     its order is the <thead>'s order in shared/flows-pages.js. Sorting, the
     accessible names and the cells are all driven from it, so a column that
     moves in the markup moves here and nowhere else. */

  const FEED_COLS = [
    { key: "t", name: "Name", first: "asc", val: (r) => (r.t === null || r.t === undefined ? null : String(r.t)) },
    { key: "k", name: "Strike", first: "asc", val: (r) => isNum(r.k) },
    { key: "expiry", name: "Expiry", first: "asc", val: (r) => (r.expiry ? String(r.expiry) : null) },
    { key: "cp", name: "Call or put", first: "asc", val: (r) => (r.cp ? String(r.cp) : null) },
    { key: "vol", name: "Volume", first: "desc", val: (r) => isNum(r.vol) },
    { key: "oi", name: "Open interest", first: "desc", val: (r) => isNum(r.oi) },
    { key: "vor", name: "Volume over open interest", first: "desc", val: (r) => isNum(r.vor) },
    { key: "doi", name: "Open-interest change", first: "desc", val: (r) => isNum(r.doi) },
    { key: "lift", name: "Offer-side share", first: "desc", val: (r) => isNum(r.lift) },
    /* THE BRACKET SORTS ON ITS LOW END, and the choice is stated in the
       feed's note rather than left for a reader to reverse-engineer from two
       rows that swapped. Both ends are null together, so sorting on either
       partitions the same rows out. */
    { key: "nlo", name: "Notional bracket", first: "desc", val: (r) => isNum(r.nlo) },
  ];

  /**
   * One comparison, with the null branch OUTSIDE the direction.
   *
   * AN UNMEASURED VALUE NEVER WINS A RANKING, in either direction. The naive
   * shape multiplies the whole comparison by the direction, which lands every
   * withheld row at the top the moment a reader reverses the column — and a
   * page whose first screen is nine em dashes has answered a question about
   * the vendor's reporting with a table that looks like a ranking. Ties fall
   * through to the published rank, so a column of equal values keeps the
   * order the pipeline gave it rather than the order the sort happened to
   * leave it in.
   */
  function compare(a, b, col, dir) {
    const x = col.val(a.r), y = col.val(b.r);
    if (x === null && y === null) return a.i - b.i;
    if (x === null) return 1;
    if (y === null) return -1;
    let d;
    if (typeof x === "string" || typeof y === "string") {
      const sx = String(x), sy = String(y);
      d = sx < sy ? -1 : sx > sy ? 1 : 0;
    } else {
      d = x - y;
    }
    if (d === 0) return a.i - b.i;
    return dir === "asc" ? d : -d;
  }

  /* Four states, not two: lifted, met at the bid, balanced, and unreported.
     The last two look alike to any renderer that only asks `n > 0`, and they
     are the pair this whole page exists to keep apart. */
  function liftCell(row) {
    const n = isNum(row.lift);
    const aggr = isNum(row.aggr);
    if (n === null) {
      return cell(DASH, "c-num ua-unreported",
        "The vendor classified neither leg of this contract, so no share can be " +
        "taken of it. That is not a balanced split — it is no report at all, and " +
        "the two are different facts.");
    }
    const parts = [
      (n * 100).toFixed(1) + "% of the contracts the vendor classified met the offer.",
      "The classified legs need not sum to the volume counter, so this is a share " +
      "of that subset and not of the whole.",
    ];
    if (aggr !== null) {
      parts.push(aggr === 0
        ? "Offer side and bid side were equal, at " + count(Math.abs(aggr)) + " contracts apart."
        : "Offer side less bid side: " + (aggr > 0 ? "+" : MINUS) + count(Math.abs(aggr)) +
          " contracts.");
    }
    /* NO CLASS AND NO GLYPH ON THIS COLUMN, deliberately. A share above a half
       means more contracts met the offer than rested at the bid, and tinting
       that green is the exact inference the basis panel refuses: the same
       contract is equally a collar leg, a hedge or a closing purchase. The
       number is reported; the reading is not supplied. */
    return cell((n * 100).toFixed(1) + "%", "c-num", parts.join(" "));
  }

  /* A settlement-to-settlement change in open interest. Zero is a MEASURED
     zero here and keeps full contrast; a dash is the vendor not reporting a
     previous open interest, and is dimmed because it is already saying so. */
  function doiCell(row) {
    const n = isNum(row.doi);
    if (n === null) {
      return cell(DASH, "c-num ua-unreported",
        "The vendor reported no previous open interest for this contract, so the " +
        "change across the settlement is unknown. It is not an unchanged open interest.");
    }
    const r = Math.round(n);
    const body = Math.abs(r).toLocaleString("en-US");
    if (r === 0) {
      return cell("0", "c-num ua-flat",
        "Open interest was the same at both settlements. Measured, and it was zero.");
    }
    /* THE SIGN IS IN THE GLYPH FIRST and the class is last, so the column
       survives greyscale, a colour-blind reader and a printout. No arrow: an
       arrow on this column reads as a direction, and a rise in open interest
       says contracts stuck between two settlements without saying on which
       side anybody was. */
    return cell((r > 0 ? "+" : MINUS) + body,
      "c-num " + (r > 0 ? "fb-pos" : "fb-neg"),
      (r > 0
        ? body + " more contracts were open at this strike at the later settlement."
        : body + " fewer contracts were open at this strike at the later settlement.") +
      " It does not say which side anyone was on.");
  }

  /* The bracket, both ends or neither. Half a bracket is not a narrower
     bracket, it is an unbounded one, and the builder nulls the pair together
     for that reason — this cell asserts the same thing rather than trusting
     it. */
  function notionalCell(row) {
    const lo = isNum(row.nlo), hi = isNum(row.nhi);
    if (lo === null || hi === null) {
      return cell(DASH, "c-num ua-unreported",
        "One side of the quote was missing when the chain was read, so there is no " +
        "bracket. Half a bracket would not be a narrower one.");
    }
    const td = cell("", "c-num");
    td.append(el("span", "ua-range", money(lo) + " " + RANGE + " " + money(hi)));
    td.title = "Between " + count(lo) + " and " + count(hi) + " US dollars: the volume " +
      "counter times each side of the quote, times 100 shares. The quote is the one " +
      "standing when the chain was read and the counter carries no date of its own, " +
      "so this is a scale for the money involved and not a bound on it in either direction.";
    return td;
  }

  /**
   * The name cell, and the rule for when it is a link.
   *
   * A NAME IS LINKED ONLY IF ITS CHAIN WAS READ. /flows/ticker/ draws panels
   * out of a published card, and a card exists for exactly the names whose
   * chain the pipeline bought — which is what `coverage` enumerates. Every
   * row in this feed came from one of those chains, so the feed links all of
   * them; the name panel below is drawn from the whole screened universe,
   * where most names have no card and a link would usually lead nowhere.
   */
  function nameCell(row, covered, marked) {
    const th = el("th", "fb-tk");
    th.scope = "row";
    const ticker = String(row.t === null || row.t === undefined ? "" : row.t);
    if (ticker && covered) {
      const link = el("a", null, ticker);
      link.href = "/flows/ticker/?t=" + encodeURIComponent(ticker);
      th.append(link);
    } else {
      const span = el("span", ticker ? "ua-unlinked" : "ua-unreported", ticker || DASH);
      if (ticker) {
        span.title = "This name's option chain is not among the ones read, so there is " +
          "no name page for it.";
      }
      th.append(span);
    }
    if (marked) {
      const sup = el("sup", "ua-mark", MARK);
      sup.title = "The vendor filled its page limit on this name's chain, so what this " +
        "feed sees of it is a subset of its own book — and nothing here says which " +
        "subset, or how large the rest is.";
      th.append(sup);
    }
    return th;
  }

  function feedRow(row, ctx) {
    const tr = document.createElement("tr");
    const ticker = String(row.t === null || row.t === undefined ? "" : row.t);
    tr.append(nameCell(row, ctx.covered.has(ticker), isNum(row.p) === 1));

    tr.append(cell(fixed(row.k, 2), "c-num",
      isNum(row.k) === null ? "The strike could not be read from the contract symbol." : ""));

    /* THE ONE DATE THIS PAGE IS ALLOWED TO ANCHOR, and it says what it is
       anchored to. The horizon is measured from the last completed session
       rather than from the counter — which has no date — or from the moment
       the reader opened the page. */
    const dte = isNum(row.dte);
    const expiry = row.expiry ? String(row.expiry) : DASH;
    const anchor = ctx.anchorDate
      ? " counted from " + ctx.anchorDate + ", the last completed session, which is what " +
        "dteAnchor names"
      : "";
    tr.append(cell(expiry, "", dte === null
      ? "The horizon to expiry could not be measured."
      : count(dte) + " calendar days to expiry" + anchor + "."));

    const cp = String(row.cp || "");
    tr.append(cell(cp || DASH, cp ? "ua-cp" : "ua-cp ua-unreported",
      cp === "C" ? "Call." : cp === "P" ? "Put." :
        "The contract symbol did not say whether this is a call or a put."));

    tr.append(cell(count(row.vol), "c-num", ctx.volTitle));
    tr.append(cell(count(row.oi), "c-num",
      "Open interest as the vendor reported it on this response. Undated, like the counter."));

    const vor = isNum(row.vor);
    tr.append(cell(ratio(row.vor), "c-num ua-vor", vor === null
      ? "The ranking key could not be formed for this contract."
      : "The volume counter is " + ratio(row.vor) + " times the open interest beside it. " +
        "A ratio of two counts, and the key this feed is ranked by."));

    tr.append(doiCell(row));
    tr.append(liftCell(row));
    tr.append(notionalCell(row));

    /* Implied volatility has no column — it is a per-chain convention and
       reads DOWN a name rather than ACROSS a table of many. It rides on the
       row's title instead, with its own name's divisor beside it, so it is
       readable without ever being sortable or comparable between rows. */
    const iv = isNum(row.iv);
    const cov = ctx.coverage.get(ticker);
    if (iv !== null) {
      tr.title = "Implied volatility on this contract: " + (iv * 100).toFixed(1) + "%" +
        (cov && cov.ivBasis ? ", on this name's own convention (" + cov.ivBasis + ")" : "") +
        ". It reads down this name and not across the table.";
    }
    return tr;
  }

  /* ---------- sorting ----------------------------------------------

     A REAL <button> INSIDE THE <th>, following flows-board.js: it buys
     keyboard operability and a focus ring for free and states honest
     semantics, where a click handler on a header cell is unreachable by
     keyboard and announces nothing. The header's own children — including the
     <abbr> that explains what the column means — move INTO the button, so
     being able to sort a column never costs the reader its explanation. */

  const feedSort = { key: null, dir: "desc" };
  let feedRows = [];                 // [{ r, i }] in the published rank
  let feedCtx = null;
  let headCells = [];

  function paintFeedRows() {
    const col = feedSort.key ? FEED_COLS.find((c) => c.key === feedSort.key) : null;
    const view = col
      ? feedRows.slice().sort((a, b) => compare(a, b, col, feedSort.dir))
      : feedRows;
    feedBody.textContent = "";
    const frag = document.createDocumentFragment();
    for (const entry of view) frag.append(feedRow(entry.r, feedCtx));
    feedBody.append(frag);
  }

  /**
   * aria-sort on every header, every time.
   *
   * It is the only thing that tells a screen reader the table re-ranked. The
   * glyph is decoration; the attribute is the state. Every header that is not
   * the current one is explicitly set back to "none" rather than left as it
   * was, because a stale attribute announces two sorted columns and there is
   * only ever one.
   */
  function syncHeads() {
    headCells.forEach((th, i) => {
      const col = FEED_COLS[i];
      const button = th.querySelector(".fb-sort");
      if (!col || !button) { th.removeAttribute("aria-sort"); return; }
      const on = feedSort.key === col.key;
      th.setAttribute("aria-sort", on ? (feedSort.dir === "asc" ? "ascending" : "descending") : "none");
      const ind = button.querySelector(".fb-sort-ind");
      if (ind) ind.textContent = on ? (feedSort.dir === "asc" ? UP : DOWN) : "";
      /* THE ACCESSIBLE NAME IS SPELLED OUT rather than scraped from the
         header: "Vol/OI: activate to sort" names nothing a reader can act on,
         and half these headings are abbreviations. */
      button.setAttribute("aria-label", col.name + ": " + (on
        ? "ranked " + (feedSort.dir === "asc" ? "ascending" : "descending") +
          ", activate to " + (feedSort.dir === col.first
            ? "reverse" : "return to the published rank")
        : "activate to rank by this column"));
    });
  }

  /**
   * Click through: the column's natural direction, then its reverse, then
   * back to the rank the pipeline published.
   *
   * THE PUBLISHED RANK MUST BE RECOVERABLE. It is the one ordering this page
   * exists to show — vol/oi, stated as a choice in the basis panel — and a
   * table that can be ranked away from it with no way back has thrown away
   * its own answer.
   */
  function toggleSort(key) {
    const col = FEED_COLS.find((c) => c.key === key);
    if (!col) return;
    if (feedSort.key !== key) { feedSort.key = key; feedSort.dir = col.first; }
    else if (feedSort.dir === col.first) { feedSort.dir = col.first === "desc" ? "asc" : "desc"; }
    else { feedSort.key = null; feedSort.dir = "desc"; }
    syncHeads();
    paintFeedRows();
  }

  function wireHeads() {
    if (!feedTable) return;
    headCells = Array.from(feedTable.querySelectorAll("thead th"));
    if (headCells.length !== FEED_COLUMNS) return;   // markup moved; leave it unsorted
    headCells.forEach((th, i) => {
      const col = FEED_COLS[i];
      if (!col) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fb-sort";
      while (th.firstChild) button.append(th.firstChild);
      const ind = el("span", "fb-sort-ind");
      ind.setAttribute("aria-hidden", "true");
      button.append(ind);
      button.addEventListener("click", () => toggleSort(col.key));
      th.append(button);
    });
    syncHeads();
  }

  /* ---------- the name panel --------------------------------------- */

  /* A price move, with the arrow first. The glyph carries the sign, U+2212
     carries it again in the number, and the class — which is the only part a
     colour-blind reader loses — is last. A measured zero gets neither arrow
     nor sign: no direction is true at zero. */
  function changeCell(v) {
    const n = isNum(v);
    if (n === null) {
      return cell(DASH, "c-num ua-unreported",
        "No prior close was reported for this name, so the move is unknown. It is not zero.");
    }
    const body = (Math.abs(n) * 100).toFixed(2) + "%";
    if (n === 0) return cell("0.00%", "c-num ua-flat", "Measured, and the close was unchanged.");
    return cell((n > 0 ? UP : DOWN) + (n > 0 ? "" : MINUS) + body,
      "c-num " + (n > 0 ? "fb-pos" : "fb-neg"),
      "A fraction of the prior close.");
  }

  function surpriseCell(v, what) {
    const n = isNum(v);
    if (n === null) {
      return cell(DASH, "c-num ua-unreported",
        "This name's thirty-day average " + what + " was missing, so the ratio is " +
        "withheld. It is not an average day.");
    }
    return cell(multiple(n), "c-num",
      n.toFixed(2) + " times this name's own thirty-day average " + what + ". It compares " +
      "the name with itself, and with no other name.");
  }

  function nameRow(row, covered) {
    const tr = document.createElement("tr");
    tr.append(nameCell(row, covered.has(String(row.t || "")), false));
    tr.append(cell(fixed(row.px, 2), "c-num",
      isNum(row.px) === null ? "No close was reported for this name." : ""));
    tr.append(changeCell(row.chg));
    tr.append(surpriseCell(row.st, "call and put volume together"));
    tr.append(surpriseCell(row.sc, "call volume"));
    tr.append(surpriseCell(row.sp, "put volume"));
    tr.append(cell(fixed(row.putCallRatio, 2), "c-num",
      isNum(row.putCallRatio) === null
        ? "The vendor reported no put/call ratio for this name."
        : "The vendor's own put/call ratio, passed through."));
    return tr;
  }

  /* ---------- the basis panel --------------------------------------

     THE PAGE'S HONESTY, AND NOT AN APPENDIX. Every methodological decision
     the feed makes is published in the payload beside the arithmetic that
     produced it, which is what stops a renderer rewording a caption into a
     claim the numbers do not support. It is rendered here in full.

     THE TWO REFUSALS STAY IN THE OPEN and everything else sits behind a
     disclosure. Not to hide it — it is in the DOM, selectable, and found by a
     find-in-page — but because eight hundred words of unbroken prose under
     two tables is a rule nobody finishes reading, and a rule nobody finishes
     is a rule nobody was told. */

  const BASIS_LABELS = {
    unit: "The unit",
    date: "The date, and why there is not one",
    rank: "The ranking key",
    floors: "The floors",
    aggr: "aggr — the two classified legs",
    lift: "lift — the offer-side share",
    notional: "notional — the bracket",
    iv: "iv — implied volatility",
    oi: "oi — open interest",
    zeroOi: "Strikes that never arrive",
    names: "Two panels, two populations",
    refusals: "What this page will not compute",
  };

  const CHOICE_LABELS = {
    key: "key",
    relation: "relation",
    minVolume: "minimum volume",
    minOi: "minimum open interest",
    perName: "most contracts from one name",
  };

  const BASIS_GROUPS = [
    { keys: ["unit", "date"], open: true },
    { keys: ["rank", "floors"], summary: "The choices this page makes" },
    { keys: ["aggr", "lift", "notional", "iv", "oi", "zeroOi"], summary: "How each column is built" },
    { keys: ["names", "refusals"], summary: "What is counted, and what is refused" },
  ];

  function restatedTag() {
    const tag = el("span", "ua-restated", "restated");
    tag.title = "The pipeline's sentence for this entry names the vocabulary this page " +
      "does not apply to a contract counter. Repeating it here, even to refuse it, " +
      "would put those words on the page — so the page states the same content in its " +
      "own words. The unedited sentence is in the payload.";
    return tag;
  }

  /** A plain statement: a label, the prose, and the marker if it is ours. */
  function basisItem(key, value) {
    const said = quarantine(key, value);
    if (!said) return null;
    const box = el("div", "ua-b-item");
    const head = el("p", "ua-b-k", BASIS_LABELS[key] || key);
    if (said.restated) head.append(restatedTag());
    box.append(head);
    box.append(el("p", "ua-b-p", said.text));
    return box;
  }

  /**
   * A LABELLED CHOICE, drawn to look unlike a statement.
   *
   * `choice: true` on the wire means the pipeline is telling the reader that
   * this could defensibly have been decided otherwise — the ranking key could
   * have been the notional bracket or raw volume, and the floors are the
   * boundary of a population rather than a threshold on a measurement.
   * Rendering that as one more paragraph of method would bury the single most
   * arguable thing on the page in the least arguable-looking place.
   */
  function basisChoice(key, obj) {
    const box = el("div", "ua-choice");
    box.append(el("p", "ua-choice-tag", "A choice — " + (BASIS_LABELS[key] || key)));

    /* Every field except the flag and the prose, in the order the payload
       sends them, so a field added upstream appears here without an edit. */
    const defs = el("dl", "ua-defs");
    let any = false;
    for (const field of Object.keys(obj)) {
      if (field === "choice" || field === "reason") continue;
      const v = obj[field];
      if (v === null || v === undefined || typeof v === "object") continue;
      defs.append(el("dt", null, CHOICE_LABELS[field] || field));
      defs.append(el("dd", null, typeof v === "number" ? count(v) : String(v)));
      any = true;
    }
    if (any) box.append(defs);

    const said = quarantine(key, obj.reason);
    if (said) {
      const p = el("p", "ua-b-p", said.text);
      if (said.restated) p.prepend(restatedTag());
      box.append(p);
    }
    return box;
  }

  function basisEntry(key, value) {
    if (value && typeof value === "object" && value.choice === true) {
      return basisChoice(key, value);
    }
    if (value && typeof value === "object") {
      /* An object with no choice flag: render its own prose if it has any,
         rather than dropping a key the payload published. */
      return basisItem(key, value.reason || value.line || JSON.stringify(value));
    }
    return basisItem(key, value);
  }

  function paintBasis(basis) {
    basisHost.textContent = "";
    if (!basis || typeof basis !== "object") {
      basisHost.append(el("p", "fc-note",
        "This payload carried no basis block, so the page cannot say how its own " +
        "numbers were built. Treat everything above as unexplained."));
      if (basisPanel) basisPanel.hidden = false;
      return;
    }

    /* THE COUNT IS TAKEN BEFORE ANYTHING IS DRAWN, so the notice can name how
       many entries were restated and which ones, rather than a reader having
       to find the markers by scrolling. */
    const restated = Object.keys(basis).filter((k) => {
      const v = basis[k];
      const text = v && typeof v === "object" ? (v.reason || v.line || "") : v;
      return !!refusedIn(text);
    });
    if (restated.length) {
      const notice = el("p", "ua-quarantine");
      notice.append(document.createTextNode(
        restated.length + " of the " + Object.keys(basis).length + " entries below (" +
        restated.join(", ") + ") are this page's own wording rather than the " +
        "pipeline's, and are marked. The pipeline writes them using the vocabulary " +
        "this page does not apply to a contract counter — mostly in order to refuse " +
        "it — and putting those words on the page is exactly what the refusal " +
        "forbids. The content is unchanged. The unedited sentences are in "));
      const link = el("a", null, "the payload itself");
      link.href = PAYLOAD_URL;
      notice.append(link);
      notice.append(document.createTextNode("."));
      basisHost.append(notice);
    }

    const drawn = new Set();
    for (const group of BASIS_GROUPS) {
      const items = [];
      for (const key of group.keys) {
        if (!Object.prototype.hasOwnProperty.call(basis, key)) continue;
        const node = basisEntry(key, basis[key]);
        drawn.add(key);
        if (node) items.push(node);
      }
      if (!items.length) continue;
      if (group.open) {
        const open = el("div", "ua-spine");
        for (const node of items) open.append(node);
        basisHost.append(open);
      } else {
        const box = el("details", "ua-how");
        box.append(el("summary", "ua-how-s", group.summary));
        for (const node of items) box.append(node);
        basisHost.append(box);
      }
    }

    /* ANY KEY THE PAYLOAD ADDS LATER STILL REACHES THE READER. A basis block
       that grows a thirteenth entry must not lose it to a hardcoded group
       list — that is precisely how four published panels went undrawn for a
       month elsewhere in this product. */
    const extra = Object.keys(basis).filter((k) => !drawn.has(k));
    if (extra.length) {
      const box = el("details", "ua-how");
      box.append(el("summary", "ua-how-s", "Also published in the basis"));
      for (const key of extra) {
        const node = basisEntry(key, basis[key]);
        if (node) box.append(node);
      }
      basisHost.append(box);
    }
    if (basisPanel) basisPanel.hidden = false;
  }

  /* ---------- states ------------------------------------------------ */

  function emptyRow(body, columns, text) {
    body.textContent = "";
    const tr = document.createElement("tr");
    const td = el("td", "flows-empty", text);
    td.colSpan = columns;
    tr.append(td);
    body.append(tr);
  }

  /**
   * Every panel says what happened.
   *
   * A FAILED FETCH MUST NOT LEAVE A PANEL ON "Loading…" — a spinner that
   * never resolves is indistinguishable from a slow one, and a reader waits
   * for a page that has already given up. The panels are unhidden precisely
   * so each can carry the failure.
   */
  function failEverywhere(what) {
    statusEl.textContent = what;
    emptyRow(feedBody, FEED_COLUMNS, what);
    emptyRow(nameBody, NAME_COLUMNS, what);
    if (feedCap) feedCap.textContent = "No contract could be listed.";
    if (nameCap) nameCap.textContent = "No name could be listed.";
    if (feedNote) feedNote.textContent = "";
    if (nameNote) nameNote.textContent = "";
    basisHost.textContent = "";
    basisHost.append(el("p", "fc-note", what));
    if (feedPanel) feedPanel.hidden = false;
    if (namePanel) namePanel.hidden = false;
    if (basisPanel) basisPanel.hidden = false;
    if (footEl) footEl.textContent = "";
  }

  /* ---------- paint -------------------------------------------------- */

  function paint(payload) {
    const contracts = payload.contracts && typeof payload.contracts === "object"
      ? payload.contracts : {};
    const names = payload.names && typeof payload.names === "object" ? payload.names : {};
    const rows = Array.isArray(contracts.rows) ? contracts.rows : [];
    const nameRows = Array.isArray(names.rows) ? names.rows : [];
    const coverage = new Map();
    for (const c of Array.isArray(payload.coverage) ? payload.coverage : []) {
      if (c && c.t) coverage.set(String(c.t), c);
    }

    const readAt = instant(payload.readAt);
    const reason = payload.volumeAsOfReason
      ? String(payload.volumeAsOfReason)
      : "the endpoint publishes no as-of stamp";
    const anchorDate = payload.dteAnchor === "sessionDate" && payload.sessionDate
      ? String(payload.sessionDate) : null;

    feedCtx = {
      coverage,
      covered: new Set(coverage.keys()),
      anchorDate,
      volTitle: "The vendor's volume counter for this strike: every contract that " +
        "changed hands there, summed. It carries no date — " + reason + ".",
    };

    /* ---- the status strip ---- */
    const shown = isNum(contracts.shown);
    const eligible = isNum(contracts.eligible);
    const cap = isNum(contracts.cap);
    const perName = isNum(contracts.perName);
    const distinct = new Set(rows.map((r) => String(r.t || ""))).size;
    const namesSeen = isNum(payload.namesSeen);
    const truncated = isNum(payload.namesTruncated);
    const complete = isNum(payload.namesComplete);

    /* WHICH CAP BOUND THE LIST, NAMED. A reader looking at "50 shown" against
       "50 eligible" cannot tell whether the list stopped because it filled,
       because one name was not allowed to contribute more, or because that is
       simply every contract that cleared the floors. The payload settles it
       and the strip says which. */
    let bound;
    if (contracts.capBound === "rows") {
      bound = "The " + (cap === null ? "row" : count(cap) + "-row") +
        " cap is what bound this list" +
        (perName === null ? "" : ", with at most " + count(perName) + " from any one name");
    } else if (contracts.capBound === "perName") {
      bound = "The per-name allowance of " + (perName === null ? "one" : count(perName)) +
        " is what bound this list; the " + (cap === null ? "row cap" : count(cap) + "-row cap") +
        " was never reached";
    } else if (contracts.capBound === "eligible") {
      bound = "Neither cap bound this list: it is every contract that cleared the floors";
    } else {
      bound = "The payload did not say which cap bound this list";
    }

    const strip = [];
    strip.push((shown === null ? count(rows.length) : count(shown)) + " contracts from " +
      count(distinct) + (distinct === 1 ? " name" : " names") +
      (eligible === null ? "" : ", of " + count(eligible) + " that cleared the floors"));
    strip.push(bound);
    if (namesSeen !== null) {
      strip.push(count(namesSeen) + (namesSeen === 1 ? " chain read" : " chains read") +
        (truncated === null ? "" : truncated === 0
          ? ", all of them whole"
          : ", " + count(truncated) + " of them cut short by the vendor"));
    }
    strip.push(readAt
      ? "chain read " + readAt + ", and the counter carries no date of its own"
      : "the payload published no read time, which is the one stamp this page has");
    statusEl.textContent = strip.join(" · ") + ".";

    /* ---- the contract feed ---- */
    const aggrReported = isNum(contracts.aggressorReported);
    const notionalReported = isNum(contracts.notionalReported);
    const floors = payload.basis && payload.basis.floors ? payload.basis.floors : {};
    const minVolume = isNum(floors.minVolume);
    const minOi = isNum(floors.minOi);
    const conventions = isNum(payload.ivConventionsSeen);

    const capParts = [];
    capParts.push((shown === null ? count(rows.length) : count(shown)) +
      (eligible === null ? " contracts" : " of " + count(eligible) + " contracts") +
      " that cleared the floors" +
      (minVolume === null || minOi === null ? "" :
        " — a volume counter of at least " + count(minVolume) + " and an open interest of " +
        "at least " + count(minOi) + ", both choices and both stated below") + ".");
    if (namesSeen !== null) {
      capParts.push("Drawn from " + count(namesSeen) +
        (namesSeen === 1 ? " chain" : " chains") +
        (complete === null || truncated === null ? "" :
          ": " + count(complete) + " the vendor returned whole and " + count(truncated) +
          " it cut short at its page limit") + ".");
    }
    if (aggrReported !== null && shown !== null) {
      capParts.push(count(aggrReported) + " of " + count(shown) +
        " carry a classified offer-and-bid split" +
        (notionalReported === null ? "" :
          " and " + count(notionalReported) + " of " + count(shown) + " quoted both sides") + ".");
    }
    /* THE CONVENTION WARNING FIRES FROM THE PAYLOAD, not from an assumption
       that one run's chains agreed. Two conventions in one feed means the
       implied volatility on the row titles cannot be compared between names,
       which is a caveat the reader has to be handed rather than left to
       discover in coverage. */
    if (conventions !== null && conventions > 1) {
      capParts.push(count(conventions) + " implied-volatility conventions appear across " +
        "these chains, so that reading cannot be compared between names; each name's " +
        "divisor is in the payload's coverage list.");
    }
    if (feedCap) feedCap.textContent = capParts.join(" ");

    if (feedNote) {
      feedNote.textContent =
        MARK + " marks a contract from a chain the vendor cut short at its page limit: " +
        "that name's contribution is a subset of its own book, and nothing here says " +
        "which subset. An em dash is a value the vendor did not report and never a " +
        "zero — a withheld offer-side share is not a balanced split, and a withheld " +
        "open-interest change is not an unchanged open interest. Notional is a bracket " +
        "between the volume counter times each side of the quote; both ends are " +
        "present or neither is, and the column ranks on the low end. Vol/OI is shown " +
        "as a number with no bar behind it: on a live chain it spans several powers of " +
        "ten and any fixed scale would flatten most of the column into nothing. " +
        "Ranking by a heading re-ranks the list; a third activation returns it to the " +
        "rank the pipeline published.";
    }

    feedRows = rows.map((r, i) => ({ r, i }));
    if (!rows.length) {
      emptyRow(feedBody, FEED_COLUMNS,
        payload.status === "quiet"
          ? "No contract cleared both floors on the chains that were read. That is a " +
            "statement about this run's chains, not about the market."
          : "This payload carried no contract rows.");
    } else {
      wireHeads();
      paintFeedRows();
    }
    if (feedPanel) feedPanel.hidden = false;

    /* ---- the name panel ---- */
    const ranked = isNum(names.ranked);
    const universe = isNum(names.universe);
    const unranked = isNum(names.unranked);
    const gated = isNum(names.earningsGated);
    const nShown = isNum(names.shown);

    const nameParts = [];
    nameParts.push((nShown === null ? count(nameRows.length) : count(nShown)) +
      (ranked === null ? " names" : " of " + count(ranked) + " names") +
      " ranked by call and put volume together against the sum of the same two " +
      "thirty-day averages.");
    if (universe !== null) {
      nameParts.push("The population is every eligible name the screener returned — " +
        count(universe) + " of them" +
        (unranked === null ? "" : ", " + count(unranked) +
          (unranked === 1 ? " without a measurable ratio and left unranked"
                          : " without a measurable ratio and left unranked")) + ".");
    }
    /* THE EARNINGS GATE IS THE BOARD'S, NOT THIS PANEL'S, and the difference
       is worth a sentence: the gate exists to keep event-driven noise out of
       a predictive composite, and this panel is descriptive. A volume surprise
       on a name that reports next week is the least surprising surprise there
       is, and hiding it would be misdescribing the tape. */
    if (gated !== null && gated > 0) {
      nameParts.push(count(gated) + " of them report earnings inside the horizon the " +
        "board's gate excludes. This panel keeps them, because it describes what was " +
        "counted rather than predicting anything from it — but a ratio on one of those " +
        "names is the least surprising number on the page.");
    }
    if (nameCap) nameCap.textContent = nameParts.join(" ");

    if (nameNote) {
      nameNote.textContent =
        "Both, Calls and Puts are ratios against this name's own thirty-day averages: " +
        "1.00× is that average and 2.00× is twice it. They compare a name with itself " +
        "and with no other name, so the same 2.00× on a name that lists two hundred " +
        "contracts and on the largest name in the universe are the same number and not " +
        "the same event. Both is withheld when either average is missing, because a " +
        "zero on one side would inflate the ratio without saying so. P/C is the " +
        "vendor's own put/call ratio, passed through. These names are not the feed's: " +
        "this panel sees every eligible name, the feed above only the ones whose chain " +
        "was read, which is why a name here is usually not a link.";
    }

    if (!nameRows.length) {
      emptyRow(nameBody, NAME_COLUMNS,
        "No name carried both a call and a put thirty-day average, so none could be ranked.");
    } else {
      const frag = document.createDocumentFragment();
      for (const r of nameRows) frag.append(nameRow(r, feedCtx.covered));
      nameBody.append(frag);
    }
    if (namePanel) namePanel.hidden = false;

    /* ---- the basis, and the foot ---- */
    paintBasis(payload.basis);

    if (footEl) {
      footEl.textContent = "";
      const built = instant(payload.generatedAt);
      const bits = [];
      bits.push(readAt ? "The chain was read at " + readAt + "." : "");
      bits.push("volumeAsOf is null: " + reason + ", so the span the counter covers is " +
        "unobserved and this page stamps only when it was read.");
      if (anchorDate) {
        bits.push("Days to expiry are counted from " + anchorDate + ", the last completed " +
          "session, which is what dteAnchor names.");
      }
      if (built) bits.push("Built " + built + (isNum(payload.v) === null ? "" : ", payload v" + count(payload.v)) + ".");
      footEl.append(document.createTextNode(bits.filter(Boolean).join(" ") + " "));
      const link = el("a", null, "The whole payload, including the pipeline's own wording");
      link.href = PAYLOAD_URL;
      footEl.append(link);
      footEl.append(document.createTextNode("."));
    }
  }

  /* ---------- fetch --------------------------------------------------- */

  fetch(PAYLOAD_URL, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then((response) => {
    /* THE SESSION IS GONE, so the reader goes to the door rather than to an
       error. Every other status is a fact about this page and is shown on it. */
    if (response.status === 401) { location.replace("/flows/"); return null; }
    if (!response.ok) throw new Error("HTTP " + response.status);
    const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
    return response.json().then((payload) => {
      if (payload && typeof payload === "object") payload.__updatedAt = updatedAt;
      return payload;
    });
  }).then((payload) => {
    if (!payload) return;

    /* PENDING IS THE ORDINARY STATE BEFORE THE FIRST RUN, and it is a fact
       about the store rather than an error. The panels stay hidden: there is
       nothing to say in them, and an empty table with a caption reads as a
       measurement that came back empty. */
    if (payload.status === "pending") {
      statusEl.textContent = "The pipeline has not published this key yet. This feed is " +
        "built from the option chains the run already reads for each board name, so it " +
        "appears with the first pipeline run after it shipped.";
      return;
    }

    paint(payload);

    /* THE SAME STALENESS RULE THE BOARD AND THE WATCH LIST USE, said in this
       page's terms: what went stale here is the READ, and calling it anything
       else would date a counter the endpoint refuses to date. */
    if (staleEl && payload.__updatedAt) {
      const ageHours = (Date.now() - payload.__updatedAt) / 3600000;
      if (ageHours > 30) {
        staleEl.hidden = false;
        staleEl.textContent = "This feed was last written " +
          Math.round(ageHours / 24) + " day(s) ago. The pipeline has not published " +
          "since, so these counters are from that read and not from a later one.";
      }
    }
  }).catch((error) => {
    failEverywhere("The feed could not be loaded (" + (error && error.message
      ? error.message : "no message") + "). Nothing on this page was measured; refresh " +
      "to try again.");
  });
})();
