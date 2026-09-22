import { TICKER_PANELS, SENTINEL_KEYS } from "./flows-panels.js";
import { guardAnswer, numeralsIn } from "./flows-ask.js";

export const NEURON_CONTEXT_VERSION = 1;
export const NEURON_MAX_IDEAS = 3;
export const NEURON_STRUCTURES = Object.freeze([
  "long call", "long put", "call debit spread", "put debit spread", "call credit spread",
  "put credit spread", "iron condor", "long straddle", "long strangle", "calendar spread",
  "covered call", "collar", "no position",
]);
export const ROBUSTNESS_WORD = Object.freeze({ 0: "withheld", 1: "weak", 2: "fair", 3: "robust" });

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const r2 = (v) => (v === null ? null : Number(v.toFixed(2)));

function silence(status) {
  return status === "pending" || status === "unreadable" || status === "quiet" || status === "unavailable"
    ? status : "unavailable";
}

function scalarFigures(panel, keys) {
  const out = {};
  for (const k of keys) {
    const v = panel[k];
    if (num(v) !== null) out[k] = num(v);
    else if (str(v) !== null && v.length <= 24) out[k] = v.trim();
  }
  return out;
}

const FIGURE_KEYS = {
  gamma: ["spot", "callWall", "putWall", "strikes", "bandMin", "bandMax"],
  surface: ["asOf", "atSpot", "expiriesShown", "expiriesTotal", "strikesShown", "strikesTotal"],
  levels: ["spot", "atr"],
  scoreOverlay: ["overlap", "scored", "deadBand"],
  premiumTrack: ["sessions", "priced", "up", "down", "net"],
  ivSurface: ["placed", "fresh", "stale", "expiriesShown", "expiriesTotal"],
  skewTerm: ["skew", "term", "atmIv", "atmExpiry"],
  topContracts: ["shown", "total", "aggressorReported"],
  aggressor: ["shown", "measuredStrikes", "reported", "unreported"],
  path: ["netDelta", "netPremium", "minutes", "persistence", "concentration"],
  calendar: ["expiries", "halfLifeExpiry", "halfLifeDays", "frontLoad", "meanLifeDays"],
  vanna: ["seen", "cap", "shed"],
  charm: ["seen", "cap", "shed"],
  deltaExposure: ["seen", "cap", "shed"],
  displacement: ["oiCentroid", "volCentroid", "spot", "gapPx", "gapAtr"],
  pricedMove: ["impliedMove", "impliedLow", "impliedHigh", "realizedMove", "sessions", "asOf"],
  context: ["r5", "r21", "r42", "week52Pos", "changePct"],
  congress: ["total", "buys", "sells", "medianLagDays"],
  marketRank: ["asOf"],
  darkpool: ["seen", "cap", "shed", "unpriced"],
  oiDeltas: ["seen", "cap", "shed"],
  volContext: [],
};

function panelRobustness(key, group, p, card) {
  if (!p || typeof p !== "object") return { r: 0, why: "not published on this card" };
  if (p.status !== "ok") {
    return p.status === "quiet"
      ? { r: 1, why: "measured and empty: a reading, but nothing to lean on" }
      : { r: 0, why: silence(p.status) + (str(p.reason) ? ": " + p.reason : "") };
  }
  const conv = card.conv && typeof card.conv === "object" ? card.conv : {};
  switch (key) {
    case "gamma": case "levels":
      return num(p.strikes) !== null && num(p.strikes) < 20 || (num(card.regime && card.regime.crossings) === null && key === "gamma" && false)
        ? { r: 2, why: "the gamma profile rests on fewer than 20 strikes" }
        : { r: 3, why: "standing open interest across the book, settled at the clearing snapshot" };
    case "surface":
      return num(p.clipped) > 0
        ? { r: 2, why: "the surface was clipped to its scale cap on some cells" }
        : { r: 3, why: "standing open interest by strike and expiry" };
    case "ivSurface": {
      const placed = num(p.placed), fresh = num(p.fresh);
      return placed !== null && fresh !== null && placed > 0 && fresh / placed < 0.8
        ? { r: 2, why: "a fifth or more of the quotes carry a stale print" }
        : { r: 3, why: "quoted implied volatility, mostly fresh prints" };
    }
    case "path": {
      const mins = num(p.minutes), pers = num(p.persistence);
      return mins !== null && mins >= 300 && pers !== null && Math.abs(pers - 0.5) >= 0.15
        ? { r: 3, why: "a full session read with a one-sided persistence" }
        : { r: 2, why: "a partial session or a two-sided tape" };
    }
    case "aggressor": {
      const rep = num(p.reported), un = num(p.unreported);
      return rep !== null && un !== null && rep + un > 0 && rep / (rep + un) >= 0.9
        ? { r: 3, why: "the vendor reported a side on nine in ten contracts" }
        : { r: 2, why: "a side is missing on more than one contract in ten" };
    }
    case "darkpool":
      return { r: 1, why: "off-exchange prints carry no side and no participant" };
    case "congress":
      return { r: 1, why: "disclosures are filed weeks after the trade" };
    case "oiDeltas":
      return { r: 2, why: "a settled fact between two clearing snapshots, a day late by construction" };
    case "scoreOverlay": case "premiumTrack":
      return num(conv.persistence) !== null && num(conv.persistence) >= 0.7
        ? { r: 3, why: "the score has persisted across the window" }
        : { r: 2, why: "a track whose sign has not persisted" };
    default:
      return { r: 2, why: "published for this session and read whole" };
  }
}

