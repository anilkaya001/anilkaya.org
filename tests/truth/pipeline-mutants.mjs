import { loadMutated, targetPresent } from "./mutants.mjs";
import { simEnv } from "../pipeline-sim/index.mjs";
import { DETECTOR_OF } from "./pipeline-detectors.mjs";

export const PIPELINE_MUTANTS = [];

const VENDOR = "scripts/flows-nightly/vendor.mjs";
const CARD = "shared/flows-card.js";
const COVERAGE = "shared/flows-coverage.js";
const CONTRACTS = "shared/flows-contracts.js";
const METER = "shared/flows-call-meter.js";
const STAGES = "scripts/flows-nightly/stages.mjs";

function plant(id, title, target, transforms, detector, row = "B2") {
  if (PIPELINE_MUTANTS.some((m) => m.id === id)) throw new Error(`pipeline mutant ${id} registered twice`);
  if (!Object.hasOwn(DETECTOR_OF, detector)) throw new Error(`pipeline mutant ${id} names a detector that does not exist: ${detector}`);
  PIPELINE_MUTANTS.push(Object.freeze({ id, title, target, row, transforms, detector }));
}

plant("client-no-deadline", "the nightly's vendor client sets no per-call deadline", VENDOR,
  [["return long ? NIGHTLY_VENDOR.longTimeoutMs : NIGHTLY_VENDOR.timeoutMs;", "return 0;"]], "clientDetector");
plant("client-chain-page-gets-the-short-deadline", "an option-contracts page and the two-year bars are held to the 30 s deadline, not the 45 s", VENDOR,
  [['const long = op === "option-contracts" || (op === "ohlc-1d" && params && params.timeframe === "2Y");', "const long = false;"]], "clientDetector");
plant("client-timeouts-retried-forever", "a timed-out call is retried until the attempts run out instead of once", VENDOR,
  [["(timedOut && timeouts > timeoutRetries)", "(false)"]], "clientDetector");
plant("client-empty-answer-is-a-failure", "a clean empty 200 is thrown as an error", VENDOR,
  [["return Array.isArray(body) ? body : (body && body.data) || [];", "const rows = Array.isArray(body) ? body : (body && body.data) || []; if (!rows.length) throw new Error(path + \" -> empty\"); return rows;"]], "clientDetector");
plant("client-404-is-empty", "a 404 or 422 is read as an empty body and returned as no rows", VENDOR,
  [["if (!response.ok) {\n      noteWire();\n      throw httpFailure(path, response.status);\n    }", "if (!response.ok && false) {\n      noteWire();\n      throw httpFailure(path, response.status);\n    }"]], "clientDetector");
plant("client-429-exhaustion-carries-no-status", "a call that spent its attempts on 429s throws with no status", VENDOR,
  [["{ status: 429 }", "{}"]], "clientDetector");
plant("client-unreadable-body-not-metered", "an attempt whose body could not be parsed is left out of the meter", VENDOR,
  [['wire.record({ path, ms: Date.now() - wireStarted, kind: isTimeout(error) ? "timeout" : "network" });\n      throw error;', "throw error;"]], "clientDetector");
plant("client-429-not-metered", "a refused attempt is left out of the meter", VENDOR,
  [["if (response.status === 429) {\n      noteWire();", "if (response.status === 429) {"]], "clientDetector");
plant("client-failure-kind-collapsed", "readFailure answers network for a timeout and for an unreadable body", VENDOR,
  [['const kind = status !== null ? "http" : isTimeout(error) ? "timeout" : error && error.name === "SyntaxError" ? "parse" : "network";', 'const kind = status !== null ? "http" : "network";']], "clientDetector");

plant("card-failure-carries-no-code", "a failed read makes the panel unavailable without the code failed", CARD,
  [['card.panels[key] = { ...panel, status: "unavailable", code: "failed", reason: failedRead(f) };', 'card.panels[key] = { ...panel, status: "unavailable", reason: failedRead(f) };']], "cardDetector");
