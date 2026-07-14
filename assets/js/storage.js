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
    syncPrefix: "iewt:sync:v2:",
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
      kind === "gamify" ? KEYS.gamifyPrefix : KEYS.syncPrefix;
    return prefix + encodeURIComponent(owner);
  }

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

  function cleanFor(kind, value) {
    return kind === "progress" ? cleanProgress(value) : cleanGamify(value);
  }

  function emptyFor(kind) {
    return kind === "progress" ? {} : { points: 0, streak: 0, last: null };
  }

  function readScoped(kind, owner = activeOwner) {
    const envelope = parseRaw(scopedKey(kind, owner));
    if (plainObject(envelope) && envelope.version === FORMAT_VERSION && envelope.owner === owner) {
      return cleanFor(kind, envelope.value);
    }

    // Pre-v2 values have no owner identity. They are therefore eligible only
    // for the anonymous scope and are immediately migrated into an envelope.
    const legacy = owner === ANONYMOUS ? parseRaw(KEYS[kind]) : null;
    const value = cleanFor(kind, legacy ?? emptyFor(kind));
    writeScoped(kind, value, owner);
    return value;
  }

  function writeScoped(kind, value, owner = activeOwner) {
    const clean = cleanFor(kind, value);
    writeRaw(scopedKey(kind, owner), JSON.stringify({
      version: FORMAT_VERSION,
      owner,
      value: clean,
    }));
    // Keep old anonymous-only integrations working during the migration. An
    // authenticated scope is never copied into these unscoped legacy keys.
    if (owner === ANONYMOUS) writeRaw(KEYS[kind], JSON.stringify(clean));
    return clean;
  }

  function removeScoped(kind, owner = activeOwner) {
    removeRaw(scopedKey(kind, owner));
    if (owner === ANONYMOUS) removeRaw(KEYS[kind]);
  }

  function hasScopedState(owner) {
    return readRaw(scopedKey("progress", owner)) != null || readRaw(scopedKey("gamify", owner)) != null ||
      readRaw(scopedKey("sync", owner)) != null;
  }

  function hasOwnerState(ownerId) {
    try { return hasScopedState(normalizeOwner(ownerId)); }
    catch { return false; }
  }

  function hasLearningState(progressValue, gamifyValue) {
    return Object.values(progressValue).some((entry) => Array.isArray(entry.done) && entry.done.length) ||
      gamifyValue.points > 0 || gamifyValue.streak > 0 || gamifyValue.last != null;
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
      if (hasLearningState(anonymousProgress, anonymousGamify)) {
        writeScoped("progress", anonymousProgress, next);
        writeScoped("gamify", anonymousGamify, next);
        removeScoped("progress", ANONYMOUS);
        removeScoped("gamify", ANONYMOUS);
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

  function gamify() {
    const clean = readScoped("gamify");
    return writeScoped("gamify", clean);
  }

  function setGamify(value) {
    return writeScoped("gamify", value);
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
    // Materialize clean owner-bound state immediately so subsequent reads and
    // other same-page components cannot observe a removed legacy value.
    const cleanProgress = writeScoped("progress", {}, owner);
    const cleanGamify = writeScoped("gamify", emptyFor("gamify"), owner);
    writeSync(generation, owner);
    if (options.announce !== false) {
      emit("iewt:storage-reset", { owner: publicOwner(owner), anonymous: owner === ANONYMOUS, generation });
    }
    return { progress: cleanProgress, gamify: cleanGamify, generation };
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
    gamify,
    setGamify,
    syncGeneration,
    setSyncGeneration,
    resetLearning,
    removeAnonymousProgress,
    setAnonymousGamify,
    guideWidth,
    setGuideWidth,
    normalizeDay,
  });
})();
