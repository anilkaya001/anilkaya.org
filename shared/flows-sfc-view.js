import {
  SECTORS, COLUMNS, FUNDS_COLUMN, NO_SECTOR, TIDE_ETFS, readUniverse, bookWindows, sumBooks, emptyTotals, outsideOf, outsideAll, buildMatrix,
  matrixSums, tiltOf, tiltCoverage, drillSector, deltaMicroOf, unsidedOf, safe,
} from "./flows-sfc.js";
import { leanRead } from "./flows-sides.js";
import { periodPlan, trtStamp, dayLabel } from "./flows-sfc-time.js";
import { sessionClose } from "./flows-freshness.js";
import { readTides, sectorTides } from "./flows-sfc-tide.js";
import { unitFor, cellText, formatUnits, exactDollars, moneyShort, roundGrid, caption, niceScale, scaleText, MINUS, DASH } from "./flows-sfc-display.js";
import { NO_OPEN_INTEREST } from "./flows-sfc-stock.js";
import * as C from "./flows-sfc-copy.js";

export const SCOPE_KINDS = Object.freeze(["all", "sector", "name"]);

const obj = (v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? v : null);

const sign = (n) => (n < 0 ? MINUS : n > 0 ? "+" : "");

const blank = Object.freeze({ t: "", x: null, s: "blank" });

const gone = (r) => ({ t: DASH, x: null, s: "absent", r });

const cell = (exact, units, unit) => ({ t: cellText(exact, units, unit), x: exactDollars(exact), s: exact === 0 ? "zero" : units === 0 ? "tiny" : "ok" });

const ceilUnits = (cents, unit) => Math.ceil(cents / unit.unitCents);

const maxAbs = (list) => list.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

const hashOf = (value) => {
  let h = 2166136261;
  const text = JSON.stringify(value, (k, v) => (typeof v === "bigint" ? String(v) : v));
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, "0");
};

const kindOf = (c) => (c === FUNDS_COLUMN ? "fund" : c === NO_SECTOR ? "none" : "sector");

export function parseScope(raw, { sectors = SECTORS, ticker = /^[A-Z][A-Z0-9.-]{0,9}$/ } = {}) {
  const text = raw === null || raw === undefined || raw === "" ? "all" : String(raw);
  if (text === "all") return { kind: "all", key: "all" };
  const m = /^(sector|name):(.+)$/.exec(text);
  if (!m) return null;
  if (m[1] === "sector") {
    const wanted = [...sectors, FUNDS_COLUMN, NO_SECTOR].find((s) => s === m[2]);
    return wanted ? { kind: "sector", sector: wanted, key: "sector:" + wanted } : null;
  }
  const name = m[2].trim().toUpperCase();
  return ticker.test(name) ? { kind: "name", name, key: "name:" + name } : null;
}

function tideReason(scope, tides) {
  if (scope.kind === "sector") {
    if (scope.sector === FUNDS_COLUMN) return "Tide covers SPY, QQQ, IWM and DIA only.";
    if (scope.sector === NO_SECTOR) return "No tide exists for names without a sector.";
    return tides.reasons.get(scope.sector) || "No sector tide in this scope.";
  }
  if (scope.kind === "name") {
    return TIDE_ETFS.includes(scope.name) ? tides.reasons.get(scope.name) || "No sector tide in this scope." : "No tide for single names.";
  }
  return "No sector tide in this scope.";
}

function scopeOutside(scope, columns, totals, tides) {
  if (scope.kind === "all") {
    const sectors = new Map([...tides.sectors].map(([k, v]) => [k, { calls: safe(v.calls), puts: safe(v.puts) }]));
    return outsideAll(columns, sectors);
  }
  if (scope.kind === "sector") {
    const tide = SECTORS.includes(scope.sector) ? tides.sectors.get(scope.sector) : null;
    return tide ? outsideOf({ calls: safe(tide.calls), puts: safe(tide.puts) }, totals) : null;
  }
  const tide = TIDE_ETFS.includes(scope.name) ? tides.etf.get(scope.name) : null;
  return tide ? outsideOf({ calls: safe(tide.calls), puts: safe(tide.puts) }, totals) : null;
}

