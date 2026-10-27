const E = (name, from, to, extra = {}) => ({ name, target: "ff-engine", transforms: [[from, to]], ...extra });

const TIMING = { heavy: true, only: "timing" };

export const benchPlants = Object.freeze([
  E("the evidence is built for every proposed hit, not only the kept ones", `else out.hits.push({ wire, rank: rankV, rankIn: 0, subject: key, dk, el, j, info: inf, sc, fam, id: null });`, `else { evidenceJson(evidenceFor(wire, P, el, j, sc, fam, inf)); out.hits.push({ wire, rank: rankV, rankIn: 0, subject: key, dk, el, j, info: inf, sc, fam, id: null }); }`, TIMING),
  E("a column is rebuilt for every wire", `let c = P.tick.get(id);`, `let c = null;`, TIMING),
  {
    name: "the false-discovery critical keys are solved again for every wire",
    overrides: { "ff-stats": [[`if (crit) return crit;`, ``]], "ff-engine": [[`if (hit) return hit;`, `if (false) return hit;`]] },
    ...TIMING,
  },
  E("the false-discovery gate is off", `if (fam.cutoff === null || sc.K[j] < fam.cutoff) sc.T[j] = FALSE;`, `if (false) sc.T[j] = FALSE;`),
  E("unknown names count in the family", `A[j] = anomaly && known ? 1 : 0;`, `A[j] = anomaly ? 1 : 0;`),
  E("a state wire fires on its first look", `const unseenStart = wire.edge === "state" && (res.mismatch || env.fresh);`, `const unseenStart = false;`),
  E("persistence is ignored", `const cnt = Math.min((cur.phase === "pending" ? cur.cnt : 0) + 1, wire.persist);`, `const cnt = wire.persist;`),
  E("an unknown clause is a false one", `T[j] = anyF ? FALSE : anyU ? UNKNOWN : TRUE;`, `T[j] = anyF || anyU ? FALSE : TRUE;`),
  E("the weakest hits are kept under the cap", `list.sort((a, b) => b.rank - a.rank ||`, `list.sort((a, b) => a.rank - b.rank ||`),
]);
