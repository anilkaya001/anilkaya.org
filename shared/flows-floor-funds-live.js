import { LIVE_KEYS, freshEnvelope, failed, sectorEtfsDay } from "./flows-live.js";
import { FLOOR_FUNDS, candidatesOf, fundRows, missingAfter, readList, rowsOf } from "./flows-floor-funds.js";
import { pathFor } from "./flows-vendor-ops.js";

export const FUNDS_KEY = "live:funds";

export const FUNDS_WRITERS = Object.freeze({ tick: "worker@funds", fill: "worker@fill" });

export const FUNDS_READ = Object.freeze({ path: pathFor("screener-stocks"), sectorPath: pathFor("sector-etfs"), limit: 500 });

export const FUNDS_FILL = Object.freeze({ maxCalls: 2, markerS: 60 });

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function fundsReadParams(date = null) {
  return { ticker: readList().join(","), limit: FUNDS_READ.limit, ...(typeof date === "string" && DAY_RE.test(date) ? { date } : {}) };
}

const answered = (raw) => Boolean(raw) && !failed(raw);

export function sectorEtfsOf(raw) {
  return answered(raw) && rowsOf(raw).length ? { rows: rowsOf(raw), date: sectorEtfsDay(raw) } : null;
}

export function marketSectors(row, session) {
  if (!row || row.session !== session || typeof row.sectors !== "string") return null;
  let s = null;
  try { s = JSON.parse(row.sectors); } catch { s = null; }
  const list = s && s.status === "ok" && Array.isArray(s.rows) ? s.rows : [];
  const rows = list.filter((r) => r && typeof r.etf === "string").map((r) => ({
    ticker: r.etf, call_premium: r.callPrem, put_premium: r.putPrem, call_volume: r.callVol, put_volume: r.putVol,
    bullish_premium: r.bull, bearish_premium: r.bear,
  }));
  return rows.length ? { rows, date: session } : null;
}

export function needsSectorRead(raw, session, sectorEtfs = null) {
  const screener = answered(raw) ? { rows: rowsOf(raw), date: session } : null;
  return missingAfter({ session, screener, sectorEtfs, tickers: [...FLOOR_FUNDS.funds, ...FLOOR_FUNDS.etf] }).length > 0;
}

export function shapeFunds(raw, { at, session, writer, sectorEtfs = null } = {}) {
  const screener = answered(raw) ? { rows: rowsOf(raw), date: session } : null;
  const { rows, counts } = fundRows(candidatesOf({ screener, sectorEtfs, volume: new Map() }), session);
  const spec = LIVE_KEYS[FUNDS_KEY];
  return {
    v: 1, key: FUNDS_KEY, session,
    status: counts.read === 0 ? "unavailable" : counts.read < counts.listed * 0.9 ? "partial" : "ok",
    fresh: freshEnvelope({ readAt: at, source: spec.writer, cadenceS: spec.cadenceS, session, writer }),
    units: { prem: "usd", vol: "contracts", net: "usd" },
    basis: "whole-session options activity per fund, as the feed reports it",
    counts, rows,
  };
}

export function fundsNote(stored) {
  const p = stored && typeof stored === "object" && stored.payload && typeof stored.payload === "object" ? stored.payload : null;
  if (!p || p.key !== FUNDS_KEY || !p.rows || typeof p.rows !== "object") return "live:funds: no row is held yet; the Worker's funds tick or a reader's fill writes it";
  const f = p.fresh && typeof p.fresh === "object" ? p.fresh : {};
  const c = p.counts && typeof p.counts === "object" ? p.counts : null;
  const read = c && Number.isInteger(c.read) && Number.isInteger(c.listed) ? `${c.read} of ${c.listed} funds read` : "fund count not stated";
  return `live:funds: held row by ${f.writer || "an unnamed writer"}, session ${p.session || "not stated"}, read ${f.readAt || "not stated"}, ${read}`;
}
