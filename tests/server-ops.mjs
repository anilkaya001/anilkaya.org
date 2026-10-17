import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as K from "../server/http.js";
import { createRouter } from "../server/router.js";
import { flowsOpsRows } from "../server/routes/flows-ops.js";
import { opsBody, opsStatements, readOps, liveView, limitsOf, switchesOf, coverageView, COVERAGE_KEYS, OPS_SWITCHES, OPS_LEDGER_DAYS } from "../server/ops.js";
import { LIVE_KEYS } from "../shared/flows-live.js";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { workerSource, expect, moduleSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const thrown = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };
const view = (e) => (e ? { status: e.status, code: e.code } : null);

const NOW = Date.parse("2026-10-12T15:00:00Z");
const DAY = "2026-10-12";
const T = (iso) => Date.parse(iso);
const req = (method, path) => new Request("https://anilkaya.org" + path, { method });

function seed(f) {
  const ledger = f.db.prepare("INSERT INTO flows_ledger (day, ticks, t1_last_at, t1_ok, t1_fail, t1_ok_at, t1_gap_ms, t1_ok_gap_ms, t2_passes, t2_calls, t2_failed, focus_ok, stale_ticks, stale_over_s, stale_key, nightly_at, nightly_runs, updated_at) " +
    "VALUES (?, 3, ?, 40, 2, ?, 420000, 600000, 30, 900, 4, 36, 1, 120, 'live:breadth', ?, 1, ?)");
  for (let i = 0; i < 30; i++) {
    const d = new Date(T(DAY + "T12:00:00Z") - i * 86400000).toISOString().slice(0, 10);
    ledger.run(d, T(d + "T14:50:00Z"), T(d + "T14:50:00Z"), T(d + "T21:30:00Z"), T(d + "T14:55:00Z"));
  }
  f.db.prepare("INSERT INTO flows_clock (id, day, trading, tier1_at, tier1_ok_at, tier1_why, dispatch_why, summary_at, updated_at) VALUES (1, ?, 1, ?, ?, 'written', 'refused:403', ?, ?)")
    .run(DAY, NOW - 60000, NOW - 60000, NOW - 120000, NOW);
  const ids = Object.keys(LIVE_KEYS);
  ids.forEach((id, i) => {
    const readAt = NOW - (i + 1) * 20000;
    const vendorAt = i === 3 ? null : new Date(readAt - 4000).toISOString();
    f.live(id, { v: 1, key: id, fresh: { v: 1, readAt: new Date(readAt).toISOString(), vendorAt, source: "worker", cadenceS: LIVE_KEYS[id].cadenceS } },
      readAt, DAY, { cadenceS: LIVE_KEYS[id].cadenceS, source: LIVE_KEYS[id].writer === "actions" ? "actions" : "worker", writer: LIVE_KEYS[id].writer === "actions" ? "actions@live" : "worker@tier1" });
  });
  f.db.prepare("INSERT INTO flows_ai_usage (day, calls, tokens_in, tokens_out) VALUES (?, 41, 52000, 9000)").run(DAY);
  f.db.prepare("INSERT INTO flows_ai_usage_model (day, model, calls, tokens_in, tokens_out) VALUES (?, 'm-one', 41, 52000, 9000)").run(DAY);
  const outcome = f.db.prepare("INSERT INTO flows_ai_outcome (day, surface, model, outcome, reason, n, ms_sum, ms_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const s of ["board", "neuron", "ask", "read"]) {
    outcome.run(DAY, s, "m-one", "clean", "", 10, 12000, 2400);
    outcome.run(DAY, s, "m-one", "refused", "modal", 2, 3000, 2500);
  }
  const ring = f.db.prepare("INSERT INTO flows_ai_reject (surface, slot, at, model, reason, culprit) VALUES (?, ?, ?, 'm-one', 'refused:modal', 'will')");
  for (const s of ["board", "neuron", "ask", "read"]) for (let slot = 0; slot < 50; slot++) ring.run(s, slot, NOW - slot * 1000);
}