function ledgerTable(matrix, outsideReason) {
  const absent = matrix.absentOutside;
  const cols = absent ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5];
  const rowsIdx = matrix.rows.map((_, i) => i).filter((i) => !(absent && (i === 8 || i === 9)));
  const grid = rowsIdx.map((i) => cols.map((c) => matrix.rows[i][c] === null ? 0 : matrix.rows[i][c]));
  const unit = unitFor(maxAbs(grid.flat()));
  const rounded = roundGrid(grid, unit);
  const foots = {
    rows: rounded.cells.every((row) => row.reduce((a, b) => a + b, 0) === 0),
    cols: cols.every((_, k) => rounded.cells.reduce((a, row) => a + row[k], 0) === 0),
  };
  const rows = matrix.rows.map((row, i) => {
    const ri = rowsIdx.indexOf(i);
    const copy = C.ROW_COPY[i];
    const cells = row.map((v, c) => {
      if (ri < 0) return c >= 4 ? gone(outsideReason) : blank;
      if (!cols.includes(c)) return i === 10 ? gone(outsideReason) : blank;
      if (v === null) return blank;
      return cell(v, rounded.cells[ri][cols.indexOf(c)], unit);
    });
    return { id: copy.id, label: copy.label, short: copy.short || copy.label, group: copy.group || null, hover: copy.hover, cells };
  });
  const last = rowsIdx.indexOf(10);
  const net = {
    id: C.NET_ROW.id, label: C.NET_ROW.label, short: C.NET_ROW.label, group: null, hover: C.NET_ROW.hover,
    cells: [0, 1, 2, 3, 4, 5].map((c) => (cols.includes(c) ? cell(-matrix.rows[10][c], -rounded.cells[last][cols.indexOf(c)], unit) : gone(outsideReason))),
  };
  const largest = matrix.rows[10].reduce((m, v) => (v === null ? m : Math.max(m, Math.abs(v))), 0);
  return { unit, caption: caption(unit), keyLine: C.KEY_LINE, zeroLine: C.ZERO_LINE, groups: C.GROUPS, groupRows: C.GROUP_ROWS, columns: C.COLUMN_COPY.map((col, c) => ({ ...col, measured: cols.includes(c) })), rows, net, foots, measured: cols.length, largest };
}

function lineOfLean(lean) {
  if (lean.why) return { shown: false, reason: lean.reason, text: `Lean not shown: ${lean.reason}.` };
  const bounds = lean.pct.lo === lean.pct.hi ? `${lean.pct.lo}%` : `${lean.pct.lo}–${lean.pct.hi}%`;
  return { shown: true, side: lean.side, text: `Takers bought ${lean.pct.share}% of premium with a stated side; bounds ${bounds}.`, bounds, share: lean.pct.share, coverage: lean.pct.coverage };
}

function tiltView(columns, uni, shed) {
  const result = tiltOf(columns, uni.weights);
  const coverage = tiltCoverage(columns, uni.weights);
  const base = { weighted: result.weighted, shed };
  if (!result.weighted.length) return { ...base, status: "absent", reason: C.TILT_LINES.noWeight, rows: [], unweighted: [] };
  if (coverage.all === 0) return { ...base, status: "absent", reason: C.TILT_LINES.noWindows, rows: [], unweighted: [] };
  if (!coverage.passes) return { ...base, status: "absent", reason: C.TILT_LINES.coverageLow(coverage.pct), rows: [], unweighted: [], coverage };
  const rows = result.weighted.map((c) => ({ column: c, ...result.rows.get(c) }));
  const unit = unitFor(maxAbs(rows.flatMap((r) => [safe(r.R), safe(r.W), safe(r.X)])));
  const grid = rows.map((r) => [safe(r.R)]);
  const rounded = roundGrid(grid, unit);
  const out = rows.map((r, i) => {
    const R = safe(r.R);
    const W = safe(r.W);
    const verdict = C.TILT_VERDICT[r.verdict];
    const units = rounded.cells[i][0];
    const bandUnits = ceilUnits(W, unit);
    return {
      key: r.column, label: r.column, verdict: r.verdict, glyph: verdict.glyph, word: verdict.word, long: verdict.long, r: R, w: W, x: safe(r.X), a: safe(r.a),
      t: (R > 0 && units > 0 ? "+" : "") + cellText(R, units, unit), band: formatUnits(bandUnits, unit),
      exact: `${verdict.long} · tilt ${sign(R)}${exactDollars(Math.abs(R))}, band ${exactDollars(W)}`,
      weight: uni.weights.get(r.column),
    };
  });
  out.sort((p, q) => (q.r - p.r) || (p.label < q.label ? -1 : p.label > q.label ? 1 : 0));
  const sum = result.sum === null ? null : safe(result.sum);
  const unweighted = COLUMNS.filter((c) => !result.weighted.includes(c)).map((c) => ({ key: c, label: c, reason: C.TILT_LINES.unweighted, x: columns.has(c) ? safe(columns.get(c).X) : null }));
  const overRows = out.filter((r) => r.verdict === "above");
  const underRows = out.filter((r) => r.verdict === "below");
  const over = overRows.reduce((a, r) => a + r.r, 0);
  const under = underRows.reduce((a, r) => a + r.r, 0);
  return {
    ...base, status: "ok", unit, caption: caption(unit, "delta"), rows: out, unweighted, sum, sumText: formatUnits(rounded.total, unit), coverage,
    footer: overRows.length || underRows.length
      ? `Over +${formatUnits(Math.round(over / unit.unitCents), unit)} · Under ${MINUS}${formatUnits(Math.abs(Math.round(under / unit.unitCents)), unit)} · bars sum to 0`
      : "No sector is over or under beyond its band · bars sum to 0",
  };
}

