/* =============================================================
   worker.js — Cloudflare Worker (Static Assets + API).
   Runs before every asset request, applies response policy, serves
   topic-specific course metadata, and handles Google auth + D1 sync.
   ============================================================= */
import { signSession, verifySession, getCookie, cookie } from "./shared/session.js";
import {
  FLOWS_COOKIE, FLOWS_SESSION_TTL_SECONDS, LEARN_AUDIENCE, FLOWS_USERNAMES,
  parseCredentials, verifyCredential, signFlowsSession, verifyFlowsSession,
  isLearnAudience, isLocked, nextFailureState, sessionEpoch,
} from "./shared/flows-auth.js";
import { FLOWS_PAGES } from "./shared/flows-pages.js";
import * as FLOWS_ASK from "./shared/flows-ask.js";
import { COURSE_STAGE_POINTS } from "./shared/course-points.js";
import { COURSE_BY_ID, COURSE_BY_SLUG, COURSE_TOPICS, SITE_ORIGIN } from "./shared/course-seo.js";
import { REVIEW_ITEM_BY_ID } from "./shared/review-manifest.js";
import { COURSE_STAGE_BY_ID } from "./shared/stage-manifest.js";
import { SKILL_BY_ID } from "./shared/skill-manifest.js";
import { PROJECT_BY_ID } from "./shared/project-manifest.js";
import { MARKET_INDICES, parseIndexQuote, buildSnapshot } from "./shared/markets.js";
/* numOrNull comes from the same module the desk prices with, rather than being
   re-derived here. Number(null) is 0 and Number("") is 0, and this repository
   has shipped that confident zero enough times that a second local copy of the
   guard is a second place for it to come back. */
import {
  rankChain, RANK_KEYS, crossesEarnings, numOrNull, parseOptionSymbol, ivConvention,
} from "./shared/flows-premium.js";
import { buildFlowAlerts, mergeAlerts } from "./shared/flows-alerts.js";
import { shapeTide } from "./shared/flows-pulse.js";
import { isRefreshWindow } from "./shared/flows-freshness.js";

const COURSE_ASSET_PATH = "/lab/course";
// Edge-memoization window for rendered course pages. Kept short so a deploy
// (which bumps the ?v asset refs embedded in the cached HTML) is reflected within
// a minute, while still absorbing bursts (crawlers, a shared link) on repeat hits.
const COURSE_EDGE_TTL_S = 60;
const LEGACY_COURSE_PATHS = new Set([
  "/lab/course", "/lab/course.html", "/lab/course/",
  "/lab/lesson", "/lab/lesson.html", "/lab/lesson/",
]);
const MAX_JSON_BYTES = 16 * 1024;
const GENERATION_HEADER = "X-IEWT-Generation";
const MAX_SYNC_GENERATION = Number.MAX_SAFE_INTEGER;
const LEARNING_SYNC_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS learning_sync (" +
    "user_id TEXT PRIMARY KEY, " +
    "generation INTEGER NOT NULL DEFAULT 0 " +
      "CHECK (generation BETWEEN 0 AND 9007199254740991)" +
  ")";
const MASTERY_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS mastery (" +
    "user_id TEXT NOT NULL, item_id TEXT NOT NULL, " +
    "level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5), " +
    "due_day TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000), " +
    "correct INTEGER NOT NULL DEFAULT 0 CHECK (correct BETWEEN 0 AND 1000000), " +
    "last_result INTEGER CHECK (last_result IN (0, 1)), last_attempt_id TEXT, " +
    "last_day TEXT, " +
    "updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, item_id)" +
  ")";
const MASTERY_ATTEMPTS_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS mastery_attempts (" +
    "user_id TEXT NOT NULL, attempt_id TEXT NOT NULL, item_id TEXT NOT NULL, " +
    "correct INTEGER NOT NULL CHECK (correct IN (0, 1)), " +
    "hinted INTEGER NOT NULL CHECK (hinted IN (0, 1)), attempt_day TEXT NOT NULL, " +
    "applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)), " +
    "received_at INTEGER NOT NULL, PRIMARY KEY (user_id, attempt_id)" +
  ")";
const MASTERY_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS mastery_due_by_user ON mastery (user_id, due_day, item_id)";
const PLACEMENT_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS placement (" +
    "user_id TEXT PRIMARY KEY, " +
    "band TEXT NOT NULL CHECK (band IN ('foundation', 'applied', 'advanced')), " +
    "score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 15), " +
    "total INTEGER NOT NULL CHECK (total = 15), " +
    "completed_day TEXT NOT NULL, " +
    "recommended_topic TEXT NOT NULL CHECK (recommended_topic IN ('ols', 'iv2sls', 'did', 'var', 'panel', 'logit', 'gmm')), " +
    "updated_at INTEGER NOT NULL, " +
    "CHECK ((band='foundation' AND score BETWEEN 0 AND 6) OR " +
      "(band='applied' AND score BETWEEN 7 AND 11) OR " +
      "(band='advanced' AND score BETWEEN 12 AND 15))" +
  ")";
const ACADEMY_SCHEMA_SQL = Object.freeze([
  "CREATE TABLE IF NOT EXISTS progress_v3 (user_id TEXT NOT NULL, course_id TEXT NOT NULL, stage_id TEXT NOT NULL, completed_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','migration')), PRIMARY KEY (user_id, course_id, stage_id))",
  "CREATE INDEX IF NOT EXISTS progress_v3_by_user ON progress_v3 (user_id, course_id, completed_at)",
  "CREATE TABLE IF NOT EXISTS skill_mastery (user_id TEXT NOT NULL, skill_id TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5), due_day TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000), correct INTEGER NOT NULL DEFAULT 0 CHECK (correct BETWEEN 0 AND 1000000), last_result INTEGER CHECK (last_result IN (0,1)), last_attempt_id TEXT, last_day TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, skill_id))",
  "CREATE INDEX IF NOT EXISTS skill_mastery_due_by_user ON skill_mastery (user_id, due_day, skill_id)",
  "CREATE TABLE IF NOT EXISTS skill_attempts (user_id TEXT NOT NULL, attempt_id TEXT NOT NULL, skill_id TEXT NOT NULL, item_id TEXT NOT NULL, correct INTEGER NOT NULL CHECK (correct IN (0,1)), hinted INTEGER NOT NULL CHECK (hinted IN (0,1)), attempt_day TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0,1)), received_at INTEGER NOT NULL, PRIMARY KEY (user_id, attempt_id))",
  "CREATE TABLE IF NOT EXISTS learning_preferences (user_id TEXT PRIMARY KEY, active_path_id TEXT NOT NULL DEFAULT 'complete-core', session_minutes INTEGER NOT NULL DEFAULT 20 CHECK (session_minutes IN (10,20,45)), weekly_goal_minutes INTEGER NOT NULL DEFAULT 120 CHECK (weekly_goal_minutes BETWEEN 30 AND 1200), updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS project_progress (user_id TEXT NOT NULL, project_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('guided','unguided')), done_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, project_id))",
]);
const PATH_IDS = new Set(["complete-core", "causal", "applied-micro", "time-series", "markets-risk"]);
const SESSION_MINUTES = new Set([10, 20, 45]);
const STAGE_KEY_BY_COURSE = Object.freeze(Object.fromEntries(Object.entries(COURSE_STAGE_BY_ID).map(([key, stage]) => [key, stage])));

// Pyodide is loaded from jsDelivr and requires eval + WebAssembly evaluation.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
  "connect-src 'self' https://cdn.jsdelivr.net https://cloudflareinsights.com",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  "X-Permitted-Cross-Domain-Policies": "none",
};

// Idempotency ledgers (mastery_attempts, skill_attempts) only need to remember
// an attempt long enough to absorb a client retry. The sync outbox flushes on
// every sign-in and is capped, so 48h is a generous window; pruning past it on
// each write keeps the tables bounded instead of growing O(lifetime attempts).
const ATTEMPT_LEDGER_TTL_MS = 48 * 60 * 60 * 1000;

// ---- Live market ticker -------------------------------------------------
// Index quotes for the landing-page ticker are fetched server-side (the browser
// only ever reads same-origin /api/markets), cached as one JSON row in D1, and
// refreshed by the cron trigger. A failed refresh preserves the last-known-good
// row, so the ticker degrades to stale-but-labelled data rather than blank.
const MARKET_SNAPSHOT_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS market_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at INTEGER NOT NULL)";
// The cron (every 15 min) is the primary refresher; a read only repairs the
// snapshot inline once it is older than this, and on a failed repair it touches
// the row so the next inline attempt is a full window away (no per-request storm
// during a sustained upstream outage).
// Flows tables. Workers Builds does not apply migrations to an existing D1
// database, so — exactly as for market_snapshot above — the Worker creates
// these on first use. Without it a missed migration would leave the board
// permanently showing its "pending" empty state and silently skip login
// throttling, both of which fail quietly rather than loudly.
const FLOWS_SCHEMA_SQL = [
  "CREATE TABLE IF NOT EXISTS flows_payload (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL CHECK (updated_at > 0))",
  "CREATE TABLE IF NOT EXISTS flows_login_failures (username TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 1000000), first_at INTEGER NOT NULL CHECK (first_at > 0))",
  /* WHAT THIS SITE SPENT ON THE MODEL, BY UTC DAY, WHICH IS THE DAY THE
     ALLOWANCE RESETS ON. Keyed on the date string rather than a rolling
     window because Cloudflare's own reset is a calendar boundary at 00:00
     UTC, and a meter whose period differs from the limit's period reports
     a fraction of the wrong thing. Tokens are stored because tokens are
     what the model MEASURED; the neuron figure is derived from them at
     read time, so a change in the published rate corrects the history
     rather than leaving it stamped at yesterday's arithmetic. */
  "CREATE TABLE IF NOT EXISTS flows_ai_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0), tokens_in INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0), tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0))",
];

const MARKET_STALE_MS = 45 * 60 * 1000;
const MARKET_FETCH_TIMEOUT_MS = 5000;
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

const setAttr = (name, value) => ({ element: (el) => el.setAttribute(name, value) });

class HttpError extends Error {
  constructor(status, code, message, headers, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.details = details;
  }
}

const json = (value, status = 200, headers) => {
  const out = new Headers(headers);
  out.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: out });
};

const apiError = (status, code, message, headers, details) =>
  json({ error: { code, message }, ...(details || {}) }, status, headers);

const redirect = (location, status = 302, cookies = []) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status, headers });
};

function requireMethod(request, allowed) {
  if (!allowed.includes(request.method)) {
    throw new HttpError(405, "method_not_allowed", "Method not allowed", { Allow: allowed.join(", ") });
  }
}

function requireSameOrigin(request) {
  const expectedOrigin = new URL(request.url).origin;
  const suppliedOrigin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");

  let originMatches = true;
  if (suppliedOrigin !== null) {
    try {
      originMatches = new URL(suppliedOrigin).origin === expectedOrigin;
    } catch {
      originMatches = false;
    }
  }

  if (!originMatches || (fetchSite !== null && fetchSite.trim().toLowerCase() !== "same-origin")) {
    throw new HttpError(403, "forbidden", "Same-origin request required");
  }
}

function requireMutationOwner(request, userId) {
  if (request.headers.get("X-IEWT-Owner") !== userId) {
    throw new HttpError(409, "account_changed", "Signed-in account changed; refresh and try again");
  }
}

function requireReadOwnerIfPresent(request, userId) {
  const owner = request.headers.get("X-IEWT-Owner");
  if (owner !== null && owner !== userId) {
    throw new HttpError(409, "account_changed", "Signed-in account changed; refresh and try again");
  }
}

function requireSessionSecret(env) {
  if (typeof env.SESSION_SECRET !== "string" || !env.SESSION_SECRET) {
    throw new HttpError(503, "service_unavailable", "Account sync is temporarily unavailable");
  }
}

function requireGoogleConfig(env) {
  requireSessionSecret(env);
  if (typeof env.GOOGLE_CLIENT_ID !== "string" || !env.GOOGLE_CLIENT_ID ||
      typeof env.GOOGLE_CLIENT_SECRET !== "string" || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(503, "service_unavailable", "Google sign-in is temporarily unavailable");
  }
}

/**
 * Read a request body with a HARD byte cap, stopping the moment it is
 * exceeded.
 *
 * Content-Length is a claim, not a fact: a chunked request simply omits it,
 * and `Number(null || 0)` is 0, which passes any `> limit` guard. Checking the
 * header alone therefore caps nothing at all — the body still materialises in
 * full before anything truncates it. The header check below is kept only as a
 * cheap early rejection; the loop is what actually enforces the limit.
 */
async function readBounded(request, maxBytes, message) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "payload_too_large", message);
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Stop reading and throw. Do NOT cancel the stream: cancelling a request
      // body tears the connection down rather than delivering this 413, and a
      // caller that gets a reset instead of a status learns nothing. Every
      // other early-return route here abandons the body the same way, and the
      // runtime discards the remainder when the request ends. The cap is
      // enforced by not reading further, which is what actually bounds memory.
      throw new HttpError(413, "payload_too_large", message);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readJSON(request) {
  const contentType = request.headers.get("Content-Type") || "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }

  if (!request.body) throw new HttpError(400, "invalid_json", "A JSON body is required");

  const bytes = await readBounded(request, MAX_JSON_BYTES, "JSON body is too large");
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch {
    throw new HttpError(400, "invalid_json", "Body must be a valid JSON object");
  }
}

function normalizeDone(model, value) {
  if (!Object.hasOwn(COURSE_STAGE_POINTS, model)) return null;
  const weights = COURSE_STAGE_POINTS[model];
  if (!weights || !Array.isArray(value) || value.length > weights.length) return null;
  const done = [];
  const seen = new Set();
  for (const index of value) {
    if (!Number.isInteger(index) || index < 0 || index >= weights.length) return null;
    if (!seen.has(index)) { seen.add(index); done.push(index); }
  }
  return done.sort((a, b) => a - b);
}

function normalizeDay(value) {
  if (value == null || value === "") return null;
  const match = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeActivityDay(value, now = Date.now()) {
  const day = normalizeDay(value);
  if (!day) return day;
  // A local calendar can be one day ahead of UTC near midnight. Anything
  // later can poison monotonic merges and is therefore rejected.
  const latest = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return day <= latest ? day : undefined;
}

const PLACEMENT_BANDS = new Set(["foundation", "applied", "advanced"]);
const PLACEMENT_TOPICS = new Set(["ols", "iv2sls", "did", "var", "panel", "logit", "gmm"]);

function normalizePlacement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !PLACEMENT_BANDS.has(value.band) || !PLACEMENT_TOPICS.has(value.recommendedTopic)) return null;
  const score = value.score;
  const total = value.total;
  const completedDay = normalizeActivityDay(value.completedDay);
  const expectedBand = score <= 6 ? "foundation" : score <= 11 ? "applied" : "advanced";
  if (!Number.isSafeInteger(score) || total !== 15 || score < 0 || score > total ||
      value.band !== expectedBand || !completedDay) return null;
  return { band: value.band, score, total, completedDay, recommendedTopic: value.recommendedTopic };
}

function progressFromRows(rows) {
  const progress = Object.create(null);
  for (const row of rows || []) {
    if (!Object.hasOwn(COURSE_STAGE_POINTS, row.model_id)) continue;
    try {
      const done = normalizeDone(row.model_id, JSON.parse(row.done_json || "[]"));
      if (done) progress[row.model_id] = { done };
    } catch { /* Ignore malformed legacy rows. */ }
  }
  return progress;
}

function normalizeGeneration(value) {
  const generation = Number(value);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("Invalid learning sync generation");
  }
  return generation;
}

function generationHeaders(generation) {
  return { [GENERATION_HEADER]: String(generation) };
}

function throwResetRequired(generation) {
  throw new HttpError(
    409,
    "reset_required",
    "Learning progress was reset; refresh synchronized state and try again",
    generationHeaders(generation),
    { generation },
  );
}

async function learningBatch(env, userId, buildStatements) {
  const execute = () => env.DB.batch([
    env.DB.prepare(
      "INSERT INTO learning_sync (user_id, generation) VALUES (?, 0) " +
      "ON CONFLICT(user_id) DO NOTHING"
    ).bind(userId),
    ...buildStatements(),
  ]);

  try {
    return await execute();
  } catch (error) {
    // schema.sql provisions the table for new databases. Workers Builds does
    // not apply that file to an existing D1 database, so self-heal only the
    // specific legacy-schema failure and retry the rolled-back batch once.
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table:\s*(?:main\.)?learning_sync\b/i.test(message)) throw error;
    await env.DB.prepare(LEARNING_SYNC_SCHEMA_SQL).run();
    return execute();
  }
}

async function ensureMasterySchema(env) {
  await env.DB.batch([
    env.DB.prepare(MASTERY_SCHEMA_SQL),
    env.DB.prepare(MASTERY_ATTEMPTS_SCHEMA_SQL),
    env.DB.prepare(MASTERY_INDEX_SQL),
  ]);
}

// The scheduling tables gained a `last_day` column (attempt-ordering guard) after
// they first shipped. Workers Builds does not apply migrations to an existing D1,
// so — like the missing-table heals — add the column on the specific "no such
// column" failure and retry once. ALTER ADD COLUMN is O(1) metadata-only and
// leaves existing rows NULL (treated as the oldest day). Idempotent: a duplicate
// column or an absent table (created later with the column) is benign. The error
// message does not name the table, and skill attempts also flow through
// masteryBatch, so heal both scheduling tables.
async function addDayColumn(env, table) {
  try {
    await env.DB.prepare("ALTER TABLE " + table + " ADD COLUMN last_day TEXT").run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column name|no such table/i.test(message)) throw error;
  }
}
async function ensureDayColumns(env) {
  await addDayColumn(env, "mastery");
  await addDayColumn(env, "skill_mastery");
}

async function masteryBatch(env, userId, buildStatements) {
  try {
    return await learningBatch(env, userId, buildStatements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // D1 reports the missing column two ways: "no such column: last_day" from an
    // expression, and "table <t> has no column named last_day" from an INSERT
    // column list (which the UPSERT hits first). Match either.
    if (/(?:no such column|has no column named)[^\n]*\blast_day\b/i.test(message)) {
      await ensureDayColumns(env);
      return learningBatch(env, userId, buildStatements);
    }
    if (!/no such table:\s*(?:main\.)?mastery(?:_attempts)?\b/i.test(message)) throw error;
    await ensureMasterySchema(env);
    return learningBatch(env, userId, buildStatements);
  }
}

async function placementBatch(env, userId, buildStatements) {
  try {
    return await masteryBatch(env, userId, buildStatements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table:\s*(?:main\.)?placement\b/i.test(message)) throw error;
    await env.DB.prepare(PLACEMENT_SCHEMA_SQL).run();
    return masteryBatch(env, userId, buildStatements);
  }
}

async function ensureAcademySchema(env) {
  await env.DB.batch(ACADEMY_SCHEMA_SQL.map((statement) => env.DB.prepare(statement)));
}

async function academyBatch(env, userId, buildStatements) {
  try {
    return await placementBatch(env, userId, buildStatements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table:\s*(?:main\.)?(?:progress_v3|skill_mastery|skill_attempts|learning_preferences|project_progress)\b/i.test(message)) throw error;
    await ensureAcademySchema(env);
    return placementBatch(env, userId, buildStatements);
  }
}

// Self-heal the single-row snapshot table on the "no such table" failure, like
// the learning tables (Workers Builds does not apply migrations to an existing
// D1). Any market DB op runs through this.
async function marketOp(env, op) {
  try {
    return await op();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table:\s*(?:main\.)?market_snapshot\b/i.test(message)) throw error;
    await env.DB.prepare(MARKET_SNAPSHOT_SCHEMA_SQL).run();
    return op();
  }
}

// Fetch one index from Yahoo's public chart API, trying the query1/query2
// mirrors in turn with a hard timeout. Returns a parsed quote or null; never
// throws, so one bad symbol can't sink the batch.
async function fetchIndexQuote(index) {
  for (const host of YAHOO_HOSTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MARKET_FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(
          "https://" + host + "/v8/finance/chart/" + encodeURIComponent(index.yahoo) + "?range=5d&interval=1d",
          { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; anilkaya.org market board)", "Accept": "application/json" } },
        );
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) continue;
      const quote = parseIndexQuote(index, await response.json());
      if (quote) return quote;
    } catch { /* try the next mirror */ }
  }
  return null;
}

// Refresh all indices in parallel and persist the snapshot. A run that returns
// zero quotes (total upstream failure) leaves the existing row untouched so the
// ticker keeps showing the last good data. Returns the stored payload or null.
async function refreshMarketSnapshot(env) {
  const settled = await Promise.allSettled(MARKET_INDICES.map(fetchIndexQuote));
  const quotes = settled.map((r) => (r.status === "fulfilled" ? r.value : null)).filter(Boolean);
  if (!quotes.length) return null;
  const now = Date.now();
  const payload = JSON.stringify(buildSnapshot(quotes, now));
  await marketOp(env, () =>
    env.DB.prepare(
      "INSERT INTO market_snapshot (id, payload, updated_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
    ).bind(payload, now).run(),
  );
  return payload;
}

// Serve the cached snapshot, repairing it inline only when it is missing or well
// past the cron cadence (bootstrap and cron-outage recovery). Always resolves to
// a valid body; an empty-quotes payload is the graceful floor.
async function loadMarketSnapshot(env) {
  let row = null;
  try {
    row = await marketOp(env, () => env.DB.prepare("SELECT payload, updated_at FROM market_snapshot WHERE id=1").first());
  } catch { row = null; }
  const age = row ? Date.now() - Number(row.updated_at) : Infinity;
  if (age > MARKET_STALE_MS) {
    const refreshed = await refreshMarketSnapshot(env).catch(() => null);
    if (refreshed) return refreshed;
    // Repair failed. Touch the row's updated_at (keeping the last-known-good
    // payload, or an empty one on cold start) so reads back off for a full
    // window instead of re-firing the upstream fetch on every request; the cron
    // keeps retrying in the background and fills real data once upstream recovers.
    const now = Date.now();
    const payload = row ? row.payload : JSON.stringify({ quotes: [], updatedAt: now });
    await marketOp(env, () => env.DB.prepare(
      "INSERT INTO market_snapshot (id, payload, updated_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at",
    ).bind(payload, now).run()).catch(() => {});
    return payload;
  }
  return row.payload;
}

