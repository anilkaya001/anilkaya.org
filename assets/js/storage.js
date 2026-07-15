/* =============================================================
   storage.js — validated, owner-scoped, failure-safe persistence.

   Learning state is stored separately for the anonymous learner and for
   every verified account. The legacy keys remain an anonymous-only mirror
   during migration so existing learners keep their progress. Guide width is
   deliberately device-wide and is never part of a learning-data reset.
   ============================================================= */
(() => {
  "use strict";

  const ANONYMOUS = "anonymous";
  const FORMAT_VERSION = 2;
  const KEYS = Object.freeze({
    // Legacy keys. These are read and mirrored only for the anonymous scope.
    progress: "iewt:progress",
    gamify: "iewt:gamify",
    progressPrefix: "iewt:progress:v2:",
    gamifyPrefix: "iewt:gamify:v2:",
    masteryPrefix: "iewt:mastery:v2:",
    masteryOutboxPrefix: "iewt:mastery-outbox:v2:",
    placementPrefix: "iewt:placement:v2:",
    syncPrefix: "iewt:sync:v2:",
    stableProgressPrefix: "iewt:progress:v3:",
    skillMasteryPrefix: "iewt:skill-mastery:v3:",
    skillOutboxPrefix: "iewt:skill-outbox:v3:",
    preferencesPrefix: "iewt:preferences:v3:",
    projectsPrefix: "iewt:projects:v3:",
    activeOwner: "iewt:activeOwner",
    guideWidth: "iewt:guideW",
    legacyGuideWidth: "iewt:splitW",
  });
  const memory = new Map();
  // A failed write/removal makes memory authoritative until a later write
  // succeeds. Otherwise readable but stale localStorage can undo this tab's
  // current state after QuotaExceededError or another write-only failure.
  const dirty = new Set();
  let activeOwner = ANONYMOUS;

  const plainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const safeInteger = (value, fallback = 0, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max ? Number(value) : fallback;

  function emit(name, detail) {
    if (typeof document === "undefined" || typeof document.dispatchEvent !== "function") return;
    if (typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent(name, { detail }));
    else document.dispatchEvent(new Event(name));
  }

  function readRaw(key) {
    if (dirty.has(key)) return memory.get(key) ?? null;
    try {
      const value = localStorage.getItem(key);
      if (value != null) memory.set(key, value);
      return value != null ? value : memory.get(key) ?? null;
    } catch { return memory.get(key) ?? null; }
  }

  function writeRaw(key, value) {
    const text = String(value);
    memory.set(key, text);
    try { localStorage.setItem(key, text); dirty.delete(key); }
    catch { dirty.add(key); /* In-memory fallback remains authoritative. */ }
  }

  function removeRaw(key) {
    memory.delete(key);
    try { localStorage.removeItem(key); dirty.delete(key); }
    catch { dirty.add(key); /* Treat the in-memory tombstone as authoritative. */ }
  }

  function parseRaw(key) {
    const raw = readRaw(key);
    if (raw == null) return null;
    try { return JSON.parse(raw); }
    catch { return null; }
  }

  function normalizeOwner(value) {
    if (value == null || value === "" || value === ANONYMOUS) return ANONYMOUS;
    const id = String(value).trim();
    // Account ids come from the verified session endpoint. Bound their size so
    // corrupt or unexpected responses cannot create unbounded storage keys.
    if (!id || id.length > 256 || !/^[A-Za-z0-9._:@-]+$/.test(id)) {
      throw new TypeError("Invalid learning-state owner");
    }
    return `user:${id}`;
  }

  function publicOwner(owner = activeOwner) {
    return owner === ANONYMOUS ? null : owner.slice("user:".length);
  }

  function scopedKey(kind, owner = activeOwner) {
    const prefix = kind === "progress" ? KEYS.progressPrefix :
      kind === "gamify" ? KEYS.gamifyPrefix :
      kind === "mastery" ? KEYS.masteryPrefix :
      kind === "masteryOutbox" ? KEYS.masteryOutboxPrefix :
      kind === "placement" ? KEYS.placementPrefix :
      kind === "stableProgress" ? KEYS.stableProgressPrefix :
      kind === "skillMastery" ? KEYS.skillMasteryPrefix :
      kind === "skillOutbox" ? KEYS.skillOutboxPrefix :
      kind === "preferences" ? KEYS.preferencesPrefix :
      kind === "projects" ? KEYS.projectsPrefix : KEYS.syncPrefix;
    return prefix + encodeURIComponent(owner);
  }

  const v3Kind = (kind) => ["stableProgress", "skillMastery", "skillOutbox", "preferences", "projects"].includes(kind);
  const envelopeVersion = (kind) => v3Kind(kind) ? 3 : FORMAT_VERSION;

  function cleanGeneration(value, fallback = null) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }

  function readSync(owner = activeOwner) {
    const envelope = parseRaw(scopedKey("sync", owner));
    const generation = plainObject(envelope) && envelope.version === FORMAT_VERSION && envelope.owner === owner ?
      cleanGeneration(envelope.generation) : null;
    return generation == null ? writeSync(0, owner) : generation;
  }

  function writeSync(value, owner = activeOwner) {
    const generation = cleanGeneration(value);
    if (generation == null) throw new TypeError("Invalid learning-state generation");
    writeRaw(scopedKey("sync", owner), JSON.stringify({
      version: FORMAT_VERSION,
      owner,
      generation,
    }));
    return generation;
  }

  function topicLimit(id) {
    const topics = window.TOPIC_META || [];
    const meta = topics.find((topic) => topic.id === id);
    if (meta && Number.isInteger(meta.stages)) return meta.stages;
    const curricula = window.CURRICULUM || {};
    const course = Object.hasOwn(curricula, id) ? curricula[id] : null;
    if (course) return course.modules.reduce((total, module) => total + module.stages.length, 0);
    // Scripts are deferred in dependency order, but persistence must still be
    // non-destructive if catalogue metadata is delayed or unavailable. Apply a
    // conservative temporary bound; the next read with metadata loaded will
    // enforce the exact per-course limit and discard unknown ids.
    return !topics.length && !Object.keys(curricula).length && /^[a-z0-9_-]{1,64}$/.test(id) ? 10000 : 0;
  }

  function cleanProgress(value) {
    const source = plainObject(value) ? value : {};
    const clean = {};
    for (const [id, entry] of Object.entries(source)) {
      const limit = topicLimit(id);
      if (!limit || !plainObject(entry) || !Array.isArray(entry.done)) continue;
      const done = [...new Set(entry.done.filter((index) => Number.isInteger(index) && index >= 0 && index < limit))]
        .sort((a, b) => a - b);
      clean[id] = { done };
    }
    return clean;
  }

  function cleanStableProgress(value) {
    const source = plainObject(value) ? value : {};
    const catalogue = window.COURSE_STAGE_IDS || {};
    const clean = {};
    for (const [courseId, entry] of Object.entries(source)) {
      const allowed = Array.isArray(catalogue[courseId]) ? new Set(catalogue[courseId]) : null;
      if (!allowed || !plainObject(entry) || !Array.isArray(entry.done)) continue;
      const done = [...new Set(entry.done.filter((stageId) => typeof stageId === "string" && allowed.has(stageId)))];
      done.sort((a, b) => catalogue[courseId].indexOf(a) - catalogue[courseId].indexOf(b));
      clean[courseId] = { done };
    }
    return clean;
  }

  function normalizeDay(value) {
    if (value == null || value === "") return null;
    const match = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function cleanGamify(value) {
    const source = plainObject(value) ? value : {};
    return {
      points: safeInteger(source.points),
      streak: safeInteger(source.streak, 0, 100000),
      last: normalizeDay(source.last),
    };
  }

  const validItemId = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value);
  const validAttemptId = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

  function cleanMastery(value) {
    const source = plainObject(value) ? value : {};
    const clean = {};
    for (const [itemId, record] of Object.entries(source).slice(0, 1000)) {
      if (!validItemId(itemId) || !plainObject(record)) continue;
      const level = Number(record.level);
      const dueDay = normalizeDay(record.dueDay);
      if (!Number.isSafeInteger(level) || level < 0 || level > 5 || !dueDay) continue;
      const attempts = safeInteger(record.attempts, 0, 1000000);
      clean[itemId] = {
        level,
        dueDay,
        attempts,
        correct: Math.min(attempts, safeInteger(record.correct, 0, 1000000)),
        lastResult: typeof record.lastResult === "boolean" ? record.lastResult : null,
        lastAttemptId: validAttemptId(record.lastAttemptId) ? record.lastAttemptId : null,
        updatedAt: safeInteger(record.updatedAt),
      };
    }
    return clean;
  }

  function cleanMasteryOutbox(value) {
    if (!Array.isArray(value)) return [];
    const clean = [];
    const seen = new Set();
    for (const event of value.slice(-500)) {
      if (!plainObject(event) || !validItemId(event.itemId) || !validAttemptId(event.attemptId) || seen.has(event.attemptId)) continue;
      const day = normalizeDay(event.day);
      if (!day || typeof event.correct !== "boolean" || typeof event.hinted !== "boolean") continue;
      seen.add(event.attemptId);
      clean.push({
        attemptId: event.attemptId,
        itemId: event.itemId,
        correct: event.correct,
        hinted: event.hinted,
        day,
      });
    }
    return clean;
  }

  function cleanSkillOutbox(value) {
    if (!Array.isArray(value)) return [];
    const clean = [];
    const seen = new Set();
    for (const event of value.slice(-500)) {
      if (!plainObject(event) || !validItemId(event.skillId) || !validItemId(event.itemId) || !validAttemptId(event.attemptId) || seen.has(event.attemptId)) continue;
      const day = normalizeDay(event.day);
      if (!day || typeof event.correct !== "boolean" || typeof event.hinted !== "boolean") continue;
      seen.add(event.attemptId);
      clean.push({ attemptId: event.attemptId, skillId: event.skillId, itemId: event.itemId, correct: event.correct, hinted: event.hinted, day });
    }
    return clean;
  }

  const PROJECT_IDS = new Set(["macro-forecasting-desk", "fx-volatility-risk", "factor-pricing-lab"]);
  const PROJECT_MODES = new Set(["guided", "unguided"]);
  function cleanProjects(value) {
    const source = plainObject(value) ? value : {};
    const clean = {};
    for (const [projectId, entry] of Object.entries(source)) {
      if (!PROJECT_IDS.has(projectId) || !plainObject(entry) || !PROJECT_MODES.has(entry.mode) || !Array.isArray(entry.done)) continue;
      clean[projectId] = { mode: entry.mode, done: [...new Set(entry.done.filter((taskId) => typeof taskId === "string" && /^[a-z0-9-]{2,64}$/.test(taskId)))].slice(0, 24) };
    }
    return clean;
  }

  const PATH_IDS = new Set(["complete-core", "causal", "applied-micro", "time-series", "markets-risk"]);
  function cleanPreferences(value) {
    const source = plainObject(value) ? value : {};
    return {
      activePathId: PATH_IDS.has(source.activePathId) ? source.activePathId : "complete-core",
      sessionMinutes: [10, 20, 45].includes(Number(source.sessionMinutes)) ? Number(source.sessionMinutes) : 20,
      weeklyGoalMinutes: Number.isSafeInteger(Number(source.weeklyGoalMinutes)) && Number(source.weeklyGoalMinutes) >= 30 && Number(source.weeklyGoalMinutes) <= 1200 ? Number(source.weeklyGoalMinutes) : 120,
    };
  }

  const PLACEMENT_BANDS = new Set(["foundation", "applied", "advanced"]);
  const PLACEMENT_TOPICS = new Set(["ols", "iv2sls", "did", "var", "panel", "logit", "gmm"]);

  function cleanPlacement(value) {
    if (value == null) return null;
    if (!plainObject(value) || !PLACEMENT_BANDS.has(value.band) || !PLACEMENT_TOPICS.has(value.recommendedTopic)) return null;
    const score = Number(value.score);
    const total = Number(value.total);
    const completedDay = normalizeDay(value.completedDay);
    const expectedBand = score <= 6 ? "foundation" : score <= 11 ? "applied" : "advanced";
    const latestDay = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!Number.isSafeInteger(score) || total !== 15 || score < 0 || score > total || !completedDay ||
        completedDay > latestDay || value.band !== expectedBand) {
      return null;
    }
    return { band: value.band, score, total, completedDay, recommendedTopic: value.recommendedTopic };
  }

  function cleanFor(kind, value) {
    if (kind === "progress") return cleanProgress(value);
    if (kind === "stableProgress") return cleanStableProgress(value);
    if (kind === "gamify") return cleanGamify(value);
    if (kind === "mastery" || kind === "skillMastery") return cleanMastery(value);
    if (kind === "placement") return cleanPlacement(value);
    if (kind === "skillOutbox") return cleanSkillOutbox(value);
    if (kind === "preferences") return cleanPreferences(value);
    if (kind === "projects") return cleanProjects(value);
    return cleanMasteryOutbox(value);
  }

  function emptyFor(kind) {
    if (["progress", "stableProgress", "mastery", "skillMastery", "projects"].includes(kind)) return {};
    if (kind === "masteryOutbox" || kind === "skillOutbox") return [];
    if (kind === "placement") return null;
    if (kind === "preferences") return cleanPreferences({});
    return { points: 0, streak: 0, last: null };
  }

  function readScoped(kind, owner = activeOwner) {
    const envelope = parseRaw(scopedKey(kind, owner));
    if (plainObject(envelope) && envelope.version === envelopeVersion(kind) && envelope.owner === owner) {
      return cleanFor(kind, envelope.value);
    }

    // Pre-v2 values have no owner identity. They are therefore eligible only
    // for the anonymous scope and are immediately migrated into an envelope.
    const legacy = owner === ANONYMOUS && (kind === "progress" || kind === "gamify") ? parseRaw(KEYS[kind]) : null;
    const value = cleanFor(kind, legacy ?? emptyFor(kind));
    writeScoped(kind, value, owner);
    return value;
  }

  function writeScoped(kind, value, owner = activeOwner) {
    const clean = cleanFor(kind, value);
    writeRaw(scopedKey(kind, owner), JSON.stringify({
      version: envelopeVersion(kind),
      owner,
      value: clean,
    }));
    // Keep old anonymous-only integrations working during the migration. An
    // authenticated scope is never copied into these unscoped legacy keys.
    if (owner === ANONYMOUS && (kind === "progress" || kind === "gamify")) writeRaw(KEYS[kind], JSON.stringify(clean));
    return clean;
  }

  function removeScoped(kind, owner = activeOwner) {
    removeRaw(scopedKey(kind, owner));
    if (owner === ANONYMOUS && (kind === "progress" || kind === "gamify")) removeRaw(KEYS[kind]);
  }

  function hasScopedState(owner) {
    return readRaw(scopedKey("progress", owner)) != null || readRaw(scopedKey("gamify", owner)) != null ||
      readRaw(scopedKey("mastery", owner)) != null || readRaw(scopedKey("masteryOutbox", owner)) != null ||
      readRaw(scopedKey("placement", owner)) != null || readRaw(scopedKey("stableProgress", owner)) != null ||
      readRaw(scopedKey("skillMastery", owner)) != null || readRaw(scopedKey("skillOutbox", owner)) != null ||
      readRaw(scopedKey("preferences", owner)) != null || readRaw(scopedKey("projects", owner)) != null ||
      readRaw(scopedKey("sync", owner)) != null;
  }

  function hasOwnerState(ownerId) {
    try { return hasScopedState(normalizeOwner(ownerId)); }
    catch { return false; }
  }

  function hasLearningState(progressValue, gamifyValue, masteryValue, masteryOutboxValue, placementValue, stableValue = {}, skillValue = {}, skillOutboxValue = [], projectValue = {}) {
    return Object.values(progressValue).some((entry) => Array.isArray(entry.done) && entry.done.length) ||
      gamifyValue.points > 0 || gamifyValue.streak > 0 || gamifyValue.last != null ||
      Object.keys(masteryValue).length > 0 || masteryOutboxValue.length > 0 || placementValue != null ||
      Object.values(stableValue).some((entry) => Array.isArray(entry.done) && entry.done.length) ||
      Object.keys(skillValue).length > 0 || skillOutboxValue.length > 0 || Object.keys(projectValue).length > 0;
  }

  function bindOwner(ownerId, options = {}) {
    const next = normalizeOwner(ownerId);
    const previous = activeOwner;
    const claimAnonymous = options.claimAnonymous !== false;

    // A first-time account can claim work completed before sign-in. Existing
    // account scopes never absorb anonymous/device data, which prevents one
    // known account from contaminating another on a shared browser.
    if (next !== ANONYMOUS && next !== previous && claimAnonymous && !hasScopedState(next)) {
      const anonymousProgress = readScoped("progress", ANONYMOUS);
      const anonymousGamify = readScoped("gamify", ANONYMOUS);
      const anonymousMastery = readScoped("mastery", ANONYMOUS);
      const anonymousMasteryOutbox = readScoped("masteryOutbox", ANONYMOUS);
      const anonymousPlacement = readScoped("placement", ANONYMOUS);
      const anonymousStableProgress = readScoped("stableProgress", ANONYMOUS);
      const anonymousSkillMastery = readScoped("skillMastery", ANONYMOUS);
      const anonymousSkillOutbox = readScoped("skillOutbox", ANONYMOUS);
      const anonymousProjects = readScoped("projects", ANONYMOUS);
      const anonymousPreferences = readScoped("preferences", ANONYMOUS);
      if (hasLearningState(anonymousProgress, anonymousGamify, anonymousMastery, anonymousMasteryOutbox, anonymousPlacement, anonymousStableProgress, anonymousSkillMastery, anonymousSkillOutbox, anonymousProjects)) {
        writeScoped("progress", anonymousProgress, next);
        writeScoped("gamify", anonymousGamify, next);
        writeScoped("mastery", anonymousMastery, next);
        writeScoped("masteryOutbox", anonymousMasteryOutbox, next);
        writeScoped("placement", anonymousPlacement, next);
        writeScoped("stableProgress", anonymousStableProgress, next);
        writeScoped("skillMastery", anonymousSkillMastery, next);
        writeScoped("skillOutbox", anonymousSkillOutbox, next);
        writeScoped("projects", anonymousProjects, next);
        writeScoped("preferences", anonymousPreferences, next);
        removeScoped("progress", ANONYMOUS);
        removeScoped("gamify", ANONYMOUS);
        removeScoped("mastery", ANONYMOUS);
        removeScoped("masteryOutbox", ANONYMOUS);
        removeScoped("placement", ANONYMOUS);
        removeScoped("stableProgress", ANONYMOUS);
        removeScoped("skillMastery", ANONYMOUS);
        removeScoped("skillOutbox", ANONYMOUS);
        removeScoped("projects", ANONYMOUS);
        removeScoped("preferences", ANONYMOUS);
      }
    }

    activeOwner = next;
    if (options.announce === true) writeRaw(KEYS.activeOwner, next);
    if (next !== previous) {
      emit("iewt:owner-changed", {
        owner: publicOwner(next),
        previousOwner: publicOwner(previous),
        anonymous: next === ANONYMOUS,
      });
    }
    return publicOwner(next);
  }

  function ownerFromMarker(value) {
    if (value === ANONYMOUS) return null;
    if (typeof value === "string" && value.startsWith("user:") && value.length <= 261) return publicOwner(value);
    return undefined;
  }

  function announcedOwner() {
    return ownerFromMarker(readRaw(KEYS.activeOwner));
  }

  function ownerMatches(ownerId) {
    let expected;
    try { expected = normalizeOwner(ownerId); }
    catch { return false; }
    if (expected !== activeOwner) return false;
    const announced = readRaw(KEYS.activeOwner);
    return announced == null || announced === expected;
  }

  function progress() {
    const clean = readScoped("progress");
    return writeScoped("progress", clean);
  }

  function setProgress(value) {
    return writeScoped("progress", value);
  }

  function stableFromLegacy(value = progress()) {
    const ids = window.COURSE_STAGE_IDS || {};
    const migrated = {};
    for (const [courseId, entry] of Object.entries(value || {})) {
      if (!Array.isArray(ids[courseId]) || !Array.isArray(entry && entry.done)) continue;
      migrated[courseId] = { done: entry.done.map((index) => ids[courseId][index]).filter((stageId) => typeof stageId === "string") };
    }
    return cleanStableProgress(migrated);
  }

  function stableProgress() {
    let clean = readScoped("stableProgress");
    if (!Object.values(clean).some((entry) => entry.done.length)) {
      const migrated = stableFromLegacy();
      if (Object.values(migrated).some((entry) => entry.done.length)) clean = writeScoped("stableProgress", migrated);
    }
    return writeScoped("stableProgress", clean);
  }

  function setStableProgress(value) {
    return writeScoped("stableProgress", value);
  }

  function gamify() {
    const clean = readScoped("gamify");
    return writeScoped("gamify", clean);
  }

  function setGamify(value) {
    return writeScoped("gamify", value);
  }

  function mastery() {
    const clean = readScoped("mastery");
    return writeScoped("mastery", clean);
  }

  function setMastery(value) {
    return writeScoped("mastery", value);
  }

  function masteryOutbox() {
    const clean = readScoped("masteryOutbox");
    return writeScoped("masteryOutbox", clean);
  }

  function setMasteryOutbox(value) {
    return writeScoped("masteryOutbox", value);
  }

  function queueMasteryAttempt(event) {
    const pending = masteryOutbox();
    if (!pending.some((entry) => entry.attemptId === event.attemptId)) pending.push(event);
    return setMasteryOutbox(pending);
  }

  function removeMasteryAttempt(attemptId) {
    return setMasteryOutbox(masteryOutbox().filter((event) => event.attemptId !== attemptId));
  }

  function skillMastery() {
    return writeScoped("skillMastery", readScoped("skillMastery"));
  }

  function setSkillMastery(value) {
    return writeScoped("skillMastery", value);
  }

  function skillOutbox() {
    return writeScoped("skillOutbox", readScoped("skillOutbox"));
  }

  function setSkillOutbox(value) {
    return writeScoped("skillOutbox", value);
  }

  function queueSkillAttempt(event) {
    const pending = skillOutbox();
    if (!pending.some((entry) => entry.attemptId === event.attemptId)) pending.push(event);
    return setSkillOutbox(pending);
  }

  function removeSkillAttempt(attemptId) {
    return setSkillOutbox(skillOutbox().filter((event) => event.attemptId !== attemptId));
  }

  function preferences() {
    return writeScoped("preferences", readScoped("preferences"));
  }

  function setPreferences(value) {
    return writeScoped("preferences", value);
  }

  function projects() {
    return writeScoped("projects", readScoped("projects"));
  }

  function setProjects(value) {
    return writeScoped("projects", value);
  }

  function placement() {
    const clean = readScoped("placement");
    return writeScoped("placement", clean);
  }

  function setPlacement(value) {
    return writeScoped("placement", value);
  }

  function syncGeneration(ownerId = publicOwner()) {
    return readSync(normalizeOwner(ownerId));
  }

  function setSyncGeneration(value, ownerId = publicOwner()) {
    return writeSync(value, normalizeOwner(ownerId));
  }

  function resetLearning(ownerId = publicOwner(), options = {}) {
    const owner = normalizeOwner(ownerId);
    const generation = options.generation == null ? readSync(owner) : cleanGeneration(options.generation);
    if (generation == null) throw new TypeError("Invalid learning-state generation");
    removeScoped("progress", owner);
    removeScoped("gamify", owner);
    removeScoped("mastery", owner);
    removeScoped("masteryOutbox", owner);
    removeScoped("placement", owner);
    removeScoped("stableProgress", owner);
    removeScoped("skillMastery", owner);
    removeScoped("skillOutbox", owner);
    removeScoped("projects", owner);
    // Materialize clean owner-bound state immediately so subsequent reads and
    // other same-page components cannot observe a removed legacy value.
    const cleanProgress = writeScoped("progress", {}, owner);
    const cleanGamify = writeScoped("gamify", emptyFor("gamify"), owner);
    const cleanMastery = writeScoped("mastery", {}, owner);
    const cleanMasteryOutbox = writeScoped("masteryOutbox", [], owner);
    const cleanPlacementState = writeScoped("placement", null, owner);
    const cleanStableProgress = writeScoped("stableProgress", {}, owner);
    const cleanSkillMastery = writeScoped("skillMastery", {}, owner);
    const cleanSkillOutbox = writeScoped("skillOutbox", [], owner);
    const cleanProjects = writeScoped("projects", {}, owner);
    writeSync(generation, owner);
    if (options.announce !== false) {
      emit("iewt:storage-reset", { owner: publicOwner(owner), anonymous: owner === ANONYMOUS, generation });
    }
    return { progress: cleanProgress, stableProgress: cleanStableProgress, gamify: cleanGamify, mastery: cleanMastery, masteryOutbox: cleanMasteryOutbox, skillMastery: cleanSkillMastery, skillOutbox: cleanSkillOutbox, projects: cleanProjects, placement: cleanPlacementState, generation };
  }

  function removeAnonymousProgress(model, indexes) {
    if (typeof model !== "string" || !Array.isArray(indexes)) return readScoped("progress", ANONYMOUS);
    const removed = new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0));
    const value = readScoped("progress", ANONYMOUS);
    if (value[model] && Array.isArray(value[model].done)) {
      const done = value[model].done.filter((index) => !removed.has(index));
      if (done.length) value[model] = { done };
      else delete value[model];
    }
    return writeScoped("progress", value, ANONYMOUS);
  }

  function removeAnonymousStableProgress(courseId, stageIds) {
    if (typeof courseId !== "string" || !Array.isArray(stageIds)) return readScoped("stableProgress", ANONYMOUS);
    const removed = new Set(stageIds.filter((stageId) => typeof stageId === "string"));
    const value = readScoped("stableProgress", ANONYMOUS);
    if (value[courseId] && Array.isArray(value[courseId].done)) {
      const done = value[courseId].done.filter((stageId) => !removed.has(stageId));
      if (done.length) value[courseId] = { done };
      else delete value[courseId];
    }
    return writeScoped("stableProgress", value, ANONYMOUS);
  }

  function setAnonymousGamify(value) {
    return writeScoped("gamify", value, ANONYMOUS);
  }

  function guideWidth() {
    let value = Number(readRaw(KEYS.guideWidth));
    if (!(value >= 25 && value <= 72)) value = Number(readRaw(KEYS.legacyGuideWidth));
    if (!(value >= 25 && value <= 72)) return null;
    writeRaw(KEYS.guideWidth, value.toFixed(1));
    removeRaw(KEYS.legacyGuideWidth);
    return value;
  }

  function setGuideWidth(value) {
    const width = Math.max(25, Math.min(72, Number(value)));
    if (!Number.isFinite(width)) return null;
    writeRaw(KEYS.guideWidth, width.toFixed(1));
    removeRaw(KEYS.legacyGuideWidth);
    return width;
  }

  if (typeof window.addEventListener === "function") {
    window.addEventListener("storage", (event) => {
      if (event.key !== KEYS.activeOwner || event.newValue === activeOwner) return;
      // Storage events do not fire in the writing tab. In this receiving tab,
      // refresh the in-memory cache before notifying Auth so an external
      // removal or account switch cannot be masked by a stale cached marker.
      if (event.newValue == null) memory.delete(KEYS.activeOwner);
      else memory.set(KEYS.activeOwner, event.newValue);
      dirty.delete(KEYS.activeOwner);
      emit("iewt:owner-external", { owner: ownerFromMarker(event.newValue) });
    });
  }

  window.IEWTStorage = Object.freeze({
    KEYS,
    owner: () => publicOwner(),
    announcedOwner,
    ownerMatches,
    hasOwnerState,
    bindOwner,
    setOwner: bindOwner,
    progress,
    setProgress,
    stableProgress,
    setStableProgress,
    stableFromLegacy,
    gamify,
    setGamify,
    mastery,
    setMastery,
    masteryOutbox,
    setMasteryOutbox,
    queueMasteryAttempt,
    removeMasteryAttempt,
    skillMastery,
    setSkillMastery,
    skillOutbox,
    setSkillOutbox,
    queueSkillAttempt,
    removeSkillAttempt,
    preferences,
    setPreferences,
    projects,
    setProjects,
    placement,
    setPlacement,
    syncGeneration,
    setSyncGeneration,
    resetLearning,
    removeAnonymousProgress,
    removeAnonymousStableProgress,
    setAnonymousGamify,
    guideWidth,
    setGuideWidth,
    normalizeDay,
  });
})();
