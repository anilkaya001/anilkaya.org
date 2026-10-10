import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const QUARANTINE_FILE = "quarantine.json";
export const MAX_QUARANTINE_DAYS = 7;
export const ENTRY_KEYS = ["suite", "assertion", "firstSeen", "expires", "issue"];
const DAY_MS = 86400000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const dayMs = (text) => {
  const m = typeof text === "string" ? DAY.exec(text) : null;
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms).toISOString().slice(0, 10);
  return back === text ? ms : null;
};

export const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function readQuarantine(dir) {
  const file = path.join(dir, QUARANTINE_FILE);
  if (!existsSync(file)) return { entries: [], problems: [] };
  let doc;
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) { return { entries: [], problems: [`${QUARANTINE_FILE} is not valid JSON: ${error.message}`] }; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.version !== 1 || !Array.isArray(doc.entries)) {
    return { entries: [], problems: [`${QUARANTINE_FILE} must be { "version": 1, "entries": [...] }`] };
  }
  return { entries: doc.entries, problems: [] };
}

export function checkQuarantine(entries, { suites, today = todayUtc() }) {
  const problems = [];
  const byName = new Map(suites.map((s) => [s.name, s]));
  const seen = new Set();
  const todayMs = dayMs(today);
  entries.forEach((e, i) => {
    const at = `${QUARANTINE_FILE} entry ${i}`;
    if (!e || typeof e !== "object" || Array.isArray(e)) { problems.push(`${at} is not an object`); return; }
    const keys = Object.keys(e);
    if (keys.join() !== ENTRY_KEYS.join()) { problems.push(`${at} has keys ${JSON.stringify(keys)}, not ${JSON.stringify(ENTRY_KEYS)}`); return; }
    const suite = byName.get(e.suite);
    if (!suite) problems.push(`${at} names suite ${JSON.stringify(e.suite)}, which is not registered`);
    else if (suite.timing !== true) problems.push(`${at} names ${e.suite}, which is not tagged timing, so it is never retried and has nothing to quarantine`);
    if (typeof e.assertion !== "string" || !e.assertion.trim()) problems.push(`${at} (${e.suite}) names no assertion`);
    if (typeof e.issue !== "string" || !e.issue.trim()) problems.push(`${at} (${e.suite}) names no issue`);
    const first = dayMs(e.firstSeen);
    const last = dayMs(e.expires);
    if (first === null) problems.push(`${at} (${e.suite}) has firstSeen ${JSON.stringify(e.firstSeen)}, not a UTC date YYYY-MM-DD`);
    if (last === null) problems.push(`${at} (${e.suite}) has expires ${JSON.stringify(e.expires)}, not a UTC date YYYY-MM-DD`);
    if (first !== null && last !== null) {
      if (last < first) problems.push(`${at} (${e.suite}) expires ${e.expires}, before it was first seen on ${e.firstSeen}`);
      else if (last - first > MAX_QUARANTINE_DAYS * DAY_MS) problems.push(`${at} (${e.suite}) expires ${e.expires}, more than ${MAX_QUARANTINE_DAYS} days after ${e.firstSeen}; an extension is a new entry with a new firstSeen and issue in a reviewed pull request`);
      if (todayMs !== null && last < todayMs) problems.push(`${at} (${e.suite}) expired on ${e.expires}: fix the flake in ${e.suite} (${e.issue}) or renew the entry in a reviewed pull request`);
    }
    const key = `${e.suite}\0${e.assertion}`;
    if (seen.has(key)) problems.push(`${at} repeats ${e.suite} / ${JSON.stringify(e.assertion)}`);
    seen.add(key);
  });
  return problems;
}

export function recordedFor(entries, suiteName, today = todayUtc()) {
  const todayMs = dayMs(today);
  const live = entries.filter((e) => e && e.suite === suiteName && dayMs(e.expires) !== null && dayMs(e.expires) >= todayMs);
  return live.length ? live.reduce((a, b) => (dayMs(a.expires) >= dayMs(b.expires) ? a : b)) : null;
}
