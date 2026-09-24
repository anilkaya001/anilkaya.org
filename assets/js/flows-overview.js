(() => {
  "use strict";

  const statusEl = document.getElementById("flowsStatus");
  const staleEl = document.getElementById("flowsStale");

  const UI = window.FlowsUI;
  if (!UI) {
    if (statusEl) {
      statusEl.textContent = "The shared UI library did not load, so this page " +
        "cannot draw. Nothing here is a reading about the session — refresh to try again.";
    }
    return;
  }
  const { h, F, isNum, DASH, MINUS, fmtSigned, fmtStamp, scoreStrip, glyph } = UI;
  const C = UI.chart;

  const $ = (id) => document.getElementById(id);
  const POP = { "aria-haspopup": "dialog", "aria-controls": "fxPop" };
  const verdictHost = $("ccVerdict");
  if (!statusEl || !verdictHost) return;

  const ROW_MAX = 10;
  const LIST_MAX = 8;
  const CHANGE_MAX = 12;
  const SHOW = 5;

  const NO_CARD_SAID =
    "No detail card: the chain and the card cost vendor calls the run spends " +
    "only on the names furthest from neutral. This row is scored and ranked " +
    "from the same five sources as every other.";

  const pct = (v, dp) => {
    const n = isNum(v);
    return n === null ? DASH : fmtSigned(n * 100, dp === undefined ? 2 : dp) + "%";
  };

  const usd = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const sign = n < 0 ? MINUS : "";
    const a = Math.abs(n);
    if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(0) + "K";
    return sign + "$" + a.toFixed(0);
  };
  const usdS = (v) => {
    const n = isNum(v);
    return n !== null && n > 0 ? "+" + usd(n) : usd(n);
  };

  const etTime = (at) => {
    if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(at.trim())) {
      return null;
    }
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(d);
    } catch { return null; }
  };
  const NY_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const NY_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const clock = (at) => {
    const t = Date.parse(at);
    return Number.isFinite(t) ? NY_CLOCK.format(new Date(t)) : DASH;
  };
  const nyMinutes = (at) => {
    const t = Date.parse(at);
    if (!Number.isFinite(t)) return null;
    const p = Object.fromEntries(NY_PARTS.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return (+p.hour % 24) * 60 + +p.minute;
  };
  const hourTicks = (lo, hi, step) => {
    const out = [];
    const every = step || 60;
    for (let m = Math.ceil(lo / every) * every; m <= hi; m += every) {
      const hr = m / 60;
      out.push({ v: m, label: (hr % 12 || 12) + (hr < 12 ? " AM" : " PM") });
    }
    return out;
  };

  const sessionsSaid = (n) => n + (n === 1 ? " session" : " sessions");
  const daysSaid = (n) => n + (n === 1 ? " calendar day" : " calendar days");

  const capSaid = (shown, of) => (of > shown ? shown + " of " + of : "all " + of);
  const countSaid = (shown, of) => (of > shown ? shown + " of " + of : String(of));

  const toneOf = (v) => {
    const n = isNum(v);
    return n === null ? null : n > 0 ? "up" : n < 0 ? "down" : "flat";
  };

  const KIND = {
    pending: ["pending", "Pending"],
    empty: ["quiet", "Quiet"],
    unavailable: ["unavailable", "Unavailable"],
    unreadable: ["stop", "Unreadable"],
  };
  const disclose = (title, lead, more) => UI.info(() => Object.assign({ title, lead }, more || {}));

  function hush(into, kind, text, what, height) {
    const [g, word] = KIND[kind] || KIND.unavailable;
    into.append(h("div", {
      class: "ui-silent hm-hush", "data-empty": kind, "data-state": kind, role: "note",
      "aria-label": word + ": " + what, style: { "--silent-h": (height || 112) + "px" },
    },
    glyph(g), h("div", { class: "ui-silent-t" }, word),
    h("button", { type: "button", ...POP, "data-info": disclose(cap1(what), text) }, "Why")));
    return true;
  }

  function mark(kind, text, label) {
    const [g, word] = KIND[kind] || KIND.unavailable;
    return h("button", {
      class: "ui-state hm-mark", type: "button", "data-empty": kind, "data-state": kind, title: word,
      "aria-label": word + ": " + label, ...POP,
      "data-info": disclose(cap1(label), text),
    }, glyph(g));
  }

  const cap1 = (t) => (typeof t === "string" && t ? t[0].toUpperCase() + t.slice(1) : t);

  function silent(into, payload, what, height) {
    if (!payload) {
      return hush(into, "unreadable",
        "The " + what + " could not be read, so this region is blank. That is a " +
        "fault on this page and not a fact about the session — refresh to try again.", what, height);
    }
    if (payload.status === "pending") {
      return hush(into, "pending",
        "The " + what + " has not been published for this session yet. Nothing has " +
        "been measured here, so nothing is being claimed.", what, height);
    }
    return false;
  }

  function infoInto(sectionId, label, build) {
    const head = document.querySelector("#" + sectionId + " .ui-mod-h");
    if (!head) return;
    const old = head.querySelector(":scope > .ui-info");
    if (old) old.remove();
    head.append(UI.infoButton(label, build));
  }

  function headMark(sectionId, node) {
    const t = document.querySelector("#" + sectionId + " .ui-mod-t");
    if (!t) return;
    for (const old of t.querySelectorAll(".hm-mark")) old.remove();
    if (node) t.append(node);
  }

  function table(label, heads, rows) {
    return h("div", { class: "hm-tw", role: "region", "aria-label": label, tabindex: "0" },
      h("table", { class: "hm-tbl" },
        h("thead", null, h("tr", null, heads.map(([t, num, said]) =>
          h("th", { scope: "col", class: num ? "c-num" : null, title: said || null }, t)))),
        h("tbody", null, rows.map((r) => h("tr", r.attrs || null, r.cells.map((c) => {
          const cell = Array.isArray(c) ? c : [c];
          return h("td", { class: cell[1] || null, title: cell[2] || null }, cell[0]);
        }))))));
  }

  const rowCount = (payload) =>
    payload && payload.status !== "pending" && Array.isArray(payload.rows)
      ? payload.rows.length : null;

  const poolCount = (payload) => {
    const rows = rowCount(payload);
    return rows === null ? null : (isNum(payload.cleared) ?? rows);
  };

  function ranked(rows) {
    const list = (Array.isArray(rows) ? rows : []).slice();
    const published = list.length > 0 && list.every((r) => isNum(r && r.r) !== null);
    if (published) { list.sort((a, b) => isNum(a.r) - isNum(b.r)); return list; }

    list.sort((a, b) => {
      const av = isNum(a && a.s), bv = isNum(b && b.s);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return Math.abs(bv) - Math.abs(av);
    });
    return list;
  }

  const readerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(t) + "&s=signal&from=overview";

  function nameNode(t, hasCard) {
    if (!t) return h("span", { class: "cc-flat" }, DASH);
    if (!hasCard) return h("span", { class: "cc-flat", title: NO_CARD_SAID }, t);
    return h("a", { class: "cc-open", href: readerHref(t), title: "Open the full reader for " + t }, t);
  }

  function earningsMark(row, ev) {
    const s = isNum(ev && ev.sdte);
    const d = isNum(row && row.edte);
    const date = (ev && ev.d) || (row && row.ed) || null;
    let text = null, said = null;
    if (s !== null) { text = s + "s"; said = sessionsSaid(s) + " away"; }
    else if (d !== null) { text = d + "d"; said = daysSaid(d) + " away"; }
    else if (date) { text = ""; said = null; }
    if (text === null) return null;
    const title = "Reports " + (date || "inside the events window") +
      (said ? " · " + said : "") +
      ". A signal carried into a print stops being the signal that was ranked.";
    const near = (s !== null && s <= 5) || (s === null && d !== null && d <= 7);
    return h("span", { class: "hm-tag cc-ern" + (near ? " is-near" : ""), title, "aria-label": title }, glyph("cal"), text);
  }

  const CROSS_WORDS = { cleared: "cleared", faded: "faded", flipped: "flipped" };
  const CROSS_SAID = {
    cleared: "Was inside the dead band at the previous scored session and is " +
      "outside it now. The name became actionable this session.",
    faded: "Was outside the dead band and is inside it now. The exit signal, " +
      "and exactly as load-bearing as the entry.",
    flipped: "Outside the band at both ends with opposite signs. The name did " +
      "not weaken and re-strengthen; it changed sides without resting in the middle.",
  };

  const strips = [];

  function drawStrips() {
    const shown = strips.find((s) => s.cell.isConnected && s.cell.clientWidth > 0);
    const base = shown ? Math.round(shown.cell.clientWidth) : 0;
    for (const s of strips) {
      if (!s.cell.isConnected) continue;
      const w = Math.round(s.cell.clientWidth) || base;
      if (!w || w === s.w) continue;
      s.w = w;
      s.cell.replaceChildren();
      scoreStrip(s.cell, {
        values: s.series, width: w, height: 28,
        domain: s.track.domain, deadBand: s.track.deadBand, prefix: "hm",
        ariaLabel: "Score for " + s.t + " across " + s.measured + " archived sessions",
      });
    }
  }

  function sideList(into, rows, knowsDeep, track, label, evBy) {
    const list = [];
    const shown = rows.slice(0, ROW_MAX);
    for (const row of shown) {
      const t = String((row && row.t) || "");
      const deep = !knowsDeep || (row && row.dp === 1);
      const card = Boolean(t) && deep;
      const mv = track.moveBy[t] || null;
      const cross = mv && mv.current && typeof mv.d1.cross === "string" ? mv.d1.cross : null;

      const name = h("span", { class: "hm-name cc-t" },
        h("b", { class: "hm-t" }, t || DASH),
        cross ? h("span", { class: "hm-tag cc-cross", "data-cross": cross, title: CROSS_SAID[cross] || null }, CROSS_WORDS[cross]) : null,
        earningsMark(row, evBy.get(t)));
      const conv = isNum(row.cnv);
      const sub = h("span", { class: "hm-sub" },
        h("span", { class: "hm-prem", "data-tone": toneOf(row.netPrem) }, usdS(row.netPrem)),
        h("span", { class: "hm-conv", title: "Conviction measures agreement in the published inputs, not a probability of profit." },
          "conv " + (conv === null ? DASH : String(Math.round(conv)))));

      const trk = h("span", { class: "hm-trk cc-trk" });
      const series = track.byName[t];
      const measured = (series || []).filter((v) => isNum(v) !== null).length;
      if (series && measured) strips.push({ cell: trk, series, track, t, measured, w: 0 });
      else trk.textContent = DASH;

      const score = isNum(row.s);
      const kids = [
        h("span", { class: "hm-rk" }, isNum(row.r) === null ? DASH : String(row.r)),
        h("span", { class: "hm-who" }, name, sub),
        trk,
        h("span", { class: "hm-score cc-score", "data-tone": toneOf(score) }, fmtSigned(row.s)),
        h("span", { class: "hm-chg", "data-tone": toneOf(row.chg), title: "The session's price return: close over the prior close. Not the score move." }, pct(row.chg)),
      ];
      const said = t + ", score " + fmtSigned(row.s) + ", conviction " + (conv === null ? DASH : Math.round(conv)) +
        ", price " + pct(row.chg) + ", net premium " + usd(row.netPrem);
      list.push(card
        ? h("a", { class: "ui-row hm-lrow cc-open", href: readerHref(t), "aria-label": said + ". Open the reader.", "data-ticker": t }, kids)
        : h("div", { class: "ui-row hm-lrow cc-flat", role: "listitem", title: t ? NO_CARD_SAID : null, "aria-label": said, "data-ticker": t }, kids));
    }
    into.append(UI.list(list, { visible: SHOW, label }));
  }

  function readTrack(payload) {
    const byName = Object.create(null);
    const moveBy = Object.create(null);
    const sessionRows = payload && Array.isArray(payload.sessions) ? payload.sessions : [];
    const lastIndex = sessionRows.length - 1;
    let lo = 0, hi = 0, sessions = 0;
    if (payload && Array.isArray(payload.names)) {
      for (const name of payload.names) {
        if (!name || !name.t) continue;
        const series = Array.isArray(name.s) ? name.s : [];
        byName[name.t] = series;
        if (name.d1) {
          const at = isNum(name.lastAt);
          moveBy[name.t] = {
            d1: name.d1,
            at,
            last: isNum(name.last),
            current: lastIndex >= 0 && at !== null && at === lastIndex,
            on: at !== null && sessionRows[at] ? sessionRows[at].d || null : null,
          };
        }
        if (series.length > sessions) sessions = series.length;
        for (const value of series) {
          const v = isNum(value);
          if (v === null) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    return {
      byName, moveBy, domain: { lo, hi },
      dates: sessionRows.map((r) => (r && r.d) || null),
      deadBand: payload ? isNum(payload.deadBand) : null,
      label: sessions ? sessions + " sessions" : "Score track",
    };
  }

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

    const names = Array.isArray(payload.names) ? payload.names : [];
    const sessionRows = Array.isArray(payload.sessions) ? payload.sessions : [];
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

  const keySilence = (payload, read, quietSaid) => {
    if (!payload) return ["unreadable", "could not be read — refresh to try again"];
    if (payload.status === "pending") return ["pending", "not published yet"];
    if (read) return null;
    if (quietSaid) return ["empty", quietSaid];
    return ["unavailable", "not on this payload"];
  };

  function chip(o) {
    const attrs = {
      class: "ui-gchip hm-chip", type: "button", ...POP,
      "data-chip": o.key, "data-empty": o.silence ? o.silence[0] : null, "data-info": UI.info(o.info),
    };
    const g = o.silence
      ? h("span", { class: "ui-gchip-g hm-chip-g", "data-empty": o.silence[0] }, glyph((KIND[o.silence[0]] || KIND.unavailable)[0]))
      : o.g;
    return h("button", attrs, g,
      h("span", { class: "ui-chip-v", "data-tone": o.silence ? "silent" : o.tone || null }, o.value),
      h("span", { class: "ui-chip-l" }, o.key));
  }

  function pair(a, b, word) {
    const whole = a !== null && b !== null && a + b > 0 ? Math.round((a / (a + b)) * 100) + "%" : null;
    return [h("span", { class: "hm-v-full" },
      h("span", { class: "hm-half", "data-tone": a === null ? null : "up" }, a === null ? DASH : String(a)), h("span", { class: "hm-sl" }, " / "),
      h("span", { class: "hm-half", "data-tone": b === null ? null : "down" }, b === null ? DASH : String(b)), h("span", { class: "visually-hidden" }, " " + word)),
    h("span", { class: "hm-v-short", "aria-hidden": "true" }, whole || (a === null ? DASH : String(a)) + "/" + (b === null ? DASH : String(b)))];
  }

  function paintVerdict(into, long, short, market, alerts, pulse) {
    into.replaceChildren();
    const breadth = (market && market.breadth) || {};
    const premium = (market && market.premium) || {};

    const { silence: boardsSilence } = boardsRead(long, short);
    const bulls = poolCount(long);
    const bears = poolCount(short);

    const seen = isNum(alerts && alerts.seen);
    const atLimit = Boolean(alerts) && (alerts.vendorTruncated === true || alerts.readTruncated === true);
    const alertRows = alerts && Array.isArray(alerts.rows) ? alerts.rows.length : null;

    const bt = isNum(breadth.tilt);
    const pt = isNum(premium.tilt);
    const bull = isNum(breadth.bull), bear = isNum(breadth.bear);
    const leaned = bull !== null && bear !== null ? bull + bear : null;
    const up = isNum(premium.netPositive), down = isNum(premium.netNegative);
    const gross = up !== null && down !== null ? up + down : null;
    const btSilence = keySilence(market, bt !== null, leaned === 0 ? "no name leaned" : null);
    const ptSilence = keySilence(market, pt !== null, gross === 0 ? "no net premium was priced" : null);
    const brSilence = keySilence(market, bull !== null && bear !== null, null);

    const pc = pcOf(pulse);
    const pcSilence = keySilence(pulse, pc.now !== null, null);
    const clSilence = bulls === null && bears === null ? boardsSilence(false) : null;
    const flSilence = keySilence(alerts, seen !== null, null);

    const share = (a, b) => (a !== null && b !== null && a + b > 0 ? a / (a + b) : null);
    const silenceSaid = (s, subject) => (!s ? null
      : s[0] === "unreadable" ? cap1(subject) + " could not be read — refresh to try again."
        : s[0] === "empty" ? cap1(subject) + " is empty: " + s[1] + "."
          : cap1(subject) + " is " + s[1] + ".");

    const chips = [
      chip({
        key: "Flow bias", value: pct(pt, 1), tone: toneOf(pt), silence: ptSilence,
        g: UI.divRing(pt === null ? null : pt * 100, { max: 25 }),
        info: () => ({
          title: "Flow bias", state: null,
          lead: ptSilence ? silenceSaid(ptSilence, "the dollar-weighted tilt")
            : "Net premium over gross premium across the screened universe, weighted by dollars.",
          facts: [
            ["By dollars", pct(pt, 1)],
            ["Names equally weighted", bt !== null ? pct(bt, 1) : btSilence ? btSilence[1] : DASH],
            ["Net call premium", usd(premium.netPositive)],
            ["Net put premium", usd(premium.netNegative)],
          ],
          notes: [bt !== null && pt !== null && (bt > 0) !== (pt > 0) && bt !== 0 && pt !== 0
            ? "The two weightings point opposite ways: breadth without size, or size without breadth." : null],
        }),
      }),
      chip({
        key: "Breadth", value: pair(bull, bear, "names net bought against net sold"), silence: brSilence,
        g: UI.ring(share(bull, bear), { color: "--up-mark" }),
        info: () => ({
          title: "Breadth",
          lead: brSilence ? silenceSaid(brSilence, "the breadth split")
            : "Screened names whose net premium was bought against those whose net premium was sold.",
          facts: [["Bought", bull === null ? DASH : String(bull)], ["Sold", bear === null ? DASH : String(bear)],
            ["Bought share", share(bull, bear) === null ? DASH : F.pct(share(bull, bear), 0)],
            ["Screened", isNum(market && market.n) === null ? DASH : String(market.n)]],
        }),
      }),
      chip({
        key: "Cleared", value: pair(bulls, bears, "names cleared the band bullish against bearish"),
        silence: clSilence,
        g: UI.ring(share(bulls, bears), { color: "--up-mark" }),
        info: () => ({
          title: "Cleared the band",
          lead: clSilence ? silenceSaid(clSilence, "the cleared pool")
            : "Names past the dead band on each board, counted whole rather than to the rows this page draws.",
          facts: [["Bullish", bulls === null ? DASH : String(bulls)], ["Bearish", bears === null ? DASH : String(bears)]],
        }),
      }),
      chip({
        key: "Put/call", value: pc.now === null ? DASH : pc.now.toFixed(2), silence: pcSilence,
        tone: pc.z === null ? null : pc.z > 1 ? "down" : pc.z < -1 ? "up" : null,
        g: pc.z !== null ? UI.divRing(-pc.z, { max: 3 }) : UI.ring(pc.now === null ? null : Math.min(1, pc.now / 1.5), { color: "--label-2" }),
        info: () => ({
          title: "Put/call volume",
          lead: pcSilence ? silenceSaid(pcSilence, "the put/call ratio")
            : "Put contracts traded per call contract across the whole options market, on the vendor's daily totals.",
          facts: [["Today", pc.now === null ? DASH : pc.now.toFixed(3)], ["Session", pc.date],
            ["z against the year", pc.z === null ? (pc.zWhy || "not published yet") : F.signed(pc.z, 2) + " sd"],
            ["Mean", pc.mean === null ? null : pc.mean.toFixed(3)], ["Sessions", pc.n === null ? null : String(pc.n)]],
        }),
      }),
      chip({
        key: "Flagged", value: seen === null ? DASH : (atLimit ? "≥" : "") + seen,
        silence: flSilence,
        g: UI.iconChip("unusual", "--s-orange"),
        info: () => ({
          title: "Flagged windows",
          lead: flSilence ? silenceSaid(flSilence, "the flagged-window count") : "Option windows the vendor's own rules flagged in this read." +
            (atLimit ? " The read hit the vendor's ceiling, so the count is a floor and never a census." : ""),
          facts: [["Seen", seen === null ? DASH : (atLimit ? "≥" : "") + seen], ["Carried", alertRows === null ? DASH : String(alertRows)]],
        }),
      }),
    ];
    into.append(UI.chips(chips, "Session readings"));
  }

  function pcOf(pulse) {
    const out = { now: null, z: null, mean: null, n: null, date: null, zWhy: null };
    if (!pulse || pulse.status === "pending") return out;
    const hist = pulse.totalsHistory && typeof pulse.totalsHistory === "object" ? pulse.totalsHistory : null;
    const pv = hist && hist.pcVolume && typeof hist.pcVolume === "object" ? hist.pcVolume : null;
    if (pv) {
      out.now = isNum(pv.now);
      out.z = isNum(pv.z);
      out.mean = isNum(pv.mean);
      out.n = isNum(hist.n);
      out.date = typeof hist.date === "string" ? hist.date : null;
      out.zWhy = typeof pv.reason === "string" ? pv.reason : null;
    }
    const tot = pulse.totals;
    if (out.now === null && tot && tot.status === "ok" && Array.isArray(tot.rows) && tot.rows[0]) {
      const c = isNum(tot.rows[0].callVol), p = isNum(tot.rows[0].putVol);
      out.now = c !== null && p !== null && c > 0 ? p / c : null;
      out.date = typeof tot.rows[0].date === "string" ? tot.rows[0].date : null;
    }
    return out;
  }

  function boardsRead(long, short) {
    const answered = [long, short].filter((p) => p && p.status !== "pending");
    const longDate = answered.includes(long) ? long.sessionDate : null;
    const shortDate = answered.includes(short) ? short.sessionDate : null;
    const date = (typeof longDate === "string" && longDate) ||
      (typeof shortDate === "string" && shortDate) || null;
    const silence = (read) => read ? null
      : answered.length ? ["unavailable", "not on this payload"]
        : (!long || !short) ? ["unreadable", "could not be read — refresh to try again"]
          : ["pending", "not published yet"];
    return { silence, date };
  }

  function titleFor(date) {
    const m = UI.freshness.market();
    const t = $("fxTitle");
    if (t) t.textContent = (date || m.expected) === m.today ? "Today" : "Last session";
  }
  titleFor(null);

  function paintMeta(dateEl, screenedEl, boards, market) {
    const { silence: boardsSilence, date } = boardsRead(boards[0], boards[1]);
    titleFor(date);
    const quiet = boardsSilence(date !== null);
    if (dateEl) {
      dateEl.replaceChildren();
      if (date) {
        dateEl.setAttribute("datetime", date);
        dateEl.textContent = dayLong(date);
        delete dateEl.dataset.empty;
      } else {
        dateEl.removeAttribute("datetime");
        dateEl.append("Session ", mark(quiet ? quiet[0] : "unavailable", "The session " + (quiet ? quiet[1] : "is unknown") + ".", "session"));
        dateEl.dataset.empty = quiet ? quiet[0] : "unavailable";
        dateEl.dataset.said = "session " + (quiet ? quiet[1] : "unknown");
      }
    }
    const n = isNum(market && market.n);
    const nQuiet = keySilence(market, n !== null, null);
    if (screenedEl) {
      screenedEl.replaceChildren();
      if (n !== null) {
        screenedEl.textContent = n + " screened";
        delete screenedEl.dataset.empty;
      } else if (nQuiet) {
        screenedEl.append("Screened ", mark(nQuiet[0], "The screened population " + nQuiet[1] + ".", "screened names"));
        screenedEl.dataset.empty = nQuiet[0];
        screenedEl.dataset.said = "screened " + nQuiet[1];
      }
      screenedEl.hidden = n === null && !nQuiet;
    }
  }

  function dayLong(iso) {
    const t = Date.parse(iso + "T12:00:00Z");
    if (!Number.isFinite(t)) return iso;
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(new Date(t));
    } catch { return iso; }
  }

  const bucket = (iso) => Math.floor(Date.parse(iso) / 300000);
  const onBuckets = (t, zt, zv) => {
    const by = new Map(zt.map((x, i) => [bucket(x), isNum(zv[i])]));
    return t.map((x) => by.get(bucket(x)) ?? null);
  };

  function liveSeries(lt, session, ff, readAt) {
    if (!lt || lt.status !== "ok" || !Array.isArray(lt.t) || !lt.t.length) return null;
    const at = (arr, i) => (Array.isArray(arr) ? isNum(arr[i]) : null);
    return {
      live: true, session: session || lt.date || null, readAt: readAt || null, ff: ff || null,
      t: lt.t.slice(), net: lt.t.map((_, i) => at(lt.net, i)),
      call: lt.t.map((_, i) => at(lt.ncp, i)), put: lt.t.map((_, i) => at(lt.npp, i)),
    };
  }

  function pulseSeries(pulse) {
    const pt = pulse && pulse.status !== "pending" && pulse.tide;
    if (!pt || pt.status !== "ok" || !Array.isArray(pt.points) || !pt.points.length) return null;
    const pts = pt.points;
    const call = pts.map((p) => isNum(p && p.callPrem)), put = pts.map((p) => isNum(p && p.putPrem));
    return {
      live: Boolean(pulse.live), session: pulse.readDay || pulse.sessionDate || null,
      readAt: pulse.readAt || null, ff: pulse.__ff || null, t: pts.map((p) => p && p.t), call, put,
      net: call.map((c, i) => (c === null || put[i] === null ? null : c - put[i])),
    };
  }

  function zeroOf(tide, S) {
    const lb = S.liveBreadth && S.liveBreadth.status !== "pending" && S.liveBreadth.dte ? S.liveBreadth.dte.zero : null;
    const lm = S.liveMkt && S.liveMkt.status !== "pending" ? S.liveMkt.zeroDte : null;
    const reg = S.regime && S.regime.status !== "pending" && S.regime.zeroDte && S.regime.zeroDte.status === "ok" ? S.regime.zeroDte : null;
    const same = (d) => !d || !tide.session || d === tide.session;
    if (tide.live) {
      for (const z of [lb, lm]) {
        if (z && z.status === "ok" && Array.isArray(z.t) && z.t.length && same(z.date)) {
          return { series: onBuckets(tide.t, z.t, z.net || []), last: lastOf(z.net) };
        }
      }
    }
    return { series: null, last: reg && same(reg.date || S.regime.sessionDate) ? isNum(reg.np0) : null };
  }

  function tideOf(S) {
    const p = pulseSeries(S.pulse);
    const pulseDay = S.pulse && S.pulse.status !== "pending" ? S.pulse.sessionDate || null : null;
    const lm = S.liveMkt && S.liveMkt.status !== "pending" ? S.liveMkt : null;
    const l = lm && (!pulseDay || !lm.session || lm.session >= pulseDay)
      ? liveSeries(lm.tide, lm.session, lm.__ff, lm.fresh && lm.fresh.readAt) : null;
    const tide = [l, p].find((x) => x && x.t.length >= 2) || [l, p].find(Boolean) || null;
    if (tide) {
      const z = zeroOf(tide, S);
      tide.zero = z.series && z.series.some((x) => x !== null) ? z.series : null;
      tide.zeroLast = lastOf(tide.zero) ?? z.last;
    }
    return tide;
  }

  const lastOf = (arr) => {
    if (!Array.isArray(arr)) return null;
    for (let i = arr.length - 1; i >= 0; i--) if (isNum(arr[i]) !== null) return isNum(arr[i]);
    return null;
  };

  function heroState(tide) {
    if (!tide) return ["pending", "Pending", ""];
    const m = UI.freshness.market();
    const day = tide.session ? F.day(tide.session) : "";
    const past = tide.session && tide.session < m.today;
    const age = Date.now() - Date.parse(tide.readAt);
    let s = tide.live && tide.ff ? tide.ff.stateAt() : null;
    if (!s && tide.session && tide.session < m.expected) return ["stale", "Stale", day];
    if (!tide.live) return past ? ["last", "Last session", day] : ["closed", "Closed", day];
    if (!s || (s === "closed" && m.open && !past)) s = m.open && !past ? (age <= 600000 ? "live" : "stale") : "closed";
    const at = tide.readAt ? clock(tide.readAt) : day;
    if (s === "live") return ["live", "Live", at];
    if (s === "fresh") return ["fresh", "Updated", at];
    if (s === "stale") return ["stale", "Stale", past ? day : at];
    return past ? ["last", "Last session", day] : ["closed", "Closed", day];
  }

  function paintPill(tide) {
    const pill = $("hmTideState");
    if (!pill) return "pending";
    const [state, word, when] = heroState(tide);
    const def = UI.STATES[state === "last" ? "fresh" : state] || UI.STATES.closed;
    pill.replaceChildren(h("button", {
      class: "hm-pill", type: "button", "data-state": state, ...POP,
      "data-info": UI.info(() => ({
        title: "Market tide", state: UI.STATES[state] ? state : "closed",
        lead: !tide ? "No tide is published yet." : tide.live ? "Read live during the session." : "The nightly record of this session; no live read is newer.",
        facts: [["Source", !tide ? DASH : tide.live ? "live:market" : "pulse"], ["Session", tide && tide.session],
          ["Read", tide && tide.readAt ? fmtStamp(tide.readAt) : null], ["Points", tide ? String(tide.t.length) : null]],
        notes: ["Net premium is net call premium minus net put premium, cumulative over the session; positive is bullish premium.",
          tide && tide.t.length < 2 ? "The river draws from the second read." : null],
      })),
    }, glyph(def.g), h("span", null, word), when ? h("span", { class: "hm-pill-when" }, "· " + when) : null));
    return state;
  }

  let tideChart = null;
  let tideShown = null;
  let heroTide = null;
  const S = { pulse: null, regime: null, liveMkt: null, liveBreadth: null };
  const hero = () => paintHero(heroTide = tideOf(S));

  function paintHero(tide) {
    const v = $("hmTideV"), cap = $("hmTideCap"), legs = $("hmTideLegs"), plot = $("hmTide");
    if (!v || !plot) return;
    const state = paintPill(tide);
    if (tideChart) { tideChart.destroy(); tideChart = null; }
    plot.replaceChildren();
    if (!tide) {
      v.replaceChildren(DASH);
      v.dataset.tone = "silent";
      if (cap) cap.replaceChildren();
      if (legs) legs.replaceChildren();
      hush(plot, S.liveMkt === null && S.pulse === null ? "unreadable" : "pending",
        "No tide is published yet, so the river has nothing to draw.", "market tide", 220);
      return;
    }
    const net = lastOf(tide.net);
    const text = net === null ? DASH : (net > 0 ? "+" : "") + usd(net);
    if (tideShown === null) UI.roll(v, text);
    else if (tideShown !== text) UI.roll(v, text, tideShown, true);
    tideShown = text;
    v.dataset.tone = toneOf(net) || "flat";
    if (cap) {
      const t = toneOf(net);
      cap.replaceChildren(UI.capsule(t === "up" ? "Bullish premium" : t === "down" ? "Bearish premium" : "Level", { tone: t || "flat" }));
    }
    if (legs) {
      const zero = tide.zeroLast;
      legs.replaceChildren(UI.metrics([
        UI.metric("Net calls", usdS(lastOf(tide.call)), { tone: toneOf(lastOf(tide.call)) }),
        UI.metric("Net puts", usdS(lastOf(tide.put)), { tone: toneOf(-(lastOf(tide.put) || 0)) }),
        UI.metric("0DTE", zero === null ? DASH : usdS(zero), { tone: toneOf(zero),
          state: zero === null ? { state: "pending", reason: "No 0DTE net flow was read for this session yet." } : null }),
      ], { min: 84 }));
    }
    if (tide.t.length < 2) {
      plot.append(h("div", { class: "ui-silent hm-hush", "data-state": "quiet", role: "note", style: { "--silent-h": "220px" } },
        glyph("clock"), h("div", { class: "ui-silent-t" }, "First read")));
      return;
    }
    const series = [{ values: tide.net, label: "Net", format: (x) => (x > 0 ? "+" : "") + usd(x) }];
    if (tide.zero) {
      series.push({ values: tide.zero, label: "0DTE", color: "--s-gray", dash: true, width: 1.25, format: (x) => (x > 0 ? "+" : "") + usd(x) });
    }
    const mins = tide.t.map(nyMinutes);
    const timed = mins.every((m) => m !== null) && mins.every((m, i) => i === 0 || m > mins[i - 1]);
    const opts = {
      x: timed ? mins : tide.t, xType: timed ? "number" : "index", xFormat: (iso) => clock(iso),
      xTicks: timed ? hourTicks(mins[0], mins[mins.length - 1], plot.clientWidth < 480 ? 120 : 60) : undefined, series, twoTone: true, zero: true,
      height: [190, 220, 236], live: state === "live",
      yFormat: (x) => ((x > 0 ? "+" : "") + usd(x)).replace(/\.0(?=[KMB])/, ""),
      label: "Market tide, net premium across the session",
      readout: (i) => [C.part(clock(tide.t[i]), "k"), C.part("Net", "k"),
        h("b", { "data-tone": toneOf(tide.net[i]) }, tide.net[i] === null ? DASH : usdS(tide.net[i])),
        tide.zero ? C.part("0DTE " + (tide.zero[i] === null ? DASH : usdS(tide.zero[i])), "k") : null],
    };
    const chartHost = h("div", { class: "hm-river" });
    plot.append(chartHost, UI.legend([
      h("span", { class: "ui-key" }, h("i", { class: "is-split", "aria-hidden": "true" }), "Net premium"),
      series.length > 1 ? ["--s-gray", "ln", "0DTE net"] : null,
    ].filter(Boolean)));
    tideChart = C.line(chartHost, opts);
    if (state === "live" && tide.readAt) UI.freshness({ readAt: tide.readAt, live: true, source: "live:market" });
  }

  function zeroShareOf(reg, breadth) {
    const lb = breadth && breadth.status !== "pending" && breadth.dte && breadth.dte.share ? breadth : null;
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
    const reg = regime && regime.status !== "pending" ? regime : null;
    const curve = reg && reg.volCurve && reg.volCurve.byIndex ? reg.volCurve.byIndex : null;
    const lv = liveVol && liveVol.status !== "pending" && liveVol.index ? liveVol : null;
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
    const COL = { SPY: "--s-blue", QQQ: "--s-purple", IWM: "--s-teal" };
    const plot = h("div", { class: "hm-term" });
    into.append(plot);
    C.line(plot, {
      x: TEN, xType: "number", xScale: "sqrt", height: [150, 170, 240],
      xTicks: [{ v: 7, label: "1w" }, { v: 30, label: "1m" }, { v: 90, label: "3m" }, { v: 180, label: "6m" }, { v: 365, label: "1y" }],
      series: names.map((k) => ({ values: idx[k].iv, color: COL[k], label: k, format: (x) => F.pct(x, 1) })),
      yFormat: (x) => F.pct(x, 0), label: "Implied volatility by tenor for the index ETFs",
      readout: (i) => [C.part(TEN[i] + "d", "k")].concat(names.map((k) => C.part(k + " " + F.pct(idx[k].iv[i], 1), null))),
    });
    into.append(UI.legend(names.map((k) => [COL[k], "ln", k])));
    const radar = reg && reg.volRadar && reg.volRadar.status !== "pending" ? reg.volRadar : null;
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

  function paintAlerts(into, payload) {
    if (silent(into, payload, "flow alerts feed")) return;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      hush(into, "empty", "The vendor's rules flagged nothing in this read.", "flagged windows");
      return;
    }
    const drawn = rows.slice(0, LIST_MAX);
    const priced = drawn.map((row) => isNum(row && row.prem)).filter((one) => one !== null);
    const pool = priced.reduce((sum, one) => sum + Math.abs(one), 0);
    const top = priced.length ? Math.max(...priced.map(Math.abs)) : null;
    const share = pool > 0 && top !== null ? top / pool : null;
    const lede = (drawn.length === 1
      ? "This is the largest flagged window by premium, not the newest"
      : "These " + drawn.length + " are the largest flagged windows by PREMIUM, not the newest") +
      (share === null
        ? " — and no row here quoted a premium, so nothing ranks them and the order is the " +
          "feed's own tie-break."
        : ", and the biggest is " + (share * 100).toFixed(1) + "% of the premium across them.");

    const sideOf = (row) => {
      const ask = isNum(row.askPrem), bid = isNum(row.bidPrem);
      const two = ask === null || bid === null ? null : Math.abs(ask) + Math.abs(bid);
      return two === null || two === 0 ? null : Math.abs(ask) / two;
    };
    const sideSaid = (s) => (s === null ? DASH : s === 0.5 ? "even"
      : (s > 0.5 ? "ask " : "bid ") + ((s > 0.5 ? s : 1 - s) * 100).toFixed(0) + "%");
    const contract = (row) => (row.cp || DASH) + " " + (isNum(row.k) === null ? DASH : row.k) +
      (row.exp ? " " + String(row.exp).slice(5) : "");

    const list = drawn.map((row, i) => {
      const s = sideOf(row);
      return h("div", { class: "ui-row hm-arow", role: "listitem", "aria-label": (row.t || DASH) + " " + contract(row) + ", " + usd(row.prem) + ", " + sideSaid(s) },
        h("span", { class: "ui-badge", "data-tone": row.cp === "C" ? "up" : row.cp === "P" ? "down" : null, "aria-label": row.cp === "C" ? "Call" : row.cp === "P" ? "Put" : null }, row.cp === "C" || row.cp === "P" ? row.cp : "·"),
        h("span", { class: "ui-row-m" }, h("b", null, row.t || DASH), h("span", null, (isNum(row.k) === null ? DASH : row.k) + (row.exp ? " · " + F.day(String(row.exp)) : ""))),
        s === null ? h("span", { class: "ui-dash hm-side" }, DASH)
          : h("span", { class: "ui-meter hm-side", title: sideSaid(s) }, h("i", { style: { "--w": (s * 100).toFixed(1) + "%", "--i": String(i), "--c": UI.cssVar(s >= 0.5 ? "--label-2" : "--label-3") } })),
        h("span", { class: "ui-row-v" }, usd(row.prem)));
    });
    into.append(UI.list(list, { visible: SHOW, label: "Flagged option windows, largest premium first" }),
      UI.legend([["--label-2", "", "Share at the ask"]]));
    const detail = table("Flagged option windows, largest premium first", [
      ["Time · ET", false, "When the vendor's flagged window opened, in Eastern time."],
      ["Name", false], ["Contract", false], ["Premium", true],
      ["Side", true, "The share of premium the vendor attributed to the ask or the bid: a side of the quote, never proof of a buyer."],
      ["Rule", false, "The vendor's name for the screen that flagged the window."],
    ], drawn.map((row) => {
      const at = etTime(row.spanStart);
      const to = etTime(row.spanEnd);
      return {
        cells: [
          [at === null ? DASH : at, "c-num cc-dim", at === null ? null
            : row.spanFrom === "created_at" ? "Alert created " + at + " ET; no window stated."
              : to === null ? "Window opened " + at + " ET; the vendor stated no end for it." : "Window ran " + at + " to " + to + " ET."],
          [row.t || DASH, "cc-t"], [contract(row), "cc-date"], [usd(row.prem), "c-num"],
          [sideSaid(sideOf(row)), "c-num"],
          [row.rule || DASH, "cc-dim", row.rule ? "Flagged by the vendor's " + String(row.rule).replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase() + " rule, under the vendor's own name for it." : null],
        ],
      };
    }));
    const seen = isNum(payload.seen);
    const cadence = payload.refreshed === "intraday" ? "intraday" : payload.refreshed === "nightly" ? "nightly" : null;
    const read = typeof payload.readAt === "string" && Number.isFinite(Date.parse(payload.readAt))
      ? (cadence ? cadence + " read " : "read ") + (fmtStamp(payload.readAt) || DASH) + (cadence ? "" : ", cadence not published")
      : cadence ? cadence + " read" : "cadence not published";
    infoInto("hmAlerts", "flagged windows", () => ({
      title: "Flagged windows", lead: lede,
      facts: [["Seen", seen === null ? DASH : (payload.vendorTruncated === true || payload.readTruncated === true ? "≥" : "") + seen],
        ["Read", read]],
      notes: ["The meter is the share of each window's premium the vendor attributed to the ask."],
      node: detail,
    }));
  }

  function paintEvents(into, payload) {
    if (silent(into, payload, "events calendar")) return;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
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
    const list = drawn.map((row) => {
      const im = isNum(row.im);
      const sd = isNum(row.sdte);
      return UI.listRow({
        primary: row.t || DASH,
        secondary: (row.d ? F.day(row.d) : DASH) + (sd === null ? "" : sd === 0 ? " · next session" : " · in " + sd + "s"),
        value: im === null ? DASH : "±" + (Math.abs(im) * 100).toFixed(1) + "%",
        signed: isNum(row.s) === null ? h("span", { class: "hm-tag", title: row.st === "gated" ? "The board was forbidden from holding an opinion on this name." : "No score was published for this name." }, row.st === "gated" ? "gated" : "unscored") : fmtSigned(row.s),
        signedValue: isNum(row.s), signedTone: isNum(row.s) === null ? "silent" : undefined,
        cols: "minmax(0,1fr) 60px 58px",
      });
    });
    into.append(UI.list(list, { visible: SHOW, label: "Names reporting inside the window" }));
    const detail = table("Names reporting inside the window", [
      ["Name", false], ["Date", false], ["In · sessions", true], ["Priced move", true], ["Score", true],
      ["Stage", false, "Where this name stopped in the run's funnel. \"gated\" means the board was forbidden from holding an opinion on it, not that it had none."],
    ], drawn.map((row) => {
      const im = isNum(row.im);
      return {
        cells: [[row.t || DASH, "cc-t"], [row.d || DASH, "cc-date"],
          [isNum(row.sdte) === null ? DASH : row.sdte + "s", "c-num"],
          [im === null ? DASH : "±" + (Math.abs(im) * 100).toFixed(1) + "%", "c-num"],
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

  function paintWatch(into, payload) {
    if (silent(into, payload, "watch board")) return;
    const rows = ranked(payload.rows);
    if (!rows.length) {
      const band = isNum(payload.deadBand);
      if (payload.status === "thin" || isNum(payload.neutral) === 0) {
        hush(into, "empty", "Every scored name cleared the " + (band === null ? "dead" : "±" + band) + " band this session.", "nearly in");
      } else hush(into, "unavailable", "The watch board published no rows.", "nearly in");
      return;
    }
    const drawn = rows.slice(0, LIST_MAX);
    const sideOf = (row) => {
      const value = isNum(row && row.resid) !== null ? isNum(row.resid) : isNum(row && row.s);
      return value === null ? null : (value > 0 ? 1 : value < 0 ? -1 : 0);
    };
    const sides = drawn.map(sideOf);
    const above = sides.filter((one) => one === 1).length;
    const below = sides.filter((one) => one === -1).length;
    const onRule = sides.filter((one) => one === 0).length;
    const unplaced = sides.filter((one) => one === null).length;
    const nearest = drawn.length + " name" + (drawn.length === 1 ? "" : "s") + " nearest the edge";
    const lede = above + below + onRule === 0
      ? "None of the " + nearest + " published a number to place against the zero rule, so " +
        "this list is ordered and unsided."
      : above + " of the " + nearest + " sit above the zero rule and " + below + " below it" +
        (onRule ? ", " + onRule + " exactly on it" : "") +
        (unplaced ? "; " + unplaced + " published no number to place" : "") + ".";
    const anyResid = drawn.some((row) => isNum(row.resid) !== null);
    const list = drawn.map((row) => {
      const resid = isNum(row.resid);
      const value = resid !== null ? resid : isNum(row.s);
      return UI.listRow({
        primary: row.t || DASH, secondary: "conv " + (isNum(row.cnv) === null ? DASH : Math.round(row.cnv)),
        signed: resid !== null ? [h("small", { class: "hm-unit" }, "resid "), fmtSigned(resid, 4)] : fmtSigned(row.s), signedValue: value,
        cols: resid !== null ? "minmax(0,1fr) auto" : "minmax(0,1fr) 72px",
      });
    });
    into.append(UI.list(list, { visible: SHOW, label: "Names inside the dead band, nearest the edge first" }));
    infoInto("hmWatch", "nearly in", () => ({
      title: "Nearly in", lead: lede,
      facts: [["Unit", anyResid ? "cross-sectional residual (resid)" : "score on the ±100 scale"], ["Rows", String(rows.length)]],
      notes: [anyResid
        ? "The residual is what the name was ranked on; rows are ordered on its size, which is how close the name is to leaving the band."
        : "The score is printed because this payload predates the residual on watch rows; on a narrow band every row rounds alike."],
    }));
  }

  const LEAN_TAIL = { quiet: 1, unreadable: 2 };
  function leanOrder(rows) {
    return rows.slice().sort((a, b) => {
      const av = isNum(a && a.leanRatio), bv = isNum(b && b.leanRatio);
      if (av !== null && bv !== null) return bv - av;
      if (av !== null) return -1;
      if (bv !== null) return 1;
      return (LEAN_TAIL[a && a.read] || 3) - (LEAN_TAIL[b && b.read] || 3);
    });
  }

  function paintLean(into, payload, segHost) {
    const sub = $("ccLeanSub");
    const saySub = (said) => { if (sub) sub.textContent = said; };
    saySub("");
    if (segHost) segHost.replaceChildren();
    if (silent(into, payload, "sector premium lean")) return;

    if (payload.status === "quiet") {
      hush(into, "empty",
        "The sector feed was read and the vendor returned no rows at all, so not one of the " +
        "eleven baskets could be placed. That is a measurement of the feed, not of the market.", "sector lean");
      return;
    }
    if (payload.status === "unreadable") {
      hush(into, "unreadable",
        "The sector feed returned rows and not one of the eleven baskets carried a readable " +
        "pair of premium sums. Nothing here is a reading about the session: the field names " +
        "on the wire and the ones this pipeline expects have parted company.", "sector lean");
      return;
    }
    const sectors = Array.isArray(payload.sectors) ? payload.sectors : [];
    if (!sectors.length) {
      hush(into, "unavailable",
        "This payload carried no sector rows, so the page cannot say where any basket " +
        "leaned. A gap in the payload rather than a fact about the market.", "sector lean");
      return;
    }

    const ordered = leanOrder(sectors);
    const leaned = ordered.filter((s) => isNum(s && s.leanRatio) !== null).length;
    const quietN = ordered.filter((s) => s && s.read === "quiet").length;
    const badN = ordered.length - leaned - quietN;
    const lean = payload.lean && typeof payload.lean === "object" ? payload.lean : null;

    const caveats = ["Bullish minus bearish OPTION premium on the eleven SPDR sector baskets, today only."];
    const method = [];
    if (lean && typeof lean.relation === "string" && lean.relation) {
      method.push("Derived: " + lean.relation + " — in words, net is bullish minus bearish " +
        "premium, gross is their sum, and the lean is net over gross.");
    }
    caveats.push("Ordered on the RATIO — the share of each basket's own two-sided premium " +
      "that leaned one way — because that is what the publisher ranks on" +
      (lean && typeof lean.rejected === "string" && lean.rejected ? ", having rejected " + lean.rejected : "") + ".");
    caveats.push("The dollars ride beside it because a ratio carries no size: +90% on $30k of " +
      "premium and +90% on $300M are not the same fact.");
    method.push("Sign is carried by POSITION in the table's lean bar and by the glyph on every number; the tint is only a second channel.");
    if (quietN) {
      caveats.push(quietN + (quietN === 1 ? " basket was" : " baskets were") +
        " read with both premium sums at zero: measured and empty, printed as the $0 they " +
        "are rather than dropped, and left off the axis because 0/0 is undefined and not a " +
        "neutral lean.");
    }
    if (badN) {
      caveats.push(badN + (badN === 1 ? " basket" : " baskets") + " could not be read at all " +
        "and print the em dash instead; the publisher's reason is on the row.");
    }
    if (typeof payload.basis === "string" && payload.basis) caveats.push("Basis: " + payload.basis + ".");
    if (typeof payload.notSameAs === "string" && payload.notSameAs) {
      caveats.push("This is not " + payload.notSameAs + " — that is the key the sector panel " +
        "on /flows/market/ draws, in basis points per session.");
    }

    const cts = (v) => {
      const n = isNum(v);
      if (n === null) return DASH;
      const sign = n < 0 ? MINUS : n > 0 ? "+" : "";
      const a = Math.abs(n);
      if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + "M";
      if (a >= 1e3) return sign + (a / 1e3).toFixed(0) + "K";
      return sign + String(Math.round(a));
    };
    const netCts = (r) => {
      const c = isNum(r && r.callVolume), p = isNum(r && r.putVolume);
      return c === null || p === null ? null : c - p;
    };
    const basket = (r) => r.sector || r.fullName || r.etf || DASH;
    const SHORT = { "Information Technology": "Technology", "Consumer Discretionary": "Discretionary",
      "Consumer Staples": "Staples", "Communication Services": "Comms" };
    const brief = (r) => SHORT[basket(r)] || basket(r);
    const MODES = [
      { label: "Ratio", noun: "share of its own premium", val: (r) => isNum(r && r.leanRatio), fmt: (v) => pct(v, 1), axis: 1,
        said: (n, d) => n + " of " + d + " leaned",
        two: (bh, vh, bl, vl) => bh + " leans most bullish at " + pct(vh, 1) + " of its own premium; " + bl + " most bearish at " + pct(vl, 1) + ".",
        one: (b, v) => b + " is the only basket with a readable lean, at " + pct(v, 1) + " of its own premium." },
      { label: "Premium", noun: "net option premium", val: (r) => isNum(r && r.netPremiumUsd), fmt: usdS, axis: null,
        said: (n, d) => n + " of " + d + " cleared premium",
        two: (bh, vh, bl, vl) => bh + " cleared the most bullish net premium at " + usd(vh) + "; " + bl + " the most bearish at " + usd(vl) + ".",
        one: (b, v) => b + " is the only basket with a readable premium sum, at " + usd(v) + " net." },
      { label: "Contracts", noun: "net contracts", val: netCts, fmt: cts, axis: null,
        said: (n, d) => n + " of " + d + " reported volume",
        two: (bh, vh, bl, vl) => bh + " traded the most calls over puts at " + cts(vh) + " contracts; " + bl + " the most puts over calls at " + cts(vl) + ".",
        one: (b, v) => b + " is the only basket that reported both volumes, at " + cts(v) + " contracts net." },
    ];
    let mode = 0;
    const strip = h("div", { class: "hm-heat", role: "list", "aria-label": "Sector lean, eleven baskets" });
    into.append(strip);

    const finding = (M, vals, reporting) => {
      if (!reporting.length) return "No basket carried a readable " + M.noun + " this session, so none is named.";
      const s = reporting.slice().sort((a, b) => vals.get(b) - vals.get(a));
      return s.length === 1 ? M.one(basket(s[0]), vals.get(s[0]))
        : M.two(basket(s[0]), vals.get(s[0]), basket(s[s.length - 1]), vals.get(s[s.length - 1]));
    };
    const draw = () => {
      const M = MODES[mode];
      const vals = new Map(ordered.map((r) => [r, M.val(r)]));
      const reporting = ordered.filter((r) => vals.get(r) !== null);
      saySub(M.said(reporting.length, ordered.length));
      const rank = reporting.slice().sort((a, b) => vals.get(b) - vals.get(a)).concat(ordered.filter((r) => vals.get(r) === null));
      const peak = M.axis !== null ? M.axis : reporting.reduce((m, r) => Math.max(m, Math.abs(vals.get(r))), 0);
      strip.replaceChildren(...rank.map((r, i) => {
        const v = vals.get(r);
        const read = typeof r.read === "string" ? r.read : "unreadable";
        const a = v === null || !(peak > 0) ? 0 : Math.sqrt(Math.min(1, Math.abs(v) / peak));
        const title = v === null
          ? (typeof r.reason === "string" && r.reason ? r.reason : read === "quiet"
            ? "Both premium sums were measured at zero: 0/0 is undefined, not neutral, so this basket is not placed."
            : "This basket carried no readable " + M.noun + ", so it is not placed.")
          : (r.etf ? r.etf + ": " : "") + M.fmt(v) + " " + M.noun + " · net " + usd(r.netPremiumUsd) +
            " · " + cts(netCts(r)) + " contracts · " + pct(r.leanRatio, 1) + " of its own premium.";
        return h("div", {
          class: "hm-cell", role: "listitem", "data-read": read, "data-etf": r.etf || null,
          "data-tone": v === null ? "silent" : toneOf(v), title,
          style: { "--a": a.toFixed(3), "--i": String(i) },
        },
        h("span", { class: "hm-cell-e" }, r.etf || DASH),
        h("span", { class: "hm-cell-v" }, v === null ? (read === "quiet" && M.axis === 1 ? "0/0" : DASH) : M.fmt(v)),
        h("span", { class: "hm-cell-n" }, brief(r)));
      }));
      strip.dataset.finding = finding(M, vals, reporting);
    };
    draw();
    if (segHost) segHost.append(UI.segmented("Sector quantity", MODES.map((m) => ({ label: m.label })), (i) => { mode = i; draw(); }, 0));

    const leanBar = (row) => {
      const r = isNum(row && row.leanRatio);
      if (r === null) {
        return row.read === "quiet"
          ? h("span", { class: "cc-ln-flat" }, "no premium")
          : h("span", { class: "cc-ln-none", title: typeof row.reason === "string" && row.reason ? row.reason : null }, DASH);
      }
      const frac = Math.min(Math.abs(r), 1);
      return h("span", { class: "cc-ln-bar", role: "img",
        "aria-label": (row.sector || row.etf || "This basket") + " leaned " + pct(r, 1) + " of its two-sided option premium, " +
          (r < 0 ? "left of" : r > 0 ? "right of" : "exactly on") + " the zero rule." },
      h("i", { class: "cc-ln-mid" }),
      h("i", { class: "cc-ln-fill", "data-tone": toneOf(r), style: { width: (frac * 50) + "%", left: r < 0 ? (50 - frac * 50) + "%" : "50%" } }));
    };
    const detail = table("Sector option-premium lean, most bullish first", [
      ["Sector", false], ["Lean", false], ["Lean · % of premium", true], ["Net · $", true], ["Gross · $", true],
    ], ordered.map((row) => ({
      attrs: { "data-read": typeof row.read === "string" ? row.read : "unreadable" },
      cells: [[h("span", null, h("span", { class: "cc-t" }, basket(row)), " ", h("small", { class: "cc-etf" }, row.etf || DASH),
        row.read && row.read !== "ok" ? h("span", { class: "cc-dim cc-ln-tag", title: row.reason || null }, " " + row.read) : null), "cc-ln-name"],
      [leanBar(row), "cc-ln-c"], [pct(row.leanRatio, 1), "c-num"], [usd(row.netPremiumUsd), "c-num"], [usd(row.grossPremiumUsd), "c-num"]],
    })));
    infoInto("hmLean", "sector lean", () => ({
      title: "Sector lean",
      lead: finding(MODES[0], new Map(ordered.map((r) => [r, MODES[0].val(r)])), ordered.filter((r) => MODES[0].val(r) !== null)),
      sections: [{ title: "What it is", lines: caveats }, { title: "How it is derived", lines: method }],
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
        "tape was checked and was empty — and not a request that failed.", "headlines", 64);
      return;
    }
    if (payload.status === "unreadable") {
      hush(into, "unreadable",
        "The headlines feed returned rows and not one carried a headline, so nothing here " +
        "is publishable. A fault on the wire between the vendor and this pipeline, not a " +
        "quiet news day.", "headlines", 64);
      return;
    }
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
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
    if (typeof payload.cadence === "string" && payload.cadence) {
      said.push("This feed is fetched " + payload.cadence +
        (typeof payload.staleBy === "string" && payload.staleBy ? " and is stale by " + payload.staleBy : "") +
        ", so it is a once-a-day read and never a live tape.");
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
    const cadence = typeof payload.cadence !== "string" ? "Snapshot; cadence not specified"
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
        const tickers = (Array.isArray(row && row.tickers) ? row.tickers : [])
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

  let spineDrawn = null;

  function renderSpine(payload) {
    spineDrawn = payload;
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
        return { parts, top: Math.max(0, axisY - half - 34), dots: at.slice(0, 4).map((m) => ({ x: m.x, y: axisY + m.dy, color: scores[i] < 0 ? "--down" : "--up" })) };
      },
    });
  }

  function assessAge(payload) {
    if (typeof UI.staleness !== "function") {
      return {
        kind: "unavailable",
        message: "The freshness check could not run: this page's shared UI module " +
          "(flows-ui.js) is too old to carry it, so nothing here is confirmed to be " +
          "today's. The session named above is the payload's own claim about itself.",
      };
    }
    return UI.staleness(payload, Date.now(), { subject: "This session" });
  }

  function setStale(messages) {
    const text = messages.filter(Boolean).join(" ");
    if (staleEl) {
      staleEl.hidden = !text;
      staleEl.textContent = text;
    }
    document.body.classList.toggle("is-stale", Boolean(text));
    const slot = $("hmStale");
    if (slot) {
      slot.replaceChildren();
      if (text) {
        slot.append(h("button", {
          class: "hm-pill", type: "button", "data-state": "stale", ...POP,
          "data-info": disclose("Freshness", text, { state: "stale" }),
        }, glyph("clock"), h("span", null, "Stale")));
      }
    }
  }

  function setRailCount(side, n) {
    const slot = document.querySelector('[data-rail-count="' + side + '"]');
    if (!slot || n === null) return;
    slot.textContent = String(n);
    slot.hidden = false;
  }

  function stampUpdated(response, body) {
    const at = isNum(response.headers.get("X-Payload-Updated"));
    if (body && typeof body === "object") {
      body.__updatedAt = at !== null && at > 0 ? at : null;
      body.__ff = typeof UI.freshFrom === "function" ? UI.freshFrom(response) : null;
    }
    return body;
  }

  let gated = false;

  function loadBoard(side) {
    return fetch("/api/flows/board?side=" + side, {
      credentials: "same-origin", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" },
    }).then((r) => {
      if (r.status === 401) { gated = true; location.replace("/flows/"); return null; }
      if (!r.ok) return null;
      return r.json().then((body) => stampUpdated(r, body));
    }).catch(() => null);
  }

  function loadRegion(path, soon) {
    return fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json().then((body) => stampUpdated(r, body))
        : soon && r.status === 404 ? { status: "pending", __route: 404 } : null))
      .catch(() => null);
  }

  function neuronComputed(market) {
    const box = $("hmVerdict"), t = $("hmVerdictT");
    if (!box || !t || !box.classList.contains("is-pending")) return;
    const pt = isNum(market && market.premium && market.premium.tilt);
    const b = (market && market.breadth) || {};
    const up = isNum(b.bull), dn = isNum(b.bear);
    const names = up === null || dn === null ? null
      : dn > up ? dn + " names net sold against " + up + " bought" : up + " names net bought against " + dn + " sold";
    const line = pt !== null ? (pt > 0.02 ? "Bullish" : pt < -0.02 ? "Bearish" : "Balanced") + " premium: flow bias " + pct(pt, 1) +
      (names ? ", " + names : "") + "." : names ? cap1(names) + "." : null;
    if (!line) return;
    t.textContent = line;
    const by = box.querySelector(".hm-verdict-by");
    if (by) by.textContent = "Computed";
    const mk = box.querySelector(".hm-verdict-meta .hm-mark");
    if (mk) {
      mk.replaceWith(h("button", {
        class: "ui-state hm-mark", type: "button", "data-state": "quiet", "aria-label": "Computed: no written summary yet",
        ...POP, "data-info": disclose("Neuron", "No written summary yet; this line is computed from the flow bias and breadth above."),
      }, glyph("quiet")));
    }
  }

  function neuronWire(lng, sht) {
    const more = $("hmNeuronMore"), x = $("hmNeuronX");
    if (more && x) {
      more.addEventListener("click", () => {
        const open = more.getAttribute("aria-expanded") !== "true";
        more.setAttribute("aria-expanded", String(open));
        x.hidden = !open;
        const label = more.querySelector("span");
        if (label) label.textContent = open ? "Less" : "More";
      });
    }
    const wrote = document.querySelector(".hm-verdict time");
    if (wrote && Number.isFinite(Date.parse(wrote.dateTime))) wrote.textContent = clock(wrote.dateTime) + " ET";
    const built = Date.parse((lng && lng.generatedAt) || (sht && sht.generatedAt) || "");
    if (wrote && Number.isFinite(built) && Date.parse(wrote.dateTime) < built) {
      const box = wrote.closest(".hm-verdict");
      box.classList.add("is-old");
      const note = " Written before the boards were rebuilt at " + fmtStamp(new Date(built).toISOString()) +
        ", so it reads an earlier publication.";
      const src = box.querySelector(".hm-verdict-src");
      if (src) src.append(note);
      const meta = box.querySelector(".hm-verdict-meta");
      if (meta) {
        meta.append(h("button", {
          class: "ui-state hm-mark", type: "button", "data-state": "stale", title: "Stale", "aria-label": "Stale: Neuron",
          ...POP, "data-info": disclose("Neuron", note.trim(), { state: "stale" }),
        }, glyph("clock")));
      }
    }
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawStrips, 150);
  });

  function live(liveVol) {
    if (typeof UI.heartbeat !== "function") return;
    UI.heartbeat({
      keys: ["market", "breadth"], nightly: ["pulse"], page: "overview",
      onBeat() { if (heroTide && heroTide.live) paintPill(heroTide); },
      onChange(changed) {
        if (!Array.isArray(changed)) return;
        const mk = changed.some((k) => /market/.test(String(k)));
        const br = changed.some((k) => /breadth/.test(String(k)));
        const pu = changed.some((k) => /pulse/.test(String(k)));
        Promise.all([mk ? loadRegion("/api/flows/lk?k=market", true) : null, br ? loadRegion("/api/flows/lk?k=breadth", true) : null,
          pu ? loadRegion("/api/flows/pulse") : null]).then(([m, b, p]) => {
          if (m) S.liveMkt = m;
          if (b) { S.liveBreadth = b; paintVol(S.regime, liveVol, b); }
          if (p) S.pulse = p;
          if (m || b || p) hero();
        });
      },
    });
  }

  Promise.all([
    loadBoard("long"),
    loadBoard("short"),
    loadRegion("/api/flows/board?side=watch"),
    loadRegion("/api/flows/market"),
    loadRegion("/api/flows/flowalerts"),
    loadRegion("/api/flows/events"),
    loadRegion("/api/flows/scoretrack"),
    loadRegion("/api/flows/sector-premium"),
    loadRegion("/api/flows/news"),
    loadRegion("/api/flows/pulse"),
    loadRegion("/api/flows/regime", true),
    loadRegion("/api/flows/lk?k=market", true),
    loadRegion("/api/flows/lk?k=vol", true),
    loadRegion("/api/flows/lk?k=breadth", true),
  ]).then(([lng, sht, watch, market, alerts, events, track, lean, news, pulse, regime, liveMkt, liveVol, liveBreadth]) => {
    if (gated) return;

    const bull = ranked(lng && lng.rows);
    const bear = ranked(sht && sht.rows);

    const evBy = new Map();
    if (events && events.status !== "pending" && Array.isArray(events.rows)) {
      for (const row of events.rows) if (row && row.t) evBy.set(String(row.t), row);
    }
    const boardBy = new Map();
    const cards = new Set();
    for (const [payload, rows] of [[lng, bull], [sht, bear]]) {
      const knows = isNum(payload && payload.deep) !== null;
      for (const row of rows) {
        if (!row || !row.t) continue;
        const t = String(row.t);
        boardBy.set(t, row);
        if (!knows || row.dp === 1) cards.add(t);
      }
    }

    const answered = (p) => (p && p.status !== "pending" ? p : null);
    const meta = answered(lng) || answered(sht) || lng || sht || {};
    if (typeof meta.sessionDate === "string") {
      UI.freshness({ sessionDate: meta.sessionDate, generatedAt: meta.generatedAt, updatedAt: meta.__updatedAt, source: "boards" });
    }

    paintMeta($("ccMetaDate"), $("ccMetaScreened"), [lng, sht], market);
    paintVerdict(verdictHost, lng, sht, market, alerts, pulse);
    neuronComputed(market && market.status !== "pending" ? market : null);
    Object.assign(S, { pulse, regime, liveMkt, liveBreadth });
    hero();
    paintVol(regime, liveVol, liveBreadth);

    const trk = readTrack(track && track.status !== "pending" ? track : null);

    for (const [id, subId, payload, rows, label, all, route] of [
      ["ccBull", "ccBullSub", lng, bull, "Bullish candidates, ranked", "bullish", "long"],
      ["ccBear", "ccBearSub", sht, bear, "Bearish candidates, ranked", "bearish", "short"],
    ]) {
      const into = $(id);
      const sub = $(subId);
      if (!into) continue;
      into.replaceChildren();
      if (silent(into, payload, all + " board", 240)) {
        if (sub) { sub.textContent = ""; sub.hidden = true; }
        continue;
      }
      if (!rows.length) {
        hush(into, "empty", "No name leaned " + all + " past the band this session.", all + " board", 240);
        if (sub) { sub.textContent = "0"; sub.setAttribute("aria-label", "0 ranked"); sub.hidden = false; }
        continue;
      }
      sideList(into, rows, isNum(payload && payload.deep) !== null, trk, label, evBy);
      infoInto(id === "ccBull" ? "hmBull" : "hmBear", all + " leaders", () => ({
        title: cap1(all), lead: "Names past the dead band on the " + all + " board, in the board's published rank order.",
        facts: [["Pool", String(poolCount(payload) ?? rows.length)], ["Drawn", String(Math.min(rows.length, ROW_MAX))], ["Strip", trk.label]],
        notes: ["Scores are a ranked attention signal on a fixed −100 to +100 scale, not a return forecast. Names inside the dead band are not published on either side.",
          "Each strip draws the name's score by archived session on one scale shared by both sides, against an always-drawn zero rule.",
          "The percentage is the session's price return: close over the prior close. It is not the score move.",
          NO_CARD_SAID],
      }));
      if (sub) {
        const pool = poolCount(payload) ?? rows.length;
        const shown = Math.min(rows.length, ROW_MAX);
        sub.textContent = String(pool);
        sub.setAttribute("aria-label", (shown < pool ? "top " + shown + " of " + pool : "all " + pool) + " — open the " + route + " board");
        sub.dataset.said = shown < pool ? "top " + shown + " of " + pool : "all " + pool;
        sub.hidden = false;
      }
    }
    drawStrips();

    const chg = $("ccChgNote");
    if (chg) { chg.replaceChildren(); paintChanged(chg, track, cards, evBy, boardBy); }

    const alr = $("ccAlerts");
    if (alr) { alr.replaceChildren(); paintAlerts(alr, alerts); }
    const alrSub = $("ccAlertsSub");
    if (alrSub) {
      const alrRows = alerts && alerts.status !== "pending" && Array.isArray(alerts.rows) ? alerts.rows : null;
      if (alrRows) {
        const seen = isNum(alerts.seen);
        const shown = Math.min(alrRows.length, LIST_MAX);
        const of = seen === null ? alrRows.length : seen;
        const floor = alerts.vendorTruncated === true || alerts.readTruncated === true;
        alrSub.textContent = floor ? shown + " of ≥" + of : countSaid(shown, of);
        alrSub.setAttribute("aria-label", (floor ? shown + " of at least " + of : capSaid(shown, of)) + " flagged windows — open the unusual flow page");
      } else { alrSub.textContent = ""; alrSub.removeAttribute("aria-label"); }
    }

    const evr = $("ccEvents");
    if (evr) { evr.replaceChildren(); paintEvents(evr, events); }
    const evSub = $("ccEventsSub");
    if (evSub) {
      const evRows = events && events.status !== "pending" && Array.isArray(events.rows) ? events.rows : null;
      const inWindow = isNum(events && events.inWindow);
      const evShown = evRows === null ? 0 : Math.min(evRows.length, LIST_MAX);
      const evOf = evRows === null ? 0 : inWindow === null ? evRows.length : inWindow;
      evSub.textContent = evRows === null ? "" : countSaid(evShown, evOf);
      if (evRows === null) evSub.removeAttribute("aria-label");
      else evSub.setAttribute("aria-label", capSaid(evShown, evOf) + " in the window — open the events page");
    }

    const drawnAt = Date.now();
    const lea = $("ccLean");
    if (lea) { lea.replaceChildren(); paintLean(lea, lean, $("ccLeanSeg")); }
    const nws = $("ccNews");
    if (nws) { nws.replaceChildren(); paintNews(nws, news, cards, drawnAt); }

    const wtc = $("ccWatch");
    if (wtc) { wtc.replaceChildren(); paintWatch(wtc, watch); }
    const wtcSub = $("ccWatchSub");
    if (wtcSub) {
      const n = rowCount(watch);
      wtcSub.textContent = n === null ? "" : countSaid(Math.min(n, LIST_MAX), n);
      if (n === null) wtcSub.removeAttribute("aria-label");
      else wtcSub.setAttribute("aria-label", capSaid(Math.min(n, LIST_MAX), n) + " inside the dead band — open the watch board");
    }

    meta.__bull = bull;
    meta.__bear = bear;
    meta.__moves = new Map(Object.entries(trk.moveBy));
    renderSpine(meta);

    const notes = [];
    const ld = lng && lng.sessionDate, sd = sht && sht.sessionDate;
    if (ld && sd && ld !== sd) {
      notes.push("These two halves are from different sessions — bullish " +
        ld + ", bearish " + sd + ". Treat the comparison with care.");
    }
    const seenMsg = new Set();
    for (const one of [lng, sht]) {
      const verdict = one ? assessAge(one) : null;
      const message = (verdict && verdict.message) || null;
      if (message && !seenMsg.has(message)) { seenMsg.add(message); notes.push(message); }
    }
    setStale(notes);
    neuronWire(lng, sht);

    const scored = isNum(meta.scored), neutral = isNum(meta.neutral);
    const sideSaid = (word, rows, pool) => word + " " + (rows === null ? DASH : pool !== null && pool > rows ? rows + " of " + pool : rows);
    const parts = [sideSaid("Bullish", rowCount(lng), poolCount(lng)), sideSaid("Bearish", rowCount(sht), poolCount(sht))];
    if (scored !== null && neutral) parts.push("Band " + neutral + " of " + scored);
    const unread = [lng ? null : "bullish", sht ? null : "bearish"].filter(Boolean);
    statusEl.textContent = parts.join(" · ") + "." + (unread.length
      ? " The " + unread.join(" and ") + " board" + (unread.length > 1 ? "s" : "") + " could not be read. Refresh to try again." : "");

    setRailCount("long", poolCount(lng));
    setRailCount("short", poolCount(sht));
    setRailCount("watch", rowCount(watch));
    setRailCount("events", events && events.status !== "pending" ? isNum(events.inWindow) : null);
    live(liveVol);
  }).catch((error) => {
    statusEl.textContent = "The session could not be loaded. Refresh to try again." + (error && error.message ? " (" + error.message + ")" : "");
  });
})();
