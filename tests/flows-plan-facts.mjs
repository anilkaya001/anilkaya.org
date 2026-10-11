import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as P from "../shared/flows-plan-facts.js";
import { AI_CAP_DEFAULT_CALLS, AI_CAP_DEFAULT_NEURONS, AI_DAILY_NEURONS } from "../shared/flows-ai.js";
import { RT_LIMITS } from "../shared/flows-rt.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const throws = (f, m) => { assert.throws(f, m); checks++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const TODAY = new Date().toISOString().slice(0, 10);
const ALL_ROWS = [...P.RESOURCES, ...P.FACTS];
const cellsOf = (row) => (row.plans ? Object.entries(row.plans) : [["free", row.free], ["paid", row.paid]]);

{
  const ids = ALL_ROWS.map((r) => r.id);
  eq(new Set(ids).size, ids.length, "no id is defined twice across the meters and the facts");
  ok(P.RESOURCES.length >= 25, `${P.RESOURCES.length} meters are registered`);
  for (const id of [
    "uw.day", "uw.min", "d1.read", "d1.write", "d1.bytes", "d1.q", "cf.req", "do.req", "do.gbs", "do.rowsw", "do.cpu", "do.mem",
    "ai.neurons", "ai.usd", "ai.rpm", "ai.calls", "wae.pts", "wae.q", "r2.a", "r2.b", "r2.gb", "wl.events", "queue.ops.day", "gh.api", "gh.min",
  ]) ok(P.RESOURCE_IDS.includes(id), `RESOURCES lists the meter ${id}`);
  ok(P.FACT_IDS.includes("ai.rpm.paidonly"), "the Paid-only model rate (20 a minute) is a fact beside ai.rpm (300)");
  same(P.RESOURCES.filter((r) => r.kind === "hard").map((r) => r.id), ["uw.day"], "the vendor day is the one hard line");
}

{
  for (const [name, s] of Object.entries(P.SOURCES)) {
    ok(typeof s.page === "string" && s.page.length > 6, `${name} names its source page`);
    ok(P.VIA.includes(s.via), `${name} says how the figure was read (${s.via})`);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(s.readOn) && s.readOn <= TODAY && s.readOn >= "2026-09-01", `${name} carries the date it was read (${s.readOn})`);
  }
  for (const row of ALL_ROWS) {
    ok(P.KINDS.includes(row.kind), `${row.id} has a known kind`);
    ok(typeof row.unit === "string" && row.unit.length > 0, `${row.id} has a unit`);
    for (const [plan, c] of cellsOf(row)) {
      const where = `${row.id}/${plan}`;
      ok(Object.hasOwn(P.SOURCES, c.src), `EVERY FIGURE HAS A SOURCE: ${where} cites ${c.src}`);
      ok(P.WINDOWS.includes(c.per), `${where} has a window (${c.per})`);
      ok(c.v === null || (Number.isFinite(c.v) && c.v >= 0), `${where} is null or a non-negative number`);
      if (P.SOURCES[c.src].via === "unverified") eq(c.v, null, `${where} is unverified and so carries no number`);
      if (c.over) ok(c.over.usd > 0 && c.over.per > 0, `${where} prices its overage`);
    }
  }
  const unread = P.figures().filter((f) => f.via === null);
  eq(unread.length, 0, "no figure points at a source that does not exist");
}

{
  const lines = fs.readFileSync(path.join(ROOT, "docs/uw-openapi.yaml"), "utf8").split("\n");
  let n = 0;
  for (const [name, s] of Object.entries(P.SOURCES)) {
    if (s.kind !== "spec") continue;
    const m = /^(.+):(\d+)$/.exec(s.page);
    ok(m && m[1] === s.file, `${name} names file and line`);
    ok(lines[Number(m[2]) - 1].includes(s.quote), `${name}: line ${m[2]} of ${s.file} says "${s.quote}"`);
    n++;
  }
  ok(n >= 4, `${n} vendor figures are checked against the spec text in this repository`);
}