export function buildContext(card, extras) {
  const c = card && typeof card === "object" ? card : {};
  const x = extras && typeof extras === "object" ? extras : {};
  const panels = c.panels && typeof c.panels === "object" ? c.panels : {};
  const session = str(c.sessionDate);
  const expected = str(x.expectedSession);
  const stale = session !== null && expected !== null ? session < expected : null;
  const conv = c.conv && typeof c.conv === "object" ? c.conv : {};
  const quality = c.quality && typeof c.quality === "object" ? c.quality : {};
  const regime = c.regime && typeof c.regime === "object" ? c.regime : {};
  const score = num(c.score), conviction = num(c.conviction);

  const features = [];
  const push = (f) => { features.push(f); return f; };

  {
    let r = 1, why = "conviction below 50 of 100";
    if (conviction !== null && conviction >= 75 && num(conv.gate) !== null && conv.gate >= 1
        && num(conv.coverage) !== null && conv.coverage >= 0.8) {
      r = 3; why = "conviction at or above 75 with the quality gate cleared and coverage above 0.8";
    } else if (conviction !== null && conviction >= 50) {
      r = 2; why = "conviction between 50 and 75";
    }
    if (score === null) { r = 0; why = "no score was published"; }
    const fam = c.fam && typeof c.fam === "object" ? c.fam : {};
    push({
      key: "standing", title: "Score and conviction", group: "signal",
      status: score === null ? "unavailable" : "ok", robustness: r, why,
      say: score === null ? null
        : c.ticker + " scored " + score + " this session with conviction " +
          (conviction === null ? "unpublished" : conviction + " of 100") +
          (str(regime.label) ? "; dealer gamma at spot is " + regime.label : "") +
          (num(c.gammaFlip) !== null ? "; net gamma flips sign at " + r2(c.gammaFlip) : "") +
          (num(c.atr) !== null ? "; one ATR is " + r2(c.atr) : "") + ".",
      figures: {
        score, conviction, regime: str(regime.label), gammaFlip: r2(num(c.gammaFlip)), atr: r2(num(c.atr)),
        agreement: r2(num(conv.agreement)), breadth: num(conv.breadth), coverage: r2(num(conv.coverage)),
        persistence: r2(num(conv.persistence)), gate: r2(num(conv.gate)),
        otmShare: r2(num(quality.otmShare)), vegaTilt: r2(num(quality.vegaTilt)),
        F: num(fam.F), P: num(fam.P), D: num(fam.D), V: num(fam.V), O: num(fam.O),
      },
    });
  }

  for (const spec of TICKER_PANELS) {
    if (SENTINEL_KEYS.has(spec.key)) continue;
    const p = panels[spec.key];
    const { r, why } = panelRobustness(spec.key, spec.group, p, c);
    const ok = p && typeof p === "object" && p.status === "ok";
    push({
      key: spec.key, title: spec.title, group: spec.group,
      status: p && typeof p === "object" ? silence(p.status) === p.status || p.status === "ok" ? p.status : "unavailable" : "unavailable",
      robustness: r, why,
      say: ok && p.lead && str(p.lead.say) ? p.lead.say.trim() : null,
      figures: ok ? scalarFigures(p, FIGURE_KEYS[spec.key] || []) : {},
      reason: !ok && p && str(p.reason) ? p.reason.trim() : null,
    });
  }

  {
    const ctx = panels.context && panels.context.status === "ok" ? panels.context : null;
    const g = ctx && ctx.garch && typeof ctx.garch === "object" ? ctx.garch : null;
    const fitted = g && g.status === "ok";
    const skewt = fitted && g.dist === "skewt";
    const last = fitted ? (num(g.lastVol) !== null ? num(g.lastVol)
      : Array.isArray(g.condVol) && g.condVol.length ? num(g.condVol[g.condVol.length - 1]) : null) : null;
    const nu = skewt ? num(g.nu) : null;
    const lam = skewt ? num(g.lambda) : null;
    push({
      key: "garch", title: "GARCH(1,1) skewed-t volatility", group: "volatility",
      status: fitted ? "ok" : g ? silence(g.status) : "unavailable",
      robustness: fitted ? (g.converged === false ? 1 : skewt ? 3 : 2) : 0,
      why: fitted ? (g.converged === false ? "the fit did not settle: " + (str(g.reason) || "reason unpublished")
        : skewt ? "a maximum-likelihood fit that converged on the year's returns"
        : "converged, but fitted before the skewed-t innovations; the next run refits it")
        : (g && str(g.reason)) || "no fit was published",
      say: fitted
        ? "Conditional volatility closed the fitted window at " + (last === null ? "an unpublished level" : last + "% annualised") +
          (num(g.nextVol) !== null ? ", one recursion step puts the next session at " + g.nextVol + "%" : "") +
          (num(g.longRunVol) !== null ? ", against a long-run level of " + g.longRunVol + "%" : "") +
          (nu !== null ? "; the fitted tail shape is " + g.nu : "") +
          (lam !== null ? " with skew " + lam + (lam < -0.05 ? " (heavier left tail)" : lam > 0.05 ? " (heavier right tail)" : " (no material skew)") : "") +
          (num(g.persistence) !== null ? "; persistence " + g.persistence : "") +
          (skewt ? "" : "; the innovation density on this card predates the skewed t") + "."
        : null,
      figures: fitted ? {
        lastVol: last, nextVol: num(g.nextVol), longRunVol: num(g.longRunVol), nu, lambda: lam,
        persistence: num(g.persistence), n: num(g.n), converged: g.converged !== false, skewt,
      } : {},
      reason: fitted ? null : (g && str(g.reason)) || null,
    });
  }

  if (stale === true) {
    for (const f of features) {
      if (f.robustness > 1) { f.robustness = 1; f.why = "capped: the card describes " + session + " and " + expected + " has closed since"; }
    }
  }

  const coverage = { features: features.length, read: 0, quiet: 0, withheld: 0, robust: 0, fair: 0, weak: 0 };
  for (const f of features) {
    if (f.status === "ok") coverage.read++;
    else if (f.status === "quiet") coverage.quiet++;
    else coverage.withheld++;
    if (f.robustness === 3) coverage.robust++;
    else if (f.robustness === 2) coverage.fair++;
    else if (f.robustness === 1) coverage.weak++;
  }

  return {
    version: NEURON_CONTEXT_VERSION,
    ticker: str(c.ticker),
    name: str(c.nm),
    sector: str(c.sector),
    sessionDate: session,
    expectedSession: expected,
    stale,
    depth: str(c.depth) || "board",
    generatedAt: str(c.generatedAt),
    features,
    coverage,
  };
}