function masteryRecord(row) {
  if (!row || !Object.hasOwn(REVIEW_ITEM_BY_ID, row.item_id)) return null;
  const level = Number(row.level);
  const attempts = Number(row.attempts);
  const correct = Number(row.correct);
  const updatedAt = Number(row.updated_at);
  const dueDay = normalizeDay(row.due_day);
  if (!Number.isSafeInteger(level) || level < 0 || level > 5 || !dueDay ||
      !Number.isSafeInteger(attempts) || attempts < 0 || attempts > 1000000 ||
      !Number.isSafeInteger(correct) || correct < 0 || correct > attempts ||
      !Number.isSafeInteger(updatedAt) || updatedAt < 0) return null;
  return {
    level,
    dueDay,
    attempts,
    correct,
    lastResult: row.last_result == null ? null : Number(row.last_result) === 1,
    lastAttemptId: typeof row.last_attempt_id === "string" ? row.last_attempt_id : null,
    updatedAt,
  };
}

function skillMasteryRecord(row) {
  if (!row || !Object.hasOwn(SKILL_BY_ID, row.skill_id)) return null;
  const level = Number(row.level), attempts = Number(row.attempts), correct = Number(row.correct), updatedAt = Number(row.updated_at);
  const dueDay = normalizeDay(row.due_day);
  if (!Number.isSafeInteger(level) || level < 0 || level > 5 || !dueDay || !Number.isSafeInteger(attempts) || attempts < 0 || attempts > 1000000 || !Number.isSafeInteger(correct) || correct < 0 || correct > attempts || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return null;
  return { level, dueDay, attempts, correct, lastResult: row.last_result == null ? null : Number(row.last_result) === 1, lastAttemptId: typeof row.last_attempt_id === "string" ? row.last_attempt_id : null, updatedAt };
}

function stableProgressFromRows(rows) {
  const progress = Object.create(null);
  for (const row of rows || []) {
    const key = `${row.course_id}:${row.stage_id}`;
    if (!Object.hasOwn(STAGE_KEY_BY_COURSE, key)) continue;
    if (!progress[row.course_id]) progress[row.course_id] = { done: [] };
    progress[row.course_id].done.push(row.stage_id);
  }
  for (const [courseId, value] of Object.entries(progress)) {
    value.done.sort((a, b) => STAGE_KEY_BY_COURSE[`${courseId}:${a}`].index - STAGE_KEY_BY_COURSE[`${courseId}:${b}`].index);
  }
  return progress;
}

function projectLegacyProgress(progress) {
  const stable = Object.create(null);
  for (const [courseId, value] of Object.entries(progress || {})) {
    if (!Array.isArray(value && value.done)) continue;
    for (const index of value.done) {
      const match = Object.values(COURSE_STAGE_BY_ID).find((stage) => stage.courseId === courseId && stage.index === index);
      if (!match) continue;
      if (!stable[courseId]) stable[courseId] = { done: [] };
      if (!stable[courseId].done.includes(match.id)) stable[courseId].done.push(match.id);
    }
  }
  return stable;
}

function unionStableProgress(primary, secondary) {
  const merged = Object.create(null);
  for (const source of [primary, secondary]) {
    for (const [courseId, value] of Object.entries(source || {})) {
      const set = new Set((merged[courseId] && merged[courseId].done) || []);
      for (const stageId of value.done || []) if (Object.hasOwn(STAGE_KEY_BY_COURSE, `${courseId}:${stageId}`)) set.add(stageId);
      merged[courseId] = { done: [...set].sort((a, b) => STAGE_KEY_BY_COURSE[`${courseId}:${a}`].index - STAGE_KEY_BY_COURSE[`${courseId}:${b}`].index) };
    }
  }
  return merged;
}

function mergeProjectedSkillMastery(stored, legacy) {
  const merged = { ...stored };
  for (const [itemId, record] of Object.entries(legacy || {})) {
    const item = REVIEW_ITEM_BY_ID[itemId];
    for (const skillId of (item && item.skillIds) || []) {
      if (!Object.hasOwn(SKILL_BY_ID, skillId)) continue;
      const previous = merged[skillId];
      if (!previous) { merged[skillId] = { ...record }; continue; }
      merged[skillId] = {
        level: Math.max(previous.level, record.level),
        dueDay: [previous.dueDay, record.dueDay].filter(Boolean).sort()[0] || null,
        attempts: Math.min(1000000, previous.attempts + record.attempts),
        correct: Math.min(1000000, previous.correct + record.correct),
        lastResult: previous.updatedAt >= record.updatedAt ? previous.lastResult : record.lastResult,
        lastAttemptId: previous.updatedAt >= record.updatedAt ? previous.lastAttemptId : record.lastAttemptId,
        updatedAt: Math.max(previous.updatedAt, record.updatedAt),
      };
    }
  }
  return merged;
}

function preferencesRecord(row) {
  return {
    activePathId: row && PATH_IDS.has(row.active_path_id) ? row.active_path_id : "complete-core",
    sessionMinutes: row && SESSION_MINUTES.has(Number(row.session_minutes)) ? Number(row.session_minutes) : 20,
    weeklyGoalMinutes: row && Number.isSafeInteger(Number(row.weekly_goal_minutes)) && Number(row.weekly_goal_minutes) >= 30 && Number(row.weekly_goal_minutes) <= 1200 ? Number(row.weekly_goal_minutes) : 120,
  };
}

function projectsFromRows(rows) {
  const projects = Object.create(null);
  for (const row of rows || []) {
    const project = PROJECT_BY_ID[row.project_id];
    if (!project || !["guided", "unguided"].includes(row.mode)) continue;
    try {
      const done = JSON.parse(row.done_json || "[]");
      if (!Array.isArray(done)) continue;
      projects[row.project_id] = { mode: row.mode, done: [...new Set(done.filter((taskId) => project.taskIds.includes(taskId)))] };
    } catch { /* Ignore malformed legacy project rows. */ }
  }
  return projects;
}

function validSkillItem(skillId, itemId) {
  if (itemId === `${skillId}:v1` || itemId === `${skillId}:v2` || itemId === `${skillId}:v3`) return true;
  const review = REVIEW_ITEM_BY_ID[itemId];
  if (review && Array.isArray(review.skillIds) && review.skillIds.includes(skillId)) return true;
  const stage = COURSE_STAGE_BY_ID[itemId];
  return !!(stage && Array.isArray(stage.skillIds) && stage.skillIds.includes(skillId));
}

async function loadMasterySnapshot(env, userId) {
  const results = await masteryBatch(env, userId, () => [
    env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id = ?").bind(userId),
    env.DB.prepare(
      "SELECT item_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at " +
      "FROM mastery WHERE user_id = ? ORDER BY item_id"
    ).bind(userId),
  ]);
  const sync = results[1].results[0];
  if (!sync) throw new Error("Learning sync state is missing");
  const mastery = Object.create(null);
  for (const row of results[2].results || []) {
    const record = masteryRecord(row);
    if (record) mastery[row.item_id] = record;
  }
  return { mastery, generation: normalizeGeneration(sync.generation) };
}

function placementRecord(row) {
  if (!row) return null;
  return normalizePlacement({
    band: row.band,
    score: Number(row.score),
    total: Number(row.total),
    completedDay: row.completed_day,
    recommendedTopic: row.recommended_topic,
  });
}

async function loadPlacementSnapshot(env, userId) {
  const results = await placementBatch(env, userId, () => [
    env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id = ?").bind(userId),
    env.DB.prepare(
      "SELECT band, score, total, completed_day, recommended_topic FROM placement WHERE user_id = ?"
    ).bind(userId),
  ]);
  const sync = results[1].results[0];
  if (!sync) throw new Error("Learning sync state is missing");
  return {
    placement: placementRecord(results[2].results[0]),
    generation: normalizeGeneration(sync.generation),
  };
}

async function loadGeneration(env, userId) {
  const results = await learningBatch(env, userId, () => [
    env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id = ?").bind(userId),
  ]);
  const row = results[1].results[0];
  if (!row) throw new Error("Learning sync state is missing");
  return normalizeGeneration(row.generation);
}

async function mutationGeneration(request, env, userId) {
  const raw = request.headers.get(GENERATION_HEADER);
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw)) {
    throwResetRequired(await loadGeneration(env, userId));
  }
  const generation = Number(raw);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throwResetRequired(await loadGeneration(env, userId));
  }
  return generation;
}

async function loadProgressSnapshot(env, userId) {
  const results = await learningBatch(env, userId, () => [
    env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id = ?").bind(userId),
    env.DB.prepare(
      "SELECT model_id, done_json FROM progress WHERE user_id = ? ORDER BY model_id"
    ).bind(userId),
  ]);
  const syncResult = results[1];
  const progressResult = results[2];
  const sync = syncResult.results[0];
  if (!sync) throw new Error("Learning sync state is missing");
  return {
    generation: normalizeGeneration(sync.generation),
    progress: progressFromRows(progressResult.results),
  };
}

// Points are a pure function of progress + per-stage weights, computed read-only
// on every read path via this statement. Nothing writes or reads a materialized
// stats.points column anymore, so a GET never bills a row-written and a progress
// write never spends one keeping points in sync.
function derivedPointsSelectStatement(env, userId) {
  return env.DB.prepare(
    "WITH weights(model_id, stage_index, points) AS (" +
      "SELECT courses.key, CAST(stages.key AS INTEGER), CAST(stages.value AS INTEGER) " +
      "FROM json_each(?) AS courses, json_each(courses.value) AS stages" +
    "), completed(model_id, stage_index) AS (" +
      "SELECT DISTINCT p.model_id, CAST(done.value AS INTEGER) " +
      "FROM progress AS p, json_each(CASE WHEN json_valid(p.done_json) THEN p.done_json ELSE '[]' END) AS done " +
      "WHERE p.user_id=? AND done.type='integer'" +
    ") SELECT COALESCE(SUM(weights.points), 0) AS points FROM completed JOIN weights USING (model_id, stage_index)"
  ).bind(JSON.stringify(COURSE_STAGE_POINTS), userId);
}

async function loadStatsSnapshot(env, userId) {
  const read = async () => {
    // One batch, zero writes: read generation + streak/last, and derive points
    // read-only in the same round-trip (no more sync-write on the read path).
    const results = await learningBatch(env, userId, () => [
      env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id = ?").bind(userId),
      env.DB.prepare("SELECT streak, last FROM stats WHERE user_id = ?").bind(userId),
      derivedPointsSelectStatement(env, userId),
    ]);
    const sync = results[1].results[0];
    if (!sync) throw new Error("Learning sync state is missing");
    return {
      generation: normalizeGeneration(sync.generation),
      row: results[2].results[0] || null,
      points: Number(results[3].results[0]?.points) || 0,
    };
  };

  let snapshot = await read();
  let storedLast = normalizeActivityDay(snapshot.row && snapshot.row.last);
  if (snapshot.row && snapshot.row.last != null && !storedLast) {
    const poisonedLast = String(snapshot.row.last);
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE stats SET streak=0, last=NULL, updated_at=MAX(COALESCE(updated_at, 0), ?) " +
      "WHERE user_id=? AND last=?"
    ).bind(now, userId, poisonedLast).run();
    snapshot = await read();
    storedLast = normalizeActivityDay(snapshot.row && snapshot.row.last);
  }

  const storedStreak = Number(snapshot.row && snapshot.row.streak);
  return {
    generation: snapshot.generation,
    stats: {
      points: snapshot.points,
      streak: Number.isSafeInteger(storedStreak) && storedStreak >= 0 ? Math.min(100000, storedStreak) : 0,
      last: storedLast || null,
    },
  };
}

// The six legacy hydration reads (points derived read-only, no write). Batch
// wrappers prepend the learning_sync ensure at results[0], so these occupy
// results[1..6].
function bootstrapLegacyStatements(env, userId) {
  return [
    derivedPointsSelectStatement(env, userId),
    env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id = ?").bind(userId),
    env.DB.prepare("SELECT model_id, done_json FROM progress WHERE user_id = ? ORDER BY model_id").bind(userId),
    env.DB.prepare("SELECT streak, last FROM stats WHERE user_id = ?").bind(userId),
    env.DB.prepare(
      "SELECT item_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at " +
      "FROM mastery WHERE user_id = ? ORDER BY item_id"
    ).bind(userId),
    env.DB.prepare("SELECT band, score, total, completed_day, recommended_topic FROM placement WHERE user_id = ?").bind(userId),
  ];
}

// The four academy hydration reads. When appended to the legacy set they occupy
// results[7..10]. The generation is NOT re-read — the legacy set already has it.
function bootstrapAcademyStatements(env, userId) {
  return [
    env.DB.prepare("SELECT course_id, stage_id FROM progress_v3 WHERE user_id=? ORDER BY course_id, completed_at, stage_id").bind(userId),
    env.DB.prepare("SELECT skill_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at FROM skill_mastery WHERE user_id=? ORDER BY skill_id").bind(userId),
    env.DB.prepare("SELECT active_path_id, session_minutes, weekly_goal_minutes FROM learning_preferences WHERE user_id=?").bind(userId),
    env.DB.prepare("SELECT project_id, mode, done_json FROM project_progress WHERE user_id=? ORDER BY project_id").bind(userId),
  ];
}

// Run hydration in ONE D1 batch (legacy, or legacy+academy) with the poisoned-
// last self-repair. Returns the parsed legacy fields plus the raw results so the
// academy caller can read its own slice without a second round trip.
async function runBootstrapBatch(env, user, academy) {
  const build = () => academy
    ? [...bootstrapLegacyStatements(env, user.id), ...bootstrapAcademyStatements(env, user.id)]
    : bootstrapLegacyStatements(env, user.id);
  const batch = academy ? academyBatch : placementBatch;
  const parse = (results) => {
    const sync = results[2].results[0];
    if (!sync) throw new Error("Learning sync state is missing");
    return {
      generation: normalizeGeneration(sync.generation),
      points: Number(results[1].results[0]?.points) || 0,
      progress: progressFromRows(results[3].results),
      statsRow: results[4].results[0] || null,
      masteryRows: results[5].results || [],
      placementRow: results[6].results[0] || null,
      results,
    };
  };
  let snapshot = parse(await batch(env, user.id, build));
  let storedLast = normalizeActivityDay(snapshot.statsRow && snapshot.statsRow.last);
  if (snapshot.statsRow && snapshot.statsRow.last != null && !storedLast) {
    await env.DB.prepare(
      "UPDATE stats SET streak=0, last=NULL, updated_at=MAX(COALESCE(updated_at, 0), ?) " +
      "WHERE user_id=? AND last=?"
    ).bind(Date.now(), user.id, String(snapshot.statsRow.last)).run();
    snapshot = parse(await batch(env, user.id, build));
    storedLast = normalizeActivityDay(snapshot.statsRow && snapshot.statsRow.last);
  }
  snapshot.storedLast = storedLast;
  return snapshot;
}

function assembleLegacySnapshot(user, snapshot) {
  const storedStreak = Number(snapshot.statsRow && snapshot.statsRow.streak);
  const mastery = Object.create(null);
  for (const row of snapshot.masteryRows) {
    const record = masteryRecord(row);
    if (record) mastery[row.item_id] = record;
  }
  return {
    user,
    progress: snapshot.progress,
    stats: {
      points: snapshot.points,
      streak: Number.isSafeInteger(storedStreak) && storedStreak >= 0 ? Math.min(100000, storedStreak) : 0,
      last: snapshot.storedLast || null,
    },
    mastery,
    placement: placementRecord(snapshot.placementRow),
    generation: snapshot.generation,
  };
}

async function loadBootstrapSnapshot(env, user) {
  return assembleLegacySnapshot(user, await runBootstrapBatch(env, user, false));
}

async function loadAcademyBootstrapSnapshot(env, user) {
  const snapshot = await runBootstrapBatch(env, user, true);
  const legacy = assembleLegacySnapshot(user, snapshot);
  const results = snapshot.results; // academy slice: results[7..10]
  const storedSkills = Object.create(null);
  for (const row of results[8].results || []) {
    const record = skillMasteryRecord(row);
    if (record) storedSkills[row.skill_id] = record;
  }
  return {
    ...legacy,
    stableProgress: unionStableProgress(stableProgressFromRows(results[7].results), projectLegacyProgress(legacy.progress)),
    skillMastery: mergeProjectedSkillMastery(storedSkills, legacy.mastery),
    preferences: preferencesRecord(results[9].results[0]),
    projects: projectsFromRows(results[10].results),
  };
}

/* ---------- Flows helpers ---------------------------------------- */

async function currentFlowsUser(request, env) {
  const token = getCookie(request, FLOWS_COOKIE);
  if (!token || !env.SESSION_SECRET) return null;
  return verifyFlowsSession(token, env.SESSION_SECRET, sessionEpoch(env));
}

