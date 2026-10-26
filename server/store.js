import { nightlyFreshMeta, TICKER_RE } from "../shared/flows-live.js";
import { NIGHTLY_ROW_SQL, nightlyLedger, batchWithLedger } from "../shared/flows-live-worker.js";
import { DOOR_LIMITS } from "../shared/flows-door.js";
import { errorText } from "../shared/flows-log.js";
import { packText, unpackText } from "../shared/flows-card-pack.js";

export const DATED_ARCHIVE_KEY_RE = /^(board:(long|short)|scores):\d{4}-\d{2}-\d{2}$/;

export const INGEST_VIEW_KEY_RE = /^board:(long|short|watch)$|^board:(long|short):\d{4}-\d{2}-\d{2}$|^scores:\d{4}-\d{2}-\d{2}$|^scoretrack$|^calib$|^dispersion$|^deepen$|^reports$|^oracle-top$|^oracle-norm$|^flowalerts$|^pulse$|^political$|^record$|^movers$|^market$|^unusual$|^events$|^sector:trix$|^sector:premium$|^news$|^brief$|^meta$|^universe$|^regime$|^ideas$|^ideas(-out)?:\d{4}-\d{2}-\d{2}(:r\d+)?$|^focus$|^roster$/;

export const INGEST_META_KEYS_MAX = 96;
export const INGEST_LIST_KINDS = Object.freeze(["card", "card-x", "hist"]);
export const INGEST_LIST_MAX = 2000;

const INGEST_META_SQL =
  "SELECT id, updated_at, length(payload) AS bytes, json_extract(payload, '$.sessionDate') AS session, " +
  "json_extract(payload, '$.generatedAt') AS generated, json_extract(payload, '$.status') AS status " +
  "FROM flows_payload WHERE id IN (";

export const coverageSql = (keys) => "SELECT id, updated_at, length(payload) AS bytes, " +
  "CASE WHEN json_valid(payload) THEN json_extract(payload, '$.sessionDate') END AS session, " +
  "CASE WHEN id = 'deepen' AND json_valid(payload) THEN json_extract(payload, '$.summary') END AS summary " +
  "FROM flows_payload WHERE id IN (" + keys.map((k) => `'${k}'`).join(", ") + ")";

const ARCHIVE_INSERT_SQL =
  "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING";

const UPSERT_SQL =
  "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, " +
  "chash = NULL, session = NULL, quality = 0, epoch = 0, asof = 0, rev = flows_payload.rev + 1";

const DELETE_SQL = "DELETE FROM flows_payload WHERE id = ?";

const DOOR_UPSERT_SQL =
  "INSERT INTO flows_payload (id, payload, updated_at, chash, session, quality, epoch, asof, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) " +
  "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, chash = excluded.chash, " +
  "session = excluded.session, quality = excluded.quality, epoch = excluded.epoch, asof = excluded.asof, rev = flows_payload.rev + 1";

const DOOR_CAS_SQL =
  " WHERE flows_payload.chash IS NOT excluded.chash AND (excluded.epoch, COALESCE(excluded.session, ''), excluded.quality, excluded.asof) >= " +
  "(COALESCE(flows_payload.epoch, 0), COALESCE(flows_payload.session, ''), COALESCE(flows_payload.quality, 0), COALESCE(flows_payload.asof, 0))";

const DOOR_TUPLE_SQL =
  "SELECT id, chash, session, quality, epoch, asof, rev, length(payload) AS bytes FROM flows_payload WHERE id IN (";

const UNIVERSE_NAMES_SQL = "SELECT json_extract(payload, '$.t') AS names FROM flows_payload WHERE id = 'universe'";

const HAVE_SQL = "SELECT id, chash FROM flows_payload WHERE id IN (";

const PLAN_UPSERT_SQL =
  "INSERT INTO flows_payload (id, payload, updated_at) VALUES ('plan', ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at " +
  "WHERE COALESCE(json_extract(flows_payload.payload, '$.session'), '') <= COALESCE(json_extract(excluded.payload, '$.session'), '')";

const PLAN_READ_SQL = "SELECT payload, updated_at FROM flows_payload WHERE id = 'plan'";

const RING_INSERT_SQL =
  "INSERT INTO flows_quarantine (payload_key, chash, reason, path, bytes, producer, mode, at, braked, body) " +
  "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CASE WHEN b.n >= ?9 THEN 1 ELSE 0 END, CASE WHEN b.n >= ?9 THEN NULL ELSE ?10 END " +
  "FROM (SELECT count(*) AS n FROM flows_quarantine WHERE id > COALESCE((SELECT max(id) FROM flows_quarantine), 0) - ?11 " +
  "AND producer = ?6 AND reason = ?3) AS b";

const RING_PRUNE_SQL =
  "DELETE FROM flows_quarantine WHERE id <= COALESCE((SELECT max(id) FROM flows_quarantine), 0) - ?";

