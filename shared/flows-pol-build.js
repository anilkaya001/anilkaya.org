import { buildPolitical } from "./flows-political.js";
import { LAYER_CAPS, heldRows, lateRows, moneyRows, unusualRows } from "./flows-pol-layers.js";

const failure = (v) => (v && typeof v === "object" && !Array.isArray(v) && typeof v.__failed === "string" ? v.__failed : null);

const rowsOf = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.data) ? v.data : []);

function worst(marks) {
  if (marks.includes("plan")) return "plan";
  if (marks.includes("budget")) return "budget";
  return "failed";
}

function state(parts, hasRows, hasQuiet = true) {
  const marks = parts.map(failure).filter(Boolean);
  const present = parts.filter((p) => p !== undefined && p !== null && !failure(p)).length;
  if (!present) return { status: marks.length ? "unavailable" : "pending", why: marks.length ? worst(marks) : "unread" };
  if (hasRows) return { status: marks.length ? "partial" : "ok", ...(marks.length ? { why: worst(marks) } : {}) };
  return { status: hasQuiet ? "quiet" : "ok" };
}

export function buildLayers(layers, { sessionDate = null } = {}) {
  const l = layers || {};
  const chambers = {};
  for (const d of rowsOf(l.disclosures)) if (d && typeof d.politician_id === "string") chambers[d.politician_id] = d.chamber;
  const idNames = {};
  for (const r of rowsOf(failure(l.politicians) ? null : l.politicians)) if (r && typeof r.politician_id === "string" && typeof r.name === "string") idNames[r.politician_id] = r.name;
  for (const r of rowsOf(failure(l.people) ? null : l.people)) if (r && typeof r.id === "string" && typeof r.name === "string" && !idNames[r.id]) idNames[r.id] = r.name;
  const traders = Array.isArray(l.trader) ? l.trader.filter((t) => t && !failure(t.rows)).map((t) => ({ id: t.id, name: t.name, rows: rowsOf(t.rows) })) : [];
  const lateParts = [l.cgLate, l.ppRecent, l.polTrades];
  const late = lateRows(
    [["cg", rowsOf(l.cgLate)], ["pp", rowsOf(l.ppRecent)], ["pol", rowsOf(l.polTrades)]],
    { chambers, trader: traders, idNames },
  );
  const lateOut = {
    ...state(lateParts, late.rows.length > 0),
    window: late.window, rows: late.rows, byT: late.byT, filers: late.filers, seen: late.seen,
  };
  const chart = l.chart && !failure(l.chart) ? l.chart : null;
  const unusual = unusualRows([rowsOf(l.unusual), rowsOf(l.unusualTickers)], chart, { chambers, idNames });
  const statsKeys = l.stats && !failure(l.stats) && l.stats.data && typeof l.stats.data === "object" ? Object.keys(l.stats.data).length : null;
  const unusualOut = {
    ...state([l.unusual, l.unusualTickers, l.chart], unusual.rows.length > 0),
    rows: unusual.rows, byT: unusual.byT, top: unusual.top, groups: [], statsKeys, seen: unusual.seen, other: unusual.other,
  };
  const contrib = {};
  for (const [t, body] of Object.entries(l.fecContrib || {})) if (!failure(body)) contrib[t] = body;
  const money = moneyRows(rowsOf(failure(l.fecCompanies) ? null : l.fecCompanies), l.cycle, contrib, failure(l.fecCandidates) ? null : l.fecCandidates);
  const moneyOut = l.moneyCarry ? { ...l.moneyCarry } : {
    ...state([l.fecCompanies, l.fecCandidates], money.usable > 0),
    cycle: money.cycle, asOf: sessionDate, byT: money.byT, candidates: money.candidates,
  };
  const held = heldRows((Array.isArray(l.portfolios) ? l.portfolios : []).filter((p) => p && !failure(p)));
  const heldOut = l.heldCarry ? { ...l.heldCarry } : {
    ...state(Array.isArray(l.portfolios) && l.portfolios.length ? l.portfolios : [undefined], held.portfolios !== null),
    asOf: sessionDate, byT: held.byT, portfolios: held.portfolios,
  };
  return { late: lateOut, unusual: unusualOut, money: moneyOut, held: heldOut, plan: { ...(l.plan || {}) } };
}

export function buildPoliticalWithLayers(raws) {
  const base = buildPolitical(raws);
  if (!raws || !raws.layers) return base;
  return { ...base, ...buildLayers(raws.layers, { sessionDate: raws.sessionDate || null }) };
}

export function fitPolitical(payload, cap = 120 * 1024) {
  if (JSON.stringify(payload).length <= cap) return payload;
  const out = JSON.parse(JSON.stringify(payload));
  if (out.late && Array.isArray(out.late.rows)) out.late.rows = out.late.rows.slice(0, LAYER_CAPS.lateKept);
  if (JSON.stringify(out).length <= cap) return out;
  if (out.unusual && Array.isArray(out.unusual.rows)) out.unusual.rows = out.unusual.rows.slice(0, LAYER_CAPS.unusualRows);
  return out;
}