function sectorTable(columns, selected, tides, uni, tilt) {
  const held = COLUMNS.filter((c) => columns.has(c) && columns.get(c).n > 0);
  const tideCols = SECTORS.filter((c) => tides.sectors.has(c));
  const g1 = held.map((c) => { const t = columns.get(c); return [t.AC - t.BC, t.AP - t.BP]; });
  const g2 = held.map((c) => [unsidedOf(columns.get(c))]);
  const outsideOfCol = (c) => { const o = outsideOf({ calls: safe(tides.sectors.get(c).calls), puts: safe(tides.sectors.get(c).puts) }, columns.get(c) || emptyTotals()); return o.calls + o.puts; };
  const g3 = tideCols.map((c) => [outsideOfCol(c)]);
  const all = [...g1.flat(), ...g1.map((r) => r[0] + r[1]), ...g2.flat(), ...g3.flat()];
  const unit = unitFor(maxAbs(all.length ? all : [0]));
  const r1 = g1.length ? roundGrid(g1, unit) : null;
  const r2 = g2.length ? roundGrid(g2, unit) : null;
  const r3 = g3.length ? roundGrid(g3, unit) : null;
  const tiltRows = new Map((tilt.rows || []).map((r) => [r.key, r]));
  const rows = COLUMNS.map((c) => {
    const i = held.indexOf(c);
    const t = columns.get(c);
    const nothing = gone("No held windows in this sector.");
    const j = tideCols.indexOf(c);
    const tr = tiltRows.get(c);
    let tiltCell;
    if (tr) tiltCell = { t: tr.t, band: tr.band, glyph: tr.glyph, word: tr.word, verdict: tr.verdict, tiltC: tr.r, bandC: tr.w, x: tr.exact, s: "ok" };
    else if (uni.weights.get(c) > 0 && tilt.status !== "ok") tiltCell = gone(tilt.reason.replace(/^— · /, ""));
    else tiltCell = gone("No market-cap weight.");
    const pct = i >= 0 && t.sided > 0 ? Math.floor((100 * t.covered) / t.sided) : null;
    const taker = i >= 0 ? t.AC + t.AP - (t.BC + t.BP) : null;
    return {
      key: c, label: c, short: C.SECTOR_SHORT[c] || c, kind: kindOf(c), selected: selected === c, windows: i >= 0 ? t.n : 0, premium: i >= 0 ? safe(t.T) : null,
      taker: i >= 0 ? cell(taker, r1.rowTotals[i], unit) : nothing,
      calls: i >= 0 ? cell(g1[i][0], r1.cells[i][0], unit) : nothing,
      puts: i >= 0 ? cell(g1[i][1], r1.cells[i][1], unit) : nothing,
      noside: i >= 0 ? cell(g2[i][0], r2.cells[i][0], unit) : nothing,
      outside: j >= 0 ? cell(g3[j][0], r3.cells[j][0], unit) : gone(tides.reasons.get(c) || (c === FUNDS_COLUMN ? "Tide covers SPY, QQQ, IWM and DIA only." : c === NO_SECTOR ? "No tide exists for names without a sector." : "No sector tide for this sector.")),
      tilt: tiltCell,
      coverage: pct === null ? gone("No sided premium.") : { t: pct + "%", x: pct + "%", s: "ok" },
    };
  });
  const totals = {
    taker: r1 ? { t: formatUnits(r1.total, unit), x: exactDollars(g1.reduce((a, r) => a + r[0] + r[1], 0)), s: "ok" } : gone("No held windows."),
    calls: r1 ? { t: formatUnits(r1.colTotals[0], unit), x: exactDollars(g1.reduce((a, r) => a + r[0], 0)), s: "ok" } : gone("No held windows."),
    puts: r1 ? { t: formatUnits(r1.colTotals[1], unit), x: exactDollars(g1.reduce((a, r) => a + r[1], 0)), s: "ok" } : gone("No held windows."),
    noside: r2 ? { t: formatUnits(r2.total, unit), x: exactDollars(g2.reduce((a, r) => a + r[0], 0)), s: "ok" } : gone("No held windows."),
    outside: r3 ? { t: formatUnits(r3.total, unit), x: exactDollars(g3.reduce((a, r) => a + r[0], 0)), s: "ok" } : gone("No sector tide in this scope."),
    tilt: tilt.status === "ok" ? { t: "0", x: "0", s: "zero" } : gone(tilt.reason.replace(/^— · /, "")),
  };
  const scaleC = tilt.status === "ok" && tilt.rows.length ? niceScale(Math.max(...tilt.rows.map((r) => Math.abs(r.r) + r.w))) : null;
  return {
    unit, caption: caption(unit), headers: C.SECTOR_HEADERS, rows, totals, measured: tideCols.length,
    tiltScale: scaleC === null ? null : { cents: scaleC, text: scaleText(scaleC), unit: tilt.unit.scaleName },
    exact: { taker: g1.reduce((a, r) => a + r[0] + r[1], 0), noside: g2.reduce((a, r) => a + r[0], 0), outside: g3.reduce((a, r) => a + r[0], 0), calls: g1.reduce((a, r) => a + r[0], 0), puts: g1.reduce((a, r) => a + r[1], 0) },
  };
}

