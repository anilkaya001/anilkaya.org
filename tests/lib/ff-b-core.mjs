import { createHash, randomBytes } from "node:crypto";
import {
  AST_GRAMMAR, AST_VERSION, ID_RULES, LIMITS, METRICS, OPS, REGISTRY_VERSION, SYMBOL_RE, UNITS, base32Lower, canonicalJson, clauseCanon, hitIdInput,
} from "../../shared/ff-contract.js";

const sha = (text) => createHash("sha256").update(text, "utf8").digest();
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const multiple = (x, step) => Math.abs(x / step - Math.round(x / step)) < 1e-9;
const metricOf = (id) => METRICS.find((m) => m.id === id) || null;
const sameKeys = (value, want) => JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...want].sort());

const fail = (code, detail) => ({ ok: false, code, detail });

export const TEST_SESSION_DAY = "2026-10-26";

function check(body, universe) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return fail("ff_grammar_invalid", "body");
  for (const k of Object.keys(body)) if (AST_GRAMMAR.rejectedFromClient.includes(k)) return fail("ff_grammar_invalid", "client_derived_field");
  const allowed = [...AST_GRAMMAR.body];
  const keys = Object.keys(body);
  if (keys.some((k) => !allowed.includes(k)) || allowed.some((k) => k !== "cooldown" && !keys.includes(k))) return fail("ff_grammar_invalid", "keys");
  if (body.v !== AST_VERSION) return fail("ff_grammar_invalid", "version");
  if (body.cadence === "rail") return fail("ff_scope_reserved", "rail");
  if (body.cadence !== "nightly" && body.cadence !== "live") return fail("ff_grammar_invalid", "cadence");
  const scope = body.scope;
  if (scope === null || typeof scope !== "object") return fail("ff_grammar_invalid", "scope");
  if (scope.kind === "watchlist") return fail("ff_scope_reserved", "watchlist");
  if (!AST_GRAMMAR.scope[scope.kind] || !sameKeys(scope, AST_GRAMMAR.scope[scope.kind])) return fail("ff_grammar_invalid", "scope");
  if (scope.kind === "names") {
    const s = scope.symbols;
    if (!Array.isArray(s) || s.length < 1 || s.length > LIMITS.symbolsMax || new Set(s).size !== s.length
      || JSON.stringify([...s].sort()) !== JSON.stringify(s) || !s.every((x) => new RegExp(SYMBOL_RE).test(x))) return fail("ff_grammar_invalid", "symbols");
    for (const sym of s) if (!universe.symbols.has(sym)) return fail("ff_symbol_outside_universe", sym);
  }
  if (scope.kind === "sector" && !universe.sectors.has(scope.sector)) return fail("ff_grammar_invalid", "sector");
  if (!Array.isArray(body.all) || body.all.length < LIMITS.clausesMin || body.all.length > LIMITS.clausesMax) return fail("ff_grammar_invalid", "clauses");
  const per = {};
  let anomaly = false;
  for (const c of body.all) {
    if (c === null || typeof c !== "object" || !sameKeys(c, AST_GRAMMAR.clause)) return fail("ff_grammar_invalid", "clause");
    const m = metricOf(c.m);
    if (!m) return fail("ff_grammar_invalid", "metric");
    if (!(m.status === "ready" || m.status === "limited") || !m.cadence.includes(body.cadence)) return fail("ff_metric_unavailable", c.m);
    if (!OPS.includes(c.op)) return fail("ff_grammar_invalid", "op");
    if (typeof c.x !== "number" || !Number.isFinite(c.x) || c.x < m.range[0] || c.x > m.range[1]) return fail("ff_grammar_invalid", "range");
    if (!multiple(c.x, UNITS[m.unit].xStep)) return fail("ff_grammar_precision", c.m);
    per[c.m] = (per[c.m] || 0) + 1;
    if (per[c.m] > LIMITS.clausesPerMetric) return fail("ff_grammar_invalid", "per_metric");
    if (m.kind === "anomaly") anomaly = true;
  }
  const range = body.cadence === "live" ? LIMITS.persistLive : LIMITS.persistNightly;
  if (!Number.isInteger(body.persist) || body.persist < range[0] || body.persist > range[1]) return fail("ff_grammar_invalid", "persist");
  const cd = body.cooldown === undefined ? { unit: LIMITS.cooldownUnit, n: LIMITS.cooldownDefault[body.cadence] } : body.cooldown;
  if (cd === null || typeof cd !== "object" || !sameKeys(cd, AST_GRAMMAR.cooldown) || cd.unit !== LIMITS.cooldownUnit
    || !(LIMITS.cooldownChoices[body.cadence] || []).includes(cd.n)) return fail("ff_grammar_invalid", "cooldown");
  return { ok: true, anomaly, cooldown: cd };
}