// Bounded form read. A login body is a few dozen bytes; anything larger
// is not a login and is refused before it reaches the KDF.
async function readFlowsForm(request) {
  const bytes = await readBounded(request, 4096, "Request body too large");
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

function flowsLoginResponse(message) {
  // Deliberately uniform: never reveals whether the username exists.
  return new Response(FLOWS_PAGES.loginPage({ error: message }), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * The ingest cap is a READ-path CPU guarantee, not an arbitrary size guard.
 *
 * A "zero-parse byte passthrough" is not free: the stored value still crosses
 * the D1 driver and the response body. Measured against local workerd,
 * calibrated with PBKDF2-10k (5.09 ms of separately known CPU) as a ruler:
 *
 *      15 KB -> 1.60 ms      469 KB ->  6.08 ms
 *     117 KB -> 3.03 ms     1174 KB -> 12.53 ms   (over the 10 ms budget)
 *
 * Least squares over those four points gives TWO terms, and both matter:
 *
 *      cost = 1.7 ms fixed + 1 ms per 108 KB
 *
 * The fixed term is the part that is easy to drop, and dropping it is how the
 * earlier 2 MB cap looked acceptable and how this comment previously claimed a
 * 256 KB read costs 2.4 ms. It does not — 2.4 ms is the marginal term alone;
 * the real figure is 4.1 ms, or 41% of the budget rather than 24%.
 *
 * At 128 KB the bound is 2.9 ms, under a third of the 10 ms Workers Free
 * allowance, which leaves the isolate's burst tolerance as an actual margin
 * instead of something the design leans on. Nothing larger than the cap can be
 * stored, so nothing larger can be served: the cap is what makes that bound
 * hold. A 50-row board measures 29 KB and a per-ticker card 20-40 KB, so this
 * is still three to four times the largest payload either produces.
 */
const FLOWS_MAX_PAYLOAD_BYTES = 128 * 1024;

function timingSafeEqualStr(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** The one ticker pattern. Both the ingest key check and the card read use it. */
const FLOWS_TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

/* THE KEYS THAT ARE A RECORD RATHER THAN A VIEW.

   `board:long`, `pulse`, `market` and the rest describe TODAY and are meant
   to be overwritten every morning — rewriting them is the product working.
   These are different: each one is what a specific past session said, and
   shared/flows-record.js reads them to compute the accuracy the deck
   publishes. Overwriting one revises history.

   DELIBERATELY THE SAME SHAPE THE DELETE BRANCH ACCEPTS. The two have to
   agree: a key immutable to writes but not deletable would be permanent by
   accident, and a key deletable but freely writable is the defect this
   pattern was added to fix. Written once, used in both places, so they
   cannot drift. */
const DATED_ARCHIVE_KEY_RE = /^(board:(long|short)|scores):\d{4}-\d{2}-\d{2}$/;

/** Fetch a stored blob by key. Returns {payload, updatedAt}, or null if absent. */
/* =============================================================
   INTRADAY FRESHNESS — the cron re-reads the two feeds that fill
   DURING the session, so their pages stop being last night's copy.

   Everything else the pipeline publishes is once-a-day by nature
   (boards, cards, the archive); these two are not: the market tide
   is a running intraday series and the vendor's flow alerts fire
   all session. The Worker already wakes every 15 minutes for the
   market snapshot; inside the Eastern session (the gate lives in
   shared/flows-freshness.js) that wake now also spends TWO vendor
   calls — a cost of ~52 calls a day against a plan measured in
   hundreds of millions.

   REFRESH, NEVER SEED. Both refreshes require the nightly key to
   exist and keep its envelope (v, generatedAt, sessionDate, the
   neighbouring pulse feeds): the pipeline owns the shape, the cron
   only re-reads what fills intraday and stamps readAt. A cold
   store stays cold until the pipeline runs — a cron that seeded
   keys would be a second publisher with a second idea of the
   schema, which is the class of drift the shape suite exists to
   kill. On any failure the stored copy stands untouched, and its
   readAt says honestly how old the read is.

   AND FOR THE ALERTS, MERGE RATHER THAN REPLACE. The two feeds are
   not the same kind of thing. The tide is a SERIES the vendor
   restates whole, so re-reading it IS the whole update. The flow
   alerts are a rolling WINDOW of the vendor's newest flags, so
   re-reading them and writing the result deleted every flag older
   than the last few minutes — a name flagged at 09:31 was gone
   from the page at 09:46, all session, every session. What an
   early-warning surface needs is the session's accumulated record,
   so the alerts branch unions each read into the day's record
   (shared/flows-alerts.js owns that arithmetic, because derived
   arithmetic belongs where it can be tested) and starts the record
   over at the session boundary.
   ============================================================= */
/**
 * The EASTERN calendar date a read belongs to.
 *
 * The alerts record accumulates across a session and resets at the session
 * boundary, so it has to be able to NAME its day — an accumulation that
 * cannot say which day it covers is exactly the record that silently carries
 * yesterday's flags into today. The day is an Eastern one because that is the
 * day the market is in and the day `sessionDate` on this key already names;
 * a UTC date would name the same span by a different calendar and the two
 * would disagree on every payload a reader compares them across.
 *
 * Read through the IANA zone rather than an offset table for the reason
 * shared/flows-freshness.js reads its window that way: an offset table has
 * already gone stale in this repository once and cost half a year of runs.
 * It lives here rather than in that module because the gate answers one
 * question — is this instant inside the window — while the record's day is a
 * property of the write.
 *
 * Null on an unreadable instant, which mergeAlerts treats as "this read
 * cannot name its day, so do not accumulate into it".
 */
function easternSessionDate(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value]));
  return parts.year && parts.month && parts.day
    ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

async function refreshFlowsIntraday(env) {
  if (!env.DB || !env.UW_API_KEY) return;
  if (!isRefreshWindow(new Date())) return;
  await ensureFlowsTables(env);

  const upsert = (key, obj) => env.DB.prepare(
    "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
  ).bind(key, JSON.stringify(obj), Date.now()).run();

  /* Each refresh fails alone, and a failure is logged rather than thrown:
     the scheduled handler's other duties never pay for a vendor outage. */
  try {
    const stored = await readFlowsPayload(env, "flowalerts");
    if (stored) {
      const prev = JSON.parse(stored.payload);
      const raw = await uwFetch(env, "/api/option-trades/flow-alerts", { limit: 60 });
      /* The nightly run knew every name's place in the board funnel; this
         handler does not re-derive that (that would be a second publisher of
         the funnel), it carries each name's last known stage forward out of
         the stored payload.

         AND IT DECLARES THAT MAP PARTIAL, because the shaper's default turns
         a miss into "foreign" and the page prints "foreign" as "the screener
         never returned this name". That reading is true of the nightly's map,
         which was built from the whole screened universe. It is false of this
         one, which holds only the names the stored payload already carried —
         sixty rows on the first cron of the day. A name flagged at 09:31 that
         was not in last night's alerts missed this map for a reason that has
         nothing to do with the screener, and it was being published as
         evidence about the screener. The record then made the falsehood
         stick: once a row is held, the next read reads its stage back out of
         the row this one wrote. `stageComplete: false` is that difference,
         stated, and it costs a dash instead of a claim. */
      const lastStage = new Map((prev.rows || []).map((r) => [r.t, r.st]));
      const alerts = buildFlowAlerts(raw, {
        stageOf: (t) => lastStage.get(t) || null,
        stageComplete: false,
      });
      /* A QUIET READ NEVER OVERWRITES A FEED THAT HAS DATA — the same guard
         the tide refresh below has always carried, and whose absence here
         cost the product its entire alerts feed every session.

         The spread `{...prev, ...alerts}` overwrote prev.rows, prev.seen and
         prev.status wholesale. With the envelope defect above, `alerts` was a
         well-formed empty feed, so sixty real rows were replaced by zero on
         the first cron firing after 09:15 ET and again every fifteen minutes.
         Better a stale feed with an honest readAt than an empty fresh one, so
         the write happens only when the read actually produced rows.

         The two conditions are separate on purpose: a shape bug is now
         impossible (the shaper unwraps), and a genuinely empty vendor read is
         still refused here. Fixing only one of them would leave the other
         able to blank the key on its own.

         MERGING DOES NOT SOFTEN THIS GUARD, and it is worth saying why it
         still has to be here now that a wholesale replacement is gone. An
         empty read merged into the record would leave the ROWS intact — but
         it would advance the envelope's readAt, and readAt is the page's
         claim about how fresh the rows are. Writing "read at 11:00" over rows
         nothing confirmed at 11:00 is the same defect in slower motion.

         The third condition is new and is the merge's own: a ceiling that
         somehow kept nothing must not be able to blank the key either. It
         cannot happen with the published ceilings; it is here because the
         first version of this handler also could not happen. */
      const readAt = new Date();
      const merged = (alerts.status === "ok" && alerts.rows.length)
        ? mergeAlerts(prev, alerts, {
            at: readAt.toISOString(),
            sessionDate: easternSessionDate(readAt),
          })
        : null;
      if (merged && merged.rows.length) {
        /* The spread survives, and now it is safe: `merged.rows` IS the union
           of the stored rows and this read, so replacing prev.rows with it
           adds rather than deletes. Everything the pipeline owns — v,
           generatedAt, sessionDate, vendorLimit, vendorTruncated — still
           rides through from `prev` untouched, because the cron is not a
           second publisher of this key's shape. */
        await upsert("flowalerts", {
          ...prev, ...merged,
          readAt: readAt.toISOString(),
          refreshed: "intraday",
        });
        /* What the merge actually did, in the numbers that distinguish it
           from the replacement it replaced: `carried` is the count of windows
           the vendor's rolling list has already dropped and this record still
           holds — every one of which the old spread deleted. */
        console.log(JSON.stringify({
          message: "flowalerts intraday record merged",
          date: merged.record.date, reads: merged.record.reads,
          read: alerts.rows.length, entered: merged.record.entered,
          again: merged.record.again, carried: merged.record.carried,
          kept: merged.record.kept, union: merged.record.union,
          everEntered: merged.record.everEntered,
          shed: merged.record.shed, shedBy: merged.record.shedBy,
          bytes: merged.record.bytes, reset: merged.record.reset,
        }));
      } else {
        /* Not silent: a refresh that declines to write is a fact about this
           read, and the stored copy's own readAt still says how old it is. */
        console.log(JSON.stringify({
          message: "flowalerts intraday refresh declined to write",
          status: alerts.status, shaped: alerts.rows.length, unusable: alerts.unusable,
          merged: merged ? merged.rows.length : null,
        }));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "flowalerts intraday refresh failed",
      error: error instanceof Error ? error.message : String(error) }));
  }

  try {
    const stored = await readFlowsPayload(env, "pulse");
    if (stored) {
      const prev = JSON.parse(stored.payload);
      const raw = await uwFetch(env, "/api/market/market-tide", { interval_5m: "true" });
      const tide = shapeTide(raw);
      /* A quiet or failed read never overwrites a series that has data:
         better a stale tide with an honest readAt than an empty fresh one. */
      if (tide.status === "ok") {
        await upsert("pulse", {
          ...prev, tide,
          readAt: new Date().toISOString(),
          refreshed: "intraday",
        });
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "pulse tide intraday refresh failed",
      error: error instanceof Error ? error.message : String(error) }));
  }
}

async function readFlowsPayload(env, key) {
  if (!env.DB) return null;
  await ensureFlowsTables(env);
  const row = await env.DB.prepare(
    "SELECT payload, updated_at FROM flows_payload WHERE id = ?"
  ).bind(key).first().catch(() => null);
  return row && row.payload ? { payload: row.payload, updatedAt: row.updated_at } : null;
}

/**
 * Serve a stored blob without parsing it. The value was validated as JSON at
 * ingest, so parsing here would only burn CPU proportional to its size — the
 * one cost this design exists to avoid.
 *
 * X-Payload-Updated is how a reader detects a STALE card without the Worker
 * having to look inside. Once a card has been written once, a later pipeline
 * failure leaves the old row in place and this route would answer 200 with
 * month-old gamma levels beside a board showing today's date — and the Worker
 * structurally cannot notice, because not parsing is the whole architecture.
 * The write timestamp is already a column, so surfacing it costs one field in
 * the SELECT and no CPU at all.
 */
function passthrough(stored) {
  return new Response(stored.payload, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Payload-Updated": String(stored.updatedAt || 0),
    },
  });
}

/* =============================================================
   THE QUESTION BOX

   A language model is allowed to choose words here and nothing else.
   Every figure in every answer was measured by the pipeline, written
   into a fact's sentence, and is checked back out of the model's
   reply before a reader sees it: guardAnswer() rejects any numeral
   that does not already appear in the facts the model was handed.
   A rejected answer is not an error page — the deterministic reading
   is served in its place, because the numbers were never the model's
   to begin with and the reader loses only the phrasing.

   THE MODEL IS OPTIONAL AND THE PAGE IS NOT. Every branch below ends
   with an answer. The only thing that varies is whether prose was
   generated and, when it was not, which of four honest reasons is
   printed.
   ============================================================= */

/* THE MODEL IS CONFIGURATION, NOT A CONSTANT, and the reason is that
   free-tier membership is a moving target. The 2026-07-28 catalogue
   change moved kimi-k2.6, kimi-k2.7-code and glm-5.2 to Paid;
   @cf/zai-org/glm-4.7-flash stayed. The next such change should cost a
   variable edit rather than a deploy of code, and an unset variable
   must mean "no model configured" — which this route already answers
   with the deterministic reading and a sentence saying so.

   THAT IS ALSO WHAT KEEPS CI OFF THE METER. Local Wrangler inference
   bills the SAME account-wide 10,000-neuron allowance as production, so
   a suite that reached a model would spend a shared budget on every run
   and make its own result depend on a quota. tests/worker-server.mjs
   passes this empty on purpose, and every no-model branch below is
   exercised there. */
const askModel = (env) => {
  const m = env && typeof env.FLOWS_ASK_MODEL === "string" ? env.FLOWS_ASK_MODEL.trim() : "";
  return m === "" ? null : m;
};

/* The question is a prompt, not a payload. A long one buys nothing —
   selection is by ticker and keyword — and spends neurons from an
   allowance shared with everyone on the account. */
const ASK_QUESTION_MAX = 400;

/**
 * Which Workers AI refusal this is.
 *
 * 3036 AND 3040 ARE BOTH HTTP 429 AND THEY ARE NOT THE SAME FACT. One
 * means the account's 10,000-neuron daily free allowance is spent and
 * the reader should come back after 00:00 UTC; the other means no data
 * centre had capacity for this request and the reader should ask again
 * now. Branching on the status would merge them and send half the
 * readers away for a day over a transient. So this reads the numeric
 * code out of the error and treats an unreadable one as its own third
 * answer — "the model could not be reached, and it did not say why" —
 * rather than guessing which of the two it was.
 */
function askFailure(error) {
  const text = error && error.message ? String(error.message) : "";
  const code = /\b(3036|3040|5035|5006)\b/.exec(text);
  switch (code && code[1]) {
    case "3036": return { why: "allowance",
      say: "The free daily allowance for the model is spent for today. It resets at " +
        "00:00 UTC. The readings below were measured by the pipeline and are unaffected." };
    case "3040": return { why: "capacity",
      say: "The model had no capacity for this question just now — nothing was spent, " +
        "and asking again shortly may work. The readings below are unaffected." };
    case "5035": return { why: "plan",
      say: "The model this site uses is no longer available on its plan, which is a " +
        "configuration fault here rather than a limit you reached. The readings below " +
        "were measured by the pipeline and are unaffected." };
    default: return { why: "unreachable",
      say: "The model could not be reached, and it did not say why. The readings below " +
        "were measured by the pipeline and are unaffected." };
  }
}

/* THE FREE ALLOWANCE, AND THE TWO RATES THAT TURN TOKENS INTO NEURONS.
   Published by Cloudflare: 10,000 Neurons per day, account-wide, reset at
   00:00 UTC. The rates are the model's own price card and they live beside
   the model id in wrangler.toml, because a rate belonging to a DIFFERENT
   model than the one configured is a meter that reads plausibly and is
   wrong — the same failure as a size in a comment that stopped being true.
   Absent or unparseable, this route reports tokens and calls and withholds
   the neuron figure rather than deriving one from a guess. */
const AI_DAILY_NEURONS = 10000;

function neuronRates(env) {
  const raw = env && typeof env.FLOWS_ASK_NEURONS === "string" ? env.FLOWS_ASK_NEURONS : "";
  const parts = raw.split(",").map((x) => Number(x.trim()));
  if (parts.length !== 2 || !parts.every((x) => Number.isFinite(x) && x >= 0)) return null;
  return { inPerM: parts[0], outPerM: parts[1] };
}

/**
 * What this site has spent on the model today, and what that leaves.
 *
 * IT SUBTRACTS, AND THE SUBTRAHEND IS THE PART THAT NEEDS STATING. The
 * 10,000-neuron allowance belongs to the Cloudflare ACCOUNT, not to this
 * route: another Worker, a dashboard experiment, a second site would draw
 * from the same pool and be invisible here. So `remaining` is a real
 * subtraction from a real allowance, but it is only the truth about the
 * account under one assumption — that nothing else on it spent today.
 *
 * I first built this to refuse the subtraction outright, on the grounds
 * that a figure it cannot fully see is a figure it should not print. That
 * was the wrong call. The assumption is not hidden and it is not
 * unknowable: it belongs to whoever owns the account, wrangler.toml already
 * records that nothing else spends on this one, and a reader who is told
 * both the number AND what it assumes can check it. Withholding it instead
 * gave a reader a spend with no denominator, which is the failure this
 * codebase names most often.
 *
 * `assumesSoleSpender` travels WITH the number so the two cannot be
 * separated on the way to a page. A remaining balance rendered without it
 * is the confident unmeasured figure; rendered with it, it is a measurement
 * and its condition.
 *
 * CLOUDFLARE IS STILL THE AUTHORITY, and the disagreement is informative.
 * Error 3036 means the day's allocation is gone. If it arrives while this
 * gauge still shows headroom, the assumption above was false — something
 * else on the account spent — and that is worth saying to a reader plainly
 * rather than letting two of this site's own numbers quietly contradict
 * each other. This is a gauge, not a gate: nothing here refuses a call.
 */
/* THE UTC DAY, WHICH IS THE ONLY DAY THIS MEASUREMENT HAS. A clock is read
   here on purpose, and it is not the thing `assess()` refuses: the warnings
   must not consult one because an age measured against the wall clock makes
   the same store produce different warnings in the pipeline, the Worker and
   a test. Here the calendar day IS the quantity — Cloudflare resets the
   allowance at 00:00 UTC — so a meter that did not know today's date would
   be measuring an interval nobody is billed on. */
function aiDay() {
  return new Date().toISOString().slice(0, 10);
}

/* THE SHAPE, BUILT FROM COUNTS THAT ARE ALREADY MEASURED. Kept separate
   from the read so the post-write path can hand it the row the write just
   returned rather than reading the same day back a second time. */
function spendShape(env, day, calls, tokensIn, tokensOut) {
  const rates = neuronRates(env);
  /* ROUNDED UP, because a gauge that rounds a spend DOWN reports less spent
     than was spent, and the direction a meter errs in is a choice. Rounding
     up also makes `remaining` err downward, which is the safe side of a
     budget. */
  const neurons = rates === null ? null
    : Math.ceil((tokensIn * rates.inPerM + tokensOut * rates.outPerM) / 1e6);
  return {
    day, calls, tokensIn, tokensOut,
    allowanceNeurons: AI_DAILY_NEURONS,
    neurons,
    /* NULL WHEN THE SPEND IS NULL, never 10000. No rate configured means the
       spend is unknown, and an unknown spend subtracted from the allowance
       would render as a full tank on a day this route may have emptied it —
       Number(null) === 0 arriving at a subtraction instead of at a
       renderer. Floored at 0 rather than going negative: a spend past the
       allowance means Cloudflare stopped serving, not that a reader is owed
       credits. */
    remaining: neurons === null ? null : Math.max(0, AI_DAILY_NEURONS - neurons),
    assumesSoleSpender: true,
  };
}

async function askSpend(env) {
  if (!env.DB) return null;
  await ensureFlowsTables(env);
  const day = aiDay();
  const row = await env.DB.prepare(
    "SELECT calls, tokens_in, tokens_out FROM flows_ai_usage WHERE day = ?"
  ).bind(day).first().catch(() => null);
  /* NO ROW IS A MEASURED ZERO HERE, and that is the one place on this route
     where it is. Every other absence in this codebase is withheld rather
     than zeroed, but this table is written ONLY by a model call: a day with
     no row is a day on which this site made none, which is a reading and
     not a gap. A failed READ is different and returns null above, so the
     two never collapse. */
  const calls = row ? Number(row.calls) || 0 : 0;
  const tokensIn = row ? Number(row.tokens_in) || 0 : 0;
  const tokensOut = row ? Number(row.tokens_out) || 0 : 0;
  return spendShape(env, day, calls, tokensIn, tokensOut);
}

/**
 * Record one model call, and hand back the meter INCLUDING it.
 *
 * THE WRITE IS NOT ALLOWED TO FAIL THE ANSWER. A reader who asked a question
 * and got one has been served; losing the meter's increment costs an
 * accurate gauge and nothing else, and throwing here would trade the answer
 * for the accounting. On any failure this returns null and the caller keeps
 * the pre-call reading it already has.
 *
 * IT RETURNS THE NEW TOTALS RATHER THAN READING THEM BACK. The caller reads
 * the meter BEFORE the model call so that every failure branch carries one —
 * a reader told the allowance is spent needs the gauge most. But that
 * pre-call reading is stale by exactly one call on the path where the model
 * ANSWERED, and a budget that does not move when you spend from it is a
 * budget nobody believes. RETURNING gets the post-write row out of the same
 * statement, so the fix costs no second query.
 */
async function askRecordSpend(env, usage) {
  if (!env.DB || !usage) return null;
  const day = aiDay();
  /* THE COUNTS ARE FLOORED AT 0 BEFORE THEY ARE STORED. Number(undefined) is
     NaN and Number(null) is 0; a vendor that changes the shape of `usage`
     would otherwise write NaN into a column whose CHECK is >= 0, failing the
     whole statement and losing the call count along with the tokens. A call
     that reported no usable token counts is still a call that happened. */
  const inTok = Math.max(0, Math.round(Number(usage.prompt_tokens) || 0));
  const outTok = Math.max(0, Math.round(Number(usage.completion_tokens) || 0));
  try {
    const row = await env.DB.prepare(
      "INSERT INTO flows_ai_usage (day, calls, tokens_in, tokens_out) VALUES (?, 1, ?, ?) " +
      "ON CONFLICT(day) DO UPDATE SET calls = calls + 1, " +
      "tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out " +
      "RETURNING calls, tokens_in, tokens_out"
    ).bind(day, inTok, outTok).first();
    if (!row) return null;
    return spendShape(env, day,
      Number(row.calls) || 0, Number(row.tokens_in) || 0, Number(row.tokens_out) || 0);
  } catch { return null; /* the answer stands; only the gauge is poorer */ }
}

/**
 * What the caller asked, or a 400 saying which way they got it wrong.
 *
 * SEPARATE FROM askAnswer BECAUSE IT RUNS BEFORE THE STORE IS READ. A
 * malformed body is malformed whether or not this morning's pipeline ran,
 * and validating it second meant a broken request got the pending
 * envelope's 200 — the caller's own mistake dressed up as our silence.
 */
async function askQuestion(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "bad_json", "Send a JSON object with a `question` field.");
  }
  const raw = body && typeof body.question === "string" ? body.question.trim() : "";
  if (raw === "") {
    throw new HttpError(400, "no_question", "Ask a question in the `question` field.");
  }
  return raw.slice(0, ASK_QUESTION_MAX);
}

async function askAnswer(question, env, index, updatedAt) {
  const { picked, why, capped } = FLOWS_ASK.selectFacts(index, question);
  /* THE DETERMINISTIC ANSWER IS BUILT FIRST, ALWAYS. It is what ships
     when the model is refused, unreachable, or caught inventing — and
     building it up front means no branch below can reach a reader
     without one. A fallback assembled only inside a catch is a
     fallback nobody runs until the morning it is needed. */
  const plain = FLOWS_ASK.renderFactsPlain(picked, question);
  /* READ BEFORE THE CALL, so every branch below carries it — including the
     ones that never reach a model. A reader told the allowance is spent
     needs the gauge most, and a gauge that only appears on success is
     absent exactly when it is being asked about. */
  const spend = await askSpend(env);
  const base = {
    answer: plain, llm: false, guard: null, why, capped,
    facts: picked, silences: index.silences || null,
    briefUpdatedAt: updatedAt || null, model: null, note: null, spend,
  };

  const model = askModel(env);
  if (!env.AI || model === null) {
    return json({ ...base,
      note: "No model is configured for this site, so the reading below is the " +
        "pipeline's own wording. Every figure in it was measured." });
  }

  const { system, user } = FLOWS_ASK.promptFor(picked, question);
  let generated = null;
  /* The meter as it stands AFTER the model call, or null if no call was
     recorded. Declared out here because it is set inside the try and read
     by every branch below it. */
  let afterCall = null;
  try {
    const out = await env.AI.run(model, {
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      /* SHORT ON PURPOSE, and not only to spend fewer neurons: the
         answer is two or three sentences of prose over facts that are
         already written, so a long generation is a model with room to
         start reasoning — which is where an unquoted number comes
         from. The cap and the guard are the same argument. */
      max_tokens: 320,
      temperature: 0.2,
    });
    generated = out && typeof out.response === "string" ? out.response.trim() : null;
    /* MEASURED, NOT ESTIMATED. The response carries its own token counts,
       so the gauge counts what the model actually billed rather than what
       a length heuristic guessed it would.

       THE POST-CALL METER REPLACES THE PRE-CALL ONE FROM HERE DOWN, and
       falls back to it rather than to nothing: a failed write leaves the
       reader a meter that is one call stale, which is worth more than no
       meter at all and is why this is `||` and not an assignment. */
    afterCall = await askRecordSpend(env, out && out.usage);
  } catch (error) {
    const failed = askFailure(error);
    /* WHEN CLOUDFLARE AND THE GAUGE DISAGREE, THE DISAGREEMENT IS THE
       READING. Error 3036 is the account's allocation being gone. If it
       arrives while `remaining` still shows headroom, then the one
       assumption the gauge rests on — that nothing else on this account
       spent today — was false, and the two numbers on this page contradict
       each other. Saying which one is authoritative costs a sentence and
       stops a reader trusting the wrong one; letting it pass silently would
       leave the gauge reading "8,900 left" beside "the allowance is spent",
       and a reader would have to guess. `> 0` rather than truthiness: a
       measured 0 remaining is the gauge AGREEING, which is not this case. */
    const disagrees = failed.why === "allowance"
      && spend !== null && typeof spend.remaining === "number" && spend.remaining > 0;
    const say = disagrees
      ? failed.say + " The meter on this page still showed " + spend.remaining +
        " of " + spend.allowanceNeurons + " neurons unspent, which means something " +
        "other than this site drew on the same account today. Cloudflare is the " +
        "authority and the meter is not: it can only ever see this site's own calls."
      : failed.say;
    return json({ ...base, note: say, model, llmFailure: failed.why,
      spendDisagrees: disagrees });
  }

  if (!generated) {
    return json({ ...base, spend: afterCall || base.spend, model,
      note: "The model answered with no text, so the reading below is the pipeline's " +
        "own wording. Every figure in it was measured." });
  }

  const guard = FLOWS_ASK.guardAnswer(generated, picked);
  if (!guard.ok) {
    /* THE REJECTED WORDING IS NOT RETURNED. A page that showed it
       beside the real answer would be publishing the invented figure
       with a caption, and a caption is not what a reader remembers. */
    return json({ ...base, spend: afterCall || base.spend, model, guard,
      /* THE READER'S SENTENCE IS NOT guard.reason. That string ends by
         naming the `rejected` field, which is the right thing to tell a
         developer reading the JSON and the wrong thing to print on a
         page — an implementation detail in the one sentence whose job
         is to keep a reader's trust. The cause is still distinguished,
         because "it invented a figure" and "it claimed the future" are
         different failures and flattening them would waste the only
         interesting thing the guard learned. */
      note: "The generated wording was discarded: " +
        (guard.forecast
          ? "it claimed what the market is going to do, and this page states what was " +
            "measured and what is already on the calendar."
          : "it stated a figure that appears in none of the measurements it was given, " +
            "which means it was computed rather than quoted.") +
        " What follows is the pipeline's own wording, and every figure in it was measured." });
  }
  return json({ ...base, spend: afterCall || base.spend,
    answer: generated, llm: true, model, guard });
}

