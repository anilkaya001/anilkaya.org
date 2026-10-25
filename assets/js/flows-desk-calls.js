(() => {
  "use strict";

  const SHARES_PER_CONTRACT = 100;
  const DAYS_PER_YEAR = 365;
  const SC_DEFAULTS = Object.freeze({ contracts: 100, convention: "delta", haircut: 0.3, floor: 0.1 });
  const SC_REG_T = Object.freeze({ base: 0.2, floor: 0.1 });
  const SC_LIMITS = Object.freeze({ contractsMax: 100000, haircut: Object.freeze([0.05, 1]), floor: Object.freeze([0, 0.5]) });
  const SC_CONVENTIONS = Object.freeze(["delta", "regt", "shares"]);
  const SC_FAM = Object.freeze({ id: "custom", risk: "undefined", dir: "neutral" });

  const numOrNull = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const roundCents = (dollars) => Math.round(dollars * 100 + 1e-9 + Math.abs(dollars) * 1e-13);

  function parseContracts(raw) {
    const text = String(raw === null || raw === undefined ? "" : raw).trim().toLowerCase();
    const m = /^(\d{1,3}(?:,\d{3})+|\d+)(k?)$/.exec(text);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    return Number.isInteger(n) && n >= 1 && n <= SC_LIMITS.contractsMax ? n : null;
  }

  function parsePercent(raw, [lo, hi]) {
    const text = String(raw === null || raw === undefined ? "" : raw).trim();
    const m = /^(\d+(?:\.\d+)?)\s*%?$/.exec(text);
    if (!m) return null;
    const v = Math.round(Number(m[1]) / 100 * 1e4) / 1e4;
    return v >= lo && v <= hi ? v : null;
  }

  function shortCallCollateral({ convention = SC_DEFAULTS.convention, spot, strike, delta = null, haircut = SC_DEFAULTS.haircut, floor = SC_DEFAULTS.floor } = {}) {
    const fail = (why) => ({ ok: false, m1C: null, binding: null, why });
    const S = numOrNull(spot), K = numOrNull(strike);
    if (S === null || K === null || !(S > 0) || !(K > 0)) return fail("no-spot");
    let m, binding;
    if (convention === "regt") {
      const a = SC_REG_T.base * S - Math.max(0, K - S), fl = SC_REG_T.floor * S;
      m = SHARES_PER_CONTRACT * Math.max(a, fl);
      binding = a > fl ? "regt-otm" : "floor";
    } else if (convention === "shares") {
      m = SHARES_PER_CONTRACT * S;
      binding = "shares";
    } else if (convention === "delta") {
      const hc = numOrNull(haircut), fl = numOrNull(floor);
      if (hc === null || fl === null || hc < SC_LIMITS.haircut[0] || hc > SC_LIMITS.haircut[1] || fl < SC_LIMITS.floor[0] || fl > SC_LIMITS.floor[1]) return fail("bad-terms");
      const d = numOrNull(delta);
      if (d === null) return fail("no-delta");
      if (d < 0 || d > 1) return fail("bad-delta");
      m = SHARES_PER_CONTRACT * S * Math.max(hc * d, fl);
      binding = hc * d > fl ? "delta" : "floor";
    } else return fail("bad-terms");
    const m1C = roundCents(m);
    if (!(m1C > 0)) return fail("no-collateral");
    return { ok: true, m1C, binding, why: null };
  }

  function dividendsToExpiry({ spot, r, q, years }) {
    const S = numOrNull(spot), rr = numOrNull(r), qq = numOrNull(q), T = numOrNull(years);
    if (S === null || rr === null || qq === null || T === null || !(qq > 0) || !(T > 0) || !(S > 0)) return 0;
    return S * (Math.exp(rr * T) - Math.exp((rr - qq) * T));
  }

  function shortCallLine(row, { spot, delta = null, days, contracts = SC_DEFAULTS.contracts, convention = SC_DEFAULTS.convention, haircut = SC_DEFAULTS.haircut, floor = SC_DEFAULTS.floor, buyingPower = null } = {}) {
    const S = numOrNull(spot), K = numOrNull(row && row.strike), bid = numOrNull(row && row.bid);
    const base = { ok: false, why: null, binding: null, asked: contracts, n: null, bidC: null, tvC: null, intrC: null, m1C: null, regtM1C: null, ratio: null, grossRatio: null, annRatio: null, limited: false, affordable: false, premiumC: null, timeValueC: null, collateralC: null, deployedC: null, idleC: null, deltaShares: null, deltaDollarsC: null };
    if (S === null || K === null || !(S > 0) || !(K > 0)) return { ...base, why: "no-spot" };
    if (bid === null || !(bid > 0)) return { ...base, why: "no-bid" };
    const col = shortCallCollateral({ convention, spot: S, strike: K, delta, haircut, floor });
    const regt = shortCallCollateral({ convention: "regt", spot: S, strike: K });
    const bidC = Math.round(bid * 10000);
    const intrC = Math.round(Math.max(0, S - K) * 10000);
    const tvC = Math.max(0, bidC - intrC);
    const out = { ...base, bidC, intrC, tvC, regtM1C: regt.ok ? regt.m1C : null };
    if (!col.ok) return { ...out, why: col.why };
    const d = numOrNull(delta);
    const bpC = numOrNull(buyingPower) === null || !(buyingPower > 0) ? null : Math.round(buyingPower * 100);
    const n = bpC === null ? contracts : Math.min(contracts, Math.floor(bpC / col.m1C));
    const ratio = tvC / col.m1C;
    const dayN = numOrNull(days);
    return {
      ...out, ok: true, why: null, binding: col.binding, m1C: col.m1C, n,
      ratio, grossRatio: bidC / col.m1C, annRatio: dayN !== null && dayN >= 1 ? ratio * DAYS_PER_YEAR / dayN : null,
      limited: bpC !== null && n < contracts, affordable: n >= 1,
      premiumC: n * bidC, timeValueC: n * tvC, collateralC: n * col.m1C, deployedC: n * col.m1C, idleC: bpC === null ? null : bpC - n * col.m1C,
      deltaShares: d === null ? null : d * SHARES_PER_CONTRACT * contracts, deltaDollarsC: d === null ? null : roundCents(d * SHARES_PER_CONTRACT * S * contracts),
    };
  }

  function betterDeployment(a, b) {
    if (a.timeValueC !== b.timeValueC) return a.timeValueC > b.timeValueC;
    return a.deployedC < b.deployedC;
  }

  function planShortCalls(lines) {
    let best = null, affordable = 0;
    for (const l of lines) {
      if (!l || !l.ok || !l.affordable) continue;
      affordable++;
      if (l.timeValueC > 0 && (best === null || betterDeployment(l, best))) best = l;
    }
    return { best, affordable };
  }

  if (typeof document === "undefined") {
    globalThis.__FlowsDeskCallsTest = Object.freeze({ SC_DEFAULTS, SC_REG_T, SC_LIMITS, roundCents, parseContracts, parsePercent, shortCallCollateral, dividendsToExpiry, shortCallLine, planShortCalls });
    return;
  }

  const K = window.FlowsUI && window.FlowsUI.deskKit;
  if (!K) return;
  const { UI, h, s, F, glyph, DASH, MINUS, C, T, Q, isNum, fmt2, fmtPct, fmtInt, fmtSd, kf, colorOf, frontierOf, netDelta, mods, WIN_Q, WIN_P } = K;

  const SIGNS = { "-1": MINUS, "0": "", "1": "+" };
  const TONES = { "-1": "down", "0": null, "1": "up" };
  const CONV_LABEL = { delta: "Delta-adjusted", regt: "Reg-T style", shares: "Shares held (covered)" };
  const TICKS = [0, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
  const BIND_WORD = { delta: "delta", floor: "floor", "regt-otm": "20% rule", shares: "shares held" };
  const WHY_KEY = { "no-delta": "sc-no-delta", "no-spot": "sc-why-no-spot", "bad-delta": "sc-why-bad-delta", "no-collateral": "sc-why-no-collateral", "bad-terms": "sc-why-bad-terms", "no-bid": "sc-why-no-bid" };

  const DEFAULT_TERMS = Object.freeze({ n: SC_DEFAULTS.contracts, cv: SC_DEFAULTS.convention, h: SC_DEFAULTS.haircut, f: SC_DEFAULTS.floor });
  let terms = { ...DEFAULT_TERMS };

  const pctWord = (v) => String(+(v * 100).toFixed(2)) + "%";
  const groupN = (n) => Math.round(n).toLocaleString("en-US");
  const usdC = (c, dp = 0) => {
    if (c === null || c === undefined) return DASH;
    const d = c / 100;
    const text = dp ? Math.abs(d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(Math.abs(d)).toLocaleString("en-US");
    return (d < 0 && /[1-9]/.test(text) ? MINUS : "") + "$" + text;
  };
  const fmtRatio = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const p = n * 100;
    return (p >= 10 ? p.toFixed(1) : p.toFixed(2)) + "%";
  };
  const fmtAnn = (v) => {
    const n = isNum(v);
    if (n === null) return DASH;
    const p = n * 100;
    return p > 99999 ? "> 99,999%" : groupN(p) + "%";
  };
  const signedD = (v) => { const n = isNum(v); if (n === null) return DASH; const a = Math.abs(n).toFixed(2); return (Number(a) === 0 ? "" : SIGNS[Math.sign(n)]) + a; };

  const convText = () => (terms.cv === "delta" ? "Delta " + pctWord(terms.h) + " of notional, floor " + pctWord(terms.f) : terms.cv === "regt" ? "Reg-T style" : "shares held");
  const termsSummary = () => groupN(terms.n) + " × · " + (terms.cv === "delta" ? "Delta " + pctWord(terms.h) + " / floor " + pctWord(terms.f) : terms.cv === "regt" ? "Reg-T style" : "Shares held");
  const formulaText = () => {
    if (terms.cv === "regt") return "Collateral per contract = 100 × max(20% × spot − the amount the strike is above spot, 10% × spot)";
    if (terms.cv === "shares") return "Collateral per contract = 100 × spot";
    return "Collateral per contract = 100 × spot × max(" + pctWord(terms.h) + " × |delta|, " + pctWord(terms.f) + ")";
  };

  function readTerms() {
    try {
      const q = new URLSearchParams(location.search);
      const n = parseContracts(q.get("n"));
      const cv = q.get("cv");
      const hh = parsePercent(q.get("h"), SC_LIMITS.haircut);
      const ff = parsePercent(q.get("f"), SC_LIMITS.floor);
      terms = { n: n === null ? DEFAULT_TERMS.n : n, cv: SC_CONVENTIONS.includes(cv) ? cv : DEFAULT_TERMS.cv, h: hh === null ? DEFAULT_TERMS.h : hh, f: ff === null ? DEFAULT_TERMS.f : ff };
    } catch { terms = { ...DEFAULT_TERMS }; }
  }

  function writeTerms() {
    try {
      const url = new URL(location.href);
      const put = (k, v, d, text) => { if (v === d) url.searchParams.delete(k); else url.searchParams.set(k, text); };
      put("n", terms.n, DEFAULT_TERMS.n, String(terms.n));
      put("cv", terms.cv, DEFAULT_TERMS.cv, terms.cv);
      put("h", terms.h, DEFAULT_TERMS.h, String(+(terms.h * 100).toFixed(2)));
      put("f", terms.f, DEFAULT_TERMS.f, String(+(terms.f * 100).toFixed(2)));
      history.replaceState(null, "", url);
    } catch { return; }
  }

  const SC_ENGINE_LEGS = (r) => [{ type: "C", K: r.strike, side: -1, qty: 1 }];

  function engFor(r) {
    if (terms.cv === "shares") return r.__eng || null;
    if (r.__nk !== undefined) return r.__nk;
    r.__nk = null;
    if (r.__setup && Q) {
      try { r.__nk = Q.priceStructure(r.__setup, { family: "custom", fam: SC_FAM, expiry: r.expiry, legs: SC_ENGINE_LEGS(r), basis: "natural" }) || null; } catch { r.__nk = null; }
    }
    return r.__nk;
  }

  function annotate(rows, buyingPower) {
    for (const r of rows) {
      const eng = engFor(r);
      const leg = eng && Array.isArray(eng.legs) ? eng.legs.find((l) => l.type !== "S") : null;
      const delta = leg && isNum(leg.delta) !== null ? Math.abs(leg.delta) : null;
      const line = shortCallLine({ bid: r.bid, strike: r.strike }, { spot: r.__spot, delta, days: r.days, contracts: terms.n, convention: terms.cv, haircut: terms.h, floor: terms.f, buyingPower });
      const nd = eng ? netDelta(eng) : null;
      const carry = eng && eng.carry ? eng.carry : null;
      const div = carry ? dividendsToExpiry({ spot: r.__spot, r: carry.r, q: carry.q, years: eng.T }) : 0;
      const tvShare = line.tvC === null ? null : line.tvC / 10000;
      r.__sc = Object.assign(line, {
        delta, eng, spot: r.__spot, netDelta: nd, popQ: eng ? eng.prob.popQ : null, popP: eng ? eng.prob.popP : null,
        evN: eng && isNum(eng.ev.p) !== null && line.n !== null ? eng.ev.p * line.n : null,
        early: { div, tv: tvShare, watch: div > 0 && tvShare !== null && tvShare < div, deep: delta !== null && delta >= 0.9 },
      });
      r.__sizing = buyingPower !== null && line.ok
        ? { contracts: line.n, affordable: line.affordable, collectible: line.premiumC / 100, timeValue: line.timeValueC / 100, intrinsicValue: (line.premiumC - line.timeValueC) / 100, deployed: line.collateralC / 100, idle: line.idleC / 100, yieldOnDeployed: line.collateralC > 0 ? line.timeValueC / line.collateralC : null, timeValueC: line.timeValueC, deployedC: line.collateralC }
        : null;
    }
  }

  const KEYS = {
    annualized: (r) => (r.__sc ? r.__sc.annRatio : null),
    ratio: (r) => (r.__sc ? r.__sc.ratio : null),
    premium: (r) => r.premium,
    cushionSigmas: (r) => r.cushionSigmas,
    collectible: (r) => (r.__sc && r.__sc.ok && r.__sc.timeValueC !== null ? r.__sc.timeValueC : null),
    edge: (r) => (r.__sc ? r.__sc.evN : null),
  };
  const key = (rank) => KEYS[rank] || KEYS.annualized;

  const whyText = (c) => T(WHY_KEY[c] || "sc-no-delta");
  const xNet = (r) => {
    const sc = r.__sc;
    return sc && sc.netDelta !== null ? Math.abs(sc.netDelta) : null;
  };
  const xOf = (axis) => (axis === 0 ? xNet : (r) => (r.__sc ? r.__sc.popQ : null));
  const yOf = (r) => (r.__sc && r.__sc.ok ? r.__sc.annRatio : null);

  const collateralSub = (sc) => {
    if (!sc.ok) return "";
    if (terms.cv === "shares") return groupN(100 * sc.n) + " shares";
    if (terms.cv === "regt") return sc.binding === "regt-otm" ? "20% rule" : "10% floor";
    return sc.binding === "delta" ? "delta " + sc.delta.toFixed(2) + " × " + pctWord(terms.h) : pctWord(terms.f) + " floor";
  };

  function head() {
    return h("div", { class: "dk-head", "aria-hidden": "true" }, ["", "Line", "Premium ÷ collateral", "Ann.", "Premium", "Collateral", "Net Δ", WIN_Q, "EV", ""].map((x) => h("span", null, x)));
  }

  function cellOf(cls, label, text, tone, title, sub) {
    return h("span", { class: "dk-c " + cls, "data-tone": tone || null, title: title || null }, h("small", null, label), text, sub ? h("em", { class: "dk-sub" }, sub) : null);
  }

  function rowFor(r, i) {
    const sc = r.__sc || { ok: false, why: "no-delta" };
    const st = K.st();
    const m = isNum(r.moneyness);
    const atm = m !== null && Math.abs(m) < 5e-5;
    const away = m === null ? "" : atm ? "at the money" : fmtPct(Math.abs(m), 1) + " " + (m > 0 ? "OTM" : "ITM");
    const earn = r.crossesEarnings === true ? "crosses" : r.crossesEarnings === null ? "unknown" : "clear";
    const bad = sc.ok ? null : whyText(sc.why);
    const noEng = sc.eng ? null : r.__why || T("sc-no-delta");
    const ev = sc.ok ? sc.evN : null;
    const premium = sc.premiumC === null ? cellOf("dk-prem", "Premium", DASH, "silent", bad || T("sc-premium"))
      : sc.n === 0 ? cellOf("dk-prem is-unaffordable", "Premium", "$0", "silent", T("col-no", { c: usdC(sc.m1C), b: K.fmtMoney(st.buyingPower) }), sc.limited ? "limited by buying power" : null)
        : cellOf("dk-prem", "Premium", usdC(sc.premiumC), "up", T("sc-premium"), sc.limited ? sc.n + " × of " + sc.asked + " · limited by buying power" : groupN(sc.n) + " × · bid " + fmt2(r.bid));
    const collat = sc.ok ? cellOf("dk-collat", "Collateral", usdC(sc.collateralC), null, T("t-collat"), collateralSub(sc)) : cellOf("dk-collat", "Collateral", DASH, "silent", bad);
    const nd = sc.netDelta;
    return h("div", {
      class: "dk-row" + (K.isItm(r) ? " is-itm" : ""), role: "listitem", "data-t": r.ticker, "data-strike": String(r.strike), "data-strategy": "sc", "data-expiry": r.expiry, "data-days": String(r.days), "data-i": String(i),
      "data-n": sc.ok ? String(sc.n) : null, "data-m1": sc.ok ? String(sc.m1C) : null, "data-bind": sc.ok ? sc.binding : null, "data-ratio": sc.ok ? sc.ratio.toFixed(6) : null,
      "data-earn": earn, "data-away": away,
      onpointerenter: () => K.focusPoint(r), onpointerleave: () => K.focusPoint(null),
    },
    h("span", { class: "ui-badge", "data-tone": "down", "aria-label": "Short call" }, "C"),
    h("span", { class: "dk-main" },
      h("a", { class: "dk-t", href: "/flows/ticker/?t=" + encodeURIComponent(r.ticker), title: T("t-link", { t: r.ticker }) }, r.ticker),
      h("a", { class: "dk-k", href: labHref(r), "aria-label": T("lab-a", { t: r.ticker, k: kf(r.strike), w: terms.cv === "shares" ? "covered call" : "uncovered short call", e: r.expiry }) }, h("b", null, kf(r.strike)), h("span", null, "call")),
      earn === "clear" ? null : h("span", { class: "dk-earn" + (earn === "unknown" ? " is-unknown" : ""), role: "img", "aria-label": T("earn-" + earn), title: T("earn-" + earn) }, glyph(earn === "crosses" ? "cal" : "pending")),
      h("span", { class: "dk-meta" }, F.day(r.expiry) + " · " + r.days + "d" + (away ? " · " + away : ""))),
    h("span", { class: "dk-cells" },
      sc.ok ? cellOf("dk-ratio", "Ratio", fmtRatio(sc.ratio), null, T("t-ratio")) : cellOf("dk-ratio", "Ratio", DASH, "silent", bad),
      sc.ok ? cellOf("dk-ann", "Ann.", fmtAnn(sc.annRatio), null, T("t-ann")) : cellOf("dk-ann", "Ann.", DASH, "silent", bad),
      premium, collat,
      cellOf("dk-nd", "Net Δ", signedD(nd), null, nd === null ? noEng : T("sc-frontier-x")),
      cellOf("dk-pq", WIN_Q, sc.popQ === null || sc.popQ === undefined ? DASH : fmtPct(sc.popQ, 0), null, noEng || T("t-pq")),
      cellOf("dk-ev", "EV", ev === null ? DASH : K.usd(ev), ev === null ? "silent" : TONES[Math.sign(ev)], noEng || T("t-ev"))),
    UI.infoButton(r.ticker + " " + kf(r.strike) + " call", () => rowInfo(r), { small: true }));
  }

  function labHref(r) {
    if (terms.cv === "shares") return K.labHref(r);
    return "/flows/strategy/?t=" + encodeURIComponent(r.ticker) + "&s=custom&expiry=" + r.expiry + "&basis=natural&legs=" + encodeURIComponent(r.symbol + "@-1");
  }

  function rowInfo(r) {
    const sc = r.__sc || {};
    const e = sc.eng, S = isNum(r.__spot), m = isNum(r.moneyness), fit = r.__fit;
    const mid = isNum(r.mid), bid = isNum(r.bid), ask = isNum(r.ask);
    const n = sc.n === null || sc.n === undefined ? terms.n : sc.n;
    const money = (c, dp) => usdC(c, dp);
    const collateralLine = () => {
      if (!sc.ok) return sc.why ? whyText(sc.why) : DASH;
      if (terms.cv === "shares") return money(sc.collateralC) + " of stock for " + groupN(n) + " contract" + (n === 1 ? "" : "s") + ": 100 × " + fmt2(S) + " each; shares assumed held, not bought";
      if (terms.cv === "regt") return money(sc.collateralC) + " on " + groupN(n) + " (" + money(sc.m1C, 2) + " each): 100 × max(20% × " + fmt2(S) + " − " + fmt2(Math.max(0, r.strike - S)) + ", 10% × " + fmt2(S) + ") = " + BIND_WORD[sc.binding === "regt-otm" ? "regt-otm" : "floor"] + " bound";
      return money(sc.collateralC) + " on " + groupN(n) + " (" + money(sc.m1C, 2) + " each): 100 × " + fmt2(S) + " × max(" + pctWord(terms.h) + " × " + sc.delta.toFixed(4) + ", " + pctWord(terms.f) + ") = " + (sc.binding === "delta" ? "delta-bound" : "floor-bound");
    };
    const lab = sc.ok && sc.bidC !== null ? usdC(sc.bidC) : DASH;
    const early = sc.early || {};
    const earlyLines = [];
    if (early.watch) earlyLines.push(T("sc-early", { tv: "$" + fmt2(early.tv), div: "$" + fmt2(early.div) }));
    if (early.deep) earlyLines.push(T("sc-itm-deep"));
    const sh = sc.intrC > 0 ? { intrinsic: sc.intrC / 10000, timeValue: sc.tvC / 10000 } : { intrinsic: 0, timeValue: 0 };
    return {
      title: r.ticker + " " + kf(r.strike) + " " + (terms.cv === "shares" ? "covered call" : "uncovered short call"), asOf: F.day(r.expiry) + " · " + r.days + "d",
      lead: T("engine"),
      facts: [
        ["Premium", sc.premiumC === null ? DASH : money(sc.premiumC) + " on " + groupN(n) + " contract" + (n === 1 ? "" : "s") + " sold into the " + fmt2(bid) + " bid (" + lab + " each); mid " + fmt2(mid) + " is not used for any figure, half-spread " + fmt2(bid === null || ask === null ? null : (ask - bid) / 2)],
        ["Collateral", collateralLine()],
        ["Reg-T style", sc.regtM1C === null || sc.regtM1C === undefined ? DASH : money(sc.regtM1C * n) + " on " + groupN(n) + ": 100 × max(20% × " + fmt2(S) + " − " + fmt2(Math.max(0, r.strike - S)) + ", 10% × " + fmt2(S) + "). The strategy lab adds the option's value (" + lab + ") to this requirement; this desk nets it against the premium you collect."],
        ["Shares held", S === null ? DASH : "$" + groupN(S * SHARES_PER_CONTRACT * n) + " of stock for " + groupN(n) + " contract" + (n === 1 ? "" : "s")],
        ["Premium ÷ collateral", sc.ok ? fmtRatio(sc.ratio) + " per trade, " + fmtAnn(sc.annRatio) + " annualised over " + r.days + " days, time value only (gross " + fmtRatio(sc.grossRatio) + ")" : DASH],
        ["Net delta", sc.netDelta === null || sc.netDelta === undefined ? DASH : signedD(sc.netDelta) + (terms.cv === "shares" ? "" : " · short " + groupN(sc.deltaShares || 0) + " shares-equivalent on " + groupN(terms.n) + " contracts") + " · forward delta on the card's smile, which can only over-state collateral on a dividend payer"],
        ["Forward", K.forwardText(r)],
        ["Delta-equivalent exposure", sc.deltaDollarsC === null || sc.deltaDollarsC === undefined ? DASH : money(sc.deltaDollarsC)],
        ["Distance", m === null ? DASH : Math.abs(m) < 5e-5 ? "at the money" : fmtPct(Math.abs(m), 1) + " " + (m < 0 ? "below" : "above") + " spot" + (S === null ? "" : " of " + fmt2(S))],
        ["Cushion", fmtSd(r.cushionSigmas)],
        ["Chance of profit", e ? fmtPct(e.prob.popQ, 1) + " implied · " + (e.prob.popP === null ? DASH : fmtPct(e.prob.popP, 1)) + " real world" : DASH],
        ["Expected value", e ? K.usd(e.ev.q) + " implied · " + (e.ev.p === null ? DASH : K.usd(e.ev.p)) + " real world, per contract; " + (sc.evN === null || sc.evN === undefined ? DASH : K.usd(sc.evN)) + " on " + groupN(n) : DASH],
        ["Early exercise", earlyLines.length ? earlyLines.join(" ") : "No dividend flag from the card."],
        ["Assignment", T("sc-assign")],
        ["Grade", e ? e.grade + " of 3" + (e.gradeWhy.length ? " · " + e.gradeWhy.map(K.whyText).join(" ") : "") : DASH],
        ["Smile", fit ? T(fit.origin === "card-shape" ? "fit-shape" : "fit-flat", { from: fit.shapeFrom }) : null],
        ["Carry", e ? T("carry", { r: fmtPct(e.carry.r, 2), how: K.rateHow(e.carry.rateMethod), q: fmtPct(e.carry.q, 2) }) : null],
      ],
      notes: [sh.intrinsic > 0 ? T("int-in", { i: usdC(Math.round(sh.intrinsic * 1e6) / 100), t: usdC(Math.round(sh.timeValue * 1e6) / 100) }) : null, T("sc-leaves-out"), T("annualized"), T("t-ratio"), T("refuse")],
    };
  }

  function renderPlan(rows) {
    const st = K.st();
    const plan = mods.plan, bp = st.buyingPower;
    mods.best.replaceChildren();
    const lines = rows.filter((r) => r.__sc && r.__sc.ok);
    const uncovered = terms.cv === "shares" ? null : h("p", { class: "dk-hint dk-uncovered" }, T("sc-uncovered"));
    if (bp === null || !rows.length) {
      const top = lines[0];
      if (!top) { plan.hidden = true; plan.replaceChildren(); mods.best.append(h("p", { class: "dk-hint" }, rows.length ? "" : T(st.bpBad ? "bp-bad" : "bp-ask")), uncovered); return; }
      const z = top.__sc;
      plan.hidden = false;
      plan.className = "dk-plan";
      plan.dataset.plan = "";
      plan.replaceChildren(
        h("div", { class: "dk-plan-h" }, h("span", null, "Top line"), UI.infoButton("the top line", () => ({ title: "Top line", lead: T("sc-premium") }), { small: true })),
        h("div", { class: "dk-plan-v" }, h("b", null, groupN(z.n) + "× " + top.ticker + " " + kf(top.strike) + " call"), h("span", null, F.day(top.expiry))),
        UI.metrics([UI.metric("Earns", usdC(z.timeValueC), { tone: "up" }), UI.metric("Needs", usdC(z.collateralC)), UI.metric("Ratio", fmtRatio(z.ratio))], { min: 76 }),
        h("p", { class: "dk-hint" }, T("sc-bp-ask")),
        z.premiumC > z.timeValueC ? h("p", { class: "dk-hint dk-itm" }, T("plan-itm", { x: usdC(z.premiumC - z.timeValueC), t: usdC(z.timeValueC) })) : null);
      mods.best.append(uncovered);
      return;
    }
    const { best, affordable } = planShortCalls(lines.map((r) => r.__sc));
    const bestRow = best ? lines.find((r) => r.__sc === best) : null;
    plan.hidden = false;
    let sentence;
    if (!bestRow) {
      const cheapest = lines.reduce((c, r) => (c === null || r.__sc.m1C < c ? r.__sc.m1C : c), null);
      sentence = affordable === 0
        ? T("plan-no", { bp: K.fmtMoney(bp) }) + (cheapest === null ? "" : " " + T("plan-min", { c: usdC(cheapest) }))
        : T("plan-tv0", { bp: K.fmtMoney(bp), a: affordable });
      plan.className = "dk-plan is-empty";
      plan.replaceChildren(UI.metrics([UI.metric("Best line", DASH, { state: { state: "quiet", reason: sentence } })]));
    } else {
      const z = bestRow.__sc;
      sentence = T("sc-plan", { bp: K.fmtMoney(bp), a: affordable, m: lines.length, n: z.n, t: bestRow.ticker, k: fmt2(bestRow.strike), e: bestRow.expiry, c: usdC(z.timeValueC), d: usdC(z.collateralC), i: usdC(z.idleC), conv: convText(), N: groupN(terms.n) });
      plan.className = "dk-plan";
      plan.replaceChildren(
        h("div", { class: "dk-plan-h" }, h("span", null, "Best deployment"), UI.infoButton("the best deployment", () => ({ title: "Best deployment", lead: sentence }), { small: true })),
        h("div", { class: "dk-plan-v" }, h("b", null, z.n + "× " + bestRow.ticker + " " + kf(bestRow.strike) + " call"), h("span", null, F.day(bestRow.expiry))),
        UI.metrics([UI.metric("Earns", usdC(z.timeValueC), { tone: "up" }), UI.metric("Deploys", usdC(z.collateralC)), UI.metric("Idle", usdC(z.idleC))], { min: 76 }),
        UI.split([{ color: "--accent", value: z.collateralC / (bp * 100) }, { color: "--fill-2", value: z.idleC / (bp * 100) }], "Deploys " + usdC(z.collateralC) + " of " + K.fmtMoney(bp) + ", " + usdC(z.idleC) + " idle"),
        h("p", { class: "dk-hint" }, affordable + " of " + lines.length + " lines affordable" + (z.limited ? " · Limited by buying power: " + z.n + " of " + z.asked : "")),
        z.premiumC > z.timeValueC ? h("p", { class: "dk-hint dk-itm" }, T("plan-itm", { x: usdC(z.premiumC - z.timeValueC), t: usdC(z.timeValueC) })) : null);
      const next = lines.filter((r) => r !== bestRow && r.__sc.affordable && r.__sc.timeValueC > 0).sort((a, b) => (betterDeployment(a.__sc, b.__sc) ? -1 : betterDeployment(b.__sc, a.__sc) ? 1 : 0)).slice(0, 2);
      if (next.length) {
        mods.best.append(h("div", { class: "dk-alts", role: "list", "aria-label": "Next best deployments" }, h("span", { class: "dk-alts-h" }, "Next best"),
          next.map((r) => h("div", { class: "dk-alt", role: "listitem" }, h("span", null, r.__sc.n + "× " + r.ticker + " " + kf(r.strike) + " call"), h("span", { class: "dk-alt-d" }, F.day(r.expiry)), h("b", null, usdC(r.__sc.timeValueC))))));
      }
    }
    mods.best.append(uncovered);
    plan.dataset.plan = sentence;
  }

  function drawScatter(host, w, animate) {
    const st = K.st();
    const view = st.view, axis = st.axis, focused = st.focused;
    const rows = (view.shown || []).filter((r) => r.__sc);
    const phone = w < 600;
    const H = K.chartHeight(w);
    mods.legend.replaceChildren();
    if (!rows.length) { K.emptyFrontier(host, H, phone); return; }
    const xf = xOf(axis);
    const pts = rows.map((r) => ({ r, x: xf(r), y: yOf(r) })).filter((p) => p.x !== null && p.y !== null);
    const noDelta = terms.cv === "delta" && rows.every((r) => r.__sc.why === "no-delta");
    if (!pts.length) {
      host.append(UI.silent({ state: "withheld", reason: noDelta ? T("sc-no-delta-all") : T("fr-none") }, "Frontier", H));
      if (noDelta) mods.legend.replaceChildren(h("p", { class: "dk-hint" }, T("sc-no-delta-all")));
      return;
    }
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    const p95 = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.95))];
    const cap = Math.max(0.05, Math.min(ys[ys.length - 1], p95 * 8) * 1.04);
    const left = 54, right = 16, top = 24, bottom = 26;
    const x0 = axis === 0 ? 0 : Math.max(0, Math.min(...pts.map((p) => p.x)) - 0.03);
    const x1 = axis === 0 ? Math.min(1, Math.max(0.1, Math.max(...pts.map((p) => p.x)) * 1.08)) : 1;
    const x = C.lin(x0, x1, left, w - right), yl = C.lin(0, Math.sqrt(cap), H - bottom, top);
    const y = (v) => yl(Math.sqrt(Math.max(0, v)));
    const quick = !!st.quick;
    const box = h("div", { class: "tl-scrub" });
    host.append(box);
    const svg = C.svgRoot(box, w, H, animate && !quick, T("sc-fr-aria", { x: axis === 0 ? "net delta, short call magnitude" : "the implied chance of profit", n: pts.length, conv: CONV_LABEL[terms.cv] }));
    s("line", { x1: left, x2: w - right, y1: H - bottom, y2: H - bottom, class: "base" }, svg);
    let lastY = Infinity;
    for (const t of TICKS) {
      if (t > cap || lastY - y(t) < 40) continue;
      lastY = y(t);
      s("text", { x: left - 8, y: y(t) + 4, text: groupN(t * 100) + "%", "text-anchor": "end" }, svg);
    }
    s("text", { x: 2, y: 11, text: "Ann. premium ÷ collateral, square-root scale", class: "tx-3" }, svg);
    for (const t of C.niceTicks(x0, x1, phone ? 4 : 6)) {
      if (x(t) < left + 8 || x(t) > w - right - 8) continue;
      s("text", { x: x(t), y: H - 7, text: axis === 0 ? t.toFixed(2).replace(/^0/, "") : Math.round(t * 100) + "%", "text-anchor": "middle" }, svg);
    }
    s("text", { x: w - right, y: H - bottom - 6, text: axis === 0 ? (terms.cv === "shares" ? "Net delta" : "Net delta, short (magnitude)") : WIN_Q, "text-anchor": "end", class: "tx-3" }, svg);
    const guide = terms.f / terms.h;
    if (axis === 0 && terms.cv === "delta" && guide > 0 && guide < x1) {
      s("line", { x1: x(guide), x2: x(guide), y1: top, y2: H - bottom, class: "dk-floor", "data-at": String(guide) }, svg);
      s("text", { x: x(guide) + 4, y: top + 10, text: "Floor ends", class: "tx-3 dk-floor-l" }, svg);
    }
    const fr = frontierOf(pts, axis === 1);
    const frSet = new Set(fr);
    if (fr.length > 1) {
      const P = fr.map((p) => [x(p.x), y(Math.min(p.y, cap))]);
      const inScale = fr.findIndex((p) => p.y > cap);
      const cut = inScale < 0 ? P.length : Math.max(1, inScale);
      s("path", { d: C.pathOf(P.slice(0, cut)), class: "ln dk-front" + (animate && !quick ? " draw" : ""), pathLength: 1 }, svg);
      if (cut < P.length) s("path", { d: C.pathOf(P.slice(cut - 1)), class: "ln dk-front is-off" }, svg);
    }
    const syms = [...new Set(pts.map((p) => p.r.__sym))];
    const g = s("g", { class: animate && !quick ? "fade" : null }, svg);
    for (const p of pts) {
      const over = p.y > cap;
      const cx = x(p.x), cy = y(over ? cap : p.y);
      const col = UI.cssVar(colorOf(p.r.__sym));
      const on = focused === p.r;
      const flo = p.r.__sc.binding === "floor";
      const mk = over ? "tri" : flo ? "dia" : "dot";
      const n = C.marker(g, mk, cx, cy, col, on ? 5.5 : frSet.has(p) ? 4.2 : 3.2);
      n.setAttribute("fill-opacity", frSet.has(p) || on ? "1" : "0.55");
      n.setAttribute("data-bind", p.r.__sc.binding);
      if (frSet.has(p)) C.marker(g, "ring", cx, cy, UI.cssVar("--label-1"), 7);
    }
    const order = pts.slice().sort((a, b) => a.x - b.x);
    const at = focused ? order.findIndex((q) => q.r === focused) : -1;
    if (at >= 0) box._scrubAt = at;
    C.scrub(box, svg, {
      xs: order.map((p) => x(p.x)), ys: order.map((p) => y(Math.min(p.y, cap))), reach: 30, first: true, xh: 0, top, bottom: H - bottom, label: T("fr-key"),
      onMove: (i) => {
        const p = order[i], r = p.r, sc = r.__sc;
        return {
          noLine: true, top: Math.max(0, y(Math.min(p.y, cap)) - 40), say: r.ticker + " " + kf(r.strike) + ", " + fmtAnn(sc.annRatio) + " annualised premium over collateral",
          parts: [C.part(r.ticker + " " + kf(r.strike) + " call", null), C.part(F.day(r.expiry), "k"), C.part(fmtRatio(sc.ratio) + " per trade", "k"),
            h("b", null, fmtAnn(sc.annRatio)), C.part(axis === 0 ? "Net Δ " + signedD(sc.netDelta) : "Win " + fmtPct(p.x, 0), "k")],
        };
      },
    });
    box.setAttribute("aria-label", T("fr-key"));
    const floorKeys = terms.cv === "regt" ? [["--label-2", "dot", "20% rule sets collateral"], ["--label-2", "dia", "10% floor sets collateral"]]
      : terms.cv === "shares" ? [] : [["--label-2", "dot", "Delta sets collateral"], ["--label-2", "dia", "Floor sets collateral"]];
    const unplotted = rows.length - pts.length;
    mods.legend.replaceChildren(
      UI.legend([...syms.map((sym) => [colorOf(sym), "dot", sym]), ...floorKeys, ["--label-1", "ln", "Frontier"]]),
      h("p", { class: "dk-assume" }, groupN(terms.n) + " contracts · collateral: " + convText() + " · premium = the bid"),
      ...(noDelta ? [h("p", { class: "dk-hint" }, T("sc-no-delta-all"))] : []),
      ...(unplotted > 0 ? [h("p", { class: "dk-hint" }, T("unplotted", { n: unplotted }))] : []));
  }

  const EXPORT_COLS = [
    { label: "Ticker", get: (r) => r.ticker },
    { label: "Structure", get: () => (terms.cv === "shares" ? "covered call, shares held" : "short call, uncovered") },
    { label: "Expiry", get: (r) => r.expiry },
    { label: "Chain session", get: (r) => r.__day },
    { label: "Days to expiry", get: (r) => isNum(r.days) },
    { label: "Strike", unit: "USD", get: (r) => isNum(r.strike) },
    { label: "Contracts used", unit: "contracts", get: (r) => (r.__sc && r.__sc.ok ? r.__sc.n : null) },
    { label: "Collateral per contract", unit: "USD", get: (r) => (r.__sc && r.__sc.ok ? r.__sc.m1C / 100 : null) },
    { label: "Collateral on contracts used", unit: "USD", get: (r) => (r.__sc && r.__sc.ok ? r.__sc.collateralC / 100 : null) },
    { label: "Collateral convention", get: () => CONV_LABEL[terms.cv] },
    { label: "Haircut", unit: "fraction", get: () => (terms.cv === "delta" ? terms.h : null) },
    { label: "Floor", unit: "fraction", get: () => (terms.cv === "delta" ? terms.f : null) },
    { label: "Premium ÷ collateral", unit: "fraction", get: (r) => (r.__sc && r.__sc.ok ? r.__sc.ratio : null) },
    { label: "Annualised premium ÷ collateral", unit: "fraction", get: (r) => (r.__sc && r.__sc.ok ? r.__sc.annRatio : null) },
    { label: "Net delta", unit: "delta", get: (r) => (r.__sc ? r.__sc.netDelta : null) },
    { label: "Win probability (implied)", unit: "fraction", get: (r) => (r.__sc ? r.__sc.popQ : null) },
    { label: "Win probability (real-world)", unit: "fraction", get: (r) => (r.__sc ? r.__sc.popP : null) },
    { label: "Expected value on contracts used", unit: "USD", get: (r) => (r.__sc && r.__sc.ok ? r.__sc.evN : null) },
    { label: "Reg-T style collateral per contract", unit: "USD", get: (r) => (r.__sc && r.__sc.regtM1C !== null && r.__sc.regtM1C !== undefined ? r.__sc.regtM1C / 100 : null) },
  ];

  function exportSpec(view) {
    const rows = view.shown || [];
    const days = [...new Set(rows.map((r) => r.__day).filter(Boolean))];
    return { name: "flows-desk-short-calls", source: "anilkaya.org Flows desk, own model outputs; collateral is the stated convention, not a broker figure", asOf: days.length === 1 ? days[0] : null, rows, cols: EXPORT_COLS };
  }

  function frontierInfo() {
    const conv = terms.cv === "delta" ? T("sc-delta", { h: pctWord(terms.h), f: pctWord(terms.f) }) : terms.cv === "regt" ? T("sc-regt") : T("sc-shares");
    return { title: "Frontier", lead: T("sc-frontier"), sections: [{ title: "Axes", lines: [T("sc-frontier-x")] }, { title: "Collateral", lines: [conv, T("sc-contracts")] }, { title: "Engine", lines: [T("engine")] }], notes: [T("sc-leaves-out"), T("sc-slice"), T("refuse")] };
  }
  function linesInfo(foot) {
    return { title: "Lines", lead: T("sc-premium"), sections: [{ title: "What is on this list", lines: [foot] }, { title: "Engine", lines: [T("engine")] }], notes: [T("annualized"), T("sc-slice"), T("refuse")] };
  }

  let pill = null, dialog = null, ui = null;

  function commit() {
    writeTerms();
    if (pill) pill.textContent = termsSummary();
    if (ui) refreshDialog();
    K.render();
  }

  function setError(input, msg, bad) {
    input.setAttribute("aria-invalid", bad ? "true" : "false");
    const e = document.getElementById(input.id + "Err");
    if (e) e.textContent = bad ? msg : "";
  }

  function refreshDialog() {
    ui.n.value = ui.n.dataset.dirty === "1" ? ui.n.value : groupN(terms.n);
    ui.hint.textContent = "× 100 shares = " + groupN(terms.n * 100) + " shares";
    ui.radios.forEach((r) => { r.checked = r.value === terms.cv; });
    ui.h.disabled = ui.f.disabled = terms.cv !== "delta";
    if (ui.h.dataset.dirty !== "1") ui.h.value = String(+(terms.h * 100).toFixed(2));
    if (ui.f.dataset.dirty !== "1") ui.f.value = String(+(terms.f * 100).toFixed(2));
    ui.formula.textContent = formulaText();
  }

  function buildDialog() {
    const field = (id, label, hintId) => {
      const input = h("input", { id, type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "aria-describedby": id + "Err" + (hintId ? " " + hintId : "") });
      return { input, node: h("div", { class: "dk-sc-f" }, h("label", { for: id }, label), input, h("p", { class: "dk-sc-err", id: id + "Err", role: "alert" })) };
    };
    const n = field("dkScN", "Contracts sold", "dkScNh"), hh = field("dkScH", "Haircut on delta-adjusted notional, %"), ff = field("dkScF", "Floor, % of notional");
    const hint = h("p", { class: "dk-sc-hint", id: "dkScNh" });
    const radios = SC_CONVENTIONS.map((v) => {
      const r = h("input", { type: "radio", name: "dkScCv", value: v, id: "dkScCv-" + v });
      r.addEventListener("change", () => { if (r.checked) { terms = { ...terms, cv: v }; commit(); } });
      return r;
    });
    const formula = h("p", { class: "dk-sc-formula", id: "dkScFormula", "aria-live": "polite" });
    const reset = h("button", { type: "button", class: "dk-pill", id: "dkScReset" }, "Reset to defaults");
    const done = h("button", { type: "button", class: "dk-pill dk-pill-main", id: "dkScDone" }, "Done");
    const text = (input, parse, limits, key, msg) => {
      input.addEventListener("input", () => {
        input.dataset.dirty = "1";
        const v = parse(input.value, limits);
        if (v === null) { setError(input, msg, true); return; }
        setError(input, "", false);
        terms = { ...terms, [key]: v };
        commit();
      });
      input.addEventListener("blur", () => { input.dataset.dirty = "0"; refreshDialog(); setError(input, "", false); });
    };
    text(n.input, parseContracts, null, "n", T("sc-nobad"));
    text(hh.input, parsePercent, SC_LIMITS.haircut, "h", "Haircut must be from 5% to 100%.");
    text(ff.input, parsePercent, SC_LIMITS.floor, "f", "Floor must be from 0% to 50%.");
    reset.addEventListener("click", () => {
      terms = { ...DEFAULT_TERMS };
      for (const i of [n.input, hh.input, ff.input]) { i.dataset.dirty = "0"; setError(i, "", false); }
      commit();
    });
    const dlg = h("dialog", { class: "dk-sc-dialog", id: "dkScDialog", "aria-labelledby": "dkScTitle" },
      h("div", { class: "dk-sc-body" },
        h("h2", { id: "dkScTitle" }, "Short-call terms"),
        n.node, hint,
        h("p", { class: "dk-sc-note" }, T("sc-contracts")),
        h("fieldset", { class: "dk-sc-cv", role: "radiogroup" }, h("legend", null, "Collateral convention"),
          SC_CONVENTIONS.map((v, i) => h("label", { for: "dkScCv-" + v }, radios[i], h("span", null, CONV_LABEL[v])))),
        h("div", { class: "dk-sc-pair" }, hh.node, ff.node),
        formula,
        h("div", { class: "dk-sc-act" }, reset, done)));
    done.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => { if (pill) pill.focus(); });
    dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
    ui = { n: n.input, h: hh.input, f: ff.input, hint, radios, formula };
    document.body.append(dlg);
    return dlg;
  }

  function sync(side) {
    if (!pill) return;
    pill.hidden = side !== "sc";
    pill.textContent = termsSummary();
  }

  function attach() {
    readTerms();
    pill = h("button", { type: "button", class: "dk-pill dk-terms", id: "dkTerms", "aria-haspopup": "dialog", title: "Contracts sold and the collateral convention" }, termsSummary());
    dialog = buildDialog();
    refreshDialog();
    pill.addEventListener("click", () => { refreshDialog(); if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", ""); });
    K.addFilter(pill);
    pill.hidden = K.st().side !== "sc";
  }

  attach();
  const api = Object.freeze({
    terms: () => ({ ...terms }), annotate, key, head, rowFor, renderPlan, drawScatter, exportSpec, frontierInfo, linesInfo, sync, labHref,
    fmt: Object.freeze({ ratio: fmtRatio, ann: fmtAnn, usdC }),
  });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { deskCalls: api }));
  K.attached();
})();
