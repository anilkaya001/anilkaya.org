(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const host = $("pwHost");
  const statusEl = $("pwStatus");
  const countEl = $("pwCount");
  if (!host) return;
  const OWNER = "now-popout";
  const DASH = "\u2014";
  const SIDE = { call: "Call", put: "Put" };
  const LEAN = { bullish: "Bullish", bearish: "Bearish", unsided: "Unsided" };
  const HEAD = [["Ticker", "pw-c-t", ""], ["Side", "pw-c-s", ""], ["Strike", "pw-c-k pw-num", ""], ["Expiry", "pw-c-e", ""], ["Premium", "pw-c-p pw-num", ""], ["Lean", "pw-c-l", ""], ["TRT", "pw-c-m pw-num", "Start of the window, Turkey time (TRT)"]];
  const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const YEAR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", year: "numeric" });
  const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" });
  const STRIKE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const say = (text) => { if (statusEl) statusEl.textContent = text; };
  const why = (error) => (error && error.message ? error.message : "no message");
  const real = (x) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);
  const tail = (m) => "+" + m + " more, smaller by premium";

  let view = null;
  let fitH = -1;
  let want = null;

  function count(text, title) {
    if (!countEl) return;
    countEl.textContent = text;
    if (title) countEl.title = title;
    else countEl.removeAttribute("title");
  }

  function note(state, word, text) {
    view = null;
    fitH = -1;
    const p = document.createElement("p");
    p.className = "pw-empty";
    p.setAttribute("data-empty", state);
    p.textContent = word + ": " + text;
    host.replaceChildren(p);
    count(DASH, word + ": " + text);
    say(word + ": " + text);
  }

  function stamp(x) {
    const n = real(x);
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    if (typeof x === "string") {
      const p = Date.parse(x);
      if (Number.isFinite(p)) return p;
    }
    return null;
  }

  function expiry(x) {
    const m = typeof x === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(x) : null;
    const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : stamp(x);
    if (ms === null || !Number.isFinite(ms)) return null;
    const d = new Date(ms);
    const y = String(d.getUTCFullYear());
    return y === YEAR.format(Date.now()) ? DAY.format(d) : DAY.format(d) + " " + y.slice(2);
  }

  const moneyDp = (n, i) => [0, 0, 1, 1, 1][i];

  function money(v) {
    return window.FlowsUI.F.scaled(v, moneyDp, "$");
  }

  function sideOf(cp) {
    const s = typeof cp === "string" ? cp.trim().toUpperCase() : "";
    return s.startsWith("C") ? "call" : s.startsWith("P") ? "put" : null;
  }

  function leanOf(r, side) {
    if (!side) return { key: null, why: "The window carries no call or put, so it has no lean." };
    const x = window.FlowsUI.F.askShare([r]);
    if (x.share === null) return { key: null, why: "The window carries no premium split into ask and bid, so it has no lean." };
    if (x.side !== "ask" && x.side !== "bid") return { key: "unsided", why: "" };
    return { key: (side === "call") === (x.side === "ask") ? "bullish" : "bearish", why: "" };
  }

  function shape(rows) {
    const list = [];
    rows.forEach((r, i) => {
      if (!r || typeof r !== "object") return;
      const p = real(r.prem);
      list.push({ r, i, p: Number.isFinite(p) && p > 0 ? p : null });
    });
    list.sort((x, y) => {
      if (x.p === y.p) return x.i - y.i;
      if (x.p === null) return 1;
      if (y.p === null) return -1;
      return y.p - x.p;
    });
    return list.map(({ r, p }) => {
      const side = sideOf(r.cp);
      const k = real(r.k);
      return {
        t: typeof r.t === "string" && r.t.trim() ? r.t.trim() : null,
        side,
        k: Number.isFinite(k) && k > 0 ? k : null,
        exp: expiry(r.exp),
        prem: p,
        lean: leanOf(r, side),
        at: stamp(r.spanStart),
        key: [r.t, r.cp, r.k, r.exp, r.spanStart].join("|"),
      };
    });
  }

  function td(tr, text, cls, title) {
    const c = document.createElement("td");
    if (cls) c.className = cls;
    c.textContent = text;
    if (title) c.title = title;
    tr.appendChild(c);
    return c;
  }

  function rowEl(w) {
    const tr = document.createElement("tr");
    tr.dataset.key = w.key;
    const first = document.createElement("td");
    first.className = "pw-tk";
    if (w.t) {
      tr.dataset.t = w.t;
      tr.tabIndex = 0;
      const a = document.createElement("a");
      a.href = "/flows/ticker/?t=" + encodeURIComponent(w.t);
      a.textContent = w.t;
      first.appendChild(a);
    } else {
      first.textContent = DASH;
      first.title = "The window carries no ticker.";
    }
    tr.appendChild(first);
    td(tr, w.side ? SIDE[w.side] : DASH, "", w.side ? "" : "The window carries no call or put.");
    td(tr, w.k === null ? DASH : STRIKE.format(w.k), "pw-num", w.k === null ? "The window carries no strike." : "");
    td(tr, w.exp === null ? DASH : w.exp, "", w.exp === null ? "The window carries no expiry." : "");
    td(tr, w.prem === null ? DASH : money(w.prem), "pw-num", w.prem === null ? "The window carries no premium." : "");
    td(tr, w.lean.key ? LEAN[w.lean.key] : DASH, w.lean.key ? "pw-lean is-" + w.lean.key : "pw-lean", w.lean.key ? "" : w.lean.why);
    td(tr, w.at === null ? DASH : CLOCK.format(w.at), "pw-num", w.at === null ? "The window carries no start time." : "");
    return tr;
  }

  function frame() {
    const table = document.createElement("table");
    table.className = "pw-table";
    table.setAttribute("aria-labelledby", "pwListT");
    const hr = table.createTHead().insertRow();
    for (const [text, cls, title] of HEAD) {
      const th = document.createElement("th");
      th.scope = "col";
      th.className = cls;
      th.textContent = text;
      if (title) th.title = title;
      hr.appendChild(th);
    }
    return { table, body: table.createTBody() };
  }

  function mark() {
    let seen = 0;
    for (const tr of host.querySelectorAll("tbody tr")) {
      const on = want !== null && tr.dataset.t === want;
      tr.classList.toggle("is-sel", on);
      if (on) {
        tr.setAttribute("aria-current", "true");
        seen += 1;
      } else {
        tr.removeAttribute("aria-current");
      }
    }
    return seen;
  }

  function paint(force) {
    if (!view || !view.length) return 0;
    const H = host.clientHeight;
    if (!force && H === fitH) return 0;
    fitH = H;
    const active = document.activeElement;
    const was = active && host.contains(active) && typeof active.closest === "function" ? active.closest("tr") : null;
    const keep = was ? was.dataset.key : null;
    const total = view.length;
    const { table, body } = frame();
    const more = document.createElement("p");
    more.className = "pw-more";
    more.textContent = tail(total);
    host.replaceChildren(table, more);
    body.appendChild(rowEl(view[0]));
    const top = host.getBoundingClientRect().top;
    const headH = table.tHead.getBoundingClientRect().height;
    const rowH = body.rows[0].getBoundingClientRect().height || 1;
    const moreH = more.getBoundingClientRect().height;
    let n = headH + rowH * total <= H ? total : Math.max(0, Math.floor((H - headH - moreH - 1) / rowH));
    if (!n) body.replaceChildren();
    for (let i = 1; i < n; i++) body.appendChild(rowEl(view[i]));
    if (n === total && table.getBoundingClientRect().bottom - top <= H + 0.5) {
      more.remove();
    } else {
      while (n > 0 && more.getBoundingClientRect().bottom - top > H + 0.5) {
        body.deleteRow(-1);
        n -= 1;
      }
      more.textContent = tail(total - n);
    }
    count(n === total ? total + (total === 1 ? " window" : " windows") : n + " of " + total + " shown", "");
    if (keep) {
      const back = [...body.rows].find((tr) => tr.dataset.key === keep);
      if (back) back.focus({ preventScroll: true });
    }
    return mark();
  }

  function take(a, st) {
    if (!st || st.state !== "ok" || !a || !Array.isArray(a.rows)) {
      if (st && st.state === "pending") note("pending", "Pending", st.reason);
      else note("unavailable", "Unavailable", st && st.reason ? st.reason : "the flagged windows could not be read.");
      return;
    }
    const next = shape(a.rows);
    if (!next.length) {
      note("empty", "Nothing flagged", "no option window was flagged in this read: a quiet market, not a failure.");
      return;
    }
    view = next;
    paint(true);
    say(next.length + (next.length === 1 ? " flagged window" : " flagged windows") + " read at " + CLOCK.format(Date.now()) + " TRT, largest premium first.");
  }

  note("pending", "Reading", "the flagged windows are loading.");

  const UI = window.FlowsUI;
  const L = UI && UI.link;
  const linked = Boolean(L && typeof L.join === "function" && typeof L.emit === "function");

  if (linked) {
    L.join(OWNER, {
      kinds: ["ticker"],
      on(s) {
        if (!s || s.kind !== "ticker" || typeof s.value !== "string" || !s.value) return;
        want = s.value;
        const seen = mark();
        say(want + (seen ? " selected: " + seen + (seen === 1 ? " window" : " windows") + " in view." : " selected: none of its windows are in the rows shown."));
      },
    });
  }

  function pick(tr) {
    const value = tr.dataset.t;
    if (!value || value === want) return;
    want = value;
    mark();
    if (linked) L.emit(OWNER, { kind: "ticker", value, source: "now" });
  }

  host.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!t || typeof t.closest !== "function" || t.closest("a")) return;
    const tr = t.closest("tr[data-t]");
    if (tr) pick(tr);
  });
  host.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const tr = ev.target;
    if (!tr || typeof tr.matches !== "function" || !tr.matches("tr[data-t]")) return;
    ev.preventDefault();
    pick(tr);
  });

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
        if (a.status === "pending") ALERTS.emit(null, { state: "pending", reason: "the pipeline has not published the flagged windows yet." });
        else if (!Array.isArray(a.rows)) ALERTS.emit(null, { state: "unavailable", reason: "the payload carries no rows array: a gap in the payload, not a quiet market." });
        else ALERTS.emit(a, { state: "ok" });
      }).catch((error) => ALERTS.emit(null, { state: "unavailable", reason: "the flagged windows could not be loaded (" + why(error) + ")." }));
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

  const rt = UI && UI.rt && typeof UI.rt.connect === "function" ? UI.rt.connect({ topics: ["fl"] }) : null;
  if (rt && typeof rt.on === "function") rt.on("fl", () => ALERTS.soon());
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ALERTS.timer) ALERTS.pull(); });
  if (typeof ResizeObserver === "function") new ResizeObserver(() => paint(false)).observe(host);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => paint(true));
  ALERTS.sub(take);
})();

