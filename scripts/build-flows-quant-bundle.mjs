import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BUNDLE_ENTRY = "shared/flows-quant-browser.js";
export const BUNDLE_OUT = "assets/js/flows-quant.bundle.js";
export const READ_BUNDLE_ENTRY = "shared/flows-quant-read.js";
export const READ_BUNDLE_OUT = "assets/js/flows-quant-read.bundle.js";
export const BUNDLES = Object.freeze([[BUNDLE_ENTRY, BUNDLE_OUT], [READ_BUNDLE_ENTRY, READ_BUNDLE_OUT]]);

export async function buildQuantBundle(entry = BUNDLE_ENTRY) {
  const esbuild = createRequire(path.join(ROOT, "tests", "package.json"))("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "FlowsQuant",
    platform: "browser",
    target: "es2020",
    charset: "utf8",
    legalComments: "none",
    treeShaking: true,
    minify: true,
    pure: ["Object.freeze"],
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stale = false;
  for (const [entry, out] of BUNDLES) {
    const code = await buildQuantBundle(entry);
    const target = path.join(ROOT, out);
    const before = (() => { try { return readFileSync(target, "utf8"); } catch { return null; } })();
    if (process.argv.includes("--check")) {
      if (before !== code) {
        console.error(`${out} is stale: run node scripts/build-flows-quant-bundle.mjs`);
        stale = true;
      } else {
        console.log(`${out} is current (${code.length} bytes)`);
      }
    } else {
      writeFileSync(target, code);
      console.log(`${out}: ${code.length} bytes${before === code ? ", unchanged" : ""}`);
    }
  }
  if (stale) process.exit(1);
}
