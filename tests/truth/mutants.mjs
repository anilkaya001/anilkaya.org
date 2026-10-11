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

export async function runKillMatrix(selected = MUTANTS) {
  const rows = [];
  const baselines = new Map();
  for (const m of selected) {
    const state = mutantState(m);
    if (!state.armed) { rows.push({ id: m.id, row: m.row, armed: false, why: state.why }); continue; }
    const detect = detectors[m.detector];
    if (typeof detect !== "function") throw new Error(`mutant ${m.id} names a detector that does not exist: ${m.detector}`);
    const key = m.target + "|" + m.detector;
    if (!baselines.has(key)) baselines.set(key, detect(await loadMutated(m.target)));
    const baseline = baselines.get(key);
    const mutated = detect(await loadMutated(m.target, m.transforms));
    rows.push({ id: m.id, row: m.row, armed: true, baselineOk: baseline.ok, baselineNote: baseline.note, killed: baseline.ok && !mutated.ok, mutatedNote: mutated.note });
  }
  return rows;
}