const OWNER_ENV = { FLOWS_OPS: "on", FLOWS_RT_USERS: "owner.one", FLOWS_AI_DAILY_CAP_NEURONS: "30000", FLOWS_AI_DAILY_CAP_CALLS: "2500" };
const isOwner = (env, username) => username === "owner.one";

function build(f, over = {}) {
  const log = [];
  const deps = {
    ensureFlowsTables: async () => { log.push("ensure"); },
    isOwner, now: () => NOW, meter: () => null, ...over,
  };
  const table = createRouter(flowsOpsRows(deps));
  const rc = (path, env, username, method = "GET") => ({ request: req(method, path), env: { DB: f.D1, ...OWNER_ENV, ...env }, url: new URL("https://anilkaya.org" + path), ctx: {}, session: username ? { username } : null });
  return { table, rc, log };
}

{
  const f = fakeD1();
  seed(f);
  const { table, rc, log } = build(f);
  eq(table.rows.map((r) => [r.id, r.path, r.methods, r.auth]), [["flows.ops", "/api/flows/ops", ["GET"], "flows"]], "the ops family is one GET row behind the Flows session");

  const trips0 = f.trips.length;
  const body = await (await table.find("/api/flows/ops").handler(rc("/api/flows/ops", {}, "owner.one"))).json();
  eq(f.trips.length - trips0, 1, "ONE TRIP: the default read is a single batch");
  eq(log, ["ensure"], "after the schema is ensured");
  const rows = f.rowsRead(trips0);
  ok(rows <= 24, `THE DEFAULT READ COSTS ${rows} ROWS, at most 24: seven ledger days, the clock, the eleven live keys, the model day and its models`);
  eq(f.written(trips0), 0, "and writes nothing");
  eq(body.v, 1, "version 1");
  eq(body.owner, true, "owner");
  eq(body.now, NOW, "now is the instant of the read");
  eq(body.ledger.days.length, OPS_LEDGER_DAYS, "the ledger holds the last seven days of thirty seeded");
  eq(body.ledger.days[0].day, DAY, "newest day first");
  eq(body.ledger.days[6].day, "2026-10-06", "and the seventh day back last");
  eq(body.clock.tier1.why, "written", "the clock carries Tier 1's last verdict");
  eq(body.clock.dispatchWhy, "refused:403", "and the GitHub dispatch refusal the Status page never showed");
  eq(body.clock.vendor, null, "no vendor reading is on the clock row, so it is null and not zero");
  eq(body.vendor.reading, null, "the vendor reading is null");
  eq(body.live.length, Object.keys(LIVE_KEYS).length, "one entry for each live key");
  const market = body.live.find((l) => l.key === "live:market");
  ok(market.present && market.writer === "worker@tier1" && market.ageS === 20 && market.behindS === 4, "a live key carries its writer, its age and how far behind the vendor's stamp it was read: " + JSON.stringify(market));
  const unstamped = body.live[3];
  eq(unstamped.vendorAt, null, "a key with no vendor stamp has a null vendorAt");
  eq(unstamped.behindS, null, "and no distance behind it, not zero");
  ok(["live", "fresh", "stale", "closed"].includes(market.state) && market.liveS > 0 && market.staleS > market.liveS, "state and the live and stale lines come from the freshness table");
  eq(body.ai.spend.calls, 41, "the model day's calls");
  eq(body.ai.spend.tokensIn, 52000, "and tokens");
  eq(body.ai.cap, { neurons: 30000, calls: 2500, readShare: 0.75, readsStopAt: 22500, allowanceNeurons: 10000 }, "THE ENFORCED CAP, not the free allowance: 30,000 neurons, 2,500 calls, readings stop at 22,500");
  eq(body.ai.block, null, "the outcome block is not mounted without part=ai");
  ok(Object.keys(body.lines).length >= 10, "plan lines: " + Object.keys(body.lines).length);
  for (const id of ["uw.day", "uw.min", "d1.read", "d1.write", "do.req", "do.gbs", "ai.neurons", "ai.usd", "ai.calls", "cf.req"]) ok(body.lines[id], "line " + id);
  eq(body.plan.workers, "paid", "the Workers plan defaults to paid");
  ok(body.plan.renewal && typeof body.plan.renewal.through === "string", "the plan carries its renewal state");
  ok(Array.isArray(body.limits) && body.limits.some((l) => l.name === "UW_ONDEMAND" && l.limit === 120), "the enforced limits are listed");
  eq(Object.keys(body.switches), [...OPS_SWITCHES], "the switches are the allowlist, in order");
  eq(body.switches.FLOWS_OPS, "on", "a set switch carries its value");
  eq(body.switches.FLOWS_HOME_NET, null, "an unset switch is null");
  ok(!("why" in body), "a good read carries no why");

  const ai = await (await table.find("/api/flows/ops").handler(rc("/api/flows/ops?part=ai", {}, "owner.one"))).json();
  const aiTrip = f.trips[f.trips.length - 1];
  eq(aiTrip.sqls.length, 7, "part=ai appends the two outcome statements to the same batch");
  eq(f.trips.length - trips0, 2, "still one trip a read");
  const rowsAi = f.rowsRead(f.trips.length - 1);
  ok(rowsAi <= 280, `part=ai costs ${rowsAi} rows, at most 280 with the ring full`);
  eq(Object.keys(ai.ai.block.surfaces), ["ask", "board", "neuron", "read"], "four surfaces");
  eq(ai.ai.block.surfaces.ask.calls, 12, "counted per surface");
  eq(ai.ai.block.surfaces.ask.msAvg, 1250, "mean model time per reached call");
  eq(ai.ai.block.recent.length, 50, "the fifty latest refusals");
  eq(ai.ai.block.recent[0].culprit, "will", "with the culprit token as text");

  const other = await (await table.find("/api/flows/ops").handler(rc("/api/flows/ops?part=everything", {}, "owner.one"))).json();
  eq(other.ai.block, null, "any part but ai mounts nothing");
}

