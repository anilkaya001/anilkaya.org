import { HttpError, json, readBounded, requireMethod } from "./http.js";
import { logFailure } from "./log.js";
import { DATED_ARCHIVE_KEY_RE, ingestKeyParts } from "./store.js";
import { PERMANENT_ARCHIVE_KEY_RE } from "../shared/flows-archive.js";
import { FLOWS_MAX_PAYLOAD_BYTES } from "../shared/flows-live-worker.js";
import {
  DOOR_LIMITS, assess, inspect, membershipFlag, parseHashHeader, planOf, producerOf, sha256Hex, tickerOfKey,
} from "../shared/flows-door.js";

const CHASH_RE = /^[0-9a-f]{64}$/;
const EVENTS_PER_ITEM = 3;
const EVENTS_PER_REQUEST = 40;

async function examine(key, text, { now, header }) {
  const seen = inspect(key, text, { now });
  if (!seen.ok) return { ok: false };
  const { canonical, ...rest } = seen;
  const chash = await sha256Hex(canonical);
  let mismatch = false;
  if (header !== null && header !== undefined) {
    const parsed = parseHashHeader(header);
    mismatch = !parsed || !parsed.ok || parsed.hex !== await sha256Hex(text);
  }
  return { ...rest, ok: true, chash, mismatch };
}

