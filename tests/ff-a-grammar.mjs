import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { holdsAndPlants } from "./lib/ff-a-kit.mjs";
import * as W from "../shared/ff-contract.js";
import { FF_SCHEMA_SQL } from "../shared/ff-schema.js";
import { mulberry32 } from "../shared/flows-stats.js";
import { exactScaled, STEP_EXP } from "./lib/ff-a-oracle.mjs";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const clone = (v) => structuredClone(v);
const T = (id) => W.TEMPLATES.find((t) => t.id === id);
const metric = (id) => W.METRICS.find((m) => m.id === id);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function refProblems(body, opt = {}) {
  const out = new Set();
  const house = opt.house === true;
  if (!isObj(body)) return ["grammar_invalid"];
  const want = ["all", "cadence", "cooldown", "persist", "scope", "v"];
  const keys = Object.keys(body).sort();
  if (keys.join() !== want.join()) {
    out.add(keys.some((k) => W.AST_GRAMMAR.rejectedFromClient.includes(k)) ? "client_derived_field" : "grammar_invalid");
    return [...out];
  }
  if (body.v !== 1) out.add("grammar_invalid");
  if (body.cadence === "rail") out.add("scope_reserved");
  else if (body.cadence !== "nightly" && body.cadence !== "live") out.add("grammar_invalid");
  const sc = isObj(body.scope) ? body.scope : {};
  const shape = { universe: ["kind"], sector: ["kind", "sector"], names: ["kind", "symbols"] };
  if (sc.kind === "watchlist") out.add("scope_reserved");
  else if (!shape[sc.kind]) out.add("grammar_invalid");
  else if (Object.keys(sc).sort().join() !== [...shape[sc.kind]].sort().join()) out.add("grammar_invalid");
  else if (sc.kind === "names") {
    const s = sc.symbols;
    const okShape = Array.isArray(s) && s.length >= 1 && s.length <= 25 && s.every((x) => typeof x === "string" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(x)) && new Set(s).size === s.length
      && s.every((x, i) => i === 0 || s[i - 1] < x);
    if (!okShape) out.add("grammar_invalid");
    else if (opt.universe && s.some((x) => !opt.universe.has(x))) out.add("symbol_outside_universe");
  } else if (sc.kind === "sector") {
    if (typeof sc.sector !== "string" || sc.sector.length < 1 || sc.sector.length > 40) out.add("grammar_invalid");
    else if (opt.sectors && !opt.sectors.has(sc.sector)) out.add("grammar_invalid");
  }
  if (!Array.isArray(body.all) || body.all.length < 1 || body.all.length > 8) {
    out.add("grammar_invalid");
    return [...out];
  }
  const count = {};
  const subjects = new Set();
  const sources = new Set();
  let anomaly = false;
  for (const c of body.all) {
    if (!isObj(c) || Object.keys(c).sort().join() !== "m,op,x") {
      out.add("grammar_invalid");
      continue;
    }
    const m = metric(c.m);
    if (!m) {
      out.add("grammar_invalid");
      continue;
    }
    const usable = m.status === "ready" || m.status === "limited" || (house && m.status === "warming");
    if (!usable || !m.cadence.includes(body.cadence)) out.add("metric_unavailable");
    if (![">=", "<=", "=="].includes(c.op)) out.add("grammar_invalid");
    else if (c.op === "==" && m.kind === "anomaly") out.add("grammar_invalid");
    if (typeof c.x !== "number" || !Number.isFinite(c.x) || c.x < m.range[0] || c.x > m.range[1]) out.add("grammar_invalid");
    else {
      const e = STEP_EXP[m.unit];
      const n = exactScaled(c.x, e);
      const back = Number(n + "e" + e);
      const stepRatio = Math.round(W.UNITS[m.unit].xStep / W.UNITS[m.unit].step);
      if (back !== c.x || n % stepRatio !== 0) out.add("grammar_precision");
    }
    count[c.m] = (count[c.m] || 0) + 1;
    subjects.add(m.subject);
    if (m.kind === "anomaly") anomaly = true;
    if (m.source[body.cadence]) sources.add(m.source[body.cadence].key);
  }
  if (Object.values(count).some((n) => n > 2)) out.add("grammar_invalid");
  if (subjects.has("sector") && subjects.size > 1) out.add("grammar_invalid");
  if (subjects.has("sector") && sc.kind === "names") out.add("grammar_invalid");
  if (body.cadence === "live" && (anomaly || sources.size > 1)) out.add("grammar_invalid");
  const pr = body.cadence === "live" ? [1, 4] : [1, 3];
  if (!Number.isInteger(body.persist) || body.persist < pr[0] || body.persist > pr[1]) out.add("grammar_invalid");
  const cd = body.cooldown;
  const choices = body.cadence === "live" ? [1] : body.cadence === "nightly" ? [1, 2, 5, 10, 20] : [];
  if (!isObj(cd) || Object.keys(cd).sort().join() !== "n,unit" || cd.unit !== "session" || !choices.includes(cd.n)) out.add("grammar_invalid");
  return [...out];
}

