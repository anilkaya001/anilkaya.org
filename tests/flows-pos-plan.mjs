import assert from "node:assert/strict";
import * as X from "../shared/flows-vendor-extras.js";
import { runExtras } from "../scripts/flows-legs/extras.mjs";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const DAY = 86400000;
const T0 = Date.parse("2026-10-26T22:00:00Z");
const part = (id, at) => ({ at, rv: X.PARTS[id].rv, x: { ok: true } });

function simulate(n, { cap = 600, scoped = true } = {}) {
  const names = Array.from({ length: n }, (_, i) => "SYX" + String(100 + i));
  const deep = new Set(names.filter((_, i) => i % 5 === 0));
  const priors = new Map();
  let now = T0;
  const nightly = [];
  let cold = 0;
  let expired = 0;
  const total = names.length * 3 + deep.size;
  for (let night = 1; night <= 40; night++) {
    const plan = X.planSlow({ names, priors, now, cap, ids: X.PS_IDS, scopeOf: scoped ? (id, t) => id !== "svx" || deep.has(t) : null });
    nightly.push(plan.picked.length);
    for (const p of plan.picked) {
      if (!priors.has(p.t)) priors.set(p.t, { dx: null, vx: null, ps: { parts: {} } });
      priors.get(p.t).ps.parts[p.id] = part(p.id, now);
    }
    let missing = 0;
    for (const t of names) for (const id of X.PS_IDS) {
      if (id === "svx" && !deep.has(t) && scoped) continue;
      const pt = priors.get(t) && priors.get(t).ps.parts[id];
      if (!pt) missing++;
      else if (X.partState(pt, id, now) === "expired") expired++;
    }
    if (missing && night > cold) cold = night;
    now += DAY;
  }
  return { nightly, cold, expired, total, deep: deep.size };
}

{
  eq(X.PS_IDS, ["ftd", "svx", "ibs", "ins"], "the positioning group holds the four parts");
  eq(["ftd", "svx", "ibs", "ins"].map((id) => [X.PARTS[id].refreshS / 3600, X.PARTS[id].maxS / 86400]), [[168, 21], [20, 3], [72, 7], [720, 60]], "with the stated refresh and maximum ages");
  eq(X.SLOW_IDS.filter((id) => X.PARTS[id].group === "ps"), [], "the slow planner's own list is unchanged and holds none of them");
  eq(X.SHED_ORDER.slice(0, 4), ["svx", "ins", "ibs", "ftd"], "and the positioning parts are shed before any existing one");
  for (const n of [700, 856]) {
    const s = simulate(n);
    ok(s.nightly.every((c) => c <= 600), `${n} names: no night reads more than 600 positioning parts (largest ${Math.max(...s.nightly)})`);
    ok(s.cold <= 7, `${n} names: the cold start reaches every name inside seven nights (${s.cold})`);
    ok(s.cold <= Math.ceil(s.total / 600) + 1, `${n} names: and no later than the ceiling of ${s.total} calls over the cap`);
    eq(s.expired, 0, `${n} names: over 40 nights no part is ever read after its maximum age`);
    ok(s.nightly.slice(8).reduce((a, c) => a + c, 0) / 32 <= 600, `${n} names: the steady night averages ${Math.round(s.nightly.slice(8).reduce((a, c) => a + c, 0) / 32)} parts`);
  }
  const zero = simulate(200, { cap: 0 });
  ok(zero.nightly.every((c) => c === 0), "a cap of zero plans none");
  const names = ["SYX101", "SYX102", "SYX103"];
  const withPs = new Map(names.map((t) => [t, { dx: { parts: { info: part("info", T0 - 2 * DAY) } }, vx: null, ps: { parts: { ftd: part("ftd", T0) } } }]));
  const without = new Map(names.map((t) => [t, { dx: { parts: { info: part("info", T0 - 2 * DAY) } }, vx: null, ps: null }]));
  eq(X.planSlow({ names, priors: withPs, now: T0, cap: 2000 }).picked, X.planSlow({ names, priors: without, now: T0, cap: 2000 }).picked, "the choices of the slow planner are the same with and without the positioning call");
}

