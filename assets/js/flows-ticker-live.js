(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI || !UI.tickerGlance || !UI.rt || UI.tickerLive) return;
  const { F, h, s } = UI;
  const G = UI.tickerGlance;
  const MID = " " + UI.MID + " ";
  const CLAUSE = "on the feed's convention (dealers long calls, short puts)";
  const SESSION_MIN = 390, GAP_MS = 150000, SAMPLE_MS = 10000, KEEP = 720, GX_MS = 15 * 60000, LAG_MAX_S = 600;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const f1 = (v) => String(Math.round(v * 10) / 10);
  const put = (n, k, v) => { if (n && n.getAttribute(k) !== String(v)) n.setAttribute(k, v); };
  const say = (n, v) => { if (n && n.textContent !== v) n.textContent = v; };
  const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

  function pathOf(live, samples) {
    const pts = (samples || []).filter((r) => Array.isArray(r) && num(r[0]) !== null && num(r[1]) !== null);
    const tail = pts[pts.length - 1];
    if (live && num(live.px) !== null && (!tail || (num(live.at) !== null && live.at > tail[0]))) pts.push([live.at, live.px]);
    return pts;
  }

  function geom(L, live, samples, S) {
    if (!L || !live || num(S) === null) return null;
    const x0 = L.XT, span = L.xf(1) - x0;
    const o = live.session ? F.open(live.session) : null;
    const xAt = (t) => { const a = o === null || t === null ? null : F.axis(t, live.session); return x0 + span * (a === null ? 1 : clamp((a - o) / SESSION_MIN, 0, 1)); };
    const yAt = (p) => clamp(L.y(p), L.top, L.plotB);
    const pts = pathOf(live, samples).map(([t, p]) => [xAt(t), yAt(p), t]);
    if (!pts.length) return null;
    let d = "";
    pts.forEach((p, i) => { d += (i === 0 || p[2] - pts[i - 1][2] > GAP_MS ? "M" : "L") + f1(p[0]) + "," + f1(p[1]); });
    const last = pts[pts.length - 1];
    return { d, x: last[0], y: last[1], x0, y0: yAt(S), fx: pts[0][0], fy: pts[0][1] };
  }

  function sentence(live, S, why, gx) {
    const out = [];
    if (live) {
      const mv = num(S) > 0 ? live.px / S - 1 : null;
      out.push("Live: the last price is " + F.px(live.px) + " at " + F.time(live.at) + (mv === null ? "" : ", " + F.pct(mv, 2, true) + " on the card close") + "; both ranges stay anchored at the card close of " + F.px(S) + ".");
    } else if (why) out.push("No live price is drawn: " + why + ".");
    if (gx) out.push("Live dealer gamma is " + F.money(gx.gOi, true) + " per 1%, the open-interest book " + CLAUSE + ", apart from the nightly gamma drawn by strike.");
    return out.length ? " " + out.join(" ") : "";
  }

  function flagged(rows, t) {
    let n = 0, prem = 0;
    for (const r of rows || []) if (r && r.t === t) { n++; if (num(r.prem) !== null && r.prem > 0) prem += r.prem; }
    return n ? { n, prem } : null;
  }

  function flowFoot(c, fl) {
    return c.missing || !fl ? c.foot : c.foot + MID + "flagged " + fl.n + (fl.prem > 0 ? " " + F.money(fl.prem) : "");
  }

  const S = { ctx: null, t: null, live: null, why: null, samples: [], sess: null, dom: null, gx: null, fl: null, skew: 0, timer: 0, kit: null, lag: null, watch: null };

  function liveNow() {
    if (!UI.freshness.market().open) return { why: "the regular session is closed" };
    const fr = UI.rt.fresh("px"), q = UI.rt.quote(S.t);
    if (!fr || !q || num(q.price) === null || !(q.price > 0)) return { why: "no streamed quote for " + S.t + " has arrived" };
    const ff = typeof UI.freshFrom === "function" ? UI.freshFrom(fr, { serverNow: Date.now() + S.skew }) : null;
    const st = ff ? ff.stateAt() : fr.state;
    if (st !== "live") return { ff, why: st === "stale" ? "the streamed quote is stale" : "the streamed quote is not live" + (fr.reason === "vendor-lag" ? ", it is behind the feed" : "") };
    const at = ms(q.tapeTime) ?? ms(q.readAt);
    return { ff, q, fr, live: { px: q.price, prev: num(q.prevClose), at, session: typeof fr.session === "string" ? fr.session.slice(0, 10) : F.etDay(at) } };
  }

  function take(live) {
    if (S.sess !== live.session) { S.samples = []; S.sess = live.session; S.dom = null; }
    if (live.at === null) live.at = Date.now();
    if (S.live && S.live.session === live.session && live.at < S.live.at) return false;
    const tail = S.samples[S.samples.length - 1];
    if (!tail || live.at - tail[0] >= SAMPLE_MS) S.samples.push([live.at, live.px]);
    if (S.samples.length > KEEP) S.samples.splice(0, S.samples.length - KEEP);
    return true;
  }

  function gxNow() {
    if (!UI.freshness.market().open) return null;
    const g = UI.rt.gex(S.t);
    return g && num(g.gOi) !== null && num(g.at) !== null && Date.now() - g.at <= GX_MS ? { gOi: g.gOi, at: g.at, lagS: num(g.lagS) } : null;
  }

  function flNow() {
    const a = UI.rt.alerts();
    return a && a.synced ? flagged(a.rows, S.t) : null;
  }

  function paintLag() {
    const b = document.getElementById("fxFresh");
    if (!b) return;
    if (!S.watch && typeof MutationObserver === "function") {
      S.watch = new MutationObserver((ms) => (ms.some((x) => x.type === "attributes") ? syncPx() : paintLag()));
      S.watch.observe(b, { childList: true, attributes: true, attributeFilter: ["data-state"] });
    }
    let n = b.querySelector(".fx-fresh-lag");
    if (b.dataset.state !== "live" || S.lag === null || !S.live) {
      if (n) n.remove();
      return;
    }
    const text = MID + (S.lag < 10 ? S.lag.toFixed(1) : String(Math.round(S.lag))) + " s behind the feed";
    if (!n) { n = h("span", { class: "fx-fresh-lag" }); b.append(n); }
    say(n, text);
  }

  function input(kit) {
    const st = kit.st, d = S.live && S.dom && S.dom.card === st.card && S.dom.range === st.range ? S.dom.y : null;
    return { last: S.live ? S.live.px : null, dom: d };
  }

  function said(kit) {
    const m = kit.st.m;
    return sentence(S.live, m ? m.S : null, S.why, S.gx);
  }

  function stamp(kit) {
    const row = kit.root.querySelector(".ftg-lrow");
    if (!row) return;
    let a = row.querySelector(".ftg-live"), g = row.querySelector(".ftg-gx");
    if (!a) { a = h("span", { class: "ftg-live", "aria-hidden": "true", hidden: true }); g = h("span", { class: "ftg-gx", "aria-hidden": "true", hidden: true }); row.append(a, g); }
    const lv = S.live;
    if (a.hidden !== !lv) a.hidden = !lv;
    say(a, lv ? "Last " + F.px(lv.px) + MID + F.time(lv.at) : "");
    const mv = lv && kit.st.m && num(kit.st.m.S) > 0 ? lv.px / kit.st.m.S - 1 : null;
    put(a, "title", lv ? "Last price " + F.px(lv.px) + (mv === null ? "" : ", " + F.pct(mv, 2, true) + " on the card close of " + F.px(kit.st.m.S)) + ". The ranges stay anchored at the card close." : "");
    const gx = S.gx;
    if (g.hidden !== !gx) g.hidden = !gx;
    say(g, gx ? "Dealer γ now " + F.money(gx.gOi, true) + " per 1%" : "");
    put(g, "data-side", gx ? (gx.gOi < 0 ? "short" : gx.gOi > 0 ? "long" : "flat") : "flat");
    put(g, "title", gx ? "Dealer gamma now, the open-interest book " + CLAUSE + (gx.lagS === null ? "" : ", read " + f1(gx.lagS) + " s after the feed stamped it") + ". The gamma drawn on the chart is the nightly book." : "");
  }

  function describeNow(kit) {
    if (kit.st.m) say(kit.desc, G.model.describe(kit.st.m) + said(kit));
  }

  function liveLayer(kit, geo) {
    const c = kit.st.chart;
    let g = c.svg.querySelector("[data-live]");
    if (!g) {
      g = s("g", { "data-live": "1", "aria-hidden": "true" });
      c.svg.insertBefore(g, c.cross && c.cross.parentNode === c.svg ? c.cross : null);
      s("line", { class: "ftg-live-c" }, g);
      s("path", { class: "ftg-live-p" }, g);
      s("circle", { class: "ftg-live-h", r: 8 }, g);
      s("circle", { class: "ftg-live-d", r: 3.4 }, g);
    }
    const [ln, p, halo, dot] = g.children;
    put(ln, "x1", geo.x0); put(ln, "y1", geo.y0); put(ln, "x2", geo.fx); put(ln, "y2", geo.fy);
    put(p, "d", geo.d);
    put(halo, "cx", geo.x); put(halo, "cy", geo.y);
    put(dot, "cx", geo.x); put(dot, "cy", geo.y);
    for (const n of c.svg.querySelectorAll("circle.ftg-dot, circle.ftg-dot-halo")) if (!n.classList.contains("is-anchor")) n.classList.add("is-anchor");
    say(c.svg.querySelector("text.ftg-today-tx"), F.day(S.live.session));
  }

  function drawn(kit) {
    const st = kit.st, c = st.chart;
    kit.on = false;
    if (!c || !st.m) return;
    stamp(kit);
    if (!S.live) return;
    kit.on = true;
    const geo = geom(G.model.layout(st.m, st.W, st.H), S.live, S.samples, st.m.S);
    if (!geo) return;
    S.dom = { card: st.card, range: st.range, y: [st.m.y0, st.m.y1] };
    liveLayer(kit, geo);
  }

  function patch(kit) {
    const st = kit.st, c = st.chart, m = st.m, lv = S.live;
    if (!c || !m || !c.svg.isConnected || lv.px < m.y0 || lv.px > m.y1) return kit.paintChart();
    m.last = lv.px;
    const L = G.model.layout(m, st.W, st.H);
    const at = L.labels.map((lab) => [lab, c.svg.querySelector("text.ftg-lt.ftg-lv-" + lab.kind), c.svg.querySelector("line.ftg-lead.ftg-lv-" + lab.kind)]);
    if (at.some(([, t, ln]) => !t || !ln)) return kit.paintChart();
    for (const [lab, t, ln] of at) { say(t, lab.text); put(t, "y", lab.y); put(ln, "y1", lab.ly1); put(ln, "y2", lab.ly2); }
    const geo = geom(L, lv, S.samples, m.S);
    if (geo) liveLayer(kit, geo);
    stamp(kit);
    describeNow(kit);
  }

  function render() {
    const kit = bind(S.ctx.glance());
    paintLag();
    if (!kit || kit.st.dead) return;
    if (!!S.live !== !!kit.on) { stamp(kit); kit.paintChart(); return; }
    if (S.live) patch(kit);
    else { stamp(kit); describeNow(kit); }
  }

  function syncPx() {
    clearTimeout(S.timer);
    S.timer = 0;
    const n = liveNow();
    S.why = n.why || null;
    if (n.live && take(n.live)) {
      S.live = n.live;
      const read = ms(n.fr.readAt), at = ms(n.q.tapeTime);
      S.lag = read !== null && at !== null && read >= at && read - at < LAG_MAX_S * 1000 ? Math.round((read - at) / 100) / 10 : null;
    } else if (!n.live) { S.live = null; S.lag = null; }
    const next = n.ff ? n.ff.nextAt() : null;
    if (next !== null) S.timer = setTimeout(syncPx, Math.max(50, next - Date.now() + 50));
    S.gx = gxNow();
    render();
  }

  function patchFlow(kit) {
    const st = kit.st, el = kit.grid.querySelector('.ftg-card[data-card="flow"]');
    const c = G.model.cards(st.card, st.x).find((x) => x.id === "flow");
    if (!el || !c) return;
    const foot = flowFoot(c, S.fl);
    say(el.querySelector(".ftg-sub"), c.sub);
    const u = el.querySelector(".ftg-u");
    say(u, c.unit);
    put(u, "title", c.unit || "");
    const f = el.querySelector(".ftg-f");
    say(f, c.fig.text);
    put(f, "data-tone", c.fig.tone);
    const p = el.querySelector(".ftg-foot");
    say(p, foot);
    put(p, "title", foot);
    say(el.querySelector(".visually-hidden"), c.title + ", " + c.sub + ". " + c.fig.text + " " + c.unit + ". " + foot);
    if (c.missing) put(el, "data-missing", "1"); else el.removeAttribute("data-missing");
    if (!flowChart(el, c)) kit.paintCards();
  }

  function flowChart(el, c) {
    const svg = el.querySelector(".ftg-cb svg");
    const ps = c.series ? c.series.p.map((v, i) => [v, i]).filter((r) => r[0] !== null) : [];
    if (!svg || ps.length < 2) return !svg && ps.length < 2;
    const ct = svg.querySelectorAll("text.ftg-ct"), clip = svg.querySelectorAll("clipPath rect"), z = svg.querySelector("line.ftg-zero");
    if (ct.length !== (c.series.t0 ? 1 : 0) + (c.series.t1 ? 1 : 0) || clip.length !== 2 || !z) return false;
    const n = c.series.p.length - 1, vs = ps.map((r) => r[0]), hi = Math.max(0, ...vs), lo = Math.min(0, ...vs), span = Math.max(hi - lo, 1e-9);
    const fx = (i) => 4 + i * 176 / n, fy = (v) => 8 + (hi - v) / span * 44;
    const line = ps.map((r) => [fx(r[1]), fy(r[0])]), zero = fy(0);
    const pts = line.map((q) => f1(q[0]) + "," + f1(q[1]));
    const area = "M" + f1(line[0][0]) + "," + f1(zero) + "L" + pts.join("L") + "L" + f1(line[line.length - 1][0]) + "," + f1(zero) + "Z";
    put(clip[0], "height", zero); put(clip[1], "y", zero); put(clip[1], "height", 66 - zero);
    for (const a of svg.querySelectorAll("path.ftg-fa")) put(a, "d", area);
    for (const a of svg.querySelectorAll("polyline.ftg-fl")) put(a, "points", pts.join(" "));
    put(z, "y1", f1(zero)); put(z, "y2", f1(zero));
    const tx = [c.series.t0, c.series.t1].filter(Boolean);
    ct.forEach((t, i) => say(t, tx[i]));
    put(svg, "aria-label", "Cumulative net premium through the session, ending at " + F.money(c.series.net, true));
    return true;
  }

  function footOnly(kit) {
    const st = kit.st, el = kit.grid.querySelector('.ftg-card[data-card="flow"]');
    const c = el ? G.model.cards(st.card, st.x).find((x) => x.id === "flow") : null;
    if (!c) return;
    const foot = flowFoot(c, S.fl), p = el.querySelector(".ftg-foot");
    if (!p || p.textContent === foot) return;
    say(p, foot);
    put(p, "title", foot);
    say(el.querySelector(".visually-hidden"), c.title + ", " + c.sub + ". " + c.fig.text + " " + c.unit + ". " + foot);
  }

  const claimKey = (cl) => (cl || []).map((c) => c.id + ":" + c.cites.join(",")).join("|");

  function update(kit, next) {
    const st = kit.st;
    if ((next.card && next.card !== st.card) || ("cardX" in next && next.cardX !== st.x.cardX) || (typeof next.expiry === "string" && next.expiry !== st.expiry)) return false;
    for (const k of ["reading", "summary", "claims"]) if (k in next) st.opts[k] = next[k];
    const was = claimKey(st.claims);
    kit.setClaims();
    const tape = "tape" in next && next.tape !== st.x.tape;
    if (tape) st.x = Object.assign({}, st.x, { tape: next.tape });
    if (claimKey(st.claims) !== was) kit.paintChart();
    if (tape) patchFlow(kit);
    return true;
  }

  function bind(mount) {
    if (!mount || typeof mount.attach !== "function") return null;
    if (S.kit && S.kit.mount === mount) return S.kit;
    const kit = { mount, on: false };
    Object.assign(kit, mount.attach({ input: () => input(kit), drawn: () => drawn(kit), cards: () => footOnly(kit), said: () => said(kit), update: (next) => update(kit, next) }));
    S.kit = kit;
    footOnly(kit);
    return kit;
  }

  function beat(q) {
    const cur = S.ctx.quote(), at = (x) => ms(x && (x.tapeTime || x.readAt));
    if (q && cur && cur.source === "rt" && at(cur) > at(q)) S.ctx.take(Object.assign({}, q, { price: cur.price, changePct: cur.changePct, tapeTime: cur.tapeTime, readAt: cur.readAt, source: "rt" }));
    else S.ctx.take(q);
    syncPx();
  }

  function onPx(change) {
    if (change && num(change.at) !== null) S.skew = change.at - Date.now();
    syncPx();
  }

  function onGx() {
    const g = gxNow();
    if (JSON.stringify(g) === JSON.stringify(S.gx)) return;
    S.gx = g;
    const kit = S.kit;
    if (kit && !kit.st.dead) { stamp(kit); describeNow(kit); }
  }

  function onFl() {
    const f = flNow();
    if (JSON.stringify(f) === JSON.stringify(S.fl)) return;
    S.fl = f;
    if (S.kit && !S.kit.st.dead) footOnly(S.kit);
  }

  function start(ctx) {
    if (S.ctx || !ctx || typeof ctx.glance !== "function") return;
    S.ctx = ctx;
    S.t = String(ctx.t || "").toUpperCase();
    ctx.LIVE.ping = () => { S.kit = null; render(); };
    ctx.LIVE.beat = beat;
    UI.rt.on("px", onPx);
    UI.rt.on("gx", onGx);
    UI.rt.on("fl", onFl);
    S.gx = gxNow();
    S.fl = flNow();
    syncPx();
  }

  const live = Object.freeze({ start, model: Object.freeze({ geom, pathOf, sentence, flagged, flowFoot }), state: () => ({ live: S.live, why: S.why, samples: S.samples.length, lag: S.lag, gx: S.gx, fl: S.fl, on: !!(S.kit && S.kit.on) }) });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { tickerLive: live }));
})();
