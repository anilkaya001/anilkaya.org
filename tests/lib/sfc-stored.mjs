import { makeWorld, SECTOR_NAMES, SESSION } from "./sfc-world.mjs";
import { TIDE_UNITS } from "../../shared/flows-sfc-tide.js";

export const NOW_INTRADAY = Date.parse("2026-10-23T15:00:00Z");

export const NOW_AFTER = Date.parse("2026-10-24T01:00:00Z");

const stamps = (end, count = 8) => Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * 300000).toISOString());

export function breadthFor(world, { date = world.session, last = null, status = "ok", end = NOW_INTRADAY - 300000 } = {}) {
  const t = stamps(end, 8);
  const rows = {};
  for (const sector of SECTOR_NAMES) {
    const tide = world.tide[sector];
    if (!tide) continue;
    const ncp = t.map((_, i) => (i === t.length - 1 ? tide.calls / 100 : (tide.calls / 100) * (i / t.length)));
    const npp = t.map((_, i) => (i === t.length - 1 ? tide.puts / 100 : (tide.puts / 100) * (i / t.length)));
    rows[sector] = { status, reason: null, date, n: t.length, ncp, npp, net: ncp.map((v, i) => v - npp[i]) };
  }
  const etf = {};
  for (const ticker of ["SPY", "QQQ", "IWM", "DIA"]) etf[ticker] = { status: "ok", reason: null, date, t, ncp: t.map((_, i) => 1000 * i), npp: t.map((_, i) => -500 * i) };
  return {
    v: 1, key: "live:breadth", session: date, units: { ncp: TIDE_UNITS.ncp, npp: TIDE_UNITS.npp, net: "USD, ncp - npp", share: "ratio" },
    sectors: { t, rows }, etf, dte: {},
    ...(last ? { last } : {}),
  };
}

export function recordFor(world, { total = null, shed = 0, at = null } = {}) {
  const rows = world.rows.map(({ raw, d, ...row }) => row);
  const kept = rows.length;
  return {
    v: 2, key: "live:alerts", session: world.session, sessionDate: world.session, readAt: at,
    rows, seen: kept, shed, cap: 180, status: kept ? "ok" : "quiet",
    record: { date: world.session, reads: 3, union: kept, kept, everEntered: total === null ? kept + shed : total, shed, reset: null },
  };
}

export function storedInput(world, { now = NOW_INTRADAY, scope = { kind: "all", key: "all" }, period = null, liveAt = now - 5 * 60000, nightly = false, shed = 0 } = {}) {
  const record = recordFor(world, { shed, at: new Date(liveAt).toISOString() });
  return {
    now, scope, period,
    live: { payload: record, readAt: liveAt, session: world.session },
    nightly: nightly ? { payload: { ...record, readAt: new Date(now - 3600000).toISOString() }, updatedAt: now - 3600000 } : null,
    breadth: { payload: breadthFor(world, { end: liveAt }) },
    universe: world.universe,
    clock: null,
  };
}

export { makeWorld, SESSION };
