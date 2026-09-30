import { screenReading, SCREEN_INPUTS } from "./flows-neuron-screen.js";
import { neuronTier, engineContext } from "./flows-neuron.js";
import { sessionsBetween } from "./flows-cross.js";

export const COVERAGE_VERSION = 1;
export const LEDGER_TIERS = Object.freeze(["priced", "standAside", "family", "screen", "unpriceable", "expired", "stale", "missing"]);

const TIER_KEY = Object.freeze({ priced: "priced", "stand-aside": "standAside", family: "family", unpriceable: "unpriceable" });
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function cardTier(card) {
  const c = card && typeof card === "object" ? card : {};
  const t = neuronTier(c, { engine: engineContext(c) });
  return { tier: t.tier, code: t.code, depth: typeof c.depth === "string" ? c.depth : null };
}

function rowOf(universe, i) {
  const u = {}, pct = {};
  const units = universe.units && typeof universe.units === "object" ? universe.units : {};
  for (const [k, col] of Object.entries(universe.cols || {})) {
    const scale = Array.isArray(units[k]) ? Number(units[k][1]) : NaN;
    const v = Array.isArray(col) ? col[i] : null;
    u[k] = Number.isFinite(v) && Number.isFinite(scale) && scale !== 0 ? v / scale : null;
  }
  for (const [k, col] of Object.entries(universe.pct || {})) pct[k] = Array.isArray(col) && Number.isFinite(col[i]) ? col[i] : null;
  return { u, pct };
}

export function neuronCoverage({ universe, eligible = null, cards = new Map(), held = {}, sessionDate = null } = {}) {
  const uni = universe && typeof universe === "object" ? universe : {};
  const names = uni.status === "ok" && Array.isArray(uni.t) ? uni.t : [];
  const total = num(eligible) !== null ? Math.max(eligible, names.length) : names.length;
  const ledger = { v: COVERAGE_VERSION, sessionDate, universe: total, priced: 0, standAside: 0, family: 0, screen: 0, unpriceable: 0, expired: 0, stale: 0,
    missing: total - names.length };
  const screenIdeas = { family: 0, none: 0, codes: {} };
  const unpriceableCodes = {};
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  names.forEach((t, i) => {
    const card = cards instanceof Map ? cards.get(t) : null;
    if (card && TIER_KEY[card.tier]) {
      ledger[TIER_KEY[card.tier]]++;
      if (card.tier === "unpriceable") bump(unpriceableCodes, card.code || "unknown");
      return;
    }
    const heldDay = held && typeof held === "object" ? held["card:" + t] : null;
    if (typeof heldDay === "string" && sessionDate) {
      const gap = sessionsBetween(heldDay, sessionDate);
      ledger[gap !== null && gap >= 2 ? "expired" : "stale"]++;
      return;
    }
    const { u, pct } = rowOf(uni, i);
    const r = screenReading({ ticker: t, u, pct, sessionDate: uni.sessionDate || sessionDate, expectedSession: sessionDate });
    if (r.status !== "ok") { ledger.unpriceable++; bump(unpriceableCodes, "screen.no-inputs"); return; }
    ledger.screen++;
    if (r.idea.kind === "family") screenIdeas.family++;
    else { screenIdeas.none++; bump(screenIdeas.codes, r.noIdeaCode || "none"); }
  });
  const columns = uni.cols && typeof uni.cols === "object" ? uni.cols : {};
  const counts = uni.counts && typeof uni.counts === "object" ? uni.counts : {};
  const inputs = {};
  for (const [k] of SCREEN_INPUTS) inputs[k] = Object.hasOwn(columns, k) ? num(counts[k]) : null;
  const deep = [...(cards instanceof Map ? cards.values() : [])].filter((c) => c && (c.depth === "board" || c.depth === "focus"));
  return {
    ...ledger,
    screenIdeas, unpriceableCodes, inputs,
    absentInputs: SCREEN_INPUTS.map(([k]) => k).filter((k) => !Object.hasOwn(columns, k)),
    shed: Array.isArray(uni.shed) ? uni.shed.slice() : [],
    engine: { expected: deep.length, built: deep.filter((c) => c.tier === "priced" || c.tier === "stand-aside").length },
  };
}

export function ledgerSum(ledger) {
  const l = ledger && typeof ledger === "object" ? ledger : {};
  return LEDGER_TIERS.reduce((a, k) => a + (num(l[k]) || 0), 0);
}
