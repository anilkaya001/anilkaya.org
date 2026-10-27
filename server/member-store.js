import { MEMBER_LIMITS, DAY_MS } from "../shared/flows-member-state.js";
import { keyId, open, seal, pickSecret, secretUsable } from "../shared/flows-member-crypto.js";

const STATE_SQL =
  "SELECT member_id, wl_kid, wl_iv, wl_ct, wl_ver, device_only, seen_ms, visit_ms, prev_seen_ms, updated_ms FROM member_state WHERE member_id = ?1";

const PUT_SQL =
  "INSERT INTO member_state (member_id, wl_kid, wl_iv, wl_ct, wl_ver, device_only, updated_ms) " +
  "SELECT ?1, ?2, ?3, ?4, ?6, ?7, ?8 WHERE ?5 = 0 OR EXISTS (SELECT 1 FROM member_state WHERE member_id = ?1) " +
  "ON CONFLICT(member_id) DO UPDATE SET wl_kid = excluded.wl_kid, wl_iv = excluded.wl_iv, wl_ct = excluded.wl_ct, " +
  "wl_ver = excluded.wl_ver, device_only = excluded.device_only, updated_ms = excluded.updated_ms " +
  "WHERE member_state.wl_ver = ?5";

const VISIT_SQL =
  "INSERT INTO member_state (member_id, seen_ms, visit_ms, prev_seen_ms, updated_ms) VALUES (?1, ?2, ?2, NULL, ?2) " +
  "ON CONFLICT(member_id) DO UPDATE SET " +
  "prev_seen_ms = CASE WHEN member_state.seen_ms IS NOT NULL AND ?2 - member_state.seen_ms >= 1800000 THEN member_state.seen_ms ELSE member_state.prev_seen_ms END, " +
  "visit_ms = CASE WHEN member_state.seen_ms IS NULL OR ?2 - member_state.seen_ms >= 1800000 THEN ?2 ELSE member_state.visit_ms END, " +
  "seen_ms = ?2, updated_ms = ?2 " +
  "WHERE member_state.seen_ms IS NULL OR ?2 - member_state.seen_ms >= 60000";

const DELETE_SQL =
  "UPDATE member_state SET wl_kid = NULL, wl_iv = NULL, wl_ct = NULL, device_only = 0, seen_ms = NULL, visit_ms = NULL, prev_seen_ms = NULL, wl_ver = wl_ver + 1, updated_ms = ?2 " +
  "WHERE member_id = ?1 AND (wl_kid IS NOT NULL OR wl_ct IS NOT NULL OR device_only = 1 OR seen_ms IS NOT NULL OR visit_ms IS NOT NULL OR prev_seen_ms IS NOT NULL)";

const EXPORT_COUNT_SQL = "SELECT count(*) AS n FROM member_export WHERE member_id = ?1 AND at_ms > ?2 - 86400000";

const EXPORT_INSERT_SQL =
  "INSERT INTO member_export (member_id, page, n_rows, cols, at_ms) SELECT ?1, ?2, ?3, ?4, ?5 " +
  "WHERE (SELECT count(*) FROM member_export WHERE member_id = ?1 AND at_ms > ?5 - 86400000) < ?6";

const EXPORT_FREES_SQL =
  "SELECT at_ms FROM member_export WHERE member_id = ?1 AND at_ms > ?2 - 86400000 ORDER BY at_ms ASC LIMIT 1 OFFSET ?3";

const EXPORT_LIST_SQL =
  "SELECT page, n_rows, cols, at_ms FROM member_export WHERE member_id = ?1 AND at_ms >= ?2 ORDER BY at_ms DESC, id DESC LIMIT ?3";

const EXPORT_KEPT_SQL = "SELECT count(*) AS n, max(at_ms) AS last_ms FROM member_export WHERE member_id = ?1";

const EXPORT_PRUNE_SQL =
  "DELETE FROM member_export WHERE id IN (SELECT id FROM member_export WHERE at_ms < ?1 ORDER BY at_ms LIMIT 500)";

const SWEEP_SQL = "SELECT member_id, wl_kid, wl_iv, wl_ct, wl_ver FROM member_state WHERE wl_kid IS NOT NULL AND wl_kid <> ?1 LIMIT 50";

const RESEAL_SQL =
  "UPDATE member_state SET wl_kid = ?2, wl_iv = ?3, wl_ct = ?4 WHERE member_id = ?1 AND wl_ver = ?5 AND wl_kid = ?6";

const REMAINING_SQL = "SELECT count(*) AS n FROM member_state WHERE wl_kid IS NOT NULL AND wl_kid <> ?1";

const changes = (result) => (result && result.meta && Number.isFinite(Number(result.meta.changes)) ? Number(result.meta.changes) : 0);
const rowsOf = (result) => (result && Array.isArray(result.results) ? result.results : []);
const int = (v) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v) => (typeof v === "string" && v !== "" ? v : null);

export function shapeRow(raw) {
  if (raw === null || raw === undefined) return null;
  return {
    memberId: String(raw.member_id),
    kid: int(raw.wl_kid),
    iv: text(raw.wl_iv),
    ct: text(raw.wl_ct),
    version: int(raw.wl_ver) || 0,
    deviceOnly: int(raw.device_only) === 1,
    seenMs: int(raw.seen_ms),
    visitMs: int(raw.visit_ms),
    prevSeenMs: int(raw.prev_seen_ms),
    updatedMs: int(raw.updated_ms) || 0,
  };
}

