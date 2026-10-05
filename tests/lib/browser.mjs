import { existsSync, statSync } from "node:fs";
import { chromium } from "playwright";

export const CHROMIUM_PATH_VAR = "PW_CHROMIUM_PATH";

export function launchOptions(opts = {}, env = process.env) {
  const out = { ...opts };
  const exe = env[CHROMIUM_PATH_VAR];
  if (!exe || out.executablePath !== undefined) return out;
  if (!existsSync(exe) || !statSync(exe).isFile()) {
    throw new Error(`browser: ${CHROMIUM_PATH_VAR}=${exe} is not a file; unset it to use Playwright's own Chromium`);
  }
  out.executablePath = exe;
  return out;
}

export function launch(opts = {}, env = process.env) {
  return chromium.launch(launchOptions(opts, env));
}
