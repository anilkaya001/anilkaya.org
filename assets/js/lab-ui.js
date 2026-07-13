/* =============================================================
   lab-ui.js — the Econometrics Lab home grid.
   Renders TOPIC_META as cards linking to the staged course player,
   with on-device progress and a staggered depth reveal.
   ============================================================= */
(() => {
  "use strict";
  const META = window.TOPIC_META || [];
  const progress = () => window.IEWTStorage.progress();
  const pct = (t) => {
    const done = ((progress()[t.id] || {}).done || []).length;
    return t.stages ? Math.max(0, Math.min(100, Math.round((100 * Math.min(done, t.stages)) / t.stages))) : 0;
  };
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

  function renderNote() {
    const a = document.getElementById("account");
    if (!a) return;
    const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
    a.classList.add("account--note");
    const signedIn = window.Auth && window.Auth.isSignedIn();
    const note = signedIn
      ? "Signed in as <b>" + esc(window.Auth.user().name || window.Auth.user().email || "you") + "</b> — progress &amp; points sync across your devices."
      : "Staged, hands-on courses that run <b>real Python (statsmodels)</b> in your browser. Sign in to sync across devices.";
    a.innerHTML = '<span class="account__txt">' + note + "</span>" +
      '<span class="account__right"><span class="gamify" data-gamify></span>' +
      '<button class="btn btn--ghost" id="authBtn" type="button">' + (signedIn ? "Sign out" : "Sign in") + "</button></span>";
    a.querySelector("#authBtn").addEventListener("click", () => (signedIn ? window.Auth.signOut() : window.Auth.signIn()));
    if (window.Gamify) window.Gamify.paint();
  }

  function renderGrid(grid) {
    grid.innerHTML = "";
    META.forEach((t) => {
      const p = pct(t);
      const cta = p === 0 ? "Start" : p === 100 ? "Review" : "Continue";
      const card = el("a", "model-card reveal");
      card.href = "/lab/" + encodeURIComponent(t.slug) + "/";
      card.innerHTML =
        '<div class="model-card__top"><span class="model-card__badge">' + t.level + '</span><span class="model-card__num">' + t.num + "</span></div>" +
        "<h2>" + t.title + "</h2><p>" + t.blurb + "</p>" +
        '<div class="model-card__foot"><div class="progress"><div class="progress__bar" style="width:' + p + '%"></div></div><span class="progress-label">' + p + "%</span></div>" +
        '<div class="model-card__foot"><span class="model-card__cta">' + cta + ' &rarr;</span><span class="model-card__num">' + t.stages + " steps · 4 modules</span></div>";
      grid.appendChild(card);
    });
    revealCards(grid);
  }

  function revealCards(grid) {
    const cards = Array.from(grid.querySelectorAll(".reveal"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) { cards.forEach((c) => c.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const i = cards.indexOf(e.target);
        e.target.style.transitionDelay = Math.min(i, 8) * 65 + "ms";
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -5% 0px" });
    cards.forEach((c) => io.observe(c));
    setTimeout(() => cards.forEach((c) => c.classList.add("in")), 4000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const grid = document.getElementById("labGrid");
    if (grid) { renderNote(); renderGrid(grid); }
    document.addEventListener("iewt:auth-ready", renderNote);
    document.addEventListener("iewt:synced", () => { renderNote(); if (grid) renderGrid(grid); });
  });
})();
