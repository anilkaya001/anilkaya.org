import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import * as PREM from "../shared/flows-premium.js";
import * as ENGINE from "../shared/flows-quant-engine.js";
import { loadMutated } from "./truth/mutants.mjs";
import { engineBlock, NODE_Q } from "./desk-fixtures.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const FIX = JSON.parse(readFileSync(new URL("./fixtures-shortcall.json", import.meta.url), "utf8"));
const gen = readFileSync(new URL("./gen-shortcall-fixtures.py", import.meta.url));
eq(FIX.provenance.generatorSha256, createHash("sha256").update(gen).digest("hex"), "the fixtures were written by this version of the generator");
ok(FIX.cases.length >= 500, `${FIX.cases.length} reference cases`);

const chunkSource = readFileSync(new URL("../assets/js/flows-desk-calls.js", import.meta.url), "utf8");
const ctx = vm.createContext({});
vm.runInContext(chunkSource, ctx);
const CHUNK = ctx.__FlowsDeskCallsTest;
ok(CHUNK && Object.isFrozen(CHUNK), "the chunk exposes a frozen test hook where there is no document");

const num = (s) => (s === null ? null : Number(s));
const callArgs = (i) => ({ spot: num(i.spot), delta: num(i.delta), days: i.days, contracts: i.contracts, convention: i.convention, haircut: num(i.haircut), floor: num(i.floor), buyingPower: num(i.buyingPower) });
const EXACT = ["ok", "binding", "m1C", "bidC", "intrC", "tvC", "n", "premiumC", "collateralC", "idleC", "affordable", "limited"];
const CLOSE = ["ratio", "grossRatio", "annRatio"];

