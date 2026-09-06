/* =============================================================
   flows-dock.js — the assistant, docked on every page but its own.

   The box was reachable at one route, which made it a destination:
   a reader on the bearish board wondering what changed had to leave
   it to ask. It is now on every gated page, behind the tab or "?".

   THE KEY IS "?" AND IT IS PRINTED ON THE TAB. This file said "one
   key away" from the day it shipped and bound no key at all. "?" is
   free ON THE ROUTES THIS MOUNTS ON — not in assets/js, where
   lab-ui.js binds "/", on /lab/, which draws no dock. That is a
   measurement, so it is measured: contracts.mjs re-derives which
   files share a document with this one and fails if any takes a
   bare printable key.

   IT LOADS NOTHING UNTIL IT IS OPENED, which is why this file is
   separate from the renderer it mounts. assets/js/flows-ask.js is
   94k as measured on 2026-09-05, in the unit and rounding
   tests/flows-weight.mjs prints — one file measured once reads as
   one number in both places. On all twelve dock routes it would
   break every ceiling; the widest headroom of the twelve is side's
   15k. flows-weight measures what a route loads ON ARRIVAL, so the
   deferred 94k is absent there: a real cost, paid on open, said here
   rather than left to look free.

   NOT ON /flows/ask, where the page IS the assistant: two mounts
   collide on `#askApp` and the renderer takes whichever it is given.

   COLLAPSED IS THE DEFAULT: a 380px rail held open takes a quarter
   of the width from a thirteen-column table that earned it. IT DOES
   NOT REMEMBER, which is the house pattern rather than an omission:
   nothing here touches browser storage (contracts.mjs enforces it)
   and Flows keeps every choice in the URL, which for a dock would
   mean threading a parameter through every link on the site — a
   large change for a preference one click on the tab undoes.
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

  /* THE RENDERER IS FETCHED ONCE AND ITS FAILURE IS SAID OUT LOUD. A panel
     that opened onto nothing would read as a broken assistant rather than a
     script that did not arrive, and the reader would not know to reload. */
  function ensureRenderer() {
    if (loaded || loading) return;
    loading = true;
    var s = document.createElement("script");
    s.src = dock.getAttribute("data-src");
    s.defer = true;
    s.onload = function () {
      loaded = true;
      loading = false;
      /* THE OTHER HALF OF focusField'S JOB, at the only moment it can be
         done: on a FIRST open the renderer is still in flight, so the call
         below focused the panel and left the caret nowhere. */
      if (dock.classList.contains("is-open")) focusField();
    };
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

  /* THE FIELD IF IT IS THERE, THE PANEL IF IT IS NOT — focusing the panel
     is what tells someone who cannot see it that it appeared at all. */
  function focusField() {
    var target = panel.querySelector("#askQ") || panel;
    try { target.focus(); } catch (e) { /* a detached node; harmless */ }
  }

  function setOpen(open, focus) {
    dock.classList.toggle("is-open", open);
    tab.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    if (!open) return;
    ensureRenderer();
    if (focus) focusField();
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

  /* "?" OPENS IT, BUT NOT WHERE IT IS A CHARACTER BEING TYPED. Every Flows
     route carries text controls — the board's search, the desk's symbol
     box, this panel's own textarea — and swallowing it there would leave
     the site unable to write a question mark, a worse defect than a missing
     shortcut. Ctrl, Meta and Alt with a printable key belong to the
     browser. It only ever OPENS, so it cannot become a toggle that closes
     a panel a reader is typing into. */
  function typingIn(node) {
    if (!node) return false;
    var tag = node.tagName ? String(node.tagName).toLowerCase() : "";
    return tag === "input" || tag === "textarea" || tag === "select" ||
      node.isContentEditable === true;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (dock.classList.contains("is-open") || typingIn(document.activeElement)) return;
    e.preventDefault();
    setOpen(true, true);
  });

  /* ESCAPE CLOSES IT: a panel that covers content and can only be dismissed
     by finding a small button is a trap for anyone navigating by keyboard.
     Only when the focus is inside it, so Escape elsewhere is the page's. */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !dock.classList.contains("is-open")) return;
    if (!dock.contains(document.activeElement)) return;
    setOpen(false, false);
    try { tab.focus(); } catch (err) { /* harmless */ }
  });

  setOpen(false, false);
}());
