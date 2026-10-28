import { extrasCap } from "../../../shared/flows-vendor-extras.js";
import { nightlyOn } from "../../../shared/flows-flowlab.js";
import { readFlowlab, FLOWLAB_KEYS, callCeiling } from "../../flows-legs/flowlab.mjs";
import { DEADLINE_MS } from "../vendor-params.mjs";
import { poolWidth, runPooled, stats } from "../vendor.mjs";
import { publish, publishedStore } from "../store.mjs";

export const FLOWLAB_STAGE_ID = "flowlab";

export const FLOWLAB_PUBLISHES = FLOWLAB_KEYS;

export async function flowlabStage(ctx, deps = {}) {
  const { vendor, sessionDate, generatedAt, marketLegs } = ctx;
  const { env = process.env, put = publish, store = publishedStore, pool = runPooled, width = poolWidth(2).width, now = Date.now, startedAt = stats.startedAt } = deps;
  const extras = marketLegs && marketLegs.extras ? marketLegs.extras : null;
  const cap = callCeiling(env, extras ? extras.calls : 0, extrasCap(env));
  const alerts = store.flowalerts;
  const result = await readFlowlab({
    vendor,
    sessionDate,
    generatedAt,
    cap,
    env,
    deadline: startedAt + DEADLINE_MS,
    pool,
    width,
    alertRows: alerts && Array.isArray(alerts.rows) ? alerts.rows : [],
    log: console.log,
  });
  const written = [];
  for (const key of FLOWLAB_KEYS) {
    if (!result.payloads[key]) continue;
    try {
      await put(key, result.payloads[key]);
      written.push(key);
    } catch (error) {
      if (error && error.fixtureLeak) throw error;
      result.failures.push(`${key}: ${error && error.message ? error.message : error}`);
    }
  }
  return { ...result, written, cap, at: now() };
}

export async function runFlowlab(ctx) {
  const { stages } = ctx;
  const deps = ctx.flowlabDeps || {};
  const env = deps.env || process.env;
  if (!nightlyOn(env)) {
    stages.skip("flowlab", "FLOWS_FLOWLAB_NIGHTLY is off");
    return;
  }
  const result = await stages.run("flowlab", async () => {
    const out = await flowlabStage(ctx, deps);
    stages.detail({ flCalls: out.calls, flSkipped: out.skipped.length });
    if (out.failures.length) console.warn("  flowlab: " + out.failures.join("; ") + " — the last good keys stand");
    return out;
  }, (error) => {
    console.warn("  flowlab: " + error.message + " — the last good keys stand");
  });
  Object.assign(ctx, { flowlab: result || null });
}

export async function runFlowlabWith(ctx, deps) {
  const run = { ...ctx, flowlabDeps: deps || {} };
  await runFlowlab(run);
  Object.assign(ctx, { flowlab: run.flowlab });
}