function randomBody(rng, ids) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const cadence = pick(["nightly", "nightly", "live", "live", "rail"]);
  const pool = W.METRICS.filter((m) => cadence === "rail" || m.cadence.includes(cadence));
  const n = 1 + Math.floor(rng() * 9);
  const all = [];
  for (let i = 0; i < n; i++) {
    const m = rng() < 0.04 ? { id: "vol.skew.flip", range: [0, 10], unit: "ratio" } : rng() < 0.12 ? pick(W.METRICS) : pick(pool);
    const op = rng() < 0.04 ? "<" : pick([">=", "<=", "==", ">="]);
    const lo = Math.max(m.range[0], -1e6);
    const hi = Math.min(m.range[1], 1e8);
    const mode = rng();
    let x;
    const xs = W.UNITS[m.unit] ? W.UNITS[m.unit].xStep : 1;
    if (mode < 0.7) x = Math.round((lo + rng() * (hi - lo)) / xs) * xs;
    else if (mode < 0.8) x = lo + rng() * (hi - lo);
    else if (mode < 0.9) x = hi * 2 + 1;
    else x = pick([0, 1, 3, 10, 500000, 1000000]);
    x = Number(x.toPrecision(12));
    all.push({ m: m.id, op, x });
  }
  const scopes = [{ kind: "universe" }, { kind: "sector", sector: "Energy" }, { kind: "names", symbols: ["SYA101", "SYB202"] }, { kind: "names", symbols: ["SYB202", "SYA101"] },
    { kind: "watchlist" }, { kind: "names", symbols: [] }, { kind: "sector" }, { kind: "everything" }, { kind: "universe", extra: 1 }];
  const body = {
    v: rng() < 0.03 ? 2 : 1, cadence, scope: pick(scopes), all, persist: pick([1, 1, 2, 3, 4, 5, 0]),
    cooldown: pick([{ unit: "session", n: 1 }, { unit: "session", n: 5 }, { unit: "session", n: 20 }, { unit: "session", n: 3 }, { unit: "minute", n: 1 }]),
  };
  if (rng() < 0.04) body.control = "fact";
  if (rng() < 0.03) delete body.persist;
  return body;
}

