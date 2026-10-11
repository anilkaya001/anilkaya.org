import { LIVE_SCHEMA_SQL, CLOCK_ADDED_COLUMNS } from "../shared/flows-live-worker.js";
import { LEDGER_ADDED_COLUMNS } from "../shared/flows-ledger.js";
import { DOSSIER_SCHEMA_SQL } from "../shared/flows-dossier-worker.js";

export { LEDGER_ADDED_COLUMNS };

const PAYLOAD_SQL =
  "CREATE TABLE IF NOT EXISTS flows_payload (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL CHECK (updated_at > 0))";
const LOGIN_FAILURES_SQL =
  "CREATE TABLE IF NOT EXISTS flows_login_failures (username TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 1000000), first_at INTEGER NOT NULL CHECK (first_at > 0))";
const AI_USAGE_SQL =
  "CREATE TABLE IF NOT EXISTS flows_ai_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0), tokens_in INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0), tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0))";
const AI_USAGE_MODEL_SQL =
  "CREATE TABLE IF NOT EXISTS flows_ai_usage_model (day TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0), tokens_in INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0), tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0), PRIMARY KEY (day, model))";
const AI_SUMMARY_SQL =
  "CREATE TABLE IF NOT EXISTS flows_ai_summary (scope TEXT PRIMARY KEY, text TEXT NOT NULL, llm INTEGER NOT NULL DEFAULT 0 CHECK (llm IN (0, 1)), model TEXT, fingerprint TEXT NOT NULL, guard TEXT, generated_at TEXT NOT NULL)";
const NEURON_SQL =
  "CREATE TABLE IF NOT EXISTS flows_neuron (scope TEXT PRIMARY KEY, version INTEGER NOT NULL, fingerprint TEXT NOT NULL, summary TEXT NOT NULL, ideas TEXT NOT NULL, llm INTEGER NOT NULL DEFAULT 0 CHECK (llm IN (0, 1)), model TEXT, guard TEXT, generated_at TEXT NOT NULL)";

const AI_OUTCOME_SQL =
  "CREATE TABLE IF NOT EXISTS flows_ai_outcome (day TEXT NOT NULL, surface TEXT NOT NULL, model TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0), ms_sum INTEGER NOT NULL DEFAULT 0 CHECK (ms_sum >= 0), ms_max INTEGER NOT NULL DEFAULT 0 CHECK (ms_max >= 0), PRIMARY KEY (day, surface, model, outcome, reason)) WITHOUT ROWID";
const AI_REJECT_SQL =
  "CREATE TABLE IF NOT EXISTS flows_ai_reject (surface TEXT NOT NULL, slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 49), at INTEGER NOT NULL CHECK (at > 0), model TEXT NOT NULL, reason TEXT NOT NULL, culprit TEXT NOT NULL CHECK (length(culprit) <= 40), PRIMARY KEY (surface, slot)) WITHOUT ROWID";

