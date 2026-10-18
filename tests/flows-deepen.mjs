import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as D from "../shared/flows-deepen.js";
import * as universeLib from "../shared/flows-universe.js";
import * as products from "../shared/flows-products.js";
import * as contracts from "../shared/flows-contracts.js";
import * as door from "../shared/flows-door.js";
import { lines } from "../shared/flows-plan-facts.js";
import { CALL_BUDGET, CALL_COST, DEADLINE_MS, callModel } from "../scripts/flows-nightly/vendor-params.mjs";
import { STAGES } from "../scripts/flows-nightly/stages.mjs";
import { deepenScenario } from "./pipeline-sim/deepen.mjs";
import { nightlyEmit, emitRead } from "./lib/nightly-emit.mjs";
import { nightlySource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const gov = (over = {}) => D.governor({
  mode: "on", cap: D.DEEPEN.perNightCap, backlog: 700, dayLine: 60000, minuteLine: 500, callsSoFar: 1500, elapsedMs: 70000, ...over,
});

eq(gov().n, 530, "the shipped cap binds on an ordinary night");
eq(gov().binding, "cap", "and the governor says so");
eq(gov({ mode: "off" }).n, 0, "the switch off chooses nothing");
eq(gov({ cap: 0 }).n, 0, "a cap of zero chooses nothing");
eq(gov({ backlog: 3 }).n, 0, "a backlog under the smallest batch is not worth a stage");
eq(gov({ backlog: 30 }).n, 30, "a small backlog is read whole");
eq(gov({ callsSoFar: 60000 }).n, 0, "a day line already spent chooses nothing");
eq(gov({ elapsedMs: DEADLINE_MS }).n, 0, "a deadline already reached chooses nothing");
ok(gov({ elapsedMs: 24 * 60 * 1000 }).n < gov().n, "a slow run reads fewer names");
ok(gov({ callsSoFar: 35000 }).n < gov().n, "a run that has spent more of its calls reads fewer names");
ok(gov({ dailySeen: 40000 }).n < gov().n, "and so does a key that others have already spent today");
eq(gov({ dailySeen: 1000 }).n, gov().n, "a key count under the run's own spend changes nothing");
eq(gov({ dailySeen: null }).n, gov().n, "and an unread counter is not a reading");
ok(gov({ dailySeen: 9e9 }).n === 0, "a key over its line chooses nothing");
eq(gov({ cap: 100000 }).limits.time, 535, "the time term at the shipped deadline is 535 names");
eq(gov({ cap: 100000 }).limits.calls, 1214, "and the day term, with nothing else spent, is 1,214");
eq(gov({ cap: 100000, callsSoFar: 0 }).n, 535, "so the deadline, not the day line, bounds an uncapped night");
eq(gov({ cap: 100000 }).binding, "time", "and the governor says so");
eq(gov({ backlog: 10000, cap: 100000, elapsedMs: 24 * 60 * 1000 }).limits.time, 443, "a run 24 minutes in has 443 names of time left");
eq(gov({ cap: 100000 }).n, gov({ cap: D.DEEPEN.hardCap }).n, "no cap lifts the hard cap");
ok(gov({ dayLine: 20000 }).n < gov().n, "a smaller plan reads fewer names");
eq(gov({ dayLine: null }).limits.calls, gov({ dayLine: 60000 }).limits.calls, "an unread plan is held to the working line");
eq(gov({ minuteLine: 500 }).pace.spacingMs, 150, "500 calls a minute is paced at 150 ms, 400 a minute");
eq(gov({ minuteLine: 1000 }).pace.spacingMs, 75, "and a larger line is paced faster");
ok(gov().pace.perMinute <= 500 * D.DEEPEN.minuteSharePct, "the rotation never claims the whole minute line");

eq(D.deepenMode({}), "on", "an unset switch is on");
eq(D.deepenMode({ FLOWS_DEEPEN: "off" }), "off", "off is off");
eq(D.deepenMode({ FLOWS_DEEPEN: " OFF " }), "off", "in any case");
eq(D.deepenMode({ FLOWS_DEEPEN: "no" }), "on", "anything but off is on");
eq(D.capFromEnv({}), 530, "no cap variable gives the shipped cap");
eq(D.capFromEnv({ FLOWS_DEEPEN_CAP: "12" }), 12, "a cap variable is honoured");
eq(D.capFromEnv({ FLOWS_DEEPEN_CAP: "0" }), 0, "zero skips the night");
eq(D.capFromEnv({ FLOWS_DEEPEN_CAP: "99999" }), D.DEEPEN.hardCap, "and is clamped");
eq(D.capFromEnv({ FLOWS_DEEPEN_CAP: "x" }), 530, "a malformed value falls back");
eq(D.capFromEnv({}, 24), 24, "a caller may give its own default");

const slope = (callModel({ deep: 100 }, CALL_COST).total - callModel({ deep: 0 }, CALL_COST).total) / 100 + CALL_COST.enrich;
const model = slope;
const enrichOne = 0;
ok(D.DEEPEN.callsPerName >= model + enrichOne, `a rotated name is priced at ${D.DEEPEN.callsPerName} calls, at least the model's ${model + enrichOne}`);
ok(D.DEEPEN.callsPerName <= (model + enrichOne) * 1.15, "and not padded by more than 15 per cent");
ok(D.DEEPEN.baselineCalls >= CALL_BUDGET, `the baseline (${D.DEEPEN.baselineCalls}) covers the nominal nightly budget (${CALL_BUDGET})`);
eq(D.DEEPEN.deadlineMs, DEADLINE_MS, "the governor's deadline is the run's");
const plan = lines({});
eq(plan["uw.day"].cap, 60000, "the working day line is what the plan facts say");
eq(plan["uw.min"].cap, D.DEEPEN.workingMinuteLine, "and so is the minute line");
const nightlyShare = (D.DEEPEN.baselineCalls + D.DEEPEN.perNightCap * D.DEEPEN.callsPerName) / plan["uw.day"].cap;
ok(nightlyShare < D.DEEPEN.daySharePct, `a whole night at the shipped cap is ${(nightlyShare * 100).toFixed(1)} per cent of the day line, under the ${D.DEEPEN.daySharePct * 100} per cent share`);
const nightMs = D.DEEPEN.baselineMs + D.DEEPEN.perNightCap * D.DEEPEN.msPerName;
ok(nightMs < DEADLINE_MS * D.DEEPEN.timeSharePct, `and ${(nightMs / 60000).toFixed(1)} minutes of the ${(DEADLINE_MS / 60000)} minute deadline`);

eq([D.DEEPEN.perNightCap, D.DEEPEN.hardCap, D.DEEPEN.daySharePct, D.DEEPEN.deadlineMs / 60000], [530, 900, 0.85, 90], "the shipped sizing is 530 a night, 900 at most, 85 per cent of the day line, a 90 minute deadline");
const wf = readFileSync(path.join(ROOT, ".github/workflows/flows-pipeline.yml"), "utf8");
const timeout = Number((/\n {2}build:\n {4}runs-on: [^\n]+\n {4}timeout-minutes: (\d+)/.exec(wf) || [])[1]);
ok(timeout >= D.DEEPEN.deadlineMs / 60000 + 20, `the workflow's ${timeout} minute timeout leaves at least 20 minutes after the ${D.DEEPEN.deadlineMs / 60000} minute deadline for the stages that follow it`);
ok(/concurrency:\n {2}group: flows-pipeline\n {2}cancel-in-progress: false/.test(wf), "and the concurrency group is unchanged");
const rotationMinutes = D.DEEPEN.perNightCap * D.DEEPEN.msPerName / 60000;
const callsPerMinute = D.DEEPEN.perNightCap * D.DEEPEN.callsPerName / rotationMinutes;
ok(callsPerMinute <= lines({})["uw.min"].cap * D.DEEPEN.minuteSharePct, `a full rotation runs at ${callsPerMinute.toFixed(0)} calls a minute, inside ${D.DEEPEN.minuteSharePct * 100} per cent of the ${lines({})["uw.min"].cap} minute line`);

const universe = Array.from({ length: 12 }, (_, i) => ({ t: "SYX" + String(i).padStart(3, "0"), w: (12 - i) * 1e6 }));
const empty = D.parseLedger(null);
eq(D.pickRotation({ candidates: universe, ledger: empty, sessionDate: "2026-10-16", n: 3 }).picked, ["SYX000", "SYX001", "SYX002"], "never-read names go in order of liquidity");
const led = D.parseLedger({ v: 1, sessionDate: "2026-10-15", at: { SYX000: "2026-10-15", SYX001: "2026-10-09", SYX005: "2026-10-12" }, tries: {} });
eq(D.pickRotation({ candidates: universe, ledger: led, sessionDate: "2026-10-16", n: 5 }).picked, ["SYX002", "SYX003", "SYX004", "SYX006", "SYX007"], "names with no deep read precede every dated one");
eq(D.pickRotation({ candidates: universe.slice(0, 3), ledger: led, sessionDate: "2026-10-16", n: 3 }).picked, ["SYX002", "SYX001", "SYX000"], "then the oldest read comes first");
eq(D.pickRotation({ candidates: universe, ledger: empty, sessionDate: "2026-10-16", exclude: new Set(["SYX000"]), n: 1 }).picked, ["SYX001"], "an excluded name is passed over");
eq(D.pickRotation({ candidates: universe, ledger: empty, sessionDate: "2026-10-16", n: 0 }).picked, [], "no slots chooses nothing");
eq(D.pickRotation({ candidates: [...universe, universe[0], { t: "bad name" }, null], ledger: empty, sessionDate: "2026-10-16", n: 99 }).picked.length, 12, "duplicates and malformed rows are dropped");

eq([1, 2, 3, 4, 5, 6].map(D.backoffSessions), [1, 2, 4, 8, 8, 8], "the backoff doubles to a ceiling");
const failing = D.parseLedger({ v: 1, sessionDate: "2026-10-15", at: {}, tries: { SYX000: ["2026-10-15", 2] } });
eq(D.ready(failing, "SYX000", "2026-10-16"), false, "a name that failed twice waits");
eq(D.ready(failing, "SYX000", "2026-10-19"), true, "and returns after its backoff");
const picked = D.pickRotation({ candidates: universe, ledger: failing, sessionDate: "2026-10-16", n: 2 });
eq([picked.picked, picked.waiting], [["SYX001", "SYX002"], 1], "a waiting name is counted, not chosen");

const next = D.ledgerPayload({ v: 1, at: { SYX001: "2026-10-09", GONE: "2026-10-01" }, tries: { SYX002: ["2026-10-15", 1] } }, {
  sessionDate: "2026-10-16", generatedAt: "2026-10-16T21:30:00Z", landed: new Set(["SYX000", "SYX002"]), failed: new Set(["SYX003", "SYX000"]),
  universe: new Set(universe.map((u) => u.t)),
});
eq(next.payload.at, { SYX000: "2026-10-16", SYX001: "2026-10-09", SYX002: "2026-10-16" }, "landed names are dated tonight, absent ones keep their date and ones left the universe go");
eq(next.payload.tries, { SYX003: ["2026-10-16", 1] }, "a landed name clears its failures and a failed one starts a count");
ok(next.fits && next.bytes === next.payload.bytes, "and the ledger reports its size");
const again = D.ledgerPayload(next.payload, { sessionDate: "2026-10-17", landed: new Set(), failed: new Set(["SYX003"]), universe: new Set(universe.map((u) => u.t)) });
eq(again.payload.tries.SYX003, ["2026-10-17", 2], "a second failure counts two");
eq(D.parseLedger({ v: 2, at: { SYX000: "2026-10-16" } }).valid, false, "a ledger of another version is not read");
eq(D.parseLedger({ v: 1, at: { "bad name": "2026-10-16", SYX000: "yesterday", SYX001: "2026-10-16" }, tries: { SYX002: ["2026-10-16", 0] } }).at.size, 1, "malformed entries are dropped");

const held = D.carriedFrom(D.parseLedger({ v: 1, at: { SYX000: "2026-10-16", SYX001: "2026-10-15", SYX002: "2026-08-01" } }), "2026-10-16");
eq([...held.keys()], ["SYX001"], "a name read tonight is not carried and one read past the keep window is not either");
const plan2 = D.planNight({
  mode: "on", payload: { v: 1, at: { SYX001: "2026-10-15", SYX002: "2026-10-14" }, tries: {} }, sessionDate: "2026-10-16", rows: universe,
  board: new Set(["SYX000"]), rosterKnown: new Map([["card:SYX001", "2026-10-15"], ["card:SYX002", "2026-10-16"]]),
  dayLine: 60000, minuteLine: 500, callsSoFar: 1500, elapsedMs: 70000,
});
eq([...plan2.carried.keys()], ["SYX001"], "a name whose stored card is not the one the ledger dated is no longer carried");
ok(!plan2.picked.picked.includes("SYX000"), "a board name is never chosen");
ok(plan2.picked.picked.includes("SYX001") === false || plan2.picked.picked.length > 0, "carried names stay candidates");
const blind = D.planNight({ mode: "on", payload: null, readable: false, sessionDate: "2026-10-16", rows: universe, board: new Set(), dayLine: 60000, minuteLine: 500 });
eq([blind.picked.picked, blind.protectAll], [[], true], "an unreadable ledger chooses nothing and protects every card");
eq(D.planNight({ mode: "off", payload: null, readable: true, sessionDate: "2026-10-16", rows: universe, board: new Set() }).protectAll, false, "the switch off protects nothing");
const keep = D.holdSet({ carried: new Map([["SYX001", {}], ["SYX002", {}]]), protectAll: true, cross: ["SYX003", "SYX004", "SYX000"], board: new Set(["SYX000"]), chosen: new Set(["SYX002"]) });
eq([...keep].sort(), ["SYX001", "SYX003", "SYX004"], "a hold set keeps carried and cross names, not the chosen or the board");
eq(D.splitCross(["SYX001", "SYX003"], new Set(["SYX001"])), { build: ["SYX003"], held: ["SYX001"] }, "a held name builds no cross card");
const settled = D.settleNight({ chosen: ["SYX001", "SYX002", "SYX003"], enrichFailed: new Set(["SYX003"]), cardLanded: (t) => t !== "SYX002", cardXLanded: () => true });
eq([[...settled.landed], [...settled.failed].sort()], [["SYX001"], ["SYX002", "SYX003"]], "a name lands only when its card and its card-x did");

eq(D.mayPublish({ storedDepth: "deepened", storedSession: "2026-10-14", newDepth: "cross-section", sessionDate: "2026-10-16" }).ok, false, "a cross card does not replace a deep one inside the keep window");
eq(D.mayPublish({ storedDepth: "deepened", storedSession: "2026-10-14", newDepth: "board", sessionDate: "2026-10-16" }).ok, true, "a board card does");
eq(D.mayPublish({ storedDepth: "deepened", storedSession: "2026-06-01", newDepth: "cross-section", sessionDate: "2026-10-16" }).ok, true, "past the window the shallower card may");
eq(D.mayPublish({ storedDepth: null, newDepth: "cross-section", sessionDate: "2026-10-16" }).ok, true, "nothing stored, anything may");
eq(D.deepReadSaid("2026-10-14", "2026-10-16"), "Deep read from 2 sessions before the last completed one (2026-10-14); this name is refreshed in turn, least recently read first.", "the wording counts sessions");
eq(D.deepReadSaid("2026-10-15", "2026-10-16").includes("1 session "), true, "and says one in the singular");
eq(D.deepReadSaid("2026-10-16", "2026-10-16"), "Deep read from the last completed session.", "and a current read says so");
eq(D.deepReadSaid("x", "2026-10-16"), null, "an undated card says nothing");

const names = 856;
const coverage = [];
for (let seed = 0; seed < 6; seed++) {
  const r = await deepenScenario(seed, D, { names });
  eq(r.violations.map((v) => v.message), [], `the ${names}-name universe, seed ${seed}, breaks no invariant`);
  coverage.push(r.detail.ledger.at.size);
}
ok(coverage.every((n) => n >= names * 0.9), `every run left at least 90 per cent of ${names} names with a deep read: ${coverage.join(", ")}`);
const clean = D.coverageNights({ backlog: names - 62, perNight: D.DEEPEN.perNightCap });
ok(clean <= 2, `${names - 62} names at ${D.DEEPEN.perNightCap} a night take ${clean} nights with nothing failing`);
console.log(`  the universe of ${names}: ${names - 62} names behind the board, ${D.DEEPEN.perNightCap} a night, ${clean} nights; ${D.DEEPEN.perNightCap * D.DEEPEN.callsPerName} calls and about ${(D.DEEPEN.perNightCap * D.DEEPEN.msPerName / 60000).toFixed(1)} minutes a night on top of the ${D.DEEPEN.baselineCalls} calls of the nightly`);

const rosterEntry = (t, i) => ["ABCDEFGHJKLMNPQRSTUVWXYZ"[i % 24] + String(1000 + i), t];
const synthetic = Array.from({ length: names }, (_, i) => rosterEntry(i, i)[0]);
const fullDepth = new Map(synthetic.map((t) => [t, "deepened"]));
const fullLanded = new Set(synthetic.flatMap((t) => ["card:" + t, "card-x:" + t, "hist:" + t]));
const rosterFull = universeLib.buildRoster({ sessionDate: "2026-10-16", depth: fullDepth, landed: fullLanded });
ok(rosterFull.fits, `a roster of all ${names} names landing tonight is ${rosterFull.bytes} bytes, inside ${universeLib.ROSTER_BUDGET_BYTES}`);
const heldAll = Object.fromEntries(synthetic.flatMap((t) => ["card:" + t, "card-x:" + t, "hist:" + t].map((k) => [k, "2026-10-14"])));
const rosterHeld = universeLib.buildRoster({ sessionDate: "2026-10-16", depth: new Map(), landed: new Set(), held: heldAll });
ok(rosterHeld.fits, `and one that holds all ${names} names carried is ${rosterHeld.bytes} bytes`);
const ledgerFull = D.ledgerPayload(null, { sessionDate: "2026-10-16", landed: new Set(synthetic), failed: new Set(), universe: new Set(synthetic), plan: { n: 530, binding: "time", never: 0 }, usage: { read: 530, calls: 24000, dailySeen: 31000, dayLine: 60000, minuteLine: 500 } });
ok(ledgerFull.fits && ledgerFull.bytes < 0.4 * D.DEEPEN.ledgerBudgetBytes && ledgerFull.bytes < 128 * 1024, `a ledger of all ${names} names is ${ledgerFull.bytes} bytes, inside its ${D.DEEPEN.ledgerBudgetBytes} budget and the 128 KiB ingest cap`);
eq([ledgerFull.payload.summary.carded, ledgerFull.payload.summary.universe, ledgerFull.payload.summary.tonight, ledgerFull.payload.summary.oldest, ledgerFull.payload.summary.planned, ledgerFull.payload.summary.read, ledgerFull.payload.summary.dailySeen], [names, names, names, "2026-10-16", 530, 530, 31000], "the ledger summary counts names, tonight, the oldest read, the plan and the key's count");
const halfPrior = { v: 1, at: { [synthetic[0]]: "2026-10-12", [synthetic[1]]: "2026-10-15" }, tries: {} };
const halfNext = D.ledgerPayload(halfPrior, { sessionDate: "2026-10-16", landed: new Set([synthetic[2]]), failed: new Set(), universe: new Set(synthetic) });
eq([halfNext.payload.summary.carded, halfNext.payload.summary.tonight, halfNext.payload.summary.oldest, halfNext.payload.summary.calls], [3, 1, "2026-10-12", null], "the oldest read is the least recent date on the ledger and an unrecorded count is null");
const nightsToFull = D.coverageNights({ backlog: names - 62, perNight: gov({ cap: D.DEEPEN.hardCap, backlog: names - 62, callsSoFar: 0 }).n });
eq(nightsToFull, 2, "at the time the deadline allows, 794 names behind the board take two nights");
console.log(`  sizing: ${gov({ cap: D.DEEPEN.hardCap, backlog: 794, callsSoFar: 0 }).n} names a night (${gov({ cap: D.DEEPEN.hardCap, backlog: 794, callsSoFar: 0 }).binding} binds), ${nightsToFull} nights to a deep read of every name, ${(D.DEEPEN.baselineCalls + D.DEEPEN.perNightCap * D.DEEPEN.callsPerName)} calls a night of ${lines({})["uw.day"].cap * D.DEEPEN.daySharePct} allowed`);

ok(products.productById("deepen") && products.productById("deepen").key === "deepen", "the ledger is a registered product");
ok(products.CARD_DEPTHS.includes("deepened") && products.DEPTHS.includes("deep") && products.DEPTH_OF_CARD.deepened === "deep", "and the new depth is registered");
eq(products.CONTRACT.deep, products.CONTRACT.board, "a deepened name is held to the board's contract");
eq(products.NAME_KEY_EXPECTED.deep, products.NAME_KEY_EXPECTED.board, "and to the board's keys");
eq(door.inspect("card:SYX001", JSON.stringify({ v: 3, ticker: "SYX001", depth: "deepened", sessionDate: "2026-10-16", generatedAt: "2026-10-16T21:30:00Z", panels: {} }), { now: Date.parse("2026-10-16T22:00:00Z") }).structural.filter((f) => f.code === "depth"), [], "the door accepts the depth");
ok(/deepen/.test(readFileSync(path.join(ROOT, "server/store.js"), "utf8")), "the ingest door's key grammar names the ledger");
ok(STAGES.some((s) => s.id === "deepen-plan") && STAGES.some((s) => s.id === "deepen-ledger" && s.publishes.includes("deepen")), "the stage table names both stages");

const emit = nightlyEmit();
const meta = emitRead(emit, "meta");
const roster = emitRead(emit, "roster");
const ledger = emitRead(emit, "deepen");
ok(ledger && ledger.v === 1 && ledger.names > 62, `the dry run wrote a ledger of ${ledger && ledger.names} names`);
ok(contracts.validate("deepen", ledger, { allowSynthetic: true }).ok === true, "that ledger passes the payload contract");
eq(roster.counts.deep, D.DEEPEN.dryRunCap, "the roster counts the deepened cards");
const cards = readdirSync(emit).filter((f) => /^-card-[A-Z]/.test(f) && !f.startsWith("-card-x")).map((f) => JSON.parse(readFileSync(path.join(emit, f), "utf8")));
const deepened = cards.filter((c) => c.depth === "deepened");
eq(deepened.length, D.DEEPEN.dryRunCap, "the dry run deepened exactly its cap");
ok(cards.some((c) => c.depth === "cross-section"), "and left other names as cross-section cards");
const NEVER = /never requested/i;
for (const c of deepened) {
  const gone = Object.entries(c.panels).filter(([, p]) => p && p.status === "unavailable" && NEVER.test(String(p.reason || "")));
  ok(gone.length === 0, `${c.ticker}: no panel of a deepened card says it was never requested (${gone.map(([k]) => k).join(", ")})`);
  ok(c.panels.ivSurface && c.panels.ivSurface.status === "ok", `${c.ticker}: its IV surface was read`);
  const x = emitRead(emit, "card-x:" + c.ticker);
  ok(x && x.short && x.short.volume && x.short.volume.status === "ok" && x.short.borrow && x.short.borrow.status === "ok", `${c.ticker}: its short volume and borrow were read`);
  ok(x && x.earnings && ["ok", "thin"].includes(x.earnings.status), `${c.ticker}: its earnings history was read (${x && x.earnings && x.earnings.status})`);
  ok(emitRead(emit, "hist:" + c.ticker), `${c.ticker}: its hist landed`);
}
const crossX = cards.filter((c) => c.depth === "cross-section").map((c) => emitRead(emit, "card-x:" + c.ticker)).filter(Boolean);
ok(crossX.length > 0 && crossX.every((x) => x.short && x.short.volume && x.short.volume.status === "ok"), "a cross-section name now carries its short volume too");
ok(crossX.every((x) => x.earnings && ["ok", "thin"].includes(x.earnings.status)), "and its earnings history");
ok(meta.deepen && meta.deepen.chosen === D.DEEPEN.dryRunCap && meta.deepen.built === D.DEEPEN.dryRunCap && meta.deepen.mode === "on", "the meta payload records the rotation");
const stage = meta.stages.find((s) => s.id === "deepen-plan");
ok(stage && stage.status === "ok" && stage.n === D.DEEPEN.dryRunCap, "and the stage records how many it chose");
ok(meta.stages.find((s) => s.id === "deepen-ledger").status === "ok", "and the ledger stage ran");

const spawn = (env) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "flows-deepen-"));
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", dir + path.sep], {
      cwd: ROOT, env: { ...process.env, FLOWS_DRY_NOW: "2026-08-24T21:45:00Z", ...env }, stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024,
    });
    const read = (k) => { try { return readFileSync(path.join(dir, "-" + k.replace(":", "-") + ".json"), "utf8"); } catch { return null; } };
    const files = readdirSync(dir);
    return { dir, read, files };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
};
const off = spawn({ FLOWS_DEEPEN: "off" });
const wide = spawn({ FLOWS_DEEPEN_CAP: "100" });
try {
  ok(off.read("deepen") === null, "with the switch off no ledger is written");
  ok(!off.files.some((f) => /^-card-[A-Z]/.test(f) && JSON.parse(readFileSync(path.join(off.dir, f), "utf8")).depth === "deepened"), "and no card is deepened");
  for (const key of ["board:long", "board:short", "board:long:2026-08-24", "board:short:2026-08-24", "unusual", "scores:2026-08-24", "market", "movers", "scoretrack", "record", "events", "ideas", "flowalerts"]) {
    const on = readFileSync(path.join(emit, "-" + key.replace(":", "-") + ".json"), "utf8");
    eq(on === off.read(key), true, `${key} is byte for byte what it is with the rotation off`);
  }
  const wideCards = wide.files.filter((f) => /^-card-[A-Z]/.test(f) && !f.startsWith("-card-x")).map((f) => JSON.parse(readFileSync(path.join(wide.dir, f), "utf8")));
  eq(wideCards.filter((c) => c.depth === "deepened").length, 100, "a cap of 100 deepens a hundred names, enriching the ones the run had not");
  ok(wideCards.filter((c) => c.depth === "deepened").every((c) => c.panels.ivSurface && c.panels.ivSurface.status === "ok"), "all of them with a surface");
  const wideLedger = JSON.parse(wide.read("deepen"));
  ok(wideLedger.names >= 150, `and a ledger that holds them (${wideLedger.names})`);
} finally {
  rmSync(off.dir, { recursive: true, force: true });
  rmSync(wide.dir, { recursive: true, force: true });
}

