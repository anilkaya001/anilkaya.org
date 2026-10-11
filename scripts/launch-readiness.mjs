import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CHECKLIST = "docs/launch-checklist.md";
export const PAID_CAP_NEURONS = 30000;
export const FREE_CAP_NEURONS = 9000;
export const QUARTER_DAYS = 92;
export const LIMITERS = Object.freeze(["LAB_WRITE", "LOGIN_IP", "LOGIN_NAME", "MEMBER_VENDOR", "AI_ASK", "PREFS_WRITE"]);
export const LEGAL_PAGES = Object.freeze(["legal/privacy/index.html", "legal/terms/index.html", "legal/disclaimer/index.html"]);
export const ACCOUNT_TABLES = Object.freeze(["accounts", "audit_log"]);
export const ACCOUNT_ROUTES = Object.freeze(["/api/account/export", "/api/account", "/auth/refresh"]);
export const SESSION_CLAIMS = Object.freeze(["sub", "role", "plan", "ent", "sv", "exp", "rexp"]);
export const IMPERATIVE_FIRST_WORDS = Object.freeze([
  "buy", "sell", "harvest", "ride", "fade", "pin", "hold", "short", "long", "enter", "exit", "open", "close", "avoid", "take", "add", "trim", "go",
  "stand", "bet", "trade", "own",
]);
export const BILLING_SWITCH = "FLOWS_BILLING_MODE";

const CLASS_LETTER = /^[A-D]$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /(?:^|[\s;,(])([a-z][a-z0-9-]*)=([^\s;,)]+)/g;

export const dayNumber = (iso) => {
  if (typeof iso !== "string" || !DAY.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86400000);
};

export const tokensOf = (text) => {
  const out = {};
  for (const m of String(text || "").matchAll(TOKEN)) out[m[1]] = m[2];
  return out;
};

export function parseToml(text) {
  const arrays = {};
  const tables = {};
  let section = "";
  let current = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let m = /^\[\[([^\]]+)\]\]$/.exec(line);
    if (m) {
      section = m[1];
      current = {};
      (arrays[section] ||= []).push(current);
      continue;
    }
    m = /^\[([^\]]+)\]$/.exec(line);
    if (m) {
      section = m[1];
      current = tables[section] ||= {};
      continue;
    }
    m = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const q = /^"((?:[^"\\]|\\.)*)"/.exec(value);
    if (q) value = q[1];
    if (current) current[m[1]] = value;
    else (tables[""] ||= {})[m[1]] = value;
  }
  return { arrays, tables };
}

const rowCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRule = (cells) => cells.every((c) => /^:?-{3,}:?$/.test(c));

export function parseChecklist(text) {
  const out = { classes: [], parts: [], readbacks: [], errors: [] };
  let section = "";
  for (const raw of String(text || "").split("\n")) {
    const h = /^##\s+(.*)$/.exec(raw);
    if (h) {
      section = h[1].trim().toLowerCase();
      continue;
    }
    const c = /^Classes shown to members:\s*(.*)$/i.exec(raw.trim());
    if (c) {
      out.classes = c[1].split(/[\s,]+/).filter(Boolean);
      continue;
    }
    if (!raw.trim().startsWith("|")) continue;
    const cells = rowCells(raw);
    if (isRule(cells)) continue;
    if (section === "parts") {
      if (cells[0].toLowerCase() === "part") continue;
      if (cells.length !== 4) {
        out.errors.push(`parts row has ${cells.length} cells: ${raw.trim()}`);
        continue;
      }
      out.parts.push({ id: cells[0], line: cells[1], kind: cells[2], text: cells[3] });
    } else if (section === "recorded readbacks") {
      if (cells[0].toLowerCase() === "part") continue;
      if (cells.length !== 5) {
        out.errors.push(`readback row has ${cells.length} cells: ${raw.trim()}`);
        continue;
      }
      out.readbacks.push({ part: cells[0], date: cells[1], by: cells[2], evidence: cells[3], suite: cells[4] });
    }
  }
  return out;
}

const pass = (why = "") => ({ ok: true, why });
const fail = (why) => ({ ok: false, why });

