import { DRY_RUN, EMIT } from "../flags.mjs";
import { ingestURL, publish, publishedStore, readStored } from "../store.mjs";
import { stampNow } from "../../flows-legs/stamp.mjs";
import { FF_METRICS_KEY, buildMetrics, requestRun } from "../../flows-legs/ff-metrics.mjs";
import { FF_CARRY_KEY, buildCarry, resolveCarried } from "../../flows-legs/ff-carry.mjs";

export const FF_STAGE_ID = "ff";

export const FF_PUBLISHES = Object.freeze([FF_METRICS_KEY, FF_CARRY_KEY]);

export const ffNightlyOn = (env = process.env) => String(env.FF_NIGHTLY || "").trim().toLowerCase() !== "off";

export const runUrl = (ingest = ingestURL()) => new URL("/api/ff/run", ingest).href;

export async function ffStage(ctx, deps = {}) {
  const { sessionDate } = ctx;
  const {
    store = publishedStore, read = readStored, put = publish, ask = requestRun, env = process.env, dry = DRY_RUN || Boolean(EMIT),
    now = stampNow, url = runUrl,
  } = deps;
  const generatedAt = now();
  const stored = await read(FF_CARRY_KEY);
  const carried = resolveCarried(stored && !stored.failed ? stored.payload : null, sessionDate);
  const out = { published: [], failures: [] };
  const attempt = async (key, make) => {
    try {
      const payload = make();
      if (!payload) throw new Error("nothing to publish");
      await put(key, payload);
      out.published.push(key);
      return payload;
    } catch (error) {
      if (error && error.fixtureLeak) throw error;
      out.failures.push(key + ": " + (error && error.message ? error.message : String(error)));
      return null;
    }
  };
  let stats = null;
  const metrics = await attempt(FF_METRICS_KEY, () => {
    const built = buildMetrics({
      sessionDate, generatedAt, universe: store.universe,
      histOf: (t) => store["hist:" + t], cardXOf: (t) => store["card-x:" + t], cardOf: (t) => store["card:" + t], carried,
    });
    if (!built.payload) throw new Error("no names to measure (" + built.reason + ")");
    stats = built.stats;
    return built.payload;
  });
  const carry = await attempt(FF_CARRY_KEY, () => buildCarry({ sessionDate, generatedAt, alerts: store.flowalerts, carried }));
  out.stats = stats;
  out.carried = { from: carried.from, reason: carried.reason, rows: carried.windows.length };
  out.carry = carry ? carry.windows.length : null;
  out.run = null;
  if (metrics && !dry) {
    const token = env.FLOWS_INGEST_TOKEN;
    if (!token) out.run = { ok: false, status: 0, body: "no ingest token" };
    else {
      try {
        out.run = await ask({ url: url(), token, session: sessionDate, cadence: "nightly" });
      } catch (error) {
        out.run = { ok: false, status: 0, body: error && error.message ? String(error.message).slice(0, 120) : "no answer" };
      }
    }
  }
  return out;
}

export async function runFf(ctx, deps = {}) {
  const { stages } = ctx;
  const env = deps.env || process.env;
  if (!ffNightlyOn(env)) {
    stages.skip(FF_STAGE_ID, "FF_NIGHTLY is off");
    return;
  }
  const result = await stages.run(FF_STAGE_ID, async () => {
    const out = await ffStage(ctx, deps);
    const s = out.stats;
    stages.detail({
      names: s ? s.names : 0, carded: s ? s.carded : 0, bytes: s ? s.bytes : 0, carry: out.carry === null ? 0 : out.carry,
      confirmed: out.carried.rows, run: out.run ? out.run.status : "not asked",
    });
    console.log("  ff: " + (s ? s.names + " name(s), " + s.carded + " carded, " + s.bytes + " bytes" : "no metrics") +
      ", carry " + (out.carry === null ? "not written" : out.carry + " window(s)") +
      ", confirmed against " + out.carried.rows + " carried window(s)" + (out.carried.reason ? " (" + out.carried.reason + ")" : "") +
      (out.run ? ", run request HTTP " + out.run.status : ""));
    if (out.run && !out.run.ok) console.warn("  ff: the run request was not accepted (" + out.run.status + " " + out.run.body + "), the half-hourly check retries it");
    if (out.failures.length) throw new Error(out.failures.join("; "));
    return out;
  }, (error) => {
    console.warn("  ff: " + error.message + " — the Worker evaluates what it holds");
  });
  Object.assign(ctx, { ff: result || null });
}
