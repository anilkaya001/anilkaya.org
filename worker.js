import { signSession, verifySession, getCookie, cookie } from "./shared/session.js";
import {
  FLOWS_COOKIE, FLOWS_SESSION_TTL_SECONDS, LEARN_AUDIENCE, THROTTLE_SHARED_BUCKET,
  parseCredentials, readMembers, memberOf, throttleBucket, throttleAddress, loginNameKey, staleFailureCutoff, verifyCredential,
  signFlowsSession, verifyFlowsSession, isLearnAudience, isLocked, nextFailureState, sessionEpoch,
} from "./shared/flows-auth.js";
import { FLOWS_PAGES, modelName, neuronProvenance } from "./shared/flows-pages.js";
import * as FLOWS_ASK from "./shared/flows-ask.js";
import * as FLOWS_NEURON from "./shared/flows-neuron.js";
import * as FLOWS_SCREEN from "./shared/flows-neuron-screen.js";
import { sessionsBetween } from "./shared/flows-cross.js";
import { bookRows, runCardEngine, engineState, engineStale, QUANT_CARD_VERSION } from "./shared/flows-quant-card.js";
import { aiCapNeurons, aiChain, aiCallSignature, cappedAi, emptyNote, fallbackNote, intradayFloorMs, repliedGuard, retryableGuard, spendShape, thrownThenEmptyNote } from "./shared/flows-ai.js";
import { COURSE_STAGE_POINTS } from "./shared/course-points.js";
import { COURSE_BY_ID, COURSE_BY_SLUG, COURSE_TOPICS, SITE_ORIGIN } from "./shared/course-seo.js";
import { REVIEW_ITEM_BY_ID } from "./shared/review-manifest.js";
import { COURSE_STAGE_BY_ID, COURSE_STAGE_BY_VARIANT } from "./shared/stage-manifest.js";
import { SKILL_BY_ID } from "./shared/skill-manifest.js";
import { PROJECT_BY_ID } from "./shared/project-manifest.js";
import { MARKET_INDICES, MARKET_STALE_MS, marketRefreshDue, parseIndexQuote, buildSnapshot } from "./shared/markets.js";

import {
  rankChain, crossesEarnings, numOrNull, parseOptionSymbol, ivConvention, ivSurface, deskSmiles,
  hasNoEarnings, optionRoot, PRICING_RATE, DEFAULT_GATES, deskCarry,
} from "./shared/flows-premium.js";
import { stateOf, printOf, coherence } from "./shared/flows-basis.js";
import { etDayOf } from "./shared/flows-quant-time.js";
import { isRefreshWindow, freshHeaders, pendingHeaders, phaseAt, easternDay, sessionOpen } from "./shared/flows-freshness.js";
import * as FLOWS_LIVE from "./shared/flows-live-worker.js";
import * as FLOWS_DOSSIER from "./shared/flows-dossier-worker.js";
import { TICKER_RE } from "./shared/flows-live.js";
import {
  HttpError, json, apiError, redirect, requireMethod, requireSameOrigin, requireMutationOwner, requireReadOwnerIfPresent,
  readBounded, readJSON, requireTicker, tickerParam, keepAlive, errorText, internalKey, edgeCache,
} from "./server/http.js";
import { logFailure } from "./server/log.js";
import { createRouter } from "./server/router.js";
import { flowsReadRows } from "./server/routes/flows-read.js";
import { flowsDeskRows } from "./server/routes/flows-desk.js";
import { flowsAiRows } from "./server/routes/flows-ai.js";
import { flowsIngestRows } from "./server/routes/flows-ingest.js";
import { aiCall, pruneAiOutcomes } from "./server/ai.js";
import { applySchema } from "./server/schema.js";
import { chainFor } from "./shared/flows-ai-broker.js";
import { createFlowsStore, storedFrom } from "./server/store.js";
import * as FLOWS_READING from "./shared/flows-reading-worker.js";
import { LAB_SESSION_MS, recordSignIn } from "./shared/lab-sign-in.js";
import { nightlyFreshMeta, STRIP_FIELDS, stripValues, LIVE_BUDGET } from "./shared/flows-live.js";
import { readExpiryBreakdown } from "./shared/flows-positioning.js";
import { serveRt } from "./shared/flows-rt-routes.js";
import { RT_LIMITS } from "./shared/flows-rt.js";
import { memberAllowed } from "./shared/flows-access.js";
import { vendorBase, vendorRedirected, vendorUrl } from "./shared/flows-vendor-core.js";

export { Pulse } from "./shared/flows-rt-hub.js";

function createState() {
  return {
    marketRevalidation: null,
    refreshedMarketFlights: new WeakSet(),
    lastGoodStamped: new Map(),
    flowsSchemaReady: false,
    flowsSchemaFlight: null,
    spendRecorderFailed: false,
    aiRecorderFailed: false,
  };
}
const state = createState();

const COURSE_ASSET_PATH = "/lab/course";

const COURSE_EDGE_TTL_S = 60;
const LEGACY_COURSE_PATHS = new Set([
  "/lab/course", "/lab/course.html", "/lab/course/",
  "/lab/lesson", "/lab/lesson.html", "/lab/lesson/",
]);
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
const MASTERY_ATTEMPTS_RECEIVED_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS mastery_attempts_by_received ON mastery_attempts (received_at)";
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
  "CREATE INDEX IF NOT EXISTS skill_attempts_by_received ON skill_attempts (received_at)",
  "CREATE TABLE IF NOT EXISTS learning_preferences (user_id TEXT PRIMARY KEY, active_path_id TEXT NOT NULL DEFAULT 'complete-core', session_minutes INTEGER NOT NULL DEFAULT 20 CHECK (session_minutes IN (10,20,45)), weekly_goal_minutes INTEGER NOT NULL DEFAULT 120 CHECK (weekly_goal_minutes BETWEEN 30 AND 1200), updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS project_progress (user_id TEXT NOT NULL, project_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('guided','unguided')), done_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, project_id))",
]);
const SKILL_ATTEMPTS_RECEIVED_INDEX_SQL = ACADEMY_SCHEMA_SQL.find((sql) => sql.includes("skill_attempts_by_received"));
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
  "connect-src 'self' wss://anilkaya.org https://cdn.jsdelivr.net https://cloudflareinsights.com",
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
const LAB_WRITE_PERIOD_S = 60;
const LOGIN_PERIOD_S = 60;

async function requireLabWrite(env, user) {
  if (await memberAllowed(env.LAB_WRITE, { username: user.id })) return;
  throw new HttpError(429, "rate_limited", "Too many saves in the last minute; they will retry shortly.",
    { "Retry-After": String(LAB_WRITE_PERIOD_S) });
}

async function pruneLoginFailures(env, now) {
  if (!env || !env.DB) return 0;
  try {
    const results = await env.DB.batch([
      env.DB.prepare(LOGIN_FAILURES_FIRST_INDEX_SQL),
      env.DB.prepare("DELETE FROM flows_login_failures WHERE first_at < ?").bind(staleFailureCutoff(now)),
    ]);
    return Number(results[1] && results[1].meta && results[1].meta.changes) || 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table/i.test(message)) console.error(JSON.stringify({ message: "login failure prune failed", error: message }));
    return 0;
  }
}

async function pruneAttemptLedgers(env, now) {
  if (!env || !env.DB) return 0;
  const cutoff = now - ATTEMPT_LEDGER_TTL_MS;
  let removed = 0;
  for (const [index, table] of [[MASTERY_ATTEMPTS_RECEIVED_INDEX_SQL, "mastery_attempts"], [SKILL_ATTEMPTS_RECEIVED_INDEX_SQL, "skill_attempts"]]) {
    try {
      const results = await env.DB.batch([
        env.DB.prepare(index),
        env.DB.prepare("DELETE FROM " + table + " WHERE received_at < ?").bind(cutoff),
      ]);
      removed += Number(results[1] && results[1].meta && results[1].meta.changes) || 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no such table/i.test(message)) console.error(JSON.stringify({ message: "attempt ledger prune failed", table, error: message }));
    }
  }
  return removed;
}

const MARKET_SNAPSHOT_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS market_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at INTEGER NOT NULL)";

const LOGIN_FAILURES_FIRST_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS flows_login_failures_by_first ON flows_login_failures (first_at)";

const MARKET_FETCH_TIMEOUT_MS = 5000;
const YAHOO_ORIGINS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

const setAttr = (name, value) => ({ element: (el) => el.setAttribute(name, value) });

const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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

    const message = errorText(error);
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
    env.DB.prepare(MASTERY_ATTEMPTS_RECEIVED_INDEX_SQL),
  ]);
}

async function addDayColumn(env, table) {
  try {
    await env.DB.prepare("ALTER TABLE " + table + " ADD COLUMN last_day TEXT").run();
  } catch (error) {
    const message = errorText(error);
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
    const message = errorText(error);

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
    const message = errorText(error);
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
    const message = errorText(error);
    if (!/no such table:\s*(?:main\.)?(?:progress_v3|skill_mastery|skill_attempts|learning_preferences|project_progress)\b/i.test(message)) throw error;
    await ensureAcademySchema(env);
    return placementBatch(env, userId, buildStatements);
  }
}

async function marketOp(env, op) {
  try {
    return await op();
  } catch (error) {
    const message = errorText(error);
    if (!/no such table:\s*(?:main\.)?market_snapshot\b/i.test(message)) throw error;
    await env.DB.prepare(MARKET_SNAPSHOT_SCHEMA_SQL).run();
    return op();
  }
}

function marketQuoteOrigins(env) {
  const raw = env && typeof env.MARKET_QUOTE_ORIGIN === "string" ? env.MARKET_QUOTE_ORIGIN.trim().replace(/\/+$/, "") : "";
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(raw) ? [raw] : YAHOO_ORIGINS;
}

