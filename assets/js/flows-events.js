(() => {
  "use strict";

  const UI = window.FlowsUI;
  const statusEl = document.getElementById("evStatus");
  if (!UI || !statusEl) return;
  const { h, F } = UI;
  const DASH = UI.DASH, MID = UI.MID;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const V = { class: "fu-v" }, HIDE = { "aria-hidden": "true" };

  const host = {
    meta: document.getElementById("evMeta"),
    about: document.getElementById("evAboutSlot"),
    chips: document.getElementById("evChips"),
    week: document.getElementById("evWeek"),
    earn: document.getElementById("evEarn"),
    macro: document.getElementById("evMacro"),
    fda: document.getElementById("evFda"),
    react: document.getElementById("evReact"),
  };

  const n = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string" && !v.trim()) return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const plural = (k, one, many) => (k === 1 ? one : many);
  const count = (v) => (n(v) === null ? DASH : Math.round(n(v)).toLocaleString("en-US"));
  const withList = (el) => { (el.classList.contains("ui-list") ? [el] : [...el.querySelectorAll(".ui-list")]).forEach((l) => l.classList.add("fu-list")); return el; };
  const days = (k) => k + " calendar " + plural(k, "day", "days");
  const sessions = (k) => k + " " + plural(k, "session", "sessions");
  const pct = (v, dp = 1) => (n(v) === null ? DASH : F.pct(n(v), dp));
  const move = (v) => (n(v) === null ? DASH : "±" + F.pct(Math.abs(n(v)), 1));
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayMs = (d) => Date.parse(String(d) + "T00:00:00Z");
  const addDays = (d, k) => new Date(dayMs(d) + k * 864e5).toISOString().slice(0, 10);
  const weekday = (d) => WD[new Date(dayMs(d)).getUTCDay()];
  const ET_T = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const etTime = (iso) => { const t = Date.parse(String(iso || "")); return Number.isFinite(t) ? ET_T.format(new Date(t)).replace(/:00(?= )/, "") : null; };
  const cardKey = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  const tickerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(cardKey(t));
  const originClash = (r) => { const d = n(r && r.dte), sd = n(r && r.sdte); return d !== null && sd !== null && sd > d; };
  const TAGS = { fomc: ["FOMC", "--s-purple"], cpi: ["CPI", "--s-orange"], ppi: ["PPI", "--s-yellow"], nfp: ["Jobs", "--s-teal"], pce: ["PCE", "--s-orange"], gdp: ["GDP", "--s-blue"], claims: ["Claims", "--s-teal"] };

  const STAGE = {
    gated: { lane: "gated", word: "Gated", what: "The board was FORBIDDEN from scoring this name: it reports inside the gate window, so there is no score under it, not a low one." },
    "board:long": { lane: "long", word: "Long", what: "Passed the gate, was scored, and published on the long side of the board." },
    "board:short": { lane: "short", word: "Short", what: "Passed the gate, was scored, and published on the short side of the board." },
    liquid: { lane: "open", word: "Liquid", what: "Passed the gate and cleared the liquidity screen, but did not reach the board." },
    enriched: { lane: "open", word: "Enriched", what: "Passed the gate and was enriched with per-name data, but did not reach the board." },
    eligible: { lane: "open", word: "Eligible", what: "Passed the earnings gate and was eligible for scoring, but did not reach the board." },
    screened: { lane: "open", word: "Screened", what: "Returned by the screener and no further. It was not gated out." },
  };
  const stageOf = (st) => STAGE[String(st || "")] || { lane: "open", word: st ? String(st) : "Unclassified", what: st ? "A funnel stage this page has no description for, shown as the payload sent it." : "The payload carried no funnel stage for this name." };
  const stageGlyph = (st) => {
    const lane = stageOf(st).lane;
    if (lane === "long") return UI.glyph("up", "fe-st is-long");
    if (lane === "short") return UI.glyph("down", "fe-st is-short");
    if (lane === "gated") return UI.glyph("shield", "fe-st is-gated");
    return null;
  };

  const S = { payload: null, cx: new Map(), asked: false, staleDays: null };

  const setModuleState = (hostEl, st, label) => {
    const card = hostEl && hostEl.closest(".fd-mod");
    if (!card) return;
    card.dataset.state = st.state;
    const t = card.querySelector(".ui-mod-t");
    const old = t.querySelector(".ui-state");
    if (old) old.remove();
    const b = UI.stateButton(st, label);
    if (b) t.append(b);
  };
  const setModuleInfo = (hostEl, label, build) => {
    const card = hostEl && hostEl.closest(".fd-mod");
    if (!card) return;
    const head = card.querySelector(".ui-mod-h");
    const old = head.querySelector(":scope > .ui-info");
    if (old) old.remove();
    head.append(UI.infoButton(label, build));
  };
  const silence = (hostEl, st, label, height) => {
    hostEl.replaceChildren(UI.silent(st, label, height));
    setModuleState(hostEl, st, label);
  };
  const def = (st) => UI.STATES[st.state] || UI.STATES.unavailable;
  const mark = (st) => h("span", { class: "ui-dash" }, DASH, h("span", { class: "ui-state", "data-state": st.state, title: def(st).word }, UI.glyph(def(st).g)));
  const muted = (st) => UI.iconChip(def(st).g, "--label-3");
  const blockState = (b, what) => {
    if (b === undefined || b === null) return { state: "pending", reason: "The " + what + " is not on this payload yet. It is published by the nightly run that ships with this page; until then it is pending, not empty." };
    if (typeof b !== "object") return { state: "withheld", reason: "The " + what + " on this payload could not be read." };
    if (b.status === "ok" || b.status === "thin") return { state: "ok" };
    if (b.status === "quiet") return { state: "quiet", reason: "Read, and the vendor returned nothing that applies." };
    return { state: "unavailable", reason: "The " + what + " was not measured" + (b.reason ? " (" + String(b.reason).replace(/_/g, " ") + (n(b.http) ? ", HTTP " + b.http : "") + ")" : "") + "." };
  };

  function pricedText(r) {
    if (n(r.ev) !== null) return F.pct(n(r.ev), 2) + " priced over " + sessions(n(r.sdte) ?? 0);
    if (n(r.sdte) === 0) return "0s: no sessions left to price, a horizon of zero rather than a zero move";
    if (n(r.iv) === null) return "not measured for this name: no 30-day implied volatility arrived";
    return "not published for this row, and not zero";
  }

  function calIndex(payload) {
    const out = new Map();
    const cal = payload.earningsCalendar;
    if (!cal || typeof cal !== "object") return out;
    const add = (r, d) => { if (r && r.t && !out.has(r.t)) out.set(r.t, { ...r, d: r.d || d }); };
    if (cal.tonight && Array.isArray(cal.tonight.rows)) for (const r of cal.tonight.rows) add(r, payload.sessionDate);
    for (const s of Array.isArray(cal.sessions) ? cal.sessions : []) {
      for (const part of [s.premarket, s.afterhours]) if (part && Array.isArray(part.rows)) for (const r of part.rows) add(r, s.date);
    }
    return out;
  }

  const impliedOf = (r, cal) => {
    const cx = S.cx.get(r.t);
    const e = cx && cx.earnings && cx.earnings.impliedNext ? n(cx.earnings.impliedNext.em) : null;
    const c = cal ? n(cal.em) : null;
    if (c !== null) return { v: Math.abs(c), src: "the vendor's expected earnings move" };
    if (e !== null) return { v: Math.abs(e), src: "the vendor's expected earnings move" };
    if (n(r.im) !== null) return { v: Math.abs(n(r.im)), src: "the vendor's implied move to its next expiry" };
    return null;
  };

  function realizedOf(t, payload) {
    const hist = payload.history && typeof payload.history === "object" ? payload.history : null;
    const digest = hist ? hist[t] : null;
    const got = S.cx.get(t);
    if (got && got.st) return got;
    if (!hist) return { st: { state: "pending", reason: "The earnings history is not on this payload yet; it ships with the next nightly run." } };
    if (!digest) return { st: { state: "unavailable", reason: "This name is outside the history window: only names reporting within ten sessions carry their past reports." } };
    if (digest.status === "thin") return { st: { state: "quiet", reason: "Fewer reports than the statistic needs (" + (n(digest.n) ?? 0) + ")." }, digest };
    if (digest.status !== "ok") return { st: blockState(digest, "earnings history"), digest };
    return { st: { state: "pending", reason: "Reading this name's past reports." }, digest };
  }

  function sessionDays(payload) {
    const cal = payload.earningsCalendar;
    if (cal && Array.isArray(cal.sessions) && cal.sessions.length) return cal.sessions.map((s) => s.date).filter((d) => ISO.test(String(d))).slice(0, 5);
    const out = [];
    let d = ISO.test(String(payload.gateOrigin || "")) ? payload.gateOrigin : null;
    if (!d) return out;
    while (out.length < 5) {
      const wd = new Date(dayMs(d)).getUTCDay();
      if (wd !== 0 && wd !== 6) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  const raw = (v) => (v ? String(v).replace(/^-/, UI.MINUS) : DASH);
  const key = (...kids) => h("span", { class: "ui-key" }, ...kids);
  const tally = (g, word, v) => key(g, word + " ", h("b", null, String(v)));

  function paintWeek(payload) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const cal = calIndex(payload);
    const list = sessionDays(payload);
    if (!list.length) {
      silence(host.week, { state: "unavailable", reason: "This payload carried no gate origin and no session list, so the week has no day zero to be drawn from." }, "Week ahead", 220);
      return;
    }
    const macroSt = blockState(payload.macro, "economic calendar");
    const fdaSt = blockState(payload.fda, "FDA calendar");
    const catRows = payload.catalysts && Array.isArray(payload.catalysts.rows) ? payload.catalysts.rows : [];
    const divRows = catRows.filter((c) => /div/i.test(String(c && c.type)));
    const divSt = divRows.length ? { state: "ok" } : null;
    const drawn = rows.filter((r) => r && list.includes(r.d));
    const earnSt = drawn.length ? { state: "ok" } : { state: "quiet", reason: "No name reports in the next five sessions." };
    const maxEm = Math.max(0.01, ...drawn.map((r) => { const i = impliedOf(r, cal.get(r.t)); return i ? i.v : 0; }));
    const grid = h("div", { class: "fe-week", style: { "--days": String(list.length), "--rows": divSt ? "5" : "4" } });
    const laneHead = (name, st) => h("div", { class: "fe-lane" }, h("span", null, name), st && st.state !== "ok" ? UI.stateButton(st, name) : null);
    grid.append(h("div", { class: "fe-col fe-labels" },
      h("div", { class: "fe-dh" }), laneHead("Macro", macroSt), laneHead("Earnings", earnSt), laneHead("FDA", fdaSt), divSt ? laneHead("Ex-div", divSt) : null));
    const today = payload.gateOrigin;
    const now = UI.freshness.market().today;
    list.forEach((d, k) => {
      const col = h("section", { class: "fe-col", "aria-label": weekday(d) + " " + F.day(d) });
      col.append(h("div", { class: "fe-dh" }, h("b", null, weekday(d)), h("span", null, F.day(d)), d === today ? h("i", { class: "fe-next" }, d === now ? "Today" : "Next") : null));
      const mac = macroSt.state === "ok" ? (payload.macro.rows || []).filter((m) => m && m.day === d).sort((a, b) => String(a.at).localeCompare(String(b.at))) : [];
      col.append(h("div", { class: "fe-cell fe-c-macro", "data-lane": "Macro" }, mac.map(macroPill)));
      const earn = rows.filter((r) => r && r.d === d).map((r) => ({ r, c: cal.get(r.t) || null }))
        .sort((a, b) => laneRank(a.r) - laneRank(b.r) || (n(b.c && b.c.mcap) ?? -1) - (n(a.c && a.c.mcap) ?? -1) || String(a.r.t).localeCompare(String(b.r.t)));
      const cell = h("div", { class: "fe-cell fe-c-earn", "data-lane": "Earnings" });
      const cap = 6;
      earn.forEach((x, i) => { const chip = earnChip(x.r, x.c, maxEm, i + k * 6); if (i >= cap) chip.hidden = true; cell.append(chip); });
      if (earn.length > cap) {
        const more = h("button", { class: "fe-more", type: "button", "aria-expanded": "false" }, "+" + (earn.length - cap));
        more.addEventListener("click", () => {
          const open = more.getAttribute("aria-expanded") !== "true";
          more.setAttribute("aria-expanded", String(open));
          [...cell.querySelectorAll(".fe-chip")].forEach((c, i) => { if (i >= cap) c.hidden = !open; });
          more.textContent = open ? "Fewer" : "+" + (earn.length - cap);
        });
        cell.append(more);
      }
      col.append(cell);
      const fd = fdaSt.state === "ok" ? (payload.fda.rows || []).filter((f) => f && f.tgt && f.tgt.p === "day" && f.tgt.from === d) : [];
      col.append(h("div", { class: "fe-cell fe-c-fda", "data-lane": "FDA" }, fd.map(fdaPill)));
      if (divSt) col.append(h("div", { class: "fe-cell fe-c-div", "data-lane": "Ex-div" }, divRows.filter((c) => c.date === d).map((c) => h("a", { class: "fe-pill", href: tickerHref(c.t) }, h("b", null, String(c.t || DASH))))));
      grid.append(col);
    });
    const counts = { long: 0, short: 0, gated: 0, open: 0 };
    const whens = new Set();
    for (const r of drawn) { counts[stageOf(r.st).lane]++; const c = cal.get(r.t); if (c) whens.add(c.when); }
    const legend = UI.legend([
      counts.long ? tally(UI.glyph("up", "fe-st is-long"), "Long", counts.long) : null,
      counts.short ? tally(UI.glyph("down", "fe-st is-short"), "Short", counts.short) : null,
      counts.gated ? tally(UI.glyph("shield", "fe-st is-gated"), "Gated", counts.gated) : null,
      counts.open ? tally(null, "Open", counts.open) : null,
      drawn.length ? key(h("i", { class: "fe-key-em" }), "Implied move") : null,
      whens.has("premarket") ? key(h("i", { class: "fe-when is-am" }), "Before the open") : null,
      whens.has("postmarket") ? key(UI.glyph("closed", "fe-when"), "After the close") : null,
    ].filter(Boolean));
    legend.classList.add("fe-legend");
    host.week.replaceChildren(grid, legend);
    setModuleState(host.week, UI.partial([{ name: "Macro", st: macroSt }, { name: "Earnings", st: earnSt }, { name: "FDA", st: fdaSt }, ...(divSt ? [{ name: "Ex-dividends", st: divSt }] : [])]), "Week ahead");
  }

  const laneRank = (r) => ({ long: 0, short: 0, open: 1, gated: 2 })[stageOf(r.st).lane];

  function earnChip(r, c, maxEm, i) {
    const imp = impliedOf(r, c);
    const when = c && c.when;
    const st = stageOf(r.st);
    const chip = h("a", {
      class: "fe-chip", href: tickerHref(r.t), "data-lane": st.lane,
      title: String(r.t) + " " + MID + " reports " + (r.d || DASH) + (when && when !== "unknown" ? " " + (when === "premarket" ? "before the open" : "after the close") : "") +
        " " + MID + " implied " + (imp ? move(imp.v) + " (" + imp.src + ")" : "not measured") + " " + MID + " priced " + pricedText(r) + " " + MID + " " + st.word + ": " + st.what,
    },
    h("span", { class: "fe-chip-t" }, stageGlyph(r.st), h("b", null, String(r.t || DASH)),
      when === "premarket" ? h("i", { class: "fe-when is-am", "aria-label": "Before the open" }) : when === "postmarket" ? UI.glyph("closed", "fe-when") : null),
    h("span", { class: "fe-chip-v" }, imp ? move(imp.v) : DASH),
    h("i", { class: "fe-chip-bar", style: { width: imp ? Math.max(4, (imp.v / maxEm) * 100).toFixed(1) + "%" : "0%", "--i": String(i) } }));
    return chip;
  }

  function macroPill(m) {
    const tag = TAGS[m.tag] || null;
    const name = tag ? tag[0] : String(m.event || DASH).replace(/\s*\((MoM|YoY|QoQ)\)/, "");
    return h("button", {
      class: "fe-pill fe-macro" + (tag ? " is-tag" : ""), type: "button", "data-tag": m.tag || null,
      "aria-haspopup": "dialog", "aria-controls": "fxPop",
      "data-info": UI.info(() => ({
        title: String(m.event || "Economic print"), asOf: m.day || null,
        facts: [["Time", etTime(m.at) ? etTime(m.at) + " ET" : null], ["Forecast", m.forecastRaw ? raw(m.forecastRaw) : null], ["Prior", m.prevRaw ? raw(m.prevRaw) : null], ["Period", m.period || null], ["Sessions out", n(m.sd) === null ? null : String(m.sd)]],
      })),
    }, h("i", { class: "fe-dot", style: { "--c": UI.cssVar(tag ? tag[1] : "--label-3") } }), h("span", { class: "fe-time" }, etTime(m.at) || ""), h("b", null, name));
  }

  const FDA_CAT = (c) => (/pdufa/i.test(c) ? "PDUFA" : /advisory/i.test(c) ? "AdCom" : /data|top-?line/i.test(c) ? "Data" : String(c || "Date").split(" ")[0]);
  function fdaPill(f) {
    return h(f.carded ? "a" : "span", { class: "fe-pill fe-fda", href: f.carded ? tickerHref(f.t) : null, title: String(f.t) + " " + MID + " " + String(f.cat || "") + " " + MID + " " + String(f.st || "") },
      UI.glyph("flask"), h("b", null, String(f.t || DASH)), h("span", null, FDA_CAT(f.cat)));
  }

  function weekInfo() {
    const payload = S.payload || {};
    const notes = payload.notes && typeof payload.notes === "object" ? payload.notes : {};
    const clashes = (payload.rows || []).filter((r) => r && originClash(r)).length;
    return {
      title: "Week ahead",
      asOf: payload.gateOrigin || null,
      lead: "The next five sessions: economic prints, earnings and FDA dates, day by day. Each name is a link to its page; the bar under it is its implied move against the largest this week, so the names that can move the most stand out.",
      facts: [
        ["Day zero", payload.gateOrigin ? payload.gateOrigin + ", the run's own Eastern date" : null],
        ["Prices", payload.sessionDate ? "closes of " + payload.sessionDate : null],
        ["Gate", n(payload.gateDays) === null ? null : "day 0 to day " + payload.gateDays + ", calendar days"],
        ["Window", n(payload.windowDays) === null ? null : days(n(payload.windowDays))],
      ],
      sections: [
        { title: "The gate", lines: [notes.gate, "Every name reporting inside the gate was removed before the board was scored, so the board holds no opinion on any of them. Board names never report inside it by construction; they appear in the Earnings list once their report lies beyond it."] },
        { title: "Two clocks", lines: [notes.clocks, clashes ? clashes + " rows publish more sessions than calendar days: the two counts were measured from different origins, and the difference between them is not safe to read on those rows." : null] },
        { title: "Before the open or after the close", lines: [payload.announce && payload.announce.reason ? String(payload.announce.reason) : null, "A sun marks a report before the open and a moon one after the close, where the vendor's earnings calendar states it."] },
        document.querySelector(".fe-c-div") ? null : { title: "Ex-dividends", lines: ["Ex-dividend dates need the vendor's dividends route, which this plan does not include. Until a run reads them the week carries no lane for them, rather than an empty one that would read as a week without dividends."] },
      ],
    };
  }

  function queueCx(payload) {
    if (S.asked) return;
    const hist = payload.history && typeof payload.history === "object" ? payload.history : null;
    if (!hist) return;
    S.asked = true;
    const names = (payload.rows || []).map((r) => r.t).filter((t) => hist[t] && hist[t].status === "ok").slice(0, 40);
    const one = async (t) => {
      try {
        const res = await fetch("/api/flows/card-x?t=" + encodeURIComponent(cardKey(t)), { credentials: "same-origin", headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const cx = await res.json();
        if (!cx || cx.status === "pending") S.cx.set(t, { st: { state: "pending", reason: "This name's card extension has not been published yet." } });
        else if (!cx.earnings) S.cx.set(t, { st: { state: "unavailable", reason: "This name's card carries no earnings history." } });
        else if (cx.earnings.status === "ok") S.cx.set(t, { st: { state: "ok" }, earnings: cx.earnings });
        else S.cx.set(t, { st: cx.earnings.status === "thin" ? { state: "quiet", reason: "Fewer reports than the statistic needs." } : blockState(cx.earnings, "earnings history"), earnings: cx.earnings });
      } catch (e) {
        S.cx.set(t, { st: { state: "unavailable", reason: "This name's card could not be loaded (" + (e && e.message ? e.message : "no message") + ")." } });
      }
    };
    let pending = 0;
    const lanes = [];
    for (let k = 0; k < 4; k++) {
      lanes.push((async () => {
        while (names.length) {
          await one(names.shift());
          if (++pending % 4 === 0) paintEarnings(payload, false);
        }
      })());
    }
    Promise.all(lanes).then(() => { paintEarnings(payload, false); host.week.classList.add("is-still"); paintWeek(payload); });
  }

  function paintEarnings(payload, animate) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      const universe = n(payload.universe), wd = n(payload.windowDays);
      silence(host.earn, { state: "quiet", reason: "No name in the screened universe" + (universe === null ? "" : " of " + universe) + " reports inside the next " + (wd === null ? "window" : days(wd)) + ". That is a measured emptiness — the run read every screener row and found no dated report inside it — and not a missing publish." }, "Earnings", 240);
      return;
    }
    const cal = calIndex(payload);
    const hist = payload.history && typeof payload.history === "object" ? payload.history : null;
    const data = rows.map((r) => {
      const imp = impliedOf(r, cal.get(r.t));
      const re = realizedOf(r.t, payload);
      const med = re.earnings ? n(re.earnings.medianAbsMove) : null;
      const hit = re.earnings && n(re.earnings.ls1dHit) !== null ? n(re.earnings.ls1dHit) : re.digest ? n(re.digest.hit) : null;
      return { r, c: cal.get(r.t) || null, imp, re, med, hit };
    });
    const max = Math.max(0.02, ...data.flatMap((x) => [x.imp ? x.imp.v : 0, x.med || 0]));
    const items = data.map((x, i) => {
      const w = (v) => Math.max(1.5, (v / max) * 100).toFixed(1) + "%";
      const when = x.c && x.c.when;
      const reSt = x.med === null ? (x.re.st.state === "ok" ? { state: "unavailable", reason: "This name's earnings history carries no median move." } : x.re.st) : null;
      return h("a", {
        class: "fe-erow" + (i && data[i - 1].r.d === x.r.d ? " is-cont" : ""), href: tickerHref(x.r.t), "data-t": String(x.r.t || ""), "data-realized": reSt ? reSt.state : "ok",
        title: String(x.r.t) + " " + MID + " reports " + (x.r.d || DASH) + " " + MID + " priced " + pricedText(x.r) + " " + MID + " IV " + pct(x.r.iv) +
          (n(x.r.ivr) === null ? "" : ", rank " + Math.round(n(x.r.ivr) * 100)) + " " + MID + " " + stageOf(x.r.st).word,
      },
      h("span", { class: "fe-edate" }, h("b", null, x.r.d ? weekday(x.r.d) : DASH), h("small", null, F.day(x.r.d))),
      h("span", { class: "fu-tk fe-etk" }, stageGlyph(x.r.st), h("b", null, String(x.r.t || DASH)),
        when === "premarket" ? h("i", { class: "fe-when is-am", "aria-label": "Before the open" }) : when === "postmarket" ? UI.glyph("closed", "fe-when") : null),
      h("span", { class: "fe-pair", ...HIDE },
        h("i", { class: "is-imp", style: { width: x.imp ? w(x.imp.v) : "0%", "--i": String(i) } }),
        x.med === null ? h("i", { class: "is-none" }) : h("i", { class: "is-real", style: { width: w(x.med), "--i": String(i) } })),
      h("span", { class: "fu-v fu-strong" }, x.imp ? move(x.imp.v) : mark({ state: "unavailable" })),
      x.med === null ? h("span", V, mark(reSt)) : h("span", V, move(x.med)),
      h("span", { class: "fu-v fu-wide" }, x.hit === null ? DASH : Math.round(x.hit * 100) + "%"));
    });
    const box = withList(UI.list(items, { visible: 8, label: "Names reporting inside the window, nearest first" }));
    const open = !!host.earn.querySelector('.ui-disclose[aria-expanded="true"]');
    host.earn.classList.toggle("is-still", animate === false);
    host.earn.replaceChildren(
      h("div", { class: "fe-erow fu-head", ...HIDE }, h("span", null, "Day"), h("span", null, "Name"), h("span", null, "Implied vs typical"), h("span", V, "Implied"), h("span", V, "Typical"), h("span", { class: "fu-v fu-wide" }, "Hit")),
      box,
      UI.legend([["--accent", "", "Implied move"], ["--s-gray", "", "Median past move"]]));
    if (open) box.querySelector(".ui-disclose").click();
    setModuleState(host.earn, hist ? { state: "ok" } : { state: "quiet", reason: "Earnings: the past-report history is not on this payload yet, so the typical move is pending." }, "Earnings");
    if (animate !== false) queueCx(payload);
  }

  function earnInfo() {
    const payload = S.payload || {};
    const notes = payload.notes && typeof payload.notes === "object" ? payload.notes : {};
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const shown = n(payload.shown) ?? rows.length, inWindow = n(payload.inWindow);
    return {
      title: "Earnings",
      lead: "Every name reporting inside the window, nearest first. The blue bar is the move the option market prices for the report; the gray bar is the median absolute one-day move over the name's past reports. A blue bar longer than the gray one is a report priced richer than this name usually moves.",
      facts: [
        ["Names", count(shown) + (inWindow !== null && inWindow > shown ? " of " + count(inWindow) : "")],
        ["Priced moves", n(payload.evMeasured) === null ? null : count(payload.evMeasured) + " of " + count(shown)],
        ["Realized volatility", n(payload.rvMeasured) === null ? null : count(payload.rvMeasured) + " of " + count(shown)],
        ["Hit", payload.historyRule ? "share of long one-day straddles that paid" : null],
      ],
      sections: [
        { title: "The implied move", lines: ["The vendor's expected earnings move where its calendar states one, otherwise the vendor's implied move to its next expiry, which is a different horizon.", notes.vendorMove] },
        { title: "The priced move", lines: [notes.priced, "A name with no sessions left prints 0s: a horizon of zero, not a zero move. One with no implied volatility is not measured, and one whose move was not published is not zero."] },
        { title: "Past reports", lines: [payload.historyRule ? String(payload.historyRule) : "The past-report history is not on this payload yet."] },
        { title: "Coverage", lines: [notes.coverage] },
      ],
    };
  }

  function paintMacro(payload) {
    const st = blockState(payload.macro, "economic calendar");
    if (st.state !== "ok") { silence(host.macro, st, "Macro", 200); return; }
    const rows = (payload.macro.rows || []).filter(Boolean);
    if (!rows.length) { silence(host.macro, { state: "quiet", reason: "No economic print is scheduled after the session's close in what the vendor returned." }, "Macro", 200); return; }
    setModuleState(host.macro, { state: "ok" }, "Macro");
    const items = rows.map((m) => {
      const tag = TAGS[m.tag] || null;
      return h("div", { class: "fe-mrow", role: "listitem", title: String(m.event || "") + (m.period ? " " + MID + " " + m.period : "") },
        h("span", { class: "fe-edate" }, h("b", null, m.day ? weekday(m.day) : DASH), h("small", null, etTime(m.at) || F.day(m.day))),
        h("span", { class: "fe-mname" }, h("i", { class: "fe-dot", style: { "--c": UI.cssVar(tag ? tag[1] : "--label-4") } }),
          h("b", null, tag ? tag[0] : String(m.event || DASH).replace(/\s*\((MoM|YoY|QoQ)\)/, "")), tag ? h("small", null, String(m.event || "")) : null),
        h("span", { class: "fu-v fu-strong" }, raw(m.forecastRaw)),
        h("span", V, raw(m.prevRaw)));
    });
    host.macro.replaceChildren(
      h("div", { class: "fe-mrow fu-head", ...HIDE }, h("span", null, "When"), h("span", null, "Print"), h("span", V, "Forecast"), h("span", V, "Prior")),
      withList(UI.list(items, { visible: 7, label: "Economic prints after the close" })));
  }

  function macroInfo() {
    const m = (S.payload || {}).macro || {};
    return {
      title: "Macro",
      lead: "Economic prints scheduled after the session's close, with the consensus forecast and the prior reading. Times are Eastern.",
      facts: [["Seen", n(m.seen) === null ? null : count(m.seen)], ["Already past", n(m.past) === null ? null : count(m.past)]],
      notes: [m.rule ? String(m.rule) : null],
    };
  }

  function paintFda(payload) {
    const st = blockState(payload.fda, "FDA calendar");
    if (st.state !== "ok") { silence(host.fda, st, "FDA", 200); return; }
    const rows = (payload.fda.rows || []).filter((f) => f && f.tgt);
    if (!rows.length) { silence(host.fda, { state: "quiet", reason: "No optionable name has an FDA target date inside the horizon." }, "FDA", 200); return; }
    setModuleState(host.fda, { state: "ok" }, "FDA");
    const start = ISO.test(String(payload.sessionDate || "")) ? payload.sessionDate : rows[0].tgt.from;
    const horizon = n(payload.fda.horizonDays) || 120;
    const end = addDays(start, horizon);
    const at = (d) => Math.max(0, Math.min(1, (dayMs(d) - dayMs(start)) / (dayMs(end) - dayMs(start))));
    const months = [];
    for (let m = new Date(dayMs(start)); m <= new Date(dayMs(end)); m.setUTCMonth(m.getUTCMonth() + 1, 1)) {
      const d = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1)).toISOString().slice(0, 10);
      if (d > start) months.push(d);
    }
    const sorted = rows.slice().sort((a, b) => String(a.tgt.from).localeCompare(String(b.tgt.from)));
    const items = sorted.map((f) => {
      const a = at(f.tgt.from), b = at(f.tgt.to || f.tgt.from);
      const point = f.tgt.p === "day";
      return h(f.carded ? "a" : "div", { class: "fe-frow", href: f.carded ? tickerHref(f.t) : null, role: f.carded ? null : "listitem",
        title: String(f.t) + " " + MID + " " + String(f.cat || "") + " " + MID + " " + String(f.st || "") + " " + MID + " target " + String(f.tgt.raw || f.tgt.from) },
      h("span", { class: "fu-tk is-2" }, h("b", null, String(f.t || DASH)), h("small", null, FDA_CAT(f.cat))),
      h("span", { class: "fe-track", ...HIDE },
        months.map((d) => h("i", { class: "fe-tick", style: { left: (at(d) * 100).toFixed(2) + "%" } })),
        point ? h("i", { class: "fe-dia", style: { left: (a * 100).toFixed(2) + "%" } })
          : h("i", { class: "fe-span", style: { left: (a * 100).toFixed(2) + "%", width: Math.max(1, (b - a) * 100).toFixed(2) + "%" } })),
      h("span", V, point ? F.day(f.tgt.from) : windowLabel(f.tgt)));
    });
    host.fda.replaceChildren(
      h("div", { class: "fe-frow fu-head", ...HIDE }, h("span", null, "Name"),
        h("span", { class: "fe-axis" }, months.map((d) => h("span", { style: { left: (at(d) * 100).toFixed(2) + "%" } }, F.day(d).slice(0, 3)))), h("span", V, "Target")),
      withList(UI.list(items, { visible: 6, label: "FDA target dates" })),
      UI.legend([key(h("i", { class: "is-dia", style: { "--c": UI.cssVar("--lvl-pain") } }), "Dated"), key(h("i", { class: "fe-key-span" }), "Window")]));
  }

  function windowLabel(tgt) {
    const y = String(tgt.from || tgt.to || "").slice(0, 4);
    const p = String(tgt.p || "");
    if (p === "early" || p === "mid" || p === "late") return p.charAt(0).toUpperCase() + p.slice(1) + " " + y;
    if (p === "month" && ISO.test(String(tgt.from))) return F.day(tgt.from).slice(0, 3) + " " + y;
    if (p === "quarter" && ISO.test(String(tgt.from))) return "Q" + (Math.floor((+String(tgt.from).slice(5, 7) - 1) / 3) + 1) + " " + y;
    if (p === "half" && ISO.test(String(tgt.from))) return "H" + (+String(tgt.from).slice(5, 7) <= 6 ? 1 : 2) + " " + y;
    if (p === "year") return y;
    return String(tgt.raw || y);
  }

  function fdaInfo() {
    const f = (S.payload || {}).fda || {};
    return {
      title: "FDA",
      lead: "Optionable names with an FDA target inside the horizon. A diamond is a stated day; a bar is a window parsed from the sponsor's own wording, such as a quarter or \"late\" in the year.",
      facts: [["In window", n(f.inWindow) === null ? null : count(f.inWindow)], ["Unparsed", n(f.unparsed) === null ? null : count(f.unparsed)], ["Outside", n(f.outside) === null ? null : count(f.outside)], ["No options", n(f.noOptions) === null ? null : count(f.noOptions)], ["Horizon", n(f.horizonDays) === null ? null : days(n(f.horizonDays))]],
      notes: [f.rule ? String(f.rule) : null],
    };
  }

  function paintReact(payload) {
    const cal = payload.earningsCalendar;
    const r0 = cal && typeof cal === "object" ? cal.reaction : undefined;
    const st = r0 === undefined ? blockState(undefined, "earnings reaction") : blockState(r0, "earnings reaction");
    if (st.state !== "ok") { silence(host.react, st, "Reaction", 200); return; }
    const rows = (Array.isArray(r0.rows) ? r0.rows : []).filter((x) => Array.isArray(x) && n(x[3]) !== null);
    if (!rows.length) { silence(host.react, { state: "quiet", reason: "No reporter had reacted by the session, which is common the evening of a report." }, "Reaction", 200); return; }
    setModuleState(host.react, { state: "ok" }, "Reaction");
    const maxDev = Math.max(0.25, ...rows.map((x) => Math.abs(n(x[3]) - 1)));
    const items = rows.map((x, i) => {
      const ratio = n(x[3]), dev = ratio - 1, real = n(x[1]);
      const w = (Math.min(1, Math.abs(dev) / maxDev) * 50).toFixed(2) + "%";
      return h("a", { class: "fe-rrow", href: tickerHref(x[0]),
        title: String(x[0]) + " " + MID + " moved " + F.pct(real, 1, true) + " against an implied " + move(n(x[2])) + " " + MID + " " + ratio.toFixed(2) + "× the priced move" },
      h("span", { class: "fu-tk is-2" }, h("b", null, String(x[0])), h("small", { "data-tone": real === null ? null : real > 0 ? "up" : real < 0 ? "down" : null }, real === null ? DASH : F.pct(real, 1, true))),
      h("span", { class: "fe-dv", ...HIDE },
        h("i", { class: dev >= 0 ? "is-more" : "is-less", style: dev >= 0 ? { left: "50%", width: w, "--i": String(i) } : { right: "50%", width: w, "--i": String(i) } })),
      h("span", { class: "fu-v fu-strong" }, ratio.toFixed(2) + "×"));
    });
    host.react.replaceChildren(
      UI.metrics([
        UI.metric("Realized ÷ implied", n(r0.medianRatio) === null ? DASH : n(r0.medianRatio).toFixed(2) + "×", { sub: "median of " + (n(r0.n) ?? rows.length) }),
        UI.metric("Moved more", n(r0.beat) === null ? DASH : Math.round(n(r0.beat) * 100) + "%", { sub: "than implied" }),
      ], { min: 120 }),
      h("div", { class: "fe-rrow fu-head", ...HIDE }, h("span", null, "Name"), h("span", { class: "fe-dv-axis" }, h("span", null, "Less"), h("span", null, "Priced"), h("span", null, "More")), h("span", V, "Ratio")),
      withList(UI.list(items, { visible: 6, label: "Last reporters, realized over implied" })),
      UI.legend([["--g-long", "", "Moved more than priced"], ["--g-short", "", "Moved less"]]));
  }

  function reactInfo() {
    const r0 = ((S.payload || {}).earningsCalendar || {}).reaction || {};
    return {
      title: "Reaction",
      lead: "The last session's reporters: each bar is the realized one-day move over the move the options implied, less one. Above the line a name moved more than it was priced to; below, less. The median tells whether the market has been over- or under-pricing reports lately.",
      notes: [r0.rule ? String(r0.rule) : null],
    };
  }

  function paintChips(payload) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const inWindow = n(payload.inWindow);
    const gated = payload.byStage && typeof payload.byStage === "object" ? n(payload.byStage.gated) ?? 0 : null;
    const macroSt = blockState(payload.macro, "economic calendar"), fdaSt = blockState(payload.fda, "FDA calendar");
    const week = sessionDays(payload);
    const macroN = macroSt.state === "ok" ? (payload.macro.rows || []).filter((m) => m && week.includes(m.day)).length : null;
    const fdaN = fdaSt.state === "ok" ? n(payload.fda.inWindow) ?? (payload.fda.rows || []).length : null;
    const r0 = payload.earningsCalendar && payload.earningsCalendar.reaction;
    const ratio = r0 && r0.status === "ok" ? n(r0.medianRatio) : null;
    const reactSt = blockState(r0, "earnings reaction");
    host.chips.replaceChildren(UI.chips([
      UI.gaugeChip({ icon: "cal", color: "--accent-ink", value: inWindow === null ? String(rows.length) : String(inWindow), label: "Reporting",
        info: { title: "Reporting", lead: "Names reporting inside the window.", facts: [["Window", n(payload.windowDays) === null ? null : days(n(payload.windowDays))], ["Screened", n(payload.universe) === null ? null : count(payload.universe)], ["Undated", n(payload.undated) === null ? null : count(payload.undated)]] } }),
      UI.gaugeChip({ icon: "shield", color: "--label-2", value: gated === null ? DASH : String(gated), label: "Gated",
        info: { title: "Gated", lead: stageOf("gated").what } }),
      UI.gaugeChip({ g: macroN === null ? muted(macroSt) : undefined, icon: "wave", color: "--s-purple", value: macroN === null ? DASH : String(macroN), label: "Macro",
        info: { title: "Macro prints", state: macroSt.state === "ok" ? null : macroSt.state, lead: macroSt.state === "ok" ? "Economic prints in the next five sessions." : macroSt.reason } }),
      UI.gaugeChip({ g: fdaN === null ? muted(fdaSt) : undefined, icon: "flask", color: "--lvl-pain", value: fdaN === null ? DASH : String(fdaN), label: "FDA",
        info: { title: "FDA dates", state: fdaSt.state === "ok" ? null : fdaSt.state, lead: fdaSt.state === "ok" ? "Optionable names with an FDA target inside the horizon." : fdaSt.reason } }),
      UI.gaugeChip({ g: ratio === null ? muted(reactSt) : undefined, ring: ratio === null ? null : Math.min(1, ratio / 2), color: "--g-long", value: ratio === null ? DASH : ratio.toFixed(2) + "×", label: "Reaction",
        info: { title: "Reaction", state: ratio === null ? reactSt.state : null, lead: ratio === null ? reactSt.reason : "Median realized move over implied move for the last session's reporters. Under 1× the options over-priced the reports." } }),
    ], "Calendar"));
  }

  function renderStatus(payload) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const shown = n(payload.shown) ?? rows.length;
    const inWindow = n(payload.inWindow), universe = n(payload.universe), undated = n(payload.undated), wd = n(payload.windowDays);
    const gated = payload.byStage && typeof payload.byStage === "object" ? n(payload.byStage.gated) ?? 0 : null;
    const cap = n(payload.cap);
    const parts = [];
    parts.push(shown + (inWindow === null || inWindow === shown ? "" : " of " + inWindow) + " " + plural(shown, "name", "names") +
      " reporting inside the " + (wd === null ? "" : wd + "-day ") + "window" + (universe === null ? "" : ", of " + universe + " screened"));
    if (gated !== null) parts.push("the board was gated out of scoring " + (gated || "none") + " of them");
    if (undated !== null && undated > 0) parts.push(undated + (universe === null ? "" : " of the " + universe) + " carry no earnings date at all");
    if (cap !== null && inWindow !== null && inWindow > shown) parts.push("the cap holds the list to " + cap);
    const sd = payload.sessionDate, go = payload.gateOrigin;
    parts.push("prices are the " + (sd || "last completed") + " session's closes; every day count is measured from " +
      (go ? go + ", the run's own Eastern date and the origin the earnings gate used" : "the run's own Eastern date") +
      (S.staleDays === null ? "" : ", which was " + S.staleDays + " " + plural(S.staleDays, "day", "days") + " ago — these counts are that run's, not today's"));
    statusEl.textContent = parts.join(" " + MID + " ") + ".";
    if (rows.length) delete statusEl.dataset.empty; else statusEl.dataset.empty = "quiet";
    const slot = document.querySelector('[data-rail-count="events"]');
    if (slot && inWindow !== null) { slot.textContent = String(inWindow); slot.hidden = false; }
  }

  function builtAt(payload) {
    const t = Date.parse(String(payload.generatedAt || ""));
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC" : payload.generatedAt ? String(payload.generatedAt) : null;
  }

  function paintMeta(payload) {
    const bits = [];
    if (ISO.test(String(payload.sessionDate || ""))) bits.push(h("span", null, F.day(payload.sessionDate)));
    if (n(payload.windowDays) !== null) bits.push(h("span", null, n(payload.windowDays) + "-day window"));
    const stale = h("button", { class: "fd-pill", type: "button", id: "evStale", hidden: S.staleText ? null : true,
      "aria-haspopup": "dialog", "aria-controls": "fxPop",
      "data-info": UI.info(() => ({ title: "Stale calendar", state: "stale", lead: S.staleText })) }, UI.glyph("clock"), S.staleDays === null ? "Behind" : S.staleDays + "d old");
    host.meta.replaceChildren(...bits.flatMap((b, i) => (i ? [h("span", { ...HIDE }, MID), b] : [b])), stale);
  }

  function aboutInfo() {
    const payload = S.payload || {};
    const notes = payload.notes && typeof payload.notes === "object" ? payload.notes : null;
    const src = document.getElementById("evAbout");
    const known = ["gate", "clocks", "priced", "vendorMove", "coverage", "announce"];
    return {
      title: "Events",
      facts: [["Built", builtAt(payload)], ["Payload", n(payload.v) === null ? null : "v" + payload.v], ["Vendor calls", "zero: every field here was already on the wire"]],
      sections: S.fail ? [{ title: "Method", lines: [S.fail === "unreadable"
        ? "The basis travels inside the same payload as the numbers, so it did not parse either. Nothing on this page has been explained by the pipeline."
        : S.fail === "failed" ? "The basis travels inside the same payload as the numbers, so it could not be fetched either. Nothing on this page has been explained by the pipeline." : null] }]
        : notes ? Object.keys(notes).filter((k) => !known.includes(k)).map((k) => ({ title: k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, " $1").toLowerCase(), lines: [notes[k]] }))
        : [{ title: "Method", lines: [S.payload && S.payload.status !== "pending" ? "This payload carries no notes block, so how these numbers were built is not stated in the pipeline's own words. The readings were still measured; it is the method behind them that is not on this payload." : null] }],
      node: src ? h("div", { class: "fd-about-pop" }, [...src.children].map((x) => x.cloneNode(true))) : null,
    };
  }

  function wireInfos() {
    if (host.about && !host.about.firstChild) host.about.append(UI.infoButton("this page", aboutInfo));
    setModuleInfo(host.week, "the week ahead", weekInfo);
    setModuleInfo(host.earn, "earnings", earnInfo);
    setModuleInfo(host.macro, "macro prints", macroInfo);
    setModuleInfo(host.fda, "FDA dates", fdaInfo);
    setModuleInfo(host.react, "the reaction", reactInfo);
  }

  function failEverywhere(kind, what) {
    S.fail = kind;
    statusEl.textContent = what;
    statusEl.dataset.empty = kind;
    const st = { state: kind === "unreadable" ? "withheld" : kind === "pending" ? "pending" : "unavailable", reason: what };
    for (const [el, label, hh] of [[host.week, "Week ahead", 220], [host.earn, "Earnings", 240], [host.macro, "Macro", 200], [host.fda, "FDA", 200], [host.react, "Reaction", 200]]) silence(el, st, label, hh);
    host.chips.replaceChildren(UI.chips(["Reporting", "Gated", "Macro", "FDA", "Reaction"].map((label) =>
      UI.gaugeChip({ g: muted(st), value: DASH, label, info: { title: label, state: st.state, lead: what } })), "Calendar"));
  }

  function stale(payload, updatedAt) {
    if (updatedAt) {
      const ageHours = (Date.now() - updatedAt) / 3600000;
      if (ageHours > 30) {
        S.staleDays = Math.round(ageHours / 24);
        S.staleText = "This calendar was last written " + S.staleDays + " " + plural(S.staleDays, "day", "days") + " ago. The pipeline has not published since, so every day count is measured from that run's date and not from today — each name is nearer to its report than this page says.";
        return;
      }
    }
    const lag = Math.round((dayMs(payload.gateOrigin) - dayMs(payload.sessionDate)) / 864e5);
    if (Number.isFinite(lag) && lag > 4) {
      S.staleText = "The prices here are the " + payload.sessionDate + " session's closes, but the run that measured them is dated " + payload.gateOrigin + " — " + lag + " days later. The pipeline is running but its price data is not advancing; every day count is still measured from the run's own date.";
    }
  }

  const trouble = (kind, message) => { const e = new Error(message); e.evKind = kind; return e; };

  wireInfos();
  fetch("/api/flows/events", { credentials: "same-origin", headers: { Accept: "application/json" } }).then((response) => {
    if (response.status === 401) { location.replace("/flows/"); return null; }
    if (!response.ok) throw trouble("failed", "HTTP " + response.status);
    const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
    return response.json().then((payload) => {
      if (payload && typeof payload === "object") payload.__updatedAt = updatedAt;
      return payload;
    }, (error) => { throw trouble("unreadable", (error && error.message) || "the body did not parse"); });
  }).then((payload) => {
    if (!payload) return;
    if (typeof payload !== "object") throw trouble("unreadable", "the endpoint answered with a " + typeof payload + ", not a payload object");
    S.payload = payload;
    if (payload.macro && Array.isArray(payload.macro.rows)) {
      const seen = new Set();
      payload.macro.rows = payload.macro.rows.filter((m) => { const k = m && m.at + "|" + m.event; return !seen.has(k) && seen.add(k); });
    }
    UI.freshness({ sessionDate: payload.sessionDate, generatedAt: payload.generatedAt, updatedAt: payload.__updatedAt, source: "events" });
    if (payload.status === "pending") {
      failEverywhere("pending", "The pipeline has not published this key yet. This calendar is built by the weekday after-close run out of screener rows it already holds — it costs no vendor call — and it appears with the first run after this page shipped.");
      return;
    }
    stale(payload, payload.__updatedAt);
    renderStatus(payload);
    paintMeta(payload);
    paintChips(payload);
    paintWeek(payload);
    paintEarnings(payload, true);
    paintMacro(payload);
    paintFda(payload);
    paintReact(payload);
    wireInfos();
  }).catch((error) => {
    const why = error && error.message ? error.message : "the request failed";
    if (error && error.evKind === "unreadable") {
      failEverywhere("unreadable", "A calendar is published under this key, but it does not parse (" + why + "). Reloading reads the same bytes back — only the next weekday after-close run replaces them.");
    } else {
      failEverywhere("failed", "The calendar could not be fetched (" + why + "). Refresh to try again.");
    }
  });
})();
