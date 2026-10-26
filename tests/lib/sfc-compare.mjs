import { runProduction } from "./sfc-run.mjs";
import { oracleBook, oracleColumns, oracleMatrix, oracleOutside, oracleTilt, oracleLean, ORACLE_SECTORS } from "./sfc-oracle.mjs";
import { SECTORS } from "../../shared/flows-sfc.js";
import { leanRead, tally, windowEntry } from "../../shared/flows-sides.js";

const big = (v) => BigInt(v);

const fields = ["n", "T", "AC", "BC", "AP", "BP", "sided", "covered", "sameDay"];

export function oracleRun(world) {
  const book = oracleBook(world);
  const columns = oracleColumns(book);
  const all = { n: 0n, T: 0n, AC: 0n, BC: 0n, AP: 0n, BP: 0n, U: { btw: 0n, cross: 0n, leg: 0n, ns: 0n }, X: 0n, Ub: 0n, sided: 0n, covered: 0n, sameDay: 0n };
  for (const c of columns.values()) {
    for (const k of fields) all[k] += c[k];
    all.X += c.X;
    all.Ub += c.Ub;
    for (const r of ["btw", "cross", "leg", "ns"]) all.U[r] += c.U[r];
  }
  let calls = 0n, puts = 0n, measured = 0;
  const empty = { AC: 0n, BC: 0n, AP: 0n, BP: 0n };
  for (const s of ORACLE_SECTORS) {
    const o = oracleOutside(world.tide[s] || null, columns.get(s) || empty);
    if (o === null) continue;
    calls += o.calls; puts += o.puts; measured++;
  }
  const outside = measured ? { calls, puts } : null;
  const matrix = oracleMatrix(all, outside);
  const tilt = oracleTilt(columns, book.uni.weights);
  return { book, columns, all, outside, matrix, tilt };
}

export function compareWorld(world, mod = {}) {
  const bad = [];
  const note = (m) => { if (bad.length < 6) bad.push(m); };
  const p = runProduction(world, mod);
  const o = oracleRun(world);
  for (const k of ["given", "unreadable", "duplicate", "offSession", "noRight", "zero", "invalid", "booked"]) {
    if (p.counts[k] !== Number(o.book.counts[k])) note(`count ${k}: ${p.counts[k]} against ${o.book.counts[k]}`);
  }
  if (BigInt(p.counts.invalidCents) !== o.book.counts.invalidCents) note(`invalidCents ${p.counts.invalidCents} against ${o.book.counts.invalidCents}`);
  if (p.books.size !== o.book.names.size) note(`names ${p.books.size} against ${o.book.names.size}`);
  for (const [name, ob] of o.book.names) {
    const pb = p.books.get(name);
    if (!pb) { note(`name ${name} missing`); continue; }
    if (pb.column !== ob.column) note(`${name} column ${pb.column} against ${ob.column}`);
    for (const k of fields) if (big(pb[k]) !== ob[k]) note(`${name}.${k}: ${pb[k]} against ${ob[k]}`);
    for (const r of ["btw", "cross", "leg", "ns"]) if (big(pb.U[r]) !== ob.U[r]) note(`${name}.U.${r}: ${pb.U[r]} against ${ob.U[r]}`);
    if (pb.X !== ob.X) note(`${name}.X: ${pb.X} against ${ob.X}`);
    if (pb.Ub !== ob.Ub) note(`${name}.Ub: ${pb.Ub} against ${ob.Ub}`);
  }
  for (const c of [...p.columns.keys(), ...o.columns.keys()]) {
    const pc = p.columns.get(c), oc = o.columns.get(c);
    if (!pc || !oc) { note(`column ${c} present in one only`); continue; }
    for (const k of fields) if (big(pc[k]) !== oc[k]) note(`column ${c}.${k}`);
    if (pc.X !== oc.X || pc.Ub !== oc.Ub) note(`column ${c} exposure`);
  }
  const rows = p.matrix.rows;
  for (let r = 0; r < 11; r++) for (let c = 0; c < 6; c++) {
    const a = rows[r][c], b = o.matrix[r][c];
    if ((a === null) !== (b === null) || (a !== null && big(a) !== b)) note(`matrix r${r + 1} c${c + 1}: ${a} against ${b}`);
  }
  if ((p.outside === null) !== (o.outside === null)) note("outside presence");
  if (p.outside && o.outside && (big(p.outside.calls) !== o.outside.calls || big(p.outside.puts) !== o.outside.puts)) note("outside amounts");
  if ((p.tilt.sum === null) !== (o.tilt === null)) note("tilt presence");
  if (o.tilt) {
    if (p.tilt.total !== o.tilt.X) note(`tilt total ${p.tilt.total} against ${o.tilt.X}`);
    if (p.tilt.sum !== 0n) note(`tilt sum ${p.tilt.sum}`);
    for (const s of o.tilt.weighted) {
      const pr = p.tilt.rows.get(s), or = o.tilt.rows.get(s);
      if (pr.a !== or.a || pr.R !== or.R || pr.W !== or.W || pr.verdict !== or.verdict) note(`tilt ${s}: ${pr.a},${pr.R},${pr.W},${pr.verdict} against ${or.a},${or.R},${or.W},${or.verdict}`);
    }
    if (p.tilt.weighted.join() !== o.tilt.weighted.join()) note("weighted columns");
  }
  const totalsAll = { T: p.all.T, A: p.all.AC + p.all.AP, B: p.all.BC + p.all.BP };
  const lean = (mod.leanRead || leanRead)(totalsAll);
  const ol = oracleLean(o.all);
  if (ol.why !== undefined && (lean.why || null) !== (ol.why || null)) note(`lean gate ${lean.why} against ${ol.why}`);
  if (ol.why === null) {
    if (lean.side !== ol.side) note(`lean side ${lean.side} against ${ol.side}`);
    const frac = (x) => Number(x[0]) / Number(x[1]);
    if (Math.abs(lean.share - frac(ol.share)) > 1e-12 || Math.abs(lean.lo - frac(ol.lo)) > 1e-12 || Math.abs(lean.hi - frac(ol.hi)) > 1e-12) note("lean ratios");
  }
  return bad;
}

export { tally, windowEntry, SECTORS };
