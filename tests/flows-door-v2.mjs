import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { emitFiles, emitRead, nightlyEmit } from "./lib/nightly-emit.mjs";
import { applySchema, FLOWS_REGISTRY } from "../server/schema.js";
import { createFlowsStore } from "../server/store.js";
import { createRouter } from "../server/router.js";
import { flowsIngestRows } from "../server/routes/flows-ingest.js";
import { HttpError } from "../server/http.js";
import { CARD_SCHEMA_VERSION } from "../shared/flows-card.js";
import * as DOOR from "../shared/flows-door.js";

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

const NOW = Date.parse("2026-08-24T22:00:00Z");
const realNow = Date.now;
const clone = (v) => JSON.parse(JSON.stringify(v));
const emitDir = nightlyEmit();
const keyOfFile = (f) => f.slice(1, -5).replace(/^(card-x|card|hist)-/, "$1:").replace(/^(board|scores|ideas|sector)-/, "$1:");
const corpus = emitFiles(emitDir).filter((f) => f.endsWith(".json")).map(keyOfFile)
  .filter((k) => !/\d{4}-\d{2}-\d{2}/.test(k) && !k.startsWith("live"));
const rosterDepth = emitRead(emitDir, "roster").depth;
const tickerOfDepth = (depth) => Object.keys(rosterDepth).find((t) => rosterDepth[t] === depth);

{
  const { doorMode, DOOR_MODES } = DOOR;
  eq(DOOR_MODES, ["off", "warn"], "the door has two modes in this row: off and warn");
  eq([undefined, "", "off", "on", "enforce", "WARN", "warn ", "1", null].map((v) => doorMode({ FLOWS_DOOR_V2: v })), Array(9).fill("off"), "ANY VALUE BUT THE EXACT WORD warn IS OFF, enforce included, because enforcement is a later row");
  eq([doorMode({ FLOWS_DOOR_V2: "warn" }), doorMode({}), doorMode(null)], ["warn", "off", "off"], "and warn is warn; no variable and no environment are off");
}

{
  const base = { b: 1, a: [3, 2, { y: 1, x: 2 }], generatedAt: "2026-08-24T21:45:00Z", readAt: "x", producer: { run: 1 }, fresh: { readAt: "t", vendorAt: "v" } };
  const shuffled = { fresh: { vendorAt: "v", readAt: "other" }, producer: "p", readAt: "y", generatedAt: "2026-08-25T00:00:00Z", a: [3, 2, { x: 2, y: 1 }], b: 1 };
  eq(DOOR.canonicalize(base).text, DOOR.canonicalize(shuffled).text, "the canonical form orders keys and drops the volatile stamps: generatedAt, readAt, producer and fresh.readAt");
  eq(DOOR.canonicalize({ a: 1, fresh: { vendorAt: "v" } }).text, "{\"a\":1,\"fresh\":{\"vendorAt\":\"v\"}}", "while the vendor's own time inside fresh stays in");
  ok(DOOR.canonicalize({ a: [1, 2] }).text !== DOOR.canonicalize({ a: [2, 1] }).text, "array order is content");
  ok(DOOR.canonicalize({ a: 1 }).text !== DOOR.canonicalize({ a: 1.0000001 }).text, "and so is any digit");
  eq(DOOR.canonicalize({ a: -0 }).text, DOOR.canonicalize({ a: 0 }).text, "negative zero is zero");
  eq(DOOR.canonicalize(JSON.parse("{\"a\":{\"b\":1e999}}")).nonFinite, "a.b", "a number that overflowed to Infinity is named by its path");
  eq(DOOR.canonicalize(JSON.parse("[".repeat(80) + "]".repeat(80))).tooDeep, true, "and nesting past 64 levels is refused without recursing to the end");
  eq(await DOOR.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "the digest is SHA-256 of the UTF-8 bytes");
  eq(DOOR.parseHashHeader("sha256-" + "A".repeat(64)), { ok: true, hex: "a".repeat(64) }, "a hash header is case-blind");
  eq([DOOR.parseHashHeader("md5-1"), DOOR.parseHashHeader("sha256-abc"), DOOR.parseHashHeader(null)], [{ ok: false, hex: null }, { ok: false, hex: null }, null], "and anything else is malformed or absent");
  eq([DOOR.producerOf("run-123", "n"), DOOR.producerOf("bad value!", "n"), DOOR.producerOf(null, "n"), DOOR.producerOf("x".repeat(65), "n")], ["run-123", "n", "n", "n"], "a producer identity is a short token or the credential's own name");
}

{
  let clean = 0;
  for (const key of corpus) {
    const r = DOOR.inspect(key, JSON.stringify(emitRead(emitDir, key)), { now: NOW });
    if (r.structural.length === 0 && r.flags.length === 0) clean++;
    else assert.fail(key + " from the dry-run emit is flagged: " + JSON.stringify([r.structural, r.flags]));
  }
  checks++;
  ok(clean >= 400, "EVERY PAYLOAD THE DRY-RUN EMIT WRITES PASSES THE VALIDATORS WITH NO FINDING: " + clean + " payloads of " + new Set(corpus.map(DOOR.productOf)).size + " products");
  eq([...DOOR.COLLAPSE_PRODUCTS].sort(), ["board", "card", "card-x", "focus", "hist", "roster", "universe"], "size collapse is judged for the products whose size is a function of their universe, not for feeds that shrink on a quiet day");
  const withVersion = (v) => DOOR.inspect("card:AAPL", JSON.stringify({ ...emitRead(emitDir, "card:AAPL"), v }), { now: NOW }).structural.map((x) => x.code);
  eq([withVersion(CARD_SCHEMA_VERSION), withVersion(CARD_SCHEMA_VERSION + 1)], [[], ["schema_version"]], "the schema version the card builder stamps is accepted, and the next one is not until the door is told");
}

