import { pastDeadline } from "./common.mjs";
import { vnum } from "../../shared/flows-cross.js";

export const INDEX_DEPTH = "index";

export const FUND_DEPTH = "fund";

export const DOSSIER_DEPTHS = Object.freeze([INDEX_DEPTH, FUND_DEPTH]);

export function dossierRoster({ index = [], funds = [] } = {}) {
  const depth = new Map();
  for (const t of index) if (typeof t === "string" && t && !depth.has(t)) depth.set(t, INDEX_DEPTH);
  for (const t of funds) if (typeof t === "string" && t && !depth.has(t)) depth.set(t, FUND_DEPTH);
  return { tickers: [...depth.keys()], depth };
}

export const INDEX_CARD_BUDGET_BYTES = 100 * 1024;

export const INDEX_CARD_SHED = Object.freeze([
  ["topContracts", "dropped to fit the payload cap"],
  ["aggressor", "dropped to fit the payload cap"],
  ["ivSurface", "dropped to fit the payload cap"],
  ["skewTerm", "dropped to fit the payload cap"],
  ["darkpool", "dropped to fit the payload cap"],
  ["oiDeltas", "dropped to fit the payload cap"],
  ["volContext", "dropped to fit the payload cap"],
  ["marketRank", "dropped to fit the payload cap"],
  ["surface", "dropped to fit the payload cap"],
]);

export function shedToFit(card, { budgetBytes = INDEX_CARD_BUDGET_BYTES, order = INDEX_CARD_SHED } = {}) {
  let body = JSON.stringify(card);
  const dropped = [];
  for (const [key, reason] of order) {
    if (body.length <= budgetBytes) break;
    if (!card.panels || !card.panels[key] || card.panels[key].status !== "ok") continue;
    card.panels[key] = { status: "unavailable", reason };
    dropped.push(key);
    body = JSON.stringify(card);
  }
  return { bytes: body.length, dropped };
}

export async function buildIndexDossiers({
  tickers = [], depthOf = () => INDEX_DEPTH, indexRows = new Map(), deadline = null,
  enrich, features, perName, chain, card, publish, log = () => {},
} = {}) {
  const out = { built: [], failed: [], skipped: [], shed: {}, depth: {} };
  for (const ticker of tickers) {
    if (pastDeadline(deadline)) { out.skipped.push(ticker); continue; }
    const row = indexRows.get(ticker);
    const depth = DOSSIER_DEPTHS.includes(depthOf(ticker)) ? depthOf(ticker) : INDEX_DEPTH;
    if (!row) { out.skipped.push(ticker); log(`  ${depth} ${ticker}: no screener row, so no spot to build from`); continue; }
    const spot = vnum(row.close);
    if (spot === null || !(spot > 0)) {
      out.skipped.push(ticker);
      log(`  ${depth} ${ticker}: the screener row carries no close, so there is no spot to build from`);
      continue;
    }
    try {
      const raw = await enrich(ticker, spot, row);
      const f = features(raw, ticker, spot, row);
      const reads = await perName(ticker, f.spot || spot, raw);
      const panels = await chain(ticker, f.spot || spot, raw);
      const built = card({ ticker, row, raw, features: f, reads, chain: panels });
      built.depth = depth;
      const fit = shedToFit(built);
      if (fit.dropped.length) out.shed[ticker] = fit.dropped;
      if (fit.bytes > INDEX_CARD_BUDGET_BYTES) throw new Error(`card is ${fit.bytes} bytes after shedding, over the cap`);
      await publish("card:" + ticker, built);
      out.built.push(ticker);
      out.depth[ticker] = depth;
    } catch (error) {
      out.failed.push(ticker);
      log(`  ${depth} ${ticker}: ${error.message}`);
    }
  }
  return out;
}
