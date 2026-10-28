import assert from "node:assert/strict";
import * as R from "../shared/flows-reading.js";
import * as S from "../shared/flows-ai-salvage.js";
import { numeralsIn } from "../shared/flows-ask.js";
import { archetype, ARCHETYPES } from "./reading-archetypes.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import * as CPU from "./lib/cpu-budget.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const log = (line) => console.log('  ' + line);
const clause = " on the feed's convention (dealers long calls, short puts)";
const BASES = Object.fromEntries(ARCHETYPES.map((n) => [n, archetype(n)]));

const MOMENTUM = BASES.momentum;
const MOMENTUM_TAGS = R.heldTags(MOMENTUM);
const MOMENTUM_PROMPT = R.promptForReading(MOMENTUM, MOMENTUM_TAGS);

const GOOD = {
  identity: { text: "Example Technologies Inc sells subscription software and cloud infrastructure to mid-sized enterprises, with revenue mostly from recurring contracts.", cites: ["identity.name", "identity.description"] },
  now: { text: "The last price is $127.40, +1.27% from the previous close, with RSI at 72.0 of 100 and the close +9.40% against its 50-day average. Net option premium today is +$9.40M and the next earnings report is dated 2026-10-07, 4 sessions after the last close.", cites: ["price.last", "price.change", "price.rsi", "price.sma50", "flow.strip.net", "events.next", "events.sessions"] },
  drivers: [
    { text: "Earnings are close: the report is 4 sessions away and the move priced for it, 7.00%, is above the 5.20% median move after past reports.", cites: ["events.sessions", "events.impliedMove", "earnings.react.medianMove"] },
    { text: "News flow is heavy: 8 headlines in the last 24 hours, 2 of them marked major by the feed, and Reuters reports that the company lifts guidance.", cites: ["news.count24h", "news.major24h", "news.h1"] },
    { text: "Dealers are pinned near a level: the implied dealer state is pinned" + clause + ", with the gamma flip at $124.00.", cites: ["options.state", "options.engine.level.flip"] },
    { text: "Option flow leans to calls: bullish against bearish premium is +0.62.", cites: ["flow.strip.lean"] },
  ],
  tensions: [{ text: "Dealers pin price near a level" + clause + ", while the move priced for the report, 7.00%, is above the median past move, 5.20%.", cites: ["options.state", "events.impliedMove", "earnings.react.medianMove"] }],
  unknown: [{ text: "Several options items are withheld, so only what is shown is known about options structure.", missing: ["options"] }],
  tags: ["event-priced", "trend-extended-up", "flow-led-calls"],
  watch: [{ text: "Below the gamma flip at $124.00, dealers are net short gamma" + clause + ".", cites: ["options.engine.level.flip"] }],
};

const HOSTILE = {
  identity: { text: "A \"quoted\" name with {braces}, [brackets], a back\\slash, a café, an emoji 😀 and a line\nbreak. It also ends \\\"oddly\\\".", cites: ["identity.name"] },
  now: { text: "The close is $127.40 }{ ][ and   done.", cites: ["price.last", "price.change"] },
  drivers: [{ text: "One. Two \"three\". Four.", cites: ["a\"b", "c\\d", "e]f", "g}h"] }, { text: "[", cites: ["}"] }],
  tags: ["x\\", "y\"", "]"],
  watch: [{ text: "", cites: [] }],
  extra: { nested: { deeper: [[1, 2, { k: "v" }], [], {}], flag: true, none: null, num: -12.5e3 } },
};

function replyOf(name) {
  const d = BASES[name];
  const tags = R.heldTags(d);
  const fb = R.readingFallback(d, tags);
  const reply = {};
  for (const k of ["identity", "now"]) if (fb[k]) reply[k] = fb[k];
  for (const k of ["drivers", "tensions"]) reply[k] = fb[k].map(({ text, cites }) => ({ text, cites }));
  reply.unknown = fb.unknown;
  reply.tags = fb.tags;
  reply.watch = fb.watch.map(({ text, cites }) => ({ text, cites }));
  return reply;
}

const REPLIES = [
  ...ARCHETYPES.map((n) => ({ name: n, reply: replyOf(n), dossier: BASES[n] })),
  { name: "momentum-model", reply: GOOD, dossier: MOMENTUM },
  { name: "hostile", reply: HOSTILE, dossier: MOMENTUM },
  { name: "hostile-pretty", reply: HOSTILE, dossier: MOMENTUM, pretty: true },
];

