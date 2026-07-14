/* =============================================================
   gamify.js — points + daily streak.
   Points accrue per completed stage; the streak counts consecutive
   days with activity. Stored on-device, and synced to the backend
   (when signed in) via window.Auth.pushStats.
   ============================================================= */
(() => {
  "use strict";
  const store = window.IEWTStorage;
  const write = (state) => store.setGamify(state);
  const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  let remotePointFloor = 0;

  function emit(name, detail) {
    if (typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(name, { detail }));
    else document.dispatchEvent(new Event(name));
  }

  function derivedPoints() {
    const manifest = window.COURSE_STAGE_POINTS;
    if (!manifest || typeof manifest !== "object") return null;
    let total = 0;
    const progress = store.progress();
    for (const [model, value] of Object.entries(progress)) {
      if (!Object.hasOwn(manifest, model) || !Array.isArray(value && value.done)) continue;
      const weights = manifest[model];
      for (const index of new Set(value.done)) {
        if (Number.isInteger(index) && index >= 0 && index < weights.length) total += weights[index];
      }
    }
    return total;
  }

  function read() {
    const state = store.gamify();
    const points = derivedPoints();
    const reconciled = points == null ? state.points : Math.max(points, remotePointFloor);
    if (state.points !== reconciled) {
      state.points = reconciled;
      return write(state);
    }
    return state;
  }

  const Gamify = {
    get() { return read(); },
    award(points) {
      const delta = Number(points);
      if (!Number.isSafeInteger(delta) || delta <= 0) return read();
      const s = store.gamify();
      const prevStreak = s.streak || 0;
      const exact = derivedPoints();
      s.points = exact == null ? Math.min(Number.MAX_SAFE_INTEGER, (s.points || 0) + delta) : Math.max(exact, remotePointFloor);
      const today = day(new Date());
      if (s.last !== today) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        s.streak = (s.last === day(y)) ? (s.streak || 0) + 1 : 1;
        s.last = today;
      }
      write(s); this.paint();
      if ((s.streak || 0) > prevStreak && window.FX && window.FX.streakUp) {
        document.querySelectorAll("[data-gamify] .gstreak").forEach((el) => window.FX.streakUp(el));
      }
      if (window.Auth && typeof window.Auth.pushStats === "function") void window.Auth.pushStats(s);
      return s;
    },
    // Merge the server-derived total and the newest activity date.
    merge(s, options = {}) {
      const c = read();
      const remote = s && typeof s === "object" ? s : {};
      const remoteLast = store.normalizeDay(remote.last);
      const localLast = store.normalizeDay(c.last);
      const remotePoints = Number.isSafeInteger(remote.points) && remote.points >= 0 ? remote.points : 0;
      if (options.progressComplete === true) remotePointFloor = 0;
      else if (options.progressComplete === false) remotePointFloor = Math.max(remotePointFloor, remotePoints);
      const exact = derivedPoints();
      const latest = !localLast || (remoteLast && remoteLast > localLast) ? "remote" :
        !remoteLast || localLast > remoteLast ? "local" : "same";
      const streak = latest === "remote" ? remote.streak : latest === "local" ? c.streak : Math.max(c.streak || 0, remote.streak || 0);
      write({
        points: exact == null ? Math.max(c.points || 0, remotePoints) : Math.max(exact, remotePointFloor),
        streak: Number(streak) || 0,
        last: latest === "remote" ? remoteLast : localLast || remoteLast,
      });
      this.paint();
    },
    // Reset both persisted stats and the in-memory server-point floor. The
    // authenticated reset flow clears storage only after DELETE /api/progress
    // succeeds and therefore passes { storageAlreadyCleared: true } here.
    reset(options = {}) {
      remotePointFloor = 0;
      if (options.storageAlreadyCleared !== true) {
        write({ points: 0, streak: 0, last: null });
      }
      this.paint();
      const state = read();
      emit("iewt:gamify-reset", { state });
      return state;
    },
    paint() {
      const s = read();
      document.querySelectorAll("[data-gamify]").forEach((el) => {
        const points = document.createElement("span");
        points.className = "gpts"; points.title = "Points"; points.textContent = "★ " + (s.points || 0);
        const streak = document.createElement("span");
        streak.className = "gstreak"; streak.title = "Day streak"; streak.textContent = "🔥 " + (s.streak || 0);
        el.replaceChildren(points, streak);
      });
      if (window.FX && window.FX.setStreakState) {
        document.querySelectorAll("[data-gamify] .gstreak").forEach((el) => window.FX.setStreakState(el, (s.streak || 0) > 0 ? "lit" : "none"));
      }
    },
  };
  window.Gamify = Gamify;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Gamify.paint(), { once: true });
  }
  // Like the academy UI, gamify.js is deferred and can safely paint before a
  // CSP-blocked third-party defer allows DOMContentLoaded to fire in Safari.
  Gamify.paint();
  // A server-derived floor is meaningful only for the account that supplied
  // it. Never carry that closure state into an anonymous or different account
  // scope on a shared browser.
  document.addEventListener("iewt:owner-changed", () => {
    remotePointFloor = 0;
    Gamify.paint();
  });
})();
