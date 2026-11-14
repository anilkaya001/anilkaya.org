import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as LAB from "../shared/flows-flowlab.js";
import * as VD from "../shared/flows-voldesk.js";
import * as REG from "../shared/flows-regime.js";
import * as CROSS from "../shared/flows-cross.js";
import * as MOVES from "../shared/flows-moves0.js";
import * as POS from "../shared/flows-positioning.js";
import * as MKT from "../shared/flows-market.js";
import * as UA from "../shared/flows-unusual.js";
import * as DISP from "../shared/flows-dispersion.js";
import * as SFC from "../shared/flows-sfc.js";
import { loadMutated } from "./truth/mutants.mjs";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-flow.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-flow-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");

function judge() {
  const bad = [];
  const say = (m) => { if (bad.length < 6) bad.push(m); };
  const near = (got, want, what, tol = 1e-12) => {
    if (want === null || want === undefined) { if (got !== null && got !== undefined) say(`${what}: ${got} where there is none`); return; }
    if (got === null || got === undefined || !Number.isFinite(got) || !(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)))) say(`${what}: ${got} against ${want}`);
  };
  const same = (got, want, what) => { if ((got ?? null) !== (want ?? null)) say(`${what}: ${got} against ${want}`); };
  return { bad, near, same, say };
}

function flowlab(M) {
  const j = judge();
  FX.flowlab.screen.forEach((c, i) => {
    const g = M.ratiosOf(c.row), e = c.expect;
    for (const k of ["voi", "nameShare", "sweepShare", "floorShare", "crossShare", "multiShare", "avgFill", "stated", "askLo", "askHi"]) j.near(g[k], e[k], `screen ${i} ${k}`);
    j.same(g.askWhy, e.askWhy, `screen ${i} reason`);
    j.same(g.lean, e.lean, `screen ${i} lean`);
    if (g.askLo !== null && g.askHi !== null && !(g.askLo <= g.askHi)) j.say(`screen ${i}: the low bound is above the high bound`);
  });
  FX.flowlab.profiles.forEach((c, i) => {
    j.same(M.vwapCents(c.levels), c.vwapC, `profile ${i} vwap`);
    const a = M.valueArea(c.levels);
    if (c.area === null) j.same(a, null, `profile ${i} value area`);
    else if (a === null) j.say(`profile ${i}: no value area`);
    else for (const k of ["poc", "lo", "hi", "v", "of"]) j.same(a[k], c.area[k], `profile ${i} area ${k}`);
  });
  FX.flowlab.strikes.forEach((c, i) => j.same(M.medianStrike(c.rows.map((r) => ({ k: r.k, vol: r.callVol + r.putVol }))), c.median, `strikes ${i} median`));
  return j.bad;
}

function voldesk(M) {
  const j = judge();
  FX.voldesk.terms.forEach((c, i) => {
    for (const p of c.probes) j.near(M.interpolateIv(c.points, p.d), p.iv, `term ${i} at ${p.d} days`, 1e-11);
    const t = M.termState(c.points);
    j.near(t.iv30, c.iv30, `term ${i} iv30`, 1e-11);
    j.near(t.iv90, c.iv90, `term ${i} iv90`, 1e-11);
    j.near(t.slope, c.slope, `term ${i} slope`, 1e-8);
    if (c.state !== null) j.same(t.state, c.state, `term ${i} state`);
    if (c.slope === null && t.state !== null) j.say(`term ${i}: a state with no slope`);
  });
  return j.bad;
}