async function fetchIndexQuote(index, origins) {
  for (const origin of origins) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MARKET_FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(
          origin + "/v8/finance/chart/" + encodeURIComponent(index.yahoo) + "?range=5d&interval=1d",
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
  const origins = marketQuoteOrigins(env);
  const settled = await Promise.allSettled(MARKET_INDICES.map((index) => fetchIndexQuote(index, origins)));
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

const MARKET_FLIGHT_WAIT_MS = 2 * MARKET_FETCH_TIMEOUT_MS + 2000;

function startMarketFlight(env) {
  const flight = refreshMarketSnapshot(env).catch(() => null).then(async (refreshed) => {
    if (refreshed) { state.refreshedMarketFlights.add(flight); return refreshed; }
    const now = Date.now();
    const payload = JSON.stringify({ quotes: [], updatedAt: now });
    await marketOp(env, () => env.DB.prepare(
      "INSERT INTO market_snapshot (id, payload, updated_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at",
    ).bind(payload, now).run()).catch(() => {});
    return payload;
  }).finally(() => { if (state.marketRevalidation === flight) state.marketRevalidation = null; });
  state.marketRevalidation = flight;
  return flight;
}

async function revalidateMarketSnapshot(env) {
  const since = Date.now();
  let abandoned = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const flight = state.marketRevalidation || startMarketFlight(env);
    const how = await FLOWS_LIVE.settledWithin(flight, MARKET_FLIGHT_WAIT_MS, () => state.marketRevalidation !== null && state.marketRevalidation !== flight);
    if (how === "settled") {
      if (abandoned) FLOWS_LIVE.flightAbandoned("market", since, abandoned, state.refreshedMarketFlights.has(flight));
      return flight;
    }
    if (how === "moved") continue;
    if (state.marketRevalidation === flight) { state.marketRevalidation = null; abandoned++; }
  }
  if (abandoned) FLOWS_LIVE.flightAbandoned("market", since, abandoned, false);
  return JSON.stringify({ quotes: [], updatedAt: Date.now() });
}

async function readMarketSnapshot(env) {
  try {
    return await marketOp(env, () => env.DB.prepare("SELECT payload, updated_at FROM market_snapshot WHERE id=1").first());
  } catch { return null; }
}

async function refreshMarketSnapshotIfDue(env, at = Date.now()) {
  const inWindow = isRefreshWindow(new Date(at));
  const row = inWindow ? null : await readMarketSnapshot(env);
  const age = row ? at - Number(row.updated_at) : Infinity;
  if (!marketRefreshDue(age, inWindow)) return null;
  return revalidateMarketSnapshot(env);
}

async function loadMarketSnapshot(env, ctx) {
  const row = await readMarketSnapshot(env);
  if (!row) return keepAlive(ctx, revalidateMarketSnapshot(env));
  if (Date.now() - Number(row.updated_at) > MARKET_STALE_MS) keepAlive(ctx, revalidateMarketSnapshot(env));
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

function canonicalSkillItem(itemId) {
  return typeof itemId === "string" && Object.hasOwn(COURSE_STAGE_BY_VARIANT, itemId) ? COURSE_STAGE_BY_VARIANT[itemId] : itemId;
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
  return verifyFlowsSession(token, env.SESSION_SECRET, sessionEpoch(env), readMembers(env.FLOWS_CREDENTIALS));
}

async function readFlowsForm(request) {
  const bytes = await readBounded(request, 4096, "Request body too large");
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

function flowsLoginResponse(message, status = 401, headers) {
  const out = new Headers(headers);
  out.set("Content-Type", "text/html; charset=utf-8");
  return new Response(FLOWS_PAGES.loginPage({ error: message }), { status, headers: out });
}

const FLOWS_LOGIN_LIMITED = "Too many attempts. Try again shortly.";

function flowsLoginLimited() {
  return flowsLoginResponse(FLOWS_LOGIN_LIMITED, 429, { "Retry-After": String(LOGIN_PERIOD_S) });
}

const FLOWS_STORE = createFlowsStore({ ensureFlowsTables: (env) => ensureFlowsTables(env) });
const readFlowsPayload = (env, key, trace) => FLOWS_STORE.read(env, key, trace);

function nightlyFreshHeaders(stored) {
  if (!stored || !stored.fresh) return {};
  return freshHeaders(stored.fresh, Date.now(), FLOWS_LIVE.memoizedClock()).headers;
}

const SPLIT_ENGINE_MARK = '"engine":{"status":"split"';

async function readCardWithEngine(env, ticker, trace = {}) {
  return cardWithEngine(env, ticker, await readFlowsPayload(env, "card:" + ticker, trace), trace);
}

async function cardWithEngine(env, ticker, stored, trace = {}) {
  if (stored === null) return { stored: null, card: null, unreadable: false };
  let card;
  try { card = JSON.parse(stored.payload); } catch { return { stored, card: null, unreadable: true }; }
  if (card && card.engine && card.engine.status === "split" && typeof card.engine.key === "string" &&
      card.engine.key === "card-x:" + ticker) {
    const extra = await readFlowsPayload(env, card.engine.key, trace);
    let block = null;
    if (extra) {
      try {
        const x = JSON.parse(extra.payload);
        block = x && x.sessionDate === card.sessionDate && x.engine && typeof x.engine === "object" ? x.engine : null;
      } catch { block = null; }
    }
    card.engine = block || (trace.failed ? { ...STORE_GONE, key: card.engine.key } : { status: "unreadable", key: card.engine.key });
  }
  return { stored, card, unreadable: false };
}

const STORE_QUOTA_RE = /exceeded D1's|free tier daily row|D1_ERROR[\s\S]*\b7500\b/i;
const isStoreQuota = (error) => STORE_QUOTA_RE.test(errorText(error));
const secondsToUtcMidnight = (now) => Math.max(60, Math.ceil((Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(),
  new Date(now).getUTCDate() + 1) - now) / 1000));

const STORE_GONE = Object.freeze({ status: "unavailable", reason: "store" });
const storeGone = () => new HttpError(503, "store_unreadable", "The store could not be read", { "Retry-After": "30" }, STORE_GONE);

const LAST_GOOD_TTL_MS = 24 * 3600 * 1000;
const LAST_GOOD_REFRESH_MS = 10 * 60 * 1000;
const LAST_GOOD_MAX_KEYS = 256;
const LAST_GOOD_PATHS = new Set(["board", "market", "events", "scoretrack", "meta", "flowalerts", "pulse", "political", "unusual",
  "movers", "sectors", "sector-premium", "universe", "regime", "ideas", "focus", "roster", "news", "record", "card", "card-x",
  "hist"].map((name) => "/api/flows/" + name));

function lastGoodKey(request, url) {
  if (request.method !== "GET" || !LAST_GOOD_PATHS.has(url.pathname)) return null;
  let tail = "";
  if (url.pathname === "/api/flows/board") {
    const side = url.searchParams.get("side");
    tail = "?side=" + (side === "short" || side === "watch" ? side : "long");
  } else if (url.pathname === "/api/flows/card" || url.pathname === "/api/flows/card-x" || url.pathname === "/api/flows/hist") {
    const ticker = tickerParam(url);
    if (!TICKER_RE.test(ticker)) return null;
    tail = "?t=" + ticker;
  }
  return internalKey("lastgood", url.pathname.slice(1) + tail);
}

function rememberLastGood(request, url, response, ctx, now = Date.now()) {
  const cache = edgeCache.handle();
  if (!cache || response.status !== 200 || !Number(response.headers.get("X-Payload-Updated")) || response.headers.has("X-Fresh-Last-Good")) return;
  const key = lastGoodKey(request, url);
  if (!key || !ctx || typeof ctx.waitUntil !== "function") return;
  const seen = state.lastGoodStamped.get(key.url);
  if (seen !== undefined && now - seen < LAST_GOOD_REFRESH_MS) return;
  if (seen === undefined && state.lastGoodStamped.size >= LAST_GOOD_MAX_KEYS) state.lastGoodStamped.delete(state.lastGoodStamped.keys().next().value);
  state.lastGoodStamped.set(key.url, now);
  try {
    const kept = new Response(response.clone().body, { status: 200, headers: response.headers });
    kept.headers.set("Cache-Control", "public, max-age=" + LAST_GOOD_TTL_MS / 1000);
    kept.headers.set("X-Last-Good-At", String(now));
    ctx.waitUntil(cache.put(key, kept).catch(() => state.lastGoodStamped.delete(key.url)));
  } catch {
    state.lastGoodStamped.delete(key.url);
  }
}

async function recallLastGood(request, url, now = Date.now()) {
  const cache = edgeCache.handle();
  const key = cache ? lastGoodKey(request, url) : null;
  if (!key) return null;
  const hit = await edgeCache.get(key);
  const storedAt = hit ? Number(hit.headers.get("X-Last-Good-At")) : NaN;
  if (!hit || !Number.isFinite(storedAt) || now - storedAt > LAST_GOOD_TTL_MS) return null;
  const out = new Response(hit.body, { status: 200, headers: hit.headers });
  out.headers.delete("X-Last-Good-At");
  out.headers.delete("X-Server-Now");
  out.headers.set("X-Fresh-State", "stale");
  out.headers.set("X-Fresh-Reason", "store");
  out.headers.set("X-Fresh-Last-Good", new Date(storedAt).toISOString());
  return out;
}

async function readServed(env, key) {
  const trace = {};
  const stored = await readFlowsPayload(env, key, trace);
  if (trace.failed) throw storeGone();
  return stored;
}

const LITE_SQL =
  "SELECT j.key AS i, p.updated_at, json_extract(p.payload, '$.sessionDate') AS session, " +
  "COALESCE(json_extract(p.payload, '$.readAt'), json_extract(p.payload, '$.generatedAt')) AS read_iso, " +
  "json_extract(p.payload, '$.generatedAt') AS generated, json_extract(p.payload, '$.n') AS n, " +
  "json_extract(p.payload, '$.units') AS units, " +
  "(SELECT json_group_object(c.key, json_extract(c.value, '$[' || j.key || ']')) FROM json_each(p.payload, '$.cols') c) AS cols, " +
  "(SELECT json_group_object(c.key, json_extract(c.value, '$[' || j.key || ']')) FROM json_each(p.payload, '$.pct') c) AS pct, " +
  "json_extract(p.payload, '$.sectors[' || json_extract(p.payload, '$.sec[' || j.key || ']') || ']') AS sector " +
  "FROM flows_payload p, json_each(p.payload, '$.t') j WHERE p.id = 'universe' AND j.value = ? LIMIT 1";
const GATE_SQL =
  "SELECT json_extract(r.value, '$.d') AS d, json_extract(r.value, '$.dte') AS dte FROM flows_payload p, " +
  "json_each(p.payload, '$.rows') r WHERE p.id = 'events' AND json_extract(r.value, '$.t') = ? " +
  "AND json_extract(r.value, '$.st') = 'gated' LIMIT 1";
const ROSTER_SQL =
  "SELECT json_extract(payload, '$.sessionDate') AS session, json_extract(payload, '$.depth.\"' || ? || '\"') AS depth " +
  "FROM flows_payload WHERE id = 'roster'";
const KNOWN_SQL =
  "SELECT 1 AS k FROM flows_payload WHERE id = ?1 UNION ALL SELECT 1 FROM flows_payload p, json_each(p.payload, '$.t') j " +
  "WHERE p.id = 'universe' AND j.value = ?2 LIMIT 1";
const CLASS_TTL_S = 12 * 3600;
const parseOr = (text, fallback) => { try { const v = JSON.parse(text); return v && typeof v === "object" ? v : fallback; } catch { return fallback; } };

const firstRow = (res) => (res && res.results && res.results[0] ? res.results[0] : null);

function scheduledTonight(kind, row, now, clock) {
  if (!row || typeof row.depth !== "string" || typeof row.session !== "string") return false;
  if (kind === "hist" && (row.depth === "index" || row.depth === "fund")) return false;
  const phase = phaseAt(now, clock);
  if (!phase || (phase.phase !== "post" && phase.phase !== "closed") || phase.day !== phase.lastClosed) return false;
  const before = phaseAt(sessionOpen(phase.lastClosed), clock);
  return !!before && row.session === before.lastClosed;
}

function liteOf(ticker, r, g) {
  if (!r) return null;
  const units = parseOr(r.units, {}), cols = parseOr(r.cols, {});
  const u = {};
  for (const [k, v] of Object.entries(cols)) {
    const scale = Array.isArray(units[k]) ? Number(units[k][1]) : NaN;
    u[k] = Number.isFinite(v) && Number.isFinite(scale) && scale !== 0 ? v / scale : null;
  }
  return {
    v: 1, ticker, status: "ok", lite: true, depth: "universe", sessionDate: r.session, generatedAt: r.generated,
    sector: typeof r.sector === "string" ? r.sector : null, n: Number(r.n) || null, rank: Number(r.i) + 1,
    u, pct: parseOr(r.pct, {}), why: g ? "gated" : "not-covered",
    gate: g ? { earnings: typeof g.d === "string" ? g.d : null, dte: Number.isFinite(g.dte) ? g.dte : null } : null,
  };
}

function liteCard(ticker, r, g) {
  const card = liteOf(ticker, r, g);
  return card ? json(card, 200, nightlyFreshHeaders({ fresh: nightlyFreshMeta(r) })) : null;
}

const CLASS_RTH_MS = 15 * 60 * 1000;
const rowMeta = (at) => ({ readAt: at, session: easternDay(at), klass: "breadth", source: "ondemand" });

function rowCurrent(verdict, now, clock) {
  const at = Number(verdict.readAt);
  if (!(at > 0)) return false;
  const phase = phaseAt(now, clock);
  if (phase && phase.phase === "rth") return now - at <= CLASS_RTH_MS;
  return freshHeaders(rowMeta(at), now, clock).fresh.state !== "stale";
}

async function classifyTicker(env, ctx, ticker, allowed) {
  const cache = edgeCache.handle();
  const key = internalKey("class", ticker);
  const hit = await edgeCache.get(key);
  const now = Date.now();
  let held = null;
  if (hit) {
    const body = await hit.json().catch(() => null);
    if (body && typeof body.known === "boolean") {
      if (!body.known || rowCurrent(body, now, FLOWS_LIVE.memoizedClock(now))) return body;
      held = body.row && Number(body.readAt) > 0 ? body : null;
    }
  }
  if (!env.UW_API_KEY || !(await allowed())) return held;
  const raw = await uwFetch(env, "/api/screener/stocks", { ticker }).catch(() => null);
  const rows = raw && Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : null;
  if (!rows) return held;
  const row = rows.find((x) => x && typeof x.ticker === "string" && x.ticker.trim().toUpperCase() === ticker) || null;
  const verdict = row ? { known: true, row, readAt: now } : { known: false };
  if (cache) {
    const store = new Response(JSON.stringify(verdict), { headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": `max-age=${CLASS_TTL_S}` } });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(edgeCache.put(key, store));
    else await edgeCache.put(key, store);
  }
  return verdict;
}

function quoteCard(ticker, row, now) {
  const vals = stripValues(row, { at: now });
  const u = {};
  STRIP_FIELDS.forEach(([name], i) => { u[name] = vals[i]; });
  const text = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const day = typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : easternDay(now);
  return { v: 1, ticker, status: "ok", lite: true, depth: "quote", sessionDate: day, generatedAt: new Date(now).toISOString(),
    nm: text(row.full_name, 40), type: text(row.issue_type, 24), sector: text(row.sector, 40), u, why: "not-covered" };
}

async function absentKey(env, ctx, kind, ticker, session) {
  const keyed = [env.DB.prepare(ROSTER_SQL).bind(ticker)];
  if (kind === "card") keyed.push(env.DB.prepare(LITE_SQL).bind(ticker), env.DB.prepare(GATE_SQL).bind(ticker));
  const now = Date.now();
  const { results, clock } = await FLOWS_LIVE.batchWithClock(env.DB, keyed, now);
  if (!results) throw storeGone();
  const [roster, uni, gate] = results;
  if (scheduledTonight(kind, firstRow(roster), now, clock)) return json({ ticker, status: "pending" });
  if (kind !== "card") return json({ ticker, status: "absent", why: "not-covered" });
  const lite = liteCard(ticker, firstRow(uni), firstRow(gate));
  if (lite) return lite;
  const { verdict, refused } = await classifyWatched(env, ctx, ticker, vendorGate(env, session));
  if (verdict && verdict.known) {
    return json(quoteCard(ticker, verdict.row, verdict.readAt), 200, freshHeaders(rowMeta(verdict.readAt), now, clock).headers);
  }
  if (!verdict && refused) {
    return json({ ticker, status: "unavailable", why: "throttled" }, 200,
      { ...pendingHeaders("nightly", now, clock), "X-Fresh-Reason": "throttled", "Cache-Control": "no-store",
        "Retry-After": String(MEMBER_VENDOR_PERIOD_S) });
  }
  return json({ ticker, status: "absent", why: verdict ? "unknown" : "not-covered" });
}

async function classifyWatched(env, ctx, ticker, allowed) {
  let refused = false;
  const watched = async () => {
    const yes = await allowed();
    if (!yes) refused = true;
    return yes;
  };
  const verdict = await classifyTicker(env, ctx, ticker, watched);
  return { verdict, refused };
}

async function vendorAdmission(env, ctx, ticker, allowed) {
  const { verdict, refused } = await classifyWatched(env, ctx, ticker, allowed);
  if (verdict) return verdict.known ? "known" : "unknown";
  return refused ? "refused" : "open";
}

async function vendorAdmits(env, ctx, ticker, allowed) {
  return (await vendorAdmission(env, ctx, ticker, allowed)) !== "unknown";
}

async function tapeAdmission(env, ctx, ticker, allowed) {
  const cache = edgeCache.handle();
  const key = internalKey("tape-admit", ticker);
  const hit = await edgeCache.get(key);
  if (hit && (await hit.text().catch(() => "")) === "1") return null;
  const remember = () => {
    if (!cache) return;
    const put = cache.put(key, new Response("1", { headers: { "Cache-Control": `max-age=${CLASS_TTL_S}` } })).catch(() => {});
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
  };
  return { known: env.DB.prepare(KNOWN_SQL).bind("card:" + ticker, ticker), vendor: (t) => vendorAdmission(env, ctx, t, allowed), remember };
}

function passthrough(stored) {
  return new Response(stored.payload, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Payload-Updated": String(stored.updatedAt || 0),
      ...nightlyFreshHeaders(stored),
    },
  });
}

const askModel = (env) => aiChain(env)[0] || null;

const ASK_QUESTION_MAX = 400;
const ASK_BODY_MAX_BYTES = 4096;
const ASK_FLOOD_PERIOD_S = 60;

const MEMBER_VENDOR_PERIOD_S = 60;

class VendorRefused extends Error {}

const keepRefusal = (fallback) => (error) => {
  if (error instanceof VendorRefused) throw error;
  return fallback;
};

function vendorGate(env, session) {
  let member = null;
  const check = () => (member ||= memberAllowed(env.MEMBER_VENDOR, session));
  const gate = async () => {
    if (!(await check())) return false;
    return FLOWS_LIVE.ondemandAllowed(env);
  };
  gate.member = check;
  gate.call = () => FLOWS_LIVE.ondemandAllowed(env);
  return gate;
}

function chargedFetch(env, gate) {
  return async (path, params, opts) => {
    if (!(await gate.call())) throw new VendorRefused();
    return uwFetch(env, path, params, opts);
  };
}

const FALLBACK_FAILED = Object.freeze({
  allowance: "found the day's free model allowance spent, which resets at 00:00 UTC",
  budget: "found the day's model budget for this site spent, which resets at 00:00 UTC",
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

async function askSpendStrict(env) {
  if (!env.DB) return null;
  await ensureFlowsTables(env);
  const day = aiDay();
  const [row, split] = await env.DB.batch([
    env.DB.prepare("SELECT calls, tokens_in, tokens_out FROM flows_ai_usage WHERE day = ?").bind(day),
    env.DB.prepare("SELECT model, calls, tokens_in, tokens_out FROM flows_ai_usage_model WHERE day = ? ORDER BY model").bind(day),
  ]);
  const one = row && Array.isArray(row.results) ? row.results[0] : null;
  const byModel = split && Array.isArray(split.results)
    ? split.results.map((r) => ({ model: String(r.model), calls: Number(r.calls) || 0,
        tokensIn: Number(r.tokens_in) || 0, tokensOut: Number(r.tokens_out) || 0 }))
    : [];
  return spendShape(env, day, one ? Number(one.calls) || 0 : 0, one ? Number(one.tokens_in) || 0 : 0,
    one ? Number(one.tokens_out) || 0 : 0, byModel);
}

const meteredAi = (env) => cappedAi(env, env.DB ? () => askSpendStrict(env) : null);

const aiDeps = (env, ai) => ({
  ai: ai || (() => meteredAi(env)),
  now: () => Date.now(),
  ensureFlowsTables,
  failed: (error, at) => {
    if (state.aiRecorderFailed) return;
    state.aiRecorderFailed = true;
    logFailure("warn", "ai outcome not recorded", at, error);
  },
});

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
    return { day, model: billed, tokensIn: inTok, tokensOut: outTok, estimated: usage.estimated === true };
  } catch (error) {
    if (!state.spendRecorderFailed) {
      state.spendRecorderFailed = true;
      logFailure("warn", "ai spend not recorded", { model: billed }, error);
    }
    return null;
  }
}

async function briefWithLive(env, index) {
  if (!env.DB || !index || typeof index !== "object") return { index, overlay: null };
  try {
    const feeds = await FLOWS_LIVE.liveBriefFeeds(env.DB);
    const keys = Object.keys(feeds);
    if (!keys.length) return { index, overlay: null };
    return { index: FLOWS_ASK.refreshIntradayFacts(index, feeds),
      overlay: keys.map((k) => (k === "pulse" ? "live:market" : "live:alerts")).join(",") };
  } catch {
    return { index, overlay: null };
  }
}

async function refreshFlowsSummary(env, at = Date.now()) {
  if (!env.DB) return;
  await ensureFlowsTables(env);

  const [briefRes, liveRes, priorRes, clockRes] = await env.DB.batch([
    env.DB.prepare("SELECT updated_at FROM flows_payload WHERE id = 'brief'"),
    env.DB.prepare(FLOWS_LIVE.LIVE_BRIEF_STAMP_SQL),
    env.DB.prepare("SELECT fingerprint, llm, guard, generated_at FROM flows_ai_summary WHERE scope = ?").bind("board"),
    env.DB.prepare("SELECT * FROM flows_clock WHERE id = 1"),
  ]).catch(() => []);
  const rowOf = (res) => (res && Array.isArray(res.results) && res.results.length ? res.results[0] : null);
  const brief = rowOf(briefRes);

  if (!brief) return;

  const signature = aiCallSignature(env);
  const stamp = String(brief.updated_at || 0) + "|" + FLOWS_LIVE.liveBriefStampOf(liveRes && liveRes.results) + "|" + signature;
  const prior = rowOf(priorRes);
  const clock = FLOWS_LIVE.normalizeClock(rowOf(clockRes));
  if (prior && clock && clock.summaryStamp === stamp) {
    const priorAge = typeof prior.generated_at === "string" ? at - Date.parse(prior.generated_at) : Infinity;
    if (!retryableGuard(prior.guard, priorAge)) return;
  }
  const markStamp = () => FLOWS_LIVE.clockPatchStatement(env.DB, { summaryStamp: stamp }, at).run().catch(() => {});

  const stored = await readFlowsPayload(env, "brief");
  if (stored === null) return;
  let index;
  try { index = JSON.parse(stored.payload); } catch { return; }
  index = (await briefWithLive(env, index)).index;
  const facts = Array.isArray(index && index.facts) ? index.facts : [];
  if (!facts.length) return;

  const fingerprint = FLOWS_ASK.summaryFingerprint(facts) + "|" + signature;

  if (prior && prior.fingerprint === fingerprint) {
    const priorAge = typeof prior.generated_at === "string"
      ? Date.now() - Date.parse(prior.generated_at) : Infinity;
    if (!retryableGuard(prior.guard, priorAge)) { await markStamp(); return; }
  }

  const intradayOnly = typeof index.refreshedAt === "string" && index.refreshedAt !== "";
  const sameCall = prior && typeof prior.fingerprint === "string" && prior.fingerprint.endsWith("|" + signature);
  if (sameCall && (prior.llm || repliedGuard(prior.guard)) && intradayOnly && typeof prior.generated_at === "string") {
    const ageMs = Date.now() - Date.parse(prior.generated_at);
    if (Number.isFinite(ageMs) && ageMs < intradayFloorMs(prior.llm, prior.guard)) return;
  }
  const age = FLOWS_ASK.briefAge(index, new Date(), FLOWS_LIVE.memoizedClock());

  const plain = FLOWS_ASK.renderSummaryPlain(facts);
  const write = async (text, llm, model, guard) => {
    await env.DB.prepare(
      "INSERT INTO flows_ai_summary (scope, text, llm, model, fingerprint, guard, generated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET " +
      "text=excluded.text, llm=excluded.llm, model=excluded.model, " +
      "fingerprint=excluded.fingerprint, guard=excluded.guard, generated_at=excluded.generated_at",
    ).bind("board", text, llm ? 1 : 0, model, fingerprint, guard, new Date().toISOString()).run();
    await markStamp();
  };

  const chain = chainFor(env, "board");

  if (!env.AI || !chain.length) {
    await write(plain, false, null, null).catch(() => {});
    return;
  }

  const { system, user } = FLOWS_ASK.promptForSummary(facts, age);
  const said = await aiCall(env, aiDeps(env), { surface: "board", chain,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    opts: { maxTokens: 1024, temperature: 0.2 },
    onUsage: (billed, usage) => askRecordSpend(env, usage, billed) });

  if (!said.text) {
    await write(plain, false, said.model, said.guard).catch(() => {});
    return;
  }

  const verdict = FLOWS_ASK.guardAnswer(said.text, facts, { smallIntegers: false });
  if (!verdict.ok) {
    const guard = verdict.invented ? "invented" : "forecast";
    await said.call.settle({ llm: false, guard }, verdict.rejected[0]);
    await write(plain, false, said.model, guard).catch(() => {});
    return;
  }
  await said.call.settle({ llm: true, guard: null });
  await write(said.text, true, said.model, null).catch(() => {});
}

async function summaryFiring(env, at) {
  await refreshFlowsSummary(env, at);
  if (env.DB) await FLOWS_LIVE.clockPatchStatement(env.DB, { summaryAt: at }, at).run();
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

const NEURON_ROW_SQL = "SELECT version, fingerprint, summary, ideas, llm, model, guard, generated_at FROM flows_neuron WHERE scope = ?";

function neuronFrom(row) {
  if (!row) return null;
  let ideas = [];
  try { ideas = JSON.parse(typeof row.ideas === "string" ? row.ideas : "[]"); } catch { ideas = []; }
  const engine = ideas && typeof ideas === "object" && !Array.isArray(ideas) && ideas.v === 3 ? ideas : null;
  return {
    version: Number(row.version) || 0,
    fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : null,
    summary: typeof row.summary === "string" ? row.summary : "",
    ideas: engine ? (Array.isArray(engine.ideas) ? engine.ideas : []) : Array.isArray(ideas) ? ideas : [],
    engine: engine !== null,
    verdict: engine && typeof engine.verdict === "string" ? engine.verdict : null,
    claims: engine && Array.isArray(engine.claims) ? engine.claims : [],
    refused: engine && Array.isArray(engine.refused) ? engine.refused : [],
    llm: row.llm === 1,
    model: typeof row.model === "string" ? row.model : null,
    guard: typeof row.guard === "string" ? row.guard : null,
    generatedAt: typeof row.generated_at === "string" ? row.generated_at : null,
  };
}

async function markNeuronGenerating(env, scope, fingerprint, model) {
  const now = new Date();
  const startedAt = now.toISOString();
  const cutoff = new Date(now.getTime() - NEURON_GENERATING_MS).toISOString();
  try {
    const res = await env.DB.prepare(
      "INSERT INTO flows_neuron (scope, version, fingerprint, summary, ideas, llm, model, guard, generated_at) " +
      "VALUES (?, ?, ?, '', '[]', 0, ?, 'generating', ?) ON CONFLICT(scope) DO UPDATE SET " +
      "version=excluded.version, fingerprint=excluded.fingerprint, summary='', ideas='[]', llm=0, " +
      "model=excluded.model, guard='generating', generated_at=excluded.generated_at " +
      "WHERE flows_neuron.guard IS NOT 'generating' OR flows_neuron.generated_at < ?",
    ).bind(scope, FLOWS_NEURON.NEURON_CONTEXT_VERSION, fingerprint, model, startedAt, cutoff).run();
    const mine = !(res && res.meta && typeof res.meta.changes === "number") || res.meta.changes > 0;
    return { startedAt: mine ? startedAt : null, failed: false };
  } catch {
    return { startedAt: null, failed: true };
  }
}

async function writeNeuron(env, scope, fingerprint, summary, ideas, llm, model, guard, startedAt) {
  return env.DB.prepare(
    "INSERT INTO flows_neuron (scope, version, fingerprint, summary, ideas, llm, model, guard, generated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET " +
    "version=excluded.version, fingerprint=excluded.fingerprint, summary=excluded.summary, " +
    "ideas=excluded.ideas, llm=excluded.llm, model=excluded.model, guard=excluded.guard, " +
    "generated_at=excluded.generated_at " +
    "WHERE flows_neuron.fingerprint = excluded.fingerprint OR flows_neuron.generated_at < excluded.generated_at",
  ).bind(scope, FLOWS_NEURON.NEURON_CONTEXT_VERSION, fingerprint, summary, JSON.stringify(ideas || []),
    llm ? 1 : 0, model, guard, startedAt || new Date().toISOString()).run();
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

function engineProvenance(r) {
  const ideas = Array.isArray(r.ideas) ? r.ideas : [];
  const refused = Array.isArray(r.refused) ? r.refused : [];
  const codes = [...new Set(refused.map((x) => x && x.code).filter((x) => typeof x === "string"))];
  const refusedSaid = refused.length
    ? refused.length + " of its answer" + (refused.length === 1 ? " was" : "s were") + " refused (" + codes.join(", ") + ")"
    : "";
  const head = "Figures, facts and structures computed by the engine; the summary is deterministic.";
  if (!ideas.length) {
    if (r.verdict !== "stand-aside") return head + " The engine ranked no structure worth showing.";
    return head + (r.llm === true && r.model
      ? " " + modelName(r.model) + " was asked and agreed: the engine\u2019s own verdict is that no structure it priced clears its bar."
      : " The engine stands aside: no structure it priced clears its bar.");
  }
  if (ideas.some((i) => i && i.from === "model")) {
    return head + " " + modelName(r.model) + " chose the ideas as structure ids and verdict codes, each checked against " +
      "the facts" + (refusedSaid ? "; " + refusedSaid : "") + ".";
  }
  const guard = typeof r.guard === "string" ? r.guard : "";
  const why = guard === "engine:refused" ? "every answer the model gave was refused" + (codes.length ? " (" + codes.join(", ") + ")" : "")
    : guard === "ideas:unparsable" ? "the model\u2019s reply could not be parsed"
      : guard.startsWith("unreachable") ? neuronProvenance({ llm: false, guard }).replace(/^Deterministic reading: /, "").replace(/\.$/, "")
        : "no model was asked";
  return head + " The ideas are the engine\u2019s own ranking: " + why + ".";
}

function engineIdeaShape(idea) {
  if (!idea || typeof idea !== "object") return idea;
  return { ...idea, word: idea.verdict && FLOWS_NEURON.VERDICT_WORD[idea.verdict] ? FLOWS_NEURON.VERDICT_WORD[idea.verdict] : null };
}

function neuronShape(status, ticker, ctx, row, extra) {
  const r = row && typeof row === "object" ? row : null;
  const text = r !== null && r.summary ? r.summary : null;
  const engine = r !== null && r.engine === true;
  return {
    status, scope: ticker, tier: null, code: null, why: null,
    summary: text,
    ideas: r !== null && Array.isArray(r.ideas) ? (engine ? r.ideas.map(engineIdeaShape) : r.ideas) : [],
    engine,
    verdict: engine ? r.verdict : null,
    verdictWord: engine && r.verdict && FLOWS_NEURON.VERDICT_WORD[r.verdict] ? FLOWS_NEURON.VERDICT_WORD[r.verdict] : null,
    claims: engine ? r.claims : [],
    refused: engine ? r.refused : [],
    context: ctx ? FLOWS_NEURON.publicContext(ctx) : null,
    llm: r !== null ? r.llm === true : false,
    model: r !== null ? r.model : null,
    guard: r !== null ? r.guard : null,
    generatedAt: r !== null ? r.generatedAt : null,
    provenance: text ? (engine ? engineProvenance(r) : neuronProvenance({ text, llm: r.llm === true, model: r.model,
      guard: r.guard && /^ideas:\d+ refused$/.test(r.guard) ? null : r.guard }) + ideaProvenance(r)) : null,
    ...(extra || {}),
  };
}

function neuronContextFor(card) {
  const age = FLOWS_ASK.briefAge({ sessionDate: card.sessionDate }, new Date(), FLOWS_LIVE.memoizedClock());
  return FLOWS_NEURON.buildContext(card, { expectedSession: age.expected });
}

async function generateEngineNeuron(env, scope, ctx, fingerprint, plain, chain, startedAt) {
  const fallback = FLOWS_NEURON.engineFallback(ctx);
  const store = (res, llm, model, guard) => writeNeuron(env, scope, fingerprint, plain,
    { v: 3, verdict: res.verdict, claims: res.claims, ideas: res.ideas, refused: res.refused }, llm, model, guard, startedAt).catch(() => {});
  if (!env.AI || !chain.length) { await store(fallback, false, null, null); return; }
  const { system, user } = FLOWS_NEURON.promptForEngine(ctx);
  const said = await aiCall(env, aiDeps(env), { surface: "neuron", chain,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    opts: { maxTokens: 500, temperature: 0.1 }, onUsage: (billed, usage) => askRecordSpend(env, usage, billed) });
  if (!said.text) { await store(fallback, false, said.model, said.guard); return; }
  const parsed = FLOWS_NEURON.parseEngineOutput(said.text);
  if (parsed === null) {
    await said.call.settle({ llm: false, guard: "ideas:unparsable" });
    await store(fallback, false, said.model, "ideas:unparsable");
    return;
  }
  const vet = FLOWS_NEURON.vetEngineReply(parsed, ctx);
  if (!vet.ok) {
    await said.call.settle({ llm: false, guard: "engine:refused" }, vet.refused[0] && vet.refused[0].code);
    await store({ ...fallback, refused: vet.refused }, false, said.model, "engine:refused");
    return;
  }
  const trimmed = vet.refused.length ? "ideas:" + vet.refused.length + " refused" : null;
  await said.call.settle({ llm: true, guard: trimmed });
  await store(vet, true, said.model, trimmed);
}

async function generateNeuron(env, ticker, ctx, fingerprint, startedAt) {
  const scope = "ticker:" + ticker;
  const chain = chainFor(env, "neuron");
  const plain = FLOWS_NEURON.deterministicSummary(ctx);
  if (ctx.engine) return generateEngineNeuron(env, scope, ctx, fingerprint, plain, chain, startedAt);
  const stateIdea = FLOWS_NEURON.stateIdea(ctx);
  const abstain = (ideas) => (ideas.length ? ideas : FLOWS_NEURON.vetIdeas([FLOWS_NEURON.abstentionIdea(ctx)].filter(Boolean), ctx).ideas);
  const own = abstain(FLOWS_NEURON.vetIdeas(stateIdea ? [stateIdea] : [], ctx).ideas);
  if (!env.AI || !chain.length) {
    await writeNeuron(env, scope, fingerprint, plain, own, false, null, null, startedAt).catch(() => {});
    return;
  }
  const { system, user } = FLOWS_NEURON.promptForNeuron(ctx);
  const facts = FLOWS_NEURON.guardFacts(ctx);
  const guardOpts = FLOWS_NEURON.guardOptions(ctx);
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  let parsed = null;
  let lastText = null;
  let model = chain[0];
  let refused = null;
  let lastCall = null;
  for (let attempt = 0; attempt < 2 && (parsed === null || parsed.summary === null); attempt++) {
    const said = await aiCall(env, aiDeps(env), { surface: "neuron", chain: attempt === 0 ? chain : chainFor(env, "neuron", model), messages,
      opts: { maxTokens: 1400, temperature: attempt === 0 ? 0.2 : 0.05 },
      onUsage: (billed, usage) => askRecordSpend(env, usage, billed) });
    if (!said.text) {
      if (attempt > 0) {
        if (said.failure) refused = "unreachable:reparse:" + said.failure.why;
        break;
      }
      await writeNeuron(env, scope, fingerprint, plain, own, false, said.model, said.guard, startedAt).catch(() => {});
      return;
    }
    model = said.model;
    lastText = said.text;
    lastCall = said.call;
    parsed = FLOWS_NEURON.parseNeuronOutput(said.text);
    if (attempt === 0 && (parsed === null || parsed.summary === null)) await said.call.settle({ llm: false, guard: "ideas:unparsable" });
  }
  if (parsed === null) {
    const prose = typeof lastText === "string" && !/[{}[\]]|"summary"|"ideas"/.test(lastText);
    const verdict = prose && FLOWS_NEURON.proseIssue(lastText, "summary") === null ? FLOWS_ASK.guardAnswer(lastText, facts, guardOpts) : { ok: false };
    const guard = verdict.ok ? "ideas:unparsable" : refused || "ideas:unparsable";
    await lastCall.settle({ llm: verdict.ok, guard });
    await writeNeuron(env, scope, fingerprint, verdict.ok ? lastText : plain, own, verdict.ok, model, guard, startedAt).catch(() => {});
    return;
  }
  let summary = plain;
  let llm = false;
  let guard = null;
  let offending = "";
  if (parsed.summary) {
    const unsafe = FLOWS_NEURON.proseIssue(parsed.summary, "summary") !== null;
    const verdict = unsafe ? { ok: false } : FLOWS_ASK.guardAnswer(parsed.summary, facts, guardOpts);
    if (verdict.ok) { summary = parsed.summary; llm = true; }
    else {
      guard = unsafe ? "unsafe" : verdict.invented ? "invented" : verdict.mislabeled ? "mislabeled" : "forecast";
      offending = verdict.rejected ? verdict.rejected[0] : "";
    }
  } else {
    guard = refused || "summary:empty";
  }
  const vetted = FLOWS_NEURON.vetIdeas((stateIdea ? [stateIdea] : []).concat(parsed.ideas), ctx);
  if (guard === null && vetted.refused.length) guard = "ideas:" + vetted.refused.length + " refused";
  await lastCall.settle({ llm, guard }, offending);
  await writeNeuron(env, scope, fingerprint, summary, abstain(vetted.ideas), llm, model, guard, startedAt).catch(() => {});
}

const SCREEN_TTL_S = 300;
const SCREEN_PROVENANCE = "Read from the screener row alone by fixed rules: no model was asked and no vendor call was made for it.";
const EXPIRED_PROVENANCE = "Deterministic: no model was asked about a card this old.";
const NONE_WHY = "This name is not in the nightly universe, so no dealer positioning or option chain is held for it; the ticker page can read a quote for it on demand and nothing more.";

function screenShape(ticker, lite, clock) {
  const age = FLOWS_ASK.briefAge({ sessionDate: lite.sessionDate }, new Date(), clock);
  const gap = age.expected && typeof lite.sessionDate === "string" ? sessionsBetween(lite.sessionDate, age.expected) : 0;
  const reading = FLOWS_SCREEN.screenReading({ ticker, u: lite.u, pct: lite.pct, sector: lite.sector,
    sessionDate: lite.sessionDate, expectedSession: age.expected, behind: gap === null ? 0 : gap });
  const readable = reading.status === "ok";
  return neuronShape(readable ? "ok" : "unavailable", ticker, null, null, {
    tier: readable ? reading.tier : "unpriceable",
    code: readable ? reading.noIdeaCode : "screen.no-inputs",
    why: readable ? reading.why : "The screener row carries none of the inputs a reading is built on.",
    summary: reading.summary, screen: reading, provenance: SCREEN_PROVENANCE, generatedAt: lite.generatedAt,
    verdictWord: reading.tier === "expired" ? "Expired screen read" : "Screen read",
  });
}

async function absentNeuron(env, ctx, ticker) {
  const cache = edgeCache.handle();
  const key = internalKey("screen", ticker);
  const hit = await edgeCache.get(key);
  if (hit) {
    const kept = await hit.json().catch(() => null);
    if (kept && kept.scope === ticker && typeof kept.tier === "string") return json(kept);
  }
  const now = Date.now();
  const { results, clock } = await FLOWS_LIVE.batchWithClock(env.DB,
    [env.DB.prepare(ROSTER_SQL).bind(ticker), env.DB.prepare(LITE_SQL).bind(ticker)], now);
  if (!results) return json(neuronShape("unavailable", ticker, null, null, { ...STORE_GONE, note: "The store could not be read." }));
  const [roster, uni] = results;
  if (scheduledTonight("card", firstRow(roster), now, clock)) {
    return json(neuronShape("pending", ticker, null, null, { code: "scheduled",
      note: "A card for " + ticker + " is built by tonight's run, so there is nothing to read yet." }));
  }
  const lite = liteOf(ticker, firstRow(uni), null);
  const body = lite ? screenShape(ticker, lite, clock)
    : neuronShape("absent", ticker, null, null, { tier: "none", code: "not-covered", why: NONE_WHY, note: NONE_WHY });
  if (cache && ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": `max-age=${SCREEN_TTL_S}` } })).catch(() => {}));
  }
  return json(body);
}

function dossierDeps(env, ctx, session) {
  const gate = vendorGate(env, session);
  return {
    fetchVendor: (p, params, opts) => uwFetch(env, p, params, { ...opts, deadlineMs: UW_DOSSIER_DEADLINE_MS }),
    allowed: () => gate(),
    quote: async (t) => (await quoteResponse(env, ctx, t, gate)).json(),
    admit: (t) => vendorAdmits(env, ctx, t, gate),
  };
}

function readingDeps(env, ctx, ticker, session) {
  const deps = {
    assemble: (opts) => FLOWS_DOSSIER.assembleDossier(env, ctx, ticker, dossierDeps(env, ctx, session), opts),
    readRow: (scope) => env.DB.prepare(NEURON_ROW_SQL).bind(scope).first(),
    mark: (scope, fingerprint, model) => markNeuronGenerating(env, scope, fingerprint, model),
    write: (scope, fingerprint, summary, ideas, llm, model, guard, startedAt) => writeNeuron(env, scope, fingerprint, summary, ideas, llm, model, guard, startedAt),
    ai: () => cappedAi({ ...env, FLOWS_AI_DAILY_CAP_NEURONS: String(Math.floor(aiCapNeurons(env) * FLOWS_READING.READ_BUDGET_SHARE)) }, env.DB ? () => askSpendStrict(env) : null),
    recordSpend: (billed, usage) => askRecordSpend(env, usage, billed),
    modelLabel: modelName,
    describeGuard: (guard) => neuronProvenance({ llm: false, guard }),
  };
  deps.call = (request) => aiCall(env, aiDeps(env, deps.ai), request);
  return deps;
}

async function summaryResponse(env, ctx, ticker, session) {
  if (env.DB) await ensureFlowsTables(env);
  const [res, read] = await Promise.all([
    tickerNeuron(env, ctx, ticker),
    FLOWS_READING.readingSafe(env, ctx, ticker, readingDeps(env, ctx, ticker, session), { boxMs: FLOWS_READING.READ_BOX_MS }),
  ]);
  let body = null;
  try { body = await res.clone().json(); } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return res;
  return json({ ...body, read }, res.status);
}

async function dossierResponse(env, ctx, ticker, url, session) {
  const now = Date.now();
  const asked = Number(url.searchParams.get("budget"));
  const budgetTokens = Number.isFinite(asked) && asked >= 400 && asked <= 12000 ? Math.round(asked) : FLOWS_DOSSIER.DEFAULT_BUDGET_TOKENS;
  const result = await FLOWS_DOSSIER.assembleDossier(env, ctx, ticker, dossierDeps(env, ctx, session), { own: true, now });
  const { dossier, trace, neuron } = result;
  const prompt = result.prompt && budgetTokens === FLOWS_DOSSIER.DEFAULT_BUDGET_TOKENS ? result.prompt : FLOWS_DOSSIER.renderDossierForModel(dossier, { budgetTokens });
  const fresh = FLOWS_DOSSIER.dossierFresh(result, now) || pendingHeaders("nightly", now, result.clock);
  const headers = {
    ...fresh,
    "X-Dossier-Fingerprint": dossier.fingerprint,
    "X-Dossier-Tokens": String(prompt.tokensEst),
    "X-Dossier-Vendor-Calls": String(trace.vendorCalls),
    "X-Dossier-Pending": trace.pending.join(","),
  };
  if (trace.failed) {
    headers["X-Fresh-State"] = "stale";
    headers["X-Fresh-Reason"] = "store";
  }
  if (url.searchParams.get("render") === "1") {
    return new Response(prompt.text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
  }
  return json({
    ticker, tier: neuron.tier, code: neuron.code, why: neuron.why || neuron.note || null,
    dossier,
    prompt: { tokensEst: prompt.tokensEst, budgetTokens: prompt.budgetTokens, shed: prompt.shed, dropped: prompt.dropped },
    trace: { vendorCalls: trace.vendorCalls, calls: trace.calls, pending: trace.pending, queued: trace.queued, stale: trace.stale, wrote: trace.wrote },
  }, 200, headers);
}

async function tickerNeuron(env, ctx, ticker) {
  const scope = "ticker:" + ticker;
  if (!env.DB) {
    return json(neuronShape("unavailable", ticker, null, null,
      { note: "No store is bound to this route, so no reading can be read or written." }));
  }
  await ensureFlowsTables(env);
  const trace = {};
  const [c, n] = await env.DB.batch([
    env.DB.prepare(FLOWS_LIVE.NIGHTLY_ROW_SQL).bind("card:" + ticker),
    env.DB.prepare(NEURON_ROW_SQL).bind(scope),
  ]).catch(() => { trace.failed = true; return [null, null]; });
  const read = await cardWithEngine(env, ticker, storedFrom(firstRow(c)), trace);
  if (trace.failed) return json(neuronShape("unavailable", ticker, null, null, { ...STORE_GONE, note: "The store could not be read." }));
  if (read.stored === null) return absentNeuron(env, ctx, ticker);
  const card = read.card;
  if (read.unreadable) {
    return json(neuronShape("unreadable", ticker, null, null,
      { note: "The card for " + ticker + " was published and could not be read, which is " +
        "a fault on this side rather than a fact about the name." }));
  }
  if (!card || typeof card !== "object" || card.status === "pending" || !card.panels) {
    return json(neuronShape("pending", ticker, null, null,
      { note: "The card for " + ticker + " has not landed yet." }));
  }
  const context = neuronContextFor(card);
  const tag = FLOWS_NEURON.neuronTier(card, context);
  const age = FLOWS_ASK.briefAge({ sessionDate: card.sessionDate }, new Date(), FLOWS_LIVE.memoizedClock());
  const gap = age.expected && typeof card.sessionDate === "string" ? sessionsBetween(card.sessionDate.slice(0, 10), age.expected) : 0;
  if (gap !== null && gap >= FLOWS_SCREEN.SCREEN_LINES.EXPIRED_SESSIONS) {
    const stem = "Expired: this card describes " + card.sessionDate + ", " + gap + " sessions before the last close (" + age.expected +
      "), so no idea is offered from it.";
    return json(neuronShape("ok", ticker, context, null, { tier: "expired", code: "expired.sessions", why: stem,
      summary: stem + " What it recorded then: " + FLOWS_NEURON.deterministicSummary(context),
      provenance: EXPIRED_PROVENANCE, generatedAt: typeof card.generatedAt === "string" ? card.generatedAt : null }));
  }
  const shape = (status, row, extra) => neuronShape(status, ticker, context, row, { ...tag, ...(extra || {}) });
  if (!context.coverage.read) {
    return json(shape("quiet", null,
      { note: "The card for " + ticker + " publishes no feature with a reading this session, " +
        "which is a fact about the card and not about the name." }));
  }
  const fingerprint = FLOWS_NEURON.contextFingerprint(context) + "|" + aiCallSignature(env);
  const prior = neuronFrom(firstRow(n));
  const now = Date.now();
  const priorAge = prior && prior.generatedAt ? now - Date.parse(prior.generatedAt) : Infinity;

  if (prior && prior.fingerprint === fingerprint && prior.version === FLOWS_NEURON.NEURON_CONTEXT_VERSION) {
    if (prior.guard === "generating") {
      if (priorAge < NEURON_GENERATING_MS) {
        return json(shape("pending", null, { note: "Neuron is reading this card now." }));
      }
    } else if (prior.summary) {
      const retryable = retryableGuard(prior.guard, priorAge) && priorAge > NEURON_RETRY_MS;
      if (!retryable) return json(shape("ok", FLOWS_NEURON.applyStaleCap(prior, context)));
    }
  }

  const { startedAt, failed } = await markNeuronGenerating(env, scope, fingerprint, askModel(env));
  if (failed) {
    return json(shape("unavailable", null,
      { ...STORE_GONE, note: "The store could not record that a reading was started, so none was started." }));
  }
  if (!startedAt) {
    return json(shape("pending", null, { note: "Neuron is reading this card now." }));
  }
  const work = generateNeuron(env, ticker, context, fingerprint, startedAt).catch((error) => {
    logFailure("error", "neuron failed", { ticker }, error);
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work); else await work;
  return json(shape("pending", null, { note: "Neuron is reading this card now." }));
}

const ASK_NOT_TICKERS = new Set(["IV", "OI", "ETF", "ETFS", "RSI", "ATR", "ADX", "GEX", "VRP", "DTE", "ITM", "OTM", "ATM", "CPI", "GDP", "FOMC", "EPS", "PE", "YTD", "IPO", "AI", "USD", "US", "VS", "PM", "AM", "ET", "UTC", "CEO", "CFO", "SEC", "FED", "FAQ", "OK", "TA", "IV30"]);

function askTicker(question, subject) {
  const text = typeof question === "string" ? question : "";
  if (/[a-z]/.test(text)) {
    for (const t of text.match(/\b[A-Z][A-Z0-9]{0,4}\b/g) || []) if (!ASK_NOT_TICKERS.has(t) && t.length >= 2) return t;
  }
  return subject;
}

async function askDossier(env, ctx, subject, question, session) {
  const none = { facts: [], promptFacts: [], about: null, rule: "" };
  const ticker = askTicker(question, subject);
  if (ticker === null || !env.DB) return none;
  try {
    await ensureFlowsTables(env);
    const got = await FLOWS_READING.askDossierFor(ticker, question, {
      assemble: (opts) => FLOWS_DOSSIER.assembleDossier(env, ctx, ticker, dossierDeps(env, ctx, session), opts),
    });
    return got.facts.length ? got : none;
  } catch {
    return none;
  }
}

function askSubject(body) {
  const raw = body && typeof body.subject === "string" ? body.subject.trim().toUpperCase() : "";
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(raw) ? raw : null;
}

async function askQuestion(request) {
  const mediaType = (request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
  const bytes = await readBounded(request, ASK_BODY_MAX_BYTES, "The question is too large to read.");
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "bad_json", "Send a JSON object with a `question` field.");
  }
  const raw = body && typeof body.question === "string" ? body.question.trim() : "";
  if (raw === "") {
    throw new HttpError(400, "no_question", "Ask a question in the `question` field.");
  }
  return { question: raw.slice(0, ASK_QUESTION_MAX), subject: askSubject(body) };
}

async function askAnswer(question, env, index, updatedAt, subject, ctx, session) {

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
  const dossier = await askDossier(env, ctx, subject, question, session);
  const { picked: selected, withheld, capped } = sel;
  const picked = dossier.facts.length ? selected.concat(dossier.facts) : selected;
  const why = dossier.facts.length ? sel.why + " Plus " + dossier.facts.length + (dossier.facts.length === 1 ? " fact" : " facts") + " from the company dossier." : sel.why;

  const framed = sel.subjectApplied && subject ? question + " " + subject : question;

  const plain = FLOWS_ASK.renderFactsPlain(picked, framed);

  const age = FLOWS_ASK.briefAge(index, new Date(), FLOWS_LIVE.memoizedClock());

  const spend = await askSpend(env);
  const base = {
    answer: plain, llm: false, guard: null, why, capped,

    withheld: withheld || null,

    subject: sel.subjectApplied && subject ? subject : null,
    subjectApplied: sel.subjectApplied === true,
    neuronFacts,
    dossierFacts: dossier.facts.length,
    facts: picked, silences: index.silences || null,
    briefUpdatedAt: updatedAt || null, model: null, note: null, spend,
    session: age,
  };

  const chain = chainFor(env, "ask");
  if (!env.AI || !chain.length) {
    return json({ ...base,
      note: "No model is configured for this site, so this reading is the " +
        "pipeline's own wording. Every figure in it was measured." });
  }

  const built = FLOWS_ASK.promptFor(dossier.facts.length ? selected.concat(dossier.promptFacts) : selected, framed, age);
  const system = dossier.facts.length ? built.system + "\n\n" + dossier.rule : built.system;
  const user = dossier.about ? built.user + "\n\n" + dossier.about : built.user;
  let afterCall = null;
  let recorded = false;
  const said = await aiCall(env, aiDeps(env), { surface: "ask", chain,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    opts: { maxTokens: 1024, temperature: 0.2 },
    onUsage: async (billed, usage) => { recorded = (await askRecordSpend(env, usage, billed)) !== null || recorded; } });
  if (recorded) afterCall = await askSpendStrict(env).catch(() => null);
  const model = said.model;
  const fallback = fallbackNote(said);

  if (said.failure) {
    const failed = said.failure;
    const first = said.attempts[0];
    const afterEmpty = said.attempts.length > 1 && first && first.failed === null;
    const thrown = afterEmpty ? null
      : thrownThenEmptyNote(said.attempts, first && (FALLBACK_FAILED[first.failed] || FALLBACK_FAILED.unreachable));
    const told = afterEmpty
      ? emptyNote(said.attempts) +
        ", and the fallback model asked after it " + FALLBACK_FAILED[failed.why] +
        ", so this reading is the pipeline's own wording. Every figure in it was measured."
      : thrown
        ? thrown + ", so this reading is the pipeline's own wording. Every figure in it was measured."
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
  await said.call.settle(guard.ok ? { llm: true, guard: null } : { llm: false, guard: guard.forecast ? "forecast" : "invented" }, guard.ok ? "" : guard.rejected[0]);
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

const CHAIN_TTL_SECONDS = 120;

const CHAIN_PAGE_SIZE = 500;

const INFO_TTL_SECONDS = 6 * 3600;

const CHAIN_REFRESH_FLOOR_SECONDS = 15;
const VENDOR_COPY_KEEP_SECONDS = 6 * 3600;

const UW_DEADLINE_MS = RT_LIMITS.callTimeoutMs;

const UW_OHLC_DEADLINE_MS = 6000;

const UW_CHAIN_DEADLINE_MS = 8000;

const UW_DOSSIER_DEADLINE_MS = 20000;

async function uwFetch(env, path, params, opts) {
  if (!env.UW_API_KEY) throw new HttpError(503, "chain_unconfigured", "Live chain lookup is not configured");
  const url = vendorUrl(vendorBase(env), path, params);
  const deadlineMs = opts && Number.isFinite(opts.deadlineMs) && opts.deadlineMs > 0 ? opts.deadlineMs : UW_DEADLINE_MS;
  const signal = AbortSignal.timeout(deadlineMs);
  const failed = (message) => signal.aborted
    ? new HttpError(504, "chain_timeout", "Market data provider did not answer within " + deadlineMs + " ms")
    : new HttpError(502, "chain_upstream", message);
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: "Bearer " + env.UW_API_KEY, Accept: "application/json" },
      signal,
    });
  } catch {
    throw failed("Market data provider unreachable");
  }
  if (response.status === 429) throw Object.assign(new HttpError(429, "chain_rate_limited", "Market data provider is rate limiting"), { upstream: 429 });
  if (!response.ok) throw Object.assign(new HttpError(502, "chain_upstream", "Market data provider returned an error"), { upstream: response.status });

  const maxBytes = opts && Number.isFinite(opts.maxBytes) && opts.maxBytes > 0 ? opts.maxBytes : null;
  const tooLarge = () => new HttpError(502, "chain_too_large", "Market data provider body is over the parse ceiling");
  if (maxBytes !== null) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      if (response.body) response.body.cancel().catch(() => {});
      throw tooLarge();
    }
    let text;
    try {
      text = await response.text();
    } catch {
      throw failed("Market data provider returned malformed data");
    }
    if (text.length > maxBytes) throw tooLarge();
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(502, "chain_upstream", "Market data provider returned malformed data");
    }
  }
  try {
    return await response.json();
  } catch {
    throw failed("Market data provider returned malformed data");
  }
}

