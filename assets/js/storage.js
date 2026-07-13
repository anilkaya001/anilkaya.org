/* =============================================================
   storage.js — validated, failure-safe client persistence.
   Every localStorage operation is guarded; an in-memory copy keeps the
   current page coherent when storage is blocked (for example private mode).
   ============================================================= */
(() => {
  "use strict";

  const KEYS = Object.freeze({
    progress: "iewt:progress",
    gamify: "iewt:gamify",
    guideWidth: "iewt:guideW",
    legacyGuideWidth: "iewt:splitW",
  });
  const memory = new Map();
  // A failed write/removal makes memory authoritative until a later write
  // succeeds. Otherwise a readable but stale localStorage value can undo the
  // current session after QuotaExceededError or another write-only failure.
  const dirty = new Set();

  const plainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const safeInteger = (value, fallback = 0, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max ? Number(value) : fallback;

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

  function parseObject(key) {
    try {
      const value = JSON.parse(readRaw(key));
      return plainObject(value) ? value : {};
    } catch { return {}; }
  }

  function topicLimit(id) {
    const meta = (window.TOPIC_META || []).find((topic) => topic.id === id);
    if (meta && Number.isInteger(meta.stages)) return meta.stages;
    const curricula = window.CURRICULUM || {};
    const course = Object.hasOwn(curricula, id) ? curricula[id] : null;
    return course ? course.modules.reduce((total, module) => total + module.stages.length, 0) : 0;
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

  function progress() {
    const clean = cleanProgress(parseObject(KEYS.progress));
    writeRaw(KEYS.progress, JSON.stringify(clean));
    return clean;
  }

  function setProgress(value) {
    const clean = cleanProgress(value);
    writeRaw(KEYS.progress, JSON.stringify(clean));
    return clean;
  }

  function gamify() {
    const clean = cleanGamify(parseObject(KEYS.gamify));
    writeRaw(KEYS.gamify, JSON.stringify(clean));
    return clean;
  }

  function setGamify(value) {
    const clean = cleanGamify(value);
    writeRaw(KEYS.gamify, JSON.stringify(clean));
    return clean;
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

  window.IEWTStorage = Object.freeze({
    KEYS,
    progress,
    setProgress,
    gamify,
    setGamify,
    guideWidth,
    setGuideWidth,
    normalizeDay,
  });
})();
