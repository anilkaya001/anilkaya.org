import assert from "node:assert/strict";
import { readUniverse, bookWindows, sumBooks, outsideAll, outsideOf, buildMatrix, matrixSums, tiltOf, tiltCoverage, apportion, SECTORS, COLUMNS, FUNDS_COLUMN, NO_SECTOR, FUND_TICKERS, deltaMicroOf, drillSector } from "../shared/flows-sfc.js";
import { leanRead } from "../shared/flows-sides.js";
import { makeWorld } from "./lib/sfc-world.mjs";
import { compareWorld, oracleRun } from "./lib/sfc-compare.mjs";
import { runProduction, tidesOf } from "./lib/sfc-run.mjs";
import { oracleBook, ORACLE_SECTORS } from "./lib/sfc-oracle.mjs";
import { workedExample, tiltGolden, GOLDEN_SESSION } from "./lib/sfc-golden.mjs";
import { mulberry32 } from "./lib/sfc-rng.mjs";
import { loadVariant } from "./lib/sfc-variant.mjs";
import { runBattery, CHECKS } from "./lib/sfc-battery.mjs";
import { PLANTS } from "./lib/sfc-plants.mjs";
import { violations, shape, shuffled, scaleWorld, renameWorld, flipWorld, shiftWorld } from "./lib/sfc-props.mjs";
import { storedInput } from "./lib/sfc-stored.mjs";
import { ledgerView } from "../shared/flows-sfc-view.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

{
  const g = workedExample();
  const uni = readUniverse(g.universe);
  const { books, counts } = bookWindows(g.rows, { column: uni.columnOf, session: GOLDEN_SESSION });
  eq(counts.booked, 6, "all six windows of the worked example book");
  const totals = sumBooks(books);
  const columns = new Map([["Energy", totals]]);
  const outside = outsideAll(columns, new Map([["Energy", g.tide.Energy]]));
  eq([outside.calls, outside.puts], [50000000, -5000000], "outside rows: tide net calls 900k less held 400k is 500k, net puts 150k less held 200k is -50k");
  const m = buildMatrix(totals, outside);
  eq(m.rows, g.expected.rows, "the worked example's eleven rows, cell by cell, in cents");
  const sums = matrixSums(m);
  eq([sums.rowSums, sums.colSums], [Array(11).fill(0), Array(6).fill(0)], "every row and every column sums to zero");
  eq(totals.T, g.expected.total, "total premium 1,450k = bought + sold + no side");
  const lean = leanRead({ T: totals.T, A: totals.AC + totals.AP, B: totals.BC + totals.BP });
  eq([lean.pct.share, lean.pct.lo, lean.pct.hi, lean.pct.coverage, lean.side], [75, 62, 80, 83, "buyers"], "and the lean of the example: 75%, bounds 62-80%, buyers");
}

