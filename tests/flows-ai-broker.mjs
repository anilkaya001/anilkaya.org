import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiCall, readAiBlock, pruneAiOutcomes } from "../server/ai.js";
import { FLOWS_REGISTRY } from "../server/schema.js";
import {
  AI_SURFACES, AI_OUTCOMES, AI_REJECT_SLOTS, AI_TOKEN_MAX, AI_RETAIN_DAYS, chainFor, transportOutcome, guardOutcome, reasonOf, tokenOf,
  foldCounters, isWordingFailure,
} from "../shared/flows-ai-broker.js";
import { cappedAi, AI_BUDGET_MARK } from "../shared/flows-ai.js";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { moduleSource, closure, count, expect, absent } from "./lib/source-scan.mjs";
import { checkModelCalls } from "./lib/ai-guard.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const MODEL = "@cf/zai-org/glm-4.7-flash";
const FALLBACK = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const NOW = Date.parse("2026-10-07T15:00:00Z");

eq(AI_SURFACES, ["board", "neuron", "ask", "read"], "four surfaces ask a model");
eq(AI_OUTCOMES.length, 14, "fourteen outcomes");
ok(new Set(AI_OUTCOMES).size === 14 && AI_OUTCOMES.every((o) => /^[a-z]+$/.test(o)), "each unique and a bare word");
eq(chainFor({ FLOWS_ASK_MODEL: MODEL, FLOWS_ASK_FALLBACK_MODEL: FALLBACK }, "ask"), [MODEL, FALLBACK], "a surface asks the configured chain");
eq(chainFor({ FLOWS_ASK_MODEL: MODEL, FLOWS_ASK_FALLBACK_MODEL: FALLBACK }, "neuron", FALLBACK), [FALLBACK], "or the one model it names");
eq(chainFor({}, "read"), [], "and none when none is configured");
assert.throws(() => chainFor({}, "nobody"), /not a surface/);
checks++;

for (const [said, want] of [
  [{ text: "x" }, null],
  [{ text: null, guard: "unreachable:budget", failure: { why: "budget" } }, { outcome: "budget", reason: "" }],
  [{ text: null, guard: "unreachable:allowance", failure: { why: "allowance" } }, { outcome: "allowance", reason: "" }],
  [{ text: null, guard: "unreachable:capacity", failure: { why: "capacity" } }, { outcome: "capacity", reason: "" }],
  [{ text: null, guard: "unreachable:plan", failure: { why: "plan" } }, { outcome: "plan", reason: "" }],
  [{ text: null, guard: "unreachable:unreachable", failure: { why: "unreachable" } }, { outcome: "unreachable", reason: "" }],
  [{ text: null, guard: "unreachable:length" }, { outcome: "length", reason: "" }],
  [{ text: null, guard: "unreachable:empty" }, { outcome: "empty", reason: "" }],
  [{ text: null, guard: null }, { outcome: "unreachable", reason: "" }],
  [{ text: null, failure: { why: "somethingnew" } }, { outcome: "unreachable", reason: "" }],
  [null, null],
]) eq(transportOutcome(said), want, "transport outcome of " + JSON.stringify(said));