const rawOf = (r) => (r.pretty ? JSON.stringify(r.reply, null, 2) : JSON.stringify(r.reply));

const prefixesOf = (text) => {
  const buf = Buffer.from(text, "utf8");
  const out = [];
  for (let b = 0; b <= buf.length; b++) out.push(buf.subarray(0, b).toString("utf8"));
  return out;
};

function checkOffsets(mod, entry, label) {
  const text = rawOf(entry);
  const scan = S.scanReply(text);
  const closed = new Map();
  for (const m of [...scan.members, ...scan.elements]) closed.set(m.start + "-" + m.end, text.slice(m.start, m.end));
  const whole = R.parseReading(text);
  let previous = {};
  let bytes = 0;
  const prefixes = prefixesOf(text);
  for (let b = 0; b < prefixes.length; b++) {
    const part = mod.parseReadingPartial(prefixes[b]);
    const prefixBytes = Buffer.byteLength(prefixes[b]);
    for (const m of part.members) {
      if (closed.get(m.start + "-" + m.end) !== m.raw) throw new Error(`${label}: offset ${b}: ${m.path} is not an item of the whole reply`);
      if (Buffer.byteLength(text.slice(0, m.end)) > prefixBytes) throw new Error(`${label}: offset ${b}: ${m.path} ends after the cut`);
    }
    if (b < prefixes.length - 1 && part.value !== null && part.truncated !== true) throw new Error(`${label}: offset ${b}: a cut reply is not marked truncated`);
    const current = part.value || {};
    for (const [key, v] of Object.entries(previous)) {
      const now = current[key];
      if (now === undefined) throw new Error(`${label}: offset ${b}: the salvaged set lost ${key}`);
      if (Array.isArray(v)) {
        if (!Array.isArray(now) || now.length < v.length || v.some((x, i) => JSON.stringify(x) !== JSON.stringify(now[i]))) throw new Error(`${label}: offset ${b}: ${key} did not grow from what it was`);
      } else if (JSON.stringify(v) !== JSON.stringify(now)) throw new Error(`${label}: offset ${b}: ${key} changed`);
    }
    previous = current;
    for (const [key, v] of Object.entries(current)) {
      const target = whole[key];
      if (Array.isArray(v)) {
        if (!Array.isArray(target) || v.length > target.length || v.some((x, i) => JSON.stringify(x) !== JSON.stringify(target[i]))) throw new Error(`${label}: offset ${b}: ${key} is not a prefix of the whole list`);
      } else if (JSON.stringify(v) !== JSON.stringify(target)) throw new Error(`${label}: offset ${b}: ${key} differs from the whole reply`);
    }
    bytes++;
  }
  const last = mod.parseReadingPartial(text);
  if (JSON.stringify(last.value) !== JSON.stringify(whole) || last.truncated) throw new Error(`${label}: at full length the salvage is not parseReading`);
  return bytes;
}

let offsets = 0;
for (const entry of REPLIES) {
  const n = checkOffsets(S, entry, entry.name + (entry.pretty ? " (indented)" : ""));
  offsets += n;
  checks += n;
}
ok(offsets > 15000, `A1: ${offsets} cut offsets across ${REPLIES.length} valid replies: every salvaged item is byte-identical to an item of the whole reply, the set only grows, and the whole reply equals parseReading`);

