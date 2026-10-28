import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lines, UW_PLANS, RESOURCE_IDS } from "../shared/flows-plan-facts.js";
import { RT_LIMITS } from "../shared/flows-rt.js";
import { hubConfig } from "../shared/flows-rt-hub.js";
import { aiCapNeurons, aiCapCalls } from "../shared/flows-ai.js";
import { LIVE_BUDGET, LIVE_KEYS } from "../shared/flows-live.js";
import { FRESH_CLASSES } from "../shared/flows-freshness.js";
import { LIVE_LOOP } from "../scripts/flows-legs/live.mjs";
import { PREMARKET_NEWS } from "../shared/flows-live-worker.js";
import { BUDGETS } from "../shared/flows-vendor-ops.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const toml = read("wrangler.toml");

const limiterOf = (name) => {
  const block = toml.split("[[ratelimits]]").find((b) => new RegExp(`name = "${name}"`).test(b));
  const m = block && /limit = (\d+), period = (\d+)/.exec(block);
  return m ? { limit: Number(m[1]), periodS: Number(m[2]) } : null;
};

const perMinute = (l) => (l.limit * 60) / l.periodS;

export const LIMITER_SCOPE = Object.freeze({ onDemand: "per-location", member: "per-location" });

export function vendorMinuteCeilings(env = {}, { locations = 1 } = {}) {
  const onDemand = limiterOf("UW_ONDEMAND");
  const member = limiterOf("MEMBER_VENDOR");
  return {
    rail: hubConfig(env).callsPerMinute,
    onDemand: perMinute(onDemand) * locations,
    member: perMinute(member) * locations,
    tier2: Math.floor(60000 / LIVE_BUDGET.tier2PaceMs),
    tier1: LIVE_BUDGET.tier1Calls + LIVE_BUDGET.fundsCalls + 1,
  };
}

export function vendorMinuteSum(env = {}, opts = {}) {
  const c = vendorMinuteCeilings(env, opts);
  return c.rail + c.onDemand + c.member + c.tier2 + c.tier1;
}

export function budgetPlanSum(env = {}, opts = {}) {
  const c = vendorMinuteCeilings(env, opts);
  return c.rail + c.onDemand + c.tier2 + c.tier1;
}

export function budgetBreaches(env = {}, opts = {}) {
  const l = lines(env);
  const out = [];
  const minute = l["uw.min"].cap;
  if (minute !== null && vendorMinuteSum(env, opts) > minute) out.push("uw.min");
  return out;
}

export function downgradeBreaches(env = {}) {
  const free = lines({ ...env, FLOWS_PLAN_WORKERS: "free" });
  const out = [];
  if (free["ai.neurons"].cap !== null && aiCapNeurons(env) > free["ai.neurons"].cap) out.push("ai.neurons");
  if (free["ai.calls"].cap !== null && aiCapCalls(env) > free["ai.calls"].cap) out.push("ai.calls");
  return out;
}

{
  const onDemand = limiterOf("UW_ONDEMAND");
  const member = limiterOf("MEMBER_VENDOR");
  same(onDemand, { limit: 120, periodS: 60 }, "wrangler.toml declares the on-demand feed limiter at 120 a minute");
  same(member, { limit: 60, periodS: 60 }, "and the member feed limiter at 60 a minute");
  same(LIMITER_SCOPE, { onDemand: "per-location", member: "per-location" }, "both limiters count per Cloudflare location, so 120 and 60 are per-location ceilings and not global ones");
  const c = vendorMinuteCeilings();
  eq(c.rail, RT_LIMITS.callsPerMinute, "the rail's default ceiling is the hub's own default, read through hubConfig");
  eq(c.tier2, 180, "the Tier 2 pass is paced at LIVE_BUDGET.tier2PaceMs (333 ms), 180 calls a minute");
  eq(c.tier1, 4, "and the cron engines are Tier 1's two market calls, the focus tick's one and the funds tick's one, summed as if they shared a minute although their firings never do");
  eq(budgetPlanSum(), 240 + 120 + 180 + 4, "THE AS-BUILT REGULAR-SESSION CEILINGS OF THE PLAN'S LEDGER (rail, on-demand, Tier 2, Tier 1 and focus) SUM TO 544");
  eq(vendorMinuteSum(), 240 + 120 + 60 + 180 + 4, "and with the member limiter every enforced ceiling sums to 604, counting each limiter once");
}