const RING_CLEAR_SQL =
  "UPDATE flows_quarantine SET body = NULL WHERE body IS NOT NULL " +
  "AND id <= COALESCE((SELECT max(id) FROM flows_quarantine), 0) - ?1 " +
  "AND id > COALESCE((SELECT max(id) FROM flows_quarantine), 0) - ?1 - ?2";

const TRANSIENT_RE = /quota|exceeded|overload|time[ds]? ?out|temporar|unavailable|network|connection|reset|locked|busy|internal error|\b7500\b|too many requests/i;

const marks = (n) => Array.from({ length: n }, () => "?").join(", ");

const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export function ingestKeyParts(key) {
  const tickerKey = /^(card|card-x|hist|oracle):/.exec(key);
  const card = tickerKey ? key.slice(tickerKey[0].length) : null;
  return { tickerKey, valid: card !== null ? TICKER_RE.test(card) : INGEST_VIEW_KEY_RE.test(key) };
}

export function ingestListSql(kinds) {
  return "SELECT id, updated_at, json_extract(payload, '$.sessionDate') AS session, json_extract(payload, '$.generatedAt') AS generated, " +
    "json_extract(payload, '$.status') AS status FROM flows_payload WHERE " +
    kinds.map((k) => `(id >= '${k}:' AND id < '${k};')`).join(" OR ") + ` LIMIT ${INGEST_LIST_MAX + 1}`;
}

export function ingestListing(rows) {
  const keys = {};
  let n = 0;
  for (const r of rows.slice(0, INGEST_LIST_MAX)) {
    if (!ingestKeyParts(r.id).valid || r.status === "pending") continue;
    keys[r.id] = { present: true, sessionDate: typeof r.session === "string" ? r.session : null,
      generatedAt: typeof r.generated === "string" ? r.generated : null, updatedAt: Number(r.updated_at) || 0 };
    n++;
  }
  return { keys, listed: n, truncated: rows.length > INGEST_LIST_MAX };
}

export function ingestMetadata(asked, rows) {
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  const keys = {};
  for (const key of asked) {
    const r = byId.get(key);
    keys[key] = r && r.status !== "pending"
      ? { present: true, sessionDate: typeof r.session === "string" ? r.session : null,
          generatedAt: typeof r.generated === "string" ? r.generated : null,
          updatedAt: Number(r.updated_at) || 0, bytes: Number(r.bytes) || 0 }
      : { present: false };
  }
  return keys;
}

const CARD_X_KEY_RE = /^card-x:/;

const toStored = (env, key, text) => (env && env.FLOWS_CARDX_PACK === "on" && CARD_X_KEY_RE.test(key) ? packText(text) : text);

export const storedFrom = (row, key = row && row.id) => {
  if (!row || !row.payload) return null;
  const payload = typeof key === "string" && CARD_X_KEY_RE.test(key) ? unpackText(row.payload) : row.payload;
  return payload === null ? null : { payload, updatedAt: row.updated_at, fresh: nightlyFreshMeta(row) };
};

