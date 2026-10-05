import assert from "node:assert/strict";
import * as R from "../shared/flows-reading.js";
import * as RW from "../shared/flows-reading-worker.js";
import { AI_INTRADAY_REFRESH_MS } from "../shared/flows-ai.js";
import { fakeD1, shiftClock, cacheFake, vendorStub, client } from "./dossier-harness.mjs";
import * as F from "./dossier-fixtures.mjs";
import { moduleSource, workerSource, expect } from "./lib/source-scan.mjs";
import { checkModelCalls, assertAiGuarded, aiGuardStats } from "./lib/ai-guard.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const { T } = F;
const MINUTE = 60000;
const MODEL = "@cf/zai-org/glm-4.7-flash";
const RATES = "5500,36400";
const USAGE = { prompt_tokens: 5400, completion_tokens: 700 };
const NEURONS = Math.ceil((5400 * 5500 + 700 * 36400) / 1e6);
const clause = " on the vendor's convention (dealers long calls, short puts)";
const OPEN = "UNTRUSTED" + String.fromCharCode(0xab);

let restoreClock = shiftClock();
const setNow = (iso) => { restoreClock(); restoreClock = shiftClock(iso); };
const cache = cacheFake();
const stub = vendorStub();

const GOOD = {
  identity: { text: "Example Technologies Inc sells subscription software and cloud infrastructure to mid-sized enterprises, with revenue mostly from recurring contracts.", cites: ["identity.name", "identity.description"] },
  now: { text: "The last price is $127.40, +1.27% from the previous close. The return over 21 sessions is +6.30% and net option premium today is +$4.40M. The next earnings report is dated 2026-10-22, 15 sessions after the last close.", cites: ["price.last", "price.change", "price.r21", "flow.strip.net", "events.next", "events.sessions"] },
  drivers: [
    { text: "News flow is steady: 4 headlines in the last 24 hours, and Reuters reports a cloud contract win.", cites: ["news.count24h", "news.h1"] },
    { text: "The implied dealer state is pinned" + clause + ", with the gamma flip at $124.00.", cites: ["options.state", "options.engine.level.flip"] },
    { text: "Option flow leans to calls: bullish against bearish premium is +0.47.", cites: ["flow.strip.lean"] },
  ],
  tensions: [],
  unknown: [],
  tags: ["dealer-pinned", "news-driven", "flow-led-calls"],
  watch: [],
};

const READER = /^You are Neuron's stock reader/;

function rig(script) {
  const log = { reads: [], other: [], gate: null };
  return {
    log,
    run: async (model, input) => {
      const sys = input.messages[0].content;
      if (!READER.test(sys)) {
        log.other.push({ model, input });
        return { response: "{}", usage: { prompt_tokens: 100, completion_tokens: 10 } };
      }
      log.reads.push({ model, input });
      if (log.gate) await log.gate;
      const out = typeof script === "function" ? await script(log.reads.length, input) : script;
      if (out && out.throw) throw new Error(out.throw);
      return { response: typeof out === "string" ? out : JSON.stringify(out === undefined ? GOOD : out), usage: USAGE };
    },
  };
}

function world(o = {}) {
  const f = fakeD1();
  F.seed(f, o.seed || {});
  cache.clear();
  stub.reset();
  for (const m of [stub.state.refuse, stub.state.delay, stub.state.bodies, stub.state.status, stub.state.hold]) m.clear();
  stub.state.tooLarge.clear();
  if (o.noQuote) stub.state.status.set("quote", 500);
  if (o.noNews) stub.state.bodies.set("news", { data: [] });
  return f;
}

