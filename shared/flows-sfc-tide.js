import { centsOf } from "./flows-sides.js";
import { SECTORS, TIDE_ETFS, safe } from "./flows-sfc.js";
import { trtStamp, dayLabel } from "./flows-sfc-time.js";

export const TIDE_UNITS = Object.freeze({
  ncp: "USD, cumulative net call premium (ask - bid)",
  npp: "USD, cumulative net put premium (ask - bid)",
});

export const INTRADAY_GAP_MS = 15 * 60 * 1000;

export const CLOSE_GAP_MS = 5 * 60 * 1000;

const obj = (v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? v : null);

function lastPair(feed, stamps) {
  const calls = Array.isArray(feed.ncp) ? feed.ncp : [];
  const puts = Array.isArray(feed.npp) ? feed.npp : [];
  for (let i = Math.min(calls.length, puts.length) - 1; i >= 0; i--) {
    if (calls[i] === null || calls[i] === undefined || puts[i] === null || puts[i] === undefined) continue;
    const c = centsOf(calls[i], { signed: true });
    const p = centsOf(puts[i], { signed: true });
    if (c === null || p === null) return null;
    const at = Array.isArray(stamps) && typeof stamps[i] === "string" ? Date.parse(stamps[i]) : NaN;
    return { calls: c.cents, puts: p.cents, at: Number.isFinite(at) ? at : null };
  }
  return null;
}

function feedTide(feed, session, stamps, label) {
  if (!feed) return { ok: false, reason: `No tide for ${label}.` };
  if (feed.status !== "ok" && feed.status !== "prior") {
    return { ok: false, reason: feed.status === "quiet" ? "Sector tide is quiet for this session." : "Sector tide is unreadable." };
  }
  if (typeof feed.date !== "string" || feed.date !== session) {
    return { ok: false, mismatch: typeof feed.date === "string" ? feed.date : null, reason: feed.date ? `Sector tide is for ${dayLabel(feed.date)}.` : "Sector tide has no date." };
  }
  const pair = lastPair(feed, stamps);
  if (pair === null) return { ok: false, reason: "Sector tide holds no reading." };
  return { ok: true, calls: pair.calls, puts: pair.puts, at: pair.at, date: feed.date };
}

export function readTides(breadth, session, { asOf, close, intraday }) {
  const payload = obj(breadth);
  const out = { sectors: new Map(), etf: new Map(), reasons: new Map(), mismatch: null, dates: new Set(), unitsOk: false, lastAt: null };
  if (!payload) return out;
  const units = obj(payload.units);
  out.unitsOk = !!units && units.ncp === TIDE_UNITS.ncp && units.npp === TIDE_UNITS.npp;
  const block = obj(payload.sectors);
  const rows = block ? obj(block.rows) : null;
  const stamps = block ? block.t : null;
  const judge = (tide) => {
    if (!out.unitsOk) return { reason: "Sector tide units are not the expected ones." };
    if (!tide.ok) {
      if (tide.mismatch) { out.mismatch = tide.mismatch; out.dates.add(tide.mismatch); }
      return { reason: tide.reason };
    }
    out.dates.add(tide.date);
    if (tide.at !== null) out.lastAt = out.lastAt === null ? tide.at : Math.max(out.lastAt, tide.at);
    if (tide.at !== null && intraday && Number.isFinite(asOf) && Math.abs(asOf - tide.at) > INTRADAY_GAP_MS) {
      return { reason: `Sector tide ends at ${trtStamp(tide.at, session)}, over 15 minutes from the windows.` };
    }
    if (tide.at !== null && !intraday && Number.isFinite(close) && tide.at < close - CLOSE_GAP_MS) {
      return { reason: `Sector tide ends at ${trtStamp(tide.at, session)}, before the close.` };
    }
    return { entry: { calls: tide.calls, puts: tide.puts, at: tide.at } };
  };
  for (const sector of SECTORS) {
    const r = judge(feedTide(rows ? obj(rows[sector]) : null, session, stamps, "this sector"));
    if (r.entry) out.sectors.set(sector, r.entry); else out.reasons.set(sector, r.reason);
  }
  const etf = obj(payload.etf);
  for (const ticker of TIDE_ETFS) {
    const feed = etf ? obj(etf[ticker]) : null;
    const r = judge(feedTide(feed, session, feed ? feed.t : null, ticker));
    if (r.entry) out.etf.set(ticker, r.entry); else out.reasons.set(ticker, r.reason);
  }
  return out;
}

export const sectorTides = (tides) => new Map([...tides.sectors].map(([k, v]) => [k, { calls: safe(v.calls), puts: safe(v.puts) }]));
