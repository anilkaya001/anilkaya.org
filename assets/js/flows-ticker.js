/* =============================================================
   flows-ticker.js — /flows/ticker/, one name and its whole book.

   THE PAGE EXISTS BECAUSE HALF THE CARD PAYLOAD HAS NEVER BEEN
   DRAWN. `ivSurface`, `skewTerm`, `topContracts` and `aggressor`
   have been built, published, served and cached in every card since
   the chain leg shipped — 42.8% of the mean card's bytes — and no
   renderer has ever touched them. The four drawers below are the
   first readers those payloads have had.

   IT SPENDS NO VENDOR CALL, and one D1 read in the common case.
   Every field is already in `card:<TICKER>`, already allow-listed,
   already served by /api/flows/card. The two board payloads are
   fetched ONLY to tell "this name is not on today's board" apart
   from "its card has not landed yet" — two facts that read
   identically to a reader and are completely different problems —
   or to build the picker when there is no ?t= at all.

   NOTHING HERE HARD-CODES A PANEL ORDER OR AN ELEMENT ID. The walk
   reads `.ft-panel[data-panel]` out of the DOM and looks the key up
   in DRAW. shared/flows-panels.js is the one list; the markup and
   the pipeline's shed ladder read the same array. A key with no
   drawer renders a VISIBLE "no renderer is registered" panel rather
   than an empty box, because an empty box is indistinguishable from
   a panel that drew nothing on purpose.

   THE TEN SHIPPED RENDERERS ARE NOT COPIED HERE. They are
   window.FlowsPanels, extracted from flows-card.js so the dialog and
   this page draw the SAME code and can never disagree about a chart.
   ============================================================= */
