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
import { COURSE_STAGE_POINTS } from "./shared/course-points.js";
import { COURSE_BY_ID, COURSE_BY_SLUG, COURSE_TOPICS, SITE_ORIGIN } from "./shared/course-seo.js";
import { REVIEW_ITEM_BY_ID } from "./shared/review-manifest.js";
import { COURSE_STAGE_BY_ID } from "./shared/stage-manifest.js";
import { SKILL_BY_ID } from "./shared/skill-manifest.js";
import { PROJECT_BY_ID } from "./shared/project-manifest.js";
import { MARKET_INDICES, parseIndexQuote, buildSnapshot } from "./shared/markets.js";

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

/** Fetch a stored blob by key. Returns {payload, updatedAt}, or null if absent. */
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

  if (path === "/flows/") {
    requireMethod(request, ["GET", "HEAD"]);
    const session = await currentFlowsUser(request, env);
    const body = session
      ? FLOWS_PAGES.boardPage({ username: session.username })
      : FLOWS_PAGES.loginPage();
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (path === "/api/flows/ingest") {
    // The pipeline runs in GitHub Actions and POSTs finished payloads here.
    // GitHub deliberately holds NO Cloudflare API token: Cloudflare's KV:Edit
    // and D1:Edit permissions are ACCOUNT-scoped, so a CI credential could
    // reach the live learning database. A bearer token scoped to this one
    // route cannot.
    requireMethod(request, ["GET", "POST"]);
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
    const validKey = card !== null
      ? FLOWS_TICKER_RE.test(card)
      : /^board:(long|short)$|^meta$/.test(key);
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

    const payload = new TextDecoder().decode(
      await readBounded(request, FLOWS_MAX_PAYLOAD_BYTES, "Payload too large"),
    );
    // Parse once, here, purely to reject malformed JSON at the door — the
    // read path must never parse, so a bad payload would otherwise be served
    // verbatim to the browser and fail there instead.
    try { JSON.parse(payload); }
    catch { throw new HttpError(400, "invalid_payload", "Payload is not valid JSON"); }

    await ensureFlowsTables(env);
    await env.DB.prepare(
      "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at"
    ).bind(key, payload, Date.now()).run();

    return json({ ok: true, key, bytes: payload.length });
  }

  if (path.startsWith("/api/flows/")) {
    requireMethod(request, ["GET"]);
    const session = await currentFlowsUser(request, env);
    if (!session) throw new HttpError(401, "unauthorized", "Authentication required");

    if (path === "/api/flows/board") {
      const side = url.searchParams.get("side") === "short" ? "short" : "long";
      const stored = await readFlowsPayload(env, "board:" + side);
      if (stored === null) {
        return json({ side, rows: [], generatedAt: null, status: "pending" });
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
