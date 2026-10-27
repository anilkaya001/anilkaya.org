import { mulberry32 } from "../../shared/flows-stats.js";
import { metricById } from "../../shared/ff-contract.js";
import { bhRef, t5UpperRef, exactScaled, STEP_EXP } from "./ff-a-oracle.mjs";
import { snapshotOf, symbolsOf, wireOf, bodyOf, occOf, SECTORS } from "./ff-a-world.mjs";

export const NAMES = 850;
export const Z = "flow.net_premium.z20";
export const Z2 = "flow.volume.z20";
export const ZV = "vol.iv.30d.zvov";
export const CHG = "vol.iv.30d.chg1d";

export function worldOf(seed) {
  const rng = mulberry32(seed);
  const symbols = symbolsOf(NAMES);
  const gauss = () => {
    let s = 0;
    for (let i = 0; i < 6; i++) s += rng();
    return (s - 3) * 1.41;
  };
  const q = (x) => Math.round(x * 100) / 100;
  const z = () => (rng() < 0.04 ? null : rng() < 0.03 ? q(6.5 + rng() * 2.5) : q(gauss()));
  const cols = {
    [Z]: symbols.map(z),
    [Z2]: symbols.map(z),
    [ZV]: symbols.map(z),
    "flow.pc_volume.z20": symbols.map(z),
    "earn.sessions": symbols.map(() => (rng() < 0.15 ? null : Math.floor(rng() * 60))),
    "earn.confirmed": symbols.map(() => (rng() < 0.2 ? null : rng() < 0.7 ? 1 : 0)),
    "earn.clear_10": symbols.map(() => (rng() < 0.2 ? null : rng() < 0.8 ? 1 : 0)),
    "earn.implied_ratio": symbols.map(() => (rng() < 0.3 ? null : q(0.5 + rng() * 2))),
    [CHG]: symbols.map(() => (rng() < 0.05 ? null : q(gauss() * 2))),
    "vol.rr25.30d": symbols.map(() => (rng() < 0.1 ? null : q(gauss() * 4))),
    "vol.rr25.30d.x0": symbols.map(() => (rng() < 0.1 ? null : rng() < 0.05 ? 1 : 0)),
    "flow.net_premium": symbols.map(() => (rng() < 0.05 ? null : Math.round(gauss() * 4e6))),
  };
  const n = {};
  for (const k of [Z, Z2, ZV, "flow.pc_volume.z20"]) n[k] = symbols.map(() => (rng() < 0.1 ? 14 + Math.floor(rng() * 3) : 20));
  const windows = Array.from({ length: 400 }, (_, k) => {
    const s = symbols[Math.floor(rng() * 200)];
    return {
      symbol: s, occ: occOf(s, Math.floor(rng() * 12)), spanStart: 1000 + k,
      cols: { "contract.premium": Math.round((0.2 + rng() * 4) * 1e6), "contract.dte": Math.floor(rng() * 60), "contract.otm_pct": q(gauss() * 8), "contract.vol_oi": q(rng() * 12) },
    };
  });
  return { rng, symbols, cols, n, windows };
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export const wid = (i, pad) => "w-" + pad.repeat(13) + B32[(i >> 10) & 31] + B32[(i >> 5) & 31] + B32[i & 31];
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const thr = (rng, lo, hi, step = 0.25) => Math.round((lo + rng() * (hi - lo)) / step) * step;

function clauseSet(rng) {
  const out = [];
  const roll = rng();
  const zm = pick(rng, [Z, Z2, ZV, "flow.pc_volume.z20"]);
  out.push({ m: zm, op: ">=", x: thr(rng, 2, 4.5) });
  if (roll < 0.15) return out;
  if (roll < 0.35) out.push({ m: "earn.sessions", op: "<=", x: Math.floor(5 + rng() * 15) });
  else if (roll < 0.55) out.push({ m: "earn.confirmed", op: "==", x: 1 });
  else if (roll < 0.7) out.push({ m: CHG, op: ">=", x: thr(rng, 0, 4, 0.5) });
  else if (roll < 0.8) out.push({ m: ZV, op: ">=", x: thr(rng, 1.5, 3.5) }, { m: "earn.clear_10", op: "==", x: 1 });
  else if (roll < 0.9) return [{ m: "earn.implied_ratio", op: ">=", x: thr(rng, 1, 2, 0.05) }];
  else return [{ m: "vol.rr25.30d.x0", op: "==", x: 1 }];
  return out;
}

export function wiresOf(M, rng, symbols) {
  const wires = [];
  const mk = (i, scope) => {
    const id = wid(i, "a");
    const body = bodyOf("nightly", clauseSet(rng), { scope, persist: 1 + Math.floor(rng() * 2), cooldown: { unit: "session", n: pick(rng, [1, 5, 10]) } });
    return wireOf(M, { id, memberId: "m" + String(i % 120).padStart(3, "0"), body });
  };
  for (let i = 0; i < 1000; i++) wires.push(mk(i, { kind: "universe" }));
  for (let i = 1000; i < 2000; i++) wires.push(mk(i, { kind: "sector", sector: SECTORS[i % SECTORS.length] }));
  for (let i = 2000; i < 3000; i++) {
    const set = new Set();
    while (set.size < 25) set.add(symbols[Math.floor(rng() * NAMES)]);
    wires.push(mk(i, { kind: "names", symbols: Array.from(set) }));
  }
  const seen = new Set();
  for (const w of wires) {
    if (seen.has(w.id)) throw new Error("bench: duplicate wire id " + w.id);
    seen.add(w.id);
  }
  return wires;
}

export function liveWorld(M, W) {
  const now = Date.parse("2026-03-09T15:00:00Z");
  return snapshotOf({
    kind: "live", session: "2026-03-09", now, look: 7, symbols: W.symbols, windows: W.windows,
    cols: { "flow.net_premium": W.cols["flow.net_premium"] },
    sources: { "live:alerts": { session: "2026-03-09", asOf: now - 45000 }, "live:strips": { session: "2026-03-09", asOf: now - 45000 } },
  }, M);
}

export function liveWires(M, rng, symbols) {
  const wires = [];
  for (let i = 0; i < 300; i++) {
    const id = wid(i, "b");
    const clauses = [{ m: "contract.premium", op: ">=", x: Math.round((0.5 + rng() * 2) * 1e6) }];
    if (i % 3 === 0) clauses.push({ m: "contract.dte", op: "<=", x: Math.floor(7 + rng() * 40) });
    if (i % 5 === 0) clauses.push({ m: "contract.vol_oi", op: ">=", x: Math.floor(1 + rng() * 5) });
    const scope = i % 4 === 0 ? { kind: "sector", sector: SECTORS[i % SECTORS.length] } : i % 4 === 1 ? { kind: "names", symbols: symbols.slice(i % 150, (i % 150) + 25) } : { kind: "universe" };
    wires.push(wireOf(M, { id, memberId: "m" + String(i % 120).padStart(3, "0"), body: bodyOf("live", clauses, { scope, persist: 1 + (i % 3 === 0 ? 1 : 0) }) }));
  }
  return wires;
}

export function oracleHits(W, spec) {
  const { symbols, cols, n } = W;
  const inScope = symbols.map((s, i) => i).filter((i) => {
    if (spec.scope.kind === "universe") return true;
    if (spec.scope.kind === "sector") return SECTORS[i % SECTORS.length] === spec.scope.sector;
    return spec.scope.symbols.includes(symbols[i]);
  });
  const expOf = (m) => STEP_EXP[metricById(m).unit];
  const shown = (m, i) => {
    const v = cols[m][i];
    return v === null || v === undefined ? null : exactScaled(v, expOf(m));
  };
  const limit = (c) => exactScaled(c.x, expOf(c.m));
  const anomaly = spec.all.filter((c) => /\.z20$|zvov$/.test(c.m));
  const known = inScope.filter((i) => anomaly.every((c) => shown(c.m, i) !== null && n[c.m][i] >= 15));
  const pOf = (i) => Math.max(...anomaly.map((c) => t5UpperRef((c.op === ">=" ? shown(c.m, i) : -shown(c.m, i)) / 100)));
  const rej = bhRef(known.map(pOf), 0.05).reject;
  const rejected = new Set(known.filter((_, k) => rej[k]));
  const holds = (c, i) => {
    const v = shown(c.m, i);
    if (v === null) return null;
    const x = limit(c);
    return c.op === ">=" ? v >= x : c.op === "<=" ? v <= x : v === x;
  };
  const lead = anomaly.length ? null : spec.all[0];
  const rankOf = (i) => {
    if (anomaly.length) return Math.min(...anomaly.map((c) => (c.op === ">=" ? shown(c.m, i) : -shown(c.m, i))));
    const v = shown(lead.m, i);
    const x = limit(lead);
    return lead.op === ">=" ? v - x : lead.op === "<=" ? x - v : 0;
  };
  const hits = [];
  let unknown = 0;
  for (const i of inScope) {
    let anyF = false;
    let anyU = false;
    for (const c of spec.all) {
      const unknownAnomaly = anomaly.includes(c) && (shown(c.m, i) === null || n[c.m][i] < 15);
      const h = unknownAnomaly ? null : holds(c, i);
      if (h === null) anyU = true;
      else if (h === false) anyF = true;
    }
    if (!anyF && anomaly.length && known.includes(i) && !rejected.has(i)) anyF = true;
    if (!anyF && !anyU) hits.push({ symbol: symbols[i], rank: rankOf(i) });
    if (!anyF && anyU) unknown++;
  }
  hits.sort((a, b) => b.rank - a.rank || (a.symbol < b.symbol ? -1 : 1));
  return { hits, unknown };
}
