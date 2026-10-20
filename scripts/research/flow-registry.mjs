import { readFileSync } from "node:fs";
import { canonical, sha256Hex, TARGET_BY_ID, TARGETS_VERSION, targetsHash, THRESHOLD_SOURCES, REFUSED_SOURCES } from "../../shared/flows-targets.js";

export const REGISTRY_URL = new URL("./flow-registry.json", import.meta.url);

export const PROTOCOL = Object.freeze({
  returnStartsAt: "flag-publication",
  fit: "past-only",
  universe: "as-of-date",
  pooling: "never-live-with-reconstruction",
  evaluationSample: "all-name-days-of-the-universe-as-of-each-date",
});

export const SIGNAL_IDS = Object.freeze(["S1", "S2", "S3", "S4", "S4p", "S5", "S6", "S7", "S8", "S10"]);
export const HORIZON_IDS = Object.freeze(["close", "next", "h5"]);
export const SIGNED_SIGNALS = Object.freeze(["S3", "S5"]);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const OUTCOME_KEY_RE = /outcome|result|p_?value|estimate|effect|hit|score|lift|auc|sharpe/i;

export function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY_URL, "utf8"));
}

export function definitionOf(reg, test) {
  const signal = reg.signals.find((s) => s.id === test.signal) || null;
  const horizon = reg.horizons.find((h) => h.id === test.horizon) || null;
  return { signal, horizon, test, protocol: reg.protocol, targets: reg.targets };
}

export const definitionHash = (reg, test) => sha256Hex(canonical(definitionOf(reg, test)));

function outcomeKeys(value, path, found) {
  if (Array.isArray(value)) value.forEach((v, i) => outcomeKeys(v, `${path}[${i}]`, found));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k !== "outcomesSeen" && OUTCOME_KEY_RE.test(k)) found.push(`${path}.${k}`);
      outcomeKeys(v, `${path}.${k}`, found);
    }
  }
}