{
  const g = tiltGolden();
  const uni = readUniverse(g.universe);
  const { books } = bookWindows(g.rows, { column: uni.columnOf, deltaMicro: (r) => r.d, session: GOLDEN_SESSION });
  const columns = new Map();
  for (const c of COLUMNS) { const t = sumBooks(books, (b) => b.column === c); if (t.n > 0) columns.set(c, t); }
  eq(uni.columnOf("SPY"), FUNDS_COLUMN, "a fund with a stray sector and a cap lands in Index & ETF");
  eq(uni.columnOf("SYE105"), NO_SECTOR, "a name with no sector lands in No sector");
  eq([uni.weights.get("Technology"), uni.weights.get("Financial Services"), uni.weights.get("Energy")], [180000, 90000, 30000], "weights: summed caps of the sector names only, the fund's 999 never feeds Technology");
  for (const [c, v] of Object.entries(g.expected.X)) eq(columns.get(c).X, v, `X ${c}`);
  for (const [c, v] of Object.entries(g.expected.U)) eq(columns.get(c).Ub, v, `band exposure ${c}`);
  const tilt = tiltOf(columns, uni.weights);
  eq(tilt.weighted, ["Energy", "Financial Services", "Technology"], "weighted columns in column order");
  eq(tilt.total, g.expected.total, "the tilt total leaves Index & ETF out");
  for (const c of tilt.weighted) {
    const r = tilt.rows.get(c);
    eq([r.a, r.R, r.W, r.verdict], [g.expected.a[c], g.expected.R[c], g.expected.W[c], g.expected.verdict[c]], `a, R, W and verdict of ${c}`);
  }
  eq(tilt.sum, 0n, "the tilt sums to zero exactly");
  eq(tilt.rows.get(FUNDS_COLUMN).verdict, null, "Index & ETF has no verdict");
  const cov = tiltCoverage(columns, uni.weights);
  eq([cov.covered, cov.all], [9015000, 9275000], "delta coverage counts sided premium with a usable delta: 90,150 of 92,750 dollars");
  ok(cov.passes && cov.pct === 97, "97 percent passes the 80 percent gate");
  const { books: bad } = bookWindows(g.rows.map((r) => ({ ...r, d: r.d === null ? null : -r.d })), { column: uni.columnOf, deltaMicro: (r) => r.d, session: GOLDEN_SESSION });
  const mirror = new Map();
  for (const c of COLUMNS) { const t = sumBooks(bad, (b) => b.column === c); if (t.n > 0) mirror.set(c, t); }
  const mt = tiltOf(mirror, uni.weights);
  for (const c of tilt.weighted) {
    const a = tilt.rows.get(c), b = mt.rows.get(c);
    eq([b.X, b.a, b.R, b.W], [-a.X, -a.a, -a.R, a.W], `negating every delta negates X, a and R and leaves the band (${c})`);
  }
  eq([mt.rows.get("Technology").verdict, mt.rows.get("Financial Services").verdict], ["above", "below"], "and mirrors the verdicts");
}

{
  eq(apportion(2, [1, 1, 1]), [1n, 1n, 0n], "X = 2, caps 1/1/1: the first column in order gets the extra cents");
  eq(apportion(-2, [1, 1, 1]), [-1n, -1n, 0n], "X = -2 is the mirror, not [0, -1, -1]");
  eq(apportion(0, [3, 4]), [0n, 0n], "X = 0 allocates nothing");
  eq(apportion(5, [0, 0]), null, "no weight, no allocation");
  eq(apportion(9007199254740993n, [1, 1]), [4503599627370497n, 4503599627370496n], "2^53 + 1 split two ways stays exact (no float)");
  eq(apportion(7, [5, 3, 2]).reduce((a, b) => a + b, 0n), 7n, "the allocation sums to X");
}

{
  const row = { t: "SYA101", cp: "P", k: 100, exp: "2026-11-20", px: 100, ivEnd: 0.4, spanStart: "2026-10-23T14:00:00Z", spanEnd: "2026-10-23T14:05:00Z" };
  const norm = (x) => 0.5 * (1 + (() => { const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2); return x < 0 ? -y : y; })());
  const T = (Date.UTC(2026, 10, 20, 21, 0) - Date.parse(row.spanEnd)) / (365 * 86400 * 1000);
  const d1 = (Math.log(100 / 100) + (0.04 + 0.5 * 0.16) * T) / (0.4 * Math.sqrt(T));
  const call = norm(d1);
  const microC = deltaMicroOf({ ...row, cp: "C" });
  const microP = deltaMicroOf(row);
  ok(Math.abs(microC / 1e6 - call) < 2e-3, `call delta ${microC / 1e6} against an independent ${call}`);
  eq(microP, microC - 1000000, "put delta is call delta less one (r = 4%, q = 0 gives the forward factor one at the money to the micro)");
  ok(microP < 0 && microC > 0, "a put's delta is negative and a call's positive");
  eq(deltaMicroOf({ ...row, ivEnd: null, ivStart: null }), null, "no implied volatility, no delta");
  eq(deltaMicroOf({ ...row, ivEnd: 35 }), null, "a volatility quoted as 35 instead of 0.35 is not used");
  eq(deltaMicroOf({ ...row, ivEnd: null, ivStart: 0.4 }), microP, "the start volatility stands in for a missing end volatility");
  eq(deltaMicroOf({ ...row, exp: "2026-10-22" }), null, "an expiry before the window's date has no delta");
  ok(deltaMicroOf({ ...row, exp: "2026-10-23", spanEnd: "2026-10-23T21:30:00Z" }) !== null, "a window after the close on its expiry day floors time at 60 seconds");
  eq(deltaMicroOf({ ...row, px: 0 }), null, "no price, no delta");
  eq(deltaMicroOf({ ...row, k: -1 }), null, "no strike, no delta");
  eq(deltaMicroOf({ ...row, spanEnd: "garbage", spanStart: "garbage" }), null, "no usable time, no delta");
}

