import { readFileSync } from "node:fs";
import vm from "node:vm";
import { askSplit } from "../../shared/flows-tape-stats.js";

export const SESSION = "2026-10-16";
export const NEXT = "2026-10-19";

export function leg(over = {}) {
  return { type: "C", k: 105, side: 1, qty: 1, bid: 2.9, ask: 3.1, mid: 3.0, model: 2.9, iv: 0.30, oi: 500, vol: 40, spreadRel: 0.0667, ...over };
}

export function structure(over = {}, legOver = {}) {
  return {
    id: "a", family: "long-call", dir: "bull", grade: 3, expiry: "2026-11-20", dte: 35, lossUnbounded: false, profitUnbounded: true,
    maxLoss: -310, maxProfit: null, breakevens: [103.1], ev: { p: 41, q: -4, edge: 45 }, prob: { popP: 0.46 },
    legs: [leg(legOver)], ...over,
  };
}

export function block(over = {}, structures = [structure()]) {
  return {
    asOf: SESSION, spot: 100, ideas: structures.length ? [structures[0].id] : [], state: { state: "trend", direction: "bullish", confidence: 2 },
    levels: { callWall: 110, putWall: 90, flip: 98 }, facts: [{ id: "iv.cm.30", v: 0.3, g: 2 }, { id: "iv.cm.7", v: 0.28, g: 2 }],
    expiries: [{ expiry: "2026-11-20", T: 0.0959, forward: { F: 100, D: 0.995 }, smile: { method: "svi", n: 12, checks: { ok: true } } }],
    structures, ...over,
  };
}

export function card(over = {}, blockOver = {}, structures) {
  return {
    ticker: "SYO001", depth: "board", sessionDate: SESSION,
    panels: { context: { status: "ok", ivRank: 40 }, pricedMove: { status: "ok" }, levels: { status: "ok" }, gamma: { status: "ok" } },
    engine: block(blockOver, structures), ...over,
  };
}

export const NORM = Object.freeze({ winN: 40, premiumMedian: 150000, premiumP90: 900000, sizeMedian: 80, sizeP90: 400, callShare: null, blk: 5000, blkN: 40 });

const CORE_URL = new URL("../../assets/js/flows-oracle-core.js", import.meta.url);

export function loadCore(source) {
  const box = vm.createContext({ FlowsUI: { F: { askSplit } } });
  vm.runInContext(source === undefined ? readFileSync(CORE_URL, "utf8") : source, box);
  return box.__OracleCoreTest;
}

export const CORE = loadCore();

export const CHEAP = Object.freeze({
  id: "SYO001:2026-11-20:65:C", strike: 65, side: "C", expiry: "2026-11-20", dte: 37, verdict: "cheap", action: "pay",
  marketIv: 0.388, fairIv: 0.421, edgeVol: -3.3, edgeUsd: -41.5, mid: 3.1, bid: 3.0, ask: 3.2, spreadPct: 0.065,
  ev: 41, pop: 0.46, breakeven: 68.1, maxLoss: 310, maxGain: null, grade: 3,
  assumptions: ["Fair vol is the engine's fitted smile.", "The chance of profit comes from the engine's own model of returns.", "Held to expiry."], cites: ["iv.rank"],
});

export const RICH = Object.freeze({
  id: "SYO001:2026-11-20:75:P", strike: 75, side: "P", expiry: "2026-11-20", dte: 37, verdict: "rich", action: "collect",
  marketIv: 0.47, fairIv: 0.43, edgeVol: 4.0, edgeUsd: 38.2, mid: 4.85, bid: 4.7, ask: 5.0, spreadPct: 0.062,
  ev: 28, pop: 0.71, breakeven: 70.15, maxLoss: 7015, maxGain: 485, grade: 2,
  assumptions: ["Fair vol is the engine's fitted smile."], cites: ["iv.rank"],
});

const withSay = (c) => ({ ...c, say: CORE.words.callSay(c) });

export function record(over = {}) {
  const t = over.ticker || "SYO001";
  return {
    v: 1, ticker: t, session: "2026-10-14", generatedAt: "2026-10-14T21:52:00Z", cardSession: "2026-10-14", cardAsOf: "2026-10-14T21:45:00Z", engineVersion: 1,
    state: "signal", stateWhy: "ok", grade: 3,
    stance: { lean: "up", conviction: 2, basis: ["iv.rank"], line: CORE.words.STANCE_LINES.up[2] },
    context: { norm: { premiumMedian: 600000, premiumP90: 4000000, winN: 40, sizeMedian: 40, sizeP90: 150 }, leanBase: { callShare: 0.55 }, ivRank: 0.62, ivRankGrade: 2, earnings: null, sector: "Technology", sectorEtf: "XLK", walls: { call: 75, put: 65, flip: 70 }, spot: 71.4, spotAsOf: "2026-10-14T20:00:00Z" },
    calls: [withSay(CHEAP), withSay(RICH)],
    withheld: [],
    limits: ["Not re-priced intraday."],
    provenance: { source: "engine", cardKey: `card:${t}`, cardxKey: `card-x:${t}`, ideas: "priced", cites: [] },
    fresh: { asOf: "2026-10-14T21:52:00Z", ageS: 3600, klass: "nightly", liveUntil: null },
    ...over,
  };
}

const NONE = (n) => ({ lean: "none", conviction: 0, basis: [], line: CORE.words.STANCE_LINES.none[n] });
export const CALM = () => record({ ticker: "SYO002", state: "calm", stateWhy: "ok", calls: [], stance: NONE(0) });
export const CONFLICT = () => record({ ticker: "SYO003", state: "conflict", stateWhy: "disagree", stance: { lean: "mixed", conviction: 1, basis: [], line: CORE.words.STANCE_LINES.mixed[1] } });
export const STALE = () => record({ ticker: "SYO004", state: "stale", stateWhy: "behind1", grade: 1 });
export const BUILDING = () => record({ ticker: "SYO005", state: "building", stateWhy: "no-card", grade: 0, calls: [], stance: NONE(0), withheld: [{ k: "engine", reason: "unit" }, { k: "norm", reason: "thin-norm" }] });

export function top() {
  const item = (t, lean, conv, call) => ({ t, state: "signal", stance: { lean, conviction: conv }, topCall: call });
  return {
    v: 1, session: "2026-10-14", generatedAt: "2026-10-14T21:52:00Z",
    items: [
      item("SYO001", "up", 2, { id: CHEAP.id, strike: 65, side: "C", expiry: "2026-11-20", verdict: "cheap", edgeUsd: 41.5, head: CORE.words.callSay(CHEAP).head }),
      item("SYO006", "down", 3, { id: "SYO006:2026-11-20:40:P", strike: 40, side: "P", expiry: "2026-11-20", verdict: "rich", edgeUsd: 33, head: "The 40 put for Nov 20 looks rich." }),
      item("SYO007", "mixed", 1, { id: "SYO007:2026-12-18:120:C", strike: 120, side: "C", expiry: "2026-12-18", verdict: "cheap", edgeUsd: 22, head: "The 120 call for Dec 18 looks cheap." }),
    ],
  };
}

export const NOW = Date.parse("2026-10-14T15:30:00Z");

let seq = 0;
export function row(t, minAgo, over = {}) {
  const at = new Date(NOW - minAgo * 60000).toISOString();
  seq++;
  return { t, id: `${t}-${minAgo}-${seq}`, spanStart: at, prem: 100000, size: 10, askPrem: null, bidPrem: null, cp: "C", k: 65, exp: "2026-11-20", sweep: false, ...over };
}
