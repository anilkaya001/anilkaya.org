import { METRICS } from "../../shared/ff-contract.js";

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

export class Store {
  constructor() {
    this.rows = new Map();
    this.hits = [];
    this.keys = new Set();
    this.receipts = new Map();
    this.firstLook = new Map();
    this.conflicts = 0;
    this.writes = 0;
    this.bySession = new Map();
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
    for (const h of result.hits) {
      const k = h.wire_id + "|" + h.dedupe_key;
      if (this.keys.has(k)) {
        this.conflicts++;
        continue;
      }
      this.keys.add(k);
      this.hits.push(h);
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
      if (r.status === "evaluated" && !this.firstLook.has(r.wire_id + "@" + r.version)) this.firstLook.set(r.wire_id + "@" + r.version, r.session);
      this.writes++;
    }
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
