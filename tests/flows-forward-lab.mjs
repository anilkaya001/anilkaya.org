import assert from "node:assert/strict";
import { DTES, LIQUIDITY, REGIMES, runCell, summarize } from "./lib/forward-lab.mjs";
import * as FWD from "../shared/flows-quant-forward.js";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const TRIALS = Number(process.env.FORWARD_LAB_TRIALS || 60);
const AMERICAN_TRIALS = Number(process.env.FORWARD_LAB_AMERICAN_TRIALS || 30);
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
  const of = (regimes, liq = null, ids = null) => results.filter((r) => regimes.includes(r.regime) && (liq === null || r.liquidity === liq) && (ids === null || ids.includes(r.dte.id)));
  const stat = (r) => summarize(r.acc);

  for (const r of of(["normal"])) {
    const s = stat(r);
    if (s.coverage < 0.93) fail(`normal ${s.cell}: the forward covers the truth ${s.coverage.toFixed(2)}`);
    if (s.plainN >= 100 && s.plain < 0.99) fail(`normal ${s.cell}: plain bands are right ${s.plain.toFixed(3)}`);
    if (s.pmN >= 100 && s.pm < 0.95) fail(`normal ${s.cell}: plus-minus bands are right ${s.pm.toFixed(3)}`);
  }
  for (const r of of(["normal"], "liquid")) {
    const s = stat(r);
    if (s.dashShare > 0.02) fail(`normal ${s.cell}: ${s.dashShare.toFixed(3)} of the rows are a dash where the chain is clean`);
    if (s.rows >= 100 && s.plainN / s.rows < 0.9) fail(`normal ${s.cell}: only ${(s.plainN / s.rows).toFixed(3)} of the rows of a clean chain are plain, the rest are wider than they need to be`);
    if (s.chainsN >= 30 && s.chainsBad > 0.02) fail(`normal ${s.cell}: ${s.chainsBad.toFixed(3)} of the chains have a row outside its band`);
    if (s.medianErrBp > 2.5) fail(`normal ${s.cell}: the forward is ${s.medianErrBp.toFixed(1)} bp from the truth`);
  }
  for (const r of of(EUROPEAN)) {
    const s = stat(r);
    if (s.plainWithPairsN >= 100 && s.plainWithPairs < 0.97) fail(`${s.cell}: with three clean pairs a plain band is right ${s.plainWithPairs.toFixed(3)}`);
    if (s.pmWithPairsN >= 100 && s.pmWithPairs < 0.95) fail(`${s.cell}: with three clean pairs a plus-minus band is right ${s.pmWithPairs.toFixed(3)}`);
    if (s.bracketN >= 100 && s.bracket !== 1) fail(`${s.cell}: the bracket misses the truth (${s.bracket})`);
    if (s.early > 0.01) fail(`${s.cell}: the early-exercise flag fires on ${s.early.toFixed(2)} of the chains of a European world`);
  }
  for (const r of of(EUROPEAN, "liquid")) {
    const s = stat(r);
    if (s.plainWithPairsN >= 100 && s.plainWithPairs < 0.99) fail(`${s.cell}: with three clean pairs a plain band in a liquid chain is right ${s.plainWithPairs.toFixed(3)}`);
    if (s.chainsN >= 30 && s.parity >= 0.9 && s.chainsBad > 0.05) fail(`${s.cell}: ${s.chainsBad.toFixed(3)} of the chains have a row outside its band`);
    if (s.parity >= 0.9 && s.medianErrBp > 2.5) fail(`${s.cell}: the forward is ${s.medianErrBp.toFixed(1)} bp from the truth`);
  }
  for (const regime of EUROPEAN) {
    const p = pooled(of([regime]), (a) => [a.coveredQualified, a.qualified]);
    if (p.n >= 100 && p.share < 0.93) fail(`${regime}: where the chain moves the forward it covers the truth ${p.share.toFixed(3)}`);
  }
  {
    const eu = of(EUROPEAN);
    const low = pooled(eu, (a) => [a.zbins.low.ok, a.zbins.low.n]);
    const mid = pooled(eu, (a) => [a.zbins.mid.ok, a.zbins.mid.n]);
    const high = pooled(eu, (a) => [a.zbins.high.ok, a.zbins.high.n]);
    if (low.n >= 100 && low.share < 0.93) fail(`where the chain agrees with the carry (|z| under 1.5) the forward covers the truth ${low.share.toFixed(3)}`);
    if (mid.n >= 30 && mid.share < 0.88) fail(`where the chain half agrees (|z| from 1.5 to 3) the forward covers the truth ${mid.share.toFixed(3)}`);
    if (high.n >= 100 && high.share < 0.93) fail(`where the chain disagrees with the carry (|z| over 3) the forward covers the truth ${high.share.toFixed(3)}`);
  }
  for (const regime of ["hard-to-borrow", "special-dividend"]) {
    for (const r of of([regime], "liquid", ["2d", "7d", "30d"])) {
      const s = stat(r);
      if (s.medianCarryErrBp > 10 && s.medianErrBp > s.medianCarryErrBp / 8) fail(`${s.cell}: the chosen forward (${s.medianErrBp.toFixed(1)} bp) is not an eighth of the carry's error (${s.medianCarryErrBp.toFixed(1)} bp)`);
    }
  }
  const htb7 = of(["hard-to-borrow"], "liquid", ["7d"])[0];
  if (htb7 && stat(htb7).parity < 0.99) fail("hard to borrow, seven days, liquid: parity is chosen in fewer than 99% of chains");
  const american = of(["american-dividend"]);
  const pa = pooled(of(["american-dividend"], "liquid", ["1d", "2d", "7d"]), (a) => [a.covered, a.trials]);
  if (pa.n > 0 && pa.share < 0.9) fail(`american dividend, liquid, one to seven days: the forward covers the truth ${pa.share.toFixed(3)}`);
  for (const r of american) {
    const s = stat(r);
    if (s.medianCarryErrBp > 20 && s.medianErrBp > s.medianCarryErrBp) fail(`american ${s.cell}: the chosen forward is further from the truth than the carry`);
    if (s.bracketPuts !== 1) fail(`american ${s.cell}: the put-side bracket misses`);
  }
  for (const r of of(["american-dividend"], "liquid", ["1d", "2d", "7d", "30d"])) {
    const s = stat(r);
    const rows = s.plainN + s.pmN;
    const right = rows === 0 ? null : (s.plain * s.plainN + s.pm * s.pmN) / rows;
    if (s.medianErrBp > s.medianCarryErrBp / 5) fail(`american ${s.cell}: the chosen forward (${s.medianErrBp.toFixed(1)} bp) is not a fifth of the carry's error (${s.medianCarryErrBp.toFixed(1)} bp)`);
    if (rows >= 100 && right < 0.9) fail(`american ${s.cell}: plain and plus-minus bands together are right ${right.toFixed(3)}`);
    if (s.chainsN >= 20 && s.chainsBad > 0.3) fail(`american ${s.cell}: ${s.chainsBad.toFixed(3)} of the chains have a row outside its band`);
  }
  for (const r of of(["american-dividend"], "liquid", ["1d", "2d", "7d"])) {
    const s = stat(r);
    if (s.early < 0.75) fail(`american ${s.cell}: the early-exercise flag fires on only ${s.early.toFixed(2)} of the chains`);
  }
  return bad;
}

