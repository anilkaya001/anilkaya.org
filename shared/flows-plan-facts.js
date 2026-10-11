export const PLAN_FACTS_VERSION = 1;

export const WORKERS_PLANS = Object.freeze(["free", "paid"]);
export const UW_PLANS = Object.freeze(["unknown", "advanced", "startup", "startup-annual", "kafka"]);
export const WORKERS_PLAN_DEFAULT = "paid";
export const UW_PLAN_DEFAULT = "unknown";
export const PLAN_ENV = Object.freeze({ workers: "FLOWS_PLAN_WORKERS", uw: "FLOWS_UW_PLAN", paidThrough: "FLOWS_PLAN_PAID_THROUGH" });
export const OWNER_LINE_ENV = Object.freeze({ "uw.day": "FLOWS_UW_DAILY_LIMIT", "ai.usd": "FLOWS_AI_USD_DAY" });
export const VIA = Object.freeze(["page", "snippet", "recall", "inferred", "observed", "repo", "unverified"]);
export const KINDS = Object.freeze(["hard", "money", "quota", "guard"]);
export const WINDOWS = Object.freeze(["minute", "hour", "day", "week", "month", "invocation", "static"]);

const src = (kind, page, via, readOn, extra = {}) => ({ kind, page, via, readOn, ...extra });

export const SOURCES = {
  "cf.workers.limits": src("docs", "workers/platform/limits", "page", "2026-10-01"),
  "cf.workers.pricing": src("docs", "workers/platform/pricing", "page", "2026-10-01"),
  "cf.workers.memory": src("docs", "workers/platform/limits", "recall", "2026-10-11"),
  "cf.d1.pricing": src("docs", "d1/platform/pricing", "page", "2026-10-01"),
  "cf.d1.enforcement": src("changelog", "changelog/post/2026-09-01-d1-free-tier-limit-enforcement", "page", "2026-10-11"),
  "cf.d1.limits": src("docs", "d1/platform/limits", "snippet", "2026-10-01"),
  "cf.do.pricing": src("docs", "durable-objects/platform/pricing", "page", "2026-10-01"),
  "cf.do.limits": src("docs", "durable-objects/platform/limits", "snippet", "2026-10-01"),
  "cf.do.sqlite-ga": src("changelog", "changelog/post/2025-04-07-sqlite-in-durable-objects-ga", "page", "2026-10-11"),
  "cf.do.cpu-free": src("docs", "durable-objects/platform/limits", "unverified", "2026-10-01"),
  "cf.ai.pricing": src("docs", "workers-ai/platform/pricing", "page", "2026-10-01"),
  "cf.ai.limits": src("docs", "workers-ai/platform/limits", "page", "2026-10-01"),
  "cf.r2.pricing": src("docs", "r2/pricing", "page", "2026-10-01"),
  "cf.wae.pricing": src("docs", "analytics/analytics-engine/pricing", "snippet", "2026-10-01"),
  "cf.wae.limits": src("docs", "analytics/analytics-engine/limits", "snippet", "2026-10-01"),
  "cf.queues.changelog": src("changelog", "changelog/2026-02-04", "page", "2026-10-01"),
  "cf.queues.pricing": src("docs", "queues/platform/pricing", "recall", "2026-10-01"),
  "cf.workflows.limits": src("docs", "workflows/reference/limits", "page", "2026-10-01"),
  "cf.workflows.paid": src("docs", "workflows/reference/limits", "recall", "2026-10-01"),
  "gh.limits": src("docs", "docs.github.com/actions/limits", "snippet", "2026-10-01"),
  "uw.tier": src("spec", "docs/uw-openapi.yaml:14174", "page", "2026-10-11", {
    file: "docs/uw-openapi.yaml",
    quote: "500 req/min, 80K daily requests, 90-day lookback",
  }),
  "uw.annual": src("spec", "docs/uw-openapi.yaml:14174", "page", "2026-10-11", {
    file: "docs/uw-openapi.yaml",
    quote: "1,000 req/min and 10 concurrent requests",
  }),
  "uw.annual-day": src("spec", "docs/uw-openapi.yaml:14174", "inferred", "2026-10-11", {
    file: "docs/uw-openapi.yaml",
    quote: "Annual plan available at $7,500/yr",
  }),
  "uw.kafka": src("spec", "docs/uw-openapi.yaml:14176", "inferred", "2026-10-11", {
    file: "docs/uw-openapi.yaml",
    quote: "Startup + Kafka tier at $3,000/mo adds real-time Kafka cluster access",
  }),
  "uw.advanced": src("observed", "x-uw-token-req-limit=100000000 and no documented day cap", "observed", "2026-10-05"),
  "uw.working": src("programme", "budget.md: until the key's plan is read the working line is 60,000 a day and 500 a minute", "inferred", "2026-10-10"),
  "repo.ai-cap": src("repo", "shared/flows-ai.js AI_CAP_DEFAULT_CALLS", "repo", "2026-10-11"),
  "owner.ai-usd": src("owner", "FLOWS_AI_USD_DAY default: (30,000 - 10,000) neurons at $0.011 per 1,000", "repo", "2026-10-10"),
  "owner.od01": src("invoice", "Cloudflare invoice dated 2026-09-30: Workers Paid, period to 2026-10-29, renews 2026-10-30", "observed", "2026-10-10"),
};

