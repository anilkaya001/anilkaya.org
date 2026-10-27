import { readFileSync } from "node:fs";
import { loadMutated, ROOT } from "./truth/mutants.mjs";
import { recorder } from "./lib/ff-c-kit.mjs";
import { battery } from "./lib/ff-c-legs-battery.mjs";
import { FORBIDDEN } from "../shared/ff-contract.js";

const FILES = {
  metrics: "scripts/flows-legs/ff-metrics.mjs",
  carry: "scripts/flows-legs/ff-carry.mjs",
  section: "scripts/flows-nightly/sections/ff.mjs",
};

async function mods(plant = null) {
  const out = {};
  for (const [name, rel] of Object.entries(FILES)) {
    out[name] = await loadMutated(rel, plant && plant.target === name ? plant.transforms : [], { salt: plant ? 1 : 0 });
  }
  return out;
}

async function run(plant) {
  const R = recorder();
  try {
    await battery(await mods(plant), R, plant ? plant.only || ONLY[plant.target] : null);
  } catch (error) {
    R.fails.push("threw: " + (error && error.message ? error.message : error));
  }
  return R;
}

const ONLY = { metrics: ["emit", "syn", "request"], carry: ["carry"], section: ["section"] };

const P = (name, target, from, to, only = null) => ({ name, target, transforms: [[from, to]], only });

const PLANTS = [
  P("stale hist taken as fresh", "metrics", "if (hist.asOf !== session) {", "if (false) {"),
  P("z stored at the wrong scale", "metrics", "const q = scaledInt(value, this.metric.unit);", "const q = Math.round(value * 10);"),
  P("sector needs a single constituent", "metrics", "if (chosen.length < LIMITS.minConstituents) {", "if (chosen.length < 1) {"),
  P("sector baseline set of one day", "metrics", "export const SECTOR_SET_MIN_DAYS = 18;", "export const SECTOR_SET_MIN_DAYS = 1;"),
  P("clear at ten sessions", "metrics", "clear.put(i, ed.value > CLEAR_AHEAD ? 1 : 0);", "clear.put(i, ed.value >= CLEAR_AHEAD ? 1 : 0);"),
  P("thin counts either side", "metrics", "if (calls >= THIN_CONTRACTS && puts >= THIN_CONTRACTS)", "if (calls >= THIN_CONTRACTS || puts >= THIN_CONTRACTS)"),
  P("skew band removed", "metrics", "return { value: a > 0 && b <= -SKEW_BAND_PT ? 1 : 0, now: a, before: b };", "return { value: a > 0 && b <= 0 ? 1 : 0, now: a, before: b };"),
  P("skew sign flipped", "metrics", "const asPoints = (v) => Math.round(-v * 1000) / 10;", "const asPoints = (v) => Math.round(v * 1000) / 10;"),
  P("no byte cap", "metrics", "while (bytes > FF_METRICS_CAP && rows.length) {", "while (false) {"),
  P("grade zero facts accepted", "metrics", "if (!(fact.g >= 2)) return { reason: \"thin\" };", "if (!(fact.g >= 0)) return { reason: \"thin\" };"),
  P("redirects followed with the bearer", "metrics", "redirect: \"error\",", "redirect: \"follow\","),
  P("implied ratio inverted", "metrics", "return { value: implied / mean, n: moves.length };", "return { value: mean / implied, n: moves.length };"),
  P("iv change in fractions", "metrics", "iv1.put(i, times100(d.value));", "iv1.put(i, d.value);"),
  P("confirmation from the level not the change", "metrics", "Math.max(0, hit.currOi - hit.prevOi) / w.size", "Math.max(0, hit.currOi) / w.size"),
  P("negative confirmation kept", "metrics", "Math.min(1, Math.max(0, hit.currOi - hit.prevOi) / w.size)", "Math.min(1, (hit.currOi - hit.prevOi) / w.size)"),
  P("floor ignored", "metrics", "col.baseline(i, r.n, r.floored);", "col.baseline(i, r.n, false);"),
  P("baseline count dropped", "metrics", "if (this.n) this.n[i] = Number.isInteger(n) ? n : null;", "if (this.n) this.n[i] = null;"),
  P("not carded names read as zero", "metrics", "cols[id].miss(i, \"not_carded\");", "cols[id].put(i, 0);"),
  P("carry takes closing windows too", "carry", "r.opening === true &&", "r.opening !== false &&"),
  P("carry keeps every window", "carry", "const CARRY_ROWS = 180", "const CARRY_ROWS = 1800"),
  P("carry smallest first", "carry", "const byRank = (a, b) => b.prem - a.prem ||", "const byRank = (a, b) => a.prem - b.prem ||"),
  P("a same-night rerun confirms itself", "carry", "if (stored.sessionDate === session) {", "if (stored.sessionDate === session) {\n    return { windows: stored.windows, from: session, reason: null };"),
  P("old record confirmed against", "carry", "return none(stored.sessionDate > session ? \"same_session\" : \"stale\", stored.sessionDate);", "return { windows: stored.windows, from: stored.sessionDate, reason: null };"),
  P("prior never shed", "carry", "while (JSON.stringify(payload).length > FF_CARRY_CAP && priorRows.length) {", "while (false) {"),
  P("fixture leak swallowed", "section", "if (error && error.fixtureLeak) throw error;", "if (false) throw error;"),
  P("dry run asks the evaluator", "section", "if (metrics && !dry) {", "if (metrics) {"),
  P("switch inverted", "section", "!== \"off\"", "=== \"off\""),
  P("carry blocked by the metrics", "section", "alerts: store.flowalerts, carried", "alerts: metrics ? store.flowalerts : null, carried"),
  P("wrong cadence asked", "section", "cadence: \"nightly\" });\n      } catch", "cadence: \"live\" });\n      } catch"),
];