plant("card-healthy-card-gets-an-empty-failure-list", "every card carries a readFailures key, empty when nothing failed", CARD,
  [["if (!list.length || !card || !card.panels) return card;", "if (!card || !card.panels) return card;"]], "cardDetector");
plant("card-darkpool-failure-marks-the-wrong-panel", "a failed darkpool read is attached to the open-interest panel", CARD,
  [['darkpool: Object.freeze(["darkpool"]),', 'darkpool: Object.freeze(["oiDeltas"]),']], "cardDetector");
plant("card-failure-reason-drops-the-status", "the failure sentence no longer says which HTTP status the vendor answered", CARD,
  [["`answered HTTP ${status}`", "`answered ${status}`"]], "cardDetector");
plant("card-timeout-reads-as-unreachable", "the failure sentence calls a timeout an unreachable vendor", CARD,
  [['failure && failure.kind === "timeout" ? "timed out"', 'failure && failure.kind === "timeout" ? "could not be reached"']], "cardDetector");

plant("coverage-stale-comparison-reversed", "a card from a later session than expected is stale and an older one is current", COVERAGE,
  [["if (session < expected) return [STATE.stale", "if (session > expected) return [STATE.stale"]], "coverageDetector");
plant("coverage-complete-ignores-failures", "the report is complete while a name is missing a key", COVERAGE,
  [["const complete = conservation.ok && globalsOk && failing.length === 0 && ", "const complete = conservation.ok && globalsOk && "]], "coverageDetector");
plant("coverage-cut-listing-reads-as-failed", "a key missing from a truncated listing is a failure instead of unknown", COVERAGE,
  [['return truncated ? [STATE.pending, "the listing was cut before this key"] : [STATE.failed, "not stored"];', 'return [STATE.failed, "not stored"];']], "coverageDetector");
plant("coverage-hist-not-counted", "the hist column's states are left out of the counts", COVERAGE,
  [["counts[product][stateName(entry[0])]++;", 'if (product !== "hist") counts[product][stateName(entry[0])]++;']], "coverageDetector");
plant("coverage-unreadable-listing-reads-as-ok", "a listing that could not be read leaves every name ok", COVERAGE,
  [['[STATE.pending, "the store listing could not be read"]', "[STATE.ok, null]"]], "coverageDetector");
plant("coverage-session-skew-unchecked", "a card-x of another session than its card is never compared", COVERAGE,
  [["if (sessions[kind] !== sessions.card) predicates.P2.failing++;", "if (false) predicates.P2.failing++;"]], "coverageDetector");
plant("coverage-writes-to-its-inputs", "the verifier writes into the listing it is given", COVERAGE,
  [["const truncated = !!(listing && listing.truncated);", "const truncated = !!(listing && listing.truncated);\n  if (listing) listing.read = true;"]], "coverageDetector");
plant("coverage-no-expected-session-passes", "with no expected session every key is ok", COVERAGE,
  [['  if (expected === null) return [STATE.pending, "no expected session could be worked out"];\n', ""]], "coverageDetector");
plant("coverage-stale-before-failed", "stale names are listed ahead of failed ones", COVERAGE,
  [["const SEVERITY = Object.freeze({ [STATE.failed]: 0, [STATE.stale]: 1,", "const SEVERITY = Object.freeze({ [STATE.failed]: 1, [STATE.stale]: 0,"]], "coverageDetector");
plant("coverage-roster-skew-unchecked", "a roster that dates a card differently is never compared", COVERAGE,
  [["if (rosterSessions[t] !== sessions.card) predicates.P4.failing++;", "if (false) predicates.P4.failing++;"]], "coverageDetector");

plant("contracts-synthetic-names-allowed", "a SYN### name passes outside a test", CONTRACTS,
  [["const allowSynthetic = ctx.allowSynthetic === true;", "const allowSynthetic = true;"]], "contractsDetector");
