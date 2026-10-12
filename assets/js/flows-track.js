(() => {
  "use strict";

  const UI = window.FlowsUI;
  const statusEl = document.getElementById("stStatus");
  const app = document.getElementById("stTrack");
  const basisBtn = document.getElementById("stBasis");
  if (!statusEl || !app) return;
  if (!UI) {
    statusEl.textContent = "This page's UI module (flows-ui.js) did not load, so nothing can be drawn. Refresh to try again.";
    return;
  }

  const { h, s, F, chart: C } = UI;
  const MINUS = UI.MINUS, DASH = UI.DASH, MID = UI.MID;
  const isNum = UI.isNum;
  const plural = (n, one, many) => (n === 1 ? one : many);
  const sessionsSaid = (n) => n + plural(n, " session", " sessions");
  const signed = (v) => (v === null || v === undefined ? DASH : F.signed(v));
  const pct = (v, d = 1) => F.pct(v, d, true);
  const PAGE = window.matchMedia && window.matchMedia("(min-width: 1200px)").matches ? 80 : 24;
  const HORIZONS = [1, 5, 10];
  const HZ_WORD = { 1: "one session", 5: "five sessions", 10: "ten sessions" };
  const hzSaid = (k) => HZ_WORD[k] || sessionsSaid(k);
  const STATE_WORD = { loading: "Loading", quiet: "Quiet", partial: "Partial", pending: "Pending", stale: "Stale", withheld: "Withheld", unavailable: "Unavailable" };
  const RETURN_STEPS = [0.005, 0.01, 0.02, 0.025, 0.03, 0.04, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 1];

  const state = { q: "", sort: "now", shown: PAGE, t: null, k: 5 };
  let ctx = null;
  const cards = new Map();
  const ideas = { phase: "loading", c: null };

  function silence(kind, text) {
    const word = STATE_WORD[kind] ? kind : "unavailable";
    return h("p", { class: "st-sil", "data-s": word, role: "note" },
      h("span", { class: "ds-st", "data-s": word }, h("i", { "aria-hidden": "true" }), STATE_WORD[word]),
      h("span", { class: "st-sil-t" }, text));
  }
  function loading(text) {
    return h("div", { class: "st-sk", "aria-busy": "true" }, silence("loading", text), h("span", { class: "ds-sk", style: { width: "72%" } }), h("span", { class: "ds-sk", style: { width: "48%" } }), h("span", { class: "ds-sk", style: { width: "60%" } }));
  }
  const signedN = (v, text) => h("span", { class: "ds-sg", "data-dir": v > 0 ? "up" : v < 0 ? "down" : "flat" }, h("i", { "aria-hidden": "true" }), text);
  function fig(o) {
    return h("div", { class: "st-fig" + (o.minor ? " is-minor" : ""), "data-fig": o.id },
      h("span", { class: "st-fig-n", "data-tone": o.tone || null }, o.n, o.of ? h("span", { class: "st-fig-of" }, " of " + o.of) : null),
      h("span", { class: "st-fig-u" }, o.unit),
      o.sub ? h("span", { class: "st-fig-d" }, o.sub) : null);
  }
  const what = (text, id) => h("p", { class: "st-what", id: id || null }, text);
  const caption = (id, max, ...parts) => h("p", { class: "st-cap", "data-cap": id, "data-max": max === null ? null : String(max) }, parts.filter(Boolean).map((p) => h("span", null, p)));
  const fact = (label, value, id) => h("div", { "data-fact": id }, h("dt", null, label), h("dd", null, value));
  const bold = (v, tone) => h("b", { "data-tone": tone || null }, v);
  function niceReturn(v) {
    for (const step of RETURN_STEPS) if (step >= v * 1.05) return step;
    return Math.ceil(v * 1.05 * 10) / 10;
  }

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } }).then((r) => {
      if (r.status === 401) { location.replace("/flows/"); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  const CROSS_RANK = { cleared: 0, flipped: 1, faded: 2 };
  const CROSS_SAID = {
    cleared: "Inside the dead band at the previous scored session and outside it now: the name became actionable this session. This is the early warning; everything the change layer reports other than a crossing is drift.",
    faded: "Outside the dead band and inside it now — the exit signal, and exactly as load-bearing as the entry.",
    flipped: "Outside the band at both ends with opposite signs: the name did not weaken and re-strengthen, it changed sides without resting in the middle.",
  };

  const DRIFT_SAID = "The name did not change category: it sat on the same side of the dead band at both ends of the comparison. Drift, however large.";
  const HELD_SAID = "This name was scored on both sessions and its score did not change. A held score is a measurement of the session, not a missing one.";

  function readMove(raw) {
    if (!raw || typeof raw !== "object") return null;
    const v = isNum(raw.v), gap = isNum(raw.gap);
    if (v === null || gap === null || gap < 1) return null;
    return { v, gap, qv: isNum(raw.qv), cross: Object.prototype.hasOwnProperty.call(CROSS_RANK, raw.cross) ? raw.cross : null };
  }
  function readExt(raw) {
    if (!raw || typeof raw !== "object") return null;
    const hi = isNum(raw.hi), lo = isNum(raw.lo);
    if (hi === null && lo === null) return null;
    return { hi, lo, hiAt: isNum(raw.hiAt), loAt: isNum(raw.loAt) };
  }
  function nearestExtreme(last, ext) {
    if (last === null || !ext) return null;
    const toHi = ext.hi === null ? null : ext.hi - last;
    const toLo = ext.lo === null ? null : last - ext.lo;
    if (toHi === null) return toLo;
    if (toLo === null) return toHi;
    return Math.min(toHi, toLo);
  }

  function prepare(payload) {
    const sessions = (Array.isArray(payload.sessions) ? payload.sessions : []).map((x) => ({
      d: x && typeof x.d === "string" ? x.d : "",
      source: x && x.source === "scores" ? "scores" : "boards",
      preEpoch: !!(x && x.preEpoch),
      names: x ? isNum(x.names) : null,
    }));
    const lastIndex = sessions.length - 1;
    const rows = [];
    for (const r of Array.isArray(payload.names) ? payload.names : []) {
      if (!r || typeof r.t !== "string" || !r.t) continue;
      const last = isNum(r.last), lastAt = isNum(r.lastAt), ext = readExt(r.ext);
      rows.push({
        t: r.t, s: Array.isArray(r.s) ? r.s.map(isNum) : [], n: isNum(r.n), last, lastAt,
        staleBy: lastAt === null || lastIndex < 0 ? null : lastIndex - lastAt,
        now: lastAt !== null && lastAt === lastIndex ? last : null,
        d1: readMove(r.d1), run: isNum(r.run), ext, extGap: nearestExtreme(last, ext),
      });
    }
    const pre = sessions.map((x) => x.preEpoch);
    let boundary = null;
    if (pre.some(Boolean) && pre.some((x) => !x)) {
      const i = pre.findIndex((x) => !x);
      if (i > 0) boundary = i;
    }
    let top = 1;
    for (const r of rows) for (const v of r.s) if (v !== null && Math.abs(v) > top) top = Math.abs(v);
    return {
      sessions, rows, boundary, top: Math.max(top, isNum(payload.deadBand) || 0),
      deadBand: isNum(payload.deadBand),
      epoch: typeof payload.epoch === "string" ? payload.epoch : null,
      change: payload.change && typeof payload.change === "object" ? payload.change : null,
      shedBy: typeof payload.shedBy === "string" ? payload.shedBy : null,
      shed: isNum(payload.namesShed),
      notes: payload.notes && typeof payload.notes === "object" ? payload.notes : {},
      allPre: sessions.length > 0 && pre.every(Boolean),
      allPost: sessions.length > 0 && pre.every((x) => !x),
      has: {
        now: rows.some((r) => r.lastAt !== null), nowScore: rows.some((r) => r.now !== null),
        move: rows.some((r) => r.d1 !== null), run: rows.some((r) => r.run !== null),
      },
    };
  }

  const descNum = (x, y) => (x === null ? (y === null ? 0 : 1) : y === null ? -1 : y - x);
  const ascNum = (x, y) => (x === null ? (y === null ? 0 : 1) : y === null ? -1 : x - y);
  const mag = (v) => (v === null ? null : Math.abs(v));
  const byTicker = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  const tie = (a, b) => descNum(a.n, b.n) || byTicker(a, b);
  const SORTS = {
    now: (a, b) => descNum(mag(a.now), mag(b.now)) || tie(a, b),
    abs: (a, b) => descNum(mag(a.last), mag(b.last)) || tie(a, b),
    move: (a, b) => descNum(a.d1 ? Math.abs(a.d1.v) : null, b.d1 ? Math.abs(b.d1.v) : null) || tie(a, b),
    cross: (a, b) => ascNum(a.d1 && a.d1.cross ? CROSS_RANK[a.d1.cross] : null, b.d1 && b.d1.cross ? CROSS_RANK[b.d1.cross] : null) ||
      descNum(a.d1 ? Math.abs(a.d1.v) : null, b.d1 ? Math.abs(b.d1.v) : null) || tie(a, b),
    run: (a, b) => descNum(a.run, b.run) || tie(a, b),
    ext: (a, b) => ascNum(a.extGap, b.extGap) || descNum(mag(a.last), mag(b.last)) || tie(a, b),
  };
  const SORT_WORDS = {
    now: "strongest score in the latest session first, names not scored in it last",
    abs: "strongest last measured score first, however long ago it was measured",
    move: "biggest move since each name's previous scored session, either direction",
    cross: "names that crossed the dead band first — cleared, then flipped, then faded",
    run: "longest unbroken run on one sign first",
    ext: "nearest its own window high or low first",
  };

  function filtered() {
    const q = state.q.trim().toUpperCase();
    const list = q ? ctx.rows.filter((r) => r.t.toUpperCase().indexOf(q) !== -1) : ctx.rows.slice();
    list.sort(SORTS[state.sort] || SORTS.abs);
    return list;
  }

  function strip(values, band, top) {
    const W = 92, H = 28, N = Math.max(1, values.length);
    const svg = s("svg", { class: "st-strip", width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
    const bw = Math.max(1.5, (W / N) * 0.62), mid = H / 2;
    const max = Math.max(1, top);
    s("line", { x1: 0, x2: W, y1: mid, y2: mid, class: "st-zero" }, svg);
    values.forEach((v, i) => {
      const x = (W / N) * (i + 0.5);
      if (v === null) { s("circle", { cx: x, cy: mid, r: 1, class: "st-gap" }, svg); return; }
      const hh = Math.max(1, (Math.abs(v) / max) * (mid - 1));
      const inside = band !== null && Math.abs(v) <= band;
      s("rect", { x: x - bw / 2, y: v > 0 ? mid - hh : v < 0 ? mid : mid - hh / 2, width: bw, height: hh, rx: 0.8, class: inside || v === 0 ? "st-in" : v > 0 ? "st-pos" : "st-neg" }, svg);
    });
    return svg;
  }

  function stripSaid(r) {
    const S = ctx.sessions.length;
    const said = [r.t + " " + MID + " scored " + (r.n === null ? "an unstated number of the " + S + " sessions" : r.n + " of " + S + " " + plural(S, "session", "sessions") + (r.n < S ? ", and the empty stretches are sessions it was not scored, never zeros" : ""))];
    said.push("last " + signed(r.last) + (r.staleBy ? ", " + sessionsSaid(r.staleBy) + " before the latest session" : ""));
    if (r.run !== null) said.push(r.run === 0 ? "the newest score is exactly zero, which belongs to neither side" : sessionsSaid(r.run) + " in a row on that sign");
    return said.join(" " + MID + " ");
  }

  let listHost = null, moreBtn = null, capEl = null;
  function renderList(append) {
    const list = filtered();
    const already = append ? listHost.children.length : 0;
    if (!append) listHost.replaceChildren();
    if (!list.length) {
      listHost.append(h("p", { class: "flows-empty st-empty", "data-empty": "quiet" }, state.q.trim()
        ? "No name matches “" + state.q.trim() + "”."
        : "No name to draw."));
    }
    const upto = Math.min(state.shown, list.length);
    const frag = document.createDocumentFragment();
    for (let i = already; i < upto; i++) {
      const r = list[i];
      const tone = r.last === null ? "silent" : UI.tone(r.last);
      const b = h("button", {
        type: "button", class: "st-row", "data-t": r.t, "aria-pressed": String(r.t === state.t), title: stripSaid(r),
        onclick: () => select(r.t, true),
      },
      h("span", { class: "st-t" }, h("b", null, r.t), r.staleBy ? h("span", { class: "st-old" }, r.staleBy + "d") : null),
      strip(r.s, ctx.deadBand, ctx.top),
      h("span", { class: "st-v", "data-tone": tone }, signed(r.last)),
      h("span", { class: "st-d" + (r.d1 && r.d1.cross ? " is-" + r.d1.cross : ""), "data-tone": r.d1 ? UI.tone(r.d1.v) : "silent" }, r.d1 ? signed(r.d1.v) : DASH));
      frag.append(h("div", { class: "st-li", role: "listitem" }, b));
    }
    listHost.append(frag);
    const q = state.q.trim();
    capEl.textContent = (q ? upto + " of " + list.length + " matching “" + q + "”, of " + ctx.rows.length : upto + " of " + ctx.rows.length + " " + plural(ctx.rows.length, "name", "names")) + ", " + SORT_WORDS[state.sort] + ".";
    moreBtn.hidden = list.length <= upto;
    moreBtn.textContent = "Show " + Math.min(PAGE, list.length - upto) + " more";
  }

  function namesInfo(keys, labels) {
    return {
      title: "Score track per name",
      lead: "Every name the track carries, one row each: its score session by session, oldest on the left, then its last measured score and its change since its previous scored session.",
      sections: [{ title: "Order", lines: keys.map((k) => labels[k] + ": " + SORT_WORDS[k] + ".") }, { title: "Strip", lines: [noteSaid()] }],
    };
  }

  function namesPane() {
    const input = h("input", { class: "st-q", type: "search", placeholder: "Ticker", "aria-label": "Filter names", autocomplete: "off", spellcheck: "false", id: "stQ" });
    input.addEventListener("input", () => { state.q = input.value; state.shown = PAGE; renderList(false); });
    const first = ctx.has.nowScore ? "now" : "abs";
    const keys = [first, ctx.has.move ? "move" : null, ctx.has.move ? "cross" : null, ctx.has.run ? "run" : null].filter(Boolean);
    const labels = { now: "Now", abs: "Last", move: "Move", cross: "Cross", run: "Run" };
    const seg = UI.segmented("Order names", keys.map((k) => ({ label: labels[k], title: SORT_WORDS[k] })), (i) => {
      state.sort = keys[i]; state.shown = PAGE; renderList(false);
    }, Math.max(0, keys.indexOf(state.sort)));
    listHost = h("div", { class: "st-list", role: "list", "aria-label": "Names by score track" });
    capEl = h("p", { class: "visually-hidden", id: "stCaption", "aria-live": "polite" });
    moreBtn = h("button", { class: "ui-disclose st-more", type: "button", hidden: true, onclick: () => { state.shown += PAGE; renderList(true); } });
    const head = h("div", { class: "st-cols", "aria-hidden": "true" }, h("span", null, "Name"), h("span", null, sessionsSaid(ctx.sessions.length)), h("span", null, "Last"), h("span", null, "Δ"));
    state.sort = keys.indexOf(state.sort) >= 0 ? state.sort : first;
    detail.namesInfo = () => namesInfo(keys, labels);
    return h("div", { class: "st-names", id: "stNames" }, h("div", { class: "st-tools" }, input, seg), head, listHost, moreBtn, capEl);
  }

  function closesOf(card) {
    const out = new Map();
    const p = card && card.panels && typeof card.panels === "object" ? card.panels : {};
    const cx = p.context && typeof p.context === "object" ? p.context : null;
    if (cx && Array.isArray(cx.candles)) {
      const keys = Array.isArray(cx.candleKeys) ? cx.candleKeys : ["date", "open", "high", "low", "close", "volume"];
      const di = keys.indexOf("date"), ci = keys.indexOf("close");
      for (const c of cx.candles) {
        if (!Array.isArray(c)) continue;
        const v = isNum(c[ci]);
        if (typeof c[di] === "string" && v !== null) out.set(c[di].slice(0, 10), v);
      }
    }
    if (cx && Array.isArray(cx.closes) && Array.isArray(cx.closeDates)) {
      cx.closeDates.forEach((d, i) => { const v = isNum(cx.closes[i]); if (typeof d === "string" && v !== null && !out.has(d.slice(0, 10))) out.set(d.slice(0, 10), v); });
    }
    const so = p.scoreOverlay;
    if (so && Array.isArray(so.rows)) for (const r of so.rows) { const v = isNum(r && r.close); if (r && typeof r.d === "string" && v !== null && !out.has(r.d)) out.set(r.d, v); }
    return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, c]) => ({ d, c }));
  }

  function outcomes(r, closes, k) {
    const idx = new Map(closes.map((c, i) => [c.d, i]));
    const band = ctx.deadBand || 0;
    const calls = [], points = [];
    ctx.sessions.forEach((x, i) => {
      const v = r.s[i];
      if (v === null || v === undefined) return;
      const j = idx.get(x.d);
      let ret = null, stateOf = "open";
      if (j === undefined) stateOf = "lost";
      else if (j + k < closes.length) { ret = closes[j + k].c / closes[j].c - 1; stateOf = "closed"; }
      const call = Math.abs(v) > band;
      if (ret !== null) points.push({ x: v, y: ret, d: x.d, call, hit: call ? Math.sign(v) * ret > 0 : null });
      if (call) calls.push({ d: x.d, v, ret, sr: ret === null ? null : Math.sign(v) * ret, state: stateOf });
    });
    const closed = calls.filter((c) => c.sr !== null);
    const hits = closed.filter((c) => c.sr > 0).length;
    const mean = closed.length ? closed.reduce((a, c) => a + c.sr, 0) / closed.length : null;
    return { calls, closed, hits, mean, points, open: calls.filter((c) => c.state === "open").length, lost: calls.filter((c) => c.state === "lost").length };
  }

  function wilson(p, n) {
    if (p === null || !(n > 0)) return null;
    const z = 1.96, z2 = z * z, d = 1 + z2 / n;
    const c = (p + z2 / (2 * n)) / d;
    const m = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d;
    return [Math.max(0, c - m), Math.min(1, c + m)];
  }
  function spearman(pts) {
    const n = pts.length;
    if (n < 3) return null;
    const rank = (arr) => {
      const o = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      const r = new Array(n);
      for (let i = 0; i < n;) {
        let j = i;
        while (j + 1 < n && o[j + 1][0] === o[i][0]) j++;
        for (let q = i; q <= j; q++) r[o[q][1]] = (i + j) / 2;
        i = j + 1;
      }
      return r;
    };
    const rx = rank(pts.map((p) => p.x)), ry = rank(pts.map((p) => p.y));
    const mx = (n - 1) / 2;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - mx); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - mx) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }

  function trackChart(host, r, closes) {
    const cmap = new Map(closes.map((c) => [c.d, c.c]));
    const S = ctx.sessions;
    const px = S.map((x) => (cmap.has(x.d) ? cmap.get(x.d) : null));
    const hasPx = px.some((v) => v !== null);
    return C.mount(host, (el, w, animate) => {
      const H = w < 600 ? 250 : w < 900 ? 280 : 300;
      const top = 14, bot = 24, left = 4, right = w < 600 ? 54 : 62;
      const N = S.length;
      const band = (w - left - right) / Math.max(1, N);
      const xAt = (i) => left + band * (i + 0.5);
      const split = hasPx ? top + (H - top - bot) * 0.48 : top;
      const sTop = hasPx ? split + 16 : top, sBot = H - bot;
      const svg = C.svgRoot(el, w, H, animate, r.t + " score by session" + (hasPx ? ", with the close above it" : ""));
      S.forEach((x, i) => { if (x.source === "boards") s("rect", { x: xAt(i) - band / 2, y: sTop - 4, width: band, height: sBot - sTop + 4, class: "st-wash" }, svg); });
      if (ctx.boundary !== null) {
        const bx = xAt(ctx.boundary) - band / 2;
        s("line", { x1: bx, x2: bx, y1: top, y2: sBot, class: "st-erule" }, svg);
      }
      const max = ctx.top;
      const mid = (sTop + sBot) / 2, half = (sBot - sTop) / 2 - 1;
      const sy = (v) => mid - (v / max) * half;
      if (ctx.deadBand) s("rect", { x: left, y: sy(ctx.deadBand), width: w - left - right, height: Math.max(1, sy(-ctx.deadBand) - sy(ctx.deadBand)), class: "st-band" }, svg);
      s("line", { x1: left, x2: w - right, y1: mid, y2: mid, class: "base" }, svg);
      const bw = Math.max(3, Math.min(16, band * 0.58));
      r.s.forEach((v, i) => {
        const x = xAt(i);
        if (v === null) { s("circle", { cx: x, cy: mid, r: 1.6, class: "st-gap" }, svg); return; }
        const hh = Math.max(1.5, Math.abs(sy(v) - mid));
        const inside = ctx.deadBand !== null && Math.abs(v) <= ctx.deadBand;
        s("rect", { x: x - bw / 2, y: v > 0 ? mid - hh : v < 0 ? mid : mid - hh / 2, width: bw, height: hh, rx: Math.min(3, bw / 2), class: "grow " + (inside || v === 0 ? "st-in" : v > 0 ? "st-pos" : "st-neg"), style: { "--i": String(i * 2), "--origin": v > 0 ? "bottom" : v < 0 ? "top" : "center" } }, svg);
      });
      const li = r.s.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
      const tags = [];
      if (li !== undefined) tags.push({ y: sy(r.s[li]), y0: sy(r.s[li]), x0: xAt(li), text: signed(r.s[li]), cls: "tx-1 tx-b" });
      let py = null;
      if (hasPx) {
        const pv = px.filter((v) => v !== null);
        let p0 = Math.min(...pv), p1 = Math.max(...pv);
        const pad = (p1 - p0) * 0.1 || p1 * 0.02 || 1;
        p0 -= pad; p1 += pad;
        py = C.lin(p0, p1, split, top);
        const segs = [];
        let cur = [];
        px.forEach((v, i) => { if (v === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([xAt(i), py(v)]); });
        if (cur.length) segs.push(cur);
        const color = UI.cssVar("--accent");
        for (const seg of segs) {
          if (seg.length < 2) { s("circle", { cx: seg[0][0], cy: seg[0][1], r: 1.6, fill: color }, svg); continue; }
          const d = C.monoPath(seg);
          s("path", { d: d + `L${seg[seg.length - 1][0].toFixed(1)} ${split}L${seg[0][0].toFixed(1)} ${split}Z`, fill: C.vGrad(svg, color, 0.16, 0), class: "fade" }, svg);
          s("path", { d, class: "ln draw", stroke: color, pathLength: 1 }, svg);
        }
        const pl = px.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
        if (pl !== undefined) {
          s("circle", { cx: xAt(pl), cy: py(px[pl]), r: 3.5, fill: color, class: "ring" }, svg);
          tags.push({ y: py(px[pl]), y0: py(px[pl]), x0: xAt(pl), text: F.px(px[pl]), cls: "tx-1 tx-b" });
          const hiP = Math.max(...pv), loP = Math.min(...pv);
          for (const v of [hiP, loP]) {
            if (Math.abs(py(v) - py(px[pl])) < 18 || (v === loP && F.px(loP) === F.px(hiP))) continue;
            tags.push({ y: py(v), y0: py(v), x0: w - right, text: F.px(v), cls: "tx-3" });
          }
        }
        s("line", { x1: left, x2: w - right, y1: split, y2: split, class: "hair" }, svg);
      }
      C.spread(tags, 16, top, H - bot);
      for (const t of tags) {
        if (Math.abs(t.y - t.y0) > 2) s("path", { d: `M${(t.x0 + 5).toFixed(1)} ${t.y0.toFixed(1)}L${(w - right + 5).toFixed(1)} ${t.y.toFixed(1)}`, class: "st-lead" }, svg);
        s("text", { x: w - right + 8, y: t.y + 3.8, text: t.text, class: t.cls }, svg);
      }
      const every = Math.max(1, Math.ceil(N / (w < 600 ? 4 : 7)));
      S.forEach((x, i) => {
        if ((N - 1 - i) % every !== 0) return;
        s("text", { x: xAt(i), y: H - 6, text: F.day(x.d), "text-anchor": "middle", class: i === N - 1 ? "tx-1" : null }, svg);
      });
      C.scrub(el, svg, {
        xs: S.map((_, i) => xAt(i)), top, bottom: sBot, label: r.t + " score track",
        onMove: (i) => {
          const v = r.s[i];
          const parts = [C.part(F.day(S[i].d), "k"), v === null ? C.part("not scored", "k") : h("b", { "data-tone": UI.tone(v, ctx.deadBand || 0) }, signed(v))];
          if (px[i] !== null) parts.push(C.part(F.px(px[i]), "k"));
          if (S[i].source === "boards") parts.push(C.part("board-only", "k"));
          const dots = [];
          if (v !== null) dots.push({ x: xAt(i), y: sy(v), color: v > 0 ? "--up" : v < 0 ? "--down" : "--label-3" });
          if (py && px[i] !== null) dots.push({ x: xAt(i), y: py(px[i]), color: "--accent" });
          return { parts, dots };
        },
      });
    });
  }

  function calibChart(host, pts, k, R) {
    return C.mount(host, (el, w, animate) => {
      const H = w < 600 ? 220 : 240;
      const top = 12, bot = 24, left = 4, right = 52;
      const xm = ctx.top, ym = R;
      const x = C.lin(-xm, xm, left, w - right), y = C.lin(-ym, ym, H - bot, top);
      const svg = C.svgRoot(el, w, H, animate, "Score against the return " + k + " sessions later, one point per scored session");
      s("rect", { x: x(0), y: top, width: w - right - x(0), height: y(0) - top, class: "sc-q" }, svg);
      s("rect", { x: left, y: y(0), width: x(0) - left, height: H - bot - y(0), class: "sc-q" }, svg);
      if (ctx.deadBand) s("rect", { x: x(-ctx.deadBand), y: top, width: Math.max(1, x(ctx.deadBand) - x(-ctx.deadBand)), height: H - bot - top, class: "st-band" }, svg);
      s("line", { x1: left, x2: w - right, y1: y(0), y2: y(0), class: "base" }, svg);
      s("line", { x1: x(0), x2: x(0), y1: top, y2: H - bot, class: "base" }, svg);
      const n = pts.length;
      const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
      const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
      const beta = sxx ? pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx : null;
      if (beta !== null) {
        const a = my - beta * mx;
        let xa = -xm * 0.95, xb = xm * 0.95;
        if (beta !== 0) {
          const xAtY = (v) => (v - a) / beta;
          const lo = Math.min(xAtY(-ym), xAtY(ym)), hi = Math.max(xAtY(-ym), xAtY(ym));
          xa = Math.max(xa, lo); xb = Math.min(xb, hi);
        }
        if (xb > xa) s("line", { x1: x(xa), x2: x(xb), y1: y(a + beta * xa), y2: y(a + beta * xb), class: "sc-fit draw", pathLength: 1 }, svg);
      }
      const sorted = pts.slice().sort((a, b) => a.x - b.x);
      sorted.forEach((p, i) => s("circle", { cx: x(p.x), cy: y(p.y), r: 4, class: "sc-pt fade " + (p.hit === null ? "is-in" : p.hit ? "is-hit" : "is-miss"), style: { "--delay": 200 + i * 25 + "ms" } }, svg));
      s("text", { x: w - right + 6, y: top + 4, text: pct(ym, ym < 0.1 ? 1 : 0), class: "tx-3" }, svg);
      s("text", { x: w - right + 6, y: H - bot + 4, text: pct(-ym, ym < 0.1 ? 1 : 0), class: "tx-3" }, svg);
      s("text", { x: x(-xm), y: H - 6, text: MINUS + xm, "text-anchor": "start" }, svg);
      s("text", { x: x(0), y: H - 6, text: "0", "text-anchor": "middle" }, svg);
      s("text", { x: x(xm), y: H - 6, text: "+" + xm, "text-anchor": "end" }, svg);
      C.scrub(el, svg, {
        xs: sorted.map((p) => x(p.x)), top, bottom: H - bot, label: "Calibration",
        onMove: (i) => {
          const p = sorted[i];
          return {
            parts: [C.part(F.day(p.d), "k"), h("b", { "data-tone": UI.tone(p.x) }, signed(p.x)), C.part(k + "d", "k"), h("b", { "data-tone": UI.tone(p.y) }, pct(p.y))],
            dots: [{ x: x(p.x), y: y(p.y), color: "--label-1" }], noLine: true, top: Math.max(0, y(p.y) - 44),
          };
        },
      });
    });
  }

  function hitMeter(p, n, k) {
    const naive = wilson(p, n);
    const eff = n / Math.max(1, k);
    const adj = eff >= 2 ? wilson(p, eff) : null;
    const at = (v) => (v * 100).toFixed(2) + "%";
    const track = h("div", { class: "st-meter", role: "img", "aria-label": "Hit rate " + F.pct(p, 0) + ", adjusted 95% interval " + (adj ? F.pct(adj[0], 0) + " to " + F.pct(adj[1], 0) : "unbounded: fewer than two independent windows") },
      h("i", { class: "st-m-half" }),
      adj ? h("i", { class: "st-m-wh", style: { left: at(adj[0]), right: "calc(100% - " + at(adj[1]) + ")" } }) : h("i", { class: "st-m-wh is-open" }),
      naive ? h("i", { class: "st-m-ci", style: { left: at(naive[0]), right: "calc(100% - " + at(naive[1]) + ")" } }) : null,
      h("i", { class: "st-m-dot" + (adj && (adj[0] > 0.5 || adj[1] < 0.5) ? " is-clear" : ""), "data-tone": p > 0.5 ? "up" : p < 0.5 ? "down" : null, style: { left: at(p) } }));
    return { node: h("div", { class: "st-meter-w" }, h("span", null, "0"), track, h("span", null, "100%")), naive, adj };
  }

  const detail = { name: null, what: null, callsBody: null, ideasBody: null, lede: null, note: null, prov: null, chart: null, scatter: null, rec: null, detOpen: false, nameInfo: null, callsInfo: null, ideasInfo: null, namesInfo: null };

  function sessionsOver() {
    const S = ctx.sessions.length;
    const from = F.day(ctx.sessions[0].d), to = F.day(ctx.sessions[S - 1].d);
    return (S === 1 ? "the one session" : "the " + S + " sessions") + (S > 1 && from !== DASH && to !== DASH ? " from " + from + " to " + to : "");
  }

  function leadSaid(r) {
    const over = sessionsOver();
    const k = state.k, rec = detail.rec;
    const scored = (r.n === null ? "an unstated number of " : r.n + " of ") + over;
    if (!rec || rec.t !== r.t || rec.status === "loading") return r.t + " was scored on " + scored + "; its closes are still loading, so no call is counted yet.";
    if (rec.status === "unavailable") return r.t + " was scored on " + scored + "; no closes are on hand for it, so none of its calls is scored.";
    if (rec.status === "quiet") return r.t + " made no call across " + over + ", so there is nothing to score.";
    const open = rec.o.open ? "; " + rec.o.open + (rec.o.open === 1 ? " is" : " are") + " still open" : "";
    const n = rec.o.closed.length;
    if (rec.status === "pending") return "No call on " + r.t + " has closed " + hzSaid(k) + " on yet, across " + over + open + ".";
    return r.t + " was right on " + rec.o.hits + " of " + n + plural(n, " call that has", " calls that have") + " closed " + hzSaid(k) + " on, across " + over + open + ".";
  }

  function ideasSaid() {
    if (ideas.phase === "pending") return "No idea has settled yet.";
    if (ideas.phase === "fail") return "The idea record could not be loaded.";
    if (ideas.phase !== "ok") return null;
    const c = ideas.c, n = isNum(c.n) === null ? 0 : c.n, nEff = isNum(c.nEff), needed = isNum(c.needed) === null ? 100 : c.needed;
    const head = n + plural(n, " idea has", " ideas have") + " settled";
    if (nEff === null) return head + ".";
    return head + "; effective n " + nEff.toFixed(1) + (nEff >= needed ? " clears" : " is short of") + " the " + needed + " needed to check the chances the engine stated.";
  }

  function paintLede() {
    const r = ctx && ctx.rows.find((x) => x.t === state.t);
    if (!r || !detail.lede) return;
    detail.lede.textContent = leadSaid(r);
    detail.note.textContent = [ideasSaid(), "A record of calls already made, gross of costs."].filter(Boolean).join(" ");
  }

  function paintName(r) {
    const host = detail.name;
    const card = cards.get(r.t);
    const closes = card && card.body ? closesOf(card.body) : [];
    const cross = r.d1 && r.d1.cross;
    const S = ctx.sessions.length;
    const day = (i) => (i !== null && ctx.sessions[i] ? F.day(ctx.sessions[i].d) : DASH);
    const hiOn = r.ext && r.ext.hiAt !== null && ctx.sessions[r.ext.hiAt] ? ctx.sessions[r.ext.hiAt].d : null;
    const loOn = r.ext && r.ext.loAt !== null && ctx.sessions[r.ext.loAt] ? ctx.sessions[r.ext.loAt].d : null;
    const scoredAt = r.s.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
    const fi = scoredAt[0], li = scoredAt[scoredAt.length - 1];
    const cmap = new Map(closes.map((c) => [c.d, c.c]));
    const pxAt = ctx.sessions.map((x, i) => (cmap.has(x.d) ? i : -1)).filter((i) => i >= 0);
    const p0 = pxAt[0], p1 = pxAt[pxAt.length - 1];
    detail.nameInfo = () => ({
      title: r.t, lead: stripSaid(r) + ".",
      facts: [["Last", signed(r.last)], ["Change", r.d1 ? signed(r.d1.v) + " over " + (r.d1.gap === 1 ? "one session" : sessionsSaid(r.d1.gap)) : DASH],
        ["Residual Δ", r.d1 && r.d1.qv !== null ? signed(r.d1.qv) + " × 10⁻⁴" : null], ["Window high", r.ext ? signed(r.ext.hi) + (hiOn ? " on " + hiOn : "") : null], ["Window low", r.ext ? signed(r.ext.lo) + (loOn ? " on " + loOn : "") : null]],
      notes: [card && card.body && closes.length ? "The close above the score is the name's daily close from its card, " + (card.body.sessionDate ? "session " + card.body.sessionDate : "undated") + "." : "No close series is on hand for this name, so only the score is drawn.", noteSaid(),
        r.d1 ? null : r.n !== null && r.n < 2 ? "This name was scored on fewer than two sessions in this window, so there is no previous score for it to have changed from. Absent, not zero." : "This payload published no move for this name, so no change can be stated for it. Absent, not zero.",
        r.run === null ? "This payload published no run length for this name." : null].filter(Boolean),
    });
    if (detail.chart && detail.chart.destroy) detail.chart.destroy();
    host.replaceChildren(
      h("div", { class: "st-name-h" },
        h("h3", { class: "st-name-t" }, h("a", { class: "st-open", href: "/flows/ticker/?t=" + encodeURIComponent(r.t), "aria-label": "Open " + r.t }, h("span", { class: "st-open-t" }, r.t), UI.glyph("next"))),
        h("div", { class: "ui-tags st-tags" },
          r.d1 ? h("button", { type: "button", class: "ui-tag st-ev", "data-tone": cross === "cleared" ? "up" : cross === "faded" ? "warn" : null, "aria-haspopup": "dialog", "aria-controls": "fxPop",
            "data-info": UI.info({ title: cross ? UI.cap(cross).replace(/\.$/, "") : r.d1.v === 0 ? "Held" : "Drift", lead: cross ? CROSS_SAID[cross] : r.d1.v === 0 ? HELD_SAID : DRIFT_SAID }) },
          cross ? UI.cap(cross).replace(/\.$/, "") : r.d1.v === 0 ? "Held" : "Drift") : null,
          r.ext && r.ext.hiAt !== null && r.ext.hiAt === r.lastAt ? UI.tag("At window high", { tone: "up" }) : null,
          r.ext && r.ext.loAt !== null && r.ext.loAt === r.lastAt ? UI.tag("At window low", { tone: "down" }) : null),
        UI.infoButton("this name", () => (detail.nameInfo ? detail.nameInfo() : { title: r.t }))),
      r.last === null
        ? silence("unavailable", "No last score was published for this name. Not measured — not zero.")
        : h("div", { class: "st-figs" }, fig({
          id: "last", n: signedN(r.last, signed(r.last)),
          unit: r.lastAt !== null && ctx.sessions[r.lastAt] ? "last score, " + day(r.lastAt) + (r.staleBy ? ", " + sessionsSaid(r.staleBy) + " old" : "") : "last score",
          sub: "scored on " + (r.n === null ? "an unstated number of " : r.n + " of ") + S + " " + plural(S, "session", "sessions"),
        })),
      h("dl", { class: "st-facts" },
        fact("Change", r.d1 ? signed(r.d1.v) + " over " + (r.d1.gap === 1 ? "one session" : sessionsSaid(r.d1.gap)) : DASH, "move"),
        fact("Run", r.run === null ? DASH : r.run + " " + plural(r.run, "session", "sessions") + " on one sign", "run"),
        fact("Range", r.ext ? "high " + signed(r.ext.hi) + " " + MID + " low " + signed(r.ext.lo) : DASH, "range")),
      h("div", { class: "st-chart", id: "stChart" }),
      caption("score-scale", ctx.top,
        ["Score scale ", bold(MINUS + ctx.top + " to +" + ctx.top), " points, the same on every strip and on this chart"],
        ctx.deadBand ? ["Dead band ±" + ctx.deadBand + " shaded"] : null),
      caption("score-ends", null,
        fi === undefined ? null : fi === li ? ["Only score, " + day(fi) + " ", bold(signed(r.s[fi]))] : ["First score, " + day(fi) + " ", bold(signed(r.s[fi]))],
        fi === undefined || fi === li ? null : ["Latest score, " + day(li) + " ", bold(signed(r.s[li]))],
        p0 === undefined ? null : p0 === p1 ? ["Close, " + day(p0) + " ", bold(F.px(cmap.get(ctx.sessions[p0].d)))] : ["Close, " + day(p0) + " ", bold(F.px(cmap.get(ctx.sessions[p0].d))), " to " + day(p1) + " ", bold(F.px(cmap.get(ctx.sessions[p1].d)))]),
      UI.legend([["--accent", "ln", "Close"], ["--up-mark", "", "Score +"], ["--down-mark", "", "Score " + MINUS], ["--label-4", "", "Dead band"], ctx.sessions.some((x) => x.source === "boards") ? ["--fill-2", "", "Board-only"] : null, ctx.boundary !== null ? ["--lvl-flip", "ln", "Rule change"] : null].filter(Boolean)));
    detail.chart = trackChart(host.querySelector("#stChart"), r, closes);
  }

  function callsWhat(k) {
    return "How often a score " + (ctx.deadBand ? "outside the ±" + ctx.deadBand + " dead band" : "other than zero") + " was followed, " + hzSaid(k) + " on, by a price move the same way.";
  }

  function paintCalls(r) {
    const card = cards.get(r.t);
    const host = detail.callsBody;
    const k = state.k;
    detail.what.textContent = callsWhat(k);
    detail.callsInfo = null;
    host.classList.remove("is-ok");
    if (detail.scatter && detail.scatter.destroy) detail.scatter.destroy();
    detail.scatter = null;
    const done = (status, o) => { detail.rec = { t: r.t, status, o: o || null }; paintLede(); };
    if (!card || card.pending) {
      host.replaceChildren(loading("Reading the closes for " + r.t + "."));
      done("loading");
      return;
    }
    const closes = card.body ? closesOf(card.body) : [];
    if (!closes.length) {
      host.replaceChildren(silence(card.state || "unavailable", card.reason || "No card for " + r.t + " is published this session, so its closes are not on hand and no call can be scored against what followed. The score track below is unaffected."));
      done("unavailable");
      return;
    }
    const o = outcomes(r, closes, k);
    const n = o.closed.length;
    const p = n ? o.hits / n : null;
    const meter = p === null ? null : hitMeter(p, n, k);
    const clear = !!(meter && meter.adj && (meter.adj[0] > 0.5 || meter.adj[1] < 0.5));
    const rho = spearman(o.points);
    const rangeSaid = meter && meter.adj ? "the adjusted 95% interval runs " + F.pct(meter.adj[0], 0) + " to " + F.pct(meter.adj[1], 0) : "the adjusted 95% interval is unbounded, because fewer than two independent windows have closed";
    detail.callsInfo = () => ({
      title: "Calls scored · " + k + "d",
      lead: "Every session that scored " + r.t + " outside the dead band is a call. Each call is scored by the close " + k + " sessions later against the close of the session it was made on, signed by the call's direction: a bullish score is right when the price rose.",
      facts: [["Calls", String(o.calls.length)], ["Closed", String(n)], ["Right", String(o.hits)], ["Open", String(o.open)], ["No close", String(o.lost)],
        ["Naive 95%", meter && meter.naive ? F.pct(meter.naive[0], 0) + " to " + F.pct(meter.naive[1], 0) : null],
        ["Adjusted 95%", meter && meter.adj ? F.pct(meter.adj[0], 0) + " to " + F.pct(meter.adj[1], 0) : meter ? "unbounded" : null],
        ["Spearman ρ", rho === null ? DASH : rho.toFixed(3)], ["Points", String(o.points.length)]],
      sections: [{ title: "Intervals", lines: [
        "The thick capsule is the naive 95% interval: every call treated as an independent coin.",
        "The thin whisker is the adjusted 95% interval: consecutive calls share most of a " + k + "-session window, so the sample is divided by the horizon. Where it spans 50% the record cannot yet be told apart from chance, and where it runs dashed across the whole track fewer than two independent windows remain and the interval is unbounded.",
        "The hit rate is coloured only when its adjusted interval clears 50%.",
      ] }, { title: "Score against the return", lines: [
        "Each point is one scored session: its score across, and the return " + k + " sessions later up. A score that means something puts points in the tinted quadrants, where the sign of the score and the sign of the return agree, and tilts the fitted line upward.",
        "Hollow points sit inside the dead band: scored, but not a call. With a window this short one session can move ρ a long way; read it with its count.",
      ] }, { title: "Not a strategy", lines: ["Price returns from daily closes, gross of everything: no costs, no slippage, no borrow, no sizing."] }],
    });
    if (!o.calls.length) {
      host.replaceChildren(silence("quiet", "No session in the window scored " + r.t + " outside the dead band, so there is no call to score."));
      done("quiet", o);
      return;
    }
    const unit = "calls right, " + hzSaid(k) + " on";
    if (!n) {
      host.replaceChildren(
        h("div", { class: "st-figs" }, fig({ id: "hit", n: DASH, unit })),
        silence("pending", "No call on " + r.t + " has had " + k + " sessions to close yet." + (o.open ? " " + o.open + (o.open === 1 ? " call is" : " calls are") + " still open." : "")));
      done("pending", o);
      return;
    }
    const R = niceReturn(Math.max(0, ...o.closed.map((c) => Math.abs(c.sr)), ...o.points.map((q) => Math.abs(q.y))));
    const dp = R < 0.1 ? 1 : 0;
    const first = o.closed[0], last = o.closed[o.closed.length - 1];
    const callsHost = h("div", { class: "st-calls" });
    const calHost = h("div", { class: "st-cal", id: "stCalib" });
    const mean = o.mean;
    host.classList.add("is-ok");
    host.replaceChildren(
      h("div", { class: "st-figs" },
        fig({ id: "hit", n: String(o.hits), of: String(n), unit, tone: clear ? (p > 0.5 ? "up" : "down") : null, sub: [F.pct(p, 0) + " of closed calls", o.open ? o.open + " still open" : null].filter(Boolean).join(" " + MID + " ") }),
        fig({ id: "mean", minor: true, n: signedN(mean, pct(mean, 2)), unit: "mean signed return after a call", sub: hzSaid(k) + " on, gross of costs" })),
      h("div", { class: "st-hit" }, meter.node, h("p", { class: "st-cap", "data-cap": "hit-range" }, h("span", null, "Hit rate on a 0 to 100% scale, the line at 50% a coin toss; " + rangeSaid + "."))),
      h("div", { class: "st-chart-w" },
        callsHost,
        caption("calls-scale", R,
          ["Return scale ", bold(pct(-R, dp) + " to " + pct(R, dp)), ", one scale for both charts here"],
          ["First closed call, " + F.day(first.d) + " ", bold(pct(first.sr, 1))],
          first === last ? null : ["Latest closed call, " + F.day(last.d) + " ", bold(pct(last.sr, 1))]),
        UI.legend([["--up-mark", "", "Right"], ["--down-mark", "", "Wrong"], ["--label-4", "dot", "Open"]])),
      h("details", { class: "st-det", open: detail.detOpen, ontoggle: (e) => { detail.detOpen = e.target.open; } },
        h("summary", null, "Score against the return, point by point"),
        h("div", { class: "st-det-b" },
          h("dl", { class: "st-facts" }, fact("Rank correlation ρ", rho === null ? DASH : F.signed(rho, 2), "rho"), fact("Points", o.points.length + " scored sessions with a " + k + "d close", "pts")),
          o.points.length < 3 ? silence("quiet", "Fewer than three scored sessions have a close " + k + " sessions later, so there is no relation to draw.") : calHost,
          o.points.length < 3 ? null : caption("calib-scale", R,
            ["Across: score ", bold(MINUS + ctx.top + " to +" + ctx.top)],
            ["Up: return ", bold(pct(-R, dp) + " to " + pct(R, dp))]),
          o.points.length < 3 ? null : UI.legend([["--up-mark", "dot", "Right"], ["--down-mark", "dot", "Wrong"], UI.key("--label-2", "ring", "In band"), UI.key("--label-2", "ln", "Fit")]))));
    C.diverging(callsHost, {
      labels: first === last ? [{ x: first.d, text: pct(first.sr, 1) }] : [{ x: first.d, text: pct(first.sr, 1) }, { x: last.d, text: pct(last.sr, 1) }],
      values: o.calls.map((c) => c.sr), x: o.calls.map((c) => c.d), xType: "index", height: [150, 160, 170], max: R,
      format: (v) => pct(v, 1), label: "Signed return " + k + " sessions after each call on " + r.t,
      readout: (i) => {
        const c = o.calls[i];
        return [C.part(F.day(c.d), "k"), h("b", { "data-tone": UI.tone(c.v) }, signed(c.v)), c.sr === null ? C.part(c.state === "lost" ? "no close" : "open", "k") : h("b", { "data-tone": UI.tone(c.sr) }, pct(c.sr, 2))];
      },
    });
    if (o.points.length >= 3) detail.scatter = calibChart(calHost, o.points, k, R);
    done("ok", o);
  }

  function select(t, user) {
    const r = ctx.rows.find((x) => x.t === t);
    if (!r) return;
    state.t = t;
    for (const b of listHost.querySelectorAll(".st-row")) b.setAttribute("aria-pressed", String(b.dataset.t === t));
    try {
      const u = new URL(location.href);
      u.searchParams.set("t", t);
      history.replaceState(null, "", u.pathname + u.search);
    } catch (e) { }
    paintName(r);
    if (!cards.has(t)) {
      cards.set(t, { pending: true });
      get("/api/flows/card?t=" + encodeURIComponent(t)).then((body) => {
        if (!body) return;
        const ok = body.panels && typeof body.panels === "object";
        cards.set(t, ok ? { body } : { body: null, state: "unavailable" });
      }).catch((e) => cards.set(t, { body: null, state: "unavailable", reason: "The card for " + t + " could not be read (" + (e && e.message ? e.message : "request failed") + "), so no call can be scored here. Refresh to try again." }))
        .then(() => { if (state.t === t) { paintName(r); paintCalls(r); } });
    }
    paintCalls(r);
    if (user && detail.name.scrollIntoView && window.innerWidth < 1200) detail.name.scrollIntoView({ block: "start", behavior: UI.reduced() ? "auto" : "smooth" });
  }

  function bandSaid() {
    return ctx.deadBand === null ? "No dead band was published with this track, so no crossing can be claimed and none is."
      : "The dead band is ±" + ctx.deadBand + plural(ctx.deadBand, " score point", " score points") + " wide, and it is drawn to scale in every strip.";
  }

  function changeSaid() {
    const ch = ctx.change;
    const said = [];
    if (!ch) {
      said.push("This track published no session-level change summary, so the moves below are the ones this payload happens to carry rather than a share of a stated population. This page will not subtract two scores itself: a difference with no session span attached cannot say whether it covers one session or twenty.");
      said.push(bandSaid());
      return said.join(" ");
    }
    const comparable = isNum(ch.comparable), consecutive = isNum(ch.consecutive), moved = isNum(ch.moved), held = isNum(ch.held);
    const current = isNum(ch.current), entered = isNum(ch.entered), left = isNum(ch.left);
    const from = typeof ch.prior === "string" ? ch.prior : null, to = typeof ch.session === "string" ? ch.session : null;
    const span = from && to ? " between " + from + " and " + to : "";
    if (ch.status === "single-session") return "This window holds a single scored session" + (to ? " (" + to + ")" : "") + ", so there is nothing to compare it against and no move exists to report. The first change lands once a second session is archived. " + bandSaid();
    if (ch.status === "cold") return "No name in this pool was scored on two sessions inside the window, so no change exists to report. That is the shape of the archive, not a market that stood still. " + bandSaid();
    if (ch.status === "flat") return "Every one of the " + (comparable === null ? "compared" : comparable) + " names with two scored sessions held its score" + span + ". Nothing moved, and that is a reading about the session rather than a gap in the archive. " + bandSaid() + " No name crossed it.";
    if (ch.status !== "ok") said.push("This track states a change status this page does not recognise" + (typeof ch.status === "string" && ch.status ? " (“" + ch.status + "”)" : "") + ", so the counts are printed without the sentence that belongs to it.");
    if (moved === null && comparable === null) said.push("This track's change block published neither how many names moved" + span + " nor how many had two scored sessions to move out of, so nothing here can be stated as a share of a population.");
    else if (moved === null) said.push(comparable + plural(comparable, " name has", " names have") + " two scored sessions to compare" + span + ", and this track did not publish how many of them moved.");
    else if (comparable === null) said.push(moved + plural(moved, " name moved", " names moved") + span + ", and this track did not publish how many names had two scored sessions to move out of — so that count has no population and is not a share.");
    else said.push(moved + " of the " + comparable + " names with two scored sessions moved" + span + (held === null ? "" : "; " + held + plural(held, " held its score", " held theirs")) + ".");
    if (current !== null) said.push("The session itself scored " + current + plural(current, " name", " names") + ".");
    if (consecutive !== null && comparable !== null) said.push(consecutive + " of those " + comparable + " comparisons span a single session; the rest reach back further, and every row prints how far.");
    const cr = ch.crossings && typeof ch.crossings === "object" ? ch.crossings : null;
    const cleared = cr ? isNum(cr.cleared) : null, faded = cr ? isNum(cr.faded) : null, flipped = cr ? isNum(cr.flipped) : null;
    if (cleared !== null && faded !== null && flipped !== null) {
      const total = cleared + faded + flipped;
      said.push(bandSaid() + " " + (total === 0 ? "No name crossed it this session, so everything below is drift." : total + plural(total, " name", " names") + " crossed it: " + cleared + " cleared, " + faded + " faded back inside, " + flipped + " flipped sides. Those are the early warnings; everything else below is drift, however large."));
    } else said.push(bandSaid());
    if (entered) said.push(entered + plural(entered, " name was", " names were") + " scored for the first time in this window and " + plural(entered, "has", "have") + " no prior reading to compare against.");
    if (left) said.push(left + plural(left, " name was", " names were") + " scored on the prior session and not on this one.");
    if (ctx.shedBy && ctx.shed) said.push(ctx.shed + plural(ctx.shed, " name is", " names are") + " counted in those totals but not carried on this payload — the " + (ctx.shedBy === "names" ? "row ceiling" : "byte ceiling") + " shed them — so the list is shorter than the count above it.");
    return said.join(" ");
  }

  function staleSaid() {
    if (!ctx.has.now || !ctx.sessions.length) return null;
    let old = 0, unknown = 0;
    for (const r of ctx.rows) { if (r.staleBy === null) unknown++; else if (r.staleBy > 0) old++; }
    const said = [];
    if (old) said.push(old + " of the " + ctx.rows.length + " " + plural(ctx.rows.length, "name", "names") + " carried here " + plural(old, "was", "were") + " not scored in the latest session. Their last score and their move are real readings of an older session, each row says how many sessions old it is, and the default ordering sorts them last rather than promoting a stale reading over a measured one." + (ctx.has.nowScore ? "" : " No carried name was scored in the latest session at all, so that ordering is not offered here and the page opens on the last measured score instead."));
    if (unknown) said.push(unknown + " " + plural(unknown, "name carries", "names carry") + " no session index, so how old " + plural(unknown, "its reading is", "their readings are") + " cannot be stated.");
    if (!old && !unknown) said.push("Every carried name was scored in the latest session, so each last score is that session's reading.");
    return said.join(" ");
  }

  function noteSaid() {
    const parts = ["A break in a trace is a session the name was NOT scored: nothing is plotted there, because an absence must not borrow a pixel a measurement could own. A score of zero IS a measurement and draws its mark on the rule."];
    parts.push("Every strip in the list is drawn on one scale shared by the whole page, " + MINUS + ctx.top + " to +" + ctx.top + ", so two names can be compared by eye; the rule in each is zero, and which side of it a bar sits on is the sign.");
    if (ctx.deadBand !== null && ctx.deadBand > 0) parts.push("The shading around the zero rule is the published dead band, " + MINUS + ctx.deadBand + " to +" + ctx.deadBand + ", drawn to scale; a bar inside it is drawn grey, because a name there reaches no board.");
    const b = ctx.sessions.filter((x) => x.source === "boards").length;
    if (b) parts.push(b + " of these " + ctx.sessions.length + " sessions are board-only reconstructions, washed in every chart. Only the names that made a board that day were archived, so those columns are genuinely sparser, not quieter.");
    if (ctx.boundary !== null) parts.push("The dashed rule is the selection epoch" + (ctx.epoch ? " (" + ctx.epoch + ")" : "") + ": scores on either side of it come from different pools under different selection rules — a trace that crosses it is two experiments wearing one line, and the rule is drawn rather than smoothed over.");
    else if (ctx.allPre && ctx.epoch) parts.push("Every session in this window predates the selection epoch the payload names (" + ctx.epoch + "), so no trace here crosses it.");
    else if (ctx.allPost && ctx.epoch) parts.push("Every session in this window sits after the selection epoch the payload names (" + ctx.epoch + "), so no trace here crosses it.");
    return parts.join(" ");
  }

  const BASIS_LABELS = {
    score: "What the score is", gaps: "What a gap means", change: "What a change is", crossing: "What a crossing is",
    run: "What a run is", saturation: "Why the score compresses", backfill: "Board-only sessions", epoch: "The selection epoch", window: "The window",
  };
  const BASIS_ORDER = ["score", "gaps", "change", "crossing", "run", "saturation", "backfill", "epoch", "window"];

  function statusSaid(payload) {
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const names = Array.isArray(payload.names) ? payload.names : [];
    const windowSessions = isNum(payload.windowSessions), namesSeen = isNum(payload.namesSeen), namesShed = isNum(payload.namesShed);
    const sources = payload.sources && typeof payload.sources === "object" ? payload.sources : null;
    const archive = payload.archive && typeof payload.archive === "object" ? payload.archive : null;
    const parts = [sessions.length + " " + plural(sessions.length, "session", "sessions") + " traced" + (windowSessions !== null && windowSessions !== sessions.length ? ", of a " + windowSessions + "-session window" : "")];
    parts.push(names.length + " " + plural(names.length, "name", "names") + (namesShed !== null && namesShed > 0 && namesSeen !== null ? " — the most-observed " + names.length + " of " + namesSeen + " seen; " + namesShed + " shed" : ""));
    if (sources) {
      const full = isNum(sources.full), boardsOnly = isNum(sources.boardsOnly);
      const fullSaid = full === null ? null : full + " " + plural(full, "session", "sessions") + " scored in full";
      const backSaid = boardsOnly === null ? null : boardsOnly + " " + plural(boardsOnly, "session", "sessions") + " reconstructed from the archived boards alone";
      if (fullSaid && backSaid) parts.push(fullSaid + ", " + backSaid);
      else if (fullSaid || backSaid) parts.push((fullSaid || backSaid) + ", and the other half of that split was not published");
      else parts.push("this payload carried a source split with neither count in it, so how much of the window is a board-only reconstruction is not stated");
    }
    if (archive) {
      const probed = isNum(archive.probed), failed = isNum(archive.failed), abandoned = archive.abandoned === true;
      if (failed === null && !abandoned) parts.push(probed === null ? "this payload carried an archive block with no counts in it, so whether the walk read everything it probed is not stated" : "this payload probed " + probed + " archive " + plural(probed, "key", "keys") + " and did not state how many were read, so whether any session is missing from this window is not stated");
      else if ((failed !== null && failed > 0) || abandoned) parts.push("the archive could not be fully read: " + (failed !== null && failed > 0 ? failed + " of " + (probed === null ? "the" : probed) + " probed " + plural(failed, "key", "keys") + " failed" : "") + (failed !== null && failed > 0 && abandoned ? " and " : "") + (abandoned ? "the walk was abandoned partway" : "") + " — sessions may be missing from this window that exist in the store");
      else if (probed !== null) parts.push(probed === 1 ? "the one probed archive key was read" : "all " + probed + " probed archive keys were read");
    }
    if (payload.sessionDate) parts.push("the last column is the " + payload.sessionDate + " session");
    return parts.join(" " + MID + " ") + ".";
  }

  function wireBasis(payload, status) {
    if (!basisBtn) return;
    basisBtn.dataset.info = UI.info(() => {
      const notes = payload && payload.notes && typeof payload.notes === "object" ? payload.notes : null;
      const sections = [];
      if (notes) {
        const keys = BASIS_ORDER.filter((k) => Object.prototype.hasOwnProperty.call(notes, k)).concat(Object.keys(notes).filter((k) => BASIS_ORDER.indexOf(k) < 0));
        for (const k of keys) { const t = String(notes[k] === null || notes[k] === undefined ? "" : notes[k]).trim(); if (t) sections.push({ title: BASIS_LABELS[k] || k, lines: [t] }); }
      }
      const built = payload && payload.generatedAt ? Date.parse(payload.generatedAt) : NaN;
      return {
        title: "Score track",
        asOf: payload && payload.sessionDate ? "Session " + F.day(payload.sessionDate) : null,
        lead: "The same score the board prints after each close, traced name by name across sessions. The boards show a ranking's two tails; this page keeps the whole distribution, so a name drifting toward a board is visible before the session it arrives. A gap means the name was not scored that session — never zero.",
        facts: [["Built", F.stamp(built)], ["Payload", isNum(payload && payload.v) === null ? null : "v" + payload.v]],
        sections: [{ title: "Window", lines: [status] }, ctx ? { title: "This session", lines: [changeSaid(), staleSaid()] } : null].filter(Boolean).concat(sections.length ? sections : [{ title: "Basis", lines: ["This payload carried no notes block, so the page cannot say in the pipeline's own words how the score was built or what a gap means. Treat everything here as unexplained."] }]),
        notes: ["Zero vendor calls: the track is a view of the score archive the pipeline already holds, rebuilt from it on every run."],
      };
    });
  }

  function sessSaid() {
    const ch = ctx.change;
    if (!ch) return null;
    const current = isNum(ch.current), moved = isNum(ch.moved), comparable = isNum(ch.comparable);
    const cr = ch.crossings && typeof ch.crossings === "object" ? ch.crossings : null;
    const cleared = cr ? isNum(cr.cleared) : null, faded = cr ? isNum(cr.faded) : null, flipped = cr ? isNum(cr.flipped) : null;
    const parts = [];
    if (current !== null) parts.push(current + plural(current, " name", " names") + " scored in the latest session");
    if (moved !== null && comparable !== null) parts.push(moved + " of " + comparable + " compared " + "moved");
    if (cleared !== null && faded !== null && flipped !== null) parts.push(cleared + " cleared the dead band, " + faded + " faded back inside, " + flipped + " flipped sides");
    return parts.length ? UI.cap(parts.join("; ")) : null;
  }

  const SCORE_WHAT = "Each name's score after every close, oldest on the left; a break in a trace is a session it was not scored, never zero.";
  const IDEAS_WHAT = "Each night's lead idea is frozen when first shown and settled on its expiry's close; this checks the chances the engine stated against what happened.";

  function build() {
    const seg = UI.segmented("Horizon", HORIZONS.map((k) => ({ label: k + "d" })), (i) => {
      state.k = HORIZONS[i];
      const r = ctx.rows.find((x) => x.t === state.t);
      if (r) paintCalls(r);
    }, HORIZONS.indexOf(state.k));
    detail.what = what("", "stCallsWhat");
    detail.callsBody = h("div", { class: "st-calls-b" });
    detail.name = h("div", { class: "st-sel", id: "stName" });
    detail.ideasBody = h("div", { class: "st-ide-b" });
    detail.lede = h("p", { class: "st-lede", id: "stLede" });
    detail.note = h("p", { class: "st-lede-n", id: "stLedeN" });
    detail.prov = h("p", { class: "st-prov", id: "stProv" });
    const sess = sessSaid();
    const calls = UI.moduleCard({ id: "stCalls", title: "Calls scored", index: 1, seg, info: () => (detail.callsInfo ? detail.callsInfo() : { title: "Calls scored", lead: "Pending the name's closes." }), body: h("div", { class: "st-blk-b" }, detail.what, detail.callsBody) });
    const score = UI.moduleCard({ id: "stScore", title: "Score track per name", index: 2, info: () => (detail.namesInfo ? detail.namesInfo() : { title: "Score track per name" }),
      body: h("div", { class: "st-blk-b" }, what(SCORE_WHAT), sess ? h("p", { class: "st-sess", id: "stSess" }, sess) : null, h("div", { class: "st-split" }, detail.name, namesPane())) });
    const idea = UI.moduleCard({ id: "stIdeas", title: "Ideas settled", index: 3, info: () => ideasInfo(), body: h("div", { class: "st-blk-b" }, what(IDEAS_WHAT), detail.ideasBody) });
    app.replaceChildren(h("div", { class: "st-top" }, detail.lede, detail.note), calls, score, idea, detail.prov);
  }

  function provSaid(payload) {
    const built = F.stamp(payload.generatedAt);
    const parts = [];
    if (built) parts.push("Built " + built);
    if (typeof payload.sessionDate === "string" && payload.sessionDate) parts.push("session " + payload.sessionDate);
    parts.push(sessionsSaid(ctx.sessions.length) + ", " + ctx.rows.length + " " + plural(ctx.rows.length, "name", "names"));
    parts.push("no vendor calls");
    return parts.join(" " + MID + " ") + ".";
  }

  function ideasInfo() {
    const c = ideas.c;
    const n = c && isNum(c.n) !== null ? c.n : 0;
    return {
      title: "Ideas settled",
      lead: "Each night the engine ranks one lead structure for every name it prices. This freezes that idea, its fill and its stated chances the first night it appears, and settles it on the close of its expiry. A re-recommendation of the same strikes and expiry is not a new trial.",
      facts: c ? [["Resolved", String(n)], ["Effective n", isNum(c.nEff) === null ? null : c.nEff.toFixed(1)], ["Clusters (expiry weeks)", isNum(c.clusters) === null ? null : String(c.clusters)], ["Intra-cluster correlation", isNum(c.rho) === null ? null : c.rho.toFixed(2) + (c.rhoFloored ? " (floored)" : "")], ["Since", c.firstArchive || null]] : null,
      sections: [
        { title: "Method", lines: [(c && c.note) || "European payoff at expiry from the daily close, early assignment ignored.", "Ideas that expire in the same ISO week share one market path, so they count as one cluster and the effective n is smaller than the number of ideas.", "Until the effective n reaches " + (c && isNum(c.needed) !== null ? c.needed : 100) + " no reliability figure is shown."] },
        { title: "What is left out", lines: ["Calendars and diagonals cannot be settled from one close and are excluded, as are ideas across a split. Ideas on names that left the deep set are settled from a separate close fetch; those with no close yet are counted in No close yet, never dropped."] },
      ],
    };
  }

  function evidence(nEff, needed) {
    const f = nEff === null ? 0 : Math.max(0, Math.min(1, nEff / needed));
    return h("div", { class: "st-prog-w" },
      h("span", null, "0"),
      h("div", { class: "st-prog", role: "img", "aria-label": "Effective n " + (nEff === null ? "unstated" : nEff.toFixed(1)) + " of " + needed + " needed" }, h("i", { style: { width: (f * 100).toFixed(1) + "%" } })),
      h("span", null, String(needed)));
  }

  function ideasBody(c) {
    const n = isNum(c.n) === null ? 0 : c.n;
    const nEff = isNum(c.nEff);
    const needed = isNum(c.needed) === null ? 100 : c.needed;
    const counts = c.counts && typeof c.counts === "object" ? c.counts : {};
    const share = isNum(counts.unresolvedShare);
    const head = h("div", { class: "st-figs" },
      fig({ id: "ideas", n: String(n), unit: plural(n, "idea settled", "ideas settled"), sub: share === null ? null : F.pct(share, 0) + " still without a close " + MID + " " + (isNum(counts.pending) || 0) + " waiting, " + (isNum(counts.lost) || 0) + " lost" }),
      fig({ id: "eff", minor: true, n: nEff === null ? DASH : nEff.toFixed(1), of: String(needed), unit: "effective n, counting ideas of one expiry week once" }));
    const meter = evidence(nEff, needed);
    if (!c.measured || !c.popP) {
      return [head, meter, silence("pending", "Not yet measured. The model’s real-world chance of profit has no outcome record that can be read yet: " + n + " resolved " + plural(n, "idea", "ideas") + ", effective n " + (nEff === null ? DASH : nEff.toFixed(1)) + " of " + needed + " needed, after ideas that expire in one week are counted as one. Until then each chance is shown with the note “Not yet calibrated”.")];
    }
    const view = c.popP;
    const rows = view.bins.filter((b) => b && b.n > 0).map((b) => h("tr", null,
      h("th", { scope: "row" }, F.pct(b.lo, 0) + MID + F.pct(b.hi, 0)),
      h("td", null, String(b.n)),
      h("td", null, F.pct(b.p, 0)),
      h("td", null, F.pct(b.y, 0)),
      h("td", null, b.ci ? F.pct(b.ci[0], 0) + MID + F.pct(b.ci[1], 0) : DASH)));
    const q = c.popQ;
    const fix = (v, d = 3) => (isNum(v) === null ? DASH : v.toFixed(d));
    return [head, meter,
      h("div", { class: "flows-tablewrap" }, h("table", { class: "flows-table is-dense st-rel" },
        h("caption", { class: "flows-caption" }, "Stated chance of profit against what happened, ideas grouped by the chance the model gave them"),
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Stated"), h("th", { scope: "col" }, "Ideas"), h("th", { scope: "col" }, "Mean stated"), h("th", { scope: "col" }, "Profited"), h("th", { scope: "col" }, "95% interval"))),
        h("tbody", null, ...rows))),
      h("dl", { class: "st-facts" },
        fact("Brier", fix(view.brier) + " " + MID + " lower is better; " + fix(view.uncertainty) + " if every chance were the base rate", "ideasBrier"),
        fact("Reliability", fix(view.reliability) + " " + MID + " gap between stated and observed", "ideasRel"),
        fact("Resolution", fix(view.resolution) + " " + MID + " how far the chances separated outcomes", "ideasRes"),
        fact("Log score", fix(view.logScore) + " " + MID + " lower is better", "ideasLog")),
      q ? h("p", { class: "st-note" }, "The risk-neutral chance (popQ) is not meant to match frequencies; its Brier score here is " + fix(q.brier) + " against " + fix(view.brier) + " for the real-world chance, and its gap measures the risk premium.") : null,
    ];
  }

  function paintIdeas() {
    const host = detail.ideasBody;
    if (!host) return;
    if (ideas.phase === "loading") host.replaceChildren(loading("Reading the idea record."));
    else if (ideas.phase === "fail") host.replaceChildren(silence("unavailable", "The calibration record could not be loaded. The score track above is unaffected."));
    else if (ideas.phase === "pending") host.replaceChildren(silence("pending", "Not yet measured. No idea has been settled yet: the first one expires after the archive that records it, and the record starts with the first nightly run that wrote it."));
    else host.replaceChildren(...ideasBody(ideas.c));
    paintLede();
  }

  function loadIdeas() {
    paintIdeas();
    get("/api/flows/calib").then((c) => {
      if (!c || typeof c !== "object") return;
      ideas.c = c.status === "pending" ? null : c;
      ideas.phase = c.status === "pending" ? "pending" : "ok";
      paintIdeas();
    }).catch(() => {
      ideas.phase = "fail";
      paintIdeas();
    });
  }

  function fail(kind, msg) {
    statusEl.textContent = msg;
    app.replaceChildren(UI.moduleCard({ id: "stEmpty", title: "Track", body: silence(kind, msg) }));
  }

  get("/api/flows/scoretrack").then((payload) => {
    if (!payload) return;
    if (typeof payload !== "object") throw new Error("the endpoint answered with no payload");
    if (payload.status === "pending") {
      wireBasis(payload, "Not published yet.");
      fail("pending", "The pipeline has not published this key yet. The track is rebuilt by each after-close run from the dated score archive the pipeline already holds — it costs no vendor call — and it appears with the first run after this page shipped.");
      return;
    }
    UI.freshness({ sessionDate: payload.sessionDate, generatedAt: payload.generatedAt, source: "scoretrack" });
    const sessionsOk = Array.isArray(payload.sessions) && payload.sessions.length > 0;
    if (!sessionsOk || !Array.isArray(payload.names)) {
      wireBasis(payload, "Unreadable.");
      fail("withheld", "This payload could not be read as a track: it carries " + (!sessionsOk ? "no session axis to trace a score against" : "a session axis but no name series") + ". That is a gap in the payload rather than a fact about the scores — nothing here says the pool was empty.");
      return;
    }
    const status = statusSaid(payload);
    if (!payload.names.length) {
      wireBasis(payload, status);
      fail("quiet", "No name carried a score in any of the " + payload.sessions.length + " " + plural(payload.sessions.length, "session", "sessions") + " the archive walk reconstructed. That is a measured emptiness — the walk read every archived session in the window and found no scored name — and not a missing publish.");
      statusEl.textContent = status;
      return;
    }
    statusEl.textContent = status;
    ctx = prepare(payload);
    state.sort = ctx.has.nowScore ? "now" : "abs";
    wireBasis(payload, status);
    const head = document.getElementById("stHeadState");
    const stale = UI.staleness ? UI.staleness(payload, Date.now(), { subject: "This track" }) : null;
    if (head && stale && stale.message) head.replaceChildren(UI.stateButton({ state: "stale", reason: stale.message + " The right-hand edge of every strip is that run's session and not today's." }, "Track"));
    build();
    detail.prov.textContent = provSaid(payload);
    renderList(false);
    loadIdeas();
    let want = null;
    try { want = (new URL(location.href).searchParams.get("t") || "").trim().toUpperCase(); } catch (e) { want = null; }
    const first = filtered()[0];
    select(want && ctx.rows.some((r) => r.t === want) ? want : first ? first.t : ctx.rows[0].t, false);
  }).catch((error) => {
    fail("unavailable", "The track could not be loaded: " + (error && error.message ? error.message : "the request failed") + ". Refresh to try again.");
  });
})();
