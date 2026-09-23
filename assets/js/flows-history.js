(() => {
  "use strict";

  const statusEl = document.getElementById("recStatus");
  const curveHost = document.getElementById("recCurve");
  const curveNote = document.getElementById("recCurveNote");
  const wrap = document.getElementById("recTableWrap");
  const body = document.getElementById("recBody");
  if (!statusEl || !curveHost || !body) return;

  const COLUMNS = 6;

  function dated(node, text) {
    node.textContent = /\d{4}-\d{2}-\d{2}/.test(text) ? "" : text;
    if (node.textContent) return node;
    const re = /\d{4}-\d{2}-\d{2}/g;
    let at = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > at) node.append(document.createTextNode(text.slice(at, m.index)));
      const d = document.createElement("span");
      d.className = "flows-date";
      d.textContent = m[0];
      node.append(d);
      at = m.index + m[0].length;
    }
    if (at < text.length) node.append(document.createTextNode(text.slice(at)));
    return node;
  }
  const MINUS = "−";
  const DASH = "—";

  const MIN_SESSIONS = 5;

  let drawnHorizons = null;
  let drawnMeta = {};

  const STALE_WRITE_MS = 30 * 60 * 60 * 1000;
  const STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;

  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const svgEl = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  };

  function pct(v, d) {
    const n = isNum(v);
    if (n === null) return DASH;
    const s = (Math.abs(n) * 100).toFixed(d === undefined ? 2 : d);
    return (n < 0 ? MINUS : n > 0 ? "+" : "") + s + "%";
  }

  const kSaid = (k) => k + (k === 1 ? " session" : " sessions");

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function signClass(v) {
    const n = isNum(v);
    return n === null ? "" : n < 0 ? " fb-neg" : n > 0 ? " fb-pos" : " fb-flat";
  }

  function curveWidth() {

    const rect = Math.floor(curveHost.getBoundingClientRect().width);
    const client = Math.floor(curveHost.clientWidth);
    const host = rect > 0 && client > 0 ? Math.min(rect, client)
      : Math.max(rect > 0 ? rect : 0, client > 0 ? client : 0);
    return host > 0 ? Math.min(2400, host) : 300;
  }

  function renderCurve(horizons, meta) {
    drawnHorizons = horizons;
    drawnMeta = meta || {};
    curveHost.replaceChildren();

    const rows = (Array.isArray(horizons) ? horizons : [])
      .map((h) => ({
        k: isNum(h && h.k),
        ls: isNum(h && h.ls),
        n: isNum(h && h.n),
        prior: isNum(h && h.prior),
        priorN: isNum(h && h.priorN),
        hit: isNum(h && h.hit),
        hitS: isNum(h && h.hitSessions),
        hitN: isNum(h && h.hitN),
        priorHit: isNum(h && h.priorHit),
        priorHitS: isNum(h && h.priorHitSessions),
        priorHitN: isNum(h && h.priorHitN),
      }))
      .filter((h) => h.k !== null);

    const plottable = (v, n) => v !== null && n !== null && n >= MIN_SESSIONS;
    const LS = { cur: (h) => h.ls, curN: (h) => h.n, pri: (h) => h.prior, priN: (h) => h.priorN,
      names: () => null, ref: 0, what: "long minus short", fmt: pct };
    const HIT = { cur: (h) => h.hit, curN: (h) => h.hitS, pri: (h) => h.priorHit,
      priN: (h) => h.priorHitS, names: (h, p) => (p ? h.priorHitN : h.hitN), ref: 0.5,
      what: "hit rate",
      fmt: (v, d) => (isNum(v) === null ? DASH : (v * 100).toFixed(d === undefined ? 0 : d) + "%") };
    let mode = LS;
    let cur = rows.filter((h) => plottable(LS.cur(h), LS.curN(h)));
    let pri = rows.filter((h) => plottable(LS.pri(h), LS.priN(h)));
    if (!cur.length && !pri.length) {
      mode = HIT;
      cur = rows.filter((h) => plottable(HIT.cur(h), HIT.curN(h)));
      pri = rows.filter((h) => plottable(HIT.pri(h), HIT.priN(h)));
    }

    if (!cur.length && !pri.length) {
      const p = document.createElement("p");
      p.className = "rec-empty";

      let best = null;
      for (const h of rows) {
        for (const n of [h.n, h.priorN, h.hitS, h.priorHitS]) {
          if (n !== null && (best === null || n > best)) best = n;
        }
      }
      p.dataset.empty = best !== null && best > 0 ? "quiet" : "pending";
      p.textContent = best !== null && best > 0
        ? "No horizon has reached " + MIN_SESSIONS + " scored sessions yet — the " +
          "longest has " + best + ". Nothing is plotted, because a mean of " +
          best + " observations is mostly its own sampling error."

        : "No horizon carries a scored session yet. The record begins with the " +
          "first pipeline run after this page shipped, and the shortest horizon " +
          "needs that many sessions to close — with both sides of the spread " +
          "measured — before it can be plotted.";
      curveHost.append(p);
      return;
    }

    const axis = [...new Set([...cur, ...pri].map((h) => h.k))].sort((a, b) => a - b);

    const W = curveWidth();

    const H = pri.length ? 234 : 220;
    const padL = 54, padR = 18, padT = 18, padB = pri.length ? 54 : 40;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const values = [...cur.map(mode.cur), ...pri.map(mode.pri)];

    const lo = Math.min(mode.ref, ...values), hi = Math.max(mode.ref, ...values);
    const span = Math.max(hi - lo, 1e-4);
    const pad = span * 0.15;
    const yLo = lo - pad, yHi = hi + pad;
    const yOf = (v) => padT + plotH - ((v - yLo) / (yHi - yLo)) * plotH;
    const xOf = (k) => padL + (axis.length === 1
      ? plotW / 2
      : (axis.indexOf(k) / (axis.length - 1)) * plotW);

    const svg = svgEl("svg", {
      class: "rc", viewBox: `0 0 ${W} ${H}`, width: W, height: H,

      style: "max-width:100%",
      role: "img", preserveAspectRatio: "xMidYMid meet",

      "data-plot-top": padT,
      "data-plot-height": plotH,
    });

    svg.append(svgEl("line", {
      class: "rc-zero", x1: padL, x2: W - padR, y1: yOf(mode.ref), y2: yOf(mode.ref),
    }));

    const refY = yOf(mode.ref);
    for (const v of [yHi, mode.ref, yLo]) {
      const y = v === mode.ref ? refY
        : v > mode.ref ? Math.min(yOf(v), refY - 16) : Math.max(yOf(v), refY + 16);
      const t = svgEl("text", {
        class: v === mode.ref ? "rc-axislabel is-zero" : "rc-axislabel",
        x: padL - 8, y: y + 4, "text-anchor": "end",
      });
      t.textContent = v === 0 ? "0" : v === mode.ref ? mode.fmt(v) : mode.fmt(v, 1);
      svg.append(t);
    }

    function pathFor(series, valueOf) {
      const have = new Map(series.map((h) => [h.k, valueOf(h)]));
      let d = "", open = false;
      for (const k of axis) {
        if (!have.has(k)) { open = false; continue; }
        d += (open ? " L" : d ? " M" : "M") +
          xOf(k).toFixed(2) + " " + yOf(have.get(k)).toFixed(2);
        open = true;
      }
      return d;
    }

    if (pri.length) {
      svg.append(svgEl("path", {
        class: "rc-line is-prior", d: pathFor(pri, mode.pri),
        "stroke-dasharray": "6 4",
      }));
    }
    if (cur.length) {
      svg.append(svgEl("path", { class: "rc-line", d: pathFor(cur, mode.cur) }));
    }

    const overSaid = (h, p) => {
      const n = p ? mode.priN(h) : mode.curN(h);
      const names = mode.names(h, p);
      return "over " + n + " scored session" + (n === 1 ? "" : "s") +
        (names === null ? "" : " and " + names + " names");
    };

    const byK = new Map();
    for (const h of cur) byK.set(h.k, { ...(byK.get(h.k) || {}), cur: h });
    for (const h of pri) byK.set(h.k, { ...(byK.get(h.k) || {}), pri: h });

    for (const k of axis) {
      const at = byK.get(k) || {};
      const x = xOf(k);

      if (at.pri) {

        const dot = svgEl("circle", {
          class: "rc-dot is-prior", cx: x, cy: yOf(mode.pri(at.pri)), r: 4,
          fill: "none", stroke: "currentColor", "stroke-width": 1.4,
        });
        const title = svgEl("title");
        title.textContent = kSaid(k) + " under the PRIOR selection rule: " +
          mode.fmt(mode.pri(at.pri)) + " " + mode.what + ", " + overSaid(at.pri, true);
        dot.append(title);
        svg.append(dot);
      }

      if (at.cur) {
        const v = mode.cur(at.cur);
        const dot = svgEl("circle", {
          class: "rc-dot " + (v < mode.ref ? "is-neg" : v > mode.ref ? "is-pos" : "is-flat"),
          cx: x, cy: yOf(v), r: 4.5,
        });
        const title = svgEl("title");
        title.textContent = kSaid(k) + ": " + mode.fmt(v) + " " + mode.what + ", " +
          overSaid(at.cur, false);
        dot.append(title);
        svg.append(dot);
      }

      const xl = svgEl("text", { class: "rc-ticklabel", x, y: H - padB + 20, "text-anchor": "middle" });
      xl.textContent = k + "d";
      svg.append(xl);

      if (at.cur) {
        const nl = svgEl("text", { class: "rc-nlabel", x, y: H - padB + 33, "text-anchor": "middle" });
        nl.textContent = "n=" + mode.curN(at.cur);
        svg.append(nl);
      }
      if (at.pri) {
        const nl = svgEl("text", { class: "rc-nlabel is-prior", x, y: H - padB + (at.cur ? 44 : 33), "text-anchor": "middle" });
        nl.textContent = "prior n=" + mode.priN(at.pri);
        svg.append(nl);
      }
    }

    const said = [];
    if (cur.length) {
      said.push("Current selection rule: " +
        cur.map((h) => kSaid(h.k) + ", " + mode.fmt(mode.cur(h)) + " " + overSaid(h, false))
          .join("; "));
    }
    if (pri.length) {
      said.push("Prior selection rule" + (drawnMeta.epoch ? " (before " + drawnMeta.epoch + ")" : "") +
        ", drawn dashed: " +
        pri.map((h) => kSaid(h.k) + ", " + mode.fmt(mode.pri(h)) + " " + overSaid(h, true))
          .join("; "));
    }
    svg.setAttribute("aria-label",
      (mode === LS ? "Long-minus-short price return" : "Hit rate") +
      " by holding horizon. " + said.join(". ") + ".");
    curveHost.append(svg);

    const plotState = (v, n) => (v === null || n === null ? "unstated"
      : n >= MIN_SESSIONS ? "plot" : "thin");
    let thin = 0, unstated = 0;
    for (const h of rows) {
      const a = plotState(mode.cur(h), mode.curN(h)), b = plotState(mode.pri(h), mode.priN(h));
      if (a === "plot" || b === "plot") continue;
      if (a === "thin" || b === "thin") thin++;
      else unstated++;
    }
    if (curveNote) {
      const note = [mode === LS
        ? "Equal-weighted price return of the published long names minus the " +
          "short names, measured from the close each board was published at."
        : "The share of published names whose price moved the way their board leaned, " +
          "pooled over names and measured from the close each board was published at. " +
          "Long minus short is not drawn: no horizon has " + MIN_SESSIONS + " scored " +
          "sessions with both legs measured, so the spread cannot be plotted, and the " +
          "hit rate is the record that exists."];
      if (pri.length) {
        note.push("The dashed line with hollow dots is the record under the PRIOR " +
          "selection rule" + (drawnMeta.epoch ? ", before " + drawnMeta.epoch : "") +
          ", drawn beside the current one rather than averaged into it, and carrying " +
          "its own n at every point." +
          (cur.length ? "" : " Every session retained so far predates the epoch, so the " +
            "solid line has nothing to draw — that is the shape of the archive, not a " +
            "record of zero."));

        if (drawnMeta.epochNote) {
          note.push(drawnMeta.epochNote.charAt(0).toUpperCase() + drawnMeta.epochNote.slice(1) + ".");
        }
      }
      if (thin > 0) {
        note.push(thin + " horizon" + (thin === 1 ? " has" : "s have") +
          " been measured in at least one population and has fewer than " +
          MIN_SESSIONS + " closed sessions there, which is under the floor this " +
          "page plots at.");
      }
      if (unstated > 0) {
        note.push(unstated + " horizon" + (unstated === 1 ? " carries" : "s carry") +
          " no population with both a mean and the number of sessions it was taken " +
          "over, so " + (unstated === 1 ? "it is" : "they are") + " not plotted — " +
          "that is a gap in what was published, not a count of closed sessions.");
      }
      dated(curveNote, note.join(" "));
    }
  }

  function renderSessions(sessions, meta) {
    body.textContent = "";
    const preNote = document.getElementById("recPreNote");
    if (preNote) preNote.remove();
    if (!sessions.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = COLUMNS;
      td.className = "flows-empty";
      td.dataset.empty = "pending";
      td.textContent = "No session has closed a horizon yet.";
      tr.append(td);
      body.append(tr);
      wrap.hidden = false;
      return;
    }

    let oneLegged = 0, oneLeggedPre = 0;
    const frag = document.createDocumentFragment();
    for (const s of sessions) {
      const tr = document.createElement("tr");

      const th = document.createElement("th");
      th.scope = "row";
      th.className = "fb-tk";
      th.textContent = String(s.d || DASH);
      if (s.pre === true) {
        tr.className = "is-pre";
        const mark = document.createElement("span");
        mark.className = "rec-pre";
        mark.textContent = "pre-epoch";
        mark.title = "Published before the selection epoch" +
          (meta && meta.epoch ? " of " + meta.epoch : "") + ", under the prior selection rule.";
        th.append(mark);
      }
      tr.append(th);

      const shortCell = cell(pct(s.short), "c-num c-leg");
      const lsCell = cell(pct(s.ls), "c-num" + signClass(s.ls));
      if (isNum(s.long) !== null && isNum(s.short) === null) {
        oneLegged++;
        if (s.pre === true) oneLeggedPre++;
        shortCell.title = lsCell.title = "No short leg was measured for this session, so " +
          "L−S cannot be formed. That is a leg the archive does not hold, not a " +
          "scoring failure.";
      }
      tr.append(cell(pct(s.long), "c-num c-leg"));
      tr.append(shortCell);
      tr.append(lsCell);

      const hit = isNum(s.hit);
      tr.append(cell(hit === null ? DASH : (hit * 100).toFixed(0) + "%", "c-num"));

      const lost = isNum(s.lost);
      const total = isNum(s.names);
      const lostCell = cell(
        lost === null ? DASH : total ? lost + " of " + total : String(lost),
        "c-num",
      );
      if (lost !== null && total && lost / total > 0.2) {
        lostCell.className = "c-num is-attrition";
        lostCell.title = "More than a fifth of this session's names could not be " +
          "scored. Names that leave the universe are not a random sample, so treat " +
          "this row's return as unreliable rather than merely noisy.";
      }
      tr.append(lostCell);

      frag.append(tr);
    }
    body.append(frag);
    wrap.hidden = false;

    if (oneLegged) {
      const p = document.createElement("p");
      p.id = "recPreNote";
      p.className = "rec-note";
      p.textContent = oneLegged + " of the " + sessions.length + " sessions listed " +
        (oneLegged === 1 ? "carries" : "carry") + " a long leg and no measured short leg" +
        (meta && meta.epoch && oneLeggedPre === oneLegged
          ? " — every one of them predates the " + meta.epoch + " selection epoch"
          : "") + ", so Short and L−S cannot be formed there. " +
        "Those dashes are a leg the archive does not hold, not a scoring failure.";
      wrap.insertAdjacentElement("afterend", p);
    }
  }

  const HYPOTHESES = {
    "s": "the composite itself \u2014 the product's own claim, measured against what followed",
    "cnv": "conviction: agreement across independent sources should mark flow that persists",
    "chg": "the session's own return: does a move continue or hand it back",
    "purity": "a one-sided tape should carry more information than the same volume churned",
    "gFlipDist": "distance to the gamma flip: dealer hedging pressure is strongest near it",
    "netPrem": "signed premium: money is a costlier vote than contract count",
    "w52": "position in the 52-week range: breakout names and basing names behave differently",
    "vrp": "variance risk premium: implied rich of delivered tends to revert",
    "ivr": "IV rank: the extremes of a name's own volatility year",
    "im": "the priced move: how much movement the vendor's quote already charges for",
    "hm": "the priced move rescaled to the fixed horizon every row shares",
    "hr": "delivered movement at that same fixed horizon",
    "fam.F": "flow family: aggressor-side pressure on the day's tape",
    "fam.P": "positioning family: what actually stuck in open interest",
    "fam.D": "path family: a direction held all day is a different fact from one print",
    "fam.V": "volatility gauge \u2014 unsigned, so any relation is about vol regime, not direction",
    "fam.O": "quality gauge \u2014 unsigned; tests whether cleaner flow predicts better",
    "pr.0": "trailing 5-session return: momentum at the fastest speed the board keeps",
    "pr.1": "trailing 21-session return: one-month momentum",
    "pr.2": "trailing 42-session return: two-month momentum",
    "dr": "rank change against the prior board: places climbed or fell, as the run itself compared them",
    "r0": "rank on the prior board: where the name stood the session before",
    "agr": "agreement: how many signed flow families point the composite's way",
    "bth": "breadth: how many signed flow families carried a reading at all",
    "edte": "days to the next earnings date on the vendor's calendar",
    "dp": "a flag on names that also carry a deep section; it is 1 wherever it is present",
  };

  const NOTE_LABELS = {
    method: "Method", perSession: "Per session", ranking: "Ranking",
    selection: "Selection", overlap: "Overlap", calendar: "Calendar",
  };

  const signed = (v, d) => {
    const n = isNum(v);
    return n === null ? DASH : (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(d);
  };

  function why(td, text, title) {
    const span = document.createElement("span");
    span.className = "rec-ic-why";
    span.textContent = String(text);
    if (title) td.title = String(title);
    td.append(span);
  }

  function renderFeatures(features) {
    const wrap = document.getElementById("recFeatWrap");
    const body = document.getElementById("recFeatBody");
    const notes = document.getElementById("recFeatNotes");
    if (!wrap || !body || !notes) return;

    if (!features || !Array.isArray(features.cols) || !features.cols.length) {
      const p = document.createElement("p");
      p.className = "rec-empty";
      p.dataset.empty = "pending";
      p.textContent = "The evidence table has not been measured yet. It is " +
        "computed from the retained sessions on each pipeline run, so it " +
        "appears with the first run after this page shipped.";
      notes.replaceChildren(p);
      wrap.hidden = true;
      return;
    }

    const rankedFrom = isNum(features.rankedFrom);
    body.textContent = "";
    const frag = document.createDocumentFragment();
    for (const col of features.cols) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.className = "fb-tk rec-feat-key";
      th.textContent = String(col.key);
      const hyp = HYPOTHESES[col.key];
      if (hyp) {
        const gloss = document.createElement("span");
        gloss.className = "rec-feat-gloss";
        gloss.textContent = hyp;
        th.append(gloss);
      }
      tr.append(th);

      const mean = isNum(col.icMean);
      const sessions = isNum(col.icSessions);
      const meanCell = cell(signed(mean, 3), "c-num c-icm");
      if (mean === null) {
        if (col.icReason) why(meanCell, col.icReason);
      } else if (col.ranked !== true) {
        const need = isNum(col.rankedFrom) ?? rankedFrom;
        why(meanCell, "unranked \u00b7 " + (sessions === null ? DASH : sessions) +
          (need === null ? "" : " of " + need) + " sessions", col.rankReason);
      }
      tr.append(meanCell);

      const sd = isNum(col.icSd);
      tr.append(cell(sd === null ? DASH : sd.toFixed(3), "c-num c-icsd"));

      const pos = isNum(col.icPos);
      tr.append(cell(pos === null || sessions === null ? DASH
        : Math.round(pos * sessions) + " of " + sessions, "c-num c-icpos"));

      tr.append(cell(signed(col.icT, 2), "c-num c-ict"));
      tr.append(cell(signed(col.icMkt, 2), "c-num c-icmkt"));

      const ic = isNum(col.ic);
      const icCell = cell(signed(ic, 3), "c-num c-icp");
      if (ic === null && col.reason) why(icCell, col.reason);
      tr.append(icCell);

      tr.append(cell(isNum(col.n) === null ? DASH : String(col.n), "c-num c-pairs"));
      frag.append(tr);
    }
    body.append(frag);
    wrap.hidden = false;

    notes.textContent = "";
    const meta = document.createElement("p");
    meta.className = "rec-note";
    const k = isNum(features.k);
    const minN = isNum(features.minN);
    const sessionMinN = isNum(features.sessionMinN);
    meta.textContent = "Horizon: " + (k === null ? DASH : k + " sessions") +
      " \u00b7 floor: " + (minN === null ? DASH : minN + " pairs") +
      (sessionMinN === null ? "" : " pooled, " + sessionMinN + " names a session") +
      (rankedFrom === null ? "" : " \u00b7 ranked from " + rankedFrom + " scored sessions") +
      (typeof features.through === "string" && ISO_DAY.test(features.through)
        ? " \u00b7 exits scored through " + features.through : "") + ".";
    notes.append(meta);
    for (const key of Object.keys(NOTE_LABELS)) {
      if (typeof features[key] !== "string" || !features[key].trim()) continue;
      const said = features[key].trim();
      const p = document.createElement("p");
      p.className = "rec-note";
      const label = document.createElement("span");
      label.className = "rec-note-l";
      label.textContent = NOTE_LABELS[key];
      p.append(label, " " + said.charAt(0).toUpperCase() + said.slice(1) +
        (/[.!?]$/.test(said) ? "" : "."));
      notes.append(p);
    }
  }

  let resizeT = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!drawnHorizons) return;
      const svg = curveHost.querySelector("svg");
      const drawnW = svg ? Number(String(svg.getAttribute("viewBox")).split(/\s+/)[2]) : 0;

      const w = curveWidth();
      if (svg && Math.abs(w - drawnW) < 8) return;

      renderCurve(drawnHorizons, drawnMeta);
    }, 160);
  });

  function renderStale(payload) {
    const written = isNum(payload && payload.__updatedAt);
    const now = Date.now();
    let message = null;

    if (written !== null && written > 0 && now - written > STALE_WRITE_MS) {
      const hours = Math.floor((now - written) / 3600000);
      const days = Math.floor(hours / 24);

      const age = days >= 1
        ? days + (days === 1 ? " day" : " days")
        : hours + (hours === 1 ? " hour" : " hours");
      message = "This record was last written " + age + " ago. The pipeline has " +
        "not published since — check the Actions tab. Every figure below is that " +
        "run's, and no session has been scored into it since.";
    } else if (payload && ISO_DAY.test(String(payload.sessionDate || ""))) {

      const session = Date.parse(String(payload.sessionDate) + "T21:00:00Z");
      if (Number.isFinite(session) && now - session > STALE_SESSION_MS) {
        message = "These numbers describe the " + payload.sessionDate + " session, " +
          "which is more than four days old. The pipeline is running but its data " +
          "is not advancing, so no new session has been scored into the record.";
      }
    }
    if (!message) return;

    const band = document.createElement("p");
    band.className = "flows-stale";
    band.setAttribute("role", "status");
    band.textContent = message;
    statusEl.insertAdjacentElement("afterend", band);
  }

  fetch("/api/flows/record", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then((response) => {
    if (response.status === 401) { location.replace("/flows/"); return null; }
    if (!response.ok) throw new Error("HTTP " + response.status);

    const updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
    return response.json().then((payload) => {
      if (payload && typeof payload === "object") payload.__updatedAt = updatedAt;
      return payload;
    });
  }).then((payload) => {
    if (!payload) return;

    const horizons = Array.isArray(payload.horizons) ? payload.horizons : [];
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const retained = isNum(payload.retained);

    renderStale(payload);
    const meta = {
      epoch: typeof payload.epoch === "string" ? payload.epoch : null,
      epochNote: typeof payload.epochNote === "string" ? payload.epochNote : null,
    };
    renderCurve(horizons, meta);
    renderSessions(sessions, meta);
    renderFeatures(payload.features);

    if (payload.status === "pending" || (!horizons.length && !sessions.length)) {

      statusEl.textContent =
        "The record is empty. Each session's board is retained from the first " +
        "pipeline run after this shipped, and the shortest horizon needs that " +
        "many sessions to close before anything here can be measured.";
      return;
    }

    if (retained === 0) {
      const probed = isNum(payload.archiveProbed);
      const k = isNum(payload.statedHorizon);
      const failed = isNum(payload.archiveFailed);

      if (failed !== null && failed > 0) {
        statusEl.textContent =
          "The record could not be measured this session, and that is a fault " +
          "in the archive rather than a verdict on the signal. " + failed +
          " of " + (probed === null ? "the" : probed) + " archive read" +
          (failed === 1 ? "" : "s") + " failed, so this run could not tell " +
          "whether earlier sessions exist. Nothing below is evidence that the " +
          "board has never been right — it is evidence that the store did not " +
          "answer.";
        return;
      }

      statusEl.textContent =
        "Nothing has been scored yet, and this is the ordinary first state of " +
        "the record rather than a failure. A board is scored only against " +
        "closes that come AFTER the session it was published for, so today's " +
        "board" + (payload.sessionDate ? " (" + payload.sessionDate + ")" : "") +
        " cannot score itself" +
        (probed !== null
          ? ", and no earlier dated board was readable — " + probed +
            " dated key" + (probed === 1 ? " was" : "s were") +
            " probed and every one answered that it holds nothing."
          : ".") +
        " The first measured session appears on the next pipeline run" +
        (k !== null
          ? ", and the " + k + "-session horizon " + k + " runs after that."
          : ".");
      return;
    }

    const parts = [];
    if (retained !== null) parts.push(retained + " session" + (retained === 1 ? "" : "s") + " retained");

    let closedAtStated = null;
    const stated = isNum(payload.statedHorizon);
    if (stated !== null) {
      const row = horizons.find((h) => isNum(h && h.k) === stated);
      if (row) {
        const n = isNum(row.n), pn = isNum(row.priorN);

        if (n !== null || pn !== null) {
          closedAtStated = (n === null ? 0 : n) + (pn === null ? 0 : pn);
        }
      }
    }
    if (sessions.length) {
      parts.push(sessions.length + " listed below" +
        (closedAtStated !== null && closedAtStated > sessions.length
          ? ", the most recent of at least " + closedAtStated + " sessions that have " +
            "closed the " + stated + "-session horizon with both legs measured"
          : ""));
    }

    const priorN = isNum(payload.priorRetained);
    const epochN = isNum(payload.epochRetained);
    if (payload.epoch && priorN && epochN !== null) {
      parts.push(
        epochN + " under the current selection rule, " + priorN + " before it (" +
        payload.epoch + "), reported separately");
    }
    if (payload.firstSession && payload.lastSession) {
      parts.push("from " + payload.firstSession + " to " + payload.lastSession);
    }
    statusEl.textContent = parts.length
      ? parts.join(" · ") + "."
      : "The record has begun but nothing has closed a horizon yet.";
  }).catch(() => {
    statusEl.textContent = "The record could not be loaded. Refresh to try again.";
  });
})();
