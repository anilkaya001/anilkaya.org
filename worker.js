import { signSession, verifySession, getCookie, cookie } from "./shared/session.js";
import {
  FLOWS_COOKIE, FLOWS_SESSION_TTL_SECONDS, LEARN_AUDIENCE, FLOWS_USERNAMES,
  parseCredentials, verifyCredential, signFlowsSession, verifyFlowsSession,
  isLearnAudience, isLocked, nextFailureState, sessionEpoch,
} from "./shared/flows-auth.js";
import { FLOWS_PAGES, modelName, neuronProvenance } from "./shared/flows-pages.js";
import * as FLOWS_ASK from "./shared/flows-ask.js";
import * as FLOWS_NEURON from "./shared/flows-neuron.js";
import { aiChain, aiCallSignature, askModels, emptyNote, fallbackNote, intradayFloorMs, repliedGuard, retryableGuard, spendShape } from "./shared/flows-ai.js";
import { COURSE_STAGE_POINTS } from "./shared/course-points.js";
import { COURSE_BY_ID, COURSE_BY_SLUG, COURSE_TOPICS, SITE_ORIGIN } from "./shared/course-seo.js";
import { REVIEW_ITEM_BY_ID } from "./shared/review-manifest.js";
import { COURSE_STAGE_BY_ID } from "./shared/stage-manifest.js";
import { SKILL_BY_ID } from "./shared/skill-manifest.js";
import { PROJECT_BY_ID } from "./shared/project-manifest.js";
import { MARKET_INDICES, parseIndexQuote, buildSnapshot } from "./shared/markets.js";

import {
  rankChain, RANK_KEYS, crossesEarnings, numOrNull, parseOptionSymbol, ivConvention,
} from "./shared/flows-premium.js";
import { buildFlowAlerts, mergeAlerts } from "./shared/flows-alerts.js";
import { shapeTide } from "./shared/flows-pulse.js";
import { isRefreshWindow } from "./shared/flows-freshness.js";
import { archiveWriteAction, ARCHIVE_REFUSALS } from "./shared/flows-archive.js";

const COURSE_ASSET_PATH = "/lab/course";

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

const ATTEMPT_LEDGER_TTL_MS = 48 * 60 * 60 * 1000;

const MARKET_SNAPSHOT_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS market_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at INTEGER NOT NULL)";

const FLOWS_SCHEMA_SQL = [
  "CREATE TABLE IF NOT EXISTS flows_payload (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL CHECK (updated_at > 0))",
  "CREATE TABLE IF NOT EXISTS flows_login_failures (username TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 1000000), first_at INTEGER NOT NULL CHECK (first_at > 0))",

  "CREATE TABLE IF NOT EXISTS flows_ai_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0), tokens_in INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0), tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0))",
  "CREATE TABLE IF NOT EXISTS flows_ai_usage_model (day TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0), tokens_in INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0), tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0), PRIMARY KEY (day, model))",

  "CREATE TABLE IF NOT EXISTS flows_ai_summary (scope TEXT PRIMARY KEY, text TEXT NOT NULL, llm INTEGER NOT NULL DEFAULT 0 CHECK (llm IN (0, 1)), model TEXT, fingerprint TEXT NOT NULL, guard TEXT, generated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS flows_neuron (scope TEXT PRIMARY KEY, version INTEGER NOT NULL, fingerprint TEXT NOT NULL, summary TEXT NOT NULL, ideas TEXT NOT NULL, llm INTEGER NOT NULL DEFAULT 0 CHECK (llm IN (0, 1)), model TEXT, guard TEXT, generated_at TEXT NOT NULL)",
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

const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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
    } catch {   }
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
    } catch {   }
  }
  return null;
}

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

async function refreshMarketSnapshotIfDue(env) {
  const now = new Date();
  if (!isRefreshWindow(now)) {
    let row = null;
    try {
      row = await marketOp(env, () => env.DB.prepare(
        "SELECT updated_at FROM market_snapshot WHERE id=1").first());
    } catch { row = null; }
    const age = row ? now.getTime() - Number(row.updated_at) : Infinity;
    if (age <= MARKET_STALE_MS) return null;
  }
  return refreshMarketSnapshot(env);
}