const AI_ENV = { FLOWS_ASK_MODEL: MODEL, FLOWS_ASK_FALLBACK_MODEL: "", FLOWS_ASK_NEURONS: RATES, FLOWS_READ_MODE: "on" };
const later = async (f, ai, iso, extra = {}) => {
  setNow(iso);
  dropHot();
  return client(f.D1, { ...AI_ENV, AI: ai, ...extra });
};
const dropHot = () => { for (const k of [...cache.store.keys()]) if (k.includes("/assembled/")) cache.store.delete(k); };
const readRow = (f, t = T) => f.db.prepare("SELECT scope, fingerprint, guard, llm, model, generated_at, ideas, summary FROM flows_neuron WHERE scope = ?").get("read:" + t);
const summary = async (get, t = T) => {
  const r = await get("/api/flows/summary?t=" + t);
  await r.settle();
  return r;
};
const isReadTrip = (t) => t.sqls.some((s) => /FROM flows_neuron WHERE scope = \?/.test(s)) && t.args.some((a) => (Array.isArray(a) ? a : [a]).some((x) => typeof x === "string" && x.startsWith("read:")));

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  const probe = await get("/api/flows/dossier?t=" + T);
  const dossier = probe.body.dossier;
  const tags = R.heldTags(dossier);
  const prompt = R.promptForReading(dossier, tags);
  const v = R.vetReading(JSON.stringify(GOOD), dossier, tags, { shown: prompt.shown, rendered: prompt.user });
  same(v.refused, [], "(setup) the scripted reply is a clean reply for the worker's own dossier of EXMP");
  ok(v.ok, "(setup) and it stands");
  dropHot();

  const n0 = f.trips.length;
  const first = await get("/api/flows/summary?t=" + T);
  const read = first.body.read;
  eq(first.res.status, 200, "THE SUMMARY ROUTE still answers 200");
  ok(["status", "scope", "tier", "code", "why", "summary", "ideas", "engine", "verdict", "verdictWord", "claims", "refused", "context", "llm", "model", "guard", "generatedAt", "provenance", "note"].every((k) => k in first.body),
    "every field old clients read is still there");
  eq(read.status, "generating", "COLD: the first call returns the deterministic reading at once, status generating");
  eq(read.generated, false, "generated false");
  eq(read.label, "Deterministic reading", "and labelled so");
  ok(read.sections.now && read.sections.now.cites.length > 0 && read.sections.drivers.length > 0, "with sections and cited chips already in it");
  eq(read.model, null, "no model named");
  ok(/model writes its wording/.test(read.provenance), "and a provenance sentence says the model's wording replaces it only if it passes the checks");
  eq(read.fingerprint, dossier.fingerprint, "carrying the dossier fingerprint");
  same(Object.keys(read).sort(), ["asOf", "coverage", "fingerprint", "generated", "generatedAt", "label", "model", "modelName", "neurons", "note", "provenance", "refused", "sections", "session", "status", "tags", "ticker", "tokens", "version", "why"],
    "THE EXACT SHAPE OF read");
  same(Object.keys(read.sections).sort(), ["drivers", "identity", "now", "tensions", "unknown", "watch"], "and of its sections");
  eq(ai.log.reads.length, 0, "the model is not asked before the response");
  await first.settle();
  eq(ai.log.reads.length, 1, "AND THEN ONCE, in the background (the Neuron's own call is separate: " + ai.log.other.length + ")");
  const sent = ai.log.reads[0].input;
  ok(sent.messages[0].role === "system" && sent.messages[1].role === "user" && sent.messages.length === 2, "one system message and one user message");
  ok(sent.messages[1].content.startsWith("DOSSIER " + T), "the user message is the rendered dossier");
  ok(sent.messages[1].content.includes("HELD TAGS") && sent.messages[1].content.includes("- dealer-pinned ("), "with the held tags");
  ok(sent.max_completion_tokens === R.READING_MAX_TOKENS && sent.temperature === R.READING_TEMPERATURE, "within the output cap and at low temperature (" + sent.max_completion_tokens + ", " + sent.temperature + ")");
  const row = readRow(f);
  ok(row && row.llm === 1 && row.guard === null && row.model === MODEL, "stored in flows_neuron under scope read:EXMP, llm 1, no guard");
  eq(f.db.prepare("SELECT count(*) AS n FROM flows_neuron WHERE scope LIKE 'read:%'").get().n, 1, "one row for the name: no new table");
  eq(row.fingerprint, dossier.fingerprint + "|" + RW.readSignature({ ...AI_ENV }), "its fingerprint is the dossier's with the model signature");
  const body = JSON.parse(row.ideas);
  eq(body.kind, "reading", "the row holds the shaped reading");
  eq(body.shape.neurons, NEURONS, "with the neuron cost worked from the usage and the configured rates (" + NEURONS + ")");
  same(body.shape.tokens, { in: 5400, out: 700 }, "and its tokens");
  const usage = f.db.prepare("SELECT calls, tokens_in, tokens_out FROM flows_ai_usage").get();
  ok(usage.calls >= 1 && usage.tokens_in >= 5400, "and the spend is recorded where the daily cap reads it (" + JSON.stringify(usage) + ")");

  const n1 = f.trips.length;
  const second = await get("/api/flows/summary?t=" + T);
  await second.settle();
  const r2 = second.body.read;
  eq(r2.status, "ready", "THE NEXT CALL serves the stored reading: status ready");
  eq(r2.generated, true, "generated true");
  eq(r2.label, "Model wording", "labelled model wording");
  eq(r2.neurons, NEURONS, "with its neuron cost");
  eq(r2.modelName, "Glm 4.7 Flash", "and the model's name");
  ok(/^Model wording by Glm 4\.7 Flash, checked sentence by sentence/.test(r2.provenance) && r2.provenance.includes("cost " + NEURONS + " neurons"), "the provenance says whose words they are and what they cost: " + r2.provenance);
  eq(r2.held, "floor", "held by the intraday floor, with no dossier assembly");
  eq(ai.log.reads.length, 1, "and no second model call");
  same(r2.tags.map((t) => t.code), GOOD.tags, "the model's tag order is kept");
  eq(r2.sections.now.cites[0].id, "price.last", "cites are resolved to chips");
  same(Object.keys(r2.sections.now.cites[0]).filter((k) => ["id", "label", "display", "asOf", "kind"].includes(k)).sort(), ["asOf", "display", "id", "kind", "label"], "with id, label, display, asOf and kind");
  eq(r2.sections.now.cites[0].display, "$127.40", "the value as printed");
  ok(r2.sections.drivers.every((d) => d.cites.length > 0), "every driver carries its cites");
  const trips = f.trips.slice(n1);
  const readTrips = trips.filter(isReadTrip);
  eq(readTrips.length, 1, "THE HIT PATH makes one read of the reading row");
  ok(!trips.some((t) => t.sqls.some((s) => /FROM flows_dossier_cache/.test(s))), "and assembles no dossier");
  const rows = f.rowsRead(n1);
  ok(rows <= 8, "rows read on a hit: " + rows + " (the Neuron's card and row, and one for the reading)");
  ok(f.trips.slice(n0).length > trips.length, "(the cold call cost more trips than the hit)");
}