function astVectors(M, R) {
  const G = M.grammar;
  const base = () => clone(T("T03").ast);
  R.eq(G.validateBody(base(), {}).problems, [], "the T03 default is a valid live wire");
  const has = (mut, want, opt = {}) => {
    const b = base();
    mut(b);
    R.ok(G.validateBody(b, opt).problems.includes(want), `planted wrong wire is refused as ${want}: ${JSON.stringify(mut.toString().slice(0, 60))}`);
  };
  has((b) => { b.control = "fact"; }, "client_derived_field");
  has((b) => { b.h = 0.5; }, "client_derived_field");
  has((b) => { b.cooldown = { unit: "session", n: 3 }; }, "grammar_invalid");
  has((b) => { b.cooldown = { unit: "session", n: 0 }; }, "grammar_invalid");
  has((b) => { b.cooldown = { unit: "minute", n: 5 }; }, "grammar_invalid");
  has((b) => { b.cooldown = 5; }, "grammar_invalid");
  has((b) => { delete b.cooldown; }, "grammar_invalid");
  has((b) => { b.cooldown = { unit: "session", n: 5 }; }, "grammar_invalid");
  has((b) => { b.cooldown = { unit: "session", n: 1, until: "2026-03-09" }; }, "grammar_invalid");
  has((b) => { b.deliver = ["inbox"]; }, "client_derived_field");
  has((b) => { b.all[0].x = 20.5; }, "grammar_precision");
  has((b) => { b.all[1].x = 5000; }, "grammar_invalid");
  has((b) => { b.all[0].op = "<"; }, "grammar_invalid");
  has((b) => { b.all.push({ m: "flow.put_premium", op: ">=", x: 2000000 }); }, "metric_unavailable");
  has((b) => { b.all.push({ m: "desk.win_cc", op: ">=", x: 70 }); }, "metric_unavailable");
  has((b) => { b.all.push({ m: "earn.sessions", op: "<=", x: 10 }); }, "metric_unavailable");
  has((b) => { b.all.push({ m: "flow.net_premium.z20", op: ">=", x: 3 }); }, "metric_unavailable");
  has((b) => { b.all.push({ m: "contract.dte", op: ">=", x: 1 }, { m: "contract.dte", op: ">=", x: 2 }); }, "grammar_invalid");
  has((b) => { for (let i = 0; i < 6; i++) b.all.push({ m: i % 2 ? "contract.premium" : "contract.vol_oi", op: ">=", x: i + 1 }); }, "grammar_invalid");
  has((b) => { b.all = []; }, "grammar_invalid");
  has((b) => { b.cadence = "rail"; }, "scope_reserved");
  has((b) => { b.scope = { kind: "watchlist" }; }, "scope_reserved");
  has((b) => { b.scope = { kind: "names", symbols: ["BBB", "AAA"] }; }, "grammar_invalid");
  has((b) => { b.scope = { kind: "names", symbols: Array.from({ length: 26 }, (_, i) => "A" + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26))).sort() }; }, "grammar_invalid");
  has((b) => { b.scope = { kind: "names", symbols: ["aapl"] }; }, "grammar_invalid");
  has((b) => { b.scope = { kind: "names", symbols: ["SYA101", "SYA101"] }; }, "grammar_invalid");
  has((b) => { b.persist = 5; }, "grammar_invalid");
  has((b) => { b.persist = 0; }, "grammar_invalid");
  has((b) => { b.persist = 1.5; }, "grammar_invalid");
  has((b) => { b.cadence = "nightly"; b.all = [{ m: "sector.breadth_pos", op: ">=", x: 0.6 }, { m: "earn.sessions", op: "<=", x: 10 }]; }, "grammar_invalid");
  has((b) => { b.d = { rv: 1 }; }, "grammar_invalid");
  has((b) => { b.scope = { kind: "names", symbols: ["SYA101", "SYZ999"] }; }, "symbol_outside_universe", { universe: new Set(["SYA101"]) });
  has((b) => { b.scope = { kind: "sector", sector: "Nowhere" }; }, "grammar_invalid", { sectors: new Set(["Energy"]) });
  has((b) => { b.all.push({ m: "flow.net_premium.z20", op: "==", x: 3 }); b.cadence = "nightly"; b.cooldown = { unit: "session", n: 5 }; }, "grammar_invalid");
  has((b) => { b.cadence = "nightly"; b.cooldown = { unit: "session", n: 5 }; b.scope = { kind: "names", symbols: ["SYA101"] }; b.all = [{ m: "sector.breadth_pos", op: ">=", x: 0.6 }]; }, "grammar_invalid");
  has((b) => { b.v = 2; }, "grammar_invalid");
  has((b) => { b.all[0].extra = 1; }, "grammar_invalid");
  has((b) => { b.all[0].m = "nope.metric"; }, "grammar_invalid");
  has((b) => { b.all[0].x = NaN; }, "grammar_invalid");
  has((b) => { b.all[0].x = "3"; }, "grammar_invalid");
  R.eq(G.validateBody(null, {}).problems, ["grammar_invalid"], "null is not a wire");
  R.eq(G.validateBody([], {}).problems, ["grammar_invalid"], "an array is not a wire");
  R.eq(G.validateBody(base(), {}).first, null, "a valid wire has no first error");
  R.eq(G.validateBody({ ...base(), control: "bh" }, {}).first, "ff_grammar_invalid", "client fields are ff_grammar_invalid");
  R.eq(G.validateBody({ ...base(), cadence: "rail" }, {}).first, "ff_scope_reserved", "the rail is ff_scope_reserved");
  const bad = base();
  bad.all[0].x = 20.5;
  R.eq(G.validateBody(bad, {}).first, "ff_grammar_precision", "a fine threshold is ff_grammar_precision");
  const hidden = base();
  hidden.all.push({ m: "desk.win_cc", op: ">=", x: 70 });
  R.eq(G.validateBody(hidden, {}).first, "ff_metric_unavailable", "a hidden metric is ff_metric_unavailable");
  for (const t of W.TEMPLATES) {
    if (!t.ast) continue;
    const bodies = t.variants ? t.variants.map((v) => ({ ...t.ast, all: v.clauses })) : [t.ast];
    for (const b of bodies) {
      const member = G.validateBody(b, {}).problems;
      const house = G.validateBody(b, { house: true }).problems;
      if (t.id === "T04") R.ok(member.includes("metric_unavailable") && house.length === 0, "T04 is warming: refused for a member, registered for the house");
      else R.eq([member, house], [[], []], "template " + t.id + " is a valid wire");
    }
  }
  const rng = mulberry32(2026);
  let compared = 0;
  const universe = new Set(["SYA101", "SYB202", "SYC303"]);
  const sectors = new Set(["Energy", "Technology"]);
  for (let i = 0; i < (R.heavy ? 6000 : 700); i++) {
    const body = randomBody(rng);
    for (const opt of [{}, { house: true }, { universe, sectors }]) {
      const got = new Set(G.validateBody(body, opt).problems);
      const want = new Set(refProblems(body, opt));
      R.eq([...got].sort(), [...want].sort(), "fuzz " + i + " " + JSON.stringify(opt.house) + " " + JSON.stringify(body).slice(0, 140));
      compared++;
    }
    if (R.fails.length > 25) break;
  }
  R.ok(compared > 1500, "the validator was fuzzed against the reference");
}