{
  const text = JSON.stringify(GOOD);
  same(S.parseReadingPartial(text).value, R.parseReading(text), "at full length the salvaged value equals parseReading");
  eq(S.parseReadingPartial(text).truncated, false, "and is not marked truncated");
  eq(S.parseReadingPartial("```json\n" + text + "\n```").truncated, false, "a fenced reply is read the way parseReading reads it");
  same(S.parseReadingPartial("Here is the reading: " + text + " Thanks.").value, GOOD, "prose before and after the object is ignored");
  eq(S.parseReadingPartial("").value, null, "an empty reply holds nothing");
  eq(S.parseReadingPartial("no braces at all").value, null, "and so does prose");
  eq(S.parseReadingPartial(null).value, null, "and so does a non-string");
  eq(S.parseReadingPartial("{\"a\": 1, \"b\": 2").truncated, true, "a cut object is truncated");
  same(S.parseReadingPartial("{\"a\": 1, \"b\": 2").value, { a: 1 }, "a number with no delimiter after it has not closed: it could have another digit coming");
  same(S.parseReadingPartial("{\"a\": 1, \"b\": 22,").value, { a: 1, b: 22 }, "and one followed by a delimiter has");
  same(S.parseReadingPartial("{\"a\": [1, 2, 3").value, { a: [1, 2] }, "a cut list keeps the elements that closed");
  same(S.parseReadingPartial("{\"a\": [\"x\", \"y").value, { a: ["x"] }, "a string with no closing quote has not closed");
  same(S.parseReadingPartial("{\"a\": \"x\\\"").value, {}, "an escaped quote does not close a string");
  same(S.parseReadingPartial("{\"a\": \"x\\\\\"").value, { a: "x\\" }, "an escaped backslash does");
  same(S.parseReadingPartial("{\"a\": {\"b\": [1]}, \"c\": {\"d\"").value, { a: { b: [1] } }, "an object with a cut member holds back as a whole");
  eq(S.parseReadingPartial("{\"a\": 1} trailing {\"b\": 2}").truncated, false, "the first object is the reply and what follows it is ignored");
  eq(S.parseReadingPartial("{\"a\": ]").value, null, "an unbalanced close is not salvaged");
  eq(S.parseReadingPartial("{\"a\": [1, bad, 3], \"b\": 2}").value, null, "a token that is not JSON is malformed, as parseReading finds it, and nothing is kept");
  eq(S.parseReadingPartial("{\"a\": 1, \"a\": 2}").value.a, 2, "a repeated key takes the last value, as JSON.parse does");
}

{
  const P = S.parseReadingPartial;
  const D = (o) => JSON.stringify(o);
  const cases = [
    ["a missing comma between two members", '{"identity":{"text":"a","cites":["x"]} "now":{"text":"b","cites":["y"]},"drivers":['],
    ["a missing comma between two top-level lists", '{"drivers":[{"text":"a","cites":["x"]}] "tensions":[{"text":"b","cites":["y"]}],"watch":['],
    ["a missing comma between two list elements", '{"drivers":[{"text":"a","cites":["x"]} {"text":"b","cites":["y"]},'],
    ["a trailing comma in an object", '{"now":{"text":"a","cites":["x"]},}'],
    ["a trailing comma in a list", '{"drivers":[{"text":"a","cites":["x"]},],"now":'],
    ["a comma before the first member", '{,"now":{"text":"a","cites":["x"]}'],
    ["a double comma", '{"now":{"text":"a","cites":["x"]},,"identity":'],
    ["a missing colon", '{"now" {"text":"a","cites":["x"]},"identity":'],
    ["a colon where a comma belongs", '{"now":{"text":"a","cites":["x"]}:"identity":'],
    ["a key that is not a string", '{now:{"text":"a","cites":["x"]},"identity":'],
    ["a value that is a bare word", '{"identity":{"text":"a","cites":["x"]},"now":oops,"drivers":['],
    ["a raw newline inside a string", '{"identity":{"text":"a\nb","cites":["x"]},"now":'],
    ["a list closed by a brace", '{"drivers":[{"text":"a","cites":["x"}],"now":'],
  ];
  for (const [label, text] of cases) {
    const part = P(text);
    eq(part.value, null, label + ": nothing is salvaged, so nothing can sit under a wrong key");
    eq(part.truncated, false, label + ": and the reply is not treated as merely cut off");
    eq(S.scanReply(text).malformedAt !== undefined, true, label + ": the scanner records where the grammar broke");
    const sv = S.salvageReading(text, MOMENTUM, MOMENTUM_TAGS, { sources: [] });
    const vet = R.vetReading(text, MOMENTUM, MOMENTUM_TAGS, { sources: [] });
    eq(sv.ok, false, label + ": refused");
    same(sv.refused, vet.refused, label + ": with the refusal vetReading gives the same text");
  }
  const whole = D(GOOD);
  const wholeCases = [
    ["a trailing comma", whole.slice(0, -1) + ",}"],
    ["a second object after the first with a brace in the prose", whole + " and also {see}"],
    ["two objects back to back", whole + whole],
    ["a missing comma then the end", whole.replace('},"now"', '}"now"')],
    ["leading prose with a brace", "Reading {draft}: " + whole],
    ["fenced with trailing prose", "```json\n" + whole + "\n``` thanks"],
    ["valid", whole],
    ["valid, indented", JSON.stringify(GOOD, null, 2)],
    ["valid, fenced", "```json\n" + whole + "\n```"],
    ["valid, trailing prose without a brace", whole + " Thanks."],
  ];
  for (const [label, text] of wholeCases) {
    const sv = S.salvageReading(text, MOMENTUM, MOMENTUM_TAGS, { sources: [] });
    const vet = R.vetReading(text, MOMENTUM, MOMENTUM_TAGS, { sources: [] });
    eq(sv.ok, vet.ok, label + ": a reply that closes is accepted exactly when vetReading accepts the original string");
    same(sv.sections, vet.sections, label + ": and its sections are vetReading's");
    same(sv.refused, vet.refused, label + ": and so are its refusals");
    eq(sv.salvaged, false, label + ": and it is not reported as salvaged");
  }
  const mixed = '{"identity":' + D(GOOD.identity) + ' "now":' + D(GOOD.now) + ',"drivers":[';
  const mp = P(mixed);
  eq(mp.value, null, "the reported case, a missing comma after identity then a cut, files nothing: now is not read as a value of identity");
  same(P('{"a":[1,2],"b":{"c":3},"d":[4,5').value, { a: [1, 2], b: { c: 3 }, d: [4] }, "valid grammar with nested lists and objects is untouched");
  same(P('{"a":-1.5e3,"b":true,"c":null,"d":"x"}').value, { a: -1500, b: true, c: null, d: "x" }, "every JSON primitive is accepted");
  eq(P('{"a":01}').value, null, "a number with a leading zero is not");
}

