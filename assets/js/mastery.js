/* =============================================================
   mastery.js — pure browser-side mastery scheduling.
   No DOM or storage access; callers own persistence and rendering.
   ============================================================= */
(() => {
  "use strict";

  const LEVEL_MIN = 0;
  const LEVEL_MAX = 5;
  const INTERVAL_DAYS = Object.freeze([1, 3, 7, 21, 60]);
  const MAX_COUNT = 1_000_000;
  const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
  const plainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

  function safeCount(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? Math.min(MAX_COUNT, count) : 0;
  }

  function safeTimestamp(value) {
    const timestamp = Number(value);
    return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : 0;
  }

  function normalizeAttemptId(value) {
    return typeof value === "string" && ATTEMPT_ID_PATTERN.test(value) ? value : null;
  }

  function normalizeDay(value) {
    if (typeof value !== "string") return null;
    const match = value.match(DAY_PATTERN);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return value;
  }

  function requireDay(value) {
    const day = normalizeDay(value);
    if (!day) throw new TypeError("today must be a valid YYYY-MM-DD date");
    return day;
  }

  function addDays(value, count) {
    const day = requireDay(value);
    if (!Number.isSafeInteger(count)) throw new TypeError("count must be an integer");
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  }

  function normalizeRecord(value) {
    const source = plainObject(value) ? value : {};
    const rawLevel = Number(source.level);
    const level = Number.isInteger(rawLevel) && rawLevel >= LEVEL_MIN && rawLevel <= LEVEL_MAX ? rawLevel : LEVEL_MIN;
    const attempts = safeCount(source.attempts);
    const correct = Math.min(attempts, safeCount(source.correct));
    return {
      level,
      dueDay: normalizeDay(source.dueDay),
      attempts,
      correct,
      lastResult: typeof source.lastResult === "boolean" ? source.lastResult : null,
      lastAttemptId: normalizeAttemptId(source.lastAttemptId),
      updatedAt: safeTimestamp(source.updatedAt),
    };
  }

  function intervalForLevel(value) {
    const level = Number(value);
    if (!Number.isInteger(level) || level < LEVEL_MIN || level > LEVEL_MAX) {
      throw new TypeError("level must be an integer from 0 through 5");
    }
    return INTERVAL_DAYS[Math.max(1, level) - 1];
  }

  function applyMastery(record, options) {
    if (!plainObject(options) || typeof options.correct !== "boolean") {
      throw new TypeError("correct must be boolean");
    }
    if (options.hinted != null && typeof options.hinted !== "boolean") {
      throw new TypeError("hinted must be boolean");
    }
    if (options.attemptId != null && normalizeAttemptId(options.attemptId) == null) {
      throw new TypeError("attemptId is invalid");
    }
    if (options.updatedAt != null && safeTimestamp(options.updatedAt) !== options.updatedAt) {
      throw new TypeError("updatedAt must be a non-negative safe integer");
    }

    const previous = normalizeRecord(record);
    const today = requireDay(options.today);
    const attemptId = normalizeAttemptId(options.attemptId);
    if (attemptId && attemptId === previous.lastAttemptId) return previous;

    const hinted = options.hinted === true;
    let level;
    if (!options.correct) level = LEVEL_MIN;
    else if (hinted) level = Math.min(previous.level, 1);
    else level = Math.min(LEVEL_MAX, previous.level + 1);

    const attempts = Math.min(MAX_COUNT, previous.attempts + 1);
    const correct = Math.min(attempts, previous.correct + (options.correct ? 1 : 0));
    const updatedAt = options.updatedAt == null
      ? Date.parse(`${today}T00:00:00Z`)
      : options.updatedAt;

    return {
      level,
      dueDay: addDays(today, options.correct && !hinted ? intervalForLevel(level) : 1),
      attempts,
      correct,
      lastResult: options.correct,
      lastAttemptId: attemptId,
      updatedAt,
    };
  }

  const apply = applyMastery;
  const schedule = applyMastery;

  function isDue(record, today) {
    const value = normalizeRecord(record);
    if (value.attempts === 0) return false;
    const day = requireDay(today);
    return value.dueDay == null || value.dueDay <= day;
  }

  function bankItems(bank) {
    if (Array.isArray(bank)) return bank;
    return plainObject(bank) && Array.isArray(bank.items) ? bank.items : [];
  }

  function masteryItems(mastery) {
    if (!plainObject(mastery)) return {};
    return plainObject(mastery.items) ? mastery.items : mastery;
  }

  function completedStages(progress) {
    if (!plainObject(progress)) return new Map();
    const completed = new Map();
    for (const [course, value] of Object.entries(progress)) {
      if (!plainObject(value) || !Array.isArray(value.done)) continue;
      completed.set(course, new Set(value.done.filter((index) => Number.isSafeInteger(index) && index >= 0)));
    }
    return completed;
  }

  function courseId(item) {
    if (typeof item.courseId === "string" && item.courseId) return item.courseId;
    return typeof item.id === "string" ? item.id.split(":", 1)[0] : "";
  }

  function isCompleted(item, completed) {
    const course = courseId(item);
    return Number.isSafeInteger(item.stageIndex) && completed.get(course)?.has(item.stageIndex) === true;
  }

  function reviewCandidates(bank, mastery, progress, today) {
    const day = requireDay(today);
    const records = masteryItems(mastery);
    const completed = completedStages(progress);
    const seen = new Set();
    const candidates = [];

    for (const item of bankItems(bank)) {
      if (!plainObject(item) || typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      if (!isCompleted(item, completed)) continue;
      const record = normalizeRecord(Object.hasOwn(records, item.id) ? records[item.id] : null);
      candidates.push({
        item,
        record,
        due: record.attempts === 0 || record.dueDay == null || record.dueDay <= day,
        course: courseId(item),
      });
    }
    return candidates;
  }

  function dueCount(bank, mastery, progress, today) {
    return reviewCandidates(bank, mastery, progress, today).filter((candidate) => candidate.due).length;
  }

  function selectSession(bank, mastery, progress, today, limit = 5) {
    requireDay(today);
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) {
      throw new TypeError("limit must be an integer from 0 through 100");
    }
    if (limit === 0) return [];

    const candidates = reviewCandidates(bank, mastery, progress, today).filter((candidate) => candidate.due);
    candidates.sort((a, b) =>
      Number(b.due) - Number(a.due) ||
      a.record.level - b.record.level ||
      String(a.record.dueDay || "").localeCompare(String(b.record.dueDay || "")) ||
      a.item.id.localeCompare(b.item.id));

    const selected = [];
    const deferred = [];
    const perCourse = new Map();
    for (const candidate of candidates) {
      if (selected.length >= limit) break;
      const count = perCourse.get(candidate.course) || 0;
      if (count >= 2) {
        deferred.push(candidate);
        continue;
      }
      selected.push(candidate.item);
      perCourse.set(candidate.course, count + 1);
    }
    for (const candidate of deferred) {
      if (selected.length >= limit) break;
      selected.push(candidate.item);
    }
    return selected;
  }

  window.MasteryScheduler = Object.freeze({
    LEVEL_MIN,
    LEVEL_MAX,
    INTERVAL_DAYS,
    normalizeDay,
    addDays,
    normalizeRecord,
    intervalForLevel,
    apply,
    applyMastery,
    schedule,
    isDue,
    dueCount,
    selectSession,
  });
})();