const cell = (v, per, source, over = null) => ({ v, per, src: source, over });
const money = (usd, per) => ({ usd, per });

const metered = (id, unit, kind, owner, free, paid) => ({ id, unit, kind, owner, free, paid });
const vendor = (id, unit, kind, plans) => ({ id, unit, kind, owner: "vendor", plans });

const day = (v, source, over) => cell(v, "day", source, over);
const month = (v, source, over) => cell(v, "month", source, over);
const each = (v, source) => cell(v, "invocation", source);

export const RESOURCES = [
  vendor("uw.day", "calls", "hard", {
    advanced: day(null, "uw.advanced"),
    startup: day(80000, "uw.tier"),
    "startup-annual": day(80000, "uw.annual-day"),
    kafka: day(80000, "uw.kafka"),
  }),
  vendor("uw.min", "calls", "guard", {
    advanced: cell(null, "minute", "uw.advanced"),
    startup: cell(500, "minute", "uw.tier"),
    "startup-annual": cell(1000, "minute", "uw.annual"),
    kafka: cell(500, "minute", "uw.kafka"),
  }),
  metered("d1.read", "rows", "money", "cloudflare",
    day(5_000_000, "cf.d1.pricing"),
    month(25_000_000_000, "cf.d1.pricing", money(0.001, 1_000_000))),
  metered("d1.write", "rows", "money", "cloudflare",
    day(100_000, "cf.d1.pricing"),
    month(50_000_000, "cf.d1.pricing", money(1, 1_000_000))),
  metered("d1.bytes", "bytes", "quota", "cloudflare",
    cell(500_000_000, "static", "cf.d1.limits"),
    cell(10_000_000_000, "static", "cf.d1.limits")),
  metered("d1.q", "queries", "guard", "cloudflare",
    each(50, "cf.d1.limits"),
    each(1000, "cf.d1.limits")),
  metered("cf.req", "requests", "money", "cloudflare",
    day(100_000, "cf.workers.limits"),
    month(10_000_000, "cf.workers.pricing", money(0.3, 1_000_000))),
  metered("do.req", "requests", "money", "cloudflare",
    day(100_000, "cf.do.pricing"),
    month(1_000_000, "cf.do.pricing", money(0.15, 1_000_000))),
  metered("do.gbs", "GB-s", "money", "cloudflare",
    day(13_000, "cf.do.pricing"),
    month(400_000, "cf.do.pricing", money(12.5, 1_000_000))),
  metered("do.rowsw", "rows", "money", "cloudflare",
    day(100_000, "cf.do.pricing"),
    month(50_000_000, "cf.do.pricing", money(1, 1_000_000))),
  metered("do.cpu", "ms", "guard", "cloudflare",
    each(null, "cf.do.cpu-free"),
    each(30000, "cf.workers.limits")),
  metered("do.mem", "bytes", "guard", "cloudflare",
    each(134_217_728, "cf.workers.memory"),
    each(134_217_728, "cf.workers.memory")),
  metered("ai.neurons", "neurons", "money", "cloudflare",
    day(10_000, "cf.ai.pricing"),
    day(10_000, "cf.ai.pricing", money(0.011, 1000))),
  metered("ai.usd", "usd", "money", "owner",
    day(null, "cf.ai.pricing"),
    day(0.22, "owner.ai-usd")),
  metered("ai.rpm", "requests", "guard", "cloudflare",
    cell(300, "minute", "cf.ai.limits"),
    cell(300, "minute", "cf.ai.limits")),
  metered("ai.calls", "calls", "guard", "repo",
    day(2500, "repo.ai-cap"),
    day(2500, "repo.ai-cap")),
  metered("wae.pts", "points", "money", "cloudflare",
    day(100_000, "cf.wae.pricing"),
    month(10_000_000, "cf.wae.pricing", money(0.25, 1_000_000))),
  metered("wae.q", "queries", "money", "cloudflare",
    day(10_000, "cf.wae.pricing"),
    month(1_000_000, "cf.wae.pricing", money(1, 1_000_000))),
  metered("r2.a", "operations", "money", "cloudflare",
    month(1_000_000, "cf.r2.pricing", money(4.5, 1_000_000)),
    month(1_000_000, "cf.r2.pricing", money(4.5, 1_000_000))),
  metered("r2.b", "operations", "money", "cloudflare",
    month(10_000_000, "cf.r2.pricing", money(0.36, 1_000_000)),
    month(10_000_000, "cf.r2.pricing", money(0.36, 1_000_000))),
  metered("r2.gb", "GB-month", "money", "cloudflare",
    month(10, "cf.r2.pricing", money(0.015, 1)),
    month(10, "cf.r2.pricing", money(0.015, 1))),
  metered("wl.events", "events", "money", "cloudflare",
    day(200_000, "cf.workers.pricing"),
    month(20_000_000, "cf.workers.pricing", money(0.6, 1_000_000))),
  metered("queue.ops.day", "operations", "quota", "cloudflare",
    day(10_000, "cf.queues.changelog"),
    month(1_000_000, "cf.queues.pricing", money(0.4, 1_000_000))),
  metered("gh.api", "requests", "guard", "github",
    cell(1000, "hour", "gh.limits"),
    cell(1000, "hour", "gh.limits")),
  metered("gh.min", "runner-hours", "quota", "github",
    cell(null, "week", "gh.limits"),
    cell(null, "week", "gh.limits")),
];

