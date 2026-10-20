import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as FI from "../shared/flows-fact-ids.js";
import * as QC from "../shared/flows-quant-card.js";
import * as N from "../shared/flows-neuron.js";
import { BUCKET_LINES } from "../shared/flows-quant-structures.js";
import { ENGINE_LABELS } from "../shared/flows-reading.js";
import { moduleSource, slice, expect, treeFiles } from "./lib/source-scan.mjs";
import { RETIRED_ENGINE_FACTS } from "../shared/flows-dossier.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, Array.isArray(a) && a.length && b.length === 0 ? m + "\n" + a.join("\n") : m); checks++; };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures-fact-ids.json"), "utf8"));

const registryOf = (ids, families) => ({ ids, families });
const REAL = registryOf(FI.FACT_IDS, FI.FACT_FAMILIES);

function lookup(reg, id) {
  if (typeof id !== "string") return null;
  if (Object.hasOwn(reg.ids, id)) return reg.ids[id];
  for (const prefix of Object.keys(reg.families)) if (id.startsWith(prefix) && id.length > prefix.length) return reg.families[prefix];
  return null;
}

const retiredOf = (entry) => entry && entry.retired !== undefined && entry.retired !== false;

function shapeProblems(reg) {
  const problems = [];
  const all = [...Object.entries(reg.ids), ...Object.entries(reg.families)];
  for (const [id, e] of all) {
    const at = `${id}:`;
    if (typeof e.meaning !== "string" || e.meaning.length < 20) problems.push(`${at} no meaning`);
    if (!QC.FACT_UNITS.includes(e.unit)) problems.push(`${at} unit ${e.unit} is not in the published enum`);
    if (!(e.tenor === null || (typeof e.tenor === "string" && e.tenor))) problems.push(`${at} tenor is a string or null`);
    if (typeof e.gradeRule !== "string" || e.gradeRule.length < 10) problems.push(`${at} no grade rule`);
    if (!/^\d{4}-\d\d-\d\d$/.test(e.since || "")) problems.push(`${at} since is a date`);
    if (e.claimLines !== undefined) {
      const c = e.claimLines;
      if (!(Number.isFinite(c.hi) && Number.isFinite(c.lo) && c.hi > c.lo && typeof c.strict === "boolean")) problems.push(`${at} claimLines is {hi, lo, strict} with hi above lo`);
      if (e.unit !== "frac") problems.push(`${at} claimLines on a ${e.unit}`);
    }
    if (retiredOf(e)) {
      const by = e.retired && typeof e.retired === "object" ? e.retired.by : undefined;
      if (!(e.retired && typeof e.retired === "object" && /^\d{4}-\d\d-\d\d$/.test(e.retired.since || "") && (by === null || (typeof by === "string" && lookup(reg, by) && !retiredOf(lookup(reg, by))))))
        problems.push(`${at} a retired id carries {since, by} and by is null or a live registered id`);
    }
    if (!Object.isFrozen(e)) problems.push(`${at} is not frozen`);
  }
  for (const f of Object.keys(reg.families)) if (!f.endsWith(".")) problems.push(`family ${f} must end in a dot`);
  return problems;
}

const literalsIn = (text) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const grab = (src, pattern, { min, group = 1, inner = false }) => {
  expect(src, pattern, { min, why: "a consumer scan must find its form" });
  const out = [];
  for (const m of src.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))) {
    if (inner) out.push(...literalsIn(m[group])); else out.push(m[group]);
  }
  return out;
};

function emitted() {
  const src = slice(moduleSource("shared/flows-quant-card.js"), "export function engineFacts(", "  return facts;\n}");
  const exact = grab(src, /\b(?:add|lvl)\(\s*"([^"+]+)"\s*,/, { min: 30 }).filter((id) => !id.endsWith("."));
  const prefixes = grab(src, /\b(?:add|lvl)\(\s*"([^"]+\.)"\s*\+/, { min: 2 });
  const run = QC.engineFacts({ built: [], spot: 100 }).map((f) => f.id);
  return { exact: [...new Set(exact)].sort(), prefixes: [...new Set(prefixes)].sort(), run: [...new Set(run)].sort() };
}