(function () {
  "use strict";

  const grid = document.getElementById("ftGrid");
  if (!grid) return;

  const P = window.FlowsPanels;
  if (!P) {
    console.error(
      "flows-ticker: assets/js/flows-panels.js must load before this file — " +
      "the panel renderers live there and this page has nothing to draw with.");
    return;
  }

  const {
    el, svgEl, isNum, deadPanel, DASH, MINUS, AXIS_CH,
    neg, pct, px2, vol1, compact,
  } = P;

  const statusEl = document.getElementById("ftStatus");
  const staleEl = document.getElementById("ftStale");
  const headEl = document.getElementById("ftHead");
  const footEl = document.getElementById("ftFoot");
  const picker = document.getElementById("ftPicker");
  const $ = (id) => document.getElementById(id);

  /* [300, 1200]. The floor is the chart floor the 30rem panel rule protects
     (measured: a 320px viewport gives a 284.8px host, and 300/284.8 = 1.053,
     inside the 15% tolerance the render contract allows). The ceiling binds
     only in the enlarge dialog on a very wide screen: at min(96rem, 96vw)
     less 2x1.7rem the host reaches 1481px, so 1200 is a real clamp there and
     is stated as a choice rather than described as inert. */
  function ftWidth(host) {
    return Math.max(300, Math.min(1200, Math.round(host && host.clientWidth) || 560));
  }

  /* ---------- the four drawers this page adds ---------------------- */
  /* PLACEHOLDERS UNTIL THE FOUR DRAWERS LAND. Each renders an honest dead
     panel rather than being absent: an absent DRAW entry would print "no
     renderer is registered", which is true but reads as a configuration
     mistake, and a missing function would throw a ReferenceError into the
     walk and take the other ten panels down with it. */
  function notYet(host, panel, card, question) {
    deadPanel(host, question,
      "this panel's renderer has not shipped yet. The payload is on the wire " +
      "and has been since the option chain leg landed — what is missing is the " +
      "drawing, not the data.");
  }
  const drawIvSurface = notYet;
  const drawSkewTerm = notYet;
  const drawTopContracts = notYet;
  const drawAggressor = notYet;

  /* ---------- the drawer table ------------------------------------- */

  /* Keyed by the SAME strings shared/flows-panels.js publishes. The test
     suite asserts these two key sets are equal in both directions: a drawer
     with no registry entry never mounts, and a registry entry with no drawer
     is a visible dead panel rather than a blank one. */
  const DRAW = {
    gamma: P.gamma,
    aggressor: drawAggressor,
    ivSurface: drawIvSurface,
    skewTerm: drawSkewTerm,
    topContracts: drawTopContracts,
    levels: P.levels,
    surface: P.surface,
    displacement: P.displacement,
    calendar: P.calendar,
    pricedMove: P.pricedMove,
    path: P.path,
    context: P.context,
    congress: P.congress,
    __score: null,          // drawn from the card's TOP LEVEL, not its panels
  };

  /* ---------- the walk --------------------------------------------- */

  /**
   * Draw every registered panel of one card into its host.
   *
   * @param {string} mount — "grid" or "zoom". Suffixes every <defs> id the
   *   drawers emit. SVG ids are DOCUMENT-GLOBAL and url(#id) resolves to the
   *   first match in document order, so a page holding a grid copy and an
   *   enlarged copy of the same panel would silently give the second drawing
   *   the first's pattern. Today the two tiles happen to be identical; the
   *   moment one scales, it is wrong and nothing looks wrong.
   */
  function drawAll(card, mount) {
    const missing = [];
    for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
      const key = section.dataset.panel;
      const question = section.dataset.question || "";
      const host = section.querySelector("div");
      /* NEVER `if (!host) return`. A host that has gone missing is a markup
         defect, and skipping it silently is how a panel disappears from a
         page for a release without anyone noticing. */
      if (!host) { missing.push(key); continue; }

      if (key === "__score") {
        try { P.score(host, card); }
        catch (error) { deadPanel(host, question, drawFailed(error)); }
        continue;
      }

      const drawer = DRAW[key];
      if (typeof drawer !== "function") {
        deadPanel(host, question, "no renderer is registered for this panel.");
        continue;
      }

      const panel = card.panels && card.panels[key];
      /* THREE DIFFERENT ABSENCES, and only one of them is an error.
         `undefined` is a card built before the panel existed — a legacy
         payload, not a failure. `{status:"unavailable"}` is this run
         declining to publish, and it carries its own reason. Anything else
         goes to the drawer, which switches on status before touching a
         number. */
      if (panel === undefined) {
        deadPanel(host, question,
          "this card was built before the option chain leg shipped, so this " +
          "panel was never in it.");
        continue;
      }

      /* ONE CALL SHAPE FOR EVERY DRAWER. The ten extracted renderers take
         (host, panel) or (host, panel, card); the four new ones take two more.
         JavaScript discards the arguments a function does not declare, so the
         widest signature is safe for all of them and there is no per-panel
         table of shapes to keep in step with the renderers. */
      try {
        drawer(host, panel, card, question, mount);
      } catch (error) {
        deadPanel(host, question, drawFailed(error));
      }
    }
    if (missing.length) {
      console.error("flows-ticker: no drawing host for panel(s): " + missing.join(", "));
    }
  }

  /* A thrown renderer is reported as a dead panel with its message, never as
     a blank box and never as a silently missing section. The message is the
     error's own, because a generic "something went wrong" is exactly the
     string that makes a bug take a week to find. */
  function drawFailed(error) {
    return "this panel's renderer failed: " + String((error && error.message) || error);
  }

  /* ---------- the enlarge dialog ------------------------------------ */

  const zoom = $("ftZoom");
  const zoomHost = $("ftZoomHost");
  const zoomTitle = zoom && zoom.querySelector(".ft-panel-t");
  let zoomKey = null;
  let zoomOpener = null;

  function openZoom(key, section) {
    if (!zoom || !zoomHost || typeof zoom.showModal !== "function") return;
    zoomKey = key;
    zoomOpener = section.querySelector(".ft-zoom-open");
    const titleEl = section.querySelector(".ft-panel-t");
    if (zoomTitle) zoomTitle.textContent = titleEl ? titleEl.textContent : "";
    zoom.showModal();
    /* THE rAF IS REQUIRED, NOT COSMETIC. showModal() on a display:none
       element leaves clientWidth at 0 in the same tick, ftWidth would floor
       to 300, and the ENLARGED panel would be drawn smaller than the grid
       panel it came from. */
    requestAnimationFrame(() => drawZoom());
  }

  function drawZoom() {
    if (!zoomKey || !zoomHost || !painted) return;
    const section = grid.querySelector('.ft-panel[data-panel="' + cssEscape(zoomKey) + '"]');
    const question = (section && section.dataset.question) || "";
    /* REDRAWN AT THE DIALOG'S WIDTH, NEVER CSS-SCALED. transform:scale()
       would multiply every absolute unit — 9px axis type to 24px, the 112px
       rail to 298px — and break the one-viewBox-unit-is-one-CSS-pixel
       invariant in the one place a reader is looking hardest. */
    if (zoomKey === "__score") {
      try { P.score(zoomHost, painted); }
      catch (error) { deadPanel(zoomHost, question, drawFailed(error)); }
      return;
    }
    const drawer = DRAW[zoomKey];
    const panel = painted.panels && painted.panels[zoomKey];
    if (typeof drawer !== "function") {
      deadPanel(zoomHost, question, "no renderer is registered for this panel.");
      return;
    }
    if (panel === undefined) {
      deadPanel(zoomHost, question,
        "this card was built before the option chain leg shipped, so this " +
        "panel was never in it.");
      return;
    }
    try { drawer(zoomHost, panel, painted, question, "zoom"); }
    catch (error) { deadPanel(zoomHost, question, drawFailed(error)); }
  }

  /* CSS.escape is not in every browser this site still answers. The keys are
     the registry's own, so the fallback only has to survive them. */
  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }

  if (zoom) {
    grid.addEventListener("click", (event) => {
      const button = event.target.closest && event.target.closest(".ft-zoom-open");
      if (!button) return;
      const section = button.closest(".ft-panel[data-panel]");
      if (section) openZoom(section.dataset.panel, section);
    });
    const closeButton = $("ftZoomClose");
    if (closeButton) closeButton.addEventListener("click", () => zoom.close());
    /* A GEOMETRIC BACKDROP TEST, not `event.target === dialog`. A <dialog> is
       its own scroll container, so a scrollbar drag has the dialog itself as
       target and the naive test closes the dialog under the reader's cursor. */
    zoom.addEventListener("click", (event) => {
      const box = zoom.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right &&
        event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) zoom.close();
    });
    zoom.addEventListener("close", () => {
      zoomKey = null;
      if (zoomHost) zoomHost.replaceChildren();
      if (zoomOpener && document.contains(zoomOpener)) zoomOpener.focus();
      zoomOpener = null;
    });
  }

  /* ---------- resize ------------------------------------------------ */

  /* GATED ON WIDTH ONLY. Mobile browsers fire resize when the URL bar
     retracts, which changes the height and nothing a chart reads; redrawing
     there would rebuild fourteen panels for a scroll. */
  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!painted) return;
      drawAll(painted, "grid");
      if (zoomKey) drawZoom();
    }, 160);
  });

  /* ---------- the cursor spotlight ----------------------------------

     ONE DELEGATED LISTENER ON THE GRID, ported from flows-board.js without a
     change to its logic. The two attach conditions differ in KIND: `pointer:
     fine` is capability — a touch device has no hover state to decorate —
     and `prefers-reduced-motion` is consent, where the answer is not to
     soften the effect but to not attach at all. The CSS hides the layer too,
     so neither half can leak past the other. Both are re-checked on change,
     because a media query read once at boot is a preference honoured once. */
  const fine = window.matchMedia("(pointer: fine)");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  let spotlightOn = false;
  let frame = 0;
  let pending = null;

  function onPointerMove(event) {
    const panel = event.target.closest && event.target.closest(".ft-panel");
    if (!panel) return;
    pending = { panel, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pending) return;
      const { panel: target, x, y } = pending;
      const box = target.getBoundingClientRect();
      if (!box.width || !box.height) return;
      target.style.setProperty("--mx", (((x - box.left) / box.width) * 100).toFixed(1));
      target.style.setProperty("--my", (((y - box.top) / box.height) * 100).toFixed(1));
    });
  }

  function syncSpotlight() {
    const want = fine.matches && !calm.matches;
    if (want === spotlightOn) return;
    spotlightOn = want;
    if (want) {
      grid.addEventListener("pointermove", onPointerMove, { passive: true });
    } else {
      grid.removeEventListener("pointermove", onPointerMove);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      pending = null;
      for (const panel of grid.querySelectorAll(".ft-panel")) {
        panel.style.removeProperty("--mx");
        panel.style.removeProperty("--my");
      }
    }
  }
  for (const query of [fine, calm]) {
    if (query.addEventListener) query.addEventListener("change", syncSpotlight);
    else if (query.addListener) query.addListener(syncSpotlight);   // older Safari
  }
  syncSpotlight();

  /* ---------- staleness --------------------------------------------- */

  const STALE_WRITE_MS = 30 * 60 * 60 * 1000;
  const STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;

  /* TWO INDEPENDENT TESTS, because a card can be freshly WRITTEN from a stale
     SESSION: the pipeline runs, the vendor is behind, and the payload lands
     with today's timestamp and Friday's numbers. Either fires the band. */
  function assessAge(card) {
    const now = Date.now();
    const parts = [];
    const written = isNum(card.__updatedAt);
    if (written !== null && now - written > STALE_WRITE_MS) {
      parts.push("this card was last written " +
        Math.round((now - written) / 3600000) + " hours ago");
    }
    const session = card.sessionDate ? Date.parse(card.sessionDate + "T00:00:00Z") : NaN;
    if (Number.isFinite(session) && now - session > STALE_SESSION_MS) {
      parts.push("it reports the session of " + card.sessionDate);
    }
    return parts;
  }

  function setStale(parts) {
    if (!staleEl) return;
    if (!parts.length) { staleEl.hidden = true; staleEl.textContent = ""; return; }
    staleEl.textContent = "Stale: " + parts.join(", ") + ".";
    staleEl.hidden = false;
    /* CHROME AS WELL AS WORDS, and never opacity on the glyphs — a dimmed
       number is still read as a number. The class goes on the GRID, matching
       the dialog's `.fc.is-stale .fc-panel`: one write instead of fourteen,
       and one selector for a future reader to find. */
    grid.classList.add("is-stale");
  }

  /* ---------- the request ------------------------------------------- */

  /* Uppercased BEFORE validating, exactly as the Worker does before testing
     its own ticker pattern. Routing ?t=nvda to "choose a name" would break
     every hand-typed URL and contradict the deep link the card dialog has
     shipped for months. */
  function readTicker() {
    try {
      const raw = new URL(location.href).searchParams.get("t");
      if (!raw) return null;
      const t = String(raw).trim().toUpperCase();
      return /^[A-Z][A-Z0-9.-]{0,9}$/.test(t) ? t : null;
    } catch { return null; }
  }

  function getJSON(url) {
    return fetch(url, {
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
    });
  }

  let painted = null;

  function fmtDate(iso) {
    if (!iso) return DASH;
    const d = new Date(String(iso).length <= 10 ? iso + "T00:00:00Z" : iso);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(iso);
  }

  function paint(card) {
    painted = card;
    if (headEl) headEl.hidden = false;
    grid.hidden = false;
    if (picker) picker.hidden = true;

    $("ftTicker").textContent = card.ticker || DASH;
    const score = isNum(card.score);
    const badge = $("ftScore");
    badge.textContent = score === null ? DASH
      : (score > 0 ? "+" : score < 0 ? MINUS : "") + Math.abs(score);
    badge.className = "fc-score " + (score === null ? "" : score < 0 ? "is-neg" : "is-pos");
    const conv = isNum(card.conviction);
    $("ftConv").textContent = conv === null ? DASH : conv + " conviction";
    const regime = card.regime && card.regime.label;
    $("ftRegime").textContent =
      regime === "short" ? "short \u0393" : regime === "long" ? "long \u0393" : DASH;
    $("ftDates").textContent =
      "session " + fmtDate(card.sessionDate) + " \u00b7 built " + fmtDate(card.generatedAt);

    drawAll(card, "grid");
    setStale(assessAge(card));

    statusEl.textContent = (card.ticker || "This name") +
      " \u00b7 every panel the card carries, drawn at page width.";
    if (footEl) {
      footEl.textContent =
        "Every number here is read off the card payload the pipeline published " +
        "for " + fmtDate(card.sessionDate) + ". No vendor call is made by this page.";
    }
  }

  /* ---------- the picker, which is the index and not an error -------- */

  function showPicker(rows, note) {
    if (!picker) return;
    grid.hidden = true;
    if (headEl) headEl.hidden = true;
    picker.hidden = false;
    const body = $("ftPickerBody");
    body.replaceChildren();
    for (const row of rows) {
      const tr = el("tr");
      const tk = el("td");
      const a = el("a", "ft-link");
      a.href = "/flows/ticker/?t=" + encodeURIComponent(String(row.t || ""));
      a.textContent = String(row.t || DASH);
      tk.append(a);
      tr.append(tk);
      tr.append(el("td", null, row.side === "short" ? "Bearish" : "Bullish"));
      const rank = el("td", "c-num");
      rank.textContent = isNum(row.r) === null ? DASH : String(row.r);
      tr.append(rank);
      const sc = el("td", "c-num");
      const s = isNum(row.s);
      sc.textContent = s === null ? DASH : (s > 0 ? "+" : s < 0 ? MINUS : "") + Math.abs(s);
      tr.append(sc);
      body.append(tr);
    }
    const noteEl = $("ftPickerNote");
    if (noteEl) noteEl.textContent = note;
  }

  /* Only the names with a card get a row. `dp` is the deep flag the board
     publishes; a link that usually leads to "no card for this name" is worse
     than no link, and this list is meant to be the one place in the section
     that reliably answers "what can I open?". */
  function boardRows(long, short) {
    const out = [];
    for (const [payload, side] of [[long, "long"], [short, "short"]]) {
      for (const row of (payload && payload.rows) || []) {
        if (row && row.dp === 0) continue;
        out.push({ t: row.t, r: row.r, s: row.s, side });
      }
    }
    return out;
  }

  function start() {
    const ticker = readTicker();

    if (!ticker) {
      /* NO NAME IS NOT AN ERROR — it is the index, and the section has never
         had one. Both boards are fetched here and only here. */
      statusEl.textContent = "Choose a name.";
      Promise.all([
        getJSON("/api/flows/board?side=long").catch(() => null),
        getJSON("/api/flows/board?side=short").catch(() => null),
      ]).then(([long, short]) => {
        const rows = boardRows(long, short);
        if (!rows.length) {
          statusEl.textContent =
            "No board has been published yet, so there is no name to choose.";
          return;
        }
        showPicker(rows,
          "Every name today's board went deep enough on to build a card for. " +
          "A name the board published without a card is not listed, because " +
          "its page would have nothing on it.");
      });
      return;
    }

    getJSON("/api/flows/card?t=" + encodeURIComponent(ticker)).then((card) => {
      if (!card) return;
      if (card.status === "pending" || !card.panels) {
        /* TWO DIFFERENT FACTS THAT LOOK IDENTICAL FROM HERE, and the boards
           are fetched ONLY to tell them apart. "Not on the board" is a
           permanent property of this name today; "the card has not landed"
           is a race that resolves itself in a minute. Telling a reader the
           wrong one costs them either a pointless reload or a name they
           give up on. */
        return Promise.all([
          getJSON("/api/flows/board?side=long").catch(() => null),
          getJSON("/api/flows/board?side=short").catch(() => null),
        ]).then(([long, short]) => {
          const rows = boardRows(long, short);
          const onBoard = rows.some((r) => r.t === ticker);
          statusEl.textContent = onBoard
            ? "The board published " + ticker + " but its card has not landed yet. " +
              "Cards are published after the boards, so one can briefly lag its row."
            : ticker + " is not on today's board. Cards are built only for the " +
              "names the board publishes, so there is nothing to show for this " +
              "name today \u2014 it may be on the watch list.";
          if (!onBoard && rows.length) {
            showPicker(rows, "These are the names that do have a card today.");
          }
        });
      }
      paint(card);
      return null;
    }).catch(() => {
      statusEl.textContent = "This page could not be loaded. Reload to try again.";
      /* NEVER LEFT ON "Loading…". Every panel says what happened, because a
         permanent spinner is the one state a reader cannot act on. */
      grid.hidden = false;
      for (const section of grid.querySelectorAll(".ft-panel[data-panel]")) {
        const host = section.querySelector("div");
        if (host) {
          deadPanel(host, section.dataset.question || "",
            "this page could not be loaded. Reload to try again.");
        }
      }
    });
  }

  start();
})();