function battery(mod, tag) {
  const bad = [];
  FIX.cases.forEach((c, k) => {
    const got = mod.shortCallLine({ bid: num(c.in.bid), strike: num(c.in.strike) }, callArgs(c.in));
    for (const f of EXACT.filter((x) => x in c.out)) if (got[f] !== c.out[f]) bad.push(`${tag} case ${k} ${f}: ${got[f]} vs ${c.out[f]}`);
    if (!c.out.ok && got.why !== c.out.why) bad.push(`${tag} case ${k} why`);
    for (const f of CLOSE.filter((x) => x in c.out)) {
      const a = got[f], b = c.out[f];
      if ((a === null) !== (b === null) || (a !== null && Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(b)))) bad.push(`${tag} case ${k} ${f}: ${a} vs ${b}`);
    }
  });
  const L = (extra, row = { bid: 1.69, strike: 230 }) => mod.shortCallLine(row, { spot: 227.28, delta: 0.3603, days: 3, ...extra });
  if (L({}).m1C !== 245667) bad.push(tag + " worked example A collateral");
  if (L({ convention: "regt" }).m1C !== 427360) bad.push(tag + " worked example A reg-t");
  if (L({ convention: "shares" }).m1C !== 2272800) bad.push(tag + " worked example A shares");
  if (L({ spot: null }).why !== "no-spot") bad.push(tag + " no-spot");
  if (L({ delta: null }).why !== "no-delta") bad.push(tag + " no-delta");
  for (const d of [1.0000001, -0.01, NaN, Infinity]) {
    const w = L({ delta: d });
    if (w.ok || (w.why !== "bad-delta" && w.why !== "no-delta")) bad.push(tag + " bad delta " + d);
  }
  const z = L({ delta: 0, floor: 0 });
  if (z.ok || z.why !== "no-collateral" || z.ratio !== null) bad.push(tag + " no-collateral");
  if (L({ haircut: 0.01 }).why !== "bad-terms" || L({ floor: 0.6 }).why !== "bad-terms" || L({ haircut: NaN }).why !== "bad-terms") bad.push(tag + " bad-terms");
  const tie = mod.shortCallCollateral({ spot: 100, strike: 105, delta: 0.2, haircut: 0.5, floor: 0.1 });
  if (tie.binding !== "floor" || tie.m1C !== 100000) bad.push(tag + " tie is floor");
  const kink = mod.shortCallCollateral({ spot: 100, strike: 105, delta: 0.1 / 0.3, haircut: 0.3, floor: 0.1 });
  if (kink.m1C !== 100000) bad.push(tag + " kink collateral");
  const nobp = L({ buyingPower: 25000 });
  if (nobp.n !== 10 || nobp.premiumC !== 169000 || nobp.collateralC !== 2456670 || nobp.idleC !== 43330) bad.push(tag + " buying power 25,000 sizing");
  if (L({ buyingPower: 400000 }).n !== 100 || L({ buyingPower: 400000 }).idleC !== 15433300) bad.push(tag + " buying power 400,000 sizing");
  const cap = L({ buyingPower: 1e9, contracts: 7 });
  if (cap.n !== 7) bad.push(tag + " N caps n");
  const small = L({ buyingPower: 1000 });
  if (small.n !== 0 || small.affordable || !(small.ratio > 0)) bad.push(tag + " unaffordable keeps its ratio");
  const itm = mod.shortCallLine({ bid: 8.6, strike: 220 }, { spot: 227.28, delta: 0.66, days: 12 });
  if (itm.tvC !== 13200 || itm.m1C !== 450014 || Math.abs(itm.ratio - 0.029332) > 1e-5) bad.push(tag + " ITM ratio is on time value");
  for (const [b, c] of [[0.06195, 620], [0.06495, 650], [0.05015, 502], [1.235, 12350]]) if (L({}, { bid: b, strike: 230 }).bidC !== c) bad.push(tag + " a " + b + " bid is " + c + " cents, half up");
  const gr = L({}, { bid: 8.6, strike: 220 });
  if (gr.grossRatio !== gr.bidC / gr.m1C || !(gr.grossRatio > gr.ratio)) bad.push(tag + " the gross ratio is the whole bid over the collateral");
  if (Math.abs(L({}).annRatio - 8.3697308) > 1e-6) bad.push(tag + " annualised on 365");
  if (L({ days: 0 }).annRatio !== null) bad.push(tag + " zero days annualise to null");
  if (L({ contracts: 5 }).ratio !== L({ contracts: 500 }).ratio) bad.push(tag + " ratio is independent of N");
  if (L({ contracts: 40 }).premiumC * 2 !== L({ contracts: 80 }).premiumC || L({ contracts: 40 }).collateralC * 2 !== L({ contracts: 80 }).collateralC) bad.push(tag + " linear in N");
  return bad;
}

{
  const bad = battery(PREM, "oracle");
  eq(bad.slice(0, 5), [], "the oracle matches every reference case, exactly in cents");
  const chunkBad = battery(CHUNK, "chunk");
  eq(chunkBad.slice(0, 5), [], "the chunk's copy matches every reference case too");
}

{
  let seed = 20261018;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  let bad = 0, badChunk = 0, badSame = 0;
  for (let k = 0; k < 20000; k++) {
    const sN = int(100, 600000), hN = int(500, 10000), fN = int(0, 5000), dN = int(0, 10000);
    const S = sN / 100, h = hN / 10000, f = fN / 10000, d = dN / 10000;
    const X = BigInt(Math.max(hN * dN, fN * 10000));
    const want = (2n * BigInt(sN) * X + 1000000n) / 2000000n;
    const args = { convention: "delta", spot: S, strike: S + 1, delta: d, haircut: h, floor: f };
    const got = PREM.shortCallCollateral(args);
    const w = Number(want);
    if (w === 0) { if (got.ok || got.why !== "no-collateral") bad++; } else if (!got.ok || got.m1C !== w) bad++;
    const c = CHUNK.shortCallCollateral(args);
    if (c.ok !== got.ok || c.m1C !== got.m1C || c.binding !== got.binding || c.why !== got.why) badChunk++;
    const K = S + (rnd() < 0.5 ? 1 : -1) * int(0, 3000) / 100;
    if (K > 0) {
      const a = PREM.shortCallCollateral({ convention: "regt", spot: S, strike: K });
      const b = CHUNK.shortCallCollateral({ convention: "regt", spot: S, strike: K });
      if (a.m1C !== b.m1C || a.binding !== b.binding) badSame++;
    }
  }
  eq(bad, 0, "20,000 random decimal draws equal a BigInt-cents reference with half-up ties");
  eq(badChunk, 0, "and the chunk's copy returns the same on every one");
  eq(badSame, 0, "and the Reg-T style agrees between oracle and chunk");
}