const fmt = (v, d = 3) => (v === null ? "-" : v.toFixed(d));

function report(results) {
  console.log("cell".padEnd(36), "pairs", "veto", "covers", "coversQ", "errBp", "carryBp", "plain", "pm", "dash", "plain3", "pm3", "badChains", "early", "bracketC", "bracketP", "held", "z<1.5", "z1.5-3", "z>3");
  for (const r of results) {
    const s = summarize(r.acc);
    console.log(s.cell.padEnd(36), fmt(s.parity, 2).padStart(5), fmt(s.vetoed, 2), fmt(s.coverage, 2).padStart(6), fmt(s.coverageQualified, 2).padStart(7), fmt(s.medianErrBp, 1).padStart(5), fmt(s.medianCarryErrBp, 1).padStart(7),
      `${fmt(s.plain, 3)}(${s.plainN})`, `${fmt(s.pm, 3)}(${s.pmN})`, fmt(s.dashShare, 2), `${fmt(s.plainWithPairs, 3)}(${s.plainWithPairsN})`, `${fmt(s.pmWithPairs, 3)}(${s.pmWithPairsN})`,
      `${fmt(s.chainsBad, 2)}(${s.chainsN})`, fmt(s.early, 2), fmt(s.bracketCalls, 3), fmt(s.bracketPuts, 3), fmt(s.bracketSuppressed, 2),
      `${fmt(s.zLow, 2)}(${s.zLowN})`, `${fmt(s.zMid, 2)}(${s.zMidN})`, `${fmt(s.zHigh, 2)}(${s.zHighN})`);
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
  const reported = all.filter((r) => r.regime === "american-dividend" && (r.dte.id === "0dte" || r.liquidity === "illiquid")).map((r) => summarize(r.acc));
  const worst = reported.reduce((a, x) => (x.coverage < a.coverage ? x : a), reported[0]);
  console.log(`reported, not asserted: the American three-hour and illiquid cells cover the truth from ${fmt(worst.coverage, 2)} (${worst.cell}); a dividend the card does not list cannot be seen from a chain with no strike spread`);
  ok(reported.length === 6, "six reported cells: the three-hour liquid chain and the five illiquid ones");
}

{
  const pickCells = (regimes, liq, ids) => cellsOf(regimes).filter((c) => c.liquidity === liq && ids.includes(c.dte.id));
  const probeCells = [
    ...pickCells(["hard-to-borrow"], "liquid", ["1d", "2d", "7d", "30d"]),
    ...pickCells(["special-dividend"], "liquid", ["2d", "7d"]),
    ...pickCells(["special-dividend"], "illiquid", ["7d", "30d"]),
    ...pickCells(["american-dividend"], "liquid", ["1d", "2d", "7d"]),
    ...pickCells(["normal"], "liquid", ["1d", "2d", "30d"]),
  ];
  eq(criteria(run(probeCells)), [], "the reduced cell set used for the planted builds passes on the correct build");
  const EARLY = "const early = clamp01((-z - lo) / width) * (par.slopeZ === null ? 1 : clamp01((-par.slopeZ - lo) / width));";
  const mutants = [
    ["the carry's error never grows with a disagreement", [["const seC = Math.sqrt(carry.se * carry.se + Math.max(0, shifted * shifted - sePar * sePar - carry.se * carry.se));", "const seC = carry.se;"]]],
    ["the early-exercise correction missing", [[EARLY, "const early = 0;"]]],
    ["the early-exercise correction not gated by the slope", [[EARLY, "const early = clamp01((-z - lo) / width);"]]],
    ["the parity forward shifted toward the carry", [["const parF = par.F - early * L.EEP_SHIFT * Math.abs(gap);", "const parF = par.F + early * L.EEP_SHIFT * Math.abs(gap);"]]],
    ["the parity forward never shifted", [["const parF = par.F - early * L.EEP_SHIFT * Math.abs(gap);", "const parF = par.F;"]]],
    ["the exercise error never added", [["const sePar = early > 0 ? Math.sqrt(par.se * par.se + (early * L.EEP_SD * gap) ** 2) : par.se;", "const sePar = par.se;"]]],
    ["the early-exercise flag never raised", [["out.ee = z < -L.Z_TRUST && par.slopeZ !== null && par.slopeZ < -L.Z_TRUST;", "out.ee = false;"]]],
    ["the early-exercise flag raised without the slope", [["out.ee = z < -L.Z_TRUST && par.slopeZ !== null && par.slopeZ < -L.Z_TRUST;", "out.ee = z < -L.Z_TRUST;"]]],
    ["blend weights swapped", [["out.F = (parF * wp + carry.F * wc) / (wp + wc);", "out.F = (parF * wc + carry.F * wp) / (wp + wc);"]]],
    ["the chain's forward never used", [["out.F = (parF * wp + carry.F * wc) / (wp + wc);", "out.F = carry.F;"]]],
    ["parity error understated by ten", [["out.se = 1 / Math.sqrt(wp + wc);", "out.se = 0.1 / Math.sqrt(wp + wc);"]]],
    ["parity error overstated by ten", [["out.se = 1 / Math.sqrt(wp + wc);", "out.se = 10 / Math.sqrt(wp + wc);"]]],
    ["the call delta cut removed", [["return !(divides && call > L.CALL_DELTA_CUT);", "return true;"]]],
    ["the Birge ratio dropped", [["const sePure = seStat * (birge === null ? 1 : Math.max(1, birge));", "const sePure = seStat;"]]],
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