async function loadMarketSnapshot(env) {
  let row = null;
  try {
    row = await marketOp(env, () => env.DB.prepare("SELECT payload, updated_at FROM market_snapshot WHERE id=1").first());
  } catch { row = null; }
  const age = row ? Date.now() - Number(row.updated_at) : Infinity;
  if (age > MARKET_STALE_MS) {
    const refreshed = await refreshMarketSnapshot(env).catch(() => null);
    if (refreshed) return refreshed;

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
    } catch {   }
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

function bootstrapAcademyStatements(env, userId) {
  return [
    env.DB.prepare("SELECT course_id, stage_id FROM progress_v3 WHERE user_id=? ORDER BY course_id, completed_at, stage_id").bind(userId),
    env.DB.prepare("SELECT skill_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at FROM skill_mastery WHERE user_id=? ORDER BY skill_id").bind(userId),
    env.DB.prepare("SELECT active_path_id, session_minutes, weekly_goal_minutes FROM learning_preferences WHERE user_id=?").bind(userId),
    env.DB.prepare("SELECT project_id, mode, done_json FROM project_progress WHERE user_id=? ORDER BY project_id").bind(userId),
  ];
}

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
  const results = snapshot.results;
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

async function currentFlowsUser(request, env) {
  const token = getCookie(request, FLOWS_COOKIE);
  if (!token || !env.SESSION_SECRET) return null;
  return verifyFlowsSession(token, env.SESSION_SECRET, sessionEpoch(env));
}

async function readFlowsForm(request) {
  const bytes = await readBounded(request, 4096, "Request body too large");
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

function flowsLoginResponse(message) {

  return new Response(FLOWS_PAGES.loginPage({ error: message }), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const FLOWS_MAX_PAYLOAD_BYTES = 128 * 1024;

function timingSafeEqualStr(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

const FLOWS_TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const DATED_ARCHIVE_KEY_RE = /^(board:(long|short)|scores):\d{4}-\d{2}-\d{2}$/;

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

const ALERT_READ_LIMIT = 60;

async function refreshFlowsIntraday(env) {
  if (!env.DB || !env.UW_API_KEY) return;
  if (!isRefreshWindow(new Date())) return;
  await ensureFlowsTables(env);

  const upsert = (key, obj) => env.DB.prepare(
    "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
  ).bind(key, JSON.stringify(obj), Date.now()).run();

  const written = { flowalerts: null, pulse: null };

  try {
    const stored = await readFlowsPayload(env, "flowalerts");
    if (stored) {
      const prev = JSON.parse(stored.payload);
      const raw = await uwFetch(env, "/api/option-trades/flow-alerts", { limit: ALERT_READ_LIMIT });

      const lastStage = new Map((prev.rows || []).map((r) => [r.t, r.st]));
      const alerts = buildFlowAlerts(raw, {
        stageOf: (t) => lastStage.get(t) || null,
        stageComplete: false,
      });

      const readAt = new Date();
      const merged = (alerts.status === "ok" && alerts.rows.length)
        ? mergeAlerts(prev, alerts, {
            at: readAt.toISOString(),
            sessionDate: easternSessionDate(readAt),
          })
        : null;
      if (merged && merged.rows.length) {

        written.flowalerts = {
          ...prev, ...merged,
          readAt: readAt.toISOString(),
          readDay: easternSessionDate(readAt),
          refreshed: "intraday",
          vendorLimit: null,
          vendorTruncated: null,
          readLimit: ALERT_READ_LIMIT,
          readTruncated: alerts.seen + alerts.unusable >= ALERT_READ_LIMIT
            || (!merged.record.reset && prev.readTruncated === true),
        };
        await upsert("flowalerts", written.flowalerts);

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

      if (tide.status === "ok") {
        const readAt = new Date();
        written.pulse = {
          ...prev, tide,
          readAt: readAt.toISOString(),
          readDay: easternSessionDate(readAt),
          refreshed: "intraday",
        };
        await upsert("pulse", written.pulse);
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "pulse tide intraday refresh failed",
      error: error instanceof Error ? error.message : String(error) }));
  }

  if (written.flowalerts || written.pulse) {
    try {
      const stored = await readFlowsPayload(env, "brief");
      if (stored) {
        const index = JSON.parse(stored.payload);
        const next = FLOWS_ASK.refreshIntradayFacts(index, written);
        const n = Object.values(next.replaced || {}).reduce((a, b) => a + b, 0);
        if (n > 0) {
          await upsert("brief", next);
          console.log(JSON.stringify({ message: "brief intraday facts refreshed",
            replaced: next.replaced, refreshedAt: next.refreshedAt }));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ message: "brief intraday refresh failed",
        error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

async function readFlowsPayload(env, key, trace) {

  if (!env.DB) { if (trace) trace.failed = true; return null; }
  await ensureFlowsTables(env);
  const row = await env.DB.prepare(
    "SELECT payload, updated_at FROM flows_payload WHERE id = ?"
  ).bind(key).first().catch(() => { if (trace) trace.failed = true; return null; });
  return row && row.payload ? { payload: row.payload, updatedAt: row.updated_at } : null;
}

function passthrough(stored) {
  return new Response(stored.payload, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Payload-Updated": String(stored.updatedAt || 0),
    },
  });
}

const askModel = (env) => aiChain(env)[0] || null;

const ASK_QUESTION_MAX = 400;

const FALLBACK_FAILED = Object.freeze({
  allowance: "found the day's free model allowance spent, which resets at 00:00 UTC",
  capacity: "had no capacity just now, and asking again shortly may work",
  plan: "is not available on this site's plan, which is a configuration fault here",
  unreachable: "could not be reached and did not say why",
});

function aiDay() {
  return new Date().toISOString().slice(0, 10);
}

async function askSpend(env) {
  if (!env.DB) return null;
  await ensureFlowsTables(env);
  const day = aiDay();
  const row = await env.DB.prepare(
    "SELECT calls, tokens_in, tokens_out FROM flows_ai_usage WHERE day = ?"
  ).bind(day).first().catch(() => null);
  const split = await env.DB.prepare(
    "SELECT model, calls, tokens_in, tokens_out FROM flows_ai_usage_model WHERE day = ? ORDER BY model"
  ).bind(day).all().catch(() => null);

  const calls = row ? Number(row.calls) || 0 : 0;
  const tokensIn = row ? Number(row.tokens_in) || 0 : 0;
  const tokensOut = row ? Number(row.tokens_out) || 0 : 0;
  const byModel = split && Array.isArray(split.results)
    ? split.results.map((r) => ({ model: String(r.model), calls: Number(r.calls) || 0,
        tokensIn: Number(r.tokens_in) || 0, tokensOut: Number(r.tokens_out) || 0 }))
    : null;
  return spendShape(env, day, calls, tokensIn, tokensOut, byModel);
}

async function askRecordSpend(env, usage, model) {
  if (!env.DB || !usage) return null;
  const day = aiDay();

  const inTok = Math.max(0, Math.round(Number(usage.prompt_tokens) || 0));
  const outTok = Math.max(0, Math.round(Number(usage.completion_tokens) || 0));
  const billed = typeof model === "string" && model ? model : "unknown";
  try {
    await ensureFlowsTables(env);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO flows_ai_usage (day, calls, tokens_in, tokens_out) VALUES (?, 1, ?, ?) " +
        "ON CONFLICT(day) DO UPDATE SET calls = calls + 1, " +
        "tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out"
      ).bind(day, inTok, outTok),
      env.DB.prepare(
        "INSERT INTO flows_ai_usage_model (day, model, calls, tokens_in, tokens_out) VALUES (?, ?, 1, ?, ?) " +
        "ON CONFLICT(day, model) DO UPDATE SET calls = calls + 1, " +
        "tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out"
      ).bind(day, billed, inTok, outTok),
    ]);
    return await askSpend(env);
  } catch { return null;   }
}

async function refreshFlowsSummary(env) {
  if (!env.DB) return;
  await ensureFlowsTables(env);

  const stored = await readFlowsPayload(env, "brief");

  if (stored === null) return;

  let index;
  try { index = JSON.parse(stored.payload); } catch { return; }
  const facts = Array.isArray(index && index.facts) ? index.facts : [];
  if (!facts.length) return;

  const signature = aiCallSignature(env);
  const fingerprint = FLOWS_ASK.summaryFingerprint(facts) + "|" + signature;
  const prior = await env.DB.prepare(
    "SELECT fingerprint, llm, guard, generated_at FROM flows_ai_summary WHERE scope = ?",
  ).bind("board").first().catch(() => null);

  if (prior && prior.fingerprint === fingerprint) {
    const priorAge = typeof prior.generated_at === "string"
      ? Date.now() - Date.parse(prior.generated_at) : Infinity;
    if (!retryableGuard(prior.guard, priorAge)) return;
  }

  const intradayOnly = typeof index.refreshedAt === "string" && index.refreshedAt !== "";
  const sameCall = prior && typeof prior.fingerprint === "string" && prior.fingerprint.endsWith("|" + signature);
  if (sameCall && (prior.llm || repliedGuard(prior.guard)) && intradayOnly && typeof prior.generated_at === "string") {
    const ageMs = Date.now() - Date.parse(prior.generated_at);
    if (Number.isFinite(ageMs) && ageMs < intradayFloorMs(prior.llm, prior.guard)) return;
  }
  const age = FLOWS_ASK.briefAge(index, new Date());

  const plain = FLOWS_ASK.renderSummaryPlain(facts);
  const write = (text, llm, model, guard) => env.DB.prepare(
    "INSERT INTO flows_ai_summary (scope, text, llm, model, fingerprint, guard, generated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET " +
    "text=excluded.text, llm=excluded.llm, model=excluded.model, " +
    "fingerprint=excluded.fingerprint, guard=excluded.guard, generated_at=excluded.generated_at",
  ).bind("board", text, llm ? 1 : 0, model, fingerprint, guard, new Date().toISOString()).run();

  const chain = aiChain(env);

  if (!env.AI || !chain.length) {
    await write(plain, false, null, null).catch(() => {});
    return;
  }

  const { system, user } = FLOWS_ASK.promptForSummary(facts, age);
  const said = await askModels(env.AI, chain,
    [{ role: "system", content: system }, { role: "user", content: user }],
    { maxTokens: 1024, temperature: 0.2 },
    (billed, usage) => askRecordSpend(env, usage, billed));

  if (!said.text) {
    await write(plain, false, said.model, said.guard).catch(() => {});
    return;
  }

  const verdict = FLOWS_ASK.guardAnswer(said.text, facts, { smallIntegers: false });
  if (!verdict.ok) {
    await write(plain, false, said.model, verdict.invented ? "invented" : "forecast").catch(() => {});
    return;
  }
  await write(said.text, true, said.model, null).catch(() => {});
}

async function readFlowsSummary(env, scope) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT text, llm, model, guard, fingerprint, generated_at FROM flows_ai_summary WHERE scope = ?",
    ).bind(scope || "board").first();
    if (!row) return null;
    return {
      text: typeof row.text === "string" ? row.text : "",

      llm: row.llm === 1,
      model: typeof row.model === "string" ? row.model : null,
      guard: typeof row.guard === "string" ? row.guard : null,
      fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : null,
      generatedAt: typeof row.generated_at === "string" ? row.generated_at : null,
    };
  } catch { return null; }
}

const NEURON_GENERATING_MS = 90 * 1000;
const NEURON_RETRY_MS = 5 * 60 * 1000;

async function readNeuron(env, scope) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT version, fingerprint, summary, ideas, llm, model, guard, generated_at FROM flows_neuron WHERE scope = ?",
    ).bind(scope).first();
    if (!row) return null;
    let ideas = [];
    try { ideas = JSON.parse(typeof row.ideas === "string" ? row.ideas : "[]"); } catch { ideas = []; }
    return {
      version: Number(row.version) || 0,
      fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : null,
      summary: typeof row.summary === "string" ? row.summary : "",
      ideas: Array.isArray(ideas) ? ideas : [],
      llm: row.llm === 1,
      model: typeof row.model === "string" ? row.model : null,
      guard: typeof row.guard === "string" ? row.guard : null,
      generatedAt: typeof row.generated_at === "string" ? row.generated_at : null,
    };
  } catch { return null; }
}