export function createFlowsStore({ ensureFlowsTables }) {
  return Object.freeze({
    async read(env, key, trace) {
      if (!env.DB) { if (trace) trace.failed = true; return null; }
      await ensureFlowsTables(env);
      const row = await env.DB.prepare(NIGHTLY_ROW_SQL).bind(key).first()
        .catch(() => { if (trace) trace.failed = true; return null; });
      return storedFrom(row, key);
    },

    async readMany(env, keys) {
      if (!env.DB) return null;
      await ensureFlowsTables(env);
      const sql = NIGHTLY_ROW_SQL.replace("payload, updated_at,", "id, payload, updated_at,").replace("WHERE id = ?", "WHERE id IN (" + marks(keys.length) + ")");
      const rows = await env.DB.prepare(sql).bind(...keys).all().catch(() => null);
      if (!rows) return null;
      return new Map((rows.results || []).map((r) => [r.id, storedFrom(r)]));
    },

    async metadata(env, asked) {
      const rows = await env.DB.prepare(INGEST_META_SQL + asked.map(() => "?").join(", ") + ")").bind(...asked).all()
        .catch(() => null);
      return rows ? ingestMetadata(asked, rows.results) : null;
    },

    async listing(env, kinds) {
      const rows = await env.DB.prepare(ingestListSql(kinds)).all().catch(() => null);
      return rows ? ingestListing(rows.results || []) : null;
    },

    async remove(env, key) {
      const result = await env.DB.prepare(DELETE_SQL).bind(key).run();
      return result && result.meta ? Number(result.meta.changes) || 0 : 0;
    },

    async createArchive(env, key, payload, at) {
      const written = await env.DB.prepare(ARCHIVE_INSERT_SQL).bind(key, payload, at).run();
      return written && written.meta ? Number(written.meta.changes) || 0 : 0;
    },

    async write(env, key, payload, at) {
      const upsert = env.DB.prepare(UPSERT_SQL).bind(key, toStored(env, key, payload), at);
      const landing = key === "meta" ? nightlyLedger(env.DB, JSON.parse(payload), at) : null;
      if (landing) await batchWithLedger(env.DB, [upsert], landing);
      else await upsert.run();
    },

    async doorRead(env, ids, { names = false } = {}) {
      const groups = chunks(ids, DOOR_LIMITS.haveItems);
      const statements = groups.map((g) => env.DB.prepare(DOOR_TUPLE_SQL + marks(g.length) + ")").bind(...g));
      if (names) statements.push(env.DB.prepare(UNIVERSE_NAMES_SQL));
      if (!statements.length) return { stored: new Map(), names: null };
      const results = await env.DB.batch(statements);
      const stored = new Map();
      for (let i = 0; i < groups.length; i++) for (const r of (results[i] && results[i].results) || []) stored.set(r.id, r);
      let list = null;
      if (names) {
        const row = ((results[groups.length] && results[groups.length].results) || [])[0];
        try { const parsed = row && typeof row.names === "string" ? JSON.parse(row.names) : null; list = Array.isArray(parsed) ? parsed : null; }
        catch { list = null; }
      }
      return { stored, names: list };
    },

    async doorWrite(env, key, payload, at, m, { enforce = false } = {}) {
      const upsert = env.DB.prepare(DOOR_UPSERT_SQL + (enforce ? DOOR_CAS_SQL : ""))
        .bind(key, toStored(env, key, payload), at, m.chash, m.session, m.quality, m.epoch, m.asof);
      const landing = key === "meta" ? nightlyLedger(env.DB, JSON.parse(payload), at) : null;
      const done = landing ? await batchWithLedger(env.DB, [upsert], landing) : await upsert.run();
      const first = Array.isArray(done) ? done[0] : done;
      return first && first.meta ? Number(first.meta.changes) || 0 : 0;
    },

    async doorBatch(env, items, at, { enforce = false } = {}) {
      const out = new Array(items.length);
      const prepared = items.map((it, index) => ({
        index,
        stmt: env.DB.prepare(DOOR_UPSERT_SQL + (enforce ? DOOR_CAS_SQL : ""))
          .bind(it.key, toStored(env, it.key, it.payload), at, it.m.chash, it.m.session, it.m.quality, it.m.epoch, it.m.asof),
      }));
      let trips = 0;
      let failed = 0;
      const commit = async (group) => {
        trips++;
        try {
          const done = await env.DB.batch(group.map((g) => g.stmt));
          group.forEach((g, i) => { out[g.index] = { ok: true, changed: done && done[i] && done[i].meta ? Number(done[i].meta.changes) || 0 : 0 }; });
        } catch (error) {
          const message = errorText(error);
          failed++;
          if (TRANSIENT_RE.test(message) || failed > DOOR_LIMITS.bisectBudget) throw error;
          if (group.length === 1) { out[group[0].index] = { ok: false, message }; return; }
          const mid = group.length >> 1;
          await commit(group.slice(0, mid));
          await commit(group.slice(mid));
        }
      };
      for (const group of chunks(prepared, DOOR_LIMITS.statementsPerBatch)) await commit(group);
      return { results: out, trips };
    },

    async have(env, pairs) {
      const ids = pairs.map((p) => p.key);
      const rows = await env.DB.prepare(HAVE_SQL + marks(ids.length) + ")").bind(...ids).all();
      const held = new Map(((rows && rows.results) || []).map((r) => [r.id, r.chash]));
      return pairs.map((p) => ({ key: p.key, have: typeof held.get(p.key) === "string" && held.get(p.key) === p.chash }));
    },

    async planWrite(env, text, at) {
      const written = await env.DB.prepare(PLAN_UPSERT_SQL).bind(text, at).run();
      return written && written.meta ? Number(written.meta.changes) || 0 : 0;
    },

    async planRead(env) {
      const row = await env.DB.prepare(PLAN_READ_SQL).first();
      return row && row.payload ? { payload: row.payload, updatedAt: row.updated_at } : null;
    },

    async quarantine(env, events, at) {
      if (!events.length) return 0;
      const inserts = events.map((e) => env.DB.prepare(RING_INSERT_SQL).bind(
        e.key, e.chash || null, e.code, String(e.path || "").slice(0, DOOR_LIMITS.pathChars), Number(e.bytes) || 0, e.producer || "",
        e.mode, at, DOOR_LIMITS.brakeAfter, e.body || null, DOOR_LIMITS.brakeWindow,
      ));
      for (const group of chunks(inserts, DOOR_LIMITS.statementsPerBatch - 2)) await env.DB.batch(group);
      await env.DB.batch([
        env.DB.prepare(RING_PRUNE_SQL).bind(DOOR_LIMITS.ringSize),
        env.DB.prepare(RING_CLEAR_SQL).bind(DOOR_LIMITS.ringBodies, events.length),
      ]);
      return events.length;
    },
  });
}