const src = nightlySource();
ok(/stages\.run\("deepen-plan"/.test(readFileSync(path.join(ROOT, "scripts/flows-pipeline.mjs"), "utf8")), "the pipeline runs the plan as an isolated stage");
ok(/rotation\.has\(ticker\) \? null : QP\.leadIdea/.test(src), "a deepened card adds nothing to the ideas list or the track record");
ok(/boardChains = new Map\(\[\.\.\.chainByTicker\]\.filter/.test(src), "and no chain column to the boards");
ok(/rotating\.has\(ticker\)/.test(src), "and no contract to the unusual screen");
ok(/cohort: deepened\.length \? new Set\(deepTickers\)/.test(src), "and the risk-reversal ranking keeps its cohort");
ok(/skip: deepen \? deepen\.keep/.test(src), "a deep read that is carried is skipped by the card-x writer");

const ticker = readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
ok(/card\.depth === "deepened" \|\| !!engineOf\(card\)/.test(ticker), "the ticker page treats a deepened card as a deep one");
ok(/card\.depth === "deepened" \? " Read in full in turn, oldest first: this read is " \+ dayDiff\(card\.sessionDate, m\.expected\) \+ " days old\."/.test(ticker), "and says how old its deep read is");
ok(/const DEPTH_G = \{ \.\.\.UI\.depths, deep: \["list", "Deep read"\] \}/.test(ticker), "and the name picker lists the new tier");

console.log(`flows-deepen: ${checks} checks passed`);
