import { nightlyFreshMeta, TICKER_RE } from "../shared/flows-live.js";
import { NIGHTLY_ROW_SQL, nightlyLedger, batchWithLedger } from "../shared/flows-live-worker.js";

export const DATED_ARCHIVE_KEY_RE = /^(board:(long|short)|scores):\d{4}-\d{2}-\d{2}$/;

export const INGEST_VIEW_KEY_RE = /^board:(long|short|watch)$|^board:(long|short):\d{4}-\d{2}-\d{2}$|^scores:\d{4}-\d{2}-\d{2}$|^scoretrack$|^calib$|^dispersion$|^flowalerts$|^pulse$|^political$|^record$|^movers$|^market$|^unusual$|^events$|^sector:trix$|^sector:premium$|^news$|^brief$|^meta$|^universe$|^regime$|^ideas$|^ideas(-out)?:\d{4}-\d{2}-\d{2}(:r\d+)?$|^focus$|^roster$/;

export const INGEST_META_KEYS_MAX = 96;
export const INGEST_LIST_KINDS = Object.freeze(["card", "card-x", "hist"]);
export const INGEST_LIST_MAX = 2000;

const INGEST_META_SQL =
  "SELECT id, updated_at, length(payload) AS bytes, json_extract(payload, '$.sessionDate') AS session, " +
  "json_extract(payload, '$.generatedAt') AS generated, json_extract(payload, '$.status') AS status " +
  "FROM flows_payload WHERE id IN (";

const ARCHIVE_INSERT_SQL =
  "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING";

const UPSERT_SQL =
  "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
  "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at";

const DELETE_SQL = "DELETE FROM flows_payload WHERE id = ?";

export function ingestKeyParts(key) {
  const tickerKey = /^(card|card-x|hist):/.exec(key);
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

export const storedFrom = (row) => (row && row.payload
  ? { payload: row.payload, updatedAt: row.updated_at, fresh: nightlyFreshMeta(row) }
  : null);

export function createFlowsStore({ ensureFlowsTables }) {
  return Object.freeze({
    async read(env, key, trace) {
      if (!env.DB) { if (trace) trace.failed = true; return null; }
      await ensureFlowsTables(env);
      const row = await env.DB.prepare(NIGHTLY_ROW_SQL).bind(key).first()
        .catch(() => { if (trace) trace.failed = true; return null; });
      return storedFrom(row);
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
      const upsert = env.DB.prepare(UPSERT_SQL).bind(key, payload, at);
      const landing = key === "meta" ? nightlyLedger(env.DB, JSON.parse(payload), at) : null;
      if (landing) await batchWithLedger(env.DB, [upsert], landing);
      else await upsert.run();
    },
  });
}
