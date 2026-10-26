import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { bsmGreeks, dollarGreeks, CONTRACT_SHARES } from "../shared/flows-quant-bs.js";
import * as DEALER from "../shared/flows-quant-dealer.js";
import * as CARD from "../shared/flows-quant-card.js";
import * as BSM from "../shared/flows-quant-bs.js";
import { loadMutated } from "./truth/mutants.mjs";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-dealer.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-dealer-fixtures.py", HERE))).digest("hex"),
  "the fixtures were written by this version of the generator");

function greekCases(BS) {
  const bad = [];
  for (const c of FX.greeks) {
    const S = Number(c.S);
    const g = BS.bsmGreeks({ S, K: Number(c.K), r: Number(c.r), q: Number(c.q), sigma: Number(c.sigma), T: Number(c.Tdays) / 365, type: c.type });
    for (const k of ["delta", "gamma", "vanna", "charm"]) {
      const want = Number(c.closed[k]), scale = Math.max(Math.abs(want), Number(c.atm[k]));
      if (!(Math.abs(g[k] - want) <= 1e-9 * scale)) bad.push(`${k} at S ${c.S}, K ${c.K}, sigma ${c.sigma}, ${c.Tdays} days, ${c.type}: ${g[k]} against ${want}`);
    }
    const near = (got, want, what) => { if (!(Math.abs(got - want) <= 1e-9 * Math.max(Math.abs(want), 1e-300))) bad.push(`${what} at S ${c.S}, K ${c.K}: ${got} against ${want}`); };
    const w = Object.fromEntries(["delta", "gamma", "vanna", "charm"].map((k) => [k, Number(c.closed[k])]));
    near(g.perUnit.charmPerCalendarDay, w.charm / 365, "charm per calendar day divides by 365, not 252");
    near(g.perUnit.vannaPerVolPoint, w.vanna / 100, "vanna per vol point divides by 100");
    near(g.perUnit.dollarGammaPer1pctPerContract, w.gamma * CONTRACT_SHARES * S * S * 0.01, "dollar gamma per 1% per contract is gamma x shares x S squared x 0.01");
    const d = BS.dollarGreeks(g, S);
    near(d.delta$, w.delta * CONTRACT_SHARES * S, "dollar delta");
    near(d["gamma$1pct"], w.gamma * CONTRACT_SHARES * S * S * 0.01, "dollar gamma per 1%");
    near(d["vannaPt$"], w.vanna * 0.01 * CONTRACT_SHARES * S, "dollar vanna per vol point");
    near(d["charmDay$"], w.charm * CONTRACT_SHARES * S / 365, "dollar charm per calendar day");
    if (c.fd) {
      for (const k of ["gamma", "vanna", "charm"]) {
        const scale = Math.max(Math.abs(Number(c.fd[k])), Number(c.atm[k]), 1e-12);
        if (!(Math.abs(g[k] - Number(c.fd[k])) <= 1e-6 * scale)) bad.push(`${k} does not agree with a central finite difference of the price at 50 digits`);
      }
    }
  }
  return bad;
}
for (const c of FX.greeks) ok(Number(c.S) !== 100, "no exposure fixture sits at a spot of 100, where the per-1% and per-dollar figures coincide");
eq(greekCases({ bsmGreeks, dollarGreeks }).join("; "), "", `delta, gamma, vanna and charm of ${FX.greeks.length} contracts equal the 50-digit closed forms to 1e-9, the finite differences to 1e-6, and the dollar forms use 365 days, 100 vol points and S squared`);

