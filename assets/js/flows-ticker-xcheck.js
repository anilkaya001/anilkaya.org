(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const { h, F } = UI;
  const DASH = UI.DASH || "—";
  const MOUNTS = new WeakMap();
  const holder = document.querySelector('i[data-defer="xcheck"][data-css]');
  const href = holder ? holder.getAttribute("data-css") : null;
  const ready = new Promise((ok) => {
    if (!href || document.querySelector('link[href="' + href + '"]')) { ok(); return; }
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href, onload: ok, onerror: ok });
    document.head.append(link);
  });

  const COPY = Object.freeze({
    "title.xcheck": "Engine cross-check",
    "xcheck.what": "The feed's own figures, checked against the site's engine.",
    "xcheck.agree": "Agrees within tolerance on {n} checks.",
    "xcheck.differs": "Differs on {n} of {m} checks.",
    "xcheck.nc": "Not compared: {reason}.",
    "xcheck.units.1pct": "The feed's gamma reads as per 1% move, so it is not compared.",
    "xcheck.units.none": "The feed does not state gamma's unit; its figures match neither.",
    "xcheck.stale": "Last audited {date}; names rotate through the audit.",
    "xcheck.never": "Not audited in the last five sessions.",
    "xcheck.convention": "Delta conventions can differ by the dividend discount; tolerance covers it.",
    "xcheck.self": "Feed against feed: its chain and its at-the-money table.",
  });
  const NC_WORDS = Object.freeze({
    engine: "the engine has no fit for this expiry",
    strikes: "fewer than three strikes in common",
    date: "the feed row is from another session",
    "partial chain": "the chain read was partial",
    units: "the gamma unit is not stated",
    absent: "the feed returned nothing",
    failed: "the feed read failed",
    plan: "the feed plan does not include it",
    limited: "the feed was rate limited",
    few: "too few checks",
  });
  const WITHHELD = Object.freeze([
    ["Theta, vega, rho, charm, vanna", "The feed does not state the unit."],
    ["Gamma and gamma exposure", "The feed does not state gamma's unit."],
    ["IV rank", "The feed does not say whether this is a fraction or a percent."],
    ["Realised range high and low", "The feed describes this as an implied volatility."],
  ]);
  const say = (key, values) => COPY[key].replace(/\{([a-z]+)\}/g, (whole, name) => (values && Object.hasOwn(values, name) ? String(values[name]) : whole));
  const isNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const GLYPH = Object.freeze({ agree: "✓", differs: "✕", nc: "–" });
  const WORD = Object.freeze({ agree: "Agrees", differs: "Differs", nc: "Not compared" });

  const sig4 = (x) => {
    const n = isNum(x);
    if (n === null) return DASH;
    if (n === 0) return F.px(0, 3);
    return F.px(n, Math.max(0, Math.min(8, 3 - Math.floor(Math.log10(Math.abs(n))))));
  };
  const FMT = Object.freeze({
    spot: { label: "Spot", v: (x) => F.px(x, 2), gap: (g) => F.pct(g, 2), tol: (t) => F.pct(t, 2) },
    delta: { label: "Delta", v: (x) => F.px(x, 3), gap: (g) => F.signed(g, 3), tol: (t) => F.px(t, 3) },
    iv: { label: "IV", v: (x) => F.num(x, false, 1) + "%", gap: (g) => F.signed(g, 1) + " pts", tol: (t) => F.num(t, false, 1) + " pts" },
    gamma: { label: "Gamma", v: sig4, gap: (g) => F.pct(g, 1), tol: (t) => F.pct(t, 1) },
    oiExpiry: { label: "OI expiry", v: (x) => F.int(x), gap: (g) => F.pct(g, 2), tol: (t) => F.pct(t, 1) },
    oiAll: { label: "OI all", v: (x) => F.int(x), gap: (g) => F.pct(g, 2), tol: (t) => F.pct(t, 1) },
    dexExpiry: { label: "Delta exposure", v: (x) => F.num(x, true), gap: (g) => F.pct(g, 1), tol: (t) => F.pct(t, 1) },
    gexAll: { label: "Gamma exposure", v: (x) => F.money(x, true), gap: (g) => F.pct(g, 1), tol: (t) => F.pct(t, 1) },
    chainSelf: { label: "Chain vs ATM", v: (x) => F.int(x), gap: (g) => F.int(g), tol: (t) => F.int(t) },
  });
  const LEFT = Object.freeze(["spot", "delta", "iv", "gamma"]);
  const RIGHT = Object.freeze(["oiExpiry", "oiAll", "dexExpiry", "gexAll"]);

  function model(cardX) {
    const va = cardX && typeof cardX === "object" && cardX.va && typeof cardX.va === "object" && Array.isArray(cardX.va.rows) ? cardX.va : null;
    if (!va) return { state: "never", text: say("xcheck.never") };
    const rows = new Map(va.rows.map((r) => [r[0], { id: r[0], e: r[1], f: r[2], gap: r[3], tol: r[4], v: r[5], why: r[6] || null }]));
    const stale = typeof cardX.sessionDate === "string" && va.session !== cardX.sessionDate;
    const n = va.n || { agree: 0, differs: 0, nc: 0 };
    const compared = n.agree + n.differs;
    const units = va.unit === "per1%" ? say("xcheck.units.1pct") : va.unit === null && rows.get("gamma") && rows.get("gamma").why === "units" ? say("xcheck.units.none") : null;
    const summary = va.v === "differs" ? say("xcheck.differs", { n: n.differs, m: compared }) : va.v === "agree" ? say("xcheck.agree", { n: compared }) : say("xcheck.nc", { reason: NC_WORDS[va.why] || NC_WORDS.few });
    return { state: "ok", va, rows, stale, v: va.v, n, compared, units, summary };
  }

  function cellText(row) {
    const f = FMT[row.id];
    if (row.v === "nc") return say("xcheck.nc", { reason: NC_WORDS[row.why] || row.why || NC_WORDS.absent });
    return "Engine " + f.v(row.e) + " · Feed " + f.v(row.f) + " · gap " + f.gap(row.gap);
  }

  function strip(m, openDialog) {
    const left = h("div", { class: "ftxc-l" },
      h("p", { class: "ftxc-t" }, COPY["title.xcheck"]),
      h("span", { class: "ftxc-v", "data-v": m.v }, h("i", { "aria-hidden": "true" }, GLYPH[m.v]), WORD[m.v]),
      h("p", { class: "ftxc-s" }, m.summary));
    if (m.stale) left.append(h("p", { class: "ftxc-s", "data-stale": "1" }, say("xcheck.stale", { date: F.day(m.va.session) })));
    if (m.units) left.append(h("p", { class: "ftxc-s" }, m.units));
    const list = h("ul", { class: "ftxc-g", role: "list", "aria-label": COPY["title.xcheck"] });
    for (const id of [...LEFT.flatMap((l, i) => [l, RIGHT[i]])]) {
      const row = m.rows.get(id);
      if (!row) { list.append(h("li", { "data-v": "nc" }, h("b", null, FMT[id].label), h("span", null, DASH))); continue; }
      list.append(h("li", { "data-v": row.v, title: cellText(row) }, h("b", null, FMT[id].label), h("span", null, cellText(row)), h("i", { "aria-label": WORD[row.v] }, GLYPH[row.v])));
    }
    const details = h("button", { type: "button", class: "mk-all ftxc-d", "aria-haspopup": "dialog", onclick: openDialog }, "Details");
    return [left, list, details];
  }

  function dialogBody(m) {
    const va = m.va;
    const strikes = Array.isArray(va.strikes) ? va.strikes : [];
    const strikeTable = strikes.length
      ? h("table", { class: "nm-tbl" },
        h("thead", null, h("tr", null, ["Strike", "Engine delta", "Feed delta", "Engine IV", "Feed IV", "Engine gamma", "Feed gamma"].map((c, i) => h("th", { scope: "col", class: i ? "c-num" : null }, c)))),
        h("tbody", null, strikes.map((r) => h("tr", null,
          h("th", { scope: "row" }, F.strike(r[0])), h("td", { class: "c-num" }, isNum(r[1]) === null ? DASH : F.px(r[1], 3)), h("td", { class: "c-num" }, isNum(r[2]) === null ? DASH : F.px(r[2], 3)),
          h("td", { class: "c-num" }, isNum(r[3]) === null ? DASH : F.pct(r[3], 1)), h("td", { class: "c-num" }, isNum(r[4]) === null ? DASH : F.pct(r[4], 1)),
          h("td", { class: "c-num" }, sig4(r[5])), h("td", { class: "c-num" }, sig4(r[6]))))))
      : h("p", null, say("xcheck.nc", { reason: NC_WORDS.strikes }));
    const tolTable = h("table", { class: "nm-tbl" },
      h("thead", null, h("tr", null, ["Check", "Result", "Tolerance"].map((c, i) => h("th", { scope: "col", class: i === 2 ? "c-num" : null }, c)))),
      h("tbody", null, [...LEFT, ...RIGHT, "chainSelf"].map((id) => {
        const row = m.rows.get(id);
        return h("tr", null, h("th", { scope: "row" }, FMT[id].label + (id === "chainSelf" ? " (feed against feed)" : "")),
          h("td", null, row ? WORD[row.v] + (row.v === "nc" ? ": " + (NC_WORDS[row.why] || row.why || "") : "") : DASH), h("td", { class: "c-num" }, row && isNum(row.tol) !== null ? FMT[id].tol(row.tol) : DASH));
      })));
    return h("div", { class: "nm-dg" },
      h("h3", { id: "ftxcDlgT" }, COPY["title.xcheck"] + " · " + (va.expiry ? va.expiry : DASH) + (isNum(va.dte) !== null ? " · " + va.dte + " days" : "")),
      h("p", null, COPY["xcheck.what"]),
      h("p", null, say("xcheck.convention")),
      m.units ? h("p", null, m.units) : null,
      h("div", { class: "nm-dtw" }, strikeTable),
      h("p", null, COPY["xcheck.self"]),
      h("div", { class: "nm-dtw" }, tolTable),
      h("ul", { class: "ftxc-w", role: "list" }, WITHHELD.map(([k, why]) => h("li", null, h("b", null, k + ": "), why))),
      h("div", { class: "nm-dx" }, h("button", { type: "button", class: "nm-link", id: "ftxcClose" }, "Close")));
  }

  function mount(host, cardX, opts) {
    const prior = MOUNTS.get(host);
    if (prior) prior.destroy();
    const o = opts || {};
    const m = model(cardX);
    const dlg = h("dialog", { class: "nm-dlg ftxc-dlg", "aria-labelledby": "ftxcDlgT" });
    let opener = null;
    const open = (btn) => {
      opener = btn || null;
      if (m.state !== "ok") return;
      dlg.replaceChildren(dialogBody(m));
      const close = dlg.querySelector("#ftxcClose");
      if (close) close.addEventListener("click", () => dlg.close());
      if (typeof dlg.showModal === "function") dlg.showModal();
      if (close) close.focus();
    };
    dlg.addEventListener("close", () => { if (opener && opener.isConnected) opener.focus(); });
    host.hidden = false;
    host.dataset.state = m.state;
    if (m.state !== "ok") {
      host.replaceChildren(h("p", { class: "ftxc-t" }, COPY["title.xcheck"]), h("p", { class: "ftxc-s" }, m.text), dlg);
    } else {
      const [l, g, d] = strip(m, () => open(d));
      host.replaceChildren(l, g, d, dlg);
    }
    let button = null;
    const slot = o.buttonHost || null;
    if (slot) {
      const label = m.state === "ok" ? "Cross-check · " + GLYPH[m.v] + " " + WORD[m.v] : "Cross-check · " + say("xcheck.never").replace(/\.$/, "");
      button = h("button", { type: "button", class: "ft-gbtn ftxc-b", "aria-haspopup": "dialog", disabled: m.state === "ok" ? null : "true", onclick: () => open(button) }, label);
      slot.append(button);
    }
    const api = {
      model: () => m,
      open: () => open(null),
      button: () => button,
      destroy() { if (button) button.remove(); dlg.remove(); host.replaceChildren(); host.hidden = true; MOUNTS.delete(host); },
    };
    MOUNTS.set(host, api);
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, {
    xcheck: Object.freeze({ mount, model, ready, copy: COPY, ncWords: NC_WORDS, of: (el) => MOUNTS.get(el) || null }),
  }));
})();