async function markNeuronGenerating(env, scope, fingerprint, model) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - NEURON_GENERATING_MS).toISOString();
  try {
    const res = await env.DB.prepare(
      "INSERT INTO flows_neuron (scope, version, fingerprint, summary, ideas, llm, model, guard, generated_at) " +
      "VALUES (?, ?, ?, '', '[]', 0, ?, 'generating', ?) ON CONFLICT(scope) DO UPDATE SET " +
      "version=excluded.version, fingerprint=excluded.fingerprint, summary='', ideas='[]', llm=0, " +
      "model=excluded.model, guard='generating', generated_at=excluded.generated_at " +
      "WHERE flows_neuron.guard IS NOT 'generating' OR flows_neuron.fingerprint != excluded.fingerprint " +
      "OR flows_neuron.generated_at < ?",
    ).bind(scope, FLOWS_NEURON.NEURON_CONTEXT_VERSION, fingerprint, model, now.toISOString(), cutoff).run();
    return !(res && res.meta && typeof res.meta.changes === "number") || res.meta.changes > 0;
  } catch {
    return true;
  }
}

async function writeNeuron(env, scope, fingerprint, summary, ideas, llm, model, guard) {
  return env.DB.prepare(
    "INSERT INTO flows_neuron (scope, version, fingerprint, summary, ideas, llm, model, guard, generated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET " +
    "version=excluded.version, fingerprint=excluded.fingerprint, summary=excluded.summary, " +
    "ideas=excluded.ideas, llm=excluded.llm, model=excluded.model, guard=excluded.guard, " +
    "generated_at=excluded.generated_at",
  ).bind(scope, FLOWS_NEURON.NEURON_CONTEXT_VERSION, fingerprint, summary, JSON.stringify(ideas || []),
    llm ? 1 : 0, model, guard, new Date().toISOString()).run();
}

function ideaProvenance(r) {
  const ideas = Array.isArray(r.ideas) ? r.ideas : [];
  const own = ideas.filter((i) => i && i.fromState === true).length;
  const model = ideas.length - own;
  if (!ideas.length) return "";
  if (model === 0) return " The idea is the implied state\u2019s own, computed from the card; no model wrote it.";
  return (own ? " The first idea is the implied state\u2019s own, computed from the card." : "") +
    (r.llm !== true && r.model ? (own ? " The other ideas" : " The ideas") + " were written by " + modelName(r.model) + " and vetted one by one." : "");
}

function neuronShape(status, ticker, ctx, row, extra) {
  const r = row && typeof row === "object" ? row : null;
  const text = r !== null && r.summary ? r.summary : null;
  return {
    status, scope: ticker,
    summary: text,
    ideas: r !== null && Array.isArray(r.ideas) ? r.ideas : [],
    context: ctx ? FLOWS_NEURON.publicContext(ctx) : null,
    llm: r !== null ? r.llm === true : false,
    model: r !== null ? r.model : null,
    guard: r !== null ? r.guard : null,
    generatedAt: r !== null ? r.generatedAt : null,
    provenance: text ? neuronProvenance({ text, llm: r.llm === true, model: r.model,
      guard: r.guard && /^ideas:\d+ refused$/.test(r.guard) ? null : r.guard }) + ideaProvenance(r) : null,
    ...(extra || {}),
  };
}

function neuronContextFor(card) {
  const age = FLOWS_ASK.briefAge({ sessionDate: card.sessionDate }, new Date());
  return FLOWS_NEURON.buildContext(card, { expectedSession: age.expected });
}