async function cachedTickerInfo(env, ctx, ticker, vf) {
  const key = internalKey("info", ticker);
  const cache = edgeCache.handle();
  if (cache) {
    const hit = await edgeCache.get(key);
    if (hit) return hit.json().catch(() => null);
  }
  const raw = await vf(`/api/stock/${encodeURIComponent(ticker)}/info`, {})
    .catch(keepRefusal(null));
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
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(edgeCache.put(key, store));
    else await edgeCache.put(key, store);
  }
  return out;
}

async function quoteResponse(env, ctx, ticker, allowed) {
  try {
    return await FLOWS_LIVE.serveQuote(env, ctx, ticker, Date.now(), {
      json, build: () => buildLivePayload(env, ticker), allowed });
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return json({ ticker, status: "unavailable", why: error.code,
      readAt: new Date().toISOString(), price: null, prevClose: null, changePct: null,
      open: null, high: null, low: null, volume: null, marketTime: null, tapeTime: null },
    200, { "Cache-Control": "no-store", "X-Server-Now": String(Date.now()) });
  }
}

const OVERLAID = Object.freeze({ pulse: "live:market", flowalerts: "live:alerts", news: "live:news" });

async function readWithOverlay(env, key) {
  if (!env.DB) return { stored: null, overlaid: null, failed: true };
  await ensureFlowsTables(env);
  const now = Date.now();
  const rows = await FLOWS_LIVE.readOverlayRows(env.DB, key, OVERLAID[key], now).catch(() => null);
  if (!rows) {
    const trace = {};
    const stored = await readFlowsPayload(env, key, trace);
    return { stored, overlaid: null, failed: !!trace.failed };
  }
  const { nightly: stored, live, clock } = rows;
  if (!live) return { stored, overlaid: null, failed: false };
  try {
    const overlaid = key === "flowalerts"
      ? FLOWS_LIVE.overlayFlowalerts(stored ? { session: stored.fresh && stored.fresh.session } : null, live, now, clock)
      : key === "news" ? FLOWS_LIVE.overlayNews(stored, live, now, clock, { json })
        : stored ? FLOWS_LIVE.overlayPulse(stored, live, now, clock, { json }) : null;
    return { stored, overlaid, failed: false };
  } catch {
    return { stored, overlaid: null, failed: false };
  }
}

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

