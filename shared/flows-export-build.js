import {
  ALLOW, BAND_EDGES_CENTS, BAND_LABELS, LEAN_REASONS, MAX_ROWS, METHOD_VERSION, MIN_WINDOWS, REASONS, pageHold as holdOf, plan,
} from "./flows-columns.js";
import { DASH, absentCell, fixed, ratioDigits, textCell } from "./flows-export-format.js";
import { decodeColumn } from "./flows-cross.js";
import { capped, dayOf, flowSession, pooled, tickerOf, windowsByTicker } from "./flows-member-windows.js";
import { stamp, day as trtDay, instantOf } from "./flows-time.js";
import { contaminated } from "./flows-member-calendar.js";
import { moveZ } from "./flows-member-state.js";

export const EXPORT_PAGES = Object.freeze(Object.keys(ALLOW));

export const EXPORT_FORMATS = Object.freeze(["csv", "json"]);

export const EXPORT_SOURCES = Object.freeze({
  moves: Object.freeze(["universe", "flowalerts"]),
  unusual: Object.freeze(["flowalerts", "board:long", "board:short"]),
  events: Object.freeze(["events", "universe"]),
  political: Object.freeze(["political"]),
});

export const pageHold = (page) => holdOf(page);

export { dedupeWindows } from "./flows-member-windows.js";