{
  const rnd = mulberry32(8675309);
  let worlds = 0, bad = 0;
  const shown = [];
  const paths = { ns: 0, invalid: 0, legCross: 0, noDelta: 0, putUnequal: 0, dup: 0, noTide: 0, tilt: 0, above: 0, below: 0, offSession: 0, funds: 0, noSector: 0, zero: 0 };
  for (let seed = 1; seed <= 2000; seed++) {
    const w = makeWorld(seed, { tight: seed % 5 === 0 });
    const m = compareWorld(w);
    worlds++;
    if (m.length) { bad++; if (shown.length < 3) shown.push(`seed ${seed}: ${m.join("; ")}`); }
    const p = runProduction(w);
    if (p.all.U.ns > 0) paths.ns++;
    if (p.counts.invalid > 0) paths.invalid++;
    if (p.all.U.leg > 0 && p.all.U.cross > 0) paths.legCross++;
    if (p.counts.noDelta > 0) paths.noDelta++;
    if (p.all.AP !== p.all.BP) paths.putUnequal++;
    if (p.counts.duplicate > 0) paths.dup++;
    if (p.outside === null || p.outside.measured.length < 11) paths.noTide++;
    if (p.tilt.sum !== null) paths.tilt++;
    for (const r of p.tilt.rows.values()) { if (r.verdict === "above") paths.above++; if (r.verdict === "below") paths.below++; }
    if (p.counts.offSession > 0) paths.offSession++;
    if (p.columns.has(FUNDS_COLUMN)) paths.funds++;
    if (p.columns.has(NO_SECTOR)) paths.noSector++;
    if (p.counts.zero > 0) paths.zero++;
  }
  eq(shown, [], `T1: ${worlds} seeded worlds, production against the BigInt oracle on every name, column, matrix cell, outside row, tilt, band and verdict`);
  eq(bad, 0, "and none differs");
  for (const [k, floor] of Object.entries({ ns: 1500, invalid: 800, legCross: 1500, noDelta: 1500, putUnequal: 1800, dup: 500, noTide: 1000, tilt: 1800, above: 100, below: 100, offSession: 500, funds: 300, noSector: 1000, zero: 400 })) {
    ok(paths[k] >= floor, `the worlds reach the path ${k} in ${paths[k]} worlds (at least ${floor})`);
  }
}

{
  const M = await loadVariant();
  eq(await runBattery(M), [], "the battery passes on the committed modules, loaded through the same relinking the plants use");
  ok(Object.keys(CHECKS).length >= 26, "and it holds at least twenty-six named checks");
  const seen = new Set();
  for (const plant of PLANTS) {
    ok(!seen.has(plant.id), `${plant.id} is declared once`);
    seen.add(plant.id);
    ok(Object.hasOwn(CHECKS, plant.expect), `${plant.id} names a check that exists (${plant.expect})`);
    const V = await loadVariant(plant, plant.id);
    const failed = await runBattery(V, [plant.expect]);
    ok(failed.length === 1 && failed[0].id === plant.expect && failed[0].thrown === false, `planted build ${plant.id} (${plant.title}) fails ${plant.expect} by an assertion, not a crash`);
  }
  ok(PLANTS.length >= 40, `${PLANTS.length} planted builds`);
  eq(Object.keys(CHECKS).filter((id) => !PLANTS.some((p) => p.expect === id)), [], "and every check has a planted build that names it");
}