/* =============================================================
   THE ON-DEMAND CHAIN

   Everything else under /api/flows streams a blob the pipeline
   already computed. This route does not: the whole point is that a
   user types a ticker nobody chose in advance, so there is nothing
   precomputed to stream. The Worker has to call the vendor and do
   arithmetic on the request path, which is the thing this
   architecture was built to avoid.

   It is affordable, and that was MEASURED rather than assumed. Auth
   HMAC + parse 250KB + price 500 contracts + emit the top 120 costs
   2.29ms of a roughly 10ms budget; a second chain page takes it to
   about 4.4ms. Three or four external subrequests of a limit of 50 —
   and the 50 is per INVOCATION, while one invocation prices one
   ticker, so a twenty-symbol desk is twenty invocations rather than
   one at 60 subrequests. The expensive half — screening a universe, ranking a
   cross-section, fitting anything — stays in Actions where it
   belongs.

   THE CACHE IS NOT AN OPTIMISATION, it is the quota. The vendor key
   now lives on a request path, so an authenticated user holding down
   refresh is spending a shared API budget. caches.default is the
   right store for it: edge-local, free, no D1 write, and NOT counted
   as a subrequest — which matters because D1's write budget is shared
   with the learning app and a chain lookup must never be able to
   starve it.

   Auth is checked before the cache is touched, and what is cached is
   market data identical for every viewer — the gate is on access, not
   on content. The key is built from normalised parameters at the route
   below, never from the raw request.
   ============================================================= */

/* Overridable for the same reason FLOWS_INGEST_URL is: the contract tests
   stand a stub upstream on localhost and drive the real route against it,
   which is the only way to test the cache, the refresh floor and the spot
   selection rather than just the gate in front of them. An operator who can
   set this can already read the key it is sent with, so this widens nothing. */
const UW_BASE_DEFAULT = "https://api.unusualwhales.com";

/* Long enough that a refresh-happy user costs one call, short enough that
   "refresh" means something during a session. Quotes move faster than this;
   the response carries its own age so the reader can say so out loud rather
   than implying it is live. */
const CHAIN_TTL_SECONDS = 120;

/* The vendor documents `limit` on /option-contracts as maximum=500. Named
   rather than inlined because the truncation test below compares against it,
   and a page size that disagrees with the ceiling reports truncation wrong. */
const CHAIN_PAGE_SIZE = 500;

/* An earnings date is a daily-cadence fact, not a quote. It gets its own cache
   entry keyed on TICKER ALONE at a long TTL — the chain's key carries strategy
   and rank (3 x 4 = up to 12 variants), so a per-ticker fact fetched inside the
   chain would be re-fetched a dozen times per ticker per window for toggles
   that cannot change it. */
const INFO_TTL_SECONDS = 6 * 3600;

/* How stale a copy has to be before an explicit refresh is allowed to spend a
   vendor call. Short enough that pressing refresh feels like it did something,
   long enough that holding it down cannot drain a shared API budget. */
const CHAIN_REFRESH_FLOOR_SECONDS = 15;

async function uwFetch(env, path, params) {
  if (!env.UW_API_KEY) throw new HttpError(503, "chain_unconfigured", "Live chain lookup is not configured");
  const url = new URL((env.UW_BASE || UW_BASE_DEFAULT) + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: "Bearer " + env.UW_API_KEY, Accept: "application/json" },
    });
  } catch {
    throw new HttpError(502, "chain_upstream", "Market data provider unreachable");
  }
  if (response.status === 429) throw new HttpError(429, "chain_rate_limited", "Market data provider is rate limiting");
  if (!response.ok) throw new HttpError(502, "chain_upstream", "Market data provider returned an error");
  /* PARSE FAILURES ARE UPSTREAM FAILURES, not 500s. A vendor sending HTML
     where JSON was promised is their outage being reported as ours. */
  try {
    return await response.json();
  } catch {
    throw new HttpError(502, "chain_upstream", "Market data provider returned malformed data");
  }
}

/**
 * Fetch and price one ticker's sellable chain.
 *
 * THREE CONCURRENT SUBREQUESTS, and a fourth sequentially when the first
 * chain page fills: the chain, a daily candle, and the live stock state.
 *
 * THE BINDING LIMIT IS NOT THE ONE EVERYONE QUOTES. Workers Free allows 50
 * external subrequests per invocation, and at three or four this route is
 * nowhere near it — but it also allows only SIX SIMULTANEOUS OPEN
 * CONNECTIONS per invocation, which is eight times tighter and is what a
 * Promise.all actually spends. This one opens three of six. Anything added
 * here goes in that same array, so the count to watch is the width of the
 * Promise.all, not the total call count.
 *
 * One invocation prices ONE ticker — flows-desk.js fans out one request per
 * symbol — so neither ceiling is per desk. A twenty-symbol desk is twenty
 * invocations, and what it actually spends is the shared vendor quota.
 *
 * Spot is NOT optional and is not defaulted — a covered call's collateral is
 * the shares at spot, and moneyness is measured against it, so a missing spot
 * makes every number on the page wrong in a way that still renders. It fails
 * loudly instead.
 */
/**
 * A per-ticker reference fact, cached on its own key.
 *
 * Returns null on ANY failure. That is load-bearing rather than lazy: uwFetch
 * throws on 429 and on every non-ok status, and this endpoint 404s for symbols
 * it does not cover — so an uncaught leg would turn a missing earnings date
 * into "data provider unavailable" for the whole symbol, withholding a priced
 * table over a marker.
 */
async function cachedTickerInfo(env, ctx, ticker) {
  const key = new Request(`https://flows-info.internal/${ticker}`, { method: "GET" });
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit.json().catch(() => null);
  }
  const raw = await uwFetch(env, `/api/stock/${encodeURIComponent(ticker)}/info`, {})
    .catch(() => null);
  if (raw === null) return null;
  /* THE ENVELOPE IS AMBIGUOUS IN THE VENDOR'S OWN SPEC: the schema declares
     these fields at top level while its example nests them under `data`. Both
     are unwrapped rather than one being guessed at. */
  const d = raw && !Array.isArray(raw) && raw.data ? raw.data : raw;
  if (!d || typeof d !== "object") return null;
  const out = {
    nextEarningsDate: typeof d.next_earnings_date === "string" ? d.next_earnings_date : null,
    announceTime: typeof d.announce_time === "string" ? d.announce_time : null,
    /* Why a null date is null. "Empty if unknown or not applicable such as
       ETF/Index" — so an ETF having no earnings and a name whose date is merely
       unknown are different facts, and the page can say which. */
    issueType: typeof d.issue_type === "string" ? d.issue_type : null,
    /* BETA WAS ON THE WIRE AND WAS BEING THROWN AWAY. This endpoint has carried
       it since the desk started calling it, and the shape above read three
       fields out of the response and dropped the rest — so every call already
       paid for a number nothing published. The strategy tester needs it for a
       beta-weighted delta, which is the one reading this section previously
       had to refuse for want of an observable rather than for want of a
       parameter.

       READ THROUGH numOrNull BECAUSE THE VENDOR SENDS NUMBERS AS STRINGS, and
       because a name with no beta (a fresh listing, an index) must come back
       null rather than 0 — a beta of zero is a real and very different claim
       about a stock than "the vendor does not have one".

       A CACHED ENTRY WRITTEN BEFORE THIS LINE EXISTED HAS NO `beta` KEY. Those
       entries live for INFO_TTL_SECONDS (six hours) after a deploy, so for a
       fraction of a day this function can return an object whose `beta` is
       undefined rather than null. Every reader below therefore tests for a
       finite number rather than for `=== null`, which is the same discipline
       the rest of this file applies to an absent field. */
    beta: numOrNull(d.beta),
  };
  if (cache) {
    const store = new Response(JSON.stringify(out), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `max-age=${INFO_TTL_SECONDS}`,
      },
    });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cache.put(key, store));
    else await cache.put(key, store).catch(() => {});
  }
  return out;
}

/**
 * Serve a live vendor read through the edge cache, with the refresh floor.
 *
 * TWO ROUTES NOW SPEND A METERED VENDOR KEY ON THE REQUEST PATH — the premium
 * desk's chain and the strategy tester's two reads — and every line of this
 * dance is a quota control rather than a nicety. It lives in one function
 * because the second copy of it would be the place the floor was quietly
 * dropped, or the cache key quietly built from a raw parameter.
 *
 * THE REFRESH FLOOR. The vendor key lives on a request path, so refresh has to
 * actually refresh without also being an unmetered proxy to it. A first draft
 * of the chain route let refresh=1 skip the cache read outright, which is
 * exactly that: hold the button down and every press is a vendor call.
 *
 * So refresh skips the cache only once the copy is older than the floor. Below
 * it the cached body is served and SAYS it was throttled, which bounds vendor
 * traffic to one call per key per floor globally, no matter how many users
 * press how hard. Stateless — no D1 write, whose budget is shared with the
 * learning app and must not be spendable from an unauthenticated-adjacent path.
 *
 * `cacheKey` is the caller's, and every caller builds it from NORMALISED
 * parameters rather than from the raw request: a gated response keyed by an
 * attacker-shaped URL is how a cache turns into a bypass, and an unvalidated
 * parameter in a cache key hands an authenticated reader unbounded distinct
 * keys to fill the edge cache with — every miss of which is a vendor call.
 */
async function serveCachedVendorRead({ ctx, cacheKey, wantsRefresh, build }) {
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;

  const hit = cache ? await cache.match(cacheKey) : null;
  const storedAt = hit ? Number(hit.headers.get("X-Chain-Stored")) : NaN;
  const ageSeconds = Number.isFinite(storedAt) ? (Date.now() / 1000) - storedAt : Infinity;

  const serveCached = hit && (wantsRefresh ? ageSeconds < CHAIN_REFRESH_FLOOR_SECONDS : true);
  if (serveCached) {
    const out = new Response(hit.body, hit);
    out.headers.set("X-Chain-Cache", wantsRefresh ? "throttled" : "hit");
    out.headers.set("X-Chain-Age", String(Math.max(0, Math.round(ageSeconds))));
    /* The wrapper below forces no-store on every /api/ response, so this is
       belt and braces rather than the enforcement. Set anyway: the stored
       copy carries a real max-age and this is the line that says the copy
       leaving here does not. */
    out.headers.set("Cache-Control", "no-store");
    return out;
  }

  const payload = await build();
  const body = JSON.stringify(payload);

  if (cache) {
    const store = new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `max-age=${CHAIN_TTL_SECONDS}`,
        "X-Chain-Stored": String(Math.floor(Date.now() / 1000)),
      },
    });
    /* waitUntil so the caller is not waiting on the write. The synthetic
       key never passes through the response wrapper, so the stored copy
       keeps its max-age while every served copy gets no-store. */
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cache.put(cacheKey, store));
    else await cache.put(cacheKey, store);
  }

  return json(payload, 200, { "Cache-Control": "no-store", "X-Chain-Cache": "miss", "X-Chain-Age": "0" });
}

async function buildChainPayload(env, ctx, { ticker, strategy, rankBy, limit }) {
  const t = encodeURIComponent(ticker);
  const chainPage = (page) => uwFetch(env, `/api/stock/${t}/option-contracts`, {
    /* The sellable universe rather than the whole book: out-of-the-money
       contracts that somebody already holds. Both filters are the vendor's,
       applied upstream, so they cost nothing here. */
    maybe_otm_only: "true",
    exclude_zero_oi_chains: "true",
    limit: CHAIN_PAGE_SIZE,
    ...(page > 1 ? { page } : {}),
  });

  const [firstPage, candles, state, info] = await Promise.all([
    chainPage(1),
    uwFetch(env, `/api/stock/${t}/ohlc/1d`, { timeframe: "5D" }),
    /* THE DAILY CANDLE IS NOT A LIVE PRICE, and this desk is priced against
       spot twice over: a covered call's collateral IS the shares at spot, and
       every moneyness on the page is measured from it. During a session the
       latest 1d bar is yesterday's close, so a name that has moved 4% since
       the open was having its whole table priced against a number nobody could
       trade at. /stock-state is one parameter and nine fields and answers it
       directly. It is allowed to fail: the candle is still there, and a desk
       priced off the close and SAYING so beats no desk at all. */
    uwFetch(env, `/api/stock/${t}/stock-state`, {}).catch(() => null),
    /* The fourth leg of the Promise.all, which is FOUR OF SIX simultaneous
       connections — the ceiling that actually binds here, eight times tighter
       than the 50-subrequest cap. Two slots spare. */
    cachedTickerInfo(env, ctx, ticker),
  ]);

  const unwrap = (r) => (Array.isArray(r) ? r : (r && r.data) || []);
  const rows = unwrap(firstPage);
  const bars = unwrap(candles);
  if (!rows.length) throw new HttpError(404, "chain_empty", "No listed options found for that symbol");

  /* THE PAGE SIZE IS A CEILING, NOT A CHAIN.
  
     `limit` on this endpoint is documented maximum=500, and the ticker-scoped
     route has NO `order` parameter — only the sibling screener does. So a
     single call on any name with more than 500 out-of-the-money contracts
     carrying open interest returns an arbitrary vendor-ordered slice, and
     those names are AAPL, SPY, NVDA: exactly the ones a premium desk is for.
  
     Two failures followed, and both rendered perfectly. The footer said "N of
     500 quoted contracts are sellable" as though 500 were the chain. And in a
     MERGED table a truncated slice of a huge chain was ranked head to head
     against a complete small-cap chain, so cross-symbol ordering depended on
     which 500 the vendor happened to send.
  
     A second page doubles the reach for one subrequest and roughly 2ms — the
     route measures 2.29ms at 500 contracts and about 4.4ms at 1000, against a
     10ms budget. Three pages would be 6.5ms and four 8.5ms, which is too close
     to spend on a tail. So: two pages, and when even that fills, the payload
     says `truncated` and the page says so rather than implying it saw
     everything. Disclosure is what makes a bounded fetch honest; the bound
     itself is just arithmetic. */
  let truncated = false;
  if (rows.length >= CHAIN_PAGE_SIZE) {
    const second = unwrap(await chainPage(2).catch(() => []));
    for (const r of second) rows.push(r);
    /* A full second page means there is a third we did not ask for. A short
       one means the chain ended inside it, which is the only case where the
       screened count IS the chain. */
    truncated = second.length >= CHAIN_PAGE_SIZE;
  }

  /* The most recent close the vendor will admit to. Bars arrive newest-first
     on some endpoints and oldest-first on others, so the date is compared
     rather than an index trusted. */
  let dailyClose = null, dailyDate = null;
  for (const b of bars) {
    const close = Number(b && (b.close ?? b.c));
    const date = b && (b.date || b.start_time || b.timestamp);
    if (!Number.isFinite(close) || close <= 0 || !date) continue;
    const day = String(date).slice(0, 10);
    if (dailyDate === null || day > dailyDate) { dailyDate = day; dailyClose = close; }
  }

  const live = state && !Array.isArray(state) ? state : (state && state.data) || null;
  const liveClose = live ? Number(live.close) : NaN;
  const useLive = Number.isFinite(liveClose) && liveClose > 0;

  /* WHICH PRICE, AND HOW OLD, both ship. A desk that renders a live quote and
     a stale close identically is the same omission as one that renders a
     two-minute-old cached row as live. */
  const spot = useLive ? liveClose : dailyClose;
  const spotSource = useLive ? "stock-state" : "daily-close";
  if (!(spot > 0)) throw new HttpError(502, "chain_no_spot", "No usable price for that symbol");

  /* asOf DATES THE DAYS-TO-EXPIRY COUNT, so it must be the trading session,
     not the wall clock. tape_time is the last print and carries a UTC offset;
     across the whole US session (13:30-20:00 UTC) its UTC date equals the
     Eastern trading date, and after the close it stays frozen at the close
     rather than rolling with the clock — so its date is the session's without
     needing a timezone rule, which would be a free parameter. Falls back to
     the candle's own date. */
  const tapeTime = live && live.tape_time ? String(live.tape_time) : null;
  const tapeDay = tapeTime && /^\d{4}-\d{2}-\d{2}/.test(tapeTime) ? tapeTime.slice(0, 10) : null;
  const asOf = tapeDay || dailyDate;
  if (!asOf) throw new HttpError(502, "chain_no_spot", "No usable session date for that symbol");

  const ranked = rankChain(rows, { spot, asOf, strategy, rankBy, limit, ticker });

  /* MARKED AFTER THE GATES, so this is ~120 string comparisons rather than
     1000. A cushion is a diffusion number and an earnings report is not a
     diffusion, so a contract that outlives one is a different trade at the
     same premium and the same cushion. */
  const earnDate = info ? info.nextEarningsDate : null;
  for (const row of ranked.rows) {
    row.crossesEarnings = info ? crossesEarnings(row.expiry, earnDate, info.announceTime) : null;
  }
  return {
    ticker, spot, asOf,
    spotSource,
    /* "regular", "pre", "post" or whatever else the vendor names a session.
       Passed through verbatim rather than mapped: an enum this code does not
       control is not one it should be inventing members of. */
    marketTime: live && live.market_time ? String(live.market_time) : null,
    tapeTime,
    prevClose: live && Number(live.prev_close) > 0 ? Number(live.prev_close) : dailyClose,
    strategy, ...ranked,
    /* Whether `screened` is the chain or a ceiling. A reader ranking across
       symbols needs to know that one of them was cut off. */
    truncated,
    pageSize: CHAIN_PAGE_SIZE,
    /* null when the lookup failed OR the vendor has no date for this symbol —
       and issueType separates those, because an ETF with no earnings and an
       equity whose date is merely unknown are different facts. */
    earnings: info
      ? { date: earnDate, announceTime: info.announceTime, issueType: info.issueType }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

/* =============================================================
   THE STRATEGY TESTER'S TWO READS

   /flows/strategy/ builds a position out of REAL listed contracts and
   draws what it pays at expiry. That needs a different universe from
   the premium desk, on the same endpoint, and the difference is the
   whole reason this is a second builder rather than a parameter on
   buildChainPayload():

     the desk sends `maybe_otm_only` and `exclude_zero_oi_chains` and
     then gates on spread, open interest and premium, because it is
     screening for contracts somebody could SELL. A long in-the-money
     call is unexpressible in that universe — it is filtered out
     upstream, before any gate here could let it back in.

   So this sends `expiry` and `option_type` instead, which are the
   vendor's own documented query parameters on the same path, and it
   filters nothing. A calculator that silently drops the strike the
   reader wanted is worse than one that fails: the row is simply not
   there, and nothing on the page says a row is missing.

   TWO MODES, TWO CACHE KEYS, AND THE SPLIT IS DELIBERATE.

     the CONTEXT read (`?t=`)  — one expiry-breakdown, one candle, one
       live state, one cached /info. It answers "what expiries exist,
       how big is each one, what is this trading at, what is its beta".
     the EXPIRY read (`?t=&expiry=`) — the contracts of ONE expiry,
       calls and puts as separate calls so a 12,000-contract expiry is
       two 1,000-row reaches rather than one truncated 500.

   The expiry read deliberately fetches NO PRICE. Spot arrives once, on
   the context read, and the page prices everything against it and says
   how old it is — rather than each expiry pick spending two more calls
   on a shared vendor quota to re-learn a number the page already holds
   and can timestamp. "Which price, and how old" is answered in one
   place instead of once per pick.

   THE 500-ROW CEILING IS THE HAZARD THIS ROUTE IS BUILT AROUND. The
   vendor documents `limit` as maximum=500 and its own spec example
   shows single expiries carrying 5,000 and 12,223 contracts. The desk
   survives that by paging twice and publishing `truncated`; here the
   count is also known IN ADVANCE, because expiry-breakdown reports
   `chains` per expiry — so the picker can warn before the read rather
   than the payload confessing after it.
   ============================================================= */

/* The reference index for a beta-weighted delta, NAMED because the
   number means nothing without it: a delta weighted to SPY and one
   weighted to QQQ are different readings of the same position, and a
   page that prints one without saying which has published a number
   whose definition it withheld. It travels in the payload so the
   renderer cannot forget to say it. */
const STRATEGY_INDEX = "SPY";

/* An expiry is a date and nothing else. Validated before it reaches a cache
   key for the same reason the ticker is: an unvalidated parameter in a cache
   key hands an authenticated reader unbounded distinct keys to fill the edge
   cache with, and every miss is a vendor call. */
const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* Pages per option type. Two, for the reason the desk gives at CHAIN_PAGE_SIZE:
   a second page doubles the reach for one subrequest and about two
   milliseconds, and a third starts eating a 10ms budget for a tail. Split by
   `option_type` this is 1,000 calls and 1,000 puts rather than 1,000 of both
   mixed, which is the split that makes two pages enough for almost every
   listed name rather than merely most of them. */
const STRATEGY_PAGES_PER_TYPE = 2;

/**
 * The index spot, on its own cache entry.
 *
 * SEPARATE FROM /info's SIX-HOUR ENTRY ON PURPOSE. Beta is a slow statistic
 * and six hours of it costs nothing; the index PRICE is a quote, and a
 * beta-weighted delta computed against a six-hour-old SPY is wrong by
 * whatever SPY did since. It gets the chain's own 120-second life instead.
 *
 * Keyed on the index alone, not on the ticker, so every reader of every symbol
 * shares one call per two minutes globally rather than one per name.
 *
 * Returns null on ANY failure, and the caller must render that as an ABSENCE
 * rather than as a beta-weighted delta of zero. A position with 400 share-
 * equivalents of delta and no index price has an unknown beta-weighted delta,
 * which is not the same claim as a flat one.
 */
async function cachedIndexSpot(env, ctx) {
  const key = new Request(`https://flows-index.internal/${STRATEGY_INDEX}`, { method: "GET" });
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit.json().catch(() => null);
  }
  const raw = await uwFetch(env, `/api/stock/${STRATEGY_INDEX}/stock-state`, {}).catch(() => null);
  if (raw === null) return null;
  const d = raw && !Array.isArray(raw) && raw.data ? raw.data : raw;
  const close = numOrNull(d && d.close);
  if (close === null || close <= 0) return null;
  const out = {
    symbol: STRATEGY_INDEX,
    spot: close,
    tapeTime: d && d.tape_time ? String(d.tape_time) : null,
  };
  if (cache) {
    const store = new Response(JSON.stringify(out), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `max-age=${CHAIN_TTL_SECONDS}`,
      },
    });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cache.put(key, store));
    else await cache.put(key, store).catch(() => {});
  }
  return out;
}

