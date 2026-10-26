(() => {
  "use strict";
  const stage = document.getElementById("fdStage");
  const bar = document.getElementById("fdTabs");
  if (!stage || !bar) return;
  const TABS = [...bar.querySelectorAll("[role=tab]")];
  const MODS = [...stage.children].filter((m) => m.classList.contains("fd-mod"));
  const STEP = Object.freeze({ ArrowRight: 1, ArrowLeft: -1 });
  const dlg = document.createElement("dialog");
  dlg.className = "fd-dlg";
  dlg.innerHTML = '<div class="fd-dlg-in"><header><h2></h2><button type="button" class="fd-dlg-x">Close</button></header><div class="fd-dlg-b"></div></div>';
  document.body.append(dlg);
  dlg.querySelector(".fd-dlg-x").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });

  const SKIP = new Set(["OPTION", "BUTTON", "TH", "SPAN", "svg"]);
  const kindOf = (c) => c.tagName + "." + (c.classList[0] || "");
  const stacked = (g) => {
    let sum = 0, edge = -Infinity;
    for (const c of g) {
      const r = c.getBoundingClientRect();
      if (!r.height) continue;
      if (r.top < edge - 1) return 0;
      edge = r.bottom;
      sum += r.height;
    }
    return sum;
  };
  const repeated = (body) => {
    const found = [];
    for (const el of [body, ...body.querySelectorAll("*")]) {
      if (el.closest("svg, canvas, dialog") || el.children.length < 4) continue;
      const groups = new Map();
      for (const c of el.children) {
        if (SKIP.has(c.tagName)) continue;
        const k = kindOf(c);
        groups.set(k, (groups.get(k) || []).concat(c));
      }
      for (const g of groups.values()) {
        if (g.length < 4 || g.length * 2 < el.children.length) continue;
        const score = stacked(g);
        if (score > 0) found.push({ g, score });
      }
    }
    found.sort((a, b) => b.score - a.score);
    const taken = new Set();
    return found.filter((f) => !f.g.some((c) => taken.has(c))).map((f) => { for (const c of f.g) for (let e = c; e && e !== body; e = e.parentElement) taken.add(e); return f.g; });
  };

  function allButton(mod, show, body) {
    const head = mod.querySelector(":scope > .ui-mod-h");
    if (!head) return;
    let btn = head.querySelector(".fd-all");
    if (!show) { if (btn) btn.hidden = true; return; }
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fd-all";
      btn.textContent = "Show all";
      btn.setAttribute("aria-haspopup", "dialog");
      head.append(btn);
      btn.addEventListener("click", () => {
        const copy = body.cloneNode(true);
        for (const el of copy.querySelectorAll(".fd-cut")) el.classList.remove("fd-cut");
        for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
        const t = mod.querySelector(".ui-mod-t");
        dlg.querySelector("h2").textContent = t ? t.textContent : "All rows";
        dlg.querySelector(".fd-dlg-b").replaceChildren(copy);
        dlg.showModal();
      });
    }
    btn.hidden = false;
  }

  function fit(mod) {
    const body = mod.querySelector(":scope > .fd-body");
    if (!body || mod.hasAttribute("data-free") || mod.inert || !body.clientHeight) return;
    for (const el of body.querySelectorAll(".fd-cut")) el.classList.remove("fd-cut");
    const groups = repeated(body);
    let cut = false;
    for (const kids of groups) {
      for (const k of kids) if (k.hidden && !k.dataset.fit) { k.hidden = false; k.dataset.fit = "1"; }
      let n = kids.length;
      while (n > 1 && body.scrollHeight > body.clientHeight + 1) {
        const over = body.scrollHeight - body.clientHeight;
        const rowH = Math.max(12, kids[n - 1].getBoundingClientRect().height || 24);
        const step = Math.max(1, Math.min(n - 1, Math.ceil(over / rowH)));
        for (let i = n - step; i < n; i++) kids[i].classList.add("fd-cut");
        n -= step;
        cut = true;
      }
    }
    for (const aux of body.querySelectorAll(":scope > .fe-beyond, :scope > .ui-legend")) {
      if (body.scrollHeight <= body.clientHeight + 1) break;
      aux.classList.add("fd-cut");
      cut = true;
    }
    allButton(mod, cut, body);
  }

  let queued = 0;
  const fitAll = () => { queued = 0; for (const m of MODS) fit(m); };
  const later = () => { if (!queued) queued = requestAnimationFrame(fitAll); };
  const watch = new MutationObserver(later);
  for (const m of MODS) {
    const b = m.querySelector(":scope > .fd-body");
    if (b) watch.observe(b, { childList: true, subtree: true, characterData: true });
  }
  if (typeof ResizeObserver === "function") {
    const sizes = new ResizeObserver(later);
    sizes.observe(stage);
    for (const m of MODS) { const b = m.querySelector(":scope > .fd-body"); if (b) sizes.observe(b); }
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(later);

  function show(key, focus, quiet) {
    const tab = TABS.find((t) => t.dataset.tab === key) || TABS[0];
    key = tab.dataset.tab;
    stage.dataset.view = key;
    for (const t of TABS) { const on = t === tab; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; }
    for (const m of MODS) { const on = m.dataset.tab === key; m.toggleAttribute("data-on", on); m.inert = !on; }
    if (focus) tab.focus();
    if (!quiet) { try { history.replaceState(null, "", "#view=" + key); } catch (error) { void error; } }
    later();
  }
  for (const [i, t] of TABS.entries()) {
    t.addEventListener("click", () => show(t.dataset.tab, false));
    t.addEventListener("keydown", (ev) => {
      const d = STEP[ev.key];
      const to = d !== undefined ? i + d : ev.key === "Home" ? 0 : ev.key === "End" ? TABS.length - 1 : null;
      if (to === null) return;
      ev.preventDefault();
      show(TABS[(to + TABS.length) % TABS.length].dataset.tab, true);
    });
  }
  const fromHash = () => { const m = /view=([a-z-]+)/.exec(location.hash); return m ? m[1] : TABS[0].dataset.tab; };
  show(fromHash(), false, true);
  addEventListener("hashchange", () => show(fromHash(), false, true));
})();
