import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const entry = (file, name, symbols) => ({
  out: file,
  contents: `import * as M from "./shared/${name}.js";\nconst api = Object.freeze({ ${symbols.map((s) => `${s}: M.${s}`).join(", ")} });\n` +
    `const key = ${JSON.stringify(name === "flows-oracle-live" ? "oracleLive" : "oracleWords")};\n` +
    `window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { [key]: api }));\n`,
});

export const ORACLE_BUNDLES = Object.freeze([
  entry("assets/js/flows-oracle-live.bundle.js", "flows-oracle-live", ["createLiveState", "detect", "detectName", "LIVE_LINES", "KINDS"]),
  entry("assets/js/flows-oracle-words.bundle.js", "flows-oracle-words", ["STANCE_LINES", "MODEL_IMPLIED", "CONVICTION_WORDS", "callSay", "liveSay", "usd", "usdShort", "pct", "dayLabel", "leanWord", "BUILDING_LINES", "calmLine"]),
]);

export async function buildOracleBundle(spec) {
  const esbuild = createRequire(path.join(ROOT, "tests", "package.json"))("esbuild");
  const result = await esbuild.build({
    stdin: { contents: spec.contents, resolveDir: ROOT, sourcefile: "oracle-entry.js", loader: "js" },
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
    plugins: [{
      name: "page-ask-split",
      setup(build) {
        build.onResolve({ filter: /flows-tape-stats\.js$/ }, () => ({ path: "flows-tape-stats", namespace: "page" }));
        build.onLoad({ filter: /.*/, namespace: "page" }, () => ({ contents: "export const askSplit = (row) => window.FlowsUI.F.askSplit(row);", loader: "js" }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stale = false;
  for (const spec of ORACLE_BUNDLES) {
    const code = await buildOracleBundle(spec);
    const target = path.join(ROOT, spec.out);
    const before = (() => { try { return readFileSync(target, "utf8"); } catch { return null; } })();
    if (process.argv.includes("--check")) {
      if (before !== code) {
        stale = true;
        console.error(`${spec.out} is stale: run node scripts/build-flows-oracle-bundle.mjs`);
      }
    } else {
      writeFileSync(target, code);
      console.log(`${spec.out}: ${code.length} bytes`);
    }
  }
  if (stale) process.exit(1);
}
