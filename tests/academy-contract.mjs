#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import { INTERVAL_DAYS, applySkillMastery, selectWeakestSkills } from "../shared/skill-mastery.js";
import { SKILL_IDS } from "../shared/skill-manifest.js";
import { COURSE_STAGE_BY_ID } from "../shared/stage-manifest.js";
import { PROJECT_BY_ID } from "../shared/project-manifest.js";
import * as FLOWS_LIVE from "../shared/flows-live-worker.js";
import { FLOWS_REGISTRY, FLOWS_SCHEMA_SQL, upgradeColumns, upgradeTables, addedOf } from "../server/schema.js";
import * as FLOWS_DOSSIER from "../shared/flows-dossier-worker.js";
import { SIGNED_IN_COLUMN_SQL } from "../shared/lab-sign-in.js";

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

const baseline = read("migrations/0001_baseline.sql");
for (const table of ["users", "progress", "stats", "learning_sync", "mastery", "mastery_attempts", "placement"]) assert(baseline.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `0001 baseline must create ${table}`);
const marketMigration = read("migrations/0004_market_snapshot.sql");
assert(marketMigration.includes("CREATE TABLE IF NOT EXISTS market_snapshot"), "0004 must create market_snapshot");
const flowsMigration = read("migrations/0005_flows.sql");
for (const table of ["flows_payload", "flows_login_failures"]) {
  assert(flowsMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `0005 must create ${table}`);
}

assert(!/\b(password|passwd|hash|secret|pepper|token)\b/i.test(flowsMigration),
  "Flows migration must not store credential material in D1");
const liveMigration = read("migrations/0010_flows_live.sql");
for (const table of ["flows_live", "flows_tape", "flows_clock"]) {
  assert(liveMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `0010 must create ${table}`);
}
assert(!/\b(password|passwd|hash|secret|pepper|token)\b/i.test(liveMigration),
  "the live-layer migration must not store credential material in D1");
const ledgerMigration = read("migrations/0015_flows_ledger.sql");
assert(ledgerMigration.includes("CREATE TABLE IF NOT EXISTS flows_ledger"), "0015 must create flows_ledger");
assert(!/\b(password|passwd|hash|secret|pepper|token)\b/i.test(ledgerMigration),
  "the ledger migration must not store credential material in D1");
const dossierMigration = read("migrations/0016_flows_dossier_cache.sql");
assert(dossierMigration.includes("CREATE TABLE IF NOT EXISTS flows_dossier_cache"), "0016 must create flows_dossier_cache");
assert(!/\b(password|passwd|hash|secret|pepper|token)\b/i.test(dossierMigration),
  "the dossier cache migration must not store credential material in D1");
const sqlPunctuation = "(),=<>!|+-*/;";
const sqlText = (sql) => {
  let out = "";
  let quote = null;
  let space = false;
  for (const c of sql) {
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (/\s/.test(c)) { space = true; continue; }
    if (space && out && !sqlPunctuation.includes(out[out.length - 1]) && !sqlPunctuation.includes(c)) out += " ";
    space = false;
    if (c === "'" || c === "\"") quote = c;
    out += c.toLowerCase();
  }
  return out;
};
const ddlInitializer = (src, start) => {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
    } else if (c === "\"" || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === ";" && depth === 0) return src.slice(start, i);
  }
  throw new Error("unterminated initializer at " + start);
};
const ddlKinds = "\\bCREATE\\s+(?:(?:UNIQUE|TEMP|TEMPORARY|VIRTUAL)\\s+)?(?:TABLE|INDEX|TRIGGER|VIEW)";
const ddlPattern = new RegExp(`${ddlKinds}\\b|\\bDROP\\s+(?:TABLE|INDEX|TRIGGER|VIEW)\\b`, "gi");
const outsideSpans = (src, spans) => [...src.matchAll(ddlPattern)]
  .filter((m) => !spans.some(([from, to]) => m.index >= from && m.index < to))
  .map((m) => `${src.slice(0, m.index).split("\n").length}: ${src.slice(m.index, m.index + 60)}`);