export function rowProblem(r, spec, ctx, today, { age = true } = {}) {
  const day = dayNumber(r.date);
  if (day === null) return `date "${r.date}" is not a real YYYY-MM-DD day`;
  if (day > today) return `dated ${r.date}, which is in the future`;
  if (!r.by) return `${r.date} names nobody`;
  if (!r.evidence) return `${r.date} has no evidence`;
  const tokens = tokensOf(r.evidence);
  const missing = (spec.tokens || []).filter((t) => !tokens[t]);
  if (missing.length) return `${r.date} lacks ${missing.map((t) => t + "=").join(", ")}`;
  if (spec.suite) {
    if (!r.suite) return `${r.date} names no suite`;
    if (!ctx.suites.includes(r.suite) || !ctx.scripts.includes("test:" + r.suite)) return `${r.date} names suite "${r.suite}", which is not registered`;
  }
  if (age && spec.maxAgeDays != null && today - day > spec.maxAgeDays) return `${r.date} is ${today - day} days old, past ${spec.maxAgeDays}`;
  return null;
}

const todayOf = (now) => Math.floor(now.getTime() / 86400000);

export function readbackProblems(sheet, ctx, now = ctx.now || new Date()) {
  const out = [...sheet.errors];
  for (const r of sheet.readbacks) {
    const spec = PARTS.find((p) => p.id === r.part);
    if (!spec || spec.kind !== "readback") { out.push(`readback for "${r.part}", which is not a readback part`); continue; }
    const why = rowProblem(r, spec, ctx, todayOf(now), { age: false });
    if (why) out.push(`part ${r.part}: ${why}`);
  }
  return out;
}

function pickReadback(sheet, spec, ctx, now) {
  const rows = sheet.readbacks.filter((r) => r.part === spec.id);
  if (!rows.length) return { error: "no recorded readback" };
  const today = todayOf(now);
  const problems = [];
  const good = [];
  for (const r of rows) {
    const why = rowProblem(r, spec, ctx, today);
    if (why) { problems.push(why); continue; }
    good.push({ ...r, day: dayNumber(r.date), tokens: tokensOf(r.evidence) });
  }
  good.sort((a, b) => b.day - a.day);
  for (const row of good) {
    const result = spec.check(row, ctx, sheet);
    if (result.ok) return { row, result };
    problems.push(`${row.date} ${result.why}`);
  }
  return { error: problems.join("; ") };
}

const readback = (spec) => ({ ...spec, kind: "readback" });
const repo = (spec) => ({ ...spec, kind: "repo" });

