import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nightlyEmit, DRY_NOW } from "./lib/nightly-emit.mjs";
import * as P from "../shared/flows-card-pack.js";
import { mulberry32 } from "../shared/flows-stats.js";
import { CARD_X_SOFT_BYTES, CARD_X_BUDGET_BYTES, CARD_X_SERVED_BYTES, cardXPayload, composeCardXPayload, cardXWire, cardXBytes } from "../scripts/flows-legs/card-x.mjs";
import { loadMutated } from "./truth/mutants.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let checks = 0;
let planted = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const HEADROOM_BYTES = Math.floor(0.95 * CARD_X_SOFT_BYTES);
const WIRE_CEILING = 56700;
const SERVED_CEILING = 62800;
const DAY = 86400000;
const iso = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const dayN = (s) => Date.parse(s + "T00:00:00Z") / DAY;
const json = JSON.stringify;
const utf8 = (s) => Buffer.byteLength(s);

function trail(start, gaps) {
  const out = [start];
  let at = dayN(start);
  for (const g of gaps) { at += g; out.push(iso(at)); }
  return out;
}

function battery(m) {
  const bad = [];
  const note = (msg) => { if (bad.length < 6) bad.push(msg); };
  const guard = (name, run) => { try { run(); } catch (e) { note(name + ": " + String(e.message).split("\n")[0]); } };
  const same2 = (a, b, msg) => { if (json(a) !== json(b)) note(msg + " (" + json(a).slice(0, 120) + " vs " + json(b).slice(0, 120) + ")"); };

  guard("known answer", () => {
    const doc = {
      v: 1, ticker: "SYA101",
      vrp: { series: { d: ["2026-02-27", "2026-03-02", "2026-03-03"], iv: [1, 2, 3] } },
      contracts: { rows: [{ d: ["2024-02-28", "2024-02-29", "2024-03-01", "2024-03-01"] }, { d: ["2026-12-31", "2027-01-04", "2027-01-05"] }] },
    };
    const want = '{"pk":1,"v":1,"ticker":"SYA101","vrp":{"series":{"d0":"2026-02-27","dd":[3,1],"iv":[1,2,3]}},"contracts":{"rows":[{"d0":"2024-02-28","dd":[1,1,0]},{"d0":"2026-12-31","dd":[4,1]}]}}';
    if (json(m.packCardX(doc)) !== want) note("the packed form of a known document is " + json(m.packCardX(doc)));
    if (json(m.unpackCardX(JSON.parse(want))) !== json(doc)) note("and it unpacks to the document, key order kept");
    if (!m.isPackedText(want) || m.isPackedText(json(doc))) note("the marker is the first key");
  });

  guard("refusals", () => {
    const keep = (doc, why) => { if (m.packCardX(doc) !== doc) note(why); };
    keep({ v: 1, a: { d: ["2026-01-01", "2026-01-02"] } }, "two days are not packed");
    keep({ v: 1, a: { d: ["2026-01-03", "2026-01-02", "2026-01-04"] } }, "an unsorted list is not packed");
    keep({ v: 1, a: { d: ["2026-02-28", "2026-02-30", "2026-03-02"] } }, "an impossible day is not packed");
    keep({ v: 1, a: { d: ["2026-01-01", "2026-01-02", "2026-01-03T10:00:00Z"] } }, "a timestamp is not packed");
    keep({ v: 1, a: { d: ["2026-01-01", null, "2026-01-03"] } }, "a null is not packed");
    keep({ v: 1, a: { d: ["2026-01-01", 5, "2026-01-03"] } }, "a number is not packed");
    keep({ v: 1, a: { d: "2026-01-01" } }, "a string under d is not packed");
    keep({ v: 1, a: { d: { x: 1 } } }, "an object under d is not packed");
    keep({ v: 1, a: { e: ["2026-01-01", "2026-01-02", "2026-01-03"] } }, "only the key d is packed");
    keep({ v: 1, a: { d: ["01-01-2026", "02-01-2026", "03-01-2026"] } }, "another date form is not packed");
    keep({ v: 1, a: [1, 2, 3] }, "a document with nothing to pack is the same object");
    keep({ pk: 1, a: { d: ["2026-01-01", "2026-01-02", "2026-01-03"] } }, "a document that already has the marker key is not packed");
    keep({ v: 1, a: { d: ["2026-01-01", "2026-01-02", "2026-01-03"], d0: 1 } }, "a document that already has d0 is not packed");
    keep({ v: 1, a: { d: ["2026-01-01", "2026-01-02", "2026-01-03"], dd: 1 } }, "a document that already has dd is not packed");
    keep({ v: 1, dd: 1, a: { d: ["2026-01-01", "2026-01-02", "2026-01-03"] } }, "or has dd at the top");
    keep(JSON.parse('{"v":1,"a":{"d":["2026-01-01","2026-01-02","2026-01-03"],"__proto__":{"x":1}}}'), "a document with an own __proto__ key is not packed");
    for (const v of [null, 5, "x", [], [{ d: ["2026-01-01", "2026-01-02", "2026-01-03"] }]]) if (m.packCardX(v) !== v) note("a value that is not an object is returned as it is");
    const packed = m.packCardX({ v: 1, a: { d: ["2026-01-01", "2026-01-02", "2026-01-03"] } });
    if (m.packCardX(packed) !== packed) note("packing a packed document changes nothing");
    const plain = { v: 1 };
    if (m.unpackCardX(plain) !== plain) note("unpacking an unpacked document changes nothing");
  });

  guard("text", () => {
    const doc = { v: 1, a: { d: trail("2026-01-01", [1, 1, 3, 1, 1]) } };
    const text = json(doc);
    const packed = m.packText(text);
    if (packed === text || !m.isPackedText(packed)) note("text with a list is packed");
    if (m.unpackText(packed) !== text) note("and unpacks to the same text");
    if (m.packText(packed) !== packed) note("packing packed text changes nothing");
    if (m.packText("not json") !== "not json" || m.packText("") !== "" || m.packText(5) !== 5) note("text that is not JSON is returned as it is");
    if (m.unpackText(text) !== text) note("unpacked text is returned as it is");
    const broken = '{"pk":1,"a":{"d0":"2026-01-01","dd":[1,-3]}}';
    if (m.unpackText(broken) !== null) note("a packed document that does not decode is absent, never served packed");
    const cut = '{"pk":1,"a":{"d0":"2026-0';
    if (m.unpackText(cut) !== null) note("so is a cut one");
    const other = '{"pk":2,"a":1}';
    if (m.unpackText(other) !== null) note("and another version of the format");
    if (m.unpackText("") !== "" || m.unpackText(5) !== 5) note("text that is not a packed document is returned as it is");
    const pretty = '{ "v": 1, "a": { "d": ["2026-01-01", "2026-01-02", "2026-01-03"] } }';
    if (m.packText(pretty) !== pretty) note("a body that is not the compact form of its own value is stored whole, so the reader can serve the bytes that were posted");
  });

  guard("units", () => {
    if (m.wireBytes({ a: 1 }) !== utf8(json({ a: 1, bytes: 99999 }))) note("the wire size of a document with nothing to pack is its own with the five-digit bytes field");
    const doc = { v: 1, a: { d: trail("2026-01-01", Array.from({ length: 40 }, () => 1)) } };
    if (!(m.wireBytes(doc) < utf8(json({ ...doc, bytes: 99999 })) - 300)) note("a packable list takes its gaps off the wire size");
    if (m.wireBytes({ s: "é€𝄞" }) !== utf8(json({ s: "é€𝄞", bytes: 99999 }))) note("and the size is counted in UTF-8 bytes");
  });

  return bad;
}

