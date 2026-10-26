import assert from "node:assert/strict";
import { DTES, LIQUIDITY, REGIMES, runCell, summarize } from "./lib/forward-lab.mjs";
import * as FWD from "../shared/flows-quant-forward.js";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const TRIALS = Number(process.env.FORWARD_LAB_TRIALS || 60);
const AMERICAN_TRIALS = Number(process.env.FORWARD_LAB_AMERICAN_TRIALS || 24);
const STEPS = 100;
const SEED = 1;

const cellsOf = (regimes, trials = TRIALS) => {
  const out = [];
  for (const regime of regimes) for (const liquidity of Object.keys(LIQUIDITY)) for (const dte of DTES) {
    out.push({ dte, liquidity, regime, trials: regime === "american-dividend" ? AMERICAN_TRIALS : trials });
  }
  return out;
};

const run = (cells, impl = FWD) => cells.map((c) => ({ ...c, acc: runCell({ ...c, seed: SEED, steps: STEPS, impl }) }));

const pooled = (results, pick) => {
  let n = 0, ok2 = 0;
  for (const r of results) { const [a, b] = pick(r.acc); n += b; ok2 += a; }
  return { n, share: n === 0 ? null : ok2 / n };
};

const EUROPEAN = ["normal", "hard-to-borrow", "special-dividend"];

function criteria(results) {
  const bad = [];
  const fail = (label) => bad.push(label);
  const of = (regimes, liq = null) => results.filter((r) => regimes.includes(r.regime) && (liq === null || r.liquidity === liq));
  for (const r of of(["normal"])) {
    const s = summarize(r.acc);
    if (s.coverage < 0.93) fail(`normal ${s.cell}: the forward covers the truth ${s.coverage.toFixed(2)}`);
    if (s.plainN >= 100 && s.plain < 0.97) fail(`normal ${s.cell}: plain bands are right ${s.plain.toFixed(3)}`);
    if (s.pmN >= 100 && s.pm < 0.95) fail(`normal ${s.cell}: plus-minus bands are right ${s.pm.toFixed(3)}`);
  }
  for (const r of of(EUROPEAN)) {
    const s = summarize(r.acc);
    if (s.plainWithPairsN >= 100 && s.plainWithPairs < 0.97) fail(`${s.cell}: with three clean pairs a plain band is right ${s.plainWithPairs.toFixed(3)}`);
    if (s.pmWithPairsN >= 100 && s.pmWithPairs < 0.95) fail(`${s.cell}: with three clean pairs a plus-minus band is right ${s.pmWithPairs.toFixed(3)}`);
    if (s.bracketN >= 100 && s.bracket !== 1) fail(`${s.cell}: the bracket misses the truth (${s.bracket})`);
  }
  for (const regime of EUROPEAN) {
    const p = pooled(of([regime]), (a) => [a.coveredQualified, a.qualified]);
    if (p.n >= 100 && p.share < 0.93) fail(`${regime}: where the chain moves the forward it covers the truth ${p.share.toFixed(3)}`);
  }
  const htb7 = of(["hard-to-borrow"], "liquid").find((r) => r.dte.id === "7d");
  if (htb7 && summarize(htb7.acc).parity < 0.99) fail("hard to borrow, seven days, liquid: parity is chosen in fewer than 99% of chains");
  const american = of(["american-dividend"]);
  const am = american.filter((r) => r.liquidity === "liquid" && ["1d", "2d", "7d"].includes(r.dte.id));
  const pa = pooled(am, (a) => [a.covered, a.trials]);
  if (pa.n > 0 && pa.share < 0.9) fail(`american dividend, liquid, one to seven days: the forward covers the truth ${pa.share.toFixed(3)}`);
  for (const r of american) {
    const s = summarize(r.acc);
    if (s.medianCarryErrBp > 20 && s.medianErrBp > s.medianCarryErrBp) fail(`american ${s.cell}: the chosen forward is further from the truth than the carry`);
    if (s.bracketPuts !== 1) fail(`american ${s.cell}: the put-side bracket misses`);
  }
  return bad;
}

const fmt = (v, d = 3) => (v === null ? "-" : v.toFixed(d));

