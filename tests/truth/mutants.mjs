import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as detectors from "./detectors.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]+)\2/g;

export function occurrences(text, needle) {
  if (!needle) return 0;
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

export function applyTransforms(source, transforms, label = "source") {
  let out = source;
  for (const [from, to] of transforms) {
    const n = occurrences(out, from);
    if (n !== 1) throw new Error(`mutant did not apply to ${label}: ${JSON.stringify(from.slice(0, 80))} matched ${n} times`);
    out = out.replace(from, () => to);
  }
  return out;
}

export function absolutise(source, dir) {
  return source.replace(SPECIFIER, (m, head, quote, spec) => head + quote + pathToFileURL(path.resolve(dir, spec)).href + quote);
}

export async function loadMutated(rel, transforms = []) {
  const abs = path.join(ROOT, rel);
  const original = readFileSync(abs, "utf8");
  const mutated = applyTransforms(original, transforms, rel);
  const body = absolutise(mutated, path.dirname(abs));
  const url = "data:text/javascript;base64," + Buffer.from(body).toString("base64");
  return import(url);
}

export function targetPresent(rel) {
  return existsSync(path.join(ROOT, rel));
}

export const MUTANTS = [];

export function register(mutant) {
  const required = ["id", "title", "target", "row", "transforms", "detector"];
  for (const k of required) if (!(k in mutant)) throw new Error(`mutant ${mutant.id || "?"} lacks ${k}`);
  if (MUTANTS.some((m) => m.id === mutant.id)) throw new Error(`mutant ${mutant.id} registered twice`);
  MUTANTS.push(Object.freeze({ ...mutant }));
  return mutant;
}

export function mutantState(m) {
  if (m.pending) return { armed: false, why: m.pending };
  if (!targetPresent(m.target)) return { armed: false, why: `target ${m.target} is not in the tree` };
  return { armed: true, why: null };
}

register({
  id: "garch-recursion-on-r-t",
  title: "the GARCH variance recursion reads r_t where it must read r_(t-1)",
  target: "shared/flows-garch.js",
  row: "F-13",
  transforms: [["masked && masked[t - 1] ? s2 : e[t - 1] * e[t - 1]", "masked && masked[t - 1] ? s2 : e[t] * e[t]"]],
  detector: "garchRecovery",
});

register({
  id: "winsorising-on-the-simulator",
  title: "the simulator winsorises its own shocks",
  target: "tests/truth/worlds.mjs",
  row: "F-13",
  transforms: [["let e = s * zt;", "let e = Math.sign(s * zt) * Math.min(Math.abs(s * zt), 4 * Math.sqrt(p.variance));"]],
  detector: "generatorTail",
});

register({
  id: "firewall-as-a-filter",
  title: "the as-of firewall drops a late record where it must throw",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["throw new LookAheadError(`record known at ${row.knownAt} read as of ${asOf}`);", "continue;"]],
  detector: "firewall",
});

register({
  id: "crps-without-the-fair-correction",
  title: "the ensemble CRPS divides the spread term by 2 m^2",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["b / (2 * m * (m - 1))", "b / (2 * m * m)"]],
  detector: "crpsFair",
});

register({
  id: "pav-ties-not-pooled",
  title: "the reliability fit gives rows with one forecast different fitted values",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["while (j < idx.length && p[idx[j]] === p[idx[i]]) { sum += y[idx[j]]; j++; }", "while (j < i + 1) { sum += y[idx[j]]; j++; }"]],
  detector: "pavTies",
});

register({
  id: "e-process-product-over-names",
  title: "the calibration e-process bets name by name inside one session",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["return [{ m, pbar }];", "return Array.from(day.p, (p, i) => ({ m: day.y[i] - p, pbar: p }));"]],
  detector: "eProcessSize",
});

register({
  id: "fixed-half-bet-clip",
  title: "the calibration e-process clips every bet at one half",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["return { up: 0.5 / (pbar * (1 + delta)), down: 0.5 / (1 - pbar + delta * pbar) };", "return { up: 0.5, down: 0.5 };"]],
  detector: "eProcessPower",
});

register({
  id: "missing-hac",
  title: "the Diebold-Mariano variance leaves out the overlap autocovariances",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["for (let k = 1; k < h; k++) {", "for (let k = 1; k < 1; k++) {"]],
  detector: "dmSize",
});

register({
  id: "runner-accepts-a-well-specified-cell",
  title: "the runner lets a well-specified cell accept a result",
  target: "tests/truth/runner.mjs",
  row: "F-13",
  transforms: [["if (result.mode !== MODES.MIS) throw new NotJudged(`cell ${result.id} is ${result.mode}; only a ${MODES.MIS} cell can accept a result`);", ""]],
  detector: "runnerRefusesWellSpecified",
});

register({
  id: "open-interest-known-at-the-session-it-describes",
  title: "open interest is stamped known at the close of the session it describes, not when it is published",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["export const oiPublishedAt = (day) => `${nextBusinessDay(day)}T10:30:00Z`;", "export const oiPublishedAt = (day) => `${day}T21:00:00Z`;"]],
  detector: "oiLag",
});

register({
  id: "issue-view-at-close-plus-2h",
  title: "the forecast is issued from the view two hours after the close",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["export const issueInstant = (day) => sessionClose(day);", "export const issueInstant = (day) => `${day}T23:00:00Z`;"]],
  detector: "afterHours",
});

register({
  id: "trial-count-of-one",
  title: "the deflated Sharpe ratio is told one trial was run",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["trials: registry.count(),", "trials: 1,"]],
  detector: "trialCount",
});

