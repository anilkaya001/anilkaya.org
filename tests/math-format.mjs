import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { bootUI } from "./lib/ui-boot.mjs";
import * as LEAF from "../shared/flows-round.js";
import * as TAPE from "../shared/flows-tape-stats.js";

const HERE = new URL("./", import.meta.url);
const read = (p) => readFileSync(new URL(p, HERE), "utf8");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const FX = JSON.parse(read("fixtures-math-format.json"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-format-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");
ok(FX.round.length > 4000 && FX.functions.length > 10000, "the oracle holds thousands of cases");

const MINUS = "−";
const DASH = "—";

for (const [s, dp, want] of FX.round) eq(LEAF.fixedHalfUp(Number(s), dp), want, `the rounding core agrees with Decimal ROUND_HALF_UP at ${s} to ${dp} places`);

const mapFor = (F, short, shortS, exact, exactS) => ({
  px: (v, dp) => F.px(Number(v), dp),
  pct: (v, dp, s) => F.pct(Number(v), dp, s),
  pts: (v, dp) => F.pts(Number(v), dp),
  signed: (v, dp) => F.signed(Number(v), dp),
  int: (v, s) => F.int(Number(v), s),
  num: (v, s, dp) => F.num(Number(v), s, dp === null ? undefined : dp),
  money: (v, s, dp) => F.money(Number(v), s, dp === null ? undefined : dp),
  short: (v, s) => (s ? shortS : short)(Number(v)),
  exact: (v, s) => (s ? exactS : exact)(Number(v)),
  strike: (k) => F.strike(k),
});

function uiMap(UI) {
  const F = UI.F;
  return mapFor(F, F.unit.of("moneyCompact", { dp: "short" }), F.unit.of("moneyCompact", { dp: "short", signed: true }), F.unit.of("money"), F.unit.of("money", { signed: true }));
}

function leafMap() {
  const scaled = (dp, prefix) => (v, s) => LEAF.formatScaled(Number(v), LEAF.fixedUnitDp(dp), prefix, s);
  return {
    px: (v, dp) => LEAF.formatFixed(Number(v), { dp }),
    pct: (v, dp, s) => LEAF.formatFixed(Number(v), { dp, shift: 2, suffix: "%", plus: s }),
    pts: (v, dp) => LEAF.formatFixed(Number(v), { dp, shift: 2, plus: true }),
    signed: (v, dp) => LEAF.formatFixed(Number(v), { dp, plus: true }),
    int: (v, s) => LEAF.formatFixed(Number(v), { dp: 0, plus: s, group: true }),
    num: (v, s, dp) => scaled(dp === null ? undefined : dp, "")(v, s),
    money: (v, s, dp) => scaled(dp === null ? undefined : dp, "$")(v, s),
    short: (v, s) => LEAF.formatScaled(Number(v), LEAF.shortDp, "$", s),
    exact: (v, s) => LEAF.formatFixed(Number(v), { dp: Math.abs(Number(v)) < 1000 ? 2 : 0, prefix: "$", plus: s, group: true }),
  };
}

const UI = bootUI();
const browser = uiMap(UI);
const leaf = leafMap();
for (const [fn, args, want] of FX.functions) {
  eq(browser[fn](...args), want, `the browser formatter ${fn}(${JSON.stringify(args)}) agrees with the Decimal oracle`);
  eq(leaf[fn](...args), want, `and the shared leaf's ${fn}(${JSON.stringify(args)}) does too`);
}

const norm = (t) => t.replace(/\s+/g, " ").replace(/export /g, "").trim();
const block = (src) => {
  const start = src.indexOf("function fixedHalfUp");
  const tail = "return v < 0 ? -n : n;";
  return norm(src.slice(start, src.indexOf(tail, start) + tail.length));
};
{
  const ui = read("../assets/js/flows-ui.js"), leafSrc = read("../shared/flows-round.js");
  eq(block(ui), block(leafSrc), "the nine rounding functions are the same code in flows-ui.js and in shared/flows-round.js");
  for (const line of ["const NOISE = 1e-9;", 'const SCALE_SUFFIX = ["", "K", "M", "B", "T"];', "const SHORT_DP = [0, 0, 1, 2, 2];"]) {
    ok(ui.includes(line), `flows-ui.js holds ${line}`);
    ok(norm(leafSrc).replace(/Object\.freeze\((\[[^\]]*\])\)/g, "$1").includes(line), `and so does the leaf`);
  }
}

const PROBES = [
  ["px", [1.005, 2], "1.01"], ["px", [2.675, 2], "2.68"], ["px", [1.45, 1], "1.5"], ["px", [4.35, 1], "4.4"],
  ["px", [-0.004, 2], MINUS + "<0.01"], ["px", [0.004, 2], "<0.01"], ["px", [0, 2], "0.00"], ["px", [-0, 2], "0.00"], ["px", [0.1 + 0.2 - 0.3, 2], "0.00"],
  ["px", [0.125, 2], "0.13"], ["px", [-1.005, 2], MINUS + "1.01"], ["px", [9.995, 2], "10.00"], ["px", [0.995, 2], "1.00"], ["px", [0.005, 2], "0.01"], ["px", [4e-7, 2], "<0.01"], ["px", [1.0049999999, 2], "1.00"],
  ["pct", [0.00004, 1], "<0.1%"], ["pct", [-0.00004, 1, true], MINUS + "<0.1%"], ["pct", [0.00004, 1, true], "+<0.1%"], ["pct", [0, 1], "0.0%"], ["pct", [-0, 1], "0.0%"],
  ["pct", [1.005, 0], "101%"], ["pct", [0.0115, 2], "1.15%"], ["pct", [0.0145, 1], "1.5%"], ["pct", [0.285, 0], "29%"], ["pct", [-0.0123, 1], MINUS + "1.2%"],
  ["pts", [0.00001, 1], "+<0.1"], ["pts", [-0.00001, 1], MINUS + "<0.1"], ["pts", [0.0123, 1], "+1.2"],
  ["signed", [-0.004, 2], MINUS + "<0.01"], ["signed", [1.005, 2], "+1.01"], ["signed", [1e-12, 2], "0.00"], ["signed", [-1.5, 1], MINUS + "1.5"],
  ["int", [0.4], "<1"], ["int", [-2.5], MINUS + "3"], ["int", [2.5], "3"], ["int", [1234567.5], "1,234,568"], ["int", [1e21], "1,000,000,000,000,000,000,000"], ["int", [0], "0"],
  ["num", [0.4], "<1"], ["num", [0.5], "1"], ["num", [-0.4], MINUS + "<1"], ["num", [999.4], "999"], ["num", [999.5], "1.0K"],
  ["num", [9994], "10.0K"], ["num", [9995], "10.0K"], ["num", [99949], "99.9K"], ["num", [99950], "100K"], ["num", [999949], "1.00M"], ["num", [999950], "1.00M"], ["num", [999999], "1.00M"],
  ["num", [999949999], "1.00B"], ["num", [1e12], "1.00T"], ["num", [1.5e12], "1.50T"], ["num", [999950, false, 1], "1.0M"], ["num", [1234.5, true], "+1.2K"],
  ["money", [0.4], "<$1"], ["money", [-0.4], MINUS + "<$1"], ["money", [1e12], "$1.00T"], ["money", [999950], "$1.00M"], ["money", [0], "$0"],
  ["short", [999950], "$1.0M"], ["short", [999999], "$1.0M"], ["short", [99950], "$100K"], ["short", [99949], "$100K"], ["short", [999949999], "$999.9M"], ["short", [999950000], "$1.00B"],
  ["short", [1e12], "$1.00T"], ["short", [0.4], "<$1"], ["short", [999.5], "$1K"], ["short", [-999950], MINUS + "$1.0M"], ["short", [0], "$0"], ["short", [1500, true], "+$2K"],
  ["exact", [1.005], "$1.01"], ["exact", [2.675], "$2.68"], ["exact", [999.995], "$1,000.00"], ["exact", [0.001], "<$0.01"], ["exact", [0], "$0.00"], ["exact", [-0.001], MINUS + "<$0.01"],
  ["strike", [6800], "6800"], ["strike", [1450], "1450"], ["strike", [187.5], "187.5"], ["strike", [12.25], "12.25"], ["strike", [0], DASH],
  ["exact", [1234.5, true], "+$1,235"], ["exact", [-1234.5], MINUS + "$1,235"],
];

function battery(UIx) {
  const m = uiMap(UIx);
  const F = UIx.F;
  const failures = [];
  for (const [fn, args, want] of PROBES) {
    let got;
    try { got = m[fn](...args); } catch (e) { got = "threw " + e.message; }
    if (got !== want) failures.push(`${fn}(${args.map(String).join(", ")}) = ${got} where ${want} is right`);
  }
  const unitShort = F.unit.of("moneyCompact", { dp: "short" }), unitExact = F.unit.of("money");
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, "x"]) {
    for (const [name, got] of [["px", F.px(bad, 1)], ["pct", F.pct(bad, 1)], ["pts", F.pts(bad, 1)], ["signed", F.signed(bad, 1)], ["int", F.int(bad)], ["num", F.num(bad)], ["money", F.money(bad)], ["short", unitShort(bad)], ["exact", unitExact(bad)]]) {
      if (got !== DASH) failures.push(`${name}(${String(bad)}) = ${got} where the dash is right`);
    }
  }
  for (const v of [-0.5, -2, -1234, -1e6, -0.0004]) {
    for (const [fn, args] of [["px", [v, 2]], ["pct", [v / 100, 1]], ["signed", [v, 1]], ["int", [v]], ["num", [v]], ["money", [v]], ["short", [v]], ["exact", [v]]]) {
      const got = m[fn](...args);
      if (/-/.test(got)) failures.push(`${fn}(${v}) printed a hyphen-minus: ${got}`);
      if (!got.startsWith(MINUS) && !/^\$?0(\.0+)?%?$/.test(got)) failures.push(`${fn}(${v}) lost its minus: ${got}`);
    }
  }
  return failures;
}

