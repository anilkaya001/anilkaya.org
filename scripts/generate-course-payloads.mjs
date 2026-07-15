import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const writeJSON = (file, value) => {
  const target = path.join(ROOT, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value)}\n`);
};
const context = { window: {}, console };
vm.createContext(context);

for (const file of [
  "assets/js/course-catalog.js",
  "assets/js/skill-catalog.js",
  "assets/js/curriculum.js",
  "assets/js/curriculum-data.js",
  "assets/js/curriculum-questions.js",
  "assets/js/curriculum-academy.js",
]) vm.runInContext(read(file), context, { filename: file });

const REVIEW_TYPES = new Set(["quiz", "truefalse", "multi", "numeric", "fillblank"]);
const GRADED_TYPES = new Set([...REVIEW_TYPES, "codechallenge", "case", "match"]);
const KNOWN_TYPES = new Set(["read", "code", "interactive", "conceptlab", ...GRADED_TYPES]);
const DEFAULT_POINTS = Object.freeze({
  read: 5, code: 10, interactive: 10, conceptlab: 10,
  quiz: 15, truefalse: 10, fillblank: 15, numeric: 20, multi: 20,
  codechallenge: 20, case: 15, match: 15,
});
const DEFAULT_MINUTES = Object.freeze({
  read: 6, code: 10, interactive: 8, conceptlab: 6,
  quiz: 5, truefalse: 3, fillblank: 4, numeric: 5, multi: 5,
  codechallenge: 12, case: 8, match: 6,
});
const HTML_ENTITIES = Object.freeze({ amp: "&", gt: ">", lt: "<", mdash: "—", quot: '"', apos: "'", nbsp: " ", times: "×", rarr: "→" });
const STAGE_ID = /^[a-z0-9][a-z0-9-]{2,95}$/;
const SKILL_ID = /^[a-z0-9][a-z0-9.-]{2,127}$/;

function decodeEntity(match, decimal, hexadecimal, named) {
  const point = decimal ? Number(decimal) : hexadecimal ? Number.parseInt(hexadecimal, 16) : null;
  if (point != null) {
    try { return String.fromCodePoint(point); }
    catch { return "�"; }
  }
  const key = String(named || "").toLowerCase();
  return Object.hasOwn(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : match;
}

function plainText(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const text = value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/&#(\d+);|&#x([\dA-F]+);|&([A-Za-z][A-Za-z0-9]+);/gi, decodeEntity)
    .replace(/\s+/g, " ").trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  return text;
}

function optionalText(stage, key, label) {
  return stage[key] == null || stage[key] === "" ? undefined : plainText(stage[key], `${label}.${key}`);
}

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function fingerprint(stage) {
  return `${stage.type}|${plainText(stage.title || "untitled", "stage.title").toLowerCase()}`;
}

const legacyMapFile = "assets/data/stage-id-map-v2.json";
function createLegacyMap() {
  const entries = [];
  for (const topic of context.window.TOPIC_META || []) {
    const file = path.join(ROOT, "assets/data/courses", `${topic.id}.json`);
    if (!existsSync(file)) continue;
    const course = JSON.parse(readFileSync(file, "utf8"));
    let stageIndex = 0;
    for (const module of course.modules || []) {
      for (let moduleIndex = 0; moduleIndex < module.stages.length; moduleIndex++) {
        const stage = module.stages[moduleIndex];
        entries.push({ courseId: course.id, moduleId: module.id, moduleIndex, stageIndex, stageId: stage.id, fingerprint: fingerprint(stage) });
        stageIndex++;
      }
    }
  }
  if (entries.length !== 205) throw new Error(`The v2 stage freeze expected 205 stages, found ${entries.length}`);
  const map = { schemaVersion: 1, frozenStageCount: entries.length, entries };
  writeJSON(legacyMapFile, map);
  return map;
}

const legacyMap = existsSync(path.join(ROOT, legacyMapFile)) ? JSON.parse(read(legacyMapFile)) : createLegacyMap();
if (!legacyMap || legacyMap.frozenStageCount !== 205 || !Array.isArray(legacyMap.entries)) throw new Error("Invalid stable v2 stage map");
const legacyByCourseModule = new Map();
for (const entry of legacyMap.entries) {
  const key = `${entry.courseId}:${entry.moduleId}`;
  if (!legacyByCourseModule.has(key)) legacyByCourseModule.set(key, []);
  legacyByCourseModule.get(key).push(entry);
}

const topics = context.window.TOPIC_META || [];
const metadataById = new Map(topics.map((topic) => [topic.id, topic]));
const skillCatalogue = context.window.SKILL_CATALOG || [];
const skillById = new Map(skillCatalogue.map((skill) => [skill.id, skill]));
const skillsByCourse = context.window.COURSE_SKILLS || {};
const usedStageIds = new Set();

const skillGraph = skillCatalogue.map((skill) => {
  const courseSkills = skillsByCourse[skill.courseId] || [];
  const index = courseSkills.indexOf(skill.id);
  const prerequisiteSkillIds = index > 0 ? [courseSkills[index - 1]] :
    (metadataById.get(skill.courseId)?.prerequisites || []).map((courseId) => (skillsByCourse[courseId] || []).at(-1)).filter(Boolean);
  return { id: skill.id, courseId: skill.courseId, prerequisiteSkillIds: [...new Set(prerequisiteSkillIds)] };
});
const skillGraphById = new Map(skillGraph.map((skill) => [skill.id, skill]));
const visiting = new Set(), visited = new Set();
function visitSkill(id) {
  if (visiting.has(id)) throw new Error(`Cyclic skill graph at ${id}`);
  if (visited.has(id)) return;
  const skill = skillGraphById.get(id);
  if (!skill) throw new Error(`Unknown skill graph node ${id}`);
  visiting.add(id);
  for (const prerequisite of skill.prerequisiteSkillIds) {
    if (!skillGraphById.has(prerequisite)) throw new Error(`Unknown prerequisite skill ${prerequisite}`);
    visitSkill(prerequisite);
  }
  visiting.delete(id); visited.add(id);
}
for (const skill of skillGraph) visitSkill(skill.id);
writeJSON("assets/data/skill-graph.json", { schemaVersion: 1, skills: skillGraph });

function stableId(stage, courseId, moduleId, moduleIndex) {
  if (typeof stage.id === "string" && STAGE_ID.test(stage.id)) return stage.id;
  const candidates = legacyByCourseModule.get(`${courseId}:${moduleId}`) || [];
  const available = (entry) => !usedStageIds.has(`${courseId}:${entry.stageId}`);
  const exact = candidates.find((entry) => available(entry) && entry.fingerprint === fingerprint(stage));
  const fallback = candidates.find((entry) => available(entry) && entry.moduleIndex === moduleIndex) || candidates.find(available);
  const match = exact || fallback;
  if (!match) throw new Error(`No frozen stage id for ${courseId}:${moduleId}:${moduleIndex}`);
  return match.stageId;
}

function defaultSkillIds(courseId, moduleIndex, stageIndex) {
  const skills = skillsByCourse[courseId] || [];
  if (!skills.length) throw new Error(`No skill taxonomy for ${courseId}`);
  const first = Math.min(skills.length - 1, Math.floor((moduleIndex / Math.max(1, 3)) * skills.length));
  const offset = stageIndex % 2;
  return [skills[Math.min(skills.length - 1, first + offset)]];
}

function normalizeStage(stage, metadata) {
  if (!stage || typeof stage !== "object" || !KNOWN_TYPES.has(stage.type)) throw new TypeError(`${metadata.courseId}:${metadata.moduleId} has an unknown stage type`);
  const normalized = JSON.parse(JSON.stringify(stage));
  normalized.id = stableId(stage, metadata.courseId, metadata.moduleId, metadata.moduleIndex);
  if (!STAGE_ID.test(normalized.id) || usedStageIds.has(`${metadata.courseId}:${normalized.id}`)) throw new Error(`Duplicate or invalid stage id ${metadata.courseId}:${normalized.id}`);
  usedStageIds.add(`${metadata.courseId}:${normalized.id}`);
  const skillIds = Array.isArray(normalized.skillIds) && normalized.skillIds.length ? [...new Set(normalized.skillIds)] : defaultSkillIds(metadata.courseId, metadata.moduleIndexGlobal, metadata.moduleIndex);
  if (skillIds.some((id) => !SKILL_ID.test(id) || !skillById.has(id) || skillById.get(id).courseId !== metadata.courseId)) throw new Error(`Invalid skill mapping on ${metadata.courseId}:${normalized.id}`);
  normalized.skillIds = skillIds;
  normalized.estimatedMinutes = Number.isInteger(normalized.estimatedMinutes) && normalized.estimatedMinutes > 0 && normalized.estimatedMinutes <= 90 ? normalized.estimatedMinutes : DEFAULT_MINUTES[normalized.type];
  normalized.difficulty = ["core", "applied", "advanced"].includes(normalized.difficulty) ? normalized.difficulty : metadata.level === "Beginner" ? "core" : metadata.level === "Intermediate" ? "applied" : "advanced";
  normalized.prerequisiteStageIds = Array.isArray(normalized.prerequisiteStageIds) ? [...new Set(normalized.prerequisiteStageIds)] : metadata.previousStageId ? [metadata.previousStageId] : [];
  if (GRADED_TYPES.has(normalized.type) && typeof normalized.variantId !== "string") normalized.variantId = `${normalized.id}-core`;
  return normalized;
}

function reviewItem(stage, metadata) {
  const label = `${metadata.courseId}:${metadata.stageId}`;
  const item = {
    id: label, courseId: metadata.courseId, courseTitle: plainText(metadata.courseTitle, `${label}.courseTitle`),
    courseSlug: metadata.courseSlug, moduleId: metadata.moduleId, moduleTitle: plainText(metadata.moduleTitle, `${label}.moduleTitle`),
    stageId: metadata.stageId, stageIndex: metadata.stageIndex, skillIds: stage.skillIds, variantId: stage.variantId,
    type: stage.type, title: plainText(stage.title, `${label}.title`), prompt: plainText(stage.prompt, `${label}.prompt`),
  };
  for (const key of ["lead", "hint", "explain"]) {
    const value = optionalText(stage, key, label);
    if (value !== undefined) item[key] = value;
  }
  if (Array.isArray(stage.why)) item.why = stage.why.map((value, index) => value == null || value === "" ? "" : plainText(value, `${label}.why[${index}]`));
  if (stage.type === "quiz") {
    if (!Array.isArray(stage.choices) || stage.choices.length < 2) throw new TypeError(`${label}.choices must contain at least two values`);
    item.choices = stage.choices.map((choice, index) => plainText(choice, `${label}.choices[${index}]`));
    if (!Number.isInteger(stage.answer) || stage.answer < 0 || stage.answer >= item.choices.length) throw new TypeError(`${label}.answer is invalid`);
    item.answer = stage.answer;
  } else if (stage.type === "truefalse") {
    if (typeof stage.answer !== "boolean") throw new TypeError(`${label}.answer must be boolean`);
    item.answer = stage.answer;
  } else if (stage.type === "multi") {
    item.choices = stage.choices.map((choice, index) => plainText(choice, `${label}.choices[${index}]`));
    if (!Array.isArray(stage.answers) || !stage.answers.length || stage.answers.some((answer) => !Number.isInteger(answer) || answer < 0 || answer >= item.choices.length) || new Set(stage.answers).size !== stage.answers.length) throw new TypeError(`${label}.answers is invalid`);
    item.answers = [...stage.answers].sort((a, b) => a - b);
  } else if (stage.type === "numeric") {
    item.answer = finiteNumber(stage.answer, `${label}.answer`);
    if (stage.tol != null) item.tol = finiteNumber(stage.tol, `${label}.tol`);
    if (stage.rtol != null) item.rtol = finiteNumber(stage.rtol, `${label}.rtol`);
    if (item.tol == null && item.rtol == null) throw new TypeError(`${label} needs tol or rtol`);
    if ((item.tol != null && item.tol < 0) || (item.rtol != null && item.rtol < 0)) throw new TypeError(`${label} tolerances must be non-negative`);
    const unit = optionalText(stage, "unit", label);
    if (unit !== undefined) item.unit = unit;
  } else if (stage.type === "fillblank") {
    if (!Array.isArray(stage.accept) || !stage.accept.length) throw new TypeError(`${label}.accept must not be empty`);
    item.accept = stage.accept.map((answer, index) => plainText(answer, `${label}.accept[${index}]`));
  }
  return item;
}

const courses = [];
const reviewItems = [];
const stageCatalogue = {};
const stagePoints = {};
for (const [topicId, authored] of Object.entries(context.window.CURRICULUM || {})) {
  const meta = metadataById.get(topicId);
  if (!meta || !/^[a-z0-9-]+$/.test(meta.slug)) throw new TypeError(`${topicId} is missing valid catalogue metadata`);
  const course = { id: authored.id, title: authored.title, schemaVersion: 2, modules: [] };
  let stageIndex = 0;
  let previousStageId = null;
  const catalogueEntries = [];
  const points = [];
  for (let moduleIndexGlobal = 0; moduleIndexGlobal < authored.modules.length; moduleIndexGlobal++) {
    const sourceModule = authored.modules[moduleIndexGlobal];
    const module = { id: sourceModule.id, title: sourceModule.title, summary: sourceModule.summary || "", stages: [] };
    for (let moduleIndex = 0; moduleIndex < sourceModule.stages.length; moduleIndex++) {
      const stage = normalizeStage(sourceModule.stages[moduleIndex], { courseId: topicId, moduleId: module.id, moduleIndex, moduleIndexGlobal, previousStageId, level: meta.level });
      const pointValue = Number.isSafeInteger(stage.points) && stage.points >= 0 ? stage.points : DEFAULT_POINTS[stage.type];
      if (!Number.isSafeInteger(pointValue)) throw new Error(`No point value for ${topicId}:${stage.id}`);
      points.push(pointValue);
      catalogueEntries.push({ id: stage.id, index: stageIndex, moduleId: module.id, moduleIndex, type: stage.type, title: plainText(stage.title || "Lesson", `${topicId}:${stage.id}.title`), skillIds: stage.skillIds, estimatedMinutes: stage.estimatedMinutes, difficulty: stage.difficulty, points: pointValue });
      if (REVIEW_TYPES.has(stage.type)) reviewItems.push(reviewItem(stage, { courseId: topicId, courseTitle: course.title, courseSlug: meta.slug, moduleId: module.id, moduleTitle: module.title, stageId: stage.id, stageIndex }));
      module.stages.push(stage);
      previousStageId = stage.id;
      stageIndex++;
    }
    course.modules.push(module);
    const modulePayload = { schemaVersion: 2, courseId: topicId, module };
    const moduleText = JSON.stringify(modulePayload);
    const moduleGzip = gzipSync(moduleText).length;
    if (moduleGzip > 6 * 1024) throw new Error(`${topicId}/${module.id} is ${moduleGzip} bytes gzip; module budget is 6144`);
    writeJSON(`assets/data/courses/${topicId}/${module.id}.json`, modulePayload);
  }
  if (stageIndex !== meta.stages || course.modules.length !== meta.modules) throw new Error(`${topicId} catalogue says ${meta.stages} stages/${meta.modules} modules, authored ${stageIndex}/${course.modules.length}`);
  const manifest = {
    schemaVersion: 2, id: course.id, title: course.title, totalStages: stageIndex,
    modules: course.modules.map((module) => ({ id: module.id, title: module.title, summary: module.summary, stageCount: module.stages.length, stages: catalogueEntries.filter((entry) => entry.moduleId === module.id) })),
  };
  writeJSON(`assets/data/courses/${topicId}/manifest.json`, manifest);
  writeJSON(`assets/data/courses/${topicId}.json`, course);
  courses.push(course);
  stageCatalogue[topicId] = catalogueEntries;
  stagePoints[topicId] = points;
}

if (courses.length !== 12) throw new Error(`Expected 12 courses, generated ${courses.length}`);
const totalStages = courses.reduce((sum, course) => sum + course.modules.reduce((n, module) => n + module.stages.length, 0), 0);
if (totalStages !== 365) throw new Error(`Expected 365 stages, generated ${totalStages}`);

const seenReviewIds = new Set();
for (const item of reviewItems) {
  if (!/^[a-z0-9_-]+:[a-z0-9-]+$/.test(item.id) || seenReviewIds.has(item.id)) throw new TypeError(`Duplicate or invalid review item id: ${item.id}`);
  seenReviewIds.add(item.id);
}
writeJSON("assets/data/review-bank.json", { schemaVersion: 2, items: reviewItems });

const challengeItems = [];
for (const skill of skillCatalogue) {
  const variants = [
    { prompt: `Which workflow best demonstrates ${skill.title}?`, correct: skill.practice, distractors: [`Skip ${skill.diagnostic} and report the first estimate.`, `Choose the result that avoids mentioning ${skill.risk}.`, "Increase decimal precision instead of examining assumptions."], hint: `Think about the action, not just the final number.`, explain: skill.practice },
    { prompt: `Before relying on ${skill.title}, what should be inspected?`, correct: skill.diagnostic, distractors: ["Only whether the coefficient is positive.", "The number of digits printed in the table.", "Whether every alternative specification has the same point estimate."], hint: `Look for the evidence that can reveal the skill's main failure mode.`, explain: `Inspect ${skill.diagnostic}.` },
    { prompt: `Which failure is ${skill.title} chiefly meant to control or reveal?`, correct: skill.risk, distractors: ["A table using too few decimal places.", "A sample mean that is not exactly zero.", "A model containing more than one regressor."], hint: `Focus on what would make the inference or interpretation unreliable.`, explain: `The relevant failure mode is ${skill.risk}.` },
  ];
  variants.forEach((variant, index) => {
    const answer = (index + skill.order) % 4;
    const choices = [...variant.distractors];
    choices.splice(answer, 0, variant.correct);
    challengeItems.push({ id: `${skill.id}:v${index + 1}`, variantId: `v${index + 1}`, skillId: skill.id, courseId: skill.courseId, type: "quiz", title: skill.title, prompt: variant.prompt, choices, answer, hint: variant.hint, explain: variant.explain });
  });
}
if (skillCatalogue.length !== 84 || challengeItems.length !== 252) throw new Error(`Expected 84 skills/252 challenge variants, found ${skillCatalogue.length}/${challengeItems.length}`);
writeJSON("assets/data/challenge-bank.json", { schemaVersion: 1, items: challengeItems });

