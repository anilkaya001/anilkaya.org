import assert from "node:assert/strict";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const INGEST = "https://ingest.test/api/flows/ingest";
process.env.FLOWS_INGEST_URL = INGEST;
process.env.FLOWS_INGEST_TOKEN = "t";
delete process.env.FLOWS_WRITE_BATCH;

const realFetch = globalThis.fetch;
const quiet = { log: console.log, warn: console.warn };
console.log = () => {};
console.warn = () => {};

function world({ batchStatus = 200, refuse = new Set(), singleFail = new Set(), shortAnswer = false } = {}) {
  const seen = { batches: [], singles: [], stored: new Map() };
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.searchParams.get("op") === "batch") {
      const items = JSON.parse(init.body).items;
      seen.batches.push(items.map((i) => i.key));
      if (batchStatus !== 200) return new Response("no", { status: batchStatus });
      const results = items.map((i) => {
        if (refuse.has(i.key)) return { key: i.key, ok: false, code: "store_refused" };
        seen.stored.set(i.key, i.payload);
        return { key: i.key, ok: true, stored: "written" };
      });
      return Response.json({ ok: true, results: shortAnswer ? results.slice(1) : results });
    }
    const key = u.searchParams.get("key");
    seen.singles.push(key);
    if (singleFail.has(key)) return new Response("{}", { status: 400 });
    seen.stored.set(key, init.body);
    return Response.json({ ok: true });
  };
  return seen;
}

async function run(transforms, body, salt) {
  const store = await loadMutated("scripts/flows-nightly/store.mjs", transforms, { salt });
  return body(store);
}

