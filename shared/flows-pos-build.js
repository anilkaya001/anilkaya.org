import { TRACK, filingChanges, filingRows, planFilers, rotation, sectorEntry, trackFilers, isDay } from "./flows-pos-13f.js";
import { insiderFlow } from "./flows-pos-insider.js";
import { shortView } from "./flows-pos-short.js";

export const POSITIONING_VERSION = 1;

export const POSITIONING_CAP_BYTES = 96 * 1024;

const failedMark = (v) => v && typeof v === "object" && !Array.isArray(v) && v.__failed;

const partOf = (part) => (part && typeof part === "object" && part.x && !part.fail && !part.shed ? part : null);

function holdingsAsActivity(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ ticker: r && r.ticker, units_change: r && r.units_change, price_on_report: r && r.close }));
}

export function nextLedger(tracked, prior, reads, activity, holdings, universe, sessionDate) {
  const old = prior && prior.filerLedger && typeof prior.filerLedger === "object" ? prior.filerLedger : {};
  const out = {};
  for (const f of tracked) {
    const e = old[f.cik] && typeof old[f.cik] === "object" ? { ...old[f.cik] } : { rows: [], qs: [], top: null };
    e.n = f.name; e.h = f.hf; e.t = f.total; e.f = f.filed || e.f || null; e.r = f.report || e.r || null;
    const read = reads && reads[f.cik];
    if (Array.isArray(read)) {
      const fresh = sectorEntry(read, sessionDate);
      if (fresh.rows.length) { e.rows = fresh.rows; e.qs = fresh.qs; e.rd = sessionDate; }
    }
    const act = activity && activity[f.cik];
    const hold = holdings && holdings[f.cik];
    if (Array.isArray(act)) e.top = filingChanges(act, universe);
    else if (Array.isArray(hold)) e.top = filingChanges(holdingsAsActivity(hold), universe);
    out[f.cik] = e;
  }
  return out;
}

function sectionWhy(failed, refused, ids) {
  if (ids.some((id) => refused && refused[id])) return "plan";
  if (ids.some((id) => failed && failed[id])) return "failed";
  return "unread";
}

export function buildPositioning(input) {
  const {
    sessionDate, generatedAt, now = Date.parse(generatedAt), universe = {}, list = [], latest = [],
    sectorsByCik = {}, activityByCik = {}, holdingsByCik = {}, insiderBySector = {}, psByTicker = {}, advByTicker = {},
    prior = null, refused = {}, failed = {}, calls = 0, fixture = false,
  } = input;
  const tracked = trackFilers(list, prior, sessionDate);
  const reads = {};
  for (const [cik, v] of Object.entries(sectorsByCik)) if (!failedMark(v)) reads[cik] = v;
  const activity = {};
  for (const [cik, v] of Object.entries(activityByCik)) if (!failedMark(v)) activity[cik] = v;
  const holdings = {};
  for (const [cik, v] of Object.entries(holdingsByCik)) if (!failedMark(v)) holdings[cik] = v;
  const ledger = nextLedger(tracked, prior, reads, activity, holdings, universe, sessionDate);
  const rot = rotation(tracked, ledger);
  if (rot.status === "pending") {
    const why = sectionWhy(failed, refused, ["inst-sectors", "inst-list"]);
    if (why !== "unread") { rot.status = "unavailable"; rot.why = why; }
  }
  const rows = filingRows(list, latest, ledger);
  const filings = rows.length
    ? { status: "ok", rows }
    : { status: list.length || latest.length ? "quiet" : "unavailable", why: list.length || latest.length ? "window" : sectionWhy(failed, refused, ["inst-list", "inst-latest"]), rows: [] };
  const insiders = insiderFlow(insiderBySector);
  if (insiders.status === "unavailable") insiders.why = sectionWhy(failed, refused, ["insider-sector"]);
  const names = Object.keys(universe).sort().map((t) => ({
    t, sec: universe[t], ftd: partOf(psByTicker[t] && psByTicker[t].ftd), svx: partOf(psByTicker[t] && psByTicker[t].svx),
  }));
  const shorts = shortView(names, advByTicker, now);
  if (shorts.status === "pending") {
    const why = sectionWhy(failed, refused, ["ftds", "short-venues"]);
    shorts.why = why;
    if (why !== "unread") shorts.status = "unavailable";
  }
  const { unread: insiderUnread, bad: insiderBad, ...insidersOut } = insiders;
  const payload = {
    v: POSITIONING_VERSION, sessionDate, generatedAt,
    basis: { calls, refused: { ...refused }, failed: { ...failed }, insiderUnread, insiderBad, tracked: tracked.length },
    rotation: rot,
    filings,
    insiders: insidersOut,
    shorts,
    filerLedger: ledger,
  };
  if (fixture) payload.fixture = true;
  return payload;
}

const size = (o) => JSON.stringify(o).length;

export function fitPositioning(payload, cap = POSITIONING_CAP_BYTES) {
  if (size(payload) <= cap) return payload;
  const out = JSON.parse(JSON.stringify(payload));
  const shed = [];
  const steps = [
    ["filings.top", () => { for (const r of out.filings.rows || []) r.top = null; }],
    ["shorts.top", () => {
      if (out.shorts.ftd) out.shorts.ftd.top = out.shorts.ftd.top.slice(0, 20);
      if (out.shorts.venues) out.shorts.venues.top = out.shorts.venues.top.slice(0, 20);
    }],
    ["insiders.days", () => { for (const s of out.insiders.sectors || []) s.days = s.days.slice(-30); }],
    ["ledger.top", () => { for (const e of Object.values(out.filerLedger || {})) e.top = null; }],
    ["ledger.rows", () => { for (const e of Object.values(out.filerLedger || {})) { e.rows = []; e.qs = []; } }],
  ];
  for (const [name, run] of steps) {
    if (size(out) <= cap) break;
    run();
    shed.push(name);
  }
  out.basis.shed = shed;
  return out;
}

export { TRACK, planFilers, isDay };
