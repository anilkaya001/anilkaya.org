(() => {
  "use strict";

  const statusEl = document.getElementById("flowsStatus");
  const staleEl = document.getElementById("flowsStale");
  const spineHost = document.getElementById("spinePlot");

  const UI = window.FlowsUI;
  if (!UI) {
    if (statusEl) {
      statusEl.textContent = "The shared UI library did not load, so this page " +
        "cannot draw. Nothing here is a reading about the session — refresh to try again.";
    }
    return;
  }
  const { isNum, el, svgEl, DASH, MINUS, fmtSigned, fmtStamp, scrollHint, scoreStrip,
    emptyState } = UI;

  const host = (id) => document.getElementById(id);
  const verdictHost = host("ccVerdict");
  if (!statusEl || !spineHost || !verdictHost) return;

  const ROW_MAX = 10;
  const LIST_MAX = 8;
  const CHANGE_MAX = 12;

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

  const sessionsSaid = (n) => n + (n === 1 ? " session" : " sessions");
  const daysSaid = (n) => n + (n === 1 ? " calendar day" : " calendar days");

  const capSaid = (shown, of) => (of > shown ? shown + " of " + of : "all " + of);

  const tone = (v) => {
    const n = isNum(v);
    return n === null ? "" : n > 0 ? " is-pos" : n < 0 ? " is-neg" : "";
  };

  function quiet(into, kind, text) {
    const p = emptyState(kind, text);
    p.classList.add("cc-quiet");
    into.append(p);
    return true;
  }

  function lead(into, text) {
    if (!text) return;
    into.append(el("p", "fc-reading is-lead", text));
  }

  function silent(into, payload, what) {
    if (!payload) {
      return quiet(into, "unreadable",
        "The " + what + " could not be read, so this region is blank. That is a " +
        "fault on this page and not a fact about the session — refresh to try again.");
    }
    if (payload.status === "pending") {
      return quiet(into, "pending",
        "The " + what + " has not been published for this session yet. Nothing has " +
        "been measured here, so nothing is being claimed.");
    }
    return false;
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

  function nameNode(t, hasCard) {
    if (!t) return el("span", "cc-flat", DASH);
    if (!hasCard) {
      const flat = el("span", "cc-flat", t);
      flat.title = NO_CARD_SAID;
      return flat;
    }
    const link = el("a", "cc-open", t);

    link.href = "/flows/ticker/?t=" + encodeURIComponent(t) + "&s=signal&from=overview";
    link.title = "Open the full reader for " + t;
    return link;
  }

  function earningsMark(row, ev) {
    const s = isNum(ev && ev.sdte);
    const d = isNum(row && row.edte);
    const date = (ev && ev.d) || (row && row.ed) || null;
    let text = null, said = null;
    if (s !== null) { text = "⚠" + s + "s"; said = sessionsSaid(s) + " away"; }
    else if (d !== null) { text = "⚠" + d + "d"; said = daysSaid(d) + " away"; }
    else if (date) { text = "⚠"; said = null; }
    if (!text) return null;
    const mark = el("span", "cc-dim cc-ern", text);
    mark.title = "Reports " + (date || "inside the events window") +
      (said ? " · " + said : "") +
      ". A signal carried into a print stops being the signal that was ranked.";
    mark.setAttribute("aria-label", mark.title);
    return mark;
  }

  const NOTE_WALL_CHARS = 420;

  function appendMethod(host, lines, summary, fold) {
    const list = (lines || []).filter((one) => typeof one === "string" && one.trim());
    if (!list.length) return;
    const chars = list.reduce((n, one) => n + one.length, 0);
    if (chars <= NOTE_WALL_CHARS && !fold) {
      host.append(el("p", "cc-quiet cc-ln-note", list.join(" ")));
      return;
    }
    const box = el("details", "ft-how");
    box.append(el("summary", "ft-how-s", summary || "How this reading was made"));
    box.append(el("p", "cc-quiet cc-ln-note", list.join(" ")));
    host.append(box);
  }

  function tableWrap(label) {
    const wrap = el("div", "cc-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", label);
    scrollHint(wrap);
    return wrap;
  }

  function headRow(cols) {
    const thead = el("thead");
    const tr = el("tr");
    for (const [label, cls, said] of cols) {
      const th = el("th", cls || null, label);
      th.setAttribute("scope", "col");
      if (said) th.title = said;
      tr.append(th);
    }
    thead.append(tr);
    return thead;
  }

  function nameCell(row, knowsDeep, mark, cross) {
    const td = el("td", "cc-t");
    const t = String((row && row.t) || "");
    const deep = !knowsDeep || (row && row.dp === 1);
    td.append(nameNode(t, Boolean(t) && deep));

    const nm = row && typeof row.nm === "string" && row.nm.trim() ? row.nm.trim() : null;
    if (nm && nm !== t) td.append(el("span", "cc-nm", nm));

    if (cross) {
      const tag = el("span", "cc-dim cc-cross", cross);
      tag.title = CROSS_SAID[cross] || "";
      td.append(tag);
    }
    if (mark) td.append(mark);
    return td;
  }

  function sideTable(into, rows, knowsDeep, track, label, evBy) {

    const drawsTrack = rows.slice(0, ROW_MAX).some((row) => {
      const series = track.byName[row && row.t];
      return Array.isArray(series) && series.some((v) => isNum(v) !== null);
    });
    const wrap = tableWrap(label);
    const table = el("table", "cc-tbl");
    table.append(headRow([
      ["", "cc-rank"], ["Name", null],
      ["Score", "c-num", "Signed attention score on a fixed −100 to +100 scale; not a return forecast."],
      ["Conv", "c-num", "Conviction measures agreement in the published inputs, not a probability of profit."],

      ["Px chg", "c-num",
        "The session's price return: close over the prior close. Not the " +
        "score move — that is the \u0394 score column in the region above, " +
        "and it is in score points."],
      ["Net prem", "c-num"],
    ].concat(drawsTrack ? [[track.label, "cc-trk"]] : [])));

    const body = el("tbody");
    for (const row of rows.slice(0, ROW_MAX)) {
      const tr = el("tr");

      const mv = track.moveBy[row.t] || null;
      tr.append(el("td", "cc-rank", isNum(row.r) === null ? DASH : String(row.r)));
      tr.append(nameCell(row, knowsDeep, earningsMark(row, evBy.get(String(row.t || ""))),
        mv && mv.current && typeof mv.d1.cross === "string" ? mv.d1.cross : null));
      const score = el("td", "c-num cc-score" + tone(row.s), fmtSigned(row.s));
      const value = isNum(row.s);
      if (value !== null) {
        const scale = el("span", "cc-score-scale");
        scale.setAttribute("aria-hidden", "true");
        const mark = el("i");
        mark.style.width = Math.min(50, Math.abs(value) / 2) + "%";
        mark.style.left = (value < 0 ? 50 - Math.min(50, Math.abs(value) / 2) : 50) + "%";
        scale.append(mark);
        score.append(scale);
      }
      tr.append(score);
      tr.append(el("td", "c-num", isNum(row.cnv) === null ? DASH : String(Math.round(row.cnv))));
      tr.append(el("td", "c-num" + tone(row.chg), pct(row.chg)));
      tr.append(el("td", "c-num" + tone(row.netPrem), usd(row.netPrem)));

      if (!drawsTrack) { body.append(tr); continue; }
      const cell = el("td", "cc-trk");
      const series = track.byName[row.t];
      const measured = (series || []).filter((v) => isNum(v) !== null).length;
      if (series && measured) {

        const strip = scoreStrip(cell, {
          values: series, width: 150, height: 22,
          domain: track.domain, deadBand: track.deadBand, prefix: "cc",
          ariaLabel: "Score for " + row.t + " across " + measured + " archived sessions",
        });

        if (window.FlowsCursor && strip) {

          const geo = UI.stripGeometry(series.length, 150);
          window.FlowsCursor.attach(strip, {
            name: "Score for " + row.t + " by session",
            band: { y0: 0, y1: 22 },
            points: series.map((raw, i) => {
              const v = isNum(raw);
              return {
                x: geo.xMid(i),
                label: track.dates[i] || "session " + (i + 1),
                rows: [{ k: "Score", v: v === null ? "not scored" : fmtSigned(v, 0),
                         cls: v === null ? "" : v > 0 ? "is-pos" : v < 0 ? "is-neg" : "" }],
              };
            }),
          });
        }
      } else {

        cell.textContent = DASH;
      }
      tr.append(cell);
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
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

  const CROSS_WORDS = { cleared: "cleared", faded: "faded", flipped: "flipped" };
  const CROSS_SAID = {
    cleared: "Was inside the dead band at the previous scored session and is " +
      "outside it now. The name became actionable this session.",
    faded: "Was outside the dead band and is inside it now. The exit signal, " +
      "and exactly as load-bearing as the entry.",
    flipped: "Outside the band at both ends with opposite signs. The name did " +
      "not weaken and re-strengthen; it changed sides without resting in the middle.",
  };

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

    const sub = host("ccChgSub");
    const saySub = (said) => {
      if (sub) sub.textContent = said ? said + " · " + CHANGE_SAID : CHANGE_SAID;
    };
    saySub(null);
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
      quiet(into, "unavailable",
        "This score track was published without a change layer: no name carries a " +
        "d1 move and the payload states no session-level change. Nothing about " +
        "what moved can be read from it, and this page will not subtract two " +
        "scores itself — a difference with no session span attached is not a reading.");
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
      quiet(into, measured ? "empty" : "unavailable", lede + shedOut);
      return;
    }

    if (change) {
      const summary = el("div", "cc-change-summary");
      const crossings = change.crossings || {};
      for (const [label, value] of [["Moved", change.moved], ["Cleared", crossings.cleared],
        ["Faded", crossings.faded], ["Flipped", crossings.flipped]]) {
        const metric = el("div", "cc-change-metric");
        metric.append(el("strong", null, isNum(value) === null ? DASH : value));
        metric.append(el("span", null, label));
        summary.append(metric);
      }
      into.append(summary);
    }

    const detail = el("details", "ft-how cc-change-detail");
    detail.append(el("summary", "ft-how-s", "Comparison scope and methodology"));
    if (change) {
      detail.append(el("p", "cc-quiet", "Compared: " + (isNum(change.comparable) ?? DASH) +
        " names · " + (isNum(change.consecutive) ?? DASH) + " single-session comparisons. " +
        "Each row states its comparison span. " +
        (change.prior && change.session ? change.prior + " → " + change.session + ". " : "") +
        (band === null ? "Band unavailable." : "Band: ±" + band + " score points.") +
        (shed ? " " + shed + " counted names omitted from this payload." : "")));
    }
    detail.append(el("p", "cc-quiet cc-lede", lede));
    into.append(detail);

    saySub(capSaid(Math.min(moves.length, CHANGE_MAX), moves.length));

    const wrap = tableWrap("What changed " + CHANGE_SAID);
    const table = el("table", "cc-tbl");
    table.append(headRow([
      ["Event", null, notes.crossing || null],
      ["Name", null],
      ["Δ score", "c-num", notes.change || null],
      ["Over", null, notes.gaps || null],

      ["Ended at", "c-num",
        "The score the name held at the end of this comparison — its newest " +
        "measured score, which on a row that is not about today is not today's. " +
        (notes.score || "")],
      ["Δ resid ×10⁴", "c-num", notes.saturation || null],
      ["Run · sessions", "c-num", notes.run || null],
      ["As of", null,
        "Which session this name was last scored on. A move on an older " +
        "session is real and is not about today."],
    ]));

    const body = el("tbody");
    for (const mv of moves.slice(0, CHANGE_MAX)) {
      const tr = el("tr", mv.stale ? "cc-old" : null);

      const ev = el("td", mv.cross ? "cc-cross is-" + mv.cross : "cc-dim");
      ev.append(el("span", null, mv.cross ? CROSS_WORDS[mv.cross] : "drift"));
      if (mv.cross) ev.title = CROSS_SAID[mv.cross];

      if (mv.ext && mv.at !== null) {
        const hiAt = isNum(mv.ext.hiAt), loAt = isNum(mv.ext.loAt);
        const extreme = hiAt === mv.at ? "window high" : loAt === mv.at ? "window low" : null;
        if (extreme) {
          const tag = el("span", "cc-dim", " · " + extreme);
          tag.title = "The highest and lowest score this name recorded inside the " +
            "published window, with the session it happened on.";
          ev.append(tag);
        }
      }
      tr.append(ev);

      tr.append(nameCell(
        { t: mv.t, dp: cards.has(mv.t) ? 1 : 0 }, true,
        earningsMark(boardBy.get(mv.t) || null, evBy.get(mv.t)), null));

      tr.append(el("td", "c-num" + tone(mv.v), fmtSigned(mv.v)));

      const over = el("td", mv.gap === 1 ? "cc-dim" : null);
      over.append(el("span", null, sessionsSaid(mv.gap)));
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
          const tag = el("span", "cc-dim", " · board-only");
          tag.title = notes.backfill ||
            "One of the sessions this comparison spans was reconstructed from " +
            "archived boards and is genuinely sparser.";
          over.append(tag);
        }
        if (crossedEpoch) {
          const tag = el("span", "cc-dim", " · across the epoch");
          tag.title = notes.epoch ||
            "The two observations come from different selection pools.";
          over.append(tag);
        }
      }
      tr.append(over);

      tr.append(el("td", "c-num" + tone(mv.now), fmtSigned(mv.now)));

      tr.append(el("td", "c-num" + tone(mv.qv), mv.qv === null ? DASH : fmtSigned(mv.qv)));

      const runCell = el("td", "c-num", mv.run === null ? DASH : String(mv.run));
      runCell.title = mv.run === null
        ? "This payload published no run length for the name."
        : mv.run === 0
          ? "The newest score is exactly zero, which belongs to neither side and " +
            "ends the run."
          : sessionsSaid(mv.run) + " in a row on this sign. A run of one is a new " +
            "opinion; a run of thirty is an old one.";
      tr.append(runCell);

      const asOf = el("td", "cc-dim cc-date");
      if (!dated || mv.at === null) {
        asOf.textContent = DASH;
        asOf.title = "This payload published no session index for the name, so " +
          "which session it was last scored on cannot be stated.";
      } else if (!mv.stale) {
        asOf.textContent = "this session";
      } else {
        const behind = lastIndex - mv.at;
        const on = (sessionRows[mv.at] && sessionRows[mv.at].d) || null;
        asOf.textContent = (on ? on : "an earlier session") +
          " · " + sessionsSaid(behind) + " back";
        asOf.title = "This name was not scored in the newest session, so its move " +
          "is real and is not about today.";
      }
      tr.append(asOf);

      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  const keySilence = (payload, read, quietSaid) => {
    if (!payload) return ["unreadable", "could not be read — refresh to try again"];
    if (payload.status === "pending") return ["pending", "not published yet"];
    if (read) return null;
    if (quietSaid) return ["empty", quietSaid];
    return ["unavailable", "not on this payload"];
  };

  function paintVerdict(into, long, short, market, alerts, pulse) {
    const breadth = (market && market.breadth) || {};
    const premium = (market && market.premium) || {};

    const daily = (() => {
      const tot = pulse && pulse.totals;
      if (!tot || tot.status !== "ok" || !Array.isArray(tot.rows)) return null;
      const rows = tot.rows.slice().reverse().slice(-21);
      const gross = rows.map((r) => {
        const c = isNum(r && r.callPrem), pu = isNum(r && r.putPrem);
        return c === null || pu === null ? null : Math.abs(c) + Math.abs(pu);
      });
      const to = tot.rows[0] && typeof tot.rows[0].date === "string" ? tot.rows[0].date : null;
      return { gross, to };
    })();

    const shareOf = (a, b) => {
      if (a === null || b === null) return null;
      const whole = a + b;
      if (!(whole > 0)) return null;
      return [Math.round((a / whole) * 100) + "% bull / " +
        Math.round((b / whole) * 100) + "% bear", null, null];
    };

    const grossNow = (() => {
      if (!daily || !Array.isArray(daily.gross)) return null;
      for (let i = daily.gross.length - 1; i >= 0; i--) {
        if (daily.gross[i] !== null) return daily.gross[i];
      }
      return null;
    })();

    const tileSilence = keySilence;

    const { silence: boardsSilence, date: sessionDate } = boardsRead(long, short);

    const bulls = poolCount(long);
    const bears = poolCount(short);

    const seen = isNum(alerts && alerts.seen);
    const atLimit = Boolean(alerts) && (alerts.vendorTruncated === true || alerts.readTruncated === true);

    const bt = isNum(breadth.tilt);
    const pt = isNum(premium.tilt);

    const bull = isNum(breadth.bull), bear = isNum(breadth.bear);
    const leaned = bull !== null && bear !== null ? bull + bear : null;
    const up = isNum(premium.netPositive), down = isNum(premium.netNegative);
    const gross = up !== null && down !== null ? up + down : null;
    const btSilence = tileSilence(market, bt !== null, leaned === 0 ? "no name leaned" : null);
    const ptSilence = tileSilence(market, pt !== null,
      gross === 0 ? "no net premium was priced" : null);

    const flagSpread = (() => {

      const rows = Array.isArray(alerts && alerts.rows) ? alerts.rows : [];
      const prems = rows.map((r) => isNum(r && r.prem))
        .filter((v) => v !== null && v > 0).sort((a2, b2) => b2 - a2).slice(0, 14);
      return prems.length >= 3 ? ["hist", prems] : null;
    })();

    const tiles = [
      ["Breadth",
        (bull === null ? DASH : String(bull)) + " bull / " + (bear === null ? DASH : String(bear)) + " bear",
        null, tileSilence(market, bull !== null && bear !== null, null), ["split", bull, bear],
        shareOf(bull, bear)],
      ["Cleared",
        (bulls === null ? DASH : bulls) + " bull / " + (bears === null ? DASH : bears) + " bear",
        null, boardsSilence(bulls !== null || bears !== null), ["split", bulls, bears],
        shareOf(bulls, bears)],

      ["Flow bias", pct(pt, 1), tone(pt), ptSilence, ["signed", pt],
        bt !== null
          ? [pct(bt, 1) + " weighting names equally", null, tone(bt)]
          : (btSilence ? ["Names equally weighted: " + btSilence[1], btSilence[0], null] : null)],

      ["Premium", grossNow === null ? DASH : usd(grossNow), null,
        tileSilence(pulse, grossNow !== null, null),
        daily && daily.gross ? ["spark", daily.gross, true] : null,
        daily && daily.to && sessionDate && daily.to !== sessionDate
          ? ["vendor daily totals to " + daily.to + ", not this session", null, null] : null],
      ["Flagged windows", seen === null ? DASH : (atLimit ? "\u2265" : "") + seen, null,
        tileSilence(alerts, seen !== null, null), flagSpread,
        flagSpread ? [flagSpread[1].length + " largest by premium", null, null] : null],
    ];

    const viz = (spec) => {
      if (!Array.isArray(spec)) return null;
      const svg = svgEl("svg", { class: "cc-viz", viewBox: "0 0 100 8",
        preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
      if (spec[0] === "signed") {
        const v = isNum(spec[1]);
        if (v === null) return null;

        const frac = Math.max(-1, Math.min(1, v / 0.25));
        const half = Math.abs(frac) * 50;
        svg.append(svgEl("rect", { class: "cc-viz-t", x: frac < 0 ? 50 - half : 50,
          y: 1, width: Math.max(0.8, half), height: 6 }));
        svg.append(svgEl("line", { class: "cc-viz-z", x1: 50, x2: 50, y1: 0, y2: 8 }));
        svg.setAttribute("class", "cc-viz " + (v < 0 ? "is-neg" : v > 0 ? "is-pos" : "is-zero"));
        return svg;
      }
      if (spec[0] === "split") {
        const a = isNum(spec[1]), b = isNum(spec[2]);
        if (a === null || b === null || !(a + b > 0)) return null;
        const w = (a / (a + b)) * 100;
        svg.append(svgEl("rect", { class: "cc-viz-a", x: 0, y: 1, width: w, height: 6 }));
        svg.append(svgEl("rect", { class: "cc-viz-b", x: w, y: 1, width: 100 - w, height: 6 }));
        return svg;
      }

      if (spec[0] === "spark") {
        const vals = Array.isArray(spec[1]) ? spec[1].map((v) => isNum(v)) : [];
        const seen = vals.filter((v) => v !== null);
        if (seen.length < 3) return null;
        const lo = Math.min(0, ...seen), hi = Math.max(0, ...seen);
        const range = (hi - lo) || 1;
        const step = vals.length > 1 ? 100 / (vals.length - 1) : 100;
        const pts = [];
        vals.forEach((v, i) => {
          if (v === null) return;
          pts.push((step * i).toFixed(2) + "," + (8 - ((v - lo) / range) * 8).toFixed(2));
        });
        if (pts.length < 3) return null;

        if (lo < 0 && hi > 0) {
          const zy = (8 - ((0 - lo) / range) * 8).toFixed(2);
          svg.append(svgEl("line", { class: "cc-viz-z", x1: 0, x2: 100, y1: zy, y2: zy }));
        }
        const last = seen[seen.length - 1];
        svg.append(svgEl("polyline", {
          class: "cc-viz-s" + (spec[2] ? "" : last < 0 ? " is-neg" : last > 0 ? " is-pos" : ""),
          points: pts.join(" "), fill: "none",
        }));
        return svg;
      }

      if (spec[0] === "hist") {
        const vals = Array.isArray(spec[1]) ? spec[1].map((v) => isNum(v)).filter((v) => v !== null) : [];
        if (vals.length < 3) return null;
        const top = Math.max(...vals.map(Math.abs));
        if (!(top > 0)) return null;
        const step = 100 / vals.length;
        vals.forEach((v, i) => {
          const h = Math.max(0.8, (Math.abs(v) / top) * 8);
          svg.append(svgEl("rect", { class: "cc-viz-h",
            x: (step * i + step * 0.16).toFixed(2), width: (step * 0.68).toFixed(2),
            y: (8 - h).toFixed(2), height: h.toFixed(2) }));
        });
        return svg;
      }
      return null;
    };

    for (const [key, value, cls, silence, spec, sub] of tiles) {
      const tile = el("div", "cc-tile");
      if (silence) tile.dataset.empty = silence[0];
      tile.append(el("span", "cc-tile-k", key));
      const shown = el("span", "cc-tile-v" + (cls || ""));
      const halves = String(value).split(" / ");
      if (halves.length === 2) shown.append(el("span", null, halves[0]), " / ", el("span", null, halves[1]));
      else shown.textContent = String(value);
      tile.append(shown);
      const bar = silence ? null : viz(spec);
      if (bar) tile.append(bar);

      if (silence && silence[1]) tile.append(el("span", "cc-tile-s", silence[1]));
      if (sub) {
        const se = el("span", "cc-tile-q" + (sub[2] || ""), sub[0]);
        if (sub[1]) se.dataset.empty = sub[1];
        tile.append(se);
      }
      into.append(tile);
    }
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

  function paintMeta(box, dateEl, screenedEl, liveEl, boards, market, reads) {
    if (!box) return;
    let said = false;

    const { silence: boardsSilence, date } = boardsRead(boards[0], boards[1]);
    const quiet = boardsSilence(date !== null);
    if (dateEl) {
      dateEl.textContent = date || (quiet ? "session " + quiet[1] : "");
      if (quiet) dateEl.dataset.empty = quiet[0];
      else delete dateEl.dataset.empty;
      said = said || Boolean(date) || Boolean(quiet);
    }

    const n = isNum(market && market.n);
    const nQuiet = keySilence(market, n !== null, null);
    if (screenedEl) {
      screenedEl.textContent = n === null
        ? (nQuiet ? "screened " + nQuiet[1] : "")
        : n + " names screened";
      if (nQuiet) screenedEl.dataset.empty = nQuiet[0];
      else delete screenedEl.dataset.empty;
      screenedEl.hidden = n === null && !nQuiet;
      said = said || n !== null || Boolean(nQuiet);
    }

    const stamps = reads.map((r) => (typeof r === "string" && /T\d{2}:\d{2}/.test(r) ? r : null))
      .filter(Boolean).sort();
    if (liveEl && stamps.length) {
      const newest = stamps[stamps.length - 1];
      const m = /T(\d{2}:\d{2})/.exec(newest);
      liveEl.textContent = m ? "read " + m[1] + " UTC" : "";
      liveEl.hidden = !m;
      said = said || Boolean(m);
    }
    box.hidden = !said;
  }

  const TIDE_PERIODS = [
    ["1W", "totals", 5],
    ["1M", "totals", 21],
    ["3M", "totals", 63],
    ["All", "totals", null],
  ];

  function tideSeries(pulse, span) {
    const tot = pulse && pulse.totals;
    if (!tot || tot.status !== "ok" || !Array.isArray(tot.rows)) return null;

    const rows = tot.rows.slice().reverse()
      .map((r) => ({ at: r && r.date, call: isNum(r && r.callPrem), put: isNum(r && r.putPrem) }))
      .filter((r) => r.call !== null || r.put !== null);
    const kept = span && span < rows.length ? rows.slice(-span) : rows;
    return kept.length >= 2 ? kept : null;
  }

  function paintTide(into, seg, pulse) {
    if (silent(into, pulse, "market pulse feed")) return;

    const live = TIDE_PERIODS
      .map(([label, , span]) => [label, span, tideSeries(pulse, span)])
      .filter(([, , rows]) => rows);
    if (!live.length) {
      quiet(into, "empty",
        "The pulse key carried no timestamped premium series for this session.");
      return;
    }

    const seen = new Set();
    const periods = live.filter(([, , rows]) => {
      if (seen.has(rows.length)) return false;
      seen.add(rows.length);
      return true;
    });

    let active = 0;
    const draw = () => {
      into.replaceChildren();
      seg.replaceChildren();
      periods.forEach(([label], i) => {
        const b = el("button", "cc-seg-b", label);
        b.type = "button";
        if (i === active) b.setAttribute("aria-current", "true");
        b.addEventListener("click", () => { active = i; draw(); });
        seg.append(b);
      });

      const [label, , rows] = periods[active];

      const W = 1000, H = 230, padT = 20, padB = 26, padL = 0, padR = 96;
      const plotH = H - padT - padB, plotW = W - padL - padR;

      let lo = 0, hi = 0;
      for (const r of rows) {
        const c = r.call === null ? null : Math.max(0, r.call);
        const p = r.put === null ? null : Math.max(0, r.put);
        if (c !== null && c > hi) hi = c;
        if (p !== null && -p < lo) lo = -p;
      }
      if (!(hi > lo)) { hi = 1; lo = 0; }
      const span = hi - lo;
      const yOf = (v) => padT + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / span) * plotH;
      const zeroY = yOf(0);
      const step = plotW / rows.length;

      const barW = Math.max(0.6, Math.min(22, (step * 0.78) / 2));

      const svg = svgEl("svg", { class: "cc-tide-c", viewBox: "0 0 " + W + " " + H,
        width: "100%", height: H, preserveAspectRatio: "xMidYMid meet", role: "img" });
      const g = svgEl("g", { class: "cc-tide-bars" });
      rows.forEach((r, i) => {
        const x0 = padL + step * i + step * 0.11;
        for (const [v, cls, off] of [
          [r.call === null ? null : Math.max(0, r.call), "is-call", 0],
          [r.put === null ? null : -Math.max(0, r.put), "is-put", barW],
        ]) {
          if (v === null) continue;
          const y = yOf(v);
          g.append(svgEl("rect", {
            class: "cc-tide-b " + cls,
            x: (x0 + off).toFixed(2), width: barW.toFixed(2),
            y: Math.min(y, zeroY).toFixed(2),
            height: Math.max(0.7, Math.abs(zeroY - y)).toFixed(2),
          }));
        }
      });
      svg.append(g);

      const stamp = (v) => {
        if (typeof v !== "string") return null;
        const m = /T(\d{2}:\d{2})/.exec(v);
        return m ? m[1] : (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
      };
      const ends = [[stamp(rows[0].at), 2, "start"], [stamp(rows[rows.length - 1].at), W - 2, "end"]];
      for (const [text, x, anchor] of ends) {
        if (!text) continue;
        const t = svgEl("text", { class: "cc-tide-x", x, y: H - 8, "text-anchor": anchor });
        t.textContent = text;
        svg.append(t);
      }

      for (const v of [hi, 0, lo]) {
        const y = yOf(v);
        svg.append(svgEl("line", { class: "cc-tide-g", x1: padL, x2: W - padR, y1: y, y2: y }));
        const lab = svgEl("text", { class: "cc-tide-y", x: W - padR - 4, y: y - 4, "text-anchor": "end" });

        lab.textContent = v === 0 ? "$0"
          : v > 0 ? usd(v) + " call" : usd(-v) + " put";
        svg.append(lab);
      }
      svg.setAttribute("aria-label",
        rows.length + " sessions" +
        " from " + (stamp(rows[0].at) || "the start of the window") +
        " to " + (stamp(rows[rows.length - 1].at) || "its end") +
        ", the vendor's gross call and put premium drawn as two bars a session " +
        "against one common scale — calls upward to " + usd(hi) + ", puts downward " +
        "to " + usd(-lo) + ". Both are magnitudes; neither side is a negative number.");

      const key = el("div", "cc-tide-k");
      key.append(el("span", "cc-tide-key is-call", "Call premium"));
      key.append(el("span", "cc-tide-key is-put", "Put premium"));

      into.append(key);
      into.append(svg);

      if (window.FlowsCursor && rows.length) {
        window.FlowsCursor.attach(svg, {
          name: "Daily call and put premium, " + label,
          band: { y0: padT, y1: padT + plotH },
          points: rows.map((r, i) => ({
            x: padL + step * i + step * 0.11 + barW,

            label: r.at || DASH,
            rows: [
              { k: "Call", v: r.call === null ? DASH : usd(Math.max(0, r.call)), cls: "is-pos" },
              { k: "Put", v: r.put === null ? DASH : usd(Math.max(0, r.put)), cls: "is-neg" },
            ],
          })),
        });
      }

      into.append(el("p", "cc-note",
        label + " is " + rows.length + " session" + (rows.length === 1 ? "" : "s") +
        " of the vendor's own daily call and put premium, one bar a session, carried " +
        "without cumulation or smoothing. Each pair is what crossed that session — " +
        "not a running total, and not a forecast of anything."));
    };
    draw();
  }

  function paintSplit(into, sub, pulse) {
    if (silent(into, pulse, "market pulse feed")) return;
    const tot = (pulse && pulse.totals) || null;
    if (!tot || tot.status !== "ok" || !Array.isArray(tot.rows)) {
      quiet(into, "unavailable",
        "The pulse key is published without the daily totals this split is built from.");
      return;
    }
    if (!tot.rows.length) {
      quiet(into, "empty", "The daily totals were read and carried no session.");
      return;
    }

    const row = tot.rows[0] || {};
    const call = isNum(row.callPrem), put = isNum(row.putPrem);
    if (call === null || put === null) {
      quiet(into, "unavailable",
        "The newest session carries no call/put premium pair, so there is no split to take.");
      return;
    }

    const a = Math.abs(call), b = Math.abs(put), whole = a + b;
    if (!(whole > 0)) {
      quiet(into, "empty",
        "Neither side of the session carried any premium, so there is no split to take.");
      return;
    }
    const callShare = a / whole;

    const R = 54, C = 64, SW = 15, circ = 2 * Math.PI * R;
    const svg = svgEl("svg", { class: "cc-ring", viewBox: "0 0 128 128", role: "img",
      "aria-label": "Calls are " + (callShare * 100).toFixed(0) + "% of " + usd(whole) +
        " in premium and puts are " + ((1 - callShare) * 100).toFixed(0) + "%." });

    svg.append(svgEl("circle", { class: "cc-ring-put", cx: C, cy: C, r: R, "stroke-width": SW }));
    svg.append(svgEl("circle", { class: "cc-ring-call", cx: C, cy: C, r: R, "stroke-width": SW,
      "stroke-dasharray": (circ * callShare).toFixed(2) + " " + circ.toFixed(2),
      transform: "rotate(-90 " + C + " " + C + ")" }));

    const mid = svgEl("text", { class: "cc-ring-v", x: C, y: C - 2, "text-anchor": "middle" });
    mid.textContent = usd(whole);
    svg.append(mid);
    const cap = svgEl("text", { class: "cc-ring-c", x: C, y: C + 14, "text-anchor": "middle" });
    cap.textContent = "premium";
    svg.append(cap);

    svg.dataset.fxRead = "face";

    const wrap = el("div", "cc-split-w");
    wrap.append(svg);
    const legend = el("div", "cc-split-l");
    for (const [cls, label, share, dollars] of [
      ["is-call", "Calls", callShare, a],
      ["is-put", "Puts", 1 - callShare, b],
    ]) {
      const row = el("div", "cc-split-r " + cls);
      row.append(el("span", "cc-split-dot"));
      row.append(el("span", "cc-split-n", label));
      row.append(el("span", "cc-split-p", (share * 100).toFixed(0) + "%"));
      row.append(el("span", "cc-split-d", usd(dollars)));
      legend.append(row);
    }
    wrap.append(legend);
    into.append(wrap);

    if (sub) {
      const when = typeof row.date === "string" && row.date ? row.date : null;
      sub.textContent = when
        ? "the vendor's gross call and put premium for " + when
        : "the vendor's gross call and put premium, for a session the feed did not date";
      sub.hidden = false;
    }
  }

  function paintAlerts(into, payload) {
    if (silent(into, payload, "flow alerts feed")) return;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      quiet(into, "empty", "The vendor's rules flagged nothing in this read.");
      return;
    }

    const drawn = rows.slice(0, LIST_MAX);

    const priced = drawn.map((row) => isNum(row && row.prem)).filter((one) => one !== null);
    const pool = priced.reduce((sum, one) => sum + Math.abs(one), 0);
    const top = priced.length ? Math.max(...priced.map(Math.abs)) : null;
    const share = pool > 0 && top !== null ? top / pool : null;
    lead(into, (drawn.length === 1
      ? "This is the largest flagged window by premium, not the newest"
      : "These " + drawn.length + " are the largest flagged windows by PREMIUM, not the newest") +
      (share === null
        ? " — and no row here quoted a premium, so nothing ranks them and the order is the " +
          "feed's own tie-break."
        : ", and the biggest is " + (share * 100).toFixed(1) + "% of the premium across them."));

    const wrap = tableWrap("Flagged option windows, largest premium first");
    const table = el("table", "cc-tbl");

    table.append(headRow([
      ["Time \u00b7 ET", null, "The start of the vendor's flagged window, in Eastern time. " +
        "A window is a span rather than a print; hover a cell for both ends."],
      ["Name", null], ["Contract", null], ["Premium", "c-num"],
      ["Side", "c-num", "The vendor's ATTRIBUTION of this window's premium to the ask or the " +
        "bid, as a share of the two. A print at the ask is not proof of a buyer, so this " +
        "column names the side of the quote and never an intent."],
      ["Rule", null, "The vendor's own name for the screen that flagged the window, printed as " +
        "published; this page does not restate its definition."],
    ]));
    const body = el("tbody");
    for (const row of drawn) {
      const tr = el("tr");

      const at = etTime(row.spanStart);
      const when = el("td", "c-num cc-dim", at === null ? DASH : at);
      if (at !== null) {
        const to = etTime(row.spanEnd);
        when.title = to === null
          ? "Window opened " + at + " ET; the vendor stated no end for it."
          : "Window ran " + at + " to " + to + " ET.";
      }
      tr.append(when);

      tr.append(el("td", "cc-t", row.t || DASH));
      tr.append(el("td", "cc-date",
        (row.cp || DASH) + " " + (isNum(row.k) === null ? DASH : row.k) +
        (row.exp ? " " + String(row.exp).slice(5) : "")));
      tr.append(el("td", "c-num", usd(row.prem)));

      const ask = isNum(row.askPrem), bid = isNum(row.bidPrem);
      const two = ask === null || bid === null ? null : Math.abs(ask) + Math.abs(bid);
      const askShare = two === null || two === 0 ? null : Math.abs(ask) / two;

      tr.append(el("td", "c-num",
        askShare === null ? DASH
          : askShare === 0.5 ? "even"
          : (askShare > 0.5 ? "ask " : "bid ") +
            ((askShare > 0.5 ? askShare : 1 - askShare) * 100).toFixed(0) + "%"));

      const rule = el("td", "cc-dim", row.rule || DASH);
      if (row.rule) {
        rule.title = "Flagged by the vendor's " +
          String(row.rule).replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase() +
          " rule, under the vendor's own name for it.";
      }
      tr.append(rule);
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  function paintEvents(into, payload) {
    if (silent(into, payload, "events calendar")) return;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      quiet(into, "empty", "No name in the screened universe reports inside the window.");
      return;
    }

    const drawn = rows.slice(0, LIST_MAX);

    const scored = drawn.filter((row) => isNum(row && row.s) !== null).length;
    const opinionless = drawn.length - scored;
    lead(into, scored + " of the " + drawn.length + " name" +
      (drawn.length === 1 ? "" : "s") + " drawn carr" +
      (scored === 1 ? "ies" : "y") + " a score" +
      (opinionless
        ? " and " + opinionless + " reached this calendar with none, so the boards hold no " +
          "opinion on " + (opinionless === 1 ? "it" : "them") + " going into the print."
        : ", so every name here can be read against the ranking above."));

    const wrap = tableWrap("Names reporting inside the window");
    const table = el("table", "cc-tbl");
    table.append(headRow([
      ["Name", null], ["Date", null], ["In · sessions", "c-num"],
      ["Priced move", "c-num"], ["Score", "c-num"],
      ["Stage", null, "Where this name stopped in the run's funnel. \"gated\" means " +
        "the board was forbidden from holding an opinion on it, not that it had none."],
    ]));
    const body = el("tbody");
    for (const row of drawn) {
      const tr = el("tr");
      tr.append(el("td", "cc-t", row.t || DASH));
      tr.append(el("td", "cc-date", row.d || DASH));

      tr.append(el("td", "c-num", isNum(row.sdte) === null ? DASH : row.sdte + "s"));
      const im = isNum(row.im);
      tr.append(el("td", "c-num", im === null ? DASH : "±" + (Math.abs(im) * 100).toFixed(1) + "%"));

      tr.append(el("td", "c-num" + tone(row.s), fmtSigned(row.s)));
      tr.append(el("td", "cc-dim", row.st || DASH));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);
  }

  function paintWatch(into, payload) {
    if (silent(into, payload, "watch board")) return;
    const rows = ranked(payload.rows);
    if (!rows.length) {

      quiet(into, "unavailable",
        "The watch board published no rows. With a dead band this narrow a " +
        "session where no name sits inside it would be extraordinary, so this " +
        "is more likely a key that did not publish than a market with no middle.");
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
    const nearest = drawn.length + " name" + (drawn.length === 1 ? "" : "s") +
      " nearest the edge";
    lead(into, above + below + onRule === 0
      ? "None of the " + nearest + " published a number to place against the zero rule, so " +
        "this list is ordered and unsided."
      : above + " of the " + nearest + " sit above the zero rule and " + below + " below it" +
        (onRule ? ", " + onRule + " exactly on it" : "") +
        (unplaced ? "; " + unplaced + " published no number to place" : "") + ".");

    const list = el("ul", "cc-moves");
    for (const row of drawn) {
      const li = el("li");
      li.append(el("span", "cc-t", row.t || DASH));

      const resid = isNum(row.resid);

      const [unit, said, cls] = resid !== null
        ? ["resid", fmtSigned(resid, 4), tone(resid)]
        : ["score", fmtSigned(row.s), tone(row.s)];
      const cell = el("span", "c-num" + cls);
      cell.append(el("span", "cc-dim", unit + " "));
      cell.append(document.createTextNode(said));
      cell.title = resid !== null
        ? "The cross-sectional residual this name was ranked on, in the units " +
          "the score is a bounded transform of. The rows are ordered on its " +
          "size, which is how close the name is to leaving the band."
        : "The score, on the ±100 scale, because this payload was published " +
          "before the residual rode on the watch rows. On a narrow band every " +
          "row rounds to the same integer at this scale, so this column can " +
          "order them no better than the payload already has.";
      li.append(cell);
      li.append(el("span", "cc-dim",
        "conv " + (isNum(row.cnv) === null ? DASH : Math.round(row.cnv))));
      list.append(li);
    }
    into.append(list);
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

  function leanCell(row, read) {
    const td = el("td", "cc-ln-c");
    const r = isNum(row && row.leanRatio);
    if (r === null) {
      if (read === "quiet") {
        const flat = el("span", "cc-ln-flat", "no premium");
        flat.title = "Both premium sums were measured at zero: 0/0 is undefined, not " +
          "neutral, so this basket is not placed on the axis. Its measured $0 is beside it.";
        td.append(flat);
        return td;
      }
      const none = el("span", "cc-ln-none", DASH);
      none.title = typeof row.reason === "string" && row.reason ? row.reason
        : "This basket's lean could not be read, so nothing is drawn for it.";
      td.append(none);
      return td;
    }

    const bar = el("span", "cc-ln-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label",
      (row.sector || row.etf || "This basket") + " leaned " + pct(r, 1) +
      " of its two-sided option premium, " +
      (r < 0 ? "left of" : r > 0 ? "right of" : "exactly on") + " the zero rule.");
    bar.append(el("i", "cc-ln-mid"));

    const frac = Math.min(Math.abs(r), 1);
    const fill = el("i", "cc-ln-fill" + tone(r));
    fill.style.width = (frac * 50) + "%";
    fill.style.left = r < 0 ? (50 - frac * 50) + "%" : "50%";
    bar.append(fill);
    td.append(bar);
    return td;
  }

  function paintLean(into, payload, seg) {

    if (seg) seg.replaceChildren();
    const sub = host("ccLeanSub");
    const saySub = (said) => { if (sub) sub.textContent = said; };
    saySub("options premium, not price momentum");
    if (silent(into, payload, "sector premium lean")) return;

    if (payload.status === "quiet") {
      quiet(into, "empty",
        "The sector feed was read and the vendor returned no rows at all, so not one of the " +
        "eleven baskets could be placed. That is a measurement of the feed, not of the market.");
      return;
    }
    if (payload.status === "unreadable") {
      quiet(into, "unreadable",
        "The sector feed returned rows and not one of the eleven baskets carried a readable " +
        "pair of premium sums. Nothing here is a reading about the session: the field names " +
        "on the wire and the ones this pipeline expects have parted company.");
      return;
    }

    const sectors = Array.isArray(payload.sectors) ? payload.sectors : [];
    if (!sectors.length) {
      quiet(into, "unavailable",
        "This payload carried no sector rows, so the page cannot say where any basket " +
        "leaned. A gap in the payload rather than a fact about the market.");
      return;
    }

    const ordered = leanOrder(sectors);
    const leaned = ordered.filter((s) => isNum(s && s.leanRatio) !== null).length;
    const quietN = ordered.filter((s) => s && s.read === "quiet").length;
    const badN = ordered.length - leaned - quietN;
    saySub(leaned + " of " + ordered.length + " leaned");

    const lean = payload.lean && typeof payload.lean === "object" ? payload.lean : null;

    const caveats = [];
    const method = [];

    caveats.push("Bullish minus bearish OPTION premium on the eleven SPDR sector baskets, " +
      "today only.");

    if (lean && typeof lean.relation === "string" && lean.relation) {
      method.push("Derived: " + lean.relation + " — in words, net is bullish minus bearish " +
        "premium, gross is their sum, and the lean is net over gross.");
    }
    caveats.push("Ordered on the RATIO — the share of each basket's own two-sided premium " +
      "that leaned one way — because that is what the publisher ranks on" +
      (lean && typeof lean.rejected === "string" && lean.rejected
        ? ", having rejected " + lean.rejected : "") +
      " — the table below keeps that rank in every mode; the strip above it is ordered " +
      "on whichever quantity its toggle is showing.");
    caveats.push("The dollars ride beside it because a ratio carries no size: +90% on $30k of " +
      "premium and +90% on $300M are not the same fact.");
    method.push("Sign is carried by POSITION — left of the centre rule is bearish premium — " +
      "and by the glyph on every number.");
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
    if (typeof payload.basis === "string" && payload.basis) {
      caveats.push("Basis: " + payload.basis + ".");
    }
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

    const MODES = [
      { label: "$ Premium", noun: "net option premium",
        val: (r) => isNum(r && r.netPremiumUsd), fmt: usd, axis: null,
        said: (n, d) => n + " of " + d + " cleared readable premium",
        one: (b, v) => b + " is the only basket with a readable premium sum, at " +
          usd(v) + " net.",
        two: (bh, vh, bl, vl) => bh + " cleared the most bullish net premium at " + usd(vh) +
          "; " + bl + " the most bearish at " + usd(vl) + ".",
        none: "No basket carried a readable premium sum this session, so none is named.",
        why: "Showing NET PREMIUM in dollars — bullish minus bearish — so basket size is in " +
          "the bar. The bars are scaled to the largest figure on this strip rather than to a " +
          "fixed axis, so heights compare baskets within this session and not one session " +
          "with another." },
      { label: "# Contracts", noun: "net contracts",
        val: netCts, fmt: cts, axis: null,
        said: (n, d) => n + " of " + d + " reported both volumes",
        one: (b, v) => b + " is the only basket that reported both volumes, at " + cts(v) +
          " contracts net.",
        two: (bh, vh, bl, vl) => bh + " traded the most calls over puts at " + cts(vh) +
          " contracts; " + bl + " the most puts over calls at " + cts(vl) + ".",
        none: "No basket reported both a call and a put volume this session, so none is named.",
        why: "Showing NET CONTRACTS — call volume minus put volume, arithmetic on two counts " +
          "the publisher carries per basket, in one unit. A count says nothing about what the " +
          "contracts cost: a million five-cent contracts and a thousand fifty-dollar ones are " +
          "the same figure here. Volumes are read independently of the premium sums, so this " +
          "mode can report a basket the other two cannot, and the other way round." },
      { label: "Flow Ratio", noun: "share of its own premium",
        val: (r) => isNum(r && r.leanRatio), fmt: (v) => pct(v, 1), axis: 1,
        said: (n, d) => n + " of " + d + " leaned",
        one: (b, v) => b + " is the only basket with a readable lean, at " + pct(v, 1) +
          " of its own premium.",
        two: (bh, vh, bl, vl) => bh + " leans most bullish at " + pct(vh, 1) +
          " of its own premium; " + bl + " most bearish at " + pct(vl, 1) + ".",
        none: "No basket carried a readable lean this session, so none is named.",
        why: "Showing the FLOW RATIO — the share of each basket's own two-sided premium that " +
          "leaned one way — on a fixed ±1 axis, which is the one mode whose bar heights " +
          "mean the same thing on every session. It carries no size: +90% on $30K of premium " +
          "and +90% on $300M are not the same fact, and the dollars are in the table below." },
    ];

    let mode = 2;

    const glance = el("div", "cc-lean-glance");
    into.append(glance);

    const drawGlance = () => {
      const M = MODES[mode];
      glance.replaceChildren();
      if (seg) {
        seg.replaceChildren();
        MODES.forEach((m, i) => {
          const b = el("button", "cc-seg-b", m.label);
          b.type = "button";
          if (i === mode) b.setAttribute("aria-current", "true");
          b.addEventListener("click", () => { mode = i; drawGlance(); });
          seg.append(b);
        });
      }

      const vals = new Map();
      for (const r of ordered) vals.set(r, M.val(r));
      const reporting = ordered.filter((r) => vals.get(r) !== null);
      saySub(M.said(reporting.length, ordered.length));

      const strung = reporting.slice().sort((a, b) => vals.get(b) - vals.get(a));
      const rank = strung.concat(ordered.filter((r) => vals.get(r) === null));

      if (reporting.length) {
        const hi = strung[0], lo = strung[strung.length - 1];
        lead(glance, reporting.length === 1
          ? M.one(basket(hi), vals.get(hi))
          : M.two(basket(hi), vals.get(hi), basket(lo), vals.get(lo)));
      } else {
        glance.append(el("p", "cc-quiet", M.none));
      }

      const peak = M.axis !== null ? M.axis
        : reporting.reduce((m, r) => Math.max(m, Math.abs(vals.get(r))), 0);

      const strip = el("div", "cc-chips");
      strip.setAttribute("role", "list");
      for (const r of rank) {
        const v = vals.get(r);
        const chip = el("div", "cc-chip" +
          (v === null ? " is-null" : v > 0 ? " is-pos" : v < 0 ? " is-neg" : ""));
        chip.setAttribute("role", "listitem");
        if (r.etf) chip.append(el("span", "cc-chip-e", r.etf));
        chip.append(el("span", "cc-chip-n", basket(r)));
        chip.append(el("span", "cc-chip-v", v === null ? DASH : M.fmt(v)));

        if (v !== null) {
          const bar = el("span", "cc-chip-bar");
          const fill = el("i");
          const half = peak > 0 ? Math.min(50, Math.abs(v) / peak * 50) : 0;
          fill.style.width = Math.max(1.5, half) + "%";
          fill.style.left = (v < 0 ? 50 - half : 50) + "%";
          bar.append(fill);
          chip.append(bar);
        }

        const net = isNum(r && r.netPremiumUsd), ratio = isNum(r && r.leanRatio);
        const nc = netCts(r);
        chip.title = v === null
          ? (typeof r.reason === "string" && r.reason ? r.reason
            : "This basket carried no readable " + M.noun + ", so it is not placed.")
          : (r.etf ? r.etf + ": " : "") + M.fmt(v) + " " + M.noun + " · " +
            "net " + usd(net) + " · " + cts(nc) + " contracts" +
            " · " + pct(ratio, 1) + " of its own premium.";
        strip.append(chip);
      }
      glance.append(strip);

      glance.append(el("p", "cc-ln-note is-mode", M.why));
    };
    drawGlance();

    const wrap = tableWrap("Sector option-premium lean, most bullish first");
    const table = el("table", "cc-tbl");

    table.append(headRow([
      ["Sector", null], ["Lean", "cc-ln-c"], ["Lean · % of premium", "c-num"],
      ["Net · $", "c-num"], ["Gross · $", "c-num"],
    ]));

    const body = el("tbody");
    for (const row of ordered) {
      const tr = el("tr");

      const read = typeof row.read === "string" ? row.read : "unreadable";
      tr.dataset.read = read;

      const name = el("td", "cc-ln-name");
      name.append(el("span", "cc-t", row.sector || row.fullName || DASH));

      name.append(el("small", "cc-etf", row.etf || DASH));
      if (read !== "ok") {
        const tag = el("span", "cc-dim cc-ln-tag", read);
        tag.title = typeof row.reason === "string" && row.reason ? row.reason
          : (read === "quiet"
            ? "Read, and both premium sums were zero: measured and empty."
            : "This basket's premium could not be read from the response.");
        name.append(tag);
      }
      tr.append(name);

      tr.append(leanCell(row, read));

      tr.append(el("td", "c-num" + tone(row.leanRatio), pct(row.leanRatio, 1)));
      tr.append(el("td", "c-num" + tone(row.netPremiumUsd), usd(row.netPremiumUsd)));
      tr.append(el("td", "c-num", usd(row.grossPremiumUsd)));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    into.append(wrap);

    if (caveats.length) {
      const box = el("ul", "fc-note is-qualifier cc-ln-note");
      for (const c of caveats) box.append(el("li", null, c));
      into.append(box);
    }
    appendMethod(into, method, "How this lean was derived", true);
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
    const sub = host("ccNewsSub");
    if (sub) sub.textContent = "";
    if (silent(into, payload, "headlines feed")) return;

    if (payload.status === "quiet") {
      quiet(into, "empty",
        "The headlines feed was read and the vendor returned no rows: a measurement — the " +
        "tape was checked and was empty — and not a request that failed.");
      return;
    }
    if (payload.status === "unreadable") {
      quiet(into, "unreadable",
        "The headlines feed returned rows and not one carried a headline, so nothing here " +
        "is publishable. A fault on the wire between the vendor and this pipeline, not a " +
        "quiet news day.");
      return;
    }

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      quiet(into, "unavailable",
        "This payload carried no headline rows: the key published, and the list this region " +
        "is made of is not on it.");
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
        (readAge === null
          ? ", which is ahead of this browser's clock, so no age can be stated"
          : ", " + readAge) + ".");
    }
    if (typeof payload.cadence === "string" && payload.cadence) {
      said.push("This feed is fetched " + payload.cadence +
        (typeof payload.staleBy === "string" && payload.staleBy
          ? " and is stale by " + payload.staleBy : "") +
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
      said.push("The vendor returned " +
        (returned === null ? "its own maximum number of rows" : returned + " rows") +
        (requested === null ? "" : " against the " + requested + " asked for") +
        ", which is its documented ceiling — so the true population is UNKNOWN and at " +
        "least that large.");
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
    const undatedKept = isNum(payload.undatedKept);
    const undatedSeen = isNum(payload.undatedSeen);
    if (undatedKept !== null && undatedKept > 0) {
      said.push(undatedKept +
        (undatedKept === 1 ? " stored row carries" : " of the stored rows carry") +
        " no timestamp and cannot be aged; " +
        (undatedKept === 1 ? "it sorts" : "they sort") + " last rather than being dated to now.");
    } else if (undatedSeen !== null && undatedSeen > 0) {
      said.push(undatedSeen + " undated " + (undatedSeen === 1 ? "row" : "rows") +
        " arrived on the wire and the cap shed " + (undatedSeen === 1 ? "it" : "them") +
        " before this list, so every row below can be aged.");
    }

    const unflagged = rows.filter((r) => r && (r.major === null || r.major === undefined)).length;
    if (unflagged) {
      said.push(unflagged +
        (unflagged === 1 ? " stored row carried" : " of the stored rows carried") +
        " no major/minor flag at all, which is not the same as having been flagged not-major.");
    }
    const cadence = typeof payload.cadence !== "string" ? "Snapshot; cadence not specified"
      : /after the close/i.test(payload.cadence) ? "After-close snapshot"
        : /morning/i.test(payload.cadence) ? "Morning snapshot" : "Snapshot; cadence not specified";
    const coverage = [readAge ? "Fetched " + readAge : "Fetch age unknown", cadence];
    if (payload.atVendorLimit === true) coverage.push("Vendor ceiling reached; total unknown");
    if (payload.capped === true && shed > 0) coverage.push(shed + " received rows omitted");
    if (undatedKept > 0) coverage.push(undatedKept + " undated rows");
    into.append(el("p", "cc-quiet cc-news-status", coverage.join(" · ")));
    const newsDetail = el("details", "ft-how");
    newsDetail.append(el("summary", "ft-how-s", "News freshness and coverage"));
    newsDetail.append(el("p", "cc-quiet cc-nw-note", said.join(" ")));
    into.append(newsDetail);

    const list = el("ul", "cc-nw");
    for (const row of rows.slice(0, LIST_MAX)) {
      const li = el("li", "cc-nw-row");

      li.append(el("p", "cc-nw-h",
        typeof row.headline === "string" && row.headline ? row.headline : DASH));

      const meta = el("p", "cc-nw-m");

      const at = isNum(row && row.createdAtMs);
      const age = at === null ? null : agoSaid(at, now);
      const ageNode = el("span", "cc-nw-age",
        at === null ? "undated" : (age === null ? "stamped ahead of this clock" : age));
      ageNode.title = at === null
        ? "This row carried no timestamp, so its age is not known and none is claimed."
        : "The vendor's own stamp, verbatim: " +
          (typeof row.createdAt === "string" ? row.createdAt : String(at));
      meta.append(ageNode);

      if (typeof row.source === "string" && row.source) {
        meta.append(el("span", "cc-nw-src", row.source));
      }

      if (typeof row.sentiment === "string" && row.sentiment) {
        const sent = el("span", "cc-nw-sent", row.sentiment);
        sent.title = "The vendor's own sentiment label, verbatim and never mapped onto a " +
          "number. It is not this product's score and does not enter it.";
        meta.append(sent);
      }

      if (row && row.major === true) {
        const mark = el("span", "cc-nw-major", "major");
        mark.title = "The vendor flagged this headline as major.";
        meta.append(mark);
      }

      const tickers = Array.isArray(row && row.tickers) ? row.tickers : [];
      const named = [];
      for (const raw of tickers) {
        const t = typeof raw === "string" ? raw.trim().toUpperCase() : "";
        if (t) named.push(t);
      }
      if (named.length) {
        const box = el("span", "cc-nw-tks");
        for (const t of named.slice(0, NEWS_TICKERS)) {

          if (cards.has(t)) { box.append(nameNode(t, true)); continue; }
          const flat = el("span", "cc-nw-tk", t);
          flat.title = "Named by the vendor on this headline. This session built no card for " +
            "it, so there is nothing here to open.";
          box.append(flat);
        }

        if (named.length > NEWS_TICKERS) {
          box.append(el("span", "cc-nw-more", "+" + (named.length - NEWS_TICKERS) + " more"));
        }
        meta.append(box);
      }

      li.append(meta);
      list.append(li);
    }
    into.append(list);

    if (sub) {

      const shown = Math.min(rows.length, LIST_MAX);
      sub.textContent = capSaid(shown, kept === null ? rows.length : kept) +
        (readAge === null ? "" : " · fetched " + readAge);
    }
  }

  let spineDrawn = null;
  let spineW = 0;

  function spineWidth() {
    const measured = Math.round(spineHost.clientWidth);
    return measured > 0 ? Math.min(2400, measured) : 720;
  }

  function renderSpine(payload) {
    spineDrawn = payload;
    spineHost.replaceChildren();

    const band = isNum(payload.deadBand);
    const scored = isNum(payload.scored);
    const neutral = isNum(payload.neutral);
    const moves = payload.__moves instanceof Map ? payload.__moves : new Map();

    const W = spineWidth();
    spineW = W;
    const H = 92;
    const padX = 14, axisY = 56;
    const plotW = W - padX * 2;
    const xOf = (s) => padX + ((s + 100) / 200) * plotW;

    const svg = svgEl("svg", {
      class: "sp", viewBox: `0 0 ${W} ${H}`, width: W, height: H,
      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    const defs = svgEl("defs");
    const pat = svgEl("pattern", {
      id: "spBand", width: 6, height: 6, patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)", class: "sp-bandpat",
    });
    pat.append(svgEl("line", { x1: 3, y1: 0, x2: 3, y2: 6, stroke: "currentColor", "stroke-width": 1.4 }));
    defs.append(pat);
    svg.append(defs);

    svg.append(svgEl("line", { class: "sp-axis", x1: padX, x2: W - padX, y1: axisY, y2: axisY }));

    if (band !== null) {
      svg.append(svgEl("rect", {
        class: "sp-band", x: xOf(-band), y: axisY - 13, width: xOf(band) - xOf(-band), height: 26,
        fill: "url(#spBand)",
      }));
    }

    for (const s of [-100, -50, 0, 50, 100]) {
      svg.append(svgEl("line", { class: "sp-tick", x1: xOf(s), x2: xOf(s), y1: axisY + 10, y2: axisY + 15 }));
      const t = svgEl("text", { class: "sp-ticklabel", x: xOf(s), y: axisY + 27, "text-anchor": "middle" });
      t.textContent = s === 0 ? "0" : fmtSigned(s, 0);
      svg.append(t);
    }

    const bandLabel = svgEl("text", {
      class: "sp-bandlabel", x: xOf(0), y: axisY - 19, "text-anchor": "middle",
    });
    bandLabel.textContent = band === null

      ? "no dead band published for this session · the axis is drawn without one"
      : scored !== null && neutral !== null
        ? neutral + " of " + scored + " inside ±" + band + " · not named"
        : "±" + band + " dead band · not named";
    svg.append(bandLabel);

    let trails = 0;
    const marks = [];
    for (const [rows, cls] of [[payload.__bull, "is-bull"], [payload.__bear, "is-bear"]]) {
      for (const r of rows || []) {
        const s = isNum(r.s);
        if (s === null) continue;
        const t = String(r.t || "");
        const mv = moves.get(t) || null;

        const usable = Boolean(mv && mv.current && mv.last !== null && mv.last === s);
        const v = usable ? isNum(mv.d1.v) : null;
        const gap = usable ? isNum(mv.d1.gap) : null;
        if (v !== null && v !== 0 && gap !== null) {
          const from = Math.max(-100, Math.min(100, s - v));
          const trail = svgEl("line", {
            class: "sp-move " + cls + (gap > 1 ? " is-gapped" : ""),
            x1: xOf(from), x2: xOf(s), y1: axisY, y2: axisY,
            stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round",
            opacity: 0.42,

            "stroke-dasharray": gap > 1 ? "3 2.5" : null,
          });
          const trailSaid = svgEl("title");
          trailSaid.textContent = t + " " + fmtSigned(v, 0) + " over " + sessionsSaid(gap) +
            ", from " + fmtSigned(s - v, 0);
          trail.append(trailSaid);
          svg.append(trail);
          trails++;
        }

        if (usable && typeof mv.d1.cross === "string") {
          svg.append(svgEl("circle", {
            class: "sp-cross is-" + mv.d1.cross, cx: xOf(s), cy: axisY, r: 8,
            fill: "none", stroke: "currentColor", "stroke-width": 1.2, opacity: 0.85,
          }));
        }

        const dot = svgEl("circle", {
          class: "sp-dot " + cls, cx: xOf(s), cy: axisY, r: 4.5, "data-t": t,
        });
        const label = svgEl("title");

        label.textContent = t + " " + fmtSigned(s, 0) +
          (v !== null && gap !== null
            ? ", " + fmtSigned(v, 0) + " over " + sessionsSaid(gap)
            : mv && mv.on ? ", last scored " + mv.on : "") +

          (usable && typeof mv.d1.cross === "string" ? " · " + mv.d1.cross : "");
        dot.append(label);
        svg.append(dot);

        marks.push({ s, t, v, gap, cross: usable && typeof mv.d1.cross === "string"
          ? mv.d1.cross : null, on: mv && mv.on ? mv.on : null });
      }
    }

    svg.setAttribute("aria-label",
      "Score axis from minus 100 to plus 100. " +
      (neutral !== null && scored !== null
        ? neutral + " of " + scored + " names scored inside the " +
          (band === null ? "dead band, whose width this payload does not state,"
            : "plus or minus " + band + " dead band") +
          " and are not published. "
        : "") +
      ((payload.__bull || []).length) + " bullish and " + ((payload.__bear || []).length) +
      " bearish names cleared it." +
      (trails ? " " + trails + " of them trail the move since their previous scored session." : ""));

    if (window.FlowsCursor && marks.length) {
      const byScore = new Map();
      for (const m of marks) {
        if (!byScore.has(m.s)) byScore.set(m.s, []);
        byScore.get(m.s).push(m);
      }
      const SHOW = 6;
      window.FlowsCursor.attach(svg, {
        name: "Every cleared name on the score axis",
        band: { y0: axisY - 16, y1: axisY + 16 },
        points: [...byScore.keys()].sort((a, b) => a - b).map((score) => {
          const at = byScore.get(score);
          const rows = at.slice(0, SHOW).map((m) => ({
            k: m.t,

            v: m.v !== null && m.gap !== null
              ? fmtSigned(m.v, 0) + " over " + sessionsSaid(m.gap)
              : m.on ? "last scored " + m.on : "no earlier scored session",
            cls: m.v === null ? "" : m.v > 0 ? "is-pos" : m.v < 0 ? "is-neg" : "",
          }));
          if (at.length > SHOW) {
            rows.push({ k: "and " + (at.length - SHOW) + " more",
                        v: "at this same score", cls: "" });
          }
          return { x: xOf(score), label: fmtSigned(score, 0), rows };
        }),
      });
    }

    spineHost.append(svg);
  }

  let spineTimer = 0;
  window.addEventListener("resize", () => {
    if (!spineDrawn) return;
    clearTimeout(spineTimer);
    spineTimer = setTimeout(() => {
      if (spineDrawn && Math.abs(spineWidth() - spineW) > 2) renderSpine(spineDrawn);
    }, 150);
  });

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
  }

  function setRailCount(side, n) {
    const slot = document.querySelector('[data-rail-count="' + side + '"]');
    if (!slot || n === null) return;
    slot.textContent = String(n);
    slot.hidden = false;
  }

  function stampUpdated(response, body) {
    const at = isNum(response.headers.get("X-Payload-Updated"));
    if (body && typeof body === "object") body.__updatedAt = at !== null && at > 0 ? at : null;
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

  function loadRegion(path) {
    return fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json().then((body) => stampUpdated(r, body)) : null))
      .catch(() => null);
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
  ]).then(([lng, sht, watch, market, alerts, events, track, lean, news, pulse]) => {

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

    paintMeta(host("ccMeta"), host("ccMetaDate"), host("ccMetaScreened"), host("ccMetaLive"),
      [lng, sht], market,
      [alerts && alerts.readAt, pulse && pulse.readAt, lean && lean.readAt,
        news && news.readAt, market && market.generatedAt]);
    paintVerdict(verdictHost, lng, sht, market, alerts, pulse);

    const tideHost = host("ccTide"), tideSeg = host("ccTideSeg");
    if (tideHost && tideSeg) paintTide(tideHost, tideSeg, pulse);
    const splitHost = host("ccSplit");
    if (splitHost) paintSplit(splitHost, host("ccSplitSub"), pulse);

    const trk = readTrack(track && track.status !== "pending" ? track : null);

    for (const [id, subId, payload, rows, label, all] of [
      ["ccBull", "ccBullSub", lng, bull, "Bullish candidates, ranked", "bullish"],
      ["ccBear", "ccBearSub", sht, bear, "Bearish candidates, ranked", "bearish"],
    ]) {
      const into = host(id);
      const sub = host(subId);
      if (!into) continue;
      into.replaceChildren();
      if (silent(into, payload, all + " board")) {
        if (sub) { sub.textContent = ""; sub.hidden = true; }
        continue;
      }
      if (!rows.length) {

        quiet(into, "empty",
          "No name leaned " + all + " past the band this session.");
        if (sub) { sub.textContent = "0 ranked"; sub.hidden = false; }
        continue;
      }
      sideTable(into, rows, isNum(payload && payload.deep) !== null, trk, label, evBy);
      if (sub) {

        const pool = poolCount(payload) ?? rows.length;
        const shown = Math.min(rows.length, ROW_MAX);
        sub.textContent = shown < pool ? "top " + shown + " of " + pool : "all " + pool;
        sub.hidden = false;
      }
    }

    const chg = host("ccChg");
    if (chg) { chg.replaceChildren(); paintChanged(chg, track, cards, evBy, boardBy); }

    const alr = host("ccAlerts");
    if (alr) { alr.replaceChildren(); paintAlerts(alr, alerts); }
    const alrSub = host("ccAlertsSub");
    if (alrSub) {
      const said = [];

      const alrRows = alerts && alerts.status !== "pending" && Array.isArray(alerts.rows)
        ? alerts.rows : null;
      if (alrRows) {
        const seen = isNum(alerts.seen);
        const shown = Math.min(alrRows.length, LIST_MAX);
        const of = seen === null ? alrRows.length : seen;

        said.push(alerts.vendorTruncated === true || alerts.readTruncated === true
          ? shown + " of ≥" + of : capSaid(shown, of));
      }

      const cadence = alerts && alerts.status !== "pending"
        ? (alerts.refreshed === "intraday" ? "intraday"
          : alerts.refreshed === "nightly" ? "nightly" : null)
        : null;
      const read = alerts && typeof alerts.readAt === "string" ? Date.parse(alerts.readAt) : NaN;
      if (Number.isFinite(read)) {
        said.push((cadence ? cadence + " read " : "read ") + (fmtStamp(alerts.readAt) || DASH)
          + (alrRows && !cadence ? ", cadence not published" : ""));
      } else if (alrRows) {
        said.push(cadence ? cadence + " read" : "cadence not published");
      }
      alrSub.textContent = said.join(" · ");
    }

    const evr = host("ccEvents");
    if (evr) { evr.replaceChildren(); paintEvents(evr, events); }
    const evSub = host("ccEventsSub");
    if (evSub) {

      const evRows = events && events.status !== "pending" && Array.isArray(events.rows)
        ? events.rows : null;
      const inWindow = isNum(events && events.inWindow);
      evSub.textContent = evRows === null ? ""
        : capSaid(Math.min(evRows.length, LIST_MAX),
            inWindow === null ? evRows.length : inWindow) + " in the window";
    }

    const drawnAt = Date.now();
    const lea = host("ccLean");
    if (lea) { lea.replaceChildren(); paintLean(lea, lean, host("ccLeanSeg")); }
    const nws = host("ccNews");
    if (nws) { nws.replaceChildren(); paintNews(nws, news, cards, drawnAt); }

    const wtc = host("ccWatch");
    if (wtc) { wtc.replaceChildren(); paintWatch(wtc, watch); }
    const wtcSub = host("ccWatchSub");
    if (wtcSub) {

      const n = rowCount(watch);
      wtcSub.textContent = n === null
        ? "inside the dead band" : capSaid(Math.min(n, LIST_MAX), n);
    }

    const answered = (p) => (p && p.status !== "pending" ? p : null);
    const meta = answered(lng) || answered(sht) || lng || sht || {};
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

    const seen = new Set();
    for (const payload of [lng, sht]) {
      const verdict = payload ? assessAge(payload) : null;
      const message = (verdict && verdict.message) || null;
      if (message && !seen.has(message)) { seen.add(message); notes.push(message); }
    }
    setStale(notes);

    const wrote = document.querySelector(".ak-neuron time");
    const built = Date.parse((lng && lng.generatedAt) || (sht && sht.generatedAt) || "");
    if (wrote && Number.isFinite(built) && Date.parse(wrote.dateTime) < built) {
      const box = wrote.closest(".ak-neuron");
      box.classList.add("is-old");
      const src = box.querySelector(".ak-neuron-src");
      if (src) {
        src.append(" Written before the boards were rebuilt at " + fmtStamp(new Date(built).toISOString()) +
          ", so it reads an earlier publication.");
      }
    }

    const scored = isNum(meta.scored), neutral = isNum(meta.neutral);

    const sideSaid = (rows, pool, word) => rows === null ? DASH + " " + word
      : pool !== null && pool > rows ? rows + " of " + pool + " " + word + " carried"
        : rows + " " + word;

    const lngRows = rowCount(lng), shtRows = rowCount(sht);
    const lngPool = poolCount(lng), shtPool = poolCount(sht);
    const cut = (rows, pool) => rows !== null && pool !== null && pool > rows;

    const unknown = (rows) => rows === null;
    const parts = [];
    if (cut(lngRows, lngPool) || cut(shtRows, shtPool) ||
        unknown(lngRows) || unknown(shtRows)) {
      parts.push(sideSaid(lngRows, lngPool, "bullish") + " · " +
        sideSaid(shtRows, shtPool, "bearish"));
    }
    if (scored !== null && neutral !== null) parts.push(neutral + " of " + scored + " inside the band");

    const unread = [lng ? null : "bullish", sht ? null : "bearish"].filter(Boolean);
    const said = parts.length ? parts.join(" · ") + "." : "";
    statusEl.textContent = said + (unread.length
      ? (said ? " " : "") + "The " + unread.join(" and ") + " board" + (unread.length > 1 ? "s" : "") +
        " could not be read, so " + (unread.length > 1 ? "neither side is" : "that side is not") +
        " on this page. Refresh to try again."
      : "");

    setRailCount("long", poolCount(lng));
    setRailCount("short", poolCount(sht));
    setRailCount("watch", rowCount(watch));

    setRailCount("events", events && events.status !== "pending"
      ? isNum(events.inWindow) : null);
  }).catch(() => {
    statusEl.textContent = "The session could not be loaded. Refresh to try again.";
  });

  scrollHint(document.querySelector(".flows-rail"));
  const ccScroll = document.getElementById("ccScroll");
  if (ccScroll) {
    const edge = () => ccScroll.classList.toggle("is-scrolled", ccScroll.scrollTop > 2);
    ccScroll.addEventListener("scroll", edge, { passive: true });
    edge();
  }
})();