{
  const f = world();
  const second = { ...GOOD, drivers: [{ text: "Reuters reports a major index addition, and the news flow is heavy.", cites: ["news.h1", "news.count24h"] }, ...GOOD.drivers.slice(1)], tags: ["dealer-pinned", "news-driven"] };
  const ai = rig((n) => (n === 1 ? GOOD : second));
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await summary(get);
  eq(ai.log.reads.length, 1, "setup: one reading written");
  const first = readRow(f);
  const stale = await (async () => {
    f.live("live:news", {
      v: 2, status: "ok", sessionDate: F.TODAY, rows: [
        { headline: T + " is added to a major index", source: "Reuters", createdAt: "2026-10-02T14:20:00.000Z", createdAtMs: Date.parse("2026-10-02T14:20:00.000Z"), major: true, sentiment: "positive", tickers: [T], tags: [] },
        ...F.liveNewsPayload().rows,
      ],
    }, Date.parse("2026-10-02T14:25:00.000Z"), F.TODAY);
    dropHot();
    return get("/api/flows/summary?t=" + T);
  })();
  await stale.settle();
  eq(stale.body.read.status, "ready", "THE INTRADAY FLOOR: a new headline inside the floor changes the dossier but the reading stands");
  eq(stale.body.read.held, "floor", "held by the floor");
  eq(ai.log.reads.length, 1, "no new model call inside " + AI_INTRADAY_REFRESH_MS / MINUTE + " minutes");

  const get2 = await later(f, ai, "2026-10-02T15:20:00.000Z");
  const behind = await get2("/api/flows/summary?t=" + T);
  eq(behind.body.read.status, "generating", "past the floor, with the dossier moved: the deterministic reading at once, status generating");
  eq(behind.body.read.generated, false, "not generated");
  await behind.settle();
  eq(ai.log.reads.length, 2, "and one more model call");
  const row = readRow(f);
  ok(row.fingerprint !== first.fingerprint && row.guard === null && row.llm === 1, "the row now holds the new fingerprint");
  const after = await summary(get2);
  eq(after.body.read.status, "ready", "and is served");
  setNow(F.NOW_ISO);
}

{
  const f = world({ seed: { live: false }, noQuote: true, noNews: true });
  const probe = await (await client(f.D1, { ...AI_ENV })) ("/api/flows/dossier?t=" + T);
  const shown = (id) => probe.body.dossier.packets[id.split(".")[0]].facts.find((x) => x.k === id.slice(id.indexOf(".") + 1)).display;
  const minimal = { now: { text: "The last close is " + shown("price.last") + ".", cites: ["price.last"] }, drivers: [{ text: "The next earnings report is dated " + shown("events.next") + ".", cites: ["events.next"] }], tags: [] };
  dropHot();
  const ai = rig(() => minimal);
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await summary(get);
  eq(ai.log.reads.length, 1, "a nightly-only world: one reading");
  const get2 = await later(f, ai, "2026-10-02T16:00:00.000Z");
  const same1 = await summary(get2);
  eq(same1.body.read.status, "ready", "THE FINGERPRINT MATCHES PAST THE FLOOR: ninety minutes later, the dossier is the same under price and age noise");
  eq(same1.body.read.held, "fingerprint", "held by the fingerprint, after assembling the dossier");
  eq(ai.log.reads.length, 1, "no new model call");
  setNow(F.NOW_ISO);
}