for (const [verdict, want] of [
  [{ llm: true, guard: null }, { outcome: "clean", reason: "" }],
  [{ llm: true, guard: "ideas:2 refused" }, { outcome: "trimmed", reason: "ideas:N refused" }],
  [{ llm: true, guard: "read:trimmed:3" }, { outcome: "trimmed", reason: "read:trimmed:N" }],
  [{ llm: false, guard: "invented" }, { outcome: "refused", reason: "invented" }],
  [{ llm: false, guard: "forecast" }, { outcome: "refused", reason: "forecast" }],
  [{ llm: false, guard: "mislabeled" }, { outcome: "refused", reason: "mislabeled" }],
  [{ llm: false, guard: "unsafe" }, { outcome: "refused", reason: "unsafe" }],
  [{ llm: false, guard: "engine:refused" }, { outcome: "refused", reason: "engine:refused" }],
  [{ llm: false, guard: "read:refused" }, { outcome: "refused", reason: "read:refused" }],
  [{ llm: false, guard: "ideas:unparsable" }, { outcome: "unparsable", reason: "" }],
  [{ llm: true, guard: "ideas:unparsable" }, { outcome: "unparsable", reason: "prose-kept" }],
  [{ llm: false, guard: "read:unparsable" }, { outcome: "unparsable", reason: "" }],
  [{ llm: false, guard: "read:overlong" }, { outcome: "overlong", reason: "" }],
  [{ llm: false, guard: "summary:empty" }, { outcome: "empty", reason: "summary" }],
  [{ llm: false, guard: "unreachable:reparse:allowance" }, { outcome: "allowance", reason: "reparse" }],
  [{ llm: false, guard: "unreachable:reparse:unreachable" }, { outcome: "unreachable", reason: "reparse" }],
  [{ llm: false, guard: "unreachable:budget" }, { outcome: "budget", reason: "" }],
  [{ llm: false, guard: "unreachable:length" }, { outcome: "length", reason: "" }],
  [{ llm: false, guard: "unreachable:empty" }, { outcome: "empty", reason: "" }],
  [{ llm: false, guard: null }, { outcome: "refused", reason: "" }],
  [{ llm: false, guard: "something:new" }, { outcome: "refused", reason: "something:new" }],
  [{ llm: true, guard: "something:else" }, { outcome: "trimmed", reason: "something:else" }],
  [null, { outcome: "refused", reason: "" }],
]) {
  const got = guardOutcome(verdict);
  eq(got, want, "outcome of " + JSON.stringify(verdict));
  ok(AI_OUTCOMES.includes(got.outcome) && got.reason.length <= 40, "a known outcome with a short reason");
}
ok(["refused", "unparsable", "overlong", "empty", "length"].every(isWordingFailure) && !["clean", "trimmed", "budget", "unreachable", "class", "user"].some(isWordingFailure), "five outcomes are the model's wording failing");

eq([reasonOf("ideas:12 refused"), reasonOf("a".repeat(80)).length, reasonOf(7), reasonOf("x<script>y"), reasonOf("  read:trimmed:3 ")], ["ideas:N refused", 40, "", "xscripty", "read:trimmed:N"], "a reason loses its digits, markup and length");
eq([tokenOf("$127.40"), tokenOf("  two\n\twords  "), tokenOf(null), tokenOf(undefined), tokenOf(14.5), tokenOf("a".repeat(90)).length, tokenOf("x‮y​z\u0000w")], ["$127.40", "two words", "", "", "14.5", AI_TOKEN_MAX, "x y z w"], "a token is one short plain string");

{
  const fold = foldCounters([
    { surface: "read", model: MODEL, outcome: "clean", n: 6, ms_sum: 6000, ms_max: 2500 },
    { surface: "read", model: MODEL, outcome: "refused", n: 2, ms_sum: 3000, ms_max: 2000 },
    { surface: "read", model: MODEL, outcome: "budget", n: 4, ms_sum: 0, ms_max: 0 },
    { surface: "ask", model: FALLBACK, outcome: "unparsable", n: 1, ms_sum: 900, ms_max: 900 },
    { surface: "ask", model: FALLBACK, outcome: "invented", n: 9, ms_sum: 1, ms_max: 1 },
  ], Array.from({ length: 60 }, (_, i) => ({ surface: "read", at: 1000 - i, model: MODEL, reason: "refused", culprit: "x".repeat(60) })), { days: 1, today: "2026-10-07" });
  eq(fold.surfaces.read, { calls: 12, outcomes: { clean: 6, refused: 2, budget: 4 }, reached: 8, refusalRate: 0.25, msAvg: 1125, msMax: 2500 },
    "a surface counts its calls, its outcomes, the wording failures over the calls that reached a model, and its latency");
  eq(fold.surfaces.ask.outcomes, { unparsable: 1 }, "an outcome the broker does not define is ignored");
  eq(Object.keys(fold.models), [FALLBACK, MODEL], "models are folded the same way");
  eq([fold.recent.length, fold.recent[0].culprit.length, fold.days, fold.today], [AI_REJECT_SLOTS, AI_TOKEN_MAX, 1, "2026-10-07"], "the recent refusals are capped at fifty, each token at forty characters");
  eq(foldCounters(null, null).surfaces, {}, "no rows fold to nothing");
}

