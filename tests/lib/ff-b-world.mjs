import { createHash } from "node:crypto";
import { fakeD1 } from "./d1-fake.mjs";
import { coreDouble, universeOf } from "./ff-b-core.mjs";
import { base32Lower } from "../../shared/ff-contract.js";

export const NOW = Date.parse("2026-10-27T15:30:00Z");
export const SESSION = "2026-10-27";
export const PREV_SESSION = "2026-10-26";
export const HOST = "https://flows.test";

export const NAMES = ["SYA101", "SYA102", "SYB201", "SYB202", "SYC301", "SYC302", "SYD401", "SYD402", "SYE501", "SYE502"];
export const SECTORS = ["Technology", "Energy"];

export const alice = { username: "alice.one", exp: NOW + 86400000, epoch: "1" };
export const bob = { username: "bob.two", exp: NOW + 86400000, epoch: "1" };
export const carol = { username: "carol.three", exp: NOW + 86400000, epoch: "1" };

export const universePayload = (names = NAMES) => ({
  v: 2, status: "ok", sessionDate: PREV_SESSION, generatedAt: "2026-10-26T22:30:00.000Z", n: names.length, t: names,
  sectors: SECTORS, sec: names.map((_, i) => i % 2), cols: {}, units: {},
});

export const metricsPayload = (names = NAMES, over = {}) => ({
  v: 1, sessionDate: PREV_SESSION, generatedAt: "2026-10-26T22:50:00.000Z", registryVersion: 1, t: names,
  cols: {
    "flow.net_premium.z20": names.map((_, i) => i * 100),
    "earn.sessions": names.map((_, i) => 3 + i),
    "earn.confirmed": names.map(() => 1),
    "vol.iv.30d.chg1d": names.map((_, i) => (i === 3 ? null : i * 10)),
  },
  n: { "flow.net_premium.z20": names.map(() => 20) }, f: {}, why: {}, sectors: {}, windows: [], ...over,
});

const sha = (text) => createHash("sha256").update(text, "utf8").digest();

export const hitIdOf = (wireId, key) => base32Lower(sha(wireId + "|" + key)).slice(0, 20);

