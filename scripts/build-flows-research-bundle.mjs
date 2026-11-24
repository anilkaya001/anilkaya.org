import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../tests/package.json", import.meta.url));
const { build } = require("esbuild");
const target = new URL("../assets/js/flows-research-model.bundle.js", import.meta.url);
const result = await build({
  entryPoints: [fileURLToPath(new URL("../shared/flows-research-model.js", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "FlowsResearchModel",
  legalComments: "none",
  charset: "utf8",
  logLevel: "silent",
});
const moduleCode = result.outputFiles[0].text.replace(/^\s*\/\/ .*$/gm, "").replaceAll("/* @__PURE__ */ ", "").trim();
const output = '(() => {\n"use strict";\n' + moduleCode
  + '\nwindow.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { researchModel: FlowsResearchModel }));\n})();\n';

if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) throw new Error("Rebuild the Flows research browser model.");
  console.log("Flows research bundle is current.");
} else {
  writeFileSync(target, output);
}