async function generateNeuron(env, ticker, ctx, fingerprint) {
  const scope = "ticker:" + ticker;
  const chain = aiChain(env);
  const plain = FLOWS_NEURON.deterministicSummary(ctx);
  const stateIdea = FLOWS_NEURON.stateIdea(ctx);
  const own = FLOWS_NEURON.vetIdeas(stateIdea ? [stateIdea] : [], ctx).ideas;
  if (!env.AI || !chain.length) {
    await writeNeuron(env, scope, fingerprint, plain, own, false, null, null).catch(() => {});
    return;
  }
  const { system, user } = FLOWS_NEURON.promptForNeuron(ctx);
  const facts = FLOWS_NEURON.guardFacts(ctx);
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  let parsed = null;
  let lastText = null;
  let model = chain[0];
  let refused = null;
  for (let attempt = 0; attempt < 2 && (parsed === null || parsed.summary === null); attempt++) {
    const said = await askModels(env.AI, attempt === 0 ? chain : [model], messages,
      { maxTokens: 1400, temperature: attempt === 0 ? 0.2 : 0.05 },
      (billed, usage) => askRecordSpend(env, usage, billed));
    if (!said.text) {
      if (attempt > 0) {
        if (said.failure) refused = "unreachable:reparse:" + said.failure.why;
        break;
      }
      await writeNeuron(env, scope, fingerprint, plain, own, false, said.model, said.guard).catch(() => {});
      return;
    }
    model = said.model;
    lastText = said.text;
    parsed = FLOWS_NEURON.parseNeuronOutput(said.text);
  }
  if (parsed === null) {
    const prose = typeof lastText === "string" && !/[{}[\]]|"summary"|"ideas"/.test(lastText);
    const verdict = prose ? FLOWS_ASK.guardAnswer(lastText, facts, { smallIntegers: false }) : { ok: false };
    await writeNeuron(env, scope, fingerprint, verdict.ok ? lastText : plain, own, verdict.ok, model,
      verdict.ok ? "ideas:unparsable" : refused || "ideas:unparsable").catch(() => {});
    return;
  }
  let summary = plain;
  let llm = false;
  let guard = null;
  if (parsed.summary) {
    const verdict = FLOWS_ASK.guardAnswer(parsed.summary, facts, { smallIntegers: false });
    if (verdict.ok) { summary = parsed.summary; llm = true; }
    else guard = verdict.invented ? "invented" : "forecast";
  } else {
    guard = refused || "summary:empty";
  }
  const vetted = FLOWS_NEURON.vetIdeas((stateIdea ? [stateIdea] : []).concat(parsed.ideas), ctx);
  if (guard === null && vetted.refused.length) guard = "ideas:" + vetted.refused.length + " refused";
  await writeNeuron(env, scope, fingerprint, summary, vetted.ideas, llm, model, guard).catch(() => {});
}

async function tickerNeuron(env, ctx, ticker) {
  const scope = "ticker:" + ticker;
  if (!env.DB) {
    return json(neuronShape("unavailable", ticker, null, null,
      { note: "No store is bound to this route, so no reading can be read or written." }));
  }
  const stored = await readFlowsPayload(env, "card:" + ticker);
  if (stored === null) {
    return json(neuronShape("pending", ticker, null, null,
      { note: "No card has been published for " + ticker + " this session, so there is " +
        "nothing to read yet." }));
  }
  let card;
  try { card = JSON.parse(stored.payload); } catch {
    return json(neuronShape("unreadable", ticker, null, null,
      { note: "The card for " + ticker + " was published and could not be read, which is " +
        "a fault on this side rather than a fact about the name." }));
  }
  if (!card || typeof card !== "object" || card.status === "pending" || !card.panels) {
    return json(neuronShape("pending", ticker, null, null,
      { note: "The card for " + ticker + " has not landed yet." }));
  }
  const context = neuronContextFor(card);
  if (!context.coverage.read) {
    return json(neuronShape("quiet", ticker, context, null,
      { note: "The card for " + ticker + " publishes no feature with a reading this session, " +
        "which is a fact about the card and not about the name." }));
  }
  const fingerprint = FLOWS_NEURON.contextFingerprint(context) + "|" + aiCallSignature(env);
  const prior = await readNeuron(env, scope);
  const now = Date.now();
  const priorAge = prior && prior.generatedAt ? now - Date.parse(prior.generatedAt) : Infinity;

  if (prior && prior.fingerprint === fingerprint && prior.version === FLOWS_NEURON.NEURON_CONTEXT_VERSION) {
    if (prior.guard === "generating") {
      if (priorAge < NEURON_GENERATING_MS) {
        return json(neuronShape("pending", ticker, context, null,
          { note: "Neuron is reading this card now." }));
      }
    } else if (prior.summary) {
      const retryable = retryableGuard(prior.guard, priorAge) && priorAge > NEURON_RETRY_MS;
      if (!retryable) return json(neuronShape("ok", ticker, context, prior));
    }
  }

  const mine = await markNeuronGenerating(env, scope, fingerprint, askModel(env));
  if (!mine) {
    return json(neuronShape("pending", ticker, context, null, { note: "Neuron is reading this card now." }));
  }
  const work = generateNeuron(env, ticker, context, fingerprint).catch((error) => {
    console.error(JSON.stringify({ message: "neuron failed", ticker,
      error: error instanceof Error ? error.message : String(error) }));
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work); else await work;
  return json(neuronShape("pending", ticker, context, null,
    { note: "Neuron is reading this card now." }));
}

function askSubject(body) {
  const raw = body && typeof body.subject === "string" ? body.subject.trim().toUpperCase() : "";
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(raw) ? raw : null;
}

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
  return { question: raw.slice(0, ASK_QUESTION_MAX), subject: askSubject(body) };
}