plant("contracts-canonical-keeps-the-stamps", "the canonical form keeps readAt and generatedAt", CONTRACTS,
  [["if (!drop.has(k)) out[k] = sortKeys(value[k], drop);", "out[k] = sortKeys(value[k], drop);"]], "contractsDetector");
plant("contracts-canonical-keeps-key-order", "the canonical form follows the order the keys arrived in", CONTRACTS,
  [["for (const k of Object.keys(value).sort()) if", "for (const k of Object.keys(value)) if"]], "contractsDetector");
plant("contracts-session-not-checked", "a card with no real session date is accepted", CONTRACTS,
  [['if (!isDay(payload.sessionDate)) structural.push({ code: CODES.badSession, path: "sessionDate" });\n', ""]], "contractsDetector");
plant("contracts-infinite-numbers-pass", "a number that is not finite passes", CONTRACTS,
  [["if (!Number.isFinite(node) && !found.nonFinite) found.nonFinite = here();", ""]], "contractsDetector");
plant("contracts-card-for-another-ticker-passes", "a card whose ticker is not its key's passes", CONTRACTS,
  [['if (payload.ticker !== t) structural.push({ code: CODES.tickerMismatch, path: "ticker" });\n  if (!Number.isInteger(payload.v)', 'if (!Number.isInteger(payload.v)']], "contractsDetector");
plant("contracts-fixture-flag-ignored", "a payload stamped fixture:true passes", CONTRACTS,
  [["(payload.fixture === true || (t !== null && SYNTHETIC_GRAMMAR.test(t)))", "((t !== null && SYNTHETIC_GRAMMAR.test(t)))"]], "contractsDetector");

plant("meter-template-matched-before-literal", "/api/darkpool/recent is filed under the darkpool template", METER,
  [["})).sort((a, b) => a.wild - b.wild || a.order - b.order);", "}));"]], "meterDetector");
plant("meter-429-filed-as-4xx", "a refusal is counted with the other client errors", METER,
  [['  if (s === 429) return "429";\n', ""]], "meterDetector");
plant("meter-unknown-bytes-poison-the-total", "a call with no declared length makes the byte total NaN", METER,
  [["const size = finite(bytes) === null ? 0 : Math.round(finite(bytes));", "const size = Math.round(Number(bytes));"]], "meterDetector");
plant("meter-every-call-is-bad", "a good call is counted among the failures", METER,
  [['if (cls !== "2xx") total.bad++;', "total.bad++;"]], "meterDetector");
plant("meter-operations-uncapped", "the meter keeps a row for every operation it is ever shown", METER,
  [["if (id !== OTHER_OP && ops.size >= maxOps) return entry(OTHER_OP);", ""]], "meterDetector");

plant("stages-wire-is-the-run-total", "a stage reports the run's wire time to date, not its own", STAGES,
  [["const used = wireDelta(frame.wire, wire());", "const used = wireDelta(null, wire());"]], "stagesDetector");
plant("stages-wire-on-an-idle-stage", "a stage that made no call still carries a wire field", STAGES,
  [["if (used.n > 0) record.wire", "if (true) record.wire"]], "stagesDetector");

const baselines = new Map();

export async function runPipelineKillMatrix(selected = PIPELINE_MUTANTS) {
  simEnv();
  const rows = [];
  for (const m of selected) {
    if (!targetPresent(m.target)) { rows.push({ id: m.id, armed: false, why: `target ${m.target} is not in the tree` }); continue; }
    const detect = DETECTOR_OF[m.detector];
    const baseKey = m.target + "|" + m.detector;
    if (!baselines.has(baseKey)) baselines.set(baseKey, await detect(await loadMutated(m.target)));
    const baseline = baselines.get(baseKey);
    const mutated = await detect(await loadMutated(m.target, m.transforms));
    rows.push({ id: m.id, title: m.title, row: m.row, armed: true, baselineOk: baseline.ok, baselineNote: baseline.note, killed: baseline.ok && !mutated.ok, mutatedNote: mutated.note });
  }
  return rows;
}