{
  const f = fakeD1();
  seed(f);
  const { table, rc } = build(f);
  const ops = table.find("/api/flows/ops");
  for (const off of [undefined, "", "off", "yes", "1"]) {
    const e = await thrown(() => ops.handler(rc("/api/flows/ops", { FLOWS_OPS: off }, "owner.one")));
    eq(view(e), { status: 404, code: "ops_off" }, "FLOWS_OPS " + JSON.stringify(off) + " fails closed with ops_off");
  }
  eq((await ops.handler(rc("/api/flows/ops", { FLOWS_OPS: " ON " }, "owner.one"))).status, 200, "the switch tolerates case and spaces");
  const member = await thrown(() => ops.handler(rc("/api/flows/ops", {}, "member.alpha")));
  eq(view(member), { status: 403, code: "forbidden" }, "a member who is not an owner is 403");
  const memberOff = await thrown(() => ops.handler(rc("/api/flows/ops", { FLOWS_OPS: "off" }, "member.alpha")));
  eq(view(memberOff).code, "ops_off", "the switch is read before the owner check");
  const gates = { flows: async (r) => (r.headers.get("x-member") ? { username: r.headers.get("x-member") } : null) };
  const env = { DB: f.D1, ...OWNER_ENV };
  const at = (method, headers = {}) => table.handle({ request: new Request("https://anilkaya.org/api/flows/ops", { method, headers }), env, url: new URL("https://anilkaya.org/api/flows/ops"), ctx: {} }, gates);
  eq(view(await thrown(() => at("GET"))).code, "unauthorized", "an anonymous caller is 401");
  const post = await thrown(() => at("POST"));
  eq(view(post).code, "method_not_allowed", "a POST is the 405 before the session");
  eq(post.headers.Allow, "GET", "with Allow: GET");
  eq((await at("GET", { "x-member": "owner.one" })).status, 200, "an owner is 200 through the table");
  eq(view(await thrown(() => at("GET", { "x-member": "member.alpha" }))).code, "forbidden", "a member through the table is 403");
}

