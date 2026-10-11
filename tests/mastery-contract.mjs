#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { signSession } from "../shared/session.js";
import { COURSE_STAGE_BY_ID, COURSE_STAGE_BY_VARIANT } from "../shared/stage-manifest.js";
import { SKILL_BY_ID } from "../shared/skill-manifest.js";
import {
  INTERVAL_DAYS,
  applyMastery,
  dueCount,
  intervalForLevel,
  selectSession,
} from "../shared/mastery.js";
import { REVIEW_ITEM_BY_ID, REVIEW_ITEMS } from "../shared/review-manifest.js";

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, rootUrl), "utf8");
const bank = JSON.parse(read("assets/data/review-bank.json"));

assert.equal(bank.schemaVersion, 2);
assert.equal(bank.items.length, 106);
assert.equal(new Set(bank.items.map((item) => item.id)).size, bank.items.length);
assert.deepEqual(Object.keys(REVIEW_ITEM_BY_ID), bank.items.map((item) => item.id));
assert.equal(REVIEW_ITEMS.length, bank.items.length);
assert.ok(Object.isFrozen(REVIEW_ITEM_BY_ID));
assert.ok(Object.isFrozen(REVIEW_ITEMS));
for (const item of bank.items) {
  assert.match(item.id, /^[a-z0-9_-]+:[a-z0-9-]+(?:-\d{2}|-checkpoint)$/);
  assert.equal(REVIEW_ITEM_BY_ID[item.id].stageIndex, item.stageIndex);
  assert.ok(Object.isFrozen(REVIEW_ITEM_BY_ID[item.id]));
}

const browserContext = { window: {} };
vm.createContext(browserContext);
vm.runInContext(read("assets/js/review-catalog.js"), browserContext, { filename: "assets/js/review-catalog.js" });
assert.equal(browserContext.window.REVIEW_ITEMS.length, bank.items.length);
assert.deepEqual(
  JSON.parse(JSON.stringify(browserContext.window.REVIEW_ITEMS)),
  bank.items.map(({ id, courseId, stageIndex, stageId, skillIds, variantId, type, title }) => ({ id, courseId, stageIndex, stageId, skillIds, variantId, type, title })),
);
assert.ok(browserContext.window.REVIEW_ITEMS.every((item) => !("answer" in item) && !("answers" in item) && !("accept" in item)));

vm.runInContext(read("assets/js/mastery.js"), browserContext, { filename: "assets/js/mastery.js" });
const browserScheduler = browserContext.window.MasteryScheduler;
assert.ok(browserScheduler && Object.isFrozen(browserScheduler));
assert.deepEqual([...INTERVAL_DAYS], [1, 3, 7, 21, 60]);
assert.deepEqual(Array.from(browserScheduler.INTERVAL_DAYS), [...INTERVAL_DAYS]);
for (let level = 0; level <= 5; level++) assert.equal(browserScheduler.intervalForLevel(level), intervalForLevel(level));

const firstOptions = {
  correct: true,
  hinted: false,
  attemptId: "attempt.1",
  today: "2026-07-15",
  updatedAt: 1_789_000_000_000,
};
const first = applyMastery(null, firstOptions);
assert.deepEqual(first, {
  level: 1,
  dueDay: "2026-07-16",
  attempts: 1,
  correct: 1,
  lastResult: true,
  lastAttemptId: "attempt.1",
  updatedAt: 1_789_000_000_000,
});
assert.deepEqual(JSON.parse(JSON.stringify(browserScheduler.apply(null, firstOptions))), first);

let record = first;
for (const [level, dueDay, day] of [
  [2, "2026-07-18", "2026-07-15"],
  [3, "2026-07-25", "2026-07-18"],
  [4, "2026-08-15", "2026-07-25"],
  [5, "2026-10-14", "2026-08-15"],
  [5, "2026-12-13", "2026-10-14"],
]) {
  record = applyMastery(record, {
    correct: true,
    hinted: false,
    attemptId: `attempt.${record.attempts + 1}`,
    today: day,
    updatedAt: record.updatedAt + 1,
  });
  assert.equal(record.level, level);
  assert.equal(record.dueDay, dueDay);
}

const hinted = applyMastery(record, {
  correct: true,
  hinted: true,
  attemptId: "attempt.hinted",
  today: "2026-12-13",
  updatedAt: record.updatedAt + 1,
});
assert.equal(hinted.level, 1);
assert.equal(hinted.dueDay, "2026-12-14");
assert.equal(hinted.lastResult, true);
assert.deepEqual(JSON.parse(JSON.stringify(browserScheduler.apply(record, {
  correct: true,
  hinted: true,
  attemptId: "attempt.hinted",
  today: "2026-12-13",
  updatedAt: record.updatedAt + 1,
}))), hinted);

