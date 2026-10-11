import { HttpError, json, readBounded, requireMethod } from "../http.js";
import * as FLOWS_LIVE from "../../shared/flows-live-worker.js";
import { archiveWriteAction, ARCHIVE_REFUSALS, PERMANENT_ARCHIVE_KEY_RE } from "../../shared/flows-archive.js";
import {
  DATED_ARCHIVE_KEY_RE, INGEST_LIST_KINDS, INGEST_META_KEYS_MAX, ingestKeyParts,
} from "../store.js";

const FLOWS_MAX_PAYLOAD_BYTES = FLOWS_LIVE.FLOWS_MAX_PAYLOAD_BYTES;

function timingSafeEqualStr(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export function flowsIngestRows(deps) {
  const { store, ensureFlowsTables, storeGone, passthrough } = deps;

  const ingest = async ({ request, env, url }) => {
    requireMethod(request, ["GET", "POST", "DELETE"]);
    const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const oidc = FLOWS_LIVE.looksLikeJwt(offered);
    if (!env.FLOWS_INGEST_TOKEN && !FLOWS_LIVE.staticLiveToken(env, url) && !oidc) {
      throw new HttpError(503, "unavailable", "Ingest is not configured");
    }

    let tokenKind = FLOWS_LIVE.tokenKind(offered, env, timingSafeEqualStr, url);
    if (!tokenKind && oidc) {
      const check = await FLOWS_LIVE.oidcKind(offered, env);
      if (check.unavailable) {
        throw new HttpError(503, "unavailable", "The live credential's signing keys could not be read; retry shortly");
      }
      tokenKind = check.kind;
    }
    if (!tokenKind) throw new HttpError(401, "unauthorized", "Authentication required");

    if (url.searchParams.has("list")) {
      requireMethod(request, ["GET"]);
      if (tokenKind !== "nightly") {
        throw new HttpError(403, "live_token_scope", "The live token reads one key at a time");
      }
      const kinds = [...new Set(url.searchParams.get("list").split(",").map((k) => k.trim()).filter(Boolean))];
      if (!kinds.length || kinds.some((k) => !INGEST_LIST_KINDS.includes(k))) throw new HttpError(400, "invalid_key", "Unknown payload key");
      if (!env.DB) throw storeGone();
      await ensureFlowsTables(env);
      const listing = await store.listing(env, kinds);
      if (!listing) throw storeGone();
      return json(listing);
    }

    if (url.searchParams.has("keys")) {
      requireMethod(request, ["GET"]);
      if (tokenKind !== "nightly") {
        throw new HttpError(403, "live_token_scope", "The live token reads one key at a time");
      }
      const asked = [...new Set(url.searchParams.get("keys").split(",").map((k) => k.trim()).filter(Boolean))];
      if (!asked.length) throw new HttpError(400, "invalid_key", "Unknown payload key");
      if (asked.length > INGEST_META_KEYS_MAX) {
        throw new HttpError(400, "too_many_keys", `At most ${INGEST_META_KEYS_MAX} keys per request`);
      }
      if (asked.some((k) => !ingestKeyParts(k).valid)) throw new HttpError(400, "invalid_key", "Unknown payload key");
      if (!env.DB) throw storeGone();
      await ensureFlowsTables(env);
      const keys = await store.metadata(env, asked);
      if (!keys) throw storeGone();
      return json({ keys });
    }

    const key = url.searchParams.get("key") || "";

    if (key === "clock") {
      requireMethod(request, ["GET"]);
      await ensureFlowsTables(env);
      return FLOWS_LIVE.serveIngestClock(env, { json, lab: tokenKind === "nightly" });
    }

    if (key.startsWith("live:")) {
      const scope = FLOWS_LIVE.ingestScope(key, request.method, tokenKind);
      if (!scope.ok) throw new HttpError(scope.status, scope.code, scope.message);
      await ensureFlowsTables(env);
      const text = request.method === "POST"
        ? new TextDecoder().decode(await readBounded(request, FLOWS_MAX_PAYLOAD_BYTES, "Payload too large"))
        : "";
      return FLOWS_LIVE.ingestLive(env, key, request.method, text, Date.now(), { json });
    }

    const { tickerKey, valid: validKey } = ingestKeyParts(key);
    if (!validKey) {
      throw new HttpError(400, "invalid_key", "Unknown payload key");
    }

    const scope = FLOWS_LIVE.ingestScope(key, request.method, tokenKind);
    if (!scope.ok) throw new HttpError(scope.status, scope.code, scope.message);

    if (request.method === "GET") {
      const stored = await store.read(env, key);
      if (!stored) return json({ key, status: "pending" });
      return passthrough(stored);
    }

    if (request.method === "DELETE") {
      if (PERMANENT_ARCHIVE_KEY_RE.test(key)) {
        throw new HttpError(400, "undeletable_key", "Permanent archive keys are never removed; write the correction under the next revision key");
      }
      if (!DATED_ARCHIVE_KEY_RE.test(key) && !(tickerKey && tokenKind === "nightly")) {
        throw new HttpError(400, "undeletable_key", "Only dated archive keys and, for the nightly token, card, card-x and hist keys can be removed");
      }
      await ensureFlowsTables(env);
      const removed = await store.remove(env, key);
      if (!removed) return json({ key, removed: 0, status: "absent" }, 404);
      return json({ ok: true, key, removed });
    }

    const payload = new TextDecoder().decode(
      await readBounded(request, FLOWS_MAX_PAYLOAD_BYTES, "Payload too large"),
    );

    try { JSON.parse(payload); }
    catch { throw new HttpError(400, "invalid_payload", "Payload is not valid JSON"); }

    await ensureFlowsTables(env);

    const permanentKey = PERMANENT_ARCHIVE_KEY_RE.test(key);
    if (permanentKey || DATED_ARCHIVE_KEY_RE.test(key)) {
      const trace = {};
      const existing = await store.read(env, key, trace);
      const action = archiveWriteAction({
        readable: !trace.failed,
        exists: !!existing,
        same: !!existing && existing.payload === payload,
        permanent: permanentKey,
      });
      if (action === "unchanged") {
        return json({ ok: true, key, bytes: payload.length, stored: "unchanged" });
      }
      if (action !== "write") {
        const refusal = ARCHIVE_REFUSALS[action];
        throw new HttpError(refusal.status, refusal.code, refusal.message);
      }

      const rows = await store.createArchive(env, key, payload, Date.now());
      if (!rows) {
        const refusal = ARCHIVE_REFUSALS.refuse_raced;
        throw new HttpError(refusal.status, refusal.code, refusal.message);
      }
      return json({ ok: true, key, bytes: payload.length, stored: "created" });
    }

    await store.write(env, key, payload, Date.now());

    return json({ ok: true, key, bytes: payload.length });
  };

  return [
    { id: "flows.ingest", path: "/api/flows/ingest", methods: ["GET", "POST", "DELETE"], auth: "none", handler: ingest },
  ];
}
