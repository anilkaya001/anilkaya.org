(() => {
  "use strict";
  const r = document.getElementById("fxMember"), U = () => window.FlowsUI;
  let last = 0, dead = 0, g;
  const ping = (force) => {
    const n = Date.now();
    try { const k = +sessionStorage.fv; if (k <= n) last = Math.max(last, k); } catch {}
    if (dead || document.visibilityState !== "visible" || (!force && n - last < 6e4)) return 0;
    last = n;
    try { sessionStorage.fv = n; } catch {}
    return fetch("/api/me/visit", { method: "POST", credentials: "same-origin", cache: "no-store" }).then(x => {
      if (x.ok) r.dataset.visit = 1;
      else dead = /^40[14]$/.test(x.status);
      return x.text();
    }).catch(() => 0);
  };
  const load = () => g || (g = U().defer("member"));
  const ui = () => load().then(() => U().defer("member-ui"));
  const act = (e) => {
    const t = e.target;
    if (e.type === "toggle") {
      if (t.open && t.matches("[data-member-export]:not([data-bound])")) load().then(() => U().member.exportMenu(t, e));
      return;
    }
    const b = t.closest && t.closest("[data-member-open]");
    if (!b) return;
    e.preventDefault();
    if (b.matches("[aria-busy]")) return;
    const k = b.dataset.memberOpen;
    let late;
    const done = () => { clearTimeout(guard); b.removeAttribute("aria-busy"); };
    const guard = setTimeout(() => { late = 1; done(); U().announce("Could not load. Reload the page."); }, 15e3);
    b.setAttribute("aria-busy", "true");
    Promise.all([ui(), k === "since" && !r.dataset.visit && Promise.race([ping(1), new Promise((ok) => setTimeout(ok, 3e3))])]).then(() => late || U().member.open(k, b, () => late)).finally(() => late || done());
  };
  document.addEventListener("click", act, true);
  document.addEventListener("toggle", act, true);
  const start = () => {
    ping();
    document.addEventListener("visibilitychange", () => ping());
    addEventListener("pageshow", (e) => {
      if (e.persisted) { ping(); r.dispatchEvent(new Event("member:resume")); }
    });
    if (document.getElementById("ftHero") && !navigator.connection?.saveData) load();
  };
  const boot = () => (document.prerendering ? document.addEventListener("prerenderingchange", start, { once: true }) : start());
  if (document.readyState === "complete") boot();
  else addEventListener("load", boot, { once: true });
})();