function figureText(figures) {
  const parts = [];
  for (const [k, v] of Object.entries(figures || {})) {
    if (v === null || v === undefined) continue;
    parts.push(k + " " + (typeof v === "boolean" ? (v ? "yes" : "no") : String(v)));
  }
  return parts.length ? " Figures: " + parts.join(", ") + "." : "";
}

export function contextLines(context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  const lines = [];
  for (const f of ctx.features || []) {
    const head = "[" + f.key + "] " + f.title + " (" + (f.status === "ok" ? "read" : f.status) +
      "; robustness " + f.robustness + " of 3, " + f.why + ")";
    if (f.say) lines.push(head + ": " + f.say + figureText(f.figures));
    else lines.push(head + ": no reading" + (f.reason ? " — " + f.reason : "") + ".");
  }
  return lines;
}

export function contextFacts(context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  const t = ctx.ticker || "";
  const out = [];
  for (const f of ctx.features || []) {
    if (!f.say) continue;
    const words = String(f.title).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    out.push({
      id: "neuron:" + t + "/" + f.key,
      topic: [t, t.toLowerCase(), f.key.toLowerCase(), f.group, ...words],
      say: t + " — " + f.title + " (robustness " + f.robustness + " of 3): " + f.say,
      n: { robustness: f.robustness, ...(f.figures || {}) },
      source: "card:" + t,
      at: ctx.generatedAt || null,
    });
  }
  return out;
}