const FTD = { data: [{ date: "2026-10-20", quantity: "1200", price: "12.34" }, { date: "2026-10-21", quantity: "x", price: "1" }] };
const VEN = { data: [{ date: "2026-10-23", exchange_name: "NYSE", market_center: "N", short_volume: 1, total_volume: 5 }, { date: "2026-10-26", exchange_name: "NYSE", market_center: "N", short_volume: 4, total_volume: 10 }] };
const IBS = { data: [{ filing_date: "2026-10-20", purchases: 1, purchases_notional: "5", sells: 2, sells_notional: "9" }] };
const INS = { data: [{ is_person: true, name: "A B" }, { is_person: false }] };

function scripted() {
  const calls = [];
  const uw = async (path) => {
    calls.push(path);
    if (path.includes("/ftds")) return FTD;
    if (path.includes("/volumes-by-exchange")) return VEN;
    if (path.includes("/insider-buy-sells")) return IBS;
    if (/\/api\/insider\/[A-Z0-9]+$/.test(path)) return INS;
    throw new Error(path + " -> HTTP 404");
  };
  return { uw, calls };
}

const psOnly = (calls) => calls.filter((p) => /\/ftds|\/volumes-by-exchange|\/insider-buy-sells|\/insider\/[A-Z0-9]+$/.test(p));

async function leg(mod, o) {
  const s = scripted();
  const out = await mod.runExtras({ uw: s.uw, names: ["SYX101", "SYX102", "SYX103", "SYX104"], sessionDate: "2026-10-26", now: T0, cap: 0, ...o });
  return { out, calls: s.calls };
}

const legBattery = async (mod) => {
  const fails = [];
  const need = (c, m) => { if (!c && fails.length < 6) fails.push(m); };
  const on = await leg(mod, { positioning: { cap: 600, deep: new Set(["SYX101", "SYX103"]) } });
  need(on.calls.filter((p) => p.includes("/volumes-by-exchange")).length === 2, "svx is read for deep names only");
  need(on.calls.filter((p) => p.includes("/ftds")).length === 4 && on.calls.filter((p) => p.includes("/insider-buy-sells")).length === 4, "ftd and ibs are read for every name");
  const sec = on.out.sections.get("SYX101");
  need(sec && sec.ps && sec.ps.parts.ftd && sec.ps.parts.ftd.x.rows.length === 1 && sec.ps.parts.ftd.x.rows[0][2] === 1234, "the extract keeps a price in cents and drops a row that is not a number");
  const capped = await leg(mod, { cap: 1, positioning: { cap: 600, deep: new Set() } });
  need(psOnly(capped.calls).length >= 12, "the positioning cap is its own: a slow cap of one does not limit it");
  const small = await leg(mod, { positioning: { cap: 5, deep: new Set() } });
  need(psOnly(small.calls).length === 5, "and a positioning cap of five reads five");
  const off = await leg(mod, { positioning: null, readPrior: async () => ({ payload: { dx: null, vx: null, ps: { parts: { ftd: part("ftd", T0 - DAY) } } } }) });
  need(psOnly(off.calls).length === 0 && [...off.out.sections.values()].every((s) => !s.ps), "with the nightly switch off no positioning call is made and no section is written");
  return fails;
};