{
  const c = vendorMinuteCeilings();
  const premarket = c.rail + c.onDemand + c.member + PREMARKET_NEWS.callsPerFiring;
  ok(premarket <= vendorMinuteSum(), "THE PRE-MARKET NEWS PASS ADDS ONE CALL A FIRING TO A WINDOW WHERE TIER 1 AND TIER 2 ARE OFF, SO IT STAYS UNDER THE REGULAR-SESSION SUM");
  eq(PREMARKET_NEWS.callsPerFiring * PREMARKET_NEWS.maxFiringsPerDay, 11, "and costs at most 11 feed calls a trading day");
  eq(BUDGETS.premarketNews.perMinute, 1, "BUDGETS states one call in any minute");
  eq(Math.floor((9 * 60 + 30 - 4 * 60 - 1) / PREMARKET_NEWS.everyMin) + 1, PREMARKET_NEWS.maxFiringsPerDay, "the window 04:00-09:30 ET holds 11 half-hour firings");
}

{
  const strictest = lines({});
  eq(strictest["uw.min"].plan, "unknown", "with no plan recorded the line is the unread plan's");
  eq(strictest["uw.min"].cap, 500, "which is Startup's 500 a minute");
  ok(budgetPlanSum() > strictest["uw.min"].cap, `EXPECTED BREACH: the plan ledger's 544 is over the strictest feed minute line (${strictest["uw.min"].cap}) and P1-31 is the row that clears it`);
  ok(vendorMinuteSum() > strictest["uw.min"].cap, `and the full sum (${vendorMinuteSum()}) is over it too`);
  same(budgetBreaches(), ["uw.min"], "so the as-built tree reports one breach today, the feed minute line");
  eq(vendorMinuteSum() - strictest["uw.min"].cap, 104, "104 calls a minute over the line, none of it headroom: the Tier 1 fund read added one to the 103 before it");
}

{
  const plans = UW_PLANS.map((plan) => ({ plan, line: lines({ FLOWS_UW_PLAN: plan })["uw.min"] }));
  for (const { plan, line } of plans) {
    eq(line.plan, plan, `${plan}: the line reports the plan it was read for`);
    ok(line.cap !== null, `${plan}: every feed plan resolves to a minute line, so no plan reads as unlimited`);
    if (line.planCap === null) {
      eq(plan, "advanced", `${plan}: only Advanced states no minute line`);
      same([line.cap, line.capFrom], [500, "advisory"], `${plan}: AN UNSTATED MINUTE LINE IS HELD TO THE 500 WORKING LINE`);
    }
    if (vendorMinuteSum() > line.cap) {
      same(budgetBreaches({ FLOWS_UW_PLAN: plan }), ["uw.min"], `${plan}: the ceilings (${vendorMinuteSum()}) are over its ${line.cap} a minute`);
    } else {
      same(budgetBreaches({ FLOWS_UW_PLAN: plan }), [], `${plan}: the ceilings (${vendorMinuteSum()}) fit its ${line.cap} a minute`);
    }
  }
  same(plans.filter((p) => p.line.cap !== null && vendorMinuteSum() <= p.line.cap).map((p) => p.plan), ["startup-annual"], "only the annual plan's 1,000 a minute covers the as-built ceilings");
  const caps = plans.filter((p) => p.line.planCap !== null).map((p) => p.line.planCap);
  eq(lines({})["uw.min"].cap, Math.min(...caps), "an unread plan is the smallest documented line");
  same(budgetBreaches({ FLOWS_UW_PLAN: "advanced" }), ["uw.min"], "EXPECTED BREACH ON THE RECORDED PLAN: Advanced states no minute line, so the 604 is held to the 500 working line and P1-31 still clears it");
}