const names = (n, kind = "card") => Array.from({ length: n }, (_, i) => `${kind}:T${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);

const battery = async (store) => {
  const out = [];
  const t = (name, pass) => out.push([name, !!pass]);
  {
    const seen = world();
    const keys = names(90);
    await Promise.all(keys.map((k, i) => store.publish(k, { ticker: k.slice(5), n: i })));
    t("ninety keys published together travel in three requests", seen.batches.length === 3 && seen.singles.length === 0);
    t("no batch carries more than the item limit", seen.batches.every((b) => b.length <= store.WRITE_BATCH.items));
    t("every key lands once with its own payload", keys.every((k, i) => JSON.parse(seen.stored.get(k)).n === i) && keys.every((k) => store.landedKeys.has(k)));
    t("the batches keep the order the keys were published in", JSON.stringify(seen.batches.flat()) === JSON.stringify(keys));
    t("the counters say so", store.writeBatchStats.keys === 90 && store.writeBatchStats.batches === 3 && store.writeBatchStats.fellBack === 0);
  }
  {
    const seen = world();
    await Promise.all([store.publish("board:long", { rows: [] }), store.publish("card:ZZA", { a: 1 }), store.publish("oracle-top", { items: [] })]);
    t("a key that is not a per-name product is written alone", seen.singles.includes("board:long") && seen.singles.includes("oracle-top") && !seen.batches.flat().includes("board:long"));
    t("and the per-name key beside it is batched", seen.batches.flat().includes("card:ZZA"));
  }
  {
    const seen = world({ refuse: new Set(["card-x:ZZB"]) });
    await Promise.all([store.publish("card-x:ZZB", { a: 1 }), store.publish("card-x:ZZC", { a: 2 })]);
    t("an item the batch refuses is written again alone", seen.singles.length === 1 && seen.singles[0] === "card-x:ZZB" && store.landedKeys.has("card-x:ZZB"));
    t("and the accepted item is not written twice", !seen.singles.includes("card-x:ZZC") && store.landedKeys.has("card-x:ZZC"));
  }
  {
    const seen = world({ refuse: new Set(["hist:ZZD"]), singleFail: new Set(["hist:ZZD"]) });
    const settled = await Promise.allSettled([store.publish("hist:ZZD", { a: 1 }), store.publish("hist:ZZE", { a: 2 })]);
    t("a key refused by the batch and by its own write rejects its publish", settled[0].status === "rejected" && /hist:ZZD/.test(settled[0].reason.message) && !store.landedKeys.has("hist:ZZD"));
    t("and only that publish", settled[1].status === "fulfilled" && seen.stored.has("hist:ZZE"));
  }
  {
    const seen = world();
    await Promise.all([store.publish("card:ZZF", { v: 1 }), store.publish("card:ZZF", { v: 2 })]);
    t("one key published twice goes in two requests, the later payload last", seen.batches.length === 2 && JSON.parse(seen.stored.get("card:ZZF")).v === 2);
  }
  {
    const seen = world();
    const big = "x".repeat(600 * 1024);
    await Promise.all(["ZZG", "ZZH", "ZZI"].map((n) => store.publish("card-x:" + n, { big })));
    t("a batch stops at the byte limit", seen.batches.length === 2 && seen.batches[0].length === 2 && seen.batches[1].length === 1);
  }
  {
    process.env.FLOWS_WRITE_BATCH = "off";
    const seen = world();
    await Promise.all([store.publish("card:ZZJ", { a: 1 }), store.publish("card:ZZK", { a: 1 })]);
    delete process.env.FLOWS_WRITE_BATCH;
    t("the switch off writes one key a request", seen.batches.length === 0 && seen.singles.length === 2);
  }
  {
    const seen = world({ shortAnswer: true });
    await Promise.all([store.publish("card:ZZL", { a: 1 }), store.publish("card:ZZM", { a: 1 })]);
    t("an answer that does not account for every item is not believed", seen.singles.length === 2 && store.landedKeys.has("card:ZZL") && store.landedKeys.has("card:ZZM"));
    const after = world();
    await store.publish("card:ZZN", { a: 1 });
    t("and the run stops batching", after.batches.length === 0 && after.singles.length === 1 && typeof store.writeBatchStats.off === "string");
    store.resetWriteBatch();
  }
  {
    const seen = world({ batchStatus: 404 });
    await Promise.all(names(5, "hist").map((k) => store.publish(k, { a: 1 })));
    t("a refused batch request falls back to single writes for every key", seen.batches.length === 1 && seen.singles.length === 5 && names(5, "hist").every((k) => store.landedKeys.has(k)));
    store.resetWriteBatch();
  }
  {
    const q = [{ key: "a", wire: "1" }, { key: "b", wire: "22" }, { key: "a", wire: "3" }, { key: "c", wire: "4" }];
    const first = store.takeBatch(q, { items: 10, bytes: 100 });
    t("takeBatch stops before a key it already holds", first.map((e) => e.key).join() === "a,b" && q.map((e) => e.key).join() === "a,c");
    const one = store.takeBatch([{ key: "z", wire: "x".repeat(50) }], { items: 10, bytes: 10 });
    t("and always takes one item, whatever its size", one.length === 1);
  }
  return out;
};

const base = await run([], battery, 0);
for (const [name, pass] of base) ok(pass, name);

const MUTANTS = [
  ["a refused item counted as landed", [["if (r && r.ok === true && r.key === e.key) {", "if (r) {"]]],
  ["no fallback when the batch request fails", [["          send(e.key, e.payload).then(e.resolve, e.reject);\n        }\n        return;", "          e.resolve();\n        }\n        return;"]]],
  ["every key batched, whatever it is", [["  return WRITE_BATCH.keyRe.test(key);", "  return true;"]]],
  ["the batch taken before the permit", [["      await ingestWrites.acquire();\n      const entries = takeBatch(batchQueue);", "      const entries = takeBatch(batchQueue);\n      await ingestWrites.acquire();"]]],
  ["a duplicate key in one batch", [["    if (keys.has(entry.key)) break;\n", ""]]],
  ["no byte limit", [["    if (taken.length && size + entry.wire.length > bytes) break;\n", ""]]],
  ["the switch ignored", [["  if (String(env[WRITE_BATCH.switchEnv] ?? \"\").trim().toLowerCase() === \"off\") return false;\n", ""]]],
  ["a short answer believed", [["&& answer.results.length === entries.length ? answer.results : null", "? answer.results : null"]]],
];
let salt = 1;
for (const [title, transforms] of MUTANTS) {
  let failed;
  try {
    const res = await run(transforms, battery, salt++);
    failed = res.filter(([, pass]) => !pass).map(([name]) => name);
  } catch (error) {
    failed = ["threw: " + error.message];
  }
  ok(failed.length > 0, `PLANTED WRONG BUILD (${title}) must fail`);
}

globalThis.fetch = realFetch;
console.log = quiet.log;
console.warn = quiet.warn;
console.log(`✓ flows-write-batch: ${checks} assertions — per-name keys travel in batches of at most forty and 1,400 KiB taken after the write permit, in publish order, each landing once; a refused item, a short answer and a refused request fall back to single writes; the switch, the key rule and eight planted wrong builds`);
