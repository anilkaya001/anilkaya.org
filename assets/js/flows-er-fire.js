(() => {
  "use strict";
  const UI = window.FlowsUI;
  if (!UI || UI.ffFeed) return;

  const DASH = "—";
  const COPY = Object.freeze({
    readOnly: "Read-only",
    states: Object.freeze({ ready: "On the feed", plan: "Not on this account's plan", unlisted: "Not listed by the feed", unread: "Not read yet", unstated: "Not stated" }),
    useClosest: "Use closest Flows template",
    limitNone: "limit not stated",
    noFields: "no fields to test",
    off: "The event-risk console is off for this account, so the feed's alert types are not read.",
    failed: "The feed did not answer, so its alert types are not shown.",
    loading: "Reading the feed's alert types.",
    retry: "Retry",
    showAll: "Show all",
    close: "Close",
    foot: "Read-only: these are the feed's own alert types. Nothing here is armed or sent.",
  });
  const VIEWS = Object.freeze({ halts: "Halts", macro: "Macro", fda: "FDA" });
  const STATUS = Object.freeze({ active: "Active", paused: "Paused", rate_limit: "Rate limited" });
  const TEMPLATES = Object.freeze([
    { id: "F01", title: "Trading halt on a name", type: "trading_state", target: "trading_state", fields: ["state", "reason"], closest: null, view: "halts", differs: "Flows has no halt quantity a wire can test; the Halts view shows them." },
    { id: "F02", title: "Earnings report", type: "earnings", target: null, fields: [], closest: "T07", view: null, differs: "The feed alerts on the report itself; T07 tests the implied move against past report moves." },
    { id: "F03", title: "Economic release", type: "economic_release", target: null, fields: [], closest: null, view: "macro", differs: "Flows lists releases on the Macro view; no wire tests them." },
    { id: "F04", title: "FDA date", type: "fda", target: null, fields: [], closest: null, view: "fda", differs: "Flows lists dates on the FDA view; no wire tests them." },
    { id: "F05", title: "Large flagged window", type: "flow_alerts", target: "flow_alert", fields: ["total_premium", "volume_oi_ratio", "dte"], closest: "T03", view: null, differs: "T03 also asks for out of the money by 10 per cent and 21 days or less." },
    { id: "F06", title: "Open-interest change before the open", type: "chain_oi_change", target: "option_contract", fields: ["oi_change"], closest: "T02", view: null, differs: "T02 confirms the opening on the next night's open interest." },
  ]);

  function rows(feed, hasAst) {
    const read = !!feed && typeof feed === "object" && Array.isArray(feed.types) && feed.status !== "unavailable";
    const types = read ? feed.types : [];
    const targets = read && feed.grammar && Array.isArray(feed.grammar.targets) ? feed.grammar.targets : [];
    return TEMPLATES.map((t) => {
      const entry = types.find((x) => x && x.id === t.type) || null;
      let state = "unread";
      if (read) state = !entry ? "unlisted" : entry.can === true ? "ready" : entry.can === false ? "plan" : "unstated";
      let fields = [];
      let fieldsWhy = null;
      if (t.fields.length) {
        const tg = targets.find((x) => x && x.id === t.target);
        const have = tg && Array.isArray(tg.fields) ? new Set(tg.fields.map((f) => (Array.isArray(f) ? f[0] : f))) : null;
        if (have && t.fields.every((f) => have.has(f))) fields = t.fields.slice();
        else { fields = null; fieldsWhy = "not in the feed's grammar"; }
      }
      const closest = t.closest && hasAst(t.closest) ? t.closest : null;
      return {
        id: t.id, title: t.title, type: t.type, state,
        perDay: entry && Number.isSafeInteger(entry.perDay) ? entry.perDay : null,
        fields, fieldsWhy, closest, view: t.view, differs: t.differs,
      };
    });
  }

  function meta(r) {
    const day = r.perDay === null ? DASH + " " + COPY.limitNone : "up to " + r.perDay + " a day";
    const fields = r.fields === null ? DASH + " fields " + r.fieldsWhy : r.fields.length ? r.fields.join(", ") : COPY.noFields;
    return day + " · " + fields;
  }

  function ownerLine(owner) {
    if (!owner || typeof owner !== "object") return null;
    const n = Array.isArray(owner.configs) ? owner.configs.length : null;
    let fired = null;
    if (owner.fired && typeof owner.fired === "object") {
      fired = 0;
      for (const v of Object.values(owner.fired)) if (Number.isSafeInteger(v) && v >= 0) fired += v;
    }
    const defs = n === null ? DASH + " alert definitions not read" : n + (n === 1 ? " alert definition" : " alert definitions");
    const hits = fired === null ? DASH + " firings not read" : fired + " fired in 14 days";
    return { text: "Your feed account: " + defs + ", " + hits, configs: Array.isArray(owner.configs) ? owner.configs : null };
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };

  function configsDialog(configs) {
    const dlg = el("dialog", "ffx-dlg");
    dlg.id = "ffxFeedCfg";
    dlg.setAttribute("aria-labelledby", "ffxFeedCfgT");
    const box = el("div", "ffx-dg");
    const h = el("h2", null, "Your feed account's alert definitions");
    h.id = "ffxFeedCfgT";
    box.append(h);
    const table = el("table", "ffx-cfg");
    const head = el("tr");
    ["Label", "Type", "Status", "Keys"].forEach((c) => { const th = el("th", null, c); th.scope = "col"; head.append(th); });
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    configs.forEach((c) => {
      const tr = el("tr");
      tr.append(
        el("td", null, c && c.label ? c.label : DASH + " no label"),
        el("td", null, c && c.type ? String(c.type).replace(/_/g, " ") : DASH),
        el("td", null, c && STATUS[c.status] ? STATUS[c.status] : DASH + " status not stated"),
        el("td", null, c && Array.isArray(c.keys) && c.keys.length ? c.keys.join(", ") : DASH + " none"),
      );
      tbody.append(tr);
    });
    table.append(thead, tbody);
    box.append(table);
    const foot = el("div", "ffx-dx");
    const close = el("button", "ffx-link", COPY.close);
    close.type = "button";
    close.addEventListener("click", () => dlg.close());
    foot.append(close);
    box.append(foot);
    dlg.append(box);
    dlg.addEventListener("close", () => dlg.remove());
    (document.querySelector(".flows-main") || document.body).append(dlg);
    dlg.showModal();
  }

  function rowEl(r, onClosest) {
    const li = el("li", "ffx-fli");
    li.setAttribute("data-feed", r.id);
    const t = el("span", "ffx-fli-t", r.title);
    t.title = r.title;
    const chip = el("span", "ffx-chip ffx-fli-s", COPY.states[r.state]);
    chip.setAttribute("data-state", r.state);
    const d = el("span", "ffx-fli-d", r.differs);
    d.title = r.differs;
    const ro = el("span", "ffx-chip ffx-fli-r", COPY.readOnly);
    const mt = el("span", "ffx-fli-mt", meta(r));
    mt.title = mt.textContent;
    if (r.perDay === null || r.fields === null) mt.setAttribute("data-ff-absent", r.fields === null ? "grammar" : "limit");
    const head = el("span", "ffx-fli-h");
    head.append(t, chip);
    chip.title = chip.textContent;
    li.append(head, d, ro, mt);
    if (r.closest) {
      const b = el("button", "ffx-link", COPY.useClosest);
      b.type = "button";
      b.title = COPY.useClosest + " (" + r.closest + ")";
      b.setAttribute("aria-label", COPY.useClosest + ", " + r.closest + ", for " + r.title);
      b.setAttribute("data-closest", r.closest);
      b.addEventListener("click", () => onClosest(r.closest));
      li.append(b);
    } else if (r.view) {
      const a = el("a", "ffx-link", "Open the " + VIEWS[r.view] + " view");
      a.href = "/flows/events/#view=" + r.view;
      a.title = a.textContent;
      li.append(a);
    }
    return li;
  }

  function registryAst() {
    const node = document.getElementById("ffxData");
    let reg = null;
    try { reg = node ? JSON.parse(node.textContent) : null; } catch { reg = null; }
    const ids = new Set(reg && Array.isArray(reg.templates) ? reg.templates.filter((t) => t && t.ast).map((t) => t.id) : []);
    return (id) => ids.has(id);
  }

  function mount(o) {
    const list = o.list;
    const foot = o.foot;
    const say = typeof o.say === "function" ? o.say : () => {};
    const hasAst = registryAst();
    const shown = typeof o.shown === "function" ? o.shown : () => true;
    const note = (text, retry) => {
      const li = el("li", "ffx-fli-w", text);
      if (retry) {
        const b = el("button", "ffx-link", COPY.retry);
        b.type = "button";
        b.addEventListener("click", load);
        li.append(" ", b);
      }
      list.replaceChildren(li);
      if (foot) { foot.textContent = ""; foot.hidden = true; }
    };
    function paint(body) {
      const feed = body && typeof body === "object" ? body.feed : undefined;
      list.replaceChildren(...rows(feed, hasAst).map((r) => rowEl(r, o.onClosest)));
      if (!foot) return;
      const who = ownerLine(feed && feed.owner);
      foot.replaceChildren();
      if (who) {
        foot.append(who.text);
        if (who.configs && who.configs.length) {
          const b = el("button", "ffx-foot-b", COPY.showAll);
          b.type = "button";
          b.setAttribute("aria-haspopup", "dialog");
          b.addEventListener("click", () => configsDialog(who.configs));
          foot.append(b);
        }
      } else foot.textContent = COPY.foot;
      foot.hidden = !shown();
      say("The feed's alert types are listed. They are read-only.");
    }
    function load() {
      note(COPY.loading, false);
      fetch("/api/flows/eventrisk", { credentials: "same-origin", headers: { Accept: "application/json" } }).then((res) =>
        res.json().catch(() => null).then((data) => {
          if (res.status === 404 && data && data.error && data.error.code === "eventrisk_off") return note(COPY.off, false);
          if (!res.ok) return note(COPY.failed, true);
          paint(data);
        }), () => note(COPY.failed, true));
    }
    load();
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffFeed: Object.freeze({ mount, rows, meta, ownerLine, COPY, TEMPLATES }) }));
})();