register({
  id: "hawkes-compensator-sign",
  title: "the Hawkes compensator adds the excitation with the wrong sign",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["out[i] = mu * dt + s * (1 - decay);", "out[i] = mu * dt + s * (decay - 1);"]],
  detector: "hawkesCompensator",
});

register({
  id: "flow-null-omits-the-day-effect",
  title: "the Alert tier's flow null has a fixed level for the name and no day effect",
  target: "tests/truth/reference.mjs",
  row: "F-13",
  transforms: [["const withDayEffect = true;", "const withDayEffect = false;"]],
  detector: "flowNullDayEffect",
});

const refEdit = (id, title, transforms, detector, extra = {}) => register({ id, title, target: "tests/truth/reference.mjs", row: "F-13", transforms, detector, ...extra });

refEdit("gaussian-jump-threshold", "the jump flag uses one Gaussian threshold of 5.47 for every name", [["return buckets.map((b) => gumbelLine(placebo[b]));", "return buckets.map(() => 5.47);"]], "jumpFlagNull");

refEdit("scale-blind-pooled-threshold", "the jump statistic divides every name's move by the pooled scale", [["const scaleOf = (session, i) => session.sigmaForecast[i];", "const scaleOf = (session) => session.sigmaForecast.reduce((a, b) => a + b, 0) / session.names;"]], "jumpFlagNull");

refEdit("bh-with-m-equal-rejections", "the Benjamini-Hochberg line divides by the number of rejections instead of the number of tests", [["return stepUp(p, (k) => (k * alpha) / m);", "return stepUp(p, (k) => (k * alpha) / k);"]], "bhCompleteNull");

refEdit("by-line-without-harmonic", "the Benjamini-Yekutieli line uses m where it must use m times the harmonic number", [["return stepUp(p, (k) => (k * alpha) / (m * harmonic(m)));", "return stepUp(p, (k) => (k * alpha) / m);"]], "byCompleteNull");

refEdit("per-frame-bh-union-as-session-fdr", "the session's alert set is the union of per-minute snapshot BH sets, captioned as the session FDR", [["const last = frames[frames.length - 1].running;\n  return byReject(last, alpha);", "const out = new Set();\n  for (const f of frames) for (const i of bhReject(f.snapshot, alpha)) out.add(i);\n  return [...out];"]], "sessionFdr");

refEdit("e-process-without-the-per-increment-transform", "the e-process takes heavy-tailed increments raw instead of through their own predictive law", [["const useTransform = true;", "const useTransform = false;"]], "eProcessRepair");

refEdit("scale-not-inflated", "the e-process does not inflate the scale by the measured scale error", [["const kappa = Math.exp(c * sHat);", "const kappa = 1;"]], "eProcessInflation");

register({
  id: "w1d-drops-the-factor",
  title: "the dependent daily world draws its names independently",
  target: "tests/truth/worlds.mjs",
  row: "F-13",
  transforms: [["const shared = a * factor;", "const shared = 0;"]],
  detector: "dependentWorldCoverage",
});

register({
  id: "sigma-ref-includes-earnings",
  title: "the reference scale includes earnings sessions",
  target: "shared/flows-evt.js",
  row: "F-13",
  transforms: [],
  detector: null,
  pending: "arms with F-21, which adds scheduled events (W2) and the reference-scale leaf",
});

register({
  id: "bootstrap-holds-the-variance-target-fixed",
  title: "the parametric bootstrap holds the variance target fixed in the refit",
  target: "shared/flows-garch-interval.js",
  row: "F-13",
  transforms: [],
  detector: null,
  pending: "arms with F-22, which adds the GARCH interval",
});

export const LAUNCH_MUTANTS = Object.freeze([
  "garch-recursion-on-r-t", "winsorising-on-the-simulator", "sigma-ref-includes-earnings", "missing-hac", "bh-with-m-equal-rejections",
  "pav-ties-not-pooled", "e-process-product-over-names", "fixed-half-bet-clip", "crps-without-the-fair-correction", "hawkes-compensator-sign",
  "firewall-as-a-filter", "open-interest-known-at-the-session-it-describes", "trial-count-of-one", "issue-view-at-close-plus-2h",
  "by-line-without-harmonic", "per-frame-bh-union-as-session-fdr", "scale-not-inflated", "bootstrap-holds-the-variance-target-fixed",
]);

export const PLANTED_WRONG_DETECTORS = Object.freeze([
  "gaussian-jump-threshold", "per-frame-bh-union-as-session-fdr", "e-process-without-the-per-increment-transform",
  "scale-blind-pooled-threshold", "flow-null-omits-the-day-effect",
]);

const baselines = new Map();

export async function baselineResult(detector, target) {
  const key = target + "|" + detector;
  if (!baselines.has(key)) {
    const detect = detectors[detector];
    if (typeof detect !== "function") throw new Error(`no detector named ${detector}`);
    baselines.set(key, detect(await loadMutated(target)));
  }
  return baselines.get(key);
}

export async function runKillMatrix(selected = MUTANTS) {
  const rows = [];
  for (const m of selected) {
    const state = mutantState(m);
    if (!state.armed) { rows.push({ id: m.id, row: m.row, armed: false, why: state.why }); continue; }
    const detect = detectors[m.detector];
    if (typeof detect !== "function") throw new Error(`mutant ${m.id} names a detector that does not exist: ${m.detector}`);
    const baseline = await baselineResult(m.detector, m.target);
    const mutated = detect(await loadMutated(m.target, m.transforms));
    rows.push({ id: m.id, row: m.row, armed: true, baselineOk: baseline.ok, baselineNote: baseline.note, killed: baseline.ok && !mutated.ok, mutatedNote: mutated.note });
  }
  return rows;
}