{
  const verdict = (key, mutate, now = NOW) => {
    const obj = clone(emitRead(emitDir, key));
    mutate(obj);
    const r = DOOR.inspect(key, JSON.stringify(obj), { now });
    return r.structural.map((x) => x.code + "@" + x.path).sort();
  };
  const body = (key, text) => DOOR.inspect(key, text, { now: NOW }).structural.map((x) => x.code + "@" + x.path).sort();
  eq(body("card:AAPL", "[1,2]"), ["not_object@$"], "an array is not a payload");
  eq(body("card:AAPL", "null"), ["not_object@$"], "nor is null");
  eq(verdict("card:AAPL", (o) => { delete o.panels; }), ["missing_key@panels"], "a card with no panels is structurally invalid");
  eq(verdict("card:AAPL", (o) => { o.ticker = "MSFT"; }), ["ticker_mismatch@ticker"], "a card for another ticker than its key is");
  eq(verdict("card:AAPL", (o) => { o.ticker = "aapl"; }), ["ticker_grammar@ticker"], "and a ticker off the grammar is");
  eq(verdict("card:AAPL", (o) => { o.v = 1; }), ["schema_version@v"], "a version below the supported range is");
  eq(verdict("card:AAPL", (o) => { o.depth = "deep"; }), ["depth@depth"], "an unknown depth is");
  eq(verdict("card:AAPL", (o) => { o.panels.gamma = { status: "great" }; }), ["panel_shape@panels.gamma"], "a base panel with a status off the vocabulary is");
  eq(verdict("card:AAPL", (o) => { o.sessionDate = "tomorrow"; }), ["session_format@sessionDate"], "a session that is not a date is");
  eq(verdict("card:AAPL", (o) => { o.generatedAt = "yesterday"; }), ["instant_format@generatedAt"], "an instant without a zone is");
  eq(verdict("card:AAPL", (o) => { o.sessionDate = "2026-08-25"; }), ["session_future@sessionDate"], "a session after the next one the calendar expects is, so a wrong clock cannot lock a key in the future");
  eq(verdict("card:AAPL", (o) => { o.sessionDate = "2026-08-25"; }, Date.parse("2026-08-25T02:00:00Z")), ["session_future@sessionDate"], "even after midnight UTC, when New York is still on the 24th");
  eq(verdict("card:AAPL", (o) => { o.sessionDate = "2026-08-25"; }, Date.parse("2026-08-25T14:00:00Z")), [], "and the same session is valid once the 25th is the day in New York");
  eq(verdict("card-x:AAPL", (o) => { o.ticker = "GLD"; }), ["ticker_mismatch@ticker"], "a card-x for another name is");
  eq(verdict("hist:AAPL", (o) => { delete o.sessionDate; }), ["missing_key@sessionDate"], "a hist with no session is");
  eq(verdict("universe", (o) => { o.t.pop(); }), ["n_mismatch@t"], "a universe whose n disagrees with its name list is");
  eq(verdict("universe", (o) => { o.cols.px.pop(); }), ["column_length@cols.px"], "or whose column is a name short");
  eq(verdict("universe", (o) => { delete o.units.px; }), ["units_missing@units.px"], "or whose column has no unit");
  eq(verdict("universe", (o) => { o.pct.iv30.pop(); }), ["column_length@pct.iv30"], "or whose percentile column is short");
  eq(verdict("board:long", (o) => { o.rows = {}; }), ["rows_type@rows"], "a board whose rows are not a list is");
  eq(verdict("board:long", (o) => { o.rows[3] = { x: 1 }; }), ["row_shape@rows[3]"], "or whose row names no ticker");
  eq(verdict("meta", (o) => { o.stages = "ok"; }), ["invalid_shape@stages"], "a meta whose stages are not a list is");
  eq(verdict("focus", (o) => { o.rows = []; }), ["invalid_shape@rows"], "a focus whose rows are not an object is");
  eq(body("news", "{\"sessionDate\":\"2026-08-24\",\"generatedAt\":\"2026-08-24T21:00:00Z\",\"x\":1e999}"), ["non_finite@x"], "a number that overflowed is non-finite wherever it sits");
  eq(body("news", "{\"status\":\"pending\",\"rows\":[]}"), [], "a pending placeholder has no required keys: the door does not turn a pending marker into a quarantine");
  eq(body("news", "{}"), ["missing_key@generatedAt", "missing_key@sessionDate"], "while an empty view is missing its stamps");

  const u = clone(emitRead(emitDir, "universe"));
  u.cols.px[0] = -100;
  u.cols.iv30[1] = 9000;
  u.cols.sig[2] = 40000;
  u.cols.chg[3] = -9900;
  const r = DOOR.inspect("universe", JSON.stringify(u), { now: NOW });
  eq(r.structural, [], "range violations are not structural: a squeeze or a collapse can exceed any hard range");
  eq(r.flags.map((f) => f.path + ":" + f.n).sort(), ["cols.chg:1", "cols.iv30:1", "cols.px:1", "cols.sig:1"], "they are flagged by column with the count of names");
  ok(r.quality < DOOR.inspect("universe", JSON.stringify(emitRead(emitDir, "universe")), { now: NOW }).quality, "and cost quality, one step a flag");
  eq(DOOR.membershipFlag("AAPL", ["AAPL", "MSFT"]), null, "a ticker in the universe carries no flag");
  eq(DOOR.membershipFlag("ZZZZ", ["AAPL"]), { code: "not_in_universe", path: "ZZZZ" }, "and one outside it is flagged, never refused");
  eq([DOOR.membershipFlag("AAPL", null), DOOR.membershipFlag(null, ["A"])], [null, null], "with no universe to compare to, or no ticker, there is nothing to say");

  const q = (key, mutate = () => {}) => { const o = clone(emitRead(emitDir, key)); mutate(o); return DOOR.inspect(key, JSON.stringify(o), { now: NOW }); };
  const L2 = q("card:AAPL");
  eq([L2.pct, L2.tier, L2.quality, L2.session, L2.epoch, L2.baseOk, L2.baseTotal], [63, 3, 255, "2026-08-24", 1, 13, 13], "a complete focus card is 63 of 63 of its base panels at tier 3: quality 255");
  const L1 = q("card:" + tickerOfDepth("cross"));
  eq([L1.pct, L1.tier, L1.quality], [63, 1, 253], "a complete cross-section card is the same pct at tier 1: 253");
  const part = q("card:AAPL", (o) => { o.panels.gamma.status = "unavailable"; });
  eq([part.baseOk, part.pct, part.quality], [12, 58, 235], "an L2 card missing one base panel is 235");
  ok(L1.quality > part.quality && L2.quality > L1.quality, "SO A COMPLETE L1 BEATS AN L2 THAT IS MISSING A BASE PANEL, and a complete L2 beats a complete L1: level does not outrank completeness");
  eq(q("card:" + tickerOfDepth("fund")).tier, 2, "an index or fund without an engine is tier 2");
  eq(q("card:AAPL", (o) => { delete o.engine; }).tier, 2, "and a board or focus card without its engine block is tier 2 as well");
  eq(q("card:AAPL", (o) => { o.panels.congress.status = "quiet"; o.panels.gamma.status = "none"; }).pct, 63, "a quiet or none panel is a legitimately empty one and counts as ok");
  eq(DOOR.inspect("card:AAPL", "{\"status\":\"pending\"}", { now: NOW }).quality, 0, "a pending placeholder has quality zero, below any real card");
  ok(L2.asof > 0, "as-of is the minute of generatedAt");
  eq(DOOR.inspect("regime", JSON.stringify({ ...emitRead(emitDir, "regime"), status: "partial" }), { now: NOW }).pct, 32, "a view whose own status says partial is half complete");
  eq(DOOR.inspect("regime", JSON.stringify({ ...emitRead(emitDir, "regime"), status: "unavailable" }), { now: NOW }).pct, 0, "and unavailable is zero");
}

{
  const t = (e, s, q, a, c = null) => ({ epoch: e, session: s, quality: q, asof: a, chash: c });
  const V = DOOR.casVerdict;
  eq(V(null, t(1, "2026-08-24", 255, 5, "a")), "new", "no stored row is new");
  eq(V(t(1, "2026-08-24", 255, 5, "a"), t(1, "2026-08-24", 255, 9, "a")), "unchanged", "the same canonical hash is unchanged, whatever its as-of");
  eq(V(t(1, "2026-08-24", 255, 5, "a"), t(1, "2026-08-24", 255, 5, "b")), "advance", "an equal tuple with other content is an advance: the later of two equal builds wins");
  eq(V(t(1, "2026-08-24", 255, 5, "a"), t(1, "2026-08-24", 255, 6, "b")), "advance", "a later as-of advances");
  eq(V(t(1, "2026-08-24", 255, 5, "a"), t(1, "2026-08-24", 255, 4, "b")), "superseded", "an earlier as-of is superseded");
  eq(V(t(1, "2026-08-24", 255, 5, "a"), t(1, "2026-08-24", 253, 99, "b")), "superseded", "lower quality is superseded however late");
  eq(V(t(1, "2026-08-24", 253, 5, "a"), t(1, "2026-08-24", 255, 1, "b")), "advance", "higher quality advances however early");
  eq(V(t(1, "2026-08-24", 255, 5, "a"), t(1, "2026-08-21", 255, 99, "b")), "superseded", "an earlier session is superseded however good");
  eq(V(t(1, "2026-08-21", 10, 5, "a"), t(1, "2026-08-24", 0, 0, "b")), "advance", "a later session advances however poor");
  eq(V(t(1, "2026-08-24", 255, 5, "a"), t(2, "2026-08-21", 0, 0, "b")), "advance", "a higher epoch outranks everything: a corrected reducer can overwrite wrong-but-valid data");
  eq(V(t(2, "2026-08-24", 255, 5, "a"), t(1, "2026-08-25", 255, 9, "b")), "superseded", "and a lower epoch never does");
  eq(V(t(0, null, 0, 0, null), t(1, "2026-08-24", 0, 0, "b")), "advance", "a legacy row, unverified, is overwritten by any verified one");
  eq(V(t(0, "", 0, 0, null), t(1, null, 0, 0, "b")), "advance", "even by one with no session");
  const reg = (storedQ, storedS, inc) => DOOR.regressionOf({ quality: storedQ, session: storedS }, inc);
  const inc = (pct, session, total = 13) => ({ pct, session, baseTotal: total });
  ok(reg(255, "2026-08-21", inc(34, "2026-08-24")), "a card of a later session that keeps only 34 of 63 is a regression");
  ok(!reg(255, "2026-08-21", inc(48, "2026-08-24")), "one that keeps 48 (a drop under a quarter) is not");
  ok(!reg(255, "2026-08-24", inc(0, "2026-08-24")), "a drop inside the same session is the CAS's business, not the regression guard's");
  ok(!reg(255, "2026-08-21", inc(0, "2026-08-24", 2)), "a product with fewer than eight base panels cannot regress");
  ok(!reg(0, "", inc(0, "2026-08-24")), "and a stored row with no metadata gives it nothing to compare to");
  const fresh = { structural: [], product: "card", bytes: 30, session: "2026-08-24", pct: 63, baseTotal: 13, epoch: 1, quality: 255, asof: 7, chash: "x" };
  const was = { bytes: 100, chash: "y", session: "2026-08-24", quality: 255, epoch: 1, asof: 3 };
  eq(DOOR.assess(fresh, was, {}).would.map((x) => x.code), ["size_collapse"], "a card under 40 per cent of the stored size is a collapse");
  eq(DOOR.assess({ ...fresh, product: "news" }, { ...was, bytes: 1000 }, {}).would, [], "while a news feed may shrink");
  eq(DOOR.assess({ ...fresh, bytes: 100 }, null, { producerEpoch: 0, hashMismatch: true }).would.map((x) => x.code), ["hash_mismatch", "stale_producer"], "a producer declaring an older epoch and a mismatched transport hash are named, in the table's order");
}

{
  eq(DOOR.planOf({ session: "2026-08-24", names: ["MSFT", "AAPL", "AAPL", "BRK.B"] }, NOW), { ok: true, session: "2026-08-24", names: ["AAPL", "BRK.B", "MSFT"] }, "a plan is a session and a set of names, deduplicated and sorted");
  eq(DOOR.planOf({ session: "soon", names: [] }, NOW).code, "session_format", "its session is a date");
  eq(DOOR.planOf({ session: "2026-08-25", names: [] }, NOW).code, "session_future", "not one after the next expected");
  eq(DOOR.planOf({ session: "2026-08-24", names: ["aapl"] }, NOW).code, "ticker_grammar", "its names are on the ticker grammar");
  eq(DOOR.planOf({ session: "2026-08-24", names: new Array(2001).fill("AAPL") }, NOW).code, "invalid_shape", "and at most 2,000");
  eq(DOOR.planOf([], NOW).code, "invalid_shape", "a plan is an object");
}

