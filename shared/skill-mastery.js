/* Academy 2.0 conceptual-skill scheduler. */
export const LEVEL_MIN = 0;
export const LEVEL_MAX = 5;
export const INTERVAL_DAYS = Object.freeze([1, 3, 7, 21, 60]);

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ATTEMPT = /^[A-Za-z0-9._:-]{1,128}$/;
const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Math.min(1000000, Number(value)) : 0;

export function normalizeDay(value) {
  if (typeof value !== "string") return null;
  const match = value.match(DAY);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? value : null;
}

export function addDays(value, amount) {
  const day = normalizeDay(value);
  if (!day || !Number.isSafeInteger(amount)) throw new TypeError("A valid day and integer interval are required");
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function normalizeRecord(value) {
  const source = object(value) ? value : {};
  const level = Number(source.level);
  const attempts = count(source.attempts);
  return {
    level: Number.isInteger(level) && level >= LEVEL_MIN && level <= LEVEL_MAX ? level : 0,
    dueDay: normalizeDay(source.dueDay),
    attempts,
    correct: Math.min(attempts, count(source.correct)),
    lastResult: typeof source.lastResult === "boolean" ? source.lastResult : null,
    lastAttemptId: typeof source.lastAttemptId === "string" && ATTEMPT.test(source.lastAttemptId) ? source.lastAttemptId : null,
    updatedAt: Number.isSafeInteger(Number(source.updatedAt)) && Number(source.updatedAt) >= 0 ? Number(source.updatedAt) : 0,
  };
}

export function applySkillMastery(record, options) {
  if (!object(options) || typeof options.correct !== "boolean" || typeof options.hinted !== "boolean" || !normalizeDay(options.today)) throw new TypeError("Invalid skill attempt");
  if (options.attemptId != null && (typeof options.attemptId !== "string" || !ATTEMPT.test(options.attemptId))) throw new TypeError("Invalid attempt id");
  const previous = normalizeRecord(record);
  if (options.attemptId && previous.lastAttemptId === options.attemptId) return previous;
  const cleanCorrect = options.correct && !options.hinted;
  const level = cleanCorrect ? Math.min(LEVEL_MAX, previous.level + 1) : options.correct ? previous.level : Math.max(LEVEL_MIN, previous.level - 1);
  const interval = cleanCorrect ? INTERVAL_DAYS[Math.max(1, level) - 1] : 1;
  const attempts = Math.min(1000000, previous.attempts + 1);
  return {
    level,
    dueDay: addDays(options.today, interval),
    attempts,
    correct: Math.min(attempts, previous.correct + (options.correct ? 1 : 0)),
    lastResult: options.correct,
    lastAttemptId: options.attemptId || null,
    updatedAt: Number.isSafeInteger(options.updatedAt) && options.updatedAt >= 0 ? options.updatedAt : Date.parse(`${options.today}T00:00:00Z`),
  };
}

export function selectWeakestSkills(skillIds, mastery, today, limit = 3) {
  if (!normalizeDay(today) || !Array.isArray(skillIds) || !Number.isInteger(limit) || limit < 0 || limit > 20) throw new TypeError("Invalid challenge selection");
  const records = object(mastery) ? mastery : {};
  return [...new Set(skillIds)].map((skillId) => ({ skillId, record: normalizeRecord(records[skillId]) }))
    .filter(({ record }) => record.attempts === 0 || record.dueDay == null || record.dueDay <= today)
    .sort((a, b) => a.record.level - b.record.level || String(a.record.dueDay || "").localeCompare(String(b.record.dueDay || "")) || a.skillId.localeCompare(b.skillId))
    .slice(0, limit).map(({ skillId }) => skillId);
}

export const SkillMasteryScheduler = Object.freeze({ LEVEL_MIN, LEVEL_MAX, INTERVAL_DAYS, normalizeDay, addDays, normalizeRecord, apply: applySkillMastery, selectWeakestSkills });
