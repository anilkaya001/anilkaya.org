import assert from "node:assert/strict";
import * as REAL from "../shared/flows-cap-tide.js";
import { marketAggregate, MARKET_NOTES } from "../shared/flows-market.js";
import { FORECAST_ALT, MODAL_ALT } from "../shared/flows-ask.js";
import { loadMutated } from "./truth/mutants.mjs";
import { moduleSource, nightlySource, importsOf } from "./lib/source-scan.mjs";
import { mulberry32, pick, between, chance } from "./lib/sfc-rng.mjs";
import { tooLong, tape, modal } from "./lib/copy-lint.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const row = (ticker, marketcap, ncp, npp, cp, pp) => ({
  ticker, marketcap, net_call_premium: ncp, net_put_premium: npp, call_premium: cp, put_premium: pp,
});
const name = (i) => "SYC" + String(i).padStart(3, "0");
const flat = (i, cap = 100) => row(name(i), cap, 0, 0, 50, 50);
const pads = (from, count, cap = 100) => Array.from({ length: count }, (_, i) => flat(from + i, cap));

const gcd = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a; };
const Q = (n, d = 1n) => {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n < 0n ? -n : n, d);
  return g > 1n ? [n / g, d / g] : [n, d];
};
const add = (a, b) => Q(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a, b) => Q(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a, b) => Q(a[0] * b[0], a[1] * b[1]);
const div = (a, b) => Q(a[0] * b[1], a[1] * b[0]);
const cmp = (a, b) => { const x = a[0] * b[1] - b[0] * a[1]; return x < 0n ? -1 : x > 0n ? 1 : 0; };
const mag = (a) => (a[0] < 0n ? [-a[0], a[1]] : a);
const ZERO = [0n, 1n];
const sum = (list) => list.reduce(add, ZERO);
const quarter = (n4) => Q(BigInt(n4), 4n);
const halfUp = (a) => { const t = a[0] * 2n + a[1]; const d = a[1] * 2n; return t >= 0n ? t / d : -((-t + d - 1n) / d); };
const SLACK = Q(1n, 1000000000n);

function nearly(value, exact, places) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const scale = 10 ** places;
  const k = Math.round(value * scale);
  if (Math.abs(value * scale - k) > 1e-6) return false;
  if (Object.is(value, -0)) return false;
  const off = mag(sub(Q(BigInt(k), BigInt(scale)), exact));
  return cmp(off, add(Q(1n, 2n * BigInt(scale)), SLACK)) <= 0;
}

const orderQ = (a, b) => (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : cmp(a, b));

