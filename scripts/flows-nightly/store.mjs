import { makePermitQueue } from "../../shared/flows-permits.js";
import {
  refusalOf, refusalTally, tallyRefusal, tallyAnswer, retriedStatus, refusalBrief, storeQuotaWait, QUOTA_WAIT,
} from "../flows-legs/health.mjs";
import { LIVE_OIDC, actionsIdToken, jwtExpiry } from "../../shared/flows-oidc.js";
import { DRY_RUN, LIVE_MODE, EMIT } from "./flags.mjs";
import { sleep, wireProgress } from "./vendor.mjs";

export function ingestURL() {
  return process.env.FLOWS_INGEST_URL || "https://anilkaya.org/api/flows/ingest";
}

const INGEST_UA = "anilkaya-flows-pipeline/1 (+https://github.com/anilkaya001/anilkaya.org)";

export const LIVE_BEARER_MARGIN_MS = 60_000;

let liveBearer = { token: null, exp: 0, url: null };

let liveMinting = null;

export function liveCredentialSource(env = process.env) {
  if (env.FLOWS_LIVE_TOKEN) return "the live token";
  if (env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) return "GitHub OIDC";
  return null;
}

export async function liveCredential({ env = process.env, now = Date.now(), fetchImpl = fetch } = {}) {
  if (env.FLOWS_LIVE_TOKEN) return env.FLOWS_LIVE_TOKEN;
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL || null;
  if (liveBearer.token && liveBearer.url === url && liveBearer.exp - now > LIVE_BEARER_MARGIN_MS) return liveBearer.token;
  if (!liveMinting || liveMinting.url !== url) {
    const minting = { url, promise: null };
    minting.promise = actionsIdToken(env, { audience: LIVE_OIDC.audience, fetchImpl })
      .then((token) => {
        liveBearer = { token, exp: jwtExpiry(token), url };
        return token;
      })
      .finally(() => {
        if (liveMinting === minting) liveMinting = null;
      });
    liveMinting = minting;
  }
  return liveMinting.promise;
}

