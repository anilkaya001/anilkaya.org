import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const context = { window: {}, console };
vm.createContext(context);

for (const file of [
  "assets/js/course-catalog.js",
  "assets/js/curriculum.js",
  "assets/js/curriculum-data.js",
  "assets/js/curriculum-questions.js",
]) vm.runInContext(read(file), context, { filename: file });

const REVIEW_TYPES = new Set(["quiz", "truefalse", "multi", "numeric", "fillblank"]);
const HTML_ENTITIES = Object.freeze({
  amp: "&",
  gt: ">",
  lt: "<",
  mdash: "—",
  quot: '"',
  apos: "'",
  nbsp: " ",
  times: "×",
  rarr: "→",
});

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
  const text = value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/&#(\d+);|&#x([\dA-F]+);|&([A-Za-z][A-Za-z0-9]+);/gi, decodeEntity)
    .replace(/\s+/g, " ")
    .trim();
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

function reviewItem(stage, metadata) {
  const label = `${metadata.courseId}:${metadata.stageId}`;
  const item = {
    id: label,
    courseId: metadata.courseId,
    courseTitle: plainText(metadata.courseTitle, `${label}.courseTitle`),
    courseSlug: metadata.courseSlug,
    moduleId: metadata.moduleId,
    moduleTitle: plainText(metadata.moduleTitle, `${label}.moduleTitle`),
    stageId: metadata.stageId,
    stageIndex: metadata.stageIndex,
    type: stage.type,
    title: plainText(stage.title, `${label}.title`),
    prompt: plainText(stage.prompt, `${label}.prompt`),
  };

  for (const key of ["lead", "hint", "explain"]) {
    const value = optionalText(stage, key, label);
    if (value !== undefined) item[key] = value;
  }
  if (Array.isArray(stage.why)) {
    item.why = stage.why.map((value, index) =>
      value == null || value === "" ? "" : plainText(value, `${label}.why[${index}]`));
  }

  if (stage.type === "quiz") {
    if (!Array.isArray(stage.choices) || stage.choices.length < 2) throw new TypeError(`${label}.choices must contain at least two values`);
    item.choices = stage.choices.map((choice, index) => plainText(choice, `${label}.choices[${index}]`));
    if (!Number.isInteger(stage.answer) || stage.answer < 0 || stage.answer >= item.choices.length) throw new TypeError(`${label}.answer is invalid`);
    item.answer = stage.answer;
  } else if (stage.type === "truefalse") {
    if (typeof stage.answer !== "boolean") throw new TypeError(`${label}.answer must be boolean`);
    item.answer = stage.answer;
  } else if (stage.type === "multi") {
    if (!Array.isArray(stage.choices) || stage.choices.length < 2) throw new TypeError(`${label}.choices must contain at least two values`);
    item.choices = stage.choices.map((choice, index) => plainText(choice, `${label}.choices[${index}]`));
    if (!Array.isArray(stage.answers) || !stage.answers.length ||
        stage.answers.some((answer) => !Number.isInteger(answer) || answer < 0 || answer >= item.choices.length) ||
        new Set(stage.answers).size !== stage.answers.length) throw new TypeError(`${label}.answers is invalid`);
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
  } else {
    throw new TypeError(`${label} has unsupported review type ${stage.type}`);
  }

  return item;
}

const outDir = path.join(ROOT, "assets/data/courses");
mkdirSync(outDir, { recursive: true });

const topics = context.window.TOPIC_META || [];
const metadataById = new Map(topics.map((topic) => [topic.id, topic]));
const courses = [];
for (const [topicId, authored] of Object.entries(context.window.CURRICULUM || {})) {
  const course = JSON.parse(JSON.stringify(authored));
  course.schemaVersion = 1;
  course.modules.forEach((module) => {
    module.stages.forEach((stage, index) => {
      stage.id = `${module.id}-${String(index + 1).padStart(2, "0")}`;
    });
  });
  writeFileSync(path.join(outDir, `${topicId}.json`), `${JSON.stringify(course)}\n`);
  courses.push(course);
}

const reviewItems = [];
for (const course of courses) {
  const meta = metadataById.get(course.id);
  if (!meta || typeof meta.slug !== "string" || !/^[a-z0-9-]+$/.test(meta.slug)) {
    throw new TypeError(`${course.id} is missing valid catalogue metadata`);
  }
  let stageIndex = 0;
  for (const module of course.modules) {
    for (const stage of module.stages) {
      if (REVIEW_TYPES.has(stage.type)) {
        reviewItems.push(reviewItem(stage, {
          courseId: course.id,
          courseTitle: course.title,
          courseSlug: meta.slug,
          moduleId: module.id,
          moduleTitle: module.title,
          stageId: stage.id,
          stageIndex,
        }));
      }
      stageIndex++;
    }
  }
}

const seenReviewIds = new Set();
for (const item of reviewItems) {
  if (!/^[a-z0-9_-]+:[a-z0-9-]+-\d{2}$/.test(item.id)) throw new TypeError(`Invalid review item id: ${item.id}`);
  if (seenReviewIds.has(item.id)) throw new TypeError(`Duplicate review item id: ${item.id}`);
  seenReviewIds.add(item.id);
}

const bank = { schemaVersion: 1, items: reviewItems };
writeFileSync(path.join(ROOT, "assets/data/review-bank.json"), `${JSON.stringify(bank)}\n`);

const browserCatalogue = reviewItems.map((item) => ({
  id: item.id,
  courseId: item.courseId,
  stageIndex: item.stageIndex,
  type: item.type,
  title: item.title,
}));
const browserCatalogueSource = `/* Generated by scripts/generate-course-payloads.mjs. Do not edit. */
(() => {
  "use strict";
  window.REVIEW_ITEMS = Object.freeze([
${browserCatalogue.map((item) => `    Object.freeze(${JSON.stringify(item)}),`).join("\n")}
  ]);
})();
`;
writeFileSync(path.join(ROOT, "assets/js/review-catalog.js"), browserCatalogueSource);

const manifestEntries = reviewItems.map((item) => {
  const metadata = {
    id: item.id,
    courseId: item.courseId,
    courseSlug: item.courseSlug,
    moduleId: item.moduleId,
    stageId: item.stageId,
    stageIndex: item.stageIndex,
    type: item.type,
  };
  return `  ${JSON.stringify(item.id)}: Object.freeze(${JSON.stringify(metadata)}),`;
}).join("\n");
const manifest = `/* Generated by scripts/generate-course-payloads.mjs. Do not edit. */
export const REVIEW_ITEM_BY_ID = Object.freeze({
${manifestEntries}
});

export const REVIEW_ITEMS = Object.freeze(Object.values(REVIEW_ITEM_BY_ID));
export const REVIEW_ITEM_IDS = Object.freeze(Object.keys(REVIEW_ITEM_BY_ID));

export function hasReviewItem(id) {
  return typeof id === "string" && Object.hasOwn(REVIEW_ITEM_BY_ID, id);
}
`;
writeFileSync(path.join(ROOT, "shared/review-manifest.js"), manifest);

console.log(`Generated ${courses.length} course payloads in assets/data/courses`);
console.log(`Generated ${reviewItems.length} review items in assets/data/review-bank.json, assets/js/review-catalog.js, and shared/review-manifest.js`);
