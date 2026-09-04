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

   EVERY NUMBER SAYS HOW OLD IT IS, AND THE AGE IS A FUNCTION OF NOW.
   The route serves from an edge cache and answers a throttled refresh
   with the copy it already has. A desk that renders a two-minute-old
   quote identically to a live one is lying by omission, so the age
   ships in the row. It was still lying: X-Chain-Age was read once at
   fetch and rendered forever, so a desk priced at 09:31 and left open
   said "just now" at 10:11. The header states the age AT THE INSTANT
   OF THE RESPONSE and everything after it is wall clock, so the
   reception instant is stored beside it and the two are added at
   render — on a thirty-second tick, because nothing else on this page
   moves on its own.

   THE TABLE IS A SLICE AND SAYS SO. The Worker ranks each chain and
   keeps the top slice of it; a ranked list that truncates in silence
   reads as "this is everything". Every cut is stated with the number
   kept, the number it was cut from, and the ordering that decided it —
   and because that ordering decided WHICH rows survived, changing the
   ranking on a cut symbol cannot be honoured by re-sorting the rows in
   hand. It goes back to the chain.
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

  /* HOW OFTEN THE PRINTED AGES ARE REDRAWN. fmtAge() below is minute-grained
     above forty-five seconds, so a half-minute tick is the coarsest period
     that never shows a stale minute. Nothing else on this page moves without a
     keystroke, which is exactly why the age used to freeze. */
  const AGE_TICK_MS = 30000;

  /* PAST THIS THE DESK STOPS CALLING THEM QUOTES. Deliberately NOT the
     Worker's own cache TTL: coupling the browser to a server constant makes
     two numbers that have to be edited together, and this is a different
     statement anyway. Not "the cache would have expired" but "a table of bids
     this old is a record of a market rather than a price in it". */
  const QUOTE_STALE_SECONDS = 300;

  /* The SAME pattern the Worker validates against. If the two disagree, a
     symbol the user can add is one the API refuses, which reads as a broken
     desk rather than as a rejected input. */
  const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

  const MINUS = "−";           // U+2212, not a hyphen
  const DASH = "—";

  /** symbol -> { selected, state: "idle"|"loading"|"ok"|"error", payload, error } */
  const book = new Map();
  let inflight = 0;

  /* WHOSE SENTENCE IS IN THE STATUS LINE. Most of the time it is
     updateStatus()'s, which is free to rewrite it whenever anything changes.
     Sometimes it is a one-off answer to something the reader just did — "that
     is not a symbol", "the desk holds 20" — and the age tick, which fires on a
     clock rather than on an action, must not silently eat one of those thirty
     seconds after it was written. say() marks the line as the handler's; any
     call to updateStatus() takes it back. */
  let statusOwned = true;
  function say(text) { statusEl.textContent = text; statusOwned = false; }

  /* THE ACCOUNT SIZE, or null when the reader has not said. Null is not zero
     and the two must not collapse: zero buying power would size every line to
     nought contracts and report a desk full of "$0", which reads as a broken
     calculation rather than as an unanswered question. */
  let buyingPower = null;

  /* ---------- formatting ------------------------------------------
     One place for every number, and the rule from the board holds: never
     print a precision the data does not have, and never render a missing
     value as 0 — a confident zero is a lie the reader cannot detect. */

  /* MISSING IS TESTED BEFORE COERCION, because Number(null) is 0 and
     Number("") is 0 and both are finite — so the one helper whose entire job
     is telling a missing value from a real one answered 0 for null.

     The board's copy of this helper carried the identical defect and was
     fixed earlier today. This one was worked around instead: a second reader,
     numOr(), was added beside it for the three call sites where a null is a
     FINDING rather than an absence — atmIv null means "this expiry has no
     at-the-money quote this page will vouch for", skew null means "this
     contract has no known place on a smile" — leaving the other twenty-one
     callers reading a null as a confident zero. Two readers for one question
     is how the next caller picks the wrong one. */
  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
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

  /* THE AGE OF A PAYLOAD, AT THE MOMENT OF ASKING. `__age` is what the route's
     X-Chain-Age header said when the response arrived and `__at` is when that
     was; everything since is the browser's own clock. The previous version
     stored only the first number and printed it forever, so an hour-old desk
     still read "just now" — the exact omission the file header calls out for
     cached rows, committed by the code that was meant to prevent it.

     A payload with no `__at` gets the header's reading unchanged rather than
     an invented elapsed time: a missing reception instant means the age cannot
     be advanced honestly, and guessing one is how a frozen number becomes a
     wrong number. */
  function ageOf(payload) {
    if (!payload) return null;
    const base = isNum(payload.__age);
    if (base === null) return null;
    const at = isNum(payload.__at);
    if (at === null) return base;
    return base + Math.max(0, (Date.now() - at) / 1000);
  }

  /** The age of the oldest quote on the table, and how many priced symbols
   *  could not state one: { oldest, unaged }.
   *
   *  TWO SILENCES, KEPT APART. `oldest` is null both when nothing is priced and
   *  when everything priced arrived without an age, and those are not the same
   *  reading — the first is a desk with no table, the second is a table whose
   *  freshness the route did not publish. Returning one null for both is how
   *  the status line came to say nothing at all in the second case, which is
   *  indistinguishable from a fresh desk. */
  function quoteAge() {
    let oldest = null, unaged = 0;
    for (const symbol of selectedSymbols()) {
      const state = book.get(symbol);
      if (!state || state.state !== "ok" || !state.payload) continue;
      const age = ageOf(state.payload);
      if (age === null) { unaged++; continue; }
      if (oldest === null || age > oldest) oldest = age;
    }
    return { oldest, unaged };
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
      /* Which surface was on screen when the link was made. Validated against
         the same pattern the watchlist is, then re-checked against the symbols
         that actually priced — a link naming a symbol that has since left the
         desk falls back to the first rather than showing nothing. */
      const wantedSurface = String(q.get("surface") || "").trim().toUpperCase();
      surfaceSymbol = TICKER_RE.test(wantedSurface) ? wantedSurface : null;
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
      if (surfaceSymbol !== null && book.has(surfaceSymbol)) url.searchParams.set("surface", surfaceSymbol);
      else url.searchParams.delete("surface");
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

  /** Everything a chip says about one symbol, as text. Extracted from
   *  renderList() so the age tick can redraw it in place — see tickAges(). */
  function noteFor(entryState) {
    if (!entryState) return "";
    if (entryState.state === "loading") return "loading…";
    if (entryState.state === "error") return entryState.error || "failed";
    const p = entryState.payload;
    if (!p) return "";
    const parts = [];
    if (isNum(p.spot) !== null) {
      /* WHICH PRICE THIS WAS PRICED AGAINST. A covered call's collateral IS
         the shares at spot and every moneyness is measured from it, so a
         table built on yesterday's close and one built on a live print are
         different tables. Rendering them identically is the same omission
         as showing a cached row as live. */
      parts.push("$" + fmt2(p.spot) + (p.spotSource === "daily-close" ? " close" : ""));
    }
    /* HOW MANY OF THE SELLABLE LINES ARE ACTUALLY ON THE TABLE. `priced` is
       the count BEFORE the Worker's slice and the rows are the count after,
       and the chip printed only the first — so a chain with 412 sellable lines
       announced 412 above a table holding 120, with nothing anywhere saying a
       cut had happened. Both numbers, whenever they differ. */
    const shown = (p.rows || []).length;
    const priced = isNum(p.priced);
    parts.push((priced !== null && shown < priced
      ? fmtInt(shown) + " of " + fmtInt(priced)
      : fmtInt(priced)) + " sellable" + (p.truncated ? " of a partial chain" : ""));
    /* AN AGE, OR THE SENTENCE THAT THERE ISN'T ONE — never neither. The chip
       used to append the age only when it had one, so a payload whose response
       carried no X-Chain-Age rendered exactly like a fresh one: no age, no
       claim, nothing to notice. On a page whose header promises that every
       number says how old it is, an omitted age reads as "this table does not
       need one". It is a different silence from "measured, and it is nought
       seconds", and only the second is a freshness claim. */
    const seconds = ageOf(p);
    /* Terse here and a full sentence in the status line, because this element
       is clipped at 14rem with an ellipsis: a clause long enough to be cut in
       half would report the silence by disappearing into it. */
    parts.push(seconds === null ? "age not stated" : fmtAge(seconds));
    return parts.join(" · ");
  }

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
      note.textContent = noteFor(entryState);
      /* THE NOTE ELEMENT IS KEPT so the age tick can rewrite its text without
         rebuilding the chip. A full renderList() every thirty seconds would
         destroy the focus ring on whichever checkbox the reader has their hands
         on, and a page that steals focus twice a minute is worse than one that
         is a minute out of date. */
      entryState.__note = note;
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

  /* WHICH KEY THE ROUTE IS ASKED FOR, given the key the select holds.

     THE SERVER RANKS TO DECIDE WHAT TO TRUNCATE, not to decide what the reader
     sees — the merged table is re-sorted here. That distinction only matters
     for one key. "Premium collectible" is contracts x premium, and contracts
     depends on a balance the Worker deliberately never learns, so it cannot be
     a server rank at all.

     Its proxy is yield on collateral, and the substitution is exact enough to
     name: collectible = floor(bp/C)*P, and since floor(x) > x-1 that sits in
     (bp*P/C - P, bp*P/C]. Ranking by P/C therefore orders the same rows, except
     where two lines' bp*yield differ by less than a single contract's premium.
     So the 120 rows the Worker keeps are the right 120 to keep.

     THIS IS A FUNCTION RATHER THAN AN EXPRESSION INSIDE fetchOne because the
     re-rank handler has to ask the same question — "would the route rank this
     differently?" — and a second copy of the mapping is how the two answers
     drift. Five options in the select, four keys on the wire. */
  function serverRank(key) {
    return key === "collectible" ? "yieldOnCollateral" : key;
  }

  async function fetchOne(symbol, { refresh = false } = {}) {
    const state = book.get(symbol);
    if (!state) return;
    state.state = "loading";
    state.error = null;
    /* WHICH REQUEST FOR THIS SYMBOL THIS IS. Changing the ranking now sends the
       cut names back to the chain, and a <select> fires `change` on every arrow
       key, so three requests for one symbol can be in flight under three
       different keys at once. They do not come back in the order they were
       sent — the browser is free to hand the second one over before the first —
       and the last writer won, which left the table holding a slice the select
       no longer names under a footnote naming an ordering nobody chose. A
       superseded response is dropped rather than rendered: it is not bad data,
       it is the answer to a question the reader has already moved on from. */
    const seq = (state.seq || 0) + 1;
    state.seq = seq;
    renderList();

    const params = new URLSearchParams({
      t: symbol,
      strategy: strategySel ? strategySel.value : "both",
      rank: serverRank(rankSel ? rankSel.value : "annualized"),
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
      /* THE AGE HEADER, TESTED FOR ABSENCE BEFORE IT IS COERCED. `headers.get`
         answers null for a header that was not sent and Number(null) is 0 and
         Number.isFinite(0) is true, so the previous line published an ABSENT
         age as an age of nought: a body of unknown vintage rendered as "just
         now". That is this repository's oldest scar wearing a header for a
         disguise, and it is worse here than usual because zero is also a real
         reading — the route sends X-Chain-Age: 0 on a cache miss and means
         measured-fresh. isNum() keeps those two apart; nothing else does. */
      const age = isNum(response.headers.get("X-Chain-Age"));
      const body = await response.json().catch(() => null);
      /* A NEWER REQUEST FOR THIS SYMBOL HAS BEEN SENT while this one was in the
         air. Writing here would overwrite it, or be overwritten by it, at the
         mercy of the network. Neither is rendered. */
      if (state.seq !== seq) return;
      if (!response.ok) {
        state.state = "error";
        state.error = messageFor(response.status, body);
        state.payload = null;
      } else if (!body) {
        /* A 200 THAT DID NOT PARSE IS NOT A PRICE. This landed in the "ok"
           branch with a null payload, which rendered a chip carrying a
           checkbox and no note at all, contributed no rows, and was still
           counted by the status line among the symbols priced — a desk
           claiming a table it does not have. The three silences are three
           different sentences and this is the second of them: the response
           arrived and could not be read. Nothing on the page said so. */
        state.state = "error";
        state.error = "unreadable response";
        state.payload = null;
      } else {
        state.state = "ok";
        state.payload = body;
        /* THE HEADER'S AGE AND THE INSTANT IT WAS TRUE, together. Storing the
           first without the second is what froze the desk's clock: the number
           is only an age when something says what it is an age FROM.

           No `if (body)` around this any more: an unparsed body is an error
           branch above, so reaching here means there is one to stamp. The
           guard survived the branch it was guarding against, which is how a
           condition becomes a claim nobody checks. */
        body.__age = age === null ? undefined : age;
        body.__at = age === null ? undefined : Date.now();
      }
    } catch {
      /* Superseded here too: a failed older request must not stamp an error
         over a newer one that is still on its way. */
      if (state.seq !== seq) return;
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
    /* PER-SYMBOL SLICE EVIDENCE. A merged table cannot state one cut, because
       each symbol is sliced against its own chain: naming them separately is
       the only version of the sentence that reconciles. */
    const slices = [];
    /* AND THE SYMBOLS WHOSE COUNTS THE PAYLOAD DID NOT STATE. See below: they
       are named rather than added as nought. */
    const uncounted = [];

    for (const symbol of chosen) {
      const state = book.get(symbol);
      if (!state || state.state !== "ok" || !state.payload) continue;
      const p = state.payload;
      const kept = (p.rows || []).length;
      const screenedN = isNum(p.screened);
      const sellable = isNum(p.priced);
      /* A PAYLOAD THAT DOES NOT STATE ITS OWN COUNTS IS NAMED, NOT ADDED AS
         ZERO. This was `screened += isNum(p.screened) || 0`, which turns a
         missing count into a nought and folds it into a published total —
         Number(null) is 0, this repository's oldest scar, and an accumulator is
         where it hides best because the total still looks like a number. A
         desk holding a chain whose counts went missing then announced "130 of
         130 quoted contracts are sellable" over a table that also carried two
         rows from a chain neither number counted.

         BOTH OR NEITHER, because the two are a PAIR in the sentence they feed
         ("N of M are sellable"). A symbol that can supply only one of them
         would tilt the ratio, which is a subtler wrong number than a missing
         one. A payload can lose a field for a dull reason — a body cached by
         an earlier deploy, a shape that changed — and the honest answer is to
         say which symbol is outside the totals. */
      if (screenedN === null || sellable === null) uncounted.push(symbol);
      else {
        screened += screenedN;
        priced += sellable;
        /* THE GATE COUNTS BELONG TO THE SAME RECONCILIATION. The footnote's
           standing claim is that excluded plus sellable equals screened, so a
           symbol held out of those two totals has to be held out of this one
           too — otherwise the partition below counts exclusions from a chain
           whose screened total it just declined to count. */
        for (const [reason, n] of Object.entries(p.gated || {})) {
          gatedTotals[reason] = (gatedTotals[reason] || 0) + (isNum(n) || 0);
        }
      }
      if (sellable !== null && kept < sellable) {
        slices.push({ symbol, kept, sellable, rankedBy: p.rankedBy || null });
      }
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

    /* DRAWN BEFORE THE TABLE'S OWN EARLY EXIT. A chain where nothing clears
       the liquidity gates still has a volatility surface — the surface is
       taken before those gates precisely because they are a statement about
       sellability and not about whether the quoted vol is real — so a desk
       that returned early on an empty table would hide the one panel that
       still had something to say. */
    renderSurface();

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
      updateStatus();
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
    /* Stated immediately after the totals it is missing from, because a reader
       who has already moved on has read the pair as covering the whole table. */
    const uncountedNote = uncounted.length
      ? " " + uncounted.join(", ") + " " + (uncounted.length === 1 ? "is" : "are") +
        " outside those two numbers: " + (uncounted.length === 1 ? "that payload" : "those payloads") +
        " did not say how many contracts were screened or how many are sellable, and a count " +
        "this page never received is not a count of nought."
      : "";
    /* THE CUT, STATED. Until this sentence existed the footnote said "412 of
       1,940 quoted contracts are sellable" above a table holding 120 of them,
       and nothing on the page said a slice had been taken — which reads as
       "these 120 ARE the 412". Three facts make it honest and all three are
       needed: how many are here, how many there were, and the ordering that
       chose between them, because a top-120 by annualised yield and a top-120
       by premium are different hundred and twenty rows. */
    /* THE SHORTFALL IS THE SUM OF THE CUTS THIS SENTENCE JUST ENUMERATED, and
       it was `priced - shown`: two totals accumulated over EVERY selected
       symbol, cut or not. Those agree only while every payload carries a
       numeric `priced` — and `priced` is accumulated through `|| 0`, so a
       payload that does not (a body cached by an earlier deploy, a shape that
       loses the field) contributes nought to the total while its rows still
       count toward what is shown. The published difference then under-states
       the cut, and with enough such rows goes NEGATIVE: "−15 lines below the
       cut are not on this table", printed with a hyphen where this file spells
       minus U+2212. Summing the per-symbol evidence cannot do that: every term
       is a measured `sellable` minus a counted `kept`, both of which the
       sentence has already named out loud. */
    const belowCut = slices.reduce((total, c) => total + (c.sellable - c.kept), 0);
    const sliceNote = slices.length
      ? " This table is a slice: " +
        slices.map((c) => c.symbol + " shows its top " + fmtInt(c.kept) + " of " +
          fmtInt(c.sellable) + " sellable lines, ranked by " + rankWord(c.rankedBy)).join("; ") +
        " — " + fmtInt(belowCut) + (belowCut === 1 ? " line" : " lines") +
        " below the cut " + (belowCut === 1 ? "is" : "are") + " not on this table, " +
        "and re-sorting the ones that are cannot bring them back — so changing the " +
        "ranking refetches " +
        (slices.length === 1 ? "this name" : "these names") + " rather than reordering " +
        "what is already here."
      : "";
    foot.textContent = universe +
      (dropped.length
        ? ". The rest fail a gate: " + dropped.join(", ") +
          " — each counted once, under the first gate it failed."
        : ".") +
      uncountedNote +
      sliceNote +
      (cut.length
        ? " " + cut.join(", ") + " " + (cut.length === 1 ? "has" : "have") +
          " more contracts than this desk fetches, so " +
          (cut.length === 1 ? "its" : "their") + " ranking is taken over a partial chain."
        : "");
    updateStatus();
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

  /* ---------- the implied volatility surface -----------------------

     WHAT WAS ALREADY IN THE RESPONSE. Every contract the chain route returns
     carries a quoted implied volatility beside its strike and its expiry, and
     the page spent all of it on one column — the cushion — and dropped the
     rest. The surface those numbers describe costs no vendor call, no second
     fetch and no extra byte of quota: shared/flows-premium.js builds it inside
     the same pass that prices the chain and ships it on the payload.

     TWO READINGS, AND THEY NEED DIFFERENT CHANNELS.

       THE SMILE — how vol varies across strikes at one expiry. Read DOWN a
       column. Choosing between two strikes is choosing between two points on
       it, which is what the ranked table above never says.

       THE TERM STRUCTURE — how the level varies across tenors at one
       moneyness. Read ACROSS a row, and read off the strip under the grid,
       which is each expiry's at-the-money quote.

     THE LEVEL SWAMPS THE SHAPE IF THEY SHARE A CHANNEL. A heatmap of raw vol
     on a name whose front trades 45 and whose January trades 26 paints one
     column dark and the other light, and the smile inside each is invisible.
     So the SHADE is vol minus that expiry's own at-the-money quote — the
     smile with the level divided out — and the NUMBER printed in the cell is
     the quoted vol itself, unmodified.

     FIVE ENCODINGS, IN THIS ORDER, AND HUE IS LAST. Sign of the skew by
     hatch, magnitude by fill-opacity, moneyness by row, tenor by column,
     age of the print by the cell's border. Every one of those survives a
     greyscale print and a deuteranope reader; the colour duplicates the hatch
     and carries nothing on its own. This is the same discipline the gamma
     surface documents, for the same reason: a diverging red/green heatmap
     where hue is the only channel is the commonest way this chart is drawn
     and the commonest way it fails.

     NOTHING HERE IS MODELLED. A quoted implied volatility is an observable
     and the difference between two of them on the same expiry is arithmetic.
     No fitted smile, no interpolated surface, no model delta, no "fair" vol —
     each of those inverts or reprices an option, which needs a risk-free rate
     and a dividend yield, the two free parameters this desk refuses
     everywhere else. */

  /* NULL IS A MEASUREMENT HERE, AND isNum() CANNOT CARRY IT. Number(null) is
     0, so isNum(null) answers 0 — harmless for a field that is merely absent
     from a payload and catastrophic for one whose null is a finding. Every
     null on this surface is a finding: `atmIv` null means "this expiry has no
     at-the-money quote this page will vouch for" and `skew` null means "this
     contract has no known place on a smile". Read through isNum() both become
     zero, which draws a missing level as 0.0% and an unplaceable contract as
     sitting exactly at the money — two confident zeros, in the two spots where
     a confident zero is least detectable. This reader keeps null null.

     It was not a hypothetical: the first build of this panel printed "0.0" in
     the term-structure strip for the expiry that has no level, and the
     assertion in tests/flows-desk-contract.mjs that expects an em dash there
     is what caught it. */
  const numOr = isNum;

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const key of Object.keys(attrs || {})) {
      const value = attrs[key];
      if (value === null || value === undefined) continue;
      node.setAttribute(key, String(value));
    }
    return node;
  }

  /* TYPE AND COLOUR AS PRESENTATION ATTRIBUTES, NOT ONLY AS CLASSES, and the
     stylesheet still wins wherever both apply — a presentation attribute is
     the lowest-priority CSS declaration there is. This is the same belt the
     session path's premium line wears and for the same reason: assets deploy
     before a cache-busted stylesheet is guaranteed to have landed, and an
     unstyled <text> inherits the page's 16px serif while an unstyled <rect> is
     fill:black. A surface that renders as eight black tiles and four
     overlapping labels for the first minute after a deploy is indistinguishable
     from one that is broken. currentColor rather than a token, so the fallback
     is the page's own ink and the palette lives in one file. */
  const TYPE = Object.freeze({
    "font-family": "monospace", "font-size": 9, fill: "currentColor",
  });

  /** A vol as a percent, one decimal. Unsigned — this is a level. */
  function fmtVol(v) {
    const n = numOr(v);
    return n === null ? DASH : (n * 100).toFixed(1);
  }

  /** A skew in vol POINTS, signed, because the sign is the whole reading. */
  function fmtSkew(v) {
    const n = numOr(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n * 100).toFixed(1);
  }

  /** Log-moneyness as a percent, signed with U+2212 rather than a hyphen. */
  function fmtMoneyness(v) {
    const n = numOr(v);
    if (n === null) return DASH;
    if (Math.abs(n) < 5e-5) return "0.0%";
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n * 100).toFixed(1) + "%";
  }

  /* Which symbol's surface is on screen. Held in the URL beside the
     watchlist, the strategy and the ranking key, because a desk is meant to
     be shareable and a link that restores everything except which surface
     was being read restores a different screen from the one that was sent. */
  let surfaceSymbol = null;
  let surfaceHost = null, surfaceSelect = null, surfacePlot = null, surfaceNote = null;
  let surfaceFrame = 0;
  /* Whether the last draw had room to print the volatility inside each cell.
     Set by the drawing pass and read by the note it is written for, in that
     order, because the note otherwise says "the number in a cell is the
     contract's own quoted implied volatility" on a phone where there is no
     number in any cell — a sentence describing a chart that is not on screen. */
  let surfaceNumbersDrawn = true;

  /** Build the block once, after the table's own footnote. It is created here
   *  rather than in the page markup for the same reason the watchlist chips
   *  and every table row are: the renderer owns what it draws, and a static
   *  skeleton for a chart that may not exist is a hidden element the page has
   *  to remember to keep in step. */
  function ensureSurfaceHost() {
    if (surfaceHost) return surfaceHost;
    if (!foot || !foot.parentNode) return null;

    surfaceHost = document.createElement("section");
    surfaceHost.className = "desk-surface";
    surfaceHost.id = "deskSurface";
    surfaceHost.hidden = true;

    const head = document.createElement("div");
    head.className = "desk-surface__head";

    const title = document.createElement("h2");
    title.className = "desk-surface__title";
    title.textContent = "Implied volatility surface";
    head.append(title);

    const field = document.createElement("span");
    field.className = "desk-field desk-surface__field";
    const label = document.createElement("label");
    label.setAttribute("for", "deskSurfaceSymbol");
    label.textContent = "Symbol";
    surfaceSelect = document.createElement("select");
    surfaceSelect.id = "deskSurfaceSymbol";
    surfaceSelect.addEventListener("change", () => {
      surfaceSymbol = surfaceSelect.value || null;
      writeURL();
      drawSurface();
    });
    field.append(label, surfaceSelect);
    head.append(field);
    surfaceHost.append(head);

    surfacePlot = document.createElement("div");
    surfacePlot.className = "desk-surface__plot";
    surfaceHost.append(surfacePlot);

    surfaceNote = document.createElement("p");
    surfaceNote.className = "desk-surface__note";
    surfaceHost.append(surfaceNote);

    foot.insertAdjacentElement("afterend", surfaceHost);
    return surfaceHost;
  }

  /** The symbols that have a payload to draw a surface from, in desk order. */
  function surfaceCandidates() {
    return selectedSymbols().filter((s) => {
      const e = book.get(s);
      return e && e.state === "ok" && e.payload && e.payload.ivSurface;
    });
  }

  function renderSurface() {
    const host = ensureSurfaceHost();
    if (!host) return;
    const candidates = surfaceCandidates();
    if (!candidates.length) {
      host.hidden = true;
      if (surfacePlot) surfacePlot.textContent = "";
      return;
    }
    if (surfaceSymbol === null || !candidates.includes(surfaceSymbol)) {
      surfaceSymbol = candidates[0];
    }
    /* Rebuilt rather than diffed: at most twenty options, and a stale option
       list is how a select ends up offering a symbol that left the desk. */
    surfaceSelect.textContent = "";
    for (const symbol of candidates) {
      const option = document.createElement("option");
      option.value = symbol;
      option.textContent = symbol;
      surfaceSelect.append(option);
    }
    surfaceSelect.value = surfaceSymbol;
    /* One symbol is not a choice. The control stays in the DOM so the block's
       shape does not jump when a second symbol arrives, but it is disabled
       rather than offering a menu of one. */
    surfaceSelect.disabled = candidates.length < 2;
    host.hidden = false;
    drawSurface();
  }

  function drawSurface() {
    if (!surfaceHost || surfaceHost.hidden || !surfacePlot) return;
    const state = book.get(surfaceSymbol);
    const payload = state && state.payload;
    const surface = payload && payload.ivSurface;
    surfacePlot.textContent = "";
    if (!surface) { surfaceNote.textContent = ""; return; }

    if (surface.status !== "ok") {
      /* A SURFACE THAT COULD NOT BE BUILT SAYS WHY. An empty panel where a
         chart was reads as a broken page; the reason is frequently the most
         informative thing on it — "nothing on this chain carries an implied
         volatility" is a fact about the name. */
      surfaceNote.textContent = "No surface for " + surfaceSymbol + ": " +
        (surface.reason || "not available") + ".";
      return;
    }
    surfacePlot.append(surfaceSvg(surface, payload));
    surfaceNote.textContent = surfaceNoteText(surface, payload);
  }

  /* WHICH EXPIRIES OUTLIVE THE NEXT EARNINGS REPORT, borrowed from the rows
     rather than recomputed here.

     crossesEarnings() in shared/flows-premium.js is the authority and this
     file cannot call it — flows-desk.js is a classic script, not a module —
     so a second implementation would be a fork of the one function on this
     page whose tri-state is the point. The Worker already ran it per row and
     shipped the answer, so the column simply inherits whatever the rows on
     that expiry were told.

     An expiry whose contracts were ALL gated out of the table has no row to
     inherit from, and gets no marking rather than a clean one. The note says
     so: an unmarked column has to be unmarked for a stated reason, or "no
     marker" quietly means both "no report before this expiry" and "nobody
     looked", and only one of those is safe to sell into. */
  function earningsByExpiry(payload) {
    const out = new Map();
    for (const row of (payload && payload.rows) || []) {
      if (!row || !row.expiry) continue;
      const prior = out.get(row.expiry);
      if (row.crossesEarnings === true) out.set(row.expiry, true);
      else if (prior === undefined) out.set(row.expiry, row.crossesEarnings === false ? false : null);
      else if (prior === false && row.crossesEarnings === null) out.set(row.expiry, null);
    }
    return out;
  }

  function surfaceSvg(surface, payload) {
    const cols = surface.expiries, rows = surface.rows;
    const hostW = surfacePlot.getBoundingClientRect().width;
    const W = Math.max(280, Math.round(hostW || 320));
    const labelW = 52, padR = 10, padT = 30, gapTerm = 16, termH = 46;
    const plotL = labelW;
    const plotW = Math.max(60, W - labelW - padR);
    const colW = plotW / cols.length;
    /* A cell shorter than 11px is a line, not a cell; taller than 24 and a
       ten-row surface becomes a poster. */
    const rowH = Math.max(11, Math.min(24, 300 / rows.length));
    const gridH = rows.length * rowH;
    const termT = padT + gridH + gapTerm;
    const H = Math.round(termT + termH);

    /* The number only goes in the cell when the cell can hold it. On a phone
       eight columns leave 30px and "30.5" at 9px does not fit, so the shade
       and the hatch carry the reading alone and the note says the numbers are
       in the tooltips. Drawing them anyway would overlap them into a smear
       that looks like data. */
    const withNumbers = colW >= 28 && rowH >= 12;
    surfaceNumbersDrawn = withNumbers;

    const svg = svgEl("svg", {
      class: "ivs", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
      "aria-label": surfaceAria(surface, payload),
    });

    /* The hatch that carries SIGN independently of hue, drawn at the centre
       of its tile rather than on the edge: a stroke on a tile boundary is
       half clipped by patternUnits and renders at a fraction of its weight.
       Same construction, and the same reason, as the gamma surface's. */
    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: "ivsNeg", width: 5, height: 5, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "ivs-negpat",
    });
    pat.append(svgEl("line", {
      x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: "currentColor", "stroke-width": 1.6,
    }));
    defs.append(pat);
    svg.append(defs);

    const earnings = earningsByExpiry(payload);
    const cap = numOr(surface.skewCap);

    /* ---- column headings: the expiry, its tenor, and its event ---- */
    cols.forEach((e, j) => {
      const x = plotL + j * colW + colW / 2;
      const crosses = earnings.has(e.expiry) ? earnings.get(e.expiry) : undefined;
      /* THE <title> HANGS ON A WRAPPING GROUP, NOT ON THE <text>. A title
         child of a text element is not painted but IS part of its
         textContent, so the label reads back as the label plus a paragraph of
         prose — invisible on screen and wrong to anything that reads the DOM,
         which includes this page's own contract test. */
      const group = svgEl("g", { class: "ivs-colhead" });
      const title = svgEl("title");
      title.textContent = e.expiry + (e.days === null ? "" : ", " + e.days + " days") + ". " +
        (crosses === true
          ? "Contracts on this expiry outlive the next earnings report — the level here is priced against a jump, not a diffusion."
          : crosses === false
            ? "No earnings report falls before this expiry."
            : "Whether this expiry outlives the next earnings report is not determined: no contract on it survived the sale gates, so nothing on this column was dated.");
      group.append(title);

      const head = svgEl("text", {
        class: "ivs-exp" + (crosses === true ? " crosses-earnings" : ""),
        x, y: padT - 17, "text-anchor": "middle", ...TYPE, "fill-opacity": 0.8,
      });
      head.textContent = String(e.expiry).slice(5) + (crosses === true ? " ⚠" : "");
      group.append(head);

      const tenor = svgEl("text", {
        class: "ivs-days", x, y: padT - 6, "text-anchor": "middle", ...TYPE,
        "font-size": 8.5, "fill-opacity": 0.6,
      });
      tenor.textContent = e.days === null ? DASH : e.days + "d";
      group.append(tenor);
      svg.append(group);

      if (j > 0) {
        svg.append(svgEl("line", {
          class: "ivs-colrule", x1: plotL + j * colW - 0.5, x2: plotL + j * colW - 0.5,
          y1: padT, y2: padT + gridH,
          stroke: "currentColor", "stroke-width": 0.5, "stroke-opacity": 0.18,
        }));
      }
    });

    /* ---- the grid ------------------------------------------------- */
    rows.forEach((r, i) => {
      const y = padT + i * rowH;
      cols.forEach((e, j) => {
        const x = plotL + j * colW;
        const w = Math.max(1, colW - 1), h = Math.max(1, rowH - 1);
        const cell = surface.grid[i][j];
        if (!cell) {
          /* NO CONTRACT AT THIS MONEYNESS ON THIS EXPIRY is drawn as an
             explicit void. A strike that is not listed and a strike quoted at
             a vol indistinguishable from its neighbours would otherwise look
             alike, and only one of them is a reading. */
          svg.append(svgEl("rect", {
            class: "ivs-void", x, y, width: w, height: h,
            fill: "currentColor", "fill-opacity": 0.07,
          }));
          return;
        }

        const skew = numOr(cell.skew);
        const mag = skew !== null && cap !== null && cap > 0
          ? Math.min(1, Math.abs(skew) / cap) : 0;
        const neg = skew !== null && skew < 0;
        const rect = svgEl("rect", {
          /* is-nolevel is NOT "flat". A cell whose expiry has no at-the-money
             quote this surface will vouch for has an UNKNOWN position on the
             smile, which is a different thing from sitting on the money — and
             a zero-magnitude fill would say the second. It is drawn hollow. */
          class: "ivs-cell " + (skew === null ? "is-nolevel" : neg ? "is-neg" : "is-pos") +
            (cell.traded === false ? " is-stale" : cell.traded === null ? " is-unknown-age" : ""),
          x, y, width: w, height: h,
          fill: skew === null ? "none" : "currentColor",
          /* A floor under the opacity so a small-but-real skew still reads as
             a cell: zero opacity and "nothing here" must not look alike. The
             ceiling is short of full because the quoted vol is printed on top
             of this fill and has to stay legible against it. */
          "fill-opacity": skew === null ? 0 : (0.12 + 0.46 * mag).toFixed(3),
          /* PROVENANCE BY BORDER, which is a channel nothing else is using.
             A dashed edge is a contract that did NOT trade today, a dotted one
             is a contract the vendor sent no volume for at all, and a solid
             fill with no edge is today's print. All three survive greyscale;
             none of them is a colour. */
          stroke: cell.traded === true && skew !== null ? "none" : "currentColor",
          "stroke-width": cell.traded === true && skew !== null ? 0 : 1,
          "stroke-dasharray": cell.traded === false ? "3 2" : cell.traded === null ? "1 2" : null,
          "stroke-opacity": cell.traded === true ? 0.35 : 0.85,
          "data-expiry": cell.expiry,
          "data-strike": cell.strike,
          "data-iv": cell.iv,
          "data-skew": skew === null ? "" : skew,
          "data-traded": cell.traded === null ? "unknown" : String(cell.traded),
          "data-crowd": cell.crowd,
        });
        /* ONE GROUP, ONE TITLE, so the whole cell answers a hover — the
           number painted on top of the tile would otherwise swallow the
           pointer and leave the tooltip unreachable exactly where the reader
           is looking. */
        const group = svgEl("g", { class: "ivs-cellgroup" });
        group.append(cellTitle(cell, e, surface));
        group.append(rect);

        if (neg && rowH >= 9 && colW >= 9) {
          group.append(svgEl("rect", {
            class: "ivs-hatch", x, y, width: w, height: h, fill: "url(#ivsNeg)",
            /* Faded so the hatch is a texture under the number rather than a
               strikethrough across it. The stylesheet darkens it further. */
            opacity: 0.5,
          }));
        }
        /* Past the shade cap, marked rather than silently flattened against
           every other saturated cell. */
        if (skew !== null && cap !== null && Math.abs(skew) > cap) {
          /* A SHORT SLASH AT THE CELL'S EDGE, not a corner-to-corner one. The
             gamma surface draws its clip mark across the whole tile because
             its tiles are thirty pixels wide; these are as wide as the panel
             divided by three, and a diagonal across one of those is a line
             through the chart that reads as data. Fixed length, so the mark
             means the same thing at every column width. */
          const slash = Math.min(9, Math.max(4, w - 4));
          group.append(svgEl("line", {
            class: "ivs-clip",
            x1: x + 3, y1: y + h - 3, x2: x + 3 + slash, y2: y + Math.max(2, h - 3 - slash),
            stroke: "currentColor", "stroke-width": 1.2, "stroke-opacity": 0.9,
          }));
        }
        if (withNumbers) {
          const t = svgEl("text", {
            class: "ivs-iv" + (cell.traded === true ? "" : " is-stale"),
            x: x + w / 2, y: y + h / 2 + 3.2, "text-anchor": "middle", ...TYPE,
          });
          t.textContent = fmtVol(cell.iv);
          group.append(t);
        }
        svg.append(group);
      });
    });

    /* ---- row labels: log-moneyness, and the money itself ---------- */
    /* Every row labelled at 11px is a wall of digits. The at-the-money row is
       the reference every other row is read against so it always gets one, as
       do both ends, and the rest are filled in at whatever stride stays
       legible — the same rule, for the same reason, as the gamma surface's
       price labels. */
    const must = new Set([0, rows.length - 1]);
    const atmRow = rows.findIndex((r) => r.k === 0);
    if (atmRow >= 0) must.add(atmRow);
    const stride = Math.max(1, Math.ceil(13 / rowH));
    rows.forEach((r, i) => {
      if (!must.has(i) && i % stride !== 0) return;
      if (!must.has(i) && Array.from(must).some((m) => Math.abs(m - i) * rowH < 12)) return;
      const t = svgEl("text", {
        class: "ivs-m" + (r.k === 0 ? " is-atm" : ""),
        x: labelW - 6, y: padT + i * rowH + rowH / 2 + 3.2, "text-anchor": "end", ...TYPE,
        "fill-opacity": r.k === 0 ? 1 : 0.7,
      });
      t.textContent = r.k === 0 ? "ATM" : fmtMoneyness(r.m);
      svg.append(t);
    });

    /* ---- the level strip: each expiry's at-the-money quote -------- */
    /* THIS IS THE TERM STRUCTURE and it is a separate strip on purpose. The
       grid above has the level divided out of every cell, which is what makes
       the smiles comparable; putting the level back as its own row is what
       stops that from being a loss. Read left to right it says whether the
       front is bid over the back. */
    const levels = cols.map((e) => numOr(e.atmIv));
    const present = levels.filter((v) => v !== null);
    const lo = present.length ? Math.min.apply(null, present) : 0;
    const hi = present.length ? Math.max.apply(null, present) : 1;
    const span = hi - lo;
    const bandT = termT, bandH = 24;
    const yOf = (v) => span > 1e-9
      ? bandT + bandH - ((v - lo) / span) * bandH
      : bandT + bandH / 2;

    svg.append(svgEl("line", {
      class: "ivs-termrule", x1: plotL, x2: plotL + plotW, y1: bandT + bandH + 4, y2: bandT + bandH + 4,
      stroke: "currentColor", "stroke-width": 1, "stroke-opacity": 0.2,
    }));
    const strip = svgEl("text", {
      class: "ivs-m is-atm", x: labelW - 6, y: bandT + bandH / 2 + 3.2, "text-anchor": "end", ...TYPE,
    });
    strip.textContent = "ATM";
    svg.append(strip);

    cols.forEach((e, j) => {
      const x = plotL + j * colW + colW / 2;
      const v = levels[j];
      const group = svgEl("g", { class: "ivs-levelgroup" });
      const title = svgEl("title");
      title.textContent = v === null
        ? e.expiry + " has no at-the-money level: " + (e.atmReason || "not measurable") + "."
        : e.expiry + " at the money: " + fmtVol(v) + "% implied, from the " + e.atmStrike +
          " " + (e.atmType === "P" ? "put" : "call") + " — " + fmtMoneyness(e.atmM) +
          " from spot and traded today.";
      group.append(title);
      const label = svgEl("text", {
        class: "ivs-level" + (v === null ? " is-missing" : ""),
        x, y: bandT + bandH + 16, "text-anchor": "middle", ...TYPE,
        "font-size": 10, "font-weight": 700, "fill-opacity": v === null ? 0.6 : 1,
      });
      label.textContent = v === null ? DASH : fmtVol(v);
      group.append(label);
      svg.append(group);

      if (v === null) return;
      svg.append(svgEl("circle", {
        class: "ivs-dot", cx: x, cy: yOf(v), r: 2.6, fill: "currentColor",
      }));
      /* THE LINE NEVER BRIDGES A MISSING LEVEL. Joining the expiry either side
         of one that has no at-the-money print would draw a level straight
         through the gap, which is an interpolation — and an interpolated
         term structure is exactly the invented number this desk does not
         publish. Adjacent pairs only; a lone level stays a lone dot. */
      const prev = levels[j - 1];
      if (j > 0 && prev !== null) {
        svg.append(svgEl("line", {
          class: "ivs-termline", fill: "none", stroke: "currentColor", "stroke-width": 1.4,
          x1: plotL + (j - 1) * colW + colW / 2, y1: yOf(prev), x2: x, y2: yOf(v),
        }));
      }
    });

    return svg;
  }

  function cellTitle(cell, expiry, surface) {
    const title = svgEl("title");
    const side = cell.type === "P" ? "put" : "call";
    const parts = [];
    parts.push(cell.strike + " " + side + " " + cell.expiry +
      " · " + fmtMoneyness(cell.m) + " from the money · " + fmtVol(cell.iv) + "% implied");
    if (numOr(cell.skew) !== null) {
      parts.push(fmtSkew(cell.skew) + " vol points against this expiry's at-the-money " +
        fmtVol(expiry.atmIv) + "%");
    } else {
      parts.push("No skew: " + (expiry.atmReason || "this expiry has no at-the-money level"));
    }
    if (cell.traded === false) {
      parts.push("This contract has NOT traded today, so its implied volatility is the last " +
        "transaction's — of unknown age. It is drawn but it did not set this expiry's level.");
    } else if (cell.traded === null) {
      parts.push("The vendor reported no volume for this contract, so the age of its implied " +
        "volatility is unknown. It did not set this expiry's level.");
    } else {
      parts.push("Traded " + fmtInt(cell.volume) + " today" +
        (cell.oi === null ? "" : ", open interest " + fmtInt(cell.oi)) + ".");
    }
    if (cell.crowd > 1) {
      parts.push(cell.crowd + " contracts fall in this row of this column; the one shown is " +
        "the print this surface prefers — today's first, then nearest the row's centre. " +
        "The cell is never an average of quotes.");
    }
    if (numOr(cell.skew) !== null && numOr(surface.skewCap) !== null &&
        Math.abs(cell.skew) > surface.skewCap) {
      parts.push("Past the shade cap of " + fmtSkew(surface.skewCap) +
        " vol points, so the shade understates it. Marked with a slash.");
    }
    title.textContent = parts.join(". ").replace(/\.\./g, ".");
    return title;
  }

  function surfaceAria(surface, payload) {
    const levels = surface.expiries.map((e) => String(e.expiry).slice(5) + " " +
      (numOr(e.atmIv) === null ? "no level" : fmtVol(e.atmIv) + " percent"));
    return "Implied volatility surface for " + (payload && payload.ticker ? payload.ticker : surfaceSymbol) +
      ": " + surface.expiriesShown + " expiries by " + surface.rowsShown +
      " moneyness bands. At-the-money implied volatility by expiry — " + levels.join(", ") +
      ". Shade is each contract's implied volatility against its own expiry's at-the-money quote.";
  }

  function surfaceNoteText(surface, payload) {
    const bits = [];
    bits.push("Rows are log-moneyness, ln(strike ÷ spot), in bands " +
      (surface.step * 100).toFixed(1) + "% wide; columns are expiries, nearest first");
    bits.push((surfaceNumbersDrawn
      ? "The number in a cell is the contract's own quoted implied volatility. "
      : "The columns are too narrow at this width to print a volatility inside each cell, so " +
        "every cell carries its own in a tooltip instead — drawing them anyway would overlap " +
        "them into a smear that looks like data. ") +
      "The shade is that volatility against its own expiry's at-the-money quote — hatched " +
      "below it, plain above — so the smile is readable without the term structure swamping " +
      "it. The level itself is the strip beneath the grid, which read left to right IS the " +
      "term structure");

    /* THE AT-THE-MONEY QUOTES IN TEXT, because a strip of dots is not readable
       by a screen reader and is not readable at all in a printed copy of this
       page. It is also the reading a desk repeats out loud. */
    const levels = surface.expiries.map((e) => String(e.expiry).slice(5) + " " +
      (numOr(e.atmIv) === null ? DASH : fmtVol(e.atmIv) + "%"));
    bits.push("At the money: " + levels.join(", "));

    /* WHAT THE LEVEL IS ALLOWED TO BE. Stated because it is a choice. */
    const noLevel = surface.expiries.filter((e) => numOr(e.atmIv) === null);
    if (noLevel.length) {
      bits.push(noLevel.map((e) => String(e.expiry).slice(5) + " has no level — " + e.atmReason)
        .join("; ") + ". Those columns carry their quoted volatilities and no shade, and the " +
        "term-structure line does not bridge them");
    }

    /* THE AGE OF THE PRINTS, WHICH IS THE THING THAT MAKES THIS HONEST. */
    /* A COUNT OF ZERO IS NOT WORTH A CLAUSE. "3 did not and 0 carry no volume
       at all" is a sentence that trains a reader to skip the sentence, and
       this is the sentence that must not be skipped. */
    const agedBits = [];
    if (surface.stale > 0) agedBits.push(surface.stale + " did not");
    if (surface.unknownAge > 0) {
      agedBits.push(surface.unknownAge + " carr" + (surface.unknownAge === 1 ? "ies" : "y") +
        " no volume at all");
    }
    bits.push("This vendor's implied volatility is the LAST TRANSACTION's, not a quote. " +
      surface.fresh + " of " + surface.placed + " cells traded today" +
      (agedBits.length === 0 ? " — every cell on this surface is a print from today" :
        "; " + agedBits.join(" and ") + ", so their volatility is of unknown age. Those cells " +
        "are drawn with a broken border and NONE of them set an expiry's level — a stale cell " +
        "is one marked number, but a stale level would tilt a whole column's smile with no " +
        "marker on any cell it moved"));

    if (surface.crowded > 0) {
      bits.push(surface.crowded === 1
        ? "One contract shares a row with another; the cell shows one quoted contract and is " +
          "never an average of two"
        : surface.crowded + " contracts share a row with another; each cell shows one quoted " +
          "contract and is never an average of two");
    }
    if (surface.clipped > 0) {
      bits.push("The shade is capped at " + fmtSkew(surface.skewCap) + " vol points; " +
        surface.clipped + " cell" + (surface.clipped === 1 ? " runs" : "s run") +
        " past it and " + (surface.clipped === 1 ? "is" : "are") + " marked with a slash");
    }
    const windowed = [];
    if (surface.expiriesShown < surface.expiriesTotal) {
      windowed.push(surface.expiriesShown + " of " + surface.expiriesTotal + " expiries");
    }
    if (surface.rowsShown < surface.rowsTotal) {
      windowed.push(surface.rowsShown + " of " + surface.rowsTotal + " moneyness bands");
    }
    if (windowed.length) bits.push("Showing " + windowed.join(" and "));

    /* THE UNIVERSE THIS SURFACE IS TAKEN OVER, which is NOT the table above. */
    bits.push("Built from every contract with a two-sided quote, before the liquidity gates that " +
      "decide the table above and regardless of the Sell toggle — those gates fall hardest on the " +
      "wings, and a smile with its tails cut off is a different smile" +
      (payload && payload.truncated
        ? ". This chain is larger than the desk fetches, so the surface is taken over a partial chain"
        : ""));
    if (surface.ivBasis) bits.push("Volatility units resolved once for the whole chain: " + surface.ivBasis);
    bits.push("Quoted volatilities, and differences between quoted volatilities on the same expiry. " +
      "Nothing here is fitted, interpolated or repriced — that would need a rate and a dividend " +
      "yield, which this desk does not invent");

    return bits.join(". ") + ".";
  }

  /* THE SERVER'S RANK KEYS IN WORDS. Not read off the #deskRank options,
     though four of the five match: "collectible" is a client-only key — it
     needs a balance the Worker deliberately never learns — so the select is
     not a complete map of what a payload's `rankedBy` can say, and a lookup
     that is right four times out of five is the kind that fails silently. */
  function rankWord(key) {
    switch (key) {
      case "annualized": return "annualised yield";
      case "premium": return "premium received";
      case "yieldOnCollateral": return "yield on collateral";
      case "cushionSigmas": return "cushion";
      /* The payload always states its own key. A null here means a response
         that did not, and naming an ordering this page did not read would be
         worse than admitting the gap. */
      case null: case undefined: return "an ordering the payload did not name";
      default: return String(key);
    }
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

  /* A SECOND LINE UNDER A NUMBER, and it is a second line rather than more
     text on the same one for a measured reason: every cell in this table is
     white-space:nowrap, so anything appended sideways widens its column, and
     the desk contract asserts that thirteen columns still fit without a
     horizontal scroll at 1440px. A block child costs row height, which is the
     cheaper axis here — the table already scrolls vertically inside a pane the
     reader can resize.

     THE STYLE IS INLINE because the stylesheet is not this file's to change,
     and a class with no rule behind it would render as a full-size second line
     that reads like a second number. Presentation attributes and inline styles
     are the same belt the surface's <text> nodes wear, for the same reason. */
  function subLine(text, title) {
    const span = document.createElement("span");
    span.style.display = "block";
    span.style.fontSize = "0.72em";
    /* THE PALETTE'S OWN SECONDARY INK, not an opacity. Fading the text would
       set its contrast from whatever happens to be behind it — and the row
       behind it changes on hover and on the unaffordable marker — where the
       token is the one colour this site has already decided is readable for
       text at this weight. */
    span.style.color = "var(--ink-faint)";
    span.style.letterSpacing = "0.02em";
    span.textContent = text;
    if (title) span.title = title;
    return span;
  }

  /* HOW FAR OUT THE STRIKE IS, beside the strike. `moneyness` has been on
     every row since the first version of this desk and was drawn only on the
     volatility surface: the table printed a 4.2% yield and never said the
     strike was 7% away from spot, which is most of the difference between a
     cushion and a coin toss.

     THE WORD IS NOT REDUNDANT WITH THE DISTANCE. A put below spot and a call
     above it are both out of the money, so the raw signed distance cannot say
     which side of the money a line sits on without the reader also tracking
     the Sell column. The word says it directly, and it survives greyscale — no
     hue anywhere in this cell. The signed statement ("below spot") is in the
     title, where there is room for the sentence.

     0% is a MEASURED at-the-money strike, not a missing one, and it is drawn
     as its own word rather than being swept into "in the money" by a `< 0`
     test that has to put the boundary somewhere. */
  function strikeCell(r) {
    const td = document.createElement("td");
    td.className = "c-num";
    td.append(document.createTextNode(fmt2(r.strike)));
    const m = isNum(r.moneyness);
    const spot = isNum(r.__spot);
    if (m === null || (r.strategy !== "csp" && r.strategy !== "cc")) return td;
    const atTheMoney = Math.abs(m) < 5e-5;
    const otm = r.strategy === "csp" ? m < 0 : m > 0;
    const word = atTheMoney ? "at the money" : otm ? "OTM" : "ITM";
    const side = m < 0 ? "below" : "above";
    td.append(subLine(
      atTheMoney ? word : fmtPct(Math.abs(m), 1) + " " + word,
      atTheMoney
        ? "This strike is the spot price" + (spot === null ? "" : " of " + fmt2(spot)) + "."
        : "This strike is " + fmtPct(Math.abs(m), 1) + " " + side + " spot" +
          (spot === null ? "" : " of " + fmt2(spot)) + ", which for a " +
          (r.strategy === "csp" ? "cash-secured put" : "covered call") + " is " +
          (otm ? "out of the money" : "in the money") + "."));
    return td;
  }

  /* THE YIELD'S OWN DENOMINATOR, on the row. `collateral` decides whether the
     trade is possible at all and it appeared nowhere a reader could see it
     without a balance typed in: it was in the Collect tooltip, which does not
     exist until then, and in the empty-plan sentence. So the desk showed a
     4.2% yield and never said the line reserves $44,300 — a percentage with
     its denominator withheld, which is the unit-less number this codebase bans
     everywhere else.

     WHICH COLLATERAL, in the title, because the two strategies reserve
     different things: a cash-secured put reserves the strike in cash and a
     covered call reserves a hundred shares you must already own. Same
     arithmetic, completely different requirement. */
  function yieldCell(r) {
    const td = document.createElement("td");
    td.className = "c-num";
    td.append(document.createTextNode(fmtPct(r.yieldOnCollateral, 2)));
    const collateral = isNum(r.collateral);
    if (collateral === null) {
      /* NOT A SILENT SINGLE LINE. A row with no collateral has no yield
         either, and saying which number is missing beats leaving the cell
         looking like every other one. */
      td.append(subLine("on no quotable collateral",
        "This line carries no collateral figure, so the yield above has no denominator."));
      return td;
    }
    td.append(subLine("on " + fmtMoney(collateral),
      r.strategy === "cc"
        ? "A covered call ties up 100 shares, worth " + fmtMoney(collateral) +
          " at spot — shares you have to already own."
        : "A cash-secured put ties up " + fmtMoney(collateral) +
          " in cash: the strike, times 100, reserved until expiry."));
    return td;
  }

  function rowFor(r) {
    const tr = document.createElement("tr");

    const sym = document.createElement("th");
    sym.scope = "row";
    /* THE DESK PRICES A TRADE ON A NAME AND /flows/ticker/ ANALYSES IT, and
       there was no door between the two rooms in either direction. Every other
       surface in Flows links out this way.

       THE BOARD LINKS ONLY ITS DEEP ROWS, on the argument that a link which
       usually dead-ends is worse than no link. That argument does not carry
       here and the difference is who chose the name: a board row is a name the
       pipeline picked, so most of them are answerable; a desk row is a name the
       reader typed, so the reader is already asking about THIS one and is owed
       the route to whatever else the site knows about it. The destination
       degrades honestly — a name outside today's board is told so and offered
       the names that do have a card — and the title says as much before the
       click rather than after it. */
    const ticker = r.ticker ? String(r.ticker) : "";
    if (ticker) {
      const link = document.createElement("a");
      link.href = "/flows/ticker/?t=" + encodeURIComponent(ticker);
      link.textContent = ticker;
      link.title = "Open " + ticker + " on the analysis page. Cards are built only for " +
        "the names on today's board; if this one is not among them the page says so.";
      sym.append(link);
    } else {
      sym.textContent = DASH;
    }
    tr.append(sym);

    /* "Sell" says the trade in words rather than in a P/C letter, because
       the two are not symmetric: one ties up cash and the other ties up
       shares you have to already own. */
    const side = r.strategy === "csp" ? "Cash-secured put"
      : r.strategy === "cc" ? "Covered call" : DASH;
    tr.append(cell(side, "c-side"));

    tr.append(strikeCell(r));
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

    tr.append(yieldCell(r));

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
      : fmtInt(oi) + " (" + (change > 0 ? "+" : change < 0 ? MINUS : "") + fmtInt(Math.abs(change)) + ")";
    tr.append(cell(oiText, "c-num"));

    return tr;
  }

  function updateStatus() {
    /* Every line below is one updateStatus() itself can rewrite at any time.
       say() marks the opposite case — see its comment. */
    statusOwned = true;
    if (inflight > 0) {
      statusEl.textContent = "Pricing " + inflight + " symbol" + (inflight === 1 ? "" : "s") + "…";
      return;
    }
    if (!book.size) { statusEl.textContent = "Add a symbol to begin."; return; }
    const chosen = selectedSymbols();
    if (!chosen.length) { statusEl.textContent = "Select a symbol to price it."; return; }
    const failed = chosen.filter((s) => (book.get(s) || {}).state === "error");
    /* READ AT THE MOMENT OF WRITING, not handed in from render(). The status
       is also redrawn by the age tick, which has no render pass to inherit an
       age from — and an age passed down a call chain is an age that goes stale
       the moment the chain is entered from somewhere else. */
    const { oldest: oldestAge, unaged } = quoteAge();
    const age = oldestAge === null ? "" : " · quotes " + fmtAge(oldestAge);
    /* NAMED, NOT OMITTED. A priced symbol whose response carried no age is a
       symbol this desk cannot vouch for the freshness of, and saying nothing
       about it leaves it looking like the ones it can. */
    const unagedNote = unaged
      ? " · " + (unaged === 1
        ? "one symbol's quote age was not stated by the route"
        : unaged + " symbols' quote ages were not stated by the route")
      : "";
    /* AND THE POINT WHERE IT STOPS BEING A QUOTE. "42m ago" is honest and
       still easy to skim past; the desk says out loud that the table is no
       longer a price, and what to press. */
    const staleQuotes = oldestAge !== null && oldestAge > QUOTE_STALE_SECONDS
      ? " — older than this desk will call a price, so treat the table as a record " +
        "of the market rather than one you can trade; Refresh requotes it"
      : "";

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
      session + age + staleQuotes + unagedNote + staleNote + earnNote;
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

  /* ---------- the clock ---------------------------------------------

     THE ONLY THING ON THIS PAGE THAT MOVES WITHOUT A KEYSTROKE, and its
     absence was the defect: every age was recomputed on render(), render() is
     driven by user input, so a desk nobody touched never recomputed anything.
     A quote fetched at 09:31 still read "just now" at 10:11.

     IT REPAINTS THE TWO PLACES AN AGE IS PRINTED AND NOTHING ELSE. Not
     renderList(), which rebuilds every chip and would take the focus ring off
     whatever checkbox the reader has their hands on twice a minute; not
     render(), which re-merges and re-sorts a table that has not changed. The
     chip keeps a handle on its own note element and only the text is
     rewritten. */
  function tickAges() {
    let priced = false;
    for (const e of book.values()) {
      if (e.state !== "ok" || !e.payload) continue;
      priced = true;
      if (e.__note) e.__note.textContent = noteFor(e);
    }
    /* Nothing is priced, so there is no age to advance and no sentence to
       rewrite — and rewriting the status here would stamp on whatever a
       handler last said. */
    if (priced && statusOwned) updateStatus();
  }
  setInterval(tickAges, AGE_TICK_MS);

  /* A BACKGROUNDED TAB HAS ITS TIMERS THROTTLED to roughly one a minute, and
     some browsers suspend them entirely. A desk returned to after an hour
     would show whatever the last throttled tick managed until the next one
     fired, so the age is brought current the moment the tab is looked at
     again — which is the moment it is read. */
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tickAges();
  });

  /* ---------- what stays put while the rows scroll -------------------

     THE DESK ALREADY HAD ONE STICKY BLOCK and it was written as a one-off:
     the symbol column, pinned left in the stylesheet, because thirteen columns
     scroll horizontally and a row whose symbol has scrolled off is a row of
     numbers about nothing. The identical sentence is true on the other axis —
     the table scrolls vertically inside a 70vh pane, and a row whose HEADER
     has scrolled off is also a row of numbers about nothing — and it is true
     of the controls, which scroll off the top of the page exactly when a
     reader deep in a long table wants to change the ranking.

     THE SAME THREE-PART PATTERN IN BOTH PLACES, WRITTEN OUT TWICE RATHER THAN
     FACTORED, because the two applications share no argument beyond it: the
     header pins to its own scroller and the controls pin to the page, so a
     common helper would take an offset, an axis, a layer and a ground and
     would be longer than either caller. The pattern is: pin it, give it a
     layer above whatever slides underneath, and give it an opaque ground,
     because a transparent sticky element shows the rows passing through it.

     ONLY THE CONTROLS ARE GIVEN THEIR GROUND HERE. The header cells already
     have one — `.flows-table thead th` paints var(--bg-deep) — so setting a
     second from JavaScript would be a duplicate that survives the stylesheet
     changing its mind. If that rule ever loses its background, this block is
     where the header's bleed-through will be diagnosed, not where it is
     caused.

     WHY THIS IS INLINE STYLE AND NOT A CLASS. The stylesheet is not this
     file's to change. An inline declaration is the strongest one there is,
     which is the reason for the one exception below: the first header cell's
     `position` is left alone, because the stylesheet drops it to `static`
     under 40rem where there is no horizontal room for a pinned column, and an
     inline `position: sticky` cannot be un-set by a media query. Sticky takes
     both axes from one declaration, so supplying only `top` gives that cell
     the second axis while the stylesheet keeps deciding the first. */
  (() => {
    /* THE TOP BAR IS FIXED AND 100 DEEP, so anything pinned at top:0 slides
       under it. Measured rather than guessed: a hardcoded offset is a number
       that silently goes wrong the first time the bar's padding changes. */
    const topbar = document.querySelector(".topbar");
    const barHeight = () => (topbar ? Math.round(topbar.getBoundingClientRect().height) : 0);

    const headCells = Array.from(document.querySelectorAll(".desk-table thead th"));
    headCells.forEach((th, i) => {
      th.style.top = "0px";
      /* Above the body's own sticky symbol column, which sits at 1. */
      th.style.zIndex = "3";
      if (i > 0) th.style.position = "sticky";
      /* border-collapse resolves a cell's border onto its neighbour, and the
         neighbour scrolls away — so a sticky header row loses its rule the
         moment it detaches. Repainted as an inset shadow, which is drawn by
         the cell itself and therefore stays. */
      th.style.boxShadow = "inset 0 -1px 0 var(--hairline)";
    });

    /* THE CONTROLS, PINNED ONLY WHERE THERE IS HEIGHT TO SPARE. On a phone the
       bar wraps to three rows; pinning it would spend a third of the viewport
       on controls to save a scroll, which is the trade the stylesheet already
       refuses at this breakpoint for the resize grips and the symbol column.
       The same breakpoint, deliberately: two components disagreeing about where
       "narrow" starts is how a layout gets a seam. */
    const controls = document.querySelector(".desk-controls");
    const wide = window.matchMedia("(min-width: 40.001rem)");
    function applyControls() {
      if (!controls) return;
      if (!wide.matches) {
        controls.style.position = "";
        controls.style.top = "";
        controls.style.zIndex = "";
        controls.style.background = "";
        controls.style.paddingBottom = "";
        controls.style.borderBottom = "";
        return;
      }
      controls.style.position = "sticky";
      controls.style.top = barHeight() + "px";
      /* Under the fixed top bar at 100, over the table at 3. */
      controls.style.zIndex = "20";
      controls.style.background = "var(--bg)";
      controls.style.paddingBottom = "0.7rem";
      controls.style.borderBottom = "1px solid var(--hairline)";
    }
    applyControls();
    /* The bar's height changes with the viewport (its padding is a max() of a
       safe-area inset), so the offset is re-measured rather than cached. */
    window.addEventListener("resize", applyControls);
    if (typeof wide.addEventListener === "function") wide.addEventListener("change", applyControls);
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
      say("That is not a symbol this desk can price.");
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
      say(wanted.length === 1
        ? wanted[0] + " is already on the desk."
        : "Already on the desk.");
    } else if (added.length < needSlots.length) {
      /* The cap is a quota decision — each symbol is a live lookup — so it is
         stated as one rather than letting the overflow vanish unexplained,
         and it names what was dropped. */
      const dropped = needSlots.filter((w) => !book.has(w));
      say("The desk holds " + MAX_SYMBOLS +
        " symbols; each one is a live lookup. " +
        (dropped.length ? "Not added: " + dropped.join(", ") + ". " : "") +
        "Remove one to add another.");
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
    if (!chosen.length) { say("Select a symbol to refresh."); return; }
    /* refresh=1 asks the Worker to go back to the vendor. It may decline and
       serve the copy it has — the age in each row is what says which
       happened, rather than the button implying it always refetched. */
    runPool(chosen, { refresh: true });
  });

  clearBtn.addEventListener("click", () => {
    book.clear();
    surfaceSymbol = null;
    writeURL();
    renderList();
    tbody.textContent = "";
    setPaneVisible(false);
    foot.textContent = "";
    renderPlan([]);
    /* The surface is drawn from the same book the table is, so clearing the
       book has to clear it too. render() is not called on this path — it would
       re-run the whole merge over an empty desk — so the panel is told
       directly rather than left holding the last symbol's chart. */
    renderSurface();
    updateStatus();
  });

  /* THE SURFACE IS SIZED IN PIXELS, so it has to be redrawn when the pixels
     change. The table does not need this — it reflows — but an SVG built
     against a 1440px column keeps its 1440px viewBox on a phone and scales
     every label down with it until nothing is legible. One frame of debounce,
     because a drag-resize fires this continuously. */
  window.addEventListener("resize", () => {
    if (surfaceFrame) return;
    surfaceFrame = requestAnimationFrame(() => { surfaceFrame = 0; drawSurface(); });
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

  /* ---------- the re-rank refetch, once the reader has settled ------

     ARROWING THROUGH THE SELECT SPENT A VENDOR CALL PER STEP THAT LANDED ON A
     DISTINCT KEY. Not per step — the branch below already declines to refetch
     an uncut symbol, and serverRank() maps two adjacent options onto one wire
     key, so stepping between "premium collectible" and "yield on collateral"
     has always cost nothing. What it did cost was a reader holding the down
     arrow across four distinct keys with a cut chain selected: four rounds of
     calls for three orderings nobody looked at.

     ONLY THE VENDOR SPEND IS DEFERRED. writeURL() and render() stay immediate,
     so the URL tracks the select and the local re-sort is instant. What waits
     is runPool(), and only for the names whose chain was cut — the ones where
     the key chose the rows rather than ordering them.

     THE PENDING CALL IS CANCELLED ON EVERY CHANGE, including a change to a key
     with nothing to recut. Otherwise arrowing from a cut key to a clean one
     would fire a refetch for an ordering the reader had already left.

     THE DELAY IS INJECTABLE, AND THAT IS NOT A CONVENIENCE. A hard-coded delay
     here would not merely be hard to test — it would SILENTLY VOID AN EXISTING
     TEST. tests/flows-desk-contract.mjs fires two selectOption calls back to
     back and holds the first response 1500ms, to prove a superseded slice
     never overwrites the one the reader asked for. Any debounce longer than
     the gap between those two calls coalesces them: the first request is never
     sent, the held response never arrives, and every assertion in that block
     passes while testing nothing. That block injects 0.

     Read at call time rather than captured at load, so a test can set it
     before navigation or after, and a value that is absent or unparseable
     falls back to the shipped default rather than to zero. */
  const RANK_REFETCH_MS = 250;
  const rankDebounceMs = () => {
    const v = Number(window.__flowsRankDebounceMs);
    return Number.isFinite(v) && v >= 0 ? v : RANK_REFETCH_MS;
  };
  let rankRefetchTimer = null;

  for (const sel of [strategySel, rankSel]) {
    if (!sel) continue;
    sel.addEventListener("change", () => {
      writeURL();
      /* Strategy changes what the API returns, so it must refetch every
         symbol. Rank is answered locally WHERE IT CAN BE — see the block
         below, which sends back only the names whose chain was cut, because
         for those the key did not merely order the rows, it chose them. This
         comment used to end "refetching for a sort would spend a vendor call
         to reorder rows already in hand", which was true of the rows in hand
         and silently false about the rows that were not. */
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
          say("Enter a buying power to rank by premium collectible.");
          if (bpInput) { bpInput.focus(); bpInput.select(); }
          return;
        }
        /* A LOCAL RE-SORT IS ONLY EXACT WHEN NOTHING WAS CUT, and this branch
           used to re-sort unconditionally.

           The Worker ranks each chain and keeps the top slice; the key it
           ranked by therefore decided WHICH rows were sent, not merely the
           order they arrived in. Re-sorting a cut payload by a new key
           produces the best rows of the OLD key's slice — switch a big chain
           from annualised yield to premium received and the table's top line
           was the fattest premium among 120 short-dated far-OTM weeklies,
           while the chain's genuine top premium lines were never sent and
           nothing on the page said so.

           So the cut symbols go back to the chain under the new key, and only
           those: a payload holding every sellable line it has already answers
           any ordering, and spending a metered vendor call to reorder rows
           that are already in hand is exactly what the comment above forbids.
           `priced > rows.length` is the condition, read off the payload. */
        const want = serverRank(sel.value);
        const recut = selectedSymbols().filter((sym) => {
          const p = (book.get(sym) || {}).payload;
          if (!p) return false;
          const sellable = isNum(p.priced);
          if (sellable === null || (p.rows || []).length >= sellable) return false;
          /* AND ONLY WHERE THE ROUTE WOULD ACTUALLY SLICE IT DIFFERENTLY. Five
             options in this select map to four keys on the wire: "premium
             collectible" needs a balance the Worker never learns, so it is
             fetched as yield on collateral and sorted here. They are ADJACENT
             options, so a reader arrowing between them sent every cut symbol
             back to the route for a byte-identical slice — absorbed by the
             route's cache while it is warm, since that cache is keyed by rank
             and the key here does not change, and a metered vendor call once
             it is not. Either way it is the waste the paragraph above says
             this branch exists to avoid, committed by the branch itself.

             `rankedBy` is the payload's own statement of the ordering it was
             cut under. A payload that does not carry one is refetched: not
             knowing which slice is in hand is not the same as knowing it is
             the right one, and the safe direction is the vendor call. */
          return p.rankedBy !== want;
        });
        render();
        /* NOT ANNOUNCED IN THE STATUS LINE. runPool() writes "Pricing N
           symbols…" there on its first tick, so any sentence put there here is
           gone before it can be read. The durable place for this is the
           footnote, which says the cut and now says what a re-rank does about
           it — before the reader changes the key, rather than after. */
        /* CANCEL FIRST, UNCONDITIONALLY. A pending refetch belongs to a key
           the reader has now left, and that is true whether or not the new key
           has anything of its own to send. */
        if (rankRefetchTimer !== null) {
          clearTimeout(rankRefetchTimer);
          rankRefetchTimer = null;
        }
        if (!recut.length) return;
        const wait = rankDebounceMs();
        if (wait === 0) { runPool(recut, {}); return; }
        /* `recut` is this key's list, captured deliberately: if another change
           follows, this timer is cleared above and its list never runs, so the
           call that does fire is always the one for the key on screen. */
        rankRefetchTimer = window.setTimeout(() => {
          rankRefetchTimer = null;
          runPool(recut, {});
        }, wait);
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
