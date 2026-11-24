import { DurableObject, WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

const STAGING_INGEST = "https://anilkaya-staging.tqwh48fck7.workers.dev/api/flows/ingest";
const FIXTURE_SESSION = "2026-08-24";
const MINUTE = 60_000;
const RPC_STEP = { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "30 seconds" };

function runSpec(profile, session) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(session) ? Date.parse(session + "T00:00:00Z") : NaN;
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== session) return null;
  if (profile === "fixture" && session !== FIXTURE_SESSION) return null;
  if (profile !== "staging" && profile !== "fixture") return null;
  return { profile, session, id: "nightly-" + profile + "-" + session, minutes: profile === "fixture" ? 10 : 200 };
}

function launchOptions(spec, env) {
  const timeout = ["/usr/bin/timeout", "--kill-after=30s", (spec.minutes - 1) + "m", "/usr/local/bin/node"];
  if (spec.profile === "fixture") {
    return { enableInternet: false, entrypoint: [...timeout, "/app/scripts/flows-container/verify.mjs"] };
  }
  if (env.NIGHTLY_STAGING_ENABLED !== "on" || !env.NIGHTLY_STAGING_UW_KEY || !env.NIGHTLY_STAGING_INGEST_TOKEN) return null;
  return {
    enableInternet: true,
    entrypoint: [...timeout, "/app/scripts/flows-pipeline.mjs"],
    env: {
      UW_API_KEY: env.NIGHTLY_STAGING_UW_KEY, FLOWS_INGEST_TOKEN: env.NIGHTLY_STAGING_INGEST_TOKEN,
      FLOWS_INGEST_URL: STAGING_INGEST, FLOWS_EXPECTED_SESSION: spec.session,
      FLOWS_FLOWLAB_ANALYTICS: "on", FLOWS_EVENTRISK_NIGHTLY: "on",
      ...(env.NIGHTLY_STAGING_UW_PLAN ? { FLOWS_UW_PLAN: env.NIGHTLY_STAGING_UW_PLAN } : {}),
    },
  };
}

export class NightlyFixture extends DurableObject {
  observing = false;

  observe() {
    if (this.observing) return;
    this.observing = true;
    this.ctx.waitUntil(this.ctx.container.monitor().then(
      () => this.finish("passed"),
      (error) => this.finish("failed", Number.isInteger(error?.exitCode) ? error.exitCode : null),
    ).finally(() => { this.observing = false; }));
  }

  async finish(status, exitCode = null) {
    return this.ctx.storage.transaction(async (tx) => {
      const saved = await tx.get("run");
      if (saved?.status !== "running") return saved;
      const receipt = { ...saved, status, exitCode, finishedAt: Date.now() };
      await tx.put("run", receipt);
      return receipt;
    });
  }

  async begin(profile, session) {
    const spec = runSpec(profile, session);
    if (!spec || this.ctx.id.name !== spec.id) throw new Error("Nightly instance identity mismatch");
    return this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get("run");
      if (saved) return saved;
      const opts = launchOptions(spec, this.env);
      if (!opts) return { status: "disabled", id: spec.id, session, profile };
      const now = Date.now();
      const receipt = { id: spec.id, profile, session, status: "running", startedAt: now, expiresAt: now + spec.minutes * MINUTE };
      await this.ctx.storage.put("run", receipt);
      try {
        this.ctx.container.start(opts);
        this.observe();
        return receipt;
      } catch {
        return this.finish("failed");
      }
    });
  }

  async poll() {
    const saved = await this.ctx.storage.get("run");
    if (!saved || saved.status !== "running") return saved;
    if (Date.now() >= saved.expiresAt) {
      const timedOut = await this.finish("timed-out");
      if (this.ctx.container.running) await this.ctx.container.destroy("Nightly deadline exceeded");
      return timedOut;
    }
    if (this.ctx.container.running) this.observe();
    else if (!this.observing) return this.finish("unconfirmed");
    return saved;
  }
}

export class NightlyWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const input = event.payload;
    const spec = input && typeof input === "object" && Object.keys(input).length === 2 && runSpec(input.profile, input.session);
    if (!spec || event.instanceId !== spec.id) throw new NonRetryableError("Expected a nightly profile, session and matching instance ID");
    const runner = () => this.env.NIGHTLY_FIXTURE.getByName(spec.id);
    let receipt = await step.do("start nightly", RPC_STEP, () => runner().begin(spec.profile, spec.session));
    for (let attempt = 1; receipt?.status === "running" && attempt <= spec.minutes + 1; attempt++) {
      await step.sleep("wait " + attempt, attempt === 1 ? "2 seconds" : "1 minute");
      receipt = await step.do("check nightly " + attempt, RPC_STEP, () => runner().poll());
    }
    if (receipt?.status !== "passed") throw new NonRetryableError("Nightly " + (receipt?.status || "missing receipt"));
    return receipt;
  }
}

export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
};
