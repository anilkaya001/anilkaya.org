import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../shared/flows-stats.js";
import { TARGET_BY_ID, TARGETS_VERSION, targetsHash } from "../shared/flows-targets.js";
import {
  HORIZON_IDS, PROTOCOL, SIGNAL_IDS, SIGNED_SIGNALS, definitionHash, loadRegistry, validateRegistry,
} from "../scripts/research/flow-registry.mjs";
import { servedFiles } from "./lib/served-tree.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const PINNED = {
  "S1.close": "9a5157bef2254001dcd33870793e4f539cfcb7391a57e51d1e3b6de7b79b7479",
  "S1.next": "7712c3bc3ad3c2ae0d84241793a6a5c5098289f49ba01a3be19d198cccb5dbdd",
  "S1.h5": "7e30535e9fc47200d1ce4e7150bdace2e04ac1c55efff1f7a5c289ae93ac3269",
  "S2.close": "47124b37b87dd4860b2c965eb74cf243d90390b463402fb86dbfa9870c26a62f",
  "S2.next": "82a3b8ac1495a69abd3fcd6867fc83332d2431a5752d1453e40e9275e89c1b81",
  "S2.h5": "706a420159347076027a5286ca9ee0f77ef9365e15df02d2766d0e9f4e383d19",
  "S3.close": "1e918a1db6237e449e2a3b69b8b6d8015b78fad105b3d91e58111d890e9ac26d",
  "S3.next": "bdda3503da5050edb82010443502e061b11488271b86c30111916cc12e161b0b",
  "S3.h5": "002e27fb4478c47c2f6e22d08554d4092932bc4b8b9e28b83659261853182cf6",
  "S4.close": "5f54d4968d431519424d06a879e1147f3e07d5d2f18fbacaf678b7fb773e5f08",
  "S4.next": "1f1f835918389e861c86cacc52dc598adcdaca3051c8cd6351b642a247bdc76f",
  "S4.h5": "36607ef13df79158fb79427b99b0cc06355b71fe2910bdbd0878cb939a6b63df",
  "S4p.close": "e5db1f8f81842e10f877e24122e4cedb602ef2f9faab0aada475067e14dec175",
  "S4p.next": "c084b36565aac82622c08b08bb364ab590e6752426a2d7f00316ae887345fa75",
  "S4p.h5": "640cc97124ba1cc9e3af9e985ee73c246e8459bfb858e39faee2c2cffd0100ac",
  "S5.close": "a21bbf18307c07426cbea0f8f0954c5dc709cb7e999771c08e39442e5460f8a1",
  "S5.next": "5c5b8fdf43cfe59e2c1c93747e057a90e0ea01db184328f57a208ac78316605d",
  "S5.h5": "b4b6d6a38076e93efc9aa43cf0670849d798d36a9be0a24c10b5f010375cdb11",
  "S6.close": "e65d73c6581b5daeae11db539c61207f606ccb0d7d0e06d3f8bc44942f333798",
  "S6.next": "28f14cbaf63559fe43ced112e58b39e77f02e1e3753b9f681768eefd6063a23f",
  "S6.h5": "dcd5d790fbf1c5853e60103c462d6eba627a97380eb706bd0d51df5ec422801f",
  "S7.close": "1bd24ac40d5f5525abedb0360e8f65b15ad94c684652f8802db582047a949e79",
  "S7.next": "9677b729c6a90ae84c18d52b171ce2aa40609cb9e0ef03295c3fb6f341f6c997",
  "S7.h5": "b41107ae69d905e11821ef63c2e2511cdce33d9266d963e610b92be69ae1a361",
  "S8.close": "6d5500b3212c15a343d5d1eb62b803ce93ffde046aeabd29f3d19c8ddc34539d",
  "S8.next": "e764bc77631fc4de092814058ea666cc79d4586dd49a24429070d5fda3f20bee",
  "S8.h5": "c5dd87c2cba3bebb6b7e8b7ca0581b13440f26a0aa98985170e2a961cbd06c85",
  "S10.close": "f61dd367e0a219c4ee729417540643fefaf89a7263b4ad0b3f8788ce74c685a5",
  "S10.next": "ef2bec7032a674ccb8a3cabcee0f810e1ee955bc26a145ddbafecb8a633d3485",
  "S10.h5": "196078c5b4f5c670cf204664a173de32a1a9ee783f5140e9fbaa42d9a2d4b02b"
};

