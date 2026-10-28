import { read, rowsOf } from "./common.mjs";
import { pathFor } from "../../shared/flows-vendor-ops.js";
import { sectorEtfsDay } from "../../shared/flows-live.js";
import {
  FLOOR_FUNDS, FUNDS_FALLBACK_MAX, FUNDS_INFO_ROTATE, carryMeta, fitFunds, fundActivity, metaFrom, missingAfter,
  planFallback, readList, rotationPlan,
} from "../../shared/flows-floor-funds.js";

const DIR_REFRESH_DAYS = 7;

const dayN = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 86400000);

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

const refusedStatus = (s) => s === 401 || s === 402 || s === 403 || s === 422 || s === 429;

export const unavailable = (why) => Object.freeze({ v: 1, status: "unavailable", why });

export async function runFundsLeg({
  session, readAt, uw, prior = null, mode = "on", screenerDated = true, cap = FUNDS_FALLBACK_MAX, rotate = FUNDS_INFO_ROTATE,
  run = async (items, work) => ({ results: await Promise.all(items.map(work)) }), stop = () => false,
}) {
  if (mode === "off") return { v: 1, status: "off" };
  if (!isDay(session)) return unavailable("no_session");
  const list = readList();
  const reasons = new Map();
  const calls = { screener: 0, sectorEtfs: 0, volume: 0, info: 0, weights: 0, flow: 0, directory: 0 };

  calls.screener++;
  const sc = await read(uw, pathFor("screener-stocks"), { ticker: list.join(","), limit: 500, ...(screenerDated ? { date: session } : {}) });
  const screener = sc.ok ? { rows: rowsOf(sc.body), date: session } : null;
  if (!sc.ok) console.warn(`  funds: screener read failed — ${sc.error}`);

  let sectorEtfs = null;
  const shortOfSector = missingAfter({ session, screener, sectorEtfs: null, tickers: [...FLOOR_FUNDS.funds, ...FLOOR_FUNDS.etf] });
  if (shortOfSector.length && !stop()) {
    calls.sectorEtfs++;
    const se = await read(uw, pathFor("sector-etfs"), {});
    if (se.ok) sectorEtfs = { rows: rowsOf(se.body), date: sectorEtfsDay(se.body) };
  }

  const missing = missingAfter({ session, screener, sectorEtfs, tickers: list });
  const plan = planFallback(missing, cap);
  for (const t of plan.overCap) reasons.set(t, "over_cap");
  const volume = new Map();
  if (plan.read.length && !stop()) {
    calls.volume += plan.read.length;
    await run(plan.read, async (t) => {
      const r = await read(uw, pathFor("options-volume", { ticker: t }), { limit: 1 });
      if (r.ok) volume.set(t, r.body);
      else reasons.set(t, refusedStatus(r.status) ? "refused" : "failed");
    });
  }

  const priorMeta = prior && prior.meta && typeof prior.meta === "object" ? prior.meta : {};
  const meta = carryMeta(priorMeta, session);
  const due = stop() ? [] : rotationPlan({ prior: priorMeta, today: session, list, cap: rotate });
  if (due.length) {
    await run(due, async (t) => {
      calls.info++; calls.weights++; calls.flow++;
      const [info, weights, flow] = await Promise.all([
        read(uw, pathFor("etf-info", { ticker: t }), {}),
        read(uw, pathFor("etf-weights", { ticker: t }), {}),
        read(uw, pathFor("etf-in-outflow", { ticker: t }), {}),
      ]);
      if (!info.ok && !weights.ok && !flow.ok) return;
      const m = metaFrom({ at: readAt, info: info.ok ? info.body : null, weights: weights.ok ? weights.body : null, flow: flow.ok ? flow.body : null, prior: meta.get(t) || null });
      if (m) meta.set(t, m);
    });
  }

  let dir = prior && prior.dir && typeof prior.dir === "object" ? prior.dir : null;
  const dirAge = dir && isDay(dir.at) ? dayN(session) - dayN(dir.at) : Infinity;
  if (dirAge >= DIR_REFRESH_DAYS && !stop()) {
    calls.directory++;
    const d = await read(uw, pathFor("ticker-exchanges"), {});
    const listed = new Set(rowsOf(d && d.body).map((r) => r && typeof r.ticker === "string" ? r.ticker.toUpperCase() : null).filter(Boolean));
    if (d.ok && listed.size > 50) dir = { at: session, absent: list.filter((t) => !listed.has(t)) };
  }
  if (dir && Array.isArray(dir.absent)) for (const t of dir.absent) if (!reasons.has(t) || reasons.get(t) === "over_cap") reasons.set(t, "not_listed");

  const block = fundActivity({ session, readAt, screener, sectorEtfs, volume, reasons, meta, mode });
  if (dir) block.dir = dir;
  block.calls = calls;
  return fitFunds(block);
}
