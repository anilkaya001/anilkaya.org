import {
  AST_VERSION, AST_GRAMMAR, CADENCES, CADENCES_RESERVED, SCOPE_KINDS, SCOPE_KINDS_RESERVED, OPS, LIMITS, UNITS, SYMBOL_RE,
  REGISTRY_VERSION, ERROR_CODES, canonicalJson, metricById,
} from "./ff-contract.js";
import { clauseHash as hashClauses, astHash as hashStored } from "./ff-ids.js";
import { scaledInt, unscaled, expWeekCents, tUpper5, tLower5, band20 } from "./ff-stats.js";
import { wireSentence, titleOf } from "./ff-sentence.js";
import { effectiveSession } from "./ff-session.js";

const ERROR_OF = Object.freeze({
  grammar_invalid: "ff_grammar_invalid",
  client_derived_field: "ff_grammar_invalid",
  grammar_precision: "ff_grammar_precision",
  metric_unavailable: "ff_metric_unavailable",
  scope_reserved: "ff_scope_reserved",
  symbol_outside_universe: "ff_symbol_outside_universe",
  budget_exceeded: "ff_budget_exceeded",
  wire_limit: "ff_wire_limit",
});

const SYMBOL = new RegExp(SYMBOL_RE);
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameKeys = (o, keys) => {
  const a = Object.keys(o).sort();
  const b = [...keys].sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
};
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const utf8Length = (s) => new TextEncoder().encode(s).length;

export const errorCode = (problem) => ERROR_OF[problem] || "ff_grammar_invalid";

export const statusOk = (metric, { house = false } = {}) => metric.status === "ready" || metric.status === "limited" || (house && metric.status === "warming");

export function onGrid(x, unit) {
  const n = scaledInt(x, unit);
  if (n === null || unscaled(n, unit) !== x) return false;
  return n % Math.round(UNITS[unit].xStep / UNITS[unit].step) === 0;
}

