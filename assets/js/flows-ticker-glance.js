(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI || !UI.F || !UI.h || !UI.s) return;
  const { F, h, s } = UI;
  const DASH = UI.DASH, MINUS = UI.MINUS, MID = " " + UI.MID + " ";
  const DEALER_CLAUSE = "on the vendor's convention (dealers long calls, short puts)";
  const RANGES = { "1M": 20, "3M": 63, "6M": 126, "1Y": 252 };
  const FWD = 20;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const numOr = (...vs) => { for (const v of vs) if (num(v) !== null) return v; return null; };
  const isoOk = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
  const okOf = (p) => (p && p.status === "ok" ? p : null);
  const sgn = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
  const tone = (v) => (num(v) === null || v === 0 ? "flat" : v > 0 ? "up" : "down");
  const volPts = (v) => (num(v) === null ? DASH : F.signed(v * 100, 1));
  const f1 = (v) => String(Math.round(v * 10) / 10);
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  let uid = 0;

  const EVIDENCE = {
    flip: /^options\.(engine\.level\.(flip|strikeSumCrossing)|state$)/,
    walls: /^options\.engine\.level\.(callWall|putWall|maxPain|magnet)/,
    gamma: /^options\.engine\.(gex|dealer|hedge)\.|^options\.engine\.level\.flowPeak/,
    cone: /^options\.engine\.(move\.(?!event)|iv\.cm|carry)/,
    event: /^options\.engine\.(move\.event|event\.)|^(events|earnings)\./,
    signal: /^(options\.(score|conviction|fam)|signal\.)/,
    volatility: /^options\.engine\.(iv|vrp|skew|term|rv|garch)\./,
    flow: /^(flow\.|options\.flow)/,
    positioning: /^positioning\./,
    earnings: /^options\.engine\.(move\.event|event\.)|^(events|earnings)\./,
    range: /^(price|context|peers)\./,
  };
  const MARK_ORDER = ["flip", "event", "gamma", "walls", "cone"];
  const normId = (id) => String(id || "").replace(/^dossier:[^/]*\//, "");
  const citeId = (c) => (typeof c === "string" ? c : c && typeof c.id === "string" ? c.id : "");

  function claimsOf(reading, given) {
    if (Array.isArray(given)) return given.slice(0, 4).map((c, i) => ({ id: String(c.id || i + 1), cites: (c.cites || []).map(citeId).map(normId).filter(Boolean) }));
    const sec = reading && reading.sections;
    if (!sec || typeof sec !== "object") return [];
    const items = [sec.now].concat(sec.drivers || [], sec.tensions || [], sec.watch || []).filter((x) => x && Array.isArray(x.cites) && x.cites.length);
    return items.slice(0, 4).map((x, i) => ({ id: String(i + 1), cites: x.cites.map(citeId).map(normId).filter(Boolean) }));
  }
  function evidence(claims) {
    const by = {};
    for (const k of Object.keys(EVIDENCE)) by[k] = claims.filter((c) => c.cites.some((id) => EVIDENCE[k].test(id))).map((c) => c.id);
    const mark = {};
    for (const c of claims) {
      const layer = MARK_ORDER.find((k) => by[k].includes(c.id));
      if (layer) mark[c.id] = layer;
    }
    return { by, mark };
  }

  function candles(card) {
    const c = card && card.panels && card.panels.context;
    if (!c || !Array.isArray(c.candles)) return [];
    const keys = Array.isArray(c.candleKeys) ? c.candleKeys : ["date", "open", "high", "low", "close", "volume"];
    const ix = (k) => keys.indexOf(k);
    return c.candles.filter((r) => Array.isArray(r) && isoOk(r[ix("date")]) && num(r[ix("close")]) !== null)
      .map((r) => ({ d: r[ix("date")], c: r[ix("close")], h: r[ix("high")], l: r[ix("low")] })).sort((a, b) => (a.d < b.d ? -1 : 1));
  }
  function spotOf(card) {
    const P = (card && card.panels) || {};
    const pick = (p) => (p && p.status === "ok" ? num(p.spot) : null);
    const c = candles(card);
    return numOr(pick(P.pricedMove), pick(P.levels), pick(P.gamma), card.engine && card.engine.spot, c.length ? c[c.length - 1].c : null, card.u && card.u.px);
  }
  function levelsOf(card) {
    const L = okOf(card.panels && card.panels.levels);
    const out = {};
    if (L && Array.isArray(L.levels)) {
      for (const l of L.levels) {
        if (!l || num(l.px) === null) continue;
        const kind = l.kind === "zero_gamma" ? "gamma_flip" : l.kind;
        if (kind === "gamma_flip" && out.gamma_flip && l.kind !== "zero_gamma") continue;
        out[kind] = { kind, px: l.px };
      }
    }
    if (!out.gamma_flip && num(card.gammaFlip) !== null) out.gamma_flip = { kind: "gamma_flip", px: card.gammaFlip };
    if (!out.gamma_flip && num(card.zeroGamma) !== null) out.gamma_flip = { kind: "gamma_flip", px: card.zeroGamma };
    return out;
  }
  const LEVEL_NAMES = { call_wall: "Call wall", put_wall: "Put wall", max_pain: "Max pain", gamma_flip: "Flip" };
  const LEVEL_KINDS = [["call_wall", "Call"], ["max_pain", "Pain"], ["put_wall", "Put"], ["gamma_flip", "Flip"]];

  function cluster(wants, gap, lo, hi) {
    const place = (c) => { c.top = clamp(c.sum / c.n - (c.n - 1) * gap / 2, lo, Math.max(lo, hi - (c.n - 1) * gap)); };
    const cl = wants.map((w, i) => ({ w, i })).sort((a, b) => a.w - b.w || a.i - b.i).map((o) => ({ idx: [o.i], sum: o.w, n: 1 }));
    cl.forEach(place);
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < cl.length - 1; i++) {
        const a = cl[i], b = cl[i + 1];
        if (a.top + a.n * gap > b.top + 1e-9) {
          const m = { idx: a.idx.concat(b.idx), sum: a.sum + b.sum, n: a.n + b.n };
          place(m);
          cl.splice(i, 2, m);
          again = true;
          break;
        }
      }
    }
    const out = new Array(wants.length);
    for (const c of cl) c.idx.forEach((ix, j) => { out[ix] = c.top + j * gap; });
    return out;
  }

  function stepsFor(tE) {
    const st = [];
    let done = tE === null;
    for (let k = 0; k <= FWD; k++) {
      if (!done && k > tE) { st.push([tE, false], [tE, true]); done = true; }
      st.push([k, tE !== null && k > tE]);
    }
    if (!done) st.push([tE, false], [tE, true]);
    return st;
  }
  function bandOf(S, hi, lo, Hs) {
    if (S === null || !(S > 0) || num(hi) === null || num(lo) === null || !(hi > 0) || !(lo > 0)) return null;
    const up = Math.log(hi / S), dn = Math.log(S / lo);
    return { dUp: up * up / Hs, dDn: dn * dn / Hs, up, dn };
  }
  function coneOf(S, b, jump, tE) {
    const J = num(jump) === null ? 0 : jump;
    return stepsFor(tE).map(([hh, ev]) => {
      const sUp = Math.sqrt(hh * b.dUp + (ev ? J * J : 0)), sDn = Math.sqrt(hh * b.dDn + (ev ? J * J : 0));
      return { h: hh, up: S * Math.exp(sUp), lo: S * Math.exp(-sDn), sUp, sDn };
    });
  }

  function termRows(card, X) {
    const P = card.panels || {};
    const term = okOf(X.term), vc = okOf(P.volContext), sk = okOf(P.skewTerm);
    const lists = [
      term && Array.isArray(term.expiries) ? term.expiries.filter((r) => num(r.dte) !== null && num(r.iv) !== null && r.dte > 0).map((r) => ({ d: r.dte, v: r.iv })) : [],
      vc && vc.term && vc.term.status === "ok" && Array.isArray(vc.term.rows) ? vc.term.rows.filter((r) => num(r.dte) !== null && num(r.vol) !== null && r.dte > 0).map((r) => ({ d: r.dte, v: r.vol })) : [],
      sk && Array.isArray(sk.points) ? sk.points.filter((p) => num(p.atmIv) !== null && p.days > 0).map((p) => ({ d: p.days, v: p.atmIv })) : [],
    ];
    const rows = lists.find((l) => l.length > 1) || [];
    return rows.slice().sort((a, b) => a.d - b.d);
  }
  function flowSeries(card, x) {
    const tp = x.tape && x.tape.prem && x.tape.prem.status === "ok" && Array.isArray(x.tape.prem.t) && x.tape.prem.t.length > 1 ? x.tape.prem : null;
    if (tp) {
      return { p: tp.net.map(num), t0: F.time(tp.t[0], false), t1: F.time(tp.t[tp.t.length - 1]), net: num(tp.net[tp.net.length - 1]), nd: Array.isArray(tp.nd) ? num(tp.nd[tp.nd.length - 1]) : null };
    }
    const path = okOf((card.panels || {}).path);
    if (path && Array.isArray(path.series)) {
      const ser = path.series.filter(Array.isArray);
      const start = Date.parse(path.startedAt), step = ser.length > 1 && num(path.minutes) ? path.minutes / ser.length : 5;
      return { p: ser.map((r) => num(r[1])), t0: Number.isFinite(start) ? F.time(start + step * 60000, false) : null, t1: Number.isFinite(start) ? F.time(start + ser.length * step * 60000) : null, net: num(path.netPremium), nd: num(path.netDelta) };
    }
    return null;
  }

  function model(card, range, x) {
    x = x && typeof x === "object" ? x : {};
    const P = (card && card.panels) || {};
    const X = x.cardX && typeof x.cardX === "object" ? x.cardX : {};
    const why = {};
    const N = RANGES[range] || RANGES["1M"];
    const S = spotOf(card || {});
    const hist = candles(card).slice(-(N + 1)).map((r) => ({ d: r.d, c: r.c }));
    if (hist.length && S !== null && hist[hist.length - 1].d === card.sessionDate) hist[hist.length - 1].c = S;
    if (hist.length < 2 || S === null) why.price = "The card carries no price history.";
    const pm = okOf(P.pricedMove) || {};
    if (!okOf(P.pricedMove)) why.q = "The card carries no priced move, so there is no cone.";
    const Hs = num(pm.sessions) || 10;
    const qb = bandOf(S, pm.impliedHigh, pm.impliedLow, Hs);
    const pb = bandOf(S, pm.realizedHigh, pm.realizedLow, Hs);
    if (okOf(P.pricedMove) && !qb) why.q = "The priced move carries no implied range.";
    if (okOf(P.pricedMove) && !pb) why.p = "The priced move carries no realised range.";
    const E = X.earnings && (X.earnings.status === "ok" || X.earnings.status === "thin") ? X.earnings : null;
    const nx = E && E.next && isoOk(E.next.d) && num(E.next.sessions) !== null && E.next.sessions >= 1 && E.next.sessions <= FWD ? E.next : null;
    const term = okOf(X.term);
    const em = E && E.impliedNext && num(E.impliedNext.em) !== null ? E.impliedNext.em : term && term.eventMove && num(term.eventMove.sd) !== null ? term.eventMove.sd : null;
    let event = null;
    if (nx) {
      const w = String(nx.when || "");
      const tE = Math.min(FWD, nx.sessions + (/post|after|amc|close/i.test(w) ? 0.5 : /pre|before|bmo|open/i.test(w) ? -0.5 : 0));
      event = { d: nx.d, sessions: nx.sessions, h: tE, when: /post|after|amc|close/i.test(w) ? "after the close" : /pre|before|bmo|open/i.test(w) ? "before the open" : null, q: em, p: E ? num(E.medianAbsMove) : null };
    } else why.event = E ? "No report inside the next " + FWD + " sessions." : "The card carries no earnings calendar for this name.";
    const tE = event ? event.h : null;
    const q = qb ? coneOf(S, qb, event ? event.q : null, tE) : null;
    const p = pb ? coneOf(S, pb, event ? event.p : null, tE) : null;
    const end = (c) => (c ? (c[c.length - 1].sUp + c[c.length - 1].sDn) / 2 : null);
    const lv = levelsOf(card || {});
    const levels = LEVEL_KINDS.map(([kind, label]) => (lv[kind] && S !== null && Math.abs(lv[kind].px / S - 1) <= 0.12 ? { kind, label, px: lv[kind].px } : null)).filter(Boolean);
    for (const [kind, label] of LEVEL_KINDS) if (!lv[kind] || (S !== null && Math.abs(lv[kind].px / S - 1) > 0.12)) why[kind] = lv[kind] ? label + " is more than 12% from spot." : "The card carries no " + label.toLowerCase() + " level.";
    const vals = hist.map((r) => r.c).concat(S === null ? [] : [S], levels.map((l) => l.px));
    for (const c of [q, p]) if (c) { const e = c[c.length - 1]; if (Math.abs(Math.log(e.up / S)) < 0.25 && Math.abs(Math.log(S / e.lo)) < 0.25) vals.push(e.up, e.lo); }
    let y0 = vals.length ? Math.min(...vals) : 0, y1 = vals.length ? Math.max(...vals) : 1;
    const pad = (y1 - y0) * 0.06 || (S || 1) * 0.01;
    y0 -= pad; y1 += pad;
    const reg = card.regime || {};
    const gp = okOf(P.gamma);
    const bars = gp && Array.isArray(gp.bars) ? gp.bars.filter((b) => b && num(b.k) !== null && num(b.g) !== null && b.k >= y0 && b.k <= y1).sort((a, b) => a.k - b.k).map((b) => ({ k: b.k, g: b.g })) : [];
    if (!bars.length) why.gamma = gp ? "No strike carried gamma inside the drawn range." : "The card carries no gamma by strike.";
    const book = numOr(reg.bookGamma, reg.netGamma);
    const so = okOf(P.scoreOverlay);
    const byDay = new Map();
    if (so && Array.isArray(so.rows)) for (const r of so.rows) if (isoOk(r.d) && num(r.score) !== null) byDay.set(r.d, r.score);
    if (isoOk(card.sessionDate) && num(card.score) !== null && !byDay.has(card.sessionDate)) byDay.set(card.sessionDate, card.score);
    const scoreRows = hist.map((r) => ({ d: r.d, v: byDay.has(r.d) ? byDay.get(r.d) : null }));
    const hasScore = scoreRows.some((r) => r.v !== null);
    if (!hasScore) why.score = "The card carries no score history for these sessions.";
    return { range: RANGES[range] ? range : "1M", N: hist.length - 1, F: FWD, S, hist, Hs, q, p, qEnd: end(q), pEnd: end(p), event, levels, y0, y1, bars, book, bookSide: reg.label === "short" ? "short" : reg.label === "long" ? "long" : null,
      flipSide: reg.crossingSide || null, score: { rows: scoreRows, has: hasScore }, why, ticker: card.ticker, sessionDate: card.sessionDate };
  }

  function layout(m, W, H) {
    const phone = W < 520;
    const hasProf = !phone && m.bars.length > 0;
    const profW = hasProf ? clamp(Math.round(W * 0.1), 56, 128) : 0;
    const labelW = phone ? 0 : 80;
    const XL = phone ? 6 : 44;
    const XR = Math.round(W - (phone ? 8 : (hasProf ? profW + 14 : 0) + labelW + 8));
    const nb = Math.max(1, m.N);
    const ffrac = Math.max(FWD / (nb + FWD), 0.3);
    const XT = XL + (XR - XL) * (1 - ffrac);
    const top = 8;
    const strip = !phone && m.score.has;
    const sh = strip ? clamp(Math.round(H * 0.2), 44, 90) : 0;
    const plotB = H - 18 - (strip ? sh : 0) - 6;
    const y = (v) => top + (m.y1 - v) * (plotB - top) / (m.y1 - m.y0);
    const xb = (i) => XL + (XT - XL) * i / nb;
    const xf = (t) => XT + (XR - XT) * t / FWD;
    const clampY = (v) => clamp(v, top, plotB);
    const poly = (c, k) => c.map((o) => [xf(o.h), clampY(y(o[k]))]);
    const out = { phone, W, H, XL, XR, XT, top, plotB, profW, labelW, y, xb, xf, strip, hasProf };
    if (m.q) out.q = { up: poly(m.q, "up"), lo: poly(m.q, "lo") };
    if (m.p) out.p = { up: poly(m.p, "up"), lo: poly(m.p, "lo") };
    const gap = 14;
    const items = m.levels.map((l) => ({ kind: l.kind, text: l.label + " " + F.px(l.px), px: l.px })).concat(m.S === null ? [] : [{ kind: "spot", text: "Spot " + F.px(m.S), px: m.S }]);
    const lab = phone ? [] : items;
    const ys = cluster(lab.map((l) => y(l.px) + 3.5), gap, top + 8, plotB);
    out.labels = lab.map((l, i) => ({ kind: l.kind, text: l.text, want: y(l.px) + 3.5, y: ys[i], ly1: y(l.px), ly2: ys[i] - 4 }));
    out.levelY = Object.fromEntries(items.map((l) => [l.kind, y(l.px)]));
    if (hasProf) {
      const mx = Math.max(...m.bars.map((b) => Math.abs(b.g)));
      let pitch = Infinity;
      for (let i = 1; i < m.bars.length; i++) pitch = Math.min(pitch, Math.abs(y(m.bars[i].k) - y(m.bars[i - 1].k)));
      const th = clamp(pitch * 0.8, 1.5, 6);
      out.profX = XR + 12;
      out.bars = m.bars.map((b) => ({ k: b.k, g: b.g, y: y(b.k) - th / 2, h: th, w: Math.abs(b.g) / mx * profW * 0.95 })).filter((b) => b.y >= top + 26);
    } else out.bars = [];
    if (strip) {
      const stripTop = plotB + 36, bottom = H - 6;
      const mid = (stripTop + bottom) / 2, half = (bottom - stripTop) / 2;
      const mxs = Math.max(30, ...m.score.rows.map((r) => (r.v === null ? 0 : Math.abs(r.v))));
      const k = (half - 2) / mxs;
      const bw = clamp((XT - XL) / nb * 0.5, 1.5, 8);
      out.score = { mid, k, bw, capY: plotB + 30, bars: m.score.rows.map((r, i) => (r.v === null ? null : { i, x: xb(i) - bw / 2, y: r.v >= 0 ? mid - r.v * k : mid, h: Math.max(1, Math.abs(r.v) * k), v: r.v })) };
    }
    out.xs = m.hist.map((_, i) => xb(i)).concat(Array.from({ length: FWD }, (_, i) => xf(i + 1)));
    return out;
  }

  function dateAt(m, t) {
    const last = m.hist.length ? m.hist[m.hist.length - 1].d : null;
    if (!last) return null;
    const d = new Date(last.slice(0, 10) + "T12:00:00Z");
    for (let k = 0; k < t;) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) k++; }
    return d.toISOString().slice(0, 10);
  }

  function readout(m, i) {
    const n = m.hist.length;
    if (i < 0 || i >= n + FWD) return "";
    if (i < n) {
      const r = m.hist[i], prev = i > 0 ? m.hist[i - 1].c : null, sc = m.score.rows[i] ? m.score.rows[i].v : null;
      return [F.day(r.d), F.px(r.c), prev ? F.pct(r.c / prev - 1, 2, true) : null, sc === null ? null : "score " + F.signed(sc)].filter(Boolean).join(MID);
    }
    const t = i - n + 1;
    const at = (cone, k) => { if (!cone) return null; let r = cone[0]; for (const o of cone) if (o.h <= t) r = o; return r[k]; };
    const parts = ["+" + plural(t, "session") + " (" + F.day(dateAt(m, t)) + ")"];
    if (m.q) parts.push("Q " + F.px(at(m.q, "lo")) + " " + String.fromCharCode(8211) + " " + F.px(at(m.q, "up")));
    if (m.p) parts.push("P " + F.px(at(m.p, "lo")) + " " + String.fromCharCode(8211) + " " + F.px(at(m.p, "up")));
    if (m.event && Math.abs(m.event.sessions - t) < 1) parts.push("report " + F.day(m.event.d));
    return parts.join(MID);
  }

  function describe(m) {
    const T = m.ticker;
    const out = [];
    if (m.why.price) out.push(T + " price: " + m.why.price);
    else out.push(T + " price over the last " + m.N + " sessions, closing at " + F.px(m.S) + " on " + F.day(m.hist[m.hist.length - 1].d) + ", and the next " + FWD + " sessions.");
    out.push(m.q ? "Options price a range of plus or minus " + F.pct(m.qEnd, 1) + " by session " + FWD + "." : "Options cone: " + m.why.q);
    out.push(m.p ? "The real-world model gives plus or minus " + F.pct(m.pEnd, 1) + "." : "Real-world cone: " + (m.why.p || m.why.q));
    out.push(m.event ? "A report on " + F.day(m.event.d) + (m.event.when ? ", " + m.event.when : "") + " steps both bands" + (m.event.q !== null ? ": options price plus or minus " + F.pct(m.event.q, 1) : "") + (m.event.p !== null ? ", past reports moved plus or minus " + F.pct(m.event.p, 1) : "") + "." : m.why.event);
    const lv = m.levels.map((l) => LEVEL_NAMES[l.kind] + " " + F.px(l.px));
    out.push(lv.length ? "Levels: " + lv.join(", ") + "." : "No levels near spot on this card.");
    out.push(m.bars.length ? "Dealer gamma by strike is on the right edge: long bars to the right in blue, short bars hatched in orange" + (m.book !== null ? ", book " + F.money(m.book, true) + " per 1%" : "") + ", " + DEALER_CLAUSE + "." : "Dealer gamma by strike: " + m.why.gamma);
    const last = m.score.rows.length ? m.score.rows[m.score.rows.length - 1].v : null;
    out.push(m.score.has ? "Flows score by session under the price" + (last !== null ? ", today " + F.signed(last) : "") + "." : "Flows score: " + m.why.score);
    out.push("Use the left and right arrow keys to move through sessions.");
    return out.join(" ");
  }

  function ivRank(card) {
    const pm = (card.panels || {}).pricedMove;
    if (!pm || pm.status !== "ok" || num(pm.ivRank) === null || pm.ivRank < 0 || pm.ivRank > 1) return null;
    return pm.ivRank;
  }
  function scoreChange(card) {
    const so = okOf((card.panels || {}).scoreOverlay);
    const rows = so && Array.isArray(so.rows) ? so.rows : [];
    const ix = [];
    rows.forEach((r, i) => { if (num(r && r.score) !== null) ix.push(i); });
    if (ix.length < 2) return null;
    const a = ix[ix.length - 1], b = ix[ix.length - 2];
    return { v: rows[a].score - rows[b].score, gap: a - b };
  }
  const FAMS = [["F", "Flow", true], ["P", "Positioning", true], ["D", "Path", true], ["V", "Volatility", false], ["O", "Quality", false]];
  const famOf = (card, k) => ((k === "V" || k === "O") && (num(card.v) === null ? 1 : card.v) < 2 ? null : num((card.fam || {})[k]));
  const fig = (text, t) => ({ text, tone: t || "flat" });

  function cards(card, x) {
    x = x && typeof x === "object" ? x : {};
    const P = card.panels || {};
    const X = x.cardX && typeof x.cardX === "object" ? x.cardX : {};
    const pm = okOf(P.pricedMove) || {};
    const out = [];

    const score = num(card.score), conv = num(card.conviction);
    const chg = scoreChange(card);
    out.push({ id: "signal", title: "Signal", sub: conv === null ? "no conviction" : "conviction " + conv + " of 100",
      fig: score === null ? fig(DASH) : fig(F.signed(score), tone(score)), unit: score === null ? "" : "score" + (chg ? ", " + F.signed(chg.v) + " in " + plural(chg.gap, "session") : ""),
      rows: FAMS.map(([k, label, signed]) => { const v = famOf(card, k); return { k: label, v, signed, text: v === null ? DASH : F.num(v, signed) }; }),
      foot: score === null ? "No score was published on this card." : "Volatility, quality unsigned", missing: score === null });

    const cone = okOf(X.cone), vrp = okOf(X.vrp), skew = okOf(X.skew), sk = okOf(P.skewTerm);
    const iv30 = cone ? numOr(cone.iv30, pm.iv30) : num(pm.iv30);
    const rk = ivRank(card);
    const rows = termRows(card, X);
    const prem = vrp && vrp.exAnte ? vrp.exAnte.vrp : num(pm.vrp);
    const rr = skew ? skew.rr25 : sk ? sk.skew : null;
    const dir = rows.length > 1 ? (rows[rows.length - 1].v > rows[0].v ? "upward term" : rows[rows.length - 1].v < rows[0].v ? "downward term" : "flat term") : null;
    out.push({ id: "volatility", title: "Volatility", sub: "IV rank " + (rk === null ? DASH : Math.round(rk * 100)),
      fig: iv30 === null ? fig(DASH) : fig(F.pct(iv30, 1)), unit: iv30 === null ? "" : "IV, 30 days", term: rows, iv30,
      foot: iv30 === null ? "No 30-day implied volatility on the card." : "Over realised " + (num(prem) === null ? DASH : volPts(prem) + " pts") + MID + "skew " + (num(rr) === null ? DASH : volPts(rr)) + MID + (dir || "term " + DASH), missing: iv30 === null,
      parts: { prem: num(prem), skew: num(rr), dir } });

    const fs = flowSeries(card, x);
    const nope = okOf(X.nope);
    const net = fs ? fs.net : null;
    out.push({ id: "flow", title: "Flow", sub: "this session", fig: net === null ? fig(DASH) : fig(F.money(net, true), tone(net)), unit: net === null ? "" : "net premium", series: fs,
      foot: net === null ? "No session flow on the card." : "Net delta " + (fs.nd === null ? DASH : F.num(fs.nd, true)) + MID + "NOPE " + (nope ? F.pct(nope.close, 1, true) : DASH), missing: net === null, parts: { nd: fs ? fs.nd : null, nope: nope ? num(nope.close) : null } });

    const sh = okOf(X.short), svv = sh && okOf(sh.volume), si = sh && sh.interest && num(sh.interest.si) !== null ? sh.interest : null, bo = sh && okOf(sh.borrow);
    const ins = X.insiders && (X.insiders.status === "ok" || X.insiders.status === "quiet") ? X.insiders : null;
    const insV = ins && ins.status === "ok" && num(ins.net90) !== null ? ins.net90 : null;
    const svPath = svv && Array.isArray(svv.path) ? svv.path.filter((r) => isoOk(r[0]) && num(r[1]) !== null).slice(-20) : [];
    const ratio = svv ? num(svv.ratio) : null;
    out.push({ id: "positioning", title: "Positioning", sub: "short volume", fig: ratio === null ? fig(DASH) : fig(F.pct(ratio, 0)), unit: ratio === null ? "" : num(svv.z) === null ? "" : "z " + F.signed(svv.z, 1), path: svPath, mean: svv ? num(svv.mean60) : null,
      foot: ratio === null ? "No short-volume history on this name." : "Float " + (si ? F.pct(si.si, 1) : DASH) + MID + "borrow " + (bo ? F.pct(bo.fee, 2) : DASH) + MID + "insiders " + (insV === null ? DASH : F.money(insV, true)), missing: ratio === null,
      parts: { float: si ? num(si.si) : null, borrow: bo ? num(bo.fee) : null, insiders: insV } });

    const E = X.earnings && (X.earnings.status === "ok" || X.earnings.status === "thin") ? X.earnings : null;
    const nx = E && E.next && isoOk(E.next.d) ? E.next : null;
    const term = okOf(X.term);
    const em = E && E.impliedNext && num(E.impliedNext.em) !== null ? E.impliedNext.em : term && term.eventMove && num(term.eventMove.sd) !== null ? term.eventMove.sd : null;
    const evs = E && Array.isArray(E.events) ? E.events.filter((r) => Array.isArray(r) && isoOk(r[0])).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-8).map((r) => ({ d: r[0], em: num(r[2]), mv: num(r[3]) })) : [];
    const beat = evs.filter((r) => r.mv !== null && r.em !== null && r.em > 0 && Math.abs(r.mv) > r.em).length;
    const both = evs.filter((r) => r.mv !== null && r.em !== null && r.em > 0).length;
    const w = nx ? String(nx.when || "") : "";
    out.push({ id: "earnings", title: "Earnings", sub: /post|after|amc|close/i.test(w) ? "after the close" : /pre|before|bmo|open/i.test(w) ? "before the open" : nx ? (nx.confirmed ? "confirmed" : "estimated") : "",
      fig: nx ? fig(F.day(nx.d), "warn") : fig(DASH), unit: nx ? (num(nx.sessions) === null ? "" : "in " + plural(nx.sessions, "session")) : "", events: evs, next: em, bars: evs,
      foot: !nx ? (E ? "No upcoming report on the calendar." : "The card carries no earnings history for this name.") : "Priced " + (em === null ? DASH : "±" + F.pct(em, 1)) + MID + "realised " + (E && num(E.medianAbsMove) !== null ? "±" + F.pct(E.medianAbsMove, 1) : DASH) + MID + (both ? beat + " of " + both + " beat it" : DASH + " beat it"),
      missing: !nx, parts: { priced: em, realised: E ? num(E.medianAbsMove) : null, beat, of: both } });

    const ctx = okOf(P.context) || {};
    const yr = candles(card).slice(-252);
    const S = spotOf(card);
    const lo = yr.length ? Math.min(...yr.map((r) => numOr(r.l, r.c))) : null, hi = yr.length ? Math.max(...yr.map((r) => numOr(r.h, r.c))) : null;
    const pos = num(ctx.week52Pos) !== null ? ctx.week52Pos : hi !== null && hi > lo && S !== null ? (S - lo) / (hi - lo) : null;
    const r63 = yr.length > 63 ? yr[yr.length - 1].c / yr[yr.length - 64].c - 1 : null;
    const cg = okOf(P.congress);
    out.push({ id: "range", title: "Range", sub: "52 weeks", fig: pos === null ? fig(DASH) : fig(F.pct(pos, 0)), unit: pos === null ? "" : "of the way to the high", lo, hi, pos,
      chips: [["1W", num(ctx.r5)], ["1M", num(ctx.r21)], ["3M", r63]].map(([l, v]) => ({ k: l, v, text: v === null ? DASH : F.pct(v, 1, true), tone: tone(v) })),
      foot: pos === null ? "No 52-week range on the card." : "Congress " + (cg ? plural(cg.buys || 0, "buy") + MID + plural(cg.sells || 0, "sell") : DASH) + (card.sector ? MID + card.sector : ""), missing: pos === null, parts: { congress: cg ? [cg.buys || 0, cg.sells || 0] : null } });
    return out;
  }

  const niceTicks = (a, b, n) => {
    const raw = (b - a) / n, mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
    const step = (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
    const t = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) t.push(+v.toFixed(6));
    return t;
  };
  const poly = (pts) => pts.map((p) => f1(p[0]) + "," + f1(p[1])).join(" ");
  const path = (pts) => "M" + pts.map((p) => f1(p[0]) + "," + f1(p[1])).join("L");
  const cls = (n) => ({ class: n });
  const MARK_TONE = { 1: "ftg-mk-1", 2: "ftg-mk-2", 3: "ftg-mk-3", 4: "ftg-mk-4" };

  function emit(id, source) {
    document.dispatchEvent(new CustomEvent("ft:focus", { bubbles: true, detail: { id, source } }));
  }

  function drawChart(m, W, H, st) {
    const L = layout(m, W, H);
    const svg = s("svg", { class: "ftg-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", tabindex: 0, "aria-label": m.ticker + " price, the priced range and the real-world range, with levels and dealer gamma", focusable: "true" });
    const id = "ftg" + ++uid;
    const defs = s("defs", null, svg);
    const pg = s("linearGradient", { id: id + "p", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    s("stop", { offset: 0, class: "ftg-st-px", "stop-opacity": 0.16 }, pg);
    s("stop", { offset: 1, class: "ftg-st-px", "stop-opacity": 0 }, pg);
    const qg = s("linearGradient", { id: id + "q", x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
    s("stop", { offset: 0, class: "ftg-st-q", "stop-opacity": 0.04 }, qg);
    s("stop", { offset: 1, class: "ftg-st-q", "stop-opacity": 0.22 }, qg);
    const hx = s("pattern", { id: id + "h", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    s("rect", { width: 2, height: 4, class: "ftg-hatch" }, hx);
    const { XL, XR, XT, top, plotB, y, xb, xf } = L;
    s("rect", { x: XT, y: top, width: XR - XT, height: plotB - top, class: "ftg-fwd" }, svg);
    const ticks = niceTicks(m.y0, m.y1, L.phone ? 4 : 6).filter((v) => v > m.y0 && v < m.y1);
    s("path", { d: ticks.map((v) => "M" + XL + "," + f1(y(v)) + "H" + XR).join(""), class: "ftg-grid" }, svg);
    if (!L.phone) for (const v of ticks) s("text", { x: XL - 6, y: y(v) + 3.5, "text-anchor": "end", class: "ftg-tx", text: F.px(v, v % 1 ? 2 : 0) }, svg);
    const layer = (name, extra) => s("g", Object.assign({ "data-layer": name }, extra || null), svg);

    const cone = layer("cone");
    if (L.q) {
      s("polygon", { points: poly(L.q.up.concat(L.q.lo.slice().reverse())), fill: "url(#" + id + "q)" }, cone);
      s("polyline", { points: poly(L.q.up), class: "ftg-q" }, cone);
      s("polyline", { points: poly(L.q.lo), class: "ftg-q" }, cone);
    }
    if (L.p) {
      s("polyline", { points: poly(L.p.up), class: "ftg-p" }, cone);
      s("polyline", { points: poly(L.p.lo), class: "ftg-p" }, cone);
    }
    if (L.q || L.p) s("line", { x1: XT, x2: XR, y1: y(m.S), y2: y(m.S), class: "ftg-spotline" }, cone);
    if (L.q) {
      const qy = L.q.up[L.q.up.length - 1][1];
      const crowd = m.event && !L.phone && xf(m.event.h) - XT <= 210 && XR - xf(m.event.h) < 300;
      s("text", { x: XR - 4, y: qy - 6 >= top + 10 && !crowd ? qy - 6 : qy + 14, "text-anchor": "end", class: "ftg-tx ftg-q-tx", text: "Q ±" + F.pct(m.qEnd, 1) }, cone);
    }
    if (L.p) s("text", { x: XR - 4, y: clamp(L.p.lo[L.p.lo.length - 1][1] + 14, top + 10, plotB - 4), "text-anchor": "end", class: "ftg-tx ftg-p-tx", text: "P ±" + F.pct(m.pEnd, 1) }, cone);

    if (m.event) {
      const ex = xf(m.event.h);
      const ev = layer("event");
      s("line", { x1: ex, x2: ex, y1: top + 16, y2: plotB, class: "ftg-ev" }, ev);
      const right = ex - XT > 210 || XR - (ex + 16) < 200;
      const ax = right ? ex - 8 : ex + 16, anchor = right ? "end" : "start";
      if (L.phone) s("text", { x: clamp(ex, XL + 16, XR - 16), y: plotB + 14, "text-anchor": "middle", class: "ftg-tx ftg-ev-tx", text: F.day(m.event.d) }, ev);
      else {
        s("text", { x: ax, y: top + 10, "text-anchor": anchor, class: "ftg-tx ftg-ev-tx", text: "Report " + F.day(m.event.d) + (m.event.when ? ", " + m.event.when : "") }, ev);
        const t2 = s("text", { x: ax, y: top + 23, "text-anchor": anchor, class: "ftg-tx ftg-ev-sub" }, ev);
        if (m.event.q !== null) s("tspan", { class: "ftg-q-tx", text: "Q ±" + F.pct(m.event.q, 1) }, t2);
        const brief = right ? false : XR - ax < 260;
        if (m.event.q !== null && m.event.p !== null) t2.append(brief ? " " + UI.MID + " " : " priced " + UI.MID + " ");
        if (m.event.p !== null) s("tspan", { class: "ftg-p-tx", text: "P ±" + F.pct(m.event.p, 1) }, t2);
        if (m.event.p !== null && !brief) t2.append(" realised");
      }
    }

    const byKind = Object.fromEntries(m.levels.map((l) => [l.kind, l]));
    for (const [kind] of LEVEL_KINDS) {
      const l = byKind[kind];
      if (!l) continue;
      const g = layer(kind === "gamma_flip" ? "flip" : "walls");
      s("line", { x1: XT, x2: XR + 10, y1: y(l.px), y2: y(l.px), class: "ftg-lv ftg-lv-" + kind }, g);
      const lab = L.labels.find((o) => o.kind === kind);
      if (lab) {
        const lx = XR + (L.hasProf ? L.profW + 14 : 0) + 12;
        s("line", { x1: lx - 11, x2: lx - 3, y1: lab.ly1, y2: lab.ly2, class: "ftg-lead ftg-lv-" + kind }, g);
        s("text", { x: lx, y: lab.y, class: "ftg-tx ftg-lt ftg-lv-" + kind, text: lab.text }, g);
      }
    }
    if (byKind.gamma_flip && (m.flipSide === "short_below" || m.flipSide === "long_below")) {
      const g = s("g", { class: "ftg-tag", "data-layer": "flip" }, svg);
      const txt = (m.flipSide === "short_below" ? "Below " : "Above ") + F.px(byKind.gamma_flip.px) + ", hedging adds to moves";
      const tw = txt.length * 6 + 20, tx = clamp(XT + 8, XL, XR - tw), ty = clamp(y(byKind.gamma_flip.px) - 30, top, plotB - 22);
      s("rect", { x: tx, y: ty, width: tw, height: 22, rx: 6, class: "ftg-tag-r" }, g);
      s("text", { x: tx + 10, y: ty + 15, class: "ftg-tx ftg-tag-t", text: txt }, g);
    }
    const spot = L.labels.find((o) => o.kind === "spot");
    if (spot) {
      const lx = XR + (L.hasProf ? L.profW + 14 : 0) + 12;
      const g = s("g", { "data-layer": "spot" }, svg);
      s("line", { x1: lx - 11, x2: lx - 3, y1: spot.ly1, y2: spot.ly2, class: "ftg-lead ftg-lv-spot" }, g);
      s("text", { x: lx, y: spot.y, class: "ftg-tx ftg-lt ftg-lv-spot", text: spot.text }, g);
    }
    if (L.phone && byKind.gamma_flip) {
      const fl = byKind.gamma_flip;
      s("text", { x: XT + 4, y: y(fl.px) - 5, class: "ftg-tx ftg-lt ftg-lv-gamma_flip", "data-layer": "flip", text: "Flip " + F.px(fl.px) }, svg);
    }

    if (L.hasProf) {
      const g = layer("gamma");
      s("text", { x: L.profX + 4, y: top + 4, class: "ftg-tx ftg-gh", text: "Dealer γ by strike" }, g);
      s("text", { x: L.profX + 4, y: top + 17, class: "ftg-tx ftg-gv", "data-side": m.bookSide || "flat", text: m.book === null ? DASH : F.money(m.book, true) + " per 1%" }, g);
      s("line", { x1: L.profX, x2: L.profX, y1: top + 22, y2: plotB, class: "ftg-axis" }, g);
      for (const b of L.bars) s("rect", { x: L.profX + 1, y: b.y, width: Math.max(1, b.w), height: b.h, class: b.g > 0 ? "ftg-gl" : "ftg-gs", fill: b.g > 0 ? null : "url(#" + id + "h)" }, g);
    }

    const sc = L.score;
    if (sc) {
      const g = layer("score");
      s("text", { x: XL + 2, y: sc.capY, class: "ftg-tx ftg-cap", text: "Flows score, by session" }, g);
      s("line", { x1: XL, x2: XT + 4, y1: sc.mid, y2: sc.mid, class: "ftg-axis" }, g);
      sc.bars.forEach((b, i) => { if (b) s("rect", { x: b.x, y: b.y, width: L.score.bw, height: b.h, class: (b.v >= 0 ? "ftg-sp" : "ftg-sn") + (i === sc.bars.length - 1 ? " is-today" : "") }, g); });
      const last = sc.bars[sc.bars.length - 1];
      if (last) s("text", { x: XT + 10, y: sc.mid + 4, class: "ftg-tx ftg-sv", "data-tone": tone(last.v), text: F.signed(last.v) }, g);
    }

    const pts = m.hist.map((r, i) => [xb(i), y(r.c)]);
    if (pts.length > 1) {
      s("path", { d: path(pts) + "L" + f1(XT) + "," + f1(plotB) + "L" + f1(XL) + "," + f1(plotB) + "Z", fill: "url(#" + id + "p)" }, svg);
      s("path", { d: path(pts), class: "ftg-halo" }, svg);
      s("path", { d: path(pts), class: "ftg-px" }, svg);
    }
    s("line", { x1: XT, x2: XT, y1: top, y2: plotB, class: "ftg-today" }, svg);
    if (m.S !== null) {
      s("circle", { cx: XT, cy: y(m.S), r: 9, class: "ftg-dot-halo" }, svg);
      s("circle", { cx: XT, cy: y(m.S), r: 3.8, class: "ftg-dot" }, svg);
    }
    if (m.hist.length > 1) {
      const n = m.hist.length - 1, ay = plotB + 14;
      const back = [[0, "start"], [Math.round(n / 2), "middle"]];
      for (const [i, a] of back) if (i > 0 || a === "start") s("text", { x: i === 0 ? XL : xb(i), y: ay, "text-anchor": a, class: "ftg-tx", text: F.day(m.hist[i].d) }, svg);
      s("text", { x: XT, y: ay, "text-anchor": "middle", class: "ftg-tx ftg-today-tx", text: F.day(m.hist[n].d) }, svg);
      if (!L.phone) s("text", { x: xf(FWD / 2), y: ay, "text-anchor": "middle", class: "ftg-tx", text: F.day(dateAt(m, FWD / 2)) }, svg);
      if (!L.phone || !m.event) s("text", { x: XR, y: ay, "text-anchor": "end", class: "ftg-tx", text: F.day(dateAt(m, FWD)) }, svg);
    }

    if (st.claims.length) {
      const ev = st.ev;
      const seen = {};
      const anchor = {
        flip: () => [XT + (XR - XT) * 0.6, L.levelY.gamma_flip],
        event: () => (m.event ? [xf(m.event.h), top + 6] : null),
        gamma: () => (L.hasProf ? [Math.min(W - 12, L.profX + L.profW + 8), top + 34] : null),
        walls: () => { const k = ["call_wall", "put_wall", "max_pain"].find((q) => L.levelY[q] !== undefined); return k ? [XT + (XR - XT) * 0.8, L.levelY[k] - 12] : null; },
        cone: () => (L.q ? [XR - 16, clamp(L.q.up[L.q.up.length - 1][1] - 12, top + 8, plotB)] : null),
      };
      for (const c of st.claims) {
        const layerName = ev.mark[c.id];
        const at = layerName && anchor[layerName] ? anchor[layerName]() : null;
        if (!at || at[1] === undefined) continue;
        const j = seen[layerName] = (seen[layerName] || 0) + 1;
        const x = at[0] - (j - 1) * 24, yy = at[1];
        const g = s("g", { class: "ftg-mk " + MARK_TONE[c.id], "data-layer": "mark", "data-mark": c.id, tabindex: 0, role: "img", "aria-label": "Claim " + c.id + " rests on this part of the chart" }, svg);
        s("circle", { cx: x, cy: yy, r: 22, class: "ftg-mk-hit" }, g);
        s("circle", { cx: x, cy: yy, r: 17, class: "ftg-mk-halo" }, g);
        s("circle", { cx: x, cy: yy, r: 9, class: "ftg-mk-c" }, g);
        s("text", { x, y: yy + 3.8, "text-anchor": "middle", class: "ftg-mk-t", text: c.id }, g);
        g.addEventListener("mouseenter", () => emit(c.id, "mark"));
        g.addEventListener("mouseleave", () => emit(null, "mark"));
        g.addEventListener("focus", () => emit(c.id, "mark"));
        g.addEventListener("blur", () => emit(null, "mark"));
      }
    }
    const cross = s("g", { class: "ftg-cross", hidden: "", "aria-hidden": "true" }, svg);
    s("line", { x1: 0, x2: 0, y1: top, y2: plotB, class: "ftg-cross-l" }, cross);
    const dot = s("circle", { r: 4, class: "ftg-cross-d" }, cross);
    return { svg, L, cross, dot };
  }

  function legend(m, L) {
    const sw = (inner, w, hh) => { const e = s("svg", { width: w || 18, height: hh || 10, "aria-hidden": "true" }); inner(e); return e; };
    const items = [];
    const add = (svgEl, text) => items.push(h("span", { class: "ftg-key" }, svgEl, text));
    add(sw((e) => s("line", { x1: 0, y1: 4, x2: 18, y2: 4, class: "ftg-px" }, e), 18, 8), "Price");
    const miss = (t) => items.push(h("span", { class: "ftg-miss" }, t));
    if (m.q) add(sw((e) => s("rect", { x: 0.5, y: 0.5, width: 17, height: 9, rx: 2, class: "ftg-sw-q" }, e)), "Q · what options price");
    else miss("Q: " + m.why.q);
    if (m.p) add(sw((e) => s("line", { x1: 0, y1: 4, x2: 18, y2: 4, class: "ftg-p" }, e), 18, 8), "P · real-world model");
    else if (m.q) miss("P: " + (m.why.p || m.why.q));
    if (m.levels.some((l) => l.kind === "gamma_flip")) add(sw((e) => s("line", { x1: 0, y1: 4, x2: 18, y2: 4, class: "ftg-lv ftg-lv-gamma_flip" }, e), 18, 8), "Flip");
    if (m.levels.some((l) => l.kind === "call_wall" || l.kind === "put_wall")) add(sw((e) => { s("line", { x1: 0, y1: 2, x2: 18, y2: 2, class: "ftg-lv ftg-lv-call_wall" }, e); s("line", { x1: 0, y1: 6, x2: 18, y2: 6, class: "ftg-lv ftg-lv-put_wall" }, e); }, 18, 8), "Call and put walls");
    if (!m.levels.length) miss("Levels: none near spot on this card.");
    if (m.bars.length && !L.phone) add(sw((e) => { s("rect", { x: 0, y: 1, width: 8, height: 8, class: "ftg-gl" }, e); s("rect", { x: 10, y: 1, width: 8, height: 8, class: "ftg-gs ftg-gs-sw" }, e); }), "Dealer γ long, short");
    else if (!m.bars.length) miss("Dealer γ: " + m.why.gamma);
    if (!m.score.has) miss("Score: " + m.why.score);
    if (m.why.event && m.q) miss(m.why.event);
    return items;
  }

  function cardSvg(label) {
    return s("svg", { class: "ftg-csvg", viewBox: "0 0 184 66", width: "100%", height: 66, role: "img", "aria-label": label });
  }
  function termLabel(rows) {
    if (rows.length < 2) return "";
    const a = rows[0], b = rows[rows.length - 1];
    return "Term structure " + (b.v > a.v ? "rising" : b.v < a.v ? "falling" : "flat") + " from " + F.pct(a.v, 1) + " at " + a.d + " days to " + F.pct(b.v, 1) + " at " + b.d + " days";
  }
  function cardChart(c) {
    if (c.id === "signal") {
      const box = h("div", { class: "ftg-fams" });
      for (const r of c.rows) {
        const f = r.v === null ? 0 : clamp(Math.abs(r.v), 0, 100) / 100;
        const bar = h("i", { class: "ftg-fb", "data-tone": r.signed ? tone(r.v) : "meter", style: { left: (r.signed ? (r.v < 0 ? 50 - f * 50 : 50) : 0) + "%", width: (r.signed ? f * 50 : f * 100) + "%" } });
        box.append(h("div", { class: "ftg-fam", "data-fam": r.k }, h("span", { class: "ftg-fk" }, r.k), h("span", { class: "ftg-ft" + (r.signed ? " is-signed" : "") }, r.v === null ? null : bar), h("span", { class: "ftg-fv", "data-tone": r.signed ? tone(r.v) : "flat" }, r.text)));
      }
      return box;
    }
    if (c.id === "volatility") {
      const rows = c.term;
      if (rows.length < 2) return null;
      const svg = cardSvg(termLabel(rows));
      const l0 = Math.log(rows[0].d), l1 = Math.log(rows[rows.length - 1].d);
      const vs = rows.map((r) => r.v), lo = Math.min(...vs), span = Math.max(Math.max(...vs) - lo, 0.01);
      const tx = (d) => 10 + (l1 === l0 ? 0.5 : (Math.log(d) - l0) / (l1 - l0)) * 164, ty = (v) => 52 - (v - lo) / span * 40;
      s("line", { x1: 6, x2: 178, y1: 54, y2: 54, class: "ftg-base" }, svg);
      s("polyline", { points: poly(rows.map((r) => [tx(r.d), ty(r.v)])), class: "ftg-term" }, svg);
      let at = rows[0];
      for (const r of rows) if (Math.abs(r.d - 30) < Math.abs(at.d - 30)) at = r;
      for (const r of rows) s("circle", { cx: f1(tx(r.d)), cy: f1(ty(r.v)), r: r === at ? 3.6 : 2.4, class: r === at ? "ftg-term-d is-atm" : "ftg-term-d" }, svg);
      s("text", { x: tx(at.d), y: ty(at.v) - 7, "text-anchor": "middle", class: "ftg-ct ftg-ct-b", text: F.pct(at.v, 1).replace("%", "") }, svg);
      s("text", { x: 10, y: 65, class: "ftg-ct", text: rows[0].d + "d" }, svg);
      if (at !== rows[0] && at !== rows[rows.length - 1]) s("text", { x: tx(at.d), y: 65, "text-anchor": "middle", class: "ftg-ct", text: at.d + "d" }, svg);
      s("text", { x: 178, y: 65, "text-anchor": "end", class: "ftg-ct", text: rows[rows.length - 1].d + "d" }, svg);
      return svg;
    }
    if (c.id === "flow") {
      const ps = c.series ? c.series.p.map((v, i) => [v, i]).filter((r) => r[0] !== null) : [];
      if (ps.length < 2) return null;
      const svg = cardSvg("Cumulative net premium through the session, ending at " + F.money(c.series.net, true));
      const n = c.series.p.length - 1, vs = ps.map((r) => r[0]), hi = Math.max(0, ...vs), lo = Math.min(0, ...vs), span = Math.max(hi - lo, 1e-9);
      const fx = (i) => 4 + i * 176 / n, fy = (v) => 8 + (hi - v) / span * 44;
      const line = ps.map((r) => [fx(r[1]), fy(r[0])]), zero = fy(0), id = "ftgf" + ++uid;
      const defs = s("defs", null, svg);
      s("rect", { x: 0, y: 0, width: 184, height: zero }, s("clipPath", { id: id + "a" }, defs));
      s("rect", { x: 0, y: zero, width: 184, height: 66 - zero }, s("clipPath", { id: id + "b" }, defs));
      const area = "M" + f1(line[0][0]) + "," + f1(zero) + "L" + line.map((p) => f1(p[0]) + "," + f1(p[1])).join("L") + "L" + f1(line[line.length - 1][0]) + "," + f1(zero) + "Z";
      s("path", { d: area, class: "ftg-fa ftg-up", "clip-path": "url(#" + id + "a)" }, svg);
      s("path", { d: area, class: "ftg-fa ftg-down", "clip-path": "url(#" + id + "b)" }, svg);
      s("polyline", { points: poly(line), class: "ftg-fl ftg-up", "clip-path": "url(#" + id + "a)" }, svg);
      s("polyline", { points: poly(line), class: "ftg-fl ftg-down", "clip-path": "url(#" + id + "b)" }, svg);
      s("line", { x1: 4, x2: 180, y1: f1(zero), y2: f1(zero), class: "ftg-zero" }, svg);
      if (c.series.t0) s("text", { x: 4, y: 65, class: "ftg-ct", text: c.series.t0 }, svg);
      if (c.series.t1) s("text", { x: 180, y: 65, "text-anchor": "end", class: "ftg-ct", text: c.series.t1 }, svg);
      return svg;
    }
    if (c.id === "positioning") {
      const vals = c.path.map((r) => r[1]);
      if (vals.length < 2) return null;
      const svg = cardSvg("Short volume over " + vals.length + " sessions, ending at " + F.pct(vals[vals.length - 1], 0) + (c.mean !== null ? " against a 60-day mean of " + F.pct(c.mean, 0) : ""));
      const all = vals.concat(c.mean === null ? [] : [c.mean]), lo = Math.min(...all), span = Math.max(Math.max(...all) - lo, 0.01);
      const sx = (i) => 4 + i * 172 / (vals.length - 1), sy = (v) => 52 - (v - lo) / span * 40;
      if (c.mean !== null) {
        s("line", { x1: 4, x2: 180, y1: f1(sy(c.mean)), y2: f1(sy(c.mean)), class: "ftg-mean" }, svg);
        s("text", { x: 4, y: sy(c.mean) + 12, class: "ftg-ct", text: "60-day mean " + F.pct(c.mean, 0) }, svg);
      }
      s("polyline", { points: poly(vals.map((v, i) => [sx(i), sy(v)])), class: "ftg-pos" }, svg);
      s("circle", { cx: f1(sx(vals.length - 1)), cy: f1(sy(vals[vals.length - 1])), r: 3.4, class: "ftg-pos-d" }, svg);
      return svg;
    }
    if (c.id === "earnings") {
      const rows = c.bars;
      if (!rows.length) return null;
      const svg = cardSvg("The last " + rows.length + " report moves against what options priced" + (c.next !== null ? "; options price plus or minus " + F.pct(c.next, 1) + " for the next" : ""));
      const mx = Math.max(0.005, ...rows.map((r) => Math.abs(r.mv || 0)), ...rows.map((r) => r.em || 0), c.next || 0) * 1.1;
      const slot = 176 / 9, x0 = 4 + (9 - rows.length - 1) * slot;
      s("line", { x1: 4, x2: 180, y1: 54, y2: 54, class: "ftg-base" }, svg);
      rows.forEach((r, i) => {
        const x = x0 + i * slot + (slot - 12) / 2;
        if (r.mv !== null) { const hh = Math.max(1.5, Math.abs(r.mv) / mx * 44); s("rect", { x: f1(x), y: f1(54 - hh), width: 12, height: f1(hh), rx: 2, class: "ftg-eb " + (r.mv >= 0 ? "ftg-up" : "ftg-down") }, svg); }
        if (r.em !== null) s("rect", { x: f1(x), y: f1(54 - r.em / mx * 44 - 1), width: 12, height: 2, class: "ftg-priced" }, svg);
      });
      if (c.next !== null) { const hh = c.next / mx * 44; s("rect", { x: f1(x0 + rows.length * slot + (slot - 12) / 2), y: f1(54 - hh), width: 12, height: f1(hh), rx: 2, class: "ftg-next" }, svg); }
      s("text", { x: 4, y: 65, class: "ftg-ct", text: "Last " + rows.length + " reports" }, svg);
      if (c.next !== null) s("text", { x: 180, y: 65, "text-anchor": "end", class: "ftg-ct ftg-ev-tx", text: "Next" }, svg);
      return svg;
    }
    if (c.pos === null) return null;
    const svg = s("svg", { class: "ftg-csvg", viewBox: "0 0 184 40", width: "100%", height: 40, role: "img", "aria-label": "Price is " + Math.round(c.pos * 100) + " percent of the way from the 52-week low of " + F.px(c.lo) + " to the high of " + F.px(c.hi) });
    const p = clamp(c.pos, 0, 1);
    s("rect", { x: 4, y: 8, width: 176, height: 6, rx: 3, class: "ftg-rail" }, svg);
    s("rect", { x: 4, y: 8, width: f1(176 * p), height: 6, rx: 3, class: "ftg-rail-f" }, svg);
    s("line", { x1: f1(4 + 176 * p), x2: f1(4 + 176 * p), y1: 3, y2: 19, class: "ftg-rail-m" }, svg);
    s("text", { x: 4, y: 32, class: "ftg-ct", text: F.px(c.lo) }, svg);
    s("text", { x: 180, y: 32, "text-anchor": "end", class: "ftg-ct", text: F.px(c.hi) }, svg);
    return svg;
  }

  function cardEl(c) {
    const id = "ftgc-" + c.id + "-" + ++uid;
    const body = cardChart(c);
    const footParts = c.foot;
    const el = h("section", { class: "ftg-card", id, "data-card": c.id, tabindex: 0, "aria-labelledby": id + "-t", "aria-describedby": id + "-d", "data-missing": c.missing ? "1" : null },
      h("div", { class: "ftg-ch" }, h("h3", { id: id + "-t" }, c.title), h("span", { class: "ftg-sub" }, c.sub), h("span", { class: "ftg-badges" })),
      h("div", { class: "ftg-fig" }, h("span", { class: "ftg-f", "data-tone": c.fig.tone }, c.fig.text), h("span", { class: "ftg-u" }, c.unit)),
      body ? h("div", { class: "ftg-cb" }, body) : null,
      c.chips ? h("div", { class: "ftg-chips" }, c.chips.map((k) => h("span", { class: "ftg-chip", "data-tone": k.tone }, h("span", { class: "ftg-ck" }, k.k), " " + k.text))) : null,
      h("p", { class: "ftg-foot" }, footParts),
      h("span", { class: "visually-hidden", id: id + "-d" }, c.title + ", " + c.sub + ". " + c.fig.text + " " + c.unit + ". " + footParts));
    const on = () => { const ids = (el.getAttribute("data-claims") || "").split(" ").filter(Boolean); if (ids.length) emit(ids[0], "card"); };
    const off = () => { if ((el.getAttribute("data-claims") || "").trim()) emit(null, "card"); };
    el.addEventListener("mouseenter", on);
    el.addEventListener("mouseleave", off);
    el.addEventListener("focus", on);
    el.addEventListener("blur", off);
    return el;
  }

  function mount(card, hosts, opts) {
    const st = { card, opts: Object.assign({}, opts), x: {}, range: RANGES[opts && opts.range] ? opts.range : "1M", claims: [], ev: evidence([]), m: null, chart: null, raf: 0, cur: null, dead: false };
    if (opts && (opts.cardX || opts.tape)) st.x = { cardX: opts.cardX, tape: opts.tape };
    const chartHost = hosts && hosts.chart, cardsHost = hosts && hosts.cards;
    const root = h("div", { class: "ftg-chart" });
    const svgBox = h("div", { class: "ftg-box" });
    const legendEl = h("div", { class: "ftg-legend" });
    const readEl = h("div", { class: "ftg-readout", "aria-live": "polite" });
    const descEl = h("p", { class: "visually-hidden", id: "ftg-d" + ++uid });
    root.append(svgBox, h("div", { class: "ftg-lrow" }, legendEl, readEl), descEl);
    if (chartHost) { chartHost.classList.add("ftg-host"); chartHost.replaceChildren(root); }
    const grid = h("div", { class: "ftg-cards-in" });
    if (cardsHost) { cardsHost.classList.add("ftg-host"); cardsHost.replaceChildren(grid); }

    const apply = () => {
      const reading = st.claims.length > 0;
      for (const host of [root, grid]) {
        for (const n of host.querySelectorAll("[data-ftg-state]")) n.removeAttribute("data-ftg-state");
        for (const n of host.querySelectorAll("[data-layer],[data-card]")) {
          if (!reading) { n.removeAttribute("data-claims"); continue; }
          const k = n.getAttribute("data-layer") || n.getAttribute("data-card");
          const ids = k === "mark" ? [n.getAttribute("data-mark")] : k === "spot" ? null : st.ev.by[k] || [];
          if (ids === null) n.removeAttribute("data-claims"); else n.setAttribute("data-claims", ids.join(" "));
        }
        for (const n of host.querySelectorAll(".ftg-badges")) {
          const ids = (n.parentNode.parentNode.getAttribute("data-claims") || "").split(" ").filter(Boolean);
          n.replaceChildren(...ids.map((i) => h("span", { class: "ftg-badge " + MARK_TONE[i] }, i)));
        }
      }
    };
    const setClaims = () => {
      st.claims = st.opts.reading || st.opts.claims ? claimsOf(st.opts.reading, st.opts.claims) : [];
      st.ev = evidence(st.claims);
    };
    const focus = (e) => {
      if (!st.claims.length) return;
      const id = e.detail && e.detail.id ? String(e.detail.id) : null;
      for (const n of [].concat([...root.querySelectorAll("[data-claims]")], [...grid.querySelectorAll("[data-claims]")])) {
        if (id === null) n.removeAttribute("data-ftg-state");
        else n.setAttribute("data-ftg-state", (n.getAttribute("data-claims") || "").split(" ").includes(id) ? "hot" : "dim");
      }
      root.setAttribute("data-ftg-hot", id || "");
    };
    document.addEventListener("ft:focus", focus);

    const showCross = (i) => {
      const c = st.chart;
      if (!c) return;
      st.cur = i === null ? null : clamp(i, 0, c.L.xs.length - 1);
      if (st.cur === null) { c.cross.setAttribute("hidden", ""); readEl.textContent = ""; return; }
      const xx = c.L.xs[st.cur], n = st.m.hist.length;
      const v = st.cur < n ? st.m.hist[st.cur].c : st.m.S;
      c.cross.removeAttribute("hidden");
      c.cross.firstChild.setAttribute("x1", xx);
      c.cross.firstChild.setAttribute("x2", xx);
      c.dot.setAttribute("cx", xx);
      c.dot.setAttribute("cy", c.L.y(v === null ? st.m.y0 : v));
      c.dot.toggleAttribute("hidden", st.cur >= n);
      readEl.textContent = readout(st.m, st.cur);
    };
    const nearest = (px) => { const xs = st.chart.L.xs; let b = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[b] - px)) b = i; return b; };

    const paintChart = () => {
      if (st.dead || !chartHost) return;
      const W = Math.max(200, Math.floor(chartHost.clientWidth || root.clientWidth || 600));
      const room = chartHost.clientHeight - (root.offsetHeight - svgBox.offsetHeight);
      const fit = window.matchMedia && window.matchMedia("(min-width: 1100px)").matches && room >= 250;
      const Hh = fit ? clamp(Math.floor(room) - 20, 230, 640) : W < 520 ? clamp(Math.round(W * 0.54), 170, 260) : clamp(Math.round(W * 0.396), 230, 520);
      st.m = model(st.card, st.range, st.x);
      st.W = W;
      const had = st.cur;
      const c = drawChart(st.m, W, Hh, st);
      st.chart = c;
      svgBox.replaceChildren(c.svg);
      legendEl.replaceChildren(...legend(st.m, c.L));
      descEl.textContent = describe(st.m);
      c.svg.setAttribute("aria-describedby", descEl.id);
      c.svg.addEventListener("keydown", (e) => {
        const n = c.L.xs.length;
        const to = e.key === "ArrowRight" ? (st.cur === null ? st.m.hist.length - 1 : st.cur + 1) : e.key === "ArrowLeft" ? (st.cur === null ? st.m.hist.length - 1 : st.cur - 1) : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "Escape" ? null : undefined;
        if (to === undefined) return;
        e.preventDefault();
        showCross(to);
      });
      c.svg.addEventListener("focus", () => { if (st.cur === null) showCross(st.m.hist.length - 1); });
      c.svg.addEventListener("blur", () => showCross(null));
      c.svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") showCross(nearest(e.clientX - c.svg.getBoundingClientRect().left)); });
      c.svg.addEventListener("pointerleave", () => showCross(null));
      apply();
      if (had !== null) showCross(had);
    };
    const paintCards = () => {
      if (st.dead || !cardsHost) return;
      grid.replaceChildren(...cards(st.card, st.x).map((c) => cardEl(c)));
      apply();
    };
    const paintAll = () => { paintChart(); paintCards(); };
    setClaims();
    paintAll();
    let ro = null;
    if (chartHost && typeof ResizeObserver === "function") {
      let last = chartHost.clientWidth;
      ro = new ResizeObserver(() => {
        const w = chartHost.clientWidth;
        if (w === last) return;
        last = w;
        cancelAnimationFrame(st.raf);
        st.raf = requestAnimationFrame(paintChart);
      });
      ro.observe(chartHost);
    }
    return {
      setRange(r) { if (RANGES[r] && r !== st.range) { st.range = r; paintChart(); } },
      update(next) {
        if (next && typeof next === "object") {
          for (const k of ["reading", "summary", "claims"]) if (k in next) st.opts[k] = next[k];
          if ("cardX" in next) st.x = Object.assign({}, st.x, { cardX: next.cardX });
          if ("tape" in next) st.x = Object.assign({}, st.x, { tape: next.tape });
          if (next.card) st.card = next.card;
        }
        setClaims();
        paintAll();
      },
      destroy() {
        st.dead = true;
        document.removeEventListener("ft:focus", focus);
        if (ro) ro.disconnect();
        cancelAnimationFrame(st.raf);
        root.remove();
        grid.remove();
      },
    };
  }

  const glance = Object.freeze({ mount, model: Object.assign(model, { layout, cluster, cards, readout, describe, claims: claimsOf, evidence, evidenceOf: (layer) => EVIDENCE[layer] || null, stepsFor }) });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { tickerGlance: glance }));
})();