async function askAnswer(question, env, index, updatedAt, subject) {

  let pool = index;
  let neuronFacts = 0;
  if (subject !== null) {
    const stored = await readFlowsPayload(env, "card:" + subject);
    if (stored !== null) {
      let card = null;
      try { card = JSON.parse(stored.payload); } catch { card = null; }
      if (card && typeof card === "object" && card.panels) {
        const extra = FLOWS_NEURON.contextFacts(neuronContextFor(card));
        if (extra.length) {
          pool = { ...index, facts: (Array.isArray(index.facts) ? index.facts : []).concat(extra) };
          neuronFacts = extra.length;
        }
      }
    }
  }
  const sel = FLOWS_ASK.selectFacts(pool, question,
    subject === null ? undefined : { subject: { tickers: [subject] } });
  const { picked, why, withheld, capped } = sel;

  const framed = sel.subjectApplied && subject ? question + " " + subject : question;

  const plain = FLOWS_ASK.renderFactsPlain(picked, framed);

  const age = FLOWS_ASK.briefAge(index, new Date());

  const spend = await askSpend(env);
  const base = {
    answer: plain, llm: false, guard: null, why, capped,

    withheld: withheld || null,

    subject: sel.subjectApplied && subject ? subject : null,
    subjectApplied: sel.subjectApplied === true,
    neuronFacts,
    facts: picked, silences: index.silences || null,
    briefUpdatedAt: updatedAt || null, model: null, note: null, spend,
    session: age,
  };

  const chain = aiChain(env);
  if (!env.AI || !chain.length) {
    return json({ ...base,
      note: "No model is configured for this site, so this reading is the " +
        "pipeline's own wording. Every figure in it was measured." });
  }

  const { system, user } = FLOWS_ASK.promptFor(picked, framed, age);
  let afterCall = null;
  const said = await askModels(env.AI, chain,
    [{ role: "system", content: system }, { role: "user", content: user }],
    { maxTokens: 1024, temperature: 0.2 },
    async (billed, usage) => { afterCall = (await askRecordSpend(env, usage, billed)) || afterCall; });
  const model = said.model;
  const fallback = fallbackNote(said);

  if (said.failure) {
    const failed = said.failure;
    const first = said.attempts[0];
    const afterEmpty = said.attempts.length > 1 && first && first.failed === null;
    const told = afterEmpty
      ? emptyNote(said.attempts) +
        ", and the fallback model asked after it " + FALLBACK_FAILED[failed.why] +
        ", so this reading is the pipeline's own wording. Every figure in it was measured."
      : failed.say;

    const meter = afterCall || base.spend;
    const disagrees = failed.why === "allowance"
      && meter !== null && typeof meter.remaining === "number" && meter.remaining > 0;
    const say = disagrees
      ? told + " The meter on this page still showed " + grouped(meter.remaining) +
        " of " + grouped(meter.allowanceNeurons) + " model credits unspent, which means something " +
        "other than this site drew on the same account today. Cloudflare is the " +
        "authority and the meter is not: it can only ever see this site's own calls."
      : told;
    return json({ ...base, spend: meter, note: say, model, llmFailure: failed.why,
      spendDisagrees: disagrees });
  }

  const generated = said.text;
  if (!generated) {
    return json({ ...base, spend: afterCall || base.spend, model,
      note: emptyNote(said.attempts) +
        ", so this reading is the pipeline's own wording. Every figure in it was measured." });
  }

  const guard = FLOWS_ASK.guardAnswer(generated, picked);
  if (!guard.ok) {

    return json({ ...base, spend: afterCall || base.spend, model, fallback, guard,

      note: "The generated wording was discarded: " +
        (guard.forecast
          ? "it claimed what the market is going to do, and this page states what was " +
            "measured and what is already on the calendar."
          : "it stated a figure that appears in none of the measurements it was given, " +
            "which means it was computed rather than quoted.") +
        " What follows is the pipeline's own wording, and every figure in it was measured." });
  }
  return json({ ...base, spend: afterCall || base.spend,
    answer: generated, llm: true, model, fallback, guard });
}

const UW_BASE_DEFAULT = "https://api.unusualwhales.com";

const CHAIN_TTL_SECONDS = 120;

const CHAIN_PAGE_SIZE = 500;

const INFO_TTL_SECONDS = 6 * 3600;

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

  try {
    return await response.json();
  } catch {
    throw new HttpError(502, "chain_upstream", "Market data provider returned malformed data");
  }
}

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

  const d = raw && !Array.isArray(raw) && raw.data ? raw.data : raw;
  if (!d || typeof d !== "object") return null;
  const out = {
    nextEarningsDate: typeof d.next_earnings_date === "string" ? d.next_earnings_date : null,
    announceTime: typeof d.announce_time === "string" ? d.announce_time : null,

    issueType: typeof d.issue_type === "string" ? d.issue_type : null,

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

const LIVE_TTL_SECONDS = 5;

async function buildLivePayload(env, ticker) {
  const t = encodeURIComponent(ticker);
  const raw = await uwFetch(env, `/api/stock/${t}/stock-state`, {});
  const d = raw && !Array.isArray(raw) && raw.data ? raw.data : raw;
  const live = d && typeof d === "object" && !Array.isArray(d) ? d : null;
  const readAt = new Date().toISOString();
  if (live === null) {
    return { ticker, status: "unreadable", readAt, price: null, prevClose: null,
      changePct: null, open: null, high: null, low: null, volume: null,
      marketTime: null, tapeTime: null };
  }
  const price = numOrNull(live.close);
  const prevClose = numOrNull(live.prev_close);
  const changePct = price !== null && prevClose !== null && prevClose > 0
    ? price / prevClose - 1 : null;
  return {
    ticker,
    status: price !== null && price > 0 ? "ok" : "quiet",
    readAt,
    price, prevClose, changePct,
    open: numOrNull(live.open), high: numOrNull(live.high), low: numOrNull(live.low),
    volume: numOrNull(live.volume ?? live.total_volume),
    marketTime: live.market_time ? String(live.market_time) : null,
    tapeTime: live.tape_time ? String(live.tape_time) : null,
  };
}

async function serveCachedVendorRead({ ctx, cacheKey, wantsRefresh, build, ttlSeconds }) {
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : CHAIN_TTL_SECONDS;
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;

  const hit = cache ? await cache.match(cacheKey) : null;
  const storedAt = hit ? Number(hit.headers.get("X-Chain-Stored")) : NaN;
  const ageSeconds = Number.isFinite(storedAt) ? (Date.now() / 1000) - storedAt : Infinity;

  const serveCached = hit && (wantsRefresh ? ageSeconds < CHAIN_REFRESH_FLOOR_SECONDS : true);
  if (serveCached) {
    const out = new Response(hit.body, hit);
    out.headers.set("X-Chain-Cache", wantsRefresh ? "throttled" : "hit");
    out.headers.set("X-Chain-Age", String(Math.max(0, Math.round(ageSeconds))));

    out.headers.set("Cache-Control", "no-store");
    return out;
  }

  const payload = await build();
  const body = JSON.stringify(payload);

  if (cache) {
    const store = new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `max-age=${ttl}`,
        "X-Chain-Stored": String(Math.floor(Date.now() / 1000)),
      },
    });

    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cache.put(cacheKey, store));
    else await cache.put(cacheKey, store);
  }

  return json(payload, 200, { "Cache-Control": "no-store", "X-Chain-Cache": "miss", "X-Chain-Age": "0" });
}

