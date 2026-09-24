(() => {
  "use strict";

  const UI = window.FlowsUI;
  const status = document.getElementById("plStatus");
  if (!UI || !status) return;
  const { h, F } = UI;
  const DASH = UI.DASH, MID = UI.MID;
  const FRESH = "•";
  const STATUTE = 45;
  const V = { class: "fu-v" }, HIDE = { "aria-hidden": "true" };

  const host = {
    meta: document.getElementById("plMeta"),
    about: document.getElementById("plAboutSlot"),
    chips: document.getElementById("plChips"),
    buyers: document.getElementById("plBuyers"),
    assets: document.getElementById("plAssets"),
    recent: document.getElementById("plRecent"),
    holders: document.getElementById("plHolders"),
  };

  const num = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string" || !v.trim()) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const usd = (v) => {
    const x = num(v);
    if (x === null) return DASH;
    const a = Math.abs(x), sign = x < 0 ? UI.MINUS : "";
    if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(0) + "K";
    return sign + "$" + a.toFixed(0);
  };
  const qty = (v) => (num(v) === null ? DASH : num(v).toLocaleString("en-US"));
  const lagText = (v) => (num(v) === null ? DASH : Math.round(num(v)) + "d");
  const cardKey = (t) => String(t === null || t === undefined ? "" : t).toUpperCase().replace(/[.\-\s]/g, "");
  const MEMBER = { house: "House", senate: "Senate", executive: "Executive" };

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

  function feedState(feed, measured) {
    if (!feed) {
      return { state: "pending", kind: "absent", reason: "This section has not been published yet. It appears with the first pipeline run after it shipped." };
    }
    if (feed.status === "unavailable") {
      return { state: "unavailable", kind: "unavailable", reason: "The vendor did not answer for this feed" + (feed.reason ? " (" + feed.reason + ")" : "") + ", so nothing is drawn. This is a fact about the request, not about what anyone disclosed." };
    }
    if (feed.status !== "ok" || !Array.isArray(feed.rows) || !feed.rows.length) {
      return { state: "quiet", kind: "quiet", reason: measured || "The window was read and held no filing this panel could rank." };
    }
    return null;
  }
  const silence = (hostEl, st, label, height) => {
    const box = UI.silent(st, label, height || 180);
    box.dataset.empty = st.kind || st.state;
    hostEl.replaceChildren(box);
    setModuleState(hostEl, st, label);
    return box;
  };

  function overlaps(rows) {
    let n = 0, comparable = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      const aLo = num(a.boughtLo), aHi = num(a.boughtHi), bLo = num(b.boughtLo), bHi = num(b.boughtHi);
      if (aLo === null || aHi === null || bLo === null || bHi === null) continue;
      comparable++;
      if (aLo <= bHi && bLo <= aHi) n++;
    }
    return { n, comparable };
  }
  function overlapNote(rows) {
    if (rows.length < 2) return "";
    const o = overlaps(rows);
    if (!o.comparable) return "No two neighbours here state both a low and a high, so whether this ordering is one the disclosed ranges can carry was not measured.";
    if (!o.n) return "No two of the " + o.comparable + " comparable neighbouring pairs have overlapping bands, so the order is one the disclosed ranges can carry.";
    return o.n + " of the " + o.comparable + " comparable neighbouring pairs have overlapping bands — their whiskers cross, and those pairs are not separated by anything the filings state. The bar is a midpoint; the whisker is what was actually disclosed.";
  }
  function openNote(rows, subject) {
    let bands = 0, floor = 0;
    for (const r of rows) { bands += num(r.openBands) || 0; floor += num(r.openFloor) || 0; }
    if (!bands) return "";
    return bands + " disclosure" + (bands === 1 ? "" : "s") + " here state" + (bands === 1 ? "s" : "") +
      " a floor and no ceiling (“Over $50,000,000” and its kind). Those have no midpoint to sum, so they are excluded from every total in this panel; the floors they do state add to " +
      usd(floor) + " of disclosed " + subject + " that no bar includes.";
  }
  function ownerNote(rows, unit) {
    let known = 0, self = 0, carried = false;
    for (const r of rows) {
      const k = num(r.ownerKnown);
      if (k === null) continue;
      carried = true;
      known += k;
      const sf = num(r.selfFiled);
      if (sf !== null) self += sf;
    }
    if (!carried) return "This payload does not carry the executing account behind these " + unit + ", so the share disclosed in a filer’s own name cannot be stated here. That is a gap in what was published, not a reading about the filings.";
    if (!known) return "The vendor stated an executing account on none of the filings behind these " + unit + ", so the share disclosed in a filer’s own name is UNKNOWN here — which is not the same fact as all of them being their own.";
    return self + " of the " + known + " filings that state an executing account are the filer’s own; the rest are a spouse’s, a dependant’s or joint.";
  }
  function freshNote(p, drawn, subject) {
    if (!p.latestFiled) return "";
    let when = "";
    if (p.sessionDate) {
      when = p.sessionDate === p.latestFiled ? ", which is the last completed session"
        : p.latestFiled < p.sessionDate ? ", which is before the last completed session on " + p.sessionDate
          : ", which is after the last completed session on " + p.sessionDate;
    }
    if (!drawn) return "The newest disclosure date in this window is " + p.latestFiled + when + ", and no row drawn here carries it, so nothing is marked new.";
    return FRESH + " marks the " + drawn + " row" + (drawn === 1 ? "" : "s") + " " + (subject || "filed on") + " " + p.latestFiled + ", the newest disclosure date in this window" + when + ".";
  }
  function listedNote(rows) {
    let other = 0, filings = 0;
    for (const r of rows) {
      const o = num(r.boughtOther), c = num(r.buysOther);
      if (o !== null) other += o;
      if (c !== null) filings += c;
    }
    if (!filings) return "";
    return filings + " of the disclosures behind these totals named no listed security (Treasury bills, funds and partnership interests carry no ticker), adding " + usd(other) + " that the ranking by name cannot show.";
  }
  function countedNote(feed, unit, cut) {
    const seen = num(feed.seen), shed = num(feed.shed);
    if (seen === null) return "";
    if (!shed) return seen + " " + unit + (seen === 1 ? "" : "s") + " in the window.";
    return "Top " + feed.rows.length + " of " + seen + " " + unit + "s in the window; " + shed + " " + (cut || "ranked below the cut") + " and are not drawn.";
  }

  function cardedSet(p) {
    if (!Array.isArray(p.carded)) return null;
    return new Set(p.carded.map(cardKey));
  }
  function tickerCell(t, carded) {
    const text = t === null || t === undefined ? DASH : String(t);
    if (!carded || !t || !carded.has(cardKey(t))) return h("span", { class: "pl-tick" }, text);
    return h("a", { class: "pl-tick", href: "/flows/ticker/?t=" + encodeURIComponent(cardKey(t)), title: "Open the detail card the board published for " + text + "." }, text);
  }

  function rangeBar(scale, mid, lo, hi, i) {
    const wrap = h("span", { class: "pl-bar", ...HIDE });
    const m = num(mid), l = num(lo), hh = num(hi);
    if (l !== null && hh !== null && hh > l && scale > 0) {
      wrap.append(h("i", { class: "pl-bar-band", style: { left: Math.min(100, (l / scale) * 100) + "%", width: Math.max(0.4, Math.min(100, ((hh - l) / scale) * 100)) + "%" } }));
    }
    if (m !== null && scale > 0) {
      wrap.append(h("i", { class: "pl-bar-fill", style: { width: Math.max(0.4, Math.min(100, (m / scale) * 100)) + "%", "--i": String(i || 0) } }));
    }
    return wrap;
  }
  const scaleOf = (rows) => rows.reduce((s, r) => Math.max(s, num(r.boughtHi) || 0, num(r.bought) || 0), 0);
  const lagCell = (v) => {
    const x = num(v);
    return h("span", { class: "fu-v pl-lagv", "data-tone": x !== null && x > STATUTE ? "warn" : null, title: x !== null && x > STATUTE ? "Past the 45 days the STOCK Act allows." : null }, lagText(v));
  };

  function paintBuyers(p) {
    const feed = p.buyers;
    const st = feedState(feed, "The window was read and no filer in it disclosed a purchase this panel could rank. Sales and transfers do not enter a purchase ranking.");
    if (st) { silence(host.buyers, st, "Buyers", 220); return; }
    setModuleState(host.buyers, { state: "ok" }, "Buyers");
    const rows = feed.rows;
    const scale = scaleOf(rows);
    const items = rows.map((r, j) => {
      const otherBuys = num(r.buysOther), nNames = num(r.names);
      const other = otherBuys
        ? { text: usd(r.boughtOther), title: otherBuys + " of this filer’s " + num(r.buys) + " disclosed purchases named no listed security — Treasury bills, funds and partnership interests carry no ticker — so that size is in the total and in no row of the ranking by name." }
        : { text: DASH, title: otherBuys === null ? "This payload does not split the total by whether a listed security was named." : "Every disclosed purchase behind this total named a listed security." };
      const names = nNames === null
        ? { text: DASH, title: "None of this filer’s disclosed purchases named a listed security, so there is no name count here. That is not a count of zero." }
        : { text: String(nNames), title: nNames + " listed names" };
      const row = h("div", { class: "pl-row pl-buyer", role: "listitem", "data-names": names.text, "data-other": other.text,
        title: [(r.who || DASH), "low " + usd(r.boughtLo) + ", high " + usd(r.boughtHi), (num(r.buys) ?? DASH) + " filings",
          "names " + names.text + ": " + names.title, "not listed " + other.text + ": " + other.title].join(" " + MID + " ") },
      h("span", { class: "pl-rank" }, String(j + 1)),
      h("span", { class: "pl-who" },
        h("span", { class: "pl-who-l" }, num(r.freshBuys) ? h("span", { class: "pl-fresh", title: num(r.freshBuys) + " of these purchases were disclosed on the window’s newest filing date." }, FRESH) : null,
          h("b", { class: "pl-name" }, r.who || DASH)),
        h("small", { class: "pl-chamber" }, MEMBER[r.memberType] || (r.memberType ? String(r.memberType) : ""))),
      rangeBar(scale, r.bought, r.boughtLo, r.boughtHi, j),
      h("span", { class: "fu-v fu-strong pl-mid" }, usd(r.bought)),
      lagCell(r.medianLagDays),
      h("span", { class: "fu-v fu-wide pl-sold", title: "Disclosed sales, shown beside the purchases and never folded into them." }, num(r.sells) ? usd(r.sold) : DASH));
      return row;
    });
    host.buyers.replaceChildren(
      h("div", { class: "pl-row pl-buyer fu-head", ...HIDE }, h("span"), h("span", null, "Filer"), h("span", null, "Disclosed purchases"), h("span", V, "Mid"), h("span", V, "Lag"), h("span", { class: "fu-v fu-wide" }, "Sold")),
      listed(UI.list(items, { visible: 8, label: "Filers ranked by disclosed purchase size" })),
      UI.legend([h("span", { class: "ui-key" }, h("i", { class: "pl-key-fill" }), "Midpoint"), h("span", { class: "ui-key" }, h("i", { class: "pl-key-band" }), "Disclosed range"), h("span", { class: "ui-key" }, h("i", { class: "is-dot", style: { "--c": UI.cssVar("--warn") } }), "Late")]));
  }
  const listed = (el) => { (el.classList.contains("ui-list") ? [el] : [...el.querySelectorAll(".ui-list")]).forEach((l) => l.classList.add("fu-list")); return el; };

  function buyersNote(p) {
    const feed = p.buyers;
    if (!feed || !Array.isArray(feed.rows) || !feed.rows.length) return "";
    const rows = feed.rows;
    return [countedNote(feed, "filer"), overlapNote(rows), openNote(rows, "purchases"), listedNote(rows), ownerNote(rows, "totals"),
      freshNote(p, rows.filter((r) => num(r.freshBuys)).length, "carrying a purchase disclosed on")].filter(Boolean).join(" ");
  }

  function paintAssets(p, mode) {
    const carded = cardedSet(p);
    const size = p.assets, breadth = p.clusters;
    const body = h("div", { class: "fd-body" });
    if (mode === 1) body.append(breadthView(p, breadth, carded));
    else {
      const st = feedState(size, "The window was read and no name in it drew a disclosed purchase.");
      if (st) {
        const box = UI.silent(st, "Names by size", 200);
        box.dataset.empty = st.kind;
        body.append(box);
      } else {
        const scale = scaleOf(size.rows);
        const items = size.rows.map((r, j) => h(carded && r.t && carded.has(cardKey(r.t)) ? "a" : "div", {
          class: "pl-row pl-asset-row", role: carded && r.t && carded.has(cardKey(r.t)) ? null : "listitem",
          href: carded && r.t && carded.has(cardKey(r.t)) ? "/flows/ticker/?t=" + encodeURIComponent(cardKey(r.t)) : null,
          title: String(r.t || r.asset || DASH) + " " + MID + " low " + usd(r.boughtLo) + ", high " + usd(r.boughtHi) + " " + MID + " " + (num(r.buys) ?? DASH) + " filings" + (num(r.sells) ? " " + MID + " sold " + usd(r.sold) : ""),
        },
        h("span", { class: "pl-who" }, h("span", { class: "pl-who-l" }, num(r.freshBuys) ? h("span", { class: "pl-fresh" }, FRESH) : null, h("b", { class: "pl-tick" }, String(r.t || DASH))),
          r.asset ? h("small", { class: "pl-asset" }, String(r.asset)) : null),
        rangeBar(scale, r.bought, r.boughtLo, r.boughtHi, j),
        h("span", { class: "fu-v fu-strong pl-mid" }, usd(r.bought)),
        h("span", V, num(r.filers) === null ? DASH : String(num(r.filers)))));
        body.append(
          h("div", { class: "pl-row pl-asset-row fu-head", ...HIDE }, h("span", null, "Name"), h("span", null, "Disclosed purchases"), h("span", V, "Mid"), h("span", V, "Filers")),
          listed(UI.list(items, { visible: 8, label: "Names ranked by disclosed purchase size" })));
      }
    }
    return body;
  }

  function breadthView(p, feed, carded) {
    if (!feed) {
      const box = UI.silent({ state: "pending", reason: "This section has not been published yet." }, "Names by breadth", 200);
      box.dataset.empty = "absent";
      return h("div", { class: "pl-clusters" }, box);
    }
    if (feed.status === "unavailable") {
      const box = UI.silent({ state: "unavailable", reason: "The vendor did not answer for this feed" + (feed.reason ? " (" + feed.reason + ")" : "") + ", so nothing is ordered here." }, "Names by breadth", 200);
      box.dataset.empty = "unavailable";
      return h("div", { class: "pl-clusters" }, box);
    }
    const rows = Array.isArray(feed.rows) ? feed.rows : [];
    if (!rows.length) {
      const floor = num(feed.minFilers);
      const box = UI.silent({ state: "quiet", reason: floor === null
        ? "No name in this window drew disclosed purchases from enough separate filers to clear the floor. This payload does not state what that floor was, so the emptiness cannot be read against it here."
        : "No name in this window drew disclosed purchases from " + floor + " or more separate filers" + (num(feed.namesSeen) ? ", across the " + feed.namesSeen + " names that drew any" : "") + ". The floor is not relaxed to fill the panel." }, "Names by breadth", 200);
      box.dataset.empty = "quiet";
      return h("div", { class: "pl-clusters" }, box);
    }
    const maxF = Math.max(1, ...rows.map((r) => num(r.filers) || 0));
    const items = rows.map((r) => {
      const f = num(r.filers) || 0;
      const linked = carded && r.t && carded.has(cardKey(r.t));
      return h(linked ? "a" : "div", { class: "pl-row pl-cluster", role: linked ? null : "listitem", href: linked ? "/flows/ticker/?t=" + encodeURIComponent(cardKey(r.t)) : null,
        title: String(r.t || DASH) + " " + MID + " " + f + " distinct filers " + MID + " median lag " + lagText(r.medianLagDays) + " " + MID + " midpoint " + usd(r.bought) },
      h("span", { class: "pl-who" }, h("span", { class: "pl-who-l" }, num(r.freshBuys) ? h("span", { class: "pl-fresh" }, FRESH) : null, h("b", { class: "pl-tick" }, String(r.t || DASH))),
        r.asset ? h("small", { class: "pl-asset" }, String(r.asset)) : null),
      h("span", { class: "pl-dots", ...HIDE }, Array.from({ length: Math.min(f, 12) }, () => h("i")), f > 12 ? h("b", null, "+") : null, h("span", { class: "pl-dots-rest", style: { "--n": String(Math.max(0, maxF - f)) } })),
      h("span", { class: "fu-v fu-strong pl-filers" }, String(f)),
      h("span", { class: "fu-v pl-mid" }, usd(r.bought)));
    });
    return h("div", { class: "pl-clusters" },
      h("div", { class: "pl-row pl-cluster fu-head", ...HIDE }, h("span", null, "Name"), h("span", null, "Distinct filers"), h("span", V, "Filers"), h("span", V, "Mid")),
      listed(UI.list(items, { visible: 8, label: "Names ordered by the number of separate filers" })));
  }

  function clustersNote(feed) {
    if (!feed || feed.status !== "ok" || !Array.isArray(feed.rows) || !feed.rows.length) return "";
    const floor = num(feed.minFilers), cleared = num(feed.seen), pool = num(feed.namesSeen);
    return (num(feed.shed) || pool === null || cleared === null ? countedNote(feed, "name", "drew fewer filers") : cleared + " of the " + pool + " names in the window clear" + (cleared === 1 ? "s" : "") + " the floor.") + " " +
      (floor === null ? "This payload does not state the floor these rows cleared, so the ordering is drawn without it. "
        : "The floor is " + floor + " separate filers, stated rather than tuned" + (floor === 2 ? ": two is the smallest number that could be called convergence at all. " : ", above the two that coincidence alone supplies on a market-wide window. ")) +
      "Nothing here blends breadth with size into a single figure — each key breaks ties in the one before it, so the order can be checked by eye against the columns.";
  }

  let assetsMode = 0;
  function mountAssets(p) {
    const card = host.assets.closest(".fd-mod");
    const head = card.querySelector(".ui-mod-h");
    if (!head.querySelector(".ui-seg")) {
      const seg = UI.segmented("Rank names by", [{ label: "Size" }, { label: "Breadth" }], (i) => {
        assetsMode = i;
        host.assets.replaceChildren(...paintAssets(p, i).childNodes);
      }, 0);
      const info = head.querySelector(".ui-info");
      head.insertBefore(seg, info || null);
    }
    host.assets.replaceChildren(...paintAssets(p, assetsMode).childNodes);
    const sizeSt = feedState(p.assets, "The window was read and no name in it drew a disclosed purchase.");
    const breadthSt = !p.clusters ? { state: "pending", reason: "This section has not been published yet." }
      : p.clusters.status === "unavailable" ? { state: "unavailable", reason: "The vendor did not answer for the breadth feed." }
        : Array.isArray(p.clusters.rows) && p.clusters.rows.length ? null : { state: "quiet", reason: "No name cleared the breadth floor." };
    setModuleState(host.assets, UI.partial([{ name: "Size", st: sizeSt || { state: "ok" } }, { name: "Breadth", st: breadthSt || { state: "ok" } }]), "Names");
  }

  function paintRecent(p) {
    const feed = p.recent;
    const st = feedState(feed, "The window was read and held no disclosure with a filing date.");
    if (st) { silence(host.recent, st, "Newest", 220); return; }
    setModuleState(host.recent, { state: "ok" }, "Newest");
    const carded = cardedSet(p);
    const rows = feed.rows;
    const maxLag = Math.max(90, Math.ceil(Math.max(...rows.map((r) => num(r.lagDays) || 0)) / 15) * 15);
    const mark = (STATUTE / maxLag) * 100;
    const items = rows.map((r, i) => {
      const lag = num(r.lagDays);
      const late = lag !== null && lag > STATUTE;
      const fresh = p.latestFiled && r.filedDate === p.latestFiled;
      const side = r.side === "buy" ? "is-buy" : r.side === "sell" ? "is-sell" : "is-neither";
      const owner = r.executedBy === null || r.executedBy === undefined ? null : String(r.executedBy);
      return h("div", { class: "pl-row pl-recent", role: "listitem",
        title: (r.who || DASH) + " " + MID + " transacted " + (r.txnDate || DASH) + ", filed " + (r.filedDate || DASH) + (r.notes ? " " + MID + " " + r.notes : "") },
      h("span", { class: "pl-filed" }, fresh ? h("span", { class: "pl-fresh", title: "Filed on " + p.latestFiled + ", the newest disclosure date in this window." }, FRESH) : null, h("b", { "data-date": r.filedDate || "" }, F.day(r.filedDate))),
      h("span", { class: "pl-who" }, h("b", { class: "pl-name" }, r.who || DASH),
        h("small", { class: "pl-owner" + (owner ? "" : " is-unknown") }, owner || "not stated")),
      r.t ? h("span", { class: "pl-who pl-what" }, tickerCell(r.t, carded), (r.asset || r.notes) ? h("small", { class: "pl-asset" }, String(r.asset || r.notes)) : null)
        : h("span", { class: "pl-who pl-what" }, h("span", { class: "pl-asset pl-untick" }, String(r.asset || r.notes || DASH))),
      h("span", { class: "pl-side " + side }, r.txnType || DASH),
      h("span", { class: "fu-v pl-band fu-wide" }, bandText(r)),
      h("span", { class: "pl-lag", ...HIDE, style: { "--mark": mark.toFixed(2) + "%" } },
        lag === null ? null : h("i", { class: "pl-lag-a", style: { width: (Math.min(lag, STATUTE) / maxLag * 100).toFixed(2) + "%", "--i": String(i) } }),
        late ? h("i", { class: "pl-lag-b", style: { left: mark.toFixed(2) + "%", width: ((Math.min(lag, maxLag) - STATUTE) / maxLag * 100).toFixed(2) + "%", "--i": String(i) } }) : null),
      h("span", { class: "fu-v pl-lagv" + (late ? " pl-late" : ""), "data-tone": late ? "warn" : null, title: late ? "Past the 45 days the STOCK Act allows." : null }, lagText(r.lagDays)));
    });
    host.recent.replaceChildren(
      h("div", { class: "pl-row pl-recent fu-head", ...HIDE }, h("span", null, "Filed"), h("span", null, "Filer"), h("span", null, "Name"), h("span", null, "Side"), h("span", { class: "fu-v fu-wide" }, "Range"),
        h("span", { class: "pl-lag-axis", style: { "--mark": mark.toFixed(2) + "%" } }, h("span", null, "Trade"), h("span", { class: "pl-lag-45" }, "45d"), h("span", null, maxLag + "d")), h("span", V, "Lag")),
      listed(UI.list(items, { visible: 10, label: "Most recent disclosures" })),
      UI.legend([h("span", { class: "ui-key" }, h("i", { class: "pl-key-lag" }), "Days from trade to filing"), h("span", { class: "ui-key" }, h("i", { class: "is-dot", style: { "--c": UI.cssVar("--warn") } }), "Past 45 days")]));
  }

  function bandText(r) {
    const lo = num(r.lo), hi = num(r.hi);
    if (lo !== null && hi !== null) return usd(lo) + "–" + usd(hi);
    if (lo !== null) return "over " + usd(lo);
    if (num(r.mid) !== null) return usd(r.mid);
    return DASH;
  }

  function recentNote(p) {
    const feed = p.recent;
    if (!feed || !Array.isArray(feed.rows) || !feed.rows.length) return "";
    let late = 0, dated = 0, fresh = 0;
    for (const r of feed.rows) {
      if (num(r.lagDays) !== null) { dated++; if (r.lagDays > STATUTE) late++; }
      if (p.latestFiled && r.filedDate === p.latestFiled) fresh++;
    }
    return [countedNote(feed, "disclosure", "were filed earlier"),
      dated ? late + " of the " + dated + " shown were filed past the 45 days the STOCK Act allows, which is the ordinary case rather than the exception." : "",
      freshNote(p, fresh)].filter(Boolean).join(" ");
  }

  function holdersShown(on) {
    const card = document.getElementById("plHoldersCard");
    if (card) card.hidden = !on;
  }

  function paintHolders(p) {
    const feed = p.holders;
    const st = feedState(feed, "The feed answered and named no holder in the board’s names.");
    holdersShown(!(st && st.kind === "unavailable" && /HTTP 4(?!08|29)\d\d/.test(String(feed.reason))));
    if (st) { silence(host.holders, st, "Holdings", 120); return; }
    setModuleState(host.holders, { state: "ok" }, "Holdings");
    const maxQ = Math.max(1, ...feed.rows.map((r) => num(r.maxQty) || 0));
    const items = feed.rows.map((r) => {
      const lo = num(r.minQty), hi = num(r.maxQty);
      return h("div", { class: "pl-row pl-holder", role: "listitem" },
        h("span", { class: "pl-who" }, h("b", { class: "pl-name" }, r.who || DASH), h("small", { class: "pl-owner" + (r.owner === null || r.owner === undefined ? " is-unknown" : "") }, r.owner === null || r.owner === undefined ? "not stated" : String(r.owner))),
        h("b", { class: "pl-tick" }, String(r.t || DASH)),
        h("span", { class: "pl-bar", ...HIDE }, lo !== null && hi !== null ? h("i", { class: "pl-bar-band", style: { left: (lo / maxQ * 100).toFixed(2) + "%", width: Math.max(0.4, (hi - lo) / maxQ * 100).toFixed(2) + "%" } }) : null),
        h("span", { class: "fu-v pl-q" }, qty(r.minQty) + "–" + qty(r.maxQty)),
        h("span", { class: "fu-v fu-strong pl-q" }, qty(r.midQty)));
    });
    host.holders.replaceChildren(
      h("div", { class: "pl-row pl-holder fu-head", ...HIDE }, h("span", null, "Holder"), h("span", null, "Name"), h("span", null, "Range"), h("span", V, "Low–high"), h("span", V, "Mid")),
      listed(UI.list(items, { visible: 8, label: "Politician portfolio holders" })));
  }

  function holdersNote(p) {
    const feed = p.holders;
    if (!feed || feed.status !== "ok") return { lead: null, notes: [] };
    const known = num(feed.ownerKnown), self = num(feed.selfFiled);
    return {
      lead: "Holdings by politician in the names the board went deep on. The figures are a " + String(feed.qtyUnit || "quantity the vendor does not define").replace(/\.?$/, ".") + " They are not summed with, or ranked against, the dollar bands above.",
      notes: [countedNote(feed, "holding", "hold less by the vendor's own midpoint"),
        known ? self + " of the " + known + " holdings with a stated account are the filer’s own; the rest are a spouse’s, a dependant’s or joint."
          : "The vendor stated an account owner on none of these rows, so the share held in a filer’s own name is UNKNOWN here — which is not the same fact as all of them being their own."],
    };
  }

  function idle(st, hh) {
    holdersShown(true);
    for (const [el, label] of [[host.buyers, "Buyers"], [host.assets, "Names"], [host.recent, "Newest"], [host.holders, "Holdings"]]) silence(el, st, label, label === "Holdings" ? 160 : hh);
    host.chips.replaceChildren(UI.chips(["Disclosures", "Newest", "Buyers", "Names", "Late"].map((label) =>
      UI.gaugeChip({ g: UI.iconChip((UI.STATES[st.state] || UI.STATES.unavailable).g, "--label-3"), value: DASH, label, info: { title: label, state: st.state, lead: st.reason } })), "Disclosure window"));
  }

  function paintChips(p) {
    const recent = p.recent && Array.isArray(p.recent.rows) ? p.recent.rows : [];
    let late = 0, dated = 0;
    for (const r of recent) if (num(r.lagDays) !== null) { dated++; if (r.lagDays > STATUTE) late++; }
    const filings = num(p.filings);
    host.chips.replaceChildren(UI.chips([
      UI.gaugeChip({ icon: "hall", color: "--accent-ink", value: filings === null ? DASH : filings.toLocaleString("en-US"), label: "Disclosures",
        info: { title: "Disclosures", lead: "Statutory filings in the window.", facts: [["Window", p.window && p.window.from ? p.window.from + " to " + (p.window.to || "") : null]] } }),
      UI.gaugeChip({ icon: "live", color: "--up", value: num(p.freshFilings) === null ? DASH : String(num(p.freshFilings)), label: p.latestFiled ? "Filed " + F.day(p.latestFiled) : "Newest",
        info: { title: "Newest filings", lead: p.latestFiled ? "Disclosures filed on " + p.latestFiled + ", the newest filing date in the window." : "The payload carries no newest filing date." } }),
      UI.gaugeChip({ icon: "long", color: "--up", value: p.buyers && num(p.buyers.seen) !== null ? String(num(p.buyers.seen)) : DASH, label: "Buyers",
        info: { title: "Buyers", lead: "Filers who disclosed at least one purchase in the window." } }),
      UI.gaugeChip({ icon: "list", color: "--label-2", value: p.assets && num(p.assets.seen) !== null ? String(num(p.assets.seen)) : DASH, label: "Names",
        info: { title: "Names", lead: "Listed names that drew at least one disclosed purchase." } }),
      UI.gaugeChip({ ring: dated ? late / dated : null, color: "--warn", value: dated ? Math.round((late / dated) * 100) + "%" : DASH, label: "Late",
        info: { title: "Late filings", lead: "Share of the newest disclosures filed past the 45 days the STOCK Act allows." } }),
    ], "Disclosure window"));
  }

  function paintMeta(p) {
    const w = p.window || {}, src = p.source || {};
    const bits = [];
    if (w.from && w.to) bits.push(F.day(w.from) + " – " + F.day(w.to));
    if (num(w.days) !== null) bits.push(num(w.days) + " days");
    let warnText = null;
    if (src.paginated === false) warnText = "The vendor returned the same page twice, so only the first was kept: this window is one page deep rather than the " + (src.pages || 1) + " it asked for. The ranking is over that narrower population.";
    if (src.windowed === false) warnText = "The windowed route refused, so this page is the most recent disclosures the vendor will return in one call, with no date range. The ranking is over that selection rather than over the window named above.";
    const pill = h("button", { class: "fd-pill", type: "button", id: "plSource", hidden: warnText ? null : true,
      "aria-haspopup": "dialog", "aria-controls": "fxPop", "data-info": UI.info(() => ({ title: "A narrower read", state: "quiet", lead: warnText })) }, UI.glyph("stack"), "Partial read");
    host.meta.replaceChildren(...bits.flatMap((b, i) => (i ? [h("span", { ...HIDE }, MID), h("span", null, b)] : [h("span", null, b)])), pill);
  }

  function paintStatus(p) {
    const w = p.window || {}, src = p.source || {};
    const pages = num(src.pages);
    const how = src.route ? "via " + src.route + (pages !== null ? ", " + pages + " page" + (pages === 1 ? "" : "s") + " deep" : "") : "";
    const freshCount = num(p.freshFilings), filings = num(p.filings);
    const filedWhen = w.from ? " filed between " + w.from + " and " + (w.to || "today") : "";
    const read = Date.parse(String(p.readAt || ""));
    status.textContent = [
      filings === null ? (filedWhen ? "Disclosures" + filedWhen : "") : filings + " disclosure" + (filings === 1 ? "" : "s") + filedWhen,
      freshCount !== null && p.latestFiled ? freshCount + " of them on " + p.latestFiled + ", the newest filing date here" : "",
      how,
      num(p.unusable) ? num(p.unusable) + " carried no filer or name and were dropped" : "",
      Number.isFinite(read) ? "read " + new Date(read).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "",
    ].filter(Boolean).join(" · ");
  }

  let P = null;
  function wireInfos() {
    const notes = () => (P && P.notes) || {};
    if (host.about && !host.about.firstChild) {
      const src = document.getElementById("plAbout");
      host.about.append(UI.infoButton("this page", () => ({
        title: "Political",
        lead: P ? status.textContent : null,
        sections: [
          { title: "What a row is", lines: [notes().unit, notes().lag] },
          { title: "Size and breadth", lines: [notes().size, notes().listed, notes().breadth] },
          { title: "New and attributed", lines: [notes().fresh, notes().attribution] },
          { title: "Refused", lines: [notes().refusals] },
        ],
        node: src ? h("div", { class: "fd-about-pop" }, [...src.children].map((x) => x.cloneNode(true))) : null,
      })));
    }
    setModuleInfo(host.buyers, "buyers", () => ({
      title: "Buyers",
      lead: "Filers ranked by the summed midpoint of their disclosed purchases. The bar is that midpoint on one axis shared by every row; the pale band across it runs from the summed low to the summed high of the same filings. Lag is the median days from trade to filing.",
      notes: [P ? buyersNote(P) : null, P && P.buyers && P.buyers.basis ? String(P.buyers.basis) : null],
    }));
    setModuleInfo(host.assets, "names", () => ({
      title: "Names",
      lead: "Size ranks names by the summed midpoint of disclosed purchases across every filer. Breadth orders them by how many distinct filers disclosed a purchase, then by median lag, then by size.",
      sections: [
        { title: "Size", lines: [P && P.assets && Array.isArray(P.assets.rows) ? [countedNote(P.assets, "name"), overlapNote(P.assets.rows), openNote(P.assets.rows, "purchases"), ownerNote(P.assets.rows, "names"), freshNote(P, P.assets.rows.filter((r) => num(r.freshBuys)).length, "carrying a purchase disclosed on")].filter(Boolean).join(" ") : null] },
        { title: "Breadth", lines: [P && P.clusters ? clustersNote(P.clusters) : null, P && P.clusters && P.clusters.basis ? String(P.clusters.basis) : null, "Size is the weakest thing this data knows: one account’s large purchase of a single name outranks several separate filers converging on another wherever dollars decide the order."] },
        { title: "Links", lines: [P && Array.isArray(P.carded) ? "A name is a link where the board published a detail card for it and plain text where it did not; the list of carded names comes from the payload." : "Names are plain text: this payload carries no list of the names a detail card exists for."] },
      ],
    }));
    setModuleInfo(host.recent, "the newest disclosures", () => ({
      title: "Newest",
      lead: "Newest disclosure first, not newest transaction: the filing is what changed. The bar runs from the trade to its filing; the part past the 45-day mark is late under the STOCK Act.",
      notes: [P ? recentNote(P) : null, "The side is the filing's own word: a gift or a receipt is neither a purchase nor a sale."],
    }));
    setModuleInfo(host.holders, "holdings", () => {
      const hn = P ? holdersNote(P) : { lead: null, notes: [] };
      return { title: "Holdings", lead: hn.lead || "Holdings by politician in the names the board went deep on, when the vendor answers for them.", notes: hn.notes };
    });
  }

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } }).then((r) => {
      if (r.status === 401) { location.replace("/flows/"); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const at = Number(r.headers.get("X-Payload-Updated"));
      return r.json().then((body) => {
        if (body && typeof body === "object") body.__updatedAt = at > 0 ? at : null;
        return body;
      });
    });
  }

  wireInfos();
  get("/api/flows/political").then((p) => {
    if (!p) return;
    UI.freshness({ sessionDate: p.sessionDate, generatedAt: p.generatedAt, updatedAt: p.__updatedAt, source: "political" });
    if (p.status === "pending" || (!p.buyers && !p.holders)) {
      status.textContent = "No disclosure window has been read yet. This page appears with the first pipeline run after it shipped.";
      status.dataset.empty = "pending";
      idle({ state: "pending", kind: "pending", reason: status.textContent }, 220);
      return;
    }
    P = p;
    paintStatus(p);
    paintMeta(p);
    paintChips(p);
    paintBuyers(p);
    mountAssets(p);
    paintRecent(p);
    paintHolders(p);
    wireInfos();
  }).catch((error) => {
    status.textContent = "The disclosure window could not be loaded: " + error.message;
    status.dataset.empty = "unavailable";
    idle({ state: "unavailable", kind: "unavailable", reason: status.textContent }, 200);
  });
})();
