(() => {
  "use strict";

  const UI = window.FlowsUI;
  const statusEl = document.getElementById("recStatus");
  const app = document.getElementById("recApp");
  const about = document.getElementById("recAbout");
  if (!statusEl || !app) return;
  if (!UI) {
    statusEl.textContent = "This page's UI module did not load, so nothing can be drawn. Refresh to try again.";
    return;
  }

  const { h, s, F, chart: C } = UI;
  const DASH = UI.DASH, MINUS = UI.MINUS;
  const MIN_SESSIONS = 5;
  const STALE_WRITE_MS = 30 * 60 * 60 * 1000;
  const STALE_SESSION_MS = 4 * 24 * 60 * 60 * 1000;
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  const T975 = [0, 12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23];

  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const kSaid = (k) => k + (k === 1 ? " session" : " sessions");
  const pct = (v, d = 2) => {
    const n = isNum(v);
    return n === null ? DASH : (n < 0 ? MINUS : n > 0 ? "+" : "") + (Math.abs(n) * 100).toFixed(d) + "%";
  };
  const hitPct = (v, d = 0) => (isNum(v) === null ? DASH : (v * 100).toFixed(d) + "%");
  const signed = (v, d) => {
    const n = isNum(v);
    return n === null ? DASH : (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n).toFixed(d);
  };
  const tcrit = (df) => (df >= 30 ? 1.96 : df > 10 ? 2.1 : T975[Math.max(1, Math.floor(df))]);

  function wilson(p, n) {
    if (p === null || !(n > 0)) return null;
    const z = 1.96, z2 = z * z, d = 1 + z2 / n;
    const c = (p + z2 / (2 * n)) / d;
    const m = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d;
    return [Math.max(0, c - m), Math.min(1, c + m)];
  }
  function meanCi(mean, sd, n) {
    if (mean === null || sd === null || !(n >= 2)) return null;
    const t = tcrit(n - 1);
    const half = t * sd / Math.sqrt(n);
    return [mean - half, mean + half];
  }

  function horizonRows(horizons) {
    return (Array.isArray(horizons) ? horizons : []).map((r) => ({
      k: isNum(r && r.k), ls: isNum(r && r.ls), n: isNum(r && r.n), sd: isNum(r && r.sd),
      prior: isNum(r && r.prior), priorN: isNum(r && r.priorN), priorSd: isNum(r && r.priorSd),
      hit: isNum(r && r.hit), hitN: isNum(r && r.hitN), hitS: isNum(r && r.hitSessions),
      priorHit: isNum(r && r.priorHit), priorHitN: isNum(r && r.priorHitN), priorHitS: isNum(r && r.priorHitSessions),
    })).filter((r) => r.k !== null);
  }

  function spreadPoint(v, n, sd, k) {
    if (v === null || n === null || n < MIN_SESSIONS) return null;
    const eff = n / Math.max(1, k);
    return { v, n, naive: meanCi(v, sd, n), adj: eff >= 2 ? meanCi(v, sd, eff) : null, open: sd !== null && eff < 2 };
  }
  function hitPoint(v, sessions, names, k) {
    if (v === null || sessions === null || sessions < MIN_SESSIONS) return null;
    const eff = sessions / Math.max(1, k);
    return { v, n: sessions, names, naive: wilson(v, names), adj: eff >= 2 ? wilson(v, eff) : null, open: eff < 2 };
  }
  const clears = (p, ref) => !!(p && p.adj && (p.adj[0] > ref || p.adj[1] < ref));

  function ciChart(host, o) {
    return C.mount(host, (el, w, animate) => {
      const H = w < 600 ? 214 : 240;
      const top = 16, bot = o.prior ? 46 : 36, left = 6, right = w < 600 ? 50 : 58;
      const cols = o.rows;
      const band = (w - left - right) / Math.max(1, cols.length);
      const xAt = (i) => left + band * (i + 0.5);
      const vals = [o.ref].concat(o.clamp || []);
      for (const r of cols) {
        for (const p of [r.cur, r.pri]) {
          if (!p) continue;
          vals.push(p.v);
          for (const ci of [p.naive, p.adj]) if (ci) vals.push(ci[0], ci[1]);
        }
      }
      let y0 = Math.min(...vals), y1 = Math.max(...vals);
      if (o.clamp) { y0 = Math.max(o.clamp[0], y0); y1 = Math.min(o.clamp[1], y1); }
      const pad = (y1 - y0) * 0.1 || Math.abs(y1) * 0.1 || 0.01;
      y0 -= pad; y1 += pad;
      const y = C.lin(y0, y1, H - bot, top);
      const svg = C.svgRoot(el, w, H, animate, o.label);
      svg.classList.add("rc");
      svg.setAttribute("data-plot-top", top);
      svg.setAttribute("data-plot-height", H - bot - top);
      s("line", { x1: left, x2: w - right, y1: y(o.ref), y2: y(o.ref), class: "base rc-zero" }, svg);
      const refY = y(o.ref);
      s("text", { x: w - right + 8, y: refY + 3.8, text: o.refLabel, class: "rc-axislabel is-zero tx-3" }, svg);
      const ticks = C.niceTicks(y0, y1, 3).filter((v) => y(v) > top + 4 && y(v) < H - bot - 4);
      for (const v of [ticks[ticks.length - 1], ticks[0]]) {
        if (v === undefined) continue;
        const yy = y(v);
        if (Math.abs(yy - refY) < 18) continue;
        s("text", { x: w - right + 8, y: yy + 3.8, text: o.axis(v), class: "rc-axislabel tx-3" }, svg);
      }
      const g = s("g", null, svg);
      const tone = (p) => (clears(p, o.ref) ? " is-clear" : "");
      const edge0 = o.clamp ? y(o.clamp[0]) : H - bot, edge1 = o.clamp ? y(o.clamp[1]) : top;
      cols.forEach((r, i) => {
        const x = xAt(i);
        const place = (p, dx, prior) => {
          if (!p) return;
          const cx = x + dx;
          if (p.adj) s("line", { x1: cx, x2: cx, y1: y(p.adj[0]), y2: y(p.adj[1]), class: "rc-wh fade", style: { "--delay": 120 + i * 60 + "ms" } }, g);
          else if (p.open) s("line", { x1: cx, x2: cx, y1: edge1, y2: edge0, class: "rc-wh is-open fade", style: { "--delay": 120 + i * 60 + "ms" } }, g);
          if (p.naive && !prior) {
            const a = y(p.naive[1]), b = y(p.naive[0]);
            const hh = Math.max(3, b - a);
            s("rect", { x: cx - 8, y: (a + b) / 2 - hh / 2, width: 16, height: hh, rx: Math.min(8, hh / 2), class: "rc-ci grow", style: { "--i": String(i * 6), "--origin": "center" } }, g);
          }
          const dot = s("circle", {
            cx, cy: y(p.v), r: prior ? 4 : 3.5,
            class: "rc-dot fade" + (prior ? " is-prior" : (p.v < o.ref ? " is-neg" : p.v > o.ref ? " is-pos" : " is-flat") + tone(p)),
            style: { "--delay": 200 + i * 60 + "ms" },
          }, g);
          s("title", { text: o.title(r.k, p, prior) }, dot);
        };
        place(r.pri, r.cur ? 13 : 0, true);
        place(r.cur, 0, false);
        s("text", { x, y: H - bot + 16, text: r.k + "d", "text-anchor": "middle", class: "rc-ticklabel tx-1" }, svg);
        if (r.cur) s("text", { x, y: H - bot + 29, text: "n=" + r.cur.n, "text-anchor": "middle", class: "rc-nlabel tx-3" }, svg);
        if (r.pri) s("text", { x, y: H - bot + (r.cur ? 41 : 29), text: "prior n=" + r.pri.n, "text-anchor": "middle", class: "rc-nlabel is-prior tx-3" }, svg);
      });
      C.scrub(el, svg, {
        xs: cols.map((_, i) => xAt(i)), top, bottom: H - bot, label: o.label,
        onMove: (i) => {
          const r = cols[i];
          const parts = [C.part(r.k + "d", "k")];
          const dots = [];
          for (const [p, prior] of [[r.cur, false], [r.pri, true]]) {
            if (!p) continue;
            if (prior) parts.push(C.part("prior", "k"));
            parts.push(h("b", { "data-tone": clears(p, o.ref) ? (p.v < o.ref ? "down" : "up") : null }, o.fmt(p.v)));
            if (p.adj) parts.push(C.part("adj. " + o.fmt(p.adj[0]) + " to " + o.fmt(p.adj[1]), "k"));
            else if (p.open) parts.push(C.part("adj. unbounded", "k"));
            parts.push(C.part("n " + p.n, "k"));
            dots.push({ x: xAt(i) + (prior && r.cur ? 13 : 0), y: y(p.v), color: "--label-1" });
          }
          return { parts, dots, noLine: true };
        },
      });
    });
  }

  const ciLegend = (priorShown) => UI.legend([
    ["--label-1", "dot", "Mean"],
    UI.key("--label-3", "ln", "Adjusted 95%"),
    ["--s-blue", "", "Naive 95%"],
    priorShown ? ["--label-2", "ring", "Prior rule"] : null,
  ].filter(Boolean));

  function silentFor(rows, pick, what) {
    let best = null;
    for (const r of rows) for (const n of pick(r)) if (n !== null && (best === null || n > best)) best = n;
    const quiet = best !== null && best > 0;
    const node = UI.silent({
      state: quiet ? "quiet" : "pending",
      reason: quiet
        ? "No horizon has reached " + MIN_SESSIONS + " scored sessions yet — the longest has " + best +
          ". Nothing is plotted, because a mean of " + best + " observations is mostly its own sampling error."
        : "No horizon carries a scored session yet. The record begins with the first pipeline run after " +
          "this page shipped, and the shortest horizon needs that many sessions to close — with both " +
          "sides of the spread measured — before " + what + " can be plotted.",
    }, what, 200);
    node.classList.add("rec-empty");
    node.dataset.empty = quiet ? "quiet" : "pending";
    node.dataset.best = best === null ? "" : String(best);
    return node;
  }

  function curveNotes(rows, meta, kind) {
    const notes = [];
    let thin = 0, unstated = 0;
    const state = (v, n) => (v === null || n === null ? "unstated" : n >= MIN_SESSIONS ? "plot" : "thin");
    for (const r of rows) {
      const a = kind === "ls" ? state(r.ls, r.n) : state(r.hit, r.hitS);
      const b = kind === "ls" ? state(r.prior, r.priorN) : state(r.priorHit, r.priorHitS);
      if (a === "plot" || b === "plot") continue;
      if (a === "thin" || b === "thin") thin++; else unstated++;
    }
    if (thin) notes.push(thin + " horizon" + (thin === 1 ? " has" : "s have") + " been measured in at least one population and has fewer than " + MIN_SESSIONS + " closed sessions there, which is under the floor this page plots at.");
    if (unstated) notes.push(unstated + " horizon" + (unstated === 1 ? " carries" : "s carry") + " no population with both a mean and the number of sessions it was taken over, so " + (unstated === 1 ? "it is" : "they are") + " not plotted — that is a gap in what was published, not a count of closed sessions.");
    if (meta.epoch) notes.push("The hollow ring is the record under the PRIOR selection rule, before " + meta.epoch + ", drawn beside the current one rather than averaged into it, and carrying its own n." + (meta.epochNote ? " " + UI.cap(meta.epochNote) : ""));
    return notes;
  }

  const CI_LINES = [
    "The thick capsule is the naive 95% interval: every scored name (or every session) treated as an independent reading.",
    "The thin whisker is the adjusted 95% interval: sessions whose forward windows overlap are not independent, so the sample is divided by the horizon, and names that move together are counted as one call per session. The truth sits between the two; where the whisker runs dashed to the edges there are fewer than two independent windows and the interval is unbounded.",
    "A mean is drawn in colour only when its adjusted interval clears the reference line. Grey is a reading the sample cannot yet tell apart from chance.",
  ];

  function paintSpread(mod, rows, meta) {
    const host = mod.querySelector("#recCurve");
    const pts = rows.map((r) => ({ k: r.k, cur: spreadPoint(r.ls, r.n, r.sd, r.k), pri: spreadPoint(r.prior, r.priorN, r.priorSd, r.k) }))
      .filter((r) => r.cur || r.pri);
    if (!pts.length) {
      host.replaceChildren(silentFor(rows, (r) => [r.n, r.priorN], "Spread"));
      return;
    }
    const said = [];
    const over = (p) => "over " + p.n + " scored session" + (p.n === 1 ? "" : "s");
    const cur = pts.filter((r) => r.cur), pri = pts.filter((r) => r.pri);
    if (cur.length) said.push("Current selection rule: " + cur.map((r) => kSaid(r.k) + ", " + pct(r.cur.v) + " long minus short, " + over(r.cur)).join("; "));
    if (pri.length) said.push("Prior selection rule" + (meta.epoch ? " (before " + meta.epoch + ")" : "") + ": " + pri.map((r) => kSaid(r.k) + ", " + pct(r.pri.v) + " long minus short, " + over(r.pri)).join("; "));
    ciChart(host, {
      rows: pts, ref: 0, refLabel: "0", prior: pri.length > 0,
      axis: (v) => pct(v, 1), fmt: (v) => pct(v, 2),
      label: "Long-minus-short price return by holding horizon. " + said.join(". ") + ".",
      title: (k, p, prior) => kSaid(k) + (prior ? " under the PRIOR selection rule" : "") + ": " + pct(p.v) + " long minus short, " + over(p),
    });
    mod.querySelector(".rc-legend").replaceChildren(ciLegend(pri.length > 0));
  }

  function paintHit(mod, rows, meta) {
    const host = mod.querySelector("#recHit");
    const pts = rows.map((r) => ({ k: r.k, cur: hitPoint(r.hit, r.hitS, r.hitN, r.k), pri: hitPoint(r.priorHit, r.priorHitS, r.priorHitN, r.k) }))
      .filter((r) => r.cur || r.pri);
    if (!pts.length) {
      host.replaceChildren(silentFor(rows, (r) => [r.hitS, r.priorHitS], "Hit rate"));
      return;
    }
    const over = (p) => "over " + p.n + " scored session" + (p.n === 1 ? "" : "s") + (p.names === null ? "" : " and " + p.names + " names");
    ciChart(host, {
      rows: pts, ref: 0.5, refLabel: "50%", prior: pts.some((r) => r.pri), clamp: [0, 1],
      axis: (v) => hitPct(v), fmt: (v) => hitPct(v, 1),
      label: "Hit rate by holding horizon: the share of published names whose price moved the way their board leaned. " +
        pts.filter((r) => r.cur).map((r) => kSaid(r.k) + ", " + hitPct(r.cur.v, 1) + " " + over(r.cur)).join("; ") + ".",
      title: (k, p, prior) => kSaid(k) + (prior ? " under the PRIOR selection rule" : "") + ": " + hitPct(p.v, 1) + " hit rate, " + over(p),
    });
    mod.querySelector(".rc-legend").replaceChildren(ciLegend(pts.some((r) => r.pri)));
  }

  function curveModule(id, title, hostId, rows, meta, kind) {
    const mod = UI.moduleCard({
      id, title, span: 6, index: kind === "hit" ? 1 : 2,
      info: () => ({
        title,
        lead: kind === "hit"
          ? "The share of published names whose price moved the way their board leaned, pooled over names and measured from the close each board was published at, by holding horizon."
          : "Equal-weighted price return of the published long names minus the short names, measured from the close each board was published at, by holding horizon.",
        facts: rows.map((r) => [kSaid(r.k), kind === "hit"
          ? hitPct(r.hit, 1) + " · " + (r.hitS === null ? DASH : r.hitS) + " sessions · " + (r.hitN === null ? DASH : r.hitN) + " names"
          : pct(r.ls) + " · n " + (r.n === null ? DASH : r.n) + (r.sd === null ? "" : " · sd " + pct(r.sd))]),
        sections: [{ title: "Intervals", lines: CI_LINES }, { title: "Floor", lines: ["A horizon is plotted once " + MIN_SESSIONS + " scored sessions have closed it."].concat(curveNotes(rows, meta, kind)) }],
      }),
      body: [h("div", { id: hostId, class: "rc-host" }), h("div", { class: "rc-legend" })],
    });
    return mod;
  }

  const LABELS = {
    s: "Composite", cnv: "Conviction", chg: "Session return", purity: "Purity", gFlipDist: "Flip distance",
    netPrem: "Net premium", w52: "52-week position", vrp: "VRP", ivr: "IV rank", im: "Priced move",
    hm: "Horizon move", hr: "Horizon realized", "fam.F": "Flow family", "fam.P": "Positioning", "fam.D": "Path",
    "fam.V": "Vol gauge", "fam.O": "Quality gauge", "pr.0": "Momentum 5d", "pr.1": "Momentum 21d",
    "pr.2": "Momentum 42d", dr: "Rank change", r0: "Prior rank", agr: "Agreement", bth: "Breadth",
    edte: "Days to earnings", dp: "Deep flag",
  };
  const HYPOTHESES = {
    "s": "the composite itself — the product's own claim, measured against what followed",
    "cnv": "conviction: agreement across independent sources should mark flow that persists",
    "chg": "the session's own return: does a move continue or hand it back",
    "purity": "a one-sided tape should carry more information than the same volume churned",
    "gFlipDist": "distance to the strike-sum crossing of the day's flow ladder, the reading this archived key has always held",
    "netPrem": "signed premium: money is a costlier vote than contract count",
    "w52": "position in the 52-week range: breakout names and basing names behave differently",
    "vrp": "implied minus trailing realised volatility: the backward-looking premium the archived key has always held",
    "ivr": "IV rank: the extremes of a name's own volatility year",
    "im": "the priced move: how much movement the vendor's quote already charges for",
    "hm": "the priced move rescaled to the fixed horizon every row shares",
    "hr": "delivered movement at that same fixed horizon",
    "fam.F": "flow family: aggressor-side pressure on the day's tape",
    "fam.P": "positioning family: what actually stuck in open interest",
    "fam.D": "path family: a direction held all day is a different fact from one print",
    "fam.V": "volatility gauge — unsigned, so any relation is about vol regime, not direction",
    "fam.O": "quality gauge — unsigned; tests whether cleaner flow predicts better",
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

  function featureNotes(features) {
    const k = isNum(features.k), minN = isNum(features.minN), sessionMinN = isNum(features.sessionMinN);
    const rankedFrom = isNum(features.rankedFrom);
    const lines = ["Horizon: " + (k === null ? DASH : k + " sessions") + " · floor: " + (minN === null ? DASH : minN + " pairs") +
      (sessionMinN === null ? "" : " pooled, " + sessionMinN + " names a session") +
      (rankedFrom === null ? "" : " · ranked from " + rankedFrom + " scored sessions") +
      (typeof features.through === "string" && ISO_DAY.test(features.through) ? " · exits scored through " + features.through : "") + "."];
    const sections = [];
    for (const key of Object.keys(NOTE_LABELS)) {
      if (typeof features[key] !== "string" || !features[key].trim()) continue;
      sections.push({ title: NOTE_LABELS[key], lines: [features[key].trim()] });
    }
    return { lines, sections };
  }

  function paintFeatures(features) {
    const body = h("div", { id: "recFeatBody", class: "rf-rows" });
    const notes = h("div", { id: "recFeatNotes" });
    const has = features && Array.isArray(features.cols) && features.cols.length;
    const k = has ? isNum(features.k) || 1 : 1;
    const rankedFrom = has ? isNum(features.rankedFrom) : null;
    const mod = UI.moduleCard({
      id: "recFeatWrap", title: "Signals", index: 4,
      info: () => {
        if (!has) return { title: "Signals", state: "pending", lead: "The evidence table has not been measured yet. It is computed from the retained sessions on each pipeline run, so it appears with the first run after this page shipped." };
        const n = featureNotes(features);
        return {
          title: "What predicted",
          lead: "The rank correlation (IC) of each archived board column with the forward return, measured inside each session on the return scaled by the name's own volatility, then averaged across sessions. A single correlation pooled across sessions scores a volatility column on which way the market went; it is kept as the secondary figure on every row. An IC near zero is a finding too.",
          sections: [{ title: "Sample", lines: n.lines }, { title: "Intervals", lines: CI_LINES.slice(0, 2) }].concat(n.sections),
        };
      },
      body: [body, notes],
    });
    if (!has) {
      mod.hidden = false;
      mod.dataset.empty = "pending";
      const sil = UI.silent({ state: "pending", reason: "The evidence table has not been measured yet. It is computed from the retained sessions on each pipeline run, so it appears with the first run after this page shipped." }, "Signals", 160);
      sil.classList.add("rec-empty");
      notes.append(sil);
      return mod;
    }
    const cols = features.cols.slice().sort((a, b) => {
      const x = isNum(a.icMean), y = isNum(b.icMean);
      if (x === null) return y === null ? 0 : 1;
      if (y === null) return -1;
      return Math.abs(y) - Math.abs(x);
    });
    const bands = cols.map((col) => {
      const mean = isNum(col.icMean), sd = isNum(col.icSd), sessions = isNum(col.icSessions);
      const eff = sessions === null ? 0 : sessions / k;
      return {
        naive: mean !== null && sd !== null && sessions >= 2 ? meanCi(mean, sd, sessions) : null,
        adj: mean !== null && sd !== null && eff >= 2 ? meanCi(mean, sd, eff) : null,
      };
    });
    let reach = 0.6;
    cols.forEach((col, i) => {
      for (const v of [isNum(col.icMean)].concat(bands[i].naive || [], bands[i].adj || [])) if (v !== null) reach = Math.max(reach, Math.abs(v));
    });
    const D = Math.min(1, Math.ceil(reach * 10 - 1e-9) / 10);
    const at = (v) => ((Math.max(-D, Math.min(D, v)) + D) / (2 * D) * 100).toFixed(2) + "%";
    const rows = cols.map((col, i) => {
      const key = String(col.key);
      const mean = isNum(col.icMean), sd = isNum(col.icSd), sessions = isNum(col.icSessions);
      const pos = isNum(col.icPos), ic = isNum(col.ic), t = isNum(col.icT), mkt = isNum(col.icMkt);
      const ranked = col.ranked === true;
      const need = isNum(col.rankedFrom) ?? rankedFrom;
      const { naive, adj } = bands[i];
      const clear = !!(adj && (adj[0] > 0 || adj[1] < 0));
      const unrankedSaid = mean !== null && !ranked ? "unranked · " + (sessions === null ? DASH : sessions) + (need === null ? "" : " of " + need) + " sessions" : null;
      const track = h("span", { class: "rf-track", "aria-hidden": "true" }, h("i", { class: "rf-zero" }));
      if (mean !== null) {
        if (adj) track.append(h("i", { class: "rf-wh", style: { left: at(adj[0]), right: "calc(100% - " + at(adj[1]) + ")" } }));
        else if (sd !== null) track.append(h("i", { class: "rf-wh is-open" }));
        if (naive) track.append(h("i", { class: "rf-ci", style: { left: at(naive[0]), right: "calc(100% - " + at(naive[1]) + ")" } }));
        track.append(h("i", { class: "rf-dot" + (ranked ? " is-ranked" : ""), "data-tone": clear ? (mean < 0 ? "down" : "up") : null, style: { left: at(mean), "--i": String(i) } }));
      }
      const build = () => ({
        title: LABELS[key] || key,
        state: mean === null ? "quiet" : ranked ? null : "pending",
        lead: HYPOTHESES[key] ? UI.cap(HYPOTHESES[key]) : null,
        facts: [
          ["Column", key],
          ["Mean IC", signed(mean, 3)],
          ["SD", sd === null ? DASH : sd.toFixed(3)],
          ["Positive", pos === null || sessions === null ? DASH : Math.round(pos * sessions) + " of " + sessions],
          ["t", signed(t, 2)],
          ["Market tie", signed(mkt, 2)],
          ["Pooled IC", signed(ic, 3)],
          ["Pairs", isNum(col.n) === null ? DASH : String(col.n)],
          ["Naive 95%", naive ? signed(naive[0], 2) + " to " + signed(naive[1], 2) : DASH],
          ["Adjusted 95%", adj ? signed(adj[0], 2) + " to " + signed(adj[1], 2) : sd !== null ? "unbounded" : DASH],
        ],
        notes: [unrankedSaid ? unrankedSaid + (col.rankReason ? ": " + col.rankReason : "") : null, mean === null && col.icReason ? col.icReason : null, ic === null && col.reason ? "Pooled: " + col.reason : null].filter(Boolean),
      });
      return h("div", { class: "rf-li", role: "listitem" }, h("button", {
        type: "button", class: "rf-row", "data-key": key, "data-info": UI.info(build),
        "aria-haspopup": "dialog", "aria-controls": "fxPop",
        "aria-label": (LABELS[key] || key) + ", mean IC " + signed(mean, 3) + (unrankedSaid ? ", " + unrankedSaid : ""),
      },
      h("span", { class: "ui-row-m" }, h("b", null, LABELS[key] || key)),
      track,
      h("span", { class: "ui-row-v c-icm", "data-tone": mean === null ? "silent" : null }, signed(mean, 3)),
      mean === null ? h("span", { class: "rf-state" }, UI.glyph("quiet")) : !ranked ? h("span", { class: "rf-state is-pending", title: unrankedSaid }, UI.glyph("pending")) : h("span", { class: "rf-state" })));
    });
    const list = UI.list(rows, { visible: 8, label: "Signal columns by mean IC" });
    body.append(h("div", { class: "rf-axis", "aria-hidden": "true" }, h("span", null, MINUS + D.toFixed(1)), h("span", null, "0"), h("span", null, "+" + D.toFixed(1))), list);
    const ranked = features.cols.filter((c) => c.ranked === true).length;
    notes.append(UI.legend([["--label-1", "dot", "Ranked"], UI.key("--label-2", "ring", "Unranked"), ["--s-blue", "", "Naive 95%"], UI.key("--label-3", "ln", "Adjusted 95%"),
      h("span", { class: "ui-key rf-count" }, h("b", null, ranked + " of " + features.cols.length), " ranked")]));
    return mod;
  }

  function sessionRows(sessions) {
    return sessions.map((r) => ({
      d: typeof r.d === "string" ? r.d : null, long: isNum(r.long), short: isNum(r.short), ls: isNum(r.ls),
      hit: isNum(r.hit), lost: isNum(r.lost), names: isNum(r.names), measured: isNum(r.measured), pre: r.pre === true,
    }));
  }
  const attrition = (r) => r.lost !== null && r.names ? r.lost / r.names > 0.2 : false;
  const ATTRITION_SAID = "More than a fifth of this session's names could not be scored. Names that leave the universe are not a random sample, so treat this row's return as unreliable rather than merely noisy.";
  const ONE_LEG_SAID = "No short leg was measured for this session, so L−S cannot be formed. That is a leg the archive does not hold, not a scoring failure.";

  function timeline(host, rows, pick, selected) {
    return C.mount(host, (el, w, animate) => {
      const H = w < 600 ? 150 : 176;
      const top = 12, bot = 40, left = 4, right = w < 600 ? 44 : 52;
      const N = rows.length;
      const band = (w - left - right) / N;
      const xAt = (i) => left + band * (i + 0.5);
      const max = Math.max(1e-6, ...rows.map((r) => (r.ls === null ? 0 : Math.abs(r.ls))));
      const mid = top + (H - top - bot) / 2;
      const half = (H - top - bot) / 2 - 2;
      const svg = C.svgRoot(el, w, H, animate, "Long minus short at the stated horizon, one bar per published session, oldest first");
      const bw = Math.max(4, Math.min(22, band * 0.56));
      const sel = selected();
      rows.forEach((r, i) => {
        const x = xAt(i);
        if (r.pre) s("rect", { x: x - band / 2, y: top - 6, width: band, height: H - top - bot + 12, class: "rt-wash" }, svg);
        if (sel === i) s("rect", { x: x - band / 2 + 1, y: top - 6, width: band - 2, height: H - top - bot + 12, rx: 8, class: "rt-sel" }, svg);
      });
      const edge = rows.findIndex((r, i) => i > 0 && !r.pre && rows[i - 1].pre);
      if (edge > 0) {
        const bx = xAt(edge) - band / 2;
        s("line", { x1: bx, x2: bx, y1: top - 6, y2: H - bot + 6, class: "rt-erule" }, svg);
      }
      s("line", { x1: left, x2: w - right, y1: mid, y2: mid, class: "base" }, svg);
      s("text", { x: w - right + 8, y: mid - half + 4, text: pct(max, 1), class: "tx-3" }, svg);
      s("text", { x: w - right + 8, y: mid + 3.8, text: "0", class: "tx-3" }, svg);
      s("text", { x: w - right + 8, y: mid + half + 4, text: pct(-max, 1), class: "tx-3" }, svg);
      rows.forEach((r, i) => {
        const x = xAt(i);
        if (r.ls === null) { s("circle", { cx: x, cy: mid, r: 1.8, class: "rt-gap" }, svg); }
        else {
          const hh = Math.max(1.5, Math.abs(r.ls) / max * half);
          const pos = r.ls >= 0;
          s("rect", { x: x - bw / 2, y: pos ? mid - hh : mid, width: bw, height: hh, rx: Math.min(3, bw / 2), class: "grow rt-bar " + (pos ? "is-pos" : "is-neg") + (sel !== null && sel !== i ? " is-dim" : ""), style: { "--i": String(i * 2), "--origin": pos ? "bottom" : "top" } }, svg);
        }
        const hy = H - bot + 12;
        if (r.hit !== null) s("circle", { cx: x, cy: hy, r: 2 + 3 * Math.abs(r.hit - 0.5) * 2, class: "rt-hit " + (r.hit > 0.5 ? "is-pos" : r.hit < 0.5 ? "is-neg" : "is-flat") + " fade", style: { "--delay": 300 + i * 20 + "ms" } }, svg);
        else s("circle", { cx: x, cy: hy, r: 1.5, class: "rt-gap" }, svg);
        if (attrition(r)) C.marker(svg, "tri", x, H - bot + 25, UI.cssVar("--warn"), 3.2);
      });
      const every = Math.max(1, Math.ceil(N / (w < 600 ? 4 : 8)));
      rows.forEach((r, i) => {
        if ((N - 1 - i) % every !== 0) return;
        s("text", { x: xAt(i), y: H - 2, text: F.day(r.d), "text-anchor": "middle", class: i === N - 1 ? "tx-1" : null }, svg);
      });
      let cur = -1;
      C.scrub(el, svg, {
        xs: rows.map((_, i) => xAt(i)), top, bottom: H - bot, label: "Sessions",
        onMove: (i) => {
          cur = i;
          const r = rows[i];
          return {
            parts: [C.part(F.day(r.d), "k"), h("b", { "data-tone": r.ls === null ? null : r.ls < 0 ? "down" : "up" }, pct(r.ls)), C.part("hit " + hitPct(r.hit), "k"), r.pre ? C.part("prior rule", "k") : null, attrition(r) ? C.part("lost " + r.lost + "/" + r.names, "k") : null],
            dots: [],
          };
        },
      });
      el.onclick = () => { if (cur >= 0) pick(cur, false); };
      el.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && cur >= 0) { e.preventDefault(); pick(cur, false); } };
    });
  }

  let track = null;
  let trackAsked = null;
  function scoretrack() {
    if (!trackAsked) {
      trackAsked = fetch("/api/flows/scoretrack", { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((t) => { track = t && Array.isArray(t.sessions) && Array.isArray(t.names) ? t : null; return track; });
    }
    return trackAsked;
  }

  function boardOf(d) {
    if (!track) return null;
    const i = track.sessions.findIndex((x) => x && x.d === d);
    if (i < 0) return null;
    const scored = [];
    for (const n of track.names) {
      const v = n && Array.isArray(n.s) ? isNum(n.s[i]) : null;
      if (v !== null && typeof n.t === "string") scored.push({ t: n.t, v });
    }
    const band = isNum(track.deadBand) || 0;
    return {
      long: scored.filter((x) => x.v > band).sort((a, b) => b.v - a.v).slice(0, 5),
      short: scored.filter((x) => x.v < -band).sort((a, b) => a.v - b.v).slice(0, 5),
      source: track.sessions[i].source,
    };
  }

  function sessionDetail(r, meta) {
    const box = h("div", { class: "rs", id: "recSession", "data-d": r.d });
    const oneLeg = r.long !== null && r.short === null;
    const lost = attrition(r);
    box.append(h("div", { class: "rs-h" },
      h("span", { class: "rs-d" }, F.day(r.d)),
      r.pre ? UI.tag("Prior rule") : null,
      lost ? h("button", { type: "button", class: "ui-tag rs-warn", "data-tone": "warn", "data-info": UI.info({ title: "Attrition", lead: ATTRITION_SAID, facts: [["Lost", r.lost + " of " + r.names]] }), "aria-haspopup": "dialog", "aria-controls": "fxPop" }, UI.glyph("clock"), "Attrition") : null));
    box.append(UI.metrics([
      UI.metric("Long leg", pct(r.long), { id: "long" }),
      UI.metric("Short leg", pct(r.short), { id: "short", state: oneLeg ? { state: "unavailable", reason: ONE_LEG_SAID } : null }),
      UI.metric("L" + MINUS + "S", pct(r.ls), { id: "ls", tone: r.ls === null ? null : UI.tone(r.ls), state: oneLeg ? { state: "unavailable", reason: ONE_LEG_SAID } : null }),
      UI.metric("Hit", hitPct(r.hit), { id: "hit", state: r.hit === null ? { state: "quiet", reason: "No name in this session was measured at the stated horizon, so no hit rate exists for it." } : null }),
      UI.metric("Lost", r.lost === null ? DASH : r.names ? r.lost + " of " + r.names : String(r.lost), { id: "lost", tone: lost ? "warn" : null }),
    ], { min: 92 }));
    const boardHost = h("div", { class: "rs-board" });
    box.append(boardHost);
    scoretrack().then(() => {
      if (!box.isConnected) return;
      const b = boardOf(r.d);
      if (!b) {
        boardHost.replaceChildren(h("p", { class: "rs-none" }, UI.dash({ state: "unavailable", reason: "The score track does not hold this session, so its board cannot be redrawn here." }, "Board")));
        return;
      }
      const side = (label, list, tone) => h("div", { class: "rs-side" },
        h("span", { class: "rs-side-l" }, label),
        h("div", { class: "ui-tags" }, list.length ? list.map((x) => h("a", { class: "ui-tag rs-name", href: "/flows/ticker/?t=" + encodeURIComponent(x.t), "data-tone": tone }, h("b", null, x.t), " " + F.signed(x.v))) : UI.dash({ state: "quiet", reason: "No name cleared the band on this side that session." }, label)));
      boardHost.replaceChildren(side("Bullish", b.long, "up"), side("Bearish", b.short, "down"));
    });
    return box;
  }

  function sessionsModule(rows, meta, stated) {
    const chrono = rows.slice().reverse();
    const host = h("div", { id: "recTimeline", class: "rt-host" });
    const detail = h("div", { class: "rs-wrap" });
    const list = h("div", { id: "recBody" });
    let sel = chrono.length - 1;
    let chartRef = null;
    const pick = (i, fromList) => {
      sel = i;
      detail.replaceChildren(sessionDetail(chrono[i], meta));
      for (const b of list.querySelectorAll(".rc-sess")) b.setAttribute("aria-pressed", String(b.dataset.d === chrono[i].d));
      if (chartRef) chartRef.redraw(false);
      if (fromList && detail.scrollIntoView) detail.scrollIntoView({ block: "nearest", behavior: UI.reduced() ? "auto" : "smooth" });
    };
    const rowEls = rows.map((r) => {
      const lost = attrition(r);
      const oneLeg = r.long !== null && r.short === null;
      const b = h("button", {
        type: "button", class: "rc-sess" + (r.pre ? " is-pre" : ""), "data-d": r.d || "", "aria-pressed": "false",
        onclick: () => pick(chrono.indexOf(r), true),
      },
      h("span", { class: "ui-row-m" }, h("b", { class: "c-d" }, r.d ? F.day(r.d) : DASH), r.pre ? h("span", { class: "rec-pre", title: "Published before the selection epoch" + (meta.epoch ? " of " + meta.epoch : "") + ", under the prior selection rule." }, "prior") : null),
      h("span", { class: "ui-row-v c-leg c-long" }, pct(r.long)),
      h("span", { class: "ui-row-v c-leg c-short", title: oneLeg ? ONE_LEG_SAID : null }, pct(r.short)),
      h("span", { class: "ui-row-v c-ls", "data-tone": r.ls === null ? "silent" : UI.tone(r.ls), title: oneLeg ? ONE_LEG_SAID : null }, pct(r.ls)),
      h("span", { class: "ui-row-v c-hit" }, hitPct(r.hit)),
      h("span", { class: "ui-row-v c-lost" + (lost ? " is-attrition" : ""), "data-tone": lost ? "warn" : null, title: lost ? ATTRITION_SAID : null }, r.lost === null ? DASH : r.names ? r.lost + " of " + r.names : String(r.lost)));
      return h("div", { class: "rc-li", role: "listitem" }, b);
    });
    list.append(h("div", { class: "rc-sess-h", "aria-hidden": "true" }, h("span", null, "Session"), h("span", null, "Long"), h("span", null, "Short"), h("span", null, "L" + MINUS + "S"), h("span", null, "Hit"), h("span", null, "Lost")),
      UI.list(rowEls, { visible: 5, label: "Scored sessions" }));
    const oneLegged = rows.filter((r) => r.long !== null && r.short === null);
    const anyPre = rows.some((r) => r.pre) && rows.some((r) => !r.pre);
    const mod = UI.moduleCard({
      id: "recSessions", title: ["Sessions", stated ? h("span", { class: "ui-tag rec-hz", title: "Measured " + kSaid(stated) + " after each board" }, stated + "d") : null], infoLabel: "sessions", index: 3,
      info: () => ({
        title: "Sessions",
        lead: "One column per published session, once enough sessions have passed to measure it" + (stated ? " at the stated " + kSaid(stated) + " horizon" : "") + ". The bar is the equal-weighted price return of that session's long names minus its short names, from the close the board was published at; the dot under it is the session's hit rate (larger is further from a coin flip), and a triangle marks a session that lost more than a fifth of its names. Not a strategy: no costs, no slippage, no borrow, and no position sizing.",
        sections: [
          { title: "Legs", lines: ["The long and short legs are measurements, not verdicts; only the spread is a result, and only it carries a sign colour."] },
          oneLegged.length ? { title: "One leg", lines: [oneLegged.length + " of the " + rows.length + " sessions listed " + (oneLegged.length === 1 ? "carries" : "carry") + " a long leg and no measured short leg" + (meta.epoch && oneLegged.every((r) => r.pre) ? " — every one of them predates the " + meta.epoch + " selection epoch" : "") + ", so Short and L−S cannot be formed there. Those dashes are a leg the archive does not hold, not a scoring failure."] } : null,
          { title: "Board", lines: ["Selecting a session redraws the names that session's score track placed furthest out on each side, from the score track payload."] },
          anyPre ? { title: "Selection epoch", lines: ["The dashed rule marks the selection epoch" + (meta.epoch ? " (" + meta.epoch + ")" : "") + ". Sessions on the washed columns before it were published under the prior selection rule, from a different pool, and are drawn beside the current rule's sessions rather than averaged into them."] } : null,
          { title: "Scale", lines: ["Bars share one linear scale whose extremes are the largest spread listed, labelled at the right edge; the hit-rate dot grows with its distance from 50%, green above it and red below."] },
        ].filter(Boolean),
      }),
      body: [host, UI.legend([["--up-mark", "", "L" + MINUS + "S up"], ["--down-mark", "", "L" + MINUS + "S down"], ["--label-2", "split", "Hit rate"], ["--warn", "tri", "Attrition"], anyPre ? ["--lvl-flip", "ln", "Rule change"] : null].filter(Boolean)), detail, list],
    });
    if (!rows.length) {
      host.replaceChildren(UI.silent({ state: "pending", reason: "No session has closed a horizon yet." }, "Sessions", 150));
      list.replaceChildren(h("p", { class: "flows-empty", "data-empty": "pending" }, "No session has closed a horizon yet."));
      return mod;
    }
    requestAnimationFrame(() => { chartRef = timeline(host, chrono, pick, () => sel); });
    pick(sel, false);
    return mod;
  }

  function summaryChips(payload, rows) {
    const stated = isNum(payload.statedHorizon);
    const at = rows.find((r) => r.k === stated) || null;
    const retained = isNum(payload.retained);
    const rankedFrom = payload.features && isNum(payload.features.rankedFrom);
    const hitP = at ? hitPoint(at.hit, at.hitS, at.hitN, at.k) : null;
    const lsP = at ? spreadPoint(at.ls, at.n, at.sd, at.k) : null;
    const hz = stated === null ? "" : " " + stated + "d";
    return UI.chips([
      UI.gaugeChip({
        ring: at && at.hit !== null ? at.hit : null, color: clears(hitP, 0.5) ? (at.hit > 0.5 ? "--up-mark" : "--down-mark") : "--label-2",
        value: at ? hitPct(at.hit) : DASH, label: "Hit" + hz,
        info: () => ({ title: "Hit rate" + hz, lead: "The share of published names whose price moved the way their board leaned, at the stated horizon.", facts: [["Hit", at ? hitPct(at.hit, 1) : DASH], ["Names", at && at.hitN !== null ? String(at.hitN) : DASH], ["Sessions", at && at.hitS !== null ? String(at.hitS) : DASH], ["Adjusted 95%", hitP && hitP.adj ? hitPct(hitP.adj[0]) + " to " + hitPct(hitP.adj[1]) : hitP && hitP.open ? "unbounded" : DASH]], notes: [CI_LINES[2]] }),
      }),
      UI.gaugeChip({
        diverging: at && at.ls !== null ? Math.max(-100, Math.min(100, at.ls * 2000)) : null,
        value: at ? pct(at.ls) : DASH, label: "L" + MINUS + "S" + hz, tone: at && at.ls !== null && clears(lsP, 0) ? UI.tone(at.ls) : null,
        info: () => ({ title: "Spread" + hz, lead: "Equal-weighted price return of the published long names minus the short names at the stated horizon. Price returns of an equal-weighted basket, gross of everything: no commissions, no slippage, no short borrow, no dividends.", facts: [["Mean", at ? pct(at.ls) : DASH], ["Sessions", at && at.n !== null ? String(at.n) : DASH], ["SD", at && at.sd !== null ? pct(at.sd) : DASH], ["Adjusted 95%", lsP && lsP.adj ? pct(lsP.adj[0]) + " to " + pct(lsP.adj[1]) : lsP && lsP.open ? "unbounded" : DASH], ["Arc", "full at " + pct(0.05) + " either way"]], notes: [CI_LINES[2]] }),
      }),
      UI.gaugeChip({
        ring: retained !== null && rankedFrom ? Math.min(1, retained / rankedFrom) : null, color: "--s-blue",
        value: retained === null ? DASH : String(retained), label: "Retained",
        info: () => ({ title: "Sessions retained", lead: "A handful of sessions is not evidence of anything; the sample size is stated because it is the most important number here." + (rankedFrom ? " The ring fills toward the " + rankedFrom + " sessions a signal column needs before its mean is ranked." : ""), facts: [["Retained", retained === null ? DASH : String(retained)], ["Current rule", isNum(payload.epochRetained) === null ? DASH : String(payload.epochRetained)], ["Prior rule", isNum(payload.priorRetained) === null ? DASH : String(payload.priorRetained)], ["First", payload.firstSession || DASH], ["Last", payload.lastSession || DASH]] }),
      }),
      UI.gaugeChip({
        icon: "list", color: "--label-2", value: at && at.hitN !== null ? F.int(at.hitN) : DASH, label: "Calls" + hz,
        info: () => ({ title: "Calls scored", lead: "Published names measured at the stated horizon, pooled across sessions. Names inside one session move together, so this count overstates the independent evidence.", facts: [["Names", at && at.hitN !== null ? String(at.hitN) : DASH], ["Attrition rule", payload.attrition ? UI.cap(payload.attrition) : null]] }),
      }),
      UI.gaugeChip({
        icon: "cal", color: "--accent-ink", value: payload.epoch ? F.day(payload.epoch) : DASH, label: "Rule since",
        info: () => ({ title: "Selection epoch", lead: payload.epoch ? "Scores on either side of " + payload.epoch + " come from different pools under different selection rules, so the record keeps them apart rather than averaging them." : "This record names no selection epoch.", notes: [payload.epochNote ? UI.cap(payload.epochNote) : null] }),
      }),
    ], "Record at the stated horizon");
  }

  function staleSaid(payload, updatedAt) {
    const now = Date.now();
    if (updatedAt !== null && updatedAt > 0 && now - updatedAt > STALE_WRITE_MS) {
      const hours = Math.floor((now - updatedAt) / 3600000);
      const days = Math.floor(hours / 24);
      const age = days >= 1 ? days + (days === 1 ? " day" : " days") : hours + (hours === 1 ? " hour" : " hours");
      return "This record was last written " + age + " ago. The pipeline has not published since — check the Actions tab. Every figure below is that run's, and no session has been scored into it since.";
    }
    if (ISO_DAY.test(String(payload.sessionDate || ""))) {
      const t = Date.parse(String(payload.sessionDate) + "T21:00:00Z");
      if (Number.isFinite(t) && now - t > STALE_SESSION_MS) {
        return "These numbers describe the " + payload.sessionDate + " session, which is more than four days old. The pipeline is running but its data is not advancing, so no new session has been scored into the record.";
      }
    }
    return null;
  }

  function statusSaid(payload, rows, sessions) {
    const horizons = rows;
    const retained = isNum(payload.retained);
    if (payload.status === "pending" || (!horizons.length && !sessions.length)) {
      return "The record is empty. Each session's board is retained from the first pipeline run after this shipped, and the shortest horizon needs that many sessions to close before anything here can be measured.";
    }
    if (retained === 0) {
      const probed = isNum(payload.archiveProbed), k = isNum(payload.statedHorizon), failed = isNum(payload.archiveFailed);
      if (failed !== null && failed > 0) {
        return "The record could not be measured this session, and that is a fault in the archive rather than a verdict on the signal. " + failed + " of " + (probed === null ? "the" : probed) + " archive read" + (failed === 1 ? "" : "s") + " failed, so this run could not tell whether earlier sessions exist. Nothing below is evidence that the board has never been right — it is evidence that the store did not answer.";
      }
      return "Nothing has been scored yet, and this is the ordinary first state of the record rather than a failure. A board is scored only against closes that come AFTER the session it was published for, so today's board" + (payload.sessionDate ? " (" + payload.sessionDate + ")" : "") + " cannot score itself" + (probed !== null ? ", and no earlier dated board was readable — " + probed + " dated key" + (probed === 1 ? " was" : "s were") + " probed and every one answered that it holds nothing." : ".") + " The first measured session appears on the next pipeline run" + (k !== null ? ", and the " + k + "-session horizon " + k + " runs after that." : ".");
    }
    const parts = [];
    if (retained !== null) parts.push(retained + " session" + (retained === 1 ? "" : "s") + " retained");
    const stated = isNum(payload.statedHorizon);
    let closed = null;
    if (stated !== null) {
      const row = horizons.find((r) => r.k === stated);
      if (row && (row.n !== null || row.priorN !== null)) closed = (row.n || 0) + (row.priorN || 0);
    }
    if (sessions.length) parts.push(sessions.length + " listed" + (closed !== null && closed > sessions.length ? ", the most recent of at least " + closed + " sessions that have closed the " + stated + "-session horizon with both legs measured" : ""));
    const priorN = isNum(payload.priorRetained), epochN = isNum(payload.epochRetained);
    if (payload.epoch && priorN && epochN !== null) parts.push(epochN + " under the current selection rule, " + priorN + " before it (" + payload.epoch + "), reported separately");
    if (payload.firstSession && payload.lastSession) parts.push("from " + payload.firstSession + " to " + payload.lastSession);
    return parts.length ? parts.join(" · ") + "." : "The record has begun but nothing has closed a horizon yet.";
  }

  function wireAbout(payload, status) {
    if (!about) return;
    about.dataset.info = UI.info(() => ({
      title: "Track record",
      asOf: payload && payload.sessionDate ? "Session " + F.day(payload.sessionDate) : null,
      lead: "What the board said, and what happened next.",
      sections: [
        { title: "Record", lines: [status] },
        { title: "Returns", lines: ["These are PRICE returns of an equal-weighted basket, gross of everything: no commissions, no slippage, no short borrow, no dividends. They are the arithmetic of published closes and nothing more, which is the only claim this page can make without inventing a parameter. A handful of sessions is not evidence of anything; the sample size is stated because it is the most important number here."] },
        payload && payload.closeBasis && payload.closeBasis.rule ? { title: "Closes", lines: [payload.closeBasis.rule] } : null,
      ].filter(Boolean),
    }));
  }

  function fail(msg) {
    statusEl.textContent = msg;
    app.replaceChildren(UI.moduleCard({ id: "recFail", title: "Record", body: UI.silent({ state: "unavailable", reason: msg }, "Record", 220) }));
  }

  let updatedAt = null;
  fetch("/api/flows/record", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((response) => {
      if (response.status === 401) { location.replace("/flows/"); return null; }
      if (!response.ok) throw new Error("HTTP " + response.status);
      updatedAt = Number(response.headers.get("X-Payload-Updated")) || null;
      return response.json();
    })
    .then((payload) => {
      if (!payload) return;
      if (typeof payload !== "object") throw new Error("no payload");
      const rows = horizonRows(payload.horizons);
      const sessions = sessionRows(Array.isArray(payload.sessions) ? payload.sessions : []);
      const meta = {
        epoch: typeof payload.epoch === "string" ? payload.epoch : null,
        epochNote: typeof payload.epochNote === "string" ? payload.epochNote : null,
      };
      UI.freshness({ sessionDate: payload.sessionDate, generatedAt: payload.generatedAt, updatedAt, source: "record" });
      const status = statusSaid(payload, rows, sessions);
      statusEl.textContent = status;
      wireAbout(payload, status);
      const stale = staleSaid(payload, updatedAt);
      const head = document.getElementById("recHeadState");
      if (head) head.replaceChildren(stale ? UI.stateButton({ state: "stale", reason: stale }, "Record") : "");
      const hit = curveModule("recHitMod", "Hit rate", "recHit", rows, meta, "hit");
      const spread = curveModule("recSpreadMod", "Spread", "recCurve", rows, meta, "ls");
      app.replaceChildren(
        h("div", { class: "rc-chips" }, summaryChips(payload, rows)),
        hit, spread,
        sessionsModule(sessions, meta, isNum(payload.statedHorizon)),
        paintFeatures(payload.features));
      paintHit(hit, rows, meta);
      paintSpread(spread, rows, meta);
    })
    .catch(() => fail("The record could not be loaded. Refresh to try again."));
})();
