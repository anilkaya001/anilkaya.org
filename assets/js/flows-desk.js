(() => {
  "use strict";

  const UI = window.FlowsUI;
  if (!UI) return;
  const Q = window.FlowsQuant || null;
  const { h, s, F, glyph, DASH, MINUS } = UI;
  const C = UI.chart;

  const $ = (id) => document.getElementById(id);
  const entry = $("deskEntry"), input = $("deskInput"), list = $("deskList"), allBox = $("deskAll");
  const refreshBtn = $("deskRefresh"), clearBtn = $("deskClear"), statusEl = $("deskStatus"), foot = $("deskFoot");
  const grid = $("dkGrid"), filters = $("dkFilters");
  if (!entry || !input || !list || !grid) return;
  const T = (k) => { const n = document.querySelector('#dkCopy [data-k="' + k + '"]'); return n ? n.textContent.replace(/\s+/g, " ").trim() : ""; };

  const MAX_BUYING_POWER = 1e11;
  const MAX_SYMBOLS = 20;
  const CONCURRENCY = 3;
  const AGE_TICK_MS = 30000;
  const QUOTE_STALE_SECONDS = 300;
  const LOT = 100;
  const SHOWN = 12;
  const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
  const SIDES = ["csp", "cc", "both"];
  const RANKS = [["annualized", "Annualised yield"], ["premium", "Premium received"], ["yieldOnCollateral", "Yield on collateral"], ["cushionSigmas", "Cushion"], ["collectible", "Premium collectible"], ["edge", "EV real world"]];
  const TENORS = [["All", 0, 1e9], ["≤ 2w", 0, 14], ["2–6w", 15, 45], ["> 6w", 46, 1e9]];
  const SERIES = ["--s-blue", "--s-orange", "--s-purple", "--s-teal", "--s-yellow"];

  const book = new Map();
  let inflight = 0;
  let statusOwned = true;
  let buyingPower = null;
  let side = "both", rank = "annualized", tenor = 0, axis = 0, surfaceSymbol = null;
  const say = (text) => { statusEl.textContent = text; statusEl.classList.remove("visually-hidden"); statusOwned = false; };

  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const fmt2 = (v) => { const n = isNum(v); return n === null ? DASH : n.toFixed(2); };
  const fmtMoney = (v) => { const n = isNum(v); return n === null ? DASH : (n < 0 ? MINUS : "") + "$" + Math.round(Math.abs(n)).toLocaleString("en-US"); };
  const fmtPct = (v, d = 1) => { const n = isNum(v); return n === null ? DASH : (n < 0 ? MINUS : "") + (Math.abs(n) * 100).toFixed(d) + "%"; };
  const fmtSd = (v) => { const n = isNum(v); return n === null ? DASH : (n < 0 ? MINUS : "") + Math.abs(n).toFixed(2) + " SD"; };
  const fmtInt = (v) => { const n = isNum(v); return n === null ? DASH : Math.round(n).toLocaleString("en-US"); };
  const kf = (K) => String(+(+K).toFixed(2));
  const sg = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
  const usd = (v) => (isNum(v) === null ? DASH : sg(Math.round(v)) + "$" + Math.abs(Math.round(v)).toLocaleString("en-US"));
  const fmtAge = (sec) => { const n = isNum(sec); if (n === null) return ""; if (n < 45) return "just now"; if (n < 5400) return Math.round(n / 60) + "m ago"; return Math.round(n / 3600) + "h ago"; };
  const ageOf = (p) => { if (!p) return null; const b = isNum(p.__age); if (b === null) return null; const at = isNum(p.__at); return at === null ? b : b + Math.max(0, (Date.now() - at) / 1000); };

  function parseBuyingPower(raw) {
    const text = String(raw === null || raw === undefined ? "" : raw).trim().toLowerCase().replace(/[$,\s_]/g, "");
    if (!text) return null;
    const m = /^(\d*\.?\d+)([kmb])?$/.exec(text);
    if (!m) return null;
    const base = Number(m[1]);
    if (!Number.isFinite(base) || base <= 0) return null;
    const v = base * (m[2] === "b" ? 1e9 : m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1);
    return v > 0 && v <= MAX_BUYING_POWER ? v : null;
  }
  const formatBuyingPower = (v) => (isNum(v) === null ? "" : Math.round(v).toLocaleString("en-US"));

  function sizeRow(row, bp) {
    if (bp === null || !(bp > 0)) return null;
    const collateral = isNum(row && row.collateral), premium = isNum(row && row.premium);
    if (collateral === null || !(collateral > 0) || premium === null || !(premium > 0)) return null;
    const contracts = Math.floor(bp / collateral);
    const deployed = contracts * collateral;
    return { contracts, affordable: contracts > 0, collectible: contracts * premium, deployed, idle: bp - deployed, yieldOnDeployed: deployed > 0 ? (contracts * premium) / deployed : null };
  }

  const normalise = (raw) => {
    const out = [];
    for (const p of raw) {
      const t = String(p || "").trim().toUpperCase();
      if (!TICKER_RE.test(t) || out.includes(t)) continue;
      out.push(t);
      if (out.length >= MAX_SYMBOLS) break;
    }
    return out;
  };

  function readURL() {
    try {
      const q = new URLSearchParams(location.search);
      const st = q.get("strategy");
      if (SIDES.includes(st)) side = st;
      const r = q.get("rank");
      if (r && RANKS.some(([k]) => k === r)) rank = r;
      buyingPower = parseBuyingPower(q.get("bp"));
      if (rank === "collectible" && buyingPower === null) rank = "annualized";
      const sf = String(q.get("surface") || "").trim().toUpperCase();
      surfaceSymbol = TICKER_RE.test(sf) ? sf : null;
      return normalise((q.get("t") || "").split(/[,\s]+/));
    } catch { return []; }
  }

  function writeURL() {
    try {
      const url = new URL(location.href);
      const syms = [...book.keys()];
      if (syms.length) url.searchParams.set("t", syms.join(",")); else url.searchParams.delete("t");
      url.searchParams.set("strategy", side);
      url.searchParams.set("rank", rank);
      if (buyingPower !== null) url.searchParams.set("bp", String(Math.round(buyingPower))); else url.searchParams.delete("bp");
      if (surfaceSymbol !== null && book.has(surfaceSymbol)) url.searchParams.set("surface", surfaceSymbol); else url.searchParams.delete("surface");
      history.replaceState(null, "", url);
    } catch { return; }
  }

  function noteFor(e) {
    if (!e) return "";
    if (e.state === "loading") return "loading…";
    if (e.state === "error") return e.error || "failed";
    const p = e.payload;
    if (!p) return "";
    const parts = [];
    if (isNum(p.spot) !== null) parts.push("$" + fmt2(p.spot) + (p.spotSource === "daily-close" ? " close" : ""));
    const shown = (p.rows || []).length, priced = isNum(p.priced);
    parts.push((priced !== null && shown < priced ? fmtInt(shown) + " of " + fmtInt(priced) : fmtInt(priced)) + " sellable" + (p.truncated ? " of a partial chain" : ""));
    const sec = ageOf(p);
    parts.push(sec === null ? "age not stated" : fmtAge(sec));
    return parts.join(" · ");
  }

  const selectedSymbols = () => [...book.entries()].filter(([, e]) => e.selected).map(([k]) => k);
  const colorOf = (sym) => SERIES[[...book.keys()].indexOf(sym) % SERIES.length];

  function renderChips() {
    list.replaceChildren(...[...book.entries()].map(([sym, e]) => {
      const note = h("span", { class: "desk-chip__note visually-hidden" }, noteFor(e));
      e.__note = note;
      const p = e.payload;
      const live = p && p.spotSource !== "daily-close";
      const toggle = h("button", {
        type: "button", class: "dk-chip-t", "aria-pressed": String(e.selected), title: noteFor(e),
        onclick: () => { e.selected = !e.selected; syncAll(); renderChips(); render(); if (e.selected && e.state === "idle") runPool([sym], {}); },
      },
      h("i", { class: "dk-dot", style: { "--c": UI.cssVar(colorOf(sym)) }, "aria-hidden": "true" }),
      h("b", { class: "desk-chip__sym" }, sym),
      e.state === "ok" && p ? h("span", { class: "dk-chip-px" }, fmt2(p.spot)) : null,
      e.state === "loading" ? h("span", { class: "dk-chip-px" }, glyph("pending")) : null,
      e.state === "error" ? h("span", { class: "dk-chip-px" }, glyph("unavailable")) : null,
      e.state === "ok" && p ? glyph(live ? "live" : "closed", "dk-src") : null, note);
      const x = h("button", { type: "button", class: "dk-chip-x", "aria-label": "Remove " + sym, onclick: () => { book.delete(sym); writeURL(); renderChips(); render(); } }, glyph("x"));
      return h("span", { class: "desk-chip is-" + e.state, "data-t": sym }, toggle, x);
    }));
    syncAll();
  }

  function syncAll() {
    allBox.disabled = !book.size;
    if (!book.size) { allBox.checked = false; allBox.indeterminate = false; return; }
    let on = 0;
    for (const e of book.values()) if (e.selected) on++;
    allBox.checked = on === book.size;
    allBox.indeterminate = on > 0 && on < book.size;
  }

  const serverRank = (k) => (k === "collectible" || k === "edge" ? "yieldOnCollateral" : k);

  function messageFor(status, body) {
    const code = body && body.error && body.error.code;
    if (code === "chain_empty" || status === 404) return "no listed options";
    if (code === "chain_rate_limited" || status === 429) return "rate limited — try again shortly";
    if (code === "chain_unconfigured") return "live lookup not configured";
    if (code === "chain_no_spot") return "no usable price";
    if (status >= 500) return "data provider unavailable";
    if (status === 400) return "not a valid symbol";
    return "failed (" + status + ")";
  }

  async function fetchOne(sym, { refresh = false } = {}) {
    const e = book.get(sym);
    if (!e) return;
    e.state = "loading";
    e.error = null;
    const seq = (e.seq || 0) + 1;
    e.seq = seq;
    renderChips();
    const params = new URLSearchParams({ t: sym, strategy: side, rank: serverRank(rank) });
    if (refresh) params.set("refresh", "1");
    try {
      const res = await fetch("/api/flows/chain?" + params.toString(), { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (res.status === 401) { location.replace("/flows/"); return; }
      const age = isNum(res.headers.get("X-Chain-Age"));
      const body = await res.json().catch(() => null);
      if (e.seq !== seq) return;
      if (!res.ok) { e.state = "error"; e.error = messageFor(res.status, body); e.payload = null; }
      else if (!body || typeof body !== "object") { e.state = "error"; e.error = "unreadable response"; e.payload = null; }
      else {
        e.state = "ok";
        e.payload = body;
        body.__age = age === null ? undefined : age;
        body.__at = age === null ? undefined : Date.now();
        price(sym, body);
        if (body.asOf) UI.freshness({ sessionDate: body.asOf, generatedAt: body.generatedAt, source: "desk " + sym });
      }
    } catch {
      if (e.seq !== seq) return;
      e.state = "error"; e.error = "network error"; e.payload = null;
    }
    renderChips();
    render();
  }

  function quoteMs(p) {
    const tape = p.tapeTime ? Date.parse(String(p.tapeTime).replace(" ", "T")) : NaN;
    if (Number.isFinite(tape)) return tape;
    const close = /^\d{4}-\d{2}-\d{2}$/.test(String(p.asOf || "")) ? Date.parse(p.asOf + "T20:00:00Z") : NaN;
    if (Number.isFinite(close)) return close;
    return Date.parse(p.generatedAt) || Date.now();
  }

  function price(sym, p) {
    const eng = p.engine && p.engine.status === "ok" ? p.engine : null;
    const asOfMs = quoteMs(p);
    for (const r of p.rows || []) {
      r.__eng = null;
      if (!Q) { r.__why = "The engine bundle did not load."; continue; }
      const type = r.type === "P" ? "P" : "C";
      const row = { K: r.strike, type, bid: isNum(r.bid), ask: isNum(r.ask), oi: isNum(r.oi), volume: isNum(r.volume), sym: r.symbol, ivSeed: isNum(r.iv) };
      try {
        const fit = Q.contractFit({ expiry: r.expiry, asOfMs, spot: p.spot, rate: eng && eng.rate ? eng.rate.r : null, row });
        if (!fit) { r.__why = "No implied volatility inverts from this contract's mid."; continue; }
        const setup = Q.labSetup({ asOfMs, spot: p.spot, facts: eng ? eng.facts : [], state: eng ? eng.state : null, pLaw: eng ? eng.pLaw : null, event: eng ? eng.event : null, stale: eng ? eng.stale : false, books: [{ fit, rows: [row] }] });
        const legs = r.strategy === "cc" ? [{ type: "S", side: 1, qty: 1 }, { type: "C", K: r.strike, side: -1, qty: 1 }] : [{ type: "P", K: r.strike, side: -1, qty: 1 }];
        r.__eng = Q.priceStructure(setup, { family: r.strategy === "cc" ? "covered-call" : "short-put", expiry: r.expiry, legs, basis: "natural" });
        if (!r.__eng) r.__why = "The engine could not price this line.";
      } catch { r.__eng = null; r.__why = "The engine could not price this line."; }
      r.__law = eng && eng.pLaw ? null : eng ? "this name's card publishes no real-world law" : "no card is published for " + sym + ", so there is no real-world law";
    }
  }

  async function runPool(syms, opts) {
    const queue = syms.slice();
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      workers.push((async () => {
        while (queue.length) {
          const next = queue.shift();
          inflight++;
          updateStatus();
          try { await fetchOne(next, opts); } finally { inflight--; }
          updateStatus();
        }
      })());
    }
    await Promise.all(workers);
  }

  const shortDelta = (r) => {
    const e = r.__eng;
    if (!e) return null;
    const leg = e.legs.find((l) => l.type !== "S");
    return leg && isNum(leg.delta) !== null ? Math.abs(leg.delta) : null;
  };
  const popQ = (r) => (r.__eng ? r.__eng.prob.popQ : null);
  const popP = (r) => (r.__eng ? r.__eng.prob.popP : null);
  const evP = (r) => (r.__eng ? r.__eng.ev.p : null);

  function rowsNow() {
    const rows = [];
    let screened = 0, priced = 0;
    const gated = Object.create(null), slices = [], uncounted = [];
    for (const sym of selectedSymbols()) {
      const e = book.get(sym);
      if (!e || e.state !== "ok" || !e.payload) continue;
      const p = e.payload;
      const kept = (p.rows || []).length, sc = isNum(p.screened), sell = isNum(p.priced);
      if (sc === null || sell === null) uncounted.push(sym);
      else {
        screened += sc; priced += sell;
        for (const [k, n] of Object.entries(p.gated || {})) gated[k] = (gated[k] || 0) + (isNum(n) || 0);
      }
      if (sell !== null && kept < sell) slices.push({ sym, kept, sell, rankedBy: p.rankedBy || null });
      for (const r of p.rows || []) rows.push(Object.assign(r, { __spot: p.spot, __sym: sym }));
    }
    for (const r of rows) r.__sizing = sizeRow(r, buyingPower);
    const key = rank === "collectible" ? (r) => (r.__sizing ? r.__sizing.collectible : null) : rank === "edge" ? evP : (r) => r[rank];
    rows.sort((a, b) => {
      const x = isNum(key(a)), y = isNum(key(b));
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    });
    return { rows, screened, priced, gated, slices, uncounted };
  }

  const inTenor = (r) => { const t = TENORS[tenor]; return r.days >= t[1] && r.days <= t[2]; };

  const mods = {};
  function ensureModules() {
    if (mods.scatter) return;
    mods.sideSeg = UI.segmented("Sell", [{ label: "Puts" }, { label: "Calls" }, { label: "Both" }], (i) => setSide(SIDES[i]), SIDES.indexOf(side));
    mods.sideSeg.id = "deskStrategy";
    mods.tenorSeg = UI.segmented("Days to expiry", TENORS.map(([l]) => ({ label: l })), (i) => { tenor = i; render(); }, tenor);
    mods.tenorSeg.id = "dkTenor";
    filters.prepend(mods.sideSeg, mods.tenorSeg);
    mods.axisSeg = UI.segmented("Risk axis", [{ label: "Delta" }, { label: "Chance" }], (i) => { axis = i; drawScatter(); }, axis);
    mods.scatter = h("div", { class: "dk-scatter", id: "dkScatter" });
    mods.legend = h("div", { class: "tl-legend" });
    const frontier = UI.moduleCard({ id: "dkFrontierM", title: "Frontier", span: 8, index: 0, seg: mods.axisSeg, info: frontierInfo, body: [mods.scatter, mods.legend] });
    mods.bp = h("input", { id: "deskBP", name: "bp", type: "text", inputmode: "numeric", autocomplete: "off", spellcheck: "false", placeholder: "25,000", "aria-label": "Buying power in dollars" });
    mods.bpClear = h("button", { type: "button", class: "dk-pill", id: "deskBPClear", hidden: true }, "Clear");
    mods.plan = h("div", { class: "dk-plan", id: "deskPlan", hidden: true });
    const sizing = UI.moduleCard({ id: "dkSizingM", title: "Sizing", span: 4, index: 1, info: () => ({ title: "Buying power", lead: T("bp") }), body: h("div", { class: "dk-size" },
      h("label", { class: "dk-bp" }, h("span", { class: "dk-bp-l" }, "Buying power"), h("span", { class: "dk-bp-f" }, h("span", { "aria-hidden": "true" }, "$"), mods.bp, mods.bpClear)),
      h("div", { class: "dk-size-r" }, mods.plan, mods.best = h("div", { class: "dk-best" }))) });
    mods.rankSel = h("select", { id: "deskRank", class: "dk-select", "aria-label": "Rank by" }, RANKS.map(([k, l]) => h("option", { value: k }, l)));
    mods.rankSel.value = rank;
    mods.list = h("div", { class: "dk-list", id: "dkList", role: "list", "aria-label": "Sellable lines" });
    mods.more = h("button", { type: "button", class: "ui-disclose", "aria-expanded": "false", hidden: true, onclick: () => { mods.open = !mods.open; renderList(); } }, h("span"), glyph("chev"));
    const lines = UI.moduleCard({ id: "dkLinesM", title: "Lines", span: 12, index: 2, info: linesInfo, body: [mods.list, mods.more] });
    lines.querySelector(".ui-mod-h").insertBefore(mods.rankSel, lines.querySelector(".ui-mod-h .ui-info"));
    mods.smileSel = h("select", { id: "deskSurfaceSymbol", class: "dk-select", "aria-label": "Smile for symbol" });
    mods.smileSel.addEventListener("change", () => { surfaceSymbol = mods.smileSel.value || null; writeURL(); if (mods.smileChart) mods.smileChart.redraw(true); });
    mods.smile = h("div", { class: "dk-smile", id: "dkSmile" });
    mods.smileCard = UI.moduleCard({ id: "deskSurface", title: "Smile", span: 12, index: 3, info: smileInfo, body: [mods.smile, h("div", { class: "tl-legend" }, UI.legend([["--accent", "", "Richer than the money"], ["--s-orange", "", "Cheaper, hatched"], ["--label-3", "ring", "No at-the-money level"], ["--label-2", "ln", "Not traded today, dashed"]]))] });
    mods.smileCard.querySelector(".ui-mod-h").insertBefore(mods.smileSel, mods.smileCard.querySelector(".ui-mod-h .ui-info"));
    mods.smileCard.hidden = true;
    mods.linesCard = lines;
    grid.append(frontier, sizing, lines, mods.smileCard);
    mods.chart = C.mount(mods.scatter, (host, w, animate) => drawScatterInto(host, w, animate));
    mods.smileChart = C.mount(mods.smile, (host, w) => drawSurfaceInto(host, w));
    wireBP();
    mods.rankSel.addEventListener("change", onRank);
  }

  let view = { rows: [], shown: [] };
  function render() {
    const chosen = selectedSymbols();
    const priceable = chosen.filter((s0) => (book.get(s0) || {}).state === "ok");
    const v = rowsNow();
    view = v;
    ensureModules();
    v.shown = v.rows.filter(inTenor);
    foot.textContent = footText(v, chosen);
    renderPlan(v.rows);
    if (!v.rows.length && priceable.length && v.screened > 0) {
      mods.empty = "Nothing on " + priceable.join(", ") + " clears the liquidity gates right now. " + v.screened + " quoted contracts were screened.";
    } else mods.empty = null;
    renderList();
    drawScatter();
    renderSurface();
    for (const n of [allBox.closest("label"), refreshBtn, clearBtn, mods.linesCard]) if (n) n.hidden = !book.size;
    updateStatus();
  }

  function footText(v, chosen) {
    if (!v.rows.length) return "";
    const dropped = Object.entries(v.gated).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => n + " " + reasonWord(k));
    const cut = chosen.filter((s0) => { const p = (book.get(s0) || {}).payload; return p && p.truncated; });
    const universe = cut.length ? v.priced + " of at least " + v.screened + " quoted contracts are sellable" : v.priced + " of " + v.screened + " quoted contracts are sellable";
    const unc = v.uncounted.length ? " " + v.uncounted.join(", ") + " " + (v.uncounted.length === 1 ? "is" : "are") + " outside those two numbers: " + (v.uncounted.length === 1 ? "that payload" : "those payloads") + " did not say how many contracts were screened or how many are sellable, and a count this page never received is not a count of nought." : "";
    const below = v.slices.reduce((t, c) => t + (c.sell - c.kept), 0);
    const slice = v.slices.length ? " This list is a slice: " + v.slices.map((c) => c.sym + " shows its top " + fmtInt(c.kept) + " of " + fmtInt(c.sell) + " sellable lines, ranked by " + rankWord(c.rankedBy)).join("; ") +
      " — " + fmtInt(below) + (below === 1 ? " line" : " lines") + " below the cut " + (below === 1 ? "is" : "are") + " not on this list, and re-sorting the ones that are cannot bring them back — so changing the ranking refetches " + (v.slices.length === 1 ? "this name" : "these names") + " rather than reordering what is already here." : "";
    return universe + (dropped.length ? ". The rest fail a gate: " + dropped.join(", ") + " — each counted once, under the first gate it failed." : ".") + unc + slice +
      (cut.length ? " " + cut.join(", ") + " " + (cut.length === 1 ? "has" : "have") + " more contracts than this desk fetches, so " + (cut.length === 1 ? "its" : "their") + " ranking is taken over a partial chain." : "");
  }

  function rankWord(k) {
    const r = RANKS.find(([x]) => x === k);
    return k === null || k === undefined ? "an ordering the payload did not name" : r ? r[1].toLowerCase().replace("annualised", "annualised") : String(k);
  }
  function reasonWord(r) {
    return { spread: "too wide", openInterest: "too thin", premium: "paying too little", expiry: "outside the tenor window", strategy: "on the other side", unpriceable: "with no quotable bid" }[r] || r;
  }
  const intrinsicOf = (r) => {
    const S = isNum(r.__spot), k = isNum(r.strike);
    if (S === null || k === null) return 0;
    return Math.max(0, r.strategy === "csp" ? k - S : r.strategy === "cc" ? S - k : 0) * LOT;
  };

  function renderPlan(rows) {
    const plan = mods.plan;
    mods.best.replaceChildren();
    if (buyingPower === null || !rows.length) {
      plan.hidden = true;
      plan.replaceChildren();
      mods.best.append(h("p", { class: "dk-hint" }, buyingPower === null ? "Enter a balance to size every line." : ""));
      return;
    }
    let best = null, affordable = 0;
    for (const r of rows) {
      const z = r.__sizing;
      if (!z || !z.affordable) continue;
      affordable++;
      if (!best || z.collectible > best.__sizing.collectible) best = r;
    }
    plan.hidden = false;
    let sentence;
    if (!best) {
      let cheapest = null;
      for (const r of rows) { const c = isNum(r.collateral); if (c !== null && (cheapest === null || c < cheapest)) cheapest = c; }
      sentence = fmtMoney(buyingPower) + " does not cover a single contract here." + (cheapest === null ? "" : " The cheapest line ties up " + fmtMoney(cheapest) + ".");
      plan.className = "dk-plan is-empty";
      plan.replaceChildren(UI.metrics([UI.metric("Best line", DASH, { state: { state: "quiet", reason: sentence } })]));
    } else {
      const z = best.__sizing;
      const sideWord = best.strategy === "cc" ? "covered call" : "cash-secured put";
      sentence = fmtMoney(buyingPower) + " buying power · " + affordable + " of " + rows.length + " lines affordable · best single deployment: " + z.contracts + "× " +
        (best.ticker || "?") + " " + fmt2(best.strike) + " " + sideWord + " expiring " + (best.expiry || "?") + " collects " + fmtMoney(z.collectible) + ", deploying " +
        fmtMoney(z.deployed) + " and leaving " + fmtMoney(z.idle) + " idle (" + fmtPct(z.yieldOnDeployed, 2) + " on capital committed). Best means the largest gross premium one line collects — not annualised and not risk-adjusted, so it favours the longest tenor" +
        (intrinsicOf(best) > 0 ? " and, here, an in-the-money strike whose premium is partly intrinsic value" : "") + "; the list ranks by " + rankWord(rank) + ".";
      plan.className = "dk-plan";
      plan.replaceChildren(
        h("div", { class: "dk-plan-h" }, h("span", null, "Best deployment"), UI.infoButton("the best deployment", () => ({ title: "Best deployment", lead: sentence }), { small: true })),
        h("div", { class: "dk-plan-v" }, h("b", null, z.contracts + "× " + best.ticker + " " + kf(best.strike) + (best.strategy === "cc" ? " call" : " put")), h("span", null, F.day(best.expiry))),
        UI.metrics([UI.metric("Collects", fmtMoney(z.collectible), { tone: "up" }), UI.metric("Deploys", fmtMoney(z.deployed)), UI.metric("Idle", fmtMoney(z.idle))], { min: 76 }),
        UI.split([{ color: "--accent", value: z.deployed / buyingPower }, { color: "--fill-2", value: z.idle / buyingPower }], "Deploys " + fmtMoney(z.deployed) + " of " + fmtMoney(buyingPower) + ", " + fmtMoney(z.idle) + " idle"),
        h("p", { class: "dk-hint" }, affordable + " of " + rows.length + " lines affordable"));
      const next = rows.filter((r) => r !== best && r.__sizing && r.__sizing.affordable).sort((a, b) => b.__sizing.collectible - a.__sizing.collectible).slice(0, 2);
      if (next.length) {
        mods.best.append(h("div", { class: "dk-alts", role: "list", "aria-label": "Next best deployments" }, h("span", { class: "dk-alts-h" }, "Next best"),
          next.map((r) => h("div", { class: "dk-alt", role: "listitem" },
            h("span", null, r.__sizing.contracts + "× " + r.ticker + " " + kf(r.strike) + (r.strategy === "cc" ? " call" : " put")),
            h("span", { class: "dk-alt-d" }, F.day(r.expiry)), h("b", null, fmtMoney(r.__sizing.collectible))))));
      }
    }
    plan.dataset.plan = sentence;
  }

  function renderList() {
    const rows = view.shown || [];
    const box = mods.list;
    box.replaceChildren();
    if (!rows.length) {
      box.append(UI.silent(mods.empty ? { state: "quiet", reason: mods.empty } : inflight ? { state: "pending", reason: "Pricing…" } : { state: "quiet", reason: view.rows.length ? "No line on the desk expires inside this window." : book.size ? "Select a symbol to price it." : "Add a symbol to price its option sales." }, "Lines", 120));
      mods.more.hidden = true;
      return;
    }
    const limit = mods.open ? rows.length : SHOWN;
    box.classList.toggle("has-col", buyingPower !== null);
    box.append(h("div", { class: "dk-head", "aria-hidden": "true" }, ["", "Line", "Ann.", "Premium", "Implied", "Real world", "EV", buyingPower === null ? null : "Collect", ""].filter((x) => x !== null).map((x) => h("span", null, x))));
    rows.forEach((r, i) => { const n = rowFor(r, i); if (i >= limit) n.hidden = true; box.append(n); });
    mods.more.hidden = rows.length <= SHOWN;
    mods.more.setAttribute("aria-expanded", String(!!mods.open));
    mods.more.firstChild.textContent = mods.open ? "Fewer" : "All " + rows.length;
  }

  function labHref(r) {
    const legs = (r.strategy === "cc" ? r.ticker + "@1," : "") + r.symbol + "@-1";
    return "/flows/strategy/?t=" + encodeURIComponent(r.ticker) + "&s=" + (r.strategy === "cc" ? "covered-call" : "short-put") + "&expiry=" + r.expiry + "&basis=natural&legs=" + encodeURIComponent(legs);
  }

  function rowFor(r, i) {
    const e = r.__eng;
    const m = isNum(r.moneyness);
    const otm = m === null ? null : r.strategy === "csp" ? m < 0 : m > 0;
    const atm = m !== null && Math.abs(m) < 5e-5;
    const away = m === null ? "" : atm ? "at the money" : fmtPct(Math.abs(m), 1) + " " + (otm ? "OTM" : "ITM");
    const earn = r.crossesEarnings === true ? "crosses" : r.crossesEarnings === null ? "unknown" : "clear";
    const z = r.__sizing;
    const cell = (cls, label, text, tone, title) => h("span", { class: "dk-c " + cls, "data-tone": tone || null, title: title || null }, h("small", null, label), text);
    const pq = popQ(r), pp = popP(r), ev = evP(r);
    const collect = buyingPower === null ? null : !z ? cell("dk-col", "Collect", DASH, null, "This line has no quotable collateral or premium to size against.")
      : !z.affordable ? cell("dk-col is-unaffordable", "Collect", "$0", "silent", "One contract ties up " + fmtMoney(r.collateral) + ", which is more than " + fmtMoney(buyingPower) + ". Nothing to collect here.")
        : cell("dk-col", "Collect", fmtMoney(z.collectible) + " (" + z.contracts + "×)", "up", z.contracts + " contract" + (z.contracts === 1 ? "" : "s") + " at " + fmtMoney(r.premium) + " each. Deploys " + fmtMoney(z.deployed) + " of " + fmtMoney(buyingPower) + ", leaving " + fmtMoney(z.idle) + " idle — a return of " + fmtPct(z.yieldOnDeployed, 2) + " on the capital actually committed.");
    const itm = intrinsicOf(r) > 0;
    return h("div", {
      class: "dk-row" + (itm ? " is-itm" : ""), role: "listitem", "data-t": r.ticker, "data-strike": String(r.strike), "data-strategy": r.strategy, "data-expiry": r.expiry,
      "data-earn": earn, "data-stale-iv": r.ivTraded === false ? "" : null, "data-away": away, "data-collateral": "on " + fmtMoney(r.collateral), "data-days": String(r.days), "data-i": String(i),
      onpointerenter: () => focusPoint(r), onpointerleave: () => focusPoint(null),
    },
    h("span", { class: "ui-badge", "data-tone": r.strategy === "cc" ? "up" : "down", "aria-label": r.strategy === "cc" ? "Covered call" : "Cash-secured put" }, r.strategy === "cc" ? "C" : "P"),
    h("span", { class: "dk-main" },
      h("a", { class: "dk-t", href: "/flows/ticker/?t=" + encodeURIComponent(r.ticker), title: "Open " + r.ticker + " on the analysis page. Cards are built only for the names on today's board; if this one is not among them the page says so." }, r.ticker),
      h("a", { class: "dk-k", href: labHref(r), "aria-label": "Open the " + r.ticker + " " + kf(r.strike) + " " + (r.strategy === "cc" ? "covered call" : "cash-secured put") + " expiring " + r.expiry + " in the strategy lab" },
        h("b", null, kf(r.strike)), h("span", null, r.strategy === "cc" ? "call" : "put")),
      earn === "crosses" ? h("span", { class: "dk-earn", role: "img", "aria-label": "Expires after the next earnings report: the cushion on this line is a diffusion number priced against a jump.", title: "Expires after the next earnings report. The cushion on this line is a diffusion number priced against a jump." }, glyph("cal")) : null,
      earn === "unknown" ? h("span", { class: "dk-earn is-unknown", role: "img", "aria-label": "Whether this contract outlives the next earnings report could not be determined. Treat the cushion with that in mind.", title: "Whether this contract outlives the next earnings report could not be determined." }, glyph("pending")) : null,
      h("span", { class: "dk-meta" }, F.day(r.expiry) + " · " + r.days + "d" + (away ? " · " + away : ""))),
    h("span", { class: "dk-cells" },
      cell("dk-ann", "Ann.", fmtPct(r.annualized, 0), itm ? "silent" : null),
      h("span", { class: "dk-c dk-prem" }, h("small", null, "Premium"), fmtMoney(r.premium), h("em", { class: "dk-sub" }, "on " + fmtMoney(r.collateral))),
      cell("dk-pq", "Implied", pq === null ? DASH : fmtPct(pq, 0)),
      cell("dk-pp", "Real world", pp === null ? DASH : fmtPct(pp, 0)),
      cell("dk-ev", "EV", ev === null ? DASH : usd(ev), ev === null ? "silent" : ev > 0 ? "up" : ev < 0 ? "down" : null),
      collect),
    UI.infoButton(r.ticker + " " + kf(r.strike) + " " + (r.strategy === "cc" ? "call" : "put"), () => rowInfo(r), { small: true }));
  }

  function rowInfo(r) {
    const e = r.__eng;
    const m = isNum(r.moneyness), S = isNum(r.__spot);
    const otm = m === null ? null : r.strategy === "csp" ? m < 0 : m > 0;
    const called = r.strategy === "cc" ? fmtPct(r.assignedReturn, 1) : DASH;
    const oi = isNum(r.oi), ch = isNum(r.oiChange);
    const intr = intrinsicOf(r);
    return {
      title: r.ticker + " " + kf(r.strike) + " " + (r.strategy === "cc" ? "covered call" : "cash-secured put"), asOf: F.day(r.expiry) + " · " + r.days + "d",
      lead: T("engine"),
      facts: [
        ["Premium", fmtMoney(r.premium) + " at the " + fmt2(r.bid) + " bid"],
        ["Yield", fmtPct(r.yieldOnCollateral, 2) + " on " + fmtMoney(r.collateral) + (r.strategy === "cc" ? " of shares you already own" : " of cash reserved")],
        ["Annualised", fmtPct(r.annualized, 0) + " — a convention"],
        ["Distance", m === null ? DASH : Math.abs(m) < 5e-5 ? "at the money" : fmtPct(Math.abs(m), 1) + " " + (m < 0 ? "below" : "above") + " spot" + (S === null ? "" : " of " + fmt2(S)) + ", " + (otm ? "out of" : "in") + " the money"],
        ["Cushion", fmtSd(r.cushionSigmas) + (r.ivTraded === false ? " · this contract has not traded today, so its implied volatility is the last transaction's, of unknown age" : "")],
        ["Breakeven", fmt2(r.breakeven)],
        ["If called", r.strategy === "cc" ? called + (isNum(r.capSigmas) !== null ? " · the market has to run " + fmtSd(r.capSigmas) + " to get there" : "") : DASH + " · a cash-secured put has no upside cap; its best case is keeping the premium"],
        ["Spread", fmtPct(r.spread, 1) + " of the mid"],
        ["Open interest", oi === null ? DASH : fmtInt(oi) + (ch ? " (" + sg(ch) + fmtInt(Math.abs(ch)) + ")" : "")],
        ["Earnings", r.crossesEarnings === true ? "Expires after the next report" : r.crossesEarnings === null ? "Not determined" : "No report before expiry"],
        ["Chance of profit", e ? fmtPct(e.prob.popQ, 1) + " implied · " + (e.prob.popP === null ? DASH : fmtPct(e.prob.popP, 1)) + " real world" : DASH],
        ["Expected value", e ? usd(e.ev.q) + " implied · " + (e.ev.p === null ? DASH : usd(e.ev.p)) + " real world" : DASH],
        ["Delta", e ? fmt2(shortDelta(r)) : DASH],
        ["Capital", e ? fmtMoney(e.capital.value) + " · " + e.capital.kind : DASH],
        ["Grade", e ? e.grade + " of 3" + (e.gradeWhy.length ? " · " + e.gradeWhy.join(", ") : "") : DASH],
      ],
      notes: [intr > 0 ? "Includes " + fmtMoney(intr) + " of intrinsic value, which assignment returns rather than keeps; the time value is " + fmtMoney(Math.max(0, (isNum(r.premium) || 0) - intr)) + "." : null,
        e ? null : r.__why || null, e && e.prob.popP === null && r.__law ? "No real-world figure: " + r.__law + "." : null, T("annualized"), T("cushion")],
    };
  }

  let focused = null;
  function focusPoint(r) { focused = r; drawScatter(true); }
  function drawScatter(quick) { if (mods.chart) { mods.quick = !!quick; mods.chart.redraw(false); } }

  function frontierOf(pts) {
    const sorted = pts.slice().sort((a, b) => a.x - b.x || b.y - a.y);
    const out = [];
    let best = -Infinity;
    if (axis === 0) { for (const p of sorted) if (p.y > best + 1e-12) { out.push(p); best = p.y; } }
    else { for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].y > best + 1e-12) { out.unshift(sorted[i]); best = sorted[i].y; } }
    return out;
  }

  function drawScatterInto(host, w, animate) {
    const rows = (view.shown || []).filter((r) => r.__eng);
    const phone = w < 600;
    const H = phone ? 240 : 300;
    mods.legend.replaceChildren();
    if (!rows.length) { host.append(UI.silent(inflight ? { state: "pending", reason: "Pricing the desk…" } : { state: "quiet", reason: view.rows.length ? "No line on the desk expires inside this window." : book.size ? "Select a symbol to see its lines." : "Add a symbol to see its option sales on the frontier." }, "Frontier", book.size ? H : 180)); return; }
    const xOf = axis === 0 ? shortDelta : popQ;
    const pts = rows.map((r) => ({ r, x: xOf(r), y: isNum(r.annualized) })).filter((p) => p.x !== null && p.y !== null);
    if (!pts.length) { host.append(UI.silent({ state: "withheld", reason: "No line carries both a risk reading and a yield." }, "Frontier", H)); return; }
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    const p95 = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.95))];
    const cap = Math.max(0.05, Math.min(ys[ys.length - 1], p95 * 3) * 1.04);
    const left = 44, right = 16, top = 14, bottom = 26;
    const x0 = axis === 0 ? 0 : Math.max(0, Math.min(...pts.map((p) => p.x)) - 0.03), x1 = axis === 0 ? Math.max(0.1, Math.max(...pts.map((p) => p.x)) * 1.08) : 1;
    const x = C.lin(x0, x1, left, w - right), yl = C.lin(0, Math.sqrt(cap), H - bottom, top);
    const y = (v) => yl(Math.sqrt(Math.max(0, v)));
    const box = h("div", { class: "tl-scrub" });
    host.append(box);
    const svg = C.svgRoot(box, w, H, animate && !mods.quick, "Annualised yield against " + (axis === 0 ? "delta" : "the implied chance of profit") + " for " + pts.length + " lines");
    s("line", { x1: left, x2: w - right, y1: H - bottom, y2: H - bottom, class: "base" }, svg);
    let lastY = Infinity;
    for (const t of [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16]) {
      if (t > cap || lastY - y(t) < 22) continue;
      lastY = y(t);
      s("line", { x1: left, x2: w - right, y1: y(t), y2: y(t), class: "hair" }, svg);
      s("text", { x: left - 8, y: y(t) + 4, text: Math.round(t * 100) + "%", "text-anchor": "end" }, svg);
    }
    for (const t of C.niceTicks(x0, x1, phone ? 4 : 6)) {
      if (x(t) < left + 8 || x(t) > w - right - 8) continue;
      s("text", { x: x(t), y: H - 7, text: axis === 0 ? t.toFixed(2).replace(/^0/, "") : Math.round(t * 100) + "%", "text-anchor": "middle" }, svg);
    }
    s("text", { x: w - right, y: H - bottom - 6, text: axis === 0 ? "Delta" : "Chance", "text-anchor": "end", class: "tx-3" }, svg);
    const fr = frontierOf(pts);
    const frSet = new Set(fr);
    if (fr.length > 1) {
      const P = fr.map((p) => [x(p.x), y(Math.min(p.y, cap))]);
      s("path", { d: C.pathOf(P), class: "ln dk-front" + (animate && !mods.quick ? " draw" : ""), pathLength: 1 }, svg);
    }
    const syms = [...new Set(pts.map((p) => p.r.__sym))];
    const g = s("g", { class: animate && !mods.quick ? "fade" : null }, svg);
    for (const p of pts) {
      const over = p.y > cap;
      const cx = x(p.x), cy = y(over ? cap : p.y);
      const col = UI.cssVar(colorOf(p.r.__sym));
      const on = focused === p.r;
      const mk = over ? "tri" : p.r.strategy === "cc" ? "dia" : "dot";
      const n = C.marker(g, mk, cx, cy, col, on ? 5.5 : frSet.has(p) ? 4.2 : 3.2);
      n.setAttribute("fill-opacity", frSet.has(p) || on ? "1" : "0.55");
      if (frSet.has(p)) C.marker(g, "ring", cx, cy, UI.cssVar("--label-1"), 7);
    }
    const readout = h("div", { class: "ui-readout", "aria-hidden": "true" });
    box.append(readout);
    box.tabIndex = 0;
    box.setAttribute("role", "group");
    box.setAttribute("aria-roledescription", "chart");
    box.setAttribute("aria-label", "Frontier. Use the arrow keys to step along the frontier.");
    const show = (p, speak) => {
      if (!p) { readout.classList.remove("is-on"); return; }
      const r = p.r;
      readout.replaceChildren(C.part(r.ticker + " " + kf(r.strike) + (r.strategy === "cc" ? " call" : " put"), null), C.part(F.day(r.expiry), "k"),
        h("b", null, fmtPct(r.annualized, 0)), C.part(axis === 0 ? "Δ " + fmt2(p.x) : fmtPct(p.x, 0), "k"),
        popP(r) === null ? null : C.part("Real " + fmtPct(popP(r), 0), "k"));
      readout.classList.add("is-on");
      const rw = readout.offsetWidth;
      readout.style.left = Math.max(0, Math.min(w - rw, x(p.x) - rw / 2)) + "px";
      readout.style.top = Math.max(0, y(Math.min(p.y, cap)) - 40) + "px";
      if (speak) UI.announce(r.ticker + " " + kf(r.strike) + ", " + fmtPct(r.annualized, 0) + " annualised");
    };
    let idx = -1;
    box.addEventListener("pointermove", (ev) => {
      const b = svg.getBoundingClientRect();
      const mx = ev.clientX - b.left, my = ev.clientY - b.top;
      let best = null, bd = 900;
      for (const p of pts) { const d = (x(p.x) - mx) ** 2 + (y(Math.min(p.y, cap)) - my) ** 2; if (d < bd) { bd = d; best = p; } }
      show(best);
    });
    box.addEventListener("pointerleave", () => show(null));
    box.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      idx = Math.max(0, Math.min(fr.length - 1, idx + (ev.key === "ArrowRight" ? 1 : -1)));
      show(fr[idx], true);
    });
    if (focused) { const p = pts.find((q) => q.r === focused); if (p) show(p); }
    mods.legend.replaceChildren(UI.legend([...syms.map((sym) => [colorOf(sym), "dot", sym]), ["--label-2", "dot", "Put"], ["--label-2", "dia", "Call"], ["--label-1", "ln", "Frontier"]]));
    mods.quick = false;
  }

  const fmtVol = (v) => { const n = isNum(v); return n === null ? DASH : (n * 100).toFixed(1); };
  const fmtSkew = (v) => { const n = isNum(v); return n === null ? DASH : sg(n) + Math.abs(n * 100).toFixed(1); };
  const fmtM = (v) => { const n = isNum(v); if (n === null) return DASH; if (Math.abs(n) < 5e-5) return "0.0%"; return sg(n) + Math.abs(n * 100).toFixed(1) + "%"; };
  let smileNumbers = true;

  function surfaceCandidates() {
    return selectedSymbols().filter((sym) => { const e = book.get(sym); return e && e.state === "ok" && e.payload && e.payload.ivSurface; });
  }

  function renderSurface() {
    const card = mods.smileCard;
    const list0 = surfaceCandidates();
    if (!list0.length) { card.hidden = true; mods.smile.replaceChildren(); return; }
    if (surfaceSymbol === null || !list0.includes(surfaceSymbol)) surfaceSymbol = list0[0];
    mods.smileSel.replaceChildren(...list0.map((sym) => h("option", { value: sym }, sym)));
    mods.smileSel.value = surfaceSymbol;
    mods.smileSel.disabled = list0.length < 2;
    const was = card.hidden;
    card.hidden = false;
    if (mods.smileChart) mods.smileChart.redraw(was);
  }

  function earningsByExpiry(p) {
    const out = new Map();
    for (const r of (p && p.rows) || []) {
      if (!r || !r.expiry) continue;
      const prior = out.get(r.expiry);
      if (r.crossesEarnings === true) out.set(r.expiry, true);
      else if (prior === undefined) out.set(r.expiry, r.crossesEarnings === false ? false : null);
      else if (prior === false && r.crossesEarnings === null) out.set(r.expiry, null);
    }
    return out;
  }

  function drawSurfaceInto(host, w) {
    const e0 = book.get(surfaceSymbol);
    const p = e0 && e0.payload;
    const sf = p && p.ivSurface;
    if (!sf) return;
    if (sf.status !== "ok") { host.append(UI.silent({ state: "unavailable", reason: "No smile for " + surfaceSymbol + ": " + (sf.reason || "not available") + "." }, "Smile", 160)); return; }
    const cols = sf.expiries, rows = sf.rows;
    const labelW = 52, padR = 8, padT = 32, gapTerm = 18, termH = 46;
    const plotW = Math.max(60, w - labelW - padR);
    const colW = plotW / cols.length;
    const rowH = Math.max(11, Math.min(22, 300 / rows.length));
    const gridH = rows.length * rowH;
    const termT = padT + gridH + gapTerm;
    const H = Math.round(termT + termH);
    smileNumbers = colW >= 30 && rowH >= 12;
    const svg = C.svgRoot(host, w, H, false, surfaceAria(sf, p));
    svg.classList.add("ivs");
    const pat = s("pattern", { id: "ivsNeg", width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)", class: "ivs-negpat" }, s("defs", null, svg));
    s("line", { x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: "currentColor", "stroke-width": 1.6 }, pat);
    const earn = earningsByExpiry(p);
    const cap = isNum(sf.skewCap);
    cols.forEach((e, j) => {
      const x = labelW + j * colW + colW / 2;
      const crosses = earn.has(e.expiry) ? earn.get(e.expiry) : undefined;
      const g = s("g", { class: "ivs-colhead" }, svg);
      s("title", { text: e.expiry + (e.days === null ? "" : ", " + e.days + " days") + ". " + (crosses === true ? "Contracts on this expiry outlive the next earnings report — the level here is priced against a jump, not a diffusion." : crosses === false ? "No earnings report falls before this expiry." : "Whether this expiry outlives the next earnings report is not determined: no contract on it survived the sale gates, so nothing on this column was dated.") }, g);
      s("text", { class: "ivs-exp" + (crosses === true ? " crosses-earnings" : ""), x, y: padT - 18, "text-anchor": "middle", text: String(e.expiry).slice(5) + (crosses === true ? " ⚠" : "") }, g);
      s("text", { class: "ivs-days", x, y: padT - 6, "text-anchor": "middle", text: e.days === null ? DASH : e.days + "d" }, g);
    });
    rows.forEach((r, i) => {
      const y = padT + i * rowH;
      cols.forEach((e, j) => {
        const x = labelW + j * colW;
        const cw = Math.max(1, colW - 2), ch = Math.max(1, rowH - 2);
        const cell = sf.grid[i][j];
        if (!cell) { s("rect", { class: "ivs-void", x, y, width: cw, height: ch, rx: 3 }, svg); return; }
        const skew = isNum(cell.skew);
        const mag = skew !== null && cap !== null && cap > 0 ? Math.min(1, Math.abs(skew) / cap) : 0;
        const neg = skew !== null && skew < 0;
        const g = s("g", { class: "ivs-cellgroup" }, svg);
        s("title", { text: cellTitle(cell, e, sf) }, g);
        s("rect", {
          class: "ivs-cell " + (skew === null ? "is-nolevel" : neg ? "is-neg" : "is-pos") + (cell.traded === false ? " is-stale" : cell.traded === null ? " is-unknown-age" : ""),
          x, y, width: cw, height: ch, rx: 3,
          fill: skew === null ? "none" : "currentColor",
          "fill-opacity": skew === null ? 0 : (0.16 + 0.64 * mag).toFixed(3),
          stroke: cell.traded === true && skew !== null ? "none" : "currentColor",
          "stroke-width": cell.traded === true && skew !== null ? 0 : 1,
          "stroke-dasharray": cell.traded === false ? "3 2" : cell.traded === null ? "1 2" : null,
          "data-expiry": cell.expiry, "data-strike": cell.strike, "data-iv": cell.iv, "data-skew": skew === null ? "" : skew,
          "data-traded": cell.traded === null ? "unknown" : String(cell.traded), "data-crowd": cell.crowd,
        }, g);
        if (neg && rowH >= 9 && colW >= 9) s("rect", { class: "ivs-hatch", x, y, width: cw, height: ch, rx: 3, fill: "url(#ivsNeg)" }, g);
        if (skew !== null && cap !== null && Math.abs(skew) > cap) {
          const sl = Math.min(6, Math.max(3, ch / 3));
          s("line", { class: "ivs-clip", x1: x + cw - 2 - sl, y1: y + 2 + sl, x2: x + cw - 2, y2: y + 2 }, g);
        }
        if (smileNumbers) s("text", { class: "ivs-iv" + (cell.traded === true ? "" : " is-stale"), x: x + cw / 2, y: y + ch / 2 + 3.5, "text-anchor": "middle", text: fmtVol(cell.iv) }, g);
      });
    });
    const must = new Set([0, rows.length - 1]);
    const atmRow = rows.findIndex((r) => r.k === 0);
    if (atmRow >= 0) must.add(atmRow);
    const stride = Math.max(1, Math.ceil(14 / rowH));
    rows.forEach((r, i) => {
      if (!must.has(i) && i % stride !== 0) return;
      if (!must.has(i) && [...must].some((m) => Math.abs(m - i) * rowH < 13)) return;
      s("text", { class: "ivs-m" + (r.k === 0 ? " is-atm" : ""), x: labelW - 8, y: padT + i * rowH + rowH / 2 + 3, "text-anchor": "end", text: r.k === 0 ? "ATM" : fmtM(r.m) }, svg);
    });
    const levels = cols.map((e) => isNum(e.atmIv));
    const present = levels.filter((v) => v !== null);
    const lo = present.length ? Math.min(...present) : 0, hi = present.length ? Math.max(...present) : 1;
    const bandH = 22;
    const yOf = (v) => (hi - lo > 1e-9 ? termT + bandH - ((v - lo) / (hi - lo)) * bandH : termT + bandH / 2);
    s("line", { class: "ivs-termrule", x1: labelW, x2: labelW + plotW, y1: termT + bandH + 5, y2: termT + bandH + 5 }, svg);
    s("text", { class: "ivs-m is-atm", x: labelW - 8, y: termT + bandH / 2 + 3, "text-anchor": "end", text: "ATM" }, svg);
    cols.forEach((e, j) => {
      const x = labelW + j * colW + colW / 2;
      const v = levels[j];
      const g = s("g", { class: "ivs-levelgroup" }, svg);
      s("title", { text: v === null ? e.expiry + " has no at-the-money level: " + (e.atmReason || "not measurable") + "." : e.expiry + " at the money: " + fmtVol(v) + "% implied, from the " + e.atmStrike + " " + (e.atmType === "P" ? "put" : "call") + " — " + fmtM(e.atmM) + " from spot and traded today." }, g);
      s("text", { class: "ivs-level" + (v === null ? " is-missing" : ""), x, y: termT + bandH + 19, "text-anchor": "middle", text: v === null ? DASH : fmtVol(v) }, g);
      if (v === null) return;
      s("circle", { class: "ivs-dot", cx: x, cy: yOf(v), r: 3 }, svg);
      const prev = levels[j - 1];
      if (j > 0 && prev !== null) s("line", { class: "ivs-termline", x1: labelW + (j - 1) * colW + colW / 2, y1: yOf(prev), x2: x, y2: yOf(v) }, svg);
    });
  }

  function cellTitle(cell, e, sf) {
    const parts = [cell.strike + " " + (cell.type === "P" ? "put" : "call") + " " + cell.expiry + " · " + fmtM(cell.m) + " from the money · " + fmtVol(cell.iv) + "% implied"];
    parts.push(isNum(cell.skew) !== null ? fmtSkew(cell.skew) + " vol points against this expiry's at-the-money " + fmtVol(e.atmIv) + "%" : "No skew: " + (e.atmReason || "this expiry has no at-the-money level"));
    if (cell.traded === false) parts.push("This contract has NOT traded today, so its implied volatility is the last transaction's — of unknown age. It is drawn but it did not set this expiry's level.");
    else if (cell.traded === null) parts.push("The vendor reported no volume for this contract, so the age of its implied volatility is unknown. It did not set this expiry's level.");
    else parts.push("Traded " + fmtInt(cell.volume) + " today" + (cell.oi === null ? "" : ", open interest " + fmtInt(cell.oi)) + ".");
    if (cell.crowd > 1) parts.push(cell.crowd + " contracts fall in this row of this column; the one shown is the print this surface prefers — today's first, then nearest the row's centre. The cell is never an average of quotes.");
    if (isNum(cell.skew) !== null && isNum(sf.skewCap) !== null && Math.abs(cell.skew) > sf.skewCap) parts.push("Past the shade cap of " + fmtSkew(sf.skewCap) + " vol points, so the shade understates it. Marked with a slash.");
    return parts.join(". ").replace(/\.\./g, ".");
  }

  function surfaceAria(sf, p) {
    const levels = sf.expiries.map((e) => String(e.expiry).slice(5) + " " + (isNum(e.atmIv) === null ? "no level" : fmtVol(e.atmIv) + " percent"));
    return "Implied volatility surface for " + (p && p.ticker ? p.ticker : surfaceSymbol) + ": " + sf.expiriesShown + " expiries by " + sf.rowsShown +
      " moneyness bands. At-the-money implied volatility by expiry — " + levels.join(", ") + ". Shade is each contract's implied volatility against its own expiry's at-the-money quote.";
  }

  function surfaceNotes(sf, p) {
    const bits = [];
    bits.push("Rows are log-moneyness, ln(strike ÷ spot), in bands " + (sf.step * 100).toFixed(1) + "% wide; columns are expiries, nearest first.");
    bits.push((smileNumbers ? "The number in a cell is the contract's own quoted implied volatility. " : "The columns are too narrow at this width to print a volatility inside each cell, so every cell carries its own in a tooltip instead. ") +
      "The shade is that volatility against its own expiry's at-the-money quote — hatched below it, plain above — so the smile is readable without the term structure swamping it. The strip beneath the grid, read left to right, is the term structure.");
    bits.push("At the money: " + sf.expiries.map((e) => String(e.expiry).slice(5) + " " + (isNum(e.atmIv) === null ? DASH : fmtVol(e.atmIv) + "%")).join(", ") + ".");
    const noLevel = sf.expiries.filter((e) => isNum(e.atmIv) === null);
    if (noLevel.length) bits.push(noLevel.map((e) => String(e.expiry).slice(5) + " has no level — " + e.atmReason).join("; ") + ". Those columns carry their quoted volatilities and no shade, and the term-structure line does not bridge them.");
    const aged = [];
    if (sf.stale > 0) aged.push(sf.stale + " did not");
    if (sf.unknownAge > 0) aged.push(sf.unknownAge + " carr" + (sf.unknownAge === 1 ? "ies" : "y") + " no volume at all");
    bits.push("This vendor's implied volatility is the LAST TRANSACTION's, not a quote. " + sf.fresh + " of " + sf.placed + " cells traded today" +
      (aged.length === 0 ? " — every cell on this surface is a print from today." : "; " + aged.join(" and ") + ", so their volatility is of unknown age. Those cells are drawn with a broken border and NONE of them set an expiry's level — a stale cell is one marked number, but a stale level would tilt a whole column's smile with no marker on any cell it moved."));
    if (sf.crowded > 0) bits.push(sf.crowded === 1 ? "One contract shares a row with another; the cell shows one quoted contract and is never an average of two." : sf.crowded + " contracts share a row with another; each cell shows one quoted contract and is never an average of two.");
    if (sf.clipped > 0) bits.push("The shade is capped at " + fmtSkew(sf.skewCap) + " vol points; " + sf.clipped + " cell" + (sf.clipped === 1 ? " runs" : "s run") + " past it and " + (sf.clipped === 1 ? "is" : "are") + " marked with a slash.");
    const win = [];
    if (sf.expiriesShown < sf.expiriesTotal) win.push(sf.expiriesShown + " of " + sf.expiriesTotal + " expiries");
    if (sf.rowsShown < sf.rowsTotal) win.push(sf.rowsShown + " of " + sf.rowsTotal + " moneyness bands");
    if (win.length) bits.push("Showing " + win.join(" and ") + ".");
    bits.push("Built from every contract with a two-sided quote, before the liquidity gates that decide the lines above and regardless of the Sell toggle — those gates fall hardest on the wings, and a smile with its tails cut off is a different smile" +
      (p && p.truncated ? ". This chain is larger than the desk fetches, so the surface is taken over a partial chain." : "."));
    if (sf.ivBasis) bits.push("Volatility units resolved once for the whole chain: " + sf.ivBasis + ".");
    bits.push("Quoted volatilities, and differences between quoted volatilities on the same expiry. Nothing here is fitted, interpolated or repriced.");
    return bits;
  }

  function smileInfo() {
    const e0 = book.get(surfaceSymbol);
    const p = e0 && e0.payload;
    const sf = p && p.ivSurface;
    if (!sf || sf.status !== "ok") return { title: "Smile", lead: T("smile") };
    return { title: "Smile · " + surfaceSymbol, lead: T("smile"), sections: [{ title: "Reading it", lines: surfaceNotes(sf, p) }] };
  }

  function frontierInfo() {
    return { title: "Frontier", lead: T("frontier"), sections: [{ title: "Axes", lines: [T("frontier-x")] }, { title: "Engine", lines: [T("engine")] }], notes: [T("refuse")] };
  }
  function linesInfo() {
    return { title: "Lines", lead: T("premium"), sections: [{ title: "What is on this list", lines: [foot.textContent] }, { title: "Engine", lines: [T("engine")] }], notes: [T("annualized"), T("refuse")] };
  }

  function updateStatus() {
    statusOwned = true;
    statusEl.classList.add("visually-hidden");
    if (inflight > 0) { statusEl.textContent = "Pricing " + inflight + " symbol" + (inflight === 1 ? "" : "s") + "…"; return; }
    if (!book.size) { statusEl.textContent = "Add a symbol to begin."; return; }
    const chosen = selectedSymbols();
    if (!chosen.length) { statusEl.textContent = "Select a symbol to price it."; return; }
    const failed = chosen.filter((s0) => (book.get(s0) || {}).state === "error");
    let oldest = null, unaged = 0;
    for (const sym of chosen) {
      const e = book.get(sym);
      if (!e || e.state !== "ok" || !e.payload) continue;
      const a = ageOf(e.payload);
      if (a === null) { unaged++; continue; }
      if (oldest === null || a > oldest) oldest = a;
    }
    const age = oldest === null ? "" : " · quotes " + fmtAge(oldest);
    const unagedNote = unaged ? " · " + (unaged === 1 ? "one symbol's quote age was not stated by the route" : unaged + " symbols' quote ages were not stated by the route") : "";
    const staleQuotes = oldest !== null && oldest > QUOTE_STALE_SECONDS ? "Quotes are older than this desk will call a price, so treat the list as a record of the market rather than one you can trade; Refresh requotes it." : "";
    const sessions = new Set(), stale = [], earnBits = [];
    for (const sym of chosen) {
      const p = (book.get(sym) || {}).payload;
      if (!p) continue;
      if (p.marketTime) sessions.add(String(p.marketTime));
      if (p.spotSource === "daily-close") stale.push(sym);
      const e = p.earnings;
      const crossing = (p.rows || []).filter((r) => r.crossesEarnings === true).length;
      if (!e || !e.date) {
        const etf = e && /etf|index|fund/i.test(String(e.issueType || ""));
        earnBits.push(sym + (etf ? " has no earnings (" + e.issueType + ")" : " has no known earnings date"));
      } else earnBits.push(sym + " reports " + String(e.date).slice(5) + " — " + (crossing ? crossing + " of " + (p.rows || []).length + " lines expire after it" : "no line expires after it"));
    }
    const session = sessions.size === 1 ? " · " + [...sessions][0] + " session" : "";
    const staleNote = stale.length ? " · " + stale.join(", ") + " priced off the last close, not a live print" : "";
    const lines = [(failed.length ? chosen.length - failed.length + " of " + chosen.length + " symbols priced · " + failed.join(", ") + " unavailable" : chosen.length + " symbol" + (chosen.length === 1 ? "" : "s") + " priced") + session + age + unagedNote + staleNote, staleQuotes, earnBits.join(" · ")];
    statusEl.replaceChildren(...lines.filter(Boolean).map((t) => h("span", { class: "flows-status-l" }, t)));
    statusEl.classList.toggle("visually-hidden", !(failed.length || staleQuotes || stale.length));
  }

  function tickAges() {
    let any = false;
    for (const e of book.values()) {
      if (e.state !== "ok" || !e.payload) continue;
      any = true;
      if (e.__note) e.__note.textContent = noteFor(e);
    }
    if (any && statusOwned) updateStatus();
  }
  setInterval(tickAges, AGE_TICK_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tickAges(); });

  function add(syms) {
    const fresh = [];
    for (const s0 of syms) {
      if (book.has(s0)) continue;
      if (book.size >= MAX_SYMBOLS) break;
      book.set(s0, { selected: true, state: "idle", payload: null, error: null });
      fresh.push(s0);
    }
    writeURL();
    renderChips();
    render();
    if (fresh.length) runPool(fresh, {});
    return fresh;
  }

  entry.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const wanted = normalise(String(input.value || "").split(/[,\s]+/));
    if (!wanted.length) { say("That is not a symbol this desk can price."); return; }
    const need = wanted.filter((w) => !book.has(w));
    const added = add(wanted);
    input.value = "";
    if (!need.length) say(wanted.length === 1 ? wanted[0] + " is already on the desk." : "Already on the desk.");
    else if (added.length < need.length) {
      const dropped = need.filter((w) => !book.has(w));
      say("The desk holds " + MAX_SYMBOLS + " symbols; each one is a live lookup. " + (dropped.length ? "Not added: " + dropped.join(", ") + ". " : "") + "Remove one to add another.");
    }
  });

  allBox.addEventListener("change", () => {
    const on = allBox.checked;
    for (const e of book.values()) e.selected = on;
    allBox.indeterminate = false;
    renderChips();
    render();
    const missing = selectedSymbols().filter((s0) => (book.get(s0) || {}).state === "idle");
    if (missing.length) runPool(missing, {});
  });

  refreshBtn.addEventListener("click", () => {
    const chosen = selectedSymbols();
    if (!chosen.length) { say("Select a symbol to refresh."); return; }
    runPool(chosen, { refresh: true });
  });

  clearBtn.addEventListener("click", () => {
    book.clear();
    writeURL();
    renderChips();
    render();
  });

  function applyBuyingPower(raw) {
    const next = parseBuyingPower(raw);
    const changed = next !== buyingPower;
    buyingPower = next;
    const bp = mods.bp;
    if (mods.bpClear) mods.bpClear.hidden = !String(raw || "").trim();
    if (bp) {
      const dirty = String(raw || "").trim().length > 0;
      bp.classList.toggle("is-invalid", dirty && next === null);
      bp.setAttribute("aria-invalid", dirty && next === null ? "true" : "false");
    }
    if (buyingPower === null && rank === "collectible") { rank = "annualized"; if (mods.rankSel) mods.rankSel.value = rank; }
    if (changed) { writeURL(); render(); }
  }

  function wireBP() {
    const bp = mods.bp;
    if (buyingPower !== null) bp.value = formatBuyingPower(buyingPower);
    bp.addEventListener("input", () => applyBuyingPower(bp.value));
    bp.addEventListener("change", () => { if (buyingPower !== null) bp.value = formatBuyingPower(buyingPower); applyBuyingPower(bp.value); });
    bp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); bp.blur(); } });
    mods.bpClear.addEventListener("click", () => { bp.value = ""; applyBuyingPower(""); bp.focus(); });
    applyBuyingPower(bp.value);
  }

  function setSide(next) {
    if (next === side) return;
    side = next;
    writeURL();
    for (const e of book.values()) { e.state = "idle"; e.payload = null; }
    renderChips();
    const chosen = selectedSymbols();
    if (chosen.length) runPool(chosen, {}); else render();
  }

  const RANK_REFETCH_MS = 250;
  const rankDebounceMs = () => { const v = Number(window.__flowsRankDebounceMs); return Number.isFinite(v) && v >= 0 ? v : RANK_REFETCH_MS; };
  let rankTimer = null;
  function onRank() {
    const sel = mods.rankSel;
    if (sel.value === "collectible" && buyingPower === null) {
      sel.value = rank;
      say("Enter a buying power to rank by premium collectible.");
      mods.bp.focus();
      mods.bp.select();
      return;
    }
    rank = sel.value;
    writeURL();
    const want = serverRank(rank);
    const recut = selectedSymbols().filter((sym) => {
      const p = (book.get(sym) || {}).payload;
      if (!p) return false;
      const sell = isNum(p.priced);
      if (sell === null || (p.rows || []).length >= sell) return false;
      return p.rankedBy !== want;
    });
    render();
    if (rankTimer !== null) { clearTimeout(rankTimer); rankTimer = null; }
    if (!recut.length) return;
    const wait = rankDebounceMs();
    if (wait === 0) { runPool(recut, {}); return; }
    rankTimer = setTimeout(() => { rankTimer = null; runPool(recut, {}); }, wait);
  }

  const initial = readURL();
  ensureModules();
  renderChips();
  render();
  if (initial.length) add(initial);
})();