const aiOf = (script) => {
  const calls = [];
  return { calls, run: async (model, input) => { calls.push(model); const out = script(calls.length, model, input); if (out && out.throw) throw new Error(out.throw); return out; } };
};
const harness = ({ script = () => ({ response: "ok", usage: { prompt_tokens: 10, completion_tokens: 5 } }), env: more = {}, now = NOW } = {}) => {
  const f = fakeD1({ latencyMs: 0 });
  const ai = aiOf(script);
  const clock = { t: now };
  const failures = [];
  const env = { DB: f.D1, AI: ai, FLOWS_ASK_MODEL: MODEL, FLOWS_ASK_FALLBACK_MODEL: FALLBACK, ...more };
  const deps = {
    ai: () => cappedAi(env, null),
    now: () => (clock.t += 7),
    ensureFlowsTables: async () => {},
    failed: (error, at) => failures.push([error.message, at]),
  };
  return { f, ai, env, deps, clock, failures };
};
const request = (over = {}) => ({ surface: "ask", chain: [MODEL], messages: [{ role: "user", content: "x" }], opts: { maxTokens: 100, temperature: 0 }, onUsage: null, ...over });
const counters = (f) => f.db.prepare("SELECT surface, model, outcome, reason, n, ms_sum, ms_max, day FROM flows_ai_outcome ORDER BY surface, model, outcome, reason").all().map((r) => ({ ...r }));
const ring = (f) => f.db.prepare("SELECT surface, slot, at, model, reason, culprit FROM flows_ai_reject ORDER BY surface, slot").all().map((r) => ({ ...r }));

{
  const h = harness();
  const said = await aiCall(h.env, h.deps, request());
  eq([said.text, said.model, said.failure, said.call.surface, said.call.settled], ["ok", MODEL, null, "ask", false], "a reply comes back as askModels returned it, with its call beside it, unsettled");
  eq(counters(h.f), [], "nothing is counted before the surface has judged the reply");
  const n0 = h.f.trips.length;
  eq(await said.call.settle({ llm: true, guard: null }), true, "settling a clean reply");
  eq(counters(h.f), [{ surface: "ask", model: MODEL, outcome: "clean", reason: "", n: 1, ms_sum: 7, ms_max: 7, day: "2026-10-07" }], "writes one counter row with the latency the call took");
  eq([h.f.trips.length - n0, h.f.written(n0)], [1, 1], "in one trip and one row written");
  eq(await said.call.settle({ llm: false, guard: "invented" }, "999"), false, "a second settle is refused");
  eq([counters(h.f).length, ring(h.f).length], [1, 0], "and writes nothing, so a call is counted once");
}

{
  const h = harness();
  const a = await aiCall(h.env, h.deps, request({ surface: "read" }));
  const n0 = h.f.trips.length;
  await a.call.settle({ llm: false, guard: "read:refused" }, "14.5%");
  eq([h.f.trips.length - n0, h.f.written(n0)], [1, 2], "a refusal with an offending token is one batch and two rows written");
  eq(counters(h.f).map((r) => [r.surface, r.outcome, r.reason, r.n]), [["read", "refused", "read:refused", 1]], "the counter names the reason");
  eq(ring(h.f).map((r) => [r.surface, r.slot, r.model, r.reason, r.culprit]), [["read", 0, MODEL, "refused:read:refused", "14.5%"]], "and the ring holds the surface, the model, the reason and the token alone");
  const b = await aiCall(h.env, h.deps, request({ surface: "read" }));
  const n1 = h.f.trips.length;
  await b.call.settle({ llm: false, guard: "read:refused" }, "");
  eq([h.f.trips.length - n1, h.f.written(n1)], [1, 1], "a refusal with no token is counted and not put in the ring");
  eq(ring(h.f).length, 1, "the ring is unchanged");
  eq(counters(h.f)[0].n, 2, "the counter row was upserted");
  const c = await aiCall(h.env, h.deps, request({ surface: "read" }));
  await c.call.settle({ llm: true, guard: null }, "ignored");
  eq(ring(h.f).length, 1, "a clean reply never reaches the ring, token or not");
}

