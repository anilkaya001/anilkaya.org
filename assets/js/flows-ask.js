(() => {
  "use strict";

  const UI = window.FlowsUI;
  const app = document.getElementById("askApp");
  if (!app || !UI) return;

  const { h, F } = UI;
  const DASH = UI.DASH, MID = UI.MID;
  const DOCKED = app.getAttribute("data-mode") === "dock";

  const isNum = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string" || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const text = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const figure = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const plural = (n, one, many) => (n === 1 ? one : many);
  const infoAttrs = (build) => ({ "data-info": UI.info(build), "aria-haspopup": "dialog", "aria-controls": "fxPop" });

  function stampSaid(at) {
    if (typeof at !== "string" || at.trim() === "") return null;
    const ms = Date.parse(at);
    if (!isFinite(ms)) return at;
    const iso = new Date(ms).toISOString();
    return iso.slice(0, 10) + " " + iso.slice(11, 16) + " UTC";
  }

  const status = document.getElementById("askStatus") || app.appendChild(h("p", { class: "visually-hidden", id: "askStatus", role: "status" }));

  const KEY_LABEL = {
    score: "Score", convictionOf100: "Conviction", conviction: "Conviction", netPremiumUsd: "Net premium",
    impliedMoveFraction: "Priced move", realizedMoveFraction: "Realized move", ivRank1yPct: "IV rank",
    spotPx: "Spot", gammaFlipPx: "Flip", callWallPx: "Call wall", putWallPx: "Put wall", persistenceRatio: "Persistence",
    boardRank: "Board rank", entered: "New to a side", incumbents: "Incumbents", count: "Names", flagged: "Flagged windows",
    pcrVolumeRatio: "Put/call volume", pcrPremiumRatio: "Put/call premium", iv30dMedianRatio: "IV30 median",
    ivRankMedianRatio: "IV rank median", topShareRatio: "Top-five share", callLiftRatio: "Call lift", putLiftRatio: "Put lift",
    apiCalls: "Vendor calls", retainedSessions: "Sessions", windowSessions: "Sessions", keptNames: "Names",
  };
  const SKIP = new Set(["robustness", "convictionScale", "boardRows", "gateDays", "rowCap", "perNameCap", "requestedRows", "sessions", "minutesRead", "strikes", "crossings"]);

  function human(key) {
    if (KEY_LABEL[key]) return KEY_LABEL[key];
    const base = key.replace(/(Usd|Px|Ratio|Fraction|Pct|Of100)$/, "");
    const words = base.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/(\d+)([a-z])/g, " $1$2").toLowerCase().trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  function fmtKey(key, v) {
    if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? F.day(v) : v;
    if (typeof v !== "number" || !Number.isFinite(v)) return DASH;
    if (/Usd$/.test(key)) return F.money(v, /^net|Net/.test(key));
    if (/Px$/.test(key)) return F.px(v);
    if (/Fraction$/.test(key)) return (/[Mm]ove/.test(key) ? "±" : "") + F.pct(v, 1);
    if (/Pct$/.test(key)) return Math.round(v) + (/[Rr]ank/.test(key) ? "" : "%");
    if (/Ratio$/.test(key)) return /Share|Lift|Median|persistence/i.test(key) ? F.pct(v, 0) : v.toFixed(2);
    if (key === "score" || key === "places") return F.signed(v);
    return Number.isInteger(v) ? F.int(v) : String(+v.toFixed(3));
  }
  const numericKeys = (n) => Object.keys(n).filter((k) => typeof n[k] === "number" && Number.isFinite(n[k]) && !SKIP.has(k));

  function tickerOf(fact) {
    const n = fact && fact.n && typeof fact.n === "object" ? fact.n : {};
    if (typeof n.ticker === "string" && n.ticker) return n.ticker;
    const src = fact && typeof fact.source === "string" ? fact.source : "";
    return src.indexOf("card:") === 0 ? src.slice(5) : null;
  }
  const tail = (id) => String(id || "").replace(/^[^/]*\//, "");

  const NEURON_LABEL = { standing: "Score", variation: "Hedging flow", levels: "Levels", displacement: "Displacement", pricedMove: "Priced move", path: "Premium path", context: "21d return", garch: "GARCH vol", state: "Implied state", congress: "Congress", calendar: "Gamma decay" };

  function figureOf(fact) {
    const n = fact && fact.n && typeof fact.n === "object" ? fact.n : {};
    const id = String(fact && fact.id || "");
    const t = tail(id);
    const tk = tickerOf(fact);
    const out = { ticker: tk, value: null, label: null, sub: null, tone: null, tags: null };
    const spec = fact && fact.lead && Array.isArray(fact.lead.keys) && fact.lead.keys.length ? fact.lead : null;
    const b = /^brief:[a-z]+\//.test(id) ? t : id.indexOf("/") === -1 ? id : null;
    if (b === "top:bullish" || b === "top:bearish") {
      const bull = b === "top:bullish";
      return { ...out, value: isNum(n.score) === null ? DASH : F.signed(n.score), tone: isNum(n.score) === null ? null : UI.tone(n.score), label: bull ? "Leads bullish" : "Leads bearish", sub: isNum(n.conviction) === null ? null : "conviction " + n.conviction };
    }
    if (b === "tilt" && isNum(n.bullish) !== null && isNum(n.bearish) !== null) {
      return { ...out, value: n.bullish + " / " + n.bearish, label: "Bullish / bearish", sub: isNum(n.scored) === null ? null : "of " + n.scored + " scored", split: [n.bullish, n.bearish, isNum(n.neutral) || 0] };
    }
    if (b === "moves") return { ...out, value: (isNum(n.climbed) ?? DASH) + " / " + (isNum(n.fell) ?? DASH), label: "Climbed / fell", sub: isNum(n.comparable) === null ? null : "of " + n.comparable };
    if ((b === "climbed" || b === "fell") && isNum(n.places) !== null) {
      const up = b === "climbed";
      return { ...out, value: (up ? "+" : UI.MINUS) + n.places, tone: up ? "up" : "down", label: up ? "Top climber" : "Top faller", sub: isNum(n.from) !== null && isNum(n.to) !== null ? "rank " + n.from + " → " + n.to : null };
    }
    if (b === "sectors") return { ...out, value: (text(n.mostBullish) || DASH) + " / " + (text(n.mostBearish) || DASH), label: "Sector lean", sub: isNum(n.readable) === null ? null : n.readable + " of " + (n.returned ?? DASH) + " baskets" };
    if (b === "nearly-in") return { ...out, ticker: text(n.nearest), value: isNum(n.inBand) === null ? DASH : String(n.inBand), label: "In the band", sub: text(n.nearest) ? "nearest " + n.nearest : null };
    if (b === "flip") return { ...out, value: isNum(n.distance) === null ? DASH : F.pct(n.distance, 2), label: "To gamma flip" };
    if (b === "reporting") return { ...out, value: isNum(n.count) === null ? DASH : String(n.count), label: "Report next", tags: Array.isArray(n.tickers) ? n.tickers.filter((x) => typeof x === "string") : null };
    if (b === "gate") return { ...out, value: isNum(n.count) === null ? DASH : String(n.count), label: "Earnings gate", sub: isNum(n.gateDays) === null ? null : n.gateDays + "-day gate" };
    if (/^neuron:/.test(id)) {
      const m = (text(fact.say) || "").match(/ — (.+?) \(robustness/);
      const nf = { ...out, label: NEURON_LABEL[t] || (m ? m[1].split(" — ")[0] : human(t)), robustness: isNum(n.robustness) };
      const sgn = (v, d) => (isNum(v) === null ? DASH : F.signed(v, d));
      const cases = {
        standing: () => ({ value: sgn(n.score), tone: UI.tone(n.score), sub: isNum(n.conviction) === null ? null : "conviction " + n.conviction }),
        variation: () => ({ value: F.money(n.charmPerSession, true), tone: UI.tone(n.charmPerSession), sub: "charm each session" }),
        levels: () => ({ value: text(n.gammaFlip) || DASH, sub: "flip · call " + (text(n.callWall) || DASH) + " · put " + (text(n.putWall) || DASH) }),
        displacement: () => ({ value: isNum(n.gapAtr) === null ? DASH : sgn(n.gapAtr, 2) + " ATR", sub: isNum(n.volCentroid) === null ? null : "flow at " + F.px(n.volCentroid) }),
        pricedMove: () => ({ value: isNum(n.impliedMove) === null ? DASH : "±" + F.pct(n.impliedMove, 1), sub: isNum(n.impliedLow) === null ? null : F.px(n.impliedLow) + " – " + F.px(n.impliedHigh) }),
        path: () => ({ value: F.money(n.netPremium, true), tone: UI.tone(n.netPremium), sub: isNum(n.persistence) === null ? null : "persistence " + F.pct(n.persistence, 0) }),
        context: () => ({ value: F.pct(n.r21, 1, true), tone: UI.tone(n.r21), sub: isNum(n.week52Pos) === null ? "21 sessions" : "21d · 52w at " + F.pct(n.week52Pos, 0) }),
        garch: () => ({ value: isNum(n.lastVol) === null ? DASH : n.lastVol.toFixed(1) + "%", sub: isNum(n.nextVol) === null ? null : "next " + n.nextVol.toFixed(1) + "%" }),
        state: () => ({ value: text(n.state) ? UI.cap(n.state).replace(/\.$/, "") : DASH, sub: text(n.direction) }),
        congress: () => ({ value: isNum(n.total) === null ? DASH : String(n.total), sub: isNum(n.buys) === null ? null : n.buys + " buys · " + n.sells + " sells" }),
        calendar: () => ({ value: isNum(n.halfLifeDays) === null ? DASH : n.halfLifeDays + "d", sub: "half-life" }),
      };
      if (cases[t]) return { ...nf, ...cases[t]() };
      const keys = numericKeys(n).filter((k) => k !== "robustness");
      return keys.length ? { ...nf, value: fmtKey(keys[0], n[keys[0]]), sub: keys[1] ? human(keys[1]) + " " + fmtKey(keys[1], n[keys[1]]) : null } : { ...nf, value: DASH };
    }
    if (/^movers\/extremes$/.test(id)) return { ...out, ticker: null, value: (text(n.riser) || DASH) + " / " + (text(n.faller) || DASH), label: "Top riser / faller", sub: isNum(n.riserChangeRatio) === null ? null : F.pct(n.riserChangeRatio, 1, true) + " / " + F.pct(n.fallerChangeRatio, 1, true) };
    if (/^movers\/premium$/.test(id)) return { ...out, value: (text(n.bullishName) || DASH) + " / " + (text(n.bearishName) || DASH), label: "Premium leaders", sub: isNum(n.bullishNetPremiumUsd) === null ? null : F.money(n.bullishNetPremiumUsd, true) + " / " + F.money(n.bearishNetPremiumUsd, true) };
    if (spec) {
      const vals = spec.keys.map((k) => isNum(n[k]));
      const den = spec.den && spec.den.key ? isNum(n[spec.den.key]) : null;
      return { ...out, value: vals.map((v) => (v === null ? DASH : String(v))).join(" / "), label: spec.label ? spec.label.charAt(0).toUpperCase() + spec.label.slice(1) : human(spec.keys[0]), sub: spec.den && spec.den.key ? (den === null ? "of an unpublished total" : "of " + den + (spec.den.word ? " " + spec.den.word : "")) : null };
    }
    const keys = numericKeys(n);
    if (!keys.length) return { ...out, value: tk || DASH, label: t ? human(t.replace(/[:\-]/g, " ")) : "Reading" };
    const k0 = keys[0], k1 = keys[1];
    return { ...out, value: fmtKey(k0, n[k0]), label: human(k0), tone: k0 === "score" || /^net/.test(k0) ? UI.tone(n[k0]) : null, sub: k1 ? human(k1) + " " + fmtKey(k1, n[k1]) : null };
  }

  function factInfo(fact, fallbackSource, fallbackAt) {
    const n = fact && fact.n && typeof fact.n === "object" ? fact.n : null;
    const say = text(fact && fact.say);
    const key = fact && text(fact.source) ? fact.source : fallbackSource;
    const at = fact && text(fact.at) ? fact.at : fallbackAt;
    const built = stampSaid(at);
    return () => ({
      title: figureOf(fact).label || "Reading",
      lead: say === null ? "A reading was published for this region without the sentence that states it, so this page has nothing to show for it. That is a gap in the payload rather than a fact about the session." : say,
      facts: [["Source", typeof key === "string" && key ? key : "no source key on this fact"], ["Built", built === null ? "no build stamp published on this key" : built]],
      notes: n && Object.keys(n).length ? ["Fields as published: " + Object.keys(n).map((k) => k + "=" + (Array.isArray(n[k]) ? n[k].join("/") : String(n[k]))).join(", ") + "."] : [],
    });
  }

  function factChip(fact, fallbackSource, fallbackAt, i) {
    const f = figureOf(fact);
    const unread = text(fact && fact.say) === null;
    return h("button", {
      type: "button", class: "ak-fact" + (unread ? " is-unread" : ""), "data-fact": fact && fact.id ? String(fact.id) : null,
      "data-empty": unread ? "unreadable" : null, style: { "--i": String(i || 0) }, ...infoAttrs(factInfo(fact, fallbackSource, fallbackAt)),
      "aria-label": (f.ticker ? f.ticker + " " : "") + (f.label || "") + " " + (f.value || ""),
    },
    f.ticker || isNum(f.robustness) !== null ? h("span", { class: "ak-fact-t" }, f.ticker || "", isNum(f.robustness) !== null ? UI.robustness(f.robustness) : null) : null,
    h("span", { class: "ak-fact-v", "data-tone": f.tone }, unread ? UI.dash({ state: "withheld", reason: "A reading was published without the sentence that states it." }, "Reading") : f.value),
    h("span", { class: "ak-fact-l" }, f.label || DASH),
    f.sub ? h("span", { class: "ak-fact-s" }, f.sub) : null);
  }

  const SILENCE_ORDER = ["pending", "unreadable", "quiet"];
  const SILENCE_STATE = { pending: "pending", unreadable: "withheld", quiet: "quiet", unavailable: "unavailable" };
  function silenceList(value) {
    const out = [];
    if (Array.isArray(value)) { for (const v of value) if (v && typeof v === "object") out.push(v); return out; }
    if (!value || typeof value !== "object") return out;
    for (const kind of SILENCE_ORDER) {
      const bucket = value[kind];
      if (!Array.isArray(bucket)) continue;
      for (const q of bucket) if (q && typeof q === "object") out.push({ kind, what: q.what, say: q.say, source: q.source, reason: q.reason });
    }
    return out;
  }
  function silenceSaid(q) {
    const said = text(q.say);
    return (said === null
      ? "A silence was published for " + (q.what || "this surface") + " without the sentence that explains it, so this page cannot say which of the three it is. That is a gap in the payload rather than a fact about the session."
      : said) + (text(q.reason) ? " (" + q.reason + ")" : "") + (text(q.source) ? " Source key: " + q.source + "." : "");
  }
  function silenceTags(list) {
    const known = (k) => SILENCE_ORDER.indexOf(k) !== -1;
    const ordered = SILENCE_ORDER.flatMap((k) => list.filter((q) => q.kind === k)).concat(list.filter((q) => !known(q.kind)));
    if (!ordered.length) return null;
    return h("div", { class: "ak-silences" }, ordered.map((q) => {
      const kind = known(q.kind) ? q.kind : "unavailable";
      const st = SILENCE_STATE[kind];
      return h("button", { type: "button", class: "ui-tag ak-silence", "data-empty": kind, ...infoAttrs({ title: UI.cap(String(q.what || "Silence")).replace(/\.$/, ""), state: st, lead: silenceSaid(q) }) },
        UI.glyph(UI.STATES[st].g), String(q.what || UI.STATES[st].word));
    }));
  }

  const R_SPENT = "The free daily allowance for the model is spent, and it resets at 00:00 UTC.";
  const R_BUSY = "The model had no capacity for this question just now, and nothing of today's allowance went on it.";
  const R_PLAN = "The model this site asks for is not available on the plan it runs on, which is a configuration fault here rather than a limit anyone hit.";
  const LLM_REASONS = {
    allowance: R_SPENT, "3036": R_SPENT, capacity: R_BUSY, "3040": R_BUSY, plan: R_PLAN, "5035": R_PLAN,
    unreachable: "The model was unreachable for this question.",
    off: "The model is switched off for this route, so every answer here is assembled from the published facts.",
  };

  function llmBlock(payload) {
    const v = payload.llm;
    const obj = v && typeof v === "object" ? v : null;
    let used = null;
    if (v === true || v === false) used = v;
    else if (obj && typeof obj.used === "boolean") used = obj.used;
    else if (obj && typeof obj.llm === "boolean") used = obj.llm;
    const published = obj && text(obj.reason) ? obj.reason : text(payload.llmReason) ? payload.llmReason : text(payload.note) ? payload.note : null;
    const code = obj && obj.code !== undefined && obj.code !== null ? String(obj.code)
      : payload.llmCode !== undefined && payload.llmCode !== null ? String(payload.llmCode) : text(payload.llmFailure);
    let calls = isNum(obj ? obj.calls : null);
    if (calls === null) calls = isNum(payload.llmCalls);
    const model = obj && text(obj.model) ? obj.model : text(payload.model);
    return { used, published, code, calls, model };
  }
  function guardFired(guard) {
    if (!guard || typeof guard !== "object") return false;
    if (typeof guard.ok === "boolean") return !guard.ok;
    if (typeof guard.rejected === "boolean") return guard.rejected;
    if (Array.isArray(guard.rejected)) return guard.rejected.length > 0;
    return false;
  }
  const guardTokens = (guard) => (guard && Array.isArray(guard.rejected) ? guard.rejected.filter((t) => typeof t === "string" && t) : []);

  function provenance(block, fired, guard) {
    if (fired) return { word: "Model refused", tone: "warn", said: "The wording above was assembled here from the published facts, in a fixed order. A model was asked this question and what it wrote was refused before it reached this page. Every figure in it is quoted from a payload." };
    if (block.used === true) {
      const scanned = guard && Array.isArray(guard.numerals) ? guard.numerals.length : null;
      return {
        word: "Model wording", checked: scanned !== null && scanned > 0,
        said: "The wording above came back from a language model, which was given the measured facts and asked to restate them. " + (scanned === null
          ? "This page was not told whether the figures in it were checked against those facts, so it makes no claim that they were."
          : scanned === 0 ? "It states no figure, so there was none for the guard to check: what you are reading is the model's prose over the facts listed below it."
            : "Every figure it wrote was checked against those same facts before this page drew it."),
      };
    }
    if (block.used === null) return { word: "Wording unstated", said: "The route did not state whether a model wrote this wording, so this page makes no claim either way. The facts below are the ones the answer was built from, whoever phrased it." };
    const why = block.published !== null ? block.published : block.code !== null && LLM_REASONS[block.code] ? LLM_REASONS[block.code] : null;
    return { word: "Pipeline wording", said: "No model wrote this wording. " + (why === null ? "The route did not state why, which is a third answer and not the same as the allowance being spent. " : why + " ") + "The reading above was assembled here from the published facts, in a fixed order, and every figure in it is quoted from a payload." };
  }

  function commonOrigin(facts) {
    let best = null;
    const keyOf = (f) => (f && text(f.source) ? f.source : null);
    const atOf = (f) => (f && text(f.at) ? f.at : null);
    for (const f of facts) {
      const n = facts.filter((g) => keyOf(g) === keyOf(f) && atOf(g) === atOf(f)).length;
      if (best === null || n > best.n) best = { source: keyOf(f), at: atOf(f), n };
    }
    return best;
  }
  const normalSaid = (x) => String(x).replace(/−/g, "-").replace(/\s+/g, " ").replace(/\.\s*$/, "").trim().toLowerCase();
  function echoedFacts(said, facts) {
    const hay = typeof said === "string" ? normalSaid(said) : "";
    return facts.map((f) => { const x = f && typeof f.say === "string" ? normalSaid(f.say) : ""; return hay !== "" && x !== "" && hay.indexOf(x) !== -1; });
  }

  function countSaid(facts, said) {
    const origin = commonOrigin(facts);
    const originAt = stampSaid(origin.at);
    const keySaid = origin.source === null ? "no source key at all" : "the " + origin.source + " key";
    const builtSaid = originAt === null ? "which published no build stamp" : "built " + originAt;
    const echoes = echoedFacts(said, facts);
    const nEchoed = echoes.filter(Boolean).length;
    const counted = facts.length === 1 ? "1 fact was handed to the answer above." : facts.length + " facts were handed to the answer above.";
    const rest = facts.length - origin.n;
    const whence = origin.n === facts.length
      ? " " + (facts.length === 1 ? "It comes" : "All of them come") + " from " + keySaid + ", " + builtSaid + "."
      : " " + origin.n + (origin.n === 1 ? " of them comes" : " of them come") + " from " + keySaid + ", " + builtSaid + "; the other " + rest + (rest === 1 ? " names its own key and stamp under itself." : " name their own key and stamp under themselves.");
    const echo = nEchoed === facts.length
      ? " Their sentences are the lines in the answer above; each is drawn once, as a figure, with its sentence, key and stamp one tap away on it."
      : nEchoed ? " " + nEchoed + " of them " + (nEchoed === 1 ? "is" : "are") + " restated in the answer above; every fact is drawn once, as a figure, with its sentence one tap away on it."
        : " Each is drawn as a figure, with its sentence, key and stamp one tap away on it.";
    return { line: counted + whence + echo, origin };
  }

  function factPins(facts) {
    if (!Array.isArray(facts) || !facts.length) return null;
    const parts = [];
    for (const f of facts) {
      if (!f || typeof f !== "object" || !f.n || typeof f.n !== "object") continue;
      const keys = Object.keys(f.n);
      if (!keys.length) continue;
      parts.push((typeof f.id === "string" ? f.id : "fact") + " [" + keys.map((k) => k + "=" + (Array.isArray(f.n[k]) ? f.n[k].join("/") : String(f.n[k]))).join(", ") + "]");
    }
    if (!parts.length) return null;
    return "The fields each sentence was built from, named and quoted as published: " + parts.join("; ") + ". These are the measured fields behind the sentences, not the whole set of figures written in them — a ticker or a date carries digits of its own — and the guard checks the answer against those sentences rather than against these values.";
  }

  function answerHow(payload, block, guard) {
    const lines = [];
    const fired = guardFired(guard);
    if (text(payload.why)) lines.push(payload.why);
    lines.push("Selection is deterministic and carries no model: the same question over the same published payloads picks the same facts on every machine. A ticker named in the question outweighs a topic word, and recency only ever breaks a tie.");
    const tokens = guardTokens(guard);
    if (tokens.length) lines.push("The tokens the guard refused, listed as data rather than as readings: " + tokens.join(", ") + ". None of them appears in any fact the answer was given.");
    else if (!fired && guard && Array.isArray(guard.numerals)) {
      lines.push(guard.numerals.length === 0
        ? "The answer above states no figure, so there was nothing in it for the guard to check. That is not a verification it passed: it is an answer that carried no number for one to be performed on."
        : "The guard scanned " + guard.numerals.length + " figure" + (guard.numerals.length === 1 ? "" : "s") + " in the answer above and found every one of them already written in the facts it was given.");
    }
    lines.push("The scan is character-for-character against the sentences the answer was handed, not against the field values behind them. That is stricter than it sounds: an answer that rewrites a published figure into millions has performed arithmetic on a measurement, and it is refused for it.");
    if (block.model !== null) lines.push("The model asked for this route is " + block.model + ".");
    if (block.calls !== null) lines.push("This site has asked the model " + block.calls + " time" + (block.calls === 1 ? "" : "s") + " today. That is a count of this route's own calls and not a reading of what the account has left: the allowance is account-wide, and nothing here can measure what else has spent it.");
    const pins = factPins(payload.facts);
    if (pins) lines.push(pins);
    return lines;
  }

  function splitAnswer(said) {
    const lines = String(said).split("\n").map((l) => l.trim());
    const paras = [], bullets = [];
    let cur = [];
    for (const l of lines) {
      if (l === "") { if (cur.length) { paras.push(cur.join(" ")); cur = []; } continue; }
      if (/^-\s+/.test(l)) { if (cur.length) { paras.push(cur.join(" ")); cur = []; } bullets.push(l.replace(/^-\s*/, "")); continue; }
      cur.push(l);
    }
    if (cur.length) paras.push(cur.join(" "));
    return { paras, bullets };
  }

  function ring(fraction, cls) {
    const svg = UI.ring(fraction, { color: fraction === null ? "--label-3" : fraction < 0.15 ? "--warn" : "--accent", size: 30 });
    svg.setAttribute("class", "ui-gchip-g " + cls);
    return svg;
  }

  function spendMeter(spend, reason) {
    const how = [];
    if (!spend || typeof spend !== "object") {
      const lead = "This page could not read what has been spent on the model today" + (reason ? " (" + reason + ")" : "") + ". Nothing follows from that about the allowance or about the readings below, and a question can still be asked: Cloudflare reports a spent allowance itself, and it is the authority here.";
      return h("div", { class: "ak-meter", "data-empty": "unreadable" },
        ring(null, "ak-meter-bar"), h("span", { class: "ak-meter-v" }, UI.dash({ state: "withheld", reason: lead }, "Model credits")),
        h("span", { class: "ak-meter-l" }, "credits"));
    }
    const allowance = isNum(spend.allowanceNeurons), left = isNum(spend.remaining), spent = isNum(spend.neurons);
    const calls = isNum(spend.calls), tokIn = isNum(spend.tokensIn), tokOut = isNum(spend.tokensOut);
    if (text(spend.day)) how.push("The day is " + spend.day + ", counted in UTC because that is the calendar the allowance resets on — at 00:00 UTC, not at midnight where you are.");
    if (calls !== null) how.push("This site has asked the model " + figure(calls) + " time" + (calls === 1 ? "" : "s") + " today" + (tokIn !== null && tokOut !== null ? ", for " + figure(tokIn) + " tokens in and " + figure(tokOut) + " tokens out. Tokens are what the model itself reported; the credit figure is arithmetic over them at the published rate for the model that answered each call, done when this page was drawn rather than stored, so a corrected rate repairs the whole history rather than leaving it stamped at yesterday's." : "."));
    how.push("Cloudflare is the authority on the allowance and this meter is not. It can only see calls this site made; anything else on the same account draws from the same pool and is invisible here. If a question comes back saying the allowance is spent while this still shows credits left, that difference is the answer — something else spent them — and the answer will say so.");
    if (left === null || allowance === null) {
      const lead = (calls === null ? "What has been spent on the model today could not be counted." : "This site has asked the model " + figure(calls) + " time" + (calls === 1 ? "" : "s") + " today.") + " The credits that cost is not shown: the per-token rate for a model this site asked is not set here, and deriving one would put a plausible wrong number where a measurement belongs.";
      return h("div", { class: "ak-meter", "data-empty": "withheld" },
        ring(null, "ak-meter-bar"),
        h("span", { class: "ak-meter-v" }, calls === null ? DASH : figure(calls)),
        h("span", { class: "ak-meter-l" }, calls === null ? "calls" : plural(calls, "call", "calls") + " today"),
        UI.stateButton({ state: "withheld", reason: lead }, "Model credits"),
        UI.infoButton("model credits", { title: "Model credits", lead, sections: [{ title: "How this is counted", lines: how }] }, { small: true }));
    }
    const pct = allowance > 0 ? Math.max(0, Math.min(1, left / allowance)) : 0;
    if (spent !== null) how.unshift("Spent so far today: " + figure(spent) + " of " + figure(allowance) + " credits, rounded up. A meter that rounded a spend down would report less spent than was spent, so this errs toward showing less left.");
    const lead = figure(left) + " of " + figure(allowance) + " model credits left today, counting only this site's own calls." + (left === 0 ? " By this count today's model credits are gone. Asking is still allowed and nothing here refuses it — and if the model does decline, the answer is still served: every figure in it was measured by the pipeline, and only the phrasing would have come from a model." : "");
    const bar = ring(pct, "ak-meter-bar");
    bar.setAttribute("data-fill", (pct * 100).toFixed(1));
    return h("div", { class: "ak-meter" },
      bar,
      h("span", { class: "ak-meter-v" }, h("b", { class: "ak-meter-n" }, figure(left)), h("span", { class: "ak-meter-of" }, " of " + figure(allowance))),
      h("span", { class: "ak-meter-l" }, "credits · this site's calls"),
      UI.infoButton("model credits", { title: "Model credits", lead, sections: [{ title: "How this is counted", lines: how }] }, { small: true }));
  }

  const GUARANTEE = "This box answers from the payloads this site has already published. It reads nothing live, it places no vendor call, and it performs no arithmetic: every figure in an answer is quoted from a payload. An answer that states a figure no payload published is refused before it reaches this page, and the measured reading is served instead.";

  const box = h("section", { class: "ak-compose" + (DOCKED ? " is-docked" : " ui-card"), id: "askBox", "aria-label": "Ask" });
  const exampleHost = h("div", { class: "ak-examples", id: "askExamples" });
  const onPageHost = h("div", { class: "ak-onpage-host", id: "askOnPage" });
  const meterHost = h("div", { class: "ak-meter-host", id: "askMeter" });
  const input = h("textarea", { class: "ak-ask-in", id: "askQ", rows: "1", placeholder: "Ask about a name or the session", autocomplete: "off", spellcheck: "false", "aria-describedby": "askHint" });
  const send = h("button", { class: "ak-ask-go", type: "submit", "aria-label": "Ask" }, UI.glyph("next"));
  const form = h("form", { class: "ak-ask", id: "askForm" },
    h("label", { class: "visually-hidden", for: "askQ" }, "Your question"),
    h("span", { class: "visually-hidden", id: "askHint" }, "Enter sends · Shift-Enter for a new line"),
    h("div", { class: "ak-ask-row" }, input, send));
  const guarantee = UI.infoButton("what this box answers from", { title: "What this box answers from", lead: GUARANTEE }, { small: true });
  guarantee.classList.add("ak-guarantee");
  const greetHost = h("div", { class: "ak-greet", id: "askGreet" });
  const foot = h("div", { class: "ak-foot" }, meterHost, h("span", { class: "ak-foot-sp" }), guarantee);
  if (DOCKED) box.append(exampleHost, onPageHost, form, foot);
  else box.append(greetHost, form, onPageHost, exampleHost, foot);
  const answerHost = h("div", { class: "ak-answer", id: "askAnswer", "aria-live": "polite" });
  const briefHost = h("div", { class: "ak-brief ui-grid", id: "askBrief" });
  const checksHost = h("div", { class: "ak-checks-slot", id: "askChecksSlot" });
  if (DOCKED) app.append(box, answerHost);
  else {
    app.classList.add("ui-grid");
    box.classList.add("ui-span-8");
    checksHost.classList.add("ui-span-4");
    app.append(box, checksHost, answerHost, briefHost);
  }

  const grow = () => { input.style.height = "auto"; input.style.height = Math.min(160, input.scrollHeight) + "px"; };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (typeof form.requestSubmit === "function") form.requestSubmit(); else send.click();
  });

  const EXAMPLE_TOPICS = ["What changed on the short board?", "Where does the session stand?", "What is already on the calendar before the next session?"];
  const EXAMPLE_SHORT = ["Short board changes", "Where the session stands", "Before the next session"];
  function coveredNames(facts) {
    const out = [];
    if (!Array.isArray(facts)) return out;
    for (const f of facts) {
      const src = f && typeof f.source === "string" ? f.source : "";
      if (src.indexOf("card:") !== 0) continue;
      const name = src.slice(5);
      if (name && out.indexOf(name) === -1) out.push(name);
    }
    return out;
  }
  function paintExamples(names) {
    const said = EXAMPLE_TOPICS.slice(0);
    const short = EXAMPLE_SHORT.slice(0);
    if (names.length) { said[0] = "What is new for " + names[0] + "?"; short[0] = "New for " + names[0]; }
    exampleHost.replaceChildren(...said.map((q, i) => h("button", {
      type: "button", class: "ak-example", title: q, "aria-label": q,
      onclick: () => { input.value = q; grow(); try { input.focus(); } catch (e) { } },
    }, h("span", { class: "ak-example-s" }, short[i]), h("span", { class: "visually-hidden" }, q))));
  }

  function pageTicker() {
    let raw = null;
    try { raw = new URL(location.href).searchParams.get("t"); } catch (e) { raw = null; }
    if (typeof raw !== "string") return null;
    const t = raw.trim().toUpperCase();
    return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) ? t : null;
  }
  const ON_PAGE = pageTicker();
  paintExamples([]);
  if (ON_PAGE !== null) {
    onPageHost.append(h("div", { class: "ak-onpage" },
      UI.tag(ON_PAGE, { accent: true }),
      h("span", { class: "visually-hidden" }, "Asking about " + ON_PAGE + (DOCKED ? " — the name on this page. " : " — the name this link carried. ") + "A question that names no ticker is answered about it. "),
      h("span", { class: "ak-onpage-l", "aria-hidden": "true" }, DOCKED ? "this page" : "from the link"),
      h("button", { class: "ak-onpage-go", type: "button", onclick: () => { const held = String(input.value || ""); input.value = held === "" ? ON_PAGE : held.replace(/\s+$/, "") + " " + ON_PAGE; grow(); try { input.focus(); } catch (e) { } } }, "Insert " + ON_PAGE)));
  }

  let gated = false;
  function get(path) {
    return fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } }).then((r) => {
      if (r.status === 401) { gated = true; location.replace("/flows/"); return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  const optional = (path) => get(path).catch((error) => ({ __unreadable: true, __reason: error && error.message ? error.message : String(error) }));
  function paintSpend(spend, reason) { meterHost.replaceChildren(spendMeter(spend, reason)); }

  function nameStrip(t, facts) {
    const mine = facts.filter((f) => tickerOf(f) === t && /^card:/.test(String(f.source || "")));
    if (!mine.length) return null;
    const by = (suffix) => mine.find((f) => tail(f.id) === suffix) || null;
    const n = (f) => (f && f.n && typeof f.n === "object" ? f.n : {});
    const st = by("standing"), mv = by("move"), ivr = by("ivrank"), gm = by("gamma"), fl = by("flow");
    const chips = [];
    const opener = (f) => (f ? factInfo(f, null, null) : null);
    if (st && isNum(n(st).score) !== null) chips.push(UI.gaugeChip({ diverging: n(st).score, value: F.signed(n(st).score), label: "Score", tone: UI.tone(n(st).score), info: opener(st) }));
    if (st && isNum(n(st).convictionOf100) !== null) chips.push(UI.gaugeChip({ ring: n(st).convictionOf100 / 100, color: "--label-1", value: String(n(st).convictionOf100), label: "Conviction", info: opener(st) }));
    if (st && text(n(st).regime)) chips.push(UI.gaugeChip({ icon: "gamma", color: n(st).regime === "long" ? "--g-long-ink" : "--g-short-ink", value: n(st).regime === "long" ? "Long" : n(st).regime === "short" ? "Short" : UI.cap(n(st).regime).replace(/\.$/, ""), label: "Dealer γ", tone: n(st).regime === "long" ? "long" : n(st).regime === "short" ? "short" : null, info: opener(gm || st) }));
    if (mv && isNum(n(mv).impliedMoveFraction) !== null) chips.push(UI.gaugeChip({ icon: "levels", color: "--accent-soft", value: "±" + F.pct(n(mv).impliedMoveFraction, 1), label: (isNum(n(mv).sessions) || "") + "d move", info: opener(mv) }));
    if (ivr && isNum(n(ivr).ivRank1yPct) !== null) chips.push(UI.gaugeChip({ ring: n(ivr).ivRank1yPct / 100, color: "--s-blue", value: String(Math.round(n(ivr).ivRank1yPct)), label: "IV rank", info: opener(ivr) }));
    else if (fl && isNum(n(fl).netPremiumUsd) !== null) chips.push(UI.gaugeChip({ icon: "wave", color: "--label-2", value: F.money(n(fl).netPremiumUsd, true), label: "Net premium", tone: UI.tone(n(fl).netPremiumUsd), info: opener(fl) }));
    if (!chips.length) return null;
    const spot = gm && isNum(n(gm).spotPx) !== null ? n(gm).spotPx : null;
    return h("div", { class: "ak-name" },
      h("a", { class: "ak-name-t", href: "/flows/ticker/?t=" + encodeURIComponent(t) }, h("b", null, t), spot !== null ? h("span", null, F.px(spot)) : null, UI.glyph("next")),
      UI.chips(chips.slice(0, 5), t + " at a glance"));
  }

  function qualifier(label, lead, o = {}) {
    return h("button", { type: "button", class: "ui-tag ak-q", "data-tone": o.tone || null, ...infoAttrs({ title: label, state: o.state || null, lead }) }, o.glyph ? UI.glyph(o.glyph) : null, label);
  }

  function paintAnswer(payload, question) {
    answerHost.replaceChildren();
    if (payload && Object.prototype.hasOwnProperty.call(payload, "spend")) paintSpend(payload.spend, null);
    answerHost.append(h("div", { class: "ak-turn" }, h("p", { class: "ak-asked" }, h("span", { class: "visually-hidden" }, "You asked "), question)));
    const card = h("article", { class: "ak-a", "aria-label": "Answer" });
    answerHost.append(card);
    const head = h("header", { class: "ak-a-h" }, h("span", { class: "ak-a-g", "aria-hidden": "true" }, UI.glyph("neuron")));
    card.append(head);
    if (!payload || typeof payload !== "object") {
      card.append(UI.silent({ state: "withheld", reason: "The route answered in a shape this page cannot read, so there is nothing to show for this question. That is a fault on this page's side of the wire rather than a fact about the session." }, "Answer", 140));
      card.lastChild.setAttribute("data-empty", "unreadable");
      return;
    }
    if (payload.status === "pending" || payload.status === "unreadable") {
      const pending = payload.status === "pending";
      const said = text(payload.note) || (pending
        ? "The briefing has not been published for this session yet, so there is nothing measured to answer from. Nothing is claimed about the market by that."
        : "The briefing could not be read from the store, so no answer is offered. That is a fault on this site rather than a fact about the session.");
      const sil = UI.silent({ state: pending ? "pending" : "withheld", reason: said }, "Answer", 140);
      sil.setAttribute("data-empty", pending ? "pending" : "unreadable");
      sil.append(h("span", { class: "visually-hidden" }, said));
      card.append(sil);
      return;
    }
    const block = llmBlock(payload);
    const guard = payload.guard && typeof payload.guard === "object" ? payload.guard : null;
    const fired = guardFired(guard);
    const facts = Array.isArray(payload.facts) ? payload.facts : [];
    const said = typeof payload.answer === "string" ? payload.answer.trim() : "";
    const prov = provenance(block, fired, guard);
    const parts = splitAnswer(said);
    const quals = [];
    const qualLines = [];
    const age = payload.session && typeof payload.session === "object" ? payload.session : null;
    if (age && age.stale === true && text(age.say)) { quals.push(qualifier("Stale", age.say.trim(), { state: "stale", glyph: "stale", tone: "warn" })); qualLines.push(age.say.trim()); }
    if (payload.subjectApplied === true && text(payload.subject)) {
      const s = "Nothing in the question named a ticker, so " + payload.subject + " — the name on the page this was asked from — was added to it before the readings were selected. Typing a name of your own is what overrides that; this page's name is not added to a question that already has one.";
      quals.push(qualifier(payload.subject + " added", s, { glyph: "search" }));
      qualLines.push(s);
    }
    const withheld = text(payload.withheld);
    if (withheld !== null && block.used === true && !fired) {
      const miss = (withheld.match(/about ([A-Z][A-Z0-9.\-]{0,9})/) || [])[1];
      quals.push(qualifier((miss || "Name") + " not covered", withheld, { state: "unavailable", glyph: "unavailable", tone: "warn" }));
      qualLines.push(withheld);
    }
    let firedSaid = null;
    if (fired) {
      const why = text(payload.note) || (guard && text(guard.reason));
      firedSaid = "The generated wording was discarded before it reached this page and what you are reading is the measured facts in a fixed order. " + (why === null ? "The route did not state which rule it failed." : why);
      qualLines.push(firedSaid);
    }
    if (payload.capped === true) {
      const s = "The facts below were cut at this page's own cap, so they are a selection rather than everything published. How many were selected out of how many exist is stated in the method note of this answer.";
      quals.push(qualifier("Capped", s, { glyph: "list" }));
      qualLines.push(s);
    }
    const count = facts.length ? countSaid(facts, said) : null;
    const how = () => ({
      title: "How this was answered",
      state: fired ? "withheld" : null,
      lead: prov.said,
      sections: [
        firedSaid ? { title: "Refused", lines: [firedSaid] } : null,
        count ? { title: "Facts", lines: [count.line] } : null,
        qualLines.length ? { title: "Qualifiers", lines: qualLines } : null,
        { title: "Method", lines: answerHow(payload, block, guard) },
      ].filter(Boolean),
    });
    head.append(...[
      h("button", { type: "button", class: "ui-tag ak-prov", "data-tone": prov.tone || null, ...infoAttrs(how) }, prov.word),
      prov.checked ? h("span", { class: "ui-tag ak-checked", "data-tone": "up" }, UI.glyph("up"), "Figures checked") : null,
      ...quals,
      h("span", { class: "ak-a-sp" }),
      h("button", { type: "button", class: "ui-info ui-info--sm ak-how", "aria-label": "About this answer", ...infoAttrs(how) }, UI.glyph("info")),
    ].filter(Boolean));
    if (said === "") {
      const sil = UI.silent({ state: "withheld", reason: "The route answered and carried no text for this question, so there is nothing to read. The facts it selected are drawn below and are unaffected." }, "Answer", 96);
      sil.setAttribute("data-empty", "unreadable");
      card.append(sil);
    } else {
      const lead = parts.paras[0] || parts.bullets[0] || said;
      const rest = parts.paras.slice(1);
      const fromModel = block.used === true && !fired;
      const verdict = h("p", { class: "ak-verdict" }, lead);
      card.append(verdict);
      const bulletsEcho = parts.bullets.length && facts.length && parts.bullets.every((b) => facts.some((f) => f && typeof f.say === "string" && normalSaid(f.say) === normalSaid(b)));
      const tailLines = [].concat(fromModel ? rest : [], parts.bullets.length && !bulletsEcho ? parts.bullets : [], fromModel ? [] : rest);
      if (tailLines.length) {
        const more = h("div", { class: "ak-more", id: "askMore", hidden: true }, tailLines.map((l) => h("p", null, l)));
        const toggle = h("button", { type: "button", class: "ui-disclose ak-more-b", "aria-expanded": "false", "aria-controls": "askMore" }, h("span", null, "More"), UI.glyph("chev"));
        toggle.addEventListener("click", () => {
          const open = toggle.getAttribute("aria-expanded") !== "true";
          toggle.setAttribute("aria-expanded", String(open));
          more.hidden = !open;
          toggle.firstChild.textContent = open ? "Less" : "More";
        });
        card.append(toggle, more);
      }
    }
    const subjects = coveredNames(facts);
    const focus = payload.subject && subjects.indexOf(payload.subject) !== -1 ? payload.subject : subjects.length === 1 ? subjects[0] : null;
    const strip = focus ? nameStrip(focus, facts) : null;
    if (strip) card.append(strip);
    if (facts.length) {
      const origin = count.origin;
      const shown = strip ? facts.filter((f) => !(tickerOf(f) === focus && /\/(standing|move|ivrank)$/.test(String(f.id || "")))) : facts;
      const grid = h("div", { class: "ak-facts", role: "list", "aria-label": facts.length + (facts.length === 1 ? " fact" : " facts") + " behind this answer" },
        shown.map((f, i) => h("div", { role: "listitem", class: "ak-fact-li" }, factChip(f, origin.source, origin.at, i))));
      if (shown.length) card.append(grid);
    }
    const sil = silenceTags(silenceList(payload.silences));
    if (sil) card.append(sil);
    if (!facts.length && !silenceList(payload.silences).length && said === "") {
      card.append(h("p", { class: "visually-hidden", "data-empty": "unreadable" }, "The route returned neither an answer, a fact nor a silence, so this page cannot say what was asked of the payloads. A fault on this page's side of the wire."));
    }
    const names = coveredNames(facts);
    if (names.length) paintExamples(names);
  }

  const REGIONS = [
    { slot: "yesterday", id: "askYesterday", title: "Since", heading: "Since the prior session", asks: "What is different from the last session this pipeline measured?",
      qualify: (x) => [text(x.prior) === null ? "This region names no comparand, so the movement above is not anchored to a dated session and cannot be read as an overnight change." : "Every count above is measured against the " + x.prior + " session, which is the board this run compared itself with."],
      how: ["The movement is read off fields the run stamps on each board row — where a name stood in the prior session, how many places it moved, whether it is new or held over — rather than from this page subtracting two payloads.",
        "That distinction is the whole reason the region is trustworthy. A subtraction done here has no way to tell a name that was not scored in the prior session from one that scored identically, so it reports a name last seen three weeks ago as an overnight mover."] },
    { slot: "today", id: "askToday", title: "Today", heading: "Where the session stands", asks: "What did this run measure across the two boards?",
      qualify: (x) => [text(x.session) === null ? "No session date was published beside these readings, so nothing here can be tied to a trading day. That is a gap in the payload rather than a quiet market." : "These readings are from the " + x.session + " session."],
      how: ["The tilt counts the whole side rather than the page. A board publishes how many names cleared the dead band and, separately, how many rows fitted on it, and the count above is the first of those — a page count would understate the session.",
        "The leading name on each side is the row the run itself ranked first. This page does no sorting: a renderer that re-ranked could disagree with the board it links to, for the same session, on the same numbers."] },
    { slot: "next", id: "askNext", title: "Next", heading: "Next session: scheduled, and positioned", asks: "What is already on the calendar, and what sits on a threshold?",
      qualify: (x) => {
        const said = [];
        const gate = isNum(x.gateDays);
        said.push(text(x.origin) === null ? "No origin date was published for this region, so the day counts above are not anchored and cannot be read as distances from any particular session."
          : "Every day count above is measured from " + x.origin + ", the day this briefing was built, not from the clock on this device — a briefing opened on a Saturday about the next session is a briefing about Monday.");
        if (gate !== null) said.push("The gate carries a name for " + gate + " calendar day" + (gate === 1 ? "" : "s") + " from that origin, and the calendar entries above are the ones inside it.");
        said.push(x.isForecast === false ? "This section is declared measured rather than projected: every line in it is either an entry already on a published calendar or a distance between two numbers measured today. Nothing here is a claim about a future price."
          : "This payload does not declare the section measured rather than projected, so this page withholds that claim. Read the lines above as what they say and nothing further.");
        return said;
      },
      how: ["The threshold distance is quoted from the watch list's published residual and never from its integer score, which is zero for every row inside the band — reading the score would report the whole band as one undifferentiated tie.",
        "A negative days-to-earnings is withheld rather than read as due today. It means the vendor's date is stale, and a stale date presented as an imminent one is the more expensive of the two mistakes."] },
  ];

  function tile(fact, brief, i) {
    const f = figureOf(fact);
    const unread = text(fact && fact.say) === null;
    const tk = f.ticker;
    return h("div", { class: "ak-tile", role: "listitem", "data-fact": fact && fact.id ? String(fact.id) : null },
      h("button", { type: "button", class: "ak-tile-b", "data-empty": unread ? "unreadable" : null, ...infoAttrs(factInfo(fact, "brief", brief && brief.generatedAt)), style: { "--i": String(i) } },
        h("span", { class: "ak-tile-l" }, f.label || DASH),
        h("span", { class: "ak-tile-v", "data-tone": f.tone }, unread ? DASH : f.value, tk && f.value !== tk ? h("span", { class: "ak-tile-t" }, tk) : null),
        f.sub ? h("span", { class: "ak-tile-s" }, f.sub) : null,
        f.split ? UI.split([{ color: "--up-mark", value: f.split[0] }, { color: "--label-4", value: f.split[2] }, { color: "--down-mark", value: f.split[1] }], "Bullish against bearish") : null),
      f.tags && f.tags.length ? h("div", { class: "ui-tags ak-tile-tags" }, f.tags.map((t) => h("a", { class: "ui-tag", href: "/flows/ticker/?t=" + encodeURIComponent(t) }, t))) : null);
  }

  function paintRegion(cfg, brief, index) {
    const payload = brief && typeof brief === "object" ? brief[cfg.slot] : null;
    const base = { id: cfg.id, title: cfg.title, index, span: 4 };
    if (!payload || typeof payload !== "object") {
      const reason = "The briefing was published and carried no section for this region, so there is nothing here to read. A gap in the payload rather than a fact about the session.";
      const m = UI.moduleCard({ ...base, state: { state: "unavailable", reason }, body: UI.silent({ state: "unavailable", reason }, cfg.heading, 160) });
      m.classList.add("ak-region");
      m.setAttribute("data-empty", "unavailable");
      return m;
    }
    const facts = Array.isArray(payload.facts) ? payload.facts : [];
    const silences = silenceList(payload.silences);
    const quals = cfg.qualify(payload);
    const built = stampSaid(brief.generatedAt);
    const meta = facts.length ? (facts.length === 1 ? "1 reading was published for this region, and it is drawn." : facts.length + " readings were published for this region, and all of them are drawn.") +
      (built === null ? " They come from the brief key, which published no build stamp." : " All of them come from the brief key, built " + built + "; any reading that came from somewhere else names its own key.") : null;
    const body = [];
    if (facts.length) body.push(h("div", { class: "ak-tiles", role: "list", "aria-label": cfg.heading }, facts.map((f, i) => tile(f, brief, i))));
    const sil = silenceTags(silences);
    if (sil) body.push(sil);
    if (!facts.length && !silences.length) {
      const reason = "This section published no reading and named no silence, so this page cannot say whether anything was measured. That is a fault on this page's side of the wire rather than a fact about the session.";
      const s = UI.silent({ state: "withheld", reason }, cfg.heading, 140);
      s.setAttribute("data-empty", "unreadable");
      body.push(s);
    }
    const m = UI.moduleCard({
      ...base, body,
      info: () => ({ title: cfg.heading, lead: cfg.asks, facts: [["Readings", String(facts.length)], ["Silences", String(silences.length)]],
        sections: [{ title: "Readings", lines: facts.map((f) => text(f.say) || "A reading published without its sentence.") }, { title: "Qualified", lines: quals.concat(meta ? [meta] : []) }, { title: "How this region was derived", lines: cfg.how }] }),
    });
    m.classList.add("ak-region");
    return m;
  }

  const WARN_MARK = { blocking: "!!", caution: "!", note: MID };
  function paintWarnings(brief) {
    const list = brief && Array.isArray(brief.warnings) ? brief.warnings : null;
    const checked = brief && typeof brief.warningsChecked === "number" ? brief.warningsChecked : null;
    const questions = brief && typeof brief.warningsQuestions === "number" ? brief.warningsQuestions : null;
    let lead, st = null;
    if (list === null) { lead = "This briefing carries no consistency report, so nothing is stated about whether its surfaces agree. That is a gap on this page rather than a clean bill."; st = "unavailable"; }
    else if (!list.length) {
      if (checked === null) { lead = "No inconsistency is listed, and this briefing does not say how many of its checks could run — so this page cannot tell an empty list from an unasked question, and states nothing either way about whether these surfaces agree."; st = "withheld"; }
      else if (checked === 0) { lead = "Not one consistency check had the inputs to run, so no two surfaces were compared and nothing is claimed about whether they agree. An empty list here is what a store with nothing in it produces, and it is a gap in what has been published rather than a clean bill."; st = "pending"; }
      else {
        lead = "No inconsistency was found across the published surfaces, from " + checked + " " + (checked === 1 ? "check that could run" : "checks that could run") + "." +
          (questions === null ? " How many checks this briefing carries is not published, so that number is the count that ran and not the share of the sweep it covers."
            : questions - checked === 0 ? " That is every check this briefing carries, so the sweep was complete."
              : " This briefing carries " + questions + ", so " + (questions - checked) + " of them could not be asked at all — they are unanswered rather than clear, and nothing is claimed about what they would have found.");
      }
    } else {
      lead = (list.length === 1 ? "1 thing to know before reading the rest" : list.length + " things to know before reading the rest") + ". " + (checked === null
        ? "Each was found by comparing two published surfaces against each other."
        : "Found by comparing published surfaces against each other. " + (questions === null ? checked + " " + (checked === 1 ? "check" : "checks") + " had the inputs to run at all, out of a total this briefing does not publish." : checked + " of the " + questions + " checks this briefing carries had the inputs to run at all."));
    }
    const ran = checked !== null && questions ? checked / questions : null;
    const summary = h("div", { class: "ak-checks" },
      UI.metric("Checks", checked === null ? DASH : questions === null ? String(checked) : checked + " of " + questions, { id: "checks", state: st ? { state: st, reason: lead } : null, key: ran !== null ? UI.ring(ran, { color: "--accent", size: 16 }) : null }),
      UI.metric("Found", list === null ? DASH : String(list.length), { id: "found", tone: list && list.length ? "warn" : null }));
    const rows = (list || []).map((w0) => {
      const w = w0 && typeof w0 === "object" ? w0 : {};
      const severity = text(w.severity);
      const known = severity !== null && Object.prototype.hasOwnProperty.call(WARN_MARK, severity);
      const sev = known ? severity : "unknown";
      const wsaid = text(w.say);
      const src = Array.isArray(w.sources) ? w.sources.filter((x) => typeof x === "string" && x) : [];
      const idParts = text(w.id) ? w.id.split(":") : [];
      const kind = idParts[0] ? UI.cap(idParts[0]).replace(/\.$/, "") : "Check";
      const what = idParts[1] ? UI.cap(idParts[1].replace(/[-_]/g, " ")).replace(/\.$/, "") : kind;
      return h("div", { role: "listitem", class: "ak-warn-li" }, h("button", { type: "button", class: "ak-warn is-" + sev, ...infoAttrs({ title: what + (what === kind ? "" : " " + kind.toLowerCase()), state: wsaid === null ? "withheld" : null,
        lead: wsaid === null ? "A warning was published without the sentence that states it, so this page cannot say what it found. That is a gap in the payload rather than a clean surface." : wsaid,
        facts: [["Severity", severity === null ? "no severity published" : severity], ["Sources", src.length ? src.join(", ") : null]] }) },
      h("span", { class: "ak-warn-mark" }, known ? WARN_MARK[severity] : "?"),
      h("span", { class: "ak-warn-body" }, h("b", null, what), h("span", { class: "ak-src-key" }, what === kind ? src.join(", ") : kind.toLowerCase() + (src.length ? " " + MID + " " + src.join(", ") : ""))),
      h("span", { class: "ak-warn-sev" }, severity === null ? "no severity published" : severity)));
    });
    const listed = rows.length ? UI.list(rows, { visible: 2, label: lead.split(". ")[0] }) : null;
    if (listed) (listed.classList.contains("ui-list") ? listed : listed.querySelector(".ui-list")).classList.add("ak-warns-list");
    const m = UI.moduleCard({ id: "askChecks", title: "Checks", index: 0, span: 4, state: st ? { state: st, reason: lead } : null, info: { title: "Consistency checks", lead },
      body: [summary, listed] });
    m.classList.add("ak-warns");
    return m;
  }

  function paintBrief(brief) {
    briefHost.replaceChildren();
    if (brief && brief.__unreadable === true) {
      const s = "The request for the briefing did not come back" + (brief.__reason ? " (" + brief.__reason + ")" : "") + ". That is this page failing to READ the key, not a statement about what the key holds — reload before drawing any conclusion from its absence. The question box above is unaffected and still answers.";
      const box = UI.silent({ state: "unavailable", reason: s }, "Briefing", 180);
      box.setAttribute("data-empty", "unreadable");
      briefHost.append(box);
      status.textContent = "The briefing could not be read on this load. The question box reads a different route and is unaffected.";
      status.setAttribute("data-empty", "unreadable");
      return;
    }
    if (!brief || typeof brief !== "object") {
      const box = UI.silent({ state: "withheld", reason: "The briefing arrived in a shape this page cannot read, so none of the three regions is drawn. That is a fault on this page rather than a fact about the session." }, "Briefing", 180);
      box.setAttribute("data-empty", "unreadable");
      briefHost.append(box);
      return;
    }
    if (brief.status === "pending") {
      const s = "The briefing has not been published for this session yet, so there is nothing to summarise. It appears with the first pipeline run of the session; nothing here is a reading about the market.";
      const box = UI.silent({ state: "pending", reason: s }, "Briefing", 180);
      box.setAttribute("data-empty", "pending");
      briefHost.append(box);
      status.textContent = "No briefing has been published for this session yet.";
      status.setAttribute("data-empty", "pending");
      return;
    }
    UI.freshness({ sessionDate: brief.sessionDate, generatedAt: brief.generatedAt, source: "brief" });
    checksHost.replaceChildren(paintWarnings(brief));
    briefHost.append(...REGIONS.map((cfg, i) => paintRegion(cfg, brief, i + 1)));
    const covered = coveredNames(brief.facts);
    if (covered.length) paintExamples(covered);
    status.removeAttribute("data-empty");
    const session = text(brief.sessionDate);
    const built = stampSaid(brief.generatedAt);
    const reread = stampSaid(brief.refreshedAt);
    status.textContent = [session === null ? "Briefing published without a session date" : "Session " + session, built === null ? "no build stamp on this key" : "built " + built]
      .concat(reread === null ? [] : ["alerts and pulse re-read " + reread]).join(" " + MID + " ");
    const age = brief.session && typeof brief.session === "object" ? brief.session : null;
    const headState = document.getElementById("askHeadState");
    if (headState) headState.replaceChildren(age && age.stale === true && text(age.say) ? UI.stateButton({ state: "stale", reason: age.say.trim() }, "Briefing") : "");
    const aboutBtn = document.getElementById("askAbout");
    if (aboutBtn) {
      const notes = brief.notes && typeof brief.notes === "object" ? Object.keys(brief.notes).map((k) => text(brief.notes[k])).filter(Boolean) : [];
      aboutBtn.dataset.info = UI.info(() => ({
        title: "Ask", asOf: session ? "Session " + F.day(session) : null,
        lead: "What the session says, what changed to get here, and what is already on the calendar before the next one — assembled from the same published readings every other page here draws. Ask a question and the wording may be a model's; the figures never are. Anything it writes that is not already in the measurements it was handed is refused, and the measured reading is served instead.",
        sections: [{ title: "Briefing", lines: [status.textContent] }, notes.length ? { title: "Notes", lines: notes } : null, { title: "Answers", lines: [GUARANTEE] }].filter(Boolean),
      }));
    }
  }

  let asking = false;
  function post(question, subject) {
    return fetch("/api/flows/ask", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ question, subject }),
    }).then((r) => {
      if (r.status === 401) { gated = true; location.replace("/flows/"); return null; }
      if (r.ok) return r.json();
      return r.json().catch(() => null).then((body) => {
        const said = body && body.error && text(body.error.message) ? body.error.message.trim() : null;
        const failure = new Error(said === null ? "HTTP " + r.status : said);
        failure.said = said;
        throw failure;
      });
    });
  }
  function setAsking(on) {
    asking = on;
    send.disabled = on;
    form.setAttribute("aria-busy", on ? "true" : "false");
    box.classList.toggle("is-asking", on);
  }
  function failAnswer(question, said) {
    answerHost.replaceChildren(h("div", { class: "ak-turn" }, h("p", { class: "ak-asked" }, h("span", { class: "visually-hidden" }, "You asked "), question)));
    const sil = UI.silent({ state: "unavailable", reason: said }, "Answer", 120);
    sil.setAttribute("data-empty", "unreadable");
    sil.append(h("span", { class: "visually-hidden" }, said));
    answerHost.append(h("article", { class: "ak-a" }, sil));
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (asking || gated) return;
    const question = String(input.value || "").trim();
    if (question === "") {
      const s = "No question was typed, so nothing was sent and no model call was spent. " + (DOCKED
        ? "Nothing on this page changes; the session's briefing is a page of its own, at /flows/ask/."
        : "The briefing below stands whether or not anything is asked.");
      answerHost.replaceChildren(h("p", { class: "ak-empty", role: "note" }, UI.glyph("quiet"), h("span", null, s)));
      input.focus();
      return;
    }
    setAsking(true);
    answerHost.replaceChildren(h("div", { class: "ak-turn" }, h("p", { class: "ak-asked" }, h("span", { class: "visually-hidden" }, "You asked "), question)),
      h("div", { class: "ak-typing", role: "status" }, h("i"), h("i"), h("i"), h("span", { class: "visually-hidden" }, "Reading the published payloads for this question…")));
    post(question, ON_PAGE).then((payload) => {
      if (gated) return;
      paintAnswer(payload, question);
    }).catch((error) => {
      if (gated) return;
      failAnswer(question, error && error.said ? error.said
        : "The question could not be sent: " + (error && error.message ? error.message : error) + ". That is this page failing to reach its route, not a statement about what has been published — " + (DOCKED
          ? "this rail draws no briefing, and the one at /flows/ask/ is read from a different route."
          : "the briefing below was read separately and still stands."));
    }).then(() => { if (!gated) setAsking(false); });
  });

  optional("/api/flows/ai-usage").then((res) => {
    if (gated) return;
    if (res && res.__unreadable) { paintSpend(null, res.__reason); return; }
    paintSpend(res && typeof res === "object" ? res.spend : null, null);
  });

  if (DOCKED) return;
  optional("/api/flows/summary").then((sum) => {
    if (gated || !sum || sum.__unreadable || typeof sum !== "object") return;
    const said = text(sum.summary);
    if (!said) {
      if (sum.status === "pending") greetHost.append(h("p", { class: "ak-greet-l is-pending" }, UI.glyph("pending"), h("span", null, "No session read yet")));
      return;
    }
    const first = (said.match(/^.+?[.!?](?=\s|$)/) || [said])[0];
    const when = text(sum.generatedAt) ? F.time(sum.generatedAt) : null;
    greetHost.append(
      h("span", { class: "ak-a-g", "aria-hidden": "true" }, UI.glyph("neuron")),
      h("p", { class: "ak-greet-l" }, first),
      UI.infoButton("the session read", { title: "Neuron", asOf: when, lead: said, notes: [text(sum.provenance)] }, { small: true }));
  });
  optional("/api/flows/brief").then((brief) => { if (!gated) paintBrief(brief); }).catch((error) => {
    if (gated) return;
    status.textContent = "The briefing could not be drawn: " + error.message;
    status.setAttribute("data-empty", "unreadable");
  });
})();