{
  same(P.snippetFigures().sort(), [
    "d1.bytes:free", "d1.bytes:paid", "d1.q:free", "d1.q:paid", "wae.pts:free", "wae.pts:paid", "wae.q:free", "wae.q:paid",
    "d1.databases:free", "d1.databases:paid", "d1.account.bytes:free", "d1.account.bytes:paid", "gh.api:free", "gh.api:paid",
    "gh.min:free", "gh.min:paid", "gh.concurrent:free", "gh.concurrent:paid",
  ].sort(), "THE FIGURES NOT YET READ FROM THE OFFICIAL PAGE ARE MARKED snippet: D1 size and queries per invocation, the Analytics Engine allowances, the Durable Object SQLite storage figure having been read from the Workers pricing page as 5 GB total on Free (and the GitHub limits from a search)");
  const recalled = P.figures().filter((f) => f.via === "recall").map((f) => `${f.id}:${f.plan}`).sort();
  same(recalled, ["do.mem:free", "do.mem:paid", "queue.ops.day:paid", "workflows.steps:paid"].sort(), "and the four recalled figures are named");
  eq(P.figures().find((f) => f.id === "do.sqlite.bytes" && f.plan === "free").cell.v, 5_000_000_000, "Durable Object SQLite storage on Free is 5 GB in total, from the Workers pricing page");
  for (const id of ["d1.bytes", "d1.q", "wae.pts", "wae.q"]) {
    ok(P.figures().some((f) => f.id === id && f.via === "snippet"), `${id} carries the snippet mark`);
  }
}

{
  const strictest = (row) => {
    const vs = Object.entries(row.plans).filter(([k, c]) => k !== "unknown" && c.v !== null).map(([, c]) => c.v);
    return vs.length ? Math.min(...vs) : null;
  };
  let rows = 0;
  for (const row of ALL_ROWS.filter((r) => r.plans)) {
    eq(row.plans.unknown.v, strictest(row), `UNKNOWN RESOLVES TO THE MINIMUM OF THE ROW: ${row.id}`);
    for (const [k, c] of Object.entries(row.plans)) {
      if (k !== "unknown" && c.v !== null && row.plans.unknown.v !== null) ok(row.plans.unknown.v <= c.v, `${row.id}: unknown is no looser than ${k}`);
    }
    rows++;
  }
  eq(rows, 4, "four vendor rows resolve unknown");
  eq(P.RESOURCES.find((r) => r.id === "uw.min").plans.unknown.v, 500, "the per-minute line for an unread plan is Startup's 500, as budget.md's working line says");
  eq(P.RESOURCES.find((r) => r.id === "uw.day").plans.unknown.v, 80000, "and the strictest documented day is 80,000");
  eq(P.FACTS.find((r) => r.id === "uw.lookback").plans.unknown.v, 90, "the lookback of an unread plan is the 90 days Startup documents");
  eq(P.FACTS.find((r) => r.id === "uw.conc").plans.unknown.v, 10, "and its concurrency the 10 the annual plan documents");
  for (const raw of [undefined, null, "", "  ", "UNKNOWN", "Advanced ", "startup", "startup-annual", "kafka", "enterprise", "x".repeat(500), 7, {}]) {
    const r = P.resolveUwPlan(raw);
    ok(P.UW_PLANS.includes(r.plan), `a vendor plan value ${JSON.stringify(String(raw).slice(0, 12))} resolves inside the known set (${r.plan})`);
  }
  const vendorFigures = {
    "uw.day": { advanced: null, startup: 80000, "startup-annual": 80000, kafka: 80000 },
    "uw.min": { advanced: null, startup: 500, "startup-annual": 1000, kafka: 500 },
    "uw.lookback": { advanced: null, startup: 90, "startup-annual": 90, kafka: 90 },
    "uw.conc": { advanced: null, startup: null, "startup-annual": 10, kafka: null },
  };
  for (const [id, byPlan] of Object.entries(vendorFigures)) {
    const row = ALL_ROWS.find((r) => r.id === id);
    for (const [plan, v] of Object.entries(byPlan)) eq(row.plans[plan].v, v, `${id} on ${plan} as the vendor's spec states it`);
  }
  eq(P.resolveUwPlan("enterprise").plan, "unknown", "an unrecognised vendor plan is the strictest one");
  eq(P.resolveUwPlan("enterprise").recognised, false, "and says it was not recognised");
  eq(P.resolveUwPlan(" Startup-Annual ").plan, "startup-annual", "case and spaces are forgiven");
}

