import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { applySchema } from "../server/schema.js";
import { createFlowsStore } from "../server/store.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const MIG = (f) => readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8");
const row = (d, id) => d.db.prepare("SELECT * FROM flows_payload WHERE id = ?").get(id);
const manifest = (d) => {
  const r = row(d, "manifest");
  return r ? JSON.parse(r.payload) : null;
};
const meta = (d, id) => {
  const r = row(d, id);
  return r ? { chash: r.chash, session: r.session, quality: r.quality, epoch: r.epoch, asof: r.asof, rev: r.rev } : null;
};
const WIPED = { chash: null, session: null, quality: 0, epoch: 0, asof: 0, rev: 1 };
const HASH = "0123456789abcdef".repeat(4);

{
  const d = fakeD1({ latencyMs: 0 });
  const cols = d.db.prepare("PRAGMA table_info(flows_payload)").all().map((c) => c.name);
  eq(cols, ["id", "payload", "updated_at", "chash", "session", "quality", "epoch", "asof", "rev"], "schema.sql gives flows_payload the door's six columns after the three it always had");
  const triggers = d.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map((r) => r.name);
  ok(["flows_payload_manifest_i", "flows_payload_manifest_u", "flows_payload_manifest_d"].every((t) => triggers.includes(t)), "and the three manifest triggers");
}

{
  const old = fakeD1({ schema: "", latencyMs: 0 });
  for (const f of ["0005_flows.sql", "0010_flows_live.sql", "0015_flows_ledger.sql", "0016_flows_dossier_cache.sql", "0017_flows_ai_outcome.sql", "0020_flows_permanent_archive.sql"]) {
    try { old.db.exec(MIG(f)); } catch (e) { if (!/already exists/.test(String(e))) throw e; }
  }
  old.db.prepare("INSERT INTO flows_payload (id, payload, updated_at) VALUES ('board:long', '{}', 5)").run();
  const done = await applySchema(old.D1);
  eq(done.flows_payload, ["chash", "session", "quality", "epoch", "asof", "rev"], "a production database from before the door takes the six columns on first use");
  eq(meta(old, "board:long"), { chash: null, session: null, quality: 0, epoch: 0, asof: 0, rev: 0 }, "the rows it already holds read as unverified: no hash, session nil, quality, epoch, as-of and revision zero");
  eq(manifest(old), null, "and nothing writes a manifest row until a verified write happens");
  eq(await applySchema(old.D1), {}, "a second bootstrap adds nothing");
  const migrated = fakeD1({ schema: "", latencyMs: 0 });
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).sort().filter((n) => !/^000[1-4]|0013|0018/.test(n))) migrated.db.exec(MIG(f));
  eq(old.db.prepare("PRAGMA table_info(flows_payload)").all().map((c) => [c.name, c.type, c.notnull, c.dflt_value]),
    migrated.db.prepare("PRAGMA table_info(flows_payload)").all().map((c) => [c.name, c.type, c.notnull, c.dflt_value]),
    "and the first-use upgrade leaves the columns, in order, a database built from the migrations has");
}

{
  const d = fakeD1({ latencyMs: 0 });
  const store = createFlowsStore({ ensureFlowsTables: async () => {} });
  const env = { DB: d.D1 };
  const insert = d.db.prepare("INSERT INTO flows_payload (id, payload, updated_at, chash, session, quality, epoch, asof, rev) VALUES (?, '{}', 10, ?, ?, ?, ?, ?, 1)");

  insert.run("card:BRK.B", HASH, "2026-10-12", 255, 1, 7);
  eq(manifest(d), { "card:BRK.B": ["01234567", "2026-10-12", 255, 1] }, "a verified insert seeds the manifest row itself, with the key's short hash, session, quality and epoch, a dot in the key notwithstanding");
  eq(row(d, "manifest").updated_at, 10, "stamped with the write's time");
  insert.run("hist:AAPL", "f".repeat(64), "2026-10-12", 200, 1, 9);
  eq(Object.keys(manifest(d)).sort(), ["card:BRK.B", "hist:AAPL"], "the second key joins it");

  d.db.prepare("UPDATE flows_payload SET chash = ?, quality = 250, updated_at = 11 WHERE id = 'hist:AAPL'").run("a".repeat(64));
  eq(manifest(d)["hist:AAPL"], ["aaaaaaaa", "2026-10-12", 250, 1], "an update moves the entry");

  d.db.prepare("INSERT INTO flows_payload (id, payload, updated_at, chash, session) VALUES ('board:long:2026-10-12', '{}', 12, ?, '2026-10-12')").run(HASH);
  d.db.prepare("INSERT INTO flows_payload (id, payload, updated_at, chash, session) VALUES ('ideas:2026-10-12', '{}', 12, ?, '2026-10-12')").run(HASH);
  eq(Object.keys(manifest(d)).sort(), ["card:BRK.B", "hist:AAPL"], "a dated archive id never reaches the manifest, whatever its hash");

  await store.write(env, "hist:AAPL", "{\"v\":1}", 13);
  eq(meta(d, "hist:AAPL"), { ...WIPED, rev: 2 }, "THE V1 WRITER CLEARS THE METADATA: hash, session, quality, epoch and as-of go, the revision moves on");
  eq(manifest(d)["hist:AAPL"], null, "and the manifest entry reads null, unverified");
  eq(row(d, "hist:AAPL").payload, "{\"v\":1}", "with the payload replaced");

  await store.write(env, "pulse", "{\"a\":1}", 14);
  eq(Object.keys(manifest(d)).sort(), ["card:BRK.B", "hist:AAPL"], "a v1 write to a key that never had a hash adds no manifest entry");
  eq(meta(d, "pulse"), { ...WIPED, rev: 0 }, "while its revision starts at zero");
  await store.write(env, "pulse", "{\"a\":2}", 15);
  eq(meta(d, "pulse").rev, 1, "and counts each rewrite");

  eq(await store.remove(env, "card:BRK.B"), 1, "removing a verified key");
  eq(Object.keys(manifest(d)), ["hist:AAPL"], "removes its manifest entry");
  d.db.prepare("UPDATE flows_payload SET payload = 'not json' WHERE id = 'manifest'").run();
  insert.run("card:AAPL", HASH, "2026-10-12", 255, 1, 7);
  eq(manifest(d), { "card:AAPL": ["01234567", "2026-10-12", 255, 1] }, "a manifest row that is not JSON is rebuilt from the next verified write rather than failing it");
}

{
  const d = fakeD1({ latencyMs: 0 });
  const store = createFlowsStore({ ensureFlowsTables: async () => {} });
  const env = { DB: d.D1 };
  const before = d.db.prepare("SELECT count(*) AS n FROM flows_payload").get().n;
  for (const [key, text] of [["board:long", "{}"], ["card:AAPL", "{}"], ["card:AAPL", "{\"x\":1}"], ["meta", "{\"sessionDate\":\"2026-10-12\"}"], ["universe", "{}"]]) await store.write(env, key, text, 20);
  await store.remove(env, "card:AAPL");
  eq(d.db.prepare("SELECT count(*) AS n FROM flows_payload WHERE id = 'manifest'").get().n, 0, "WITH THE DOOR NEVER USED no manifest row ever exists, so the triggers add no row written to any v1 write or removal");
  eq(d.db.prepare("SELECT count(*) AS n FROM flows_payload").get().n, before + 3, "and the table holds exactly the keys written");
}

console.log("flows-door-v2: " + checks + " checks");