export function promptForNeuron(context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  const t = ctx.ticker || "this name";
  const lines = contextLines(ctx);
  const system = [
    "You are Neuron, the reader of one name's options card, " + t + ". You are given every " +
      "feature the card publishes, each with a robustness grade from 0 (withheld) to 3 (robust) " +
      "that was computed from the card's own coverage and quality fields. You write a short " +
      "summary and up to " + NEURON_MAX_IDEAS + " trade ideas, ranked by the robustness of the " +
      "features each idea rests on. You are the prose; the numbers are already decided.",
    "",
    "1. NEVER write a number that does not already appear, character for character, in the " +
      "context. Do not add, subtract, total, average, rank, round, convert a ratio into a " +
      "percentage, or turn a figure into millions. Counting the features is not permitted either.",
    "2. NEVER say what the market is going to do. Do not use the words will, should, expect, " +
      "expected, likely, going to, forecast or predict. An idea is a structure whose payoff is " +
      "conditional on a level the context already names; write it as 'pays if spot holds above " +
      "X' or 'is invalidated below X', never as a prediction.",
    "3. FOUR KINDS OF SILENCE ARE FOUR DIFFERENT FACTS: PENDING is not yet published, UNREADABLE " +
      "was published and could not be read, QUIET was measured and holds nothing, UNAVAILABLE was " +
      "published without this reading. Never call a name quiet because a feature is withheld.",
    "4. Every idea rests on at least two features, named by their bracketed keys, and its rank is " +
      "no higher than the lowest robustness among them. Prefer ideas that rest on robustness 3. " +
      "Never rest an idea on a feature with robustness 0.",
    "5. Every idea names an invalidation level that appears in the context (a wall, the gamma " +
      "flip, max pain, the priced range) and a horizon that appears in the context (an expiry, " +
      "the half-life, the priced-move sessions).",
    "6. The structure is one of: " + NEURON_STRUCTURES.join(", ") + ". 'no position' is a valid " +
      "idea when the features disagree; say which ones disagree.",
    "7. Units travel with numbers, in the context's own words. A capped list is not a population.",
    "",
    "Answer with ONE JSON object and nothing else, no code fence, in this shape: " +
      "{\"summary\": \"two or three plain sentences about " + t + "\", \"ideas\": [{\"title\": " +
      "\"short name\", \"structure\": \"one of the listed structures\", \"direction\": " +
      "\"bullish|bearish|neutral\", \"thesis\": \"one or two sentences quoting the readings\", " +
      "\"rests_on\": [\"key\", \"key\"], \"invalidation\": \"a level from the context and what " +
      "crossing it means\", \"horizon\": \"an expiry or session count from the context\"}]}",
  ].join("\n");
  const head = "Card for " + t + (ctx.name ? " (" + ctx.name + ")" : "") +
    (ctx.sector ? ", sector " + ctx.sector : "") +
    (ctx.sessionDate ? ", session " + ctx.sessionDate : "") +
    (ctx.stale === true ? ". STALE: " + ctx.expectedSession + " has closed since and this card does not describe it; every grade is capped at 1" : "") +
    ". Features with their robustness grades:";
  const user = head + "\n" + lines.map((l) => "- " + l).join("\n") +
    "\n\nRobustness legend: 3 robust, 2 fair, 1 weak, 0 withheld.";
  return { system, user };
}

