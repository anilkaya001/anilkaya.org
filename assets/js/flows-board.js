/* =============================================================
   flows-board.js — the Flows board controller.

   Fetches a precomputed payload and renders it. All the arithmetic
   happened in the pipeline; this file does presentation only, which
   is the whole point of the architecture: the Worker streams stored
   bytes and the browser draws them.

   Framework-free IIFE, in the house idiom. No global is exported —
   nothing else on the page needs to talk to it.
   ============================================================= */
(() => {
  "use strict";

  const body = document.getElementById("flowsBody");
  const statusEl = document.getElementById("flowsStatus");
  const staleEl = document.getElementById("flowsStale");
  const sideButtons = Array.from(document.querySelectorAll(".flows-side"));
  const viewButtons = Array.from(document.querySelectorAll(".flows-view"));
  const deck = document.getElementById("flowsDeck");
  const tableWrap = document.getElementById("flowsTableWrap");
  if (!body || !statusEl || !sideButtons.length) return;

  const COLUMNS = 10;                // keep in sync with the <thead> in flows-pages.js
  const cache = new Map();           // side -> payload
  const inflight = new Map();        // side -> { promise, controller }
  let side = initialSide();
  // Which side's rows are actually on screen right now, as opposed to which
  // side the controls claim. They diverge for the duration of every fetch.
  let painted = null;

  /* ---------- formatting -----------------------------------------
     One place for every number. The rule throughout: never print a
     precision the data does not have. A missing value renders as an
     em dash, never as 0.00, because a confident zero is a lie. */

  const MINUS = "−";            // U+2212, not a hyphen
  const DASH = "—";

  const isNum = (v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const signed = (n, digits) => {
    const s = Math.abs(n).toFixed(digits);
    return n < 0 ? MINUS + s : n > 0 ? "+" + s : s;
  };

  function fmtPrice(v) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(2);
  }

  function fmtPct(v, digits) {
    const n = isNum(v);
    return n === null ? DASH : signed(n * 100, digits) + "%";
  }

  function fmtInt(v) {
    const n = isNum(v);
    return n === null ? DASH : String(Math.round(n));
  }

  function fmtSignedInt(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    const r = Math.round(n);
    return r < 0 ? MINUS + Math.abs(r) : r > 0 ? "+" + r : "0";
  }

  function fmtRatio(v) {
    const n = isNum(v);
    return n === null ? DASH : n.toFixed(2);
  }

  function fmtMoney(v) {
    const n = isNum(v);
    if (n === null) return DASH;
    const abs = Math.abs(n);
    const sign = n < 0 ? MINUS : "";
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return sign + "$" + Math.round(abs / 1e3) + "K";
    return sign + "$" + Math.round(abs);
  }

  /* ---------- DOM helpers ---------------------------------------- */

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;          // textContent everywhere: no escaping to forget
    return td;
  }

  function toneClass(v) {
    const n = isNum(v);
    if (n === null || n === 0) return "fb-flat";
    return n > 0 ? "fb-pos" : "fb-neg";
  }

  function scoreCell(score) {
    const n = isNum(score);
    const td = document.createElement("td");
    td.className = "fb-score c-num " + toneClass(n);
    if (n !== null && n < 0) td.classList.add("is-neg");
    const bar = document.createElement("span");
    bar.className = "fb-bar";
    bar.style.setProperty("--w", n === null ? 0 : Math.min(Math.abs(n) / 100, 1));
    const label = document.createElement("span");
    label.textContent = fmtSignedInt(n);
    td.append(bar, label);
    return td;
  }

  function familyCell(fam) {
    const td = document.createElement("td");
    td.className = "c-num";
    const keys = ["F", "P", "D", "V", "O"];
    const wrap = document.createElement("span");
    wrap.className = "fb-fam";
    const parts = [];
    for (const k of keys) {
      const n = isNum(fam && fam[k]);
      const i = document.createElement("i");
      i.style.setProperty("--h", n === null ? 0 : Math.min(Math.abs(n) / 100, 1));
      // Sign is drawn as direction from a centre line, not as a colour swap.
      // A MISSING family gets its own mark: it used to render as a short
      // positive stub, which read as a small bullish contribution.
      if (n === null) i.className = "is-null";
      else if (n < 0) i.className = "is-neg";
      wrap.append(i);
      parts.push(k + " " + (n === null ? DASH : fmtSignedInt(n)));
    }
    // The glyph is decorative; the numbers must still be readable to
    // a screen reader and on hover.
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "Family scores: " + parts.join(", "));
    wrap.title = parts.join("  ");
    td.append(wrap);
    return td;
  }

  /* ---------- the deck ---------------------------------------------
     One payload, two renderers, exactly one mounted at a time.

     The deck is the default because the table's ten columns are wider than
     any phone viewport — the table lives inside a horizontally scrolling
     region for precisely that reason, and seven of its columns are off-screen
     on a phone before a finger touches it.

     A card is ONE tab stop and the whole card is the target. Splitting it into
     a ticker button plus decorative regions would put five stops on every card
     and make a 25-name board a 125-stop obstacle. */

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  /** Unpack the 84-character sparkline: two base-64 characters a session. */
  function unpackSpark(str) {
    if (typeof str !== "string" || str.length < 4 || str.length % 2) return null;
    const out = [];
    for (let i = 0; i < str.length; i += 2) {
      const hi = B64.indexOf(str[i]), lo = B64.indexOf(str[i + 1]);
      if (hi < 0 || lo < 0) return null;
      out.push((hi << 6) | lo);
    }
    return out;
  }

  function sparkSvg(values, up) {
    const W = 120, H = 30, pad = 2;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "fd-spark " + (up ? "is-pos" : "is-neg"));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const xOf = (i) => pad + (i / (values.length - 1)) * (W - pad * 2);
    // The samples are already normalised to the window's own extremes, so
    // 0 is the window low and 4095 the high — no rescaling here.
    const yOf = (v) => pad + (1 - v / 4095) * (H - pad * 2);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "fd-sparkline");
    path.setAttribute("d", values.map((v, i) =>
      (i ? "L" : "M") + xOf(i).toFixed(1) + " " + yOf(v).toFixed(1)).join(" "));
    svg.append(path);
    return svg;
  }

  /** One period-return chip. Basis points in, a signed percent out. */
  function retChip(label, bp) {
    const n = isNum(bp);
    const chip = document.createElement("div");
    chip.className = "fd-ret " + (n === null ? "is-flat" : n > 0 ? "is-pos" : n < 0 ? "is-neg" : "is-flat");
    const k = document.createElement("span");
    k.className = "fd-ret-k";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "fd-ret-v";
    v.textContent = n === null ? DASH : (n >= 0 ? "+" : MINUS) + (Math.abs(n) / 100).toFixed(1) + "%";
    chip.append(k, v);
    return chip;
  }

  function deckCard(row, index) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "fd-card";
    card.dataset.t = String(row.t || "");
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-haspopup", "dialog");
    card.addEventListener("pointerenter", () => {
      if (window.flowsCardPrefetch && row.t) window.flowsCardPrefetch(String(row.t));
    });

    const score = isNum(row.s);

    const head = document.createElement("div");
    head.className = "fd-head";
    const rank = document.createElement("span");
    rank.className = "fd-rank";
    rank.textContent = fmtInt(row.r != null ? row.r : index + 1);
    const tk = document.createElement("span");
    tk.className = "fd-tk";
    tk.textContent = String(row.t || DASH);
    const sc = document.createElement("span");
    sc.className = "fd-score " + toneClass(score);
    sc.textContent = score === null ? DASH : (score > 0 ? "+" : score < 0 ? MINUS : "") + Math.abs(score);
    head.append(rank, tk, sc);
    card.append(head);

    const price = document.createElement("div");
    price.className = "fd-price";
    const px = document.createElement("span");
    px.className = "fd-px";
    px.textContent = fmtPrice(row.px);
    const chg = document.createElement("span");
    chg.className = "fd-chg " + toneClass(row.chg);
    chg.textContent = fmtPct(row.chg, 2);
    price.append(px, chg);
    card.append(price);

    const spark = unpackSpark(row.spark);
    if (spark && spark.length >= 2) {
      card.append(sparkSvg(spark, spark[spark.length - 1] >= spark[0]));
    } else {
      const gap = document.createElement("div");
      gap.className = "fd-spark is-empty";
      card.append(gap);
    }

    const rets = document.createElement("div");
    rets.className = "fd-rets";
    const pr = Array.isArray(row.pr) ? row.pr : [];
    rets.append(retChip("5D", pr[0]), retChip("21D", pr[1]), retChip("42D", pr[2]));
    card.append(rets);

    /* The score bar grows from the CENTRE, so the sign is geometric and a
       colour-blind reader gets it from position rather than hue — the same
       rule the card's own family track follows. */
    const track = document.createElement("div");
    track.className = "fd-track";
    const zero = document.createElement("b");
    zero.className = "fd-zero";
    const bar = document.createElement("i");
    bar.className = score !== null && score < 0 ? "is-neg" : "is-pos";
    bar.style.setProperty("--w", score === null ? 0 : Math.min(Math.abs(score) / 100, 1));
    track.append(zero, bar);
    card.append(track);

    const foot = document.createElement("div");
    foot.className = "fd-foot";
    const conv = document.createElement("span");
    conv.textContent = isNum(row.cnv) === null ? DASH : row.cnv + " conv";
    /* The move the option market has already PRICED to its next expiry. It is
       the only forward-looking number on this card, it is a price rather than
       a prediction, and it is labelled "priced" for exactly that reason. */
    const move = document.createElement("span");
    move.className = "fd-move";
    move.textContent = isNum(row.im) === null ? "" : "\u00b1" + (row.im * 100).toFixed(1) + "% priced";
    const reg = document.createElement("span");
    reg.className = row.gRegime === "short" ? "fb-neg" : "";
    reg.textContent = regimeText(row.gRegime);
    foot.append(conv, move, reg);
    card.append(foot);

    card.setAttribute("aria-label",
      `${row.t}, rank ${row.r != null ? row.r : index + 1}, score ${score === null ? "unavailable" : score}, ` +
      `last ${fmtPrice(row.px)}, ${fmtPct(row.chg, 2)} today, conviction ${row.cnv}. ` +
      (isNum(row.im) === null ? "" : `The option market prices plus or minus ${(row.im * 100).toFixed(1)} percent. `) +
      `Open the detail card.`);
    return card;
  }

  function regimeText(v) {
    if (v === "long") return "long Γ";
    if (v === "short") return "short Γ";
    return DASH;
  }

  function rowFor(row, index) {
    const tr = document.createElement("tr");
    tr.className = "fb-row";
    tr.append(cell(fmtInt(row.r != null ? row.r : index + 1), "c-rank"));
    /* The ticker is a real button, not a click handler on the row. That buys
       keyboard operability and a focus ring for free and states honest
       semantics; giving the <tr> role="button" would lie to a screen reader
       about what a table row is. */
    const tk = document.createElement("td");
    tk.className = "fb-tk";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "fb-open";
    open.dataset.t = String(row.t || "");
    open.setAttribute("aria-haspopup", "dialog");
    open.textContent = String(row.t || DASH);
    // Warm the card on hover so the overlay opens instantly. At most six
    // entries are cached, against a 5M row/day read budget.
    open.addEventListener("pointerenter", () => {
      if (window.flowsCardPrefetch && row.t) window.flowsCardPrefetch(String(row.t));
    });
    tk.append(open);
    tr.append(tk);

    const px = document.createElement("td");
    px.className = "c-num";
    px.textContent = fmtPrice(row.px);
    const chg = document.createElement("span");
    chg.className = " " + toneClass(row.chg);
    chg.textContent = "  " + fmtPct(row.chg, 2);
    px.append(chg);
    tr.append(px);

    tr.append(scoreCell(row.s));
    tr.append(cell(fmtInt(row.cnv), "c-num"));
    tr.append(familyCell(row.fam));
    tr.append(cell(fmtRatio(row.purity), "c-num"));
    tr.append(cell(regimeText(row.gRegime), "c-num " + (row.gRegime === "short" ? "fb-neg" : "fb-flat")));
    tr.append(cell(row.gFlipDist == null ? DASH : fmtPct(row.gFlipDist, 1), "c-num"));
    tr.append(cell(fmtMoney(row.netPrem), "c-num " + toneClass(row.netPrem)));
    return tr;
  }

  /**
   * Two independent ways a board goes stale, reported separately because the
   * remedies differ.
   *
   * A dead pipeline has an old WRITE time: GitHub disables scheduled workflows
   * after 60 days of repository inactivity, and that failure's only symptom is
   * a date that stops advancing. A frozen upstream has a recent write time and
   * an old SESSION. The board previously showed neither — it rendered the
   * build time in a status line and applied no test at all, so a reader
   * looking at the board alone could not tell it was three days old.
   */
  function assessAge(payload) {
    const now = Date.now();
    const written = Number(payload.__updatedAt) || null;
    // One publish cadence plus slack. Weekends are handled by the session
    // check below, not here: the pipeline does not run at all on a Saturday.
    const STALE_WRITE_MS = 30 * 60 * 60 * 1000;
    // Four days covers a normal weekend plus one public holiday.
    const STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;

    if (written && now - written > STALE_WRITE_MS) {
      const days = Math.floor((now - written) / 86400000);
      return "This board was last written " +
        (days >= 1 ? days + (days === 1 ? " day" : " days") : Math.floor((now - written) / 3600000) + " hours") +
        " ago. The pipeline has not published since — check the Actions tab.";
    }
    if (payload.sessionDate) {
      const session = Date.parse(payload.sessionDate + "T21:00:00Z");
      if (Number.isFinite(session) && now - session > STALE_SESSION_MS) {
        return "These numbers describe the " + payload.sessionDate + " session, " +
          "which is more than four days old. The pipeline is running but its " +
          "data is not advancing.";
      }
    }
    return null;
  }

  function setStale(message) {
    if (!staleEl) return;
    staleEl.hidden = !message;
    staleEl.textContent = message || "";
    document.body.classList.toggle("is-stale", Boolean(message));
  }

  function showMessage(text) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "fb-empty";
    td.colSpan = COLUMNS;
    td.textContent = text;
    tr.append(td);
    body.replaceChildren(tr);
  }

  /* ---------- data ------------------------------------------------ */

  function initialSide() {
    try {
      const q = new URLSearchParams(location.search).get("side");
      return q === "short" ? "short" : "long";
    } catch { return "long"; }
  }

  function load(which) {
    if (cache.has(which)) return Promise.resolve(cache.get(which));

    const pending = inflight.get(which);
    if (pending) return pending.promise;          // deduplicate concurrent asks

    const controller = new AbortController();
    const promise = fetch("/api/flows/board?side=" + encodeURIComponent(which), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then((response) => {
      if (response.status === 401) {
        // The session expired underneath us; the login page is the
        // honest destination, not an error message.
        location.replace("/flows/");
        return null;
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      // The write timestamp answers a question the payload cannot: whether the
      // PIPELINE ran, as distinct from whether the DATA moved. A frozen vendor
      // feed republished on schedule has a fresh write time and a stale
      // session; a dead pipeline has the reverse. They are different failures
      // and the reader is told which one.
      const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
      return response.json().then((body) => {
        if (body && typeof body === "object") body.__updatedAt = updatedAt;
        return body;
      });
    }).then((payload) => {
      if (payload) cache.set(which, payload);
      return payload;
    }).finally(() => {
      inflight.delete(which);
    });

    inflight.set(which, { promise, controller });
    return promise;
  }

  function render(which) {
    statusEl.textContent = "Loading the " + which + " board…";

    /* Clear the table whenever the side being requested is not the one on
       screen. select() flips the button fill, aria-pressed and the ?side= URL
       synchronously, but the tbody was only ever replaced inside the success
       handler — so on a slow connection the page presented the LONG rows under
       a Short label, styled and announced as Short, for the whole fetch. Rows
       from the wrong day's cross-section under the wrong heading are worse
       than no rows. */
    if (painted !== null && painted !== which) {
      body.replaceChildren();
      if (deck) deck.replaceChildren();
      painted = null;
    }
    body.setAttribute("aria-busy", "true");

    // Cancel a superseded request so a slow response cannot land after
    // the user has already switched sides.
    for (const [key, entry] of inflight) {
      if (key !== which) { entry.controller.abort(); inflight.delete(key); }
    }

    load(which).then((payload) => {
      if (which !== side || !payload) return;     // user moved on, or redirected

      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (payload.status === "pending" || !rows.length) {
        /* "pending" from the API means the row is genuinely absent. It is also
           what the Worker returns when the D1 read THREW — the catch there
           falls back to the same shape — so this message has to cover a
           database fault too rather than confidently asserting that nothing
           has ever been published. */
        showMessage(
          "No board is available for this side. Either the pipeline has not "
          + "published its first session yet, or the store could not be read. "
          + "If this persists past the next trading morning, check the Actions tab.",
        );
        statusEl.textContent = "No published session available.";
        setStale(null);
        return;
      }

      const tableFrag = document.createDocumentFragment();
      rows.forEach((row, i) => tableFrag.append(rowFor(row, i)));
      body.replaceChildren(tableFrag);            // one insertion, 50 rows
      if (deck) {
        const deckFrag = document.createDocumentFragment();
        rows.forEach((row, i) => deckFrag.append(deckCard(row, i)));
        deck.replaceChildren(deckFrag);
      }
      painted = which;

      const when = payload.generatedAt
        ? new Date(payload.generatedAt).toLocaleString()
        : "an unknown time";
      // Two dates, because the job runs pre-open and the vendor returns the
      // previous COMPLETED session. Showing only the build time would let a
      // board built this morning from four-day-old data look current.
      /* WHAT THE SCORE MEANS, beside the board.

         The score is now a FIXED unit — two robust sigma from the
         cross-sectional median is 80, at any board size — so a short board and
         a low dispersion are the readings that say "quiet session" rather than
         "something broke". Under the old rank ladder both printed +84 and
         there was nothing to report. */
      const parts = [
        rows.length + " " + which + " candidate" + (rows.length === 1 ? "" : "s"),
        "session " + (payload.sessionDate || "unknown"),
      ];
      if (isNum(payload.neutral) !== null && isNum(payload.deadBand) !== null) {
        parts.push(payload.neutral + " of " + (payload.scored || "?") +
          " inside the ±" + payload.deadBand + " band");
      }
      if (isNum(payload.dispersion) !== null) {
        parts.push("dispersion " + payload.dispersion.toFixed(2) + "σ");
      }
      parts.push("built " + when);
      statusEl.textContent = parts.join(" · ") + ".";
      setStale(assessAge(payload));
    }).catch((error) => {
      if (error && error.name === "AbortError") return;
      showMessage("The board could not be loaded. Refresh to try again.");
      statusEl.textContent = "Could not reach the board service.";
    }).finally(() => {
      body.removeAttribute("aria-busy");
    });
  }

  /* ---------- side toggle ----------------------------------------- */

  function select(which) {
    if (which !== "long" && which !== "short") return;
    if (which === side && painted === side) return;
    side = which;
    for (const button of sideButtons) {
      const on = button.dataset.side === which;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
    try {
      const url = new URL(location.href);
      url.searchParams.set("side", which);
      history.replaceState(null, "", url);
    } catch { /* deep-linking is a convenience, never a requirement */ }
    render(which);
  }

  for (const button of sideButtons) {
    button.addEventListener("click", () => select(button.dataset.side));
  }

  /* THE VIEW TOGGLE. Both renderers are fed from the same payload on every
     render, so switching is a visibility change and never a refetch — and the
     hidden one carries no rows a screen reader could announce twice, because
     `hidden` removes it from the accessibility tree. The choice is remembered
     per browser; a failure to read storage must not stop the board rendering,
     so every access is guarded. */
  function readView() {
    try {
      const v = localStorage.getItem("flows.view");
      return v === "table" || v === "deck" ? v : "deck";
    } catch { return "deck"; }
  }

  function selectView(which) {
    const view = which === "table" ? "table" : "deck";
    if (deck) deck.hidden = view !== "deck";
    if (tableWrap) tableWrap.hidden = view !== "table";
    for (const button of viewButtons) {
      const on = button.dataset.view === view;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
    try { localStorage.setItem("flows.view", view); } catch { /* a preference, never a requirement */ }
  }

  for (const button of viewButtons) {
    button.addEventListener("click", () => selectView(button.dataset.view));
  }
  selectView(readView());

  select(side);
})();
