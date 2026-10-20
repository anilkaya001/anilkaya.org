(() => {
  "use strict";

  const UI = window.FlowsUI;
  const kit = UI && UI.homeKit;
  if (!kit) return;
  const { h, F, isNum, DASH, fmtSigned, fmtStamp, glyph } = UI;
  const C = UI.chart;
  const {
    $, ans, arr, rowsOf, cap1, capSaid, countSaid, sessionsSaid, disclose, POP, silent, hush, headMark, infoInto, table,
    earningsMark, nameNode, readerHref, toneOf, CROSS_SAID, CROSS_WORDS, NO_CARD_SAID, SHOW, LIST_MAX,
  } = kit;

  const CHANGE_MAX = 12;

  const CHANGE_SAID = "since each name's prior scored session";

  function changeLede(change, band, sessionRows, shedBy, shed) {
    const said = [];
    const dateAt = (i) => (sessionRows[i] && sessionRows[i].d) || null;
    const bandSaid = band === null
      ? "No dead band was published with this track, so no crossing can be claimed " +
        "and none is."
      : "The dead band is ±" + band + " score points wide.";

    if (!change) {
      said.push("This track published no pooled change summary, so the rows below " +
        "are the moves this payload carries rather than a share of a stated " +
        "population. " + bandSaid);
      return said.join(" ");
    }

    const n = (v) => isNum(v);
    const comparable = n(change.comparable), moved = n(change.moved), held = n(change.held);
    const consecutive = n(change.consecutive);
    const entered = n(change.entered), left = n(change.left);
    const cr = change.crossings || {};
    const cleared = n(cr.cleared), faded = n(cr.faded), flipped = n(cr.flipped);
    const from = change.prior || dateAt(sessionRows.length - 2);
    const to = change.session || dateAt(sessionRows.length - 1);

    if (change.status === "single-session") {
      said.push("The archive holds a single session" + (to ? " (" + to + ")" : "") +
        ", so there is nothing to compare it against. The first change lands once " +
        "a second session is archived.");
      said.push(bandSaid);
      return said.join(" ");
    }
    if (change.status === "cold") {
      said.push("No name in the pool was scored on two sessions inside this window, " +
        "so no change exists to report. That is the shape of the archive, not a " +
        "market that stood still.");
      said.push(bandSaid);
      return said.join(" ");
    }
    if (change.status === "flat") {
      said.push("Every one of the " + (comparable === null ? "compared" : comparable) +
        " names with two scored sessions held its score" +
        (from && to ? " between " + from + " and " + to : "") +
        ". Nothing moved, which is a reading about the session rather than a gap " +
        "in the archive.");
      said.push(bandSaid + " No name crossed it.");
      return said.join(" ");
    }

    said.push((moved === null ? "Some" : moved) + " of " +
      (comparable === null ? "the" : comparable) + " names with two scored sessions " +
      "moved" + (from && to ? " between " + from + " and " + to : "") +
      (held === null ? "" : "; " + held + " held their score") + ".");
    if (consecutive !== null && moved !== null) {
      said.push(consecutive + (comparable === null
        ? " of the comparisons below span"
        : " of the " + comparable + " comparisons span") +
        " a single session; the rest reach back further, and each row below " +
        "prints how far.");
    }
    if (cleared !== null && faded !== null && flipped !== null) {
      const total = cleared + faded + flipped;
      said.push(bandSaid + " " + (total === 0
        ? "No name crossed it this session, so everything below is drift."
        : total + (total === 1 ? " name" : " names") + " crossed it: " +
          cleared + " cleared, " + faded + " faded back inside, " + flipped +
          " flipped sides."));
    } else {
      said.push(bandSaid);
    }
    if (entered) {
      said.push(entered + (entered === 1 ? " name was" : " names were") +
        " scored for the first time in this window and " + (entered === 1 ? "has" : "have") +
        " no prior reading to compare against.");
    }
    if (left) {
      said.push(left + (left === 1 ? " name was" : " names were") +
        " scored on the prior session and not on this one.");
    }
    if (shedBy && shed) {
      said.push(shed + (shed === 1 ? " name is" : " names are") +
        " counted above but not carried on this payload — the " +
        (shedBy === "names" ? "row ceiling" : "byte ceiling") +
        " shed them, so the list below is shorter than the count.");
    }
    return said.join(" ");
  }

  function paintChanged(into, payload, cards, evBy, boardBy) {
    const sub = $("ccChgSub");
    const saySub = (said, spoken) => {
      if (!sub) return;
      sub.textContent = said || "";
      sub.setAttribute("aria-label", spoken ? spoken + " · " + CHANGE_SAID : CHANGE_SAID);
    };
    saySub(null);
    const list = $("ccChgList");
    const tiles = $("ccChgStats");
    if (list) list.replaceChildren();
    if (tiles) tiles.replaceChildren();
    if (silent(into, payload, "score track")) return;

    const names = arr(payload.names);
    const sessionRows = arr(payload.sessions);
    const change = payload.change && typeof payload.change === "object" ? payload.change : null;
    const notes = payload.notes && typeof payload.notes === "object" ? payload.notes : {};
    const band = isNum(payload.deadBand);
    const shedBy = typeof payload.shedBy === "string" ? payload.shedBy : null;
    const shed = isNum(payload.namesShed);

    const anyMove = names.some((nm) => nm && nm.d1);
    if (!change && !anyMove) {
      hush(into, "unavailable",
        "This score track was published without a change layer: no name carries a " +
        "d1 move and the payload states no session-level change. Nothing about " +
        "what moved can be read from it, and this page will not subtract two " +
        "scores itself — a difference with no session span attached is not a reading.", "what changed");
      return;
    }

    const lastIndex = sessionRows.length - 1;
    const dated = lastIndex >= 0;

    const moves = [];
    for (const nm of names) {
      const d1 = nm && nm.d1;
      if (!d1) continue;
      const v = isNum(d1.v), gap = isNum(d1.gap);
      if (v === null || gap === null) continue;
      const cross = typeof d1.cross === "string" ? d1.cross : null;
      if (v === 0 && !cross) continue;
      const at = isNum(nm.lastAt);
      moves.push({
        t: String(nm.t || ""), v, gap, cross,
        qv: isNum(d1.qv), at, now: isNum(nm.last), run: isNum(nm.run),
        ext: nm.ext && typeof nm.ext === "object" ? nm.ext : null,
        stale: dated && at !== null && at !== lastIndex,
      });
    }

    moves.sort((a, b) =>
      (a.cross ? 0 : 1) - (b.cross ? 0 : 1)
      || (a.stale ? 1 : 0) - (b.stale ? 1 : 0)
      || Math.abs(b.v) - Math.abs(a.v)
      || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

    const lede = changeLede(change, band, sessionRows, shedBy, shed);

    if (!moves.length) {
      const measured = change && change.status === "flat";
      const shedOut = change && change.status === "ok"
        ? " No name that moved is carried on this payload, so the count above " +
          "has no rows behind it — the row ceiling shed them."
        : "";
      hush(into, measured ? "empty" : "unavailable", lede + shedOut, "what changed");
      return;
    }

    if (change && tiles) {
      const crossings = change.crossings || {};
      const stat = (label, value, of, id, ring) => UI.metric(label, isNum(value) === null ? DASH : String(value),
        { id, sub: of || null, key: ring ? UI.key(ring, "ring", "") : null });
      tiles.append(UI.metrics([
        stat("Moved", change.moved, isNum(change.comparable) === null ? null : "of " + change.comparable, "chgMoved"),
        stat("Cleared", crossings.cleared, null, "chgCleared", "--up"),
        stat("Faded", crossings.faded, null, "chgFaded", "--label-2"),
        stat("Flipped", crossings.flipped, null, "chgFlipped", "--accent-ink"),
      ], { min: 72 }));
    }

    const drawn = moves.slice(0, CHANGE_MAX);
    saySub(countSaid(drawn.length, moves.length), capSaid(drawn.length, moves.length));

    const eventOf = (mv) => {
      let word = mv.cross ? CROSS_WORDS[mv.cross] : "drift";
      if (mv.ext && mv.at !== null) {
        const hiAt = isNum(mv.ext.hiAt), loAt = isNum(mv.ext.loAt);
        const extreme = hiAt === mv.at ? "window high" : loAt === mv.at ? "window low" : null;
        if (extreme) word += " · " + extreme;
      }
      return word;
    };
    const overOf = (mv) => {
      let said = sessionsSaid(mv.gap);
      const flags = [];
      if (mv.at !== null && mv.gap > 0) {
        const from = mv.at - mv.gap;
        let boardOnly = false, crossedEpoch = false;
        if (from >= 0 && mv.at < sessionRows.length) {
          for (let i = from; i <= mv.at; i++) {
            if (sessionRows[i] && sessionRows[i].source === "boards") boardOnly = true;
          }
          const a = sessionRows[from], b = sessionRows[mv.at];
          if (a && b && Boolean(a.preEpoch) !== Boolean(b.preEpoch)) crossedEpoch = true;
        }
        if (boardOnly) {
          said += " · board-only";
          flags.push(notes.backfill || "One of the sessions this comparison spans was reconstructed from " +
            "archived boards and is genuinely sparser.");
        }
        if (crossedEpoch) {
          said += " · across the epoch";
          flags.push(notes.epoch || "The two observations come from different selection pools.");
        }
      }
      return [said, flags.join(" ")];
    };
    const asOfOf = (mv) => {
      if (!dated || mv.at === null) return [DASH, "No session index was published for this name."];
      if (!mv.stale) return ["this session", null];
      const behind = lastIndex - mv.at;
      const on = (sessionRows[mv.at] && sessionRows[mv.at].d) || null;
      return [(on ? on : "an earlier session") + " · " + sessionsSaid(behind) + " back",
        "This name was not scored in the newest session, so its move is real and is not about today."];
    };

    if (list) {
      const rows = drawn.map((mv) => {
        const card = cards.has(mv.t);
        const [over, overWhy] = overOf(mv);
        const [asOf] = asOfOf(mv);
        const ern = earningsMark(boardBy.get(mv.t) || null, evBy.get(mv.t));
        const kids = [
          h("span", { class: "hm-ev", "data-cross": mv.cross || "drift", title: mv.cross ? CROSS_SAID[mv.cross] : null }, mv.cross ? CROSS_WORDS[mv.cross] : "drift"),
          h("span", { class: "hm-who" },
            h("span", { class: "hm-name" }, h("b", { class: "hm-t" }, mv.t), ern),
            h("span", { class: "hm-sub", title: overWhy || null }, mv.stale ? asOf : over)),
          h("span", { class: "hm-dv", "data-tone": toneOf(mv.v) }, fmtSigned(mv.v)),
          h("span", { class: "hm-end", "data-tone": toneOf(mv.now) }, fmtSigned(mv.now)),
        ];
        const said = mv.t + " " + eventOf(mv) + ", " + fmtSigned(mv.v) + " over " + over + ", now " + fmtSigned(mv.now);
        return card
          ? h("a", { class: "ui-row hm-crow cc-open" + (mv.stale ? " is-old" : ""), href: readerHref(mv.t), "aria-label": said, "data-ticker": mv.t }, kids)
          : h("div", { class: "ui-row hm-crow cc-flat" + (mv.stale ? " is-old" : ""), role: "listitem", title: NO_CARD_SAID, "aria-label": said, "data-ticker": mv.t }, kids);
      });
      list.append(UI.list(rows, { visible: SHOW, label: "What changed " + CHANGE_SAID }));
    }

    const facts = change ? [
      ["Compared", (isNum(change.comparable) ?? DASH) + " names"],
      ["Single-session", (isNum(change.consecutive) ?? DASH) + " comparisons"],
      ["Sessions", change.prior && change.session ? change.prior + " → " + change.session : null],
      ["Band", band === null ? "not published" : "±" + band + " score points"],
      ["Omitted", shed ? shed + " counted names" : null],
    ] : [];
    const detail = table("Every move " + CHANGE_SAID, [
      ["Event", false, notes.crossing || null],
      ["Name", false],
      ["Δ score", true, notes.change || null],
      ["Over", false, notes.gaps || null],
      ["Ended at", true, "The name's newest measured score, which on a dated row is not today's. " + (notes.score || "")],
      ["Δ resid ×10⁴", true, notes.saturation || null],
      ["Run · sessions", true, notes.run || null],
      ["As of", false, "The session this name was last scored on; an older move is real but not today's."],
    ], drawn.map((mv) => {
      const [over, overWhy] = overOf(mv);
      const [asOf, asWhy] = asOfOf(mv);
      return {
        attrs: { class: mv.stale ? "cc-old" : null },
        cells: [
          [eventOf(mv), mv.cross ? "cc-cross is-" + mv.cross : "cc-dim", mv.cross ? CROSS_SAID[mv.cross] : null],
          [mv.t, "cc-t"],
          [fmtSigned(mv.v), "c-num"],
          [over, null, overWhy || null],
          [fmtSigned(mv.now), "c-num"],
          [mv.qv === null ? DASH : fmtSigned(mv.qv), "c-num"],
          [mv.run === null ? DASH : String(mv.run), "c-num",
            mv.run === null ? "This payload published no run length for the name."
              : mv.run === 0 ? "The newest score is exactly zero, which belongs to neither side and ends the run."
                : sessionsSaid(mv.run) + " in a row on this sign. A run of one is a new opinion; a run of thirty is an old one."],
          [asOf, "cc-date", asWhy],
        ],
      };
    }));
    infoInto("hmChg", "what changed", () => ({
      title: "What changed", lead: lede, facts,
      notes: ["Crossings of the dead band lead, then fresh drift by size; readings that are not about today are dated and demoted."],
      node: detail,
    }));
  }

  function zeroShareOf(reg, breadth) {
    const lb = ans(breadth) && breadth.dte && breadth.dte.share ? breadth : null;
    const z = reg && reg.zeroDte && reg.zeroDte.status === "ok" ? reg.zeroDte : null;
    if (lb && isNum(lb.dte.share.value) !== null && (!reg || !reg.sessionDate || (lb.session && lb.session >= reg.sessionDate))) {
      return { share: isNum(lb.dte.share.value), src: "live:breadth" };
    }
    return z ? { share: isNum(z.share), src: "regime" } : { share: null, src: null };
  }

  function paintVol(regime, liveVol, liveBreadth) {
    const into = $("ccVol");
    if (!into) return;
    into.replaceChildren();
    headMark("hmVol", null);
    const reg = ans(regime);
    const curve = reg && reg.volCurve && reg.volCurve.byIndex ? reg.volCurve.byIndex : null;
    const lv = ans(liveVol) && liveVol.index ? liveVol : null;
    const useLive = lv && (!reg || !reg.sessionDate || (lv.session && lv.session >= reg.sessionDate));
    const TEN = [1, 5, 7, 14, 30, 60, 90, 180, 365];
    const idx = {};
    for (const k of ["SPY", "QQQ", "IWM"]) {
      if (useLive && lv.index[k] && lv.index[k].status === "ok") {
        const r = lv.index[k];
        const rv20 = isNum(r.rv) === null && curve && curve[k] && curve[k].status === "ok" ? isNum(curve[k].rv20) : null;
        idx[k] = { iv: TEN.map((d) => isNum(r["v" + d])), iv30: isNum(r.iv30), ivp: isNum(r.ivRank), ivpWord: "rank",
          rv: rv20 ?? isNum(r.rv), rvWord: rv20 === null ? "RV" : "RV 20d",
          ts: isNum(r.v30) !== null && isNum(r.v90) ? r.v30 / r.v90 - 1 : null, src: "live:vol" };
      } else if (curve && curve[k] && curve[k].status === "ok" && Array.isArray(curve[k].iv)) {
        const r = curve[k];
        const ten = Array.isArray(r.tenors) ? r.tenors : TEN;
        idx[k] = { iv: TEN.map((d) => { const j = ten.indexOf(d); return j < 0 ? null : isNum(r.iv[j]); }),
          iv30: isNum(r.iv[ten.indexOf(30)]), ivp: isNum(r.ivp), ivpWord: "pct", rv: isNum(r.rv20), rvWord: "RV 20d",
          ts: isNum(r.ts), shape: r.shape || null, src: "regime" };
      }
    }
    const names = Object.keys(idx);
    if (!names.length) {
      if (!regime && !liveVol) hush(into, "unreadable", "Neither the regime key nor the live volatility key could be read.", "volatility", 220);
      else hush(into, "pending", "The index volatility curve arrives with the regime key and the live volatility layer; neither has published a curve yet.", "volatility", 220);
      return;
    }
    const spy = idx.SPY || idx[names[0]];
    const shape = spy.shape || (spy.ts === null ? null : spy.ts < 0 ? "contango" : spy.ts > 0 ? "backwardation" : "flat");
    const ic = reg && reg.impliedCorrelation && reg.impliedCorrelation.byIndex ? reg.impliedCorrelation.byIndex : {};
    const rho = ic.SPY && ic.SPY.status === "ok" ? isNum(ic.SPY.rho) : null;
    const rhoQ = ic.QQQ && ic.QQQ.status === "ok" ? isNum(ic.QQQ.rho) : null;
    const zero = zeroShareOf(reg, liveBreadth);
    const share0 = zero.share;
    const pend = (what) => ({ state: "pending", reason: what + " arrives with the regime key, which has not published yet." });
    const vrp = spy.iv30 !== null && spy.rv !== null && spy.rv !== undefined ? spy.iv30 - spy.rv : null;
    const disp = ic.SPY && ic.SPY.status === "ok" ? isNum(ic.SPY.dispersion) : null;
    into.append(UI.metrics([
      UI.metric("IV 30d", spy.iv30 === null ? DASH : F.pct(spy.iv30, 1), { sub: (idx.SPY ? "SPY" : names[0]) + (spy.ivp === null ? "" : " · " + spy.ivpWord + " " + Math.round(spy.ivp)) }),
      UI.metric(spy.rvWord, spy.rv === null || spy.rv === undefined ? DASH : F.pct(spy.rv, 1), { sub: vrp === null ? null : "IV − RV " + F.pts(vrp) + " pts" }),
      UI.metric("Term", shape ? cap1(shape) : DASH, { tone: shape === "backwardation" ? "warn" : null,
        sub: spy.ts === null ? null : "30/90 " + F.pct(spy.ts, 1, true), state: shape ? null : pend("The term shape") }),
      UI.metric("Correlation", rho === null ? DASH : rho.toFixed(2), { sub: rhoQ === null ? null : "QQQ " + rhoQ.toFixed(2), state: rho === null ? pend("Implied correlation") : null }),
      UI.metric("Dispersion", disp === null ? DASH : F.pts(disp), { unit: disp === null ? null : "pts", sub: disp === null ? null : "SPY members", state: disp === null ? pend("Dispersion") : null }),
      UI.metric("0DTE share", share0 === null ? DASH : F.pct(share0, 0), { state: share0 === null ? pend("The 0DTE share") : null }),
    ], { min: 96 }));
    const radar = ans(reg && reg.volRadar);
    const side = (s) => (radar && radar[s] && Array.isArray(radar[s].rows) ? radar[s].rows.slice(0, 4) : []);
    const tagRow = (word, rows, tone) => h("div", { class: "hm-radar-r" }, h("span", { class: "hm-radar-k" }, word),
      rows.length ? rows.map((r) => (r.carded
        ? h("a", { class: "hm-chiplink", href: readerHref(r.t), "data-tone": tone }, r.t)
        : h("span", { class: "hm-chiplink", "data-tone": tone }, r.t))) : h("span", { class: "ui-dash" }, DASH));
    if (radar) into.append(h("div", { class: "hm-radar" }, tagRow("Rich", side("rich"), "short"), tagRow("Cheap", side("cheap"), "long")));
    const sess = (reg && reg.sessionDate) || (lv && lv.session) || null;
    const expected = UI.freshness.market().expected;
    if (sess && sess < expected) {
      headMark("hmVol", h("button", {
        class: "ui-state hm-mark", type: "button", "data-state": "stale", title: "Stale", "aria-label": "Stale: volatility",
        ...POP,
        "data-info": disclose("Volatility", "These readings are the " + F.day(sess) + " session; the last completed session is " + F.day(expected) + ".", { state: "stale" }),
      }, glyph("clock")));
    }
    infoInto("hmVol", "volatility", () => ({
      title: "Volatility", asOf: sess ? "Session " + F.day(sess) : null,
      lead: "The index ETFs' fixed-tenor implied volatility stands in for the VIX curve, which the vendor plan does not serve.",
      facts: [["Source", spy.src], ["SPY 30d", spy.iv30 === null ? DASH : F.pct(spy.iv30, 1)],
        ["Term slope 30/90", spy.ts === null ? DASH : F.pct(spy.ts, 1, true)],
        ["Implied correlation SPY", rho === null ? DASH : rho.toFixed(3)], ["Implied correlation QQQ", rhoQ === null ? DASH : rhoQ.toFixed(3)],
        ["Dispersion", disp === null ? DASH : F.pts(disp) + " vol pts"],
        ["0DTE share of net premium", share0 === null ? DASH : F.pct(share0, 1)], ["0DTE share source", zero.src]],
      notes: ["Contango (a rising curve) is the calm shape; an inverted front is stress.",
        "Implied correlation is the index variance left after the members' own variances, over what perfect correlation would add.",
        "Dispersion is the SPY members' weighted 30-day IV minus SPY's own, in vol points.",
        "The 0DTE share is |0DTE net| over |0DTE net| + |weekly net|, from the live breadth layer when it is as new as the regime key.",
        radar ? "Rich and cheap are the vendor's volatility anomaly screen; a linked name has a card today." : null],
    }));
  }

  const moveSaid = (v) => {
    const im = isNum(v);
    return im === null ? DASH : "±" + (Math.abs(im) * 100).toFixed(1) + "%";
  };

  const weekdaysAfter = (a, b) => {
    let n = 0;
    const end = Date.parse(b + "T12:00:00Z");
    for (let t = Date.parse(a + "T12:00:00Z") + 864e5, i = 0; t <= end && i < 400; t += 864e5, i++) if (![0, 6].includes(new Date(t).getUTCDay())) n++;
    return n;
  };
  const isDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
  function aheadOf(sd, origin, today) {
    if (sd === null) return null;
    if (!isDay(origin) || !isDay(today) || origin === today) return sd;
    return today < origin ? sd + 1 : sd - weekdaysAfter(origin, today);
  }
  const aheadSaid = (n) => (n === null ? "" : n < 0 ? " · past" : n === 0 ? " · today" : n === 1 ? " · next session" : " · in " + n + " sessions");

  function paintEvents(into, payload) {
    if (silent(into, payload, "events calendar")) return;
    const rows = rowsOf(payload);
    if (!rows.length) {
      hush(into, "empty", "No name in the screened universe reports inside the window.", "reporting soon");
      return;
    }
    const drawn = rows.slice(0, LIST_MAX);
    const scored = drawn.filter((row) => isNum(row && row.s) !== null).length;
    const opinionless = drawn.length - scored;
    const lede = scored + " of the " + drawn.length + " name" +
      (drawn.length === 1 ? "" : "s") + " drawn carr" +
      (scored === 1 ? "ies" : "y") + " a score" +
      (opinionless
        ? " and " + opinionless + " reached this calendar with none, so the boards hold no " +
          "opinion on " + (opinionless === 1 ? "it" : "them") + " going into the print."
        : ", so every name here can be read against the ranking above.");
    const today = UI.freshness.market().today;
    const ahead = (row) => aheadOf(isNum(row.sdte), payload.gateOrigin, today);
    const list = drawn.map((row) => {
      return UI.listRow({
        primary: row.t || DASH,
        secondary: (row.d ? F.day(row.d) : DASH) + aheadSaid(ahead(row)),
        value: moveSaid(row.im),
        signed: isNum(row.s) === null ? h("span", { class: "hm-tag", title: row.st === "gated" ? "The board was forbidden from holding an opinion on this name." : "No score was published for this name." }, row.st === "gated" ? "gated" : "unscored") : fmtSigned(row.s),
        signedValue: isNum(row.s), signedTone: isNum(row.s) === null ? "silent" : undefined,
        cols: "minmax(0,1fr) 60px 58px",
      });
    });
    const label = "Names reporting inside the window";
    into.append(UI.list(list, { visible: SHOW, label }));
    const detail = table(label, [
      ["Name", false], ["Date", false], ["Sessions from today", true, "0 is a report today, 1 the next session; past means the date is before today."], ["Priced move", true], ["Score", true],
      ["Stage", false, "Where this name stopped in the run's funnel. \"gated\" means the board was forbidden from holding an opinion on it, not that it had none."],
    ], drawn.map((row) => {
      return {
        cells: [[row.t || DASH, "cc-t"], [row.d || DASH, "cc-date"],
          [ahead(row) === null ? DASH : ahead(row) < 0 ? "past" : String(ahead(row)), "c-num"],
          [moveSaid(row.im), "c-num"],
          [fmtSigned(row.s), "c-num"], [row.st || DASH, "cc-dim"]],
      };
    }));
    const inWindow = isNum(payload.inWindow);
    infoInto("hmEvents", "reporting soon", () => ({
      title: "Reporting soon", lead: lede,
      facts: [["Reporting in the window", inWindow === null ? String(rows.length) : String(inWindow)]],
      notes: ["The value is the move the options price into the report; the signed number is the board score."],
      node: detail,
    }));
  }

  function agoSaid(fromMs, now) {
    const d = now - fromMs;
    if (d < 0) return null;
    const mins = Math.floor(d / 60000);
    if (mins < 1) return "under a minute ago";
    if (mins < 60) return mins + " min ago";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h" + (mins % 60 ? " " + (mins % 60) + "m" : "") + " ago";
    const days = Math.floor(hours / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  const NEWS_TICKERS = 4;

  function paintNews(into, payload, cards, now) {
    const sub = $("ccNewsSub");
    if (sub) sub.textContent = "";
    if (silent(into, payload, "headlines feed", 64)) return;
    if (payload.status === "quiet") {
      hush(into, "empty",
        "The headlines feed was read and the vendor returned no rows: a measurement — the " +
        "feed was checked and was empty — and not a request that failed.", "headlines", 64);
      return;
    }
    if (payload.status === "unreadable") {
      hush(into, "unreadable",
        "The headlines feed returned rows and not one carried a headline, so nothing here " +
        "is publishable. A fault on the wire between the vendor and this pipeline, not a " +
        "quiet news day.", "headlines", 64);
      return;
    }
    const rows = rowsOf(payload);
    if (!rows.length) {
      hush(into, "unavailable",
        "This payload carried no headline rows: the key published, and the list this region " +
        "is made of is not on it.", "headlines", 64);
      return;
    }
    const stamp = typeof payload.readAt === "string" ? Date.parse(payload.readAt) : NaN;
    const readMs = Number.isFinite(stamp) ? stamp : null;
    const readAge = readMs === null ? null : agoSaid(readMs, now);

    const said = [];
    if (readMs === null) {
      said.push("This payload states no read time, so how long ago these headlines were " +
        "fetched cannot be said. Treat every row below as being of unknown age rather " +
        "than as something that just happened.");
    } else {
      said.push("Fetched at " + (fmtStamp(payload.readAt) || DASH) +
        (readAge === null ? ", which is ahead of this browser's clock, so no age can be stated" : ", " + readAge) + ".");
    }
    if (payload.live) said.push("This feed is re-read every " + payload.cadenceMinutes + " minutes while the market is open.");
    else if (typeof payload.cadence === "string" && payload.cadence) {
      said.push("This feed is fetched " + payload.cadence +
        (typeof payload.staleBy === "string" && payload.staleBy ? " and is stale by " + payload.staleBy : "") +
        ", so it is a once-a-day read and never a live feed.");
    }
    const kept = isNum(payload.kept);
    const oldestAt = typeof payload.oldest === "string" ? Date.parse(payload.oldest) : NaN;
    if (Number.isFinite(oldestAt)) {
      const oldAge = agoSaid(oldestAt, now);
      if (oldAge) {
        said.push("The oldest of the " + (kept === null ? "stored" : kept + " stored") +
          " rows is " + oldAge.replace(/ ago$/, " old") + ".");
      }
    }
    const requested = isNum(payload.requested), returned = isNum(payload.returned);
    const cap = isNum(payload.cap), shed = isNum(payload.shed);
    if (payload.atVendorLimit === true) {
      said.push("The vendor returned " + (returned === null ? "its own maximum number of rows" : returned + " rows") +
        (requested === null ? "" : " against the " + requested + " asked for") +
        ", which is its documented ceiling — so the true population is UNKNOWN and at least that large.");
    }
    if (payload.capped === true && shed !== null && shed > 0) {
      said.push("Our own " + (cap === null ? "row cap" : cap + "-row cap") + " then shed " +
        shed + " row" + (shed === 1 ? "" : "s") + ", newest kept. That is a different fact " +
        "from the ceiling: these rows arrived and were dropped here, so their number is known.");
    }
    const unusable = isNum(payload.unusable);
    if (unusable !== null && unusable > 0) {
      said.push(unusable + (unusable === 1 ? " row" : " rows") +
        " arrived with no headline at all and went unpublished: counted, not rendered blank.");
    }
    const undatedKept = isNum(payload.undatedKept), undatedSeen = isNum(payload.undatedSeen);
    if (undatedKept !== null && undatedKept > 0) {
      said.push(undatedKept + (undatedKept === 1 ? " stored row carries" : " of the stored rows carry") +
        " no timestamp and cannot be aged; " + (undatedKept === 1 ? "it sorts" : "they sort") + " last rather than being dated to now.");
    } else if (undatedSeen !== null && undatedSeen > 0) {
      said.push(undatedSeen + " undated " + (undatedSeen === 1 ? "row" : "rows") +
        " arrived on the wire and the cap shed " + (undatedSeen === 1 ? "it" : "them") + " before this list, so every row below can be aged.");
    }
    const unflagged = rows.filter((r) => r && (r.major === null || r.major === undefined)).length;
    if (unflagged) {
      said.push(unflagged + (unflagged === 1 ? " stored row carried" : " of the stored rows carried") +
        " no major/minor flag at all, which is not the same as having been flagged not-major.");
    }
    const cadence = payload.live ? "Intraday snapshot" : typeof payload.cadence !== "string" ? "Snapshot; cadence not specified"
      : /after the close/i.test(payload.cadence) ? "After-close snapshot"
        : /morning/i.test(payload.cadence) ? "Morning snapshot" : "Snapshot; cadence not specified";
    const coverage = [readAge ? "Fetched " + readAge : "Fetch age unknown", cadence];
    if (payload.atVendorLimit === true) coverage.push("Vendor ceiling reached; total unknown");
    if (payload.capped === true && shed > 0) coverage.push(shed + " received rows omitted");
    if (undatedKept > 0) coverage.push(undatedKept + " undated rows");

    const listNode = h("div", { class: "hm-news" },
      h("p", { class: "cc-nw-note" }, said.join(" ")),
      h("ul", { class: "cc-nw" }, rows.slice(0, LIST_MAX).map((row) => {
        const at = isNum(row && row.createdAtMs);
        const age = at === null ? null : agoSaid(at, now);
        const tickers = arr(row && row.tickers)
          .map((raw) => (typeof raw === "string" ? raw.trim().toUpperCase() : "")).filter(Boolean);
        return h("li", { class: "cc-nw-row" },
          h("p", { class: "cc-nw-h" }, typeof row.headline === "string" && row.headline ? row.headline : DASH),
          h("p", { class: "cc-nw-m" },
            h("span", { class: "cc-nw-age", title: at === null ? "This row carried no timestamp, so its age is not known and none is claimed."
              : "The vendor's own stamp, verbatim: " + (typeof row.createdAt === "string" ? row.createdAt : String(at)) },
            at === null ? "undated" : (age === null ? "stamped ahead of this clock" : age)),
            typeof row.source === "string" && row.source ? h("span", { class: "cc-nw-src" }, row.source) : null,
            typeof row.sentiment === "string" && row.sentiment
              ? h("span", { class: "cc-nw-sent", title: "The vendor's sentiment label, verbatim: not this product's score and not an input to it." }, row.sentiment) : null,
            row && row.major === true ? h("span", { class: "cc-nw-major", title: "The vendor flagged this headline as major." }, "major") : null,
            tickers.length ? h("span", { class: "cc-nw-tks" },
              tickers.slice(0, NEWS_TICKERS).map((t) => (cards.has(t) ? nameNode(t, true)
                : h("span", { class: "cc-nw-tk", title: "Named by the vendor on this headline; no card was built for it." }, t))),
              tickers.length > NEWS_TICKERS ? h("span", { class: "cc-nw-more" }, "+" + (tickers.length - NEWS_TICKERS) + " more") : null) : null));
      })));

    const first = rows[0] || {};
    const at0 = isNum(first.createdAtMs);
    const shown = Math.min(rows.length, LIST_MAX);
    into.append(h("button", {
      class: "hm-news-open", type: "button", ...POP,
      "data-info": UI.info(() => ({ title: "Headlines", lead: coverage.join(" · "), node: listNode })),
    },
    h("span", { class: "hm-news-h" }, typeof first.headline === "string" ? first.headline : DASH),
    h("span", { class: "hm-news-a" }, at0 === null ? "undated" : agoSaid(at0, now) || ""),
    h("span", { class: "hm-news-n" }, "All " + shown), glyph("next")));
    if (sub) {
      sub.textContent = countSaid(shown, kept === null ? rows.length : kept);
      sub.setAttribute("aria-label", capSaid(shown, kept === null ? rows.length : kept) + (readAge === null ? "" : " · fetched " + readAge));
    }
  }

  function renderSpine(payload) {
    const plot = $("spinePlot");
    if (!plot) return;
    const band = isNum(payload.deadBand);
    const scored = isNum(payload.scored);
    const neutral = isNum(payload.neutral);
    const moves = payload.__moves instanceof Map ? payload.__moves : new Map();
    C.mount(plot, (host, W, animate) => spineDraw(host, W, animate, payload, band, scored, neutral, moves));
  }

  function spineDraw(host, W, animate, payload, band, scored, neutral, moves) {
    const padX = 14;
    const plotW = W - padX * 2;
    const xOf = (sc) => padX + ((sc + 100) / 200) * plotW;
    const marks = [];
    for (const [rows, cls] of [[payload.__bull, "is-bull"], [payload.__bear, "is-bear"]]) {
      for (const r of rows || []) {
        const sc = isNum(r.s);
        if (sc === null) continue;
        const t = String(r.t || "");
        const mv = moves.get(t) || null;
        const usable = Boolean(mv && mv.current && mv.last !== null && mv.last === sc);
        marks.push({ s: sc, t, cls, mv, usable, v: usable ? isNum(mv.d1.v) : null, gap: usable ? isNum(mv.d1.gap) : null,
          cross: usable && typeof mv.d1.cross === "string" ? mv.d1.cross : null, on: mv && mv.on ? mv.on : null, x: xOf(sc), dy: 0 });
      }
    }
    const r = marks.length > 60 ? 3.4 : 4.5;
    const step = r * 2 + 0.8;
    const placed = [];
    let reach = 0;
    for (const m of marks.slice().sort((a, b) => a.x - b.x)) {
      for (let k = 0; k < 15; k++) {
        const off = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * step;
        const hit = placed.some((p) => Math.abs(p.x - m.x) < step && Math.abs(p.dy - off) < step);
        if (!hit || k === 14) { m.dy = off; break; }
      }
      placed.push(m);
      reach = Math.max(reach, Math.abs(m.dy));
    }
    const half = reach + r + 6;
    const axisY = 26 + half;
    const H = Math.round(axisY + half + 30);
    const svg = C.svgRoot(host, W, H, animate, "");
    svg.setAttribute("class", "sp");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const s = UI.s;
    const defs = s("defs", null, svg);
    const pat = s("pattern", { id: "spBand", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)", class: "sp-bandpat" }, defs);
    s("line", { x1: 3, y1: 0, x2: 3, y2: 6, stroke: "currentColor", "stroke-width": 1.2 }, pat);
    if (band !== null) {
      s("rect", { class: "sp-band", x: xOf(-band), y: axisY - half, width: xOf(band) - xOf(-band), height: half * 2, rx: 4, fill: "url(#spBand)" }, svg);
    }
    s("line", { class: "sp-axis base", x1: padX, x2: W - padX, y1: axisY, y2: axisY }, svg);
    for (const v of [-100, -50, 0, 50, 100]) {
      s("line", { class: "sp-tick", x1: xOf(v), x2: xOf(v), y1: axisY + half + 2, y2: axisY + half + 6 }, svg);
      s("text", { class: "sp-ticklabel", x: xOf(v), y: axisY + half + 19, "text-anchor": "middle", text: v === 0 ? "0" : fmtSigned(v, 0) }, svg);
    }
    s("text", { class: "sp-bandlabel", x: xOf(0), y: axisY - half - 8, "text-anchor": "middle",
      text: band === null ? "no dead band published for this session · the axis is drawn without one"
        : neutral === 0 ? "±" + band + " band · empty"
          : scored !== null && neutral !== null ? neutral + " of " + scored + " inside ±" + band + " · not named"
            : "±" + band + " dead band · not named" }, svg);

    let trails = 0;
    for (const m of marks) {
      if (m.v === null || m.v === 0 || m.gap === null || !m.cross) continue;
      const from = Math.max(-100, Math.min(100, m.s - m.v));
      const trail = s("line", {
        class: "sp-move " + m.cls + (m.gap > 1 ? " is-gapped" : ""),
        x1: xOf(from), x2: xOf(m.s), y1: axisY + m.dy, y2: axisY + m.dy,
        "stroke-dasharray": m.gap > 1 ? "3 2.5" : null,
      }, svg);
      s("title", { text: m.t + " " + fmtSigned(m.v, 0) + " over " + sessionsSaid(m.gap) + ", from " + fmtSigned(m.s - m.v, 0) }, trail);
      trails++;
    }
    for (const m of marks) {
      if (m.cross) s("circle", { class: "sp-cross is-" + m.cross, cx: m.x, cy: axisY + m.dy, r: r + 3 }, svg);
    }
    for (const m of marks) {
      const dot = s("circle", { class: "sp-dot " + m.cls, cx: m.x, cy: axisY + m.dy, r, "data-t": m.t }, svg);
      s("title", { text: m.t + " " + fmtSigned(m.s, 0) +
        (m.v !== null && m.gap !== null ? ", " + fmtSigned(m.v, 0) + " over " + sessionsSaid(m.gap)
          : m.on ? ", last scored " + m.on : "") +
        (m.cross ? " · " + m.cross : "") }, dot);
    }
    const said = "Score axis from minus 100 to plus 100. " +
      (neutral !== null && scored !== null
        ? neutral + " of " + scored + " names scored inside the " +
          (band === null ? "dead band, whose width this payload does not state," : "plus or minus " + band + " dead band") +
          " and are not published. "
        : "") +
      ((payload.__bull || []).length) + " bullish and " + ((payload.__bear || []).length) + " bearish names cleared it." +
      (trails ? " " + trails + " that crossed the band trail the move since their previous scored session." : "");
    svg.setAttribute("aria-label", said);
    if (!marks.length) return;
    const byScore = new Map();
    for (const m of marks) {
      if (!byScore.has(m.s)) byScore.set(m.s, []);
      byScore.get(m.s).push(m);
    }
    const scores = [...byScore.keys()].sort((a, b) => a - b);
    C.scrub(host, svg, {
      xs: scores.map(xOf), top: axisY - half, bottom: axisY + half, label: "Every cleared name on the score axis",
      onMove: (i) => {
        const at = byScore.get(scores[i]);
        const parts = [C.part(fmtSigned(scores[i], 0), "k")];
        for (const m of at.slice(0, 4)) {
          parts.push(h("b", null, m.t));
          parts.push(C.part(m.v !== null && m.gap !== null ? fmtSigned(m.v, 0) + " over " + sessionsSaid(m.gap)
            : m.on ? "last scored " + m.on : "no earlier session", "k"));
        }
        if (at.length > 4) parts.push(C.part("+" + (at.length - 4) + " more", "k"));
        return { parts, top: Math.max(0, axisY - half - 34), dots: at.slice(0, 4).map((m) => ({ x: m.x, y: axisY + m.dy, color: scores[i] > 0 ? "--up" : scores[i] < 0 ? "--down" : "--label-3" })) };
      },
    });
  }

  kit.attach({ paintChanged, paintVol, paintEvents, paintNews, renderSpine });
})();
