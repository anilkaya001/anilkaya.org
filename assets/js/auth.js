/* =============================================================
   auth.js — account scaffold.
   Today: identity + progress live on-device (localStorage), free &
   private. Phase 2: swap signIn() for a Google OAuth round-trip to a
   Cloudflare Pages Function + D1, then sync localStorage progress up.
   The rest of the app only talks to this module, so the swap is local.
   ============================================================= */
(() => {
  "use strict";
  const KEY = "iewt:auth";

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };

  const Auth = {
    user() { return read(); },                 // null until signed in
    isSignedIn() { return !!read(); },
    // Phase 2 hook — replace with: location.href = "/auth/google".
    signIn() {
      window.toast(
        "Google sign-in is coming soon. For now your course progress is saved privately on this device."
      );
    },
    signOut() { localStorage.removeItem(KEY); },
  };

  // Lightweight toast (also used elsewhere)
  let el;
  window.toast = (msg, ms = 4200) => {
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), ms);
  };

  window.Auth = Auth;
})();
