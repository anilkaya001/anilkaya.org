import { worldSpecs, runNullWorld, sharedBank, EXACT_BAR, FDR_BAR, lane } from "./alert-grid.mjs";

const DETECTOR_LANE = Object.freeze({
  deep: false, names: 100, nullSessions: 250, exactSessions: 200, powerSessions: 100, calibrationSessions: 24,
  bankSims: 8000, exactBankSims: 200000, salt: "fixed",
});

function setup(refMod, id, sessions) {
  const L = { ...DETECTOR_LANE };
  const spec = worldSpecs(L)[id];
  spec.sessions = sessions || spec.sessions;
  const bank = sharedBank(L);
  return { L, spec, bank, mods: { A: refMod, B: refMod } };
}

export function gridExactWorld(refMod) {
  const { L, spec, bank, mods } = setup(refMod, "exact");
  const r = runNullWorld(spec, L, { bank, mods, combos: [["A", "covered"], ["B", "covered"]] });
  const rows = Object.entries(r.results);
  const fdr = Math.max(...rows.map(([, v]) => v.bound.mean));
  const monotone = rows.every(([, v]) => v.monotone && v.unionEqualsClose);
  return {
    ok: fdr <= EXACT_BAR && monotone,
    note: `the exact world raises a false alert in ${rows.map(([k, v]) => `${k} ${v.bound.sessionsWithFalse}/${v.bound.n}`).join(", ")} sessions (bar ${EXACT_BAR}); running p ${monotone ? "only falls" : "rises again"}`,
    fdr, monotone,
  };
}

export function gridScaleCell(refMod) {
  const { L, spec, bank, mods } = setup(refMod, "het03", 250);
  const r = runNullWorld(spec, L, { bank, mods, combos: [["A", "covered"], ["B", "covered"]] });
  const rows = Object.entries(r.results);
  const upper = Math.max(...rows.map(([, v]) => v.bound.upper));
  return { ok: upper <= FDR_BAR, note: `scale error 0.3, covered cell: ${rows.map(([k, v]) => `${k} ${v.bound.sessionsWithFalse}/${v.bound.n} (upper ${v.bound.upper.toFixed(3)})`).join(", ")}`, upper };
}

export function gridGapWorld(refMod) {
  const { L, spec, bank, mods } = setup(refMod, "gap");
  const r = runNullWorld(spec, L, { bank, mods, combos: [["A", "covered"], ["B", "covered"]] });
  const rows = Object.entries(r.results);
  const upper = Math.max(...rows.map(([, v]) => v.bound.upper));
  return { ok: upper <= FDR_BAR, note: `overnight-gap world, covered cell: ${rows.map(([k, v]) => `${k} ${v.bound.sessionsWithFalse}/${v.bound.n} (upper ${v.bound.upper.toFixed(3)})`).join(", ")}`, upper };
}

export { lane };
