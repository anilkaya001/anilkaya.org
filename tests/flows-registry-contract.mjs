import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTRACT, DEPTHS, GLOBAL_KEYS, NAME_KEY_EXPECTED, NAME_KINDS, PANELS, PANEL_IDS, PAYLOAD_CAP_BYTES, PRODUCTS, STATE, STATE_NAMES,
  contractFor, expectedKinds, keysOf, productById, productOf, tickerOfKey,
} from "../shared/flows-products.js";
import { LIVE_KEYS } from "../shared/flows-live.js";
import { READY_KEYS } from "../shared/flows-ready.js";
import { PERMANENT_ARCHIVE_KEY_RE } from "../shared/flows-archive.js";
import { FLOWS_MAX_PAYLOAD_BYTES } from "../shared/flows-live-worker.js";
import { UNIVERSE_BUDGET_BYTES } from "../shared/flows-cross.js";
import { EVENTS_PAYLOAD_BUDGET } from "../shared/flows-events.js";
import { DATED_ARCHIVE_KEY_RE, INGEST_LIST_KINDS, INGEST_VIEW_KEY_RE, ingestKeyParts } from "../server/store.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";
import { emitKeys } from "./lib/emit-keys.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

ok(Object.isFrozen(PRODUCTS) && PRODUCTS.every((p) => Object.isFrozen(p)), "the registry and every entry are frozen");
eq(new Set(PRODUCTS.map((p) => p.id)).size, PRODUCTS.length, "every product id is declared once");
ok(PRODUCTS.every((p) => (p.key !== null) !== (p.pattern !== null)), "an entry carries either one exact key or one pattern");
ok(PRODUCTS.every((p) => ["global", "dated", "name", "live"].includes(p.family)), "and one of the four families");
ok(PRODUCTS.every((p) => Number.isInteger(p.epoch) && p.epoch >= 1 && Array.isArray(p.volatile) && p.volatile.includes("generatedAt")), "each has an epoch and the volatile stamps");
eq(PAYLOAD_CAP_BYTES, FLOWS_MAX_PAYLOAD_BYTES, "the registry's byte cap is the ingest door's");
ok(PRODUCTS.filter((p) => p.family === "name").every((p) => p.capBytes <= FLOWS_MAX_PAYLOAD_BYTES), "no product's own cap is above the door's");
ok(PRODUCTS.filter((p) => p.family === "global").every((p) => p.capBytes <= FLOWS_MAX_PAYLOAD_BYTES), "and no shared key's either");
eq(productById("universe").capBytes, UNIVERSE_BUDGET_BYTES, "the universe's cap is the budget its shedder keeps under, so Status measures it against that");
eq(productById("events").capBytes, EVENTS_PAYLOAD_BUDGET, "the events cap is the size its fitter keeps under");

const exact = [...INGEST_VIEW_KEY_RE.source.matchAll(/\^([a-z][a-z:-]*[a-z])\$/g)].map((m) => m[1]);
ok(exact.length >= 18, "the door's grammar is read for its exact keys: " + exact.length);
eq(GLOBAL_KEYS.filter((k) => !exact.includes(k)).sort(), ["board:long", "board:short", "board:watch"], "the registry's global keys are the door's exact keys plus the three boards its grouped alternative names");
eq(exact.filter((k) => !GLOBAL_KEYS.includes(k)), [], "and the door accepts no exact key the registry lacks");
for (const key of GLOBAL_KEYS) ok(INGEST_VIEW_KEY_RE.test(key) && ingestKeyParts(key).valid, `${key}: the door accepts it`);
const DAY = "2026-08-24";
const SAMPLES = { "board:dated": [`board:long:${DAY}`, `board:short:${DAY}`], "scores:dated": [`scores:${DAY}`], "ideas:dated": [`ideas:${DAY}`, `ideas:${DAY}:r2`],
  "ideas-out:dated": [`ideas-out:${DAY}`, `ideas-out:${DAY}:r3`] };
for (const p of PRODUCTS.filter((x) => x.family === "dated")) {
  for (const key of SAMPLES[p.id]) {
    ok(productOf(key) === p && INGEST_VIEW_KEY_RE.test(key), `${key}: the registry names ${p.id} and the door accepts it`);
    eq(PERMANENT_ARCHIVE_KEY_RE.test(key), p.permanent === true, `${key}: permanence agrees with the archive rule`);
    eq(DATED_ARCHIVE_KEY_RE.test(key), /^(board|scores)/.test(key), `${key}: a dated write-once key is the one the store guards`);
  }
}
ok(!productOf(`board:watch:${DAY}`) && !INGEST_VIEW_KEY_RE.test(`board:watch:${DAY}`), "a dated watch board is nobody's");
eq(NAME_KINDS.slice(), INGEST_LIST_KINDS.slice(), "the name products are the kinds the door lists");
ok(NAME_KINDS.every((k) => productOf(k + ":NVDA") === productById(k) && tickerOfKey(k + ":NVDA") === "NVDA" && ingestKeyParts(k + ":NVDA").valid), "and each is keyed by a ticker the door accepts");
ok(productOf("card:nvda") === null && productOf("card:") === null && productOf("card:TOOLONGTICKER") === null && tickerOfKey("meta") === null, "a key with no valid ticker is nobody's");
ok(READY_KEYS.every((k) => GLOBAL_KEYS.includes(k)), "every key readiness reads is a registered global");
eq(keysOf("live").sort(), Object.keys(LIVE_KEYS).sort(), "the live products are the live key registry");
for (const [key, spec] of Object.entries(LIVE_KEYS)) {
  const p = productOf(key);
  ok(p && p.family === "live" && p.capBytes === spec.maxBytes && p.exec === spec.writer && p.klass === spec.klass, `${key}: writer, class and byte cap come from the live registry`);
}

