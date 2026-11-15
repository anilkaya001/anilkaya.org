import assert from "node:assert/strict";
import * as R from "../shared/flows-reading.js";
import * as RW from "../shared/flows-reading-worker.js";
import { AI_INTRADAY_REFRESH_MS } from "../shared/flows-ai.js";
import { expectedNightlySession } from "../shared/flows-freshness.js";
import { fakeD1, shiftClock, cacheFake, vendorStub, client } from "./dossier-harness.mjs";
import * as F from "./dossier-fixtures.mjs";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const restore = shiftClock();
const cache = cacheFake();
vendorStub();
const T = F.T;
const MODEL = "@cf/zai-org/glm-4.7-flash";
const ENV = { FLOWS_ASK_MODEL: MODEL, FLOWS_ASK_FALLBACK_MODEL: "", FLOWS_ASK_NEURONS: "5500,36400", FLOWS_READ_MODE: "on" };

const f = fakeD1();
F.seed(f, {});
cache.clear();
const probe = await (await client(f.D1, ENV))("/api/flows/dossier?t=" + T);
const dossier = probe.body.dossier;
const neuron = { tier: probe.body.tier };
ok(dossier && dossier.fingerprint, "(setup) a real dossier of " + T + " from the harness");
const RUN_ENV = { ...ENV, AI: { run: async () => { throw new Error("no binding is reached here"); } }, DB: {} };
const tags = R.heldTags(dossier);
const prompt = R.promptForReading(dossier, tags);
const clause = " on the vendor's convention (dealers long calls, short puts)";
const GOOD = {
  identity: { text: "Example Technologies Inc sells subscription software and cloud infrastructure to mid-sized enterprises, with revenue mostly from recurring contracts.", cites: ["identity.name", "identity.description"] },
  now: { text: "The last price is $127.40, +1.27% from the previous close. The return over 21 sessions is +6.30% and net option premium today is +$4.40M. The next earnings report is dated 2026-10-22, 15 sessions after the last close.", cites: ["price.last", "price.change", "price.r21", "flow.strip.net", "events.next", "events.sessions"] },
  drivers: [
    { text: "News flow is steady: 4 headlines in the last 24 hours, and Reuters reports a cloud contract win.", cites: ["news.count24h", "news.h1"] },
    { text: "Option flow leans to calls: bullish against bearish premium is +0.47.", cites: ["flow.strip.lean"] },
    { text: "The implied dealer state is pinned" + clause + ", with the gamma flip at $124.00.", cites: ["options.state", "options.engine.level.flip"] },
  ],
  tensions: [], unknown: [], tags: ["dealer-pinned", "news-driven", "flow-led-calls"], watch: [],
};
ok(R.vetReading(JSON.stringify(GOOD), dossier, tags, { shown: prompt.shown, rendered: prompt.user }).ok, "(setup) the scripted reply stands whole");
const whole = JSON.stringify(GOOD);
const CUT = whole.slice(0, whole.indexOf(GOOD.drivers[2].text) + 12);
ok(R.parseReading(CUT) === null, "(setup) the cut reply does not parse whole");
const NOW = Date.now();
const sig = RW.readSignature(ENV);
const fingerprint = dossier.fingerprint + "|" + sig;

function rowOf(o) {
  return { fingerprint: o.fingerprint || fingerprint, llm: o.llm ? 1 : 0, guard: o.guard === undefined ? null : o.guard, model: MODEL,
    generated_at: new Date(o.at).toISOString(), summary: "", ideas: JSON.stringify(o.shape ? { v: 1, kind: "reading", shape: o.shape, refused: [] } : null) };
}

function depsFor(rows, script, log) {
  return {
    readRow: async (scope) => { if (rows.fail) throw new Error("store refused"); return rows[scope] || null; },
    assemble: async () => ({ dossier, neuron, trace: {} }),
    mark: async (scope) => {
      if (rows.markFail) return { failed: true, startedAt: null };
      log.marks++;
      rows[scope] = rowOf({ guard: "generating", at: NOW });
      return { failed: false, startedAt: new Date(NOW).toISOString() };
    },
    write: async (scope, fp, summary, ideas, llm, model, guard, at) => {
      log.writes.push({ scope, guard, llm });
      rows[scope] = { fingerprint: fp, llm: llm ? 1 : 0, guard, model, generated_at: at, summary, ideas: JSON.stringify(ideas) };
    },
    call: async () => {
      log.calls++;
      const said = script();
      return { ...said, model: MODEL, attempts: [{ model: MODEL, text: said.text, finish: said.finish || "stop", reasoned: false, failed: null }],
        call: { settle: async (v) => { log.settled.push(v); return true; } } };
    },
    modelLabel: (m) => m,
    describeGuard: (g) => "Deterministic reading: " + g + ".",
  };
}

async function run(W, s) {
  const rows = s.rows ? s.rows() : {};
  const log = { calls: 0, marks: 0, writes: [], settled: [] };
  const deps = depsFor(rows, s.script || (() => ({ text: whole })), log);
  const read = await W.readingFor(RUN_ENV, null, T, deps, { now: NOW });
  return { read, log, rows };
}

