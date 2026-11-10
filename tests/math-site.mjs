import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as FEAT from "../shared/flows-features.js";
import * as POL from "../shared/flows-political.js";
import * as DEEP from "../shared/flows-deepen.js";
import * as ORC from "../shared/flows-oracle.js";
import { loadMutated } from "./truth/mutants.mjs";
import { bootModules } from "./lib/ui-boot.mjs";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-site.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-site-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");

function judge() {
  const bad = [];
  const say = (m) => { if (bad.length < 6) bad.push(m); };
  const near = (got, want, what, tol = 1e-9) => {
    if (want === null || want === undefined) { if (got !== null && got !== undefined) say(`${what}: ${got} where there is none`); return; }
    if (got === null || got === undefined || !Number.isFinite(got) || !(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)))) say(`${what}: ${got} against ${want}`);
  };
  const same = (got, want, what) => { if ((got ?? null) !== (want ?? null)) say(`${what}: ${got} against ${want}`); };
  return { bad, near, same, say };
}

function scores(M) {
  const j = judge();
  for (const [fam, c, p, want, agree] of FX.conviction) {
    const g = M.conviction({ familyScores: fam, coverage: c / 5, persistence: p / 20 });
    j.same(g.conviction, want, `conviction of ${fam.join(",")} at coverage ${c}/5 and persistence ${p}/20`);
    j.same(g.agree, agree, `agreeing families of ${fam.join(",")}`);
  }
  j.near(M.SCORE_SCALE, FX.scores.scale, "score scale", 1e-14);
  for (const [z, want] of FX.scores.cases) j.same(M.boundedScore(z, M.SCORE_SCALE), want, `score of z ${z}`);
  j.same(M.boundedScore(2, M.SCORE_SCALE), 80, "a residual of two robust deviations scores 80");
  return j.bad;
}

function political(M) {
  const j = judge();
  FX.political.rows.forEach((c, i) => {
    const b = M.netBounds(c.row);
    j.near(b.mid, c.mid, `political ${i} net midpoint`);
    j.near(b.lo, c.lo, `political ${i} low bound`);
    j.near(b.hi, c.hi, `political ${i} high bound`);
    if (!(b.lo <= b.mid && b.mid <= b.hi)) j.say(`political ${i}: the midpoint is outside its bounds`);
    j.same(M.stateOf(c.row), c.state, `political ${i} state`);
    j.near(M.treemapWeight(c.row, "usd"), c.weightUsd, `political ${i} tile weight by dollars`);
    j.near(M.treemapWeight(c.row, "fil"), c.weightFil, `political ${i} tile weight by filers`);
    j.near(M.blindShare(c.lag, c.win), c.blind, `political ${i} lag share`);
  });
  for (const text of FX.political.bands) {
    const b = M.parseBand(text);
    if (b.mid === null) { j.say(`band ${text} was not read`); continue; }
    if (!(b.hi <= M.SELL_BAND_HIGH_OVER_MID * b.mid)) j.say(`band ${text}: its top is above ${M.SELL_BAND_HIGH_OVER_MID} midpoints, so the low net bound is not a bound`);
    if (!(b.lo >= b.mid / M.SELL_BAND_LOW_UNDER_MID)) j.say(`band ${text}: its bottom is under a midpoint over ${M.SELL_BAND_LOW_UNDER_MID}, so the high net bound is not a bound`);
  }
  if (FX.political.rows.some((c) => /^red.*F$/.test(String(M.stateOf(c.row))))) j.say("a name is firm reducing");
  return j.bad;
}

function governor(M) {
  const j = judge();
  FX.governor.forEach((c, i) => {
    const g = M.governor(c.input);
    for (const k of ["cap", "backlog", "calls", "time"]) j.same(g.limits[k], c.limits[k], `governor ${i} ${k}`);
    j.same(g.binding, c.binding, `governor ${i} binding limit`);
    j.same(g.n, c.n, `governor ${i} names`);
  });
  const p = M.paceFor(500);
  j.same(p.perMinute, 400, "the pace is 80% of the minute line");
  j.same(p.spacingMs, 150, "and its spacing is 150 ms");
  return j.bad;
}

function oracle(M) {
  const j = judge();
  FX.oracle.forEach((c, i) => {
    const g = M.callsFor(JSON.parse(JSON.stringify(c.card)), null, { ticker: c.card.ticker });
    const e = c.expect;
    if (e.skip) { j.same(g.calls.length, 0, `oracle ${i} calls`); j.same(Object.keys(g.skipped)[0], e.skip, `oracle ${i} reason`); return; }
    if (g.calls.length !== 1) { j.say(`oracle ${i}: no call where one clears (${Object.keys(g.skipped)[0]})`); return; }
    const call = g.calls[0];
    j.same(call.verdict, e.verdict, `oracle ${i} verdict`);
    j.near(call.fairIv, e.fairIv, `oracle ${i} fair volatility`, 1.01e-4);
    j.near(call.edgeVol, e.edgeVol, `oracle ${i} edge in volatility`, 1.01e-4);
    j.near(call.edgeUsd, e.edgeUsd, `oracle ${i} edge in dollars`);
    j.same(call.grade, e.grade, `oracle ${i} grade`);
    if (e.verdict === "cheap" && !(call.fairIv > call.marketIv)) j.say(`oracle ${i}: a cheap call whose fair volatility is not above the market's`);
    if (e.verdict === "rich" && !(call.fairIv < call.marketIv)) j.say(`oracle ${i}: a rich call whose fair volatility is not below the market's`);
  });
  return j.bad;
}

