import { makeCallMeter } from "./common.mjs";
import {
  harvestScreener, readIndexRows, readShortInterest, readInsiders, universePayload, INDEX_TICKERS,
} from "./universe.mjs";
import { readRegime, assembleRegime, REGIME_CALLS } from "./regime.mjs";
import { readDeepOwnership, ownershipParts } from "./ownership.mjs";
import { readCatalysts, assembleCatalysts, calendarPlan } from "./events.mjs";
import { isoDay, sessionsBetween, vnum, compactNumbers } from "../../shared/flows-cross.js";
import { putCallHistory } from "../../shared/flows-regime.js";

export const EARNINGS_WINDOW_SESSIONS = 10;

export const EARNINGS_WINDOW_CAP = 60;

export const DEEP_NAMES_MODELLED = 50;

export const INDEX_DOSSIER_CALLS = 13;

export const SWEEP_CALLS_RETIRED = 47;

export const MARKET_LEG_CALLS =
  2 + 1 + REGIME_CALLS + 3 + 6 + 2 * DEEP_NAMES_MODELLED +
  2 + calendarPlan("2026-09-22").length + DEEP_NAMES_MODELLED + EARNINGS_WINDOW_CAP +
  INDEX_TICKERS.length * INDEX_DOSSIER_CALLS - SWEEP_CALLS_RETIRED;

export async function runMarketLegs({
  uw, sessionDate = null, screenerDate = null, generatedAt = null, harvest = null, filters = {},
  eligible = () => true, cardedTickers = [], deepTickers = [], windowTickers = [],
  deadline = null, pool = null, width = 1, stats = null, log = () => {},
} = {}) {
  const meter = makeCallMeter(stats);
  const readAt = new Date().toISOString();
  const lines = [];
  const say = (line) => { lines.push(line); log(line); };

  const h = harvest || await harvestScreener(uw, { filters, date: screenerDate });
  const harvested = h.rows || [];
  const eligibleRows = harvested.filter((r) => { try { return eligible(r); } catch { return false; } });
  const screenerByTicker = new Map(harvested.map((r) => [r.ticker, r]));
  say(`  universe ${h.source || "harvest"}: ${harvested.length} row(s) in ${h.pages} page(s) of ${h.limit}` +
    (h.truncated ? " — TRUNCATED at the page cap" : "") + (h.repeated ? " — a page repeated its predecessor" : "") +
    (h.errors && h.errors.length ? ` — ${h.errors.length} read(s) failed` : "") +
    `, ${eligibleRows.length} eligible`);

  const index = await readIndexRows(uw, { date: screenerDate });
  say(`  index rows: ${index.rows.size} of 3` + (index.missing.length ? ` (missing ${index.missing.join(", ")})` : ""));

  const rawRegime = await readRegime(uw, { sessionDate, deadline });
  const { regime, catalysts: reportCatalysts } = assembleRegime(rawRegime, {
    sessionDate, generatedAt, readAt, indexRows: index.rows, harvestRows: harvested, universeRows: eligibleRows,
  });
  say(`  regime: ${rawRegime.calls} call(s); vix ${regime.volCurve.vendor.status}` +
    (regime.volCurve.vendor.reason ? ` (${regime.volCurve.vendor.reason})` : "") +
    `, curve ${regime.volCurve.status}, 0DTE ${regime.zeroDte ? regime.zeroDte.status : "—"}` +
    `, sectors ${regime.sectors.rows.filter((s) => s.status === "ok").length}/${regime.sectors.rows.length}` +
    `, groups ${regime.groups.rows.filter((g) => g.status === "ok").length}/${regime.groups.rows.length}` +
    `, rho ${Object.entries(regime.impliedCorrelation.byIndex).map(([k, v]) => `${k}:${v && v.rho !== null && v.rho !== undefined ? v.rho.toFixed(3) : (v && v.reason) || "—"}`).join(" ")}` +
    `, ${regime.bytes} bytes`);

  const universe = universePayload(eligibleRows, {
    sessionDate, generatedAt, readAt, harvest: h, screened: harvested.length,
  });
  say(`  universe: ${universe.n} names, ${universe.cols ? Object.keys(universe.cols).length : 0} columns` +
    (universe.shed.length ? `, shed ${universe.shed.join(", ")}` : "") + `, ${universe.bytes} bytes` +
    (universe.status !== "ok" ? ` — ${universe.status} (${universe.reason})` : "") +
    (universe.harvest && !universe.harvest.complete ? " — the cross-section is INCOMPLETE" : ""));

  const carded = [...new Set(cardedTickers)];
  const shortRead = await readShortInterest(uw, carded, { sessionDate, deadline });
  const insiderRead = await readInsiders(uw, carded, { sessionDate, deadline });
  say(`  ownership batches: short interest ${shortRead.rows.length} row(s) in ${shortRead.calls} call(s)` +
    (shortRead.minHonoured === false ? " — min_market_date NOT honoured, older rows were cut locally" : "") +
    (shortRead.truncated ? `, ${shortRead.truncated} batch(es) at the row limit` : "") +
    `; insiders ${insiderRead.rows.length} row(s) in ${insiderRead.calls} call(s)`);

  const deep = await readDeepOwnership(uw, deepTickers, { sessionDate, deadline, pool, width });
  const { parts: ownership, future } = ownershipParts({
    tickers: carded, deepTickers, shortInterestRows: shortRead.rows, insiderRows: insiderRead.rows,
    deep: deep.byTicker, screenerByTicker, sessionDate,
    insidersRead: insiderRead.calls > insiderRead.failed, shortRead: shortRead.calls > shortRead.failed,
  });
  say(`  deep ownership: ${deep.byTicker.size} of ${deepTickers.length} name(s) read in ${deep.calls} call(s)` +
    (future ? `; ${future} short-interest row(s) dated after the session were cut` : ""));

  const earningsTickers = [...new Set([...deepTickers, ...windowTickers])];
  const rawCatalysts = await readCatalysts(uw, { sessionDate, earningsTickers, deadline, pool, width });
  const { additions, earnings } = assembleCatalysts(rawCatalysts, {
    sessionDate, carded: new Set(carded), reportCatalysts, windowTickers, screenerByTicker,
  });
  say(`  catalysts: ${rawCatalysts.calls} call(s); macro ${additions.macro.status}` +
    `${additions.macro.rows ? ":" + additions.macro.rows.length : ""}, fda ${additions.fda.status}` +
    `${additions.fda.rows ? ":" + additions.fda.rows.length : ""}, calendar ${additions.earningsCalendar.status}` +
    `, earnings history ${[...earnings.values()].filter((e) => e.status === "ok").length}/${earnings.size}`);

  return {
    universe, regime, indexRows: index.rows, eventsAdditions: additions,
    ownership, earnings, calls: meter(), lines, readAt, harvested,
  };
}

export function totalsHistory(rows, { sessionDate = null } = {}) {
  return compactNumbers(putCallHistory(rows, { sessionDate }));
}

export function windowTickersOf(rows, {
  origin = null, sessions = EARNINGS_WINDOW_SESSIONS, cap = EARNINGS_WINDOW_CAP,
} = {}) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = r && isoDay(r.next_earnings_date);
    if (!r || !r.ticker || !d || !origin) continue;
    const sdte = sessionsBetween(origin, d);
    if (sdte === null || sdte > sessions) continue;
    out.push({ t: r.ticker, sdte, cap: vnum(r.marketcap) ?? -1 });
  }
  return out
    .sort((a, b) => a.sdte - b.sdte || b.cap - a.cap || (a.t < b.t ? -1 : 1))
    .slice(0, cap)
    .map((x) => x.t);
}