const cpuMs = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; };

function perCall(fn) {
  let reps = 1;
  for (;;) {
    const t0 = cpuMs();
    for (let i = 0; i < reps; i++) fn();
    if (cpuMs() - t0 >= 40 || reps >= 1 << 20) break;
    reps *= 2;
  }
  let best = Infinity;
  for (let w = 0; w < 5; w++) {
    const t0 = cpuMs();
    for (let i = 0; i < reps; i++) fn();
    best = Math.min(best, (cpuMs() - t0) / reps);
  }
  return best;
}

{
  const big = { ...GOOD, drivers: GOOD.drivers.concat(GOOD.drivers), tensions: GOOD.tensions.concat(GOOD.tensions) };
  const text = JSON.stringify(big);
  const cut3000 = text.slice(0, 3000);
  const run = CPU.compare(() => S.parseReadingPartial(cut3000), { perWindow: 200 });
  CPU.assertBudget(run, { median: 0.25, worst: 0.5 }, "the scan of a cut reply");
  ok(true, `the scan of a reply cut at 3,000 of ${text.length} characters costs ${run.subject.median.toFixed(3)} ms of CPU, ${run.ratio.median.toFixed(4)} of the reference workload, inside the ratio budget on the ${run.clock} clock`);
  const scaling = [];
  for (const k of [1, 4, 16]) {
    const t = JSON.stringify({ now: GOOD.now, drivers: Array.from({ length: 4 * k }, (_, i) => GOOD.drivers[i % 4]) }).slice(0, -3);
    scaling.push([t.length, perCall(() => S.parseReadingPartial(t))]);
  }
  ok(scaling[2][1] / scaling[0][1] < (scaling[2][0] / scaling[0][0]) * 2.5, `the scan is linear in the reply (${scaling.map(([n, ms]) => n + " characters " + ms.toFixed(3) + " ms").join(", ")})`);
  const big2 = "{\"a\": \"" + "x".repeat(2000000);
  const s1 = cpuMs();
  eq(S.parseReadingPartial(big2).truncated, true, "a two-megabyte unterminated string is scanned, not parsed");
  ok(cpuMs() - s1 < 200, "in one pass");
  const deep = "{\"a\":" + "[".repeat(200000);
  const s2 = cpuMs();
  eq(S.parseReadingPartial(deep).truncated, true, "and so is a list nested two hundred thousand deep, with no recursion");
  ok(cpuMs() - s2 < 600, "also in one pass");
}

async function mustFail(label, rel, transforms, run) {
  const mod = await loadMutated(rel, transforms);
  let failed = false;
  try { run(mod); } catch { failed = true; }
  ok(failed, label);
}

await mustFail("A WRONG BUILD FAILS A1: a scanner that ignores escapes is caught at some cut offset", "shared/flows-ai-salvage.js",
  [["else if (c === 92) esc = true;", "else if (c === 0) esc = true;"]], (mod) => checkOffsets(mod, REPLIES.find((r) => r.name === "hostile"), "hostile"));
