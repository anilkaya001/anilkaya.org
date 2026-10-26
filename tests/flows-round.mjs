import assert from "node:assert/strict";
import { roundTable, footsRounded, floorDiv } from "../shared/flows-round.js";
import { mulberry32 } from "./lib/sfc-rng.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

{
  eq([floorDiv(7, 3), floorDiv(-7, 3), floorDiv(6, 3), floorDiv(-6, 3), floorDiv(0, 5), floorDiv(-1, 5)], [2, -3, 2, -2, 0, -1], "floor semantics for negatives");
  let threw = 0;
  for (const bad of [[1.5, 2], [1, 0], [1, -3], [NaN, 2], [2 ** 60, 2]]) { try { floorDiv(...bad); } catch { threw++; } }
  eq(threw, 5, "a non-integer, a zero or negative divisor and an unsafe integer are refused");
}

{
  const r = roundTable([[125, 125, -250], [0, 0, 0], [-125, -125, 250]], 10);
  eq(r.cells[0].reduce((a, b) => a + b, 0), 0, "12.5 + 12.5 - 25 units rounds to a row that sums to zero");
  ok(footsRounded(r), "and every row and column of the table foots");
  const away = (x) => Math.sign(x) * Math.round(Math.abs(x));
  const naive = [125, 125, -250].map((x) => away(x / 10));
  eq(naive, [13, 13, -25], "rounding each cell on its own gives 13 + 13 - 25");
  ok(naive.reduce((a, b) => a + b, 0) !== 0, "which does not foot (the failure the method exists to prevent)");
}

{
  const x = [[100, 250, 50], [175, -25, 0]];
  const r = roundTable(x, 100);
  const rowSum = x.map((row) => row.reduce((a, b) => a + b, 0));
  eq(rowSum, [400, 150], "a table with margins: true row sums");
  ok(footsRounded(r), "the displayed row totals, column totals and grand total are sums of the displayed cells");
  for (let i = 0; i < 2; i++) ok(Math.abs(r.rowTotals[i] * 100 - rowSum[i]) < 100, "a displayed row total is within one unit of its exact total");
  ok(Math.abs(r.total * 100 - 550) < 100, "and so is the grand total");
  eq(r.cells[0][0], 1, "an exact multiple of the unit stays exact");
}

{
  const rnd = mulberry32(20261026);
  let tables = 0, bad = 0, worst = 0, exactKept = 0, exactTotal = 0;
  for (let n = 0; n < 10000; n++) {
    const rows = 2 + Math.floor(rnd() * 12);
    const cols = 2 + Math.floor(rnd() * 7);
    const unit = [1, 100, 10000, 100000, 1000000][Math.floor(rnd() * 5)];
    const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rnd() < 0.3 ? 0 : Math.round((rnd() - 0.5) * 4e6))));
    if (n % 4 === 0) {
      for (let i = 0; i < rows; i++) cells[i][cols - 1] = -cells[i].slice(0, cols - 1).reduce((a, b) => a + b, 0);
      for (let j = 0; j < cols; j++) cells[rows - 1][j] = 0;
      for (let j = 0; j < cols; j++) cells[rows - 1][j] = -cells.slice(0, rows - 1).reduce((a, row) => a + row[j], 0);
    }
    const r = roundTable(cells, unit);
    tables++;
    if (!footsRounded(r)) bad++;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const d = Math.abs(r.cells[i][j] * unit - cells[i][j]) / unit;
      if (d >= 1) bad++;
      worst = Math.max(worst, d);
      if (cells[i][j] % unit === 0) { exactTotal++; if (r.cells[i][j] * unit === cells[i][j]) exactKept++; }
    }
    const rowSum = cells.map((row) => row.reduce((a, b) => a + b, 0));
    for (let i = 0; i < rows; i++) if (Math.abs(r.rowTotals[i] * unit - rowSum[i]) >= unit) bad++;
  }
  eq(bad, 0, `${tables} random tables: every displayed row, column and grand total is the sum of the displayed cells, every cell and total is within one unit of the exact figure`);
  ok(worst < 1, `the worst distance was ${worst.toFixed(4)} units`);
  eq(exactKept, exactTotal, "a cell that is an exact multiple of the unit is never moved");
}

{
  const rnd = mulberry32(99);
  let cases = 0;
  for (let n = 0; n < 400; n++) {
    const rows = 2 + Math.floor(rnd() * 2);
    const cols = 2 + Math.floor(rnd() * 2);
    const unit = 10;
    const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.round((rnd() - 0.5) * 80)));
    const r = roundTable(cells, unit);
    const ext = cells.map((row) => [...row, -row.reduce((a, b) => a + b, 0)]);
    ext.push([...Array.from({ length: cols }, (_, j) => -cells.reduce((a, row) => a + row[j], 0)), cells.flat().reduce((a, b) => a + b, 0)]);
    const q = ext.map((row) => row.map((x) => Math.floor(x / unit)));
    const frac = ext.map((row, i) => row.map((x, j) => (x - q[i][j] * unit) / unit));
    const cellsList = [];
    ext.forEach((row, i) => row.forEach((_, j) => { if (frac[i][j] > 0) cellsList.push([i, j]); }));
    if (cellsList.length > 14) continue;
    const need = ext.map((_, i) => Math.round(frac[i].reduce((a, b) => a + b, 0)));
    const have = ext[0].map((_, j) => Math.round(ext.reduce((a, row, i) => a + frac[i][j], 0)));
    let best = -Infinity;
    for (let mask = 0; mask < 1 << cellsList.length; mask++) {
      const rs = new Array(ext.length).fill(0), cs = new Array(ext[0].length).fill(0);
      let gain = 0;
      cellsList.forEach(([i, j], k) => { if (mask >> k & 1) { rs[i]++; cs[j]++; gain += frac[i][j]; } });
      if (rs.every((v, i) => v === need[i]) && cs.every((v, j) => v === have[j]) && gain > best) best = gain;
    }
    const chosen = cellsList.reduce((a, [i, j]) => a + (((i < rows && j < cols ? r.cells[i][j] : i < rows ? -r.rowTotals[i] : j < cols ? -r.colTotals[j] : r.total) - q[i][j]) ? frac[i][j] : 0), 0);
    ok(Math.abs(chosen - best) < 1e-9, "the flow's choice carries the largest total fraction among all feasible roundings (the nearest to the exact table)");
    cases++;
  }
  ok(cases > 100, `${cases} small tables checked against exhaustive search`);
}

{
  const again = () => roundTable([[1234567, -1234567, 0], [-100001, 50001, 50000], [-1133, 1184566, -1183433]], 100000);
  eq(again(), again(), "the same table rounds to the same display every time (the tie order is fixed)");
  let threw = 0;
  for (const bad of [[[1, 2], [3]], [[1.5, 2], [3, 4]], [], [[]], [[1, 2]], null]) {
    try { roundTable(bad, bad === null ? 1 : 1); if (Array.isArray(bad) && bad.length === 1 && bad[0].length === 2) threw += 0; } catch { threw++; }
  }
  ok(threw >= 5, "a ragged, fractional, empty or missing table is refused");
  let unit = 0;
  for (const u of [0, -5, 2.5, 2 ** 60]) { try { roundTable([[1, 2], [3, 4]], u); } catch { unit++; } }
  eq(unit, 4, "a unit that is zero, negative, fractional or unsafe is refused");
}

console.log(`✓ flows-round: ${checks} assertions - controlled rounding of zero-margin and margined tables by minimum-cost integer flow, 10,000 random tables, an exhaustive nearest-rounding check and the refusals`);
