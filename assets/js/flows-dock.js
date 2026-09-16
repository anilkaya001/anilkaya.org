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
      p.className = "flows-status";
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

  function setOpen(open, focus) {
    dock.classList.toggle("is-open", open);
    document.body.classList.toggle("has-dock-open", open);
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
      try { tab.focus(); } catch (e) {   }
    });
  }

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

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !dock.classList.contains("is-open")) return;
    if (!dock.contains(document.activeElement)) return;
    setOpen(false, false);
    try { tab.focus(); } catch (err) {   }
  });

  setOpen(false, false);
}());