function oracle(specs, { minNames = 30, minCoverage = Q(1n, 2n), top = 5 } = {}) {
  const byTicker = new Map();
  for (const s of specs) {
    const held = byTicker.get(s.t);
    if (!held) { byTicker.set(s.t, s); continue; }
    const first = orderQ(s.m, held.m) || orderQ(s.ncp, held.ncp) || orderQ(s.npp, held.npp) || orderQ(s.cp, held.cp) || orderQ(s.pp, held.pp);
    if (first < 0) byTicker.set(s.t, s);
  }
  const excluded = { noCap: 0, missing: 0, inconsistent: 0, quiet: 0 };
  const used = [];
  let capAll = ZERO;
  for (const s of byTicker.values()) {
    if (s.m === null || cmp(s.m, ZERO) <= 0) { excluded.noCap++; continue; }
    capAll = add(capAll, s.m);
    if (s.ncp === null || s.npp === null || s.cp === null || s.pp === null) { excluded.missing++; continue; }
    const net = sub(s.ncp, s.npp);
    const gross = add(s.cp, s.pp);
    if (cmp(s.cp, ZERO) < 0 || cmp(s.pp, ZERO) < 0 || cmp(mag(net), gross) > 0) { excluded.inconsistent++; continue; }
    if (cmp(gross, ZERO) === 0) { excluded.quiet++; continue; }
    used.push({ t: s.t, m: s.m, net, tau: div(net, gross) });
  }
  const of = byTicker.size;
  const n = used.length;
  const out = { n, of, excluded, reason: null, value: null, coverage: null, effN: null, dollarNet: null, equal: null, top: [] };
  if (!of) return { ...out, reason: "unavailable" };
  const capUsed = sum(used.map((u) => u.m));
  out.coverage = cmp(capAll, ZERO) > 0 ? div(capUsed, capAll) : null;
  if (n) {
    out.effN = div(mul(capUsed, capUsed), sum(used.map((u) => mul(u.m, u.m))));
    out.dollarNet = halfUp(sum(used.map((u) => u.net)));
  }
  if (n < minNames || !n) return { ...out, reason: "thin" };
  if (out.coverage === null || cmp(out.coverage, minCoverage) < 0) return { ...out, reason: "coverage" };
  out.value = div(sum(used.map((u) => mul(u.m, u.tau))), capUsed);
  out.equal = div(sum(used.map((u) => u.tau)), Q(BigInt(n)));
  out.top = used.map((u) => ({ t: u.t, w: div(u.m, capUsed), tau: u.tau, part: div(mul(u.m, u.tau), capUsed) }))
    .sort((a, b) => cmp(mag(b.part), mag(a.part)) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
    .slice(0, top);
  return out;
}

function disagreements(got, want) {
  const bad = [];
  const say = (cond, msg) => { if (!cond) bad.push(msg); };
  say(got && typeof got === "object", "no result");
  if (!got || typeof got !== "object") return bad;
  say(got.n === want.n, `n ${got.n} against ${want.n}`);
  say(got.of === want.of, `of ${got.of} against ${want.of}`);
  say(JSON.stringify(got.excluded) === JSON.stringify(want.excluded), `excluded ${JSON.stringify(got.excluded)} against ${JSON.stringify(want.excluded)}`);
  say(got.reason === want.reason, `reason ${got.reason} against ${want.reason}`);
  say(got.n + got.excluded.noCap + got.excluded.missing + got.excluded.inconsistent + got.excluded.quiet === got.of, "the classes do not add to the universe");
  for (const [key, places] of [["value", 6], ["coverage", 6], ["equal", 6], ["effN", 2]]) {
    if (want[key] === null) say(got[key] === null, `${key} is ${got[key]} where it cannot be computed`);
    else say(nearly(got[key], want[key], places), `${key} ${got[key]} is not ${Number(want[key][0]) / Number(want[key][1])} to ${places} places`);
  }
  if (want.dollarNet === null) say(got.dollarNet === null, `dollarNet is ${got.dollarNet} where there is no name`);
  else say(Number.isInteger(got.dollarNet) && BigInt(got.dollarNet) === want.dollarNet, `dollarNet ${got.dollarNet} against ${want.dollarNet}`);
  say(Array.isArray(got.top) && got.top.length === want.top.length, `top holds ${got.top && got.top.length} against ${want.top.length}`);
  if (Array.isArray(got.top) && got.top.length === want.top.length) {
    got.top.forEach((entry, i) => {
      const w = want.top[i];
      say(Array.isArray(entry) && entry.length === 4 && entry[0] === w.t, `top ${i} is ${entry && entry[0]} against ${w.t}`);
      say(nearly(entry[1], w.w, 6) && nearly(entry[2], w.tau, 6) && nearly(entry[3], w.part, 6), `top ${i} figures ${JSON.stringify(entry)}`);
    });
  }
  if (got.value !== null) say(got.value >= -1 && got.value <= 1, "the tide left [-1, 1]");
  return bad;
}

const ABSENT = [undefined, null, "", "  ", "abc", NaN, Infinity, -Infinity, true, false, {}, [], "1,000", "0x10", "12abc"];

function render(rnd, q) {
  const n4 = Number(q[0] * (4n / q[1]));
  const v = n4 / 4;
  const form = between(rnd, 0, 6);
  if (form <= 1) return v;
  const text = Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (form === 2) return text;
  if (form === 3) return Number.isInteger(v) ? text + ".0" : text + "0";
  if (form === 4) return "  " + text + " ";
  if (form === 5) return v >= 0 ? "+" + text : text;
  return v.toExponential();
}

function universe(seed) {
  const rnd = mulberry32(seed);
  const size = pick(rnd, [0, 1, 5, 29, 30, 31, 32, 40, 45, 60, 75, 90, 120, 150, between(rnd, 0, 150), between(rnd, 25, 40)]);
  const heavy = chance(rnd, 0.2);
  const dupes = chance(rnd, 0.15);
  const clean = chance(rnd, 0.25);
  const specs = [];
  const rows = [];
  const emit = (t, f, absentKeys) => {
    const spec = { t, m: f.m, ncp: f.ncp, npp: f.npp, cp: f.cp, pp: f.pp };
    const out = { ticker: chance(rnd, 0.1) ? " " + t + " " : t };
    for (const [key, field] of [["m", "marketcap"], ["ncp", "net_call_premium"], ["npp", "net_put_premium"], ["cp", "call_premium"], ["pp", "put_premium"]]) {
      if (spec[key] === null) {
        const junk = pick(rnd, ABSENT);
        if (junk !== undefined || !absentKeys) out[field] = junk;
      } else out[field] = render(rnd, spec[key]);
    }
    specs.push(spec);
    rows.push(out);
  };
  const money = (hi) => quarter(between(rnd, 0, hi) * (chance(rnd, 0.3) ? 1 : 4) + (chance(rnd, 0.2) ? between(rnd, 0, 3) : 0));
  const fields = () => {
    const kind = clean ? (chance(rnd, 0.97) ? "good" : "edge") : pick(rnd, ["good", "good", "good", "good", "good", "good", "good", "good", "good", "good", "good",
      "good", "noCap", "missing", "inconsistent", "quiet", "edge", "tiny"]);
    const cap = quarter(between(rnd, 4, 4000000) * 1000 * (chance(rnd, 0.1) ? 250 : 1));
    const cp = money(40000000), pp = money(40000000);
    const gross = add(cp, pp);
    const share = quarter(between(rnd, -4, 4));
    const scaled = mul(gross, share);
    const net = Q(scaled[0] * 4n / scaled[1], 4n);
    const npp = quarter(between(rnd, -20000000, 20000000));
    const base = { m: cap, ncp: add(net, npp), npp, cp, pp };
    if (kind === "good") return cmp(gross, ZERO) > 0 ? base : { ...base, cp: quarter(4), ncp: npp };
    if (kind === "noCap") return { ...base, m: pick(rnd, [null, ZERO, quarter(-4), quarter(-4000000)]) };
    if (kind === "missing") {
      const drop = pick(rnd, [["ncp"], ["npp"], ["cp"], ["pp"], ["ncp", "npp"], ["cp", "pp"], ["ncp", "npp", "cp", "pp"]]);
      const out = { ...base, m: heavy ? mul(cap, quarter(4000)) : cap };
      for (const k of drop) out[k] = null;
      return out;
    }
    if (kind === "inconsistent") {
      const m = heavy ? mul(cap, quarter(4000)) : cap;
      const how = between(rnd, 0, 3);
      if (how === 0) return { ...base, m, ncp: add(add(gross, npp), quarter(between(rnd, 1, 400))) };
      if (how === 1) return { ...base, m, ncp: sub(sub(npp, gross), quarter(between(rnd, 1, 400))) };
      if (how === 2) return { ...base, m, cp: quarter(-between(rnd, 1, 4000)), pp: quarter(8000), ncp: npp };
      return { ...base, m, cp: ZERO, pp: ZERO, ncp: add(npp, quarter(between(rnd, 1, 40))) };
    }
    if (kind === "quiet") return { ...base, m: heavy ? mul(cap, quarter(4000)) : cap, cp: ZERO, pp: ZERO, ncp: npp };
    if (kind === "tiny") return { ...base, m: quarter(1), cp: quarter(1), pp: ZERO, ncp: npp };
    return { ...base, ncp: chance(rnd, 0.5) ? add(gross, npp) : sub(npp, gross), cp: cmp(gross, ZERO) > 0 ? cp : quarter(8), pp: cmp(gross, ZERO) > 0 ? pp : ZERO,
      ...(cmp(gross, ZERO) > 0 ? {} : { ncp: add(quarter(8), npp) }) };
  };
  for (let i = 0; i < size; i++) {
    emit(name(i), fields(), chance(rnd, 0.5));
    if (dupes && chance(rnd, 0.2)) emit(name(i), fields(), false);
  }
  for (let i = rows.length - 1; i > 0; i--) {
    const j = between(rnd, 0, i);
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  if (chance(rnd, 0.3)) rows.splice(between(rnd, 0, rows.length), 0, null, 7, "x", {}, { ticker: "" }, { ticker: 5, marketcap: 9 }, [1, 2]);
  return { specs, rows };
}

const shuffled = (list, rnd) => {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = between(rnd, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

function knownAnswers(capTide, need) {
  const two = capTide([row("SYC001", 300, 30, -10, 100, 100), row("SYC002", 100, -50, 0, 50, 50)], { minNames: 1 });
  need(two.value === 0.025 && two.equal === -0.15 && two.effN === 1.6 && two.dollarNet === -10 && two.coverage === 1 && two.n === 2 && two.of === 2 && two.reason === null,
    "two names by hand: 0.75 x 0.2 + 0.25 x -0.5 = 0.025");
  need(JSON.stringify(two.top) === JSON.stringify([["SYC001", 0.75, 0.2, 0.15], ["SYC002", 0.25, -0.5, -0.125]]), "and their two contributions, the larger first");
  const thirty = capTide([row(name(0), 1100, 150, -100, 250, 250), row(name(1), 100, -40, 60, 70, 30), ...pads(2, 28)]);
  need(thirty.value === 0.1125 && thirty.equal === -0.016667 && thirty.effN === 10.67 && thirty.dollarNet === 150 && thirty.n === 30 && thirty.coverage === 1,
    "thirty names by hand: (1100 x 0.5 - 100 x 1) / 4000 = 0.1125, the plain mean -0.5 / 30, effective names 4000^2 / 1,500,000");
  need(JSON.stringify(thirty.top.slice(0, 2)) === JSON.stringify([[name(0), 0.275, 0.5, 0.1375], [name(1), 0.025, -1, -0.025]]) && thirty.top.length === 5 &&
    JSON.stringify(thirty.top.slice(2).map((e) => e[0])) === JSON.stringify([name(2), name(3), name(4)]), "its top five by size of contribution, ties in ticker order");
  const same = capTide(Array.from({ length: 40 }, (_, i) => row(name(i), 1000 + 977 * i, 30 + i, 5 + i, 60, 40)));
  need(same.value === 0.25 && same.equal === 0.25, "forty names with one tide of 0.25 give 0.25 whatever their weights");
  const strings = capTide([row("SYC001", "300", "30.00", " -10 ", "+100", "1e2"), row("SYC002", "100.0", "-50", "0", "50", "5.0e1")], { minNames: 1 });
  need(JSON.stringify(strings) === JSON.stringify(two), "the wire's decimal strings read as their numbers");
  const signs = capTide([row(name(0), 500, -90, 10, 100, 100), ...pads(1, 29)]);
  need(signs.value === -0.073529, "a name selling calls and buying puts pulls the tide down: 500 x -0.5 / 3400");
  const cancel = capTide([row("SYC001", 100, 9007199254740992, 0, 9007199254740992, 0), row("SYC002", 100, 1, 0, 1, 0),
    row("SYC003", 100, -9007199254740992, 0, 9007199254740992, 0)], { minNames: 1 });
  need(cancel.dollarNet === 1, "sums are exact: 2^53 + 1 - 2^53 is 1 dollar, not 0");
}

function boundaries(capTide, need) {
  const base = pads(0, 30);
  const withOne = (r) => capTide([...base, r]);
  const counts = (out) => [out.n, out.of, out.excluded.noCap, out.excluded.missing, out.excluded.inconsistent, out.excluded.quiet];
  const same = (out, want, msg) => need(JSON.stringify(counts(out)) === JSON.stringify(want), msg + ": " + JSON.stringify(counts(out)));
  same(withOne(row("SYX900", 100, 10, 0, 50, 50)), [31, 31, 0, 0, 0, 0], "a whole name is in");
  for (const cap of [0, -1, -1e9, null, undefined, "", "abc", NaN, Infinity, true, "0", "0x64"]) {
    same(withOne(row("SYX900", cap, 10, 0, 50, 50)), [30, 31, 1, 0, 0, 0], `a market value of ${String(cap)} is no market value`);
  }
  same(withOne(row("SYX900", 1e-9, 10, 0, 50, 50)), [31, 31, 0, 0, 0, 0], "the smallest positive market value is one");
  for (const i of [2, 3, 4, 5]) {
    for (const junk of [null, undefined, "", "abc", NaN, Infinity, true, "1,000", "0x10"]) {
      const args = ["SYX900", 100, 10, 0, 50, 50];
      args[i] = junk;
      same(withOne(row(...args)), [30, 31, 0, 1, 0, 0], `input ${i} absent as ${String(junk)} is a missing name`);
    }
    const zero = ["SYX900", 100, 10, 10, 50, 50];
    zero[i] = 0;
    need(withOne(row(...zero)).excluded.missing === 0, `input ${i} of zero is a number, not a missing input`);
  }
  const noKeys = withOne({ ticker: "SYX900", marketcap: 100 });
  same(noKeys, [30, 31, 0, 1, 0, 0], "a row with a market value and no premium fields is missing");
  same(withOne(row("SYX900", 100, 100, 0, 60, 40)), [31, 31, 0, 0, 0, 0], "net premium equal to total premium is a tide of exactly 1");
  need(withOne(row("SYX900", 3000, 100, 0, 60, 40)).value === 0.5, "and it is counted at 1: 3000 x 1 / 6000");
  need(withOne(row("SYX900", 3000, 0, 100, 60, 40)).value === -0.5, "and at -1 on the other side");
  same(withOne(row("SYX900", 100, 101, 0, 60, 40)), [30, 31, 0, 0, 1, 0], "one dollar more is inconsistent");
  same(withOne(row("SYX900", 100, 0, 101, 60, 40)), [30, 31, 0, 0, 1, 0], "on either side");
  need(withOne(row("SYX900", 100, 500, 0, 60, 40)).value === 0, "and an inconsistent name is left out, never clamped to 1");
  same(withOne(row("SYX900", 100, 0, 0, -1, 200)), [30, 31, 0, 0, 1, 0], "a negative call premium is inconsistent");
  same(withOne(row("SYX900", 100, 0, 0, 200, -1)), [30, 31, 0, 0, 1, 0], "a negative put premium is inconsistent");
  same(withOne(row("SYX900", 100, 5, 0, 0, 0)), [30, 31, 0, 0, 1, 0], "net premium with no premium at all is inconsistent");
  same(withOne(row("SYX900", 100, 0, 0, 0, 0)), [30, 31, 0, 0, 0, 1], "no premium is quiet");
  same(withOne(row("SYX900", 100, 7, 7, 0, 0)), [30, 31, 0, 0, 0, 1], "no premium with equal net legs is quiet");
  same(withOne(row("SYX900", 100, 0, 0, 1, 0)), [31, 31, 0, 0, 0, 0], "one dollar of premium is not quiet");
  need(withOne(row("SYX900", 9e9, 0, 0, 0, 0)).coverage < 0.5, "a quiet name stays in the market value the coverage is measured against");
  same(withOne(row("SYX900", null, null, 0, 0, 0)), [30, 31, 1, 0, 0, 0], "no market value outranks a missing input");
  same(withOne(row("SYX900", 100, null, 0, 0, 0)), [30, 31, 0, 1, 0, 0], "a missing input outranks no premium");
  same(withOne(row("SYX900", 100, 500, null, 0, 0)), [30, 31, 0, 1, 0, 0], "and outranks an inconsistent one");
  const all = capTide([...base, row("SYX901", 0, 1, 0, 5, 5), row("SYX902", 100, null, 0, 5, 5), row("SYX903", 100, 50, 0, 5, 5), row("SYX904", 100, 0, 0, 0, 0)]);
  same(all, [30, 34, 1, 1, 1, 1], "one name of each class");
  need(all.coverage === 0.909091, "coverage is market value: 3000 of the 3300 that carry one");
  for (const junk of [null, undefined, 7, "x", [], {}, { ticker: "" }, { ticker: "   " }, { ticker: 9 }]) {
    same(capTide([...base, junk]), [30, 30, 0, 0, 0, 0], `${JSON.stringify(junk)} is not a name`);
  }
  const twice = capTide([...base, row("SYX900", 200, 10, 0, 50, 50), row(" SYX900 ", 100, 10, 0, 50, 50)]);
  same(twice, [31, 31, 0, 0, 0, 0], "a ticker listed twice is one name");
  need(twice.top[0][0] === "SYX900" && twice.top[0][1] === Number((100 / 3100).toFixed(6)), "the copy that sorts first, the smaller market value");
}

function thresholds(capTide, need, mod) {
  need(mod.CAP_TIDE_MIN_NAMES === 30 && mod.CAP_TIDE_MIN_COVERAGE === 0.5, "the thresholds are thirty names and half the market value");
  need(JSON.stringify(mod.CAP_TIDE_REASONS) === JSON.stringify({ thin: "thin", coverage: "coverage", unavailable: "unavailable" }), "three reason codes");
  const lead = row(name(0), 100, 30, 0, 50, 50);
  const at29 = capTide([lead, ...pads(1, 28)]);
  need(at29.value === null && at29.reason === "thin" && at29.equal === null && at29.top.length === 0 && at29.n === 29 && at29.coverage === 1 && at29.effN === 29,
    "twenty-nine names are too few: withheld as thin with its counts kept");
  const at30 = capTide([lead, ...pads(1, 29)]);
  need(at30.value === 0.01 && at30.reason === null && at30.n === 30, "thirty names are enough");
  const half = capTide([lead, ...pads(1, 29), row("SYX900", 3000, null, 0, 0, 0)]);
  need(half.value === 0.01 && half.coverage === 0.5 && half.reason === null, "exactly half the market value is enough");
  const under = capTide([lead, ...pads(1, 29), row("SYX900", 3001, null, 0, 0, 0)]);
  need(under.value === null && under.reason === "coverage" && under.coverage === 0.499917 && under.n === 30 && under.equal === null && under.top.length === 0,
    "a dollar under half is withheld for coverage");
  const over = capTide([lead, ...pads(1, 29), row("SYX900", 2999, null, 0, 0, 0)]);
  need(over.value === 0.01 && over.reason === null, "a dollar over half is published");
  const both = capTide([lead, ...pads(1, 28), row("SYX900", 9000, null, 0, 0, 0)]);
  need(both.reason === "thin", "too few names is said before too little coverage");
  for (const empty of [[], null, undefined, "rows", 7, {}, [null, 3, { ticker: "" }]]) {
    const out = capTide(empty);
    need(out.value === null && out.reason === "unavailable" && out.of === 0 && out.n === 0 && out.coverage === null && out.effN === null && out.dollarNet === null,
      `an empty input (${JSON.stringify(empty)}) is unavailable`);
  }
  const noStocks = capTide(Array.from({ length: 40 }, (_, i) => row(name(i), null, 10, 0, 50, 50)));
  need(noStocks.value === null && noStocks.reason === "thin" && noStocks.coverage === null && noStocks.excluded.noCap === 40 && noStocks.dollarNet === null,
    "a universe of funds has no name in it: thin, coverage unknown, never zero");
  const custom = capTide([lead, ...pads(1, 4)], { minNames: 5 });
  need(custom.value === 0.06 && capTide([lead, ...pads(1, 3)], { minNames: 5 }).reason === "thin", "a caller may state another floor");
  need(capTide([lead], { minNames: 0 }).value === 0.3 && capTide([row(name(0), null, 1, 0, 5, 5)], { minNames: 0 }).value === null, "and no floor still needs a name");
}

function shape(capTide, need) {
  const out = capTide(Array.from({ length: 36 }, (_, i) => row(name(i), 1000 + 37 * i, (i % 7) - 3, (i % 5) - 2, 11 + i, 9 + (i % 4))));
  need(JSON.stringify(Object.keys(out)) === JSON.stringify(["v", "value", "reason", "coverage", "n", "of", "effN", "dollarNet", "equal", "excluded", "top", "min"]),
    "the result's keys, in order");
  need(JSON.stringify(Object.keys(out.excluded)) === JSON.stringify(["noCap", "missing", "inconsistent", "quiet"]) && JSON.stringify(out.min) === JSON.stringify({ names: 30, coverage: 0.5 }),
    "its classes and its thresholds");
  const sixth = (x) => Math.abs(x * 1e6 - Math.round(x * 1e6)) < 1e-6;
  need(sixth(out.value) && sixth(out.equal) && sixth(out.coverage) && Math.abs(out.effN * 100 - Math.round(out.effN * 100)) < 1e-6 && Number.isInteger(out.dollarNet),
    "six decimals for the tide, the mean and the coverage, two for effective names, whole dollars");
  need(out.top.length === 5 && out.top.every((e) => e.length === 4 && typeof e[0] === "string" && e.slice(1).every(sixth)), "five contributions of four cells");
  need(out.top.every((e, i) => i === 0 || Math.abs(out.top[i - 1][3]) >= Math.abs(e[3])), "largest contribution first, by size and not by sign");
  const level = capTide([row(name(0), 100, -1, 0, 3000000, 0), row(name(1), 100, 1, 0, 3000000, 0), ...pads(2, 28)]);
  need(Object.is(level.value, 0) && Object.is(level.equal, 0) && Object.is(level.dollarNet, 0), "a level tide is zero, never negative zero");
  const negative = capTide([row(name(0), 100, -1, 0, 4000000, 0), ...pads(1, 29)]);
  need(Object.is(negative.value, 0) && Object.is(negative.dollarNet, -1), "a tide under half a millionth rounds to zero and stays unsigned");
  need(capTide(pads(0, 30), { top: 2 }).top.length === 2, "the caller may ask for fewer contributions");
  const frozen = Object.freeze(pads(0, 30).map((r) => Object.freeze(r)));
  need(capTide(frozen).n === 30, "the rows are read, never written");
}

function orderFree(capTide, need) {
  const rnd = mulberry32(90210);
  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    const { rows } = universe(seed * 7919);
    const first = JSON.stringify(capTide(rows));
    for (let k = 0; k < 6; k++) need(JSON.stringify(capTide(shuffled(rows, rnd))) === first, `seed ${seed}: a shuffled universe gives the same bytes`);
  }
  const twins = [...pads(0, 30), row("SYX900", 500, 40, 0, 50, 50), row("SYX900", 900, -40, 0, 50, 50), row("SYX900", 500, 20, 0, 50, 50)];
  const want = JSON.stringify(capTide(twins));
  for (let k = 0; k < 12; k++) need(JSON.stringify(capTide(shuffled(twins, rnd))) === want, "a ticker listed three times resolves the same way in any order");
  const wide = [row("SYC001", 100, 9007199254740992, 0, 9007199254740992, 0), row("SYC002", 100, 1, 0, 1, 0), row("SYC003", 100, 1, 0, 1, 0),
    row("SYC004", 100, -9007199254740992, 0, 9007199254740992, 0)];
  for (let k = 0; k < 12; k++) need(capTide(shuffled(wide, rnd), { minNames: 1 }).dollarNet === 2, "and a sum that cancels is the same in any order");
}

function sweep(capTide, need, seeds) {
  for (const seed of seeds) {
    const { specs, rows } = universe(seed);
    const bad = disagreements(capTide(rows), oracle(specs));
    need(bad.length === 0, `seed ${seed}: ${bad.slice(0, 3).join("; ")}`);
  }
}

const SEEDS = Array.from({ length: 640 }, (_, i) => 1000 + i * 37);

function battery(mod, { count = false, seeds = SEEDS.slice(0, 160) } = {}) {
  const need = count ? ok : (c, m) => { if (!c) throw new Error(m); };
  try {
    knownAnswers(mod.capTide, need);
    boundaries(mod.capTide, need);
    thresholds(mod.capTide, need, mod);
    shape(mod.capTide, need);
    orderFree(mod.capTide, need);
    sweep(mod.capTide, need, seeds);
    return true;
  } catch (error) {
    if (count) throw error;
    return false;
  }
}

battery(REAL, { count: true, seeds: SEEDS });

{
  const tally = { published: 0, thin: 0, coverage: 0, unavailable: 0, classes: { noCap: 0, missing: 0, inconsistent: 0, quiet: 0 }, dupes: 0, ones: 0 };
  for (const seed of SEEDS) {
    const { specs, rows } = universe(seed);
    const out = REAL.capTide(rows);
    tally[out.reason === null ? "published" : out.reason]++;
    for (const k of Object.keys(tally.classes)) tally.classes[k] += out.excluded[k];
    if (new Set(specs.map((s) => s.t)).size < specs.length) tally.dupes++;
    if (out.top.some((e) => Math.abs(e[2]) === 1)) tally.ones++;
  }
  ok(SEEDS.length >= 500 && tally.published >= 150 && tally.thin >= 60 && tally.coverage >= 15 && tally.unavailable >= 10,
    `the ${SEEDS.length} universes reach every outcome: ${JSON.stringify(tally)}`);
  ok(Object.values(tally.classes).every((n) => n >= 200) && tally.dupes >= 40 && tally.ones >= 20,
    "and every exclusion class, repeated tickers and tides of exactly one");
}

{
  const rnd = mulberry32(4242);
  for (let k = 0; k < 400; k++) {
    const list = Array.from({ length: between(rnd, 0, 40) }, () => {
      const m = between(rnd, -9007199254740991, 9007199254740991);
      return chance(rnd, 0.3) ? m * 2 ** between(rnd, 0, 40) : chance(rnd, 0.3) ? Math.trunc(m / 2 ** between(rnd, 0, 50)) : m;
    });
    const exact = list.reduce((a, x) => a + BigInt(x), 0n);
    const got = REAL.exactSum(list);
    ok(got === Number(exact), `exactSum is the correctly rounded sum of ${list.length} integers (${got} against ${Number(exact)})`);
    ok(REAL.exactSum(shuffled(list, rnd)) === got, "in any order");
  }
  ok(REAL.exactSum([]) === 0 && REAL.exactSum([0.1, 0.2, 0.3]) === 0.6 && REAL.exactSum([1e16, 1, -1e16]) === 1, "an empty sum is zero, and tenths add to six tenths");
  for (const [v, want] of [[12, 12], ["12", 12], [" 12.50 ", 12.5], ["+3", 3], ["-3.25", -3.25], ["1e3", 1000], [".5", 0.5], ["5.", 5], [0, 0], ["0", 0], [-0, 0]]) {
    ok(REAL.capTideNumber(v) === want || (want === 0 && REAL.capTideNumber(v) === 0), `${JSON.stringify(v)} reads as ${want}`);
  }
  for (const v of ABSENT) ok(REAL.capTideNumber(v) === null, `${String(v)} is not a number`);
}

{
  const sentences = Object.values(REAL.CAP_TIDE_COPY);
  eq(Object.keys(REAL.CAP_TIDE_COPY), ["define", "net", "outside", "scope", "withheld"], "five sentences of copy");
  const forecast = new RegExp("\\b(?:" + FORECAST_ALT + "|" + MODAL_ALT + "|may)\\b", "i");
  const advice = /\b(?:buy|sell|hold|recommend\w*|advis\w*|suggest\w*|opportunit\w*|signal\w*)\b/i;
  for (const s of sentences) {
    ok(tooLong(s) === null, `at most fourteen words: ${s}`);
    ok(tape(s) === null && modal(s) === null && !forecast.test(s) && !advice.test(s), `no banned word: ${s}`);
    ok(/^[A-Z]/.test(s) && /\.$/.test(s) && !/[—;:]/.test(s) && s.split(/[.!?]\s/).length === 1, `one plain sentence: ${s}`);
  }
  ok(REAL.CAP_TIDE_COPY.withheld.includes(String(REAL.CAP_TIDE_MIN_NAMES)) && /\bhalf\b/.test(REAL.CAP_TIDE_COPY.withheld) && REAL.CAP_TIDE_MIN_COVERAGE === 0.5,
    "the withheld sentence names the two thresholds the leaf applies");
  ok(/funds/i.test(REAL.CAP_TIDE_COPY.outside) && /index options/i.test(REAL.CAP_TIDE_COPY.outside) && /not an index of the whole options market/.test(REAL.CAP_TIDE_COPY.scope),
    "the copy says funds and index options are outside it and that it is not an index of the whole options market");
  ok(Object.isFrozen(REAL.CAP_TIDE_COPY) && Object.isFrozen(REAL.CAP_TIDE_REASONS) && Object.isFrozen(REAL.CAP_TIDE_CLASSES), "the tables are frozen");
  eq([...REAL.CAP_TIDE_CLASSES], ["noCap", "missing", "inconsistent", "quiet"], "the classes in the order they are decided");
}

{
  eq(importsOf("shared/flows-cap-tide.js"), [], "the leaf imports nothing");
  const src = moduleSource("shared/flows-cap-tide.js");
  ok(!/\bDate\b|Math\.random|process\.|globalThis|window\b/.test(src), "and reads no clock, no randomness and no environment");
  const { rows } = universe(1000 + 37 * 3);
  const agg = marketAggregate(rows.filter((r) => r && typeof r === "object" && !Array.isArray(r)), new Map(), { screened: 9 });
  eq(agg.capTide, REAL.capTide(rows), "THE NIGHTLY'S MARKET AGGREGATE CARRIES IT: marketAggregate publishes capTide over the rows it was handed");
  eq(marketAggregate(null).capTide.reason, "unavailable", "and no rows is unavailable rather than a throw");
  for (const s of Object.values(REAL.CAP_TIDE_COPY)) ok(MARKET_NOTES.capTide.includes(s), `the market payload's note carries the sentence: ${s}`);
  const nightly = nightlySource();
  ok(/\.\.\.marketAggregate\(\s*withTilt\.map\(\(w\) => w\.row\),/.test(nightly),
    "and the market stage hands the aggregate every universe row the run already holds, so the figure costs no feed call");
  ok(!/capTide/.test(moduleSource("scripts/flows-nightly/sections/market.mjs")), "the section adds no code of its own for it");
}

const MUTANTS = [
  ["equal weights", [["u.w = u.m / capUsed;", "u.w = 1 / n;"]]],
  ["the tide divided by |net calls| + |net puts|", [["tau: net / gross });", "tau: net / ((Math.abs(r.ncp) + Math.abs(r.npp)) || 1) });"]]],
  ["an inconsistent name clamped to one instead of left out", [
    ["    if (r.cp < 0 || r.pp < 0 || Math.abs(net) > gross) { excluded.inconsistent++; continue; }\n", ""],
    ["tau: net / gross });", "tau: Math.max(-1, Math.min(1, net / gross)) });"]]],
  ["weights over the whole universe instead of the names in the tide", [["u.w = u.m / capUsed;", "u.w = u.m / capAll;"]]],
  ["coverage by count of names", [["const coverage = capAll > 0 ? capUsed / capAll : null;", "const coverage = of > 0 ? n / of : null;"]]],
  ["a missing input read as zero", [
    ["ncp: capTideNumber(row.net_call_premium),", "ncp: capTideNumber(row.net_call_premium) ?? 0,"],
    ["npp: capTideNumber(row.net_put_premium),", "npp: capTideNumber(row.net_put_premium) ?? 0,"],
    ["cp: capTideNumber(row.call_premium),", "cp: capTideNumber(row.call_premium) ?? 0,"],
    ["pp: capTideNumber(row.put_premium),", "pp: capTideNumber(row.put_premium) ?? 0,"]]],
  ["the sign flipped", [["const net = r.ncp - r.npp;", "const net = r.npp - r.ncp;"]]],
  ["the puts added instead of subtracted", [["const net = r.ncp - r.npp;", "const net = r.ncp + r.npp;"]]],
  ["thirty names refused", [["if (!n || n < minNames)", "if (!n || n <= minNames)"]]],
  ["exactly half the market value refused", [["coverage < minCoverage)", "coverage <= minCoverage)"]]],
  ["a quiet name counted as a level tide", [["if (!(gross > 0)) { excluded.quiet++; continue; }", "if (!(gross > 0)) { used.push({ t: r.t, m: r.m, net, tau: 0 }); continue; }"]]],
  ["rows taken in the order they arrive", [["  list.sort((a, b) => order(a.t, b.t) || order(a.m, b.m) || order(a.ncp, b.ncp) || order(a.npp, b.npp) ||\n    order(a.cp, b.cp) || order(a.pp, b.pp));\n", ""]]],
  ["sums added left to right", [["  const partials = [];\n", "  if (values) return [...values].reduce((a, b) => a + b, 0);\n  const partials = [];\n"]]],
  ["contributions ranked by sign", [["Math.abs(b.part) - Math.abs(a.part)", "b.part - a.part"]]],
  ["effective names not inverted", [["rounded(1 / exactSum(used.map((u) => u.w * u.w)), 2)", "rounded(exactSum(used.map((u) => u.w * u.w)), 2)"]]],
  ["a market value of zero admitted", [["if (r.m === null || !(r.m > 0))", "if (r.m === null || !(r.m >= 0))"]]],
  ["excluded names left out of the coverage", [["    caps.push(r.m);\n", ""], ["const capAll = exactSum(caps);", "const capAll = exactSum(used.map((u) => u.m));"]]],
  ["the tide left unrounded", [["out.value = rounded(exactSum(used.map((u) => u.part)), 6);", "out.value = exactSum(used.map((u) => u.part));"]]],
  ["a tide of exactly one refused", [["Math.abs(net) > gross)", "Math.abs(net) >= gross)"]]],
  ["no market value decided after the premium", [
    ["    if (r.m === null || !(r.m > 0)) { excluded.noCap++; continue; }\n    caps.push(r.m);\n", ""],
    ["    if (!(gross > 0)) { excluded.quiet++; continue; }\n", "    if (!(gross > 0)) { excluded.quiet++; continue; }\n    if (r.m === null || !(r.m > 0)) { excluded.noCap++; continue; }\n    caps.push(r.m);\n"]]],
  ["a withheld tide still published", [["if (!n || n < minNames) return { ...out, reason: CAP_TIDE_REASONS.thin };", "if (!n) return { ...out, reason: CAP_TIDE_REASONS.thin };"]]],
  ["hexadecimal text read as a number", [["if (!DECIMAL.test(s)) return null;", "if (!s) return null;"]]],
];

{
  const copy = await loadMutated("shared/flows-cap-tide.js", [], { salt: 1 });
  ok(battery(copy), "the unmutated copy passes the battery the wrong builds are held to");
  let salt = 2;
  for (const [title, transforms] of MUTANTS) {
    const bad = await loadMutated("shared/flows-cap-tide.js", transforms, { salt: salt++ });
    ok(!battery(bad), `PLANTED WRONG BUILD, ${title}: the battery fails it`);
  }
  ok(MUTANTS.length >= 8, "at least eight planted wrong builds");
}

console.log(`✓ flows-cap-tide: ${checks} assertions — the cap-weighted tide by hand on two and thirty names, every exclusion class from both sides of its line (no market value, a missing input, inconsistent, quiet) with their order, the thirty-name and half-the-market-value thresholds from both sides, an independent BigInt oracle over ${SEEDS.length} seeded universes, shuffled and repeated rows giving identical bytes, exact sums against BigInt, the copy's five sentences, the nightly's market aggregate, and ${MUTANTS.length} planted wrong builds`);
