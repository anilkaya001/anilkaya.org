(() => {
  "use strict";

  const UI = window.FlowsUI;
  const kit = UI && UI.marketKit;
  if (!kit) return;
  const { h, F, isNum, DASH, MINUS } = UI;
  const C = UI.chart;
  const {
    $, LENS, getLive, cap1, capLine, clear, clock, count, emptyLine, feedSilence, gap, grouped, infoInto, inlineHush, newGate, newer, nums, okFeed, pct, pendingLine, pendingOf, rowState, signGlyph, signed, signedGrouped, staleMark, table, tb, timeAxis, toneOf, track, unreadable, unreadableLine, usd, usdS,
  } = kit;

  const SECTOR_SHORT = { "Information Technology": "Technology", "Communication Services": "Communication",
    "Consumer Discretionary": "Discretionary", "Consumer Staples": "Staples" };

  const NARROW = { "Communication Services": "Comms", "consumer cyclical": "Cyclicals", "financial services": "Financials" };

  function sectorBp(r) {
    return isNum(r && r.trixBp);
  }

  function paintSectors(sectors) {
    const host = clear("mktSectors");
    if (!host) return;
    const entries = sectors && Array.isArray(sectors.sectors) ? sectors.sectors.slice() : [];
    host.dataset.lead = "";
    host.dataset.qual = "";
    host.dataset.note = "";
    if (unreadable(sectors)) { host.append(unreadableLine(sectors, "sector momentum (/api/flows/sectors)")); return; }
    if (!sectors || sectors.status === "pending") {
      host.append(pendingLine("sector momentum", "It appears with the next pipeline run."));
      return;
    }
    if (!entries.length) {
      host.append(emptyLine("unavailable", "This payload carried no sector readings, so the page cannot say whether any " +
        "sector settled. That is a gap in the payload rather than a fact about the market.", "sector momentum"));
      return;
    }
    const measured = entries.filter((r) => sectorBp(r) !== null);
    const scoreOnly = entries.filter((r) => sectorBp(r) === null && isNum(r && r.trix) !== null).length;
    if (!measured.length) {
      const why = entries.filter((r) => r && r.reason).map((r) => r.reason)[0];
      host.append(emptyLine("quiet", "No sector carried enough history to settle a TRIX reading this session" +
        (why ? " (" + why + ")." : "."), "sector momentum"));
      return;
    }
    const scaling = (sectors && sectors.scaling) || {};
    const published = isNum(scaling.fullScaleBp);
    const fixedAxis = published !== null && published > 0;
    const axis = fixedAxis ? published : (measured.reduce((a, r) => Math.max(a, Math.abs(sectorBp(r))), 0) || 1);
    measured.sort((a, b) => sectorBp(b) - sectorBp(a));
    let railed = 0;
    const key = (r) => {
      const name = r.sector || r.etf || DASH;
      return h("span", { class: "mk-sector-k", title: name, "data-short": NARROW[name] || null },
        h("span", { class: "mk-k-full" }, SECTOR_SHORT[name] || name), r.etf && r.etf !== name ? h("small", { class: "mk-sector-etf" }, r.etf) : null);
    };
    const spoken = (r) => { const name = r.sector || r.etf || DASH; return name + (r.etf && r.etf !== name ? " (" + r.etf + ")" : ""); };
    const list = h("ul", { class: "mk-sectors" });
    measured.forEach((r) => {
      const bp = sectorBp(r);
      if (Math.abs(bp) > axis) railed++;
      const tr = track(bp, axis);
      tr.setAttribute("role", "img");
      tr.setAttribute("aria-label", spoken(r) + " " + signed(bp, 2) + " basis points per session, " +
        (bp < 0 ? "left of" : bp > 0 ? "right of" : "at") + " the zero rule.");
      list.append(h("li", { class: "mk-sector" }, key(r), tr, h("span", { class: "mk-sector-v", "data-tone": toneOf(bp) }, signed(bp, 2) + " bp")));
    });
    entries.forEach((r) => {
      if (!r || sectorBp(r) !== null || isNum(r.trix) !== null) return;
      list.append(h("li", { class: "mk-sector is-unsettled" }, key(r),
        h("span", { class: "mk-unset" }, DASH, inlineHush("unavailable", "not settled — " + (r.reason || "the payload gives no reason"), spoken(r)))));
    });
    host.append(list);
    const unmeasured = entries.length - measured.length - scoreOnly;
    const caveats = [];
    if (fixedAxis) {
      caveats.push("The axis is the payload's own published band, " + MINUS + axis + " to +" + axis +
        " bp, which is the same band every session: a bar can be read against another sector and against this sector last week.");
      if (railed) {
        caveats.push(railed + " sector" + (railed === 1 ? " sits" : "s sit") + " beyond that band and " +
          (railed === 1 ? "is" : "are") + " drawn at full width; the number beside " + (railed === 1 ? "it" : "them") +
          " is the true reading, not the rail.");
      }
    } else {
      caveats.push("This payload published no full-scale band, so the axis is scaled to the widest reading of this " +
        "session only — it compares sectors with each other and never with another day.");
    }
    if (sectors.basis) caveats.push("Basis: " + sectors.basis + ".");
    if (unmeasured > 0) {
      caveats.push(unmeasured + " of " + entries.length + " sector" + (entries.length === 1 ? "" : "s") +
        " had too little history to settle and " + (unmeasured === 1 ? "is" : "are") +
        " listed without a bar, with the payload's own reason beside the name, rather than drawn at zero.");
    }
    if (scoreOnly > 0) {
      caveats.push(scoreOnly + " sector" + (scoreOnly === 1 ? "" : "s") + " published a clamp score with no raw reading " +
        "beside it and cannot be drawn signed; that is a payload defect rather than a quiet sector.");
    }
    host.dataset.lead = measured.length + " of " + entries.length + " sector" + (entries.length === 1 ? "" : "s") + " settled a reading.";
    host.dataset.qual = caveats.join(" ");
    host.dataset.note = "TRIX in basis points per session: triple-smoothed momentum on each sector ETF's log closes, a trend rather than a level. " +
      "Sign is carried by position and by the glyph on the number, not by colour alone.";
  }

  function roomH(el, dflt, min, below) {
    const body = el.closest(".mk-body");
    if (!body || !body.clientHeight) return dflt;
    const top = el.getBoundingClientRect().top;
    return Math.max(min, Math.min(dflt, Math.floor(body.getBoundingClientRect().bottom - top - below)));
  }

  function moverList(title, rows, key, opts) {
    const o = opts || {};
    const said = o.said || title.toLowerCase();
    const box = h("div", { class: "mk-movers-col", "aria-label": cap1(said) });
    const head = h("h3", { class: "mk-movers-h", title: cap1(said) }, title);
    box.append(head);
    if (!Array.isArray(rows)) {
      box.append(emptyLine("unavailable", "This payload published no ranking for " + said +
        ", so this column was never measured. It is not a statement that no name qualified.", said, 64));
      return box;
    }
    if (!rows.length) {
      box.append(emptyLine("quiet", "The ranking for " + said + " was taken and came back with no name in it — a fact about the session.", said, 64));
      return box;
    }
    const shown = rows.slice(0, o.max || 8);
    head.append(h("span", { class: "mk-movers-n" }, " · " + shown.length + " of " + rows.length));
    const top = Math.max(...shown.map((r) => Math.abs(isNum(key === "chg" ? r.chg : r.netPrem) || 0)), 1e-12);
    box.append(h("ul", { class: "mk-movers" }, shown.map((r) => {
      const v = isNum(key === "chg" ? r.chg : r.netPrem);
      return h("li", null,
        h("span", { class: "mk-mv-t" }, o.label ? o.label(r) : r.t || DASH),
        h("span", { class: "mk-mv-m", "aria-hidden": "true" }, h("i", { "data-tone": toneOf(v), style: { width: (v === null ? 0 : Math.abs(v) / top * 100) + "%" } })),
        h("span", { class: "mk-mv-v", "data-tone": toneOf(v) }, key === "chg" ? (v === null ? DASH : signed(v * 100, 2) + "%") : usd(v)));
    })));
    return box;
  }

  const IV_EVENT = 21;
  const IV_APART = "Earnings within 21 sessions: event not separated.";
  const IV_GRADE = "From 30-day IV; no surface.";
  const ivDays = (chg, iv) => (chg === null || iv === null || !(iv > 0) ? null : chg / (iv / Math.sqrt(252)));

  function uniRows(u) {
    const col = (k) => { const c = u.cols && u.cols[k], sc = u.units && u.units[k] && isNum(u.units[k][1]); return Array.isArray(c) && sc ? c.map((x) => (isNum(x) === null ? null : x / sc)) : null; };
    const chg = col("chg"), iv = col("iv30p"), ed = col("ed");
    return okFeed(u) && u.status === "ok" && Array.isArray(u.t) && chg ? u.t.map((t, i) => ({ t, chg: chg[i], iv: iv ? iv[i] : null, ed: ed ? ed[i] : null })) : null;
  }

  function lensMoves() {
    const s = LENS.strips, f = s && s.status === "ok" && Array.isArray(s.fields) && s.rows ? s.fields : [], u = LENS.uni;
    const ci = f.indexOf("chg"), ii = f.indexOf("iv30p"), ed = new Map(u ? u.map((r) => [r.t, r.ed]) : []), out = [];
    const useU = u && LENS.priced && !(ci >= 0 && ii >= 0 && s.session > LENS.day);
    const rows = useU ? u : ci < 0 || ii < 0 ? [] : Object.keys(s.rows).map((t) => ({ t, chg: isNum(s.rows[t][ci]), iv: isNum(s.rows[t][ii]), ed: ed.get(t) }));
    for (const r of rows) {
      const m = ivDays(r.chg, r.iv);
      if (m !== null) out.push({ t: r.t, chg: r.chg, iv: r.iv, m, event: isNum(r.ed) !== null && r.ed <= IV_EVENT });
    }
    LENS.src = (useU ? "Nightly, session " + LENS.day : "Live roster, session " + (s && s.session)) + ": " + out.length + " names.";
    return out.length ? out : null;
  }

  const lensRank = (moves, sign) => {
    const picked = moves.filter((x) => x.m * sign > 0).sort((a, b) => (b.m - a.m) * sign || (a.t < b.t ? -1 : 1));
    return [picked.filter((x) => !x.event), picked.filter((x) => x.event)];
  };

  function lensContext(moves) {
    const abs = moves.filter((x) => !x.event).map((x) => Math.abs(x.m)).sort((a, b) => a - b), k = abs.length >> 1;
    return abs.length ? "Median |m| " + ((abs[k] + abs[abs.length % 2 ? k : k - 1]) / 2).toFixed(1) + " IV-days; " + abs.filter((v) => v > 3).length + " of " + abs.length + " beyond 3." : null;
  }

  function ivList(title, said, ranked, waiting) {
    const box = h("div", { class: "mk-movers-col", "aria-label": cap1(said) + " in IV-days" }, h("h3", { class: "mk-movers-h" }, title));
    if (!ranked) {
      box.append(emptyLine(waiting ? "pending" : "unavailable", waiting ? "The live rows are being read." : "The live rows carried no prior-close implied volatility, so nothing is ranked in IV-days.", said, 64));
      return box;
    }
    const rows = (list, cls) => {
      const top = Math.max(...list.map((x) => Math.abs(x.m)), 1e-12);
      return h("ul", { class: "mk-movers" + cls }, list.map((x) => h("li", { "data-t": x.t, title: x.t + ": " + signed(x.chg * 100, 2) + "% on a prior-close IV of " + (x.iv * 100).toFixed(1) + "%" },
        h("span", { class: "mk-mv-t" }, x.t),
        h("span", { class: "mk-mv-m", "aria-hidden": "true" }, h("i", { "data-tone": toneOf(x.m), style: { width: Math.abs(x.m) / top * 100 + "%" } })),
        h("span", { class: "mk-mv-v", "data-tone": toneOf(x.m) }, signed(x.m, 1)))));
    };
    box.querySelector("h3").append(h("span", { class: "mk-movers-n" }, " · " + Math.min(8, ranked[0].length) + " of " + ranked[0].length));
    if (ranked[0].length) box.append(rows(ranked[0].slice(0, 8), ""));
    else if (!ranked[1].length) box.append(emptyLine("quiet", "No name with a prior-close implied volatility closed on this side.", said, 64));
    if (ranked[1].length) box.append(h("p", { class: "mk-apart" }, IV_APART), rows(ranked[1].slice(0, 3), " is-apart"));
    return box;
  }

  function lensRepaint(force) {
    if (!LENS.on || !LENS.movers) return;
    if (LENS.hold && LENS.shown && !force) LENS.dirty = true;
    else paintMovers(LENS.movers);
  }

  function lensAsk() {
    if (LENS.ask) return;
    LENS.ask = 1;
    getLive(["strips"]).then((lk) => { if (okFeed(lk.strips)) LENS.strips = lk.strips; }).catch(() => {}).then(() => { LENS.ask = 2; lensRepaint(true); });
    LENS.px = LENS.px || (UI.rt && UI.rt.connect({ topics: ["px"] }));
    if (LENS.px && !LENS.px.bound) {
      LENS.px.bound = true;
      LENS.px.on("px", () => { LENS.strips = UI.rt.strips() || LENS.strips; lensRepaint(false); });
    }
  }

  function paintMovers(movers) {
    const host = clear("mktMovers");
    const seg = clear("mkMoversSeg");
    if (!host) return;
    host.dataset.pop = "";
    if (unreadable(movers)) { host.append(unreadableLine(movers, "the session's extremes (/api/flows/movers)")); return; }
    if (!movers || movers.status === "pending") {
      host.append(pendingLine("the session's extremes", "They are cut from the screener rows and appear with the next pipeline run."));
      return;
    }
    const prem = movers.premium || {};
    const lists = [
      ["Risers", movers.risers, "chg", "the largest risers"], ["Fallers", movers.fallers, "chg", "the largest fallers"],
      ["Calls", prem.bullish, "netPrem", "the most net call premium"], ["Puts", prem.bearish, "netPrem", "the most net put premium"],
    ];
    if (!lists.some((spec) => spec[1] && spec[1].length)) {
      host.append(emptyLine("quiet", "The screener answered and ranked no name on any of the four extremes.", "extremes"));
      return;
    }
    LENS.movers = movers;
    if (!host.__held) {
      host.__held = true;
      host.addEventListener("pointerenter", (e) => { LENS.hold = e.pointerType !== "touch"; });
      host.addEventListener("pointerleave", () => { LENS.hold = false; if (LENS.dirty) { LENS.dirty = false; paintMovers(LENS.movers); } });
    }
    const moves = LENS.on ? lensMoves() : null;
    LENS.shown = Boolean(moves);
    if (LENS.on && !LENS.strips && !LENS.ask) lensAsk();
    const cols = lists.map((spec, i) => (LENS.on && i < 2
      ? ivList(spec[0], spec[3], moves && lensRank(moves, i ? -1 : 1), LENS.ask === 1)
      : moverList(spec[0], spec[1], spec[2], { said: spec[3] })));
    const grid = h("div", { class: "mk-movers-grid", "data-show": "0" }, cols);
    const show = (i) => { LENS.col = i; grid.dataset.show = String(i); cols.forEach((c, j) => c.classList.toggle("is-on", i === j)); };
    const col = Math.min(LENS.col, cols.length - 1);
    show(col);
    if (seg) seg.append(UI.segmented("Extreme", lists.map((spec) => ({ label: spec[0] })), show, col));
    host.append(h("div", { class: "mk-lens" }, UI.segmented("Rank risers and fallers by", [{ label: "Raw change" }, { label: "In IV-days" }], (i) => {
      LENS.on = i === 1;
      if (LENS.on && LENS.sync) LENS.sync();
      LENS.dirty = false;
      if (LENS.ask === 2 && !LENS.strips) LENS.ask = 0;
      paintMovers(LENS.movers);
    }, LENS.on ? 1 : 0)), grid);
    if (LENS.on) host.append(h("div", { class: "mk-lens-note" }, moves ? h("p", { class: "mk-lens-ctx" }, lensContext(moves)) : null, moves ? h("p", null, LENS.src) : null, h("p", null, "IV as of the previous close. A ranking, not a test: no error rate measured."), h("p", null, IV_GRADE)));
    const universe = isNum(movers.universe), ranked = isNum(movers.ranked), priced = isNum(movers.priced);
    const noChange = isNum(movers.unrankedChange), noPrem = isNum(movers.unrankedPremium);
    if (universe === null || ranked === null || priced === null || noChange === null || noPrem === null) {
      host.append(emptyLine("unavailable", "This payload published no count of the screened names it ranked, so the columns carry no denominator.", "extremes population", 64));
    } else {
      host.dataset.pop = ranked + " of " + universe + " screened names could be ranked by change and " + priced +
        " by net premium; " + noChange + " quoted no change and " + noPrem + " no net premium, and those names are in no column. " +
        "Each column prints at most its first 8 names.";
    }
  }

  function crossBoard(boardRows, moverRows) {
    const out = [];
    const byTicker = new Map();
    for (const mv of Array.isArray(moverRows) ? moverRows : []) if (mv && mv.t) byTicker.set(mv.t, mv);
    for (const r of boardRows) {
      if (!r || !r.t || !byTicker.has(r.t)) continue;
      out.push({ t: r.t, rank: isNum(r.r), netPrem: isNum(byTicker.get(r.t).netPrem) });
    }
    out.sort((a, b) => (a.rank === null ? 1 : b.rank === null ? -1 : a.rank - b.rank));
    return out;
  }

  function paintAgainst(boards, movers) {
    const host = clear("mktAgainst");
    if (!host) return;
    host.dataset.lead = "";
    host.dataset.qual = "";
    const [boardLong, boardShort] = boards;
    if (unreadable(boardLong) || unreadable(boardShort)) {
      host.append(unreadableLine(unreadable(boardLong) ? boardLong : boardShort, "the boards this panel is joined against (/api/flows/board)"));
      return;
    }
    if (unreadable(movers)) { host.append(unreadableLine(movers, "the session's premium extremes (/api/flows/movers)")); return; }
    if (pendingOf(boardLong) || pendingOf(boardShort) || pendingOf(movers)) {
      host.append(pendingLine("both halves of this join", "It needs both boards and the premium extremes; it fills on the next pipeline run."));
      return;
    }
    const prem = movers.premium || {};
    const sides = [
      { title: "Long in puts", said: "Long board, in the largest net PUT premium", board: boardLong, side: "long", list: prem.bearish, withList: prem.bullish,
        ranking: "the session's largest net put premium", empty: "No long-board name appears in the session's largest net put premium." },
      { title: "Short in calls", said: "Short board, in the largest net CALL premium", board: boardShort, side: "short", list: prem.bullish, withList: prem.bearish,
        ranking: "the session's largest net call premium", empty: "No short-board name appears in the session's largest net call premium." },
    ];
    if (!sides.some((side) => Array.isArray(side.list))) {
      host.append(emptyLine("unavailable", "This movers payload published neither premium extreme, so the boards have nothing to join.", "against the prints"));
      return;
    }
    let hits = 0, population = 0, agree = 0, agreePop = 0;
    const joined = [], skipped = [];
    const grid = h("div", { class: "mk-movers-grid mk-against" });
    for (const side of sides) {
      const boardRows = side.board && Array.isArray(side.board.rows) ? side.board.rows : [];
      const col = h("div", { class: "mk-movers-col", "aria-label": side.said }, h("h3", { class: "mk-movers-h", title: side.said }, side.title));
      grid.append(col);
      if (!Array.isArray(side.list)) {
        skipped.push("the " + side.side + " board (" + boardRows.length + " name" + (boardRows.length === 1 ? "" : "s") +
          ") could not be joined, because this payload published no ranking of " + side.ranking);
        col.append(emptyLine("unavailable", "This movers payload published no ranking of " + side.ranking + ", so the " + side.side +
          " board could not be read against it. Nothing here says the overlap is empty — it says the overlap was never taken.", side.side + " board join", 64));
        continue;
      }
      if (!boardRows.length) {
        col.append(emptyLine("quiet", "The " + side.side + " board ranked no name this session, so nothing on this side is read against the prints.", side.side + " board join", 64));
        continue;
      }
      const found = crossBoard(boardRows, side.list);
      if (Array.isArray(side.withList)) { agree += crossBoard(boardRows, side.withList).length; agreePop += boardRows.length; }
      hits += found.length;
      population += boardRows.length;
      joined.push(boardRows.length + " " + side.side);
      col.append(found.length ? h("ul", { class: "mk-movers" }, found.map((r) => h("li", null,
        h("span", { class: "mk-mv-t" }, r.rank === null ? r.t + " (board rank not published)" : r.t + " #" + r.rank),
        h("span", { class: "mk-mv-v", "data-tone": toneOf(r.netPrem) }, usd(r.netPrem)))))
        : emptyLine("quiet", side.empty, side.side + " board join", 64));
    }
    host.prepend(UI.metrics([
      UI.metric("Against", population ? hits + " of " + population : DASH, { tone: hits ? "warn" : null, sub: population ? "board names" : null,
        state: population ? null : { state: "quiet", reason: "No board name was joined against the prints this session." } }),
      agreePop ? UI.metric("With", agree + " of " + agreePop, { tone: agree ? "up" : null, sub: "board names" }) : null,
    ].filter(Boolean), { min: 140 }));
    host.append(grid);
    host.dataset.lead = !population
      ? "No board name was joined against the prints this session, so there is no population to state a count against."
      : hits + " of " + population + " published board names (" + joined.join(", ") + ") appear in the opposite premium extreme this session" +
        (agreePop ? ", and " + agree + " of " + agreePop + " in the extreme on their own side." : ".");
    const caveats = [];
    if (skipped.length) caveats.push(skipped.join("; ") + ".");
    caveats.push("Both mover lists are CAPPED extremes rather than the universe: a name absent from them is only not among the loudest disagreements.");
    host.dataset.qual = caveats.join(" ");
  }

  function rankOf(rows, valueOf) {
    const measured = [];
    for (const r of rows) { const v = valueOf(r); if (v !== null) measured.push(v); }
    if (!measured.length) return null;
    const newest = valueOf(rows[0]);
    if (newest === null) return null;
    let above = 0, level = 0;
    for (const v of measured) { if (v > newest) above++; else if (v === newest) level++; }
    return { rank: above + 1, of: measured.length, value: newest, tied: level > 1 };
  }
  const putShare = (r) => { const c = isNum(r && r.callPrem), q = isNum(r && r.putPrem); if (c === null || q === null) return null; const t = c + q; return t > 0 ? q / t : null; };
  const twoSided = (r) => { const c = isNum(r && r.callPrem), q = isNum(r && r.putPrem); return c === null || q === null ? null : c + q; };
  const ordinal = (n) => {
    const m = n % 100;
    if (m >= 11 && m <= 13) return n + "th";
    const l = n % 10;
    return n + (l === 1 ? "st" : l === 2 ? "nd" : l === 3 ? "rd" : "th");
  };

  function rankSaid(rows) {
    const share = rankOf(rows, putShare), size = rankOf(rows, twoSided);
    const newest = rows[0] || {};
    const said = [];
    const unrankable = (r) => (r.of < rows.length ? " (" + rows.length + " sessions were returned; " + (rows.length - r.of) + " quoted only one leg and cannot be ranked)" : "");
    const extreme = (r, top, bottom) => (r.rank === 1 ? (r.tied ? " — tied for the " + top + " in the window." : " — the " + top + " session in the window.")
      : r.rank === r.of ? (r.tied ? " — tied for the " + bottom + " in the window." : " — the " + bottom + " session in the window.") : ".");
    if (share) {
      said.push("Put premium was " + pct(share.value, 1) + " of the two-sided total on " + (newest.date || "the newest session") +
        ", the " + ordinal(share.rank) + " highest of the " + share.of + " session" + (share.of === 1 ? "" : "s") +
        " in this window that quoted both legs" + unrankable(share) + extreme(share, "most put-leaning", "most call-leaning"));
    } else {
      said.push("No session in this window quoted both a call and a put premium, so the newest session cannot be ranked against the others.");
    }
    if (size) {
      said.push("Total premium of " + usd(size.value) + " was the " + ordinal(size.rank) + " largest of the " + size.of +
        " session" + (size.of === 1 ? "" : "s") + " that quoted both legs" + unrankable(size) + ".");
    }
    if (share || size) {
      const span = (share || size).of;
      said.push("A rank over " + span + " session" + (span === 1 ? "" : "s") + " is an ordinal claim and nothing more: the window is too short for a standard deviation.");
    }
    return said.join(" ");
  }

  function bar(svg, x, mid, v, k, bw, i, up, rx, op) {
    if (v === null) return UI.s("circle", { cx: x, cy: mid + (up ? -3 : 3), r: 1.6, fill: UI.cssVar("--label-4") }, svg);
    const hh = Math.max(1, v * k);
    UI.s("rect", { x: x - bw / 2, y: up ? mid - hh : mid, width: bw, height: hh, rx, fill: UI.cssVar(up ? "--up-mark" : "--down-mark"), "fill-opacity": op,
      class: "grow", style: { "--i": String(i), "--origin": up ? "bottom" : "top" } }, svg);
  }

  function dayTicks(svg, dates, xAt, w, y) {
    const N = dates.length;
    const every = Math.max(1, Math.ceil(N / (w < 600 ? 4 : 6)));
    let placed = null;
    for (let i = N - 1; i >= 0; i -= every) {
      if (!dates[i]) continue;
      const x = Math.max(22, Math.min(w - 22, xAt(i)));
      if (placed !== null && placed - x < 48) continue;
      UI.s("text", { x, y, "text-anchor": "middle", text: F.day(dates[i]), class: "mk-vol-x" }, svg);
      placed = x;
    }
  }

  function paintVolume(pulse) {
    const host = clear("mkVolume");
    if (!host) return;
    const tot = pulse.totals;
    const rows = tot && Array.isArray(tot.rows) ? tot.rows : [];
    if (!tot || tot.status !== "ok" || !rows.length) { host.append(feedSilence(tot, "volume")); return; }
    const hist = pulse.totalsHistory && typeof pulse.totalsHistory === "object" ? pulse.totalsHistory : null;
    const pv = hist && hist.pcVolume ? hist.pcVolume : null;
    const newest = rows[0] || {};
    const c0 = isNum(newest.callVol), p0 = isNum(newest.putVol);
    const pcNow = pv && isNum(pv.now) !== null ? isNum(pv.now) : c0 && p0 !== null ? p0 / c0 : null;
    const z = pv ? isNum(pv.z) : null;
    const volPct = hist && hist.volume ? isNum(hist.volume.pct) : null;
    host.append(UI.metrics([
      UI.metric("Market P/C", pcNow === null ? DASH : pcNow.toFixed(2), { sub: newest.date ? F.day(newest.date) : null }),
      UI.metric("z vs 1Y", z === null ? DASH : F.signed(z, 1), { tone: z === null ? null : z > 1 ? "down" : z < -1 ? "up" : null, state: gap(z, pulse, pv, "The one-year z") }),
      UI.metric("Volume pct", volPct === null ? DASH : F.pct(volPct > 1 ? volPct / 100 : volPct, 0), { state: gap(volPct, pulse, hist && hist.volume, "The volume percentile") }),
    ], { min: 90 }));
    const ordered = rows.slice().reverse();
    const slot = h("div", { class: "mk-pairs-w" });
    host.append(slot, UI.legend([["--up-mark", "", "Calls"], ["--down-mark", "", "Puts"]]));
    const VIEWS = [
      { label: "Contracts", c: "callVol", p: "putVol", fmt: (v) => F.num(v), said: "contracts" },
      { label: "Premium", c: "callPrem", p: "putPrem", fmt: usd, said: "premium" },
    ];
    let view = 0;
    let chart = null;
    const draw = () => {
      const V = VIEWS[view];
      if (chart) chart.destroy();
      const plot = h("div", { class: "mk-pairs" });
      slot.replaceChildren(plot);
      chart = C.mount(plot, (el, w, animate) => {
        const H = roomH(el, w < 600 ? 150 : 170, 64, 40), top = 10, bot = 22, mid = top + (H - top - bot) / 2;
        const svg = C.svgRoot(el, w, H, animate, "Call " + V.said + " up and put " + V.said + " down per session, oldest at the left");
        const N = ordered.length, band = (w - 8) / N;
        const hi = Math.max(1, ...ordered.map((r) => Math.max(isNum(r[V.c]) || 0, isNum(r[V.p]) || 0)));
        const half = (H - top - bot) / 2 - 2;
        const bw = Math.max(2, Math.min(14, band * 0.62));
        UI.s("line", { x1: 0, x2: w, y1: mid, y2: mid, class: "base" }, svg);
        ordered.forEach((r, i) => {
          const x = 4 + band * (i + 0.5);
          const c = isNum(r[V.c]), q = isNum(r[V.p]);
          const last = i === N - 1;
          bar(svg, x, mid, c, half / hi, bw, i, 1, Math.min(3, bw / 2), last ? 1 : 0.62);
          bar(svg, x, mid, q, half / hi, bw, i, 0, Math.min(3, bw / 2), last ? 1 : 0.62);
        });
        dayTicks(svg, ordered.map((r) => r.date), (i) => 4 + band * (i + 0.5), w, H - 6);
        C.scrub(el, svg, {
          xs: ordered.map((_, i) => 4 + band * (i + 0.5)), top, bottom: H - bot, label: "Call and put " + V.said + " per session",
          onMove: (i) => ({ parts: [C.part(F.day(ordered[i].date), "k"), C.part("Calls", "k"), h("b", { "data-tone": "up" }, V.fmt(ordered[i][V.c])),
            C.part("Puts", "k"), h("b", { "data-tone": "down" }, V.fmt(ordered[i][V.p]))] }),
        });
      });
    };
    draw();
    const volSeg = clear("mkVolumeSeg");
    if (volSeg) volSeg.append(UI.segmented("Volume unit", VIEWS.map((x) => ({ label: x.label })), (i) => { view = i; draw(); }, 0));
    const shown = rows.slice(0, 10);
    const detail = table("Total options volume and premium per session, split call and put",
      [["Session"], ["Call vol", true], ["Put vol", true], ["Call prem", true], ["Put prem", true]],
      shown.map((r) => [r.date || DASH, grouped(r.callVol), grouped(r.putVol), usd(r.callPrem), usd(r.putPrem)]));
    const notes = pulse.notes || {};
    const rank = rankSaid(rows);
    host.dataset.rank = rank;
    infoInto("mkVolumeCard", "volume", () => ({
      title: "Volume", lead: rank,
      facts: [["P/C volume z", z === null ? (pv && pv.reason) || "pending" : F.signed(z, 2)], ["Sessions in the year", hist ? count(hist.n) : "pending"]],
      notes: [notes.totals, capLine(tot, rows.length, "sessions"), rows.length > shown.length ? "The table lists the newest " + shown.length + " of the " + rows.length + " sessions above; the chart shows all " + rows.length + "." : null],
      node: detail,
    }));
  }

  function growthSaid(r) {
    const n = isNum(r.ratio), prev = isNum(r.prevOi), d = isNum(r.diff);
    const p = n === null ? null : n * 100;
    const plain = n === null ? DASH : (() => { const v = Math.abs(p) >= 100 ? Math.round(p) : Math.round(p * 10) / 10; return signGlyph(v) + Math.abs(v).toLocaleString("en-US") + "%"; })();
    const small = prev !== null && prev < 100;
    if (n !== null && (n > 0 ? small : n === 0 && d > 0)) return ["new", small ? "From " + grouped(prev) + " contracts, a base too small for a percentage to mean anything" : "Up " + grouped(d) + " contracts on a ratio the vendor sent as 0"];
    if (n === null || n <= 0) return [plain, null];
    if (n >= 1) {
      const x = 1 + n;
      const times = x >= 10 ? Math.round(x).toLocaleString("en-US") : x.toFixed(1);
      return ["×" + times, times + " times the previous snapshot's open interest (" + plain + ")"];
    }
    return [plain, null];
  }
  const contractLabel = (r) => (r.cp && isNum(r.k) !== null && r.exp ? (r.t || DASH) + " " + r.cp + String(r.k) + " " + String(r.exp).slice(5) : r.oc || (r.t || DASH) + " " + DASH);

  function paintOi(pulse) {
    const host = clear("mkOi");
    if (!host) return;
    const feed = pulse.oiChange;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "open interest")); return; }
    const top = Math.max(...rows.map((r) => Math.abs(isNum(r.diff) || 0)), 1);
    host.append(UI.list(rows.map((r, i) => {
      const [growth, why] = growthSaid(r);
      const d = isNum(r.diff);
      return h("div", { class: "ui-row mk-oirow", role: "listitem" },
        h("span", { class: "ui-badge", "data-tone": r.cp === "C" ? "up" : r.cp === "P" ? "down" : null }, r.cp || "·"),
        h("span", { class: "ui-row-m" }, h("b", null, r.t || DASH), h("span", null, (isNum(r.k) === null ? DASH : r.k) + (r.exp ? " · " + F.day(String(r.exp)) : ""))),
        h("span", { class: "ui-meter" }, h("i", { style: { "--w": (Math.abs(d || 0) / top * 100).toFixed(1) + "%", "--i": String(i), "--c": UI.cssVar("--s-blue") } })),
        h("span", { class: "ui-row-v", "data-tone": toneOf(d) }, signedGrouped(r.diff)),
        h("span", { class: "ui-row-v mk-growth", title: why }, growth));
    }), { visible: 6, label: "Contracts by open-interest change" }));
    const detail = table("Contracts the vendor ranked by open-interest change", [["Contract"], ["Change", true], ["Growth", true], ["Curr OI", true], ["Volume", true]],
      rows.map((r) => { const [g, why] = growthSaid(r); return [contractLabel(r), signedGrouped(r.diff), [g, "c-num", why], grouped(r.currOi), grouped(r.vol)]; }));
    const notes = pulse.notes || {};
    infoInto("mkOiCard", "open interest", () => ({
      title: "Open interest", lead: "Contracts whose open interest grew most between the two clearing snapshots.",
      notes: [notes.oiChange, capLine(feed, rows.length, "contracts")], node: detail,
    }));
  }

  function paintImpact(pulse) {
    const host = clear("mkImpact");
    if (!host) return;
    const feed = pulse.netImpact;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "net impact")); return; }
    const pos = [], neg = [];
    for (const r of rows) { const v = isNum(r.netPrem); if (v === null) continue; if (v > 0) pos.push(r); else if (v < 0) neg.push(r); }
    const byNet = (a, b) => Math.abs(b.netPrem) - Math.abs(a.netPrem);
    pos.sort(byNet);
    neg.sort(byNet);
    host.append(h("div", { class: "mk-movers-grid mk-two" }, moverList("Positive", pos, "netPrem", { max: 6, said: "positive net premium impact" }), moverList("Negative", neg, "netPrem", { max: 6, said: "negative net premium impact" })));
    const notes = pulse.notes || {};
    infoInto("mkImpactCard", "net impact", () => ({ title: "Net impact", lead: "The names the vendor ranks by net premium impact, split by sign.", notes: [notes.netImpact, capLine(feed, Math.min(pos.length, 6) + Math.min(neg.length, 6), "names")] }));
  }

  function paintInsiders(pulse) {
    const host = clear("mkInsiders");
    if (!host) return;
    const feed = pulse.insiders;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "insider filings")); return; }
    const ordered = rows.slice().reverse();
    const last = rows[0] || {};
    host.append(UI.metrics([
      UI.metric("Buys", usd(last.buysNotional), { sub: count(last.buys) + " filings" + (last.date ? " · " + F.day(last.date) : ""), tone: "up" }),
      UI.metric("Sells", usd(isNum(last.sellsNotional) === null ? null : Math.abs(last.sellsNotional)), { sub: count(last.sells) + " filings" + (last.date ? " · " + F.day(last.date) : ""), tone: "down" }),
    ], { min: 100 }));
    const plot = h("div", { class: "mk-pairs" });
    host.append(plot);
    C.mount(plot, (el, w, animate) => {
      const H = roomH(el, w < 600 ? 130 : 170, 80, 4), top = 6, bot = 20, mid = top + (H - top - bot) / 2, half = (H - top - bot) / 2 - 2;
      const svg = C.svgRoot(el, w, H, animate, "Insider buy and sell notional per filing day");
      const N = ordered.length, band = (w - 8) / N, bw = Math.max(2, Math.min(12, band * 0.6));
      const hi = Math.max(1, ...ordered.map((r) => Math.max(Math.abs(isNum(r.buysNotional) || 0), Math.abs(isNum(r.sellsNotional) || 0))));
      UI.s("line", { x1: 0, x2: w, y1: mid, y2: mid, class: "base" }, svg);
      ordered.forEach((r, i) => {
        const x = 4 + band * (i + 0.5);
        const b = isNum(r.buysNotional), q = isNum(r.sellsNotional);
        bar(svg, x, mid, b === null ? b : Math.abs(b), half / hi, bw, i, 1, 2);
        bar(svg, x, mid, q === null ? q : Math.abs(q), half / hi, bw, i, 0, 2);
      });
      dayTicks(svg, ordered.map((r) => r.date), (i) => 4 + band * (i + 0.5), w, H - 5);
      C.scrub(el, svg, { xs: ordered.map((_, i) => 4 + band * (i + 0.5)), top, bottom: H - bot, label: "Insider filings per day",
        onMove: (i) => ({ parts: [C.part(F.day(ordered[i].date), "k"), C.part("Buys", "k"), h("b", { "data-tone": "up" }, usd(ordered[i].buysNotional)),
          C.part("Sells", "k"), h("b", { "data-tone": "down" }, isNum(ordered[i].sellsNotional) === null ? DASH : usd(Math.abs(ordered[i].sellsNotional)))] }) });
    });
    const detail = table("Aggregate insider filings per filing day", [["Filing day"], ["Buys", true], ["Sells", true], ["Buy notional", true], ["Sell notional", true]],
      rows.map((r) => [r.date || DASH, grouped(r.buys), grouped(r.sells), usd(r.buysNotional), usd(r.sellsNotional)]));
    const notes = pulse.notes || {};
    infoInto("mkInsidersCard", "insiders", () => ({ title: "Insiders", lead: "Form 4 buys against sells, in dollars, per filing day.", notes: [notes.insiders, capLine(feed, rows.length, "filing days")], node: detail }));
  }

  function paintDark(pulse) {
    const host = clear("mkDark");
    if (!host) return;
    const feed = pulse.darkpool;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows.filter((r) => r && r.canceled !== true) : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "dark pool prints")); return; }
    const ranked = rows.slice().sort((a, b) => (isNum(b.prem) || 0) - (isNum(a.prem) || 0));
    const top = Math.max(1, isNum(ranked[0] && ranked[0].prem) || 1);
    const price = (v) => (isNum(v) === null ? DASH : "$" + F.px(isNum(v)));
    host.append(UI.list(ranked.map((r, i) => h("div", { class: "ui-row mk-dprow", role: "listitem" },
      h("span", { class: "ui-row-m" }, h("b", null, r.t || DASH), h("span", null, price(r.px) + " · " + grouped(r.size))),
      h("span", { class: "ui-meter" }, h("i", { style: { "--w": ((isNum(r.prem) || 0) / top * 100).toFixed(1) + "%", "--i": String(i), "--c": UI.cssVar("--s-purple") } })),
      h("span", { class: "ui-row-v" }, usd(r.prem)))), { visible: 6, label: "Largest off-exchange prints" }));
    const detail = table("Off-exchange equity trades reported to the print feed, as the vendor surfaces them", [["Name"], ["Time (TRT)", true], ["Price", true], ["Size", true], ["Premium", true]],
      rows.map((r) => [r.t || DASH, F.time(r.at, false), price(r.px), grouped(r.size), usd(r.prem)]));
    const notes = pulse.notes || {};
    const voided = isNum(feed.canceled) ? feed.canceled : 0;
    infoInto("mkDarkCard", "dark pool", () => ({ title: "Dark pool", lead: "The largest off-exchange prints by dollar size.", notes: [notes.darkpool, capLine(feed, rows.length, "prints"), voided > 0 ? voided + " canceled print" + (voided === 1 ? " is" : "s are") + " left out of this list." : null], node: detail }));
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const signedVendorPct = (v) => { const n = isNum(v); if (n === null) return DASH; const r = +(n * 100).toFixed(2); return signGlyph(r) + Math.abs(r).toFixed(2) + "%"; };
  const vendorPct = (v) => { const n = isNum(v); return n === null ? DASH : (n * 100).toFixed(0) + "%"; };

  function paintSeason(pulse) {
    const host = clear("mkSeason");
    const seg = clear("mkSeasonSeg");
    if (!host) return;
    const feed = pulse.seasonality;
    const rows = feed && Array.isArray(feed.rows) ? feed.rows : [];
    if (!feed || feed.status !== "ok" || !rows.length) { host.append(feedSilence(feed, "seasonality")); return; }
    const symOf = (r) => (typeof r.t === "string" && r.t ? r.t : null);
    const syms = [];
    for (const r of rows) if (!syms.includes(symOf(r))) syms.push(symOf(r));
    const cells = new Map(rows.map((r) => [symOf(r) + ":" + isNum(r.month), r]));
    if (cells.size < rows.length) {
      host.append(emptyLine("unavailable", syms.some((t) => t) ?
        "The seasonality feed carried " + rows.length + " rows for " + cells.size + " ticker months, so at least one ticker repeats a month. Nothing is drawn rather than a calendar that averages two readings it cannot tell apart." :
        "The seasonality feed carried " + rows.length + " rows for " + new Set(rows.map((r) => isNum(r.month))).size + " distinct months. The vendor sends one row per ticker per month, and this " +
        "payload does not say which ticker a row is, so the rows cannot be told apart. Nothing is drawn rather than a " +
        "calendar that repeats a month.", "seasonality", 120));
      return;
    }
    const nowMonth = new Date().getMonth() + 1;
    if (syms.length > 1 || syms[0] !== null) {
      const VIEWS = [
        { label: "Average", of: (r) => isNum(r.avg), fmt: signedVendorPct, what: "Average change" },
        { label: "Up months", of: (r) => { const p = isNum(r.positivePct); return p === null ? null : p - 0.5; }, fmt: (v) => vendorPct(v + 0.5) + " up", what: "Share of years the month closed higher, against even odds" },
      ];
      let view = 0;
      const draw = () => {
        const V = VIEWS[view];
        const grid = syms.map((t) => MONTHS.map((_, i) => { const r = cells.get(t + ":" + (i + 1)); return r ? V.of(r) : null; }));
        const gridHost = h("div", { class: "mk-sea-hm" });
        host.replaceChildren(gridHost);
        C.heatmap(gridHost, { rows: syms, cols: MONTHS, grid, palette: "direction", left: 52, cellH: 24, highlightCol: nowMonth - 1,
          rowFormat: (t) => t || DASH, format: V.fmt, label: V.what + " by calendar month for " + syms.length + " index and sector funds" });
      };
      draw();
      if (seg) seg.append(UI.segmented("Seasonality view", VIEWS.map((x) => ({ label: x.label })), (i) => { view = i; draw(); }, 0));
      host.dataset.funds = String(syms.length);
    } else {
      const peak = Math.max(1e-9, ...rows.map((r) => Math.abs(isNum(r.avg) || 0)));
      host.append(h("div", { class: "mk-sea" }, rows.map((r) => {
        const m = isNum(r.month), a = isNum(r.avg);
        const tip = [];
        if (isNum(r.median) !== null) tip.push("median " + signedVendorPct(r.median));
        if (isNum(r.min) !== null && isNum(r.max) !== null) tip.push("range " + signedVendorPct(r.min) + " to " + signedVendorPct(r.max));
        if (isNum(r.years) !== null) tip.push("over " + r.years + " years");
        return h("div", { class: "mk-sea-cell" + (m === nowMonth ? " is-now" : ""), title: tip.join(" · ") || null,
          "data-tone": toneOf(a), style: { "--a": a === null ? "0" : Math.sqrt(Math.abs(a) / peak).toFixed(3) } },
        h("span", { class: "mk-sea-m" }, m !== null && m >= 1 && m <= 12 ? MONTHS[m - 1] : DASH),
        h("span", { class: "mk-sea-v", "data-tone": toneOf(a) }, signedVendorPct(r.avg)),
        h("span", { class: "mk-sea-p" }, vendorPct(r.positivePct)));
      })));
    }
    const notes = pulse.notes || {};
    const funds = syms.filter(Boolean);
    infoInto("mkSeasonCard", "seasonality", () => ({ title: "Seasonality", lead: funds.length ?
      "Average change in each calendar month for " + funds.join(", ") + ", over the years the vendor holds. Up months is the share of those years the month closed higher; the outlined column is this month." :
      "Average change in each calendar month over the years the vendor holds, with the share of those months that closed higher beneath it.",
      notes: [notes.seasonality, capLine(feed, rows.length, funds.length ? "fund months" : "months")] }));
  }

  function paintPulse(pulse) {
    const ids = ["mkVolume", "mkOi", "mkImpact", "mkInsiders", "mkDark", "mkSeason"];
    if (unreadable(pulse) || !pulse || pulse.status === "pending") {
      for (const id of ids) {
        const host = clear(id);
        if (!host) continue;
        host.append(unreadable(pulse) ? unreadableLine(pulse, "the market pulse (/api/flows/pulse)")
          : pendingLine("the market pulse", "The section fills on the first run that writes it."));
      }
      return;
    }
    paintVolume(pulse);
    paintOi(pulse);
    paintImpact(pulse);
    paintInsiders(pulse);
    paintDark(pulse);
    paintSeason(pulse);
    const foot = $("mkPulseFoot");
    if (foot) foot.textContent = (pulse.notes && pulse.notes.refusals) || "";
  }

  function paintExpiry(regime, breadth) {
    const host = clear("mkExpiry");
    if (!host) return;
    const reg = okFeed(regime) && regime.zeroDte && regime.zeroDte.status === "ok" ? regime.zeroDte : null;
    const lb = okFeed(breadth) && breadth.dte ? breadth.dte : null;
    const useLive = lb && lb.share && isNum(lb.share.value) !== null && newer(breadth.session, regime);
    const share = useLive ? isNum(lb.share.value) : reg ? isNum(reg.share) : null;
    const zero = useLive ? isNum(lb.share.zeroNet) : reg ? isNum(reg.np0) : null;
    const weekly = useLive ? isNum(lb.share.weeklyNet) : reg ? isNum(reg.npw) : null;
    if (share === null && zero === null) {
      if (!newGate(host, regime, "net flow by expiry", 200)) host.append(emptyLine("unavailable", "Neither source carried a 0DTE share.", "net flow by expiry", 200));
      return;
    }
    const livePath = useLive && lb.zero && lb.zero.status === "ok" && Array.isArray(lb.zero.t) && Array.isArray(lb.zero.net) ? lb.zero : null;
    const gauge = C.gauge({ value: share === null ? null : share * 100, max: 100, arc: 180, size: 112, stroke: 9, color: "--s-orange",
      text: share === null ? DASH : Math.round(share * 100) + "%", label: "0DTE share of net premium" });
    host.append(h("div", { class: "mk-expiry-top" }, h("div", { class: "mk-gauge" }, gauge, h("span", null, "0DTE share")),
      UI.metrics([
        UI.metric("0DTE net", usdS(zero), { tone: toneOf(zero) }),
        UI.metric("Weekly net", usdS(weekly), { tone: toneOf(weekly) }),
        useLive ? null : UI.metric("Equities", reg && isNum(reg.equityShare) !== null ? F.pct(reg.equityShare, 0) : DASH, { sub: "of 0DTE", state: reg && isNum(reg.equityShare) !== null ? null : rowState(regime, regime && regime.zeroDte, "The equity and index split") }),
      ].filter(Boolean), { min: 90 })));
    const pts = !useLive && reg && reg.path && Array.isArray(reg.path.pts) ? reg.path.pts : [];
    const t0 = reg && reg.path ? Date.parse(reg.path.t0) : NaN;
    const P = livePath ? { t: livePath.t, net: nums(livePath.net) }
      : Number.isFinite(t0) ? { t: pts.map((p) => new Date(t0 + (isNum(p[0]) || 0) * 60000).toISOString()), net: pts.map((p) => isNum(p[1])), px: pts.map((p) => isNum(p[2])) } : null;
    if (P && P.t.length >= 2) {
      const plot = h("div", { class: "mk-expiry-p" });
      host.append(plot);
      const ax = timeAxis(P.t, useLive ? breadth.session : reg && reg.sessionDate);
      C.line(plot, { x: ax.x, xType: ax.xType, xTicks: ax.ticks(0), xFormat: ax.fmt, series: [{ values: P.net, format: usdS }],
        twoTone: true, zero: true, height: roomH(plot, 170, 56, 4), yFormat: usdS, label: "0DTE net premium through the session, times in TRT",
        readout: (i) => [C.part(clock(P.t[i]), "k"), tb(P.net[i]),
          P.px ? C.part("SPY " + (P.px[i] === null ? DASH : P.px[i].toFixed(2)), "k") : null].filter(Boolean) });
    }
    staleMark("mkExpiryCard", useLive ? breadth.session : regime && regime.sessionDate, "net flow by expiry");
    infoInto("mkExpiryCard", "expiry", () => ({
      title: "Expiry", lead: "How much of the session's net option premium sat in contracts expiring the same day, against the weekly expiries.",
      facts: [["Source", useLive ? "live:breadth" : "regime"], ["0DTE net", usdS(zero)], ["Weekly net", usdS(weekly)], ["Index 0DTE net", reg ? usdS(reg.index) : null], ["Equity 0DTE net", reg ? usdS(reg.equity) : null]],
      notes: ["The share is |0DTE net| over |0DTE net| plus |weekly net|, on the last cumulative values.", reg && reg.rule ? reg.rule : null],
    }));
  }

  function paintVol(regime, liveVol) {
    const host = clear("mkVol");
    if (!host) return;
    const reg = okFeed(regime);
    const curve = reg && reg.volCurve && reg.volCurve.byIndex ? reg.volCurve.byIndex : null;
    const lv = okFeed(liveVol) && liveVol.index ? liveVol : null;
    const useLive = lv && newer(lv.session, reg);
    const TEN = [1, 5, 7, 14, 30, 60, 90, 180, 365];
    const idx = {};
    for (const k of ["SPY", "QQQ", "IWM"]) {
      if (useLive && lv.index[k] && lv.index[k].status === "ok") {
        const r = lv.index[k];
        const night = curve && curve[k] && curve[k].status === "ok" ? isNum(curve[k].rv20) : null;
        const rv = isNum(r.rv);
        idx[k] = { iv: TEN.map((d) => isNum(r["v" + d])), iv30: isNum(r.iv30), ivp: isNum(r.ivRank), ivpWord: "rank", rv: rv !== null ? rv : night, rvWord: rv !== null ? "RV" : "RV 20d",
          ts: isNum(r.v30) !== null && isNum(r.v90) ? r.v30 / r.v90 - 1 : null };
      } else if (curve && curve[k] && curve[k].status === "ok" && Array.isArray(curve[k].iv)) {
        const r = curve[k], ten = Array.isArray(r.tenors) ? r.tenors : TEN;
        idx[k] = { iv: TEN.map((d) => { const j = ten.indexOf(d); return j < 0 ? null : isNum(r.iv[j]); }), iv30: isNum(r.iv[ten.indexOf(30)]),
          ivp: isNum(r.ivp), ivpWord: "pct", rv: isNum(r.rv20), rvWord: "RV 20d", ts: isNum(r.ts), shape: r.shape || null };
      }
    }
    const names = Object.keys(idx);
    if (!names.length) {
      if (!newGate(host, regime, "the index volatility curve", 240)) host.append(emptyLine("pending", "The live volatility layer has not published a curve yet.", "volatility", 240));
      return;
    }
    const spy = idx.SPY || idx[names[0]];
    const shape = spy.shape || (spy.ts === null ? null : spy.ts < 0 ? "contango" : spy.ts > 0 ? "backwardation" : "flat");
    const ic = reg && reg.impliedCorrelation && reg.impliedCorrelation.byIndex ? reg.impliedCorrelation.byIndex : {};
    const rho = ic.SPY && ic.SPY.status === "ok" ? ic.SPY : null;
    const vrp = spy.iv30 !== null && spy.rv !== null ? spy.iv30 - spy.rv : null;
    host.append(UI.metrics([
      UI.metric("IV 30d", spy.iv30 === null ? DASH : F.pct(spy.iv30, 1), { sub: "SPY" + (spy.ivp === null ? "" : " · " + spy.ivpWord + " " + Math.round(spy.ivp)) }),
      UI.metric(spy.rvWord, spy.rv === null ? DASH : F.pct(spy.rv, 1), { sub: vrp === null ? null : "IV − RV " + F.pts(vrp) + " pts" }),
      UI.metric("Term", shape ? cap1(shape) : DASH, { tone: shape === "backwardation" ? "warn" : null, sub: spy.ts === null ? null : "30/90 " + F.pct(spy.ts, 1, true) }),
      UI.metric("Correlation", rho ? isNum(rho.rho).toFixed(2) : DASH, { sub: rho && isNum(rho.dispersion) !== null ? "dispersion " + F.pts(rho.dispersion) + " pts" : null, state: rho ? null : rowState(regime, ic.SPY, "Implied correlation") }),
    ], { min: 100 }));
    const COL = { SPY: "--s-blue", QQQ: "--s-purple", IWM: "--s-teal" };
    const plot = h("div", { class: "mk-term" });
    host.append(plot, UI.legend(names.map((k) => [COL[k], "ln", k])));
    C.line(plot, {
      x: TEN, xType: "number", xScale: "sqrt", height: [180, 210, 230],
      xTicks: [{ v: 7, label: "1w" }, { v: 30, label: "1m" }, { v: 90, label: "3m" }, { v: 180, label: "6m" }, { v: 365, label: "1y" }],
      series: names.map((k) => ({ values: idx[k].iv, color: COL[k], label: k, format: (x) => F.pct(x, 1) })),
      yFormat: (x) => F.pct(x, 0), label: "Implied volatility by tenor for the index ETFs",
      readout: (i) => [C.part(TEN[i] + "d", "k")].concat(names.map((k) => C.part(k + " " + F.pct(idx[k].iv[i], 1), null))),
    });
    staleMark("mkVolCard", useLive ? lv.session : reg && reg.sessionDate, "volatility");
    infoInto("mkVolCard", "volatility", () => ({
      title: "Volatility", lead: "The index ETFs' fixed-tenor implied volatility stands in for the VIX curve, which the vendor plan does not serve.",
      facts: [["Source", useLive ? "live:vol" : "regime"], ["Implied correlation QQQ", ic.QQQ && ic.QQQ.status === "ok" ? isNum(ic.QQQ.rho).toFixed(3) : DASH],
        ["SPY coverage", rho ? F.pct(rho.coverage, 0) : null], ["Holdings as of", rho ? rho.weightsAsOf : null]],
      notes: ["Contango (a rising curve) is the calm shape; an inverted front is stress.",
        "Implied correlation is the index variance left after the members' own variances, over what perfect correlation would add; dispersion is the members' weighted 30-day IV less the index's, in volatility points."],
    }));
  }

  function paintRadar(regime) {
    const host = clear("mkRadar");
    const segHost = clear("mkRadarSeg");
    if (!host) return;
    const radar = okFeed(regime) && regime.volRadar ? regime.volRadar : null;
    if (!radar || radar.status === "pending") {
      if (!newGate(host, regime, "the volatility radar", 240)) host.append(emptyLine("pending", "The volatility radar has not been published yet.", "volatility radar", 240));
      return;
    }
    const SIDES = [["rich", "Rich", "short"], ["cheap", "Cheap", "long"], ["bullish", "Bullish", "up"], ["bearish", "Bearish", "down"]];
    let active = 0;
    const body = h("div", { class: "mk-radar" });
    host.append(body);
    const draw = () => {
      const [key, word, tone] = SIDES[active];
      const side = radar[key];
      body.replaceChildren();
      if (!side || side.status !== "ok" || !Array.isArray(side.rows) || !side.rows.length) {
        body.append(emptyLine(side && side.status === "quiet" ? "quiet" : "unavailable", (side && (side.reason || side.code)) || "This side of the radar carried no rows.", word.toLowerCase() + " names", 200));
        return;
      }
      const top = Math.max(1e-9, ...side.rows.map((r) => Math.abs(isNum(r.score) || 0)));
      body.append(UI.list(side.rows.map((r, i) => {
        const kids = [
          h("span", { class: "ui-row-m" }, h("b", null, r.t), h("span", null, key === "rich" || key === "cheap"
            ? (isNum(r.n) === null ? "" : r.n + " signals") : "sentiment")),
          h("span", { class: "ui-meter" }, h("i", { style: { "--w": (Math.abs(isNum(r.score) || 0) / top * 100).toFixed(1) + "%", "--i": String(i),
            "--c": UI.cssVar(tone === "short" ? "--g-short" : tone === "long" ? "--g-long" : tone === "up" ? "--up-mark" : "--down-mark") } })),
          h("span", { class: "ui-row-v", "data-tone": tone }, signed(r.score, 1)),
        ];
        return r.carded ? h("a", { class: "ui-row mk-rrow", href: "/flows/ticker/?t=" + encodeURIComponent(r.t) }, kids) : h("div", { class: "ui-row mk-rrow", role: "listitem" }, kids);
      }), { visible: 6, label: word + " names on the volatility radar" }));
    };
    draw();
    if (segHost) segHost.append(UI.segmented("Radar side", SIDES.map((s) => ({ label: s[1], disabled: !radar[s[0]] })), (i) => { active = i; draw(); }, 0));
    staleMark("mkRadarCard", radar.asOf || regime.sessionDate, "volatility radar");
    infoInto("mkRadarCard", "radar", () => ({
      title: "Volatility radar", lead: "The vendor's anomaly screen ranks names whose options are rich or cheap against their own history; its sentiment screen ranks bullish and bearish positioning.",
      facts: [["As of", radar.asOf], ["Kept per side", count(radar.keep)]],
      notes: ["Rich and cheap use the dealer-regime colours rather than green and red: rich volatility is not bearish.", "A linked name has a card today and opens its reader."],
    }));
  }

  function paintGroups(regime) {
    const host = clear("mkGroups");
    if (!host) return;
    const groups = okFeed(regime) && regime.groups && regime.groups.status === "ok" ? regime.groups.rows || [] : null;
    if (!groups) {
      if (!newGate(host, regime, "the group flows", 200)) host.append(emptyLine("unavailable", "The regime key carried no group flows.", "group flows", 200));
      return;
    }
    const rows = groups.filter((g) => g && g.status === "ok");
    const peak = Math.max(1, ...rows.map((g) => Math.abs(isNum(g.delta) || 0)));
    const list = h("ul", { class: "mk-sectors mk-groups" });
    rows.sort((a, b) => (isNum(b.delta) || 0) - (isNum(a.delta) || 0)).forEach((g) => {
      const d = isNum(g.delta);
      const tr = track(d, peak);
      tr.setAttribute("role", "img");
      tr.setAttribute("aria-label", g.group + " delta flow " + F.num(d, true));
      list.append(h("li", { class: "mk-sector" }, h("span", { class: "mk-sector-k", title: g.group, "data-short": NARROW[g.group] || null },
        h("span", { class: "mk-k-full" }, cap1(g.group === "mag7" ? "Mag 7" : g.group))), tr,
        h("span", { class: "mk-sector-v", "data-tone": toneOf(d) }, F.num(d, true), h("small", { class: "mk-unit" }, " Δ"))));
    });
    host.append(list);
    staleMark("mkGroupsCard", regime.sessionDate, "group flows");
    infoInto("mkGroupsCard", "groups", () => ({
      title: "Groups", lead: "Customer-signed delta flow for the session by industry group: positive is delta bought.",
      node: table("Group flows", [["Group"], ["Delta", true], ["Vega", true], ["Net premium", true], ["Purity", true]],
        rows.map((g) => [g.group, F.num(g.delta, true), F.num(g.vega, true), usdS(g.net), F.pct(g.purity, 0)])),
      notes: ["Purity is the directional delta over total delta traded: how one-sided the group's flow was."],
    }));
  }

  function paintUniverse(universe) {
    const host = clear("mkAdv");
    if (!host) return;
    const u = okFeed(universe) && universe.status === "ok" ? universe : null;
    const col = u && u.cols && Array.isArray(u.cols.chg) ? u.cols.chg : null;
    const scale = u && u.units && u.units.chg ? isNum(u.units.chg[1]) : null;
    if (!col || !scale) {
      if (!newGate(host, universe, "the universe", 200)) host.append(emptyLine("unavailable", (u && u.reason) || "The universe carried no price change column.", "advancers", 200));
      return;
    }
    const chg = col.map((c) => (isNum(c) === null ? null : c / scale)).filter((v) => v !== null);
    const up = chg.filter((v) => v > 0).length, down = chg.filter((v) => v < 0).length, flat = chg.length - up - down;
    const edges = [];
    for (let e = -0.05; e <= 0.0501; e += 0.005) edges.push(+e.toFixed(3));
    const bins = new Array(edges.length + 1).fill(0);
    for (const v of chg) {
      let i = edges.findIndex((e) => v < e);
      if (i < 0) i = edges.length;
      bins[i]++;
    }
    const labels = bins.map((_, i) => (i === 0 ? "< " + F.pct(edges[0], 1, true) : i === edges.length ? "> " + F.pct(edges[edges.length - 1], 1, true) : F.pct(edges[i - 1], 1, true)));
    host.append(UI.metrics([
      UI.metric("Advancers", String(up), { tone: "up", sub: chg.length ? F.pct(up / chg.length, 0) : null }),
      UI.metric("Decliners", String(down), { tone: "down", sub: chg.length ? F.pct(down / chg.length, 0) : null }),
      UI.metric("Unchanged", String(flat)),
    ], { min: 90 }));
    const plot = h("div", { class: "mk-hist" });
    host.append(plot);
    const colors = bins.map((_, i) => (i <= edges.indexOf(0) ? "--down-mark" : "--up-mark"));
    C.bars(plot, { values: bins, labels, colors, height: [140, 150, 160], maxWidth: 16,
      label: "Distribution of the session's price change across the screened universe",
      readout: (i) => [C.part(labels[i], "k"), h("b", null, bins[i] + " names")] });
    staleMark("mkAdvCard", u.sessionDate, "advancers");
    infoInto("mkAdvCard", "advancers", () => ({
      title: "Advancers", lead: "The session's price change for every eligible name in the screened universe, in half-point bins.",
      facts: [["Names", String(chg.length)], ["Screened", count(u.screened)], ["Session", u.sessionDate]],
      notes: ["Eligibility: price at least $5, market cap at least $1B, option volume at least 1,000 and open interest at least 5,000; ETFs, indexes and ADRs excluded."],
    }));
  }

  kit.attach({ paintSectors, paintMovers, paintAgainst, paintPulse, paintUniverse, paintExpiry, paintVol, paintRadar, paintGroups, uniRows, lensRepaint });
})();