function consumers() {
  const out = [];
  const take = (where, ids) => { for (const id of ids) out.push({ where, id }); };
  const engine = moduleSource("shared/flows-quant-engine.js");
  take("flows-quant-engine facts[...]", grab(engine, /\bfacts\["([^"]+)"\]/, { min: 3 }));
  take("flows-quant-engine id ===", grab(engine, /\bx\.id === "([^"]+)"/, { min: 1 }));
  take("flows-quant-engine rule", grab(engine, /\brule: "(level\.[^"]+)"/, { min: 1 }));
  const structures = moduleSource("shared/flows-quant-structures.js");
  take("bucketsOf", grab(structures, /\bfactOf\(facts, "([^"]+)"\)/, { min: 4 }));
  take("structures from", grab(structures, /\bfrom: "(level\.[^"]+)"/, { min: 2 }));
  take("flows-quant-card fm[...]", grab(moduleSource("shared/flows-quant-card.js"), /\bfm\["([^"]+)"\]/, { min: 1 }));
  take("flows-premium id ===", grab(moduleSource("shared/flows-premium.js"), /\bx\.id === "([^"]+)"/, { min: 1 }));
  const neuron = moduleSource("shared/flows-neuron.js");
  take("neuron val()", grab(neuron, /\bval\(m, ([^)]*)\)/, { min: 5, inner: true }));
  take("neuron g()", grab(neuron, /\bg\("([^"]+)"\)/, { min: 1 }));
  take("neuron nearLevel", grab(neuron, /\bnearLevel\(eng, st, \[([^\]]*)\]\)/, { min: 1, inner: true }));
  take("neuron becauseOf", grab(neuron, /\bfor \(const id of \[([^\]]*)\]\)/, { min: 1, inner: true }));
  take("neuron STATE_FACT", grab(neuron, /\bSTATE_FACT = Object\.freeze\(\{([^}]*)\}\)/, { min: 1, inner: true }));
  take("neuron RULE_FACT", Object.values(N.RULE_FACT));
  take("neuron CLAIM_LINES", Object.keys(N.CLAIM_LINES));
  const reading = moduleSource("shared/flows-reading.js");
  take("reading options.engine.", grab(reading, /\boptions\.engine\.([A-Za-z0-9_.]*[A-Za-z0-9])/, { min: 8 }));
  take("reading ENGINE_LABELS", Object.keys(ENGINE_LABELS));
  return out;
}

function audit(reg, em, cons, snapshot) {
  const problems = [...shapeProblems(reg)];
  const seen = new Set(em.exact.concat(em.run));
  for (const id of seen) {
    const e = lookup(reg, id);
    if (!e) problems.push(`emitted id ${id} is not registered`);
    else if (retiredOf(e)) problems.push(`emitted id ${id} is retired`);
  }
  for (const prefix of em.prefixes) {
    const any = Object.keys(reg.ids).some((id) => id.startsWith(prefix)) || Object.hasOwn(reg.families, prefix);
    if (!any) problems.push(`emitted family ${prefix}* is not registered`);
    for (const id of em.run.filter((x) => x.startsWith(prefix))) if (!lookup(reg, id)) problems.push(`emitted id ${id} is not registered`);
  }
  for (const id of Object.keys(reg.ids)) {
    if (retiredOf(reg.ids[id])) continue;
    const covered = seen.has(id) || em.prefixes.some((p) => id.startsWith(p) && em.run.includes(id));
    if (!covered) problems.push(`registered id ${id} is emitted nowhere`);
  }
  for (const f of Object.keys(reg.families)) if (!em.prefixes.includes(f)) problems.push(`registered family ${f}* is emitted nowhere`);
  for (const { where, id } of cons) {
    const e = lookup(reg, id);
    if (!e) problems.push(`${where} reads ${id}, which is not registered`);
    else if (retiredOf(e)) problems.push(`${where} reads ${id}, which is retired`);
  }
  const snapIds = Object.keys(snapshot);
  for (const id of snapIds) {
    const e = Object.hasOwn(reg.ids, id) ? reg.ids[id] : Object.hasOwn(reg.families, id) ? reg.families[id] : null;
    const s = snapshot[id];
    if (!e) { problems.push(`snapshot id ${id} is missing from the registry: an id is retired, never removed`); continue; }
    for (const k of ["meaning", "unit", "tenor", "since"]) {
      if (e[k] !== s[k]) problems.push(`${id}.${k} differs from the snapshot: a meaning never changes under its id, so retire ${id} and register a new id`);
    }
    if (JSON.stringify(e.claimLines || null) !== JSON.stringify(s.claimLines || null)) problems.push(`${id}.claimLines differs from the snapshot`);
    if (retiredOf(e) !== (s.retired === true)) problems.push(`${id} retired flag differs from the snapshot`);
  }
  for (const id of Object.keys(reg.ids)) if (!Object.hasOwn(snapshot, id)) problems.push(`${id} is registered and absent from the snapshot`);
  for (const f of Object.keys(reg.families)) if (!Object.hasOwn(snapshot, f)) problems.push(`family ${f} is registered and absent from the snapshot`);
  return problems;
}

