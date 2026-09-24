(function () {
  "use strict";

  const UI = window.FlowsUI;
  const heroEl = document.getElementById("ftHero");
  if (!UI || !heroEl) return;

  const { h, s, F, glyph, num, clamp, tone, cap, cssVar } = UI;
  const C = UI.chart;
  const DASH = UI.DASH, MINUS = UI.MINUS, SEP = " " + UI.MID + " ";
  const $ = (id) => document.getElementById(id);
  const statusEl = $("ftStatus");
  const gridEl = $("ftGrid");
  const verdictEl = $("ftVerdict");
  const pickerEl = $("ftPicker");
  const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
  const isoOk = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
  const day = (d) => F.day(d);
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const sgn = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
  const K = (k) => (num(k) === null ? DASH : Number.isInteger(k) ? String(k) : Math.abs(k * 10 - Math.round(k * 10)) < 1e-6 ? k.toFixed(1) : k.toFixed(2));
  const ratioP = (v, dp = 0) => (num(v) === null ? DASH : (v * 100).toFixed(dp) + "%");
  const sentence = (t) => { const x = str(t); return x ? cap(x) : null; };
  const firstSentence = (t) => (typeof t === "string" ? (t.match(/^.*?[.!?](\s|$)/) || [t])[0].trim() : "");
  function headline(t) {
    const one = firstSentence(t);
    if (one.length <= 120) return [one, one.length];
    const m = one.slice(24).search(/[;:]\s|\s[–—]\s/);
    return m < 0 ? [one, one.length] : [one.slice(0, 24 + m).trim() + ".", 24 + m + 1];
  }
  const STALE_LEAD = "This card describes an earlier session than the last closed one, so every grade is capped at weak.";
  const typo = (t) => String(t).replace(/(^|[\s(])-(?=\d)/g, "$1" + MINUS);
  const chipDash = (state) => h("span", { class: "ft-cdash" }, DASH, glyph((UI.STATES[state] || UI.STATES.unavailable).g));
  const dayDiff = (a, b) => Math.round((Date.parse(b.slice(0, 10) + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / 864e5);
  const dirTone = (d) => (/^(bull|bullish|up|long)$/i.test(String(d || "")) ? "up" : /^(bear|bearish|down|short)$/i.test(String(d || "")) ? "down" : "flat");
  const dirWord = (t) => (t === "up" ? "Bullish" : t === "down" ? "Bearish" : "Neutral");
  const famWord = (f) => { const t = String(f || "").replace(/-/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : DASH; };

  const STATE = {
    ticker: null, card: null, cardX: null, hist: null, tape: null, neuron: null, quote: null, phase: null,
    meta: null, first: true, hb: null, pxShown: null, beats: 0,
  };

  const ST = (state, reason) => ({ state, reason: reason || null });
  const OK = ST("ok");
  const isIndex = (card) => !!card && card.depth === "index";
  const offIndex = (card, sec) => isIndex(card) && sec == null;
  const stOf = (p, what) => UI.stateOf(p, what);
  const PRE = {
    ivSurface: "the option chain leg", skewTerm: "the option chain leg", topContracts: "the option chain leg", aggressor: "the option chain leg",
    darkpool: "the per-name deep feeds", oiDeltas: "the per-name deep feeds", volContext: "the per-name deep feeds",
    marketRank: "the market-wide join", variation: "the hedging stage", scoreOverlay: "the score overlay", premiumTrack: "the score overlay",
    congress: "the congress read", calendar: "the gamma roll-off", surface: "the gamma surface", vanna: "the second-order greeks",
    charm: "the second-order greeks", deltaExposure: "the second-order greeks", displacement: "the displacement read", pricedMove: "the priced move",
  };
  function panelSt(card, key, what) {
    const P = (card && card.panels) || {};
    if (!Object.prototype.hasOwnProperty.call(P, key)) {
      const wave = PRE[key];
      return ST("unavailable", wave ? "This card was built before " + wave + " shipped, so it carries no " + (what || key) + "." : "The card carries no " + (what || key) + " for this name.");
    }
    return stOf(P[key], what);
  }
  const xSt = (sec, what) => {
    if (!STATE.cardX || STATE.cardX.status === "pending") return ST("pending", "The " + what + " is published with the next post-close run; this name's extended dossier has not landed yet.");
    if (!sec || typeof sec !== "object") return ST("unavailable", "This name's dossier carries no " + what + ".");
    const why = STATE.cardX.why || {};
    const code = sec.why || sec.code || sec.reason || null;
    const said = code && why[code] ? why[code] : code && FLOW_CODES[code] ? FLOW_CODES[code] : typeof sec.reason === "string" && sec.reason.length > 12 ? sec.reason : null;
    if (sec.status === "ok" || sec.status === "thin") return OK;
    if (sec.status === "stale") return ST("stale", sentence(said) || "The vendor dated this read to another session.");
    if (sec.status === "quiet") return ST("quiet", sentence(said) || "Read, with nothing to report.");
    if (sec.status === "unreadable" || sec.status === "unshaped") return ST("withheld", sentence(said) || "The vendor answered with a body that is not the confirmed shape.");
    if (sec.status === "pending") return ST("pending", sentence(said) || "Not computed yet.");
    return ST("unavailable", sentence(said) || "Not measured this run.");
  };
  const FLOW_CODES = {
    unread: "The run did not request this read for the name.", failed: "The vendor call failed, so nothing was measured.",
    refused: "The vendor refused the call for this plan.", malformed: "The vendor answered with a body that is not the confirmed shape.",
    empty: "The vendor answered with no rows: measured and empty.", "not-session": "The vendor dated these rows to a different session.",
    "short-history": "Fewer sessions of history than the statistic needs.", deadline: "The run passed its deadline before reaching this name.",
    shed: "Dropped to keep the payload under its byte cap.", "outside-band": "No level fell inside the band around spot.",
    "no-contracts": "No contract gained open interest to follow.", truncated: "The read hit the vendor's row ceiling before reaching the session open.",
    not_read: "This run did not spend the call for this name.", absent: "The vendor row did not carry this field.",
    too_few: "Not enough observations for the statistic.", plan_gated: "The vendor refused the route for this plan.",
    unreadable: "The read failed or came back malformed.", stale: "The value is older than its freshness limit.",
  };

  const numOr = (...vs) => { for (const v of vs) if (num(v) !== null) return v; return null; };
  function candlesOf(card) {
    const c = card.panels && card.panels.context;
    if (!c || !Array.isArray(c.candles)) return [];
    const keys = Array.isArray(c.candleKeys) ? c.candleKeys : ["date", "open", "high", "low", "close", "volume"];
    const ix = (k) => keys.indexOf(k);
    return c.candles.filter((r) => Array.isArray(r) && isoOk(r[ix("date")]) && num(r[ix("close")]) !== null)
      .map((r) => ({ d: r[ix("date")], o: r[ix("open")], h: r[ix("high")], l: r[ix("low")], c: r[ix("close")], v: r[ix("volume")] }))
      .sort((a, b) => (a.d < b.d ? -1 : 1));
  }
  function spotOf(card) {
    const P = (card && card.panels) || {};
    const pick = (p) => (p && p.status === "ok" ? num(p.spot) : null);
    const c = candlesOf(card);
    return numOr(pick(P.pricedMove), pick(P.levels), pick(P.gamma), card.engine && card.engine.spot, c.length ? c[c.length - 1].c : null);
  }
  function levelsOf(card) {
    const L = card.panels && card.panels.levels;
    const out = {};
    if (L && L.status === "ok" && Array.isArray(L.levels)) {
      for (const l of L.levels) {
        if (!l || num(l.px) === null) continue;
        const kind = l.kind === "zero_gamma" ? "gamma_flip" : l.kind;
        if (kind === "gamma_flip" && out.gamma_flip && l.kind !== "zero_gamma") continue;
        out[kind] = { ...l, kind };
      }
    }
    if (!out.gamma_flip && num(card.gammaFlip) !== null) out.gamma_flip = { kind: "gamma_flip", label: "Gamma flip", px: card.gammaFlip };
    if (!out.gamma_flip && num(card.zeroGamma) !== null) out.gamma_flip = { kind: "gamma_flip", label: "Zero-gamma level", px: card.zeroGamma };
    return out;
  }
  const levelList = (card) => Object.values(levelsOf(card)).filter((l) => C.LEVELS[l.kind]);
  const LVL_KEY = { gamma_flip: ["--lvl-flip", "dia", "Flip"], call_wall: ["--lvl-call", "dot", "Call wall"], put_wall: ["--lvl-put", "dot", "Put wall"], max_pain: ["--lvl-pain", "dia", "Max pain"] };
  const atrOf = (card) => numOr(card.atr, card.panels && card.panels.levels && card.panels.levels.atr, card.engine && card.engine.atr);


  function leadOf(p) { return p && p.lead && typeof p.lead.say === "string" ? p.lead.say : null; }
  function notesOf(p, keys) { return (keys || ["note", "relation", "reads", "bandNote", "unit"]).map((k) => (p && typeof p[k] === "string" ? p[k] : null)).filter(Boolean); }
  function reasonOf(st) { return st && st.state !== "ok" ? st.reason : null; }

  function info(label, build) { return UI.infoButton(label, build); }
  function tag(text, o) { return UI.tag(text, o); }
  function metric(label, value, o) { return UI.metric(label, value, o); }
  const fx = (v, dp, signed) => (num(v) === null ? DASH : signed ? F.signed(v, dp) : (v < 0 ? MINUS : "") + Math.abs(v).toFixed(dp));
  function mets(list, o) { const el = UI.metrics(list.filter(Boolean), o); el.dataset.n = String(el.childElementCount); return el; }
  function keyOf(c, shape, label) { return UI.key(c, shape, label); }
  function dashKey(c, label) { const k = UI.key(c, "ln", label); k.firstChild.classList.add("ft-dash"); return k; }
  function legend(keys) { return UI.legend(keys.filter(Boolean)); }

  function freshNote(sec) {
    if (!sec || sec.sameSession !== false) return null;
    return "The vendor dated this read " + (sec.asOf || "to another session") + ", not the session the card describes.";
  }

  const SESSIONS = (n) => n + (n === 1 ? " session" : " sessions");
  const POINTS = (n) => (Math.abs(n) === 1 ? " score point" : " score points");
  const NAMES = (n) => n + (n === 1 ? " name" : " names");
  const CROSSING = {
    cleared: "Cleared the dead band — this name became actionable this session.",
    faded: "Faded into the dead band — the exit signal.",
    flipped: "Flipped sign — outside the band at both ends, on opposite sides.",
  };

  function changeFrom(join) {
    if (join === undefined || join === null) {
      return { status: "unavailable", reason: "this card was built before the score overlay existed, so it carries no score history to measure a move against" };
    }
    if (join.status !== "ok") {
      return { status: join.status === "quiet" ? "quiet" : "unavailable",
        reason: join.reason || (join.status === "quiet" ? "the score archive and this card's price window share no session" : "the score history for this name was not published on this card") };
    }
    const rows = Array.isArray(join.rows) ? join.rows : [];
    const scored = [];
    for (let i = 0; i < rows.length; i++) if (num(rows[i] && rows[i].score) !== null) scored.push(i);
    if (!scored.length) return { status: "quiet", reason: "not one of the " + rows.length + " sessions this card shares with the score archive carries a score for this name" };
    const window = { sessions: rows.length, from: rows[0].d, to: rows[rows.length - 1].d, scored: scored.length };
    const iAt = scored[scored.length - 1];
    const at = { i: iAt, d: rows[iAt].d, score: num(rows[iAt].score) };
    const stale = rows.length - 1 - iAt;
    let prior = null, d1 = null;
    if (scored.length >= 2) {
      const iPrior = scored[scored.length - 2];
      prior = { i: iPrior, d: rows[iPrior].d, score: num(rows[iPrior].score) };
      d1 = { v: at.score - prior.score, gap: iAt - iPrior, from: prior.d, to: at.d };
    }
    let run = 0, runBroken = false, runCapped = false;
    if (at.score !== 0) {
      const sign = at.score < 0 ? -1 : 1;
      let i = iAt;
      for (;;) {
        run++;
        if (i === 0) { runCapped = true; break; }
        const prevV = num(rows[i - 1].score);
        if (prevV === null) { runBroken = true; break; }
        if ((prevV < 0 ? -1 : prevV > 0 ? 1 : 0) !== sign) break;
        i--;
      }
    }
    let hi = null, hiAt = null, lo = null, loAt = null;
    for (const i of scored) {
      const v = num(rows[i].score);
      if (hi === null || v > hi) { hi = v; hiAt = rows[i].d; }
      if (lo === null || v < lo) { lo = v; loAt = rows[i].d; }
    }
    const band = num(join.deadBand);
    const bandKnown = band !== null && band >= 0;
    const insideOf = (v) => Math.abs(v) <= band;
    let cross = null;
    if (bandKnown && prior) {
      const wasIn = insideOf(prior.score), isIn = insideOf(at.score);
      if (wasIn && !isIn) cross = "cleared";
      else if (!wasIn && isIn) cross = "faded";
      else if (!wasIn && !isIn && Math.sign(prior.score) !== Math.sign(at.score)) cross = "flipped";
    }
    return { status: "ok", window, at, prior, d1, stale, run, runBroken, runCapped, ext: { hi, hiAt, lo, loAt },
      band: bandKnown ? band : null, inside: bandKnown ? insideOf(at.score) : null, cross, crossKnown: bandKnown && !!prior };
  }

  function changeLines(chg) {
    if (chg.status !== "ok") return { lead: (chg.status === "quiet" ? "Nothing to report — " : "Unavailable — ") + chg.reason + ".", lines: [] };
    const signed = (v) => sgn(v) + Math.abs(v);
    const lines = [];
    const stale = chg.stale > 0 ? "This reading is " + SESSIONS(chg.stale) + " old: the newest session in the joined window is " + chg.window.to + " and it carries no score for this name. The newest score below is " + chg.at.d + "." : null;
    if (chg.cross) lines.push(CROSSING[chg.cross]);
    else if (chg.crossKnown) lines.push(chg.inside ? "No crossing — inside the dead band at both ends." : "No crossing — outside the dead band at both ends, on the same side.");
    else lines.push(chg.band === null ? "No dead band was published on this card, so whether this move crossed one cannot be stated — it is unknown, not absent." : "Only one session in this window carries a score for this name, so there is no crossing to state.");
    let lead;
    if (chg.d1) {
      lead = signed(chg.d1.v) + (chg.d1.v === 0 ? POINTS(chg.d1.v) + " — unchanged since " : POINTS(chg.d1.v) + " since ") + chg.d1.from + ", " + SESSIONS(chg.d1.gap) + " earlier" +
        (chg.d1.gap === 1 ? ". " : " — this name carries no score for the " + SESSIONS(chg.d1.gap - 1) + " in between, so whether the move came in one night or two is not known. ") +
        "It stands at " + signed(chg.at.score) + " on " + chg.at.d + ".";
    } else {
      lead = signed(chg.at.score) + POINTS(chg.at.score) + " on " + chg.at.d + ". No earlier session in this window carries a score for this name, so there is no move to state — which is not a move of zero.";
    }
    if (chg.run === 0) lines.push("The newest score is exactly zero — the centre of the dead band, which is a reading this pipeline assigns and not an absence.");
    else {
      const side = chg.at.score < 0 ? "bearish" : "bullish";
      lines.push((chg.runCapped ? "At least " : "") + chg.run + (chg.run === 1 ? " scored session" : " consecutive scored sessions") + " on the " + side + " side" +
        (chg.runCapped ? ", which is as far back as this card's own window reaches — the run may be older." : chg.runBroken ? ", counted back to a session this name carries no score for. The run is not stepped over that gap: continuity nobody measured is not continuity." : "."));
    }
    lines.push("Derived from the " + SESSIONS(chg.window.sessions) + " between " + chg.window.from + " and " + chg.window.to + " that this card's price window shares with the score archive, " + chg.window.scored + " of which carry a score for this name.");
    return { lead: stale ? stale + " " + lead : lead, lines };
  }

  function convMath(card) {
    const c = card.conv || {};
    const w = c.weights;
    if (!w || num(card.conviction) === null) return null;
    const terms = [["agreement", c.agreement], ["coverage", c.coverage], ["persistence", c.persistence]];
    if (terms.some(([k, v]) => num(v) === null || num(w[k]) === null)) return null;
    const raw = terms.reduce((a, [k, v]) => a + w[k] * v, 0);
    if (Math.round(raw * 100) !== card.conviction) return null;
    return "Conviction " + card.conviction + " = " + terms.map(([k, v]) => Math.round(w[k] * 100) + "% × " + k + " " + Math.round(v * 100)).join(" + ") +
      ". Agreement is a COUNT of families on the score's side, so it steps rather than slides, and two nearby convictions can differ by a whole axis.";
  }

  const FAMS = [["F", "Flow", true], ["P", "Positioning", true], ["D", "Path", true], ["V", "Volatility", false], ["O", "Quality", false]];
  const LEGACY_VO = "This card was built before the volatility and quality readings became gauges, so they are withheld rather than redrawn under a meaning they did not have.";
  const legacyFam = (card, k) => (k === "V" || k === "O") && (num(card.v) === null ? 1 : card.v) < 2;
  const famOf = (card, k) => (legacyFam(card, k) ? null : num((card.fam || {})[k]));
  const famFacts = (card) => FAMS.map(([k, l, sg]) => [l, legacyFam(card, k) ? "withheld on a card built before it was a gauge" : famOf(card, k) === null ? "no reading" : F.num(card.fam[k], sg)]);
  const convFacts = (card) => { const c = card.conv || {}; return [["Agreement", F.pct(c.agreement, 0)], ["Coverage", F.pct(c.coverage, 0)], ["Persistence", F.pct(c.persistence, 0)], ["Breadth", num(c.breadth) === null ? null : String(c.breadth)], ["Gate", num(c.gate) === null ? null : c.gate.toFixed(2)]]; };

  function ivRankOf(card) {
    const pm = (card.panels || {}).pricedMove;
    if (!pm || pm.status !== "ok" || !Object.prototype.hasOwnProperty.call(pm, "ivRank") || pm.ivRank === null || pm.ivRank === undefined) {
      return { v: null, st: ST("unavailable", "The priced-move panel published no IV rank for this name, so its place in its own year is not stated rather than stated as the bottom of it.") };
    }
    const v = num(pm.ivRank);
    if (v === null || v < 0 || v > 1) return { v: null, st: ST("withheld", "This card publishes pricedMove.ivRank as " + String(pm.ivRank) + ", and this line reads that field as a fraction of one. A value outside zero to one is in some other unit, so the rank is withheld rather than multiplied by a hundred and printed.") };
    return { v, st: OK };
  }

  const RICHNESS_LINE = 0.1;
  function richnessRel(pm) {
    const iv = num(pm.iv30), rf = num(pm.rvForward);
    if (pm.richnessFrom === "forward" && iv !== null && rf !== null && rf > 0) return (iv - rf) / rf;
    const trailing = num(pm.vrpTrailing) !== null ? num(pm.vrpTrailing) : num(pm.vrp);
    const rv = num(pm.rv30);
    if (trailing === null || rv === null || !(rv > 0)) return null;
    return trailing / rv;
  }
  function richnessBand(pm) {
    const stored = typeof pm.richness === "string" && pm.richness ? pm.richness : null;
    if (stored !== null && stored !== "rich" && stored !== "cheap" && stored !== "fair") return stored;
    const rel = richnessRel(pm);
    if (rel === null) return stored;
    return rel >= RICHNESS_LINE ? "rich" : rel <= -RICHNESS_LINE ? "cheap" : "fair";
  }

  function rankByDate(card) {
    const vc = (card.panels || {}).volContext;
    const rows = vc && vc.ivRank && Array.isArray(vc.ivRank.rows) ? vc.ivRank.rows.filter((r) => isoOk(r.date) && num(r.rank1y) !== null) : [];
    if (!rows.length) return null;
    return rows.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  }

  function keyStats(card) {
    const S = spotOf(card);
    const atr = atrOf(card);
    const L = card.panels && card.panels.levels;
    const rows = [["Spot", S === null ? null : "$" + F.px(S)], ["ATR", atr === null ? null : "$" + F.px(atr)]];
    const lvls = L && L.status === "ok" && Array.isArray(L.levels) ? L.levels : [];
    for (const l of lvls) {
      if (num(l.px) === null) continue;
      rows.push([l.label || l.kind, "$" + F.px(l.px) + (num(l.distAtr) !== null ? " · " + sgn(l.distAtr) + Math.abs(l.distAtr).toFixed(2) + " ATR" : "") + (l.edge ? " (" + (l.note || "window edge") + ")" : "")]);
    }
    if (!lvls.some((l) => l.kind === "strike_sum_crossing")) rows.push(["Strike-sum crossing", num(card.strikeSumCrossing) !== null ? "$" + F.px(card.strikeSumCrossing) : "— quiet: the strike ladder's running sum does not change sign over the strikes read"]);
    if (!lvls.some((l) => l.kind === "zero_gamma")) rows.push(["Zero-gamma level", num(card.zeroGamma) !== null ? "$" + F.px(card.zeroGamma) : "— unavailable: the card carries no chain profile to find one"]);
    const pm = (card.panels || {}).pricedMove;
    if (pm && pm.status === "ok") rows.push(["Priced move", num(pm.movePerc) !== null ? "±" + F.pct(pm.movePerc) : num(pm.impliedMove) !== null ? "±" + F.pct(pm.impliedMove) : null]);
    const rk = rankByDate(card);
    const vc = (card.panels || {}).volContext;
    const why = !vc ? "the card predates the volatility context panel" : vc.status !== "ok" ? String(vc.reason || vc.note || "the volatility context was not published").replace(/\.$/, "") : !vc.ivRank || vc.ivRank.status !== "ok" ? String((vc.ivRank && (vc.ivRank.reason || vc.ivRank.note)) || "no ranked session on the card").replace(/\.$/, "") : "no ranked session on the card";
    rows.push(["IV rank", rk ? rk.rank1y + "% · " + rk.date : "— unavailable: " + why]);
    return rows;
  }

  const RANGES = [["1M", 21], ["3M", 63], ["6M", 126], ["1Y", 252]];
  let rangePick = 0;

  function liveQuote() {
    const q = STATE.quote;
    if (!q || q.status !== "ok" || num(q.price) === null) return null;
    const t = Date.parse(q.readAt);
    if (STATE.phase !== "rth" || !Number.isFinite(t) || Date.now() - t > 3 * 60 * 1000) return null;
    return q;
  }
  function pricePoint(card) {
    const S = spotOf(card);
    const lq = liveQuote();
    if (lq) return { px: lq.price, prev: numOr(lq.prevClose, S !== null && card.sessionDate === UI.freshness.market().expected ? S : null), live: true, readAt: lq.readAt };
    const ctx = (card.panels || {}).context || {};
    const c = candlesOf(card);
    const ch = ctx.status === "ok" ? num(ctx.changePct) : null;
    const prev = S !== null && ch !== null ? S / (1 + ch) : c.length > 1 ? c[c.length - 2].c : null;
    return { px: S, prev, live: false, readAt: null };
  }

  function staleState(card) {
    const m = UI.freshness.market();
    const out = [];
    if (isoOk(card.sessionDate) && card.sessionDate < m.expected) {
      const board = STATE.meta && isoOk(STATE.meta.sessionDate) && STATE.meta.sessionDate > card.sessionDate ? STATE.meta.sessionDate : null;
      out.push(ST("stale", "Stale: every figure on this page is from the session of " + card.sessionDate + (board ? ", and the board has since published " + board : ", and the last completed session is " + m.expected) + "."));
    }
    const meta = STATE.meta;
    if (meta && meta.sessionDate === card.sessionDate && Date.parse(meta.generatedAt) > Date.parse(card.generatedAt)) {
      out.push(ST("stale", "This card was built by an earlier run of the " + card.sessionDate + " session (" + String(card.generatedAt).slice(11, 16) + " UTC) than the boards it sits under (" + String(meta.generatedAt).slice(11, 16) + " UTC), so it can describe a board this name is no longer on."));
    }
    return out;
  }

  function renderHero(card) {
    heroEl.hidden = false;
    heroEl.classList.remove("is-loading");
    const P = card.panels || {};
    const pm = P.pricedMove && P.pricedMove.status === "ok" ? P.pricedMove : {};
    $("ftHeroT").textContent = card.ticker;
    const sub = $("ftHeroSub");
    sub.replaceChildren(...[card.nm || card.sector || "", card.depth === "index" ? tag("Index") : null].filter(Boolean));
    renderFlags(card);
    paintPrice(card, true);
    renderChips(card, pm);
    renderHeroChart(card, pm);
  }

  function renderFlags(card) {
    const flags = $("ftHeroFlags");
    flags.replaceChildren(...staleState(card).map((st) => UI.stateButton(st, "Session")),
      info("this name", () => ({
        title: card.ticker + (card.nm ? SEP + card.nm : ""), asOf: "Session " + card.sessionDate,
        lead: "The dossier the post-close pipeline published for this name; during the session only price is re-read live.",
        facts: keyStats(card).concat([["Sector", card.sector || null], ["Depth", card.depth || null], ["Built", F.time(card.generatedAt)]]),
      })));
  }

  function paintPrice(card, first) {
    const pp = pricePoint(card);
    const host = $("ftPx");
    const text = F.px(pp.px);
    if (!host.firstChild || STATE.pxShown === null) {
      host.replaceChildren(h("span", { class: "ft-pxv", id: "ftPxV" }), h("span", { id: "ftChg" }));
      UI.roll($("ftPxV"), text, pp.prev !== null && first && STATE.first ? F.px(pp.prev) : null, first && STATE.first);
    } else if (STATE.pxShown !== text) {
      UI.roll($("ftPxV"), text, STATE.pxShown, true);
    }
    STATE.pxShown = text;
    const chg = pp.px !== null && pp.prev !== null ? pp.px - pp.prev : null;
    const pct = chg !== null && pp.prev ? chg / pp.prev : null;
    const t = pct === null ? "flat" : tone(pct);
    $("ftChg").replaceChildren(chg === null ? UI.dash(ST("unavailable", "The card carries no previous close to measure a change against."), "Change")
      : UI.capsule(F.px(Math.abs(chg)) + "  " + F.pct(Math.abs(pct), 2), { tone: t, label: (pp.live ? "Change against the previous close " : "Session change ") + F.px(chg) + ", " + F.pct(pct, 2, true) }));
    const last = $("ftLast");
    const S = spotOf(card);
    const q = STATE.quote && STATE.quote.status === "ok" && num(STATE.quote.price) !== null ? STATE.quote : null;
    const rp = card.readPx && num(card.readPx.px) !== null ? card.readPx : null;
    last.replaceChildren();
    if (pp.live) {
      last.hidden = false;
      last.append(h("span", { class: "ft-live" }, glyph("live")), h("span", null, F.time(pp.readAt)),
        info("the live price", () => ({ title: "Live price", state: "live", asOf: F.time(pp.readAt),
          lead: "Re-read from the vendor's live quote while the session is open. Every other reading on this page is the session's, as the card published it.",
          facts: [["Last", F.px(q.price)], ["Previous close", F.px(q.prevClose)], ["Session open", F.px(q.open)], ["High", F.px(q.high)], ["Low", F.px(q.low)], ["Tape time", q.tapeTime ? F.time(q.tapeTime) : null], ["Card close", F.px(S)]] })));
      return;
    }
    const src = q || rp;
    if (!src || S === null) { last.hidden = true; return; }
    const lastPx = q ? q.price : rp.px;
    const at = q ? q.readAt : rp.readAt;
    const d = lastPx / S - 1;
    last.hidden = false;
    last.append(glyph("closed"), h("b", null, F.px(lastPx)), h("span", { "data-tone": tone(d, 0.00005) }, F.pct(d, 2, true)), h("span", null, F.time(at)),
      info("the last read price", () => ({ title: "Last read", asOf: F.time(at),
        lead: q ? "The vendor's quote as last read; the market is not in its regular session, so the dossier stays on the session close." : rp.note,
        facts: [["Last read", F.px(lastPx)], ["Session close", F.px(S)], ["Source", q ? "live quote" : rp.source], ["Basis", q ? null : rp.spotBasis], ["Previous close", q ? F.px(q.prevClose) : null]] })));
  }

  function renderChips(card, pm) {
    const reg = card.regime || {};
    const gl = reg.label === "short" ? "short" : reg.label === "long" ? "long" : null;
    const score = num(card.score);
    const ivr = ivRankOf(card);
    const im = num(pm.impliedMove);
    const cx = STATE.cardX && STATE.cardX.gex && STATE.cardX.gex.status === "ok" ? STATE.cardX.gex : null;
    const chipList = [
      isIndex(card) && score === null ? null : UI.gaugeChip({ diverging: score, value: score === null ? chipDash("unavailable") : F.signed(score), label: "Score", tone: tone(score),
        info: () => ({ title: "Options score", lead: score === null ? "No score was published on this card." : card.ticker + " scores " + F.signed(score) + " of ±100 this session, with conviction " + (num(card.conviction) === null ? DASH : card.conviction) + " of 100.",
          facts: famFacts(card), notes: ["The score is a weighted sum of signed family readings; conviction gates it by agreement, coverage and persistence."] }) }),
      isIndex(card) && num(card.conviction) === null ? null : UI.gaugeChip({ ring: num(card.conviction) === null ? null : card.conviction / 100, color: "--label-1", value: num(card.conviction) === null ? chipDash("unavailable") : String(card.conviction), label: "Conviction",
        info: () => ({ title: "Conviction", lead: "How far the families agree, how much of the card was measured, and how long the flow persisted.", facts: convFacts(card), notes: [convMath(card)] }) }),
      UI.gaugeChip({ icon: "gamma", color: gl === "short" ? "--g-short-ink" : "--g-long-ink", value: gl ? (gl === "short" ? "Short" : "Long") : chipDash("unavailable"), label: "Dealer γ", tone: gl,
        info: () => ({ title: "Dealer gamma", lead: gl === "short" ? "Dealers are short gamma: their hedging buys rallies and sells dips, which amplifies moves." : gl === "long" ? "Dealers are long gamma: their hedging sells rallies and buys dips, which dampens moves." : "No regime reading on this card.",
          facts: [["Book γ per 1%", F.money(reg.bookGamma, true)], ["Added today per 1%", F.money(numOr(reg.flowGamma, reg.netGamma), true)], ["Read from", reg.labelFrom || null], ["Zero crossings", num(reg.crossings) === null ? null : String(reg.crossings)],
            ["1Y z", cx && num(cx.z) !== null ? F.signed(cx.z, 2) : null], ["Same sign for", cx && num(cx.persist) !== null ? SESSIONS(cx.persist) : null], ["Long share of the year", cx ? F.pct(cx.longShare, 0) : null]] }) }),
      UI.gaugeChip({ ring: ivr.v, color: "--s-blue", value: ivr.v === null ? chipDash(ivr.st.state) : String(Math.round(ivr.v * 100)), label: "IV rank",
        info: () => ({ title: "IV rank", state: ivr.st.state === "ok" ? null : ivr.st.state, lead: ivr.st.state === "ok" ? "Where 30-day implied volatility sits inside its own one-year range, as a percentile of its own year: " + Math.round(ivr.v * 100) + " of 100." : ivr.st.reason,
          facts: [["IV 30d", F.pct(pm.iv30)], ["Momentum", num(pm.ivMomentum) === null ? null : F.pts(pm.ivMomentum) + " pts"]] }) }),
      UI.gaugeChip({ icon: "levels", color: "--accent-soft", value: im === null ? chipDash(stOf(card.panels.pricedMove, "priced move").state) : "±" + F.pct(im), label: (num(pm.sessions) || 10) + "d move",
        info: () => ({ title: "Priced move", state: stOf(card.panels.pricedMove, "priced move").state === "ok" ? null : stOf(card.panels.pricedMove, "priced move").state,
          lead: leadOf(card.panels.pricedMove) || reasonOf(stOf(card.panels.pricedMove, "priced move")),
          facts: [["Implied", im === null ? null : "±" + F.pct(im)], ["Range", F.px(pm.impliedLow) + " – " + F.px(pm.impliedHigh)], ["Realized", num(pm.realizedMove) === null ? null : "±" + F.pct(pm.realizedMove)], ["Horizon", pm.horizonRule || null]],
          notes: [pm.bandNote] }) }),
    ];
    $("ftChips").replaceChildren(UI.chips(chipList.filter(Boolean), "Signal"));
  }

  function eventInHorizon(card, Hs) {
    const cx = STATE.cardX;
    const e = cx && cx.earnings && cx.earnings.status !== "unavailable" && cx.earnings.next ? cx.earnings.next : null;
    if (!e || num(e.sessions) === null || e.sessions < 1 || e.sessions > Hs) return [];
    return [{ t: e.sessions, label: "E", name: "Earnings " + F.day(e.d) }];
  }

  const fx1 = (v) => (Math.round(v * 10) / 10).toString();
  const textW = (t) => String(t).length * 6.4 + 12;
  let coneSeq = 0;
  function spreadTags(items, gap, lo, hi) {
    items.sort((a, b) => a.y - b.y);
    for (let it = 0; it < 80; it++) {
      let moved = false;
      for (let i = 1; i < items.length; i++) {
        const d = items[i].y - items[i - 1].y;
        if (d < gap) { const q = (gap - d) / 2; items[i - 1].y -= q; items[i].y += q; moved = true; }
      }
      for (const t of items) t.y = clamp(t.y, lo, hi);
      if (!moved) break;
    }
  }
  function mark(g, shape, x, y, color, r) {
    if (shape === "dia") return s("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 1.2, fill: color, transform: "rotate(45 " + x + " " + y + ")" }, g);
    if (shape === "ring") return s("circle", { cx: x, cy: y, r: r - 0.5, fill: "none", stroke: color, "stroke-width": 1.5 }, g);
    return s("circle", { cx: x, cy: y, r, fill: color }, g);
  }
  function histTicks(ds, xAt, phone, right) {
    const out = [], N = ds.length;
    if (N <= 32) {
      const every = Math.max(3, Math.round(N / (phone ? 3 : 5)));
      for (let i = N - 1 - every; i > 0; i -= every) out.push({ i, text: F.day(ds[i]) });
    } else {
      let last = null;
      ds.forEach((d, i) => {
        const m = d.slice(0, 7);
        if (last !== null && m !== last) out.push({ i, text: N > 400 && d.slice(0, 4) !== last.slice(0, 4) ? d.slice(0, 4) : F.day(d).split(" ")[0] });
        last = m;
      });
    }
    return out.filter((t) => xAt(t.i) > 14 && xAt(t.i) < right - 14);
  }

  function heroCone(host, o) {
    return C.mount(host, (el, w, animate) => {
      const hist = (o.history || []).filter((r) => r && isoOk(r.d) && num(r.c) !== null);
      const S = numOr(o.spot, hist.length ? hist[hist.length - 1].c : null);
      const phone = w < 600;
      const H = heightOf(w, o.height);
      if (!hist.length || S === null) { el.append(UI.silent(ST("unavailable", o.empty), o.label, H)); return; }
      const N = hist.length, Hs = o.horizon;
      const gutter = phone ? 58 : 66;
      const top = 30, stripH = o.strip ? 30 : 0, axisH = 20;
      const plotB = H - axisH - stripH - (o.strip ? 12 : 4);
      const plotW = w - gutter;
      const fw = Math.max(plotW * Hs / (N + Hs), plotW * (phone ? 0.3 : 0.26));
      const xNow = plotW - fw;
      const xh = (i) => (N === 1 ? xNow : (i / (N - 1)) * (xNow - 4));
      const xf = (t) => xNow + (t / Hs) * (fw - 8);
      const conePx = (end) => (t) => S * (end / S) ** Math.sqrt(t / Hs);
      const band = num(o.hi) !== null && num(o.lo) !== null && S > 0 && o.hi > 0 && o.lo > 0;
      const real = num(o.realized.hi) !== null && num(o.realized.lo) !== null && o.realized.hi > 0 && o.realized.lo > 0 && S > 0;
      const hiT = conePx(o.hi), loT = conePx(o.lo), rHiT = conePx(o.realized.hi), rLoT = conePx(o.realized.lo);
      const lv = o.levels.filter((l) => l && num(l.px) !== null && C.LEVELS[l.kind] && Math.abs(l.px / S - 1) <= 0.12);
      const vals = hist.map((r) => r.c).concat([S], band ? [o.hi, o.lo] : [], real ? [o.realized.hi, o.realized.lo] : [], lv.map((l) => l.px));
      let y0 = Math.min(...vals), y1 = Math.max(...vals);
      const pad = (y1 - y0) * 0.06 || S * 0.01;
      y0 -= pad; y1 += pad;
      const y = C.lin(y0, y1, plotB, top);
      const svg = C.svgRoot(el, w, H, animate, o.label);
      const first = hist[0].c, last = hist[N - 1].c;
      const upDay = last >= first;
      const lineC = cssVar(upDay ? "--up" : "--down");
      const pts = hist.map((r, i) => [xh(i), y(r.c)]);
      pts.push([xNow, y(S)]);
      s("path", { d: C.pathOf(pts) + "L" + fx1(xNow) + " " + fx1(plotB) + "L" + fx1(pts[0][0]) + " " + fx1(plotB) + "Z", fill: C.vGrad(svg, lineC, 0.13, 0), class: "fade", style: { "--delay": "250ms" } }, svg);
      s("line", { x1: xNow, x2: xNow, y1: top - 6, y2: H - axisH, class: "hair" }, svg);
      const accent = cssVar("--accent");
      const path = (fn) => { const a = []; for (let k = 0; k <= 24; k++) { const t = (k / 24) * Hs; a.push([xf(t), y(fn(t))]); } return a; };
      if (band) {
        const up = path(hiT), dn = path(loT);
        const gid = "ftCone" + ++coneSeq;
        const defs = svg.querySelector("defs") || s("defs", null, svg);
        const lg = s("linearGradient", { id: gid, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
        s("stop", { offset: 0, "stop-color": accent, "stop-opacity": 0.34 }, lg);
        s("stop", { offset: 1, "stop-color": accent, "stop-opacity": 0.12 }, lg);
        s("path", { d: C.pathOf(up) + dn.slice().reverse().map((q) => "L" + fx1(q[0]) + " " + fx1(q[1])).join("") + "Z", fill: "url(#" + gid + ")", class: "fade", style: { "--delay": "420ms" } }, svg);
        for (const a of [up, dn]) s("path", { d: C.pathOf(a), class: "ln draw", stroke: accent, "stroke-opacity": 0.7, "stroke-width": 1, pathLength: 1, style: { "--delay": "520ms" } }, svg);
      }
      if (real) {
        const rg = s("g", { class: "fade ft-rc", style: { "--delay": "620ms" } }, svg);
        for (const a of [path(rHiT), path(rLoT)]) s("path", { d: C.pathOf(a), class: "ln", stroke: cssVar("--s-gray"), "stroke-width": 1.25, "stroke-dasharray": "3 3" }, rg);
        s("rect", { x: xf(Hs) - 1, y: y(o.realized.hi), width: 4, height: Math.max(2, y(o.realized.lo) - y(o.realized.hi)), rx: 2, fill: cssVar("--s-gray"), class: "fade", style: { "--delay": "650ms" } }, svg);
      }
      const evs = o.events.filter((e) => num(e.t) !== null && e.t > 0 && e.t <= Hs);
      for (const e of evs) {
        const ex = xf(e.t);
        const eg = s("g", { class: "fade ft-ev", style: { "--delay": "680ms" } }, svg);
        s("line", { x1: ex, x2: ex, y1: top - 4, y2: plotB, stroke: cssVar("--lvl-flip"), "stroke-width": 1, "stroke-opacity": 0.55, "stroke-dasharray": "2 3" }, eg);
        mark(eg, "dia", ex, top - 8, cssVar("--lvl-flip"), 3.4);
        s("text", { x: ex, y: top - 15, text: e.label, "text-anchor": "middle", class: "tx-1 tx-b" }, eg);
      }
      const lvG = s("g", { class: "fade", style: { "--delay": "600ms" } }, svg);
      for (const l of lv) s("line", { x1: xNow, x2: xf(Hs), y1: y(l.px), y2: y(l.px), stroke: cssVar(C.LEVELS[l.kind].color), "stroke-width": 1, "stroke-opacity": 0.75 }, lvG);
      s("path", { d: C.pathOf(pts), class: "ln draw", stroke: lineC, pathLength: 1 }, svg);
      if (o.live) s("circle", { cx: xNow, cy: y(S), r: 4, fill: lineC, class: "pulse" }, svg);
      s("circle", { cx: xNow, cy: y(S), r: 4, fill: cssVar("--label-1"), class: "ring" }, svg);
      const tags = [{ y: y(S), y0: y(S), text: F.px(S), kind: "spot" }];
      if (band) tags.push({ y: y(o.hi), y0: y(o.hi), text: F.px(o.hi), kind: "band" }, { y: y(o.lo), y0: y(o.lo), text: F.px(o.lo), kind: "band" });
      for (const l of lv) tags.push({ y: y(l.px), y0: y(l.px), text: F.px(l.px), kind: l.kind });
      spreadTags(tags, 17, top, plotB);
      const tg = s("g", { class: "fade", style: { "--delay": "700ms" } }, svg);
      const tx = plotW + 8;
      for (const t of tags) {
        if (Math.abs(t.y - t.y0) > 2) s("path", { d: "M" + fx1(xf(Hs) + 3) + " " + fx1(t.y0) + "L" + fx1(tx - 3) + " " + fx1(t.y), stroke: cssVar("--label-4"), "stroke-width": 1, fill: "none" }, tg);
        if (t.kind === "spot") {
          s("rect", { x: tx - 2, y: t.y - 9, width: textW(t.text), height: 18, rx: 9, fill: cssVar("--label-1") }, tg);
          s("text", { x: tx + 4, y: t.y + 3.8, text: t.text, class: "tx-b tx-ink" }, tg);
        } else if (t.kind === "band") {
          s("rect", { x: tx, y: t.y - 4, width: 6, height: 8, rx: 2, fill: accent, opacity: 0.6 }, tg);
          s("text", { x: tx + 10, y: t.y + 3.8, text: t.text, style: { fill: cssVar("--accent-soft") } }, tg);
        } else {
          const d = C.LEVELS[t.kind];
          mark(tg, d.shape, tx + 3, t.y, cssVar(d.color), 3.2);
          s("text", { x: tx + 10, y: t.y + 3.8, text: t.text, class: "tx-1" }, tg);
        }
      }
      const sm = new Map();
      if (o.strip) {
        for (const k of Object.keys(o.strip)) if (num(o.strip[k]) !== null) sm.set(k, o.strip[k]);
        const sy = plotB + 12 + stripH / 2;
        s("line", { x1: 0, x2: xNow, y1: sy, y2: sy, class: "hair" }, svg);
        const bw = clamp((N > 1 ? (xNow - 4) / (N - 1) : 8) * 0.62, 1.5, 6);
        hist.forEach((r, i) => {
          const v = sm.get(r.d);
          if (v === undefined) { s("circle", { cx: xh(i), cy: sy, r: 1, fill: cssVar("--label-4") }, svg); return; }
          const hh = Math.max(1.5, (Math.abs(v) / 100) * (stripH / 2));
          const neg = v < 0;
          s("rect", { x: xh(i) - bw / 2, y: neg ? sy : sy - hh, width: bw, height: hh, rx: Math.min(1.5, bw / 2), fill: cssVar(neg ? "--down-mark" : v > 0 ? "--up-mark" : "--label-3"), class: "grow", style: { "--i": String(i), "--origin": neg ? "top" : "bottom" } }, svg);
        });
        s("text", { x: tx, y: sy + 4, text: "Score", class: "tx-3" }, svg);
      }
      for (const t of histTicks(hist.map((r) => r.d), xh, phone, xNow)) s("text", { x: xh(t.i), y: H - 5, text: t.text, "text-anchor": "middle" }, svg);
      s("text", { x: xf(Hs), y: H - 5, text: "+" + Hs + "d", "text-anchor": "middle" }, svg);
      const xs = hist.map((_, i) => xh(i));
      for (let t = 1; t <= Hs; t++) xs.push(xf(t));
      const range = (a, b) => F.px(a) + " " + String.fromCharCode(8211) + " " + F.px(b);
      C.scrub(el, svg, { xs, top, bottom: plotB, label: o.label,
        onMove: (i) => {
          if (i < N) {
            const r = hist[i], v = sm.get(r.d);
            const p1 = i > 0 ? r.c / hist[i - 1].c - 1 : null;
            return { dots: [{ x: xh(i), y: y(r.c), color: upDay ? "--up" : "--down" }],
              parts: [C.part(F.day(r.d), "k"), h("b", null, F.px(r.c)), p1 === null ? null : C.part(F.pct(p1, 2, true), null, tone(p1)),
                o.strip ? (v === undefined ? C.part("no score", "k") : C.part("score " + F.signed(v), null, tone(v))) : null] };
          }
          const t = i - N + 1;
          const ev = evs.find((e) => Math.round(e.t) === t);
          const dots = [], parts = [C.part("+" + t + " sessions", "k")];
          if (band) { dots.push({ x: xf(t), y: y(hiT(t)), color: "--accent" }, { x: xf(t), y: y(loT(t)), color: "--accent" }); parts.push(h("b", null, range(loT(t), hiT(t)))); }
          if (real) { dots.push({ x: xf(t), y: y(rHiT(t)), color: "--s-gray" }, { x: xf(t), y: y(rLoT(t)), color: "--s-gray" }); parts.push(C.part("Realized", "k"), C.part(range(rLoT(t), rHiT(t)))); }
          if (ev) parts.push(C.part(ev.name, null, "warn"));
          return { dots, parts };
        } });
    });
  }

  function renderHeroChart(card, pm) {
    const host = $("ftHc");
    host.replaceChildren();
    const P = card.panels || {};
    const C0 = candlesOf(card);
    const S = spotOf(card);
    const Hs = num(pm.sessions) || 10;
    const strip = {};
    const so = P.scoreOverlay;
    if (so && so.status === "ok" && Array.isArray(so.rows)) for (const r of so.rows) if (isoOk(r.d) && num(r.score) !== null) strip[r.d] = r.score;
    if (isoOk(card.sessionDate) && num(card.score) !== null && strip[card.sessionDate] === undefined) strip[card.sessionDate] = card.score;
    const hasStrip = Object.keys(strip).length > 0;
    const events = eventInHorizon(card, Hs);
    const chartHost = h("div", { class: "ft-hc-chart" });
    const draw = () => heroCone(chartHost, {
      history: C0.slice(-RANGES[rangePick][1]).map((r) => ({ d: r.d, c: r.c })), spot: S, hi: pm.impliedHigh, lo: pm.impliedLow, horizon: Hs,
      realized: { hi: pm.realizedHigh, lo: pm.realizedLow }, levels: levelList(card), strip: hasStrip ? strip : null,
      events, live: !!liveQuote(), height: [240, 270, 286], label: card.ticker + " price, the priced " + Hs + "-session range and the realized range",
      empty: "The card carries no price history.",
    });
    let handle = null;
    const seg = UI.segmented("Range", RANGES.map(([l]) => ({ label: l })), (i) => { rangePick = i; if (handle) handle.destroy(); handle = draw(); }, rangePick);
    const head = h("div", { class: "ft-hc-h" }, seg, h("span", { class: "ft-sp" }),
      info("the price chart", () => ({ title: "Price and priced move", asOf: pm.asOf || null, lead: leadOf(P.pricedMove),
        facts: [["Implied low", F.px(pm.impliedLow)], ["Implied high", F.px(pm.impliedHigh)], ["Realized low", F.px(pm.realizedLow)], ["Realized high", F.px(pm.realizedHigh)], ["Band", richnessBand(pm) || DASH], ["Band shape", pm.band || null], ["Sessions", String(Hs)]],
        sections: [{ title: "History", lines: notesOf(P.context, ["note"]).concat(breaksOf(P.context)) }],
        notes: [pm.bandNote, "The blue cone widens with the square root of time between spot and the priced range at the horizon; the dashed grey cone is the realized range drawn the same way. Bars under the price are the daily options score; a dot is a session with no score, which is not a zero.",
          events.length ? "The diamond marks the next earnings report inside the horizon (" + events[0].name + ")." : null] })));
    host.append(head, chartHost, legend([
      keyOf("--accent", "", "Implied"), dashKey("--s-gray", "Realized"),
      ...Object.values(levelsOf(card)).filter((l) => LVL_KEY[l.kind] && S && Math.abs(l.px / S - 1) <= 0.12).map((l) => keyOf(...LVL_KEY[l.kind])),
      hasStrip ? keyOf("--label-2", "split", "Score") : null, events.length ? keyOf("--lvl-flip", "dia", "Earnings") : null,
    ]));
    handle = draw();
  }

  function breaksOf(ctx) {
    const b = ctx && Array.isArray(ctx.breaks) ? ctx.breaks : [];
    return b.map((x) => "The vendor’s history steps on " + x.date + " (close ×" + x.ratio + (num(x.volumeRatio) !== null ? ", volume ×" + Math.round(x.volumeRatio) + " against the sessions before" : "") + (x.shape === "split" ? ", the shape of an unadjusted split" : "") + "), so the " + x.before + " sessions before it are cut.");
  }

  function paintFreshness(card) {
    UI.freshness({ sessionDate: card.sessionDate, generatedAt: card.generatedAt, source: "card" });
    for (const [k, v] of [["card-x", STATE.cardX], ["hist", STATE.hist]]) if (v && isoOk(v.sessionDate)) UI.freshness({ sessionDate: v.sessionDate, generatedAt: v.generatedAt, source: k });
    const lq = liveQuote();
    if (lq) UI.freshness({ readAt: lq.readAt, live: true });
  }

  const BASIS = { state: "State", gamma: "γ", levels: "Levels", aggressor: "Aggressor", oiDeltas: "OI Δ", pricedMove: "Move", ivSurface: "Smile", volContext: "Term", skewTerm: "Skew", calendar: "Roll-off", path: "Path", darkpool: "Dark pool", topContracts: "Contracts", variation: "Hedging", displacement: "Displacement", surface: "Grid", context: "Trend", premiumTrack: "Premium", congress: "Congress", vanna: "Vanna", charm: "Charm", deltaExposure: "Delta" };
  const LOT = 100;
  const NO_TRADE = {
    "ev.none-positive": ["No positive edge", "no structure it priced has a positive expected P&L in the real world"],
    "grade.none": ["None cleared the grade", "the structures with a positive edge all grade below 1"],
    "risk.undefined-only": ["Only undefined risk", "every structure that cleared the bar carries undefined risk, and the first idea must be a defined-risk one"],
    "model.none": ["Nothing priced", "the model could not price any structure on this card"],
    "candidates.none": ["No candidates", "no structure family fits this card's expiries and state"],
  };
  const usd0 = (v) => (num(v) === null ? DASH : (v < 0 ? MINUS + "$" : "$") + Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 0));
  const legText = (l) => (l.side > 0 ? "+" : l.side < 0 ? MINUS : "") + (l.qty > 1 ? l.qty : "") + l.type + (num(l.k) === null ? "" : K(l.k));

  function engineOf(card) { return card && card.engine && Array.isArray(card.engine.structures) ? card.engine : null; }

  function ideaEntries(card, neuron) {
    const eng = engineOf(card);
    if (eng) {
      const byId = new Map(eng.structures.map((x) => [x.id, x]));
      const nIdeas = neuron && neuron.engine && Array.isArray(neuron.ideas) && neuron.ideas.length ? neuron.ideas : null;
      const order = nIdeas ? nIdeas.map((n) => ({ id: n.structure, n })) : (Array.isArray(eng.ideas) ? eng.ideas : []).map((id) => ({ id, n: null }));
      return order.slice(0, 3).map((o) => ({ kind: "engine", id: o.id, st: byId.get(o.id) || null, n: o.n }));
    }
    const ideas = neuron && neuron.status === "ok" && !neuron.engine && Array.isArray(neuron.ideas) ? neuron.ideas : [];
    return ideas.slice(0, 3).map((idea) => ({ kind: "legacy", idea }));
  }

  function clipTo(pts, a, b) {
    if (!pts || pts.length < 2) return null;
    const at = (x) => { for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); } return null; };
    const lo = Math.max(a, pts[0][0]), hi = Math.min(b, pts[pts.length - 1][0]);
    if (!(hi > lo)) return null;
    const mid = pts.filter((p) => p[0] > lo && p[0] < hi);
    return [[lo, at(lo)], ...mid, [hi, at(hi)]].filter((p) => p[1] !== null);
  }

  function payoffPoints(st, S) {
    const legs = (st.legs || []).filter((l) => l && (l.type === "S" || num(l.k) !== null));
    const cost = numOr(st.price && st.price.fill, st.price && st.price.mid);
    const expiries = new Set(legs.filter((l) => l.type !== "S").map((l) => l.expiry));
    const G = st.grid && Array.isArray(st.grid.spot) ? st.grid : null;
    const v0 = G && Array.isArray(G.vol) ? G.vol.findIndex((v) => Math.abs(v) < 1e-9) : -1;
    const projected = G && v0 >= 0 ? G.spot.map((x, i) => [x, num(G.pnl[i] && G.pnl[i][v0] && G.pnl[i][v0][0])]).filter((p) => num(p[0]) !== null && p[1] !== null).sort((a, b) => a[0] - b[0]) : null;
    if (expiries.size <= 1 && cost !== null && legs.length) {
      const ks = legs.filter((l) => l.type !== "S").map((l) => l.k);
      const be = (st.breakevens || []).filter((b) => num(b) !== null);
      const span = [...ks, ...be, S].filter((v) => num(v) !== null);
      const lo = Math.min(...span), hi = Math.max(...span);
      const pad = Math.max((hi - lo) * 0.35, S * 0.04);
      const xs = [...new Set([lo - pad, hi + pad, ...ks, ...be].map((v) => +v.toFixed(4)))].filter((x) => x > 0).sort((a, b) => a - b);
      const pay = (x) => LOT * (legs.reduce((a, l) => a + l.side * (l.qty || 1) * (l.type === "S" ? x : l.type === "C" ? Math.max(0, x - l.k) : Math.max(0, l.k - x)), 0) - cost);
      return { points: xs.map((x) => [x, pay(x)]), projected: clipTo(projected, xs[0], xs[xs.length - 1]), exact: true };
    }
    if (!G || v0 < 0) return null;
    const last = G.days.length - 1;
    const pts = G.spot.map((x, i) => [x, num(G.pnl[i] && G.pnl[i][v0] && G.pnl[i][v0][last])]).filter((p) => num(p[0]) !== null && p[1] !== null);
    for (const b of st.breakevens || []) if (num(b) !== null) pts.push([b, 0]);
    for (const [a, b] of st.maxProfitAt || []) if (num(a) !== null && num(st.maxProfit) !== null && (b === null || Math.abs(a - b) < 1e-9)) pts.push([a, st.maxProfit]);
    pts.sort((a, b) => a[0] - b[0]);
    return { points: pts, projected, exact: false };
  }

  function sessionBehind() {
    const c = STATE.card;
    if (!c) return false;
    const said = STATE.neuron && STATE.neuron.context ? STATE.neuron.context.stale : null;
    if (typeof said === "boolean") return said;
    return isoOk(c.sessionDate) && c.sessionDate < UI.freshness.market().expected;
  }
  function vettedGrade(st, n) {
    const g = num(st && st.grade);
    const v = n ? num(n.grade) : null;
    const out = v !== null ? (g !== null ? Math.min(v, g) : v) : g;
    return out !== null && sessionBehind() ? Math.min(out, 1) : out;
  }
  function ideaFacts(st, n, eng) {
    const pr = st.prob || {}, ev = st.ev || {}, pc = (v) => (num(v) === null ? DASH : (v * 100).toFixed(0) + "%");
    const factMap = new Map((eng.facts || []).map((f) => [f.id, f]));
    const because = n && Array.isArray(n.because) ? n.because.map((id) => { const f = factMap.get(id); return f ? id + " = " + (f.v === null ? "withheld" : String(f.v)) + (f.u ? " " + f.u : "") : id; }) : [];
    return [
      ["Structure", famWord(st.family) + SEP + st.risk + " risk"],
      ["Legs", (st.legs || []).map(legText).join(" ")],
      ["Expiry", st.expiry + SEP + st.dte + "d"],
      ["Price", st.price ? "mid " + F.px(st.price.mid) + SEP + "natural " + F.px(st.price.natural) + SEP + "fill " + F.px(st.price.fill) + SEP + "model " + F.px(st.price.model) : null],
      ["Chance of profit", "Q " + pc(pr.popQ) + SEP + "P " + pc(pr.popP)],
      ["Expected P&L", usd0(ev.p) + " real world" + SEP + usd0(ev.q) + " on the smile"],
      ["Edge", num(ev.edge) === null ? null : usd0(ev.edge)],
      ["Max profit", st.profitUnbounded ? "unbounded" : usd0(st.maxProfit)],
      ["Max loss", st.lossUnbounded ? "unbounded" : usd0(st.maxLoss)],
      ["Breakevens", (st.breakevens || []).map((b) => F.px(b)).join(SEP) || null],
      ["Capital", st.capital ? usd0(st.capital.value) + " " + (st.capital.kind || "") : null],
      ["Tail", st.tail ? "VaR 5% " + usd0(st.tail.var5P) + SEP + "CVaR " + usd0(st.tail.cvar5P) : null],
      ["Greeks", st.greeks ? "Δ$ " + F.num(st.greeks["delta$"], true) + SEP + "Γ$ per 1% " + F.num(st.greeks["gamma$1pct"], true) + SEP + "vega " + F.num(st.greeks.vegaPt, true) + SEP + "θ/day " + F.num(st.greeks.thetaDay, true) : null],
      ["Grade", (vettedGrade(st, n) === null ? DASH : vettedGrade(st, n)) + " of 3" + (sessionBehind() && num(st.grade) !== null && st.grade > 1 ? ", capped at 1 because this card describes an earlier session than the last one to close (the structure alone grades " + st.grade + ")"
        : n && num(n.grade) !== null && num(st.grade) !== null && n.grade < st.grade ? ", capped by the weakest fact it rests on (the structure alone grades " + st.grade + ")" : "") + (st.gradeParts ? " (" + Object.entries(st.gradeParts).map(([k, v]) => k + " " + v).join(", ") + ")" : "")],
      ["Rules", (st.rules || []).join(" ") || null],
      ["Rests on", because.join(SEP) || null],
      ["Source", n ? (n.from === "model" ? "model's pick, vetted against the engine" : "engine ranking") : "engine ranking"],
    ];
  }

  function legRow(l) {
    const tone2 = l.type === "C" ? "up" : l.type === "P" ? "down" : null;
    return h("li", { class: "ft-leg" },
      h("span", { class: "ft-leg-q", "data-tone": l.side > 0 ? "up" : l.side < 0 ? "down" : "flat" }, (l.side > 0 ? "+" : l.side < 0 ? MINUS : "") + (l.qty || 1)),
      h("span", { class: "ui-badge", "data-tone": tone2, "aria-label": l.type === "C" ? "Call" : l.type === "P" ? "Put" : "Stock" }, l.type),
      h("b", null, l.type === "S" ? "Stock" : K(l.k)),
      h("span", { class: "ft-leg-e" }, l.type === "S" ? "" : day(l.expiry)),
      h("span", { class: "ft-leg-d" }, num(l.delta) === null ? "" : Math.round(Math.abs(l.delta) * 100) + "Δ"));
  }

  function engineIdeaCard(e, card, i, eng) {
    const S = spotOf(card);
    if (!e.st) {
      const st = ST("unavailable", "Structure " + e.id + " is not on the card this page holds, so it is not drawn with figures from nowhere.");
      return h("article", { class: "ft-idea is-silent ui-enter", role: "listitem", style: { "--i": String(i + 2) } },
        h("div", { class: "ft-idea-h" }, h("span", { class: "ft-idea-t" }, e.n && e.n.word ? e.n.word : "Idea " + (i + 1)), tag(e.n && e.n.from === "model" ? "Model's pick" : "Engine ranking")),
        UI.silent(st, "Idea " + e.id, 150));
    }
    const st = e.st;
    const tn = dirTone(st.dir);
    const pr = st.prob || {};
    const evP = st.ev ? num(st.ev.p) : null;
    const noFig = (what) => ST("unavailable", "The engine published no " + what + " for this structure" + (what.indexOf("real-world") === 0 && !eng.pLaw ? ": the card carries no real-world law to compute it under." : ": a figure it could not compute leaves the engine as null, and a null is not a zero."));
    const pay = payoffPoints(st, S);
    const chartHost = h("div", { class: "ft-idea-pay" });
    const word = e.n && e.n.word ? e.n.word : null;
    const infoId = UI.info(() => ({
      title: (word ? word + SEP : "") + famWord(st.family), state: null, asOf: eng.asOf || null,
      lead: "Priced by the options engine on this name's own smile: the chance of profit and the expected P&L are computed twice, under the risk-neutral density the smile implies (Q) and under the real-world GARCH law (P).",
      facts: ideaFacts(st, e.n, eng),
      notes: [pay && !pay.exact ? "This structure spans two expiries, so its expiry curve is the engine's own scenario grid at the front expiry, joined point to point." : "The solid line is the P&L at expiry per one lot; the dashed line is the engine's P&L today at the grid's spot scenarios.",
        (st.gradeWhy || []).length ? "Grade held back by: " + st.gradeWhy.join(", ") + "." : null],
    }));
    const card_ = h("article", { class: "ft-idea ui-enter", role: "listitem", style: { "--i": String(i + 2) }, "data-structure": st.id, "data-dir": tn },
      h("div", { class: "ft-idea-h" },
        h("span", { class: "ft-dir", "data-tone": tn, "aria-label": dirWord(tn) }, glyph(tn === "down" ? "down" : tn === "up" ? "up" : "flat")),
        h("button", { class: "ft-idea-t", type: "button", "data-info": infoId, "aria-haspopup": "dialog", "aria-controls": "fxPop" }, famWord(st.family)),
        UI.robustness(vettedGrade(st, e.n) || 0, "grade")),
      h("div", { class: "ft-idea-s" }, word ? tag(word, { accent: true }) : null, h("span", null, day(st.expiry) + SEP + st.dte + "d")),
      h("ul", { class: "ft-legs", "aria-label": "Legs" }, (st.legs || []).map(legRow)),
      chartHost,
      h("div", { class: "ft-slots" },
        h("div", { class: "ft-slot" }, h("span", { class: "ft-slot-l" }, "PoP"),
          h("span", { class: "ft-slot-v", "aria-label": "Chance of profit " + (num(pr.popQ) === null ? "not published" : ratioP(pr.popQ)) + " implied, " + (num(pr.popP) === null ? "not published" : ratioP(pr.popP)) + " real world" },
            h("i", { class: "ft-k is-q", "aria-hidden": "true" }), num(pr.popQ) === null ? UI.dash(noFig("chance of profit on the smile"), "PoP implied") : ratioP(pr.popQ),
            h("i", { class: "ft-k is-p", "aria-hidden": "true" }), num(pr.popP) === null ? UI.dash(noFig("real-world chance of profit"), "PoP real world") : ratioP(pr.popP))),
        h("div", { class: "ft-slot" }, h("span", { class: "ft-slot-l" }, "EV"),
          h("span", { class: "ft-slot-v", "data-tone": evP === null ? "silent" : tone(evP), "aria-label": evP === null ? null : "Expected P&L in the real world " + (evP > 0 ? "+" : "") + usd0(evP) },
            h("i", { class: "ft-k is-p", "aria-hidden": "true" }), evP === null ? UI.dash(noFig("real-world expected P&L"), "EV") : (evP > 0 ? "+" : "") + usd0(evP))),
        h("div", { class: "ft-slot" }, h("span", { class: "ft-slot-l" }, "Risk"),
          h("span", { class: "ft-slot-v", "data-tone": !st.lossUnbounded && num(st.maxLoss) === null ? "silent" : null }, st.lossUnbounded ? "Unbounded" : num(st.maxLoss) === null ? UI.dash(noFig("maximum loss"), "Risk") : usd0(st.maxLoss)))));
    const fmtPl = (v) => (v > 0 ? "+" : "") + usd0(v);
    requestAnimationFrame(() => {
      if (!pay || pay.points.length < 2) { chartHost.append(UI.silent(ST("pending", "The engine published no expiry curve for this structure."), "Payoff", 96)); return; }
      C.payoff(chartHost, { points: pay.points, projected: pay.projected, spot: S, breakevens: st.breakevens || [], height: 92, format: fmtPl,
        maxLabel: st.profitUnbounded ? "∞" : num(st.maxProfit) !== null ? fmtPl(st.maxProfit) : null,
        minLabel: st.lossUnbounded ? MINUS + "∞" : num(st.maxLoss) !== null ? fmtPl(st.maxLoss) : null, label: famWord(st.family) + " P&L at expiry" });
    });
    return card_;
  }

  function standAside(eng) {
    const nt = eng.noTrade || {};
    const why = NO_TRADE[nt.code] || [nt.code || "No trade", nt.code || "no structure cleared the bar"];
    const n = num(eng.priced) !== null ? eng.priced : eng.structures.length;
    const st = nt.closest ? eng.structures.find((x) => x.id === nt.closest) || null : null;
    const evC = st && st.ev ? num(st.ev.p) : null;
    const pr = (st && st.prob) || {};
    const lead = "The engine priced " + n + " structures and stands aside: " + why[1] + "." + (st ? " The closest was " + famWord(st.family).toLowerCase() + " (" + st.id + ")." : "");
    return h("article", { class: "ft-idea ft-aside is-wide", role: "listitem", "data-code": nt.code || "" },
      h("span", { class: "ft-aside-g", "aria-hidden": "true" }, glyph("quiet")),
      h("div", { class: "ft-aside-m" }, h("span", { class: "ft-idea-t" }, "Stand aside"), h("span", { class: "ft-aside-s" }, n + " priced" + SEP + why[0])),
      st ? h("div", { class: "ft-aside-c", "aria-label": "Closest structure" },
        h("span", { class: "ft-aside-l" }, "Closest"), h("b", null, famWord(st.family)),
        h("span", { class: "ft-slot-v", "data-tone": evC === null ? "silent" : tone(evC) }, h("i", { class: "ft-k is-p", "aria-hidden": "true" }), evC === null ? DASH : (evC > 0 ? "+" : "") + usd0(evC)),
        h("span", { class: "ft-slot-v" }, h("i", { class: "ft-k is-q", "aria-hidden": "true" }), num(pr.popQ) === null ? DASH : ratioP(pr.popQ), h("i", { class: "ft-k is-p", "aria-hidden": "true" }), num(pr.popP) === null ? DASH : ratioP(pr.popP))) : null,
      info("standing aside", () => ({ title: "Stand aside", state: "quiet", asOf: eng.asOf || null, lead, facts: st ? ideaFacts(st, null, eng) : [],
        sections: [{ title: "Families", lines: (eng.families || []).map((fm) => famWord(fm.family) + SEP + "score " + fx(fm.score, 2) + (fm.veto && fm.veto.length ? ", vetoed: " + fm.veto.join(", ") : "")) }] })));
  }

  function featureTitle(k) {
    const fs = STATE.neuron && STATE.neuron.context && Array.isArray(STATE.neuron.context.features) ? STATE.neuron.context.features : [];
    const f = fs.find((x) => x && x.key === k);
    return f && f.title ? f.title : BASIS[k] || k;
  }
  function numbersIn(t) { return (String(t || "").match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((v) => v > 0); }
  function legacyIdeaCard(idea, card, i) {
    const S = spotOf(card);
    const tn = dirTone(idea.direction);
    const inv = numbersIn(idea.invalidation);
    const invV = inv.length === 1 ? F.px(inv[0]) : inv.length === 2 ? F.px(inv[0]) + " / " + F.px(inv[1]) : DASH;
    let hz = DASH, hzD = null;
    if (isoOk(idea.horizon)) { hz = day(idea.horizon); hzD = dayDiff(card.sessionDate, idea.horizon) + "d"; }
    else if (/(\d+)\s*session/.test(idea.horizon || "")) hz = RegExp.$1 + " sessions";
    const basis = (idea.restsOn || []).filter((k) => k !== "state").map((k) => BASIS[k] || k);
    const infoId = UI.info(() => ({ title: idea.title, lead: idea.thesis,
      facts: [["Structure", idea.structure], ["Direction", idea.direction], ["Invalidation", idea.invalidation], ["Horizon", idea.horizon],
        ["Robustness", (idea.robustnessWord || "") + (num(idea.robustness) !== null ? " (" + idea.robustness + " of 3)" : "")], ["Rests on", (idea.restsOn || []).map((k) => featureTitle(k)).join(SEP)],
        ["Source", idea.fromState ? "the implied-state engine" : "the model"]],
      notes: ["Strikes, prices, breakevens, probability of profit and expected value come from the structure engine, which this card does not carry yet. The sketch is the structure's shape at expiry, not a priced position."] }));
    const pend = ST("pending", "The structure engine has not priced this idea: this card predates it, so no strike, price or probability is claimed.");
    return h("article", { class: "ft-idea is-legacy ui-enter", role: "listitem", style: { "--i": String(i + 2) }, "data-dir": tn },
      h("div", { class: "ft-idea-h" },
        h("span", { class: "ft-dir", "data-tone": tn, "aria-label": dirWord(tn) }, glyph(tn === "down" ? "down" : tn === "up" ? "up" : "flat")),
        h("button", { class: "ft-idea-t", type: "button", "data-info": infoId, "aria-haspopup": "dialog", "aria-controls": "fxPop" }, idea.structure ? idea.structure[0].toUpperCase() + idea.structure.slice(1) : idea.title),
        C.payoff(null, { structure: idea.structure })),
      h("div", { class: "ft-idea-s" }, idea.fromState ? tag("Implied state", { accent: true }) : null, basis.slice(0, 3).map((b) => tag(b)), UI.robustness(num(idea.robustness) || 0, idea.robustnessWord)),
      h("div", { class: "ft-facts2" },
        h("div", { class: "ft-slot" }, h("span", { class: "ft-slot-l" }, glyph("stop"), "Stop"), h("span", { class: "ft-slot-v" }, invV, inv.length === 1 && S ? h("small", null, " " + F.pct(inv[0] / S - 1, 1, true)) : null)),
        h("div", { class: "ft-slot" }, h("span", { class: "ft-slot-l" }, glyph("cal"), "Horizon"), h("span", { class: "ft-slot-v" }, hz, hzD ? h("small", null, " " + hzD) : null))),
      isIndex(card) ? null : h("div", { class: "ft-slots", "aria-label": "Pricing pending" }, ["PoP", "EV", "Risk"].map((l) => h("div", { class: "ft-slot" }, h("span", { class: "ft-slot-l" }, l), h("span", { class: "ft-slot-v", "data-tone": "silent" }, UI.dash(pend, l))))));
  }

  function stanceOf(card, neuron) {
    const eng = engineOf(card);
    const ctx = neuron && neuron.context && neuron.context.state ? neuron.context.state : null;
    const d = (eng && eng.state && eng.state.direction) || (ctx && ctx.direction) || null;
    if (d) return dirTone(d);
    const ideas = neuron && Array.isArray(neuron.ideas) ? neuron.ideas.map((i) => i.direction).filter(Boolean) : [];
    if (ideas.length) return dirTone(ideas[0]);
    const flow = (ctx && ctx.flow) || (eng && eng.state && eng.state.flow) || null;
    if (flow) return dirTone(flow);
    const sc = num(card.score);
    const band = num(((card.panels || {}).scoreOverlay || {}).deadBand);
    if (sc !== null && band !== null && Math.abs(sc) <= band) return "flat";
    return sc === null ? "flat" : sc < 0 ? "down" : sc > 0 ? "up" : "flat";
  }

  function stateMeta(st) {
    if (!st || st.state === "undetermined") return [];
    const inv = st.invalidation && typeof st.invalidation === "object" ? st.invalidation : null;
    const hz = st.horizon && typeof st.horizon === "object" ? st.horizon : null;
    return [["Flow", st.flow || ("flow" in st ? "no side resolved" : null)], ["Premium", typeof st.premium === "string" ? st.premium : "unreadable"],
      ["Prefer", Array.isArray(st.preferred) && st.preferred.length ? st.preferred.join(SEP) : null],
      ["Avoid", Array.isArray(st.avoid) && st.avoid.length ? st.avoid.join(SEP) : null],
      ["Ends past", inv && num(inv.px) !== null ? String(inv.label || inv.kind || "level").toLowerCase() + " " + inv.px.toFixed(2) : null],
      ["Horizon", hz ? (hz.kind === "priced_sessions" ? hz.value + " sessions" : String(hz.value) + (num(hz.days) !== null ? " (" + hz.days + "d)" : "")) : null]];
  }

  function coverageLine(ctx) {
    const c = ctx && ctx.coverage;
    if (!c || num(c.features) === null) return null;
    return "Neuron read " + c.read + " of " + c.features + " features (" + c.robust + " robust" + SEP + c.fair + " fair" + SEP + c.weak + " weak" + SEP + c.withheld + " withheld); nothing here is advice.";
  }

  function cardRead(card, n) {
    const st = [n.context && n.context.state, card.engine && card.engine.state].find((x) => x && x.state && x.state !== "undetermined");
    const sc = num(card.score);
    if (st) {
      const sp = st.state.replace("-", " "), fl = st.state === "transitional", c = num(st.confidence), flow = str(st.flow) || str(st.direction);
      return { text: str(st.brief) || "The greeks imply " + (fl ? "a transitional state on the flip" : (/^[aeiou]/.test(sp) ? "an " : "a ") + sp + " state") + " for " + card.ticker + (flow ? " with flow " + flow : "") + (c === null ? "" : " (confidence " + c + " of 3)") + ".",
        st, word: str(st.word) || (fl ? "On the flip" : cap(sp)), stale: st.stale };
    }
    return sc === null ? null : { text: card.ticker + " scores " + F.signed(sc) + " of ±100" + (num(card.conviction) === null ? "" : ", conviction " + card.conviction) + ".", st: null };
  }

  function renderVerdict(card, neuron) {
    verdictEl.hidden = false;
    verdictEl.replaceChildren();
    const eng = engineOf(card);
    const n = neuron || { status: "unavailable" };
    const ok = n.status === "ok" && typeof n.summary === "string" && n.summary.trim();
    const own = ok ? null : cardRead(card, n);
    const tn = stanceOf(card, n);
    const head = h("div", { class: "ft-v-h" }, h("span", { class: "ft-neuron", "aria-hidden": "true" }, glyph("neuron")));
    const mid = h("div", { class: "ft-v-m" });
    const entries = ideaEntries(card, n);
    verdictEl.dataset.read = ok ? "neuron" : own ? "card" : "none";
    if (ok || own) {
      const said = ok ? n.summary.trim() : own.text;
      const caveat = ok ? (said.startsWith(STALE_LEAD) && said.length > STALE_LEAD.length + 1 ? STALE_LEAD : null) : own.stale ? STALE_LEAD : null;
      const body = ok && caveat ? said.slice(caveat.length).trim() : said;
      const [one, cut] = headline(body);
      mid.append(h("h2", { class: "ft-v-line", id: "ftVerdictT" }, typo(one)));
      const grades = ok ? entries.map((e) => (e.kind === "engine" ? (e.st ? vettedGrade(e.st, e.n) : null) : num(e.idea.robustness))).filter((v) => v !== null) : [];
      const st = ok ? (n.context && n.context.state ? n.context.state : null) : own.st;
      const word = ok ? (n.verdictWord || (st && st.word && st.state !== "undetermined" ? st.word : null)) : own.word;
      mid.append(h("div", { class: "ft-v-meta" },
        UI.capsule(dirWord(tn), { tone: tn }),
        caveat ? UI.stateButton(ST("stale", caveat), "Neuron") : null,
        word ? tag(word, { accent: true }) : null,
        grades.length ? h("span", { class: "ui-key" }, UI.robustness(Math.max(...grades)), "Robustness") : null,
        ok && n.generatedAt ? h("span", { class: "ui-key" }, glyph("clock"), F.time(n.generatedAt)) : null));
      const rest = cap(body.slice(cut).trim());
      const xid = "ftVerdictX";
      const meta = st ? stateMeta(st) : [];
      const src = ok ? (n.provenance || (n.llm ? "Worded by " + String(n.model || "the model").replace(/^@cf\//, "") : "Deterministic read, no model wording"))
        : "Read from the card, no model wording." + (n.status === "pending" ? " The Neuron's wording replaces it when it lands." : "");
      const x = h("div", { class: "ft-v-x", id: xid }, h("div", null,
        caveat ? h("p", null, caveat) : null,
        rest ? h("p", null, typo(rest)) : null,
        st && st.chip ? h("p", { class: "ft-v-chip", id: "ftStateChip" }, st.chip) : null,
        meta.length ? h("dl", { class: "ft-v-dl", id: "ftStateMeta" }, meta.filter((m) => m[1]).map(([k, v]) => [h("dt", null, k), h("dd", null, v)])) : null,
        h("p", { class: "ft-v-src", id: "ftVerdictSrc" }, src),
        coverageLine(n.context) ? h("p", { class: "ft-v-src", id: "ftNeuronCov" }, coverageLine(n.context)) : null,
        ok && Array.isArray(n.refused) && n.refused.length ? h("p", { class: "ft-v-src" }, n.refused.length + " of the model's answers were refused (" + [...new Set(n.refused.map((r) => r && r.code).filter(Boolean))].join(", ") + ").") : null));
      const more = h("button", { class: "ft-more", type: "button", "aria-expanded": "false", "aria-controls": xid }, "More", glyph("chev"));
      more.addEventListener("click", () => { const o = more.getAttribute("aria-expanded") !== "true"; more.setAttribute("aria-expanded", String(o)); x.classList.toggle("is-open", o); });
      head.append(mid, more);
      verdictEl.append(head, x);
    } else {
      const status = typeof n.status === "string" ? n.status : "unavailable";
      const reason = status === "pending" ? "Not published yet." : status === "quiet" ? "This card carries no reading to summarise." : "No read could be fetched for this name.";
      const st = ST(status === "pending" ? "pending" : status === "quiet" ? "quiet" : "unavailable", reason);
      mid.append(h("h2", { class: "ft-v-line is-empty", id: "ftVerdictT" }, "No read"));
      mid.append(h("div", { class: "ft-v-meta" }, UI.capsule(dirWord(tn), { tone: tn }), UI.stateButton(st, "Neuron")));
      head.append(mid);
      verdictEl.append(head);
    }
    const row = h("div", { class: "ft-ideas", role: "list", "aria-label": "Trade ideas" });
    if (entries.length) {
      entries.forEach((e, i) => row.append(e.kind === "engine" ? engineIdeaCard(e, card, i, eng) : legacyIdeaCard(e.idea, card, i)));
    } else if (eng && eng.noTrade) {
      row.append(standAside(eng));
    } else if (!eng && !isIndex(card)) {
      row.append(h("article", { class: "ft-idea is-silent is-wide is-bare", role: "listitem" },
        UI.silent(ST("pending", "The options engine has not priced this name yet, and the Neuron published no idea; structures appear here once the engine prices this card."), "Ideas", 64)));
    }
    if (!row.childElementCount) return;
    row.classList.toggle("is-single", row.childElementCount === 1 && row.firstElementChild.classList.contains("is-wide"));
    verdictEl.append(row);
    if (entries.some((e) => e.kind === "engine" && e.st)) {
      verdictEl.append(h("div", { class: "ft-ideas-k" }, legend([keyOf("--label-1", "ln", "At expiry"), dashKey("--accent", "Today"), keyOf("--accent", "dot", "Implied"), keyOf("--label-2", "dot", "Real world")])));
    }
    const cut = () => {
      const max = row.scrollWidth - row.clientWidth;
      row.classList.toggle("is-cut-start", max > 1 && row.scrollLeft > 1);
      row.classList.toggle("is-cut-end", max > 1 && row.scrollLeft < max - 1);
    };
    row.addEventListener("scroll", cut, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(cut).observe(row);
    requestAnimationFrame(cut);
  }

  function mod(o) {
    const info = o.info && o.views && o.views.length > 1 ? () => { const d = o.info() || {}; return { ...d, sections: (d.sections || []).concat([{ title: "Coverage", lines: [coverageOf(o.views)] }]) }; } : o.info;
    const sec = UI.moduleCard({ id: o.id, title: o.title, state: o.st && o.st.state !== "ok" ? o.st : null, robustness: o.robustness, seg: o.seg || null,
      info, infoLabel: o.infoLabel || String(o.title).toLowerCase(), body: o.body, index: o.index || 0, enter: STATE.first });
    sec.classList.add("ft-m", "ft-lg" + o.span[1], "ft-md" + o.span[0]);
    const old = document.getElementById(o.id);
    if (old && old.parentNode === gridEl) old.replaceWith(sec); else gridEl.append(sec);
    return sec;
  }

  function viewer(label, all, first) {
    const list = all.filter((v) => !v.never);
    const box = h("div", { class: "ft-cbox" });
    const leg = h("div", { class: "ft-leg-row" });
    let cur = first !== undefined && list[first] && list[first].st.state === "ok" ? first : list.findIndex((v) => v.st.state === "ok");
    if (cur < 0) cur = 0;
    let handle = null;
    const show = (i) => {
      cur = i;
      if (handle && handle.destroy) handle.destroy();
      handle = null;
      box.replaceChildren();
      leg.replaceChildren();
      const v = list[i];
      if (v.st.state !== "ok") { box.append(UI.silent(v.st, v.name || v.label, v.h || 220)); return; }
      const host = h("div", { class: "ft-view", "data-view": v.label });
      box.append(host);
      const r = v.draw(host) || {};
      handle = r.handle || null;
      if (r.legend && r.legend.length) leg.append(legend(r.legend));
    };
    const seg = list.length > 1 ? UI.segmented(label, list.map((v) => ({ label: v.label })), show, cur) : null;
    return { seg, box, leg, start: () => show(cur), views: list };
  }

  const heightOf = (w, hs) => (w < 600 ? hs[0] : w < 900 ? hs[1] : hs[2]);
  const moneyPx = (v) => F.money(v, true);

  function worldsExpiry(eng, lead) {
    const ex = Array.isArray(eng.expiries) ? eng.expiries.filter((e) => e && e.smile && e.forward) : [];
    if (!ex.length) return { list: ex, pick: -1 };
    let pick = lead ? ex.findIndex((e) => e.expiry === lead.expiry) : -1;
    if (pick < 0) {
      const pm = (STATE.card.panels || {}).pricedMove;
      const want = pm && num(pm.sessions) ? pm.sessions : 10;
      pick = ex.reduce((b, e, i) => (Math.abs((e.sessions || 0) - want) < Math.abs((ex[b].sessions || 0) - want) ? i : b), 0);
    }
    return { list: ex, pick };
  }

  const WORLD_CELLS = 40;
  function worldsData(eng, exp) {
    const FQ = window.FlowsQuant;
    if (!FQ || typeof FQ.sliceFromSummary !== "function") return { st: ST("unavailable", "The pricing module did not load, so the two distributions cannot be drawn on this page.") };
    const slice = FQ.sliceFromSummary(exp);
    if (!slice) return { st: ST("unavailable", "The " + exp.expiry + " expiry carries no fitted smile.") };
    const S = num(eng.spot);
    const pLaw = eng.pLaw ? FQ.lawAtSessions(eng.pLaw, { sessions: exp.sessions, forwardOverSpot: slice.F / S, S }) : null;
    const qCdf = (x) => FQ.riskNeutralCdf(slice, x);
    const pCdf = pLaw ? (x) => FQ.lawIntervalsProb(pLaw, [[0, x]]) : null;
    const pQ = (u) => { if (!pCdf) return null; let lo = S * 0.2, hi = S * 3; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (pCdf(m) < u) lo = m; else hi = m; } return (lo + hi) / 2; };
    const qQ = (u) => FQ.riskNeutralQuantile(slice, u);
    const ends = [qQ(0.004), qQ(0.996)].concat(pCdf ? [pQ(0.004), pQ(0.996)] : []).filter((v) => num(v) !== null);
    const lo = Math.min(...ends, S * 0.97), hi = Math.max(...ends, S * 1.03);
    const dx = (hi - lo) / WORLD_CELLS;
    const xs = [], q = [], p = [];
    let qa = qCdf(lo), pa = pCdf ? pCdf(lo) : null;
    for (let i = 0; i < WORLD_CELLS; i++) {
      const b = lo + (i + 1) * dx;
      const qb = qCdf(b), pb = pCdf ? pCdf(b) : null;
      xs.push(lo + (i + 0.5) * dx);
      q.push(Math.max(0, qb - qa) / dx);
      p.push(pCdf ? Math.max(0, pb - pa) / dx : null);
      qa = qb; pa = pb;
    }
    const band = (fn) => (fn ? [fn(0.1587), fn(0.8413)] : null);
    const qBand = band(qQ), pBand = pCdf ? band(pQ) : null;
    const lerp = (arr, x) => {
      const t = clamp((x - xs[0]) / dx, 0, xs.length - 1), i = Math.min(xs.length - 2, Math.floor(t));
      return arr[i] + (arr[i + 1] - arr[i]) * (t - i);
    };
    return { st: pCdf ? OK : ST("quiet", "The card carries no real-world law for this horizon, so only the implied distribution is drawn."), S, lo, hi, dx, xs, q, p, lerp, qCdf, pCdf, qBand, pBand, exp, F: slice.F };
  }

  function buildWorlds(card) {
    const eng = engineOf(card);
    const ideas = ideaEntries(card, STATE.neuron).filter((e) => e.kind === "engine" && e.st);
    const lead = ideas.length ? ideas[0].st : null;
    const title = "Two worlds";
    if (!eng && isIndex(card)) return;
    if (!eng) {
      const st = ST("pending", "The options engine has not priced this name yet. The two distributions need its smile fit per expiry (the market's risk-neutral density) and its real-world GARCH law.");
      mod({ id: "m-worlds", title, span: [12, 8], st, body: [UI.silent(st, title, 260)], index: 2,
        info: () => ({ title: "Two worlds", state: "pending", lead: st.reason }) });
      return;
    }
    const { list, pick } = worldsExpiry(eng, lead);
    if (pick < 0) {
      const st = ST("unavailable", "The engine block carries no fitted expiry to draw a density from.");
      mod({ id: "m-worlds", title, span: [12, 8], st, body: [UI.silent(st, title, 260)], index: 2, info: () => ({ title, state: st.state, lead: st.reason }) });
      return;
    }
    const metricsBox = h("div");
    let curExp = list[pick];
    const keep = new Set([list[pick]]);
    for (const want of [7, 30, 90, 180]) {
      const c = list.filter((e) => !keep.has(e)).sort((a, b) => Math.abs((a.dte || 0) - want) - Math.abs((b.dte || 0) - want))[0];
      if (c && keep.size < 5) keep.add(c);
    }
    const shown = list.filter((e) => keep.has(e)).sort((a, b) => (a.dte || 0) - (b.dte || 0));
    const views = shown.map((e) => ({ label: (e.dte || "?") + "d", name: title + " " + e.expiry, st: OK, draw: (host) => { curExp = e; return drawWorlds(host, card, eng, e, lead, metricsBox); } }));
    const vw = viewer("Horizon", views, shown.indexOf(list[pick]));
    mod({ id: "m-worlds", title, span: [12, 8], seg: vw.seg, views: vw.views, body: [metricsBox, vw.box, vw.leg], index: 2,
      info: () => {
        const e = curExp;
        const d = worldsData(eng, e);
        return {
          title: "Two worlds", asOf: eng.asOf || null,
          lead: "The market's price of the future against the future this name's own history implies, on one price axis at the " + e.expiry + " expiry (" + e.dte + " days, " + e.sessions + " sessions).",
          facts: [["Implied (Q)", "the risk-neutral density of the fitted " + (e.smile.method || "smile").toUpperCase() + " smile, forward " + F.px(e.forward.F)],
            ["Real world (P)", eng.pLaw ? "the engine's " + (eng.pLaw.model || "real-world").toUpperCase() + " law at " + e.sessions + " sessions, drift-neutral to the forward" : null],
            ["Implied 68% range", d.qBand ? F.px(d.qBand[0]) + " – " + F.px(d.qBand[1]) : null], ["Real-world 68% range", d.pBand ? F.px(d.pBand[0]) + " – " + F.px(d.pBand[1]) : null],
            ["Smile fit", e.smile ? "RMSE " + fx(e.smile.rmseIvPts, 3) + " vol pts" + SEP + e.smile.n + " strikes" : null], ["Law grade", eng.pLaw ? String(eng.pLaw.grade) + " of 3" : null],
            ["Horizons", shown.length < list.length ? shown.length + " of " + list.length + " fitted expiries: the lead idea's and those nearest one week, one month, three and six months" : null]],
          notes: ["Scrub the chart to read the probability of finishing below any price under each world, and the gap between them in points. Where the real world puts more weight than the market, the market is charging less than history implies; where it puts less, the market is charging more.",
            lead ? "Dashed rules are the lead idea's breakevens; the strip under the axis is where it makes (green) or loses (red) money at expiry." : null,
            d.xs ? "Both curves stand on the same " + d.xs.length + " price cells of $" + F.px(d.dx) + ": each cell's height is that world's exact probability of finishing inside it, differenced from its own distribution function and divided by the width, so the area under either curve between two prices is that world's probability and the two are drawn at one resolution. The line joins the cells; the scrubbed figures are read from the distribution functions themselves." : null],
        };
      } });
    vw.start();
  }

  function drawWorlds(host, card, eng, e, lead, metricsBox) {
    const d = worldsData(eng, e);
    if (!d.xs) { host.append(UI.silent(d.st, "Two worlds", 260)); return {}; }
    const S = d.S;
    const half = (b) => (b ? (b[1] - b[0]) / 2 / S : null);
    const qm = half(d.qBand), pmv = half(d.pBand);
    const leadHere = lead && lead.expiry === e.expiry ? lead : null;
    const popQ = leadHere && leadHere.prob ? leadHere.prob.popQ : null, popP = leadHere && leadHere.prob ? leadHere.prob.popP : null;
    metricsBox.replaceChildren(mets([
      metric("Implied", qm === null ? DASH : "±" + F.pct(qm), { key: keyOf("--accent", "dot", ""), sub: day(e.expiry) + SEP + e.sessions + " sessions" }),
      metric("Real world", pmv === null ? DASH : "±" + F.pct(pmv), { key: keyOf("--label-2", "dot", ""), sub: eng.pLaw ? String(eng.pLaw.model || "law").toUpperCase() : null, state: pmv === null ? d.st : null }),
      metric("Premium", qm !== null && pmv ? F.pct(qm / pmv - 1, 0, true) : DASH, { tone: qm !== null && pmv ? (qm > pmv ? "short" : qm < pmv ? "long" : null) : null, sub: qm !== null && pmv ? (qm > pmv ? "Market wider" : qm < pmv ? "Market narrower" : "Level") : null }),
      metric("Lead PoP", num(popP) === null ? DASH : ratioP(popP), { sub: num(popQ) === null ? null : ratioP(popQ) + " implied", state: leadHere ? null : ST("quiet", lead ? "The lead idea expires " + lead.expiry + ", not at this horizon." : "No priced idea leads this card.") }),
    ], { min: 104 }));
    const handle = C.mount(host, (el, w, animate) => {
      const H = heightOf(w, [220, 250, 270]);
      const top = 34, bot = 44, left = 6, right = 6;
      const x = C.lin(d.lo, d.hi, left, w - right);
      const ymax = Math.max(...d.q, ...d.p.filter((v) => v !== null)) * 1.08 || 1;
      const base = H - bot;
      const y = C.lin(0, ymax, base, top);
      const svg = C.svgRoot(el, w, H, animate, card.ticker + " implied and real-world distributions at " + e.expiry);
      const accent = cssVar("--accent"), pInk = cssVar("--label-2");
      if (leadHere) {
        const pay = payoffPoints(leadHere, S);
        if (pay && pay.points.length > 1) {
          const P0 = pay.points;
          const at = (xv) => { for (let i = 1; i < P0.length; i++) if (xv <= P0[i][0]) { const a = P0[i - 1], b = P0[i]; return a[1] + (b[1] - a[1]) * (xv - a[0]) / ((b[0] - a[0]) || 1); } return P0[P0.length - 1][1]; };
          const sy = base + 8;
          const g = s("g", { class: "fade", style: { "--delay": "700ms" } }, svg);
          let runStart = d.lo, runSign = Math.sign(at(d.lo));
          const flush = (a, b, sg) => { if (b <= a) return; s("rect", { x: x(a), y: sy, width: Math.max(1, x(b) - x(a)), height: 4, rx: 2, fill: cssVar(sg > 0 ? "--up-mark" : "--down-mark"), "fill-opacity": 0.85 }, g); };
          for (let i = 1; i <= 120; i++) {
            const xv = d.lo + (d.hi - d.lo) * i / 120;
            const sg = Math.sign(at(xv));
            if (sg !== runSign || i === 120) { flush(runStart, xv, runSign); runStart = xv; runSign = sg; }
          }
          for (const b of leadHere.breakevens || []) {
            if (num(b) === null || b < d.lo || b > d.hi) continue;
            s("line", { x1: x(b), x2: x(b), y1: top, y2: base, stroke: cssVar("--label-3"), "stroke-width": 1, "stroke-dasharray": "3 3" }, g);
            C.marker(g, "ring", x(b), sy + 2, cssVar("--label-1"), 4);
          }
        }
      }
      const path = (vals) => C.monoPath(d.xs.map((xv, i) => [x(xv), y(vals[i])]));
      const area = (vals) => path(vals) + `L${x(d.xs[d.xs.length - 1]).toFixed(1)} ${base}L${x(d.xs[0]).toFixed(1)} ${base}Z`;
      if (d.pCdf) s("path", { d: area(d.p), fill: C.vGrad(svg, pInk, 0.2, 0.03), class: "fade", style: { "--delay": "300ms" } }, svg);
      s("path", { d: area(d.q), fill: C.vGrad(svg, accent, 0.3, 0.04), class: "fade", style: { "--delay": "250ms" } }, svg);
      if (d.pCdf) s("path", { d: path(d.p), class: "ln draw ft-wp", stroke: pInk, "stroke-width": 1.5, pathLength: 1, style: { "--delay": "160ms" } }, svg);
      s("path", { d: path(d.q), class: "ln draw ft-wq", stroke: accent, pathLength: 1 }, svg);
      s("line", { x1: left, x2: w - right, y1: base, y2: base, class: "base" }, svg);
      const lg = s("g", { class: "fade", style: { "--delay": "600ms" } }, svg);
      for (const l of levelList(card)) {
        if (l.px < d.lo || l.px > d.hi) continue;
        const def = C.LEVELS[l.kind];
        C.marker(lg, def.shape, x(l.px), base - 6, cssVar(def.color), 3.4);
      }
      const sx = x(S);
      s("line", { x1: sx, x2: sx, y1: top - 10, y2: base, stroke: cssVar("--label-1"), "stroke-width": 1.25 }, svg);
      const st = F.px(S), pw = st.length * 6.4 + 12;
      const px0 = clamp(sx - pw / 2, 0, w - pw);
      s("rect", { x: px0, y: top - 28, width: pw, height: 18, rx: 9, fill: cssVar("--label-1") }, svg);
      s("text", { x: px0 + pw / 2, y: top - 15.5, text: st, "text-anchor": "middle", class: "tx-b tx-ink" }, svg);
      for (const t of C.niceTicks(d.lo, d.hi, w < 600 ? 4 : 6)) if (Math.abs(x(t) - sx) > 26) s("text", { x: x(t), y: H - 6, text: String(t), "text-anchor": "middle" }, svg);
      const fine = [];
      for (let k = 0; k <= 120; k++) fine.push(d.xs[0] + (d.xs[d.xs.length - 1] - d.xs[0]) * k / 120);
      C.scrub(el, svg, {
        xs: fine.map(x), top, bottom: base, label: "Implied against real-world distribution",
        onMove: (i) => {
          const xv = fine[i];
          const qc = d.qCdf(xv), pc = d.pCdf ? d.pCdf(xv) : null;
          const gap = pc === null ? null : pc - qc;
          return {
            dots: [{ x: x(xv), y: y(d.lerp(d.q, xv)), color: "--accent" }].concat(d.pCdf ? [{ x: x(xv), y: y(d.lerp(d.p, xv)), color: "--label-2" }] : []),
            parts: [C.part("Below " + F.px(xv), "k"), C.part("Q", "k"), h("b", null, ratioP(qc)), pc === null ? null : C.part("P", "k"), pc === null ? null : h("b", null, ratioP(pc)),
              gap === null ? null : C.part((gap > 0 ? "+" : gap < 0 ? MINUS : "") + Math.abs(gap * 100).toFixed(0) + " pts", null, Math.abs(gap) < 0.005 ? null : gap > 0 ? "long" : gap < 0 ? "short" : null)],
          };
        },
      });
    });
    return { handle, legend: [keyOf("--accent", "", "Implied"), d.pCdf ? keyOf("--label-2", "ln", "Real world") : null, keyOf("--label-1", "ln", "Spot"),
      leadHere ? keyOf("--label-1", "ring", "Breakeven") : null, leadHere ? keyOf("--up-mark", "", "Profit") : null,
      ...Object.values(levelsOf(card)).filter((l) => LVL_KEY[l.kind] && l.px >= d.lo && l.px <= d.hi).map((l) => keyOf(...LVL_KEY[l.kind]))] };
  }

  const RAMP_OPACITY = [0.24, 0.43, 0.62, 0.81, 1];
  const RAMP_FACTORS = [1.5, 2, 3, 5, 10];
  function surfaceRamp(sf) {
    const cap = num(sf.scaleCap) !== null && sf.scaleCap > 0 ? sf.scaleCap : null;
    if (!cap) return null;
    const mags = [];
    for (const row of sf.grid) for (const v of row) if (num(v) !== null && v !== 0) mags.push(Math.abs(v));
    mags.sort((a, b) => a - b);
    if (!mags.length) return null;
    const at = (p) => mags[Math.min(mags.length - 1, Math.max(0, Math.round(p * (mags.length - 1))))];
    const top = Math.min(cap, at(0.98));
    if (!(top > 0)) return null;
    const bottom = Math.max(at(0.1), top / 1e4);
    const steps = RAMP_OPACITY.length;
    let factor = RAMP_FACTORS[RAMP_FACTORS.length - 1];
    if (top > bottom * 1.05) {
      const want = Math.pow(top / bottom, 1 / steps);
      factor = RAMP_FACTORS.reduce((a, b) => (Math.abs(Math.log(b) - Math.log(want)) < Math.abs(Math.log(a) - Math.log(want)) ? b : a));
    }
    const lg = Math.log(factor);
    return { cap, top, factor, floor: top / Math.pow(factor, steps - 1),
      shade: (v) => RAMP_OPACITY[clamp(steps - 1 - Math.floor(Math.log(top / Math.abs(v)) / lg + 1e-9), 0, steps - 1)] };
  }

  function gammaGrid(host, card, sf) {
    const lv = levelsOf(card);
    const cap = num(sf.scaleCap) !== null && sf.scaleCap > 0 ? sf.scaleCap : null;
    const ramp = surfaceRamp(sf);
    const order = sf.strikes.map((k, i) => i).reverse();
    const atS = num(sf.atSpot);
    const walls = { call: lv.call_wall ? lv.call_wall.px : null, put: lv.put_wall ? lv.put_wall.px : null };
    const label = card.ticker + " gamma by strike (rows) and expiry (columns); " + (ramp ? "shade steps by a factor of " + ramp.factor + " up to " + F.num(ramp.top) + " Γ" : "shade carries no magnitude") + (cap ? ", slashed cells are beyond the colour cap" : "") +
      "; hatched cells are short gamma, dotted cells were measured at exactly zero, and dashed outlines are strike and expiry pairs the vendor did not return";
    return C.mount(host, (el, w, animate) => {
      const R = order.length, N = sf.expiries.length;
      const phone = w < 600;
      const left = phone ? 50 : 58, top = 20, bottom = 4, right = 2;
      const ch = phone ? 14 : 16;
      const cw = (w - left - right) / N;
      const H = top + R * ch + bottom;
      const svg = C.svgRoot(el, w, H, animate, label);
      const pid = "ftHatch" + Math.random().toString(36).slice(2, 8);
      const defs = s("defs", null, svg);
      const pat = s("pattern", { id: pid, width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
      s("line", { x1: 0, y1: 0, x2: 0, y2: 5, stroke: cssVar("--label-1"), "stroke-opacity": 0.35, "stroke-width": 1.4 }, pat);
      sf.expiries.forEach((e, c) => s("text", { x: left + c * cw + cw / 2, y: 12, text: day(e), "text-anchor": "middle", class: "tx-3 ft-gx" }, svg));
      const every = R > 18 ? 2 : 1;
      const pos = cssVar("--g-long"), neg = cssVar("--g-short");
      order.forEach((i, r) => {
        const k = sf.strikes[i];
        const yy = top + r * ch;
        const isSpot = atS !== null && Math.abs(k - atS) < 1e-9;
        const wall = walls.call !== null && Math.abs(k - walls.call) < 1e-9 ? "call" : walls.put !== null && Math.abs(k - walls.put) < 1e-9 ? "put" : null;
        if (r % every === 0 || isSpot || wall) s("text", { x: left - (wall ? 14 : 6), y: yy + ch / 2 + 3.5, text: K(k), "text-anchor": "end", class: "ft-gy" + (isSpot ? " tx-1 tx-b" : "") }, svg);
        if (wall) s("circle", { cx: left - 7, cy: yy + ch / 2, r: 3, fill: cssVar(wall === "call" ? "--lvl-call" : "--lvl-put"), class: "ft-gw is-" + wall }, svg);
        if (isSpot) s("rect", { x: left - 1, y: yy, width: w - left - right + 2, height: ch, rx: 3, fill: "none", stroke: cssVar("--label-1"), "stroke-width": 1, class: "ft-gs" }, svg);
        for (let c = 0; c < N; c++) {
          const v = sf.grid[i] ? sf.grid[i][c] : null;
          const xx = left + c * cw;
          const box = { x: xx + 1, y: yy + 1, width: Math.max(0, cw - 2), height: ch - 2, rx: 2.5 };
          if (v === null || v === undefined || num(v) === null) { s("rect", { ...box, x: xx + 1.5, y: yy + 1.5, width: Math.max(0, cw - 3), height: ch - 3, fill: "none", stroke: cssVar("--label-4"), "stroke-dasharray": "2 2", class: "ft-gv is-void" }, svg); continue; }
          if (v === 0) {
            s("rect", { ...box, fill: cssVar("--fill-4"), class: "ft-gv is-zero" }, svg);
            s("circle", { cx: xx + cw / 2, cy: yy + ch / 2, r: 1.6, fill: cssVar("--label-3"), class: "ft-gz" }, svg);
            continue;
          }
          const a = ramp ? ramp.shade(v) : 0.6;
          s("rect", { ...box, fill: v > 0 ? pos : neg, "fill-opacity": a.toFixed(3), class: "ft-gv " + (v > 0 ? "is-pos" : v < 0 ? "is-neg" : "is-zero") + " fade", style: { "--delay": c * 40 + "ms" } }, svg);
          if (v < 0) s("rect", { ...box, fill: "url(#" + pid + ")", class: "ft-gh" }, svg);
          if (cap && Math.abs(v) > cap) {
            const m = Math.min(cw, ch) - 6;
            const cx = xx + cw / 2, cy = yy + ch / 2;
            s("line", { x1: cx - m / 2, y1: cy + m / 2, x2: cx + m / 2, y2: cy - m / 2, stroke: cssVar("--label-1"), "stroke-width": 1.5, "stroke-linecap": "round", class: "ft-gc" }, svg);
          }
        }
      });
      const hl = s("rect", { class: "cell-hl", x: -99, y: -99, width: Math.max(0, cw - 1), height: ch - 1, rx: 3 }, svg);
      const readout = h("div", { class: "ui-readout", "aria-hidden": "true" });
      el.append(readout);
      el.tabIndex = 0;
      el.setAttribute("role", "group");
      el.setAttribute("aria-roledescription", "chart");
      el.setAttribute("aria-label", label + ". Use the arrow keys to move between cells.");
      let cur = [Math.max(0, order.findIndex((i) => atS !== null && Math.abs(sf.strikes[i] - atS) < 1e-9)), N - 1];
      const show = (r, c) => {
        cur = [r, c];
        const i = order[r], v = sf.grid[i] ? sf.grid[i][c] : null;
        hl.setAttribute("x", left + c * cw + 0.5);
        hl.setAttribute("y", top + r * ch + 0.5);
        readout.replaceChildren(C.part(day(sf.expiries[c]), "k"), h("b", null, K(sf.strikes[i])),
          num(v) === null ? C.part("not returned", "k") : v === 0 ? C.part("measured zero", "k") : C.part(F.num(v, true) + " Γ" + (cap && Math.abs(v) > cap ? " (off scale)" : ""), null, v > 0 ? "long" : v < 0 ? "short" : null));
        readout.classList.add("is-on");
        const rw = readout.offsetWidth;
        readout.style.left = clamp(left + c * cw + cw / 2 - rw / 2, 0, Math.max(0, w - rw)) + "px";
        readout.style.top = Math.max(0, top + r * ch - 32) + "px";
      };
      const hide = () => { readout.classList.remove("is-on"); hl.setAttribute("x", -99); };
      el.addEventListener("pointermove", (e) => {
        const b = svg.getBoundingClientRect();
        const c = Math.floor((e.clientX - b.left - left) / cw), r = Math.floor((e.clientY - b.top - top) / ch);
        if (c >= 0 && c < N && r >= 0 && r < R) show(r, c); else hide();
      });
      el.addEventListener("pointerleave", hide);
      el.addEventListener("blur", hide);
      el.addEventListener("keydown", (e) => {
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        if (!d) { if (e.key === "Escape") hide(); return; }
        e.preventDefault();
        show(clamp(cur[0] + d[0], 0, R - 1), clamp(cur[1] + d[1], 0, N - 1));
      });
    });
  }

  function hatchKey(color, label) {
    const k = keyOf(color, "", label);
    k.firstChild.classList.add("ft-hatch");
    return k;
  }
  function gridLegend(sf) {
    const r = surfaceRamp(sf);
    const ramp = r ? h("span", { class: "ui-key ft-ramp", role: "img", "aria-label": "Shade steps by a factor of " + r.factor + " from " + F.num(r.floor) + " up to " + F.num(r.top) + " Γ" },
      h("span", { class: "ft-ramp-s", "aria-hidden": "true" }, RAMP_OPACITY.map((o) => h("i", { style: { "--c": cssVar("--g-long"), opacity: String(o) } }))),
      F.num(r.floor) + " – " + F.num(r.top) + " Γ") : null;
    return [ramp, keyOf("--g-long", "", "Long γ"), hatchKey("--g-short", "Short γ"), keyOf("--label-3", "dot", "Zero"), keyOf("--label-4", "ring", "Not returned"), r ? keyOf("--label-1", "ln", "Off scale") : null];
  }
  function gridNotes(sf) {
    const cap = num(sf.scaleCap) !== null && sf.scaleCap > 0 ? sf.scaleCap : null;
    const ramp = surfaceRamp(sf);
    const voids = sf.grid.reduce((a, row) => a + row.filter((v) => num(v) === null).length, 0);
    const zeros = sf.grid.reduce((a, row) => a + row.filter((v) => v === 0).length, 0);
    const clipped = num(sf.clipped) || 0;
    return [
      ramp ? "Shade steps by a factor of " + ramp.factor + " from " + F.num(ramp.floor) + " up to " + F.num(ramp.top) + " Γ, darker for more gamma, in five steps read off the grid's own cells, so the bulk of the book is not washed out by its largest cell." : null,
      cap ? "Colour is capped at " + F.num(cap) + " Γ; " + (clipped ? clipped + (clipped === 1 ? " cell exceeds it (peak " + F.num(sf.peak) + " Γ) and is" : " cells exceed it (peak " + F.num(sf.peak) + " Γ) and are") + " drawn at full strength with a slash." : "no cell exceeds it.")
        : "This surface was published before the colour scale existed, so shade carries no magnitude here: a flat-looking grid is not a uniform book.",
      "Short-gamma cells are hatched as well as coloured, so sign survives without hue.",
      zeros ? zeros + (zeros === 1 ? " pair was" : " pairs were") + " measured at exactly zero, drawn with a dot: zero is neither long nor short." : null,
      voids ? voids + (voids === 1 ? " strike and expiry pair was" : " strike and expiry pairs were") + " not returned by the vendor and " + (voids === 1 ? "is" : "are") + " drawn as a dashed outline, not as zero." : null,
      num(sf.strikesTotal) !== null && sf.strikesTotal > sf.strikesShown ? "The grid shows " + sf.strikesShown + " of " + sf.strikesTotal + " strikes, the band around spot." : null,
    ];
  }

  function pathLegs(card) {
    const tp = STATE.tape && STATE.tape.prem && STATE.tape.prem.status === "ok" && Array.isArray(STATE.tape.prem.t) && STATE.tape.prem.t.length > 1 ? STATE.tape.prem : null;
    if (tp) {
      const d = Array.isArray(tp.nd) ? tp.nd.map((v) => num(v)) : tp.t.map(() => null);
      const u = STATE.tape.units || {};
      return { src: "tape", times: tp.t.map((t) => F.time(t)), d, p: tp.net.map((v) => num(v)), calls: tp.ncp, puts: tp.npp, centroid: null, dUnit: str(u.nd), pUnit: str(u.net) };
    }
    const P = (card.panels || {}).path;
    if (!P || P.status !== "ok" || !Array.isArray(P.series)) return null;
    const start = Date.parse(P.startedAt);
    const ser = P.series.filter((r) => Array.isArray(r));
    const step = ser.length > 1 && num(P.minutes) ? P.minutes / ser.length : 5;
    return { src: "card", times: ser.map((_, i) => (Number.isFinite(start) ? F.time(new Date(start + (i + 1) * step * 60000).toISOString()) : String(i + 1))), d: ser.map((r) => num(r[0])), p: ser.map((r) => num(r[1])),
      centroid: num(P.centroid), dUnit: P.netDeltaUnit || null, pUnit: P.netPremiumUnit || null, panel: P };
  }

  function pathChart(host, card, L) {
    const hasP = L.p.some((v) => num(v) !== null && v !== 0);
    const mD = Math.max(...L.d.map((v) => Math.abs(num(v) || 0)), 0) || 1;
    const mP = Math.max(...L.p.map((v) => Math.abs(num(v) || 0)), 0) || 1;
    const label = card.ticker + " session path: cumulative net delta" + (L.dUnit ? " (" + L.dUnit + ")" : "") + (hasP ? " and cumulative net premium" + (L.pUnit ? " (" + L.pUnit + ")" : "") + ", each scaled to its own extreme" : "; no net premium leg, because the session carried none");
    const handle = C.mount(host, (el, w, animate) => {
      const H = heightOf(w, [200, 220, 240]);
      const left = 10, right = 10, top = 14, bot = 24;
      const n = L.d.length;
      const x = (i) => left + (n > 1 ? i / (n - 1) : 0.5) * (w - left - right);
      const norm = L.d.map((v) => (num(v) === null ? null : v / mD)).concat(hasP ? L.p.map((v) => (num(v) === null ? null : v / mP)) : []).filter((v) => v !== null);
      const flatPath = !norm.some((v) => v !== 0);
      const nLo = flatPath ? -1 : Math.min(0, ...norm), nHi = flatPath ? 1 : Math.max(0, ...norm), span = nHi - nLo;
      const yN = (u) => top + ((nHi - u) / span) * (H - top - bot);
      const mid = yN(0);
      const yD = (v) => yN(v / mD), yP = (v) => yN(v / mP);
      const svg = C.svgRoot(el, w, H, animate, label);
      s("line", { x1: left, x2: w - right, y1: mid, y2: mid, class: "base ft-pz" }, svg);
      if (num(L.centroid) !== null) {
        const cx = left + L.centroid * (w - left - right);
        s("line", { x1: cx, x2: cx, y1: top - 4, y2: H - bot, stroke: cssVar("--label-3"), "stroke-width": 1, "stroke-dasharray": "2 3", class: "ft-pc" }, svg);
      }
      const pts = (vals, y) => vals.map((v, i) => (num(v) === null ? null : [x(i), y(v)])).filter(Boolean);
      const dp = pts(L.d, yD);
      if (hasP) {
        const pp = pts(L.p, yP);
        s("path", { d: C.pathOf(pp), fill: "none", stroke: cssVar("--s-orange"), "stroke-width": 1.6, "stroke-dasharray": "5 3", class: "ln draw ft-pp", pathLength: 1, style: { "--delay": "120ms" } }, svg);
        const e = pp[pp.length - 1];
        if (e) s("rect", { x: e[0] - 3.5, y: e[1] - 3.5, width: 7, height: 7, fill: cssVar("--ground-base"), stroke: cssVar("--s-orange"), "stroke-width": 1.6, class: "ft-ppe" }, svg);
      }
      if (dp.length > 1) {
        s("path", { d: C.pathOf(dp), fill: "none", stroke: cssVar("--accent"), "stroke-width": 1.8, class: "ln draw ft-pd", pathLength: 1 }, svg);
        const e = dp[dp.length - 1];
        s("circle", { cx: e[0], cy: e[1], r: 3.5, fill: cssVar("--accent"), class: "ft-pde" }, svg);
      }
      const ticks = Math.min(5, n);
      for (let t = 0; t < ticks; t++) {
        const i = Math.round((t * (n - 1)) / Math.max(1, ticks - 1));
        s("text", { x: x(i), y: H - 6, text: String(L.times[i] || "").replace(" ET", ""), "text-anchor": t === 0 ? "start" : t === ticks - 1 ? "end" : "middle" }, svg);
      }
      C.scrub(el, svg, { xs: L.d.map((_, i) => x(i)), top, bottom: H - bot, label,
        onMove: (i) => ({ dots: [num(L.d[i]) !== null ? { x: x(i), y: yD(L.d[i]), color: "--accent" } : null, hasP && num(L.p[i]) !== null ? { x: x(i), y: yP(L.p[i]), color: "--s-orange" } : null].filter(Boolean),
          parts: [C.part(L.times[i], "k"), C.part("Δ", "k"), h("b", { "data-tone": tone(L.d[i]) }, F.num(L.d[i], true)), hasP ? C.part("Premium", "k") : null, hasP ? h("b", { "data-tone": tone(L.p[i]) }, F.money(L.p[i], true)) : null] }) });
    });
    return { handle, legend: [keyOf("--accent", "ln", "Delta ±" + F.num(mD)), hasP ? keyOf("--s-orange", "ln", "Premium ±" + F.money(mP)) : null, num(L.centroid) !== null ? keyOf("--label-3", "ln", "Mean minute") : null] };
  }

  function pathNotes(card, L) {
    if (!L) return [];
    const P = L.panel;
    const hasP = L.p.some((v) => num(v) !== null && v !== 0);
    const out = [L.src === "tape" ? "Drawn from this session's live tape; the path signature below is the card's, from the session it describes." : null,
      "Each leg is scaled to its own extreme, so both reach full height: net delta in " + (L.dUnit || (L.src === "tape" ? "a unit the live tape does not state" : "the unit the card publishes")) + (hasP ? ", net premium in " + (L.pUnit || "dollars") + "." : "."),
      hasP ? null : "The session carried no net premium in either direction, so only the delta leg is drawn."];
    if (P && num(P.persistence) === null && !("persistence" in P)) out.push("This card was built before the path signature was published, so persistence, concentration and the mean minute are not stated, and no mean-minute rule is drawn.");
    else if (P) {
      if (num(P.concentration) !== null) out.push("The busiest 5% of minutes carried " + Math.round(P.concentration * 100) + "% of the delta moved, against the 5% a uniform session would put there.");
      if (num(P.persistence) !== null) out.push(Math.round(P.persistence * 100) + "% of minutes ran with the net direction, against 50% for a tape with no direction.");
      if (num(P.centroid) !== null) out.push("The delta-weighted mean minute sits " + Math.round(P.centroid * 100) + "% of the way through the session, drawn as the dotted rule.");
    }
    return out;
  }

  function pathFacts(card) {
    const P = (card.panels || {}).path;
    const pc = (v) => (num(v) === null ? DASH : Math.round(v * 100) + "%");
    if (!P || P.status !== "ok") return [];
    return [["Net delta", F.num(P.netDelta, true) + (P.netDeltaUnit ? SEP + P.netDeltaUnit : "")], ["Net premium", F.money(P.netPremium, true) + (P.netPremiumUnit ? SEP + P.netPremiumUnit : "")],
      ["Minutes", num(P.minutes) === null ? null : String(P.minutes)], ["Minutes with the direction", pc(P.persistence)], ["Busiest 5% of minutes", pc(P.concentration)], ["Weighted mean minute", pc(P.centroid)]];
  }

  function greekLegs(host, key, p) {
    const rows = (p.rows || []).filter((r) => isoOk(r.expiry));
    const name = key === "deltaExposure" ? "Delta" : key[0].toUpperCase() + key.slice(1);
    const label = name + " by expiry, the call and put legs as the vendor signed them, in " + p.unit;
    return C.mount(host, (el, w, animate) => {
      const H = w < 600 ? 84 : 92;
      const left = 4, right = 4, top = 6, bot = 16;
      const vals = rows.flatMap((r) => [num(r.call), num(r.put)]).filter((v) => v !== null);
      const m = Math.max(...vals.map(Math.abs), 0) || 1;
      const y0 = top + (H - top - bot) / 2, k = (H - top - bot) / 2 / m;
      const svg = C.svgRoot(el, w, H, animate, label);
      const gw = (w - left - right) / Math.max(1, rows.length);
      const bw = clamp(gw * 0.3, 2, 14);
      rows.forEach((r, i) => {
        const cx = left + i * gw + gw / 2;
        [["call", -bw - 1, "--s-teal"], ["put", 1, "--s-purple"]].forEach(([leg, dx, col]) => {
          const v = num(r[leg]);
          if (v === null) return;
          const hgt = v === 0 ? 1 : Math.max(1, Math.abs(v) * k);
          const pol = v > 0 ? "is-pos" : v < 0 ? "is-neg" : "is-flat";
          s("rect", { x: cx + dx, y: pol === "is-pos" ? y0 - hgt : pol === "is-neg" ? y0 : y0 - 0.5, width: bw, height: hgt, rx: Math.min(2, bw / 3), fill: cssVar(col), class: "ft-gl is-" + leg + " " + pol }, svg);
        });
        if (rows.length <= 8 || i % 2 === 0) s("text", { x: cx, y: H - 3, text: (num(r.dte) !== null ? r.dte + "d" : day(r.expiry)), "text-anchor": "middle", class: "tx-3" }, svg);
      });
      s("line", { x1: left, x2: w - right, y1: y0, y2: y0, class: "base ft-glz" }, svg);
      C.scrub(el, svg, { xs: rows.map((_, i) => left + i * gw + gw / 2), top, bottom: H - bot, label,
        onMove: (i) => ({ parts: [C.part(day(rows[i].expiry) + SEP + rows[i].dte + "d", "k"), C.part("call", "k"), h("b", null, num(rows[i].call) === null ? DASH : F.num(rows[i].call, true)), C.part("put", "k"), h("b", null, num(rows[i].put) === null ? DASH : F.num(rows[i].put, true)),
          C.part("dealer " + (num(rows[i].dealer) === null ? DASH : F.num(rows[i].dealer, true)), null, num(rows[i].dealer) === null ? null : rows[i].dealer > 0 ? "long" : rows[i].dealer < 0 ? "short" : null)] }) });
    });
  }

  function greekLines(card) {
    const P = card.panels || {};
    const out = [];
    let conv = null;
    for (const [k, name] of [["vanna", "Vanna"], ["charm", "Charm"], ["deltaExposure", "Delta"]]) {
      const p = P[k];
      if (!p || p.status !== "ok") { out.push(name + ": " + reasonOf(panelSt(card, k, name.toLowerCase() + " ladder"))); continue; }
      const drawn = (p.rows || []).filter((r) => isoOk(r.expiry));
      const net = drawn.reduce((a, r) => (num(r.dealer) === null ? a : (a || 0) + r.dealer), null);
      out.push(name + " is in " + p.unit + ". Gross size " + F.num(p.grossAbs) + ", a size and never a direction. Dealer net, drawn (" + (p.dealerRule || "call − put") + "): " + (net === null ? DASH : F.num(net, true)) + " across " + drawn.length + " expiries.");
      conv = conv || p.signConvention;
    }
    if (conv) out.push(conv);
    return out;
  }

  function coverageOf(views) {
    const by = {};
    for (const v of views) (by[v.st.state] = by[v.st.state] || []).push(v.label);
    const drawn = (by.ok || []).length;
    const rest = Object.entries(by).filter(([k]) => k !== "ok").map(([k, l]) => l.length + " " + (UI.STATES[k] ? UI.STATES[k].word.toLowerCase() : k) + " (" + l.join(", ") + ")");
    return drawn + " of " + views.length + " views drawn" + (rest.length ? "; " + rest.join("; ") : "") + ".";
  }

  function strikeWindow(card, S) {
    const pm = (card.panels || {}).pricedMove || {};
    const m = num(pm.impliedMove) !== null ? pm.impliedMove : 0.05;
    const half = clamp(2.2 * m, 0.06, 0.2);
    let lo = S * (1 - half), hi = S * (1 + half);
    for (const l of Object.values(levelsOf(card))) if (Math.abs(l.px / S - 1) <= 0.16) { lo = Math.min(lo, l.px * 0.985); hi = Math.max(hi, l.px * 1.015); }
    return [lo, hi];
  }

  function unpack(series, n) {
    if (!series || !Array.isArray(series.x)) return new Array(n).fill(null);
    const k = num(series.s) === null ? 0 : series.s;
    const f = k >= 0 ? 10 ** k : 1 / 10 ** -k;
    return series.x.map((v) => (num(v) === null ? null : v * f));
  }
  function histAxis(hist) {
    if (!hist || !isoOk(hist.d0) || !Array.isArray(hist.dd)) return null;
    const t0 = Date.parse(hist.d0 + "T00:00:00Z");
    return hist.dd.map((d) => new Date(t0 + d * 864e5).toISOString().slice(0, 10));
  }

  function todayLines(card) {
    const reg = card.regime || {};
    const lv = levelsOf(card);
    const flip = lv.gamma_flip ? lv.gamma_flip.px : null;
    const side = reg.crossingSide || reg.flipSide || null;
    const knows = side === "long_below" || side === "short_below";
    const below = side === "long_below" ? "long" : "short", above = below === "long" ? "short" : "long";
    const amp = (x) => (x === "short" ? "hedging amplifies moves there" : "hedging damps them there");
    const sep = numOr(reg.crossingSeparation, reg.flipSeparation);
    const at = num(reg.spotGammaShare);
    return [
      (flip === null ? "The gamma added today does not change sign materially inside the drawn band, so no crossing is published here."
        : !knows ? "Today's flow ladder changes sign at " + F.px(flip) + "."
          : "Today's trading left dealers " + below + " gamma immediately below " + F.px(flip) + ", where " + amp(below) + ", and " + above + " immediately above it.") +
        (flip !== null && knows && num(sep) !== null ? " The thinner side carries " + Math.round(sep * 100) + "% of the ladder's peak, so this is a " + (sep < 0.15 ? "weak" : sep < 0.4 ? "moderate" : "strong") + " boundary." : ""),
      at !== null ? "Today's added gamma, summed up to spot, is " + Math.abs(at).toFixed(2) + " of this ladder's peak and " + (at < 0 ? "short" : at > 0 ? "long" : "flat") + ", " + (Math.abs(at) >= 0.5 ? "close to as strong as this ladder gets" : "well inside its range") + "; the standing book's net is the Dealer γ figure above."
        : "Where spot sits in the cumulative is not published on this card: spot lies outside the measured strike band, and the edge rung would report a confident extreme for a stock trading nowhere near the strikes on file.",
      num(reg.crossings) !== null && reg.crossings > 1 ? "The ladder crosses zero " + reg.crossings + " times; this is the one separating the most exposure." : null,
      flip !== null && !knows ? "This card was built before the side of that boundary was measured, so which way round it runs is not stated." : null,
      num(reg.bandMin) !== null && num(reg.bandMax) !== null ? "Measured over strikes " + F.px(reg.bandMin) + " – " + F.px(reg.bandMax) + " only, so this is the gamma added today inside that band, not the whole ladder." : null,
      "The at-spot reading is a share of this ladder's peak rather than a dollar figure, which is what makes it comparable across names.",
    ];
  }

  function buildGamma(card) {
    const P = card.panels || {};
    const S = spotOf(card);
    const lv = levelsOf(card);
    const reg = card.regime || {};
    const gl = reg.label === "short" ? "short" : reg.label === "long" ? "long" : null;
    const X = STATE.cardX || {};
    const vl = X.gexLevels && X.gexLevels.status === "ok" ? X.gexLevels : null;
    const gx = X.gex && (X.gex.status === "ok" || X.gex.status === "stale") ? X.gex : null;
    const prof = P.levels && P.levels.zeroGamma && P.levels.zeroGamma.profile && Array.isArray(P.levels.zeroGamma.profile.x) ? P.levels.zeroGamma.profile : null;
    const stT = panelSt(card, "gamma", "gamma ladder"), stS = panelSt(card, "surface", "gamma grid"), stC = panelSt(card, "calendar", "roll-off");
    const stB = prof ? OK : P.levels && P.levels.status === "ok" ? ST("unavailable", "This card predates the open-interest book profile, so the book cannot be drawn against spot; the flow view still reads.") : panelSt(card, "levels", "levels panel");
    const axis = histAxis(STATE.hist);
    const g1y = axis && STATE.hist.gex ? unpack(STATE.hist.gex.g, axis.length) : null;
    const stY = g1y && g1y.some((v) => v !== null) ? OK : STATE.hist && STATE.hist.status !== "pending" ? ST("unavailable", "This name's history carries no dealer-gamma series.") : ST("pending", "The one-year gamma history lands with the next post-close run.");
    const vendorMarks = vl ? [["flip", "gamma_flip"], ["callWall", "call_wall"], ["putWall", "put_wall"]].filter(([k]) => num(vl[k]) !== null).map(([k, kind]) => ({ x: vl[k], shape: "ring", color: C.LEVELS[kind].color, row: "base", r: 4.5 })) : [];
    const ourMarks = (withFlip) => [
      withFlip && lv.gamma_flip ? { x: lv.gamma_flip.px, shape: "dia", color: "--lvl-flip", rule: true } : null,
      lv.max_pain ? { x: lv.max_pain.px, shape: "dia", color: "--lvl-pain", row: "base", r: 3.6 } : null,
    ].filter(Boolean);
    const wallLabels = (xs) => ["call_wall", "put_wall"].map((k) => lv[k]).filter((l) => l && xs.some((x) => Math.abs(x - l.px) < 1e-6)).map((l) => ({ x: xs.find((x) => Math.abs(x - l.px) < 1e-6), text: K(l.px) }));
    const vendorKey = vendorMarks.length ? keyOf("--label-1", "ring", "Vendor") : null;
    const views = [
      { label: "Book", st: stB, never: isIndex(card) && !prof, name: "Gamma book", draw: (host) => {
        const [lo, hi] = strikeWindow(card, S);
        const idx = prof.x.map((x, i) => i).filter((i) => prof.x[i] >= lo && prof.x[i] <= hi && num(prof.g[i]) !== null);
        const xs = idx.map((i) => prof.x[i]);
        return { handle: C.diverging(host, { x: xs, values: idx.map((i) => prof.g[i]), xType: "number", palette: "gamma", spot: S, height: [220, 250, 270],
          markers: ourMarks(true).concat(vendorMarks), label: card.ticker + " dealer book gamma per 1% if spot moved to each price", format: moneyPx, xFormat: (v) => K(v),
          readout: (i) => [C.part("If spot " + F.px(xs[i]), "k"), h("b", { "data-tone": prof.g[idx[i]] < 0 ? "short" : prof.g[idx[i]] > 0 ? "long" : "flat" }, moneyPx(prof.g[idx[i]]) + " per 1%"), C.part(F.pct(xs[i] / S - 1, 1, true), "k")] }),
          legend: [keyOf("--g-long", "", "Long γ"), keyOf("--g-short", "", "Short γ"), keyOf("--label-1", "ln", "Spot"), keyOf("--lvl-flip", "dia", "Flip"), lv.max_pain ? keyOf("--lvl-pain", "dia", "Max pain") : null, vendorKey] };
      } },
      { label: "Today", st: stT, name: "Gamma by strike", draw: (host) => {
        const [lo, hi] = strikeWindow(card, S);
        const bars = P.gamma.bars.filter((b) => num(b.k) !== null && num(b.g) !== null && b.k >= lo && b.k <= hi).sort((a, b) => a.k - b.k);
        if (!bars.length) { host.append(UI.silent(ST("quiet", "No strike carried flow gamma inside the drawn window."), "Gamma by strike", 240)); return {}; }
        const xs = bars.map((b) => b.k);
        const disp = P.displacement && P.displacement.status === "ok" ? P.displacement : null;
        const cents = disp ? [num(disp.oiCentroid) !== null ? { x: disp.oiCentroid, shape: "ring", color: "--label-1", row: "base", r: 4.5 } : null, num(disp.volCentroid) !== null ? { x: disp.volCentroid, shape: "dot", color: "--label-1", row: "base", r: 3.5 } : null].filter(Boolean) : [];
        return { handle: C.diverging(host, { x: xs, values: bars.map((b) => b.g), xType: "number", palette: "gamma", spot: S, height: [220, 250, 270], domain: [lo, hi],
          markers: ourMarks(true).concat(cents), labels: wallLabels(xs), label: card.ticker + " gamma dealers added today, by strike", format: (v) => F.num(v, true) + " Γ", xFormat: (v) => K(v),
          readout: (i) => [C.part("Strike", "k"), h("b", null, K(xs[i])), C.part(F.num(bars[i].g, true) + " Γ", null, bars[i].g > 0 ? "long" : bars[i].g < 0 ? "short" : null), C.part(F.pct(xs[i] / S - 1, 1, true), "k")] }),
          legend: [keyOf("--g-long", "", "Long γ"), keyOf("--g-short", "", "Short γ"), keyOf("--label-1", "ln", "Spot"), keyOf("--lvl-flip", "dia", "Flip"), cents.length ? keyOf("--label-1", "ring", "Book centre") : null, cents.length ? keyOf("--label-1", "dot", "Today's centre") : null] };
      } },
      { label: "Grid", st: stS, name: "Gamma grid", draw: (host) => ({ handle: gammaGrid(host, card, P.surface), legend: gridLegend(P.surface) }) },
      { label: "Roll-off", st: stC, name: "Gamma roll-off", draw: (host) => {
        const sch = (P.calendar.schedule || []).filter((r) => num(r.share) !== null);
        return { handle: C.bars(host, { values: sch.map((r) => r.share), labels: sch.map((r) => r.days + "d"), cumulative: sch.map((r) => r.cumShare), color: "--s-blue", max: 1, height: [200, 220, 240],
          format: (v) => F.pct(v, 1), label: "Share of the gamma book expiring by expiry", readout: (i) => [C.part(day(sch[i].expiry) + SEP + sch[i].days + "d", "k"), h("b", null, F.pct(sch[i].share, 1)), C.part("cum " + F.pct(sch[i].cumShare, 0), "k")] }),
          legend: [keyOf("--s-blue", "", "Expiring"), keyOf("--label-1", "ln", "Cumulative")] };
      } },
      { label: "1Y", st: stY, never: isIndex(card) && stY.state !== "ok", name: "Dealer gamma, one year", draw: (host) => {
        const pts = axis.map((d, i) => [d, g1y[i]]);
        return { handle: C.diverging(host, { x: pts.map((p) => p[0]), values: pts.map((p) => p[1]), palette: "gamma", height: [200, 220, 240], maxWidth: 4, endLabel: true,
          format: (v) => F.num(v, true), label: card.ticker + " net dealer gamma over the last year", readout: (i) => [C.part(day(pts[i][0]), "k"), pts[i][1] === null ? C.part("no reading", "k") : h("b", { "data-tone": pts[i][1] < 0 ? "short" : pts[i][1] > 0 ? "long" : "flat" }, F.num(pts[i][1], true) + " Γ")] }),
          legend: [keyOf("--g-long", "", "Long"), keyOf("--g-short", "", "Short")] };
      } },
    ];
    const vw = viewer("Gamma view", views);
    const st = UI.partial(vw.views.map((v) => ({ name: v.label, st: v.st })));
    const dist = (k) => {
      const l = lv[k];
      if (!l || !S) return null;
      const pc = num(l.distPct) !== null ? l.distPct : l.px / S - 1;
      if (Math.abs(pc) < 1e-12) return "at spot";
      const atr = num(l.distAtr) !== null ? l.distAtr : atrOf(card) ? (l.px - S) / atrOf(card) : null;
      return F.pct(pc, 1, true) + (k === "gamma_flip" && atr !== null ? SEP + F.signed(atr, 2) + " ATR" : "");
    };
    const lvSt = (k, what) => (lv[k] ? null : ST(P.levels && P.levels.status === "ok" ? "quiet" : "unavailable", P.levels && P.levels.status === "ok" ? "The ladder resolved no " + what + " over the strikes read, which is not a distance of zero." : "The levels panel was not measured on this card, so there is no " + what + " to place."));
    const bookV = num(reg.bookGamma) !== null ? reg.bookGamma : num(reg.netGamma);
    const clash = num(reg.bookGamma) === null && bookV !== null && ((gl === "short" && bookV > 0) || (gl === "long" && bookV < 0));
    mod({ id: "m-gamma", title: "Gamma", span: [12, 7], st, seg: vw.seg, views: vw.views, index: 4, body: [
      mets([
        metric("Dealer γ", clash ? (gl === "short" ? "Short" : "Long") : F.money(bookV, true), { tone: gl, unit: clash ? null : "/1%", sub: clash ? "today " + F.money(bookV, true) + "/1%" : gl ? (gl === "short" ? "Short" : "Long") + (reg.labelFrom === "book" ? SEP + "book" : SEP + "flow") + (gx && num(gx.persist) !== null ? SEP + gx.persist + "d" : "") : null,
          state: bookV === null ? ST("unavailable", "No regime reading on the card.") : null }),
        metric("Flip", lv.gamma_flip ? F.px(lv.gamma_flip.px) : DASH, { key: keyOf("--lvl-flip", "dia", ""), sub: dist("gamma_flip"), state: lvSt("gamma_flip", "gamma flip"), id: "ftFlip" }),
        metric("Call wall", lv.call_wall ? F.px(lv.call_wall.px) : DASH, { key: keyOf("--lvl-call", "dot", ""), sub: dist("call_wall"), state: lvSt("call_wall", "call wall") }),
        metric("Put wall", lv.put_wall ? F.px(lv.put_wall.px) : DASH, { key: keyOf("--lvl-put", "dot", ""), sub: dist("put_wall"), state: lvSt("put_wall", "put wall") }),
        metric("Max pain", lv.max_pain ? F.px(lv.max_pain.px) : DASH, { key: keyOf("--lvl-pain", "dia", ""), sub: dist("max_pain"), state: lvSt("max_pain", "max pain") }),
      ], { min: 92 }), vw.box, vw.leg],
      info: () => ({
        title: "Gamma", state: st.state === "ok" ? null : st.state, asOf: (P.surface && P.surface.asOf) || null, lead: leadOf(P.levels),
        facts: [["Book γ per 1%", F.money(reg.bookGamma, true)], ["Added today per 1%", F.money(numOr(reg.flowGamma, reg.netGamma), true)], ["Regime", reg.label || null], ["Read from", reg.labelFrom || null],
          ["Zero crossings", num(reg.crossings) === null ? null : String(reg.crossings)], ["Strike band", num(reg.bandMin) === null ? null : F.px(reg.bandMin, 0) + " – " + F.px(reg.bandMax, 0)], ["ATR", F.px(atrOf(card))],
          ["1Y z of the book", gx && num(gx.z) !== null ? F.signed(gx.z, 2) : null], ["1Y percentile", gx ? F.pct(gx.pct, 0) : null], ["Share of ADV", gx ? F.pct(gx.adv, 1) : null], ["Sign flips in a year", gx && num(gx.flips) !== null ? String(gx.flips) : null],
          ...keyStats(card).filter(([k]) => /wall|pain|crossing|gamma|flip|strike/i.test(k)),
          ["Vendor flip", vl && num(vl.flip) !== null ? F.px(vl.flip) + " (" + (vl.flipAgree ? "agrees" : "differs by " + fx(vl.flipGap, 2, true) + " ATR") + ")" : null],
          ["Vendor call wall", vl && num(vl.callWall) !== null ? F.px(vl.callWall) + (vl.callWallAgree ? " (agrees)" : " (differs)") : null],
          ["Vendor put wall", vl && num(vl.putWall) !== null ? F.px(vl.putWall) + (vl.putWallAgree ? " (agrees)" : " (differs)") : null],
          ["Nearby flips", vl && Array.isArray(vl.nearby) && vl.nearby.length ? vl.nearby.map((v) => F.px(v)).join(SEP) + (num(vl.ambiguity) !== null ? " (spread " + fx(vl.ambiguity, 2) + " ATR)" : "") : null]],
        sections: [
          { title: "Book", lines: [stB.state !== "ok" ? stB.reason : "The book view is the open-interest gamma book re-marked at each hypothetical spot: where it crosses zero is the flip.", P.levels && P.levels.book ? "Walls are read from the open-interest book: call wall " + F.px(P.levels.book.callWall) + ", put wall " + F.px(P.levels.book.putWall) + ", magnet " + F.px(P.levels.book.magnet) + "." : null] },
          { title: "Today", lines: stT.state === "ok" ? todayLines(card).concat([P.gamma && P.gamma.reads]) : [reasonOf(stT)] },
          { title: "Grid", lines: [leadOf(P.surface) || reasonOf(stS)].concat(stS.state === "ok" ? gridNotes(P.surface) : []) },
          { title: "Roll-off", lines: [leadOf(P.calendar) || reasonOf(stC)] },
          { title: "Displacement", lines: [leadOf(P.displacement) || reasonOf(panelSt(card, "displacement", "displacement read"))] },
          { title: "Vendor levels", lines: [vl ? "The vendor's own levels are drawn as rings; our flip is the book's strike-sum crossing, and the vendor defines its put wall differently, so disagreement there is expected." : reasonOf(xSt(X.gexLevels, "vendor level read"))] },
          { title: "One year", lines: [stY.state !== "ok" ? stY.reason : "Net dealer gamma per session over the last year; a gap is a session with no reading, not a zero."] },
        ],
        notes: ["Blue bars are where dealers are long gamma and hedge against the move; orange bars are short gamma, where hedging chases it. Gamma bars are linear: walls dominate, which is the truth; exact values come from scrubbing."],
      }) });
    vw.start();
  }

  function sigmaStep(k, unit) { return (k > 0 ? "+" : k < 0 ? MINUS : "") + Math.abs(k) + unit; }
  function hedgeGridChart(host, card, V) {
    const G = V.grid;
    const table = h("table", null, h("caption", null, "Dealer hedge flow over the next session, by spot and volatility move"));
    const rowsSorted = G.rows.map((r, i) => ({ ...r, i })).sort((a, b) => b.kS - a.kS);
    table.append(h("thead", null, h("tr", null, h("th", { scope: "col" }, "Spot"), G.cols.map((c) => h("th", { scope: "col" }, c.kV === 0 ? "IV " + F.pct(c.vol, 1) : sigmaStep(c.kV, " SD vol"))))));
    table.append(h("tbody", null, rowsSorted.map((r) => h("tr", null, h("th", { scope: "row" }, F.px(r.price)), G.cols.map((c, j) => { const cell = G.cells[r.i] && G.cells[r.i][j]; return cell ? h("td", null, F.money(cell.flow, true)) : h("td", { "data-empty": "unavailable" }, DASH); })))));
    host.append(h("div", { class: "visually-hidden" }, table));
    const chart = h("div");
    host.append(chart);
    return C.mount(chart, (el, w, animate) => {
      const phone = w < 600;
      const left = phone ? 66 : 80, top = 30, gap = 4;
      const cw = (w - left - gap * (G.cols.length - 1)) / G.cols.length;
      const ch = phone ? 36 : 38;
      const H = top + rowsSorted.length * (ch + gap);
      const flat = G.cells.flat().filter(Boolean).map((c) => Math.abs(num(c.pctAdv) || 0));
      const maxA = Math.max(...flat, 1e-9);
      const svg = C.svgRoot(el, w, H, animate, "Dealer hedging flow by spot and volatility move");
      G.cols.forEach((c, j) => {
        const xx = left + j * (cw + gap) + cw / 2;
        s("text", { x: xx, y: 12, text: c.kV === 0 ? "IV " + F.pct(c.vol, 1) : sigmaStep(c.kV, " SD vol"), "text-anchor": "middle", class: c.kV === 0 ? "tx-1" : null }, svg);
        if (c.kV !== 0) s("text", { x: xx, y: 25, text: F.pct(c.vol, 1), "text-anchor": "middle", class: "tx-3" }, svg);
      });
      rowsSorted.forEach((r, ri) => {
        const yy = top + ri * (ch + gap);
        s("text", { x: 0, y: yy + ch / 2 - 2, text: F.px(r.price), class: r.kS === 0 ? "tx-1 tx-b" : "tx-1" }, svg);
        s("text", { x: 0, y: yy + ch / 2 + 11, text: r.kS === 0 ? "spot" : sigmaStep(r.kS, " SD"), class: "tx-3" }, svg);
        G.cols.forEach((c, j) => {
          const cell = G.cells[r.i] && G.cells[r.i][j];
          const xx = left + j * (cw + gap);
          if (!cell) { s("rect", { x: xx, y: yy, width: cw, height: ch, rx: 9, fill: cssVar("--fill-4") }, svg); s("text", { x: xx + cw / 2, y: yy + ch / 2 + 4, text: DASH, "text-anchor": "middle", class: "tx-3" }, svg); return; }
          const a = clamp(Math.abs(num(cell.pctAdv) || 0) / maxA, 0, 1);
          s("rect", { x: xx, y: yy, width: cw, height: ch, rx: 9, fill: cssVar(cell.flow >= 0 ? "--up-mark" : "--down-mark"), "fill-opacity": (0.12 + 0.6 * a).toFixed(3), class: "fade", style: { "--delay": (ri + j) * 45 + "ms" } }, svg);
          if (r.kS === 0 && c.kV === 0) s("rect", { x: xx + 0.75, y: yy + 0.75, width: cw - 1.5, height: ch - 1.5, rx: 8.5, fill: "none", stroke: cssVar("--label-1"), "stroke-width": 1.5 }, svg);
          s("text", { x: xx + cw / 2, y: yy + ch / 2 + 4.5, text: F.money(cell.flow, true), "text-anchor": "middle", class: "tx-1 tx-b", style: { "font-size": phone ? "12px" : "13px" } }, svg);
        });
      });
    });
  }

  function buildHedging(card) {
    const P = card.panels || {};
    const V = P.variation;
    const stV = panelSt(card, "variation", "hedging panel");
    const X = STATE.cardX || {};
    const gp = X.gexPath && X.gexPath.status === "ok" ? X.gexPath : null;
    const stClock = gp ? OK : xSt(X.gexPath, "session gamma clock");
    const gk = ["vanna", "charm", "deltaExposure"].map((k) => [k, P[k], panelSt(card, k, k === "deltaExposure" ? "delta ladder" : k + " ladder")]);
    const stG = UI.worst(gk.map((x) => x[2]));
    const stGrid = stV.state === "ok" && V.grid && Array.isArray(V.grid.cells) ? OK : stV.state === "ok" ? ST("unavailable", "No scenario grid: it needs the open-interest book.") : stV;
    const views = [
      { label: "Grid", st: stGrid, name: "Scenario grid", h: 240, draw: (host) => ({ handle: hedgeGridChart(host, card, V), legend: [keyOf("--up-mark", "", "Dealers buy"), keyOf("--down-mark", "", "Dealers sell"), keyOf("--label-1", "ring", "Spot, today's vol")] }) },
      { label: "Clock", st: stClock, never: offIndex(card, X.gexPath), name: "Session gamma clock", draw: (host) => {
        const m = gp.m || [];
        const series = [{ values: gp.g || [], color: "--s-blue", label: "Book", format: moneyPx }].concat(Array.isArray(gp.f) ? [{ values: gp.f, color: "--s-orange", label: "Flow", format: moneyPx }] : []);
        const t = (mm) => { const mins = 570 + mm; return (Math.floor(mins / 60) % 12 || 12) + ":" + String(mins % 60).padStart(2, "0"); };
        return { handle: C.line(host, { x: m, xType: "number", series, zero: true, height: [200, 220, 240], yFormat: moneyPx, xFormat: t, gutter: 72, label: card.ticker + " dealer gamma per 1% through the session",
          xTicks: [30, 150, 270, 360].map((v) => ({ v, label: t(v) })) }),
          legend: [keyOf("--s-blue", "ln", "Book"), Array.isArray(gp.f) ? keyOf("--s-orange", "ln", "Flow") : null] };
      } },
      { label: "Greeks", st: stG.state === "ok" ? OK : UI.partial(gk.map(([k, , st]) => ({ name: k, st }))), name: "Greeks by expiry", draw: (host) => {
        const handles = [];
        for (const [k, p, st] of gk) {
          const row = h("div", { class: "ft-greek" }, h("span", { class: "ft-greek-l" }, k === "deltaExposure" ? "Delta" : k[0].toUpperCase() + k.slice(1)));
          const gc = h("div", { class: "ft-greek-c" });
          row.append(gc);
          host.append(row);
          if (st.state !== "ok") { gc.append(UI.silent(st, k, 64)); continue; }
          handles.push(greekLegs(gc, k, p));
        }
        return { handle: { destroy: () => handles.forEach((x) => x.destroy()) }, legend: [keyOf("--s-teal", "", "Call leg"), keyOf("--s-purple", "", "Put leg")] };
      } },
    ];
    const vw = viewer("Hedging view", views);
    const ch = stV.state === "ok" ? V.channels || {} : {};
    const silence = (chan) => {
      const x = (V && V.silences || []).find((q) => q.channel === chan || String(q.channel).startsWith(chan));
      return x ? ST(x.kind === "quiet" ? "quiet" : x.kind === "unreadable" ? "withheld" : x.kind === "pending" ? "pending" : "unavailable", cap(x.reason)) : ST(stV.state === "ok" ? "unavailable" : stV.state, stV.state === "ok" ? "No reading on this channel." : stV.reason);
    };
    const g1 = ch.gamma && num(ch.gamma.perSigma) !== null ? -ch.gamma.perSigma : null;
    const v1 = ch.vanna && num(ch.vanna.perSigma) !== null ? -ch.vanna.perSigma : null;
    const c1 = ch.charm && num(ch.charm.hedge) !== null ? ch.charm.hedge : null;
    const sh = stV.state === "ok" && V.variance && V.variance.shares ? V.variance.shares : null;
    const parts = sh ? [["Spot", sh.gamma, "--s-blue"], ["Vol", sh.vanna, "--s-purple"], ["Co-move", sh.cross, "--s-gray"]].filter((p) => num(p[1]) !== null) : [];
    const offsetting = parts.some((p) => p[1] < 0);
    const shares = parts.length ? h("div", { class: "ft-shares" },
      offsetting ? null : UI.split(parts.map((p) => ({ color: p[2], value: p[1] })), parts.map((p) => p[0] + " " + Math.round(p[1] * 100) + "%").join(", ")),
      legend(parts.map((p) => h("span", { class: "ui-key" }, h("i", { style: { "--c": cssVar(p[2]) }, "aria-hidden": "true" }), p[0], h("b", null, F.pct(p[1], 0, offsetting))))
        .concat(num(V.driftInSd) !== null ? [h("span", { class: "ui-key" }, glyph("clock"), "Drift", h("b", null, Math.abs(V.driftInSd).toFixed(2) + " SD"))] : []))) : null;
    const st = UI.partial(vw.views.map((v) => ({ name: v.label, st: v.st })));
    mod({ id: "m-hedge", title: "Hedging", span: [12, 5], st: stV.state === "ok" ? st : stV, robustness: stV.state === "ok" && V.robustness ? V.robustness.r : null, seg: vw.seg, views: vw.views, index: 5, body: [
      mets([
        metric("Overnight", F.money(c1, true), { key: glyph("clock"), tone: tone(c1), sub: ch.charm && num(ch.charm.pctAdv) !== null ? F.pct(Math.abs(ch.charm.pctAdv), 1) + " of a day" : null, state: c1 === null ? silence("charm") : null }),
        metric("Spot +1 SD", F.money(g1, true), { key: glyph("gamma"), tone: tone(g1), sub: ch.gamma ? (ch.gamma.source === "book" ? "book" : "today only") : null, state: g1 === null ? silence("gamma") : null }),
        metric("Vol +1 SD", F.money(v1, true), { key: glyph("vega"), tone: tone(v1), sub: ch.vanna && num(ch.vanna.perPoint) !== null ? F.money(Math.abs(ch.vanna.perPoint)) + " per pt" : null, state: v1 === null ? silence("vanna") : null }),
      ], { min: 96 }), vw.box, vw.leg, shares],
      info: () => {
        if (stV.state !== "ok") return { title: "Hedging", state: stV.state, lead: stV.reason };
        const I = V.inputs || {};
        return {
          title: "Dealer hedging flow", asOf: V.asOf || null, lead: leadOf(V),
          facts: [["Daily SD", F.pct(I.sigmaDaily, 2) + (I.sigmaSource ? SEP + I.sigmaSource : "")], ["1 SD in dollars", "$" + F.px(I.sigmaDollars)], ["Vol of vol", num(I.sigmaV) === null ? null : I.sigmaV.toFixed(2) + " pts"],
            ["Spot–vol correlation", num(I.rho) === null ? null : I.rho.toFixed(2)], ["Typical day (ADV)", F.money(I.adv)], ["Book γ per 1%", F.money(I.gammaBook, true)], ["Robustness", V.robustness ? V.robustness.r + " of 3" : null],
            ["Variance shares", sh ? parts.map((p) => p[0] + " " + F.pct(p[1], 0, true)).join(SEP) : null]],
          sections: [{ title: "Robustness", lines: [V.robustness && V.robustness.why] },
            { title: "Silences", lines: (V.silences || []).map((x) => (x.kind === "quiet" ? "Quiet" : x.kind === "pending" ? "Pending" : x.kind === "unreadable" ? "Unreadable" : "Unavailable") + " — " + x.reason) },
            { title: "Conventions", lines: [V.conventions ? (typeof V.conventions === "string" ? V.conventions : Object.values(V.conventions).filter((x) => typeof x === "string").join(" ")) : null, "Every figure is dealer-signed under the vendor's convention: positive cells are shares dealers must buy to stay hedged, negative cells shares they must sell."] },
            { title: "Variance", lines: [offsetting ? "The channels offset: at least one share is below zero, so the shares are printed rather than scaled into a bar that would claim they are parts of a whole." : null] },
            { title: "Clock", lines: [gp ? "The open-interest book's gamma per 1% through the regular session (" + gp.minutes + " minutes), " + gp.flips + " sign changes, beside the gamma the day's flow added." : stClock.reason] },
            { title: "Greeks", lines: gk.map(([k, p, st2]) => (st2.state === "ok" ? leadOf(p) : null)).concat(greekLines(card)) }],
          notes: ["Rows move spot by whole daily sigmas, columns move implied volatility by one typical daily change; the centre is time alone, into the next session."],
        };
      } });
    vw.start();
  }

  const pts1 = (v) => (num(v) === null ? DASH : F.pts(v));
  const TENOR_TICKS = [[7, "1w"], [30, "1m"], [91, "3m"], [182, "6m"], [365, "1y"], [730, "2y"]];

  function coneChart(host, card, cone, rv) {
    const T = (cone.tenors || []).filter((t) => num(t.days) !== null && num(t.iv) !== null);
    const rvBy = new Map((rv && rv.status === "ok" ? rv.cone || [] : []).filter((r) => num(r.ivDays) !== null).map((r) => [r.ivDays, r]));
    const nn = (a) => a.filter((v) => num(v) !== null);
    const core = nn(T.flatMap((t) => [t.q1, t.q3, t.iv]).concat([...rvBy.values()].flatMap((r) => [r.p10, r.p90, r.now])));
    const c0 = Math.min(...core), c1 = Math.max(...core), r = Math.max(c1 - c0, 0.02) / 2;
    const lo = Math.max(Math.min(c0, ...nn(T.map((t) => t.min))), c0 - r), hi = Math.min(Math.max(c1, ...nn(T.map((t) => t.max))), c1 + r);
    const pad = (hi - lo) * 0.08 || 0.01, y0 = Math.max(0, lo - pad), y1 = hi + pad;
    return C.mount(host, (el, w, animate) => {
      const H = heightOf(w, [280, 300, 320]);
      const top = 16, bot = 24, left = 36, right = 12;
      const sx = (d) => Math.sqrt(d);
      const x = C.lin(sx(T[0].days), sx(T[T.length - 1].days), left + 10, w - right - 10);
      const y = C.lin(y0, y1, H - bot, top);
      const yc = (v) => y(clamp(v, y0, y1));
      const svg = C.svgRoot(el, w, H, animate, card.ticker + " implied volatility against its own year, by tenor, with the realized cone behind");
      for (const t of C.niceTicks(y0, y1, 3)) s("text", { x: 0, y: y(t) + 4, text: Math.round(t * 100) + "%" }, svg);
      s("line", { x1: left, x2: w - right, y1: H - bot, y2: H - bot, class: "base" }, svg);
      const rvPts = T.map((t) => [t, rvBy.get(t.days)]).filter(([, r]) => r && num(r.p10) !== null && num(r.p90) !== null);
      if (rvPts.length > 1) {
        const up = rvPts.map(([t, r]) => [x(sx(t.days)), y(r.p90)]), dn = rvPts.map(([t, r]) => [x(sx(t.days)), y(r.p10)]);
        s("path", { d: C.pathOf(up) + dn.slice().reverse().map((p) => "L" + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("") + "Z", fill: cssVar("--s-gray"), "fill-opacity": 0.14, class: "fade" }, svg);
        const nowPts = rvPts.filter(([, r]) => num(r.now) !== null).map(([t, r]) => [x(sx(t.days)), y(r.now)]);
        if (nowPts.length > 1) s("path", { d: C.monoPath(nowPts), class: "ln draw", stroke: cssVar("--s-gray"), "stroke-dasharray": null, pathLength: 1, style: { "--delay": "200ms" } }, svg);
      }
      const accent = cssVar("--accent");
      T.forEach((t, i) => {
        const cx = x(sx(t.days));
        const g = s("g", { class: "fade", style: { "--delay": i * 50 + "ms" } }, svg);
        if (num(t.min) !== null && num(t.max) !== null) s("rect", { x: cx - 1.5, y: yc(t.max), width: 3, height: Math.max(1, yc(t.min) - yc(t.max)), rx: 1.5, fill: cssVar("--fill-2") }, g);
        for (const [v, yy, d] of [[num(t.max) !== null && t.max > y1, top, 1], [num(t.min) !== null && t.min < y0, H - bot, -1]]) if (v) s("path", { d: "M" + (cx - 4) + " " + (yy + 4 * d) + "l4 " + -4 * d + "l4 " + 4 * d, class: "ft-off" }, g);
        if (num(t.q1) !== null && num(t.q3) !== null) s("rect", { x: cx - 6, y: y(t.q3), width: 12, height: Math.max(2, y(t.q1) - y(t.q3)), rx: 4, fill: cssVar("--fill-1") }, g);
        if (num(t.median) !== null) s("line", { x1: cx - 6, x2: cx + 6, y1: y(t.median), y2: y(t.median), stroke: cssVar("--label-2"), "stroke-width": 1.5 }, g);
        const dot = s("circle", { cx, cy: y(t.iv), r: 4.5, fill: t.lowSample ? "none" : accent, stroke: accent, "stroke-width": 1.5, class: "ring" }, g);
        if (t.lowSample) dot.setAttribute("stroke-width", "2");
      });
      const ivPath = T.map((t) => [x(sx(t.days)), y(t.iv)]);
      s("path", { d: C.monoPath(ivPath), class: "ln draw", stroke: accent, "stroke-opacity": 0.55, pathLength: 1 }, svg);
      for (const t of T) s("text", { x: x(sx(t.days)), y: H - 6, text: t.days < 30 ? t.days + "d" : t.days < 365 ? Math.round(t.days / 30) + "m" : "1y", "text-anchor": "middle" }, svg);
      C.scrub(el, svg, { xs: T.map((t) => x(sx(t.days))), top, bottom: H - bot, label: "Implied volatility cone",
        onMove: (i) => { const t = T[i], r = rvBy.get(t.days); return { dots: [{ x: x(sx(t.days)), y: y(t.iv), color: "--accent" }], parts: [C.part(t.days + "d", "k"), h("b", null, F.pct(t.iv)), C.part("pct " + (num(t.pct) === null ? DASH : Math.round(t.pct * 100)), "k"), C.part(F.pct(t.min, 0) + "–" + F.pct(t.max, 0), "k"), r && num(r.now) !== null ? C.part("RV " + F.pct(r.now), "k") : null] }; } });
    });
  }

  function smileSeries(card) {
    const eng = engineOf(card);
    const FQ = window.FlowsQuant;
    const ks = [];
    for (let i = -20; i <= 20; i++) ks.push(+Math.log1p(i * 0.0125).toFixed(5));
    if (eng && FQ && typeof FQ.sliceVolK === "function") {
      const ex = eng.expiries.filter((e) => e.smile && e.forward);
      const pick = [];
      for (const want of [14, 45, 120]) { const c = ex.filter((e) => !pick.includes(e)).sort((a, b) => Math.abs(a.dte - want) - Math.abs(b.dte - want))[0]; if (c) pick.push(c); }
      pick.sort((a, b) => a.dte - b.dte);
      const series = pick.map((e) => { const sl = FQ.sliceFromSummary(e); return { e, values: ks.map((k) => (sl ? FQ.sliceVolK(sl, k) : null)) }; });
      if (series.some((sr) => sr.values.some((v) => num(v) !== null))) return { x: ks, series, source: "engine" };
    }
    const sf = (card.panels || {}).ivSurface;
    if (!sf || sf.status !== "ok") return null;
    const within = (m) => Math.abs(m) <= 0.3 + 1e-9;
    const rows = sf.rows.map((m, r) => ({ m, r })).filter((o) => within(o.m)).sort((a, b) => a.m - b.m);
    const ex = sf.expiries.map((e, j) => ({ ...e, j })).filter((e) => e.days >= 7 && rows.filter((o) => num(sf.iv[o.r] && sf.iv[o.r][e.j]) !== null).length >= 4);
    const pick = [];
    for (const want of [14, 45, 120]) { const c = ex.filter((e) => !pick.includes(e)).sort((a, b) => Math.abs(a.days - want) - Math.abs(b.days - want))[0]; if (c) pick.push(c); }
    pick.sort((a, b) => a.days - b.days);
    if (!pick.length) return null;
    return { x: rows.map((o) => o.m), series: pick.map((e) => ({ e: { expiry: e.expiry, dte: e.days }, values: rows.map((o) => num(sf.iv[o.r][e.j])) })), source: "surface" };
  }

  function buildVol(card) {
    const P = card.panels || {};
    const pm = P.pricedMove && P.pricedMove.status === "ok" ? P.pricedMove : {};
    const X = STATE.cardX || {};
    const cone = X.cone && X.cone.status === "ok" ? X.cone : null, rv = X.rv && X.rv.status === "ok" ? X.rv : null;
    const term = X.term && X.term.status === "ok" ? X.term : null, skew = X.skew && X.skew.status === "ok" ? X.skew : null;
    const vrp = X.vrp && X.vrp.status === "ok" ? X.vrp : null;
    const vc = P.volContext && P.volContext.status === "ok" ? P.volContext : null;
    const sk = P.skewTerm && P.skewTerm.status === "ok" ? P.skewTerm : null;
    const g = P.context && P.context.garch && P.context.garch.status === "ok" ? P.context.garch : null;
    const termRows = term ? term.expiries.filter((r) => num(r.dte) !== null && num(r.iv) !== null && r.dte > 0).map((r) => ({ d: r.dte, v: r.iv, e: r.expiry, f: num(r.fwd), ev: r.eventFirst || r.event, kink: r.kink, pct: r.pct }))
      : vc && vc.term && vc.term.status === "ok" ? vc.term.rows.filter((r) => num(r.dte) !== null && num(r.vol) !== null && r.dte > 0).map((r) => ({ d: r.dte, v: r.vol, e: r.expiry, f: null, m: r.impliedMovePerc }))
        : sk && Array.isArray(sk.points) ? sk.points.filter((p) => num(p.atmIv) !== null && p.days > 0).map((p) => ({ d: p.days, v: p.atmIv, e: p.expiry, f: null })) : [];
    termRows.sort((a, b) => a.d - b.d);
    const smile = smileSeries(card);
    const ivRows = vc && vc.ivRank && vc.ivRank.status === "ok" ? vc.ivRank.rows.filter((r) => isoOk(r.date) && num(r.vol) !== null).sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
    const sf = P.ivSurface && P.ivSurface.status === "ok" ? P.ivSurface : null;
    const views = [
      { label: "Cone", st: cone ? OK : xSt(X.cone, "implied-volatility cone"), name: "Volatility cone", draw: (host) => ({ handle: coneChart(host, card, cone, rv),
        legend: [keyOf("--accent", "dot", "Today"), keyOf("--fill-1", "", "Year's middle"), keyOf("--s-gray", "", "Realized cone")] }) },
      { label: "Term", st: termRows.length > 1 ? OK : term ? ST("quiet", "Fewer than two expiries carried an implied volatility.") : panelSt(card, "volContext", "term structure"), name: "Term structure", draw: (host) => {
        const fwd = termRows.some((r) => r.f !== null);
        const evRow = termRows.find((r) => r.ev);
        return { handle: C.line(host, { x: termRows.map((r) => r.d), xType: "number", xScale: "sqrt", xTicks: TENOR_TICKS.map(([v, l]) => ({ v, label: l })),
          series: [{ values: termRows.map((r) => r.v), color: "--accent", area: true, label: "IV", format: (v) => F.pct(v) }].concat(fwd ? [{ values: termRows.map((r) => r.f), color: "--s-purple", dash: true, label: "Forward", format: (v) => F.pct(v) }] : []),
          refs: num(pm.rv30) !== null ? [{ y: pm.rv30, color: "--s-gray", dash: true }] : [], markers: evRow ? [{ x: evRow.d, y: evRow.v, shape: "dia", color: "--lvl-flip", r: 4.5 }] : [],
          yFormat: (v) => F.pct(v, 0), height: [280, 300, 320], label: card.ticker + " implied volatility by days to expiry",
          readout: (i) => [C.part(day(termRows[i].e) + SEP + termRows[i].d + "d", "k"), h("b", null, F.pct(termRows[i].v)), termRows[i].f !== null ? C.part("fwd " + F.pct(termRows[i].f), "k") : null,
            num(termRows[i].m) !== null ? C.part("±" + F.pct(termRows[i].m) + " move", "k") : null, termRows[i].ev ? C.part("Earnings", null, "warn") : null] }),
          legend: [keyOf("--accent", "ln", "Implied"), fwd ? dashKey("--s-purple", "Forward") : null, num(pm.rv30) !== null ? dashKey("--s-gray", "Realized 30d") : null, evRow ? keyOf("--lvl-flip", "dia", "Earnings") : null] };
      } },
      { label: "Skew", st: skew && skew.series && Array.isArray(skew.series.d) ? OK : xSt(X.skew, "risk-reversal history"), name: "Skew", draw: (host) => {
        const S2 = skew.series;
        return { handle: C.line(host, { x: S2.d, series: [{ values: S2.rr25, color: "--accent", label: "RR25", format: (v) => pts1(v) }].concat(Array.isArray(S2.rr10) ? [{ values: S2.rr10, color: "--s-orange", label: "RR10", format: (v) => pts1(v) }] : []),
          zero: true, yFormat: (v) => pts1(v), height: [280, 300, 320], label: card.ticker + " 25 and 10 delta risk reversals, " + skew.expiry }),
          legend: [keyOf("--accent", "ln", "25Δ"), Array.isArray(S2.rr10) ? keyOf("--s-orange", "ln", "10Δ") : null] };
      } },
      { label: "Smile", st: smile ? OK : panelSt(card, "ivSurface", "volatility surface"), name: "Smile", draw: (host) => {
        const cols = ["--s-teal", "--accent", "--s-purple"];
        const xl = (m) => (Math.abs(m) < 1e-9 ? "ATM" : sgn(m) + Math.round(Math.abs(Math.expm1(m)) * 100) + "%");
        return { handle: C.line(host, { x: smile.x, xType: "number", series: smile.series.map((sr, i) => ({ values: sr.values, color: cols[i], label: sr.e.dte + "d", format: (v) => F.pct(v) })),
          xTicks: [-0.2, -0.1, 0, 0.1, 0.2].map((p) => ({ v: Math.log1p(p), label: p === 0 ? "ATM" : sgn(p) + Math.round(Math.abs(p) * 100) + "%" })), yFormat: (v) => F.pct(v, 0), height: [280, 300, 320], label: card.ticker + " implied volatility smile by strike against the forward", xFormat: xl }),
          legend: smile.series.map((sr, i) => keyOf(cols[i], "ln", sr.e.dte + "d")) };
      } },
      { label: "Surface", st: sf ? OK : panelSt(card, "ivSurface", "volatility surface"), name: "Surface", draw: (host) => {
        const rows = sf.rows.map((m, r) => ({ m, r })).sort((a, b) => b.m - a.m);
        const xl = (m) => (Math.abs(m) < 1e-9 ? "ATM" : sgn(m) + Math.round(Math.abs(Math.expm1(m)) * 100) + "%");
        const ivs = sf.iv.flat().filter((v) => num(v) !== null && v > 0);
        const lo = ivs.length ? Math.min(...ivs) : 0, hi = ivs.length ? Math.max(...ivs) : 0.01;
        const floor = lo - Math.max(hi - lo, 0.005) * 0.08;
        const grid = rows.map((o) => (sf.iv[o.r] || []).map((v) => (num(v) !== null && v > 0 ? v - floor : null)));
        return { handle: C.heatmap(host, { rows: rows.map((o) => o.m), cols: sf.expiries.map((e) => e.days + "d"), grid, cap: hi - floor, palette: "gamma",
          rowFormat: xl, colFormat: String, highlightRow: rows.findIndex((o) => Math.abs(o.m) < 1e-9), format: (v) => F.pct(v + floor), cellH: 14,
          label: card.ticker + " implied volatility by moneyness and expiry, shaded from " + F.pct(lo) + " to " + F.pct(hi) }),
          legend: [h("span", { class: "ui-key ft-ramp", role: "img", "aria-label": "Shade from " + F.pct(lo) + " to " + F.pct(hi) + " implied volatility" },
            h("span", { class: "ft-ramp-s", "aria-hidden": "true" }, RAMP_OPACITY.map((a) => h("i", { style: { "--c": cssVar("--g-long"), opacity: String(a) } }))), F.pct(lo, 0) + " – " + F.pct(hi, 0) + " IV"),
            keyOf("--fill-4", "", "Not quoted")] };
      } },
      { label: "History", st: ivRows.length > 4 ? OK : vc && vc.ivRank ? stOf(vc.ivRank, "implied volatility history") : panelSt(card, "volContext", "implied volatility history"), name: "Volatility history", draw: (host) => {
        const gm = new Map(), em = new Map();
        if (g && Array.isArray(g.dates)) g.dates.forEach((d, i) => { if (Array.isArray(g.condVol) && num(g.condVol[i]) !== null) gm.set(d, g.condVol[i] / 100); if (Array.isArray(g.ewma) && num(g.ewma[i]) !== null) em.set(d, g.ewma[i] / 100); });
        const series = [{ values: ivRows.map((r) => r.vol), color: "--accent", label: "IV", format: (v) => F.pct(v) }];
        if (gm.size) series.push({ values: ivRows.map((r) => (gm.has(r.date) ? gm.get(r.date) : null)), color: "--label-2", label: "GARCH", format: (v) => F.pct(v) });
        if (em.size) series.push({ values: ivRows.map((r) => (em.has(r.date) ? em.get(r.date) : null)), color: "--s-gray", dash: true, label: "EWMA", format: (v) => F.pct(v) });
        const refs = [num(pm.rv30) !== null ? { y: pm.rv30, color: "--s-teal", dash: true } : null].filter(Boolean);
        return { handle: C.line(host, { x: ivRows.map((r) => r.date), series, refs, yFormat: (v) => F.pct(v, 0), height: [280, 300, 320], label: card.ticker + " implied volatility against the GARCH conditional volatility and its EWMA reference" }),
          legend: [keyOf("--accent", "ln", "Implied 30d"), gm.size ? keyOf("--label-2", "ln", "GARCH vol") : null, em.size ? dashKey("--s-gray", "EWMA(0.94)") : null, refs.length ? dashKey("--s-teal", "RV 30d " + F.pct(pm.rv30)) : null] };
      } },
    ];
    const vw = viewer("Volatility view", views);
    const st = UI.partial(vw.views.map((v) => ({ name: v.label, st: v.st })));
    const iv30 = cone ? cone.iv30 : num(pm.iv30);
    const vrpV = vrp && vrp.exAnte ? vrp.exAnte.vrp : num(pm.vrp);
    const rr = skew ? skew.rr25 : sk ? sk.skew : null;
    const slope = cone ? cone.slope30_90 : null;
    const rk = ivRankOf(card);
    const cut = P.ivSurface && P.ivSurface.coverage && P.ivSurface.coverage.truncated ? "The vendor returned " + P.ivSurface.coverage.rowsReturned + " chain rows, the cap, so this surface may be an arbitrary subset of the book and far wings may be missing; " + P.ivSurface.coverage.filter + "." : null;
    mod({ id: "m-vol", title: "Volatility", span: [12, 6], st, seg: vw.seg, views: vw.views, index: 6, body: [
      mets([
        metric("IV 30d", F.pct(iv30), { sub: cone && num(cone.pct30) !== null ? "pct " + Math.round(cone.pct30 * 100) : num(pm.ivMomentum) !== null ? F.pts(pm.ivMomentum) + " pts 1d" : null, state: num(iv30) === null ? ST("unavailable", "No 30-day implied volatility on the card.") : null }),
        metric("IV rank", rk.v === null ? DASH : String(Math.round(rk.v * 100)), { sub: "of 100", state: rk.v === null ? rk.st : null }),
        metric("Premium", pts1(vrpV), { unit: "pts", tone: num(vrpV) === null ? null : vrpV > 0 ? "short" : vrpV < 0 ? "long" : null, sub: vrp && num(vrp.hitRate) !== null ? "won " + F.pct(vrp.hitRate, 0) : pm.richness ? pm.richness : null, state: num(vrpV) === null ? ST("unavailable", "No realized volatility to compare.") : null }),
        metric("Skew", pts1(rr), { unit: num(rr) === null ? null : "pts", sub: skew && num(skew.z) !== null ? "z " + F.signed(skew.z, 1) : sk && sk.skewBasis ? sk.skewBasis.days + "d put − call" : null,
          state: num(rr) === null ? ST(sk ? "quiet" : "unavailable", sk && sk.skewReason ? "The wing-to-wing skew is not published: " + sk.skewReason + "." : "No skew reading on the card.") : null }),
        metric("Term", slope === null ? DASH : F.pct(slope, 1, true), { sub: slope === null ? null : slope > 0 ? "Inverted" : slope < 0 ? "Contango" : "Flat", tone: slope === null ? null : slope > 0 ? "short" : null, state: slope === null ? xSt(X.cone, "term slope") : null }),
      ], { min: 88 }), vw.box, vw.leg],
      info: () => ({
        title: "Volatility", state: st.state === "ok" ? null : st.state, asOf: pm.asOf || null, lead: leadOf(vc) || leadOf(P.pricedMove),
        facts: [["IV 30d", F.pct(pm.iv30)], ["RV 30d", F.pct(pm.rv30)], ["Premium (ex-ante)", vrp && vrp.exAnte ? pts1(vrp.exAnte.vrp) + " pts, z " + F.signed(vrp.exAnte.z, 2) : num(pm.vrp) !== null ? pts1(pm.vrp) + " pts" : null],
          ["Premium ex-event", vrp && vrp.exAnte ? pts1(vrp.exAnte.vrpExEvent) + " pts" : null], ["Seller won", vrp ? F.pct(vrp.hitRate, 0) + " of " + vrp.n + " completed windows" : null],
          ["Band", richnessBand(pm) || DASH], ["Cone view", cone ? (cone.view || DASH) + " (" + F.signed(cone.richCheap * 100, 1) + ")" : null], ["IV rank", rk.v === null ? null : Math.round(rk.v * 100) + " of 100, a percentile of its own year"],
          ["RR25", skew ? pts1(skew.rr25) + " pts, z " + F.signed(skew.z, 2) + " (" + (skew.zBasis || "raw") + "), 5-day change " + pts1(skew.mom5) : null], ["RR10", skew && num(skew.rr10) !== null ? pts1(skew.rr10) + " pts" : null],
          ["Crash ratio", skew && num(skew.crash) !== null ? skew.crash.toFixed(2) + " (median " + (num(skew.crashMedian) === null ? DASH : skew.crashMedian.toFixed(2)) + ")" : null],
          ["Skew (put − call)", sk && num(sk.skew) !== null ? F.pts(sk.skew) + " pts" + SEP + (sk.skewBasis ? sk.skewBasis.days + "d" : "") : null], ["Term (far − near)", sk && num(sk.term) !== null ? F.pts(sk.term) + " pts" : null],
          ...(sk ? skewTermRead(sk).facts : []), ["Steepest cell", sf ? surfaceRead(sf).steepest : null],
          ["IV half-life", X.ivDyn && X.ivDyn.status === "ok" && num(X.ivDyn.halfLife) !== null ? X.ivDyn.halfLife.toFixed(1) + " sessions (" + X.ivDyn.view + ")" : null],
          ["Vol of vol", X.ivDyn && X.ivDyn.status === "ok" ? F.pct(X.ivDyn.volOfVolRel, 0) : null], ["Spot–vol correlation", X.ivDyn && X.ivDyn.status === "ok" && num(X.ivDyn.spotVolCorr) !== null ? X.ivDyn.spotVolCorr.toFixed(2) : null],
          ["Vendor anomaly", X.anomaly && X.anomaly.status === "ok" ? X.anomaly.view + " (" + F.signed(X.anomaly.score, 1) + ")" + (X.anomaly.vote === -1 ? ", disagrees with ours" : X.anomaly.vote === 1 ? ", agrees" : "") : null],
          ["Vendor character", X.character && X.character.status === "ok" ? X.character.character + ", Hurst " + fx(X.character.hurst, 2) : null],
          ...garchFacts(card)],
        sections: [{ title: "Cone", lines: [cone ? "Each tenor's dot is today's implied volatility; the bar is its year's range and the box its middle half. The grey band behind is the realized-volatility cone at the matching window (10th to 90th percentile over two years)." : reasonOf(views[0].st), freshNote(X.cone)] },
          { title: "Term", lines: [term && term.eventKink ? "The first expiry spanning the earnings day carries a premium of " + F.pts(term.eventKink.premium) + " percentile points over its neighbours." : null, term && term.eventMove && num(term.eventMove.sd) !== null ? "The implied earnings move is ±" + F.pct(term.eventMove.sd) + " (one sd)." : null, sk && sk.termReason] },
          { title: "Skew", lines: (sk ? skewTermRead(sk).lines : []).concat([sk && sk.relation, skew ? "The 25-delta risk reversal is read on the fixed " + skew.expiry + " expiry, so its maturity shrinks along the series; the z is maturity-adjusted." : reasonOf(views[2].st)]) },
          { title: "Surface", lines: [sf ? surfaceRead(sf).lead : reasonOf(views[4].st), cut] },
          { title: "Smile", lines: [smile ? (smile.source === "engine" ? "Smiles are the engine's own fitted curves per expiry." : "Smiles are the chain's measured points per expiry.") : reasonOf(views[3].st), P.ivSurface && P.ivSurface.ivBasis ? "IV basis: " + P.ivSurface.ivBasis : null,
            cut] },
          { title: "History", lines: ["Implied is the 30-day at-the-money volatility; beside it the GARCH conditional volatility for the same day and, dashed, an EWMA reference on the same returns.", vc && vc.note] },
          garchSection(card)],
      }) });
    vw.start();
  }

  function garchFacts(card) {
    const ctx = (card.panels || {}).context;
    const g = ctx && ctx.garch && ctx.garch.status === "ok" ? ctx.garch : null;
    if (!g) return [];
    const skewt = g.dist === "skewt";
    const pctv = (v) => (num(v) === null ? null : v.toFixed(1) + "%");
    const fixed = (v, dp) => (num(v) === null ? null : v.toFixed(dp));
    return [["GARCH vol last session", pctv(g.lastVol)], ["GARCH vol next session", skewt ? pctv(g.nextVol) : null], ["GARCH vol long run", pctv(g.longRunVol)],
      ["Tail shape ν", skewt ? fixed(g.nu, 1) : null], ["Skew λ", skewt && num(g.lambda) !== null ? F.signed(g.lambda, 2) : null],
      ["α + β", fixed(g.persistence, 3)], ["α", fixed(g.alpha, 3)], ["β", fixed(g.beta, 3)], ["ω", fixed(g.omega, 4)]];
  }
  function garchSection(card) {
    const ctx = (card.panels || {}).context;
    const g = ctx && ctx.garch;
    if (!g) return { title: "GARCH", lines: [reasonOf(panelSt(card, "context", "price context"))] };
    if (g.status !== "ok") return { title: "GARCH", lines: [cap(g.reason || "The volatility model was not fitted on this card.")] };
    const skewt = g.dist === "skewt";
    return { title: skewt ? "GARCH(1,1), Hansen skewed t" : "GARCH(1,1), fitted before the skewed t", lines: [
      skewt ? "The model fits this name's own daily returns with Hansen's skewed t density: ν is the tail shape and λ the skew, which a year of returns pins to about one decimal." : "This fit predates the skewed-t density, so no tail shape, skew or next-session figure is read from it.",
      "Fitted by " + (g.method || "maximum likelihood") + " on " + g.n + " daily returns, winsorised at six robust standard deviations (" + (g.capped || 0) + " capped).",
      skewt ? "The next-session cell is the recursion's own state one step ahead: the model's variance for tomorrow, not a price forecast." : null,
      "The dashed reference is the RiskMetrics EWMA at 0.94 on the same returns; where the two paths agree, the long-run cell is a measurement rather than an artefact of the fit.",
    ].concat(breaksOf(ctx)) };
  }

  const volPts = (v) => (num(v) === null ? DASH : F.signed(v * 100, 1));
  const vol1 = (v) => (num(v) === null ? DASH : (v * 100).toFixed(1) + "%");
  function surfaceRead(sf) {
    const rows = sf.rows || [], cols = sf.expiries || [], skM = sf.skew || [];
    let peak = null;
    for (let i = 0; i < rows.length; i++) for (let j = 0; j < cols.length; j++) {
      const v = num(Array.isArray(skM[i]) ? skM[i][j] : null);
      if (v !== null && (peak === null || Math.abs(v) > Math.abs(peak.s))) peak = { s: v, i, j };
    }
    const step = num(sf.step);
    const dp = step !== null && step < 0.01 ? 3 : 2;
    const band = (m) => { const t = Number(m).toFixed(dp); return /^-0\.?0*$/.test(t) ? t.slice(1) : t.replace(/^-/, MINUS); };
    const cell = peak ? band(rows[peak.i]) + " · " + String((cols[peak.j] && (cols[peak.j].expiry || cols[peak.j])) || DASH).slice(5) : null;
    const fresh = num(sf.fresh), placed = num(sf.placed);
    const plural = (n, a, b) => n + " " + (n === 1 ? a : b);
    const lead = peak === null ? "No cell on this surface carries a measured distance from its own expiry's at-the-money level, so the grid shows where this book is listed and nothing about how far off the level it is quoted."
      : peak.s === 0 ? "Every quote on this surface sits exactly on its own expiry's at-the-money level: a measured flat smile across " + plural(rows.length, "band", "bands") + " and " + plural(cols.length, "expiry", "expiries") + ", not an absence of readings."
        : "The steepest quote on this surface is " + volPts(peak.s) + " volatility points " + (peak.s > 0 ? "above" : "below") + " its own expiry's at-the-money level, at " + cell + "." +
          (fresh === null || placed === null ? " How many of these cells traded today is not published." : " " + fresh + " of " + placed + " placed cells are prints from today.");
    return { lead, steepest: peak ? volPts(peak.s) + " pts · " + cell : null };
  }
  function skewTermRead(sk) {
    const skew = num(sk.skew), sb = sk.skewBasis || null, term = num(sk.term), tb = sk.termBasis || null;
    const lines = [];
    lines.push(skew === null || !sb ? "The wing-to-wing skew is not published for this name. The reason it was withheld is stated below, verbatim, rather than replaced by a zero — a symmetric smile is a real and notable reading, and this is not one."
      : "Skew " + volPts(skew) + " volatility points at " + (num(sb.days) === null ? "an unstated tenor" : sb.days + " days") + " (" + sb.expiry + "): " + (skew > 0 ? "the put wing is bid over the call wing." : skew < 0 ? "the call wing is bid over the put wing." : "both wings are quoted at the same volatility."));
    lines.push(term === null || !tb ? "The term difference is not published for this name. The reason it was withheld is stated below, verbatim."
      : "Term " + volPts(term) + " volatility points from " + tb.nearDays + " days to " + tb.farDays + " days: " + (term < 0 ? "the front is bid over the back — " : term > 0 ? "the back is bid over the front — " : "front and back are quoted at the same level — ") +
        "at-the-money volatility " + vol1(tb.nearAtm) + " at " + tb.near + " against " + vol1(tb.farAtm) + " at " + tb.far + ".");
    if (skew === null && sk.skewReason) lines.push("The wing-to-wing skew is not published: " + String(sk.skewReason).replace(/\.$/, "") + ".");
    if (term === null && sk.termReason) lines.push("The term difference is not published: " + String(sk.termReason).replace(/\.$/, "") + ".");
    const silence = (key) => (key in sk ? (sk[key] === null ? "quiet" : "withheld") : "unavailable");
    const atm = num(sk.atmIv), band = num(sk.atmBand);
    const facts = [
      ["At-the-money level", atm !== null ? vol1(atm) + (sk.atmExpiry ? " at " + sk.atmExpiry : "") : DASH + " " + silence("atmIv") + ": " + (sk.atmReason || (silence("atmIv") === "withheld" ? "the at-the-money level on this card is not a number, so it is withheld rather than printed as one" : "this card's chain panel carries no at-the-money level and no reason for it"))],
      ["Moneyness band", band !== null ? "±" + band.toFixed(2) + " ln(K/S)" : DASH + " " + silence("atmBand") + ": the band a quote must sit inside to be counted at the money is this surface's own constant, and this card does not state it, so the level cannot be read against the window it was taken from"],
    ];
    return { lines, facts };
  }

  function buildFlow(card) {
    const P = card.panels || {};
    const X = STATE.cardX || {};
    const tp = STATE.tape && STATE.tape.prem && STATE.tape.prem.status === "ok" && Array.isArray(STATE.tape.prem.t) && STATE.tape.prem.t.length > 1 ? STATE.tape.prem : null;
    const path = P.path && P.path.status === "ok" ? P.path : null;
    const legs = pathLegs(card);
    const stSession = legs && legs.d.some((v) => num(v) !== null) ? OK : panelSt(card, "path", "session flow");
    const fe = X.flowExpiry && X.flowExpiry.status === "ok" ? X.flowExpiry : null;
    const fs = X.flowStrike && X.flowStrike.status === "ok" ? X.flowStrike : null;
    const ag = P.aggressor && P.aggressor.status === "ok" ? P.aggressor : null;
    const axis = histAxis(STATE.hist);
    const npY = axis && STATE.hist.volume ? unpack(STATE.hist.volume.np, axis.length) : null;
    const pt = P.premiumTrack && P.premiumTrack.status === "ok" ? P.premiumTrack : null;
    const npOk = npY && npY.some((v) => v !== null);
    const S = spotOf(card);
    const views = [
      { label: "Session", st: stSession, name: "Session path", draw: (host) => pathChart(host, card, legs) },
      { label: "Tenor", st: fe ? OK : xSt(X.flowExpiry, "flow by expiry"), never: offIndex(card, X.flowExpiry), name: "Premium by expiry", draw: (host) => {
        const rows = fe.rows.filter((r) => isoOk(r.e));
        return { handle: C.diverging(host, { x: rows.map((r) => r.e), values: rows.map((r) => r.np), height: [200, 220, 240], format: moneyPx, label: card.ticker + " net premium by expiry",
          readout: (i) => [C.part(day(rows[i].e) + SEP + rows[i].dte + "d", "k"), h("b", { "data-tone": tone(rows[i].np) }, moneyPx(rows[i].np)), C.part("gross " + F.money(rows[i].gross), "k"), C.part("otm " + F.pct(rows[i].gross ? rows[i].otm / rows[i].gross : null, 0), "k")] }),
          legend: [keyOf("--up-mark", "", "Net bought"), keyOf("--down-mark", "", "Net sold")] };
      } },
      { label: "Strikes", st: fs || ag ? OK : xSt(X.flowStrike, "flow by strike"), never: !ag && offIndex(card, X.flowStrike), name: "Flow by strike", draw: (host) => {
        if (fs) {
          const L = fs.ladder.filter((r) => num(r.k) !== null && num(r.np) !== null).sort((a, b) => a.k - b.k);
          const xs = L.map((r) => r.k);
          const marks = [num(fs.centroid) !== null ? { x: fs.centroid, shape: "ring", color: "--label-1", row: "base", r: 4.5 } : null, num(fs.callWall) !== null ? { x: fs.callWall, shape: "dot", color: "--lvl-call", row: "base", r: 3.5 } : null, num(fs.putWall) !== null ? { x: fs.putWall, shape: "dot", color: "--lvl-put", row: "base", r: 3.5 } : null].filter(Boolean);
          return { handle: C.diverging(host, { x: xs, values: L.map((r) => r.np), xType: "number", spot: S, markers: marks, height: [200, 230, 250], format: moneyPx, xFormat: (v) => K(v), label: card.ticker + " net premium by strike",
            readout: (i) => [C.part("Strike", "k"), h("b", null, K(xs[i])), C.part(moneyPx(L[i].np), null, tone(L[i].np)), C.part("gross " + F.money(L[i].gross), "k")] }),
            legend: [keyOf("--up-mark", "", "Net bought"), keyOf("--down-mark", "", "Net sold"), keyOf("--label-1", "ring", "Centroid"), keyOf("--lvl-call", "dot", "Call wall"), keyOf("--lvl-put", "dot", "Put wall")] };
        }
        const [lo, hi] = strikeWindow(card, S);
        const bars = ag.bars.filter((b) => num(b.k) !== null && num(b.net) !== null && b.k >= lo && b.k <= hi).sort((a, b) => a.k - b.k);
        return { handle: C.diverging(host, { x: bars.map((b) => b.k), values: bars.map((b) => b.net), xType: "number", spot: S, height: [200, 230, 250], xFormat: (v) => K(v), label: card.ticker + " aggressor net contracts by strike",
          readout: (i) => [C.part("Strike", "k"), h("b", null, K(bars[i].k)), C.part(F.num(bars[i].net, true) + " net", null, tone(bars[i].net)), C.part(F.num(bars[i].vol) + " traded", "k")] }),
          legend: [keyOf("--up-mark", "", "Call side"), keyOf("--down-mark", "", "Put side"), keyOf("--label-1", "ln", "Spot")] };
      } },
      { label: "Days", st: npOk || pt ? OK : panelSt(card, "premiumTrack", "premium history"), never: isIndex(card) && !pt && !npOk, name: "Premium by session", draw: (host) => {
        if (npOk) {
          return { handle: C.diverging(host, { x: axis, values: npY, height: [200, 220, 240], maxWidth: 4, endLabel: true, format: moneyPx, label: card.ticker + " net premium by session over the year",
            readout: (i) => [C.part(day(axis[i]), "k"), npY[i] === null ? C.part("no reading", "k") : h("b", { "data-tone": tone(npY[i]) }, moneyPx(npY[i]))] }),
            legend: [keyOf("--up-mark", "", "Net bought"), keyOf("--down-mark", "", "Net sold"), keyOf("--label-4", "dot", "No reading")] };
        }
        const rows = pt.rows.filter((r) => isoOk(r.d)).sort((a, b) => (a.d < b.d ? -1 : 1));
        return { handle: C.diverging(host, { x: rows.map((r) => r.d), values: rows.map((r) => num(r.p)), height: [200, 220, 240], endLabel: true, format: moneyPx, label: card.ticker + " net premium by session" }),
          legend: [keyOf("--up-mark", "", "Net bought"), keyOf("--down-mark", "", "Net sold"), keyOf("--label-4", "dot", "No reading")] };
      } },
    ];
    const vw = viewer("Flow view", views);
    const st = UI.partial(vw.views.map((v) => ({ name: v.label, st: v.st })));
    const net = tp ? tp.net[tp.net.length - 1] : path ? path.netPremium : null;
    const nd = tp && Array.isArray(tp.nd) ? tp.nd[tp.nd.length - 1] : path ? path.netDelta : null;
    const nope = X.nope && X.nope.status === "ok" ? X.nope : null;
    const agNet = ag && Array.isArray(ag.bars) ? ag.bars.reduce((a, b) => a + (num(b.net) || 0), 0) : null;
    const al = X.alerts && X.alerts.status === "ok" ? X.alerts : null;
    const ml = X.multiLeg && X.multiLeg.status === "ok" ? X.multiLeg : null;
    const meter = (label, v, c) => h("div", { class: "ft-meter" }, h("span", null, label), h("span", { class: "ui-meter" }, h("i", { style: { "--w": (clamp(num(v) || 0, 0, 1) * 100).toFixed(1) + "%", "--c": cssVar(c) } })), h("b", null, F.pct(v, 0)));
    const tileList = [
      offIndex(card, X.alerts) ? null : UI.tile({ title: "Alerts", value: al ? String(al.n) : DASH, unit: al ? F.money(al.prem) : null, state: al ? null : xSt(X.alerts, "alert tape"),
        info: () => ({ title: "Flow alerts", lead: al ? al.n + " alerts on this name in the session, " + F.money(al.prem) + " of premium" + (al.complete ? "." : "; the read stopped before the open, so the count is a floor.") : null,
          facts: [["At the ask", F.pct(al && al.askShare, 0)], ["Sweeps", F.pct(al && al.sweepShare, 0)], ["Opening", F.pct(al && al.openingShare, 0)], ["Calls", F.pct(al && al.callShare, 0)], ["Urgency", al ? F.pct(al.urgency, 2) + " of ADV" : null]] }),
        body: al ? h("div", { class: "ft-meters" }, meter("Ask", al.askShare, "--up-mark"), meter("Sweep", al.sweepShare, "--s-orange"), meter("Open", al.openingShare, "--s-blue")) : null }),
      offIndex(card, X.multiLeg) ? null : UI.tile({ title: "Structures", value: ml ? String(ml.n) : DASH, unit: ml ? F.money(ml.grossPrem) : null, state: ml ? null : xSt(X.multiLeg, "multi-leg read"),
        info: () => ({ title: "Multi-leg structures", lead: ml ? ml.n + " multi-leg structures traded in the session" + (ml.truncated ? " (the read hit its page ceiling, so this is a floor)" : "") + "." : null,
          facts: ml ? [["Net premium", moneyPx(ml.netPrem)], ["Credit share", F.pct(ml.creditShare, 0)], ["Opening share", F.pct(ml.openingShare, 0)], ["Long / short", ml.long + " / " + ml.short],
            ...ml.byStrategy.slice(0, 6).map((b) => [String(b.s).replace(/_/g, " "), b.n + SEP + moneyPx(b.np)])] : [], notes: ["Net greeks on multi-leg rows are in the vendor's own unit and are not converted."] }),
        body: ml ? h("div", { class: "ft-meters" }, meter("Credit", ml.creditShare, "--s-purple"), meter("Open", ml.openingShare, "--s-blue"), h("div", { class: "ui-tags" }, ml.byStrategy.slice(0, 2).map((b) => tag(String(b.s).replace(/_/g, " "))))) : null }),
    ].filter(Boolean);
    const tiles = tileList.length ? h("div", { class: "ui-tiles ft-tiles" }, tileList) : null;
    mod({ id: "m-flow", title: "Flow", span: [12, 6], st, seg: vw.seg, views: vw.views, index: 7, body: [
      mets([
        metric("Net premium", moneyPx(net), { tone: tone(net), sub: tp ? "live" : path && num(path.minutes) ? Math.round(path.minutes / 6) / 10 + "h session" : null, state: num(net) === null ? stSession : null }),
        metric("Net delta", F.num(nd, true), { tone: tone(nd), sub: tp ? "live tape" : "session", state: num(nd) === null ? stSession : null }),
        offIndex(card, X.nope) ? null : metric("NOPE", nope ? F.pct(nope.close, 1, true) : DASH, { tone: nope ? tone(nope.close) : null, sub: nope && num(nope.z) !== null ? "z " + F.signed(nope.z, 1) : nope ? "no history" : null, state: nope ? null : xSt(X.nope, "NOPE read") }),
        metric("Aggressor", F.num(agNet, true), { tone: tone(agNet), sub: agNet === null ? null : agNet < 0 ? "to puts" : "to calls", state: agNet === null ? panelSt(card, "aggressor", "aggressor ladder") : null }),
      ], { min: 96 }), vw.box, vw.leg, tiles],
      info: () => ({
        title: "Flow", state: st.state === "ok" ? null : st.state, asOf: (path && path.asOf) || null, lead: leadOf(P.path) || reasonOf(panelSt(card, "path", "session flow")),
        facts: pathFacts(card).concat([["NOPE", nope ? F.pct(nope.close, 2, true) + " (fill " + F.pct(nope.fill, 1) + ", divergence " + nope.divergence + ")" : null],
          ["Tenor", fe ? "conviction " + fx(fe.convictionDte, 1) + " days, bucket " + fe.convictionBucket + ", OTM share " + F.pct(fe.otmShare, 0) : null],
          ["Centroid", fs ? F.px(fs.centroid) + " (" + F.signed(fs.centroidSigma, 2) + " SD from spot)" : null], ["Wall share", fs ? F.pct(fs.wallShare, 1) + " of in-band flow at the walls" : null]]),
        sections: [{ title: "Aggressor", lines: [leadOf(P.aggressor) || reasonOf(panelSt(card, "aggressor", "aggressor ladder")), P.aggressor && P.aggressor.relation] },
          { title: "Session", lines: [tp ? "Read from the live tape at " + F.time(tp.readAt) + "." : null].concat(pathNotes(card, legs)) },
          { title: "Days", lines: [npY ? "Net premium per session over the year from the vendor's options-volume history; a dot is a session with no reading, not a zero." : pt ? pt.unit : reasonOf(panelSt(card, "premiumTrack", "premium history"))] }],
      }) });
    vw.start();
  }

  function buildPositioning(card) {
    const X = STATE.cardX || {};
    if (offIndex(card, X.short) && offIndex(card, X.insiders)) return;
    const sh = X.short && X.short.status === "ok" ? X.short : null;
    const si = sh && sh.interest && num(sh.interest.si) !== null ? sh.interest : null;
    const bo = sh && sh.borrow && sh.borrow.status === "ok" ? sh.borrow : null;
    const sv = sh && sh.volume && sh.volume.status === "ok" ? sh.volume : null;
    const ins = X.insiders && (X.insiders.status === "ok" || X.insiders.status === "quiet") ? X.insiders : null;
    const stShort = sh ? OK : xSt(X.short, "short interest read");
    const insRead = !!ins && ins.status === "ok" && num(ins.net90) !== null;
    const svPath = sv && Array.isArray(sv.path) ? sv.path.filter((p) => isoOk(p[0]) && num(p[1]) !== null) : [];
    const boPath = bo && Array.isArray(bo.path) ? bo.path.filter((p) => isoOk(p[0]) && num(p[1]) !== null) : [];
    const dots = ins && Array.isArray(ins.dots) ? ins.dots.filter((d) => isoOk(d[0]) && num(d[1]) !== null).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) : [];
    const pct2 = (v) => F.pct(v, 2);
    const views = [
      { label: "Short vol", st: svPath.length > 2 ? OK : sh ? ST(sh.volume && sh.volume.status === "unavailable" ? "unavailable" : "quiet", sh.volume && sh.volume.why ? sh.volume.why : "No short-volume history on this name's dossier.") : stShort, name: "Short volume ratio", draw: (host) => ({
        handle: C.line(host, { x: svPath.map((p) => p[0]), series: [{ values: svPath.map((p) => p[1]), color: "--s-purple", area: true, format: (v) => F.pct(v, 1) }], refs: num(sv.mean60) !== null ? [{ y: sv.mean60, dash: true }] : [],
          yFormat: (v) => F.pct(v, 0), height: [160, 180, 190], label: card.ticker + " FINRA short-volume ratio, last " + svPath.length + " sessions" }),
        legend: [keyOf("--s-purple", "ln", "Short volume"), dashKey("--label-3", "60-day mean")] }) },
      { label: "Borrow", st: boPath.length > 1 ? OK : sh && sh.borrow ? xSt(sh.borrow, "borrow read") : stShort, name: "Borrow fee", draw: (host) => ({
        handle: C.line(host, { x: boPath.map((p) => p[0]), series: [{ values: boPath.map((p) => p[1]), color: "--s-orange", format: pct2 }], yFormat: pct2, height: [160, 180, 190], label: card.ticker + " borrow fee" }),
        legend: [keyOf("--s-orange", "ln", "Fee")] }) },
      { label: "Insiders", st: dots.length ? OK : ins ? ST("quiet", "No insider purchase or sale in the last 90 days.") : xSt(X.insiders, "insider read"), name: "Insider trades", draw: (host) => ({
        handle: C.diverging(host, { x: dots.map((d) => day(d[0])), values: dots.map((d) => d[1]), height: [160, 180, 190], format: moneyPx, label: card.ticker + " insider purchases and sales, signed dollars, one bar per filing in date order",
          readout: (i) => [C.part(day(dots[i][0]), "k"), h("b", { "data-tone": tone(dots[i][1]) }, moneyPx(dots[i][1])), C.part(dots[i][2] === "P" ? "purchase" : "sale", "k"), dots[i][4] === 1 ? C.part("10b5-1 plan", "k") : null] }),
        legend: [keyOf("--up-mark", "", "Bought"), keyOf("--down-mark", "", "Sold")] }) },
    ];
    const vw = viewer("Positioning view", views);
    const st = UI.partial(vw.views.map((v) => ({ name: v.label, st: v.st })));
    mod({ id: "m-pos", title: "Positioning", span: [6, 6], st: sh || ins ? st : UI.worst([stShort, xSt(X.insiders, "insider read")]), seg: vw.seg, views: vw.views, index: 8, body: [
      mets([
        metric("Short float", si ? F.pct(si.si, 1) : DASH, { sub: si && num(si.dtc) !== null ? si.dtc.toFixed(1) + "d to cover" : null, state: si ? (si.stale ? ST("stale", "The latest settlement (" + si.date + ") is older than 45 days.") : null) : sh ? ST("quiet", "No short-interest settlement on this name.") : stShort }),
        metric("Borrow", bo ? F.pct(bo.fee, 2) : DASH, { tone: bo && bo.htb ? "down" : null, sub: bo && num(bo.dFee5) !== null ? F.pts(bo.dFee5, 2) + " pts 5d" : null, state: bo ? null : sh && sh.borrow ? xSt(sh.borrow, "borrow read") : stShort }),
        metric("Short vol", sv ? F.pct(sv.ratio, 0) : DASH, { sub: sv && num(sv.z) !== null ? "z " + F.signed(sv.z, 1) : null, state: sv ? null : sh && sh.volume ? xSt(sh.volume, "short-volume read") : stShort }),
        metric("Insiders 90d", insRead ? moneyPx(ins.net90) : DASH, { tone: insRead ? tone(ins.net90) : null, sub: insRead ? (ins.buyCount || 0) + " buy" + SEP + (ins.sellCount || 0) + " sell" : null,
          state: !ins ? xSt(X.insiders, "insider read") : insRead ? null : ST("quiet", "No insider purchase or sale in the last 90 days.") }),
      ], { min: 92 }), vw.box, vw.leg],
      info: () => ({
        title: "Positioning and ownership", asOf: si ? si.date : null, lead: sh ? "Short interest, borrow and short volume from FINRA and the vendor, and insider Form 4 trades over the last 90 days." : stShort.reason,
        facts: [["Short interest", si ? F.pct(si.si, 2) + " of float (" + F.int(si.shares) + " shares, settled " + si.date + ", " + si.ageDays + " days old)" : null], ["Days to cover", si && num(si.dtc) !== null ? si.dtc.toFixed(2) : null],
          ["Borrow fee", bo ? F.pct(bo.fee, 2) + " a year" + (bo.htb ? ", hard to borrow" : "") : null], ["Rebate", bo ? F.pct(bo.rebate, 2) : null], ["Shares available", bo ? F.int(bo.avail) + (bo.availCensored ? " (the vendor's cap)" : "") : null],
          ["Short-volume ratio", sv ? F.pct(sv.ratio, 1) + " (60-day mean " + F.pct(sv.mean60, 1) + ", z " + F.signed(sv.z, 2) + ")" : null],
          ["Squeeze pressure", sh && sh.squeeze && num(sh.squeeze.pressure) !== null ? F.signed(sh.squeeze.pressure, 2) + " sd across the deep names" : null],
          ["Insider net 90d", ins ? moneyPx(ins.net90) + " (" + moneyPx(ins.net90ExPlan) + " outside 10b5-1 plans)" : null], ["Distinct buyers", ins ? String(ins.buyers) : null],
          ["Cluster", ins ? (ins.cluster ? ins.clusterBuyers + " buyers from " + ins.clusterFrom : "none (" + (ins.clusterRule || "3 buyers inside 30 days") + ")") : null], ["Plan share of sales", ins ? F.pct(ins.planShare, 0) : null]],
        notes: [sv && sv.rule ? sv.rule + "." : "A 40–50% short-volume baseline is market making, not short interest.", sh && sh.squeeze && sh.squeeze.rule ? sh.squeeze.rule + "." : null],
      }) });
    vw.start();
  }

  function eventsChart(host, card, ev, cols) {
    const iD = 0, iW = 1, iE = 2, iM = 3;
    const rows = ev.filter((r) => Array.isArray(r) && isoOk(r[iD])).slice().sort((a, b) => (a[iD] < b[iD] ? -1 : 1));
    return C.mount(host, (el, w, animate) => {
      const H = heightOf(w, [170, 190, 200]);
      const top = 14, bot = 24, left = 4, right = 44;
      const n = rows.length;
      const band = (w - left - right) / Math.max(1, n);
      const xc = (i) => left + band * (i + 0.5);
      const vals = rows.flatMap((r) => [Math.abs(num(r[iM]) || 0), num(r[iE]) || 0]);
      const mx = Math.max(...vals, 0.01);
      const y = C.lin(0, mx * 1.1, H - bot, top);
      const svg = C.svgRoot(el, w, H, animate, card.ticker + " realized moves after each earnings report against the move the options priced");
      s("line", { x1: 0, x2: w - right, y1: H - bot, y2: H - bot, class: "base" }, svg);
      const bw = clamp(band * 0.5, 3, 16);
      rows.forEach((r, i) => {
        const m = num(r[iM]), em = num(r[iE]);
        if (m === null) s("circle", { cx: xc(i), cy: H - bot, r: 1.6, fill: cssVar("--label-4") }, svg);
        else s("rect", { x: xc(i) - bw / 2, y: y(Math.abs(m)), width: bw, height: Math.max(1.5, y(0) - y(Math.abs(m))), rx: Math.min(3, bw / 2), fill: cssVar(m >= 0 ? "--up-mark" : "--down-mark"), class: "grow", style: { "--i": String(i * 3) } }, svg);
        if (em !== null) s("line", { x1: xc(i) - bw / 2 - 3, x2: xc(i) + bw / 2 + 3, y1: y(em), y2: y(em), stroke: cssVar("--accent-ink"), "stroke-width": 2, "stroke-linecap": "round", class: "fade" }, svg);
      });
      const med = num(STATE.cardX && STATE.cardX.earnings && STATE.cardX.earnings.medianAbsMove);
      if (med !== null) { s("line", { x1: 0, x2: w - right, y1: y(med), y2: y(med), class: "hair", "stroke-dasharray": "2 3" }, svg); s("text", { x: w - right + 6, y: y(med) + 4, text: F.pct(med, 1), class: "tx-3" }, svg); }
      const every = Math.max(1, Math.ceil(n / (w < 600 ? 4 : 7)));
      rows.forEach((r, i) => { if ((n - 1 - i) % every === 0) s("text", { x: xc(i), y: H - 6, text: String(r[iD]).slice(2, 4) === "" ? "" : F.day(r[iD]).split(" ")[0] + " ’" + String(r[iD]).slice(2, 4), "text-anchor": "middle" }, svg); });
      C.scrub(el, svg, { xs: rows.map((_, i) => xc(i)), top, bottom: H - bot, label: "Earnings moves",
        onMove: (i) => { const r = rows[i]; const m = num(r[iM]), em = num(r[iE]); return { parts: [C.part(r[iD] + (r[iW] ? SEP + String(r[iW]).replace("market", "") : ""), "k"), C.part("moved", "k"), h("b", { "data-tone": tone(m) }, F.pct(m, 1, true)), C.part("priced ±" + F.pct(em, 1), "k"), m !== null && em ? C.part("×" + (Math.abs(m) / em).toFixed(2), "k") : null] }; } });
    });
  }

  function buildEvents(card) {
    const X = STATE.cardX || {};
    if (offIndex(card, X.earnings)) return;
    const E = X.earnings && (X.earnings.status === "ok" || X.earnings.status === "thin") ? X.earnings : null;
    const stE = E ? OK : xSt(X.earnings, "earnings history");
    const next = E && E.next ? E.next : null;
    const term = X.term && X.term.status === "ok" ? X.term : null;
    const implied = E && E.impliedNext && num(E.impliedNext.em) !== null ? E.impliedNext.em : term && term.eventMove && num(term.eventMove.sd) !== null ? term.eventMove.sd : null;
    const cols = E && Array.isArray(E.eventCols) ? E.eventCols : [];
    const ev = E && Array.isArray(E.events) ? E.events : [];
    const box = h("div", { class: "ft-cbox" });
    mod({ id: "m-events", title: "Events", span: [12, 5], st: stE, index: 3, body: [
      mets([
        metric("Next report", next && isoOk(next.d) ? day(next.d) : DASH, { sub: next ? (num(next.sessions) !== null ? SESSIONS(next.sessions) : "") + (next.confirmed ? "" : SEP + "est.") : null, state: next ? null : E ? ST("quiet", "No upcoming report on the calendar.") : stE }),
        metric("Implied", implied === null ? DASH : "±" + F.pct(implied, 1), { key: keyOf("--accent-ink", "ln", ""), state: implied === null ? ST("quiet", "No implied earnings move: the report is not inside the listed expiries or the next five sessions.") : null }),
        metric("Realized", E && num(E.medianAbsMove) !== null ? "±" + F.pct(E.medianAbsMove, 1) : DASH, { sub: E && num(E.medianRatio) !== null ? "×" + E.medianRatio.toFixed(2) + " priced" : null, state: E ? null : stE }),
        metric("Beat", E && num(E.beat) !== null ? F.pct(E.beat, 0) : DASH, { sub: "moved > priced", state: E ? null : stE }),
        metric("Straddle", E && num(E.ls1dHit) !== null ? F.pct(E.ls1dHit, 0) : DASH, { sub: "1d hit rate", state: E && num(E.ls1dHit) !== null ? null : E ? ST("quiet", "The vendor published no straddle values for these reports.") : stE }),
      ], { min: 84 }), box, legend([keyOf("--up-mark", "", "Up"), keyOf("--down-mark", "", "Down"), keyOf("--accent-ink", "ln", "Priced"), dashKey("--label-3", "Median")])],
      info: () => ({
        title: "Events", state: stE.state === "ok" ? null : stE.state, asOf: next && next.d ? "Next " + next.d : null,
        lead: E ? "The last " + ev.length + " reports: the bar is the move the day after, the tick the move the options priced beforehand." : stE.reason,
        facts: E ? [["Next", next ? next.d + " (" + (next.when || "time unknown") + ", " + (next.confirmed ? "confirmed" : "estimated from " + (next.source || "the calendar")) + ")" : null],
          ["Implied now", implied === null ? null : "±" + F.pct(implied, 2)], ["Today against history", num(E.ratioToday) !== null ? "×" + E.ratioToday.toFixed(2) + " of the median realized move" : null],
          ["Median ratio", num(E.medianRatio) !== null ? E.medianRatio.toFixed(2) : null], ["Beat share", F.pct(E.beat, 0)], ["Median move", F.pct(E.medianAbsMove, 1)], ["Median priced", F.pct(E.medianExpected, 1)],
          ["Day-one drift", num(E.drift) !== null ? F.pct(E.drift, 2, true) + " (" + (E.drift > 0 ? "moves kept going" : "moves faded") + ")" : null], ["Run-up", num(E.runup) !== null ? F.pct(E.runup, 2, true) : null],
          ["Long straddle 1d / 1w", num(E.ls1dHit) !== null ? F.pct(E.ls1dHit, 0) + " / " + F.pct(E.ls1wHit, 0) + " profitable" : null], ["Vendor cross-check", num(E.vendorRatio) !== null ? E.vendorRatio.toFixed(2) : null]] : [],
        sections: [{ title: "Rules", lines: E && E.rules ? Object.values(E.rules) : [] }, { title: "Term", lines: [term && term.eventExpiry ? "The first expiry after the report is " + term.eventExpiry + "." : null] }],
      }) });
    if (!E || !ev.length) box.append(UI.silent(E ? ST("quiet", "No past report with a priced move to compare against.") : stE, "Earnings history", 170));
    else eventsChart(box, card, ev, cols);
  }

  const TAPE_COLS = {
    contracts: "24px minmax(0,1fr) var(--mw, minmax(40px,80px)) 52px 56px", oi: "24px minmax(0,1fr) var(--mw, minmax(40px,72px)) 48px 56px",
    prints: "minmax(0,1fr) var(--mw, minmax(40px,90px)) 64px", alerts: "24px minmax(0,1fr) var(--mw, minmax(40px,72px)) 56px 44px",
  };
  const TAPE_HEADS = { contracts: ["Contract", "Volume", "Net"], oi: ["Contract", "OI", "Change"], alerts: ["Contract", "Premium", "At ask"], prints: ["Print", "Premium"] };
  function tapeHead(kind) {
    const [a, b, c] = TAPE_HEADS[kind];
    return h("div", { class: "ft-lh", style: { "--cols": TAPE_COLS[kind] } }, kind === "prints" ? null : h("span", { class: "ft-lh-b" }),
      h("span", { class: "ft-lh-m" }, a), h("span", { class: "ft-lh-x" }), h("span", { class: "ft-lh-v" }, b), c ? h("span", { class: "ft-lh-v" }, c) : null);
  }
  function tapeRows(kind, card) {
    const P = card.panels || {};
    const S = spotOf(card);
    const X = STATE.cardX || {};
    if (kind === "contracts") {
      const tc = P.topContracts;
      const R = (tc.rows || []).filter((r) => num(r.vol) !== null);
      const mx = Math.max(...R.map((r) => r.vol), 1);
      return R.map((r, i) => UI.listRow({ badge: r.cp, badgeTone: r.cp === "C" ? "up" : "down", badgeLabel: r.cp === "C" ? "Call" : "Put", primary: K(r.k),
        secondary: day(r.expiry) + (num(r.iv) !== null ? SEP + F.pct(r.iv, 0) : ""), meter: r.vol / mx, index: i, value: F.num(r.vol),
        signed: num(r.aggr) === null ? UI.dash(ST("withheld", "The vendor did not report which side took this contract's volume, so its aggressor net is withheld rather than zeroed."), "Aggressor net") : F.num(r.aggr, true), signedValue: r.aggr, cols: TAPE_COLS.contracts }));
    }
    if (kind === "oi") {
      const oi = P.oiDeltas;
      const life = new Map((X.contracts && Array.isArray(X.contracts.rows) ? X.contracts.rows : []).map((r) => [r.id, r]));
      const R = (oi.rows || []).filter(Boolean);
      const mx = Math.max(...R.map((r) => Math.abs(num(r.diff) || 0)), 1);
      return R.map((r, i) => {
        const lf = life.get(r.oc);
        const row = UI.listRow({ badge: r.cp, badgeTone: r.cp === "C" ? "up" : "down", badgeLabel: r.cp === "C" ? "Call" : "Put", primary: K(r.k),
          secondary: day(r.exp) + (num(r.oiUpDays) !== null ? SEP + r.oiUpDays + "d ↑OI" : "") + (num(r.volGtOiDays) !== null ? SEP + r.volGtOiDays + "d V>OI" : ""),
          meter: Math.abs(num(r.diff) || 0) / mx, meterColor: num(r.diff) !== null && r.diff < 0 ? "--down-mark" : "--label-2", index: i,
          value: num(r.currOi) === null ? UI.dash(ST("unavailable", "The vendor published no open interest for this contract."), "Open interest") : F.num(r.currOi),
          signed: num(r.diff) === null ? UI.dash(ST("unavailable", "The vendor published no prior clearing day's open interest for this contract, so its change is not stated rather than stated as zero."), "Change") : F.num(r.diff, true), signedValue: num(r.diff), cols: TAPE_COLS.oi });
        row.title = "Open interest " + (num(r.currOi) === null ? DASH : F.int(r.currOi)) + ", change " + (num(r.diff) === null ? DASH : F.int(r.diff, true)) + (num(r.ratio) !== null ? ", growth " + F.pct(r.ratio, 0, true) : "");
        if (lf && Array.isArray(lf.oi)) {
          const sp = h("span", { class: "ft-life", "aria-hidden": "true" });
          const meterEl = row.querySelector(".ui-meter");
          if (meterEl) meterEl.replaceWith(sp); else row.append(sp);
          requestAnimationFrame(() => C.sparkline(sp, lf.oi, { color: r.cp === "C" ? "--up" : "--down", height: 22 }));
          row.title += "; built over " + (lf.buildSessions || 0) + " sessions from " + (lf.buildStart || DASH) + ", " + F.pct(lf.askShareBuild, 0) + " of the building volume at the ask";
        }
        return row;
      });
    }
    if (kind === "prints") {
      const dp = P.darkpool;
      const R = (dp.rows || []).filter((r) => num(r.prem) !== null);
      const mx = Math.max(...R.map((r) => r.prem), 1);
      return R.map((r, i) => {
        const hhmm = Number.isFinite(Date.parse(r.at)) ? F.time(r.at).replace(" ET", "") : DASH;
        const quote = num(r.bid) !== null && num(r.ask) !== null ? F.px(r.bid) + " / " + F.px(r.ask) : DASH;
        const row = UI.listRow({ primary: F.px(r.px), secondary: hhmm + (S ? SEP + F.pct(r.px / S - 1, 2, true) : ""),
          meter: r.prem / mx, index: i, value: F.money(r.prem), cols: TAPE_COLS.prints });
        row.dataset.time = hhmm;
        row.dataset.quote = quote;
        row.title = "Quote at the print: " + quote;
        row.classList.add("ft-print");
        if (r.canceled === true) { row.dataset.canceled = "true"; row.querySelector(".ui-row-m").append(tag("cancelled", { tone: "down" })); }
        return row;
      });
    }
    if (kind === "alerts") {
      const al = X.alerts;
      const R = (al.dots || []).slice().sort((a, b) => b.p - a.p);
      const mx = Math.max(...R.map((r) => r.p), 1);
      const t = (mm) => { const mins = 570 + mm; return (Math.floor(mins / 60) % 12 || 12) + ":" + String(mins % 60).padStart(2, "0"); };
      return R.map((r, i) => UI.listRow({ badge: r.cp, badgeTone: r.cp === "C" ? "up" : "down", badgeLabel: r.cp === "C" ? "Call" : "Put", primary: K(r.k),
        secondary: day(r.e) + SEP + t(r.m) + (r.sw ? SEP + "sweep" : "") + (r.op ? SEP + "opening" : ""), meter: r.p / mx, index: i, value: F.money(r.p),
        signed: F.pct(r.a, 0), signedValue: num(r.a) === null ? null : r.a - 0.5, cols: TAPE_COLS.alerts }));
    }
    return [];
  }

  function shelvesChart(host, card, dl) {
    const prof = (dl.profile || []).filter((p) => num(p.px) !== null).sort((a, b) => b.px - a.px);
    const S = spotOf(card);
    return C.mount(host, (el, w, animate) => {
      const rowH = 13, top = 6, left = 58, right = 56;
      const H = top + prof.length * rowH + 10;
      const mx = Math.max(...prof.map((p) => (num(p.dark) || 0) + (num(p.lit) || 0)), 1);
      const x = C.lin(0, mx, left, w - right);
      const svg = C.svgRoot(el, w, H, animate, card.ticker + " dark-pool and lit volume by price, within two ATR of spot");
      const top3 = new Set((dl.shelves || []).map((s2) => s2.px));
      prof.forEach((p, i) => {
        const yy = top + i * rowH;
        const dk = num(p.dark) || 0, lt = num(p.lit) || 0;
        s("rect", { x: left, y: yy + 2, width: Math.max(1, x(dk) - left), height: rowH - 4, rx: 2, fill: cssVar(top3.has(p.px) ? "--s-purple" : "--label-3"), class: "growx", style: { "--i": String(i) } }, svg);
        if (lt > 0) s("rect", { x: x(dk) + 1, y: yy + 2, width: Math.max(1, x(dk + lt) - x(dk) - 1), height: rowH - 4, rx: 2, fill: cssVar("--fill-2"), class: "growx", style: { "--i": String(i) } }, svg);
        if (i % 2 === 0 || top3.has(p.px)) s("text", { x: left - 6, y: yy + rowH / 2 + 3.5, text: F.px(p.px), "text-anchor": "end", class: top3.has(p.px) ? "tx-1 tx-b" : null }, svg);
        if (top3.has(p.px)) s("text", { x: x(dk + lt) + 6, y: yy + rowH / 2 + 3.5, text: F.num(dk), class: "tx-1" }, svg);
      });
      if (S !== null && prof.length > 1 && S <= prof[0].px && S >= prof[prof.length - 1].px) {
        let j = 0;
        while (j < prof.length - 1 && prof[j + 1].px > S) j++;
        const f = (prof[j].px - S) / ((prof[j].px - (prof[j + 1] || prof[j]).px) || 1);
        const sy = top + (j + f) * rowH + rowH / 2;
        s("line", { x1: left - 2, x2: w - right, y1: sy, y2: sy, stroke: cssVar("--label-1"), "stroke-width": 1, "stroke-dasharray": "2 3" }, svg);
        s("text", { x: w - right + 6, y: sy + 4, text: "spot", class: "tx-3" }, svg);
      }
      C.scrub(el, svg, { xs: prof.map((_, i) => top + i * rowH + rowH / 2), top: 0, bottom: H, label: "Dark-pool shelves",
        onMove: (i) => ({ noLine: true, x: w / 2, top: 0, parts: [C.part(F.px(prof[i].px), "k"), C.part("dark", "k"), h("b", null, F.num(prof[i].dark)), C.part("lit " + F.num(prof[i].lit), "k"), C.part(F.pct(prof[i].share, 0) + " dark", "k")] }) });
    });
  }

  function buildTape(card) {
    const P = card.panels || {};
    const X = STATE.cardX || {};
    const tc = P.topContracts, oi = P.oiDeltas, dp = P.darkpool;
    const dl = X.dpLevels && X.dpLevels.status === "ok" ? X.dpLevels : null;
    const al = X.alerts && X.alerts.status === "ok" && Array.isArray(X.alerts.dots) && X.alerts.dots.length ? X.alerts : null;
    const list = (kind, label) => (host) => { host.classList.add("ft-tape"); host.append(tapeHead(kind), UI.list(tapeRows(kind, card), { visible: 8, label })); return {}; };
    const views = [
      { label: "Contracts", st: panelSt(card, "topContracts", "contract list"), name: "Top contracts", h: 200, draw: list("contracts", "Top contracts") },
      { label: "OI", st: panelSt(card, "oiDeltas", "open-interest list"), name: "Open-interest changes", h: 200, draw: list("oi", "Open-interest changes") },
      { label: "Alerts", st: al ? OK : xSt(X.alerts, "alert tape"), never: offIndex(card, X.alerts), name: "Flow alerts", h: 200, draw: list("alerts", "Flow alerts") },
      { label: "Prints", st: panelSt(card, "darkpool", "dark-pool prints"), name: "Dark-pool prints", h: 200, draw: list("prints", "Dark-pool prints") },
      { label: "Shelves", st: dl ? OK : xSt(X.dpLevels, "dark-pool price levels"), never: offIndex(card, X.dpLevels), name: "Dark-pool shelves", draw: (host) => ({ handle: shelvesChart(host, card, dl), legend: [keyOf("--s-purple", "", "Top shelves"), keyOf("--label-3", "", "Dark"), keyOf("--fill-2", "", "Lit")] }) },
    ];
    const vw = viewer("Tape view", views);
    const st = UI.partial(vw.views.map((v) => ({ name: v.label, st: v.st })));
    const basis = tc && tc.oiBasis ? tc.oiBasis : null;
    const basisLine = (() => {
      if (!basis) return null;
      const ex = num(basis.exceeded), seen = num(basis.seen);
      if (basis.verdict === "falsified" && ex !== null && ex > 0 && seen) return "On " + ex + " of " + seen + " lines that traded at least " + basis.minVolume + " contracts, volume exceeded open interest, so the vendor's open interest and today's volume are NOT describing the same span: the open interest is the prior clearing day's.";
      if (basis.verdict === "inconclusive" && ex === 0 && seen) return "INCONCLUSIVE: none of the " + seen + " heavy lines traded more than its open interest, which is not evidence that the two counts describe the same span.";
      if (basis.verdict === "no-data") return "Quiet — the basis of open interest against volume could not be checked: no line traded " + basis.minVolume + " contracts.";
      return "Unavailable — the basis check published a " + String(basis.verdict || "verdict") + " verdict without a count that supports it, so no reading is drawn from it.";
    })();
    mod({ id: "m-tape", title: "Tape", span: [12, 7], st, seg: vw.seg, views: vw.views, index: 9, body: [vw.box, vw.leg],
      info: () => ({
        title: "Tape", state: st.state === "ok" ? null : st.state,
        sections: [{ title: "Contracts", lines: [leadOf(tc) || reasonOf(views[0].st), tc && tc.relation, basisLine, "ΔOI counts the change in open interest the vendor reports against the prior clearing day; the spacing of the two counts is unstated, so it is whatever span the vendor clears on."] },
          { title: "Open interest", lines: [leadOf(oi) || reasonOf(views[1].st), oi && oi.note, oi && num(oi.shed) ? oi.rows.length + " kept of " + oi.seen + " lines." : null, "Streaks count the sessions open interest rose (↑OI) and volume beat open interest (V>OI), as the vendor counts them; a missing counter is a dash, never a zero."] },
          views[2].never ? null : { title: "Alerts", lines: [al ? "The session's " + al.n + " flow alerts on this name, largest premium first; the right column is the share of each alert's premium taken at the ask." : reasonOf(views[2].st)] },
          { title: "Prints", lines: [leadOf(dp) || reasonOf(views[3].st), dp && dp.note, dp && num(dp.shed) ? dp.rows.length + " kept of " + dp.seen + " prints" + (num(dp.unpriced) ? ", +" + dp.unpriced + " unpriced print" + (dp.unpriced === 1 ? "" : "s") : "") + "." : null, "Each print shows its time, price, distance from the close and the quote at execution; a print missing either side of the quote shows a dash, never half a spread."] },
          views[4].never ? null : { title: "Shelves", lines: [dl ? "Dark and lit volume by price within " + dl.bandAtr + " ATR of spot; " + F.pct(dl.darkShare, 0) + " of the in-band volume printed dark. The purple rows are the three largest dark shelves." : reasonOf(views[4].st)] }],
      }) });
    vw.start();
  }

  function qualityOf(card) {
    const q = card.quality;
    if (!q) {
      if ((num(card.v) === null ? 1 : card.v) < 2) return { facts: [], lines: ["This card was built before the volatility and quality readings became gauges, so those two are shown as unavailable rather than redrawn under a meaning they did not have."] };
      return { facts: [], lines: ["The two quality readings behind the quality gauge, the out-of-the-money share of directional flow and the vega tilt, are not published on this card; they are shown as unmeasured, never as the best value a missing reading would otherwise earn."] };
    }
    const otm = num(q.otmShare), tilt = num(q.vegaTilt);
    return {
      facts: [["OTM share of directional flow", otm === null ? DASH : Math.round(otm * 100) + "%"], ["Vega flow per unit delta", tilt === null ? DASH : tilt.toFixed(2).replace("-", MINUS)]],
      lines: [otm === null && tilt === null ? "Neither quality reading is measurable: there was no directional delta flow to divide by, which is no directional view, never infinite conviction, so both are withheld rather than floored at their best value." : null,
        otm !== null ? Math.round(otm * 100) + "% of the directional delta flow traded out of the money. A high share is lottery tickets: cheap, convex and often written with no view; a low one is near-money conviction that had to be paid for." : null,
        tilt !== null ? "Each unit of gross delta flow came with " + tilt.toFixed(2).replace("-", MINUS) + " of gross vega flow. A high tilt is flow trading VOLATILITY rather than direction, the cleanest reason on the card to suppress a directional read." : null,
        "Both enter the score only through the quality gauge, ranked against the board rather than against a fixed cut."],
    };
  }

  function buildSignal(card) {
    const score = num(card.score);
    if (score === null && num(card.conviction) === null && FAMS.every(([k]) => famOf(card, k) === null)) {
      if (isIndex(card)) return;
      const st = ST("unavailable", "No score, conviction or family reading was published on this card.");
      mod({ id: "m-signal", title: "Signal", span: [12, 4], index: 10, st, body: [UI.silent(st, "Signal", 200)], info: () => ({ title: "Signal", state: st.state, lead: st.reason }) });
      return;
    }
    const chg = changeFrom((card.panels || {}).scoreOverlay);
    const said = changeLines(chg);
    const math = convMath(card);
    const top = h("div", { class: "ft-sig" },
      C.gauge({ value: score, min: -100, max: 100, diverging: true, arc: 180, size: 132, stroke: 8, label: score === null ? "No score on this card" : "Score " + F.signed(score) + " of plus or minus 100" }),
      h("div", { class: "ft-sig-m" },
        metric("Conviction", num(card.conviction) === null ? DASH : String(card.conviction), { unit: num(card.conviction) === null ? null : "/100", state: num(card.conviction) === null ? ST("unavailable", "No conviction on this card.") : null }),
        chg.status === "ok" && chg.d1
          ? metric("Change", F.signed(chg.d1.v), { tone: tone(chg.d1.v), sub: SESSIONS(chg.d1.gap) + (chg.stale ? SEP + chg.stale + " old" : ""), id: "ftD1" })
          : metric("Change", DASH, { state: chg.status === "ok" ? ST("quiet", "Only one session in this window carries a score for this name, so there is no move to state — which is not a move of zero.") : ST(chg.status === "quiet" ? "quiet" : "unavailable", cap(chg.reason)), id: "ftD1" })));
    const ev = chg.status !== "ok" ? null : chg.cross ? { cleared: ["Cleared", "up"], faded: ["Faded", "down"], flipped: ["Flipped", chg.d1 && chg.d1.v < 0 ? "down" : "up"] }[chg.cross]
      : chg.crossKnown ? ["No crossing", null] : null;
    const evTag = h("div", { class: "ft-sig-ev", id: "ftCross", "data-cross": chg.status === "ok" ? chg.cross || (chg.crossKnown ? "none" : "unknown") : chg.status },
      ev ? tag(ev[0], { tone: ev[1] || undefined, glyph: ev[1] === "up" ? "up" : ev[1] === "down" ? "down" : null }) : UI.dash(ST(chg.status === "ok" ? (chg.band === null ? "unavailable" : "quiet") : chg.status === "quiet" ? "quiet" : "unavailable", said.lines[0] || said.lead), "Dead band"),
      chg.status === "ok" && chg.band !== null ? h("span", { class: "ft-sig-band" }, "band ±" + chg.band) : null);
    const box = h("div", { class: "ft-fams", role: "list" });
    FAMS.forEach(([k, lab, signed], i) => {
      const val = famOf(card, k);
      const row = h("div", { class: "ft-fam", role: "listitem", "data-fam": k }, h("span", { class: "ft-fam-l" }, lab));
      const tr = h("div", { class: "ft-fam-t" + (signed ? "" : " is-meter") });
      if (val !== null) {
        const pct = clamp(Math.abs(val), 0, 100) / 100;
        tr.append(signed ? h("span", { class: "ft-fam-f", style: { "--c": val < 0 ? "var(--down-mark)" : "var(--up-mark)", left: val < 0 ? 50 - pct * 50 + "%" : "50%", width: pct * 50 + "%", "transform-origin": val < 0 ? "right" : "left", "--i": String(i) } })
          : h("span", { class: "ft-fam-f", style: { "--c": "var(--label-2)", left: "0", width: pct * 100 + "%", "--i": String(i) } }));
      }
      row.append(tr, val === null ? h("span", { class: "ft-fam-v", "data-tone": "silent" }, UI.dash(legacyFam(card, k) ? ST("withheld", LEGACY_VO) : ST("quiet", "No " + lab.toLowerCase() + " reading entered this session's score."), lab))
        : h("span", { class: "ft-fam-v", "data-tone": signed ? tone(val) : null }, F.num(val, signed)));
      box.append(row);
    });
    mod({ id: "m-signal", title: "Signal", span: [12, 4], index: 10, st: score === null ? ST("unavailable", "No score was published on this card.") : null,
      body: [h("div", { class: "ft-sig-w" }, h("div", { class: "ft-sig-a" }, top, evTag), box)],
      info: () => ({ title: "Signal", lead: score === null ? null : "Score " + F.signed(score) + " with conviction " + card.conviction + ".",
        facts: famFacts(card).concat(convFacts(card)).concat(qualityOf(card).facts),
        sections: [{ title: "What changed", lines: [said.lead].concat(said.lines) }, { title: "Conviction", lines: [math] }, { title: "Quality", lines: qualityOf(card).lines }, { title: "Score history", lines: [leadOf((card.panels || {}).scoreOverlay)] }],
        notes: ["Flow, positioning and path are signed and drawn from the centre; volatility and quality are unsigned multipliers drawn from the left. A family with no reading shows its glyph, not a zero."] }) });
  }

  function feedSection(f, cov) {
    if (!f) return null;
    const title = cap(String(f.label || "market-wide list").replace(/^the /, ""));
    const cut = f.kind === "money" ? (f.orderedBy && /premium|dollar/.test(f.orderedBy) ? "The list is ranked by dollar size." : f.cutAt ? "The vendor answered newest first; the list reaches back to " + F.time(f.cutAt) + "." : null)
      : num(f.cut) !== null ? "The last place in the list held " + F.int(f.cut, true) + " " + f.unit + "." : null;
    const reach = cov ? "The join reached " + cov.in + " of " + cov.of + " names carrying a card." : null;
    if (f.status !== "ok") return { title, lines: [(f.status === "quiet" ? "Not in this list — " : "Unavailable — ") + cap(f.reason || "not read"), f.status === "quiet" ? cut : null, f.status === "quiet" ? reach : null] };
    const val = f.kind === "money" ? F.money(f.value) : F.int(f.value, true) + " " + (Math.abs(f.value) === 1 ? f.unitOne || f.unit : f.unit);
    return { title, lines: ["Ranks " + f.rank + " of " + f.population + " (" + val + ").", f.sameSession ? "Dated the same session this card describes." : "Dated " + f.asOf + " — NOT the session this card describes.", cut, reach] };
  }

  function buildContext(card) {
    const P = card.panels || {};
    const ctx = P.context && P.context.status === "ok" ? P.context : {};
    const Cn = candlesOf(card);
    const S = spotOf(card);
    const yr = Cn.slice(-252);
    const body = [];
    if (yr.length) {
      const lo = Math.min(...yr.map((r) => numOr(r.l, r.c))), hi = Math.max(...yr.map((r) => numOr(r.h, r.c)));
      const pos = num(ctx.week52Pos) !== null ? ctx.week52Pos : hi > lo && S !== null ? (S - lo) / (hi - lo) : null;
      body.push(h("div", { class: "ft-range" },
        h("div", { class: "ui-metric-l" }, "52-week range"),
        h("div", { class: "ft-range-t", role: "img", "aria-label": pos === null ? "No position in the 52-week range" : "At " + Math.round(pos * 100) + "% of its 52-week range" }, pos === null ? null : h("span", { class: "ft-range-d", style: { left: clamp(pos, 0, 1) * 100 + "%" } })),
        h("div", { class: "ft-range-e" }, h("span", null, F.px(lo)), h("b", null, F.pct(pos, 0)), h("span", null, F.px(hi)))));
    }
    body.push(h("div", { class: "ft-rets" }, [["1W", ctx.r5], ["1M", ctx.r21], ["2M", ctx.r42]].map(([l, v]) => h("div", { class: "ft-ret" }, h("span", null, l), num(v) === null ? UI.dash(ST("unavailable", "No return over this window on the card."), l) : h("b", { "data-tone": tone(v) }, F.pct(v, 1, true))))));
    const cg = P.congress;
    const cgSt = panelSt(card, "congress", "congress disclosures");
    const mr = P.marketRank;
    const mrSt = panelSt(card, "marketRank", "market-wide standing");
    const feeds = mr && mr.status === "ok" ? mr.feeds || {} : {};
    const rankTxt = (f, l) => (f && f.status === "ok" && num(f.rank) !== null ? l + " " + f.rank + "/" + f.population : null);
    const lists = [rankTxt(feeds.oiChange, "OI"), rankTxt(feeds.darkpool, "DP")].filter(Boolean);
    body.push(h("div", { class: "ft-rows" },
      isIndex(card) && !(cg && cg.status === "ok") ? null : h("div", { class: "ft-crow" }, glyph("hall"), h("span", { class: "ft-crow-l" }, "Congress"),
        cg && cg.status === "ok" ? [num(cg.buys) ? h("b", { "data-tone": "up" }, cg.buys + " buy" + (cg.buys === 1 ? "" : "s")) : null, num(cg.sells) ? h("b", { "data-tone": "down" }, cg.sells + " sell" + (cg.sells === 1 ? "" : "s")) : null] : UI.stateButton(cgSt, "Congress")),
      h("div", { class: "ft-crow" }, glyph("list"), h("span", { class: "ft-crow-l" }, "Market lists"),
        lists.length ? h("b", null, lists.join(SEP)) : UI.stateButton(mrSt.state === "ok" ? ST("quiet", feeds.oiChange && feeds.oiChange.reason ? cap(feeds.oiChange.reason) : "In no market-wide list this run.") : mrSt, "Market lists")),
      isIndex(card) && !card.sector ? null : h("div", { class: "ft-crow" }, glyph("stack"), h("span", { class: "ft-crow-l" }, "Sector"), h("b", null, card.sector || DASH))));
    const sec = mod({ id: "m-context", title: "Context", span: isIndex(card) ? [12, 5] : [6, 6], index: 11, st: panelSt(card, "context", "price context"), body,
      info: () => ({ title: "Context", asOf: ctx.asOf || null, lead: leadOf(P.context),
        facts: (cg && cg.status === "ok" ? (cg.trades || []).map((t) => [t.member + SEP + day(t.txnDate), t.side + " " + (t.amountRange || "") + (t.chamber ? " (" + t.chamber + ")" : "")]) : []),
        sections: [{ title: "Congress", lines: [leadOf(cg) || reasonOf(cgSt), cg && num(cg.medianLagDays) !== null ? "Median disclosure lag " + cg.medianLagDays + " days." : null] },
          { title: "Market lists", lines: [leadOf(mr) || reasonOf(mrSt)].concat(mr && mr.notes ? Object.values(mr.notes).filter((x) => typeof x === "string") : []) },
          feedSection(feeds.oiChange, mr && mr.coverage && mr.coverage.oiChange), feedSection(feeds.darkpool, mr && mr.coverage && mr.coverage.darkpool),
          { title: "Window", lines: [num(ctx.dropped) === null || num(ctx.sessions) === null ? null : ctx.dropped === 0 ? "The price window is " + ctx.sessions + " consecutive closes, none dropped." : ctx.dropped + " session(s) dropped from the price window of " + ctx.sessions + "; points are joined in ORDER, not on a time axis."].concat(breaksOf(ctx)) }] }) });
    sec.classList.toggle("ft-snug", isIndex(card));
  }

  function renderModules(card) {
    gridEl.hidden = false;
    for (const node of [...gridEl.children]) node.remove();
    const builders = [buildWorlds, buildSignal, buildGamma, buildHedging, buildVol, buildFlow, buildTape, buildEvents, buildPositioning, buildContext];
    for (const b of builders) {
      try { b(card); } catch (e) { console.error("flows-ticker: " + b.name + " failed", e); }
    }
  }

  function paintAll() {
    const card = STATE.card;
    renderHero(card);
    renderVerdict(card, STATE.neuron);
    renderModules(card);
    paintFreshness(card);
    STATE.first = false;
  }

  const PANEL_MOD = {
    gamma: "m-gamma", surface: "m-gamma", levels: "m-gamma", calendar: "m-gamma", displacement: "m-gamma", variation: "m-hedge", vanna: "m-hedge", charm: "m-hedge", deltaExposure: "m-hedge",
    ivSurface: "m-vol", skewTerm: "m-vol", volContext: "m-vol", pricedMove: "m-vol", aggressor: "m-flow", path: "m-flow", premiumTrack: "m-flow",
    topContracts: "m-tape", oiDeltas: "m-tape", darkpool: "m-tape", congress: "m-context", marketRank: "m-context", context: "m-context", __score: "m-signal", __sessions: "m-signal", __stats: "ftHero",
    convexity: "m-gamma", volatility: "m-vol", tape: "m-flow", signal: "m-signal",
  };

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (r.status === 401) { location.replace("/flows/"); return null; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  const soft = (p) => p.then((v) => v, () => null);

  function readTicker() {
    let raw = null;
    try { raw = new URL(location.href).searchParams.get("t"); } catch { raw = null; }
    const t = String(raw || "").trim().toUpperCase();
    return TICKER_RE.test(t) ? t : null;
  }

  function boardRows(long, short) {
    const out = [];
    for (const [payload, side] of [[long, "long"], [short, "short"]]) {
      const rows = ((payload && payload.rows) || []).filter((r) => r && r.t);
      const knowsDeep = num(payload && payload.deep) !== null;
      for (const row of rows) out.push({ t: row.t, r: row.r, s: row.s, side, sector: str(row.sector), card: knowsDeep ? row.dp === 1 : null, of: rows.length });
    }
    return out;
  }
  const carded = (rows) => rows.filter((r) => r.card !== false);
  function pickerNote(all, shown, tail) {
    if (all.some((r) => r.card === null)) return "All " + NAMES(all.length) + " on today’s board. This board does not publish which of its rows the run went deep enough on to build a card for, so a name here may still open a page with no card. " + tail;
    if (all.length > shown.length) return "Today’s board ranks " + NAMES(all.length) + " and this run built a card for " + shown.length + " of them, which are the rows below. A card costs vendor calls the run cannot spend on every name, so the rest are ranked without one and are not listed: such a page would have nothing on it. " + tail;
    return "All " + NAMES(all.length) + " on today’s board, every one of which carries a card. " + tail;
  }

  function showPicker(rows, note, titled) {
    pickerEl.hidden = false;
    const list = rows.map((r, i) => UI.listRow({ href: "/flows/ticker/?t=" + encodeURIComponent(r.t), badge: r.side === "short" ? "S" : "L", badgeTone: r.side === "short" ? "down" : "up",
      badgeLabel: r.side === "short" ? "Bearish" : "Bullish", primary: r.t, secondary: [r.sector, num(r.r) === null ? null : "#" + r.r].filter(Boolean).join(SEP),
      signed: num(r.s) === null ? DASH : F.signed(r.s), signedValue: r.s, index: i, cols: "24px minmax(0,1fr) 56px" }));
    pickerEl.replaceChildren(
      h("header", { class: "ft-picker-h" }, titled ? h("h1", { class: "ui-title", id: "ftPickerT" }, "Choose a name") : h("h2", { class: "ft-picker-t", id: "ftPickerT" }, "Open instead"),
        h("span", { class: "ft-sp" }), info("these names", () => ({ title: "Names", lead: note }))),
      h("p", { class: "visually-hidden", id: "ftPickerNote" }, note),
      UI.list(list, { visible: 12, label: "Names with a card" }));
  }

  function silentHero(t, st, sub) {
    heroEl.hidden = false;
    heroEl.classList.remove("is-loading");
    heroEl.classList.add("is-silent");
    $("ftHeroT").textContent = t;
    $("ftHeroSub").textContent = sub || "";
    $("ftHeroFlags").replaceChildren();
    $("ftPx").replaceChildren(UI.silent(st, t, 180));
    $("ftChips").replaceChildren();
    $("ftHc").replaceChildren();
    $("ftLast").hidden = true;
  }

  function sayWhyAbsent(ticker, events, boardsRead) {
    const lead = boardsRead === false ? "Neither board could be read just now, so this page cannot say whether " + ticker + " is on today's board. What follows is the funnel's own account of it. " : ticker + " is not on today's board, so no card was built for it. ";
    const rows = events && Array.isArray(events.rows) ? events.rows : null;
    const row = rows ? rows.find((r) => r && String(r.t).toUpperCase() === ticker) : null;
    let tail;
    if (row && String(row.st || "").startsWith("board:")) {
      tail = "The funnel places it on today’s " + (row.st === "board:short" ? "bearish" : "bullish") + " board, which the board payload this page just read does not agree with — either that read failed or the two payloads are from different runs. Reload before concluding anything about this name.";
    } else if (!rows) {
      tail = "The earnings calendar could not be read just now, so this page cannot say which stage of the funnel it stopped at. It is not on the watch list either: that list holds only names that were scored and landed inside the dead band.";
    } else if (row && row.st === "gated") {
      const dte = num(row.dte);
      tail = "It reports on " + (row.d ? String(row.d) : "a date the calendar did not publish") + (dte === null ? ", with no calendar-day count published beside it, " : ", " + dte + " calendar " + (dte === 1 ? "day" : "days") + " from " + (events.gateOrigin || "the run's own Eastern date") + ", ") +
        "and the earnings gate removed it BEFORE the composite ran" + (num(events.gateDays) === null ? ". " : " — the gate covers day 0 to day " + events.gateDays + ". ") +
        "So there is no score under this name at all today, not a low one. It is not on the watch list either: that list holds only names that were scored and landed inside the dead band.";
    } else if (row) {
      tail = "The funnel stopped it at “" + String(row.st || "an unclassified stage") + "”: it cleared the earnings gate and did not reach the board. Cards are built only for board names, so there is nothing to draw for it today.";
    } else {
      const win = num(events.windowDays);
      tail = "The earnings calendar carries no row for this name, so this page cannot say which stage of the funnel it stopped at. That calendar holds only names reporting within " + (win === null ? "its own window" : win + " calendar " + (win === 1 ? "day" : "days")) + " of " + (events.gateOrigin || "the run’s own Eastern date") +
        (events.capBound === true ? ", and it was capped before it ran out of window, so it does not reach every name even inside it" : "") + " — so its silence here is a missing row, not evidence about this name.";
    }
    return lead + tail;
  }

  function sayStatus(text, link) {
    statusEl.replaceChildren(document.createTextNode(text));
    if (link) statusEl.append(h("a", { href: link[0] }, link[1]));
  }

  async function pendingCard(ticker) {
    const [long, short, events] = await Promise.all([soft(getJSON("/api/flows/board?side=long")), soft(getJSON("/api/flows/board?side=short")), soft(getJSON("/api/flows/events"))]);
    const all = boardRows(long, short);
    const rows = carded(all);
    const me = all.find((r) => r.t === ticker);
    let text, state = "unavailable", link = null;
    if (me && me.card === false) {
      text = "The board ranks " + ticker + " " + (num(me.r) === null || num(me.of) === null ? "on its " + (me.side === "short" ? "bearish" : "bullish") + " side" : me.r + " of " + me.of + " on the " + (me.side === "short" ? "bearish" : "bullish") + " side") +
        ", and this run built no card for it. A card costs vendor calls the run spends only on the names furthest from neutral, so most of the board is scored and ranked without one. This is not a lag, and reloading will not produce a card.";
    } else if (me) {
      text = "The board published " + ticker + " but its card has not landed yet. Cards are published after the boards, so one can briefly lag its row.";
      state = "pending";
    } else {
      text = sayWhyAbsent(ticker, events, long !== null || short !== null);
      link = ["/flows/events/", " The earnings calendar and the whole funnel."];
    }
    silentHero(ticker, ST(state, text), me ? (me.side === "short" ? "Bearish board" : "Bullish board") : "");
    sayStatus(text, link);
    if (rows.length && !(me && me.card !== false)) showPicker(rows.filter((r) => r.t !== ticker), pickerNote(all, rows, "These are the ones you can open today."), false);
  }

  async function noTicker() {
    heroEl.hidden = true;
    sayStatus("Choose a name.");
    const [long, short] = await Promise.all([soft(getJSON("/api/flows/board?side=long")), soft(getJSON("/api/flows/board?side=short"))]);
    const all = boardRows(long, short);
    const rows = carded(all);
    if (!rows.length) {
      const text = all.length ? "Today’s board ranks " + NAMES(all.length) + ", and this run built a card for none of them, so there is nothing to open here. The board itself is published." : "No board has been published yet, so there is no name to choose.";
      sayStatus(text);
      pickerEl.hidden = false;
      pickerEl.replaceChildren(h("header", { class: "ft-picker-h" }, h("h1", { class: "ui-title", id: "ftPickerT" }, "Choose a name")), UI.silent(ST(all.length ? "quiet" : "pending", text), "Names", 200));
      return;
    }
    showPicker(rows, pickerNote(all, rows, "Each one opens its own dossier."), true);
    sayStatus("");
  }

  async function fetchTape(t) {
    const tape = await soft(getJSON("/api/flows/tape?t=" + encodeURIComponent(t)));
    if (!tape || tape.status === "pending") return false;
    const before = STATE.tape && STATE.tape.prem ? STATE.tape.prem.readAt : null;
    STATE.tape = tape;
    return !tape.prem || tape.prem.readAt !== before;
  }

  function awaitNeuron(t, card, i = 0) {
    const settle = (s) => renderVerdict(card, { ...STATE.neuron, status: s || "unavailable" });
    if (STATE.card !== card) return;
    if (i > 6) return settle();
    setTimeout(() => soft(getJSON("/api/flows/summary?t=" + encodeURIComponent(t))).then((nr) => {
      if (STATE.card !== card) return;
      const s = nr && nr.status;
      if (s === "ok") { STATE.neuron = nr; renderVerdict(card, nr); buildWorlds(card); }
      else if (s !== "pending") settle(typeof s === "string" && s);
      else { const had = (STATE.neuron.context || {}).state; if (nr.context) STATE.neuron = nr; if (!had && (nr.context || {}).state) renderVerdict(card, nr); awaitNeuron(t, card, i + 1); }
    }), 5000 + i * 3500);
  }

  function jumpToHash() {
    const m = /^#(?:panel-|ftg-|m-)?([A-Za-z_]\w*)$/.exec(String(location.hash || ""));
    if (!m) return;
    const id = PANEL_MOD[m[1]] || (document.getElementById("m-" + m[1]) ? "m-" + m[1] : null);
    const target = id && document.getElementById(id);
    if (!target) return;
    target.setAttribute("tabindex", "-1");
    requestAnimationFrame(() => { target.scrollIntoView({ block: "start", behavior: "instant" }); try { target.focus({ preventScroll: true }); } catch { target.focus(); } });
  }

  function startLive(t) {
    if (typeof UI.heartbeat !== "function") return;
    STATE.hb = UI.heartbeat({
      ticker: t, page: "ticker", nightly: ["card:" + t],
      onBeat: ({ body }) => {
        STATE.phase = body && body.phase ? body.phase.phase : null;
        STATE.beats++;
        if (STATE.phase === "rth" && STATE.beats % 6 === 0) fetchTape(t).then((moved) => { if (moved && STATE.card) buildFlow(STATE.card); });
      },
      onQuote: (q) => {
        if (!STATE.card) return;
        const was = !!liveQuote();
        STATE.quote = q && typeof q === "object" ? q : null;
        paintPrice(STATE.card, false);
        paintFreshness(STATE.card);
        if (was !== !!liveQuote()) renderHeroChart(STATE.card, STATE.card.panels.pricedMove && STATE.card.panels.pricedMove.status === "ok" ? STATE.card.panels.pricedMove : {});
      },
      onChange: (changed) => {
        if (!changed.includes("card:" + t)) return;
        Promise.all([soft(getJSON("/api/flows/card?t=" + encodeURIComponent(t))), soft(getJSON("/api/flows/summary?t=" + encodeURIComponent(t))), soft(getJSON("/api/flows/card-x?t=" + encodeURIComponent(t))), soft(getJSON("/api/flows/hist?t=" + encodeURIComponent(t)))])
          .then(([card, neuron, cx, hist]) => {
            if (!card || card.status === "pending" || !card.panels) return;
            STATE.card = card; STATE.neuron = neuron || STATE.neuron; STATE.cardX = cx || STATE.cardX; STATE.hist = hist || STATE.hist;
            paintAll();
            if (STATE.neuron && STATE.neuron.status === "pending") awaitNeuron(t, card);
          });
      },
    });
  }

  async function start() {
    const ticker = readTicker();
    STATE.ticker = ticker;
    if (!ticker) { await noTicker(); return; }
    heroEl.classList.add("is-loading");
    $("ftHeroT").textContent = ticker;
    const q = (p) => p + "?t=" + encodeURIComponent(ticker);
    const neuronP = soft(getJSON(q("/api/flows/summary")));
    const cxP = soft(getJSON(q("/api/flows/card-x")));
    const histP = soft(getJSON(q("/api/flows/hist")));
    const tapeP = fetchTape(ticker);
    let card;
    try { card = await getJSON(q("/api/flows/card")); } catch {
      const text = "This page could not be loaded. Reload to try again.";
      silentHero(ticker, ST("unavailable", text));
      sayStatus(text);
      return;
    }
    if (!card) return;
    if (card.status === "pending" || !card.panels) { await pendingCard(ticker); return; }
    const [neuron, cx, hist] = await Promise.all([neuronP, cxP, histP]);
    STATE.card = card;
    STATE.neuron = neuron || { status: "unavailable" };
    STATE.cardX = cx || { status: "pending" };
    STATE.hist = hist || { status: "pending" };
    document.title = card.ticker + " · Flows";
    paintAll();
    sayStatus("");
    jumpToHash();
    tapeP.then((moved) => { if (moved && STATE.card === card) buildFlow(card); });
    if (STATE.neuron.status === "pending") awaitNeuron(ticker, card);
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    idle(() => soft(getJSON("/api/flows/meta")).then((m) => {
      if (!m || !isoOk(m.sessionDate) || STATE.card !== card) return;
      STATE.meta = m;
      renderFlags(card);
    }), { timeout: 3000 });
    startLive(ticker);
  }

  window.addEventListener("hashchange", jumpToHash);
  start();
})();
