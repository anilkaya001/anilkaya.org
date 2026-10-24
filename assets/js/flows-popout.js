(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const host = $("pnNetHost");
  const statusEl = $("pnStatus");
  if (!host) return;
  const OWNER = "network-popout";
  const LABEL = "The flow network";
  const KEYS = new Set(["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  const say = (text) => { if (statusEl) statusEl.textContent = text; };
  const why = (error) => (error && error.message ? error.message : "no message");

  function note(state, word, text) {
    const p = document.createElement("p");
    p.className = "nm-empty";
    p.setAttribute("data-empty", state);
    p.textContent = word + ": " + text;
    host.replaceChildren(p);
    say(word + ": " + text);
  }

  const UI = window.FlowsUI;
  if (!UI) {
    note("unavailable", "Unavailable", "the shared UI library did not load, so the flow network cannot draw. Refresh to try again.");
    return;
  }
  if (typeof UI.defer !== "function") {
    note("unavailable", "Unavailable", "the page's script loader is missing, so the flow network cannot load. Refresh to try again.");
    return;
  }
  note("pending", "Reading", "the flow network and the flagged windows are loading.");

  let current = null;

  const ALERTS = {
    subs: new Set(), last: null, timer: 0, wait: 0,
    sub(fn) { this.subs.add(fn); if (this.last) fn(this.last.alerts, this.last.st); this.kick(); },
    emit(alerts, st) { this.last = { alerts, st }; for (const fn of this.subs) fn(alerts, st); },
    pull() {
      if (document.hidden) return;
      fetch("/api/flows/flowalerts", { credentials: "same-origin", headers: { Accept: "application/json" } }).then((res) => {
        if (res.status === 401) { location.replace("/flows/"); return null; }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then((a) => {
        if (a === null) return;
        if (!a || typeof a !== "object") throw new Error("not a payload");
        if (a.status === "pending") ALERTS.emit(null, { state: "pending", reason: "The pipeline has not published the flagged windows yet." });
        else if (!Array.isArray(a.rows)) ALERTS.emit(null, { state: "unavailable", reason: "The payload carries no rows array: a gap in the payload, not a quiet market." });
        else ALERTS.emit(a, { state: "ok" });
      }).catch((error) => ALERTS.emit(null, { state: "unavailable", reason: "The flagged windows could not be loaded (" + why(error) + ")." }));
    },
    kick() {
      if (this.timer) return;
      this.pull();
      this.timer = setInterval(() => ALERTS.pull(), 60000);
    },
    soon() {
      if (this.wait) return;
      this.wait = setTimeout(() => { ALERTS.wait = 0; ALERTS.pull(); }, 15000);
    },
  };

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, {
    popout: Object.freeze({ map: () => current, state: () => (ALERTS.last ? ALERTS.last.st : null) }),
  }));

  const universe = fetch("/api/flows/universe?cols=t,sec", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((res) => {
      if (res.status === 401) { location.replace("/flows/"); return null; }
      if (res.status === 404) return { status: "pending" };
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .catch((error) => ({ status: "unavailable", reason: why(error) }));

  const rt = UI.rt && typeof UI.rt.connect === "function" ? UI.rt.connect({ topics: ["fl"] }) : null;
  if (rt && typeof rt.on === "function") rt.on("fl", () => ALERTS.soon());
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ALERTS.timer) ALERTS.pull(); });
  ALERTS.kick();

  function linkUp(api) {
    const idle = { apply() {} };
    const L = window.FlowsUI && window.FlowsUI.link;
    if (!L || typeof L.join !== "function" || typeof L.emit !== "function") return idle;
    let want = null;
    let last = null;
    const layerOf = (i) => {
      const M = api.model();
      return M && Array.isArray(M.layers) && M.layers[i] ? M.layers[i] : null;
    };
    function apply() {
      if (!want) return;
      const list = layerOf(want.kind === "ticker" ? 2 : 1);
      if (!list) return;
      const n = list.find((x) => (want.kind === "ticker" ? x.id === "n:" + want.value : x.id !== "s:~" && (x.full === want.value || x.label === want.value)));
      if (!n) return;
      last = n.id;
      const sc = api.scene();
      if (!sc || sc.selected !== n.id) api.select(n.id);
    }
    function check() {
      const sc = api.scene();
      const id = sc ? sc.selected : null;
      if (!id || id === last) return;
      last = id;
      if (id.startsWith("n:") && id !== "n:~") {
        const value = id.slice(2);
        want = { kind: "ticker", value };
        L.emit(OWNER, { kind: "ticker", value, source: "network" });
      } else if (id.startsWith("s:") && id !== "s:~") {
        const n = (layerOf(1) || []).find((x) => x.id === id);
        const value = n ? n.full || n.label : null;
        if (!value) return;
        want = { kind: "sector", value };
        L.emit(OWNER, { kind: "sector", value, source: "network" });
      }
    }
    L.join(OWNER, {
      kinds: ["ticker", "sector"],
      on(s) {
        if (!s || (s.kind !== "ticker" && s.kind !== "sector") || s.value === null || s.value === undefined) return;
        want = { kind: s.kind, value: s.value };
        apply();
      },
    });
    const user = (ev) => {
      const t = ev.target;
      if (t && typeof t.closest === "function" && t.closest(".nm-chip")) check();
    };
    host.addEventListener("click", user);
    host.addEventListener("keydown", (ev) => { if (KEYS.has(ev.key)) user(ev); });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => requestAnimationFrame(apply)).observe(host);
    return { apply };
  }

  const loaded = UI.defer("net", { when: "visible", el: host, label: LABEL })
    .then(() => UI.defer("netmap", { when: "idle", el: host, label: LABEL }));

  Promise.all([universe, loaded]).then(([u]) => {
    const now = window.FlowsUI;
    const map = now && now.netMap;
    if (!map || typeof map.mount !== "function") {
      note("unavailable", "Unavailable", "the network module loaded without its map, so nothing can be drawn. Refresh to try again.");
      return;
    }
    const api = map.mount(host, { sectors: u || { status: "pending" } });
    if (!api) {
      note("unavailable", "Unavailable", "the network map did not mount, so nothing can be drawn. Refresh to try again.");
      return;
    }
    current = api;
    const link = linkUp(api);
    ALERTS.sub((a, st) => {
      api.take(a, st);
      if (st && st.state === "ok" && a && Array.isArray(a.rows)) {
        const n = a.rows.length;
        say(n ? n + (n === 1 ? " flagged window read." : " flagged windows read.") : "Nothing flagged in this read: a quiet market, not a failure.");
      } else {
        say(st && st.reason ? st.reason : "Reading the flagged windows.");
      }
      link.apply();
    });
  }).catch((error) => note("unavailable", "Unavailable", "the flow network failed while drawing (" + why(error) + ")."));
})();

