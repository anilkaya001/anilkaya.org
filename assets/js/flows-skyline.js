(() => {
  "use strict";
  const SQ = Math.sqrt(252);
  const MIN = 2;
  const CAP = 40;
  const EVENT = 21;
  const NARROW = 640;
  const SESSIONS = 252;
  const FLOOR_N = 250;
  const WILSON_MIN = 5;
  const CALLOUTS = 3;
  const LEFT = 124;
  const WHISK = 16;
  const GAP = 10;
  const LANE = 8;
  const HEAD_H = 24;
  const LINE_H = 14;
  const PAD_B = 8;
  const MINUS = "−";
  const DASH = "—";
  const FONT = "11px Inter, system-ui, sans-serif";
  const FONT_HEAD = "600 12px Inter, system-ui, sans-serif";
  const TICKS = [2, 5, 10, 25, 50, 100, FLOOR_N];
  const isNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const axisFrac = (n) => Math.log10(n) / Math.log10(FLOOR_N);
  const oneIn = (p) => Math.max(1, Math.round(1 / p));
  const pctText = (x) => (x * 100).toFixed(x * 100 >= 10 ? 0 : 1) + "%";

  function col(u, k) {
    const c = u.cols && u.cols[k];
    const unit = u.units && u.units[k];
    const sc = unit ? isNum(unit[1]) : null;
    return Array.isArray(c) && sc ? c.map((x) => (isNum(x) === null ? null : x / sc)) : null;
  }

  function wilson(hits, n) {
    const z = 1.96, p = hits / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
    const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return { lo: Math.max(0, (c - w) / d), hi: Math.min(1, (c + w) / d) };
  }

  function often(r) {
    const sig = r.sig;
    if (sig === null || !(sig > 0)) return { why: "scale" };
    if (typeof r.chg !== "number" || !Number.isFinite(r.chg) || !(r.chg > -1)) return { why: "scale" };
    const lm = Math.abs(Math.log1p(r.chg));
    const level = lm >= 3 * sig ? 3 : lm >= 2 * sig ? 2 : 0;
    if (!level) return { why: "under" };
    const hits = level === 3 ? r.f3 : r.f2;
    if (!Number.isInteger(hits) || hits < 0 || hits > SESSIONS) return { why: "scale" };
    const floored = hits === 0 || SESSIONS / hits > FLOOR_N;
    let how;
    if (floored) {
      how = "rarer than 1 in " + FLOOR_N + " sessions for this name over the last year";
      if (hits === 0) how += ", and fewer than 1 in " + Math.floor(1 / (1 - Math.pow(0.05, 1 / SESSIONS)) / 10) * 10 + " at 95%";
    } else {
      how = "about 1 in " + oneIn(hits / SESSIONS) + " sessions for this name over the last year";
      if (hits >= WILSON_MIN) {
        const w = wilson(hits, SESSIONS);
        how += " (95% interval 1 in " + oneIn(w.hi) + " to 1 in " + oneIn(w.lo) + ")";
      }
    }
    return {
      why: "", level, hits, floored, n: floored ? FLOOR_N : SESSIONS / hits,
      short: floored ? "rarer than 1 in " + FLOOR_N : "1 in " + oneIn(hits / SESSIONS),
      text: "a " + level + "x typical-day move: typical day " + pctText(sig) + "; " + how,
    };
  }

  const byHeight = (a, b) => b.h - a.h || (a.t < b.t ? -1 : 1);

  function model(u) {
    if (!u || u.status !== "ok" || !Array.isArray(u.t)) return null;
    const chg = col(u, "chg"), iv = col(u, "iv30p"), ed = col(u, "ed");
    if (!chg || !iv) return null;
    const sg = col(u, "sig"), f2 = col(u, "f2"), f3 = col(u, "f3");
    const names = Array.isArray(u.sectors) ? u.sectors : [];
    const all = [];
    u.t.forEach((t, i) => {
      const c = chg[i], v = iv[i];
      if (c === null || v === null || !(v > 0)) return;
      const m = c / (v / SQ);
      const e = ed ? ed[i] : null;
      const s = Array.isArray(u.sec) && u.sec[i] !== null && u.sec[i] !== undefined ? names[u.sec[i]] || null : null;
      all.push({
        t, sector: s, secIx: s === null ? names.length : u.sec[i], chg: c, iv: v, m, h: Math.abs(m), dir: m > 0 ? 1 : -1,
        event: e !== null && e !== undefined && e <= EVENT,
        sig: sg ? sg[i] : null, f2: f2 ? f2[i] : null, f3: f3 ? f3[i] : null,
      });
    });
    const beyond = all.filter((r) => r.h >= MIN);
    const prisms = beyond.slice().sort(byHeight).slice(0, CAP);
    const absent = { scale: [], under: [], event: [] };
    for (const p of prisms) {
      const f = p.event ? { why: "event" } : often(p);
      p.often = f.why ? null : f;
      p.why = f.why;
      if (f.why) absent[f.why].push(p.t);
    }
    prisms.sort((a, b) => a.secIx - b.secIx || byHeight(a, b));
    prisms.forEach((p, i) => { p.gi = i; });
    return {
      n: all.length, beyond: beyond.length, prisms, max: prisms.reduce((x, p) => Math.max(x, p.h), 0),
      apart: prisms.some((p) => p.event), day: u.sessionDate || null,
      plotted: prisms.filter((p) => p.often).length, absent,
    };
  }

  const shown = (md, mode) => (mode === "often" ? md.prisms.filter((p) => p.often) : md.prisms);

  function ranked(list, mode) {
    const order = mode === "often"
      ? (a, b) => b.often.n - a.often.n || byHeight(a, b)
      : byHeight;
    return list.slice().sort(order).slice(0, CALLOUTS);
  }

  const sign = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
  const f1 = (v) => (v === null ? DASH : sign(v) + Math.abs(v).toFixed(1));
  const pc = (v) => (v === null ? DASH : sign(v) + Math.abs(v * 100).toFixed(1) + "%");
  const dirWord = (p) => (p.dir > 0 ? "up" : p.dir < 0 ? "down" : "flat");
  const glyphOf = (p) => (p.dir > 0 ? "▲" : p.dir < 0 ? "▼" : "–");

  const APART = "Earnings within 21 sessions: event not separated.";
  const WHY = {
    event: APART,
    scale: "No typical-day move is published for this name.",
    under: "It moved under 2 typical days, below the lowest count published.",
  };
  const WHY_SHORT = { event: "Event not separated", scale: "No move scale published", under: "Under 2 typical days" };
  const sentence = (p) => (p.often ? p.often.text : WHY[p.why]);
  const headOf = (p) => p.t + " " + f1(p.m) + " IV-days";

  function wrap(text, maxW, measure) {
    const lines = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? cur + " " + word : word;
      if (cur && measure(next) > maxW) { lines.push(cur); cur = word; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  const estimate = (s, f) => s.length * (f === FONT_HEAD ? 6.8 : 5.9);

  function layout(md, W, H0, o) {
    const mode = o && o.mode === "often" ? "often" : "ivdays";
    const measure = (o && o.measure) || estimate;
    const list = shown(md, mode);
    const n = list.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const span = Math.min(H0 * 0.5, 180);
    const unit = md.max > 0 ? span / Math.max(md.max, 4) : 0;
    const CW = Math.max(170, Math.min(250, Math.round(W * 0.26)));
    const bx = W - 12 - CW;
    const gridR = bx - 28;
    const cw = Math.max(8, Math.min(84, (2 * (gridR - LEFT - 16)) / (cols + rows)));
    const hw = cw * 0.34, d = hw * 0.5;
    const ox = (LEFT + gridR) / 2 - (cols - rows) * cw * 0.25;
    const calls = ranked(list, mode);
    const m = calls.length;
    const edge = [];
    for (let gx = cols - 1; gx >= 0; gx--) edge.push(gx);
    for (let gy = 1; gy < rows; gy++) edge.push(gy * cols);
    const taken = edge.slice(0, m);
    const cell = new Map(calls.map((p, j) => [p, taken[j]]));
    const vacant = [];
    for (let i = 0; i < n; i++) if (!taken.includes(i)) vacant.push(i);
    list.filter((p) => !cell.has(p)).forEach((p, j) => cell.set(p, vacant[j]));
    const placed = list.map((p) => {
      const i = cell.get(p);
      return { p, gx: i % cols, gy: Math.floor(i / cols), floored: mode === "often" && p.often.floored, ph: mode === "often" ? span * axisFrac(p.often.n) : p.h * unit };
    });
    const topPad = 16 + LANE * Math.max(0, m - 1);
    const oy = placed.reduce((a, c) => Math.max(a, topPad + c.ph + d + (c.floored ? WHISK : 0) - (c.gx + c.gy) * cw * 0.25), 0);
    const items = placed.map((c) => {
      const x = ox + (c.gx - c.gy) * cw * 0.5;
      const yb = oy + (c.gx + c.gy) * cw * 0.25;
      const yt = yb - c.ph;
      return {
        t: c.p.t, gx: c.gx, gy: c.gy, x, yb, yt, w: hw, h: c.p.h, v: mode === "often" ? c.p.often.n : c.p.h, dir: c.p.dir, event: c.p.event,
        floored: c.floored, order: c.gx + c.gy,
        poly: [[x - hw, yb], [x - hw, yt], [x, yt - d - (c.floored ? WHISK : 0)], [x + hw, yt], [x + hw, yb], [x, yb + d]],
      };
    });
    const minTop = items.reduce((a, it) => Math.min(a, it.poly[2][1]), Infinity);
    const boxes = calls.map((p) => {
      const it = items.find((x) => x.t === p.t);
      const lines = wrap(sentence(p), CW - 16, (s) => measure(s, FONT));
      return { t: p.t, dir: p.dir, glyph: glyphOf(p), head: headOf(p), lines, w: CW, h: HEAD_H + lines.length * LINE_H + PAD_B, anchor: it.poly[2] };
    }).sort((a, b) => a.anchor[0] - b.anchor[0]);
    const laneLast = minTop - 10;
    let y = m ? Math.max(12, Math.ceil(laneLast + 8 - boxes[0].h / 2)) : 0;
    const callouts = boxes.map((b, k) => {
      const lane = laneLast - LANE * (m - 1 - k);
      const ex = bx - 8 - 6 * k;
      const r = { ...b, x: bx, y };
      y += b.h + GAP;
      const cy = r.y + r.h / 2;
      r.path = [b.anchor, [b.anchor[0], lane], [ex, lane], [ex, cy], [bx, cy]];
      return r;
    });
    const H = Math.max(H0, oy + (cols + rows - 2) * cw * 0.25 + d + 24, y + 12);
    const y0 = H - 20;
    const axis = mode === "often"
      ? { mode, x: 16, y0, span, log: true, title: "How often, log scale", ticks: TICKS.map((v) => ({ n: v, y: y0 - span * axisFrac(v), text: v === FLOOR_N ? "1 in " + v + " (floor)" : "1 in " + v })) }
      : { mode, x: 16, y0, span: 2 * unit, log: false, title: null, ticks: [{ v: 2, y: y0 - unit, text: "2 IV-days" }] };
    return {
      W, H, mode, cols, rows, cw, unit, span, axis, callouts,
      items: items.sort((a, b) => a.order - b.order || a.gx - b.gx),
      labels: callouts.map((c) => ({ id: c.t, x: c.x, y: c.y, w: c.w, h: c.h })),
      leaders: callouts.map((c) => ({ id: c.t, path: c.path })),
      solids: items.map((it) => ({ id: it.t, poly: it.poly })),
    };
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
    for (const c of kids) if (c !== null && c !== undefined) n.append(c);
    return n;
  }

  function paint(canvas, sc) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(sc.W * dpr);
    canvas.height = Math.round(sc.H * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, sc.W, sc.H);
    const cs = getComputedStyle(canvas);
    const tok = (k, d) => cs.getPropertyValue(k).trim() || d;
    const up = tok("--up-mark", "#24ae56");
    const down = tok("--down-mark", "#e54c4a");
    const ink = tok("--label-3", "#8a93a6");
    const strong = tok("--label-1", "#f5f5f7");
    const body = tok("--label-2", "#b4b9c6");
    const surface = tok("--surface-2", "#131722");
    const edge = tok("--sep-strong", "#3a4050");
    const ax = sc.axis;
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ax.x, ax.y0);
    g.lineTo(ax.x, ax.y0 - ax.span);
    g.stroke();
    g.font = FONT;
    if (ax.log) {
      g.lineWidth = 1;
      for (const t of ax.ticks) {
        g.beginPath();
        g.moveTo(ax.x, t.y);
        g.lineTo(ax.x + 6, t.y);
        g.stroke();
        g.fillText(t.text, ax.x + 10, t.y + 4);
      }
      g.fillText(ax.title, ax.x, ax.y0 - ax.span - 12);
    } else {
      for (const t of ax.ticks) g.fillText(t.text, 24, t.y);
    }
    for (const it of sc.items) {
      const c = it.dir > 0 ? up : down;
      const hw = it.w, d = hw * 0.5;
      g.fillStyle = c;
      g.globalAlpha = it.event ? 0.45 : 0.9;
      g.beginPath();
      g.moveTo(it.x - hw, it.yb);
      g.lineTo(it.x - hw, it.yt);
      g.lineTo(it.x, it.yt + d);
      g.lineTo(it.x, it.yb + d);
      g.closePath();
      g.fill();
      g.globalAlpha = it.event ? 0.35 : 0.65;
      g.beginPath();
      g.moveTo(it.x + hw, it.yb);
      g.lineTo(it.x + hw, it.yt);
      g.lineTo(it.x, it.yt + d);
      g.lineTo(it.x, it.yb + d);
      g.closePath();
      g.fill();
      g.globalAlpha = it.event ? 0.6 : 1;
      g.beginPath();
      g.moveTo(it.x, it.yt - d);
      g.lineTo(it.x + hw, it.yt);
      g.lineTo(it.x, it.yt + d);
      g.lineTo(it.x - hw, it.yt);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = c;
      g.lineWidth = 1;
      if (it.event) {
        g.setLineDash([3, 3]);
        g.stroke();
        g.setLineDash([]);
      }
      if (it.floored) {
        g.strokeStyle = strong;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(it.x, it.yt - d);
        g.lineTo(it.x, it.yt - d - WHISK);
        g.moveTo(it.x - 4, it.yt - d - WHISK);
        g.lineTo(it.x + 4, it.yt - d - WHISK);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    for (const c of sc.callouts) {
      g.strokeStyle = ink;
      g.fillStyle = ink;
      g.lineWidth = 1;
      g.beginPath();
      c.path.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
      g.stroke();
      g.beginPath();
      g.arc(c.path[0][0], c.path[0][1], 2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = surface;
      g.strokeStyle = edge;
      g.fillRect(c.x, c.y, c.w, c.h);
      g.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1);
      g.font = FONT_HEAD;
      g.fillStyle = c.dir > 0 ? up : down;
      g.fillText(c.glyph, c.x + 8, c.y + 16);
      g.fillStyle = strong;
      g.fillText(c.head, c.x + 8 + g.measureText(c.glyph + " ").width, c.y + 16);
      g.font = FONT;
      g.fillStyle = body;
      c.lines.forEach((ln, i) => g.fillText(ln, c.x + 8, c.y + HEAD_H + 10 + i * LINE_H));
    }
  }

  function table(md, mode) {
    const order = mode === "often"
      ? (a, b) => (b.often ? b.often.n : 0) - (a.often ? a.often.n : 0) || byHeight(a, b)
      : byHeight;
    const body = md.prisms.slice().sort(order).map((p) => el("tr", { "data-t": p.t, "data-dir": p.dir > 0 ? "up" : p.dir < 0 ? "down" : "flat" },
      el("th", { scope: "row" }, p.t), el("td", null, p.sector || DASH), el("td", null, pc(p.chg)),
      el("td", null, f1(p.m)), el("td", null, glyphOf(p) + " " + dirWord(p)),
      el("td", { "data-c": "often" }, p.often ? p.often.short : DASH), el("td", null, p.why ? WHY_SHORT[p.why] : "")));
    return el("div", { class: "mk-tw" }, el("table", { class: "mk-tbl mk-sky-t" },
      el("caption", null, "Names that moved " + MIN + " IV-days or more, " + (mode === "often" ? "rarest first" : "largest first")),
      el("thead", null, el("tr", null, ...["Name", "Sector", "Change", "IV-days", "Direction", "How often", "Note"].map((x) => el("th", { scope: "col" }, x)))),
      el("tbody", null, ...body)));
  }

  function calloutTable(calls, mode) {
    const body = calls.map((p) => el("tr", { "data-t": p.t, "data-dir": p.dir > 0 ? "up" : p.dir < 0 ? "down" : "flat" },
      el("th", { scope: "row" }, p.t), el("td", null, glyphOf(p) + " " + dirWord(p)), el("td", null, f1(p.m)), el("td", { class: "mk-sky-s" }, sentence(p))));
    return el("div", { class: "mk-tw" }, el("table", { class: "mk-tbl mk-sky-co" },
      el("caption", null, "Called out in the picture: the three " + (mode === "often" ? "rarest" : "tallest")),
      el("thead", null, el("tr", null, ...["Name", "Direction", "IV-days", "This name's last year"].map((x) => el("th", { scope: "col" }, x)))),
      el("tbody", null, ...body)));
  }

  const NOTE = "Height is the move in IV-days, not a probability. Colour and the triangle give the direction. No selection line is drawn: no error rate has been measured.";
  const OFTEN_NOTE = "Height is how often this name had a day as far out as the 2x or 3x typical-day rung its move reached, over the last year, on a log scale from 1 in 2 to 1 in 250 sessions: higher is rarer. It counts past days and is not a forecast. Colour gives the direction. A line above a prism means rarer than the 1 in 250 floor.";
  const LINE = "A ranking, not a test: no error rate measured.";
  const CAPTION = "IV as of the previous close.";

  function absentNote(md) {
    const a = md.absent, parts = [];
    if (a.scale.length) parts.push("no typical-day move published: " + a.scale.join(", "));
    if (a.under.length) parts.push("under 2 typical days, below the lowest count published: " + a.under.join(", "));
    if (a.event.length) parts.push("earnings within 21 sessions, event not separated: " + a.event.join(", "));
    return "Drawn here: " + md.plotted + " of " + md.prisms.length + ". Shown in IV-days only" + (parts.length ? ", not here: " + parts.join("; ") : "") + ".";
  }

  function measurer() {
    const c = document.createElement("canvas").getContext("2d");
    return c ? (s, f) => { c.font = f; return c.measureText(s).width; } : null;
  }

  function mount(host, universe) {
    if (!host) return null;
    const md = model(universe);
    host.replaceChildren();
    host.dataset.state = !md ? "pending" : md.prisms.length ? "ok" : "quiet";
    if (!md) {
      host.append(el("p", { class: "mk-sky-n", "data-empty": "pending" }, "The skyline needs the nightly universe with each name's previous-close implied volatility; it has not published."));
      return { model: null };
    }
    if (!md.prisms.length) {
      host.append(el("p", { class: "mk-sky-n", "data-empty": "quiet" }, "No name moved " + MIN + " IV-days or more. That is a reading, not a forecast."), el("p", { class: "mk-sky-n" }, CAPTION));
      return { model: md };
    }
    let mode = "ivdays";
    let sc = null;
    const measure = measurer() || undefined;
    const canvas = el("canvas", { class: "mk-sky-c", role: "img" });
    const tables = el("div", { class: "mk-sky-tb" });
    const details = el("details", { class: "mk-sky-d" }, el("summary", null, "Table of the " + md.prisms.length + " names"), tables);
    const bar = el("div", { class: "mk-sky-seg" });
    const callBox = el("div", { class: "mk-sky-cb" });
    const dlg = el("dialog", { class: "nm-dlg", "aria-labelledby": "mkSkyDlgT" });
    const moreBtn = el("button", { type: "button", class: "nm-link", "aria-haspopup": "dialog" }, "Show all " + md.prisms.length + " names");
    moreBtn.addEventListener("click", () => {
      const close = el("button", { type: "button", class: "nm-link" }, "Close");
      close.addEventListener("click", () => dlg.close());
      dlg.replaceChildren(el("div", { class: "nm-dg" }, el("h3", { id: "mkSkyDlgT" }, md.prisms.length + " names that moved " + MIN + " IV-days or more"), el("div", { class: "nm-dtw" }, table(md, mode)), el("div", { class: "nm-dx" }, close)));
      if (typeof dlg.showModal === "function") dlg.showModal();
    });
    const noteA = el("p", { class: "mk-sky-n", "aria-live": "polite" });
    const noteB = el("p", { class: "mk-sky-n", "data-note": "absent" });
    const noteC = el("p", { class: "mk-sky-n" });
    const off = md.plotted === 0;
    let filled = "";

    const label = () => {
      const top = md.prisms.slice().sort(byHeight)[0];
      const calls = ranked(shown(md, mode), mode);
      const said = calls.map((p) => p.t + ", " + dirWord(p) + " " + p.h.toFixed(1) + " IV-days" + (p.often ? ", " + p.often.short : "")).join("; ");
      return md.prisms.length + " names moved " + MIN + " IV-days or more among " + md.n + " priced names. " +
        (mode === "often" ? "Height shows how often a day this far out came for the name over the last year, on a log scale. Called out, rarest first: " + said + "."
          : "The largest is " + top.t + ", " + dirWord(top) + " " + top.h.toFixed(1) + " IV-days. Called out, tallest first: " + said + ".") +
        " The tables below list them all.";
    };

    const render = () => {
      host.dataset.mode = mode;
      canvas.setAttribute("aria-label", label());
      noteA.textContent = mode === "often" ? OFTEN_NOTE : NOTE;
      const showAbsent = mode === "often" || off;
      noteB.hidden = !showAbsent;
      noteB.textContent = showAbsent ? (off ? "How often is off: none of these names has a published typical-day move with a 2x or 3x count to draw. " : "") + absentNote(md) : "";
      noteC.textContent = LINE + " " + CAPTION + (md.apart && mode === "ivdays" ? " Hatched prisms: " + APART : "");
      filled = "";
      draw();
    };

    const draw = () => {
      const W = Math.max(280, Math.floor(host.clientWidth));
      const on = W >= NARROW;
      canvas.hidden = !on;
      details.hidden = !on;
      callBox.hidden = on;
      moreBtn.hidden = on;
      const key = mode + (on ? "w" : "n");
      if (key !== filled) {
        filled = key;
        if (on) {
          tables.replaceChildren(calloutTable(ranked(shown(md, mode), mode), mode), table(md, mode));
          callBox.replaceChildren();
        } else {
          tables.replaceChildren();
          callBox.replaceChildren(calloutTable(ranked(shown(md, mode), mode), mode));
        }
      }
      if (!on) { sc = null; return; }
      sc = layout(md, W, host.closest(".mk-panel") ? Math.max(240, Math.min(560, Math.floor(host.clientHeight) - 150)) : 360, { mode, measure });
      canvas.style.width = W + "px";
      canvas.style.height = sc.H + "px";
      paint(canvas, sc);
    };

    const UI = window.FlowsUI;
    if (UI && typeof UI.segmented === "function") {
      bar.append(UI.segmented("Height shows", [
        { label: "IV-days" },
        { label: "How often", disabled: off, title: off ? "No name has a published typical-day move with a count to draw." : null },
      ], (i) => { mode = i === 1 ? "often" : "ivdays"; render(); }));
    }

    host.append(bar, canvas, callBox, moreBtn, details, el("details", { class: "mk-sky-nd" }, el("summary", null, "Notes and what the picture is not"), noteA, noteB, noteC), dlg);
    render();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(host);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    return { model: md, scene: () => sc, mode: () => mode };
  }

  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { skyline: Object.freeze({ model, layout, mount }) }));
})();