{
  let bad = 0;
  const shown = [];
  for (let seed = 1; seed <= 400; seed++) {
    const w = makeWorld(seed, { tight: seed % 5 === 0, pathologies: seed % 4 !== 0 });
    const v = violations(w);
    if (v.length) { bad++; if (shown.length < 3) shown.push(`seed ${seed}: ${v.join("; ")}`); }
  }
  eq(shown, [], "T2: no invariant fails on 400 seeded worlds");
  eq(bad, 0, "T2: rows and columns sum to zero, books add to columns and columns to the whole, counts partition the rows, tilt sums to zero, verdicts follow R and the band");
}

{
  let n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const w = makeWorld(seed, { pathologies: seed % 2 === 0, tight: seed % 3 === 0 });
    const base = runProduction(w);
    const s0 = shape(base);
    eq(shape(runProduction({ ...w, rows: shuffled(w.rows, seed) })), s0, `M1 seed ${seed}: row order changes nothing`);
    eq(shape(runProduction({ ...w, rows: shuffled(w.rows.concat(w.rows), seed + 1) }), { counts: false }), shape(base, { counts: false }), `M2 seed ${seed}: every window read twice books once`);
    const twice = runProduction({ ...w, rows: w.rows.concat(w.rows) });
    eq(twice.counts.booked, base.counts.booked, `M2 seed ${seed}: booked windows are unchanged`);
    n += 2;
  }
  ok(n === 120, "T3 M1 and M2 ran on sixty worlds");
}

{
  for (let seed = 101; seed <= 140; seed++) {
    const w = makeWorld(seed, { pathologies: false, tight: seed % 2 === 0 });
    const base = runProduction(w);
    const k = [2, 3, 10, 7][seed % 4];
    const big = runProduction(scaleWorld(w, k));
    eq(big.all.T, base.all.T * k, `M3 seed ${seed}: premium times ${k} is total times ${k}`);
    eq(big.all.X, base.all.X, `M3 seed ${seed}: delta exposure does not move when every premium scales (shares are ratios)`);
    eq(big.all.Ub, base.all.Ub, `M3 seed ${seed}: nor the band`);
    const scaledRows = base.matrix.rows.map((r) => r.map((v) => (v === null ? null : v * k)));
    eq(big.matrix.rows, scaledRows, `M3 seed ${seed}: every matrix cell scales by ${k}`);
    if (base.tilt.sum !== null) {
      for (const c of base.tilt.weighted) {
        const a = base.tilt.rows.get(c), b = big.tilt.rows.get(c);
        eq([b.a, b.R, b.W, b.verdict], [a.a, a.R, a.W, a.verdict], `M3 seed ${seed}: tilt of ${c} is unchanged`);
      }
    }
  }
}

{
  for (let seed = 141; seed <= 180; seed++) {
    const w = makeWorld(seed, { pathologies: seed % 3 !== 0 });
    const base = runProduction(w);
    const names = [...new Set(w.rows.map((r) => r.t))].filter((t) => t.startsWith("SY") || t.startsWith("GONE"));
    const rename = new Map(names.map((t, i) => [t, "SYZ" + String(100 + i)]));
    const moved = runProduction(renameWorld(w, rename));
    eq(shape(moved, { names: false }), shape(base, { names: false }), `M4 seed ${seed}: renaming tickers keeps every column, cell and tilt`);
    for (const [t, b] of base.books) eq(moved.books.get(rename.has(t) ? rename.get(t) : t).T, b.T, `M4 seed ${seed}: ${t} keeps its premium under its new name`);
  }
}