{
  const f = fakeD1();
  seed(f);
  f.fail(/FROM flows_live/);
  const { table, rc } = build(f);
  const res = await table.find("/api/flows/ops").handler(rc("/api/flows/ops", {}, "owner.one"));
  const body = await res.json();
  eq(res.status, 200, "A REFUSED BATCH is still a 200");
  eq([body.why, body.ledger, body.clock, body.live, body.vendor, body.ai.spend, body.ai.block], ["store", null, null, null, null, null, null], "every stored part is null with why store");
  eq(body.ai.cap.neurons, 30000, "the cap, a constant, is still told");
  ok(body.lines && body.limits && body.switches && body.plan, "and so are the plan lines, the limits, the switches and the plan");
  const none = await readOps({}, { ensureFlowsTables: async () => {}, now: () => NOW }, {});
  eq(none.why, "store", "no database is the same answer");
}

{
  const f = fakeD1();
  seed(f);
  f.db.prepare("UPDATE flows_live SET payload = 'not json' WHERE id = 'live:vol'").run();
  const { table, rc } = build(f);
  const body = await (await table.find("/api/flows/ops").handler(rc("/api/flows/ops", {}, "owner.one"))).json();
  const vol = body.live.find((l) => l.key === "live:vol");
  ok(vol.present && vol.vendorAt === null, "A PAYLOAD THAT IS NOT JSON costs its key a vendor stamp, not the whole read");
  f.db.prepare("DELETE FROM flows_live WHERE id = 'live:news'").run();
  const gone = (await (await table.find("/api/flows/ops").handler(rc("/api/flows/ops", {}, "owner.one"))).json()).live.find((l) => l.key === "live:news");
  eq(gone, { key: "live:news", present: false }, "a key with no row is absent and says nothing else");
}

{
  const f = fakeD1();
  seed(f);
  const { table, rc } = build(f);
  const run = async (env) => (await (await table.find("/api/flows/ops").handler(rc("/api/flows/ops", env, "owner.one"))).json());
  const base = await run({});
  const startup = await run({ FLOWS_UW_PLAN: "startup", FLOWS_PLAN_WORKERS: "free" });
  eq([base.plan.uw, base.plan.workers], ["unknown", "paid"], "the plan defaults");
  eq([startup.plan.uw, startup.plan.workers], ["startup", "free"], "THE LINES FOLLOW THE PLAN VARIABLES through lines(env)");
  ok(base.lines["uw.day"].cap !== startup.lines["uw.day"].cap || base.lines["d1.write"].cap !== startup.lines["d1.write"].cap, "and the caps move with them");
  const capped = await run({ FLOWS_AI_DAILY_CAP_NEURONS: "12000", FLOWS_AI_DAILY_CAP_CALLS: "900" });
  eq([capped.ai.cap.neurons, capped.ai.cap.calls, capped.ai.cap.readsStopAt], [12000, 900, 9000], "the AI cap follows the Worker's variables");
  eq(limitsOf({ FLOWS_AI_DAILY_CAP_NEURONS: "12000" }).find((l) => l.name === "Workers AI neurons").limit, 12000, "and so does the limits table");
}