async function ingestHeaders({ json = false } = {}) {
  const headers = {
    Authorization: "Bearer " + (LIVE_MODE ? await liveCredential() : process.env.FLOWS_INGEST_TOKEN),
    "User-Agent": INGEST_UA,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

export const PUBLISH_SPACING_MS = 400;

const ingestWrites = makePermitQueue({
  delayMs: () => PUBLISH_SPACING_MS,
  now: () => Date.now(),
  sleep,

  maxInFlight: 2,
});

export const READ_RETRIES = 2;

const READ_RETRYABLE = (status) => status === 0 || PUBLISH_RETRYABLE.has(status) || status >= 500;

export const edgeRefusals = refusalTally();

export function resetEdgeRefusals() {
  const seen = structuredClone(edgeRefusals);
  Object.assign(edgeRefusals, refusalTally());
  return seen;
}

export function edgeSnapshot() {
  return { ...structuredClone(edgeRefusals), retrySpentMs: publishRetrySpentMs };
}

async function noteAnswer(response) {
  if (response && !retriedStatus(response.status)) return null;
  const text = response ? await response.text().catch(() => "") : "";
  tallyAnswer(edgeRefusals, response, text);
  return { text };
}

export async function noteRefusal(response) {
  const text = await response.text().catch(() => "");
  const seen = refusalOf({ headers: response.headers, text });
  tallyRefusal(edgeRefusals, seen);
  return { ...seen, text };
}

export const readSaid = (read) => (read.status ? `HTTP ${read.status}` : read.detail || "no answer") +
  (read.refusal ? ` (${refusalBrief(read.refusal)})` : "");

export async function readStoredOnce(key) {
  try {
    const response = await fetch(
      ingestURL() + "?key=" + encodeURIComponent(key),
      {
        redirect: "error",
        headers: await ingestHeaders(),
      },
    ).finally(() => wireProgress.settled());
    const refusal = response.status === 403 ? await noteRefusal(response) : null;
    if (refusal) {
      return { payload: null, failed: true, status: 403, refusal, final: refusal.kind === "worker" };
    }
    if (!response.ok) {
      await noteAnswer(response);
      return { payload: null, failed: true, status: response.status };
    }
    const body = await response.json();

    if (body && body.status === "pending") {
      return { payload: null, absent: true, status: response.status };
    }
    return { payload: body, status: response.status };
  } catch (error) {
    await noteAnswer(null);
    return { payload: null, failed: true, status: 0, detail: error.message };
  }
}

async function keysAnswer(response) {
  const refusal = response.status === 403 ? await noteRefusal(response) : null;
  if (refusal) {
    return { keys: null, failed: true, status: 403, refusal, final: refusal.kind === "worker" };
  }
  if (!response.ok) {
    const noted = await noteAnswer(response);
    const seen = refusalOf({ headers: response.headers, text: noted ? noted.text : await response.text().catch(() => "") });
    return { keys: null, failed: true, status: response.status, code: seen.kind === "worker" ? seen.code : null };
  }
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!body || !body.keys || typeof body.keys !== "object") {
    return { keys: null, failed: true, status: response.status, detail: "the answer carried no keys" };
  }
  return { keys: body.keys, bytes: text.length, status: response.status, truncated: body.truncated === true };
}

async function probeStoredOnce(keys) {
  try {
    const response = await fetch(
      ingestURL() + "?keys=" + encodeURIComponent(keys.join(",")),
      {
        redirect: "error",
        headers: await ingestHeaders(),
      },
    );
    return await keysAnswer(response);
  } catch (error) {
    await noteAnswer(null);
    return { keys: null, failed: true, status: 0, detail: error.message };
  }
}

async function listStoredOnce(kinds) {
  try {
    const response = await fetch(
      ingestURL() + "?list=" + encodeURIComponent(kinds.join(",")),
      {
        redirect: "error",
        headers: await ingestHeaders(),
      },
    );
    return await keysAnswer(response);
  } catch (error) {
    await noteAnswer(null);
    return { keys: null, failed: true, status: 0, detail: error.message };
  }
}

async function readWithRetries(once, said, { retries = READ_RETRIES, pause = sleep, budget = null } = {}) {
  let read = await once();
  for (let attempt = 0; read.failed && !read.final && READ_RETRYABLE(read.status); attempt++) {
    const wait = budget
      ? publishRetryDelay(attempt, { retries, spentMs: budget.spentMs, budgetMs: budget.budgetMs })
      : publishRetryDelay(attempt, { retries, spentMs: publishRetrySpentMs });
    if (wait === null) break;
    if (budget) budget.spentMs += wait;
    else publishRetrySpentMs += wait;
    console.warn(`  read ${said}: ${readSaid(read)}` +
      ` — waiting ${wait}ms and reading again (retry ${attempt + 1} of ${retries})`);
    await pause(wait);
    const again = await once();
    read = again.failed ? again : { ...again, recovered: attempt + 1 };
  }
  return read;
}

export async function readStored(key, options = {}) {
  if (DRY_RUN) return { payload: null, absent: true, status: 0 };
  return readWithRetries(() => readStoredOnce(key), key, options);
}

export async function probeStored(keys, options = {}) {
  if (DRY_RUN) return { keys: null, failed: true, status: 0, detail: "dry run" };
  return readWithRetries(() => probeStoredOnce(keys), `${keys.length} key(s) at once`, options);
}

export const LEDGER_LIST_KINDS = Object.freeze(["card", "card-x", "hist"]);

export async function listStored(kinds = LEDGER_LIST_KINDS, options = {}) {
  if (DRY_RUN) return { keys: null, failed: true, status: 0, detail: "dry run" };
  return readWithRetries(() => listStoredOnce(kinds), `the ${kinds.join(", ")} listing`, options);
}

export function sessionArchiveKeys(sessionDate) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return [];
  return [`scores:${sessionDate}`, `board:long:${sessionDate}`, `board:short:${sessionDate}`];
}