await mustFail("A WRONG BUILD FAILS A1: a scanner that keeps a number at the end of the text as closed is caught", "shared/flows-ai-salvage.js",
  [["malformedAt = i; break; } else continue;", "malformedAt = i; break; } else { if (i === n - 1) complete(prim, i + 1); continue; }"]],
  (mod) => { for (const t of ["{\"a\": 1, \"b\": 22", "{\"a\": [1, 22"]) { const p = mod.parseReadingPartial(t); const q = S.parseReadingPartial(t); if (JSON.stringify(p.value) !== JSON.stringify(q.value)) throw new Error("differs"); } });
await mustFail("A WRONG BUILD FAILS A1: a scanner that counts a string as closed at an escaped quote is caught on the indented reply", "shared/flows-ai-salvage.js",
  [["if (esc) esc = false;", "if (esc) esc = esc;"]], (mod) => checkOffsets(mod, REPLIES.find((r) => r.name === "hostile-pretty"), "hostile-pretty"));
await mustFail("A WRONG BUILD FAILS A1: a salvage that returns the open element as well is caught", "shared/flows-ai-salvage.js",
  [["  const closedObject = scan.closedAt >= 0;", "  if (scan.open && scan.open.index !== null) { const l = value[scan.open.section] || []; l.push({ text: scan.open.text, cites: scan.open.cites || [] }); value[scan.open.section] = l; }\n  const closedObject = scan.closedAt >= 0;"]],
  (mod) => checkOffsets(mod, REPLIES.find((r) => r.name === "momentum-model"), "momentum-model"));

const ITEMS = [];
for (const entry of REPLIES.filter((r) => !r.name.startsWith("hostile"))) {
  const index = R.readIndex(R.forReading(entry.dossier));
  const reply = entry.reply;
  const list = [reply.identity, reply.now, ...(reply.drivers || []), ...(reply.tensions || []), ...(reply.watch || [])].filter(Boolean);
  for (const item of list) ITEMS.push({ name: entry.name, item, index });
}

const norm = (s) => s.replace(/−/g, "-").toLowerCase();
function oracleUses(index, id, sentence) {
  const f = index.get(id);
  if (!f) return false;
  if (f.text !== null && f.text !== undefined) {
    const words = (String(f.text).toLowerCase().match(/[a-z]{5,}/g) || []);
    const have = new Set(sentence.toLowerCase().match(/[a-z]{5,}/g) || []);
    return words.length > 0 && words.filter((w) => have.has(w)).length / words.length >= 0.3;
  }
  const d = norm(String(f.display)).replace(/…$/, "").trim();
  if (d && norm(sentence).includes(d)) return true;
  const nums = (numeralsIn(d) || []).map((n) => n.replace(/^-/, ""));
  const have = new Set((numeralsIn(norm(sentence)) || []).map((n) => n.replace(/^-/, "")));
  return nums.length > 0 && nums.every((n) => have.has(n));
}

function checkTrims(mod, label) {
  let n = 0;
  for (const { name, item, index } of ITEMS) {
    const ends = mod.sentenceEnds(item.text);
    for (let k = 1; k <= ends.length; k++) {
      const t = mod.trimAt(item, k, index);
      const sentences = mod.sentencesOf(item.text.slice(0, ends[k - 1]));
      const usedOnes = item.cites.filter((id) => sentences.some((s) => oracleUses(index, id, s)));
      if (t === null) {
        if (usedOnes.length) throw new Error(`${label}: ${name}: k ${k}: a cite is used by a surviving sentence but the item was dropped`);
        continue;
      }
      if (!item.text.startsWith(t.text) || t.text !== item.text.slice(0, ends[k - 1]).trimEnd()) throw new Error(`${label}: ${name}: k ${k}: the trimmed text is not a prefix cut at a sentence boundary`);
      if (!t.cites.every((c) => item.cites.includes(c))) throw new Error(`${label}: ${name}: k ${k}: a cite was added`);
      for (const c of t.cites) if (!sentences.some((s) => oracleUses(index, c, s))) throw new Error(`${label}: ${name}: k ${k}: cite ${c} is kept but no surviving sentence uses it`);
      for (const c of usedOnes) if (!t.cites.includes(c)) throw new Error(`${label}: ${name}: k ${k}: cite ${c} is used by a surviving sentence but was dropped`);
      n++;
    }
  }
  return n;
}

