(() => {
  "use strict";

  const U = window.FlowsUI;
  const F = U.F;
  const DASH = U.DASH;
  const copyNode = document.getElementById("mcCopy");
  let COPY = {};
  try { COPY = JSON.parse(copyNode ? copyNode.textContent : "{}"); } catch { COPY = {}; }
  const say = (key, fields) => {
    const t = COPY[key];
    if (typeof t !== "string") return "";
    const f = fields || {};
    return t.replace(/\{([a-z0-9]+)\}/g, (m, n) => (f[n] === undefined || f[n] === null ? m : String(f[n])));
  };
  const REASONS = {
    unit: "the feed states no unit", zone: "the feed names a zone the site does not read", few: "too few observations", shape: "the feed's body is not in a shape the site reads",
    empty: "the feed returned no rows", dates: "the two legs have different dates", "no-symbols": "no contract is known for this product", failed: "the read failed tonight",
    limited: "the feed's read limit was reached", plan: "the feed plan does not include it", symbol: "the contract symbol could not be read", cap: "the night's call budget was spent", deadline: "the run passed its deadline",
  };
  const why = (code) => REASONS[code] || String(code || "withheld");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const root = $("mc");
  if (!root) return;

  const VIEWS = ["overview", "rates", "fx", "commod", "crypto", "futures", "odds", "season"];
  const FITS = { L: 1600, M: 1100, S: 700 };
  const DROPPED = { L: [], M: ["ff"], S: ["sprd", "ff", "mv"], XS: ["sprd", "ff", "mv"] };
  const MOD_FITS = {
    eq: "LMS", rt: "LMS", fx: "LMS", cm: "LM", cr: "LMS", cal: "LM", mv: "L",
    curve: "LMS", sprd: "LM", ff: "L", ind: "LMS", fxg: "LMS", fxc: "LMS", cmg: "LMS", crp: "LMS", crc: "LMS", crw: "LMS",
    fub: "LMS", fuc: "LMS", ful: "LMS", odc: "LMS", odd: "LMS", sef: "LMS", sep: "LMS",
  };
  const PAIR_DP = (p) => (p.endsWith("JPY") || p.endsWith("TRY") || p.endsWith("CNY") ? 2 : 4);
  const PRODUCT_NAMES = {
    ES: "S&P 500", NQ: "Nasdaq-100", RTY: "Russell 2000", YM: "Dow", ZT: "2-year note", ZN: "10-year note", ZB: "Bond", CL: "Crude oil", NG: "Natural gas", GC: "Gold", SI: "Silver", HG: "Copper", "6E": "Euro", "6J": "Yen",
  };
  const GROUPS = [["Equity", ["ES", "NQ", "RTY", "YM"]], ["Rates", ["ZT", "ZN", "ZB"]], ["Energy and metals", ["CL", "NG", "GC", "SI", "HG"]], ["Currencies", ["6E", "6J"]]];
  const ECON = [["cpi", "CPI"], ["inflation", "Inflation"], ["unemployment", "Unemployment"], ["payrolls", "Payrolls"], ["retail-sales", "Retail sales"], ["durables", "Durable goods"], ["gdp", "GDP"], ["gdp-per-capita", "GDP per capita"]];
  const COMMOD = [["wti", "WTI crude"], ["brent", "Brent crude"], ["natural-gas", "Natural gas"], ["copper", "Copper"], ["aluminum", "Aluminum"], ["wheat", "Wheat"], ["corn", "Corn"], ["cotton", "Cotton"], ["sugar", "Sugar"], ["coffee", "Coffee"], ["all-commodities", "All commodities"]];
  const PAIRS = ["EURUSD", "USDJPY", "GBPUSD", "USDCHF", "AUDUSD", "USDCAD", "USDCNY", "USDTRY"];
  const MATS = { "3month": "3M", "2year": "2Y", "5year": "5Y", "7year": "7Y", "10year": "10Y", "30year": "30Y" };
  const CRYPTO = [["BTC", "Bitcoin", "BTC-USD"], ["ETH", "Ether", "ETH-USD"], ["SOL", "Solana", "SOL-USD"]];
  const LIVE_EVERY_MS = 300000;

  const S = {
    macro: null, pending: false, view: "overview", solo: null, fit: "L", seg: { curve: "ES", season: "this" }, pair: "EURUSD", oddId: null,
    live: { board: null, futures: null, crypto: null, fx: {} }, liveOn: root.dataset.live === "on", liveAt: 0, timer: 0, painters: null, held: [],
  };

  const px = (v, dp) => F.px(v, dp).replace(/^([\u2212-]?)(\d+)/, (m, sg, d) => sg + d.replace(/\B(?=(\d{3})+$)/g, ","));
  const asOf = () => (S.macro && S.macro.session ? F.day(S.macro.session) : DASH);
  const srcNightly = () => say("src.nightly", { date: asOf() });
  const srcHero = (at) => say("src.live.hero", { time: F.time(at) });
  const srcLive = (b) => (b ? srcHero(b.readAt) : "");
  const glyphOf = (v) => (v === null ? "" : v > 0 ? "▲" : v < 0 ? "▼" : "■");
  const toneOf = (v) => (v === null ? "mut" : v > 0 ? "up" : v < 0 ? "down" : "flat");
  const chg = (v, dp = 2) => {
    const x = num(v);
    if (x === null) return `<span class="mc-chg mut" title="${esc(why("few"))}">${DASH}</span>`;
    return `<span class="mc-chg ${toneOf(x)}">${glyphOf(x)} ${F.pct(x, dp, true)}</span>`;
  };
  const bp = (v) => {
    const x = num(v);
    if (x === null) return `<span class="mc-chg mut">${DASH}</span>`;
    return `<span class="mc-chg ${toneOf(x)}">${glyphOf(x)} ${F.signed(x, 0)} bp</span>`;
  };
  const dashEl = (code) => `<span class="mc-why" title="${esc(say("state.withheld", { reason: why(code) }))}">${DASH}<span class="visually-hidden"> ${esc(say("state.withheld", { reason: why(code) }))}</span></span>`;
  const pend = () => `<p class="mc-pend">${esc(say("state.pending"))}</p>`;
  const sparkOf = (pts) => (S.painters ? S.painters.spark(pts) : `<svg class="mc-svg s" aria-hidden="true"></svg>`);
  const pointsOf = (spark) => (Array.isArray(spark) ? spark.map((p) => (Array.isArray(p) ? p[1] : p)).filter((v) => num(v) !== null) : []);
  const put = (m, html) => { const b = $("mcB-" + m); if (b) b.innerHTML = html; };
  const srcSet = (m, text) => { const s = $("mcS-" + m); if (s) s.textContent = text; };

  function tile(k, valueHtml, chgHtml, date, spark, title) {
    const when = date && date !== asOf() ? date : "";
    return `<div class="mc-tile" title="${esc(title || "")}"><span class="k">${esc(k)}</span><span class="v">${valueHtml}</span><span class="cd"><span class="c">${chgHtml}</span><span class="d">${esc(when)}</span></span><span class="s">${spark ? sparkOf(spark) : ""}</span></div>`;
  }
  const seriesTile = (name, s, dp = 2) => {
    if (!s) return tile(name, DASH, "", "", null);
    if (s.status !== "ok") return tile(name, dashEl(s.why || s.status), "", "", null);
    const ch = s.chg1 !== undefined ? chg(s.chg1) : chg(s.chgPrev);
    return tile(name, px(s.last[1], dp), ch, F.day(s.last[0]), pointsOf(s.spark));
  };

  function paintHero() {
    const m = S.macro;
    const set = (k, v, c, s, title) => {
      const el = $("mcH-" + k);
      if (!el) return;
      el.querySelector(".mc-cv").innerHTML = v;
      el.querySelector(".mc-cc").innerHTML = c;
      el.querySelector(".mc-cs").textContent = s || "";
      el.title = title || "";
    };
    if (!m) { return; }
    const es = m.futures && m.futures.products ? m.futures.products.ES : null;
    set("es", es && es.status === "ok" ? px(es.last[1], 2) : dashEl(es ? es.why || es.status : "failed"), es && es.status === "ok" ? chg(es.chg1) : "", srcNightly(), es && es.label ? "Most active contract " + es.label : "");
    const c10 = m.rates && m.rates.curve ? m.rates.curve.find((r) => r[0] === "10year") : null;
    const m1 = c10 && num(c10[3]) !== null ? (c10[1] - c10[3]) * 100 : null;
    set("ty", c10 ? px(c10[1], 2) + "%" : dashEl(m.rates ? m.rates.why || m.rates.status : "failed"), c10 ? bp(m1) : "", c10 ? say("src.nightly", { date: F.day(c10[2]) }) : "", "Change against 21 sessions back");
    const sp = m.rates && m.rates.spreads ? m.rates.spreads.s2s10 : null;
    set("sp", num(sp) === null ? dashEl(m.rates && m.rates.spreads ? "dates" : "failed") : F.signed(sp, 0) + " bp", num(sp) === null ? "" : `<span class="mc-chg mut">${esc(m.rates.spreads.state || "")}</span>`, srcNightly(), "");
    const w = m.commodities ? m.commodities.wti : null;
    set("wti", w && w.status === "ok" ? px(w.last[1], 2) : dashEl(w ? w.why || w.status : "failed"), w && w.status === "ok" ? chg(w.chg1 !== undefined ? w.chg1 : w.chgPrev) : "", w && w.status === "ok" ? say("src.nightly", { date: F.day(w.last[0]) }) : "", "");
    const gc = m.futures && m.futures.products ? m.futures.products.GC : null;
    set("gc", gc && gc.status === "ok" ? px(gc.last[1], 2) : dashEl(gc ? gc.why || gc.status : "failed"), gc && gc.status === "ok" ? chg(gc.chg1) : "", srcNightly(), say("commodities.gold"));
    const bf = S.live.board && S.live.board.fx ? S.live.board.fx.EURUSD : null;
    const nf = m.fx && m.fx.pairs ? m.fx.pairs.EURUSD : null;
    if (bf && bf.status === "ok") set("eur", px(bf.rate, 4), nf && nf.status === "ok" ? chg(nf.chg1) : "", bf.at ? srcHero(bf.at) : say("fx.zone"), "");
    else set("eur", nf && nf.status === "ok" ? px(nf.last[1], 4) : dashEl(nf ? nf.why || nf.status : "failed"), nf && nf.status === "ok" ? chg(nf.chg1) : "", srcNightly(), "");
    const bc = S.live.board && S.live.board.crypto ? S.live.board.crypto["BTC-USD"] : null;
    const nb = m.crypto ? m.crypto.BTC : null;
    if (bc && bc.status === "ok") set("btc", px(bc.close, 0), chg(bc.chg24), bc.at ? srcHero(bc.at) : "", "Change over 24 hours");
    else set("btc", nb && nb.status === "ok" ? px(nb.last[1], 0) : dashEl(nb ? nb.why || nb.status : "failed"), nb && nb.status === "ok" ? chg(nb.chg1) : "", srcNightly(), "");
  }

  function paintMeta() {
    const m = S.macro;
    const parts = [];
    if (m) parts.push(srcNightly());
    if (S.live.board) parts.push(srcLive(S.live.board));
    else if (!S.liveOn) parts.push(say("state.live.off"));
    $("mcMeta").textContent = parts.join(" ");
  }

  function paintEq() {
    const m = S.macro;
    if (!m) return put("eq", pend());
    const rows = ["ES", "NQ", "RTY", "YM"].map((p) => {
      const x = m.futures.products[p];
      if (!x || x.status !== "ok") return tile(PRODUCT_NAMES[p], dashEl(x ? x.why || x.status : "failed"), "", "", null);
      return tile(PRODUCT_NAMES[p] + " · " + x.label, px(x.last[1], 2), chg(x.chg1), F.day(x.last[0]), pointsOf(x.spark), say("futures.active"));
    });
    put("eq", `<div class="mc-tiles">${rows.join("")}</div>`);
    srcSet("eq", srcNightly());
  }

  function paintRt() {
    const m = S.macro;
    if (!m) return put("rt", pend());
    const r = m.rates;
    if (!r || r.status !== "ok") return put("rt", `<p class="mc-note">${esc(say("state.withheld", { reason: why(r ? r.why : "failed") }))}</p>`);
    const rows = ["2year", "10year", "30year"].map((k) => {
      const row = r.curve.find((c) => c[0] === k);
      if (!row) return `<div class="mc-row"><span>${MATS[k]}</span><span class="r">${DASH}</span><span class="r"></span><span></span></div>`;
      const d = num(row[3]) === null ? null : (row[1] - row[3]) * 100;
      return `<div class="mc-row"><span><b>${MATS[k]}</b></span><span class="r">${px(row[1], 2)}%</span><span class="r">${bp(d)}</span><span class="r"><small>${esc(F.day(row[2]))}</small></span></div>`;
    });
    const sp = num(r.spreads.s2s10);
    rows.push(`<div class="mc-row"><span><b>2s10s</b></span><span class="r">${sp === null ? dashEl("dates") : F.signed(sp, 0) + " bp"}</span><span class="r"><span class="mc-chip">${esc(r.spreads.state || "")}</span></span><span></span></div>`);
    put("rt", `<div class="mc-rows">${rows.join("")}</div><p class="mc-note">${esc(say("rates.state." + (r.spreads.state || "flat")))}</p>`);
    srcSet("rt", srcNightly());
  }

  function fxCell(p) {
    const n = S.macro && S.macro.fx && S.macro.fx.pairs ? S.macro.fx.pairs[p] : null;
    const b = S.live.board && S.live.board.fx ? S.live.board.fx[p] : null;
    return { n, b };
  }

  function paintFxOverview() {
    const m = S.macro;
    if (!m) return put("fx", pend());
    const tiles = ["EURUSD", "USDJPY", "GBPUSD", "USDCNY"].map((p) => {
      const { n, b } = fxCell(p);
      if (b && b.status === "ok") return tile(p, px(b.rate, PAIR_DP(p)), n && n.status === "ok" ? chg(n.chg1) : "", b.at ? F.time(b.at) : "", n && n.status === "ok" ? pointsOf(n.spark) : null);
      if (!n || n.status !== "ok") return tile(p, dashEl(n ? n.why || n.status : "failed"), "", "", null);
      return tile(p, px(n.last[1], PAIR_DP(p)), chg(n.chg1), F.day(n.last[0]), pointsOf(n.spark));
    });
    const br = m.fx.breadth;
    put("fx", `<div class="mc-tiles">${tiles.join("")}</div><p class="mc-line">${br ? esc(say("fx.breadth", { up: br.up, n: br.n })) : esc(say("fx.breadth.few"))}</p><p class="mc-note">${esc(say("fx.nodxy"))}</p>`);
    srcSet("fx", S.live.board ? srcLive(S.live.board) : srcNightly());
  }

  function paintCmOverview() {
    const m = S.macro;
    if (!m) return put("cm", pend());
    const c = m.commodities;
    const gc = m.futures.products.GC;
    const tiles = [seriesTile("WTI crude", c.wti), seriesTile("Brent crude", c.brent),
      gc && gc.status === "ok" ? tile("Gold · " + gc.label, px(gc.last[1], 2), chg(gc.chg1), F.day(gc.last[0]), pointsOf(gc.spark), say("commodities.gold")) : tile("Gold", dashEl(gc ? gc.why || gc.status : "failed"), "", "", null),
      seriesTile("Copper", c.copper)];
    put("cm", `<div class="mc-tiles">${tiles.join("")}</div>`);
    srcSet("cm", srcNightly());
  }

  function cryptoTile(sym, name, pair) {
    const n = S.macro && S.macro.crypto ? S.macro.crypto[sym] : null;
    const b = S.live.board && S.live.board.crypto ? S.live.board.crypto[pair] : null;
    if (b && b.status === "ok") return tile(name, px(b.close, sym === "SOL" ? 2 : 0), chg(b.chg24), b.at ? F.time(b.at) : "", n && n.status === "ok" ? pointsOf(n.spark) : null, "Change over 24 hours");
    if (!n || n.status !== "ok") return tile(name, dashEl(n ? n.why || n.status : "failed"), "", "", null);
    return tile(name, px(n.last[1], sym === "SOL" ? 2 : 0), chg(n.chg1), F.day(n.last[0]), pointsOf(n.spark));
  }

  function paintCrOverview() {
    if (!S.macro) return put("cr", pend());
    put("cr", `<div class="mc-tiles">${CRYPTO.map(([s, n, p]) => cryptoTile(s, n, p)).join("")}</div>`);
    srcSet("cr", S.live.board ? srcLive(S.live.board) : srcNightly());
  }

  function eventsOf() { return S.macro && S.macro.odds && Array.isArray(S.macro.odds.events) ? S.macro.odds.events : []; }
  const priceOf = (mk) => `<span class="mc-chip${mk.thin ? " warn" : ""}" title="${esc(say("odds.price", { p: F.pct(mk.price, 0) }) + (mk.thin ? " " + say("odds.thin") : ""))}">${mk.resolved ? "Resolved " : ""}${F.pct(mk.price, 0)}${mk.thin ? " ○" : ""}</span>`;
  const evWhen = (e) => `${F.day(F.trtDay(e.at))} ${F.time(e.at)}`;

  function paintCalOverview() {
    if (!S.macro) return put("cal", pend());
    const ev = eventsOf().slice(0, 6);
    if (!ev.length) return put("cal", `<p class="mc-note">${esc(say("odds.none"))}</p>`);
    const rows = ev.map((e) => {
      const mk = e.markets[0];
      return `<div class="mc-row c3"><span class="nm"><b>${esc(e.event)}</b></span><span class="r"><small>${esc(evWhen(e))}</small></span><span class="r">${mk ? priceOf(mk) : `<span class="mc-why" title="${esc(say("odds.none"))}">${DASH}<span class="visually-hidden"> ${esc(say("odds.none"))}</span></span>`}</span></div>`;
    });
    put("cal", `<div class="mc-rows">${rows.join("")}</div><p class="mc-note">${esc(say("odds.price", { p: "" }).replace(/\s+:/, ":"))}</p>`);
    srcSet("cal", srcNightly());
  }

  function paintMv() {
    const mv = S.macro ? S.macro.movers : null;
    if (!mv) return put("mv", pend());
    if (mv.status !== "ok") return put("mv", `<p class="mc-note">${esc(say("state.withheld", { reason: why(mv.why || mv.status) }))}</p>`);
    const row = (r) => `<div class="mc-row"><span><a href="/flows/ticker/?t=${encodeURIComponent(r[0])}"><b>${esc(r[0])}</b></a></span><span class="r">${px(r[1], 2)}</span><span class="r">${num(r[2]) === null ? dashEl("unit") : chg(r[2])}</span><span class="r"><small>${r[3] === null ? DASH : esc(F.int(r[3]))}</small></span></div>`;
    const list = (name, rows) => `<p class="mc-line"><b>${name}</b></p><div class="mc-rows">${rows.slice(0, 3).map(row).join("")}</div>`;
    put("mv", list("Gainers", mv.gainers) + list("Losers", mv.losers) + (mv.unit === "unknown" ? `<p class="mc-note">${esc(say("movers.unit"))}</p>` : ""));
    srcSet("mv", mv.asOf ? say("src.live", { time: F.time(mv.asOf) }) : srcNightly());
  }

  function paintCurve() {
    const m = S.macro;
    if (!m) return put("curve", pend());
    const r = m.rates;
    if (!r || r.status !== "ok") return put("curve", `<p class="mc-note">${esc(say("state.withheld", { reason: why(r ? r.why : "failed") }))}</p>`);
    const st = r.spreads.state;
    const chip = `<span class="mc-chip ${st === "inverted" ? "bad" : st === "normal" ? "ok" : ""}">${st === "inverted" ? "▼ Inverted" : st === "normal" ? "▲ Normal" : "■ Flat"}</span>`;
    const s210 = num(r.spreads.s2s10), s310 = num(r.spreads.s3m10);
    const line = `<p class="mc-line">${chip} <b>2s10s</b> ${s210 === null ? DASH : F.signed(s210, 0) + " bp"} · <b>3m10s</b> ${s310 === null ? DASH : F.signed(s310, 0) + " bp"}${r.fedFunds ? " · Fed funds " + px(r.fedFunds[0], 2) + "%" : ""}</p>`;
    put("curve", `${line}<div class="mc-curvewrap" id="mcCurve"></div><p class="mc-read" id="mcCurveRead" role="status" aria-live="polite"></p>`);
    srcSet("curve", srcNightly());
    $("mcA-curve").hidden = false;
    drawCurve();
  }
  function drawCurve() {
    const host = $("mcCurve");
    if (!host || !S.painters || !S.macro) return;
    S.painters.curve(host, S.macro.rates, $("mcCurveRead"), say("rates.asof", { date: "{date}" }));
  }

  function paintSprd() {
    const m = S.macro;
    if (!m) return put("sprd", pend());
    const r = m.rates;
    if (!r || r.status !== "ok") return put("sprd", `<p class="mc-note">${esc(say("state.withheld", { reason: why(r ? r.why : "failed") }))}</p>`);
    const sp = r.spreads;
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    put("sprd", `<dl class="mc-kv">${row("2s10s", num(sp.s2s10) === null ? dashEl("dates") : F.signed(sp.s2s10, 0) + " bp")}${row("3m10s", num(sp.s3m10) === null ? dashEl("dates") : F.signed(sp.s3m10, 0) + " bp")}${row("State", esc(sp.state || DASH))}${row("Fed funds", r.fedFunds ? px(r.fedFunds[0], 2) + "%" : DASH)}</dl><p class="mc-note">${esc(say("rates.state." + (sp.state || "flat")))}</p>`);
    srcSet("sprd", srcNightly());
  }

  function paintFf() {
    const r = S.macro ? S.macro.rates : null;
    if (!r) return put("ff", pend());
    put("ff", r.fedFunds ? `<p class="mc-line"><b>${px(r.fedFunds[0], 2)}%</b></p><p class="mc-note">${esc(say("src.nightly", { date: F.day(r.fedFunds[1]) }))}</p>` : `<p class="mc-note">${esc(say("state.withheld", { reason: why("failed") }))}</p>`);
  }

  function paintInd() {
    const m = S.macro;
    if (!m) return put("ind", pend());
    const rows = ECON.map(([k, name]) => {
      const e = m.economy[k];
      if (!e || e.status !== "ok") return `<div class="mc-eco"><span><b>${esc(name)}</b></span><span class="r">${dashEl(e ? e.why || e.status : "failed")}</span><span></span><span class="r"><small>${esc(say("series.unit"))}</small></span><span></span></div>`;
      const ch = num(e.chgPrev);
      return `<div class="mc-eco" title="${esc(say("series.age", { date: F.day(e.last[0]), days: e.ageDays }) + " " + say("series.prevrelease", { chg: ch === null ? DASH : F.pct(ch, 2, true), date: F.day(e.prev[0]) }))}"><span><b>${esc(name)}</b></span><span class="r">${px(e.last[1], 2)} <small>${esc(e.unit)}</small></span><span class="r">${ch === null ? DASH : chg(ch)}</span><span class="r"><small>${esc(F.day(e.last[0]))} · ${e.ageDays} d</small></span><span class="r">${sparkOf(pointsOf(e.spark))}</span></div>`;
    });
    put("ind", `<div class="mc-rows">${rows.join("")}</div>`);
    srcSet("ind", srcNightly());
  }

  function paintFxGrid() {
    const m = S.macro;
    if (!m) return put("fxg", pend());
    const br = m.fx.breadth;
    const head = `<p class="mc-line">${br ? esc(say("fx.breadth", { up: br.up, n: br.n })) : esc(say("fx.breadth.few"))} <span class="mc-why">${esc(say("fx.nodxy"))}</span></p>`;
    const rows = PAIRS.map((p) => {
      const { n, b } = fxCell(p);
      const live = b && b.status === "ok" ? `${px(b.rate, PAIR_DP(p))}` : null;
      const val = live || (n && n.status === "ok" ? px(n.last[1], PAIR_DP(p)) : dashEl(n ? n.why || n.status : "failed"));
      const when = live ? (b.at ? F.time(b.at) : say("fx.zone")) : n && n.status === "ok" ? F.day(n.last[0]) : "";
      return `<button type="button" class="mc-row mc-pick" data-pair="${p}" aria-pressed="${p === S.pair}"><span><b>${p}</b> <small>${esc(when)}</small></span><span class="r">${val}</span><span class="r">${n && n.status === "ok" ? chg(n.chg1) : ""}</span><span class="r">${n && n.status === "ok" ? sparkOf(pointsOf(n.spark)) : ""}</span></button>`;
    });
    put("fxg", head + `<div class="mc-rows">${rows.join("")}</div>`);
    srcSet("fxg", S.live.board ? srcLive(S.live.board) : srcNightly());
    $("mcB-fxg").querySelectorAll(".mc-pick").forEach((b) => b.addEventListener("click", () => { S.pair = b.dataset.pair; paintFxGrid(); paintFxChart(); loadLive(["fx"]); }));
  }

  function paintFxChart() {
    const live = S.live.fx[S.pair];
    if (!S.macro) return put("fxc", pend());
    if (!S.liveOn) return put("fxc", `<p class="mc-note">${esc(say("state.live.off"))}</p>`);
    if (!live) return put("fxc", `<p class="mc-note">${esc(S.pair)}: ${esc(say("state.pending"))}</p>`);
    if (live.status !== "ok" || !live.bars.length) return put("fxc", `<p class="mc-note">${esc(S.pair)}: ${esc(say("state.withheld", { reason: why(live.why || "zone") }))} ${live.why === "zone" ? esc(say("fx.zone")) : ""}</p>`);
    put("fxc", `<div class="mc-curvewrap" id="mcFxChart"></div><p class="mc-read" id="mcFxRead" role="status" aria-live="polite"></p>`);
    srcSet("fxc", srcLive(live));
    if (S.painters) S.painters.line($("mcFxChart"), live.bars, { label: S.pair, dp: PAIR_DP(S.pair), read: $("mcFxRead") });
  }

  function paintCmGrid() {
    const m = S.macro;
    if (!m) return put("cmg", pend());
    const tiles = COMMOD.map(([k, name]) => seriesTile(name, m.commodities[k]));
    const gc = m.futures.products.GC;
    tiles.splice(2, 0, gc && gc.status === "ok" ? tile("Gold · " + gc.label, px(gc.last[1], 2), chg(gc.chg1), F.day(gc.last[0]), pointsOf(gc.spark), say("commodities.gold")) : tile("Gold", dashEl(gc ? gc.why || gc.status : "failed"), "", "", null));
    const bw = m.commodities.brentWti;
    put("cmg", `<div class="mc-tiles">${tiles.join("")}</div><p class="mc-note">${esc(say("commodities.gold"))} ${esc(say("commodities.monthly"))}${bw ? " Brent less WTI " + px(bw.value, 2) + "." : ""}</p>`);
    srcSet("cmg", srcNightly());
  }

  function paintCrPairs() {
    const m = S.macro;
    if (!m) return put("crp", pend());
    const rows = CRYPTO.map(([s, name, pair]) => {
      const n = m.crypto[s];
      const b = S.live.board && S.live.board.crypto ? S.live.board.crypto[pair] : null;
      if (!n || n.status !== "ok") return `<div class="mc-row"><span><b>${s}</b></span><span class="r">${dashEl(n ? n.why || n.status : "failed")}</span><span></span><span></span></div>`;
      const val = b && b.status === "ok" ? px(b.close, s === "SOL" ? 2 : 0) : px(n.last[1], s === "SOL" ? 2 : 0);
      const ck = n.check;
      const chip = ck.v === "agree" ? `<span class="mc-chip ok" title="${esc(say("crypto.check.agree"))}">✓</span>` : ck.v === "differs" ? `<span class="mc-chip bad" title="${esc(say("crypto.check.differs", { gap: F.pct(ck.gap, 1) }))}">✕ ${F.pct(ck.gap, 1)}</span>` : `<span class="mc-chip" title="${esc(why("dates"))}">${DASH}</span>`;
      return `<div class="mc-row"><span><b>${s}</b> <small>${esc(b && b.status === "ok" ? "24h" : F.day(n.last[0]))}</small></span><span class="r">${val}</span><span class="r">${b && b.status === "ok" ? chg(b.chg24) : chg(n.chg1)}</span><span class="r">${chip}</span></div>`;
    });
    const detail = CRYPTO.map(([s]) => { const n = m.crypto[s]; return n && n.status === "ok" ? `${s} 21d ${num(n.chg21) === null ? DASH : F.pct(n.chg21, 1, true)} · rv ${num(n.rv21) === null ? DASH : F.pct(n.rv21, 0)}` : ""; }).filter(Boolean).join(" · ");
    put("crp", `<div class="mc-rows">${rows.join("")}</div><p class="mc-note">${esc(detail)} ${esc(say("crypto.rv"))}</p>`);
    srcSet("crp", S.live.board ? srcLive(S.live.board) : srcNightly());
  }

  function paintCrChart() {
    const c = S.live.crypto;
    if (!S.macro) return put("crc", pend());
    if (!S.liveOn) return put("crc", `<p class="mc-note">${esc(say("state.live.off"))}</p>`);
    if (!c) return put("crc", pend());
    if (!c.btc5m.length) return put("crc", `<p class="mc-note">${esc(say("state.withheld", { reason: why("empty") }))}</p>`);
    put("crc", `<div class="mc-curvewrap" id="mcCrChart"></div><p class="mc-read" id="mcCrRead" role="status" aria-live="polite"></p>`);
    srcSet("crc", srcLive(c));
    if (S.painters) S.painters.line($("mcCrChart"), c.btc5m, { label: "BTC", dp: 0, read: $("mcCrRead") });
  }

  function paintCrWhales() {
    const c = S.live.crypto;
    if (!S.macro) return put("crw", pend());
    if (!S.liveOn) return put("crw", `<p class="mc-note">${esc(say("state.live.off"))}</p>`);
    if (!c) return put("crw", pend());
    const w = c.whales, t = c.transfers;
    let html = "";
    if (w.status === "ok" && w.window) {
      html += `<p class="mc-line"><b>Whale trades</b> ${esc(say("futures.window", { from: F.time(w.window[0]), to: F.time(w.window[1]) }))}</p>`;
      const scale = Math.max(w.buy[1], w.sell[1], 1);
      const bar = (label, pair, cls) => `<div class="mc-bar2"><span>${label}</span><svg viewBox="0 0 100 16" preserveAspectRatio="none" role="img" aria-label="${label} ${F.money(pair[1])}"><rect x="0" y="2" width="${Math.max(0.5, (pair[1] / scale) * 100)}" height="12" class="${cls}"/></svg><span class="r">${pair[0]} · ${F.money(pair[1])}</span></div>`;
      html += bar("▲ Buy", w.buy, "buy") + bar("▼ Sell", w.sell, "sell");
      if (w.nullValue) html += `<p class="mc-note">${w.nullValue} without a value</p>`;
    } else html += `<p class="mc-note">Whale trades: ${esc(say("state.withheld", { reason: why(w.why || w.status) }))}</p>`;
    if (t.status === "ok" && t.n) {
      html += `<p class="mc-line"><b>Transfers</b> ${t.n} · ${F.money(t.usd)}</p><div class="mc-rows">${t.byType.slice(0, 3).map((r) => `<div class="mc-row"><span>${esc(r[0])}</span><span class="r">${r[1]}</span><span class="r">${F.money(r[2])}</span><span></span></div>`).join("")}${t.byChain.slice(0, 3).map((r) => `<div class="mc-row"><span>${esc(r[0])}</span><span class="r">${r[1]}</span><span class="r">${F.money(r[2])}</span><span></span></div>`).join("")}</div>`;
    }
    put("crw", html);
    srcSet("crw", srcLive(c));
  }

  function paintFuBoard() {
    const m = S.macro;
    if (!m) return put("fub", pend());
    const live = S.live.board && S.live.board.futures ? S.live.board.futures : {};
    let html = "";
    for (const [group, list] of GROUPS) {
      html += `<p class="mc-line"><b>${group}</b></p><div class="mc-rows">` + list.map((p) => {
        const x = m.futures.products[p];
        const l = live[p];
        if (!x || x.status !== "ok") return `<div class="mc-row"><span><b>${esc(PRODUCT_NAMES[p])}</b></span><span class="r">${dashEl(x ? x.why || x.status : "failed")}</span><span></span><span></span></div>`;
        const extra = l && l.status === "ok" ? `OI ${l.oi === null ? DASH : F.int(l.oi)}` : "";
        return `<div class="mc-row" title="${esc(say("futures.active"))}"><span><b>${esc(PRODUCT_NAMES[p])}</b> <small>${esc(x.label)}</small></span><span class="r">${px(x.last[1], 2)}</span><span class="r">${chg(x.chg1)}</span><span class="r"><small>${esc(extra)}</small></span></div>`;
      }).join("") + `</div>`;
    }
    put("fub", html);
    srcSet("fub", S.live.board ? srcLive(S.live.board) : srcNightly());
  }

  function paintFuCurve() {
    const m = S.macro;
    if (!m) return put("fuc", pend());
    const key = S.seg.curve;
    const c = m.futures.curves[key];
    const seg = `<div class="mc-seg" role="group" aria-label="Contract curve">${["ES", "CL", "ZN"].map((k) => `<button type="button" data-cv="${k}" aria-pressed="${k === key}">${k}</button>`).join("")}</div>`;
    if (!c || c.status !== "ok" || !c.points.length) {
      put("fuc", `${seg}<p class="mc-note">${esc(say("state.withheld", { reason: why(c ? c.why || c.status : "failed") }))}</p>`);
    } else {
      const chip = c.state ? `<span class="mc-chip">${esc(c.state)}</span> ${num(c.spread12) === null ? "" : F.pct(c.spread12, 2, true)}` : dashEl("dates");
      put("fuc", `${seg}<p class="mc-line">${chip} ${key === "ES" ? esc(say("futures.carry")) : ""}</p><div class="mc-curvewrap" id="mcFuChart"></div><p class="mc-read" id="mcFuRead" role="status" aria-live="polite"></p>`);
      if (S.painters) S.painters.contract($("mcFuChart"), c.points, $("mcFuRead"), say("futures.stale", { date: "{date}" }));
    }
    srcSet("fuc", say("futures.curve"));
    $("mcB-fuc").querySelectorAll("[data-cv]").forEach((b) => b.addEventListener("click", () => { S.seg.curve = b.dataset.cv; paintFuCurve(); }));
  }

  function paintFuLarge() {
    const m = S.macro;
    if (!m) return put("ful", pend());
    const lg = S.live.futures && S.live.futures.byProduct ? { window: S.live.futures.window, byProduct: S.live.futures.byProduct, top: [] } : m.futures.large;
    if (!lg || !lg.window) return put("ful", `<p class="mc-note">${esc(say("state.withheld", { reason: why("empty") }))}</p>`);
    const prods = Object.keys(lg.byProduct);
    const rows = prods.map((p) => {
      const b = lg.byProduct[p];
      const total = b.buy[1] + b.sell[1] + b.none[1] || 1;
      return `<div class="mc-bar2"><span><b>${p}</b></span><span class="mc-bar3" data-p="${p}">${S.painters ? S.painters.split(b) : ""}</span><span class="r"><small>${b.buy[0]}/${b.sell[0]}/${b.none[0]}${b.crossed[0] ? " +" + b.crossed[0] + "x" : ""}</small></span></div>`;
    });
    const top = (lg.top || []).slice(0, 6).map((t) => `<div class="mc-row"><span><small>${esc(F.time(t[0]))}</small> <b>${esc(t[1])}</b></span><span class="r">${t[3] === "buy" ? "▲" : t[3] === "sell" ? "▼" : "–"} ${esc(F.int(t[4]))}</span><span class="r">${px(t[5], 2)}</span><span></span></div>`);
    put("ful", `<p class="mc-line">${esc(say("futures.window", { from: F.time(lg.window[0]), to: F.time(lg.window[1]) }))}</p>${rows.join("")}<div class="mc-rows">${top.join("")}</div><p class="mc-note">${esc(say("futures.none"))} ${esc(say("futures.crossed"))}</p>`);
    srcSet("ful", S.live.futures ? srcLive(S.live.futures) : srcNightly());
  }

  function paintOdds() {
    const m = S.macro;
    if (!m) { put("odc", pend()); put("odd", pend()); return; }
    const ev = eventsOf();
    if (!ev.length) put("odc", `<p class="mc-note">${esc(say("odds.none"))}</p>`);
    else {
      let html = "";
      for (const e of ev.slice(0, 10)) {
        html += `<div class="mc-ev"><em>${esc(e.event)}</em><span>${esc(evWhen(e))}</span><span class="mc-chip">${esc(e.tag || "")}</span></div>`;
        if (!e.markets.length) html += `<p class="mc-note">${esc(say("odds.none"))}</p>`;
        for (const mk of e.markets) {
          html += `<button type="button" class="mc-odds" data-id="${esc(mk.id)}" aria-pressed="${S.oddId === mk.id}" title="${esc(say("odds.price", { p: F.pct(mk.price, 0) }))}"><span class="nm">${esc(mk.outcome || "")} <small>${esc(mk.question)}</small></span><span class="hs">${S.painters ? S.painters.bar(mk.price, mk.thin) : ""}</span><span class="pr">${F.pct(mk.price, 0)}</span><span class="hs">${S.painters ? S.painters.hist(mk.history) : ""}</span></button>`;
        }
      }
      const un = m.odds.unmatched || [];
      if (un.length) html += `<p class="mc-line"><b>${esc(say("odds.unmatched"))}</b></p>` + un.map((u) => `<div class="mc-ev"><em>${esc(u.question)}</em><span>${F.pct(u.price, 0)}</span></div>`).join("");
      put("odc", html);
      $("mcB-odc").querySelectorAll(".mc-odds").forEach((b) => b.addEventListener("click", () => { S.oddId = b.dataset.id; paintOdds(); }));
    }
    srcSet("odc", srcNightly());
    const all = ev.flatMap((e) => e.markets);
    const mk = all.find((x) => x.id === S.oddId) || all[0];
    if (!mk) return put("odd", `<p class="mc-note">${esc(say("odds.none"))}</p>`);
    const kv = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    put("odd", `<p class="mc-line"><b>${esc(mk.question)}</b></p><p class="mc-line">${esc(say("odds.price", { p: F.pct(mk.price, 0) }))}${mk.thin ? " " + esc(say("odds.thin")) : ""}${mk.basis === "last" ? " " + esc(say("odds.last")) : ""}${mk.resolved ? " " + esc(say("odds.resolved")) : ""}</p><dl class="mc-kv">${kv("Resolves", esc(mk.resolves ? F.day(F.trtDay(mk.resolves)) + " " + F.time(mk.resolves) : DASH))}${kv("Bid / ask", num(mk.bid) === null ? DASH : F.pct(mk.bid, 0) + " / " + F.pct(mk.ask, 0))}${kv("Spread", num(mk.spread) === null ? DASH : F.pct(mk.spread, 1))}${kv("Liquidity", num(mk.liquidity) === null ? DASH : F.money(mk.liquidity))}${kv("Volume", num(mk.volume) === null ? DASH : F.money(mk.volume))}</dl>` +
      (num(mk.top5Share) === null ? "" : `<p class="mc-note">${esc(say("odds.concentration", { s: F.pct(mk.top5Share, 0) }))} ${esc(say("odds.bots", { s: F.pct(mk.botShare, 0) }))}</p>`) +
      (mk.holders ? `<p class="mc-note">${esc(say("odds.holders", { w: F.pct(mk.holders.median, 0), cat: "Finance" }))}</p>` : "") + `<div class="mc-curvewrap" id="mcOddHist"></div>`);
    srcSet("odd", srcNightly());
    if (S.painters) S.painters.histBig($("mcOddHist"), mk.history);
  }

  function seasonRow(r) {
    const t = r[0];
    if (r[2] === null) return `<div class="mc-int"><span><b>${esc(t)}</b></span><span class="r">${r[1]}</span><span class="r" style="grid-column: 3 / 7">${esc(say("season.few"))}</span></div>`;
    const lo = r[3], hi = r[4], k = r[2], n = r[1];
    const coin = lo <= 0.5 && 0.5 <= hi;
    const mean = r[5], zero = r[6] <= 0 && 0 <= r[7];
    const label = say("season.cell", { k, n, lo: F.pct(lo, 0), hi: F.pct(hi, 0) });
    return `<div class="mc-int" role="group" aria-label="${esc(t + ". " + label + " " + (coin ? say("season.coin") : "") + " " + say("season.mean", { m: F.pct(mean, 1, true), a: F.pct(r[6], 1, true), b: F.pct(r[7], 1, true) }))}"><span><b>${esc(t)}</b></span><span class="r">${n}</span><span class="r">${S.painters ? S.painters.interval(r[3], r[4], k / n) : ""}</span><span class="r">${k}/${n}</span><span title="${esc(say("season.mean", { m: F.pct(mean, 1, true), a: F.pct(r[6], 1, true), b: F.pct(r[7], 1, true) }))}">${F.pct(mean, 1, true)} <small>${esc(F.pct(r[6], 1, true) + " to " + F.pct(r[7], 1, true))}</small></span><span class="r"><span class="mc-chip" title="${esc(zero ? say("season.zero") : "")}">${coin ? "● Coin" : mean > 0 ? "▲" : "▼"}</span></span></div>`;
  }

  function paintSeasonFunds() {
    const m = S.macro;
    if (!m) return put("sef", pend());
    const slot = S.seg.season;
    const seg = `<div class="mc-seg" role="group" aria-label="Month">${[["this", "This month"], ["next", "Next month"]].map(([k, l]) => `<button type="button" data-se="${k}" aria-pressed="${k === slot}">${l}</button>`).join("")}</div>`;
    const rows = (m.seasonality.funds[slot] || []).map(seasonRow);
    put("sef", `${seg}<p class="mc-note">${esc(say("season.def"))}</p><div class="mc-rows">${rows.join("")}</div>`);
    srcSet("sef", srcNightly());
    $("mcB-sef").querySelectorAll("[data-se]").forEach((b) => b.addEventListener("click", () => { S.seg.season = b.dataset.se; paintSeasonFunds(); paintSeasonScreen(); }));
  }

  function paintSeasonScreen() {
    const m = S.macro;
    if (!m) return put("sep", pend());
    const p = m.seasonality.performers[S.seg.season];
    if (!p || !p.rows.length) return put("sep", `<p class="mc-note">${esc(say("state.withheld", { reason: why("empty") }))}</p>`);
    const head = `<p class="mc-line">${esc(say("season.screen", { s: p.survive, n: p.tested }))} <span class="mc-why">${esc(say("season.rank"))}</span></p>`;
    const rows = p.rows.map((r) => {
      const ok = r[6] !== null && r[6] <= 0.1;
      const lo = r[4], hi = r[5];
      return `<div class="mc-int" role="group" aria-label="${esc(r[0] + ". " + say("season.cell", { k: r[3], n: r[2], lo: F.pct(lo, 0), hi: F.pct(hi, 0) }))}"><span><a href="/flows/ticker/?t=${encodeURIComponent(r[0])}"><b>${esc(r[0])}</b></a></span><span class="r">${r[2]}</span><span class="r">${S.painters ? S.painters.interval(lo, hi, r[3] / r[2]) : ""}</span><span class="r">${r[3]}/${r[2]}</span><span><small>${esc(r[1] || "")}</small></span><span class="r">${ok ? "✓" : ""}</span></div>`;
    });
    put("sep", head + `<div class="mc-rows">${rows.join("")}</div>`);
    srcSet("sep", srcNightly());
  }

  const PAINT = {
    eq: paintEq, rt: paintRt, fx: paintFxOverview, cm: paintCmOverview, cr: paintCrOverview, cal: paintCalOverview, mv: paintMv,
    curve: paintCurve, sprd: paintSprd, ff: paintFf, ind: paintInd, fxg: paintFxGrid, fxc: paintFxChart, cmg: paintCmGrid,
    crp: paintCrPairs, crc: paintCrChart, crw: paintCrWhales, fub: paintFuBoard, fuc: paintFuCurve, ful: paintFuLarge,
    odc: paintOdds, sef: paintSeasonFunds, sep: paintSeasonScreen,
  };

  function paintAll() {
    paintHero();
    paintMeta();
    for (const fn of Object.values(PAINT)) fn();
    fitAll();
  }

  function fitModule(mod) {
    const body = mod.querySelector(".mc-body");
    const btn = mod.querySelector(".mc-all");
    if (!body || !btn) return;
    const items = [...body.querySelectorAll(".mc-rows > .mc-row, .mc-rows > .mc-int, .mc-rows > .mc-eco, .mc-tiles > .mc-tile")];
    items.forEach((i) => i.classList.remove("is-cut"));
    if (!items.length) { btn.hidden = !mod.dataset.table; return; }
    let cut = 0;
    while (body.scrollHeight > body.clientHeight + 1 && cut < items.length - 2) {
      const last = [...items].reverse().find((i) => !i.classList.contains("is-cut"));
      if (!last) break;
      last.classList.add("is-cut");
      cut++;
    }
    btn.hidden = cut === 0 && !mod.dataset.table;
    btn.dataset.cut = String(cut);
  }
  function fitAll() { document.querySelectorAll(".mc-mod:not(.is-off)").forEach((mod) => { if (mod.offsetParent !== null || !mod.closest("[inert]")) fitModule(mod); }); }

  function openDialog(title, html) {
    $("mcDlgT").textContent = title;
    $("mcDlgB").innerHTML = html;
    const d = $("mcDlg");
    if (typeof d.showModal === "function" && !d.open) d.showModal();
  }
  function showAll(mod) {
    const body = mod.querySelector(".mc-body");
    const title = mod.querySelector(".ui-mod-t").textContent;
    if (mod.dataset.m === "curve" && S.macro && S.macro.rates && S.macro.rates.curve) {
      const rows = S.macro.rates.curve.map((r) => `<tr><td>${esc(MATS[r[0]])}</td><td class="r">${px(r[1], 2)}%</td><td>${esc(F.day(r[2]))}</td><td class="r">${num(r[3]) === null ? DASH : px(r[3], 2) + "%"}</td><td class="r">${num(r[5]) === null ? DASH : px(r[5], 2) + "%"}</td></tr>`).join("");
      return openDialog(title, `<table><thead><tr><th>Maturity</th><th class="r">Latest</th><th>Date</th><th class="r">21 sessions back</th><th class="r">252 sessions back</th></tr></thead><tbody>${rows}</tbody></table>`);
    }
    const clone = body.cloneNode(true);
    clone.querySelectorAll(".is-cut").forEach((n) => n.classList.remove("is-cut"));
    openDialog(title, clone.innerHTML);
  }

  function decide() {
    const w = root.clientWidth || window.innerWidth;
    const fit = w >= FITS.L ? "L" : w >= FITS.M ? "M" : w >= FITS.S ? "S" : "XS";
    root.dataset.fit = fit;
    S.fit = fit;
    const view = S.view;
    const mods = [...document.querySelectorAll("#mcV-" + view + " .mc-mod")];
    const kept = mods.filter((m) => !DROPPED[fit].includes(m.dataset.m));
    const shown = kept.filter((m) => (MOD_FITS[m.dataset.m] || "LMS").includes(fit));
    const hidden = kept.filter((m) => !shown.includes(m));
    const sub = $("mcSub");
    let entries = [];
    if (fit === "XS") entries = kept.map((m) => [m.dataset.m, m.dataset.short]);
    else if (hidden.length) entries = [["", "Board"], ...hidden.map((m) => [m.dataset.m, m.dataset.short])];
    if (fit === "XS" && (S.solo === null || !kept.some((m) => m.dataset.m === S.solo))) S.solo = kept.length ? kept[0].dataset.m : null;
    if (fit !== "XS" && S.solo !== null && !hidden.some((m) => m.dataset.m === S.solo)) S.solo = null;
    mods.forEach((m) => { m.classList.toggle("is-off", (fit !== "XS" && S.solo === null && !shown.includes(m)) || (S.solo !== null && S.solo !== m.dataset.m) || DROPPED[fit].includes(m.dataset.m)); if (S.solo === m.dataset.m) m.setAttribute("data-on", ""); else m.removeAttribute("data-on"); });
    if (S.solo !== null) root.dataset.solo = S.solo; else root.removeAttribute("data-solo");
    sub.hidden = entries.length < 2;
    sub.innerHTML = entries.map(([k, l]) => `<button type="button" role="tab" data-sub="${k}" aria-selected="${(S.solo || "") === k}">${esc(l)}</button>`).join("");
    sub.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { S.solo = b.dataset.sub || null; decide(); fitAll(); drawCurve(); }));
    const cells = [...document.querySelectorAll(".mc-cell")];
    cells.forEach((c) => { c.hidden = !c.dataset.fits.includes(fit); });
  }

  function selectView(v, user) {
    if (!VIEWS.includes(v)) v = "overview";
    S.view = v;
    S.solo = null;
    root.dataset.view = v;
    $("mcStage").dataset.view = v;
    document.querySelectorAll(".mc-tab").forEach((t) => { const on = t.dataset.v === v; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
    document.querySelectorAll(".mc-view").forEach((p) => { if (p.dataset.v === v) p.removeAttribute("inert"); else p.setAttribute("inert", ""); });
    try { history.replaceState(null, "", "#view=" + v); } catch (error) { void error; }
    decide();
    fitAll();
    drawCurve();
    if (user) loadLive(needed());
    $("mcStatus").textContent = document.querySelector(".mc-tab[aria-selected=true]").textContent;
  }

  function needed() {
    const v = S.view;
    if (v === "overview") return ["board"];
    if (v === "fx") return ["board", "fx"];
    if (v === "crypto") return ["board", "crypto"];
    if (v === "futures") return ["board", "futures"];
    return [];
  }

  async function loadMacro() {
    S.pending = true;
    try {
      const res = await fetch("/api/flows/macro", { credentials: "same-origin" });
      const body = res.ok ? await res.json() : null;
      S.macro = body && body.v === 1 ? body : null;
      if (!S.macro) put("eq", `<p class="mc-note">${esc(say("state.pending"))}</p>`);
    } catch { S.macro = null; }
    S.pending = false;
    paintAll();
    $("mcStatus").textContent = S.macro ? "Macro board loaded." : say("state.pending");
  }

  async function loadLive(parts) {
    if (!S.liveOn || document.hidden) return;
    for (const part of parts) {
      const q = part === "fx" ? "?part=fx&pair=" + encodeURIComponent(S.pair) : "?part=" + part;
      try {
        const res = await fetch("/api/flows/macro/now" + q, { credentials: "same-origin" });
        if (!res.ok) continue;
        const body = await res.json();
        if (part === "fx") S.live.fx[S.pair] = body; else S.live[part] = body;
      } catch { continue; }
    }
    S.liveAt = Date.now();
    paintHero();
    paintMeta();
    for (const k of ["eq", "fx", "cr", "fxg", "fxc", "crp", "crc", "crw", "fub", "ful"]) PAINT[k]();
    fitAll();
  }

  function schedule() {
    clearInterval(S.timer);
    if (!S.liveOn) return;
    S.timer = setInterval(() => { if (!document.hidden) loadLive(needed()); }, LIVE_EVERY_MS);
  }

  function attach(painters) {
    S.painters = painters;
    paintAll();
    drawCurve();
  }

  function init() {
    const hash = /(?:^|[#&])view=([a-z]+)/.exec(location.hash);
    const start = hash && VIEWS.includes(hash[1]) ? hash[1] : "overview";
    document.querySelectorAll(".mc-tab").forEach((t) => {
      t.addEventListener("click", () => selectView(t.dataset.v, true));
      t.addEventListener("keydown", (e) => {
        const i = VIEWS.indexOf(t.dataset.v);
        let j = i;
        if (e.key === "ArrowRight") j = (i + 1) % VIEWS.length; else if (e.key === "ArrowLeft") j = (i - 1 + VIEWS.length) % VIEWS.length; else if (e.key === "Home") j = 0; else if (e.key === "End") j = VIEWS.length - 1; else return;
        e.preventDefault();
        selectView(VIEWS[j], true);
        document.getElementById("mcT-" + VIEWS[j]).focus();
      });
    });
    window.addEventListener("hashchange", () => { const h = /view=([a-z]+)/.exec(location.hash); if (h && h[1] !== S.view) selectView(h[1], true); });
    $("mcInfoBtn").addEventListener("click", () => openDialog(say("nothere.title"), ["nothere.people", "nothere.scores", "movers.unit", "fx.nodxy", "season.def"].map((k) => `<p>${esc(say(k))}</p>`).join("")));
    $("mcDlgX").addEventListener("click", () => $("mcDlg").close());
    document.querySelectorAll(".mc-all").forEach((b) => b.addEventListener("click", () => showAll(b.closest(".mc-mod"))));
    if (window.ResizeObserver) new ResizeObserver(() => { decide(); fitAll(); drawCurve(); }).observe(root);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && S.liveOn && Date.now() - S.liveAt >= LIVE_EVERY_MS) loadLive(needed()); });
    selectView(start, false);
    U.defer("macro-charts", { when: "idle" });
    loadMacro().then(() => { loadLive(needed()); schedule(); });
  }

  window.FlowsUI = Object.freeze({ ...window.FlowsUI, macro: Object.freeze({ attach, state: () => S }) });
  init();
})();