const keptShape = (session) => ({
  ...R.readingShape({ dossier, tags, sections: R.readingFallback(dossier, tags), chosen: [], status: "ready", generated: true, model: MODEL, provenance: "x" }),
  session,
});

const SCENARIOS = [
  {
    name: "a dead generator's claim",
    rows: () => ({ ["gen:read:" + T]: rowOf({ guard: "generating", at: NOW - 200000 }) }),
    check: ({ read, log }) => read.status === "fallback" && read.why === "stalled" && read.retryAfterS > 0 && read.retryAfterS <= 190 &&
      read.note === RW.reasonFor("stalled") && log.calls === 0,
  },
  {
    name: "a claim younger than ninety seconds",
    rows: () => ({ ["gen:read:" + T]: rowOf({ guard: "generating", at: NOW - 30000 }) }),
    check: ({ read, log }) => read.status === "generating" && log.calls === 0,
  },
  {
    name: "a claim past the stall window",
    rows: () => ({ ["gen:read:" + T]: rowOf({ guard: "generating", at: NOW - RW.READ_GENERATING_MS - RW.READ_STALL_MS - 1000 }) }),
    check: ({ log }) => log.calls === 1,
  },
  {
    name: "a refusal inside its cooldown",
    rows: () => ({ ["gen:read:" + T]: rowOf({ guard: "read:refused", at: NOW - 60000 }) }),
    check: ({ read, log }) => read.status === "fallback" && read.why === "cooldown" && read.note === RW.reasonFor("read:refused") &&
      read.retryAfterS === (RW.READ_COOLDOWN_MS["read:refused"] - 60000) / 1000 && log.calls === 0,
  },
  {
    name: "a model that answered empty",
    rows: () => ({ ["gen:read:" + T]: rowOf({ guard: "unreachable:empty", at: NOW - 60000 }) }),
    check: ({ read, log }) => read.status === "fallback" && read.note === RW.reasonFor("unreachable:empty") && read.retryAfterS > 3000 && log.calls === 0,
  },
  {
    name: "the budget refusal",
    rows: () => ({ ["gen:read:" + T]: rowOf({ guard: "unreachable:budget", at: NOW - 60000 }) }),
    check: ({ read, log }) => read.status === "fallback" && /03:00 TRT/.test(read.note) && log.calls === 0 &&
      read.retryAfterS === Math.max(1, Math.ceil((Math.max(60000, RW.untilUtcDay(NOW - 60000)) - 60000) / 1000)),
  },
  {
    name: "a store that cannot be read",
    rows: () => ({ fail: true }),
    check: ({ read, log }) => read.status === "fallback" && read.why === "store" && read.retryAfterS === RW.READ_STORE_RETRY_S &&
      read.note === RW.reasonFor("store") && log.calls === 0,
  },
  {
    name: "a claim that cannot be written",
    rows: () => ({ markFail: true }),
    check: ({ read, log }) => read.status === "fallback" && read.why === "store" && read.retryAfterS === RW.READ_STORE_RETRY_S && log.calls === 0,
  },
  {
    name: "a reply cut at its length limit",
    script: () => ({ text: CUT, finish: "length" }),
    check: ({ log, rows }) => {
      const row = rows["read:" + T];
      const body = row && JSON.parse(row.ideas);
      return log.calls === 1 && !!row && row.llm === 1 && /^read:salvaged:\d+$/.test(row.guard) && body.shape.provenance.includes(RW.SALVAGED_SENTENCE) &&
        body.shape.sections.drivers.length === 2 && log.settled.some((v) => v.llm === true && /^read:salvaged:/.test(v.guard));
    },
  },
  {
    name: "a cut reply that finished on stop",
    script: () => ({ text: CUT, finish: "stop" }),
    check: ({ rows }) => !rows["read:" + T] && !!rows["gen:read:" + T] && rows["gen:read:" + T].guard === "read:unparsable",
  },
  {
    name: "a floor hit from an earlier session",
    rows: () => ({ ["read:" + T]: rowOf({ llm: true, at: NOW - 60000, shape: keptShape("2026-09-01"), fingerprint: "older|" + sig }) }),
    check: ({ read }) => read.held !== "floor",
  },
  {
    name: "a floor hit from the current session",
    rows: () => ({ ["read:" + T]: rowOf({ llm: true, at: NOW - 60000, shape: keptShape(expectedNightlySession(NOW)), fingerprint: "older|" + sig }) }),
    check: ({ read, log }) => read.held === "floor" && log.calls === 0,
  },
];

ok(60000 < AI_INTRADAY_REFRESH_MS, "(setup) a reading a minute old is inside the intraday floor");
for (const s of SCENARIOS) {
  const out = await run(RW, s);
  ok(s.check(out), "THE CORRECT BUILD: " + s.name + " ends in its terminal state (" + out.read.status + ", " + out.read.why + ", " + out.read.held +
    ", retry " + out.read.retryAfterS + " s, " + out.log.calls + " model calls)");
}