export async function retireSession(sessionDate, {
  remove = retire, retries = READ_RETRIES, pause = sleep,
} = {}) {
  const removed = [], absent = [], refused = [], kept = [];
  const keys = sessionArchiveKeys(sessionDate);
  const order = [...keys.filter((k) => !k.startsWith("scores:")),
    ...keys.filter((k) => k.startsWith("scores:"))];
  for (const key of order) {
    if (refused.length) { kept.push(key); continue; }
    let result = await remove(key);
    for (let attempt = 0; !(result && (result.ok || result.status === 404)) &&
        READ_RETRYABLE(result ? result.status : 0); attempt++) {
      const wait = publishRetryDelay(attempt, { retries, spentMs: publishRetrySpentMs });
      if (wait === null) break;
      publishRetrySpentMs += wait;
      console.warn(`  retire ${key}: HTTP ${result ? result.status : 0} — waiting ${wait}ms ` +
        `and asking again (retry ${attempt + 1} of ${retries})`);
      await pause(wait);
      result = await remove(key);
    }
    if (result && result.ok) removed.push(key);
    else if (result && result.status === 404) absent.push(key);
    else refused.push({ key, status: result ? result.status : 0 });
  }
  return { removed, absent, refused, kept };
}

export function summarize(payload) {
  if (Array.isArray(payload.rows)) return `${payload.rows.length} rows`;

  if (Array.isArray(payload.sectors)) return `${payload.sectors.length} sectors`;
  return "no rows";
}

export const ARCHIVE_RETENTION_DAYS = 126;

export const ARCHIVE_PRUNE_LOOKBACK_DAYS = 30;

export const ARCHIVE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function datedKey(side, sessionDate) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return null;
  return `board:${side}:${sessionDate}`;
}

export function pruneKeys(sessionDate, {
  retentionDays = ARCHIVE_RETENTION_DAYS,
  lookbackDays = ARCHIVE_PRUNE_LOOKBACK_DAYS,
} = {}) {
  if (!ARCHIVE_DATE_RE.test(String(sessionDate || ""))) return [];
  const t0 = Date.parse(sessionDate + "T00:00:00Z");
  if (!Number.isFinite(t0)) return [];
  const keys = [];
  for (let back = retentionDays + 1; back <= retentionDays + lookbackDays; back++) {
    const day = new Date(t0 - back * 86400000).toISOString().slice(0, 10);
    for (const side of ["long", "short"]) keys.push(`board:${side}:${day}`);
  }
  return keys;
}

export async function retire(key) {
  if (DRY_RUN) {
    console.log(`  [dry-run] retire ${key}`);
    return { ok: true, status: 0 };
  }
  try {

    await ingestWrites.acquire();
    const response = await fetch(
      ingestURL() + "?key=" + encodeURIComponent(key),
      {
        method: "DELETE",
        redirect: "error",
        headers: await ingestHeaders(),
      },
    );
    const refusal = response.status === 403 ? await noteRefusal(response) : null;
    if (!refusal) await noteAnswer(response);
    return { ok: response.ok, status: response.status, refusal };
  } catch (error) {
    await noteAnswer(null);
    return { ok: false, status: 0, message: error.message };
  }
}

export async function pruneArchive(sessionDate, options = {}) {
  const stale = pruneKeys(sessionDate, options);
  if (!stale.length) {
    console.log("prune: no session date, so no dated key is computable — skipped");
    return { removed: 0, refused: 0, abandoned: false };
  }
  let removed = 0, refused = 0, streak = 0, lastStatus = 0, abandoned = false;
  for (const key of stale) {
    const result = await retire(key);
    if (result.ok) { removed++; streak = 0; continue; }
    if (result.status === 404) { streak = 0; continue; }
    refused++; streak++; lastStatus = result.status;
    if (streak >= 3) { abandoned = true; break; }
  }
  console.log(
    `prune: ${stale.length} dated keys past ${ARCHIVE_RETENTION_DAYS} days named` +
    `, ${removed} removed` +
    (refused ? `, ${refused} refused (last HTTP ${lastStatus})` : "") +
    (abandoned
      ? " — ABANDONED after three consecutive refusals. The ingest route is" +
        " rejecting DELETE, so dated boards will accumulate until it accepts it."
      : ""),
  );
  return { removed, refused, abandoned };
}

const PUBLISH_RETRIES = 3;

const PUBLISH_RETRY_BUDGET_MS = 90_000;

let publishRetrySpentMs = 0;

let quotaFirstAt = 0;

export function resetPublishRetryBudget() {
  const spent = publishRetrySpentMs;
  publishRetrySpentMs = 0;
  quotaFirstAt = 0;
  return spent;
}

export const PUBLISH_RETRYABLE = new Set([403, 408, 429, 500, 502, 503, 504]);