const rank = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function namesTable(scope, books, uni, tiltUnit, hold = null) {
  const sector = scope.sector;
  const members = uni.members.get(sector) || [];
  const weighted = SECTORS.includes(sector);
  const drill = weighted ? drillSector(books, sector, members, uni.capOf) : null;
  const list = weighted ? drill.rows : [...books.values()].filter((b) => b.column === sector).map((b) => ({ ticker: b.ticker, book: b, cap: null, R: null, share: null }));
  const ordered = list.slice().sort((p, q) => {
    const pr = p.R === null ? 0n : (p.R < 0n ? -p.R : p.R);
    const qr = q.R === null ? 0n : (q.R < 0n ? -q.R : q.R);
    const pt = p.book ? p.book.T : 0;
    const qt = q.book ? q.book.T : 0;
    return weighted ? (qr > pr ? 1 : qr < pr ? -1 : rank(p.ticker, q.ticker)) : (qt - pt) || rank(p.ticker, q.ticker);
  });
  const top = ordered.slice(0, 9);
  const rest = ordered.slice(9);
  const pack = (items) => items.reduce((a, r) => {
    const b = r.book;
    return { n: a.n + (b ? b.n : 0), T: a.T + (b ? b.T : 0), calls: a.calls + (b ? b.AC - b.BC : 0), puts: a.puts + (b ? b.AP - b.BP : 0), R: r.R === null ? a.R : a.R + r.R, share: a.share + (r.share || 0) };
  }, { n: 0, T: 0, calls: 0, puts: 0, R: 0n, share: 0 });
  const lines = [...top.map((r) => ({ label: r.ticker, ticker: r.ticker, ...pack([r]), has: r.R !== null, held: !!r.book })), ...(rest.length ? [{ label: `Other ${rest.length} names`, ticker: null, ...pack(rest), has: rest.some((r) => r.R !== null), held: rest.some((r) => r.book) }] : [])];
  const total = pack(ordered);
  const grid = lines.map((l) => [l.calls, l.puts]);
  const unit = unitFor(maxAbs([...grid.flat(), ...lines.map((l) => l.T), total.T, total.calls + total.puts]));
  const r1 = grid.length ? roundGrid(grid, unit) : null;
  const r2 = lines.length ? roundGrid(lines.map((l) => [l.T]), unit) : null;
  const tilts = weighted && hold === null ? lines.filter((l) => l.has) : [];
  const rT = tilts.length ? roundGrid(tilts.map((l) => [safe(l.R)]), tiltUnit) : null;
  const rows = lines.map((l, i) => {
    const ti = tilts.indexOf(l);
    return {
      label: l.label, ticker: l.ticker, windows: l.n,
      premium: l.held ? cell(l.T, r2.cells[i][0], unit) : gone("No held windows."),
      calls: l.held ? cell(l.calls, r1.cells[i][0], unit) : gone("No held windows."),
      puts: l.held ? cell(l.puts, r1.cells[i][1], unit) : gone("No held windows."),
      weight: weighted && l.share > 0 ? { t: (100 * l.share).toFixed(1) + "%", x: (100 * l.share).toFixed(4) + "%", s: "ok" } : gone(weighted ? "No market cap on record." : "Funds have no market-cap weight."),
      tilt: ti >= 0 ? { ...cell(safe(l.R), rT.cells[ti][0], tiltUnit), tiltC: safe(l.R) } : gone(hold !== null ? hold : weighted ? "No market cap on record." : sector === FUNDS_COLUMN ? "Funds have no market-cap weight." : "No sector is not a peer group."),
    };
  });
  const nameScale = tilts.length ? niceScale(Math.max(...tilts.map((l) => Math.abs(safe(l.R))))) : null;
  return {
    sector, unit, tiltUnit, caption: caption(unit), rows, uncapped: drill ? drill.uncapped : null, capped: drill ? drill.capped : null,
    tiltScale: nameScale === null ? null : { cents: nameScale, text: scaleText(nameScale), unit: tiltUnit.scaleName },
    footer: drill && drill.uncapped > 0 ? `Tilt over ${drill.capped} of ${drill.capped + drill.uncapped} names; ${drill.uncapped} without market cap.` : null,
    total: { windows: total.n, premium: { t: formatUnits(r2 ? r2.total : 0, unit), x: exactDollars(total.T), s: "ok" }, calls: { t: formatUnits(r1 ? r1.colTotals[0] : 0, unit), x: exactDollars(total.calls), s: "ok" }, puts: { t: formatUnits(r1 ? r1.colTotals[1] : 0, unit), x: exactDollars(total.puts), s: "ok" }, tilt: weighted && hold === null && drill.sum !== null ? { t: "0", x: "0", s: "zero" } : gone(hold !== null ? hold : "No tilt for this group.") },
  };
}