{
  for (let seed = 181; seed <= 220; seed++) {
    const w = makeWorld(seed, { pathologies: false });
    const base = runProduction(w);
    const flipped = runProduction(flipWorld(w));
    eq([flipped.all.AC, flipped.all.BC, flipped.all.AP, flipped.all.BP], [base.all.AP, base.all.BP, base.all.AC, base.all.BC], `M5 seed ${seed}: calls and puts swap`);
    eq(flipped.all.X, -base.all.X, `M5 seed ${seed}: delta exposure changes sign`);
    eq(flipped.all.Ub, base.all.Ub, `M5 seed ${seed}: the band does not`);
    const a = base.matrix.rows, b = flipped.matrix.rows;
    eq([b[0], b[1], b[2], b[3], b[8], b[9]], [a[2], a[3], a[0], a[1], a[9], a[8]], `M5 seed ${seed}: rows 1 and 3, 2 and 4, 9 and 10 trade places`);
    eq(b.slice(4, 8).concat([b[10]]), a.slice(4, 8).concat([a[10]]), `M5 seed ${seed}: no-side rows and the balancing entry are the same`);
    if (base.tilt.sum !== null) {
      for (const c of base.tilt.weighted) {
        const x = base.tilt.rows.get(c), y = flipped.tilt.rows.get(c);
        eq([y.R, y.W], [-x.R, x.W], `M5 seed ${seed}: tilt of ${c} changes sign, its band does not`);
      }
    }
  }
}

{
  for (let seed = 221; seed <= 260; seed++) {
    const w = makeWorld(seed, { pathologies: true });
    const base = runProduction(w);
    const shifted = runProduction(shiftWorld(w, 7));
    eq(shape(shifted), shape(base), `M6 seed ${seed}: the same day a week later gives the same ledger`);
  }
}

{
  for (let seed = 261; seed <= 300; seed++) {
    const w = makeWorld(seed, { pathologies: false });
    const base = runProduction(w);
    const first = w.rows.find((r) => r.cp === "C" || r.cp === "P") || w.rows[0];
    if (!first) continue;
    const noise = [
      { ...first, cp: null, oc: first.oc + "x1" },
      { ...first, oc: first.oc + "x2", prem: 0, askPrem: 0, bidPrem: 0, raw: { ...first.raw, prem: "0.00", askPrem: "0.00", bidPrem: "0.00" } },
      { ...first, oc: first.oc + "x3", prem: 10, askPrem: 8, bidPrem: 3, raw: { ...first.raw, prem: "10.00", askPrem: "8.00", bidPrem: "3.00" } },
      { ...first, oc: first.oc + "x4", prem: null, raw: { ...first.raw, prem: null } },
      { ...first, oc: first.oc + "x5", spanStart: "2026-10-21T15:00:00.000Z", spanEnd: "2026-10-21T15:05:00.000Z" },
    ];
    const noisy = runProduction({ ...w, rows: shuffled(w.rows.concat(noise), seed) });
    eq(shape(noisy, { counts: false }), shape(base, { counts: false }), `M7 seed ${seed}: windows that cannot be booked change no figure`);
    eq([noisy.counts.noRight, noisy.counts.zero, noisy.counts.invalid, noisy.counts.unreadable, noisy.counts.offSession], [base.counts.noRight + 1, base.counts.zero + 1, base.counts.invalid + 1, base.counts.unreadable + 1, base.counts.offSession + 1], `M7 seed ${seed}: and each is counted under its own name`);
  }
}

{
  for (let seed = 301; seed <= 330; seed++) {
    const w = makeWorld(seed, { pathologies: false });
    const base = runProduction(w);
    const universe = { ...w.universe, t: [...w.universe.t, "SPY"], sec: [...w.universe.sec, 9], cols: { mcap: [...w.universe.cols.mcap, 3999999] } };
    const withFund = runProduction({ ...w, universe });
    eq([...withFund.uni.weights], [...base.uni.weights], `M8 seed ${seed}: a fund with a stray sector and a market cap adds no weight to any sector`);
    eq(shape(withFund, { counts: false }), shape(base, { counts: false }), `M8 seed ${seed}: and no figure moves`);
  }
}