function regime(M) {
  const j = judge();
  FX.regime.zero.forEach((c, i) => j.near(M.zeroDteShare(c.a, c.b), c.share, `zero-day share ${i}`));
  FX.regime.flows.forEach((c, i) => {
    const g = M.fundFlowSummary(c.rows, { sessionDate: c.session });
    j.same(g.cum20Usd, c.cum20, `fund flow ${i} twenty-session sum`);
    j.near(g.z20, c.z20, `fund flow ${i} z`, 1e-9);
  });
  FX.regime.pcs.forEach((c, i) => {
    const g = M.putCallHistory(c.rows, { sessionDate: c.session });
    j.near(g.pcVolume.now, c.pcVol, `put to call ${i} volume`);
    j.near(g.pcPremium.now, c.pcPrem, `put to call ${i} premium`);
    j.near(g.pcVolume.z, c.zVol, `put to call ${i} volume z`, 1e-9);
    j.near(g.pcPremium.z, c.zPrem, `put to call ${i} premium z`, 1e-9);
    j.near(g.volume.pct, c.volPct, `put to call ${i} volume percentile`);
  });
  FX.regime.aligns.forEach((c, i) => {
    const g = M.groupAlignment(c.g, c.members.map((v) => ({ cum_dir_delta: v })));
    j.same(g.members, c.n, `alignment ${i} members`);
    j.same(g.agree, c.agree, `alignment ${i} agree`);
    j.near(g.share, c.share, `alignment ${i} share`);
  });
  return j.bad;
}

function cross(M, mv = MOVES) {
  const j = judge();
  FX.cross.tilts.forEach((c, i) => {
    j.near(M.netTilt(c.row), c.tilt, `tilt ${i}`);
    j.near(M.gexPerAdv(c.gex, c.avgVol, c.close), c.gexAdv, `gamma over volume ${i}`);
    j.near(mv.ivDays(c.chg, c.iv30p), c.ivDays, `IV-days ${i}`);
  });
  return j.bad;
}

function history(M) {
  const j = judge();
  FX.cross.history.forEach((c, i) => {
    const g = M.ownHistory(c.series), e = c.expect;
    j.same(g.n, e.n, `history ${i} n`);
    j.near(g.pct, e.pct, `history ${i} percentile`);
    j.near(g.z, e.z, `history ${i} z`, 1e-9);
    j.same(g.why, e.why, `history ${i} reason`);
  });
  return j.bad;
}

function market(M) {
  const j = judge();
  FX.market.forEach((c, i) => {
    const g = M.marketAggregate(c.rows), e = c.expect;
    j.same(g.premium.net, e.net, `market ${i} net`);
    j.same(g.premium.priced, e.priced, `market ${i} priced`);
    j.same(g.premium.oneLegged, e.oneLegged, `market ${i} one-legged`);
    j.near(g.premium.tilt, e.tilt, `market ${i} tilt`, 6e-5);
    j.near(g.premium.topShare, e.topShare, `market ${i} top share`, 6e-5);
    j.same(g.breadth.bull, e.bull, `market ${i} bull`);
    j.same(g.breadth.bear, e.bear, `market ${i} bear`);
    j.near(g.breadth.tilt, e.breadth, `market ${i} breadth`, 6e-5);
    j.near(g.pcr.volume, e.pcrVolume, `market ${i} put to call volume`, 6e-5);
    j.near(g.pcr.premium, e.pcrPremium, `market ${i} put to call premium`, 6e-5);
    j.near(g.aggressor.callLift, e.callLift, `market ${i} call lift`, 6e-5);
    j.near(g.aggressor.putLift, e.putLift, `market ${i} put lift`, 6e-5);
  });
  return j.bad;
}