const browserReview = reviewItems.map(({ id, courseId, stageIndex, stageId, skillIds, variantId, type, title }) => ({ id, courseId, stageIndex, stageId, skillIds, variantId, type, title }));
const browserReviewSource = `/* Generated by scripts/generate-course-payloads.mjs. Do not edit. */\n(() => {\n  "use strict";\n  window.REVIEW_ITEMS = Object.freeze(${JSON.stringify(browserReview)}.map(Object.freeze));\n})();\n`;
writeFileSync(path.join(ROOT, "assets/js/review-catalog.js"), browserReviewSource);

const browserStageSource = `/* Generated by scripts/generate-course-payloads.mjs. Do not edit. */\n(() => {\n  "use strict";\n  const catalogue = ${JSON.stringify(stageCatalogue)};\n  const points = ${JSON.stringify(stagePoints)};\n  window.COURSE_STAGE_CATALOG = Object.freeze(Object.fromEntries(Object.entries(catalogue).map(([id, stages]) => [id, Object.freeze(stages.map(Object.freeze))])));\n  window.COURSE_STAGE_IDS = Object.freeze(Object.fromEntries(Object.entries(catalogue).map(([id, stages]) => [id, Object.freeze(stages.map((stage) => stage.id))])));\n  window.COURSE_STAGE_POINTS = Object.freeze(Object.fromEntries(Object.entries(points).map(([id, values]) => [id, Object.freeze(values)])));\n})();\n`;
writeFileSync(path.join(ROOT, "assets/js/stage-catalog.js"), browserStageSource);

