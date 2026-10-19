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

export const NORM = Object.freeze({ winN: 40, premiumMedian: 150000, premiumP90: 900000, sizeMedian: 80, sizeP90: 400, callShare: null });