async function buildChainPayload(env, ctx, { ticker, strategy, rankBy, limit }) {
  const t = encodeURIComponent(ticker);
  const chainPage = (page) => uwFetch(env, `/api/stock/${t}/option-contracts`, {

    maybe_otm_only: "true",
    exclude_zero_oi_chains: "true",
    limit: CHAIN_PAGE_SIZE,
    ...(page > 1 ? { page } : {}),
  });

  const [firstPage, candles, state, info] = await Promise.all([
    chainPage(1),
    uwFetch(env, `/api/stock/${t}/ohlc/1d`, { timeframe: "5D" }),

    uwFetch(env, `/api/stock/${t}/stock-state`, {}).catch(() => null),

    cachedTickerInfo(env, ctx, ticker),
  ]);

  const unwrap = (r) => (Array.isArray(r) ? r : (r && r.data) || []);
  const rows = unwrap(firstPage);
  const bars = unwrap(candles);
  if (!rows.length) throw new HttpError(404, "chain_empty", "No listed options found for that symbol");

  let truncated = false;
  if (rows.length >= CHAIN_PAGE_SIZE) {
    const second = unwrap(await chainPage(2).catch(() => []));
    for (const r of second) rows.push(r);

    truncated = second.length >= CHAIN_PAGE_SIZE;
  }

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

  const spot = useLive ? liveClose : dailyClose;
  const spotSource = useLive ? "stock-state" : "daily-close";
  if (!(spot > 0)) throw new HttpError(502, "chain_no_spot", "No usable price for that symbol");

  const tapeTime = live && live.tape_time ? String(live.tape_time) : null;
  const tapeDay = tapeTime && /^\d{4}-\d{2}-\d{2}/.test(tapeTime) ? tapeTime.slice(0, 10) : null;
  const asOf = tapeDay || dailyDate;
  if (!asOf) throw new HttpError(502, "chain_no_spot", "No usable session date for that symbol");

  const ranked = rankChain(rows, { spot, asOf, strategy, rankBy, limit, ticker });

  const earnDate = info ? info.nextEarningsDate : null;
  for (const row of ranked.rows) {
    row.crossesEarnings = info ? crossesEarnings(row.expiry, earnDate, info.announceTime) : null;
  }
  return {
    ticker, spot, asOf,
    spotSource,

    marketTime: live && live.market_time ? String(live.market_time) : null,
    tapeTime,
    prevClose: live && Number(live.prev_close) > 0 ? Number(live.prev_close) : dailyClose,
    strategy, ...ranked,

    truncated,
    pageSize: CHAIN_PAGE_SIZE,

    earnings: info
      ? { date: earnDate, announceTime: info.announceTime, issueType: info.issueType }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

const STRATEGY_INDEX = "SPY";

const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}$/;

const STRATEGY_PAGES_PER_TYPE = 2;

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

const unwrapRows = (r) => (Array.isArray(r) ? r : (r && r.data) || []);

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

  if (!(spot > 0)) throw new HttpError(502, "chain_no_spot", "No usable price for that symbol");

  const tapeTime = live && live.tape_time ? String(live.tape_time) : null;
  const tapeDay = tapeTime && /^\d{4}-\d{2}-\d{2}/.test(tapeTime) ? tapeTime.slice(0, 10) : null;

  const asOf = tapeDay || dailyDate;
  if (!asOf) throw new HttpError(502, "chain_no_spot", "No usable session date for that symbol");

  const readExpiries = (raw) => {
    const out = [];
    for (const row of unwrapRows(raw)) {
      const expiry = row && typeof row.expiry === "string" ? row.expiry.slice(0, 10) : null;
      if (!expiry || !EXPIRY_RE.test(expiry)) continue;
      out.push({
        expiry,
        chains: numOrNull(row.chains),
        oi: numOrNull(row.open_interest),
        volume: numOrNull(row.volume),
      });
    }
    out.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
    return out;
  };

  let expiries = readExpiries(breakdown);

  let expiryDate = null;
  if (breakdown !== null && !expiries.length && asOf) {
    const retry = await uwFetch(env, `/api/stock/${t}/expiry-breakdown`, { date: asOf })
      .catch(() => null);
    if (retry !== null) {
      const dated = readExpiries(retry);
      if (dated.length) { expiries = dated; expiryDate = asOf; }
    }
  }

  let expirySource = "breakdown";
  if (breakdown !== null && !expiries.length && asOf) {
    const exposure = await uwFetch(env, `/api/stock/${t}/greek-exposure/expiry`, {})
      .catch(() => null);
    if (exposure !== null) {
      const listed = readExpiries(exposure)
        .filter((e) => e.expiry >= asOf)
        .map((e) => ({ expiry: e.expiry, chains: null, oi: null, volume: null }));
      if (listed.length) { expiries = listed; expirySource = "exposure"; }
    }
  }

  const index = await cachedIndexSpot(env, ctx);

  return {
    mode: "context",
    ticker, spot, asOf,
    spotSource: useLive ? "stock-state" : "daily-close",
    marketTime: live && live.market_time ? String(live.market_time) : null,
    tapeTime,
    prevClose: numOrNull(live && live.prev_close) ?? dailyClose,

    expiries,
    expiryStatus: breakdown === null ? "unreadable" : (expiries.length ? "ok" : "quiet"),

    expiryDate,

    expirySource,

    beta: info && Number.isFinite(info.beta) ? info.beta : null,

    index,
    earnings: info
      ? { date: info.nextEarningsDate, announceTime: info.announceTime, issueType: info.issueType }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

async function buildStrategyExpiry(env, ticker, expiry) {
  const t = encodeURIComponent(ticker);
  const page = (optionType, n) => uwFetch(env, `/api/stock/${t}/option-contracts`, {

    expiry,
    option_type: optionType,
    limit: CHAIN_PAGE_SIZE,
    ...(n > 1 ? { page: n } : {}),
  });

  const [callsFirst, putsFirst] = await Promise.all([page("call", 1), page("put", 1)]);

  const gather = async (optionType, first) => {
    const rows = unwrapRows(first);
    let truncated = false;
    if (rows.length >= CHAIN_PAGE_SIZE) {
      for (let n = 2; n <= STRATEGY_PAGES_PER_TYPE; n++) {
        const next = unwrapRows(await page(optionType, n).catch(() => []));
        for (const r of next) rows.push(r);

        truncated = next.length >= CHAIN_PAGE_SIZE;
        if (!truncated) break;
      }
    }
    return { rows, truncated };
  };

  const calls = await gather("call", callsFirst);
  const puts = await gather("put", putsFirst);

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

      if (!parsed) continue;

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

    callsTruncated: calls.truncated,
    putsTruncated: puts.truncated,
    pageSize: CHAIN_PAGE_SIZE,
    pagesPerType: STRATEGY_PAGES_PER_TYPE,
    ivBasis: iv.basis,

    missingGreeks,

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
  } catch {   }
}

function flowsThrottleKey(request, username) {
  if (!FLOWS_USERNAMES.includes(username)) return null;

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

  if (!username || !env.DB) return;
  await ensureFlowsTables(env);
  const next = nextFailureState(previous);
  try {
    await env.DB.prepare(
      "INSERT INTO flows_login_failures (username, failures, first_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(username) DO UPDATE SET failures = excluded.failures, first_at = excluded.first_at"
    ).bind(username, next.failures, next.first_at).run();
  } catch {   }
}

async function clearFlowsFailures(env, username) {
  if (!username || !env.DB) return;
  try {
    await env.DB.prepare("DELETE FROM flows_login_failures WHERE username = ?").bind(username).run();
  } catch {   }
}

async function currentUser(request, env) {
  const token = getCookie(request, "session");
  if (!token || !env.SESSION_SECRET) return null;
  const payload = await verifySession(token, env.SESSION_SECRET);

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

  if (path === "/flows") {
    requireMethod(request, ["GET", "HEAD"]);
    return redirect(new URL("/flows/", url).toString(), 308);
  }

  if (path === "/flows/login") {
    requireMethod(request, ["POST"]);
    requireSameOrigin(request);
    if (!env.SESSION_SECRET) throw new HttpError(503, "unavailable", "Sign-in is not configured");

    const credentials = parseCredentials(env.FLOWS_CREDENTIALS);

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

  const FLOWS_READER_FROM = {
    "/flows/": "overview",
    "/flows/long/": "long",
    "/flows/short/": "short",
    "/flows/watch/": "watch",
  };
  if (Object.hasOwn(FLOWS_READER_FROM, path) && url.searchParams.has("t")) {
    const wanted = (url.searchParams.get("t") || "").trim();
    if (wanted) {
      requireMethod(request, ["GET", "HEAD"]);
      return redirect(new URL(
        "/flows/ticker/?t=" + encodeURIComponent(wanted) +
        "&s=signal&from=" + FLOWS_READER_FROM[path], url).toString(), 302);
    }
  }

  const FLOWS_ROUTES = {
    "/flows/": (u, summary) => FLOWS_PAGES.overviewPage({ username: u, summary }),
    "/flows/long/": (u) => FLOWS_PAGES.sidePage({ username: u, side: "long" }),
    "/flows/short/": (u) => FLOWS_PAGES.sidePage({ username: u, side: "short" }),
    "/flows/watch/": (u) => FLOWS_PAGES.watchPage({ username: u }),
    "/flows/market/": (u) => FLOWS_PAGES.marketPage({ username: u }),
    "/flows/history/": (u) => FLOWS_PAGES.historyPage({ username: u }),
    "/flows/desk/": (u) => FLOWS_PAGES.deskPage({ username: u }),

    "/flows/strategy/": (u) => FLOWS_PAGES.strategyPage({ username: u }),
    "/flows/ask/": (u) => FLOWS_PAGES.askPage({ username: u }),

    "/flows/ticker/": (u) => FLOWS_PAGES.tickerPage({ username: u }),
    "/flows/unusual/": (u) => FLOWS_PAGES.unusualPage({ username: u }),
    "/flows/events/": (u) => FLOWS_PAGES.eventsPage({ username: u }),
    "/flows/track/": (u) => FLOWS_PAGES.trackPage({ username: u }),

    "/flows/political/": (u) => FLOWS_PAGES.politicalPage({ username: u }),
  };
  if (Object.hasOwn(FLOWS_ROUTES, path)) {
    requireMethod(request, ["GET", "HEAD"]);
    const session = await currentFlowsUser(request, env);

    const summary = session && path === "/flows/"
      ? await readFlowsSummary(env, "board")
      : null;
    const body = session
      ? FLOWS_ROUTES[path](session.username, summary)
      : FLOWS_PAGES.loginPage();
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

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

    requireMethod(request, ["GET", "POST", "DELETE"]);
    if (!env.FLOWS_INGEST_TOKEN) throw new HttpError(503, "unavailable", "Ingest is not configured");

    const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

    if (!offered || !timingSafeEqualStr(offered, env.FLOWS_INGEST_TOKEN)) {
      throw new HttpError(401, "unauthorized", "Authentication required");
    }

    const key = url.searchParams.get("key") || "";

    const card = key.startsWith("card:") ? key.slice(5) : null;
    const cardX = key.startsWith("card-x:") ? key.slice(7) : null;

    const validKey = card !== null
      ? FLOWS_TICKER_RE.test(card)
      : cardX !== null
        ? FLOWS_TICKER_RE.test(cardX)

        : /^board:(long|short|watch)$|^board:(long|short):\d{4}-\d{2}-\d{2}$|^scores:\d{4}-\d{2}-\d{2}$|^scoretrack$|^flowalerts$|^pulse$|^political$|^record$|^movers$|^market$|^unusual$|^events$|^sector:trix$|^sector:premium$|^news$|^brief$|^meta$|^regime$/.test(key);
    if (!validKey) {
      throw new HttpError(400, "invalid_key", "Unknown payload key");
    }

    if (request.method === "GET") {
      const stored = await readFlowsPayload(env, key);
      if (!stored) return json({ key, status: "pending" });
      return passthrough(stored);
    }

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

    try { JSON.parse(payload); }
    catch { throw new HttpError(400, "invalid_payload", "Payload is not valid JSON"); }

    await ensureFlowsTables(env);

    if (DATED_ARCHIVE_KEY_RE.test(key)) {
      const trace = {};
      const existing = await readFlowsPayload(env, key, trace);
      const action = archiveWriteAction({
        readable: !trace.failed,
        exists: !!existing,
        same: !!existing && existing.payload === payload,
      });
      if (action === "unchanged") {

        return json({ ok: true, key, bytes: payload.length, stored: "unchanged" });
      }
      if (action !== "write") {
        const refusal = ARCHIVE_REFUSALS[action];
        throw new HttpError(refusal.status, refusal.code, refusal.message);
      }

      const written = await env.DB.prepare(
        "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(id) DO NOTHING"
      ).bind(key, payload, Date.now()).run();
      const rows = written && written.meta ? Number(written.meta.changes) || 0 : 0;
      if (!rows) {
        const refusal = ARCHIVE_REFUSALS.refuse_raced;
        throw new HttpError(refusal.status, refusal.code, refusal.message);
      }
      return json({ ok: true, key, bytes: payload.length, stored: "created" });
    }

    await env.DB.prepare(
      "INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at"
    ).bind(key, payload, Date.now()).run();

    return json({ ok: true, key, bytes: payload.length });
  }

  if (path.startsWith("/api/flows/")) {

    requireMethod(request, path === "/api/flows/ask" ? ["POST"] : ["GET"]);
    const session = await currentFlowsUser(request, env);
    if (!session) throw new HttpError(401, "unauthorized", "Authentication required");

    if (path === "/api/flows/board") {

      const raw = url.searchParams.get("side");
      const side = raw === "short" || raw === "watch" ? raw : "long";

      const trace = {};
      const stored = await readFlowsPayload(env, "board:" + side, trace);
      if (stored === null) {
        return json(trace.failed
          ? { side, rows: [], generatedAt: null, status: "pending", reason: "read-failed" }
          : { side, rows: [], generatedAt: null, status: "pending" });
      }
      return passthrough(stored);
    }

    if (path === "/api/flows/market") {

      const stored = await readFlowsPayload(env, "market");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/events") {

      const stored = await readFlowsPayload(env, "events");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/scoretrack") {

      const stored = await readFlowsPayload(env, "scoretrack");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/meta") {

      const stored = await readFlowsPayload(env, "meta");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/flowalerts") {

      const stored = await readFlowsPayload(env, "flowalerts");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/pulse") {

      const stored = await readFlowsPayload(env, "pulse");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/political") {

      const stored = await readFlowsPayload(env, "political");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/unusual") {

      const stored = await readFlowsPayload(env, "unusual");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/movers" || path === "/api/flows/sectors") {

      const key = path.endsWith("/movers") ? "movers" : "sector:trix";
      const stored = await readFlowsPayload(env, key);
      if (stored === null) return json({ status: "pending", rows: [] });
      return passthrough(stored);
    }

    if (path === "/api/flows/sector-premium") {

      const stored = await readFlowsPayload(env, "sector:premium");
      if (stored === null) return json({ status: "pending", sectors: [] });
      return passthrough(stored);
    }

    if (path === "/api/flows/news") {

      const stored = await readFlowsPayload(env, "news");
      if (stored === null) return json({ status: "pending", rows: [] });
      return passthrough(stored);
    }

    if (path === "/api/flows/ai-usage") {

      return json({ spend: await askSpend(env) });
    }

    if (path === "/api/flows/summary") {
      const subject = String(url.searchParams.get("t") || "").trim().toUpperCase();
      if (subject !== "") {
        if (!FLOWS_TICKER_RE.test(subject)) {
          throw new HttpError(400, "invalid_ticker", "Unknown ticker");
        }
        return tickerNeuron(env, ctx, subject);
      }

      const summary = await readFlowsSummary(env, "board");
      if (summary === null) {
        return json({ status: "pending", scope: "board", summary: null, llm: false, model: null,
          guard: null, generatedAt: null, provenance: null,
          note: "No summary has been generated for this session yet. Nothing is claimed " +
            "about the market by that — it says the briefing has not been published, " +
            "not that the session was quiet." });
      }
      return json({ status: "ok", scope: "board", summary: summary.text, llm: summary.llm,
        model: summary.model, guard: summary.guard, generatedAt: summary.generatedAt,
        provenance: neuronProvenance(summary) });
    }

    if (path === "/api/flows/live") {
      const ticker = String(url.searchParams.get("t") || "").trim().toUpperCase();
      if (!FLOWS_TICKER_RE.test(ticker)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }
      try {
        return await serveCachedVendorRead({
          ctx,
          cacheKey: new Request(`https://flows-live.internal/${ticker}`, { method: "GET" }),
          wantsRefresh: false,
          ttlSeconds: LIVE_TTL_SECONDS,
          build: () => buildLivePayload(env, ticker),
        });
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        return json({ ticker, status: "unavailable", why: error.code,
          readAt: new Date().toISOString(), price: null, prevClose: null, changePct: null,
          open: null, high: null, low: null, volume: null, marketTime: null, tapeTime: null },
        200, { "Cache-Control": "no-store" });
      }
    }

    if (path === "/api/flows/brief") {

      const stored = await readFlowsPayload(env, "brief");
      if (stored === null) {
        return json({ status: "pending", today: null, yesterday: null, next: null,
          facts: [], silences: { pending: [], unreadable: [], quiet: [], unavailable: [] } });
      }
      let index = null;
      try { index = JSON.parse(stored.payload); } catch { index = null; }
      if (!index || typeof index !== "object" || Array.isArray(index)) return passthrough(stored);
      return json({ ...index, session: FLOWS_ASK.briefAge(index, new Date()) }, 200,
        { "X-Payload-Updated": String(stored.updatedAt || 0) });
    }

    if (path === "/api/flows/ask") {

      const { question: asked, subject: onPage } = await askQuestion(request);

      const trace = {};
      const stored = await readFlowsPayload(env, "brief", trace);

      if (stored === null) {
        return json({ status: trace.failed ? "unreadable" : "pending", question: asked,
          answer: null, llm: false, facts: [], guard: null, model: null,
          spend: await askSpend(env),
          note: trace.failed
            ? "The briefing could not be read from the store, so no answer is offered. " +
              "That is a fault on this site rather than a fact about the session."
            : "The briefing has not been published for this session yet, so there is " +
              "nothing measured to answer from. Nothing is claimed about the market by that." });
      }
      let index;
      try {
        index = JSON.parse(stored.payload);
      } catch {

        throw new HttpError(500, "brief_unreadable",
          "The briefing was published and could not be read, so no answer is offered. " +
          "That is a fault on this site rather than a fact about the session.");
      }
      return askAnswer(asked, env, index, stored.updatedAt, onPage);
    }

    if (path === "/api/flows/record") {

      const stored = await readFlowsPayload(env, "record");
      if (stored === null) {
        return json({ status: "pending", horizons: [], sessions: 0 });
      }
      return passthrough(stored);
    }

    if (path === "/api/flows/card") {

      const ticker = String(url.searchParams.get("t") || "").trim().toUpperCase();
      if (!FLOWS_TICKER_RE.test(ticker)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }
      const stored = await readFlowsPayload(env, "card:" + ticker);
      if (stored === null) {

        return json({ ticker, status: "pending" });
      }
      return passthrough(stored);
    }

    if (path === "/api/flows/card-x") {
      const ticker = String(url.searchParams.get("t") || "").trim().toUpperCase();
      if (!FLOWS_TICKER_RE.test(ticker)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }
      const stored = await readFlowsPayload(env, "card-x:" + ticker);
      if (stored === null) return json({ ticker, status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/regime") {
      const stored = await readFlowsPayload(env, "regime");
      if (stored === null) return json({ status: "pending" });
      return passthrough(stored);
    }

    if (path === "/api/flows/chain") {
      const ticker = String(url.searchParams.get("t") || "").trim().toUpperCase();
      if (!FLOWS_TICKER_RE.test(ticker)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }

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

      const ticker = String(url.searchParams.get("t") || "").trim().toUpperCase();
      if (!FLOWS_TICKER_RE.test(ticker)) {
        throw new HttpError(400, "invalid_ticker", "Unknown ticker");
      }
      const rawExpiry = url.searchParams.get("expiry");

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

    return renderCourse(request, env, url, meta, ctx);
  }

  return env.ASSETS.fetch(request);
}

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

    const publicMarkets = url.pathname === "/api/markets" && cacheableMethod && out.status === 200;
    if (!publicMarkets) out.headers.set("Cache-Control", "no-store");
  } else if (contentType.includes("text/html")) {

    out.headers.set("Cache-Control", "no-cache");
  } else if (cacheableStatus && cacheableMethod && url.searchParams.has("v") && url.pathname.startsWith("/assets/")) {

    out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (cacheableStatus && cacheableMethod && contentType && !contentType.includes("application/json")) {
    out.headers.set("Cache-Control", "public, max-age=3600");
  }
  return out;
}

export default {

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshMarketSnapshotIfDue(env).catch((error) => {
      console.error(JSON.stringify({
        message: "market refresh failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }));

    ctx.waitUntil(refreshFlowsIntraday(env).catch((error) => {
      console.error(JSON.stringify({
        message: "flows intraday refresh failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }));

    ctx.waitUntil(refreshFlowsSummary(env).catch((error) => {
      console.error(JSON.stringify({
        message: "flows summary refresh failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