const NOTES = Object.freeze({
  moves: Object.freeze(["Flow figures cover the windows the night record kept: the largest by premium."]),
  unusual: Object.freeze(["Figures cover the windows the night record kept: the largest by premium."]),
  events: Object.freeze([]),
  political: Object.freeze(["The feed lists only names with at least one purchase, so net_n leans positive by construction."]),
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const cutNote = (shown, available) => "Cut at " + grouped(shown) + " of " + grouped(available) + " rows, in the order of this file. The rest are not in it.";
const byTicker = (a, b) => (a.values.ticker < b.values.ticker ? -1 : a.values.ticker > b.values.ticker ? 1 : 0);

export function bandOf(totalCents) {
  for (let i = 0; i < BAND_EDGES_CENTS.length; i += 1) if (totalCents < BAND_EDGES_CENTS[i]) return BAND_LABELS[i];
  return BAND_LABELS[BAND_LABELS.length - 1];
}

function column(universe, key) {
  if (!isObj(universe) || !isObj(universe.cols) || !isObj(universe.units)) return null;
  const col = universe.cols[key];
  const unit = universe.units[key];
  if (!Array.isArray(col) || !Array.isArray(unit) || !(num(unit[1]) > 0)) return null;
  return decodeColumn(col, unit[1]);
}

const reasonOfLean = (why) => {
  if (!Object.hasOwn(LEAN_REASONS, why)) throw new Error("export: lean reason without a mapping: " + String(why));
  return LEAN_REASONS[why];
};

function flowCells(rows) {
  const values = {};
  const why = {};
  const absentAll = (reason) => {
    for (const k of ["ask_share", "ask_share_lo", "ask_share_hi", "coverage", "lean"]) { values[k] = null; why[k] = reason; }
  };
  if (rows.length === 0) { absentAll("no_windows"); return { values, why, n: 0, p: null }; }
  const p = pooled(rows);
  if (p.totals.n === 0) { absentAll("no_windows"); return { values, why, n: 0, p }; }
  if (p.totals.n < MIN_WINDOWS) { absentAll("few_windows"); return { values, why, n: p.totals.n, p }; }
  const { T, A, B } = p.totals;
  const r = p.read;
  values.ask_share_lo = ratioDigits(A, T, 4);
  values.ask_share_hi = ratioDigits(T - B, T, 4);
  values.coverage = ratioDigits(A + B, T, 4);
  if (r.share === null) {
    values.ask_share = null;
    why.ask_share = reasonOfLean(r.why);
    values.lean = null;
    why.lean = reasonOfLean(r.why);
  } else {
    values.ask_share = ratioDigits(A, A + B, 4);
    values.lean = r.side;
  }
  return { values, why, n: p.totals.n, p };
}

function movesRows(s) {
  const u = s.universe;
  if (!isObj(u) || !Array.isArray(u.t)) return { rows: [], sources: [], session: null };
  const sig = column(u, "sig");
  const chg = column(u, "chg");
  const rd = column(u, "rd");
  const flow = s.flowalerts;
  const session = dayOf(u.sessionDate);
  const flowOk = isObj(flow) && Array.isArray(flow.rows);
  const sameSession = flowOk && flowSession(flow) === session;
  const by = sameSession ? windowsByTicker(flow) : new Map();
  const rows = [];
  for (let i = 0; i < u.t.length; i += 1) {
    const ticker = tickerOf(u.t[i]);
    if (ticker === null) continue;
    const values = { ticker, sig: null, rd: null };
    const why = {};
    const sg = sig === null ? null : sig[i];
    const c = chg === null ? null : chg[i];
    const z = moveZ(c === undefined ? null : c, sg === undefined ? null : sg);
    values.sig = sg === null || sg === undefined || !(sg > 0) ? null : sg;
    if (z.z === null) { values.move_z = null; why.move_z = z.why; } else values.move_z = z.z;
    const rv = rd === null ? undefined : rd[i];
    if (Number.isFinite(rv)) values.rd = rv; else { values.rd = null; why.rd = "rd_pending"; }
    if (!flowOk) {
      for (const k of ["ask_share", "ask_share_lo", "ask_share_hi", "coverage", "lean"]) { values[k] = null; why[k] = "flow_missing"; }
    } else if (!sameSession) {
      for (const k of ["ask_share", "ask_share_lo", "ask_share_hi", "coverage", "lean"]) { values[k] = null; why[k] = "flow_session"; }
    } else {
      const cells = flowCells(by.get(ticker) || []);
      Object.assign(values, cells.values);
      Object.assign(why, cells.why);
    }
    rows.push({ values, why });
  }
  rows.sort(byTicker);
  const sources = [{ name: "universe", session: session, at: u.generatedAt }];
  if (sameSession) sources.push({ name: "flowalerts", session: flowSession(flow), at: flow.generatedAt });
  return { rows, sources, session };
}

function boardScores(boards, session) {
  const map = new Map();
  let other = false;
  let loaded = false;
  const used = [];
  for (const key of ["board:long", "board:short"]) {
    const b = boards[key];
    if (!isObj(b) || !Array.isArray(b.rows)) continue;
    loaded = true;
    if (dayOf(b.sessionDate) !== session) { other = true; continue; }
    used.push({ name: key, session, at: b.generatedAt });
    for (const r of b.rows) {
      const t = tickerOf(r && r.t);
      const sc = num(r && r.s);
      if (t !== null && sc !== null && !map.has(t)) map.set(t, sc);
    }
  }
  return { map, loaded, other, used };
}

function unusualRows(s) {
  const flow = s.flowalerts;
  if (!isObj(flow) || !Array.isArray(flow.rows)) return { rows: [], sources: [], session: null };
  const session = flowSession(flow);
  const by = windowsByTicker(flow);
  const board = boardScores({ "board:long": s["board:long"], "board:short": s["board:short"] }, session);
  const cap = capped(flow);
  const rows = [];
  for (const [ticker, windows] of by) {
    const cells = flowCells(windows);
    if (cells.n === 0) continue;
    const values = { ticker };
    const why = {};
    if (cap) {
      values.windows_n = null; why.windows_n = "record_capped";
      values.premium_band = null; why.premium_band = "record_capped";
    } else {
      values.windows_n = cells.n;
      if (cells.n < MIN_WINDOWS) { values.premium_band = null; why.premium_band = "few_windows"; } else values.premium_band = bandOf(cells.p.totals.T);
    }
    for (const k of ["ask_share", "ask_share_lo", "ask_share_hi", "coverage"]) {
      values[k] = cells.values[k];
      if (cells.why[k]) why[k] = cells.why[k];
    }
    if (cells.n < MIN_WINDOWS) {
      values.negotiated_share = null; why.negotiated_share = "few_windows";
      values.sweep_share = null; why.sweep_share = "few_windows";
    } else {
      const p = cells.p;
      if (p.floorMissing) { values.negotiated_share = null; why.negotiated_share = "floor_partial"; } else values.negotiated_share = ratioDigits(p.floorT, p.totals.T, 4);
      if (p.sweepMissing) { values.sweep_share = null; why.sweep_share = "sweep_partial"; } else values.sweep_share = ratioDigits(p.sweepT, p.totals.T, 4);
    }
    if (board.map.has(ticker)) values.score = board.map.get(ticker);
    else { values.score = null; why.score = board.loaded && board.other && board.used.length === 0 ? "board_session" : "no_board"; }
    rows.push({ values, why });
  }
  rows.sort(byTicker);
  return { rows, sources: [{ name: "flowalerts", session, at: flow.generatedAt }, ...board.used], session };
}

function eventsRows(s) {
  const e = s.events;
  if (!isObj(e) || !Array.isArray(e.rows)) return { rows: [], sources: [], session: null };
  const u = s.universe;
  const rd = column(u, "rd");
  const index = isObj(u) && Array.isArray(u.t) ? new Map(u.t.map((t, i) => [t, i])) : new Map();
  const rows = [];
  for (const r of e.rows) {
    const ticker = tickerOf(r && r.t);
    if (ticker === null) continue;
    const values = { ticker, event_type: "earnings" };
    const why = {};
    const until = num(r.sdte);
    if (until === null) {
      values.sessions_until = null; why.sessions_until = "no_event_date";
      values.contamination = null; why.contamination = "no_event_date";
    } else {
      values.sessions_until = until;
      values.contamination = contaminated(until);
    }
    const i = index.get(ticker);
    const rv = rd === null || i === undefined ? undefined : rd[i];
    if (Number.isFinite(rv)) values.rd = rv; else { values.rd = null; why.rd = "rd_pending"; }
    rows.push({ values, why, until: until === null ? Infinity : until });
  }
  rows.sort((a, b) => a.until - b.until || byTicker(a, b));
  return { rows, sources: [{ name: "events", session: dayOf(e.sessionDate), at: e.generatedAt }], session: dayOf(e.sessionDate) };
}

function politicalRows(s) {
  const p = s.political;
  const feed = isObj(p) && isObj(p.assets) && Array.isArray(p.assets.rows) ? p.assets.rows : null;
  if (feed === null) return { rows: [], sources: [], session: null };
  const rows = [];
  for (const r of feed) {
    const ticker = tickerOf(r && r.t);
    const buys = num(r && r.buys);
    const sells = num(r && r.sells);
    if (ticker === null || buys === null || sells === null) continue;
    rows.push({
      values: {
        ticker, transactions_n: buys + sells, buys_n: buys, sells_n: sells, net_n: buys - sells, house_n: null, senate_n: null, score: null,
      },
      why: { house_n: "no_chamber", senate_n: "no_chamber", score: "no_pol_score" },
    });
  }
  rows.sort(byTicker);
  return { rows, sources: [{ name: "political", session: dayOf(p.sessionDate), at: p.generatedAt }], session: dayOf(p.sessionDate) };
}

const BUILDERS = Object.freeze({ moves: movesRows, unusual: unusualRows, events: eventsRows, political: politicalRows });

function cellText(col, value) {
  if (value === null || value === undefined) return DASH;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return col.dp === null ? String(value) : fixed(value, col.dp);
  return col.unit === "fraction" ? value : textCell(value);
}

function cellJson(col, value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return col.dp === null ? value : Number(fixed(value, col.dp));
  return col.unit === "fraction" ? Number(value) : value;
}

export function buildExport(page, sources, { now, format = "csv", limit = MAX_ROWS, holds, pageHolds, forbidden } = {}) {
  if (!Object.hasOwn(BUILDERS, page)) throw new Error("export: unknown page " + String(page));
  if (!EXPORT_FORMATS.includes(format)) throw new Error("export: unknown format " + String(format));
  const options = {};
  if (holds !== undefined) options.holds = holds;
  if (pageHolds !== undefined) options.pageHolds = pageHolds;
  if (forbidden !== undefined) options.forbidden = forbidden;
  const specs = plan(page, options);
  const header = specs.map((c) => c.key);
  const body = specs.filter((c) => !["asof_trt", "method_version", "absent"].includes(c.key));
  const built = BUILDERS[page](sources || {});
  const known = new Set(body.map((c) => c.key));
  for (const r of built.rows) {
    for (const k of Object.keys(r.values)) {
      if (!known.has(k)) throw new Error("export: a row carries a column the allowlist does not name: " + k);
    }
  }
  const instants = built.sources.map((x) => (x.at === null || x.at === undefined ? null : instantOf(x.at))).filter((x) => x !== null);
  const asofMs = instants.length ? Math.min(...instants) : instantOf(now);
  const asofText = stamp(asofMs);
  const available = built.rows.length;
  const shown = built.rows.slice(0, limit);
  const lines = [];
  const objects = [];
  for (const r of shown) {
    const entries = [];
    const cells = [];
    const obj = { asof_trt: asofText, method_version: METHOD_VERSION };
    for (const c of body) {
      if (c.held !== null) {
        cells.push(DASH);
        obj[c.key] = null;
        entries.push([c.key, REASONS[c.held.reason]]);
        continue;
      }
      const v = r.values[c.key] === undefined ? null : r.values[c.key];
      cells.push(cellText(c, v));
      obj[c.key] = cellJson(c, v);
      if (v === null) {
        const reason = r.why[c.key];
        if (reason === undefined) throw new Error("export: an absent cell without a reason: " + c.key);
        if (!Object.hasOwn(REASONS, reason)) throw new Error("export: a reason that is not in the table: " + String(reason));
        entries.push([c.key, REASONS[reason]]);
      }
    }
    const absent = absentCell(entries);
    obj.absent = absent;
    lines.push([textCell(asofText), METHOD_VERSION, ...cells, absent].join(","));
    objects.push(obj);
  }
  const truncated = available > shown.length;
  const published = {
    page, asof_trt: asofText, session_date: built.session, method_version: METHOD_VERSION, rows: shown.length, available, truncated,
    generated_trt: stamp(now),
    sources: built.sources.map((x) => ({ name: x.name, session_date: x.session, generated_trt: x.at === null || x.at === undefined ? null : stamp(instantOf(x.at)) })),
    columns: specs.map((c) => ({ key: c.key, label: c.label, unit: c.unit, prov: c.prov, dp: c.dp, held: c.held ? c.held.reason : null })),
    notes: [...NOTES[page]],
  };
  const cutLine = truncated ? [textCell(cutNote(shown.length, available)), ...header.slice(1).map(() => "")].join(",") : null;
  const out = format === "csv"
    ? "\uFEFF" + [header.join(","), ...lines, ...(cutLine === null ? [] : [cutLine])].join("\r\n") + "\r\n"
    : JSON.stringify({ meta: published, rows: objects });
  const meta = { ...published, asofDay: trtDay(asofMs), methodVersion: METHOD_VERSION };
  return { header, rows: shown, objects, body: out, meta, type: format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8" };
}

export const exportFileName = (page, day, format, cut = null) =>
  "flows-" + page + "-" + day + "-TRT" + (cut ? "-cut-" + cut.shown + "-of-" + cut.available : "") + "." + format;
