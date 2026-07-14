import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const context = { window: {}, console };
vm.createContext(context);

for (const file of [
  "assets/js/curriculum.js",
  "assets/js/curriculum-data.js",
  "assets/js/curriculum-questions.js",
]) vm.runInContext(read(file), context, { filename: file });

const outDir = path.join(ROOT, "assets/data/courses");
mkdirSync(outDir, { recursive: true });

for (const [topicId, authored] of Object.entries(context.window.CURRICULUM || {})) {
  const course = JSON.parse(JSON.stringify(authored));
  course.schemaVersion = 1;
  course.modules.forEach((module) => {
    module.stages.forEach((stage, index) => {
      stage.id = `${module.id}-${String(index + 1).padStart(2, "0")}`;
    });
  });
  writeFileSync(path.join(outDir, `${topicId}.json`), `${JSON.stringify(course)}\n`);
}

console.log(`Generated ${Object.keys(context.window.CURRICULUM || {}).length} course payloads in assets/data/courses`);