function windowsTable(accepted, name) {
  const mine = accepted.filter((a) => a.row.t === name).sort((p, q) => (q.entry.T - p.entry.T) || rank(String(p.row.spanStart), String(q.row.spanStart)));
  const top = mine.slice(0, 20);
  const rest = mine.slice(20);
  const sum = (items, k) => items.reduce((a, w) => a + w.entry[k], 0);
  const lines = top.map((w) => ({ label: `${trtStamp(Date.parse(w.row.spanStart))}–${trtStamp(Date.parse(w.row.spanEnd || w.row.spanStart))}`, contract: `${w.row.exp || DASH} ${w.row.k ?? DASH}${w.right}`, T: w.entry.T, A: w.entry.A, B: w.entry.B }));
  if (rest.length) lines.push({ label: `Other ${rest.length} windows`, contract: "", T: sum(rest, "T"), A: sum(rest, "A"), B: sum(rest, "B") });
  const unit = unitFor(maxAbs(lines.flatMap((l) => [l.T, l.A, l.B])));
  const r = lines.length ? roundGrid(lines.map((l) => [l.A, l.B]), unit) : null;
  const t = lines.length ? roundGrid(lines.map((l) => [l.T]), unit) : null;
  return {
    name, unit, caption: caption(unit),
    rows: lines.map((l, i) => ({ label: l.label, contract: l.contract, premium: cell(l.T, t.cells[i][0], unit), ask: cell(l.A, r.cells[i][0], unit), bid: cell(l.B, r.cells[i][1], unit) })),
    count: mine.length,
  };
}

function flowView(totals, outside) {
  const money = moneyShort;
  const arrow = (id, label, from, to, cents) => ({ id, label, from, to, cents, text: money(cents), exact: exactDollars(cents) });
  const net = (totals.AC + totals.AP) - (totals.BC + totals.BP);
  const unsided = unsidedOf(totals);
  const outsideNet = outside ? outside.calls + outside.puts : null;
  return {
    takers: C.FLOW_LINES.takers,
    providers: C.FLOW_LINES.providers,
    arrows: [
      arrow("callsAsk", "Calls, ask side", "TK", "LP", totals.AC),
      arrow("putsAsk", "Puts, ask side", "TK", "LP", totals.AP),
      arrow("callsBid", "Calls, bid side", "LP", "TK", totals.BC),
      arrow("putsBid", "Puts, bid side", "LP", "TK", totals.BP),
    ],
    net: { cents: net, text: money(Math.abs(net)), exact: exactDollars(net), line: net > 0 ? C.FLOW_LINES.paid(money(net)) : net < 0 ? C.FLOW_LINES.received(money(-net)) : C.FLOW_LINES.even },
    noside: { cents: unsided, text: money(unsided), exact: exactDollars(unsided), line: C.FLOW_LINES.noside(money(unsided)), reasons: C.WINDOW_BASIS_REASONS.map((r, i) => ({ id: r, label: C.ROW_COPY[4 + i].label, cents: totals.U[r], exact: exactDollars(totals.U[r]) })) },
    outside: outside
      ? { s: "ok", cents: outsideNet, text: money(Math.abs(outsideNet)), exact: exactDollars(outsideNet), line: outsideNet > 0 ? C.FLOW_LINES.outsidePaid(money(outsideNet)) : outsideNet < 0 ? C.FLOW_LINES.outsideReceived(money(-outsideNet)) : C.FLOW_LINES.outsideEven }
      : { s: "absent", cents: null, text: DASH, exact: null, line: C.FLOW_LINES.outsideAbsent },
  };
}