const NONE = Object.freeze([]);
const COLUMN_RE = /^[a-z][a-z0-9_]*$/;
const TYPE_RE = /^(?:INTEGER|TEXT|REAL)(?: NOT NULL DEFAULT (?:-?\d+(?:\.\d+)?|'[^'\\]*'))?$/;
const DDL_RE = /^CREATE (?:TABLE|TRIGGER|INDEX) IF NOT EXISTS (\w+)/;

const META = Object.freeze({
  flows_payload: { table: "flows_payload", migration: "0005_flows.sql", owner: "ingest" },
  flows_login_failures: { table: "flows_login_failures", migration: "0005_flows.sql", owner: "auth" },
  flows_ai_usage: { table: "flows_ai_usage", migration: "0006_flows_ai_usage.sql", owner: "ai" },
  flows_ai_usage_model: { table: "flows_ai_usage_model", migration: "0009_flows_ai_usage_model.sql", owner: "ai" },
  flows_ai_summary: { table: "flows_ai_summary", migration: "0007_flows_ai_summary.sql", owner: "ai" },
  flows_neuron: { table: "flows_neuron", migration: "0008_flows_neuron.sql", owner: "ai" },
  flows_live: { table: "flows_live", migration: "0010_flows_live.sql", owner: "live" },
  flows_tape: { table: "flows_tape", migration: "0010_flows_live.sql", owner: "live" },
  flows_clock: { table: "flows_clock", migration: "0010_flows_live.sql", owner: "live", added: CLOCK_ADDED_COLUMNS },
  flows_ledger: { table: "flows_ledger", migration: "0015_flows_ledger.sql", owner: "live", added: LEDGER_ADDED_COLUMNS },
  flows_archive_immutable: { table: "flows_payload", migration: "0010_flows_live.sql", owner: "ingest" },
  flows_permanent_no_update: { table: "flows_payload", migration: "0020_flows_permanent_archive.sql", owner: "ingest" },
  flows_permanent_no_delete: { table: "flows_payload", migration: "0020_flows_permanent_archive.sql", owner: "ingest" },
  flows_dossier_cache: { table: "flows_dossier_cache", migration: "0016_flows_dossier_cache.sql", owner: "dossier" },
  flows_ai_outcome: { table: "flows_ai_outcome", migration: "0017_flows_ai_outcome.sql", owner: "ai" },
  flows_ai_reject: { table: "flows_ai_reject", migration: "0017_flows_ai_outcome.sql", owner: "ai" },
});

export function checkAdded(table, added) {
  if (!COLUMN_RE.test(String(table))) throw new TypeError("schema: " + String(table) + " is not a table name");
  if (!Array.isArray(added)) throw new TypeError("schema: " + table + " lists its added columns");
  const seen = new Set();
  for (const pair of added) {
    if (!Array.isArray(pair) || pair.length !== 2 || !COLUMN_RE.test(String(pair[0])) || !TYPE_RE.test(String(pair[1]))) {
      throw new TypeError("schema: " + table + " has an added column that is not [name, type]");
    }
    if (seen.has(pair[0])) throw new TypeError("schema: " + table + "." + pair[0] + " is added twice");
    seen.add(pair[0]);
  }
  return added;
}

export function registryOf(statements, meta = META) {
  const rows = [];
  const names = new Set();
  for (const ddl of statements) {
    const found = DDL_RE.exec(ddl);
    if (found === null) throw new TypeError("schema: a statement is not an idempotent CREATE: " + String(ddl).slice(0, 60));
    const name = found[1];
    const m = Object.hasOwn(meta, name) ? meta[name] : null;
    if (m === null) throw new TypeError("schema: " + name + " has no registry entry");
    if (names.has(name)) throw new TypeError("schema: " + name + " is declared twice");
    names.add(name);
    rows.push(Object.freeze({
      name, table: m.table, ddl, addedColumns: Object.freeze(checkAdded(m.table, [...(m.added || NONE)])),
      migration: m.migration, owner: m.owner,
    }));
  }
  const unused = Object.keys(meta).filter((name) => !names.has(name));
  if (unused.length) throw new TypeError("schema: registry entries without a statement: " + unused.join(", "));
  return Object.freeze(rows);
}

export const FLOWS_REGISTRY = registryOf([
  PAYLOAD_SQL, LOGIN_FAILURES_SQL, AI_USAGE_SQL, AI_USAGE_MODEL_SQL, AI_SUMMARY_SQL, NEURON_SQL,
  ...LIVE_SCHEMA_SQL,
  DOSSIER_SCHEMA_SQL,
  AI_OUTCOME_SQL, AI_REJECT_SQL,
]);

export function withAddedColumns(registry, name, added, ddl = null) {
  if (!registry.some((entry) => entry.name === name)) throw new TypeError("schema: " + name + " is not in the registry");
  return Object.freeze(registry.map((entry) => (entry.name !== name ? entry : Object.freeze({
    ...entry, ddl: ddl === null ? entry.ddl : ddl, addedColumns: Object.freeze(checkAdded(entry.table, [...entry.addedColumns, ...added])),
  }))));
}

export const FLOWS_SCHEMA_SQL = Object.freeze(FLOWS_REGISTRY.map((entry) => entry.ddl));

export function columnProbe(table) {
  checkAdded(table, NONE);
  return "PRAGMA table_info(" + table + ")";
}

export const upgradeTables = (registry = FLOWS_REGISTRY) =>
  [...new Set(registry.filter((entry) => entry.addedColumns.length > 0).map((entry) => entry.table))];

export const addedOf = (registry, table) => registry.find((entry) => entry.table === table && entry.addedColumns.length > 0)?.addedColumns ?? NONE;

export async function upgradeColumns(db, table, added, known = null) {
  if (!db) return [];
  checkAdded(table, added);
  let have = new Set();
  try {
    const info = known && Array.isArray(known.results) ? known : await db.prepare(columnProbe(table)).all();
    have = new Set(((info && info.results) || []).map((r) => r && r.name));
  } catch {
    have = new Set();
  }
  const done = [];
  for (const [column, type] of added) {
    if (have.has(column)) continue;
    try {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
      done.push(column);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column/i.test(message)) throw error;
    }
  }
  return done;
}

export async function applySchema(db, registry = FLOWS_REGISTRY) {
  const tables = upgradeTables(registry);
  const statements = [...registry.map((entry) => entry.ddl), ...tables.map(columnProbe)];
  const results = await db.batch(statements.map((sql) => db.prepare(sql)));
  const added = {};
  for (let i = 0; i < tables.length; i++) {
    const done = await upgradeColumns(db, tables[i], addedOf(registry, tables[i]), results && results[registry.length + i]);
    if (done.length) added[tables[i]] = done;
  }
  return added;
}
