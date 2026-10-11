(() => {
  "use strict";

  const UI = window.FlowsUI;
  const statusEl = document.getElementById("mvStatus");
  if (!UI || !statusEl) return;
  const { h, F } = UI;
  const UNIT = "IV-days";
  const LINE = "A ranking, not a test: no error rate measured.";
  const CAPTION = "IV as of the previous close.";
  const APART = "Earnings within 30 days: event not separated.";
  const GRADE = "From 30-day IV; no surface.";
  const EVENT_SESSIONS = 21;
  const BEYOND = 3;
  const TOP = 15;
  const SQRT_YEAR = Math.sqrt(252);
  const host = { up: document.getElementById("mvUp"), down: document.getElementById("mvDown"), apart: document.getElementById("mvApart"), line: document.getElementById("mvLine"), ctx: document.getElementById("mvCtx") };

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ivDays = (chg, iv) => (num(chg) === null || num(iv) === null || !(iv > 0) ? null : chg / (iv / SQRT_YEAR));
  const signed = (m) => { const s = Math.abs(m).toFixed(1); return (m < 0 ? "−" : m > 0 ? "+" : "") + s; };
  const byT = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  const tickerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(String(t).toUpperCase().replace(/[^A-Z0-9.\-]/g, ""));

  const S = { rows: null, day: null, live: null, hold: false, dirty: false, waiting: 0 };

  function uniRows(u) {
    if (!u || u.status !== "ok" || !Array.isArray(u.t) || !u.cols || !u.units) return null;
    const col = (k) => {
      const c = u.cols[k], sc = u.units[k] && num(u.units[k][1]);
      return Array.isArray(c) && sc ? c.map((x) => (num(x) === null ? null : x / sc)) : null;
    };
    const chg = col("chg"), iv = col("iv30p"), ed = col("ed");
    return chg ? u.t.map((t, i) => ({ t, chg: chg[i], iv: iv ? iv[i] : null, ed: ed ? ed[i] : null })) : null;
  }

  function liveRows() {
    const s = UI.rt && UI.rt.feeds && UI.rt.feeds("px") && UI.rt.strips ? UI.rt.strips() : null;
    if (!s || s.status !== "ok" || !Array.isArray(s.fields) || !s.rows || !S.day || !(s.session > S.day)) return null;
    const ci = s.fields.indexOf("chg"), ii = s.fields.indexOf("iv30p");
    if (ci < 0 || ii < 0) return null;
    const ed = new Map((S.rows || []).map((r) => [r.t, r.ed]));
    return { session: s.session, rows: Object.keys(s.rows).map((t) => ({ t, chg: num(s.rows[t][ci]), iv: num(s.rows[t][ii]), ed: ed.has(t) ? ed.get(t) : null })) };
  }

  function moves(rows) {
    const out = [];
    for (const r of rows) {
      const m = ivDays(r.chg, r.iv);
      if (m !== null) out.push({ t: r.t, chg: r.chg, m, event: num(r.ed) !== null && r.ed <= EVENT_SESSIONS });
    }
    return out;
  }

  function atLeast(abs, x) {
    let lo = 0, hi = abs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (abs[mid] >= x) hi = mid; else lo = mid + 1; }
    return abs.length - lo;
  }

  function median(sorted) {
    if (!sorted.length) return null;
    const k = sorted.length >> 1;
    return sorted.length % 2 ? sorted[k] : (sorted[k - 1] + sorted[k]) / 2;
  }

  function list(items, abs, total, empty) {
    if (!items.length) return h("p", { class: "ui-silent", text: empty });
    return h("ol", { class: "ui-list mv-list" }, items.map((x, i) => h("li", { class: "ui-row mv-row" },
      h("span", { class: "mv-rank", text: String(i + 1) }),
      h("a", { class: "mv-t", href: tickerHref(x.t), text: x.t }),
      h("span", { class: "fu-v mv-m", text: signed(x.m) + " " + UNIT }),
      h("span", { class: "mv-c", text: F.pct(x.chg * 100, 1, true) + " on the day" }),
      x.event ? null : h("span", { class: "mv-n", text: atLeast(abs, Math.abs(x.m)) + " of " + total + " names this far out today" }))));
  }

  function paint() {
    const live = S.live;
    const rows = live ? live.rows : S.rows;
    const all = moves(rows || []);
    const clean = all.filter((x) => !x.event);
    const apart = all.filter((x) => x.event);
    const abs = clean.map((x) => Math.abs(x.m)).sort((a, b) => a - b);
    const total = clean.length;
    const up = clean.filter((x) => x.m > 0).sort((a, b) => b.m - a.m || byT(a, b)).slice(0, TOP);
    const down = clean.filter((x) => x.m < 0).sort((a, b) => a.m - b.m || byT(a, b)).slice(0, TOP);
    const ap = apart.slice().sort((a, b) => Math.abs(b.m) - Math.abs(a.m) || byT(a, b)).slice(0, TOP);
    host.line.textContent = LINE + " " + CAPTION;
    const med = median(abs);
    const beyond = abs.filter((x) => x > BEYOND).length;
    const src = live ? "Live roster, session " + live.session : "Nightly, session " + S.day;
    host.ctx.textContent = med === null ? "" : src + ": " + total + " names ranked. Median |m| " + med.toFixed(1) + " " + UNIT + "; " + beyond + " of " + total + " beyond " + BEYOND + ". " + apart.length + " ranked apart.";
    host.up.replaceChildren(list(up, abs, total, "No riser has a prior-close implied volatility to measure against."));
    host.down.replaceChildren(list(down, abs, total, "No faller has a prior-close implied volatility to measure against."));
    host.apart.replaceChildren(
      h("p", { class: "fd-meta", text: APART + " " + GRADE }),
      list(ap, abs, total, "No name with a move reports within 30 days."));
    statusEl.textContent = total ? "Ranked " + total + " names." : "No name could be measured.";
    S.dirty = false;
    document.querySelectorAll(".mv-held").forEach((n) => n.remove());
  }

  function request() {
    if (S.hold) {
      S.dirty = true;
      S.waiting++;
      if (!host.ctx.querySelector(".mv-held")) host.ctx.append(h("span", { class: "mv-held", text: " Order held while you read." }));
      return;
    }
    paint();
  }

  const lists = [host.up, host.down, host.apart];
  const setHold = (on) => { S.hold = on; if (!on && S.dirty) { S.waiting = 0; paint(); } };
  for (const el of lists) {
    el.addEventListener("pointerenter", () => setHold(true));
    el.addEventListener("pointerleave", () => setHold(lists.some((n) => n.matches(":focus-within"))));
    el.addEventListener("focusin", () => setHold(true));
    el.addEventListener("focusout", () => setTimeout(() => setHold(lists.some((n) => n.matches(":hover, :focus-within"))), 0));
  }

  fetch("/api/flows/universe?cols=t,sec,chg,iv30p,ed", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((u) => {
      const rows = uniRows(u);
      if (!rows) {
        statusEl.textContent = "The universe is not published yet, so there is nothing to rank.";
        statusEl.setAttribute("data-empty", "pending");
        host.line.textContent = LINE;
        return;
      }
      S.rows = rows;
      S.day = u.sessionDate || null;
      paint();
      const rt = UI.rt && UI.rt.connect({ topics: ["px"] });
      if (rt) {
        rt.on("px", () => {
          const l = liveRows();
          if (!l && !S.live) return;
          S.live = l;
          request();
        });
      }
    })
    .catch((error) => {
      statusEl.textContent = "The universe could not be loaded. Refresh to try again. (" + error.message + ")";
      statusEl.setAttribute("data-empty", "unreadable");
    });
})();