{
  const f = world();
  const bad = { ...GOOD, now: { text: "The last price is $127.40, up 14.5% in a week.", cites: ["price.last"] } };
  const ai = rig(() => bad);
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  const first = await summary(get);
  eq(first.body.read.status, "generating", "REFUSAL: the first call is generating");
  const row = readRow(f);
  ok(row.guard === "read:refused" && row.llm === 0, "the refused reply is recorded as a refusal: " + row.guard);
  ok(JSON.parse(row.ideas).refused.some((x) => x.why === "invented"), "with the reason");
  const next = await summary(get);
  eq(next.body.read.status, "fallback", "THE NEXT CALL serves the deterministic reading as a fallback");
  eq(next.body.read.why, "cooldown", "because the name is cooling down");
  ok(next.body.read.retryAfterS > 0 && next.body.read.retryAfterS <= 1200, "with the seconds to wait (" + next.body.read.retryAfterS + ")");
  ok(/refused by the checks/.test(next.body.read.provenance), "and says why: " + next.body.read.provenance);
  eq(next.body.read.generated, false, "still not generated");
  ok(next.body.read.sections.now !== null, "and the deterministic reading is complete");
  for (let i = 0; i < 4; i++) await summary(get);
  eq(ai.log.reads.length, 1, "FIVE CALLS, ONE MODEL CALL: a bad day cannot burn the budget");
  const get2 = await later(f, ai, "2026-10-02T14:52:00.000Z");
  const retry = await summary(get2);
  eq(retry.body.read.status, "generating", "after the 20-minute cooldown the model is asked again");
  eq(ai.log.reads.length, 2, "a second call");
  setNow(F.NOW_ISO);
}

{
  const f = world();
  const copied = { ...GOOD, identity: { text: "Example Technologies sells subscription software and cloud infrastructure services to mid-sized enterprises.", cites: ["identity.description"] } };
  const ai = rig(() => copied);
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await summary(get);
  const r = (await summary(get)).body.read;
  ok(r.status === "ready" && r.generated, "A COPIED IDENTITY: the reading stands without the model's line");
  ok(r.refused.some((x) => x.section === "identity" && x.why === "quote"), "the refusal is recorded: " + JSON.stringify(r.refused));
  ok(r.sections.identity && r.sections.identity.template === true && r.sections.identity.cites.some((c) => c.id === "identity.description"), "and the identity line is the profile's own first sentence, quoted, marked as a template and not model wording");
  ok(r.sections.identity.text.includes(String.fromCharCode(0x201c)), "inside quotation marks");
}

{
  const f = world();
  const ai = rig(() => "I am sorry, but I cannot produce JSON today.");
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await summary(get);
  eq(readRow(f).guard, "read:unparsable", "PROSE INSTEAD OF JSON is recorded as unparsable");
  const next = await summary(get);
  ok(next.body.read.status === "fallback" && /could not be read/.test(next.body.read.provenance), "and cooled down with the reason: " + next.body.read.provenance);
}

{
  const f = world();
  const ai = rig(() => JSON.stringify({ ...GOOD, now: { text: "x ".repeat(5000), cites: ["price.last"] } }));
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await summary(get);
  eq(readRow(f).guard, "read:overlong", "OVERSIZE OUTPUT is recorded before it is read");
  const next = await summary(get);
  ok(next.body.read.status === "fallback" && /longer than the limit/.test(next.body.read.provenance), "and cools down with the reason: " + next.body.read.provenance);
}

{
  const f = world();
  const ai = rig(() => "```json\n" + JSON.stringify(GOOD) + "\n```");
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await summary(get);
  const r = (await summary(get)).body.read;
  ok(r.status === "ready" && r.generated, "a reply wrapped in a code fence is accepted");
}

