#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { INTERVAL_DAYS, applySkillMastery, selectWeakestSkills } from "../shared/skill-mastery.js";
import { SKILL_IDS } from "../shared/skill-manifest.js";
import { COURSE_STAGE_BY_ID } from "../shared/stage-manifest.js";
import { PROJECT_BY_ID } from "../shared/project-manifest.js";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const json = (file) => JSON.parse(read(file));

assert.deepEqual([...INTERVAL_DAYS], [1, 3, 7, 21, 60]);
assert.equal(SKILL_IDS.length, 84);
assert.equal(Object.keys(COURSE_STAGE_BY_ID).length, 365);

let record = null;
for (const [index, expectedLevel, expectedDue] of [
  [1, 1, "2026-07-16"], [2, 2, "2026-07-19"], [3, 3, "2026-07-26"], [4, 4, "2026-08-16"], [5, 5, "2026-10-15"],
]) {
  const today = index === 1 ? "2026-07-15" : record.dueDay;
  record = applySkillMastery(record, { correct: true, hinted: false, today, attemptId: `clean-${index}` });
  assert.equal(record.level, expectedLevel); assert.equal(record.dueDay, expectedDue);
}
const hinted = applySkillMastery(record, { correct: true, hinted: true, today: record.dueDay, attemptId: "hinted" });
assert.equal(hinted.level, 5, "hinted answers must not advance or reduce skill mastery");
assert.equal(hinted.dueDay, "2026-10-16", "hinted answers must return the skill next day");
const incorrect = applySkillMastery(hinted, { correct: false, hinted: false, today: hinted.dueDay, attemptId: "wrong" });
assert.equal(incorrect.level, 4, "incorrect answers must reduce mastery by one");
assert.equal(incorrect.dueDay, "2026-10-17");

const browser = { window: {} };
vm.createContext(browser);
vm.runInContext(read("assets/js/skill-mastery.js"), browser);
assert.deepEqual(Array.from(browser.window.SkillMasteryScheduler.INTERVAL_DAYS), [...INTERVAL_DAYS]);
assert.deepEqual(JSON.parse(JSON.stringify(browser.window.SkillMasteryScheduler.apply(record, { correct: true, hinted: true, today: record.dueDay, attemptId: "hinted" }))), hinted);
const weak = selectWeakestSkills(SKILL_IDS.slice(0, 6), {
  [SKILL_IDS[0]]: { level: 4, dueDay: "2026-07-15", attempts: 8 },
  [SKILL_IDS[1]]: { level: 1, dueDay: "2026-07-15", attempts: 2 },
  [SKILL_IDS[2]]: { level: 0, dueDay: "2026-07-14", attempts: 1 },
  [SKILL_IDS[3]]: { level: 2, dueDay: "2026-08-01", attempts: 3 },
}, "2026-07-15", 3);
assert.deepEqual(weak, [SKILL_IDS[5], SKILL_IDS[4], SKILL_IDS[2]], "challenge must choose the weakest due or unseen skills deterministically");

const challenge = json("assets/data/challenge-bank.json");
assert.equal(challenge.schemaVersion, 1);
assert.equal(challenge.items.length, 252);
for (const skillId of SKILL_IDS) {
  const variants = challenge.items.filter((item) => item.skillId === skillId);
  assert.equal(variants.length, 3, `${skillId}: requires three assessment variants`);
  assert.deepEqual(variants.map((item) => item.variantId).sort(), ["v1", "v2", "v3"]);
}
const reviewCatalogue = read("assets/js/review-catalog.js");
assert(!/\b(answer|answers|accept)\s*:/.test(reviewCatalogue), "answer-free review catalogue leaked grading keys");

const graph = json("assets/data/skill-graph.json");
assert.equal(graph.skills.length, 84);
const graphIds = new Set(graph.skills.map((skill) => skill.id));
const visiting = new Set(), visited = new Set();
function visit(id) {
  if (visiting.has(id)) assert.fail(`cyclic skill graph at ${id}`);
  if (visited.has(id)) return;
  visiting.add(id);
  const skill = graph.skills.find((entry) => entry.id === id);
  assert(skill, `unknown skill graph node ${id}`);
  for (const prerequisite of skill.prerequisiteSkillIds) { assert(graphIds.has(prerequisite), `${id}: unknown prerequisite ${prerequisite}`); visit(prerequisite); }
  visiting.delete(id); visited.add(id);
}
for (const id of graphIds) visit(id);

const provenance = json("assets/data/projects/provenance.json");
assert.equal(provenance.datasets.length, 3);
for (const dataset of provenance.datasets) {
  assert.equal(dataset.synthetic, true);
  assert.equal(dataset.sourceObservationReuse, false);
  assert.equal(dataset.methodologyReferences.every((reference) => reference.verifiedFromPlan && /^https:\/\//.test(reference.url)), true);
  const content = read(dataset.file.slice(1));
  assert.equal(createHash("sha256").update(content).digest("hex"), dataset.sha256, `${dataset.id}: snapshot checksum drifted`);
  assert.equal(content.trim().split("\n").length - 1, dataset.rowCount);
  assert(PROJECT_BY_ID[dataset.id], `${dataset.id}: missing Worker project allowlist`);
}
const migration = read("migrations/0002_learning_v3.sql");
for (const table of ["progress_v3", "skill_mastery", "skill_attempts", "learning_preferences", "project_progress"]) assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
assert(!/\b(code|output|free_text|placement_answer)\b/i.test(migration), "D1 academy migration must not store code, outputs, free text, or placement answers");

// The migrations directory must bootstrap a fresh D1 to the same tables as
// schema.sql — the base tables live in 0001, the academy additions in 0002.
const tablesIn = (sql) => new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]));
const baseline = read("migrations/0001_baseline.sql");
for (const table of ["users", "progress", "stats", "learning_sync", "mastery", "mastery_attempts", "placement"]) assert(baseline.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `0001 baseline must create ${table}`);
const migrationTables = new Set([...tablesIn(baseline), ...tablesIn(migration)]);
const schemaTables = tablesIn(read("schema.sql"));
assert(migrationTables.size === schemaTables.size && [...schemaTables].every((t) => migrationTables.has(t)),
  "migrations/ (0001+0002) must create exactly the tables in schema.sql");

console.log("Academy contract OK: 12 courses, 365 stages, 84 skills, 252 challenge variants, 3 verified synthetic snapshots.");
