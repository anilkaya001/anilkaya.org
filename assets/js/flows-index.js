(() => {
  "use strict";
  const nav = document.getElementById("fxIndex");
  const main = document.getElementById("flowsMain");
  if (!nav || !main) return;
  const links = new Map();
  const live = new Set();
  let io = null;
  let sig = "";
  let mods = [];

  const mark = (id) => {
    if (!links.has(id)) return;
    for (const [k, a] of links) if (k === id) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
    const a = links.get(id);
    const end = a.offsetLeft + a.offsetWidth;
    if (a.offsetLeft < nav.scrollLeft) nav.scrollLeft = a.offsetLeft - 8;
    else if (end > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = end - nav.clientWidth + 8;
  };

  const spy = (entries) => {
    for (const e of entries) if (e.isIntersecting) live.add(e.target.id); else live.delete(e.target.id);
    const hit = mods.find((m) => m.id === location.hash.slice(1) && live.has(m.id)) || mods.find((m) => live.has(m.id));
    if (hit) mark(hit.id);
  };

  function build() {
    mods = [];
    for (const sec of main.querySelectorAll(".ui-mod[id]")) {
      const t = sec.querySelector(".ui-mod-t");
      const id = sec.id;
      const label = t ? Array.from(t.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join("").trim() : "";
      if (label && !sec.closest("[hidden]") && !sec.parentElement.closest(".ui-mod")) mods.push({ id, label, sec });
    }
    const next = mods.map((m) => m.id + "\u0000" + m.label).join("\u0001");
    if (next === sig) return;
    sig = next;
    links.clear();
    live.clear();
    if (io) io.disconnect();
    nav.replaceChildren();
    nav.hidden = mods.length < 3;
    if (nav.hidden) return;
    for (const m of mods) {
      const a = document.createElement("a");
      a.href = "#" + m.id;
      a.textContent = m.label;
      links.set(m.id, a);
      nav.append(a);
    }
    const line = Math.round(parseFloat(getComputedStyle(mods[0].sec).scrollMarginTop) || 0) + 8;
    io = new IntersectionObserver(spy, { rootMargin: `-${line}px 0px -${Math.max(0, innerHeight - line - 1)}px 0px` });
    for (const m of mods) io.observe(m.sec);
  }

  const mo = new MutationObserver(build);
  mo.observe(main, { childList: true });
  for (const g of main.querySelectorAll(".ui-grid, .ft-grid")) mo.observe(g, { childList: true, attributes: true, attributeFilter: ["hidden"] });
  addEventListener("hashchange", () => mark(location.hash.slice(1)));
  addEventListener("resize", () => { sig = ""; build(); }, { passive: true });
  build();
})();