{
  const env = (w, extra = {}) => (w === undefined ? { ...extra } : { FLOWS_PLAN_WORKERS: w, ...extra });
  eq(P.planOf({}).workers, "paid", "UNSET FLOWS_PLAN_WORKERS IS PAID, the design plan (OD-01)");
  eq(P.planOf({}).uw, "unknown", "unset FLOWS_UW_PLAN is unknown");
  eq(P.planOf(undefined).workers, "paid", "no env object at all is the default too");
  eq(P.planOf(env(" Free ")).workers, "free", "free is read case- and space-insensitively");
  eq(P.planOf(env("payed")).workers, "free", "a misspelt Workers plan is the strict one, never silently Paid");
  eq(P.planOf(env("payed")).workersRecognised, false, "and is reported unrecognised");
  eq(P.planOf(env("")).workers, "paid", "an empty value is unset");

  const expected = {
    "cf.req": [100_000, 10_000_000], "d1.read": [5_000_000, 25_000_000_000], "d1.write": [100_000, 50_000_000], "d1.q": [50, 1000],
    "d1.bytes": [500_000_000, 10_000_000_000], "do.req": [100_000, 1_000_000], "do.gbs": [13_000, 400_000], "do.rowsw": [100_000, 50_000_000],
    "ai.neurons": [10_000, 10_000], "ai.rpm": [300, 300], "wae.pts": [100_000, 10_000_000], "wae.q": [10_000, 1_000_000],
    "wl.events": [200_000, 20_000_000], "queue.ops.day": [10_000, 1_000_000], "r2.a": [1_000_000, 1_000_000], "r2.b": [10_000_000, 10_000_000],
    "r2.gb": [10, 10], "ai.calls": [2500, 2500], "do.cpu": [null, 30000],
  };
  const free = P.lines(env("free"));
  const paid = P.lines(env("paid"));
  const dflt = P.lines({});
  for (const [id, [f, p]] of Object.entries(expected)) {
    eq(free[id].cap, f, `${id} on Free`);
    eq(paid[id].cap, p, `${id} on Paid`);
    eq(dflt[id].cap, p, `${id} by default is the Paid figure`);
  }
  same(dflt, paid, "no variable and FLOWS_PLAN_WORKERS=paid give the same lines");

  const moved = P.RESOURCE_IDS.filter((id) => free[id].cap !== paid[id].cap || free[id].per !== paid[id].per);
  const unmoved = P.RESOURCE_IDS.filter((id) => !moved.includes(id));
  same(moved.slice().sort(), [
    "ai.usd", "cf.req", "d1.bytes", "d1.q", "d1.read", "d1.write", "do.cpu", "do.gbs", "do.req", "do.rowsw", "queue.ops.day", "wae.pts", "wae.q", "wl.events",
  ], `FLIPPING FLOWS_PLAN_WORKERS MOVES THESE ${moved.length} LINES AND NO OTHER`);
  for (const id of unmoved) {
    const row = P.RESOURCES.find((r) => r.id === id);
    ok(row.plans || (row.free.v === row.paid.v && row.free.per === row.paid.per), `${id} is unmoved only because it is the same on both plans or is a vendor line`);
  }
  for (const id of ["uw.day", "uw.min"]) eq(free[id].cap, paid[id].cap, `${id} follows the vendor plan, not the Workers plan`);

  for (const id of P.RESOURCE_IDS) {
    same(free[id].downgrade, paid[id].downgrade, `${id}: the downgrade column does not depend on the active plan`);
    same(free[id].design, paid[id].design, `${id}: nor does the design column`);
  }
  for (const row of P.RESOURCES.filter((r) => !r.plans)) {
    same(paid[row.id].downgrade, row.free, `FREE DAILY CAPS ARE THE DOWNGRADE COLUMN: ${row.id}`);
    same(paid[row.id].design, row.paid, `PAID LINES ARE THE DESIGN COLUMN: ${row.id}`);
  }

  const moneyRows = P.RESOURCES.filter((r) => r.kind === "money" && !r.plans && !/^(ai|r2)\./.test(r.id));
  ok(moneyRows.length >= 9, `${moneyRows.length} serving meters are money lines`);
  for (const r of moneyRows) {
    eq(r.free.per, "day", `${r.id}: Free is a daily cap`);
    eq(r.paid.per, "month", `${r.id}: Paid is a monthly line`);
    ok(r.paid.over && r.paid.over.usd > 0, `${r.id}: Paid beyond the line is a bill, priced`);
  }
  for (const id of ["cf.req", "do.req", "do.gbs", "d1.read", "d1.write", "do.rowsw", "r2.a", "r2.b", "r2.gb"]) eq(paid[id].kind, "money", `${id} is a money line`);
  eq(paid["d1.write"].over.usd, 1, "a million D1 rows written beyond the Paid line is $1.00");
  eq(paid["d1.read"].over.usd, 0.001, "a million rows read is $0.001");
  eq(paid["cf.req"].over.usd, 0.3, "a million Worker requests is $0.30");
  eq(paid["do.gbs"].over.usd, 12.5, "a million GB-s is $12.50");
  eq(paid["r2.a"].over.usd, 4.5, "a million R2 Class A operations is $4.50");
  eq(paid["r2.b"].over.usd, 0.36, "and Class B $0.36");
  eq(paid["ai.neurons"].over.usd, 0.011, "a thousand neurons beyond the 10,000 a day is $0.011");
  eq(P.facts({})["workers.fee"].cap, 5, "the Workers Paid fee is $5 a month");
}

