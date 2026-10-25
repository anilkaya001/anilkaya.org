(() => {
  "use strict";

  const MINUS = "−", DASH = "—", DAY = 864e5;
  const FUNDS = new Set([
    "AGG", "BND", "DIA", "EEM", "EFA", "GLD", "GOVT", "HYG", "IEF", "IGOV", "IOO", "IVV", "IWM",
    "LQD", "QQQ", "SHY", "SLV", "SPY", "TLT", "VEA", "VGK", "VOO", "VTI", "VWO",
    "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
  ]);
  const STL = {
    accF: "Accumulating · bounds agree",
    accM: "Leans accumulating",
    mix: "Mixed",
    redM: "Leans reducing",
  };
  const STS = { accF: "Firm accumulating", accM: "Leans accumulating", mix: "Mixed", redM: "Leans reducing" };
  const WHY = {
    accF: "Even the low bound is a net purchase.",
    accM: "The midpoint leans buying; the bounds straddle zero.",
    mix: "Buys and sells roughly offset.",
    redM: "Sales are midpoints only, so this is a lean, never a firm reduction.",
  };
  const GLY = { accF: "▲", accM: "▲", mix: "◆", redM: "▼" };
  const TONE = { accF: "up", accM: "up", mix: "warn", redM: "down" };
  const CHAMBER = { H: "House", S: "Senate", E: "Executive" };
  const RING_R = 8;
  const TAB_NOTES = {
    acc: "Disclosed purchases exceed disclosed sales, by band midpoint.",
    red: "Sales exceed purchases. Sales are midpoints only, so none is called firm, and the feed under-counts reducers.",
    cvg: "At least {n} distinct filers, most filers first. Breadth, not the size of one account.",
  };

  const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const chOf = (m) => (m === "senate" ? "S" : m === "executive" ? "E" : "H");
  const cardKey = (t) => String(t === null || t === undefined ? "" : t).toUpperCase().replace(/[.\-\s]/g, "");
  const initials = (name) => {
    const parts = String(name || "").replace(/\b(Hon\.|Jr\.?|Sr\.?|III|II)\b/g, "").trim().split(/\s+/).filter(Boolean);
    return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() : "?";
  };

  function netBounds(r) {
    const B = finite(r.bought), S = finite(r.sold) || 0, lo = finite(r.boughtLo), hi = finite(r.boughtHi);
    if (B === null || lo === null || hi === null) return null;
    return { mid: B - S, lo: lo - 2 * S, hi: hi - S / 8 };
  }

  function stateOf(r) {
    const b = netBounds(r);
    if (!b) return null;
    const g = r.bought + (finite(r.sold) || 0);
    const share = g > 0 ? b.mid / g : 0;
    const open = (finite(r.openBands) || 0) > 0;
    if (!open && b.lo > 0) return "accF";
    if (share >= 0.2) return "accM";
    if (share <= -0.2) return "redM";
    return "mix";
  }

  const blind = (lag, win) => (finite(lag) === null || finite(win) === null || win <= 0 ? null : Math.min(1, Math.max(0, lag / win)));
  const weight = (r, size) => {
    const g = (finite(r.bought) || 0) + (finite(r.sold) || 0);
    return size === "fil" ? (finite(r.filers) || 0) + Math.sqrt(g) / 4e3 : Math.sqrt(g);
  };

  function squarify(items, x, y, w, h) {
    const out = [];
    const tot = items.reduce((s, i) => s + i.v, 0);
    if (!tot) return out;
    const k = (w * h) / tot;
    const rest = items.map((i) => ({ i, a: i.v * k }));
    while (rest.length) {
      const sh = Math.min(w, h);
      let row = [], sum = 0, best = Infinity;
      const worst = (r, s) => {
        const mx = Math.max(...r.map((z) => z.a)), mn = Math.min(...r.map((z) => z.a));
        return Math.max((sh * sh * mx) / (s * s), (s * s) / (sh * sh * mn));
      };
      while (rest.length) {
        const c = rest[0], nr = row.concat([c]), ns = sum + c.a, wv = worst(nr, ns);
        if (row.length && wv > best) break;
        row = nr; sum = ns; best = wv; rest.shift();
      }
      const th = sum / sh;
      let off = 0;
      for (const z of row) {
        const len = z.a / th;
        if (w >= h) out.push({ i: z.i, x, y: y + off, w: th, h: len });
        else out.push({ i: z.i, x: x + off, y, w: len, h: th });
        off += len;
      }
      if (w >= h) { x += th; w -= th; } else { y += th; h -= th; }
    }
    return out;
  }

  const cap1 = (s) => (typeof s === "string" && s ? s[0].toUpperCase() + s.slice(1) : null);

  function cardFields(c) {
    if (!c || typeof c !== "object" || !c.panels || typeof c.panels !== "object") return null;
    const vol = c.x && c.x.vol && typeof c.x.vol === "object" ? c.x.vol : null;
    const reg = c.regime && typeof c.regime === "object" ? c.regime : null;
    const track = c.panels.premiumTrack && Array.isArray(c.panels.premiumTrack.rows) ? c.panels.premiumTrack.rows : [];
    let last = null;
    for (const r of track) if (r && finite(r.p) !== null) last = r;
    const overlay = c.panels.scoreOverlay && Array.isArray(c.panels.scoreOverlay.rows) ? c.panels.scoreOverlay.rows : [];
    const closes = overlay.filter((r) => r && typeof r.d === "string" && finite(r.close) !== null).map((r) => [r.d, r.close]);
    const trades = c.panels.congress && c.panels.congress.status === "ok" && Array.isArray(c.panels.congress.trades) ? c.panels.congress.trades : null;
    const iv = vol && finite(vol.iv30Pct) !== null ? Math.round(vol.iv30Pct * 100) : null;
    return {
      conviction: finite(c.conviction),
      ivRank: iv,
      iv30: vol && finite(vol.iv30) !== null ? vol.iv30 : null,
      gammaBook: reg ? cap1(reg.label) : null,
      gammaFlow: reg ? cap1(reg.flowLabel) : null,
      flowP: last ? last.p : null,
      flowDay: last && typeof last.d === "string" ? last.d : null,
      asOf: typeof c.sessionDate === "string" ? c.sessionDate : null,
      px: c.panels.surface && finite(c.panels.surface.spot) !== null ? c.panels.surface.spot : null,
      closes,
      trades: trades ? trades.filter((x) => x && typeof x === "object") : null,
    };
  }

  if (typeof document === "undefined") {
    globalThis.__PoliticalTest = Object.freeze({ netBounds, stateOf, blind, weight, squarify, initials, cardFields, FUNDS: [...FUNDS] });
    return;
  }

  const UI = window.FlowsUI;
  const status = document.getElementById("plStatus");
  if (!UI || !status) return;
  const { F, isNum } = UI;
  const usd = F.unit.of("moneyCompact", { dp: "short" });
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const mobile = () => { const pl = document.getElementById("pl"); return pl ? pl.getBoundingClientRect().width < 900 : matchMedia("(max-width:899px)").matches; };
  const coarse = () => matchMedia("(pointer:coarse)").matches;
  const dms = (s) => Date.parse(s + "T00:00:00Z");
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const fday = (s) => F.day(s);
  const fwd = (s) => (typeof s === "string" && !Number.isNaN(dms(s)) ? WD[new Date(dms(s)).getUTCDay()] + " " + fday(s) : DASH);
  const addDays = (s, n) => new Date(dms(s) + n * DAY).toISOString().slice(0, 10);
  const smoney = (v) => usd(v, true);
  const spct = (v) => F.pct(v, 1, true);
  const plural = (n, a, b) => n + " " + (n === 1 ? a : b);

  let P = null, ALL = [], carded = new Set(), WIN = null, ASOF = null, minFilers = 3, seen = null, recent = [], tapeNamed = [];
  const S = { tab: "acc", view: "map", size: "usd", funds: false, sort: null, sel: null, win: 90, topN: 10, tabs: null };
  const cards = new Map();
  let tiles = [];
  let cardTimer = 0;

  const byNet = (a, b) => b.net - a.net;
  const byNetAsc = (a, b) => a.net - b.net;
  const byFilers = (a, b) => b.filers - a.filers || b.B - a.B;
  const TABS = [
    { id: "acc", label: "Accumulating", f: (x) => x.net > 0, def: "net", cmp: byNet },
    { id: "red", label: "Reducing", f: (x) => x.net < 0, def: "net", cmp: byNetAsc },
    { id: "cvg", label: "Convergence", f: (x) => x.filers >= minFilers, def: "filers", cmp: byFilers },
  ];
  const tabOf = (id) => TABS.find((t) => t.id === id) || TABS[0];
  const tabNote = (t, list) => TAB_NOTES[t.id].replace("{n}", String(minFilers)) + (list ? " Whiskers give the low to high bound." : "");
  const pool = () => ALL.filter((x) => S.funds || !x.fund);
  const sortKey = () => S.sort || tabOf(S.tab).def;
  const cmpFor = () => {
    const k = sortKey();
    if (k === "filers") return byFilers;
    if (k === "lag") return (a, b) => (b.lag || 0) - (a.lag || 0) || b.g - a.g;
    return tabOf(S.tab).cmp;
  };
  const rowsOf = (tab) => {
    const t = tab || tabOf(S.tab);
    return pool().filter(t.f).sort(tab ? tab.cmp : cmpFor());
  };
  const tabFor = (x) => (x.net < 0 ? "red" : "acc");

  function cardEvents(cf) {
    return cf.trades.map((x) => ({ who: x.member, ch: chOf(x.chamber), side: x.side, lo: x.amountLow, hi: x.amountHigh, txn: x.txnDate, filed: x.filedDate }))
      .filter((e) => e.who && (e.side === "buy" || e.side === "sell") && finite(e.lo) !== null && finite(e.hi) !== null && typeof e.txn === "string" && typeof e.filed === "string");
  }
  function feedEvents(t) {
    return recent.filter((x) => x.t === t && (x.side === "buy" || x.side === "sell") && finite(x.lo) !== null && finite(x.hi) !== null && x.txnDate && x.filedDate)
      .map((x) => ({ who: x.who, ch: chOf(x.memberType), side: x.side, lo: x.lo, hi: x.hi, txn: x.txnDate, filed: x.filedDate }));
  }

  function prep(r) {
    const b = netBounds(r), st = stateOf(r);
    if (!b || !st || !r.t) return null;
    const B = r.bought, Sd = finite(r.sold) || 0, g = B + Sd;
    const lag = finite(r.medianLagDays);
    return {
      r, t: r.t, B, S: Sd, net: b.mid, g, lo: b.lo, hi: b.hi, share: g > 0 ? b.mid / g : 0, st,
      lag, blind: blind(lag, WIN), filers: finite(r.filers) || 0, buys: finite(r.buys) || 0, sells: finite(r.sells) || 0,
      fresh: finite(r.freshBuys), fund: FUNDS.has(String(r.t).toUpperCase()), has: carded.has(cardKey(r.t)),
    };
  }

  function cardOf(x) {
    const e = cards.get(x.t);
    return e && e.state === "ok" ? e.cf : null;
  }
  function eventsOf(x) {
    const cf = cardOf(x);
    if (cf && cf.trades && cf.trades.length) { const ev = cardEvents(cf); if (ev.length) return { evs: ev, src: "card" }; }
    return { evs: feedEvents(x.t), src: "feed" };
  }

  let dlo = 0, dhi = 1;
  const sq = (v) => Math.sign(v) * Math.sqrt(Math.abs(v));
  const domain = (rows) => {
    let a = 0, b = 0;
    for (const x of rows) { a = Math.min(a, x.lo); b = Math.max(b, x.hi); }
    dlo = a; dhi = b > a ? b : a + 1;
  };
  const pos = (v) => (100 * (sq(v) - sq(dlo))) / (sq(dhi) - sq(dlo));

  function ringSvg(f) {
    const c = 2 * Math.PI * RING_R;
    return '<svg class="ring" viewBox="0 0 22 22" aria-hidden="true" data-blind="' + f.toFixed(4) + '"><circle cx="11" cy="11" r="' + RING_R + '"/><circle cx="11" cy="11" r="' + RING_R + '" stroke-dasharray="' + (c * f).toFixed(1) + " " + c.toFixed(1) + '" transform="rotate(-90 11 11)"/></svg>';
  }

  function renderMap(rows) {
    const host = $("plMap");
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    const cap = mobile() ? 12 : 18;
    const top = rows.slice().sort((a, b) => (S.size === "usd" ? b.g - a.g : b.filers - a.filers || b.g - a.g)).slice(0, cap);
    if (S.sel && !top.some((x) => x.t === S.sel)) {
      const s = rows.find((x) => x.t === S.sel);
      if (s) { top.pop(); top.push(s); }
    }
    const items = top.map((r) => ({ r, v: weight(r.r, S.size) })).sort((a, b) => b.v - a.v);
    const lay = squarify(items, 0, 0, W, H);
    tiles = lay.map((l) => ({ t: l.i.r.t, cx: l.x + l.w / 2, cy: l.y + l.h / 2 }));
    const hasSel = lay.some((z) => z.i.r.t === S.sel);
    host.innerHTML = lay.map((l, ix) => {
      const r = l.i.r, w = l.w - 3, h = l.h - 3;
      const big = w >= 96 && h >= 64, mid = w >= 62 && h >= 44;
      const i = Math.min(1, Math.abs(r.share));
      const aria = r.t + ", " + STL[r.st] + ", net " + smoney(r.net) + " estimated, " + plural(r.filers, "distinct filer", "distinct filers");
      let inner = '<span class="t">' + esc(r.t) + "</span>";
      if (mid) inner += '<span class="n"><span class="gl ' + TONE[r.st] + '-t">' + GLY[r.st] + "</span>" + smoney(r.net) + "</span>";
      if (big) inner += '<span class="f">' + plural(r.filers, "filer", "filers") + "</span>";
      return '<button type="button" class="pl-tile ' + r.st + (w < 62 ? " sm" : "") + '" data-t="' + esc(r.t) + '" style="left:' + (l.x + 1.5) + "px;top:" + (l.y + 1.5) + "px;width:" + w + "px;height:" + h + "px;--i:" + i.toFixed(2) + '" tabindex="' + (r.t === S.sel || (ix === 0 && !hasSel) ? 0 : -1) + '" aria-pressed="' + (r.t === S.sel) + '" aria-label="' + esc(aria) + '">' + (w >= 48 && h >= 44 && r.blind !== null ? ringSvg(r.blind) : "") + inner + "</button>";
    }).join("");
    if (!lay.length) host.innerHTML = '<div class="pl-empty">Nothing in this view.</div>';
  }

  function flCell(x) {
    const e = cards.get(x.t);
    if (e && e.state === "ok" && e.cf.conviction !== null) {
      return '<span class="pl-fl" title="Flows card: conviction ' + e.cf.conviction + " of 100" + (e.cf.ivRank === null ? "" : ", IV percentile " + e.cf.ivRank) + '"><b>' + e.cf.conviction + "</b>" + (e.cf.ivRank === null ? "" : " · IVR " + e.cf.ivRank) + "</span>";
    }
    if (x.has || (e && e.state === "ok")) return '<span class="pl-fl mut-t" title="This name has a Flows card. Select it to read the card.">card ↗</span>';
    return '<span class="pl-fl mut-t">' + DASH + "</span>";
  }

  function rowHTML(x, rank) {
    const col = x.net > 0 ? "var(--up-mark)" : x.net < 0 ? "var(--down-mark)" : "var(--label-3)";
    const a = pos(0), b = pos(x.net), bl = Math.min(a, b), bw = Math.abs(b - a), wl = pos(x.lo), wr = pos(x.hi);
    const tone = x.net > 0 ? "up" : x.net < 0 ? "down" : "mut";
    const lagTxt = x.lag === null ? DASH : Math.round(x.lag) + " d" + (x.blind === null ? "" : " · " + Math.round(x.blind * 100) + "%");
    const e = cards.get(x.t);
    const hasCard = x.has || (e && e.state === "ok");
    return '<div class="pl-row" role="option" data-t="' + esc(x.t) + '" aria-selected="' + (x.t === S.sel) + '" tabindex="' + (x.t === S.sel ? 0 : -1) + '" aria-label="' + esc(x.t + ", rank " + rank + ", " + STL[x.st] + ", net " + smoney(x.net) + " estimated, " + plural(x.filers, "distinct filer", "distinct filers") + ", " + plural(x.buys, "buy", "buys") + ", " + plural(x.sells, "sell", "sells")) + '">' +
      '<span class="pl-rk">' + rank + "</span>" +
      '<span class="pl-tk">' + esc(x.t) + "<i class='" + (hasCard ? "" : "n") + "' title='" + (hasCard ? "Has a Flows card" : "No Flows card") + "'></i></span>" +
      '<span class="pl-bar" aria-hidden="true"><span class="z" style="left:' + pos(0).toFixed(2) + '%"></span><span class="b" style="left:' + bl.toFixed(2) + "%;width:" + bw.toFixed(2) + "%;background:" + col + '"></span><span class="w" style="left:' + wl.toFixed(2) + "%;width:" + Math.max(0, wr - wl).toFixed(2) + '%"></span></span>' +
      '<span class="pl-num ' + tone + '-t">' + (x.net > 0 ? "▲ " : x.net < 0 ? "▼ " : "") + smoney(x.net) + "<small>" + usd(x.lo) + " to " + usd(x.hi) + "</small></span>" +
      '<span class="pl-num">' + x.filers + "</span>" +
      '<span class="pl-num hide-m hide-s"><span class="up-t">' + x.buys + '</span>/<span class="down-t">' + x.sells + "</span></span>" +
      '<span class="pl-bl hide-m" title="Median lag ' + (x.lag === null ? "unknown" : x.lag + " days") + ': trades in about that last stretch are typically not yet filed"><span>' + lagTxt + "</span><i><s style=\"width:" + ((x.blind || 0) * 100).toFixed(0) + '%"></s></i></span>' +
      '<span class="hide-m hide-s">' + flCell(x) + "</span></div>";
  }

  function renderList(rows) {
    domain(rows);
    const box = $("plList");
    const rh = parseFloat(getComputedStyle(document.querySelector(".pl-row") || box).getPropertyValue("--rh")) || (mobile() || coarse() ? 44 : 36);
    S.topN = Math.max(4, Math.floor(box.clientHeight / rh));
    let shown = rows.slice(0, S.topN), html = null;
    if (S.sel && !shown.some((x) => x.t === S.sel)) {
      const i = rows.findIndex((x) => x.t === S.sel);
      if (i >= 0) {
        shown = rows.slice(0, S.topN - 1);
        html = shown.map((x, k) => rowHTML(x, k + 1)).join("") + rowHTML(rows[i], i + 1);
      }
    }
    if (html === null) html = shown.map((x, k) => rowHTML(x, k + 1)).join("");
    box.innerHTML = rows.length ? html : '<div class="pl-empty">Nothing in this view.</div>';
    if (!box.querySelector('.pl-row[tabindex="0"]')) { const f = box.querySelector(".pl-row"); if (f) f.tabIndex = 0; }
    $("plAxis").textContent = mobile() ? "Net, low to high" : "Net, √ scale, low to high";
    for (const b of document.querySelectorAll(".pl-bh button[data-sort]")) b.setAttribute("aria-pressed", String(b.dataset.sort === sortKey()));
  }

  function drawTabs() {
    const base = pool();
    $("plTabs").innerHTML = TABS.map((t) => '<button type="button" role="tab" id="plTab-' + t.id + '" aria-selected="' + (t.id === S.tab) + '" tabindex="' + (t.id === S.tab ? 0 : -1) + '" data-id="' + t.id + '" aria-controls="plMain">' + t.label + " <em>" + base.filter(t.f).length + "</em></button>").join("");
  }

  function renderMain() {
    drawTabs();
    const tab = tabOf(S.tab);
    const rows = rowsOf();
    if (!rows.some((x) => x.t === S.sel)) S.sel = rows[0] ? rows[0].t : null;
    const isMap = S.view === "map";
    $("plMap").style.display = isMap ? "" : "none";
    $("plListView").style.display = isMap ? "none" : "flex";
    $("plSizeSeg").style.display = isMap ? "" : "none";
    $("plLegend").style.display = isMap ? "" : "none";
    for (const b of $("plViewSeg").children) b.setAttribute("aria-pressed", String(b.dataset.view === S.view));
    for (const b of $("plSizeSeg").children) b.setAttribute("aria-pressed", String(b.dataset.size === S.size));
    $("plLegend").innerHTML = ["accF", "accM", "mix", "redM"].map((k) => '<span><i class="sw ' + k + '"></i>' + STS[k] + "</span>").join("") + "<span>◔ share still unfiled</span>";
    const fnote = isMap ? (S.size === "usd" ? "Area ∝ √ disclosed $" : "Area ∝ distinct filers") + " · ring = share of window still unfiled · ranges, not amounts. " + tabNote(tab, false) : tabNote(tab, true);
    $("plFnote").title = fnote;
    $("plFnote").textContent = fnote;
    if (isMap) renderMap(rows); else renderList(rows);
    const mapH = $("plMap").clientHeight;
    const fundN = ALL.filter((x) => x.fund).length;
    const hid = !S.funds && fundN;
    const fb = $("plFundBtn");
    fb.style.display = fundN ? "" : "none";
    fb.textContent = S.funds ? "Hide " + fundN + " funds" : hid + " funds hidden · Include";
    fb.setAttribute("aria-pressed", String(S.funds));
    fb.setAttribute("aria-label", S.funds ? "Hide index and bond funds" : hid + " index and bond funds are hidden. Include them.");
    $("plAllBtn").textContent = "Show all " + rows.length;
    $("plAllBtn").style.display = (isMap ? rows.length > (mobile() ? 12 : 18) : rows.length > S.topN) ? "" : "none";
    $("plAllBtn").setAttribute("aria-label", "Show all " + rows.length + " stocks in " + tab.label);
    if (isMap && $("plMap").clientHeight !== mapH) renderMap(rows);
    renderSel();
    if (S.sel) loadCard(S.sel);
  }

  function evHTML(x, ev) {
    const evs = ev.evs;
    if (!evs.length) {
      return '<div class="pl-who"></div><span class="sub c">Filer names are not in this payload for this stock; the count of distinct filers is the evidence. The feed lists only the ' + recent.length + " newest filings overall, and none names " + esc(x.t) + ".</span>";
    }
    const g = new Map();
    for (const e of evs) {
      if (!g.has(e.who)) g.set(e.who, { who: e.who, ch: e.ch, b: 0, s: 0, mid: 0 });
      const o = g.get(e.who);
      if (e.side === "buy") o.b++; else o.s++;
      o.mid += (e.lo + e.hi) / 2;
    }
    const arr = [...g.values()].sort((a, b) => b.mid - a.mid);
    const max = mobile() ? 5 : 3;
    const monos = arr.slice(0, max).map((o) => {
      const k = o.b && o.s ? "m" : o.b ? "b" : "s";
      const act = (o.b ? plural(o.b, "buy", "buys") : "") + (o.b && o.s ? ", " : "") + (o.s ? plural(o.s, "sale", "sales") : "");
      return '<span class="pl-mono ' + k + '" title="' + esc(o.who + ", " + CHAMBER[o.ch] + ": " + act) + '" aria-label="' + esc(o.who + ", " + CHAMBER[o.ch] + ", " + act) + '"><b aria-hidden="true">' + esc(initials(o.who)) + "</b>" + o.ch + " " + (o.b ? "▲" + o.b : "") + (o.b && o.s ? " " : "") + (o.s ? "▼" + o.s : "") + "</span>";
    }).join("") + (arr.length > max ? '<span class="pl-mono" style="padding-left:9px">+' + (arr.length - max) + "</span>" : "");
    const hs = arr.filter((o) => o.ch === "H").length, sn = arr.filter((o) => o.ch === "S").length, ex = arr.filter((o) => o.ch === "E").length;
    const line = ev.src === "card" ? "From the card's disclosure list: " + plural(evs.length, "filing", "filings") + ", " + plural(arr.length, "filer", "filers") + "." : evs.length + " of the " + recent.length + " newest filings name it. The other filers behind its totals are not named.";
    return '<div class="pl-who">' + monos + '</div><span class="sub c">' + line + " House " + hs + " · Senate " + sn + (ex ? " · Exec " + ex : "") + ".</span>";
  }

  function closeOn(closes, d) {
    let v = null;
    for (const [dd, px] of closes) { if (dd <= d) v = px; else break; }
    return v;
  }

  const gap = (why) => DASH + '<small class="why"> ' + why + "</small>";
  function ctxHTML(x, evs) {
    const kv = (a, b) => '<div class="kv"><span>' + a + "</span><b>" + b + "</b></div>";
    const e = cards.get(x.t);
    const rows = (v) => kv("Conviction", v[0]) + kv("IV percentile", v[1]) + kv("Dealer γ book", v[2]) + kv("Dealer γ flow", v[3]) + kv("Premium C−P", v[4]) + kv("Price since", v[5]);
    const dash = [DASH, DASH, DASH, DASH, DASH, DASH];
    if (!e || e.state === "pending") return { head: "", html: rows(dash) + '<span class="sub c">The Flows card appears here once it is read.</span>' };
    if (e.state === "absent") return { head: "", html: rows(dash) + '<span class="sub c">No Flows card: not in the nightly universe.</span>' };
    if (e.state === "failed") return { head: "", html: rows(dash) + '<span class="sub c">' + esc(e.reason) + ' <button type="button" class="link" data-retry="' + esc(x.t) + '">Retry</button></span>' };
    const cf = e.cf;
    let since = null, why = "no closes";
    const nb = evs.filter((v) => v.side === "buy").sort((a, b) => (a.txn < b.txn ? 1 : -1))[0];
    if (cf.px !== null && nb) {
      const p0 = closeOn(cf.closes, nb.txn);
      if (p0) since = cf.px / p0 - 1; else why = "no close before " + fday(nb.txn);
    } else if (!nb) why = "no buy rows";
    const a = Math.sign(x.net), f = cf.flowP === null ? 0 : Math.sign(cf.flowP);
    const ag = cf.flowP === null ? "No net premium was published for this name." : f === 0 ? "Net premium is flat, so options flow neither agrees nor disagrees." : a === f ? "Options flow agrees with the filings. A check, not a signal." : "Options flow (" + (f > 0 ? "net calls" : f < 0 ? "net puts" : "flat") + ") disagrees: filings are weeks old.";
    const tn = (v) => (v === null ? "mut" : v > 0 ? "up" : v < 0 ? "down" : "mut");
    const miss = [];
    if (cf.conviction === null) miss.push("conviction");
    if (cf.ivRank === null) miss.push("IV percentile");
    if (cf.gammaBook === null || cf.gammaFlow === null) miss.push("dealer gamma");
    if (cf.flowP === null) miss.push("net premium");
    return {
      head: cf.asOf ? "card " + fday(cf.asOf) : "",
      html: rows([
        cf.conviction === null ? gap("not on the card") : cf.conviction + " /100",
        cf.ivRank === null ? gap("not on the card") : cf.ivRank + (cf.iv30 === null ? "" : " · IV " + F.pct(cf.iv30, 1)),
        cf.gammaBook || gap("not on the card"),
        cf.gammaFlow || gap("not on the card"),
        cf.flowP === null ? gap("none published") : '<span class="' + tn(cf.flowP) + '-t">' + smoney(cf.flowP) + "</span>",
        since === null ? gap(why) : '<span class="' + tn(since) + '-t">' + spct(since) + "</span>",
      ]) + '<span class="sub c" title="Net premium is calls minus puts, in dollars">' + [miss.length ? "Not on the card: " + miss.join(", ") + "." : "", since === null ? "Price since: " + why + "." : "", cf.flowP === null ? "" : ag].filter(Boolean).join(" ") + "</span>",
    };
  }

  function renderSel() {
    const x = ALL.find((a) => a.t === S.sel);
    const el = $("plRail");
    if (!x) {
      el.innerHTML = '<div class="pl-empty">Select a stock.</div>';
      $("plSelbar").innerHTML = "";
      return;
    }
    const tone = TONE[x.st];
    const ev = eventsOf(x);
    const ws = x.lag === null || !ASOF ? null : addDays(ASOF, -Math.round(x.lag));
    const kv = (a, b) => '<div class="kv"><span>' + a + "</span><b>" + b + "</b></div>";
    const cx = ctxHTML(x, ev.evs);
    const bw = x.lag === null || !ws ? "Lag not published; nothing inferred." : "Trades since about " + fday(ws) + " are typically still unfiled. No dollars imputed.";
    el.innerHTML =
      '<div class="pl-rhead"><span class="big">' + esc(x.t) + '</span><span class="pl-st ' + x.st + '">' + GLY[x.st] + ' <span class="l">' + STL[x.st] + '</span><span class="s">' + STS[x.st] + '</span></span><span class="why">' + WHY[x.st] + " " + plural(x.filers, "filer", "filers") + (x.filers >= minFilers ? ", broad" : ", narrow") + '.</span><a class="pl-open" href="/flows/ticker/?t=' + encodeURIComponent(x.t) + '" aria-label="Open the ' + esc(x.t) + ' ticker page">Open ticker ↗</a></div>' +
      '<div class="pl-rc first"><h3>Disclosed dollars</h3>' + kv("Buys", '<span class="up-t">' + usd(x.B) + "</span>") + kv("Range", usd(x.r.boughtLo) + "–" + usd(x.r.boughtHi)) + kv("Sells mid", '<span class="down-t">' + usd(x.S) + "</span>") + kv("Net mid", '<span class="' + tone + '-t">' + smoney(x.net) + "</span>") + kv("Net low bound", smoney(x.lo)) + "</div>" +
      '<div class="pl-rc"><h3>Breadth, freshness</h3>' + kv("Distinct filers", x.filers) + kv("Filings buy / sell", '<span class="up-t">' + x.buys + '</span> / <span class="down-t">' + x.sells + "</span>") + kv("Median lag", x.lag === null ? DASH : Math.round(x.lag) + " d") + kv("Filed " + (ASOF ? fday(ASOF) : DASH), x.buys && x.fresh !== null ? x.fresh + " of " + x.buys + " buys" : DASH) + "</div>" +
      '<div class="pl-rc chart"><h3>Traded vs filed<span class="pl-seg sm" role="group" aria-label="Chart window"><button type="button" data-w="30" aria-pressed="' + (S.win === 30) + '">30 d</button><button type="button" data-w="90" aria-pressed="' + (S.win === 90) + '">90 d</button></span></h3><div class="pl-svgwrap" id="plSvg" role="img" aria-label=""></div><span class="sub c" id="plStNote"></span></div>' +
      '<div class="pl-rc ctx"><h3>Flows context<span class="tx">' + esc(cx.head) + "</span></h3>" + cx.html + "</div>" +
      '<div class="pl-rc ev"><h3>Evidence<span class="tx">' + (ev.evs.length ? ev.evs.length + " rows" : "names not in feed") + "</span></h3>" + evHTML(x, ev) + "</div>";
    $("plSelbar").innerHTML = "<b>" + esc(x.t) + '</b><span><span class="' + tone + '-t">' + GLY[x.st] + "</span> " + STS[x.st] + '</span><span style="margin-left:auto">' + smoney(x.net) + " ›</span>";
    for (const b of el.querySelectorAll("[data-w]")) b.addEventListener("click", () => { S.win = +b.dataset.w; renderSel(); });
    for (const b of el.querySelectorAll("[data-retry]")) b.addEventListener("click", () => { cards.delete(b.dataset.retry); loadCard(b.dataset.retry, true); renderSel(); });
    drawStrip(x, ev.evs, bw);
  }

  function drawStrip(x, evs, bw) {
    const wrap = $("plSvg");
    if (!wrap || !ASOF) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const asMs = dms(ASOF), win = S.win, start = asMs - win * DAY, end = asMs + DAY * 0.5;
    const L = 4, R = 6, xs = (d) => L + ((d - start) / (end - start)) * (W - L - R);
    const top = 14, bot = H - 14, tY = top + (bot - top) * 0.28, fY = top + (bot - top) * 0.78;
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="plHat" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hatch" width="2" height="6"/></pattern></defs>';
    if (x.lag !== null) {
      const bx = Math.max(L, xs(asMs - x.lag * DAY));
      s += '<rect class="band" data-blind="1" x="' + bx + '" y="2" width="' + (W - R - bx) + '" height="' + (bot - 2) + '"/><rect class="overlay" fill="url(#plHat)" x="' + bx + '" y="2" width="' + (W - R - bx) + '" height="' + (bot - 2) + '"/>';
      s += '<text class="warn" x="' + (W - R - 3) + '" y="11" text-anchor="end">typically unfiled: last ' + Math.round(x.lag) + " d</text>";
    }
    s += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + tY + '" y2="' + tY + '"/><line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + fY + '" y2="' + fY + '"/>';
    s += '<text x="' + L + '" y="' + (tY - 5) + '">traded</text><text x="' + L + '" y="' + (fY - 5) + '">filed</text>';
    const inWin = evs.filter((e) => dms(e.txn) >= start).sort((a, b) => (a.txn < b.txn ? -1 : 1));
    const mx = Math.max(1, ...evs.map((e) => (e.lo + e.hi) / 2));
    for (const e of inWin) {
      const xt = xs(dms(e.txn)), xf = xs(dms(e.filed)), r = 3 + 3.5 * Math.sqrt((e.lo + e.hi) / 2 / mx), k = e.side;
      s += '<line class="ln ' + k + '" x1="' + xt.toFixed(1) + '" y1="' + tY + '" x2="' + xf.toFixed(1) + '" y2="' + fY + '"/><circle class="dot ' + k + '" cx="' + xf.toFixed(1) + '" cy="' + fY + '" r="2.4"/>';
      const tri = k === "buy" ? [[xt, tY - r], [xt - r, tY + r * 0.7], [xt + r, tY + r * 0.7]] : [[xt, tY + r], [xt - r, tY - r * 0.7], [xt + r, tY - r * 0.7]];
      s += '<polygon class="tri ' + k + '" data-txn="' + esc(e.txn) + '" data-filed="' + esc(e.filed) + '" points="' + tri.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ") + '"><title>' + esc(e.who + " " + e.side + " " + usd(e.lo) + " to " + usd(e.hi) + ", traded " + fday(e.txn) + ", filed " + fday(e.filed)) + "</title></polygon>";
    }
    const ticks = win === 30 ? [0, 10, 20, 30] : [0, 30, 60, 90];
    for (const k of ticks) {
      const d = asMs - (win - k) * DAY, xx = xs(d);
      s += '<text x="' + Math.min(W - R - 26, Math.max(L, xx - 12)).toFixed(0) + '" y="' + (H - 2) + '">' + fday(new Date(d).toISOString().slice(0, 10)) + "</text>";
    }
    s += "</svg>";
    wrap.innerHTML = s;
    const filedAgo = evs.length ? Math.round((asMs - Math.max(...evs.map((e) => dms(e.filed)))) / DAY) : null;
    const msg = evs.length ? "▲▼ traded, dots filed, size by band · " + inWin.length + " of " + evs.length + " in view · newest filed " + filedAgo + " d before the cut. " + bw : "No per-filing rows for this name. " + bw;
    $("plStNote").textContent = msg;
    wrap.setAttribute("aria-label", "Trade and filing dates for " + x.t + ". " + msg);
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
      }).catch((err) => cards.set(t, { state: "failed", reason: "The Flows card for " + t + " could not be read (" + (err && err.message ? err.message : "request failed") + "). The filings are unaffected." }))
        .then(() => { if (S.sel === t) renderSel(); refreshList(); });
    };
    if (now) run(); else cardTimer = setTimeout(() => { if (S.sel === t) run(); }, 220);
  }

  function refreshList() {
    if (S.view !== "list") return;
    renderList(rowsOf());
  }

  function select(t) {
    S.sel = t;
    for (const b of document.querySelectorAll(".pl-tile,.pl-row")) {
      const on = b.dataset.t === t;
      b.setAttribute(b.classList.contains("pl-row") ? "aria-selected" : "aria-pressed", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (!document.querySelector('.pl-tile[tabindex="0"]')) { const f = document.querySelector(".pl-tile"); if (f) f.tabIndex = 0; }
    if (!document.querySelector('#plList .pl-row[tabindex="0"]')) { const f = document.querySelector("#plList .pl-row"); if (f) f.tabIndex = 0; }
    renderSel();
    loadCard(t);
  }
  const go = (t) => { location.href = "/flows/ticker/?t=" + encodeURIComponent(t); };
  function reveal(t) {
    const x = ALL.find((a) => a.t === t);
    if (!x) return false;
    if (x.fund && !S.funds) S.funds = true;
    if (!tabOf(S.tab).f(x)) S.tab = tabFor(x);
    S.sel = t;
    renderMain();
    loadCard(t);
    return true;
  }

  function nearest(from, dir) {
    const c = tiles.find((t) => t.t === from);
    if (!c) return null;
    let best = null, bs = Infinity;
    for (const t of tiles) {
      if (t === c) continue;
      const dx = t.cx - c.cx, dy = t.cy - c.cy;
      const ok = dir === "R" ? dx > 4 : dir === "L" ? dx < -4 : dir === "D" ? dy > 4 : dy < -4;
      if (!ok) continue;
      const sc = dir === "R" || dir === "L" ? Math.abs(dx) + 2.5 * Math.abs(dy) : Math.abs(dy) + 2.5 * Math.abs(dx);
      if (sc < bs) { bs = sc; best = t; }
    }
    return best;
  }

  function listKeys(root, sel, onPick) {
    root.addEventListener("keydown", (e) => {
      const b = e.target.closest(sel);
      if (!b) return;
      const all = [...root.querySelectorAll(sel)], i = all.indexOf(b);
      const mv = (n) => { if (n) { n.focus(); if (onPick) onPick(n); } };
      if (e.key === "ArrowDown") { e.preventDefault(); mv(all[i + 1]); }
      else if (e.key === "ArrowUp") { e.preventDefault(); mv(all[i - 1]); }
      else if (e.key === "Home") { e.preventDefault(); mv(all[0]); }
      else if (e.key === "End") { e.preventDefault(); mv(all[all.length - 1]); }
      else if (e.key === "Enter" && b.dataset.t) { e.preventDefault(); go(b.dataset.t); }
    });
  }

  function setView(v) {
    $("plStage").dataset.view = v;
    for (const b of $("plSeg5").children) b.setAttribute("aria-selected", String(b.dataset.v === v));
    requestAnimationFrame(() => { if (v === "stocks") renderMain(); else if (v === "tape") renderTape(); else renderSel(); });
  }

  function openAll() {
    const rows = rowsOf(), tab = tabOf(S.tab);
    $("plAllT").textContent = tab.label + ": all " + rows.length + " stocks";
    $("plAllP").textContent = "Net estimate from band midpoints, disclosed through " + fwd(ASOF) + ". Choose one to read it.";
    $("plAllG").innerHTML = rows.map((x) => '<button type="button" data-t="' + esc(x.t) + '" aria-pressed="' + (x.t === S.sel) + '"><b>' + esc(x.t) + '</b><span class="' + TONE[x.st] + '-t">' + GLY[x.st] + " " + smoney(x.net) + "</span></button>").join("");
    $("plAllDlg").showModal();
    const f = $("plAllG").querySelector('[aria-pressed="true"]') || $("plAllG").firstElementChild;
    if (f) f.focus();
  }

  function tapeRow(r) {
    const buy = r.side === "buy", sell = r.side === "sell";
    const inAll = ALL.some((a) => a.t === r.t);
    const act = inAll ? "Select " + r.t : "Open the " + r.t + " ticker page";
    const side = buy ? "bought" : sell ? "sold" : "filed";
    return '<button type="button" class="pl-trow" data-t="' + esc(r.t) + '" tabindex="-1" aria-label="' + esc(r.t + " " + side + ", " + usd(r.lo) + " to " + usd(r.hi) + ", traded " + fday(r.txnDate) + ", filed " + fday(r.filedDate) + ", " + (r.lagDays === null || r.lagDays === undefined ? "lag unknown" : r.lagDays + " days late") + ". " + act) + '" title="' + esc(act) + '"><span class="pl-tk"><span class="gl ' + (buy ? "up" : sell ? "down" : "mut") + '-t">' + (buy ? "▲" : sell ? "▼" : "◆") + "</span>" + esc(r.t) + '</span><span class="bd"><span>' + usd(r.lo) + "–" + usd(r.hi) + "</span><small>" + fday(r.txnDate) + " → " + fday(r.filedDate) + '</small></span><span class="lg2">' + (r.lagDays === null || r.lagDays === undefined ? DASH : r.lagDays + " d") + '</span><span class="pl-mono t" title="' + esc((r.who || "") + ", " + CHAMBER[chOf(r.memberType)]) + '"><b aria-hidden="true">' + esc(initials(r.who)) + "</b></span></button>";
  }

  function renderTape() {
    const box = $("plTapeList");
    const rh = mobile() || coarse() ? 44 : 36;
    const n = Math.max(4, Math.floor(box.clientHeight / rh));
    box.innerHTML = tapeNamed.slice(0, n).map(tapeRow).join("");
    const f = box.querySelector(".pl-trow");
    if (f) f.tabIndex = 0;
    const un = recent.length - tapeNamed.length;
    $("plTapeNote").textContent = recent.length + " latest · " + tapeNamed.length + " name a stock";
    $("plTapeFoot").textContent = un + " of " + recent.length + " carry no ticker (bonds, funds, private assets).";
    $("plTapeAll").textContent = "Show all " + recent.length;
    $("plTapeAll").style.display = recent.length ? "" : "none";
  }

  function openTape() {
    $("plTapeT").textContent = "All " + recent.length + " newest filings";
    const first = recent.reduce((a, r) => (r.filedDate && r.filedDate < a ? r.filedDate : a), "9999");
    $("plTapeP").textContent = "Every disclosure filed " + fday(first) + " to " + fday(ASOF) + ". Filers appear as initials; the stock is the subject.";
    $("plTapeL").innerHTML = recent.map((r) => {
      const g = r.side === "buy" ? '<span class="up-t">▲</span>' : r.side === "sell" ? '<span class="down-t">▼</span>' : '<span class="mut-t">◆</span>';
      const nm = r.t || (r.notes ? String(r.notes).replace(/\s*\[[A-Z]+\]\s*$/, "") : "Unnamed asset");
      return "<li>" + g + "<div><span><b>" + esc(nm) + "</b></span><small>" + fday(r.txnDate) + " → " + fday(r.filedDate) + '<span class="ch"> · ' + esc(CHAMBER[chOf(r.memberType)]) + "</span></small></div><span>" + usd(r.lo) + "–" + usd(r.hi) + "</span></li>";
    }).join("");
    $("plTapeDlg").showModal();
    $("plTapeX").focus();
  }

  function openInfo() {
    const n = P && P.notes && typeof P.notes === "object" ? P.notes : {};
    const para = (t) => (typeof t === "string" && t ? "<p>" + esc(t) + "</p>" : "");
    $("plInfoB").innerHTML =
      "<p><b>Each row is a stock, not a politician.</b> The bar is disclosed purchases minus disclosed sales from the midpoint of each dollar band. The whisker runs from the low bound (purchases at their band floor, sales at twice their midpoint) to the high bound (purchases at their band ceiling, sales at an eighth of their midpoint). Sales carry midpoints only, so no name is ever called a firm reduction. Bars use a signed square-root scale so one large name does not flatten the rest.</p>" +
      "<p><b>Bounds agree.</b> The whole whisker is on the buying side of zero. Even the low bound is a net purchase.</p>" +
      "<p><b>Still blind.</b> The share of the window inside the name’s median filing lag, drawn as the ring on a tile. Trades that recent are typically not filed yet, and no dollars are guessed for them." + (WIN === null ? "" : " The window is " + WIN + " days.") + "</p>" +
      "<p><b>Filers.</b> Distinct people. Breadth tells you more than the size of one account. The feed has no party field, no current positions and no per-filer split by stock, so none is shown or inferred.</p>" +
      para(n.unit) + para(n.lag) + para(n.refusals) +
      "<p>" + (isNum(P && P.filings) === null ? "" : P.filings.toLocaleString("en-US") + " filings read " + (P.window ? fday(P.window.from) + " to " + fday(P.window.to) : "") + ". ") + "The feed lists the top names by purchases and by filer breadth (" + ALL.length + (seen === null ? "" : " of " + seen) + " names), so the Reducing view is under-counted. Estimates from disclosed ranges, not advice.</p>";
    $("plInfoDlg").showModal();
    const title = $("plInfoT");
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
    $("plInfoDlg").scrollTop = 0;
  }

  function paintHead() {
    const readAt = P.readAt;
    const day = F.trtDay(readAt);
    const read = day ? fday(day) + " " + F.time(readAt) : DASH;
    $("plStamp").innerHTML = "As disclosed through <b>" + fwd(ASOF) + "</b> · read " + read + " · " + (WIN === null ? DASH : WIN + "-day window");
  }

  function wire() {
    $("plMap").addEventListener("keydown", (e) => {
      const b = e.target.closest(".pl-tile");
      if (!b) return;
      const m = { ArrowRight: "R", ArrowLeft: "L", ArrowDown: "D", ArrowUp: "U" }[e.key];
      if (m) {
        e.preventDefault();
        const n = nearest(b.dataset.t, m);
        if (n) { select(n.t); const el = document.querySelector('.pl-tile[data-t="' + CSS.escape(n.t) + '"]'); if (el) el.focus(); }
      } else if (e.key === "Enter") { e.preventDefault(); go(b.dataset.t); }
    });
    $("plMap").addEventListener("click", (e) => { const b = e.target.closest(".pl-tile"); if (b) { select(b.dataset.t); if (mobile()) setView("detail"); } });
    $("plMap").addEventListener("mouseover", (e) => { const b = e.target.closest(".pl-tile"); if (b && !mobile() && b.dataset.t !== S.sel) select(b.dataset.t); });
    listKeys($("plList"), ".pl-row", (n) => select(n.dataset.t));
    $("plList").addEventListener("click", (e) => { const b = e.target.closest(".pl-row"); if (!b) return; select(b.dataset.t); if (mobile()) setView("detail"); });
    $("plSelbar").addEventListener("click", () => setView("detail"));
    document.querySelector(".pl-bh").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-sort]");
      if (!b) return;
      const def = tabOf(S.tab).def;
      S.sort = b.dataset.sort === def && !S.sort ? null : S.sort === b.dataset.sort ? null : b.dataset.sort;
      renderMain();
    });
    const pickTab = (id) => { S.tab = id; S.sort = null; S.sel = null; renderMain(); };
    $("plTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pickTab(b.dataset.id); });
    $("plTabs").addEventListener("keydown", (e) => {
      const i = TABS.findIndex((t) => t.id === S.tab);
      let n = null;
      if (e.key === "ArrowRight") n = (i + 1) % 3; else if (e.key === "ArrowLeft") n = (i + 2) % 3; else if (e.key === "Home") n = 0; else if (e.key === "End") n = 2;
      if (n === null) return;
      e.preventDefault();
      pickTab(TABS[n].id);
      $("plTab-" + TABS[n].id).focus();
    });
    $("plViewSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { S.view = b.dataset.view; renderMain(); } });
    $("plSizeSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { S.size = b.dataset.size; renderMain(); } });
    $("plFundBtn").addEventListener("click", () => { S.funds = !S.funds; renderMain(); });
    $("plAllBtn").addEventListener("click", openAll);
    $("plAllG").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; $("plAllDlg").close(); reveal(b.dataset.t); if (mobile()) setView("detail"); });
    $("plAllG").addEventListener("keydown", (e) => {
      const bs = [...$("plAllG").children], i = bs.indexOf(document.activeElement);
      if (i < 0) return;
      const cols = getComputedStyle($("plAllG")).gridTemplateColumns.split(" ").length;
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (!d) return;
      e.preventDefault();
      const n = bs[i + d];
      if (n) n.focus();
    });
    $("plAllX").addEventListener("click", () => $("plAllDlg").close());
    listKeys($("plTapeList"), ".pl-trow");
    $("plTapeList").addEventListener("click", (e) => {
      const b = e.target.closest(".pl-trow");
      if (!b) return;
      if (!reveal(b.dataset.t)) go(b.dataset.t); else if (mobile()) setView("detail");
    });
    $("plTapeAll").addEventListener("click", openTape);
    $("plTapeX").addEventListener("click", () => $("plTapeDlg").close());
    $("plInfoBtn").addEventListener("click", openInfo);
    $("plInfoX").addEventListener("click", () => $("plInfoDlg").close());
    for (const d of document.querySelectorAll(".pl-dlg")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    for (const b of $("plSeg5").children) b.addEventListener("click", () => setView(b.dataset.v));
    $("plSeg5").addEventListener("keydown", (e) => {
      const bs = [...$("plSeg5").children], i = bs.findIndex((b) => b.getAttribute("aria-selected") === "true");
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
        const v = $("plStage").dataset.view;
        if (!mobile() || v === "stocks") renderMain();
        if (!mobile() || v === "tape") renderTape();
        if (!mobile() || v === "detail") renderSel();
      }, 60);
    });
    ro.observe($("plStage"));
  }

  function get(path) {
    return fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } }).then((r) => {
      if (r.status === 401) { location.replace("/flows/"); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const at = Number(r.headers.get("X-Payload-Updated"));
      return r.json().then((body) => {
        if (body && typeof body === "object") body.__updatedAt = at > 0 ? at : null;
        return body;
      });
    });
  }

  function empty(kind, text) {
    status.textContent = text;
    status.dataset.empty = kind;
    $("plStage").hidden = true;
    $("plSeg5").hidden = true;
    const box = $("plNote");
    box.hidden = false;
    box.textContent = text;
    box.dataset.empty = kind;
  }

  function boot(p) {
    const rowsOfFeed = (f) => (f && f.status === "ok" && Array.isArray(f.rows) ? f.rows : []);
    const assets = rowsOfFeed(p.assets), clusters = rowsOfFeed(p.clusters);
    if (p.status === "pending" || (!assets.length && !clusters.length)) {
      if (p.status === "pending" || (!p.assets && !p.clusters)) return empty("pending", "No disclosure window has been read yet. This page appears with the first pipeline run after it shipped.");
      return empty("quiet", "The window was read and held no purchase that names a listed stock, so there is nothing to rank.");
    }
    P = p;
    WIN = p.window && finite(p.window.days) !== null ? p.window.days : null;
    ASOF = typeof p.latestFiled === "string" ? p.latestFiled : p.window && typeof p.window.to === "string" ? p.window.to : null;
    minFilers = p.clusters && finite(p.clusters.minFilers) !== null ? p.clusters.minFilers : 3;
    seen = p.clusters && finite(p.clusters.namesSeen) !== null ? p.clusters.namesSeen : null;
    carded = new Set((Array.isArray(p.carded) ? p.carded : []).map(cardKey));
    recent = rowsOfFeed(p.recent);
    tapeNamed = recent.filter((r) => r.t);
    const src = new Map();
    for (const r of assets) src.set(r.t, r);
    for (const r of clusters) if (!src.has(r.t)) src.set(r.t, r);
    ALL = [...src.values()].map(prep).filter(Boolean);
    paintHead();
    wire();
    status.textContent = "Disclosures read: " + ALL.length + " stocks.";
    renderMain();
    renderTape();
  }

  get("/api/flows/political").then((p) => {
    if (!p) return;
    UI.freshness({ sessionDate: p.sessionDate, generatedAt: p.generatedAt, updatedAt: p.__updatedAt, source: "political" });
    boot(p);
  }).catch((error) => {
    const t = "The disclosure window could not be loaded: " + error.message;
    status.textContent = t;
    status.dataset.empty = "unavailable";
    const box = $("plNote");
    if (box) { box.hidden = false; box.textContent = t; box.dataset.empty = "unavailable"; }
    const st = $("plStage");
    if (st) st.hidden = true;
    const sg = $("plSeg5");
    if (sg) sg.hidden = true;
  });
})();
