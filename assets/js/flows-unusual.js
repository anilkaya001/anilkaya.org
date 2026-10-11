(() => {
  "use strict";

  const UI = window.FlowsUI;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("uaStatus");
  if (!UI || !statusEl) return;
  const { h, s, F, chart: C } = UI;
  const DASH = UI.DASH, MID = UI.MID;

  const host = {
    meta: $("uaMeta"),
    about: $("uaAboutSlot"),
    chips: $("uaChips"),
    filters: $("uaFilters"),
    note: $("uaFilterNote"),
    timeline: $("uaTimeline"),
    names: $("uaNames"),
    urgency: $("uaUrgency"),
    feed: $("uaFeed"),
    surprise: $("uaSurprise"),
    net: $("uaNet"),
  };

  const n = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string" && !v.trim()) return null;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const count = (v) => (n(v) === null ? DASH : Math.round(n(v)).toLocaleString("en-US"));
  const pct0 = (v) => (n(v) === null ? DASH : Math.round(n(v) * 100) + "%");
  const plural = (k, one, many) => (k === 1 ? one : many);
  const instant = (iso) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(iso || ""));
    return m ? m[1] + " " + m[2] + " UTC" : null;
  };
  const ET = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const etOf = (iso) => {
    const t = Date.parse(String(iso || ""));
    if (!Number.isFinite(t)) return null;
    const p = {};
    for (const x of ET.formatToParts(new Date(t))) p[x.type] = x.value;
    return { day: p.year + "-" + p.month + "-" + p.day, m: (+p.hour % 24) * 60 + +p.minute };
  };
  const clock = (m) => {
    const hh = Math.floor(m / 60) % 24, mm = Math.round(m % 60);
    return ((hh + 11) % 12 + 1) + ":" + String(mm).padStart(2, "0") + " " + (hh < 12 ? "AM" : "PM");
  };
  const hourLabel = (m) => { const hh = Math.round(m / 60) % 24; return ((hh + 11) % 12 + 1) + (hh < 12 ? " AM" : " PM"); };
  const cardKey = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  const tickerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(cardKey(t));
  const contractText = (r) => (r.cp === "C" || r.cp === "P" ? r.cp + " " + (n(r.k) === null ? "" : F.compact(n(r.k), n(r.k) % 1 ? 1 : 0)) : "") +
    (r.exp || r.expiry ? " " + MID + " " + F.day(String(r.exp || r.expiry)) : "");
  const joinKey = (t, cp, k, expiry) => {
    const strike = n(k);
    if (!t || !cp || strike === null || !expiry) return null;
    return String(t) + "|" + String(cp) + "|" + strike + "|" + String(expiry);
  };

  const view = { side: "all", both: false };
  const S = {
    alerts: null, alertsState: { state: "pending", reason: "Reading the flagged windows." }, alertsKind: "pending",
    payload: null, feedState: { state: "pending", reason: "Reading the counter feed." }, feedKind: "pending",
    namesState: { state: "pending", reason: "Reading the counter feed." },
    alertKeys: null, feedKeys: null, urgency: new Map(), urgencyAsked: new Set(),
  };
  const charts = { timeline: null };
  const below = { fns: null, ask: new Map(), animate: false };
  const later = (key, run) => {
    if (below.fns) run(below.fns);
    else below.ask.set(key, run);
  };
  const paintAlertModules = (animate) => {
    below.animate = below.animate || animate;
    later("alerts", (b) => {
      const a = below.animate;
      below.animate = false;
      if (S.alertsKind !== "ok") return;
      b.paintTimeline(a);
      b.paintNames();
      if (S.alerts.rows.length) b.paintUrgency();
    });
  };
  let net = null;
  const slotEl = host.net ? h("div", { class: "fn-slot", role: "group", "aria-label": "Largest names by flagged premium, shown until the network loads" }) : null;
  if (slotEl) host.net.append(slotEl);

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
  function vendorCeilingSaid() {
    const a = S.alerts;
    if (S.alertsKind !== "ok" || !a) return "";
    const vLimit = n(a.vendorLimit), rLimit = n(a.readLimit);
    const vTrunc = typeof a.vendorTruncated === "boolean" ? a.vendorTruncated : null;
    const rTrunc = typeof a.readTruncated === "boolean" ? a.readTruncated : null;
    if (vTrunc === true) {
      return " The flagged windows hit the vendor's own ceiling" +
        (vLimit === null ? "" : " of " + count(vLimit) + " rows") +
        ", so how many it withheld above that line is unknown — this count is a " +
        "ceiling rather than a market, and comparing it with another session's " +
        "compares two ceilings.";
    }
    if (rTrunc === true) {
      return " An intraday read came back full at this site's own cap" +
        (rLimit === null ? "" : " of " + count(rLimit) + " rows") +
        ", so windows flagged between reads may be missing and this count is " +
        "at least what the record holds rather than a market.";
    }
    if (vTrunc === null && rTrunc === false) {
      return " Every intraday read came in under this site's own per-read cap" +
        (rLimit === null ? "" : " of " + count(rLimit) + " rows") +
        ", so each saw every window the vendor's rolling list still held.";
    }
    if (vTrunc === null) {
      return " Whether the flagged windows hit the vendor's own ceiling was not " +
        "recorded on this payload, so this count may be a ceiling rather than a market.";
    }
    return " The flagged windows came in under the vendor's ceiling, so this count is " +
      "the read rather than a limit.";
  }

  const passes = (r, expiryKey) => {
    if (view.side !== "all" && r.cp !== view.side) return false;
    if (view.both) {
      const key = joinKey(r.t, r.cp, r.k, r[expiryKey]);
      if (!key || S.alertKeys === null || S.feedKeys === null) return false;
      if (!S.alertKeys.has(key) || !S.feedKeys.has(key)) return false;
    }
    return true;
  };

  function syncNote() {
    const tally = (kind, rows, expiryKey, plural2) => {
      if (kind === "pending") return "the " + plural2 + " have not been read yet";
      if (kind === "unpublished") return "the pipeline has not published the " + plural2;
      if (kind === "failed" || kind === "withheld") return "the " + plural2 + " could not be read";
      if (kind === "absent") return "the " + plural2 + " are not on this payload";
      const shown = rows.filter((r) => passes(r, expiryKey)).length;
      return count(shown) + " of " + count(rows.length) + " " + plural2 + " are drawn";
    };
    const aRows = S.alertsKind === "ok" ? S.alerts.rows : [];
    const fRows = S.feedKind === "ok" ? S.payload.contracts.rows : [];
    const aT = tally(S.alertsKind, aRows, "exp", "flagged windows");
    const fT = tally(S.feedKind, fRows, "expiry", "contracts");
    let text;
    if (view.side === "all" && !view.both) {
      text = (S.alertsKind === "ok" && S.feedKind === "ok"
        ? "Both tables show every row published."
        : "No filter is on: " + aT + " and " + fT + ".") +
        " Narrowing either is a filter on what is drawn and never a second read of the market.";
    } else {
      const bits = [];
      if (view.side !== "all") bits.push(view.side === "C" ? "calls only" : "puts only");
      if (view.both) {
        const dead = S.feedKind === "absent" ? "the contract rows are not on this payload"
          : ["failed", "withheld"].includes(S.alertsKind) || ["failed", "withheld"].includes(S.feedKind) ? "one of the two payloads could not be read" : null;
        bits.push(S.alertsKind === "ok" && S.feedKind === "ok" ? "contracts in both feeds"
          : dead ? "contracts in both feeds — which cannot be resolved at all, because " + dead
            : S.alertsKind === "unpublished" || S.feedKind === "unpublished"
              ? "contracts in both feeds — which cannot be resolved, because the pipeline has not published one of the two"
              : "contracts in both feeds, which cannot be resolved until both payloads have loaded");
      }
      text = "Filtered to " + bits.join(" and ") + ": " + aT + " and " + fT + ". " +
        "Anything hidden is published and hidden, not absent from the read.";
    }
    host.note.textContent = text + vendorCeilingSaid();
    host.filters.inert = S.alertsKind !== "ok" && S.feedKind !== "ok";
    const cnt = host.filters.querySelector(".fu-count");
    if (cnt) {
      const shown = aRows.filter((r) => passes(r, "exp")).length;
      cnt.textContent = S.alertsKind !== "ok" ? "" : view.side === "all" && !view.both
        ? count(aRows.length) + " shown" : count(shown) + " of " + count(aRows.length) + " shown";
    }
  }

  function buildFilters() {
    const seg = UI.segmented("Side", [{ label: "All" }, { label: "Calls" }, { label: "Puts" }], (i) => {
      view.side = ["all", "C", "P"][i];
      repaint();
    }, 0);
    const both = h("button", {
      class: "fu-toggle", type: "button", "aria-pressed": "false",
      title: "Contracts the vendor's rules flagged and that also cleared this page's own floors",
    }, UI.glyph("levels"), h("span", null, "Both feeds"));
    both.addEventListener("click", () => {
      view.both = !view.both;
      both.setAttribute("aria-pressed", String(view.both));
      repaint();
    });
    host.filters.replaceChildren(seg, both, h("span", { class: "fu-count", "aria-hidden": "true" }));
  }

  function repaint() {
    later("repaint", (b) => { b.paintTimeline(false); b.paintNames(); b.paintFeed(); });
    syncNote();
  }

  function paintChips() {
    const a = S.alerts;
    if (S.alertsKind !== "ok") {
      const st = S.alertsState;
      host.chips.replaceChildren(UI.chips(["Premium", "Windows", "Calls", "Ask side", "Sweeps"].map((label) =>
        UI.gaugeChip({ g: UI.iconChip(def(st).g, "--label-3"), value: DASH, label, info: { title: label, state: st.state, lead: st.reason } })), "Flagged windows"));
      return;
    }
    const rows = a.rows;
    let prem = 0, call = 0, cpW = 0, ask = 0, askW = 0, sw = 0, swW = 0;
    for (const r of rows) {
      const p = n(r.prem);
      if (p === null || p <= 0) continue;
      prem += p;
      if (r.cp === "C" || r.cp === "P") { cpW += p; if (r.cp === "C") call += p; }
      const aP = n(r.askPrem);
      if (aP !== null) { ask += aP; askW += p; }
      if (typeof r.sweep === "boolean") { swW += p; if (r.sweep) sw += p; }
    }
    const floor = a.vendorTruncated === true || a.readTruncated === true;
    const seen = n(a.seen);
    const share = (x, w) => (w ? x / w : null);
    host.chips.replaceChildren(UI.chips([
      UI.gaugeChip({ icon: "unusual", color: "--accent-ink", value: prem ? F.money(prem) : DASH, label: "Premium",
        info: { title: "Flagged premium", lead: "The vendor's total premium across every flagged window in the record.", facts: [["Windows", count(rows.length)]] } }),
      UI.gaugeChip({ icon: "list", color: "--label-2", value: (floor ? "≥" : "") + count(seen ?? rows.length), label: "Windows",
        info: { title: "Windows", lead: floor ? "The read hit a ceiling, so this count is a floor." : "Flagged windows the record has held.", facts: [["Drawn", count(rows.length)], ["Seen", seen === null ? null : (floor ? "at least " : "") + count(seen)]] } }),
      UI.gaugeChip({ ring: share(call, cpW), color: "--up-mark", value: pct0(share(call, cpW)), label: "Calls",
        info: { title: "Call share", lead: "Call premium as a share of the premium on windows whose contract side could be read." } }),
      UI.gaugeChip({ ring: share(ask, askW), color: "--label-1", value: pct0(share(ask, askW)), label: "Ask side",
        info: { title: "Ask-side share", lead: "The vendor's ask-side attribution as a share of premium. For contract volume the vendor defines the ask side as a fill above the midpoint; it does not document the alert field, and nothing here says who initiated." } }),
      UI.gaugeChip({ ring: share(sw, swW), color: "--s-orange", value: pct0(share(sw, swW)), label: "Sweeps",
        info: { title: "Sweep share", lead: "Premium on windows the vendor flagged as sweeps, over the windows that carry the flag at all." } }),
    ], "Flagged windows"));
  }

  function paintMeta() {
    const a = S.alerts, payload = S.payload;
    const day = (a && typeof a.sessionDate === "string" && a.sessionDate) || (payload && typeof payload.sessionDate === "string" && payload.sessionDate) || null;
    const bits = [];
    if (day) bits.push(F.day(day));
    if (S.alertsKind === "ok" && a.record && n(a.record.reads) !== null) bits.push(count(a.record.reads) + plural(n(a.record.reads), " read", " reads"));
    const live = UI.rt ? UI.rt.alerts() : null;
    if (live && live.dropped > 0) bits.push(count(live.dropped) + " held back by the stream");
    if (live && live.truncated) bits.push("stream missed a page");
    if (S.feedKind === "ok" && n(payload.namesSeen) !== null) bits.push(count(payload.namesSeen) + " chains");
    host.meta.textContent = bits.join(" " + MID + " ");
  }

  function paintStatus() {
    const parts = [];
    const kind = { ok: null, failed: "unreadable", withheld: "unreadable", absent: "unavailable", unpublished: "pending" }[S.feedKind] ?? S.feedKind;
    if (S.feedKind === "ok") {
      const c = S.payload.contracts;
      const rows = c.rows;
      const distinct = new Set(rows.map((r) => String(r.t || ""))).size;
      parts.push(count(n(c.shown) ?? rows.length) + " contracts from " + count(distinct) + plural(distinct, " name", " names") +
        (n(c.eligible) === null ? "" : ", of " + count(c.eligible) + " that cleared the floors"));
      if (!rows.length) statusEl.dataset.empty = "quiet"; else delete statusEl.dataset.empty;
    } else {
      parts.push(S.feedState.reason || "");
      if (kind) statusEl.dataset.empty = kind;
    }
    statusEl.textContent = parts.filter(Boolean).join(" " + MID + " ") + ".";
  }

  function wireInfos() {
    if (host.about && !host.about.firstChild) {
      const src = $("uaAbout");
      host.about.append(UI.infoButton("this page", () => ({
        title: "Unusual activity",
        node: src ? h("div", { class: "fd-about-pop" }, [...src.children].map((x) => x.cloneNode(true))) : null,
      })));
    }
    later("infos", (b) => {
      setModuleInfo(host.timeline, "the timeline", b.timelineInfo);
      setModuleInfo(host.names, "names", b.namesInfo);
      setModuleInfo(host.urgency, "urgency", b.urgencyInfo);
      setModuleInfo(host.feed, "volume over open interest", b.feedInfo);
      setModuleInfo(host.surprise, "volume surprise", b.surpriseInfo);
    });
  }

  function paintNetSlot() {
    if (!slotEl || net) return;
    const by = new Map();
    for (const r of S.alertsKind === "ok" && S.alerts ? S.alerts.rows : []) {
      const prem = n(r.prem), t = r.t && String(r.t).trim().toUpperCase();
      if (!t || prem === null || prem <= 0) continue;
      const sided = r.cp === "C" || r.cp === "P";
      let a = sided ? Math.max(0, n(r.askPrem) || 0) : 0, b = sided ? Math.max(0, n(r.bidPrem) || 0) : 0;
      if (a + b > prem) { const k = prem / (a + b); a *= k; b *= k; }
      const e = by.get(t) || { t, v: 0, up: 0, down: 0 };
      e.v += prem;
      e.up += r.cp === "C" ? a : b;
      e.down += r.cp === "C" ? b : a;
      by.set(t, e);
    }
    const top = [...by.values()].sort((x, y) => y.v - x.v || (x.t < y.t ? -1 : 1)).slice(0, 8);
    const lean = (e) => (e.up > e.down ? ["\u25B2", "Bullish"] : e.down > e.up ? ["\u25BC", "Bearish"] : ["\u2013", "Unsided"]);
    slotEl.replaceChildren(
      h("p", { class: "fn-slot-t" }, "Largest names by flagged premium"),
      top.length
        ? h("table", { class: "fn-slot-tab" },
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Name"), h("th", { scope: "col", class: "c-num" }, "Premium"), h("th", { scope: "col" }, "Lean"))),
          h("tbody", null, top.map((e) => h("tr", null,
            h("th", { scope: "row" }, h("a", { href: tickerHref(e.t) }, e.t)),
            h("td", { class: "c-num" }, F.money(e.v)),
            h("td", null, lean(e).join(" "))))))
        : h("p", { class: "fn-slot-n" }, S.alertsKind === "ok" ? "Nothing flagged in this read." : (S.alertsState && S.alertsState.reason) || "Reading the flagged windows."),
      h("p", { class: "fn-slot-n" }, "Lean is a convention: ask-side calls and bid-side puts count bullish."));
  }

  paintNetSlot();
  if (host.net && UI.defer) {
    UI.defer("net", { when: "visible", el: host.net, label: "The flow network" }).then(() => {
      const loaded = window.FlowsUI;
      if (!loaded || !loaded.net) return;
      net = loaded.net.mount(host.net, host.net.dataset.ambient === "1" ? { ambient: true } : {});
      if (net) net.take(S.alertsKind === "ok" ? S.alerts : null, S.alertsState);
    });
  }

  function takeAlerts(alerts, kind, reason, animate) {
    S.alerts = alerts;
    S.alertsKind = kind;
    S.alertKeys = null;
    if (kind === "ok") {
      S.alertKeys = new Map();
      for (const r of alerts.rows) { const key = joinKey(r.t, r.cp, r.k, r.exp); if (key) S.alertKeys.set(key, r); }
      S.alertsState = alerts.rows.length ? { state: "ok" }
        : { state: "quiet", reason: "The vendor's rules flagged nothing in this read. A read taken before the open, of a feed that fills intraday, is expected to be thin, and absence from the vendor's selection is not evidence of a quiet market." };
    } else {
      S.alertsState = {
        state: kind === "unpublished" ? "pending" : kind === "failed" ? "unavailable" : "withheld",
        reason,
      };
    }
    paintNetSlot();
    if (net) net.take(kind === "ok" ? alerts : null, S.alertsState);
    if (kind !== "ok" || !alerts.rows.length) {
      for (const el of [host.timeline, host.names, host.urgency]) silence(el, S.alertsState, el === host.timeline ? "Timeline" : el === host.names ? "Names" : "Urgency", el === host.timeline ? 250 : 200);
    } else {
      setModuleState(host.timeline, { state: "ok" }, "Timeline");
      paintAlertModules(animate);
    }
    paintChips();
    if (S.feedKind === "ok") later("feed", (b) => b.paintFeed());
    paintMeta();
    paintStatus();
    syncNote();
  }

  function takeFeed(payload, kind, reason) {
    S.payload = payload;
    S.feedKind = kind;
    S.feedKeys = null;
    if (kind === "ok") {
      S.feedKeys = new Set();
      for (const r of payload.contracts.rows) { const key = joinKey(r.t, r.cp, r.k, r.expiry); if (key) S.feedKeys.add(key); }
      S.feedState = payload.contracts.rows.length ? { state: "ok" }
        : { state: "quiet", reason: payload.status === "quiet"
          ? "No contract cleared both floors on the chains that were read. That is a statement about this run's chains, not about the market."
          : "This payload carries a contracts block with no rows in it, and did not report the read as quiet." };
      later("feed", (b) => b.paintFeed());
      if (!payload.contracts.rows.length) silence(host.feed, S.feedState, "Volume over OI", 220);
    } else {
      S.feedState = { state: kind === "unpublished" ? "pending" : kind === "absent" ? "unavailable" : kind === "failed" ? "unavailable" : "withheld", reason };
      silence(host.feed, S.feedState, "Volume over OI", 220);
      if (kind === "failed" || kind === "unpublished") {
        S.namesState = S.feedState;
        silence(host.surprise, S.feedState, "Surprise", 220);
      }
    }
    if (kind === "ok" || kind === "absent" || kind === "withheld") later("surprise", (b) => b.paintSurprise());
    if (S.alertsKind === "ok") paintAlertModules(false);
    paintMeta();
    paintStatus();
    syncNote();
  }

  const get = (url) => fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });

  function freshFrom(res, body, source) {
    const upd = Number(res.headers.get("X-Payload-Updated")) || null;
    const f = typeof UI.freshFrom === "function" ? UI.freshFrom(res) : null;
    if (f && f.session) UI.freshness({ ...f.forFreshness(), updatedAt: upd, generatedAt: body && typeof body.generatedAt === "string" ? body.generatedAt : undefined });
    else if (body && typeof body === "object") UI.freshness({ sessionDate: body.sessionDate, generatedAt: body.generatedAt, updatedAt: upd, source });
  }

  function loadAlerts() {
    return get("/api/flows/flowalerts").then((res) => {
      if (res.status === 401) { location.replace("/flows/"); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json().then((alerts) => {
        if (!alerts || typeof alerts !== "object") throw new Error("not a payload");
        freshFrom(res, alerts, "flowalerts");
        if (alerts.status === "pending") {
          takeAlerts(alerts, "unpublished", "The pipeline has not published this key yet. The alerts feed costs one market-wide call a run and appears with the first pipeline run after it shipped.");
          return;
        }
        if (!Array.isArray(alerts.rows)) {
          takeAlerts(alerts, "withheld", "This payload could not be read as an alerts feed: it carries no rows array. That is a gap in the payload, not a quiet market.");
          return;
        }
        takeAlerts(alerts, "ok", null);
      });
    }).catch((error) => {
      takeAlerts(null, "failed", "The alerts feed could not be loaded (" + (error && error.message ? error.message : "no message") + "). The counter feed is a separate payload and stands on its own.");
    });
  }

  function loadFeed() {
    return get("/api/flows/unusual").then((res) => {
      if (res.status === 401) { location.replace("/flows/"); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json().then((payload) => {
        if (!payload || typeof payload !== "object") throw new Error("not a payload");
        freshFrom(res, payload, "unusual");
        if (payload.status === "pending") {
          takeFeed(payload, "unpublished", "The pipeline has not published this key yet. This feed is built from the option chains the run already reads for each board name, so it appears with the first pipeline run after it shipped.");
          return;
        }
        const contracts = payload.contracts && typeof payload.contracts === "object" ? payload.contracts : null;
        if (!contracts) {
          takeFeed(payload, "absent", "Published, but this payload carries no contracts block, and no count of contracts, of names or of chains is taken from it. This is a gap in the payload and not a chain that cleared no floors.");
          return;
        }
        if (!Array.isArray(contracts.rows)) {
          takeFeed(payload, "withheld", "Published, but the contracts block on this payload carries no rows array, so it could not be read as a feed.");
          return;
        }
        takeFeed(payload, "ok", null);
      });
    }).catch((error) => {
      takeFeed(null, "failed", "The feed could not be loaded (" + (error && error.message ? error.message : "no message") + "). Nothing in it was measured; refresh to try again.");
    });
  }

  const SEP = "\u0000";
  const alertKey = (r) => (r && typeof r.t === "string" && r.t
    ? (typeof r.spanStart === "string" && r.spanStart ? "w" + SEP + r.t + SEP + (typeof r.oc === "string" ? r.oc : "") + SEP + r.spanStart
      : "u" + SEP + r.t + SEP + (typeof r.oc === "string" ? r.oc : "") + SEP + (typeof r.rule === "string" ? r.rule : "")) : null);
  const byPremium = (a, b) => (n(b.prem) ?? -Infinity) - (n(a.prem) ?? -Infinity) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  const ALERT_CAP = 180;

  function streamAlerts(rows, at) {
    const live = UI.rt.alerts();
    const base = S.alerts && Array.isArray(S.alerts.rows) ? S.alerts : null;
    const kept = base ? base.rows : [];
    const have = new Set(kept.map(alertKey));
    const stamp = new Date(at || Date.now()).toISOString();
    const add = [];
    for (const r of rows) {
      const row = Object.assign({}, r);
      delete row.id;
      delete row.ts;
      const key = alertKey(row);
      if (!key || have.has(key)) continue;
      have.add(key);
      add.push(Object.assign(row, { firstAt: stamp, lastAt: stamp, reads: 1 }));
    }
    if (!add.length) { if (live.dropped || live.truncated) paintMeta(); return; }
    const union = kept.concat(add).sort(byPremium);
    const next = Object.assign({}, base || { status: "ok", sessionDate: (UI.rt.fresh("fl") || {}).session || null }, {
      rows: union.slice(0, ALERT_CAP), seen: Math.max(n(base && base.seen) ?? kept.length, kept.length) + add.length,
      shed: Math.max(0, union.length - ALERT_CAP), status: "ok",
    });
    takeAlerts(next, "ok", null, false);
  }

  function streamFlow() {
    const rt = UI.rt && UI.rt.connect({ topics: ["fl"] });
    if (rt) rt.on("fl", (c) => streamAlerts(c.rows, c.at));
  }

  const flowKit = Object.freeze({
    S, host, charts, n, count, pct0, plural, instant, etOf, clock, hourLabel, cardKey, tickerHref, contractText, joinKey, passes,
    setModuleState, silence, def, vendorCeilingSaid,
    get attached() { return below.fns !== null; },
    attach(fns) {
      if (below.fns) return;
      below.fns = fns;
      for (const run of below.ask.values()) {
        try { run(fns); } catch (error) { statusEl.textContent = "The page could not finish drawing (" + (error && error.message ? error.message : "no message") + ")."; }
      }
      below.ask.clear();
    },
  });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { flowKit }));
  if (UI.defer) UI.defer("flow-below", { when: "visible", el: $("uaTimelineCard"), label: "The lower modules" });

  buildFilters();
  wireInfos();
  syncNote();
  Promise.all([loadAlerts(), loadFeed()]).then(() => {
    wireInfos();
    streamFlow();
    if (UI.rt && S.alertsKind === "ok") streamAlerts(UI.rt.alerts().rows, Date.now());
    if (typeof UI.heartbeat !== "function") return;
    UI.heartbeat({
      keys: ["alerts"], nightly: ["flowalerts", "unusual"], page: "unusual",
      onChange: (changed) => {
        if (changed.some((k) => k === "live:alerts" || k === "flowalerts")) loadAlerts().then(() => { if (UI.rt && S.alertsKind === "ok") streamAlerts(UI.rt.alerts().rows, Date.now()); });
        if (changed.indexOf("unusual") >= 0) loadFeed();
      },
    });
  });
})();