{
  const call = bsmGreeks({ S: 612.34, K: 640, r: 0.045, q: 0.012, sigma: 0.31, T: 0.2, type: "C" });
  const put = bsmGreeks({ S: 612.34, K: 640, r: 0.045, q: 0.012, sigma: 0.31, T: 0.2, type: "P" });
  const near = (a, b, m) => ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)), m);
  near(call.gamma, put.gamma, "gamma of a call equals gamma of a put");
  near(call.vanna, put.vanna, "vanna of a call equals vanna of a put");
  near(call.delta - put.delta, Math.exp(-0.012 * 0.2), "delta of a call less delta of a put is e^(-qT)");
  near(call.charm - put.charm, 0.012 * Math.exp(-0.012 * 0.2), "charm of a call less charm of a put is q e^(-qT)");
  const noDiv = [bsmGreeks({ S: 612.34, K: 640, r: 0.045, q: 0, sigma: 0.31, T: 0.2, type: "C" }), bsmGreeks({ S: 612.34, K: 640, r: 0.045, q: 0, sigma: 0.31, T: 0.2, type: "P" })];
  near(noDiv[0].charm, noDiv[1].charm, "with no dividend the charms are equal");
  const per1 = (g, S) => g.gamma * CONTRACT_SHARES * S * S * 0.01;
  const perDollar = (g, S) => g.gamma * CONTRACT_SHARES * S;
  near(per1(call, 612.34) / perDollar(call, 612.34), 612.34 / 100, "per 1% over per dollar is S / 100 at a spot of 612.34");
  near(dollarGreeks({ gamma: 0.012, delta: 0, vega: 0, theta: 0, vanna: 0, charm: 0 }, 250)["gamma$1pct"] * 5000, 3750000, "S 250, gamma 0.012, 5,000 open interest, 100 shares: 3,750,000 per 1%");
  near(perDollar({ gamma: 0.012 }, 250) * 5000, 1500000, "and 1,500,000 per dollar");
}

function profileCases(DM) {
  const bad = [];
  for (const p of FX.profiles) {
    const contracts = p.contracts.map((c) => ({ K: Number(c.K), T: Number(c.Tdays) / 365, sigma: Number(c.sigma), type: c.type, oi: c.oi }));
    const out = DM.gammaProfile({ spot: Number(p.spot), contracts, r: Number(p.r), q: Number(p.q), points: p.points, span: Number(p.span) });
    const peak = Math.max(...p.profile.map((v) => Math.abs(Number(v))));
    for (let i = 0; i < p.points; i++) {
      if (Math.abs(out.gex[i] - Number(p.profile[i])) > 1e-9 * peak) bad.push(`profile at spot ${p.spot} point ${i}`);
    }
    const roots = p.roots.map(Number);
    if (out.flips.length !== roots.length) bad.push(`spot ${p.spot}: ${out.flips.length} crossings where the oracle finds ${roots.length}`);
    for (const r of roots) {
      const nearest = out.flips.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), Infinity);
      if (!(Math.abs(nearest - r) <= 1e-9 * Number(p.spot))) bad.push(`spot ${p.spot}: the flip ${nearest} is ${Math.abs(nearest - r)} from the root ${r}`);
    }
    if (roots.length && !(Math.abs(out.flip - roots[0]) <= 1e-9 * Number(p.spot))) bad.push(`spot ${p.spot}: the reported flip ${out.flip} is not the root nearest spot ${roots[0]}`);
    if (!roots.length && out.flip !== null) bad.push(`spot ${p.spot}: a flip where the oracle finds none`);
  }
  return bad;
}
eq(profileCases(DEALER).join("; "), "", "the sticky-strike gamma profile equals the 50-digit oracle to 1e-9 of its peak and every zero crossing is the exact root to 1e-9 of spot");
ok(FX.profiles.some((p) => p.roots.length >= 2) && FX.profiles.some((p) => p.roots.length === 0) && FX.profiles.some((p) => p.roots.length === 1), "the fixtures hold a profile with several crossings, one with one and one with none");
ok(Math.max(...FX.profiles.map((p) => Number(p.spot))) >= 1000 && Math.min(...FX.profiles.map((p) => Number(p.spot))) < 10, "and spots from 8.25 to 1450");