const BLOCKS = [
  ["board score and conviction", "shared/flows-features.js", scores, FEAT],
  ["political net bounds, state, tile weights and lag share", "shared/flows-political.js", political, POL],
  ["the deepening governor's limits in exact arithmetic", "shared/flows-deepen.js", governor, DEEP],
  ["the Oracle's fair volatility, edge and bars", "shared/flows-oracle.js", oracle, ORC],
];
for (const [name, , run, mod] of BLOCKS) eq(run(mod).join("; "), "", `production equals the exact oracle: ${name}`);

ok(FX.oracle.some((c) => c.expect.verdict === "cheap") && FX.oracle.some((c) => c.expect.verdict === "rich") &&
  ["quote", "liquidity", "no-edge", "threshold", "grade"].every((s) => FX.oracle.some((c) => c.expect.skip === s)), "the Oracle cases hold a cheap call, a rich one and every refusal");
ok(["cap", "backlog", "calls", "time"].every((b) => FX.governor.some((c) => c.binding === b)) && FX.governor.some((c) => c.n === 0), "the governor cases reach every limit and a night with no batch");
ok(["accF", "accM", "redM", "mix"].every((s) => FX.political.rows.some((c) => c.state === s)), "the political cases reach every state");
ok(FX.conviction.filter(([fam, c, p, want]) => Math.round(100 * (0.45 * (fam.filter((s) => s === (Math.sign(fam.reduce((a, b) => a + b, 0)) || 1)).length / fam.length) + 0.35 * (c / 5) + 0.2 * (p / 20))) !== want).length >= 20,
  "the conviction grid holds exact halves that a plain floating-point round gets wrong");

const PLANTS = [
  ["conviction is rounded from a floating-point sum", "shared/flows-features.js", scores, [["Math.round(100 * Math.min(Math.max(value, 0), 1) + 1e-9)", "Math.round(100 * Math.min(Math.max(value, 0), 1))"]]],
  ["the score scale puts 80 at one deviation", "shared/flows-features.js", scores, [["Math.atanh(0.80) / 2.0", "Math.atanh(0.80)"]]],
  ["the low net bound takes the sold midpoint once", "shared/flows-political.js", political, [["export const SELL_BAND_HIGH_OVER_MID = 2;", "export const SELL_BAND_HIGH_OVER_MID = 1;"]]],
  ["a name with an open band is firm", "shared/flows-political.js", political, [["if (!open && b.lo > 0) return \"accF\";", "if (b.lo > 0) return \"accF\";"]]],
  ["the tile weight is linear in dollars", "shared/flows-political.js", political, [[": Math.sqrt(gross);", ": gross;"]]],
  ["the governor forgets the baseline's margin", "shared/flows-deepen.js", governor, [[" + budget.baselineCalls * budget.overrunMargin;", ";"]]],
  ["the governor rounds the call limit up", "shared/flows-deepen.js", governor, [["const byCalls = Math.floor(", "const byCalls = Math.ceil("]]],
  ["the Oracle's fair price ignores the side", "shared/flows-oracle.js", oracle, [["const fairPrice = l.model + l.side * edge / LOT;", "const fairPrice = l.model + edge / LOT;"]]],
  ["the Oracle takes the whole spread as the cost", "shared/flows-oracle.js", oracle, [["const spreadCost = (l.ask - l.bid) * LOT / 2;", "const spreadCost = (l.ask - l.bid) * LOT;"]]],
  ["the Oracle's volatility bar is one point", "shared/flows-oracle.js", oracle, [["edgeVol: 0.02,", "edgeVol: 0.01,"]]],
];
for (const [name, target, run, transforms] of PLANTS) ok(run(await loadMutated(target, transforms)).length > 0, `PLANTED WRONG BUILD FAILS: ${name}`);

{
  const page = readFileSync(new URL("../assets/js/flows-relations.js", import.meta.url), "utf8");
  const rate = Number((page.match(/const CHANCE = ([0-9.]+);/) || [])[1]);
  const said = (page.match(/unrelated names pass about (\d+) times in 100/) || [])[1];
  ok(Number.isFinite(rate) && said !== undefined && Number(said) === Math.round(rate * 100), "Relations states the chance-pass rate it multiplies by");
  ok(!/tested alone at 95%, so /.test(page), "and no longer derives that rate from the 95% test");
  ok(!(Number("5") === Math.round(rate * 100)) || /pass about 5 times in 100/.test(page), "PLANTED WRONG BUILD FAILS: a stated rate that is not the one used");
}
{
  const UI = bootModules(["flows-ui.js"]).window.FlowsUI;
  eq(UI.calibTag({ nEff: 100 }), null, "the calibration tag is absent once a payload carries 100 effective outcomes");
  const src = readFileSync(new URL("../assets/js/flows-ui.js", import.meta.url), "utf8");
  const wired = (text) => /fetch\("\/api\/flows\/calib"\)/.test(text) && /nEff\) >= 100\) el\.remove\(\)/.test(text) && /if \(c === undefined/.test(text);
  ok(wired(src), "a tag drawn with no payload reads the calibration payload and removes itself at 100 effective outcomes");
  ok(!wired(src.replace("if (c === undefined && typeof fetch === \"function\") {", "if (false) {")), "PLANTED WRONG BUILD FAILS: a tag that never reads the payload");
  const served = readFileSync(new URL("../server/routes/flows-read.js", import.meta.url), "utf8");
  ok(/row\("calib"/.test(served), "and the route it reads is served");
}

console.log(`math-site: ${checks} ✓`);
