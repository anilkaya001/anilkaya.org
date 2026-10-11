export const MODES = Object.freeze({ WELL: "well-specified", MIS: "mis-specified" });

export class NotJudged extends Error {}
export class NoJudgementList extends Error {}

export function cell(spec) {
  for (const k of ["id", "world", "mode", "run"]) if (!(k in spec)) throw new Error(`cell lacks ${k}`);
  if (spec.mode !== MODES.WELL && spec.mode !== MODES.MIS) throw new Error(`cell ${spec.id} has mode ${spec.mode}`);
  return Object.freeze({ outOfFamily: false, ...spec });
}

export function accept(result) {
  if (result.mode !== MODES.MIS) throw new NotJudged(`cell ${result.id} is ${result.mode}; only a ${MODES.MIS} cell can accept a result`);
  return result.pass === true;
}

export function runCell(c) {
  const measured = c.run();
  return { id: c.id, world: c.world, mode: c.mode, outOfFamily: c.outOfFamily, ...measured };
}

export function judge(cells) {
  if (!cells.some((c) => c.mode === MODES.MIS)) throw new NoJudgementList("no judgement cell is mis-specified");
  if (!cells.some((c) => c.mode === MODES.MIS && c.outOfFamily)) throw new NoJudgementList("the judgement worlds include none marked out-of-family");
  const rows = [];
  for (const c of cells) {
    const r = runCell(c);
    rows.push(c.mode === MODES.MIS ? { ...r, accepted: accept(r) } : { ...r, accepted: null, role: "reference" });
  }
  return { rows, accepted: rows.filter((r) => r.accepted !== null).every((r) => r.accepted), judged: rows.filter((r) => r.accepted !== null).length };
}

export function formatRow(r) {
  const verdict = r.accepted === null ? "reference" : r.accepted ? "accepted" : "rejected";
  return `${r.id.padEnd(34)} ${r.mode.padEnd(15)} ${r.outOfFamily ? "out-of-family" : "in-family    "} ${verdict}${r.note ? "  " + r.note : ""}`;
}