const sharedBattery = (M) => {
  const fails = [];
  const need = (c, m) => { if (!c && fails.length < 6) fails.push(m); };
  const f = M.reduceFtd(FTD);
  need(f.ok && f.rows.length === 1 && f.rows[0][1] === 1200 && f.rows[0][2] === 1234 && f.bad === 1, "ftd rows");
  need(M.reduceFtd({ data: [{ date: "2026-10-20", quantity: "5" }] }).rows[0][2] === null, "a missing price is null and never zero");
  const i = M.reduceInsiders(INS);
  need(i.persons === 1 && i.entities === 1 && i.total === 2, "persons against entities");
  need(M.reduceInsiders({ data: [{ name: "x" }] }).reason === "type:is_person", "an unknown shape is named");
  const v = M.reduceShortVenues(VEN);
  need(v.ok && v.days[0][1] === 4 && v.last.venues[0][2] === 4, "venues");
  const b = M.reduceInsiderBs(IBS);
  need(b.ok && b.notional.withheld === "unit" && b.rows[0][1] === 1, "insider filings keep counts and withhold the dollars");
  const payload = { dx: { parts: { info: part("info", T0) }, status: "ok" }, ps: { parts: { ftd: part("ftd", T0), ins: part("ins", T0) }, status: "ok" }, shed: [] };
  need(M.shedNextPart(payload) === "ins", "the first part shed is a positioning part");
  return fails;
};

{
  eq(await legBattery({ runExtras }), [], "THE LEG PLANS THE POSITIONING PARTS UNDER THEIR OWN CAP, FOR THE NAMES THAT ARE DEEP, AND NOT AT ALL WHEN THE NIGHTLY SWITCH IS OFF");
  eq(sharedBattery(X), [], "THE REDUCERS KEEP WHAT THEY MUST AND THE POSITIONING PARTS SHED FIRST");
  const LEG = "scripts/flows-legs/extras.mjs";
  const SHARED = "shared/flows-vendor-extras.js";
  const PLANTS = [
    ["svx offered for every name", LEG, [["scopeOf: (id, t) => id !== \"svx\" || (deep !== null && deep.has(t))", "scopeOf: () => true"]]],
    ["the positioning planner sharing the slow cap", LEG, [["cap: positioning.cap, ids: PS_IDS", "cap, ids: PS_IDS"]]],
    ["the positioning section written with the switch off", LEG, [["for (const group of positioning ? [\"dx\", \"vx\", \"ps\"] : [\"dx\", \"vx\"]) {", "for (const group of [\"dx\", \"vx\", \"ps\"]) {"]]],
    ["the positioning parts planned with the switch off", LEG, [["const psPlan = positioning\n    ?", "const psPlan = true\n    ?"], ["cap: positioning.cap,", "cap: positioning ? positioning.cap : 600,"]]],
    ["the positioning parts shed after the existing ones", SHARED, [["[\"svx\", \"ins\", \"ibs\", \"ftd\", \"financials\"", "[\"financials\""], ["\"dividends\", \"ivp\"]);", "\"dividends\", \"ivp\", \"svx\", \"ins\", \"ibs\", \"ftd\"]);"]]],
    ["a price kept as dollars", SHARED, [["out.push([d, q, dollarsToCents(r.price)]);", "out.push([d, q, Number(r.price) || null]);"]]],
    ["persons counted as entities", SHARED, [["if (r.is_person === true) persons++;", "if (r.is_person === false) persons++;"]]],
    ["a missing price read as zero", SHARED, [["const dollarsToCents = (v) => {\n  if (v === null || v === undefined || v === \"\") return null;", "const dollarsToCents = (v) => {\n  if (v === null || v === undefined || v === \"\") return 0;"]]],
    ["the venues kept as the first date and not the newest", SHARED, [["const days = [...byDay.keys()].sort().reverse().slice(0, VENUE_DAYS);", "const days = [...byDay.keys()].sort().slice(0, VENUE_DAYS);"]]],
  ];
  for (const [title, file, transforms] of PLANTS) {
    const mod = await loadMutated(file, transforms);
    const fails = file === LEG ? await legBattery(mod) : sharedBattery(mod);
    ok(fails.length > 0, "PLANTED WRONG BUILD FAILS: " + title);
  }
}

console.log(`✓ flows-pos-plan: ${checks} assertions — the four positioning parts planned under their own cap on 700 and 856 names over forty nights (cold start inside seven nights, no part past its maximum age, the slow planner's choices unmoved), the leg reading svx for deep names only and nothing when the switch is off, and the positioning parts shed first`);