function unusual(M) {
  const j = judge();
  const got = M.buildUnusualRows(FX.unusual.rows, { spot: FX.unusual.spot, sessionDate: "2026-11-02" });
  j.same(got.length, FX.unusual.expect.length, "unusual population");
  FX.unusual.expect.forEach((e, i) => {
    const g = got[i];
    if (!g) return;
    j.same(g.k, e.k, `unusual ${i} strike`);
    j.same(g.cp, e.cp, `unusual ${i} right`);
    j.near(g.vor, e.vor, `unusual ${i} volume over open interest`, 6e-4);
    j.same(g.doi, e.doi, `unusual ${i} open-interest change`);
    j.near(g.lift, e.lift, `unusual ${i} lift`, 6e-4);
    j.same(g.aggr, e.aggr, `unusual ${i} ask less bid volume`);
    j.near(g.nlo, e.nlo, `unusual ${i} low notional`, 1e-9);
    j.near(g.nhi, e.nhi, `unusual ${i} high notional`, 1e-9);
    if (g.nlo !== null && e.nlo !== null && Math.abs(g.nlo - e.nlo) > 0.5 + 1e-6) j.say(`unusual ${i}: notional off by more than rounding`);
    j.near(g.m, Number(Math.log(e.k / FX.unusual.spot).toFixed(4)), `unusual ${i} log moneyness`, 1e-9);
  });
  return j.bad;
}

function dispersion(M) {
  const j = judge();
  FX.dispersion.forEach((c, i) => {
    const g = M.impliedCorrelation({ indexIv: c.indexIv, members: c.members }), e = c.expect;
    j.same(g.why, e.why, `dispersion ${i} reason`);
    j.same(g.covered, e.covered, `dispersion ${i} covered`);
    j.near(g.raw, e.raw, `dispersion ${i} raw correlation`, 6e-5);
    j.near(g.rho, e.rho, `dispersion ${i} correlation`, 6e-5);
    if (g.rho !== null && (g.rho > 1 || g.rho < -1)) j.say(`dispersion ${i}: a correlation outside minus one to one`);
  });
  return j.bad;
}

function ledger(M) {
  const j = judge();
  FX.ledger.forEach((c, i) => {
    const cols = new Map(Object.entries(c.columns).map(([k, v]) => [k, { X: BigInt(v.X), Ub: BigInt(v.U) }]));
    const g = M.tiltOf(cols, new Map(Object.entries(c.weights)));
    j.same(g.weighted.join("|"), c.weighted.join("|"), `ledger ${i} weighted sectors`);
    let sum = 0n;
    for (const s of c.weighted) {
      const r = g.rows.get(s), e = c.rows[s];
      j.same(String(r.a), e.a, `ledger ${i} ${s} allocation`);
      j.same(String(r.R), e.R, `ledger ${i} ${s} tilt`);
      j.same(String(r.W), e.W, `ledger ${i} ${s} band`);
      j.same(r.verdict, e.verdict, `ledger ${i} ${s} verdict`);
      if (!(e.off < 1)) j.say(`ledger ${i} ${s}: the allocation is a whole cent or more from the exact share`);
      sum += r.R;
    }
    if (c.weighted.length && sum !== 0n) j.say(`ledger ${i}: the tilts sum to ${sum}`);
    if (c.weighted.length && g.sum !== 0n) j.say(`ledger ${i}: the reported sum is ${g.sum}`);
  });
  return j.bad;
}

const BLOCKS = [
  ["Flow Lab ratios, ask bounds, lean, VWAP, value area and median strike", "shared/flows-flowlab.js", flowlab, LAB],
  ["Vol Desk interpolation in total variance and the term state", "shared/flows-voldesk.js", voldesk, VD],
  ["zero-day share, fund-flow z, put-to-call z and group alignment", "shared/flows-regime.js", regime, REG],
  ["net tilt, gamma over dollar volume and IV-days", "shared/flows-cross.js", cross, CROSS],
  ["own-history percentile and z", "shared/flows-positioning.js", history, POS],
  ["market net premium, tilt, breadth, put to call and lift", "shared/flows-market.js", market, MKT],
  ["the Unusual screen's ratio, lift, notional bracket and open-interest change", "shared/flows-unusual.js", unusual, UA],
  ["implied correlation against a brute-force sum over pairs", "shared/flows-dispersion.js", dispersion, DISP],
  ["the ledger's allocation, tilt, band and verdict in integers", "shared/flows-sfc.js", ledger, SFC],
];

for (const [name, , run, mod] of BLOCKS) eq(run(mod).join("; "), "", `production equals the exact oracle: ${name}`);