const incorrect = applyMastery(hinted, {
  correct: false,
  hinted: false,
  attemptId: "attempt.incorrect",
  today: "2026-12-14",
  updatedAt: hinted.updatedAt + 1,
});
assert.equal(incorrect.level, 0);
assert.equal(incorrect.dueDay, "2026-12-15");
assert.equal(incorrect.correct, hinted.correct);
assert.equal(incorrect.lastResult, false);
assert.deepEqual(JSON.parse(JSON.stringify(browserScheduler.apply(hinted, {
  correct: false,
  hinted: false,
  attemptId: "attempt.incorrect",
  today: "2026-12-14",
  updatedAt: hinted.updatedAt + 1,
}))), incorrect);
assert.deepEqual(applyMastery(incorrect, {
  correct: true,
  hinted: false,
  attemptId: "attempt.incorrect",
  today: "2026-12-15",
  updatedAt: incorrect.updatedAt + 1,
}), incorrect, "duplicate attempt ids must be idempotent");

const items = [
  { id: "a:a-01", courseId: "a", stageIndex: 0 },
  { id: "a:a-02", courseId: "a", stageIndex: 1 },
  { id: "a:a-03", courseId: "a", stageIndex: 2 },
  { id: "b:b-01", courseId: "b", stageIndex: 0 },
  { id: "b:b-02", courseId: "b", stageIndex: 1 },
  { id: "c:c-01", courseId: "c", stageIndex: 0 },
  { id: "d:d-01", courseId: "d", stageIndex: 0 },
];
const mastery = { items: {
  "a:a-02": { level: 1, dueDay: "2026-07-15", attempts: 1, correct: 1 },
  "a:a-03": { level: 0, dueDay: "2026-07-14", attempts: 2, correct: 1 },
  "b:b-02": { level: 4, dueDay: "2026-07-15", attempts: 8, correct: 7 },
  "c:c-01": { level: 0, dueDay: "2026-07-14", attempts: 1, correct: 0 },
  "d:d-01": { level: 4, dueDay: "2026-08-01", attempts: 8, correct: 7 },
} };
const progress = {
  a: { done: [0, 1, 2] },
  b: { done: [0, 1] },
  c: { done: [] },
  d: { done: [0] },
};
assert.equal(dueCount({ items }, mastery, progress, "2026-07-15"), 5);
const session = selectSession({ items }, mastery, progress, "2026-07-15", 4);
assert.equal(session.length, 4);
assert.ok(session.every((item) => items.includes(item)), "selection must return original bank objects");
assert.equal(session.filter((item) => item.courseId === "a").length, 2, "course cap applies while diversity is available");
assert.equal(session.filter((item) => item.courseId === "b").length, 2);
assert.ok(!session.includes(items[5]), "a due mastery record cannot unlock an incomplete assessment");
assert.ok(!session.includes(items[6]), "future assessments cannot be served before they are due");
assert.deepEqual(selectSession({ items }, {}, { a: { done: [0] } }, "2026-07-15", 5), [items[0]], "completed stages seed first review");
assert.deepEqual(selectSession({ items: [items[5]] }, mastery, progress, "2026-07-15", 5), [], "incomplete mastery must remain ineligible");
assert.deepEqual(selectSession({ items: [items[6]] }, mastery, progress, "2026-07-15", 5), [], "future-only mastery must produce a caught-up session");
assert.equal(browserScheduler.dueCount({ items }, mastery, progress, "2026-07-15"), 5);
assert.deepEqual(
  JSON.parse(JSON.stringify(browserScheduler.selectSession({ items }, mastery, progress, "2026-07-15", 4))),
  session,
);

assert.throws(() => applyMastery(null, { correct: true, today: "2026-02-30" }), /today/);
assert.throws(() => applyMastery(null, { correct: true, today: "2026-07-15", attemptId: "bad id" }), /attemptId/);

