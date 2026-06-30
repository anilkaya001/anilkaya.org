/* =============================================================
   auth.js — account layer.
   On a static host (GitHub Pages) there is no /api, so this stays in
   on-device mode (localStorage). On Cloudflare Pages the same code
   detects the backend, reads the Google session, and syncs progress.
   The rest of the app only talks to window.Auth.
   ============================================================= */
(() => {
  "use strict";

  let user = null;
  let backend = false;

  // ---- Toast --------------------------------------------------
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

  async function pullProgress() {
    try {
      const { progress } = await getJSON("/api/progress", { headers: { Accept: "application/json" } });
      if (progress && window.Progress) {
        const local = window.Progress.all();
        for (const [m, v] of Object.entries(progress)) {
          const set = new Set([...((local[m] || {}).done || []), ...((v || {}).done || [])]);
          local[m] = { done: [...set] };
        }
        localStorage.setItem("iewt:progress", JSON.stringify(local));
        document.dispatchEvent(new Event("iewt:progress-synced"));
      }
    } catch { /* ignore */ }
  }

  const Auth = {
    user() { return user; },
    isSignedIn() { return !!user; },
    hasBackend() { return backend; },
    signIn() {
      if (backend) location.href = "/auth/google";
      else window.toast("Google sign-in activates once the site is deployed to Cloudflare Pages. Until then, progress is saved privately on this device.");
    },
    signOut() { if (backend) location.href = "/auth/logout"; },
    async pushProgress(model, done) {
      if (!backend || !user) return;
      try {
        await fetch("/api/progress", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, done }),
        });
      } catch { /* ignore */ }
    },
  };

  async function init() {
    try {
      const { user: u } = await getJSON("/api/me", { headers: { Accept: "application/json" } });
      backend = true;            // /api/me answered JSON => backend present
      user = u || null;
      if (user) await pullProgress();
      document.dispatchEvent(new Event("iewt:auth-ready"));
    } catch {
      backend = false;           // static host — on-device mode
    }
  }

  window.Auth = Auth;
  init();
})();