ok(FX.flowlab.screen.some((c) => c.expect.askWhy === "lowCoverage") && FX.flowlab.screen.some((c) => c.expect.askWhy === "smallClassified") &&
  FX.flowlab.screen.some((c) => c.expect.askWhy === "noSides") && FX.flowlab.screen.some((c) => c.expect.askWhy === null && c.expect.lean === 0) &&
  FX.flowlab.screen.some((c) => c.expect.lean === -1 && c.row.cp === "p"), "the Flow Lab cases reach every gate, an undecided lean and a put whose bought contracts lean down");
ok(FX.regime.flows.some((c) => c.z20 !== null) && FX.regime.flows.some((c) => c.z20 === null) && FX.regime.pcs.some((c) => c.zVol !== null) &&
  FX.regime.pcs.some((c) => c.pcVol === null), "the regime cases hold a z, a history too short for one and a day with no call volume");
ok(FX.dispersion.some((c) => c.expect.why === "coverage") && FX.dispersion.some((c) => c.expect.rho !== null && c.expect.rho !== c.expect.raw) &&
  FX.dispersion.some((c) => c.expect.rho !== null && c.expect.rho === c.expect.raw), "the dispersion cases hold a refusal, a clamped figure and a plain one");
ok(["at", "above", "below", "undetermined"].every((v) => FX.ledger.some((c) => Object.values(c.rows).some((r) => r.verdict === v))),
  "the ledger cases reach every verdict");
ok(FX.cross.history.some((c) => c.expect.why === "zero-sd") && FX.cross.history.some((c) => c.expect.why === "short-history") &&
  FX.cross.history.some((c) => c.expect.z !== null), "the history cases hold a flat year, a short one and a z");
{
  const text = JSON.stringify(FX);
  const names = new Set(text.match(/"(?:ticker|t)":"[^"]+"/g).map((s) => s.split(":")[1].replace(/"/g, "")));
  ok([...names].every((n) => /^SY[A-Z]\d{3}$/.test(n)), "every ticker in the fixture is an invented one");
}