/** The vendor's envelope is `data` on some endpoints and bare on others. */
const unwrapRows = (r) => (Array.isArray(r) ? r : (r && r.data) || []);

/**
 * THE CONTEXT READ: what this name is trading at, and what it lists.
 *
 * FOUR SIMULTANEOUS CONNECTIONS OF SIX, which is the ceiling that actually
 * binds a Workers Free invocation — eight times tighter than the 50-subrequest
 * cap, and the number to watch when anything is added here is the WIDTH of the
 * Promise.all rather than the total call count. The index spot is awaited
 * afterwards rather than inside it: it is a cache hit almost always, and on the
 * rare miss a fifth open connection is a cost paid once per two minutes for
 * every reader of every symbol rather than once per request.
 */
async function buildStrategyContext(env, ctx, ticker) {
  const t = encodeURIComponent(ticker);
  const [breakdown, candles, state, info] = await Promise.all([
    uwFetch(env, `/api/stock/${t}/expiry-breakdown`, {}).catch(() => null),
    uwFetch(env, `/api/stock/${t}/ohlc/1d`, { timeframe: "5D" }),
    uwFetch(env, `/api/stock/${t}/stock-state`, {}).catch(() => null),
    cachedTickerInfo(env, ctx, ticker),
  ]);

  const bars = unwrapRows(candles);
  let dailyClose = null, dailyDate = null;
  for (const b of bars) {
    const close = numOrNull(b && (b.close ?? b.c));
    const date = b && (b.date || b.start_time || b.timestamp);
    if (close === null || close <= 0 || !date) continue;
    const day = String(date).slice(0, 10);
    if (dailyDate === null || day > dailyDate) { dailyDate = day; dailyClose = close; }
  }

  const live = state && !Array.isArray(state) ? state : (state && state.data) || null;
  const liveClose = numOrNull(live && live.close);
  const useLive = liveClose !== null && liveClose > 0;
  const spot = useLive ? liveClose : dailyClose;
  /* SPOT IS NOT OPTIONAL AND IS NOT DEFAULTED. Every moneyness on the page,
     the diagram's whole x-axis and the beta-weighted delta are measured from
     it, so a missing spot makes every number wrong in a way that still
     renders. It fails loudly, exactly as the desk's does. */
  if (!(spot > 0)) throw new HttpError(502, "chain_no_spot", "No usable price for that symbol");

  const tapeTime = live && live.tape_time ? String(live.tape_time) : null;
  const tapeDay = tapeTime && /^\d{4}-\d{2}-\d{2}/.test(tapeTime) ? tapeTime.slice(0, 10) : null;
  /* asOf DATES THE DAYS-TO-EXPIRY COUNT, so it is the trading session and not
     the wall clock — the same reasoning, and the same fields, as the desk's. */
  const asOf = tapeDay || dailyDate;
  if (!asOf) throw new HttpError(502, "chain_no_spot", "No usable session date for that symbol");

  /* THE EXPIRY LIST, AND ITS SIZE BEFORE IT IS READ. `chains` is the count of
     listed contracts at that expiry, both types together, and it is the number
     that decides whether a 500-row page can hold the expiry at all. Publishing
     it lets the picker warn BEFORE the read rather than the payload confessing
     after it — which on a calculator is the difference between "your strike is
     not listed" and "your strike was cut off and nothing said so". */
  const expiries = [];
  for (const row of unwrapRows(breakdown)) {
    const expiry = row && typeof row.expiry === "string" ? row.expiry.slice(0, 10) : null;
    if (!expiry || !EXPIRY_RE.test(expiry)) continue;
    expiries.push({
      expiry,
      chains: numOrNull(row.chains),
      oi: numOrNull(row.open_interest),
      volume: numOrNull(row.volume),
    });
  }
  expiries.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));

  const index = await cachedIndexSpot(env, ctx);

  return {
    mode: "context",
    ticker, spot, asOf,
    spotSource: useLive ? "stock-state" : "daily-close",
    marketTime: live && live.market_time ? String(live.market_time) : null,
    tapeTime,
    prevClose: numOrNull(live && live.prev_close) ?? dailyClose,
    /* THREE SILENCES, THREE VALUES. `expiries: []` with status "unreadable"
       is the request that did not come back; with status "quiet" it is an
       endpoint that answered and listed nothing, which for a symbol with no
       listed options is a READING. Sharing one empty array between them is
       exactly the sentence this codebase refuses to let two silences share. */
    expiries,
    expiryStatus: breakdown === null ? "unreadable" : (expiries.length ? "ok" : "quiet"),
    /* Beta is `undefined` on an /info entry cached before beta was read, and
       null when the vendor has none. Both are absences and both must render as
       one; neither is a beta of zero. */
    beta: info && Number.isFinite(info.beta) ? info.beta : null,
    /* The index the beta-weighted delta is weighted TO, and its price, so the
       renderer states the choice rather than implying a universal one. Null
       when the index quote did not come back — an unknown weighting, never a
       flat one. */
    index,
    earnings: info
      ? { date: info.nextEarningsDate, announceTime: info.announceTime, issueType: info.issueType }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * THE EXPIRY READ: every listed contract at one expiry, unfiltered.
 *
 * SHORT KEYS, AND THE LEGEND IS HERE. A 2,000-row payload with thirteen
 * spelled-out key names on every row carries roughly ninety kilobytes of
 * repeated strings; the same rows keyed `k`/`bid`/`dl` carry a fraction of
 * that. The names are mnemonic rather than positional so a row is still
 * readable in a devtools pane:
 *
 *   sym  option_symbol      k    strike        bid/ask  nbbo quote
 *   iv   implied_volatility dl   delta         gm       gamma
 *   th   theta              vg   vega          rh       rho
 *   vol  volume             oi   open_interest
 *
 * EVERY GREEK IS `nullable: true, type: string` IN THE VENDOR'S OWN SPEC, and
 * its own example carries a row with none of the five. So absence is a
 * per-ROW fact, not a per-chain one, and each field is read through numOrNull
 * independently — a contract with a delta and no vega keeps its delta.
 */
async function buildStrategyExpiry(env, ticker, expiry) {
  const t = encodeURIComponent(ticker);
  const page = (optionType, n) => uwFetch(env, `/api/stock/${t}/option-contracts`, {
    /* NOT maybe_otm_only, and NOT exclude_zero_oi_chains. Both are the desk's
       filters and both are wrong here: a long in-the-money call is a position
       a reader builds all the time, and a listed contract with no open
       interest is still quoted and still purchasable. This read is the whole
       book at one expiry, because the whole book is what a calculator is
       allowed to be asked about. */
    expiry,
    option_type: optionType,
    limit: CHAIN_PAGE_SIZE,
    ...(n > 1 ? { page: n } : {}),
  });

  /* TWO OF SIX SIMULTANEOUS CONNECTIONS. The second page of each type, when it
     is needed, is fetched after — a full first page is the only evidence that
     a second exists, so asking for both up front would spend a call on every
     small expiry to save a round trip on a large one. */
  const [callsFirst, putsFirst] = await Promise.all([page("call", 1), page("put", 1)]);

  const gather = async (optionType, first) => {
    const rows = unwrapRows(first);
    let truncated = false;
    if (rows.length >= CHAIN_PAGE_SIZE) {
      for (let n = 2; n <= STRATEGY_PAGES_PER_TYPE; n++) {
        const next = unwrapRows(await page(optionType, n).catch(() => []));
        for (const r of next) rows.push(r);
        /* A FULL LAST PAGE MEANS THERE IS ANOTHER WE DID NOT ASK FOR. A short
           one means the type ended inside it, which is the only case where the
           rows in hand ARE the listed book at this expiry. */
        truncated = next.length >= CHAIN_PAGE_SIZE;
        if (!truncated) break;
      }
    }
    return { rows, truncated };
  };

  const calls = await gather("call", callsFirst);
  const puts = await gather("put", putsFirst);

  /* THE IV CONVENTION IS DECIDED ONCE, FROM THE WHOLE EXPIRY. flows-premium.js
     already owns this decision and its reasoning — a single contract at 0.42
     is genuinely ambiguous, a population whose median is 0.42 is not — so it
     is called rather than re-derived, and its `basis` string ships so the
     answer is auditable instead of being a constant somebody has to trust. */
  const ivRaw = [];
  for (const r of calls.rows) ivRaw.push(r && r.implied_volatility);
  for (const r of puts.rows) ivRaw.push(r && r.implied_volatility);
  const iv = ivConvention(ivRaw);

  let missingGreeks = 0;
  let offExpiry = 0;
  const shape = (raw, wantType) => {
    const out = [];
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const sym = typeof r.option_symbol === "string" ? r.option_symbol : null;
      const parsed = sym ? parseOptionSymbol(sym) : null;
      /* A SYMBOL THIS DOES NOT RECOGNISE IS DROPPED rather than guessed at, for
         the reason flows-premium.js gives: a misparsed strike prices a trade
         that does not exist, and on this page it would draw one too. */
      if (!parsed) continue;
      /* AND THE ROW MUST BE THE ROW THAT WAS ASKED FOR. `expiry` and
         `option_type` are the vendor's filters, applied upstream, and this
         payload's whole claim is that it is the book at ONE expiry — a row
         from a different one filed under this heading would be picked up as a
         leg whose own symbol says it expires elsewhere, and the position would
         then be priced from a book it is not in. Counted rather than merely
         dropped, because a non-zero count means a documented query parameter
         stopped being honoured and the page should say so out loud. */
      if (parsed.expiry !== expiry || (parsed.type === "C" ? "call" : "put") !== wantType) {
        offExpiry++;
        continue;
      }
      const rawIv = numOrNull(r.implied_volatility);
      const dl = numOrNull(r.delta), gm = numOrNull(r.gamma);
      const th = numOrNull(r.theta), vg = numOrNull(r.vega), rh = numOrNull(r.rho);
      if (dl === null || gm === null || th === null || vg === null) missingGreeks++;
      out.push({
        sym, k: parsed.strike,
        bid: numOrNull(r.nbbo_bid), ask: numOrNull(r.nbbo_ask),
        iv: rawIv === null ? null : rawIv / iv.divisor,
        dl, gm, th, vg, rh,
        vol: numOrNull(r.volume), oi: numOrNull(r.open_interest),
      });
    }
    out.sort((a, b) => a.k - b.k);
    return out;
  };

  const callRows = shape(calls.rows, "call");
  const putRows = shape(puts.rows, "put");

  return {
    mode: "expiry",
    ticker, expiry,
    calls: callRows, puts: putRows,
    /* PER TYPE, because they were fetched per type and a truncated call side
       says nothing about the put side. The page names which half was cut. */
    callsTruncated: calls.truncated,
    putsTruncated: puts.truncated,
    pageSize: CHAIN_PAGE_SIZE,
    pagesPerType: STRATEGY_PAGES_PER_TYPE,
    ivBasis: iv.basis,
    /* How many of the rows in hand are missing at least one of the four greeks
       the projection needs. Published so the page can say "eleven of these 340
       contracts carry no greeks" instead of the reader discovering it one leg
       at a time. */
    missingGreeks,
    /* Rows the provider returned that are not at this expiry or not of the type
       that was asked for. Zero on every honoured request; anything else is the
       filter having stopped working, which the page reports rather than
       absorbing. */
    offExpiry,
    generatedAt: new Date().toISOString(),
  };
}

let flowsSchemaReady = false;
async function ensureFlowsTables(env) {
  if (flowsSchemaReady || !env.DB) return;
  try {
    await env.DB.batch(FLOWS_SCHEMA_SQL.map((sql) => env.DB.prepare(sql)));
    flowsSchemaReady = true;
  } catch { /* a read will simply return nothing; never fail a request on this */ }
}

/**
 * The throttle key.
 *
 * Keying on the username alone was wrong twice over. The roster is hardcoded
 * in a PUBLIC repository, so anyone can read all eleven names: eight wrong
 * passwords would lock a real user out of the section for fifteen minutes,
 * repeatable indefinitely. And the raw submitted string was used as a primary
 * key, so an attacker could mint unbounded rows in a database whose free-tier
 * write budget is shared with the live learning app.
 *
 * Both are fixed by scoping the key to the CALLER as well as the account, and
 * by refusing to store anything for a username that is not on the roster — an
 * off-roster attempt can never succeed, so there is nothing worth counting.
 */
function flowsThrottleKey(request, username) {
  if (!FLOWS_USERNAMES.includes(username)) return null;
  // CF-Connecting-IP is set by the edge and cannot be spoofed by the client.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return username + "|" + ip;
}

async function flowsLockRecord(env, username) {
  if (!username || !env.DB) return null;
  await ensureFlowsTables(env);
  try {
    return await env.DB.prepare(
      "SELECT failures, first_at FROM flows_login_failures WHERE username = ?"
    ).bind(username).first();
  } catch { return null; }
}

async function recordFlowsFailure(env, username, previous) {
  // username here is a throttle key from flowsThrottleKey(); a null one means
  // the attempt was off-roster and must not create a row.
  if (!username || !env.DB) return;
  await ensureFlowsTables(env);
  const next = nextFailureState(previous);
  try {
    await env.DB.prepare(
      "INSERT INTO flows_login_failures (username, failures, first_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(username) DO UPDATE SET failures = excluded.failures, first_at = excluded.first_at"
    ).bind(username, next.failures, next.first_at).run();
  } catch { /* throttling is best-effort; never block a login on it */ }
}

async function clearFlowsFailures(env, username) {
  if (!username || !env.DB) return;
  try {
    await env.DB.prepare("DELETE FROM flows_login_failures WHERE username = ?").bind(username).run();
  } catch { /* best-effort */ }
}

async function currentUser(request, env) {
  const token = getCookie(request, "session");
  if (!token || !env.SESSION_SECRET) return null;
  const payload = await verifySession(token, env.SESSION_SECRET);
  // Cookie NAME is not a security boundary — a caller chooses which cookie
  // carries which token, and both audiences are signed with SESSION_SECRET.
  // The audience claim is the boundary. A token minted for /flows is refused
  // here; a legacy token predating audiences (no aud at all) is still
  // honoured so nobody signed in today gets logged out.
  if (!payload || !isLearnAudience(payload)) return null;
  return { id: payload.sub, email: payload.email || "", name: payload.name || "" };
}

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function courseStructuredData(pageUrl, meta) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Course", "@id": pageUrl, url: pageUrl,
        name: meta.name, description: meta.description,
        provider: { "@type": "Person", "@id": SITE_ORIGIN + "/#person", name: "Anıl Kaya", url: SITE_ORIGIN + "/" },
        isAccessibleForFree: true, inLanguage: "en", educationalLevel: meta.level,
        hasCourseInstance: { "@type": "CourseInstance", courseMode: "Online" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN + "/" },
          { "@type": "ListItem", position: 2, name: "Econometrics Lab", item: SITE_ORIGIN + "/lab/" },
          { "@type": "ListItem", position: 3, name: meta.name, item: pageUrl },
        ],
      },
    ],
  }).replace(/</g, "\\u003c");
}

function courseFallback(meta) {
  return '<div class="course-fallback">' +
    '<nav class="course-breadcrumb" aria-label="Breadcrumb"><a href="/lab/">Econometrics Lab</a><span aria-hidden="true">/</span><span>' + escapeHTML(meta.name) + "</span></nav>" +
    "<h1>" + escapeHTML(meta.name) + "</h1>" +
    "<p>" + escapeHTML(meta.description) + "</p>" +
    '<p class="course-fallback__meta">' + escapeHTML(meta.level) + " · " + meta.modules.length + " modules · Free and browser-based</p>" +
    '<p><a class="btn btn--gold" href="#courseModules">View the course outline</a></p>' +
    "</div>";
}

function courseOverview(meta) {
  const modules = meta.modules.map((module) =>
    '<article class="course-outline__module"><h3>' + escapeHTML(module.title) + "</h3><p>" + escapeHTML(module.summary) + "</p></article>"
  ).join("");
  const related = COURSE_TOPICS.filter((topic) => topic.id !== meta.id).map((topic) =>
    '<li><a href="' + topic.path + '">' + escapeHTML(topic.name) + "</a></li>"
  ).join("");
  return '<section class="course-overview" aria-labelledby="courseOverviewTitle">' +
    '<p class="course-overview__kicker">Course overview</p>' +
    '<h2 id="courseOverviewTitle">Learn ' + escapeHTML(meta.name) + " interactively</h2>" +
    "<p>This free course uses real Python and statsmodels in your browser. Work through the modules below with explanations, executable examples, interactive controls, and questions.</p>" +
    '<div class="course-outline" id="courseModules">' + modules + "</div>" +
    '<p class="course-overview__byline">Course by <a href="/">Anıl Kaya</a> · ' + escapeHTML(meta.level) + " level</p>" +
    '<h2 class="course-overview__related-title">Explore other econometrics courses</h2>' +
    '<ul class="course-related">' + related + "</ul>" +
    "</section>";
}

async function renderCourse(request, env, url, meta, ctx) {
  // The rendered document is deterministic per course URL, so memoize it at the
  // edge to skip the ASSETS fetch + HTMLRewriter on repeat hits. Keyed by the
  // canonical path (collapsing ?utm_source= &c) with a short TTL; the browser
  // still gets no-cache from finalize(), so this only shortens the edge's own
  // revalidation. A deploy is reflected within COURSE_EDGE_TTL_S.
  const cache = request.method === "GET" && typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = cache ? new Request(url.origin + meta.path) : null;
  if (cacheKey) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return hit;
  }

  const headers = new Headers(request.headers);
  headers.set("Accept-Encoding", "identity");
  for (const name of ["If-None-Match", "If-Modified-Since", "If-Match", "If-Unmodified-Since", "Range", "If-Range"]) {
    headers.delete(name);
  }
  const asset = await env.ASSETS.fetch(new Request(url.origin + COURSE_ASSET_PATH, { method: "GET", headers }));
  if (!(asset.headers.get("Content-Type") || "").includes("text/html")) return asset;

  const pageUrl = SITE_ORIGIN + meta.path;
  const imageUrl = SITE_ORIGIN + meta.image;
  const structured = courseStructuredData(pageUrl, meta);

  // The player's first fetch is the per-course manifest, but its URL is built in
  // JS behind twelve deferred scripts, so the preload scanner never sees it.
  // Preload it here to overlap the ~8KB manifest with the JS download. The <html>
  // start tag streams before <head>, so capture the asset version from it and
  // reuse it verbatim: the preload URL (including ?v) must byte-match the fetch in
  // lab-course.js, and crossorigin must match fetch()'s CORS mode, or the browser
  // double-fetches instead of reusing the preload.
  let assetVersion = "";
  const transformed = new HTMLRewriter()
    .on("html", { element: (el) => { assetVersion = el.getAttribute("data-asset-version") || ""; } })
    .on("head", { element: (el) => {
      const query = assetVersion ? "?v=" + encodeURIComponent(assetVersion) : "";
      el.prepend('<link rel="preload" as="fetch" crossorigin="anonymous" href="/assets/data/courses/' + meta.id + "/manifest.json" + query + '">', { html: true });
    } })
    .on("title", { element: (el) => el.setInnerContent(meta.pageTitle) })
    .on('meta[name="description"]', setAttr("content", meta.description))
    .on('link[rel="canonical"]', setAttr("href", pageUrl))
    .on('meta[property="og:title"]', setAttr("content", meta.pageTitle))
    .on('meta[property="og:description"]', setAttr("content", meta.description))
    .on('meta[property="og:url"]', setAttr("content", pageUrl))
    .on('meta[property="og:site_name"]', setAttr("content", "Anıl Kaya"))
    .on('meta[property="og:image"]', setAttr("content", imageUrl))
    .on('meta[name="twitter:title"]', setAttr("content", meta.pageTitle))
    .on('meta[name="twitter:description"]', setAttr("content", meta.description))
    .on('meta[name="twitter:image"]', setAttr("content", imageUrl))
    .on("#courseStructuredData", { element: (el) => el.setInnerContent(structured, { html: true }) })
    .on("#course", { element: (el) => el.setInnerContent(courseFallback(meta), { html: true }) })
    .on("#courseOverview", { element: (el) => el.setInnerContent(courseOverview(meta), { html: true }) })
    .transform(asset);
  const rewritten = new Response(transformed.body, transformed);
  for (const name of ["ETag", "Last-Modified", "Content-Length", "Content-Encoding", "Accept-Ranges"]) {
    rewritten.headers.delete(name);
  }

  if (cacheKey && rewritten.status === 200) {
    // Preserve the response object as init (never rebuild from a dict — that can
    // corrupt Content-Encoding at the edge); the body comes from a tee'd clone so
    // the returned response is untouched. The cached copy carries a short TTL for
    // the edge only.
    const copy = new Response(rewritten.clone().body, rewritten);
    copy.headers.set("Cache-Control", "max-age=" + COURSE_EDGE_TTL_S);
    const put = cache.put(cacheKey, copy).catch(() => {});
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put); else await put;
  }
  return rewritten;
}

