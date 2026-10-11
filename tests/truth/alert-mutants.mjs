import { loadMutated, targetPresent } from "./mutants.mjs";
import * as detectors from "./alert-detectors.mjs";

const TARGET = "tests/truth/alert-reference.mjs";

export const GRID_MUTANTS = [];

function plant(id, title, transforms, detector) {
  if (GRID_MUTANTS.some((m) => m.id === id)) throw new Error(`grid mutant ${id} registered twice`);
  GRID_MUTANTS.push(Object.freeze({ id, title, target: TARGET, row: "F-14", transforms, detector }));
}

plant("grid-running-p-can-rise", "the running p is the current p, so it can rise again and the union over the session is no longer the BY set at the close",
  [["const runningMaximum = true;", "const runningMaximum = false;"]], "gridExactWorld");

plant("grid-by-line-without-harmonic", "the Alert set uses the BY line with m where it must use m times the harmonic number",
  [["return stepUpSet(p, (k) => (k * q) / (n * harmonic(n)), n);", "return stepUpSet(p, (k) => (k * q) / n, n);"]], "gridExactWorld");

plant("grid-snapshot-bh-union-as-session-fdr", "the session's Alert set is the union of per-frame BH sets of the current p, presented as a session FDR",
  [["for (const f of frames) for (const i of byAlertSet(f.running, q, n)) out.add(i);\n  return out;\n}\n\nexport function screenSets", "for (const f of frames) for (const i of bhAlertSet(f.snapshot, q, n)) out.add(i);\n  return out;\n}\n\nexport function screenSets"]], "gridExactWorld");

plant("grid-scale-not-inflated", "the mixture path divides the scale by 1 where it must divide by e to the c times the measured scale error",
  [["const kappa = Math.exp(cOf(sHat) * sHat);", "const kappa = 1;"]], "gridScaleCell");

plant("grid-transform-on-the-cumulative", "the predictive-law transform is applied to the cumulative move where it must be applied to each increment, the overnight gap included",
  [["const perIncrement = true;", "const perIncrement = false;"]], "gridGapWorld");

const baselines = new Map();

export async function runGridKillMatrix(selected = GRID_MUTANTS) {
  const rows = [];
  for (const m of selected) {
    if (!targetPresent(m.target)) { rows.push({ id: m.id, armed: false, why: `target ${m.target} is not in the tree` }); continue; }
    const detect = detectors[m.detector];
    if (typeof detect !== "function") throw new Error(`grid mutant ${m.id} names a detector that does not exist: ${m.detector}`);
    if (!baselines.has(m.detector)) baselines.set(m.detector, detect(await loadMutated(m.target)));
    const baseline = baselines.get(m.detector);
    const mutated = detect(await loadMutated(m.target, m.transforms));
    rows.push({ id: m.id, title: m.title, armed: true, baselineOk: baseline.ok, baselineNote: baseline.note, killed: baseline.ok && !mutated.ok, mutatedNote: mutated.note });
  }
  return rows;
}