const workerSource = read("worker.js");
const workerDdl = [];
const workerDdlSpans = [];
for (const m of workerSource.matchAll(/^const \w+ =(?=\s*(?:Object\.freeze\(\s*)?\[?\s*"CREATE )/gm)) {
  const init = ddlInitializer(workerSource, m.index + m[0].length);
  workerDdlSpans.push([m.index, m.index + m[0].length + init.length]);
  const value = new Function("FLOWS_LIVE", "FLOWS_DOSSIER", `return (${init});`)(FLOWS_LIVE, FLOWS_DOSSIER);
  workerDdl.push(...[value].flat());
}
assert.deepEqual(outsideSpans(workerSource, workerDdlSpans), [],
  "worker.js declares DDL only in the top-level constants this check evaluates");
const schemaSource = read("server/schema.js");
const schemaDdl = [];
const schemaDdlSpans = [];
for (const m of schemaSource.matchAll(/^const \w+ =(?=\s*"CREATE )/gm)) {
  const init = ddlInitializer(schemaSource, m.index + m[0].length);
  schemaDdlSpans.push([m.index, m.index + m[0].length + init.length]);
  schemaDdl.push(new Function(`return (${init});`)());
}
assert.deepEqual(outsideSpans(schemaSource, schemaDdlSpans), [],
  "server/schema.js declares DDL only in the top-level constants this check evaluates");
assert.deepEqual(schemaDdl.filter((sql) => !FLOWS_SCHEMA_SQL.includes(sql)), [],
  "every table server/schema.js declares is in the registry the Worker's first-use batch is derived from");
assert.deepEqual(FLOWS_REGISTRY.map((entry) => entry.ddl), [...FLOWS_SCHEMA_SQL],
  "and the first-use batch is the registry's DDL in registry order");
workerDdl.unshift(...FLOWS_SCHEMA_SQL);
const runtimeStatements = new Set(workerDdl);
for (const file of readdirSync(new URL("shared/", root)).filter((f) => f.endsWith(".js")).sort()) {
  const src = read(`shared/${file}`);
  if (!ddlPattern.test(src)) continue;
  ddlPattern.lastIndex = 0;
  const mod = await import(new URL(`shared/${file}`, root));
  const spans = [];
  for (const m of src.matchAll(/^export const (\w+) =(?=\s*(?:Object\.freeze\(\s*)?\[?\s*(?:"CREATE |\w+_SQL\b))/gm)) {
    const init = ddlInitializer(src, m.index + m[0].length);
    spans.push([m.index, m.index + m[0].length + init.length]);
    const statements = [mod[m[1]]].flat();
    assert.deepEqual(statements.filter((sql) => !runtimeStatements.has(sql)), [],
      `shared/${file}: every statement of ${m[1]} is in the runtime DDL this check builds`);
  }
  assert.deepEqual(outsideSpans(src, spans), [],
    `shared/${file} declares DDL only in exported constants whose statements reach the runtime DDL this check builds`);
}
const sqliteOf = (statements) => {
  const db = new DatabaseSync(":memory:");
  for (const sql of statements) db.exec(sql);
  return db;
};
const d1Of = (db) => ({
  prepare: (sql) => ({
    all: async () => ({ results: db.prepare(sql).all() }),
    run: async () => { db.exec(sql); return { success: true }; },
  }),
});
const balancedEnd = (sql, from) => {
  let depth = 1;
  let quote = null;
  let i = from;
  for (; depth && i < sql.length; i += 1) {
    const c = sql[i];
    if (quote) { if (c === quote) quote = null; }
    else if (c === "'" || c === "\"") quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
  }
  return i;
};
const checkClauses = (sql) => [...sql.matchAll(/\bCHECK\s*\(/gi)]
  .map((m) => sqlText(sql.slice(m.index, balancedEnd(sql, m.index + m[0].length)))).sort();
const columnSegments = (sql) => {
  const open = sql.indexOf("(");
  const body = sql.slice(open + 1, balancedEnd(sql, open + 1) - 1);
  const segments = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) { if (c === quote) quote = null; }
    else if (c === "'" || c === "\"") quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) { segments.push(body.slice(start, i).trim()); start = i + 1; }
  }
  segments.push(body.slice(start).trim());
  return segments.filter((seg) => !/^(?:CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i.test(seg));
};
const describeDb = (db) => {
  const objects = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' " +
    "UNION ALL SELECT type, name, tbl_name, sql FROM sqlite_temp_master WHERE name NOT LIKE 'sqlite_%'").all();
  const tables = {};
  for (const { name } of objects.filter((o) => o.type === "table")) {
    const shape = db.prepare(`PRAGMA table_list(${name})`).get();
    const unique = db.prepare(`PRAGMA index_list(${name})`).all().filter((i) => i.origin === "u")
      .map((i) => db.prepare(`PRAGMA index_info(${i.name})`).all().map((c) => c.name).join(",")).sort();
    const sql = objects.find((o) => o.type === "table" && o.name === name).sql;
    const collations = Object.fromEntries(columnSegments(sql).map((seg) => [seg.match(/^["`\[]?(\w+)/)[1], (seg.match(/\bCOLLATE\s+(\w+)/i) || [, "binary"])[1].toLowerCase()]));
    tables[name] = {
      withoutRowid: shape.wr, strict: shape.strict, unique, checks: checkClauses(sql),
      columns: Object.fromEntries(db.prepare(`PRAGMA table_info(${name})`).all()
        .map((c) => [c.name, `${c.type} notnull=${c.notnull} default=${c.dflt_value} pk=${c.pk} collate=${collations[c.name]}`])),
    };
  }
  const named = (type) => Object.fromEntries(objects.filter((o) => o.type === type && o.sql).map((o) => [o.name, `${o.tbl_name}: ${sqlText(o.sql)}`]));
  return { tables, indexes: named("index"), triggers: named("trigger"), views: named("view") };
};
const migrationFiles = readdirSync(new URL("migrations/", root)).sort();
assert.deepEqual(migrationFiles.filter((f) => !/^\d{4}_\w+\.sql$/.test(f)), [], "every file in migrations/ is a NNNN_name.sql migration");
assert.equal(new Set(migrationFiles.map((f) => f.slice(0, 4))).size, migrationFiles.length, "no two migrations share a number");
assert(migrationFiles.length >= 16 && migrationFiles[0] === "0001_baseline.sql", "the migrations directory is read in full, in number order");
for (const file of migrationFiles) {
  assert(!/\b(password|passwd|hash|secret|pepper|token)\b/i.test(read(`migrations/${file}`)),
    `migrations/${file} must not store credential material in D1`);
}
const fromSchema = describeDb(sqliteOf([read("schema.sql")]));
const fromMigrations = describeDb(sqliteOf(migrationFiles.map((f) => read(`migrations/${f}`))));
assert.deepEqual(fromMigrations, fromSchema,
  "SCHEMA PARITY: a database built from schema.sql and one built from every migration in number order hold the same tables, " +
  "the same columns by name (type, NOT NULL, default, key position), the same unique constraints, WITHOUT ROWID and STRICT flags, " +
  "and the same indexes, triggers and views");
const runtimeDb = sqliteOf(workerDdl);
for (const table of upgradeTables(FLOWS_REGISTRY)) await upgradeColumns(d1Of(runtimeDb), table, addedOf(FLOWS_REGISTRY, table));
const fromRuntime = describeDb(runtimeDb);
const runtimeSources = [workerSource, schemaSource, ...readdirSync(new URL("shared/", root)).filter((f) => f.endsWith(".js")).map((f) => read(`shared/${f}`))];
const declaredAtRuntime = new Set(runtimeSources.flatMap((src) => [...src.matchAll(new RegExp(`${ddlKinds}\\s+IF\\s+NOT\\s+EXISTS\\s+(\\w+)`, "gi"))].map((m) => m[1])));
const builtAtRuntime = new Set([...Object.keys(fromRuntime.tables), ...Object.keys(fromRuntime.indexes), ...Object.keys(fromRuntime.triggers), ...Object.keys(fromRuntime.views)]);
assert.deepEqual([...declaredAtRuntime].filter((name) => !builtAtRuntime.has(name)), [],
  "every CREATE statement in worker.js and shared/ reaches the runtime database this check builds");
assert.deepEqual(Object.keys(fromSchema.tables).filter((t) => !fromRuntime.tables[t]).sort(), ["progress", "stats", "users"],
  "the Worker creates every table schema.sql declares on first use, except users, progress and stats, which it never creates");
assert.deepEqual(Object.keys(fromRuntime.tables).filter((t) => !fromSchema.tables[t]), [],
  "and creates no table schema.sql does not declare");
for (const table of Object.keys(fromRuntime.tables)) {
  assert.deepEqual(fromRuntime.tables[table], fromSchema.tables[table],
    `SCHEMA PARITY: the Worker's first-use DDL for ${table} declares what schema.sql declares`);
}
assert.deepEqual(fromRuntime.indexes, fromSchema.indexes, "the Worker's first-use DDL creates exactly schema.sql's indexes");
assert.deepEqual(fromRuntime.triggers, fromSchema.triggers, "and exactly schema.sql's triggers");
assert.deepEqual(fromRuntime.views, fromSchema.views, "and exactly schema.sql's views");
const workerDayTables = [...workerSource.matchAll(/\baddDayColumn\(env, "(\w+)"\)/g)].map((m) => m[1]);
assert.equal(workerSource.match(/\baddDayColumn\(/g).length, workerDayTables.length + 1,
  "worker.js calls addDayColumn only with a literal table name");
const alterSites = [
  { file: "worker.js", site: /"ALTER TABLE " \+ table \+ " ADD COLUMN (\w+) (\w+)"/g,
    columns: (m) => workerDayTables.map((table) => [table, m[1], m[2]]) },
  { file: "server/schema.js", site: /`ALTER TABLE \$\{table\} ADD COLUMN \$\{column\} \$\{type\}`/g,
    columns: () => FLOWS_REGISTRY.flatMap((entry) => entry.addedColumns.map(([column, type]) => [entry.table, column, type.split(" ")[0]])) },
  { file: "shared/lab-sign-in.js", site: /^export const SIGNED_IN_COLUMN_SQL = "ALTER TABLE \w+ ADD COLUMN \w+ \w+";$/gm,
    columns: () => [SIGNED_IN_COLUMN_SQL.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+) (\w+)$/).slice(1)] },
];
const alterFiles = ["worker.js", "server/schema.js", ...readdirSync(new URL("shared/", root)).filter((f) => f.endsWith(".js")).sort().map((f) => `shared/${f}`)];
const unlistedAlters = [];
const alteredColumns = [];
for (const file of alterFiles) {
  const src = file === "worker.js" ? workerSource : file === "server/schema.js" ? schemaSource : read(file);
  const listed = alterSites.filter((entry) => entry.file === file).flatMap((entry) => {
    const hits = [...src.matchAll(entry.site)];
    assert.equal(hits.length, 1, `${file}: the listed ALTER TABLE site ${entry.site} appears exactly once`);
    alteredColumns.push(...entry.columns(hits[0]).map(([table, column, type]) => ({ file, table, column, type })));
    return hits.map((m) => [m.index, m.index + m[0].length]);
  });
  for (const m of src.matchAll(/\bALTER\s+TABLE\b/gi)) {
    if (!listed.some(([from, to]) => m.index >= from && m.index < to)) {
      unlistedAlters.push(`${file}:${src.slice(0, m.index).split("\n").length}: ${src.slice(m.index, m.index + 80)}`);
    }
  }
}
assert.deepEqual(unlistedAlters, [],
  "worker.js and shared/ alter tables only at the listed ALTER TABLE sites; a new one is listed here and its column declared in schema.sql and a migration");
assert(alteredColumns.length >= 10, "every listed ALTER TABLE site resolves to the columns it adds");
for (const { file, table, column, type } of alteredColumns) {
  const typeOf = (db) => db.tables[table] && db.tables[table].columns[column] && db.tables[table].columns[column].split(" ")[0];
  assert.equal(typeOf(fromSchema), type, `${file} adds ${table}.${column} ${type}, and schema.sql declares that column with that type`);
  assert.equal(typeOf(fromMigrations), type, `${file} adds ${table}.${column} ${type}, and the migrations declare that column with that type`);
  if (fromRuntime.tables[table]) {
    assert.equal(typeOf(fromRuntime), type, `${file} adds ${table}.${column} ${type}, and the Worker's first-use DDL declares that column with that type`);
  }
}

console.log("Academy contract OK: 12 courses, 365 stages, 84 skills, 252 challenge variants, 3 verified synthetic snapshots.");