export function seedWire(f, o) {
  const {
    member = null, id, title = "A wire", status = "armed", version = 1, cadence = "nightly", scopeKind = "names", control = "fact", exp = null,
    symbols = ["SYA101"], sentence = "When a clause holds", clauseHash = "0123456789", astHash = "a".repeat(64), createdAt = NOW - 86400000, template = "custom",
    astJson = null, effective = PREV_SESSION, origin = null,
  } = o;
  const layer = member === null ? "house" : "member";
  f.db.prepare("INSERT INTO ff_wire (id, layer, member_id, title, status, status_at, current_version, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, layer, member, title, status, createdAt, version, origin, createdAt);
  for (let n = 1; n <= version; n++) {
    const body = astJson || JSON.stringify({ v: 1, cadence, scope: scopeKind === "names" ? { kind: "names", symbols: [...symbols].sort() } : { kind: scopeKind, sector: "Technology" },
      all: [{ m: "contract.dte", op: "<=", x: 21 }], persist: 1, cooldown: { unit: "session", n: 1 } });
    f.db.prepare("INSERT INTO ff_wire_version (wire_id, version, template, cadence, scope_kind, control, exp_week, clause_hash, ast_json, ast_hash, sentence, registry_version, effective_session, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
      .run(id, n, template, cadence, scopeKind, control, exp, clauseHash, body, n === version ? astHash : (String(n).repeat(64)).slice(0, 64), n === version ? sentence : sentence + " v" + n, effective, createdAt);
  }
  if (member !== null && scopeKind === "names" && status !== "retired") {
    for (const s of symbols) f.db.prepare("INSERT INTO ff_wire_symbol (member_id, symbol, wire_id) VALUES (?, ?, ?)").run(member, s, id);
  }
  return id;
}

export function seedHit(f, o) {
  const { stream, wire, version = 1, symbol = "SYA101", session = SESSION, firedAt = NOW - 60000, dataAsOf = firedAt - 12000, key = null, state = "delivered",
    evaluator = "nightly", evidence = null, label = "open+12m", subject = null, member = undefined } = o;
  const seq = o.seq ?? (f.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM ff_hit WHERE stream = ?").get(stream).n);
  const subj = subject || "n:" + symbol;
  const dedupe = key || `${subj}:${session}:${stream === "house" ? "" : "0123456789"}:${seq}`;
  const hitId = o.hitId || hitIdOf(wire, dedupe);
  const ev = evidence || JSON.stringify({ sentence: `${symbol} net premium crossed above 3.00σ`, key: "z 3.42", clauses: [{ m: "flow.net_premium.z20", value: 3.42, x: 3 }] });
  const memberId = member === undefined ? (stream === "house" ? null : stream) : member;
  f.db.prepare("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'e1', ?, ?)")
    .run(stream, seq, hitId, wire, version, memberId, subj, symbol, dedupe, session, label, firedAt, dataAsOf, evaluator, ev, state);
  return { hitId, seq };
}

export function seedRun(f, o) {
  const { id, kind, session, status = "done", slot = "n", startedAt = NOW - 600000, finishedAt = NOW - 300000, error = null, attempts = 1, hitsWritten = 0 } = o;
  f.db.prepare("INSERT INTO ff_run (id, kind, session, slot, status, attempts, started_at, finished_at, error, wires_evaluated, names_evaluated, hits_written, unknown_count, rows_read, rows_written) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 5, 100, ?, 3, 40, 12)")
    .run(id, kind, session, slot, status, attempts, startedAt, status === "done" ? finishedAt : null, error, hitsWritten);
}

export function seedReceipt(f, o) {
  const { wire, version = 1, session = PREV_SESSION, status = "evaluated", reason = null, looks = 1, looksExpected = 1, namesEvaluated = 10, namesAbsent = 0, absent = null, hits = 0, hitsCapped = 0, late = 0, evaluatedAt = NOW - 3600000 } = o;
  f.db.prepare("INSERT INTO ff_receipt (wire_id, version, session, status, reason, looks, looks_expected, names_evaluated, names_absent, absent_json, hits, hits_capped, late, evaluated_at, upgraded_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)")
    .run(wire, version, session, status, status === "evaluated" ? null : reason || "run_late", looks, looksExpected, namesEvaluated, namesAbsent, absent, hits, hitsCapped, late, evaluatedAt);
}

export function seedRecord(f, o) {
  const { wire, version = 1, period = "all", firings = 0, sessions = 0, budget = null, placebo = null, placeboN = null, confirmation = null, confirmN = null, p50 = null, p95 = null, coverage = null, nullReasons = null, updatedAt = NOW - 7200000 } = o;
  f.db.prepare("INSERT INTO ff_record (wire_id, version, period, firings, sessions, budget, placebo, placebo_n, confirmation, confirm_n, lat_p50_s, lat_p95_s, coverage, null_reasons, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(wire, version, period, firings, sessions, budget, placebo, placeboN, confirmation, confirmN, p50, p95, coverage, nullReasons, updatedAt);
}

export function makeWorld({ now = NOW, env = {}, names = NAMES } = {}) {
  const f = fakeD1();
  f.put("universe", universePayload(names));
  f.put("ff-metrics", metricsPayload(names));
  const core = coreDouble();
  const universe = universeOf(names, SECTORS);
  const full = { DB: f.D1, FF_MODE: "on", FF_ROUTE_WIRES: "on", FF_ROUTE_INBOX: "on", FF_ROUTE_FIRE: "on", FF_ROUTE_EXPORT: "on", ...env };
  return { f, core, universe, env: full, now };
}

export const astOf = (over = {}) => ({
  v: 1, cadence: "nightly", scope: { kind: "names", symbols: ["SYA101", "SYA102"] },
  all: [{ m: "earn.sessions", op: "<=", x: 10 }, { m: "earn.confirmed", op: "==", x: 1 }], persist: 1, ...over,
});

export const liveAst = (over = {}) => ({
  v: 1, cadence: "live", scope: { kind: "names", symbols: ["SYA101"] },
  all: [{ m: "contract.dte", op: "<=", x: 21 }, { m: "contract.premium", op: ">=", x: 1000000 }], persist: 1, ...over,
});

export const anomalyAst = (over = {}) => ({
  v: 1, cadence: "nightly", scope: { kind: "names", symbols: ["SYA101"] },
  all: [{ m: "flow.net_premium.z20", op: ">=", x: 3 }], persist: 1, ...over,
});