const epochOf = (raw) => {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const codes = (list) => list.map((x) => x.code);

function eventsOf({ key, m, would, producer, text, mode }) {
  const body = text.length <= DOOR_LIMITS.bodyMaxBytes ? text : null;
  return would.slice(0, EVENTS_PER_ITEM).map((w) => ({
    key, chash: m.chash, code: w.code, path: w.path, bytes: text.length, producer, mode, body,
  }));
}

export function createDoor({ store, ensureFlowsTables, storeGone, log = logFailure }) {
  async function record(env, events, at) {
    const kept = events.slice(0, EVENTS_PER_REQUEST);
    if (!kept.length) return { recorded: 0, dropped: events.length };
    try {
      await store.quarantine(env, kept, at);
      return { recorded: kept.length, dropped: events.length - kept.length };
    } catch (error) {
      log("warn", "door ring not recorded", { n: kept.length }, error);
      return { recorded: 0, dropped: events.length };
    }
  }

  function noteRegressions(items) {
    const held = items.filter((x) => x.would.some((w) => w.code === "regression")).map((x) => x.key);
    if (held.length) log("warn", "door would hold regressions", { n: held.length, keys: held.slice(0, 5).join(",") });
  }

  async function readStored(env, ids, names) {
    try {
      return await store.doorRead(env, ids, { names });
    } catch (error) {
      log("warn", "door metadata not read", { n: ids.length }, error);
      return null;
    }
  }

  async function write({ request, env, key, payload }) {
    const now = Date.now();
    const producer = producerOf(request.headers.get("X-Producer-Id"), "nightly");
    const m = await examine(key, payload, { now, header: request.headers.get("X-Content-Hash") });
    if (!m.ok) throw HttpError.of("invalid_payload");
    const ticker = tickerOfKey(key);
    const read = await readStored(env, [key], ticker !== null);
    const stored = read ? read.stored.get(key) || null : null;
    const flags = [...m.flags];
    const missing = read ? membershipFlag(ticker, read.names) : null;
    if (missing) flags.push(missing);
    const verdict = assess(m, stored, { producerEpoch: epochOf(request.headers.get("X-Producer-Epoch")), hashMismatch: m.mismatch });
    await store.doorWrite(env, key, payload, now, m);
    noteRegressions([{ key, would: verdict.would }]);
    const ring = await record(env, eventsOf({ key, m, would: verdict.would, producer, text: payload, mode: "warn" }), now);
    return json({
      ok: true, key, bytes: payload.length,
      door: {
        mode: "warn", chash: m.chash, product: m.product, session: m.session, quality: m.quality, epoch: m.epoch, asof: m.asof,
        cas: read ? verdict.cas : "unread", would: codes(verdict.would), flags, ring,
      },
    });
  }

  async function batch({ request, env }) {
    const now = Date.now();
    const bytes = await readBounded(request, DOOR_LIMITS.batchBytes + 4096, "Payload too large");
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw HttpError.of("invalid_payload"); }
    const asked = body && typeof body === "object" && !Array.isArray(body) ? body.items : null;
    if (!Array.isArray(asked) || asked.length === 0) throw HttpError.of("invalid_payload", "Send {items: [{key, payload}]}");
    if (asked.length > DOOR_LIMITS.batchItems) throw HttpError.of("too_many_keys", `At most ${DOOR_LIMITS.batchItems} keys per request`);
    const producer = producerOf(request.headers.get("X-Producer-Id"), "nightly");
    const producerEpoch = epochOf(request.headers.get("X-Producer-Epoch"));
    const results = new Array(asked.length);
    const seen = new Set();
    const live = [];
    for (let i = 0; i < asked.length; i++) {
      const item = asked[i];
      const key = item && typeof item.key === "string" ? item.key : "";
      const refuse = (code, message) => { results[i] = { key, ok: false, code, message }; };
      if (key === "" || !ingestKeyParts(key).valid || key.startsWith("live:")) { refuse("invalid_key", "Unknown payload key"); continue; }
      if (seen.has(key)) { refuse("duplicate_key", "The key appears twice in one batch"); continue; }
      seen.add(key);
      if (DATED_ARCHIVE_KEY_RE.test(key) || PERMANENT_ARCHIVE_KEY_RE.test(key)) { refuse("archive_in_batch", "Archive keys are written one at a time"); continue; }
      if (key === "meta") { refuse("single_only", "meta lands alone, last"); continue; }
      const text = typeof item.payload === "string" ? item.payload : item.payload === undefined ? null : JSON.stringify(item.payload);
      if (text === null) { refuse("invalid_payload", "Payload is not valid JSON"); continue; }
      if (text.length > FLOWS_MAX_PAYLOAD_BYTES) { refuse("payload_too_large", "Payload too large"); continue; }
      try { JSON.parse(text); } catch { refuse("invalid_payload", "Payload is not valid JSON"); continue; }
      live.push({ i, key, text, header: typeof item.hash === "string" ? item.hash : null });
    }
    const examined = [];
    for (const x of live) examined.push(await examine(x.key, x.text, { now, header: x.header }));
    const ready = [];
    live.forEach((x, n) => {
      if (examined[n].ok) ready.push({ ...x, m: examined[n] });
      else results[x.i] = { key: x.key, ok: false, code: "invalid_payload", message: "Payload is not valid JSON" };
    });
    const read = ready.length
      ? await readStored(env, ready.map((x) => x.key), ready.some((x) => tickerOfKey(x.key) !== null))
      : { stored: new Map(), names: null };
    const items = ready.map((x) => {
      const stored = read ? read.stored.get(x.key) || null : null;
      const flags = [...x.m.flags];
      const missing = read ? membershipFlag(tickerOfKey(x.key), read.names) : null;
      if (missing) flags.push(missing);
      return { ...x, flags, stored, verdict: assess(x.m, stored, { producerEpoch, hashMismatch: x.m.mismatch }) };
    });
    let trips = 0;
    const poisoned = [];
    if (items.length) {
      const done = await store.doorBatch(env, items.map((x) => ({ key: x.key, payload: x.text, m: x.m })), now);
      trips = done.trips;
      items.forEach((x, n) => {
        const outcome = done.results[n];
        if (outcome && outcome.ok) {
          results[x.i] = {
            key: x.key, ok: true, stored: "written", chash: x.m.chash, cas: read ? x.verdict.cas : "unread",
            would: codes(x.verdict.would), flags: x.flags,
          };
        } else {
          poisoned.push(x);
          results[x.i] = { key: x.key, ok: false, code: "store_refused", message: outcome && outcome.message ? outcome.message : "The store refused the write" };
        }
      });
    }
    const survivors = items.filter((x) => !poisoned.includes(x));
    noteRegressions(survivors.map((x) => ({ key: x.key, would: x.verdict.would })));
    const events = [
      ...poisoned.map((x) => ({ key: x.key, chash: x.m.chash, code: "store_refused", path: String(results[x.i].message).slice(0, DOOR_LIMITS.pathChars), bytes: x.text.length, producer, mode: "held", body: x.text.length <= DOOR_LIMITS.bodyMaxBytes ? x.text : null })),
      ...survivors.flatMap((x) => eventsOf({ key: x.key, m: x.m, would: x.verdict.would, producer, text: x.text, mode: "warn" })),
    ];
    const ring = await record(env, events, now);
    const written = results.filter((r) => r && r.ok).length;
    return json({ ok: true, mode: "warn", n: asked.length, written, refused: asked.length - written, trips, ring, results });
  }

  async function have({ request, env }) {
    const bytes = await readBounded(request, 32 * 1024, "Payload too large");
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw HttpError.of("invalid_payload"); }
    const asked = body && typeof body === "object" && !Array.isArray(body) ? body.items : null;
    if (!Array.isArray(asked) || asked.length === 0) throw HttpError.of("invalid_payload", "Send {items: [{key, chash}]}");
    if (asked.length > DOOR_LIMITS.haveItems) throw HttpError.of("too_many_keys", `At most ${DOOR_LIMITS.haveItems} keys per request`);
    const pairs = [];
    const seen = new Set();
    for (const item of asked) {
      const key = item && typeof item.key === "string" ? item.key : "";
      if (!ingestKeyParts(key).valid || key.startsWith("live:") || seen.has(key)) throw HttpError.of("invalid_key");
      if (typeof item.chash !== "string" || !CHASH_RE.test(item.chash)) throw HttpError.of("invalid_payload", "chash is 64 hex characters");
      seen.add(key);
      pairs.push({ key, chash: item.chash });
    }
    let rows;
    try { rows = await store.have(env, pairs); } catch (error) { log("warn", "door have not read", { n: pairs.length }, error); throw storeGone(); }
    return json({ ok: true, have: rows.filter((r) => r.have).map((r) => r.key), need: rows.filter((r) => !r.have).map((r) => r.key) });
  }

  async function plan({ request, env }) {
    if (request.method === "GET") {
      const stored = await store.planRead(env);
      if (!stored) return json({ status: "pending" });
      return json({ ok: true, ...JSON.parse(stored.payload), updatedAt: stored.updatedAt });
    }
    const bytes = await readBounded(request, DOOR_LIMITS.planBytes, "Payload too large");
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw HttpError.of("invalid_payload"); }
    const now = Date.now();
    const parsed = planOf(body, now);
    if (!parsed.ok) throw HttpError.of("invalid_payload", `The plan is refused: ${parsed.code} at ${parsed.path}`);
    const text = JSON.stringify({ v: 1, session: parsed.session, names: parsed.names, at: now });
    const changed = await store.planWrite(env, text, now);
    return json({ ok: true, session: parsed.session, n: parsed.names.length, stored: changed ? "written" : "older" });
  }

  async function operation({ request, env, url, tokenKind }) {
    const op = url.searchParams.get("op");
    if (op === "batch" || op === "have") requireMethod(request, ["POST"]);
    else if (op === "plan") requireMethod(request, ["GET", "POST"]);
    else throw HttpError.of("invalid_op");
    if (tokenKind !== "nightly") throw HttpError.of("live_token_scope", "The live token cannot use the door's operations");
    if (!env.DB) throw storeGone();
    await ensureFlowsTables(env);
    if (op === "batch") return batch({ request, env });
    if (op === "have") return have({ request, env });
    return plan({ request, env });
  }

  return Object.freeze({ write, operation });
}