{
  const h = harness();
  for (let i = 0; i < AI_REJECT_SLOTS + 7; i++) {
    const s = await aiCall(h.env, h.deps, request({ surface: i % 2 ? "ask" : "neuron" }));
    await s.call.settle({ llm: false, guard: "forecast" }, "word" + i);
  }
  const rows = ring(h.f);
  const per = (surface) => rows.filter((r) => r.surface === surface);
  eq([per("ask").length, per("neuron").length], [AI_REJECT_SLOTS / 2 + 3, AI_REJECT_SLOTS / 2 + 4].map((n) => Math.min(n, AI_REJECT_SLOTS)), "each surface keeps its own ring");
  const wrapped = harness();
  for (let i = 0; i < AI_REJECT_SLOTS + 3; i++) {
    const s = await aiCall(wrapped.env, wrapped.deps, request({ surface: "ask" }));
    await s.call.settle({ llm: false, guard: "forecast" }, "w" + i);
  }
  const ask = ring(wrapped.f);
  eq([ask.length, Math.min(...ask.map((r) => r.slot)), Math.max(...ask.map((r) => r.slot))], [AI_REJECT_SLOTS, 0, AI_REJECT_SLOTS - 1], "a ring of fifty slots");
  eq(ask.filter((r) => ["w50", "w51", "w52"].includes(r.culprit)).map((r) => r.slot).sort((x, y) => x - y), [0, 1, 2], "whose oldest entries are overwritten once it is full");
  eq(ask.filter((r) => r.culprit === "w0" || r.culprit === "w1" || r.culprit === "w2").length, 0, "and no slot holds two entries");
}

{
  for (const [script, outcome] of [
    [() => ({ throw: "AiError: 3036: you have used up your daily free allocation" }), "allowance"],
    [() => ({ throw: "AiError: 3040: capacity temporarily exceeded" }), "capacity"],
    [() => ({ throw: "AiError: 5035: the model is gone" }), "plan"],
    [() => ({ throw: "boom" }), "unreachable"],
    [() => ({ response: "" }), "empty"],
    [() => ({ choices: [{ finish_reason: "length", message: { content: "" } }] }), "length"],
  ]) {
    const h = harness({ script });
    const said = await aiCall(h.env, h.deps, request({ chain: [MODEL] }));
    eq([said.text, said.call.settled, said.call.outcome], [null, true, outcome], outcome + ": a reply with no text is settled by the broker, the surface has nothing to judge");
    eq(counters(h.f).map((r) => [r.outcome, r.reason, r.n]), [[outcome, "", 1]], "and counted once");
    eq(await said.call.settle({ llm: true, guard: null }), false, "a surface that settles it again changes nothing");
    eq(ring(h.f), [], "with no token in the ring");
  }
  const spent = harness({ env: { DB: undefined } });
  const f = fakeD1({ latencyMs: 0 });
  const env = { DB: f.D1, AI: aiOf(() => ({ response: "never" })), FLOWS_ASK_MODEL: MODEL };
  const deps = { ai: () => cappedAi(env, async () => ({ neurons: 99999, calls: 1, tokensIn: 0, tokensOut: 0 })), now: () => NOW, ensureFlowsTables: async () => {} };
  const said = await aiCall(env, deps, request());
  eq([said.text, said.call.outcome, env.AI.calls.length], [null, "budget", 0], "BUDGET: a call the cap refuses is counted as budget and the model was never asked");
  ok(said.attempts[0].failed === "budget" && String(said.guard).startsWith("unreachable:"), "saying so in the guard it stores");
  eq(counters(f).map((r) => [r.surface, r.model, r.outcome]), [["ask", MODEL, "budget"]], "under the model the chain named");
  void spent;
}

{
  const f = fakeD1({ latencyMs: 0 });
  const env = { DB: f.D1, AI: aiOf(() => ({ response: "ok" })), FLOWS_ASK_MODEL: MODEL };
  const failures = [];
  const deps = { ai: () => cappedAi(env, null), now: () => NOW, ensureFlowsTables: async () => {}, failed: (e, at) => failures.push([e.message, at.outcome]) };
  const said = await aiCall(env, deps, request());
  f.fail(/flows_ai_outcome/);
  eq(await said.call.settle({ llm: true, guard: null }), false, "A STORE THAT REFUSES THE COUNT does not fail the surface: settle answers false");
  eq(failures.length, 1, "and names the failure once to the Worker's logger");
  eq(failures[0][1], "clean", "with the outcome it could not record");
  const noStore = { AI: env.AI, FLOWS_ASK_MODEL: MODEL };
  const bare = await aiCall(noStore, { ...deps, ai: () => cappedAi(noStore, null) }, request());
  eq(await bare.call.settle({ llm: true, guard: null }), false, "a Worker with no D1 counts nothing and does not throw");
  const gone = harness();
  gone.deps.ensureFlowsTables = async () => { throw new Error("schema gone"); };
  const g = await aiCall(gone.env, gone.deps, request());
  eq([await g.call.settle({ llm: true, guard: null }), gone.failures.length], [false, 1], "a bootstrap that fails is the same");
}