function deriveVectors(M, R) {
  const G = M.grammar;
  const t1 = G.storedBody(T("T01").ast);
  R.eq(t1.d.control, "bh", "an anomaly clause makes a BH family");
  R.eq(t1.d.q, 0.05, "q is five per cent");
  R.eq(t1.d.rv, W.REGISTRY_VERSION, "the registry version is copied");
  R.eq(t1.d.clauses[0], { step: 0.01, h: { abs: 0.5 }, floor: { abs: 100000, rel: 0 }, zSpace: "linear" }, "the z clause copies step, band, floor and space");
  R.eq(t1.d.clauses[1], { step: 1, h: { abs: 0 }, floor: null, zSpace: null }, "a bool clause has no band");
  const t3 = G.storedBody(T("T03").ast);
  R.eq(t3.d.control, "fact", "a window wire is a fact wire");
  R.eq(t3.d.clauses.map((c) => c.h), [{ abs: 0 }, { abs: 0 }, { abs: 0 }, { abs: 0 }], "window clauses have no hysteresis");
  const t7 = G.storedBody(T("T07").variants[0] ? { ...T("T07").ast, all: T("T07").variants[0].clauses } : null);
  R.eq(t7.d.clauses[0], { step: 0.01, h: { mul: 0.95 }, floor: null, zSpace: null }, "a ratio relaxes to 95 per cent");
  const pc = G.storedBody({ ...T("T01").ast, all: [{ m: "flow.pc_volume.z20", op: ">=", x: 3 }] });
  R.eq(pc.d.clauses[0].zSpace, "log", "a ratio z is read in log space");
  R.eq(pc.d.clauses[0].floor, { abs: 0.1, rel: 0 }, "and floored in log units");
  const money = G.storedBody({ ...T("T03").ast, all: [{ m: "flow.net_premium", op: ">=", x: 5000000 }], cadence: "live" });
  R.eq(money.d.clauses[0].h, { rel: 0.1, abs: 50000 }, "a usd clause relaxes by ten per cent or $50,000");
  R.ok(Object.isFrozen(G.compileWire({ id: "h-t01", layer: "house", version: 1, body: T("T01").ast })), "a compiled wire is frozen");
  const original = clone(T("T01").ast);
  G.storedBody(original);
  R.eq(original, T("T01").ast, "storedBody does not touch its input");
  const reorder = (o) => {
    if (Array.isArray(o)) return o.map(reorder);
    if (!isObj(o)) return o;
    return Object.fromEntries(Object.keys(o).reverse().map((k) => [k, reorder(o[k])]));
  };
  R.eq(M.ids.astHash(G.storedBody(reorder(T("T01").ast))), M.ids.astHash(G.storedBody(T("T01").ast)), "key order does not move the ast hash");
  const a = G.clauseHashOf(T("T01").ast);
  R.eq(G.clauseHashOf({ ...T("T01").ast, all: T("T01").ast.all.slice().reverse() }), a, "clause order does not move the clause hash");
  R.eq(G.clauseHashOf({ ...T("T01").ast, scope: { kind: "sector", sector: "Energy" }, persist: 2, cooldown: { unit: "session", n: 2 } }), a, "scope, persistence and cooldown are outside the clause hash");
  const moved = clone(T("T01").ast);
  moved.all[0].x = 3.25;
  R.ok(G.clauseHashOf(moved) !== a, "a threshold moves the clause hash");
  const flipped = clone(T("T01").ast);
  flipped.all[0].op = "<=";
  R.ok(G.clauseHashOf(flipped) !== a, "an operator moves the clause hash");
  R.eq(sha("x").length, 64, "node:crypto available");
  R.ok(M.ids.astHash(G.storedBody(moved)) !== M.ids.astHash(G.storedBody(T("T01").ast)), "a threshold moves the ast hash");
  const scoped = { ...T("T01").ast, scope: { kind: "sector", sector: "Energy" } };
  R.ok(M.ids.astHash(G.storedBody(scoped)) !== M.ids.astHash(G.storedBody(T("T01").ast)), "the scope is inside the ast hash");
}

function compileVectors(M, R) {
  const G = M.grammar;
  const c = (id, over = {}) => G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: T(id).ast, ...over });
  const t1 = c("T01");
  R.eq([t1.edge, t1.subjectKind, t1.control, t1.cadence, t1.persist, t1.cooldown, t1.stream], ["event", "n", "bh", "nightly", 1, 5, "member01"], "T01 compiles as an event BH wire on names");
  R.eq(t1.clauses.map((x) => [x.xi, x.h20]), [[300, 1000], [1, 0], [10, 0], [1, 0]], "T01 integer thresholds and bands");
  R.eq(t1.lead, 0, "the lead clause of T01 is the anomaly");
  R.eq(t1.anomaly, [0], "one anomaly clause");
  R.near(t1.pThr, 0.01505, 1e-4, "the T01 tail");
  const t7 = G.compileWire({ id: "h-t07a", layer: "house", version: 1, body: { ...T("T07").ast, all: T("T07").variants[0].clauses } });
  R.eq([t7.edge, t7.stream, t7.memberId], ["state", "house", null], "T07 is a state wire in the house stream");
  R.eq(t7.clauses[0].h20, 150, "T07 relaxes 1.50 by 7.5 steps");
  const t7b = G.compileWire({ id: "h-t07b", layer: "house", version: 1, body: { ...T("T07").ast, all: T("T07").variants[1].clauses } });
  R.eq([t7b.clauses[0].xi, t7b.clauses[0].h20], [70, 70], "T07 below relaxes 0.70 by 3.5 steps");
  const t3 = c("T03");
  R.eq([t3.edge, t3.subjectKind, t3.control, t3.pThr], ["event", "c", "fact", null], "T03 is a fact wire on windows");
  const t8 = c("T08");
  R.eq([t8.subjectKind, t8.control], ["s", "bh"], "T08 is a sector BH wire");
  R.eq(c("T05").edge, "event", "T05 mixes state and event clauses: event wins");
  R.eq(c("T06").edge, "event", "T06's crossing is an event");
  const mixedState = G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: { ...T("T05").ast, all: [{ m: "earn.sessions", op: "<=", x: 10 }, { m: "vol.iv.30d.chg1d", op: ">=", x: 4 }] } });
  R.eq(mixedState.edge, "state", "only state clauses make a state wire");
  const reordered = G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: { ...T("T01").ast, all: T("T01").ast.all.slice().reverse() } });
  R.eq(reordered.clauses[reordered.lead].m, "flow.net_premium.z20", "the lead clause follows the canonical order, whatever the entry order");
  const plain = G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: { ...T("T03").ast, all: [{ m: "contract.vol_oi", op: ">=", x: 3 }, { m: "contract.dte", op: "<=", x: 21 }] } });
  const swapped = G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: { ...T("T03").ast, all: [{ m: "contract.dte", op: "<=", x: 21 }, { m: "contract.vol_oi", op: ">=", x: 3 }] } });
  R.eq(plain.clauses[plain.lead].m, swapped.clauses[swapped.lead].m, "two wires with the same clauses lead with the same clause");
  R.eq(G.compileWire({ id: "h-t04", layer: "house", version: 1, body: T("T04").ast }).blocked, "metric_warming", "T04 is blocked: warming");
  R.eq(G.compileWire({ id: "h-t01", layer: "house", version: 1, body: T("T01").ast, pinned: "0".repeat(64) }).blocked, "registry_conflict", "a pinned hash that differs blocks the house wire");
  R.eq(G.compileWire({ id: "h-t01", layer: "house", version: 1, body: T("T01").ast, pinned: t1.astHash }).blocked, null, "a matching pin does not block");
  const future = G.storedBody(T("T01").ast);
  future.d.rv = W.REGISTRY_VERSION + 1;
  R.eq(G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: future }).blocked, "registry_version", "a wire from a newer registry is blocked");
  R.eq(c("T03", { catchup: true }).catchup, true, "the catch-up flag is carried");
  R.eq(c("T01").catchup, false, "and is off by default");
  const frozenH = G.storedBody(T("T01").ast);
  frozenH.d.clauses[0].h = { abs: 1 };
  R.eq(G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: frozenH }).clauses[0].h20, 2000, "an armed version's derived band is read from the version, not from the registry");
}