const trims = checkTrims(S, "A2");
checks += trims;
ok(trims > 60, `A2: ${trims} sentence boundaries across ${ITEMS.length} items: the trimmed text is a prefix cut at a boundary and every remaining cite is used by a surviving sentence, with no used cite dropped`);

await mustFail("A WRONG BUILD FAILS A2: a trim that keeps every cite is caught", "shared/flows-ai-salvage.js",
  [["  const cites = citesUsed(sentencesOf(kept), Array.isArray(item.cites) ? item.cites : [], index);", "  const cites = Array.isArray(item.cites) ? item.cites.slice() : [];"]], (mod) => checkTrims(mod, "A2"));
await mustFail("A WRONG BUILD FAILS A2: a trim that drops the cite of the last surviving sentence is caught", "shared/flows-ai-salvage.js",
  [["  const cites = citesUsed(sentencesOf(kept), Array.isArray(item.cites) ? item.cites : [], index);", "  const cites = citesUsed(sentencesOf(kept).slice(0, -1), Array.isArray(item.cites) ? item.cites : [], index);"]], (mod) => checkTrims(mod, "A2"));

{
  const s = S.sentencesOf("Sales rose 3.1% to $1.20B at Example Inc. in 2026. The U.S. arm fell −2.5%! Is that e.g. a loss? Yes.");
  same(s, ["Sales rose 3.1% to $1.20B at Example Inc. in 2026.", "The U.S. arm fell −2.5%!", "Is that e.g. a loss?", "Yes."], "sentences are not split inside figures or abbreviations");
  same(S.sentencesOf("One sentence with no full stop"), ["One sentence with no full stop"], "a text with no full stop is one sentence");
  same(S.sentencesOf(""), [], "and nothing is none");
  const t = "First. Second one. Third";
  eq(S.sentenceEnds(t).length, 3, "a last sentence with no full stop still has an end");
}

const reading = (dossier, tags) => {
  const prompt = R.promptForReading(dossier, tags);
  return { dossier, tags, opts: { shown: prompt.shown, rendered: prompt.user } };
};

const POOL = REPLIES.filter((r) => !r.name.startsWith("hostile")).map((entry) => {
  const tags = R.heldTags(entry.dossier);
  return { ...entry, ...reading(entry.dossier, tags) };
});

function wholeItems(sections) {
  const out = [];
  for (const k of ["identity", "now"]) if (sections[k]) out.push([k, JSON.stringify(sections[k])]);
  for (const k of ["drivers", "tensions", "watch"]) for (const it of sections[k]) out.push([k, JSON.stringify(it)]);
  return out;
}

let salvagedRuns = 0, accepted = 0, refusedCut = 0;
for (const e of POOL) {
  const text = rawOf(e);
  const whole = R.vetReading(text, e.dossier, e.tags, e.opts);
  const wholeSet = new Set(wholeItems(whole.sections).map(([k, j]) => k + "|" + j));
  const fallbackUnknown = R.unknownEntries(e.dossier);
  const step = Math.max(1, Math.floor(text.length / 160));
  const cuts = new Set();
  for (let b = 0; b < text.length; b += step) cuts.add(b);
  for (const m of S.parseReadingPartial(text).members) { cuts.add(m.end); cuts.add(m.end + 1); cuts.add(m.start + 1); }
  for (const b of [...cuts].sort((a, c) => a - c)) {
    if (b >= text.length) continue;
    const cut = text.slice(0, b);
    const r = S.salvageReading(cut, e.dossier, e.tags, e.opts);
    salvagedRuns++;
    if (S.parseReadingPartial(cut).value === null) { eq(r.ok, false, e.name + ": nothing parsed, nothing accepted"); continue; }
    ok(r.truncated === true && r.salvaged === true, e.name + "@" + b + ": a cut reply is marked salvaged");
    eq(r.note, S.SALVAGE_NOTE, e.name + "@" + b + ": the note says the list of what is not known is the site's own");
    for (const [k, j] of wholeItems(r.sections)) ok(wholeSet.has(k + "|" + j), e.name + "@" + b + ": SALVAGE CAN ONLY DROP CONTENT, " + k + " is an item of the whole reading, byte for byte");
    for (const t of r.tags) ok(whole.tags.includes(t), e.name + "@" + b + ": a kept tag is one the whole reading chose");
    if (r.ok) {
      accepted++;
      eq(JSON.stringify(r.sections.unknown), JSON.stringify(fallbackUnknown), e.name + "@" + b + ": A3 the salvaged unknown equals unknownEntries(dossier) byte for byte");
      eq(r.guard, "read:salvaged:" + r.kept, e.name + "@" + b + ": the guard names how many items were kept");
      ok(r.sections.now !== null && r.surviving >= 2, e.name + "@" + b + ": acceptance still needs now and a second section");
      ok(r.kept >= 2, e.name + "@" + b + ": at least two model items stand");
    } else {
      refusedCut++;
      eq(r.guard, null, e.name + "@" + b + ": a refused salvage carries no guard");
    }
  }
  const complete = S.salvageReading(text, e.dossier, e.tags, e.opts);
  eq(complete.salvaged, false, e.name + ": a whole reply is not salvaged");
  same(complete.sections, whole.sections, e.name + ": and is vetted exactly as vetReading vets it");
  same(complete.refused, whole.refused, e.name + ": with the same refusals");
  eq(complete.ok, whole.ok, e.name + ": and the same verdict");
}
ok(salvagedRuns > 800 && accepted > 100 && refusedCut > 50, `A3: ${salvagedRuns} salvaged cuts, ${accepted} accepted and ${refusedCut} refused; every accepted one carries the site's own list of what is not known`);

