(function () {
  "use strict";

  const DASH = "—";

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  };

  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const MINUS = "\u2212";
  const neg = (str) => String(str).replace(/-/g, MINUS);
  const signed = (n, body) => (n < 0 ? MINUS : n > 0 ? "+" : "") + body(Math.abs(n));

  const fmtOr = (v, body) => { const n = isNum(v); return n === null ? DASH : body(n); };

  const polarity = (v) => {
    const n = isNum(v);
    return n === null ? "is-null" : n < 0 ? "is-neg" : n > 0 ? "is-pos" : "is-flat";
  };
  const pct = (v) => fmtOr(v, (n) => signed(n, (a) => (a * 100).toFixed(2) + "%"));
  const pct1 = (v) => fmtOr(v, (n) => signed(n, (a) => (a * 100).toFixed(1) + "%"));

  const atrDist = (v) => fmtOr(v, (n) => signed(n, (a) => a.toFixed(2) + " ATR"));
  const px2 = (v) => fmtOr(v, (n) => neg(n.toFixed(2)));
  const vol1 = (v) => fmtOr(v, (n) => neg((n * 100).toFixed(1)) + "%");

  const money = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    return (n < 0 ? MINUS : "") + "$" + compact(Math.abs(n));
  };

  const compact = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const a = Math.abs(n);
    const s = n < 0 ? MINUS : "";
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e4) return s + (a / 1e3).toFixed(0) + "K";
    if (a >= 1e3) return s + (a / 1e3).toFixed(1) + "K";
    return s + a.toFixed(0);
  };

  const AXIS_CH = 5.5;

  function deadPanel(host, question, reason) {
    host.replaceChildren();
    host.append(el("p", "fc-q", question));
    const note = el("p", "fc-dead");
    note.setAttribute("data-empty", "unavailable");
    note.append(el("strong", null, "Unavailable \u2014 "));
    note.append(document.createTextNode(
      reason || "This panel's data source did not return.",
    ));
    host.append(note);
  }

  function quietPanel(host, question, reason) {
    host.replaceChildren();
    host.append(el("p", "fc-q", question));
    const note = el("p", "fc-quiet");
    note.setAttribute("data-empty", "quiet");
    note.append(el("strong", null, "Nothing to report \u2014 "));
    note.append(document.createTextNode(
      reason || "This panel's source answered and measured nothing.",
    ));
    host.append(note);
  }

  function emptyPanel(host, question, panel, fallback) {
    if (panel && panel.status === "quiet") {
      return quietPanel(host, question, panel.reason || fallback);
    }
    return deadPanel(host, question, (panel && panel.reason) || fallback);
  }

  function statList(pairs) {
    const dl = el("dl", "fc-stats");
    for (const [k, v, cls, empty, why] of pairs) {
      const wrap = el("div", "fc-stat");
      wrap.append(el("dt", null, k));
      const dd = el("dd", cls || null, v);
      if (empty) dd.setAttribute("data-empty", empty);
      if (why) dd.title = why;
      wrap.append(dd);
      dl.append(wrap);
    }
    return dl;
  }

  function panelHead(host, question) {
    host.replaceChildren();
    host.append(el("p", "fc-q", question));
    return host;
  }

  const NOTE_WALL_CHARS = 420;

  function appendMethod(host, nodes, summary, always) {
    const list = (nodes || []).filter(Boolean);
    if (!list.length) return;

    const chars = list.reduce((n, node) => n + String(node.textContent || "").length, 0);
    if (!always && chars <= NOTE_WALL_CHARS) {
      for (const node of list) host.append(node);
      return;
    }
    const box = el("details", "ft-how");
    box.append(el("summary", "ft-how-s", summary || "How this reading was made"));
    for (const node of list) box.append(node);
    host.append(box);
  }

  function leadReading(host, text) {
    const p = el("p", "fc-reading is-lead");
    p.textContent = text;
    host.append(p);
    return p;
  }

  const qualifier = (text) => el("p", "fc-note is-qualifier", text);

  function symlog(tau, vmax, lambda) {
    const lam = lambda === undefined ? 0.35 : lambda;
    const span = vmax > tau ? Math.log10(vmax / tau) : 0;
    return (v) => {
      const a = Math.abs(v);
      const s = v < 0 ? -1 : 1;
      if (a <= tau || span <= 0) return s * (tau > 0 ? lam * (a / tau) : 0);
      return s * (lam + (1 - lam) * (Math.log10(a / tau) / span));
    };
  }

  function panelWidth(host) {

    const box = host && typeof host.getBoundingClientRect === "function"
      ? host.getBoundingClientRect().width : 0;
    const measured = Math.floor(box > 0 ? box : ((host && host.clientWidth) || 0));
    if (!(measured > 0)) return 560;
    return Math.min(1900, measured);
  }

  function niceStep(raw) {
    if (!(raw > 0)) return 0;
    const e = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [5, 2.5, 2, 1]) if (m * e <= raw) return m * e;
    return e;
  }

  function quantileAbs(values, q) {
    const s = values.map(Math.abs).sort((a, b) => a - b);
    if (!s.length) return 0;
    const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
    return s[i];
  }

  const mountId = (base, mount) => (mount ? base + "-" + mount : base);

  const AXES = [
    { k: "F", signed: true, label: "Flow", blurb: "net directional delta, premium tilt, aggressor volume and open-interest change — every column a ratio, so the column ranks flow rather than market capitalisation" },
    { k: "P", signed: true, label: "Positioning", blurb: "where today's flow is building dealer gamma relative to where the standing book already is, in ATR units" },
    { k: "D", signed: true, label: "Path", blurb: "how the day accumulated — steady work against the tape, or one spike already in the price" },
    { k: "V", signed: false, label: "Vol regime", blurb: "how rich options are against delivered vol, where 30-day IV sits in its own year, and whether it is rising" },
    { k: "O", signed: false, label: "Quality", blurb: "the multiplier this name earned: directional share of the tape, near-money rather than lottery, direction rather than vol, and dealer gamma at spot" },
  ];

  function convictionArithmetic(host, card, conv) {
    const w = conv.weights;
    if (!w || typeof w !== "object") return;
    const a = isNum(conv.agreement), c = isNum(conv.coverage), pn = isNum(conv.persistence);
    const wa = isNum(w.agreement), wc = isNum(w.coverage), wp = isNum(w.persistence);
    const published = isNum(card.conviction);
    if (a === null || c === null || pn === null ||
        wa === null || wc === null || wp === null || published === null) return;

    const recon = Math.round(100 * (wa * a + wc * c + wp * pn));
    if (recon !== published) return;

    const pct = (x) => Math.round(x * 100) + "%";
    const term = (weight, value) => pct(weight) + " of " + pct(value);
    const note = el("p", "fc-note fc-conv-math");
    note.append(document.createTextNode(
      "Conviction " + published + " is " + term(wa, a) + " agreement, plus " +
      term(wc, c) + " source coverage, plus " + term(wp, pn) + " persistence. " +

      "Agreement is a COUNT — how many of the signed axes point the same way, out of the " +
      "ones that were measured at all — so it moves in steps and never smoothly, and it " +
      "carries the heaviest of the three weights. Two names a few points apart on this " +
      "number may differ by a whole axis, or by nothing but coverage."));

    appendMethod(host, [note], "How conviction was computed", true);
  }

  function changeFrom(join) {

    if (join === undefined || join === null) {
      return { status: "unavailable",
        reason: "this card was built before the score overlay existed, so it carries " +
          "no score history to measure a move against" };
    }
    if (join.status !== "ok") {
      return { status: join.status === "quiet" ? "quiet" : "unavailable",
        reason: join.reason ||
          (join.status === "quiet"
            ? "the score archive and this card's price window share no session"
            : "the score history for this name was not published on this card") };
    }

    const rows = Array.isArray(join.rows) ? join.rows : [];
    const scored = [];
    for (let i = 0; i < rows.length; i++) {
      if (isNum(rows[i] && rows[i].score) !== null) scored.push(i);
    }
    if (!scored.length) {
      return { status: "quiet",
        reason: "not one of the " + rows.length + " sessions this card shares with the " +
          "score archive carries a score for this name" };
    }

    const window = {
      sessions: rows.length,
      from: rows[0].d,
      to: rows[rows.length - 1].d,
      scored: scored.length,
    };
    const iAt = scored[scored.length - 1];
    const at = { i: iAt, d: rows[iAt].d, score: isNum(rows[iAt].score) };

    const stale = rows.length - 1 - iAt;

    let prior = null, d1 = null;
    if (scored.length >= 2) {
      const iPrior = scored[scored.length - 2];
      prior = { i: iPrior, d: rows[iPrior].d, score: isNum(rows[iPrior].score) };
      d1 = {
        v: at.score - prior.score,

        gap: iAt - iPrior,
        from: prior.d, to: at.d,
      };
    }

    let run = 0, runBroken = false, runCapped = false;
    if (at.score === 0) {
      run = 0;
    } else {
      const sign = at.score < 0 ? -1 : 1;
      let i = iAt;
      for (;;) {
        run++;
        if (i === 0) { runCapped = true; break; }
        const prevV = isNum(rows[i - 1].score);

        if (prevV === null) { runBroken = true; break; }
        if ((prevV < 0 ? -1 : prevV > 0 ? 1 : 0) !== sign) break;
        i--;
      }
    }

    let hi = null, hiAt = null, lo = null, loAt = null;
    for (const i of scored) {
      const v = isNum(rows[i].score);
      if (hi === null || v > hi) { hi = v; hiAt = rows[i].d; }
      if (lo === null || v < lo) { lo = v; loAt = rows[i].d; }
    }

    const band = isNum(join.deadBand);
    const bandKnown = band !== null && band >= 0;
    const insideOf = (v) => Math.abs(v) <= band;
    let cross = null;
    if (bandKnown && prior) {
      const wasIn = insideOf(prior.score), isIn = insideOf(at.score);
      if (wasIn && !isIn) cross = "cleared";
      else if (!wasIn && isIn) cross = "faded";
      else if (!wasIn && !isIn && Math.sign(prior.score) !== Math.sign(at.score)) cross = "flipped";
    }

    return {
      status: "ok",
      window, at, prior, d1, stale,
      run, runBroken, runCapped,
      ext: { hi, hiAt, lo, loAt },
      band: bandKnown ? band : null,
      inside: bandKnown ? insideOf(at.score) : null,
      cross,
      crossKnown: bandKnown && !!prior,
    };
  }

  function renderOverlay(host, join, card, questionIn) {
    const question = questionIn ||
      "How has this name\u2019s daily score moved against its own price?";
    if (!join || join.status !== "ok") return emptyPanel(host, question, join);
    panelHead(host, question);

    const rows = Array.isArray(join.rows) ? join.rows : [];
    if (rows.length < 2) {
      return quietPanel(host, question,
        "one session is a dot, not a history — this name and its scores share " +
        (rows.length === 1 ? "exactly one session" : "no session") + " so far.");
    }

    const W = panelWidth(host), H = 132, padL = 4, padR = 4, padT = 10, padB = 18;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    let lo = Infinity, hi = -Infinity;
    for (const r of rows) { if (r.close < lo) lo = r.close; if (r.close > hi) hi = r.close; }
    const span = hi - lo || 1;
    const xOf = (i) => padL + (i / (rows.length - 1)) * plotW;
    const yPrice = (v) => padT + (1 - (v - lo) / span) * plotH;

    let peak = 0;
    for (const r of rows) {
      const v = isNum(r.score);
      if (v !== null && Math.abs(v) > peak) peak = Math.abs(v);
    }
    const scoreMax = Math.min(100, Math.max(25, Math.ceil(peak)));
    const yScore = (v) => padT +
      (1 - (Math.max(-scoreMax, Math.min(scoreMax, v)) + scoreMax) / (2 * scoreMax)) * plotH;

    const svg = svgEl("svg", {
      class: "ovl", viewBox: `0 0 ${W} ${H}`, width: "100%", height: H,

      role: "img", preserveAspectRatio: "xMidYMid meet",
    });

    const band = isNum(join.deadBand);
    if (band !== null && band > 0) {
      svg.append(svgEl("rect", {
        class: "ovl-band", x: padL, width: plotW,
        y: yScore(band), height: Math.max(1, yScore(-band) - yScore(band)),
      }));
    }
    svg.append(svgEl("line", {
      class: "ovl-zero", x1: padL, x2: W - padR, y1: yScore(0), y2: yScore(0),
    }));

    svg.append(svgEl("path", {
      class: "ovl-px",
      d: rows.map((r, i) => (i ? "L" : "M") + xOf(i).toFixed(1) + " " + yPrice(r.close).toFixed(1)).join(" "),
    }));

    const step = rows.length > 1 ? plotW / (rows.length - 1) : plotW;
    const barW = Math.max(1, Math.min(9, step * 0.62));
    const bars = svgEl("g", { class: "ovl-score" });
    const zeroY = yScore(0);
    let drawn = 0;
    for (let i = 0; i < rows.length; i++) {
      const v = isNum(rows[i].score);
      if (v === null) continue;
      const y = yScore(v);
      drawn++;
      bars.append(svgEl("rect", {
        class: "ovl-bar" + (v < 0 ? " is-neg" : v > 0 ? " is-pos" : " is-zero"),
        x: (xOf(i) - barW / 2).toFixed(1), width: barW.toFixed(1),
        y: Math.min(y, zeroY).toFixed(1),
        height: Math.max(0.8, Math.abs(zeroY - y)).toFixed(1),
      }));
    }
    if (drawn) svg.append(bars);
    const segments = drawn;

    const first = rows[0], last = rows[rows.length - 1];
    svg.setAttribute("aria-label",
      join.overlap + " sessions from " + first.d + " to " + last.d + ", " +
      "price from " + px2(first.close) + " to " + px2(last.close) + ", " +
      "score from " + (isNum(first.score) === null ? "unscored" : first.score) +
      " to " + (isNum(last.score) === null ? "unscored" : last.score) + "." +
      (join.gaps ? " " + join.gaps + " session" + (join.gaps === 1 ? "" : "s") +
        " in that window carry no score and are drawn as no bar at all." : ""));
    host.append(svg);

    if (window.FlowsCursor && rows.length) {
      window.FlowsCursor.attach(svg, {
        name: "Score against price",
        band: { y0: padT, y1: padT + plotH },
        points: rows.map((r, i) => {
          const sc = isNum(r.score);
          return {
            x: xOf(i),
            label: r.d,
            rows: [
              { k: "Close", v: px2(r.close) },
              { k: "Score", v: sc === null ? "unscored" : (sc > 0 ? "+" : "") + sc,
                cls: sc === null ? "" : sc > 0 ? "is-pos" : sc < 0 ? "is-neg" : "" },
            ],
          };
        }),
      });
    }

    host.append(statList([
      ["Shared sessions", String(join.overlap)],
      ["From", first.d],
      ["To", last.d],
      ["Scored", join.scored + " of " + join.overlap],
      ["Dead band", band === null ? DASH : "±" + band],

      ["Scale", "±" + scoreMax + " score points"],
    ]));

    const outside = [];
    if (isNum(join.priceOnly) && join.priceOnly > 0) {
      outside.push(join.priceOnly + " session" + (join.priceOnly === 1 ? "" : "s") +
        " of price with no score for this name");
    }
    if (isNum(join.scoreOnly) && join.scoreOnly > 0) {
      outside.push(join.scoreOnly + " scored session" + (join.scoreOnly === 1 ? "" : "s") +
        " with no close on this card");
    }

    const notes = (join.notes || {});
    host.append(el("p", "fc-note is-qualifier ovl-note",
      (outside.length
        ? "Drawn over the " + join.overlap + " sessions the two windows share. Outside it: " +
          outside.join(", ") + ". "
        : "The two windows cover the same " + join.overlap + " sessions exactly. ") +
      (notes.axes || "")));
    if (notes.join) {
      appendMethod(host, [el("p", "fc-note ovl-join", notes.join)],
        "How the two series were joined", true);
    }

    if (join.gaps > 0) {
      host.append(el("p", "fc-note ovl-gaps",
        join.gaps + " of these " + join.overlap + " sessions carry no score for this name. " +
        (notes.gap || "")));
    }
    if (segments === 0) {
      const dead = el("p", "fc-note ovl-none",
        "No session in the shared window carries a score for this name, so only the " +
        "price line is drawn and there are no bars.");
      dead.setAttribute("data-empty", "quiet");
      host.append(dead);
    }
  }

  const GAUGE_MAX = 100;
  function scoreGauge(host, card) {
    const score = isNum(card.score);

    const W = panelWidth(host);

    const R = Math.max(46, Math.min(150, W * 0.3));
    const SW = R * 0.17;
    const CX = W / 2, CY = R + SW / 2 + 2, H = CY + 4;

    const pt = (v) => {
      const a = Math.PI * (1 - (v + GAUGE_MAX) / (2 * GAUGE_MAX));
      return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
    };
    const arc = (from, to, cls) => {
      const [x1, y1] = pt(from), [x2, y2] = pt(to);
      return svgEl("path", {
        class: cls, "stroke-width": SW.toFixed(2),
        d: "M" + x1.toFixed(2) + " " + y1.toFixed(2) +
          "A" + R.toFixed(2) + " " + R.toFixed(2) + " 0 0 1 " +
          x2.toFixed(2) + " " + y2.toFixed(2),
      });
    };

    const box = el("div", "fc-gauge" + (score === null ? " is-null" : ""));

    box.style.setProperty("--gauge-lift", (R * 0.52).toFixed(1) + "px");
    box.style.setProperty("--gauge-w", (2 * R).toFixed(1) + "px");
    const svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + H.toFixed(2), width: W, height: H.toFixed(2),
      preserveAspectRatio: "xMidYMid meet", role: "img",
      "aria-label": "Options score on a scale from " + MINUS + GAUGE_MAX +
        ", most bearish, to +" + GAUGE_MAX + ", most bullish" +
        (score === null ? " \u2014 no score published for this name" : ""),
    });

    svg.append(arc(-GAUGE_MAX, -GAUGE_MAX / 3, "fc-gauge-a is-neg"));
    svg.append(arc(-GAUGE_MAX / 3, GAUGE_MAX / 3, "fc-gauge-a is-flat"));
    svg.append(arc(GAUGE_MAX / 3, GAUGE_MAX, "fc-gauge-a is-pos"));

    if (score !== null) {

      const at = Math.max(-GAUGE_MAX, Math.min(GAUGE_MAX, score));
      const [mx, my] = pt(at);
      const inset = R * 0.26;
      const [ix, iy] = [CX + (R - inset) * (mx - CX) / R, CY + (R - inset) * (my - CY) / R];
      svg.append(svgEl("line", {
        class: "fc-gauge-n " + polarity(score), "stroke-width": (SW * 0.42).toFixed(2),
        x1: ix.toFixed(2), y1: iy.toFixed(2), x2: mx.toFixed(2), y2: my.toFixed(2),
      }));
      if (at !== score) svg.append(svgEl("circle", {
        class: "fc-gauge-clip", cx: mx.toFixed(2), cy: my.toFixed(2), r: (SW * 0.4).toFixed(2) }));
    }

    svg.dataset.fxRead = "face";
    box.append(svg);

    const read = el("div", "fc-gauge-read");
    const v = el("b", "fc-gauge-v " + (score === null ? "is-null" : polarity(score)),
      score === null ? DASH : score > 0 ? "+" + score : score < 0 ? MINUS + Math.abs(score) : "0");
    read.append(v);
    read.append(el("span", "fc-gauge-scale",
      score === null ? "no score published for this name"
        : "of " + MINUS + GAUGE_MAX + " to +" + GAUGE_MAX));
    box.append(read);

    const ends = el("div", "fc-gauge-ends");
    ends.append(el("span", null, "Bearish"));
    ends.append(el("span", null, "Bullish"));
    box.append(ends);
    if (score === null) box.setAttribute("data-empty", "unavailable");
    host.append(box);
  }

  function renderScore(host, card, questionIn) {
    const question = questionIn || "Why is this name on the board, and how much of the score came from where?";
    if (!card.fam) return deadPanel(host, question, "no decomposition was published");
    panelHead(host, question);

    scoreGauge(host, card);

    const weights = card.weights || {};
    const wTotal = Object.values(weights).reduce((a, w) => a + (isNum(w) || 0), 0);

    const legacy = (isNum(card.v) ?? 1) < 2;

    const list = el("ul", "fc-fam");
    for (const axis of AXES) {
      const v = legacy && !axis.signed ? null : isNum(card.fam[axis.k]);
      const li = el("li", (axis.signed ? "is-signed " : "is-gauge ") +
        (v === null ? "is-null" : !axis.signed ? "is-pos" : polarity(v)));
      li.append(el("span", "fc-fam-k", axis.k));

      const track = el("span", "fc-fam-track");

      if (axis.signed) track.append(el("b", "fc-fam-zero"));
      const bar = el("i");
      bar.style.setProperty("--w", v === null ? 0 : (axis.signed ? Math.min(Math.abs(v) / 100, 1) : Math.min(v / 100, 1)));
      track.append(bar);
      li.append(track);

      li.append(el("span", "fc-fam-v", v === null ? DASH
        : axis.signed ? (v > 0 ? "+" + v : v < 0 ? MINUS + Math.abs(v) : "0")
        : String(v)));

      const lab = el("span", "fc-fam-l");
      lab.append(document.createTextNode(axis.label));
      if (axis.signed && wTotal > 0 && isNum(weights[axis.k]) !== null) {
        const w = el("span", "fc-fam-w");
        w.textContent = " " + Math.round((weights[axis.k] / wTotal) * 100) + "% of the blend";
        lab.append(w);
      } else if (!axis.signed) {
        lab.append(el("span", "fc-fam-w",
          legacy ? " not published on this card" : " gauge — no direction"));
      }
      lab.title = axis.blurb;
      li.append(lab);
      list.append(li);
    }
    host.append(list);

    const conv = card.conv || {};
    host.append(statList([
      ["Score", fmtOr(card.score, (n) => signed(n, (a) => String(a)))],
      ["Conviction", fmtOr(card.conviction, (n) => String(n))],
      ["Agreement", fmtOr(conv.agreement, (n) => Math.round(n * 100) + "%")],
      ["Axes present", fmtOr(conv.breadth, (n) => n + " of 3")],
      ["Sources", fmtOr(conv.coverage, (n) => Math.round(n * 5) + " of 5")],

      ["Persistence", fmtOr(conv.persistence, (n) => Math.round(n * 100) + "%")],
      ["Quality gate", fmtOr(conv.gate, (n) => "\u00d7" + n.toFixed(2))],
    ]));

    convictionArithmetic(host, card, conv);

    const quality = card.quality;
    if (!quality) {
      if (!legacy) host.append(el("p", "fc-note",
        "The two quality readings behind the O gauge — the out-of-the-money share of " +
        "directional flow and the vega tilt — are not published on this card. It was " +
        "built before they were, so they are shown as unmeasured rather than as zeros: " +
        "zero is the BEST possible reading of both once they are oriented, and imputing " +
        "it would reward a name for having no data. They return on the next published " +
        "session."));
    } else {
      const otm = isNum(quality.otmShare);
      const tilt = isNum(quality.vegaTilt);
      host.append(statList([
        ["OTM share of directional flow", otm === null ? DASH : Math.round(otm * 100) + "%"],
        ["Vega flow per unit delta", tilt === null ? DASH : neg(tilt.toFixed(2))],
      ]));
      host.append(el("p", "fc-note",
        (otm === null && tilt === null
          ? "Neither quality reading is measurable on this name: there was no directional " +
            "delta flow to divide by, which is \"no directional view\", never infinite " +
            "conviction — so both are withheld rather than floored at their best value. "
          : "") +
        (otm !== null
          ? `${Math.round(otm * 100)}% of this name's directional delta flow traded ` +
            `out-of-the-money. A high share is lottery tickets — cheap, convex, and ` +
            `frequently written by someone with no view at all; a low one is near-money ` +
            `conviction that has to be paid for. `
          : "") +
        (tilt !== null
          ? `Each unit of gross delta flow came with ${neg(tilt.toFixed(2))} of gross vega ` +
            `flow. A high tilt says this participant is trading VOLATILITY rather than ` +
            `direction, which is the cleanest reason on the card to suppress a directional ` +
            `read rather than to misinterpret it as a view. `
          : "") +
        "Both enter the score only through the O gauge, ranked against the rest of the " +
        "board rather than against a fixed cut — there is no identified threshold at " +
        "which a share becomes \"too high\"."));
    }

    if (legacy) {
      host.append(el("p", "fc-note",
        "This card was built before the volatility and quality readings became " +
        "gauges, so those two are shown as unavailable rather than redrawn under " +
        "a meaning they did not have. They return on the next published session."));
    }

    appendMethod(host, [el("p", "fc-note",
      "The three signed axes are blended by EFFECTIVE breadth — a family of five " +
      "columns that all restate the same tape counts as one signal, not five — and " +
      "the blend is then multiplied by the quality gate, which is bounded above by " +
      "two and averages one across the board, so it can amplify or damp a reading " +
      "but never reverse it. The result is neutralised against sector and market cap, " +
      "then mapped through a FIXED scale — score = 100·tanh(composite × 0.5493) — so " +
      "a composite of 2.0 scores 80 on every session and at every board size, and a " +
      "quiet day prints quiet scores. The composite is a weighted mean of columns each " +
      "measured in its own median-absolute-deviation units, so 2.0 is two of those, " +
      "not two standard deviations of anything. This is a ranked attention signal, " +
      "not a return forecast.")], "How the score is computed");
  }

  let drawersPromise = null;

  function need() {
    if (drawersPromise) return drawersPromise;
    drawersPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");

      const own = document.querySelector('script[src*="flows-panels.js"]');
      const q = own && own.src.indexOf("?") >= 0
        ? own.src.slice(own.src.indexOf("?")) : "";
      s.src = "/assets/js/flows-drawers.js" + q;

      s.onload = () => (typeof api.gamma === "function"
        ? resolve(api)
        : reject(new Error("flows-drawers.js loaded but registered no drawers")));
      s.onerror = () => reject(new Error("flows-drawers.js did not load"));
      document.head.append(s);
    });
    return drawersPromise;
  }

  const api = {

    overlay: renderOverlay,
    score: renderScore,

    changeFrom,

    need,
    __register(drawers) { Object.assign(api, drawers); },

    el, svgEl, isNum, fmtOr, polarity, deadPanel, quietPanel, emptyPanel, statList,
    panelHead, panelWidth, appendMethod, leadReading, qualifier, mountId,
    niceStep, quantileAbs, symlog,
    DASH, MINUS, neg, signed, pct, pct1, atrDist, px2, vol1, money, compact,
    AXIS_CH,
  };

  window.FlowsPanels = api;
})();
