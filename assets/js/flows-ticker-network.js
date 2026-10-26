(() => {
  "use strict";

  const NEAR_Z = 0.25;
  const FIXED_BAND = 0.025;
  const MIN_WINDOWS = 5;
  const DAYS_PER_YEAR = 365;
  const NODES = {
    side: [["side:ca", "Calls · ask side"], ["side:cr", "Calls · rest"], ["side:pa", "Puts · ask side"], ["side:pr", "Puts · rest"]],
    expiry: [["exp:d0", "Same day"], ["exp:w1", "1 to 7 days"], ["exp:m1", "8 to 31 days"], ["exp:far", "32 days and over"]],
    scaled: [["mny:itm", "In the money"], ["mny:near", "Near the money"], ["mny:otm", "Out of the money"]],
    fixed: [["mny:itm", "In the money, past 2.5%"], ["mny:near", "Within 2.5% of spot"], ["mny:otm", "Out of the money, past 2.5%"]],
    flags: [["flg:so", "Sweep and all opening"], ["flg:s", "Sweep"], ["flg:o", "All opening"], ["flg:n", "Neither flag"], ["flg:u", "Flags not read"]],
  };
  const TITLES = { side: "Side", expiry: "Expiry", money: "Strike against spot", flags: "Flags" };
  const FACE = {
    gross: "Vendor-flagged windows, not every execution. Premium is gross; legs of a spread count separately.",
    ask: "Ask side is the vendor's attribution of premium; the rest is bid, mid or unattributed. No lean on this page.",
    flags: "Opening: every trade in the window is flagged opening by the vendor. Sweep: the window contains a sweep.",
    spot: "One session spot, not the price at each window's time.",
  };

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

  function daysBetween(from, to) {
    const a = DAY.exec(String(from)), b = DAY.exec(String(to));
    if (!a || !b) return null;
    const x = Date.UTC(+a[1], +a[2] - 1, +a[3]), y = Date.UTC(+b[1], +b[2] - 1, +b[3]);
    if (new Date(x).toISOString().slice(0, 10) !== a[0] || new Date(y).toISOString().slice(0, 10) !== b[0]) return null;
    return Math.round((y - x) / 864e5);
  }
  const bucketOf = (d) => (!Number.isInteger(d) || d < 0 ? null : d === 0 ? "exp:d0" : d <= 7 ? "exp:w1" : d <= 31 ? "exp:m1" : "exp:far");

  const termRows = (term) => (Array.isArray(term) ? term : []).filter((r) => r && num(r.dte) !== null && r.dte > 0 && num(r.vol) !== null && r.vol > 0).sort((x, y) => x.dte - y.dte);

  function volAt(days, term, iv30) {
    const rows = termRows(term);
    if (!rows.length) return num(iv30) !== null && iv30 > 0 ? iv30 : null;
    const t = Math.max(days, 1);
    if (t <= rows[0].dte) return rows[0].vol;
    const last = rows[rows.length - 1];
    if (t >= last.dte) return last.vol;
    let j = 1;
    while (rows[j].dte < t) j++;
    const a = rows[j - 1], b = rows[j];
    const wa = a.vol * a.vol * a.dte, wb = b.vol * b.vol * b.dte;
    return Math.sqrt((wa + ((wb - wa) * (t - a.dte)) / (b.dte - a.dte)) / t);
  }

  function moneyOf(cp, k, spot, sigma, days) {
    let z;
    if (sigma === null) {
      z = k - spot;
      if (Math.abs(z) <= FIXED_BAND * spot) return "mny:near";
    } else {
      z = Math.log(k / spot) / (sigma * Math.sqrt(Math.max(days, 1) / DAYS_PER_YEAR));
      if (Math.abs(z) <= NEAR_Z) return "mny:near";
    }
    return (cp === "C") === (z < 0) ? "mny:itm" : "mny:otm";
  }

  function pctsOf(values) {
    const total = values.reduce((a, v) => a + v, 0);
    if (!(total > 0)) return values.map(() => null);
    const raw = values.map((v) => (v / total) * 100);
    const out = raw.map((r) => Math.floor(r));
    let left = 100 - out.reduce((a, v) => a + v, 0);
    const order = raw.map((r, i) => [r - out[i], values[i], i]).sort((x, y) => y[0] - x[0] || y[1] - x[1] || x[2] - y[2]);
    for (let j = 0; left > 0 && j < order.length; j++, left--) out[order[j][2]]++;
    return out;
  }

  function model(alerts, ctx) {
    ctx = ctx || {};
    const session = typeof ctx.session === "string" ? ctx.session.slice(0, 10) : null;
    if (alerts === undefined || alerts === null) return { state: "unavailable", reason: "This name's dossier carries no flagged-window record." };
    if (typeof alerts !== "object") return { state: "unavailable", reason: "The flagged windows were not published for this name." };
    if (alerts.status === "absent" || alerts.status === "pending") return { state: "pending", reason: "The flagged windows publish with tonight's run." };
    if (alerts.status === "quiet") return { state: "quiet", reason: "No window of this name was flagged in the session." };
    if (alerts.status !== "ok") return { state: "unavailable", reason: "The flagged windows are not available: " + String(alerts.why || alerts.status || "no reason published").replace(/[.\s]+$/, "") + "." };
    const dots = Array.isArray(alerts.dots) ? alerts.dots : [];
    if (!dots.length) return { state: "quiet", reason: "The record carries no flagged window." };
    if (session && alerts.asOf && String(alerts.asOf).slice(0, 10) !== session) {
      return { state: "stale", reason: "The windows are for " + String(alerts.asOf).slice(0, 10) + ", not the card's session " + session + "." };
    }
    const day = session || (alerts.asOf ? String(alerts.asOf).slice(0, 10) : null);
    const excluded = { window: 0, unattributed: 0, unflagged: 0 };
    const spot = num(ctx.spot) !== null && ctx.spot > 0 ? ctx.spot : null;
    const iv30 = num(ctx.iv30) !== null && ctx.iv30 > 0 ? ctx.iv30 : null;
    const basis = spot === null ? "none" : termRows(ctx.term).length ? "term" : iv30 !== null ? "iv30" : "fixed";
    const parts = [];
    dots.forEach((d, i) => {
      const p = num(d && d.p);
      const cp = d && (d.cp === "C" || d.cp === "P") ? d.cp : null;
      const days = d && typeof d.e === "string" && day ? daysBetween(day, d.e) : null;
      const bucket = bucketOf(days);
      const k = num(d && d.k);
      if (p === null || !(p > 0) || cp === null || bucket === null || (spot !== null && !(k > 0))) { excluded.window++; return; }
      const money = spot === null ? null : moneyOf(cp, k, spot, basis === "term" || basis === "iv30" ? volAt(days, ctx.term, iv30) : null, days);
      const flag = typeof d.sw === "boolean" && typeof d.op === "boolean" ? (d.sw && d.op ? "flg:so" : d.sw ? "flg:s" : d.op ? "flg:o" : "flg:n") : "flg:u";
      if (flag === "flg:u") excluded.unflagged++;
      const a = num(d.a);
      const ok = a !== null && a >= 0 && a <= 1;
      if (!ok) excluded.unattributed++;
      const ask = ok ? p * a : 0;
      const c = cp === "C";
      if (ask > 0) parts.push({ w: i, v: ask, nodes: [c ? "side:ca" : "side:pa", bucket, money, flag] });
      if (p - ask > 0) parts.push({ w: i, v: p - ask, nodes: [c ? "side:cr" : "side:pr", bucket, money, flag] });
    });
    const total = parts.reduce((s, x) => s + x.v, 0);
    const drawn = new Set(parts.map((x) => x.w)).size;
    const prem = num(alerts.prem) !== null && alerts.prem >= 0 ? alerts.prem : null;
    const listed = dots.reduce((s, d) => s + (num(d && d.p) !== null && d.p > 0 ? d.p : 0), 0);
    if (prem !== null && listed > prem * 1.001 + 1) return { state: "inconsistent", reason: "The listed windows add to more than the name's flagged premium, so no network is drawn." };
    if (!(total > 0)) return { state: "unavailable", reason: day === null ? "The windows carry no session date, so days to expiry cannot be counted." : "No listed window could be placed: " + excluded.window + " had a missing or invalid price, side, strike or expiry." };
    const cover = prem !== null && prem > 0 ? total / prem : null;
    const defs = [NODES.side, NODES.expiry, spot === null ? null : basis === "fixed" ? NODES.fixed : NODES.scaled, NODES.flags];
    const keys = ["side", "expiry", "money", "flags"];
    const columns = [];
    defs.forEach((def, c) => {
      if (!def) return;
      const nodes = [];
      for (const [id, label] of def) {
        const mine = parts.filter((x) => x.nodes[c] === id);
        const v = mine.reduce((s, x) => s + x.v, 0);
        if (v > 0) nodes.push({ id, label, v, windows: new Set(mine.map((x) => x.w)).size });
      }
      const pct = pctsOf(nodes.map((n) => n.v));
      nodes.forEach((n, i) => { n.pct = pct[i]; });
      columns.push({ key: keys[c], title: TITLES[keys[c]], index: c, nodes });
    });
    const live = columns.map((c) => c.index);
    const bands = [];
    for (let j = 0; j + 1 < live.length; j++) {
      const m = new Map();
      for (const x of parts) {
        const key = x.nodes[live[j]] + ">" + x.nodes[live[j + 1]];
        m.set(key, (m.get(key) || 0) + x.v);
      }
      bands.push([...m].map(([key, v]) => { const [a, b] = key.split(">"); return { a, b, v }; }).sort((x, y) => y.v - x.v || (x.a + x.b < y.a + y.b ? -1 : 1)));
    }
    const byPath = new Map();
    for (const x of parts) {
      const key = live.map((i) => x.nodes[i]).join(">");
      const e = byPath.get(key) || { ids: live.map((i) => x.nodes[i]), v: 0, w: new Set() };
      e.v += x.v;
      e.w.add(x.w);
      byPath.set(key, e);
    }
    const paths = [...byPath.values()].map((e) => ({ ids: e.ids, v: e.v, windows: e.w.size })).sort((a, b) => b.v - a.v || (a.ids.join() < b.ids.join() ? -1 : 1));
    return {
      state: drawn < MIN_WINDOWS ? "thin" : "ok", reason: drawn < MIN_WINDOWS ? "Too few windows for a map." : null,
      session: day, total, windows: drawn, listed: dots.length, n: num(alerts.n), complete: typeof alerts.complete === "boolean" ? alerts.complete : null,
      cover, coverNote: cover === null ? "not stated" : cover >= 0.75 ? "standard" : cover >= 0.5 ? "wide" : "largest",
      gap: cover === null ? null : Math.max(0, Math.round(100 * (1 - cover))), prem, basis, spot, excluded, columns, bands, paths, parts,
    };
  }

  function readout(net, id) {
    const col = net.columns.find((c) => c.nodes.some((n) => n.id === id));
    if (!col) return null;
    const node = col.nodes.find((n) => n.id === id);
    const mine = net.parts.filter((x) => x.nodes[col.index] === id);
    const others = net.columns.filter((c) => c !== col).map((c) => {
      const sums = new Map();
      for (const x of mine) sums.set(x.nodes[c.index], (sums.get(x.nodes[c.index]) || 0) + x.v);
      const rows = c.nodes.map((n) => ({ id: n.id, label: n.label, v: sums.get(n.id) || 0 })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
      return { key: c.key, title: c.title, rows };
    });
    return { id, label: node.label, column: col.title, pct: node.pct, v: mine.reduce((s, x) => s + x.v, 0), windows: node.windows, of: net.total, others };
  }

  if (typeof document === "undefined") {
    globalThis.__FlowNetTest = Object.freeze({ model, readout, daysBetween, bucketOf, moneyOf, volAt, pctsOf });
    return;
  }
  const UI = window.FlowsUI;
  if (!UI) return;
  const { h, F, DASH } = UI;
  const money = (v) => F.money(v);
  const MAPS = new WeakMap();
  const holder = document.querySelector('i[data-defer="network"][data-css]');
  const href = holder ? holder.getAttribute("data-css") : null;
  const ready = new Promise((ok) => {
    if (!href || document.querySelector('link[href="' + href + '"]')) { ok(); return; }
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href, onload: ok, onerror: ok });
    document.head.append(link);
  });

  function coverLine(net) {
    const n = net.n;
    if (net.cover === null) return "The name's flagged premium is not stated, so the coverage of these windows is not known.";
    const share = Math.round(net.cover * 100);
    if (n !== null && n === net.windows && net.cover > 0.995) return "All " + n + " flagged windows of the name.";
    return "The " + net.windows + " largest of the name's " + (n === null ? "flagged" : n) + " flagged windows, " + share + "% of its flagged premium. Shares are of these windows' premium.";
  }

  function spotLine(net) {
    if (net.basis === "none") return "Strike against spot is not read: this card has no spot for the session.";
    if (net.basis === "fixed") return "Strike against the session spot of " + F.px(net.spot) + ". No implied volatility is on this card, so the middle band is within 2.5% of spot. " + FACE.spot;
    const from = net.basis === "term" ? "the card's volatility at that expiry, interpolated in total variance between listed expiries" : "the 30-day implied volatility";
    return "Strike against the session spot of " + F.px(net.spot) + ": near means within a quarter of a standard deviation to the window's own expiry, from " + from + "; a same-day expiry counts as one day. " + FACE.spot;
  }

  const pctShown = (p, frac) => (p === 0 && frac > 0 ? "<1%" : p + "%");

  function sentence(r) {
    const head = r.label + ": " + money(r.v) + ", " + pctShown(r.pct, r.v / r.of) + " of these windows' premium, in " + r.windows + (r.windows === 1 ? " window." : " windows.");
    const tails = r.others.map((o) => {
      const p = pctsOf(o.rows.map((x) => x.v));
      return o.title + ": " + o.rows.slice(0, 3).map((x, i) => x.label + " " + pctShown(p[i], x.v / r.v)).join(", ") + (o.rows.length > 3 ? ", and " + (o.rows.length - 3) + " more" : "");
    });
    return head + " In those windows, " + tails.join(". ") + ".";
  }

  function mount(host, raw) {
    if (!host) return null;
    const prev = MAPS.get(host);
    if (prev) prev.destroy();
    raw = raw || {};
    const card = raw.card || {};
    const X = raw.cardX;
    const vc = card.panels && card.panels.volContext;
    const term = vc && vc.term && Array.isArray(vc.term.rows) ? vc.term.rows : null;
    const iv30 = num(vc && vc.iv30) !== null ? vc.iv30 : num(card.x && card.x.vol && card.x.vol.iv30);
    const early = !X || X.status === "pending" ? { state: "pending", reason: X && X.loading ? "Loading this name's dossier." : "Publishes with tonight's run." }
      : X.status === "absent" || X.status === "unavailable" ? { state: "unavailable", reason: X.off ? "Built for " + F.day(X.off) + ", not this card's session." : "Not built for this name." } : null;
    const net = early || model(X.alerts, { session: card.sessionDate, spot: raw.spot, term, iv30 });
    const S = { net, sel: null, view: "map", dead: false };
    const wrap = h("div", { class: "fnw", "data-state": net.state });
    host.replaceChildren(wrap);
    host.classList.remove("is-slot");
    if (net.state !== "ok" && net.state !== "thin") {
      const st = net.state === "inconsistent" ? "withheld" : net.state;
      wrap.append(UI.silent({ state: st, reason: net.reason }, "Flow network", 160));
      const api = { destroy() { S.dead = true; }, net };
      MAPS.set(host, api);
      return api;
    }
    const thin = net.state === "thin";
    const sel0 = net.columns[0].nodes.slice().sort((a, b) => b.v - a.v)[0].id;
    S.sel = sel0;
    const warn = h("p", { class: "fnw-warn", role: "note" });
    const cover = h("p", { class: "fnw-cover" }, coverLine(net));
    if (net.coverNote === "largest") warn.textContent = "The largest windows only: these " + net.windows + " are " + Math.round(net.cover * 100) + "% of the name's flagged premium, so their shares say nothing about the rest.";
    else if (net.coverNote === "wide") warn.textContent = "These windows are " + Math.round(net.cover * 100) + "% of the name's flagged premium: shares can differ by up to " + net.gap + " points for the whole name.";
    else warn.hidden = true;
    const stage = h("div", { class: "fnw-stage" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "fnw-bands");
    svg.setAttribute("aria-hidden", "true");
    stage.append(svg);
    const narrow = h("p", { class: "fnw-cover", hidden: true }, "The map needs more width than this module has. The table below holds the same figures.");
    const read = h("p", { class: "fnw-read", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const tableBox = h("div", { class: "fnw-table", hidden: true });
    const seg = UI.segmented("Map or table", [{ label: "Map" }, { label: "Table" }], (i) => { S.view = i === 0 ? "map" : "table"; paint(); }, 0);
    const gen = raw.cardX && raw.cardX.generatedAt;
    const head = h("div", { class: "fnw-bar" }, thin ? null : seg, h("span", { class: "fnw-stamp" }, net.session ? "Session " + F.day(net.session) + (gen && F.trtDay(gen) ? " \u00b7 read " + F.day(F.trtDay(gen)) + " " + F.time(gen) : "") : ""));
    const notes = [FACE.gross, FACE.ask, FACE.flags, spotLine(net)];
    if (net.excluded.window) notes.push(net.excluded.window + (net.excluded.window === 1 ? " window is" : " windows are") + " left out of every column: a missing price, strike or expiry.");
    if (net.excluded.unattributed) notes.push(net.excluded.unattributed + (net.excluded.unattributed === 1 ? " window carries" : " windows carry") + " no side attribution, so " + (net.excluded.unattributed === 1 ? "its premium sits" : "their premium sits") + " in the rest and the ask-side figures are a lower bound.");
    if (net.excluded.unflagged) notes.push(net.excluded.unflagged + (net.excluded.unflagged === 1 ? " window has" : " windows have") + " no sweep or opening flag read, shown as flags not read.");
    const face = h("p", { class: "fnw-face" }, notes.join(" "));
    wrap.append(head, read, warn, cover, narrow, stage, tableBox, face);

    const chips = new Map();
    let geo = null;

    function layout() {
      const W = Math.max(0, stage.clientWidth);
      const cols = net.columns;
      const k = cols.length;
      const chipW = Math.max(96, Math.min(190, Math.floor((W - 8) / k * 0.62)));
      const gapX = k > 1 ? (W - k * chipW) / (k - 1) : 0;
      const sheet = host.closest(".ft-sheet-b");
      const H = sheet ? Math.max(200, Math.min(330, sheet.clientHeight - 230)) : 320;
      const gap = 8;
      const MIN_CHIP = matchMedia("(pointer:coarse)").matches ? 44 : 40;
      let lo = 0, hi = (H - 8) / net.total;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        const fits = cols.every((c) => c.nodes.reduce((s, n) => s + Math.max(MIN_CHIP, n.v * mid), 0) + (c.nodes.length - 1) * gap <= H - 8);
        if (fits) lo = mid; else hi = mid;
      }
      const scale = lo;
      const pos = new Map();
      cols.forEach((c, ci) => {
        const hs = c.nodes.map((n) => Math.max(MIN_CHIP, n.v * scale));
        const used = hs.reduce((s, x) => s + x, 0) + (c.nodes.length - 1) * gap;
        let y = 4 + (H - 8 - used) / 2;
        c.nodes.forEach((n, i) => {
          pos.set(n.id, { x: ci * (chipW + gapX), y, w: chipW, h: hs[i], col: ci, order: i });
          y += hs[i] + gap;
        });
      });
      return { W, H, chipW, gapX, scale, pos, ok: gapX >= 28 && W >= 480 };
    }

    function drawBands() {
      svg.replaceChildren();
      svg.setAttribute("width", String(geo.W));
      svg.setAttribute("height", String(geo.H));
      svg.setAttribute("viewBox", "0 0 " + geo.W + " " + geo.H);
      const out = new Map(), inn = new Map();
      net.bands.forEach((list, j) => {
        const a = list.slice().sort((x, y) => geo.pos.get(x.b).order - geo.pos.get(y.b).order || (x.a < y.a ? -1 : 1));
        for (const b of a) {
          const pa = geo.pos.get(b.a);
          const w = Math.max(1.25, b.v * geo.scale);
          const oy = out.get(b.a) || 0;
          out.set(b.a, oy + w);
          b.y1 = pa.y + oy + w / 2;
          b.w = w;
        }
        const c = list.slice().sort((x, y) => geo.pos.get(x.a).order - geo.pos.get(y.a).order || (x.b < y.b ? -1 : 1));
        for (const b of c) {
          const pb = geo.pos.get(b.b);
          const iy = inn.get(b.b) || 0;
          inn.set(b.b, iy + b.w);
          b.y2 = pb.y + iy + b.w / 2;
        }
        for (const b of list) {
          const pa = geo.pos.get(b.a), pb = geo.pos.get(b.b);
          const x1 = pa.x + pa.w, x2 = pb.x, mx = (x1 + x2) / 2;
          const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
          p.setAttribute("d", "M" + x1 + "," + b.y1 + "C" + mx + "," + b.y1 + " " + mx + "," + b.y2 + " " + x2 + "," + b.y2);
          p.setAttribute("stroke-width", String(b.w));
          p.setAttribute("class", "fnw-b" + (j === 0 ? " from-" + b.a.slice(5) : ""));
          p.setAttribute("fill", "none");
          svg.append(p);
        }
      });
    }

    function paintSel() {
      const r = readout(net, S.sel);
      read.textContent = r ? sentence(r) : "";
      const sc = net.columns.find((c) => c.nodes.some((n) => n.id === S.sel));
      for (const c of net.columns) {
        for (const n of c.nodes) {
          const el = chips.get(n.id);
          if (!el) continue;
          el.setAttribute("aria-pressed", String(n.id === S.sel));
          let part = 0;
          for (const x of net.parts) if (x.nodes[sc.index] === S.sel && x.nodes[c.index] === n.id) part += x.v;
          el.querySelector(".fnw-fill").style.width = Math.round(Math.min(1, part / n.v) * 100) + "%";
        }
      }
    }

    function build() {
      for (const el of chips.values()) el.remove();
      chips.clear();
      geo = layout();
      stage.style.height = geo.H + "px";
      drawBands();
      for (const c of net.columns) {
        for (const n of c.nodes) {
          const p = geo.pos.get(n.id);
          const el = h("button", { class: "fnw-chip", type: "button", "data-id": n.id, "data-col": c.key, "aria-pressed": "false",
            "aria-label": c.title + ", " + n.label + ": " + money(n.v) + ", " + pctShown(n.pct, n.v / net.total) + " of these windows' premium" },
            h("b", null, n.label), h("span", null, money(n.v) + " · " + pctShown(n.pct, n.v / net.total)), h("i", { class: "fnw-fill", "aria-hidden": "true" }));
          el.style.left = p.x + "px";
          el.style.top = p.y + "px";
          el.style.width = p.w + "px";
          el.style.height = p.h + "px";
          el.addEventListener("click", () => { S.sel = n.id; paintSel(); });
          el.addEventListener("keydown", (e) => {
            const col = net.columns.indexOf(c), i = c.nodes.indexOf(n);
            let t = null;
            if (e.key === "ArrowDown") t = c.nodes[i + 1];
            else if (e.key === "ArrowUp") t = c.nodes[i - 1];
            else if (e.key === "ArrowRight" && net.columns[col + 1]) t = net.columns[col + 1].nodes[Math.min(i, net.columns[col + 1].nodes.length - 1)];
            else if (e.key === "ArrowLeft" && net.columns[col - 1]) t = net.columns[col - 1].nodes[Math.min(i, net.columns[col - 1].nodes.length - 1)];
            if (t) { e.preventDefault(); chips.get(t.id).focus(); S.sel = t.id; paintSel(); }
          });
          chips.set(n.id, el);
          stage.append(el);
        }
      }
      paintSel();
    }

    function table() {
      const ids = new Map(net.columns.flatMap((c) => c.nodes.map((n) => [n.id, n.label])));
      const rows = (all) => (all ? net.paths : net.paths.slice(0, 12)).map((p) => {
        const tr = h("tr", null, p.ids.map((id, i) => h(i === 0 ? "th" : "td", { scope: i === 0 ? "row" : null }, ids.get(id))),
          h("td", { class: "c-num" }, money(p.v)), h("td", { class: "c-num" }, pctShown(Math.round((p.v / net.total) * 100), p.v / net.total)));
        return tr;
      });
      const t = h("table", { class: "fnw-tbl" },
        h("caption", { class: "visually-hidden" }, "Paths of the flagged premium, largest first"),
        h("thead", null, h("tr", null, net.columns.map((c) => h("th", { scope: "col" }, c.title)), h("th", { scope: "col", class: "c-num" }, "Premium"), h("th", { scope: "col", class: "c-num" }, "Share"))),
        h("tbody", null, rows(false)));
      const more = net.paths.length > 12 ? h("button", { type: "button", class: "fnw-more" }, "Show all " + net.paths.length + " paths") : null;
      if (more) more.addEventListener("click", () => { t.querySelector("tbody").replaceChildren(...rows(true)); more.remove(); });
      tableBox.replaceChildren(t, more);
    }

    function paint() {
      const map = S.view === "map" && !thin;
      stage.hidden = !map;
      read.hidden = !map;
      tableBox.hidden = map;
      narrow.hidden = !(S.narrow && !map && !thin);
      if (map) requestAnimationFrame(relayout);
    }

    function relayout() {
      if (S.dead || stage.hidden || !stage.clientWidth) return;
      build();
      if (!geo.ok) { S.narrow = true; S.view = "table"; seg.pick(1); paint(); } else S.narrow = false;
    }
    table();
    let ro = null;
    if (thin) {
      S.view = "table";
      paint();
      wrap.append(h("p", { class: "fnw-thin" }, net.reason));
    } else {
      paint();
      if (window.ResizeObserver) { ro = new ResizeObserver(() => relayout()); ro.observe(stage); }
    }
    const api = { destroy() { S.dead = true; if (ro) ro.disconnect(); }, net, select(id) { S.sel = id; paintSel(); }, state: S };
    MAPS.set(host, api);
    return api;
  }

  window.FlowsUI = Object.freeze(Object.assign({}, UI, { flowNet: Object.freeze({ ready, mount, model, readout, sentence, coverLine, daysBetween, bucketOf, moneyOf, volAt, pctsOf, DASH }) }));
})();
