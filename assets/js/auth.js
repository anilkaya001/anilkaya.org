/* =============================================================
   auth.js — account and cross-device synchronization layer.
   The app detects the Worker API, merges monotonic progress, and syncs
   the daily streak. Server points are derived from completed stages.
   ============================================================= */
(() => {
  "use strict";
  let user = null, backend = false;
  const store = window.IEWTStorage;

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
  const putJSON = (url, body) => getJSON(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  async function pullAll() {
    let progressComplete = false;
    try {
      const { progress } = await getJSON("/api/progress", { headers: { Accept: "application/json" } });
      if (!progress || typeof progress !== "object" || Array.isArray(progress)) throw new Error("invalid-progress");
      const local = store.progress();
      for (const [m, v] of Object.entries(progress)) {
        const set = new Set([...((local[m] || {}).done || []), ...((v || {}).done || [])]);
        local[m] = { done: [...set].sort((a, b) => a - b) };
      }
      const merged = store.setProgress(local);
      await Promise.all(Object.entries(merged).map(([model, value]) =>
        putJSON("/api/progress", { model, done: value.done })));
      progressComplete = true;
    } catch { /* ignore */ }
    try {
      const { stats } = await getJSON("/api/stats", { headers: { Accept: "application/json" } });
      if (stats && window.Gamify) {
        window.Gamify.merge(stats, { progressComplete });
        const local = window.Gamify.get();
        const saved = await putJSON("/api/stats", { streak: local.streak || 0, last: local.last || null });
        if (saved.stats) window.Gamify.merge(saved.stats);
      }
    } catch { /* ignore */ }
    document.dispatchEvent(new Event("iewt:synced"));
  }

  const Auth = {
    user() { return user; },
    isSignedIn() { return !!user; },
    hasBackend() { return backend; },
    signIn() {
      if (backend) location.href = "/auth/google";
      else window.toast("Google sign-in is unavailable right now. Progress is still saved on this device.");
    },
    signOut() { if (backend) location.href = "/auth/logout"; },
    async pushProgress(model, done) {
      if (!backend || !user) return;
      try { await putJSON("/api/progress", { model, done }); } catch { /* ignore */ }
    },
    async pushStats(stats) {
      if (!backend || !user) return;
      try {
        const saved = await putJSON("/api/stats", { streak: stats.streak || 0, last: stats.last || null });
        if (saved.stats && window.Gamify) window.Gamify.merge(saved.stats);
      } catch { /* ignore */ }
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
  void init();
})();
