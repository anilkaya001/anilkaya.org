import { DatabaseSync } from "node:sqlite";
import { METRICS } from "../../shared/ff-contract.js";
import { FF_SCHEMA_SQL } from "../../shared/ff-schema.js";

export const SECTORS = Object.freeze(["Technology", "Energy", "Utilities", "Financials", "Health Care", "Industrials"]);

export const symbolOf = (i) => "SY" + String.fromCharCode(65 + (Math.floor(i / 1000) % 26)) + String(i % 1000).padStart(3, "0");

export const symbolsOf = (n) => Array.from({ length: n }, (_, i) => symbolOf(i));

export const occOf = (symbol, k = 0) => symbol + "260918C" + String(100000 + k * 500).padStart(8, "0");

const KEYS = Array.from(new Set(METRICS.flatMap((m) => ["nightly", "live"].map((c) => (m.source[c] ? m.source[c].key : null)).filter(Boolean))));

export function snapshotOf(world, M) {
  const { kind = "nightly", session, symbols = [], sectorOf = null, cols = {}, n = null, floored = null, why = null, windows = [], sectors = null, truncated = null } = world;
  const nightlyAsOf = M.session.nightlyAsOf(session);
  const asOf = world.asOf ?? (kind === "nightly" ? nightlyAsOf : world.now);
  const now = world.now ?? (kind === "nightly" ? nightlyAsOf + 45 * 60000 : Date.parse(session + "T15:00:00Z"));
  const sources = world.sources ?? Object.fromEntries(KEYS.map((k) => [k, { session, asOf: now - 60000 }]));
  return {
    v: 1, kind, session, asOf, now, look: world.look ?? 0, evaluator: world.evaluator ?? kind, evaluatorVersion: world.evaluatorVersion,
    sources, symbols, sector: sectorOf ?? symbols.map((_, i) => SECTORS[i % SECTORS.length]), cols, n, floored, why, windows, sectors, truncated,
  };
}

const HIT_COLUMNS = "stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state";
const STATE_COLUMNS = "wire_id, subject, version, phase, cnt, last_session, cool_until, detector_json";
const RECEIPT_COLUMNS = "wire_id, version, session, status, reason, looks, looks_expected, names_evaluated, names_absent, absent_json, hits, hits_capped, late, evaluated_at, run_id";

const marks = (n) => Array.from({ length: n }, () => "?").join(", ");

export class Store {
  static mirror = false;

  constructor() {
    this.rows = new Map();
    this.hits = [];
    this.keys = new Set();
    this.receipts = new Map();
    this.firstLook = new Map();
    this.conflicts = 0;
    this.writes = 0;
    this.bySession = new Map();
    this.db = null;
    if (Store.mirror) {
      this.db = new DatabaseSync(":memory:");
      for (const statement of FF_SCHEMA_SQL) this.db.exec(statement);
      this.seq = new Map();
      this.insertHit = this.db.prepare(`INSERT INTO ff_hit (${HIT_COLUMNS}) VALUES (${marks(18)})`);
      this.upsertState = this.db.prepare(`INSERT OR REPLACE INTO ff_state (${STATE_COLUMNS}) VALUES (${marks(8)})`);
      this.deleteState = this.db.prepare("DELETE FROM ff_state WHERE wire_id = ? AND subject = ?");
      this.upsertReceipt = this.db.prepare(`INSERT OR REPLACE INTO ff_receipt (${RECEIPT_COLUMNS}) VALUES (${marks(15)})`);
    }
  }

  mirrorOut(result, merged) {
    this.db.exec("BEGIN");
    try {
      for (const h of result.hits) {
        const seq = (this.seq.get(h.stream) || 0) + 1;
        this.seq.set(h.stream, seq);
        this.insertHit.run(h.stream, seq, h.hit_id, h.wire_id, h.wire_version, h.member_id, h.subject, h.symbol, h.sector, h.dedupe_key, h.session, h.session_label, h.fired_at, h.data_as_of, h.evaluator, h.evaluator_version, h.evidence_json, h.state);
      }
      for (const d of result.state.deletes) this.deleteState.run(d.wire_id, d.subject);
      for (const u of result.state.upserts) this.upsertState.run(u.wire_id, u.subject, u.version, u.phase, u.cnt, u.last_session, u.cool_until, u.detector_json);
      for (const r of merged) this.upsertReceipt.run(r.wire_id, r.version, r.session, r.status, r.reason, r.looks, r.looks_expected, r.names_evaluated, r.names_absent, r.absent_json, r.hits, r.hits_capped, r.late, r.evaluated_at, r.run_id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  options(session, extra = {}) {
    const used = { wire: new Map(), member: new Map(), global: 0 };
    for (const h of this.hits) {
      if (h.session !== session) continue;
      used.wire.set(h.wire_id, (used.wire.get(h.wire_id) || 0) + 1);
      if (h.member_id) {
        used.member.set(h.member_id, (used.member.get(h.member_id) || 0) + 1);
        used.global++;
      }
    }
    return { state: Array.from(this.rows.values()), existingKeys: new Set(this.keys), firstLook: new Map(this.firstLook), capUsed: used, ...extra };
  }

  apply(result, snapshot) {
    const accepted = [];
    const merged = [];
    for (const h of result.hits) {
      const k = h.wire_id + "|" + h.dedupe_key;
      if (this.keys.has(k)) {
        this.conflicts++;
        continue;
      }
      this.keys.add(k);
      this.hits.push(h);
      accepted.push(h);
      this.writes++;
    }
    for (const d of result.state.deletes) {
      this.rows.delete(d.wire_id + "\u0000" + d.subject);
      this.writes++;
    }
    for (const u of result.state.upserts) {
      this.rows.set(u.wire_id + "\u0000" + u.subject, u);
      this.writes++;
    }
    for (const r of result.receipts) {
      const key = r.wire_id + "@" + r.version + "@" + r.session;
      const prev = this.receipts.get(key);
      if (r.mode === "accumulate" && prev) this.receipts.set(key, { ...r, looks: prev.looks + 1, hits: prev.hits + r.hits, hits_capped: prev.hits_capped + r.hits_capped });
      else this.receipts.set(key, { ...r });
      merged.push(this.receipts.get(key));
      if (r.status === "evaluated" && !this.firstLook.has(r.wire_id + "@" + r.version)) this.firstLook.set(r.wire_id + "@" + r.version, r.session);
      this.writes++;
    }
    if (this.db) this.mirrorOut({ hits: accepted, state: result.state }, merged);
    return result;
  }

  run(M, snapshot, wires, extra = {}) {
    const result = M.engine.evaluate(snapshot, wires, this.options(snapshot.session, extra));
    return this.apply(result, snapshot);
  }

  hitsOf(wireId) {
    return this.hits.filter((h) => h.wire_id === wireId);
  }

  rowOf(wireId, subject) {
    return this.rows.get(wireId + "\u0000" + subject) || null;
  }
}

export function sessionsFrom(M, start, count) {
  const out = [start];
  while (out.length < count) out.push(M.session.nextSession(out[out.length - 1]));
  return out;
}

export function wireOf(M, { id, layer = "member", memberId = "member01", version = 1, body, catchup = false, over = {} }) {
  return M.grammar.compileWire({ id, layer, memberId: layer === "house" ? null : memberId, version, body, catchup, sentence: "When the condition holds.", ...over });
}

export const bodyOf = (cadence, all, over = {}) => ({
  v: 1, cadence, scope: { kind: "universe" }, all, persist: 1, cooldown: { unit: "session", n: cadence === "live" ? 1 : 5 }, ...over,
});