export const FACTS = [
  metered("cpu.http", "ms", "guard", "cloudflare", each(10, "cf.workers.limits"), each(30000, "cf.workers.limits")),
  metered("cpu.cron", "ms", "guard", "cloudflare", each(10, "cf.workers.limits"), each(30000, "cf.workers.limits")),
  metered("subrequests", "requests", "guard", "cloudflare", each(50, "cf.workers.limits"), each(10000, "cf.workers.limits")),
  metered("waituntil.s", "seconds", "guard", "cloudflare", each(30, "cf.workers.limits"), each(30, "cf.workers.limits")),
  metered("cron.triggers", "triggers", "quota", "cloudflare", cell(5, "static", "cf.workers.limits"), cell(250, "static", "cf.workers.limits")),
  metered("d1.databases", "databases", "quota", "cloudflare", cell(10, "static", "cf.d1.limits"), cell(50000, "static", "cf.d1.limits")),
  metered("d1.account.bytes", "bytes", "quota", "cloudflare",
    cell(5_000_000_000, "static", "cf.d1.limits"),
    cell(1_000_000_000_000, "static", "cf.d1.limits")),
  metered("do.rowsr", "rows", "money", "cloudflare",
    day(5_000_000, "cf.do.pricing"),
    month(25_000_000_000, "cf.do.pricing", money(0.001, 1_000_000))),
  metered("do.sqlite.bytes", "bytes", "quota", "cloudflare",
    cell(1_000_000_000, "static", "cf.do.limits"),
    cell(10_000_000_000, "static", "cf.do.sqlite-ga")),
  metered("ai.rpm.paidonly", "requests", "guard", "cloudflare",
    cell(null, "minute", "cf.ai.limits"),
    cell(20, "minute", "cf.ai.limits")),
  metered("workflows.steps", "steps", "quota", "cloudflare",
    day(3000, "cf.workflows.limits"),
    month(500_000, "cf.workflows.paid")),
  metered("workers.fee", "usd", "money", "owner",
    month(0, "owner.od01"),
    month(5, "owner.od01")),
  metered("gh.concurrent", "jobs", "guard", "github", cell(20, "static", "gh.limits"), cell(20, "static", "gh.limits")),
  vendor("uw.lookback", "days", "quota", {
    advanced: cell(null, "static", "uw.advanced"),
    startup: cell(90, "static", "uw.tier"),
    "startup-annual": cell(90, "static", "uw.tier"),
    kafka: cell(90, "static", "uw.kafka"),
  }),
  vendor("uw.conc", "requests", "guard", {
    advanced: cell(null, "static", "uw.advanced"),
    startup: cell(null, "static", "uw.tier"),
    "startup-annual": cell(10, "static", "uw.annual"),
    kafka: cell(null, "static", "uw.kafka"),
  }),
];