{
  const recorded = /^FLOWS_UW_PLAN = "([^"]*)"$/m.exec(toml);
  ok(recorded, "wrangler.toml records the feed plan");
  const prod = { FLOWS_UW_PLAN: recorded[1] };
  eq(lines(prod)["uw.day"].plan, "advanced", "as Advanced");
  same(vendorMinuteCeilings(prod), vendorMinuteCeilings({}), "RECORDING THE PLAN MOVES NO ENFORCED PER-MINUTE CEILING: the rail, the limiters, Tier 2 and Tier 1 are set in code and wrangler.toml, not by the day line");
  eq(lines(prod)["uw.min"].cap, lines({})["uw.min"].cap, "and the minute line they are summed against is the same 500");
  eq(lines(prod)["uw.day"].cap, 100_000_000, "while the day line rises from the 60,000 working line to the plan's 100M");
  ok(vendorMinuteSum(prod) * 60 * 24 < lines(prod)["uw.day"].cap, "which every enforced ceiling run flat out for a whole day (868,320 calls) cannot reach");
}

{
  const four = { locations: 4 };
  eq(vendorMinuteCeilings({}, four).onDemand, 480, "four locations make the on-demand limiter 480 a minute in the worst case");
  eq(vendorMinuteCeilings({}, four).member, 240, "and the member limiter 240");
  eq(vendorMinuteSum({}, four), 240 + 480 + 240 + 180 + 4, "so the worst-case sum is 1,144");
  same(budgetBreaches({ FLOWS_UW_PLAN: "startup-annual" }, four), ["uw.min"], "which not even the annual plan's 1,000 covers");
  same(budgetBreaches({ FLOWS_UW_PLAN: "startup-annual" }, { locations: 1 }), [], "while one location fits it");
}

{
  const raised = { FLOWS_RT_CALLS_PER_MIN: "1200" };
  eq(vendorMinuteCeilings(raised).rail, 1200, "FLOWS_RT_CALLS_PER_MIN is honoured up to 1,200 by the hub");
  same(budgetBreaches(raised), ["uw.min"], "a rail raised to 1,200 is a breach: 1,563 with the other ceilings");
  same(budgetBreaches({ ...raised, FLOWS_UW_PLAN: "startup-annual" }), ["uw.min"], "and the annual plan's 1,000 does not cover it either");
  same(budgetBreaches({ FLOWS_RT_CALLS_PER_MIN: "136" }), [], "a rail at 136 is the largest that fits 500 beside the other ceilings (364)");
  same(budgetBreaches({ FLOWS_RT_CALLS_PER_MIN: "137" }), ["uw.min"], "and 137 does not: 501, one past the line");
  same(budgetBreaches({ FLOWS_RT_CALLS_PER_MIN: "636", FLOWS_UW_PLAN: "startup-annual" }), [], "the annual plan covers a rail at 636");
  same(budgetBreaches({ FLOWS_RT_CALLS_PER_MIN: "637", FLOWS_UW_PLAN: "startup-annual" }), ["uw.min"], "and not 637");
  eq(vendorMinuteCeilings({ FLOWS_RT_CALLS_PER_MIN: "9" }).rail, 10, "the hub clamps a rail below 10 a minute up to 10");
  eq(vendorMinuteCeilings({ FLOWS_RT_CALLS_PER_MIN: "lots" }).rail, 240, "and a value that is not a number falls back to the default");
}

{
  const paid = lines({});
  const free = lines({ FLOWS_PLAN_WORKERS: "free" });
  for (const id of ["uw.day", "uw.min"]) {
    same(free[id], paid[id], `${id}: a Workers plan change leaves the feed line where it was`);
  }
  eq(RESOURCE_IDS.filter((id) => free[id].cap !== paid[id].cap).length, 14, "while 14 serving lines move, which the governor reads from the same table");
  same(downgradeBreaches(), ["ai.neurons"], "DOWNGRADE CHECKLIST: of the enforced settings, only the AI neuron cap (30,000) is above the Free column (10,000), and the call cap is not");
  eq(aiCapNeurons({}), 30000, "the cap in force is the default of 30,000");
  same(downgradeBreaches({ FLOWS_AI_DAILY_CAP_NEURONS: "9000" }), [], "lowering it to 9,000 clears the checklist");
  same(downgradeBreaches({ FLOWS_AI_DAILY_CAP_CALLS: "3000" }).sort(), ["ai.calls", "ai.neurons"], "a call cap of 3,000 is flagged beside it");
}