{
  const P = PREM.parseContracts, Q = CHUNK.parseContracts;
  const table = [["100", 100], ["1", 1], ["1,000", 1000], ["1,00", null], ["2k", 2000], ["100000", 100000], ["100001", null], ["0", null], ["", null], ["1e2", null], ["2.5", null], ["-3", null], ["+3", null], [" 12 ", 12], ["1,000,000", null], ["abc", null], [null, null], ["100k", 100000], ["101k", null]];
  for (const [raw, want] of table) { eq(P(raw), want, `contracts ${JSON.stringify(raw)}`); eq(Q(raw), want, `chunk contracts ${JSON.stringify(raw)}`); }
  const pc = [["30", 0.3], ["30%", 0.3], ["12.5 %", 0.125], ["4", null], ["101", null], ["5", 0.05], ["abc", null], ["-5", null], ["1e1", null], ["", null]];
  for (const [raw, want] of pc) { eq(PREM.parsePercent(raw, PREM.SC_LIMITS.haircut), want, `percent ${JSON.stringify(raw)}`); eq(CHUNK.parsePercent(raw, CHUNK.SC_LIMITS.haircut), want, `chunk percent ${JSON.stringify(raw)}`); }
  eq(PREM.parsePercent("0", PREM.SC_LIMITS.floor), 0, "a zero floor is allowed");
  eq(PREM.parsePercent("51", PREM.SC_LIMITS.floor), null, "a floor past 50% is refused");
}

{
  const eng = engineBlock("AAA", "2026-09-29", 100);
  const asOfMs = Date.parse("2026-09-29T20:00:00Z");
  const FAM = Object.freeze({ id: "custom", risk: "undefined", dir: "neutral" });
  let worst = 0, dev = 0;
  for (const [K, bid] of [[104, 1.2], [100, 3.1], [97, 5.4], [110, 0.4]]) {
    const row = { K, type: "C", bid, ask: bid + 0.04, oi: 500, volume: 10, sym: "x", ivSeed: 0.4 };
    const fit = NODE_Q.contractFit({ expiry: "2026-10-16", asOfMs, spot: 100, rate: 0.04, row });
    const setup = NODE_Q.labSetup({ asOfMs, spot: 100, facts: [], state: null, pLaw: eng.pLaw, event: null, stale: false, books: [{ fit, rows: [row] }], lawCache: new Map() });
    const st = NODE_Q.priceStructure(setup, { family: "custom", fam: FAM, expiry: "2026-10-16", legs: [{ type: "C", K, side: -1, qty: 1 }], basis: "natural" });
    ok(st && st.legs[0].delta > 0 && st.legs[0].delta < 1, `the lone short call prices (${K})`);
    const regt = PREM.shortCallCollateral({ convention: "regt", spot: 100, strike: K });
    worst = Math.max(worst, Math.abs(regt.m1C + Math.round(bid * 100) * 100 - Math.round(st.capital.value * 100)));
    const spotDelta = Math.abs(st.greeks["delta$"]) / (100 * 100);
    dev = Math.max(dev, Math.abs(spotDelta - st.legs[0].delta * Math.exp(-st.carry.q * st.T)));
  }
  ok(worst <= 1, `the Reg-T style plus the option's value equals the engine's capital within a cent (${worst})`);
  ok(dev < 1e-3, `the engine's spot delta is the forward delta times exp(-qT) (${dev})`);
  eq([PREM.SC_REG_T.base, PREM.SC_REG_T.floor], [ENGINE.ENGINE_LINES.REG_T_BASE, ENGINE.ENGINE_LINES.REG_T_FLOOR], "the Reg-T constants are the engine's");
}

