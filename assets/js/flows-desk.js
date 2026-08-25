/* =============================================================
   flows-desk.js — the on-demand premium desk.

   The board renders a payload the pipeline computed hours ago. This
   file does not: every symbol here is one the user typed, so each is
   a live call to /api/flows/chain, which prices it inside the
   Worker. That difference drives every decision below.

   ONE REQUEST PER SYMBOL, SEQUENTIAL WITH A SMALL CONCURRENCY. Each
   call spends two vendor subrequests behind a shared quota. Firing
   twenty at once to fill a table a fraction of a second sooner is
   how a desk becomes the reason the quota is gone.

   THE WATCHLIST LIVES IN THE URL. assets/js/storage.js is the
   sanctioned owner of browser storage for this site, and a second
   owner is how two of them disagree. The URL also makes a desk
   shareable and reload-proof, which a private per-browser key is
   not. Same idiom as the board's side and view toggles.

   EVERY NUMBER SAYS HOW OLD IT IS. The route serves from an edge
   cache and answers a throttled refresh with the copy it already
   has. A desk that renders a two-minute-old quote identically to a
   live one is lying by omission, so the age ships in the row.
   ============================================================= */
(() => {
  "use strict";

  const entry = document.getElementById("deskEntry");
  const input = document.getElementById("deskInput");
  const list = document.getElementById("deskList");
  const allBox = document.getElementById("deskAll");
  const refreshBtn = document.getElementById("deskRefresh");
  const clearBtn = document.getElementById("deskClear");
  const strategySel = document.getElementById("deskStrategy");
  const rankSel = document.getElementById("deskRank");
  const statusEl = document.getElementById("deskStatus");
  const tableWrap = document.getElementById("deskTableWrap");
  const tbody = document.getElementById("deskBody");
  const foot = document.getElementById("deskFoot");
  if (!entry || !input || !list || !tbody) return;

  const COLUMNS = 12;               // keep in sync with the <thead> in flows-pages.js
  const MAX_SYMBOLS = 20;           // each is a live vendor call; the ceiling is deliberate
  const CONCURRENCY = 3;

  /* The SAME pattern the Worker validates against. If the two disagree, a
     symbol the user can add is one the API refuses, which reads as a broken
     desk rather than as a rejected input. */
  const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

  const MINUS = "−";           // U+2212, not a hyphen
  const DASH = "—";

  /** symbol -> { selected, state: "idle"|"loading"|"ok"|"error", payload, error } */
  const book = new Map();
  let inflight = 0;

  /* ---------- formatting ------------------------------------------
     One place for every number, and the rule from the board holds: never
     print a precision the data does not have, and never render a missing
     value as 0 — a confident zero is a lie the reader cannot detect. */

  const isNum = (v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const fmt2 = (v) => { const n = isNum(v); return n === null ? DASH : n.toFixed(2); };

  function fmtMoney(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function fmtPct(v, digits) {
    const n = isNum(v);
    if (n === null) return DASH;
    const s = (Math.abs(n) * 100).toFixed(digits === undefined ? 1 : digits);
    return (n < 0 ? MINUS : "") + s + "%";
  }

  function fmtSigmas(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : "") + Math.abs(n).toFixed(2) + "σ";
  }

  function fmtInt(v) {
    const n = isNum(v);
    return n === null ? DASH : Math.round(n).toLocaleString("en-US");
  }

  function fmtExpiry(iso, days) {
    if (!iso) return DASH;
    const d = isNum(days);
    return d === null ? iso : iso.slice(5) + " (" + d + "d)";
  }

  function fmtAge(seconds) {
    const n = isNum(seconds);
    if (n === null) return "";
    if (n < 45) return "just now";
    if (n < 5400) return Math.round(n / 60) + "m ago";
    return Math.round(n / 3600) + "h ago";
  }

  /* ---------- the watchlist, held in the URL ---------------------- */

  function readURL() {
    try {
      const q = new URLSearchParams(location.search);
      const raw = (q.get("t") || "").split(/[,\s]+/);
      const strategy = q.get("strategy");
      const rank = q.get("rank");
      if (strategySel && (strategy === "csp" || strategy === "cc")) strategySel.value = strategy;
      if (rankSel && rank && Array.from(rankSel.options).some((o) => o.value === rank)) {
        rankSel.value = rank;
      }
      return normalise(raw);
    } catch { return []; }
  }

  function writeURL() {
    try {
      const url = new URL(location.href);
      const symbols = Array.from(book.keys());
      if (symbols.length) url.searchParams.set("t", symbols.join(","));
      else url.searchParams.delete("t");
      url.searchParams.set("strategy", strategySel ? strategySel.value : "both");
      url.searchParams.set("rank", rankSel ? rankSel.value : "annualized");
      history.replaceState(null, "", url);
    } catch { /* a desk that cannot rewrite its own URL still works */ }
  }

  /** Uppercase, de-duplicate, drop anything the API would refuse, cap the count. */
  function normalise(raw) {
    const out = [];
    for (const piece of raw) {
      const t = String(piece || "").trim().toUpperCase();
      if (!TICKER_RE.test(t)) continue;
      if (out.includes(t)) continue;
      out.push(t);
      if (out.length >= MAX_SYMBOLS) break;
    }
    return out;
  }

  /* ---------- the watchlist chips --------------------------------- */

  function renderList() {
    list.textContent = "";
    if (!book.size) {
      allBox.checked = false;
      allBox.indeterminate = false;
      allBox.disabled = true;
      return;
    }
    allBox.disabled = false;

    for (const [symbol, entryState] of book) {
      const chip = document.createElement("div");
      chip.className = "desk-chip is-" + entryState.state;

      const label = document.createElement("label");
      label.className = "desk-check";

      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = entryState.selected;
      /* The accessible name has to carry the symbol. Twenty checkboxes all
         announced as "select" are twenty identical controls to a screen
         reader, and the visible text alone does not reach the input. */
      box.setAttribute("aria-label", "Include " + symbol);
      box.addEventListener("change", () => {
        entryState.selected = box.checked;
        syncAll();
        render();
      });

      const name = document.createElement("span");
      name.className = "desk-chip__sym";
      name.textContent = symbol;

      label.append(box, name);
      chip.append(label);

      const note = document.createElement("span");
      note.className = "desk-chip__note";
      if (entryState.state === "loading") note.textContent = "loading…";
      else if (entryState.state === "error") note.textContent = entryState.error || "failed";
      else if (entryState.payload) {
        const p = entryState.payload;
        const parts = [];
        if (isNum(p.spot) !== null) {
          /* WHICH PRICE THIS WAS PRICED AGAINST. A covered call's collateral IS
             the shares at spot and every moneyness is measured from it, so a
             table built on yesterday's close and one built on a live print are
             different tables. Rendering them identically is the same omission
             as showing a cached row as live. */
          parts.push("$" + fmt2(p.spot) + (p.spotSource === "daily-close" ? " close" : ""));
        }
        parts.push(fmtInt(p.priced) + " sellable");
        if (p.__age !== undefined) {
          const age = fmtAge(p.__age);
          if (age) parts.push(age);
        }
        note.textContent = parts.join(" · ");
      }
      chip.append(note);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "desk-chip__x";
      remove.setAttribute("aria-label", "Remove " + symbol);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        book.delete(symbol);
        writeURL();
        renderList();
        render();
      });
      chip.append(remove);

      list.append(chip);
    }
    syncAll();
  }

  /** The select-all box reflects three states, and the third one matters:
   *  a half-selected list must show indeterminate rather than claiming
   *  either extreme. */
  function syncAll() {
    if (!book.size) { allBox.checked = false; allBox.indeterminate = false; return; }
    let on = 0;
    for (const e of book.values()) if (e.selected) on++;
    allBox.checked = on === book.size;
    allBox.indeterminate = on > 0 && on < book.size;
  }

  /* ---------- fetching -------------------------------------------- */

  async function fetchOne(symbol, { refresh = false } = {}) {
    const state = book.get(symbol);
    if (!state) return;
    state.state = "loading";
    state.error = null;
    renderList();

    const params = new URLSearchParams({
      t: symbol,
      strategy: strategySel ? strategySel.value : "both",
      rank: rankSel ? rankSel.value : "annualized",
    });
    if (refresh) params.set("refresh", "1");

    try {
      const response = await fetch("/api/flows/chain?" + params.toString(), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        /* The session expired underneath us. The login page is the honest
           destination, not an error message on a page that cannot work. */
        location.replace("/flows/");
        return;
      }
      const age = Number(response.headers.get("X-Chain-Age"));
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        state.state = "error";
        state.error = messageFor(response.status, body);
        state.payload = null;
      } else {
        state.state = "ok";
        state.payload = body;
        if (body) body.__age = Number.isFinite(age) ? age : undefined;
      }
    } catch {
      state.state = "error";
      state.error = "network error";
      state.payload = null;
    }
    renderList();
    render();
  }

  /** The API's error codes, said in words a reader can act on. */
  function messageFor(status, body) {
    const code = body && body.error && body.error.code;
    if (code === "chain_empty" || status === 404) return "no listed options";
    if (code === "chain_rate_limited" || status === 429) return "rate limited — try again shortly";
    if (code === "chain_unconfigured") return "live lookup not configured";
    if (code === "chain_no_spot") return "no usable price";
    if (status >= 500) return "data provider unavailable";
    if (status === 400) return "not a valid symbol";
    return "failed (" + status + ")";
  }

  /** Bounded concurrency. Each task is two vendor subrequests behind a shared
   *  quota, so the pool is small on purpose rather than as a browser limit. */
  async function runPool(symbols, options) {
    const queue = symbols.slice();
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      workers.push((async () => {
        while (queue.length) {
          const next = queue.shift();
          inflight++;
          updateStatus();
          try { await fetchOne(next, options); } finally { inflight--; }
          updateStatus();
        }
      })());
    }
    await Promise.all(workers);
  }

  /* ---------- rendering the merged table -------------------------- */

  function selectedSymbols() {
    return Array.from(book.entries()).filter(([, e]) => e.selected).map(([s]) => s);
  }

  function render() {
    const chosen = selectedSymbols();
    const rows = [];
    let screened = 0, priced = 0;
    const gatedTotals = Object.create(null);
    let oldest = null;

    for (const symbol of chosen) {
      const state = book.get(symbol);
      if (!state || state.state !== "ok" || !state.payload) continue;
      const p = state.payload;
      screened += isNum(p.screened) || 0;
      priced += isNum(p.priced) || 0;
      for (const [reason, n] of Object.entries(p.gated || {})) {
        gatedTotals[reason] = (gatedTotals[reason] || 0) + (isNum(n) || 0);
      }
      if (p.__age !== undefined && (oldest === null || p.__age > oldest)) oldest = p.__age;
      for (const r of p.rows || []) rows.push({ ...r, __spot: p.spot });
    }

    /* THE MERGED RANKING IS RE-SORTED HERE. Each payload arrives ranked
       within its own symbol; concatenating them would put every AAPL line
       above every MSFT line regardless of which pays better, which is the
       one thing a cross-symbol desk must not do. */
    const key = rankSel ? rankSel.value : "annualized";
    rows.sort((a, b) => {
      const x = a[key], y = b[key];
      const xn = x === null || x === undefined ? null : isNum(x);
      const yn = y === null || y === undefined ? null : isNum(y);
      if (xn === null && yn === null) return 0;
      if (xn === null) return 1;              // unmeasured never wins a ranking
      if (yn === null) return -1;
      return yn - xn;
    });

    tbody.textContent = "";
    if (!rows.length) {
      /* A PRICED SYMBOL WITH NO ROWS IS A READING, NOT AN ABSENCE. The gates
         can legitimately empty a chain — everything too wide, too thin, or
         paying too little — and hiding the table entirely reports that as
         "nothing loaded". The two are different and the reader is told which. */
      const priceable = chosen.filter((s) => (book.get(s) || {}).state === "ok");
      if (priceable.length && screened > 0) {
        showEmpty("Nothing on " + priceable.join(", ") + " clears the liquidity gates right now. " +
                  screened + " quoted contracts were screened.");
      } else {
        tableWrap.hidden = true;
      }
      foot.textContent = "";
      updateStatus(oldest);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const r of rows) frag.append(rowFor(r));
    tbody.append(frag);
    tableWrap.hidden = false;

    const dropped = Object.entries(gatedTotals)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => n + " " + reasonWord(reason));
    /* WHAT WAS EXCLUDED, IN THE OPEN. A screen that quietly drops nine tenths
       of a chain and shows a tidy top ten misrepresents how thin the real
       opportunity set is.

       The reasons are a PARTITION, not a tally: each contract is charged to the
       first gate it failed, which is what makes the counts reconcile against
       the screened total. The lottery ticket counted under "paying too little"
       usually has a hopeless spread and no open interest either. Saying so
       costs one clause and stops "900 too wide" being read as "900 whose only
       problem is the spread". */
    foot.textContent = dropped.length
      ? priced + " of " + screened + " quoted contracts are sellable. The rest fail a gate: " +
        dropped.join(", ") + " — each counted once, under the first gate it failed."
      : priced + " of " + screened + " quoted contracts are sellable.";
    updateStatus(oldest);
  }

  function reasonWord(reason) {
    switch (reason) {
      case "spread": return "too wide";
      case "openInterest": return "too thin";
      case "premium": return "paying too little";
      case "expiry": return "outside the tenor window";
      case "strategy": return "on the other side";
      case "unpriceable": return "with no quotable bid";
      default: return reason;
    }
  }

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function rowFor(r) {
    const tr = document.createElement("tr");

    const sym = document.createElement("th");
    sym.scope = "row";
    sym.textContent = r.ticker || DASH;
    tr.append(sym);

    /* "Sell" says the trade in words rather than in a P/C letter, because
       the two are not symmetric: one ties up cash and the other ties up
       shares you have to already own. */
    const side = r.strategy === "csp" ? "Cash-secured put"
      : r.strategy === "cc" ? "Covered call" : DASH;
    tr.append(cell(side, "c-side"));

    tr.append(cell(fmt2(r.strike), "c-num"));
    tr.append(cell(fmtExpiry(r.expiry, r.days), "c-num"));
    tr.append(cell(fmt2(r.bid), "c-num"));
    tr.append(cell(fmtMoney(r.premium), "c-num"));
    tr.append(cell(fmtPct(r.yieldOnCollateral, 2), "c-num"));

    /* The annualized figure is a CONVENTION and the payload says so. It is
       marked in the DOM too: a 900% cell that looks like every other cell is
       read as a return, whatever the column header promised. */
    const ann = cell(fmtPct(r.annualized, 0), "c-num c-ann");
    if (r.annualizedIsConvention) {
      ann.title = "Simple 365/days scaling, for comparing tenors. Not a return anyone earns.";
    }
    tr.append(ann);

    tr.append(cell(fmtSigmas(r.cushionSigmas), "c-num"));
    tr.append(cell(fmt2(r.breakeven), "c-num"));
    tr.append(cell(fmtPct(r.spread, 1), "c-num"));

    const oi = isNum(r.oi);
    const change = isNum(r.oiChange);
    const oiText = oi === null ? DASH
      : change === null || change === 0 ? fmtInt(oi)
      : fmtInt(oi) + " (" + (change > 0 ? "+" : MINUS) + fmtInt(Math.abs(change)) + ")";
    tr.append(cell(oiText, "c-num"));

    return tr;
  }

  function updateStatus(oldestAge) {
    if (inflight > 0) {
      statusEl.textContent = "Pricing " + inflight + " symbol" + (inflight === 1 ? "" : "s") + "…";
      return;
    }
    if (!book.size) { statusEl.textContent = "Add a symbol to begin."; return; }
    const chosen = selectedSymbols();
    if (!chosen.length) { statusEl.textContent = "Select a symbol to price it."; return; }
    const failed = chosen.filter((s) => (book.get(s) || {}).state === "error");
    const age = oldestAge === undefined || oldestAge === null ? "" : " · quotes " + fmtAge(oldestAge);

    /* THE SESSION, and any symbol not priced against a live print. The vendor
       names the session ("regular", "pre", "post"); it is passed through
       rather than mapped, because an enum this page does not control is not
       one it should invent members of. */
    const sessions = new Set();
    const stale = [];
    for (const sym of chosen) {
      const p = (book.get(sym) || {}).payload;
      if (!p) continue;
      if (p.marketTime) sessions.add(String(p.marketTime));
      if (p.spotSource === "daily-close") stale.push(sym);
    }
    const session = sessions.size === 1 ? " · " + [...sessions][0] + " session" : "";
    const staleNote = stale.length
      ? " · " + stale.join(", ") + " priced off the last close, not a live print"
      : "";

    statusEl.textContent = (failed.length
      ? chosen.length - failed.length + " of " + chosen.length + " symbols priced · " +
        failed.join(", ") + " unavailable"
      : chosen.length + " symbol" + (chosen.length === 1 ? "" : "s") + " priced") +
      session + age + staleNote;
  }

  function showEmpty(text) {
    tbody.textContent = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = COLUMNS;
    td.className = "flows-empty";
    td.textContent = text;
    tr.append(td);
    tbody.append(tr);
    tableWrap.hidden = false;
  }

  /* ---------- events ---------------------------------------------- */

  function add(symbols) {
    const fresh = [];
    for (const s of symbols) {
      if (book.has(s)) continue;
      if (book.size >= MAX_SYMBOLS) break;
      book.set(s, { selected: true, state: "idle", payload: null, error: null });
      fresh.push(s);
    }
    writeURL();
    renderList();
    if (fresh.length) runPool(fresh, {});
    return fresh;
  }

  entry.addEventListener("submit", (event) => {
    event.preventDefault();
    const wanted = normalise(String(input.value || "").split(/[,\s]+/));
    if (!wanted.length) {
      statusEl.textContent = "That is not a symbol this desk can price.";
      return;
    }
    /* Count the symbols that actually NEED a slot, not every symbol typed. A
       user with 19 on the desk who types "AAPL MSFT" where AAPL is already
       there needs one slot and has one, and telling them the desk is full is
       wrong. Comparing wanted.length against the room did exactly that. */
    const needSlots = wanted.filter((w) => !book.has(w));
    const room = MAX_SYMBOLS - book.size;
    const added = add(wanted);
    input.value = "";
    if (!needSlots.length) {
      statusEl.textContent = wanted.length === 1
        ? wanted[0] + " is already on the desk."
        : "Already on the desk.";
    } else if (added.length < needSlots.length) {
      /* The cap is a quota decision — each symbol is a live lookup — so it is
         stated as one rather than letting the overflow vanish unexplained,
         and it names what was dropped. */
      const dropped = needSlots.filter((w) => !book.has(w));
      statusEl.textContent = "The desk holds " + MAX_SYMBOLS +
        " symbols; each one is a live lookup. " +
        (dropped.length ? "Not added: " + dropped.join(", ") + ". " : "") +
        "Remove one to add another.";
    }
  });

  allBox.addEventListener("change", () => {
    const on = allBox.checked;
    for (const e of book.values()) e.selected = on;
    allBox.indeterminate = false;
    renderList();
    render();
    /* Selecting a symbol that has never been priced has to price it, or
       "select all" silently shows a partial table. */
    const missing = selectedSymbols().filter((s) => {
      const e = book.get(s);
      return e && e.state === "idle";
    });
    if (missing.length) runPool(missing, {});
  });

  refreshBtn.addEventListener("click", () => {
    const chosen = selectedSymbols();
    if (!chosen.length) { statusEl.textContent = "Select a symbol to refresh."; return; }
    /* refresh=1 asks the Worker to go back to the vendor. It may decline and
       serve the copy it has — the age in each row is what says which
       happened, rather than the button implying it always refetched. */
    runPool(chosen, { refresh: true });
  });

  clearBtn.addEventListener("click", () => {
    book.clear();
    writeURL();
    renderList();
    tbody.textContent = "";
    tableWrap.hidden = true;
    foot.textContent = "";
    updateStatus();
  });

  for (const sel of [strategySel, rankSel]) {
    if (!sel) continue;
    sel.addEventListener("change", () => {
      writeURL();
      /* Strategy changes what the API returns, so it must refetch. Rank is a
         property of the merged table and is applied locally — refetching for
         a sort would spend a vendor call to reorder rows already in hand. */
      if (sel === strategySel) {
        for (const e of book.values()) { e.state = "idle"; e.payload = null; }
        renderList();
        const chosen = selectedSymbols();
        if (chosen.length) runPool(chosen, {});
        else render();
      } else {
        render();
      }
    });
  }

  /* ---------- boot ------------------------------------------------- */
  const initial = readURL();
  if (initial.length) add(initial);
  else { renderList(); updateStatus(); }
})();
