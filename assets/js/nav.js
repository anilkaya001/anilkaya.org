/* =============================================================
   nav.js — the pill nav's sliding gold indicator.
   Every tab is normalised to the widest tab's width, so the
   indicator is a FIXED size that only ever glides horizontally —
   solid, never "flippy". It marks the active tab, follows the
   pointer on hover, and returns on leave. Re-measures on resize
   and font load.
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

    // Normalise every tab to the widest tab's width → the indicator never
    // resizes; it only translates.
    function equalize() {
      links.forEach((l) => (l.style.width = ""));
      let w = 0;
      for (const l of links) w = Math.max(w, Math.ceil(l.getBoundingClientRect().width));
      links.forEach((l) => (l.style.width = w + "px"));
    }

    function place(link, animate) {
      if (!animate) ind.style.transition = "none";
      ind.style.width = link.offsetWidth + "px";
      ind.style.height = link.offsetHeight + "px";
      ind.style.transform = "translate(" + link.offsetLeft + "px," + link.offsetTop + "px)";
      links.forEach((l) => l.classList.toggle("is-current", l === link));
      if (!animate) { void ind.offsetWidth; ind.style.transition = ""; }  // restore after reflow
    }

    function layout(animate) { equalize(); place(target, animate); }
    layout(false);

    if (!reduce) {
      links.forEach((l) => l.addEventListener("pointerenter", () => { target = l; place(l, true); }));
      pill.addEventListener("pointerleave", () => { target = active; place(active, true); });
    }

    let raf;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { target = active; layout(false); });
    }, { passive: true });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => layout(false));
    }
  }

  function init() { document.querySelectorAll(".pill").forEach(setup); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else { init(); }
})();