{
  const D = PREM.dividendsToExpiry;
  eq(D({ spot: 100, r: 0.04, q: 0, years: 0.5 }), 0, "no carry, no dividends");
  eq(D({ spot: 100, r: 0.04, q: null, years: 0.5 }), 0, "no card, no dividends");
  const d = D({ spot: 100, r: 0.04, q: 0.03, years: 0.25 });
  ok(Math.abs(d - 100 * (Math.exp(0.01) - Math.exp(0.0025))) < 1e-12 && d > 0.7 && d < 0.8, "dividends to expiry follow S (e^rT - e^(r-q)T)");
  eq(CHUNK.dividendsToExpiry({ spot: 100, r: 0.04, q: 0.03, years: 0.25 }), d, "the chunk agrees");
  eq(D({ spot: 100, r: 0.04, q: 0.03, years: 0 }), 0, "no time, no dividends");
}

{
  const mk = (timeValueC, deployedC, extra = {}) => ({ ok: true, affordable: true, premiumC: timeValueC, timeValueC, deployedC, ...extra });
  const lines = [mk(100, 10), mk(300, 20), mk(300, 20), mk(300, 15), mk(900, 5, { affordable: false }), { ok: false }, mk(0, 1, { premiumC: 5000 })];
  for (const [who, mod] of [["oracle", PREM], ["chunk", CHUNK]]) {
    const plan = mod.planShortCalls(lines);
    eq([plan.best, plan.affordable], [lines[3], 5], who + ": the best line earns the most time value among those affordable, the smaller deployment winning a tie, and a line with no time value is never best however much cash it brings in");
    eq(mod.planShortCalls([mk(0, 1, { premiumC: 5000 })]).best, null, who + ": a line that earns nothing is no best line");
    eq(mod.planShortCalls([mk(300, 20), mk(300, 20, { tag: "second" })]).best.tag, undefined, who + ": a full tie keeps the first");
    eq(mod.planShortCalls([{ ok: true, affordable: true, premiumC: 900, timeValueC: 100, deployedC: 5 }, { ok: true, affordable: true, premiumC: 500, timeValueC: 400, deployedC: 5 }]).best.timeValueC, 400, who + ": gross cash that is mostly in-the-money value loses to the line with more time value");
  }
  eq(PREM.planShortCalls([]).best, null, "nothing to plan");
  const itm = PREM.shortCallLine({ bid: 8.6, strike: 220 }, { spot: 227.28, delta: 0.66, days: 12 });
  eq([itm.premiumC, itm.timeValueC, itm.premiumC - itm.timeValueC], [100 * 86000, 100 * 13200, 100 * 72800], "an in-the-money line splits its cash into time value and in-the-money value in cents");
  eq(CHUNK.shortCallLine({ bid: 8.6, strike: 220 }, { spot: 227.28, delta: 0.66, days: 12 }).timeValueC, itm.timeValueC, "and the chunk's copy splits it the same way");
  eq(itm.deployedC, itm.collateralC, "the capital a line deploys is its collateral, in cents, so the plan's tie-break reads a number and not a patch");
  eq(PREM.shortCallLine({ bid: null, strike: 220 }, { spot: 227.28, delta: 0.66, days: 12 }).deployedC, null, "and a line that could not be priced deploys nothing");

  let seed = 20261025, bad = 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 2000; i++) {
    const strike = 20 + Math.floor(rnd() * 40000) / 100, spot = Math.max(1, strike + (rnd() - 0.5) * 40);
    const row = { bid: Math.floor(rnd() * 3000) / 100, strike };
    const args = { spot, delta: Math.floor(rnd() * 101) / 100, days: 1 + Math.floor(rnd() * 400), contracts: 1 + Math.floor(rnd() * 20), convention: ["delta", "regt", "shares"][i % 3], buyingPower: rnd() < 0.5 ? null : Math.floor(rnd() * 200000) };
    const a = PREM.shortCallLine(row, args), b = CHUNK.shortCallLine(row, args);
    if (JSON.stringify(a) !== JSON.stringify(b)) bad++;
  }
  eq(bad, 0, "the shared oracle and the page's copy return the same object, field for field, over 2,000 random lines");
}