{
  const e = POOL.find((p) => p.name === "momentum-model");
  const text = JSON.stringify(GOOD);
  const unknownAt = text.indexOf("\"unknown\"");
  const afterUnknown = text.indexOf("\"tags\"");
  const cutIn = text.slice(0, afterUnknown - 2);
  const r = S.salvageReading(cutIn, e.dossier, e.tags, e.opts);
  ok(r.ok && r.truncated, "a reply cut after its unknown list closed is still marked truncated");
  ok(!JSON.stringify(r.sections.unknown).includes("Several options items are withheld, so only what is shown"), "THE MODEL'S UNKNOWN ITEMS ARE DISCARDED even when they closed before the cut");
  same(r.sections.unknown, R.unknownEntries(e.dossier), "and the site's list stands in their place");
  ok(unknownAt > 0, "the fixture reply has an unknown list before the cut");
  const noNow = S.salvageReading(text.slice(0, text.indexOf("\"now\"") + 30), e.dossier, e.tags, e.opts);
  eq(noNow.ok, false, "a reply cut inside now is refused");
  ok(noNow.refused.some((x) => x.why === "now-dropped" || x.why === "missing"), "with the reason named");
  const onlyNow = S.salvageReading(text.slice(0, text.indexOf("\"drivers\"") - 1).replace(/^\{"identity":\{[^}]*\},/, "{"), e.dossier, e.tags, e.opts);
  eq(onlyNow.ok, false, "now alone is not a reading: it needs a second section");
  ok(onlyNow.refused.some((x) => x.why === "too-few-sections"), "and the refusal says so");
  const oversize = S.salvageReading("{\"now\": \"" + "x".repeat(R.SECTION_CAPS.reply), e.dossier, e.tags, e.opts);
  ok(!oversize.ok && oversize.refused[0].why === "oversize", "a reply over the length cap is refused before it is scanned, as vetReading refuses it");
  const forged = { ...GOOD, unknown: [{ text: "Everything is known.", missing: ["price"] }] };
  const fr = S.salvageReading(JSON.stringify(forged).slice(0, -2), e.dossier, e.tags, e.opts);
  same(fr.sections.unknown, R.unknownEntries(e.dossier), "a model's own unknown is never trusted on a cut reply");
  const whole = S.salvageReading(JSON.stringify(forged), e.dossier, e.tags, e.opts);
  eq(whole.salvaged, false, "and a whole reply keeps vetReading's treatment of its unknown list");
  ok(whole.refused.some((x) => x.section.startsWith("unknown")), "which refuses the forged entry");
}

