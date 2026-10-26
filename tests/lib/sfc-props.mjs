import { runProduction } from "./sfc-run.mjs";
import { mulberry32 } from "./sfc-rng.mjs";
import { SECTORS, COLUMNS, FUNDS_COLUMN, matrixSums } from "../../shared/flows-sfc.js";

const rep = (k, v) => (typeof v === "bigint" ? `${v}n` : v instanceof Map ? [...v].sort((a, b) => (a[0] < b[0] ? -1 : 1)) : v);

export const dump = (value) => JSON.stringify(value, rep);

const bookShape = (b) => ({ column: b.column, n: b.n, T: b.T, AC: b.AC, BC: b.BC, AP: b.AP, BP: b.BP, U: b.U, X: b.X, Ub: b.Ub, sided: b.sided, covered: b.covered, sameDay: b.sameDay, noExposure: b.noExposure });

export function shape(p, { names = true, counts = true } = {}) {
  return dump({
    counts: counts ? p.counts : null,
    books: names ? [...p.books].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, b]) => [k, bookShape(b)]) : [...p.books.values()].map(bookShape).map(dump).sort(),
    columns: [...p.columns].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    all: p.all,
    outside: p.outside,
    matrix: p.matrix.rows,
    tilt: p.tilt.sum === null ? null : { sum: p.tilt.sum, total: p.tilt.total, rows: p.tilt.weighted.map((c) => { const r = p.tilt.rows.get(c); return [c, r.a, r.R, r.W, r.verdict]; }) },
  });
}

