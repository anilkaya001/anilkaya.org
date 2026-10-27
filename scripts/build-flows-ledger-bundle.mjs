import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const LEDGER_BUNDLE_ENTRY = "shared/flows-ledger-browser.js";

export const LEDGER_BUNDLE_OUT = "assets/js/flows-ledger.bundle.js";

export async function buildLedgerBundle() {
  const esbuild = createRequire(path.join(ROOT, "tests", "package.json"))("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, LEDGER_BUNDLE_ENTRY)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    charset: "utf8",
    legalComments: "none",
    treeShaking: true,
    minify: true,
    pure: ["Object.freeze"],
    banner: { js: "\"use strict\";" },
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await buildLedgerBundle();
  const target = path.join(ROOT, LEDGER_BUNDLE_OUT);
  const before = (() => { try { return readFileSync(target, "utf8"); } catch { return null; } })();
  if (process.argv.includes("--check")) {
    if (before !== code) {
      console.error(`${LEDGER_BUNDLE_OUT} is stale: run node scripts/build-flows-ledger-bundle.mjs`);
      process.exit(1);
    }
    console.log(`${LEDGER_BUNDLE_OUT} is current (${code.length} bytes)`);
  } else {
    writeFileSync(target, code);
    console.log(`${LEDGER_BUNDLE_OUT}: ${code.length} bytes${before === code ? ", unchanged" : ""}`);
  }
}