const health = read("scripts/flows-legs/health.mjs");
const healthLive = [...new Set([...health.matchAll(/"(live:[a-z]+(?::[a-z]+)?)"/g)].map((m) => m[1]))];
ok(healthLive.length >= 3 && healthLive.every((k) => Object.hasOwn(LIVE_KEYS, k)), "every live key the health gate names is registered: " + healthLive.join(", "));
const store = read("scripts/flows-nightly/store.mjs");
eq([...store.matchAll(/LEDGER_LIST_KINDS = Object\.freeze\(\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])), [NAME_KINDS.slice()], "the nightly's ledger lists the same name kinds");

const dir = nightlyEmit();
const { keys, unknown } = emitKeys(dir);
eq(unknown, [], "EVERY KEY THE DRY-RUN EMIT WRITES IS A REGISTERED PRODUCT");
ok(keys.size >= 400, "the emit holds " + keys.size + " keys");
const emitted = [...keys.keys()];
const NIGHTLY_SWITCHED = ["eventrisk", "er-sectors"];
eq(NIGHTLY_SWITCHED.filter((k) => GLOBAL_KEYS.includes(k)), NIGHTLY_SWITCHED, "the event-risk keys are registered globals");
eq(NIGHTLY_SWITCHED.filter((k) => keys.has(k)), [], "the shared emit runs with FLOWS_EVENTRISK_NIGHTLY off and writes no event-risk key; flows-er-nightly holds the on run");
eq(GLOBAL_KEYS.filter((k) => !keys.has(k) && !NIGHTLY_SWITCHED.includes(k)), [], "AND EVERY OTHER REGISTERED GLOBAL IS WRITTEN BY IT");
for (const k of emitted) ok(productOf(k) !== null, `${k}: registered`);
const byFamily = { global: 0, dated: 0, name: 0, live: 0 };
for (const k of emitted) byFamily[productOf(k).family]++;
ok(byFamily.global === GLOBAL_KEYS.length - NIGHTLY_SWITCHED.length && byFamily.dated >= 4 && byFamily.name >= 400 && byFamily.live >= 8, "the families are all present in it: " + JSON.stringify(byFamily));
for (const k of emitted.filter((x) => productOf(x).family !== "live")) {
  const bytes = Buffer.byteLength(JSON.stringify(keys.get(k)));
  ok(bytes <= FLOWS_MAX_PAYLOAD_BYTES, `${k}: ${bytes} bytes, inside the door's cap`);
}
for (const k of emitted.filter((x) => productOf(x).family === "live")) {
  ok(Buffer.byteLength(JSON.stringify(keys.get(k))) <= productOf(k).capBytes, `${k}: inside its own cap`);
}

eq(STATE_NAMES.length, 6, "six states");
eq(STATE_NAMES.map((n) => STATE[n]), [0, 1, 2, 3, 4, 5], "numbered from zero in the order the ledger prints them");
eq(PANEL_IDS, ["quote", "chart", "levels", "gamma", "move", "vol", "surface", "flow", "events", "positioning", "engine", "reading"], "the panel products");
ok(PANELS.every((p) => typeof p.from === "string" && p.from.length > 10), "each says where it is read from");
for (const d of DEPTHS) {
  const wanted = contractFor(d);
  ok(wanted.length >= 6 && wanted.every((id) => PANEL_IDS.includes(id)) && new Set(wanted).size === wanted.length, `${d}: its contract names registered products only, once each`);
  ok(Object.hasOwn(NAME_KEY_EXPECTED, d) && expectedKinds(d).every((k) => NAME_KINDS.includes(k)), `${d}: and the keys it should have are name products`);
}
ok(CONTRACT.board.length > CONTRACT.cross.length && CONTRACT.cross.length > CONTRACT.screen.length, "the contract grows with the tier: screen under cross under board");
ok(["chart", "levels", "move", "vol", "reading"].every((id) => CONTRACT.screen.includes(id)), "and a screen name is held to a chart, levels, a move, a volatility and a reading");
eq(contractFor("nonsense"), CONTRACT.screen, "an unknown tier is held to the screen contract");
eq(expectedKinds("screen").slice(), [], "a screen name has no keys of its own to expect");

console.log(`flows-registry-contract: ${checks} checks passed`);