export function validateBody(body, ctx = {}) {
  const problems = [];
  const details = [];
  const add = (p, detail = "") => {
    problems.push(p);
    details.push(detail);
  };
  const house = ctx.house === true;
  if (!isPlain(body)) return finish(["grammar_invalid"], ["not an object"]);
  const stored = ctx.stored === true;
  const want = stored ? [...AST_GRAMMAR.body, "d"] : AST_GRAMMAR.body;
  if (!sameKeys(body, want)) {
    const extra = Object.keys(body).filter((k) => !want.includes(k));
    add(extra.some((k) => AST_GRAMMAR.rejectedFromClient.includes(k)) ? "client_derived_field" : "grammar_invalid", extra.join(","));
    return finish(problems, details);
  }
  if (body.v !== AST_VERSION) add("grammar_invalid", "version");
  if (CADENCES_RESERVED.includes(body.cadence)) add("scope_reserved", "cadence");
  else if (!CADENCES.includes(body.cadence)) add("grammar_invalid", "cadence");
  const scope = isPlain(body.scope) ? body.scope : {};
  if (SCOPE_KINDS_RESERVED.includes(scope.kind)) add("scope_reserved", "scope");
  else if (!SCOPE_KINDS.includes(scope.kind)) add("grammar_invalid", "scope kind");
  else if (!sameKeys(scope, AST_GRAMMAR.scope[scope.kind])) add("grammar_invalid", "scope shape");
  else if (scope.kind === "names") {
    const s = scope.symbols;
    if (!Array.isArray(s) || s.length < 1 || s.length > LIMITS.symbolsMax || new Set(s).size !== s.length || !s.every((x) => typeof x === "string" && SYMBOL.test(x))
      || s.some((x, i) => i > 0 && !(s[i - 1] < x))) add("grammar_invalid", "symbols");
    else if (ctx.universe && s.some((x) => !ctx.universe.has(x))) add("symbol_outside_universe", s.filter((x) => !ctx.universe.has(x)).join(","));
  } else if (scope.kind === "sector") {
    if (typeof scope.sector !== "string" || !scope.sector.length || scope.sector.length > 40) add("grammar_invalid", "sector");
    else if (ctx.sectors && !ctx.sectors.has(scope.sector)) add("grammar_invalid", "unknown sector");
  }
  if (!Array.isArray(body.all) || body.all.length < LIMITS.clausesMin || body.all.length > LIMITS.clausesMax) {
    add("grammar_invalid", "clause count");
    return finish(problems, details);
  }
  const perMetric = {};
  const subjects = new Set();
  const sources = new Set();
  let anomaly = false;
  for (const c of body.all) {
    if (!isPlain(c) || !sameKeys(c, AST_GRAMMAR.clause)) {
      add("grammar_invalid", "clause shape");
      continue;
    }
    const m = metricById(c.m);
    if (!m) {
      add("grammar_invalid", "metric " + String(c.m));
      continue;
    }
    if (!statusOk(m, { house }) || !m.cadence.includes(body.cadence)) add("metric_unavailable", c.m);
    if (!OPS.includes(c.op)) add("grammar_invalid", "operator");
    else if (c.op === "==" && m.kind === "anomaly") add("grammar_invalid", "equality on a z");
    if (!finite(c.x) || c.x < m.range[0] || c.x > m.range[1]) add("grammar_invalid", "threshold " + c.m);
    else if (!onGrid(c.x, m.unit)) add("grammar_precision", c.m);
    perMetric[c.m] = (perMetric[c.m] || 0) + 1;
    subjects.add(m.subject);
    if (m.kind === "anomaly") anomaly = true;
    const src = m.source[body.cadence];
    if (src) sources.add(src.key);
  }
  if (Object.values(perMetric).some((n) => n > LIMITS.clausesPerMetric)) add("grammar_invalid", "clauses per metric");
  if (subjects.has("sector") && subjects.size > 1) add("grammar_invalid", "sector mixed");
  if (subjects.has("sector") && scope.kind === "names") add("grammar_invalid", "sector metric on names");
  if (body.cadence === "live" && (anomaly || sources.size > 1)) add("grammar_invalid", "live source");
  const range = body.cadence === "live" ? LIMITS.persistLive : LIMITS.persistNightly;
  if (!Number.isInteger(body.persist) || body.persist < range[0] || body.persist > range[1]) add("grammar_invalid", "persist");
  const cd = body.cooldown;
  if (!isPlain(cd) || !sameKeys(cd, AST_GRAMMAR.cooldown) || cd.unit !== LIMITS.cooldownUnit || !(LIMITS.cooldownChoices[body.cadence] || []).includes(cd.n)) add("grammar_invalid", "cooldown");
  if (!problems.length && stored) {
    const d = body.d;
    if (!isPlain(d) || !Number.isInteger(d.rv) || !Array.isArray(d.clauses) || d.clauses.length !== body.all.length) add("grammar_invalid", "derived block");
  }
  if (!problems.length && utf8Length(canonicalJson(stored ? body : storedBody(body))) > LIMITS.astBytes) add("grammar_invalid", "size");
  return finish(problems, details);

  function finish(ps, ds) {
    const errors = ps.map((p, i) => Object.freeze({ code: errorCode(p), problem: p, detail: ds[i] }));
    return Object.freeze({ ok: ps.length === 0, problems: Object.freeze(ps), errors: Object.freeze(errors), first: errors.length ? errors[0].code : null });
  }
}

export function deriveBlock(body) {
  const clauses = body.all.map((c) => {
    const m = metricById(c.m);
    const unit = UNITS[m.unit];
    const rule = m.subject === "window" ? { abs: 0 } : m.h || unit.h;
    return {
      step: unit.step,
      h: { ...rule },
      floor: m.baseline && m.baseline.floor ? { ...m.baseline.floor } : null,
      zSpace: m.baseline ? m.baseline.zSpace : null,
    };
  });
  return {
    rv: REGISTRY_VERSION,
    control: body.all.some((c) => metricById(c.m).kind === "anomaly") ? "bh" : "fact",
    q: LIMITS.bhQ,
    clauses,
  };
}