const reviewManifestEntries = reviewItems.map((item) => `  ${JSON.stringify(item.id)}: Object.freeze(${JSON.stringify({ id: item.id, courseId: item.courseId, courseSlug: item.courseSlug, moduleId: item.moduleId, stageId: item.stageId, stageIndex: item.stageIndex, skillIds: item.skillIds, variantId: item.variantId, type: item.type })}),`).join("\n");
writeFileSync(path.join(ROOT, "shared/review-manifest.js"), `/* Generated by scripts/generate-course-payloads.mjs. Do not edit. */\nexport const REVIEW_ITEM_BY_ID = Object.freeze({\n${reviewManifestEntries}\n});\nexport const REVIEW_ITEMS = Object.freeze(Object.values(REVIEW_ITEM_BY_ID));\nexport const REVIEW_ITEM_IDS = Object.freeze(Object.keys(REVIEW_ITEM_BY_ID));\nexport function hasReviewItem(id) { return typeof id === "string" && Object.hasOwn(REVIEW_ITEM_BY_ID, id); }\n`);

const stageManifestEntries = Object.entries(stageCatalogue).flatMap(([courseId, stages]) => stages.map((stage) => `  ${JSON.stringify(`${courseId}:${stage.id}`)}: Object.freeze(${JSON.stringify({ ...stage, courseId })}),`)).join("\n");
writeFileSync(path.join(ROOT, "shared/stage-manifest.js"), `/* Generated by scripts/generate-course-payloads.mjs. Do not edit. */\nexport const COURSE_STAGE_BY_ID = Object.freeze({\n${stageManifestEntries}\n});\nexport const COURSE_STAGE_IDS = Object.freeze(Object.keys(COURSE_STAGE_BY_ID));\nexport function stageKey(courseId, stageId) { return typeof courseId === "string" && typeof stageId === "string" ? courseId + ":" + stageId : ""; }\n`);