export function shuffled(list, seed) {
  const rnd = mulberry32(seed);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const centsOfNumber = (n) => Math.round(n * 100);

const fromCents = (c) => Number(`${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`);

export function scaleWorld(world, k) {
  const money = (v) => (v === null ? null : fromCents(centsOfNumber(v) * k));
  return {
    ...world,
    rows: world.rows.map((r) => ({ ...r, prem: money(r.prem), askPrem: money(r.askPrem), bidPrem: money(r.bidPrem), raw: { ...r.raw, prem: r.raw.prem === null ? null : String(money(Number(r.raw.prem))), askPrem: r.raw.askPrem === null ? null : String(money(Number(r.raw.askPrem))), bidPrem: r.raw.bidPrem === null ? null : String(money(Number(r.raw.bidPrem))) } })),
    tide: Object.fromEntries(Object.entries(world.tide).map(([s, t]) => [s, t === null ? null : { calls: t.calls * k, puts: t.puts * k }])),
  };
}

export function renameWorld(world, rename) {
  const map = (t) => (rename.has(t) ? rename.get(t) : t);
  return {
    ...world,
    rows: world.rows.map((r) => ({ ...r, t: map(r.t), oc: r.oc.replace(r.t, map(r.t)) })),
    universe: { ...world.universe, t: world.universe.t.map(map) },
  };
}

export function flipWorld(world) {
  return {
    ...world,
    rows: world.rows.map((r) => ({ ...r, cp: r.cp === "C" ? "P" : r.cp === "P" ? "C" : r.cp, d: r.d === null ? null : -r.d })),
    tide: Object.fromEntries(Object.entries(world.tide).map(([s, t]) => [s, t === null ? null : { calls: t.puts, puts: t.calls }])),
  };
}

const shiftIso = (iso, days) => (typeof iso === "string" ? new Date(Date.parse(iso) + days * 86400000).toISOString() : iso);

export function shiftWorld(world, days) {
  const day = (d) => new Date(Date.parse(d + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  return {
    ...world,
    session: day(world.session),
    rows: world.rows.map((r) => ({ ...r, spanStart: shiftIso(r.spanStart, days), spanEnd: shiftIso(r.spanEnd, days), exp: typeof r.exp === "string" ? day(r.exp) : r.exp })),
  };
}

const sameRow = (a, b) => dump(a) === dump(b);

export function violations(world) {
  const bad = [];
  const note = (m) => { if (bad.length < 8) bad.push(m); };
  const p = runProduction(world);
  const sums = matrixSums(p.matrix);
  sums.rowSums.forEach((v, i) => { if (v !== 0) note(`row ${i + 1} sums to ${v}`); });
  sums.colSums.forEach((v, i) => { if (v !== 0) note(`column ${i + 1} sums to ${v}`); });
  const m = p.matrix.rows;
  const unsided = p.all.U.btw + p.all.U.cross + p.all.U.leg + p.all.U.ns;
  if (p.all.T !== p.all.AC + p.all.BC + p.all.AP + p.all.BP + unsided) note("T is not bought + sold + no side");
  if (m[0][0] + m[1][0] + m[2][0] + m[3][0] !== -(p.all.AC - p.all.BC + p.all.AP - p.all.BP)) note("TK column is not minus the net taker premium");
  if (m[4][3] + m[5][3] + m[6][3] + m[7][3] !== unsided) note("SN column is not the no-side premium");
  if (p.outside === null) {
    if (!p.matrix.absentOutside) note("outside absent but not flagged");
    for (const i of [8, 9]) if (m[i].some((v) => v !== null)) note(`row ${i + 1} is not wholly absent`);
    if (m[10][4] !== null || m[10][5] !== null) note("balancing entries of absent columns are not absent");
  } else {
    if (p.matrix.absentOutside) note("outside present but flagged absent");
    if (m[8][5] + m[9][5] !== -(m[8][4] + m[9][4])) note("outside columns do not mirror");
  }
  const field = ["n", "T", "AC", "BC", "AP", "BP", "sided", "covered", "sameDay", "noExposure"];
  for (const k of field) {
    const byBooks = [...p.books.values()].reduce((a, b) => a + b[k], 0);
    const byColumns = [...p.columns.values()].reduce((a, t) => a + t[k], 0);
    if (byBooks !== p.all[k] || byColumns !== p.all[k]) note(`${k}: books ${byBooks}, columns ${byColumns}, all ${p.all[k]}`);
  }
  const X = [...p.books.values()].reduce((a, b) => a + b.X, 0n);
  if (X !== p.all.X) note("X: books do not add to all");
  for (const b of p.books.values()) {
    if (b.T !== b.AC + b.BC + b.AP + b.BP + b.U.btw + b.U.cross + b.U.leg + b.U.ns) note(`${b.ticker}: premium does not close`);
    for (const k of [...field, "X"]) if (b[k] < 0 && k !== "X") note(`${b.ticker}: ${k} is negative`);
    if (b.sided !== b.AC + b.BC + b.AP + b.BP) note(`${b.ticker}: sided is not bought + sold`);
    if (b.covered > b.sided) note(`${b.ticker}: covered exceeds sided`);
    if (!COLUMNS.includes(b.column)) note(`${b.ticker}: unknown column ${b.column}`);
  }
  const c = p.counts;
  if (c.given !== c.duplicate + c.offSession + c.noRight + c.unreadable + c.invalid + c.zero + c.booked) note("counts do not partition the rows given");
  if (c.booked !== p.all.n) note("booked differs from windows in the books");
  if (p.tilt.sum !== null) {
    if (p.tilt.sum !== 0n) note(`tilt sums to ${p.tilt.sum}`);
    if (p.tilt.weighted.includes(FUNDS_COLUMN)) note("Index & ETF is in the tilt");
    let a = 0n;
    for (const col of p.tilt.weighted) {
      const r = p.tilt.rows.get(col);
      a += r.a;
      if (r.R !== r.X - r.a) note(`${col}: R is not X less a`);
      if (r.W < 0n) note(`${col}: negative band`);
      const verdict = r.R === 0n && r.W === 0n ? "at" : r.R - r.W >= 1n ? "above" : r.R + r.W <= -1n ? "below" : "undetermined";
      if (r.verdict !== verdict) note(`${col}: verdict ${r.verdict} for R ${r.R} band ${r.W}`);
    }
    if (a !== p.tilt.total) note("allocations do not add to the total");
    for (const col of COLUMNS) if (!p.tilt.weighted.includes(col) && p.tilt.rows.get(col).verdict !== null) note(`${col}: verdict without weight`);
  }
  if (p.outside) {
    let calls = 0;
    let puts = 0;
    for (const s of SECTORS) {
      const tide = p.tides.get(s);
      const listed = p.outside.measured.includes(s);
      if (Boolean(tide) !== listed) note(`${s}: measured only where a tide exists`);
      if (!tide) continue;
      const held = p.columns.get(s);
      calls += tide.calls - (held ? held.AC - held.BC : 0);
      puts += tide.puts - (held ? held.AP - held.BP : 0);
    }
    if (calls !== p.outside.calls || puts !== p.outside.puts) note("outside rows are not the tide less the held net on tide sectors");
  }
  return bad;
}

export { sameRow };