{
  const e = POOL.find((p) => p.name === "momentum-model");
  const idx = R.readIndex(R.forReading(e.dossier));
  const withNowCut = (n, tailing) => JSON.stringify({ identity: GOOD.identity, now: { text: GOOD.now.text, cites: GOOD.now.cites.slice(0, n) } }).slice(0, -3) + tailing;
  const probe = withNowCut(4, ",");
  const part = S.parseReadingPartial(probe);
  ok(part.open && part.open.section === "now" && part.open.index === null && part.open.text === GOOD.now.text, "the open member is found with its closed text");
  same(part.open.cites, GOOD.now.cites.slice(0, 4), "and the cites that closed before the cut");
  const plain = S.salvageReading(probe, e.dossier, e.tags, e.opts);
  eq(plain.ok, false, "by default a cut inside now is refused: there is no now");
  eq(plain.trimmed, false, "and nothing is trimmed");
  const trimmed = S.salvageReading(probe, e.dossier, e.tags, { ...e.opts, trim: true });
  ok(trimmed.ok, "with trimming on, now is cut back to the sentence its closed cites support and the reading stands: " + JSON.stringify(trimmed.refused));
  eq(trimmed.trimmed, true, "and says an element was trimmed");
  const kept = trimmed.sections.now;
  ok(GOOD.now.text.startsWith(kept.text) && kept.text.length < GOOD.now.text.length, "the trimmed now is a proper prefix of the model's text");
  same(S.sentencesOf(kept.text).length, 1, "ending at a sentence boundary");
  ok(kept.cites.every((c) => GOOD.now.cites.slice(0, 4).includes(c)) && kept.cites.length >= 3, "citing only what closed");
  for (const c of kept.cites) ok(S.sentencesOf(kept.text).some((s) => oracleUses(idx, c, s)), "every remaining cite is used by a surviving sentence");
  const none = S.salvageReading(withNowCut(1, ","), e.dossier, e.tags, { ...e.opts, trim: true });
  eq(none.trimmed, false, "with one cite closed the first sentence is not supported and nothing is kept");
  eq(none.ok, false, "so the reading is refused");
  const all = S.salvageReading(withNowCut(7, ""), e.dossier, e.tags, { ...e.opts, trim: true });
  eq(all.trimmed, true, "an element whose cites all closed and only its brace is missing is kept");
  eq(all.sections.now.text, GOOD.now.text, "whole");
  const driver = JSON.stringify({ identity: GOOD.identity, now: GOOD.now, drivers: [GOOD.drivers[0], { text: GOOD.drivers[1].text, cites: GOOD.drivers[1].cites.slice(0, 1) }] }).slice(0, -4) + ",";
  const dp = S.parseReadingPartial(driver);
  ok(dp.open && dp.open.section === "drivers" && dp.open.index === 1 && dp.open.cites.length === 1, "an open list element is found with its index");
  const dt = S.salvageReading(driver, e.dossier, e.tags, { ...e.opts, trim: true });
  ok(dt.ok && dt.sections.drivers.length === 1, "and a single-sentence element whose figures its closed cites do not cover is not kept");
}

{
  const e = POOL.find((p) => p.name === "momentum-model");
  const text = JSON.stringify(GOOD);
  const cut = text.slice(0, 2500);
  const total = perCall(() => S.salvageReading(cut, e.dossier, e.tags, e.opts));
  const vet = perCall(() => R.vetReading(text, e.dossier, e.tags, e.opts));
  const scan = perCall(() => S.parseReadingPartial(cut));
  const added = total - vet;
  ok(added < 1, `a salvage adds ${added.toFixed(3)} ms of CPU to vetting the same reply whole, under the 1 ms budget`);
  log(`a salvage of a cut reply costs ${total.toFixed(2)} ms in all: ${scan.toFixed(3)} ms of scanning, ${vet.toFixed(2)} ms of vetting the same reply whole (the existing cost) and ${added.toFixed(3)} ms added`);
}

{
  const src = JSON.stringify(Object.keys(S).sort());
  same(Object.keys(S).sort(), ["SALVAGE_NOTE", "citesUsed", "parseReadingPartial", "salvageReading", "scanReply", "sentenceEnds", "sentencesOf", "trimAt", "trimToCites", "usedBy"], "the leaf's surface: " + src);
}

console.log(`✓ flows-ai-salvage: ${checks} assertions — a reply cut at every byte offset of ${REPLIES.length} valid replies yields only items byte-identical to the whole reply, a set that only grows and the whole reply at full length; ` +
  "every sentence boundary of a trimmed item keeps only the cites a surviving sentence uses; a salvaged reading's unknown list is the site's own byte for byte, acceptance still needs now and a second section, " +
  "and four planted wrong scanners and two wrong trims are caught");