const reg = loadRegistry();

eq(validateRegistry(reg), [], "the committed registry validates");
eq(reg.signals.map((s) => s.id), [...SIGNAL_IDS], "ten signals, in the plan's order");
eq(reg.horizons.map((h) => h.id), [...HORIZON_IDS], "three horizons: to the close, the next close, five sessions");
eq(reg.tests.length, 30, "thirty tests, one per signal and horizon");
eq(new Set(reg.tests.map((t) => t.id)).size, 30, "each with its own id");
eq(reg.outcomesSeen, false, "committed before any outcome is seen");
eq(reg.targets, { version: TARGETS_VERSION, hash: targetsHash() }, "pinned to the table of canonical targets in force");
eq(reg.protocol, PROTOCOL, "the protocol is the five rules");
eq(reg.multiplicity.size, 30, "Benjamini-Hochberg runs across the thirty");
eq(reg.multiplicity.primary.test, "S1.next", "and Holm covers S1 at the next close");
eq(reg.signals.filter((s) => s.kind === "benchmark").map((s) => s.id), ["S7", "S8"], "the vendor's sweep rule and unusual preset are benchmarks");
eq(reg.signals.filter((s) => s.direction === "signed").map((s) => s.id), [...SIGNED_SIGNALS], "two signals carry a sign");

for (const t of reg.tests) {
  const signed = SIGNED_SIGNALS.includes(t.signal);
  for (const target of Object.values(t.target)) {
    ok(Object.hasOwn(TARGET_BY_ID, target) && TARGET_BY_ID[target].kind === "event", `${t.id}: ${target} is an event target of F-11`);
    ok(TARGET_BY_ID[target].source === "sigma_ref", `${t.id}: on the typical-day scale, never a model-owned sigma`);
  }
  eq(Object.keys(t.target).length, signed ? 2 : 1, `${t.id}: ${signed ? "an up and a down target" : "one two-sided target"}`);
  ok(t.series.live !== t.series.reconstructed && t.series.reconstructed.startsWith(t.signal + "r."), `${t.id}: its reconstruction is a series of its own`);
  eq(definitionHash(reg, t), PINNED[t.id], `${t.id}: the definition is the one registered; a change is a new id`);
}
eq(Object.keys(PINNED).sort(), reg.tests.map((t) => t.id).sort(), "every registered id is pinned and no pin is orphaned");

