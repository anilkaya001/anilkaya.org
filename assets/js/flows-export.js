(() => {
  "use strict";
  const UI = window.FlowsUI;
  if (!UI || UI.exportMenu) return;
  const { h, F } = UI;
  const PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "stop-color",
    "font-family", "font-size", "font-weight", "letter-spacing"];

  function cell(v) {
    if (v == null) return "";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
    const t = String(v);
    const u = /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
    return /[",\r\n]/.test(u) ? '"' + u.replace(/"/g, '""') + '"' : u;
  }

  function csv(rows, cols, notes) {
    const line = (cells) => cells.map(cell).join(",");
    return [line(cols.map((c) => (c.unit ? c.label + " (" + c.unit + ")" : c.label))),
      ...rows.map((r) => line(cols.map((c) => c.get(r)))),
      ...(notes || []).map((n) => line([n, ...cols.slice(1).map(() => "")]))].join("\r\n") + "\r\n";
  }

  function save(name, type, parts) {
    const url = URL.createObjectURL(new Blob(parts, { type }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function exportCsv(spec) {
    const at = new Date().toISOString();
    const stamp = F.stamp(at);
    const iso = stamp.slice(0, 10) + "T" + stamp.slice(11, 16) + ":" + at.slice(17, 19) + "+03:00";
    save(spec.name + "-" + (spec.asOf || F.trtDay(at)) + ".csv", "text/csv;charset=utf-8", ["﻿", csv(spec.rows, spec.cols, [
      "Source: " + spec.source + (spec.asOf ? "; as of " + spec.asOf : ""), "Exported " + stamp + " (" + iso + ") from anilkaya.org"])]);
    UI.announce("CSV downloaded.");
  }

  function exportChart(node, name, png) {
    const box = node.getBoundingClientRect(), w = Math.round(box.width) || 1, ht = Math.round(box.height) || 1;
    const copy = node.cloneNode(true), bg = getComputedStyle(document.body).backgroundColor;
    const neutral = node.classList.contains("has-on");
    const walk = (a, b) => {
      const cs = getComputedStyle(a);
      b.setAttribute("style", PROPS.map((p) => p + ":" + (neutral && p === "opacity" && a.classList.contains("tile") ? "1" : cs.getPropertyValue(p))).join(";"));
      for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]);
    };
    walk(node, copy);
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.setAttribute("width", w);
    copy.setAttribute("height", ht);
    copy.setAttribute("style", copy.getAttribute("style") + ";background:" + bg);
    const svg = new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" });
    if (!png) { save(name + ".svg", svg.type, [svg]); UI.announce("SVG downloaded."); return; }
    const url = URL.createObjectURL(svg), img = new Image(), k = Math.min(2, 4096 / Math.max(w, ht));
    img.onload = () => {
      const c = h("canvas", { width: Math.round(w * k), height: Math.round(ht * k) }), x = c.getContext("2d");
      x.fillStyle = bg;
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => { if (b) { save(name + ".png", "image/png", [b]); UI.announce("PNG downloaded."); } });
    };
    img.onerror = () => { URL.revokeObjectURL(url); UI.announce("Export failed."); };
    img.src = url;
  }

  let menus = 0;

  function exportMenu(opts) {
    const own = opts.el instanceof Element ? opts.el : null;
    const list = own ? own.querySelector(".ui-exp-m") : h("div", { class: "ui-exp-m", role: "group", "aria-label": "Export" });
    const box = own || h("details", { class: "ui-exp" }, h("summary", { class: "ui-exp-b" }, "Export"), list);
    const item = (label, run, note) => {
      const b = h("button", { type: "button", class: "ui-exp-i", "aria-describedby": note || null, onclick: () => {
        if (b.getAttribute("aria-disabled") === "true") return;
        box.open = false;
        box.querySelector("summary").focus();
        run();
      } }, label);
      return b;
    };
    let seq = 0;
    const noteId = "uiExpQ" + ++menus;
    const render = () => {
      if (!box.open) return;
      const mine = ++seq;
      const spec = opts.csv && opts.csv(), node = opts.svg && opts.svg();
      const remote = opts.remote ? opts.remote() : null;
      const buttons = remote ? remote.items.map((i) => item(i.label, i.run, i.limited && remote.quota ? noteId : null)) : [];
      const note = remote ? h("span", { class: "ui-exp-n", id: noteId, role: "status" }, remote.quota ? "Checking your export limit." : remote.note || "") : null;
      list.replaceChildren(...[...buttons, spec && spec.rows.length ? item("CSV", () => exportCsv(spec)) : null,
        node ? item("SVG", () => exportChart(node, opts.name)) : null, node ? item("PNG", () => exportChart(node, opts.name, true)) : null,
        note && note.textContent ? note : null].filter(Boolean));
      if (!list.children.length) list.append(h("span", { class: "ui-exp-n" }, "Nothing to export yet."));
      if (!remote || !remote.quota) return;
      Promise.resolve().then(() => remote.quota()).then((q) => {
        if (mine !== seq || !box.open) return;
        note.textContent = q.text;
        remote.items.forEach((i, k) => { if (q.full && i.limited) buttons[k].setAttribute("aria-disabled", "true"); });
      }, () => { if (mine === seq && box.open) note.textContent = "Exports left: \u2014 (could not check)."; });
    };
    box.addEventListener("keydown", (e) => { if (e.key === "Escape" && box.open) { box.open = false; box.querySelector("summary").focus(); } });
    box.addEventListener("focusout", (e) => { if (box.open && !box.contains(e.relatedTarget)) box.open = false; });
    const seen = new WeakSet();
    if (opts.event) seen.add(opts.event);
    box.addEventListener("toggle", (e) => {
      if (seen.has(e)) return;
      seen.add(e);
      render();
    });
    if (own) render();
    return box;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { csv, exportCsv, exportMenu }));
})();
