import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as REAL from "../shared/flows-moves-sig.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "shared/flows-moves-sig.js"), "utf8");
const PAGE = fs.readFileSync(path.join(ROOT, "assets/js/flows-moves.js"), "utf8");
const STATS_URL = pathToFileURL(path.join(ROOT, "shared/flows-stats.js")).href;
const FORBID = /\b(unusual|alert|alerts|screen|rare|sigma|radar)\b/i;
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, m, tol = 1e-12) => { assert.ok(Math.abs(a - b) <= tol, m + ": " + a + " vs " + b); checks++; };
const words = (s) => s.split(/\s+/).filter(Boolean).length;

function bhReference(ps, q) {
  const live = ps.map((p, i) => [p, i]).filter(([p]) => p !== null);
  live.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const m = live.length;
  let cut = -1;
  for (let k = 1; k <= m; k++) if (live[k - 1][0] <= (k * q) / m) cut = k;
  const reject = ps.map(() => false);
  for (let k = 0; k < cut; k++) reject[live[k][1]] = true;
  return { reject, m };
}

const row = (t, z, f2, f3, o = {}) => ({ t, chg: Math.expm1(z * 0.01), sig: 0.01, f2, f3, ed: null, ...o });

function battery(mod) {
  const bad = [];
  const chk = (c, m) => { if (!c) bad.push(m); };
  const a = mod.sigOf(row("A", 2.5, 3, 1));
  chk(a.state === "tested" && a.level === 2 && a.hits === 3 && Math.abs(a.p - 4 / 253) < 1e-12, "add-one rate at level 2");
  const b = mod.sigOf(row("B", -3.2, 9, 0));
  chk(b.level === 3 && b.hits === 0 && Math.abs(b.p - 1 / 253) < 1e-12 && b.z < 0, "level 3 reads f3 and keeps the sign");
  chk(mod.sigOf(row("C", 1.99, 0, 0)).state === "below" && mod.sigOf(row("C", 1.99, 0, 0)).p === 1, "below 2 typical days is not tested");
  chk(mod.sigOf(row("D", 2, 0, 0)).state === "tested", "exactly 2 typical days is tested");
  chk(mod.sigOf(row("E", 5, 0, 0, { ed: 21 })).state === "event", "earnings at 21 sessions is refused");
  chk(mod.sigOf(row("E", 5, 0, 0, { ed: 22 })).state === "tested", "earnings at 22 sessions is tested");
  chk(mod.sigOf(row("F", 5, 0, 0, { sig: null })).state === "noscale", "no scale is refused");
  chk(mod.sigOf(row("G", 5, null, null)).state === "nocount", "no count is refused");
  chk(mod.sigOf(row("G", 5, 253, 253)).state === "nocount", "an impossible count is refused");
  const small = [];
  for (let i = 0; i < 4; i++) small.push(row("H" + i, 2.5, 0, 0));
  for (let i = 0; i < 6; i++) small.push(row("I" + i, 0.5, 0, 0));
  const r = mod.sigRun(small);
  chk(r.m === 10 && r.tested === 4, "below-2 names are counted in the correction");
  chk(r.flagged === 4 && r.items.slice(0, 4).every((i) => i.flag), "four p of 1/253 in ten pass at 10%");
  near0(r.items[0].adj, (1 / 253) * 10 / 4, chk, "adjusted p is p m over rank");
  const noisy = [];
  for (let i = 0; i < 4; i++) noisy.push(row("J" + i, 2.5, 0, 0));
  for (let i = 0; i < 200; i++) noisy.push(row("K" + i, 0.5, 0, 0));
  chk(mod.sigRun(noisy).flagged === 0, "the same four among 204 names do not pass");
  chk(mod.sigRun(small, 0.005).flagged === 0, "a tighter q passes none of them");
  const mono = mod.sigRun([row("L1", 2.5, 0, 0), row("L2", 2.5, 40, 0), ...Array.from({ length: 30 }, (_, i) => row("M" + i, 3.1, 20 + i, 10))]);
  const adj = mono.items.filter((i) => i.state === "tested").sort((x, y) => x.p - y.p).map((i) => i.adj);
  chk(adj.every((v, i) => i === 0 || v >= adj[i - 1] - 1e-15), "adjusted p never falls with p");
  return bad;
}
function near0(v, w, chk, m) { chk(Math.abs(v - w) < 1e-12, m); }