function budgetVectors(M, R) {
  const G = M.grammar;
  const body = T("T01").ast;
  const comp = G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body });
  R.eq(G.expWeekCentsOf(comp, 850), 28, "T01 on 850 names is charged 0.28 a week");
  R.eq(G.expWeekOf(comp, 850), 0.28, "in weekly units");
  R.ok(G.expWeekCentsOf(comp, 5) < 28, "a smaller scope is charged less");
  R.eq(G.expWeekCentsOf(G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: T("T03").ast }), 850), null, "a fact wire has no registered null and no charge");
  R.eq(G.expWeekCentsOf(comp, 0), null, "no scope, no charge");
  const armed = (n, over = {}) => Array.from({ length: n }, () => ({ scope: { kind: "names", symbols: ["SYA101"] }, cadence: "nightly", expWeek: 0.28, ...over }));
  R.eq(G.armingProblems(comp, { armed: armed(6), scopeSize: 850, budgetB: 2 }), [], "seven wires of 0.28 fit a budget of two (196 of 200)");
  R.eq(G.armingProblems(comp, { armed: armed(7), scopeSize: 850, budgetB: 2 }), ["budget_exceeded"], "the eighth does not (224 of 200)");
  R.eq(G.armingProblems(comp, { armed: armed(2), scopeSize: 850, budgetB: 1 }), [], "three fit a budget of one (84 of 100)");
  R.eq(G.armingProblems(comp, { armed: armed(3), scopeSize: 850, budgetB: 1 }), ["budget_exceeded"], "the fourth does not (112 of 100)");
  R.eq(G.armingProblems(comp, { armed: armed(16), scopeSize: 850, budgetB: 5 }), [], "17 fit a budget of five (476 of 500)");
  R.eq(G.armingProblems(comp, { armed: armed(17), scopeSize: 850, budgetB: 5 }), ["budget_exceeded"], "the 18th does not (504 of 500)");
  R.eq(G.armingProblems(comp, { armed: armed(6), scopeSize: 850 }), [], "the default budget is two");
  R.eq(G.armingProblems(comp, { armed: armed(7), scopeSize: 850, budgetB: 3 }), ["budget_exceeded"], "a budget outside 1, 2, 5 is the default");
  R.eq(G.armingProblems(comp, { armed: armed(1, { expWeek: 1.72 }), scopeSize: 850, budgetB: 2 }), [], "exactly 2.00 is inside the budget");
  R.eq(G.armingProblems(comp, { armed: armed(1, { expWeek: 1.73 }), scopeSize: 850, budgetB: 2 }), ["budget_exceeded"], "2.01 is over it");
  R.eq(G.armingProblems(comp, { armed: armed(50, { expWeek: 0 }), scopeSize: 850 }), ["wire_limit"], "50 armed wires is the limit");
  const uni = { scope: { kind: "universe" }, cadence: "nightly", expWeek: 0 };
  const univBody = G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: { ...T("T05").ast, all: [{ m: "earn.sessions", op: "<=", x: 10 }] } });
  R.eq(G.armingProblems(univBody, { armed: [uni, uni, uni, uni, uni], scopeSize: 850 }), ["wire_limit"], "five universe wires is the limit");
  R.eq(G.armingProblems(univBody, { armed: [uni, uni, uni, uni], scopeSize: 850 }), [], "four universe wires leave room");
  const liveBody = G.compileWire({ id: "w-aaaaaaaaaaaaaaaa", layer: "member", memberId: "member01", version: 1, body: T("T03").ast });
  const live = { scope: { kind: "names", symbols: ["SYA101"] }, cadence: "live", expWeek: null };
  R.eq(G.armingProblems(liveBody, { armed: [live, live, live, live, live], scopeSize: 850 }), ["wire_limit"], "five live wires is the limit");
  R.eq(G.armingProblems(liveBody, { armed: [live], scopeSize: 850, armedGlobal: 2000 }), ["wire_limit"], "2,000 wires in all is the fuse");
  R.eq(G.armingProblems({ ...liveBody, layer: "house" }, { armed: armed(60), armedGlobal: 5000 }), [], "house wires are not limited");
  R.eq(G.scopeSizeOf({ kind: "names", symbols: ["A", "B"] }), 2, "a names scope counts its names");
  R.eq(G.scopeSizeOf({ kind: "universe" }, { universeSize: 850 }), 850, "the universe counts its names");
  R.eq(G.scopeSizeOf({ kind: "universe" }, { universe: new Set(["A", "B", "C"]) }), 3, "or its set");
  R.eq(G.scopeSizeOf({ kind: "sector", sector: "Energy" }, { sectorSizes: { Energy: 40 } }), 40, "a sector counts its sizes");
  R.eq(G.scopeSizeOf({ kind: "sector", sector: "Energy" }, { sectorOf: new Map([["A", "Energy"], ["B", "Energy"], ["C", "Tech"]]) }), 2, "or its members");
  R.eq(G.scopeSizeOf({ kind: "universe" }, {}, "s"), 11, "sector wires run over eleven sectors");
  R.eq(G.scopeSizeOf({ kind: "sector", sector: "Energy" }, {}, "s"), 1, "or one");
  R.eq(G.scopeSizeOf({ kind: "universe" }), null, "an unknown universe size is unknown");
}