export const PARTS = Object.freeze([
  readback({
    id: "1a", line: 1, tokens: ["plan"],
    text: "A dated readback of the Workers plan from the Cloudflare invoice or plan page, as plan=paid or plan=free.",
    check: (rb) => (["paid", "free"].includes(rb.tokens.plan) ? pass(`plan=${rb.tokens.plan}`) : fail(`plan=${rb.tokens.plan} is neither paid nor free`)),
  }),
  repo({
    id: "1b", line: 1,
    text: "FLOWS_AI_DAILY_CAP_NEURONS in wrangler.toml is the cap of the recorded plan: 30000 on paid, at most 9000 on free.",
    check: (ctx, state) => {
      const plan = state["1a"] && state["1a"].tokens && state["1a"].tokens.plan;
      if (!plan) return fail("the plan is not recorded (1a)");
      const toml = parseToml(ctx.read("wrangler.toml"));
      const cap = Number((toml.tables.vars || {}).FLOWS_AI_DAILY_CAP_NEURONS);
      if (!Number.isFinite(cap)) return fail("FLOWS_AI_DAILY_CAP_NEURONS is not set");
      if (plan === "paid") return cap === PAID_CAP_NEURONS ? pass(`cap ${cap}`) : fail(`plan paid but cap ${cap}, not ${PAID_CAP_NEURONS}`);
      return cap <= FREE_CAP_NEURONS ? pass(`cap ${cap}`) : fail(`plan free but cap ${cap}, above ${FREE_CAP_NEURONS}`);
    },
  }),
  readback({
    id: "2a", line: 2, tokens: ["classes"],
    text: "The vendor's written answer, dated, as classes=A+B+C+D naming every data class the checklist lists as shown to members.",
    check: (rb, ctx, sheet) => {
      const named = rb.tokens.classes.split("+");
      if (named.some((c) => !CLASS_LETTER.test(c))) return fail(`classes=${rb.tokens.classes} holds a class that is not A to D`);
      const need = sheet.classes;
      if (!need.length) return fail("the checklist lists no classes shown to members");
      if (need.some((c) => !CLASS_LETTER.test(c))) return fail(`the checklist lists a class that is not A to D: ${need.join(" ")}`);
      const lacking = need.filter((c) => !named.includes(c));
      return lacking.length ? fail(`the answer does not cover class ${lacking.join(", ")}`) : pass(`covers ${need.join("+")}`);
    },
  }),
  readback({
    id: "2b", line: 2, tokens: ["price", "tiers"],
    text: "The launch price and tiers, dated, as price=<amount> and tiers=<count>.",
    check: (rb) => (/^\d+(?:\.\d+)?$/.test(rb.tokens.price) && /^[1-9]\d*$/.test(rb.tokens.tiers) ? pass(`price ${rb.tokens.price}, ${rb.tokens.tiers} tier(s)`) : fail("price is not an amount or tiers is not a count")),
  }),
  readback({
    id: "3a", line: 3, tokens: ["counsel"],
    text: "Counsel's written answer on ranked ideas, dated, as counsel=ranked-ideas.",
    check: (rb) => (rb.tokens.counsel === "ranked-ideas" ? pass() : fail(`counsel=${rb.tokens.counsel}, not ranked-ideas`)),
  }),
  repo({
    id: "3b", line: 3,
    text: "No verdict word in VERDICT_WORD begins with an imperative verb.",
    check: (ctx) => {
      const words = Object.entries(ctx.verdictWords || {});
      if (words.length < 1) return fail("VERDICT_WORD is empty or unreadable");
      const bad = words.filter(([, w]) => IMPERATIVE_FIRST_WORDS.includes(String(w).trim().split(/\s+/)[0].toLowerCase())).map(([k]) => k);
      return bad.length ? fail(`imperative verdict words: ${bad.join(", ")}`) : pass(`${words.length} words`);
    },
  }),
  repo({
    id: "4a", line: 4,
    text: "schema.sql and the migrations create the accounts and audit_log tables.",
    check: (ctx) => {
      const sql = ctx.schemaText();
      const lacking = ACCOUNT_TABLES.filter((t) => !new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${t}\\b`, "i").test(sql));
      return lacking.length ? fail(`no table: ${lacking.join(", ")}`) : pass();
    },
  }),
  repo({
    id: "4b", line: 4,
    text: "The Worker serves /api/account (deletion), /api/account/export and /auth/refresh.",
    check: (ctx) => {
      const src = ctx.workerSource();
      const lacking = ACCOUNT_ROUTES.filter((r) => !src.includes(`"${r}"`) && !src.includes(`'${r}'`) && !src.includes("`" + r + "`"));
      return lacking.length ? fail(`no route: ${lacking.join(", ")}`) : pass();
    },
  }),
  repo({
    id: "4c", line: 4,
    text: "The privacy, terms and disclaimer pages exist under legal/.",
    check: (ctx) => {
      const lacking = LEGAL_PAGES.filter((p) => !ctx.exists(p));
      return lacking.length ? fail(`no page: ${lacking.join(", ")}`) : pass();
    },
  }),
  repo({
    id: "4d", line: 4,
    text: "shared/session.js carries the session v2 claims sub, role, plan, ent, sv, exp and rexp.",
    check: (ctx) => {
      const src = ctx.read("shared/session.js") || "";
      const lacking = SESSION_CLAIMS.filter((c) => !new RegExp(`\\b${c}\\b`).test(src));
      return lacking.length ? fail(`no claim: ${lacking.join(", ")}`) : pass();
    },
  }),
  repo({
    id: "5a", line: 5,
    text: "wrangler.toml declares the LAB_WRITE, LOGIN_IP, LOGIN_NAME, MEMBER_VENDOR, AI_ASK and PREFS_WRITE limiters and the Worker reads each from env.",
    check: (ctx) => {
      const declared = (parseToml(ctx.read("wrangler.toml")).arrays.ratelimits || []).map((r) => r.name);
      const src = ctx.workerSource();
      const lacking = LIMITERS.filter((n) => !declared.includes(n));
      const unused = LIMITERS.filter((n) => declared.includes(n) && !new RegExp(`\\benv\\.${n}\\b`).test(src));
      if (lacking.length) return fail(`not declared: ${lacking.join(", ")}`);
      return unused.length ? fail(`declared but never read: ${unused.join(", ")}`) : pass();
    },
  }),
  readback({
    id: "6a", line: 6, tokens: ["ruleset"],
    text: "A dated readback of the repository ruleset on main requiring the test check, as ruleset=test-required.",
    check: (rb) => (rb.tokens.ruleset === "test-required" ? pass() : fail(`ruleset=${rb.tokens.ruleset}, not test-required`)),
  }),
  repo({
    id: "6b", line: 6,
    text: "regression.yml has the test job, and wrangler.staging.toml names a D1 database and a PULSE binding of its own.",
    check: (ctx) => {
      const wf = ctx.read(".github/workflows/regression.yml") || "";
      if (!/^  test:\s*$/m.test(wf)) return fail("regression.yml has no test job");
      const staging = ctx.read("wrangler.staging.toml");
      if (staging == null) return fail("wrangler.staging.toml is absent");
      const s = parseToml(staging);
      const p = parseToml(ctx.read("wrangler.toml"));
      const sd1 = (s.arrays.d1_databases || [])[0];
      const pd1 = (p.arrays.d1_databases || [])[0];
      if (!sd1 || !sd1.database_name) return fail("staging names no D1 database");
      if (pd1 && sd1.database_name === pd1.database_name) return fail("staging shares production's D1 database name");
      if (!(s.arrays["durable_objects.bindings"] || []).some((b) => b.name === "PULSE")) return fail("staging has no PULSE binding");
      return pass();
    },
  }),
  Object.freeze({
    id: "6c", line: 6, kind: "dropped", dropped: "OD-02 (c)",
    text: "Five audited promotions through a release branch (P1-01). Dropped 2026-10-10 17:45 UTC by OD-02 (c): main deploys on merge, and every merge waits for green CI.",
  }),
  readback({
    id: "7a", line: 7, tokens: ["revocation"], suite: true,
    text: "A dated readback that a revoked member's socket closes within one roster refresh, as revocation=closed-within-refresh, naming the suite that proves it.",
    check: (rb) => (rb.tokens.revocation === "closed-within-refresh" ? pass() : fail(`revocation=${rb.tokens.revocation}`)),
  }),
  readback({
    id: "8a", line: 8, tokens: ["status"], suite: true,
    text: "A dated readback of the members status view, as status=members-view, naming the suite that proves it.",
    check: (rb) => (rb.tokens.status === "members-view" ? pass() : fail(`status=${rb.tokens.status}`)),
  }),
  readback({
    id: "8b", line: 8, tokens: ["alerts"],
    text: "A dated readback that the alert channel delivered a test alert, as alerts=delivered.",
    check: (rb) => (rb.tokens.alerts === "delivered" ? pass() : fail(`alerts=${rb.tokens.alerts}`)),
  }),
  readback({
    id: "9a", line: 9, tokens: ["drill"], maxAgeDays: QUARTER_DAYS,
    text: "A restore drill from a private export or Time Travel, dated within the last 92 days, as drill=restore.",
    check: (rb) => (rb.tokens.drill === "restore" ? pass() : fail(`drill=${rb.tokens.drill}`)),
  }),
  repo({
    id: "10a", line: 10,
    text: "wrangler.toml sets FLOWS_TIER2 to worker, so Tier 2 runs off GitHub.",
    check: (ctx) => {
      const v = (parseToml(ctx.read("wrangler.toml")).tables.vars || {}).FLOWS_TIER2;
      return v === "worker" ? pass() : fail(`FLOWS_TIER2 is ${v === undefined ? "unset" : v}, not worker`);
    },
  }),
  readback({
    id: "10b", line: 10, tokens: ["live-classes"],
    text: "Or a dated readback that the plan excludes the live data classes, as live-classes=excluded.",
    check: (rb) => (rb.tokens["live-classes"] === "excluded" ? pass() : fail(`live-classes=${rb.tokens["live-classes"]}`)),
  }),
]);

export const LINES = Object.freeze([
  { id: 1, mode: "all", title: "OD-01 answered and the plan matches the caps in wrangler.toml." },
  { id: 2, mode: "all", title: "OD-03a's written vendor answer covering every data class shown to members, and OD-37's price and tiers." },
  { id: 3, mode: "all", title: "OD-06 counsel on ranked ideas; neutral forms live (P1-63)." },
  { id: 4, mode: "all", title: "Accounts, session v2, entitlements, audit, legal pages, deletion and export live (P2-24..P2-27)." },
  { id: 5, mode: "all", title: "Limiters live: Lab, login, member vendor, Ask, prefs writes (P0-10, P0-11, P0-13, P0-16, P3-35)." },
  { id: 6, mode: "all", title: "Deploy gate: test required on main (A-15) and staging in place (P2-33); the five audited promotions dropped by OD-02 (c)." },
  { id: 7, mode: "all", title: "Revocation closes sockets within one roster refresh (P1-35)." },
  { id: 8, mode: "all", title: "Status members view and alerts live (P1-25, P2-03)." },
  { id: 9, mode: "all", title: "A restore drill done in the quarter (OD-24)." },
  { id: 10, mode: "any", title: "Tier 2 off GitHub for any paid live data class (P2-08), or live classes excluded from the plan." },
]);

export function evaluate(ctx, now = ctx.now || new Date()) {
  const sheet = parseChecklist(ctx.read(CHECKLIST) || "");
  const state = {};
  const parts = {};
  for (const spec of PARTS) {
    let result;
    if (spec.kind === "dropped") {
      result = { ok: true, status: "dropped", why: spec.dropped };
    } else if (spec.kind === "readback") {
      const found = pickReadback(sheet, spec, ctx, now);
      if (found.error) result = { ok: false, status: "open", why: found.error };
      else {
        state[spec.id] = found.row;
        result = { ok: true, status: "met", why: `${found.row.date} ${found.result.why}`.trim() };
      }
    } else {
      const r = spec.check(ctx, state);
      result = { ok: r.ok, status: r.ok ? "met" : "open", why: r.why };
    }
    parts[spec.id] = { id: spec.id, kind: spec.kind, line: spec.line, ...result };
  }
  const lines = LINES.map((line) => {
    const own = PARTS.filter((p) => p.line === line.id).map((p) => parts[p.id]);
    const ok = line.mode === "any" ? own.some((p) => p.ok) : own.every((p) => p.ok);
    return { id: line.id, title: line.title, mode: line.mode, ok, parts: own };
  });
  const ready = lines.every((l) => l.ok);
  const surfaces = paidSurfaces(ctx);
  return { lines, ready, surfaces, violation: surfaces.length > 0 && !ready, sheet };
}

export function paidSurfaces(ctx) {
  const out = [];
  if (ctx.exists("shared/plans.js")) out.push("shared/plans.js exists");
  if (/\b(?:subscriptions|billing_events)\b/i.test(ctx.schemaText())) out.push("the schema has subscriptions or billing_events");
  if (ctx.workerSource().includes("/api/billing/")) out.push("the Worker serves /api/billing/");
  const vars = parseToml(ctx.read("wrangler.toml")).tables.vars || {};
  if (vars[BILLING_SWITCH] !== undefined && vars[BILLING_SWITCH] !== "off") out.push(`${BILLING_SWITCH} is ${vars[BILLING_SWITCH]}`);
  return out;
}

export async function realContext(root = ROOT, now = new Date()) {
  const read = (rel) => {
    const abs = path.join(root, rel);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  };
  const exists = (rel) => existsSync(path.join(root, rel));
  const sourceScan = await import(pathToFileURL(path.join(root, "tests/lib/source-scan.mjs")).href);
  const neuron = await import(pathToFileURL(path.join(root, "shared/flows-neuron.js")).href);
  const migrations = existsSync(path.join(root, "migrations"))
    ? readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => read("migrations/" + f))
    : [];
  const schema = [read("schema.sql") || "", ...migrations].join("\n");
  const suites = JSON.parse(read("tests/suites.json") || '{"suites":[]}').suites.map((s) => s.name);
  const scripts = Object.keys(JSON.parse(read("tests/package.json") || "{}").scripts || {});
  let worker = null;
  return {
    read, exists, now, suites, scripts,
    verdictWords: neuron.VERDICT_WORD,
    schemaText: () => schema,
    workerSource: () => (worker ??= sourceScan.workerSource()),
  };
}

export function render(result) {
  const out = [];
  for (const line of result.lines) {
    out.push(`${line.ok ? "TRUE " : "FALSE"}  ${line.id}. ${line.title}`);
    for (const p of line.parts) out.push(`        ${p.id} ${p.status.padEnd(7)} ${p.why}`);
  }
  out.push("");
  out.push(result.ready ? "READY: every line is true." : `NOT READY: lines ${result.lines.filter((l) => !l.ok).map((l) => l.id).join(", ")} are not true.`);
  if (result.surfaces.length) out.push(`Paid surface present: ${result.surfaces.join("; ")}.`);
  if (result.violation) out.push("VIOLATION: a paid surface exists while the lines above are not all true.");
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = evaluate(await realContext());
  if (process.argv.includes("--json")) {
    const { sheet, ...rest } = result;
    console.log(JSON.stringify(rest, null, 2));
  } else console.log(render(result));
  process.exit(result.ready && !result.violation ? 0 : 1);
}