eq(DEALER.gammaProfile({ spot: 100, contracts: [{ K: 100, T: 0.1, sigma: 0.3, type: "C", oi: 0 }] }).flips.length, 0, "a profile of zeros has no crossing");
{
  const contracts = [{ K: 90, T: 0.1, sigma: 0.3, type: "P", oi: 1000 }, { K: 110, T: 0.1, sigma: 0.3, type: "C", oi: 1000 }];
  const out = DEALER.gammaProfile({ spot: 100, contracts, r: 0, q: 0 });
  eq(out.flips.length, 1, "puts below and calls above cross once");
  const peak = Math.max(...out.gex.map(Math.abs));
  ok(Math.abs(out.at(out.flip)) <= 1e-9 * peak, "the profile is zero at the flip it reports, to 1e-9 of its peak");
  ok(out.flip > 90 && out.flip < 110, "between the two clusters");
}

function crossingCases(DM) {
  const bad = [];
  const line = (x) => x - 1.5;
  const cases = [
    [[1, 2], [-0.5, 0.5], 1, "a clean sign change"],
    [[1, 2, 3], [-1, 0, 1], 1, "an exact zero between a negative and a positive is one crossing, not two"],
    [[1, 2, 3], [-1, 0, -1], 0, "a touch of zero from below is not a sign change"],
    [[1, 2, 3, 4], [-1, 0, 0, 1], 1, "a run of zeros between opposite signs is one crossing"],
    [[1, 2, 3], [0, 0, 0], 0, "a profile of zeros has none"],
    [[1, 2, 3, 4], [1, -1, 1, -1], 3, "three alternating crossings are three"],
  ];
  for (const [grid, values, want, what] of cases) {
    const got = DM.zeroCrossings(grid, values, line, 1e-12);
    if (got.length !== want) bad.push(`${what}: ${got.length} where ${want} is right`);
  }
  const one = DM.zeroCrossings([1, 2], [-0.5, 0.5], line, 1e-12);
  if (!(Math.abs(one[0] - 1.5) < 1e-9)) bad.push(`the polished root of a line is ${one[0]}, not 1.5`);
  const zero = DM.zeroCrossings([1, 2, 3], [-1, 0, 1], line, 1e-12);
  if (zero[0] !== 2) bad.push(`a crossing at an exact zero is reported at ${zero[0]}, not at the grid point 2`);
  return bad;
}
eq(crossingCases(DEALER).join("; "), "", "crossings are counted once at an exact zero, not at a tangency, and each is polished to its root");

function bookCases(CM) {
  const bad = [];
  for (const b of FX.books) {
    const out = CM.bookLevels(b.rows, { spot: b.spot });
    for (const [k, want] of Object.entries(b.expect)) {
      const got = k === "gex" ? out.gex : out[k];
      if (k === "gex" ? Math.abs(got - want) > 1e-12 * Math.max(1, Math.abs(want)) : got !== want) bad.push(`${b.name}: ${k} is ${got} where ${want} is right`);
    }
    if (b.expect.putSign === "mixed" && (out.gex !== null || out.magnet !== null)) bad.push(`${b.name}: a mixed book published a net or a magnet`);
  }
  return bad;
}
eq(bookCases(CARD).join("; "), "", "the book is read by the dollars each sign carries: a defect row is tolerated under 1% of the put dollars, and it is mixed above it, whatever the row count");
ok(FX.books.some((b) => b.expect.gex === 1750000), "and the fixture's net (1,750,000) is not the per-dollar call gamma (1,500,000), so a swap between them cannot pass");

{
  const src = readFileSync(new URL("../shared/flows-quant-card.js", import.meta.url), "utf8");
  ok(/CONTRACT_SHARES/.test(src) && !/oi \* 100 \*/.test(src), "the dealer coverage uses the one named contract multiplier, not a literal 100");
}

