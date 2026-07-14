/* =============================================================
   worker.js — Cloudflare Worker (Static Assets + API).
   Runs before every asset request, applies response policy, serves
   topic-specific course metadata, and handles Google auth + D1 sync.
   ============================================================= */
import { signSession, verifySession, getCookie, cookie } from "./shared/session.js";
import { COURSE_STAGE_POINTS } from "./shared/course-points.js";
import { COURSE_BY_ID, COURSE_BY_SLUG, COURSE_TOPICS, SITE_ORIGIN } from "./shared/course-seo.js";
import { REVIEW_ITEM_BY_ID } from "./shared/review-manifest.js";

const COURSE_ASSET_PATH = "/lab/course";
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

async function readJSON(request) {
  const contentType = request.headers.get("Content-Type") || "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }

  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) {
    throw new HttpError(413, "payload_too_large", "JSON body is too large");
  }
  if (!request.body) throw new HttpError(400, "invalid_json", "A JSON body is required");

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "payload_too_large", "JSON body is too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
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

async function masteryBatch(env, userId, buildStatements) {
  try {
    return await learningBatch(env, userId, buildStatements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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

function syncDerivedPointsStatement(env, userId, now = Date.now()) {
  return env.DB.prepare(
    "WITH weights(model_id, stage_index, points) AS (" +
      "SELECT courses.key, CAST(stages.key AS INTEGER), CAST(stages.value AS INTEGER) " +
      "FROM json_each(?) AS courses, json_each(courses.value) AS stages" +
    "), completed(model_id, stage_index) AS (" +
      "SELECT DISTINCT p.model_id, CAST(done.value AS INTEGER) " +
      "FROM progress AS p, json_each(CASE WHEN json_valid(p.done_json) THEN p.done_json ELSE '[]' END) AS done " +
      "WHERE p.user_id=? AND done.type='integer'" +
    "), derived(points) AS (" +
      "SELECT COALESCE(SUM(weights.points), 0) FROM completed " +
      "JOIN weights USING (model_id, stage_index)" +
    ") INSERT INTO stats (user_id, points, streak, last, updated_at) " +
    "SELECT ?, derived.points, 0, NULL, ? FROM derived WHERE 1 " +
    "ON CONFLICT(user_id) DO UPDATE SET points=excluded.points, " +
    "updated_at=MAX(COALESCE(stats.updated_at, 0), excluded.updated_at)"
  ).bind(JSON.stringify(COURSE_STAGE_POINTS), userId, userId, now);
}

async function syncDerivedPoints(env, userId) {
  await syncDerivedPointsStatement(env, userId).run();
}

async function loadStatsSnapshot(env, userId) {
  const read = async () => {
    const results = await learningBatch(env, userId, () => [
      env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id = ?").bind(userId),
      env.DB.prepare(
        "SELECT points, streak, last FROM stats WHERE user_id = ?"
      ).bind(userId),
    ]);
    const syncResult = results[1];
    const statsResult = results[2];
    const sync = syncResult.results[0];
    if (!sync) throw new Error("Learning sync state is missing");
    return {
      generation: normalizeGeneration(sync.generation),
      row: statsResult.results[0] || null,
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
      points: Number(snapshot.row && snapshot.row.points) || 0,
      streak: Number.isSafeInteger(storedStreak) && storedStreak >= 0 ? Math.min(100000, storedStreak) : 0,
      last: storedLast || null,
    },
  };
}

async function loadBootstrapSnapshot(env, user) {
  const read = async () => {
    // D1 executes a batch in order and rolls it back as a unit on failure. The
    // derived-points repair therefore lands before this response's consistent
    // snapshot without adding four separate browser round trips.
    const results = await placementBatch(env, user.id, () => [
      syncDerivedPointsStatement(env, user.id),
      env.DB.prepare("SELECT generation FROM learning_sync WHERE user_id = ?").bind(user.id),
      env.DB.prepare(
        "SELECT model_id, done_json FROM progress WHERE user_id = ? ORDER BY model_id"
      ).bind(user.id),
      env.DB.prepare(
        "SELECT points, streak, last FROM stats WHERE user_id = ?"
      ).bind(user.id),
      env.DB.prepare(
        "SELECT item_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at " +
        "FROM mastery WHERE user_id = ? ORDER BY item_id"
      ).bind(user.id),
      env.DB.prepare(
        "SELECT band, score, total, completed_day, recommended_topic FROM placement WHERE user_id = ?"
      ).bind(user.id),
    ]);
    const sync = results[2].results[0];
    if (!sync) throw new Error("Learning sync state is missing");
    return {
      generation: normalizeGeneration(sync.generation),
      progress: progressFromRows(results[3].results),
      statsRow: results[4].results[0] || null,
      masteryRows: results[5].results || [],
      placementRow: results[6].results[0] || null,
    };
  };

  let snapshot = await read();
  let storedLast = normalizeActivityDay(snapshot.statsRow && snapshot.statsRow.last);
  if (snapshot.statsRow && snapshot.statsRow.last != null && !storedLast) {
    const poisonedLast = String(snapshot.statsRow.last);
    await env.DB.prepare(
      "UPDATE stats SET streak=0, last=NULL, updated_at=MAX(COALESCE(updated_at, 0), ?) " +
      "WHERE user_id=? AND last=?"
    ).bind(Date.now(), user.id, poisonedLast).run();
    snapshot = await read();
    storedLast = normalizeActivityDay(snapshot.statsRow && snapshot.statsRow.last);
  }

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
      points: Number(snapshot.statsRow && snapshot.statsRow.points) || 0,
      streak: Number.isSafeInteger(storedStreak) && storedStreak >= 0 ? Math.min(100000, storedStreak) : 0,
      last: storedLast || null,
    },
    mastery,
    placement: placementRecord(snapshot.placementRow),
    generation: snapshot.generation,
  };
}

async function currentUser(request, env) {
  const token = getCookie(request, "session");
  if (!token || !env.SESSION_SECRET) return null;
  const payload = await verifySession(token, env.SESSION_SECRET);
  return payload ? { id: payload.sub, email: payload.email || "", name: payload.name || "" } : null;
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
    '<p class="course-fallback__meta">' + escapeHTML(meta.level) + " · 4 modules · Free and browser-based</p>" +
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
    "<p>This free course uses real Python and statsmodels in your browser. Work through the four modules below with explanations, executable examples, interactive controls, and questions.</p>" +
    '<div class="course-outline" id="courseModules">' + modules + "</div>" +
    '<p class="course-overview__byline">Course by <a href="/">Anıl Kaya</a> · ' + escapeHTML(meta.level) + " level</p>" +
    '<h2 class="course-overview__related-title">Explore other econometrics courses</h2>' +
    '<ul class="course-related">' + related + "</ul>" +
    "</section>";
}

async function renderCourse(request, env, url, meta) {
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

  const transformed = new HTMLRewriter()
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
  return rewritten;
}

async function route(request, env) {
  const url = new URL(request.url);
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
        { sub: user.sub, email: user.email, name: user.name, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 },
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
      const results = await placementBatch(env, user.id, () => [
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
    ]);
    const written = results[1].results[0];
    if (!written) throwResetRequired(await loadGeneration(env, user.id));

    await syncDerivedPoints(env, user.id);
    const currentGeneration = await loadGeneration(env, user.id);
    if (currentGeneration !== generation) throwResetRequired(currentGeneration);
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

      await syncDerivedPoints(env, user.id);
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

    await syncDerivedPoints(env, user.id);
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
          "(user_id, item_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at) " +
        "SELECT ?, ?, CASE WHEN ?=1 AND ?=0 THEN 1 ELSE 0 END, date(?, '+1 day'), 1, ?, ?, ?, ? " +
        "WHERE EXISTS (" +
          "SELECT 1 FROM mastery_attempts WHERE user_id=? AND attempt_id=? AND item_id=? AND applied=0" +
        ") ON CONFLICT(user_id, item_id) DO UPDATE SET " +
          "level=CASE WHEN ?=0 THEN 0 WHEN ?=1 THEN MIN(mastery.level, 1) ELSE MIN(5, mastery.level+1) END, " +
          "due_day=date(?, '+' || CASE " +
            "WHEN ?=0 OR ?=1 THEN 1 WHEN mastery.level<=0 THEN 1 WHEN mastery.level=1 THEN 3 " +
            "WHEN mastery.level=2 THEN 7 WHEN mastery.level=3 THEN 21 ELSE 60 END || ' days'), " +
          "attempts=MIN(1000000, mastery.attempts+1), " +
          "correct=MIN(1000000, mastery.correct+?), last_result=?, last_attempt_id=?, " +
          "updated_at=MAX(mastery.updated_at, excluded.updated_at) " +
        "RETURNING item_id, level, due_day, attempts, correct, last_result, last_attempt_id, updated_at"
      ).bind(
        user.id, itemId, correct, hinted, day, correct, correct, attemptId, now,
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
    return renderCourse(request, env, url, meta);
  }

  return env.ASSETS.fetch(request);
}