export const ADVISORY = {
  "uw.day": cell(60000, "day", "uw.working"),
};

export const WORKERS_PAID_PERIOD = {
  through: "2026-10-29",
  renews: "2026-10-30",
  src: "owner.od01",
};

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};

const strictestCell = (plans) => {
  let best = null;
  for (const name of Object.keys(plans)) {
    const c = plans[name];
    if (c.v !== null && (best === null || c.v < best.v)) best = c;
  }
  const any = plans[Object.keys(plans)[0]];
  return best ? cell(best.v, best.per, best.src) : cell(null, any.per, any.src);
};

for (const row of [...RESOURCES, ...FACTS]) {
  if (row.plans) row.plans.unknown = strictestCell(row.plans);
}

deepFreeze(SOURCES);
deepFreeze(RESOURCES);
deepFreeze(FACTS);
deepFreeze(ADVISORY);
deepFreeze(WORKERS_PAID_PERIOD);

export const RESOURCE_IDS = Object.freeze(RESOURCES.map((r) => r.id));
export const FACT_IDS = Object.freeze(FACTS.map((r) => r.id));

const text = (raw) => (raw === undefined || raw === null ? "" : String(raw).trim().toLowerCase());

export function resolveWorkersPlan(raw) {
  const v = text(raw);
  if (v === "") return { plan: WORKERS_PLAN_DEFAULT, recognised: true, explicit: false };
  if (WORKERS_PLANS.includes(v)) return { plan: v, recognised: true, explicit: true };
  return { plan: "free", recognised: false, explicit: true };
}

export function resolveUwPlan(raw) {
  const v = text(raw);
  if (v === "") return { plan: UW_PLAN_DEFAULT, recognised: true, explicit: false };
  if (UW_PLANS.includes(v)) return { plan: v, recognised: true, explicit: true };
  return { plan: "unknown", recognised: false, explicit: true };
}

export function planOf(env) {
  const w = resolveWorkersPlan(env && env.FLOWS_PLAN_WORKERS);
  const u = resolveUwPlan(env && env.FLOWS_UW_PLAN);
  return {
    workers: w.plan,
    uw: u.plan,
    workersRecognised: w.recognised,
    uwRecognised: u.recognised,
    workersExplicit: w.explicit,
    uwExplicit: u.explicit,
  };
}

