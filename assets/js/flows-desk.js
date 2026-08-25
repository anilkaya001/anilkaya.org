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
  const pane = document.getElementById("deskPane");
  const tableWrap = document.getElementById("deskTableWrap");
  const tbody = document.getElementById("deskBody");
  const foot = document.getElementById("deskFoot");
  const bpInput = document.getElementById("deskBP");
  const bpClear = document.getElementById("deskBPClear");
  const planEl = document.getElementById("deskPlan");
  const collectHead = document.getElementById("deskCollectHead");
  if (!entry || !input || !list || !tbody) return;

  const BASE_COLUMNS = 13;          // keep in sync with the <thead> in flows-pages.js
  const MAX_BUYING_POWER = 1e11;    // past this the integer maths stops being exact
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

  /* THE ACCOUNT SIZE, or null when the reader has not said. Null is not zero
     and the two must not collapse: zero buying power would size every line to
     nought contracts and report a desk full of "$0", which reads as a broken
     calculation rather than as an unanswered question. */
  let buyingPower = null;

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

  function formatBuyingPower(v) {
    const n = isNum(v);
    return n === null ? "" : Math.round(n).toLocaleString("en-US");
  }

  function fmtAge(seconds) {
    const n = isNum(seconds);
    if (n === null) return "";
    if (n < 45) return "just now";
    if (n < 5400) return Math.round(n / 60) + "m ago";
    return Math.round(n / 3600) + "h ago";
  }

  /* ---------- buying power ----------------------------------------

     WHY THIS ARITHMETIC LIVES HERE TOO. sizeToBuyingPower() in
     shared/flows-premium.js is its authority, and the Worker could run it —
     but only by taking the account size as a request parameter, which would
     put it in the cache key (fragmenting a shared edge cache one balance per
     reader) and in an access log. It is three lines of integer division over
     numbers already on the row, so it runs in the page and the balance never
     leaves the browser.

     A copy is a drift hazard, and the answer to that is a test rather than a
     comment: tests/flows-desk-contract.mjs reads the Collect column out of a
     real browser and checks it against sizeToBuyingPower() computed in Node
     over the same fixture. If these two ever disagree, that assertion fails.

     CASH-SECURED, DELIBERATELY. A put reserves the whole strike here. A broker
     offering margin reserves a fraction of it and would let the same balance
     write several times these contracts — modelling which needs that broker's
     margin formula, a free parameter per account. This under-counts on
     purpose; a desk that flatters the balance is the worse failure. */

  /** Accepts "25000", "25,000", "$25k", "1.2m". Null when it is not a number. */
  function parseBuyingPower(raw) {
    const text = String(raw === null || raw === undefined ? "" : raw)
      .trim().toLowerCase().replace(/[$,\s_]/g, "");
    if (!text) return null;
    const m = /^(\d*\.?\d+)([kmb])?$/.exec(text);
    if (!m) return null;
    const base = Number(m[1]);
    if (!Number.isFinite(base) || base <= 0) return null;
    const scale = m[2] === "b" ? 1e9 : m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1;
    const value = base * scale;
    if (!(value > 0) || value > MAX_BUYING_POWER) return null;
    return value;
  }

  /** The mirror of sizeToBuyingPower(). Integer division and nothing else. */
  function sizeRow(row, bp) {
    if (bp === null || !(bp > 0)) return null;
    const collateral = isNum(row && row.collateral);
    const premium = isNum(row && row.premium);
    if (collateral === null || !(collateral > 0)) return null;
    if (premium === null || !(premium > 0)) return null;
    const contracts = Math.floor(bp / collateral);
    const deployed = contracts * collateral;
    return {
      contracts,
      /* Zero contracts is a READING, not a gap: this line costs more than the
         account holds, which is precisely what a $5,000 account needs told
         about a $443 stock. Dropping the row would leave it wondering. */
      affordable: contracts > 0,
      collectible: contracts * premium,
      deployed,
      idle: bp - deployed,
      yieldOnDeployed: deployed > 0 ? (contracts * premium) / deployed : null,
    };
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
      buyingPower = parseBuyingPower(q.get("bp"));
      if (bpInput && buyingPower !== null) bpInput.value = formatBuyingPower(buyingPower);
      /* A URL asking for the collectible ranking without a balance is asking
         for a sort key nothing can compute. Fall back rather than render an
         all-dashes column and an order nobody chose. */
      if (rankSel && rankSel.value === "collectible" && buyingPower === null) {
        rankSel.value = "annualized";
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
      if (buyingPower !== null) url.searchParams.set("bp", String(Math.round(buyingPower)));
      else url.searchParams.delete("bp");
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
        parts.push(fmtInt(p.priced) + " sellable" + (p.truncated ? " of a partial chain" : ""));
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

    /* THE SERVER RANKS TO DECIDE WHAT TO TRUNCATE, not to decide what the
       reader sees — the merged table is re-sorted here. That distinction only
       matters for one key. "Premium collectible" is contracts x premium, and
       contracts depends on a balance the Worker deliberately never learns, so
       it cannot be a server rank at all.

       Its proxy is yield on collateral, and the substitution is exact enough
       to name: collectible = floor(bp/C)*P, and since floor(x) > x-1 that sits
       in (bp*P/C - P, bp*P/C]. Ranking by P/C therefore orders the same rows,
       except where two lines' bp*yield differ by less than a single contract's
       premium. So the 120 rows the Worker keeps are the right 120 to keep. */
    const wanted = rankSel ? rankSel.value : "annualized";
    const params = new URLSearchParams({
      t: symbol,
      strategy: strategySel ? strategySel.value : "both",
      rank: wanted === "collectible" ? "yieldOnCollateral" : wanted,
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
    /* SIZE EVERY ROW BEFORE RANKING, because with a balance set the sort key
       may BE the sizing. Attached to the row rather than recomputed in the
       comparator: a sort calls its comparator O(n log n) times and integer
       division inside one is how a 2,400-row merge gets slow for nothing. */
    for (const r of rows) r.__sizing = sizeRow(r, buyingPower);

    const key = rankSel ? rankSel.value : "annualized";
    const sortKey = key === "collectible"
      ? (r) => (r.__sizing ? r.__sizing.collectible : null)
      : (r) => r[key];
    rows.sort((a, b) => {
      const x = sortKey(a), y = sortKey(b);
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
        setPaneVisible(false);
      }
      foot.textContent = "";
      renderPlan([]);
      updateStatus(oldest);
      return;
    }

    /* The header is toggled in the same pass that decides whether the cells
       exist. Two places deciding one column is how a table grows a header
       with nothing under it. */
    if (collectHead) collectHead.hidden = buyingPower === null;

    const frag = document.createDocumentFragment();
    for (const r of rows) frag.append(rowFor(r));
    tbody.append(frag);
    setPaneVisible(true);
    renderPlan(rows);

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
    /* A TRUNCATED CHAIN IS NOT A CHAIN, and saying "N of 1000" when 1000 was a
       ceiling rather than a count misrepresents the universe this ranking was
       taken over — most damagingly in a merged table, where a cut-off slice of
       a huge chain sits beside a complete small one. */
    const cut = chosen.filter((s) => {
      const p = (book.get(s) || {}).payload;
      return p && p.truncated;
    });
    const universe = cut.length
      ? priced + " of at least " + screened + " quoted contracts are sellable"
      : priced + " of " + screened + " quoted contracts are sellable";
    foot.textContent = universe +
      (dropped.length
        ? ". The rest fail a gate: " + dropped.join(", ") +
          " — each counted once, under the first gate it failed."
        : ".") +
      (cut.length
        ? " " + cut.join(", ") + " " + (cut.length === 1 ? "has" : "have") +
          " more contracts than this desk fetches, so " +
          (cut.length === 1 ? "its" : "their") + " ranking is taken over a partial chain."
        : "");
    updateStatus(oldest);
  }

  /* ---------- the session plan -------------------------------------

     THE ROW-LEVEL COLUMN ANSWERS "what does this line pay me". This answers
     the question above it: given the whole ranked set and this balance, what
     is the best single line, and how much of the account does it leave idle?

     ONE LINE, NOT A PORTFOLIO. Stacking the top N until the balance runs out
     would be a bigger number and a worse one: those N are not independent —
     they are frequently the same underlying at three strikes, so the "diversified"
     total is one concentrated bet wearing three tickets. Sizing that honestly
     needs a correlation matrix, which needs estimates this desk does not have.
     So it reports the best single deployment, which is arithmetic, and stops. */
  function renderPlan(rows) {
    if (!planEl) return;
    if (buyingPower === null || !rows.length) { planEl.hidden = true; planEl.textContent = ""; return; }

    let best = null;
    let affordable = 0;
    for (const r of rows) {
      const z = r.__sizing;
      if (!z || !z.affordable) continue;
      affordable++;
      if (best === null || z.collectible > best.__sizing.collectible) best = r;
    }

    if (!best) {
      planEl.hidden = false;
      planEl.className = "desk-plan is-empty";
      /* NOT "no results". Every line was priced; none is purchasable at this
         size, and the cheapest one says by how much. */
      let cheapest = null;
      for (const r of rows) {
        const c = isNum(r.collateral);
        if (c === null) continue;
        if (cheapest === null || c < cheapest) cheapest = c;
      }
      planEl.textContent = fmtMoney(buyingPower) + " does not cover a single contract here. " +
        (cheapest === null ? "" : "The cheapest line on the table ties up " + fmtMoney(cheapest) + ".");
      return;
    }

    const z = best.__sizing;
    const side = best.strategy === "cc" ? "covered call" : "cash-secured put";
    planEl.hidden = false;
    planEl.className = "desk-plan";
    planEl.textContent =
      fmtMoney(buyingPower) + " buying power · " + affordable + " of " + rows.length +
      " lines affordable · best single deployment: " + z.contracts + "\u00d7 " +
      (best.ticker || "?") + " " + fmt2(best.strike) + " " + side + " expiring " +
      (best.expiry || "?") + " collects " + fmtMoney(z.collectible) + ", deploying " +
      fmtMoney(z.deployed) + " and leaving " + fmtMoney(z.idle) + " idle (" +
      fmtPct(z.yieldOnDeployed, 2) + " on capital committed).";
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
    /* THE EARNINGS MARKER RIDES THE EXPIRY CELL rather than claiming a
       fourteenth column. A desk that grows a column per fact has answered
       "what else could we show" instead of "what is this table for".

       A cushion is a diffusion number; an earnings report is a jump. Two rows
       with identical premium and identical cushion are different trades when
       one of them outlives a report. */
    const exp = cell(fmtExpiry(r.expiry, r.days), "c-num");
    if (r.crossesEarnings === true) {
      exp.className = "c-num crosses-earnings";
      exp.textContent = fmtExpiry(r.expiry, r.days) + " \u26a0";
      exp.title = "This contract expires after the next earnings report. The cushion on " +
        "this line is a diffusion number priced against a jump.";
    } else if (r.crossesEarnings === null) {
      /* NOT THE SAME AS "no earnings before expiry", and the difference is the
         dangerous direction for a seller. Rendered identically to a clean row
         it would read as "event-free" when the truth is "cannot tell". */
      exp.className = "c-num earnings-unknown";
      exp.title = "Whether this contract outlives the next earnings report could not be " +
        "determined. Treat the cushion with that in mind.";
    }
    tr.append(exp);
    tr.append(cell(fmt2(r.bid), "c-num"));
    tr.append(cell(fmtMoney(r.premium), "c-num"));

    /* WHAT THIS ACCOUNT ACTUALLY COLLECTS, which is the number a seller with
       finite capital is really ranking on. A 3% yield on $38,000 of collateral
       and a 3% yield on $4,700 are the same percentage and completely
       different trades once the balance is fixed. The column exists only when
       a balance does — a column of dashes teaches nothing. */
    if (buyingPower !== null) {
      const z = r.__sizing;
      const td = document.createElement("td");
      td.className = "c-num c-collect";
      if (!z) {
        td.textContent = DASH;
        td.title = "This line has no quotable collateral or premium to size against.";
      } else if (!z.affordable) {
        /* NOT A DASH AND NOT A BLANK. "$0" is the true answer and it is a
           different fact from "unmeasured": one contract of this costs more
           than the whole account. Marked so it reads as a verdict. */
        td.className = "c-num c-collect is-unaffordable";
        td.textContent = "$0";
        td.title = "One contract ties up " + fmtMoney(r.collateral) + ", which is more than " +
          fmtMoney(buyingPower) + ". Nothing to collect here.";
      } else {
        td.textContent = fmtMoney(z.collectible) + " (" + z.contracts + "\u00d7)";
        td.title = z.contracts + " contract" + (z.contracts === 1 ? "" : "s") + " at " +
          fmtMoney(r.premium) + " each. Deploys " + fmtMoney(z.deployed) + " of " +
          fmtMoney(buyingPower) + ", leaving " + fmtMoney(z.idle) + " idle — a return of " +
          fmtPct(z.yieldOnDeployed, 2) + " on the capital actually committed.";
      }
      tr.append(td);
    }

    tr.append(cell(fmtPct(r.yieldOnCollateral, 2), "c-num"));

    /* The annualized figure is a CONVENTION and the payload says so. It is
       marked in the DOM too: a 900% cell that looks like every other cell is
       read as a return, whatever the column header promised. */
    const ann = cell(fmtPct(r.annualized, 0), "c-num c-ann");
    if (r.annualizedIsConvention) {
      ann.title = "Simple 365/days scaling, for comparing tenors. Not a return anyone earns.";
    }
    tr.append(ann);

    /* THE CUSHION IS ONLY AS FRESH AS THE VOL IT DIVIDES BY, and that vol is
       the LAST TRANSACTION's, not a quote. A contract that has not traded
       today carries an IV of unknown age, and this is the page's flagship
       honest number — rendering a four-session-old cushion identically to one
       from a line that traded all morning is the same omission as showing a
       cached row as live. Marked, not withheld: it is still the best reading
       available, and hiding it would be the worse lie. */
    const cushion = cell(fmtSigmas(r.cushionSigmas), "c-num" + (r.ivTraded === false ? " is-stale-iv" : ""));
    if (r.ivTraded === false) {
      cushion.title = "This contract has not traded today, so its implied volatility is the " +
        "last transaction's — of unknown age. The cushion is as old as that print.";
    }
    tr.append(cushion);
    tr.append(cell(fmt2(r.breakeven), "c-num"));

    /* THE OTHER HALF OF A COVERED CALL, and it was computed, serialised and
       shipped on every row without ever being drawn. The desk told a
       covered-call seller what they get paid and not what they gave up: if the
       shares are called away, assignedReturn is the whole trade's return, and
       capSigmas is how far the market must run in the option's own implied
       moves before that happens.

       A put genuinely has no upside cap — its best case is keeping the premium,
       which is already the Yield column — so the cell is a dash that SAYS so.
       An unexplained dash reads as missing data, and this one is a real
       absence rather than an unmeasured quantity. */
    const called = cell(fmtPct(r.assignedReturn, 1), "c-num");
    if (r.strategy === "cc") {
      if (isNum(r.capSigmas) !== null) {
        called.title = "Called away at " + fmt2(r.strike) + ", the whole position returns " +
          fmtPct(r.assignedReturn, 1) + ". The market has to run " + fmtSigmas(r.capSigmas) +
          " — in this option's own implied moves — to get there.";
      }
    } else {
      called.textContent = DASH;
      called.title = "A cash-secured put has no upside cap. Its best case is keeping the " +
        "premium, which is the Yield column.";
      called.className = "c-num is-na";
    }
    tr.append(called);
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

    /* THE EARNINGS CLAUSE, per symbol, INCLUDING the symbols with no date.
       An unmarked row has to be unmarked for a stated reason, or "no marker"
       silently means both "no report before expiry" and "we could not find
       out" — and only one of those is safe to sell into. */
    const earnBits = [];
    for (const sym of chosen) {
      const p = (book.get(sym) || {}).payload;
      if (!p || p.state === "error") continue;
      const e = p.earnings;
      const rows = (p.rows || []).filter((r) => r.ticker === sym || chosen.length === 1);
      const crossing = (p.rows || []).filter((r) => r.crossesEarnings === true).length;
      if (!e || !e.date) {
        /* An ETF genuinely has none; an equity's may merely be unknown. The
           vendor's own issue_type separates them, so the page does too. */
        const etf = e && /etf|index|fund/i.test(String(e.issueType || ""));
        earnBits.push(sym + (etf ? " has no earnings (" + e.issueType + ")" : " has no known earnings date"));
      } else if (crossing > 0) {
        earnBits.push(sym + " reports " + String(e.date).slice(5) + " — " + crossing +
          " of " + (p.rows || []).length + " lines expire after it");
      } else {
        earnBits.push(sym + " reports " + String(e.date).slice(5) + " — no line expires after it");
      }
    }
    const earnNote = earnBits.length ? " · " + earnBits.join("; ") : "";

    statusEl.textContent = (failed.length
      ? chosen.length - failed.length + " of " + chosen.length + " symbols priced · " +
        failed.join(", ") + " unavailable"
      : chosen.length + " symbol" + (chosen.length === 1 ? "" : "s") + " priced") +
      session + age + staleNote + earnNote;
  }

  function showEmpty(text) {
    tbody.textContent = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = BASE_COLUMNS + (buyingPower === null ? 0 : 1);
    td.className = "flows-empty";
    td.textContent = text;
    tr.append(td);
    tbody.append(tr);
    setPaneVisible(true);
  }

  /* Assigned by the resize controller below. A hidden element measures zero
     on every axis, so the grips' announced percentages are meaningless until
     the pane is on screen — they are recomputed the moment it is. */
  let announcePane = () => {};

  function setPaneVisible(on) {
    if (pane) pane.hidden = !on;
    else if (tableWrap) tableWrap.hidden = !on;
    if (on) announcePane();
  }

  /* ---------- the resizable pane -----------------------------------

     THE TABLE IS THIRTEEN COLUMNS AND CAN BE HUNDREDS OF ROWS, and no single
     size suits both "scan the top five" and "read the whole chain". So the
     reader sizes it.

     WHAT IS DRAGGABLE, AND WHY NOT EVERYTHING. The pane sits in normal
     document flow, so its top-left corner is fixed by what precedes it. A
     handle on the top or left edge cannot resize the box; it can only MOVE
     it, which reflows the page under the cursor mid-drag. Half the grips an
     "all corners" pane implies are page-reflow handles wearing a resize
     cursor. The right edge, the bottom edge and the bottom-right corner
     between them reach every size the other five could, without that.

     ALL THREE ARE KEYBOARD-OPERABLE, which is the reason this is written
     rather than left to CSS `resize: both`. The native corner is a pointer
     affordance and nothing else: a keyboard user cannot reach it, and a
     screen reader is never told the pane is resizable at all.

     WIDTH ON THE PANE, HEIGHT ON THE SCROLLER. The grips are positioned
     against the pane, so narrowing the wrapper instead would leave the grip
     at the old edge with a gap between it and the thing it claims to move.

     THE SIZE IS NOT PERSISTED. storage.js is this site's sanctioned owner of
     browser-local state and Flows does not load it; a pane size is also the
     one piece of desk state that is about this screen rather than this
     analysis, so it has no business in a shareable URL either. It lasts the
     page, and Reset puts it back. */
  (() => {
    const gripX = document.getElementById("deskGripX");
    const gripY = document.getElementById("deskGripY");
    const gripXY = document.getElementById("deskGripXY");
    const reset = document.getElementById("deskGripReset");
    if (!pane || !tableWrap) return;

    const MIN_W = 320, MIN_H = 160;
    const STEP = 48;                  // one arrow press, in CSS pixels

    function maxW() {
      const parent = pane.parentElement;
      return parent ? Math.max(MIN_W, parent.clientWidth) : MIN_W;
    }
    function maxH() {
      /* The viewport, less the chrome above the pane. A pane taller than the
         screen is not a bigger pane, it is a second scrollbar. */
      const top = pane.getBoundingClientRect().top;
      return Math.max(MIN_H, Math.round(window.innerHeight - top - 24));
    }

    /* MIN_W/MIN_H are ALSO in the stylesheet, and it is the stylesheet that
       actually binds: a pane given an inline width below its CSS min-width
       still lays out at the minimum. The clamp here is deliberate belt and
       braces — it keeps the inline value honest for anything that reads it
       back, and it holds on the window-resize path where no drag occurred.
       A mutation test that removes only one of the two still passes; both
       have to go before the pane can be collapsed. */
    const clamp = (v, lo, hi) => Math.round(Math.min(hi, Math.max(lo, v)));

    function announce() {
      const w = pane.getBoundingClientRect().width;
      const h = tableWrap.getBoundingClientRect().height;
      const pctW = String(clamp(w / maxW() * 100, 0, 100));
      const pctH = String(clamp(h / maxH() * 100, 0, 100));
      if (gripX) gripX.setAttribute("aria-valuenow", pctW);
      if (gripY) gripY.setAttribute("aria-valuenow", pctH);
      if (reset) reset.hidden = !pane.style.width && !tableWrap.style.height;
    }
    announcePane = announce;

    function setW(px) { pane.style.width = clamp(px, MIN_W, maxW()) + "px"; announce(); }
    function setH(px) { tableWrap.style.height = clamp(px, MIN_H, maxH()) + "px"; announce(); }

    /** `axes` is "x", "y" or "xy". One handler, because a corner is not a
     *  third kind of drag — it is both of the other two at once. */
    function wire(grip, axes) {
      if (!grip) return;
      const doX = axes.indexOf("x") >= 0;
      const doY = axes.indexOf("y") >= 0;

      grip.addEventListener("pointerdown", (event) => {
        /* Primary button only. A right-click that begins a drag swallows the
           context menu the reader was asking for. */
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX, startY = event.clientY;
        const startW = pane.getBoundingClientRect().width;
        const startH = tableWrap.getBoundingClientRect().height;
        try { grip.setPointerCapture(event.pointerId); } catch { /* older pointer stacks */ }
        pane.classList.add("is-resizing");

        const move = (e) => {
          if (doX) setW(startW + (e.clientX - startX));
          if (doY) setH(startH + (e.clientY - startY));
        };
        const stop = () => {
          grip.removeEventListener("pointermove", move);
          grip.removeEventListener("pointerup", stop);
          grip.removeEventListener("pointercancel", stop);
          pane.classList.remove("is-resizing");
        };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", stop);
        grip.addEventListener("pointercancel", stop);
      });

      grip.addEventListener("keydown", (event) => {
        const k = event.key;
        const w = pane.getBoundingClientRect().width;
        const h = tableWrap.getBoundingClientRect().height;
        let handled = true;
        if (doX && k === "ArrowRight") setW(w + STEP);
        else if (doX && k === "ArrowLeft") setW(w - STEP);
        else if (doY && k === "ArrowDown") setH(h + STEP);
        else if (doY && k === "ArrowUp") setH(h - STEP);
        else if (k === "Home") { if (doX) setW(MIN_W); if (doY) setH(MIN_H); }
        else if (k === "End") { if (doX) setW(maxW()); if (doY) setH(maxH()); }
        else handled = false;
        if (handled) event.preventDefault();
      });
    }

    wire(gripX, "x");
    wire(gripY, "y");
    wire(gripXY, "xy");

    if (reset) {
      reset.addEventListener("click", () => {
        pane.style.width = "";
        tableWrap.style.height = "";
        announce();
      });
    }

    window.addEventListener("resize", () => {
      /* A window narrower than the pane leaves a table whose right edge
         nobody can reach. Re-clamp rather than let a pixel width outlive the
         viewport that justified it. */
      if (pane.style.width) setW(pane.getBoundingClientRect().width);
      if (tableWrap.style.height) setH(tableWrap.getBoundingClientRect().height);
    });
    announce();
  })();

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
    setPaneVisible(false);
    foot.textContent = "";
    renderPlan([]);
    updateStatus();
  });

  /* ---------- the buying-power field --------------------------------

     APPLIED ON INPUT, NOT ON SUBMIT. Every number this drives is already in
     the browser — no vendor call, no network, no quota — so a button between
     typing a balance and seeing what it buys would be ceremony over nothing.
     Contrast the symbol field, which spends a metered credential and is
     therefore rightly a form with an explicit Add. */
  function applyBuyingPower(raw) {
    const next = parseBuyingPower(raw);
    const changed = next !== buyingPower;
    buyingPower = next;
    if (bpClear) bpClear.hidden = !String(raw || "").trim();
    if (bpInput) {
      /* An unparseable entry is MARKED rather than silently ignored: typing
         "25.000.00" and seeing the column vanish with no explanation reads as
         a broken page. */
      const dirty = String(raw || "").trim().length > 0;
      bpInput.classList.toggle("is-invalid", dirty && next === null);
      bpInput.setAttribute("aria-invalid", dirty && next === null ? "true" : "false");
    }
    /* A collectible ranking with no balance has no sort key. Rather than
       leave the table ordered by a column that no longer exists, fall back
       and say so in the same breath as the column disappearing. */
    if (buyingPower === null && rankSel && rankSel.value === "collectible") {
      rankSel.value = "annualized";
    }
    if (changed) { writeURL(); render(); }
  }

  if (bpInput) {
    bpInput.addEventListener("input", () => applyBuyingPower(bpInput.value));
    bpInput.addEventListener("change", () => {
      /* Normalise the display only when the reader leaves the field. Doing it
         per keystroke fights the caret: "2500" becomes "2,500" and the cursor
         lands in the wrong place before they have finished typing "25000". */
      if (buyingPower !== null) bpInput.value = formatBuyingPower(buyingPower);
      applyBuyingPower(bpInput.value);
    });
    /* A form control inside no form still needs Enter to mean "done". */
    bpInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); bpInput.blur(); }
    });
  }

  if (bpClear) {
    bpClear.addEventListener("click", () => {
      if (bpInput) bpInput.value = "";
      applyBuyingPower("");
      if (bpInput) bpInput.focus();
    });
  }

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
        /* Choosing a ranking that needs a balance, with no balance, is a
           request for a number rather than a mistake. Send the reader to the
           field that answers it instead of silently reverting the select. */
        if (sel.value === "collectible" && buyingPower === null) {
          sel.value = "annualized";
          writeURL();
          statusEl.textContent = "Enter a buying power to rank by premium collectible.";
          if (bpInput) { bpInput.focus(); bpInput.select(); }
          return;
        }
        render();
      }
    });
  }

  /* ---------- boot ------------------------------------------------- */
  const initial = readURL();
  /* readURL() sets `buyingPower` directly, so the field's own affordances —
     the Clear button, the invalid marker — have never run. Restoring a desk
     from a link must land in the same state as typing it. */
  if (bpInput) applyBuyingPower(bpInput.value);
  if (initial.length) add(initial);
  else { renderList(); updateStatus(); }
})();