{
  let tested = 0;
  for (let seed = 331; seed <= 400; seed++) {
    const w = makeWorld(seed, { tickers: 30, perName: 6, pathologies: false });
    const base = runProduction(w);
    if (base.tilt.sum === null) continue;
    const first = w.rows.find((r) => base.books.has(r.t) && base.tilt.weighted.includes(base.books.get(r.t).column) && Number.isInteger(r.d) && r.size > 0 && r.px !== null);
    if (!first) continue;
    const extra = { ...first, oc: first.oc + "u1", prem: 10, askPrem: 0, bidPrem: 0, raw: { ...first.raw, prem: "10.00", askPrem: "0.00", bidPrem: "0.00" } };
    const after = runProduction({ ...w, rows: w.rows.concat([extra]) });
    const j = base.books.get(first.t).column;
    const grown = after.columns.get(j).Ub - base.columns.get(j).Ub;
    ok(grown > 0n, `M11 seed ${seed}: a window with every side unknown adds to the uncertain exposure of its sector`);
    const total = base.tilt.weighted.reduce((a, c) => a + BigInt(base.uni.weights.get(c)), 0n);
    for (const c of base.tilt.weighted) {
      const a = base.tilt.rows.get(c), b = after.tilt.rows.get(c);
      eq([b.X, b.a, b.R], [a.X, a.a, a.R], `M11 seed ${seed}: ${c} keeps its exposure, its share and its tilt when a window of unknown side arrives`);
      const share = BigInt(base.uni.weights.get(c));
      const move = c === j ? (total - share) * grown : share * grown;
      const grew = b.W - a.W;
      ok(grew >= move / total && grew <= (move + total - 1n) / total, `M11 seed ${seed}: the band of ${c} grows by its own share of the new uncertainty and no more, so the total's uncertainty is in every band`);
      if (a.verdict === "above") ok(b.verdict === "above" || b.verdict === "undetermined", `M11 seed ${seed}: a proven verdict can only be lost, never reversed`);
      if (a.verdict === "below") ok(b.verdict === "below" || b.verdict === "undetermined", `M11 seed ${seed}: and likewise below`);
    }
    tested++;
  }
  ok(tested >= 30, `M11 ran on ${tested} worlds`);
}

{
  const w = makeWorld(777, { tickers: 24, perName: 18, pathologies: false });
  const input = storedInput(w);
  const all = ledgerView(input);
  eq(all.status, "ok", "the all-scope view builds");
  const cents = (x) => (x === null ? null : (x.startsWith("−") ? -1 : 1) * Number(x.replace(/[^0-9]/g, "")));
  const sums = Array.from({ length: 8 }, () => Array(4).fill(0));
  let scopes = 0;
  for (const column of COLUMNS) {
    const v = ledgerView({ ...input, scope: { kind: "sector", sector: column, key: "sector:" + column } });
    if (v.status !== "ok") continue;
    scopes++;
    eq(v.checks.items.filter((i) => ["rows", "columns", "sides", "sectors"].includes(i.id)).map((i) => i.state), ["pass", "pass", "pass", "absent"], `M10 ${column}: the ledger of one sector closes on itself, and the sector table is not claimed as a cross-check`);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) sums[r][c] += cents(v.ledger.rows[r].cells[c].x) || 0;
  }
  ok(scopes >= 3, `M10: ${scopes} sector ledgers were built`);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) eq(sums[r][c], cents(all.ledger.rows[r].cells[c].x) || 0, `M10: row ${r + 1} column ${c + 1} of the sector ledgers adds to the all-sector ledger`);
}

{
  const w = makeWorld(4242, { tickers: 14, perName: 9, pathologies: false });
  const input = storedInput(w);
  const frozen = JSON.parse(JSON.stringify(input));
  const a = ledgerView(input);
  const b = ledgerView(input);
  eq(a, b, "T9: the same record gives the same view");
  eq(JSON.parse(JSON.stringify(input)), frozen, "T9: and the view never writes to what it was given");
  const reread = ledgerView(JSON.parse(JSON.stringify(input)));
  eq(reread, a, "T9: nor does a copy that went through JSON");
  const rep = JSON.parse(JSON.stringify(a));
  eq(rep, JSON.parse(JSON.stringify(rep)), "T9: the view is JSON all the way down");
}

console.log(`✓ flows-sfc: ${checks} assertions`);
