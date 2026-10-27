import { readFileSync } from "node:fs";
import { loadMutated } from "./truth/mutants.mjs";
import { recorder } from "./lib/ff-c-kit.mjs";
import { battery } from "./lib/ff-c-eval-battery.mjs";
import { FORBIDDEN } from "../shared/ff-contract.js";

const FILE = "server/ff-eval.js";

async function run(plant) {
  const R = recorder();
  try {
    const evalMod = await loadMutated(FILE, plant ? plant.transforms : [], { salt: plant ? 1 : 0 });
    await battery({ evalMod }, R, plant && plant.only ? plant.only : null);
  } catch (error) {
    R.fails.push("threw: " + (error && error.stack ? error.stack.split("\n").slice(0, 3).join(" ") : error));
  }
  return R;
}

const P = (name, from, to, only = null) => ({ name, transforms: [[from, to]], only });

const PLANTS = [
  P("call distance flipped", "((k - px) / px) * 100", "((px - k) / px) * 100"),
  P("days counted backwards", "daysBetween(day, row.exp)", "daysBetween(row.exp, day)"),
  P("legs integers read as values", "Number.isInteger(list[i]) ? unscaled(list[i], unit) : null", "Number.isInteger(list[i]) ? list[i] : null"),
  P("stored hits ignored", "const existingKeys = new Set(ctx.hits.map((h) => h.wire_id + \"|\" + h.dedupe_key));", "const existingKeys = new Set();"),
  P("wire caps not counted", "wire.set(r.wire_id, (wire.get(r.wire_id) || 0) + 1);", "wire.set(r.wire_id, (wire.get(r.wire_id) || 0));"),
  P("late cutoff closed", "const cutoff = cadence === \"nightly\" ? nightlyFinal(session) : at + DAY_MS;", "const cutoff = 0;"),
  P("least restrictive switch wins", "rank[r.state] > rank[state]", "rank[r.state] < rank[state]"),
  P("evaluator switch ignored", "if (evalSwitch === \"off\") return", "if (evalSwitch === \"never\") return"),
  P("shadow evaluates for real", "m === SWITCHES.master.shadow ? \"shadow\" : \"off\"", "m === SWITCHES.master.shadow ? \"on\" : \"off\""),
  P("receipts count refused hits", "return { ...r, hits: w, hits_capped: r.hits_capped + (k - w) };", "return { ...r, hits: k, hits_capped: r.hits_capped };"),
  P("market hours ignored", "marketPhase(at) !== \"open\"", "marketPhase(at) === \"never\""),
  P("done night flagged late", "if (run && run.status === \"done\") return { status: \"none\", session: expected, reason: \"ran\" };", ""),
  P("failed run called late", "const reason = run && run.status === \"failed\" ? \"run_failed\" : \"run_late\";", "const reason = \"run_late\";"),
  P("confirmation read as an integer", "cols[\"contract.oi_confirm\"] = unscaled(oic, \"ratio\");", "cols[\"contract.oi_confirm\"] = oic;"),
  P("house wires never seeded", "        await ensureHouse(env, at);\n", ""),
  P("a bad record stops the night", "if (!body) continue;", "if (!body) throw new Error(\"x\");"),
  P("running night flagged late", "if (run && run.status === \"running\" && run.lease_until && run.lease_until > at) return { status: \"none\", session: expected, reason: \"running\" };", ""),
  P("live ticks outside the session", "if (!session || marketPhase(at) !== \"open\")", "if (!session)"),
  P("first looks keyed by wire only", "m.set(r.wire_id + \"@\" + r.version, r.session);", "m.set(r.wire_id, r.session);"),
  P("closed run left running on failure", "await store.finishRun(env, id, { token: run.token, error: out.error || out.reason || out.status });", ""),
  P("paused wires evaluated", "WHERE w.layer = 'member' AND w.status = 'armed' AND v.cadence = ?", "WHERE w.layer = 'member' AND w.status <> 'retired' AND v.cadence = ?"),
  P("live tick takes the nightly cadence", "const out = await runWith(env, { cadence: \"live\", session, snapshot, at, run: null });", "const out = await runWith(env, { cadence: \"nightly\", session, snapshot, at, run: null });"),
  P("stale source accepted", "sources[\"live:alerts\"] = { session: day, asOf: readAt,", "sources[\"live:alerts\"] = { session: day, asOf: at0(),"),
];

const real = await run(null);
if (real.fails.length) {
  for (const f of real.fails.slice(0, 30)) console.error("  FAIL " + f);
  console.error(`ff-c-eval: ${real.fails.length} of ${real.checks} checks failed on the real module`);
  process.exit(1);
}
console.log(`ff-c-eval: ${real.checks} checks hold on the real module`);

const survivors = [];
const broken = [];
for (const plant of PLANTS) {
  let r;
  try {
    r = await run(plant);
  } catch (error) {
    broken.push(plant.name + ": " + error.message);
    continue;
  }
  if (r.fails.length && r.fails[0].startsWith("threw: Error: mutant did not apply")) broken.push(plant.name + ": " + r.fails[0]);
  else if (!r.fails.length) survivors.push(plant.name);
  else if (process.env.FF_C_VERBOSE) console.log(`  plant ${plant.name}: ${r.fails.length} fail, first ${r.fails[0]}`);
}
if (broken.length) {
  console.error("ff-c-eval: plants that did not apply: " + broken.join("; "));
  process.exit(1);
}
if (survivors.length) {
  console.error("ff-c-eval: planted wrong builds survived: " + survivors.join("; "));
  process.exit(1);
}
console.log(`ff-c-eval: ${PLANTS.length} planted wrong builds all fail`);

const text = readFileSync(new URL("../" + FILE, import.meta.url), "utf8");
let bad = 0;
for (const f of FORBIDDEN.imports) {
  if (text.includes(f.replace(/^.*\//, ""))) {
    console.error(`  FAIL ${FILE} names ${f}`);
    bad++;
  }
}
for (const tok of FORBIDDEN.sourceTokens) {
  if (text.includes(tok)) {
    console.error(`  FAIL ${FILE} uses ${tok}`);
    bad++;
  }
}
if (/\bfetch\s*\(/.test(text)) {
  console.error(`  FAIL ${FILE} calls fetch`);
  bad++;
}
if (/\/\/|\/\*/.test(text)) {
  console.error(`  FAIL ${FILE} holds a comment`);
  bad++;
}
if (/\btape\b|UW_API_KEY/i.test(text)) {
  console.error(`  FAIL ${FILE} names a forbidden word`);
  bad++;
}
const writes = [...text.matchAll(/"(INSERT|UPDATE|DELETE)[^"]*"/g)].map((m) => m[0]);
if (writes.some((w) => !/INSERT OR IGNORE INTO ff_wire/.test(w))) {
  console.error("  FAIL the evaluator writes through the store, its own SQL writes only the house seed");
  bad++;
}
if (/import\s[^;]*from\s+"\.\.\/(worker|scripts)/.test(text) || /cloudflare:/.test(text)) {
  console.error("  FAIL layer rule");
  bad++;
}
if (bad) process.exit(1);
console.log("ff-c-eval: source rules hold");