{
  let prev = 0, nonMono = 0;
  for (let d = 0; d <= 1; d += 0.005) {
    const c = PREM.shortCallCollateral({ spot: 100, strike: 101, delta: d });
    if (c.ok) { if (c.m1C < prev) nonMono++; prev = c.m1C; }
  }
  eq(nonMono, 0, "collateral never falls as delta rises");
  const deep = PREM.shortCallCollateral({ spot: 100, strike: 50, delta: 1 });
  eq(deep.m1C, 300000, "deep in the money the collateral is the haircut on the whole notional");
}

const MUTANTS = [
  ["floor dropped", "m = SHARES_PER_CONTRACT * S * Math.max(hc * d, fl);", "m = SHARES_PER_CONTRACT * S * hc * d;"],
  ["min instead of max", "m = SHARES_PER_CONTRACT * S * Math.max(hc * d, fl);", "m = SHARES_PER_CONTRACT * S * Math.min(hc * d, fl);"],
  ["haircut on one minus delta", "m = SHARES_PER_CONTRACT * S * Math.max(hc * d, fl);", "m = SHARES_PER_CONTRACT * S * Math.max(hc * (1 - d), fl);"],
  ["Reg-T adds the out-of-the-money amount", "SC_REG_T.base * S - Math.max(0, K - S)", "SC_REG_T.base * S + Math.max(0, K - S)"],
  ["Reg-T floor on the strike", "fl = SC_REG_T.floor * S;", "fl = SC_REG_T.floor * K;"],
  ["Reg-T base 15%", "export const SC_REG_T = Object.freeze({ base: 0.2,", "export const SC_REG_T = Object.freeze({ base: 0.15,"],
  ["Reg-T floor 20%", "base: 0.2, floor: 0.1 }", "base: 0.2, floor: 0.2 }"],
  ["ratio on the gross bid", "const ratio = tvC / col.m1C;", "const ratio = bidC / col.m1C;"],
  ["annualised on 360", "ratio * DAYS_PER_YEAR / dayN", "ratio * 360 / dayN"],
  ["annualised on days plus one", "ratio * DAYS_PER_YEAR / dayN", "ratio * DAYS_PER_YEAR / (dayN + 1)"],
  ["premium without n", "premiumC: n * bidC", "premiumC: bidC"],
  ["collateral without n", "collateralC: n * col.m1C", "collateralC: col.m1C"],
  ["multiplier of ten", "m = SHARES_PER_CONTRACT * S * Math.max(hc * d, fl);", "m = 10 * S * Math.max(hc * d, fl);"],
  ["truncated cents", "Math.round(dollars * 100 + 1e-9 + Math.abs(dollars) * 1e-13)", "Math.floor(dollars * 100)"],
  ["ceil on the affordable count", "Math.floor(bpC / col.m1C)", "Math.ceil(bpC / col.m1C)"],
  ["N cap ignored", "Math.min(contracts, Math.floor(bpC / col.m1C))", "Math.floor(bpC / col.m1C)"],
  ["missing delta read as zero", "if (d === null) return fail(\"no-delta\");", "if (d === null) return { ok: true, m1C: roundCents(SHARES_PER_CONTRACT * S * fl), binding: \"floor\", why: null };"],
  ["zero collateral passes", "if (!(m1C > 0)) return fail(\"no-collateral\");", ""],
  ["delta clamped", "if (d < 0 || d > 1) return fail(\"bad-delta\");", "if (d < 0 || d > 1) return shortCallCollateral({ convention, spot, strike, delta: Math.min(1, Math.max(0, d)), haircut, floor });"],
  ["binding tie goes to delta", "binding = hc * d > fl ? \"delta\" : \"floor\";", "binding = hc * d >= fl ? \"delta\" : \"floor\";"],
  ["binding inverted", "binding = hc * d > fl ? \"delta\" : \"floor\";", "binding = hc * d > fl ? \"floor\" : \"delta\";"],
  ["the gross ratio on the time value", "grossRatio: bidC / col.m1C", "grossRatio: tvC / col.m1C"],
  ["the bid rounds without the half-cent epsilon", "const bidC = roundCents(bid * SHARES_PER_CONTRACT);", "const bidC = Math.round(bid * SHARES_PER_CONTRACT * 100);"],
  ["time value ignored for in the money", "const tvC = Math.max(0, bidC - intrC);", "const tvC = bidC;"],
  ["shares convention is the strike", "m = SHARES_PER_CONTRACT * S;\n    binding = \"shares\";", "m = SHARES_PER_CONTRACT * K;\n    binding = \"shares\";"],
  ["dividends flag inverted", "!(qq > 0)", "!(qq < 0)"],
  ["best by gross premium", "if (l.timeValueC > 0 && (best === null || betterDeployment(l, best))) best = l;", "if (best === null || l.premiumC > best.premiumC) best = l;"],
  ["best ties go to the larger deployment", "return a.deployedC < b.deployedC;", "return a.deployedC > b.deployedC;"],
  ["best ignores a zero time value", "if (l.timeValueC > 0 && (best === null || betterDeployment(l, best))) best = l;", "if (best === null || betterDeployment(l, best)) best = l;"],
  ["contracts accept loose commas", "/^(\\d{1,3}(?:,\\d{3})+|\\d+)(k?)$/", "/^([\\d,]+)(k?)$/"],
  ["contracts allow zero", "n >= 1 && n <= SC_LIMITS.contractsMax", "n >= 0 && n <= SC_LIMITS.contractsMax"],
];