const mutants = [
  ["a result", (r) => { r.tests[0].pValue = 0.01; }, "never results"],
  ["outcomes seen", (r) => { r.outcomesSeen = true; }, "outcomesSeen"],
  ["a score", (r) => { r.signals[0].auc = 0.6; }, "never results"],
  ["a stale targets table", (r) => { r.targets.hash = "0".repeat(64); }, "targets"],
  ["a targets version", (r) => { r.targets.version = 2; }, "targets"],
  ["the window from the window start", (r) => { r.protocol.returnStartsAt = "window-start"; }, "protocol.returnStartsAt"],
  ["a fit that sees the test day", (r) => { r.protocol.fit = "includes-test-day"; }, "protocol.fit"],
  ["today's universe", (r) => { r.protocol.universe = "today"; }, "protocol.universe"],
  ["pooling", (r) => { r.protocol.pooling = "pooled"; }, "protocol.pooling"],
  ["flagged days only", (r) => { r.protocol.evaluationSample = "flagged-days-only"; }, "protocol.evaluationSample"],
  ["outcome-selected days", (r) => { r.protocol.evaluationSample = "outcome-selected-days-only"; }, "protocol.evaluationSample"],
  ["a new protocol rule", (r) => { r.protocol.extra = "x"; }, "protocol.extra"],
  ["an eleventh signal", (r) => { r.signals.push({ ...r.signals[0], id: "S11" }); }, "signals are"],
  ["a signal with no reconstruction", (r) => { r.signals[2].reconstructible = false; }, "reconstruction"],
  ["an unsigned S3", (r) => { r.signals[2].direction = "unsigned"; }, "S3: direction"],
  ["a missing test", (r) => { r.tests.pop(); }, "30 tests"],
  ["a duplicate test id", (r) => { r.tests[1].id = r.tests[0].id; }, "used twice"],
  ["a test id that is not signal.horizon", (r) => { r.tests[0].id = "S1.tomorrow"; }, "signal.horizon"],
  ["a made-up target", (r) => { r.tests[0].target.both = "move.k3.h2"; }, "not a target of F-11"],
  ["a fixed-percent target", (r) => { r.tests[0].target.both = "move.x10.h1"; }, "typical-day-scale"],
  ["the earnings target", (r) => { r.tests[0].target.both = "move.earn.im"; }, "typical-day-scale"],
  ["the wrong horizon's target", (r) => { r.tests[2].target.both = "move.k3.h1"; }, "target of h5 is"],
  ["a different multiple", (r) => { r.tests[0].k = 4; r.tests[0].target.both = "move.k4.h1"; }, "multiple is 3"],
  ["a two-sided target for a signed signal", (r) => { const t = r.tests.find((x) => x.id === "S3.next"); t.target = { both: "move.k3.h1" }; }, "S3.next"],
  ["a live series pooled with its reconstruction", (r) => { r.tests[0].series.reconstructed = r.tests[0].series.live; }, "never its reconstruction"],
  ["a reconstruction under the wrong name", (r) => { r.tests[0].series.reconstructed = "S2r.close"; }, "its reconstruction"],
  ["a different multiplicity", (r) => { r.multiplicity.q = 0.1; }, "multiplicity"],
  ["a family of the wrong size", (r) => { r.multiplicity.size = 29; }, "multiplicity"],
  ["a different primary", (r) => { r.multiplicity.primary.test = "S1.close"; }, "multiplicity.primary"],
  ["a primary outside S1", (r) => { r.multiplicity.primary.family = ["S2.close", "S2.next", "S2.h5"]; }, "multiplicity.primary"],
  ["trials not logged", (r) => { r.trials.logged = false; }, "trials"],
  ["a benchmark that is not", (r) => { r.signals[0].kind = "benchmark"; }, "benchmarks"],
  ["a horizon starting at the wrong place", (r) => { r.horizons[0].start = "issue close"; }, "close:"],
];
for (const [label, mutate, needle] of mutants) {
  const r = clone(reg);
  mutate(r);
  const problems = validateRegistry(r);
  ok(problems.length > 0 && problems.some((p) => p.includes(needle)), `MUTANT ${label}: caught (${problems.slice(0, 2).join(" | ")})`);
}
eq(validateRegistry(null).length, 1, "no registry at all is one problem");

{
  const changed = clone(reg);
  changed.tests[0].k = 3;
  changed.signals[0].input = changed.signals[0].input + " and more";
  ok(definitionHash(changed, changed.tests[0]) !== PINNED["S1.close"], "re-wording a signal's definition changes the hash of its tests");
  const w = clone(reg);
  w.horizons[0].window = "the next hour";
  ok(definitionHash(w, w.tests[0]) !== PINNED["S1.close"], "and so does a horizon's window");
  const p = clone(reg);
  p.protocol.fit = "includes-test-day";
  ok(definitionHash(p, p.tests[0]) !== PINNED["S1.close"], "and so does the protocol");
  eq(definitionHash(reg, reg.tests[1]) !== definitionHash(reg, reg.tests[0]), true, "different tests, different hashes");
}

{
  const ignored = readFileSync(path.join(ROOT, ".assetsignore"), "utf8").split(/\r?\n/);
  ok(ignored.includes("scripts/"), ".assetsignore keeps scripts/ out of the static bundle");
  const served = servedFiles();
  ok(!served.some((f) => f.startsWith("scripts/research/")), "no file of scripts/research is served");
  ok(!served.includes("scripts/research/flow-registry.json"), "least of all the registry");
}

const norm = (rng) => {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};
const Z95 = 1.6448536269514722;
const twoProp = (e1, n1, e0, n0) => {
  if (n1 === 0 || n0 === 0) return 0;
  const p = (e1 + e0) / (n1 + n0);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0));
  return se === 0 ? 0 : (e1 / n1 - e0 / n0) / se;
};
const tStat = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  return sd === 0 ? 0 : m / (sd / Math.sqrt(xs.length));
};
const choose = (name, value, allowed) => {
  if (!allowed.includes(value)) throw new Error(`${name} is ${allowed.join(" or ")}, not ${value}`);
  return value === allowed[0];
};