{
  const SCHEMA = read("schema.sql");
  const SESSION_SECRET = "mastery-contract-session-secret-abcdefghijklmnopqrstuvwxyz";
  globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const returns = /^\s*(SELECT|PRAGMA|WITH)|\bRETURNING\b/i;
  const exec = (sql, args) => {
    const st = db.prepare(sql);
    if (returns.test(sql)) return { results: st.all(...args), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(st.run(...args).changes) } };
  };
  const later = (fn) => new Promise((resolve, reject) => setTimeout(() => { try { resolve(fn()); } catch (error) { reject(error); } }, 0));
  const D1 = {
    prepare(sql) {
      const st = { sql, args: [], bind(...a) { st.args = a; return st; },
        first: () => later(() => exec(sql, st.args).results[0] ?? null),
        all: () => later(() => exec(sql, st.args)),
        run: () => later(() => exec(sql, st.args)) };
      return st;
    },
    batch: (list) => later(() => list.map((st) => exec(st.sql, st.args))),
  };
  const worker = (await import("../worker.js?masterycontract")).default;
  const ORIGIN = "https://anilkaya.org";
  const env = { DB: D1, SESSION_SECRET };
  const user = "g_sweep";
  const cookie = "session=" + await signSession({ sub: user, email: "s@example.com", name: "S", exp: Date.now() + 3600 * 1000 }, SESSION_SECRET);
  let n = 0;
  const put = async (skillId, itemId, attemptId = "sweep-" + (++n)) => {
    const res = await worker.fetch(new Request(ORIGIN + "/api/v2/attempt", {
      method: "PUT",
      headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", cookie, "X-IEWT-Owner": user, "X-IEWT-Generation": "0" },
      body: JSON.stringify({ skillId, itemId, attemptId, correct: true, hinted: false, day: "2026-10-09" }),
    }), env, { waitUntil() {} });
    return { status: res.status, body: await res.json().catch(() => null), attemptId };
  };
  const stored = (attemptId) => db.prepare("SELECT item_id FROM skill_attempts WHERE user_id=? AND attempt_id=?").get(user, attemptId);

  const graded = new Map();
  for (const file of ["ols", "iv2sls", "did", "var", "panel", "logit", "gmm", "foundations", "mle", "forecast", "coint", "financial"]) {
    const course = JSON.parse(read(`assets/data/courses/${file}.json`));
    for (const module of course.modules) for (const stage of module.stages) {
      if (typeof stage.variantId === "string") graded.set(`${course.id}:${stage.id}`, { variantId: stage.variantId, skillIds: stage.skillIds });
    }
  }
  const pairs = [...graded.entries()].flatMap(([key, stage]) => stage.skillIds.map((skillId) => ({ key, skillId, variantId: stage.variantId })));
  assert.equal(graded.size, 181, "the authored curricula carry 181 graded variants");
  assert.equal(pairs.length, 191, "and 191 graded (skill, stage) pairs");
  assert.equal(Object.keys(COURSE_STAGE_BY_VARIANT).length, 181, "the generated variant map has an entry for each variant");
  assert.ok(Object.isFrozen(COURSE_STAGE_BY_VARIANT), "and is frozen");
  for (const [key, stage] of graded) {
    assert.equal(COURSE_STAGE_BY_VARIANT[stage.variantId], key, `${stage.variantId} maps to ${key}`);
    assert.ok(Object.hasOwn(COURSE_STAGE_BY_ID, key), `${key} is a stage of the manifest`);
  }

  let accepted = 0;
  for (const { key, skillId } of pairs) {
    assert.ok(Object.hasOwn(SKILL_BY_ID, skillId));
    const r = await put(skillId, key);
    if (r.status === 200) accepted++;
    else assert.fail(`the id the course player sends (${key}) for ${skillId} was refused: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(stored(r.attemptId).item_id, key, "and is stored as sent");
  }
  assert.equal(accepted, 191, "191 of 191 pairs the course player sends are accepted");

  let aliased = 0;
  for (const { key, skillId, variantId } of pairs) {
    const r = await put(skillId, variantId);
    if (r.status === 200) aliased++;
    else assert.fail(`the variant id ${variantId} for ${skillId} was refused: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(stored(r.attemptId).item_id, key, "a variant id is stored as its course:stage id");
  }
  assert.equal(aliased, 191, "every queued variant event is accepted too: 181 variants over their 191 skill pairs");

  const first = pairs[0];
  const base = await put(first.skillId, first.variantId, "same-attempt");
  const again = await put(first.skillId, first.key, "same-attempt");
  assert.equal(base.status, 200);
  assert.equal(again.status, 200, "a retry that names the stage by its course:stage id is the same attempt as the variant it replaced");
  assert.equal(again.body.duplicate, true, "and is recognised as a duplicate");

  const foreign = pairs.find((pair) => pair.skillId !== first.skillId && !graded.get(first.key).skillIds.includes(pair.skillId));
  assert.equal((await put(foreign.skillId, first.variantId)).status, 400, "a variant id still cannot be used for a skill its stage does not carry");
  assert.equal((await put(first.skillId, first.variantId + "-x")).status, 400, "an unknown variant id is refused");
  assert.equal((await put(first.skillId, "__proto__")).status, 400, "a prototype key is not a variant");
  assert.equal((await put(first.skillId, "constructor")).status, 400, "nor is an inherited property name");
  assert.equal((await put(first.skillId, first.skillId + ":v1")).status, 200, "the challenge ids still validate as before");
  assert.equal(db.prepare("SELECT count(*) AS n FROM skill_attempts WHERE item_id NOT LIKE '%:%'").get().n, 0, "no stored item id is a bare variant");
}

console.log(`Mastery contract OK: ${bank.items.length} review items; browser/server scheduler parity verified.`);