const mutate = (reg, fn) => {
  const ids = JSON.parse(JSON.stringify(reg.ids));
  const families = JSON.parse(JSON.stringify(reg.families));
  fn({ ids, families });
  for (const e of [...Object.values(ids), ...Object.values(families)]) Object.freeze(e);
  return registryOf(ids, families);
};

const em = emitted();
const cons = consumers();
const snapshotKey = (reg) => {
  const out = {};
  for (const [id, e] of [...Object.entries(reg.ids), ...Object.entries(reg.families)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    out[id] = { meaning: e.meaning, unit: e.unit, tenor: e.tenor, since: e.since, claimLines: e.claimLines || null, retired: retiredOf(e) };
  }
  return out;
};
const withSnap = (s) => Object.fromEntries(Object.entries(s).map(([id, v]) => [id, { ...v, claimLines: v.claimLines || null }]));

{
  ok(Object.isFrozen(FI.FACT_IDS) && Object.isFrozen(FI.FACT_FAMILIES) && Object.values(FI.FACT_IDS).every(Object.isFrozen), "THE REGISTRY IS FROZEN, entry by entry");
  same(shapeProblems(REAL), [], "every entry carries a meaning, a unit from the published enum, a tenor or null, a grade rule and a since date");
  ok(Object.keys(FI.FACT_IDS).length >= 37, "and covers the engine's " + Object.keys(FI.FACT_IDS).length + " exact ids");
  eq(FI.factEntry("iv.pctile.30.1y"), FI.FACT_IDS["iv.pctile.30.1y"], "factEntry finds an exact id");
  eq(FI.factEntry("move.mad.2026-10-16"), FI.FACT_FAMILIES["move.mad."], "and a family member by its prefix");
  eq(FI.factEntry("move.mad."), null, "a family prefix alone is no id");
  eq(FI.factEntry("iv.pct.31"), null, "and an unregistered id is null");
}

{
  ok(em.exact.length >= 30, "EMISSION: the source of engineFacts names " + em.exact.length + " literal ids");
  same(em.prefixes, ["iv.cm.", "move.mad."], "and two built ids (the constant maturities and the priced move to an expiry)");
  ok(["iv.cm.7", "iv.cm.30", "iv.cm.90"].every((id) => em.run.includes(id)), "a run with no chain emits the three constant maturities");
  same(audit(REAL, em, cons, withSnap(SNAPSHOT)), [], "EVERY ID ENGINEFACTS EMITS IS REGISTERED, every registered id is emitted, no consumer reads an unregistered or retired id, and the registry equals the committed snapshot");
}

{
  ok(cons.length >= 60, "CONSUMERS: " + cons.length + " reads of an engine id were found across the engine, the structures, the card, the Neuron and the reading");
  const where = new Set(cons.map((c) => c.where));
  for (const w of ["bucketsOf", "neuron val()", "neuron RULE_FACT", "neuron STATE_FACT", "reading ENGINE_LABELS", "reading options.engine.", "flows-quant-engine facts[...]"]) ok(where.has(w), w + " is scanned");
  ok(cons.some((c) => c.id === "iv.pctile.30.1y" && c.where === "bucketsOf") && cons.some((c) => c.id === "iv.pctile.30.1y" && c.where === "neuron RULE_FACT"),
    "the IV axis is read from the percentile id by the bucket and by the rule table");
}

{
  eq(N.CLAIM_LINES, FI.CLAIM_LINES, "THE CLAIM LINES: the Neuron's table is the registry's, not a copy");
  same(Object.keys(FI.CLAIM_LINES).sort(), ["iv.pctile.30.1y", "iv.rank.1y", "skew.rr25.30.pct"], "three live ids carry claim lines, and the retired iv.pct.30 does not though its entry still holds the lines it had");
  ok(["iv.pctile.30.1y", "iv.rank.1y"].every((id) => FI.CLAIM_LINES[id].hi === BUCKET_LINES.IV_HIGH && FI.CLAIM_LINES[id].lo === BUCKET_LINES.IV_LOW && FI.CLAIM_LINES[id].strict === true),
    "the IV ids use the bucket lines 0.25 and 0.75, strictly");
  ok(FI.CLAIM_LINES["skew.rr25.30.pct"].hi === BUCKET_LINES.SKEW_STEEP && FI.CLAIM_LINES["skew.rr25.30.pct"].lo === BUCKET_LINES.SKEW_FLAT && FI.CLAIM_LINES["skew.rr25.30.pct"].strict === false,
    "and the skew id 0.2 and 0.8, inclusively");
  ok(/rank/.test(FI.FACT_IDS["iv.pct.30"].meaning) && /not a percentile/.test(FI.FACT_IDS["iv.pct.30"].meaning), "iv.pct.30 says in its own entry that it was a rank under a percentile-looking id");
}

{
  const meaningChanged = mutate(REAL, (r) => { r.ids["iv.pct.30"].meaning = "A true percentile of the thirty-day implied volatility over one year."; });
  ok(audit(meaningChanged, em, cons, withSnap(SNAPSHOT)).some((p) => /iv\.pct\.30\.meaning differs from the snapshot.*retire iv\.pct\.30 and register a new id/.test(p)),
    "A CHANGED MEANING UNDER THE SAME ID IS CAUGHT by the snapshot, and the message says to retire the id and register a new one");
  const unitChanged = mutate(REAL, (r) => { r.ids["gex.book"].unit = "usd"; });
  ok(audit(unitChanged, em, cons, withSnap(SNAPSHOT)).some((p) => /gex\.book\.unit differs/.test(p)), "a changed unit is caught the same way");
  const tenorChanged = mutate(REAL, (r) => { r.ids["term.slope.30_90"].tenor = "30 to 180 days"; });
  ok(audit(tenorChanged, em, cons, withSnap(SNAPSHOT)).some((p) => /term\.slope\.30_90\.tenor differs/.test(p)), "and a changed tenor");
  const linesChanged = mutate(REAL, (r) => { r.ids["iv.pctile.30.1y"].claimLines.hi = 0.8; });
  ok(audit(linesChanged, em, cons, withSnap(SNAPSHOT)).some((p) => /iv\.pctile\.30\.1y\.claimLines differs/.test(p)), "and a changed claim line");
  const dropped = mutate(REAL, (r) => { delete r.ids["iv.rank.1y"]; });
  const droppedProblems = audit(dropped, em, cons, withSnap(SNAPSHOT));
  ok(droppedProblems.some((p) => /emitted id iv\.rank\.1y is not registered/.test(p)) && droppedProblems.some((p) => /snapshot id iv\.rank\.1y is missing.*never removed/.test(p)),
    "A DROPPED ID IS CAUGHT twice: the engine still emits it and the snapshot still names it");
  const droppedRetired = mutate(REAL, (r) => { delete r.ids["iv.pct.30"]; });
  ok(audit(droppedRetired, em, cons, withSnap(SNAPSHOT)).some((p) => /snapshot id iv\.pct\.30 is missing.*never removed/.test(p)), "and a retired id is never removed from the registry either: the snapshot still names it");
  const phantom = mutate(REAL, (r) => { r.ids["iv.ghost.30"] = { ...r.ids["iv.cm.30"] }; });
  ok(audit(phantom, em, cons, withSnap(SNAPSHOT)).some((p) => /registered id iv\.ghost\.30 is emitted nowhere/.test(p)), "a registered id nothing emits is caught");
  const retired = mutate(REAL, (r) => { r.ids["iv.rank.1y"].retired = { since: "2026-10-12", by: "iv.pctile.30.1y" }; });
  const retiredProblems = audit(retired, em, cons, withSnap(SNAPSHOT));
  ok(retiredProblems.some((p) => /emitted id iv\.rank\.1y is retired/.test(p)), "A RETIRED ID THE ENGINE STILL EMITS is caught");
  ok(retiredProblems.some((p) => /reading ENGINE_LABELS reads iv\.rank\.1y, which is retired/.test(p)) && retiredProblems.some((p) => /neuron CLAIM_LINES reads iv\.rank\.1y, which is retired/.test(p)),
    "and so is every consumer that still reads it");
  ok(retiredProblems.some((p) => /iv\.rank\.1y retired flag differs from the snapshot/.test(p)), "and the retirement must be written into the snapshot too");
  const badBy = mutate(REAL, (r) => { r.ids["iv.pct.30"].retired = { since: "2026-10-12", by: "iv.nowhere" }; });
  ok(shapeProblems(badBy).some((p) => /retired id carries/.test(p)), "a retirement names a live successor or null");
  const noEmit = emitted();
  const stripped = { ...noEmit, exact: noEmit.exact.filter((id) => id !== "iv.rank.1y"), run: noEmit.run.filter((id) => id !== "iv.rank.1y") };
  const wasRetiredOk = audit(retired, stripped, cons.filter((c) => c.id !== "iv.rank.1y"), withSnap({ ...SNAPSHOT, "iv.rank.1y": { ...SNAPSHOT["iv.rank.1y"], retired: true } }));
  same(wasRetiredOk, [], "a retired id that nothing emits and nothing reads, recorded in the snapshot, passes");
  const unretired = mutate(REAL, (r) => { delete r.ids["iv.pct.30"].retired; });
  const unretiredProblems = audit(unretired, em, cons, withSnap(SNAPSHOT));
  ok(unretiredProblems.some((p) => /registered id iv\.pct\.30 is emitted nowhere/.test(p)) && unretiredProblems.some((p) => /iv\.pct\.30 retired flag differs from the snapshot/.test(p)),
    "P1-41: reviving iv.pct.30 is caught: nothing emits it and the snapshot records it retired");
  const unknownReader = [...cons, { where: "a new reader", id: "iv.rank.5y" }];
  ok(audit(REAL, em, unknownReader, withSnap(SNAPSHOT)).some((p) => /a new reader reads iv\.rank\.5y, which is not registered/.test(p)), "A CONSUMER OF AN UNREGISTERED ID IS CAUGHT");
  const unregisteredEmit = { ...em, exact: [...em.exact, "iv.new.30"] };
  ok(audit(REAL, unregisteredEmit, cons, withSnap(SNAPSHOT)).some((p) => /emitted id iv\.new\.30 is not registered/.test(p)), "and an emitted id nobody registered");
}

{
  const entry = FI.FACT_IDS["iv.pct.30"];
  same(entry.retired, { since: "2026-10-11", by: "iv.pctile.30.1y" }, "P1-41: iv.pct.30 is retired in the registry, by the percentile, and its entry stays: an id is retired, never removed");
  same(FI.retiredIds(), ["iv.pct.30"], "it is the one retired id");
  ok(!em.exact.includes("iv.pct.30") && !em.run.includes("iv.pct.30"), "engineFacts neither names nor emits it");
  ok(!cons.some((c) => c.id === "iv.pct.30"), "and no consumer of an engine id reads it");
  ok(!Object.hasOwn(FI.CLAIM_LINES, "iv.pct.30") && !Object.hasOwn(N.CLAIM_LINES, "iv.pct.30") && !Object.hasOwn(ENGINE_LABELS, "iv.pct.30"), "it holds no claim line and no label");
  same([...RETIRED_ENGINE_FACTS], [...FI.retiredIds()], "the dossier's list of engine facts it drops from a stored card is the registry's retired set");
  const SCAN = ["shared", "server", "scripts", "assets/js", "assets/data"];
  const files = [...SCAN.flatMap((d) => treeFiles(d)), "worker.js"].filter((f) => !/\.bundle\.js$/.test(f));
  expect(files.join("\n"), /shared\/flows-quant-card\.js/, { min: 1, why: "the scan reaches the card" });
  const hits = files.filter((f) => /\biv\.pct\.30\b/.test(moduleSource(f)));
  same(hits.sort(), ["shared/flows-dossier.js", "shared/flows-fact-ids.js"], "A GREP FINDS NO iv.pct.30 in the Worker, the pipeline or the browser except the registry entry that retired it and the dossier's drop list");
  const codeHits = files.filter((f) => /rank-as-pct/.test(moduleSource(f)));
  same(codeHits, [], "and the code that marked it a rank is gone with it");
}

{
  same(snapshotKey(REAL), withSnap(SNAPSHOT), "THE SNAPSHOT is the registry's meaning, unit, tenor, since, claim lines and retired flag for every id");
  same(Object.keys(SNAPSHOT), Object.keys(SNAPSHOT).slice().sort(), "kept sorted so a review diff shows only added entries or a retired flag");
  ok(Object.keys(SNAPSHOT).every((id) => Object.keys(SNAPSHOT[id]).join() === "meaning,unit,tenor,since,claimLines,retired"), "each entry in the one key order");
}

console.log(`✓ flows-fact-ids: ${checks} assertions - the engine's fact-id registry (meaning, unit, tenor, grade rule, claim lines, since, retired), every id engineFacts emits registered and every registered id emitted, ${cons.length} reads of an engine id by the engine, the structures, the card, the Neuron and the reading resolving to a live entry, the claim-line table the Neuron reads, and a committed snapshot that fails a meaning, unit, tenor or claim line changed under the same id`);