async function serveCachedVendorRead({ env, ctx, cacheKey, wantsRefresh, build, ttlSeconds, gate }) {
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : CHAIN_TTL_SECONDS;
  const keep = Math.max(ttl, VENDOR_COPY_KEEP_SECONDS);
  const cache = edgeCache.handle();

  const match = cache ? await cache.match(cacheKey) : null;
  const storedAt = match ? Number(match.headers.get("X-Chain-Stored")) : NaN;
  const ageSeconds = Number.isFinite(storedAt) ? (Date.now() / 1000) - storedAt : Infinity;
  const hit = match && ageSeconds < keep ? match : null;

  const serveCached = hit && ageSeconds < (wantsRefresh ? CHAIN_REFRESH_FLOOR_SECONDS : ttl);
  if (serveCached) {
    const out = new Response(hit.body, hit);
    out.headers.set("X-Chain-Cache", wantsRefresh ? "throttled" : "hit");
    out.headers.set("X-Chain-Age", String(Math.max(0, Math.round(ageSeconds))));

    out.headers.set("Cache-Control", "no-store");
    return out;
  }

  const refuse = () => {
    if (!hit) {
      throw new HttpError(429, "rate_limited", "Too many market data reads in the last minute; try again shortly.",
        { "Retry-After": String(MEMBER_VENDOR_PERIOD_S) });
    }
    const out = new Response(hit.body, hit);
    out.headers.set("X-Chain-Cache", "throttled");
    out.headers.set("X-Chain-Age", String(Math.max(0, Math.round(ageSeconds))));
    out.headers.set("Cache-Control", "no-store");
    out.headers.set("X-Fresh-State", "stale");
    out.headers.set("X-Fresh-Reason", "throttled");
    out.headers.set("X-Fresh-Throttled", "1");
    return out;
  };

  if (gate && !(await gate.member())) return refuse();

  let payload;
  try {
    payload = await build(gate ? chargedFetch(env, gate) : (path, params, opts) => uwFetch(env, path, params, opts));
  } catch (error) {
    if (error instanceof VendorRefused) return refuse();
    throw error;
  }
  const body = JSON.stringify(payload);

  if (cache) {
    const store = new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `max-age=${keep}`,
        "X-Chain-Stored": String(Math.floor(Date.now() / 1000)),
      },
    });

    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(edgeCache.put(cacheKey, store));
    else await edgeCache.put(cacheKey, store);
  }

  return json(payload, 200, { "Cache-Control": "no-store", "X-Chain-Cache": "miss", "X-Chain-Age": "0" });
}

