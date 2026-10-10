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

  function ensureRenderer() {
    if (loaded || loading) return;
    loading = true;
    var css = dock.dataset.css;
    if (css) {
      delete dock.dataset.css;
      document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: css }));
    }
    var s = document.createElement("script");
    s.src = dock.getAttribute("data-src");
    s.defer = true;
    s.onload = function () {
      loaded = true;
      loading = false;

      if (dock.classList.contains("is-open")) focusField();
    };
    s.onerror = function () {
      loading = false;
      var p = document.createElement("p");
      p.className = "ak-empty";
      p.setAttribute("data-empty", "unreadable");
      p.textContent = "The assistant's script did not load, so the question box is not " +
        "available on this page. Nothing about the readings on the page changes; reloading " +
        "is what to try.";
      host.append(p);
    };
    document.head.append(s);
  }

  function focusField() {
    var target = panel.querySelector("#askQ") || panel;
    try { target.focus(); } catch (e) {   }
  }

  var scrim = dock.querySelector(".ak-dock-scrim");
  var narrow = window.matchMedia("(max-width: 1199.98px)");
  var behind = [];
  var opener = null;

  function setModal() {
    var m = narrow.matches;
    panel.setAttribute("role", m ? "dialog" : "complementary");
    if (m) panel.setAttribute("aria-modal", "true");
    else panel.removeAttribute("aria-modal");
    if (!m || !dock.classList.contains("is-open")) {
      while (behind.length) behind.pop().inert = false;
      return;
    }
    if (behind.length) return;
    document.querySelectorAll("body > .flows-skip, #fxSide, #fxScrim, #fxBar, #flowsMain, #fxTabs").forEach(function (n) {
      if (!n.inert) { n.inert = true; behind.push(n); }
    });
  }

  function setOpen(open, focus) {
    if (open && !dock.classList.contains("is-open")) {
      var a = document.activeElement;
      opener = a && a !== document.body && !dock.contains(a) ? a : null;
    }
    document.body.classList.toggle("has-dock-open", open);
    tab.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    if (scrim) scrim.hidden = !open;
    if (open) void panel.offsetWidth;
    dock.classList.toggle("is-open", open);
    setModal();
    if (!open) return;
    ensureRenderer();
    if (focus) focusField();
  }

  function dismiss() {
    setOpen(false, false);
    var back = [opener, tab];
    opener = null;
    back.some(function (n) {
      if (!n || !n.isConnected || !n.getClientRects().length) return false;
      try { n.focus(); } catch (e) {   }
      return document.activeElement === n;
    });
  }

  narrow.addEventListener("change", function () {
    setModal();
    if (behind.length && !dock.contains(document.activeElement)) focusField();
  });

  tab.addEventListener("click", function () {
    setOpen(!dock.classList.contains("is-open"), true);
  });
  if (closeBtn) closeBtn.addEventListener("click", dismiss);
  if (scrim) scrim.addEventListener("click", dismiss);

  function typingIn(node) {
    if (!node) return false;
    var tag = node.tagName ? String(node.tagName).toLowerCase() : "";
    return tag === "input" || tag === "textarea" || tag === "select" ||
      node.isContentEditable === true;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (dock.inert || dock.classList.contains("is-open") || typingIn(document.activeElement)) return;
    e.preventDefault();
    setOpen(true, true);
  });

  function popUp() {
    try { if (document.querySelector(":popover-open")) return true; } catch (e) {   }
    return !!document.querySelector("dialog[open]");
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || e.defaultPrevented || !dock.classList.contains("is-open")) return;
    if (!narrow.matches && !dock.contains(document.activeElement)) return;
    if (popUp()) return;
    dismiss();
  });

  setOpen(false, false);
}());