export function publishRetryDelay(attempt, {
  retries = PUBLISH_RETRIES, budgetMs = PUBLISH_RETRY_BUDGET_MS, spentMs = 0,
} = {}) {
  if (!(attempt >= 0) || attempt >= retries) return null;
  const wait = 1000 * (attempt + 1) * (attempt + 1);
  return spentMs + wait > budgetMs ? null : wait;
}

export const publishedStore = Object.create(null);

let activeStages = null;

export function bindStages(stages) {
  activeStages = stages;
}

export const landedKeys = new Set();

export async function publish(key, payload) {
  if (LIVE_MODE && !/^live:[a-z]+(?::[a-z]+)?$/.test(key)) {
    throw new Error(`--live publishes live:* keys only, and ${key} is not one — the session archive is never ` +
      "written by the live layer");
  }
  publishedStore[key] = payload;
  if (activeStages) activeStages.note(key);
  const body = JSON.stringify(payload);
  if (EMIT || DRY_RUN) {
    if (EMIT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(EMIT.replace(/\.json$/, "") + "-" + key.replace(":", "-") + ".json", body);
    }
    console.log(`  [dry-run] ${key}: ${summarize(payload)}, ${body.length} bytes`);
    landedKeys.add(key);
    return;
  }
  let response, refusal = null, heard = null, lastDetail = "";
  for (let attempt = 0; ; attempt++) {

  await ingestWrites.acquire();
  response = await fetch(
    ingestURL() + "?key=" + encodeURIComponent(key),
    {
      method: "POST",

      redirect: "error",

      headers: await ingestHeaders({ json: true }),
      body,
    },
  ).finally(() => wireProgress.settled());

  refusal = response.status === 403 ? await noteRefusal(response) : null;
  heard = refusal || await noteAnswer(response);
  const quotaWait = !response.ok && heard ? storeQuotaWait(response, heard.text, { firstAt: quotaFirstAt }) : null;
  if (quotaWait !== null) {
    quotaFirstAt = quotaFirstAt || QUOTA_WAIT.now();
    lastDetail = heard.text;
    console.warn(
      `  ingest ${key}: HTTP ${response.status} store_quota — the store's daily quota is spent and resets at 00:00 UTC; ` +
      `waiting ${Math.round(quotaWait / 1000)}s for it (a wait of at most ${Math.round(QUOTA_WAIT.maxMs / 60000)} min a run, ` +
      "not counted against the retry budget)");
    ingestWrites.defer(quotaWait);
    wireProgress.quiet(quotaWait);
    await sleep(quotaWait);
    attempt--;
    continue;
  }
  const wait = PUBLISH_RETRYABLE.has(response.status) && !(refusal && refusal.kind === "worker")
    ? publishRetryDelay(attempt, { spentMs: publishRetrySpentMs })
    : null;
  if (!response.ok && wait !== null) {
    lastDetail = heard ? heard.text : await response.text().catch(() => "");
    publishRetrySpentMs += wait;
    console.warn(
      `  ingest ${key}: HTTP ${response.status}${refusal ? ` (${refusalBrief(refusal)})` : ""} from ` +
      `${response.headers.get("server") || "unknown"} — waiting ${wait}ms and retrying ` +
      `(retry ${attempt + 1} of ${PUBLISH_RETRIES}; ` +
      `${Math.round(publishRetrySpentMs / 1000)}s of the run's ` +
      `${PUBLISH_RETRY_BUDGET_MS / 1000}s retry budget spent)`);

    ingestWrites.defer(wait);
    wireProgress.quiet(wait);
    await sleep(wait);
    continue;
  }
  break;
  }

  if (!response.ok) {

    const detail = (heard ? heard.text : await response.text().catch(() => "")) || lastDetail;
    const ray = response.headers.get("cf-ray") || "none";
    const server = response.headers.get("server") || "unknown";
    const failure = new Error(
      `ingest ${key} -> HTTP ${response.status}` +
      ` (server: ${server}, cf-ray: ${ray})` +
      (detail ? ` body: ${detail.slice(0, 300).replace(/\s+/g, " ")}` : " body: <empty>"),
    );

    failure.status = response.status;
    throw failure;
  }
  landedKeys.add(key);
  console.log(`  published ${key}: ${summarize(payload)}, ${body.length} bytes`);
}