{
  eq(battery(REAL), [], "the real leaf passes the battery");
  eq(REAL.SIG_Q, 0.1, "q is ten per cent");
  for (const s of [REAL.SIG_FLAGGED_LINE, REAL.SIG_PLAIN_LINE, ...Object.values(REAL.SIG_REASONS), ...REAL.SIG_INFO_SENTENCES, REAL.SIG_FOOT_NONE]) {
    ok(words(s) <= 14, "a sentence stays inside fourteen words: " + s);
    ok(!FORBID.test(s), "and uses none of the forbidden words: " + s);
  }
  ok(/after correcting for how many names were tested/.test(REAL.SIG_FLAGGED_LINE) && /^Beyond the usual for this name/.test(REAL.SIG_FLAGGED_LINE), "the flagged line is the one the owner asked for");
}

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

{
  const rnd = mulberry32(11);
  for (let trial = 0; trial < 300; trial++) {
    const n = 1 + Math.floor(rnd() * 120);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const u = rnd();
      rows.push(row("T" + i, u < 0.3 ? 0.2 + rnd() * 1.7 : (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 3), Math.floor(rnd() * rnd() * 30), Math.floor(rnd() * rnd() * 8), { ed: rnd() < 0.1 ? 3 : null, sig: rnd() < 0.05 ? null : 0.01 }));
    }
    const run = REAL.sigRun(rows, 0.1);
    const ps = run.items.map((i) => i.p);
    const ref = bhReference(ps, 0.1);
    eq(run.m, ref.m, "m is the count of counted names");
    eq(run.items.map((i) => i.state === "tested" && ref.reject[run.items.indexOf(i)]), run.items.map((i) => i.flag), "the flags equal an independent step-up BH on " + n + " names");
  }
}