function chainReadMs(env) {
  if (vendorRedirected(env) && env.UW_NOW) {
    const pinned = Date.parse(env.UW_NOW);
    if (Number.isFinite(pinned)) return pinned;
  }
  return Date.now();
}

function offMarketChain(list, ivBasis, rankBy) {
  return {
    rows: [],
    gated: {
      unpriceable: 0, nonStandard: 0, offMarket: list.length, spread: 0, openInterest: 0,
      premium: 0, expiry: 0, strategy: 0,
    },
    screened: list.length,
    priced: 0,
    ivBasis,
    rankedBy: rankBy,
    gates: DEFAULT_GATES,
    forwards: [],
    ivSurface: {
      ...ivSurface([], { ivBasis }),
      reason: "the chain and the underlying's price do not belong to the same moment, so no smile is drawn",
    },
  };
}

async function buildChainPayload(env, ctx, vf, { ticker, strategy, rankBy, limit }) {
  const t = encodeURIComponent(ticker);
  const chainPage = (page) => vf(`/api/stock/${t}/option-contracts`, {

    maybe_otm_only: "true",
    exclude_zero_oi_chains: "true",
    limit: CHAIN_PAGE_SIZE,
    ...(page > 1 ? { page } : {}),
  }, { deadlineMs: UW_CHAIN_DEADLINE_MS });

  const cardPending = keepAlive(ctx, readCardWithEngine(env, ticker).catch(() => null));
  const [firstPage, candles, state, info, cardRead] = await Promise.all([
    chainPage(1),
    vf(`/api/stock/${t}/ohlc/1d`, { timeframe: "5D" }, { deadlineMs: UW_OHLC_DEADLINE_MS }),

    vf(`/api/stock/${t}/stock-state`, {}).catch(keepRefusal(null)),

    cachedTickerInfo(env, ctx, ticker, vf),
    cardPending,
  ]);
  const readMs = chainReadMs(env);

  const unwrap = (r) => (Array.isArray(r) ? r : (r && r.data) || []);
  const rows = unwrap(firstPage);
  const bars = unwrap(candles);
  if (!rows.length) throw new HttpError(404, "chain_empty", "No listed options found for that symbol");

  let truncated = false;
  if (rows.length >= CHAIN_PAGE_SIZE) {
    const second = unwrap(await chainPage(2).catch(keepRefusal([])));
    for (const r of second) rows.push(r);

    truncated = second.length >= CHAIN_PAGE_SIZE;
  }

  const print = printOf({ state, bars, readMs });
  if (print === null) throw new HttpError(502, "chain_no_spot", "No regular-session price for that symbol");

  const asOf = etDayOf(readMs);
  const live = stateOf(state);

  const engineRate = cardRead && cardRead.card && cardRead.card.engine && cardRead.card.engine.rate &&
    Number.isFinite(cardRead.card.engine.rate.r) ? cardRead.card.engine.rate.r : PRICING_RATE;
  let found;
  try {
    found = coherence({
      rows, spot: print.spot, asOf, printSource: print.source, readMs, rate: engineRate, ticker,
    });
  } catch (error) {
    logFailure("warn", "chain coherence check failed", { ticker }, error);
    found = { status: "unchecked", spot: print.spot, printSpot: print.spot, impliedSpot: null, offMarket: [] };
  }
  const spot = found.spot;

  const ranked = found.status === "mismatch"
    ? offMarketChain(rows, "not read: the quotes and the price disagree", rankBy)
    : rankChain(rows, {
      spot, asOf, strategy, rankBy, limit, ticker, readMs, rate: engineRate,
      carry: deskCarry(cardRead && cardRead.card && cardRead.card.engine && cardRead.card.engine.facts, found.status),
    });

  const earnDate = info ? info.nextEarningsDate : null;
  const noEarnings = info ? earnDate === null && hasNoEarnings(info.issueType) : false;
  for (const row of ranked.rows) {
    row.crossesEarnings = !info ? null
      : noEarnings ? false
        : crossesEarnings(row.expiry, earnDate, info.announceTime, { asOf });
  }
  return {
    ticker, spot, asOf,
    sessionDate: print.sessionDate,
    spotSource: print.source === "stock-state" ? "stock-state" : "daily-close",

    basis: {
      status: found.status,
      spot,
      printSpot: found.printSpot,
      printSource: print.source,
      printNote: print.note,
      impliedSpot: found.impliedSpot,
      offMarket: found.offMarket.length,
    },

    marketTime: print.marketTime,
    tapeTime: print.tapeTime,
    prevClose: numOrNull(live && live.prev_close) > 0 ? numOrNull(live.prev_close) : print.spot,
    strategy, ...ranked,

    truncated,
    pageSize: CHAIN_PAGE_SIZE,

    earnings: info
      ? { date: earnDate, announceTime: info.announceTime, issueType: info.issueType,
        past: earnDate !== null && earnDate < asOf }
      : null,
    engine: deskEngine(cardRead && cardRead.card, Date.now()),
    generatedAt: new Date(readMs).toISOString(),
  };
}