{
  const free = P.lines({ FLOWS_PLAN_WORKERS: "free" });
  const paid = P.lines({});
  eq(paid["ai.usd"].cap, 0.22, "the AI dollar line defaults to $0.22 a day on Paid");
  eq(free["ai.usd"].cap, null, "and does not exist on Free, where Cloudflare stops the call");
  near((AI_CAP_DEFAULT_NEURONS - AI_DAILY_NEURONS) * 0.011 / 1000, paid["ai.usd"].cap, 1e-12, "THE DOLLAR LINE IS THE ENFORCED NEURON CAP PRICED: (30,000 - 10,000) neurons at $0.011 per 1,000");
  eq(paid["ai.neurons"].cap, AI_DAILY_NEURONS, "the included neurons are the constant flows-ai.js subtracts");
  eq(paid["ai.calls"].cap, AI_CAP_DEFAULT_CALLS, "the call cap is the one flows-ai.js enforces");
  ok(/FLOWS_AI_DAILY_CAP_CALLS = "2500"/.test(read("wrangler.toml")), "and wrangler.toml sets the same number");
  eq(P.lines({ FLOWS_AI_USD_DAY: "1.5" })["ai.usd"].cap, 1.5, "an owner dollar line replaces the default");
  eq(P.lines({ FLOWS_AI_USD_DAY: "1.5" })["ai.usd"].capFrom, "owner", "and says so");
  eq(P.lines({ FLOWS_AI_USD_DAY: "-1" })["ai.usd"].cap, 0.22, "a negative one is ignored");
  eq(P.lines({ FLOWS_AI_USD_DAY: "lots" })["ai.usd"].cap, 0.22, "so is text");
  eq(P.lines({ FLOWS_PLAN_WORKERS: "free", FLOWS_AI_USD_DAY: "1.5" })["ai.usd"].cap, null, "and on Free there is no dollar line to set");

  const day = (e) => P.lines(e)["uw.day"];
  eq(day({}).cap, 60000, "an unread vendor plan with no owner line runs at the 60,000 working line");
  eq(day({}).capFrom, "advisory", "and says it is advisory");
  eq(day({}).planCap, 80000, "while the table's strictest documented day stays 80,000");
  eq(day({ FLOWS_UW_PLAN: "startup" }).cap, 80000, "Startup is 80,000");
  eq(day({ FLOWS_UW_PLAN: "startup", FLOWS_UW_DAILY_LIMIT: "60000" }).cap, 60000, "an owner line below the plan wins");
  eq(day({ FLOWS_UW_PLAN: "startup", FLOWS_UW_DAILY_LIMIT: "200000" }).cap, 80000, "an owner line above the plan is held to the plan");
  eq(day({ FLOWS_UW_PLAN: "advanced" }).cap, null, "Advanced documents no day cap");
  eq(day({ FLOWS_UW_PLAN: "advanced", FLOWS_UW_DAILY_LIMIT: "50000" }).cap, 50000, "and takes the owner's line as given");
  eq(day({ FLOWS_UW_DAILY_LIMIT: "30000" }).cap, 30000, "an unread plan takes an owner line below the working line");
  for (const bad of ["abc", "0", "-5", "1.5", "", " ", "1e400"]) eq(day({ FLOWS_UW_PLAN: "startup", FLOWS_UW_DAILY_LIMIT: bad }).capFrom, "plan", `owner line ${JSON.stringify(bad)} is ignored`);
  eq(P.lines({ FLOWS_UW_PLAN: "startup-annual" })["uw.min"].cap, 1000, "the annual plan is 1,000 a minute");
  eq(P.lines({ FLOWS_UW_PLAN: "kafka" })["uw.min"].cap, 500, "the Kafka tier 500");
  eq(P.lines({ FLOWS_UW_PLAN: "advanced" })["uw.min"].cap, null, "Advanced documents no minute line");
  eq(P.lines({})["uw.min"].cap, 500, "and an unread plan 500");
  same(P.lines({ FLOWS_UW_PLAN: "startup-annual" })["uw.min"].downgrade, P.lines({})["uw.min"].design, "the vendor downgrade column is the strictest value: the unread plan");
}