const real = await run(null);
if (real.fails.length) {
  for (const f of real.fails.slice(0, 25)) console.error("  FAIL " + f);
  console.error(`ff-c-legs: ${real.fails.length} of ${real.checks} checks failed on the real modules`);
  process.exit(1);
}
console.log(`ff-c-legs: ${real.checks} checks hold on the real modules`);

let survivors = [];
for (const plant of PLANTS) {
  const r = await run(plant);
  if (!r.fails.length) survivors.push(plant.name);
  else if (process.env.FF_C_VERBOSE) console.log(`  plant ${plant.name}: ${r.fails.length} fail, first ${r.fails[0]}`);
}
if (survivors.length) {
  console.error("ff-c-legs: planted wrong builds survived: " + survivors.join("; "));
  process.exit(1);
}
console.log(`ff-c-legs: ${PLANTS.length} planted wrong builds all fail`);

let scanFails = 0;
for (const rel of Object.values(FILES)) {
  const text = readFileSync(new URL("../" + rel, import.meta.url), "utf8");
  for (const f of FORBIDDEN.imports) {
    if (text.includes(f.replace(/^.*\//, ""))) {
      console.error(`  FAIL ${rel} names a forbidden module ${f}`);
      scanFails++;
    }
  }
  for (const tok of FORBIDDEN.sourceTokens) {
    if (text.includes(tok)) {
      console.error(`  FAIL ${rel} uses ${tok}`);
      scanFails++;
    }
  }
  if (/\/\/|\/\*/.test(text.replace(/https?:\/\/[^\s"']*/g, ""))) {
    console.error(`  FAIL ${rel} holds a comment`);
    scanFails++;
  }
  if (/\btape\b/i.test(text)) {
    console.error(`  FAIL ${rel} says the forbidden word`);
    scanFails++;
  }
  if (/UW_API_KEY|unusualwhales/i.test(text)) {
    console.error(`  FAIL ${rel} names the vendor key or host`);
    scanFails++;
  }
}
if (scanFails) process.exit(1);
console.log("ff-c-legs: source rules hold");
void ROOT;