{
  const secret = { UW_API_KEY: "k".repeat(32), SESSION_SECRET: "s".repeat(32), FLOWS_INGEST_TOKEN: "t".repeat(32), FLOWS_CREDENTIALS: "{}" };
  const out = switchesOf({ ...secret, FLOWS_RT_MODE: "on" });
  eq(Object.keys(out), [...OPS_SWITCHES], "only the allowlist is read");
  ok(!JSON.stringify(out).includes("kkkk") && !JSON.stringify(out).includes("ssss"), "and no secret value can reach it");
  ok(OPS_SWITCHES.every((n) => !/KEY|TOKEN|SECRET|CREDENTIAL/.test(n)), "NO SWITCH NAME IS SECRET-SHAPED");
  eq(switchesOf({ FLOWS_RT_MODE: "x".repeat(100) }).FLOWS_RT_MODE.length, 32, "a long value is cut");
}

{
  const clock = { day: DAY, trading: 1, tier1At: NOW, tier1OkAt: NOW, tier1Why: "written" };
  const rows = [{ id: "live:market", read_at: NOW - 30000, session: DAY, cadence_s: 300, source: "worker", writer: "w", updated_at: NOW, vendor_at: new Date(NOW - 36000).toISOString() }];
  const v = liveView(rows, NOW, clock)[0];
  eq([v.ageS, v.behindS], [30, 6], "age and distance behind the vendor are whole seconds");
  const stale = liveView([{ ...rows[0], read_at: NOW - 4000 * 1000 }], NOW, clock)[0];
  eq(stale.state, "stale", "an old read in the session is stale");
  const results = [{ results: [] }, { results: [] }, { results: [] }, { results: [] }, { results: [] }];
  const body = opsBody({ FLOWS_OPS: "on" }, NOW, results, {});
  eq([body.ledger.days, body.clock, body.ai.spend.calls], [[], null, 0], "an empty store is an empty ledger, no clock and a true 0 calls");
  eq(body.vendor.own, null, "with no ledger day there is no own count");
  const held = opsBody({}, NOW, results, { meter: { daily: 1234, at: NOW - 1000 } });
  eq(held.vendor.reading, { daily: 1234, at: NOW - 1000 }, "the Worker's own reading stands when the clock has none");
  const clockRow = { id: 1, day: DAY, trading: 1, uw_daily: 900, uw_daily_at: NOW - 5000 };
  const both = opsBody({}, NOW, [{ results: [] }, { results: [clockRow] }, { results: [] }, { results: [] }, { results: [] }], { meter: { daily: 950, at: NOW - 1000 } });
  eq(both.vendor.reading.daily, 950, "the newer of the clock's reading and the Worker's wins");
}

