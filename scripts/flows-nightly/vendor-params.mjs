export const UNIVERSE = {
  minPrice: 5,
  minMarketCap: 1e9,

  minDollarVolume: 5e7,
  minOptionVolume: 1000,
  minOpenInterest: 5000,
  excludeIssueTypes: ["ETF", "Index", "ADR"],

  boardSize: 50,

  enrichCount: 100,
};

export const RATE = {
  startDelayMs: 120, minDelayMs: 60, maxDelayMs: 5000, maxRetries: 4,
  maxRetryAfterMs: 30_000,

  floorCeilingMs: 400,
};

export const CALL_COST = Object.freeze({
  setup: 8,
  coverage: 2,
  enrich: 5,
  marketFixed: 1 + 33 + 15,
  shortBatch: 50,
  insiderBatch: 25,
  ownershipPerDeep: 2,
  earningsPerName: 1,
  sectorTrix: 11,
  chainPerDeep: 1.4,
  readsPerDeep: 7,
  volPerDeep: 8,
  volPerCross: 2,
  volPerDossier: 10,
  volRadar: 4,
  flowPerDeep: 12.2,
  flowPerCross: 3,
  flowAlertPages: 12,
  dossier: 13,
  focus: 1,
  activity: 1,
  misc: 67,
});

export const NOMINAL_SHAPE = Object.freeze({ enriched: 180, deep: 72, cross: 110, dossiers: 12, earnings: 95 });

export function callModel({ enriched = 0, deep = 0, cross = 0, dossiers = 0, earnings = 0 } = {}, cost = CALL_COST) {
  const carded = deep + cross;
  const legs = {
    setup: cost.setup + cost.coverage,
    enrich: cost.enrich * enriched,
    market: cost.marketFixed + Math.ceil(carded / cost.shortBatch) + Math.ceil(carded / cost.insiderBatch) +
      cost.ownershipPerDeep * deep + cost.earningsPerName * earnings,
    sectorTrix: cost.sectorTrix,
    chains: Math.ceil(cost.chainPerDeep * deep),
    cards: cost.readsPerDeep * deep,
    vol: cost.volPerDeep * deep + cost.volPerCross * cross + cost.volPerDossier * dossiers + cost.volRadar,
    flow: Math.ceil(cost.flowPerDeep * deep) + cost.flowPerCross * cross + cost.flowAlertPages,
    dossiers: cost.dossier * dossiers,
    focus: cost.focus,
    activity: cost.activity,
    misc: cost.misc,
  };
  return { legs, total: Object.values(legs).reduce((a, b) => a + b, 0) };
}

export const CALL_BUDGET = callModel(NOMINAL_SHAPE).total;

export const CALL_OVERRUN_MARGIN = 0.10;

export const EARNINGS_GATE_DAYS = 12;

export const SCREENER_PAGE_ROWS = 50;

export const SCREENER_SPLIT_DEPTH = 2;

export const DEEP_NAMES = 50;

export const MARKET_CROSS_LIMIT = 100;

export const DEEP_RULE =
  "The " + 50 + " names furthest from neutral across both boards carry a chain " +
  "and a detail card. Every other row is scored and ranked from the same five " +
  "sources, and has no card: the card costs vendor calls the run cannot spend " +
  "on a hundred names.";

export function deepNames(published, limit = DEEP_NAMES) {
  const rows = [];
  for (const side of ["long", "short"]) {
    for (const row of (published && published[side]) || []) {
      const s = Number(row && row.s);
      if (row && row.t) rows.push({ t: row.t, side, mag: Number.isFinite(s) ? Math.abs(s) : -1 });
    }
  }
  rows.sort((a, b) => b.mag - a.mag || a.t.localeCompare(b.t));
  return rows.slice(0, Math.max(0, limit));
}

export const DEADLINE_MS = 36 * 60 * 1000;

export const CHAIN_RESERVE_MS = 6 * 60 * 1000;

export const LIVE_VENDOR = Object.freeze({ timeoutMs: 20_000, timeoutRetries: 1 });

export const NEWS_VENDOR_LIMIT = 100;

export const IV_RANK_PARAMS = Object.freeze({ timespan: "1y" });

export const ALERT_VENDOR_LIMIT = 200;