function versionVectors(M, R) {
  const G = M.grammar;
  const now = Date.parse("2026-03-09T13:42:00Z");
  const r = G.prepareVersion(T("T01").ast, { universeSize: 850, now, template: "T01" });
  R.eq(r.ok, true, "a template is a valid version");
  const v = r.version;
  R.eq([v.template, v.cadence, v.scope_kind, v.control, v.exp_week, v.registry_version, v.effective_session], ["T01", "nightly", "universe", "bh", 0.28, 1, "2026-03-09"], "the version row");
  R.eq(v.clause_hash, G.clauseHashOf(T("T01").ast), "its clause hash");
  R.eq(v.ast_hash, sha(v.ast_json), "its ast hash is the hash of its stored text");
  R.ok(v.sentence.length <= 280 && v.sentence.startsWith("When "), "its sentence");
  R.eq(r.symbols, [], "a universe wire has no symbol index");
  const names = G.prepareVersion({ ...T("T03").ast, scope: { kind: "names", symbols: ["SYA101", "SYB202"] } }, { now: Date.parse("2026-03-09T21:42:00Z") });
  R.eq([names.symbols, names.version.effective_session, names.version.exp_week, names.version.template], [["SYA101", "SYB202"], "2026-03-10", null, "custom"], "a live names wire");
  const refused = G.prepareVersion({ ...T("T01").ast, control: "fact" }, {});
  R.eq([refused.ok, refused.code], [false, "ff_grammar_invalid"], "a refused wire carries its code");
  const limited = G.prepareVersion(T("T01").ast, { universeSize: 850, armed: Array.from({ length: 8 }, () => ({ scope: { kind: "names", symbols: ["A"] }, cadence: "nightly", expWeek: 0.28 })), budgetB: 2 });
  R.eq([limited.ok, limited.code], [false, "ff_budget_exceeded"], "a spent budget refuses the version");
  const full = G.prepareVersion(T("T03").ast, { armed: Array.from({ length: 50 }, () => ({ scope: { kind: "names", symbols: ["A"] }, cadence: "nightly", expWeek: null })) });
  R.eq([full.ok, full.code], [false, "ff_wire_limit"], "50 wires refuse the 51st");
  const db = new DatabaseSync(":memory:");
  for (const s of FF_SCHEMA_SQL) db.exec(s);
  db.prepare("INSERT INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, created_at) VALUES (?,?,?,?,?,?,1,?)").run("w-abcdefghij234567", "member", "member01", r.title, "armed", now, now);
  db.prepare("INSERT INTO ff_wire_version (wire_id, version, template, cadence, scope_kind, control, exp_week, clause_hash, ast_json, ast_hash, sentence, registry_version, effective_session, created_at) VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("w-abcdefghij234567", v.template, v.cadence, v.scope_kind, v.control, v.exp_week, v.clause_hash, v.ast_json, v.ast_hash, v.sentence, v.registry_version, v.effective_session, now);
  R.eq(db.prepare("SELECT count(*) AS n FROM ff_wire_version").get().n, 1, "a prepared version satisfies the table's checks");
  R.ok(r.title.length >= 1 && r.title.length <= 80, "the title fits its column");
}

function houseVectors(M, R) {
  const H = M.house;
  R.eq(H.HOUSE_WIRES.map((w) => w.id), W.HOUSE_IDS.filter((id) => W.TEMPLATES.find((t) => t.house.includes(id)).ast !== null), "the house registry is the contract's house ids");
  R.eq(H.HOUSE_WIRES.length, 9, "nine house wires");
  for (const w of H.HOUSE_WIRES) {
    R.eq(w.astHash, w.computedHash, "the pinned hash of " + w.id);
    R.eq(w.version, 1, w.id + " is version 1");
    R.ok(/^\d{4}-\d{2}-\d{2}$/.test(w.effectiveSession), w.id + " has an effective session");
    R.ok(w.sentence.length <= 280 && w.title.length <= 80, w.id + " sentence and title fit");
    R.eq(M.grammar.validateBody(w.body, { house: true }).problems, [], w.id + " is a valid house body");
    const c = H.compileHouse(w);
    R.eq(c.layer, "house", w.id + " compiles as a house wire");
    R.eq(c.blocked, w.id === "h-t04" ? "metric_warming" : null, w.id + " is blocked only while its metrics warm");
    R.eq(c.catchup, w.id === "h-t03", "only T03 has the catch-up pass");
    const rows = H.houseRows(w, 1780000000000);
    const db = new DatabaseSync(":memory:");
    for (const s of FF_SCHEMA_SQL) db.exec(s);
    db.prepare("INSERT INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, origin, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(rows.wire.id, rows.wire.layer, rows.wire.member_id, rows.wire.title, rows.wire.status, rows.wire.status_at, rows.wire.current_version, rows.wire.origin, rows.wire.created_at);
    const v = rows.version;
    db.prepare("INSERT INTO ff_wire_version (wire_id, version, template, cadence, scope_kind, control, exp_week, clause_hash, ast_json, ast_hash, sentence, registry_version, effective_session, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(v.wire_id, v.version, v.template, v.cadence, v.scope_kind, v.control, v.exp_week, v.clause_hash, v.ast_json, v.ast_hash, v.sentence, v.registry_version, v.effective_session, v.created_at);
    R.eq(db.prepare("SELECT count(*) AS n FROM ff_wire_version").get().n, 1, w.id + " rows satisfy the tables");
  }
  const t7 = H.HOUSE_WIRES.filter((w) => w.template === "T07");
  R.eq(t7.map((w) => w.id), ["h-t07a", "h-t07b"], "T07 is two wires");
  R.ok(t7[0].sentence !== t7[1].sentence && t7[0].astHash !== t7[1].astHash, "with different bodies");
  const tampered = clone(H.houseById("h-t01"));
  tampered.body.all[0].x = 4;
  R.eq(H.compileHouse(tampered).blocked, "registry_conflict", "an edited house body is not evaluated");
  R.eq(H.houseById("h-t09"), null, "T09 has no house wire");
}

async function battery(M, R) {
  astVectors(M, R);
  deriveVectors(M, R);
  compileVectors(M, R);
  budgetVectors(M, R);
  versionVectors(M, R);
  houseVectors(M, R);
}

const G = "ff-grammar";
const H = "ff-house";
const plants = [
  { name: "a threshold off the grid accepted", target: G, transforms: [["else if (!onGrid(c.x, m.unit)) add(\"grammar_precision\", c.m);", ""]] },
  { name: "unsorted symbols accepted", target: G, transforms: [["|| s.some((x, i) => i > 0 && !(s[i - 1] < x))) add(\"grammar_invalid\", \"symbols\");", ") add(\"grammar_invalid\", \"symbols\");"]] },
  { name: "a client control field accepted", target: G, transforms: [["add(extra.some((k) => AST_GRAMMAR.rejectedFromClient.includes(k)) ? \"client_derived_field\" : \"grammar_invalid\", extra.join(\",\"));\n    return finish(problems, details);", ""]] },
  { name: "the rail cadence accepted", target: G, transforms: [["if (CADENCES_RESERVED.includes(body.cadence)) add(\"scope_reserved\", \"cadence\");\n  else if (!CADENCES.includes(body.cadence)) add(\"grammar_invalid\", \"cadence\");", "if (!CADENCES.includes(body.cadence) && !CADENCES_RESERVED.includes(body.cadence)) add(\"grammar_invalid\", \"cadence\");"]] },
  { name: "a warming metric accepted for members", target: G, transforms: [["export const statusOk = (metric, { house = false } = {}) => metric.status === \"ready\" || metric.status === \"limited\" || (house && metric.status === \"warming\");", "export const statusOk = (metric) => metric.status === \"ready\" || metric.status === \"limited\" || metric.status === \"warming\";"]] },
  { name: "an anomaly in a live wire accepted", target: G, transforms: [["if (body.cadence === \"live\" && (anomaly || sources.size > 1)) add(\"grammar_invalid\", \"live source\");", ""]] },
  { name: "three clauses on one metric accepted", target: G, transforms: [["if (Object.values(perMetric).some((n) => n > LIMITS.clausesPerMetric)) add(\"grammar_invalid\", \"clauses per metric\");", ""]] },
  { name: "equality on a z accepted", target: G, transforms: [["else if (c.op === \"==\" && m.kind === \"anomaly\") add(\"grammar_invalid\", \"equality on a z\");", ""]] },
  { name: "a live cooldown of five accepted", target: G, transforms: [["!(LIMITS.cooldownChoices[body.cadence] || []).includes(cd.n)", "!(LIMITS.cooldownChoices.nightly || []).includes(cd.n)"]] },
  { name: "a threshold outside the range accepted", target: G, transforms: [["if (!finite(c.x) || c.x < m.range[0] || c.x > m.range[1]) add(\"grammar_invalid\", \"threshold \" + c.m);\n    else if", "if (!finite(c.x)) add(\"grammar_invalid\", \"threshold \" + c.m);\n    else if"]] },
  { name: "every wire a fact wire", target: G, transforms: [["control: body.all.some((c) => metricById(c.m).kind === \"anomaly\") ? \"bh\" : \"fact\",", "control: \"fact\","]] },
  { name: "a hysteresis on windows", target: G, transforms: [["const rule = m.subject === \"window\" ? { abs: 0 } : m.h || unit.h;", "const rule = m.h || unit.h;"]] },
  { name: "a floor left out of the derived block", target: G, transforms: [["floor: m.baseline && m.baseline.floor ? { ...m.baseline.floor } : null,", "floor: null,"]] },
  { name: "an edge that is state when any clause is state", target: G, transforms: [["edge: metrics.some((m) => m.edge === \"event\") ? \"event\" : \"state\",", "edge: metrics.every((m) => m.edge === \"event\") ? \"event\" : \"state\","]] },
  { name: "a lead clause in entry order", target: G, transforms: [["const lead = (canon.find((e) => clauses[e.i].kind === \"anomaly\") || canon[0]).i;", "const lead = 0;"]] },
  { name: "a block that reads the registry's band, not the version's", target: G, transforms: [["const h20 = m.subject === \"window\" ? 0 : band20(m.unit, xi, dc.h);", "const h20 = m.subject === \"window\" ? 0 : band20(m.unit, xi, m.h || UNITS[m.unit].h);"]] },
  { name: "a house wire with no pin check", target: G, transforms: [["if (!blocked && spec.pinned && spec.pinned !== hashStored(stored)) blocked = \"registry_conflict\";", ""]] },
  { name: "a newer registry evaluated anyway", target: G, transforms: [["if (!blocked && d.rv > REGISTRY_VERSION) blocked = \"registry_version\";", ""]] },
  { name: "a warming metric evaluated anyway", target: G, transforms: [["if (!blocked && metrics.some((m) => m.status === \"warming\")) blocked = \"metric_warming\";", ""]] },
  { name: "a budget that is one cent generous", target: G, transforms: [["if (spent + mine > 100 * b) out.push(\"budget_exceeded\");", "if (spent + mine > 100 * b + 1) out.push(\"budget_exceeded\");"]] },
  { name: "a budget in floats", target: G, transforms: [["const spent = own.reduce((n, w) => n + (finite(w.expWeek) ? Math.round(w.expWeek * 100) : 0), 0);", "const spent = own.reduce((n, w) => n + (finite(w.expWeek) ? w.expWeek * 100 - 0.4 : 0), 0);"]] },
  { name: "a wire limit of 51", target: G, transforms: [["if (own.length >= LIMITS.armedMemberWires) out.push(\"wire_limit\");", "if (own.length > LIMITS.armedMemberWires) out.push(\"wire_limit\");"]] },
  { name: "universe wires unlimited", target: G, transforms: [["if (compiled.scope.kind === \"universe\" && own.filter((w) => w.scope.kind === \"universe\").length >= LIMITS.universeMemberWires) out.push(\"wire_limit\");", ""]] },
  { name: "live wires unlimited", target: G, transforms: [["if (compiled.cadence === \"live\" && own.filter((w) => w.cadence === \"live\").length >= LIMITS.liveMemberWires) out.push(\"wire_limit\");", ""]] },
  { name: "the global fuse off", target: G, transforms: [["if (Number.isInteger(ctx.armedGlobal) && ctx.armedGlobal >= LIMITS.armedMemberWiresGlobal) out.push(\"wire_limit\");", ""]] },
  { name: "sector wires counted over the universe", target: G, transforms: [["if (subjectKind === \"s\") return scope.kind === \"sector\" ? 1 : Number.isInteger(ctx.sectorCount) ? ctx.sectorCount : 11;", "if (subjectKind === \"s\") return 850;"]] },
  { name: "an effective session of today for a late wire", target: G, transforms: [["effective_session: ctx.now === undefined ? null : effectiveSession(body.cadence, ctx.now),", "effective_session: ctx.now === undefined ? null : new Date(ctx.now).toISOString().slice(0, 10),"]] },
  { name: "an ast hash of the client body", target: G, transforms: [["clause_hash: hashClauses(body.all), ast_json: canonicalJson(stored), ast_hash: hashStored(stored),", "clause_hash: hashClauses(body.all), ast_json: canonicalJson(stored), ast_hash: hashStored(body),"]] },
  { name: "a pin that is not checked in the house", target: H, transforms: [["catchup: entry.catchup, effectiveSession: entry.effectiveSession, pinned: entry.astHash, ...over,", "catchup: entry.catchup, effectiveSession: entry.effectiveSession, ...over,"]] },
  { name: "T07 without its second wire", target: H, transforms: [["if (t.variants) return t.variants.map((v) => entryOf(t, v.id, v.sentence, { ...t.ast, all: v.clauses }));", "if (t.variants) return [entryOf(t, t.variants[0].id, t.variants[0].sentence, { ...t.ast, all: t.variants[0].clauses })];"]] },
  { name: "a house wire row with a member", target: H, transforms: [["id: entry.id, layer: \"house\", member_id: null, title:", "id: entry.id, layer: \"house\", member_id: \"member01\", title:"]] },
  { name: "the catch-up pass on every house wire", target: H, transforms: [["catchup: template.catchup === true,", "catchup: true,"]] },
];

const out = await holdsAndPlants("ff-a-grammar", battery, plants);
console.log(`ff-a-grammar: ${out.checks} checks passed`);
