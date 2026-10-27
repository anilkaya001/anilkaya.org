(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const { h, F, DASH } = UI;

  const COPY = {
    investor: "Disclosed investor in {n} private companies.",
    none: "Not listed as a disclosed private-markets investor.",
    peers: "Largest private peers in {sector}, by disclosed funding.",
    mark: "The feed's implied per-share price on {date}; not a trade.",
    coverage: "Profiles read for {p} of {l} companies listed in this sector.",
    unmatched: "The feed lists no private companies under this sector name.",
    plan: "Private-markets data needs a feed plan the site does not hold.",
    leaders: "{n} disclosed leaders; names are not shown.",
    pending: "The private-markets read is not published yet.",
    failed: "The private-markets read failed tonight.",
    limited: "The feed limited this read tonight; the last good copy stands.",
  };
  const say = (k, vars) => COPY[k].replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] !== undefined ? vars[name] : m));
  const REFRESH_MS = 60 * 86400 * 1000;
  const MINUS = "−";

  const num = (v) => {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const text = (v) => (typeof v === "string" && v ? v : null);
  const day = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? F.day(d.slice(0, 10)) : null);

  function investorModel(section, now) {
    if (!section || typeof section !== "object" || num(section.at) === null) return { state: "pending", line: say("pending") };
    if (now - section.at > REFRESH_MS) return { state: "pending", line: say("pending") };
    if (!section.match) {
      if (section.why === "plan") return { state: "plan", line: say("plan") };
      if (section.why === "failed") return { state: "failed", line: say("failed") };
      return { state: "none", line: say("none") };
    }
    const n = num(section.match.companyCount);
    const companies = (Array.isArray(section.match.companies) ? section.match.companies : []).slice(0, 8).map((c) => ({ name: text(c && c[1]), sector: text(c && c[2]) })).filter((c) => c.name);
    return { state: "ok", count: n, line: n === null ? say("none") : say("investor", { n: F.int(n) }), companies };
  }

  function rowOf(e) {
    const last = Array.isArray(e[7]) ? e[7] : null;
    return {
      npm: text(e[0]),
      name: text(e[1]),
      funding: num(e[2]),
      investors: num(e[3]),
      price: num(e[4]),
      priceDate: day(e[5]),
      chg1y: num(e[6]),
      round: last ? { date: day(last[0]), name: text(last[1]), amount: num(last[2]) } : null,
      leaders: num(e[8]),
    };
  }

  function peersModel(body, sector) {
    if (!body || typeof body !== "object") return { state: "failed", line: say("failed") };
    if (body.status === "pending" || body.status === "unreadable") return { state: "pending", line: say("pending") };
    const entry = body.entry;
    if (!entry || typeof entry !== "object") return { state: "unmatched", line: say("unmatched") };
    if (entry.status === "plan") return { state: "plan", line: say("plan") };
    if (entry.status === "failed") return { state: "failed", line: say("failed") };
    if (entry.status === "unmatched" || !Array.isArray(entry.top) || !entry.top.length) return { state: "unmatched", line: say("unmatched") };
    const rows = entry.top.map(rowOf).filter((r) => r.name).slice(0, 6);
    if (!rows.length) return { state: "unmatched", line: say("unmatched") };
    return {
      state: "ok",
      title: say("peers", { sector }),
      rows,
      mark: say("mark", { date: "the date shown" }),
      coverage: say("coverage", { p: F.int(num(entry.profiled) || 0), l: F.int(num(entry.listed) || 0) }),
      stale: body.session || null,
    };
  }

  const signed = (v) => (v === null ? DASH : (v >= 0 ? "+" : MINUS) + Math.abs(v * 100).toFixed(1) + "%");
  const cell = (cls, label, ...kids) => h("span", { class: cls, "data-k": label }, ...kids);

  function peerRow(r) {
    const mark = r.price === null ? DASH : F.px(r.price, 2) + (r.priceDate ? " " + r.priceDate : "");
    const round = r.round ? [r.round.name, r.round.date, r.round.amount === null ? null : F.money(r.round.amount)].filter(Boolean).join(" · ") : DASH;
    return h("div", { class: "pl-row", role: "row" },
      cell("pl-n", "Name", h("b", null, r.name)),
      cell("pl-f r", "Funding", r.funding === null ? DASH : F.money(r.funding)),
      cell("pl-i r", "Investors", r.investors === null ? DASH : F.int(r.investors)),
      cell("pl-m r", "Mark", mark),
      cell("pl-c r", "1y", signed(r.chg1y)),
      cell("pl-r", "Last round", round),
      cell("pl-l r", "Leaders", r.leaders === null ? DASH : String(r.leaders)));
  }

  function mount(host, input) {
    const wrap = h("div", { class: "pl" });
    host.replaceChildren(wrap);
    const now = Date.now();
    const inv = investorModel(input && input.pm, now);
    const sector = input && typeof input.sector === "string" ? input.sector : null;

    const left = h("section", { class: "pl-blk", "aria-label": "As an investor" }, h("h3", null, "As an investor"));
    if (inv.state === "ok") {
      left.append(h("p", { class: "pl-big" }, inv.count === null ? DASH : F.int(inv.count)), h("p", { class: "pl-line" }, inv.line));
      if (inv.companies.length) left.append(h("ul", { class: "pl-list" }, ...inv.companies.map((c) => h("li", null, h("b", null, c.name), c.sector ? h("span", { class: "pl-s" }, " " + c.sector) : null))));
    } else left.append(h("p", { class: "pl-line" }, inv.line));

    const right = h("section", { class: "pl-blk", "aria-label": "Private peers" }, h("h3", null, "Private peers"));
    wrap.append(left, right);
    if (!sector) { right.append(h("p", { class: "pl-line" }, say("unmatched"))); return; }
    right.append(h("p", { class: "pl-line" }, "Loading."));
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    fetch("/api/flows/macro?part=pm&sector=" + encodeURIComponent(sector), { credentials: "same-origin", headers: { Accept: "application/json" }, ...(ctl ? { signal: ctl.signal } : {}) })
      .then((r) => (r && r.ok ? r.json() : r && r.status === 400 ? { entry: null } : { status: "failed" }))
      .catch(() => ({ status: "failed" }))
      .then((body) => {
        const m = body && body.status === "failed" ? { state: "failed", line: say("failed") } : peersModel(body, sector);
        right.replaceChildren(h("h3", null, "Private peers"));
        if (m.state !== "ok") { right.append(h("p", { class: "pl-line" }, m.line)); return; }
        right.append(h("p", { class: "pl-line" }, m.title),
          h("div", { class: "pl-tbl", role: "table", "aria-label": m.title }, ...m.rows.map(peerRow)),
          h("p", { class: "pl-note" }, m.mark), h("p", { class: "pl-note" }, m.coverage));
      });
  }

  const holder = document.querySelector('i[data-defer="private"][data-css]');
  const href = holder ? holder.getAttribute("data-css") : null;
  if (href && !document.querySelector('link[href="' + href + '"]')) {
    document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
  }
  window.FlowsUI = Object.freeze(Object.assign({}, UI, { privateLens: Object.freeze({ mount, model: Object.freeze({ investorModel, peersModel, rowOf, say }) }) }));
})();