const activeCell = (row, plans) => (row.plans ? row.plans[plans.uw] : row[plans.workers]);
const downgradeCell = (row) => (row.plans ? row.plans.unknown : row.free);
const designCell = (row, plans) => (row.plans ? row.plans[plans.uw] : row.paid);

const ownerLine = (id, env) => {
  const name = OWNER_LINE_ENV[id];
  const raw = name && env ? env[name] : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return id === "uw.day" ? (Number.isInteger(n) ? n : null) : n;
};

function capOf(row, plans, env) {
  const base = activeCell(row, plans);
  let cap = base.v;
  let from = "plan";
  const owner = ownerLine(row.id, env);
  if (row.id === "uw.day") {
    if (owner !== null) {
      cap = cap === null ? owner : Math.min(owner, cap);
      from = "owner";
    } else if (plans.uw === "unknown") {
      cap = cap === null ? ADVISORY["uw.day"].v : Math.min(cap, ADVISORY["uw.day"].v);
      from = "advisory";
    }
  } else if (row.id === "ai.usd" && plans.workers === "paid" && owner !== null) {
    cap = owner;
    from = "owner";
  }
  return { cap, from };
}

export function lineOf(row, plans, env) {
  const active = activeCell(row, plans);
  const { cap, from } = capOf(row, plans, env);
  return Object.freeze({
    id: row.id,
    unit: row.unit,
    kind: row.kind,
    owner: row.owner,
    plan: row.plans ? plans.uw : plans.workers,
    per: active.per,
    cap,
    capFrom: from,
    planCap: active.v,
    over: active.over,
    source: active.src,
    via: SOURCES[active.src].via,
    downgrade: downgradeCell(row),
    design: designCell(row, plans),
  });
}

export function lines(env) {
  const plans = planOf(env);
  const out = {};
  for (const row of RESOURCES) out[row.id] = lineOf(row, plans, env);
  return Object.freeze(out);
}

export function facts(env) {
  const plans = planOf(env);
  const out = {};
  for (const row of FACTS) out[row.id] = lineOf(row, plans, env);
  return Object.freeze(out);
}

export function lineFor(env, id) {
  const row = RESOURCES.find((r) => r.id === id) || FACTS.find((r) => r.id === id);
  return row ? lineOf(row, planOf(env), env) : null;
}

export function figures() {
  const out = [];
  for (const row of [...RESOURCES, ...FACTS]) {
    const cells = row.plans
      ? Object.keys(row.plans).map((p) => [p, row.plans[p]])
      : [["free", row.free], ["paid", row.paid]];
    for (const [plan, c] of cells) out.push({ id: row.id, plan, cell: c, via: SOURCES[c.src] ? SOURCES[c.src].via : null });
  }
  return out;
}

export function snippetFigures() {
  return figures().filter((f) => f.via === "snippet").map((f) => `${f.id}:${f.plan}`);
}

const DAY_MS = 86_400_000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

export function renewalState(nowMs, env) {
  const plans = planOf(env);
  const raw = env && env.FLOWS_PLAN_PAID_THROUGH;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const parsed = isoDay.test(trimmed) ? Date.parse(trimmed + "T00:00:00Z") : NaN;
  const recorded = Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === trimmed ? trimmed : null;
  const through = recorded || WORKERS_PAID_PERIOD.through;
  const endMs = Date.parse(through + "T00:00:00Z") + DAY_MS - 1;
  const renews = new Date(Date.parse(through + "T00:00:00Z") + DAY_MS).toISOString().slice(0, 10);
  const daysLeft = Math.max(0, Math.ceil((endMs - nowMs) / DAY_MS));
  let state = "current";
  if (plans.workers === "free") state = "free";
  else if (nowMs > endMs) state = "unconfirmed";
  else if (daysLeft <= 3) state = "due";
  return { workers: plans.workers, through, renews, daysLeft, state, recorded: recorded !== null };
}