const scenarios = {
  returnStartsAt: {
    leaky: "window-start",
    run(rng, protocol) {
      const fromFlag = choose("returnStartsAt", protocol.returnStartsAt, ["flag-publication", "window-start"]);
      let n1 = 0, e1 = 0, n0 = 0, e0 = 0;
      for (let d = 0; d < 90; d++) {
        for (let i = 0; i < 30; i++) {
          const rA = Math.sqrt(0.6) * norm(rng);
          const rB = Math.sqrt(0.4) * norm(rng);
          const flag = rng() < 0.1 + 0.3 * Math.min(Math.abs(rA), 1.5) / 1.5;
          const event = fromFlag ? Math.abs(rB) >= 2 * Math.sqrt(0.4) : Math.abs(rA + rB) >= 2;
          if (flag) { n1++; e1 += event ? 1 : 0; } else { n0++; e0 += event ? 1 : 0; }
        }
      }
      return twoProp(e1, n1, e0, n0);
    },
  },
  fit: {
    leaky: "includes-test-day",
    run(rng, protocol) {
      const pastOnly = choose("fit", protocol.fit, ["past-only", "includes-test-day"]);
      const N = 30, D = 120, B = 5, burn = 30, p0 = 0.0455;
      const events = [], flags = [];
      for (let d = 0; d < D; d++) {
        events.push([]);
        flags.push([]);
        for (let i = 0; i < N; i++) { events[d].push(rng() < p0 ? 1 : 0); flags[d].push(rng() < 0.2 ? 1 : 0); }
      }
      const cellA = new Map(), cellB = new Map();
      const add = (map, key, e) => { const c = map.get(key) || [0, 0]; c[0] += e; c[1] += 1; map.set(key, c); };
      const rate = (map, key) => { const c = map.get(key) || [0, 0]; return (c[0] + p0) / (c[1] + 1); };
      const score = (e, p) => (e ? Math.log(p) : Math.log(1 - p));
      const keys = (d, i) => [`${i}|${flags[d][i]}|${d % B}`, `${i}|${d % B}`];
      if (!pastOnly) for (let d = 0; d < D; d++) for (let i = 0; i < N; i++) { const [a, b] = keys(d, i); add(cellA, a, events[d][i]); add(cellB, b, events[d][i]); }
      const gains = [];
      for (let d = 0; d < D; d++) {
        let g = 0;
        for (let i = 0; i < N; i++) { const [a, b] = keys(d, i); g += score(events[d][i], rate(cellA, a)) - score(events[d][i], rate(cellB, b)); }
        if (d >= burn) gains.push(g / N);
        if (pastOnly) for (let i = 0; i < N; i++) { const [a, b] = keys(d, i); add(cellA, a, events[d][i]); add(cellB, b, events[d][i]); }
      }
      return tStat(gains);
    },
  },
  universe: {
    leaky: "today",
    run(rng, protocol) {
      const asOf = choose("universe", protocol.universe, ["as-of-date", "today"]);
      const names = [];
      for (let i = 0; i < 60; i++) {
        const nm = { drift: i % 2 === 0 ? 0.3 : -0.3, cum: 0, calls: [] };
        for (let d = 0; d < 120; d++) {
          const r = nm.drift + norm(rng);
          nm.cum += r;
          const flagged = rng() < 0.5;
          const bullish = rng() < 0.85;
          nm.calls.push(flagged && bullish ? (r >= 2 ? 1 : r <= -2 ? -1 : 0) : 0);
        }
        names.push(nm);
      }
      let up = 0, down = 0;
      for (const nm of names) {
        if (!asOf && !(nm.cum > 0)) continue;
        for (const x of nm.calls) { if (x === 1) up++; else if (x === -1) down++; }
      }
      return up + down === 0 ? 0 : (up - down) / Math.sqrt(up + down);
    },
  },
  pooling: {
    leaky: "pooled",
    run(rng, protocol) {
      const separate = choose("pooling", protocol.pooling, ["never-live-with-reconstruction", "pooled"]);
      const regimes = [{ days: 70, flag: 0.35, vol: 1.5 }, { days: 40, flag: 0.08, vol: 1 }];
      const cells = regimes.map(() => ({ n1: 0, e1: 0, n0: 0, e0: 0 }));
      regimes.forEach((r, k) => {
        for (let d = 0; d < r.days; d++) {
          for (let i = 0; i < 30; i++) {
            const flag = rng() < r.flag;
            const event = Math.abs(r.vol * norm(rng)) >= 2;
            const c = cells[k];
            if (flag) { c.n1++; c.e1 += event ? 1 : 0; } else { c.n0++; c.e0 += event ? 1 : 0; }
          }
        }
      });
      if (!separate) {
        const s = cells.reduce((a, c) => ({ n1: a.n1 + c.n1, e1: a.e1 + c.e1, n0: a.n0 + c.n0, e0: a.e0 + c.e0 }), { n1: 0, e1: 0, n0: 0, e0: 0 });
        return twoProp(s.e1, s.n1, s.e0, s.n0);
      }
      return Math.max(...cells.map((c) => twoProp(c.e1, c.n1, c.e0, c.n0))) - (1.96 - Z95);
    },
  },
  outcomeSelected: {
    leaky: "outcome-selected-days-only",
    run(rng, protocol) {
      const all = choose("evaluationSample", protocol.evaluationSample, ["all-name-days-of-the-universe-as-of-each-date", "outcome-selected-days-only", "flagged-days-only"]);
      const p0 = 0.0455;
      const gains = [];
      for (let d = 0; d < 90; d++) {
        for (let i = 0; i < 30; i++) {
          const flag = rng() < 0.25;
          const event = rng() < p0;
          const pf = flag ? 1.5 * p0 : p0;
          if (!all && protocol.evaluationSample === "outcome-selected-days-only" && !event) continue;
          gains.push(event ? Math.log(pf / p0) : Math.log((1 - pf) / (1 - p0)));
        }
      }
      return tStat(gains);
    },
  },
  flaggedOnly: {
    leaky: "flagged-days-only",
    run(rng, protocol) {
      const all = choose("evaluationSample", protocol.evaluationSample, ["all-name-days-of-the-universe-as-of-each-date", "outcome-selected-days-only", "flagged-days-only"]);
      const design = 0.0455, actual = 0.08;
      let n1 = 0, e1 = 0, n0 = 0, e0 = 0;
      for (let d = 0; d < 90; d++) {
        for (let i = 0; i < 30; i++) {
          const flag = rng() < 0.25;
          const event = rng() < actual;
          if (flag) { n1++; e1 += event ? 1 : 0; } else { n0++; e0 += event ? 1 : 0; }
        }
      }
      if (protocol.evaluationSample === "flagged-days-only") return (e1 / n1 - design) / Math.sqrt(design * (1 - design) / n1);
      return all ? twoProp(e1, n1, e0, n0) : 0;
    },
  },
};