{
  let survived = [];
  for (const [title, from, to] of MUTANTS) {
    const mod = await loadMutated("shared/flows-premium.js", [[from, to]]);
    const bad = battery(mod, title);
    let tableBad = 0;
    for (const [raw, want] of [["1,000", 1000], ["2.5", null], ["0", null], ["1,00", null]]) if (mod.parseContracts(raw) !== want) tableBad++;
    const dv = mod.dividendsToExpiry({ spot: 100, r: 0.04, q: 0.03, years: 0.25 }) > 0 ? 0 : 1;
    const dz = mod.dividendsToExpiry({ spot: 100, r: 0.04, q: 0, years: 0.25 }) === 0 ? 0 : 1;
    const mk = (timeValueC, deployedC, extra = {}) => ({ ok: true, affordable: true, premiumC: timeValueC, timeValueC, deployedC, ...extra });
    const planBad = [mod.planShortCalls([mk(5, 1), mk(5, 1, { tag: "second" })]).best.tag === undefined, mod.planShortCalls([mk(300, 20), mk(300, 15)]).best.deployedC === 15,
      mod.planShortCalls([mk(0, 1, { premiumC: 5000 })]).best === null, mod.planShortCalls([mk(100, 5, { premiumC: 900 }), mk(400, 5, { premiumC: 500 })]).best.timeValueC === 400].filter((x) => !x).length;
    if (bad.length + tableBad + dv + dz + planBad === 0) survived.push(title);
  }
  eq(survived, [], `all ${MUTANTS.length} planted wrong builds of the oracle fail the battery`);
}

console.log(`flows-desk-calls: ${checks} checks`);