async function route(request, env, url, ctx) {
  const path = url.pathname;
  const origin = url.origin;

  if (path === "/auth/google") {
    requireMethod(request, ["GET"]);
    requireGoogleConfig(env);
    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: origin + "/auth/callback",
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
      prompt: "select_account",
    });
    return redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params, 302, [
      cookie("oauth_state", state, { maxAge: 600 }),
    ]);
  }

  if (path === "/auth/callback") {
    requireMethod(request, ["GET"]);
    try {
      requireGoogleConfig(env);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const saved = getCookie(request, "oauth_state");
      if (!code || !state || !saved || state !== saved) throw new Error("invalid OAuth state");

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: origin + "/auth/callback",
          grant_type: "authorization_code",
        }),
      });
      if (!tokenResponse.ok) throw new Error("OAuth token exchange failed");
      const token = await tokenResponse.json();
      if (!token.access_token) throw new Error("OAuth access token missing");

      const userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + token.access_token },
      });
      if (!userResponse.ok) throw new Error("Google user lookup failed");
      const info = await userResponse.json();
      if (!info.sub) throw new Error("Google user id missing");

      const user = { sub: "g_" + info.sub, email: info.email || "", name: info.name || info.email || "Learner" };
      await env.DB.prepare(
        "INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name"
      ).bind(user.sub, user.email, user.name, Date.now()).run();

      const session = await signSession(
        { sub: user.sub, email: user.email, name: user.name, aud: LEARN_AUDIENCE,
          exp: Date.now() + 1000 * 60 * 60 * 24 * 30 },
        env.SESSION_SECRET
      );
      return redirect(origin + "/lab/?auth=ok", 302, [
        cookie("session", session, { maxAge: 60 * 60 * 24 * 30 }),
        cookie("oauth_state", "", { maxAge: 0 }),
      ]);
    } catch (error) {
      console.error(JSON.stringify({
        message: "oauth callback failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      return redirect(origin + "/lab/?auth=error", 302, [cookie("oauth_state", "", { maxAge: 0 })]);
    }
  }

  if (path === "/auth/logout") {
    requireMethod(request, ["POST"]);
    requireSessionSecret(env);
    requireSameOrigin(request);
    const user = await currentUser(request, env);
    // If a valid session exists, bind the request to the exact account the
    // page last verified. An expired/malformed session may still be cleared.
    if (user) requireMutationOwner(request, user.id);
    return json({ ok: true }, 200, {
      "Set-Cookie": cookie("session", "", { maxAge: 0 }),
    });
  }

  if (path.startsWith("/auth/")) {
    throw new HttpError(404, "not_found", "Auth route not found");
  }

  if (path === "/api/me") {
    requireMethod(request, ["GET"]);
    requireSessionSecret(env);
    return json({ user: await currentUser(request, env) });
  }

  if (path === "/api/markets") {
    requireMethod(request, ["GET", "HEAD"]);
    // Public, non-personal data: mark it browser-cacheable for 5 min so a repeat
    // visitor's browser doesn't refetch (finalize preserves this Cache-Control on
    // the success path only). Distinct visitors still reach the worker, but only
    // read one D1 row; the cron keeps that row warm.
    return new Response(await loadMarketSnapshot(env), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
    });
  }

  if (path === "/api/v2/bootstrap") {
    requireMethod(request, ["GET"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) return json({ user: null });
    requireReadOwnerIfPresent(request, user.id);
    const snapshot = await loadAcademyBootstrapSnapshot(env, user);
    return json(snapshot, 200, generationHeaders(snapshot.generation));
  }

  if (path === "/api/v2/progress") {
    requireMethod(request, ["PUT"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, "unauthorized", "Authentication required");
    requireSameOrigin(request);
    requireMutationOwner(request, user.id);
    const generation = await mutationGeneration(request, env, user.id);
    const body = await readJSON(request);
    const key = `${body.courseId}:${body.stageId}`;
    const stage = typeof body.courseId === "string" && typeof body.stageId === "string" ? STAGE_KEY_BY_COURSE[key] : null;
    if (!stage || stage.courseId !== body.courseId || body.complete !== true) throw new HttpError(400, "invalid_progress", "Course and stable stage id must be valid");
    const now = Date.now();
    const results = await academyBatch(env, user.id, () => [
      env.DB.prepare(
        "INSERT INTO progress_v3 (user_id, course_id, stage_id, completed_at, source) " +
        "SELECT ?, ?, ?, ?, 'web' WHERE EXISTS (SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?) " +
        "ON CONFLICT(user_id, course_id, stage_id) DO UPDATE SET completed_at=MIN(progress_v3.completed_at, excluded.completed_at) RETURNING stage_id"
      ).bind(user.id, body.courseId, body.stageId, now, user.id, generation),
      env.DB.prepare(
        "INSERT INTO progress (user_id, model_id, done_json, updated_at) " +
        "SELECT ?, ?, json(?), ? WHERE EXISTS (SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?) " +
        "ON CONFLICT(user_id, model_id) DO UPDATE SET done_json=(SELECT json_group_array(value) FROM (" +
          "SELECT DISTINCT CAST(value AS INTEGER) AS value FROM (" +
            "SELECT value, type FROM json_each(CASE WHEN json_valid(progress.done_json) THEN progress.done_json ELSE '[]' END) " +
            "UNION ALL SELECT value, type FROM json_each(excluded.done_json)" +
          ") WHERE type='integer' AND value>=0 AND value<? ORDER BY value" +
        ")), updated_at=MAX(COALESCE(progress.updated_at,0), excluded.updated_at) RETURNING done_json"
      ).bind(user.id, body.courseId, JSON.stringify([stage.index]), now, user.id, generation, COURSE_STAGE_POINTS[body.courseId].length),
      env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id=?").bind(user.id),
      env.DB.prepare("SELECT course_id, stage_id FROM progress_v3 WHERE user_id=? AND course_id=? ORDER BY completed_at, stage_id").bind(user.id, body.courseId),
    ]);
    // Points are derived read-only on every read path, so no points row is
    // written here — the stats.points column is no longer read anywhere.
    const currentGeneration = normalizeGeneration(results[3].results[0]?.generation);
    if (currentGeneration !== generation || !results[1].results[0] || !results[2].results[0]) throwResetRequired(currentGeneration);
    return json({ ok: true, courseId: body.courseId, done: stableProgressFromRows(results[4].results)[body.courseId]?.done || [], generation }, 200, generationHeaders(generation));
  }

  if (path === "/api/v2/attempt") {
    requireMethod(request, ["PUT"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, "unauthorized", "Authentication required");
    requireSameOrigin(request);
    requireMutationOwner(request, user.id);
    const generation = await mutationGeneration(request, env, user.id);
    const body = await readJSON(request);
    const day = normalizeActivityDay(body.day);
    if (typeof body.skillId !== "string" || !Object.hasOwn(SKILL_BY_ID, body.skillId) || typeof body.itemId !== "string" || !validSkillItem(body.skillId, body.itemId) || typeof body.attemptId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.attemptId) || typeof body.correct !== "boolean" || typeof body.hinted !== "boolean" || !day) {
      throw new HttpError(400, "invalid_skill_attempt", "Skill, item, and attempt data must be valid");
    }
    const correct = body.correct ? 1 : 0, hinted = body.hinted ? 1 : 0, now = Date.now();
    const results = await academyBatch(env, user.id, () => [
      env.DB.prepare(
        "INSERT INTO skill_attempts (user_id, attempt_id, skill_id, item_id, correct, hinted, attempt_day, applied, received_at) " +
        "SELECT ?, ?, ?, ?, ?, ?, ?, 0, ? WHERE EXISTS (SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?) " +
        "ON CONFLICT(user_id, attempt_id) DO NOTHING RETURNING attempt_id"
      ).bind(user.id, body.attemptId, body.skillId, body.itemId, correct, hinted, day, now, user.id, generation),
      env.DB.prepare(
        "INSERT INTO skill_mastery (user_id, skill_id, level, due_day, last_day, attempts, correct, last_result, last_attempt_id, updated_at) " +
        "SELECT ?, ?, CASE WHEN ?=1 AND ?=0 THEN 1 ELSE 0 END, date(?, '+1 day'), ?, 1, ?, ?, ?, ? " +
        "WHERE EXISTS (SELECT 1 FROM skill_attempts WHERE user_id=? AND attempt_id=? AND skill_id=? AND applied=0) " +
        "ON CONFLICT(user_id, skill_id) DO UPDATE SET " +
          // Scheduling advances only for an attempt at least as recent as the last
          // applied; a stale late-flushed attempt records counters but cannot rewind
          // the interval (see the mastery path for the full rationale).
          "level=CASE WHEN excluded.last_day >= COALESCE(skill_mastery.last_day, '') THEN " +
            "(CASE WHEN ?=1 AND ?=0 THEN MIN(5,skill_mastery.level+1) WHEN ?=1 THEN skill_mastery.level ELSE MAX(0,skill_mastery.level-1) END) " +
            "ELSE skill_mastery.level END, " +
          "due_day=CASE WHEN excluded.last_day >= COALESCE(skill_mastery.last_day, '') THEN " +
            "date(?, '+' || CASE WHEN ?=1 AND ?=0 THEN CASE WHEN skill_mastery.level<=0 THEN 1 WHEN skill_mastery.level=1 THEN 3 WHEN skill_mastery.level=2 THEN 7 WHEN skill_mastery.level=3 THEN 21 ELSE 60 END ELSE 1 END || ' days') " +
            "ELSE skill_mastery.due_day END, " +
          "last_day=CASE WHEN excluded.last_day >= COALESCE(skill_mastery.last_day, '') THEN excluded.last_day ELSE skill_mastery.last_day END, " +
          "attempts=MIN(1000000,skill_mastery.attempts+1), correct=MIN(1000000,skill_mastery.correct+?), last_result=?, last_attempt_id=?, updated_at=MAX(skill_mastery.updated_at,excluded.updated_at) " +
        "RETURNING skill_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at"
      ).bind(
        user.id, body.skillId, correct, hinted, day, day, correct, correct, body.attemptId, now,
        user.id, body.attemptId, body.skillId,
        correct, hinted, correct, day, correct, hinted, correct, correct, body.attemptId,
      ),
      env.DB.prepare("UPDATE skill_attempts SET applied=1 WHERE user_id=? AND attempt_id=? AND skill_id=? AND applied=0 RETURNING attempt_id").bind(user.id, body.attemptId, body.skillId),
      env.DB.prepare("SELECT skill_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at FROM skill_mastery WHERE user_id=? AND skill_id=?").bind(user.id, body.skillId),
      env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id=?").bind(user.id),
      env.DB.prepare("SELECT skill_id, item_id, correct, hinted, attempt_day FROM skill_attempts WHERE user_id=? AND attempt_id=?").bind(user.id, body.attemptId),
      // Bound the skill idempotency ledger to the retry window (see mastery). Rides
      // this batch, never matches the just-inserted row, appended last for stable indices.
      env.DB.prepare("DELETE FROM skill_attempts WHERE user_id=? AND received_at < ?").bind(user.id, now - ATTEMPT_LEDGER_TTL_MS),
    ]);
    const currentGeneration = normalizeGeneration(results[5].results[0]?.generation);
    if (currentGeneration !== generation) throwResetRequired(currentGeneration);
    const attempt = results[6].results[0];
    if (!attempt) throw new Error("Skill attempt was not recorded");
    if (attempt.skill_id !== body.skillId || attempt.item_id !== body.itemId || Number(attempt.correct) !== correct || Number(attempt.hinted) !== hinted || attempt.attempt_day !== day) throw new HttpError(409, "attempt_conflict", "Attempt id was already used for different data");
    const record = skillMasteryRecord(results[4].results[0]);
    if (!record) throw new Error("Stored skill mastery is invalid");
    return json({ ok: true, record, duplicate: !results[1].results[0], generation }, 200, generationHeaders(generation));
  }

  if (path === "/api/v2/preferences") {
    requireMethod(request, ["PUT"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, "unauthorized", "Authentication required");
    requireSameOrigin(request);
    requireMutationOwner(request, user.id);
    const generation = await mutationGeneration(request, env, user.id);
    const body = await readJSON(request);
    if (!PATH_IDS.has(body.activePathId) || !SESSION_MINUTES.has(body.sessionMinutes) || !Number.isSafeInteger(body.weeklyGoalMinutes) || body.weeklyGoalMinutes < 30 || body.weeklyGoalMinutes > 1200) throw new HttpError(400, "invalid_preferences", "Learning preferences must be valid");
    const results = await academyBatch(env, user.id, () => [
      env.DB.prepare(
        "INSERT INTO learning_preferences (user_id, active_path_id, session_minutes, weekly_goal_minutes, updated_at) " +
        "SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?) " +
        "ON CONFLICT(user_id) DO UPDATE SET active_path_id=excluded.active_path_id, session_minutes=excluded.session_minutes, weekly_goal_minutes=excluded.weekly_goal_minutes, updated_at=MAX(learning_preferences.updated_at,excluded.updated_at) " +
        "RETURNING active_path_id, session_minutes, weekly_goal_minutes"
      ).bind(user.id, body.activePathId, body.sessionMinutes, body.weeklyGoalMinutes, Date.now(), user.id, generation),
      env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id=?").bind(user.id),
    ]);
    const currentGeneration = normalizeGeneration(results[2].results[0]?.generation);
    if (currentGeneration !== generation || !results[1].results[0]) throwResetRequired(currentGeneration);
    return json({ ok: true, preferences: preferencesRecord(results[1].results[0]), generation }, 200, generationHeaders(generation));
  }

  if (path === "/api/v2/project") {
    requireMethod(request, ["PUT"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, "unauthorized", "Authentication required");
    requireSameOrigin(request);
    requireMutationOwner(request, user.id);
    const generation = await mutationGeneration(request, env, user.id);
    const body = await readJSON(request);
    const project = typeof body.projectId === "string" ? PROJECT_BY_ID[body.projectId] : null;
    const done = Array.isArray(body.completedTaskIds) ? [...new Set(body.completedTaskIds)] : null;
    if (!project || !["guided", "unguided"].includes(body.mode) || !done || done.some((taskId) => typeof taskId !== "string" || !project.taskIds.includes(taskId))) throw new HttpError(400, "invalid_project", "Project mode and task completion must be valid");
    const results = await academyBatch(env, user.id, () => [
      env.DB.prepare(
        "INSERT INTO project_progress (user_id, project_id, mode, done_json, updated_at) " +
        "SELECT ?, ?, ?, json(?), ? WHERE EXISTS (SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?) " +
        "ON CONFLICT(user_id, project_id) DO UPDATE SET mode=excluded.mode, done_json=(SELECT json_group_array(value) FROM (" +
          "SELECT DISTINCT value FROM (SELECT value FROM json_each(CASE WHEN json_valid(project_progress.done_json) THEN project_progress.done_json ELSE '[]' END) UNION ALL SELECT value FROM json_each(excluded.done_json)) ORDER BY value" +
        ")), updated_at=MAX(project_progress.updated_at,excluded.updated_at) RETURNING project_id, mode, done_json"
      ).bind(user.id, body.projectId, body.mode, JSON.stringify(done), Date.now(), user.id, generation),
      env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id=?").bind(user.id),
    ]);
    const currentGeneration = normalizeGeneration(results[2].results[0]?.generation);
    if (currentGeneration !== generation || !results[1].results[0]) throwResetRequired(currentGeneration);
    const saved = projectsFromRows(results[1].results);
    return json({ ok: true, project: saved[body.projectId], generation }, 200, generationHeaders(generation));
  }

  if (path === "/api/bootstrap") {
    requireMethod(request, ["GET"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) return json({ user: null });
    requireReadOwnerIfPresent(request, user.id);
    const snapshot = await loadBootstrapSnapshot(env, user);
    return json(snapshot, 200, generationHeaders(snapshot.generation));
  }

  if (path === "/api/progress") {
    requireMethod(request, ["GET", "PUT", "DELETE"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, "unauthorized", "Authentication required");

    if (request.method === "GET") {
      requireReadOwnerIfPresent(request, user.id);
      const snapshot = await loadProgressSnapshot(env, user.id);
      return json(snapshot, 200, generationHeaders(snapshot.generation));
    }

    requireSameOrigin(request);
    requireMutationOwner(request, user.id);

    if (request.method === "DELETE") {
      const now = Date.now();
      const results = await academyBatch(env, user.id, () => [
        env.DB.prepare(
          "INSERT INTO learning_sync (user_id, generation) VALUES (?, 1) " +
          "ON CONFLICT(user_id) DO UPDATE SET generation=" +
            "CASE WHEN learning_sync.generation < ? THEN learning_sync.generation+1 ELSE NULL END " +
          "RETURNING generation"
        ).bind(user.id, MAX_SYNC_GENERATION),
        env.DB.prepare("DELETE FROM progress WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM mastery WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM mastery_attempts WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM placement WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM progress_v3 WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM skill_mastery WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM skill_attempts WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM project_progress WHERE user_id = ?").bind(user.id),
        env.DB.prepare(
          "INSERT INTO stats (user_id, points, streak, last, updated_at) VALUES (?, 0, 0, NULL, ?) " +
          "ON CONFLICT(user_id) DO UPDATE SET points=0, streak=0, last=NULL, updated_at=excluded.updated_at"
        ).bind(user.id, now),
      ]);
      const generation = normalizeGeneration(results[1].results[0]?.generation);
      return json({
        ok: true,
        progress: {},
        stats: { points: 0, streak: 0, last: null },
        mastery: {},
        stableProgress: {},
        skillMastery: {},
        projects: {},
        placement: null,
        generation,
      }, 200, generationHeaders(generation));
    }

    const generation = await mutationGeneration(request, env, user.id);
    const body = await readJSON(request);
    const done = normalizeDone(body.model, body.done);
    if (!done) throw new HttpError(400, "invalid_progress", "Model and completed stages must be valid");
    const now = Date.now();
    const results = await learningBatch(env, user.id, () => [
      env.DB.prepare(
        "INSERT INTO progress (user_id, model_id, done_json, updated_at) " +
        "SELECT ?, ?, json(?), ? WHERE EXISTS (" +
          "SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?" +
        ") " +
        "ON CONFLICT(user_id, model_id) DO UPDATE SET done_json=(" +
          "SELECT json_group_array(value) FROM (" +
            "SELECT DISTINCT CAST(value AS INTEGER) AS value FROM (" +
              "SELECT value, type FROM json_each(CASE WHEN json_valid(progress.done_json) THEN progress.done_json ELSE '[]' END) " +
              "UNION ALL SELECT value, type FROM json_each(excluded.done_json)" +
            ") WHERE type='integer' AND value>=0 AND value<? ORDER BY value" +
          ")" +
        "), updated_at=MAX(COALESCE(progress.updated_at, 0), excluded.updated_at) " +
        "RETURNING done_json"
      ).bind(
        user.id, body.model, JSON.stringify(done), now,
        user.id, generation, COURSE_STAGE_POINTS[body.model].length,
      ),
      env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id=?").bind(user.id),
    ]);
    // One round-trip: guarded upsert + generation read in the same batch. Points
    // derive read-only on reads, so there is no points write here.
    const written = results[1].results[0];
    const currentGeneration = normalizeGeneration(results[2].results[0]?.generation);
    if (!written || currentGeneration !== generation) throwResetRequired(currentGeneration);
    const mergedDone = normalizeDone(body.model, JSON.parse(written.done_json || "[]"));
    if (!mergedDone) throw new Error("Stored progress is invalid");
    return json({ ok: true, done: mergedDone, generation }, 200, generationHeaders(generation));
  }

  if (path === "/api/stats") {
    requireMethod(request, ["GET", "PUT"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, "unauthorized", "Authentication required");

    if (request.method === "PUT") {
      requireSameOrigin(request);
      requireMutationOwner(request, user.id);
      const generation = await mutationGeneration(request, env, user.id);
      const body = await readJSON(request);
      const streak = body.streak;
      const last = normalizeActivityDay(body.last);
      if (!Number.isSafeInteger(streak) || streak < 0 || streak > 100000 || last === undefined) {
        throw new HttpError(400, "invalid_stats", "Streak and activity date must be valid");
      }
      const now = Date.now();
      const latestDay = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const results = await learningBatch(env, user.id, () => [
        env.DB.prepare(
          "INSERT INTO stats (user_id, points, streak, last, updated_at) " +
          "SELECT ?, 0, ?, ?, ? WHERE EXISTS (" +
            "SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?" +
          ") " +
          "ON CONFLICT(user_id) DO UPDATE SET " +
            "streak=CASE " +
              "WHEN stats.last IS NOT NULL AND stats.last > ? AND excluded.last IS NULL THEN 0 " +
              "WHEN excluded.last IS NULL THEN stats.streak " +
              "WHEN stats.last IS NULL OR stats.last > ? THEN excluded.streak " +
              "WHEN excluded.last > stats.last AND julianday(excluded.last)=julianday(stats.last)+1 " +
                "THEN MIN(100000, MAX(excluded.streak, stats.streak+1)) " +
              "WHEN excluded.last > stats.last THEN excluded.streak " +
              "WHEN excluded.last = stats.last THEN MIN(100000, MAX(stats.streak, excluded.streak)) " +
              "ELSE stats.streak END, " +
            "last=CASE " +
              "WHEN excluded.last IS NULL THEN CASE WHEN stats.last IS NOT NULL AND stats.last > ? THEN NULL ELSE stats.last END " +
              "WHEN stats.last IS NULL OR stats.last > ? OR excluded.last > stats.last THEN excluded.last " +
              "ELSE stats.last END, " +
            "updated_at=MAX(COALESCE(stats.updated_at, 0), excluded.updated_at) " +
          "RETURNING user_id"
        ).bind(
          user.id, streak, last, now, user.id, generation,
          latestDay, latestDay, latestDay, latestDay,
        ),
      ]);
      if (!results[1].results[0]) throwResetRequired(await loadGeneration(env, user.id));

      // A stats PUT changes streak/last only; points derive from progress and
      // are computed read-only inside loadStatsSnapshot — no recompute-write here.
      const snapshot = await loadStatsSnapshot(env, user.id);
      if (snapshot.generation !== generation) throwResetRequired(snapshot.generation);
      return json(
        { ok: true, stats: snapshot.stats, generation },
        200,
        generationHeaders(generation),
      );
    } else {
      requireReadOwnerIfPresent(request, user.id);
    }

    // GET derives points read-only in the snapshot batch — no write on a read.
    const snapshot = await loadStatsSnapshot(env, user.id);
    return json(snapshot, 200, generationHeaders(snapshot.generation));
  }

  if (path === "/api/placement") {
    requireMethod(request, ["GET", "PUT", "DELETE"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, "unauthorized", "Authentication required");

    if (request.method === "GET") {
      requireReadOwnerIfPresent(request, user.id);
      const snapshot = await loadPlacementSnapshot(env, user.id);
      return json(snapshot, 200, generationHeaders(snapshot.generation));
    }

    requireSameOrigin(request);
    requireMutationOwner(request, user.id);
    const generation = await mutationGeneration(request, env, user.id);

    if (request.method === "DELETE") {
      const results = await placementBatch(env, user.id, () => [
        env.DB.prepare(
          "DELETE FROM placement WHERE user_id=? AND EXISTS (" +
            "SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?" +
          ") RETURNING user_id"
        ).bind(user.id, user.id, generation),
        env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id=?").bind(user.id),
      ]);
      const currentGeneration = normalizeGeneration(results[2].results[0]?.generation);
      if (currentGeneration !== generation) throwResetRequired(currentGeneration);
      return json({ ok: true, placement: null, generation }, 200, generationHeaders(generation));
    }

    const placement = normalizePlacement(await readJSON(request));
    if (!placement) {
      throw new HttpError(400, "invalid_placement", "Placement result must be valid");
    }
    const now = Date.now();
    const results = await placementBatch(env, user.id, () => [
      env.DB.prepare(
        "INSERT INTO placement (user_id, band, score, total, completed_day, recommended_topic, updated_at) " +
        "SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (" +
          "SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?" +
        ") ON CONFLICT(user_id) DO UPDATE SET " +
          "band=CASE WHEN excluded.completed_day>=placement.completed_day THEN excluded.band ELSE placement.band END, " +
          "score=CASE WHEN excluded.completed_day>=placement.completed_day THEN excluded.score ELSE placement.score END, " +
          "total=CASE WHEN excluded.completed_day>=placement.completed_day THEN excluded.total ELSE placement.total END, " +
          "completed_day=MAX(placement.completed_day, excluded.completed_day), " +
          "recommended_topic=CASE WHEN excluded.completed_day>=placement.completed_day THEN excluded.recommended_topic ELSE placement.recommended_topic END, " +
          "updated_at=MAX(placement.updated_at, excluded.updated_at) " +
        "RETURNING user_id"
      ).bind(
        user.id, placement.band, placement.score, placement.total, placement.completedDay,
        placement.recommendedTopic, now, user.id, generation,
      ),
    ]);
    if (!results[1].results[0]) throwResetRequired(await loadGeneration(env, user.id));
    const snapshot = await loadPlacementSnapshot(env, user.id);
    if (snapshot.generation !== generation) throwResetRequired(snapshot.generation);
    return json(
      { ok: true, placement: snapshot.placement, generation },
      200,
      generationHeaders(generation),
    );
  }

  if (path === "/api/mastery") {
    requireMethod(request, ["GET", "PUT"]);
    requireSessionSecret(env);
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, "unauthorized", "Authentication required");

    if (request.method === "GET") {
      requireReadOwnerIfPresent(request, user.id);
      const snapshot = await loadMasterySnapshot(env, user.id);
      return json(snapshot, 200, generationHeaders(snapshot.generation));
    }

    requireSameOrigin(request);
    requireMutationOwner(request, user.id);
    const generation = await mutationGeneration(request, env, user.id);
    const body = await readJSON(request);
    const itemId = body.itemId;
    const attemptId = body.attemptId;
    const day = normalizeActivityDay(body.day);
    if (typeof itemId !== "string" || !Object.hasOwn(REVIEW_ITEM_BY_ID, itemId) ||
        typeof attemptId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(attemptId) ||
        typeof body.correct !== "boolean" || typeof body.hinted !== "boolean" || !day) {
      throw new HttpError(400, "invalid_mastery_attempt", "Review item and attempt data must be valid");
    }

    const correct = body.correct ? 1 : 0;
    const hinted = body.hinted ? 1 : 0;
    const now = Date.now();
    const results = await masteryBatch(env, user.id, () => [
      env.DB.prepare(
        "INSERT INTO mastery_attempts " +
          "(user_id, attempt_id, item_id, correct, hinted, attempt_day, applied, received_at) " +
        "SELECT ?, ?, ?, ?, ?, ?, 0, ? WHERE EXISTS (" +
          "SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?" +
        ") ON CONFLICT(user_id, attempt_id) DO NOTHING RETURNING attempt_id"
      ).bind(user.id, attemptId, itemId, correct, hinted, day, now, user.id, generation),
      env.DB.prepare(
        "INSERT INTO mastery " +
          "(user_id, item_id, level, due_day, last_day, attempts, correct, last_result, last_attempt_id, updated_at) " +
        "SELECT ?, ?, CASE WHEN ?=1 AND ?=0 THEN 1 ELSE 0 END, date(?, '+1 day'), ?, 1, ?, ?, ?, ? " +
        "WHERE EXISTS (" +
          "SELECT 1 FROM mastery_attempts WHERE user_id=? AND attempt_id=? AND item_id=? AND applied=0" +
        ") ON CONFLICT(user_id, item_id) DO UPDATE SET " +
          // The scheduling columns (level, due_day) advance only for an attempt at
          // least as recent as the last one applied; a late-flushed stale attempt
          // still records its counters but must not rewind the review interval.
          // COALESCE treats rows created before last_day existed as the oldest day.
          "level=CASE WHEN excluded.last_day >= COALESCE(mastery.last_day, '') THEN " +
            "(CASE WHEN ?=0 THEN 0 WHEN ?=1 THEN MIN(mastery.level, 1) ELSE MIN(5, mastery.level+1) END) " +
            "ELSE mastery.level END, " +
          "due_day=CASE WHEN excluded.last_day >= COALESCE(mastery.last_day, '') THEN " +
            "date(?, '+' || CASE " +
              "WHEN ?=0 OR ?=1 THEN 1 WHEN mastery.level<=0 THEN 1 WHEN mastery.level=1 THEN 3 " +
              "WHEN mastery.level=2 THEN 7 WHEN mastery.level=3 THEN 21 ELSE 60 END || ' days') " +
            "ELSE mastery.due_day END, " +
          "last_day=CASE WHEN excluded.last_day >= COALESCE(mastery.last_day, '') THEN excluded.last_day ELSE mastery.last_day END, " +
          "attempts=MIN(1000000, mastery.attempts+1), " +
          "correct=MIN(1000000, mastery.correct+?), last_result=?, last_attempt_id=?, " +
          "updated_at=MAX(mastery.updated_at, excluded.updated_at) " +
        "RETURNING item_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at"
      ).bind(
        user.id, itemId, correct, hinted, day, day, correct, correct, attemptId, now,
        user.id, attemptId, itemId,
        correct, hinted, day, correct, hinted, correct, correct, attemptId,
      ),
      env.DB.prepare(
        "UPDATE mastery_attempts SET applied=1 WHERE user_id=? AND attempt_id=? AND item_id=? AND applied=0 RETURNING attempt_id"
      ).bind(user.id, attemptId, itemId),
      env.DB.prepare(
        "SELECT item_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at " +
        "FROM mastery WHERE user_id=? AND item_id=?"
      ).bind(user.id, itemId),
      env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id=?").bind(user.id),
      env.DB.prepare(
        "SELECT item_id, correct, hinted, attempt_day FROM mastery_attempts WHERE user_id=? AND attempt_id=?"
      ).bind(user.id, attemptId),
      // Bound the idempotency ledger: prune this user's attempts older than the
      // retry window so the table can't grow O(lifetime attempts). Rides the
      // existing batch (no extra round-trip); never matches the row just
      // inserted (received_at = now). Appended last so result indices are stable.
      env.DB.prepare(
        "DELETE FROM mastery_attempts WHERE user_id=? AND received_at < ?"
      ).bind(user.id, now - ATTEMPT_LEDGER_TTL_MS),
    ]);

    const currentGeneration = normalizeGeneration(results[5].results[0]?.generation);
    if (currentGeneration !== generation) throwResetRequired(currentGeneration);
    const attempt = results[6].results[0];
    if (!attempt) throw new Error("Mastery attempt was not recorded");
    if (attempt.item_id !== itemId || Number(attempt.correct) !== correct || Number(attempt.hinted) !== hinted || attempt.attempt_day !== day) {
      throw new HttpError(409, "attempt_conflict", "Review attempt id was already used for different data");
    }
    const record = masteryRecord(results[4].results[0]);
    if (!record) throw new Error("Stored mastery state is invalid");
    const duplicate = !results[1].results[0];
    return json({ ok: true, record, duplicate, generation }, 200, generationHeaders(generation));
  }

  /* ---------- Flows: credential-gated options-flow section ----------
     The HTML lives in shared/flows-pages.js, never in the asset bundle
     (flows/ is in .assetsignore). A path this block fails to match can
     therefore only 404 — there is no file for a percent-encoded or
     case-varied path to leak past the gate. */

  if (path === "/flows") {
    requireMethod(request, ["GET", "HEAD"]);
    return redirect(new URL("/flows/", url).toString(), 308);
  }

  if (path === "/flows/login") {
    requireMethod(request, ["POST"]);
    requireSameOrigin(request);
    if (!env.SESSION_SECRET) throw new HttpError(503, "unavailable", "Sign-in is not configured");

    const credentials = parseCredentials(env.FLOWS_CREDENTIALS);
    /* A missing credential map or pepper is a CONFIGURATION fault, and it must
       not masquerade as a wrong password. Without this, a deploy that forgot
       either secret rejects all eleven accounts with "those credentials were
       not recognised" — indistinguishable from a typo, so the operator retries
       the password instead of checking the secret store. The two neighbouring
       secrets already fail loudly this way. */
    if (!credentials || !env.FLOWS_PEPPER) {
      throw new HttpError(503, "unavailable", "Sign-in is not configured");
    }
    const form = await readFlowsForm(request);
    const username = String(form.get("username") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");

    const throttleKey = flowsThrottleKey(request, username);
    const locked = await flowsLockRecord(env, throttleKey);
    if (isLocked(locked)) {
      return flowsLoginResponse("Too many attempts. Try again shortly.");
    }

    const verified = await verifyCredential(username, password, credentials, env.FLOWS_PEPPER);
    if (!verified) {
      // Write only on failure, and only for a roster username from a known
      // caller: the happy path costs no D1 rows, and an off-roster attempt
      // costs none either.
      await recordFlowsFailure(env, throttleKey, locked);
      return flowsLoginResponse("Those credentials were not recognised.");
    }

    await clearFlowsFailures(env, throttleKey);
    const session = await signFlowsSession(
      verified, env.SESSION_SECRET, FLOWS_SESSION_TTL_SECONDS, sessionEpoch(env),
    );
    return redirect(origin + "/flows/", 303, [
      cookie(FLOWS_COOKIE, session, { maxAge: FLOWS_SESSION_TTL_SECONDS }),
    ]);
  }

  if (path === "/flows/logout") {
    requireMethod(request, ["POST"]);
    requireSameOrigin(request);
    return redirect(origin + "/flows/", 303, [cookie(FLOWS_COOKIE, "", { maxAge: 0 })]);
  }

  /* THE FLOWS PAGES, one table rather than four near-identical blocks.
  
     The long and short sides were a TOGGLE on one page, which is two problems:
     it hid half the session behind a click, and a toggle has no address — a
     reader could not link to the bearish side, bookmark it, or send it. They
     are routes now, so the rail can mark which one you are on.
  
     Anonymous visitors get the LOGIN page at whatever path they asked for,
     never a redirect: bouncing them to /flows/ loses the page they wanted, and
     the section's existence is not the secret. */
  const FLOWS_ROUTES = {
    "/flows/": (u) => FLOWS_PAGES.overviewPage({ username: u }),
    "/flows/long/": (u) => FLOWS_PAGES.sidePage({ username: u, side: "long" }),
    "/flows/short/": (u) => FLOWS_PAGES.sidePage({ username: u, side: "short" }),
    "/flows/watch/": (u) => FLOWS_PAGES.watchPage({ username: u }),
    "/flows/market/": (u) => FLOWS_PAGES.marketPage({ username: u }),
    "/flows/history/": (u) => FLOWS_PAGES.historyPage({ username: u }),
    "/flows/desk/": (u) => FLOWS_PAGES.deskPage({ username: u }),
    /* Beside the desk in the rail and beside it here, because the two are the
       same class of page: a name the reader types, priced live against a
       metered vendor key on the request path. Every other route in this table
       streams a blob the pipeline computed hours ago. */
    "/flows/strategy/": (u) => FLOWS_PAGES.strategyPage({ username: u }),
    "/flows/ask/": (u) => FLOWS_PAGES.askPage({ username: u }),
    /* Query parameter, never a path segment: dispatch here is
       Object.hasOwn(FLOWS_ROUTES, path), so /flows/ticker/NVDA would have to
       introduce a prefix match into a table whose exactness is the reason a
       missed path can only ever 404. ?t= is also the parameter the card
       dialog's deep link already uses. */
    "/flows/ticker/": (u) => FLOWS_PAGES.tickerPage({ username: u }),
    "/flows/unusual/": (u) => FLOWS_PAGES.unusualPage({ username: u }),
    "/flows/events/": (u) => FLOWS_PAGES.eventsPage({ username: u }),
    "/flows/track/": (u) => FLOWS_PAGES.trackPage({ username: u }),
    /* Under its own rail group rather than beside the session pages — see
       politicalPage() for why a 45-day-old fact does not belong next to
       today's tape. */
    "/flows/political/": (u) => FLOWS_PAGES.politicalPage({ username: u }),
  };
  if (Object.hasOwn(FLOWS_ROUTES, path)) {
    requireMethod(request, ["GET", "HEAD"]);
    const session = await currentFlowsUser(request, env);
    const body = session
      ? FLOWS_ROUTES[path](session.username)
      : FLOWS_PAGES.loginPage();
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  /* Canonical trailing slash for every gated page, so a link without one is a
     redirect rather than a 404 handed to the static bundle. */
  /* `/flows/market` was missing from this list from the day the page shipped —
     the route table had the slashed form and this list did not, so the bare
     path fell straight through to env.ASSETS.fetch() and 404ed. Nothing failed:
     the page worked, every link in the rail carries the slash, and only a
     hand-typed or hand-edited URL ever found it. Added with the ticker page,
     which would have had the identical hole. */
  if (path === "/flows/long" || path === "/flows/short" || path === "/flows/desk"
      || path === "/flows/watch" || path === "/flows/history"
      || path === "/flows/market" || path === "/flows/ticker"
      || path === "/flows/unusual" || path === "/flows/events"
      || path === "/flows/track" || path === "/flows/political"
      || path === "/flows/strategy" || path === "/flows/ask") {
    requireMethod(request, ["GET", "HEAD"]);
    return redirect(new URL(path + "/", url).toString(), 308);
  }

  if (path === "/api/flows/ingest") {
    // The pipeline runs in GitHub Actions and POSTs finished payloads here.
    // GitHub deliberately holds NO Cloudflare API token: Cloudflare's KV:Edit
    // and D1:Edit permissions are ACCOUNT-scoped, so a CI credential could
    // reach the live learning database. A bearer token scoped to this one
    // route cannot.
    requireMethod(request, ["GET", "POST", "DELETE"]);
    if (!env.FLOWS_INGEST_TOKEN) throw new HttpError(503, "unavailable", "Ingest is not configured");

    const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    // Constant-time: a length-leaking early return would let an attacker
    // narrow the token one byte at a time.
    if (!offered || !timingSafeEqualStr(offered, env.FLOWS_INGEST_TOKEN)) {
      throw new HttpError(401, "unauthorized", "Authentication required");
    }

    const key = url.searchParams.get("key") || "";
    // flows_payload is a keyed blob store, so a per-ticker card is just another
    // key. The ticker pattern is deliberately strict: this string becomes a
    // primary key, and the read path builds the same key from a query
    // parameter, so anything the two sides could disagree about is a bug.
    const card = key.startsWith("card:") ? key.slice(5) : null;
    /* EVERY KEY SHAPE THE STORE ACCEPTS, enumerated. This string becomes a
       primary key and the read path rebuilds it from a query parameter, so
       anything the two sides could disagree about is a bug that presents as
       missing data rather than as an error.

       `board:long:2026-08-26` is the dated, immutable copy of a session's
       board. The live board keeps its undated key so the reader path is
       unchanged; the dated copy exists because the undated one is overwritten
       every morning, which meant the product could never answer "what did this
       say last week" — or measure whether it had ever been right.

       The date is matched by SHAPE, not parsed. A well-formed but impossible
       date would only ever produce a row nothing reads; a loose pattern would
       hand an authorised publisher unbounded distinct primary keys. */
    const validKey = card !== null
      ? FLOWS_TICKER_RE.test(card)
      /* `sector:premium` is deliberately a SECOND sector key beside
         `sector:trix`, not a widening of the first. They are different
         quantities measured from the same eleven SPDR baskets — a triple-
         smoothed oscillator on daily closes, and today's option premium lean
         — and merging them behind one key is how a momentum reading and a
         premium lean end up sharing a field name. Two keys, two routes below.

         `news` is the market-wide headlines tape. It is a stream published by
         a once-a-day job, so its payload carries `readAt` and the window its
         rows cover; this door only decides that the key exists.

         `brief` is the one key assembled FROM the others. The pipeline builds
         it last, out of what it has just published, and it carries both the
         three-session briefing a page draws and the flat fact index the
         question box selects from. It is here for the ordinary reason every
         other name is: a key absent from this list is refused at the door
         with a 400, and the publish would have failed on the first live run
         with the pipeline's own non-fatal warning swallowing it. */
      : /^board:(long|short|watch)$|^board:(long|short):\d{4}-\d{2}-\d{2}$|^scores:\d{4}-\d{2}-\d{2}$|^scoretrack$|^flowalerts$|^pulse$|^political$|^record$|^movers$|^market$|^unusual$|^events$|^sector:trix$|^sector:premium$|^news$|^brief$|^meta$/.test(key);
    if (!validKey) {
      throw new HttpError(400, "invalid_key", "Unknown payload key");
    }

    /* GET returns what is currently stored, under the same bearer.

       The pipeline needs it for hysteresis: a name already on the board should
       stay until it falls out of the exit band, and that needs yesterday's
       ticker list. previousIds was a hardcoded empty array, so the mechanism
       had nothing to hold and the wider enrichment buffer it justified — ten
       extra names of API cost per run — bought nothing. */
    if (request.method === "GET") {
      const stored = await readFlowsPayload(env, key);
      if (!stored) return json({ key, status: "pending" });
      return passthrough(stored);
    }

    /* DELETE EXISTS FOR EXACTLY ONE CALLER AND ONE KEY SHAPE.

       Retaining a dated copy of every board is what makes the track record
       possible, and an archive with no prune is a table that grows forever
       against a write budget shared with a live learning app. So the pipeline
       sweeps its own old keys — and this is the route it sweeps through.

       IT CAN ONLY EVER REMOVE A DATED BOARD. The bearer that reaches here can
       already overwrite the live board, so this is not a privilege boundary;
       it is a blast-radius one. A prune with an off-by-one in its date
       arithmetic that could name `board:long` would take the product down
       silently — the read path would answer `pending` and the section would
       look like it had simply never run. Narrowing the pattern here means the
       worst a broken sweep can do is delete history nobody is reading yet.

       Nothing matched is 404 and NOT an error: the sweep names a fixed skirt
       of days past the retention edge so a month of downtime self-heals, and
       in steady state almost every name it tries is a day that was never
       written. The caller treats 404 as an ordinary empty day. */
    if (request.method === "DELETE") {
      if (!DATED_ARCHIVE_KEY_RE.test(key)) {
        throw new HttpError(400, "undeletable_key", "Only dated archive keys can be removed");
      }
      await ensureFlowsTables(env);
      const result = await env.DB.prepare(
        "DELETE FROM flows_payload WHERE id = ?"
      ).bind(key).run();
      const removed = result && result.meta ? Number(result.meta.changes) || 0 : 0;
      if (!removed) return json({ key, removed: 0, status: "absent" }, 404);
      return json({ ok: true, key, removed });
    }

    const payload = new TextDecoder().decode(
      await readBounded(request, FLOWS_MAX_PAYLOAD_BYTES, "Payload too large"),
    );
    // Parse once, here, purely to reject malformed JSON at the door — the
    // read path must never parse, so a bad payload would otherwise be served
    // verbatim to the browser and fail there instead.
    try { JSON.parse(payload); }
    catch { throw new HttpError(400, "invalid_payload", "Payload is not valid JSON"); }

    await ensureFlowsTables(env);

    /* ---------- the dated archive is actually immutable now ----------

       IT SAID SO IN THREE COMMENTS AND NOTHING ENFORCED IT. Every key,
       dated ones included, was written with ON CONFLICT DO UPDATE, so a
       second run on the same day silently replaced the archived board with
       a different one. Measured, not theorised: two POSTs to
       `board:long:2026-08-24` with contradictory rows both returned 200 and
       the archive then reported the second.

       That is not a cosmetic problem. This archive exists so the product can
       be shown to have been right or wrong — shared/flows-record.js reads
       exactly these keys to compute the hit rate the deck publishes — and a
       record that can be quietly rewritten is not a record. The crons fire
       twice for the two US timezones and have been observed running hours
       late, so a same-day second run is an ordinary event, not a rare one.

       AN IDENTICAL REWRITE IS NOT A REVISION and still succeeds. The
       pipeline retries its own writes on a 5xx, and refusing a retry that
       carries the same bytes would turn this guard into an outage. What is
       refused is a write that would CHANGE what a past session said.

       THE ESCAPE HATCH ALREADY EXISTS and is deliberately two steps: DELETE
       above accepts exactly these dated keys. Correcting a genuinely bad
       archive day is therefore possible, visible, and impossible to do by
       accident — which is the whole difference between a record and a draft. */
    if (DATED_ARCHIVE_KEY_RE.test(key)) {
      const existing = await readFlowsPayload(env, key);
      if (existing && existing.payload !== payload) {
        throw new HttpError(409, "archive_immutable",
          "A dated archive key already holds a different payload. The dated boards are " +
          "the record this product's accuracy claims are computed from, so a write that " +
          "would change what a past session said is refused. Delete the key first if it " +
          "genuinely must be corrected.");
      }
      if (existing) {
        /* Byte-identical: nothing to do, and saying so is more useful than a
           bare ok — a run that reports `unchanged` on a key it thought it was
           publishing is a retry, and a reader of the log should see that. */
        return json({ ok: true, key, bytes: payload.length, stored: "unchanged" });
      }
    }

    await env.DB.prepare(
      "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at"
    ).bind(key, payload, Date.now()).run();

    return json({ ok: true, key, bytes: payload.length });
  }

  if (path.startsWith("/api/flows/")) {
    /* EVERY ROUTE UNDER HERE IS A READ EXCEPT ONE. This guard said GET and
       nothing else, which was exactly right while the whole surface was
       "stream a blob the pipeline already computed". /api/flows/ask takes
       a question, so it takes a POST — and the gate stays one gate rather
       than the route hoisting itself above the shared authentication
       check, which is how an endpoint ends up the only one nobody
       remembered to protect.

       THE ORDER IS DELIBERATE: an allowed method with no session gets 401
       and a disallowed method gets 405, so a caller learns which of the
       two things they got wrong rather than being told "not allowed" for
       a request that was merely unauthenticated. */
    requireMethod(request, path === "/api/flows/ask" ? ["POST"] : ["GET"]);
    const session = await currentFlowsUser(request, env);
    if (!session) throw new HttpError(401, "unauthorized", "Authentication required");

    if (path === "/api/flows/board") {
      /* THREE BOARDS, ONE ROUTE. `watch` holds the names inside the dead band
         — fully scored, published on neither side, and until now reported as
         nothing but an integer. It is the same shape as the other two and
         reaches the reader down the same path, so it is a third value of the
         same parameter rather than a second route that would drift from this
         one. Anything not recognised falls back to `long`, so a hand-edited
         URL cannot mint a key. */
      const raw = url.searchParams.get("side");
      const side = raw === "short" || raw === "watch" ? raw : "long";
      const stored = await readFlowsPayload(env, "board:" + side);
      if (stored === null) {
        return json({ side, rows: [], generatedAt: null, status: "pending" });
      }
      return passthrough(stored);
    }

    if (path === "/api/flows/market") {
      /* THE LEVEL, WHICH EVERY OTHER SURFACE HERE HAS NEUTRALISED AWAY.

         The board score is a residual within the day's cross-section after
         sector and log-capitalisation are divided out — by design, because that
         is what makes it a comparison between names. The cost is that no
         existing surface can say whether the tape as a whole was bought or
         sold: the level was removed before the ranking was taken.

         Computed in the pipeline from screener rows already in memory, so it
         costs no vendor call at all. Served here like everything else: read a
         stored blob, hand back the bytes. */
      const stored = await readFlowsPayload(env, "market");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/events") {
      /* WHAT REPORTS NEXT, AND WHICH NAMES THE BOARD WAS GATED OUT OF. Built
         from screener rows already in memory — no vendor call — and served
         like everything here: one stored blob, handed back as bytes. */
      const stored = await readFlowsPayload(env, "events");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/scoretrack") {
      /* EACH NAME'S DAILY SCORE, TRACED. Rebuilt by the pipeline from its own
         dated archive every run — a view, not a second store — and served
         like everything here: one stored blob, handed back as bytes. */
      const stored = await readFlowsPayload(env, "scoretrack");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/flowalerts") {
      /* THE VENDOR'S FLOW ALERTS — one market-wide call a run, published as
         its own key so a failed feed can never cost the counter beside it.
         Served like everything here: one stored blob, handed back as bytes. */
      const stored = await readFlowsPayload(env, "flowalerts");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/pulse") {
      /* THE MARKET PULSE — seven market-wide vendor feeds pooled under one
         key by the nightly pipeline, with the tide re-read intraday by the
         cron so the series does not stop at yesterday's close. Served like
         everything here: one stored blob, handed back as bytes. */
      const stored = await readFlowsPayload(env, "pulse");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/political") {
      /* DISCLOSED POLITICAL FILINGS, ranked by size. Built nightly by the
         pipeline from a paginated congress-trader window and — where the key
         is entitled to it — the politician-portfolio holders feed. Served the
         way everything here is: one stored blob, handed back as bytes.

         The payload carries how it was obtained (route, pages read, whether
         pagination answered) because a ranking is only as wide as the
         population behind it, and a reader cannot tell a thin week from a
         broken walk without that. */
      const stored = await readFlowsPayload(env, "political");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/unusual") {
      /* THE CONTRACT FEED, AND IT SPENDS NO VENDOR CALL AT ALL. Every row was
         built inside buildChainPanels from the option chain the pipeline
         already buys for each board name, and the name panel from screener
         rows already in memory. Served the way everything here is: read one
         stored blob, hand back the bytes, parse nothing. */
      const stored = await readFlowsPayload(env, "unusual");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/movers" || path === "/api/flows/sectors") {
      /* TWO MARKET-WIDE READINGS, both precomputed and both served as bytes.

         Everything else in this section is bottom-up: a residual WITHIN the
         day's cross-section, with sector and log-cap deliberately neutralised
         out of it. So the board could say twelve names lean bullish and never
         say whether that was breadth or one sector, and it could not say
         whether the tape itself was risk-on. These two answer that.

         `movers` costs the pipeline nothing — the screener already returns the
         whole universe with price and change, and the pipeline discarded all
         but the enriched sixty. `sector:trix` costs eleven candle calls of a
         hundred-odd headroom, because a sector reading is one call per SECTOR
         rather than one per name, which is what makes a top-down layer
         affordable at all where a per-name one would not be. */
      const key = path.endsWith("/movers") ? "movers" : "sector:trix";
      const stored = await readFlowsPayload(env, key);
      if (stored === null) return json({ status: "pending", rows: [] });
      return passthrough(stored);
    }

    if (path === "/api/flows/sector-premium") {
      /* THE SECTOR OPTIONS LEAN — one market-wide vendor call a run, covering
         all eleven SPDR sector baskets, served like everything here: one
         stored blob, handed back as bytes.

         A SEPARATE ROUTE FROM /api/flows/sectors ON PURPOSE. That route
         serves `sector:trix`, which is TRIX on daily closes and contains not
         one option. This serves today's bullish-minus-bearish option premium
         per sector. The two can disagree for weeks without either being
         wrong, and a reader who asked for one must never be handed the other
         — which is exactly what a single route with a `kind` parameter would
         eventually do. */
      const stored = await readFlowsPayload(env, "sector:premium");
      if (stored === null) return json({ status: "pending", sectors: [] });
      return passthrough(stored);
    }

    if (path === "/api/flows/news") {
      /* THE MARKET-WIDE HEADLINES TAPE — one vendor call a run, capped rows,
         served as bytes like everything else here.

         NOT A PER-TICKER ROUTE, AND THERE MUST NEVER BE ONE. The vendor has
         no per-ticker news endpoint: `ticker` is a query filter on the same
         market-wide path. A `?t=` parameter here would look reasonable and
         would either spend one vendor call per name behind an authenticated
         route — which is the shape this whole architecture exists to keep off
         the Worker — or filter a blob the caller could have filtered itself.
         Each stored row carries its own `tickers` array; per-name news is a
         filter in the renderer.

         `rows: []` on the pending envelope for the same reason /movers and
         /sectors carry theirs: a page that opens before the first publish
         gets an empty list to iterate rather than an undefined to guard. */
      const stored = await readFlowsPayload(env, "news");
      if (stored === null) return json({ status: "pending", rows: [] });
      return passthrough(stored);
    }

    if (path === "/api/flows/ai-usage") {
      /* THE METER, ON ITS OWN ROUTE AND READABLE BEFORE A QUESTION IS ASKED.
         A budget a reader can only see AFTER spending from it is not a
         budget, it is a receipt — so the assistant needs this on load, and
         the answer route cannot serve it because it is a POST that costs a
         model call to reach.

         IT IS NOT A PUBLISHED KEY AND SO IT IS NOT UNDER THE PASSTHROUGH
         CONVENTION. Every other path here is /api/flows/<key> streaming
         <key> verbatim; this one is computed from D1 and named for what it
         reports rather than for a key that does not exist, so a reader of
         this file is not sent looking for a `ai-usage` payload the pipeline
         never publishes.

         Cheap enough to sit on page load: one indexed read of a
         single-row-per-day table, no parse, no vendor call, no model call. */
      return json({ spend: await askSpend(env) });
    }

    if (path === "/api/flows/brief") {
      /* THE BRIEFING, STREAMED LIKE EVERY OTHER KEY. It is one blob the
         pipeline already computed, so it goes down the same path they all
         do — passthrough(), no parse, no CPU proportional to its size.

         I FIRST SERVED THIS FROM GET /api/flows/ask, reasoning that one
         route reading one key could not answer out of two sessions. That
         was worse on both counts. It broke the convention every other key
         here follows — /api/flows/<key> streams <key> — so a reader of this
         file would look for the briefing where it was not; and it made the
         Worker PARSE a payload in order to re-serialise it, which is the
         one cost this whole design exists to avoid. The drift window it was
         guarding against is real and tiny, and the answer carries
         `briefUpdatedAt` so a page that cares can see it. */
      const stored = await readFlowsPayload(env, "brief");
      if (stored === null) {
        return json({ status: "pending", today: null, yesterday: null, next: null,
          facts: [], silences: { pending: [], unreadable: [], quiet: [] } });
      }
      return passthrough(stored);
    }

    if (path === "/api/flows/ask") {
      /* THE ONE ROUTE UNDER /api/flows THAT PARSES WHAT IT SERVES.

         Every other key here is streamed without being looked inside,
         because parsing is the cost this design exists to avoid: CPU is
         metered and a board is hundreds of kilobytes. This route has to
         read its input, so the input was made small — the pipeline
         assembles the fact index where CPU is free and publishes it as one
         key of roughly sixteen kilobytes. Parsing that is affordable;
         parsing the seventeen surfaces it was built from, here, on every
         question, would not be. */
      const asked = await askQuestion(request);
      const stored = await readFlowsPayload(env, "brief");

      if (stored === null) {
        return json({ status: "pending", question: asked, answer: null, llm: false,
          facts: [], guard: null, model: null, spend: await askSpend(env),
          note: "The briefing has not been published for this session yet, so there is " +
            "nothing measured to answer from. Nothing is claimed about the market by that." });
      }
      let index;
      try {
        index = JSON.parse(stored.payload);
      } catch {
        /* THE KEY EXISTS AND DOES NOT PARSE. That is this page's fault and
           it is said as one, rather than answered with an empty briefing
           that would read as a session in which nothing happened. */
        throw new HttpError(500, "brief_unreadable",
          "The briefing was published and could not be read, so no answer is offered. " +
          "That is a fault on this site rather than a fact about the session.");
      }
      return askAnswer(asked, env, index, stored.updatedAt);
    }

    if (path === "/api/flows/record") {
      /* THE SIGNAL'S OWN TRACK RECORD, scored in the pipeline and served here
         as one blob like everything else. It is emphatically NOT computed on
         this path: measuring it means reading every retained board and joining
         it to later closes, which is exactly the parsing this architecture
         exists to keep out of a 10ms CPU budget.

         Absent is the ORDINARY state right after this ships, not a fault.
         Retention begins with the first pipeline run after deploy, so there is
         genuinely nothing to score yet, and the page says so. */
      const stored = await readFlowsPayload(env, "record");
      if (stored === null) {
        return json({ status: "pending", horizons: [], sessions: 0 });
      }
      return passthrough(stored);
    }

    if (path === "/api/flows/card") {
      // The ticker is validated against the SAME pattern the ingest route
      // enforces on the key it stores. If the two ever disagree, a card that
      // was written could not be read, which is the kind of failure that looks
      // like missing data rather than like a bug.
      const ticker = String(url.searchParams.get("t") || "").trim().toUpperCase();
      if (!FLOWS_TICKER_RE.test(ticker)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }
      const stored = await readFlowsPayload(env, "card:" + ticker);
      if (stored === null) {
        // A valid ticker with no card yet is "not built", not an error: the
        // board and the cards are published by separate POSTs, so a card can
        // legitimately lag its row. Answering 404 here would paint the whole
        // board with errors the first time a card publish fails.
        return json({ ticker, status: "pending" });
      }
      return passthrough(stored);
    }

    if (path === "/api/flows/chain") {
      const ticker = String(url.searchParams.get("t") || "").trim().toUpperCase();
      if (!FLOWS_TICKER_RE.test(ticker)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }
      /* NORMALISED BEFORE THEY REACH THE CACHE KEY — see
         serveCachedVendorRead() for why that is a security property and not
         a tidiness one. */
      const rawStrategy = url.searchParams.get("strategy");
      const strategy = rawStrategy === "csp" || rawStrategy === "cc" ? rawStrategy : "both";
      const rawRank = url.searchParams.get("rank");
      const rankBy = RANK_KEYS.includes(rawRank) ? rawRank : "annualized";

      return serveCachedVendorRead({
        ctx,
        cacheKey: new Request(
          `https://flows-chain.internal/${ticker}?strategy=${strategy}&rank=${rankBy}`,
          { method: "GET" }),
        wantsRefresh: url.searchParams.get("refresh") === "1",
        build: () => buildChainPayload(env, ctx, { ticker, strategy, rankBy, limit: 120 }),
      });
    }

    if (path === "/api/flows/strategy") {
      /* THE STRATEGY TESTER'S ONE ROUTE, TWO READS. `?t=` alone is the context
         read — price, session date, beta, the index it is weighted to, and the
         expiry list with each expiry's contract count. `?t=&expiry=` is the
         book at one expiry.

         ONE ROUTE RATHER THAN TWO because they are the same resource at two
         depths and they share every quota control below. Two cache keys,
         though: an expiry read must never be able to evict the context read
         that priced it. */
      const ticker = String(url.searchParams.get("t") || "").trim().toUpperCase();
      if (!FLOWS_TICKER_RE.test(ticker)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }
      const rawExpiry = url.searchParams.get("expiry");
      /* A MALFORMED EXPIRY IS A 400, NOT A SILENT FALL-BACK TO THE CONTEXT
         READ. Coercing it away would answer a question nobody asked with a
         payload that looks entirely valid — the page would render an expiry
         picker where the reader expected a chain, and nothing would say why. */
      if (rawExpiry !== null && !EXPIRY_RE.test(rawExpiry)) {
        throw new HttpError(400, "invalid_expiry", "Expiry must be YYYY-MM-DD");
      }
      const expiry = rawExpiry === null ? null : rawExpiry;

      return serveCachedVendorRead({
        ctx,
        cacheKey: new Request(
          `https://flows-strategy.internal/${ticker}${expiry ? "/" + expiry : ""}`,
          { method: "GET" }),
        wantsRefresh: url.searchParams.get("refresh") === "1",
        build: () => (expiry
          ? buildStrategyExpiry(env, ticker, expiry)
          : buildStrategyContext(env, ctx, ticker)),
      });
    }

    throw new HttpError(404, "not_found", "API route not found");
  }

  if (path.startsWith("/flows/")) {
    throw new HttpError(404, "not_found", "Not found");
  }

  if (path.startsWith("/api/")) {
    throw new HttpError(404, "not_found", "API route not found");
  }

  if (LEGACY_COURSE_PATHS.has(path)) {
    requireMethod(request, ["GET", "HEAD"]);
    const topicId = url.searchParams.get("m");
    const target = topicId && Object.hasOwn(COURSE_BY_ID, topicId) ? COURSE_BY_ID[topicId].path : "/lab/";
    return redirect(new URL(target, url).toString(), 308);
  }

  const courseMatch = path.match(/^\/lab\/([a-z0-9-]+)\/?$/);
  if (courseMatch && Object.hasOwn(COURSE_BY_SLUG, courseMatch[1])) {
    requireMethod(request, ["GET", "HEAD"]);
    const meta = COURSE_BY_SLUG[courseMatch[1]];
    if (path !== meta.path) {
      return redirect(new URL(meta.path, url).toString(), 308);
    }
    // GET and HEAD share renderCourse so a HEAD reports the same status a GET
    // would (renderCourse passes a missing/misdeployed template through as its
    // real error status — synthesizing a blind 200 would lie to uptime monitors).
    // The HTMLRewriter is lazy, so a HEAD never pays the rewrite, and the edge
    // memo is GET-only.
    return renderCourse(request, env, url, meta, ctx);
  }

  return env.ASSETS.fetch(request);
}

// Every route passes through this single mutator. When modifying an existing
// response, preserve the response object itself as the init; rebuilding a
// status/header dictionary can corrupt Content-Encoding at Cloudflare's edge.
function finalize(response, request, url) {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);

  const contentType = out.headers.get("Content-Type") || "";
  const cacheableMethod = request.method === "GET" || request.method === "HEAD";
  const cacheableStatus = out.status === 200 || out.status === 304;
  if (contentType.includes("text/html")) out.headers.set("Content-Security-Policy", CSP);
  else out.headers.delete("Content-Security-Policy");

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") ||
      url.pathname === "/flows" || url.pathname.startsWith("/flows/")) {
    // Gated documents join the no-store set. "no-cache" would still permit a
    // shared cache to STORE the board (it only forces revalidation), and the
    // board is per-account data behind a credential. Assets under /assets/
    // are unaffected and stay immutably cacheable.
    // Personal API/auth data must never be cached. The one exception is a
    // successful GET/HEAD on /api/markets — public, non-personal index data that
    // sets its own short public Cache-Control. Errors (405, 500) still get
    // no-store so a transient failure can't be cached.
    const publicMarkets = url.pathname === "/api/markets" && cacheableMethod && out.status === 200;
    if (!publicMarkets) out.headers.set("Cache-Control", "no-store");
  } else if (contentType.includes("text/html")) {
    // Documents always revalidate; ETags keep unchanged pages a cheap 304. (The
    // one-time Clear-Site-Data purge from the 2026-07 encoding incident has been
    // live long enough that every active browser is healed, so it is retired —
    // it was forcing re-download of the immutable ?v assets on cookieless hits.)
    out.headers.set("Cache-Control", "no-cache");
  } else if (cacheableStatus && cacheableMethod && url.searchParams.has("v") && url.pathname.startsWith("/assets/")) {
    // Only versioned assets are content-addressed by ?v and safe to pin for a
    // year. Scoping to /assets/ stops a crafted ?v on a mutable path (e.g.
    // /sitemap.xml?v=9) from caching a stale copy immutably.
    out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (cacheableStatus && cacheableMethod && contentType && !contentType.includes("application/json")) {
    out.headers.set("Cache-Control", "public, max-age=3600");
  }
  return out;
}

export default {
  // Cron trigger (wrangler.toml) keeps the market snapshot warm so /api/markets
  // reads never block on the upstream fetch during normal traffic.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshMarketSnapshot(env).catch((error) => {
      console.error(JSON.stringify({
        message: "market refresh failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }));
    /* Session-hours refresh of the two Flows feeds that fill intraday.
       Self-gating (weekday, 09:15..16:15 Eastern) and self-isolating: its
       failure never reaches the market snapshot above, and vice versa. */
    ctx.waitUntil(refreshFlowsIntraday(env).catch((error) => {
      console.error(JSON.stringify({
        message: "flows intraday refresh failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url); // parse once; threaded into route + finalize
    try {
      return finalize(await route(request, env, url, ctx), request, url);
    } catch (error) {
      if (error instanceof HttpError) {
        return finalize(apiError(error.status, error.code, error.message, error.headers, error.details), request, url);
      }
      console.error(JSON.stringify({
        message: "request failed",
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return finalize(apiError(500, "internal_error", "Internal server error"), request, url);
    }
  },
};