export const storedBody = (body) => ({ ...body, d: deriveBlock(body) });

export const clauseHashOf = (body) => hashClauses(body.all);

export const astHashOf = (stored) => hashStored(stored);

export function subjectKindOf(clauseMetrics) {
  if (clauseMetrics.some((m) => m.subject === "window")) return "c";
  if (clauseMetrics.some((m) => m.subject === "sector")) return "s";
  return "n";
}

export function compileWire(spec) {
  const { id, layer, memberId = null, version, body, title = "", sentence = "", catchup = false, effectiveSession = null } = spec;
  const stored = body && Object.prototype.hasOwnProperty.call(body, "d") ? body : storedBody(body);
  const metrics = stored.all.map((c) => metricById(c.m));
  const d = stored.d;
  let blocked = spec.blocked || null;
  if (!blocked && metrics.some((m) => m.status === "hidden")) blocked = "metric_hidden";
  if (!blocked && metrics.some((m) => m.status === "warming")) blocked = "metric_warming";
  if (!blocked && d.rv > REGISTRY_VERSION) blocked = "registry_version";
  if (!blocked && spec.pinned && spec.pinned !== hashStored(stored)) blocked = "registry_conflict";
  const clauses = stored.all.map((c, i) => {
    const m = metrics[i];
    const dc = d.clauses[i];
    const xi = scaledInt(c.x, m.unit);
    const step = UNITS[m.unit].step;
    const h20 = m.subject === "window" ? 0 : band20(m.unit, xi, dc.h);
    return Object.freeze({
      i, m: c.m, metric: m, unit: m.unit, op: c.op, x: c.x, xi, h20, step, kind: m.kind, edge: m.edge, floor: dc.floor, zSpace: dc.zSpace,
      label: m.label, subject: m.subject,
    });
  });
  const canon = clauses.map((c) => canonicalJson(stored.all[c.i])).map((text, i) => ({ text, i })).sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  const anomaly = clauses.filter((c) => c.kind === "anomaly").map((c) => c.i);
  const lead = (canon.find((e) => clauses[e.i].kind === "anomaly") || canon[0]).i;
  const facts = clauses.filter((c) => c.kind === "fact").map((c) => c.i);
  const tails = anomaly.map((i) => (clauses[i].op === ">=" ? tUpper5(clauses[i].x) : tLower5(clauses[i].x)));
  return Object.freeze({
    id, version, layer, memberId, stream: layer === "house" ? "house" : memberId,
    cadence: stored.cadence, catchup: !!catchup, scope: stored.scope, persist: stored.persist, cooldown: stored.cooldown.n,
    control: d.control, q: d.q, registryVersion: d.rv, subjectKind: subjectKindOf(metrics),
    edge: metrics.some((m) => m.edge === "event") ? "event" : "state",
    clauses: Object.freeze(clauses), lead, anomaly: Object.freeze(anomaly), facts: Object.freeze(facts), pThr: tails.length ? Math.max(...tails) : null,
    clauseHash: hashClauses(stored.all), astHash: hashStored(stored), title, sentence, effectiveSession,
    status: spec.status || "armed", switch: spec.switch || "on", blocked, stored,
  });
}

export function expWeekCentsOf(compiled, scopeSize) {
  if (compiled.control !== "bh" || compiled.pThr === null || !Number.isInteger(scopeSize) || scopeSize < 1) return null;
  return expWeekCents(scopeSize, compiled.pThr, compiled.q);
}

export const expWeekOf = (compiled, scopeSize) => {
  const c = expWeekCentsOf(compiled, scopeSize);
  return c === null ? null : c / 100;
};