export function parseNeuronOutput(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return null;
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const a = unfenced.indexOf("{"), b = unfenced.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let obj;
  try { obj = JSON.parse(unfenced.slice(a, b + 1)); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const summary = str(obj.summary);
  const ideas = Array.isArray(obj.ideas) ? obj.ideas : [];
  return { summary, ideas };
}

export function deterministicSummary(context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  const said = (ctx.features || [])
    .filter((f) => f.say && f.robustness >= 2)
    .sort((a, b) => b.robustness - a.robustness)
    .slice(0, 3)
    .map((f) => f.say);
  if (said.length) return said.join(" ");
  return "The card for " + (ctx.ticker || "this name") + " publishes no feature with a reading to lean on this session.";
}

export function vetIdeas(rawIdeas, context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  const byKey = new Map((ctx.features || []).map((f) => [f.key, f]));
  const facts = contextLines(ctx).map((say) => ({ say }));
  const kept = [];
  const refused = [];
  for (const idea of Array.isArray(rawIdeas) ? rawIdeas : []) {
    if (!idea || typeof idea !== "object") { refused.push("not an object"); continue; }
    const title = str(idea.title), thesis = str(idea.thesis);
    const structure = str(idea.structure) ? idea.structure.trim().toLowerCase() : null;
    const direction = str(idea.direction) ? idea.direction.trim().toLowerCase() : null;
    const invalidation = str(idea.invalidation), horizon = str(idea.horizon);
    const rests = Array.isArray(idea.rests_on) ? idea.rests_on.map((k) => String(k).trim()).filter(Boolean) : [];
    if (!title || !thesis || !structure || !invalidation || !horizon) { refused.push((title || "idea") + ": a field is missing"); continue; }
    if (!NEURON_STRUCTURES.includes(structure)) { refused.push(title + ": structure not in the list"); continue; }
    if (!["bullish", "bearish", "neutral"].includes(direction)) { refused.push(title + ": direction not bullish, bearish or neutral"); continue; }
    const feats = rests.map((k) => byKey.get(k)).filter(Boolean);
    if (feats.length < 2 || feats.length !== rests.length) { refused.push(title + ": rests on fewer than two known features"); continue; }
    const robustness = Math.min(...feats.map((f) => f.robustness));
    if (robustness < 1) { refused.push(title + ": rests on a withheld feature"); continue; }
    const text = [title, thesis, invalidation, horizon].join(" ");
    const verdict = guardAnswer(text, facts, { smallIntegers: false });
    if (!verdict.ok) { refused.push(title + ": " + (verdict.forecast ? "claims what happens next" : "names a figure the card does not carry")); continue; }
    kept.push({ title, structure, direction, thesis, invalidation, horizon, restsOn: rests, robustness,
      robustnessWord: ROBUSTNESS_WORD[robustness] });
  }
  kept.sort((a, b) => b.robustness - a.robustness);
  return { ideas: kept.slice(0, NEURON_MAX_IDEAS), refused };
}

export function contextFingerprint(context) {
  const joined = contextLines(context).join("\n");
  let h = 5381;
  for (let i = 0; i < joined.length; i++) h = (((h << 5) + h) ^ joined.charCodeAt(i)) >>> 0;
  return "n" + NEURON_CONTEXT_VERSION + "." + h.toString(36) + "." + (context && context.features ? context.features.length : 0);
}

export function publicContext(context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  return {
    version: ctx.version, ticker: ctx.ticker, sessionDate: ctx.sessionDate, expectedSession: ctx.expectedSession,
    stale: ctx.stale, depth: ctx.depth, coverage: ctx.coverage,
    features: (ctx.features || []).map((f) => ({
      key: f.key, title: f.title, group: f.group, status: f.status, robustness: f.robustness,
      robustnessWord: ROBUSTNESS_WORD[f.robustness], why: f.why,
    })),
  };
}

export function numeralsOf(context) {
  const set = new Set();
  for (const line of contextLines(context)) for (const t of numeralsIn(line)) set.add(t);
  return set;
}