const PLANTS = [
  ["the value area stops at half the volume", "shared/flows-flowlab.js", flowlab, [["valueAreaNum: 7", "valueAreaNum: 5"]]],
  ["the ask-side high bound forgets the contracts with no stated side", "shared/flows-flowlab.js", flowlab, [["hi: (vol - bid) / vol", "hi: ask / vol"]]],
  ["the stated share counts fills between the quotes as sided", "shared/flows-flowlab.js", flowlab, [["const stated = sided / vol;", "const stated = (sided + (r.mid || 0)) / vol;"]]],
  ["a put's lean is read like a call's", "shared/flows-flowlab.js", flowlab, [["return cp === \"p\" ? -buy : buy;", "return buy;"]]],
  ["the average fill forgets the contract multiplier", "shared/flows-flowlab.js", flowlab, [["r.premC / (r.vol * 100)", "r.premC / r.vol"]]],
  ["the median strike is the middle row", "shared/flows-flowlab.js", flowlab, [["if (2 * acc >= total) return r.k;", "if (2 * acc >= total) return w[Math.floor(w.length / 2)].k;"]]],
  ["implied volatility is interpolated in volatility", "shared/flows-voldesk.js", voldesk, [["return Math.sqrt(w / (d / 365));", "return lo.iv + (hi.iv - lo.iv) * (hi.dte === lo.dte ? 0 : (d - lo.dte) / (hi.dte - lo.dte));"]]],
  ["the term slope is taken front over back", "shared/flows-voldesk.js", voldesk, [["(iv90 - iv30) * 100 * 1e9", "(iv30 - iv90) * 100 * 1e9"]]],
  ["the zero-day share is signed", "shared/flows-regime.js", regime, [["return d > 0 ? Math.abs(a) / d : null;", "return d > 0 ? a / d : null;"]]],
  ["the fund-flow z counts today's sum in its own history", "shared/flows-regime.js", regime, [["ownZ(sums.slice(0, -1), cum, { min })", "ownZ(sums, cum, { min })"]]],
  ["put to call is call over put", "shared/flows-regime.js", regime, [["cv > 0 ? pv / cv : null", "pv > 0 ? cv / pv : null"]]],
  ["the net tilt divides by net premium", "shared/flows-cross.js", cross, [["const gross = Math.abs(cp) + Math.abs(pp);", "const gross = Math.abs(c) + Math.abs(p);"]]],
  ["the own-history percentile leaves today out", "shared/flows-positioning.js", history, [["let atOrBelow = 1;", "let atOrBelow = 0;"]]],
  ["the own-history z uses the population deviation", "shared/flows-positioning.js", history, [["(v - mean) ** 2)) / (n - 1));\n  if (!(sd > 0)) return { z: null, pct, n, why: \"zero-sd\" };", "(v - mean) ** 2)) / n);\n  if (!(sd > 0)) return { z: null, pct, n, why: \"zero-sd\" };"]]],
  ["a one-legged name is netted against zero", "shared/flows-market.js", market, [["if (call === null || put === null) { oneLegged++; continue; }", "if (call === null || put === null) { oneLegged++; }"]]],
  ["breadth is weighted by dollars", "shared/flows-market.js", market, [["round((bull - bear) / (bull + bear), 4)", "round(net / gross, 4)"]]],
  ["the notional bracket forgets the multiplier", "shared/flows-unusual.js", unusual, [["Math.round(vol * bidPx * SHARES_PER_CONTRACT)", "Math.round(vol * bidPx)"]]],
  ["lift is taken over all volume", "shared/flows-unusual.js", unusual, [["legs !== null && legs > 0 ? askVol / legs : null", "legs !== null && vol > 0 ? askVol / vol : null"]]],
  ["implied correlation divides by the squared weighted sum", "shared/flows-dispersion.js", dispersion, [["const raw = (indexIv * indexIv - s2) / den;", "const raw = (indexIv * indexIv - s2) / (s1 * s1);"]]],
  ["the ledger's band ignores the other sectors", "shared/flows-sfc.js", ledger, [["const Q = (Wt - w[i]) * row.U + w[i] * (Ut - row.U);", "const Q = (Wt - w[i]) * row.U;"]]],
  ["the ledger allocates by floor and loses the remainder", "shared/flows-sfc.js", ledger, [["for (let i = 0; left > 0n; i++, left--) floors[order[i]] += 1n;", ""]]],
];

for (const [name, target, run, transforms] of PLANTS) {
  const mod = await loadMutated(target, transforms);
  ok(run(mod).length > 0, `PLANTED WRONG BUILD FAILS: ${name}`);
}

{
  const read = (rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
  const callers = ["scripts/flows-nightly/sections/market.mjs", "scripts/flows-legs/sigma-ledger.mjs"].map(read);
  const calls = callers.flatMap((src) => src.match(/sigmaProfile\([^;]*;/g) || []);
  ok(calls.length === 2, "the typical day is computed at two places in the nightly");
  const excludesReports = calls.every((c) => /\breports\b|\beventSessions\b/.test(c));
  const claims = (page) => /report (?:days|sessions) left out|leaves report days out|with report days[^.]*left out/.test(page);
  const page = read("assets/js/flows-ticker-movelab.js");
  ok(excludesReports || !claims(page), "the Move lab says report days are left out of the nightly count only if the nightly hands the report dates in");
  ok(excludesReports || /nightly count, report days kept in/.test(page), "and while it does not, the count is labelled with report days kept in");
  ok(claims(page.replace("nightly count, report days kept in", "nightly count, report days left out")) && !excludesReports,
    "PLANTED WRONG BUILD FAILS: the label claims an exclusion the nightly does not make");
}

console.log(`math-flow: ${checks} ✓`);
