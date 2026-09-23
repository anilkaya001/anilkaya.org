import { TICKER_PANELS, SENTINEL_KEYS } from "./flows-panels.js";
import { guardAnswer, numeralsIn } from "./flows-ask.js";
import { VARIATION_VOTES, VARIATION_LINES } from "./flows-variation.js";
import { STRUCTURE_BY_ID } from "./flows-quant-structures.js";

export const NEURON_CONTEXT_VERSION = 3;
export const NEURON_MAX_IDEAS = 3;

const article = (noun, capital) => (/^[aeiou]/i.test(noun) ? (capital ? "An " : "an ") : (capital ? "A " : "a ")) + noun;

export const NEURON_STRUCTURES = Object.freeze([
  "long call", "long put", "call debit spread", "put debit spread", "call credit spread",
  "put credit spread", "iron condor", "long straddle", "long strangle", "calendar spread",
  "covered call", "collar", "no position",
]);
export const ROBUSTNESS_WORD = Object.freeze({ 0: "withheld", 1: "weak", 2: "fair", 3: "robust" });
export const STATE_VERSION = 1;
export const STATES = Object.freeze([
  "pinned", "amplifying", "squeeze", "transitional", "premium-rich", "premium-cheap", "undetermined",
]);
export const STATE_WORD = Object.freeze({
  pinned: "Pinned", amplifying: "Amplifying", squeeze: "Squeeze", transitional: "On the flip",
  "premium-rich": "Premium rich", "premium-cheap": "Premium cheap", undetermined: "Undetermined",
});
export const STATE_LINES = Object.freeze({
  SHARE_MARGINAL: 0.2, FLIP_ON_ATR: 0.5, FLIP_NEAR_ATR: 1.5, WALL_NEAR_ATR: 1.5, PAIN_NEAR_ATR: 0.5,
  PATH_ONE_SIDED: 0.65, AGGRESSOR_SHARE: 0.25, OI_SIDE_RATIO: 2, DISPLACEMENT_ATR: 0.5,
  SCORE_DEAD_BAND: 1, CONVICTION_FAIR: 50, SPLIT_MINORITY: 1 / 3,
  VRP_RELATIVE: 0.1, IV_RANK_HIGH: 0.7, IV_RANK_LOW: 0.2, IV_MOMENTUM_REL: 0.1,
  TERM_FRONT_BID_REL: 0.08, GARCH_GAP_REL: 0.12, FRONT_LOAD: 0.25, DRIFT_SD: VARIATION_LINES.DRIFT_SD,
});
const BY_PREMIUM = (rich, cheap, fair) => Object.freeze({ rich, cheap, fair });
export const STATE_STRUCTURES = Object.freeze({
  pinned: BY_PREMIUM(
    { preferred: ["iron condor", "call credit spread", "put credit spread", "covered call"], avoid: ["long straddle", "long strangle", "long call", "long put"] },
    { preferred: ["calendar spread", "covered call", "collar"], avoid: ["long straddle", "long strangle", "long call", "long put"] },
    { preferred: ["iron condor", "covered call", "call credit spread", "put credit spread"], avoid: ["long straddle", "long strangle", "long call", "long put"] }),
  bull: BY_PREMIUM(
    { preferred: ["put credit spread", "call debit spread"], avoid: ["iron condor", "call credit spread", "covered call", "long put", "put debit spread"] },
    { preferred: ["long call", "call debit spread", "put credit spread"], avoid: ["iron condor", "call credit spread", "covered call", "long put", "put debit spread"] },
    { preferred: ["call debit spread", "put credit spread"], avoid: ["iron condor", "call credit spread", "covered call", "long put", "put debit spread"] }),
  bear: BY_PREMIUM(
    { preferred: ["call credit spread", "put debit spread"], avoid: ["iron condor", "put credit spread", "long call", "call debit spread", "covered call"] },
    { preferred: ["long put", "put debit spread", "call credit spread"], avoid: ["iron condor", "put credit spread", "long call", "call debit spread", "covered call"] },
    { preferred: ["put debit spread", "call credit spread"], avoid: ["iron condor", "put credit spread", "long call", "call debit spread", "covered call"] }),
  shortNoSide: BY_PREMIUM(
    { preferred: ["no position", "long strangle"], avoid: ["iron condor", "covered call"] },
    { preferred: ["long straddle", "long strangle"], avoid: ["iron condor", "covered call"] },
    { preferred: ["long strangle", "no position"], avoid: ["iron condor", "covered call"] }),
  transitional: BY_PREMIUM(
    { preferred: ["calendar spread", "no position"], avoid: ["iron condor"] },
    { preferred: ["long straddle", "long strangle"], avoid: ["iron condor"] },
    { preferred: ["long strangle", "calendar spread", "no position"], avoid: ["iron condor"] }),
  "premium-rich": { preferred: ["iron condor", "call credit spread", "put credit spread", "covered call"], avoid: ["long straddle", "long strangle"] },
  "premium-cheap": { preferred: ["long straddle", "long strangle", "calendar spread"], avoid: ["iron condor"] },
  undetermined: { preferred: ["no position"], avoid: [] },
});

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
  gamma: ["spot", "flowPeakLong", "flowPeakShort", "strikes", "bandMin", "bandMax"],
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
  pricedMove: ["impliedMove", "impliedLow", "impliedHigh", "realizedMove", "sessions", "asOf",
    "vrpForward", "vrpForwardVar", "vrpForwardRel", "vrpTrailing", "rvForward", "richnessFrom"],
  context: ["r5", "r21", "r42", "week52Pos", "changePct"],
  congress: ["total", "buys", "sells", "medianLagDays"],
  marketRank: ["asOf"],
  darkpool: ["seen", "cap", "shed", "unpriced"],
  oiDeltas: ["seen", "cap", "shed"],
  volContext: [],
  variation: ["gammaPerSigma", "vannaPerPoint", "charmPerSession", "driftInSd", "gammaShare",
    "vannaShare", "crossShare", "sigmaSource", "advPct"],
};