eq(RW.cooldownMs("unreachable:budget", Date.parse("2026-10-05T23:50:00Z")), 10 * 60000, "the budget cooldown ends at the next 00:00 UTC (10 minutes after 23:50)");
eq(RW.cooldownMs("unreachable:budget", Date.parse("2026-10-05T23:59:30Z")), 60000, "and never under a minute");
eq(RW.cooldownMs("unreachable:allowance", Date.parse("2026-10-05T12:00:00Z")), 12 * 3600000, "the allowance renews on the same clock");
eq(RW.cooldownMs("read:refused", Date.parse("2026-10-05T23:59:30Z")), RW.READ_COOLDOWN_MS["read:refused"], "while a wording failure keeps its own cooldown");
eq(RW.claimState(89999).state, "live", "a claim of 89.999 s is live");
eq(RW.claimState(90000).state, "stalled", "of 90 s stalled");
eq(RW.claimState(90000).retryAfterS, 300, "with five minutes to the next attempt");
eq(RW.claimState(RW.READ_GENERATING_MS + RW.READ_STALL_MS).state, "dead", "and at the end of the window dead, taken over");
for (const key of Object.keys(RW.READ_COOLDOWN_MS)) {
  ok(RW.reasonFor(key) !== RW.READ_REASON_DEFAULT && !/\bvendor\b|\btape\b/i.test(RW.reasonFor(key)), "every cooldown has its own plain reason: " + key);
}

const PLANTS = [
  { name: "the dead claim taken over at once", from: "  if (ageMs < READ_GENERATING_MS + READ_STALL_MS) return { state: \"stalled\"", to: "  if (false) return { state: \"stalled\"", breaks: "a dead generator's claim" },
  { name: "a dead claim read as live for ever", from: "  return { state: \"dead\", retryAfterS: null };", to: "  return { state: \"live\", retryAfterS: null };", breaks: "a claim past the stall window" },
  { name: "the stalled reading with no reason", from: "fb(\"fallback\", \"stalled\", { note: reasonFor(\"stalled\"), retryAfterS })", to: "fb(\"fallback\", \"stalled\", { retryAfterS })", breaks: "a dead generator's claim" },
  { name: "a cooldown with no reason", from: "fb(\"fallback\", \"cooldown\", { guard: attempt.guard, note: reasonFor(attempt.guard), retryAfterS })", to: "fb(\"fallback\", \"cooldown\", { guard: attempt.guard, retryAfterS })", breaks: "a refusal inside its cooldown" },
  { name: "the budget on a fixed half hour", from: "if (DAILY_GUARDS.has(guard) && isNum(at))", to: "if (false)", breaks: "the budget refusal" },
  { name: "a claim fault with no retry time", from: "fb(\"fallback\", \"store\", { note: reasonFor(\"store\"), retryAfterS: READ_STORE_RETRY_S }), { retryAfterS: READ_STORE_RETRY_S });", to: "fb(\"fallback\", \"store\"), {});", breaks: "a claim that cannot be written" },
  { name: "an unreadable store with no retry time", from: "  if (storeDown) return fb(\"fallback\", \"store\", { note: reasonFor(\"store\"), retryAfterS: READ_STORE_RETRY_S });", to: "  if (storeDown) return fb(\"fallback\", \"store\");", breaks: "a store that cannot be read" },
  { name: "no salvage of a length cut", from: "if (parsed === null && cutAtLength(said)) {", to: "if (parsed === null && false) {", breaks: "a reply cut at its length limit" },
  { name: "salvage of any malformed reply", from: "if (parsed === null && cutAtLength(said)) {", to: "if (parsed === null) {", breaks: "a cut reply that finished on stop" },
  { name: "salvage stored with no word of the cut", from: "provenance: readyProvenance(label, cost, refusedCount) + \" \" + SALVAGED_SENTENCE,", to: "provenance: readyProvenance(label, cost, refusedCount),", breaks: "a reply cut at its length limit" },
  { name: "the floor blind to the session", from: " && !(sessionsBehind(stored.shape.session || null, expectedNightlySession(now)) > 0)) {", to: ") {", breaks: "a floor hit from an earlier session" },
];

let salt = 1;
for (const p of PLANTS) {
  const W = await loadMutated("shared/flows-reading-worker.js", [[p.from, p.to]], { salt: salt++ });
  const s = SCENARIOS.find((x) => x.name === p.breaks);
  ok(s, "(setup) the planted build names a scenario: " + p.breaks);
  const out = await run(W, s);
  ok(!s.check(out), "A PLANTED WRONG BUILD (" + p.name + ") fails '" + p.breaks + "' (" + out.read.status + ", " + out.read.why + ", retry " + out.read.retryAfterS + ")");
}

restore();
console.log("flows-reading-terminal: " + checks + " checks");