async function sweep(d, now, secrets) {
  const pruned = changes(await d.prepare(EXPORT_PRUNE_SQL).bind(now - MEMBER_LIMITS.exportLogDays * DAY_MS).run());
  const current = secrets.find((s) => secretUsable(s));
  if (!current || secrets.filter((s) => secretUsable(s)).length < 2) return { pruned, resealed: 0, remaining: null };
  const kid = await keyId(current);
  const rows = rowsOf(await d.prepare(SWEEP_SQL).bind(kid).all());
  let resealed = 0;
  for (const r of rows) {
    const old = await pickSecret(secrets, int(r.wl_kid));
    if (old === null) continue;
    try {
      const version = int(r.wl_ver);
      const names = await open(old, String(r.member_id), version, r.wl_iv, r.wl_ct);
      const sealed = await seal(current, String(r.member_id), version, names);
      resealed += changes(await d.prepare(RESEAL_SQL).bind(r.member_id, sealed.kid, sealed.iv, sealed.ct, version, int(r.wl_kid)).run());
    } catch {
      continue;
    }
  }
  const left = await d.prepare(REMAINING_SQL).bind(kid).first();
  return { pruned, resealed, remaining: int(left && left.n) };
}

export function createMemberStore({ schemaSql }) {
  const ready = new WeakSet();

  const db = async (env) => {
    if (!env || !env.DB) return null;
    if (!ready.has(env.DB)) {
      await env.DB.batch(schemaSql.map((statement) => env.DB.prepare(statement)));
      ready.add(env.DB);
    }
    return env.DB;
  };

  return Object.freeze({
    async read(env, memberId) {
      const d = await db(env);
      if (d === null) return undefined;
      return shapeRow(await d.prepare(STATE_SQL).bind(memberId).first());
    },

    async put(env, memberId, { expected, kid, iv, ct, deviceOnly, now }) {
      const d = await db(env);
      if (d === null) return undefined;
      for (const value of [iv, ct]) if (value !== null && typeof value !== "string") throw new TypeError("a sealed value is bound as text, never as bytes");
      const [written, read] = await d.batch([
        d.prepare(PUT_SQL).bind(memberId, kid, iv, ct, expected, expected + 1, deviceOnly ? 1 : 0, now),
        d.prepare(STATE_SQL).bind(memberId),
      ]);
      return { ok: changes(written) === 1, row: shapeRow(rowsOf(read)[0] || null) };
    },

    async visit(env, memberId, now) {
      const d = await db(env);
      if (d === null) return undefined;
      const [written, read] = await d.batch([d.prepare(VISIT_SQL).bind(memberId, now), d.prepare(STATE_SQL).bind(memberId)]);
      const row = shapeRow(rowsOf(read)[0] || null);
      return { row, wrote: changes(written) === 1, newVisit: changes(written) === 1 && row !== null && row.visitMs === now };
    },

    async remove(env, memberId, now) {
      const d = await db(env);
      if (d === null) return undefined;
      const [state, kept] = await d.batch([d.prepare(DELETE_SQL).bind(memberId, now), d.prepare(EXPORT_KEPT_SQL).bind(memberId)]);
      const left = rowsOf(kept)[0] || {};
      return { state: changes(state), exports: int(left.n) || 0, lastExportMs: int(left.last_ms) };
    },

    async exportsInWindow(env, memberId, now) {
      const d = await db(env);
      if (d === null) return undefined;
      const row = await d.prepare(EXPORT_COUNT_SQL).bind(memberId, now).first();
      return int(row && row.n) || 0;
    },

    async exportFrees(env, memberId, now, used, cap) {
      const d = await db(env);
      if (d === null) return undefined;
      const row = await d.prepare(EXPORT_FREES_SQL).bind(memberId, now, Math.max(0, used - cap)).first();
      return row ? int(row.at_ms) + DAY_MS : null;
    },

    async logExport(env, memberId, { page, rows, cols, now, cap }) {
      const d = await db(env);
      if (d === null) return undefined;
      const written = await d.prepare(EXPORT_INSERT_SQL).bind(memberId, page, rows, cols.join(","), now, cap).run();
      return changes(written) === 1;
    },

    async listExports(env, memberId, now) {
      const d = await db(env);
      if (d === null) return undefined;
      const result = await d.prepare(EXPORT_LIST_SQL).bind(memberId, now - MEMBER_LIMITS.exportLogDays * DAY_MS, MEMBER_LIMITS.exportLogListMax).all();
      return rowsOf(result).map((r) => ({ page: String(r.page), rows: int(r.n_rows) || 0, cols: String(r.cols).split(","), atMs: int(r.at_ms) || 0 }));
    },

    async housekeeping(env, now, secrets = []) {
      const none = { pruned: 0, resealed: 0, remaining: null };
      if (!env || !env.DB) return none;
      try {
        return await sweep(env.DB, now, secrets);
      } catch (error) {
        if (/no such table/i.test(String(error && error.message))) return none;
        throw error;
      }
    },
  });
}
