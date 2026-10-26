import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nightlyEmit } from "./lib/nightly-emit.mjs";
import * as P from "../shared/flows-card-pack.js";
import { mulberry32 } from "../shared/flows-stats.js";
import { CARD_X_SOFT_BYTES, CARD_X_BUDGET_BYTES, cardXPayload, composeCardXPayload } from "../scripts/flows-legs/card-x.mjs";
import { DOSSIER_SQL } from "../shared/flows-dossier-worker.js";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
let planted = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const HEADROOM_BYTES = Math.floor(0.95 * CARD_X_SOFT_BYTES);
const STORED_CEILING = 56500;
const SERVED_CEILING = 62500;
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
      short: { volume: { d: ["2026-01-01", "2026-01-02", "2026-01-05"] } },
    };
    const want = '{"pk":1,"v":1,"ticker":"SYA101","vrp":{"series":{"d0":"2026-02-27","dd":[3,1],"iv":[1,2,3]}},"contracts":{"rows":[{"d0":"2024-02-28","dd":[1,1,0]},{"d0":"2026-12-31","dd":[4,1]}]},"short":{"volume":{"d":["2026-01-01","2026-01-02","2026-01-05"]}}}';
    if (json(m.packCardX(doc)) !== want) note("the packed form of a known document is " + json(m.packCardX(doc)));
    if (json(m.unpackCardX(JSON.parse(want))) !== json(doc)) note("and it unpacks to the document, key order kept");
    if (m.packCardX(doc).short !== doc.short) note("a skipped section is passed through as it stands");
    if (!m.isPackedText(want) || m.isPackedText(json(doc))) note("the marker is the first key");
    const odd = { v: 1, earnings: { d0: "2026-01-01", dd: [1, 2], pk: 1 }, vrp: { d: trail("2026-01-01", [1, 1, 1]) } };
    same2(m.unpackCardX(m.packCardX(odd)), odd, "a skipped section may hold the keys the packer reserves, and comes back as it was");
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
    if (!m.carriesMarker({ pk: 1 }) || m.carriesMarker({ a: 1 }) || m.carriesMarker([{ pk: 1 }]) || m.carriesMarker(null) || m.carriesMarker({ x: { pk: 1 } }) || m.carriesMarker({ dd: 1 })) note("a document carries the marker when its own top-level key is pk");
  });

  guard("units", () => {
    if (m.storedBytes({ a: 1 }) !== utf8(json({ a: 1, bytes: 99999 }))) note("the stored size of a document with nothing to pack is its own with the five-digit bytes field");
    const doc = { v: 1, a: { d: trail("2026-01-01", Array.from({ length: 40 }, () => 1)) } };
    if (!(m.storedBytes(doc) < utf8(json({ ...doc, bytes: 99999 })) - 300)) note("a packable list takes its gaps off the stored size");
    if (m.storedBytes({ s: "é€𝄞" }) !== utf8(json({ s: "é€𝄞", bytes: 99999 }))) note("and the size is counted in UTF-8 bytes");
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
        for (const k of P.PACK_SKIP[P.PACK_VERSION]) if (Object.hasOwn(doc, k) && packed[k] !== doc[k]) bad.push(`seed ${seed}: the ${k} section was touched`);
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
same([...P.PACK_SKIP[1]].sort(), ["dx", "earnings", "engine", "insiders", "short", "vx"], "the sections the dossier reads out of the row with SQL are the ones left as they are");
same(Object.keys(P.PACK_SKIP), ["1"], "version 1 of the format is the only one, and its skip list is a snapshot: changing it once rows are packed needs version 2");
ok(Object.isFrozen(P.PACK_SKIP) && Object.isFrozen(P.PACK_SKIP[1]) && Object.isFrozen(P.PACK_RESERVED), "frozen");
same([...P.PACK_RESERVED], ["pk", "d0", "dd", "__proto__"], "and so is the list of keys the format reserves");

{
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const vars = /\[vars\]([\s\S]*?)(?:\n\[|$)/.exec(toml);
  ok(vars && /^FLOWS_CARDX_PACK = "on"$/m.test(vars[1]), "wrangler.toml turns packing on in the variables the Worker deploys with: a named environment does not inherit them, so the pipeline's count of the soft limit on the stored form would otherwise be wrong");
  eq((toml.match(/^\[env\./gm) || []).length, 0, "and there is no named environment that would need the same line");
  const staging = readFileSync(new URL("../wrangler.staging.toml", import.meta.url), "utf8");
  ok(!/FLOWS_CARDX_PACK/.test(staging), "staging has its own configuration and stores whole");
}

{
  const extracted = [...DOSSIER_SQL.cardX.matchAll(/json_extract\(payload, '\$\.([A-Za-z]+)'\)/g)].map((x) => x[1]).filter((k) => !["sessionDate", "generatedAt"].includes(k)).sort();
  same(extracted, [...P.PACK_SKIP[1]].sort(), "and they are exactly the sections the dossier's card-x statement extracts, so a section added to that statement fails here until it is added to the skip list");
}

{
  const run = properties(P, 600);
  same(run.bad, [], "600 seeded random documents round-trip exactly, pack and unpack are idempotent, and nothing in a skipped section moves");
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

let rawMax = 0, storedMax = 0, storedMaxName = "", softShed = 0, listsSeen = 0;
for (const c of cards) {
  const doc = JSON.parse(c.text);
  const text = json(doc);
  const packed = P.packCardX(doc);
  eq(json(P.unpackCardX(packed)), text, "round trip, " + c.file);
  eq(P.unpackText(P.packText(text)), text, "text round trip, " + c.file);
  const raw = utf8(text), stored = P.storedBytes(doc);
  rawMax = Math.max(rawMax, raw);
  if (stored > storedMax) { storedMax = stored; storedMaxName = doc.ticker; }
  if ((doc.shed || []).includes("extras.soft")) softShed++;
  if (packed !== doc) {
    listsSeen += (json(packed).match(/"dd":/g) || []).length;
    ok(utf8(json(packed)) < raw, "a packed card is smaller, " + c.file);
    ok(P.isPackedText(json(packed)), "and carries the marker first, " + c.file);
  }
  for (const k of P.PACK_SKIP[1]) if (Object.hasOwn(doc, k)) ok(packed[k] === doc[k], `the ${k} section of ${c.file} is the very object it was`);
  const left = [];
  const scan = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => scan(x, path));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      if (k === "d" && Array.isArray(x) && x.length >= 3 && x.every((e) => typeof e === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e))) left.push(path + ".d");
      scan(x, path + "." + k);
    }
  };
  for (const [k, v] of Object.entries(packed)) if (!P.PACK_SKIP[1].includes(k)) scan(v, k);
  same(left, [], "no day list is left in full outside the skipped sections, " + c.file);
}
ok(listsSeen > 500, `the emit carries ${listsSeen} day lists`);
ok(storedMax <= HEADROOM_BYTES, `THE LARGEST CARD-X IS ${storedMax} BYTES STORED (${storedMaxName}), AT MOST 95% OF THE SOFT LIMIT: ${HEADROOM_BYTES} of ${CARD_X_SOFT_BYTES}`);
ok(storedMax <= STORED_CEILING, `and it is held at ${STORED_CEILING}, a ratchet that falls and is not raised without a named decision (${STORED_CEILING - storedMax} bytes of room)`);
eq(softShed, 0, "no card-x sheds its extras to the soft limit now: every part of every card stays whole");
ok(rawMax > CARD_X_SOFT_BYTES, `and the served text is larger than the soft limit for the largest (${rawMax} bytes), which is why the limit is counted on the stored form`);
ok(rawMax <= SERVED_CEILING, `the served text has its own ratchet at ${SERVED_CEILING} bytes, so growth that packing hides is seen: the largest is ${rawMax}`);
ok(rawMax <= Math.floor(0.9 * CARD_X_BUDGET_BYTES), `and stays under 90% of the 100 KiB ingest cap (${Math.floor(0.9 * CARD_X_BUDGET_BYTES)})`);
console.log(`  card-x: ${cards.length} cards, largest served ${rawMax} bytes, largest stored ${storedMax} bytes (${storedMaxName}), ${(100 * storedMax / CARD_X_SOFT_BYTES).toFixed(1)}% of the soft limit`);

{
  const stamp = { generatedAt: "2026-10-20T21:00:00Z", sessionDate: "2026-10-20", readAt: "2026-10-20T21:00:00Z" };
  const xp = (n) => ({ at: Date.parse("2026-10-20T20:00:00Z"), rv: 1, x: { ok: true, pad: "x".repeat(n) } });
  const parts = (series) => ({
    dx: { v: 1, status: "ok", parts: { info: xp(300), financials: xp(3000), analysts: xp(500) } },
    vx: { v: 1, status: "ok", parts: { dividends: xp(900), etf: xp(300) } },
    vrp: { series: { d: series, iv: series.map((_, i) => i % 7) } },
    pad: { rows: "y".repeat(CARD_X_SOFT_BYTES - 30000) },
  });
  const dates = trail("2018-01-02", Array.from({ length: 2199 }, (_, i) => (i % 5 === 4 ? 3 : 1)));
  const rich = cardXPayload("SYX101", parts(dates), stamp);
  ok(utf8(json(rich)) > CARD_X_SOFT_BYTES, `a card-x whose served text is ${utf8(json(rich))} bytes, over the soft limit`);
  ok(P.storedBytes(rich) <= CARD_X_SOFT_BYTES, `is ${P.storedBytes(rich)} bytes stored, under it`);
  ok(!rich.shed.includes("extras.soft") && rich.dx.parts.financials.x && rich.vx.parts.dividends.x, "and keeps every part whole, since the limit is on the stored form");
  const tooMuch = cardXPayload("SYX101", { ...parts(dates), pad: { rows: "y".repeat(CARD_X_SOFT_BYTES) } }, stamp);
  ok(tooMuch.shed.includes("extras.soft") && tooMuch.dx.parts.financials.shed === 1, "while a card that is over the limit even packed sheds its extras as before");
  const base = cardXPayload("SYX101", { vrp: { series: { d: dates, iv: dates.map(() => 0) } } }, stamp);
  const merged = composeCardXPayload(base, cardXPayload("SYX101", { dx: parts(dates).dx, vx: parts(dates).vx, pad: { rows: "y".repeat(CARD_X_SOFT_BYTES - 33000) } }, stamp));
  ok(!merged.shed.includes("extras.soft") && P.storedBytes(merged) <= CARD_X_SOFT_BYTES, "a merge onto a prior is counted on the stored form too");
  const rawSized = await loadMutated("scripts/flows-legs/card-x.mjs", [
    ["let bytes = storedBytes(payload);", "let bytes = Buffer.byteLength(JSON.stringify(payload));"],
    ["    bytes = storedBytes(payload);\n  }", "    bytes = Buffer.byteLength(JSON.stringify(payload));\n  }"],
  ], { salt: 900 });
  ok(rawSized.cardXPayload("SYX101", parts(dates), stamp).shed.includes("extras.soft"), "PLANTED WRONG BUILD, the soft limit counted on the served text: it sheds parts the stored form has room for");
  planted++;
  const noPack = await loadMutated("shared/flows-card-pack.js", [["return utf8Length(JSON.stringify(packCardX({ ...payload, bytes: SOFT_BYTES_PLACEHOLDER })));", "return utf8Length(JSON.stringify({ ...payload, bytes: SOFT_BYTES_PLACEHOLDER }));"]], { salt: 901 });
  ok(noPack.storedBytes(rich) > CARD_X_SOFT_BYTES, "PLANTED WRONG BUILD, a stored size that does not pack: it reads the served size");
  planted++;
}

const LEAF = [
  ["a gap one day long", "gaps.push(at - prev);", "gaps.push(at - prev + 1);"],
  ["a day one too late", "const dayText = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);", "const dayText = (n) => new Date((n + 1) * DAY_MS).toISOString().slice(0, 10);"],
  ["an unsorted list packed", "if (at === null || at < prev) return null;", "if (at === null) return null;"],
  ["an impossible day packed", " && new Date(ms).toISOString().slice(0, 10) === text ? ms / DAY_MS : null;", " ? ms / DAY_MS : null;"],
  ["a skipped section packed", "out[k] = skip.includes(k) ? payload[k] : lower(payload[k], tally)", "out[k] = lower(payload[k], tally)"],
  ["a skipped section lifted", "out[k] = skip.includes(k) ? x : lift(x);", "out[k] = lift(x);"],
  ["the reserved keys not looked for", "if (!skip.includes(k) && hasReserved(payload[k])) return payload;", ""],
  ["the top-level reserved keys not looked for", 'if (k === "d0" || k === "dd" || k === "__proto__") return payload;', ""],
  ["a document already packed packed again", "if (!isObject(payload) || Object.hasOwn(payload, PACK_KEY)) return payload;", "if (!isObject(payload)) return payload;"],
  ["the marker last", "const out = { [PACK_KEY]: PACK_VERSION };\n  const tally = { lists: 0 };\n  for (const k of keys) out[k] = skip.includes(k) ? payload[k] : lower(payload[k], tally);", "const out = {};\n  const tally = { lists: 0 };\n  for (const k of keys) out[k] = skip.includes(k) ? payload[k] : lower(payload[k], tally);\n  out[PACK_KEY] = PACK_VERSION;"],
  ["the list put back at the end of the object", [["  const out = {};\n  for (const [k, x] of Object.entries(v)) {\n    if (k === \"dd\" && Object.hasOwn(v, \"d0\")) continue;", "  const out = {};\n  let tailDays = null;\n  for (const [k, x] of Object.entries(v)) {\n    if (k === \"dd\" && Object.hasOwn(v, \"d0\")) continue;"], ["      out.d = days;\n    } else out[k] = lift(x);\n  }\n  return out;", "      tailDays = days;\n    } else out[k] = lift(x);\n  }\n  if (tailDays) out.d = tailDays;\n  return out;"]]],
  ["a list with no change packed", "return tally.lists > 0 ? out : payload;", "return out;"],
  ["a negative gap decoded", "if (!Number.isInteger(g) || g < 0) return null;", "if (!Number.isInteger(g)) return null;"],
  ["a corrupt packed row served as it is", [["    return isPacked(value) ? JSON.stringify(unpackCardX(value)) : null;\n  } catch {\n    return null;\n  }", "    return isPacked(value) ? JSON.stringify(unpackCardX(value)) : null;\n  } catch {\n    return text;\n  }"]]],
  ["a version this build does not know served as it is", [["JSON.stringify(unpackCardX(value)) : null;", "JSON.stringify(unpackCardX(value)) : text;"]]],
  ["the round trip checked against the value and not the text", [["JSON.stringify(unpackCardX(JSON.parse(out))) === text ? out : text;", "JSON.stringify(unpackCardX(JSON.parse(out))) === JSON.stringify(value) ? out : text;"]]],
  ["the marker looked for in nested keys", [["export const carriesMarker = (value) => isObject(value) && Object.hasOwn(value, PACK_KEY);", "export const carriesMarker = (value) => isObject(value) && hasReserved(value);"]]],
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
  eq(gappy.packText(text), text, "A PACKER WITH A BUG STILL WRITES THE DOCUMENT WHOLE: the write checks its own round trip and falls back to the text it was given");
  ok(blind.unpackText(blind.packText(text)) !== text, "PLANTED WRONG BUILD, a write that does not check its round trip: with the same bug it stores a document that reads back wrong");
  planted++;
}

{
  const store = readFileSync(new URL("../server/store.js", import.meta.url), "utf8");
  const writes = store.match(/\.bind\([^)]*\b(?:payload|it\.payload)\b[^)]*\)/g) || [];
  ok(writes.length >= 4, `the store binds a payload in ${writes.length} statements`);
  const unpacked = writes.filter((w) => !/toStored\(env, (?:it\.)?key, (?:it\.)?payload\)/.test(w) && !/bind\(text, at\)/.test(w) && !/bind\(key, payload, at\)/.test(w));
  same(unpacked, [], "every statement that writes a key's payload goes through toStored: " + unpacked.join(" ; "));
  same((store.match(/bind\(key, payload, at\)/g) || []).length, 1, "and the only exception is the write-once archive insert, whose keys are dated board and score rows");
  ok(/const payload = typeof key === "string" && CARD_X_KEY_RE\.test\(key\) \? unpackText\(row\.payload\) : row\.payload;/.test(store), "every nightly read goes through storedFrom, which unpacks a card-x key and no other");
  ok(/return payload === null \? null : \{ payload, updatedAt/.test(store), "and a card-x row that does not decode is absent, not served packed");
  const planRead = /async planRead\(env\) \{[\s\S]*?\n    \},/.exec(store);
  ok(planRead && /payload: row\.payload,/.test(planRead[0]), "the other place a stored payload is returned is the plan row, which is never a card-x");
  eq((store.match(/storedFrom\(/g) || []).length, 2, "storedFrom is called by read, with its key, and by readMany, which selects the id");
  ok(/CARD_X_KEY_RE = \/\^card-x:\//.test(store) && /env\.FLOWS_CARDX_PACK === "on"/.test(store), "only a card-x key is packed, and only while the switch reads on");
}

const { FLOWS_COOKIE, sessionEpoch, signFlowsSession } = await import("../shared/flows-auth.js");
const { FIXTURE_ROSTER } = await import("./lib/fixture-roster.mjs");
const H = await import("./dossier-harness.mjs");
const DF = await import("./dossier-fixtures.mjs");
const W = await import("../shared/flows-live-worker.js");
const { createFlowsStore } = await import("../server/store.js");

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
  const biggest = cards.map((c) => JSON.parse(c.text)).find((d) => d.ticker === storedMaxName);
  const text = json(biggest);
  const key = "card-x:" + storedMaxName;
  const post = (call, k, body) => call("/api/flows/ingest?key=" + encodeURIComponent(k), { method: "POST", headers: { Authorization: "Bearer " + NIGHTLY, "Content-Type": "application/json" }, body });
  const get = (call, k) => call("/api/flows/ingest?key=" + encodeURIComponent(k), { headers: { Authorization: "Bearer " + NIGHTLY } });
  const restoreCache = H.cacheFake();

  const d = H.fakeD1();
  const on = await rig({ DB: d.D1, FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_CARDX_PACK: "on" }, "https://anilkaya.test");
  const w1 = await post(on, key, text);
  eq(w1.res.status, 200, "the ingest door takes the largest card-x of the emit with the switch on: " + w1.text.slice(0, 120));
  const stored = rowOf(d, key).payload;
  ok(P.isPackedText(stored), "the row is stored packed");
  ok(stored.length < text.length - 5000, `and is ${text.length - stored.length} characters shorter than the body that was posted`);
  eq(stored, json(P.packCardX(biggest)), "the stored text is the packed form of the document and nothing else");
  eq(utf8(stored), P.storedBytes(biggest), "and is exactly the size the pipeline counted it at when it fitted the card to the soft limit");
  const served = await on("/api/flows/card-x?t=" + storedMaxName);
  eq(served.res.status, 200, "the card-x route answers");
  eq(served.text, text, "AND SERVES THE DOCUMENT AS POSTED, byte for byte: no reader sees the packed form");
  eq((await get(on, key)).text, text, "the pipeline's own read of the key through the ingest door gets the document too");
  const meta = await post(on, "card:" + storedMaxName, json({ v: 2, ticker: storedMaxName, sessionDate: "2026-08-24", generatedAt: "2026-08-24T21:45:00.000Z", fixture: true, x: { d: trail("2026-08-17", [1, 1, 1, 1, 3]) } }));
  eq(meta.res.status, 200, "a card key is taken: " + meta.text.slice(0, 100));
  ok(!P.isPackedText(rowOf(d, "card:" + storedMaxName).payload) && rowOf(d, "card:" + storedMaxName).payload.includes('"d":["2026-08-17"'), "and stored whole: only card-x rows are packed");
  const hist = await post(on, "hist:" + storedMaxName, json({ v: 1, ticker: storedMaxName, sessionDate: "2026-08-24", generatedAt: "2026-08-24T21:45:00.000Z", fixture: true, d: trail("2026-08-17", [1, 1, 1, 1, 3]) }));
  eq(hist.res.status, 200, "a hist key is taken: " + hist.text.slice(0, 100));
  ok(!P.isPackedText(rowOf(d, "hist:" + storedMaxName).payload), "and stored whole");

  for (const [label, env] of [["off", { FLOWS_CARDX_PACK: "off" }], ["unset", {}], ["a misspelt on", { FLOWS_CARDX_PACK: "On" }], ["warn", { FLOWS_CARDX_PACK: "warn" }]]) {
    const dd = H.fakeD1();
    const call = await rig({ DB: dd.D1, FLOWS_INGEST_TOKEN: NIGHTLY, ...env }, "https://anilkaya.test");
    eq((await post(call, key, text)).res.status, 200, `with the switch ${label} the door takes the card`);
    eq(rowOf(dd, key).payload, text, "and stores it whole: only the word on packs");
    eq((await call("/api/flows/card-x?t=" + storedMaxName)).text, text, "and serves it");
  }

  {
    const dd = H.fakeD1();
    const whole = await rig({ DB: dd.D1, FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_CARDX_PACK: "off" }, "https://anilkaya.test");
    await post(whole, key, text);
    const flipped = await rig({ DB: dd.D1, FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_CARDX_PACK: "on" }, "https://anilkaya.test");
    eq((await flipped("/api/flows/card-x?t=" + storedMaxName)).text, text, "a row written before the switch went on is served as it is");
    await post(flipped, key, text);
    ok(P.isPackedText(rowOf(dd, key).payload), "and is packed the next time it is written");
    const back = await rig({ DB: dd.D1, FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_CARDX_PACK: "off" }, "https://anilkaya.test");
    eq((await back("/api/flows/card-x?t=" + storedMaxName)).text, text, "and a packed row is still served whole after the switch is put back to off: the reader never needs the switch");
    await post(back, key, text);
    eq(rowOf(dd, key).payload, text, "which stores the next write whole, the way back");
  }

  {
    const dd = H.fakeD1();
    const store = createFlowsStore({ ensureFlowsTables: async () => {} });
    const env = { DB: dd.D1, FLOWS_CARDX_PACK: "on" };
    const m = { chash: "a".repeat(64), session: "2026-08-24", quality: 255, epoch: 1, asof: 1 };
    await store.write(env, key, text, 5);
    ok(P.isPackedText(rowOf(dd, key).payload), "the plain write packs");
    await store.doorWrite(env, "card-x:ZZZ", text, 6, m);
    ok(P.isPackedText(rowOf(dd, "card-x:ZZZ").payload), "the door's write packs");
    await store.doorBatch(env, [{ key: "card-x:YYY", payload: text, m }, { key: "board:long", payload: json({ d: trail("2026-08-17", [1, 1, 1]) }), m }], 7);
    ok(P.isPackedText(rowOf(dd, "card-x:YYY").payload), "the door's batch packs");
    ok(!P.isPackedText(rowOf(dd, "board:long").payload), "and leaves another key in the same batch alone");
    eq((await store.read(env, "card-x:YYY")).payload, text, "the store reads it back whole");
    eq((await store.readMany(env, ["card-x:YYY", key])).get(key).payload, text, "and so does the many-key read");
    ok(rowOf(dd, "card-x:YYY").payload.length < text.length, "from a smaller row");
  }

  {
    const dd = H.fakeD1();
    const store = createFlowsStore({ ensureFlowsTables: async () => {} });
    const env = { DB: dd.D1 };
    const other = '{"pk":1,"d0":"2025-01-02","dd":[1,1],"x":1}';
    dd.put("board:long", other);
    eq((await store.read(env, "board:long")).payload, other, "a row of another key that happens to start with a pk field comes back byte for byte, unpacked by nothing");
    eq((await store.readMany(env, ["board:long"])).get("board:long").payload, other, "by the many-key read too");
    dd.put("card-x:BRKN", '{"pk":1,"a":{"d0":"2026-01-01","dd":[1,-3]}}');
    eq(await store.read(env, "card-x:BRKN"), null, "a card-x row whose gaps do not decode is absent");
    dd.put("card-x:NEWV", '{"pk":2,"a":1}');
    eq(await store.read(env, "card-x:NEWV"), null, "and so is one written by a later version of the format");
    eq((await store.readMany(env, ["card-x:BRKN", "card-x:NEWV", "board:long"])).get("card-x:BRKN"), null, "by the many-key read as well");
    const on = await rig({ DB: dd.D1, FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_CARDX_PACK: "on" }, "https://anilkaya.test");
    const seen = await on("/api/flows/card-x?t=BRKN");
    ok(!seen.text.includes('"d0"') && !seen.text.includes('"pk"'), "the card-x route never serves a packed document: " + seen.text.slice(0, 100));
    const sent = await post(on, "card-x:SYN010", json({ pk: 1, v: 1, ticker: "SYN010", sessionDate: "2026-08-24", generatedAt: "2026-08-24T21:45:00.000Z", fixture: true }));
    eq(sent.res.status, 400, "a body that carries the marker key itself is refused by the ingest door whatever the switch says: " + sent.text.slice(0, 120));
    eq(rowOf(dd, "card-x:SYN010"), undefined, "and nothing is stored");
    const off = await rig({ DB: dd.D1, FLOWS_INGEST_TOKEN: NIGHTLY }, "https://anilkaya.test");
    eq((await post(off, "card-x:SYN010", json({ pk: 1, v: 1, ticker: "SYN010", sessionDate: "2026-08-24", generatedAt: "2026-08-24T21:45:00.000Z", fixture: true }))).res.status, 400, "with the switch unset too");
    const nested = await post(on, "card-x:SYN010", json({ v: 1, ticker: "SYN010", sessionDate: "2026-08-24", generatedAt: "2026-08-24T21:45:00.000Z", fixture: true, a: { pk: 1 } }));
    eq(nested.res.status, 200, "a nested pk is data");
    const warn = await rig({ DB: dd.D1, FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_CARDX_PACK: "on", FLOWS_DOOR_V2: "warn" }, "https://anilkaya.test");
    const batch = await warn("/api/flows/ingest?op=batch", { method: "POST", headers: { Authorization: "Bearer " + NIGHTLY, "Content-Type": "application/json" }, body: json({ items: [
      { key: "card-x:SYN011", payload: json({ ...biggest, ticker: "SYN011" }) },
      { key: "card-x:SYN012", payload: json({ pk: 1, v: 1, ticker: "SYN012" }) },
    ] }) });
    eq(batch.res.status, 200, "the door's batch answers: " + batch.text.slice(0, 120));
    const results = JSON.parse(batch.text).results;
    same([results[0].ok, results[1].ok, results[1].code], [true, false, "invalid_payload"], "and refuses the item that carries the marker, whatever it does with the others");
    ok(P.isPackedText(rowOf(dd, "card-x:SYN011").payload), "while the other item is stored packed");
    eq(rowOf(dd, "card-x:SYN012"), undefined, "and the refused one is not stored");
  }

  restoreCache.restore();
}

{
  const restoreClock = H.shiftClock();
  const cache = H.cacheFake();
  const stub = H.vendorStub();
  const x0 = (() => { const f = H.fakeD1(); DF.seed(f); return JSON.parse(rowOf(f, "card-x:" + DF.T).payload); })();
  const rich = {
    ...x0,
    vrp: { status: "ok", series: { d: trail("2026-05-01", Array.from({ length: 80 }, (_, i) => (i % 5 === 4 ? 3 : 1))), iv: Array.from({ length: 81 }, (_, i) => 20 + (i % 9)) } },
    skew: { status: "ok", series: { d: trail("2026-06-01", Array.from({ length: 40 }, (_, i) => (i % 5 === 4 ? 3 : 1))), rr: Array.from({ length: 41 }, (_, i) => i / 10) } },
    contracts: { status: "ok", rows: [{ k: 100, d: trail("2026-08-03", [1, 1, 1]) }, { k: 105, d: trail("2026-08-03", [1, 2, 1, 1]) }] },
  };
  const plainText = json(rich);
  const packedText = P.packText(plainText);
  ok(P.isPackedText(packedText) && packedText.length < plainText.length - 600, `the seeded card-x for the dossier harness carries ${plainText.length - packedText.length} characters of day lists`);
  const worlds = [];
  for (const [label, body] of [["whole", plainText], ["packed", packedText]]) {
    const f = H.fakeD1();
    DF.seed(f);
    f.put("card-x:" + DF.T, body);
    W.memoClock(null, 0);
    stub.reset();
    cache.clear();
    const call = await rig({ DB: f.D1, FLOWS_CARDX_PACK: "on" }, "https://anilkaya.org");
    const out = {};
    for (const [name, route] of [["cardX", "/api/flows/card-x?t=" + DF.T], ["card", "/api/flows/card?t=" + DF.T], ["dossier", "/api/flows/dossier?t=" + DF.T], ["render", "/api/flows/dossier?t=" + DF.T + "&render=1"], ["hist", "/api/flows/hist?t=" + DF.T]]) {
      const r = await call(route);
      out[name] = { status: r.res.status, text: r.text, fingerprint: r.res.headers.get("X-Dossier-Fingerprint") };
    }
    worlds.push([label, out, rowOf(f, "card-x:" + DF.T).payload]);
  }
  const [[, whole, wholeRow], [, packed, packedRow]] = worlds;
  eq(wholeRow, plainText, "the first world holds the document whole");
  ok(P.isPackedText(packedRow), "and the second holds it packed");
  eq(packed.cardX.text, whole.cardX.text, "the card-x route answers the same bytes from a packed row");
  eq(packed.cardX.text, plainText, "which are the document");
  eq(packed.card.text, whole.card.text, "the card route, which reads the engine out of card-x, answers the same");
  eq(packed.dossier.status, 200, "the dossier route answers");
  const clockless = (t) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "T");
  eq(clockless(packed.dossier.text), clockless(whole.dossier.text), "THE DOSSIER IS THE SAME TEXT FROM A PACKED ROW: it reads its subtrees with SQL and the packer leaves those sections as they are");
  eq(packed.dossier.fingerprint, whole.dossier.fingerprint, "with the same fingerprint");
  eq(clockless(packed.render.text), clockless(whole.render.text), "and the same text for a model");
  eq(packed.hist.text, whole.hist.text, "the hist route is untouched");
  ok(packed.dossier.text.length > 2000, "and the dossier is not empty (" + packed.dossier.text.length + " characters)");
  stub.restore();
  cache.restore();
  restoreClock();
}

console.log(`✓ flows-card-pack: ${checks} assertions, no server, no vendor call: card-x rows are stored with their day lists as gaps (a marker, the first day and the gaps) and read back whole at the store, so the largest of ${cards.length} emitted cards is ${storedMax} bytes stored of ${CARD_X_SOFT_BYTES} (${(100 * storedMax / CARD_X_SOFT_BYTES).toFixed(1)}%), 600 random documents and ${cards.length} real ones round-trip exactly in six time zones, the Worker serves, the ingest door answers and the dossier reads the same bytes from a packed row as from a whole one, the switch fails closed, a packer with a bug writes the document whole, and ${planted} planted wrong builds fail`);