function deskEngine(card, nowMs) {
  const block = card && card.engine && typeof card.engine === "object" && Array.isArray(card.engine.facts) ? card.engine : null;
  if (!block) return { status: "unavailable", reason: card ? "this name's card carries no engine block" : "no card is published for this name" };
  return {
    status: "ok", v: QUANT_CARD_VERSION, cardSession: card.sessionDate || null, asOf: block.asOf || null,
    rate: block.rate || null, pLaw: block.pLaw || null, event: block.event || null, facts: block.facts,
    levels: block.levels || null, state: block.state || null, expiries: deskSmiles(block.expiries),
    stale: engineStale({
      cardSession: card.sessionDate, blockAsOf: block.asOf,
      expectedSession: card.sessionDate ? FLOWS_ASK.briefAge({ sessionDate: card.sessionDate }, new Date(nowMs), FLOWS_LIVE.memoizedClock(nowMs)).expected : null,
    }),
  };
}

const STRATEGY_INDEX = "SPY";


const STRATEGY_PAGES_PER_TYPE = 2;

async function cachedIndexSpot(env, ctx, vf) {
  const key = internalKey("index", STRATEGY_INDEX);
  const cache = edgeCache.handle();
  if (cache) {
    const hit = await edgeCache.get(key);
    if (hit) return hit.json().catch(() => null);
  }
  const raw = await vf(`/api/stock/${STRATEGY_INDEX}/stock-state`, {}).catch(keepRefusal(null));
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
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(edgeCache.put(key, store));
    else await edgeCache.put(key, store);
  }
  return out;
}