{
  const LEDGER_FILES = ["shared/flows-ledger-book.js", "shared/flows-ledger-live.js", "shared/flows-ledger-strip.js", "server/routes/flows-ledger.js", "assets/js/flows-sfc-live.js", "assets/js/flows-sfc.js"];
  for (const file of LEDGER_FILES) {
    const src = read(file);
    ok(!/\buwFetch\b|\bvendorUrl\b|UW_API_KEY|UW_BASE|unusualwhales|\bpathFor\(|fetchVendor/.test(src), `${file} names no feed client, path, key or base: the live ledger makes no feed call of its own`);
  }
  const wire = read("worker.js").split("\n").filter((l) => l.startsWith("flowsLedgerRows("));
  eq(wire.length, 1, "the Worker mounts the ledger family in one call");
  ok(wire[0].startsWith("flowsLedgerRows({ store: FLOWS_STORE, ensureFlowsTables, readLiveRows: FLOWS_LIVE.readLiveRows, isOwner: ") && !/uwFetch|fetchVendor|limiter|\bAI\b|ratelimit/i.test(wire[0]), "and hands it a store, the schema bootstrap, the stored-row reader and the owner test: no feed fetch, no limiter, no model");
  const glue = read("assets/js/flows-sfc-live.js");
  same([...glue.matchAll(/rt\.connect\(\{([^}]*)\}\)/g)].map((m) => m[1].replace(/\s+/g, " ").trim()), ['topics: ["fl"], primary: ["fl"]'], "the page asks the rail for the flow topic alone, the topic the Unusual page already demands");
  ok(/rt\.connect\(\{ topics: \["fl"\] \}\)/.test(read("assets/js/flows-unusual.js")), "which is the same demand, so a second viewer of it adds no poll: the hub polls a topic once for every socket that names it");
  same(vendorMinuteCeilings({ FLOWS_LEDGER_LIVE: "on" }), vendorMinuteCeilings({}), "FLOWS_LEDGER_LIVE moves no per-minute ceiling: the rail, the limiters, Tier 2 and Tier 1 are what they were");
  same(vendorMinuteCeilings({ FLOWS_LEDGER_LIVE: "owner" }), vendorMinuteCeilings({}), "owner mode too");
  eq(vendorMinuteSum({ FLOWS_LEDGER_LIVE: "on" }), 604, "so the sum stays at 604 and the as-built breach of the 500 working line is not one call wider");
  ok(/^FLOWS_LEDGER_LIVE = "owner"$/m.test(toml), "wrangler.toml ships the live ledger to owners only");
}

{
  const keys = ["live:alerts", "live:breadth"];
  for (const key of keys) {
    const spec = LIVE_KEYS[key];
    ok(spec && spec.writer === "actions", `${key} is written by the Tier 2 loop`);
    ok(LIVE_LOOP.slotMs / 1000 <= spec.cadenceS, `${key}: the loop's ${LIVE_LOOP.slotMs / 1000} s slot is no slower than its class's ${spec.cadenceS} s cadence, so no loop on the ledger's path needs tightening`);
    ok(spec.cadenceS < FRESH_CLASSES[spec.klass].liveS, `${key}: a read at its cadence is inside its live window`);
  }
  ok(5 * 60 === FRESH_CLASSES.market.cadenceS && /"1-59\/5 13-21 \* \* MON-FRI"/.test(toml) && /"3-58\/5 13-21 \* \* MON-FRI"/.test(toml), "and Tier 1 and the focus tick fire every five minutes, the market class's cadence");
}

{
  const self = read("tests/flows-vendor-budget.mjs");
  ok(/from "\.\.\/shared\/flows-plan-facts\.js"/.test(self), "this test reads the plan facts module");
  eq(lines({})["uw.day"].source, "uw.tier", "the strictest day line cites the spec's tier text");
}

console.log(`✓ flows-vendor-budget: ${checks} assertions — the enforced per-minute feed ceilings (rail, on-demand and member limiters, the Tier 2 pace, Tier 1 and focus) summed to 544 and 604 and held against the same plan-facts table the governor reads, with the as-built breach of the unread plan's 500 asserted as expected and the per-location limiters counted at four locations, for every feed plan with Advanced's unstated minute line held to the 500 working line, the recorded plan moving no ceiling, a rail ceiling moved across the line, the feed lines unmoved by a Workers plan change while 14 serving lines move, and the downgrade checklist of enforced settings above the Free column`);