function checksView(ctx) {
  const { matrix, sums, totals, sectorExact, tilt, tides, session, outsideAbsent, sideDiff, foots, largest, scopeKind, windows, tideAt, windowsAt } = ctx;
  const none = windows === 0;
  const items = [];
  const rowLabels = C.ROW_COPY.map((r) => r.label);
  const worstRow = sums.rowSums.reduce((m, v, i) => (Math.abs(v) > Math.abs(sums.rowSums[m]) ? i : m), 0);
  const rowsOk = sums.rowSums.every((v) => v === 0) && foots.rows;
  const measured = outsideAbsent ? 4 : 6;
  const colSums = sums.colSums.filter((_, c) => c < measured);
  const balancing = matrix.rows[10].filter((v) => v !== null).reduce((a, v) => a + v, 0);
  const colsOk = colSums.every((v) => v === 0) && balancing === 0 && foots.cols;
  const sidesOk = sideDiff === 0;
  const matchOk = sectorExact.taker === -(matrix.rows[0][0] + matrix.rows[1][0] + matrix.rows[2][0] + matrix.rows[3][0]) && sectorExact.noside === unsidedOf(totals);
  const push = (id, state, text, extra = {}) => items.push({ id, label: C.CHECKS[id].label, state, text, hover: C.CHECKS[id].hover, ...extra });
  push("rows", none ? "absent" : rowsOk ? "pass" : "fail", none ? C.CHECKS.rows.absent : rowsOk ? C.CHECKS.rows.pass(matrix.rows.length - (outsideAbsent ? 2 : 0)) : C.CHECKS.rows.fail(rowLabels[worstRow], sums.rowSums[worstRow]));
  push("columns", none ? "absent" : colsOk ? "pass" : "fail", none ? C.CHECKS.columns.absent : colsOk ? C.CHECKS.columns.pass(measured, moneyShort(largest)) : C.CHECKS.columns.fail(balancing || colSums.find((v) => v !== 0) || 0));
  push("sides", none ? "absent" : sidesOk ? "pass" : "fail", none ? C.CHECKS.sides.absent : sidesOk ? C.CHECKS.sides.pass(windows) : C.CHECKS.sides.fail(sideDiff));
  if (none) push("sectors", "absent", C.CHECKS.sectors.absent);
  else if (scopeKind !== "all") push("sectors", "absent", C.CHECKS.sectors.single);
  else push("sectors", matchOk ? "pass" : "fail", matchOk ? C.CHECKS.sectors.pass : C.CHECKS.sectors.fail(sectorExact.taker + (matrix.rows[0][0] + matrix.rows[1][0] + matrix.rows[2][0] + matrix.rows[3][0])));
  if (tilt.status === "ok") {
    const ok = tilt.sum === 0;
    const sumText = tilt.sum === 0 ? "0" : (tilt.sum < 0 ? MINUS : "+") + exactDollars(Math.abs(tilt.sum));
    push("tilt", ok ? "pass" : "fail", ok ? C.CHECKS.tilt.pass(sumText, tilt.weighted.length) : C.CHECKS.tilt.fail(sumText, tilt.weighted.length));
  } else push("tilt", "absent", tilt.reason);
  if (tides.mismatch) push("session", "fail", C.CHECKS.session.fail(dayLabel(tides.mismatch)));
  else if (tides.sectors.size || tides.etf.size) push("session", "pass", C.CHECKS.session.pass(dayLabel(session), tideAt || DASH, windowsAt || DASH));
  else push("session", "absent", C.CHECKS.session.absent);
  push("stock", "absent", C.CHECKS.stock.absent);
  const failed = items.filter((i) => i.state === "fail").map((i) => i.id);
  const ledgerFail = failed.some((id) => ["rows", "columns", "sides", "sectors"].includes(id));
  return { items, failed, ledgerFail, tiltFail: failed.includes("tilt"), sessionFail: failed.includes("session") };
}

const money = (cents) => moneyShort(cents);

function readingView({ scope, totals, tilt, shed }) {
  const parts = [];
  parts.push(`Net call premium ${sign(totals.AC - totals.BC)}${money(Math.abs(totals.AC - totals.BC))}; net put premium ${sign(totals.AP - totals.BP)}${money(Math.abs(totals.AP - totals.BP))}.`);
  if (scope.kind === "all" && tilt.status === "ok") {
    const above = tilt.rows.filter((r) => r.verdict === "above").sort((p, q) => q.r - p.r || rank(p.label, q.label))[0];
    const below = tilt.rows.filter((r) => r.verdict === "below").sort((p, q) => p.r - q.r || rank(p.label, q.label))[0];
    const bits = [];
    if (above) bits.push(`Above share: ${above.label} +${money(above.r)}.`);
    if (below) bits.push(`Below share: ${below.label} ${MINUS}${money(Math.abs(below.r))}.`);
    parts.push(bits.length ? bits.join(" ") : "No sector is above or below its share beyond the band.");
  }
  if (shed !== null && shed > 0) parts.push(`${shed} windows were shed; their premium is not in these figures.`);
  return parts;
}