function randomDoc(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (n) => Math.floor(r() * n);
  const days = (len, kind) => {
    const start = 10957 + int(7000);
    if (kind === "bad-date") return ["2026-02-28", "2026-02-30", "2026-03-02", "2026-03-03"].slice(0, len);
    if (kind === "unsorted") return Array.from({ length: len }, (_, i) => iso(start + (i % 2 ? -i : i)));
    if (kind === "mixed") return Array.from({ length: len }, (_, i) => (i === 1 ? null : iso(start + i)));
    if (kind === "text") return Array.from({ length: len }, (_, i) => iso(start + i) + "T00:00:00Z");
    let at = start;
    return Array.from({ length: len }, () => { at += pick([0, 1, 1, 1, 2, 3, 3, 5, 14, 31, 365]); return iso(at); });
  };
  const leaf = () => pick([null, true, false, int(100000) / 100, "SYA" + int(999), "é€𝄞", "2026-01-0" + (1 + int(9)), [], {}, [int(9), int(9)], -0.5, 1e-7, 123456789012]);
  const dayList = () => days(pick([0, 1, 2, 3, 3, 4, 8, 60, 231]), pick(["ok", "ok", "ok", "ok", "ok", "bad-date", "unsorted", "mixed", "text"]));
  const node = (depth) => {
    if (depth > 3) return leaf();
    const kind = int(5);
    if (kind === 0) return leaf();
    if (kind === 1) return Array.from({ length: int(4) }, () => node(depth + 1));
    const out = {};
    for (let i = 0, n = int(5); i < n; i++) {
      const key = pick(["d", "d", "iv", "series", "history", "rows", "x", "dates", "D", "d1", "e"]);
      out[key] = key === "d" && r() < 0.8 ? dayList() : node(depth + 1);
    }
    return out;
  };
  const doc = { v: 1, ticker: "SYA" + int(999), sessionDate: "2026-08-24" };
  for (const k of pick([["vrp", "skew"], ["anomaly", "sentiment", "character"], ["contracts", "term", "pad"], ["vrp", "short", "dx"], ["earnings", "engine", "insiders", "vx"]])) doc[k] = node(0);
  if (r() < 0.2) doc.contracts = { rows: Array.from({ length: 1 + int(5) }, () => ({ d: dayList(), k: int(300) })) };
  return doc;
}

function properties(m, seeds) {
  const bad = [];
  let packedDocs = 0, lists = 0, skipped = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const doc = randomDoc(mulberry32(seed * 7919));
    const text = json(doc);
    try {
      const packed = m.packCardX(doc);
      const back = json(m.unpackCardX(packed));
      if (back !== text) { bad.push(`seed ${seed}: the round trip changed the document`); continue; }
      if (m.packCardX(packed) !== packed) bad.push(`seed ${seed}: packing twice changed the document`);
      if (json(m.unpackCardX(m.unpackCardX(packed))) !== text) bad.push(`seed ${seed}: unpacking twice changed the document`);
      const asText = m.packText(text);
      if (m.unpackText(asText) !== text) bad.push(`seed ${seed}: the text round trip changed the document`);
      if (asText !== text && !m.isPackedText(asText)) bad.push(`seed ${seed}: packed text lacks the marker prefix`);
      if (packed !== doc) {
        packedDocs++;
        const gain = utf8(text) - utf8(json(packed));
        if (gain < -16) bad.push(`seed ${seed}: packing grew the document by ${-gain} bytes`);
        lists += (json(packed).match(/"dd":/g) || []).length;
      } else skipped++;
    } catch (e) {
      bad.push(`seed ${seed}: ${String(e.message).split("\n")[0]}`);
    }
    if (bad.length > 5) break;
  }
  return { bad, packedDocs, lists, skipped };
}