const REPLICATIONS = 300;
const rejects = (scenario, protocol, seed0) => {
  let k = 0;
  for (let r = 0; r < REPLICATIONS; r++) if (scenario.run(mulberry32(seed0 + r), protocol) > Z95) k++;
  return k / REPLICATIONS;
};
const FIELD = { returnStartsAt: "returnStartsAt", fit: "fit", universe: "universe", pooling: "pooling", outcomeSelected: "evaluationSample", flaggedOnly: "evaluationSample" };
const report = [];
let seed = 100000;
for (const [name, scenario] of Object.entries(scenarios)) {
  const field = FIELD[name];
  const correct = rejects(scenario, reg.protocol, seed);
  const leaky = rejects(scenario, { ...reg.protocol, [field]: scenario.leaky }, seed);
  seed += 1000;
  report.push(`${name}: registry protocol rejects ${(correct * 100).toFixed(1)}%, ${field}=${scenario.leaky} rejects ${(leaky * 100).toFixed(1)}%`);
  ok(correct <= 0.09, `${name}: the registered protocol holds its 5% on a null history (${correct})`);
  ok(leaky >= 0.9, `LEAK ${name}: ${field}=${scenario.leaky} produces a spurious positive on the same null history (${leaky})`);
  ok(reg.protocol[field] !== scenario.leaky, `${name}: the leak is not the registered rule`);
}
for (const line of report) console.log(line);

{
  const bad = { ...reg.protocol, fit: "sometimes" };
  let threw = false;
  try { scenarios.fit.run(mulberry32(1), bad); } catch { threw = true; }
  ok(threw, "an evaluator refuses a protocol value it does not know");
}

console.log(`flows-flow-registry: ${checks} checks`);
