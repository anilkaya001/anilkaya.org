/* =============================================================
   flows-dock.js — the assistant, docked on every page but its own.

   The question box was reachable at one route, which made it a
   destination. A reader looking at the bearish board and wondering
   what changed had to leave the board to ask. This puts the same box
   on the right edge of every gated page, one key away.

   IT LOADS NOTHING UNTIL IT IS OPENED, and that is the whole reason
   this file exists separately from the renderer it mounts.
   assets/js/flows-ask.js is 55KB; served on all thirteen routes it
   would break the weight ceiling of six of them, and it would bill
   every reader who never opens the rail for a feature they did not
   use. This file is a few kilobytes: a button, a panel, and the
   loader that fetches the renderer the first time somebody asks for
   it. tests/flows-weight.mjs measures what a route loads ON ARRIVAL,
   so the ceiling it enforces is honest about that — the deferred
   55KB is a real cost, paid on open, and the ceiling comment says so
   rather than letting a lazy import look free.

   IT IS NOT DRAWN ON /flows/ask, where the page IS the assistant.
   Two mounts would collide on `#askApp` — one id, two elements, and
   the renderer would take whichever the DOM handed it — and a
   floating copy of the page you are already reading is noise.

   COLLAPSED IS THE DEFAULT, AND "ALWAYS ACCESSIBLE" IS NOT THE SAME
   AS "ALWAYS OPEN". A 380px rail held open on the board takes a
   quarter of the width from a thirteen-column table that has spent
   two design phases earning it. The tab is always visible and the
   panel is one click or one keystroke away.

   IT DOES NOT REMEMBER, AND THAT IS THE HOUSE PATTERN RATHER THAN AN
   OMISSION. No file under this section touches browser storage —
   tests/contracts.mjs enforces it, and flows-desk.js shows what Flows
   does instead: every choice it makes goes into the URL's query
   string, where it is linkable, bookmarkable and sendable to someone
   else. A dock spans pages, so a query parameter would have to be
   threaded through every link on the site to survive a navigation,
   which is a large change to make for a preference whose cost of
   being wrong is one click on a tab that is already on screen.
   ============================================================= */
(function () {
  "use strict";

  var dock = document.getElementById("askDock");
  var tab = document.getElementById("askDockTab");
  if (!dock || !tab) return;

  var panel = dock.querySelector(".ak-dock-panel");
  var host = dock.querySelector("#askApp");
  var closeBtn = dock.querySelector(".ak-dock-close");
  if (!panel || !host) return;

  var loaded = false;
  var loading = false;

  /* THE RENDERER IS FETCHED ONCE AND ITS FAILURE IS SAID OUT LOUD. A
     panel that opened onto nothing would read as a broken assistant
     rather than as a script that did not arrive, and the reader would
     not know that reloading is the thing to try. */
  function ensureRenderer() {
    if (loaded || loading) return;
    loading = true;
    var s = document.createElement("script");
    s.src = dock.getAttribute("data-src");
    s.defer = true;
    s.onload = function () { loaded = true; loading = false; };
    s.onerror = function () {
      loading = false;
      var p = document.createElement("p");
      p.className = "flows-status";
      p.setAttribute("data-empty", "unreadable");
      p.textContent = "The assistant's script did not load, so the question box is not " +
        "available on this page. Nothing about the readings on the page changes; reloading " +
        "is what to try.";
      host.append(p);
    };
    document.head.append(s);
  }

  function setOpen(open, focus) {
    dock.classList.toggle("is-open", open);
    tab.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    if (!open) return;
    ensureRenderer();
    /* FOCUS MOVES TO THE PANEL, NOT TO THE FIELD, on open. The field may
       not exist yet — the renderer is still in flight on a first open —
       and focusing a heading a screen reader can announce is what tells
       someone who cannot see the panel that it appeared at all. */
    if (focus) {
      var target = panel.querySelector("#askQ") || panel;
      try { target.focus(); } catch (e) { /* a detached node; harmless */ }
    }
  }

  tab.addEventListener("click", function () {
    setOpen(!dock.classList.contains("is-open"), true);
  });
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      setOpen(false, false);
      try { tab.focus(); } catch (e) { /* harmless */ }
    });
  }

  /* ESCAPE CLOSES IT, because a panel that covers content and can only
     be dismissed by finding a small button is a trap for anyone
     navigating by keyboard. It closes only when the focus is inside the
     panel, so Escape elsewhere on the page still belongs to the page. */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !dock.classList.contains("is-open")) return;
    if (!dock.contains(document.activeElement)) return;
    setOpen(false, false);
    try { tab.focus(); } catch (err) { /* harmless */ }
  });

  setOpen(false, false);
}());