function digest() {
  const h = createHash("sha256");
  const out = battery(P);
  h.update(json(out));
  for (let seed = 1; seed <= 200; seed++) {
    const doc = randomDoc(mulberry32(seed * 104729));
    h.update(P.packText(json(doc)));
  }
  for (let n = 10957; n < 10957 + 40000; n += 97) h.update(P.packText(json({ a: { d: [iso(n), iso(n + 1), iso(n + 31)] } })));
  return h.digest("hex");
}

if (process.argv.includes("--child")) {
  console.log(digest());
  process.exit(0);
}

eq(json(battery(P)), "[]", "the pack battery passes the real leaf: " + battery(P).slice(0, 2).join(" | "));
eq(P.PACK_PREFIX, json({ [P.PACK_KEY]: P.PACK_VERSION, x: 1 }).slice(0, P.PACK_PREFIX.length), "the marker prefix is what JSON.stringify writes for the first key");
same([...P.PACK_RESERVED], ["pk", "d0", "dd", "__proto__"], "and so is the list of keys the format reserves");

{
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  ok(!/CARDX/.test(toml), "wrangler.toml carries no card-x switch: the Worker decodes a packed card-x body whenever it is sent one, and the switch that sends them is the pipeline's");
  const staging = readFileSync(new URL("../wrangler.staging.toml", import.meta.url), "utf8");
  ok(!/CARDX/.test(staging), "and neither does staging");
}

{
  const run = properties(P, 600);
  same(run.bad, [], "600 seeded random documents round-trip exactly, pack and unpack are idempotent");
  ok(run.packedDocs > 250 && run.lists > 400 && run.skipped > 20, `and the corpus reaches both arms (${run.packedDocs} packed with ${run.lists} lists, ${run.skipped} left alone)`);
}

{
  const digests = new Set();
  for (const tz of ["UTC", "Europe/Istanbul", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Australia/Lord_Howe"]) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child"], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
    eq(run.status, 0, "the pack digest runs under " + tz + (run.stderr ? ": " + run.stderr.slice(0, 200) : ""));
    digests.add(run.stdout.trim());
  }
  eq(digests.size, 1, "THE PACKED BYTES ARE THE SAME IN SIX TIME ZONES, from UTC-11 to UTC+14");
}

const emit = nightlyEmit();
const names = readdirSync(emit).filter((f) => /^-card-x-[A-Z0-9.\-]+\.json$/.test(f));
const cards = names.map((f) => ({ file: f, text: readFileSync(join(emit, f), "utf8") }));
ok(cards.length >= 150, `the dry-run emit holds ${cards.length} card-x payloads`);
let rawMax = 0, rawMaxName = "", softShed = 0, listsSeen = 0;
for (const c of cards) {
  const doc = JSON.parse(c.text);
  const text = json(doc);
  const packed = P.packCardX(doc);
  eq(json(P.unpackCardX(packed)), text, "round trip, " + c.file);
  eq(P.unpackText(P.packText(text)), text, "text round trip, " + c.file);
  const raw = utf8(text);
  if (raw > rawMax) { rawMax = raw; rawMaxName = doc.ticker; }
  if ((doc.shed || []).includes("extras.soft")) softShed++;
  if (packed !== doc) {
    listsSeen += (json(packed).match(/"dd":/g) || []).length;
    ok(utf8(json(packed)) < raw, "a packed card is smaller, " + c.file);
    ok(P.isPackedText(json(packed)), "and carries the marker first, " + c.file);
  }
  const left = [];
  const scan = (v, path) => {
    if (Array.isArray(v)) v.forEach((x) => scan(x, path));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      if (k === "d" && Array.isArray(x) && x.length >= 3 && x.every((e) => typeof e === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e))) left.push(path + ".d");
      scan(x, path + "." + k);
    }
  };
  for (const [k, v] of Object.entries(packed)) scan(v, k);
  same(left, [], "no day list is left in full, " + c.file);
}
ok(listsSeen > 500, `the emit carries ${listsSeen} day lists`);
ok(rawMax < CARD_X_SOFT_BYTES, `THE DEFAULT PIPELINE IS WHAT IT WAS: every card-x it builds is under the ${CARD_X_SOFT_BYTES}-byte soft limit as posted, the largest ${rawMax} (${rawMaxName}), which is what the pipeline contract and the payload-shape suite hold it to`);
ok(softShed > 0, `and the cards that would be over it shed their extras to stay under (${softShed} of ${cards.length})`);
eq(cardXWire(), false, "the pipeline posts card-x whole unless FLOWS_CARDX_WIRE is exactly pack");