const skillManifestEntries = skillCatalogue.map((skill) => `  ${JSON.stringify(skill.id)}: Object.freeze(${JSON.stringify({ id: skill.id, courseId: skill.courseId, order: skill.order })}),`).join("\n");
writeFileSync(path.join(ROOT, "shared/skill-manifest.js"), `/* Generated by scripts/generate-course-payloads.mjs. Do not edit. */\nexport const SKILL_BY_ID = Object.freeze({\n${skillManifestEntries}\n});\nexport const SKILL_IDS = Object.freeze(Object.keys(SKILL_BY_ID));\n`);

const pointsEntries = Object.entries(stagePoints).map(([id, values]) => `  ${JSON.stringify(id)}: Object.freeze(${JSON.stringify(values)}),`).join("\n");
writeFileSync(path.join(ROOT, "shared/course-points.js"), `/* Generated server-side scoring manifest. */\nexport const COURSE_STAGE_POINTS = Object.freeze({\n${pointsEntries}\n});\nexport function pointsForProgress(progress) { let total=0; for (const [model,value] of Object.entries(progress||{})) { if (!Object.hasOwn(COURSE_STAGE_POINTS,model)||!Array.isArray(value&&value.done)) continue; const weights=COURSE_STAGE_POINTS[model], seen=new Set(); for (const index of value.done) { if (!Number.isInteger(index)||index<0||index>=weights.length||seen.has(index)) continue; seen.add(index); total+=weights[index]; } } return total; }\n`);