const MUTANTS = [
  ["the dollar gamma of a contract is per dollar, not per 1%", "shared/flows-quant-bs.js", [["dollarGammaPer1pctPerContract: gamma * CONTRACT_SHARES * S * S * 0.01", "dollarGammaPer1pctPerContract: gamma * CONTRACT_SHARES * S"]], greekCases, BSM],
  ["the dollar gamma of the desk is per dollar, not per 1%", "shared/flows-quant-bs.js", [["gamma$1pct: g.gamma * CONTRACT_SHARES * S * S * 0.01", "gamma$1pct: g.gamma * CONTRACT_SHARES * S"]], greekCases, BSM],
  ["vanna per vol point is per 1.00 of volatility", "shared/flows-quant-bs.js", [["vannaPerVolPoint: vanna / 100", "vannaPerVolPoint: vanna"]], greekCases, BSM],
  ["the dollar vanna forgets the vol point", "shared/flows-quant-bs.js", [["vannaPt$: g.vanna * 0.01 * CONTRACT_SHARES * S", "vannaPt$: g.vanna * CONTRACT_SHARES * S"]], greekCases, BSM],
  ["charm per day divides by 252 trading days", "shared/flows-quant-bs.js", [["charmPerCalendarDay: charm / 365", "charmPerCalendarDay: charm / 252"]], greekCases, BSM],
  ["charm is the derivative in the time to expiry", "shared/flows-quant-bs.js", [["const charm = call ? q * eq * Nd1 + base : -q * eq * Nmd1 + base;", "const charm = -(call ? q * eq * Nd1 + base : -q * eq * Nmd1 + base);"]], greekCases, BSM],
  ["vanna has the opposite sign", "shared/flows-quant-bs.js", [["const vanna = -eq * pd1 * d2 / sigma;", "const vanna = eq * pd1 * d2 / sigma;"]], greekCases, BSM],
  ["a put delta without the dividend discount", "shared/flows-quant-bs.js", [["const delta = call ? eq * Nd1 : -eq * Nmd1;", "const delta = call ? eq * Nd1 : -Nmd1;"]], greekCases, BSM],
  ["the flip is interpolated inside its grid cell", "shared/flows-quant-dealer.js", [["polishRoot(at, grid[last], values[last], grid[i], values[i], tol)", "grid[last] + (grid[i] - grid[last]) * values[last] / (values[last] - values[i])"]], profileCases, DEALER],
  ["a profile cell that touches zero counts twice", "shared/flows-quant-dealer.js", [["if (values[i] === 0) continue;", ""]], crossingCases, DEALER],
  ["the first zero of a run is not the crossing", "shared/flows-quant-dealer.js", [["i - last > 1 ? grid[last + 1] :", "i - last > 1 ? grid[i] :"]], crossingCases, DEALER],
  ["the profile forgets the factor of spot", "shared/flows-quant-dealer.js", [["return g * x;", "return g;"]], profileCases, DEALER],
  ["the put sign is voted by row count", "shared/flows-quant-card.js", [["if (p !== null && p > 0) pos += p;\n    if (p !== null && p < 0) neg -= p;", "if (p !== null && p > 0) pos += 1;\n    if (p !== null && p < 0) neg += 1;"]], bookCases, CARD],
  ["the mixed line sits at five percent", "shared/flows-quant-card.js", [["const BOOK_MIXED_SHARE = 0.01;", "const BOOK_MIXED_SHARE = 0.05;"]], bookCases, CARD],
  ["the put sign is always the dealer's", "shared/flows-quant-card.js", [["const sign = neg >= pos ? 1 : -1;", "const sign = 1;"]], bookCases, CARD],
  ["no puts is called a dealer book", "shared/flows-quant-card.js", [['putSign: pos + neg === 0 ? "none" : mixed', 'putSign: mixed']], bookCases, CARD],
  ["the book net adds the put leg twice", "shared/flows-quant-card.js", [["const book = r.c + put;", "const book = r.c + put + r.p;"]], bookCases, CARD],
];
for (const [name, rel, transforms, battery] of MUTANTS) {
  let mod;
  try { mod = await loadMutated(rel, transforms, { salt: Math.floor(Math.random() * 1e6) }); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  ok(battery(mod).length > 0, `planted wrong build must fail: ${name}`);
}

console.log(`✓ math-dealer: ${checks} assertions - closed-form delta, gamma, vanna and charm against 50-digit mpmath at spots from 8.25 to 1450 (never 100), the sticky-strike profile and every zero crossing to 1e-9 of spot, the put-sign vote by dollars, and ${MUTANTS.length} planted wrong builds that each fail`);