const NIGHTLY = "nightly-token-abcdefghijklmnopqrstuvwxyz";
const LIVE = "live-token-abcdefghijklmnopqrstuvwxyz0123";
const BASE = "https://anilkaya.test";

function rig({ modules = {}, env: extra = {} } = {}) {
  const d = fakeD1({ latencyMs: 0 });
  const logs = [];
  const make = modules.store || createFlowsStore;
  const store = make({ ensureFlowsTables: async () => {} });
  const deps = {
    store,
    ensureFlowsTables: async () => {},
    passthrough: (s) => new Response(s.payload, { headers: { "Content-Type": "application/json" } }),
    storeGone: () => new HttpError(503, "store_unreadable", "The store could not be read", { "Retry-After": "30" }, { status: "unavailable", reason: "store" }),
    log: (level, event, fields, error) => logs.push({ level, event, fields, error: error ? String(error.message || error) : null }),
  };
  const table = createRouter((modules.rows || flowsIngestRows)(deps));
  const env = { DB: d.D1, FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_LIVE_TOKEN: LIVE, FLOWS_DOOR_V2: "warn", ...extra };
  const call = async (method, query, { body, token = NIGHTLY, headers = {}, env: over = {}, base = BASE } = {}) => {
    const url = base + "/api/flows/ingest" + query;
    const init = { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...headers } };
    if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
    try {
      const res = await table.handle({ request: new Request(url, init), env: { ...env, ...over }, url: new URL(url), ctx: {} }, {});
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      return { status: res.status, body: parsed, text, headers: res.headers };
    } catch (error) {
      return { status: error.status, error: { code: error.code, message: error.message, headers: error.headers, details: error.details }, body: null };
    }
  };
  const put = (key, value, opts) => call("POST", "?key=" + key, { body: typeof value === "string" ? value : JSON.stringify(value), ...opts });
  return { d, logs, store, table, env, call, put };
}

const ring = (d) => d.db.prepare("SELECT * FROM flows_quarantine ORDER BY id").all();
const rowOf = (d, id) => { const r = d.db.prepare("SELECT id, chash, session, quality, epoch, asof, rev, updated_at, length(payload) AS bytes FROM flows_payload WHERE id = ?").get(id); return r ? { ...r } : r; };

