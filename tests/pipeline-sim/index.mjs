import { createVirtualTime } from "./clock.mjs";
import { ORIGIN } from "./vendor.mjs";

const HERE = new URL(".", import.meta.url);
export const ROOT = new URL("../../", HERE);

export function simEnv() {
  process.env.FLOWS_UW_BASE_URL = ORIGIN;
  process.env.UW_API_KEY = "sim-key";
  delete process.env.FLOWS_UW_TIMEOUT_MS;
  delete process.env.FLOWS_UW_NIGHTLY_DEADLINE;
}

export function boot() {
  simEnv();
  const time = createVirtualTime();
  time.install();
  return time;
}

let counter = 0;

export async function freshVendor() {
  simEnv();
  return import(new URL("scripts/flows-nightly/vendor.mjs", ROOT).href + "?sim=" + (++counter));
}

export { createVirtualTime };
