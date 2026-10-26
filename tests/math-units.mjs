import assert from "node:assert/strict";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MINUS = "−";

const FILES = {
  words: "shared/flows-oracle-words.js",
  card: "shared/flows-card.js",
  neuron: "shared/flows-neuron.js",
  dossier: "shared/flows-dossier.js",
  variation: "shared/flows-variation.js",
};

async function load(over = {}) {
  const out = {};
  for (const [k, rel] of Object.entries(FILES)) out[k] = await loadMutated(rel, over[k] || [], { salt: Math.floor(Math.random() * 1e6) });
  return out;
}

function battery(m) {
  const bad = [];
  const eqq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${what}: got ${JSON.stringify(got)} where ${JSON.stringify(want)} is right`); };
  eqq([999, 999.4, 999.5, 1000, 1500, 99949, 99950, 999499, 999500, 999949, 1250000, 1150000, 999950000, 1e12, -999950].map(m.words.usdShort),
    ["$999", "$999", "$1K", "$1K", "$1.5K", "$99.9K", "$100K", "$999K", "$1M", "$1M", "$1.3M", "$1.2M", "$1B", "$1T", MINUS + "$1M"], "usdShort");
  const said = (v) => m.card.saidMagnitude(v);
  eqq([said(999.4), said(999.996), said(1000), said(999499), said(999950), said(999999), said(1234567), said(999994999), said(999995000), said(1e12)].map((x) => x.shown + x.suffix),
    ["999.4", "1k", "1k", "999.5k", "1M", "1M", "1.23M", "999.99M", "1B", "1T"], "saidMagnitude");
  eqq([said(1500).exact, said(-2500000).shown, said(-2500000).suffix], [1500, 2.5, "M"], "saidMagnitude keeps the exact value and takes the magnitude of a negative");
  eqq([0.4, 999, 999949, 999950, 1234567, 999949999, 999999999].map(m.neuron.magnitude), ["<1", "999", "999.9k", "1.00M", "1.23M", "999.95M", "1.00B"], "neuron magnitude");
  eqq([999, 999.4, 999.5, 1234, 12345, 99950, 999950, 999949999, 1e12].map(m.dossier.compact), [null, null, "1.00K", "1.23K", "12.3K", "100K", "1.00M", "1.00B", "1.00T"], "dossier compact");
  const s = m.variation.sayer();
  eqq([999950, 999499, 999999, 999999999, 999.996, 1500, 2.5e9].map((v, i) => s.money("k" + i, v)),
    ["$1.00M", "$999.5k", "$1.00M", "$1.00B", "$1.0k", "$1.5k", "$2.50B"], "variation money");
  eqq([s.n.k0, s.n.k1, s.n.k2, s.n.k4], [1, 999.5, 1, 1], "and the number pinned for the guard is the number printed");
  return bad;
}

const base = await load();
const clean = battery(base);
eq(clean.join("; "), "", "every private compact-money formatter on the server tells a figure in the unit its rounded value belongs to");

const MUTANTS = [
  ["usdShort keeps the unit chosen before rounding", { words: [[
    "  if (a < 999.5) return usd(n, 0);\n  return SIGN_PREFIX[Math.sign(n)] + formatScaled(a, (x) => (x >= 100 ? 0 : 1), \"$\").replace(/\\.0(?=[KMBT]$)/, \"\");",
    "  const tiers = [[1e9, \"B\"], [1e6, \"M\"], [1e3, \"K\"]];\n  for (const [size, tag] of tiers) {\n    if (a >= size) {\n      const v = a / size;\n      return SIGN_PREFIX[Math.sign(n)] + \"$\" + (v >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\\.0$/, \"\") + tag;\n    }\n  }\n  return usd(n, 0);"]] }],
  ["saidMagnitude lets 1000k through", { card: [["  if (base < 1000) return { shown: base, suffix: \"\", exact: mag };", "  if (mag < 1e3) return { shown: base, suffix: \"\", exact: mag };\n  if (mag < 1e6) return { shown: Number((mag / 1e3).toFixed(1)), suffix: \"k\", exact: mag };\n  return { shown: Number((mag / 1e6).toFixed(2)), suffix: \"M\", exact: mag };"]] }],
  ["neuron magnitude lets 1000.0k through", { neuron: [["  return formatScaled(Math.abs(v), (n, i) => MAGNITUDE_DP[i]).replace(/K$/, \"k\");", "  const mag = Math.abs(v);\n  return mag >= 1e6 ? (mag / 1e6).toFixed(2) + \"M\" : mag >= 1e3 ? (mag / 1e3).toFixed(1) + \"k\" : String(Math.round(mag));"]] }],
  ["dossier compact lets 1000K through", { dossier: [["  if (a < 999.5) return null;\n  return formatScaled(a, (x) => (x >= 100 ? 0 : x >= 10 ? 1 : 2));", "  const unit = a >= 1e12 ? [1e12, \"T\"] : a >= 1e9 ? [1e9, \"B\"] : a >= 1e6 ? [1e6, \"M\"] : a >= 1e3 ? [1e3, \"K\"] : null;\n  if (!unit) return null;\n  const x = a / unit[0];\n  return (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + unit[1];"]] }],
  ["variation money lets 1000.0k through", { variation: [["    while (tier > 0 && Number((m / MONEY_TIERS[tier][0]).toFixed(MONEY_TIERS[tier][1])) >= 1000) tier--;\n", ""]] }],
];
for (const [name, over] of MUTANTS) {
  let bad;
  try { bad = battery(await load(over)); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  ok(bad.length > 0, `planted wrong build must fail: ${name}`);
}

console.log(`✓ math-units: ${checks} assertions - five server-side compact-money formatters that chose the unit before rounding (1000k, 1000.0k, 1000.00M, 1000K) now tell a figure in the unit its rounded value belongs to, the number pinned for the guard equals the number printed, and ${MUTANTS.length} planted wrong builds that each fail`);