Date.now = () => NOW;
try {
  {
    const r = rig();
    const card = emitRead(emitDir, "card:AAPL");
    const text = JSON.stringify(card);
    const first = await r.put("card:AAPL", text);
    eq(first.status, 200, "a warn-mode write answers 200 as ever");
    eq([first.body.ok, first.body.key, first.body.bytes], [true, "card:AAPL", text.length], "with the three fields an old client reads, unchanged");
    eq(Object.keys(first.body).sort(), ["bytes", "door", "key", "ok"], "and one more, door");
    const door = first.body.door;
    eq([door.mode, door.product, door.session, door.quality, door.epoch, door.cas, door.would, door.flags], ["warn", "card", "2026-08-24", 255, 1, "new", [], []], "which says what the door made of it: product, session, quality 255, epoch 1, a new key, nothing it would refuse");
    ok(/^[0-9a-f]{64}$/.test(door.chash) && door.chash === await DOOR.sha256Hex(DOOR.canonicalize(card).text), "and carries the canonical hash, recomputable from the payload by anyone");
    eq(rowOf(r.d, "card:AAPL"), { id: "card:AAPL", chash: door.chash, session: "2026-08-24", quality: 255, epoch: 1, asof: door.asof, rev: 1, updated_at: NOW, bytes: text.length }, "THE ROW RECORDS THE TUPLE: hash, session, quality, epoch, as-of, revision 1");
    eq(JSON.parse(r.d.db.prepare("SELECT payload FROM flows_payload WHERE id = 'manifest'").get().payload)["card:AAPL"], [door.chash.slice(0, 8), "2026-08-24", 255, 1], "and the manifest names it");

    const again = await r.put("card:AAPL", JSON.stringify({ ...card, generatedAt: "2026-08-24T23:59:00.000Z", readAt: "later", producer: { run: 2 } }));
    eq([again.body.door.cas, again.body.door.chash === door.chash, again.body.door.would], ["unchanged", true, []], "the same payload with other stamps hashes the same and reads as unchanged");
    const stored = rowOf(r.d, "card:AAPL");
    eq([stored.rev, stored.updated_at], [2, NOW], "and is still written in warn mode, so the row's time and revision move as they always did");

    const edited = clone(card);
    edited.panels.gamma.note = "x";
    edited.generatedAt = "2026-08-24T23:59:00.000Z";
    const adv = await r.put("card:AAPL", JSON.stringify(edited));
    eq([adv.body.door.cas, adv.body.door.chash !== door.chash], ["advance", true], "other content in an equal tuple advances: the later of two equal builds wins");
    const stale = clone(card);
    stale.panels.gamma.note = "y";
    const behind = await r.put("card:AAPL", JSON.stringify(stale));
    eq([behind.body.door.cas, behind.body.door.would], ["superseded", ["superseded"]], "while a build with an earlier as-of in the same session is superseded");
    await r.call("POST", "?key=card:AAPL", { body: JSON.stringify(edited) });
    eq(ring(r.d).length, 1, "and that is the first event in the ring");

    const old = clone(card);
    old.sessionDate = "2026-08-21";
    const sup = await r.put("card:AAPL", JSON.stringify(old));
    eq([sup.status, sup.body.door.cas, sup.body.door.would], [200, "superseded", ["superseded"]], "AN OLDER SESSION IS SUPERSEDED, recorded, and still written: nothing is enforced");
    eq(rowOf(r.d, "card:AAPL").session, "2026-08-21", "the row now holds the older session");
    const rows = ring(r.d);
    eq(rows.map((x) => [x.payload_key, x.reason, x.mode, x.producer, x.braked]), [["card:AAPL", "superseded", "warn", "nightly", 0], ["card:AAPL", "superseded", "warn", "nightly", 0]], "and the ring holds the would-have-refused events, mode warn");
    ok(rows[1].body === null && rows[1].bytes === JSON.stringify(old).length && rows[1].chash === sup.body.door.chash, "a card's 107 KB is over the 64 KiB body cap, so its row keeps size and hash but no body");
    const smallBad = clone(emitRead(emitDir, "hist:AAPL"));
    smallBad.ticker = "MSFT";
    await r.put("hist:AAPL", JSON.stringify(smallBad));
    const kept = ring(r.d).at(-1);
    eq([kept.reason, kept.path, kept.body], ["ticker_mismatch", "ticker", JSON.stringify(smallBad)], "while a 13 KB hist keeps its body in the ring, with the reason and the path of the finding");
  }

  {
    const r = rig();
    const card = emitRead(emitDir, "card:AAPL");
    const base = JSON.stringify(card);
    await r.put("card:AAPL", base);
    const wrong = clone(card);
    wrong.ticker = "MSFT";
    const bad = await r.put("card:AAPL", JSON.stringify(wrong));
    eq([bad.status, bad.body.door.would], [200, ["ticker_mismatch"]], "A STRUCTURALLY INVALID CARD IS WRITTEN IN WARN MODE and named: a would-have-quarantined event");
    eq(JSON.parse(r.d.db.prepare("SELECT payload FROM flows_payload WHERE id = 'card:AAPL'").get().payload).ticker, "MSFT", "the last good copy is overwritten, exactly as before the door; enforcement is the next row");
    eq(ring(r.d).map((x) => x.reason), ["ticker_mismatch"], "and the ring has the event");

    const tiny = JSON.stringify({ v: 3, ticker: "AAPL", depth: "focus", sessionDate: "2026-08-24", generatedAt: "2026-08-24T22:00:00Z", panels: {} });
    await r.put("card:AAPL", base);
    const small = await r.put("card:AAPL", tiny);
    eq(small.body.door.would, ["size_collapse", "superseded"], "a card that fell under 40 per cent of the stored size is a would-be collapse, and with every base panel gone its quality is below the stored row's");
    eq(small.body.door.quality, 2, "at quality 2: tier 2 for want of an engine block, no base panel");

    const r2 = rig();
    const earlier = clone(card);
    earlier.sessionDate = "2026-08-21";
    await r2.put("card:AAPL", JSON.stringify(earlier));
    const thin = clone(card);
    for (const name of ["context", "pricedMove", "levels", "gamma", "calendar", "displacement"]) thin.panels[name] = { status: "unavailable", reason: "vendor" };
    const regress = await r2.put("card:AAPL", JSON.stringify(thin));
    eq(regress.body.door.would, ["regression"], "A NEW SESSION'S CARD THAT KEEPS ONLY HALF ITS BASE PANELS IS A WOULD-BE REGRESSION");
    eq(r2.logs.map((l) => [l.level, l.event, l.fields.n, l.fields.keys]), [["warn", "door would hold regressions", 1, "card:AAPL"]], "which is logged once with its count and keys, and nothing else is logged");
    eq(rowOf(r2.d, "card:AAPL").session, "2026-08-24", "the guard only logs: the card is stored");

    const r3 = rig();
    const future = clone(card);
    future.sessionDate = "2026-08-25";
    const f = await r3.put("card:AAPL", JSON.stringify(future));
    eq([f.status, f.body.door.would], [200, ["session_future"]], "a session after the next expected is named too, and is also only recorded in this row");
  }

  {
    const r = rig();
    const text = JSON.stringify(emitRead(emitDir, "hist:AAPL"));
    const good = await r.put("hist:AAPL", text, { headers: { "X-Content-Hash": "sha256-" + await DOOR.sha256Hex(text) } });
    eq(good.body.door.would, [], "a body whose X-Content-Hash is right is clean");
    const wrong = await r.put("hist:AAPL", text, { headers: { "X-Content-Hash": "sha256-" + "0".repeat(64) } });
    eq([wrong.status, wrong.body.door.would], [200, ["hash_mismatch"]], "a wrong hash is a would-be hash_mismatch, written all the same");
    const malformed = await r.put("hist:AAPL", text, { headers: { "X-Content-Hash": "md5-abc" } });
    eq(malformed.body.door.would, ["hash_mismatch"], "and so is a header that is not sha256-hex");
    const none = await r.put("hist:AAPL", text);
    eq(none.body.door.would, [], "while no header, as every old client sends, is not an error");
    const multi = await r.put("hist:AAPL", text, { headers: { "X-Content-Hash": "sha256-" + await DOOR.sha256Hex(text + " ") } });
    eq(multi.body.door.would, ["hash_mismatch"], "the hash is over the exact bytes sent, a space too");
  }

  {
    const r = rig();
    await r.put("universe", JSON.stringify(emitRead(emitDir, "universe")));
    const known = await r.put("card:AAPL", JSON.stringify(emitRead(emitDir, "card:AAPL")));
    eq(known.body.door.flags, [], "a card for a name in the stored universe carries no flag");
    const odd = clone(emitRead(emitDir, "card:AAPL"));
    odd.ticker = "ZZZZ";
    const unknown = await r.put("card:ZZZZ", JSON.stringify(odd));
    eq([unknown.body.door.flags, unknown.body.door.would], [[{ code: "not_in_universe", path: "ZZZZ" }], []], "one for a name outside it is flagged, not refused, and not in the ring");
    const noUniverse = rig();
    const unread = await noUniverse.put("card:AAPL", JSON.stringify(emitRead(emitDir, "card:AAPL")));
    eq(unread.body.door.flags, [], "with no universe stored there is nothing to compare to");
  }

  {
    const r = rig();
    const meta = JSON.stringify(emitRead(emitDir, "meta"));
    const done = await r.put("meta", meta);
    eq([done.status, done.body.door.product, done.body.door.cas], [200, "meta", "new"], "meta goes through the door as a view");
    eq(r.d.db.prepare("SELECT nightly_runs FROM flows_ledger").all().map((x) => x.nightly_runs), [1], "and its ledger landing still rides in the same batch");
  }

  {
    const r = rig();
    const res = await r.put("board:long:2026-08-24", JSON.stringify(emitRead(emitDir, "board:long:2026-08-24")));
    eq([res.status, res.body.stored, "door" in res.body], [200, "created", false], "a dated archive key takes the archive path in warn mode: write-once, no door fields");
    eq(rowOf(r.d, "board:long:2026-08-24").chash, null, "and carries no hash, so the manifest never lists it");
    const perm = await r.put("ideas:2026-08-24", JSON.stringify(emitRead(emitDir, "ideas:2026-08-24")));
    eq([perm.status, perm.body.stored], [200, "created"], "nor does a permanent archive key");
    const live = await r.put("live:market", JSON.stringify({ x: 1 }));
    eq([live.status, live.error.code], [403, "nightly_token_scope"], "and a live key keeps its own scope and its own writer");
    eq(ring(r.d), [], "none of these touched the ring");
  }

  {
    const r = rig();
    const text = JSON.stringify(emitRead(emitDir, "pulse"));
    for (const [value, label] of [[undefined, "no variable"], ["off", "off"], ["enforce", "enforce"], ["on", "on"], ["WARN", "WARN"], ["", "empty"]]) {
      const env = value === undefined ? { FLOWS_DOOR_V2: undefined } : { FLOWS_DOOR_V2: value };
      const res = await r.put("pulse", text, { env });
      eq([res.status, Object.keys(res.body).sort()], [200, ["bytes", "key", "ok"]], label + ": the response is the v1 one, three fields");
      eq([rowOf(r.d, "pulse").chash, rowOf(r.d, "pulse").quality], [null, 0], label + ": the row carries no metadata");
      const op = await r.call("POST", "?op=have", { body: { items: [] }, env });
      eq([op.status, op.error.code], [400, "invalid_key"], label + ": ?op= is ignored, so a request that names one is what it was: no key");
      const hdr = await r.put("pulse", text, { env, headers: { "X-Content-Hash": "sha256-bad" } });
      eq(hdr.status, 200, label + ": the hash header is not read");
    }
    eq(ring(r.d), [], "and the ring stays empty");
    eq(r.logs, [], "with nothing logged");
  }

  {
    const r = rig();
    const text = JSON.stringify(emitRead(emitDir, "pulse"));
    const off = { FLOWS_DOOR_V2: "off" };
    const w1 = await r.put("pulse", text);
    const h1 = rowOf(r.d, "pulse");
    ok(h1.chash && h1.quality > 0 && h1.rev === 1, "round trip: warn sets the metadata");
    await r.put("pulse", text + " ", { env: off });
    eq({ ...rowOf(r.d, "pulse"), updated_at: 0, bytes: 0 }, { id: "pulse", chash: null, session: null, quality: 0, epoch: 0, asof: 0, rev: 2, updated_at: 0, bytes: 0 }, "off clears it and counts the revision");
    eq(JSON.parse(r.d.db.prepare("SELECT payload FROM flows_payload WHERE id = 'manifest'").get().payload).pulse, null, "and the manifest entry reads null");
    eq(r.d.db.prepare("SELECT payload FROM flows_payload WHERE id = 'pulse'").get().payload, text + " ", "the payload is the last one written");
    const w3 = await r.put("pulse", text);
    eq([rowOf(r.d, "pulse").chash, rowOf(r.d, "pulse").rev], [w1.body.door.chash, 3], "warn again re-verifies it: the same canonical hash, revision 3");
    eq(JSON.parse(r.d.db.prepare("SELECT payload FROM flows_payload WHERE id = 'manifest'").get().payload).pulse[0], w3.body.door.chash.slice(0, 8), "and the manifest names it once more");
    await r.put("pulse", text, { env: off });
    await r.put("pulse", text);
    const final = rowOf(r.d, "pulse");
    eq([final.rev, final.chash === w1.body.door.chash], [5, true], "off, warn, off, warn: five revisions, and the metadata always describes the payload the row holds");
  }

  {
    const r = rig();
    const bad = clone(emitRead(emitDir, "hist:AAPL"));
    bad.ticker = "MSFT";
    for (let i = 0; i < 230; i++) {
      const v = clone(bad);
      v.trimmed = i;
      await r.put("hist:AAPL", JSON.stringify(v));
    }
    const rows = ring(r.d);
    eq(rows.length, 200, "THE RING IS BOUNDED AT 200 ROWS however many events come");
    const ids = rows.map((x) => x.id);
    eq([ids[0], ids[199], ids[199] - ids[0]], [31, 230, 199], "holding the newest 200, oldest pruned by id");
    eq(rows.filter((x) => x.braked === 1).length, 200, "and the brake held the body of every event past the twentieth in a run of one check from one producer: every row that survives the pruning");
    eq(rows.filter((x) => x.body !== null).length, 0, "so that a flood leaves no bodies at all: the first twenty rotated out of the newest-twenty window and the rest were braked");
    const other = await r.put("hist:AAPL", JSON.stringify({ ...bad, trimmed: 999 }), { headers: { "X-Producer-Id": "run-B" } });
    eq(other.status, 200, "another producer's event");
    eq(ring(r.d).filter((x) => x.body !== null).map((x) => x.id), [231], "is not braked and keeps its body, the only body in the ring");
  }

  {
    const r = rig();
    const bad = clone(emitRead(emitDir, "hist:AAPL"));
    bad.ticker = "MSFT";
    const run = (producer) => r.put("hist:AAPL", JSON.stringify(bad), { headers: { "X-Producer-Id": producer } });
    for (let i = 0; i < 25; i++) await run("run-A");
    await run("run-B");
    const rows = ring(r.d);
    eq(rows.map((x) => x.braked), [...Array(20).fill(0), ...Array(5).fill(1), 0], "the brake is per producer: after twenty events of one check from run-A the rest are held without a body, and run-B starts fresh");
    eq(rows.filter((x) => x.braked === 1).every((x) => x.body === null), true, "a braked row keeps no body");
    eq(rows.filter((x) => x.body !== null).map((x) => x.id), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 26], "and bodies stay on the newest twenty rows that were not braked");
  }

  {
    const r = rig();
    const text = JSON.stringify(emitRead(emitDir, "regime"));
    r.d.fail(/SELECT id, chash, session/);
    const res = await r.put("regime", text);
    eq([res.status, res.body.door.cas], [200, "unread"], "when the metadata read fails the write still lands, its verdict unread");
    ok(r.logs.some((l) => l.event === "door metadata not read"), "and the failure is logged");
    r.d.fail(null);
    const r2 = rig();
    r2.d.fail(/INSERT INTO flows_quarantine/);
    const bad = clone(emitRead(emitDir, "card:AAPL"));
    bad.ticker = "MSFT";
    const lost = await r2.put("card:AAPL", JSON.stringify(bad));
    eq([lost.status, lost.body.door.would, lost.body.door.ring], [200, ["ticker_mismatch"], { recorded: 0, dropped: 1 }], "and a ring that cannot be written never fails the ingest");
    ok(r2.logs.some((l) => l.event === "door ring not recorded"), "it is logged");
  }
  {
    const r = rig();
    await r.put("universe", JSON.stringify(emitRead(emitDir, "universe")));
    const text = JSON.stringify(emitRead(emitDir, "hist:AAPL"));
    const before = r.d.trips.length;
    await r.put("hist:AAPL", text);
    eq(r.d.trips.slice(before).map((t) => t.kind), ["batch", "run"], "a clean warn write of a ticker key is two D1 trips: one batch reading the stored tuple and the universe's names, one write");
    ok(r.d.rowsRead(before) <= 3, "reading no more than three rows (" + r.d.rowsRead(before) + ")");
    eq(r.d.written(before), 1, "and changing one row (the manifest row rides along in the trigger)");
    const sqls = r.d.trips.slice(before).flatMap((t) => t.sqls);
    ok(sqls.every((q) => !/json_each/i.test(q)) && sqls.some((q) => /WHERE id IN \(\?\)/.test(q)), "by primary key, never a scan and never a json_each");
    const view = r.d.trips.length;
    await r.put("regime", JSON.stringify(emitRead(emitDir, "regime")));
    eq(r.d.trips.slice(view).map((t) => t.kind), ["batch", "run"], "a view key is the same two trips");
    ok(r.d.trips.slice(view)[0].sqls.length === 1, "with one statement in the read: no universe lookup for a key that is not a ticker's");
  }

  {
    const r = rig();
    const aapl = (kind) => emitRead(emitDir, kind + ":AAPL");
    const mixed = [
      { key: "card:AAPL", payload: aapl("card") },
      { key: "hist:AAPL", payload: JSON.stringify(aapl("hist")) },
      { key: "card-x:AAPL", payload: aapl("card-x") },
      { key: "universe", payload: emitRead(emitDir, "universe") },
    ];
    const before = r.d.trips.length;
    const res = await r.call("POST", "?op=batch", { body: { items: mixed } });
    eq([res.status, res.body.ok, res.body.mode, res.body.n, res.body.written, res.body.refused], [200, true, "warn", 4, 4, 0], "a batch of four keys is written, whatever mix of objects and JSON text carries the payloads");
    eq(r.d.trips.slice(before).map((t) => t.kind), ["batch", "batch"], "in two D1 trips: one read of the stored tuples and the universe, one write batch");
    eq(res.body.trips, 1, "and the write batch is reported as one");
    eq(res.body.results.map((x) => [x.key, x.ok, x.stored, x.cas, x.would, x.flags]), mixed.map((x) => [x.key, true, "written", "new", [], []]), "each result carries its key, the verdict and what the door would have said");
    for (const item of mixed) ok(rowOf(r.d, item.key).chash === res.body.results.find((x) => x.key === item.key).chash && rowOf(r.d, item.key).rev === 1, item.key + " carries its metadata");
    eq(Object.keys(JSON.parse(r.d.db.prepare("SELECT payload FROM flows_payload WHERE id = 'manifest'").get().payload)).sort(), ["card-x:AAPL", "card:AAPL", "hist:AAPL", "universe"], "and the manifest names all four");
    eq(ring(r.d), [], "with the ring untouched");
    const again = await r.call("POST", "?op=batch", { body: { items: mixed } });
    eq(again.body.results.map((x) => x.cas), ["unchanged", "unchanged", "unchanged", "unchanged"], "the same four again are unchanged, and written");
  }

  {
    const r = rig();
    const hist = emitRead(emitDir, "hist:AAPL");
    const text = JSON.stringify(hist);
    const wrongTicker = { ...clone(hist), ticker: "MSFT" };
    const items = [
      { key: "hist:AAPL", payload: text },
      { key: "hist:AAPL", payload: text },
      { key: "bogus", payload: "{}" },
      { key: "live:market", payload: "{}" },
      { key: "board:long:2026-08-24", payload: "{}" },
      { key: "ideas:2026-08-24", payload: "{}" },
      { key: "meta", payload: "{}" },
      { key: "pulse", payload: "not json" },
      { key: "news" },
      { key: "regime", payload: "x".repeat(128 * 1024 + 1) },
      { key: "hist:GLD", payload: JSON.stringify({ ...wrongTicker, ticker: "AAPL" }) },
      { key: "hist:MSFT", payload: JSON.stringify(wrongTicker), hash: "sha256-" + "0".repeat(64) },
      null,
    ];
    const res = await r.call("POST", "?op=batch", { body: { items } });
    eq(res.status, 200, "refusals are per item and the request is a 200");
    eq(res.body.results.map((x) => (x ? [x.key, x.ok, x.code || x.stored] : x)), [
      ["hist:AAPL", true, "written"], ["hist:AAPL", false, "duplicate_key"], ["bogus", false, "invalid_key"], ["live:market", false, "invalid_key"],
      ["board:long:2026-08-24", false, "archive_in_batch"], ["ideas:2026-08-24", false, "archive_in_batch"], ["meta", false, "single_only"],
      ["pulse", false, "invalid_payload"], ["news", false, "invalid_payload"], ["regime", false, "payload_too_large"],
      ["hist:GLD", true, "written"], ["hist:MSFT", true, "written"], ["", false, "invalid_key"],
    ], "each item is judged on its own: duplicates, unknown and live keys, archive keys, meta, non-JSON, missing and oversized payloads, and a null entry");
    eq(res.body.results[10].would, ["ticker_mismatch"], "a payload for another name is named and written");
    eq(res.body.results[11].would, ["hash_mismatch"], "and a wrong per-item hash is named");
    eq([res.body.written, res.body.refused], [3, 10], "the totals count them");
    eq(ring(r.d).map((x) => [x.payload_key, x.reason, x.mode]).sort(), [["hist:GLD", "ticker_mismatch", "warn"], ["hist:MSFT", "hash_mismatch", "warn"]], "and the ring holds the would-have-refused events of the written ones");
    eq(["pulse", "news", "regime", "meta"].map((k) => rowOf(r.d, k)), [undefined, undefined, undefined, undefined], "nothing refused was written");
  }

  {
    const r = rig();
    r.d.db.exec("CREATE TRIGGER poison BEFORE INSERT ON flows_payload WHEN NEW.id = 'hist:POISON' BEGIN SELECT RAISE(ABORT, 'poison pill'); END");
    const template = emitRead(emitDir, "hist:AAPL");
    const names = Array.from({ length: 20 }, (_, i) => (i === 7 ? "POISON" : "T" + String(i).padStart(2, "0")));
    const items = names.map((t) => ({ key: "hist:" + t, payload: JSON.stringify({ ...template, ticker: t }) }));
    const before = r.d.trips.length;
    const res = await r.call("POST", "?op=batch", { body: { items } });
    eq(res.status, 200, "a batch with one poisoned key is a 200");
    eq(res.body.results.filter((x) => !x.ok).map((x) => [x.key, x.code]), [["hist:POISON", "store_refused"]], "naming only the poison key");
    eq(res.body.written, 19, "the other nineteen are committed");
    eq(r.d.db.prepare("SELECT count(*) AS n FROM flows_payload WHERE id LIKE 'hist:%'").get().n, 19, "and the poison key is not in the store");
    ok(res.body.trips > 2 && res.body.trips <= 12, "THE DOOR BISECTED to find it: " + res.body.trips + " write trips for 20 statements in two batches, not 20 single writes");
    const events = ring(r.d);
    eq(events.map((x) => [x.payload_key, x.reason, x.mode]), [["hist:POISON", "store_refused", "held"]], "the poison key is quarantined with mode held");
    ok(/poison pill/.test(events[0].path) && events[0].body !== null, "with the store's reason and the body");
    eq(r.d.trips.slice(before).filter((t) => t.kind === "batch").length >= 3, true, "the trips are real D1 batches");

    const lone = rig();
    lone.d.fail(/INSERT INTO flows_payload/);
    const refused = await lone.call("POST", "?op=batch", { body: { items: [{ key: "hist:AAPL", payload: JSON.stringify(template) }] } });
    eq([refused.status, refused.body.results.map((x) => [x.ok, x.code]), refused.body.written], [200, [[false, "store_refused"]], 0], "a batch of one that the store refuses is reported, not thrown");

    const lost = rig();
    const flaky = { prepare: (sql) => lost.d.D1.prepare(sql), batch: async () => { throw new Error("D1_ERROR: Network connection lost"); } };
    const out = await lost.call("POST", "?op=batch", { body: { items: items.slice(0, 5) }, env: { DB: flaky } });
    ok(out.status === undefined && /Network connection lost/.test(out.error.message), "a transient failure is not bisected: it surfaces as the store's own error, as a single write's does");
    eq(lost.d.db.prepare("SELECT count(*) AS n FROM flows_payload").get().n, 0, "with nothing written");

    const down = rig();
    let calls = 0;
    const broken = { prepare: (sql) => down.d.D1.prepare(sql), batch: async (list) => { calls++; if (list.some((s) => /INSERT INTO flows_payload/.test(s.sql))) throw new Error("constraint failed"); return down.d.D1.batch(list); } };
    const storm = await down.call("POST", "?op=batch", { body: { items: Array.from({ length: 100 }, (_, i) => ({ key: "hist:T" + String(i).padStart(3, "0"), payload: JSON.stringify({ ...template, ticker: "T" + String(i).padStart(3, "0") }) })) }, env: { DB: broken } });
    ok(storm.status === undefined && /constraint failed/.test(storm.error.message), "and a store that refuses everything stops being bisected after forty failures and surfaces its error");
    ok(calls <= 60, "which costs " + calls + " batches, not the two hundred a full bisection of a hundred statements would");
  }

  {
    const r = rig();
    const tooMany = await r.call("POST", "?op=batch", { body: { items: Array.from({ length: 101 }, (_, i) => ({ key: "hist:T" + i, payload: "{}" })) } });
    eq([tooMany.status, tooMany.error.code], [400, "too_many_keys"], "more than 100 keys in a batch is too many");
    const exactly = await r.call("POST", "?op=batch", { body: { items: Array.from({ length: 100 }, (_, i) => ({ key: "hist:T" + i, payload: "{}" })) } });
    eq([exactly.status, exactly.body.n], [200, 100], "and exactly 100 is not");
    eq((await r.call("POST", "?op=batch", { body: { items: [] } })).error.code, "invalid_payload", "an empty list is refused");
    eq((await r.call("POST", "?op=batch", { body: "{{" })).error.code, "invalid_payload", "a body that is not JSON is refused");
    eq((await r.call("POST", "?op=batch", { body: "[]" })).error.code, "invalid_payload", "and so is one with no items field");
    eq((await r.call("POST", "?op=batch", { body: "x".repeat(2 * 1024 * 1024 + 8192) })).error.code, "payload_too_large", "a body past 2 MiB is too large");
    eq((await r.call("GET", "?op=batch")).error.code, "method_not_allowed", "a batch is a POST");
    eq((await r.call("GET", "?op=batch")).error.headers, { Allow: "POST" }, "and says so");
    eq((await r.call("POST", "?op=batch", { body: { items: [] }, token: null })).error.code, "unauthorized", "a batch needs a credential");
    eq((await r.call("POST", "?op=batch", { body: { items: [] }, token: LIVE, base: "http://127.0.0.1:8787" })).error.code, "live_token_scope", "and the nightly's, not the live token's");
    eq((await r.call("POST", "?op=zzz", { body: {} })).error.code, "invalid_op", "an unknown operation is refused");
    eq((await r.call("POST", "?op=batch", { body: { items: [] }, env: { DB: undefined } })).error.code, "store_unreadable", "and a Worker with no D1 binding says the store is unreadable");
  }

  {
    const r = rig();
    const keys = ["card:AAPL", "hist:AAPL", "card-x:AAPL"];
    const written = [];
    for (const k of keys) written.push((await r.put(k, JSON.stringify(emitRead(emitDir, k)))).body.door.chash);
    const asked = [
      { key: "card:AAPL", chash: written[0] }, { key: "hist:AAPL", chash: "0".repeat(64) }, { key: "card-x:AAPL", chash: written[2] },
      { key: "card:MSFT", chash: written[0] },
    ];
    const res = await r.call("POST", "?op=have", { body: { items: asked } });
    eq([res.status, res.body.have, res.body.need], [200, ["card:AAPL", "card-x:AAPL"], ["hist:AAPL", "card:MSFT"]], "op=have answers which of the asked (key, hash) pairs the store holds: the right hash, the wrong hash and the absent key");
    const before = r.d.trips.length;
    await r.call("POST", "?op=have", { body: { items: asked } });
    eq(r.d.trips.slice(before).map((t) => [t.kind, t.sqls.length]), [["all", 1]], "in one statement and one trip");
    await r.put("pulse", JSON.stringify(emitRead(emitDir, "pulse")), { env: { FLOWS_DOOR_V2: "off" } });
    const legacy = await r.call("POST", "?op=have", { body: { items: [{ key: "pulse", chash: "1".repeat(64) }] } });
    eq(legacy.body.need, ["pulse"], "a row written by the v1 writer has no hash and is always needed");
    eq((await r.call("POST", "?op=have", { body: { items: Array.from({ length: 91 }, (_, i) => ({ key: "card:T" + i, chash: "a".repeat(64) })) } })).error.code, "too_many_keys", "at most 90 pairs, the bound parameters one statement can carry");
    eq((await r.call("POST", "?op=have", { body: { items: Array.from({ length: 90 }, (_, i) => ({ key: "card:T" + i, chash: "a".repeat(64) })) } })).status, 200, "and 90 is fine");
    eq((await r.call("POST", "?op=have", { body: { items: [{ key: "card:AAPL", chash: "nope" }] } })).error.code, "invalid_payload", "a hash is 64 hex characters");
    eq((await r.call("POST", "?op=have", { body: { items: [{ key: "bogus", chash: "a".repeat(64) }] } })).error.code, "invalid_key", "a key is an ingest key");
    eq((await r.call("POST", "?op=have", { body: { items: [{ key: "live:market", chash: "a".repeat(64) }] } })).error.code, "invalid_key", "never a live key");
    eq((await r.call("POST", "?op=have", { body: { items: [{ key: "card:AAPL", chash: "a".repeat(64) }, { key: "card:AAPL", chash: "a".repeat(64) }] } })).error.code, "invalid_key", "and not twice");
    eq((await r.call("GET", "?op=have")).error.code, "method_not_allowed", "it is a POST");
    r.d.fail(/SELECT id, chash FROM/);
    eq((await r.call("POST", "?op=have", { body: { items: asked } })).error.code, "store_unreadable", "and a store that cannot answer is 503 store_unreadable");
  }

  {
    const r = rig();
    const none = await r.call("GET", "?op=plan");
    eq([none.status, none.body], [200, { status: "pending" }], "no plan stored reads pending");
    const first = await r.call("POST", "?op=plan", { body: { session: "2026-08-24", names: ["MSFT", "AAPL", "AAPL"] } });
    eq([first.status, first.body], [200, { ok: true, session: "2026-08-24", n: 2, stored: "written" }], "a plan is stored: the session and the deduplicated names");
    const read = await r.call("GET", "?op=plan");
    eq([read.body.session, read.body.names, read.body.updatedAt], ["2026-08-24", ["AAPL", "MSFT"], NOW], "and read back");
    const older = await r.call("POST", "?op=plan", { body: { session: "2026-08-21", names: ["GLD"] } });
    eq(older.body.stored, "older", "an older session's plan does not replace it");
    eq((await r.call("GET", "?op=plan")).body.names, ["AAPL", "MSFT"], "the stored plan stands");
    const same = await r.call("POST", "?op=plan", { body: { session: "2026-08-24", names: ["GLD"] } });
    eq([same.body.stored, (await r.call("GET", "?op=plan")).body.names], ["written", ["GLD"]], "while the same session's later plan does");
    eq((await r.call("POST", "?op=plan", { body: { session: "2026-08-25", names: [] } })).error.code, "invalid_payload", "a session after the next expected is refused");
    eq((await r.call("POST", "?op=plan", { body: { session: "2026-08-24", names: ["bad name"] } })).error.code, "invalid_payload", "and so is a name off the grammar");
    eq((await r.call("POST", "?op=plan", { body: "{{" })).error.code, "invalid_payload", "and a body that is not JSON");
    eq((await r.call("PUT", "?op=plan")).error.code, "method_not_allowed", "and a method that is neither GET nor POST");
    eq((await r.call("POST", "?op=plan", { body: { session: "2026-08-24", names: [] }, token: LIVE, base: "http://127.0.0.1:8787" })).error.code, "live_token_scope", "the live token cannot post a plan");
    eq(rowOf(r.d, "plan").chash, null, "the plan row is unverified and so never reaches the manifest");
    eq(Object.keys(JSON.parse(r.d.db.prepare("SELECT payload FROM flows_payload WHERE id = 'manifest'")?.get()?.payload || "{}")), [], "which no write of it created");
    const off = await r.call("GET", "?op=plan", { env: { FLOWS_DOOR_V2: "off" } });
    eq(off.error.code, "invalid_key", "with the door off, op=plan is not an operation: the request reads as it did, a missing key");
  }

  {
    const store = createFlowsStore({ ensureFlowsTables: async () => {} });
    const verdicts = [];
    const epochs = [1, 2];
    const sessions = [null, "2026-08-21", "2026-08-24"];
    const qualities = [0, 1, 2];
    const asofs = [0, 1];
    const tuples = [];
    for (const epoch of epochs) for (const session of sessions) for (const quality of qualities) for (const asof of asofs) tuples.push({ epoch, session, quality, asof });
    const d = fakeD1({ latencyMs: 0 });
    const env = { DB: d.D1 };
    let mismatches = 0;
    let cases = 0;
    for (const s of tuples) {
      for (const i of tuples) {
        for (const same of [false, i.epoch === s.epoch && i.session === s.session && i.quality === s.quality && i.asof === s.asof]) {
          d.db.prepare("DELETE FROM flows_payload WHERE id = 'card:CAS'").run();
          d.db.prepare("INSERT INTO flows_payload (id, payload, updated_at, chash, session, quality, epoch, asof, rev) VALUES ('card:CAS', '{}', 1, 'S', ?, ?, ?, ?, 1)").run(s.session, s.quality, s.epoch, s.asof);
          const incoming = { ...i, chash: same ? "S" : "I" };
          const changed = await store.doorWrite(env, "card:CAS", "{\"n\":1}", 2, incoming, { enforce: true });
          const verdict = DOOR.casVerdict({ ...s, chash: "S" }, incoming);
          const expected = verdict === "advance" || verdict === "new" ? 1 : 0;
          cases++;
          if (changed !== expected) mismatches++;
          verdicts.push(verdict);
        }
      }
    }
    eq(mismatches, 0, "THE SQL COMPARE-AND-SET AND THE JS VERDICT AGREE on all " + cases + " pairs of stored and incoming tuples: a row changes exactly when the verdict is new or advance");
    ok(["advance", "superseded", "unchanged"].every((v) => verdicts.includes(v)), "and the grid reaches every verdict");
    d.db.prepare("DELETE FROM flows_payload WHERE id = 'card:CAS'").run();
    d.db.prepare("INSERT INTO flows_payload (id, payload, updated_at) VALUES ('card:CAS', '{}', 1)").run();
    eq(await store.doorWrite(env, "card:CAS", "{}", 2, { chash: "I", session: "2026-08-21", quality: 0, epoch: 1, asof: 0 }, { enforce: true }), 1, "a legacy row with no metadata yields to any verified write");
    const read = await store.doorRead(env, ["card:CAS", "card:NONE"], { names: false });
    eq([read.stored.size, read.stored.get("card:CAS").chash, read.names], [1, "I", null], "doorRead returns the tuples of the keys it finds");
  }

  {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]+)\2/g;
    const count = (text, needle) => text.split(needle).length - 1;
    const mutatedUrl = (rel, transforms) => {
      const file = path.join(ROOT, rel);
      let text = readFileSync(file, "utf8");
      for (const [from, to] of transforms) {
        assert.equal(count(text, from), 1, "the planted change applies once to " + rel + ": " + from.slice(0, 60));
        text = text.replace(from, () => to);
      }
      const body = text.replace(SPECIFIER, (m, head, quote, spec) => head + quote + pathToFileURL(path.resolve(path.dirname(file), spec)).href + quote);
      return "data:text/javascript;base64," + Buffer.from(body).toString("base64");
    };
    const real = { leaf: DOOR, createFlowsStore, rows: flowsIngestRows };
    const attempt = async (label, fn, failed) => { try { await fn(); } catch { failed.push(label); } };

    const leafBattery = async (L) => {
      const failed = [];
      const emit = (k) => JSON.stringify(emitRead(emitDir, k));
      await attempt("canonical hash ignores the stamps", () => assert.equal(
        L.canonicalize({ a: 1, generatedAt: "x", fresh: { readAt: "y" } }).text, L.canonicalize({ a: 1, generatedAt: "z", fresh: { readAt: "w" } }).text), failed);
      await attempt("an equal tuple with other content advances", () => assert.equal(L.casVerdict({ epoch: 1, session: "d", quality: 5, asof: 5, chash: "a" }, { epoch: 1, session: "d", quality: 5, asof: 5, chash: "b" }), "advance"), failed);
      await attempt("the same hash is unchanged", () => assert.equal(L.casVerdict({ epoch: 1, session: "d", quality: 5, asof: 5, chash: "a" }, { epoch: 1, session: "d", quality: 9, asof: 9, chash: "a" }), "unchanged"), failed);
      await attempt("an older session is superseded", () => assert.equal(L.casVerdict({ epoch: 1, session: "2026-08-24", quality: 5, asof: 5, chash: "a" }, { epoch: 1, session: "2026-08-21", quality: 9, asof: 9, chash: "b" }), "superseded"), failed);
      await attempt("a higher epoch outranks everything", () => assert.equal(L.casVerdict({ epoch: 1, session: "2026-08-24", quality: 255, asof: 5, chash: "a" }, { epoch: 2, session: "2026-08-21", quality: 0, asof: 0, chash: "b" }), "advance"), failed);
      await attempt("a size collapse is named", () => assert.deepEqual(L.assess({ structural: [], product: "card", bytes: 30, session: "2026-08-24", pct: 63, baseTotal: 13, epoch: 1, quality: 255, asof: 7, chash: "x" }, { bytes: 100, chash: "y", session: "2026-08-24", quality: 255, epoch: 1, asof: 3 }, {}).would.map((x) => x.code), ["size_collapse"]), failed);
      await attempt("a regression is named", () => assert.equal(L.regressionOf({ quality: 255, session: "2026-08-21" }, { pct: 34, session: "2026-08-24", baseTotal: 13 }), true), failed);
      await attempt("completeness outranks level", () => {
        const l1 = L.inspect("card:" + tickerOfDepth("cross"), emit("card:" + tickerOfDepth("cross")), { now: NOW });
        const l2 = JSON.parse(emit("card:AAPL"));
        l2.panels.gamma.status = "unavailable";
        const part = L.inspect("card:AAPL", JSON.stringify(l2), { now: NOW });
        assert.ok(l1.quality > part.quality);
      }, failed);
      await attempt("a future session is named", () => {
        const o = JSON.parse(emit("hist:AAPL"));
        o.sessionDate = "2026-08-25";
        assert.deepEqual(L.inspect("hist:AAPL", JSON.stringify(o), { now: NOW }).structural.map((x) => x.code), ["session_future"]);
      }, failed);
      await attempt("a range violation is a flag and not structural", () => {
        const u = JSON.parse(emit("universe"));
        u.cols.px[0] = -100;
        const r = L.inspect("universe", JSON.stringify(u), { now: NOW });
        assert.deepEqual([r.structural.length, r.flags.length], [0, 1]);
      }, failed);
      await attempt("only the word warn is warn", () => assert.equal(L.doorMode({ FLOWS_DOOR_V2: "enforce" }), "off"), failed);
      return failed;
    };

    const stackBattery = async ({ createFlowsStore: makeStore, rows }) => {
      const failed = [];
      const template = emitRead(emitDir, "hist:AAPL");
      const text = JSON.stringify(template);
      const bad = JSON.stringify({ ...template, ticker: "MSFT" });
      const fresh = () => rig({ modules: { store: makeStore, rows } });
      await attempt("a warn write never refuses", async () => {
        const r = fresh();
        const res = await r.put("hist:AAPL", bad);
        assert.equal(res.status, 200);
        assert.equal(JSON.parse(r.d.db.prepare("SELECT payload FROM flows_payload WHERE id = 'hist:AAPL'").get().payload).ticker, "MSFT");
      }, failed);
      await attempt("a wrong hash is named", async () => {
        const res = await fresh().put("hist:AAPL", text, { headers: { "X-Content-Hash": "sha256-" + "0".repeat(64) } });
        assert.deepEqual(res.body.door.would, ["hash_mismatch"]);
      }, failed);
      await attempt("a ring that cannot be written never fails the ingest", async () => {
        const r = fresh();
        r.d.fail(/INSERT INTO flows_quarantine/);
        assert.equal((await r.put("hist:AAPL", bad)).status, 200);
      }, failed);
      await attempt("off ignores op", async () => {
        const res = await fresh().call("POST", "?op=have", { body: { items: [] }, env: { FLOWS_DOOR_V2: "off" } });
        assert.equal(res.error.code, "invalid_key");
      }, failed);
      await attempt("off answers as v1", async () => {
        const r = fresh();
        const res = await r.put("hist:AAPL", text, { env: { FLOWS_DOOR_V2: "off" } });
        assert.deepEqual(Object.keys(res.body).sort(), ["bytes", "key", "ok"]);
        assert.equal(r.d.db.prepare("SELECT chash FROM flows_payload WHERE id = 'hist:AAPL'").get().chash, null);
      }, failed);
      await attempt("the v1 writer clears the metadata", async () => {
        const r = fresh();
        await r.put("hist:AAPL", text);
        await r.put("hist:AAPL", text + " ", { env: { FLOWS_DOOR_V2: "off" } });
        const row = r.d.db.prepare("SELECT chash, session, quality, epoch, asof FROM flows_payload WHERE id = 'hist:AAPL'").get();
        assert.deepEqual({ ...row }, { chash: null, session: null, quality: 0, epoch: 0, asof: 0 });
      }, failed);
      await attempt("the ring holds 200 rows", async () => {
        const r = fresh();
        for (let i = 0; i < 205; i++) await r.put("hist:AAPL", JSON.stringify({ ...JSON.parse(bad), trimmed: i }));
        assert.equal(r.d.db.prepare("SELECT count(*) AS n FROM flows_quarantine").get().n, 200);
      }, failed);
      await attempt("the brake holds the bodies of a flood", async () => {
        const r = fresh();
        for (let i = 0; i < 25; i++) await r.put("hist:AAPL", JSON.stringify({ ...JSON.parse(bad), trimmed: i }));
        assert.equal(r.d.db.prepare("SELECT count(*) AS n FROM flows_quarantine WHERE braked = 1").get().n, 5);
      }, failed);
      await attempt("a poison key is bisected out of its batch", async () => {
        const r = fresh();
        r.d.db.exec("CREATE TRIGGER poison BEFORE INSERT ON flows_payload WHEN NEW.id = 'hist:POISON' BEGIN SELECT RAISE(ABORT, 'poison pill'); END");
        const items = ["T1", "POISON", "T3", "T4"].map((t) => ({ key: "hist:" + t, payload: JSON.stringify({ ...template, ticker: t }) }));
        const res = await r.call("POST", "?op=batch", { body: { items } });
        assert.equal(res.body.written, 3);
        assert.equal(r.d.db.prepare("SELECT count(*) AS n FROM flows_payload WHERE id LIKE 'hist:%'").get().n, 3);
      }, failed);
      await attempt("the SQL compare-and-set keeps the higher tuple", async () => {
        const d = fakeD1({ latencyMs: 0 });
        const store = makeStore({ ensureFlowsTables: async () => {} });
        d.db.prepare("INSERT INTO flows_payload (id, payload, updated_at, chash, session, quality, epoch, asof, rev) VALUES ('hist:Q', '{}', 1, 'S', '2026-08-24', 5, 1, 5, 1)").run();
        const env = { DB: d.D1 };
        const write = (m) => store.doorWrite(env, "hist:Q", "{}", 2, { chash: "I", session: "2026-08-24", quality: 5, epoch: 1, asof: 5, ...m }, { enforce: true });
        assert.equal(await write({ asof: 4 }), 0);
        assert.equal(await write({}), 1);
        assert.equal(await write({ asof: 9, chash: "J" }), 1);
      }, failed);
      return failed;
    };

    eq(await leafBattery(DOOR), [], "THE BATTERIES PASS ON THE SHIPPED CODE: eleven leaf behaviours");
    eq(await stackBattery(real), [], "and ten behaviours of the whole stack, store, door and route");

    const leaf = (transforms) => import(mutatedUrl("shared/flows-door.js", transforms));
    const leafMutants = [
      ["the volatile stamps stay in the hash", [["const VOLATILE = Object.freeze([\"generatedAt\", \"readAt\", \"screenerReadAt\", \"refreshedAt\", \"producer\", \"fresh.readAt\"]);", "const VOLATILE = Object.freeze([]);"]], "canonical hash ignores the stamps"],
      ["an equal tuple is superseded", [["tupleOf(stored)) >= 0 ? \"advance\"", "tupleOf(stored)) > 0 ? \"advance\""]], "an equal tuple with other content advances"],
      ["the same hash is not recognised", [["if (typeof stored.chash === \"string\" && stored.chash === incoming.chash) return \"unchanged\";", ""]], "the same hash is unchanged"],
      ["the epoch is read last", [["Number(m && m.epoch) || 0, (m && typeof m.session === \"string\" && m.session) || \"\", Number(m && m.quality) || 0,", "(m && typeof m.session === \"string\" && m.session) || \"\", Number(m && m.epoch) || 0, Number(m && m.quality) || 0,"]], "a higher epoch outranks everything"],
      ["a collapse never fires", [["collapseFloor: 0.4", "collapseFloor: 0"]], "a size collapse is named"],
      ["the regression compares the wrong way", [["stored.session < incoming.session", "stored.session > incoming.session"]], "a regression is named"],
      ["level outranks completeness", [["quality: pct * 4 + tier", "quality: tier * 64 + pct"]], "completeness outranks level"],
      ["a future session passes", [["if (horizon !== null && session > horizon) structural.push({ code: \"session_future\", path: \"sessionDate\" });", ""]], "a future session is named"],
      ["a range violation quarantines", [["if (bad) flags.push({ code: \"range\", path: \"cols.\" + k, n: bad });", "if (bad) structural.push({ code: \"range\", path: \"cols.\" + k });"]], "a range violation is a flag and not structural"],
      ["enforce is read as warn", [["env.FLOWS_DOOR_V2 === \"warn\" ? \"warn\"", "(env.FLOWS_DOOR_V2 === \"warn\" || env.FLOWS_DOOR_V2 === \"enforce\") ? \"warn\""]], "only the word warn is warn"],
    ];
    for (const [title, transforms, expected] of leafMutants) {
      const failed = await leafBattery(await leaf(transforms));
      ok(failed.includes(expected), "PLANTED WRONG BUILD, " + title + ": the battery fails \"" + expected + "\" (" + failed.join("; ") + ")");
    }

    const storeFrom = async (transforms) => (await import(mutatedUrl("server/store.js", transforms))).createFlowsStore;
    const storeMutants = [
      ["the v1 writer leaves the metadata", [["\"chash = NULL, session = NULL, quality = 0, epoch = 0, asof = 0, rev = flows_payload.rev + 1\";", "\"rev = flows_payload.rev + 1\";"]], "the v1 writer clears the metadata"],
      ["the ring prune keeps one row too many", [["\"DELETE FROM flows_quarantine WHERE id <= COALESCE(", "\"DELETE FROM flows_quarantine WHERE id < COALESCE("]], "the ring holds 200 rows"],
      ["the brake never closes", [["CASE WHEN b.n >= ?9 THEN 1 ELSE 0 END", "CASE WHEN b.n >= ?9 THEN 0 ELSE 0 END"]], "the brake holds the bodies of a flood"],
      ["a failed batch is not bisected", [["await commit(group.slice(0, mid));", "throw error;"]], "a poison key is bisected out of its batch"],
      ["the compare-and-set is strict", [["excluded.quality, excluded.asof) >= ", "excluded.quality, excluded.asof) > "]], "the SQL compare-and-set keeps the higher tuple"],
    ];
    for (const [title, transforms, expected] of storeMutants) {
      const failed = await stackBattery({ createFlowsStore: await storeFrom(transforms), rows: flowsIngestRows });
      ok(failed.includes(expected), "PLANTED WRONG BUILD, " + title + ": the battery fails \"" + expected + "\" (" + failed.join("; ") + ")");
    }

    const doorRows = async (transforms) => {
      const doorUrl = mutatedUrl("server/door.js", transforms);
      const routeUrl = mutatedUrl("server/routes/flows-ingest.js", [["from \"../door.js\"", "from \"" + doorUrl + "\""]]);
      return (await import(routeUrl)).flowsIngestRows;
    };
    const doorMutants = [
      ["warn mode refuses what it would quarantine", [["await store.doorWrite(env, key, payload, now, m);", "if (verdict.would.length) throw HttpError.of(\"invalid_payload\"); await store.doorWrite(env, key, payload, now, m);"]], "a warn write never refuses"],
      ["a ring that fails fails the ingest", [["log(\"warn\", \"door ring not recorded\", { n: kept.length }, error);", "throw error;"]], "a ring that cannot be written never fails the ingest"],
      ["a wrong hash is not noticed", [["mismatch = !parsed || !parsed.ok || parsed.hex !== await sha256Hex(text);", "mismatch = false;"]], "a wrong hash is named"],
      ["the batch trusts every store write", [["if (outcome && outcome.ok) {", "if (true) {"]], "a poison key is bisected out of its batch"],
    ];
    for (const [title, transforms, expected] of doorMutants) {
      const failed = await stackBattery({ createFlowsStore, rows: await doorRows(transforms) });
      ok(failed.includes(expected), "PLANTED WRONG BUILD, " + title + ": the battery fails \"" + expected + "\" (" + failed.join("; ") + ")");
    }

    const routeRows = async (transforms) => (await import(mutatedUrl("server/routes/flows-ingest.js", transforms))).flowsIngestRows;
    const routeMutants = [
      ["op is honoured with the door off", [["if (mode !== \"off\" && url.searchParams.has(\"op\"))", "if (url.searchParams.has(\"op\"))"]], "off ignores op"],
      ["the door answers with the door off", [["if (mode !== \"off\") return door.write(", "if (true) return door.write("]], "off answers as v1"],
    ];
    for (const [title, transforms, expected] of routeMutants) {
      const failed = await stackBattery({ createFlowsStore, rows: await routeRows(transforms) });
      ok(failed.includes(expected), "PLANTED WRONG BUILD, " + title + ": the battery fails \"" + expected + "\" (" + failed.join("; ") + ")");
    }
  }

} finally {
  Date.now = realNow;
}

console.log("flows-door-v2: " + checks + " checks");
