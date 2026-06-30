/* =============================================================
   auth.js — account layer.
   On a static host (GitHub Pages) there is no /api, so this stays in
   on-device mode. When anilkaya.org is served by the Cloudflare Worker,
   the same code detects the backend, reads the Google session, and
   syncs progress + points/streak. The app only talks to window.Auth.
   ============================================================= */
(() => {
  "use strict";
  let user = null, backend = false;

  let toastEl;
  window.toast = (msg, ms = 4200) => {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), ms);
  };

  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.includes("application/json")) throw new Error("no-backend");
    return r.json();
  }
  const localProgress = () => { try { return JSON.parse(localStorage.getItem("iewt:progress")) || {}; } catch { return {}; } };

  async function pullAll() {
    try {
      const { progress } = await getJSON("/api/progress", { headers: { Accept: "application/json" } });
      if (progress) {
        const local = localProgress();
        for (const [m, v] of Object.entries(progress)) {
          const set = new Set([...((local[m] || {}).done || []), ...((v || {}).done || [])]);
          local[m] = { done: [...set] };
        }
        localStorage.setItem("iewt:progress", JSON.stringify(local));
      }
    } catch { /* ignore */ }
    try {
      const { stats } = await getJSON("/api/stats", { headers: { Accept: "application/json" } });
      if (stats && window.Gamify) window.Gamify.merge(stats);
    } catch { /* ignore */ }
    document.dispatchEvent(new Event("iewt:synced"));
  }

  const Auth = {
    user() { return user; },
    isSignedIn() { return !!user; },
    hasBackend() { return backend; },
    signIn() {
      if (backend) location.href = "/auth/google";
      else window.toast("Google sign-in goes live once anilkaya.org is served by the Cloudflare Worker. Until then, progress is saved on this device.");
    },
    signOut() { if (backend) location.href = "/auth/logout"; },
    async pushProgress(model, done) {
      if (!backend || !user) return;
      try { await fetch("/api/progress", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, done }) }); } catch { /* ignore */ }
    },
    async pushStats(stats) {
      if (!backend || !user) return;
      try { await fetch("/api/stats", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: stats.points || 0, streak: stats.streak || 0, last: stats.last || null }) }); } catch { /* ignore */ }
    },
  };

  async function init() {
    try {
      const { user: u } = await getJSON("/api/me", { headers: { Accept: "application/json" } });
      backend = true;
      user = u || null;
      if (user) await pullAll();
      document.dispatchEvent(new Event("iewt:auth-ready"));
    } catch {
      backend = false;
    }
  }

  window.Auth = Auth;
  init();
})();