{
  const f = world();
  const trimmed = { ...GOOD, drivers: [...GOOD.drivers, { text: "Revenue will double.", cites: ["news.count24h"] }], tags: ["dealer-pinned", "crowded-short"] };
  const ai = rig(() => trimmed);
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await summary(get);
  const row = readRow(f);
  eq(row.guard, "read:trimmed:1", "a reply with one driver refused (and one tag code trimmed, which is not counted) is stored trimmed: " + row.guard);
  const r = (await summary(get)).body.read;
  ok(r.status === "ready" && r.sections.drivers.length === 3 && r.tags.length === 1 && r.refused.length === 2, "served without them, and the refusals are in the reading (" + JSON.stringify(r.refused) + ")");
  ok(/1 part of its answer was refused and left out/.test(r.provenance), "and the provenance says so: " + r.provenance);
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await get("/api/flows/meta");
  const day = new Date().toISOString().slice(0, 10);
  f.db.prepare("INSERT INTO flows_ai_usage (day, calls, tokens_in, tokens_out) VALUES (?, 100, 7000000, 100000)").run(day);
  const first = await summary(get);
  eq(first.body.read.status, "generating", "BUDGET: the first call is generating");
  eq(ai.log.reads.length, 0, "the cap refuses the call before the model is reached");
  eq(ai.log.other.length, 0, "and the Neuron's own call, through meteredAi in worker.js, is refused by the same cap");
  const row = readRow(f);
  eq(row.guard, "unreachable:budget", "and the row records the budget refusal: " + row.guard);
  const next = await summary(get);
  eq(next.body.read.status, "fallback", "the deterministic reading stands");
  eq(next.body.read.generated, false, "not generated");
  ok(/model budget for this site is spent/.test(next.body.read.provenance), "and the reader is told the site's own budget is spent: " + next.body.read.provenance);
  ok(next.body.read.sections.now && next.body.read.sections.drivers.length > 0 && next.body.read.tags.length > 0, "with all of its sections");
  ok(next.body.read.retryAfterS > 1500 && next.body.read.retryAfterS <= 1800, "and a thirty-minute cooldown (" + next.body.read.retryAfterS + " s)");
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await get("/api/flows/meta");
  const day = new Date().toISOString().slice(0, 10);
  f.db.prepare("INSERT INTO flows_ai_usage (day, calls, tokens_in, tokens_out) VALUES (?, 40, 0, 700000)").run(day);
  const spent = f.db.prepare("SELECT tokens_out FROM flows_ai_usage").get().tokens_out;
  ok(Math.ceil(spent * 36400 / 1e6) > 22500 && Math.ceil(spent * 36400 / 1e6) < 30000, "SHARE OF THE DAY'S CAP: the day has spent " + Math.ceil(spent * 36400 / 1e6) + " of 30,000 neurons, past the reading's 75% and short of the cap");
  const r = await summary(get);
  eq(ai.log.reads.length, 0, "the reading's model call is refused by the meter");
  eq(readRow(f).guard, "unreachable:budget", "and recorded as a budget refusal");
  eq(RW.READ_BUDGET_SHARE, 0.75, "the reading may spend three quarters of the cap, leaving a quarter for the Neuron and the Ask box");
  ok(r.body.read.status === "generating", "the page is told generating on the first call, then fallback");
  eq(ai.log.other.length >= 1, true, "while the Neuron's own call, past the reading's line, is allowed (" + ai.log.other.length + ")");
}