function levelFigures(p) {
  const out = {};
  for (const lv of Array.isArray(p && p.levels) ? p.levels : []) {
    const kind = str(lv && lv.kind), px = num(lv && lv.px);
    if (!kind || px === null) continue;
    out[kind.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = px.toFixed(2);
  }
  return out;
}

function panelRobustness(key, group, p, card) {
  if (!p || typeof p !== "object") return { r: 0, why: "not published on this card" };
  if (p.status !== "ok") {
    return p.status === "quiet"
      ? { r: 1, why: "measured and empty: a reading, but nothing to lean on" }
      : { r: 0, why: silence(p.status) + (str(p.reason) ? ": " + p.reason : "") };
  }
  const conv = card.conv && typeof card.conv === "object" ? card.conv : {};
  switch (key) {
    case "gamma":
      return num(p.strikes) !== null && num(p.strikes) < 20
        ? { r: 1, why: "the ladder of gamma dealers added today rests on fewer than 20 strikes" }
        : { r: 2, why: "gamma dealers added today: one session's directionalized volume by strike, not the standing open-interest book" };
    case "levels": {
      const g = card.panels && card.panels.gamma && card.panels.gamma.status === "ok" ? card.panels.gamma : null;
      return g && num(g.strikes) !== null && num(g.strikes) < 20
        ? { r: 1, why: "the flow ladder beside the levels rests on fewer than 20 strikes" }
        : { r: 2, why: "the walls read off the open-interest book on their own side of spot, zero gamma off total gamma re-evaluated at hypothetical spots, the strike-sum crossing off today's flow ladder, max pain off the open-interest snapshot" };
    }
    case "surface":
      return num(p.clipped) > 0
        ? { r: 1, why: "the surface was clipped to its scale cap on some cells" }
        : { r: 2, why: "today's directionalized volume by strike and expiry, not standing open interest" };
    case "variation":
      return p.robustness && num(p.robustness.r) !== null
        ? { r: Math.max(0, Math.min(3, p.robustness.r)), why: str(p.robustness.why) || "graded by the hedging model" }
        : { r: 1, why: "the hedging panel published no grade" };
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

const f2 = (v) => (v === null ? null : v.toFixed(2));
const pct1 = (v) => (v === null ? null : (v * 100).toFixed(1));
const okPanel = (p) => p && typeof p === "object" && p.status === "ok";
const SIDE_WORD = { 1: "bullish", "-1": "bearish", 0: null };
const WALL_FOR = { 1: "call_wall", "-1": "put_wall" };

function magnitude(v) {
  const mag = Math.abs(v);
  return mag >= 1e6 ? (mag / 1e6).toFixed(2) + "M" : mag >= 1e3 ? (mag / 1e3).toFixed(1) + "k" : String(Math.round(mag));
}

const signedMoney = (v) => (v < 0 ? "\u2212$" : "+$") + magnitude(v);

export function gammaReading(card) {
  const c = card && typeof card === "object" ? card : {};
  const regime = c.regime && typeof c.regime === "object" ? c.regime : {};
  const P = c.panels && typeof c.panels === "object" ? c.panels : {};
  const flow = num(regime.flowGamma) !== null ? num(regime.flowGamma) : num(regime.netGamma);
  const from = str(regime.labelFrom);
  const value = num(regime.labelValue) !== null ? num(regime.labelValue)
    : from === "book" ? (num(regime.bookGammaRaw) !== null ? num(regime.bookGammaRaw) : num(regime.bookGamma))
      : from === "flow" ? flow : null;
  const label = value === null ? str(regime.label) : value >= 0 ? "long" : "short";
  if ((from === "book" || from === "flow") && value !== null) {
    if (from === "book") {
      const share = num(regime.bookShare);
      return {
        from: "book", label, value, strength: share === null ? null : Math.abs(share),
        sentence: "net dealer gamma across the open-interest book is " + label + ", " + signedMoney(value) + " per 1% move" +
          (share === null ? "" : " (" + Math.round(Math.abs(share) * 100) + "% of its gross)") +
          (flow !== null ? "; today\u2019s trading added " + signedMoney(flow) + ", read as flow and never as the book" : ""),
      };
    }
    const bars = okPanel(P.gamma) && !P.gamma.bucketed && Array.isArray(P.gamma.bars) ? P.gamma.bars : [];
    const gross = num(regime.flowGross) !== null ? num(regime.flowGross)
      : bars.reduce((a, b) => a + Math.abs(num(b && b.g) || 0), 0);
    const strength = gross > 0 ? Math.abs(value) / gross : null;
    return {
      from: "flow", label, value, strength,
      sentence: "the open-interest book is not on this card, so the label is the flow\u2019s: dealers added " +
        signedMoney(value) + " of gamma per 1% move today, " + label +
        (strength === null ? "" : " (" + Math.round(strength * 100) + "% of the ladder\u2019s gross)"),
    };
  }
  if (label === "long" || label === "short") {
    return { from: "label", label, value: null, strength: null,
      sentence: "the card labels dealer gamma " + label + " without the number it was read from" +
        (flow !== null ? "; today\u2019s trading added " + signedMoney(flow) + ", which is flow and is not read as the book" : "") };
  }
  const bookRaw = num(regime.bookGammaRaw);
  if (bookRaw !== null) {
    const lab = bookRaw >= 0 ? "long" : "short";
    return { from: "book", label: lab, value: bookRaw, strength: num(regime.bookShare) === null ? null : Math.abs(num(regime.bookShare)),
      sentence: "net dealer gamma across the open-interest book is " + lab + ", " + signedMoney(bookRaw) + " per 1% move" };
  }
  if (flow !== null) {
    const lab = flow >= 0 ? "long" : "short";
    return { from: "flow", label: lab, value: flow, strength: null,
      sentence: "the open-interest book is not on this card, so the label is the flow\u2019s: dealers added " + signedMoney(flow) + " of gamma per 1% move today, " + lab };
  }
  return { from: null, label: null, value: null, strength: null, sentence: null };
}

function hedgeDrivers(card) {
  const P = card.panels && typeof card.panels === "object" ? card.panels : {};
  const V = okPanel(P.variation) ? P.variation : null;
  if (!V) return [];
  const r = panelRobustness("variation", "convexity", V, card).r;
  const ch = V.channels && typeof V.channels === "object" ? V.channels : {};
  const out = [];
  const pctOf = (v) => (num(v) === null ? null : (Math.abs(v) * 100).toFixed(2) + "%");
  if (ch.charm && num(ch.charm.perSession) !== null) {
    const hedge = -ch.charm.perSession;
    const drift = V.variance ? num(V.variance.driftInSd) : null;
    const decisive = drift !== null && Math.abs(drift) >= STATE_LINES.DRIFT_SD;
    out.push({ key: "variation", robustness: r, weight: VARIATION_VOTES ? r : 0, vote: VARIATION_VOTES && decisive ? Math.sign(hedge) : 0, axis: "hedge",
      reading: "time alone moves dealer hedges to " + (hedge >= 0 ? "buy " : "sell ") + "$" + magnitude(hedge) + " over the session" +
        (pctOf(ch.charm.pctAdv) ? " (" + pctOf(ch.charm.pctAdv) + " of a typical day)" : "") +
        (drift === null ? "" : ", " + Math.abs(drift).toFixed(1) + " sd of the random part") +
        "; context only, with no vote until the drift sign's per-session IC clears a shuffled null" });
  }
  if (ch.gamma && num(ch.gamma.perSigma) !== null) {
    out.push({ key: "variation", sub: "gamma", robustness: r, weight: 0, vote: 0, axis: "hedge",
      reading: "a one-sigma rise has dealers " + (ch.gamma.perSigma > 0 ? "sell" : "buy") + " $" + magnitude(ch.gamma.perSigma) +
        (ch.gamma.source === "book" ? " on the open-interest book" : " on the gamma added today alone") });
  }
  if (ch.vanna && num(ch.vanna.perPoint) !== null) {
    out.push({ key: "vanna", robustness: r, weight: 0, vote: 0, axis: "hedge",
      reading: "dealer vanna nets to " + signedMoney(ch.vanna.perPoint) + " of delta per vol point across the live expiries (call \u2212 put)" +
        (num(ch.vanna.perSigma) !== null ? ", " + signedMoney(ch.vanna.perSigma) + " per one-sigma vol move" : "") });
  }
  if (ch.charm && num(ch.charm.perSession) !== null) {
    out.push({ key: "charm", robustness: r, weight: 0, vote: 0, axis: "hedge",
      reading: "dealer charm nets to " + signedMoney(ch.charm.perSession) + " of delta over the session across the expiries that outlive it (call \u2212 put)" });
  }
  return out;
}

function levelsOf(card) {
  const p = card.panels && card.panels.levels;
  if (!okPanel(p) || !Array.isArray(p.levels)) return { spot: null, atr: null, by: {}, list: [] };
  const by = {}, list = [];
  for (const lv of p.levels) {
    const kind = str(lv && lv.kind), px = num(lv && lv.px), distAtr = num(lv && lv.distAtr);
    if (!kind || px === null) continue;
    const row = { kind, label: str(lv.label) || kind, px, distAtr };
    by[kind] = row;
    list.push(row);
  }
  return { spot: num(p.spot), atr: num(p.atr), by, list };
}

function nearestLevel(list, side) {
  const cands = list.filter((l) => l.distAtr !== null && (side > 0 ? l.distAtr > 0 : l.distAtr < 0));
  cands.sort((a, b) => Math.abs(a.distAtr) - Math.abs(b.distAtr));
  return cands[0] || null;
}

function directionVotes(card) {
  const P = card.panels || {};
  const T = STATE_LINES;
  const votes = [];
  const add = (key, vote, weight, reading) => votes.push({ key, vote, weight, robustness: weight, reading, axis: "flow" });
  {
    const p = P.path;
    if (okPanel(p)) {
      const r = panelRobustness("path", "tape", p, card).r;
      const nd = num(p.netDelta), np = num(p.netPremium), pers = num(p.persistence), mins = num(p.minutes);
      const lead = nd !== null && nd !== 0 ? nd : np;
      if (nd !== null && np !== null && nd !== 0 && np !== 0 && Math.sign(nd) !== Math.sign(np)) {
        add("path", 0, r, "net delta " + (nd < 0 ? "\u2212" : "+") + magnitude(nd) + " and net premium " +
          (np < 0 ? "\u2212$" : "+$") + magnitude(np) + " carry opposite signs over " + mins + " minutes, so the session path casts no vote");
      } else if (lead !== null && lead !== 0 && pers !== null) {
        const oneSided = pers >= T.PATH_ONE_SIDED;
        add("path", oneSided ? Math.sign(lead) : 0, r,
          "net " + (lead > 0 ? "buying" : "selling") + " over " + mins + " minutes, " + Math.round(pers * 100) + "% of minutes with it" +
          (oneSided ? "" : " (under the " + Math.round(T.PATH_ONE_SIDED * 100) + "% one-sided line, so the path casts no vote)"));
      }
    }
  }
  {
    const p = P.aggressor;
    if (okPanel(p) && Array.isArray(p.bars)) {
      const r = panelRobustness("aggressor", "tape", p, card).r;
      const n = p.bars.reduce((a, b) => a + (num(b && b.net) || 0), 0);
      const gross = p.bars.reduce((a, b) => a + Math.abs(num(b && b.net) || 0), 0);
      if (n !== 0 && gross > 0) {
        const share = Math.abs(n) / gross;
        const decisive = share >= T.AGGRESSOR_SHARE;
        add("aggressor", decisive ? Math.sign(n) : 0, r,
          "the aggressor ladder nets " + magnitude(n) + " contracts to the " + (n > 0 ? "call" : "put") + " side across " +
          p.bars.length + " strikes, " + Math.round(share * 100) + "% of its gross imbalance" +
          (decisive ? "" : " (under the " + Math.round(T.AGGRESSOR_SHARE * 100) + "% line, so no vote)"));
      }
    }
  }
  {
    const p = P.oiDeltas;
    if (okPanel(p) && Array.isArray(p.rows)) {
      const r = panelRobustness("oiDeltas", "tape", p, card).r;
      let c = 0, pu = 0, cl = 0, pl = 0;
      for (const row of p.rows) {
        const d = num(row && row.diff); if (d === null) continue;
        if (row.cp === "C") { c += d; cl++; } else if (row.cp === "P") { pu += d; pl++; }
      }
      if (cl + pl > 0 && (c !== 0 || pu !== 0)) {
        const callSide = c > 0 && (pu <= 0 || c >= T.OI_SIDE_RATIO * pu);
        const putSide = pu > 0 && (c <= 0 || pu >= T.OI_SIDE_RATIO * c);
        add("oiDeltas", callSide ? 1 : putSide ? -1 : 0, r,
          "open interest " + (c >= 0 ? "grew +" : "fell \u2212") + magnitude(c) + " across " + cl + " call lines against " +
          (pu >= 0 ? "+" : "\u2212") + magnitude(pu) + " across " + pl + " put lines, one clearing day late" +
          (callSide || putSide ? "" : " (neither side twice the other, so no vote)"));
      }
    }
  }
  {
    const p = P.premiumTrack;
    if (okPanel(p)) {
      const r = panelRobustness("premiumTrack", "tape", p, card).r;
      const up = num(p.up), down = num(p.down), net = num(p.net);
      if (up !== null && down !== null && net !== null && net !== 0 && up + down >= 3) {
        const oneWay = up === 0 || down === 0;
        add("premiumTrack", oneWay ? Math.sign(net) : 0, r,
          "net premium ran " + (net < 0 ? "\u2212$" : "+$") + magnitude(net) + " over " + (up + down) + " priced sessions, " + up + " up and " + down + " down" +
          (oneWay ? "" : " (both signs present, so no vote)"));
      }
    }
  }
  {
    const s = num(card.score), conviction = num(card.conviction);
    if (s !== null && conviction !== null) {
      const decisive = Math.abs(s) > T.SCORE_DEAD_BAND && conviction >= T.CONVICTION_FAIR;
      add("standing", decisive ? Math.sign(s) : 0, 1,
        "the card scores " + (s < 0 ? "\u2212" : "+") + Math.abs(s) + " with conviction " + conviction + " of 100, a tie-breaker of weight 1" +
        (decisive ? "" : " (conviction under " + T.CONVICTION_FAIR + " or inside the dead band, so no vote)"));
    }
  }
  const primary = votes.filter((v) => v.vote !== 0 && v.weight > 0 && v.key !== "standing");
  const tied = primary.reduce((a, v) => a + v.vote * v.weight, 0) === 0;
  const cast = tied ? votes.filter((v) => v.vote !== 0 && v.weight > 0) : primary;
  const total = cast.reduce((a, v) => a + v.weight, 0);
  const sum = cast.reduce((a, v) => a + v.vote * v.weight, 0);
  const direction = total === 0 ? 0 : Math.sign(sum);
  const minority = total === 0 ? 0 : cast.filter((v) => v.vote !== direction).reduce((a, v) => a + v.weight, 0) / total;
  return { votes, direction, split: total > 0 && minority >= T.SPLIT_MINORITY, minority };
}

function premiumAxis(card) {
  const P = card.panels || {};
  const T = STATE_LINES;
  const drivers = [];
  let reading = null, base = 0;
  const pm = P.pricedMove;
  if (okPanel(pm) && pm.richness === "event-pinned") {
    const r = panelRobustness("pricedMove", "volatility", pm, card).r;
    const pin = pm.pin && typeof pm.pin === "object" ? pm.pin : {};
    drivers.push({ key: "pricedMove", robustness: r, weight: 0, axis: "premium", vote: 0,
      reading: pct1(num(pm.iv30)) + "% implied against " + pct1(num(pm.rv30)) + "% realised" +
        (num(pin.weekAgoIv) !== null ? ", down from " + pct1(num(pin.weekAgoIv)) + "% a week ago" : "") +
        (num(pin.lastRange) !== null ? ", on a last session that traded a " + (num(pin.lastRange) * 100).toFixed(2) + "% range" : "") +
        ": the price is pinned by an event, so realised volatility is not the yardstick and premium is read as neither rich nor cheap" });
    return { reading: "fair", robustness: r, drivers, pinned: true };
  }
  if (okPanel(pm)) {
    const r = panelRobustness("pricedMove", "volatility", pm, card).r;
    const iv = num(pm.iv30), rv = num(pm.rv30), rf = num(pm.rvForward);
    const fwdGrade = num(pm.rvForwardGrade);
    const forward = pm.richnessFrom === "forward" && iv !== null && rf !== null && rf > 0;
    const legacyVrp = num(pm.vrp);
    const trailing = num(pm.vrpTrailing) !== null ? num(pm.vrpTrailing) : legacyVrp;
    const base0 = forward ? rf : rv;
    const gap = forward ? iv - rf : trailing;
    if (iv !== null && base0 !== null && base0 > 0 && gap !== null) {
      const rel = gap / base0;
      reading = rel >= T.VRP_RELATIVE ? "rich" : rel <= -T.VRP_RELATIVE ? "cheap" : "fair";
      base = forward ? Math.min(r, fwdGrade === null ? r : fwdGrade) : Math.min(r, 1);
      drivers.push({ key: "pricedMove", robustness: base, weight: base, axis: "premium", vote: reading === "rich" ? 1 : reading === "cheap" ? -1 : 0,
        reading: forward
          ? pct1(iv) + "% implied against a GARCH forecast of " + pct1(rf) + "% realised over the next 21 sessions, a forward premium of " +
            (gap >= 0 ? "+" : "\u2212") + Math.abs(gap * 100).toFixed(1) + " points, " + (num(pm.vrpForwardVar) !== null ? (pm.vrpForwardVar >= 0 ? "+" : "\u2212") + Math.abs(pm.vrpForwardVar).toFixed(4) + " in variance, " : "") +
            (rel >= 0 ? "+" : "\u2212") + Math.abs(rel * 100).toFixed(0) + "% of the forecast; the line is \u00b1" + Math.round(T.VRP_RELATIVE * 100) + "%" +
            (trailing !== null && rv !== null ? " (against the trailing 21 sessions' " + pct1(rv) + "% the gap is " + (trailing >= 0 ? "+" : "\u2212") + Math.abs(trailing * 100).toFixed(1) + " points, shown and not voted)" : "")
          : pct1(iv) + "% implied against " + pct1(rv) + "% realised over the trailing 21 sessions, a backward-looking premium of " +
            (gap >= 0 ? "+" : "\u2212") + Math.abs(gap * 100).toFixed(1) + " points (" + (rel >= 0 ? "+" : "\u2212") + Math.abs(rel * 100).toFixed(0) +
            "% of realised; the line is \u00b1" + Math.round(T.VRP_RELATIVE * 100) + "%): no graded forward forecast was available, so it votes weakly" });
      const rank = num(pm.ivRank);
      if (rank !== null) {
        const v = rank >= T.IV_RANK_HIGH ? 1 : rank <= T.IV_RANK_LOW ? -1 : 0;
        drivers.push({ key: "pricedMove", sub: "ivRank", robustness: r, weight: v === 0 ? 0 : 1, axis: "premium", vote: v,
          reading: "IV rank " + Math.round(rank * 100) + "% of its own year" + (v > 0 ? ", in the top band" : v < 0 ? ", in the bottom band" : ", mid-range") });
      }
      const mom = num(pm.ivMomentum);
      const momRel = mom !== null && iv > 0 ? mom / iv : null;
      if (momRel !== null && Math.abs(momRel) >= T.IV_MOMENTUM_REL) {
        drivers.push({ key: "pricedMove", sub: "ivMomentum", robustness: r, weight: 1, axis: "premium", vote: mom > 0 ? 1 : -1,
          reading: "implied volatility " + (mom > 0 ? "rose" : "fell") + " " + Math.abs(mom * 100).toFixed(1) + " points over the week, " +
            Math.round(Math.abs(momRel) * 100) + "% of its own level (the line is " + Math.round(T.IV_MOMENTUM_REL * 100) + "%)" });
      }
    }
  }
  const vc = P.volContext;
  if (okPanel(vc) && vc.term && vc.term.status === "ok" && Array.isArray(vc.term.rows)) {
    const rows = vc.term.rows.filter((x) => x && num(x.vol) !== null && str(x.expiry));
    if (rows.length >= 2) {
      const f = rows[0], b = rows[rows.length - 1];
      const d = f.vol - b.vol;
      const rel = b.vol > 0 ? d / b.vol : null;
      if (rel !== null && Math.abs(rel) >= T.TERM_FRONT_BID_REL) {
        drivers.push({ key: "volContext", robustness: panelRobustness("volContext", "volatility", vc, card).r, weight: 1, axis: "premium", vote: d > 0 ? 1 : 0,
          reading: (d > 0 ? "the front is bid: " : "the back is bid: ") + pct1(f.vol) + "% at " + f.expiry + " against " + pct1(b.vol) + "% at " + b.expiry +
            ", " + Math.round(Math.abs(rel) * 100) + "% of the back's level" });
      }
    }
  }
  const ctx = P.context;
  const g = okPanel(ctx) && ctx.garch && typeof ctx.garch === "object" && ctx.garch.status === "ok" ? ctx.garch : null;
  if (g && okPanel(pm) && num(pm.iv30) !== null) {
    const last = num(g.lastVol) !== null ? num(g.lastVol)
      : Array.isArray(g.condVol) && g.condVol.length ? num(g.condVol[g.condVol.length - 1]) : null;
    const avg = num(g.avg21Vol);
    const model = avg !== null ? avg : num(g.nextVol) !== null ? num(g.nextVol) : last;
    if (model !== null && model > 0) {
      const gap = num(pm.iv30) * 100 - model;
      const rel = gap / model;
      const wide = Math.abs(rel) >= T.GARCH_GAP_REL;
      drivers.push({ key: "garch", robustness: g.converged === false ? 1 : g.dist === "skewt" ? 3 : 2, weight: wide ? 1 : 0, axis: "premium",
        vote: wide ? Math.sign(gap) : 0,
        reading: (avg !== null ? "the GARCH average over the next 21 sessions is " : "the GARCH one-step level is ") + model.toFixed(1) +
          "% against " + pct1(num(pm.iv30)) + "% implied over 30 days, a gap of " + Math.round(Math.abs(rel) * 100) +
          "% of the model (the line is " + Math.round(T.GARCH_GAP_REL * 100) + "%)" +
          (g.dist === "skewt" ? "" : " (fitted before the skewed t)") });
    }
  }
  return { reading, robustness: base, drivers };
}

function stateBrief(s, ticker) {
  const t = ticker || "this name";
  if (s.state === "undetermined") return "The greeks imply no state for " + t + ": " + (s.notes[0] || "no reading") + ".";
  const pos = s.drivers.filter((d) => d.axis === "positioning" && !d.sub).map((d) => d.reading);
  const head = "The greeks imply " + (s.state === "transitional" ? "a transitional state on the flip" : "a" + (/^[aeiou]/.test(s.state) ? "n " : " ") + s.state.replace("-", " ") + " state") +
    " for " + t + (s.flow ? " with flow " + s.flow : "") + " (confidence " + s.confidence + " of 3)";
  return head + (pos.length ? ": " + pos.join("; ") : "") + ". Preferred structures: " + s.preferred.join(", ") +
    (s.invalidation ? "; the state ends past the " + s.invalidation.label.toLowerCase() + " at " + f2(s.invalidation.px) : "") + ".";
}

export function stateSentence(s, ticker) {
  const t = ticker || "this name";
  if (s.state === "undetermined") return "IMPLIED STATE for " + t + ": undetermined (" + (s.notes[0] || "no reading") + "). Preferred structures: no position.";
  const parts = [];
  const pick = (axis, test) => s.drivers.filter((d) => d.axis === axis && (!test || test(d))).map((d) => d.reading);
  const pos = pick("positioning"), dir = pick("flow", (d) => d.vote !== 0), abst = pick("flow", (d) => d.vote === 0);
  const prem = pick("premium", (d) => d.weight > 0), hz = pick("horizon");
  parts.push("IMPLIED STATE for " + t + ": " + STATE_WORD[s.state].toLowerCase() + (s.flow ? ", flow " + s.flow : "") +
    " (confidence " + s.confidence + " of 3" + (s.stale ? ", capped: the card is behind the last closed session" : "") + ").");
  if (pos.length) parts.push("Positioning: " + pos.join("; ") + ".");
  if (dir.length) parts.push("Flow: " + dir.join("; ") + ".");
  if (abst.length) parts.push("Abstaining: " + abst.join("; ") + ".");
  parts.push("Premium is " + (s.premium || "unreadable") + (prem.length ? ": " + prem.join("; ") : "") + ".");
  if (hz.length) parts.push("Calendar: " + hz.join("; ") + ".");
  const hedge = pick("hedge");
  if (hedge.length) parts.push("Hedging: " + hedge.join("; ") + ".");
  if (s.notes.length) parts.push("Note: " + s.notes.join("; ") + ".");
  if (s.invalidation) parts.push("The state ends past the " + s.invalidation.label.toLowerCase() + " at " + f2(s.invalidation.px) + ".");
  if (s.horizon) {
    parts.push("Horizon: " + (s.horizon.kind === "priced_sessions"
      ? s.horizon.value + " sessions, the priced-move window" + (s.horizon.low !== null && s.horizon.high !== null ? " " + f2(s.horizon.low) + " to " + f2(s.horizon.high) : "")
      : s.horizon.value + (s.horizon.days !== null ? ", " + s.horizon.days + " days out" : "") +
        (s.horizon.kind === "half_life_expiry" ? ", where half the book\u2019s gamma has expired" : "")) + ".");
  }
  parts.push("Preferred structures: " + s.preferred.join(", ") + "." + (s.avoid.length ? " Avoid: " + s.avoid.join(", ") + "." : ""));
  return parts.join(" ");
}

export function stateChip(s) {
  const T = STATE_LINES;
  const flow = s.flow ? ", flow " + s.flow : "";
  if (s.state === "pinned") return STATE_WORD.pinned + " \u00b7 long gamma " + (s.gammaFrom === "flow" ? "in today\u2019s flow" : "in the book") + (s.target ? ", max pain " + f2(s.target.px) : "") + flow;
  if ((s.state === "squeeze" || s.state === "amplifying") && s.gammaFrom === "flow") return STATE_WORD[s.state] + " \u00b7 short gamma in today\u2019s flow" + (s.direction ? ", flow " + s.direction : ", flow undecided");
  if (s.state === "squeeze") return STATE_WORD.squeeze + " \u00b7 short gamma, flow " + s.direction + " toward the " + s.target.label.toLowerCase() + " " + f2(s.target.px);
  if (s.state === "amplifying") return STATE_WORD.amplifying + " \u00b7 short gamma" + (s.direction ? ", flow " + s.direction : ", flow undecided") + (s.bound ? ", to the flip " + f2(s.bound.px) : "");
  if (s.state === "transitional") return STATE_WORD.transitional + " \u00b7 " + (s.invalidation ? f2(s.invalidation.px) + " " : "") + "inside " + T.FLIP_ON_ATR + " ATR" + flow;
  if (s.state === "premium-rich" || s.state === "premium-cheap") return STATE_WORD[s.state] + " \u00b7 positioning withheld" + flow;
  return STATE_WORD.undetermined + " \u00b7 " + (s.notes[0] || "no reading");
}

export function regimeState(card, extras) {
  const c = card && typeof card === "object" ? card : {};
  const x = extras && typeof extras === "object" ? extras : {};
  const P = c.panels && typeof c.panels === "object" ? c.panels : {};
  const T = STATE_LINES;
  const session = str(c.sessionDate), expected = str(x.expectedSession);
  const stale = session !== null && expected !== null ? session < expected : false;
  const drivers = [];
  const notes = [];
  const gammaR = panelRobustness("gamma", "convexity", P.gamma, c);
  const levelsR = panelRobustness("levels", "convexity", P.levels, c);
  const regime = c.regime && typeof c.regime === "object" ? c.regime : {};
  const L = levelsOf(c);
  const flip = L.by.zero_gamma || null;
  const votes = directionVotes(c);
  const premium = premiumAxis(c);
  const prem = premium.reading || "fair";
  const flow = SIDE_WORD[String(votes.direction)];
  const silenceOf = (p) => (p && typeof p === "object" ? silence(p.status) : "unavailable");
  let state = "undetermined", direction = null, confidence = 0, invalidation = null, horizon = null, target = null, bound = null;
  const read = gammaReading(c);
  const label = read.label;
  const share = num(regime.spotGammaShare);
  const gammaDriverR = read.from === "book" ? 3 : read.from === "flow" ? 1 : read.from === "label" ? 1 : 0;
  const gammaOk = gammaDriverR > 0 && (read.from === "book" || (okPanel(P.gamma) && gammaR.r > 0)) &&
    (label === "long" || label === "short");
  const levelsOk = okPanel(P.levels) && levelsR.r > 0;
  const cal = okPanel(P.calendar) ? P.calendar : null;
  const front = cal && Array.isArray(cal.schedule) && cal.schedule[0] && str(cal.schedule[0].expiry) ? cal.schedule[0] : null;
  const pm = okPanel(P.pricedMove) ? P.pricedMove : null;
  const pricedHorizon = pm && num(pm.sessions) !== null
    ? { kind: "priced_sessions", value: num(pm.sessions), low: num(pm.impliedLow), high: num(pm.impliedHigh), days: null } : null;

  if (gammaOk) {
    const strong = read.strength !== null && read.strength >= T.SHARE_MARGINAL;
    const flipAtr = flip ? flip.distAtr : null;
    const onFlip = flipAtr !== null && Math.abs(flipAtr) < T.FLIP_ON_ATR;
    const nearFlip = flipAtr !== null && Math.abs(flipAtr) >= T.FLIP_ON_ATR && Math.abs(flipAtr) < T.FLIP_NEAR_ATR;
    drivers.push({ key: "gamma", robustness: gammaDriverR, weight: gammaDriverR, axis: "positioning",
      reading: read.sentence + (read.strength === null ? "" : strong ? ""
          : " (under the " + Math.round(T.SHARE_MARGINAL * 100) + "% line, marginal)") +
        (share === null ? "" : "; the strike ladder's running sum below spot sits at " +
          (share < 0 ? "\u2212" : "") + Math.round(Math.abs(share) * 100) + "% of its peak") +
        (num(regime.crossings) === null ? "" : regime.crossings === 0 ? "; the ladder does not change sign across the window"
          : "; the ladder changes sign " + regime.crossings + " time" + (regime.crossings === 1 ? "" : "s")) });
    if (levelsOk && flip && flipAtr !== null) {
      drivers.push({ key: "levels", robustness: levelsR.r, weight: levelsR.r, axis: "positioning",
        reading: "total dealer gamma, re-evaluated at hypothetical spots, changes sign at " + f2(flip.px) + ", " + Math.abs(flipAtr).toFixed(2) + " ATR " + (flipAtr >= 0 ? "above" : "below") + " spot " + f2(L.spot) +
          (onFlip ? " (inside " + T.FLIP_ON_ATR + " ATR: spot sits on the crossing)" : nearFlip ? " (inside " + T.FLIP_NEAR_ATR + " ATR)" : "") });
    } else if (levelsOk && num(regime.bandMin) !== null && num(regime.bandMax) !== null) {
      drivers.push({ key: "levels", robustness: levelsR.r, weight: levelsR.r, axis: "positioning",
        reading: "no zero-gamma level was resolved on this card; the flow ladder read over " + f2(num(regime.bandMin)) + " to " + f2(num(regime.bandMax)) +
          (num(regime.crossings) === 0 ? " never changes sign" : " is not the book") + ", so the " + label + " side is read from the " + (read.from === "book" ? "book" : "flow") });
    }
    const base = levelsOk ? Math.min(gammaDriverR, levelsR.r) : Math.min(gammaDriverR, 2);
    if (onFlip) {
      state = "transitional";
      direction = flow;
      confidence = base;
      invalidation = { kind: "zero_gamma", px: flip.px, label: "Zero-gamma level" };
      horizon = front ? { kind: "expiry", value: front.expiry, days: num(front.days) } : pricedHorizon;
    } else if (label === "long") {
      state = "pinned";
      direction = null;
      confidence = base - (strong ? 0 : 1) - (nearFlip ? 1 : 0);
      const pain = L.by.max_pain || null;
      target = pain && pain.distAtr !== null && Math.abs(pain.distAtr) <= T.PAIN_NEAR_ATR ? { kind: "max_pain", px: pain.px, label: "Max pain", distAtr: pain.distAtr } : null;
      const wall = L.list.filter((l) => l.kind === "call_wall" || l.kind === "put_wall").sort((a, b) => Math.abs(a.distAtr) - Math.abs(b.distAtr))[0] || null;
      invalidation = flip ? { kind: "zero_gamma", px: flip.px, label: "Zero-gamma level" } : wall ? { kind: wall.kind, px: wall.px, label: wall.label } : null;
      horizon = cal && num(cal.frontLoad) !== null && cal.frontLoad >= T.FRONT_LOAD && front
        ? { kind: "expiry", value: front.expiry, days: num(front.days) }
        : cal && str(cal.halfLifeExpiry) ? { kind: "half_life_expiry", value: cal.halfLifeExpiry, days: num(cal.halfLifeDays) } : pricedHorizon;
      if (target) {
        drivers.push({ key: "levels", sub: "max_pain", robustness: levelsR.r, weight: levelsR.r, axis: "positioning",
          reading: "max pain at " + f2(pain.px) + " sits " + Math.abs(pain.distAtr).toFixed(2) + " ATR " + (pain.distAtr >= 0 ? "above" : "below") + " spot, inside the " + T.PAIN_NEAR_ATR + " ATR pin band" });
      }
    } else {
      const d = votes.direction;
      direction = flow;
      const wall = d === 0 ? null : L.by[WALL_FOR[String(d)]] || null;
      const wallAhead = wall && wall.distAtr !== null && Math.sign(wall.distAtr) === d && Math.abs(wall.distAtr) <= T.WALL_NEAR_ATR;
      const flipBetween = flip && flipAtr !== null && Math.sign(flipAtr) === d && wall && wall.distAtr !== null &&
        Math.sign(wall.distAtr) === d && Math.abs(flipAtr) < Math.abs(wall.distAtr);
      if (d !== 0 && wallAhead && !flipBetween) {
        state = "squeeze";
        target = { kind: wall.kind, px: wall.px, label: wall.label, distAtr: wall.distAtr };
        drivers.push({ key: "levels", sub: wall.kind, robustness: levelsR.r, weight: levelsR.r, axis: "positioning",
          reading: "the " + wall.label.toLowerCase() + " at " + f2(wall.px) + " sits " + Math.abs(wall.distAtr).toFixed(2) + " ATR " + (wall.distAtr > 0 ? "above" : "below") +
            " spot, in the direction the flow leans, with no sign change between" });
      } else {
        state = "amplifying";
        if (flipBetween) {
          bound = { kind: "zero_gamma", px: flip.px, label: "Zero-gamma level", distAtr: flipAtr };
          notes.push("the flip at " + f2(flip.px) + " lies between spot and the " + wall.label.toLowerCase() + " at " + f2(wall.px) + ", so the short-gamma zone ends before the wall");
        }
      }
      const opp = d === 0 ? null : nearestLevel(L.list, -d);
      invalidation = opp ? { kind: opp.kind, px: opp.px, label: opp.label, distAtr: opp.distAtr }
        : flip ? { kind: "zero_gamma", px: flip.px, label: "Zero-gamma level" } : null;
      horizon = pricedHorizon || (front ? { kind: "expiry", value: front.expiry, days: num(front.days) } : null);
      confidence = base - (strong ? 0 : 1) - (nearFlip ? 1 : 0) - (d !== 0 && votes.split ? 1 : 0);
      if (d === 0) confidence = Math.min(confidence, 1);
    }
    if (cal && front && num(cal.frontLoad) !== null) {
      drivers.push({ key: "calendar", robustness: panelRobustness("calendar", "convexity", cal, c).r, weight: 1, axis: "horizon",
        reading: Math.round(cal.frontLoad * 100) + "% of the book\u2019s gamma expires at " + front.expiry + (num(front.days) !== null ? ", " + front.days + " days out" : "") +
          (str(cal.halfLifeExpiry) ? "; half of it by " + cal.halfLifeExpiry : "") });
    }
    for (const v of votes.votes) drivers.push(v);
  } else if (premium.reading === "rich" || premium.reading === "cheap") {
    state = "premium-" + premium.reading;
    direction = flow;
    const against = premium.reading === "rich" ? 1 : -1;
    confidence = premium.robustness - (premium.drivers.some((d) => d.weight > 0 && d.vote !== 0 && d.vote !== against) ? 1 : 0);
    const end = votes.direction < 0 ? { kind: "priced_low", px: num(pm.impliedLow) } : { kind: "priced_high", px: num(pm.impliedHigh) };
    invalidation = end.px === null ? null : { ...end, label: "Priced range end" };
    horizon = premium.reading === "rich" && cal && str(cal.halfLifeExpiry)
      ? { kind: "half_life_expiry", value: cal.halfLifeExpiry, days: num(cal.halfLifeDays) } : pricedHorizon;
    for (const v of votes.votes) drivers.push(v);
    notes.push("gamma positioning is " + silenceOf(P.gamma) + ", so the state is read from premium alone");
  } else {
    notes.push("gamma positioning is " + silenceOf(P.gamma) + " and premium is " + (premium.reading || "unreadable") + ", so no state is implied");
  }
  for (const d of premium.drivers) drivers.push(d);
  {
    const p = P.displacement;
    const g = okPanel(p) ? num(p.gapAtr) : null;
    if (g !== null) {
      drivers.push({ key: "displacement", robustness: panelRobustness("displacement", "convexity", p, c).r, weight: 0, vote: 0, axis: "horizon",
        reading: "today\u2019s flow builds gamma " + Math.abs(g).toFixed(2) + " ATR " + (g > 0 ? "above" : g < 0 ? "below" : "on") +
          " the standing book; buying and selling at the same strikes move it alike, so it places the flow and casts no vote" });
    }
  }
  for (const d of hedgeDrivers(c)) drivers.push(d);
  if (stale) confidence = Math.min(confidence, 1);
  confidence = Math.max(0, Math.min(3, confidence));
  if (state === "undetermined") confidence = 0;
  const table = state === "pinned" ? STATE_STRUCTURES.pinned[prem]
    : state === "squeeze" || state === "amplifying"
      ? (direction === "bullish" ? STATE_STRUCTURES.bull[prem] : direction === "bearish" ? STATE_STRUCTURES.bear[prem] : STATE_STRUCTURES.shortNoSide[prem])
      : state === "transitional" ? STATE_STRUCTURES.transitional[prem] : STATE_STRUCTURES[state];
  const pinnedOut = premium.pinned ? ["long straddle", "long strangle"] : [];
  const preferred = table.preferred.filter((x) => !(direction && state === "transitional" && x === "no position") && !pinnedOut.includes(x));
  if (state === "transitional" && direction) preferred.push(direction === "bullish" ? "call debit spread" : "put debit spread");
  if (!preferred.length) preferred.push("no position");
  if (premium.pinned) notes.push("the priced move reads as pinned by an event, so no long-volatility structure is preferred");
  const out = {
    version: STATE_VERSION, state, direction, flow, confidence, premium: premium.pinned ? "pinned" : premium.reading,
    gammaFrom: read.from, gammaLabel: read.label, gammaValue: num(read.value),
    drivers: drivers.filter((d) => d.robustness > 0), invalidation, horizon, target, bound,
    preferred, avoid: [...new Set([...table.avoid, ...pinnedOut])], stale, notes,
  };
  out.chip = stateChip(out);
  out.brief = stateBrief(out, str(c.ticker));
  return out;
}

export function stateIdea(context) {
  const ctx = context && typeof context === "object" ? context : {};
  const s = ctx.state && typeof ctx.state === "object" ? ctx.state : null;
  if (!s || s.state === "undetermined" || s.confidence < 1 || !s.invalidation || !s.horizon) return null;
  const voting = s.drivers.filter((d) => d.robustness >= 1 && d.axis === "flow" && d.vote !== 0);
  const flowKeys = voting.filter((d) => d.key !== "standing" || voting.length === 1).map((d) => d.key);
  const rests = ["state", ...new Set([
    ...s.drivers.filter((d) => d.robustness >= 1 && d.axis === "positioning").map((d) => d.key),
    ...flowKeys,
    ...s.drivers.filter((d) => d.robustness >= 1 && d.axis === "premium" && d.key === "pricedMove" && d.weight > 0).map((d) => d.key),
  ])].slice(0, 6);
  if (rests.length < 2) return null;
  const structure = s.preferred[0];
  const sides = IDEA_SIDES[structure] || ["neutral"];
  const direction = s.direction && sides.includes(s.direction) ? s.direction : sides[0];
  const pick = (axis, test, cap) => s.drivers.filter((d) => d.axis === axis && (!test || test(d))).slice(0, cap).map((d) => d.reading);
  const pos = pick("positioning", (d) => !d.sub, 2);
  const dir = pick("flow", (d) => d.vote !== 0 && flowKeys.includes(d.key), 2);
  const prem = s.drivers.find((d) => d.axis === "premium" && d.key === "pricedMove" && !d.sub);
  const level = "the " + s.invalidation.label.toLowerCase() + " at " + f2(s.invalidation.px);
  const word = STATE_WORD[s.state].toLowerCase();
  const read = pos.join("; ") + (dir.length ? "; " + dir.join("; ") : "") + (prem ? "; premium is " + s.premium + ", " + prem.reading : "");
  const volLong = structure === "long straddle" || structure === "long strangle";
  const range = s.horizon.kind === "priced_sessions" && s.horizon.low !== null && s.horizon.high !== null
    ? "the priced range " + f2(s.horizon.low) + " to " + f2(s.horizon.high) : null;
  const payoff = structure === "no position"
    ? " The flow features do not agree on a side, so no position is the reading until spot closes beyond " + level + "."
    : volLong
      ? " " + article(structure, true) + " pays if spot closes " + (range ? "outside " + range : "beyond " + level + " in either direction") +
        "; it loses if spot holds " + (range ? "inside it" : "at " + level) + " through the horizon."
      : " " + article(structure, true) + " pays if spot " + (direction === "bullish" ? "holds above " + level
        : direction === "bearish" ? "holds below " + level
          : "stays inside the priced range, with " + level + " as the line that ends the state") + ".";
  return {
    title: STATE_WORD[s.state] + " " + structure,
    structure, direction,
    thesis: "The greeks imply " + word + (s.flow ? " with flow " + s.flow : "") + ": " + read + "." + payoff,
    rests_on: rests,
    invalidation: volLong
      ? (range ? "spot held inside " + range + " through the horizon" : "spot held at " + level + " through the horizon")
      : "a close " + (direction === "bullish" ? "below " : direction === "bearish" ? "above " : "beyond ") + level,
    horizon: s.horizon.kind === "priced_sessions" ? s.horizon.value + " sessions" : String(s.horizon.value),
    fromState: true,
  };
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
  const standingGamma = gammaReading(c);

  const features = [];
  const push = (f) => { features.push(f); return f; };

  {
    const gate = num(conv.gate), cover = num(conv.coverage);
    let r = 1, why = "conviction below 50 of 100";
    if (conviction === null) {
      why = "conviction unpublished";
    } else if (conviction >= 75 && gate !== null && gate >= 1 && cover !== null && cover >= 0.8) {
      r = 3; why = "conviction at or above 75 with the quality gate cleared and coverage above 0.8";
    } else if (conviction >= 75) {
      r = 2; why = gate === null || gate < 1 ? "conviction at or above 75 but the quality gate is below one"
        : "conviction at or above 75 but coverage is below 0.8";
    } else if (conviction >= 50) {
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
          (standingGamma.label ? (standingGamma.from === "book" ? "; dealer gamma across the open-interest book is "
            : standingGamma.from === "flow" ? "; the gamma dealers added today is " : "; dealer gamma is labelled ") + standingGamma.label : "") +
          (num(c.zeroGamma) !== null ? "; total dealer gamma changes sign at " + r2(c.zeroGamma) : "") +
          (num(c.strikeSumCrossing) !== null ? "; the flow ladder's strike-sum crossing is at " + r2(c.strikeSumCrossing) : "") +
          (num(c.atr) !== null ? "; one ATR is " + r2(c.atr) : "") + ".",
      figures: {
        score, conviction, regime: standingGamma.label, regimeFrom: standingGamma.from,
        zeroGamma: r2(num(c.zeroGamma)), strikeSumCrossing: r2(num(c.strikeSumCrossing)), atr: r2(num(c.atr)),
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
      figures: ok ? { ...scalarFigures(p, FIGURE_KEYS[spec.key] || []), ...(spec.key === "levels" ? levelFigures(p) : {}) } : {},
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
          (num(g.avg21Vol) !== null ? ", averaging " + g.avg21Vol + "% over the next 21 sessions" : "") +
          (num(g.longRunVol) !== null ? ", against a long-run level of " + g.longRunVol + "%" : "") +
          (nu !== null ? "; the fitted tail shape is " + g.nu : "") +
          (lam !== null ? " with skew " + lam + (lam < -0.05 ? " (heavier left tail)" : lam > 0.05 ? " (heavier right tail)" : " (no material skew)") : "") +
          (num(g.persistence) !== null ? "; persistence " + g.persistence : "") +
          (skewt ? "" : "; the innovation density on this card predates the skewed t") + "."
        : null,
      figures: fitted ? {
        lastVol: last, nextVol: num(g.nextVol), avg21Vol: num(g.avg21Vol), longRunVol: num(g.longRunVol), nu, lambda: lam,
        persistence: num(g.persistence), n: num(g.n), converged: g.converged !== false, skewt,
      } : {},
      reason: fitted ? null : (g && str(g.reason)) || null,
    });
  }

  const state = regimeState(c, { expectedSession: expected });
  {
    const named = state.drivers.filter((d) => d.robustness > 0 && (d.axis === "positioning" || (d.axis === "flow" && d.vote !== 0))).map((d) => d.key);
    const on = state.state !== "undetermined";
    push({
      key: "state", title: "Implied state", group: "signal",
      status: on ? "ok" : "unavailable", robustness: state.confidence,
      why: !on ? (state.notes[0] || "no state is implied")
        : "confidence " + state.confidence + " of 3, read from " + [...new Set(named)].join(", ") +
          (state.stale ? ", capped: the card is behind the last closed session" : ""),
      say: on ? stateSentence(state, str(c.ticker)) : null,
      figures: on ? {
        state: state.state, direction: state.direction, flow: state.flow, confidence: state.confidence, premium: state.premium,
        invalidation: state.invalidation ? f2(state.invalidation.px) : null,
        target: state.target ? f2(state.target.px) : null,
        horizon: state.horizon ? String(state.horizon.value) : null,
      } : {},
      reason: on ? null : (state.notes[0] || null),
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
    state,
    engine: engineContext(c),
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
  if (ctx.engine) lines.push(...engineLines(ctx.engine));
  return lines;
}

export const VERDICTS = Object.freeze([
  "harvest-rich-premium", "buy-cheap-convexity", "pin-at-level", "ride-short-gamma", "fade-to-wall",
  "event-overpriced", "event-underpriced", "sell-skew", "buy-protection-cheap", "term-roll", "stand-aside",
]);
export const VERDICT_WORD = Object.freeze({
  "harvest-rich-premium": "Harvest rich premium", "buy-cheap-convexity": "Buy cheap convexity", "pin-at-level": "Pin at level",
  "ride-short-gamma": "Ride short gamma", "fade-to-wall": "Fade to wall", "event-overpriced": "Event overpriced",
  "event-underpriced": "Event underpriced", "sell-skew": "Sell skew", "buy-protection-cheap": "Buy cheap protection",
  "term-roll": "Term roll", "stand-aside": "Stand aside",
});
export const CLAIM_RELS = Object.freeze(["gt", "lt", "near", "between", "rising", "falling", "rich", "cheap"]);
export const VET_CODES = Object.freeze(["schema", "digit", "unknown-id", "avoid", "verdict-false", "claim-false", "withheld", "undefined-first", "dup"]);
export const ENGINE_LINES = Object.freeze({
  VRP_RICH: 0.10, VRP_CHEAP: -0.10, IV_LOW: 0.25, IV_MID_HIGH: 0.75, IV_HIGH: 0.70, EVENT_OVER: 1.25, EVENT_UNDER: 0.80,
  SKEW_STEEP: 0.8, SKEW_FLAT: 0.2, FRONT_BID: 0.08, NEAR_ATR: 0.5, NEAR_VOL: 0.01, NEAR_FRAC: 0.02, MAX_IDEAS: 3, MAX_STRUCTURES: 5,
});
const RULE_FACT = Object.freeze({ iv: "iv.pct.30", vrp: "vrp.rel.21", term: "term.slope.30_90.exEvent", skew: "skew.rr25.30.pct", event: "move.event.ratio" });

function structureBrief(st) {
  const fam = STRUCTURE_BY_ID[st.family] || null;
  const legs = (st.legs || []).map((l) => (l.side > 0 ? "+" : "−") + (l.qty > 1 ? l.qty : "") + l.type + (l.k === null || l.k === undefined ? "" : String(l.k))).join(" ");
  return {
    id: st.id, family: st.family, risk: st.risk, dir: st.dir, expiry: st.expiry, dte: num(st.dte), legs,
    popQ: st.prob ? num(st.prob.popQ) : null, popP: st.prob ? num(st.prob.popP) : null,
    evP: st.ev ? num(st.ev.p) : null, evQ: st.ev ? num(st.ev.q) : null, edge: st.ev ? num(st.ev.edge) : null,
    maxProfit: num(st.maxProfit), maxLoss: num(st.maxLoss), grade: num(st.grade),
    gradeWhy: Array.isArray(st.gradeWhy) ? st.gradeWhy.slice() : [], rules: Array.isArray(st.rules) ? st.rules.slice() : [],
    short: (st.legs || []).filter((l) => l.side < 0 && l.type !== "S").map((l) => ({ type: l.type, k: num(l.k) })),
    vol: fam ? fam.vol : null, premium: fam ? fam.premium : null,
  };
}

export function engineContext(card) {
  const e = card && card.engine && typeof card.engine === "object" && Array.isArray(card.engine.facts) && Array.isArray(card.engine.structures)
    ? card.engine : null;
  if (!e) return null;
  const facts = e.facts.filter((f) => f && typeof f.id === "string").map((f) => ({
    id: f.id, v: num(f.v), u: str(f.u), g: num(f.g) === null ? 0 : f.g,
    ...(str(f.why) ? { why: f.why } : {}), ...(num(f.atr) !== null ? { atr: f.atr } : {}), ...(f.x === true ? { x: true } : {}),
  }));
  const structures = e.structures.slice(0, ENGINE_LINES.MAX_STRUCTURES).map(structureBrief);
  const ids = new Set(structures.map((x) => x.id));
  return {
    engine: str(e.engine), asOf: str(e.asOf), spot: num(e.spot), atr: num(e.atr), facts,
    state: e.state && typeof e.state === "object" ? {
      state: str(e.state.state), direction: str(e.state.direction), confidence: num(e.state.confidence),
      preferred: Array.isArray(e.state.preferred) ? e.state.preferred.slice() : [], avoid: Array.isArray(e.state.avoid) ? e.state.avoid.slice() : [],
    } : null,
    levels: e.levels && typeof e.levels === "object" ? e.levels : null,
    structures, ideas: (Array.isArray(e.ideas) ? e.ideas : []).filter((id) => ids.has(id)),
    noTrade: e.noTrade && typeof e.noTrade === "object" ? { code: str(e.noTrade.code), closest: str(e.noTrade.closest) } : null,
  };
}

function engineLines(eng) {
  const out = ["[engine] facts, one per line as id = value unit (grade):"];
  for (const f of eng.facts) {
    out.push("  " + f.id + " = " + (f.v === null ? "withheld" : String(f.v)) + " " + (f.u || "") + " (g " + f.g + (f.x ? ", cross-section" : "") +
      (f.atr !== undefined ? ", " + f.atr + " ATR from spot" : "") + (f.why ? ", " + f.why : "") + ")");
  }
  if (eng.state) {
    out.push("[engine] state " + eng.state.state + (eng.state.direction ? " " + eng.state.direction : "") + " (confidence " + eng.state.confidence + "); prefers " +
      eng.state.preferred.join(", ") + "; avoids " + (eng.state.avoid.join(", ") || "nothing"));
  }
  out.push("[engine] structures, ranked ideas " + (eng.ideas.join(", ") || "none") + (eng.noTrade ? "; stands aside: " + eng.noTrade.code : "") + ":");
  for (const st of eng.structures) {
    out.push("  " + st.id + " " + st.family + " " + st.risk + " " + st.expiry + " " + st.legs + ": popQ " + st.popQ + ", popP " + st.popP +
      ", evP " + st.evP + ", edge " + st.edge + ", max loss " + (st.maxLoss === null ? "unbounded" : st.maxLoss) + ", grade " + st.grade +
      (st.gradeWhy.length ? " (" + st.gradeWhy.join(", ") + ")" : "") + (st.rules.length ? "; rules " + st.rules.join(" ") : ""));
  }
  return out;
}

function factIndex(eng) {
  const m = new Map();
  for (const f of eng.facts) m.set(f.id, f);
  if (num(eng.spot) !== null) m.set("spot", { id: "spot", v: eng.spot, u: "px", g: 3 });
  return m;
}

const val = (m, id) => { const f = m.get(id); return f && f.v !== null && f.g > 0 ? f.v : null; };

function structureAt(eng, id) {
  return eng.structures.find((x) => x.id === id) || null;
}

function nearLevel(eng, st, levelIds) {
  const m = factIndex(eng);
  const atr = num(eng.atr);
  const reach = atr !== null && atr > 0 ? ENGINE_LINES.NEAR_ATR * atr : num(eng.spot) !== null ? 0.01 * eng.spot : null;
  if (reach === null) return false;
  const lv = levelIds.map((id) => val(m, id)).filter((v) => v !== null);
  return st.short.some((l) => l.k !== null && lv.some((x) => Math.abs(l.k - x) <= reach));
}

export function verdictHolds(code, st, eng) {
  const m = factIndex(eng);
  const g = (id) => { const f = m.get(id); return f ? f.g : 0; };
  const vrp = val(m, "vrp.rel.21"), ivp = val(m, "iv.pct.30"), ratio = val(m, "move.event.ratio");
  const skewPct = val(m, "skew.rr25.30.pct"), front = val(m, "term.front.7_30");
  const L = ENGINE_LINES;
  const state = eng.state || {};
  const shortPrem = st && (st.vol === "short" || st.premium === "credit");
  const longPrem = st && st.vol === "long";
  switch (code) {
    case "harvest-rich-premium":
      return !!st && shortPrem && ((vrp !== null && vrp >= L.VRP_RICH && g("vrp.rel.21") >= 2 && ivp !== null && ivp >= L.IV_LOW) || (ivp !== null && ivp >= L.IV_HIGH));
    case "buy-cheap-convexity":
      return !!st && longPrem && ((vrp !== null && vrp <= L.VRP_CHEAP && g("vrp.rel.21") >= 2 && ivp !== null && ivp <= L.IV_MID_HIGH) ||
        (ivp !== null && ivp <= L.IV_LOW && vrp !== null && vrp <= L.VRP_RICH));
    case "pin-at-level":
      return !!st && state.state === "pinned" && nearLevel(eng, st, ["level.magnet", "level.maxPain"]);
    case "ride-short-gamma":
      return !!st && (state.state === "amplifying" || state.state === "squeeze") && !!state.direction && st.premium === "debit" &&
        ((state.direction === "bullish" && st.dir === "bull") || (state.direction === "bearish" && st.dir === "bear"));
    case "fade-to-wall": {
      if (!st || (st.family !== "put-credit-spread" && st.family !== "call-credit-spread")) return false;
      const put = st.family === "put-credit-spread";
      const k = st.short.map((l) => l.k).filter((x) => x !== null)[0];
      const spot = num(eng.spot);
      if (k === undefined || spot === null) return false;
      const wall = val(m, put ? "level.putWall" : "level.callWall"), flip = val(m, "level.flip");
      const beyond = (lv) => lv !== null && (put ? k <= lv && lv <= spot : k >= lv && lv >= spot);
      return beyond(wall) || beyond(flip);
    }
    case "event-overpriced": return ratio !== null && ratio >= L.EVENT_OVER;
    case "event-underpriced": return ratio !== null && ratio <= L.EVENT_UNDER;
    case "sell-skew":
      return !!st && skewPct !== null && skewPct >= L.SKEW_STEEP &&
        ["risk-reversal", "put-ratio", "call-ratio", "jade-lizard", "broken-wing-butterfly"].includes(st.family);
    case "buy-protection-cheap":
      return !!st && skewPct !== null && skewPct <= L.SKEW_FLAT && ["collar", "put-debit-spread"].includes(st.family);
    case "term-roll":
      return !!st && front !== null && front >= L.FRONT_BID && ["long-calendar", "diagonal"].includes(st.family);
    case "stand-aside": return !!eng.noTrade || !eng.ideas.length;
    default: return false;
  }
}

export function claimHolds(claim, eng) {
  const m = factIndex(eng);
  const a = m.get(claim.a), b = claim.b === undefined ? null : m.get(claim.b), c = claim.c === undefined ? null : m.get(claim.c);
  if (!a || a.v === null) return { ok: false, code: a ? "withheld" : "unknown-id" };
  if (a.g === 0) return { ok: false, code: "withheld" };
  const L = ENGINE_LINES;
  const unitOk = (x, y) => x.u === y.u || ((x.u === "px" || x.id === "spot") && (y.u === "px" || y.id === "spot"));
  const two = () => {
    if (!b) return { err: claim.b === undefined ? "schema" : "unknown-id" };
    if (b.v === null || b.g === 0) return { err: "withheld" };
    if (!unitOk(a, b)) return { err: "claim-false" };
    return null;
  };
  switch (claim.rel) {
    case "gt": case "lt": {
      const e = two(); if (e) return { ok: false, code: e.err };
      return { ok: claim.rel === "gt" ? a.v > b.v : a.v < b.v, code: "claim-false" };
    }
    case "near": {
      const e = two(); if (e) return { ok: false, code: e.err };
      const d = Math.abs(a.v - b.v);
      const reach = a.u === "px" ? (num(eng.atr) !== null ? L.NEAR_ATR * eng.atr : 0.01 * eng.spot)
        : a.u === "vol" ? L.NEAR_VOL : L.NEAR_FRAC;
      return { ok: d <= reach, code: "claim-false" };
    }
    case "between": {
      const e = two(); if (e) return { ok: false, code: e.err };
      if (!c) return { ok: false, code: claim.c === undefined ? "schema" : "unknown-id" };
      if (c.v === null || c.g === 0) return { ok: false, code: "withheld" };
      if (!unitOk(a, c)) return { ok: false, code: "claim-false" };
      return { ok: a.v >= Math.min(b.v, c.v) && a.v <= Math.max(b.v, c.v), code: "claim-false" };
    }
    case "rising": case "falling":
      if (!/\.mom\b|\.mom\./.test(a.id)) return { ok: false, code: "claim-false" };
      return { ok: claim.rel === "rising" ? a.v > 0 : a.v < 0, code: "claim-false" };
    case "rich": case "cheap": {
      const rich = claim.rel === "rich";
      if (/^vrp\./.test(a.id)) return { ok: rich ? a.v >= (a.id === "vrp.rel.21" ? L.VRP_RICH : 0) : a.v <= (a.id === "vrp.rel.21" ? L.VRP_CHEAP : 0), code: "claim-false" };
      if (/\.pct\b|\.pct\.|\.rank\./.test(a.id)) return { ok: rich ? a.v >= L.IV_MID_HIGH : a.v <= L.IV_LOW, code: "claim-false" };
      if (a.id === "move.event.ratio") return { ok: rich ? a.v >= L.EVENT_OVER : a.v <= L.EVENT_UNDER, code: "claim-false" };
      return { ok: false, code: "claim-false" };
    }
    default: return { ok: false, code: "schema" };
  }
}

function hasDigit(obj) {
  if (typeof obj === "number") return true;
  if (typeof obj === "string") return /\d/.test(obj);
  if (Array.isArray(obj)) return obj.some(hasDigit);
  if (obj && typeof obj === "object") return Object.values(obj).some(hasDigit);
  return false;
}

const ID_KEYS = Object.freeze({ ideas: ["structure", "because"], claims: ["a", "b", "c"] });

function digitOutsideIds(reply) {
  return Object.entries(reply).some(([k, v]) => {
    if (!ID_KEYS[k] || !Array.isArray(v)) return hasDigit(v);
    return v.some((item) => !item || typeof item !== "object" || Array.isArray(item)
      ? hasDigit(item)
      : Object.entries(item).some(([f, x]) => !ID_KEYS[k].includes(f) ? hasDigit(x)
        : Array.isArray(x) ? x.some((y) => typeof y !== "string") : typeof x !== "string" && x !== undefined && hasDigit(x)));
  });
}

function becauseOf(st, eng) {
  const m = factIndex(eng);
  const out = [];
  const add = (id) => { const f = m.get(id); if (f && f.v !== null && f.g > 0 && !out.includes(id)) out.push(id); };
  for (const rule of st.rules) {
    if (/−$/.test(rule)) continue;
    const axis = rule.split(".")[0];
    if (axis === "state") { add(eng.state && eng.state.state === "pinned" ? "level.magnet" : "level.flip"); add("gex.book"); continue; }
    if (RULE_FACT[axis]) add(RULE_FACT[axis]);
  }
  for (const id of ["vrp.rel.21", "iv.pct.30", "level.flip", "gex.book", "iv.cm.30"]) { if (out.length >= 2) break; add(id); }
  return out.slice(0, 2);
}

export function engineFallback(context) {
  const eng = context && context.engine ? context.engine : null;
  if (!eng) return null;
  const m = factIndex(eng);
  const ideas = [];
  for (const id of eng.ideas.slice(0, ENGINE_LINES.MAX_IDEAS)) {
    const st = structureAt(eng, id);
    if (!st) continue;
    const verdict = VERDICTS.find((v) => v !== "stand-aside" && verdictHolds(v, st, eng)) || null;
    const because = becauseOf(st, eng);
    const gs = because.map((f) => m.get(f).g);
    ideas.push({ structure: id, verdict, because, grade: Math.min(num(st.grade) === null ? 0 : st.grade, ...(gs.length ? gs : [0])), from: "engine" });
  }
  const verdict = ideas.length ? ideas[0].verdict : verdictHolds("stand-aside", null, eng) ? "stand-aside" : null;
  return { verdict, claims: [], ideas, refused: [] };
}

export function promptForEngine(context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  const eng = ctx.engine;
  const t = ctx.ticker || "this name";
  const system = [
    "You are Neuron, the reader of one name's options engine for " + t + ". Every number has already been computed by a " +
      "deterministic engine and is listed as a numbered fact or a priced structure. You choose, order and justify; you never compute.",
    "",
    "Answer with ONE JSON object and nothing else, in this shape: {\"verdict\": \"<code>\", \"claims\": [{\"a\": \"<fact id or spot>\", " +
      "\"rel\": \"<relation>\", \"b\": \"<fact id or spot>\"}], \"ideas\": [{\"structure\": \"<structure id>\", \"verdict\": \"<code>\", " +
      "\"because\": [\"<fact id>\", \"<fact id>\"]}]}.",
    "1. Write NO digits anywhere except inside the ids you copy. No prose fields, no numbers, no percentages.",
    "2. verdict codes: " + VERDICTS.join(", ") + ". Each code has preconditions the server checks against the facts; a code whose " +
      "preconditions do not hold is refused.",
    "3. relations: " + CLAIM_RELS.join(", ") + ". A claim compares two facts of the same unit (or a price fact with spot); " +
      "'between' takes a third id as \"c\". The server evaluates every claim on the facts and refuses a false one.",
    "4. ideas use only the listed structure ids, at most " + ENGINE_LINES.MAX_IDEAS + ", no repeats, never a structure whose family " +
      "the state avoids, and the first idea is defined-risk whenever a defined-risk structure is listed.",
    "5. because names at least two fact ids with grade above zero; an idea ranks no higher than its weakest fact.",
    "6. If nothing is worth doing, answer verdict stand-aside with no ideas.",
  ].join("\n");
  const user = "Engine read for " + t + (ctx.sessionDate ? ", session " + ctx.sessionDate : "") + ":\n" + engineLines(eng).join("\n");
  return { system, user };
}

export function parseEngineOutput(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return null;
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const a = unfenced.indexOf("{"), b = unfenced.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const obj = JSON.parse(unfenced.slice(a, b + 1)); return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null; } catch { return null; }
}

export function vetEngineReply(reply, context) {
  const eng = context && context.engine ? context.engine : null;
  const refused = [];
  const refuse = (code, at) => { refused.push({ code, at }); };
  if (!eng) return { ok: false, verdict: null, claims: [], ideas: [], refused: [{ code: "schema", at: "context" }] };
  if (!reply || typeof reply !== "object" || Array.isArray(reply) || (reply.ideas !== undefined && !Array.isArray(reply.ideas)) ||
      (reply.claims !== undefined && !Array.isArray(reply.claims))) {
    return { ok: false, verdict: null, claims: [], ideas: [], refused: [{ code: "schema", at: "reply" }] };
  }
  const m = factIndex(eng);
  if (digitOutsideIds(reply)) return { ok: false, verdict: null, claims: [], ideas: [], refused: [{ code: "digit", at: "reply" }] };
  const claims = [];
  for (const [i, cl] of (reply.claims || []).entries()) {
    if (!cl || typeof cl !== "object" || typeof cl.a !== "string" || !CLAIM_RELS.includes(cl.rel)) { refuse("schema", "claims." + i); continue; }
    const r = claimHolds(cl, eng);
    if (!r.ok) { refuse(r.code, "claims." + i); continue; }
    claims.push({ a: cl.a, rel: cl.rel, ...(cl.b !== undefined ? { b: cl.b } : {}), ...(cl.c !== undefined ? { c: cl.c } : {}) });
  }
  const avoid = eng.state && Array.isArray(eng.state.avoid) ? eng.state.avoid : [];
  const kept = [];
  const seen = new Set();
  const definedListed = eng.structures.some((x) => x.risk === "defined" && num(x.grade) !== null && x.grade >= 1);
  for (const [i, idea] of (reply.ideas || []).entries()) {
    const at = "ideas." + i;
    if (!idea || typeof idea !== "object" || typeof idea.structure !== "string" || !Array.isArray(idea.because)) { refuse("schema", at); continue; }
    if (idea.verdict !== undefined && idea.verdict !== null && !VERDICTS.includes(idea.verdict)) { refuse("schema", at); continue; }
    const st = structureAt(eng, idea.structure);
    if (!st) { refuse("unknown-id", at); continue; }
    if (seen.has(st.id)) { refuse("dup", at); continue; }
    const fam = STRUCTURE_BY_ID[st.family];
    if (fam && [fam.neuron, ...fam.kin].filter(Boolean).some((x) => avoid.includes(x))) { refuse("avoid", at); continue; }
    const because = [...new Set(idea.because.filter((x) => typeof x === "string"))];
    if (because.length < 2 || because.some((id) => !m.has(id) || id === "spot")) { refuse("unknown-id", at); continue; }
    if (because.some((id) => m.get(id).g === 0 || m.get(id).v === null)) { refuse("withheld", at); continue; }
    if (idea.verdict && !verdictHolds(idea.verdict, st, eng)) { refuse("verdict-false", at); continue; }
    if (!kept.length && st.risk !== "defined" && definedListed) { refuse("undefined-first", at); continue; }
    seen.add(st.id);
    const grade = Math.min(num(st.grade) === null ? 0 : st.grade, ...because.map((id) => m.get(id).g));
    kept.push({ structure: st.id, verdict: idea.verdict || null, because, grade, from: "model" });
    if (kept.length >= ENGINE_LINES.MAX_IDEAS) break;
  }
  let verdict = typeof reply.verdict === "string" ? reply.verdict : null;
  if (verdict !== null && !VERDICTS.includes(verdict)) { refuse("schema", "verdict"); verdict = null; }
  if (verdict !== null) {
    const holds = verdict === "stand-aside" ? verdictHolds(verdict, null, eng) || !kept.length
      : kept.some((k) => verdictHolds(verdict, structureAt(eng, k.structure), eng)) ||
        (["event-overpriced", "event-underpriced"].includes(verdict) && verdictHolds(verdict, null, eng));
    if (!holds) { refuse("verdict-false", "verdict"); verdict = null; }
  }
  return { ok: kept.length > 0 || verdict === "stand-aside", verdict, claims, ideas: kept, refused };
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
    "4. Every idea rests on at least two distinct features, named by the keys written between " +
      "the brackets (for example gamma, levels, pricedMove — without the brackets), and its rank is " +
      "no higher than the lowest robustness among them. Prefer ideas that rest on robustness 3. " +
      "Never rest an idea on a feature with robustness 0.",
    "5. Every idea names an invalidation level that appears in the context (a wall, the gamma " +
      "flip, max pain or an end of the priced range, quoted exactly as the context prints it) and " +
      "a horizon that appears in the context (an expiry, the half-life, the priced-move sessions).",
    "6. The structure is one of: " + NEURON_STRUCTURES.join(", ") + ". 'no position' is a valid " +
      "idea when the features disagree; say which ones disagree.",
    "7. Units travel with numbers, in the context's own words. A capped list is not a population.",
    "8. The line [state] is the state the greeks imply, computed from the positioning, flow and " +
      "premium features above, with the structures it prefers and the ones it rules out. The first " +
      "idea uses one of the preferred structures. No idea uses a structure on the avoid list; an " +
      "idea that does is refused. If the features disagree with the state, say so in the summary " +
      "rather than proposing against it.",
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

export function guardFacts(context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  const out = [];
  for (const f of ctx.features || []) {
    if (!f.say) continue;
    const values = Object.values(f.figures || {})
      .filter((v) => v !== null && v !== undefined && typeof v !== "boolean")
      .map((v) => String(v));
    out.push({ say: f.say + (values.length ? " " + values.join(", ") : "") });
  }
  return out;
}

export function deterministicSummary(context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  const stale = ctx.stale === true;
  const st = ctx.state && typeof ctx.state === "object" && ctx.state.state !== "undetermined" && ctx.state.confidence >= 1 ? ctx.state : null;
  const said = (ctx.features || [])
    .filter((f) => f.say && f.key !== "state" && f.robustness >= (stale ? 1 : 2))
    .sort((a, b) => b.robustness - a.robustness)
    .slice(0, st ? 2 : 3)
    .map((f) => f.say);
  if (st) said.unshift(st.brief);
  if (said.length) {
    return (stale ? "This card describes an earlier session than the last closed one, so every grade is capped at weak. " : "") +
      said.join(" ");
  }
  return "The card for " + (ctx.ticker || "this name") + " publishes no feature with a reading to lean on this session.";
}

const IDEA_SIDES = {
  "long call": ["bullish"], "call debit spread": ["bullish"], "put credit spread": ["bullish"],
  "long put": ["bearish"], "put debit spread": ["bearish"], "call credit spread": ["bearish"],
  "covered call": ["bullish", "neutral"], "collar": ["bullish", "neutral"],
  "iron condor": ["neutral"], "long straddle": ["neutral"], "long strangle": ["neutral"],
  "calendar spread": ["neutral", "bullish", "bearish"], "no position": ["neutral"],
};

export function vetIdeas(rawIdeas, context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  const byKey = new Map((ctx.features || []).map((f) => [f.key.toLowerCase(), f]));
  const facts = guardFacts(ctx);
  const st = ctx.state && typeof ctx.state === "object" && ctx.state.state !== "undetermined" && ctx.state.confidence >= 1 ? ctx.state : null;
  const kept = [];
  const refused = [];
  const seen = new Set();
  for (const idea of Array.isArray(rawIdeas) ? rawIdeas : []) {
    if (!idea || typeof idea !== "object") { refused.push("not an object"); continue; }
    const title = str(idea.title), thesis = str(idea.thesis);
    const structure = str(idea.structure) ? idea.structure.trim().toLowerCase() : null;
    const direction = str(idea.direction) ? idea.direction.trim().toLowerCase() : null;
    const invalidation = str(idea.invalidation), horizon = str(idea.horizon);
    const rests = [...new Set((Array.isArray(idea.rests_on) ? idea.rests_on : [])
      .map((k) => String(k).replace(/^\s*\[|\]\s*$/g, "").trim().toLowerCase()).filter(Boolean))];
    if (!title || !thesis || !structure || !invalidation || !horizon) { refused.push((title || "idea") + ": a field is missing"); continue; }
    if (!NEURON_STRUCTURES.includes(structure)) { refused.push(title + ": structure not in the list"); continue; }
    if (!["bullish", "bearish", "neutral"].includes(direction)) { refused.push(title + ": direction not bullish, bearish or neutral"); continue; }
    if (!(IDEA_SIDES[structure] || []).includes(direction)) { refused.push(title + ": " + article(structure) + " is not " + direction); continue; }
    if (st && Array.isArray(st.avoid) && st.avoid.includes(structure)) {
      refused.push(title + ": " + article(structure) + " is on the implied state\u2019s avoid list (" + st.chip + ")"); continue;
    }
    const feats = rests.map((k) => byKey.get(k)).filter(Boolean);
    if (feats.length < 2 || feats.length !== rests.length) { refused.push(title + ": rests on fewer than two known features"); continue; }
    const robustness = Math.min(...feats.map((f) => f.robustness));
    if (robustness < 1) { refused.push(title + ": rests on a withheld feature"); continue; }
    const text = [title, thesis, invalidation, horizon].join(" ");
    const verdict = guardAnswer(text, facts, { smallIntegers: false });
    if (!verdict.ok) { refused.push(title + ": " + (verdict.forecast ? "claims what happens next" : "names a figure the card does not carry")); continue; }
    const signature = [structure, direction, invalidation.toLowerCase()].join("|");
    if (seen.has(signature) || seen.has(title.toLowerCase())) { refused.push(title + ": repeats an idea already kept"); continue; }
    seen.add(signature); seen.add(title.toLowerCase());
    kept.push({ title, structure, direction, thesis, invalidation, horizon, restsOn: feats.map((f) => f.key), robustness,
      robustnessWord: ROBUSTNESS_WORD[robustness], fromState: idea.fromState === true });
  }
  kept.sort((a, b) => ((b.fromState ? 1 : 0) - (a.fromState ? 1 : 0)) || (b.robustness - a.robustness));
  return { ideas: kept.slice(0, NEURON_MAX_IDEAS), refused };
}

export function contextFingerprint(context) {
  const joined = contextLines(context).join("\n");
  let h = 5381;
  for (let i = 0; i < joined.length; i++) h = (((h << 5) + h) ^ joined.charCodeAt(i)) >>> 0;
  return "n" + NEURON_CONTEXT_VERSION + "." + h.toString(36) + "." + (context && context.features ? context.features.length : 0) +
    (context && context.engine ? ".e" + context.engine.structures.length : "");
}

export function publicContext(context) {
  const ctx = context && typeof context === "object" ? context : { features: [] };
  return {
    version: ctx.version, ticker: ctx.ticker, sessionDate: ctx.sessionDate, expectedSession: ctx.expectedSession,
    stale: ctx.stale, depth: ctx.depth, coverage: ctx.coverage,
    state: ctx.state && typeof ctx.state === "object" ? {
      version: ctx.state.version, state: ctx.state.state, word: STATE_WORD[ctx.state.state] || ctx.state.state,
      direction: ctx.state.direction, flow: ctx.state.flow, confidence: ctx.state.confidence, premium: ctx.state.premium,
      chip: ctx.state.chip, brief: ctx.state.brief, preferred: ctx.state.preferred, avoid: ctx.state.avoid,
      invalidation: ctx.state.invalidation, target: ctx.state.target, bound: ctx.state.bound, horizon: ctx.state.horizon,
      stale: ctx.state.stale, notes: ctx.state.notes,
      drivers: (ctx.state.drivers || []).map((d) => ({ key: d.key, sub: d.sub || null, axis: d.axis, robustness: d.robustness,
        vote: typeof d.vote === "number" ? d.vote : null, reading: d.reading })),
    } : null,
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
