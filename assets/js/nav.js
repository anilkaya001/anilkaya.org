/* =============================================================
   nav.js — smooth sliding indicator for the pill nav.
   The gold pill glides under the active tab, follows the pointer on
   hover, and snaps back on leave. Re-measures on resize / font load.
   ============================================================= */
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setup(pill) {
    const links = Array.from(pill.querySelectorAll("a"));
    if (!links.length) return;
    const active = pill.querySelector("a.is-active") || links[0];

    const ind = document.createElement("span");
    ind.className = "pill__ind";
    pill.insertBefore(ind, pill.firstChild);

    let target = active;

    function place(link, animate) {
      if (!animate) ind.style.transition = "none";
      ind.style.width = link.offsetWidth + "px";
      ind.style.height = link.offsetHeight + "px";
      ind.style.transform = "translate(" + link.offsetLeft + "px," + link.offsetTop + "px)";
      links.forEach((l) => l.classList.toggle("is-current", l === link));
      if (!animate) { void ind.offsetWidth; ind.style.transition = ""; } // restore after reflow
    }

    place(active, false);

    if (!reduce) {
      links.forEach((l) => l.addEventListener("pointerenter", () => { target = l; place(l, true); }));
      pill.addEventListener("pointerleave", () => { target = active; place(active, true); });
    }

    let raf;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => place(target, false));
    }, { passive: true });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => place(target, false));
    }
  }

  function init() { document.querySelectorAll(".pill").forEach(setup); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else { init(); }
})();