export function armingProblems(compiled, ctx = {}) {
  const out = [];
  if (compiled.layer !== "member") return out;
  const own = ctx.armed || [];
  if (own.length >= LIMITS.armedMemberWires) out.push("wire_limit");
  if (compiled.scope.kind === "universe" && own.filter((w) => w.scope.kind === "universe").length >= LIMITS.universeMemberWires) out.push("wire_limit");
  if (compiled.cadence === "live" && own.filter((w) => w.cadence === "live").length >= LIMITS.liveMemberWires) out.push("wire_limit");
  if (Number.isInteger(ctx.armedGlobal) && ctx.armedGlobal >= LIMITS.armedMemberWiresGlobal) out.push("wire_limit");
  const mine = expWeekCentsOf(compiled, ctx.scopeSize);
  if (mine !== null) {
    const spent = own.reduce((n, w) => n + (finite(w.expWeek) ? Math.round(w.expWeek * 100) : 0), 0);
    const b = LIMITS.budgetChoices.includes(ctx.budgetB) ? ctx.budgetB : LIMITS.budgetDefault;
    if (spent + mine > 100 * b) out.push("budget_exceeded");
  }
  return out;
}

export function scopeSizeOf(scope, ctx = {}, subjectKind = "n") {
  if (subjectKind === "s") return scope.kind === "sector" ? 1 : Number.isInteger(ctx.sectorCount) ? ctx.sectorCount : 11;
  if (scope.kind === "names") return scope.symbols.length;
  if (scope.kind === "universe") return Number.isInteger(ctx.universeSize) ? ctx.universeSize : ctx.universe instanceof Set ? ctx.universe.size : null;
  if (ctx.sectorSizes && Number.isInteger(ctx.sectorSizes[scope.sector])) return ctx.sectorSizes[scope.sector];
  if (ctx.sectorOf instanceof Map) {
    let n = 0;
    for (const v of ctx.sectorOf.values()) if (v === scope.sector) n++;
    return n || null;
  }
  return null;
}

export function prepareVersion(body, ctx = {}) {
  const v = validateBody(body, ctx);
  if (!v.ok) return Object.freeze({ ok: false, code: v.first, problem: v.problems[0], detail: v.errors[0].detail });
  const stored = storedBody(body);
  const metrics = body.all.map((c) => metricById(c.m));
  const subjectKind = subjectKindOf(metrics);
  const anomalies = body.all.filter((c, i) => metrics[i].kind === "anomaly");
  const tails = anomalies.map((c) => (c.op === ">=" ? tUpper5(c.x) : tLower5(c.x)));
  const size = scopeSizeOf(body.scope, ctx, subjectKind);
  const cents = tails.length && size ? expWeekCents(size, tails, stored.d.q) : null;
  if (ctx.armed) {
    const draft = { layer: "member", scope: body.scope, cadence: body.cadence, control: stored.d.control, pThr: tails.length ? Math.max(...tails) : null, q: stored.d.q };
    const problems = armingProblems(draft, { ...ctx, scopeSize: size });
    if (problems.length) return Object.freeze({ ok: false, code: errorCode(problems[0]), problem: problems[0], detail: "" });
  }
  const sentence = wireSentence(body, subjectKind);
  return Object.freeze({
    ok: true,
    version: Object.freeze({
      template: ctx.template || "custom", cadence: body.cadence, scope_kind: body.scope.kind, control: stored.d.control,
      exp_week: cents === null ? null : cents / 100, clause_hash: hashClauses(body.all), ast_json: canonicalJson(stored), ast_hash: hashStored(stored),
      sentence, registry_version: stored.d.rv, effective_session: ctx.now === undefined ? null : effectiveSession(body.cadence, ctx.now),
    }),
    title: titleOf(body, subjectKind),
    symbols: body.scope.kind === "names" ? body.scope.symbols.slice() : [],
    subjectKind,
  });
}

export const errorMessage = (code) => (ERROR_CODES[code] ? ERROR_CODES[code][1] : null);