{
  const T = {};
  const ctx = { globalThis: null, Math, Number, Object, Array, String, JSON, Map, Set, Date, isFinite, parseFloat, parseInt, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(PAGE, ctx);
  const hook = ctx.__MovesTest;
  ok(hook && typeof hook.sigRun === "function", "the page exposes its copy to the test");
  const rnd = mulberry32(5);
  const jj = (v) => JSON.parse(JSON.stringify(v));
  for (let trial = 0; trial < 200; trial++) {
    const n = Math.floor(rnd() * 150);
    const rows = Array.from({ length: n }, (_, i) => row("P" + i, (rnd() - 0.5) * 8, rnd() < 0.1 ? null : Math.floor(rnd() * rnd() * 25), rnd() < 0.1 ? null : Math.floor(rnd() * rnd() * 6), { ed: rnd() < 0.1 ? Math.floor(rnd() * 40) : null, sig: rnd() < 0.05 ? null : 0.005 + rnd() * 0.03, chg: rnd() < 0.03 ? null : undefined }));
    for (const r of rows) if (r.chg === undefined || r.chg === null) r.chg = r.chg === null ? null : (rnd() - 0.5) * 0.2;
    eq(jj(hook.sigRun(rows, hook.SIG_Q)), jj(REAL.sigRun(rows, REAL.SIG_Q)), "the page's copy equals the leaf on " + n + " rows");
  }
  eq(hook.SIG_Q, REAL.SIG_Q, "and q agrees");
  for (const s of [REAL.SIG_FLAGGED_LINE, REAL.SIG_PLAIN_LINE, ...Object.values(REAL.SIG_REASONS), ...REAL.SIG_INFO_SENTENCES, REAL.SIG_FOOT_NONE]) ok(PAGE.includes(JSON.stringify(s).slice(1, -1)), "the page carries the leaf's sentence: " + s);
}

function binom(rnd, n, p) { let k = 0; for (let i = 0; i < n; i++) if (rnd() < p) k++; return k; }

const sim = (seed, sims, names, factor) => {
  const rnd = mulberry32(seed);
  let fdp = 0, any = 0, flaggedTotal = 0;
  for (let s = 0; s < sims; s++) {
    const shock = factor && rnd() < factor ? 0.5 : 0;
    const rows = [];
    for (let i = 0; i < names; i++) {
      const r2 = 0.01 + rnd() * 0.07, r3 = r2 * (0.1 + rnd() * 0.3);
      const f2 = binom(rnd, 252, r2), f3 = binom(rnd, 252, r3);
      const u = rnd();
      const hit = shock && rnd() < shock ? 3.5 : null;
      const z = hit !== null ? hit : u < r3 ? 3.5 : u < r2 ? 2.5 : 0.5;
      rows.push(row("S" + i, z, f2, f3));
    }
    const run = REAL.sigRun(rows, 0.1);
    flaggedTotal += run.flagged;
    fdp += run.flagged / Math.max(1, run.flagged);
    any += run.flagged > 0 ? 1 : 0;
  }
  return { fdr: fdp / sims, any: any / sims, flagged: flaggedTotal / sims };
};

{
  const r = sim(2026, 1500, 120, 0);
  ok(r.fdr <= 0.1, "under a null universe every flag is false, and P(any flag) = FDR stays at or under 0.10: " + r.fdr.toFixed(4));
  console.log("null calibration (1500 universes of 120 names): P(any flag) = " + r.fdr.toFixed(4) + ", mean flagged " + r.flagged.toFixed(3));
  const c = sim(77, 600, 120, 0.1);
  console.log("clustered market days (10% of universes with a common shock, report only): P(any flag) = " + c.fdr.toFixed(4));
  ok(c.fdr > r.fdr, "a common shock raises the false-flag rate, which is why the limits say so");
}

{
  const rnd = mulberry32(99);
  let flagged = 0, real = 0;
  for (let s = 0; s < 200; s++) {
    const rows = [];
    for (let i = 0; i < 80; i++) rows.push(row("N" + i, 0.3, 5, 1));
    for (let i = 0; i < 12; i++) rows.push(row("R" + i, 3.4, Math.floor(rnd() * 2), 0));
    const run = REAL.sigRun(rows);
    flagged += run.items.slice(80).filter((i) => i.flag).length;
    real += 12;
  }
  ok(flagged / real > 0.9, "twelve names far past a quiet rate among 92 are found: " + (flagged / real).toFixed(3));
}

const MUTANTS = [
  ["no add-one: the raw rate", "p: (hits + 1) / (SIG_SESSIONS + 1)", "p: hits / SIG_SESSIONS"],
  ["no correction: the raw p against q", "const flag = it.state === \"tested\" && bh.reject[i] === true;", "const flag = it.state === \"tested\" && it.p <= q;"],
  ["names below 2 left out of the correction", "return { t: x.t, state: \"below\", z, level: null, hits: null, p: 1 }", "return { t: x.t, state: \"below\", z, level: null, hits: null, p: null }"],
  ["earnings names tested", "if (ed !== null && ed <= SIG_EVENT_SESSIONS)", "if (false)"],
  ["the earnings window one session short", "ed <= SIG_EVENT_SESSIONS", "ed < SIG_EVENT_SESSIONS"],
  ["the two and three typical day counts swapped", "const hits = level === 3 ? x.f3 : x.f2;", "const hits = level === 3 ? x.f2 : x.f3;"],
  ["the level always 2", "const level = Math.abs(lm) >= 3 * sig ? 3 : 2;", "const level = 2;"],
  ["the simple change read as the log return", "const lm = chg > -1 ? Math.log1p(chg) : null;", "const lm = chg;"],
  ["the test starts at 1 typical day", "export const SIG_MIN_Z = 2;", "export const SIG_MIN_Z = 1;"],
  ["a missing count read as zero", "if (!Number.isInteger(hits) || hits < 0 || hits > SIG_SESSIONS) return", "if (false) return"],
  ["the sign dropped", "const z = lm / sig;", "const z = Math.abs(lm) / sig;"],
  ["q at 0.5", "export const SIG_Q = 0.1;", "export const SIG_Q = 0.5;"],
];

for (const [name, from, to] of MUTANTS) {
  ok(SRC.split(from).length === 2, "the planted build changes the leaf exactly once: " + name);
  const text = SRC.replace(from, to).replace("./flows-stats.js", STATS_URL);
  const mod = await import("data:text/javascript;base64," + Buffer.from(text).toString("base64"));
  let bad;
  try { bad = battery(mod); } catch (e) { bad = ["threw " + e.message]; }
  ok(bad.length > 0, "PLANTED WRONG BUILD CAUGHT: " + name + " (first: " + bad[0] + ")");
}

console.log(`✓ flows-moves-sig: ${checks} assertions, no server, no vendor data: the add-one exceedance p at the name's own 2x or 3x rate by worked cases, the refusals (below 2 typical days, earnings within 21 sessions, no scale, no count), Benjamini-Hochberg equal to an independent step-up reference on 300 random universes, the page's copy equal to the leaf on 200, the null universe's false-flag rate at or under 10% over 1,500 seeded universes, power on twelve real movers, the sentences inside fourteen words, and ${MUTANTS.length} planted wrong builds that each fail`);