const sentenceOf = (body) => {
  const where = body.scope.kind === "universe" ? "any name" : body.scope.kind === "sector" ? "the " + body.scope.sector + " sector" : body.scope.symbols.join(", ");
  const parts = body.all.map((c) => `${metricOf(c.m).label} ${c.op} ${c.x}`);
  return `When ${parts.join(" and ")} on ${where}`.slice(0, LIMITS.sentenceChars);
};

const expWeekOf = (scope) => (scope.kind === "names" ? 0.25 * scope.symbols.length : scope.kind === "sector" ? 1.5 : 2);

export function coreDouble({ session = TEST_SESSION_DAY, ids = null } = {}) {
  let counter = 0;
  let sessionDay = session;
  const idBytes = ids || (() => randomBytes(10));
  return {
    async compile({ body, templateHint = null, universe }) {
      const checked = check(body, universe);
      if (!checked.ok) return checked;
      const stored = {
        ...body,
        cooldown: checked.cooldown,
        d: {
          rv: REGISTRY_VERSION,
          control: checked.anomaly ? "bh" : "fact",
          q: LIMITS.bhQ,
          clauses: body.all.map((c) => ({ step: UNITS[metricOf(c.m).unit].step, h: metricOf(c.m).h || UNITS[metricOf(c.m).unit].h, floor: null, zSpace: null })),
        },
      };
      const ast_json = canonicalJson(stored);
      const exp_week = checked.anomaly ? expWeekOf(body.scope) : null;
      return {
        ok: true,
        version: {
          template: templateHint || "custom",
          cadence: body.cadence,
          scope_kind: body.scope.kind,
          control: checked.anomaly ? "bh" : "fact",
          exp_week,
          clause_hash: hex(sha(clauseCanon(body.all))).slice(0, ID_RULES.clauseHashLength),
          ast_json,
          ast_hash: hex(sha(ast_json)),
          sentence: sentenceOf(body),
          registry_version: REGISTRY_VERSION,
        },
        symbols: body.scope.kind === "names" ? [...body.scope.symbols] : [],
      };
    },
    effectiveSession() { return sessionDay; },
    setSession(day) { sessionDay = day; },
    newWireId() { counter += 1; return "w-" + base32Lower(idBytes(counter)).slice(0, 16); },
    hitId(wireId, key) { return base32Lower(sha(hitIdInput(wireId, key))).slice(0, ID_RULES.hitIdLength); },
    async preview({ compiled, snapshot }) {
      const m = snapshot && snapshot.metrics;
      if (!m || !Array.isArray(m.t)) return { status: "unavailable", reason: "missing", subjects: [] };
      const body = JSON.parse(compiled.version.ast_json);
      const names = body.scope.kind === "names" ? body.scope.symbols : m.t;
      const subjects = [];
      for (const sym of names) {
        const i = m.t.indexOf(sym);
        if (i < 0) { subjects.push({ subject: "n:" + sym, symbol: sym, verdict: "unknown", reason: "not_carded", clauses: [] }); continue; }
        const clauses = body.all.map((c) => {
          const raw = m.cols && m.cols[c.m] ? m.cols[c.m][i] : null;
          if (raw === null || raw === undefined) return { m: c.m, op: c.op, x: c.x, value: null, ok: null };
          const unit = UNITS[metricOf(c.m).unit];
          const value = raw * unit.step;
          return { m: c.m, op: c.op, x: c.x, value, ok: c.op === ">=" ? value >= c.x : c.op === "<=" ? value <= c.x : value === c.x };
        });
        const verdict = clauses.some((c) => c.ok === false) ? "false" : clauses.some((c) => c.ok === null) ? "unknown" : "true";
        subjects.push({ subject: "n:" + sym, symbol: sym, verdict, reason: verdict === "unknown" ? "missing" : null, clauses });
      }
      return { status: "ok", sessionDate: m.sessionDate, subjects };
    },
  };
}

export const universeOf = (symbols, sectors = ["Technology", "Energy"]) => ({ symbols: new Set(symbols), sectors: new Set(sectors) });