const unwrapRows = (r) => (Array.isArray(r) ? r : (r && r.data) || []);

async function buildStrategyContext(env, ctx, vf, ticker) {
  const t = encodeURIComponent(ticker);
  const [breakdown, candles, state, info] = await Promise.all([
    vf(`/api/stock/${t}/expiry-breakdown`, {}, { deadlineMs: UW_OHLC_DEADLINE_MS }).catch(keepRefusal(null)),
    vf(`/api/stock/${t}/ohlc/1d`, { timeframe: "5D" }, { deadlineMs: UW_OHLC_DEADLINE_MS }),
    vf(`/api/stock/${t}/stock-state`, {}).catch(keepRefusal(null)),
    cachedTickerInfo(env, ctx, ticker, vf),
  ]);
  const readMs = chainReadMs(env);

  const print = printOf({ state, bars: unwrapRows(candles), readMs });
  if (print === null) throw new HttpError(502, "chain_no_spot", "No regular-session price for that symbol");
  const spot = print.spot;
  const live = stateOf(state);
  const asOf = print.sessionDate;
  if (!asOf) throw new HttpError(502, "chain_no_spot", "No usable session date for that symbol");

  const readExpiries = (raw) => readExpiryBreakdown(unwrapRows(raw));

  let expiries = readExpiries(breakdown);

  let expiryDate = null;
  if (breakdown !== null && !expiries.length && asOf) {
    const retry = await vf(`/api/stock/${t}/expiry-breakdown`, { date: asOf }, { deadlineMs: UW_OHLC_DEADLINE_MS })
      .catch(keepRefusal(null));
    if (retry !== null) {
      const dated = readExpiries(retry);
      if (dated.length) { expiries = dated; expiryDate = asOf; }
    }
  }

  let expirySource = "breakdown";
  if (breakdown !== null && !expiries.length && asOf) {
    const exposure = await vf(`/api/stock/${t}/greek-exposure/expiry`, {}, { deadlineMs: UW_OHLC_DEADLINE_MS })
      .catch(keepRefusal(null));
    if (exposure !== null) {
      const listed = readExpiries(exposure)
        .filter((e) => e.expiry >= asOf)
        .map((e) => ({ expiry: e.expiry, chains: null, oi: null, volume: null }));
      if (listed.length) { expiries = listed; expirySource = "exposure"; }
    }
  }

  const index = await cachedIndexSpot(env, ctx, vf);

  return {
    mode: "context",
    ticker, spot, asOf,
    spotSource: print.source === "stock-state" ? "stock-state" : "daily-close",
    basis: {
      status: "unchecked", spot, printSpot: spot, printSource: print.source, printNote: print.note,
      impliedSpot: null, offMarket: 0,
    },
    marketTime: print.marketTime,
    tapeTime: print.tapeTime,
    prevClose: numOrNull(live && live.prev_close) ?? print.spot,

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

function strategyEngine({ ticker, expiry, calls, puts, spot, card, nowMs }) {
  const block = card && card.engine && typeof card.engine === "object" && Array.isArray(card.engine.facts) ? card.engine : null;
  const book = bookRows(calls, puts, optionRoot(ticker));
  const rows = book.length ? [{ expiry, rows: book }] : [];
  if (!rows.length) return { status: "unavailable", reason: "no contract on this expiry parsed as the ticker's own" };
  if (!(spot > 0)) return { status: "unavailable", reason: "no live spot to price against" };
  const state = block && block.state ? block.state
    : card && card.panels ? engineState(FLOWS_NEURON.regimeState(card, {})) : engineState(null);
  const out = runCardEngine({
    ticker, asOfMs: nowMs, spot, expiries: rows,
    rate: block && block.rate ? block.rate : null,
    facts: block ? block.facts : [], state, pLaw: block ? block.pLaw : null,
    levels: block ? block.levels : null, event: block ? block.event : null,
    atr: block ? block.atr : null, fits: true,
    stale: engineStale({
      cardSession: card ? card.sessionDate : null, blockAsOf: block ? block.asOf : null,
      expectedSession: card && card.sessionDate ? FLOWS_ASK.briefAge({ sessionDate: card.sessionDate }, new Date(nowMs), FLOWS_LIVE.memoizedClock(nowMs)).expected : null,
    }),
  });
  return {
    status: "ok", v: QUANT_CARD_VERSION, cardSession: card ? card.sessionDate || null : null,
    lawFrom: block && block.pLaw ? "card" : null, ...out,
  };
}

async function buildStrategyExpiry(env, ctx, vf, ticker, expiry, { engine = false } = {}) {
  const t = encodeURIComponent(ticker);
  const page = (optionType, n) => vf(`/api/stock/${t}/option-contracts`, {

    expiry,
    option_type: optionType,
    limit: CHAIN_PAGE_SIZE,
    ...(n > 1 ? { page: n } : {}),
  }, { deadlineMs: UW_CHAIN_DEADLINE_MS });

  const cardPending = engine ? keepAlive(ctx, readCardWithEngine(env, ticker).catch(() => null)) : Promise.resolve(null);
  const [callsFirst, putsFirst, liveState, cardRead] = await Promise.all([
    page("call", 1), page("put", 1),
    engine ? vf(`/api/stock/${t}/stock-state`, {}).catch(keepRefusal(null)) : Promise.resolve(null),
    cardPending,
  ]);

  const gather = async (optionType, first) => {
    const rows = unwrapRows(first);
    let truncated = false;
    if (rows.length >= CHAIN_PAGE_SIZE) {
      for (let n = 2; n <= STRATEGY_PAGES_PER_TYPE; n++) {
        const next = unwrapRows(await page(optionType, n).catch(keepRefusal([])));
        for (const r of next) rows.push(r);

        truncated = next.length >= CHAIN_PAGE_SIZE;
        if (!truncated) break;
      }
    }
    return { rows, truncated };
  };

  const [calls, puts] = await Promise.all([gather("call", callsFirst), gather("put", putsFirst)]);

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

  let engineBlock = null;
  if (engine) {
    const live = liveState && !Array.isArray(liveState) ? (liveState.data && !Array.isArray(liveState.data) ? liveState.data : liveState) : null;
    const spotLive = numOrNull(live && live.close);
    const card = cardRead && cardRead.card ? cardRead.card : null;
    const spot = spotLive !== null && spotLive > 0 ? spotLive : card && card.engine && numOrNull(card.engine.spot);
    try {
      engineBlock = strategyEngine({ ticker, expiry, calls: callRows, puts: putRows, spot, card, nowMs: Date.now() });
      engineBlock.spotSource = spotLive !== null && spotLive > 0 ? "stock-state" : spot ? "card" : null;
    } catch (error) {
      engineBlock = { status: "unavailable", reason: "the engine failed on this expiry: " + (errorText(error)) };
    }
  }

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
    ...(engine ? { engine: engineBlock } : {}),
    generatedAt: new Date().toISOString(),
  };
}

function startFlowsSchemaFlight(env) {
  const flight = (async () => {
    try {
      await applySchema(env.DB);
      state.flowsSchemaReady = true;
    } catch (error) {
      logFailure("warn", "flows schema bootstrap failed", {}, error);
    }
  })().finally(() => { if (state.flowsSchemaFlight === flight) state.flowsSchemaFlight = null; });
  state.flowsSchemaFlight = flight;
  return flight;
}
async function ensureFlowsTables(env) {
  if (state.flowsSchemaReady || !env.DB) return;
  const since = Date.now();
  let abandoned = 0;
  for (let attempt = 0; attempt < 2 && !state.flowsSchemaReady; attempt++) {
    const flight = state.flowsSchemaFlight || startFlowsSchemaFlight(env);
    if (await FLOWS_LIVE.settledWithin(flight, FLOWS_LIVE.FLIGHT_WAIT_MS, () => state.flowsSchemaReady)) break;
    if (state.flowsSchemaFlight === flight) { state.flowsSchemaFlight = null; abandoned++; }
  }
  if (abandoned) FLOWS_LIVE.flightAbandoned("schema", since, abandoned, state.flowsSchemaReady);
}

function flowsThrottleKey(request, username, members) {
  return throttleBucket(username, members) + "|" + throttleAddress(request.headers.get("CF-Connecting-IP"));
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
  const now = Date.now();
  const next = nextFailureState(previous, now);
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM flows_login_failures WHERE username = ? AND first_at < ?").bind(username, staleFailureCutoff(now)),
      env.DB.prepare(
        "INSERT INTO flows_login_failures (username, failures, first_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(username) DO UPDATE SET failures = excluded.failures, first_at = excluded.first_at"
      ).bind(username, next.failures, next.first_at),
    ]);
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

  const cache = request.method === "GET" ? edgeCache.handle() : null;
  const cacheKey = cache ? new Request(url.origin + meta.path) : null;
  if (cacheKey) {
    const hit = await edgeCache.get(cacheKey);
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
      const base = "/assets/data/courses/" + encodeURIComponent(meta.id) + "/";
      el.prepend('<link rel="preload" as="fetch" crossorigin="anonymous" href="' + base + "manifest.json" + query + '">' +
        '<link rel="preload" as="fetch" crossorigin="anonymous" href="' + base + encodeURIComponent(meta.modules[0].id) + ".json" + query + '">', { html: true });
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

const ROUTER = createRouter(flowsReadRows({ readServed, readFlowsPayload, readWithOverlay, passthrough, recallLastGood, storeGone,
  absentKey, cardWithEngine, briefWithLive, nightlyFreshHeaders, splitEngineMark: SPLIT_ENGINE_MARK }),
flowsDeskRows({ vendorGate, serveCachedVendorRead, buildChainPayload, buildStrategyContext, buildStrategyExpiry, quoteResponse }),
flowsAiRows({ askSpend, summaryResponse, readFlowsSummary, neuronProvenance, ensureFlowsTables, dossierResponse, askQuestion, askAnswer,
  readFlowsPayload, briefWithLive, askFloodPeriodS: ASK_FLOOD_PERIOD_S }),
flowsIngestRows({ store: FLOWS_STORE, ensureFlowsTables, storeGone, passthrough }));

async function route(request, env, url, ctx) {
  const path = url.pathname;
  const origin = url.origin;

  const routed = await ROUTER.handle({ request, env, url, ctx }, { flows: currentFlowsUser });
  if (routed !== null) return routed;

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
      await recordSignIn(env.DB, user, Date.now());

      const session = await signSession(
        { sub: user.sub, email: user.email, name: user.name, aud: LEARN_AUDIENCE,
          exp: Date.now() + LAB_SESSION_MS },
        env.SESSION_SECRET
      );
      return redirect(origin + "/lab/?auth=ok", 302, [
        cookie("session", session, { maxAge: LAB_SESSION_MS / 1000 }),
        cookie("oauth_state", "", { maxAge: 0 }),
      ]);
    } catch (error) {
      logFailure("error", "oauth callback failed", {}, error);
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

    return new Response(await loadMarketSnapshot(env, ctx), {
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
    await requireLabWrite(env, user);
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
    await requireLabWrite(env, user);
    const generation = await mutationGeneration(request, env, user.id);
    const body = await readJSON(request);
    const day = normalizeActivityDay(body.day);
    const itemId = canonicalSkillItem(body.itemId);
    if (typeof body.skillId !== "string" || !Object.hasOwn(SKILL_BY_ID, body.skillId) || typeof body.itemId !== "string" || !validSkillItem(body.skillId, itemId) || typeof body.attemptId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.attemptId) || typeof body.correct !== "boolean" || typeof body.hinted !== "boolean" || !day) {
      throw new HttpError(400, "invalid_skill_attempt", "Skill, item, and attempt data must be valid");
    }
    const correct = body.correct ? 1 : 0, hinted = body.hinted ? 1 : 0, now = Date.now();
    const results = await academyBatch(env, user.id, () => [
      env.DB.prepare(
        "INSERT INTO skill_attempts (user_id, attempt_id, skill_id, item_id, correct, hinted, attempt_day, applied, received_at) " +
        "SELECT ?, ?, ?, ?, ?, ?, ?, 0, ? WHERE EXISTS (SELECT 1 FROM learning_sync WHERE user_id=? AND generation=?) " +
        "ON CONFLICT(user_id, attempt_id) DO NOTHING RETURNING attempt_id"
      ).bind(user.id, body.attemptId, body.skillId, itemId, correct, hinted, day, now, user.id, generation),
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
    ]);
    const currentGeneration = normalizeGeneration(results[5].results[0]?.generation);
    if (currentGeneration !== generation) throwResetRequired(currentGeneration);
    const attempt = results[6].results[0];
    if (!attempt) throw new Error("Skill attempt was not recorded");
    if (attempt.skill_id !== body.skillId || attempt.item_id !== itemId || Number(attempt.correct) !== correct || Number(attempt.hinted) !== hinted || attempt.attempt_day !== day) throw new HttpError(409, "attempt_conflict", "Attempt id was already used for different data");
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
    await requireLabWrite(env, user);
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
    await requireLabWrite(env, user);
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
    await requireLabWrite(env, user);

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
      await requireLabWrite(env, user);
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
    await requireLabWrite(env, user);
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
    await requireLabWrite(env, user);
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

  if (path === "/flows/login/") {
    requireMethod(request, ["GET", "HEAD"]);
    return new Response(FLOWS_PAGES.loginPage(), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (path === "/flows/login") {
    requireMethod(request, ["POST"]);
    requireSameOrigin(request);
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (!(await memberAllowed(env.LOGIN_IP, { username: throttleAddress(clientIp) }))) return flowsLoginLimited();
    if (!env.SESSION_SECRET) throw new HttpError(503, "unavailable", "Sign-in is not configured");

    const credentials = parseCredentials(env.FLOWS_CREDENTIALS);

    if (!credentials || !env.FLOWS_PEPPER) {
      throw new HttpError(503, "unavailable", "Sign-in is not configured");
    }
    const form = await readFlowsForm(request);
    const username = String(form.get("username") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");

    if (!(await memberAllowed(env.LOGIN_NAME, { username: loginNameKey(username, clientIp) }))) return flowsLoginLimited();

    const throttleKey = flowsThrottleKey(request, username, credentials);
    const locked = await flowsLockRecord(env, throttleKey);
    if (isLocked(locked)) {
      return flowsLoginResponse(FLOWS_LOGIN_LIMITED);
    }

    const verified = await verifyCredential(username, password, credentials, env.FLOWS_PEPPER);
    if (!verified) {

      await recordFlowsFailure(env, throttleKey, locked);
      return flowsLoginResponse("Those credentials were not recognised.");
    }

    if (!throttleKey.startsWith(THROTTLE_SHARED_BUCKET + "|")) await clearFlowsFailures(env, throttleKey);
    const session = await signFlowsSession(
      verified, env.SESSION_SECRET, FLOWS_SESSION_TTL_SECONDS, sessionEpoch(env),
      memberOf(credentials, verified).epoch,
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

  if (path.startsWith("/api/flows/")) {

    requireMethod(request, ["GET"]);
    const session = await currentFlowsUser(request, env);
    if (!session) throw new HttpError(401, "unauthorized", "Authentication required");

    if (path === "/api/flows/lk") {
      await ensureFlowsTables(env);
      return FLOWS_LIVE.serveLiveKey(env, url, Date.now(), { json, HttpError });
    }

    if (path === "/api/flows/now") {
      await ensureFlowsTables(env);
      return FLOWS_LIVE.serveNow(env, url, Date.now(), { json, HttpError,
        quote: async (t) => (await quoteResponse(env, ctx, t, vendorGate(env, session))).json() });
    }

    if (path === "/api/flows/tape") {
      const ticker = requireTicker(url);
      await ensureFlowsTables(env);
      const gate = vendorGate(env, session);
      return FLOWS_LIVE.serveTape(env, ctx, ticker, Date.now(), {
        json, allowed: gate, member: gate.member, fetchVendor: (p, params) => uwFetch(env, p, params, { deadlineMs: LIVE_BUDGET.tier1TimeoutMs }),
        admit: await tapeAdmission(env, ctx, ticker, gate) });
    }

    throw new HttpError(404, "not_found", "API route not found");
  }

  if (path.startsWith("/flows/")) {
    throw new HttpError(404, "not_found", "Not found");
  }

  if (path.startsWith("/api/rt/")) {
    return serveRt(request, env, url, { json, HttpError, requireSameOrigin, getSession: () => currentFlowsUser(request, env) });
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
    if (url.pathname.startsWith("/api/flows/") && !out.headers.has("X-Server-Now")) {
      out.headers.set("X-Server-Now", String(Date.now()));
    }
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
    const at = event && Number.isFinite(event.scheduledTime) ? event.scheduledTime : Date.now();
    const guard = (message, promise) => ctx.waitUntil(Promise.resolve(promise).catch((error) => {
      logFailure("error", message, {}, error);
    }));

    const job = FLOWS_LIVE.cronJob(event && event.cron, at);
    if (job === "rth") {
      guard("flows rth tick failed", (async () => {
        await ensureFlowsTables(env);
        return FLOWS_LIVE.rthTick(env, at, { fetchVendor: (p, params) => uwFetch(env, p, params, { deadlineMs: LIVE_BUDGET.tier1TimeoutMs }) });
      })());
      return;
    }
    if (job === "focus") {
      guard("flows focus tick failed", (async () => {
        await ensureFlowsTables(env);
        return FLOWS_LIVE.focusTick(env, at, { fetchVendor: (p, params) => uwFetch(env, p, params, { deadlineMs: LIVE_BUDGET.tier1TimeoutMs }) });
      })());
      return;
    }
    if (job === "summary") {
      guard("flows summary refresh failed", summaryFiring(env, at));
      return;
    }

    guard("market refresh failed", refreshMarketSnapshotIfDue(env, at));

    guard("flows nightly dispatch failed", (async () => {
      await ensureFlowsTables(env);
      await FLOWS_LIVE.nightlyTick(env, at);
      if (FLOWS_LIVE.pruneDue(at)) {
        await FLOWS_LIVE.pruneTape(env, at);
        await FLOWS_LIVE.pruneLedger(env, at);
        await pruneAiOutcomes(env, at);
        await pruneAttemptLedgers(env, at);
        await pruneLoginFailures(env, at);
      }
    })());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      const response = await route(request, env, url, ctx);
      rememberLastGood(request, url, response, ctx);
      return finalize(response, request, url);
    } catch (error) {
      if (error instanceof HttpError) {
        const kept = error.code === "store_unreadable" ? await recallLastGood(request, url) : null;
        if (kept) return finalize(kept, request, url);
        return finalize(apiError(error.status, error.code, error.message, error.headers, error.details), request, url);
      }
      logFailure("error", "request failed", { method: request.method, path: url.pathname }, error);
      if (isStoreQuota(error)) {
        return finalize(apiError(503, "store_quota", "The store's daily quota is spent; it resets at 00:00 UTC",
          { "Retry-After": String(secondsToUtcMidnight(Date.now())) }), request, url);
      }
      return finalize(apiError(500, "internal_error", "Internal server error"), request, url);
    }
  },
};