{
  const source = moduleSource("shared/flows-reading-worker.js");
  const worker = workerSource();
  same(checkModelCalls(), [], "EVERY MODEL CALL OF THE READING GOES THROUGH THE METER: no module the Worker runs, the reading's included, runs the binding outside the AI module");
  eq(expect(source, /askModels\(/, { min: 1, max: 1 }), 1, "it has one call site");
  eq(expect(source, /askModels\(deps\.ai\(\),/, { min: 1, max: 1 }), 1, "handed the dep");
  eq(expect(worker, /ai: \(\) => cappedAi\(/, { min: 1, max: 1 }), 1, "which the Worker makes with cappedAi, at the reading's share of the cap");
  eq(expect(source, /maxTokens: READING_MAX_TOKENS/, { min: 1, max: 1 }), 1, "within the output cap");
  ok(!/retry|attempt\s*[<>]/.test(source.replace(/retryAfterS/g, "")), "and with no retry loop: one logical call per attempt");
}

{
  const f = world();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ai = rig();
  ai.log.gate = gate;
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  const calls = await Promise.all([get("/api/flows/summary?t=" + T), get("/api/flows/summary?t=" + T), get("/api/flows/summary?t=" + T)]);
  ok(calls.every((c) => c.body.read.status === "generating"), "SINGLE-FLIGHT: three concurrent calls all see generating");
  await new Promise((resolve) => setTimeout(resolve, 30));
  eq(ai.log.reads.length, 1, "and one model call is in flight");
  eq(f.db.prepare("SELECT count(*) AS n FROM flows_neuron WHERE scope = 'read:EXMP' AND guard = 'generating'").get().n, 1, "one generating marker");
  const during = await get("/api/flows/summary?t=" + T);
  eq(during.body.read.status, "generating", "a fourth call during the flight is generating too");
  eq(ai.log.reads.length, 1, "with no second call");
  release();
  await Promise.all(calls.map((c) => c.settle()));
  await during.settle();
  eq(ai.log.reads.length, 1, "one call in all");
  eq((await summary(get)).body.read.status, "ready", "and then ready");
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await get("/api/flows/meta");
  f.db.prepare("INSERT INTO flows_neuron (scope, version, fingerprint, summary, ideas, llm, model, guard, generated_at) VALUES ('read:EXMP', 6, 'other|x', '', '[]', 0, NULL, 'generating', ?)")
    .run(new Date(Date.now() - 20000).toISOString());
  const live = await summary(get);
  eq(live.body.read.status, "generating", "ANOTHER ISOLATE'S MARKER younger than ninety seconds: generating, not taken over");
  eq(ai.log.reads.length, 0, "no call");
  f.db.prepare("UPDATE flows_neuron SET generated_at = ? WHERE scope = 'read:EXMP'").run(new Date(Date.now() - 200000).toISOString());
  await summary(get);
  eq(ai.log.reads.length, 1, "a marker older than ninety seconds is a dead generator's and is taken over");
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai, FLOWS_READ_MODE: "off" });
  await get("/api/flows/meta");
  f.db.prepare("INSERT INTO flows_neuron (scope, version, fingerprint, summary, ideas, llm, model, guard, generated_at) VALUES ('read:EXMP', 6, 'x', 'x', ?, 1, ?, NULL, ?)")
    .run(JSON.stringify({ v: 1, kind: "reading", shape: { status: "ready", sections: {} }, refused: [] }), MODEL, new Date().toISOString());
  const r = await summary(get);
  eq(r.body.read.status, "fallback", "KILL SWITCH off: the summary field is the deterministic reading");
  eq(r.body.read.why, "off", "why off");
  eq(r.body.read.generated, false, "never generated, even with a stored reading in the table");
  eq(ai.log.reads.length, 0, "and the model is never asked");
  ok(/switched off/.test(r.body.read.provenance), "the reader is told: " + r.body.read.provenance);
  ok(r.body.read.sections.now && r.body.read.sections.drivers.length > 0, "and the reading is whole");
  const bogus = await client(f.D1, { ...AI_ENV, AI: ai, FLOWS_READ_MODE: " Off " });
  eq((await bogus("/api/flows/summary?t=" + T)).body.read.why, "off", "the switch is read trimmed and case-folded");
  const dflt = await client(f.D1, { ...AI_ENV, AI: ai, FLOWS_READ_MODE: undefined });
  const live = await dflt("/api/flows/summary?t=" + T);
  eq(live.body.read.why === "off", false, "and an unset or unknown value means on");
  eq(RW.readMode({}), "on", "unset is on");
  eq(RW.readMode({ FLOWS_READ_MODE: "banana" }), "on", "anything but off is on");
}

{
  const f = world();
  const get = await client(f.D1, { FLOWS_READ_MODE: "on" });
  const r = await summary(get);
  eq(r.body.read.status, "fallback", "NO MODEL CONFIGURED: the deterministic reading");
  eq(r.body.read.why, "no-model", "why no-model");
  ok(/No model is configured/.test(r.body.read.provenance), "and says so");
  eq(f.db.prepare("SELECT count(*) AS n FROM flows_neuron WHERE scope LIKE 'read:%'").get().n, 0, "nothing is written");
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await get("/api/flows/summary?t=" + T);
  f.fail(/INSERT INTO flows_neuron/);
  dropHot();
  const r = await summary(get, T);
  f.fail(null);
  ok(["fallback", "generating"].includes(r.body.read.status), "STORE FAULT on the marker: no crash (" + r.body.read.status + ")");
  const g = world();
  const ai2 = rig();
  const get2 = await client(g.D1, { ...AI_ENV, AI: ai2 });
  await get2("/api/flows/dossier?t=" + T);
  g.fail(/INSERT INTO flows_neuron/);
  const r2 = await summary(get2);
  eq(r2.body.read.status, "fallback", "a marker that cannot be written answers fallback");
  eq(r2.body.read.why, "store", "why store");
  eq(ai2.log.reads.length, 0, "and the model is never called: the marker fails closed");
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  stub.state.bodies.set("screener", { data: [] });
  for (const key of ["info", "profile", "financials", "breakdown", "estimates", "analysts", "earnings", "ownership", "short", "insiders", "news", "levels", "quote"]) stub.state.status.set(key, 404);
  const r = await summary(get, "QQQZ");
  eq(r.body.tier, "none", "A NAME NOTHING HOLDS: tier none for the Neuron");
  eq(r.body.status, "absent", "absent for the Neuron");
  eq(r.body.read.status, "absent", "absent for the reading");
  eq(r.body.read.sections.now, null, "no now sentence is written for a name with nothing");
  eq(r.body.read.sections.identity, null, "no identity");
  eq(r.body.read.sections.unknown.length, 11, "every packet that holds nothing is named unknown (the market backdrop is read, and is not the name)");
  eq(r.body.read.generated, false, "not generated");
  ok(/Nothing is held for QQQZ/.test(r.body.read.note), "with the reason: " + r.body.read.note);
  eq(ai.log.reads.length, 0, "and no model is asked about nothing");
  eq(f.db.prepare("SELECT count(*) AS n FROM flows_neuron WHERE scope = 'read:QQQZ'").get().n, 0, "and nothing is written");
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  const r = await summary(get, "QQQZ");
  eq(r.body.tier, "none", "a name outside the universe that the vendor still describes: tier none");
  ok(r.body.read.status === "generating" && r.body.read.sections.now !== null, "gets a reading from what exists (identity, quote, news): " + r.body.read.status);
  ok(r.body.read.coverage.withheld >= 5, "and names what is withheld (" + JSON.stringify(r.body.read.coverage) + ")");
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  const r = await summary(get, "OTHR");
  ok(r.body.read && typeof r.body.read.status === "string", "a name outside the card set still carries a read: " + r.body.read.status);
}

{
  const sizes = [];
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  const r = await summary(get);
  sizes.push(JSON.stringify(r.body.read).length);
  const r2 = await summary(get);
  sizes.push(JSON.stringify(r2.body.read).length);
  ok(sizes.every((n) => n < 14000), "the read field is under 14 kB cold and warm (" + sizes.join(", ") + ")");
  const sent = ai.log.reads[0].input.messages;
  const chars = sent[0].content.length + sent[1].content.length;
  ok(chars / 3.7 < 7000, "the prompt is " + Math.round(chars / 3.7) + " estimated tokens (" + chars + " characters)");
  ok(!/options\.idea\./.test(sent[1].content), "no ranked structure is in the prompt");
}

{
  const f = world();
  F.seed(f, { live: false });
  f.put("brief", { v: 1, sessionDate: F.SESSION, generatedAt: F.GENERATED, facts: [], silences: { pending: [], unreadable: [], quiet: [], unavailable: [] } });
  const asks = [];
  const reply = { text: "EXMP sells subscription software and cloud infrastructure, and the last price is $127.40." };
  const ai = {
    run: async (model, input) => {
      if (READER.test(input.messages[0].content)) return { response: JSON.stringify(GOOD), usage: USAGE };
      if (input.messages[0].content.startsWith("You answer questions")) { asks.push(input); return { response: reply.text, usage: { prompt_tokens: 900, completion_tokens: 60 } }; }
      return { response: "{}", usage: { prompt_tokens: 10, completion_tokens: 1 } };
    },
  };
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  const ASK = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const a = await get("/api/flows/ask", ASK({ question: "what does EXMP do and why is it moving", subject: T }));
  await a.settle();
  eq(a.res.status, 200, "ASK: a ticker question answers");
  ok(a.body.dossierFacts > 0 && a.body.dossierFacts <= R.ASK_MAX_FACTS, "it carries " + a.body.dossierFacts + " dossier facts");
  ok(a.body.facts.some((x) => /^dossier:EXMP\//.test(x.id)), "among the picked facts");
  ok(/Plus \d+ facts? from the company dossier/.test(a.body.why), "and the why says so: " + a.body.why);
  eq(asks.length, 1, "one model call");
  const prompt = asks[0].messages;
  ok(prompt[0].content.includes("quoted third-party text") && prompt[0].content.includes(OPEN), "the system prompt carries the rule that quoted text is data");
  ok(prompt[1].content.includes("About EXMP (Example Technologies Inc):"), "and the user message an about-this-company section");
  ok(/dossier:EXMP/.test(JSON.stringify(a.body.facts)) && prompt[1].content.includes(OPEN + "Example Technologies sells subscription software"), "the description is quoted inside UNTRUSTED");
  ok(!JSON.stringify(a.body.facts).includes(OPEN), "while the facts the page shows carry the plain quoted text");
  ok(prompt[1].content.includes("Example Technologies Inc"), "and the company's name is among the facts");
  eq(a.body.llm, true, "the clean answer is kept");
  ok(a.body.answer.includes("$127.40"), "the answer carries a figure that is in a picked fact");
  ok((prompt[0].content.length + prompt[1].content.length) / 3.7 < 4500, "the Ask prompt stays small (" + Math.round((prompt[0].content.length + prompt[1].content.length) / 3.7) + " estimated tokens)");

  reply.text = "EXMP is up 14.5% today on the guidance news.";
  const b = await get("/api/flows/ask", ASK({ question: "why is EXMP moving", subject: T }));
  await b.settle();
  eq(b.body.llm, false, "AN INVENTED NUMERAL IS STILL REFUSED: the guard validates against the dossier facts too");
  ok(b.body.guard && b.body.guard.invented === true && b.body.guard.rejected.includes("14.5"), "naming 14.5");
  ok(b.body.answer.includes("EXMP \u2014"), "and the pipeline's own wording, built from the picked facts, stands in its place");

  reply.text = "EXMP will report on 2026-10-22 and the shares will rally.";
  const c = await get("/api/flows/ask", ASK({ question: "when does EXMP report", subject: T }));
  await c.settle();
  eq(c.body.llm, false, "a forecast is still refused");
  ok(c.body.guard && c.body.guard.forecast === true, "as a forecast");

  const d = await get("/api/flows/ask", ASK({ question: "what is the market doing" }));
  await d.settle();
  eq(d.body.dossierFacts, 0, "a question that names no ticker and has no page subject costs no dossier");

  const e = await get("/api/flows/ask", ASK({ question: "what does EXMP do" }));
  await e.settle();
  ok(e.body.dossierFacts > 0, "a ticker typed in the question is enough, with no page subject");

  const g = await get("/api/flows/ask", ASK({ question: "what is the IV and the RSI for the market" }));
  await g.settle();
  eq(g.body.dossierFacts, 0, "IV and RSI are not tickers");

  const h = await get("/api/flows/ask", ASK({ question: "what does ZZZY do" }));
  await h.settle();
  eq(h.body.dossierFacts, 0, "and an unknown ticker adds no fact and no error");
  eq(h.res.status, 200, "200");
}

{
  const f = world();
  F.seed(f, { live: false });
  f.put("brief", { v: 1, sessionDate: F.SESSION, generatedAt: F.GENERATED, facts: [], silences: { pending: [], unreadable: [], quiet: [], unavailable: [] } });
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await get("/api/flows/meta");
  const day = new Date().toISOString().slice(0, 10);
  f.db.prepare("INSERT INTO flows_ai_usage (day, calls, tokens_in, tokens_out) VALUES (?, 100, 7000000, 100000)").run(day);
  const ASK = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const a = await get("/api/flows/ask", ASK({ question: "what does EXMP do and why is it moving", subject: T }));
  await a.settle();
  eq(a.res.status, 200, "ASK PAST THE CAP: the question still answers 200");
  eq(ai.log.reads.length + ai.log.other.length, 0, "and the Ask box's call, through meteredAi in worker.js, is refused by the day's cap before the model is reached");
  eq(a.body.llm, false, "the pipeline's own wording stands");
  ok(/model budget this site allows itself for one day is spent/.test(a.body.note || ""), "and the reader is told the site's own budget is spent: " + a.body.note);
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  const r = await summary(get);
  const fb = r.body.read;
  ok(fb.sections.identity && fb.sections.identity.text.includes(String.fromCharCode(0x201c)), "the deterministic identity quotes the profile's own first sentence");
  const dossier = (await get("/api/flows/dossier?t=" + T)).body.dossier;
  const idx = R.readIndex(R.forReading(dossier));
  for (const item of [fb.sections.identity, fb.sections.now, ...fb.sections.drivers, ...fb.sections.tensions, ...fb.sections.watch].filter(Boolean)) {
    ok(item.cites.every((c) => idx.get(c.id) && idx.get(c.id).display.startsWith(c.display.slice(0, 40).replace(/\u2026$/, ""))), "every cite chip of the served fallback is a fact of the served dossier: " + item.cites.map((c) => c.id).join(","));
  }
}

{
  const f = world();
  const ai = rig();
  const get = await client(f.D1, { ...AI_ENV, AI: ai });
  await summary(get);
  const cpu = () => (typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : process.cpuUsage());
  const per = async (route, n = 30, between) => {
    for (let i = 0; i < 6; i++) { if (between) between(); await get(route); }
    const windows = [];
    for (let w = 0; w < 5; w++) {
      let used = 0;
      for (let i = 0; i < n; i++) {
        if (between) between();
        const a = cpu();
        const r = await get(route);
        const b = cpu();
        used += (b.user + b.system - a.user - a.system) / 1000;
        r.settle();
      }
      windows.push(used / n);
    }
    windows.sort((x, y) => x - y);
    return windows[2];
  };
  const hit = await per("/api/flows/summary?t=" + T);
  const hot = await per("/api/flows/dossier?t=" + T);
  const miss = await per("/api/flows/summary?t=" + T, 10, () => { f.db.prepare("DELETE FROM flows_neuron WHERE scope = 'read:EXMP'").run(); });
  ok(hit < 25 && miss < 60, "CPU of a summary call on the fake: stored reading " + hit.toFixed(2) + " ms, no stored reading " + miss.toFixed(2) + " ms (the dossier route from its 30-second copy: " + hot.toFixed(2) + " ms)");
  console.log("  reading CPU per summary request: hit " + hit.toFixed(2) + " ms, miss " + miss.toFixed(2) + " ms, dossier route from its copy " + hot.toFixed(2) + " ms");
}

ok(assertAiGuarded({ minAllowed: 1 }) >= 1, "EVERY SCRIPTED MODEL CALL CAME THROUGH shared/flows-ai.js: the binding handed to worker.js throws on any other caller (" + aiGuardStats().allowed + " calls)");
console.log("flows-reading-worker: " + checks + " checks");