export function ledgerView(input) {
  const {
    now, scope = { kind: "all", key: "all" }, period: requested = null, live = null, nightly = null, breadth = null, universe = null, clock = null,
  } = input;
  const liveP = live ? obj(live.payload) : null;
  const nightlyP = nightly ? obj(nightly.payload) : null;
  const sessionOf = (p, fallback) => (p && obj(p.record) && typeof p.record.date === "string" ? p.record.date : typeof (p && p.sessionDate) === "string" ? p.sessionDate.slice(0, 10) : fallback || null);
  const liveMeta = liveP ? { session: sessionOf(liveP, live.session), readAt: Number.isFinite(live.readAt) ? live.readAt : null } : null;
  const nightlyAt = nightlyP ? Date.parse(nightlyP.readAt || nightlyP.generatedAt) : NaN;
  const nightlyMeta = nightlyP ? { session: sessionOf(nightlyP, null), readAt: Number.isFinite(nightlyAt) ? nightlyAt : null } : null;
  const plan = periodPlan({ at: now, live: liveMeta, nightly: nightlyMeta, clock });
  const periods = [plan.intraday, plan.session, plan.five].map((p) => ({ id: p.id, ok: p.ok, label: p.label, reason: p.reason }));
  const wanted = requested || (plan.intraday.ok ? "intraday" : plan.session.ok ? "session" : "intraday");
  const chosen = wanted === "five" ? plan.five : wanted === "session" ? plan.session : plan.intraday;
  const head = { v: 1, basis: "window", serverNow: now, periods, period: { id: chosen.id, label: chosen.label, reason: chosen.reason, session: chosen.session, status: chosen.status || null } };
  if (!chosen.ok) return { ...head, status: "unavailable", why: chosen.reason, scope: { kind: scope.kind, key: scope.key } };
  const sourceP = chosen.source === "nightly" ? nightlyP : liveP;
  const session = chosen.session;
  const asOf = chosen.asOf;
  head.period.asOf = Number.isFinite(asOf) ? new Date(asOf).toISOString() : null;
  head.period.asOfText = Number.isFinite(asOf) ? trtStamp(asOf, session) : null;
  head.period.sessionLabel = dayLabel(session);
  head.period.source = chosen.source;
  const rowsIn = sourceP && Array.isArray(sourceP.rows) ? sourceP.rows : null;
  if (rowsIn === null) return { ...head, status: "failed", why: "The record has no readable windows.", scope: { kind: scope.kind, key: scope.key } };
  try {
    const uni = readUniverse(universe);
    const { books, counts, accepted } = bookWindows(rowsIn, { column: uni.columnOf, deltaMicro: deltaMicroOf, session, collect: scope.kind === "name" });
    const everEntered = sourceP.record && Number.isFinite(sourceP.record.everEntered) ? sourceP.record.everEntered : null;
    const held = rowsIn.length;
    const totalSeen = everEntered !== null && everEntered >= held ? everEntered : null;
    const shed = totalSeen === null ? null : totalSeen - held;
    const columns = new Map();
    for (const c of COLUMNS) { const t = sumBooks(books, (b) => b.column === c); if (t.n > 0) columns.set(c, t); }
    const closeMs = chosen.id === "intraday" ? null : sessionClose(session, clock);
    const tides = readTides(breadth && obj(breadth.payload), session, { asOf, close: closeMs, intraday: chosen.id === "intraday" });
    const include = scope.kind === "all" ? () => true : scope.kind === "sector" ? (b) => b.column === scope.sector : (b) => b.ticker === scope.name;
    const totals = sumBooks(books, include);
    if (scope.kind === "name" && !books.has(scope.name)) {
      return { ...head, status: "quiet", why: `${scope.name} has no held windows in this period.`, scope: { kind: scope.kind, key: scope.key }, counts };
    }
    if (totals.n === 0) return { ...head, status: "quiet", why: C.EMPTY.page.quiet(chosen.label ? chosen.label.split(" · ")[0] : "Period"), scope: { kind: scope.kind, key: scope.key }, counts };
    const outside = scopeOutside(scope, columns, totals, tides);
    const matrix = buildMatrix(totals, outside);
    const sums = matrixSums(matrix);
    const outsideReason = tideReason(scope, tides);
    const ledger = ledgerTable(matrix, outsideReason);
    const tilt = tiltView(columns, uni, shed);
    const sectors = sectorTable(columns, scope.kind === "sector" ? scope.sector : null, tides, uni, tilt);
    const allTotals = sumBooks(books);
    const sectorExact = { taker: scope.kind === "all" ? sectors.exact.taker : -(matrix.rows[0][0] + matrix.rows[1][0] + matrix.rows[2][0] + matrix.rows[3][0]), noside: scope.kind === "all" ? sectors.exact.noside : unsidedOf(totals) };
    const sideDiff = totals.T - (totals.AC + totals.BC + totals.AP + totals.BP + unsidedOf(totals));
    const checks = checksView({
      matrix, sums, totals, sectorExact, tilt, tides, session, outsideAbsent: matrix.absentOutside, sideDiff, foots: ledger.foots, largest: ledger.largest, scopeKind: scope.kind,
      windows: totals.n, tideAt: tides.lastAt === null ? null : trtStamp(tides.lastAt, session), windowsAt: Number.isFinite(asOf) ? trtStamp(asOf, session) : null,
    });
    if (checks.ledgerFail) {
      const reason = C.WITHHELD.ledger(hashOf({ sums, sideDiff }));
      return { ...head, status: "failed", why: reason, scope: { kind: scope.kind, key: scope.key }, withheld: { reason, all: true }, checks: { head: C.CHECKS_HEAD, items: checks.items, failed: checks.failed, notes: [] } };
    }
    const lean = leanRead({ T: totals.T, A: totals.AC + totals.AP, B: totals.BC + totals.BP });
    const notes = [
      { id: "held", text: C.NOTES.held.text(held, totalSeen), hover: C.NOTES.held.hover },
      { id: "tide", text: C.NOTES.tide.text(tides.sectors.size), hover: C.NOTES.tide.hover },
      { id: "rounding", text: C.NOTES.rounding.text(ledger.unit.stepLabel), hover: C.NOTES.rounding.hover },
    ];
    const scopeLine = scope.kind === "all"
      ? C.SCOPE_LINE.all(money(totals.T), held, shed, totalSeen)
      : scope.kind === "sector" ? C.SCOPE_LINE.sector(money(totals.T), totals.n, scope.sector, shed) : C.SCOPE_LINE.name(money(totals.T), totals.n, scope.name, shed);
    const tiltHold = checks.tiltFail ? C.WITHHELD.tilt(hashOf({ sum: String(tilt.sum) })) : null;
    const sectorsOut = checks.tiltFail ? sectorTable(columns, scope.kind === "sector" ? scope.sector : null, tides, uni, { status: "absent", reason: tiltHold, rows: [], unweighted: [] }) : sectors;
    const out = {
      ...head, status: "ok", why: null,
      scope: {
        kind: scope.kind, key: scope.key, sector: scope.sector || null, name: scope.name || null, line: scopeLine, held, seen: totalSeen, shed,
        crumbs: [{ label: "All sectors", key: "all" }, ...(scope.kind === "sector" ? [{ label: scope.sector, key: scope.key }] : []), ...(scope.kind === "name" ? [{ label: scope.name, key: scope.key }] : [])],
      },
      withheld: null, checks: { head: C.CHECKS_HEAD, items: checks.items, failed: checks.failed, notes }, ledger, sectors: sectorsOut, lean: { ...lean, line: lineOfLean(lean) },
      tilt: checks.tiltFail ? { status: "absent", reason: tiltHold, rows: [], unweighted: [] } : { ...tilt, lines: [C.TILT_LINES.definition, C.TILT_LINES.total(tilt.weighted.length), C.TILT_LINES.reading, C.TILT_LINES.funds, ...(shed ? [C.TILT_LINES.shed(shed)] : [])] },
      flow: flowView(totals, outside),
      stock: { status: "absent", reason: NO_OPEN_INTEREST, line: C.PANEL_LINES.stock, memo: { sameSession: safe(totals.sameDay), text: `Premium in held windows that expire this session: ${money(totals.sameDay)}.`, exact: exactDollars(totals.sameDay) }, notBuilt: C.NOT_BUILT_LINE },
      dq: { ...counts },
      notes: C.DELTA_NOTES,
    };
    if (scope.kind === "sector") out.names = namesTable(scope, books, uni, tilt.status === "ok" ? tilt.unit : unitFor(0), tiltHold);
    if (scope.kind === "name") out.windows = windowsTable(accepted, scope.name);
    out.reading = readingView({ scope, totals, tilt, shed });
    return out;
  } catch (error) {
    if (error instanceof RangeError) return { ...head, status: "failed", why: C.OVERFLOW, scope: { kind: scope.kind, key: scope.key } };
    throw error;
  }
}