function report(results) {
  console.log("cell".padEnd(36), "pairs", "veto", "covers", "coversQ", "errBp", "carryBp", "plain", "pm", "dash", "plain3", "pm3", "bracket");
  for (const r of results) {
    const s = summarize(r.acc);
    console.log(s.cell.padEnd(36), fmt(s.parity, 2).padStart(5), fmt(s.vetoed, 2), fmt(s.coverage, 2).padStart(6), fmt(s.coverageQualified, 2).padStart(7), fmt(s.medianErrBp, 1).padStart(5), fmt(s.medianCarryErrBp, 1).padStart(7),
      `${fmt(s.plain, 3)}(${s.plainN})`, `${fmt(s.pm, 3)}(${s.pmN})`, fmt(s.dashShare, 2), `${fmt(s.plainWithPairs, 3)}(${s.plainWithPairsN})`, `${fmt(s.pmWithPairs, 3)}(${s.pmWithPairsN})`, fmt(s.bracket, 4));
  }
}

const t0 = Date.now();
const all = run(cellsOf(REGIMES));
report(all);

eq(criteria(all), [], "every calibration criterion holds on the correct build");
ok(all.length === 40, "forty cells: two liquidities, five expiries (three hours, one, two, seven and thirty days), four regimes");

{
  const again = run([all[0], all[15], all[33]]);
  eq(again.map((r) => summarize(r.acc)), [all[0], all[15], all[33]].map((r) => summarize(r.acc)), "the same seed gives the same statistics");
}

{
  const dash = summarize(all.find((r) => r.dte.id === "0dte" && r.liquidity === "illiquid" && r.regime === "normal").acc);
  const dashLiquid = summarize(all.find((r) => r.dte.id === "0dte" && r.liquidity === "liquid" && r.regime === "normal").acc);
  console.log(`three hours left: illiquid chains leave ${dash.rows} gated rows and the liquid ones ${dashLiquid.rows}; dash share ${fmt(dash.dashShare, 2)} and ${fmt(dashLiquid.dashShare, 2)}`);
  ok(dashLiquid.rows > 0, "a liquid three-hour chain still yields rows to judge");
}

{
  const pickCells = (regimes, liq, ids) => cellsOf(regimes).filter((c) => c.liquidity === liq && ids.includes(c.dte.id));
  const probeCells = [
    ...pickCells(["hard-to-borrow"], "liquid", ["1d", "7d"]),
    ...pickCells(["special-dividend"], "liquid", ["2d", "7d"]),
    ...pickCells(["special-dividend"], "illiquid", ["7d", "30d"]),
    ...pickCells(["american-dividend"], "liquid", ["1d", "2d"]),
    ...pickCells(["normal"], "liquid", ["2d"]),
  ];
  eq(criteria(run(probeCells)), [], "the reduced cell set used for the planted builds passes on the correct build");
  const mutants = [
    ["the carry's error never grows with a disagreement", [["const seC = Math.sqrt(carry.se * carry.se + Math.max(0, gap * gap - sePar * sePar - carry.se * carry.se));", "const seC = carry.se;"]]],
    ["the exercise guard missing", [["const sePar = z < -L.Z_TRUST ?", "const sePar = false ?"]]],
    ["blend weights swapped", [["out.F = (par.F * wp + carry.F * wc) / (wp + wc);", "out.F = (par.F * wc + carry.F * wp) / (wp + wc);"]]],
    ["the chain's forward never used", [["out.F = (par.F * wp + carry.F * wc) / (wp + wc);", "out.F = carry.F;"]]],
    ["parity error understated by ten", [["out.se = 1 / Math.sqrt(wp + wc);", "out.se = 0.1 / Math.sqrt(wp + wc);"]]],
    ["the call delta cut removed", [["return !(divides && call > L.CALL_DELTA_CUT);", "return true;"]]],
  ];
  const survived = [];
  for (const [title, transforms] of mutants) {
    const mod = await loadMutated("shared/flows-quant-forward.js", transforms);
    const bad = criteria(run(probeCells, { ...FWD, ...mod }));
    if (bad.length === 0) survived.push(title);
    checks++;
  }
  eq(survived, [], `all ${mutants.length} planted wrong builds fail a calibration criterion`);
}

console.log(`flows-forward-lab: ${checks} checks in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
