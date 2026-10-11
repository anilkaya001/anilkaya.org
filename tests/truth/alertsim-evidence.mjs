import { clopperUpper, POWER_CELLS, cellKey, decide } from "./alert-grid.mjs";

export const ALERTSIM4 = Object.freeze({
  source: "r2/q1/alertsim4.txt",
  nullSessions: 100,
  plantedSessions: 30,
  names: 670,
  completeNull: Object.freeze([
    Object.freeze({ id: "null law = truth (nu4,s.2)", falsePct: 0, covered: true }),
    Object.freeze({ id: "conservative cell (nu4,s.3)", falsePct: 0, covered: true }),
    Object.freeze({ id: "more conservative (nu3,s.3)", falsePct: 0, covered: true }),
  ]),
  heterogeneous: Object.freeze([
    Object.freeze({ id: "hetero, conservative cell (nu4,s.3)", falsePct: 2, covered: false }),
    Object.freeze({ id: "hetero, more conservative (nu3,s.3)", falsePct: 1, covered: true }),
  ]),
  power: Object.freeze({
    J3D1: 0.932, J4D1: 0.996, J5D1: 1, J6D1: 1, J8D1: 1,
    J3D15: 0.463, J4D15: 0.976, J5D15: 0.999, J6D15: 1, J8D15: 1,
    J3D60: 0, J4D60: 0.08, J5D60: 0.855, J6D60: 0.955, J8D60: 1,
  }),
});

export const ALERTSIM3_VILLE_BAND = Object.freeze({
  source: "r2/q1/alertsim3.txt, Ville p = 1/max E with a scale band, without the per-increment transform (not construction B)",
  nullSessions: 150,
  completeNull: Object.freeze([
    Object.freeze({ id: "Ville, scale band c=1.0", falsePct: 25, covered: true }),
    Object.freeze({ id: "Ville, scale band c=1.65", falsePct: 18, covered: true }),
    Object.freeze({ id: "Ville, scale band c=2.33", falsePct: 9, covered: true }),
  ]),
});

function coveredCells(rows, n) {
  return rows.filter((r) => r.covered).map((r) => ({ id: r.id, upper: clopperUpper(Math.round((r.falsePct / 100) * n), n) }));
}

export function weightedFromTable(power) {
  let w = 0, t = 0;
  for (const c of POWER_CELLS) { w += c.weight * power[cellKey(c)]; t += c.weight; }
  return w / t;
}

export function alertsim4Tables() {
  const e = ALERTSIM4;
  return {
    A: { covered: coveredCells([...e.completeNull, ...e.heterogeneous], e.nullSessions), weightedPower: weightedFromTable(e.power), perSession: null },
  };
}

export function alertsimComparisonTables() {
  const a = alertsim4Tables();
  const v = ALERTSIM3_VILLE_BAND;
  return { ...a, "Ville band": { covered: coveredCells(v.completeNull, v.nullSessions), weightedPower: null, perSession: null } };
}

export function decideOnAlertsim() {
  return { alone: decide(alertsim4Tables()), against: decide(alertsimComparisonTables()) };
}