eq(battery(UI).join("; "), "", "the shipped formatters pass every probe: ties, floors, carries, units chosen after rounding, absent values and the Unicode minus");

const swap = (from, to) => [[from, to]];
{
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, "0.5", {}, []]) eq(LEAF.wholePercent(bad), null, `a whole percent of ${String(bad)} is absent, never a zero and never a throw`);
  eq(LEAF.wholePercent(0.004), 0, "a value that rounds to zero is the number zero for a comparison, and the printed form owns the floor");
  eq(LEAF.wholePercent(-0.285), -29, "and a negative share rounds away from zero as a positive one does");
  for (const bad of [-1.5, NaN, Infinity, -0.1]) {
    assert.throws(() => LEAF.fixedHalfUp(bad, 0), RangeError, `fixedHalfUp refuses ${bad} by name instead of failing on a null match`);
    checks++;
  }
  eq(LEAF.formatScaled(999999.5, LEAF.compactDp), "1.00M", "999,999.5 rounds up into the million");
  eq(LEAF.formatFixed(9.99e-10, { dp: 2 }), "0.00", "float noise under a nano is an exact zero");
  eq(LEAF.formatFixed(1e-9, { dp: 2 }), "<0.01", "and the first value that is not noise prints its floor");
}

const MUTANTS = [
    ["toFixed in place of the decimal core", swap("const s = fixedHalfUp(a, dp, shift);\n    if (/^[0.]+$/.test(s)) return sign + \"<\" + prefix + unitFloor(dp) + suffix;", "const s = (a * 10 ** shift).toFixed(dp);\n    if (/^[0.]+$/.test(s)) return sign + \"<\" + prefix + unitFloor(dp) + suffix;")],
    ["a nano nudge before rounding", swap("const s = fixedHalfUp(a, dp, shift);\n    if (/^[0.]+$/.test(s)) return sign + \"<\" + prefix + unitFloor(dp) + suffix;", "const s = fixedHalfUp(a + 1e-9, dp, shift);\n    if (/^[0.]+$/.test(s)) return sign + \"<\" + prefix + unitFloor(dp) + suffix;")],
    ["a tie rounds down", swap("digits.charCodeAt(keep) >= 53 ? 1n : 0n", "digits.charCodeAt(keep) > 53 ? 1n : 0n")],
    ["a carry is dropped", swap("BigInt(digits.slice(0, keep) || \"0\") + (digits.charCodeAt(keep) >= 53 ? 1n : 0n)", "BigInt(digits.slice(0, keep) || \"0\")")],
    ["float noise is not snapped to zero", swap("if (a < NOISE) return prefix + fixedHalfUp(0, dp) + suffix;", "if (a === 0) return prefix + fixedHalfUp(0, dp) + suffix;")],
    ["a nonzero value below the resolution prints as zero", swap("if (/^[0.]+$/.test(s)) return sign + \"<\" + prefix + unitFloor(dp) + suffix;", "if (/^[0.]+$/.test(s)) return prefix + s + suffix;")],
    ["a negative that rounds to zero keeps no sign", swap("if (/^[0.]+$/.test(s)) return sign + \"<\" + prefix + unitFloor(dp) + suffix;", "if (/^[0.]+$/.test(s)) return \"<\" + prefix + unitFloor(dp) + suffix;")],
    ["the unit is chosen before the value is rounded", swap("if (n >= 1000 && i < 4) { i++; continue; }", "if (n >= 1000 && i < 4) { break; }")],
    ["the digits are not recomputed after a rollover to a hundred", swap("if (d2 < dp) { dp = d2; s = fixedHalfUp(a, d2, -3 * i); }", "if (d2 < dp) { dp = d2; }")],
    ["a percent is multiplied by a hundred before the decimal point is moved", swap("pct: (v, dp = 1, signed = false) => formatFixed(v, { dp, shift: 2, suffix: \"%\", plus: signed }),", "pct: (v, dp = 1, signed = false) => formatFixed(v * 100, { dp, suffix: \"%\", plus: signed }),")],
    ["the minus is a hyphen", swap("const MINUS = \"−\";", "const MINUS = \"-\";")],
    ["the exponent of a small number is not read", swap("(?:e([+-]\\d+))?$/.exec(String(a));\n    if (!m)", "(?:e(x))?$/.exec(String(a));\n    if (!m)")],
    ["the exact money form still nudges by a nano", swap("const exactUsd = (n, signed) => formatFixed(n, { dp: Math.abs(n) < 1000 ? 2 : 0, prefix: \"$\", plus: signed, group: true });", "const exactUsd = (n, signed) => formatFixed(n + 1e-9, { dp: Math.abs(n) < 1000 ? 2 : 0, prefix: \"$\", plus: signed, group: true });")],
    ["a trillion prints with the billion suffix", swap('const SCALE_SUFFIX = ["", "K", "M", "B", "T"];', 'const SCALE_SUFFIX = ["", "K", "M", "B", "B"];')],
    ["a strike is run through the compact form", swap("strike: (k) => (num(k) === null || !(k > 0) ? DASH : Number.isInteger(k) ? String(k) : fixedHalfUp(k, Math.abs(k * 10 - Math.round(k * 10)) < 1e-6 ? 1 : 2)),", "strike: (k) => (num(k) === null || !(k > 0) ? DASH : compact(k, Number.isInteger(k) ? 0 : 1)),")],
];
for (const [name, patch] of MUTANTS) {
  let bad;
  try { bad = battery(bootUI(patch)); } catch (e) { assert.fail("the planted build '" + name + "' did not load: " + e.message); }
  ok(bad.length > 0, `planted wrong build must fail: ${name}`);
}

