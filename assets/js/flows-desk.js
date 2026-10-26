(() => {
  "use strict";

  const MAX_BUYING_POWER = 1e11;
  const LOT = 100;
  const TENORS = [["All", 0, 1e9], ["≤ 2w", 0, 14], ["2–6w", 15, 42], ["> 6w", 43, 1e9]];
  const TENOR_KEYS = ["all", "2w", "6w", "long"];

  const isNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const BP_RE = /^\$?\s*(?:(\d{1,3}(?:,\d{3})+)|(\d{1,3}(?: \d{3})+)|(\d{1,3}(?:_\d{3})+)|(\d+))?(?:\.(\d+))?\s*([kmb])?$/i;
  const BP_POWER = { k: 3, m: 6, b: 9 };

  function parseBuyingPower(raw) {
    const text = String(raw === null || raw === undefined ? "" : raw).replace(/[\u00a0\u2009\u202f]/g, " ").trim();
    const m = BP_RE.exec(text);
    if (!m) return null;
    const whole = (m[1] || m[2] || m[3] || m[4] || "").replace(/[, _]/g, ""), frac = m[5] || "";
    if (!whole && !frac) return null;
    const shift = (m[6] ? BP_POWER[m[6].toLowerCase()] : 0) + 2 - frac.length;
    if (shift < 0) return null;
    const digits = (whole + frac + "0".repeat(shift)).replace(/^0+/, "");
    if (!digits || digits.length > 14) return null;
    const cents = Number(digits);
    return cents > 0 && cents <= MAX_BUYING_POWER * 100 ? cents / 100 : null;
  }

  const roundCents = (dollars) => Math.round(dollars * 100 + 1e-9 + Math.abs(dollars) * 1e-13);

  function premiumLine(row) {
    const none = (why, premiumC = null) => ({ ok: false, why, premiumC, collateralC: null, ratio: null });
    const bid = isNum(row && row.bid);
    if (bid === null || !(bid > 0)) return none("no-bid");
    const premiumC = roundCents(bid * LOT);
    if (!(premiumC > 0)) return none("no-bid");
    const collateral = isNum(row.collateral);
    if (collateral === null || !(collateral > 0)) return none(row.strategy === "csp" ? "no-strike" : "no-spot", premiumC);
    const collateralC = roundCents(collateral);
    if (!(collateralC > 0)) return none("no-collateral", premiumC);
    return { ok: true, why: null, premiumC, collateralC, ratio: premiumC / collateralC };
  }

  function ratioText(p, c) {
    if (!Number.isSafeInteger(p) || !Number.isSafeInteger(c) || !(p > 0) || !(c > 0) || !Number.isSafeInteger(2 * p * 10000 + c)) return null;
    const hundredths = Math.floor((2 * p * 10000 + c) / (2 * c));
    if (hundredths === 0) return "<0.01%";
    if (hundredths < 1000) return (hundredths / 100).toFixed(2) + "%";
    const tenths = Math.floor((2 * p * 1000 + c) / (2 * c));
    return (tenths / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  }

  function centsText(c, always) {
    if (!Number.isSafeInteger(c) || c < 0) return null;
    const whole = Math.floor(c / 100), rem = c % 100;
    return "$" + whole.toLocaleString("en-US") + (rem === 0 && !always ? "" : "." + String(rem).padStart(2, "0"));
  }

  function ratioFraction(p, c) {
    if (!Number.isSafeInteger(p) || !Number.isSafeInteger(c) || !(p > 0) || !(c > 0)) return null;
    if (!Number.isSafeInteger(2 * p * 1e6 + c)) return null;
    const micro = Math.floor((2 * p * 1e6 + c) / (2 * c));
    if (micro > 0) return micro / 1e6;
    if (!Number.isSafeInteger(2 * p * 1e10 + c)) return null;
    const fine = Math.floor((2 * p * 1e10 + c) / (2 * c));
    return fine > 0 ? fine / 1e10 : null;
  }

  function sizeRow(row, bp) {
    const collateral = isNum(row && row.collateral), premium = isNum(row && row.premium), extrinsic = isNum(row && row.extrinsic);
    if (bp === null || !(bp > 0) || collateral === null || !(collateral > 0) || premium === null || !(premium > 0)) return null;
    const collateralC = roundCents(collateral), premiumC = roundCents(premium);
    if (!(collateralC > 0)) return null;
    const timeC = extrinsic === null ? null : Math.max(0, Math.min(premiumC, Math.round(extrinsic * 1e4)));
    const bpC = Math.round(bp * 100), contracts = Math.floor(bpC / collateralC);
    const deployedC = contracts * collateralC, grossC = contracts * premiumC, timeValueC = timeC === null ? null : contracts * timeC;
    return {
      contracts, affordable: contracts > 0, collectible: grossC / 100, timeValue: timeValueC === null ? null : timeValueC / 100, intrinsicValue: timeValueC === null ? null : (grossC - timeValueC) / 100,
      deployed: deployedC / 100, idle: (bpC - deployedC) / 100, yieldOnDeployed: deployedC > 0 && timeValueC !== null ? timeValueC / deployedC : null, timeValueC, deployedC,
    };
  }

  function betterDeployment(a, b) {
    if (a.timeValueC !== b.timeValueC) return a.timeValueC > b.timeValueC;
    return a.deployedC < b.deployedC;
  }

  function netDelta(e) {
    if (!e || !Array.isArray(e.legs) || !e.legs.length) return null;
    let d = 0;
    for (const l of e.legs) {
      const x = isNum(l.delta);
      if (x === null) return null;
      d += l.side * (l.qty || 1) * x;
    }
    return d;
  }

  function frontierOf(pts, chance) {
    const dir = chance ? -1 : 1;
    const out = [];
    let best = -Infinity;
    for (const p of pts.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y)).sort((a, b) => dir * (a.x - b.x) || b.y - a.y)) if (p.y > best + 1e-12) { out.push(p); best = p.y; }
    return chance ? out.reverse() : out;
  }

  if (typeof document === "undefined") {
    globalThis.__FlowsDeskTest = Object.freeze({ TENORS, parseBuyingPower, sizeRow, betterDeployment, netDelta, frontierOf, roundCents, premiumLine, ratioText, centsText, ratioFraction });
    return;
  }

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
  const T = (k, o) => { const n = document.querySelector('#dkCopy [data-k="' + k + '"]'); const t = n ? n.textContent.replace(/\s+/g, " ").trim() : ""; return o ? t.replace(/\{(\w+)\}/g, (m, x) => (x in o ? o[x] : m)) : t; };

  const MAX_SYMBOLS = 20;
  const CONCURRENCY = 3;
  const AGE_TICK_MS = 30000;
  const QUOTE_STALE_SECONDS = 300;
  const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
  const SIDES = ["csp", "cc", "both", "sc"];
  const SERVER_SIDE = { csp: "csp", cc: "cc", both: "both", sc: "sc" };
  const RANKS = [["annualized", "Annualised yield"], ["premiumRatio", "Premium ÷ collateral, in-the-money value included"], ["premium", "Premium received"], ["yieldOnCollateral", "Time value ÷ collateral"], ["cushionSigmas", "Cushion"], ["collectible", "Time value collectible"], ["edge", "EV model vol"]];
  const SC_RANKS = [["annualized", "Annualised ratio"], ["premiumRatio", "Premium ÷ collateral, in-the-money value included"], ["ratio", "Time value ÷ collateral"], ["premium", "Premium received"], ["cushionSigmas", "Cushion"], ["collectible", "Time value collectible"], ["edge", "EV model vol"]];
  const ranksFor = () => (side === "sc" ? SC_RANKS : RANKS);
  const calls = () => (side === "sc" ? window.FlowsUI.deskCalls || null : null);
  const SERIES = ["--s-blue", "--s-orange", "--s-purple", "--s-teal", "--s-yellow"];
  const WIN_Q = "Win % (implied)", WIN_P = "Win % (model vol)", EV_P = "EV (model vol)";

  const book = new Map();
  let inflight = 0;
  let statusOwned = true;
  let buyingPower = null, bpBad = false;
  let side = "both", rank = "annualized", tenor = 0, axis = 0, surfaceSymbol = null;
  const say = (text) => { statusEl.textContent = text; statusEl.classList.remove("visually-hidden"); statusOwned = false; };

  const fmt2 = (v) => { const n = isNum(v); return n === null ? DASH : n.toFixed(2); };
  const minusOf = (n, magnitude) => (n < 0 && Number(magnitude) !== 0 ? MINUS : "");
  const fmtMoney = (v) => { const n = isNum(v); if (n === null) return DASH; const a = Math.round(Math.abs(n)); return minusOf(n, a) + "$" + a.toLocaleString("en-US"); };
  const fmtPct = (v, d = 1) => { const n = isNum(v); if (n === null) return DASH; const a = (Math.abs(n) * 100).toFixed(d); return minusOf(n, a) + a + "%"; };
  const fmtSd = (v) => { const n = isNum(v); if (n === null) return DASH; const a = Math.abs(n).toFixed(2); return minusOf(n, a) + a + " SD"; };
  const fmtInt = (v) => { const n = isNum(v); return n === null ? DASH : Math.round(n).toLocaleString("en-US"); };
  const kf = (K) => String(+(+K).toFixed(2));
  const sg = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
  const usd = (v) => (isNum(v) === null ? DASH : sg(Math.round(v)) + "$" + Math.abs(Math.round(v)).toLocaleString("en-US"));
  const fmtAge = (sec) => { const n = isNum(sec); if (n === null) return ""; if (n < 45) return "just now"; if (n < 5400) return Math.round(n / 60) + "m ago"; return Math.round(n / 3600) + "h ago"; };
  const ageOf = (p) => { if (!p) return null; const b = isNum(p.__age); if (b === null) return null; const at = isNum(p.__at); return at === null ? b : b + Math.max(0, (Date.now() - at) / 1000); };

  const formatBuyingPower = (v) => (isNum(v) === null ? "" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));

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
      if (r && ranksFor().some(([k]) => k === r)) rank = r;
      const tk = TENOR_KEYS.indexOf(q.get("tenor"));
      if (tk >= 0) tenor = tk;
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
      if (tenor !== 0) url.searchParams.set("tenor", TENOR_KEYS[tenor]); else url.searchParams.delete("tenor");
      if (buyingPower !== null) url.searchParams.set("bp", String(buyingPower)); else url.searchParams.delete("bp");
      if (surfaceSymbol !== null && book.has(surfaceSymbol)) url.searchParams.set("surface", surfaceSymbol); else url.searchParams.delete("surface");
      history.replaceState(null, "", url);
    } catch { return; }
  }

  const basisOf = (p) => (p && p.basis && typeof p.basis === "object" ? p.basis : null);
  const mismatched = (p) => { const b = basisOf(p); return !!b && b.status === "mismatch"; };
  const spotOf = (p) => { const b = basisOf(p); return b && b.status !== "mismatch" && isNum(b.spot) !== null ? Number(b.spot) : p.spot; };

  function noteFor(e) {
    if (!e) return "";
    if (e.state === "loading") return "loading…";
    if (e.state === "error") return e.error || "failed";
    const p = e.payload;
    if (!p) return "";
    const parts = [];
    if (isNum(spotOf(p)) !== null) parts.push("$" + fmt2(spotOf(p)) + (p.spotSource === "daily-close" ? " close" : "") + (basisOf(p) && basisOf(p).status === "rebased" ? " rebased" : ""));
    const shown = (p.rows || []).length, priced = isNum(p.priced);
    parts.push(mismatched(p) ? "quotes disagree with the price" : (priced !== null && shown < priced ? fmtInt(shown) + " of " + fmtInt(priced) : fmtInt(priced)) + " sellable" + (p.truncated ? " of a partial chain" : ""));
    const sec = ageOf(p);
    parts.push(sec === null ? "age not stated" : fmtAge(sec));
    if (e.kept !== null && e.kept !== undefined) parts.push("kept copy");
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
      e.state === "ok" && p ? h("span", { class: "dk-chip-px" }, fmt2(spotOf(p))) : null,
      e.state === "loading" ? h("span", { class: "dk-chip-px" }, glyph("pending")) : null,
      e.state === "error" ? h("span", { class: "dk-chip-px" }, glyph("unavailable")) : null,
      e.state === "ok" && p ? glyph(live ? "live" : "closed", "dk-src") : null, note);
      const x = h("button", { type: "button", class: "dk-chip-x", "aria-label": "Remove " + sym, onclick: () => { book.delete(sym); writeURL(); renderChips(); render(); } }, glyph("x"));
      return h("span", { class: "desk-chip is-" + e.state, "data-t": sym }, toggle, x);
    }));
    syncAll();
    edge();
  }

  const chipWrap = list.parentElement;
  function edge() {
    const max = list.scrollWidth - list.clientWidth;
    chipWrap.classList.toggle("is-l", list.scrollLeft > 2);
    chipWrap.classList.toggle("is-r", list.scrollLeft < max - 2);
  }
  list.addEventListener("scroll", edge, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(edge).observe(list);

  function syncAll() {
    allBox.disabled = !book.size;
    if (!book.size) { allBox.checked = false; allBox.indeterminate = false; return; }
    let on = 0;
    for (const e of book.values()) if (e.selected) on++;
    allBox.checked = on === book.size;
    allBox.indeterminate = on > 0 && on < book.size;
  }

  const serverRank = (k) => (k === "collectible" || k === "edge" || k === "ratio" ? "yieldOnCollateral" : k);

  const invalidate = (entries) => { for (const e of entries) e.seq = (e.seq || 0) + 1; };

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
    const params = new URLSearchParams({ t: sym, strategy: SERVER_SIDE[side], rank: serverRank(rank) });
    const terms = side === "sc" ? shortCallTerms() : null;
    if (terms) { params.set("h", String(terms.h)); params.set("f", String(terms.f)); }
    if (refresh) params.set("refresh", "1");
    const current = () => book.get(sym) === e && e.seq === seq;
    try {
      const res = await fetch("/api/flows/chain?" + params.toString(), { credentials: "same-origin", deadlineMs: 45000, headers: { Accept: "application/json" } });
      if (res.status === 401) { location.replace("/flows/"); return; }
      const age = isNum(res.headers.get("X-Chain-Age"));
      const kept = res.headers.get("X-Fresh-State") === "stale" ? String(res.headers.get("X-Fresh-Reason") || "") : null;
      const body = await res.json().catch(() => null);
      if (!current()) return;
      if (!res.ok) { e.state = "error"; e.error = messageFor(res.status, body); e.payload = null; e.kept = null; }
      else if (!body || typeof body !== "object") { e.state = "error"; e.error = "unreadable response"; e.payload = null; e.kept = null; }
      else {
        e.state = "ok";
        e.kept = kept;
        e.payload = body;
        body.__age = age === null ? undefined : age;
        body.__at = age === null ? undefined : Date.now();
        price(sym, body);
        if (body.sessionDate || body.asOf) UI.freshness({ sessionDate: body.sessionDate || body.asOf, generatedAt: body.generatedAt, source: "desk " + sym });
      }
    } catch {
      if (!current()) return;
      e.state = "error"; e.error = "network error"; e.payload = null; e.kept = null;
    }
    renderChips();
    render();
  }

  function quoteMs(p) {
    const tape = p.tapeTime ? Date.parse(String(p.tapeTime).replace(" ", "T")) : NaN;
    if (Number.isFinite(tape)) return tape;
    const read = Date.parse(p.generatedAt), day = String(p.sessionDate || p.asOf || "");
    const close = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Q.closeUtcMs(day) : null;
    if (!Number.isFinite(close)) return read || Date.now();
    return Number.isFinite(read) ? Math.min(close, read) : close;
  }

  const bandOf = (r, fit, fwd, S) => {
    const c = fit.slice.contract;
    const type = r.type === "P" ? "P" : "C";
    const held = c.via === "own" ? type : type === "C" ? "P" : "C";
    const known = fit.forward.carry === "card";
    const se = fwd && isNum(fwd.se) !== null ? fwd.se : Q.carryOf({ S, r: fit.forward.r, T: fit.T, q: known ? fit.forward.q : null }).se;
    return { ...Q.deltaBand({ F: fit.forward.F, se, K: r.strike, sigma: c.iv, T: fit.T, held, veto: !!(fwd && fwd.veto), capPm: !!(fwd && fwd.cap), exercise: type === "C" && !!(fwd && isNum(fwd.exK) !== null && r.strike <= fwd.exK) }), se };
  };

  function structOf(r) {
    return r.strategy === "cc"
      ? { family: "covered-call", legs: [{ type: "S", side: 1, qty: 1 }, { type: "C", K: r.strike, side: -1, qty: 1 }] }
      : { family: "short-put", legs: [{ type: "P", K: r.strike, side: -1, qty: 1 }] };
  }

  function priceStruct(r, fit, struct) {
    const c = r.__ctx;
    const setup = Q.labSetup({ asOfMs: c.asOfMs, spot: c.spot, facts: c.facts, state: c.eng ? c.eng.state : null, pLaw: c.eng ? c.eng.pLaw : null, event: c.eng ? c.eng.event : null, stale: c.eng ? c.eng.stale : false, crossesEarnings: r.crossesEarnings, books: [{ fit, rows: [c.row] }], lawCache: c.laws });
    return { setup, eng: Q.priceStructure(setup, { family: struct.family, fam: struct.fam, expiry: r.expiry, legs: struct.legs, basis: "natural" }) };
  }

  function winHalf(r, struct) {
    const c = r.__ctx;
    if (!c || !r.__band || r.__band.band !== "pm") return null;
    const base = r.__winBase;
    if (!Number.isFinite(base)) return null;
    const fwd = c.input.fwd || {};
    const se = r.__band.se;
    let worst = 0;
    for (const sign of [-1, 1]) {
      const F = c.F0 + sign * 1.96 * se;
      const bumped = { ...fwd, F, src: "parity", n: fwd.n || 0 };
      const fit = Q.contractFit({ ...c.input, fwd: bumped });
      const got = fit ? priceStruct(r, fit, struct || r.__winStruct || structOf(r)) : null;
      const pop = got && got.eng ? got.eng.prob.popQ : null;
      if (pop === null) return null;
      worst = Math.max(worst, Math.abs(pop - base));
    }
    return Math.ceil(worst * 100 - 1e-9) / 100;
  }

  function price(sym, p) {
    const eng = p.engine && p.engine.status === "ok" ? p.engine : null;
    const rate = eng && eng.rate ? eng.rate : null;
    const spot = spotOf(p), laws = new Map();
    const forwards = new Map((Array.isArray(p.fwd) ? p.fwd : []).map((f) => [f.expiry, f]));
    const legacy = new Map((Array.isArray(p.forwards) ? p.forwards : []).map((f) => [f.expiry, f]));
    const cut = p.cut && typeof p.cut === "object" ? p.cut : null;
    const asOfMs = Q ? (cut && isNum(cut.asOf) !== null ? cut.asOf : quoteMs(p)) : null;
    const chainDay = /^\d{4}-\d{2}-\d{2}$/.test(String(p.sessionDate || p.asOf || "")) ? String(p.sessionDate || p.asOf) : null;
    for (const r of p.rows || []) {
      r.__day = chainDay;
      r.__fwd = forwards.get(r.expiry) || null;
      r.__fwdLegacy = legacy.get(r.expiry) || null;
      r.__eng = r.__fit = r.__code = r.__setup = r.__band = r.__ctx = null;
      r.__lazy = !!cut;
      r.__nk = undefined;
      if (!Q) { r.__why = T("why-q"); continue; }
      const type = r.type === "P" ? "P" : "C";
      const row = { K: r.strike, type, bid: isNum(r.bid), ask: isNum(r.ask), oi: isNum(r.oi), volume: isNum(r.volume), sym: r.symbol, ivSeed: cut ? null : isNum(r.iv), opposite: r.opposite };
      const input = { expiry: r.expiry, asOfMs, spot, rate: rate ? rate.r : null, rateMethod: rate ? rate.method : null, facts: eng ? eng.facts : [], expiries: eng ? eng.expiries : null, row, fwd: r.__fwd };
      try {
        const fit = Q.contractFit(input);
        if (!fit) { const d = Q.contractDiagnosis(input); r.__why = d.text || T("why-fit"); r.__code = d.code; continue; }
        r.__fit = fit.slice;
        r.__band = bandOf(r, fit, r.__fwd, spot);
        r.__ctx = { input, row, spot, eng, laws, asOfMs, facts: eng ? eng.facts : [], F0: fit.forward.F };
        r.__fitFull = fit;
        if (cut) { r.__law = eng && eng.pLaw ? null : eng ? T("law-none") : T("law-card", { sym }); continue; }
        const got = priceStruct(r, fit, structOf(r));
        r.__setup = got.setup;
        r.__eng = got.eng;
        if (!r.__eng) r.__why = T("why-eng");
        else r.__winBase = r.__eng.prob.popQ;
      } catch { r.__eng = null; r.__why = T("why-eng"); }
      r.__law = eng && eng.pLaw ? null : eng ? T("law-none") : T("law-card", { sym });
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

  const shortLeg = (r) => (r.__eng ? r.__eng.legs.find((l) => l.type !== "S") : null);
  const shortDelta = (r) => { const leg = shortLeg(r); return leg && isNum(leg.delta) !== null ? Math.abs(leg.delta) : null; };
  const dashed = (r) => !!(r.__band && r.__band.band === "dash");
  const netOf = (r) => (dashed(r) ? null : netDelta(r.__eng));
  const popQ = (r) => (r.__eng && !dashed(r) ? r.__eng.prob.popQ : null);
  const popP = (r) => (r.__eng && !dashed(r) ? r.__eng.prob.popP : null);
  const evP = (r) => (r.__eng ? r.__eng.ev.p : null);

  const bandNote = (r) => {
    const b = r.__band;
    if (!b || b.band === "plain") return null;
    if (b.band === "dash") {
      if (b.reason === "exercise") return T("band-exercise", { d: r.__fwd && r.__fwd.exDate ? r.__fwd.exDate : DASH });
      if (b.reason === "veto") return T("band-veto");
      const fit = r.__fitFull, f = r.__fwd;
      const x = f && fit && isNum(f.se) !== null ? "±" + fmtPct(1.96 * f.se / fit.forward.F, 2) : DASH;
      return T("band-dash", { x });
    }
    const w = winHalfOf(r);
    return T("band-pm", { d: fmt2(b.half), w: w === null ? DASH : fmtPct(w, 0) }) + (b.reason === "capped" ? " " + T("band-cap") : "");
  };

  const winHalfOf = (r, struct) => {
    if (r.__wh === undefined) r.__wh = winHalf(r, struct);
    return r.__wh;
  };

  const winText = (r, pq, struct) => {
    if (pq === null) return { text: DASH, title: dashed(r) ? bandNote(r) : null };
    const b = r.__band;
    if (b && b.band === "pm") {
      const half = winHalfOf(r, struct);
      return { text: fmtPct(pq, 0) + " ± " + fmtPct(half === null ? b.half : half, 0), title: bandNote(r) };
    }
    return { text: fmtPct(pq, 0), title: null };
  };

  function rowsNow() {
    const rows = [];
    let screened = 0, priced = 0;
    const gated = Object.create(null), slices = [], uncounted = [];
    for (const sym of selectedSymbols()) {
      const e = book.get(sym);
      if (!e || e.state !== "ok" || !e.payload) continue;
      const p = e.payload;
      if (mismatched(p)) continue;
      const kept = (p.rows || []).length, sc = isNum(p.screened), sell = isNum(p.priced);
      if (sc === null || sell === null) uncounted.push(sym);
      else {
        screened += sc; priced += sell;
        for (const [k, n] of Object.entries(p.gated || {})) gated[k] = (gated[k] || 0) + (isNum(n) || 0);
      }
      if (sell !== null && kept < sell && !p.cut) slices.push({ sym, kept, sell, rankedBy: p.rankedBy || null });
      for (const r of p.rows || []) if (side !== "sc" || r.type === "C") rows.push(Object.assign(r, { __spot: spotOf(p), __sym: sym }));
    }
    for (const r of rows) { r.__sizing = sizeRow(r, buyingPower); r.__pc = premiumLine(r); }
    const dc = calls();
    if (dc) dc.annotate(rows, buyingPower);
    const key = dc ? dc.key(rank) : rank === "collectible" ? (r) => (r.__sizing ? r.__sizing.timeValue : null) : rank === "edge" ? evP : rank === "premiumRatio" ? (r) => r.__pc.ratio : (r) => r[rank];
    const tie = (a, b) => (Q ? Q.lineCompare({ key: 0, oi: isNum(a.oi), strike: a.strike, expiry: a.expiry, symbol: a.symbol }, { key: 0, oi: isNum(b.oi), strike: b.strike, expiry: b.expiry, symbol: b.symbol }) : 0);
    rows.sort((a, b) => {
      const x = isNum(key(a)), y = isNum(key(b));
      if (x === null && y === null) return tie(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x || tie(a, b);
    });
    return { rows, screened, priced, gated, slices, uncounted };
  }

  const inTenor = (r) => { const t = TENORS[tenor]; return r.days >= t[1] && r.days <= t[2]; };

  const mods = {};
  const TAB_KEYS = ["frontier", "lines", "smile", "plan"];
  const tabs = Object.fromEntries(TAB_KEYS.map((k) => [k, $("dkT-" + k)]));
  const panels = Object.fromEntries(TAB_KEYS.map((k) => [k, $("dkP-" + k)]));
  const NARROW = window.matchMedia("(max-width: 899.98px)");
  let curTab = "frontier";

  const tabAllowed = (k) => (k === "smile" ? !!mods.smileCard && !mods.smileCard.hidden : k === "plan" ? NARROW.matches : k === "lines" ? book.size > 0 : true);

  function showTab(key, focus, quiet) {
    const k = tabAllowed(key) ? key : "frontier";
    curTab = k;
    grid.dataset.view = k;
    for (const x of TAB_KEYS) {
      const on = x === k;
      tabs[x].hidden = !tabAllowed(x);
      tabs[x].setAttribute("aria-selected", String(on));
      tabs[x].tabIndex = on ? 0 : -1;
      panels[x].inert = !on;
    }
    if (focus) tabs[k].focus();
    if (!quiet) { try { const url = new URL(location.href); url.hash = "view=" + k; history.replaceState(null, "", url); } catch { return; } }
  }

  const viewFromHash = () => { const m = /view=([a-z]+)/.exec(location.hash); return m && TAB_KEYS.includes(m[1]) ? m[1] : "frontier"; };

  const PHONE = window.matchMedia("(max-width: 639.98px)");
  const filterDlg = $("dkFilterDlg"), filterBtn = $("dkFilterBtn"), filterSlot = $("dkFilterSlot");
  function placeFilters() {
    const to = PHONE.matches && filterSlot ? filterSlot : filters;
    if (mods.sideSeg) to.prepend(mods.sideSeg, mods.tenorSeg);
    if (mods.terms) to.append(mods.terms);
  }
  PHONE.addEventListener("change", placeFilters);
  if (filterBtn && filterDlg) {
    filterBtn.addEventListener("click", () => filterDlg.showModal());
    $("dkFilterDone").addEventListener("click", () => filterDlg.close());
    filterDlg.addEventListener("close", () => filterBtn.focus());
  }

  function placeSizing() {
    if (mods.sizing) (NARROW.matches ? panels.plan : panels.frontier).append(mods.sizing);
  }

  TAB_KEYS.forEach((k, i) => {
    tabs[k].addEventListener("click", () => showTab(k, false));
    tabs[k].addEventListener("keydown", (ev) => {
      const open = TAB_KEYS.filter((x) => tabAllowed(x));
      const at = open.indexOf(k);
      const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: open.length - 1 }[ev.key];
      if (to === undefined) return;
      ev.preventDefault();
      showTab(open[(to + open.length) % open.length], true);
    });
  });
  NARROW.addEventListener("change", () => { placeSizing(); showTab(curTab, false, true); drawScatter(); });
  addEventListener("hashchange", () => showTab(viewFromHash(), false, true));
  if (window.ResizeObserver) {
    let last = 0;
    new ResizeObserver(() => { const hh = grid.clientHeight; if (hh !== last) { last = hh; if (mods.chart) drawScatter(true); if (mods.linesCard) fitLines(); } }).observe(grid);
  }

  function ensureModules() {
    if (mods.scatter) return;
    mods.sideSeg = UI.segmented("Sell", [{ label: "Puts" }, { label: "Calls" }, { label: "Both" }, { label: "Short calls" }], (i) => setSide(SIDES[i]), SIDES.indexOf(side));
    mods.sideSeg.id = "deskStrategy";
    mods.tenorSeg = UI.segmented("Days to expiry", TENORS.map(([l]) => ({ label: l })), (i) => { tenor = i; writeURL(); render(); }, tenor);
    mods.tenorSeg.id = "dkTenor";
    placeFilters();
    mods.axisSeg = UI.segmented("Risk axis", [{ label: "Net delta" }, { label: WIN_Q }], (i) => { axis = i; drawScatter(); }, axis);
    mods.scatter = h("div", { class: "dk-scatter", id: "dkScatter" });
    mods.legend = h("div", { class: "tl-legend" });
    mods.scLoad = h("div", { id: "dkScLoad", class: "dk-scload" });
    const frontier = UI.moduleCard({ id: "dkFrontierM", title: "Frontier", span: 8, index: 0, seg: mods.axisSeg, info: frontierInfo, body: [mods.scLoad, mods.scatter, mods.legend] });
    mods.bp = h("input", { id: "deskBP", name: "bp", type: "text", inputmode: "numeric", autocomplete: "off", spellcheck: "false", placeholder: "25,000", "aria-label": "Buying power in dollars" });
    mods.bpClear = h("button", { type: "button", class: "dk-pill", id: "deskBPClear", hidden: true }, "Clear");
    mods.plan = h("div", { class: "dk-plan", id: "deskPlan", hidden: true });
    const sizing = UI.moduleCard({ id: "dkSizingM", title: "Sizing", span: 4, index: 1, info: () => ({ title: "Buying power", lead: T("bp") }), body: h("div", { class: "dk-size" },
      h("label", { class: "dk-bp" }, h("span", { class: "dk-bp-l" }, "Buying power"), h("span", { class: "dk-bp-f" }, h("span", { "aria-hidden": "true" }, "$"), mods.bp, mods.bpClear)),
      h("div", { class: "dk-size-r" }, mods.plan, mods.best = h("div", { class: "dk-best" }))) });
    mods.rankSel = h("select", { id: "deskRank", class: "dk-select", "aria-label": "Rank by" });
    syncRanks();
    mods.list = h("div", { class: "dk-list", id: "dkList", role: "list", "aria-label": "Sellable lines" });
    mods.more = h("button", { type: "button", class: "dk-pill dk-all-btn", id: "dkShowAll", hidden: true, "aria-haspopup": "dialog", onclick: openAll });
    const lines = UI.moduleCard({ id: "dkLinesM", title: "Lines", span: 12, index: 2, info: linesInfo, body: [mods.list] });
    lines.querySelector(".ui-mod-h").insertBefore(h("span", { class: "dk-rank" }, UI.calibTag(), mods.rankSel, mods.more), lines.querySelector(".ui-mod-h .ui-info"));
    if (UI.exportMenu) lines.querySelector(".ui-mod-h").insertBefore(UI.exportMenu({ name: "flows-desk-frontier", csv: exportSpec, svg: () => mods.scatter.querySelector("svg") }), lines.querySelector(".ui-mod-h .ui-info"));
    mods.smileSel = h("select", { id: "deskSurfaceSymbol", class: "dk-select", "aria-label": "Smile for symbol" });
    mods.smileSel.addEventListener("change", () => { surfaceSymbol = mods.smileSel.value || null; writeURL(); if (mods.smileChart) mods.smileChart.redraw(true); });
    mods.smile = h("div", { class: "dk-smile", id: "dkSmile" });
    mods.smileCard = UI.moduleCard({ id: "deskSurface", title: "Smile", span: 12, index: 3, info: smileInfo, body: [mods.smile, h("div", { class: "tl-legend" }, UI.legend([["--g-long", "", "Above ATM"], ["--g-short", "", "Below ATM, hatched"], ["--label-3", "ring", "No ATM level"], ["--label-2", "ln", "Untraded, dashed"]]))] });
    mods.smileCard.querySelector(".ui-mod-h").insertBefore(mods.smileSel, mods.smileCard.querySelector(".ui-mod-h .ui-info"));
    mods.smileCard.hidden = true;
    mods.linesCard = lines;
    mods.sizing = sizing;
    panels.frontier.append(frontier);
    panels.lines.append(lines);
    panels.smile.append(mods.smileCard);
    placeSizing();
    mods.chart = C.mount(mods.scatter, (host, w, animate) => drawScatterInto(host, w, animate));
    mods.smileChart = C.mount(mods.smile, (host, w) => drawSurfaceInto(host, w));
    wireBP();
    mods.rankSel.addEventListener("change", onRank);
  }

  function syncRanks() {
    const sel = mods.rankSel;
    if (!sel) return;
    if (!ranksFor().some(([k]) => k === rank)) rank = "annualized";
    sel.replaceChildren(...ranksFor().map(([k, l]) => h("option", { value: k }, l)));
    sel.value = rank;
  }

  let callsAsked = false;
  function loadCalls() {
    if (callsAsked || !UI.defer) return;
    callsAsked = true;
    UI.defer("desk-calls", { when: "idle", el: mods.scLoad, label: "The short-call view" });
  }

  const EXPORT_COLS = [
    { label: "Ticker", get: (r) => r.ticker },
    { label: "Structure", get: (r) => (r.strategy === "cc" ? "covered call" : "cash-secured put") },
    { label: "Expiry", get: (r) => r.expiry },
    { label: "Chain session", get: (r) => r.__day },
    { label: "Days to expiry", get: (r) => isNum(r.days) },
    { label: "Strike", unit: "USD", get: (r) => isNum(r.strike) },
    { label: "Premium ÷ collateral", unit: "fraction", get: (r) => { const pc = r.__pc || premiumLine(r); return pc.ok ? ratioFraction(pc.premiumC, pc.collateralC) : null; } },
    { label: "Annualised yield", unit: "fraction", get: (r) => isNum(r.annualized) },
    { label: "Collateral", unit: "USD", get: (r) => isNum(r.collateral) },
    { label: "Win probability (implied)", unit: "fraction", get: popQ },
    { label: "Win probability (model vol)", unit: "fraction", get: popP },
    { label: "Expected value, model vol", unit: "USD", get: evP },
  ];
  const exportSpec = () => {
    const dc = calls();
    if (dc) return dc.exportSpec(view);
    const rows = view.shown || [];
    const days = [...new Set(rows.map((r) => r.__day).filter(Boolean))];
    return { name: "flows-desk-lines", source: "anilkaya.org Flows desk, own model outputs", asOf: days.length === 1 ? days[0] : null, rows, cols: EXPORT_COLS };
  };

  let view = { rows: [], shown: [] };
  function render() {
    const chosen = selectedSymbols();
    const priceable = chosen.filter((s0) => (book.get(s0) || {}).state === "ok");
    const v = rowsNow();
    view = v;
    ensureModules();
    v.shown = v.rows.filter(inTenor);
    foot.textContent = footText(v, chosen);
    if (window.FlowsUI.deskCalls) window.FlowsUI.deskCalls.sync(side);
    renderPlan(v.shown);
    const off = basisLines(priceable.filter((s0) => mismatched(book.get(s0).payload)), true);
    if (!v.rows.length && off.length) mods.empty = off.join(" ");
    else if (!v.rows.length && priceable.length && v.screened > 0) {
      mods.empty = T("e-gate", { who: priceable.join(", "), n: v.screened });
    } else mods.empty = null;
    renderList();
    drawScatter();
    renderSurface();
    for (const n of [allBox.closest("label"), refreshBtn, clearBtn, mods.linesCard]) if (n) n.hidden = !book.size;
    if (tabs.lines.hidden !== !tabAllowed("lines")) showTab(viewFromHash(), false, true);
    updateStatus();
  }

  function footText(v, chosen) {
    if (!v.rows.length) return "";
    const dropped = Object.entries(v.gated).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => n + " " + reasonWord(k));
    const cut = chosen.filter((s0) => { const p = (book.get(s0) || {}).payload; return p && p.truncated && !p.cut; });
    const one = (n, a, b) => (n === 1 ? a : b);
    const below = v.slices.reduce((t, c) => t + (c.sell - c.kept), 0);
    return T("f-uni", { p: v.priced, s: v.screened, least: cut.length ? "at least " : "" }) + (dropped.length ? ". " + T("f-gate", { list: dropped.join(", ") }) : ".") +
      (v.uncounted.length ? " " + T("f-unc", { who: v.uncounted.join(", "), is: one(v.uncounted.length, "is", "are"), that: one(v.uncounted.length, "that payload", "those payloads") }) : "") +
      (v.slices.length ? " " + T("f-slice", { parts: v.slices.map((c) => T("f-part", { sym: c.sym, kept: fmtInt(c.kept), sell: fmtInt(c.sell), by: rankWord(c.rankedBy) })).join("; "), n: fmtInt(below), lines: one(below, "line", "lines"), is: one(below, "is", "are"), names: one(v.slices.length, "this name", "these names") }) : "") +
      (side === "sc" ? cutNotes(chosen) : "") +
      (cut.length ? " " + T("f-cut", { who: cut.join(", "), has: one(cut.length, "has", "have"), its: one(cut.length, "its", "their") }) : "");
  }

  function cutParts(chosen) {
    const out = [];
    for (const sym of chosen) {
      const p = (book.get(sym) || {}).payload;
      const cut = p && p.cut;
      if (!cut) continue;
      const shed = Array.isArray(cut.shed) ? cut.shed : [];
      const has = (why) => shed.some((x) => x.why === why);
      const n = fmtInt(cut.nRaw);
      const kind = has("budget") ? "budget" : cut.truncated ? "partial" : "ranked";
      const v = cut.vendor || null;
      const where = kind === "partial" && v ? " " + T("sc-cut-" + (v.unseen || "unknown"), { x: v.partial || DASH, s: v.aboveStrike === undefined ? DASH : String(v.aboveStrike) }) : "";
      const filter = v && v.honoured === false ? " " + T("sc-cut-filter") : "";
      const text = (kind === "budget" ? T("sc-cut-budget", { n }) : kind === "partial" ? T("sc-cut-partial", { n }) : T("sc-cut", { n: fmtInt(cut.nIn), m: fmtInt(cut.nOut), k: cut.k })) + where + filter;
      out.push({ sym, kind, text, nIn: cut.nIn, nOut: cut.nOut });
    }
    return out;
  }

  function cutNotes(chosen) {
    const parts = cutParts(chosen);
    return parts.length ? " " + parts.map((x) => (chosen.length > 1 ? x.sym + ": " : "") + x.text).join(" ") : "";
  }

  function cutBrief(chosen) {
    const parts = cutParts(chosen);
    const ranked = parts.filter((x) => x.kind === "ranked");
    const out = [];
    if (ranked.length) out.push(T("sc-cut-brief", { n: fmtInt(ranked.reduce((t, x) => t + x.nIn, 0)), m: fmtInt(ranked.reduce((t, x) => t + x.nOut, 0)) }));
    for (const x of parts) if (x.kind !== "ranked") out.push((chosen.length > 1 ? x.sym + ": " : "") + x.text);
    return out;
  }

  function rankWord(k) {
    const r = RANKS.find(([x]) => x === k);
    return k === null || k === undefined ? "an ordering the payload did not name" : r ? r[1].toLowerCase() : String(k);
  }
  function reasonWord(r) {
    return { spread: "too wide", openInterest: "too thin", premium: "paying too little", expiry: "outside the tenor window", strategy: "on the other side", unpriceable: "with no quotable bid", offMarket: "with an ask below intrinsic value", nonStandard: "on a non-standard contract" }[r] || r;
  }
  const isItm = (r) => { const m = isNum(r.moneyness); return m !== null && (r.strategy === "csp" ? m > 0 : m < 0); };

  function basisLines(syms, mismatchOnly) {
    const out = [];
    for (const sym of syms) {
      const b = basisOf((book.get(sym) || {}).payload);
      if (!b || (b.status !== "mismatch" && (mismatchOnly || b.status !== "rebased"))) continue;
      out.push(T(b.status === "rebased" ? "basis-rebased" : "basis-mismatch", { sym, spot: fmt2(b.spot), print: fmt2(b.printSpot), note: b.printNote ? " (" + String(b.printNote).replace(/\.$/, "") + ")" : "" }));
    }
    return out;
  }

  const putKids = (node, kids) => node.replaceChildren(...kids.filter((x) => x !== null && x !== undefined && x !== false));

  function renderPlan(rows) {
    const plan = mods.plan;
    mods.best.replaceChildren();
    if (side === "sc") {
      const dc = calls();
      if (dc) { dc.renderPlan(rows); return; }
      plan.hidden = true;
      plan.replaceChildren();
      mods.best.append(h("p", { class: "dk-hint" }, T("sc-loading")));
      return;
    }
    if (buyingPower === null || !rows.length) {
      plan.hidden = true;
      plan.replaceChildren();
      mods.best.append(h("p", { class: "dk-hint" }, buyingPower === null ? T(bpBad ? "bp-bad" : "bp-ask") : ""));
      return;
    }
    let best = null, affordable = 0;
    for (const r of rows) {
      const z = r.__sizing;
      if (!z || !z.affordable) continue;
      affordable++;
      if (z.timeValueC > 0 && (!best || betterDeployment(z, best.__sizing))) best = r;
    }
    plan.hidden = false;
    let sentence;
    if (!best) {
      let cheapest = null;
      for (const r of rows) { const c = isNum(r.collateral); if (c !== null && (cheapest === null || c < cheapest)) cheapest = c; }
      sentence = affordable === 0
        ? T("plan-no", { bp: fmtMoney(buyingPower) }) + (cheapest === null ? "" : " " + T("plan-min", { c: fmtMoney(cheapest) }))
        : T("plan-tv0", { bp: fmtMoney(buyingPower), a: affordable });
      plan.className = "dk-plan is-empty";
      plan.replaceChildren(UI.metrics([UI.metric("Best line", DASH, { state: { state: "quiet", reason: sentence } })]));
    } else {
      const z = best.__sizing;
      const sideWord = best.strategy === "cc" ? "buy-write covered call" : "cash-secured put";
      sentence = T("plan", { bp: fmtMoney(buyingPower), a: affordable, m: rows.length, n: z.contracts, t: best.ticker || "?", k: fmt2(best.strike), w: sideWord, e: best.expiry || "?", c: fmtMoney(z.timeValue), d: fmtMoney(z.deployed), i: fmtMoney(z.idle), y: fmtPct(z.yieldOnDeployed, 2), by: rankWord(rank) });
      plan.className = "dk-plan";
      putKids(plan, [
        h("div", { class: "dk-plan-h" }, h("span", null, "Best deployment"), UI.infoButton("the best deployment", () => ({ title: "Best deployment", lead: sentence }), { small: true })),
        h("div", { class: "dk-plan-v" }, h("b", null, z.contracts + "× " + best.ticker + " " + kf(best.strike) + (best.strategy === "cc" ? " call" : " put")), h("span", null, F.day(best.expiry))),
        UI.metrics([UI.metric("Earns", fmtMoney(z.timeValue), { tone: "up" }), UI.metric("Deploys", fmtMoney(z.deployed)), UI.metric("Idle", fmtMoney(z.idle)), UI.metric("Prem. ÷ coll.", planRatio(best))], { min: 72 }),
        UI.split([{ color: "--accent", value: z.deployed / buyingPower }, { color: "--fill-2", value: z.idle / buyingPower }], "Deploys " + fmtMoney(z.deployed) + " of " + fmtMoney(buyingPower) + ", " + fmtMoney(z.idle) + " idle"),
        h("p", { class: "dk-hint" }, affordable + " of " + rows.length + " lines affordable"),
        z.intrinsicValue > 0 ? h("p", { class: "dk-hint dk-itm" }, T("plan-itm", { x: fmtMoney(z.intrinsicValue), t: fmtMoney(z.timeValue) })) : null]);
      const next = rows.filter((r) => r !== best && r.__sizing && r.__sizing.affordable && r.__sizing.timeValueC > 0).sort((a, b) => (betterDeployment(a.__sizing, b.__sizing) ? -1 : betterDeployment(b.__sizing, a.__sizing) ? 1 : 0)).slice(0, 2);
      if (next.length) {
        mods.best.append(h("div", { class: "dk-alts", role: "list", "aria-label": "Next best deployments" }, h("span", { class: "dk-alts-h" }, "Next best"),
          next.map((r) => h("div", { class: "dk-alt", role: "listitem" },
            h("span", null, r.__sizing.contracts + "× " + r.ticker + " " + kf(r.strike) + (r.strategy === "cc" ? " call" : " put")),
            h("span", { class: "dk-alt-d" }, F.day(r.expiry)), h("span", { class: "dk-alt-r" }, planRatio(r)), h("b", null, fmtMoney(r.__sizing.timeValue))))));
      }
    }
    plan.dataset.plan = sentence;
  }

  const mostlyIntrinsic = (r, pc) => isNum(r.intrinsic) !== null && roundCents(r.intrinsic * LOT) * 2 > pc.premiumC;
  const planRatio = (r) => { const pc = r.__pc || premiumLine(r); return pc.ok ? ratioText(pc.premiumC, pc.collateralC) : DASH; };

  function listHead(dc) {
    return dc ? dc.head() : h("div", { class: "dk-head", "aria-hidden": "true" }, ["", "Line", "Prem. ÷ coll.", "Ann.", "Premium", WIN_Q, WIN_P, EV_P, buyingPower === null ? null : "Earns", ""].filter((x) => x !== null).map((x) => h("span", null, x)));
  }

  function fillList(box, rows, dc) {
    box.classList.toggle("is-sc", side === "sc");
    box.classList.toggle("has-col", buyingPower !== null && side !== "sc");
    box.append(listHead(dc));
    rows.forEach((r, i) => box.append(dc ? dc.rowFor(r, i) : rowFor(r, i)));
  }

  function fitLines() {
    const box = mods.list;
    const rows = [...box.querySelectorAll(".dk-row")];
    if (!rows.length) { mods.more.hidden = true; return; }
    for (const r of rows) r.hidden = false;
    let shown = rows.length;
    while (shown > 1 && box.scrollHeight > box.clientHeight + 1) rows[--shown].hidden = true;
    mods.more.hidden = shown === rows.length;
    mods.more.textContent = "Show all " + rows.length;
  }

  function openAll() {
    const rows = view.shown || [];
    const dc = calls();
    if (!mods.allDlg) {
      mods.allBox = h("div", { class: "dk-list dk-all-list", role: "list", "aria-label": "Every sellable line" });
      mods.allDlg = h("dialog", { class: "dk-sc-dialog dk-all-dlg", "aria-labelledby": "dkAllT" },
        h("div", { class: "dk-sc-body" }, h("h2", { id: "dkAllT" }, "Every line"), mods.allBox, h("div", { class: "dk-sc-act" }, h("span"), h("button", { type: "button", class: "dk-pill dk-pill-main", onclick: () => mods.allDlg.close() }, "Done"))));
      mods.allDlg.addEventListener("close", () => mods.more.focus());
      document.body.append(mods.allDlg);
    }
    mods.allBox.replaceChildren();
    fillList(mods.allBox, rows, dc);
    mods.allDlg.showModal();
  }

  function renderList() {
    const rows = view.shown || [];
    const box = mods.list;
    box.replaceChildren();
    if (!rows.length) {
      box.append(UI.silent(inflight && !mods.empty ? { state: "pending", reason: "Pricing…" } : { state: "quiet", word: book.size ? undefined : "Add a symbol to begin", reason: mods.empty || T(view.rows.length ? "e-win" : book.size ? "e-sel" : "e-add") }, "Lines", 120));
      mods.more.hidden = true;
      return;
    }
    const dc = calls();
    box.classList.toggle("is-sc", side === "sc");
    if (side === "sc" && !dc) {
      box.append(UI.silent({ state: "pending", reason: T("sc-loading") }, "Lines", 120));
      mods.more.hidden = true;
      return;
    }
    fillList(box, rows, dc);
    fitLines();
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
    const cell = (cls, label, text, tone, title, sub) => h("span", { class: "dk-c " + cls, "data-tone": tone || null, title: title || null }, h("small", null, label), text, sub ? h("em", { class: "dk-sub" }, sub) : null);
    const pc = r.__pc || premiumLine(r);
    const pcText = pc.ok ? ratioText(pc.premiumC, pc.collateralC) : null;
    const pq = popQ(r), pp = popP(r), ev = evP(r), wq = winText(r, pq);
    const noEng = r.__eng ? null : r.__why || T("why-eng"), noLaw = r.__eng && pp === null ? lawNote(r) : null;
    const collect = buyingPower === null ? null : !z ? cell("dk-col", "Earns", DASH, null, T("col-none"))
      : z.timeValue === null ? cell("dk-col", "Earns", DASH, "silent", T("col-tv-none"))
      : !z.affordable ? cell("dk-col is-unaffordable", "Earns", "$0", "silent", T("col-no", { c: fmtMoney(r.collateral), b: fmtMoney(buyingPower) }))
        : cell("dk-col", "Earns", fmtMoney(z.timeValue) + " (" + z.contracts + "×)", "up", T("col-ok", { n: z.contracts, s: z.contracts === 1 ? "" : "s", p: fmtMoney(r.premium), d: fmtMoney(z.deployed), b: fmtMoney(buyingPower), i: fmtMoney(z.idle), y: fmtPct(z.yieldOnDeployed, 2) }) + (z.intrinsicValue > 0 ? " " + T("col-itm", { g: fmtMoney(z.collectible), t: fmtMoney(z.timeValue), x: fmtMoney(z.intrinsicValue) }) : "") + (r.strategy === "cc" ? " " + T("cc-size") : ""));
    return h("div", {
      class: "dk-row" + (isItm(r) ? " is-itm" : ""), role: "listitem", "data-why": e ? (pp === null ? e.world.why : null) : r.__code || "engine", "data-t": r.ticker, "data-strike": String(r.strike), "data-strategy": r.strategy, "data-expiry": r.expiry,
      "data-earn": earn, "data-stale-iv": r.ivTraded === false ? "" : null, "data-away": away, "data-collateral": "on " + fmtMoney(r.collateral), "data-days": String(r.days), "data-i": String(i),
      "data-premium-c": pc.premiumC === null ? null : String(pc.premiumC), "data-collateral-c": pc.collateralC === null ? null : String(pc.collateralC), "data-pc": pc.ok ? pcText : null,
      onpointerenter: () => focusPoint(r), onpointerleave: () => focusPoint(null),
    },
    h("span", { class: "ui-badge", "data-tone": r.strategy === "cc" ? "up" : "down", "aria-label": r.strategy === "cc" ? "Covered call" : "Cash-secured put" }, r.strategy === "cc" ? "C" : "P"),
    h("span", { class: "dk-main" },
      h("a", { class: "dk-t", href: "/flows/ticker/?t=" + encodeURIComponent(r.ticker), title: T("t-link", { t: r.ticker }) }, r.ticker),
      h("a", { class: "dk-k", href: labHref(r), "aria-label": T("lab-a", { t: r.ticker, k: kf(r.strike), w: r.strategy === "cc" ? "covered call" : "cash-secured put", e: r.expiry }) },
        h("b", null, kf(r.strike)), h("span", null, r.strategy === "cc" ? "call" : "put")),
      earn === "clear" ? null : h("span", { class: "dk-earn" + (earn === "unknown" ? " is-unknown" : ""), role: "img", "aria-label": T("earn-" + earn), title: T("earn-" + earn) }, glyph(earn === "crosses" ? "cal" : "pending")),
      h("span", { class: "dk-meta" }, F.day(r.expiry) + " · " + r.days + "d" + (away ? " · " + away : ""))),
    h("span", { class: "dk-cells" },
      pc.ok ? cell("dk-pc", "Premium ÷ collateral", pcText, mostlyIntrinsic(r, pc) ? "silent" : null, mostlyIntrinsic(r, pc) ? T("t-pc-itm") : T("t-pc"), centsText(pc.premiumC, true) + " ÷ " + centsText(pc.collateralC)) : cell("dk-pc", "Premium ÷ collateral", DASH, "silent", T("pc-" + pc.why)),
      cell("dk-ann", "Ann.", fmtPct(r.annualized, 0), null, T("t-ann")),
      pc.premiumC === null ? cell("dk-prem", "Premium", DASH, "silent", T("pc-no-bid")) : cell(pc.ok ? "dk-prem is-dup" : "dk-prem", "Premium", centsText(pc.premiumC, true), null, T("t-prem"), Number.isSafeInteger(pc.collateralC) ? "on " + centsText(pc.collateralC) : null),
      cell("dk-pq", WIN_Q, wq.text, null, wq.title || noEng || T("t-pq")),
      cell("dk-pp", WIN_P, pp === null ? DASH : fmtPct(pp, 0), null, wq.title || noEng || noLaw || T("t-pp")),
      cell("dk-ev", EV_P, ev === null ? DASH : usd(ev), ev === null ? "silent" : ev > 0 ? "up" : ev < 0 ? "down" : null, noEng || noLaw || T("t-ev") + " " + T("ev-market")),
      collect),
    UI.infoButton(r.ticker + " " + kf(r.strike) + " " + (r.strategy === "cc" ? "call" : "put"), () => rowInfo(r), { small: true }));
  }

  const lawNote = (r) => {
    const why = r.__eng && r.__eng.world.why === "world.event-missing" ? Q.codeText("world.event-missing") : r.__law ? r.__law + "." : null;
    return why ? T("nrf", { why }) : null;
  };

  const DELTA_MOVE_NOTE = 0.02, DELTA_MOVE_PAIRS = 5;
  const deltaMove = (r, f, used, years) => {
    const sigma = isNum(r.ivMid === undefined ? r.iv : r.ivMid), K = isNum(r.strike), F = isNum(f.F);
    if (!Q || typeof Q.normCdf !== "function" || !(f.pairs >= DELTA_MOVE_PAIRS) || sigma === null || !(sigma > 0) || K === null || !(K > 0) || F === null || !(F > 0) || !(used > 0) || !(years > 0)) return null;
    const sd = sigma * Math.sqrt(years), d1 = (fwd) => (Math.log(fwd / K) + sd * sd / 2) / sd;
    return Math.abs(Q.normCdf(d1(F)) - Q.normCdf(d1(used)));
  };

  const gapText = (f) => {
    if (f.src !== "parity" || isNum(f.gapBp) === null) return "";
    const x = Math.abs(f.gapBp);
    return " " + T(f.gapBp < 0 ? "fwd-below" : "fwd-above", { x: x >= 10 ? fmtInt(x) : fmtPct(x / 100, 1).replace("%", "") });
  };

  const carryWhy = (f) => (f.n === 0 ? T("fwd-why-0") : T("fwd-why-few", { n: f.n }));

  const fwdText = (r, f) => {
    const e = isNum(f.se) === null ? DASH : fmt2(1.96 * f.se);
    const fit = r.__fitFull;
    const used = fit ? fit.forward.F : f.F;
    if (f.veto) return T("fwd-veto", { f: fmt2(f.Fc) });
    const early = f.ee === true ? " " + T("fwd-ee") : "";
    if (f.src === "parity") return T("fwd-par", { f: fmt2(used), e, n: f.n }) + gapText(f) + early;
    if (f.src === "blend") return T("fwd-blend", { f: fmt2(used), e, n: f.n, c: fmt2(f.Fc) }) + gapText(f) + early;
    if (f.src === "carry") return T(f.qKnown === false ? "fwd-rate2" : "fwd-carry2", { f: fmt2(f.F), e, why: carryWhy(f) });
    return T("fwd-rate2", { f: fmt2(f.F), e, why: carryWhy(f) });
  };

  const forwardText = (r) => {
    if (r.__fwd) return fwdText(r, r.__fwd);
    const f = r.__fwdLegacy;
    if (!f) return DASH + " " + T("fwd-none");
    const own = f.method === "parity" && isNum(f.F) !== null ? T("fwd-parity", { f: fmt2(f.F), n: f.pairs })
      : f.method === "carry" && isNum(f.F) !== null ? T("fwd-carry", { f: fmt2(f.F) })
        : f.method === "rate-only" ? T("fwd-rate") : null;
    if (own === null) return DASH + " " + T("fwd-none");
    const e = r.__eng, S = isNum(r.__spot), c = e && e.carry, years = e && isNum(e.T);
    if (!c || S === null || years === null || isNum(c.r) === null || isNum(c.q) === null) return own;
    const used = S * Math.exp((c.r - c.q) * years);
    const move = deltaMove(r, f, used, years);
    return own + (isNum(f.F) !== null ? " " + T("fwd-engine", { g: fmt2(used), d: fmtPct(Math.abs(f.F / used - 1), 2) }) : " " + T("fwd-engine-same", { g: fmt2(used) })) + (move !== null && move > DELTA_MOVE_NOTE ? " " + T("fwd-delta", { x: move.toFixed(2) }) : "");
  };

  const rateHow = (m) => { const k = String(m || "fallback"), i = k.indexOf(":"); return T("rm-" + (i < 0 ? k : k.slice(0, i)), { x: k.slice(i + 1) }) || k; };
  const whyText = (c) => T("c-" + c) || Q.codeText(c) || c;

  function pcPrem(r) {
    const pc = r.__pc || premiumLine(r);
    return pc.premiumC === null ? DASH + " " + T("pc-no-bid") : centsText(pc.premiumC, true) + " a contract at the " + fmt2(r.bid) + " bid";
  }

  function pcLine(r) {
    const pc = r.__pc || premiumLine(r);
    if (!pc.ok) return DASH + " " + T("pc-" + pc.why);
    const intrinsicC = isNum(r.intrinsic) === null ? 0 : Math.min(pc.premiumC, roundCents(r.intrinsic * LOT));
    return ratioText(pc.premiumC, pc.collateralC) + " = " + centsText(pc.premiumC, true) + " ÷ " + centsText(pc.collateralC, true) + (intrinsicC > 0 ? " · " + T("pc-itm", { x: centsText(intrinsicC, true) }) : "") + " · " + T(r.strategy === "cc" ? "pc-cc" : "pc-csp");
  }

  function rowInfo(r) {
    const e = r.__eng, leg = shortLeg(r), fit = r.__fit;
    const m = isNum(r.moneyness), S = isNum(r.__spot);
    const otm = m === null ? null : r.strategy === "csp" ? m < 0 : m > 0;
    const cc = r.strategy === "cc", cap = isNum(r.capSigmas);
    const oi = isNum(r.oi), ch = isNum(r.oiChange);
    const sh = leg && isNum(leg.intrinsic) !== null ? leg : { intrinsic: isNum(r.intrinsic) || 0, timeValue: (isNum(r.bid) || 0) - (isNum(r.intrinsic) || 0) };
    const wk = isNum(r.annualized) === null ? null : r.annualized * 7 / 365;
    const legIv = leg ? isNum(leg.iv) : null, cIv = isNum(r.ivMid === undefined ? r.iv : r.ivMid);
    return {
      title: r.ticker + " " + kf(r.strike) + " " + (cc ? "covered call" : "cash-secured put"), asOf: F.day(r.expiry) + " · " + r.days + "d",
      lead: T("engine"),
      facts: [
        ["Premium ÷ collateral", pcLine(r)],
        ["Premium", pcPrem(r)],
        ["Time value ÷ collateral", fmtPct(r.yieldOnCollateral, 2) + " on " + fmtMoney(r.collateral) + " " + T(cc ? "y-cc" : "y-csp")],
        ["Annualised", fmtPct(r.annualized, 0) + " on time value — a convention"],
        ["Gross annualised", isNum(r.annualizedGross) === null ? null : fmtPct(r.annualizedGross, 0) + " " + T("f-gross")],
        ["Per week", wk === null ? null : fmtPct(wk, 2) + " " + T("f-week")],
        ["Distance", m === null ? DASH : Math.abs(m) < 5e-5 ? "at the money" : fmtPct(Math.abs(m), 1) + " " + (m < 0 ? "below" : "above") + " spot" + (S === null ? "" : " of " + fmt2(S)) + ", " + (otm ? "out of" : "in") + " the money"],
        ["Cushion", fmtSd(r.cushionSigmas) + (cIv === null ? "" : " on " + fmtPct(cIv, 1) + " volatility") + (r.ivMid === undefined && r.ivTraded === false ? " · " + T("iv-old") : "")],
        ["Forward", forwardText(r)],
        ["Volatility", legIv === null ? null : fmtPct(legIv, 1) + " " + T("f-vol") + (cIv !== null && Math.abs(cIv - legIv) > 0.005 ? " · " + fmtPct(cIv, 1) + " " + T("f-vol-c") : "")],
        ["Smile", fit ? T(fit.origin === "card-shape" ? "fit-shape" : "fit-flat", { from: fit.shapeFrom }) + (fit.contract && fit.contract.via === "opposite" ? " " + T("fit-via", { side: r.type === "P" ? "call" : "put" }) : "") : null],
        ["Carry", e ? T("carry", { r: fmtPct(e.carry.r, 2), how: rateHow(e.carry.rateMethod), q: fmtPct(e.carry.q, 2) }) + (cc && e.carry.dividend > 0 ? " " + T("carry-div", { d: "$" + fmt2(e.carry.dividend) }) : "") : null],
        ["Breakeven", fmt2(r.breakeven)],
        ["If called", cc ? fmtPct(r.assignedReturn, 1) + " of the stock price" + (m !== null && m < 0 ? " · already through the strike" : cap === null ? "" : " · the market has to run " + fmtSd(cap) + " to get there") : DASH + " · " + T("no-cap")],
        ["Spread", fmtPct(r.spread, 1) + " of the mid"],
        ["Open interest", oi === null ? DASH : fmtInt(oi) + (ch ? " (" + sg(ch) + fmtInt(Math.abs(ch)) + ")" : "")],
        ["Earnings", r.crossesEarnings === true ? "Expires after the next report" : r.crossesEarnings === null ? "Not determined" : "No report before expiry"],
        ["Chance of profit", e ? (dashed(r) ? DASH + " " + bandNote(r) : fmtPct(e.prob.popQ, 1) + " implied · " + (e.prob.popP === null ? DASH : fmtPct(e.prob.popP, 1)) + " model vol" + (bandNote(r) ? " · " + bandNote(r) : "")) : DASH],
        ["Expected value", e ? (e.ev.p === null ? DASH : usd(e.ev.p)) + " model vol, per contract sold into the bid · " + T("ev-implied", { x: usd(e.ev.q) }) + " " + T("ev-market") : DASH],
        ["Delta", e ? (dashed(r) ? DASH + " " + bandNote(r) : fmt2(shortDelta(r)) + (r.__band && r.__band.band === "pm" ? " ± " + fmt2(r.__band.half) : "") + " on the short option · " + fmt2(netOf(r)) + " net exposure to the stock") : DASH],
        ["Grade", e ? e.grade + " of 3" + (e.gradeWhy.length ? " · " + e.gradeWhy.map(whyText).join(" ") : "") : DASH],
      ],
      notes: [sh.intrinsic > 0 ? (sh.timeValue >= 0 ? T("int-in", { i: fmtMoney(sh.intrinsic * LOT), t: fmtMoney(sh.timeValue * LOT) }) : T("int-below")) : null,
        e ? null : r.__why || null, e && e.prob.popP === null ? lawNote(r) : null, T("annualized"), T("cushion")],
    };
  }

  let focused = null;
  function focusPoint(r) { focused = r; drawScatter(true); }
  function drawScatter(quick) { if (mods.chart) { mods.quick = !!quick; mods.chart.redraw(false); } }

  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const chartHeight = (w) => {
    const stage = grid.clientHeight;
    if (!(stage > 0)) return w < 600 ? 240 : 300;
    return w < 600 ? clampN(stage - 190, 150, 240) : clampN(stage - (side === "sc" ? 112 : 92), 200, 480);
  };
  const emptyFrontier = (host, H, phone) => host.append(UI.silent(inflight && !mods.empty ? { state: "pending", reason: "Pricing the desk…" } : { state: "quiet", word: book.size ? undefined : "Add a symbol to begin", reason: mods.empty || T(view.rows.length ? "e-win" : book.size ? "e-sel" : "e-add") }, "Frontier", book.size ? H : phone ? 140 : 180));

  function drawScatterInto(host, w, animate) {
    const phone = w < 600;
    const H = chartHeight(w);
    mods.legend.replaceChildren();
    if (side === "sc") {
      const dc = calls();
      if (dc) dc.drawScatter(host, w, animate); else host.append(UI.silent({ state: "pending", reason: T("sc-loading") }, "Frontier", H));
      return;
    }
    const rows = (view.shown || []).filter((r) => r.__eng);
    if (!rows.length) { emptyFrontier(host, H, phone); return; }
    const xOf = axis === 0 ? netOf : popQ;
    const pts = rows.map((r) => ({ r, x: xOf(r), y: isNum(r.annualized) })).filter((p) => p.x !== null && p.y !== null);
    if (!pts.length) { host.append(UI.silent({ state: "withheld", reason: T("fr-none") }, "Frontier", H)); return; }
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    const p95 = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.95))];
    const cap = Math.max(0.05, Math.min(ys[ys.length - 1], p95 * 8) * 1.04);
    const left = 44, right = 16, top = 24, bottom = 26;
    const x0 = axis === 0 ? 0 : Math.max(0, Math.min(...pts.map((p) => p.x)) - 0.03), x1 = axis === 0 ? Math.max(0.1, Math.max(...pts.map((p) => p.x)) * 1.08) : 1;
    const x = C.lin(x0, x1, left, w - right), yl = C.lin(0, Math.sqrt(cap), H - bottom, top);
    const y = (v) => yl(Math.sqrt(Math.max(0, v)));
    const box = h("div", { class: "tl-scrub" });
    host.append(box);
    const svg = C.svgRoot(box, w, H, animate && !mods.quick, T("fr-aria", { x: axis === 0 ? "net delta" : "the implied chance of profit", n: pts.length }));
    s("line", { x1: left, x2: w - right, y1: H - bottom, y2: H - bottom, class: "base" }, svg);
    let lastY = Infinity;
    for (const t of [0, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32]) {
      if (t > cap || lastY - y(t) < 40) continue;
      lastY = y(t);
      s("text", { x: left - 8, y: y(t) + 4, text: Math.round(t * 100) + "%", "text-anchor": "end" }, svg);
    }
    s("text", { x: 2, y: 11, text: "Ann. yield, square-root scale", class: "tx-3" }, svg);
    for (const t of C.niceTicks(x0, x1, phone ? 4 : 6)) {
      if (x(t) < left + 8 || x(t) > w - right - 8) continue;
      s("text", { x: x(t), y: H - 7, text: axis === 0 ? t.toFixed(2).replace(/^0/, "") : Math.round(t * 100) + "%", "text-anchor": "middle" }, svg);
    }
    s("text", { x: w - right, y: H - bottom - 6, text: axis === 0 ? "Net delta" : WIN_Q, "text-anchor": "end", class: "tx-3" }, svg);
    const fr = frontierOf(pts, axis === 1);
    const frSet = new Set(fr);
    if (fr.length > 1) {
      const P = fr.map((p) => [x(p.x), y(Math.min(p.y, cap))]);
      const inScale = fr.findIndex((p) => p.y > cap);
      const cut = inScale < 0 ? P.length : Math.max(1, inScale);
      s("path", { d: C.pathOf(P.slice(0, cut)), class: "ln dk-front" + (animate && !mods.quick ? " draw" : ""), pathLength: 1 }, svg);
      if (cut < P.length) s("path", { d: C.pathOf(P.slice(cut - 1)), class: "ln dk-front is-off" }, svg);
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
    const order = pts.slice().sort((a, b) => a.x - b.x);
    const at = focused ? order.findIndex((q) => q.r === focused) : -1;
    if (at >= 0) box._scrubAt = at;
    C.scrub(box, svg, {
      xs: order.map((p) => x(p.x)), ys: order.map((p) => y(Math.min(p.y, cap))), reach: 30, first: true, xh: 0, top, bottom: H - bottom, label: T("fr-key"),
      onMove: (i) => {
        const p = order[i], r = p.r;
        const pc = r.__pc || premiumLine(r), pcText = pc.ok ? ratioText(pc.premiumC, pc.collateralC) : DASH;
        return {
          noLine: true, top: Math.max(0, y(Math.min(p.y, cap)) - 40), say: r.ticker + " " + kf(r.strike) + ", " + fmtPct(r.annualized, 0) + " annualised, premium over collateral " + pcText,
          parts: [C.part(r.ticker + " " + kf(r.strike) + (r.strategy === "cc" ? " call" : " put"), null), C.part(F.day(r.expiry), "k"),
            h("b", null, fmtPct(r.annualized, 0)), C.part(pcText + " of collateral", "k"), C.part(axis === 0 ? "Net Δ " + fmt2(p.x) : fmtPct(p.x, 0), "k")],
        };
      },
    });
    box.setAttribute("aria-label", T("fr-key"));
    mods.legend.replaceChildren(UI.legend([...syms.map((sym) => [colorOf(sym), "dot", sym]), ["--label-2", "dot", "Put"], ["--label-2", "dia", "Call"], ["--label-1", "ln", "Frontier"]]), ...(view.shown.length > pts.length ? [h("p", { class: "dk-hint" }, T("unplotted", { n: view.shown.length - pts.length }))] : []));
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
    if (!list0.length) {
      card.hidden = true;
      tabs.smile.hidden = true;
      mods.smile.replaceChildren();
      if (curTab === "smile") showTab("frontier", false, true);
      return;
    }
    if (surfaceSymbol === null || !list0.includes(surfaceSymbol)) surfaceSymbol = list0[0];
    mods.smileSel.replaceChildren(...list0.map((sym) => h("option", { value: sym }, sym)));
    mods.smileSel.value = surfaceSymbol;
    mods.smileSel.disabled = list0.length < 2;
    const was = card.hidden;
    card.hidden = false;
    tabs.smile.hidden = false;
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
      s("title", { text: e.expiry + (e.days === null ? "" : ", " + e.days + " days") + ". " + T(crosses === true ? "sm-ex" : crosses === false ? "sm-ex0" : "sm-exu") }, g);
      s("text", { class: "ivs-exp" + (crosses === true ? " crosses-earnings" : ""), x, y: padT - 18, "text-anchor": "middle", text: F.day(e.expiry) + (crosses === true ? " ⚠" : "") }, g);
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
      s("title", { text: v === null ? T("sm-lv0", { e: e.expiry, r: e.atmReason || "not measurable" }) : T("sm-lv", { e: e.expiry, v: fmtVol(v), k: e.atmStrike, w: e.atmType === "P" ? "put" : "call", m: fmtM(e.atmM) }) }, g);
      s("text", { class: "ivs-level" + (v === null ? " is-missing" : ""), x, y: termT + bandH + 19, "text-anchor": "middle", text: v === null ? DASH : fmtVol(v) }, g);
      if (v === null) return;
      s("circle", { class: "ivs-dot", cx: x, cy: yOf(v), r: 3 }, svg);
      const prev = levels[j - 1];
      if (j > 0 && prev !== null) s("line", { class: "ivs-termline", x1: labelW + (j - 1) * colW + colW / 2, y1: yOf(prev), x2: x, y2: yOf(v) }, svg);
    });
  }

  function cellTitle(cell, e, sf) {
    const parts = [cell.strike + " " + (cell.type === "P" ? "put" : "call") + " " + cell.expiry + " · " + fmtM(cell.m) + " from the money · " + fmtVol(cell.iv) + "% vendor volatility"];
    parts.push(isNum(cell.skew) !== null ? fmtSkew(cell.skew) + " vol points against this expiry's at-the-money " + fmtVol(e.atmIv) + "%" : "No skew: " + (e.atmReason || "this expiry has no at-the-money level"));
    if (cell.traded === false) parts.push(T("sm-untraded"));
    else if (cell.traded === null) parts.push(T("sm-novol"));
    else parts.push("Traded " + fmtInt(cell.volume) + " today" + (cell.oi === null ? "" : ", open interest " + fmtInt(cell.oi)) + ".");
    if (cell.crowd > 1) parts.push(cell.crowd + " " + T("sm-crowd"));
    if (isNum(cell.skew) !== null && isNum(sf.skewCap) !== null && Math.abs(cell.skew) > sf.skewCap) parts.push(T("sm-past", { c: fmtSkew(sf.skewCap) }));
    return parts.join(". ").replace(/\.\./g, ".");
  }

  function surfaceAria(sf, p) {
    const levels = sf.expiries.map((e) => F.day(e.expiry) + " " + (isNum(e.atmIv) === null ? "no level" : fmtVol(e.atmIv) + " percent"));
    return T("sm-aria", { t: p && p.ticker ? p.ticker : surfaceSymbol, e: sf.expiriesShown, r: sf.rowsShown, l: levels.join(", ") });
  }

  function surfaceNotes(sf, p) {
    const bits = [];
    bits.push(T("sm-rows", { w: (sf.step * 100).toFixed(1) }));
    bits.push((smileNumbers ? T("sm-num") : T("sm-narrow")) + " " +
      T("sm-shade"));
    bits.push(T("sm-atm", { l: sf.expiries.map((e) => F.day(e.expiry) + " " + (isNum(e.atmIv) === null ? DASH : fmtVol(e.atmIv) + "%")).join(", ") }));
    const noLevel = sf.expiries.filter((e) => isNum(e.atmIv) === null);
    if (noLevel.length) bits.push(noLevel.map((e) => F.day(e.expiry) + " has no level — " + e.atmReason).join("; ") + ". " + T("sm-nolevel"));
    const aged = [];
    if (sf.stale > 0) aged.push(sf.stale + " did not");
    if (sf.unknownAge > 0) aged.push(sf.unknownAge + " carr" + (sf.unknownAge === 1 ? "ies" : "y") + " no volume at all");
    bits.push(T("sm-last") + " " + sf.fresh + " of " + sf.placed + " cells traded today" +
      (aged.length === 0 ? " — " + T("sm-fresh") : "; " + aged.join(" and ") + ", " + T("sm-aged")));
    if (sf.crowded > 0) bits.push(T(sf.crowded === 1 ? "sm-c1" : "sm-cn", { n: sf.crowded }));
    if (sf.clipped > 0) bits.push(T("sm-cap", { c: fmtSkew(sf.skewCap), n: sf.clipped, s: sf.clipped === 1 ? " runs" : "s run", is: sf.clipped === 1 ? "is" : "are" }));
    const win = [];
    if (sf.expiriesShown < sf.expiriesTotal) win.push(sf.expiriesShown + " of " + sf.expiriesTotal + " expiries");
    if (sf.rowsShown < sf.rowsTotal) win.push(sf.rowsShown + " of " + sf.rowsTotal + " moneyness bands");
    if (win.length) bits.push("Showing " + win.join(" and ") + ".");
    bits.push(T("sm-built") + (p && p.truncated ? " " + T("sm-cut") : ""));
    if (sf.ivBasis) bits.push(T("sm-units", { b: sf.ivBasis }));
    bits.push(T("sm-quoted"));
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
    const dc = calls();
    if (dc) return dc.frontierInfo();
    return { title: "Frontier", lead: T("frontier"), sections: [{ title: "Axes", lines: [T("frontier-x")] }, { title: "Engine", lines: [T("engine")] }], notes: [T("refuse")] };
  }
  function linesInfo() {
    const dc = calls();
    if (dc) return dc.linesInfo(foot.textContent);
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
    let oldest = null, unaged = 0, oldestKept = false;
    for (const sym of chosen) {
      const e = book.get(sym);
      if (!e || e.state !== "ok" || !e.payload) continue;
      const a = ageOf(e.payload);
      if (a === null) { unaged++; continue; }
      if (oldest === null || a > oldest) { oldest = a; oldestKept = e.kept !== null && e.kept !== undefined; }
    }
    const kept = chosen.filter((s0) => { const e = book.get(s0); return e && e.state === "ok" && e.kept !== null && e.kept !== undefined; });
    const age = oldest === null ? "" : " · quotes " + fmtAge(oldest);
    const unagedNote = unaged ? " · " + T(unaged === 1 ? "unaged1" : "unagedN", { n: unaged }) : "";
    const staleQuotes = oldest !== null && oldest > QUOTE_STALE_SECONDS ? T("stale-q") + (oldestKept ? "" : " " + T("stale-r")) : "";
    const sessions = new Set(), stale = [], earnBits = [], keptBits = [];
    for (const sym of chosen) {
      const e = book.get(sym), p = e && e.payload;
      if (!p) continue;
      if (e.state === "ok" && e.kept !== null && e.kept !== undefined) keptBits.push(T(e.kept === "throttled" ? "kept-throttled" : "kept-other", { who: sym, at: F.when(p.generatedAt, Date.now()) || "an earlier read" }));
      if (p.marketTime) sessions.add(String(p.marketTime));
      if (p.spotSource === "daily-close") stale.push(sym);
      earnBits.push(earningsBit(sym, p));
    }
    const basis = basisLines(chosen);
    const session = sessions.size === 1 ? " · " + [...sessions][0] + " session" : "";
    const staleNote = stale.length ? " · " + stale.join(", ") + " priced off the last close, not a live print" : "";
    const cuts = side === "sc" ? cutBrief(chosen) : [];
    const lines = [(failed.length ? chosen.length - failed.length + " of " + chosen.length + " symbols priced · " + failed.join(", ") + " unavailable" : chosen.length + " symbol" + (chosen.length === 1 ? "" : "s") + " priced") + session + age + unagedNote + staleNote, ...basis, ...keptBits, staleQuotes, ...cuts, earnBits.join(" · ")];
    statusEl.replaceChildren(...lines.filter(Boolean).map((t) => h("span", { class: "flows-status-l" }, t)));
    statusEl.classList.toggle("visually-hidden", !(failed.length || staleQuotes || stale.length || basis.length || kept.length || cuts.length));
  }

  function earningsBit(sym, p) {
    const e = p.earnings;
    if (!e) return sym + " earnings date not read: the data provider's company read did not answer";
    if (!e.date) {
      const etf = /etf|index|fund/i.test(String(e.issueType || ""));
      return sym + (etf ? " has no earnings (" + e.issueType + ")" : " has no known earnings date");
    }
    const md = String(e.date).slice(5), rows = p.rows || [];
    if (e.past === true) return T("earn-past", { sym, md });
    if (e.precedesSale === true) return T("earn-printed", { sym, md });
    if (!rows.length) return sym + " reports " + md;
    const crossing = rows.filter((r) => r.crossesEarnings === true).length;
    if (crossing) return sym + " reports " + md + " — " + crossing + " of " + rows.length + " lines expire after it";
    const unknown = rows.filter((r) => r.crossesEarnings === null || r.crossesEarnings === undefined).length;
    if (unknown) return T("earn-undetermined", { sym, md, n: unknown, s: unknown === 1 ? "" : "s" });
    return sym + " reports " + md + " — no line expires after it";
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
    if (!wanted.length) { say(T("sym-bad")); return; }
    const need = wanted.filter((w) => !book.has(w));
    const added = add(wanted);
    input.value = "";
    if (!need.length) say(wanted.length === 1 ? wanted[0] + " is already on the desk." : "Already on the desk.");
    else if (added.length < need.length) {
      const dropped = need.filter((w) => !book.has(w));
      say(T("full", { n: MAX_SYMBOLS, dropped: dropped.length ? "Not added: " + dropped.join(", ") + ". " : "" }));
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
    const dirty = String(raw || "").trim().length > 0, bad = dirty && next === null;
    const changed = next !== buyingPower || bad !== bpBad;
    buyingPower = next;
    bpBad = bad;
    const bp = mods.bp;
    if (mods.bpClear) mods.bpClear.hidden = !dirty;
    if (bp) {
      bp.classList.toggle("is-invalid", bad);
      bp.setAttribute("aria-invalid", bad ? "true" : "false");
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
    const reuse = SERVER_SIDE[next] === SERVER_SIDE[side];
    side = next;
    syncRanks();
    writeURL();
    if (side === "sc") loadCalls();
    if (reuse) { renderChips(); render(); return; }
    invalidate(book.values());
    for (const e of book.values()) { e.state = "idle"; e.payload = null; e.kept = null; }
    renderChips();
    const chosen = selectedSymbols();
    if (chosen.length) runPool(chosen, {});
    render();
  }

  const RANK_REFETCH_MS = 250;
  const rankDebounceMs = () => { const v = Number(window.__flowsRankDebounceMs); return Number.isFinite(v) && v >= 0 ? v : RANK_REFETCH_MS; };
  let rankTimer = null;
  function onRank() {
    const sel = mods.rankSel;
    if (sel.value === "collectible" && buyingPower === null) {
      sel.value = rank;
      say(T("rank-bp"));
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

  const shortCallTerms = () => { const dc = calls(); return dc ? dc.terms() : null; };
  let termsTimer = null;
  function recutTerms() {
    const t = shortCallTerms();
    if (side !== "sc" || !t) return;
    const stale = selectedSymbols().filter((sym) => {
      const e = book.get(sym);
      const cut = e && e.payload && e.payload.cut;
      return !!cut && (!cut.terms || cut.terms.h !== t.h || cut.terms.f !== t.f);
    });
    if (termsTimer !== null) { clearTimeout(termsTimer); termsTimer = null; }
    if (!stale.length) return;
    const wait = rankDebounceMs();
    if (wait === 0) { runPool(stale, {}); return; }
    termsTimer = setTimeout(() => { termsTimer = null; runPool(stale, {}); }, wait);
  }

  async function topName() {
    try {
      const r = await fetch("/api/flows/board?side=long", { credentials: "same-origin", headers: { Accept: "application/json" }, signal: AbortSignal.timeout?.(8000) });
      const rows = r.ok ? (await r.json()).rows : null;
      const t = Array.isArray(rows) && rows[0] ? String(rows[0].t || "").toUpperCase() : "";
      return /^[A-Z][A-Z0-9.-]{0,9}$/.test(t) ? t : null;
    } catch { return null; }
  }

  const initial = readURL();
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { deskKit: Object.freeze({
    UI, h, s, F, glyph, DASH, MINUS, C, T, Q, isNum, fmt2, fmtPct, fmtInt, fmtSd, fmtMoney, usd, kf, colorOf, roundCents, centsText, ratioText, ratioFraction, frontierOf, netDelta, mods, WIN_Q, WIN_P, isItm, labHref, whyText, rateHow,
    filters, st: () => ({ side, rank, tenor, axis, buyingPower, bpBad, view, focused, quick: mods.quick }),
    render, focusPoint, chartHeight, forwardText, betterDeployment, recutTerms, winHalf, winHalfOf, priceStruct, bandNote, winText, dashed, EV_P, addFilter: (n) => { mods.terms = n; placeFilters(); }, emptyFrontier, attached: () => { syncRanks(); render(); recutTerms(); },
  }) }));
  ensureModules();
  showTab(viewFromHash(), false, true);
  if (side === "sc") loadCalls();
  renderChips();
  render();
  if (initial.length) add(initial);
  else topName().then((t) => {
    if (!t || book.size) return;
    const go = h("button", { type: "button", class: "dk-suggest", onclick: () => { go.remove(); if (!book.size) add([t]); } }, "Try " + t);
    (list.closest(".dk-chipw") || list).after(go);
  });
})();