const wireDir = mkdtempSync(join(tmpdir(), "flows-wire-"));
{
  const run = spawnSync(process.execPath, [join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", wireDir + "/"], {
    cwd: ROOT, env: { ...process.env, FLOWS_DRY_NOW: DRY_NOW, FLOWS_CARDX_WIRE: "pack" }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  eq(run.status, 0, "the dry-run pipeline runs with FLOWS_CARDX_WIRE=pack: " + String(run.stderr).slice(0, 200));
}
const wireCards = readdirSync(wireDir).filter((f) => /^-card-x-[A-Z0-9.\-]+\.json$/.test(f)).map((f) => ({ file: f, text: readFileSync(join(wireDir, f), "utf8") }));
let wireRawMax = 0, wireMax = 0, wireMaxName = "", wireShed = 0;
for (const c of wireCards) {
  const doc = JSON.parse(c.text);
  const raw = utf8(c.text), wire = P.wireBytes(doc);
  wireRawMax = Math.max(wireRawMax, raw);
  if (wire > wireMax) { wireMax = wire; wireMaxName = doc.ticker; }
  if ((doc.shed || []).includes("extras.soft")) wireShed++;
  ok(wire <= CARD_X_SOFT_BYTES, `with the wire switch on, ${c.file} is ${wire} bytes on the wire, inside the soft limit`);
}
eq(wireCards.length, cards.length, "the same cards are built with the switch on");
ok(wireMax <= HEADROOM_BYTES, `WITH THE SWITCH ON THE LARGEST CARD-X IS ${wireMax} BYTES ON THE WIRE (${wireMaxName}), AT MOST 95% OF THE SOFT LIMIT: ${HEADROOM_BYTES} of ${CARD_X_SOFT_BYTES}`);
ok(wireMax <= WIRE_CEILING, `held at ${WIRE_CEILING}, a ratchet that falls and is not raised without a named decision`);
eq(wireShed, 0, "and no card sheds its extras to the soft limit: every part of every card stays whole");
ok(wireRawMax > CARD_X_SOFT_BYTES, `while the document the Worker serves is larger than the soft limit for the largest (${wireRawMax} bytes), which is why this is a decision and not a default`);
ok(wireRawMax <= SERVED_CEILING, `it has its own ratchet at ${SERVED_CEILING} bytes so growth the packing hides is seen`);
ok(wireRawMax <= CARD_X_SERVED_BYTES, `and stays inside the served ceiling of ${CARD_X_SERVED_BYTES} bytes, 90% of the ${CARD_X_BUDGET_BYTES}-byte budget, which the pipeline enforces on every card-x`);
console.log(`  card-x: ${cards.length} cards; as posted today the largest is ${rawMax} bytes (${rawMaxName}) and ${softShed} shed their extras; with FLOWS_CARDX_WIRE=pack the largest is ${wireMax} bytes on the wire (${wireMaxName}), ${(100 * wireMax / CARD_X_SOFT_BYTES).toFixed(1)}% of the soft limit, and ${wireRawMax} bytes served`);
rmSync(wireDir, { recursive: true, force: true });

{
  const stamp = { generatedAt: "2026-10-20T21:00:00Z", sessionDate: "2026-10-20", readAt: "2026-10-20T21:00:00Z" };
  const xp = (n) => ({ at: Date.parse("2026-10-20T20:00:00Z"), rv: 1, x: { ok: true, pad: "x".repeat(n) } });
  const parts = (series, padBytes = CARD_X_SOFT_BYTES - 30000) => ({
    dx: { v: 1, status: "ok", parts: { info: xp(300), financials: xp(3000), analysts: xp(500) } },
    vx: { v: 1, status: "ok", parts: { dividends: xp(900), etf: xp(300) } },
    vrp: { series: { d: series, iv: series.map((_, i) => i % 7) } },
    pad: { rows: "y".repeat(padBytes) },
  });
  const dates = trail("2018-01-02", Array.from({ length: 2199 }, (_, i) => (i % 5 === 4 ? 3 : 1)));
  const withWire = (on, run) => {
    const before = process.env.FLOWS_CARDX_WIRE;
    if (on) process.env.FLOWS_CARDX_WIRE = "pack"; else delete process.env.FLOWS_CARDX_WIRE;
    try { return run(); } finally { if (before === undefined) delete process.env.FLOWS_CARDX_WIRE; else process.env.FLOWS_CARDX_WIRE = before; }
  };
  const asPosted = withWire(false, () => cardXPayload("SYX101", parts(dates), stamp));
  ok(asPosted.shed.includes("extras.soft"), "a card-x whose document is over the soft limit sheds its extras when it is posted whole");
  const onWire = withWire(true, () => cardXPayload("SYX101", parts(dates), stamp));
  ok(utf8(json(onWire)) > CARD_X_SOFT_BYTES, `the same card is ${utf8(json(onWire))} bytes as a document, over the soft limit`);
  ok(P.wireBytes(onWire) <= CARD_X_SOFT_BYTES, `and ${P.wireBytes(onWire)} bytes on the wire, under it`);
  ok(!onWire.shed.includes("extras.soft") && onWire.dx.parts.financials.x && onWire.vx.parts.dividends.x, "so with the switch on it keeps every part whole");
  const tooMuch = withWire(true, () => cardXPayload("SYX101", { ...parts(dates), pad: { rows: "y".repeat(CARD_X_SOFT_BYTES) } }, stamp));
  ok(tooMuch.shed.includes("extras.soft") && tooMuch.dx.parts.financials.shed === 1, "while a card that is over the limit even packed sheds its extras as before");
  const base = withWire(true, () => cardXPayload("SYX101", { vrp: { series: { d: dates, iv: dates.map(() => 0) } } }, stamp));
  const merged = withWire(true, () => composeCardXPayload(base, cardXPayload("SYX101", { dx: parts(dates).dx, vx: parts(dates).vx, pad: { rows: "y".repeat(CARD_X_SOFT_BYTES - 33000) } }, stamp)));
  ok(!merged.shed.includes("extras.soft") && P.wireBytes(merged) <= CARD_X_SOFT_BYTES, "a merge onto a prior is counted on the wire too");

  const longDates = trail("2000-01-03", Array.from({ length: 4999 }, () => 1));
  const whole = { v: 1, ticker: "SYX101", ...stamp, fresh: { readAt: stamp.readAt, session: stamp.sessionDate }, ...parts(longDates, 0), shed: [] };
  const servedFloor = P.servedBytes(whole);
  ok(servedFloor < CARD_X_SERVED_BYTES - 5000 && P.wireBytes(whole) < CARD_X_SOFT_BYTES / 2, `a card of ${longDates.length} days is ${servedFloor} bytes served and ${P.wireBytes(whole)} on the wire before the padding that takes it over the ceiling`);
  const heavy = withWire(true, () => cardXPayload("SYX101", parts(longDates, CARD_X_SERVED_BYTES + 1500 - servedFloor), stamp));
  ok(P.wireBytes(heavy) < CARD_X_SOFT_BYTES, "its wire form is inside the soft limit on its own");
  ok(heavy.dx.parts.financials.shed === 1 && heavy.dx.parts.info.x && heavy.vx.parts.dividends.x, "so the parts that go are the first in the shed order and no more than the ceiling needs");
  ok(P.servedBytes(heavy) <= CARD_X_SERVED_BYTES, `a card with ${longDates.length} days whose wire form fits and whose served form would be over the ${CARD_X_SERVED_BYTES}-byte ceiling sheds until the served form fits (${P.servedBytes(heavy)})`);
  ok(heavy.shed.includes("extras.soft") && P.wireBytes(heavy) <= CARD_X_SOFT_BYTES, "and is still inside the soft limit on the wire");
  eq(withWire(true, () => cardXBytes(heavy)), P.wireBytes(heavy), "cardXBytes is the wire size while the switch is on");
  eq(withWire(false, () => cardXBytes(heavy)), P.servedBytes(heavy), "and the served size while it is off");

  const WIRE_ON = ["export const cardXBytes = (payload) => (cardXWire() ? wireBytes(payload) : servedBytes(payload));", "export const cardXBytes = (payload) => servedBytes(payload);"];
  const builds = [
    ["the soft limit counted on the document with the switch on", [WIRE_ON]],
    ["the soft limit counted on the wire with the switch off", [["export const cardXBytes = (payload) => (cardXWire() ? wireBytes(payload) : servedBytes(payload));", "export const cardXBytes = (payload) => wireBytes(payload);"]]],
    ["the served ceiling dropped", [["const overSoft = (payload) => cardXBytes(payload) > CARD_X_SOFT_BYTES || servedBytes(payload) > CARD_X_SERVED_BYTES;", "const overSoft = (payload) => cardXBytes(payload) > CARD_X_SOFT_BYTES;"]]],
    ["the served ceiling at the whole budget", [["export const CARD_X_SERVED_BYTES = Math.floor(0.9 * CARD_X_BUDGET_BYTES);", "export const CARD_X_SERVED_BYTES = CARD_X_BUDGET_BYTES * 2;"]]],
    ["any value of the switch packs", [["export const cardXWire = () => process.env.FLOWS_CARDX_WIRE === \"pack\";", "export const cardXWire = () => Boolean(process.env.FLOWS_CARDX_WIRE);"]]],
    ["the soft limit not enforced", [["while (overSoft(payload) && shedNextPart(payload)) {", "while (false && shedNextPart(payload)) {"]]],
  ];
  const probeBuild = (m) => withWire(true, () => {
    const a = m.cardXPayload("SYX101", parts(dates), stamp);
    const h = m.cardXPayload("SYX101", parts(longDates, CARD_X_SERVED_BYTES + 1500 - servedFloor), stamp);
    const off = withWire(false, () => m.cardXPayload("SYX101", parts(dates), stamp));
    const flag = process.env.FLOWS_CARDX_WIRE;
    process.env.FLOWS_CARDX_WIRE = "yes";
    const odd = m.cardXWire();
    process.env.FLOWS_CARDX_WIRE = flag;
    return a.shed.includes("extras.soft") || !off.shed.includes("extras.soft") || P.servedBytes(h) > CARD_X_SERVED_BYTES || odd !== false || !(m.CARD_X_SERVED_BYTES <= 92160);
  });
  let cardSalt = 900;
  for (const [name, transforms] of builds) {
    const bad = await loadMutated("scripts/flows-legs/card-x.mjs", transforms, { salt: cardSalt++ });
    ok(probeBuild(bad), `PLANTED WRONG BUILD, ${name}: the fit fails it`);
    planted++;
  }
  ok(!probeBuild(await loadMutated("scripts/flows-legs/card-x.mjs", [], { salt: cardSalt++ })), "and the real build passes the same probe");
}

{
  const sendSource = readFileSync(join(ROOT, "scripts/flows-nightly/store.mjs"), "utf8");
  const send = /async function send\(key, payload\) \{[\s\S]*?\n\}\n/.exec(sendSource);
  ok(send, "the pipeline's send function is found");
  const scan = (text) => {
    const dry = /if \(EMIT \|\| DRY_RUN\) \{[\s\S]*?return;\n  \}/.exec(text);
    const post = /const wire = wireText\(key, body, process\.env\.FLOWS_CARDX_WIRE === "pack"\);[\s\S]*?body: wire,/.exec(text);
    return Boolean(dry) && !/wireText/.test(dry[0]) && Boolean(post) && /const leak = publishRefusal\(key, body\);/.test(text) && text.indexOf("const leak = publishRefusal(key, body);") < text.indexOf("wireText(");
  };
  ok(scan(send[0]), "the body is packed after the fixture check and only on the way to the network: the dry run's emit stays whole for every reader of it");
  for (const [name, from, to] of [
    ["the dry run packs", "if (EMIT || DRY_RUN) {\n", "if (EMIT || DRY_RUN) {\n    wireText(key, body, true);\n"],
    ["the packed body never sent", "      body: wire,", "      body,"],
    ["the fixture check on the packed body", "const leak = publishRefusal(key, body);", "const leak = publishRefusal(key, wireText(key, body, true));"],
    ["the switch read as anything", "process.env.FLOWS_CARDX_WIRE === \"pack\"", "process.env.FLOWS_CARDX_WIRE"],
  ]) {
    ok(send[0].split(from).length === 2, "the planted build changes send exactly once: " + name);
    ok(!scan(send[0].replace(from, to)), `PLANTED WRONG BUILD, ${name}: the scan fails it`);
    planted++;
  }
  const text = json({ v: 1, a: { d: trail("2026-01-01", [1, 1, 3]) } });
  eq(P.wireText("card-x:SYX101", text, false), text, "wireText posts the body whole with the switch off");
  ok(P.isPackedText(P.wireText("card-x:SYX101", text, true)), "packs a card-x body with it on");
  eq(P.wireText("card:SYX101", text, true), text, "and no other key");
  eq(P.wireText("card-x:SYX101", text, "pack"), text, "and only for the boolean the caller computed");
  eq(P.wireText(null, text, true), text, "and a missing key packs nothing");
  eq(P.wireText("card-x:SYX101", 5, true), 5, "and a body that is not text is left as it is");
  same([P.decodeWire("card-x:SYX101", text), P.decodeWire("card-x:SYX101", P.packText(text)), P.decodeWire("card:SYX101", P.packText(text)), P.decodeWire("card-x:SYX101", '{"pk":1,"a":{"d0":"2026-01-01","dd":[1,-3]}}'), P.decodeWire("card-x:SYX101", '{"pk":2,"a":1}'), P.decodeWire("card-x:SYX101", 5)],
    [{ text }, { text }, { text: P.packText(text) }, { error: "A packed card-x does not decode" }, { error: "A packed card-x does not decode" }, { text: 5 }],
    "decodeWire opens a packed card-x body, leaves a whole one and every other key alone, and names one it cannot decode");
}

const LEAF = [
  ["a gap one day long", "gaps.push(at - prev);", "gaps.push(at - prev + 1);"],
  ["a day one too late", "const dayText = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);", "const dayText = (n) => new Date((n + 1) * DAY_MS).toISOString().slice(0, 10);"],
  ["an unsorted list packed", "if (at === null || at < prev) return null;", "if (at === null) return null;"],
  ["an impossible day packed", " && new Date(ms).toISOString().slice(0, 10) === text ? ms / DAY_MS : null;", " ? ms / DAY_MS : null;"],
  ["the reserved keys not looked for", "    if (hasReserved(payload[k])) return payload;\n", ""],
  ["the top-level reserved keys not looked for", 'if (k === "d0" || k === "dd" || k === "__proto__") return payload;', ""],
  ["a document already packed packed again", "if (!isObject(payload) || Object.hasOwn(payload, PACK_KEY)) return payload;", "if (!isObject(payload)) return payload;"],
  ["the marker last", "const out = { [PACK_KEY]: PACK_VERSION };\n  const tally = { lists: 0 };\n  for (const k of keys) out[k] = lower(payload[k], tally);", "const out = {};\n  const tally = { lists: 0 };\n  for (const k of keys) out[k] = lower(payload[k], tally);\n  out[PACK_KEY] = PACK_VERSION;"],
  ["the list put back at the end of the object", [["  const out = {};\n  for (const [k, x] of Object.entries(v)) {\n    if (k === \"dd\" && Object.hasOwn(v, \"d0\")) continue;", "  const out = {};\n  let tailDays = null;\n  for (const [k, x] of Object.entries(v)) {\n    if (k === \"dd\" && Object.hasOwn(v, \"d0\")) continue;"], ["      out.d = days;\n    } else out[k] = lift(x);\n  }\n  return out;", "      tailDays = days;\n    } else out[k] = lift(x);\n  }\n  if (tailDays) out.d = tailDays;\n  return out;"]]],
  ["a list with no change packed", "return tally.lists > 0 ? out : payload;", "return out;"],
  ["a negative gap decoded", "if (!Number.isInteger(g) || g < 0) return null;", "if (!Number.isInteger(g)) return null;"],
  ["a corrupt packed body decoded as it is", [["    return isPacked(value) ? JSON.stringify(unpackCardX(value)) : null;\n  } catch {\n    return null;\n  }", "    return isPacked(value) ? JSON.stringify(unpackCardX(value)) : null;\n  } catch {\n    return text;\n  }"]]],
  ["a version this build does not know decoded as it is", [["JSON.stringify(unpackCardX(value)) : null;", "JSON.stringify(unpackCardX(value)) : text;"]]],
  ["the round trip checked against the value and not the text", [["JSON.stringify(unpackCardX(JSON.parse(out))) === text ? out : text;", "JSON.stringify(unpackCardX(JSON.parse(out))) === JSON.stringify(value) ? out : text;"]]],
  ["a day count in bytes", "export const utf8Length = (text) => new TextEncoder().encode(text).length;", "export const utf8Length = (text) => text.length;"],
  ["one day list too few", "export const PACK_MIN_DAYS = 3;", "export const PACK_MIN_DAYS = 4;"],
];

let salt = 910;
for (const [name, first, second] of LEAF) {
  const src = readFileSync(new URL("../shared/flows-card-pack.js", import.meta.url), "utf8");
  const transforms = Array.isArray(first) ? first : [[first, second]];
  for (const [from] of transforms) ok(src.split(from).length === 2, "the planted build changes the leaf exactly once: " + name);
  const bad = await loadMutated("shared/flows-card-pack.js", transforms, { salt: salt++ });
  let found;
  try { found = [...battery(bad), ...properties(bad, 120).bad]; } catch (e) { found = ["threw " + e.message]; }
  ok(found.length > 0, `PLANTED WRONG BUILD, ${name}: the battery or the properties fail it (${found[0]})`);
  planted++;
}

{
  const GAP = ["gaps.push(at - prev);", "gaps.push(at - prev + 1);"];
  const VERIFY = ["return JSON.stringify(unpackCardX(JSON.parse(out))) === text ? out : text;", "return out;"];
  const gappy = await loadMutated("shared/flows-card-pack.js", [GAP], { salt: 950 });
  const blind = await loadMutated("shared/flows-card-pack.js", [GAP, VERIFY], { salt: 951 });
  const doc = { v: 1, a: { d: trail("2026-01-01", [1, 1, 3]) } };
  const text = json(doc);
  eq(gappy.packText(text), text, "A PACKER WITH A BUG STILL POSTS THE DOCUMENT WHOLE: the pipeline checks its own round trip and falls back to the text it was given");
  ok(blind.unpackText(blind.packText(text)) !== text, "PLANTED WRONG BUILD, a pack that does not check its round trip: with the same bug it posts a document that decodes wrong");
  planted++;
  for (const [name, from, to] of [
    ["decodeWire opening any key", "if (typeof key !== \"string\" || !key.startsWith(\"card-x:\") || typeof text !== \"string\" || !text.startsWith(PACK_ANY_PREFIX)) return { text };", "if (typeof text !== \"string\" || !text.startsWith(PACK_ANY_PREFIX)) return { text };"],
    ["decodeWire passing a corrupt body through", "return plain === null ? { error: \"A packed card-x does not decode\" } : { text: plain };", "return { text: plain === null ? text : plain };"],
    ["wireText packing any key", "on === true && typeof key === \"string\" && key.startsWith(\"card-x:\") ? packText(text) : text", "on === true ? packText(text) : text"],
    ["wireText packing with the switch off", "on === true && typeof key === \"string\"", "typeof key === \"string\""],
  ]) {
    const bad = await loadMutated("shared/flows-card-pack.js", [[from, to]], { salt: salt++ });
    const caught = bad.decodeWire("card:SYX101", P.packText(text)).text === P.packText(text) ? (bad.wireText("card:SYX101", text, true) !== text || bad.wireText("card-x:SYX101", text, false) !== text || bad.decodeWire("card-x:SYX101", '{"pk":2,"a":1}').error === undefined) : true;
    ok(caught, `PLANTED WRONG BUILD, ${name}: the table fails it`);
    planted++;
  }
}

const { FLOWS_COOKIE, sessionEpoch, signFlowsSession } = await import("../shared/flows-auth.js");
const { FIXTURE_ROSTER } = await import("./lib/fixture-roster.mjs");
const H = await import("./dossier-harness.mjs");
const DF = await import("./dossier-fixtures.mjs");

const NIGHTLY = "nightly-token-abcdefghijklmnopqrstuvwxyz";
let instance = 0;
async function rig(env, base) {
  const who = FIXTURE_ROSTER[0];
  const full = { SESSION_SECRET: H.SESSION_SECRET, FLOWS_CREDENTIALS: JSON.stringify({ [who]: "x".repeat(43) }), UW_API_KEY: "test-key", UW_BASE: "https://uw.test", ...env };
  const token = await signFlowsSession(who, full.SESSION_SECRET, 3600, sessionEpoch(full));
  const worker = (await import("../worker.js?cardpack=" + (++instance))).default;
  return async (route, init = {}) => {
    const res = await worker.fetch(new Request(base + route, { ...init, headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin", ...(init.headers || {}) } }), full, { waitUntil() {} });
    return { res, text: await res.text() };
  };
}
const rowOf = (d, id) => d.db.prepare("SELECT payload FROM flows_payload WHERE id = ?").get(id);

{
  const biggest = wireCards.map((c) => JSON.parse(c.text)).find((d) => d.ticker === wireMaxName);
  const text = json(biggest);
  const packed = P.wireText("card-x:" + wireMaxName, text, true);
  ok(P.isPackedText(packed) && utf8(packed) < utf8(text) - 5000, `the largest card-x with the switch on, ${utf8(text)} bytes, posts as ${utf8(packed)}`);
  const key = "card-x:" + wireMaxName;
  const post = (call, k, body) => call("/api/flows/ingest?key=" + encodeURIComponent(k), { method: "POST", headers: { Authorization: "Bearer " + NIGHTLY, "Content-Type": "application/json" }, body });
  const get = (call, k) => call("/api/flows/ingest?key=" + encodeURIComponent(k), { headers: { Authorization: "Bearer " + NIGHTLY } });
  const restoreCache = H.cacheFake();

  for (const mode of ["off", "warn", undefined]) {
    const env = mode === undefined ? {} : { FLOWS_DOOR_V2: mode };
    const dWhole = H.fakeD1(), dPacked = H.fakeD1();
    const whole = await rig({ DB: dWhole.D1, FLOWS_INGEST_TOKEN: NIGHTLY, ...env }, "https://anilkaya.test");
    const wired = await rig({ DB: dPacked.D1, FLOWS_INGEST_TOKEN: NIGHTLY, ...env }, "https://anilkaya.test");
    const w1 = await post(whole, key, text);
    const w2 = await post(wired, key, packed);
    same([w1.res.status, w2.res.status], [200, 200], `the ingest door takes the largest card-x whole and packed (door ${mode === undefined ? "unset" : mode}): ${w2.text.slice(0, 100)}`);
    eq(rowOf(dPacked, key).payload, text, "THE ROW IS THE DOCUMENT: the Worker stores what the pipeline built, never the packed form");
    eq(rowOf(dPacked, key).payload, rowOf(dWhole, key).payload, "the same row as a whole post leaves");
    eq((await wired("/api/flows/card-x?t=" + wireMaxName)).text, text, "and every reader gets the document with no change of its own");
    eq((await get(wired, key)).text, text, "the pipeline's own read of the key gets it too");
    const a = JSON.parse(w1.text), b = JSON.parse(w2.text);
    eq(b.bytes, a.bytes, "the bytes the door reports are the document's");
    if (a.door) eq(b.door.chash, a.door.chash, "and the content hash is the document's, so a repeat of the same card is unchanged whichever way it is posted");
  }

  {
    const dd = H.fakeD1();
    const call = await rig({ DB: dd.D1, FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_DOOR_V2: "warn" }, "https://anilkaya.test");
    const broken = '{"pk":1,"a":{"d0":"2026-01-01","dd":[1,-3]}}';
    const bad = await post(call, "card-x:SYX102", broken);
    eq(bad.res.status, 400, "a packed card-x that does not decode is refused: " + bad.text.slice(0, 100));
    eq(JSON.parse(bad.text).error.code, "invalid_payload", "as invalid_payload");
    eq(rowOf(dd, "card-x:SYX102"), undefined, "and nothing is stored");
    eq((await post(call, "card-x:SYX102", '{"pk":2,"a":1}')).res.status, 400, "a packed body of a version this Worker does not know is refused");
    const same2 = '{"pk":1,"d0":"2025-01-02","dd":[1,1],"x":1}';
    eq((await post(call, "board:long", same2)).res.status, 200, "a body of another key that happens to start with the marker is a document like any other");
    eq(rowOf(dd, "board:long").payload, same2, "and is stored as it is");
    const stub = { v: 1, ticker: "SYX103", sessionDate: "2026-08-24", generatedAt: "2026-08-24T21:45:00.000Z", fixture: true };
    const huge = json({ ...stub, a: { d: trail("2000-01-03", Array.from({ length: 13000 }, () => 1)) } });
    const hugePacked = P.wireText("card-x:SYX103", huge, true);
    ok(utf8(hugePacked) < 128 * 1024 && huge.length > 128 * 1024, `a card that is ${huge.length} bytes as a document and ${hugePacked.length} packed`);
    const over = await post(call, "card-x:SYX103", hugePacked);
    eq(over.res.status, 413, "is refused for what it decodes to, past the ingest cap: " + over.text.slice(0, 100));
    eq(rowOf(dd, "card-x:SYX103"), undefined, "and nothing is stored");
    const batch = await call("/api/flows/ingest?op=batch", { method: "POST", headers: { Authorization: "Bearer " + NIGHTLY, "Content-Type": "application/json" }, body: json({ items: [
      { key: "card-x:SYX104", payload: P.wireText("card-x:SYX104", json({ ...biggest, ticker: "SYX104" }), true) },
      { key: "card-x:SYX105", payload: broken },
      { key: "card-x:SYX106", payload: hugePacked },
      { key: "card-x:SYX107", payload: json({ ...biggest, ticker: "SYX107" }) },
    ] }) });
    eq(batch.res.status, 200, "the door's batch answers: " + batch.text.slice(0, 100));
    const results = JSON.parse(batch.text).results;
    same(results.map((r) => [r.ok, r.code || null]), [[true, null], [false, "invalid_payload"], [false, "payload_too_large"], [true, null]], "and decodes the packed item, refuses the broken one and the one that expands past the cap, and takes the whole one");
    eq(rowOf(dd, "card-x:SYX104").payload, json({ ...biggest, ticker: "SYX104" }), "the packed item is stored as the document");
    eq(rowOf(dd, "card-x:SYX105"), undefined, "the broken one is not stored");
  }

  {
    const route = readFileSync(join(ROOT, "server/routes/flows-ingest.js"), "utf8");
    const door = readFileSync(join(ROOT, "server/door.js"), "utf8");
    const routeOk = (t) => /const wire = decodeWire\(key, posted\);\s*if \(wire\.error\) throw new HttpError\(400, "invalid_payload", wire\.error\);\s*const payload = wire\.text;\s*if \(payload\.length > FLOWS_MAX_PAYLOAD_BYTES\) throw new HttpError\(413, "payload_too_large"/.test(t)
      && t.indexOf("decodeWire(key, posted)") < t.indexOf("JSON.parse(payload)") && t.indexOf("contentRefusal(url, key, payload)") > t.indexOf("decodeWire(key, posted)");
    const doorOk = (t) => /const wire = decodeWire\(key, posted\);\s*if \(wire\.error\) \{ refuse\("invalid_payload", wire\.error\); continue; \}\s*const text = wire\.text;\s*if \(text\.length > FLOWS_MAX_PAYLOAD_BYTES\) \{ refuse\("payload_too_large"/.test(t)
      && t.indexOf("decodeWire(key, posted)") < t.indexOf("JSON.parse(text)");
    ok(routeOk(route), "the ingest route decodes a packed card-x before it parses, checks the content or hashes it, and caps what it decodes to");
    ok(doorOk(door), "and so does the door's batch, item by item");
    ok(!/carriesMarker/.test(route + door), "neither refuses a body for carrying the marker key any more: a body that starts with it is a packed card-x or it is refused");
    for (const [name, text, check, from, to] of [
      ["the route stops decoding", route, routeOk, "const wire = decodeWire(key, posted);", "const wire = { text: posted };"],
      ["the route forgets the cap on the decoded text", route, routeOk, "if (payload.length > FLOWS_MAX_PAYLOAD_BYTES) throw new HttpError(413, \"payload_too_large\", \"Payload too large\");", ""],
      ["the route does not refuse a body that does not decode", route, routeOk, "if (wire.error) throw new HttpError(400, \"invalid_payload\", wire.error);", ""],
      ["the batch stops decoding", door, doorOk, "const wire = decodeWire(key, posted);", "const wire = { text: posted };"],
      ["the batch forgets the cap on the decoded text", door, doorOk, "if (text.length > FLOWS_MAX_PAYLOAD_BYTES) { refuse(\"payload_too_large\", \"Payload too large\"); continue; }\n      try { JSON.parse(text);", "try { JSON.parse(text);"],
    ]) {
      ok(text.split(from).length === 2, "the planted build changes the source exactly once: " + name);
      ok(!check(text.replace(from, () => to)), `PLANTED WRONG BUILD, ${name}: the scan fails it`);
      planted++;
    }
  }

  restoreCache.restore();
}

console.log(`✓ flows-card-pack: ${checks} assertions, no server, no vendor call: with FLOWS_CARDX_WIRE=pack the pipeline posts card-x with its day lists as gaps (a marker, the first day and the gaps), the Worker's door decodes them and stores the document, so no reader changes and the largest of ${cards.length} emitted cards is ${wireMax} bytes on the wire (${(100 * wireMax / CARD_X_SOFT_BYTES).toFixed(1)}% of the soft limit); posted whole, as it is by default, nothing changes; 600 random documents and ${cards.length} real ones round-trip exactly in six time zones; a packer with a bug posts the document whole; and ${planted} planted wrong builds fail`);
