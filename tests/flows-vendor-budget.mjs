import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lines, UW_PLANS, RESOURCE_IDS } from "../shared/flows-plan-facts.js";
import { RT_LIMITS } from "../shared/flows-rt.js";
import { hubConfig } from "../shared/flows-rt-hub.js";
import { aiCapNeurons, aiCapCalls } from "../shared/flows-ai.js";

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

export function vendorMinuteCeilings(env = {}) {
  const onDemand = limiterOf("UW_ONDEMAND");
  const member = limiterOf("MEMBER_VENDOR");
  return {
    rail: hubConfig(env).callsPerMinute,
    onDemand: perMinute(onDemand),
    member: perMinute(member),
  };
}

export function vendorMinuteSum(env = {}) {
  const c = vendorMinuteCeilings(env);
  return c.rail + c.onDemand + c.member;
}

export function budgetBreaches(env = {}) {
  const l = lines(env);
  const out = [];
  const minute = l["uw.min"].cap;
  if (minute !== null && vendorMinuteSum(env) > minute) out.push("uw.min");
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
  same(onDemand, { limit: 120, periodS: 60 }, "wrangler.toml declares the on-demand vendor limiter at 120 a minute");
  same(member, { limit: 60, periodS: 60 }, "and the member vendor limiter at 60 a minute");
  const c = vendorMinuteCeilings();
  eq(c.rail, RT_LIMITS.callsPerMinute, "the rail's default ceiling is the hub's own default, read through hubConfig");
  eq(vendorMinuteSum(), 240 + 120 + 60, "the enforced per-minute ceilings sum to 420");
}

{
  const strictest = lines({});
  eq(strictest["uw.min"].plan, "unknown", "with no plan recorded the line is the unread plan's");
  eq(strictest["uw.min"].cap, 500, "which is Startup's 500 a minute");
  ok(vendorMinuteSum() <= strictest["uw.min"].cap, `THE SUM OF THE ENFORCED CEILINGS (${vendorMinuteSum()}) FITS THE STRICTEST VENDOR MINUTE LINE (${strictest["uw.min"].cap})`);
  same(budgetBreaches(), [], "so there is no breach today");
  const headroom = strictest["uw.min"].cap - vendorMinuteSum();
  ok(headroom >= 80, `${headroom} calls a minute are left for the Tier 1 and Tier 2 legs and the nightly's paced reads`);
}

{
  const plans = UW_PLANS.map((plan) => ({ plan, line: lines({ FLOWS_UW_PLAN: plan })["uw.min"] }));
  for (const { plan, line } of plans) {
    eq(line.plan, plan, `${plan}: the line reports the plan it was read for`);
    if (line.cap === null) eq(plan, "advanced", `${plan}: only Advanced has no documented minute line`);
    else ok(vendorMinuteSum() <= line.cap, `${plan}: the ceilings (${vendorMinuteSum()}) fit its ${line.cap} a minute`);
  }
  const caps = plans.filter((p) => p.line.cap !== null).map((p) => p.line.cap);
  eq(lines({})["uw.min"].cap, Math.min(...caps), "an unread plan is the smallest documented line");
}

{
  const raised = { FLOWS_RT_CALLS_PER_MIN: "1200" };
  eq(vendorMinuteCeilings(raised).rail, 1200, "FLOWS_RT_CALLS_PER_MIN is honoured up to 1,200 by the hub");
  same(budgetBreaches(raised), ["uw.min"], "A CEILING RAISED PAST THE STRICTEST LINE IS A BREACH: the rail at 1,200 a minute with the limiters is 1,380");
  same(budgetBreaches({ ...raised, FLOWS_UW_PLAN: "startup-annual" }), ["uw.min"], "and the annual plan's 1,000 does not cover it either");
  same(budgetBreaches({ FLOWS_RT_CALLS_PER_MIN: "320" }), [], "a rail at 320 still fits");
  same(budgetBreaches({ FLOWS_RT_CALLS_PER_MIN: "321" }), ["uw.min"], "and 321 does not: 321 + 120 + 60 is 501, one past the line");
  same(budgetBreaches({ FLOWS_RT_CALLS_PER_MIN: "600", FLOWS_UW_PLAN: "startup-annual" }), [], "the annual plan covers a rail at 600");
  eq(vendorMinuteCeilings({ FLOWS_RT_CALLS_PER_MIN: "9" }).rail, 10, "the hub clamps a rail below 10 a minute up to 10");
  eq(vendorMinuteCeilings({ FLOWS_RT_CALLS_PER_MIN: "lots" }).rail, 240, "and a value that is not a number falls back to the default");
}

{
  const paid = lines({});
  const free = lines({ FLOWS_PLAN_WORKERS: "free" });
  for (const id of ["uw.day", "uw.min"]) {
    same(free[id], paid[id], `${id}: a Workers plan change leaves the vendor line where it was`);
  }
  eq(RESOURCE_IDS.filter((id) => free[id].cap !== paid[id].cap).length, 14, "while 14 serving lines move, which the governor reads from the same table");
  same(downgradeBreaches(), ["ai.neurons"], "DOWNGRADE CHECKLIST: of the enforced settings, only the AI neuron cap (30,000) is above the Free column (10,000), and the call cap is not");
  eq(aiCapNeurons({}), 30000, "the cap in force is the default of 30,000");
  same(downgradeBreaches({ FLOWS_AI_DAILY_CAP_NEURONS: "9000" }), [], "lowering it to 9,000 clears the checklist");
  same(downgradeBreaches({ FLOWS_AI_DAILY_CAP_CALLS: "3000" }).sort(), ["ai.calls", "ai.neurons"], "a call cap of 3,000 is flagged beside it");
}

{
  const self = read("tests/flows-vendor-budget.mjs");
  ok(/from "\.\.\/shared\/flows-plan-facts\.js"/.test(self), "this test reads the plan facts module");
  eq(lines({})["uw.day"].source, "uw.tier", "the strictest day line cites the spec's tier text");
}

console.log(`✓ flows-vendor-budget: ${checks} assertions — the enforced per-minute vendor ceilings (rail, on-demand and member limiters) summed and held against the same plan-facts table the governor reads, for every vendor plan and for the unread plan's minimum, a rail ceiling raised past the line flagged, the vendor lines unmoved by a Workers plan change while 14 serving lines move, and the downgrade checklist of enforced settings above the Free column`);
