/* =============================================================
   flows-card.js — the card reader.

   A modal <dialog> over the board, not an inline row expansion and
   not a separate route.

   Inline was rejected on geometry: the table sits inside a
   min-width:46rem horizontal scroll container, so an expanded row's
   content would be off-screen at 320px — satisfying the suite's
   zero-page-overflow assertion on a technicality while being
   unusable in fact. A separate route was rejected on cost: the
   workflow is scan, drill, scan again, and a document navigation
   loses which side was selected and where the reader had scrolled.

   (/flows/ticker/ is now that separate route, and it does not
   replace this: the dialog is the quick look, the page is the drill.
   They draw the SAME renderers — see below — so the two can never
   disagree about a chart.)

   Native showModal() is used rather than a hand-rolled overlay
   because it supplies background inertness, a focus trap, top-layer
   stacking above the fixed topbar, and the cancel event — four
   things that are tedious to get subtly right by hand.

   THE TEN RENDERERS AND THEIR SCAFFOLDING NOW LIVE IN
   assets/js/flows-panels.js. They were 2,003 of this file's 2,325
   lines, and they were unreachable from anywhere else because this
   file's second statement returns when #flowsCard is absent. What is
   left here is the dialog and only the dialog: its cache, its
   loading and error states, the assembly that decides which panels a
   card gets, and the wiring. flows-panels.js MUST be loaded first;
   the guard below states what happens if it is not, rather than
   throwing a ReferenceError into a click handler.

   EVERY PANEL IS A TAGGED UNION, and the switch on panel.status lives
   with the renderers, not here.
   ============================================================= */
