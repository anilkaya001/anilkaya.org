/* =============================================================
   gamify.js — points + daily streak.
   Points accrue per completed stage; the streak counts consecutive
   days with activity. Stored on-device, and synced to the backend
   (when signed in) via window.Auth.pushStats.
   ============================================================= */
(() => {
  "use strict";
  const KEY = "iewt:gamify";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { points: 0, streak: 0, last: null }; } catch { return { points: 0, streak: 0, last: null }; } };
  const write = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  const day = (d) => d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();

  const Gamify = {
    get() { return read(); },
    award(points) {
      const s = read();
      s.points = (s.points || 0) + points;
      const today = day(new Date());
      if (s.last !== today) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        s.streak = (s.last === day(y)) ? (s.streak || 0) + 1 : 1;
        s.last = today;
      }
      write(s); this.paint();
      if (window.Auth && typeof window.Auth.pushStats === "function") window.Auth.pushStats(s);
      return s;
    },
    // Merge backend stats in (keep the best of each).
    merge(s) {
      const c = read();
      write({ points: Math.max(c.points || 0, (s && s.points) || 0), streak: Math.max(c.streak || 0, (s && s.streak) || 0), last: (s && s.last) || c.last });
      this.paint();
    },
    paint() {
      const s = read();
      document.querySelectorAll("[data-gamify]").forEach((el) => {
        el.innerHTML = '<span class="gpts" title="Points">★ ' + (s.points || 0) + '</span>' +
          '<span class="gstreak" title="Day streak">🔥 ' + (s.streak || 0) + "</span>";
      });
    },
  };
  window.Gamify = Gamify;
  document.addEventListener("DOMContentLoaded", () => Gamify.paint());
})();
