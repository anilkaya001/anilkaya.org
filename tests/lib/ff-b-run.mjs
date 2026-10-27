import { collector, buildApi } from "./ff-b-kit.mjs";

export const isBattery = (fn) => typeof fn === "function" && fn.length === 2;

export async function runModule(c, module, build = buildApi, only = null) {
  for (const [name, fn] of Object.entries(module)) {
    if (!isBattery(fn)) continue;
    if (only && !only.includes(name)) continue;
    try {
      await fn(c, build);
    } catch (e) {
      c.ok(false, name + " threw", e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : String(e));
    }
  }
}

export async function runSuite(label, modules, build = buildApi) {
  const c = collector();
  const started = Date.now();
  for (const module of modules) await runModule(c, module, build);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (c.failed.length) {
    for (const f of c.failed.slice(0, 60)) console.log("FAIL " + f.id + (f.detail ? " :: " + f.detail : ""));
    console.log(label + ": " + c.failed.length + " of " + c.count() + " checks failed");
    process.exitCode = 1;
  } else {
    console.log(label + ": " + c.count() + " checks passed in " + seconds + " s");
  }
  return c;
}
