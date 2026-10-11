import { pinStamp } from "../flows-legs/stamp.mjs";

const ARGS = new Set(process.argv.slice(2));

export const DRY_RUN = ARGS.has("--dry-run");

pinStamp(process.env.FLOWS_DRY_NOW, { dryRun: DRY_RUN });

export const LIVE_MODE = ARGS.has("--live");

export const EMIT = process.argv.includes("--emit")
  ? process.argv[process.argv.indexOf("--emit") + 1]
  : null;