{
  const h = harness();
  const base = Date.parse("2026-10-07T12:00:00Z");
  const put = (day, surface, model, outcome, reason, n) => h.f.db.prepare("INSERT INTO flows_ai_outcome (day, surface, model, outcome, reason, n, ms_sum, ms_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(day, surface, model, outcome, reason, n, n * 100, 400);
  let today = 0;
  for (const surface of AI_SURFACES) for (const model of [MODEL, FALLBACK, "none"]) for (const outcome of AI_OUTCOMES) { put("2026-10-07", surface, model, outcome, "", 3); today++; }
  for (let d = 1; d <= 9; d++) {
    const day = new Date(base - d * 86400000).toISOString().slice(0, 10);
    for (const surface of AI_SURFACES) for (const model of [MODEL, FALLBACK]) for (const outcome of AI_OUTCOMES.slice(0, 6)) put(day, surface, model, outcome, "", 2);
  }
  for (let i = 0; i < 50; i++) for (const surface of AI_SURFACES) h.f.db.prepare("INSERT INTO flows_ai_reject (surface, slot, at, model, reason, culprit) VALUES (?, ?, ?, ?, ?, ?)").run(surface, i, 1000 + i, MODEL, "refused", "t" + i);
  const hOf = { ...h.deps, now: () => base };
  const n0 = h.f.trips.length;
  const one = await readAiBlock(h.env, hOf, { days: 1 });
  const rowsNow = h.f.rowsRead(n0);
  eq([h.f.trips.length - n0, one.days, one.today, Object.keys(one.surfaces)], [1, 1, "2026-10-07", ["ask", "board", "neuron", "read"]], "THE OWNER'S AI BLOCK for today is one trip");
  eq(one.surfaces.ask.calls, 3 * AI_OUTCOMES.length * 3, "counting every row of today");
  const ringRows = h.f.db.prepare("SELECT count(*) AS n FROM flows_ai_reject").get().n;
  eq([rowsNow - ringRows, ringRows], [today, AI_SURFACES.length * AI_REJECT_SLOTS], "reading " + rowsNow + " rows: the day's " + today + " counters by key range and the ring, which is scanned whole to be ordered");
  ok(today <= 190, "and a day with every surface, three models and every outcome counted is " + today + " counter rows, inside the ceiling of 190");
  ok(one.recent.length === AI_REJECT_SLOTS && one.recent[0].at >= one.recent[1].at, "with the fifty latest refusals, newest first");
  const n1 = h.f.trips.length;
  const week = await readAiBlock(h.env, hOf, { days: 7 });
  const rowsWeek = h.f.rowsRead(n1);
  eq([week.days, h.f.trips.length - n1], [7, 1], "SEVEN DAYS is one trip as well");
  ok(rowsWeek > rowsNow && rowsWeek - ringRows <= 1068, "and reads " + rowsWeek + " rows, " + (rowsWeek - ringRows) + " of them counters, inside the ceiling of 1,068 for seven days");
  eq((await readAiBlock(h.env, hOf, { days: 99 })).days, AI_RETAIN_DAYS - 1, "a longer span is cut to the days the table keeps");
  eq((await readAiBlock(h.env, hOf, { days: 0 })).days, 1, "and a shorter one to today");
  eq(await readAiBlock({ AI: h.env.AI }, hOf), null, "with no store there is no block");
  h.f.fail(/flows_ai_outcome/);
  eq(await readAiBlock(h.env, hOf), null, "and a store that refuses the read gives no block rather than a wrong one");
  h.f.fail(null);
  const pruned = await pruneAiOutcomes(h.env, base);
  const left = h.f.db.prepare("SELECT min(day) AS d FROM flows_ai_outcome").get().d;
  eq(pruned, AI_SURFACES.length * 2 * 6, "RETENTION: the prune removes the one day past the window, the " + pruned + " counter rows of the ninth day back");
  eq(left, new Date(base - AI_RETAIN_DAYS * 86400000).toISOString().slice(0, 10), "keeping " + AI_RETAIN_DAYS + " days and no more");
  eq(await pruneAiOutcomes({}, base), 0, "and with no store it prunes nothing");
  const w = moduleSource("worker.js");
  expect(w, /await FLOWS_LIVE\.pruneLedger\(env, at\);\s*await pruneAiOutcomes\(env, at\);/, { min: 1, max: 1, why: "the housekeeping firing prunes the counters in the same window as the ledger" });
  expect(w, /aiRecorderFailed: false/, { min: 1, max: 1, why: "the recorder's one-time log is isolate state in createState" });
}

{
  const broker = moduleSource("shared/flows-ai-broker.js");
  const server = moduleSource("server/ai.js");
  absent(broker, /\bDB\b|fetch\(|import .*server/, { anchor: /export const AI_SURFACES/, why: "the pure half touches no store, no network and nothing in server/" });
  eq(count(server, /\baskModels\(/), 1, "server/ai.js holds the one askModels call");
  absent(server, /\bAI\b|\bai\.run\(/, { anchor: /askModels\(deps\.ai\(\)/, why: "and never reads the binding: the capped one is handed in" });
  const w = moduleSource("worker.js");
  absent(w, /\baskModels\(/, { anchor: /\baiCall\(env/, why: "worker.js no longer asks a model itself" });
  absent(moduleSource("shared/flows-reading-worker.js"), /\baskModels\b/, { anchor: /deps\.call\(/, why: "nor does the reading" });
  eq(checkModelCalls(), [], "and the model-call guard reads the tree clean");
  eq(count(w, /await aiCall\(env, aiDeps\(env\)/), 4, "four Worker sites go through the broker: the board summary, the engine Neuron, the legacy Neuron and Ask");
  eq(count(moduleSource("shared/flows-reading-worker.js"), /await deps\.call\(/), 1, "and the reading through the dependency the Worker hands it");
  for (const surface of AI_SURFACES) ok(new RegExp('surface: "' + surface + '"').test(w + moduleSource("shared/flows-reading-worker.js")), "surface " + surface + " is asked for by name");
}

{
  const entries = FLOWS_REGISTRY.filter((e) => /^flows_ai_(outcome|reject)$/.test(e.name));
  eq(entries.map((e) => [e.name, e.migration, e.owner]), [["flows_ai_outcome", "0017_flows_ai_outcome.sql", "ai"], ["flows_ai_reject", "0017_flows_ai_outcome.sql", "ai"]], "both tables are in the registry, owned by the broker, created by one migration");
  const migration = readFileSync(new URL("../migrations/0017_flows_ai_outcome.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  const norm = (sql) => sql.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim().toLowerCase();
  for (const e of entries) {
    ok(norm(migration).includes(norm(e.ddl)), e.name + ": the migration declares what the Worker's first-use DDL declares");
    ok(norm(schema).includes(norm(e.ddl)), e.name + ": and so does schema.sql");
  }
  ok(!/\b(password|secret|token_value|api_key)\b/i.test(migration), "no credential material");
  ok(/culprit TEXT NOT NULL CHECK \(length\(culprit\) <= 40\)/.test(entries[1].ddl), "the ring's culprit is capped at forty characters by the table");
  ok(/WITHOUT ROWID/.test(entries[0].ddl) && /PRIMARY KEY \(day, surface, model, outcome, reason\)/.test(entries[0].ddl), "the counters are keyed by day, surface, model, outcome and reason");
}

console.log(`✓ flows-ai-broker: ${checks} assertions — the pure outcome table over every stored guard, tokens and reasons, the counter fold, aiCall against a scripted binding and a counting D1 (one trip a call, two rows for a refusal with a token, a ring of fifty per surface, a refused or missing store never failing a surface, the budget refusal counted without the model asked), the owner block's trips and rows for one and seven days, retention, the registry and migration parity, and the scans that leave askModels in server/ai.js alone`);