{
  const f = fakeD1();
  seed(f);
  const put = f.db.prepare("INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?)");
  put.run("universe", JSON.stringify({ sessionDate: DAY, pad: "x".repeat(51200) }), NOW - 3600000);
  put.run("meta", JSON.stringify({ sessionDate: DAY, generatedAt: "2026-10-12T01:00:00Z" }), NOW - 7200000);
  put.run("board:long", "not json", NOW - 1000);
  put.run("card:AAPL", JSON.stringify({ sessionDate: DAY }), NOW);
  const { table, rc } = build(f);
  const trips0 = f.trips.length;
  const body = await (await table.find("/api/flows/ops").handler(rc("/api/flows/ops?part=coverage", {}, "owner.one"))).json();
  eq(f.trips.length - trips0, 1, "COVERAGE IS ONE TRIP, in the same batch as the rest");
  const rows = f.rowsRead(trips0);
  ok(rows <= 24 + COVERAGE_KEYS.length, `part=coverage costs ${rows} rows, the default 24 plus at most one per key (${COVERAGE_KEYS.length})`);
  eq(body.coverage.budgetBytes, 102400, "the budget is the universe payload's 100 KiB");
  eq(body.coverage.keys.map((k) => k.key), [...COVERAGE_KEYS], "every expected key is listed, in the declared order");
  const uni = body.coverage.keys.find((k) => k.key === "universe");
  ok(uni.present && uni.bytes > 51200 && Math.abs(uni.share - uni.bytes / 102400) < 1e-9, "a present key carries its bytes and its share of the budget");
  eq([uni.session, uni.updatedAt], [DAY, NOW - 3600000], "with its session date and write time");
  const bad = body.coverage.keys.find((k) => k.key === "board:long");
  eq([bad.present, bad.session], [true, null], "a payload that is not JSON is present with no session and no throw");
  eq(body.coverage.keys.find((k) => k.key === "regime"), { key: "regime", present: false }, "a key never written is absent, not zero bytes");
  ok(!body.coverage.keys.some((k) => k.key === "card:AAPL"), "a card key is never listed: no scan of the card rows");
  const none = await (await table.find("/api/flows/ops").handler(rc("/api/flows/ops", {}, "owner.one"))).json();
  eq(none.coverage, null, "without the part there is no coverage");
  const sqls = opsStatements({ DB: { prepare: (sql) => ({ sql, bind() { return this; } }) } }, NOW, { part: "coverage" }).map((q) => q.sql);
  const cov = sqls[sqls.length - 1];
  ok(/FROM flows_payload WHERE id IN \(/.test(cov) && !/json_each|LIKE|LIMIT|ORDER/i.test(cov), "the coverage read is a primary-key lookup of a fixed list");
  eq(coverageView(null), null, "an unreadable result is null");
}

{
  const sqls = opsStatements({ DB: { prepare: (sql) => ({ sql, bind() { return this; } }) } }, NOW, { part: "ai" }).map((s) => s.sql);
  ok(!sqls.some((s) => /json_each/i.test(s)), "NO json_each ON A POLLED ROUTE");
  ok(sqls.every((s) => /^SELECT/.test(s)), "every statement is a read");
  ok(sqls.filter((s) => /flows_live/.test(s)).every((s) => /json_extract/.test(s) && /id IN/.test(s)), "the live read is a primary-key lookup with json_extract");
  ok(!sqls.some((s) => /FROM flows_payload/.test(s)), "and no payload table is read");
}

{
  const w = workerSource();
  expect(w, /flowsOpsRows\(\{/, { min: 1, max: 1, why: "the Worker mounts the ops family once" });
  for (const f of ["server/ops.js", "server/routes/flows-ops.js"]) {
    const t = moduleSource(f);
    ok(!/FLOWS_UW_PLAN|FLOWS_PLAN_WORKERS|FLOWS_PLAN_PAID_THROUGH/.test(t), f + " reads no plan variable itself: only lines(env), planOf(env) and renewalState do");
    ok(!/^(let|var) /m.test(t) && !/^(const|export const) [A-Za-z_0-9]+ = new (Map|WeakMap|WeakSet|Set|Array)\(/m.test(t), f + " declares no top-level mutable state");
    ok(!/\/\/|\/\*/.test(t.replace(/https?:\/\/[^\s"'`]+/g, "")), f + " carries no comments");
    ok(!/\bAI\b\s*[.\[]|env\.AI\b/.test(t), f + " never touches the model binding");
  }
  ok(K.HttpError.of("ops_off").status === 404, "ops_off is registered");
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  for (const r of ["UW_ONDEMAND", "MEMBER_VENDOR", "AI_ASK", "LAB_WRITE"]) {
    const m = new RegExp('name = "' + r + '"\\s+namespace_id = "\\d+"\\s+simple = \\{ limit = (\\d+), period = (\\d+) \\}').exec(toml);
    const mine = limitsOf({}).find((l) => l.name === r);
    ok(m && mine && Number(m[1]) === mine.limit && Number(m[2]) === mine.periodS, r + " in the limits table equals wrangler.toml");
  }
  ok(/FLOWS_OPS = "on"/.test(toml), "wrangler.toml ships the switch on");
  ok(Object.keys(LIVE_KEYS).length === 11, "eleven live keys, so the live read is at most eleven rows");
}

console.log(`server-ops: ${checks} checks`);