export function validateRegistry(reg) {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  if (!reg || typeof reg !== "object") return ["the registry is an object"];
  if (reg.version !== 1) bad("version is 1");
  if (typeof reg.registeredAt !== "string" || !DAY_RE.test(reg.registeredAt)) bad("registeredAt is a day");
  if (reg.outcomesSeen !== false) bad("outcomesSeen is false: the registry is committed before any outcome is seen");
  const leaks = [];
  outcomeKeys(reg, "registry", leaks);
  for (const k of leaks) bad(`${k}: a registry holds definitions, never results`);

  if (!reg.targets || reg.targets.version !== TARGETS_VERSION || reg.targets.hash !== targetsHash()) {
    bad("targets: the registry is pinned to a table of F-11 that is not the current one; a new table is a new registry");
  }

  const protocol = reg.protocol || {};
  for (const [k, v] of Object.entries(PROTOCOL)) if (protocol[k] !== v) bad(`protocol.${k} is ${JSON.stringify(v)}`);
  for (const k of Object.keys(protocol)) if (!Object.hasOwn(PROTOCOL, k)) bad(`protocol.${k} is not a rule of the protocol`);

  const signals = Array.isArray(reg.signals) ? reg.signals : [];
  if (signals.map((s) => s && s.id).join() !== SIGNAL_IDS.join()) bad(`signals are ${SIGNAL_IDS.join(", ")} in order`);
  const seenIds = new Set();
  for (const s of signals) {
    if (!s || typeof s.id !== "string") { bad("a signal has an id"); continue; }
    for (const id of [s.id, s.id.replace(/^(S\d+)(p?)$/, "$1$2r")]) {
      if (seenIds.has(id)) bad(`${id}: an id is used twice`);
      seenIds.add(id);
    }
    if (s.reconstructible !== true) bad(`${s.id}: every live signal has its reconstruction`);
    if (!["own", "benchmark"].includes(s.kind)) bad(`${s.id}: kind is own or benchmark`);
    if (s.direction !== (SIGNED_SIGNALS.includes(s.id) ? "signed" : "unsigned")) bad(`${s.id}: direction`);
    if (typeof s.input !== "string" || s.input.length < 10) bad(`${s.id}: an input is stated`);
  }
  if (signals.filter((s) => s && s.kind === "benchmark").map((s) => s.id).join() !== "S7,S8") bad("the benchmarks are S7 and S8");

  const horizons = Array.isArray(reg.horizons) ? reg.horizons : [];
  if (horizons.map((h) => h && h.id).join() !== HORIZON_IDS.join()) bad(`horizons are ${HORIZON_IDS.join(", ")} in order`);
  for (const h of horizons) {
    if (!h || ![1, 5].includes(h.h)) bad(`${h && h.id}: h is a horizon of F-11 (1 or 5)`);
    if (h && h.id === "close" && h.start !== "flag publication") bad("close: the window starts at the flag's publication");
    if (h && h.id !== "close" && h.start !== "issue close") bad(`${h.id}: the window starts at the issue close`);
  }

  const tests = Array.isArray(reg.tests) ? reg.tests : [];
  if (tests.length !== SIGNAL_IDS.length * HORIZON_IDS.length) bad(`${SIGNAL_IDS.length * HORIZON_IDS.length} tests, one per signal and horizon`);
  const testIds = new Set();
  for (const t of tests) {
    const id = t && t.id;
    if (testIds.has(id)) bad(`${id}: a test id is used twice`);
    testIds.add(id);
    if (!t || id !== `${t.signal}.${t.horizon}`) { bad(`${id}: a test id is signal.horizon`); continue; }
    const signal = signals.find((s) => s && s.id === t.signal);
    const horizon = horizons.find((h) => h && h.id === t.horizon);
    if (!signal || !horizon) { bad(`${id}: names a signal and a horizon of the registry`); continue; }
    if (t.k !== 3) bad(`${id}: the registered multiple is 3`);
    const want = signal.direction === "signed" ? ["down", "up"] : ["both"];
    if (Object.keys(t.target || {}).sort().join() !== want.join()) bad(`${id}: a ${signal.direction} signal has the targets ${want.join(", ")}`);
    for (const [side, target] of Object.entries(t.target || {})) {
      const row = TARGET_BY_ID[target] || null;
      if (!row) { bad(`${id}: ${target} is not a target of F-11`); continue; }
      if (row.kind !== "event" || row.family !== "sigma-ref") bad(`${id}: ${target} is a typical-day-scale event of F-11`);
      if (!Object.hasOwn(THRESHOLD_SOURCES, row.source) || Object.hasOwn(REFUSED_SOURCES, row.source)) bad(`${id}: ${target} has a refused or model-owned scale`);
      const exact = `move.k3.h${horizon.h}${side === "up" ? ".up" : side === "down" ? ".dn" : ""}`;
      if (target !== exact) bad(`${id}: the ${side} target of ${horizon.id} is ${exact}`);
    }
    const series = t.series || {};
    if (series.live !== id || series.reconstructed !== `${t.signal}r.${t.horizon}`) bad(`${id}: its live series is ${id} and its reconstruction ${t.signal}r.${t.horizon}`);
    if (series.live === series.reconstructed) bad(`${id}: the live series is never its reconstruction`);
  }

  const m = reg.multiplicity || {};
  if (m.procedure !== "benjamini-hochberg" || m.q !== 0.05 || m.size !== tests.length || m.family !== "all-tests-per-regime") bad("multiplicity: Benjamini-Hochberg at 0.05 across all the tests, once per regime");
  const p = m.primary || {};
  if (p.test !== "S1.next" || p.procedure !== "holm" || p.alpha !== 0.05 || (p.family || []).join() !== "S1.close,S1.next,S1.h5") bad("multiplicity.primary: S1 at the next close, by Holm across S1's three horizons at 0.05");
  if (!testIds.has(p.test)) bad("multiplicity.primary names a registered test");
  if (!reg.trials || reg.trials.logged !== true) bad("trials: every trial is logged");
  return problems;
}