{
  const t = (iso) => Date.parse(iso);
  const r = (iso, e = {}) => P.renewalState(t(iso), e);
  eq(r("2026-10-11T12:00:00Z").state, "current", "THE PAID RENEWAL IS MONITORED: 19 days out is current");
  eq(r("2026-10-11T12:00:00Z").through, "2026-10-29", "the period recorded from the invoice ends on 2026-10-29");
  eq(r("2026-10-11T12:00:00Z").renews, "2026-10-30", "and renews on 2026-10-30");
  eq(r("2026-10-27T00:00:00Z").state, "due", "within three days it is due");
  eq(r("2026-10-29T23:59:59Z").state, "due", "through the last second of the period");
  eq(r("2026-10-30T00:00:00Z").state, "unconfirmed", "the first second after it, with no new period recorded, is unconfirmed: the owner flips the plan to free the same day or records the new period");
  eq(r("2026-10-30T00:00:00Z").workers, "paid", "and the monitor does not change the lines by itself");
  same(P.lines({}), P.lines({}), "the lines do not depend on the clock");
  eq(r("2026-10-30T12:00:00Z", { FLOWS_PLAN_PAID_THROUGH: "2026-11-29" }).state, "current", "a recorded new period is current again");
  eq(r("2026-10-30T12:00:00Z", { FLOWS_PLAN_PAID_THROUGH: "2026-11-29" }).renews, "2026-11-30", "and renews the next day");
  eq(r("2026-10-30T12:00:00Z", { FLOWS_PLAN_PAID_THROUGH: "soon" }).through, "2026-10-29", "an unparsable record is ignored");
  eq(r("2026-10-30T12:00:00Z", { FLOWS_PLAN_PAID_THROUGH: "2026-02-31" }).through, "2026-10-29", "so is an impossible date");
  eq(r("2026-10-30T12:00:00Z", { FLOWS_PLAN_WORKERS: "free" }).state, "free", "on Free there is nothing to renew");
  eq(P.renewalState(NaN, {}).state, "unconfirmed", "a clock that is not a number is never reported current");
  eq(P.renewalState(undefined, {}).daysLeft, null, "and it has no days left to count");
  eq(P.renewalState(NaN, { FLOWS_PLAN_WORKERS: "free" }).state, "free", "while on Free there is still nothing to renew");
  eq(r("2026-10-11T12:00:00Z").daysLeft, 19, "the days left are counted up to whole days to the end of the period");
}

