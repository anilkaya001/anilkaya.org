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

  const FEED_COLUMNS = 10;
  const NAME_COLUMNS = 7;
  const MINUS = "−";
  const DASH = "—";
  const RANGE = "–";
  const UP = "↑";
  const DOWN = "↓";
  const MARK = "*";
  const PAYLOAD_URL = "/api/flows/unusual";

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

  function count(v) {
    const n = isNum(v);
    return n === null ? DASH : Math.round(n).toLocaleString("en-US");
  }

  function fixed(v, d) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(d);
  }

  function multiple(v) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(2) + "×";
  }

  function ratio(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    const a = Math.abs(n);
    if (a >= 100) return n.toFixed(0);
    if (a >= 10) return n.toFixed(1);
    return n.toFixed(3);
  }

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

  function instant(iso) {
    const m = ROW_TIME.exec(String(iso === null || iso === undefined ? "" : iso));
    if (!m) return null;
    return m[1] + " " + m[2] + " UTC";
  }

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

    { key: "nlo", name: "Notional bracket", first: "desc", val: (r) => isNum(r.nlo) },
  ];

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
        : "Offer side less bid side: " + (aggr > 0 ? "+" : aggr < 0 ? MINUS : "") + count(Math.abs(aggr)) +
          " contracts.");
    }

    return cell((n * 100).toFixed(1) + "%", "c-num", parts.join(" "));
  }

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

    return cell((r > 0 ? "+" : r < 0 ? MINUS : "") + body,
      "c-num",
      (r > 0
        ? body + " more contracts were open at this strike at the later settlement."
        : body + " fewer contracts were open at this strike at the later settlement.") +
      " It does not say which side anyone was on.");
  }

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

    const stage = typeof row.st === "string" && row.st ? row.st : null;
    if (stage) {
      const badge = el("span", "ua-stage", stage);
      badge.title = "Where the board's own funnel put this name this session: " + stage +
        ". Every name in this feed is a board name — the pipeline reads a chain only " +
        "for one — so this says which side of the board, not whether it is on it.";
      th.append(badge);
    }
    return th;
  }

  function feedRow(row, ctx) {
    const tr = document.createElement("tr");
    const ticker = String(row.t === null || row.t === undefined ? "" : row.t);
    const name = nameCell(row, ctx.covered.has(ticker), isNum(row.p) === 1);

    const key = joinKey(row.t, row.cp, row.k, row.expiry);
    if (key && alertKeys && alertKeys.has(key)) {
      const a = alertKeys.get(key);
      name.append(bothBadge(key,
        "The vendor's rules also flagged a window on this exact contract" +
        (a.rule ? ", under the rule \u201c" + a.rule + "\u201d" : "") +
        (isNum(a.prem) === null ? "" : ", carrying " + money(a.prem) + " of premium") +
        ". Two independent selections, the vendor's and this page's floors, on one line."));
    }
    tr.append(name);

    tr.append(cell(fixed(row.k, 2), "c-num",
      isNum(row.k) === null ? "The strike could not be read from the contract symbol." : ""));

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

    const iv = isNum(row.iv);
    const m = isNum(row.m);
    const cov = ctx.coverage.get(ticker);
    const said = [];
    if (iv !== null) {
      said.push("Implied volatility " + (iv * 100).toFixed(1) + "%" +
        (cov && cov.ivBasis ? ", on this name's own convention (" + cov.ivBasis + ")" : "") +
        ", which reads down this name and not across the table.");
    }
    if (m !== null) {
      said.push("Log-moneyness " + (m > 0 ? "+" : m < 0 ? MINUS : "") +
        Math.abs(m).toFixed(4) + ": the strike is " +
        (m > 0 ? "above" : m < 0 ? "below" : "level with") +
        " the price this name's chain was read against.");
    }
    if (said.length) tr.title = said.join(" ");
    return tr;
  }

  function sortableTable(table, cols, repaint) {
    const sort = { key: null, dir: "desc" };
    let heads = [];

    function toggle(key) {
      const col = cols.find((c) => c.key === key);
      if (!col) return;
      if (sort.key !== key) { sort.key = key; sort.dir = col.first; }
      else if (sort.dir === col.first) { sort.dir = col.first === "desc" ? "asc" : "desc"; }
      else { sort.key = null; sort.dir = "desc"; }
      sync();
      repaint();
    }

    function sync() {
      heads.forEach((th, i) => {
        const col = cols[i];
        const button = th.querySelector(".fb-sort");
        if (!col || !button) { th.removeAttribute("aria-sort"); return; }
        const on = sort.key === col.key;
        th.setAttribute("aria-sort",
          on ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
        const ind = button.querySelector(".fb-sort-ind");
        if (ind) ind.textContent = on ? (sort.dir === "asc" ? UP : DOWN) : "";

        button.setAttribute("aria-label", col.name + ": " + (on
          ? "ranked " + (sort.dir === "asc" ? "ascending" : "descending") +
            ", activate to " + (sort.dir === col.first
              ? "reverse" : "return to the published rank")
          : "activate to rank by this column"));
      });
    }

    function wire() {
      if (!table) return;
      heads = Array.from(table.querySelectorAll("thead th"));
      if (heads.length !== cols.length) return;
      heads.forEach((th, i) => {
        const col = cols[i];

        if (!col || th.querySelector(".fb-sort")) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "fb-sort";
        while (th.firstChild) button.append(th.firstChild);
        const ind = el("span", "fb-sort-ind");
        ind.setAttribute("aria-hidden", "true");
        button.append(ind);
        button.addEventListener("click", () => toggle(col.key));
        th.append(button);
      });
      sync();
    }

    function view(rows) {
      const col = sort.key ? cols.find((c) => c.key === sort.key) : null;
      return col ? rows.slice().sort((a, b) => compare(a, b, col, sort.dir)) : rows;
    }

    return { sort, toggle, sync, wire, view };
  }

  function joinKey(t, cp, k, expiry) {
    const strike = isNum(k);
    if (!t || !cp || strike === null || !expiry) return null;
    return String(t) + "|" + String(cp) + "|" + strike + "|" + String(expiry);
  }

  let alertKeys = null;
  let feedKeys = null;

  let alertRows = [];

  let alertsState = "pending";

  let alertVendorLimit = null;
  let alertVendorTruncated = null;
  let alertReadLimit = null;
  let alertReadTruncated = null;

  let feedState = "pending";

  const filter = { side: "all", both: false };

  function passesFilter(row, expiryKey) {
    if (filter.side !== "all" && row.cp !== filter.side) return false;
    if (filter.both) {
      const key = joinKey(row.t, row.cp, row.k, row[expiryKey]);
      if (!key) return false;

      if (alertKeys === null || feedKeys === null) return false;
      if (!alertKeys.has(key) || !feedKeys.has(key)) return false;
    }
    return true;
  }

  function bothBadge(key, title) {
    if (!key) return null;
    const sup = el("sup", "ua-both", "both");
    sup.title = title;
    return sup;
  }

  function joinResolved(side) {
    if (side !== "feed" && alertKeys !== null && feedRows.length) paintFeedRows();
    if (side !== "alerts" && feedKeys !== null && alertRows.length) paintAlertRows();
  }

  function buildControls() {
    const heading = document.getElementById("uaAlertsH");
    const host = heading ? heading.parentNode : document.querySelector(".flows-controls");
    if (!host || document.getElementById("uaFilters")) return;
    const group = el("div", "flows-views");
    group.id = "uaFilters";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Narrow both tables");

    group.style.flexWrap = "wrap";

    const buttons = [];

    function press(button, on) {
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
    function repaint() {
      paintFeedRows();
      paintAlertRows();
      syncFilterNote();
    }
    [["all", "All"], ["C", "Calls"], ["P", "Puts"]].forEach(([value, label]) => {
      const b = el("button", "flows-view", label);
      b.type = "button";
      press(b, filter.side === value);
      b.addEventListener("click", () => {
        filter.side = value;
        buttons.forEach(([bb, vv]) => press(bb, filter.side === vv));
        repaint();
      });
      buttons.push([b, value]);
      group.append(b);
    });
    const both = el("button", "flows-view", "Both feeds");
    both.type = "button";
    press(both, false);
    both.title = "Contracts the vendor's rules flagged AND that cleared this page's own " +
      "floors — the same name, side, strike and expiry in both tables.";
    both.addEventListener("click", () => {
      filter.both = !filter.both;
      press(both, filter.both);
      repaint();
    });
    group.append(both);

    const note = el("p", "fc-note");
    note.id = "uaFilterNote";
    if (heading) heading.after(group, note);
    else host.append(group, note);
    syncFilterNote();
  }

  function vendorCeilingSaid() {
    if (alertsState !== "ok") return "";
    if (alertVendorTruncated === true) {
      return " The flagged windows hit the vendor's own ceiling" +
        (alertVendorLimit === null ? "" : " of " + count(alertVendorLimit) + " rows") +
        ", so how many it withheld above that line is unknown — this count is a " +
        "ceiling rather than a market, and comparing it with another session's " +
        "compares two ceilings.";
    }
    if (alertVendorTruncated === null && alertReadTruncated === true) {
      return " An intraday read this session came back full at this site's own cap" +
        (alertReadLimit === null ? "" : " of " + count(alertReadLimit) + " rows") +
        ", so windows flagged between reads may be missing and this count is " +
        "at least what the day's record holds rather than a market.";
    }
    if (alertVendorTruncated === null && alertReadTruncated === false) {
      return " Every intraday read this session came in under this site's own per-read cap" +
        (alertReadLimit === null ? "" : " of " + count(alertReadLimit) + " rows") +
        ", so each saw every window the vendor's rolling list still held.";
    }
    if (alertVendorTruncated === null) {

      return " Whether the flagged windows hit the vendor's own ceiling was not " +
        "recorded on this payload, so this count may be a ceiling rather than a market.";
    }
    return " The flagged windows came in under the vendor's ceiling, so this count is " +
      "the read rather than a limit.";
  }

  function syncFilterNote() {
    const note = document.getElementById("uaFilterNote");
    if (!note) return;

    const tally = (state, rows, expiryKey, plural) => {
      if (state === "pending") return "the " + plural + " have not been read yet";
      if (state === "unpublished") return "the pipeline has not published the " + plural;
      if (state === "failed") return "the " + plural + " could not be read";

      if (state === "absent") return "the " + plural + " are not on this payload";
      const shown = rows.filter((e) => passesFilter(e.r, expiryKey)).length;
      return count(shown) + " of " + count(rows.length) + " " + plural + " are drawn";
    };
    if (filter.side === "all" && !filter.both) {

      note.textContent = (alertsState === "ok" && feedState === "ok"
        ? "Both tables show every row published."
        : "No filter is on: " + tally(alertsState, alertRows, "exp", "flagged windows") +
          " and " + tally(feedState, feedRows, "expiry", "contracts") + ".") +
        " Narrowing either is a filter on what is drawn and never a second read of the " +
        "market." + vendorCeilingSaid();
      return;
    }
    const bits = [];
    if (filter.side !== "all") bits.push(filter.side === "C" ? "calls only" : "puts only");
    if (filter.both) {

      bits.push(alertsState === "ok" && feedState === "ok"
        ? "contracts in both feeds"
        : (feedState === "absent"
          ? "contracts in both feeds — which cannot be resolved at all, because the " +
            "contract rows are not on this payload"
          : (alertsState === "failed" || feedState === "failed"
            ? "contracts in both feeds — which cannot be resolved at all, because one of " +
              "the two payloads could not be read"
            : (alertsState === "unpublished" || feedState === "unpublished"
              ? "contracts in both feeds — which cannot be resolved, because the pipeline " +
                "has not published one of the two"
              : "contracts in both feeds, which cannot be resolved until both payloads " +
                "have loaded"))));
    }
    note.textContent = "Filtered to " + bits.join(" and ") + ": " +
      tally(alertsState, alertRows, "exp", "flagged windows") + " and " +
      tally(feedState, feedRows, "expiry", "contracts") + ". " +
      "Anything hidden is published and hidden, not absent from the read." +
      vendorCeilingSaid();
  }

  let feedRows = [];
  let feedCtx = null;
  const feedSorter = sortableTable(feedTable, FEED_COLS, () => paintFeedRows());

  function paintFeedRows() {

    if (!feedRows.length) return;
    const view = feedSorter.view(feedRows).filter((e) => passesFilter(e.r, "expiry"));
    feedBody.textContent = "";
    if (!view.length && feedRows.length) {

      emptyRow(feedBody, FEED_COLUMNS,
        "No contract in this feed matches the filter above. " + count(feedRows.length) +
        " rows are published; the filter is hiding all of them.");
      return;
    }
    const frag = document.createDocumentFragment();
    for (const entry of view) frag.append(feedRow(entry.r, feedCtx));
    feedBody.append(frag);
  }

  function changeCell(v) {
    const n = isNum(v);
    if (n === null) {
      return cell(DASH, "c-num ua-unreported",
        "No prior close was reported for this name, so the move is unknown. It is not zero.");
    }
    const body = (Math.abs(n) * 100).toFixed(2) + "%";
    if (n === 0) return cell("0.00%", "c-num ua-flat", "Measured, and the close was unchanged.");
    return cell((n > 0 ? UP : DOWN) + body,
      "c-num " + (n > 0 ? "fb-pos" : "fb-neg"),
      (n > 0 ? "Up " : "Down ") + body + " on the prior close, as a fraction of it.");
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

  function basisItem(key, value) {
    const text = String(value === null || value === undefined ? "" : value).trim();
    if (!text) return null;
    const box = el("div", "ua-b-item");
    box.append(el("p", "ua-b-k", BASIS_LABELS[key] || key));
    box.append(el("p", "ua-b-p", text));
    return box;
  }

  function basisChoice(key, obj) {
    const box = el("div", "ua-choice");
    box.append(el("p", "ua-choice-tag", "A choice — " + (BASIS_LABELS[key] || key)));

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

    const reason = String(obj.reason === null || obj.reason === undefined ? "" : obj.reason).trim();
    if (reason) box.append(el("p", "ua-b-p", reason));
    return box;
  }

  function basisEntry(key, value) {
    if (value && typeof value === "object" && value.choice === true) {
      return basisChoice(key, value);
    }
    if (value && typeof value === "object") {

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

  function emptyRow(body, columns, text, kind) {
    body.textContent = "";
    const tr = document.createElement("tr");
    const td = el("td", "flows-empty", text);
    if (kind) td.dataset.empty = kind;
    td.colSpan = columns;
    tr.append(td);
    body.append(tr);
  }

  function say(text, kind) {
    statusEl.textContent = text;
    if (kind) statusEl.dataset.empty = kind;
    else delete statusEl.dataset.empty;
  }

  function failEverywhere(what) {

    say(what, "unreadable");
    emptyRow(feedBody, FEED_COLUMNS, what, "unreadable");
    emptyRow(nameBody, NAME_COLUMNS, what, "unreadable");
    if (feedCap) feedCap.textContent = "No contract could be listed.";
    if (nameCap) nameCap.textContent = "No name could be listed.";
    if (feedNote) feedNote.textContent = "";
    if (nameNote) nameNote.textContent = "";
    basisHost.textContent = "";
    const broken = el("p", "flows-empty", what);
    broken.dataset.empty = "unreadable";
    basisHost.append(broken);
    if (feedPanel) feedPanel.hidden = false;
    if (namePanel) namePanel.hidden = false;
    if (basisPanel) basisPanel.hidden = false;
    if (footEl) footEl.textContent = "";
  }

  function paint(payload) {

    const contracts = payload.contracts && typeof payload.contracts === "object"
      ? payload.contracts : null;
    const names = payload.names && typeof payload.names === "object" ? payload.names : null;
    const rows = contracts && Array.isArray(contracts.rows) ? contracts.rows : null;
    const nameRows = names && Array.isArray(names.rows) ? names.rows : null;
    const coverage = new Map();

    let listed = null;
    for (const c of Array.isArray(payload.coverage) ? payload.coverage : []) {
      if (!c || !c.t) continue;
      coverage.set(String(c.t), c);
      const n = isNum(c.rows);
      if (n !== null) listed = (listed === null ? 0 : listed) + n;
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

    if (rows === null) {
      const gone = contracts === null;
      const what = gone
        ? "this payload carries no contracts block"
        : "the contracts block on this payload carries no rows array, so it could not " +
          "be read as a feed";
      const kind = gone ? "unavailable" : "unreadable";
      say("Published, but " + what + ", and no count of contracts, of names or of " +
        "chains is taken from it. This is a gap in the payload and not a chain that " +
        "cleared no floors.", kind);
      if (feedCap) feedCap.textContent = "";
      if (feedNote) feedNote.textContent = "";
      emptyRow(feedBody, FEED_COLUMNS, "Published, but " + what + ".", kind);
      feedRows = [];

      feedKeys = null;

      feedState = gone ? "absent" : "failed";
      syncFilterNote();
      if (feedPanel) feedPanel.hidden = false;
    } else {

      const shown = isNum(contracts.shown);
      const eligible = isNum(contracts.eligible);
      const cap = isNum(contracts.cap);
      const perName = isNum(contracts.perName);
      const distinct = new Set(rows.map((r) => String(r.t || ""))).size;
      const namesSeen = isNum(payload.namesSeen);
      const truncated = isNum(payload.namesTruncated);
      const complete = isNum(payload.namesComplete);

      let bound;
      if (contracts.capBound === "rows") {
        bound = "the " + (cap === null ? "row" : count(cap) + "-row") +
          " cap is what bound this list" +
          (perName === null ? "" : ", with at most " + count(perName) + " from any one name");
      } else if (contracts.capBound === "perName") {
        bound = "the per-name allowance of " + (perName === null ? "one" : count(perName)) +
          " is what bound this list; the " + (cap === null ? "row cap" : count(cap) + "-row cap") +
          " was never reached";
      } else if (contracts.capBound === "eligible") {
        bound = "neither cap bound this list: it is every contract that cleared the floors";
      } else {
        bound = "the payload did not say which cap bound this list";
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

      say(strip.join(" · ") + ".", rows.length ? null : "quiet");

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
      if (listed !== null && eligible !== null && listed > eligible) {
        capParts.push("Those chains listed " + count(listed) + " strikes between them; the " +
          count(listed - eligible) + " that did not clear the floors are not in the " +
          "population above and nothing is claimed about them.");
      }
      if (aggrReported !== null && shown !== null) {
        capParts.push(count(aggrReported) + " of " + count(shown) +
          " carry a classified offer-and-bid split" +
          (notionalReported === null ? "" :
            " and " + count(notionalReported) + " of " + count(shown) + " quoted both sides") + ".");
      }

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
          "rank the pipeline published. A row marked \u201cboth\u201d is a contract the " +
          "vendor's rules also flagged a window on, matched on name, side, strike and " +
          "expiry — two independent selections agreeing, and the only corroboration this " +
          "page can offer. An unmarked row is not a contradiction: the two feeds are read " +
          "at different times from different endpoints, and absence from one says nothing " +
          "about the other.";
      }

      feedRows = rows.map((r, i) => ({ r, i }));

      feedKeys = new Set();
      for (const r of rows) {
        const key = joinKey(r.t, r.cp, r.k, r.expiry);
        if (key) feedKeys.add(key);
      }
      if (!rows.length) {

        emptyRow(feedBody, FEED_COLUMNS,
          payload.status === "quiet"
            ? "No contract cleared both floors on the chains that were read. That is a " +
              "statement about this run's chains, not about the market."
            : "This payload carries a contracts block with no rows in it, and did not " +
              "report the read as quiet.", "quiet");
      } else {
        feedSorter.wire();
        paintFeedRows();
      }
      feedState = "ok";
      joinResolved("feed");
      syncFilterNote();
      if (feedPanel) feedPanel.hidden = false;
    }

    if (nameRows === null) {
      const goneNames = names === null;
      if (nameCap) nameCap.textContent = "";
      emptyRow(nameBody, NAME_COLUMNS, "Published, but the name panel " + (goneNames
        ? "is not on this payload"
        : "on this payload carries no rows array, so it could not be read as a ranking") +
        ". No count of ranked or unranked names is taken from it.",
        goneNames ? "unavailable" : "unreadable");
    } else {
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
          (unranked === null ? "" : ", " + count(unranked) + " of which had no measurable " +
            "ratio and " + (unranked === 1 ? "was" : "were") + " left unranked rather than " +
            "ranked at zero") + ".");
      }

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
          "No name carried both a call and a put thirty-day average, so none could be " +
          "ranked.", "quiet");
      } else {
        const frag = document.createDocumentFragment();
        for (const r of nameRows) frag.append(nameRow(r, feedCtx.covered));
        nameBody.append(frag);
      }
    }
    if (namePanel) namePanel.hidden = false;

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

  const alertsPanel = document.getElementById("uaAlertsPanel");
  const alertsTable = document.getElementById("uaAlerts");
  const alertsBody = document.getElementById("uaAlertsBody");
  const alertsCap = document.getElementById("uaAlertsCap");
  const alertsNote = document.getElementById("uaAlertsNote");
  const ALERT_COLUMNS = 10;

  const ALERT_COLS = [
    { key: "t", name: "Name", first: "asc",
      val: (r) => (r.t === null || r.t === undefined ? null : String(r.t)) },

    { key: "exp", name: "Contract, by expiry", first: "asc",
      val: (r) => (r.exp ? String(r.exp) : null) },
    { key: "prem", name: "Premium", first: "desc", val: (r) => isNum(r.prem) },
    { key: "askPrem", name: "Ask-side premium", first: "desc", val: (r) => isNum(r.askPrem) },
    { key: "bidPrem", name: "Bid-side premium", first: "desc", val: (r) => isNum(r.bidPrem) },
    { key: "size", name: "Contracts in the window", first: "desc", val: (r) => isNum(r.size) },
    { key: "trades", name: "Executions in the window", first: "desc", val: (r) => isNum(r.trades) },

    { key: "flags", name: "Vendor flags set", first: "desc", val: (r) => {
      const flags = [r.sweep, r.floor, r.single, r.opening];
      if (!flags.some((v) => v === true || v === false)) return null;
      return flags.filter((v) => v === true).length;
    } },
    { key: "spanStart", name: "Window start", first: "asc",
      val: (r) => (r.spanStart ? String(r.spanStart) : null) },
    { key: "st", name: "Stage in the board's funnel", first: "asc",
      val: (r) => (r.st ? String(r.st) : null) },
  ];
  const alertsSorter = sortableTable(alertsTable, ALERT_COLS, () => paintAlertRows());

  function paintAlertRows() {
    if (!alertsBody || !alertRows.length) return;
    const view = alertsSorter.view(alertRows).filter((e) => passesFilter(e.r, "exp"));
    alertsBody.textContent = "";
    if (!view.length && alertRows.length) {

      emptyRow(alertsBody, ALERT_COLUMNS,
        "No flagged window matches the filter above. " + count(alertRows.length) +
        " are published; the filter is hiding all of them.");
      return;
    }
    const frag = document.createDocumentFragment();
    for (const entry of view) frag.append(alertRowEl(entry.r));
    alertsBody.append(frag);
  }

  function flagWord(v, name) {
    return name + " " + (v === true ? "yes" : v === false ? "no" : DASH);
  }

  function alertFlagsCell(r) {
    const names = [["sweep", r.sweep], ["floor", r.floor],
                   ["single-leg", r.single], ["all-opening", r.opening]];
    const yes = names.filter(([, v]) => v === true).map(([n]) => n);
    const known = names.some(([, v]) => v === true || v === false);
    const text = yes.length ? yes.join(", ") : known ? "none" : DASH;
    return cell(text, null,
      names.map(([n, v]) => flagWord(v, n)).join(" · ") +
      " — the vendor's flags, as sent; " + DASH + " means the flag was not carried.");
  }

  function alertWindowCell(r) {
    if (!r.spanStart || !r.spanEnd) return cell(DASH, null,
      "The vendor stated no span for this window.");
    const hm = (iso) => String(iso).slice(11, 16);
    if (r.spanFrom === "created_at") {
      return cell(hm(r.spanStart), null,
        "The vendor stated no span for this window; this is when it created the alert: " +
        r.spanStart + ".");
    }
    return cell(hm(r.spanStart) + "\u2013" + hm(r.spanEnd), null,
      "The vendor's stated span: " + r.spanStart + " to " + r.spanEnd + ".");
  }

  function alertRowEl(r) {
    const tr = document.createElement("tr");
    const name = el("th", "fb-tk");
    name.scope = "row";
    name.textContent = r.t || DASH;
    if (r.rule) name.title = "Flagged by the vendor's rule \u201c" + r.rule + "\u201d.";

    const key = joinKey(r.t, r.cp, r.k, r.exp);
    if (key && feedKeys && feedKeys.has(key)) {
      name.append(bothBadge(key,
        "This exact contract also clears the counter feed's own volume and " +
        "open-interest floors below — two independent selections on one line."));
    }
    tr.append(name);
    tr.append(cell(
      r.cp ? (r.cp === "C" ? "C " : "P ") + (isNum(r.k) === null ? "" : count(r.k)) +
        (r.exp ? " \u00b7 " + r.exp : "")
        : (r.oc || DASH),
      null,
      r.cp === null && r.oc
        ? "The vendor's option symbol could not be parsed; shown as sent."
        : null));
    tr.append(cell(money(r.prem), "c-num"));
    tr.append(cell(money(r.askPrem), "c-num"));
    tr.append(cell(money(r.bidPrem), "c-num"));
    tr.append(cell(count(r.size), "c-num"));
    tr.append(cell(count(r.trades), "c-num"));
    tr.append(alertFlagsCell(r));
    tr.append(alertWindowCell(r));
    tr.append(cell(r.st || DASH, r.st === "foreign" ? "ua-dim" : null,
      r.st === "foreign"
        ? "The screener never returned this name, so the board holds no view of it."
        : null));
    return tr;
  }

  function alertsStamp(readAt, refreshed) {
    const at = instant(readAt);
    if (!at) return "";
    if (refreshed === "intraday") {
      return "Read " + at + " (refreshes about every 15 minutes during market hours).";
    }
    if (refreshed === "nightly") {
      return "Read " + at + " with the nightly build (refreshes intraday during market hours).";
    }
    return "Read " + at + ".";
  }

  function paintAlerts(alerts) {
    if (!alertsPanel || !alertsBody) return;

    if (alerts.status === "pending") {
      alertsState = "unpublished";
      emptyRow(alertsBody, ALERT_COLUMNS,
        "The pipeline has not published this key yet. The alerts feed costs one " +
        "market-wide call a run and appears with the first pipeline run after it " +
        "shipped.", "pending");
      if (alertsCap) alertsCap.textContent = "Nothing has been published under this key.";
      alertsPanel.hidden = false;
      syncFilterNote();
      return;
    }

    const rows = Array.isArray(alerts.rows) ? alerts.rows : null;
    if (!rows) {
      emptyRow(alertsBody, ALERT_COLUMNS,
        "This payload could not be read as an alerts feed: it carries no rows " +
        "array. That is a gap in the payload, not a quiet market.", "unreadable");

      alertsState = "failed";
      syncFilterNote();
      alertsPanel.hidden = false;
      return;
    }

    alertVendorLimit = isNum(alerts.vendorLimit);
    alertVendorTruncated = typeof alerts.vendorTruncated === "boolean"
      ? alerts.vendorTruncated
      : null;
    alertReadLimit = isNum(alerts.readLimit);
    alertReadTruncated = typeof alerts.readTruncated === "boolean"
      ? alerts.readTruncated
      : null;

    alertsBody.textContent = "";
    alertRows = rows.map((r, i) => ({ r, i }));

    alertKeys = new Map();
    for (const r of rows) {
      const key = joinKey(r.t, r.cp, r.k, r.exp);
      if (key) alertKeys.set(key, r);
    }
    if (!rows.length) {
      emptyRow(alertsBody, ALERT_COLUMNS,
        "The vendor's rules flagged nothing in this read. The read is stamped " +
        "below — a read taken before the open, of a feed that fills intraday, is " +
        "expected to be thin — and absence from the vendor's selection is not evidence of " +
        "a quiet market.", "quiet");
    } else {
      alertsSorter.wire();
      paintAlertRows();
    }
    alertsState = "ok";
    joinResolved("alerts");
    syncFilterNote();

    const seen = isNum(alerts.seen);

    const shed = isNum(alerts.shed);
    const cov = alerts.coverage && typeof alerts.coverage === "object" ? alerts.coverage : {};
    if (alertsCap) {
      const shedSaid = shed === null
        ? (seen !== null && seen > rows.length
          ? ", and what the row cap shed was not recorded on this payload" : "")
        : shed
          ? ", the largest premiums kept and " + count(shed) + " shed by the row cap"
          : "";

      alertsCap.textContent = count(rows.length) +
        (seen === null ? " windows" : " of " +
          (alertVendorTruncated === true || alertReadTruncated === true ? "at least " : "") + count(seen) +
          " flagged windows") +
        shedSaid +
        " \u00b7 ranked by the vendor's own premium, inside the vendor's own selection.";
    }
    if (alertsNote) {
      const bits = [];
      bits.push("The population is what the vendor's rules chose to flag — the rules " +
        "are named per row, their definitions are the vendor's own, and absence from " +
        "this list is not evidence of quiet.");
      if (isNum(cov.withContract) !== null && rows.length) {
        bits.push(count(cov.withContract) + " of " + count(rows.length) +
          " carried a parseable contract symbol" +
          (isNum(cov.calls) !== null && isNum(cov.puts) !== null
            ? " (" + count(cov.calls) + " calls, " + count(cov.puts) + " puts)" : "") + ".");
      }

      bits.push("Each row carries the vendor's own stated span, in UTC.");
      alertsNote.textContent = bits.join(" ");
    }

    let stampEl = document.getElementById("uaAlertsStamp");
    if (!stampEl) {
      stampEl = el("p", "fc-note");
      stampEl.id = "uaAlertsStamp";
      const wrap = alertsPanel.querySelector(".flows-tablewrap");
      alertsPanel.insertBefore(stampEl, wrap || alertsPanel.firstChild);
    }
    stampEl.textContent = alertsStamp(alerts.readAt, alerts.refreshed);

    alertsPanel.hidden = false;
  }

  buildControls();

  fetch("/api/flows/flowalerts", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then((response) => {
    if (response.status === 401) { location.replace("/flows/"); return null; }
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }).then((alerts) => {
    if (!alerts || typeof alerts !== "object") return;
    paintAlerts(alerts);
  }).catch((error) => {

    alertsState = "failed";
    syncFilterNote();
    if (!alertsPanel || !alertsBody) return;
    emptyRow(alertsBody, ALERT_COLUMNS,
      "The alerts feed could not be loaded (" + (error && error.message
        ? error.message : "no message") + "). The counter feed below is a separate " +
      "payload and stands on its own.", "unreadable");
    if (alertsCap) alertsCap.textContent = "No window could be listed.";
    alertsPanel.hidden = false;
  });

  fetch(PAYLOAD_URL, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then((response) => {

    if (response.status === 401) { location.replace("/flows/"); return null; }
    if (!response.ok) throw new Error("HTTP " + response.status);
    const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
    return response.json().then((payload) => {
      if (payload && typeof payload === "object") payload.__updatedAt = updatedAt;
      return payload;
    });
  }).then((payload) => {
    if (!payload) return;

    if (payload.status === "pending") {
      feedState = "unpublished";
      say("The pipeline has not published this key yet. This feed is " +
        "built from the option chains the run already reads for each board name, so it " +
        "appears with the first pipeline run after it shipped.", "pending");
      syncFilterNote();
      return;
    }

    paint(payload);

    if (staleEl && payload.__updatedAt) {
      const ageHours = (Date.now() - payload.__updatedAt) / 3600000;
      if (ageHours > 30) {
        const days = Math.round(ageHours / 24);
        staleEl.hidden = false;
        staleEl.textContent = "This feed was last written " + days +
          (days === 1 ? " day" : " days") + " ago. The pipeline has not published " +
          "since, so these counters are from that read and not from a later one.";
      }
    }
    if (staleEl && staleEl.hidden && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.sessionDate))) {
      const read = Date.parse(payload.readAt || payload.generatedAt || "");
      const lag = (read - Date.parse(payload.sessionDate + "T21:00:00Z")) / 86400000;
      if (Number.isFinite(lag) && lag > 4) {
        staleEl.hidden = false;
        staleEl.textContent = "This feed describes the " + payload.sessionDate +
          " session, but the chains were read " + Math.floor(lag) + " days after that " +
          "session closed. The pipeline is running but its data is not advancing.";
      }
    }
  }).catch((error) => {
    feedState = "failed";
    failEverywhere("The feed could not be loaded (" + (error && error.message
      ? error.message : "no message") + "). Nothing on this page was measured; refresh " +
      "to try again.");
    syncFilterNote();
  });
})();