eq(UI.F.strike(6800), "6800", "a strike of 6,800 is not squeezed to 7K");
eq(UI.F.strike(1450), "1450", "nor is a strike of 1,450 printed as 1K");
eq(UI.F.strike(187.5), "187.5", "a half-dollar strike keeps its half");
eq(UI.F.strike(12.25), "12.25", "a quarter-dollar strike keeps both decimals");
eq(UI.F.strike(0), DASH, "a strike of zero is absent");
eq(UI.F.strike(-5), DASH, "and so is a negative one");
eq(UI.F.strike(null), DASH, "and a missing one");
{
  const unusual = read("../assets/js/flows-unusual.js");
  ok(unusual.includes("F.strike(n(r.k))") && !/F\.compact\(n\(r\.k\)/.test(unusual), "the Flow page prints the strike of a contract through F.strike, not the compact form that turns 6,800 into 7K");
}

{
  let worst = 0;
  for (let i = 0; i <= 1000; i++) {
    const x = i / 1000;
    const shown = UI.F.pct(x, 0);
    const printed = shown === "<1%" ? 0 : Number(shown.replace("%", ""));
    eq(printed, LEAF.wholePercent(x), `the whole percent that the ask-share rule compares is the whole percent F.pct prints, at ${x}`);
    worst = Math.max(worst, Math.abs(printed - x * 100));
  }
  ok(worst <= 0.5 + 1e-9, "and it is the nearest whole percent");
  const sided = (ask, bid) => UI.F.askShare([{ prem: ask + bid, askPrem: ask, bidPrem: bid }]);
  eq(sided(645, 355).side, "ask", "a share of 64.5% is 65% and reads as ask");
  eq(sided(355, 645).side, "mixed", "and 35.5% is 36%, which is still mixed: the rule is at or below 35%");
  eq(sided(345, 655).side, "bid", "while 34.5% is 35% and reads as bid");
  eq(TAPE.askShareRead([{ prem: 1000, askPrem: 645, bidPrem: 355 }]).side, "ask", "the server rule reads 64.5% as ask too");
}

const SITE_RE = /\.toFixed\(|\.toPrecision\(|\.toLocaleString\(|Intl\.NumberFormat|Math\.round\([^)]*\*\s*(?:10|100)\b/g;
const SITES_FILE = new URL("fixtures-math-format-sites.json", HERE);
function siteCounts() {
  const out = {};
  for (const dir of ["../assets/js/", "../shared/"]) {
    for (const f of readdirSync(new URL(dir, HERE)).sort()) {
      if (!/^flows-.*\.js$/.test(f) || /\.bundle\.js$/.test(f)) continue;
      const n = (readFileSync(new URL(dir + f, HERE), "utf8").match(SITE_RE) || []).length;
      if (n) out[dir.replace("../", "") + f] = n;
    }
  }
  return out;
}
function ratchet(now, base) {
  const problems = [];
  for (const f of new Set([...Object.keys(now), ...Object.keys(base)])) {
    const a = now[f] || 0, b = base[f] || 0;
    if (a > b) problems.push(`${f} has ${a} local rounding sites where the baseline allows ${b}: format through FlowsUI.F, or shared/flows-round.js on the server`);
    if (a < b) problems.push(`${f} has ${a} local rounding sites and the baseline still says ${b}: lower it with node math-format.mjs --write-sites so the cleanup cannot be undone`);
  }
  return problems;
}
if (process.argv.includes("--write-sites")) {
  writeFileSync(SITES_FILE, JSON.stringify(siteCounts(), null, 1) + "\n");
  console.log("wrote the baseline");
  process.exit(0);
}
const SITES = JSON.parse(readFileSync(SITES_FILE, "utf8"));
eq(ratchet(siteCounts(), SITES).join("; "), "", "no file gained a local rounding site (toFixed, toPrecision, toLocaleString, Intl.NumberFormat, Math.round(x * 100)) and none lost one without lowering the baseline");
{
  const base = { "assets/js/a.js": 3, "shared/b.js": 1 };
  eq(ratchet({ "assets/js/a.js": 3, "shared/b.js": 1 }, base).length, 0, "the ratchet passes an unchanged tree");
  eq(ratchet({ "assets/js/a.js": 4, "shared/b.js": 1 }, base).length, 1, "and fails a file that gains a site");
  eq(ratchet({ "assets/js/a.js": 2, "shared/b.js": 1 }, base).length, 1, "and a file that loses one without lowering the baseline");
  eq(ratchet({ "assets/js/a.js": 3, "shared/b.js": 1, "assets/js/new.js": 1 }, base).length, 1, "and a new file that starts above zero");
  eq(ratchet({ "assets/js/a.js": 3 }, base).length, 1, "and a file that disappeared without leaving the baseline");
}

console.log(`✓ math-format: ${checks} assertions - one rounding rule (half away from zero on the shortest decimal) held to a Decimal oracle over ${FX.functions.length + FX.round.length} cases, the browser copy equal to the shared leaf in source and in output, units chosen after rounding, nonzero values never printed as zero, no minus on a zero, and ${MUTANTS.length} planted wrong builds that each fail`);