(function () {
  "use strict";

  const dialog = document.getElementById("flowsCard");
  if (!dialog || typeof dialog.showModal !== "function") return;

  /* THE DEPENDENCY IS ASSERTED, NOT ASSUMED. Both files are emitted by
     shared/flows-pages.js with flows-panels.js first, so this cannot fire
     from a page this repo builds — it fires if someone adds a page and
     forgets the tag, and a named console error at load beats ten renderers
     failing one by one inside a click handler. */
  const P = window.FlowsPanels;
  if (!P) {
    console.error(
      "flows-card: assets/js/flows-panels.js must load before this file — " +
      "the panel renderers live there and the dialog has nothing to draw with.");
    return;
  }

  const {
    el, isNum, deadPanel, DASH, MINUS,
    gamma: renderGamma, displacement: renderDisplacement, surface: renderSurface,
    calendar: renderCalendar, pricedMove: renderMove, context: renderContext,
    levels: renderLevels, path: renderPath, congress: renderCongress,
    score: renderScore,
  } = P;

  const cache = new Map();          // ticker -> payload, LRU-bounded
  const CACHE_MAX = 6;
  let pushedByUs = false;
  let current = null;
  let opener = null;
  const inflight = new Map();

  const $ = (id) => document.getElementById(id);

  /* ---------- assembly ---------------------------------------------- */

  function fmtDate(iso) {
    if (!iso) return DASH;
    const d = new Date(iso.length <= 10 ? iso + "T00:00:00Z" : iso);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(iso);
  }

  let painted = null;

  function paint(card, updatedAt) {
    painted = { card, updatedAt };
    $("fcTitle").textContent = card.ticker;
    const score = isNum(card.score);
    const badge = $("fcScore");
    badge.textContent = score === null ? DASH
      : (score > 0 ? "+" : score < 0 ? MINUS : "") + Math.abs(score);
    badge.className = "fc-score " + (score === null ? "" : score < 0 ? "is-neg" : "is-pos");
    const conv = isNum(card.conviction);
    $("fcConv").textContent = conv === null ? DASH : conv + " conviction";
    const regime = card.regime && card.regime.label;
    $("fcRegime").textContent = regime === "short" ? "short Γ" : regime === "long" ? "long Γ" : DASH;

    /* The dialog is the quick look; /flows/ticker/ is the drill. Filled per
       card rather than emitted with an href, because the markup is ONE shared
       dialog reused for every name — a static href would point at whichever
       ticker happened to be painted first, forever. */
    const full = $("fcFull");
    if (full) {
      full.href = "/flows/ticker/?t=" + encodeURIComponent(String(card.ticker || ""));
      full.title = "Every panel for " + String(card.ticker || "") + ", on its own page";
      full.hidden = !card.ticker;
    }

    /* Staleness is a BAND, not a toast: a reader scrolls past a toast.
       Once a card has been written, a later pipeline failure leaves the old
       row in place and the API answers 200 with old numbers beside a board
       showing today's date. The Worker cannot detect that without parsing,
       which is the one thing this architecture refuses to do, so the check
       lives here. */
    const band = $("fcStale");
    const age = updatedAt ? Date.now() - updatedAt : null;
    const stale = age !== null && age > 36 * 3600 * 1000;
    band.hidden = !stale;
    dialog.classList.toggle("is-stale", stale);
    if (stale) {
      band.textContent =
        `This card was last built ${Math.floor(age / 3600000)} hours ago, on the ` +
        `${fmtDate(card.sessionDate)} session. Its numbers are not today's and are shown dimmed.`;
    }

    const panels = card.panels || {};
    renderGamma($("fcGamma"), panels.gamma, card);
    renderLevels($("fcLevels"), panels.levels);
    renderDisplacement($("fcDisp"), panels.displacement);
    renderSurface($("fcSurface"), panels.surface, card);
    renderCalendar($("fcCal"), panels.calendar);
    renderMove($("fcMove"), panels.pricedMove);
    renderContext($("fcCtx"), panels.context);
    renderPath($("fcPath"), panels.path);
    renderCongress($("fcCongress"), panels.congress);
    renderScore($("fcWhy"), card);

    // Two dates, always. The job runs pre-open, so the session the data
    // describes is not the day it was built, and conflating them is how a
    // card silently claims to be about today.
    $("fcProv").textContent =
      `Session ${fmtDate(card.sessionDate)}  ·  built ${fmtDate(card.generatedAt)}`;
  }

  function showLoading(ticker) {
    $("fcTitle").textContent = ticker;
    $("fcScore").textContent = DASH;
    $("fcConv").textContent = "";
    $("fcRegime").textContent = "";
    $("fcStale").hidden = true;
    // Staleness is a property of a PAINTED payload, so it is cleared by the
    // same function that clears the panels. Leaving it to paint() meant the
    // dim survived into the next card whenever that card was pending or
    // failed to load — and then never cleared at all.
    dialog.classList.remove("is-stale");
    $("fcProv").textContent = "Loading…";
    for (const id of ["fcGamma", "fcSurface", "fcLevels", "fcDisp", "fcCal", "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
      $(id).replaceChildren(el("p", "fc-note", "Loading…"));
    }
  }

  function trim() {
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  function load(ticker) {
    if (cache.has(ticker)) return Promise.resolve(cache.get(ticker));

    /* Keyed by ticker, the way the board already does it.
       A single `inflight` slot meant the hover prefetch was aborted by the
       very click it existed to warm: pointerenter started the fetch, the click
       called load() again, and the first line of the old body aborted it — so
       every card open cost two requests and the prefetch delivered nothing.
       Now a request for the same ticker joins the one in flight, and only a
       request for a DIFFERENT ticker cancels its predecessor. */
    const pending = inflight.get(ticker);
    if (pending) return pending.promise;
    for (const [key, entry] of inflight) {
      if (key !== ticker) { entry.controller.abort(); inflight.delete(key); }
    }

    const controller = new AbortController();
    const promise = fetch("/api/flows/card?t=" + encodeURIComponent(ticker), {
      credentials: "same-origin", signal: controller.signal,
    }).then((r) => {
      if (r.status === 401) { location.href = "/flows/"; return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const updatedAt = Number(r.headers.get("X-Payload-Updated")) || null;
      return r.json().then((body) => ({ body, updatedAt }));
    }).then((v) => {
      if (v) { cache.set(ticker, v); trim(); }
      return v;
    }).finally(() => { inflight.delete(ticker); });
    inflight.set(ticker, { controller, promise });
    return promise;
  }

  function openCard(ticker, fromRow) {
    if (!ticker) return;
    current = ticker;
    opener = fromRow || null;
    showLoading(ticker);
    if (!dialog.open) dialog.showModal();
    $("fcTitle").focus();

    load(ticker).then((v) => {
      if (!v || current !== ticker) return;
      if (v.body && v.body.status === "pending") {
        $("fcProv").textContent = "";
        for (const id of ["fcGamma", "fcSurface", "fcLevels", "fcDisp", "fcCal", "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
          deadPanel($(id), "", "No card has been built for this name yet. Cards are " +
            "published after the boards, so one can briefly lag its row.");
        }
        return;
      }
      paint(v.body, v.updatedAt);
    }).catch((e) => {
      if (e && e.name === "AbortError") return;
      // Every panel still said "Loading…", so a failed card was
      // indistinguishable from a slow one and the reader waited forever.
      for (const id of ["fcGamma", "fcSurface", "fcLevels", "fcDisp", "fcCal", "fcMove", "fcCtx", "fcPath", "fcCongress", "fcWhy"]) {
        deadPanel($(id), "", "This card could not be loaded. Close and try again.");
      }
      $("fcProv").textContent = "This card could not be loaded.";
    });
  }

  function closeCard() {
    current = null;
    if (pushedByUs) { pushedByUs = false; history.back(); return; }
    try {
      const url = new URL(location.href);
      url.searchParams.delete("t");
      history.replaceState(null, "", url);
    } catch { /* deep-linking is a convenience */ }
    if (dialog.open) dialog.close();
  }

  /* ---------- wiring -------------------------------------------------- */

  document.addEventListener("click", (event) => {
    // The deck card and the table's ticker button are both openers. Delegation
    // rather than per-node listeners, so a re-rendered board needs no rebind.
    /* [data-t] IS PART OF THE SELECTOR, not an afterthought inside the
       handler. Rows the pipeline built no card for render with the same
       classes and no data-t, so requiring the attribute here is what makes
       "has a card" a single fact expressed in one place rather than a class
       name the board and this file both have to agree about. */
    const button = event.target.closest &&
      event.target.closest(".fb-open[data-t], .fd-card[data-t]");
    if (!button) return;
    event.preventDefault();
    const ticker = button.dataset.t;
    try {
      const url = new URL(location.href);
      url.searchParams.set("t", ticker);
      history.pushState({ t: ticker }, "", url);
      pushedByUs = true;
    } catch { pushedByUs = false; }
    openCard(ticker, button);
  });

  $("fcClose").addEventListener("click", closeCard);

  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeCard(); });
  /* Backdrop click, by GEOMETRY rather than by event target.
     A <dialog> is its own scroll container, so a click on its scrollbar has
     the dialog itself as event.target — identical to a backdrop click — and
     dragging the scrollbar closed the card. Comparing the pointer against the
     dialog's own box distinguishes the two: the scrollbar is inside it. */
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right
                && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) closeCard();
  });
  dialog.addEventListener("close", () => {
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  });

  window.addEventListener("popstate", () => {
    const t = new URL(location.href).searchParams.get("t");
    pushedByUs = false;
    if (t) openCard(t, null);
    else if (dialog.open) { current = null; dialog.close(); }
  });

  // A deep link straight to ?t=NVDA has no prior history entry, so closing
  // must strip the parameter rather than call history.back() and eject the
  // reader from the site entirely.
  const initial = new URL(location.href).searchParams.get("t");
  if (initial) { pushedByUs = false; openCard(initial, null); }

  /* THE SVGs ARE LAID OUT ONCE, AT OPEN, AND WERE NEVER REDRAWN.

     Every chart on the card sizes itself from host.clientWidth at paint time
     and then relies on the viewBox to scale. That is fine for the geometry and
     wrong for everything measured in absolute units: rotating a phone to
     landscape scaled 10.5px labels to 23.4px and the 132px plate rail to
     294px, so the annotation swallowed the plot it was annotating. Redrawing
     on a settled resize costs one repaint and nothing else — the payload is
     already in hand, so there is no fetch.

     Debounced, because a drag-resize fires continuously, and gated on the
     dialog actually being open. */
  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (!dialog.open || !painted) return;
    // Mobile browsers fire resize when the URL bar hides, changing only the
    // HEIGHT. Redrawing then would flicker the card for no benefit.
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (dialog.open && painted) paint(painted.card, painted.updatedAt);
    }, 160);
  });

  window.flowsCardPrefetch = (ticker) => { if (!cache.has(ticker)) load(ticker).catch(() => {}); };
})();
