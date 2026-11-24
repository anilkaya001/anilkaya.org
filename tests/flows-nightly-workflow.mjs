import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

const workflow = readFileSync(new URL("../scripts/flows-container/worker.js", import.meta.url), "utf8");
const harness = `
import { NightlyFixture, NightlyWorkflow } from "./workflow.js";
export { NightlyWorkflow };
export class TestRunner extends NightlyFixture {
  constructor(ctx, env) {
    super(ctx, env);
    let running = false;
    let exit;
    const container = {
      get running() { return running; },
      start(options) {
        if (running) throw new Error("double start");
        running = true;
        exit = new Promise((resolve, reject) => setTimeout(() => {
          running = false;
          if (env.EXIT === "failure") reject(Object.assign(new Error("test exit"), { exitCode: 19 }));
          else resolve();
        }, 5));
        ctx.waitUntil(env.AUDIT.fetch("https://trace/start", { method: "POST", body: JSON.stringify(options) }));
      },
      monitor() { return exit; },
    };
    Object.defineProperty(ctx, "container", { value: container });
  }
}
export default { async fetch(request, env) {
  const { id, profile, session, operation } = await request.json();
  const runner = env.NIGHTLY_FIXTURE.getByName(id);
  if (operation === "begin") return Response.json(await runner.begin(profile, session));
  if (operation === "poll") return Response.json(await runner.poll());
  if (operation === "status") return Response.json(await (await env.NIGHTLY.get(id)).status());
  await env.NIGHTLY.create({ id, params: { profile, session } });
  return Response.json({ started:true });
} };`;

async function world(vars, verify) {
  const starts = [];
  const mf = new Miniflare({
    name: "test-nightly", compatibilityDate: "2026-07-08", modulesRoot: "/nightly",
    modules: [{ type: "ESModule", path: "/nightly/index.js", contents: harness },
      { type: "ESModule", path: "/nightly/workflow.js", contents: workflow }],
    durableObjects: { NIGHTLY_FIXTURE: { className: "TestRunner", useSQLite: true } },
    workflows: { NIGHTLY: { name: "test-nightly", className: "NightlyWorkflow" } },
    bindings: vars, serviceBindings: { AUDIT: async (req) => { starts.push(await req.json()); return new Response(); } },
  });
  const call = async (args) => {
    const res = await mf.dispatchFetch("http://test/", { method: "POST", body: JSON.stringify(args) });
    assert.equal(res.status, 200, await res.clone().text());
    return res.json();
  };
  try { await verify(call, starts); } finally { await mf.dispose(); }
}

const fixture = { profile: "fixture", session: "2026-08-24", id: "nightly-fixture-2026-08-24" };
const staging = { profile: "staging", session: "2026-11-23", id: "nightly-staging-2026-11-23" };
async function terminal(read, what) {
  const deadline = Date.now() + 90_000;
  do {
    const report = await read();
    if (["complete", "errored", "passed", "failed"].includes(report?.status)) return report;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(what + " did not finish");
}

await world({}, async (call, starts) => {
  await call(fixture);
  const completed = await terminal(() => call({ ...fixture, operation: "status" }), "fixture workflow");
  assert.equal(completed.status, "complete", JSON.stringify(completed));
  assert.equal(completed.output.status, "passed");
  assert.equal(completed.output.id, fixture.id);
  const duplicate = await call({ ...fixture, operation: "begin" });
  assert.deepEqual(duplicate, completed.output);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].enableInternet, false);
  assert.equal(starts[0].env, undefined);
  assert.match(starts[0].entrypoint.join(" "), /timeout .*9m .*verify\.mjs$/);
  for (const input of [staging, { ...fixture, id: "incorrect-id" }, { ...staging, session: "2026-02-30", id: "bad-date" }]) {
    await call(input);
    const refused = await terminal(() => call({ ...input, operation: "status" }), input.id);
    assert.equal(refused.status, "errored");
  }
  assert.equal(starts.length, 1, "invalid requests and disabled staging did not start a container");
});

await world({ NIGHTLY_STAGING_ENABLED: "on", NIGHTLY_STAGING_UW_KEY: "test-feed", NIGHTLY_STAGING_INGEST_TOKEN: "test-ingest", EXIT: "failure" },
  async (call, starts) => {
    await call(staging);
    const result = await terminal(() => call({ ...staging, operation: "status" }), "failed staged workflow");
    assert.equal(result.status, "errored");
    const receipt = await call({ ...staging, operation: "poll" });
    assert.equal(receipt.exitCode, 19);
    assert.equal(receipt.status, "failed");
    assert.deepEqual(await call({ ...staging, operation: "begin" }), receipt);
    assert.equal(starts.length, 1, "an errored session is not silently relaunched");
    const opts = starts[0];
    assert.equal(opts.env.FLOWS_EXPECTED_SESSION, staging.session);
    assert.equal(opts.env.FLOWS_INGEST_URL, "https://anilkaya-staging.tqwh48fck7.workers.dev/api/flows/ingest");
    assert.equal(opts.env.UW_API_KEY, "test-feed");
    assert.equal(opts.env.FLOWS_INGEST_TOKEN, "test-ingest");
    assert.equal(opts.env.GITHUB_TOKEN, undefined);
    assert.equal(opts.enableInternet, true);
    assert.match(opts.entrypoint.join(" "), /timeout .*199m .*flows-pipeline\.mjs$/);
  });
console.log("nightly-workflow: local Workflows, SQLite receipts, runner fencing, approved staging arguments and exits verified");