const imageById = Object.fromEntries(topics.map((topic) => [topic.id, ["ols", "iv2sls", "did", "var", "panel", "logit", "gmm"].includes(topic.id) ? `/assets/img/og-${topic.id}.png` : "/assets/img/og.png"]));
const seoRows = courses.map((course) => {
  const meta = metadataById.get(course.id);
  return { id: course.id, slug: meta.slug, number: meta.num, name: meta.title, pageTitle: `${meta.title} — Econometrics Lab`, description: meta.blurb, image: imageById[course.id], level: meta.level, modules: course.modules.map(({ title, summary }) => ({ title, summary })) };
});
writeFileSync(path.join(ROOT, "shared/course-seo.js"), `/* Generated search-facing course metadata. */\nexport const SITE_ORIGIN = "https://anilkaya.org";\nconst freezeTopic=(topic)=>Object.freeze({...topic,path:\`/lab/\${topic.slug}/\`,modules:Object.freeze(topic.modules.map((module)=>Object.freeze(module)))});\nexport const COURSE_TOPICS=Object.freeze(${JSON.stringify(seoRows)}.map(freezeTopic));\nexport const COURSE_BY_ID=Object.freeze(Object.fromEntries(COURSE_TOPICS.map((topic)=>[topic.id,topic])));\nexport const COURSE_BY_SLUG=Object.freeze(Object.fromEntries(COURSE_TOPICS.map((topic)=>[topic.slug,topic])));\n`);

console.log(`Generated ${courses.length} courses, ${totalStages} stages, ${skillCatalogue.length} skills, ${reviewItems.length} review items, and ${challengeItems.length} challenge variants`);