{
  throws(() => { P.RESOURCES[2].free.v = 1; }, "the table is frozen: a consumer cannot change a cap");
  throws(() => { P.SOURCES["cf.d1.limits"].via = "page"; }, "and no source can be promoted to a page read in place");
  throws(() => { P.lines({})["cf.req"].cap = 1; }, "a line is frozen through its cells");
  const a = P.lines({ FLOWS_PLAN_WORKERS: "free" });
  const b = P.lines({ FLOWS_PLAN_WORKERS: "free" });
  ok(a !== b && JSON.stringify(a) === JSON.stringify(b), "lines are rebuilt from the env on every call and equal for equal env");
  const bytes = JSON.stringify(P.lines({})).length;
  ok(bytes < 24 * 1024, `the governor's whole view is ${bytes} bytes`);
}

{
  const src = read("shared/flows-plan-facts.js");
  ok(!/\/\/|\/\*/.test(src.replace(/https?:\/\//g, "")), "the module carries no comments");
  ok(!/^import /m.test(src), "and imports nothing: a leaf any Worker, runner or test can read");
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel, out);
      else if (/\.(m?js|toml|yml)$/.test(e.name)) out.push(rel);
    }
    return out;
  };
  const files = ["worker.js", "wrangler.toml", ...walk("shared"), ...walk("scripts"), ...walk("assets/js"), ...walk(".github")];
  const readers = files.filter((f) => /FLOWS_PLAN_WORKERS|FLOWS_UW_PLAN/.test(read(f)));
  same(readers, ["shared/flows-plan-facts.js"], "ONE PLACE: no other source file reads either plan variable");
  const agents = read("AGENTS.md");
  ok(agents.includes("100,000 rows written and 5,000,000 rows read"), "AGENTS.md states the D1 Free caps");
  eq(P.lines({ FLOWS_PLAN_WORKERS: "free" })["d1.write"].cap, 100_000, "which are the Free lines here");
  eq(P.lines({ FLOWS_PLAN_WORKERS: "free" })["d1.read"].cap, 5_000_000, "both of them");
  ok(P.UW_PLANS.includes(P.UW_PLAN_DEFAULT) && P.WORKERS_PLANS.includes(P.WORKERS_PLAN_DEFAULT), "the defaults are members of their sets");
  ok(RT_LIMITS.callsPerMinute <= P.lines({})["uw.min"].cap, "the rail's default per-minute ceiling is inside the strictest vendor minute line");
}

function near(a, b, tol, m) { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b})`); checks++; }

console.log(`✓ flows-plan-facts: ${checks} assertions — every cap per Workers plan and per vendor plan with its source page and the date read, snippet and recall marks on the figures not yet read from an official page, unknown resolving to the minimum of each vendor row, Paid as the default and a misspelt plan the strict one, the downgrade and design columns, money lines priced beyond the Paid allowance, the AI dollar line equal to the enforced neuron cap priced, the vendor day as the one hard line with owner and advisory lines, the Paid renewal monitor, a frozen table and one place that reads either plan variable`);
