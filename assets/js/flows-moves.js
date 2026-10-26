(() => {
  "use strict";

  const MINUS = "−", DASH = "—";
  const SESSIONS = 252;
  const FLOOR_N = 250;
  const EVENT_SESSIONS = 21;
  const SQRT_YEAR = Math.sqrt(252);
  const TOP_INTERACTIVE = 60;
  const DOMAIN_Q = 0.995;
  const MIN_DOT = 2.5;
  const PINS = ["SPY", "QQQ"];
  const LINE = "A ranking, not a test: no error rate measured.";
  const CAPTION = "IV as of the previous close.";
  const APART = "Earnings within 30 days: event not separated.";
  const X_LINE = "Across: the move in the name's own typical days.";
  const Y_LINE = "Up: the move as a multiple of the implied day.";
  const SIZE_LINE = "Dot area is market cap; the smallest dot when unknown.";
  const REF_LINE = "Dashed lines are reference marks, not a test.";
  const SIG_Q = 0.1, SIG_MIN_Z = 2;
  const SIG_FLAGGED_LINE = "Beyond the usual for this name, after correcting for how many names were tested.";
  const SIG_PLAIN_LINE = "Not beyond the usual for this name, after correcting for how many were tested.";
  const SIG_REASONS = { below: "Below 2 typical days: not tested, but counted in the correction.", event: "Earnings within 30 days: not tested.", noscale: "No typical day is published, so no test.", nocount: "The count of days beyond that is not published, so no test." };
  const SIG_INFO_SENTENCES = ["The test asks if today's move is beyond the name's own one-year rate.", "The rate is days beyond 2 or 3 typical days, plus one, over 253.", "So the smallest p is 1 in 253, and few names can pass.", "Every name with a typical day and no earnings is counted in the correction.", "Names are corrected together at a 10% false-discovery rate.", "Big market days move many names at once, so the test can overstate.", "It is a ranking aid, not a forecast."];
  const SIG_FOOT_NONE = "No name could be tested.";
  const PEER_MIN = 10;
  const MAD_SCALE = 1.4826;
  const PARTS_LABELS = { market: "Market (SPY)", peers: "Peers' median", peersVsMarket: "Peers vs market", nameVsPeers: "Name vs peers", nameVsMarket: "Name vs market" };
  const PARTS_SENTENCES = ["Parts of the move: market, peers against market, the name against its peers.", "Market is the change in SPY. Peers are the other names in the sector.", "Peers need at least 10 names. SPY and QQQ are never peers.", "The parts add to the move. They are not beta-adjusted.", "Peer spread is 1.48 times the median distance of peers from their median."];
  const FROZEN_LINE = "Scores held. Resume to apply the latest read.";
  const SHAPE = { up: "▲", dn: "▼", fl: "◆" };
  const TRI = 2 * Math.sqrt(Math.PI / (3 * Math.sqrt(3)));

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ivDays = (chg, iv) => (num(chg) === null || num(iv) === null || !(iv > 0) ? null : chg / (iv / SQRT_YEAR));
  const signed = (m) => (m < 0 ? MINUS : m > 0 ? "+" : "") + Math.abs(m).toFixed(1);
  const dirOf = (m) => (m > 0 ? "up" : m < 0 ? "dn" : "fl");
  const toneOf = (d) => (d === "up" ? "up" : d === "dn" ? "down" : "mut");
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const cardKey = (t) => String(t === null || t === undefined ? "" : t).toUpperCase().replace(/[.\-\s]/g, "");
  const tickerHref = (t) => "/flows/ticker/?t=" + encodeURIComponent(String(t).toUpperCase().replace(/[^A-Z0-9.\-]/g, ""));
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const oneIn = (p) => Math.max(1, Math.round(1 / p));
  const pctText = (x) => (x * 100).toFixed(x * 100 >= 10 ? 0 : 1) + "%";
  function wilson(hits, n) {
    const z = 1.96, p = hits / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
    const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return { lo: Math.max(0, (c - w) / d), hi: Math.min(1, (c + w) / d) };
  }
  function rarityParts(x) {
    if (x.sig === null || !(x.sig > 0)) return null;
    const k = Math.abs(x.chg) / x.sig;
    const level = k >= 3 ? 3 : k >= 2 ? 2 : 0;
    const hits = level === 3 ? x.f3 : level === 2 ? x.f2 : null;
    if (!level || hits === null || !Number.isInteger(hits) || hits < 0 || hits > SESSIONS) return null;
    let how, short;
    if (hits === 0 || SESSIONS / hits > FLOOR_N) {
      how = "rarer than 1 in " + FLOOR_N + " sessions for this name over the last year";
      short = "beyond 1 in " + FLOOR_N;
      if (hits === 0) how += ", and fewer than 1 in " + Math.floor(1 / (1 - Math.pow(0.05, 1 / SESSIONS)) / 10) * 10 + " at 95%";
    } else {
      how = "about 1 in " + oneIn(hits / SESSIONS) + " sessions for this name over the last year";
      short = "1 in " + oneIn(hits / SESSIONS);
      if (hits >= 5) { const w = wilson(hits, SESSIONS); how += " (95% interval 1 in " + oneIn(w.hi) + " to 1 in " + oneIn(w.lo) + ")"; }
    }
    return { level, hits, short, text: "a " + level + "x typical-day move: typical day " + pctText(x.sig) + "; " + how };
  }
  function rarityWhy(x) {
    if (x.sig === null || !(x.sig > 0)) return "No typical day is published for this name.";
    if (Math.abs(x.chg) / x.sig < 2) return "No count is kept below 2 typical days.";
    return "The count of days beyond that is not published.";
  }

  function sigOf(x) {
    const chg = num(x.chg), sig = num(x.sig), ed = num(x.ed);
    if (chg === null || sig === null || !(sig > 0)) return { t: x.t, state: "noscale", z: null, level: null, hits: null, p: null };
    const z = chg / sig;
    if (ed !== null && ed <= EVENT_SESSIONS) return { t: x.t, state: "event", z, level: null, hits: null, p: null };
    const k = Math.abs(z);
    if (k < SIG_MIN_Z) return { t: x.t, state: "below", z, level: null, hits: null, p: 1 };
    const level = k >= 3 ? 3 : 2;
    const hits = level === 3 ? x.f3 : x.f2;
    if (!Number.isInteger(hits) || hits < 0 || hits > SESSIONS) return { t: x.t, state: "nocount", z, level, hits: null, p: null };
    return { t: x.t, state: "tested", z, level, hits, p: (hits + 1) / (SESSIONS + 1) };
  }
  function sigRun(rows, q) {
    const items = rows.map(sigOf);
    const idx = [];
    items.forEach((it, i) => { if (it.p !== null) idx.push(i); });
    const m = idx.length;
    const adj = items.map(() => null);
    idx.sort((a, b) => items[a].p - items[b].p);
    let prev = 1;
    for (let r = m - 1; r >= 0; r--) {
      prev = Math.min(prev, items[idx[r]].p * m / (r + 1));
      adj[idx[r]] = prev;
    }
    let tested = 0, flagged = 0;
    const out = items.map((it, i) => {
      const flag = it.state === "tested" && adj[i] <= q;
      if (it.state === "tested") tested++;
      if (flag) flagged++;
      return { ...it, adj: it.state === "tested" ? adj[i] : null, flag, counted: it.p !== null };
    });
    return { q, m, tested, flagged, items: out };
  }

  const quantile = (vals) => {
    if (!vals.length) return 0;
    const v = vals.slice().sort((a, b) => a - b);
    return v[Math.max(0, Math.ceil(DOMAIN_Q * v.length) - 1)];
  };
  function domainOf(pts) {
    const p = pts.filter((x) => x.z !== null);
    return { xmax: Math.min(12, Math.max(3, Math.ceil(quantile(p.map((x) => Math.abs(x.z)))))), ymax: Math.min(10, Math.max(3, Math.ceil(quantile(p.map((x) => x.a))))) };
  }
  const radiusOf = (cap, capMax, rMax) => (cap > 0 && capMax > 0 ? Math.max(MIN_DOT, rMax * Math.sqrt(cap / capMax)) : MIN_DOT);

  function markerPath(dir, r) {
    if (dir === "fl") return "M" + -r + ",0a" + r + "," + r + " 0 1,0 " + 2 * r + ",0a" + r + "," + r + " 0 1,0 " + -2 * r + ",0Z";
    const R = r * TRI, s = dir === "up" ? -1 : 1;
    const a = (R * Math.sqrt(3)) / 2;
    return "M0," + s * R + "L" + a + "," + -s * R / 2 + "L" + -a + "," + -s * R / 2 + "Z";
  }

  const med = (v) => {
    const s = v.slice().sort((a, b) => a - b);
    const k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };
  const tenthsOf = (v) => Math.round(v * 1000) + 0;
  function peerParts(rows, t) {
    const me = rows.find((r) => r.t === t);
    const chg = me ? num(me.chg) : null;
    if (chg === null) return null;
    const spy = t === "SPY" ? null : rows.find((r) => r.t === "SPY");
    const market = spy ? num(spy.chg) : null;
    let peers = null, peerWhy = null;
    if (PINS.includes(t)) peerWhy = "A market reference has no peers.";
    else if (!me.sector) peerWhy = "No sector, so no peers.";
    else {
      const v = [];
      for (const r of rows) if (r !== me && r.t !== t && !PINS.includes(r.t) && r.sector === me.sector && num(r.chg) !== null) v.push(r.chg);
      if (v.length < PEER_MIN) peerWhy = v.length + " peers, needs " + PEER_MIN + ".";
      else {
        const s = med(v);
        const d = MAD_SCALE * med(v.map((x) => Math.abs(x - s)));
        peers = { n: v.length, median: s, spread: d, z: d > 0 ? (chg - s) / d : null };
      }
    }
    const levels = [];
    if (market !== null) levels.push(["market", PARTS_LABELS.market, market]);
    if (peers) levels.push(["peers", market !== null ? PARTS_LABELS.peersVsMarket : PARTS_LABELS.peers, peers.median]);
    const parts = [];
    if (levels.length) {
      let from = 0;
      for (const [key, label, v] of levels) {
        parts.push({ key, label, tenths: tenthsOf(v) - from });
        from = tenthsOf(v);
      }
      parts.push({ key: "name", label: peers ? PARTS_LABELS.nameVsPeers : PARTS_LABELS.nameVsMarket, tenths: tenthsOf(chg) - from });
    }
    return { t, chg, total: tenthsOf(chg), market, peers, peerWhy, parts };
  }

  if (typeof document === "undefined") {
    globalThis.__MovesTest = Object.freeze({ rarityParts, sigRun, SIG_Q, ivDays, signed, domainOf, radiusOf, markerPath, TRI, peerParts });
    return;
  }

  const UI = window.FlowsUI;
  const statusEl = document.getElementById("mvStatus");
  if (!UI || !statusEl) return;
  const { F } = UI;
  const $ = (id) => document.getElementById(id);
  const mobile = () => matchMedia("(max-width:899px)").matches;
  const coarse = () => matchMedia("(pointer:coarse)").matches;
  const plural = (n, a, b) => n + " " + (n === 1 ? a : b);

  const S = { rows: null, known: new Map(), day: null, generatedAt: null, live: null, frozen: false, frozenAt: null, listHeld: false, dirty: false, model: null, sel: null, dir: null, earn: false, sector: "", hit: [], geo: null, topN: 6 };
  const cards = new Map();
  let cardTimer = 0;

  function uniRows(u) {
    if (!u || u.status !== "ok" || !Array.isArray(u.t) || !u.cols || !u.units) return null;
    const col = (k) => {
      const c = u.cols[k], sc = u.units[k] && num(u.units[k][1]);
      return Array.isArray(c) && sc ? c.map((x) => (num(x) === null ? null : x / sc)) : null;
    };
    const chg = col("chg"), iv = col("iv30p"), ed = col("ed"), cap = col("mcap"), sig = col("sig"), f2 = col("f2"), f3 = col("f3");
    if (!chg) return null;
    const names = Array.isArray(u.sectors) ? u.sectors : [];
    const sec = Array.isArray(u.sec) ? u.sec : [];
    const sector = (i) => (typeof names[sec[i]] === "string" && names[sec[i]] ? names[sec[i]] : null);
    return { cap: Boolean(cap), rows: u.t.map((t, i) => ({ t, chg: chg[i], iv: iv ? iv[i] : null, ed: ed ? ed[i] : null, sector: sector(i), cap: cap && cap[i] > 0 ? cap[i] : null, sig: sig ? sig[i] : null, f2: f2 ? f2[i] : null, f3: f3 ? f3[i] : null })) };
  }

  function liveRows() {
    const s = UI.rt && UI.rt.feeds && UI.rt.feeds("px") && UI.rt.strips ? UI.rt.strips() : null;
    if (!s || s.status !== "ok" || !Array.isArray(s.fields) || !s.rows || !S.day || !(s.session > S.day)) return null;
    const ci = s.fields.indexOf("chg"), ii = s.fields.indexOf("iv30p");
    if (ci < 0 || ii < 0) return null;
    const pick = (t, k) => (S.known.has(t) ? S.known.get(t)[k] : null);
    return { session: s.session, rows: Object.keys(s.rows).map((t) => ({ t, chg: num(s.rows[t][ci]), iv: num(s.rows[t][ii]), ed: pick(t, "ed"), sector: pick(t, "sector"), cap: pick(t, "cap"), sig: pick(t, "sig"), f2: pick(t, "f2"), f3: pick(t, "f3") })) };
  }

  function points(rows) {
    const out = [];
    for (const r of rows) {
      const m = ivDays(r.chg, r.iv);
      if (m === null) continue;
      const sig = num(r.sig);
      const ed = num(r.ed);
      out.push({ t: r.t, chg: r.chg, iv: r.iv, m, a: Math.abs(m), z: sig !== null && sig > 0 ? r.chg / sig : null, sig, f2: num(r.f2), f3: num(r.f3), sector: r.sector || null, cap: r.cap || null, ed, event: ed !== null && ed <= EVENT_SESSIONS });
    }
    return out;
  }

  const byA = (a, b) => b.a - a.a || cmp(a.t, b.t);
  const match = (x) => !(S.dir === "up" && !(x.m > 0)) && !(S.dir === "down" && !(x.m < 0)) && !(S.earn && !x.event) && !(S.sector && (x.sector || "__none") !== S.sector);

  function model() {
    const live = S.live;
    const rows = live ? live.rows : S.rows;
    const all = points(rows || []);
    const plotted = all.filter((x) => x.z !== null);
    const pins = plotted.filter((x) => PINS.includes(x.t));
    const sg = sigRun(all, SIG_Q);
    all.forEach((x, i) => { x.sg = sg.items[i]; });
    return { live, sg, rows: rows || [], all, plotted, pins, dom: domainOf(plotted), capMax: Math.max(0, ...plotted.filter((x) => !PINS.includes(x.t)).map((x) => x.cap || 0)) };
  }

  function lists(M) {
    const ok = M.all.filter(match);
    return { now: ok.filter((x) => !x.event).sort(byA), apart: ok.filter((x) => x.event).sort(byA), ok };
  }

  const fday = (s) => F.day(s);
  const pct = (v) => F.pct(v, 1, true);

  function paintHead(M) {
    const readAt = S.generatedAt;
    const read = readAt && F.trtDay(readAt) ? fday(F.trtDay(readAt)) + " " + F.time(readAt) : DASH;
    const parts = M.live ? [["Live roster, session "], [fday(M.live.session), true]] : [["Nightly, session "], [S.day ? fday(S.day) : DASH, true], [" · read " + read]];
    parts.push([" · " + M.plotted.length + " of " + M.rows.length + " names with a typical day"]);
    if (S.frozen) parts.push([" · "], ["Frozen at " + F.time(S.frozenAt), true], [" · " + FROZEN_LINE]);
    const stamp = $("mvStamp");
    stamp.replaceChildren(...parts.map(([text, bold]) => {
      if (!bold) return document.createTextNode(text);
      const b = document.createElement("b");
      b.textContent = text;
      return b;
    }));
    statusEl.textContent = M.all.length ? "Measured " + M.all.length + " names; " + M.plotted.length + " drawn." : "No name could be measured.";
  }

  function paintFilters(M) {
    for (const b of $("mvDir").children) b.setAttribute("aria-pressed", String(S.dir === b.dataset.dir));
    $("mvEarn").setAttribute("aria-pressed", String(S.earn));
    $("mvFreeze").setAttribute("aria-pressed", String(S.frozen));
    $("mvFreeze").textContent = S.frozen ? "Resume" : "Freeze";
    const sel = $("mvSector");
    const names = [...new Set(M.all.map((x) => x.sector || "__none"))].sort((a, b) => (a === "__none") - (b === "__none") || cmp(a, b));
    const sig = names.join("|") + "#" + S.sector;
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.replaceChildren(...[["", "All sectors"], ...names.map((n) => [n, n === "__none" ? "No sector" : n])].map(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; return o; }));
      sel.value = S.sector;
    }
    const any = S.dir || S.earn || S.sector;
    $("mvClear").hidden = !any;
  }

  function geometry() {
    const host = $("mvPlot");
    const W = host.clientWidth, H = host.clientHeight;
    if (!(W > 40) || !(H > 40)) return null;
    const compact = W < 560;
    return { W, H, L: compact ? 34 : 44, R: 12, T: 10, B: compact ? 30 : 34, compact };
  }

  function drawPlot() {
    const M = S.model, host = $("mvPlot");
    if (!M) return;
    const g = geometry();
    if (!g) return;
    const { W, H, L, R, T, B, compact } = g;
    const { xmax, ymax } = M.dom;
    const iw = W - L - R, ih = H - T - B;
    const px = (z) => L + ((Math.max(-xmax, Math.min(xmax, z)) + xmax) / (2 * xmax)) * iw;
    const py = (r) => T + (1 - Math.max(0, Math.min(ymax, r)) / ymax) * ih;
    const rMax = compact ? 10 : 14;
    const lt = lists(M);
    const okSet = new Set(lt.ok.map((x) => x.t));
    const ranked = M.plotted.filter((x) => okSet.has(x.t) && !PINS.includes(x.t)).sort(byA);
    const inter = new Set(ranked.slice(0, TOP_INTERACTIVE).map((x) => x.t));
    if (S.sel) inter.add(S.sel);
    const dots = M.plotted.filter((x) => !PINS.includes(x.t)).map((x) => ({ x, r: radiusOf(x.cap, M.capMax, rMax), px: px(x.z), py: py(x.a), on: okSet.has(x.t) }));
    dots.sort((a, b) => a.on - b.on || b.r - a.r);
    const xstep = xmax <= 6 ? 1 : 2, ystep = ymax <= 4 ? 1 : 2;
    let s = '<svg class="mv-svg" id="mvSvg" viewBox="0 0 ' + W + " " + H + '" role="group" aria-label="' + esc("Scatter of " + M.plotted.length + " names. Across: move in typical days, from " + MINUS + xmax + " to +" + xmax + ". Up: move as a multiple of the implied day, from 0 to " + ymax + ". Arrow keys move between the largest moves. Enter opens the ticker page.") + '" data-xmax="' + xmax + '" data-ymax="' + ymax + '" data-l="' + L + '" data-t="' + T + '" data-w="' + iw + '" data-h="' + ih + '">';
    s += '<line class="axis" x1="' + L + '" y1="' + (T + ih) + '" x2="' + (L + iw) + '" y2="' + (T + ih) + '"/><line class="axis" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + ih) + '"/><line class="axis" x1="' + px(0) + '" y1="' + T + '" x2="' + px(0) + '" y2="' + (T + ih) + '"/>';
    for (let v = -xmax; v <= xmax; v += xstep) if (v % xstep === 0) s += '<text x="' + px(v) + '" y="' + (T + ih + 14) + '" text-anchor="middle">' + (v < 0 ? MINUS + -v : v > 0 ? "+" + v : "0") + "</text>";
    for (let v = 0; v <= ymax; v += ystep) s += '<text x="' + (L - 6) + '" y="' + (py(v) + 3.5) + '" text-anchor="end">' + v + "×</text>";
    for (const v of [-3, -2, 2, 3]) if (Math.abs(v) < xmax) s += '<line class="ref" data-ref="x' + v + '" x1="' + px(v) + '" y1="' + T + '" x2="' + px(v) + '" y2="' + (T + ih) + '"/>';
    s += '<line class="ref" data-ref="y1" x1="' + L + '" y1="' + py(1) + '" x2="' + (L + iw) + '" y2="' + py(1) + '"/>';
    s += '<text class="ttl" x="' + (L + iw / 2) + '" y="' + (H - 3) + '" text-anchor="middle">' + (compact ? "Typical days" : "Move in typical days") + "</text>";
    s += '<text class="ttl" transform="translate(11 ' + (T + ih / 2) + ') rotate(-90)" text-anchor="middle">' + (compact ? "× implied" : "Move × implied day") + "</text>";
    const hit = [];
    let nInter = 0;
    for (const d of dots) {
      const x = d.x, dir = dirOf(x.m), isI = inter.has(x.t) && d.on;
      const R0 = dir === "fl" ? d.r : d.r * TRI;
      if (isI) nInter++;
      const label = x.t + ", " + (dir === "up" ? "up" : dir === "dn" ? "down" : "flat") + ", " + signed(x.z) + " typical days, " + x.a.toFixed(1) + " times implied" + (x.event ? ", earnings within 30 days" : "");
      if (x.event) s += '<circle class="ring' + (d.on ? "" : " off") + '" data-ring="' + esc(x.t) + '" cx="' + d.px.toFixed(2) + '" cy="' + d.py.toFixed(2) + '" r="' + (R0 + 3).toFixed(2) + '" aria-hidden="true"/>';
      if (isI) s += '<g class="hit" data-t="' + esc(x.t) + '" role="button" tabindex="-1" aria-label="' + esc(label) + '"><circle class="hz" cx="' + d.px.toFixed(2) + '" cy="' + d.py.toFixed(2) + '" r="22.5"/>';
      s += '<path class="pt ' + dir + (d.on ? (isI ? "" : " bg") : " off") + '" data-t="' + esc(x.t) + '" data-r="' + d.r.toFixed(3) + '" data-x="' + d.px.toFixed(2) + '" data-y="' + d.py.toFixed(2) + '" transform="translate(' + d.px.toFixed(2) + " " + d.py.toFixed(2) + ')" d="' + markerPath(dir, d.r) + '"' + (isI ? "" : ' aria-hidden="true"') + (S.sel === x.t ? " data-sel" : "") + "/>";
      if (isI) s += "</g>";
      if (d.on) hit.push({ t: x.t, x: d.px, y: d.py });
    }
    for (const x of M.pins) {
      const cx = px(x.z), cy = py(x.a), dir = dirOf(x.m);
      s += '<g class="hit" data-t="' + esc(x.t) + '" role="button" tabindex="-1" aria-label="' + esc(x.t + ", pinned, " + signed(x.z) + " typical days, " + x.a.toFixed(1) + " times implied") + '"><circle class="hz" cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="22.5"/><rect class="pt pin ' + dir + '" data-pin="1" data-t="' + esc(x.t) + '" data-x="' + cx.toFixed(2) + '" data-y="' + cy.toFixed(2) + '" x="' + (cx - 4.5).toFixed(2) + '" y="' + (cy - 4.5).toFixed(2) + '" width="9" height="9"'+(S.sel === x.t ? " data-sel" : "") + "/></g>";
      hit.push({ t: x.t, x: cx, y: cy });
    }
    s += '<g id="mvLabels"></g></svg>';
    host.innerHTML = s;
    S.hit = hit;
    S.geo = { px, py, W, H, L, R, T, B, compact, rMax, M };
    const first = host.querySelector(".hit");
    const cur = host.querySelector('.hit[data-t="' + CSS.escape(S.sel || "") + '"]');
    if (cur) cur.tabIndex = 0; else if (first) first.tabIndex = 0;
    paintLabels();
    const shown = lt.ok.filter((x) => x.z !== null).length;
    $("mvCount").textContent = shown + " of " + M.plotted.length + " shown";
    const off = M.all.length - M.plotted.length;
    const clipped = M.plotted.filter((x) => Math.abs(x.z) > xmax || x.a > ymax).length;
    const notes = [];
    if (off > 0) notes.push(plural(off, "name has", "names have") + " no typical day and " + (off === 1 ? "is" : "are") + " listed only.");
    if (clipped > 0) notes.push(plural(clipped, "name is", "names are") + " beyond the axis, drawn at the edge.");
    $("mvFnote").textContent = [X_LINE, Y_LINE, M.capMax > 0 ? SIZE_LINE : "No market cap is published, so every dot is the smallest size.", REF_LINE, ...notes, M.sg.m ? M.sg.flagged + " of " + M.sg.tested + " tested " + (M.sg.flagged === 1 ? "name is" : "names are") + " beyond the usual after correction." : SIG_FOOT_NONE].join(" ");
    $("mvLegend").innerHTML = '<span><i class="u">▲</i>up</span><span><i class="d">▼</i>down</span><span><i>◆</i>flat</span><span><i>◌</i>ring: earnings within 30 days</span><span><i>■</i>pinned index fund</span>';
  }

  function paintLabels() {
    const geo = S.geo, host = $("mvLabels");
    if (!geo || !host) return;
    const { px, py, W, L, R, compact, M } = geo;
    const okSet = new Set(lists(M).ok.map((x) => x.t));
    const order = [];
    const seen = new Set();
    const add = (x) => { if (x && !seen.has(x.t)) { seen.add(x.t); order.push(x); } };
    add(M.plotted.find((x) => x.t === S.sel));
    for (const x of M.pins) add(x);
    for (const x of M.plotted.filter((y) => okSet.has(y.t)).sort(byA)) add(x);
    const boxes = [];
    let out = "";
    let n = 0;
    const cap = compact ? 4 : 7;
    for (const x of order) {
      const pin = PINS.includes(x.t), selected = x.t === S.sel;
      if (!selected && !pin && n >= cap) continue;
      const text = x.t + " " + SHAPE[dirOf(x.m)] + " " + pct(x.chg);
      const w = text.length * 6.4 + 4, h = 13;
      const cx = px(x.z), cy = py(x.a);
      const rr = pin ? 6 : radiusOf(x.cap, M.capMax, geo.rMax) * TRI + 4;
      let bx = cx + rr, anchor = "start";
      if (bx + w > W - R) { bx = cx - rr; anchor = "end"; }
      const x0 = anchor === "start" ? bx : bx - w, y0 = cy - h / 2 - 1;
      const hitBox = boxes.some((b) => x0 < b.x1 && x0 + w > b.x0 && y0 < b.y1 && y0 + h > b.y0);
      if (hitBox && !selected && !pin) continue;
      boxes.push({ x0, x1: x0 + w, y0, y1: y0 + h });
      if (!selected && !pin) n++;
      out += '<text class="lab' + (selected ? " sel" : "") + '" data-lab="' + esc(x.t) + '" x="' + Math.max(L, bx).toFixed(1) + '" y="' + (cy + 4).toFixed(1) + '" text-anchor="' + anchor + '" aria-hidden="true">' + esc(text) + "</text>";
    }
    host.innerHTML = out;
  }

  const rhOf = () => (mobile() || coarse() ? 44 : 36);

  function rowHtml(x, i) {
    const dir = dirOf(x.m);
    const rr = rarityParts(x);
    const how = rr ? rr.text : rarityWhy(x);
    const label = x.t + " " + (dir === "up" ? "up" : dir === "dn" ? "down" : "flat") + " " + signed(x.m) + " IV-days, " + pct(x.chg) + " on the day. " + (rr ? "Days like this: " + rr.text + "." : how);
    return '<button type="button" class="mv-row" data-t="' + esc(x.t) + '" tabindex="-1" aria-label="' + esc(label) + '" title="' + esc(rr ? rr.text : how) + '"><span class="mv-rk" aria-hidden="true">' + (i + 1) + '</span><span class="mv-tk"><span class="gl ' + toneOf(dir) + '-t">' + SHAPE[dir] + "</span>" + esc(x.t) + '</span><span class="mv-v" data-k="m">' + signed(x.m) + '</span><span class="mv-chg" data-k="chg">' + pct(x.chg) + '</span><span class="mv-chip2" data-k="how">' + (x.event ? "" : rr ? rr.short : DASH) + "</span></button>";
  }

  function paintLists() {
    const M = S.model;
    if (!M) return;
    const lt = lists(M);
    const rh = rhOf();
    const apartBox = $("mvApart");
    const nApart = Math.min(3, lt.apart.length);
    apartBox.style.height = (nApart ? nApart * rh : 40) + "px";
    apartBox.innerHTML = nApart ? lt.apart.slice(0, nApart).map((x, i) => rowHtml(x, i)).join("") : '<p class="mv-empty">' + (S.earn || !M.all.some((x) => x.event) ? "No name matches that reports within 30 days." : "No name with a move matches the filters.") + "</p>";
    $("mvApartNote").textContent = lt.apart.length ? Math.min(3, lt.apart.length) + " of " + lt.apart.length : "";
    const nowBox = $("mvNow");
    const room = Math.floor(nowBox.clientHeight / rh);
    const n = Math.max(1, Math.min(lt.now.length, room || 1));
    S.topN = n;
    nowBox.innerHTML = lt.now.length ? lt.now.slice(0, n).map((x, i) => rowHtml(x, i)).join("") : '<p class="mv-empty">' + (S.earn ? "Earnings names are ranked below." : "No name matches the filters.") + "</p>";
    $("mvNowNote").textContent = S.listHeld && S.dirty ? "Order held while you read." : lt.now.length ? n + " of " + lt.now.length : "";
    $("mvMore").hidden = lt.now.length <= n;
    syncRows();
  }

  function syncRows() {
    for (const box of [$("mvNow"), $("mvApart")]) {
      const rows = [...box.querySelectorAll(".mv-row")];
      let any = false;
      for (const b of rows) {
        const on = b.dataset.t === S.sel;
        if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
        b.tabIndex = on ? 0 : -1;
        any = any || on;
      }
      if (!any && rows[0]) rows[0].tabIndex = 0;
    }
  }

  function cardFields(c) {
    if (!c || typeof c !== "object" || !c.panels || typeof c.panels !== "object") return null;
    const vol = c.x && c.x.vol && typeof c.x.vol === "object" ? c.x.vol : null;
    const reg = c.regime && typeof c.regime === "object" ? c.regime : null;
    const track = c.panels.premiumTrack && Array.isArray(c.panels.premiumTrack.rows) ? c.panels.premiumTrack.rows : [];
    let last = null;
    for (const r of track) if (r && num(r.p) !== null) last = r;
    const overlay = c.panels.scoreOverlay && Array.isArray(c.panels.scoreOverlay.rows) ? c.panels.scoreOverlay.rows : [];
    const closes = overlay.filter((r) => r && typeof r.d === "string" && num(r.close) !== null).map((r) => [r.d, r.close]).slice(-21);
    const cap1 = (s) => (typeof s === "string" && s ? s[0].toUpperCase() + s.slice(1) : null);
    return {
      conviction: num(c.conviction),
      ivRank: vol && num(vol.iv30Pct) !== null ? Math.round(vol.iv30Pct * 100) : null,
      gammaBook: reg ? cap1(reg.label) : null,
      flowP: last ? last.p : null,
      asOf: typeof c.sessionDate === "string" ? c.sessionDate : null,
      closes,
    };
  }

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } }).then((r) => {
      if (r.status === 401) { location.replace("/flows/"); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const at = Number(r.headers.get("X-Payload-Updated"));
      return r.json().then((body) => { if (body && typeof body === "object") body.__updatedAt = at > 0 ? at : null; return body; });
    });
  }

  function loadCard(t, now) {
    clearTimeout(cardTimer);
    if (cards.has(t)) return;
    const run = () => {
      if (cards.has(t)) return;
      cards.set(t, { state: "pending" });
      get("/api/flows/card?t=" + encodeURIComponent(cardKey(t))).then((body) => {
        if (!body) return;
        const cf = cardFields(body);
        cards.set(t, cf ? { state: "ok", cf } : { state: "absent" });
      }).catch((err) => cards.set(t, { state: "failed", reason: "The Flows card for " + t + " could not be read (" + (err && err.message ? err.message : "request failed") + "). The move above is unaffected." }))
        .then(() => { if (S.sel === t) renderSel(); });
    };
    if (now) run(); else cardTimer = setTimeout(() => { if (S.sel === t) run(); }, 220);
  }

  function spark(cf, x) {
    const c = cf.closes;
    if (c.length < 2) return '<p class="sub">The card holds fewer than two closes.</p>';
    const W = 200, H = 70, pad = 6;
    const vs = c.map((r) => r[1]);
    const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
    const X = (i) => pad + (i / (c.length - 1)) * (W - 2 * pad);
    const Y = (v) => pad + (1 - (v - lo) / span) * (H - 2 * pad - 8);
    const pts = c.map((r, i) => X(i).toFixed(1) + "," + Y(r[1]).toFixed(1)).join(" ");
    const lastI = c.length - 1;
    const label = "Closes for " + x.t + " over " + c.length + " sessions, from " + vs[0].toFixed(2) + " to " + vs[lastI].toFixed(2) + ".";
    return '<div class="mv-spark" role="img" aria-label="' + esc(label) + '"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none"><polyline class="ln" points="' + pts + '"/><circle class="dot ' + dirOf(x.m) + '" cx="' + X(lastI).toFixed(1) + '" cy="' + Y(vs[lastI]).toFixed(1) + '" r="3"/></svg></div><div class="mv-dates"><span>' + esc(fday(c[0][0])) + "</span><span>" + esc(fday(c[lastI][0])) + "</span></div>";
  }

  const kv = (k, v) => '<div class="kv"><span>' + esc(k) + "</span><b>" + esc(v) + "</b></div>";

  const signedTenths = (k) => (k < 0 ? MINUS : k > 0 ? "+" : "") + Math.abs(k / 10).toFixed(1) + "%";
  function partsHtml(P) {
    if (!P) return "";
    const sub = (p) => {
      if (p.key === "peers") return P.peers.n + " peers";
      if (p.key === "name" && P.peers && P.peers.z !== null) return Math.abs(P.peers.z).toFixed(1) + "× peer spread";
      return "";
    };
    const items = P.parts.map((p) => {
      const cut = p.label.indexOf(" ");
      const head = cut < 0 ? p.label : p.label.slice(0, cut), tail = cut < 0 ? "" : p.label.slice(cut);
      const note = sub(p);
      return '<span class="mv-pt" data-k="' + p.key + '" title="' + esc(p.label + " " + signedTenths(p.tenths) + (note ? ", " + note : "")) + '"><i>' + esc(head) + (tail ? '<span class="x">' + esc(tail) + "</span>" : "") + '</i><b class="' + toneOf(dirOf(p.tenths)) + '-t">' + signedTenths(p.tenths) + "</b>" + (note ? '<em class="' + (p.key === "peers" ? "n" : "z") + '">' + esc(note) + "</em>" : "") + "</span>";
    }).join("");
    const note = P.peers ? "" : '<span class="mv-pn" data-k="why">' + esc(P.peerWhy) + "</span>";
    return '<span class="mv-parts" role="group" aria-label="Parts of the move" title="' + esc(PARTS_SENTENCES[3]) + '">' + items + note + "</span>";
  }

  function sigLine(x) {
    const g = x.sg;
    return g.state === "tested" ? (g.flag ? SIG_FLAGGED_LINE : SIG_PLAIN_LINE) : SIG_REASONS[g.state];
  }
  const sigKv = (x) => (x.sg.state === "tested" ? kv("p, own rate", x.sg.p.toFixed(3)) + kv("p, adjusted", x.sg.adj.toFixed(3)) : "");

  function renderSel() {
    const box = $("mvRail");
    const M = S.model;
    const x = M && S.sel ? M.all.find((y) => y.t === S.sel) : null;
    if (!x) { box.innerHTML = '<p class="mv-empty">Select a name to read its move.</p>'; return; }
    const dir = dirOf(x.m);
    const rr = rarityParts(x);
    const iday = x.iv > 0 ? x.iv / SQRT_YEAR : null;
    const e = cards.get(x.t);
    const cf = e && e.state === "ok" ? e.cf : null;
    let h = '<div class="mv-rhead"><span class="big">' + esc(x.t) + '</span><span class="mv-st ' + dir + '">' + SHAPE[dir] + " " + pct(x.chg) + '</span>' + (x.event ? '<span class="mv-st ev">Earnings in ' + x.ed + (x.ed === 1 ? " session" : " sessions") + "</span>" : "") + '<span class="why">' + esc(x.sector || "No sector") + " · " + esc(CAPTION) + "</span>" + partsHtml(peerParts(M.rows, x.t)) + '<a class="mv-open" href="' + tickerHref(x.t) + '">Open ticker ↗</a></div>';
    h += '<div class="mv-rc first"><h3>Against its day</h3>' + kv("Move", SHAPE[dir] + " " + pct(x.chg)) + kv("Typical day", x.sig !== null ? pctText(x.sig) : DASH) + kv("In typical days", x.z !== null ? signed(x.z) : DASH) + kv("Implied day", iday !== null ? pctText(iday) : DASH) + kv("Times implied", x.a.toFixed(1) + "×") + kv("IV-days", signed(x.m)) + "</div>";
    h += '<div class="mv-rc"><h3>How often</h3><span class="say" data-k="say">' + esc(rr ? rr.text.charAt(0).toUpperCase() + rr.text.slice(1) + "." : rarityWhy(x)) + "</span>" + kv("Past 2 typical", x.f2 !== null ? x.f2 + " of 252" : DASH) + kv("Past 3 typical", x.f3 !== null ? x.f3 + " of 252" : DASH) + "</div>";
    if (!e || e.state === "pending") {
      h += '<div class="mv-rc chart"><h3>21 sessions</h3><span class="sub">Reading the Flows card…</span></div><div class="mv-rc"><h3>Flows card</h3><span class="sub">Reading the Flows card…</span></div>';
    } else if (e.state === "failed") {
      h += '<div class="mv-rc chart wide"><h3>21 sessions</h3><span class="sub c">' + esc(e.reason) + '</span><button type="button" class="mv-retry" id="mvRetry">Retry</button></div><div class="mv-rc"><h3>Flows card</h3><span class="sub">' + DASH + "</span></div>";
    } else if (e.state === "absent") {
      h += '<div class="mv-rc chart"><h3>21 sessions</h3><span class="sub c">' + esc(x.t) + ' has no Flows card, so no closes or context are shown.</span></div><div class="mv-rc"><h3>Flows card</h3>' + kv("Conviction", DASH) + kv("IV rank", DASH) + "</div>";
    } else {
      h += '<div class="mv-rc chart"><h3>21 sessions <span class="tx">' + esc(cf.asOf ? "card " + fday(cf.asOf) : "") + "</span></h3>" + spark(cf, x) + "</div>";
      h += '<div class="mv-rc"><h3>Flows card</h3>' + kv("Conviction", cf.conviction === null ? DASH : cf.conviction + " /100") + kv("IV rank", cf.ivRank === null ? DASH : String(cf.ivRank)) + kv("Dealer γ book", cf.gammaBook || DASH) + kv("Latest flow", cf.flowP === null || cf.flowP === undefined ? DASH : F.money(cf.flowP, true)) + "</div>";
    }
    h += '<div class="mv-rc"><h3>How this is tested</h3><span class="sub c" data-k="sig">' + esc(sigLine(x)) + "</span>" + sigKv(x) + (x.event ? '<span class="sub c">' + esc(APART) + "</span>" : "") + "</div>";
    box.innerHTML = h;
    const retry = $("mvRetry");
    if (retry) retry.addEventListener("click", () => { cards.delete(x.t); loadCard(x.t, true); renderSel(); });
  }

  function select(t, o = {}) {
    S.sel = t;
    const host = $("mvPlot");
    for (const el of host.querySelectorAll(".pt")) {
      const on = el.dataset.t === t;
      if (on) el.setAttribute("data-sel", ""); else el.removeAttribute("data-sel");
    }
    for (const el of host.querySelectorAll(".hit")) el.tabIndex = el.dataset.t === t ? 0 : -1;
    if (!host.querySelector(".hit[tabindex='0']")) { const f = host.querySelector(".hit"); if (f) f.tabIndex = 0; }
    paintLabels();
    syncRows();
    renderSel();
    loadCard(t, o.now);
  }

  const go = (t) => { location.href = tickerHref(t); };

  function nearestTo(x, y, r) {
    let best = null, bd = r * r;
    for (const p of S.hit) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d <= bd) { bd = d; best = p; } }
    return best;
  }

  function neighbour(from, key) {
    const host = $("mvPlot");
    const cur = S.hit.find((p) => p.t === from);
    if (!cur) return null;
    const cand = [...host.querySelectorAll(".hit")].map((el) => S.hit.find((p) => p.t === el.dataset.t)).filter(Boolean);
    let best = null, bs = Infinity;
    for (const p of cand) {
      if (p.t === cur.t) continue;
      const dx = p.x - cur.x, dy = p.y - cur.y;
      const along = key === "ArrowRight" ? dx : key === "ArrowLeft" ? -dx : key === "ArrowDown" ? dy : -dy;
      const across = key === "ArrowRight" || key === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
      if (along <= 0.5) continue;
      const sc = along + 2 * across;
      if (sc < bs) { bs = sc; best = p; }
    }
    return best;
  }

  function focusPoint(t) {
    const el = $("mvPlot").querySelector('.hit[data-t="' + CSS.escape(t) + '"]');
    if (el) { for (const o of $("mvPlot").querySelectorAll(".hit")) o.tabIndex = -1; el.tabIndex = 0; el.focus(); }
  }

  function setView(v) {
    $("mvStage").dataset.view = v;
    for (const b of $("mvSeg5").children) b.setAttribute("aria-selected", String(b.dataset.v === v));
    requestAnimationFrame(() => { if (v === "field") drawPlot(); else if (v === "lists") paintLists(); else renderSel(); });
  }

  function holding() { return S.frozen || S.listHeld; }

  function paint() {
    S.model = model();
    const M = S.model;
    if (!S.sel || !M.all.some((x) => x.t === S.sel)) {
      const L = lists(M), top = L.now.find((x) => x.z !== null) || L.apart.find((x) => x.z !== null) || M.plotted[0] || L.now[0] || L.apart[0] || null;
      S.sel = top ? top.t : null;
    }
    S.dirty = false;
    paintHead(M);
    paintFilters(M);
    drawPlot();
    paintLists();
    renderSel();
    if (S.sel) loadCard(S.sel);
    $("mv").dataset.ready = "1";
  }

  function request() {
    if (holding()) { S.dirty = true; if (S.listHeld) $("mvNowNote").textContent = "Order held while you read."; return; }
    paint();
  }

  function redraw() {
    if (!S.model) return;
    paintFilters(S.model);
    drawPlot();
    paintLists();
    renderSel();
  }

  function openMore() {
    const lt = lists(S.model);
    const cols = mobile() ? 2 : 3;
    const room = Math.max(1, Math.floor((innerHeight - 24 - 170) / 44));
    const n = Math.min(lt.now.length, cols * room);
    $("mvMoreT").textContent = "Largest " + n + " of " + lt.now.length + ", in IV-days";
    $("mvMoreP").textContent = "Choose one to read it. " + CAPTION;
    $("mvMoreG").innerHTML = lt.now.slice(0, n).map((x) => '<button type="button" data-t="' + esc(x.t) + '" aria-pressed="' + (x.t === S.sel) + '"><b>' + esc(x.t) + "</b><span class=\"" + toneOf(dirOf(x.m)) + '-t">' + SHAPE[dirOf(x.m)] + " " + signed(x.m) + "</span></button>").join("");
    $("mvMoreDlg").showModal();
    const f = $("mvMoreG").querySelector('[aria-pressed="true"]') || $("mvMoreG").firstElementChild;
    if (f) f.focus();
  }

  function openInfo() {
    $("mvInfoB").innerHTML = [
      "Across: the move in the name's own typical days. A typical day is a robust one-day scale from the last 252 sessions.",
      "Up: the move as a multiple of the implied day. The implied day is prior-close 30-day IV over the square root of 252.",
      "IV-days is the move divided by the implied day. The lists rank by it.",
      "Dot area is market cap. A triangle points the way the name moved. A ring marks earnings within 30 days.",
      "Names reporting within 30 days are ranked apart, because the event is not separated.",
      "How often counts days in the last year beyond that many typical days. It is never a model probability.",
      REF_LINE,
      SIG_INFO_SENTENCES.join(" "),
      PARTS_SENTENCES.join(" "),
      "Not built yet: flow clusters and replay.",
    ].map((t, i, a) => '<p' + (i === a.length - 1 ? ' class="q"' : "") + ">" + esc(t) + "</p>").join("");
    $("mvInfoDlg").showModal();
    $("mvInfoX").focus();
  }

  function wire() {
    const plot = $("mvPlot");
    plot.addEventListener("click", (e) => {
      const p = nearestTo(e.clientX - plot.getBoundingClientRect().left, e.clientY - plot.getBoundingClientRect().top, coarse() ? 22 : 14);
      if (!p) return;
      select(p.t, { now: true });
      if (mobile()) setView("detail");
    });
    plot.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || mobile()) return;
      const r = plot.getBoundingClientRect();
      const p = nearestTo(e.clientX - r.left, e.clientY - r.top, 14);
      if (p && p.t !== S.sel) select(p.t);
    });
    plot.addEventListener("keydown", (e) => {
      const b = e.target.closest(".hit");
      if (!b) return;
      if (e.key === "Enter") { e.preventDefault(); go(b.dataset.t); return; }
      if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const n = neighbour(b.dataset.t, e.key);
      if (n) { select(n.t); focusPoint(n.t); }
    });
    const listKeys = (root) => root.addEventListener("keydown", (e) => {
      const b = e.target.closest(".mv-row");
      if (!b) return;
      const all = [...document.querySelectorAll("#mvNow .mv-row, #mvApart .mv-row")], i = all.indexOf(b);
      const mv = (n) => { if (n) { n.focus(); select(n.dataset.t); n.focus(); } };
      if (e.key === "ArrowDown") { e.preventDefault(); mv(all[i + 1]); }
      else if (e.key === "ArrowUp") { e.preventDefault(); mv(all[i - 1]); }
      else if (e.key === "Home") { e.preventDefault(); mv(all[0]); }
      else if (e.key === "End") { e.preventDefault(); mv(all[all.length - 1]); }
      else if (e.key === "Enter") { e.preventDefault(); go(b.dataset.t); }
    });
    listKeys($("mvNow"));
    listKeys($("mvApart"));
    const click = (e) => { const b = e.target.closest(".mv-row"); if (!b) return; select(b.dataset.t, { now: true }); if (mobile()) setView("detail"); };
    $("mvNow").addEventListener("click", click);
    $("mvApart").addEventListener("click", click);
    $("mvMore").addEventListener("click", openMore);
    $("mvMoreG").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; $("mvMoreDlg").close(); select(b.dataset.t, { now: true }); if (mobile()) setView("detail"); });
    $("mvMoreG").addEventListener("keydown", (e) => {
      const bs = [...$("mvMoreG").children], i = bs.indexOf(document.activeElement);
      if (i < 0) return;
      const cols = getComputedStyle($("mvMoreG")).gridTemplateColumns.split(" ").length;
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (!d) return;
      e.preventDefault();
      if (bs[i + d]) bs[i + d].focus();
    });
    $("mvMoreX").addEventListener("click", () => $("mvMoreDlg").close());
    $("mvInfoBtn").addEventListener("click", openInfo);
    $("mvInfoX").addEventListener("click", () => $("mvInfoDlg").close());
    for (const d of document.querySelectorAll(".mv-dlg")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    $("mvDir").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.dir = S.dir === b.dataset.dir ? null : b.dataset.dir; redraw(); });
    $("mvEarn").addEventListener("click", () => { S.earn = !S.earn; redraw(); });
    $("mvSector").addEventListener("change", (e) => { S.sector = e.target.value; redraw(); });
    $("mvClear").addEventListener("click", () => { S.dir = null; S.earn = false; S.sector = ""; const s = $("mvSector"); s.dataset.sig = ""; redraw(); });
    $("mvFreeze").addEventListener("click", () => {
      S.frozen = !S.frozen;
      S.frozenAt = S.frozen ? Date.now() : null;
      if (!S.frozen && S.dirty) paint(); else { paintHead(S.model); paintFilters(S.model); }
    });
    const lp = $("mvLists");
    const syncHold = (v) => { S.listHeld = v; if (!v && S.dirty && !S.frozen) paint(); };
    lp.addEventListener("pointerenter", () => syncHold(true));
    lp.addEventListener("pointerleave", () => syncHold(lp.matches(":focus-within")));
    lp.addEventListener("focusin", () => syncHold(true));
    lp.addEventListener("focusout", () => setTimeout(() => syncHold(lp.matches(":hover, :focus-within")), 0));
    for (const b of $("mvSeg5").children) b.addEventListener("click", () => setView(b.dataset.v));
    $("mvSeg5").addEventListener("keydown", (e) => {
      const bs = [...$("mvSeg5").children], i = bs.findIndex((b) => b.getAttribute("aria-selected") === "true");
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const n = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
        n.click();
        n.focus();
      }
    });
    let rz = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(rz);
      rz = setTimeout(() => {
        if (!S.model) return;
        const v = $("mvStage").dataset.view;
        if (!mobile() || v === "field") drawPlot();
        if (!mobile() || v === "lists") paintLists();
        if (!mobile() || v === "detail") renderSel();
      }, 60);
    });
    ro.observe($("mvStage"));
    ro.observe($("mvPlot"));
    ro.observe($("mvNow"));
  }

  function fail(kind, text) {
    statusEl.textContent = text;
    statusEl.dataset.empty = kind;
    $("mvStage").hidden = true;
    $("mvSeg5").hidden = true;
    const box = $("mvNote");
    box.hidden = false;
    box.textContent = text;
    box.dataset.empty = kind;
    $("mv").dataset.ready = "1";
  }

  wire();
  get("/api/flows/universe?cols=t,sec,chg,iv30p,sig,f2,f3,ed,mcap").then((u) => {
    if (!u) return;
    const got = uniRows(u);
    if (!got) return fail("pending", "The universe is not published yet, so there is nothing to draw.");
    S.rows = got.rows;
    S.known = new Map(got.rows.map((r) => [r.t, r]));
    S.day = u.sessionDate || null;
    S.generatedAt = typeof u.generatedAt === "string" ? u.generatedAt : null;
    UI.freshness({ sessionDate: u.sessionDate, generatedAt: u.generatedAt, updatedAt: u.__updatedAt, source: "universe" });
    paint();
    const rt = UI.rt && UI.rt.connect({ topics: ["px"] });
    if (rt) {
      rt.on("px", () => {
        const l = liveRows();
        if (!l && !S.live) return;
        S.live = l;
        request();
      });
    }
  }).catch((error) => fail("unreadable", "The universe could not be loaded. Refresh to try again. (" + error.message + ")"));
})();
