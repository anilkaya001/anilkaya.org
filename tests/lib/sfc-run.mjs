import { readUniverse, bookWindows, sumBooks, outsideAll, outsideOf, buildMatrix, tiltOf, tiltCoverage, SECTORS, COLUMNS, emptyTotals } from "../../shared/flows-sfc.js";

export function tidesOf(world) {
  const tides = new Map();
  for (const sector of SECTORS) if (world.tide[sector]) tides.set(sector, world.tide[sector]);
  return tides;
}

export function runProduction(world, mod = {}) {
  const sfc = { readUniverse, bookWindows, sumBooks, outsideAll, outsideOf, buildMatrix, tiltOf, tiltCoverage, emptyTotals, ...mod };
  const uni = sfc.readUniverse(world.universe);
  const { books, counts } = sfc.bookWindows(world.rows, { column: uni.columnOf, deltaMicro: (r) => r.d, session: world.session });
  const tides = tidesOf(world);
  const columns = new Map();
  for (const c of COLUMNS) {
    const t = sfc.sumBooks(books, (b) => b.column === c);
    if (t.n > 0 || t.T > 0) columns.set(c, t);
  }
  const all = sfc.sumBooks(books);
  const outside = sfc.outsideAll(columns, tides);
  const matrix = sfc.buildMatrix(all, outside);
  const tilt = sfc.tiltOf(columns, uni.weights);
  return { uni, books, counts, columns, all, outside, matrix, tilt, tides };
}