// Every route passes through this single mutator. When modifying an existing
// response, preserve the response object itself as the init; rebuilding a
// status/header dictionary can corrupt Content-Encoding at Cloudflare's edge.
function finalize(response, request) {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);

  const url = new URL(request.url);
  const contentType = out.headers.get("Content-Type") || "";
  const cacheableMethod = request.method === "GET" || request.method === "HEAD";
  const cacheableStatus = out.status === 200 || out.status === 304;
  if (contentType.includes("text/html")) out.headers.set("Content-Security-Policy", CSP);
  else out.headers.delete("Content-Security-Policy");

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    out.headers.set("Cache-Control", "no-store");
  } else if (contentType.includes("text/html")) {
    out.headers.set("Cache-Control", "no-cache");
    if (request.method === "GET" && !getCookie(request, "cachefix")) {
      out.headers.set("Clear-Site-Data", '"cache"');
      out.headers.append("Set-Cookie", cookie("cachefix", "1", { maxAge: 60 * 60 * 24 * 365 }));
    }
  } else if (cacheableStatus && cacheableMethod && url.searchParams.has("v")) {
    out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (cacheableStatus && cacheableMethod && contentType && !contentType.includes("application/json")) {
    out.headers.set("Cache-Control", "public, max-age=3600");
  }
  return out;
}

export default {
  async fetch(request, env) {
    try {
      return finalize(await route(request, env), request);
    } catch (error) {
      if (error instanceof HttpError) {
        return finalize(apiError(error.status, error.code, error.message, error.headers, error.details), request);
      }
      console.error(JSON.stringify({
        message: "request failed",
        method: request.method,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return finalize(apiError(500, "internal_error", "Internal server error"), request);
    }
  },
};
